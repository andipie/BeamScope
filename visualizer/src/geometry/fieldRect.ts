import type { CollimatorState } from "../state/CollimatorState.js";
import type { CollimatorConfig } from "../config/types.js";
import { projectToDetector } from "./projection.js";
import { computeFieldPolygon } from "./fieldPolygon.js";

export interface FieldRect {
  x1: number; // left edge at detector plane (mm)
  x2: number; // right edge at detector plane (mm)
  z1: number; // bottom edge at detector plane (mm)
  z2: number; // top edge at detector plane (mm)
}

/**
 * Computes the axis-aligned bounding box of the effective beam field polygon
 * at the detector plane (mm).
 *
 * Internally delegates to `computeFieldPolygon()` (Sutherland-Hodgman clipping)
 * and returns the AABB of the resulting polygon.
 * Global collimator rotation is NOT applied — callers handle that.
 */
export function computeFieldRect(state: CollimatorState, config: CollimatorConfig): FieldRect {
  const poly = computeFieldPolygon(state, config);
  if (poly.length === 0) return { x1: 0, x2: 0, z1: 0, z2: 0 };

  let x1 = Infinity;
  let x2 = -Infinity;
  let z1 = Infinity;
  let z2 = -Infinity;
  for (const p of poly) {
    if (p.x < x1) x1 = p.x;
    if (p.x > x2) x2 = p.x;
    if (p.z < z1) z1 = p.z;
    if (p.z > z2) z2 = p.z;
  }
  return { x1, x2, z1, z2 };
}

/**
 * Computes the primary collimator aperture projected to the detector plane (mm).
 * For "circle"/"ellipse" an axis-aligned bounding square is returned.
 * Global collimator rotation is NOT applied — callers that need rotation handle it.
 */
export function computePCProjection(
  state: CollimatorState,
  config: CollimatorConfig,
): FieldRect {
  const pc = config.primary_collimator;
  const pcScale = state.sid / pc.fld_mm;
  if (pc.shape === "circle" || pc.shape === "ellipse") {
    const r = (pc.radius_mm ?? pc.size.x / 2) * pcScale;
    return { x1: -r, x2: r, z1: -r, z2: r };
  }
  const hw = (pc.size.x / 2) * pcScale;
  const hh = (pc.size.y / 2) * pcScale;
  return { x1: -hw, x2: hw, z1: -hh, z2: hh };
}

/**
 * Computes the jaw-only field at the detector plane WITHOUT the primary collimator
 * constraint. Axes not constrained by any jaw module remain ±Infinity.
 * Useful for detecting which portions of the jaw field are clipped by the PC.
 */
export function computeRawJawField(
  state: CollimatorState,
  config: CollimatorConfig,
): FieldRect {
  const sid = state.sid;
  let x1 = -Infinity,
    x2 = Infinity,
    z1 = -Infinity,
    z2 = Infinity;

  for (const modConfig of config.modules) {
    if (!["jaws_rect", "jaws_square", "jaws_asymmetric"].includes(modConfig.type)) continue;
    const modState = state.modules[modConfig.id];
    if (!modState) continue;

    const fld = modState.fld_mm ?? modConfig.fld_mm;
    const leaf1 = typeof modState["leaf1"] === "number" ? modState["leaf1"] : 0;
    const leaf2 = typeof modState["leaf2"] === "number" ? modState["leaf2"] : 0;
    const d1 = projectToDetector(leaf1, sid, fld);
    const d2 = projectToDetector(leaf2, sid, fld);

    const totalRot = (modConfig.rotation_deg ?? 0) + modState.rotation_deg;
    const normRot = ((totalRot % 180) + 180) % 180;

    if (normRot < 45 || normRot >= 135) {
      x1 = Math.max(x1, Math.min(d1, d2));
      x2 = Math.min(x2, Math.max(d1, d2));
    } else {
      z1 = Math.max(z1, Math.min(d1, d2));
      z2 = Math.min(z2, Math.max(d1, d2));
    }
  }
  return { x1, x2, z1, z2 };
}
