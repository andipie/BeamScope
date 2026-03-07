#!/usr/bin/env python3
"""
BeamScope Showcase Demo
=======================
Choreographed collimator sequence simulating a realistic radiography
workflow: field changes, format switches, wedge insertion, collimator
rotation, and SID variation — all with smooth eased transitions.

Usage
-----
    python scripts/demo_showcase.py
    python scripts/demo_showcase.py --config configs/quad-jaw-v1.json
    python scripts/demo_showcase.py --rate 60

Prerequisites
-------------
    1. cd bridge && bun run start
    2. cd visualizer && bun run dev
    3. python scripts/demo_showcase.py [--config ...]
    4. Switch dropdown to "Simulation" in the browser
"""

import argparse
import json
import math
import socket
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# Scene definition
# ---------------------------------------------------------------------------

@dataclass
class Scene:
    """A target state the collimator transitions into and holds."""
    name: str                       # displayed in terminal
    transition: float               # seconds to interpolate from previous state
    hold: float                     # seconds to hold at target
    targets: dict = field(default_factory=dict)  # param → target value


# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------

def ease(t: float) -> float:
    """Cosine ease-in-out: smooth acceleration and deceleration."""
    return 0.5 * (1.0 - math.cos(math.pi * t))


def lerp(a: float, b: float, t: float) -> float:
    """Linear interpolation clamped to [a, b]."""
    return a + (b - a) * max(0.0, min(1.0, t))


# ---------------------------------------------------------------------------
# Config helper: compute segment midpoints for prefilter
# ---------------------------------------------------------------------------

def segment_midpoints(config: dict) -> dict[str, float]:
    """
    Return { filter_value: midpoint_angle } for the first prefilter module.
    Useful for driving the prefilter to a named segment.
    """
    for mod in config.get("modules", []):
        if mod.get("type") == "prefilter":
            mid: dict[str, float] = {}
            for seg in mod.get("segments", []):
                from_deg = seg["from_deg"]
                to_deg = seg["to_deg"]
                # handle wrap-around
                if to_deg <= from_deg:
                    to_deg += 360.0
                mid[seg["filter_value"]] = (from_deg + to_deg) / 2.0
            return mid
    return {}


def module_ids_by_type(config: dict) -> dict[str, list[str]]:
    """Return { module_type: [id, ...] }."""
    result: dict[str, list[str]] = {}
    for mod in config.get("modules", []):
        result.setdefault(mod["type"], []).append(mod["id"])
    return result


def fld_map(config: dict) -> dict[str, float]:
    """Return { module_id: fld_mm }."""
    return {mod["id"]: mod["fld_mm"] for mod in config.get("modules", [])}


# ---------------------------------------------------------------------------
# Build choreography from config
# ---------------------------------------------------------------------------

