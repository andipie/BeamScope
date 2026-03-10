import { describe, it, expect } from "vitest";
import { projectToDetector, projectToLeafPlane } from "./projection.js";

describe("projectToDetector", () => {
  it("standard 2× magnification (SID=1000, FLD=500)", () => {
    expect(projectToDetector(50, 1000, 500)).toBe(100);
  });

  it("identity when SID = FLD", () => {
    expect(projectToDetector(75, 1000, 1000)).toBe(75);
  });

  it("zero leaf position maps to zero", () => {
    expect(projectToDetector(0, 1000, 500)).toBe(0);
  });

  it("negative leaf position", () => {
    expect(projectToDetector(-50, 1000, 500)).toBe(-100);
  });

  it("minification when FLD > SID", () => {
    expect(projectToDetector(-50, 500, 1000)).toBe(-25);
  });

  it("large magnification (SID=2000, FLD=100)", () => {
    expect(projectToDetector(10, 2000, 100)).toBe(200);
  });

  it("fractional FLD", () => {
    expect(projectToDetector(30, 1000, 333)).toBeCloseTo(90.09, 1);
  });

  it("REQUIREMENTS example: ±50 leaf at FLD=500, SID=1000 → 200mm field width", () => {
    const left = projectToDetector(-50, 1000, 500);
    const right = projectToDetector(50, 1000, 500);
    expect(right - left).toBe(200);
  });
});

describe("projectToLeafPlane", () => {
  it("standard demagnification", () => {
    expect(projectToLeafPlane(100, 1000, 500)).toBe(50);
  });

  it("identity when SID = FLD", () => {
    expect(projectToLeafPlane(75, 1000, 1000)).toBe(75);
  });
});

describe("roundtrip", () => {
  it("forward → inverse returns original value", () => {
    const posLeaf = 42;
    const det = projectToDetector(posLeaf, 1000, 500);
    expect(projectToLeafPlane(det, 1000, 500)).toBeCloseTo(posLeaf);
  });

  it("inverse → forward returns original value", () => {
    const posDet = 120;
    const leaf = projectToLeafPlane(posDet, 1000, 500);
    expect(projectToDetector(leaf, 1000, 500)).toBeCloseTo(posDet);
  });

  it("roundtrip over many values", () => {
    for (let v = -150; v <= 150; v += 10) {
      const det = projectToDetector(v, 1000, 500);
      const back = projectToLeafPlane(det, 1000, 500);
      expect(back).toBeCloseTo(v, 10);
    }
  });
});
