import type { TraceDefinition } from "./TraceRegistry.js";
import { traceColor } from "./traceColors.js";
import { persistence } from "../core/persistence.js";

export type TraceVisibilityCallback = (visibleTraceIds: Set<string>) => void;

const PERSIST_KEY = "scope-traces";

/**
 * Sidebar UI: checkbox groups for trace selection, grouped by module.
 *
 * Follows the same <details>/<summary> accordion pattern as ManualControls.
 * Persists visibility selection to localStorage.
 * US-25
 */
export class TraceSelector {
  private container: HTMLElement;
  private visibleTraces = new Set<string>();
  private onChange: TraceVisibilityCallback;

  constructor(container: HTMLElement, onChange: TraceVisibilityCallback) {
    this.container = container;
    this.onChange = onChange;
  }

  /** Build the checkbox tree from trace definitions. */
  build(traces: readonly TraceDefinition[]): void {
    this.container.innerHTML = "";

    // Restore persisted trace selection (only keep IDs that exist in current traces)
    const savedIds = persistence.get<string[]>(PERSIST_KEY);
    const validIds = new Set(traces.map((t) => t.id));
    this.visibleTraces.clear();
    if (savedIds) {
      for (const id of savedIds) {
        if (validIds.has(id)) this.visibleTraces.add(id);
      }
    }

    // Group traces by moduleId (preserving order)
    const groups = new Map<string, TraceDefinition[]>();
    for (const t of traces) {
      let list = groups.get(t.moduleId);
      if (!list) {
        list = [];
        groups.set(t.moduleId, list);
      }
      list.push(t);
    }

    for (const [moduleId, moduleTraces] of groups) {
      const details = document.createElement("details");
      details.open = true;

      const summary = document.createElement("summary");
      const labelText = document.createElement("span");
      labelText.textContent = moduleId === "global" ? "Global" : moduleId;
      summary.appendChild(labelText);

      // All / None buttons
      const btnAll = document.createElement("button");
      btnAll.className = "trace-btn-all";
      btnAll.textContent = "All";
      btnAll.addEventListener("click", (e) => {
        e.preventDefault();
        for (const t of moduleTraces) this.visibleTraces.add(t.id);
        this.updateCheckboxes(details);
        this.persistVisibility();
        this.onChange(new Set(this.visibleTraces));
      });

      const btnNone = document.createElement("button");
      btnNone.className = "trace-btn-none";
      btnNone.textContent = "None";
      btnNone.addEventListener("click", (e) => {
        e.preventDefault();
        for (const t of moduleTraces) this.visibleTraces.delete(t.id);
        this.updateCheckboxes(details);
        this.persistVisibility();
        this.onChange(new Set(this.visibleTraces));
      });

      summary.appendChild(btnAll);
      summary.appendChild(btnNone);
      details.appendChild(summary);

      // Trace checkboxes
      const list = document.createElement("div");
      list.className = "trace-list";

      for (const t of moduleTraces) {
        const label = document.createElement("label");
        label.className = "trace-item";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.traceId = t.id;
        cb.checked = this.visibleTraces.has(t.id);
        cb.addEventListener("change", () => {
          if (cb.checked) {
            this.visibleTraces.add(t.id);
          } else {
            this.visibleTraces.delete(t.id);
          }
          this.persistVisibility();
          this.onChange(new Set(this.visibleTraces));
        });

        const swatch = document.createElement("span");
        swatch.className = "trace-swatch";
        swatch.style.background = traceColor(t.id);

        const name = document.createElement("span");
        name.className = "trace-name";
        name.textContent = t.parameter;

        const unit = document.createElement("span");
        unit.className = "trace-unit";
        unit.textContent = t.unit === "bool" ? "0/1" : t.unit;

        label.appendChild(cb);
        label.appendChild(swatch);
        label.appendChild(name);
        label.appendChild(unit);

        if (t.derived) label.classList.add("trace-derived");

        list.appendChild(label);
      }

      details.appendChild(list);
      this.container.appendChild(details);
    }

    // Notify chart of restored trace visibility
    if (this.visibleTraces.size > 0) {
      this.onChange(new Set(this.visibleTraces));
    }
  }

  /** Returns the set of currently visible trace IDs. */
  getVisibleTraces(): ReadonlySet<string> {
    return this.visibleTraces;
  }

  /** Sync checkbox states after programmatic changes. */
  private updateCheckboxes(root: HTMLElement): void {
    const cbs = root.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    for (const cb of cbs) {
      cb.checked = this.visibleTraces.has(cb.dataset.traceId ?? "");
    }
  }

  private persistVisibility(): void {
    persistence.set(PERSIST_KEY, [...this.visibleTraces]);
  }
}
