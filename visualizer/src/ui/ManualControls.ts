import type { CollimatorConfig, ModuleConfig, ModuleType, PrefilterSegment } from "../core/config/types.js";
import type { ManualSource } from "../core/datasources/ManualSource.js";
import type { CollimatorState } from "../core/state/CollimatorState.js";
import type { ConstraintViolation } from "../core/constraints/ConstraintChecker.js";
import { stateStore } from "../core/state/StateStore.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

interface SliderInputOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  moduleId?: string;
  field: string;
  onChange: (value: number) => void;
}

function createSliderInputRow(opts: SliderInputOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "manual-control-row";

  const lbl = document.createElement("label");
  lbl.textContent = opts.label;
  row.appendChild(lbl);

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(opts.min);
  range.max = String(opts.max);
  range.step = String(opts.step);
  range.value = String(opts.value);
  if (opts.moduleId) range.dataset["module"] = opts.moduleId;
  range.dataset["field"] = opts.field;
  row.appendChild(range);

  const num = document.createElement("input");
  num.type = "number";
  num.step = String(opts.step);
  num.value = String(opts.value);
  if (opts.moduleId) num.dataset["module"] = opts.moduleId;
  num.dataset["field"] = opts.field;
  row.appendChild(num);

  if (opts.unit) {
    const unit = document.createElement("span");
    unit.className = "control-unit";
    unit.textContent = opts.unit;
    row.appendChild(unit);
  }

  // Bidirectional sync with debounced callback
  const fire = debounce(() => opts.onChange(parseFloat(num.value) || 0), 30);

  range.addEventListener("input", () => {
    num.value = range.value;
    fire();
  });
  num.addEventListener("input", () => {
    range.value = num.value;
    fire();
  });

  return row;
}

interface ToggleOptions {
  label: string;
  checked: boolean;
  moduleId: string;
  field: string;
  onChange: (checked: boolean) => void;
}

function createToggleRow(opts: ToggleOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "manual-control-row";

  const lbl = document.createElement("label");
  lbl.textContent = opts.label;
  row.appendChild(lbl);

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = opts.checked;
  cb.dataset["module"] = opts.moduleId;
  cb.dataset["field"] = opts.field;
  row.appendChild(cb);

  cb.addEventListener("change", () => opts.onChange(cb.checked));

  return row;
}

function createReadonlyRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "manual-control-row";

  const lbl = document.createElement("label");
  lbl.textContent = label;
  row.appendChild(lbl);

  const span = document.createElement("span");
  span.className = "readonly-value";
  span.textContent = value;
  row.appendChild(span);

  return row;
}

function getActiveSegmentLabel(angle: number, segments: PrefilterSegment[]): string {
  if (segments.length === 0) return "—";
  const norm = ((angle % 360) + 360) % 360;
  // Handle segments that wrap across the 0°/360° boundary (from_deg > to_deg, e.g. 350→10)
  let idx = segments.findIndex((s) =>
    s.from_deg < s.to_deg
      ? norm >= s.from_deg && norm < s.to_deg
      : norm >= s.from_deg || norm < s.to_deg,
  );
  return idx !== -1 ? (segments[idx]?.filter_value ?? "—") : "—";
}

// ---------------------------------------------------------------------------
// Per-type control generators (schema-driven registry)
// ---------------------------------------------------------------------------

type ModuleControlGenerator = (
  container: HTMLElement,
  modConfig: ModuleConfig,
  state: CollimatorState,
  source: ManualSource,
) => void;

/** Asymmetric jaw controls: independent leaf1 + leaf2 sliders. */
function generateJawControls(
  container: HTMLElement,
  modConfig: ModuleConfig,
  state: CollimatorState,
  source: ManualSource,
): void {
  const modState = state.modules[modConfig.id];
  const minC = modConfig.constraints?.min_mm ?? -200;
  const maxC = modConfig.constraints?.max_mm ?? 200;

  container.appendChild(
    createSliderInputRow({
      label: "leaf1",
      min: minC,
      max: maxC,
      step: 0.5,
      value: typeof modState?.leaf1 === "number" ? modState.leaf1 : 0,
      unit: "mm",
      moduleId: modConfig.id,
      field: "leaf1",
      onChange: (v) => source.setModuleValue(modConfig.id, "leaf1", v),
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "leaf2",
      min: minC,
      max: maxC,
      step: 0.5,
      value: typeof modState?.leaf2 === "number" ? modState.leaf2 : 0,
      unit: "mm",
      moduleId: modConfig.id,
      field: "leaf2",
      onChange: (v) => source.setModuleValue(modConfig.id, "leaf2", v),
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "FLD",
      min: 100,
      max: 1000,
      step: 1,
      value: typeof modState?.fld_mm === "number" ? modState.fld_mm : modConfig.fld_mm,
      unit: "mm",
      moduleId: modConfig.id,
      field: "fld_mm",
      onChange: (v) => source.setModuleValue(modConfig.id, "fld_mm", v),
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "Rotation",
      min: -360,
      max: 360,
      step: 0.5,
      value: modState?.rotation_deg ?? 0,
      unit: "°",
      moduleId: modConfig.id,
      field: "rotation_deg",
      onChange: (v) => source.setModuleValue(modConfig.id, "rotation_deg", v),
    }),
  );
}

