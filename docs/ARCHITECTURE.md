# Architecture: BeamScope

> This document is the authoritative architecture reference. It is updated after every significant
> system change.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                     │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        Visualizer (Vite + TS)                    │    │
│  │                                                                   │    │
│  │  ┌──────────┐  ┌───────────────┐  ┌────────────────────────┐   │    │
│  │  │ config/  │  │ datasources/  │  │        ui/             │   │    │
│  │  │ Loader   │  │               │  │                        │   │    │
│  │  │ Validator│  │ SimSource  ◄──┼──┼── WebSocket            │   │    │
│  │  └────┬─────┘  │ ManualSource──┼──┼── ControlPanel         │   │    │
│  │       │        │ (future:      │  │   ManualControls       │   │    │
│  │       │        │  ReplaySource)│  └────────────────────────┘   │    │
│  │       ▼        └──────┬────────┘                                │    │
│  │  CollimatorConfig     │ onStateUpdate(CollimatorState)          │    │
│  │       │               ▼                                         │    │
│  │       │        ┌─────────────┐                                  │    │
│  │       └───────►│ Central     │                                  │    │
│  │                │ State Store │                                  │    │
│  │                └──────┬──────┘                                  │    │
│  │                       │                                         │    │
│  │          ┌────────────┴────────────┐                            │    │
│  │          ▼                         ▼                            │    │
│  │  ┌───────────────┐        ┌────────────────┐                   │    │
│  │  │  scene/       │        │   bev/         │                   │    │
│  │  │  Three.js 3D  │        │   2D BEV Canvas│                   │    │
│  │  │  ┌──────────┐ │        └────────────────┘                   │    │
│  │  │  │ objects/ │ │                                              │    │
│  │  │  │ geometry/│ │                                              │    │
│  │  │  │constraints│ │                                              │    │
│  │  │  └──────────┘ │                                              │    │
│  │  └───────────────┘                                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
          ▲
          │ WebSocket (ws://)
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
├── visualizer/                     # Vite application
│   ├── index.html
│   ├── package.json
│   └── src/
│       ├── main.ts                 # Entry point: wire everything together
│       │
│       ├── config/
│       │   ├── loader.ts           # Load JSON (fetch + drag-and-drop)
│       │   ├── validator.ts        # Schema validation of CollimatorConfig
│       │   └── types.ts            # CollimatorConfig, ModuleConfig, etc.
│       │
│       ├── state/
│       │   ├── CollimatorState.ts  # Types: CollimatorState, ModuleState
│       │   ├── StateStore.ts       # Singleton; notifies subscribers
│       │   └── DataSource.ts       # Interface: activate/deactivate/onStateUpdate
│       │
│       ├── datasources/
│       │   ├── SimulationSource.ts # WebSocket client; parses JSON stream
│       │   └── ManualSource.ts     # Generates state from ManualControls events
│       │
│       ├── scene/
│       │   ├── SceneManager.ts     # Three.js WebGLRenderer, camera, OrbitControls
│       │   └── SceneUpdater.ts     # Receives state, delegates to objects/
│       │
│       ├── objects/
│       │   ├── JawObject.ts        # Jaw pair (rect, square, asymmetric)
│       │   ├── WedgeObject.ts      # Wedge filter
│       │   ├── PrefilterObject.ts  # Rotatable pre-filter wheel
│       │   ├── ConeObject.ts       # Beam cone geometry
│       │   ├── DetectorObject.ts   # Detector plane
│       │   └── PrimaryCollimator.ts # Primary collimator (rect or circular)
│       │
│       ├── geometry/
│       │   ├── projection.ts       # FLD projection: pos × (SID / FLD)
│       │   ├── edgeJump.ts         # Edge jump calculation (leaf plane)
│       │   └── primaryClip.ts      # Primary collimator projection + intersection
│       │
│       ├── bev/
│       │   ├── BEVRenderer.ts      # 2D canvas: field, edges, annotations
│       │   └── BEVAnnotations.ts   # Measurements, leaf labels
│       │
│       ├── constraints/
│       │   ├── ConstraintChecker.ts # Detect end-stop + leaf crossing violations
│       │   └── ConstraintOverlay.ts # 3D highlight + UI badge
│       │
│       └── ui/
│           ├── ControlPanel.ts     # Data source dropdown + connection status
│           └── ManualControls.ts   # Schema-driven UI from CollimatorConfig
│
├── configs/
│   └── example-collimator.json    # Full configuration example
│
└── docs/
    ├── VISION.md
    ├── REQUIREMENTS.md
    └── ARCHITECTURE.md            ← this file
```

---

## 3. Core Data Types

### 3.1 CollimatorConfig (static, loaded from JSON file)

```typescript
// config/types.ts
interface CollimatorConfig {
  collimator_id: string;
  primary_collimator: PrimaryCollimatorConfig;
  modules: ModuleConfig[];
}

interface PrimaryCollimatorConfig {
  shape: 'rect' | 'circle' | 'ellipse';
  size: { x: number; y: number };   // mm
  fld_mm: number;
}

type ModuleType = 'jaws_rect' | 'jaws_square' | 'jaws_asymmetric' | 'wedge' | 'prefilter';

interface ModuleConfig {
  id: string;
  type: ModuleType;
  fld_mm: number;
  thickness_mm: number;
  constraints?: {
    min_mm: number;
    max_mm: number;
  };
  // module-specific fields:
  //   prefilter: segments[]
  //   wedge: lateral_offset_mm (startup default), enabled, thickness_mm
  [key: string]: unknown;
}
```

### 3.2 CollimatorState (dynamic, from DataSource)

```typescript
// state/CollimatorState.ts
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
// state/DataSource.ts
interface DataSource {
  readonly id: string;
  readonly label: string;
  activate(): void;
  deactivate(): void;
  onStateUpdate: (state: CollimatorState) => void;
}
```

---

## 4. Data Flow (Happy Path)

```
Simulation
  │  UDP JSON packet
  ▼
Bridge Server
  │  WebSocket JSON frame
  ▼
SimulationSource.ts
  │  CollimatorState
  ▼
StateStore.ts  ◄── ManualSource.ts (alternative)
  │  notifySubscribers(state)
  ├──► SceneUpdater.ts
  │      └──► JawObject / WedgeObject / ... → Three.js scene
  └──► BEVRenderer.ts
         └──► Canvas 2D
```

**Invariant:** The visualization layer reads exclusively from the StateStore.
No object communicates directly with a DataSource.

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
Projection is calculated in `geometry/projection.ts` — never inline in objects.

### Edge Jump

| Leaf position | Imaging edge |
|---|---|
| `leaf > 0` (right of axis) | left (−X) face — center-facing |
| `leaf < 0` (left of axis) | right (+X) face — center-facing |
| `leaf = 0` | left (−X) face (consistent default, no threshold band) |

Detection is sign-based via `Math.sign(leaf)`. No floating-point tolerance band needed.

Edge jump is calculated in `geometry/edgeJump.ts` in the leaf plane,
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

## 9. Bridge Server

- **Runtime**: Bun (preferred) or Node.js
- **UDP port**: configurable, default `5005`
- **WebSocket port**: configurable, default `8765`
- **Protocol**: JSON frames are forwarded 1:1 (no schema mapping in the bridge)
- **Multiple clients**: WebSocket server maintains a list of active clients; broadcasts to all

---

## 10. Tech Stack – Rationale

| Decision | Rationale |
|---|---|
| **Three.js** | Established, large community, sufficient for non-photorealistic medical visualization; no WebGPU overhead |
| **Vanilla TS + Vite** | Minimal abstraction; no framework dependency; fast HMR in dev |
| **Bun** for bridge | Fast startup, native TypeScript support without tsconfig overhead |
| **No state framework** | State is simple enough for a singleton store; Redux/Zustand would be over-engineering |
| **Canvas 2D for BEV** | BEV is a flat 2D drawing; Three.js would be unnecessarily complex |
| **dgram (built-in)** | UDP reception without external dependency |
| **ws** | Lightweight, stable, no framework lock-in |

---

## 11. Extension Points

| Extension | Entry point |
|---|---|
| Replay / file source | New class `ReplaySource implements DataSource` |
| New module type | Extend `ModuleConfig` type + add entry to control generator map |
| Non-rectangular primary collimator | Extend `primaryClip.ts` with elliptical clipping |
| Remote bridge | Make `SimulationSource` URL configurable |
| Theme / dark mode | CSS custom properties in `index.html` |

---

## 12. Non-Goals (architectural)

- No server-side rendering
- No authentication / sessions
- No database / persistence (except JSON configuration files)
- No mobile optimization
- No DICOM import/export
