import type { CollimatorConfig, ModuleConfig, ModuleType } from "../core/config/types.js";
import type { CollimatorState } from "../core/state/CollimatorState.js";
import type { ConstraintViolation } from "../core/constraints/ConstraintChecker.js";
import { projectToDetector } from "../core/geometry/projection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AxisRow {
  moduleId: string;
  moduleType: ModuleType;
  axis: string; // "leaf1" | "leaf2" | "leaf3" | "leaf4" | "lateral_offset" | "angle"
  tr: HTMLTableRowElement;
  cells: {
    modRotation: HTMLTableCellElement;
    totalRotation: HTMLTableCellElement;
    leafPlane: HTMLTableCellElement;
    imagePlane: HTMLTableCellElement;
  };
  /** Previous cell values — used for change-flash detection. */
  prev: {
    modRotation: string;
    totalRotation: string;
    leafPlane: string;
    imagePlane: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the list of axis names for a given module type. */
function axesForType(type: ModuleType): string[] {
  switch (type) {
    case "jaws_rect":
    case "jaws_asymmetric":
      return ["leaf1", "leaf2"];
    case "jaws_square":
      return ["leaf1", "leaf2", "leaf3", "leaf4"];
    case "wedge":
      return ["lateral_offset"];
    case "prefilter":
      return ["angle"];
  }
}

/** Format a number to 1 decimal place. */
function fmt(v: number): string {
  return v.toFixed(1);
}

/** Flash a cell briefly when its value changes. */
function flashIfChanged(cell: HTMLTableCellElement, newValue: string, prevValue: string): void {
  if (newValue !== prevValue) {
    cell.setAttribute("data-changed", "");
    // Remove attribute after transition so next change can trigger again
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cell.removeAttribute("data-changed");
      });
    });
  }
}

// ---------------------------------------------------------------------------
// AxisDataTable
// ---------------------------------------------------------------------------

/**
 * Collapsible table showing all axis data for every movable element.
 *
 * Schema-driven: rows are generated from the loaded CollimatorConfig.
 * Updates cell text on every state change — no DOM rebuild.
 *
 * US-23
 */
export class AxisDataTable {
  private rows: AxisRow[] = [];
  private badge: HTMLSpanElement | null = null;

  /**
   * Builds the table structure from the loaded config.
   * Call once on config load (and again on config change).
   */
  buildFromConfig(container: HTMLElement, config: CollimatorConfig): void {
    container.innerHTML = "";
    this.rows = [];

    // Count total axes
    let axisCount = 0;
    for (const mod of config.modules) {
      axisCount += axesForType(mod.type).length;
    }

    if (axisCount === 0) return;

    // Collapsible wrapper
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Axis Data ";
    this.badge = document.createElement("span");
    this.badge.className = "axis-badge";
    this.badge.textContent = String(axisCount);
    summary.appendChild(this.badge);
    details.appendChild(summary);

    // Table
    const table = document.createElement("table");
    table.className = "axis-table";

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Module", "Axis", "Rot \u00B0", "Tot \u00B0", "Leaf mm", "Image mm"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    let moduleIndex = 0;

    for (const modConfig of config.modules) {
      const axes = axesForType(modConfig.type);
      const isEven = moduleIndex % 2 === 0;

      for (let i = 0; i < axes.length; i++) {
        const axis = axes[i]!;
        const tr = document.createElement("tr");
        if (isEven) tr.className = "module-group-even";

        // Module cell (show only on first row of this module)
        const tdModule = document.createElement("td");
        if (i === 0) {
          tdModule.textContent = modConfig.id;
          tdModule.style.fontWeight = "600";
          if (axes.length > 1) tdModule.rowSpan = axes.length;
        }
        if (i === 0) tr.appendChild(tdModule);

        // Axis cell
        const tdAxis = document.createElement("td");
        tdAxis.textContent = axis;
        tr.appendChild(tdAxis);

        // Value cells (will be updated by update())
        const tdModRot = document.createElement("td");
        const tdTotalRot = document.createElement("td");
        const tdLeafPlane = document.createElement("td");
        const tdImagePlane = document.createElement("td");

        tr.appendChild(tdModRot);
        tr.appendChild(tdTotalRot);
        tr.appendChild(tdLeafPlane);
        tr.appendChild(tdImagePlane);

        tbody.appendChild(tr);

        this.rows.push({
          moduleId: modConfig.id,
          moduleType: modConfig.type,
          axis,
          tr,
          cells: {
            modRotation: tdModRot,
            totalRotation: tdTotalRot,
            leafPlane: tdLeafPlane,
            imagePlane: tdImagePlane,
          },
          prev: {
            modRotation: "",
            totalRotation: "",
            leafPlane: "",
            imagePlane: "",
          },
        });
      }

      moduleIndex++;
    }

    table.appendChild(tbody);
    details.appendChild(table);
    container.appendChild(details);
  }

