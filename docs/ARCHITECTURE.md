# Architecture: BeamScope

> This document is the authoritative architecture reference. It is updated after every significant
> system change.

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                BROWSER                                        │
│                                                                               │
│  ┌─────────────────────────────────────┐  ┌────────────────────────────┐    │
│  │   Main Page (index.html)            │  │   Scope Page (scope.html)  │    │
│  │                                      │  │                            │    │
│  │  ┌───────────┐  ┌──────────────┐   │  │  ┌──────────────────────┐  │    │
│  │  │ scene/    │  │ bev/         │   │  │  │ scope/               │  │    │
│  │  │ Three.js  │  │ Canvas 2D    │   │  │  │ uPlot time-series    │  │    │
│  │  │ 3D View   │  │ BEV          │   │  │  │ RingBuffer           │  │    │
│  │  └───────────┘  └──────────────┘   │  │  │ TraceSelector        │  │    │
│  │  ┌───────────┐  ┌──────────────┐   │  │  │ TransportControls    │  │    │
│  │  │ objects/  │  │ ui/          │   │  │  └──────────────────────┘  │    │
│  │  │ constraints│  │ ControlPanel │   │  │                            │    │
│  │  └───────────┘  │ ManualControls│   │  └─────────────┬──────────────┘    │
│  │                  │ AxisDataTable │   │                │                    │
│  │                  └──────────────┘   │                │                    │
│  └──────────────┬──────────────────────┘                │                    │
│                 │                                        │                    │
│                 ▼                                        ▼                    │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │                    Shared Core (src/core/)                          │      │
│  │                                                                     │      │
│  │  config/          state/            geometry/        constraints/   │      │
│  │  Loader           CollimatorState   projection.ts    Checker        │      │
│  │  Validator        StateStore        edgeJump.ts                     │      │
│  │  types.ts         DataSource        primaryClip.ts                  │      │
│  │                                                                     │      │
│  │  datasources/                                                       │      │
│  │  SimulationSource (WebSocket client)                                │      │
│  │  ManualSource                                                       │      │
│  └──────────────────────────┬─────────────────────────────────────────┘      │
│                              │                                                │
└──────────────────────────────┼────────────────────────────────────────────────┘
                               │ WebSocket (ws://) — one connection per page
                               │
                    ┌─────────────────────┐
                    │  Bridge Server      │
                    │  (Bun/Node.js)      │
                    │                     │
                    │  UDP ──► WS Bridge  │
                    │  dgram + ws         │
                    └─────────────────────┘
                               ▲
                               │ UDP (JSON packets)
                               │
                    ┌─────────────────────┐
                    │  Simulation         │
                    │  (external)         │
                    └─────────────────────┘
```

---

## 2. Packages and Directory Structure

```
/
├── bridge/                         # Standalone process
│   ├── server.ts                   # UDP → WebSocket bridge (dgram + ws)
│   └── package.json
│
├── visualizer/                     # Vite multi-page application
│   ├── index.html                  # Main page: 3D + BEV visualization
│   ├── scope.html                  # Scope page: time-series charts
│   ├── package.json
│   ├── vite.config.ts              # Multi-page entry points
│   └── src/
│       ├── main.ts                 # Entry point: main page
│       ├── scope-main.ts           # Entry point: scope page
│       │
│       ├── core/                   # ★ Shared core — imported by both pages
│       │   ├── config/
│       │   │   ├── loader.ts       # Load JSON (fetch + drag-and-drop)
│       │   │   ├── validator.ts    # Schema validation of CollimatorConfig
│       │   │   └── types.ts        # CollimatorConfig, ModuleConfig, etc.
│       │   │
│       │   ├── state/
│       │   │   ├── CollimatorState.ts  # Types: CollimatorState, ModuleState
│       │   │   ├── StateStore.ts       # Singleton; notifies subscribers
│       │   │   └── DataSource.ts       # Interface: activate/deactivate/onStateUpdate
│       │   │
│       │   ├── datasources/
│       │   │   ├── SimulationSource.ts # WebSocket client; parses JSON stream
│       │   │   └── ManualSource.ts     # Generates state from ManualControls events
│       │   │
│       │   ├── geometry/
│       │   │   ├── projection.ts       # FLD projection: pos × (SID / FLD)
│       │   │   ├── edgeJump.ts         # Edge jump calculation (leaf plane)
│       │   │   ├── axisAngle.ts        # Axis angle: atan(pos / fld) in degrees
│       │   │   └── primaryClip.ts      # Primary collimator projection + intersection
│       │   │
│       │   └── constraints/
│       │       └── ConstraintChecker.ts # Detect end-stop + leaf crossing violations
│       │
│       ├── scene/                      # Main page only
│       │   ├── SceneManager.ts         # Three.js WebGLRenderer, camera, OrbitControls
│       │   └── SceneUpdater.ts         # Receives state, delegates to objects/
│       │
│       ├── objects/                     # Main page only
│       │   ├── JawObject.ts            # Jaw pair (rect, square, asymmetric)
│       │   ├── WedgeObject.ts          # Wedge filter
│       │   ├── PrefilterObject.ts      # Rotatable pre-filter wheel
│       │   ├── ConeObject.ts           # Beam cone geometry
│       │   ├── DetectorObject.ts       # Detector plane
│       │   └── PrimaryCollimator.ts    # Primary collimator (rect or circular)
│       │
│       ├── bev/                        # Main page only
│       │   ├── BEVRenderer.ts          # 2D canvas: field, edges, annotations
│       │   └── BEVAnnotations.ts       # Measurements, leaf labels
│       │
│       ├── constraints/                # Main page only (3D overlay)
│       │   └── ConstraintOverlay.ts    # 3D highlight + UI badge
│       │
│       ├── scope/                      # ★ Scope page only
│       │   ├── ScopeChart.ts           # uPlot wrapper: chart lifecycle, trace management
│       │   ├── RingBuffer.ts           # Configurable FIFO buffer for time-series data
│       │   ├── TraceRegistry.ts        # Trace definitions: raw + derived, per config
│       │   ├── TraceSelector.ts        # UI: checkbox tree grouped by module
│       │   ├── TransportControls.ts    # Run / Pause / Clear buttons
│       │   └── CsvExport.ts           # Export buffered data as CSV
│       │
│       └── ui/                         # Main page only
│           ├── ControlPanel.ts         # Data source dropdown + connection status
│           ├── ManualControls.ts       # Schema-driven UI from CollimatorConfig
│           ├── AxisDataTable.ts        # Collapsible axis data table (US-23)
│           └── NavBar.ts               # Navigation: "Visualization" | "Scope"
│
├── configs/
│   └── example-collimator.json        # Full configuration example
│
└── docs/
    ├── VISION.md
    ├── REQUIREMENTS.md
    └── ARCHITECTURE.md                ← this file
```

### Shared Core Boundary

The `src/core/` directory is the **single source of truth** for:
- Data types (`CollimatorState`, `CollimatorConfig`)
- Geometry calculations (projection, edge jump, axis angle, primary clipping)
- Constraint detection
- Configuration loading and validation
- WebSocket/data source client logic

**Rule:** If logic is needed by both pages, it belongs in `core/`.
Page-specific code (`scene/`, `objects/`, `bev/`, `scope/`, `ui/`) must **never** be imported cross-page.

---

## 3. Core Data Types

### 3.1 CollimatorConfig (static, loaded from JSON file)

```typescript
// core/config/types.ts
interface CollimatorConfig {
  collimator_id: string;
  primary_collimator: PrimaryCollimatorConfig;
  modules: ModuleConfig[];
}
```

### 3.2 CollimatorState (dynamic, from DataSource)

```typescript
// core/state/CollimatorState.ts
interface CollimatorState {
  timestamp: number;
  sid: number;                          // mm
  collimator_rotation_deg: number;
  focal_spot?: { x: number; y: number };
  modules: Record<string, ModuleState>;
}

// ModuleState is a generic map; interpretation is the responsibility of each object
type ModuleState = {
  rotation_deg: number;
  fld_mm?: number;                      // overrides config default
  [key: string]: number | boolean | string | undefined;
};
```

### 3.3 DataSource Interface

```typescript
// core/state/DataSource.ts
interface DataSource {
  readonly id: string;
  readonly label: string;
  activate(): void;
  deactivate(): void;
  onStateUpdate: (state: CollimatorState) => void;
}
```

### 3.4 TraceDefinition (Scope)

```typescript
// scope/TraceRegistry.ts
interface TraceDefinition {
  id: string;                           // e.g. "jaws_x.leaf1_image_plane"
  moduleId: string;                     // e.g. "jaws_x"
  parameter: string;                    // e.g. "leaf1_image_plane"
  unit: '°' | 'mm' | 'bool';
  derived: boolean;                     // true = calculated from raw values
  extract: (state: CollimatorState, config: CollimatorConfig) => number;
}
```

### 3.5 RingBuffer

```typescript
// scope/RingBuffer.ts
interface RingBufferConfig {
  maxDurationMs: number;                // e.g. 60000 for 60s
}

interface RingBufferSample {
  timestamp: number;
  values: Record<string, number>;       // traceId → value
}
```

---

## 4. Data Flow

### 4.1 Main Page (Happy Path)

```
Simulation
  │  UDP JSON packet
  ▼
Bridge Server
  │  WebSocket JSON frame (broadcast to all clients)
  ▼
SimulationSource.ts (core/)
  │  CollimatorState
  ▼
StateStore.ts (core/)  ◄── ManualSource.ts (alternative)
  │  notifySubscribers(state)
  ├──► SceneUpdater.ts
  │      └──► JawObject / WedgeObject / ... → Three.js scene
  ├──► BEVRenderer.ts
  │      └──► Canvas 2D
  └──► AxisDataTable.ts
         └──► DOM table (real-time numeric values)
```

### 4.2 Scope Page (Happy Path)

```
Bridge Server
  │  WebSocket JSON frame (independent connection)
  ▼
SimulationSource.ts (core/ — same code, separate instance)
  │  CollimatorState
  ▼
StateStore.ts (core/)
  │  notifySubscribers(state)
  ▼
TraceRegistry.ts
  │  extract raw + derived values using core/geometry/*
  ▼
RingBuffer.ts
  │  append sample, discard oldest if full
  ▼
ScopeChart.ts (uPlot)
  │  render visible traces
  ▼
Canvas (uPlot)
```

**Invariant:** Both pages read exclusively from their own StateStore instance.
No object communicates directly with a DataSource.
Derived trace values are computed using `core/geometry/` functions — never re-implemented in scope code.

---

## 5. Geometry Model

### Coordinate System

```
        Focus (source)
            ●
            │ Y-axis (central beam)
            │
   ─────────┼───────── Leaf plane (FLD)
       ─Z   │   +Z
            │
   ─────────┼───────── Detector plane (SID)
            │
```

- **Y-axis**: central beam, source at top (Y > 0), detector at bottom (Y < 0)
- **X/Z-axes**: lateral axes in the leaf plane
- **All data stream coordinates**: relative to the leaf plane (FLD), **never** the detector plane

### FLD Projection

```
pos_detector = pos_leaf × (SID / FLD)
```

Each module has its own `fld_mm` (from config or data stream override).
Projection is calculated in `core/geometry/projection.ts` — never inline in objects.

### Axis Angle

```
axis_angle_deg = atan(pos_leaf / fld_mm) × (180 / π)
```

Calculated in `core/geometry/axisAngle.ts`. Used by AxisDataTable (US-23) and
Scope derived traces (US-25).

### Edge Jump

| Leaf position | Imaging edge |
|---|---|
| `leaf > 0` (right of axis) | left (−X) face — center-facing |
| `leaf < 0` (left of axis) | right (+X) face — center-facing |
| `leaf = 0` | left (−X) face (consistent default, no threshold band) |

Detection is sign-based via `Math.sign(leaf)`. No floating-point tolerance band needed.

Edge jump is calculated in `core/geometry/edgeJump.ts` in the leaf plane,
**then** projected to the detector plane.

### Primary Collimator

```
projection_detector = primary_collimator_size × (SID / fld_primary)
clipping = intersection(leaf_field_detector, primary_projection_detector)
```

### Rotation

Order: apply `module.rotation_deg` first, then `collimator_rotation_deg` additively.
Both are applied in the leaf plane; the projected position accounts for the rotated geometry.

---

## 6. Data Source Architecture

### Switching Behavior

- Switching via the `ControlPanel` dropdown calls `active.deactivate()` → `next.activate()`
- **No state reset** on switch: the last state is preserved until the next update
- `ManualSource` reflects the current state back into the controls (if available)

### SimulationSource

- Connects via WebSocket to the bridge (`ws://localhost:8765` by default)
- Reconnect logic with exponential backoff
- Parses incoming JSON frames → `CollimatorState`
- Connection status (`connected` / `disconnected` / `error`) is reported to ControlPanel

### ManualSource

- Reads the loaded `CollimatorConfig` and creates controls via `ManualControls.ts`
- Each control event writes directly into the internal state and calls `onStateUpdate`
- Schema-driven: **no** module-specific if/else blocks; mapping only via
  module type → control generators

---

## 7. Schema-driven UI

`ManualControls.ts` iterates over `config.modules` and delegates per `module.type` to
a registered control generator:

```
ModuleType  →  Generator function  →  DOM controls
```

| Module type | Controls |
|---|---|
| `prefilter` | Angle slider 0–360°, read-only segment label |
| `jaws_rect` / `jaws_square` | leaf1, leaf2 (range from constraints), FLD |
| `jaws_asymmetric` | leaf1, leaf2 independent, FLD |
| `wedge` | Toggle enabled, angle, orientation |
| global | SID, collimator rotation |

Constraint violation: control receives CSS class `constraint-violated` (red highlight),
warning appears in ControlPanel. **No automatic clamping.**

---

## 8. Constraint System

`ConstraintChecker.ts` runs after every state update:

1. **End-stop**: `leaf < constraints.min_mm` or `leaf > constraints.max_mm`
2. **Leaf crossing**: `leaf1 > leaf2` (or vice versa, by convention)

Result: list of `ConstraintViolation` with module ID, type, and severity.
`ConstraintOverlay.ts` sets 3D highlights (red material) and triggers UI badge.

---

## 9. Axis Data Table

`ui/AxisDataTable.ts` subscribes to the StateStore and renders a collapsible HTML table.

**Schema-driven:** Rows are generated from `CollimatorConfig.modules` — one row per movable axis:
- Jaw modules: 2 rows (leaf1, leaf2)
- Wedge: 1 row (lateral_offset)
- Prefilter: 1 row (angle)

**Calculations use shared core functions:**
- Image plane position: `core/geometry/projection.ts`
- Axis angle: `core/geometry/axisAngle.ts`
- Constraint status: `core/constraints/ConstraintChecker.ts`

Total rotation = `module.rotation_deg + collimator_rotation_deg` (calculated inline, trivial).

**Update strategy:** Full table re-render on every state change. For typical configurations
(4–8 rows) this is imperceptible; DOM diffing is not required.

---

## 10. Scope Architecture

### Component Responsibilities

| Component | Responsibility |
|---|---|
| `TraceRegistry.ts` | Generates `TraceDefinition[]` from loaded config; one entry per raw parameter + derived values; uses `core/geometry/*` for derived extractors |
| `RingBuffer.ts` | Stores `{timestamp, values}` samples in a FIFO array; configurable max duration; provides `append()`, `clear()`, `getRange()`, `exportCsv()` |
| `ScopeChart.ts` | Wraps uPlot instance; manages series add/remove; handles zoom/pan state; re-renders on buffer append |
| `TraceSelector.ts` | Checkbox tree UI grouped by module; toggles trace visibility in ScopeChart |
| `TransportControls.ts` | Run/Pause/Clear buttons; when paused, buffer continues recording but chart freezes |
| `CsvExport.ts` | Reads entire buffer, formats as CSV with trace names as headers, triggers download |

### Data Pipeline (per frame)

```
StateStore.onUpdate(state)
  │
  ▼
TraceRegistry.extractAll(state, config)
  │  → { "jaws_x.leaf1": -50.0, "jaws_x.leaf1_image_plane": -100.0, ... }
  ▼
RingBuffer.append(timestamp, values)
  │  → discard oldest if buffer full
  ▼
ScopeChart.update()
  │  → uPlot.setData() with visible traces only
  ▼
Canvas (uPlot renders)
```

### Buffer Sizing

| Duration | Sample rate | Traces | Approx. memory |
|---|---|---|---|
| 10s | 50 Hz | 30 | ~0.5 MB |
| 60s | 50 Hz | 30 | ~3 MB |
| 5min | 50 Hz | 30 | ~15 MB |

Memory budget target: <50 MB at maximum configuration.

### Vite Multi-Page Configuration

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        scope: resolve(__dirname, 'scope.html'),
      },
    },
  },
});
```

Both pages share `core/` via standard ES module imports.
Vite tree-shakes unused code per entry point (e.g. Three.js is not bundled into scope).

---

## 11. Bridge Server

- **Runtime**: Bun (preferred) or Node.js
- **UDP port**: configurable, default `5005`
- **WebSocket port**: configurable, default `8765`
- **Protocol**: JSON frames are forwarded 1:1 (no schema mapping in the bridge)
- **Multiple clients**: WebSocket server maintains a list of active clients; broadcasts to all

---

## 12. Tech Stack – Rationale

| Decision | Rationale |
|---|---|
| **Three.js** | Established, large community, sufficient for non-photorealistic medical visualization; no WebGPU overhead |
| **Vanilla TS + Vite** | Minimal abstraction; no framework dependency; fast HMR in dev |
| **Vite multi-page** | Two entry points (`index.html`, `scope.html`) with shared `core/`; single build, no duplication |
| **uPlot** (scope) | Extremely performant for time-series rendering; minimal overhead; native zoom/pan/cursor; handles 100k+ points at 60fps |
| **Bun** for bridge | Fast startup, native TypeScript support without tsconfig overhead |
| **No state framework** | State is simple enough for a singleton store; Redux/Zustand would be over-engineering |
| **Canvas 2D for BEV** | BEV is a flat 2D drawing; Three.js would be unnecessarily complex |
| **dgram (built-in)** | UDP reception without external dependency |
| **ws** | Lightweight, stable, no framework lock-in |
| **No SharedWorker** | Each page connects independently to the bridge; bridge broadcasts to all clients; avoids SharedWorker debugging complexity |

---

## 13. Extension Points

| Extension | Entry point |
|---|---|
| Replay / file source | New class `ReplaySource implements DataSource` in `core/datasources/` |
| New module type | Extend `ModuleConfig` type + add entry to control generator map + add trace definitions in `TraceRegistry` |
| Non-rectangular primary collimator | Extend `core/geometry/primaryClip.ts` with elliptical clipping |
| Remote bridge | Make `SimulationSource` URL configurable |
| Theme / dark mode | CSS custom properties in `index.html` and `scope.html` |
| New derived trace | Add `TraceDefinition` in `TraceRegistry.ts` using `core/geometry/*` functions |
| Third page (e.g. config editor) | Add entry point in `vite.config.ts`, import from `core/` |
| Scope triggers / markers | Extend `RingBuffer` with event annotation support |

---

## 14. Non-Goals (architectural)

- No server-side rendering
- No authentication / sessions
- No database / persistence (except JSON configuration files)
- No mobile optimization
- No DICOM import/export
