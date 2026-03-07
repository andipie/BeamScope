import type { CollimatorState, ModuleState } from "./state/CollimatorState.js";
import type { CollimatorConfig, ModuleConfig, ModuleType, PrimaryCollimatorShape } from "./config/types.js";

/**
 * Creates a CollimatorState with sensible defaults.
 * Override any field via the overrides parameter.
 */
export function makeState(overrides?: Partial<CollimatorState> & { modules?: Record<string, Partial<ModuleState>> }): CollimatorState {
  const base: CollimatorState = {
    timestamp: 0,
    sid: 1000,
    collimator_rotation_deg: 0,
    focal_spot: { x: 1.0, y: 1.0 },
    modules: {},
  };
  if (!overrides) return base;

  const { modules, ...rest } = overrides;
  const merged = { ...base, ...rest };

  if (modules) {
    for (const [id, partial] of Object.entries(modules)) {
      const defaults: Partial<ModuleState> = { rotation_deg: 0 };
      merged.modules[id] = { ...defaults, ...partial } as ModuleState;
    }
  }

  return merged;
}

/**
 * Creates a CollimatorConfig with a rectangular primary collimator and optional modules.
 */
export function makeConfig(opts?: {
  pcShape?: PrimaryCollimatorShape;
  pcSizeX?: number;
  pcSizeY?: number;
  pcFld?: number;
  pcRadius?: number;
  modules?: ModuleConfig[];
}): CollimatorConfig {
  const o = opts ?? {};
  return {
    collimator_id: "test-config",
    primary_collimator: {
      shape: o.pcShape ?? "rect",
      size: { x: o.pcSizeX ?? 300, y: o.pcSizeY ?? 300 },
      fld_mm: o.pcFld ?? 300,
      ...(o.pcRadius != null ? { radius_mm: o.pcRadius } : {}),
    },
    modules: o.modules ?? [],
  };
}

/**
 * Creates a jaw ModuleConfig with common defaults.
 */
export function makeJawModule(
  id: string,
  type: ModuleType = "jaws_rect",
  fld = 500,
  rotationDeg = 0,
  constraints?: { min_mm: number; max_mm: number },
): ModuleConfig {
  return {
    id,
    type,
    fld_mm: fld,
    thickness_mm: 80,
    rotation_deg: rotationDeg,
    ...(constraints ? { constraints } : {}),
  };
}
