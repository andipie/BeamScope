/**
 * Deterministic trace colors for the scope chart.
 *
 * 16-color colorblind-friendly palette. Each trace gets a unique color
 * derived from a hash of its trace ID string.
 */

const SCOPE_PALETTE: string[] = [
  "#3498db", // blue
  "#e67e22", // orange
  "#1abc9c", // teal
  "#9b59b6", // purple
  "#f1c40f", // gold
  "#e84393", // magenta-pink
  "#00cec9", // cyan-teal
  "#27ae60", // green
  "#2980b9", // darker blue
  "#d35400", // burnt orange
  "#16a085", // dark teal
  "#8e44ad", // dark purple
  "#f39c12", // amber
  "#2ecc71", // emerald
  "#e74c3c", // coral
  "#6c5ce7", // indigo
];

/** Deterministic CSS hex color for a trace ID. */
export function traceColor(traceId: string): string {
  const h = [...traceId].reduce((a, c) => a + c.charCodeAt(0), 0);
  return SCOPE_PALETTE[h % SCOPE_PALETTE.length]!;
}
