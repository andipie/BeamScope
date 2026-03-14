import type { TraceDefinition } from "./TraceRegistry.js";

/**
 * Generate a CSV string from ring buffer data and trace definitions.
 *
 * Format: `timestamp,trace1.id,trace2.id,...` with ISO 8601 timestamps.
 * All traces are included (not just visible ones).
 */
export function buildCsvString(
  data: number[][],
  traces: readonly TraceDefinition[],
): string {
  const header = "timestamp," + traces.map((t) => t.id).join(",");
  const timestamps = data[0];
  if (!timestamps || timestamps.length === 0) return header + "\n";

  const lines: string[] = [header];
  for (let j = 0; j < timestamps.length; j++) {
    const ts = new Date(timestamps[j]! * 1000).toISOString();
    let row = ts;
    for (let i = 0; i < traces.length; i++) {
      row += "," + (data[i + 1]?.[j] ?? 0);
    }
    lines.push(row);
  }
  return lines.join("\n") + "\n";
}

/**
 * Export all buffered trace data as CSV and trigger a browser download.
 *
 * US-26
 */
export function exportScopeCsv(
  data: number[][],
  traces: readonly TraceDefinition[],
): void {
  const csv = buildCsvString(data, traces);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `beamscope-scope-${ts}.csv`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
