import type { CollimatorConfig, ModuleConfig, ModuleType } from "../core/config/types.js";
import type { CollimatorState } from "../core/state/CollimatorState.js";
import { projectToDetector } from "../core/geometry/projection.js";
import { axisAngle } from "../core/geometry/axisAngle.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Physical unit — determines Y-axis grouping in the chart. */
export type TraceUnit = "mm" | "\u00B0" | "bool";

/** A single selectable trace. */
export interface TraceDefinition {
  /** Unique ID: "{moduleId}.{parameter}" or "global.{parameter}" */
  id: string;
  /** Module ID (or "global" for top-level fields) */
  moduleId: string;
  /** Human-readable parameter name */
  parameter: string;
  /** Physical unit */
  unit: TraceUnit;
  /** Whether this is a derived (computed) value */
  derived: boolean;
  /** Extracts the numeric value from current state + config */
  extract: (state: CollimatorState, config: CollimatorConfig) => number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve effective FLD for a module: runtime override or config default. */
function resolveFld(state: CollimatorState, modConfig: ModuleConfig): number {
  const modState = state.modules[modConfig.id];
  return (modState?.fld_mm as number | undefined) ?? modConfig.fld_mm;
}

/** Get a numeric module field, defaulting to 0. */
function modNum(state: CollimatorState, moduleId: string, field: string): number {
  const v = state.modules[moduleId]?.[field];
  return typeof v === "number" ? v : 0;
}

// ---------------------------------------------------------------------------
// Trace generators (registry pattern — no if/else per module type)
// ---------------------------------------------------------------------------

type TraceGenerator = (mod: ModuleConfig) => TraceDefinition[];

function generateJawLeafTraces(mod: ModuleConfig, leaves: string[]): TraceDefinition[] {
  const traces: TraceDefinition[] = [];
  const id = mod.id;

  for (const leaf of leaves) {
    // Raw leaf position
    traces.push({
      id: `${id}.${leaf}`,
      moduleId: id,
      parameter: leaf,
      unit: "mm",
      derived: false,
      extract: (s) => modNum(s, id, leaf),
    });

    // Derived: image plane projection
    traces.push({
      id: `${id}.${leaf}_image_plane`,
      moduleId: id,
      parameter: `${leaf}_image_plane`,
      unit: "mm",
      derived: true,
      extract: (s, c) => {
        const pos = modNum(s, id, leaf);
        const mc = c.modules.find((m) => m.id === id);
        if (!mc) return 0;
        return projectToDetector(pos, s.sid, resolveFld(s, mc));
      },
    });

    // Derived: axis angle
    traces.push({
      id: `${id}.${leaf}_axis_angle`,
      moduleId: id,
      parameter: `${leaf}_axis_angle`,
      unit: "\u00B0",
      derived: true,
      extract: (s, c) => {
        const pos = modNum(s, id, leaf);
        const mc = c.modules.find((m) => m.id === id);
        if (!mc) return 0;
        return axisAngle(pos, resolveFld(s, mc));
      },
    });
  }

  // Common jaw traces: rotation_deg + fld_mm
  traces.push({
    id: `${id}.rotation_deg`,
    moduleId: id,
    parameter: "rotation_deg",
    unit: "\u00B0",
    derived: false,
    extract: (s) => modNum(s, id, "rotation_deg"),
  });
  traces.push({
    id: `${id}.fld_mm`,
    moduleId: id,
    parameter: "fld_mm",
    unit: "mm",
    derived: false,
    extract: (s, c) => {
      const mc = c.modules.find((m) => m.id === id);
      if (!mc) return 0;
      return resolveFld(s, mc);
    },
  });

  return traces;
}

function generateJawTraces(mod: ModuleConfig): TraceDefinition[] {
  return generateJawLeafTraces(mod, ["leaf1", "leaf2"]);
}

function generateJawSquareTraces(mod: ModuleConfig): TraceDefinition[] {
  return generateJawLeafTraces(mod, ["leaf1", "leaf2", "leaf3", "leaf4"]);
}

function generateWedgeTraces(mod: ModuleConfig): TraceDefinition[] {
  const id = mod.id;
  return [
    {
      id: `${id}.lateral_offset_mm`,
      moduleId: id,
      parameter: "lateral_offset_mm",
      unit: "mm",
      derived: false,
      extract: (s) => modNum(s, id, "lateral_offset_mm"),
    },
    {
      id: `${id}.rotation_deg`,
      moduleId: id,
      parameter: "rotation_deg",
      unit: "\u00B0",
      derived: false,
      extract: (s) => modNum(s, id, "rotation_deg"),
    },
    {
      id: `${id}.enabled`,
      moduleId: id,
      parameter: "enabled",
      unit: "bool",
      derived: false,
      extract: (s) => (s.modules[id]?.enabled === true ? 1 : 0),
    },
    {
      id: `${id}.lateral_offset_image_plane`,
      moduleId: id,
      parameter: "lateral_offset_image_plane",
      unit: "mm",
      derived: true,
      extract: (s, c) => {
        const offset = modNum(s, id, "lateral_offset_mm");
        const mc = c.modules.find((m) => m.id === id);
        if (!mc) return 0;
        return projectToDetector(offset, s.sid, resolveFld(s, mc));
      },
    },
  ];
}

function generatePrefilterTraces(mod: ModuleConfig): TraceDefinition[] {
  const id = mod.id;
  return [
    {
      id: `${id}.angle_deg`,
      moduleId: id,
      parameter: "angle_deg",
      unit: "\u00B0",
      derived: false,
      extract: (s) => modNum(s, id, "angle_deg"),
    },
    {
      id: `${id}.rotation_deg`,
      moduleId: id,
      parameter: "rotation_deg",
      unit: "\u00B0",
      derived: false,
      extract: (s) => modNum(s, id, "rotation_deg"),
    },
  ];
}

const TRACE_GENERATORS: Record<ModuleType, TraceGenerator> = {
  jaws_rect: generateJawTraces,
  jaws_square: generateJawSquareTraces,
  jaws_asymmetric: generateJawTraces,
  wedge: generateWedgeTraces,
  prefilter: generatePrefilterTraces,
};

// ---------------------------------------------------------------------------
// Global traces (always present)
// ---------------------------------------------------------------------------

function globalTraces(): TraceDefinition[] {
  return [
    {
      id: "global.sid",
      moduleId: "global",
      parameter: "sid",
      unit: "mm",
      derived: false,
      extract: (s) => s.sid,
    },
    {
      id: "global.collimator_rotation_deg",
      moduleId: "global",
      parameter: "collimator_rotation_deg",
      unit: "\u00B0",
      derived: false,
      extract: (s) => s.collimator_rotation_deg,
    },
  ];
}

// ---------------------------------------------------------------------------
// TraceRegistry
// ---------------------------------------------------------------------------

export class TraceRegistry {
  private traces: TraceDefinition[] = [];

  /** Rebuild trace definitions from config. Call on config load/change. */
  buildFromConfig(config: CollimatorConfig): void {
    this.traces = globalTraces();
    for (const mod of config.modules) {
      const gen = TRACE_GENERATORS[mod.type];
      this.traces.push(...gen(mod));
    }
  }

  /** All available trace definitions. */
  getTraces(): readonly TraceDefinition[] {
    return this.traces;
  }

  /** Extract all trace values from current state. */
  extractAll(state: CollimatorState, config: CollimatorConfig): Record<string, number> {
    const result: Record<string, number> = {};
    for (const t of this.traces) {
      result[t.id] = t.extract(state, config);
    }
    return result;
  }
}
