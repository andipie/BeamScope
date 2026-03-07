#!/usr/bin/env python3
"""
BeamScope Demo Simulation
=========================
Config-driven synthetic collimator animation.

Reads a collimator JSON config file, discovers all modules, and generates
matching real-time animation — FLD values, module IDs, and constraint ranges
are taken directly from the config so they always stay in sync.

Usage
-----
    python scripts/demo_simulation.py
    python scripts/demo_simulation.py --config configs/quad-jaw-v1.json
    python scripts/demo_simulation.py --config configs/quad-jaw-v1.json --rate 60

Defaults: --config configs/example-collimator.json  --host 127.0.0.1  --port 5005  --rate 30

Prerequisites
-------------
    1. cd bridge && bun run start
    2. cd visualizer && bun run dev
    3. python scripts/demo_simulation.py [--config ...]
    4. Switch dropdown to "Simulation" in the browser
"""

import argparse
import json
import math
import random
import socket
import sys
import time
from pathlib import Path


# ---------------------------------------------------------------------------
# Smooth animated axis
# ---------------------------------------------------------------------------

class SmoothAxis:
    """
    Single animated value: sinusoidal base + mean-reverting random walk.

    Parameters
    ----------
    amplitude   : half-range of the sine wave (peak deviation from center)
    period      : duration of one full sine cycle in seconds
    noise_sigma : per-second standard deviation of the random walk
    min_val     : hard lower clamp
    max_val     : hard upper clamp
    center      : midpoint of the sine oscillation (defaults to 0)
    phase       : starting phase in radians (random if None)
    """

    def __init__(
        self,
        amplitude: float,
        period: float,
        noise_sigma: float,
        min_val: float,
        max_val: float,
        center: float = 0.0,
        phase: float | None = None,
    ) -> None:
        self.amplitude = amplitude
        self.period = period
        self.noise_sigma = noise_sigma
        self.min_val = min_val
        self.max_val = max_val
        self.center = center
        self.phase = phase if phase is not None else random.uniform(0.0, 2.0 * math.pi)
        self._walk = 0.0

    def value(self, t: float, dt: float) -> float:
        """Return the current axis value at time *t* (seconds), given frame delta *dt*."""
        base = self.center + self.amplitude * math.sin(
            2.0 * math.pi * t / self.period + self.phase
        )
        self._walk += random.gauss(0.0, self.noise_sigma * dt)
        self._walk *= 0.98  # gentle mean-reversion
        raw = base + self._walk
        return max(self.min_val, min(self.max_val, raw))


# ---------------------------------------------------------------------------
# Auto-generate animation axes from a collimator config
# ---------------------------------------------------------------------------

# Base periods per module type — randomized slightly so axes don't sync up
_BASE_PERIODS = {
    "jaws_rect":       7.0,
    "jaws_square":     9.0,
    "jaws_asymmetric": 8.0,
    "prefilter":      20.0,
    "wedge":          13.0,
}
_period_idx = 0

def _next_period(mod_type: str) -> float:
    """Return a unique-ish period for the given module type."""
    global _period_idx
    _period_idx += 1
    base = _BASE_PERIODS.get(mod_type, 10.0)
    # offset by a prime factor so multiple modules of the same type don't overlap
    return base + _period_idx * 1.7


def _build_jaw_axes(mod: dict) -> dict:
    """Create animation axes for a jaw module (rect, square, asymmetric)."""
    constraints = mod.get("constraints", {})
    min_mm = constraints.get("min_mm", -150.0)
    max_mm = constraints.get("max_mm",  150.0)
    half_range = max_mm  # symmetric: animate from ~0 to max
    amplitude = half_range * 0.6
    period = _next_period(mod["type"])

    return {
        "type": mod["type"],
        "fld_mm": mod["fld_mm"],
        "aperture": SmoothAxis(
            amplitude=amplitude,
            period=period,
            noise_sigma=amplitude * 0.15,
            min_val=5.0,
            max_val=max_mm * 0.95,
        ),
    }


def _build_prefilter_axes(mod: dict) -> dict:
    """Create animation axes for a prefilter wheel."""
    return {
        "type": "prefilter",
        "fld_mm": mod["fld_mm"],
        "angle": SmoothAxis(
            amplitude=180.0,
            period=_next_period("prefilter"),
            noise_sigma=5.0,
            min_val=-1e9,
            max_val=1e9,
        ),
    }


def _build_wedge_axes(mod: dict) -> dict:
    """Create animation axes for a wedge filter."""
    return {
        "type": "wedge",
        "fld_mm": mod["fld_mm"],
        "lateral_offset": SmoothAxis(
            amplitude=40.0,
            period=_next_period("wedge"),
            noise_sigma=8.0,
            min_val=-80.0,
            max_val=80.0,
        ),
    }


_BUILDERS = {
    "jaws_rect":       _build_jaw_axes,
    "jaws_square":     _build_jaw_axes,
    "jaws_asymmetric": _build_jaw_axes,
    "prefilter":       _build_prefilter_axes,
    "wedge":           _build_wedge_axes,
}


