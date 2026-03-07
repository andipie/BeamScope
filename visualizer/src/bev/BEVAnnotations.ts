import type { CollimatorState } from "../state/CollimatorState.js";
import type { CollimatorConfig } from "../config/types.js";
import { projectToDetector } from "../geometry/projection.js";
import { computePCProjection } from "../geometry/fieldRect.js";
import { leafColorCSS } from "../utils/moduleColor.js";
import type { LeafName } from "../utils/moduleColor.js";

/** Convert degrees to radians. */
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Edge data collection
// ---------------------------------------------------------------------------

export interface LeafEdgeInfo {
  moduleId: string;
  leafName: LeafName;
  label: string;           // e.g. "jaws_x · L1"
  posDetector: number;     // projected position at detector (mm)
  modRotDeg: number;       // module rotation in degrees (within collimator frame)
  modRotRad: number;       // module rotation in radians
  color: string;           // CSS color string
  isClipped: boolean;      // true if this edge is clipped by PC
}

/**
 * Collects edge info for all jaw leaves from config + state.
 * PC clipping is detected by projecting the edge point into the global frame
 * and testing against the PC aperture AABB.
 */
export function collectEdges(state: CollimatorState, config: CollimatorConfig): LeafEdgeInfo[] {
  const edges: LeafEdgeInfo[] = [];
  const sid = state.sid;
  const pcProj = computePCProjection(state, config);

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
    const modRotRad = degToRad(modRot);

    const isClipped1 = isEdgeClippedByPC(d1, modRotRad, pcProj);
    const isClipped2 = isEdgeClippedByPC(d2, modRotRad, pcProj);

    edges.push({
      moduleId: modConfig.id,
      leafName: "leaf1",
      label: `${modConfig.id} \u00b7 L1`,
      posDetector: d1,
      modRotDeg: modRot,
      modRotRad,
      color: leafColorCSS(modConfig.id, "leaf1"),
      isClipped: isClipped1,
    });
    edges.push({
      moduleId: modConfig.id,
      leafName: "leaf2",
      label: `${modConfig.id} \u00b7 L2`,
      posDetector: d2,
      modRotDeg: modRot,
      modRotRad,
      color: leafColorCSS(modConfig.id, "leaf2"),
      isClipped: isClipped2,
    });

    // jaws_square: pair 2 at +90° with the same aperture values
    if (modConfig.type === "jaws_square") {
      const modRot90 = modRot + 90;
      const modRotRad90 = degToRad(modRot90);
      const isClipped3 = isEdgeClippedByPC(d1, modRotRad90, pcProj);
      const isClipped4 = isEdgeClippedByPC(d2, modRotRad90, pcProj);

      edges.push({
        moduleId: modConfig.id,
        leafName: "leaf3",
        label: `${modConfig.id} \u00b7 L3`,
        posDetector: d1,
        modRotDeg: modRot90,
        modRotRad: modRotRad90,
        color: leafColorCSS(modConfig.id, "leaf3"),
        isClipped: isClipped3,
      });
      edges.push({
        moduleId: modConfig.id,
        leafName: "leaf4",
        label: `${modConfig.id} \u00b7 L4`,
        posDetector: d2,
        modRotDeg: modRot90,
        modRotRad: modRotRad90,
        color: leafColorCSS(modConfig.id, "leaf4"),
        isClipped: isClipped4,
      });
    }
  }
  return edges;
}

/**
 * Approximate PC clipping: transforms edge position from module-local to
 * collimator-global frame and checks against AABB of PC projection.
 */
export function isEdgeClippedByPC(
  posDetector: number,
  modRotRad: number,
  pcProj: { x1: number; x2: number; z1: number; z2: number },
): boolean {
  const cosR = Math.cos(modRotRad);
  const sinR = Math.sin(modRotRad);
  // Edge point in collimator frame (matching Three.js Y-rotation convention)
  const gx = posDetector * cosR;
  const gz = -posDetector * sinR;
  const TOL = 0.5;
  return (
    gx < pcProj.x1 + TOL || gx > pcProj.x2 - TOL ||
    gz < pcProj.z1 + TOL || gz > pcProj.z2 - TOL
  );
}

// ---------------------------------------------------------------------------
// Phase 1: Edge Lines (drawn in mm-space, inside collimator rotation)
// ---------------------------------------------------------------------------