  /**
   * Updates all cell values from the current state.
   * Called on every state update — only touches textContent, no DOM rebuild.
   */
  update(state: CollimatorState, config: CollimatorConfig): void {
    for (const row of this.rows) {
      const modState = state.modules[row.moduleId];
      const modConfig = config.modules.find((m) => m.id === row.moduleId);
      if (!modState || !modConfig) continue;

      const fld = (modState.fld_mm as number | undefined) ?? modConfig.fld_mm;
      const modRot = modState.rotation_deg;
      const totalRot = modRot + state.collimator_rotation_deg;

      // Compute values based on axis type
      let modRotStr: string;
      let totalRotStr: string;
      let leafPlaneStr: string;
      let imagePlaneStr: string;

      if (row.axis === "angle") {
        // Prefilter: show angle_deg, no projection
        const angle = modState["angle_deg"];
        const angleVal = typeof angle === "number" ? angle : 0;
        modRotStr = fmt(modRot);
        totalRotStr = fmt(totalRot);
        leafPlaneStr = fmt(angleVal);
        imagePlaneStr = "\u2014";
      } else if (row.axis === "lateral_offset") {
        // Wedge: show lateral_offset_mm with projection
        const offset = modState["lateral_offset_mm"];
        const offsetVal = typeof offset === "number" ? offset : 0;
        modRotStr = fmt(modRot);
        totalRotStr = fmt(totalRot);
        leafPlaneStr = fmt(offsetVal);
        imagePlaneStr = fmt(projectToDetector(offsetVal, state.sid, fld));
      } else {
        // Jaw leaf (leaf1, leaf2, leaf3, leaf4)
        const leafVal = modState[row.axis];
        const pos = typeof leafVal === "number" ? leafVal : 0;
        modRotStr = fmt(modRot);
        totalRotStr = fmt(totalRot);
        leafPlaneStr = fmt(pos);
        imagePlaneStr = fmt(projectToDetector(pos, state.sid, fld));
      }

      // Apply to cells with change flash
      this.setCell(row, "modRotation", modRotStr);
      this.setCell(row, "totalRotation", totalRotStr);
      this.setCell(row, "leafPlane", leafPlaneStr);
      this.setCell(row, "imagePlane", imagePlaneStr);
    }
  }

  /**
   * Highlights rows that have constraint violations.
   */
  applyViolations(violations: ConstraintViolation[]): void {
    // Reset all
    for (const row of this.rows) {
      row.tr.classList.remove("constraint-violated");
      row.tr.title = "";
    }

    // Apply violations
    for (const v of violations) {
      for (const row of this.rows) {
        if (row.moduleId !== v.moduleId) continue;
        // leaf_crossing (v.leaf === null) highlights all leaves of the module
        if (v.leaf === null || row.axis === v.leaf) {
          row.tr.classList.add("constraint-violated");
          row.tr.title = row.tr.title ? row.tr.title + "; " + v.message : v.message;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private setCell(
    row: AxisRow,
    key: keyof AxisRow["cells"],
    value: string,
  ): void {
    const cell = row.cells[key];
    flashIfChanged(cell, value, row.prev[key]);
    cell.textContent = value;
    row.prev[key] = value;
  }
}