/** Symmetric jaw controls: single "Aperture" slider sets leaf1=-v, leaf2=+v. */
function generateSymmetricJawControls(
  container: HTMLElement,
  modConfig: ModuleConfig,
  state: CollimatorState,
  source: ManualSource,
): void {
  const modState = state.modules[modConfig.id];
  const maxC = modConfig.constraints?.max_mm ?? 200;

  // Current aperture = leaf2 (positive side); fallback to 100 (default half-opening)
  const currentAperture =
    typeof modState?.leaf2 === "number" ? Math.abs(modState.leaf2 as number) : 100;

  container.appendChild(
    createSliderInputRow({
      label: "Aperture",
      min: 0,
      max: maxC,
      step: 0.5,
      value: currentAperture,
      unit: "mm",
      moduleId: modConfig.id,
      field: "leaf2",
      onChange: (v) => {
        source.setModuleValue(modConfig.id, "leaf1", -v);
        source.setModuleValue(modConfig.id, "leaf2", v);
      },
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "FLD",
      min: 100,
      max: 1000,
      step: 1,
      value: typeof modState?.fld_mm === "number" ? modState.fld_mm : modConfig.fld_mm,
      unit: "mm",
      moduleId: modConfig.id,
      field: "fld_mm",
      onChange: (v) => source.setModuleValue(modConfig.id, "fld_mm", v),
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "Rotation",
      min: -360,
      max: 360,
      step: 0.5,
      value: modState?.rotation_deg ?? 0,
      unit: "°",
      moduleId: modConfig.id,
      field: "rotation_deg",
      onChange: (v) => source.setModuleValue(modConfig.id, "rotation_deg", v),
    }),
  );
}

function generatePrefilterControls(
  container: HTMLElement,
  modConfig: ModuleConfig,
  state: CollimatorState,
  source: ManualSource,
): void {
  const modState = state.modules[modConfig.id];
  const segments = (modConfig["segments"] as PrefilterSegment[] | undefined) ?? [];
  const currentAngle = typeof modState?.angle_deg === "number" ? modState.angle_deg : 0;

  // Segment label (created first so the angle callback can update it)
  const segmentRow = createReadonlyRow("Segment", getActiveSegmentLabel(currentAngle, segments));

  container.appendChild(
    createSliderInputRow({
      label: "Angle",
      min: -720,
      max: 720,
      step: 0.5,
      value: currentAngle,
      unit: "°",
      moduleId: modConfig.id,
      field: "angle_deg",
      onChange: (v) => {
        source.setModuleValue(modConfig.id, "angle_deg", v);
        const span = segmentRow.querySelector(".readonly-value") as HTMLElement | null;
        if (span) span.textContent = getActiveSegmentLabel(v, segments);
      },
    }),
  );

  container.appendChild(segmentRow);

  container.appendChild(
    createSliderInputRow({
      label: "FLD",
      min: 100,
      max: 1000,
      step: 1,
      value: typeof modState?.fld_mm === "number" ? modState.fld_mm : modConfig.fld_mm,
      unit: "mm",
      moduleId: modConfig.id,
      field: "fld_mm",
      onChange: (v) => source.setModuleValue(modConfig.id, "fld_mm", v),
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "Rotation",
      min: -360,
      max: 360,
      step: 0.5,
      value: modState?.rotation_deg ?? 0,
      unit: "°",
      moduleId: modConfig.id,
      field: "rotation_deg",
      onChange: (v) => source.setModuleValue(modConfig.id, "rotation_deg", v),
    }),
  );
}