def build_module_axes(config: dict) -> dict[str, dict]:
    """
    Read a CollimatorConfig and return a dict mapping module ID → animation axes.
    """
    axes: dict[str, dict] = {}
    for mod in config.get("modules", []):
        mod_id = mod["id"]
        mod_type = mod["type"]
        builder = _BUILDERS.get(mod_type)
        if builder:
            axes[mod_id] = builder(mod)
        else:
            print(f"  [warn] Unknown module type '{mod_type}' for '{mod_id}' — skipping animation")
    return axes


# ---------------------------------------------------------------------------
# Sample one frame
# ---------------------------------------------------------------------------

def sample_frame(
    module_axes: dict[str, dict],
    t: float,
    dt: float,
    sid_axis: SmoothAxis,
    coll_rot_axis: SmoothAxis,
) -> dict:
    """Build a full data-stream packet for time *t*."""
    modules: dict = {}

    for mod_id, axes in module_axes.items():
        mod_type = axes["type"]

        if mod_type in ("jaws_rect", "jaws_square", "jaws_asymmetric"):
            ap = axes["aperture"].value(t, dt)
            modules[mod_id] = {
                "leaf1": round(-ap, 2),
                "leaf2": round(ap, 2),
                "rotation_deg": 0.0,
                "fld_mm": axes["fld_mm"],
            }

        elif mod_type == "prefilter":
            ang = axes["angle"].value(t, dt) % 360.0
            modules[mod_id] = {
                "angle_deg": round(ang, 2),
                "rotation_deg": 0.0,
            }

        elif mod_type == "wedge":
            off = axes["lateral_offset"].value(t, dt)
            modules[mod_id] = {
                "enabled": True,
                "lateral_offset_mm": round(off, 2),
                "rotation_deg": 0.0,
            }

    sid = sid_axis.value(t, dt)
    cr = coll_rot_axis.value(t, dt)

    return {
        "timestamp": int(time.time() * 1000),
        "sid": round(sid, 1),
        "collimator_rotation_deg": round(cr, 2),
        "focal_spot": {"x": 1.2, "y": 1.2},
        "modules": modules,
    }


# ---------------------------------------------------------------------------
# Status line formatting
# ---------------------------------------------------------------------------

def format_status(frame: int, packet: dict, module_axes: dict[str, dict]) -> str:
    """One-line terminal status (overwritten in-place)."""
    parts = [
        f"Frame #{frame:5d}",
        f"SID={packet['sid']:6.1f}mm",
        f"CollRot={packet['collimator_rotation_deg']:+5.1f}\u00b0",
    ]

    for mod_id, axes in module_axes.items():
        mod_type = axes["type"]
        mod_state = packet["modules"].get(mod_id, {})

        if mod_type in ("jaws_rect", "jaws_square", "jaws_asymmetric"):
            ap = mod_state.get("leaf2", 0.0)
            parts.append(f"{mod_id}=\u00b1{ap:5.1f}mm")
        elif mod_type == "prefilter":
            ang = mod_state.get("angle_deg", 0.0)
            parts.append(f"{mod_id}={ang:5.1f}\u00b0")
        elif mod_type == "wedge":
            off = mod_state.get("lateral_offset_mm", 0.0)
            parts.append(f"{mod_id}={off:+5.1f}mm")

    return " | ".join(parts)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="BeamScope Demo Simulation \u2014 config-driven synthetic collimator motion via UDP",
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
        # Try relative to script location (for running from project root)
        alt = Path(__file__).resolve().parent.parent / args.config
        if alt.is_file():
            config_path = alt
        else:
            print(f"Error: config file not found: {args.config}")
            sys.exit(1)

    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)

    collimator_id = config.get("collimator_id", config_path.stem)
    module_axes = build_module_axes(config)

    if not module_axes:
        print("Error: no animatable modules found in config.")
        sys.exit(1)

    # --- Global axes ---------------------------------------------------------
    sid_axis = SmoothAxis(
        amplitude=30.0, period=25.0, noise_sigma=5.0,
        min_val=900.0, max_val=1100.0, center=1000.0,
    )
    coll_rot_axis = SmoothAxis(
        amplitude=15.0, period=30.0, noise_sigma=3.0,
        min_val=-45.0, max_val=45.0,
    )

    # --- UDP socket ----------------------------------------------------------
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    dt = 1.0 / args.rate

    print(f"BeamScope Demo Simulation")
    print(f"  Config:  {config_path.name} ({collimator_id})")
    print(f"  Modules: {', '.join(module_axes.keys())}")
    print(f"  Target:  udp://{args.host}:{args.port} @ {args.rate} Hz")
    print(f"Press Ctrl+C to stop.\n")

    t = 0.0
    frame = 0

    try:
        while True:
            frame_start = time.perf_counter()

            packet = sample_frame(module_axes, t, dt, sid_axis, coll_rot_axis)
            data = json.dumps(packet).encode("utf-8")
            sock.sendto(data, (args.host, args.port))

            status = format_status(frame, packet, module_axes)
            sys.stdout.write(f"\r{status}")
            sys.stdout.flush()

            elapsed = time.perf_counter() - frame_start
            sleep_for = dt - elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)

            t += dt
            frame += 1

    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        sock.close()


if __name__ == "__main__":
    main()
