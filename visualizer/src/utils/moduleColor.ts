/**
 * Shared color utilities for module and leaf identification.
 *
 * Used by JawObject (3D), WedgeObject (3D), BEVAnnotations (2D), and BEVLegend.
 * The palette is colorblind-friendly (no red/green as sole distinguishing feature).
 * Red (0xff0000) is reserved exclusively for constraint violations.
 */

/** Colorblind-friendly palette — 8 perceptually distinct hues. */
const PALETTE: number[] = [
  0x3498db, // blue
  0xe67e22, // orange
  0x1abc9c, // teal
  0x9b59b6, // purple
  0xf1c40f, // gold
  0xe84393, // magenta-pink
  0x2c3e50, // dark slate
  0x00cec9, // cyan-teal
];

/**
 * Deterministic module color from module ID string.
 * Hash: sum of char codes, mod palette length.
 */
export function moduleColor(id: string): number {
  const h = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return PALETTE[h % PALETTE.length] ?? 0x888888;
}

/** CSS hex string for a Three.js-style hex number. */
export function moduleColorCSS(id: string): string {
  return `#${moduleColor(id).toString(16).padStart(6, "0")}`;
}

/** Leaf identifier — pair 1: leaf1/leaf2, pair 2 (jaws_square only): leaf3/leaf4. */
export type LeafName = "leaf1" | "leaf2" | "leaf3" | "leaf4";

/** Lighten a hex color by blending with white. */
function lightenHex(hex: number, amount = 0.3): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const lr = Math.round(r * (1 - amount) + 255 * amount);
  const lg = Math.round(g * (1 - amount) + 255 * amount);
  const lb = Math.round(b * (1 - amount) + 255 * amount);
  return (lr << 16) | (lg << 8) | lb;
}

/**
 * Per-leaf color.
 *
 * Pair 1 (leaf1/leaf2): base module color / lightened.
 * Pair 2 (leaf3/leaf4): next palette color / lightened — visually distinct from pair 1.
 */
export function leafColor(moduleId: string, leaf: LeafName): number {
  const h = [...moduleId].reduce((a, c) => a + c.charCodeAt(0), 0);

  if (leaf === "leaf3" || leaf === "leaf4") {
    // Pair 2 uses the NEXT palette entry for visual distinction
    const base2 = PALETTE[(h + 1) % PALETTE.length] ?? 0x888888;
    return leaf === "leaf3" ? base2 : lightenHex(base2);
  }

  const base = PALETTE[h % PALETTE.length] ?? 0x888888;
  return leaf === "leaf1" ? base : lightenHex(base);
}

/** CSS hex string for a specific leaf. */
export function leafColorCSS(moduleId: string, leaf: LeafName): string {
  return `#${leafColor(moduleId, leaf).toString(16).padStart(6, "0")}`;
}

/** Convert hex number to "r, g, b" string for use in rgba(). */
export function hexToRGB(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `${r}, ${g}, ${b}`;
}
