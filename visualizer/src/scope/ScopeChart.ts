import uPlot from "uplot";
import type { TraceDefinition, TraceUnit } from "./TraceRegistry.js";
import { traceColor } from "./traceColors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScopeChartCallbacks {
  /** Called when user zooms or pans (exits live mode). */
  onExitLive: () => void;
  /** Called when user double-clicks to return to live mode. */
  onResetToLive: () => void;
}

// ---------------------------------------------------------------------------
// ScopeChart
// ---------------------------------------------------------------------------

/**
 * uPlot wrapper for the scope time-series chart.
 *
 * Handles chart lifecycle, dual Y-axes (mm vs °), dark theme,
 * crosshair cursor, series visibility toggling, zoom/pan, and live mode.
 *
 * US-25 / US-26
 */
export class ScopeChart {
  private plot: uPlot | null = null;
  private chartEl: HTMLElement;
  private callbacks: ScopeChartCallbacks;
  private traces: readonly TraceDefinition[] = [];
  private visibleTraceIds = new Set<string>();
  private resizeObserver: ResizeObserver;
  private traceToCol = new Map<number, number>();
  private lastData: number[][] = [];

  // Zoom/pan state
  private dragging = false;
  private dragStartX = 0;
  private dragStartMin = 0;
  private dragStartMax = 0;
  /** Saved X range for preserving zoom across rebuildChart(). Null = auto. */
  private savedXRange: { min: number; max: number } | null = null;

  // Bound event handlers for attach/detach
  private boundWheel: ((e: WheelEvent) => void) | null = null;
  private boundMouseDown: ((e: MouseEvent) => void) | null = null;
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseUp: ((e: MouseEvent) => void) | null = null;
  private boundDblClick: ((e: MouseEvent) => void) | null = null;

  constructor(chartEl: HTMLElement, callbacks: ScopeChartCallbacks) {
    this.chartEl = chartEl;
    this.callbacks = callbacks;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(chartEl);
  }

  /** Initialize with a new set of trace definitions. Call on config load. */
  init(traces: readonly TraceDefinition[]): void {
    this.traces = traces;
    this.visibleTraceIds.clear();
    this.savedXRange = null;
    this.rebuildChart([]);
  }

  /** Update which traces are visible. Rebuilds the uPlot instance. */
  setVisibleTraces(visibleIds: Set<string>): void {
    this.visibleTraceIds = visibleIds;
    // Preserve current zoom if user has zoomed
    this.saveCurrentXRange();
    if (this.lastData) {
      this.rebuildChart(this.lastData);
    }
  }

  /**
   * Push new data to the chart.
   * @param data Full ring buffer data (all traces)
   * @param live If true, auto-scroll X to show latest window
   * @param windowDurationSec Time window when live (default 60)
   */
  setData(data: number[][], live: boolean, windowDurationSec = 60): void {
    this.lastData = data;
    if (!this.plot) return;

    const filtered = this.buildFilteredData(data);
    this.plot.setData(filtered as uPlot.AlignedData, false);

    if (live && data[0] && data[0].length > 0) {
      const latestT = data[0][data[0].length - 1]!;
      this.plot.setScale("x", {
        min: latestT - windowDurationSec,
        max: latestT,
      });
    }
  }

  /** Handle container resize. */
  resize(): void {
    if (!this.plot) return;
    const { width, height } = this.chartEl.getBoundingClientRect();
    if (width > 0 && height > 0) {
      this.plot.setSize({ width, height });
    }
  }

