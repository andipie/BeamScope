/**
 * FLD projection: transforms a position from the leaf plane to the detector plane.
 *
 * ⚠️  All values in the data stream are in the leaf plane (at FLD).
 *     The visualization is solely responsible for this projection.
 *     Raw stream values must NEVER be used directly as detector coordinates.
 *
 * Formula: pos_detector = pos_leaf × (SID / FLD)
 *
 * @param posLeaf - position at the leaf plane in mm (relative to central axis)
 * @param sid     - source-to-image distance in mm
 * @param fld     - focus-to-leaf distance in mm
 * @returns projected position at the detector plane in mm
 */
export function projectToDetector(posLeaf: number, sid: number, fld: number): number {
  return posLeaf * (sid / fld);
}

/**
 * Inverse: converts a detector-plane position back to the leaf plane.
 * Useful for UI annotation (showing values in leaf-plane coordinates).
 *
 * @param posDetector - position at the detector plane in mm
 * @param sid         - source-to-image distance in mm
 * @param fld         - focus-to-leaf distance in mm
 * @returns position at the leaf plane in mm
 */
export function projectToLeafPlane(posDetector: number, sid: number, fld: number): number {
  return posDetector * (fld / sid);
}
