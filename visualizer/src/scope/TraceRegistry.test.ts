import { describe, it, expect } from "vitest";
import { TraceRegistry } from "./TraceRegistry.js";
import type { CollimatorConfig } from "../core/config/types.js";
import type { CollimatorState } from "../core/state/CollimatorState.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(modules: CollimatorConfig["modules"]): CollimatorConfig {
  return {
    collimator_id: "test",
    primary_collimator: { shape: "rect", size: { x: 200, y: 200 }, fld_mm: 200 },
    modules,
  };
}

function makeState(overrides: Partial<CollimatorState> = {}): CollimatorState {
  return {
    timestamp: Date.now(),
    sid: 1000,
    collimator_rotation_deg: 0,
    focal_spot: { x: 1, y: 1 },
    modules: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceRegistry", () => {
  const reg = new TraceRegistry();

  describe("global traces", () => {
    it("always generates global.sid and global.collimator_rotation_deg", () => {
      reg.buildFromConfig(makeConfig([]));
      const ids = reg.getTraces().map((t) => t.id);
      expect(ids).toContain("global.sid");
      expect(ids).toContain("global.collimator_rotation_deg");
    });

    it("extracts global values correctly", () => {
      reg.buildFromConfig(makeConfig([]));
      const state = makeState({ sid: 1200, collimator_rotation_deg: 15 });
      const vals = reg.extractAll(state, makeConfig([]));
      expect(vals["global.sid"]).toBe(1200);
      expect(vals["global.collimator_rotation_deg"]).toBe(15);
    });
  });

  describe("jaws_rect", () => {
    const config = makeConfig([
      { id: "jaws_x", type: "jaws_rect", fld_mm: 300, thickness_mm: 80 },
    ]);

    it("generates 8 traces (2 leaves × 3 + rotation + fld)", () => {
      reg.buildFromConfig(config);
      const jawTraces = reg.getTraces().filter((t) => t.moduleId === "jaws_x");
      expect(jawTraces.length).toBe(8);
    });

    it("includes raw and derived trace IDs", () => {
      reg.buildFromConfig(config);
      const ids = reg.getTraces().map((t) => t.id);
      expect(ids).toContain("jaws_x.leaf1");
      expect(ids).toContain("jaws_x.leaf2");
      expect(ids).toContain("jaws_x.leaf1_image_plane");
      expect(ids).toContain("jaws_x.leaf2_image_plane");
      expect(ids).toContain("jaws_x.leaf1_axis_angle");
      expect(ids).toContain("jaws_x.leaf2_axis_angle");
      expect(ids).toContain("jaws_x.rotation_deg");
      expect(ids).toContain("jaws_x.fld_mm");
    });

    it("extracts leaf position correctly", () => {
      reg.buildFromConfig(config);
      const state = makeState({
        modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50 } },
      });
      const vals = reg.extractAll(state, config);
      expect(vals["jaws_x.leaf1"]).toBe(-50);
      expect(vals["jaws_x.leaf2"]).toBe(50);
    });

    it("computes image_plane projection correctly", () => {
      reg.buildFromConfig(config);
      const state = makeState({
        sid: 1000,
        modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50 } },
      });
      const vals = reg.extractAll(state, config);
      // -50 * (1000 / 300) = -166.667
      expect(vals["jaws_x.leaf1_image_plane"]).toBeCloseTo(-166.667, 2);
      expect(vals["jaws_x.leaf2_image_plane"]).toBeCloseTo(166.667, 2);
    });

    it("computes axis_angle correctly", () => {
      reg.buildFromConfig(config);
      const state = makeState({
        modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50 } },
      });
      const vals = reg.extractAll(state, config);
      // atan(-50 / 300) * 180 / PI = -9.462
      expect(vals["jaws_x.leaf1_axis_angle"]).toBeCloseTo(-9.462, 2);
      expect(vals["jaws_x.leaf2_axis_angle"]).toBeCloseTo(9.462, 2);
    });
  });

  describe("jaws_square", () => {
    it("generates 14 traces (4 leaves × 3 + rotation + fld)", () => {
      const config = makeConfig([
        { id: "sq", type: "jaws_square", fld_mm: 300, thickness_mm: 80 },
      ]);
      reg.buildFromConfig(config);
      const sqTraces = reg.getTraces().filter((t) => t.moduleId === "sq");
      expect(sqTraces.length).toBe(14);
    });
  });

  describe("wedge", () => {
    const config = makeConfig([
      { id: "w1", type: "wedge", fld_mm: 400, thickness_mm: 30 },
    ]);

    it("generates 4 traces", () => {
      reg.buildFromConfig(config);
      const wTraces = reg.getTraces().filter((t) => t.moduleId === "w1");
      expect(wTraces.length).toBe(4);
    });

    it("includes enabled as bool unit", () => {
      reg.buildFromConfig(config);
      const enabled = reg.getTraces().find((t) => t.id === "w1.enabled");
      expect(enabled?.unit).toBe("bool");
    });

    it("extracts enabled as 0/1", () => {
      reg.buildFromConfig(config);
      const stateOn = makeState({
        modules: { w1: { rotation_deg: 0, enabled: true, lateral_offset_mm: 10 } },
      });
      const stateOff = makeState({
        modules: { w1: { rotation_deg: 0, enabled: false, lateral_offset_mm: 10 } },
      });
      expect(reg.extractAll(stateOn, config)["w1.enabled"]).toBe(1);
      expect(reg.extractAll(stateOff, config)["w1.enabled"]).toBe(0);
    });
  });

  describe("prefilter", () => {
    it("generates 2 traces (angle_deg + rotation_deg)", () => {
      const config = makeConfig([
        { id: "pf", type: "prefilter", fld_mm: 150, thickness_mm: 10 },
      ]);
      reg.buildFromConfig(config);
      const pfTraces = reg.getTraces().filter((t) => t.moduleId === "pf");
      expect(pfTraces.length).toBe(2);
    });
  });

  describe("config rebuild", () => {
    it("replaces all traces on new config", () => {
      const config1 = makeConfig([
        { id: "j1", type: "jaws_rect", fld_mm: 300, thickness_mm: 80 },
      ]);
      const config2 = makeConfig([
        { id: "pf", type: "prefilter", fld_mm: 150, thickness_mm: 10 },
      ]);
      reg.buildFromConfig(config1);
      expect(reg.getTraces().some((t) => t.moduleId === "j1")).toBe(true);

      reg.buildFromConfig(config2);
      expect(reg.getTraces().some((t) => t.moduleId === "j1")).toBe(false);
      expect(reg.getTraces().some((t) => t.moduleId === "pf")).toBe(true);
    });
  });
});
