# CLAUDE.md – BeamScope

## Project Overview

Browser-based real-time 3D visualization of X-ray collimators.
Collimators are defined as modular JSON configurations.
The visualization supports multiple interchangeable data sources (Simulation, Manual UI).

Full details: `docs/VISION.md` and `docs/REQUIREMENTS.md`

---

## Tech Stack

| Component | Technology |
|---|---|
| 3D Rendering | Three.js |
| Frontend | Vanilla TypeScript + Vite |
| Bridge Server | Bun or Node.js |
| UDP → WS Bridge | dgram (Node built-in) + ws |
| Language | TypeScript (strict mode) |

---

## Project Structure

```
/
├── CLAUDE.md
├── docs/
│   ├── VISION.md
│   ├── REQUIREMENTS.md
│   └── ARCHITECTURE.md           ← created by Claude
├── bridge/
│   ├── server.ts                 ← UDP → WebSocket Bridge
│   └── package.json
├── visualizer/
│   ├── src/
│   │   ├── main.ts
│   │   ├── state/                ← Central state, DataSource interface
│   │   ├── datasources/
│   │   │   ├── SimulationSource.ts   ← WebSocket receiver
│   │   │   └── ManualSource.ts       ← Generates state from Manual UI events
│   │   ├── scene/                ← Three.js scene, camera, controls
│   │   ├── objects/              ← 3D objects: jaws, cone, detector, wedge, prefilter
│   │   ├── geometry/             ← Projection calculations (FLD, edge jump, primary collimator)
│   │   ├── bev/                  ← 2D Beam's Eye View
│   │   ├── config/               ← Load + validate collimator configuration
│   │   ├── ui/
│   │   │   ├── ControlPanel.ts   ← Data source dropdown + status
│   │   │   └── ManualControls.ts ← Schema-driven UI generator
│   │   └── constraints/          ← Constraint detection and visualization
│   ├── index.html
│   └── package.json
├── configs/                      ← Example collimator configurations (JSON)
│   └── example-collimator.json
└── README.md
```

---

## Architecture: Data Sources

```
[Simulation]  UDP → Bridge → WebSocket ──┐
[Manual UI]   Schema-driven Controls    ──├──► Central State ──► 3D + BEV
[future]      Replay / File             ──┘
```

All data sources implement the same `DataSource` interface and write into the
central state. The visualization has no direct knowledge of any data source.

```typescript
interface DataSource {
  activate(): void;
  deactivate(): void;
  onStateUpdate: (state: CollimatorState) => void;
}
```

**Important:** When switching data sources, the last state is preserved (no reset).

---

## Key Conventions

- **Units**: always mm, angles in degrees
- **Coordinate system**: Y-axis = central beam (source at top → detector at bottom), X/Z = lateral axes
- **FLD**: distance from focus to leaf plane (mid-leaf)
- **Edge jump**: calculate geometrically correct, no approximation
- **Schema-driven UI**: ManualControls.ts generates controls exclusively from the loaded
  collimator.json – no hardcoded layout, no module-specific if/else blocks
- **Source code comments**: always written in English
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`)
- **No direct push to main** – feature branches
- **TypeScript strict mode** – no `any` without a comment

---

## Data Format

Two separate JSON structures:

1. **Collimator configuration** (static, loaded from file): module types, thicknesses, FLD defaults,
   constraints, primary collimator → `docs/REQUIREMENTS.md` US-12
2. **Data stream** (dynamic, via WebSocket or Manual UI): generic map of module ID →
   current values, plus global parameters (SID, collimator rotation) → `docs/REQUIREMENTS.md` US-02

**Do not change unilaterally** – both formats are the interface to the simulation.

---

## Schema-driven UI: Module Type → Controls Mapping

| Module Type | Generated Controls |
|---|---|
| `prefilter` | Angle slider 0–360° + read-only segment label |
| `jaws_rect` | leaf1/leaf2 slider+input (range from constraints), FLD slider+input |
| `jaws_square` | same as jaws_rect |
| `jaws_asymmetric` | leaf1/leaf2 independent, each slider+input, FLD slider+input |
| `wedge` | Toggle (enabled), lateral offset slider+input (±200 mm), rotation slider+input |
| global | SID slider+input, collimator rotation slider+input |

Constraint violations: mark control red + show warning. **Do not clamp.**

---

## Geometry Notes

### ⚠️ Coordinate Reference – Critical!
**All values in the data stream refer to the leaf plane (at FLD), never to the detector plane.**
The visualization is solely responsible for projection. Raw values must never be
interpreted directly as image plane or detector coordinates.

### FLD Projection
```
pos_detector = pos_leaf × (SID / FLD)
```
Each module has its own FLD → independent calculation per module.
FLD can be overridden per module in the data stream (dynamic).

### Rotation
Every module has a `rotation_deg` in the data stream – no exceptions, regardless of type.
Global `collimator_rotation_deg` is applied additively on top of all module rotations.
Order: apply module rotation first, then global collimator rotation.

### Edge Jump
- Leaf > 0 (right of axis): imaging edge = the edge facing the center
- Leaf < 0 (left of axis): imaging edge = the edge facing the center
- Leaf = 0: discrete jump, edge switches immediately
- Edge jump is calculated in the leaf plane, projection happens afterwards

### Primary Collimator
```
projection_primary_detector = primary_collimator_size × (SID / FLD_primary)
clipping = intersection(leaf_field_detector, primary_projection_detector)
```

---

## Working with Claude Code

1. **Before any implementation**: present a brief plan, wait for approval
2. **Atomic commits**: one logical change per commit
3. **Acceptance criteria** from REQUIREMENTS.md are the basis for tests
4. **ARCHITECTURE.md**: populate after initial setup and keep up to date
5. **configs/**: always provide a working example configuration

## Setup Sequence (first-time setup)

```
1. Read CLAUDE.md + docs/, confirm understanding
2. Create ARCHITECTURE.md
3. Scaffold bridge server
4. Define central state + DataSource interface
5. Visualizer skeleton with Three.js + Vite
6. Load example config + render scene with hardcoded data
7. Geometry calculations (FLD, projection, edge jump)
8. Implement SimulationSource (WebSocket)
9. Implement ManualSource + schema-driven UI
10. Data source switching (dropdown)
11. Constraint system
12. BEV
13. Complete user stories in epic order
```

---

## Useful Commands

```bash
cd bridge && bun run start          # Start bridge
cd visualizer && bun run dev        # Visualizer (dev)
node scripts/send-test-udp.js       # Send test UDP packet
bun run validate-config configs/example-collimator.json
```

---

## Non-Goals (do not implement!)

- Tube/arm rotation (C-arm geometry)
- DICOM import/export
- Authentication
- Mobile-first layout
- Tracing / data recording
