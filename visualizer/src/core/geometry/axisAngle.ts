/**
 * Axis angle: the angle of the ray from the focal spot through an axis position.
 *
 * Formula: axis_angle_deg = atan(pos_leaf / fld_mm) * (180 / PI)
 *
 * Used by AxisDataTable (US-23) and Scope derived traces (US-25).
 *
 * @param posLeaf - axis position at the leaf plane in mm
 * @param fldMm   - focus-to-leaf distance in mm
 * @returns angle in degrees
 */
export function axisAngle(posLeaf: number, fldMm: number): number {
  return Math.atan(posLeaf / fldMm) * (180 / Math.PI);
}
