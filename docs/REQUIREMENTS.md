# Requirements & User Stories – BeamScope

All measurements in **mm**, angles in **degrees**, unless stated otherwise.

## Changelog

| Date | Change |
|---|---|
| 2026-03-05 | Initial version |
| 2026-03-05 | Epic 5: Modular collimator model added |
| 2026-03-05 | Epic 6: Mechanical constraints added |
| 2026-03-05 | FLD + leaf thickness + edge jump added |
| 2026-03-05 | Primary collimator (rectangular + circular) added |
| 2026-03-05 | Epic 8: Data source switching + schema-driven manual UI added |
| 2026-03-05 | Epic 9: Leaf contribution to imaging (edge visualization) added |
| 2026-03-06 | Epic 4: BEV Zoom & Pan added (US-22) |
| 2026-03-06 | US-12: Multiple module instances per type explicitly specified |
| 2026-03-06 | US-13: PC fully configurable; leaf-plane dimensions explicit; clipping visualization |
| 2026-03-06 | US-14: FLD-dependent projection complete (fieldRect, JawObject, ConeObject) |
| 2026-03-06 | US-15: Edge jump 3D-visible via dynamic body direction in JawObject |
| 2026-03-10 | Epic 10: Axis Data Table added (US-23) |
| 2026-03-10 | Epic 11: Scope View added (US-24, US-25, US-26); Multi-Page Architecture (US-27) |

---

## Architecture: Data Sources

The visualization has a central **state** that is populated by interchangeable data sources:

```
[Simulation]  UDP → Bridge → WebSocket ──┐
[Manual UI]   Schema-driven Controls    ──├──► Central State ──► 3D + BEV
[future]      Replay / File             ──┘
```

The active data source is switched via a **dropdown in the UI**.
Switching to "Manual" generates controls from the loaded `collimator.json`.
Switching to "Simulation" disables the controls; the data stream takes over.

---

## Epic 1: Data Reception & Interface

### US-01: UDP-to-WebSocket Bridge
As a developer I want to be able to start a local bridge server
that receives UDP packets from the simulation and forwards them as a WebSocket stream
to the browser, so that no special client needs to be installed.

**Acceptance criteria:**
- Bridge runs as a single script (`bun run bridge` or `npm start`)
- UDP port configurable (default: 5005)
- WebSocket port configurable (default: 8765)
- On connection loss the browser reconnects automatically
- Status display in UI: "Connected" / "Waiting for data..." / "Disconnected"

### US-02: Data Stream Format (JSON over WebSocket)
As a simulation I want to be able to send collimator parameters in a defined
JSON format so that the visualization interprets them correctly.

**Core principles:**
- The data stream is **modular and generic** – it has no fixed fields per module type
- `modules` is a map of module ID → dynamic values (key-value)
- Which keys are valid per module is determined by the type in the configuration (US-12)
- **All positional values refer to the leaf plane** (at FLD), never to the detector plane
- Projection to detector/BEV is solely the responsibility of the visualization
- Every module can have a `rotation_deg` – no exceptions
- `sid` appears exactly once (no `detector.distance_from_source`)
- Missing module entries → module stays at last known value (no reset)

**Data stream format (v2):**
```json
{
  "timestamp": 1234567890,
  "sid": 1000.0,
  "collimator_rotation_deg": 0.0,
  "focal_spot": { "x": 1.2, "y": 1.2 },
  "modules": {
    "prefilter": {
      "angle_deg": 45.0,
      "rotation_deg": 0.0
    },
    "jaws_x": {
      "leaf1": -50.0,
      "leaf2":  50.0,
      "rotation_deg": 0.0,
      "fld_mm": 500.0
    },
    "jaws_y": {
      "leaf1": -40.0,
      "leaf2":  40.0,
      "rotation_deg": 0.0,
      "fld_mm": 520.0
    },
    "jaws_asym_1": {
      "leaf1": -30.0,
      "leaf2":  80.0,
      "rotation_deg": 5.0,
      "fld_mm": 480.0
    },
    "wedge_1": {
      "enabled": true,
      "lateral_offset_mm": 0.0,
      "rotation_deg": 0.0
    }
  }
}
```

**Allowed keys per module type:**