def build_scenes(config: dict) -> list[Scene]:
    """
    Create a cinematic sequence of scenes based on the loaded config.
    Designed for demo videos — short holds, overlapping movements,
    realistic wedge positioning (off-center, angled).
    """
    by_type = module_ids_by_type(config)
    flds = fld_map(config)
    midpoints = segment_midpoints(config)

    # Find module IDs
    jaw_ids = []
    for t in ("jaws_rect", "jaws_square", "jaws_asymmetric"):
        jaw_ids.extend(by_type.get(t, []))
    wedge_ids = by_type.get("wedge", [])
    prefilter_ids = by_type.get("prefilter", [])

    # Pick first prefilter segment names
    segment_names = list(midpoints.keys())

    # Build parameter names
    def jaw(jid: str, param: str) -> str:
        return f"{jid}.{param}"

    def wedge(wid: str, param: str) -> str:
        return f"{wid}.{param}"

    def pf(pid: str, param: str) -> str:
        return f"{pid}.{param}"

    # --- Default state (wide open, wedge off-center) ---
    defaults: dict[str, float] = {
        "sid": 1000.0,
        "collimator_rotation_deg": 0.0,
    }
    for jid in jaw_ids:
        defaults[jaw(jid, "aperture")] = 120.0
        defaults[jaw(jid, "fld_mm")] = flds.get(jid, 400.0)
    for wid in wedge_ids:
        defaults[wedge(wid, "enabled")] = 1.0  # always enabled
        defaults[wedge(wid, "lateral_offset_mm")] = -25.0  # off-center — realistic
        defaults[wedge(wid, "rotation_deg")] = 12.0  # angled, not parallel to jaws
    for pid in prefilter_ids:
        defaults[pf(pid, "angle_deg")] = midpoints.get(segment_names[0], 45.0) if segment_names else 45.0

    scenes: list[Scene] = []

    # Helper to create targets from defaults with overrides
    def T(**overrides: float) -> dict[str, float]:
        t = dict(defaults)
        t.update(overrides)
        return t

    # --- Scene 1: Startup — wide field open, wedge off-center ---
    scenes.append(Scene(
        name="Wide field — positioning",
        transition=0.0, hold=1.5,
        targets=T(),
    ))

    # --- Scene 2: Collimate thorax + wedge shifts simultaneously ---
    s2 = T()
    for i, jid in enumerate(jaw_ids):
        s2[jaw(jid, "aperture")] = 70.0 - i * 12.0
    if wedge_ids:
        s2[wedge(wedge_ids[0], "lateral_offset_mm")] = 32.0
        s2[wedge(wedge_ids[0], "rotation_deg")] = -8.0
    scenes.append(Scene(
        name="Collimate — thorax AP",
        transition=1.5, hold=1.0,
        targets=s2,
    ))

    # --- Scene 3: Wedge repositions + subtle SID ---
    s3 = dict(s2)
    s3["sid"] = 1020.0
    if wedge_ids:
        s3[wedge(wedge_ids[0], "lateral_offset_mm")] = -42.0
        s3[wedge(wedge_ids[0], "rotation_deg")] = 18.0
    scenes.append(Scene(
        name="Wedge reposition — lateral shift",
        transition=1.0, hold=0.8,
        targets=s3,
    ))

    # --- Scene 4: Tight field + collimator rotation (simultaneous) ---
    s4 = dict(s3)
    s4["collimator_rotation_deg"] = 12.0
    for i, jid in enumerate(jaw_ids):
        s4[jaw(jid, "aperture")] = 40.0 - i * 5.0
    scenes.append(Scene(
        name="Tight field + rotation 12°",
        transition=1.5, hold=1.0,
        targets=s4,
    ))

    # --- Scene 5: Format change — prefilter rotates while jaws open ---
    s5 = dict(s4)
    if prefilter_ids and len(segment_names) >= 3:
        pid0 = prefilter_ids[0]
        target_seg = segment_names[2]
        s5[pf(pid0, "angle_deg")] = midpoints[target_seg]
    for i, jid in enumerate(jaw_ids):
        s5[jaw(jid, "aperture")] = 85.0 - i * 8.0
    s5["collimator_rotation_deg"] = 8.0
    scenes.append(Scene(
        name=f"Format — {segment_names[2] if len(segment_names) >= 3 else 'change'}",
        transition=1.5, hold=0.8,
        targets=s5,
    ))

    # --- Scene 6: SID zoom + wedge follows ---
    s6 = dict(s5)
    s6["sid"] = 1100.0
    for i, jid in enumerate(jaw_ids):
        s6[jaw(jid, "aperture")] = 55.0 + i * 8.0
    if wedge_ids:
        s6[wedge(wedge_ids[0], "lateral_offset_mm")] = 20.0
        s6[wedge(wedge_ids[0], "rotation_deg")] = -15.0
    scenes.append(Scene(
        name="Zoom — SID 1100mm",
        transition=1.8, hold=1.0,
        targets=s6,
    ))

    # --- Scene 7: Fast collimate — shows system responsiveness ---
    s7 = dict(s6)
    for i, jid in enumerate(jaw_ids):
        s7[jaw(jid, "aperture")] = 25.0 + i * 3.0
    s7["collimator_rotation_deg"] = -5.0
    scenes.append(Scene(
        name="Fast collimate — snap",
        transition=0.6, hold=0.8,
        targets=s7,
    ))

    # --- Scene 8: Open + counter-rotate ---
    s8 = dict(s7)
    for i, jid in enumerate(jaw_ids):
        s8[jaw(jid, "aperture")] = 100.0 + i * 10.0
    s8["collimator_rotation_deg"] = -12.0
    s8["sid"] = 1050.0
    if wedge_ids:
        s8[wedge(wedge_ids[0], "lateral_offset_mm")] = -35.0
        s8[wedge(wedge_ids[0], "rotation_deg")] = 22.0
    scenes.append(Scene(
        name="Open + counter-rotate",
        transition=1.2, hold=0.8,
        targets=s8,
    ))

    # --- Scene 9: Second format change ---
    s9 = dict(s8)
    if prefilter_ids and len(segment_names) >= 2:
        pid0 = prefilter_ids[0]
        target_seg = segment_names[1]
        s9[pf(pid0, "angle_deg")] = midpoints[target_seg]
    for i, jid in enumerate(jaw_ids):
        s9[jaw(jid, "aperture")] = 60.0 + i * 6.0
    s9["collimator_rotation_deg"] = 0.0
    scenes.append(Scene(
        name=f"Format — {segment_names[1] if len(segment_names) >= 2 else 'change'}",
        transition=1.5, hold=0.8,
        targets=s9,
    ))

    # --- Scene 10: Second wedge in (if available) + tight field ---
    if len(wedge_ids) >= 2:
        s10 = dict(s9)
        wid1 = wedge_ids[1]
        s10[wedge(wid1, "lateral_offset_mm")] = -30.0
        s10[wedge(wid1, "rotation_deg")] = -10.0
        for i, jid in enumerate(jaw_ids):
            s10[jaw(jid, "aperture")] = 45.0 - i * 5.0
        scenes.append(Scene(
            name=f"Second wedge — {wid1}",
            transition=1.2, hold=0.8,
            targets=s10,
        ))

    # --- Scene 11: Dramatic close + rotation ---
    s11 = T()
    for i, jid in enumerate(jaw_ids):
        s11[jaw(jid, "aperture")] = 15.0 + i * 3.0
    s11["collimator_rotation_deg"] = 20.0
    s11["sid"] = 1000.0
    if wedge_ids:
        s11[wedge(wedge_ids[0], "lateral_offset_mm")] = 45.0
        s11[wedge(wedge_ids[0], "rotation_deg")] = -20.0
    scenes.append(Scene(
        name="Min field + rotation 20°",
        transition=1.5, hold=1.0,
        targets=s11,
    ))

    # --- Final: Smooth return to start ---
    scenes.append(Scene(
        name="Reset — back to start",
        transition=2.5, hold=1.0,
        targets=T(),
    ))

    return scenes


