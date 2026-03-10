import uPlot from "uplot";
import type { TraceDefinition, TraceUnit } from "./TraceRegistry.js";
import { traceColor } from "./traceColors.js";

/**
 * uPlot wrapper for the scope time-series chart.
 *
 * Handles chart lifecycle, dual Y-axes (mm vs °), dark theme,
 * crosshair cursor, and series visibility toggling.
 *
 * US-25
 */
export class ScopeChart {
  private plot: uPlot | null = null;
  private chartEl: HTMLElement;
  private traces: readonly TraceDefinition[] = [];
  private visibleTraceIds = new Set<string>();
  private resizeObserver: ResizeObserver;
  /** Mapping from trace index (0-based in this.traces) to uPlot column index. */
  private traceToCol = new Map<number, number>();

  constructor(chartEl: HTMLElement) {
    this.chartEl = chartEl;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(chartEl);
  }

  /** Initialize with a new set of trace definitions. Call on config load. */
  init(traces: readonly TraceDefinition[]): void {
    this.traces = traces;
    this.visibleTraceIds.clear();
    this.rebuildChart([]);
  }

  /** Update which traces are visible. Rebuilds the uPlot instance. */
  setVisibleTraces(visibleIds: Set<string>): void {
    this.visibleTraceIds = visibleIds;
    if (this.lastData) {
      this.rebuildChart(this.lastData);
    }
  }

  private lastData: number[][] = [];

  /** Push new data to the chart. */
  setData(data: number[][]): void {
    this.lastData = data;
    if (!this.plot) return;

    // Build filtered data: [timestamps, ...only visible trace columns]
    const filtered = this.buildFilteredData(data);
    this.plot.setData(filtered as uPlot.AlignedData);
  }

  /** Handle container resize. */
  resize(): void {
    if (!this.plot) return;
    const { width, height } = this.chartEl.getBoundingClientRect();
    if (width > 0 && height > 0) {
      this.plot.setSize({ width, height });
    }
  }

  /** Destroy uPlot instance. */
  destroy(): void {
    this.resizeObserver.disconnect();
    if (this.plot) {
      this.plot.destroy();
      this.plot = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private rebuildChart(data: number[][]): void {
    if (this.plot) {
      this.plot.destroy();
      this.plot = null;
    }

    // Determine visible traces and their indices
    const visibleTraces: { trace: TraceDefinition; colIndex: number }[] = [];
    for (let i = 0; i < this.traces.length; i++) {
      const t = this.traces[i]!;
      if (this.visibleTraceIds.has(t.id)) {
        visibleTraces.push({ trace: t, colIndex: i + 1 }); // +1 for timestamp column
      }
    }

    // Determine which units are present
    const units = new Set<TraceUnit>();
    for (const vt of visibleTraces) {
      units.add(vt.trace.unit);
    }

    const hasMm = units.has("mm");
    const hasDeg = units.has("\u00B0");
    const hasBool = units.has("bool");

    // Build series config: first entry is always the X series (timestamp)
    const series: uPlot.Series[] = [{}]; // x-axis placeholder

    this.traceToCol.clear();
    for (let si = 0; si < visibleTraces.length; si++) {
      const vt = visibleTraces[si]!;
      this.traceToCol.set(si, vt.colIndex);

      series.push({
        label: vt.trace.id,
        stroke: traceColor(vt.trace.id),
        width: 1.5,
        scale: scaleForUnit(vt.trace.unit),
      });
    }

    // Build axes
    const axes: uPlot.Axis[] = [
      // X-axis (time)
      {
        stroke: "#666",
        grid: { stroke: "#2a2a2a", width: 1 },
        ticks: { stroke: "#333", width: 1 },
        font: "10px system-ui, sans-serif",
      },
    ];

    // Left Y-axis: first unit encountered (mm or ° or bool)
    const leftUnit = hasMm ? "mm" : hasDeg ? "\u00B0" : hasBool ? "bool" : null;
    if (leftUnit) {
      axes.push({
        scale: scaleForUnit(leftUnit as TraceUnit),
        stroke: "#666",
        grid: { stroke: "#2a2a2a", width: 1 },
        ticks: { stroke: "#333", width: 1 },
        font: "10px system-ui, sans-serif",
        label: leftUnit === "bool" ? "on/off" : leftUnit,
        labelFont: "10px system-ui, sans-serif",
        side: 3, // left
      });
    }

    // Right Y-axis: second unit (if present)
    const rightUnit =
      leftUnit === "mm" && hasDeg
        ? "\u00B0"
        : leftUnit === "\u00B0" && hasMm
          ? "mm"
          : leftUnit !== "bool" && hasBool
            ? "bool"
            : null;
    if (rightUnit) {
      axes.push({
        scale: scaleForUnit(rightUnit as TraceUnit),
        stroke: "#666",
        grid: { show: false },
        ticks: { stroke: "#333", width: 1 },
        font: "10px system-ui, sans-serif",
        label: rightUnit === "bool" ? "on/off" : rightUnit,
        labelFont: "10px system-ui, sans-serif",
        side: 1, // right
      });
    }

    // Scales
    const scales: uPlot.Scales = {
      x: { time: true },
    };
    if (hasMm) scales["mm"] = { auto: true };
    if (hasDeg) scales["\u00B0"] = { auto: true };
    if (hasBool) scales["bool"] = { auto: false, range: [-0.2, 1.5] };

    const { width, height } = this.chartEl.getBoundingClientRect();

    const opts: uPlot.Options = {
      width: Math.max(width, 100),
      height: Math.max(height, 100),
      series,
      axes,
      scales,
      cursor: {
        show: true,
        drag: { x: false, y: false },
      },
      legend: {
        show: true,
      },
    };

    const filtered = this.buildFilteredData(data);
    this.plot = new uPlot(opts, filtered as uPlot.AlignedData, this.chartEl);
  }

  /** Build data arrays containing only visible trace columns. */
  private buildFilteredData(data: number[][]): number[][] {
    if (data.length === 0 || !data[0]?.length) {
      const empty: number[][] = [[]];
      for (const _ of this.traceToCol) empty.push([]);
      return empty;
    }

    const result: number[][] = [data[0]!]; // timestamps
    for (const [, colIndex] of this.traceToCol) {
      result.push(data[colIndex] ?? []);
    }
    return result;
  }
}

/** Map trace unit to uPlot scale name. */
function scaleForUnit(unit: TraceUnit): string {
  if (unit === "mm") return "mm";
  if (unit === "\u00B0") return "\u00B0";
  return "bool";
}
