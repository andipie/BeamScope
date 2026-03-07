import * as THREE from "three";
import type { CollimatorState } from "../state/CollimatorState.js";
import type { CollimatorConfig } from "../config/types.js";
import { computePCProjection, computeRawJawField } from "../geometry/fieldRect.js";

/** Half-size of the cosmetic housing frame surrounding the aperture (mm). */
const HOUSING_HALF = 250;

/** Normal (no clipping) material colours. */
const HOUSING_COLOR_NORMAL = 0x555555;
const BORDER_COLOR_NORMAL = 0x999999;
/** Clipping-detected material colours. */
const HOUSING_COLOR_CLIPPED = 0xcc2222;
const BORDER_COLOR_CLIPPED = 0xff6644;

/**
 * 3D representation of the primary collimator.
 *
 * Visual structure (rebuilt only on config change):
 *   - Semi-transparent frame mesh: shows the physical blocked material surrounding
 *     the aperture opening. Built with THREE.ShapeGeometry (outer rect with a hole)
 *     for "rect", or THREE.RingGeometry for "circle"/"ellipse".
 *   - Aperture border: bright LineSegments outlining the opening.
 *
 * Per-frame updates:
 *   - Applies global collimator_rotation_deg (Y-axis rotation).
 *   - Detects clipping: if raw jaw field extends beyond the PC aperture projection,
 *     both materials turn red/orange.
 *
 * Positioning: leaf-plane coordinates → Y = -pc.fld_mm in scene space.
 * Geometry is in the XZ plane (ShapeGeometry is XY by default → rotated -90° around X).
 */
export class PrimaryCollimatorObject {
  private readonly group: THREE.Group;
  /** Child group that receives collimator_rotation_deg around Y. */
  private readonly rotationGroup: THREE.Group;

  private frameMesh: THREE.Mesh | null = null;
  private frameMat: THREE.MeshBasicMaterial | null = null;
  private borderLine: THREE.LineSegments | null = null;
  private borderMat: THREE.LineBasicMaterial | null = null;