# ---------------------------------------------------------------------------
# State interpolation
# ---------------------------------------------------------------------------

class Interpolator:
    """Manages smooth transitions between scene target states."""

    def __init__(self, initial: dict[str, float]) -> None:
        self.current = dict(initial)
        self.start = dict(initial)
        self.target = dict(initial)

    def set_target(self, targets: dict[str, float]) -> None:
        self.start = dict(self.current)
        self.target = targets

    def sample(self, progress: float) -> dict[str, float]:
        """Sample all parameters at the given transition progress [0..1]."""
        t = ease(progress)
        for key in self.target:
            self.current[key] = lerp(
                self.start.get(key, self.target[key]),
                self.target[key],
                t,
            )
        return self.current


# ---------------------------------------------------------------------------
# Build UDP packet from interpolated state
# ---------------------------------------------------------------------------

def state_to_packet(state: dict[str, float], config: dict) -> dict:
    """Convert flat interpolated state dict into a BeamScope data stream packet."""
    modules: dict = {}
    by_type = module_ids_by_type(config)

    for mod_type, ids in by_type.items():
        for mod_id in ids:
            if mod_type in ("jaws_rect", "jaws_square", "jaws_asymmetric"):
                ap = state.get(f"{mod_id}.aperture", 100.0)
                modules[mod_id] = {
                    "leaf1": round(-ap, 2),
                    "leaf2": round(ap, 2),
                    "rotation_deg": 0.0,
                    "fld_mm": state.get(f"{mod_id}.fld_mm", 400.0),
                }
            elif mod_type == "prefilter":
                modules[mod_id] = {
                    "angle_deg": round(state.get(f"{mod_id}.angle_deg", 0.0) % 360.0, 2),
                    "rotation_deg": 0.0,
                }
            elif mod_type == "wedge":
                modules[mod_id] = {
                    "enabled": state.get(f"{mod_id}.enabled", 0.0) >= 0.5,
                    "lateral_offset_mm": round(state.get(f"{mod_id}.lateral_offset_mm", 0.0), 2),
                    "rotation_deg": round(state.get(f"{mod_id}.rotation_deg", 0.0), 2),
                }

    return {
        "timestamp": int(time.time() * 1000),
        "sid": round(state.get("sid", 1000.0), 1),
        "collimator_rotation_deg": round(state.get("collimator_rotation_deg", 0.0), 2),
        "focal_spot": {"x": 1.2, "y": 1.2},
        "modules": modules,
    }


# ---------------------------------------------------------------------------
# Terminal status
# ---------------------------------------------------------------------------

