import type { DataSource } from "../state/DataSource.js";
import type { ConnectionStatus } from "../datasources/SimulationSource.js";

/**
 * Manages the data source dropdown and connection status badge in the UI.
 *
 * HTML elements (defined in index.html):
 *   #source-select  — <select> for data source switching
 *   #status-badge   — <span> showing connection status
 *
 * TODO: implement full event wiring and status management
 */
export class ControlPanel {
  private readonly selectEl: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private readonly latencyEl: HTMLElement | null;
  private sources: DataSource[] = [];
  private onSourceChange?: (source: DataSource) => void;

  constructor() {
    const select = document.getElementById("source-select");
    const status = document.getElementById("status-badge");

    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("#source-select element not found or not a <select>");
    }
    if (!status) {
      throw new Error("#status-badge element not found");
    }

    this.selectEl = select;
    this.statusEl = status;
    this.latencyEl = document.getElementById("latency-display");

    this.selectEl.addEventListener("change", () => this.handleSourceChange());
  }

  /**
   * Register the available data sources.
   * The first source in the list becomes the initial active source.
   */
  registerSources(sources: DataSource[], onChange: (source: DataSource) => void): void {
    this.sources = sources;
    this.onSourceChange = onChange;

    // Populate dropdown options to match registered sources
    this.selectEl.innerHTML = "";
    for (const source of sources) {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = source.label;
      this.selectEl.appendChild(option);
    }
  }

  /** Update the status badge text and color class. */
  setStatus(status: ConnectionStatus): void {
    const labels: Record<ConnectionStatus, string> = {
      connected: "Connected",
      waiting: "Waiting for data…",
      disconnected: "Disconnected",
      error: "Error",
      manual: "Manual",
    };
    this.statusEl.textContent = labels[status];
    this.statusEl.className = status === "connected" ? "status-badge" : `status-badge ${status}`;
    if (status !== "connected") {
      this.setLatency(null);
    }
  }

  /** Show or hide the latency indicator. Pass null to hide. */
  setLatency(ms: number | null): void {
    if (!this.latencyEl) return;
    if (ms === null || ms < 0) {
      this.latencyEl.textContent = "";
      this.latencyEl.style.display = "none";
    } else {
      this.latencyEl.textContent = `${ms} ms`;
      this.latencyEl.style.display = "";
    }
  }

  private handleSourceChange(): void {
    const selectedId = this.selectEl.value;
    const source = this.sources.find((s) => s.id === selectedId);
    if (source && this.onSourceChange) {
      // TODO: seed ManualSource with current state before activating
      this.onSourceChange(source);
    }
  }
}
