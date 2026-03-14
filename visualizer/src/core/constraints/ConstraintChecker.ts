import type { CollimatorState } from "../state/CollimatorState.js";
import type { CollimatorConfig } from "../config/types.js";

export type ViolationType = "end_stop_min" | "end_stop_max" | "leaf_crossing";

export interface ConstraintViolation {
  moduleId: string;
  /** Which leaf triggered the violation. null for leaf_crossing (involves both). */
  leaf: "leaf1" | "leaf2" | null;
  type: ViolationType;
  /** Human-readable description, e.g. "jaws_x: leaf2 MAX" or "jaws_x: leaves crossed" */
  message: string;
}

/**
 * Checks all mechanical constraints for the current state against the loaded config.
 * Runs synchronously after every state update, before rendering.
 *
 * Constraint types (see REQUIREMENTS.md US-16, US-17):
 *   end_stop_min  — leaf < constraints.min_mm
 *   end_stop_max  — leaf > constraints.max_mm
 *   leaf_crossing — leaf1 > leaf2 (position-based; leaf1 = negative-side, leaf2 = positive-side)
 *
 * Values are NOT clamped — violations are only reported.
 *
 * @returns list of all current violations (empty if none)
 */
export function checkConstraints(
  state: CollimatorState,
  config: CollimatorConfig
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const modConfig of config.modules) {
    const modState = state.modules[modConfig.id];
    if (!modState) continue;

    const type = modConfig.type;
    const isJaw =
      type === "jaws_rect" ||
      type === "jaws_square" ||
      type === "jaws_asymmetric";

    if (!isJaw) continue;

    const leaf1 = modState["leaf1"];
    const leaf2 = modState["leaf2"];

    if (typeof leaf1 !== "number" || typeof leaf2 !== "number") continue;

    // End-stop checks
    if (modConfig.constraints) {
      const { min_mm, max_mm } = modConfig.constraints;

      if (leaf1 < min_mm) {
        violations.push({
          moduleId: modConfig.id,
          leaf: "leaf1",
          type: "end_stop_min",
          message: `${modConfig.id}: leaf1 MIN`,
        });
      }
      if (leaf1 > max_mm) {
        violations.push({
          moduleId: modConfig.id,
          leaf: "leaf1",
          type: "end_stop_max",
          message: `${modConfig.id}: leaf1 MAX`,
        });
      }
      if (leaf2 < min_mm) {
        violations.push({
          moduleId: modConfig.id,
          leaf: "leaf2",
          type: "end_stop_min",
          message: `${modConfig.id}: leaf2 MIN`,
        });
      }
      if (leaf2 > max_mm) {
        violations.push({
          moduleId: modConfig.id,
          leaf: "leaf2",
          type: "end_stop_max",
          message: `${modConfig.id}: leaf2 MAX`,
        });
      }
    }

    // Leaf crossing: leaf1 (negative-side) must be <= leaf2 (positive-side)
    if (leaf1 > leaf2) {
      violations.push({
        moduleId: modConfig.id,
        leaf: null,
        type: "leaf_crossing",
        message: `${modConfig.id}: leaves crossed`,
      });
    }
  }

  return violations;
}