function generateWedgeControls(
  container: HTMLElement,
  modConfig: ModuleConfig,
  state: CollimatorState,
  source: ManualSource,
): void {
  const modState = state.modules[modConfig.id];

  container.appendChild(
    createToggleRow({
      label: "Enabled",
      checked: modState?.enabled === true,
      moduleId: modConfig.id,
      field: "enabled",
      onChange: (v) => source.setModuleValue(modConfig.id, "enabled", v),
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "Lat. Offset",
      min: -200,
      max: 200,
      step: 1,
      value: typeof modState?.lateral_offset_mm === "number" ? modState.lateral_offset_mm : 0,
      unit: "mm",
      moduleId: modConfig.id,
      field: "lateral_offset_mm",
      onChange: (v) => source.setModuleValue(modConfig.id, "lateral_offset_mm", v),
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "FLD",
      min: 100,
      max: 1000,
      step: 1,
      value: typeof modState?.fld_mm === "number" ? modState.fld_mm : modConfig.fld_mm,
      unit: "mm",
      moduleId: modConfig.id,
      field: "fld_mm",
      onChange: (v) => source.setModuleValue(modConfig.id, "fld_mm", v),
    }),
  );

  container.appendChild(
    createSliderInputRow({
      label: "Rotation",
      min: -360,
      max: 360,
      step: 0.5,
      value: modState?.rotation_deg ?? 0,
      unit: "°",
      moduleId: modConfig.id,
      field: "rotation_deg",
      onChange: (v) => source.setModuleValue(modConfig.id, "rotation_deg", v),
    }),
  );
}

const MODULE_GENERATORS: Record<ModuleType, ModuleControlGenerator> = {
  jaws_rect: generateSymmetricJawControls,
  jaws_square: generateSymmetricJawControls,
  jaws_asymmetric: generateJawControls,
  wedge: generateWedgeControls,
  prefilter: generatePrefilterControls,
};

// ---------------------------------------------------------------------------
// ManualControls class
// ---------------------------------------------------------------------------

/**
 * Schema-driven manual control UI generator.
 *
 * Generates controls exclusively from the loaded CollimatorConfig.
 * No hardcoded layout, no module-specific if/else blocks.
 * A registry maps ModuleType → generator function.
 */
export class ManualControls {
  private container: HTMLElement | null = null;
  private source: ManualSource | null = null;

  /** Render the control panel from the given config. Call after config is loaded. */
  render(container: HTMLElement, config: CollimatorConfig, source: ManualSource): void {
    this.container = container;
    this.source = source;
    container.innerHTML = "";

    const state = stateStore.getState();

    this.generateGlobalSection(container, state);

    for (const modConfig of config.modules) {
      this.generateModuleSection(container, modConfig, state);
    }
  }

  /** Update constraint violation highlights. Call after checkConstraints(). */
  applyViolations(violations: ConstraintViolation[]): void {
    if (!this.container) return;

    // Reset all constraint highlights
    for (const el of this.container.querySelectorAll(".constraint-violated")) {
      el.classList.remove("constraint-violated");
    }

    for (const v of violations) {
      const selector = v.leaf
        ? `[data-module="${v.moduleId}"][data-field="${v.leaf}"]`
        : `[data-module="${v.moduleId}"]`;
      for (const el of this.container.querySelectorAll(selector)) {
        el.classList.add("constraint-violated");
      }
    }
  }

  /** Enable or disable all manual controls (US-18: disabled when simulation is active). */
  setEnabled(enabled: boolean): void {
    if (!this.container) return;
    if (enabled) {
      this.container.classList.remove("disabled");
    } else {
      this.container.classList.add("disabled");
    }
  }

  private generateGlobalSection(container: HTMLElement, state: CollimatorState): void {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "Global";
    details.appendChild(summary);

    const content = document.createElement("div");
    content.className = "module-controls";

    content.appendChild(
      createSliderInputRow({
        label: "SID",
        min: 500,
        max: 2000,
        step: 1,
        value: state.sid,
        unit: "mm",
        field: "sid",
        onChange: (v) => this.source?.setGlobalValue("sid", v),
      }),
    );

    content.appendChild(
      createSliderInputRow({
        label: "Coll. Rot.",
        min: -360,
        max: 360,
        step: 0.5,
        value: state.collimator_rotation_deg,
        unit: "°",
        field: "collimator_rotation_deg",
        onChange: (v) => this.source?.setGlobalValue("collimator_rotation_deg", v),
      }),
    );

    details.appendChild(content);
    container.appendChild(details);
  }

  private generateModuleSection(
    container: HTMLElement,
    modConfig: ModuleConfig,
    state: CollimatorState,
  ): void {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = modConfig.id;
    details.appendChild(summary);

    const content = document.createElement("div");
    content.className = "module-controls";

    const generator = MODULE_GENERATORS[modConfig.type];
    generator(content, modConfig, state, this.source!);

    details.appendChild(content);
    container.appendChild(details);
  }
}
