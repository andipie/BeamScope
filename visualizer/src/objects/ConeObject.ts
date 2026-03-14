import * as THREE from "three";
import type { CollimatorState } from "../core/state/CollimatorState.js";
import type { CollimatorConfig } from "../core/config/types.js";
import { computeFieldPolygon } from "../core/geometry/fieldPolygon.js";

/** Maximum polygon vertices for the base (pre-allocated buffer). */
const MAX_BASE_VERTS = 20;
/** Total vertices: 1 apex + MAX_BASE_VERTS base vertices. */
const MAX_VERTS = 1 + MAX_BASE_VERTS;
/** Max triangles: MAX_BASE_VERTS side tris + (MAX_BASE_VERTS-2) base fan tris. */
const MAX_TRIS = MAX_BASE_VERTS + (MAX_BASE_VERTS - 2);

/**
 * 3D representation of the beam cone (pyramid from focal spot to detector).
 *
 * - Apex at Y=0 (focal spot / source)
 * - Base at Y=-SID (detector plane), shaped by the field polygon
 * - Semi-transparent so modules remain visible behind the cone
 * - Global collimator rotation applied to the whole group
 * - Central beam axis rendered as a white line
 */
export class ConeObject {
  private readonly group: THREE.Group;

  // Cone mesh
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly positions: Float32Array;
  private readonly indices: Uint16Array;

  // Central beam line
  private readonly lineGeo: THREE.BufferGeometry;
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly linePts: Float32Array;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // Pre-allocate buffers for dynamic polygon base
    this.positions = new Float32Array(MAX_VERTS * 3);
    this.indices = new Uint16Array(MAX_TRIS * 3);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geo.setIndex(new THREE.BufferAttribute(this.indices, 1));

    this.mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geo, this.mat);
    this.group.add(mesh);

    // Central beam line (apex to detector)
    this.linePts = new Float32Array([0, 0, 0, 0, -1000, 0]);
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute("position", new THREE.BufferAttribute(this.linePts, 3));
    this.lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
    });
    this.group.add(new THREE.LineSegments(this.lineGeo, this.lineMat));

    scene.add(this.group);
  }

  update(state: CollimatorState, config: CollimatorConfig): void {
    const sid = state.sid;
    const poly = computeFieldPolygon(state, config);
    const n = Math.min(poly.length, MAX_BASE_VERTS);

    if (n < 3) {
      this.geo.setDrawRange(0, 0);
      this.linePts[4] = -sid;
      const lineAttr = this.lineGeo.attributes["position"];
      if (lineAttr) lineAttr.needsUpdate = true;
      this.group.rotation.y = THREE.MathUtils.degToRad(state.collimator_rotation_deg);
      return;
    }

    // Vertex 0 = apex at origin
    this.positions[0] = 0;
    this.positions[1] = 0;
    this.positions[2] = 0;

    // Vertices 1..n = polygon base at Y = -SID
    for (let i = 0; i < n; i++) {
      const off = (1 + i) * 3;
      this.positions[off] = poly[i]!.x;
      this.positions[off + 1] = -sid;
      this.positions[off + 2] = poly[i]!.z;
    }

    // Build index buffer: side triangles + base fan
    let idx = 0;

    // Side triangles: (apex=0, base[i], base[i+1])
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      this.indices[idx++] = 0;
      this.indices[idx++] = 1 + i;
      this.indices[idx++] = 1 + next;
    }

    // Base fan: (base[0], base[i], base[i+1]) for i in 1..n-2
    for (let i = 1; i < n - 1; i++) {
      this.indices[idx++] = 1;
      this.indices[idx++] = 1 + i;
      this.indices[idx++] = 1 + i + 1;
    }

    const posAttr = this.geo.attributes["position"];
    if (posAttr) posAttr.needsUpdate = true;
    const idxAttr = this.geo.index;
    if (idxAttr) idxAttr.needsUpdate = true;
    this.geo.setDrawRange(0, idx);
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();

    // Update central beam line endpoint
    this.linePts[4] = -sid;
    const lineAttr = this.lineGeo.attributes["position"];
    if (lineAttr) lineAttr.needsUpdate = true;

    // Apply global collimator rotation around Y axis
    this.group.rotation.y = THREE.MathUtils.degToRad(state.collimator_rotation_deg);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.lineGeo.dispose();
    this.lineMat.dispose();
    this.group.removeFromParent();
  }
}
