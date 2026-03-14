import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { CollimatorState } from "../core/state/CollimatorState.js";
import type { CollimatorConfig, ModuleConfig, PrefilterSegment } from "../core/config/types.js";

/** Outer radius of the filter wheel disk (mm). */
const DISK_RADIUS = 150;

/**
 * Pivot offset from the beam axis (mm).
 * The disk center is DISK_OFFSET behind the beam axis (−Z), so the beam
 * passes through the outer rim of the spinning disk — like a real filter wheel.
 * With DISK_RADIUS = 150 and DISK_OFFSET = 120, the beam cuts through the outer
 * 30 mm of each pie-slice segment.
 *
 * The −Z offset aligns CylinderGeometry θ=0 with the beam position in disk-local
 * space, so `normAngle = totalRot % 360` directly maps to the correct segment.
 */
const DISK_OFFSET = 120;

/** Hub cylinder radius at the pivot point (mm). */
const HUB_RADIUS = 14;

/** Beam-axis marker ring radius (mm). Stays fixed; does not rotate with disk. */
const BEAM_RING_R = 20;

/** Radius at which per-segment labels are placed (fraction of disk radius). */
const LABEL_R = DISK_RADIUS * 0.6;

/** Distinct colors per segment index — makes rotation obvious as colors sweep through beam. */
const SEGMENT_PALETTE = [
  0x3b82f6, // blue
  0xf97316, // orange
  0x22c55e, // green
  0xa855f7, // purple
  0xeab308, // yellow
  0xec4899, // pink
  0x06b6d4, // cyan
  0xf43f5e, // rose
];

/** Segment opacities — active segment is brighter, palette color stays fixed. */
const INACTIVE_OPACITY = 0.45;
const ACTIVE_OPACITY   = 0.95;

/** Mechanical rim and hub colors. */
const RIM_COLOR  = 0x667788;
const HUB_COLOR  = 0x445566;

/** Fixed beam-axis marker color: bright cyan. */
const BEAM_COLOR = 0x00e5ff;

/**
 * 3D representation of the pre-filter wheel.
 *
 * Physical layout:
 *   - The disk pivot is offset DISK_OFFSET mm from the beam axis (negative Z).
 *   - As the disk rotates, each pie-slice segment passes through the beam at Z=0.
 *   - The active segment (the one currently at the beam) has higher opacity.
 *
 * Scene graph:
 *   group (beam-axis anchor, never moves laterally)
 *   ├── diskGroup  (offset to −Z, rotates around Y)
 *   │   ├── segmentMesh[0..N]   pie-slice segments
 *   │   ├── segmentLabel[0..N]  CSS2D labels per segment (rotate with disk)
 *   │   ├── rimMesh             thin outer ring (shows wheel shape)
 *   │   └── hubMesh             small pivot cylinder
 *   └── beamMarkerMesh          fixed cyan ring at beam axis (does NOT rotate)
 *
 * Rotation:
 *   diskGroup.rotation.y = -degToRad(totalRot)
 *   (negated so that increasing angle_deg sweeps segments 0→1→2→… through the beam)
 *
 * Active-segment detection:
 *   normAngle = ((totalRot % 360) + 360) % 360
 *   → Segment i is active when normAngle ∈ [from_deg, to_deg).
 *   → Wrap-around segments (from_deg > to_deg, e.g. 350→10) are handled correctly.
 */
export class PrefilterObject {
  private readonly group: THREE.Group;
  private readonly diskGroup: THREE.Group;
  private readonly modConfig: ModuleConfig;
  private readonly segments: PrefilterSegment[];

  private readonly segmentGeos: THREE.CylinderGeometry[] = [];
  private readonly segmentMats: THREE.MeshStandardMaterial[] = [];
  private readonly segmentLabels: CSS2DObject[] = [];
  private readonly segmentLabelEls: HTMLSpanElement[] = [];

  private readonly rimGeo: THREE.TorusGeometry;
  private readonly rimMat: THREE.MeshStandardMaterial;
  private readonly hubGeo: THREE.CylinderGeometry;
  private readonly hubMat: THREE.MeshStandardMaterial;
  private readonly beamGeo: THREE.TorusGeometry;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly beamMarkerMesh: THREE.Mesh;

  constructor(scene: THREE.Scene, modConfig: ModuleConfig) {
    this.modConfig = modConfig;

    const rawSegs = modConfig["segments"];
    this.segments = Array.isArray(rawSegs) ? (rawSegs as PrefilterSegment[]) : [];

    this.group = new THREE.Group();
    this.diskGroup = new THREE.Group();
    // Pivot is offset from beam axis along −Z (beam at Z=0, pivot at Z=−DISK_OFFSET).
    // This aligns CylinderGeometry θ=0 (+Z direction) with the beam position in disk-local space.
    this.diskGroup.position.z = -DISK_OFFSET;
    this.group.add(this.diskGroup);

    const thickness = modConfig.thickness_mm;

    // --- Pie-slice segments + per-segment CSS2D labels ---
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i]!;
      // Handle wrap-around segments: thetaLength must be positive
      const rawLength = seg.to_deg - seg.from_deg;
      const span = rawLength > 0 ? rawLength : rawLength + 360;
      const thetaLength = THREE.MathUtils.degToRad(span);
      const thetaStart  = THREE.MathUtils.degToRad(seg.from_deg);