  private lastConfigId: string | null = null;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.rotationGroup = new THREE.Group();
    this.group.add(this.rotationGroup);
    scene.add(this.group);
  }

  update(state: CollimatorState, config: CollimatorConfig): void {
    // Rebuild geometry only when config changes
    if (config.collimator_id !== this.lastConfigId) {
      this.buildGeometry(config);
      this.lastConfigId = config.collimator_id;
    }

    // Apply global collimator rotation around the beam axis (Y)
    this.rotationGroup.rotation.y = THREE.MathUtils.degToRad(state.collimator_rotation_deg);

    // Detect clipping: raw jaw field vs PC aperture at detector (0.5 mm float tolerance)
    const pcProj = computePCProjection(state, config);
    const rawJaw = computeRawJawField(state, config);
    const clipped =
      rawJaw.x1 < pcProj.x1 - 0.5 ||
      rawJaw.x2 > pcProj.x2 + 0.5 ||
      rawJaw.z1 < pcProj.z1 - 0.5 ||
      rawJaw.z2 > pcProj.z2 + 0.5;

    if (this.frameMat) {
      this.frameMat.color.setHex(clipped ? HOUSING_COLOR_CLIPPED : HOUSING_COLOR_NORMAL);
      this.frameMat.opacity = clipped ? 0.6 : 0.45;
    }
    if (this.borderMat) {
      this.borderMat.color.setHex(clipped ? BORDER_COLOR_CLIPPED : BORDER_COLOR_NORMAL);
    }
  }

  dispose(): void {
    this.clearGeometry();
    this.group.removeFromParent();
  }

  // ---------------------------------------------------------------------------
  // Geometry construction
  // ---------------------------------------------------------------------------

  private buildGeometry(config: CollimatorConfig): void {
    this.clearGeometry();

    const pc = config.primary_collimator;

    this.frameMat = new THREE.MeshBasicMaterial({
      color: HOUSING_COLOR_NORMAL,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.borderMat = new THREE.LineBasicMaterial({ color: BORDER_COLOR_NORMAL });

    if (pc.shape === "circle" || pc.shape === "ellipse") {
      this.buildCircleGeometry(pc.radius_mm ?? pc.size.x / 2, pc.fld_mm);
    } else {
      this.buildRectGeometry(pc.size.x, pc.size.y, pc.fld_mm);
    }
  }

  private buildRectGeometry(apertureW: number, apertureH: number, fldMm: number): void {
    // --- Frame: outer housing square with rectangular aperture hole ---
    const outerShape = new THREE.Shape();
    outerShape.moveTo(-HOUSING_HALF, -HOUSING_HALF);
    outerShape.lineTo(HOUSING_HALF, -HOUSING_HALF);
    outerShape.lineTo(HOUSING_HALF, HOUSING_HALF);
    outerShape.lineTo(-HOUSING_HALF, HOUSING_HALF);
    outerShape.closePath();

    const hole = new THREE.Path();
    hole.moveTo(-apertureW / 2, -apertureH / 2);
    hole.lineTo(apertureW / 2, -apertureH / 2);
    hole.lineTo(apertureW / 2, apertureH / 2);
    hole.lineTo(-apertureW / 2, apertureH / 2);
    hole.closePath();
    outerShape.holes.push(hole);

    const frameGeo = new THREE.ShapeGeometry(outerShape);
    this.frameMesh = new THREE.Mesh(frameGeo, this.frameMat!);
    // ShapeGeometry lies in XY plane by default → rotate to XZ plane
    this.frameMesh.rotation.x = -Math.PI / 2;
    this.frameMesh.position.y = -fldMm;
    this.rotationGroup.add(this.frameMesh);

    // --- Aperture border: outline of the opening ---
    const planeGeo = new THREE.PlaneGeometry(apertureW, apertureH);
    const edgesGeo = new THREE.EdgesGeometry(planeGeo);
    planeGeo.dispose();
    this.borderLine = new THREE.LineSegments(edgesGeo, this.borderMat!);
    this.borderLine.rotation.x = -Math.PI / 2;
    this.borderLine.position.y = -fldMm;
    this.rotationGroup.add(this.borderLine);
  }

  private buildCircleGeometry(radiusMm: number, fldMm: number): void {
    // --- Frame: ring from aperture radius to housing outer radius ---
    const ringGeo = new THREE.RingGeometry(radiusMm, HOUSING_HALF, 64);
    this.frameMesh = new THREE.Mesh(ringGeo, this.frameMat!);
    this.frameMesh.rotation.x = -Math.PI / 2;
    this.frameMesh.position.y = -fldMm;
    this.rotationGroup.add(this.frameMesh);

    // --- Aperture border: circle outline ---
    const circlePts: THREE.Vector3[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      circlePts.push(new THREE.Vector3(Math.cos(angle) * radiusMm, 0, Math.sin(angle) * radiusMm));
    }
    const borderGeo = new THREE.BufferGeometry().setFromPoints(circlePts);
    this.borderLine = new THREE.LineSegments(borderGeo, this.borderMat!);
    this.borderLine.position.y = -fldMm;
    this.rotationGroup.add(this.borderLine);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private clearGeometry(): void {
    if (this.frameMesh) {
      (this.frameMesh.geometry as THREE.BufferGeometry).dispose();
      this.frameMesh.removeFromParent();
      this.frameMesh = null;
    }
    if (this.frameMat) {
      this.frameMat.dispose();
      this.frameMat = null;
    }
    if (this.borderLine) {
      (this.borderLine.geometry as THREE.BufferGeometry).dispose();
      this.borderLine.removeFromParent();
      this.borderLine = null;
    }
    if (this.borderMat) {
      this.borderMat.dispose();
      this.borderMat = null;
    }
  }
}