def format_status(
    scene: Scene,
    phase: str,
    progress: float,
    state: dict[str, float],
    config: dict,
) -> str:
    """Format a terminal status line with scene name, phase, and progress bar."""
    BAR_WIDTH = 20
    filled = int(progress * BAR_WIDTH)
    bar = "█" * filled + "░" * (BAR_WIDTH - filled)

    # Build compact state summary
    by_type = module_ids_by_type(config)
    parts: list[str] = [f"SID={state.get('sid', 1000):6.0f}"]

    for mod_type, ids in by_type.items():
        for mod_id in ids:
            if mod_type in ("jaws_rect", "jaws_square", "jaws_asymmetric"):
                ap = state.get(f"{mod_id}.aperture", 0)
                parts.append(f"{mod_id}=±{ap:4.0f}")
            elif mod_type == "prefilter":
                ang = state.get(f"{mod_id}.angle_deg", 0)
                parts.append(f"{mod_id}={ang:5.1f}°")
            elif mod_type == "wedge":
                en = state.get(f"{mod_id}.enabled", 0) >= 0.5
                off = state.get(f"{mod_id}.lateral_offset_mm", 0)
                rot = state.get(f"{mod_id}.rotation_deg", 0)
                parts.append(f"{mod_id}={'ON' if en else'--'} {off:+4.0f} {rot:+3.0f}°")

    cr = state.get("collimator_rotation_deg", 0)
    parts.append(f"rot={cr:+4.0f}°")

    summary = " | ".join(parts)
    return f" {phase:5s} {bar}  {scene.name:<35s} {summary}"


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="BeamScope Showcase Demo — choreographed collimator sequence via UDP",
    )
    parser.add_argument("--config", default="configs/example-collimator.json",
                        help="Collimator config JSON (default: configs/example-collimator.json)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Bridge UDP host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5005,
                        help="Bridge UDP port (default: 5005)")
    parser.add_argument("--rate", type=int, default=30,
                        help="Update rate in Hz (default: 30)")
    args = parser.parse_args()

    # --- Load config ---------------------------------------------------------
    config_path = Path(args.config)
    if not config_path.is_file():
        alt = Path(__file__).resolve().parent.parent / args.config
        if alt.is_file():
            config_path = alt
        else:
            print(f"Error: config file not found: {args.config}")
            sys.exit(1)

    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)

    collimator_id = config.get("collimator_id", config_path.stem)
    scenes = build_scenes(config)

    if not scenes:
        print("Error: no scenes could be generated from config.")
        sys.exit(1)

    total_duration = sum(s.transition + s.hold for s in scenes)

    print(f"BeamScope Showcase Demo")
    print(f"  Config:    {config_path.name} ({collimator_id})")
    print(f"  Scenes:    {len(scenes)}")
    print(f"  Loop:      {total_duration:.0f}s per cycle")
    print(f"  Target:    udp://{args.host}:{args.port} @ {args.rate} Hz")
    print(f"  Press Ctrl+C to stop.\n")

    # --- UDP socket ----------------------------------------------------------
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    dt = 1.0 / args.rate
    interp = Interpolator(scenes[0].targets)

    try:
        while True:  # endless loop over all scenes
            for i, scene in enumerate(scenes):
                interp.set_target(scene.targets)
                total_scene = scene.transition + scene.hold

                elapsed = 0.0
                while elapsed < total_scene:
                    frame_start = time.perf_counter()

                    # Determine phase and progress
                    if elapsed < scene.transition and scene.transition > 0:
                        phase = "MOVE"
                        progress = elapsed / scene.transition
                        state = interp.sample(progress)
                    else:
                        phase = "HOLD"
                        hold_elapsed = elapsed - scene.transition
                        progress = hold_elapsed / scene.hold if scene.hold > 0 else 1.0
                        state = interp.sample(1.0)

                    # Send packet
                    packet = state_to_packet(state, config)
                    data = json.dumps(packet).encode("utf-8")
                    sock.sendto(data, (args.host, args.port))

                    # Terminal
                    status = format_status(scene, phase, progress, state, config)
                    scene_label = f"[{i + 1}/{len(scenes)}]"
                    sys.stdout.write(f"\r{scene_label} {status}")
                    sys.stdout.flush()

                    # Frame timing
                    frame_time = time.perf_counter() - frame_start
                    sleep_for = dt - frame_time
                    if sleep_for > 0:
                        time.sleep(sleep_for)
                    elapsed += dt

            # Between loops
            print()  # newline before next cycle

    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        sock.close()


if __name__ == "__main__":
    main()