| Module type | Allowed keys in data stream |
|---|---|
| `prefilter` | `angle_deg`, `rotation_deg` |
| `jaws_rect` | `leaf1`, `leaf2`, `rotation_deg`, `fld_mm` |
| `jaws_square` | `leaf1`, `leaf2`, `rotation_deg`, `fld_mm` |
| `jaws_asymmetric` | `leaf1`, `leaf2`, `rotation_deg`, `fld_mm` |
| `wedge` | `enabled`, `lateral_offset_mm`, `rotation_deg` |

**Coordinate reference (critical!):**
- `leaf1`, `leaf2`: leaf position **in the leaf plane** (mm, relative to central axis)
- `fld_mm`: focus-to-leaf distance, defines the height of the leaf plane
- Projection to detector plane: `pos_detector = pos_leaf × (sid / fld_mm)`
- The visualization must **never** interpret raw values directly as detector coordinates

**Acceptance criteria:**
- Missing top-level fields are filled with defaults (see table below)
- Startup defaults (applied when no data has arrived yet):

| Field | Default |
|---|---|
| `sid` | 1000 mm |
| `collimator_rotation_deg` | 0° |
| `focal_spot` | `{x: 1.0, y: 1.0}` mm |
| `leaf1`, `leaf2` per module | 0 mm |
| `rotation_deg` per module | 0° |
| `fld_mm` per module | value from collimator config |

- Missing top-level fields (`sid`, `focal_spot`) are filled with defaults
- Missing module entries leave the last known state of that module unchanged
- Unknown module IDs (not in the loaded configuration) are logged and ignored
- Unknown keys within a module are ignored (no crash)
- Invalid JSON packets are logged and discarded
- Timestamp is used for latency display

---

## Epic 2: 3D Visualization

### US-03: Beam Field as Cone
As a user I want to see the beam field as a 3D pyramid/cone
so that I understand its extent as a function of SID, FLD, and aperture.

**Acceptance criteria:**
- Cone extends from the focal spot to the detector
- Shape responds correctly to leaf positions, FLD, and SID (geometric projection)
- Cone is semi-transparent (modules visible through it)
- Central beam represented as a line
- Primary collimator clips the cone correctly – clipping is visualized (US-14)

### US-04: Jaw Modules
As a user I want to see all jaw modules as 3D objects
so that I can understand their position, thickness, and rotation in space.

**Acceptance criteria:**
- Each leaf rendered as a cuboid with its configured thickness (`thickness_mm`)
- Position derived from FLD and leaf position
- Imaging edge switches correctly when crossing the central axis (edge jump, US-16)
- Individual rotation of each module around the central beam visualized
- Global collimator rotation applied correctly on top
- Color coding: different modules in different colors
- Symmetric modules (rect/square) show both leaves mirrored

### US-05: Focus / Focal Spot
As a user I want to see the focal spot as a configurable geometry.

**Acceptance criteria:**
- Rendered as an ellipse/rectangle at the source position
- Size corresponds to `focal_spot_size.x/y`
- Always at the origin of the central axis (top)

### US-06: Wedge Filter
As a user I want to see a wedge filter as a 3D object in the beam path.

**Acceptance criteria:**
- Rendered as a cuboid (simplified)
- `enabled: false` hides it
- `lateral_offset_mm` shifts the wedge perpendicular to its long axis (distance from wedge symmetry line to central beam axis, in mm)
- Thickness scales the height of the cuboid
- Position in the module stack according to configuration

### US-07: Detector / Plate
As a user I want to see the detector as a reference surface.

**Acceptance criteria:**
- Flat plate at position `distance_from_source`
- Size corresponds to `detector.size`
- Projected beam field on the detector highlighted

### US-08: Pre-filter
As a user I want to see the pre-filter as a 3D disk
so that I can identify its current angle and the active filter segment.

**Acceptance criteria:**
- Rendered as a disk/cylinder with marked angle segments
- Current angle (`prefilter_angle_deg`) visibly rotates the disk
- Active segment highlighted
- Filter value label visible in the active segment

---

## Epic 3: 2D Top-down View (BEV)

### US-09: Beam's Eye View (BEV)
As a user I want to see a 2D view of the beam field from the source's perspective
so that I can read the field geometry precisely.

**Acceptance criteria:**
- BEV shows projection onto the detector plane
- Coordinate system with axis labels (X, Y in mm)
- Aperture of each module drawn
- Primary collimator drawn, clipping area marked (US-14)
- Collimator rotation correctly displayed
- Wedge filter position drawn (when enabled)
- Numeric display of field size (e.g. "100 x 80 mm @ detector")
- Constraint violations highlighted in red (US-17/18)

