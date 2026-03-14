/**
 * Typed localStorage wrapper with "beamscope:" prefix.
 *
 * All values are JSON-serialized. Storage errors are silently caught
 * so callers never need try/catch.
 */

const PREFIX = "beamscope:";

export const persistence = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  /** For keys that store plain strings (e.g. source id). */
  getString(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },

  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable — silently ignore
    }
  },

  /** For keys that store plain strings (avoids JSON-wrapping). */
  setString(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      // Storage full or unavailable
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // Ignore
    }
  },
};
