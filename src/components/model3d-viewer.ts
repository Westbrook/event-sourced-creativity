import { html, nothing, type PropertyValues } from "lit";
import type * as Three from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FormaPresentationalElement } from "./presentational-element";
import { MAX_MODEL3D_UPLOAD_BYTES, validateModel3dAsset } from "../model/model3d-assets";
import { isModel3dMediaSource, MODEL3D_CAPTURE_SIZE, MODEL3D_MAX_DISTANCE, MODEL3D_MIN_DISTANCE, model3dPresetView, normalizeModel3dView, type Model3dBackground, type Model3dCaptureDetail, type Model3dView, type Model3dViewPreset } from "../model/model3d-view";
import "./model3d-viewer.css";

export type { Model3dCaptureDetail, Model3dView } from "../model/model3d-view";

type Failure = "source" | "size" | "load" | "webgl" | "missing" | "lost";
class ModelPreviewError extends Error { constructor(readonly kind: Failure) { super(kind); } }
type ThreeModule = typeof import("three");
type PreviewRuntime = {
  three: ThreeModule;
  renderer: Three.WebGLRenderer;
  scene: Three.Scene;
  camera: Three.PerspectiveCamera;
  controls: OrbitControls;
  environment: Three.WebGLRenderTarget;
  roots: Three.Object3D[];
  resources: Iterable<unknown>;
  resize: ResizeObserver;
  source: string;
};

/** Frees resources shared by scenes once, including CPU-side decoded image bitmaps. */
function disposeModelResources(roots: Three.Object3D[], resources: Iterable<unknown> = []) {
  const disposed = new Set<unknown>();
  const dispose = (resource: unknown) => {
    if (!resource || typeof resource !== "object" || disposed.has(resource)) return;
    disposed.add(resource);
    const value = resource as Record<string, unknown>;
    if (value.isTexture) {
      const texture = resource as Three.Texture;
      const images: unknown[] = Array.isArray(texture.source?.data) ? texture.source.data : [texture.source?.data];
      for (const image of images) {
        if (image && typeof image === "object" && !disposed.has(image) && "close" in image && typeof image.close === "function") { disposed.add(image); image.close(); }
      }
      texture.dispose();
    } else if (value.isMaterial) {
      for (const child of Object.values(value)) if (child && typeof child === "object" && "isTexture" in child) dispose(child);
      (resource as Three.Material).dispose();
    } else if (value.isBufferGeometry) (resource as Three.BufferGeometry).dispose();
    else if (value.isObject3D) {
      dispose(value.geometry);
      if (Array.isArray(value.material)) value.material.forEach(dispose); else dispose(value.material);
      const skeleton = value.skeleton as Three.Skeleton | undefined;
      if (skeleton && !disposed.has(skeleton)) { disposed.add(skeleton); skeleton.dispose(); }
    }
  };
  for (const root of roots) root.traverse(dispose);
  for (const resource of resources) dispose(resource);
}

async function readModelBytes(source: string, signal: AbortSignal, expectedSha256 = "") {
  if (typeof expectedSha256 !== "string" || expectedSha256 !== "" && !/^[a-f0-9]{64}$/u.test(expectedSha256)) throw new ModelPreviewError("source");
  const response = await fetch(source, { signal, credentials: "same-origin", redirect: "error", cache: "no-store" });
  if (!response.ok) throw new ModelPreviewError("source");
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_MODEL3D_UPLOAD_BYTES) { await response.body?.cancel(); throw new ModelPreviewError("size"); }
  const reader = response.body?.getReader();
  if (!reader) throw new ModelPreviewError("load");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_MODEL3D_UPLOAD_BYTES) { await reader.cancel(); throw new ModelPreviewError("size"); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  validateModel3dAsset(bytes, response.headers.get("content-type"));
  if (expectedSha256) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== expectedSha256) throw new ModelPreviewError("source");
  }
  return bytes.buffer;
}

