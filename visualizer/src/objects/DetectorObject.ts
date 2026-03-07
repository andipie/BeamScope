import * as THREE from "three";
import type { CollimatorState } from "../state/CollimatorState.js";
import type { CollimatorConfig } from "../config/types.js";
import { computeFieldPolygon } from "../geometry/fieldPolygon.js";

/** Maximum polygon vertices for the highlight (pre-allocated buffer). */
const MAX_HIGHLIGHT_VERTS = 20;
const MAX_HIGHLIGHT_TRIS = MAX_HIGHLIGHT_VERTS - 2;

/**
 * 3D representation of the detector plane.
 *
 * - Semi-transparent flat plate (800×800 mm) lying in the XZ plane at Y = -SID
 * - Cyan highlight polygon showing the projected beam field at the detector plane
 * - Both plate and highlight move with SID changes
 * - Highlight rotates with collimator_rotation_deg
 */
export class DetectorObject {
  private readonly scene: THREE.Scene;
  private readonly plate: THREE.Mesh;
  private readonly plateGeo: THREE.PlaneGeometry;
  private readonly plateMat: THREE.MeshStandardMaterial;

  // Highlight: projected beam field polygon on the detector surface
  private readonly highlightGroup: THREE.Group;
  private readonly highlightMesh: THREE.Mesh;
  private readonly highlightGeo: THREE.BufferGeometry;
  private readonly highlightPositions: Float32Array;
  private readonly highlightIndices: Uint16Array;
  private readonly highlightMat: THREE.MeshBasicMaterial;

  // Projected wedge outlines on the detector: one group per wedge module.
  // Each group contains a bright colored LineLoop (outline) + subtle fill.
  // Projected via SID/FLD from the focal spot through the wedge plane.
  private readonly wedgeOutlines = new Map<string, THREE.Group>();
  // Wedge dimensions — must match WedgeObject.ts WEDGE_LENGTH / WEDGE_WIDTH
  private static readonly WEDGE_LENGTH = 380;
  private static readonly WEDGE_WIDTH = 70;
  private static readonly WEDGE_COLOR = 0xe67e22; // orange, matches BEV

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // Detector plate: 800×800mm, rotated to lie in the XZ plane (normal along Y)
    this.plateGeo = new THREE.PlaneGeometry(800, 800);
    this.plateGeo.rotateX(Math.PI / 2);
    this.plateMat = new THREE.MeshStandardMaterial({
      color: 0x222244,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    this.plate = new THREE.Mesh(this.plateGeo, this.plateMat);
    scene.add(this.plate);

    // Highlight: dynamic polygon in XZ plane, updated each frame
    this.highlightPositions = new Float32Array(MAX_HIGHLIGHT_VERTS * 3);
    this.highlightIndices = new Uint16Array(MAX_HIGHLIGHT_TRIS * 3);
    this.highlightGeo = new THREE.BufferGeometry();
    this.highlightGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.highlightPositions, 3),
    );
    this.highlightGeo.setIndex(new THREE.BufferAttribute(this.highlightIndices, 1));

    this.highlightMat = new THREE.MeshBasicMaterial({
      color: 0x00ffee,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1, // render slightly in front of the detector plate
    });
    this.highlightMesh = new THREE.Mesh(this.highlightGeo, this.highlightMat);

