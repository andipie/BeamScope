import type { DataSource } from "../state/DataSource.js";
import type { CollimatorState, ModuleState } from "../state/CollimatorState.js";
import { DEFAULT_STATE } from "../state/CollimatorState.js";

/**
 * Generates collimator state from the schema-driven manual UI controls.
 *
 * - On activate(): populates internal state from last known StateStore state
 * - setModuleValue() is called by ManualControls on every control change
 * - Emits onStateUpdate() immediately on each change (no debounce at this level;
 *   debouncing is handled by ManualControls for slider events)
 *
 * TODO: implement full state management and ManualControls integration
 */
export class ManualSource implements DataSource {
  readonly id = "manual";
  readonly label = "Manual";

  onStateUpdate: (state: CollimatorState) => void = () => undefined;

  private state: CollimatorState = structuredClone(DEFAULT_STATE);
  private active = false;

  activate(): void {
    this.active = true;
    // Emit current state so scene reflects manual controls immediately
    this.onStateUpdate(this.state);
  }

  deactivate(): void {
    this.active = false;
    // Controls remain visible but are disabled — state is NOT reset
  }

  /**
   * Seed the internal state from the last known state (e.g. when switching from Simulation).
   * Called by ControlPanel before activate().
   */
  seedState(state: CollimatorState): void {
    this.state = structuredClone(state);
  }

  /** Update a top-level field (sid, collimator_rotation_deg). */
  setGlobalValue(key: keyof CollimatorState, value: number): void {
    // TODO: implement type-safe update
    (this.state as unknown as Record<string, unknown>)[key] = value;
    if (this.active) this.emit();
  }

  /** Update a field within a specific module's state. */
  setModuleValue(
    moduleId: string,
    key: string,
    value: ModuleState[string]
  ): void {
    if (!this.state.modules[moduleId]) {
      this.state.modules[moduleId] = { rotation_deg: 0 };
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.state.modules[moduleId]![key] = value;
    if (this.active) this.emit();
  }

  private emit(): void {
    this.onStateUpdate({ ...this.state, timestamp: Date.now() });
  }
}
