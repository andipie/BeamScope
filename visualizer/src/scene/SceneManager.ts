import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

/**
 * Manages the Three.js scene, camera, renderers, and animation loop.
 *
 * Responsibilities:
 * - WebGLRenderer + CSS2DRenderer (for billboard labels)
 * - PerspectiveCamera with OrbitControls
 * - Default lighting
 * - Animation loop (calls SceneUpdater on each frame if needed)
 * - "Reset View" functionality
 *
 * TODO: implement full setup and render loop
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly controls: OrbitControls;

  // Default camera position: oblique view from above-side, source at top, detector at bottom
  private static readonly DEFAULT_CAMERA_POSITION = new THREE.Vector3(400, 600, 800);

  constructor(canvas: HTMLCanvasElement, labelContainer: HTMLElement) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f0f0f);

    // Camera
    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 10000);
    this.camera.position.copy(SceneManager.DEFAULT_CAMERA_POSITION);
    this.camera.lookAt(0, -500, 0);

    // WebGL renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    // CSS2D renderer (billboard labels)
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.labelRenderer.domElement.style.position = "absolute";
    this.labelRenderer.domElement.style.top = "0";
    this.labelRenderer.domElement.style.pointerEvents = "none";
    this.labelRenderer.domElement.classList.add("three-css2d-renderer");
    labelContainer.appendChild(this.labelRenderer.domElement);

    // Orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, -500, 0);
    this.controls.update();

    // Lighting
    this.addLights();

    // Coordinate axes gizmo at focal spot (Y=0)
    this.setupGizmo();

    // Handle resize
    window.addEventListener("resize", () => this.onResize());
  }

  private addLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(500, 800, 500);
    this.scene.add(dir);
  }

  /**
   * Adds a small coordinate axes indicator (AxesHelper) at the scene origin (Y=0,
   * focal spot) with CSS2D labels so the user can always identify the axis directions.
   * X = red, Y = green (beam axis, +Y away from detector), Z = blue.
   */
  private setupGizmo(): void {
    const axes = new THREE.AxesHelper(200);
    this.scene.add(axes);

    const labelDefs: [string, THREE.Vector3][] = [
      ["X", new THREE.Vector3(230, 0, 0)],
      ["Y", new THREE.Vector3(0, 230, 0)],
      ["Z", new THREE.Vector3(0, 0, 230)],
    ];
    for (const [text, pos] of labelDefs) {
      const div = document.createElement("div");
      div.textContent = text;
      div.style.cssText =
        "color:#fff;font:bold 11px system-ui,sans-serif;pointer-events:none;opacity:0.75;";
      const label = new CSS2DObject(div);
      label.position.copy(pos);
      this.scene.add(label);
    }
  }

  private onResize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
  }

  /** Reset camera to default position and look-at. */
  resetView(): void {
    this.camera.position.copy(SceneManager.DEFAULT_CAMERA_POSITION);
    this.controls.target.set(0, -500, 0);
    this.controls.update();
  }

  /** Render one frame. Call inside requestAnimationFrame loop. */
  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /** Start the render loop. */
  startLoop(): void {
    const tick = (): void => {
      requestAnimationFrame(tick);
      this.render();
    };
    tick();
  }
}
