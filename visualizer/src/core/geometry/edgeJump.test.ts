import { describe, it, expect } from "vitest";
import { imagingFace, imagingEdgeOffset, imagingEdgePosition } from "./edgeJump.js";

describe("imagingFace", () => {
  it("positive leaf → left face", () => {
    expect(imagingFace(50)).toBe("left");
  });

  it("negative leaf → right face", () => {
    expect(imagingFace(-50)).toBe("right");
  });

  it("zero → left face (convention)", () => {
    expect(imagingFace(0)).toBe("left");
  });
});

describe("imagingEdgeOffset", () => {
  it("positive leaf → negative offset (left face)", () => {
    expect(imagingEdgeOffset(50, 80)).toBe(-40);
  });

  it("negative leaf → positive offset (right face)", () => {
    expect(imagingEdgeOffset(-50, 80)).toBe(40);
  });

  it("zero leaf → negative offset (left face convention)", () => {
    expect(imagingEdgeOffset(0, 80)).toBe(-40);
  });
});

describe("imagingEdgePosition", () => {
  it("positive leaf: position + negative offset", () => {
    // 50 + (-40) = 10
    expect(imagingEdgePosition(50, 80)).toBe(10);
  });

  it("negative leaf: position + positive offset", () => {
    // -50 + 40 = -10
    expect(imagingEdgePosition(-50, 80)).toBe(-10);
  });

  it("symmetric edges: leaf1=-50, leaf2=+50 → edges at -10 and +10", () => {
    expect(imagingEdgePosition(-50, 80)).toBe(-10);
    expect(imagingEdgePosition(50, 80)).toBe(10);
  });

  it("zero-crossing discontinuity: tiny positive vs tiny negative", () => {
    const edgePos = imagingEdgePosition(0.001, 80);
    const edgeNeg = imagingEdgePosition(-0.001, 80);
    // 0.001 + (-40) = -39.999
    expect(edgePos).toBeCloseTo(-39.999, 3);
    // -0.001 + 40 = 39.999
    expect(edgeNeg).toBeCloseTo(39.999, 3);
    // Jump magnitude ≈ thickness
    expect(Math.abs(edgePos - edgeNeg)).toBeCloseTo(80, 0);
  });

  it("at exactly zero: edge at -half thickness", () => {
    expect(imagingEdgePosition(0, 80)).toBe(-40);
  });
});
