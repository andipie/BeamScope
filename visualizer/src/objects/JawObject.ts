import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { CollimatorState } from "../state/CollimatorState.js";
import type { CollimatorConfig, ModuleConfig } from "../config/types.js";
import { leafColor, leafColorCSS } from "../utils/moduleColor.js";
import type { LeafName } from "../utils/moduleColor.js";

/** How far the leaf body extends outward from its imaging face (mm). */
const BODY_WIDTH = 300;

/** Leaf extent perpendicular to the movement direction (mm). */
const LEAF_DEPTH = 250;

/**
 * Visual thickness along the beam axis (mm) — purely cosmetic, independent of
 * the physical thickness_mm in the config. Keeps the leaves from looking too chunky.
 */
const VISUAL_THICKNESS = 8;

// ---------------------------------------------------------------------------
// LeafPairData — all render data for one pair of opposing leaves
// ---------------------------------------------------------------------------

interface LeafPairData {
  body1: THREE.Mesh;
  body2: THREE.Mesh;
  face1: THREE.Mesh;
  face2: THREE.Mesh;
  nonFace1: THREE.Mesh;
  nonFace2: THREE.Mesh;
  label1: CSS2DObject;
  label2: CSS2DObject;
  labelEl1: HTMLSpanElement;
  labelEl2: HTMLSpanElement;
  mat1: THREE.MeshStandardMaterial;
  mat2: THREE.MeshStandardMaterial;
  imgFaceMat1: THREE.MeshBasicMaterial;
  imgFaceMat2: THREE.MeshBasicMaterial;
  nonFaceMat1: THREE.MeshBasicMaterial;
  nonFaceMat2: THREE.MeshBasicMaterial;
  defaultColor1: number;
  defaultColor2: number;
  leafName1: LeafName;
  leafName2: LeafName;
}

/**
 * Creates all meshes, materials, and labels for a pair of opposing leaves.
 * All objects are added to the provided parent group.
 */
