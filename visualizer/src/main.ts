import { SceneManager } from "./scene/SceneManager.js";
import { SceneUpdater } from "./scene/SceneUpdater.js";
import { BEVRenderer } from "./bev/BEVRenderer.js";
import { ControlPanel } from "./ui/ControlPanel.js";
import { ManualControls } from "./ui/ManualControls.js";
import { SimulationSource } from "./core/datasources/SimulationSource.js";
import { ManualSource } from "./core/datasources/ManualSource.js";
import { stateStore } from "./core/state/StateStore.js";
import { checkConstraints } from "./core/constraints/ConstraintChecker.js";
import { ConstraintOverlay } from "./constraints/ConstraintOverlay.js";
import { loadConfigFromUrl } from "./core/config/loader.js";
import { createNavBar } from "./ui/NavBar.js";
import { AxisDataTable } from "./ui/AxisDataTable.js";

/**
 * Application entry point.
 *
 * Initialization order:
 *   1. Obtain DOM references
 *   2. Create SceneManager (Three.js renderer + camera + controls)
 *   3. Create BEVRenderer (Canvas 2D)
 *   4. Create data sources + ControlPanel
 *   5. Register drag-and-drop config loading
 *   6. Load default config (example-collimator.json)
 *   7. Subscribe to StateStore → update scene, BEV, constraints
 *   8. Start render loop
 */

async function main(): Promise<void> {
  // --- NavBar ---
  const app = document.getElementById("app");
  if (app) {
    app.insertBefore(createNavBar("visualization"), app.firstChild);
  }

  // --- DOM references ---
  const panel3d = document.getElementById("panel-3d");
  const bevCanvas = document.getElementById("bev-canvas");

  if (!panel3d || !(bevCanvas instanceof HTMLCanvasElement)) {
    throw new Error("Required DOM elements not found. Check index.html.");
  }

  // Three.js needs an explicit canvas element; we let it create one inside panel-3d
  const threeCanvas = document.createElement("canvas");
  panel3d.insertBefore(threeCanvas, panel3d.firstChild);

  // --- Scene ---
  const sceneManager = new SceneManager(threeCanvas, panel3d);
  const sceneUpdater = new SceneUpdater(sceneManager.scene);

  // --- BEV ---
  const bevRenderer = new BEVRenderer(bevCanvas);

  // --- Constraints ---
  const constraintOverlay = new ConstraintOverlay();
  constraintOverlay.init(sceneUpdater);
  const manualControls = new ManualControls();
  const axisDataTable = new AxisDataTable();

  // --- Data sources ---
  const manualSource = new ManualSource();
  const simulationSource = new SimulationSource();

  simulationSource.onStatusChange = (status) => controlPanel.setStatus(status);

  // --- Control panel ---
  const controlPanel = new ControlPanel();
  controlPanel.registerSources([manualSource, simulationSource], (source) => {
    if (source.id === "manual") {
      manualSource.seedState(stateStore.getState());
      // Re-render controls with current state values (US-18 AC#2)
      const config = stateStore.getConfig();
      const mc = document.getElementById("manual-controls");
      if (config && mc) {
        manualControls.render(mc, config, manualSource);
      }
    }
    stateStore.setActiveSource(source);
    manualControls.setEnabled(source.id === "manual");
    // Set status after setActiveSource so SimulationSource.deactivate() doesn't overwrite
    if (source.id === "manual") {
      controlPanel.setStatus("manual");
    }
  });

  // --- State subscription ---
  stateStore.subscribe((state) => {
    const config = stateStore.getConfig();
    if (!config) return;

    sceneUpdater.onStateUpdate(state, config);
    bevRenderer.render(state, config);

    axisDataTable.update(state, config);

    const violations = checkConstraints(state, config);
    constraintOverlay.applyViolations(violations);
    manualControls.applyViolations(violations);
    axisDataTable.applyViolations(violations);

    controlPanel.setLatency(state.timestamp > 0 ? Date.now() - state.timestamp : null);
  });

  // --- Config loading ---
  const onConfigLoaded = async (source: Response | File): Promise<void> => {
    try {
      const config =
        source instanceof File
          ? await (await import("./core/config/loader.js")).loadConfigFromFile(source)
          : await (await import("./core/config/loader.js")).loadConfigFromUrl((source as Response).url);

      stateStore.setConfig(config);
      sceneUpdater.onConfigLoaded(config);
      bevRenderer.onConfigLoaded(config);

      // Re-notify so the newly created scene objects receive the current state.
      // stateStore.setConfig() already called notify(), but at that point the old
      // scene objects were still active. After onConfigLoaded() the new objects exist
      // but haven't received a state update yet.
      stateStore.renotify();

      const manualControlsContainer = document.getElementById("manual-controls");
      if (manualControlsContainer) {
        manualControls.render(manualControlsContainer, config, manualSource);
        constraintOverlay.renderConstraintEditor(manualControlsContainer, config);
      }
      const axisContainer = document.getElementById("axis-data-table");
      if (axisContainer) axisDataTable.buildFromConfig(axisContainer, config);
    } catch (err) {
      console.error("[main] Failed to load config:", err);
    }
  };

  // Drag-and-drop handler
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.body.classList.add("drag-over");
  });
  document.addEventListener("dragleave", () => {
    document.body.classList.remove("drag-over");
  });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file?.name.endsWith(".json")) {
      void onConfigLoaded(file);
    }
  });

  // --- Load default config ---
  // Allow overriding the startup config via ?config=<name-or-path>, e.g.:
  //   http://localhost:5173?config=quad-jaw-v1.json
  //   http://localhost:5173?config=/configs/quad-jaw-v1.json
  const configParam = new URLSearchParams(window.location.search).get("config");
  const defaultConfigUrl = configParam
    ? configParam.startsWith("/") ? configParam : `/configs/${configParam}`
    : "/configs/example-collimator.json";

  try {
    const config = await loadConfigFromUrl(defaultConfigUrl);
    stateStore.setConfig(config);
    sceneUpdater.onConfigLoaded(config);
    bevRenderer.onConfigLoaded(config);
    stateStore.renotify();

    const manualControlsContainer = document.getElementById("manual-controls");
    if (manualControlsContainer) {
      manualControls.render(manualControlsContainer, config, manualSource);
      constraintOverlay.renderConstraintEditor(manualControlsContainer, config);
    }
    const axisContainer = document.getElementById("axis-data-table");
    if (axisContainer) axisDataTable.buildFromConfig(axisContainer, config);
  } catch {
    console.warn("[main] Default config not found — drag a collimator JSON to load one.");
  }

  // --- Activate default data source (Manual) ---
  stateStore.setActiveSource(manualSource);
  controlPanel.setStatus("manual");
  manualControls.setEnabled(true);

  // --- Wire "Reset View" button (US-10) ---
  document.getElementById("reset-view-btn")?.addEventListener("click", () => {
    sceneManager.resetView();
  });

  // --- Start render loop ---
  sceneManager.startLoop();
}

main().catch((err) => {
  console.error("[main] Fatal error:", err);
});
