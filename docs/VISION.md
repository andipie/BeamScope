# Vision: BeamScope

## Description

**Real-time 3D visualization of X-ray collimator beam fields for radiography and angiography systems. Displays jaw positions, wedge filters and field geometry interactively in the browser — driven by live simulation data. Includes a tabular axis data display and a dedicated scope view for time-series analysis of all collimator parameters.**

## Goal

A browser-based, interactive 3D visualization of X-ray collimators for use in simulation and development of radiography (Rad) and angiography (Angio) systems. Collimators are defined as modular JSON configurations. The application receives real-time data from a simulation and displays the beam field and collimator geometry in both 3D and 2D. A dedicated scope page provides time-series analysis of all collimator parameters for detailed debugging and correlation analysis.

## Target Audience

Developers and engineers who build or simulate X-ray collimators for radiography and angiography systems and want to visually analyze beam field behavior.

## Core Value

- **No client install**: runs entirely in the browser
- **Real-time**: continuous data transfer from the simulation via WebSocket
- **Interactive**: rotatable and zoomable 3D view plus 2D top-down view (BEV)
- **Modular**: collimators are configurable as a stack of modules via JSON
- **Geometrically correct**: FLD, leaf thickness, and edge jump calculated correctly
- **Analyzable**: time-series scope with configurable buffer for debugging and correlation

---

## In Scope (v1)

- 3D visualization of the beam field as cone geometry
- Modular collimator model via JSON configuration:
  - Rotatable pre-filter (angle range → filter value, angle dynamically from simulation)
  - Symmetric jaw pairs (rectangular and square)
  - Asymmetric jaw pairs (independently controllable)
  - Wedge filter
- Primary collimator (rectangular or circular/elliptical), configurable
- Global collimator rotation + individual module rotation
- FLD (focus-to-leaf distance) per leaf, configurable and dynamically from simulation
- Leaf thickness with correct visualization of edge jump when crossing the central axis
- Mechanical constraints: end-stop + leaf crossing (leaf1/leaf2 of same pair)
- Constraint visualization: red highlight + UI warning/badge
- Constraint limits configurable via file/UI
- WebSocket interface for real-time data stream
- Local bridge server (UDP → WebSocket)
- Two simultaneous views: 3D perspective + 2D BEV
- Tabular axis data display: all movable axes with angles and projected positions
- Dedicated scope page: time-series chart for all numeric parameters (raw + derived)
  - Configurable ring buffer (10s–5min)
  - Transport controls (run/pause/clear), zoom, pan, CSV export
- Multi-page architecture with shared core logic (no duplication of geometry/state)
- Configurable SID

## Out of Scope (v1)

- Patient model or phantom
- Tube/arm rotation (C-arm geometry)
- Authentication or multi-user operation
- Mobile optimization
- DICOM import/export
- Persistent data recording / replay from file (scope buffer is volatile, in-memory only)

---

## Success Criteria

- Visualization updates in real time (<100ms visible latency)
- Beam field responds correctly to leaf positions, FLD, SID, and rotation
- Edge jump when crossing the central axis is correctly represented
- Constraint violations are reliably detected and highlighted
- New collimator configuration loadable via JSON without code changes
- Runs stably in Chrome and Firefox without installation
- A new developer can start the system locally in <15 minutes
- Axis data table shows correct numeric values for all movable axes in real time
- Scope view renders ≥30 fps with 10 active traces at 50 Hz sample rate
- Scope buffer is configurable and CSV-exportable
- Shared core logic: geometry changes take effect on both pages without duplication
