import * as THREE from "three";
import type { CollimatorState } from "../state/CollimatorState.js";

/**
 * 3D representation of the X-ray tube focal spot.
 *
 * - Always at Y=0 (source / apex of the beam cone)
 * - Rendered as a flat ellipse in the XZ plane
 * - Shape (aspect ratio) corresponds to state.focal_spot.x/y; absolute size is scaled up
 *   for visibility — physical focal spots (~1 mm) would be sub-pixel at scene scale.
 * - Bright yellow fill + opaque outline ring for clear identification
 */

/**
 * Visual scale factor: physical focal spot sizes (1–2 mm) are too small to see
 * at typical scene distances (hundreds to thousands of mm). This multiplier scales
 * the rendered ellipse while preserving the x/y aspect ratio.
 */
const VISUAL_SCALE = 15;
export class FocalSpotObject {
  private readonly group: THREE.Group;
  private readonly fillMesh: THREE.Mesh;
  private readonly ringMesh: THREE.Mesh;
  private readonly fillGeo: THREE.CircleGeometry;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly ringGeo: THREE.RingGeometry;
  private readonly ringMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // Filled ellipse (semi-transparent)
    this.fillGeo = new THREE.CircleGeometry(1, 64);
    this.fillGeo.rotateX(-Math.PI / 2); // XY-plane → XZ-plane
    this.fillMat = new THREE.MeshBasicMaterial({
      color: 0xffee44,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.fillMesh = new THREE.Mesh(this.fillGeo, this.fillMat);

    // Outline ring (full opacity, always visible)
    this.ringGeo = new THREE.RingGeometry(0.75, 1, 64);
    this.ringGeo.rotateX(-Math.PI / 2); // XY-plane → XZ-plane
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffee44,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ringMesh = new THREE.Mesh(this.ringGeo, this.ringMat);

    this.group.add(this.fillMesh, this.ringMesh);
    scene.add(this.group);
  }

  update(state: CollimatorState): void {
    // Scale preserves x/y aspect ratio; VISUAL_SCALE ensures sub-mm spots are visible
    const rx = (state.focal_spot.x / 2) * VISUAL_SCALE;
    const rz = (state.focal_spot.y / 2) * VISUAL_SCALE;
    this.fillMesh.scale.set(rx, 1, rz);
    this.ringMesh.scale.set(rx, 1, rz);
  }

  dispose(): void {
    this.fillGeo.dispose();
    this.fillMat.dispose();
    this.ringGeo.dispose();
    this.ringMat.dispose();
    this.group.removeFromParent();
  }
}
