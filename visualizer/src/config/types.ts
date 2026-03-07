// Static collimator configuration loaded from a JSON file.
// This format is NOT the data stream format — it describes the physical device.
// Do NOT modify without updating the simulation interface.

export type ModuleType =
  | "jaws_rect"
  | "jaws_square"
  | "jaws_asymmetric"
  | "wedge"
  | "prefilter";

export interface PrefilterSegment {
  from_deg: number;
  to_deg: number;
  filter_value: string;
}

export interface ModuleConstraints {
  min_mm: number;
  max_mm: number;
}

export interface ModuleConfig {
  id: string;
  type: ModuleType;
  /** Focus-to-leaf distance in mm (static default; may be overridden per frame by data stream). */
  fld_mm: number;
  thickness_mm: number;
  rotation_deg?: number;
  constraints?: ModuleConstraints;
  // Module-specific fields:
  //   prefilter: segments: PrefilterSegment[]
  //   wedge:     lateral_offset_mm (startup default), enabled: boolean
  [key: string]: unknown;
}

export type PrimaryCollimatorShape = "rect" | "circle" | "ellipse";

export interface PrimaryCollimatorConfig {
  shape: PrimaryCollimatorShape;
  /**
   * Aperture dimensions **at the leaf plane** (fld_mm from source), in mm.
   * For "rect": size.x = aperture width, size.y = aperture height.
   * For "circle"/"ellipse": use radius_mm; size.x is treated as diameter fallback.
   * Projection to the detector: pos_detector = pos_leaf × (SID / fld_mm).
   */
  size: { x: number; y: number };
  fld_mm: number;
  /**
   * Aperture radius **at the leaf plane** (fld_mm from source), in mm.
   * Only used when shape is "circle" or "ellipse".
   */
  radius_mm?: number;
}

export interface CollimatorConfig {
  collimator_id: string;
  description?: string;
  primary_collimator: PrimaryCollimatorConfig;
  /** Ordered list of modules (stack order = physical order from source to detector). */
  modules: ModuleConfig[];
}
