// Dynamic collimator state — updated at runtime by the active DataSource.
// All positional values are in the leaf plane (at FLD), never detector coordinates.
// Projection to detector plane is handled exclusively by geometry/projection.ts.

/** Per-module dynamic state. Keys depend on module type (see REQUIREMENTS.md US-02). */
export interface ModuleState {
  rotation_deg: number;
  /** Overrides the static fld_mm from CollimatorConfig when present. */
  fld_mm?: number;
  // Module-specific dynamic fields, e.g.:
  //   jaws:     leaf1, leaf2 (mm, in leaf plane)
  //   prefilter: angle_deg
  //   wedge:     enabled, lateral_offset_mm
  [key: string]: number | boolean | string | undefined;
}

export interface CollimatorState {
  timestamp: number;
  /** Source-to-image distance in mm. */
  sid: number;
  collimator_rotation_deg: number;
  /** Focal spot size in mm (cosmetic only, no effect on projection). */
  focal_spot: { x: number; y: number };
  /** Map of module ID → current module state. */
  modules: Record<string, ModuleState>;
}

/** Applied on cold start before any data packet arrives. */
export const DEFAULT_STATE: CollimatorState = {
  timestamp: 0,
  sid: 1000,
  collimator_rotation_deg: 0,
  focal_spot: { x: 1.0, y: 1.0 },
  modules: {},
};