  /** Destroy uPlot instance and detach all listeners. */
  destroy(): void {
    this.resizeObserver.disconnect();
    this.detachZoomPan();
    if (this.plot) {
      this.plot.destroy();
      this.plot = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Zoom / Pan
  // ---------------------------------------------------------------------------

  private attachZoomPan(): void {
    if (!this.plot) return;
    const over = this.plot.over;

    this.boundWheel = (e: WheelEvent) => this.handleWheel(e);
    this.boundMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
    this.boundMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
    this.boundMouseUp = () => this.handleMouseUp();
    this.boundDblClick = () => this.handleDblClick();

    over.addEventListener("wheel", this.boundWheel, { passive: false });
    over.addEventListener("mousedown", this.boundMouseDown);
    window.addEventListener("mousemove", this.boundMouseMove);
    window.addEventListener("mouseup", this.boundMouseUp);
    over.addEventListener("dblclick", this.boundDblClick);

    over.style.cursor = "crosshair";
  }

  private detachZoomPan(): void {
    if (!this.plot) return;
    const over = this.plot.over;

    if (this.boundWheel) over.removeEventListener("wheel", this.boundWheel);
    if (this.boundMouseDown) over.removeEventListener("mousedown", this.boundMouseDown);
    if (this.boundMouseMove) window.removeEventListener("mousemove", this.boundMouseMove);
    if (this.boundMouseUp) window.removeEventListener("mouseup", this.boundMouseUp);
    if (this.boundDblClick) over.removeEventListener("dblclick", this.boundDblClick);

    this.boundWheel = null;
    this.boundMouseDown = null;
    this.boundMouseMove = null;
    this.boundMouseUp = null;
    this.boundDblClick = null;
  }

  /** Mouse wheel → zoom X-axis centered on cursor position. */
  private handleWheel(e: WheelEvent): void {
    if (!this.plot) return;
    const xScale = this.plot.scales.x;
    if (xScale?.min == null || xScale?.max == null) return;
    e.preventDefault();

    const min = xScale.min;
    const max = xScale.max;
    const cursorT = this.plot.posToVal(e.offsetX, "x");

    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    const newMin = cursorT - (cursorT - min) * factor;
    const newMax = cursorT + (max - cursorT) * factor;

    this.plot.setScale("x", { min: newMin, max: newMax });
    this.callbacks.onExitLive();
  }

  /** Mouse down → start drag pan. */
  private handleMouseDown(e: MouseEvent): void {
    if (!this.plot || e.button !== 0) return;
    const xScale = this.plot.scales.x;
    if (xScale?.min == null || xScale?.max == null) return;
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartMin = xScale.min;
    this.dragStartMax = xScale.max;
    this.plot.over.style.cursor = "grabbing";
  }

  /** Mouse move → drag pan X-axis. */
  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging || !this.plot) return;

    const dx = e.clientX - this.dragStartX;
    // Convert pixel delta to time delta
    const pxRange = this.plot.bbox.width / devicePixelRatio;
    const timeRange = this.dragStartMax - this.dragStartMin;
    const timeDelta = -(dx / pxRange) * timeRange;

    this.plot.setScale("x", {
      min: this.dragStartMin + timeDelta,
      max: this.dragStartMax + timeDelta,
    });
    this.callbacks.onExitLive();
  }

  /** Mouse up → end drag pan. */
  private handleMouseUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.plot) {
      this.plot.over.style.cursor = "crosshair";
    }
  }

  /** Double-click → reset to live mode. */
  private handleDblClick(): void {
    this.savedXRange = null;
    this.callbacks.onResetToLive();
  }

  /** Save current X range before chart rebuild (for zoom preservation). */
  private saveCurrentXRange(): void {
    if (!this.plot) return;
    const xScale = this.plot.scales.x;
    if (xScale?.min != null && xScale?.max != null) {
      this.savedXRange = { min: xScale.min, max: xScale.max };
    }
  }

  // ---------------------------------------------------------------------------
  // Chart building
  // ---------------------------------------------------------------------------

  private rebuildChart(data: number[][]): void {
    this.detachZoomPan();
    if (this.plot) {
      this.plot.destroy();
      this.plot = null;
    }

    // Determine visible traces and their indices
    const visibleTraces: { trace: TraceDefinition; colIndex: number }[] = [];
    for (let i = 0; i < this.traces.length; i++) {
      const t = this.traces[i]!;
      if (this.visibleTraceIds.has(t.id)) {
        visibleTraces.push({ trace: t, colIndex: i + 1 });
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

    // Build series config
    const series: uPlot.Series[] = [{}];

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
      {
        stroke: "#666",
        grid: { stroke: "#2a2a2a", width: 1 },
        ticks: { stroke: "#333", width: 1 },
        font: "10px system-ui, sans-serif",
      },
    ];

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
        side: 3,
      });
    }

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
        side: 1,
      });
    }

    // Scales — X auto is false, we control it manually
    const scales: uPlot.Scales = {
      x: { time: true, auto: false },
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

    // Restore saved zoom state after rebuild
    if (this.savedXRange) {
      this.plot.setScale("x", this.savedXRange);
      this.savedXRange = null;
    } else if (data[0] && data[0].length > 0) {
      // Default: show all data
      const tMin = data[0][0]!;
      const tMax = data[0][data[0].length - 1]!;
      this.plot.setScale("x", { min: tMin, max: tMax });
    }

    this.attachZoomPan();
  }

  /** Build data arrays containing only visible trace columns. */
  private buildFilteredData(data: number[][]): number[][] {
    if (data.length === 0 || !data[0]?.length) {
      const empty: number[][] = [[]];
      for (const _ of this.traceToCol) empty.push([]);
      return empty;
    }

    const result: number[][] = [data[0]!];
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