---

## Epic 4: Interaction & UX

### US-10: 3D Camera Control
As a user I want to be able to freely rotate, zoom, and pan the 3D view.

**Acceptance criteria:**
- Orbit controls (drag = rotate, scroll = zoom, right-click = pan)
- "Reset View" button
- Default view: slightly oblique, source at top, detector at bottom

### US-11: Two-view Layout
As a user I want to see the 3D and 2D views simultaneously.

**Acceptance criteria:**
- Split layout: 3D on the left (~60%), BEV on the right (~40%)
- Both views synchronized on new data
- Responsive down to 1280px width

### US-22: BEV Zoom & Pan
As a user I want to zoom and pan in the BEV panel
so that I can inspect field boundaries in detail.

**Acceptance criteria:**
- Mouse wheel zooms in/out, centred on the cursor position
- Left-click drag pans the view
- Double-click resets zoom and pan to the default view
- All BEV content (grid, field, aperture lines, crosshair) scales and moves correctly
- Axis tick labels adapt their interval to the current zoom level (remain readable)
- Field size text stays in the top-left corner regardless of zoom/pan
- Zoom range: 0.1× – 20×

---

## Epic 5: Modular Collimator Model

### US-12: Collimator Configuration as JSON
As a user I want to be able to define a collimator completely as a JSON file
so that I can load different collimator types without changing code.

**Module types:**

| Type | Description |
|---|---|
| `prefilter` | Rotating disk, angle segments → filter values |
| `jaws_rect` | Symmetric jaw pair, rectangular field |
| `jaws_square` | Symmetric jaw pair, square field |
| `jaws_asymmetric` | Two independently controllable leaves |
| `wedge` | Wedge filter |

**Example configuration:**
```json
{
  "collimator_id": "example-collimator-v1",
  "description": "Example collimator with two jaw pairs and wedge",
  "primary_collimator": {
    "shape": "rect",
    "size": { "x": 300.0, "y": 300.0 },
    "fld_mm": 150.0
  },
  "modules": [
    {
      "id": "prefilter",
      "type": "prefilter",
      "fld_mm": 200.0,
      "segments": [
        { "from_deg": 0,   "to_deg": 90,  "filter_value": "Al 1mm" },
        { "from_deg": 90,  "to_deg": 180, "filter_value": "Al 2mm" },
        { "from_deg": 180, "to_deg": 270, "filter_value": "Cu 0.1mm" },
        { "from_deg": 270, "to_deg": 360, "filter_value": "open" }
      ]
    },
    {
      "id": "jaws_x",
      "type": "jaws_rect",
      "fld_mm": 500.0,
      "thickness_mm": 80.0,
      "rotation_deg": 0.0,
      "constraints": { "min_mm": -150.0, "max_mm": 150.0 }
    },
    {
      "id": "jaws_y",
      "type": "jaws_rect",
      "fld_mm": 520.0,
      "thickness_mm": 80.0,
      "rotation_deg": 0.0,
      "constraints": { "min_mm": -150.0, "max_mm": 150.0 }
    },
    {
      "id": "wedge_1",
      "type": "wedge",
      "fld_mm": 600.0,
      "enabled": false,
      "lateral_offset_mm": 0.0,
      "thickness_mm": 50.0
    }
  ]
}
```

**Acceptance criteria:**
- Configuration loadable via file (drag & drop or file picker in UI)
- Validation on load: missing required fields are reported
- Multiple configurations storable and switchable
- `primary_collimator.shape`: `"rect"` or `"circle"` (with `radius_mm`)
- Each module type may appear **any number of times** in a collimator
  (e.g. multiple jaw pairs, multiple prefilter disks, multiple wedges)
- Each module is uniquely identified by its `id` field — IDs must be unique within a config
- Duplicate module IDs are rejected at load time with a descriptive error
- The number of modules is determined solely by the configuration file; no hard-coded limit exists

### US-13: Primary Collimator
As a user I want to see a primary collimator that limits the maximum beam field
so that I can tell when the variable jaws extend beyond the primary collimator.