/** Local orbit/capture control. Its parent owns media permission and durable saves. */
export class FormaModel3dViewer extends FormaPresentationalElement {
  static properties = { src: { type: String, noAccessor: true }, expectedSha256: { attribute: false, noAccessor: true }, view: { attribute: false }, readonly: { type: Boolean, reflect: true }, disabled: { type: Boolean }, label: { type: String } };
  #src = "";
  #expectedSha256 = "";
  view: Model3dView | null = null;
  readonly = false;
  disabled = false;
  label = "";
  #runtime?: PreviewRuntime;
  #abort?: AbortController;
  #loadId = 0;
  #reconnect = true;
  #loading = false;
  #failure: Failure | null = null;
  #capturing = false;
  #viewRevision = 0;
  #viewSignature = "";
  #captureFailed = false;
  #background: Model3dBackground = "#ffffff";
  #helpId = `model3d-help-${crypto.randomUUID()}`;

  get src() { return this.#src; }
  set src(value: string) {
    if (value === this.#src) return;
    const previous = this.#src; this.#src = value;
    this.#retire(); this.requestUpdate("src", previous);
  }
  get expectedSha256() { return this.#expectedSha256; }
  set expectedSha256(value: string) {
    if (value === this.#expectedSha256) return;
    const previous = this.#expectedSha256; this.#expectedSha256 = value;
    // Retire even A → B → A before Lit's next update; the earlier bytes cannot return.
    this.#retire(); this.requestUpdate("expectedSha256", previous);
  }

  override connectedCallback() { super.connectedCallback(); this.#reconnect = true; this.requestUpdate(); }
  override disconnectedCallback() { this.#retire(); super.disconnectedCallback(); }

  protected override updated(changed: PropertyValues<this>) {
    const incomingView = normalizeModel3dView(this.view) ?? model3dPresetView();
    const signature = JSON.stringify(incomingView);
    const viewChanged = signature !== this.#viewSignature;
    if (viewChanged) { this.#viewSignature = signature; this.#viewRevision += 1; }
    if (changed.has("src") || changed.has("expectedSha256") || this.#reconnect) {
      this.#reconnect = false;
      void this.#load();
    } else if (viewChanged && this.#runtime) this.#applyView(incomingView);
    if (this.#runtime) {
      this.#runtime.controls.enabled = !this.disabled && !this.#capturing;
      this.#runtime.renderer.domElement.setAttribute("aria-label", this.label || this.i18n.t("model3d.viewer.label", "3D model view"));
    }
  }

  #retire() {
    this.#loadId += 1;
    this.#abort?.abort(); this.#abort = undefined;
    const runtime = this.#runtime; this.#runtime = undefined;
    this.#loading = false; this.#capturing = false;
    if (!runtime) return;
    runtime.resize.disconnect();
    runtime.controls.removeEventListener("change", this.#draw);
    runtime.controls.dispose();
    runtime.renderer.domElement.removeEventListener("webglcontextlost", this.#contextLost);
    runtime.renderer.domElement.removeEventListener("keydown", this.#keyDown);
    runtime.renderer.domElement.remove();
    disposeModelResources(runtime.roots, runtime.resources);
    runtime.environment.dispose();
    runtime.scene.clear();
    runtime.renderer.dispose();
    runtime.renderer.forceContextLoss();
  }

  #contextLost = (event: Event) => {
    event.preventDefault();
    this.#retire(); this.#failure = "lost"; this.requestUpdate();
  };

  async #load() {
    this.#retire();
    const source = this.src, expectedSha256 = this.expectedSha256; const loadId = this.#loadId;
    this.#failure = null; this.#captureFailed = false;
    this.#background = (normalizeModel3dView(this.view) ?? model3dPresetView()).background;
    if (!source || !this.isConnected) { this.requestUpdate(); return; }
    if (!isModel3dMediaSource(source)) { this.#failure = "source"; this.requestUpdate(); return; }
    const controller = new AbortController(); this.#abort = controller;
    const current = () => this.isConnected && this.#loadId === loadId && this.src === source && this.expectedSha256 === expectedSha256 && !controller.signal.aborted;
    this.#loading = true; this.requestUpdate();
    let roots: Three.Object3D[] = []; let resources: Iterable<unknown> = [];
    let renderer: Three.WebGLRenderer | undefined; let environment: Three.WebGLRenderTarget | undefined;
    let controls: OrbitControls | undefined; let resize: ResizeObserver | undefined;
    let handedOff = false;
    try {
      const bytes = await readModelBytes(source, controller.signal, expectedSha256);
      if (!current()) return;
      const [three, { GLTFLoader }, { OrbitControls: Controls }, { RoomEnvironment }] = await Promise.all([
        import("three"), import("three/addons/loaders/GLTFLoader.js"), import("three/addons/controls/OrbitControls.js"), import("three/addons/environments/RoomEnvironment.js"),
      ]);
      if (!current()) return;
      const manager = new three.LoadingManager(); let embeddedFailure = false;
      manager.onError = () => { embeddedFailure = true; };
      manager.setURLModifier((url) => {
        // The validator already allows only embedded resources. This guard also
        // covers any URL constructed by a future loader extension.
        if (/^data:(?:image\/(?:png|jpeg|webp)|application\/(?:octet-stream|gltf-buffer));base64,/iu.test(url) || url.startsWith(`blob:${location.origin}/`)) return url;
        embeddedFailure = true; throw new ModelPreviewError("load");
      });
      const loader = new GLTFLoader(manager);
      loader.register((parser) => { resources = parser.associations.keys(); return { name: "FORMA_preview_cleanup" }; });
      const gltf = await loader.parseAsync(bytes, "");
      roots = gltf.scenes;
      if (!current()) return;
      if (embeddedFailure) throw new ModelPreviewError("load");
      const model = gltf.scene;
      const bounds = new three.Box3().setFromObject(model);
      const extent = bounds.getSize(new three.Vector3()); const longest = Math.max(extent.x, extent.y, extent.z);
      const center = bounds.getCenter(new three.Vector3());
      let meshes = 0; model.traverse((object) => { if ((object as Three.Mesh).isMesh) meshes += 1; });
      if (!meshes || bounds.isEmpty() || !Number.isFinite(longest) || longest <= 0 || !center.toArray().every(Number.isFinite)) throw new ModelPreviewError("missing");
      try { renderer = new three.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: false }); }
      catch { throw new ModelPreviewError("webgl"); }
      renderer.outputColorSpace = three.SRGBColorSpace;
      renderer.toneMapping = three.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      const scene = new three.Scene();
      const normalized = new three.Group(); const scale = 2 / longest;
      normalized.scale.setScalar(scale); normalized.position.copy(center).multiplyScalar(-scale); normalized.add(model); scene.add(normalized);
      // Embedded cameras, lights and animation do not alter the saved reference.
      model.traverse((object) => { if ((object as Three.Light).isLight) object.visible = false; });
      const room = new RoomEnvironment(); const pmrem = new three.PMREMGenerator(renderer);
      try { environment = pmrem.fromScene(room, 0.04); } finally { room.dispose(); pmrem.dispose(); }
      scene.environment = environment.texture;
      scene.add(new three.HemisphereLight(0xffffff, 0x8a8a8a, 2));
      const key = new three.DirectionalLight(0xffffff, 3); key.position.set(3, 5, 4); scene.add(key);
      const fill = new three.DirectionalLight(0xffffff, 1.5); fill.position.set(-4, 1, -2); scene.add(fill);
      const camera = new three.PerspectiveCamera(35, 1, 0.01, 100);
      const canvas = renderer.domElement;
      canvas.className = "model3d-viewer-canvas"; canvas.tabIndex = 0;
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", this.label || this.i18n.t("model3d.viewer.label", "3D model view")); canvas.setAttribute("aria-describedby", this.#helpId);
      canvas.addEventListener("webglcontextlost", this.#contextLost);
      canvas.addEventListener("keydown", this.#keyDown);
      controls = new Controls(camera, canvas);
      controls.enableDamping = false; controls.enablePan = false;
      controls.minDistance = MODEL3D_MIN_DISTANCE; controls.maxDistance = MODEL3D_MAX_DISTANCE;
      controls.addEventListener("change", this.#draw);
      resize = new ResizeObserver(() => this.#resize());
      if (!current()) return;
      this.#runtime = { three, renderer, scene, camera, controls, environment, roots, resources, resize, source };
      handedOff = true;
      await this.updateComplete;
      if (!current()) return;
      const frame = this.querySelector<HTMLElement>(".model3d-viewer-frame");
      if (!frame) throw new ModelPreviewError("load");
      frame.prepend(canvas); resize.observe(frame);
      this.#applyView(normalizeModel3dView(this.view) ?? model3dPresetView());
      this.#resize();
    } catch (error) {
      if (current()) {
        this.#failure = error instanceof ModelPreviewError ? error.kind : "load";
        if (this.#runtime) this.#retire();
        this.requestUpdate();
      }
    } finally {
      if (!handedOff) {
        resize?.disconnect(); controls?.dispose();
        disposeModelResources(roots, resources); environment?.dispose();
        if (renderer) { renderer.domElement.removeEventListener("webglcontextlost", this.#contextLost); renderer.domElement.removeEventListener("keydown", this.#keyDown); renderer.domElement.remove(); renderer.dispose(); renderer.forceContextLoss(); }
      }
      if (this.#loadId === loadId) { this.#loading = false; this.requestUpdate(); }
    }
  }

  #draw = () => {
    const runtime = this.#runtime;
    if (runtime && this.isConnected && runtime.source === this.src) runtime.renderer.render(runtime.scene, runtime.camera);
  };

  #resize() {
    const runtime = this.#runtime;
    if (!runtime || this.#capturing) return;
    const frame = this.querySelector<HTMLElement>(".model3d-viewer-frame");
    const size = Math.max(1, Math.round(frame?.clientWidth || 320));
    runtime.renderer.setSize(size, size, false); this.#draw();
  }

  #applyView(view: Model3dView) {
    const runtime = this.#runtime; if (!runtime) return;
    runtime.camera.position.fromArray(view.position); runtime.controls.target.fromArray(view.target);
    runtime.camera.fov = view.fov; runtime.camera.updateProjectionMatrix();
    runtime.controls.update(); this.#background = view.background;
    runtime.renderer.setClearColor(view.background === "transparent" ? "#ffffff" : view.background, view.background === "transparent" ? 0 : 1);
    this.#draw(); this.requestUpdate();
  }

  #snapshot() {
    const runtime = this.#runtime;
    return runtime ? normalizeModel3dView({ version: 1, position: runtime.camera.position.toArray(), target: runtime.controls.target.toArray(), fov: 35, background: this.#background }) : null;
  }

  #preset(preset: Model3dViewPreset) { if (!this.disabled && !this.#capturing) this.#applyView(model3dPresetView(preset, this.#background)); }
  #reset = () => { if (!this.disabled && !this.#capturing) this.#applyView(normalizeModel3dView(this.view) ?? model3dPresetView()); };

  #zoom(factor: number) {
    const runtime = this.#runtime; if (!runtime || this.disabled || this.#capturing) return;
    const offset = runtime.camera.position.clone().sub(runtime.controls.target);
    offset.setLength(Math.max(MODEL3D_MIN_DISTANCE, Math.min(MODEL3D_MAX_DISTANCE, offset.length() * factor)));
    runtime.camera.position.copy(runtime.controls.target).add(offset); runtime.controls.update(); this.#draw();
  }

  #orbit(horizontal: number, vertical: number) {
    const runtime = this.#runtime;
    if (!runtime || this.disabled || this.#capturing) return;
    const spherical = new runtime.three.Spherical().setFromVector3(runtime.camera.position.clone().sub(runtime.controls.target));
    const step = Math.PI / 18;
    spherical.theta += horizontal * step; spherical.phi += vertical * step;
    spherical.makeSafe(); runtime.camera.position.setFromSpherical(spherical).add(runtime.controls.target);
    runtime.controls.update(); this.#draw();
  }

  #keyDown = (event: KeyboardEvent) => {
    const runtime = this.#runtime; if (!runtime || this.disabled || this.#capturing || event.altKey || event.metaKey || event.ctrlKey) return;
    if (["+", "=", "-", "_", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    else return;
    if (event.key === "Home") this.#reset();
    else if (event.key === "+" || event.key === "=") this.#zoom(0.85);
    else if (event.key === "-" || event.key === "_") this.#zoom(1 / 0.85);
    else this.#orbit(event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0,
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0);
  };

  async #capture() {
    const runtime = this.#runtime; const view = this.#snapshot();
    if (!runtime || !view || this.readonly || this.disabled || this.#capturing || runtime.source !== this.src) return;
    const loadId = this.#loadId; const source = this.src; const viewRevision = this.#viewRevision;
    this.#capturing = true; this.#captureFailed = false; runtime.controls.enabled = false; this.requestUpdate();
    const pixelRatio = runtime.renderer.getPixelRatio();
    const size = runtime.renderer.getSize(new runtime.three.Vector2());
    try {
      // Apply the persisted precision before drawing, so a re-open uses the same camera.
      this.#applyView(view); runtime.renderer.setPixelRatio(1); runtime.renderer.setSize(MODEL3D_CAPTURE_SIZE, MODEL3D_CAPTURE_SIZE, false); this.#draw();
      const blob = await new Promise<Blob>((resolve, reject) => runtime.renderer.domElement.toBlob((value) => value ? resolve(value) : reject(new Error("Capture failed")), "image/png"));
      if (this.#loadId !== loadId || this.#runtime !== runtime || this.#viewRevision !== viewRevision || !this.isConnected || this.src !== source || this.readonly || this.disabled) return;
      this.dispatchEvent(new CustomEvent<Model3dCaptureDetail>("model3d-capture", { bubbles: true, composed: true, detail: { blob, view, src: source } }));
    } catch {
      if (this.#loadId === loadId && this.isConnected) this.#captureFailed = true;
    } finally {
      if (this.#runtime === runtime && this.#loadId === loadId) {
        runtime.renderer.setPixelRatio(pixelRatio); runtime.renderer.setSize(size.x, size.y, false);
        this.#capturing = false; runtime.controls.enabled = !this.disabled; this.#resize(); this.requestUpdate();
      }
    }
  }

  #errorText() {
    switch (this.#failure) {
      case "source": return this.i18n.t("model3d.viewer.source", "This model is not available as private Forma media.");
      case "size": return this.i18n.t("model3d.viewer.size", "This model exceeds the {size} MiB preview limit.", { size: this.i18n.number(MAX_MODEL3D_UPLOAD_BYTES / 1024 / 1024) });
      case "webgl": return this.i18n.t("model3d.viewer.webgl", "3D preview is unavailable in this browser. Enable hardware acceleration or use a browser with WebGL 2.");
      case "missing": return this.i18n.t("model3d.viewer.missing", "This model has no visible geometry. Export a GLB containing a mesh.");
      case "lost": return this.i18n.t("model3d.viewer.lost", "The 3D preview was interrupted. Reload it to choose a view.");
      default: return this.i18n.t("model3d.viewer.load", "This model could not be opened. Re-export it as a self-contained, uncompressed GLB with embedded PNG or JPEG textures.");
    }
  }

  override render() {
    const unavailable = !this.#runtime || this.#loading || this.disabled || this.#capturing;
    const presets: [Model3dViewPreset, string][] = [
      ["perspective", this.i18n.t("model3d.viewer.perspective", "Perspective")], ["front", this.i18n.t("model3d.viewer.front", "Front")], ["back", this.i18n.t("model3d.viewer.back", "Back")], ["left", this.i18n.t("model3d.viewer.left", "Left")], ["right", this.i18n.t("model3d.viewer.right", "Right")], ["top", this.i18n.t("model3d.viewer.top", "Top")],
    ];
    return html`<section class="model3d-viewer" aria-label=${this.label || this.i18n.t("model3d.viewer.label", "3D model view")}>
      <div class="model3d-viewer-frame" data-background=${this.#background} aria-busy=${this.#loading ? "true" : "false"}>
        ${this.#loading ? html`<p class="model3d-viewer-status" role="status">${this.i18n.t("model3d.viewer.loading", "Loading 3D model…")}</p>` : this.#failure ? html`<div class="model3d-viewer-status" role="alert"><span>${this.#errorText()}</span><button type="button" class="button secondary" ?disabled=${this.disabled} @click=${() => void this.#load()}>${this.i18n.t("model3d.viewer.reload", "Reload preview")}</button></div>` : !this.src ? html`<p class="model3d-viewer-status">${this.i18n.t("model3d.viewer.empty", "Add a GLB model to choose its reference view.")}</p>` : nothing}
      </div>
      <div class="model3d-viewer-controls" role="group" aria-label=${this.i18n.t("model3d.viewer.controls", "Model view controls")}>
        ${presets.map(([preset, title]) => html`<button type="button" class="button secondary compact" ?disabled=${unavailable} @click=${() => this.#preset(preset)}>${title}</button>`)}
        <button type="button" class="button secondary compact" ?disabled=${unavailable} @click=${() => this.#orbit(-1, 0)}>${this.i18n.t("model3d.viewer.orbitLeft", "Orbit left")}</button>
        <button type="button" class="button secondary compact" ?disabled=${unavailable} @click=${() => this.#orbit(1, 0)}>${this.i18n.t("model3d.viewer.orbitRight", "Orbit right")}</button>
        <button type="button" class="button secondary compact" ?disabled=${unavailable} @click=${() => this.#orbit(0, -1)}>${this.i18n.t("model3d.viewer.orbitUp", "Orbit up")}</button>
        <button type="button" class="button secondary compact" ?disabled=${unavailable} @click=${() => this.#orbit(0, 1)}>${this.i18n.t("model3d.viewer.orbitDown", "Orbit down")}</button>
        <button type="button" class="button secondary compact" ?disabled=${unavailable} aria-label=${this.i18n.t("model3d.viewer.zoomIn", "Zoom in")} @click=${() => this.#zoom(0.85)}>+</button>
        <button type="button" class="button secondary compact" ?disabled=${unavailable} aria-label=${this.i18n.t("model3d.viewer.zoomOut", "Zoom out")} @click=${() => this.#zoom(1 / 0.85)}>−</button>
        <button type="button" class="button secondary compact" ?disabled=${unavailable} @click=${this.#reset}>${this.i18n.t("model3d.viewer.reset", "Reset view")}</button>
      </div>
      <p class="model3d-viewer-help" id=${this.#helpId}>${this.i18n.t("model3d.viewer.help", "Drag to orbit, scroll to zoom, or use the view buttons. With the model focused, arrow keys orbit, + / − zoom, and Home resets the view.")}</p>
      ${this.readonly ? nothing : html`<div class="model3d-viewer-actions"><label class="model3d-viewer-background"><span>${this.i18n.t("model3d.viewer.background", "Reference background")}</span><select .value=${this.#background} ?disabled=${unavailable} @change=${(event: Event) => { const view = this.#snapshot(); if (view) this.#applyView({ ...view, background: (event.currentTarget as HTMLSelectElement).value as Model3dBackground }); }}><option value="#ffffff">${this.i18n.t("model3d.viewer.white", "White")}</option><option value="#18181b">${this.i18n.t("model3d.viewer.dark", "Dark")}</option><option value="transparent">${this.i18n.t("model3d.viewer.transparent", "Transparent")}</option></select></label><button type="button" class="button primary" ?disabled=${unavailable} @click=${() => void this.#capture()}>${this.#capturing ? this.i18n.t("model3d.viewer.capturing", "Capturing view…") : this.disabled ? this.i18n.t("model3d.viewer.saving", "Saving view…") : this.i18n.t("model3d.viewer.use", "Use this view")}</button></div><p class="model3d-viewer-help">${this.i18n.t("model3d.viewer.saveHelp", "Models use their initial pose. Using this view saves a square image and camera settings. Image and video generations use the saved image.")}</p>`}
      ${this.#captureFailed ? html`<p class="model3d-viewer-error" role="alert">${this.i18n.t("model3d.viewer.captureError", "The reference image could not be captured. Reload the preview and try again.")}</p>` : nothing}
    </section>`;
  }
}

if (!customElements.get("forma-model3d-viewer")) customElements.define("forma-model3d-viewer", FormaModel3dViewer);
declare global { interface HTMLElementTagNameMap { "forma-model3d-viewer": FormaModel3dViewer } }
