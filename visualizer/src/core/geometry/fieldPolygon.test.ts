import { describe, it, expect } from "vitest";
import { computePCPolygon, computeFieldPolygon, type Vec2 } from "./fieldPolygon.js";
import { makeState, makeConfig, makeJawModule } from "../test-helpers.js";

/** Compute AABB of polygon. */
function aabb(poly: Vec2[]) {
  let x1 = Infinity, x2 = -Infinity, z1 = Infinity, z2 = -Infinity;
  for (const p of poly) {
    if (p.x < x1) x1 = p.x;
    if (p.x > x2) x2 = p.x;
    if (p.z < z1) z1 = p.z;
    if (p.z > z2) z2 = p.z;
  }
  return { x1, x2, z1, z2 };
}

// ---------------------------------------------------------------------------
// computePCPolygon
// ---------------------------------------------------------------------------

describe("computePCPolygon", () => {
  it("rect PC: 4 vertices, AABB matches projected size", () => {
    // PC: 300×300 at fld=300, SID=1000 → scale=10/3, half-width=500
    const state = makeState({ sid: 1000 });
    const config = makeConfig({ pcSizeX: 300, pcSizeY: 300, pcFld: 300 });
    const poly = computePCPolygon(state, config);

    expect(poly).toHaveLength(4);
    const bb = aabb(poly);
    expect(bb.x2).toBeCloseTo(500, 0);
    expect(bb.x1).toBeCloseTo(-500, 0);
    expect(bb.z2).toBeCloseTo(500, 0);
    expect(bb.z1).toBeCloseTo(-500, 0);
  });

  it("circle PC: 32 vertices, all at radius × (SID/FLD) from origin", () => {
    const state = makeState({ sid: 1000 });
    const config = makeConfig({ pcShape: "circle", pcRadius: 100, pcFld: 500 });
    const poly = computePCPolygon(state, config);

    expect(poly).toHaveLength(32);
    const expectedR = 100 * (1000 / 500); // 200
    for (const p of poly) {
      const dist = Math.sqrt(p.x * p.x + p.z * p.z);
      expect(dist).toBeCloseTo(expectedR, 5);
    }
  });

  it("circle PC: radius_mm fallback to size.x / 2", () => {
    const state = makeState({ sid: 1000 });
    const config = makeConfig({ pcShape: "circle", pcSizeX: 200, pcFld: 500 });
    const poly = computePCPolygon(state, config);

    const expectedR = (200 / 2) * (1000 / 500); // 200
    for (const p of poly) {
      const dist = Math.sqrt(p.x * p.x + p.z * p.z);
      expect(dist).toBeCloseTo(expectedR, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// computeFieldPolygon — unit scenarios
// ---------------------------------------------------------------------------

describe("computeFieldPolygon", () => {
  it("no jaw modules → returns PC polygon unchanged", () => {
    const state = makeState({ sid: 1000 });
    const config = makeConfig({ pcSizeX: 300, pcSizeY: 300, pcFld: 300 });
    const poly = computeFieldPolygon(state, config);

    expect(poly).toHaveLength(4);
    const bb = aabb(poly);
    expect(bb.x2 - bb.x1).toBeCloseTo(1000, 0);
  });

  it("single jaw at 0°: clips X dimension", () => {
    // Jaw leaf1=-50, leaf2=+50 at FLD=500, SID=1000 → d1=-100, d2=+100
    // PC is 300×300 at FLD=300 → ±500
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 } },
    });
    const config = makeConfig({
      pcSizeX: 300, pcSizeY: 300, pcFld: 300,
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    // X clipped to ±100 by jaw, Z bounded by PC at ±500
    expect(bb.x1).toBeCloseTo(-100, 0);
    expect(bb.x2).toBeCloseTo(100, 0);
    expect(bb.z1).toBeCloseTo(-500, 0);
    expect(bb.z2).toBeCloseTo(500, 0);
  });

  it("two orthogonal jaws clip both axes", () => {
    // Config rotation_deg is additive with state rotation_deg
    // Set rotation only in config (state defaults to 0)
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
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    expect(bb.x1).toBeCloseTo(-100, 0);
    expect(bb.x2).toBeCloseTo(100, 0);
    // Y jaw at 90°: d1=-120, d2=+120 → clips Z axis
    expect(bb.z1).toBeCloseTo(-120, 0);
    expect(bb.z2).toBeCloseTo(120, 0);
  });

  it("jaws fully closed (leaf1=0, leaf2=0) → degenerate polygon (zero width)", () => {
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: 0, leaf2: 0, fld_mm: 500 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    // Degenerate: all vertices on x=0, so x-width is zero
    expect(bb.x2 - bb.x1).toBeCloseTo(0, 5);
  });

  it("jaws wider than PC → polygon bounded by PC", () => {
    // PC is ±500, jaw aperture ±2000 at detector → PC clips
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -1000, leaf2: 1000, fld_mm: 500 } },
    });
    const config = makeConfig({
      pcSizeX: 300, pcSizeY: 300, pcFld: 300,
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    expect(bb.x1).toBeCloseTo(-500, 0);
    expect(bb.x2).toBeCloseTo(500, 0);
  });

  it("jaws_square: 4 half-planes → approximately square field", () => {
    const state = makeState({
      sid: 1000,
      modules: { sq: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 } },
    });
    const config = makeConfig({
      pcSizeX: 300, pcSizeY: 300, pcFld: 300,
      modules: [makeJawModule("sq", "jaws_square", 500, 0)],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    // Both X and Z clipped to ±100
    expect(bb.x2 - bb.x1).toBeCloseTo(200, 0);
    expect(bb.z2 - bb.z1).toBeCloseTo(200, 0);
  });

  it("global rotation NOT applied inside computeFieldPolygon", () => {
    // Same config with different collimator_rotation_deg should give same polygon
    const state1 = makeState({
      sid: 1000,
      collimator_rotation_deg: 0,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 } },
    });
    const state2 = makeState({
      sid: 1000,
      collimator_rotation_deg: 45,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });

    const poly1 = computeFieldPolygon(state1, config);
    const poly2 = computeFieldPolygon(state2, config);

    expect(poly1).toEqual(poly2);
  });

  it("state fld_mm override changes magnification", () => {
    // Default FLD=500 → 2×, override to 250 → 4×
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 250 } },
    });
    const config = makeConfig({
      pcSizeX: 300, pcSizeY: 300, pcFld: 300,
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    // With FLD=250: d = ±50 × (1000/250) = ±200
    expect(bb.x1).toBeCloseTo(-200, 0);
    expect(bb.x2).toBeCloseTo(200, 0);
  });

  it("asymmetric jaws: offset field center", () => {
    // leaf1=-20, leaf2=+80 → d1=-40, d2=+160 (offset center at +60)
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -20, leaf2: 80, fld_mm: 500 } },
    });
    const config = makeConfig({
      pcSizeX: 300, pcSizeY: 300, pcFld: 300,
      modules: [makeJawModule("jaws_x", "jaws_asymmetric", 500, 0)],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    expect(bb.x1).toBeCloseTo(-40, 0);
    expect(bb.x2).toBeCloseTo(160, 0);
  });

  it("non-jaw modules (wedge/prefilter) are skipped", () => {
    const state = makeState({
      sid: 1000,
      modules: {
        wedge_1: { rotation_deg: 0, enabled: true, lateral_offset_mm: 50 },
        prefilter: { rotation_deg: 0, angle_deg: 90 },
      },
    });
    const config = makeConfig({
      modules: [
        { id: "wedge_1", type: "wedge", fld_mm: 400, thickness_mm: 20 },
        { id: "prefilter", type: "prefilter", fld_mm: 200, thickness_mm: 10 },
      ],
    });
    const poly = computeFieldPolygon(state, config);

    // Should be unchanged PC polygon (no clipping)
    expect(poly).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Integration scenarios
// ---------------------------------------------------------------------------

describe("fieldPolygon integration", () => {
  it("standard 200×200mm field at detector", () => {
    const state = makeState({
      sid: 1000,
      modules: {
        jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 },
        jaws_y: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 },
      },
    });
    const config = makeConfig({
      pcSizeX: 300, pcSizeY: 300, pcFld: 300,
      modules: [
        makeJawModule("jaws_x", "jaws_rect", 500, 0),
        makeJawModule("jaws_y", "jaws_rect", 500, 90),
      ],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    expect(bb.x2 - bb.x1).toBeCloseTo(200, 0);
    expect(bb.z2 - bb.z1).toBeCloseTo(200, 0);
  });

  it("asymmetric field with center offset", () => {
    // jaws_x: leaf1=-20, leaf2=80 → d1=-40, d2=160 → width=200, center=60
    // jaws_y: leaf1=-50, leaf2=50 → d1=-100, d2=100 → width=200, center=0
    const state = makeState({
      sid: 1000,
      modules: {
        jaws_x: { rotation_deg: 0, leaf1: -20, leaf2: 80, fld_mm: 500 },
        jaws_y: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 },
      },
    });
    const config = makeConfig({
      pcSizeX: 300, pcSizeY: 300, pcFld: 300,
      modules: [
        makeJawModule("jaws_x", "jaws_asymmetric", 500, 0),
        makeJawModule("jaws_y", "jaws_rect", 500, 90),
      ],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    expect(bb.x1).toBeCloseTo(-40, 0);
    expect(bb.x2).toBeCloseTo(160, 0);
    expect((bb.x1 + bb.x2) / 2).toBeCloseTo(60, 0);
  });

  it("PC clipping limits field when jaws wider", () => {
    // PC: ±250, jaws: ±400 → field = ±250
    const state = makeState({
      sid: 1000,
      modules: {
        jaws_x: { rotation_deg: 0, leaf1: -200, leaf2: 200, fld_mm: 500 },
        jaws_y: { rotation_deg: 90, leaf1: -200, leaf2: 200, fld_mm: 500 },
      },
    });
    const config = makeConfig({
      pcSizeX: 150, pcSizeY: 150, pcFld: 300,
      modules: [
        makeJawModule("jaws_x", "jaws_rect", 500, 0),
        makeJawModule("jaws_y", "jaws_rect", 500, 90),
      ],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    // PC: 150 / 2 * (1000/300) = 250
    expect(bb.x2).toBeCloseTo(250, 0);
    expect(bb.z2).toBeCloseTo(250, 0);
  });

  it("dynamic FLD override doubles field width", () => {
    // Config FLD=500 (2×), override to FLD=250 (4×)
    // leaf1=-50, leaf2=50 → at FLD=250: d1=-200, d2=200
    const stateDefault = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 } },
    });
    const stateOverride = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 250 } },
    });
    const config = makeConfig({
      pcSizeX: 600, pcSizeY: 600, pcFld: 300,
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });

    const bbDefault = aabb(computeFieldPolygon(stateDefault, config));
    const bbOverride = aabb(computeFieldPolygon(stateOverride, config));

    expect(bbDefault.x2 - bbDefault.x1).toBeCloseTo(200, 0);
    expect(bbOverride.x2 - bbOverride.x1).toBeCloseTo(400, 0);
  });

  it("jaws_square produces square field from single module", () => {
    const state = makeState({
      sid: 1000,
      modules: { sq: { rotation_deg: 0, leaf1: -40, leaf2: 40, fld_mm: 500 } },
    });
    const config = makeConfig({
      pcSizeX: 600, pcSizeY: 600, pcFld: 300,
      modules: [makeJawModule("sq", "jaws_square", 500, 0)],
    });
    const poly = computeFieldPolygon(state, config);
    const bb = aabb(poly);

    const width = bb.x2 - bb.x1;
    const height = bb.z2 - bb.z1;
    expect(width).toBeCloseTo(160, 0);
    expect(height).toBeCloseTo(160, 0);
    expect(width).toBeCloseTo(height, 1);
  });
});
