import { describe, it, expect } from "vitest";
import { intersectRects, type Rect } from "./primaryClip.js";

describe("intersectRects", () => {
  it("overlapping rectangles → correct intersection", () => {
    const a: Rect = { x1: -100, x2: 50, z1: -80, z2: 60 };
    const b: Rect = { x1: -30, x2: 100, z1: -40, z2: 80 };
    const result = intersectRects(a, b);
    expect(result).toEqual({ x1: -30, x2: 50, z1: -40, z2: 60 });
  });

  it("contained rectangle → inner rect returned", () => {
    const outer: Rect = { x1: -200, x2: 200, z1: -200, z2: 200 };
    const inner: Rect = { x1: -50, x2: 50, z1: -50, z2: 50 };
    expect(intersectRects(outer, inner)).toEqual(inner);
  });

  it("disjoint rectangles → null", () => {
    const a: Rect = { x1: -100, x2: -50, z1: -100, z2: -50 };
    const b: Rect = { x1: 50, x2: 100, z1: 50, z2: 100 };
    expect(intersectRects(a, b)).toBeNull();
  });

  it("touching edge (zero-area) → null", () => {
    const a: Rect = { x1: -100, x2: 0, z1: -100, z2: 100 };
    const b: Rect = { x1: 0, x2: 100, z1: -100, z2: 100 };
    expect(intersectRects(a, b)).toBeNull();
  });

  it("identical rectangles → returns same rect", () => {
    const r: Rect = { x1: -50, x2: 50, z1: -50, z2: 50 };
    expect(intersectRects(r, r)).toEqual(r);
  });

  it("partial overlap on one axis only → null", () => {
    const a: Rect = { x1: -100, x2: 100, z1: -100, z2: -50 };
    const b: Rect = { x1: -100, x2: 100, z1: 50, z2: 100 };
    expect(intersectRects(a, b)).toBeNull();
  });

  it("is commutative", () => {
    const a: Rect = { x1: -100, x2: 50, z1: -80, z2: 60 };
    const b: Rect = { x1: -30, x2: 100, z1: -40, z2: 80 };
    expect(intersectRects(a, b)).toEqual(intersectRects(b, a));
  });
});
