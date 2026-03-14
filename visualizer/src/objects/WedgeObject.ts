import * as THREE from "three";
import type { CollimatorState } from "../core/state/CollimatorState.js";
import type { CollimatorConfig, ModuleConfig } from "../core/config/types.js";

/**
 * Visual footprint of the wedge in the XZ plane (mm).
 * A wedge filter is long along its gradient direction (X at 0°) and narrow perpendicular (Z).
 */
const WEDGE_LENGTH = 380; // along gradient direction (X at rotation_deg = 0)
const WEDGE_WIDTH = 70;   // narrow dimension (Z at rotation_deg = 0)

import { moduleColor } from "../utils/moduleColor.js";

/**
 * 3D representation of a wedge filter module.
 *
 * - Rendered as a simplified cuboid at Y = -fld_mm
 * - Height (Y dimension) = thickness_mm from config
 * - Hidden when enabled === false (with fallback to config default)
 * - lateral_offset_mm shifts the wedge perpendicular to its long axis (local Z)
 * - Total Y rotation: (config.rotation_deg ?? 0) + state.rotation_deg + collimator_rotation_deg
 */
export class WedgeObject {
  private readonly group: THREE.Group;
  private readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BoxGeometry;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly modConfig: ModuleConfig;

  constructor(scene: THREE.Scene, modConfig: ModuleConfig) {
    this.modConfig = modConfig;
    this.group = new THREE.Group();

    this.geo = new THREE.BoxGeometry(WEDGE_LENGTH, modConfig.thickness_mm, WEDGE_WIDTH);
    this.mat = new THREE.MeshStandardMaterial({
      color: moduleColor(modConfig.id),
      transparent: true,
      opacity: 0.6,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.group.add(this.mesh);
    scene.add(this.group);
  }

  update(state: CollimatorState, _config: CollimatorConfig, moduleId: string): void {
    const modState = state.modules[moduleId];
    if (!modState) return;

    // Visibility: data stream → config default → show
    const enabled =
      typeof modState["enabled"] === "boolean"
        ? modState["enabled"]
        : typeof this.modConfig["enabled"] === "boolean"
          ? (this.modConfig["enabled"] as boolean)
          : true;
    this.group.visible = enabled;

    if (!enabled) return;

    // FLD: data stream override or config default
    const fld = modState.fld_mm ?? this.modConfig.fld_mm;
    this.group.position.y = -fld;

    // lateral_offset_mm: data stream → config default → 0
    const lateralOffset =
      typeof modState["lateral_offset_mm"] === "number"
        ? modState["lateral_offset_mm"]
        : typeof this.modConfig["lateral_offset_mm"] === "number"
          ? (this.modConfig["lateral_offset_mm"] as number)
          : 0;

    // Lateral offset: translate mesh in local Z (perpendicular to long axis).
    // Since mesh is a child of group, group.rotation.y transforms this correctly.
    this.mesh.position.z = lateralOffset;

    // Total Y rotation: config base + module rotation + global collimator rotation
    const totalRot =
      (this.modConfig.rotation_deg ?? 0) +
      modState.rotation_deg +
      state.collimator_rotation_deg;
    this.group.rotation.y = THREE.MathUtils.degToRad(totalRot);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.group.removeFromParent();
  }
}