/**
 * Draws colored edge lines for each jaw leaf in the BEV.
 * Must be called inside the mm-transform + collimator-rotation save/restore block.
 * Lines are drawn ON TOP of the field polygon (call after drawFieldPolygon).
 */
export function drawEdgeLines(
  ctx: CanvasRenderingContext2D,
  state: CollimatorState,
  config: CollimatorConfig,
  scale: number,
): void {
  const edges = collectEdges(state, config);
  const extent = 2000; // large enough to always cover viewport

  for (const edge of edges) {
    ctx.save();
    ctx.rotate(-edge.modRotRad); // match BEV rotation convention (negated due to Y-flip)

    ctx.strokeStyle = edge.color;
    ctx.lineWidth = (edge.isClipped ? 1.5 : 2.5) / scale;
    ctx.setLineDash(edge.isClipped ? [6 / scale, 4 / scale] : []);
    ctx.globalAlpha = edge.isClipped ? 0.5 : 0.85;

    ctx.beginPath();
    ctx.moveTo(edge.posDetector, -extent);
    ctx.lineTo(edge.posDetector, extent);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Edge Labels + Annotations (drawn in pixel-space)
// ---------------------------------------------------------------------------

export interface EdgeAnnotationContext {
  ctx: CanvasRenderingContext2D;
  state: CollimatorState;
  config: CollimatorConfig;
  scale: number;
  collimatorRotRad: number;
  panX: number;
  panY: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Converts mm-space coordinates (in module-local frame) to pixel-space coordinates.
 * Applies module rotation → collimator rotation → scale+pan → pixel.
 */
export function mmToPixel(
  xMm: number,
  zMm: number,
  modRotRad: number,
  collimatorRotRad: number,
  scale: number,
  centerX: number,
  centerY: number,
  panX: number,
  panY: number,
): [number, number] {
  // Apply module rotation (negated to match BEV canvas convention)
  const mr = -modRotRad;
  let x = xMm * Math.cos(mr) - zMm * Math.sin(mr);
  let z = xMm * Math.sin(mr) + zMm * Math.cos(mr);

  // Apply collimator rotation (negated)
  const cr = -collimatorRotRad;
  const gx = x * Math.cos(cr) - z * Math.sin(cr);
  const gz = x * Math.sin(cr) + z * Math.cos(cr);

  // Apply scale (with Y-flip: gz → -gz) and translation
  const px = centerX + panX + gx * scale;
  const py = centerY + panY - gz * scale;
  return [px, py];
}

// ---------------------------------------------------------------------------
// Styled label box helpers (matching 3D CSS2D .jaw-leaf-label style)
// ---------------------------------------------------------------------------

/** Draw a rounded rectangle path (does not fill or stroke). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Draws a styled label box (dark background + colored border) and returns
 * its bounding rect. Visual style matches the 3D CSS2D .jaw-leaf-label boxes.
 */
function drawStyledLabelBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  borderColor: string,
  alpha: number,
): BoxRect {
  ctx.save();
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.globalAlpha = alpha;

  const tm = ctx.measureText(text);
  const padX = 6;
  const padY = 3;
  const w = tm.width + padX * 2;
  const h = 12 + padY * 2;
  const left = cx - w / 2;
  const top = cy - h / 2;
  const r = 3;

  // Dark background
  ctx.fillStyle = "rgba(15, 15, 15, 0.88)";
  roundRectPath(ctx, left, top, w, h, r);
  ctx.fill();

  // Colored border
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  roundRectPath(ctx, left, top, w, h, r);
  ctx.stroke();

  // Light text
  ctx.fillStyle = "#e0e0e0";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);

  ctx.restore();
  return { left, top, width: w, height: h };
}

/** Check if two box rects overlap (with optional margin). */
function boxesOverlap(a: BoxRect, b: BoxRect, margin = 4): boolean {
  return !(
    a.left + a.width + margin < b.left ||
    b.left + b.width + margin < a.left ||
    a.top + a.height + margin < b.top ||
    b.top + b.height + margin < a.top
  );
}

/**
 * Draws styled edge-label boxes with connecting lines and angle annotations.
 * Each box shows "{moduleId} · L1/L2  ±value" in a dark panel with colored
 * border, connected to its edge by a thin line — matching the 3D label style.
 * Called after all canvas transforms are restored (in pixel coordinates).
 */
export function drawEdgeLabels(params: EdgeAnnotationContext): void {
  const { ctx, state, config, scale, collimatorRotRad, panX, panY, canvasWidth, canvasHeight } =
    params;
  const edges = collectEdges(state, config);
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  const placedBoxes: BoxRect[] = [];
  const BOX_OFFSET = 45;   // px distance from edge to box center
  const NUDGE_STEP = 22;   // px nudge increment for collision avoidance

  for (const edge of edges) {
    // Compute edge pixel position (at z=0 in module-local coords)
    const [edgePx, edgePy] = mmToPixel(
      edge.posDetector, 0,
      edge.modRotRad, collimatorRotRad,
      scale, centerX, centerY, panX, panY,
    );

    // Origin in pixel space
    const [originPx, originPy] = mmToPixel(
      0, 0,
      edge.modRotRad, collimatorRotRad,
      scale, centerX, centerY, panX, panY,
    );

    // Direction from origin to edge (outward)
    const dx = edgePx - originPx;
    const dy = edgePy - originPy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) continue;
    const nx = dx / len;
    const ny = dy / len;

    const alpha = edge.isClipped ? 0.5 : 1.0;

    // --- Compose label text: "jaws_x · L1  +52.3" ---
    const sign = edge.posDetector >= 0 ? "+" : "\u2212";
    const mmText = `${sign}${Math.abs(edge.posDetector).toFixed(1)}`;
    const labelText = `${edge.label}  ${mmText}`;

    // --- Compute box position (offset outward from edge) ---
    let boxCx = edgePx + nx * BOX_OFFSET;
    let boxCy = edgePy + ny * BOX_OFFSET;

    // Measure box dimensions for collision check
    ctx.save();
    ctx.font = "bold 10px system-ui, sans-serif";
    const tm = ctx.measureText(labelText);
    ctx.restore();
    const boxW = tm.width + 12;
    const boxH = 18;

    // Collision avoidance: nudge further outward if overlapping
    let candidate: BoxRect = {
      left: boxCx - boxW / 2, top: boxCy - boxH / 2,
      width: boxW, height: boxH,
    };
    let nudgeCount = 0;
    while (placedBoxes.some((b) => boxesOverlap(candidate, b)) && nudgeCount < 5) {
      nudgeCount++;
      const adj = BOX_OFFSET + NUDGE_STEP * nudgeCount;
      boxCx = edgePx + nx * adj;
      boxCy = edgePy + ny * adj;
      candidate = {
        left: boxCx - boxW / 2, top: boxCy - boxH / 2,
        width: boxW, height: boxH,
      };
    }

    // --- Small anchor dot at edge ---
    ctx.save();
    ctx.fillStyle = edge.color;
    ctx.globalAlpha = alpha * 0.7;
    ctx.beginPath();
    ctx.arc(edgePx, edgePy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- Connecting line from edge to box ---
    ctx.save();
    ctx.strokeStyle = edge.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = alpha * 0.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(edgePx, edgePy);
    ctx.lineTo(boxCx, boxCy);
    ctx.stroke();
    ctx.restore();

    // --- Draw styled label box (on top of connecting line) ---
    const box = drawStyledLabelBox(ctx, labelText, boxCx, boxCy, edge.color, alpha);
    placedBoxes.push(box);

    // --- Angle annotation (only for rotated modules, once per module on leaf1) ---
    if (edge.leafName === "leaf1" && Math.abs(edge.modRotDeg) > 0.1) {
      const angleDeg = ((edge.modRotDeg % 360) + 360) % 360;
      ctx.save();
      ctx.strokeStyle = edge.color;
      ctx.fillStyle = edge.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);

      // Small arc near origin showing rotation angle
      const arcRadius = 25;
      const endAngleRad = degToRad(angleDeg);

      ctx.beginPath();
      ctx.arc(
        originPx, originPy, arcRadius,
        -endAngleRad - collimatorRotRad,
        -collimatorRotRad,
        false,
      );
      ctx.stroke();

      // Angle text
      ctx.font = "8px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const textAngle = (-endAngleRad / 2) - collimatorRotRad;
      const textR = arcRadius + 10;
      ctx.fillText(
        `${angleDeg.toFixed(0)}\u00b0`,
        originPx + textR * Math.cos(textAngle),
        originPy + textR * Math.sin(textAngle),
      );
      ctx.restore();
    }
  }
}
