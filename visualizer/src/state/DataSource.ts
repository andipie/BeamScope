import type { CollimatorState } from "./CollimatorState.js";

/**
 * All data sources (Simulation, Manual, future Replay) implement this interface.
 * They write into the central state by calling onStateUpdate().
 * The visualization layer never references a DataSource directly — it only reads StateStore.
 */
export interface DataSource {
  readonly id: string;
  readonly label: string;

  /**
   * Called when this source becomes the active source.
   * Should start receiving / generating data and call onStateUpdate() on each update.
   */
  activate(): void;

  /**
   * Called when another source is selected.
   * Should stop producing updates and release resources (e.g. close WebSocket).
   * The last known state is NOT reset — it stays in StateStore until the next update.
   */
  deactivate(): void;

  /**
   * Callback set by StateStore. The DataSource calls this with each new state.
   * Partial states are merged by StateStore (missing module entries keep last known value).
   */
  onStateUpdate: (state: CollimatorState) => void;
}
