// ---------------------------------------------------------------------------
// RingBuffer — FIFO time-series storage in uPlot-native format
// ---------------------------------------------------------------------------

export interface RingBufferOptions {
  /** Maximum number of samples (columns: 1 timestamp + traceCount traces). */
  capacity: number;
  /** Number of trace columns (excluding the timestamp column). */
  traceCount: number;
}

/**
 * Fixed-capacity ring buffer storing aligned parallel arrays.
 *
 * Data layout matches uPlot: index 0 = timestamps, indices 1..N = trace values.
 * Pre-allocates Float64Arrays to avoid GC pressure at 50Hz update rate.
 */
export class RingBuffer {
  private timestamps: Float64Array;
  private columns: Float64Array[];
  private head = 0;
  private count = 0;
  private cap: number;
  private readonly traceCount: number;

  constructor(options: RingBufferOptions) {
    this.cap = options.capacity;
    this.traceCount = options.traceCount;
    this.timestamps = new Float64Array(this.cap);
    this.columns = [];
    for (let i = 0; i < this.traceCount; i++) {
      this.columns.push(new Float64Array(this.cap));
    }
  }

  /** Append a sample. Overwrites oldest when buffer is full. */
  append(timestampSec: number, values: number[]): void {
    this.timestamps[this.head] = timestampSec;
    for (let i = 0; i < this.traceCount; i++) {
      this.columns[i]![this.head] = values[i] ?? 0;
    }
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  /** Get data in uPlot format: [timestamps[], trace1[], trace2[], ...]. */
  getData(): number[][] {
    if (this.count === 0) {
      const empty: number[][] = [[]];
      for (let i = 0; i < this.traceCount; i++) empty.push([]);
      return empty;
    }

    const len = this.count;
    const ts = new Array<number>(len);
    const cols: number[][] = [];
    for (let i = 0; i < this.traceCount; i++) {
      cols.push(new Array<number>(len));
    }

    // Read from tail to head (oldest → newest)
    const tail = this.count < this.cap ? 0 : this.head;
    for (let j = 0; j < len; j++) {
      const idx = (tail + j) % this.cap;
      ts[j] = this.timestamps[idx]!;
      for (let i = 0; i < this.traceCount; i++) {
        cols[i]![j] = this.columns[i]![idx]!;
      }
    }

    return [ts, ...cols];
  }

  /** Clear all data, reset pointers. */
  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Number of valid samples currently stored. */
  get length(): number {
    return this.count;
  }

  /** Current buffer capacity (max samples). */
  get capacity(): number {
    return this.cap;
  }

  /**
   * Resize the buffer capacity, preserving existing data.
   * - Growing: keeps all existing data, expands available space.
   * - Shrinking: keeps only the newest `newCapacity` samples.
   */
  resize(newCapacity: number): void {
    if (newCapacity === this.cap) return;

    const oldData = this.getData();
    const oldLen = oldData[0]?.length ?? 0;
    const keepCount = Math.min(oldLen, newCapacity);
    const offset = oldLen - keepCount; // skip oldest when shrinking

    this.timestamps = new Float64Array(newCapacity);
    this.columns = [];
    for (let i = 0; i < this.traceCount; i++) {
      this.columns.push(new Float64Array(newCapacity));
    }

    for (let j = 0; j < keepCount; j++) {
      this.timestamps[j] = oldData[0]![offset + j]!;
      for (let i = 0; i < this.traceCount; i++) {
        this.columns[i]![j] = oldData[i + 1]![offset + j]!;
      }
    }

    this.cap = newCapacity;
    this.head = keepCount % newCapacity;
    this.count = keepCount;
  }

  /** Estimated memory usage in bytes (Float64 = 8 bytes per value). */
  getMemoryBytes(): number {
    return (1 + this.traceCount) * this.cap * 8;
  }
}
