import type { DataSource } from "../state/DataSource.js";
import type { CollimatorState, ModuleState } from "../state/CollimatorState.js";
import { DEFAULT_STATE } from "../state/CollimatorState.js";

export type ConnectionStatus = "connected" | "waiting" | "disconnected" | "error" | "manual";

/**
 * Receives live collimator state from the UDP → WebSocket bridge.
 *
 * - Connects to ws://localhost:8765 (configurable via WS_URL)
 * - Parses incoming JSON frames and calls onStateUpdate()
 * - Reconnects automatically on disconnect (exponential backoff, max 30s)
 * - Reports connection status via onStatusChange callback
 */
export class SimulationSource implements DataSource {
  readonly id = "simulation";
  readonly label = "Simulation";

  onStateUpdate: (state: CollimatorState) => void = () => undefined;

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000; // ms, doubles on each failure, max 30s
  private active = false;

  onStatusChange: (status: ConnectionStatus) => void = () => undefined;

  constructor(private readonly wsUrl = "ws://localhost:8765") {}

  activate(): void {
    this.active = true;
    this.reconnectDelay = 1000;
    this.connect();
  }

  deactivate(): void {
    this.active = false;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onStatusChange("disconnected");
  }

  private connect(): void {
    this.onStatusChange("waiting");

    const ws = new WebSocket(this.wsUrl);

    ws.onopen = () => {
      this.reconnectDelay = 1000; // reset backoff on successful connect
      this.onStatusChange("connected");
      console.log("[SimulationSource] Connected to", this.wsUrl);
    };

    ws.onmessage = (ev) => {
      this.handleMessage(ev.data);
    };

    ws.onerror = () => {
      this.onStatusChange("error");
      console.warn("[SimulationSource] WebSocket error");
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.active) {
        console.log(`[SimulationSource] Connection lost — reconnecting in ${this.reconnectDelay}ms`);
        this.scheduleReconnect();
      }
    };

    this.ws = ws;
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("[SimulationSource] Invalid JSON, discarding");
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      console.warn("[SimulationSource] Packet is not an object, discarding");
      return;
    }

    const obj = parsed as Record<string, unknown>;

    // Top-level fields — fall back to defaults when missing or wrong type
    const timestamp =
      typeof obj["timestamp"] === "number" ? obj["timestamp"] : DEFAULT_STATE.timestamp;
    const sid = typeof obj["sid"] === "number" ? obj["sid"] : DEFAULT_STATE.sid;
    const collimator_rotation_deg =
      typeof obj["collimator_rotation_deg"] === "number"
        ? obj["collimator_rotation_deg"]
        : DEFAULT_STATE.collimator_rotation_deg;

    let focal_spot = DEFAULT_STATE.focal_spot;
    if (typeof obj["focal_spot"] === "object" && obj["focal_spot"] !== null) {
      const fs = obj["focal_spot"] as Record<string, unknown>;
      if (typeof fs["x"] === "number" && typeof fs["y"] === "number") {
        focal_spot = { x: fs["x"], y: fs["y"] };
      }
    }

    // Module map — StateStore will filter unknown IDs against the loaded config
    const modules: CollimatorState["modules"] = {};
    if (typeof obj["modules"] === "object" && obj["modules"] !== null) {
      for (const [id, val] of Object.entries(obj["modules"] as Record<string, unknown>)) {
        if (typeof val !== "object" || val === null) continue;
        const m = val as Record<string, unknown>;
        const moduleState: ModuleState = {
          rotation_deg: typeof m["rotation_deg"] === "number" ? m["rotation_deg"] : 0,
        };
        for (const [k, v] of Object.entries(m)) {
          if (k !== "rotation_deg" && (typeof v === "number" || typeof v === "boolean")) {
            moduleState[k] = v;
          }
        }
        modules[id] = moduleState;
      }
    }

    this.onStateUpdate({ timestamp, sid, collimator_rotation_deg, focal_spot, modules });
  }

  private scheduleReconnect(): void {
    this.onStatusChange("waiting");
    this.reconnectTimer = setTimeout(() => {
      if (this.active) {
        this.connect();
      }
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
