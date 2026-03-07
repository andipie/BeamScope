import * as dgram from "dgram";
import { WebSocketServer, WebSocket } from "ws";

// Port configuration via environment variables
const UDP_PORT = parseInt(process.env["UDP_PORT"] ?? "5005", 10);
const WS_PORT = parseInt(process.env["WS_PORT"] ?? "8765", 10);

// --- WebSocket server ---

const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set<WebSocket>();

wss.on("listening", () => {
  console.log(`[bridge] WebSocket server listening on ws://localhost:${WS_PORT}`);
});

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[bridge] WS client connected (total: ${clients.size})`);

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[bridge] WS client disconnected (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error("[bridge] WS client error:", err.message);
  });
});

wss.on("error", (err) => {
  console.error("[bridge] WebSocket server error:", err.message);
});

// --- UDP socket ---

const udp = dgram.createSocket("udp4");

udp.on("listening", () => {
  const addr = udp.address();
  console.log(`[bridge] UDP socket listening on ${addr.address}:${addr.port}`);
});

udp.on("message", (msg) => {
  const raw = msg.toString("utf8");

  // TODO: validate JSON before forwarding
  // For now, forward raw message to all connected WebSocket clients
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[bridge] Received invalid JSON, discarding packet");
    return;
  }

  // Re-serialize to ensure clean JSON (strips any binary artefacts)
  const forwarded = JSON.stringify(parsed);
  let sent = 0;

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(forwarded);
      sent++;
    }
  }

  console.log(`[bridge] UDP packet forwarded to ${sent}/${clients.size} client(s)`);
});

udp.on("error", (err) => {
  console.error("[bridge] UDP socket error:", err.message);
});

udp.bind(UDP_PORT);