**Acceptance criteria:**
- Primary collimator rendered as a 3D object (rectangle or circle/ellipse)
- When the jaw field exceeds the primary collimator: clipping area marked red in 3D and BEV
- Primary collimator is defined in the configuration (not in the data stream)
- All PC geometry parameters are freely configurable in the JSON:
  `shape` (`"rect"` / `"circle"` / `"ellipse"`), `fld_mm` (source-to-leaf-plane distance in mm),
  `size.x`/`size.y` for rect, `radius_mm` for circle/ellipse
- `size` and `radius_mm` specify aperture dimensions **at the leaf plane**
  (at `fld_mm` distance from the source); projection to the detector plane uses
  `pos_detector = pos_leaf × (SID / fld_mm)`
- Changes to the primary collimator config take effect immediately on config load

---

## Epic 6: Geometric Correctness

### US-14: FLD-dependent Projection
As a user I want the projection of the beam field to correctly account for each leaf's FLD
so that the displayed field boundaries are geometrically accurate.

**Acceptance criteria:**
- Field size on the detector is calculated correctly from FLD, leaf position, and SID
- FLD changes in the data stream are immediately reflected in the projection
- Different FLDs for X and Y jaw pairs are calculated independently

### US-15: Edge Jump at Leaf Thickness
As a user I want to see the edge jump that occurs when a leaf crosses the central axis
so that the real behavior of the collimator is visible.

**Acceptance criteria:**
- Imaging edge switches from front to back face when the leaf crosses the central axis
- Jump is visible in both 3D and BEV
- Leaf thickness (`thickness_mm`) is the determining parameter

---

## Epic 7: Mechanical Constraints

### US-16: End-stop Detection
As a user I want to see when a leaf reaches its configured end-stop.

**Acceptance criteria:**
- End-stop limits (`min_mm`, `max_mm`) definable per module in the configuration
- Limits also editable in the UI (without file reload)
- Violation: affected leaf colored red
- UI badge/warning with module name and direction (e.g. "jaws_x: leaf2 MAX")
- Multiple simultaneous violations are all displayed

### US-17: Leaf Crossing Detection (leaf1/leaf2)
As a user I want to see when leaf1 and leaf2 of the same module cross each other.

**Definition:** Crossing is detected position-based: violation when `leaf1 > leaf2`.
By convention, `leaf1` is always the negative-side leaf (left/bottom) and `leaf2` the positive-side leaf (right/top). Leaf thickness is NOT considered for crossing detection.

**Acceptance criteria:**
- Crossing is treated as a constraint violation (same visualization as US-16)
- Warning: "jaws_x: leaves crossed"
- Applies to all jaw module types

---

## Epic 8: Data Source Switching & Schema-driven Manual UI

### US-18: Data Source Switching
As a user I want to be able to switch between different data sources via dropdown
so that I can operate the visualization flexibly with the simulation or manual input.

**Data sources:**

| Option | Description |
|---|---|
| `Simulation` | WebSocket data stream from the bridge (UDP source) |
| `Manual` | Schema-driven UI, generated from the loaded collimator.json |

**Acceptance criteria:**
- Dropdown always visible, regardless of the current source
- When switching to "Manual": last known state is retained as the starting value
- When switching to "Simulation": manual controls are disabled (not hidden)
- Bridge connection status always visible, even in manual mode
- Data source architecture is extensible (e.g. for a future replay mode)

### US-19: Schema-driven Manual UI
As a user I want the manual controls to be automatically generated from the loaded
collimator configuration so that they work with any collimator configuration without code changes.

**Control types per parameter:**

| Parameter | Control | Details |
|---|---|---|
| Leaf position (leaf1, leaf2) | Slider + number input | Range from `constraints.min_mm` / `max_mm` |
| FLD per module | Slider + number input | Sensible default range e.g. 100–1000mm |
| Pre-filter angle | Slider + number input | 0–360°, shows active segment as read-only label |
| Collimator rotation (global) | Slider + number input | 0–360° |
| Module rotation (individual) | Slider + number input | 0–360° |
| Wedge enabled | Toggle (checkbox) | |
| Wedge lateral offset | Slider + number input | ±200 mm |
| SID | Slider + number input | Sensible range e.g. 500–2000mm |

**Structure of the generated UI:**
- One collapsible section (accordion) per module, title = `module.id`
- Global parameters (SID, collimator rotation) in a dedicated "Source & Collimator" section
- Section order = module order in the JSON

