import { describe, it, expect } from "vitest";
import { checkConstraints } from "./ConstraintChecker.js";
import { makeState, makeConfig, makeJawModule } from "../test-helpers.js";

describe("checkConstraints", () => {
  it("all within bounds → no violations", () => {
    const state = makeState({
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0, { min_mm: -150, max_mm: 150 })],
    });
    expect(checkConstraints(state, config)).toEqual([]);
  });

  it("end_stop_min on leaf1", () => {
    const state = makeState({
      modules: { jaws_x: { rotation_deg: 0, leaf1: -200, leaf2: 50 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0, { min_mm: -150, max_mm: 150 })],
    });
    const v = checkConstraints(state, config);
    expect(v).toHaveLength(1);
    expect(v[0]!.type).toBe("end_stop_min");
    expect(v[0]!.leaf).toBe("leaf1");
    expect(v[0]!.moduleId).toBe("jaws_x");
  });

  it("end_stop_max on leaf2", () => {
    const state = makeState({
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 200 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0, { min_mm: -150, max_mm: 150 })],
    });
    const v = checkConstraints(state, config);
    expect(v).toHaveLength(1);
    expect(v[0]!.type).toBe("end_stop_max");
    expect(v[0]!.leaf).toBe("leaf2");
  });

  it("leaf_crossing (leaf1 > leaf2)", () => {
    const state = makeState({
      modules: { jaws_x: { rotation_deg: 0, leaf1: 30, leaf2: -30 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const v = checkConstraints(state, config);
    expect(v).toHaveLength(1);
    expect(v[0]!.type).toBe("leaf_crossing");
    expect(v[0]!.leaf).toBeNull();
  });

  it("leaf1 = leaf2 = 0 → no crossing", () => {
    const state = makeState({
      modules: { jaws_x: { rotation_deg: 0, leaf1: 0, leaf2: 0 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    expect(checkConstraints(state, config)).toEqual([]);
  });

  it("multiple simultaneous violations", () => {
    const state = makeState({
      modules: { jaws_x: { rotation_deg: 0, leaf1: -200, leaf2: 200 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0, { min_mm: -150, max_mm: 150 })],
    });
    const v = checkConstraints(state, config);
    expect(v).toHaveLength(2);
    const types = v.map((x) => x.type);
    expect(types).toContain("end_stop_min");
    expect(types).toContain("end_stop_max");
  });

  it("non-jaw modules produce no violations", () => {
    const state = makeState({
      modules: { wedge_1: { rotation_deg: 0, enabled: true, lateral_offset_mm: 500 } },
    });
    const config = makeConfig({
      modules: [{ id: "wedge_1", type: "wedge", fld_mm: 400, thickness_mm: 20 }],
    });
    expect(checkConstraints(state, config)).toEqual([]);
  });

  it("missing module state → no violations", () => {
    const state = makeState({ modules: {} });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0, { min_mm: -150, max_mm: 150 })],
    });
    expect(checkConstraints(state, config)).toEqual([]);
  });

  it("no constraints defined → no end_stop violations, only crossing", () => {
    const state = makeState({
      modules: { jaws_x: { rotation_deg: 0, leaf1: 50, leaf2: -50 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)], // no constraints
    });
    const v = checkConstraints(state, config);
    expect(v).toHaveLength(1);
    expect(v[0]!.type).toBe("leaf_crossing");
  });

  it("combined end_stop + crossing", () => {
    // leaf1=200 > max=150 → end_stop_max
    // leaf2=-200 < min=-150 → end_stop_min
    // leaf1(200) > leaf2(-200) → crossing
    const state = makeState({
      modules: { jaws_x: { rotation_deg: 0, leaf1: 200, leaf2: -200 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0, { min_mm: -150, max_mm: 150 })],
    });
    const v = checkConstraints(state, config);
    const types = v.map((x) => x.type);
    expect(types).toContain("end_stop_max"); // leaf1 > max
    expect(types).toContain("end_stop_min"); // leaf2 < min
    expect(types).toContain("leaf_crossing"); // leaf1 > leaf2
  });
});
