import { describe, it, expect } from "vitest";
import { isEdgeClippedByPC, mmToPixel, collectEdges } from "./BEVAnnotations.js";
import { makeState, makeConfig, makeJawModule } from "../test-helpers.js";

// ---------------------------------------------------------------------------
// isEdgeClippedByPC
// ---------------------------------------------------------------------------

describe("isEdgeClippedByPC", () => {
  const pcProj = { x1: -200, x2: 200, z1: -200, z2: 200 };

  it("edge within PC → not clipped", () => {
    // At rotation 0: gx = 100, gz = 0 → within ±200
    expect(isEdgeClippedByPC(100, 0, pcProj)).toBe(false);
  });

  it("edge beyond PC → clipped", () => {
    // gx = 250, gz = 0 → beyond x2=200
    expect(isEdgeClippedByPC(250, 0, pcProj)).toBe(true);
  });

  it("negative edge beyond PC → clipped", () => {
    expect(isEdgeClippedByPC(-250, 0, pcProj)).toBe(true);
  });

  it("rotated edge within PC → not clipped", () => {
    // At 45°: gx = 100 × cos(45°) ≈ 70.7, gz = -100 × sin(45°) ≈ -70.7
    expect(isEdgeClippedByPC(100, Math.PI / 4, pcProj)).toBe(false);
  });

  it("rotated edge beyond PC → clipped", () => {
    // At 45°: gx = 300 × cos(45°) ≈ 212, beyond 200
    expect(isEdgeClippedByPC(300, Math.PI / 4, pcProj)).toBe(true);
  });

  it("at 0.5mm tolerance boundary — just inside", () => {
    // gx = 199.4 (just inside x2 - TOL = 199.5)
    expect(isEdgeClippedByPC(199.4, 0, pcProj)).toBe(false);
  });

  it("at 0.5mm tolerance boundary — just outside", () => {
    // gx = 199.6 (just outside x2 - TOL = 199.5)
    expect(isEdgeClippedByPC(199.6, 0, pcProj)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mmToPixel
// ---------------------------------------------------------------------------

describe("mmToPixel", () => {
  // Canvas: 800×600, center = (400, 300), scale=1, pan=0
  const cx = 400, cy = 300, s = 1, px = 0, py = 0;

  it("origin maps to canvas center", () => {
    const [x, y] = mmToPixel(0, 0, 0, 0, s, cx, cy, px, py);
    expect(x).toBe(cx);
    expect(y).toBe(cy);
  });

  it("positive X → rightward in pixel space", () => {
    const [x, y] = mmToPixel(100, 0, 0, 0, s, cx, cy, px, py);
    expect(x).toBe(cx + 100);
    expect(y).toBe(cy);
  });

  it("positive Z → upward in mm = lower py (Y-flip)", () => {
    const [x, y] = mmToPixel(0, 100, 0, 0, s, cx, cy, px, py);
    expect(x).toBe(cx);
    expect(y).toBe(cy - 100); // Y-flip: gz positive → py decreases
  });

  it("scale factor applies correctly", () => {
    const [x, y] = mmToPixel(100, 0, 0, 0, 2, cx, cy, px, py);
    expect(x).toBe(cx + 200); // 100 × scale(2)
    expect(y).toBe(cy);
  });

  it("pan offset applies", () => {
    const [x, y] = mmToPixel(0, 0, 0, 0, s, cx, cy, 10, -20);
    expect(x).toBe(cx + 10);
    expect(y).toBe(cy - 20);
  });

  it("module rotation 90° rotates point", () => {
    // modRot = PI/2, point (100, 0) → after negated rotation (-PI/2):
    // x = 100*cos(-PI/2) - 0*sin(-PI/2) = 0
    // z = 100*sin(-PI/2) + 0*cos(-PI/2) = -100
    // Then no collimator rotation → gx=0, gz=-100
    // px = cx + 0 = cx, py = cy - (-100) = cy + 100
    const [x, y] = mmToPixel(100, 0, Math.PI / 2, 0, s, cx, cy, px, py);
    expect(x).toBeCloseTo(cx, 0);
    expect(y).toBeCloseTo(cy + 100, 0);
  });

  it("module + collimator rotation compose", () => {
    // Both 45° → total 90° negated → -90°
    const rot45 = Math.PI / 4;
    const [x, y] = mmToPixel(100, 0, rot45, rot45, s, cx, cy, px, py);
    // Combined: point rotated by -90° → (100,0) → (0, -100)
    // gx = 0, gz = -100 → px = cx, py = cy + 100
    expect(x).toBeCloseTo(cx, 0);
    expect(y).toBeCloseTo(cy + 100, 0);
  });

  it("roundtrip with zero rotation preserves values", () => {
    const [x, y] = mmToPixel(42, 77, 0, 0, s, cx, cy, px, py);
    // Reverse: xMm = (x - cx) / s, zMm = -(y - cy) / s
    const xMm = (x - cx) / s;
    const zMm = -(y - cy) / s;
    expect(xMm).toBeCloseTo(42, 5);
    expect(zMm).toBeCloseTo(77, 5);
  });
});

// ---------------------------------------------------------------------------
// collectEdges
// ---------------------------------------------------------------------------

describe("collectEdges", () => {
  it("jaws_rect → 2 edges with correct posDetector", () => {
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -50, leaf2: 50, fld_mm: 500 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const edges = collectEdges(state, config);

    expect(edges).toHaveLength(2);
    expect(edges[0]!.leafName).toBe("leaf1");
    expect(edges[0]!.posDetector).toBeCloseTo(-100, 0);
    expect(edges[1]!.leafName).toBe("leaf2");
    expect(edges[1]!.posDetector).toBeCloseTo(100, 0);
  });

  it("jaws_square → 4 edges (pair 2 at +90°)", () => {
    const state = makeState({
      sid: 1000,
      modules: { sq: { rotation_deg: 0, leaf1: -40, leaf2: 40, fld_mm: 500 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("sq", "jaws_square", 500, 0)],
    });
    const edges = collectEdges(state, config);

    expect(edges).toHaveLength(4);
    expect(edges[0]!.leafName).toBe("leaf1");
    expect(edges[1]!.leafName).toBe("leaf2");
    expect(edges[2]!.leafName).toBe("leaf3");
    expect(edges[3]!.leafName).toBe("leaf4");

    // Pair 2 has +90° rotation
    expect(edges[2]!.modRotDeg).toBe(90);
    expect(edges[3]!.modRotDeg).toBe(90);
  });

  it("FLD override affects projected positions", () => {
    // FLD=250 → 4× mag, leaf ±40 → ±160
    const state = makeState({
      sid: 1000,
      modules: { jaws_x: { rotation_deg: 0, leaf1: -40, leaf2: 40, fld_mm: 250 } },
    });
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const edges = collectEdges(state, config);

    expect(edges[0]!.posDetector).toBeCloseTo(-160, 0);
    expect(edges[1]!.posDetector).toBeCloseTo(160, 0);
  });

  it("non-jaw modules are excluded", () => {
    const state = makeState({
      sid: 1000,
      modules: {
        wedge_1: { rotation_deg: 0, enabled: true, lateral_offset_mm: 0 },
        prefilter: { rotation_deg: 0, angle_deg: 90 },
      },
    });
    const config = makeConfig({
      modules: [
        { id: "wedge_1", type: "wedge", fld_mm: 400, thickness_mm: 20 },
        { id: "prefilter", type: "prefilter", fld_mm: 200, thickness_mm: 10 },
      ],
    });
    const edges = collectEdges(state, config);

    expect(edges).toHaveLength(0);
  });

  it("missing module state → module skipped", () => {
    const state = makeState({ sid: 1000 }); // no modules in state
    const config = makeConfig({
      modules: [makeJawModule("jaws_x", "jaws_rect", 500, 0)],
    });
    const edges = collectEdges(state, config);

    expect(edges).toHaveLength(0);
  });
});
