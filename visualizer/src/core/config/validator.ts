import type { CollimatorConfig, ModuleConfig, ModuleType } from "./types.js";

const VALID_MODULE_TYPES: ReadonlySet<ModuleType> = new Set([
  "jaws_rect",
  "jaws_square",
  "jaws_asymmetric",
  "wedge",
  "prefilter",
]);

/**
 * Validates a raw (unknown) parsed JSON value as a CollimatorConfig.
 * Throws an Error with a descriptive message on validation failure.
 *
 * Currently validates required top-level structure.
 * TODO: add module-specific field validation per ModuleType.
 */
export function validateConfig(raw: unknown): CollimatorConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Config must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  // collimator_id
  if (typeof obj["collimator_id"] !== "string") {
    throw new Error('Config missing required string field "collimator_id"');
  }

  // primary_collimator
  const pc = obj["primary_collimator"];
  if (typeof pc !== "object" || pc === null) {
    throw new Error('Config missing required object field "primary_collimator"');
  }
  const pcObj = pc as Record<string, unknown>;
  if (!["rect", "circle", "ellipse"].includes(pcObj["shape"] as string)) {
    throw new Error(`primary_collimator.shape must be "rect", "circle", or "ellipse"`);
  }
  if (typeof pcObj["fld_mm"] !== "number") {
    throw new Error('primary_collimator missing required number field "fld_mm"');
  }

  // modules
  if (!Array.isArray(obj["modules"])) {
    throw new Error('Config missing required array field "modules"');
  }

  const modules: ModuleConfig[] = [];
  for (let i = 0; i < obj["modules"].length; i++) {
    const mod = obj["modules"][i] as Record<string, unknown>;
    if (typeof mod["id"] !== "string") {
      throw new Error(`modules[${i}] missing required string field "id"`);
    }
    if (!VALID_MODULE_TYPES.has(mod["type"] as ModuleType)) {
      throw new Error(
        `modules[${i}] has unknown type "${String(mod["type"])}". ` +
          `Valid types: ${[...VALID_MODULE_TYPES].join(", ")}`
      );
    }
    if (typeof mod["fld_mm"] !== "number") {
      throw new Error(`modules[${i}] ("${mod["id"]}") missing required number field "fld_mm"`);
    }
    if (typeof mod["thickness_mm"] !== "number" && mod["type"] !== "prefilter") {
      // prefilter may have a thickness but it is optional
    }
    // TODO: module-specific field validation (constraints, segments, etc.)
    modules.push(mod as unknown as ModuleConfig);
  }

  // Ensure all module IDs are unique within this config (duplicate IDs would
  // silently overwrite each other in the SceneUpdater / StateStore maps).
  const seen = new Set<string>();
  for (const m of modules) {
    if (seen.has(m.id)) {
      throw new Error(
        `Duplicate module ID "${m.id}" — each module must have a unique id`
      );
    }
    seen.add(m.id);
  }

  return raw as CollimatorConfig;
}
