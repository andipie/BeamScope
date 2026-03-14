import { describe, it, expect } from "vitest";
import { buildCsvString } from "./exportCsv.js";
import type { TraceDefinition } from "./TraceRegistry.js";

/** Minimal trace definition for testing. */
function trace(id: string): TraceDefinition {
  return {
    id,
    moduleId: "test",
    parameter: id,
    unit: "mm",
    derived: false,
    extract: () => 0,
  };
}

describe("buildCsvString", () => {
  it("produces correct headers", () => {
    const traces = [trace("a.x"), trace("b.y")];
    const data: number[][] = [[], [], []];
    const csv = buildCsvString(data, traces);
    expect(csv).toBe("timestamp,a.x,b.y\n");
  });

  it("formats data rows with ISO timestamps", () => {
    const traces = [trace("t1"), trace("t2")];
    // 2025-01-01T00:00:00.000Z = 1735689600
    const data: number[][] = [[1735689600], [42], [7.5]];
    const csv = buildCsvString(data, traces);
    const lines = csv.trimEnd().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("timestamp,t1,t2");
    expect(lines[1]).toBe("2025-01-01T00:00:00.000Z,42,7.5");
  });

  it("handles multiple rows", () => {
    const traces = [trace("v")];
    const data: number[][] = [[100, 101, 102], [1, 2, 3]];
    const csv = buildCsvString(data, traces);
    const lines = csv.trimEnd().split("\n");
    expect(lines.length).toBe(4); // header + 3 rows
  });

  it("returns only header for empty data", () => {
    const traces = [trace("a"), trace("b")];
    const data: number[][] = [[], [], []];
    const csv = buildCsvString(data, traces);
    expect(csv).toBe("timestamp,a,b\n");
  });

  it("defaults missing trace values to 0", () => {
    const traces = [trace("a"), trace("b")];
    // Only 1 trace column provided, second is missing
    const data: number[][] = [[1000], [5]];
    const csv = buildCsvString(data, traces);
    const lines = csv.trimEnd().split("\n");
    expect(lines[1]).toContain(",5,0");
  });
});
