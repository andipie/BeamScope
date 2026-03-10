/**
 * Edge jump: determines which face of a leaf is the imaging (center-facing) edge.
 *
 * When a leaf crosses the central axis (Y-axis), the imaging face switches sides.
 * This is the geometrically correct behavior — the imaging edge is always the face
 * closest to (facing) the central beam.
 *
 * Rules:
 *   leaf > 0  (right of axis) → left  (−X) face is the imaging edge
 *   leaf < 0  (left of axis)  → right (+X) face is the imaging edge
 *   leaf = 0                  → left  (−X) face (consistent default, edge at axis)
 *
 * Detection is sign-based (Math.sign). No floating-point tolerance band is used.
 * Calculation is performed in the leaf plane; projection to detector happens afterwards.
 */
export type ImagingFace = "left" | "right";

/**
 * Returns which face of a leaf is the imaging (center-facing) edge.
 *
 * @param leafPosition - leaf position in mm at the leaf plane (positive = right of central axis)
 * @returns "left" if the −X face is imaging, "right" if the +X face is imaging
 */
export function imagingFace(leafPosition: number): ImagingFace {
  // leaf >= 0: right of axis or on axis → −X face (left) faces the center
  // leaf  < 0: left of axis             → +X face (right) faces the center
  return leafPosition >= 0 ? "left" : "right";
}

/**
 * Returns the mm offset from the leaf center to the imaging edge, in the leaf plane.
 * Negative offset = toward −X (left face); positive offset = toward +X (right face).
 *
 * @param leafPosition  - leaf position in mm
 * @param thicknessMm   - leaf thickness in mm
 */
export function imagingEdgeOffset(leafPosition: number, thicknessMm: number): number {
  const face = imagingFace(leafPosition);
  // The imaging edge is the center-facing side of the leaf body.
  // half-thickness toward center = negative for right leaf, positive for left leaf.
  return face === "left" ? -thicknessMm / 2 : thicknessMm / 2;
}

/**
 * Returns the position of the imaging edge in the leaf plane (mm).
 *
 * @param leafPosition  - leaf center position in mm at the leaf plane
 * @param thicknessMm   - leaf thickness in mm
 */
export function imagingEdgePosition(leafPosition: number, thicknessMm: number): number {
  return leafPosition + imagingEdgeOffset(leafPosition, thicknessMm);
}
