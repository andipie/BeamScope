import type { CollimatorState } from "../state/CollimatorState.js";
import type { CollimatorConfig } from "../config/types.js";
import { drawEdgeLines, drawEdgeLabels } from "./BEVAnnotations.js";
import { BEVLegend } from "./BEVLegend.js";
import { computeFieldRect, computePCProjection, computeRawJawField } from "../geometry/fieldRect.js";
import { computeFieldPolygon } from "../geometry/fieldPolygon.js";
import { projectToDetector } from "../geometry/projection.js";

/** Convert degrees to radians (avoids importing Three.js into pure Canvas code). */
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 2D Beam's Eye View renderer using the Canvas 2D API.
 *
 * Renders a top-down projection of the beam field onto the detector plane:
 * - Background grid (50 mm spacing)
 * - Coordinate axes (X horizontal, Z vertical)
 * - Primary collimator outline (dashed)
 * - Per-jaw-module aperture lines (dashed, in module-local frame)
 * - Combined field rectangle (cyan fill + border)
 * - Wedge filter orientation indicator (when enabled)
 * - Central beam crosshair at (0, 0)
 * - Axis tick labels (adaptive spacing) and axis names (X, Z)
 * - Field size text overlay ("W × H mm @ detector")
 *
 * Coordinate system: origin at canvas centre = central beam axis,
 * X → right, Z → up (matching the 3D lateral axes).
 * Base scale: ±700 mm visible at 1× zoom (dynamic: min(w,h)/1400 px/mm).
 *
 * Interaction (US-22):
 * - Mouse wheel: zoom in/out, centred on cursor
 * - Left-click drag: pan
 * - Double-click: reset zoom & pan
 */
