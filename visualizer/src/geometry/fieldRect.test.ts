import { describe, it, expect } from "vitest";
import { computeFieldRect, computePCProjection, computeRawJawField } from "./fieldRect.js";
import { makeState, makeConfig, makeJawModule } from "../test-helpers.js";

// ---------------------------------------------------------------------------
// computePCProjection
// ---------------------------------------------------------------------------

describe("computePCProjection", () => {
  it("rect PC: projects to correct AABB", () => {
    // PC: 300×200 at FLD=300, SID=1000 → scale=10/3
    // hw = 150 × 10/3 = 500, hh = 100 × 10/3 ≈ 333.3
    const state = makeState({ sid: 1000 });
    const config = makeConfig({ pcSizeX: 300, pcSizeY: 200, pcFld: 300 });
    const r = computePCProjection(state, config);

    expect(r.x1).toBeCloseTo(-500, 0);
    expect(r.x2).toBeCloseTo(500, 0);
    expect(r.z1).toBeCloseTo(-333.3, 0);
    expect(r.z2).toBeCloseTo(333.3, 0);
  });

  it("circle PC: AABB is bounding square of projected radius", () => {
    // radius=100 at FLD=500, SID=1000 → r=200
    const state = makeState({ sid: 1000 });
    const config = makeConfig({ pcShape: "circle", pcRadius: 100, pcFld: 500 });
    const r = computePCProjection(state, config);

    expect(r.x1).toBeCloseTo(-200, 0);
    expect(r.x2).toBeCloseTo(200, 0);
    expect(r.z1).toBeCloseTo(-200, 0);
    expect(r.z2).toBeCloseTo(200, 0);
  });

  it("identity projection when SID = FLD", () => {
    const state = makeState({ sid: 500 });
    const config = makeConfig({ pcSizeX: 200, pcSizeY: 200, pcFld: 500 });
    const r = computePCProjection(state, config);

    expect(r.x1).toBeCloseTo(-100, 0);
    expect(r.x2).toBeCloseTo(100, 0);
  });
});

// ---------------------------------------------------------------------------
// computeFieldRect
// ---------------------------------------------------------------------------

describe("computeFieldRect", () => {
  it("AABB matches field polygon for standard config", () => {
    const state = makeState({
      sid: 1000,
      modules: {
        jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 },
        jaws_y: { rotation_deg: 0, leaf1: -60, leaf2: 60, fld_mm: 500 },
      },
    });
    const config = makeConfig({
      pcSizeX: 300, pcSizeY: 300, pcFld: 300,
      modules: [
        makeJawModule("jaws_x", "jaws_rect", 500, 0),
        makeJawModule("jaws_y", "jaws_rect", 500, 90),
      ],
    });
    const rect = computeFieldRect(state, config);

    expect(rect.x1).toBeCloseTo(-100, 0);
    expect(rect.x2).toBeCloseTo(100, 0);
    expect(rect.z1).toBeCloseTo(-120, 0);
    expect(rect.z2).toBeCloseTo(120, 0);
  });

  it("jaws closed → degenerate rect (zero X width)", () => {
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: 0, leaf2: 0, fld_mm: 500 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const rect = computeFieldRect(state, config);

    // Polygon is degenerate (all on x=0), so AABB has zero X width
    expect(rect.x2 - rect.x1).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// computeRawJawField
// ---------------------------------------------------------------------------

describe("computeRawJawField", () => {
  it("X jaw constrains X axis, Z stays ±Infinity", () => {
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const raw = computeRawJawField(state, config);

    expect(raw.x1).toBeCloseTo(-100, 0);
    expect(raw.x2).toBeCloseTo(100, 0);
    expect(raw.z1).toBe(-Infinity);
    expect(raw.z2).toBe(Infinity);
  });

  it("two orthogonal jaws constrain both axes", () => {
    // Rotation only in config, not doubled in state
    const state = makeState({
      sid: 1000,
      modules: {
        jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 },
        jaws_y: { rotation_deg: 0, leaf1: -60, leaf2: 60, fld_mm: 500 },
      },
    });
    const config = makeConfig({
      modules: [
        makeJawModule("jaws_x", "jaws_rect", 500, 0),
        makeJawModule("jaws_y", "jaws_rect", 500, 90),
      ],
    });
    const raw = computeRawJawField(state, config);

    expect(raw.x1).toBeCloseTo(-100, 0);
    expect(raw.x2).toBeCloseTo(100, 0);
    expect(raw.z1).toBeCloseTo(-120, 0);
    expect(raw.z2).toBeCloseTo(120, 0);
  });

  it("tighter jaw wins on same axis", () => {
    // Two X jaws: one at ±100, another at ±60
    const state = makeState({
      sid: 1000,
      modules: {
        jaws_x1: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 },
        jaws_x2: { rotation_deg: 0, leaf1: -30, leaf2: 30, fld_mm: 500 },
      },
    });
    const config = makeConfig({
      modules: [
        makeJawModule("jaws_x1", "jaws_rect", 500, 0),
        makeJawModule("jaws_x2", "jaws_rect", 500, 0),
      ],
    });
    const raw = computeRawJawField(state, config);

    // Tighter: ±60
    expect(raw.x1).toBeCloseTo(-60, 0);
    expect(raw.x2).toBeCloseTo(60, 0);
  });

  it("no jaw modules → all ±Infinity", () => {
    const state = makeState({ sid: 1000 });
    const config = makeConfig();
    const raw = computeRawJawField(state, config);

    expect(raw.x1).toBe(-Infinity);
    expect(raw.x2).toBe(Infinity);
    expect(raw.z1).toBe(-Infinity);
    expect(raw.z2).toBe(Infinity);
  });
});
