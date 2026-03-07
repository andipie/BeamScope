#!/usr/bin/env python3
"""
BeamScope — Minimal Integration Example
========================================
Sends synthetic collimator data to the BeamScope bridge via UDP.

This is the simplest possible working example — copy and adapt it to
integrate your own simulation. For a more impressive demo with
choreographed sequences, see demo_showcase.py.

Collimator config: configs/example-collimator.json
"""

import json
import math
import socket
import time

# -- Connection settings (must match bridge server) -----------------------
HOST = "127.0.0.1"
PORT = 5005
RATE = 30  # Hz

# -- Create UDP socket ----------------------------------------------------
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
dt = 1.0 / RATE
t = 0.0

print(f"Sending to udp://{HOST}:{PORT} @ {RATE} Hz — Ctrl+C to stop\n")

try:
    while True:
        # Animate a few values with simple sine waves
        aperture_x = 60.0 + 50.0 * math.sin(2 * math.pi * t / 7.0)   # 10–110 mm
        aperture_y = 50.0 + 40.0 * math.sin(2 * math.pi * t / 11.0)  # 10–90 mm
        prefilter  = (t * 18.0) % 360.0                                # ~18°/s rotation
        wedge_off  = 30.0 * math.sin(2 * math.pi * t / 13.0)          # ±30 mm lateral

        # Build the data packet.
        # Module IDs must match the loaded collimator config.
        # All leaf positions are at the leaf plane (FLD), NOT at the detector.
        packet = {
            "timestamp": int(time.time() * 1000),
            "sid": 1000.0,
            "collimator_rotation_deg": 0.0,
            "focal_spot": {"x": 1.2, "y": 1.2},
            "modules": {
                "prefilter": {
                    "angle_deg": round(prefilter, 2),
                    "rotation_deg": 0.0,
                },
                "jaws_x": {
                    "leaf1": round(-aperture_x, 2),   # negative side
                    "leaf2": round(aperture_x, 2),     # positive side
                    "rotation_deg": 0.0,
                    "fld_mm": 300.0,                   # must match config
                },
                "jaws_y": {
                    "leaf1": round(-aperture_y, 2),
                    "leaf2": round(aperture_y, 2),
                    "rotation_deg": 0.0,
                    "fld_mm": 380.0,                   # must match config
                },
                "wedge_1": {
                    "enabled": True,
                    "lateral_offset_mm": round(wedge_off, 2),
                    "rotation_deg": 0.0,
                },
            },
        }

        # Send as UTF-8 JSON
        sock.sendto(json.dumps(packet).encode(), (HOST, PORT))

        # Status
        print(
            f"\rjaws_x=±{aperture_x:5.1f}  "
            f"jaws_y=±{aperture_y:5.1f}  "
            f"prefilter={prefilter:5.1f}°  "
            f"wedge={wedge_off:+5.1f}mm",
            end="", flush=True,
        )

        time.sleep(dt)
        t += dt

except KeyboardInterrupt:
    print("\nStopped.")
finally:
    sock.close()