export class BEVRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly legend: BEVLegend;

  // --- Zoom / pan state (US-22) ---
  private zoomLevel = 1.0;
  private panX = 0; // pixel offset from canvas centre
  private panY = 0; // pixel offset from canvas centre
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Cached state for re-rendering from interaction handlers (independent of state updates)
  private lastState: CollimatorState | null = null;
  private lastConfig: CollimatorConfig | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context from BEV canvas");
    this.ctx = ctx;
    this.legend = new BEVLegend(canvas.parentElement!);
    this.attachInteraction();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Called on every state update. Caches state and delegates to doRender(). */
  render(state: CollimatorState, config: CollimatorConfig): void {
    this.lastState = state;
    this.lastConfig = config;
    this.doRender(state, config);
  }

  /** Called when a new config is loaded. Updates the BEV legend. */
  onConfigLoaded(config: CollimatorConfig): void {
    this.legend.update(config);
  }

  /** Reset zoom and pan to default (1×, centred). */
  resetView(): void {
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    if (this.lastState && this.lastConfig) {
      this.doRender(this.lastState, this.lastConfig);
    }
  }

  // ---------------------------------------------------------------------------
  // Interaction setup (US-22)
  // ---------------------------------------------------------------------------

  private attachInteraction(): void {
    // --- Wheel: zoom to cursor position ---
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;

        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZoom = Math.max(0.1, Math.min(20, this.zoomLevel * factor));
        const ratio = newZoom / this.zoomLevel;

        // Keep the mm-point under the cursor fixed:
        // newPan = cursorFromCentre * (1 - ratio) + oldPan * ratio
        this.panX = (mx - cw / 2) * (1 - ratio) + this.panX * ratio;
        this.panY = (my - ch / 2) * (1 - ratio) + this.panY * ratio;
        this.zoomLevel = newZoom;

        if (this.lastState && this.lastConfig) {
          this.doRender(this.lastState, this.lastConfig);
        }
      },
      { passive: false },
    );

    // --- Left-click drag: pan ---
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.canvas.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      this.panX += e.clientX - this.lastMouseX;
      this.panY += e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (this.lastState && this.lastConfig) {
        this.doRender(this.lastState, this.lastConfig);
      }
    });

    window.addEventListener("mouseup", () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.canvas.style.cursor = "";
    });

    // --- Double-click: reset view ---
    this.canvas.addEventListener("dblclick", () => this.resetView());
  }

  // ---------------------------------------------------------------------------
  // Internal render
  // ---------------------------------------------------------------------------

  /** Full BEV redraw. Called by render() and by interaction handlers. */
  private doRender(state: CollimatorState, config: CollimatorConfig): void {
    const { width, height } = this.resizeToContainer();
    this.ctx.clearRect(0, 0, width, height);
    if (width === 0 || height === 0) return;

    const baseScale = Math.min(width, height) / 1400;
    const effectiveScale = baseScale * this.zoomLevel;
    const ctx = this.ctx;

    // --- mm-coordinate transform (origin = canvas centre + pan offset, +Z upward) ---
    ctx.save();
    ctx.translate(width / 2 + this.panX, height / 2 + this.panY);
    ctx.scale(effectiveScale, -effectiveScale);

    // Fixed elements (not affected by collimator rotation)
    this.drawGrid(effectiveScale, width, height);
    this.drawAxes(effectiveScale, width, height);

    // Field elements — rotated by collimator_rotation_deg
    ctx.save();
    ctx.rotate(-degToRad(state.collimator_rotation_deg));

    this.drawPrimaryCollimator(state, config, effectiveScale);
    this.drawJawApertures(state, config, effectiveScale, width, height);
    this.drawFieldPolygon(state, config, effectiveScale);
    this.drawWedgeIndicator(state, config, effectiveScale);
    drawEdgeLines(ctx, state, config, effectiveScale); // US-21: colored edge lines on top of polygon

    ctx.restore(); // undo collimator rotation

    // Crosshair always at origin (no collimator rotation)
    this.drawCrossHair(effectiveScale);

    ctx.restore(); // undo mm transform

    // Pixel-space overlays (drawn after all transforms are undone)
    this.drawAxisLabels(width, height, effectiveScale);
    this.drawFieldSizeText(state, config);
    this.drawGizmo(width, height);

    // US-21: edge labels, distance arrows, angle annotations (pixel-space text)
    drawEdgeLabels({
      ctx,
      state,
      config,
      scale: effectiveScale,
      collimatorRotRad: degToRad(state.collimator_rotation_deg),
      panX: this.panX,
      panY: this.panY,
      canvasWidth: width,
      canvasHeight: height,
    });
  }

  // ---------------------------------------------------------------------------
  // Private draw helpers
  // ---------------------------------------------------------------------------

  /**
   * Light background grid at 50 mm intervals.
   * Extent is computed dynamically to cover the full canvas even after pan/zoom.
   */
  private drawGrid(scale: number, width: number, height: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([]);

    const extent = this.visibleExtent(scale, width, height);
    for (let v = -extent; v <= extent; v += 50) {
      ctx.beginPath();
      ctx.moveTo(-extent, v);
      ctx.lineTo(extent, v);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(v, -extent);
      ctx.lineTo(v, extent);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Faint X and Z axis lines through the origin. */
  private drawAxes(scale: number, width: number, height: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([]);

    const extent = this.visibleExtent(scale, width, height);
    ctx.beginPath();
    ctx.moveTo(-extent, 0);
    ctx.lineTo(extent, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -extent);
    ctx.lineTo(0, extent);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws the primary collimator projected to the detector plane.
   *
   * Normal (no clipping): dashed white aperture outline.
   * Clipping detected: aperture outline turns red + semi-transparent red fill
   * in the regions where the jaw field extends beyond the PC aperture (rect PC only).
   *
   * Clipping is determined by comparing the raw jaw field (without PC constraint)
   * against the PC aperture projection, with 0.5 mm float tolerance.
   */
  private drawPrimaryCollimator(
    state: CollimatorState,
    config: CollimatorConfig,
    scale: number,
  ): void {
    const ctx = this.ctx;
    const pc = config.primary_collimator;
    const pcScale = state.sid / pc.fld_mm;

    const pcProj = computePCProjection(state, config);
    const rawJaw = computeRawJawField(state, config);

    const clipped =
      rawJaw.x1 < pcProj.x1 - 0.5 ||
      rawJaw.x2 > pcProj.x2 + 0.5 ||
      rawJaw.z1 < pcProj.z1 - 0.5 ||
      rawJaw.z2 > pcProj.z2 + 0.5;

    // --- Red overflow fill (rect PC only, finite jaw bounds) ---
    if (clipped && pc.shape === "rect" && isFinite(rawJaw.x1) && isFinite(rawJaw.x2)) {
      const hw = (pc.size.x / 2) * pcScale;
      const hh = (pc.size.y / 2) * pcScale;
      // Use jaw bounds clamped to a reasonable extent so fills don't overflow the canvas
      const jx1 = Math.max(rawJaw.x1, -hw * 4);
      const jx2 = Math.min(rawJaw.x2, hw * 4);
      const jz1 = isFinite(rawJaw.z1) ? Math.max(rawJaw.z1, -hh * 4) : -hh;
      const jz2 = isFinite(rawJaw.z2) ? Math.min(rawJaw.z2, hh * 4) : hh;

      ctx.save();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(220,40,40,0.35)";

      if (rawJaw.x1 < -hw) ctx.fillRect(jx1, jz1, -hw - jx1, jz2 - jz1);
      if (rawJaw.x2 > hw) ctx.fillRect(hw, jz1, jx2 - hw, jz2 - jz1);
      if (isFinite(rawJaw.z1) && rawJaw.z1 < -hh) ctx.fillRect(-hw, jz1, hw * 2, -hh - jz1);
      if (isFinite(rawJaw.z2) && rawJaw.z2 > hh) ctx.fillRect(-hw, hh, hw * 2, jz2 - hh);

      ctx.restore();
    }

    // --- PC aperture outline ---
    ctx.save();
    ctx.strokeStyle = clipped ? "rgba(220,60,60,0.9)" : "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([8 / scale, 4 / scale]);

    if (pc.shape === "circle" || pc.shape === "ellipse") {
      const r = (pc.radius_mm ?? pc.size.x / 2) * pcScale;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 2 * Math.PI);
      ctx.stroke();
    } else {
      const hw = (pc.size.x / 2) * pcScale;
      const hh = (pc.size.y / 2) * pcScale;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    }
    ctx.restore();
  }

  /**
   * Draws the aperture lines (leaf positions) for each jaw module.
   * Lines extend across the full visible extent (infinite appearance).
   * In the y-flipped canvas (scale(s,-s)), ctx.rotate(-θ) reproduces
   * the Three.js Y-rotation convention, matching computeFieldPolygon().
   */
  private drawJawApertures(
    state: CollimatorState,
    config: CollimatorConfig,
    scale: number,
    width: number,
    height: number,
  ): void {
    const ctx = this.ctx;
    const sid = state.sid;
    const extent = this.visibleExtent(scale, width, height);

    for (const modConfig of config.modules) {
      if (!["jaws_rect", "jaws_square", "jaws_asymmetric"].includes(modConfig.type)) continue;
      const modState = state.modules[modConfig.id];
      if (!modState) continue;

      const fld = modState.fld_mm ?? modConfig.fld_mm;
      const leaf1 = typeof modState["leaf1"] === "number" ? (modState["leaf1"] as number) : 0;
      const leaf2 = typeof modState["leaf2"] === "number" ? (modState["leaf2"] as number) : 0;
      const d1 = projectToDetector(leaf1, sid, fld);
      const d2 = projectToDetector(leaf2, sid, fld);

      const modRot = (modConfig.rotation_deg ?? 0) + modState.rotation_deg;

      ctx.save();
      ctx.rotate(-degToRad(modRot));
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5 / scale;

      ctx.beginPath();
      ctx.moveTo(d1, -extent);
      ctx.lineTo(d1, extent);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(d2, -extent);
      ctx.lineTo(d2, extent);
      ctx.stroke();

      ctx.restore();

      // jaws_square: pair 2 at +90° with the same aperture values
      if (modConfig.type === "jaws_square") {
        ctx.save();
        ctx.rotate(-degToRad(modRot + 90));
        ctx.setLineDash([6 / scale, 4 / scale]);
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1.5 / scale;

        ctx.beginPath();
        ctx.moveTo(d1, -extent);
        ctx.lineTo(d1, extent);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(d2, -extent);
        ctx.lineTo(d2, extent);
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  /** Filled + bordered polygon showing the effective combined beam field at the detector. */
  private drawFieldPolygon(
    state: CollimatorState,
    config: CollimatorConfig,
    scale: number,
  ): void {
    const ctx = this.ctx;
    const poly = computeFieldPolygon(state, config);
    if (poly.length < 3) return;

    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(poly[0]!.x, poly[0]!.z);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i]!.x, poly[i]!.z);
    }
    ctx.closePath();

    ctx.fillStyle = "rgba(0,255,238,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,255,238,0.75)";
    ctx.lineWidth = 2 / scale;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws the projected rectangular footprint of each enabled wedge module.
   *
   * A wedge filter is a physical slab in the beam path. From the beam's eye view it
   * casts a rectangular shadow. The rectangle is projected from the leaf plane to the
   * detector plane (pos_detector = pos_leaf × SID / FLD) and shifted by lateral_offset_mm.
   *
   * Visual constants must match WedgeObject.ts WEDGE_LENGTH / WEDGE_WIDTH.
   */
  private drawWedgeIndicator(
    state: CollimatorState,
    config: CollimatorConfig,
    scale: number,
  ): void {
    const ctx = this.ctx;
    // Must stay in sync with WedgeObject.ts
    const WEDGE_LENGTH = 380;
    const WEDGE_WIDTH = 70;

    for (const modConfig of config.modules) {
      if (modConfig.type !== "wedge") continue;
      const modState = state.modules[modConfig.id];
      if (!modState) continue;

      // enabled: dynamic state → config default → true
      const enabledRaw = modState["enabled"];
      const enabledCfg = modConfig["enabled"];
      const enabled =
        typeof enabledRaw === "boolean"
          ? enabledRaw
          : typeof enabledCfg === "boolean"
            ? enabledCfg
            : true;
      if (!enabled) continue;

      const lateralOffsetRaw = modState["lateral_offset_mm"];
      const lateralOffsetCfg = modConfig["lateral_offset_mm"];
      const lateralOffset =
        typeof lateralOffsetRaw === "number"
          ? (lateralOffsetRaw as number)
          : typeof lateralOffsetCfg === "number"
            ? (lateralOffsetCfg as number)
            : 0;

      // Project wedge footprint to detector plane
      const fld = modState.fld_mm ?? modConfig.fld_mm;
      const projScale = state.sid / fld;
      const hw = (WEDGE_LENGTH / 2) * projScale; // half-length at detector
      const hd = (WEDGE_WIDTH / 2) * projScale;  // half-width at detector

      // Project lateral offset to detector plane
      const projOffset = lateralOffset * projScale;

      // Total rotation in collimator frame: module base + dynamic rotation (no orientation)
      const wedgeModRot = (modConfig.rotation_deg ?? 0) + modState.rotation_deg;
      ctx.save();
      ctx.rotate(-degToRad(wedgeModRot));
      // Translate by projected lateral offset in local Y (canvas local Y = -Z in mm frame due to y-flip)
      ctx.translate(0, -projOffset);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(230,126,34,0.2)";
      ctx.fillRect(-hw, -hd, hw * 2, hd * 2);
      ctx.strokeStyle = "rgba(230,126,34,0.9)";
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(-hw, -hd, hw * 2, hd * 2);
      ctx.restore();
    }
  }

  /** Small crosshair (+) at the central beam origin (0, 0). */
  private drawCrossHair(scale: number): void {
    const ctx = this.ctx;
    const arm = 20 / scale; // 20 px equivalent in mm coordinates
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5 / scale;
    ctx.beginPath();
    ctx.moveTo(-arm, 0);
    ctx.lineTo(arm, 0);
    ctx.moveTo(0, -arm);
    ctx.lineTo(0, arm);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws axis tick labels and axis name labels (X, Z).
   * Called in pixel space (after all canvas transforms are undone).
   *
   * Tick interval adapts to zoom so labels remain readable:
   * target spacing ~70 px between ticks → pick smallest standard interval ≥ 70/effectiveScale mm.
   * Only ticks within the visible canvas area are drawn.
   */
  private drawAxisLabels(width: number, height: number, scale: number): void {
    const ctx = this.ctx;

    // Pixel coordinates of the mm-origin (accounts for pan)
    const ox = width / 2 + this.panX;
    const oy = height / 2 + this.panY;

    // Adaptive tick interval (aim for ~70 px between ticks)
    const rawInterval = 70 / scale;
    const tickInterval =
      [10, 20, 50, 100, 200, 500, 1000].find((v) => v >= rawInterval) ?? 1000;

    // Visible mm ranges.
    // X: px = ox + mm*scale → visible when 0 ≤ px ≤ width → mm ∈ [(-panX-w/2)/s, (-panX+w/2)/s]
    const xMinMm = (-this.panX - width / 2) / scale;
    const xMaxMm = (-this.panX + width / 2) / scale;
    // Z: py = oy - mm*scale (Z up = screen up) → visible when 0 ≤ py ≤ height
    //    → mm ∈ [(panY - h/2)/s, (panY + h/2)/s]
    const zMinMm = (this.panY - height / 2) / scale;
    const zMaxMm = (this.panY + height / 2) / scale;

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "10px system-ui, sans-serif";

    // X-axis ticks: labels just below the axis line
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xStart = Math.ceil(xMinMm / tickInterval) * tickInterval;
    for (let mm = xStart; mm <= xMaxMm; mm += tickInterval) {
      if (mm === 0) continue;
      const px = ox + mm * scale;
      if (px < 0 || px > width) continue;
      ctx.fillText(String(mm), px, oy + 5);
    }

    // Z-axis ticks: labels to the right of the axis line (+Z is up → py decreases)
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const zStart = Math.ceil(zMinMm / tickInterval) * tickInterval;
    for (let mm = zStart; mm <= zMaxMm; mm += tickInterval) {
      if (mm === 0) continue;
      const py = oy - mm * scale; // Z up → subtract
      if (py < 0 || py > height) continue;
      ctx.fillText(String(mm), ox + 5, py);
    }

    // Axis name labels (fixed position at canvas edge)
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("X", width - 6, oy);

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("Z", ox, 4);

    ctx.restore();
  }

  /** "W × H mm @ detector" text in the top-left corner of the BEV panel. */
  private drawFieldSizeText(state: CollimatorState, config: CollimatorConfig): void {
    const ctx = this.ctx;
    const { x1, x2, z1, z2 } = computeFieldRect(state, config);
    const fw = Math.max(0, x2 - x1).toFixed(1);
    const fh = Math.max(0, z2 - z1).toFixed(1);

    ctx.save();
    ctx.fillStyle = "rgba(0,255,238,0.85)";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${fw} \u00d7 ${fh} mm @ detector`, 8, 8);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Computes the mm extent needed to cover the full canvas at the current
   * zoom/pan level — used by drawGrid() and drawAxes().
   */
  private visibleExtent(scale: number, width: number, height: number): number {
    const halfWmm = (width / 2 + Math.abs(this.panX)) / scale + 50;
    const halfHmm = (height / 2 + Math.abs(this.panY)) / scale + 50;
    return Math.ceil(Math.max(halfWmm, halfHmm) / 50) * 50;
  }

  /**
   * Draws a small coordinate axes gizmo in the bottom-left corner of the BEV canvas.
   * X → right (red), Z → up (blue). The BEV shows the XZ plane (Y = beam axis into screen).
   */
  private drawGizmo(width: number, height: number): void {
    const ctx = this.ctx;
    const cx = 36;           // centre of gizmo, pixels from left
    const cy = height - 36;  // centre of gizmo, pixels from top
    const arm = 24;          // arrow length in pixels

    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = "bold 11px system-ui, sans-serif";

    // X-axis → right (red)
    ctx.strokeStyle = "#ff5555";
    ctx.fillStyle = "#ff5555";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.stroke();
    ctx.fillText("X", cx + arm + 3, cy + 4);

    // Z-axis → up on screen (blue)
    ctx.strokeStyle = "#5599ff";
    ctx.fillStyle = "#5599ff";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - arm);
    ctx.stroke();
    ctx.fillText("Z", cx - 4, cy - arm - 4);

    ctx.restore();
  }

  /** Resize canvas buffer to match its CSS display size. Returns {width, height}. */
  private resizeToContainer(): { width: number; height: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { width: w, height: h };
  }
}
