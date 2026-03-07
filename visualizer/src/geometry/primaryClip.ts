/**
 * Primary collimator clipping.
 *
 * The primary collimator defines the maximum allowed beam field.
 * Its projection onto the detector plane is computed the same way as jaw leaves.
 * The effective field is the intersection of the jaw field and the primary collimator projection.
 *
 * Formula (rect): projection_detector = size × (SID / FLD_primary)
 * Clipping:       intersection(jaw_field_detector, primary_projection_detector)
 */

/** Axis-aligned rectangle in detector-plane coordinates (mm). */
export interface Rect {
  /** Left edge (−X), typically negative. */
  x1: number;
  /** Right edge (+X), typically positive. */
  x2: number;
  /** Bottom edge (−Z), typically negative. */
  z1: number;
  /** Top edge (+Z), typically positive. */
  z2: number;
}

/**
 * Intersects two axis-aligned rectangles.
 * Returns null if they do not overlap.
 */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x1, b.x1);
  const x2 = Math.min(a.x2, b.x2);
  const z1 = Math.max(a.z1, b.z1);
  const z2 = Math.min(a.z2, b.z2);

  if (x1 >= x2 || z1 >= z2) return null;
  return { x1, x2, z1, z2 };
}

// TODO: circular/elliptical primary collimator clipping
// For "circle" and "ellipse" shapes, clip using a parametric circle/ellipse intersection
// with the rectangular jaw field polygon.
