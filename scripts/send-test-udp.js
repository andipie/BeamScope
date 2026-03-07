#!/usr/bin/env node
// Sends a single test UDP packet to the BeamScope bridge.
// Usage: node scripts/send-test-udp.js [host] [port]
// Defaults: host=localhost, port=5005

import * as dgram from "dgram";

const HOST = process.argv[2] ?? "localhost";
const PORT = parseInt(process.argv[3] ?? "5005", 10);

// Test packet matching the US-02 data stream format.
// Module IDs correspond to configs/example-collimator.json.
const packet = {
  timestamp: Date.now(),
  sid: 1000.0,
  collimator_rotation_deg: 0.0,
  focal_spot: { x: 1.2, y: 1.2 },
  modules: {
    prefilter: {
      angle_deg: 135.0,
      rotation_deg: 0.0,
    },
    jaws_x: {
      leaf1: -100.0,
      leaf2: 100.0,
      rotation_deg: 0.0,
      fld_mm: 300.0,
    },
    jaws_y: {
      leaf1: -100.0,
      leaf2: 100.0,
      rotation_deg: 0.0,
      fld_mm: 380.0,
    },
    wedge_1: {
      enabled: true,
      lateral_offset_mm: 0.0,
      rotation_deg: 0.0,
    },
  },
};

const message = Buffer.from(JSON.stringify(packet), "utf8");
const client = dgram.createSocket("udp4");

client.send(message, PORT, HOST, (err) => {
  if (err) {
    console.error(`[send-test-udp] Failed to send packet: ${err.message}`);
    process.exit(1);
  }
  console.log(`[send-test-udp] Sent ${message.length} bytes to ${HOST}:${PORT}`);
  console.log(`[send-test-udp] Packet: ${JSON.stringify(packet, null, 2)}`);
  client.close();
});