**Acceptance criteria:**
- UI is generated entirely from `collimator.json` – no hardcoded layout
- Loading a new configuration → UI updates immediately
- Slider and number input are bidirectionally synchronized (change in one = update in the other)
- Constraint violations: affected controls marked red, warning shown (warn only, do not clamp)
- Pre-filter angle slider shows below it read-only: currently active segment (e.g. "Al 2mm")
- All changes are immediately reflected in 3D + BEV (no "Apply" button needed)

---

## Epic 9: Leaf Contribution to Imaging

### US-20: Per-leaf Color Coding and Labeling (3D)
As a user I want to be able to tell at a glance in the 3D view which leaf contributes
to which part of the resulting beam field, so that I can intuitively understand the field geometry.

**Color concept:**
- Each leaf (leaf1, leaf2 of each module) receives a unique, consistent color
- The color is derived deterministically from the module ID (same ID = always same color)
- Color palette is high-contrast and colorblind-friendly (no red/green as the sole distinguishing feature)
- Constraint violations temporarily override the color with red (US-16/17)

**Transparency scheme:**
- Leaf cuboid: semi-transparent (~60% opacity) – modules behind are visible
- Imaging edge: full opacity, saturated color, slightly highlighted (e.g. thicker face or glow effect)
- Non-imaging edge: heavily dimmed (~20% opacity)

**Labeling:**
- Each leaf carries a 3D label with module ID + leaf designation (e.g. "jaws_x · L1")
- Label faces the camera (billboard), always readable
- Label positioned at the imaging edge

**Acceptance criteria:**
- Each leaf is visually assigned to a module ID unambiguously
- Imaging vs. non-imaging edge is identifiable without explanation
- Labels are readable in the default view (no overlap in a standard configuration)
- On edge jump (US-15) the highlight switches immediately to the new imaging edge
- Transparency scheme works correctly with the semi-transparent beam cone (no Z-fighting)

### US-21: Edge Visualization in BEV
As a user I want to see exactly in the BEV which leaf defines which field boundary
and its distance from the central axis, so that I can read the field geometry precisely.

**Display per imaging edge:**
- Colored line in the color of the corresponding leaf (consistent with 3D, US-20)
- Leaf label directly on the line (e.g. "jaws_x · L2")
- Numeric value of the edge position on the detector plane in mm (e.g. "+52.3 mm")
- Distance arrow from the central beam (origin) to the edge with length annotation
- Angle of the edge relative to the main axis in degrees (relevant for rotated module or global rotation)

**BEV layout:**
- Edge lines overlaid on top of the field rectangle, not beneath
- Labels positioned outside the field (no overlap with field content)
- Central beam marked as a cross (+) with coordinate (0, 0)
- Legend: small color box + module name for each visible leaf

**Acceptance criteria:**
- Each of the four field boundaries (for two jaw pairs) is assigned to a specific leaf
- Edge position in mm corresponds to the geometrically correct projection onto the detector plane (FLD-corrected)
- Angle display updates correctly on module or global rotation
- Distance arrow always shows the shortest distance from central beam to edge
- For primary collimator clipping (US-13): clipped edge is displayed differently (dashed etc.)
- Legend collapsible (to save space)

---

## Epic 10: Axis Data Table

### US-23: Tabular Axis Data Display
As a user I want to see a collapsible table showing all axis data for every movable element
so that I can read the exact numeric values (angles and positions) at a glance
without relying solely on the 3D or BEV view.

**Scope:**
The table includes one row per movable axis. Movable axes are:
- Each leaf of every jaw module (leaf1, leaf2) — two rows per jaw module
- Wedge filter (lateral offset as position)
- Pre-filter (angle as position)

The table is **schema-driven**: rows are generated from the loaded `collimator.json`,
analogous to the manual controls (US-19). Adding or removing modules in the configuration
automatically changes the table — no code changes required.

**Columns per axis:**

| Column | Description | Unit |
|---|---|---|
| Module | Module ID (e.g. `jaws_x`) | — |
| Axis | Axis designation (e.g. `leaf1`, `leaf2`, `lateral_offset`, `angle`) | — |
| Module rotation | Individual module rotation (`module.rotation_deg`) | ° |
| Axis angle | Angle of the ray from the focal spot through the axis position: `atan(pos_leaf / fld_mm)`, converted to degrees | ° |
| Total rotation | Sum of module rotation + global collimator rotation (`collimator_rotation_deg`) | ° |
| Position at leaf plane | Current axis position in the leaf plane (raw value from state) | mm |
| Position at image plane | Projected position on the detector plane: `pos_leaf × (SID / fld_mm)` | mm |

