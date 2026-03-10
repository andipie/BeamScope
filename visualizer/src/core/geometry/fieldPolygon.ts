import type { CollimatorState } from "../state/CollimatorState.js";
import type { CollimatorConfig } from "../config/types.js";
import { projectToDetector } from "./projection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Half-plane in 2D (detector XZ plane).
 * All points P satisfying  nx*(P.x - px) + nz*(P.z - pz) >= 0  are "inside".
 */
interface HalfPlane {
  nx: number;
  nz: number;
  px: number;
  pz: number;
}

// ---------------------------------------------------------------------------
// Sutherland-Hodgman polygon clipping against a single half-plane
// ---------------------------------------------------------------------------

function dot(plane: HalfPlane, p: Vec2): number {
  return plane.nx * (p.x - plane.px) + plane.nz * (p.z - plane.pz);
}

function intersect(a: Vec2, b: Vec2, plane: HalfPlane): Vec2 {
  const dA = dot(plane, a);
  const dB = dot(plane, b);
  const t = dA / (dA - dB);
  return {
    x: a.x + t * (b.x - a.x),
    z: a.z + t * (b.z - a.z),
  };
}

/**
 * Clips a convex polygon against a half-plane using the Sutherland-Hodgman algorithm.
 * Returns the clipped polygon (may have 0 vertices if fully outside).
 */
function clipPolygon(polygon: Vec2[], plane: HalfPlane): Vec2[] {
  if (polygon.length === 0) return polygon;

  const out: Vec2[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    const dCur = dot(plane, current);
    const dNext = dot(plane, next);

    if (dCur >= 0) {
      // current is inside
      out.push(current);
      if (dNext < 0) {
        // next is outside → add intersection
        out.push(intersect(current, next, plane));
      }
    } else {
      // current is outside
      if (dNext >= 0) {
        // next is inside → add intersection
        out.push(intersect(current, next, plane));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Primary collimator polygon (projected to detector)
// ---------------------------------------------------------------------------

const CIRCLE_SEGMENTS = 32;

/**
 * Returns the primary collimator aperture as a polygon projected to the detector plane.
 * For "rect": 4 vertices (CCW).
 * For "circle"/"ellipse": N-gon approximation.
 */
export function computePCPolygon(
  state: CollimatorState,
  config: CollimatorConfig,
): Vec2[] {
  const pc = config.primary_collimator;
  const pcScale = state.sid / pc.fld_mm;

  if (pc.shape === "circle" || pc.shape === "ellipse") {
    const r = (pc.radius_mm ?? pc.size.x / 2) * pcScale;
    const poly: Vec2[] = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const a = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
      poly.push({ x: r * Math.cos(a), z: r * Math.sin(a) });
    }
    return poly;
  }

  // Rectangular PC: 4 corners (CCW order)
  const hw = (pc.size.x / 2) * pcScale;
  const hh = (pc.size.y / 2) * pcScale;
  return [
    { x: -hw, z: -hh },
    { x: hw, z: -hh },
    { x: hw, z: hh },
    { x: -hw, z: hh },
  ];
}

// ---------------------------------------------------------------------------
// Field polygon: PC clipped by all jaw half-planes
// ---------------------------------------------------------------------------

/**
 * Computes the effective beam field polygon at the detector plane (mm).
 *
 * Starts with the primary collimator projection and clips it against each
 * jaw module's two leaf edges (as half-planes in the collimator frame).
 * The result is a convex polygon in the collimator-local XZ coordinate system
 * (global collimator rotation is NOT applied — callers handle that).
 *
 * Each jaw module at rotation θ contributes two half-planes:
 *   - leaf1 (negative-side): keeps points where  cos(θ)·x + sin(θ)·z >= d1
 *   - leaf2 (positive-side): keeps points where -cos(θ)·x - sin(θ)·z >= -d2
 *
 * where d1, d2 are the projected leaf positions at the detector plane.
 */
export function computeFieldPolygon(
  state: CollimatorState,
  config: CollimatorConfig,
): Vec2[] {
  let polygon = computePCPolygon(state, config);
  if (polygon.length === 0) return polygon;

  const sid = state.sid;

  for (const modConfig of config.modules) {
    if (!["jaws_rect", "jaws_square", "jaws_asymmetric"].includes(modConfig.type)) continue;
    const modState = state.modules[modConfig.id];
    if (!modState) continue;

    const fld = modState.fld_mm ?? modConfig.fld_mm;
    const leaf1 = typeof modState["leaf1"] === "number" ? (modState["leaf1"] as number) : 0;
    const leaf2 = typeof modState["leaf2"] === "number" ? (modState["leaf2"] as number) : 0;

    const d1 = projectToDetector(leaf1, sid, fld);
    const d2 = projectToDetector(leaf2, sid, fld);

    // Module rotation in the collimator frame (NOT including global collimator rotation)
    const totalRot = (modConfig.rotation_deg ?? 0) + modState.rotation_deg;
    const theta = (totalRot * Math.PI) / 180;
    const cosR = Math.cos(theta);
    const sinR = Math.sin(theta);

    // Three.js Y-rotation by θ maps local X to world (cosθ, -sinθ) in the XZ plane.
    // A leaf at position d along local X → world point (d*cosθ, -d*sinθ).
    // The leaf edge (perpendicular to local X) satisfies: cosθ*x - sinθ*z = d.
    //
    // Half-plane for leaf1: keeps the side toward +X in the module's local frame.
    // Condition: cosR*x - sinR*z >= d1
    const plane1: HalfPlane = {
      nx: cosR,
      nz: -sinR,
      px: d1 * cosR,
      pz: -d1 * sinR,
    };

    // Half-plane for leaf2: keeps the side toward -X in the module's local frame.
    // Condition: cosR*x - sinR*z <= d2  →  -(cosR*x - sinR*z) + d2 >= 0
    const plane2: HalfPlane = {
      nx: -cosR,
      nz: sinR,
      px: d2 * cosR,
      pz: -d2 * sinR,
    };

    polygon = clipPolygon(polygon, plane1);
    polygon = clipPolygon(polygon, plane2);

    // jaws_square: second pair at +90° with the same aperture values
    if (modConfig.type === "jaws_square") {
      const theta90 = theta + Math.PI / 2;
      const cos90 = Math.cos(theta90);
      const sin90 = Math.sin(theta90);

      const plane3: HalfPlane = {
        nx: cos90,
        nz: -sin90,
        px: d1 * cos90,
        pz: -d1 * sin90,
      };
      const plane4: HalfPlane = {
        nx: -cos90,
        nz: sin90,
        px: d2 * cos90,
        pz: -d2 * sin90,
      };

      polygon = clipPolygon(polygon, plane3);
      polygon = clipPolygon(polygon, plane4);
    }

    if (polygon.length === 0) return polygon;
  }

  return polygon;
}
