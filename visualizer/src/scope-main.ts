import { loadConfigFromUrl } from "./core/config/loader.js";
import { stateStore } from "./core/state/StateStore.js";
import { SimulationSource } from "./core/datasources/SimulationSource.js";
import { createNavBar } from "./ui/NavBar.js";

/**
 * Scope page entry point.
 *
 * US-24: Minimal scaffold — loads config, connects to bridge,
 * subscribes to state updates. Chart rendering is US-25.
 */
async function scopeMain(): Promise<void> {
  // --- NavBar ---
  const app = document.getElementById("app");
  if (app) {
    app.insertBefore(createNavBar("scope"), app.firstChild);
  }

  // --- Status display ---
  const statusEl = document.getElementById("scope-status");

  // --- Data source ---
  const simulationSource = new SimulationSource();
  simulationSource.onStatusChange = (status) => {
    if (statusEl) {
      const labels: Record<string, string> = {
        connected: "Connected",
        waiting: "Waiting for data...",
        disconnected: "Disconnected",
        error: "Connection error",
      };
      statusEl.textContent = labels[status] ?? status;
    }
  };

  // --- State subscription (placeholder for US-25 chart) ---
  stateStore.subscribe((state) => {
    console.log(
      "[Scope] State update:",
      state.timestamp,
      Object.keys(state.modules).length,
      "modules",
    );
  });

  // --- Load config ---
  const configParam = new URLSearchParams(window.location.search).get("config");
  const defaultConfigUrl = configParam
    ? configParam.startsWith("/") ? configParam : `/configs/${configParam}`
    : "/configs/example-collimator.json";

  try {
    const config = await loadConfigFromUrl(defaultConfigUrl);
    stateStore.setConfig(config);
    console.log(
      "[Scope] Config loaded:",
      config.collimator_id,
      config.modules.length,
      "modules",
    );
  } catch {
    console.warn("[Scope] Default config not found.");
  }

  // --- Drag-and-drop config loading ---
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.body.classList.add("drag-over");
  });
  document.addEventListener("dragleave", () => {
    document.body.classList.remove("drag-over");
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    document.body.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file?.name.endsWith(".json")) {
      try {
        const { loadConfigFromFile } = await import("./core/config/loader.js");
        const config = await loadConfigFromFile(file);
        stateStore.setConfig(config);
        console.log("[Scope] Config loaded via drop:", config.collimator_id);
      } catch (err) {
        console.error("[Scope] Failed to load dropped config:", err);
      }
    }
  });

  // --- Activate simulation source ---
  stateStore.setActiveSource(simulationSource);
}

scopeMain().catch((err) => {
  console.error("[Scope] Fatal error:", err);
});