**For pre-filter:** "Position at leaf plane" shows the current angle (`angle_deg`),
"Position at image plane" is not applicable (displayed as `—`),
and "Axis angle" is not applicable (displayed as `—`).

**For wedge filter:** "Position at leaf plane" shows `lateral_offset_mm`,
"Position at image plane" shows the projected offset (`lateral_offset_mm × SID / fld_mm`),
and "Axis angle" shows `atan(lateral_offset_mm / fld_mm)` in degrees.

**Layout & interaction:**
- Table is rendered in a collapsible panel (accordion), default collapsed
- Panel title: "Axis Data" with a badge showing the number of axes (e.g. "Axis Data (6)")
- Panel is positioned below the control panel (right side of the UI)
- Rows are grouped by module (visual separator or alternating background)
- Row order = module order in the configuration

**Real-time behavior:**
- Table updates live on every state change (same frequency as 3D and BEV)
- Numeric values are displayed with 1 decimal place (e.g. `52.3 mm`, `3.1°`)
- Values that change between frames are briefly highlighted (e.g. subtle flash or bold transition)

**Constraint integration:**
- If a constraint violation exists for an axis (US-16, US-17), the corresponding row
  is highlighted red (consistent with 3D and BEV visualization)
- Constraint violation type is shown as a tooltip on the highlighted row

**Acceptance criteria:**
- Table is generated entirely from `collimator.json` — no hardcoded rows
- Loading a new configuration regenerates the table immediately
- All three angle columns are calculated correctly (module rotation, axis angle, total rotation)
- Leaf plane and image plane positions are geometrically consistent with 3D and BEV
- Axis angle uses `atan(pos_leaf / fld_mm)` and updates when position or FLD changes
- Table updates in real time (<100ms visible latency, consistent with US-03)
- Constraint violations are highlighted consistently with US-16/US-17
- Table is usable with any valid collimator configuration (1–N modules)
- Collapsible panel does not interfere with existing UI layout (3D + BEV + controls)
- Pre-filter and wedge rows display the correct subset of columns (with `—` for non-applicable fields)

---

## Epic 11: Scope View (Time-Series Visualization)

### US-24: Multi-Page Application Architecture
As a developer I want the application to be structured as a Vite multi-page app
with shared core logic so that the Scope view lives on a separate page
without duplicating geometry calculations, state types, or WebSocket client code.

**Architecture:**
- Two entry points: `index.html` (main visualization) and `scope.html` (scope view)
- Shared core library under `src/core/`:
  - `geometry/projection.ts` — FLD projection (`pos × SID / FLD`)
  - `geometry/edgeJump.ts` — edge jump calculation
  - `geometry/primaryClip.ts` — primary collimator clipping
  - `state/CollimatorState.ts` — state types
  - `state/StateStore.ts` — singleton state store
  - `config/types.ts`, `config/loader.ts`, `config/validator.ts` — config handling
  - `datasources/SimulationSource.ts` — WebSocket client
  - `constraints/ConstraintChecker.ts` — constraint detection
- Each page creates its own WebSocket connection to the bridge
  (bridge already supports multiple clients via broadcast)
- No SharedWorker required; shared logic is compile-time, not runtime

**Navigation:**
- Navigation link between pages (e.g. top bar: "Visualization" | "Scope")
- Both pages load the same `collimator.json` configuration
- Connection status indicator visible on both pages

**Acceptance criteria:**
- Both pages import shared core modules — no duplicated geometry or state logic
- Changes to projection logic in `core/geometry/` are effective on both pages
- Each page connects independently to the bridge WebSocket
- Vite builds both pages in a single `npm run build`
- A developer unfamiliar with the project can identify the shared code boundary in <5 minutes

### US-25: Scope View — Real-time Time-Series Chart
As a user I want a scope view that displays any selectable collimator value
as a real-time time-series graph so that I can observe value changes over time
and correlate movements across axes.

**Chart library:** uPlot (optimized for high-frequency time-series rendering).

**Available traces (all selectable):**
Every numeric value in `CollimatorState` is available as a trace:

