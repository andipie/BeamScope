#!/usr/bin/env python3
"""
BeamScope Demo Simulation
=========================
Streams synthetic collimator motion to the BeamScope bridge server via UDP.

Each axis uses a sinusoidal base motion with a band-limited random walk
perturbation, giving continuous but non-repetitive movement.

Usage
-----
    python scripts/demo_simulation.py [--host HOST] [--port PORT] [--rate RATE]

Defaults: --host 127.0.0.1  --port 5005  --rate 30

Prerequisites
-------------
    1. cd bridge && bun run start      (bridge must be running)
    2. cd visualizer && bun run dev    (open in browser)
    3. python scripts/demo_simulation.py
    4. Switch dropdown to "Simulation" in the browser

Collimator config: configs/example-collimator.json
"""

import argparse
import json
import math
import random
import socket
import sys
import time


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
        """Return the current axis value at time t (seconds), given frame delta dt."""
        base = self.center + self.amplitude * math.sin(
            2.0 * math.pi * t / self.period + self.phase
        )
        # Gaussian step, then gentle mean-reversion to avoid unbounded drift
        self._walk += random.gauss(0.0, self.noise_sigma * dt)
        self._walk *= 0.98
        raw = base + self._walk
        return max(self.min_val, min(self.max_val, raw))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="BeamScope Demo Simulation — streams synthetic collimator motion via UDP",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bridge UDP host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5005, help="Bridge UDP port (default: 5005)")
    parser.add_argument("--rate", type=int, default=30, help="Update rate in Hz (default: 30)")
    args = parser.parse_args()

    dt = 1.0 / args.rate

    # --- Axis definitions --------------------------------------------------
    # jaws_x: symmetric aperture, period 7 s, substantial noise
    jaws_x_ap = SmoothAxis(amplitude=80.0, period=7.0,  noise_sigma=15.0, min_val=5.0,  max_val=130.0)
    # jaws_y: symmetric aperture, slower period 11 s
    jaws_y_ap = SmoothAxis(amplitude=60.0, period=11.0, noise_sigma=10.0, min_val=5.0,  max_val=130.0)
    # prefilter: continuous rotation — unbounded (modulo 360 applied at send time)
    prefilter_angle = SmoothAxis(amplitude=180.0, period=20.0, noise_sigma=5.0,
                                 min_val=-1e9, max_val=1e9)
    # wedge lateral offset
    wedge_offset = SmoothAxis(amplitude=40.0, period=13.0, noise_sigma=8.0, min_val=-80.0, max_val=80.0)
    # global collimator rotation: slow drift ±15°
    coll_rot = SmoothAxis(amplitude=15.0, period=30.0, noise_sigma=3.0, min_val=-45.0, max_val=45.0)
    # SID: subtle variation around 1000 mm
    sid_axis = SmoothAxis(amplitude=30.0, period=25.0, noise_sigma=5.0,
                          min_val=900.0, max_val=1100.0, center=1000.0)

    # --- Wedge enable toggle -----------------------------------------------
    wedge_enabled = True
    wedge_toggle_timer = 0.0
    wedge_next_toggle = random.uniform(5.0, 15.0)

    # --- UDP socket --------------------------------------------------------
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    print(f"BeamScope Demo Simulation → udp://{args.host}:{args.port} @ {args.rate} Hz")
    print("Press Ctrl+C to stop.\n")

    t = 0.0
    frame = 0

    try:
        while True:
            frame_start = time.perf_counter()

            # Wedge toggle
            wedge_toggle_timer += dt
            if wedge_toggle_timer >= wedge_next_toggle:
                wedge_enabled = not wedge_enabled
                wedge_toggle_timer = 0.0
                wedge_next_toggle = random.uniform(5.0, 15.0)

            # Sample all axes
            ap_x   = jaws_x_ap.value(t, dt)
            ap_y   = jaws_y_ap.value(t, dt)
            pf_ang = prefilter_angle.value(t, dt) % 360.0
            w_off  = wedge_offset.value(t, dt)
            cr     = coll_rot.value(t, dt)
            sid    = sid_axis.value(t, dt)

            # Build UDP packet matching the BeamScope data stream format
            packet = {
                "timestamp": int(time.time() * 1000),
                "sid": round(sid, 1),
                "collimator_rotation_deg": round(cr, 2),
                "focal_spot": {"x": 1.2, "y": 1.2},
                "modules": {
                    "prefilter": {
                        "angle_deg": round(pf_ang, 2),
                        "rotation_deg": 0.0,
                    },
                    "jaws_x": {
                        "leaf1": round(-ap_x, 2),
                        "leaf2": round(ap_x, 2),
                        "rotation_deg": 0.0,
                        "fld_mm": 500.0,
                    },
                    "jaws_y": {
                        "leaf1": round(-ap_y, 2),
                        "leaf2": round(ap_y, 2),
                        "rotation_deg": 0.0,
                        "fld_mm": 520.0,
                    },
                    "wedge_1": {
                        "enabled": wedge_enabled,
                        "lateral_offset_mm": round(w_off, 2),
                        "rotation_deg": 0.0,
                    },
                },
            }

            data = json.dumps(packet).encode("utf-8")
            sock.sendto(data, (args.host, args.port))

            # Status line (overwritten in-place, no scroll spam)
            status = (
                f"Frame #{frame:5d} | "
                f"SID={sid:6.1f}mm  "
                f"CollRot={cr:+5.1f}°  "
                f"jaws_x=±{ap_x:5.1f}mm  "
                f"jaws_y=±{ap_y:5.1f}mm  "
                f"prefilter={pf_ang:5.1f}°  "
                f"wedge={'ON ' if wedge_enabled else 'OFF'}  "
                f"off={w_off:+5.1f}mm"
            )
            sys.stdout.write(f"\r{status}")
            sys.stdout.flush()

            # Precise sleep to maintain target rate
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
