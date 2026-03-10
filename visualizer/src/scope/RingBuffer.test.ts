import { describe, it, expect } from "vitest";
import { RingBuffer } from "./RingBuffer.js";

describe("RingBuffer", () => {
  it("appends and retrieves samples", () => {
    const buf = new RingBuffer({ capacity: 100, traceCount: 2 });
    buf.append(1.0, [10, 20]);
    buf.append(2.0, [30, 40]);
    buf.append(3.0, [50, 60]);

    expect(buf.length).toBe(3);
    const data = buf.getData();
    // [timestamps, trace0, trace1]
    expect(data.length).toBe(3);
    expect(data[0]).toEqual([1.0, 2.0, 3.0]);
    expect(data[1]).toEqual([10, 30, 50]);
    expect(data[2]).toEqual([20, 40, 60]);
  });

  it("overwrites oldest on overflow (FIFO)", () => {
    const buf = new RingBuffer({ capacity: 3, traceCount: 1 });
    buf.append(1.0, [10]);
    buf.append(2.0, [20]);
    buf.append(3.0, [30]);
    buf.append(4.0, [40]); // overwrites sample at t=1.0

    expect(buf.length).toBe(3);
    const data = buf.getData();
    expect(data[0]).toEqual([2.0, 3.0, 4.0]);
    expect(data[1]).toEqual([20, 30, 40]);
  });

  it("handles wrap-around correctly", () => {
    const buf = new RingBuffer({ capacity: 4, traceCount: 1 });
    for (let i = 1; i <= 6; i++) {
      buf.append(i, [i * 10]);
    }
    expect(buf.length).toBe(4);
    const data = buf.getData();
    expect(data[0]).toEqual([3, 4, 5, 6]);
    expect(data[1]).toEqual([30, 40, 50, 60]);
  });

  it("clears all data", () => {
    const buf = new RingBuffer({ capacity: 10, traceCount: 2 });
    buf.append(1.0, [10, 20]);
    buf.append(2.0, [30, 40]);
    buf.clear();

    expect(buf.length).toBe(0);
    const data = buf.getData();
    expect(data[0]).toEqual([]);
    expect(data[1]).toEqual([]);
    expect(data[2]).toEqual([]);
  });

  it("returns correct number of columns", () => {
    const buf = new RingBuffer({ capacity: 10, traceCount: 5 });
    buf.append(1.0, [1, 2, 3, 4, 5]);
    const data = buf.getData();
    // 1 timestamp + 5 traces = 6 arrays
    expect(data.length).toBe(6);
  });

  it("returns empty arrays when no data", () => {
    const buf = new RingBuffer({ capacity: 10, traceCount: 3 });
    const data = buf.getData();
    expect(data.length).toBe(4);
    for (const col of data) {
      expect(col).toEqual([]);
    }
  });

  it("defaults missing values to 0", () => {
    const buf = new RingBuffer({ capacity: 10, traceCount: 3 });
    buf.append(1.0, [10]); // only 1 value for 3 traces
    const data = buf.getData();
    expect(data[1]).toEqual([10]);
    expect(data[2]).toEqual([0]);
    expect(data[3]).toEqual([0]);
  });
});
