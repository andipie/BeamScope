import type { CollimatorConfig } from "./types.js";
import { validateConfig } from "./validator.js";

/**
 * Loads a CollimatorConfig from a URL (fetch) or a File object (drag-and-drop / file picker).
 * Both paths validate the parsed JSON via validateConfig().
 */

export async function loadConfigFromUrl(url: string): Promise<CollimatorConfig> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch config from ${url}: ${response.status} ${response.statusText}`);
  }
  const raw: unknown = await response.json();
  return validateConfig(raw);
}

export async function loadConfigFromFile(file: File): Promise<CollimatorConfig> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(`Invalid JSON in file "${file.name}": ${String(err)}`);
  }
  return validateConfig(raw);
}
