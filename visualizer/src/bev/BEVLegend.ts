import type { CollimatorConfig } from "../config/types.js";
import { leafColorCSS } from "../utils/moduleColor.js";
import type { LeafName } from "../utils/moduleColor.js";

/**
 * Collapsible HTML legend overlay for the BEV panel.
 * Shows a color swatch + label for each jaw leaf, consistent with the edge line colors.
 * Positioned absolute in the bottom-right corner of the BEV panel.
 */
export class BEVLegend {
  private readonly container: HTMLElement;
  private readonly contentEl: HTMLElement;
  private collapsed = false;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "bev-legend";

    const header = document.createElement("div");
    header.className = "bev-legend-header";

    const title = document.createElement("span");
    title.textContent = "Legend";
    header.appendChild(title);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "bev-legend-toggle";
    toggleBtn.textContent = "\u25BC"; // ▼
    toggleBtn.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.contentEl.style.display = this.collapsed ? "none" : "";
      toggleBtn.textContent = this.collapsed ? "\u25B6" : "\u25BC";
    });
    header.appendChild(toggleBtn);

    this.container.appendChild(header);

    this.contentEl = document.createElement("div");
    this.contentEl.className = "bev-legend-content";
    this.container.appendChild(this.contentEl);

    parent.appendChild(this.container);
  }

  /** Rebuild legend entries from the current config. */
  update(config: CollimatorConfig): void {
    this.contentEl.innerHTML = "";

    for (const mod of config.modules) {
      if (!["jaws_rect", "jaws_square", "jaws_asymmetric"].includes(mod.type)) continue;

      // Pair 1: L1/L2 (all jaw types); Pair 2: L3/L4 (jaws_square only)
      const leaves: { name: LeafName; suffix: string }[] = [
        { name: "leaf1", suffix: "L1" },
        { name: "leaf2", suffix: "L2" },
      ];
      if (mod.type === "jaws_square") {
        leaves.push({ name: "leaf3", suffix: "L3" }, { name: "leaf4", suffix: "L4" });
      }

      for (const { name, suffix } of leaves) {
        const row = document.createElement("div");
        row.className = "bev-legend-item";

        const swatch = document.createElement("span");
        swatch.className = "bev-legend-swatch";
        swatch.style.backgroundColor = leafColorCSS(mod.id, name);

        const label = document.createElement("span");
        label.textContent = `${mod.id} \u00b7 ${suffix}`;

        row.appendChild(swatch);
        row.appendChild(label);
        this.contentEl.appendChild(row);
      }
    }
  }
}
