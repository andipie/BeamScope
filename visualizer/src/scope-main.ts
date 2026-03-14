import "uplot/dist/uPlot.min.css";
import { loadConfigFromUrl } from "./core/config/loader.js";
import { stateStore } from "./core/state/StateStore.js";
import { SimulationSource } from "./core/datasources/SimulationSource.js";
import { ManualSource } from "./core/datasources/ManualSource.js";
import { createNavBar } from "./ui/NavBar.js";
import { TraceRegistry } from "./scope/TraceRegistry.js";
import { RingBuffer } from "./scope/RingBuffer.js";
import { ScopeChart } from "./scope/ScopeChart.js";
import { TraceSelector } from "./scope/TraceSelector.js";
import { exportScopeCsv } from "./scope/exportCsv.js";
import type { CollimatorConfig } from "./core/config/types.js";

const SAMPLE_RATE_HZ = 50;

/**
 * Scope page entry point.
 *
 * US-25: Real-time time-series chart with selectable traces.
 * US-26: Configurable buffer, transport controls, zoom/pan, CSV export.
 */
async function scopeMain(): Promise<void> {
  // --- NavBar ---
  const app = document.getElementById("app");
  if (app) {
    app.insertBefore(createNavBar("scope"), app.firstChild);
  }

  // --- DOM references ---
  const statusEl = document.getElementById("scope-status");
  const chartEl = document.getElementById("scope-chart-area");
  const selectorEl = document.getElementById("trace-selector");
  const bufferSelect = document.getElementById("scope-buffer-select") as HTMLSelectElement | null;
  const bufferInfoEl = document.getElementById("scope-buffer-info");
  const btnPause = document.getElementById("scope-btn-pause");
  const btnClear = document.getElementById("scope-btn-clear");
  const liveBadge = document.getElementById("scope-live-badge");
  const btnExport = document.getElementById("scope-btn-export");

  if (!chartEl || !selectorEl) {
    throw new Error("Required DOM elements not found. Check scope.html.");
  }

  // --- Transport state ---
  let paused = false;
  let live = true;
  let currentDurationSec = 60;

  function updateLiveBadge(): void {
    if (liveBadge) {
      liveBadge.classList.toggle("inactive", !live);
    }
  }

  function updateBufferInfo(): void {
    if (!ringBuffer || !bufferInfoEl) return;
    const filledSec = (ringBuffer.length / SAMPLE_RATE_HZ).toFixed(0);
    const mb = (ringBuffer.getMemoryBytes() / 1048576).toFixed(1);
    bufferInfoEl.textContent = `Buffer: ${filledSec}s / ${currentDurationSec}s, ~${mb} MB`;
  }

  // --- Data sources ---
  const manualSource = new ManualSource();
  const simulationSource = new SimulationSource();

  simulationSource.onStatusChange = (status) => {
    if (statusEl) {
      const labels: Record<string, string> = {
        connected: "Connected",
        waiting: "Waiting for data...",
        disconnected: "Disconnected",
        error: "Connection error",
        manual: "Manual",
      };
      statusEl.textContent = labels[status] ?? status;
      statusEl.className = status;
    }
  };

  // --- Scope components ---
  const traceRegistry = new TraceRegistry();
  let ringBuffer: RingBuffer | null = null;

  const scopeChart = new ScopeChart(chartEl, {
    onExitLive: () => {
      live = false;
      updateLiveBadge();
    },
    onResetToLive: () => {
      live = true;
      updateLiveBadge();
    },
  });

  const traceSelector = new TraceSelector(selectorEl, (visibleIds) => {
    scopeChart.setVisibleTraces(visibleIds);
    if (ringBuffer) {
      scopeChart.setData(ringBuffer.getData(), live, currentDurationSec);
    }
  });

  // --- Source switching ---
  const sourceSelect = document.getElementById("scope-source-select") as HTMLSelectElement | null;
  if (sourceSelect) {
    sourceSelect.addEventListener("change", () => {
      const val = sourceSelect.value;
      if (val === "simulation") {
        stateStore.setActiveSource(simulationSource);
      } else {
        manualSource.seedState(stateStore.getState());
        stateStore.setActiveSource(manualSource);
        if (statusEl) {
          statusEl.textContent = "Manual";
          statusEl.className = "connected";
        }
      }
    });
  }

  // --- rAF-throttled render loop ---
  let dirty = false;

  stateStore.subscribe((state) => {
    const config = stateStore.getConfig();
    if (!config || !ringBuffer) return;

    const values = traceRegistry.extractAll(state, config);
    const traceIds = traceRegistry.getTraces().map((t) => t.id);
    const numericValues = traceIds.map((id) => values[id] ?? 0);

    // Always append (even when paused — buffer records in background)
    ringBuffer.append(state.timestamp / 1000, numericValues);
    dirty = true;
  });

  function renderLoop(): void {
    if (dirty && !paused) {
      dirty = false;
      if (ringBuffer) {
        scopeChart.setData(ringBuffer.getData(), live, currentDurationSec);
        updateBufferInfo();
      }
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  // --- Buffer duration dropdown ---
  if (bufferSelect) {
    bufferSelect.addEventListener("change", () => {
      currentDurationSec = parseInt(bufferSelect.value, 10);
      if (ringBuffer) {
        ringBuffer.resize(currentDurationSec * SAMPLE_RATE_HZ);
        updateBufferInfo();
        if (live) {
          scopeChart.setData(ringBuffer.getData(), true, currentDurationSec);
        }
      }
    });
  }

  // --- Transport buttons ---
  if (btnPause) {
    btnPause.addEventListener("click", () => {
      paused = !paused;
      btnPause.textContent = paused ? "\u25B6" : "\u23F8";
      if (!paused) {
        live = true;
        updateLiveBadge();
        // Force immediate chart update on resume
        if (ringBuffer) {
          scopeChart.setData(ringBuffer.getData(), true, currentDurationSec);
        }
      }
    });
  }

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (ringBuffer) {
        ringBuffer.clear();
        live = true;
        updateLiveBadge();
        scopeChart.setData(ringBuffer.getData(), true, currentDurationSec);
        updateBufferInfo();
      }
    });
  }

  // --- Export button ---
  if (btnExport) {
    btnExport.addEventListener("click", () => {
      if (ringBuffer) {
        exportScopeCsv(ringBuffer.getData(), traceRegistry.getTraces());
      }
    });
  }

  // --- Config loading helper ---
  const onConfigReady = (config: CollimatorConfig): void => {
    traceRegistry.buildFromConfig(config);
    const traces = traceRegistry.getTraces();

    ringBuffer = new RingBuffer({
      capacity: currentDurationSec * SAMPLE_RATE_HZ,
      traceCount: traces.length,
    });

    traceSelector.build(traces);
    scopeChart.init(traces);
    updateBufferInfo();
  };

  // --- Load default config ---
  const configParam = new URLSearchParams(window.location.search).get("config");
  const defaultConfigUrl = configParam
    ? configParam.startsWith("/") ? configParam : `/configs/${configParam}`
    : "/configs/example-collimator.json";

  try {
    const config = await loadConfigFromUrl(defaultConfigUrl);
    stateStore.setConfig(config);
    onConfigReady(config);
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
        onConfigReady(config);
      } catch (err) {
        console.error("[Scope] Failed to load dropped config:", err);
      }
    }
  });

  // --- Activate default source (Simulation) ---
  stateStore.setActiveSource(simulationSource);

  // --- Test data generator (activated via ?demo query param) ---
  if (new URLSearchParams(window.location.search).has("demo")) {
    let frame = 0;
    setInterval(() => {
      stateStore.setState({
        timestamp: Date.now(),
        sid: 1000 + Math.sin(frame / 50) * 50,
        collimator_rotation_deg: Math.sin(frame / 80) * 10,
        focal_spot: { x: 1, y: 1 },
        modules: {
          prefilter: { rotation_deg: 0, angle_deg: (frame * 3) % 360 },
          jaws_x: { rotation_deg: 0, leaf1: -100 + Math.sin(frame / 15) * 60, leaf2: 100 - Math.sin(frame / 15) * 60 },
          jaws_y: { rotation_deg: 0, leaf1: -80 + Math.cos(frame / 20) * 40, leaf2: 80 - Math.cos(frame / 20) * 40 },
          wedge_1: { rotation_deg: 0, enabled: frame % 200 < 100, lateral_offset_mm: Math.sin(frame / 25) * 30 },
        },
      });
      frame++;
    }, 20);
  }
}

scopeMain().catch((err) => {
  console.error("[Scope] Fatal error:", err);
});