| Category | Traces |
|---|---|
| Global | `sid`, `collimator_rotation_deg` |
| Per jaw module | `leaf1`, `leaf2`, `rotation_deg`, `fld_mm` |
| Per jaw module (derived) | `leaf1_image_plane`, `leaf2_image_plane` (projected: `pos × SID / FLD`) |
| Per jaw module (derived) | `leaf1_axis_angle`, `leaf2_axis_angle` (`atan(pos / fld)` in °) |
| Wedge | `lateral_offset_mm`, `rotation_deg`, `enabled` |
| Wedge (derived) | `lateral_offset_image_plane` (projected) |
| Pre-filter | `angle_deg`, `rotation_deg` |

Derived values are calculated using the shared `core/geometry/` functions — not re-implemented.

**Trace naming convention:** `{module_id}.{parameter}` (e.g. `jaws_x.leaf1`, `jaws_x.leaf1_image_plane`)

**Trace selection:**
- Sidebar or dropdown with checkboxes, grouped by module (same order as config)
- "Select all" / "Deselect all" per module group
- Maximum visible traces: no hard limit, but performance note at >20 active traces
- Each trace has a unique, deterministic color (derived from module ID + parameter, colorblind-friendly)
- Trace visibility toggleable by clicking the legend entry

**Chart behavior (oscilloscope-style):**
- Shared X-axis: time (relative to first sample or wall clock, selectable)
- Y-axis: auto-scaling per default, with option to lock Y-range manually
- Multiple Y-axes supported when traces have different units (mm vs. °)
- Crosshair cursor: vertical line snapping to nearest sample, tooltip showing all visible trace values
- Current values displayed in legend (updated at crosshair position or live at right edge)

**Acceptance criteria:**
- Any numeric value from the state (raw or derived) is selectable as a trace
- Derived values (image plane, axis angle) use shared `core/geometry/` functions
- Chart renders at ≥30 fps with 10 active traces and 60s of data at 50 Hz sample rate
- Trace colors are consistent and distinguishable (colorblind-safe palette)
- Crosshair shows exact values for all visible traces at the cursor position
- Chart axes auto-scale correctly when traces are added/removed
- Traces from the same module are visually grouped in the selection UI

### US-26: Scope View — Configurable Ring Buffer & Transport Controls
As a user I want to configure the time window of the scope and control recording
so that I can choose between a quick overview and a detailed analysis of longer sequences.

**Ring buffer:**
- Configurable buffer duration: 10s, 30s, 60s, 2min, 5min (selectable via dropdown)
- Buffer stores all trace data (not just visible traces) — enabling a trace retroactively shows past data
- Memory budget displayed (e.g. "Buffer: 45s / 60s, ~2.1 MB")
- When the buffer is full, oldest samples are discarded (FIFO)

**Transport controls:**
- **Run / Pause**: pauses chart scrolling and data display (buffer continues recording in background)
- **Clear**: empties the buffer and restarts recording
- When paused: chart is frozen, user can zoom/pan freely in the buffered data
- When resumed: chart jumps to live and continues scrolling

**Zoom & Pan:**
- Mouse wheel zooms the X-axis (time), centered on cursor position
- Click-drag pans the X-axis
- Double-click resets to live view (auto-scroll, full time range)
- Y-axis zoom via scroll on Y-axis area

**Export:**
- "Export CSV" button: exports all buffered data (all traces, not just visible) as CSV
- CSV format: `timestamp, trace1, trace2, ...` with trace names as column headers
- Filename: `beamscope-scope-{ISO-timestamp}.csv`

**Acceptance criteria:**
- Buffer duration is changeable at runtime without data loss (extending keeps existing data, shrinking truncates oldest)
- Pause/resume works without losing data (buffer records in background during pause)
- Zoom and pan are smooth (≥30 fps) even at maximum buffer size
- Export CSV contains all traces with correct timestamps
- Memory usage stays within reasonable bounds (~50 MB max at 5 min / 50 Hz / 30 traces)

---

## Non-functional Requirements

| Requirement | Target |
|---|---|
| Render latency (data → visible) | < 100ms |
| Scope chart frame rate | ≥ 30 fps with 10 active traces |
| Browser support | Chrome, Firefox (current version) |
| Setup time (developer) | < 15 minutes |
| Client dependencies | No installation (pure browser) |
| Server dependencies | Node.js or Bun |
| Collimator configuration | Loadable without code changes |
| Manual UI | Works with any valid collimator.json |
| Shared core logic | Geometry, state types, and WebSocket client not duplicated across pages |
