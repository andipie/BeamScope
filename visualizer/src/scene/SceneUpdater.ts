import type * as THREE from "three";
import type { CollimatorState } from "../core/state/CollimatorState.js";
import type { CollimatorConfig } from "../core/config/types.js";
import type { ConstraintViolation } from "../core/constraints/ConstraintChecker.js";
import { JawObject } from "../objects/JawObject.js";
import { WedgeObject } from "../objects/WedgeObject.js";
import { PrefilterObject } from "../objects/PrefilterObject.js";
import { ConeObject } from "../objects/ConeObject.js";
import { DetectorObject } from "../objects/DetectorObject.js";
import { PrimaryCollimatorObject } from "../objects/PrimaryCollimatorObject.js";
import { FocalSpotObject } from "../objects/FocalSpotObject.js";

type ModuleObject = JawObject | WedgeObject | PrefilterObject;

/**
 * Bridges the StateStore and the 3D scene.
 *
 * - On config load: creates / recreates all scene objects
 * - On state update: calls update() on each object
 * - On config change: disposes old objects, creates new ones
 */
export class SceneUpdater {
  private readonly scene: THREE.Scene;
  private moduleObjects = new Map<string, ModuleObject>();
  private coneObject: ConeObject | null = null;
  private detectorObject: DetectorObject | null = null;
  private primaryCollimatorObject: PrimaryCollimatorObject | null = null;
  private focalSpotObject: FocalSpotObject | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Call when a new config is loaded. Recreates all scene objects. */
  onConfigLoaded(config: CollimatorConfig): void {
    this.disposeAll();

    // Global objects
    this.coneObject = new ConeObject(this.scene);
    this.detectorObject = new DetectorObject(this.scene);
    this.primaryCollimatorObject = new PrimaryCollimatorObject(this.scene);
    this.focalSpotObject = new FocalSpotObject(this.scene);

    // Per-module objects
    for (const modConfig of config.modules) {
      let obj: ModuleObject;
      switch (modConfig.type) {
        case "jaws_rect":
        case "jaws_square":
        case "jaws_asymmetric":
          obj = new JawObject(this.scene, modConfig);
          break;
        case "wedge":
          obj = new WedgeObject(this.scene, modConfig);
          break;
        case "prefilter":
          obj = new PrefilterObject(this.scene, modConfig);
          break;
      }
      this.moduleObjects.set(modConfig.id, obj);
    }
  }

  /** Call on every state update (from StateStore subscription). */
  onStateUpdate(state: CollimatorState, config: CollimatorConfig): void {
    this.coneObject?.update(state, config);
    this.detectorObject?.update(state, config);
    this.primaryCollimatorObject?.update(state, config);
    this.focalSpotObject?.update(state);

    for (const [moduleId, obj] of this.moduleObjects) {
      obj.update(state, config, moduleId);
    }
  }

  /** Apply constraint violations to 3D scene objects (red leaf coloring). */
  applyViolations(violations: ConstraintViolation[]): void {
    // Reset all jaw objects to default color
    for (const obj of this.moduleObjects.values()) {
      if (obj instanceof JawObject) {
        obj.setViolations(false, false);
      }
    }

    // Build per-module violation flags
    const flags = new Map<string, { leaf1: boolean; leaf2: boolean }>();
    for (const v of violations) {
      let entry = flags.get(v.moduleId);
      if (!entry) {
        entry = { leaf1: false, leaf2: false };
        flags.set(v.moduleId, entry);
      }
      if (v.leaf === "leaf1") entry.leaf1 = true;
      else if (v.leaf === "leaf2") entry.leaf2 = true;
      else {
        // leaf_crossing: both leaves violated
        entry.leaf1 = true;
        entry.leaf2 = true;
      }
    }

    // Dispatch to JawObjects
    for (const [moduleId, f] of flags) {
      const obj = this.moduleObjects.get(moduleId);
      if (obj instanceof JawObject) {
        obj.setViolations(f.leaf1, f.leaf2);
      }
    }
  }

  private disposeAll(): void {
    for (const obj of this.moduleObjects.values()) {
      obj.dispose();
    }
    this.moduleObjects.clear();
    this.coneObject?.dispose();
    this.coneObject = null;
    this.detectorObject?.dispose();
    this.detectorObject = null;
    this.primaryCollimatorObject?.dispose();
    this.primaryCollimatorObject = null;
    this.focalSpotObject?.dispose();
    this.focalSpotObject = null;
  }
}
