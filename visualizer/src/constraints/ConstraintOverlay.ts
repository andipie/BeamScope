import type { ConstraintViolation } from "./ConstraintChecker.js";
import type { SceneUpdater } from "../scene/SceneUpdater.js";
import type { CollimatorConfig } from "../config/types.js";
import { stateStore } from "../state/StateStore.js";

/**
 * Applies constraint violation visual feedback to 3D objects and the UI.
 *
 * - 3D: delegates to SceneUpdater.applyViolations() for leaf coloring
 * - UI: populates #constraint-warnings container with violation messages
 * - Editor: renders editable min/max inputs per jaw module
 */
export class ConstraintOverlay {
  private sceneUpdater: SceneUpdater | null = null;
  private warningContainer: HTMLElement | null = null;

  /** Wire references after scene and DOM are ready. */
  init(sceneUpdater: SceneUpdater): void {
    this.sceneUpdater = sceneUpdater;
    this.warningContainer = document.getElementById("constraint-warnings");
  }

  /**
   * Update the visual state to reflect the current set of violations.
   * Call after checkConstraints() on every state update.
   */
  applyViolations(violations: ConstraintViolation[]): void {
    // 3D coloring
    this.sceneUpdater?.applyViolations(violations);

    // UI warning panel
    if (!this.warningContainer) return;

    if (violations.length === 0) {
      this.warningContainer.style.display = "none";
      this.warningContainer.innerHTML = "";
      return;
    }

    this.warningContainer.style.display = "";
    const messages = [...new Set(violations.map((v) => v.message))];
    this.warningContainer.innerHTML = messages
      .map((msg) => `<div class="constraint-warning-item">${msg}</div>`)
      .join("");
  }

  /**
   * Renders editable min/max inputs for each jaw module's constraints.
   * Changes modify the in-memory config only (no file write).
   * Takes effect immediately since checkConstraints() reads the live config.
   */
  renderConstraintEditor(container: HTMLElement, config: CollimatorConfig): void {
    let editorEl = container.querySelector("#constraint-editor") as HTMLElement | null;
    if (!editorEl) {
      editorEl = document.createElement("div");
      editorEl.id = "constraint-editor";
      container.appendChild(editorEl);
    }
    editorEl.innerHTML = "";

    const jawModules = config.modules.filter((m) =>
      m.type === "jaws_rect" || m.type === "jaws_square" || m.type === "jaws_asymmetric",
    );

    if (jawModules.length === 0) return;

    const title = document.createElement("div");
    title.style.cssText = "font-size:11px;color:#666;font-weight:600;margin-bottom:2px";
    title.textContent = "Constraints";
    editorEl.appendChild(title);

    for (const modConfig of jawModules) {
      // Ensure constraints object exists
      if (!modConfig.constraints) {
        modConfig.constraints = { min_mm: -Infinity, max_mm: Infinity };
      }

      const row = document.createElement("div");
      row.className = "constraint-editor-row";
      row.innerHTML =
        `<span class="constraint-editor-label">${modConfig.id}</span>` +
        `<label>min <input type="number" class="constraint-input" ` +
        `value="${modConfig.constraints.min_mm}" data-module="${modConfig.id}" data-bound="min_mm" /></label>` +
        `<label>max <input type="number" class="constraint-input" ` +
        `value="${modConfig.constraints.max_mm}" data-module="${modConfig.id}" data-bound="max_mm" /></label>`;
      editorEl.appendChild(row);
    }

    // Event delegation for input changes
    editorEl.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains("constraint-input")) return;
      const moduleId = target.dataset["module"];
      const bound = target.dataset["bound"] as "min_mm" | "max_mm" | undefined;
      const mod = config.modules.find((m) => m.id === moduleId);
      if (mod?.constraints && bound) {
        mod.constraints[bound] = parseFloat(target.value) || 0;
        // Trigger re-evaluation so violations update immediately
        stateStore.renotify();
      }
    });
  }
}