function createLeafPair(
  parent: THREE.Group,
  bodyGeo: THREE.BoxGeometry,
  faceGeo: THREE.PlaneGeometry,
  modId: string,
  leafName1: LeafName,
  leafName2: LeafName,
  labelSuffix1: string,
  labelSuffix2: string,
): LeafPairData {
  const color1 = leafColor(modId, leafName1);
  const color2 = leafColor(modId, leafName2);

  // Body materials — semi-transparent (60% opacity)
  const mat1 = new THREE.MeshStandardMaterial({ color: color1, transparent: true, opacity: 0.6 });
  const mat2 = new THREE.MeshStandardMaterial({ color: color2, transparent: true, opacity: 0.6 });

  // Imaging face materials — full opacity, saturated color
  const imgFaceOpts = {
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  };
  const imgFaceMat1 = new THREE.MeshBasicMaterial({ color: color1, ...imgFaceOpts });
  const imgFaceMat2 = new THREE.MeshBasicMaterial({ color: color2, ...imgFaceOpts });

  // Non-imaging face materials — heavily dimmed (20% opacity)
  const nonFaceMat1 = new THREE.MeshBasicMaterial({ color: color1, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
  const nonFaceMat2 = new THREE.MeshBasicMaterial({ color: color2, transparent: true, opacity: 0.2, side: THREE.DoubleSide });

  // Meshes — leaf 1
  const body1 = new THREE.Mesh(bodyGeo, mat1);
  const face1 = new THREE.Mesh(faceGeo, imgFaceMat1);
  face1.rotation.y = Math.PI / 2;
  const nonFace1 = new THREE.Mesh(faceGeo, nonFaceMat1);
  nonFace1.rotation.y = Math.PI / 2;

  // Meshes — leaf 2
  const body2 = new THREE.Mesh(bodyGeo, mat2);
  const face2 = new THREE.Mesh(faceGeo, imgFaceMat2);
  face2.rotation.y = Math.PI / 2;
  const nonFace2 = new THREE.Mesh(faceGeo, nonFaceMat2);
  nonFace2.rotation.y = Math.PI / 2;

  // CSS2D billboard labels
  const labelEl1 = document.createElement("span");
  labelEl1.className = "jaw-leaf-label";
  labelEl1.textContent = `${modId} \u00b7 ${labelSuffix1}`;
  labelEl1.style.borderColor = leafColorCSS(modId, leafName1);
  const label1 = new CSS2DObject(labelEl1);

  const labelEl2 = document.createElement("span");
  labelEl2.className = "jaw-leaf-label";
  labelEl2.textContent = `${modId} \u00b7 ${labelSuffix2}`;
  labelEl2.style.borderColor = leafColorCSS(modId, leafName2);
  const label2 = new CSS2DObject(labelEl2);

  parent.add(body1, face1, nonFace1, body2, face2, nonFace2, label1, label2);

  return {
    body1, body2, face1, face2, nonFace1, nonFace2,
    label1, label2, labelEl1, labelEl2,
    mat1, mat2, imgFaceMat1, imgFaceMat2, nonFaceMat1, nonFaceMat2,
    defaultColor1: color1, defaultColor2: color2,
    leafName1, leafName2,
  };
}

/** Position one leaf (body + imaging face + non-imaging face + label) in local space. */
function positionLeaf(
  body: THREE.Mesh,
  imgFace: THREE.Mesh,
  nonFace: THREE.Mesh,
  label: CSS2DObject,
  leafPos: number,
  fld: number,
  baseDir: 1 | -1,
): void {
  const actualDir: 1 | -1 = leafPos > 0 ? 1 : leafPos < 0 ? -1 : baseDir;
  body.position.set(leafPos + actualDir * (BODY_WIDTH / 2), -fld, 0);
  imgFace.position.set(leafPos, -fld, 0);
  nonFace.position.set(leafPos + actualDir * BODY_WIDTH, -fld, 0);
  label.position.set(leafPos, -fld + VISUAL_THICKNESS, 0);
}

/** Apply violation or default colors to a leaf pair's materials + labels. */
function applyPairViolations(
  pair: LeafPairData,
  leaf1Violated: boolean,
  leaf2Violated: boolean,
  modId: string,
): void {
  const VC = 0xff0000; // violation color
  const c1 = leaf1Violated ? VC : pair.defaultColor1;
  const c2 = leaf2Violated ? VC : pair.defaultColor2;

  pair.mat1.color.setHex(c1);
  pair.imgFaceMat1.color.setHex(c1);
  pair.nonFaceMat1.color.setHex(c1);

  pair.mat2.color.setHex(c2);
  pair.imgFaceMat2.color.setHex(c2);
  pair.nonFaceMat2.color.setHex(c2);

  pair.labelEl1.style.borderColor = leaf1Violated ? "#ff0000" : leafColorCSS(modId, pair.leafName1);
  pair.labelEl2.style.borderColor = leaf2Violated ? "#ff0000" : leafColorCSS(modId, pair.leafName2);
}

/** Dispose all materials and remove CSS2D labels in a leaf pair. */
function disposePair(pair: LeafPairData): void {
  pair.mat1.dispose();
  pair.mat2.dispose();
  pair.imgFaceMat1.dispose();
  pair.imgFaceMat2.dispose();
  pair.nonFaceMat1.dispose();
  pair.nonFaceMat2.dispose();
  // Remove CSS2DObject labels from the Three.js scene graph
  pair.label1.removeFromParent();
  pair.label2.removeFromParent();
  // Remove the backing DOM elements from the CSS2DRenderer overlay
  pair.labelEl1.remove();
  pair.labelEl2.remove();
}

// ---------------------------------------------------------------------------
// JawObject — 2 leaves (jaws_rect/jaws_asymmetric) or 4 leaves (jaws_square)
// ---------------------------------------------------------------------------

/**
 * 3D representation of a jaw module.
 *
 * jaws_rect / jaws_asymmetric: 2 leaves (pair 1 only).
 * jaws_square: 4 leaves — pair 1 at module rotation, pair 2 at module rotation + 90°.
 * Both pairs share the same leaf1/leaf2 aperture values from the state.
 *
 * Leaf position in state = imaging edge position at the FLD plane.
 * The main group is rotated by (config.rotation_deg + state.rotation_deg + collimator_rotation_deg).
 * Pair 2 (if present) lives in a sub-group rotated an additional 90° around Y.
 */
export class JawObject {
  private readonly group: THREE.Group;
  private readonly modConfig: ModuleConfig;
  private readonly isSquare: boolean;

  // Shared geometry (reused across pairs)
  private readonly bodyGeo: THREE.BoxGeometry;
  private readonly faceGeo: THREE.PlaneGeometry;

  // Pair 1: always present (leaf1 / leaf2)
  private readonly pair1: LeafPairData;

  // Pair 2: only for jaws_square (leaf3 / leaf4), rotated +90° within group
  private readonly pair2Group: THREE.Group | null;
  private readonly pair2: LeafPairData | null;

  constructor(scene: THREE.Scene, modConfig: ModuleConfig) {
    this.modConfig = modConfig;
    this.isSquare = modConfig.type === "jaws_square";
    this.group = new THREE.Group();
    this.group.renderOrder = 1; // render after cone (default 0) to avoid Z-fighting

    // Shared geometry instances
    this.bodyGeo = new THREE.BoxGeometry(BODY_WIDTH, VISUAL_THICKNESS, LEAF_DEPTH);
    this.faceGeo = new THREE.PlaneGeometry(LEAF_DEPTH, VISUAL_THICKNESS);

    // Pair 1 — always present
    this.pair1 = createLeafPair(
      this.group, this.bodyGeo, this.faceGeo,
      modConfig.id, "leaf1", "leaf2", "L1", "L2",
    );

    // Pair 2 — only for jaws_square (rotated 90° around Y)
    if (this.isSquare) {
      this.pair2Group = new THREE.Group();
      this.pair2Group.rotation.y = Math.PI / 2;
      this.group.add(this.pair2Group);
      this.pair2 = createLeafPair(
        this.pair2Group, this.bodyGeo, this.faceGeo,
        modConfig.id, "leaf3", "leaf4", "L3", "L4",
      );
    } else {
      this.pair2Group = null;
      this.pair2 = null;
    }

    scene.add(this.group);
  }

  update(state: CollimatorState, config: CollimatorConfig, moduleId: string): void {
    const modConfig = config.modules.find((m) => m.id === moduleId);
    if (!modConfig) return;
    const modState = state.modules[moduleId];
    if (!modState) return;

    const fld = modState.fld_mm ?? modConfig.fld_mm;
    const l1 = typeof modState["leaf1"] === "number" ? modState["leaf1"] : 0;
    const l2 = typeof modState["leaf2"] === "number" ? modState["leaf2"] : 0;

    // Position pair 1
    positionLeaf(this.pair1.body1, this.pair1.face1, this.pair1.nonFace1, this.pair1.label1, l1, fld, -1);
    positionLeaf(this.pair1.body2, this.pair1.face2, this.pair1.nonFace2, this.pair1.label2, l2, fld, 1);

    // Position pair 2 (same aperture values — local frame, sub-group handles +90°)
    if (this.pair2) {
      positionLeaf(this.pair2.body1, this.pair2.face1, this.pair2.nonFace1, this.pair2.label1, l1, fld, -1);
      positionLeaf(this.pair2.body2, this.pair2.face2, this.pair2.nonFace2, this.pair2.label2, l2, fld, 1);
    }

    // Total rotation around Y (central beam): config base + dynamic + global
    const totalRot =
      (modConfig.rotation_deg ?? 0) + modState.rotation_deg + state.collimator_rotation_deg;
    this.group.rotation.y = THREE.MathUtils.degToRad(totalRot);
  }

  /** Highlight violated leaves in red. Called by SceneUpdater after checkConstraints(). */
  setViolations(leaf1Violated: boolean, leaf2Violated: boolean): void {
    applyPairViolations(this.pair1, leaf1Violated, leaf2Violated, this.modConfig.id);
    if (this.pair2) {
      // Pair 2 shares the same state values → same violation flags
      applyPairViolations(this.pair2, leaf1Violated, leaf2Violated, this.modConfig.id);
    }
  }

  dispose(): void {
    this.bodyGeo.dispose();
    this.faceGeo.dispose();
    disposePair(this.pair1);
    if (this.pair2) disposePair(this.pair2);
    this.group.removeFromParent();
  }
}
