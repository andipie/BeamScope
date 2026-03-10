import { DEFAULT_STATE } from "./CollimatorState.js";
import type { CollimatorState } from "./CollimatorState.js";
import type { CollimatorConfig } from "../config/types.js";
import type { DataSource } from "./DataSource.js";

type Subscriber = (state: CollimatorState) => void;

/**
 * Central singleton state store.
 *
 * - Holds the current CollimatorState and CollimatorConfig.
 * - Notifies all subscribers synchronously on every state update.
 * - Merges incoming partial states: missing module entries keep their last known value.
 * - On config change, state is reset to defaults (modules map cleared).
 */
class StateStore {
  private state: CollimatorState = structuredClone(DEFAULT_STATE);
  private config: CollimatorConfig | null = null;
  private activeSource: DataSource | null = null;
  private readonly subscribers = new Set<Subscriber>();

  // --- Subscriptions ---

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private notify(): void {
    for (const cb of this.subscribers) {
      cb(this.state);
    }
  }

  /** Re-notify all subscribers with the current state (e.g. after config mutation). */
  renotify(): void {
    this.notify();
  }

  // --- State ---

  getState(): CollimatorState {
    return this.state;
  }

  /**
   * Merge an incoming state update.
   * Top-level fields (sid, collimator_rotation_deg, focal_spot) are replaced when present.
   * Module entries are merged: missing modules keep their last known ModuleState.
   */
  setState(incoming: CollimatorState): void {
    const knownIds = this.config
      ? new Set(this.config.modules.map((m) => m.id))
      : null;

    const filteredModules: CollimatorState["modules"] = {};
    for (const [id, modState] of Object.entries(incoming.modules)) {
      if (knownIds !== null && !knownIds.has(id)) {
        console.warn(`[StateStore] Unknown module ID "${id}" in data stream — ignoring`);
        continue;
      }
      filteredModules[id] = modState;
    }

    // Deep merge: preserve existing module fields not present in the incoming update.
    // A shallow spread at module level would lose e.g. leaf1/leaf2 when only rotation_deg is sent.
    const mergedModules: CollimatorState["modules"] = { ...this.state.modules };
    for (const [id, incomingMod] of Object.entries(filteredModules)) {
      mergedModules[id] = { ...mergedModules[id], ...incomingMod };
    }

    this.state = {
      timestamp: incoming.timestamp,
      sid: incoming.sid,
      collimator_rotation_deg: incoming.collimator_rotation_deg,
      focal_spot: incoming.focal_spot,
      modules: mergedModules,
    };
    this.notify();
  }

  // --- Config ---

  getConfig(): CollimatorConfig | null {
    return this.config;
  }

  /**
   * Load a new collimator config.
   * Resets state to defaults (modules map cleared, per-module fld restored from config).
   */
  setConfig(config: CollimatorConfig): void {
    this.config = config;
    // Reset dynamic state; each module starts from defaults
    const modules: CollimatorState["modules"] = {};
    for (const mod of config.modules) {
      const base: CollimatorState["modules"][string] = {
        rotation_deg: 0, // data-stream rotation_deg is a dynamic delta; static base is in config
        fld_mm: mod.fld_mm,
      };
      if (mod.type === "jaws_rect" || mod.type === "jaws_square" || mod.type === "jaws_asymmetric") {
        // Jaw modules start open (200 mm field at leaf plane) so the beam field is clearly visible
        base.leaf1 = -100;
        base.leaf2 = 100;
      } else if (mod.type === "prefilter") {
        base.angle_deg = 0;
      } else if (mod.type === "wedge") {
        base.enabled = (mod["enabled"] as boolean) ?? false;
        base.lateral_offset_mm = (mod["lateral_offset_mm"] as number) ?? 0;
      }
      modules[mod.id] = base;
    }
    this.state = {
      ...structuredClone(DEFAULT_STATE),
      modules,
    };
    this.notify();
  }

  // --- Data source management ---

  getActiveSource(): DataSource | null {
    return this.activeSource;
  }

  /**
   * Switch the active data source.
   * Deactivates the current source (if any) before activating the new one.
   * The current state is preserved (no reset) across source switches.
   */
  setActiveSource(source: DataSource): void {
    if (this.activeSource) {
      this.activeSource.deactivate();
    }
    this.activeSource = source;
    // Wire the callback so the source writes into this store
    source.onStateUpdate = (s) => this.setState(s);
    source.activate();
  }
}

// Export singleton instance
export const stateStore = new StateStore();