    this.highlightGroup = new THREE.Group();
    this.highlightGroup.add(this.highlightMesh);
    scene.add(this.highlightGroup);
  }

  update(state: CollimatorState, config: CollimatorConfig): void {
    const y = -state.sid;
    this.plate.position.y = y;

    const poly = computeFieldPolygon(state, config);
    const n = Math.min(poly.length, MAX_HIGHLIGHT_VERTS);

    if (n >= 3) {
      this.highlightMesh.visible = true;

      // Fill vertex buffer: polygon vertices in XZ plane at Y = y
      for (let i = 0; i < n; i++) {
        const off = i * 3;
        this.highlightPositions[off] = poly[i]!.x;
        this.highlightPositions[off + 1] = y;
        this.highlightPositions[off + 2] = poly[i]!.z;
      }

      // Fan triangulation: (0, i, i+1) for i in 1..n-2
      let idx = 0;
      for (let i = 1; i < n - 1; i++) {
        this.highlightIndices[idx++] = 0;
        this.highlightIndices[idx++] = i;
        this.highlightIndices[idx++] = i + 1;
      }

      const posAttr = this.highlightGeo.attributes["position"];
      if (posAttr) posAttr.needsUpdate = true;
      const idxAttr = this.highlightGeo.index;
      if (idxAttr) idxAttr.needsUpdate = true;
      this.highlightGeo.setDrawRange(0, idx);
      this.highlightGeo.computeBoundingSphere();
    } else {
      this.highlightMesh.visible = false;
    }

    // Match the collimator rotation so the highlight aligns with the beam cone
    this.highlightGroup.rotation.y = THREE.MathUtils.degToRad(state.collimator_rotation_deg);

    // Projected wedge outlines: draw the FLD-projected wedge footprint as a
    // bright-coloured rectangle (outline + subtle fill) on the detector plane.
    const outlineY = y + 0.5; // 0.5 mm above plate to avoid z-fighting
    for (const modConfig of config.modules) {
      if (modConfig.type !== "wedge") continue;
      const modState = state.modules[modConfig.id];
      if (!modState) continue;

      // enabled: data stream → config default → true
      const enabledRaw = modState["enabled"];
      const enabledCfg = modConfig["enabled"];
      const enabled =
        typeof enabledRaw === "boolean"
          ? enabledRaw
          : typeof enabledCfg === "boolean"
            ? (enabledCfg as boolean)
            : true;

      // Get or create outline group for this module
      let group = this.wedgeOutlines.get(modConfig.id);
      if (!group) {
        group = new THREE.Group();

        // Outline: unit-square LineLoop in XZ, scaled per frame
        const points = [
          new THREE.Vector3(-0.5, 0, -0.5),
          new THREE.Vector3(0.5, 0, -0.5),
          new THREE.Vector3(0.5, 0, 0.5),
          new THREE.Vector3(-0.5, 0, 0.5),
        ];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const lineMat = new THREE.LineBasicMaterial({
          color: DetectorObject.WEDGE_COLOR,
          linewidth: 2,
        });
        group.add(new THREE.LineLoop(lineGeo, lineMat));

        // Subtle fill
        const fillGeo = new THREE.PlaneGeometry(1, 1);
        fillGeo.rotateX(Math.PI / 2);
        const fillMat = new THREE.MeshBasicMaterial({
          color: DetectorObject.WEDGE_COLOR,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        group.add(new THREE.Mesh(fillGeo, fillMat));

        this.scene.add(group);
        this.wedgeOutlines.set(modConfig.id, group);
      }

      group.visible = enabled;
      if (!enabled) continue;

      const fld = modState.fld_mm ?? modConfig.fld_mm;
      const lateralOffset =
        typeof modState["lateral_offset_mm"] === "number"
          ? (modState["lateral_offset_mm"] as number)
          : typeof modConfig["lateral_offset_mm"] === "number"
            ? (modConfig["lateral_offset_mm"] as number)
            : 0;

      const projScale = state.sid / fld;
      const projW = DetectorObject.WEDGE_LENGTH * projScale;
      const projD = DetectorObject.WEDGE_WIDTH * projScale;

      // Project the lateral offset from leaf plane to detector plane
      const projOffset = lateralOffset * projScale;

      // Position children (outline + fill) at the projected lateral offset in local Z.
      // Children use unit geometry; group.scale.z = projD, so divide by projD to get mm.
      const localZ = projD > 0 ? projOffset / projD : 0;
      for (const child of group.children) {
        child.position.z = localZ;
      }

      group.position.set(0, outlineY, 0);
      group.scale.set(projW, 1, projD);
      group.rotation.y = THREE.MathUtils.degToRad(
        (modConfig.rotation_deg ?? 0) +
          modState.rotation_deg +
          state.collimator_rotation_deg,
      );
    }
  }

  dispose(): void {
    this.plateGeo.dispose();
    this.plateMat.dispose();
    this.plate.removeFromParent();
    this.highlightGeo.dispose();
    this.highlightMat.dispose();
    this.highlightGroup.removeFromParent();
    for (const group of this.wedgeOutlines.values()) {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineLoop) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      group.removeFromParent();
    }
    this.wedgeOutlines.clear();
  }
}