      const geo = new THREE.CylinderGeometry(
        DISK_RADIUS, DISK_RADIUS, thickness,
        64, 1, false,
        thetaStart, thetaLength,
      );
      const color = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length] ?? 0x4a6fa5;
      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: INACTIVE_OPACITY,
        side: THREE.DoubleSide,
      });
      this.diskGroup.add(new THREE.Mesh(geo, mat));
      this.segmentGeos.push(geo);
      this.segmentMats.push(mat);

      // Per-segment label at the midpoint of the arc, positioned inside the disk
      const midDeg = seg.from_deg + span / 2;
      const midRad = THREE.MathUtils.degToRad(midDeg);
      const labelEl = document.createElement("span");
      labelEl.className = "prefilter-segment-label";
      labelEl.textContent = seg.filter_value;
      const labelObj = new CSS2DObject(labelEl);
      // CylinderGeometry convention: x = r·sin(θ), z = r·cos(θ)
      labelObj.position.set(LABEL_R * Math.sin(midRad), 0, LABEL_R * Math.cos(midRad));
      this.diskGroup.add(labelObj);
      this.segmentLabels.push(labelObj);
      this.segmentLabelEls.push(labelEl);
    }

    // --- Rim ring (thin torus at disk outer edge, rotates with disk) ---
    this.rimGeo = new THREE.TorusGeometry(DISK_RADIUS, 4, 8, 80);
    this.rimMat = new THREE.MeshStandardMaterial({ color: RIM_COLOR, roughness: 0.6, metalness: 0.4 });
    const rimMesh = new THREE.Mesh(this.rimGeo, this.rimMat);
    rimMesh.rotation.x = Math.PI / 2; // lay flat in XZ plane
    this.diskGroup.add(rimMesh);

    // --- Hub cylinder at pivot point (rotates with disk) ---
    this.hubGeo = new THREE.CylinderGeometry(HUB_RADIUS, HUB_RADIUS, thickness + 6, 32);
    this.hubMat = new THREE.MeshStandardMaterial({ color: HUB_COLOR, roughness: 0.5, metalness: 0.6 });
    this.diskGroup.add(new THREE.Mesh(this.hubGeo, this.hubMat));

    // --- Beam-axis marker ring (fixed, does NOT rotate with disk) ---
    this.beamGeo = new THREE.TorusGeometry(BEAM_RING_R, 3, 8, 48);
    this.beamMat = new THREE.MeshBasicMaterial({ color: BEAM_COLOR, transparent: true, opacity: 0.85 });
    this.beamMarkerMesh = new THREE.Mesh(this.beamGeo, this.beamMat);
    this.beamMarkerMesh.rotation.x = Math.PI / 2;
    this.group.add(this.beamMarkerMesh);

    scene.add(this.group);
  }

  update(state: CollimatorState, _config: CollimatorConfig, moduleId: string): void {
    const modState = state.modules[moduleId];
    if (!modState) return;

    const angle = typeof modState["angle_deg"] === "number" ? (modState["angle_deg"] as number) : 0;
    const fld   = modState.fld_mm ?? this.modConfig.fld_mm;

    // Move disk and beam marker to correct Y position along beam axis
    this.diskGroup.position.y      = -fld;
    this.beamMarkerMesh.position.y = -fld;

    // Rotate disk (negated so increasing angle_deg sweeps segments forward through beam)
    const totalRot = angle + modState.rotation_deg + state.collimator_rotation_deg;
    this.diskGroup.rotation.y = -THREE.MathUtils.degToRad(totalRot);

    // Determine active segment (wrap-around aware); -1 means angle is in a gap.
    // With the −Z disk offset and negated rotation, normAngle = totalRot maps
    // directly to CylinderGeometry theta at the beam intersection.
    const normAngle = ((totalRot % 360) + 360) % 360;
    const activeIndex = this.segments.findIndex((s) =>
      s.from_deg < s.to_deg
        ? normAngle >= s.from_deg && normAngle < s.to_deg
        : normAngle >= s.from_deg || normAngle < s.to_deg,
    );

    // Segment colors are fixed (palette) — only opacity changes to indicate active segment.
    // When activeIndex === -1 (gap): all segments stay at inactive opacity.
    for (let i = 0; i < this.segmentMats.length; i++) {
      const mat = this.segmentMats[i]!;
      mat.opacity = i === activeIndex ? ACTIVE_OPACITY : INACTIVE_OPACITY;
    }
  }

  dispose(): void {
    for (const geo of this.segmentGeos) geo.dispose();
    for (const mat of this.segmentMats) mat.dispose();
    this.rimGeo.dispose();
    this.rimMat.dispose();
    this.hubGeo.dispose();
    this.hubMat.dispose();
    this.beamGeo.dispose();
    this.beamMat.dispose();
    // Remove per-segment CSS2DObjects from scene graph and DOM
    for (const lbl of this.segmentLabels) lbl.removeFromParent();
    for (const el of this.segmentLabelEls) el.remove();
    this.group.removeFromParent();
  }
}
