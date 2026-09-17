import type * as Three from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { FormaLocaleController } from "./design-system/localization.ts";
import type { SelectedOutputShareMediaPublicOutput } from "../model/selected-output-share.ts";
import { accessVerifiedSelectedOutputShareMedia, withVerifiedSelectedOutputShareMediaBytes,
  type VerifiedSelectedOutputShareMedia } from "../selected-output-share-media-client.ts";
import { MODEL3D_MIME_TYPE, validateModel3dAsset } from "../model/model3d-assets.ts";
import { MODEL3D_MAX_DISTANCE, MODEL3D_MIN_DISTANCE, model3dPresetView } from "../model/model3d-view.ts";
import "./model3d-viewer.css";

type Locale = Pick<FormaLocaleController, "locale" | "t" | "number" | "system">;
type Output = Extract<SelectedOutputShareMediaPublicOutput, { output: "model3d" }>;
type Options = { locale: Locale; signal: AbortSignal; isCurrent: () => boolean };
export type SelectedOutputShareModel3dView = { refresh(locale: Locale): void; dispose(): void };

/** Owns rendering resources only. The caller owns the verified file, the gesture,
 * its mount lifetime and expiry, and aborts before withdrawing that mount.
 * This leaf cannot fetch a source, capture a view, save, or create context. */
export async function mountSelectedOutputShareModel3d(host: HTMLElement, file: VerifiedSelectedOutputShareMedia,
  output: Output, options: Options): Promise<SelectedOutputShareModel3dView> {
  const document = host.ownerDocument, origin = document.location.origin;
  const unavailable = () => new Error("selected_output_model3d_unavailable");
  if (!host.isConnected || options.signal.aborted || !options.isCurrent()
    || !accessVerifiedSelectedOutputShareMedia(file, output)) throw unavailable();
  let resolveReady!: (view: SelectedOutputShareModel3dView) => void, rejectReady!: (error: Error) => void;
  const mounted = new Promise<SelectedOutputShareModel3dView>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let endLifetime!: () => void;
  const lifetime = new Promise<void>(resolve => { endLifetime = resolve; });
  let locale = options.locale, disposed = false, failed = false, ready = false;
  const root = document.createElement("section"), frame = document.createElement("div");
  const status = document.createElement("p"), group = document.createElement("div"), help = document.createElement("p");
  root.className = "model3d-viewer"; frame.className = "model3d-viewer-frame";
  frame.dataset.background = "#ffffff"; frame.setAttribute("aria-busy", "true");
  status.className = "model3d-viewer-status"; status.setAttribute("role", "status");
  group.className = "model3d-viewer-controls"; group.setAttribute("role", "group");
  help.className = "model3d-viewer-help"; help.id = `selected-model3d-${crypto.randomUUID()}`;
  frame.append(status); root.append(frame, group, help); host.append(root);
  const currentOwner = () => !disposed && !options.signal.aborted && options.isCurrent()
    && host.isConnected && host.ownerDocument === document && root.isConnected && root.parentElement === host;
  const current = () => currentOwner() && !failed;
  const check = () => { if (!current()) throw unavailable(); };
  let three: typeof import("three") | undefined, renderer: Three.WebGLRenderer | undefined;
  let scene: Three.Scene | undefined, camera: Three.PerspectiveCamera | undefined, controls: OrbitControls | undefined;
  let environment: Three.WebGLRenderTarget | undefined, resizeObserver: ResizeObserver | undefined;
  let manager: Three.LoadingManager | undefined, parser: { associations: Map<object, unknown> } | undefined;
  let roots: Three.Object3D[] = [];
  const disposedResources = new Set<unknown>(), loadedResources = new Set<unknown>();
  const objectUrls = new Set<string>(), listeners: Array<() => void> = [];
  const buttons: Array<{ element: HTMLButtonElement; key: string; fallback: string }> = [];
  const listen = (target: EventTarget, name: string, listener: EventListener) => {
    target.addEventListener(name, listener); listeners.push(() => target.removeEventListener(name, listener));
  };
  const disposeResource = (resource: unknown) => {
    if (!resource || typeof resource !== "object") return;
    const value = resource as Record<string, unknown>;
    // A pending parse may attach an image or material after retirement. Revisit
    // children on final settlement, while disposing each resource only once.
    if (value.isTexture) {
      const texture = resource as Three.Texture;
      const images: unknown[] = Array.isArray(texture.source?.data) ? texture.source.data : [texture.source?.data];
      for (const image of images) if (image && typeof image === "object" && !disposedResources.has(image)
        && "close" in image && typeof image.close === "function") { disposedResources.add(image); image.close(); }
    } else if (value.isMaterial) {
      for (const child of Object.values(value)) if (child && typeof child === "object" && "isTexture" in child) disposeResource(child);
    } else if (value.isObject3D) {
      disposeResource(value.geometry);
      if (Array.isArray(value.material)) value.material.forEach(disposeResource); else disposeResource(value.material);
      const skeleton = value.skeleton as Three.Skeleton | undefined;
      if (skeleton && !disposedResources.has(skeleton)) { disposedResources.add(skeleton); skeleton.dispose(); }
    }
    if (disposedResources.has(resource)) return;
    disposedResources.add(resource);
    if (value.isTexture || value.isMaterial || value.isBufferGeometry) (resource as { dispose(): void }).dispose();
  };
  const disposeTree = (resource: unknown) => {
    if (resource && typeof resource === "object" && "isObject3D" in resource && resource.isObject3D)
      (resource as Three.Object3D).traverse(disposeResource);
    else disposeResource(resource);
  };
  const revokeUrls = () => { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); };
  const releaseGraphics = () => {
    resizeObserver?.disconnect(); resizeObserver = undefined;
    controls?.removeEventListener("change", draw); controls?.dispose(); controls = undefined;
    for (const root of roots) root.traverse(disposeResource);
    for (const resource of parser?.associations.keys() ?? []) disposeTree(resource);
    for (const resource of loadedResources) disposeTree(resource);
    roots = [];
    environment?.dispose(); environment = undefined;
    scene?.clear(); scene = undefined;
    renderer?.domElement.remove(); renderer?.dispose(); renderer?.forceContextLoss(); renderer = undefined;
    camera = undefined; revokeUrls();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    rejectReady(unavailable()); endLifetime();
    options.signal.removeEventListener("abort", dispose);
    for (const remove of listeners) remove();
    manager?.abort(); releaseGraphics(); root.remove();
  };
  function draw() {
    if (!current()) { dispose(); return; }
    if (renderer && scene && camera) renderer.render(scene, camera);
  }
  const resize = () => {
    if (!current()) { dispose(); return; }
    renderer?.setSize(Math.min(720, Math.max(1, Math.round(frame.clientWidth || 320))),
      Math.min(720, Math.max(1, Math.round(frame.clientWidth || 320))), false);
    draw();
  };
  const reset = () => {
    if (!current() || !camera || !controls) return;
    const view = model3dPresetView(); camera.position.fromArray(view.position); controls.target.fromArray(view.target);
    camera.fov = view.fov; camera.updateProjectionMatrix(); controls.update(); draw();
  };
  const orbit = (horizontal: number, vertical: number) => {
    if (!current() || !camera || !controls || !three) return;
    const spherical = new three.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    spherical.theta += horizontal * Math.PI / 18; spherical.phi += vertical * Math.PI / 18;
    spherical.makeSafe(); camera.position.setFromSpherical(spherical).add(controls.target); controls.update(); draw();
  };
  const zoom = (factor: number) => {
    if (!current() || !camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(Math.max(MODEL3D_MIN_DISTANCE, Math.min(MODEL3D_MAX_DISTANCE, offset.length() * factor)));
    camera.position.copy(controls.target).add(offset); controls.update(); draw();
  };
  const button = (key: string, fallback: string, action: () => void) => {
    const element = document.createElement("button"); element.type = "button";
    element.className = "button secondary compact"; element.disabled = true;
    listen(element, "click", action); buttons.push({ element, key, fallback }); group.append(element);
  };
  button("model3d.viewer.orbitLeft", "Orbit left", () => orbit(-1, 0));
  button("model3d.viewer.orbitRight", "Orbit right", () => orbit(1, 0));
  button("model3d.viewer.orbitUp", "Orbit up", () => orbit(0, -1));
  button("model3d.viewer.orbitDown", "Orbit down", () => orbit(0, 1));
  button("model3d.viewer.zoomIn", "Zoom in", () => zoom(0.85));
  button("model3d.viewer.zoomOut", "Zoom out", () => zoom(1 / 0.85));
  button("model3d.viewer.reset", "Reset view", reset);
  const refresh = (next: Locale) => {
    if (!currentOwner()) { dispose(); return; }
    locale = next;
    const label = output.title || locale.t("model3d.viewer.label", "3D model view");
    root.setAttribute("aria-label", label);
    renderer?.domElement.setAttribute("aria-label", label);
    group.setAttribute("aria-label", locale.t("model3d.viewer.controls", "Model view controls"));
    for (const { element, key, fallback } of buttons) { element.textContent = locale.t(key, fallback); element.disabled = !ready || failed; }
    help.textContent = locale.t("model3d.viewer.help", "Drag to orbit, scroll to zoom, or use the view buttons. With the model focused, arrow keys orbit, + / − zoom, and Home resets the view.");
    status.textContent = failed ? locale.system("Unavailable") : ready ? "" : locale.t("model3d.viewer.loading", "Loading 3D model…");
    status.hidden = ready && !failed;
  };
  options.signal.addEventListener("abort", dispose, { once: true });
  refresh(locale);
  // Ready and lifetime are separate: Three retains copied BIN/geometry bytes
  // while visible. Keep the borrowed-byte reservation until disposal and true
  // parser settlement, without making the caller wait for closure to get a view.
  const work = withVerifiedSelectedOutputShareMediaBytes(file, output, async bytes => {
      check();
      if (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) throw unavailable();
      validateModel3dAsset(bytes, MODEL3D_MIME_TYPE); check();
      const [runtime, { GLTFLoader }, { OrbitControls: Controls }, { RoomEnvironment }] = await Promise.all([
        import("three"), import("three/addons/loaders/GLTFLoader.js"), import("three/addons/controls/OrbitControls.js"),
        import("three/addons/environments/RoomEnvironment.js"),
      ]);
      check(); three = runtime;
      manager = new runtime.LoadingManager(); let embeddedFailure = false;
      let pendingLoads = 0, drained: (() => void) | undefined;
      const start = manager.itemStart.bind(manager), end = manager.itemEnd.bind(manager);
      manager.itemStart = url => { pendingLoads++; start(url); };
      manager.itemEnd = url => { try { end(url); } finally { if (--pendingLoads === 0) drained?.(); } };
      manager.onError = () => { embeddedFailure = true; };
      manager.setURLModifier(url => {
        // The byte validator rejects input blob/external URIs. These blob URLs
        // can therefore only be created by this parser from embedded images.
        // Do not admit arbitrary same-origin HTTP resources or decoder URLs.
        let parsed: URL;
        try { parsed = new URL(url); } catch { embeddedFailure = true; throw unavailable(); }
        if (parsed.protocol !== "blob:" || parsed.origin !== origin || parsed.search || parsed.hash
          || !url.startsWith(`blob:${origin}/`)) { embeddedFailure = true; throw unavailable(); }
        objectUrls.add(url);
        if (!current()) { URL.revokeObjectURL(url); objectUrls.delete(url); throw unavailable(); }
        return url;
      });
      const loader = new GLTFLoader(manager);
      const dependencies = new Set<Promise<unknown>>();
      const captureResource = (value: unknown) => {
        if (Array.isArray(value)) { value.forEach(captureResource); return; }
        if (value && typeof value === "object") { loadedResources.add(value); if (!current()) disposeTree(value); }
      };
      loader.register(value => {
        parser = value;
        const getDependency = value.getDependency.bind(value);
        value.getDependency = (kind, index) => {
          const pending: Promise<unknown> = Promise.resolve(getDependency(kind, index));
          dependencies.add(pending); void pending.then(captureResource, () => undefined);
          return pending;
        };
        return { name: "FORMA_selected_output_cleanup" };
      });
      try {
        const gltf = await loader.parseAsync(bytes.buffer, ""); roots = gltf.scenes;
        check(); if (embeddedFailure) throw unavailable();
        const model = gltf.scene, bounds = new runtime.Box3().setFromObject(model);
        const extent = bounds.getSize(new runtime.Vector3()), longest = Math.max(extent.x, extent.y, extent.z);
        const center = bounds.getCenter(new runtime.Vector3()); let meshes = 0;
        model.traverse(object => { if ((object as Three.Mesh).isMesh) meshes++; });
        if (!meshes || bounds.isEmpty() || !Number.isFinite(longest) || longest <= 0
          || !center.toArray().every(Number.isFinite)) throw unavailable();
        renderer = new runtime.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: false });
        renderer.outputColorSpace = runtime.SRGBColorSpace; renderer.toneMapping = runtime.ACESFilmicToneMapping;
        renderer.setPixelRatio(Math.min(document.defaultView?.devicePixelRatio || 1, 2)); renderer.setClearColor("#ffffff", 1);
        scene = new runtime.Scene(); const normalized = new runtime.Group(), scale = 2 / longest;
        normalized.scale.setScalar(scale); normalized.position.copy(center).multiplyScalar(-scale); normalized.add(model); scene.add(normalized);
        model.traverse(object => { if ((object as Three.Light).isLight) object.visible = false; });
        const room = new RoomEnvironment(); let pmrem: Three.PMREMGenerator | undefined;
        try { pmrem = new runtime.PMREMGenerator(renderer); environment = pmrem.fromScene(room, 0.04); }
        finally { room.dispose(); pmrem?.dispose(); }
        scene.environment = environment.texture; scene.add(new runtime.HemisphereLight(0xffffff, 0x8a8a8a, 2));
        const key = new runtime.DirectionalLight(0xffffff, 3); key.position.set(3, 5, 4); scene.add(key);
        camera = new runtime.PerspectiveCamera(35, 1, 0.01, 100);
        const canvas = renderer.domElement; canvas.className = "model3d-viewer-canvas"; canvas.tabIndex = 0;
        canvas.setAttribute("role", "img"); canvas.setAttribute("aria-describedby", help.id);
        listen(canvas, "webglcontextlost", event => {
          event.preventDefault(); if (!currentOwner()) { dispose(); return; }
          failed = true; manager?.abort(); releaseGraphics(); endLifetime(); status.setAttribute("role", "alert");
          frame.setAttribute("aria-busy", "false"); refresh(locale);
        });
        listen(canvas, "keydown", event => {
          const key = event as KeyboardEvent;
          if (!current() || key.isComposing || key.altKey || key.metaKey || key.ctrlKey
            || !["+", "=", "-", "_", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (key.key === "Home") reset();
          else if (key.key === "+" || key.key === "=") zoom(0.85);
          else if (key.key === "-" || key.key === "_") zoom(1 / 0.85);
          else orbit(key.key === "ArrowLeft" ? -1 : key.key === "ArrowRight" ? 1 : 0,
            key.key === "ArrowUp" ? -1 : key.key === "ArrowDown" ? 1 : 0);
        });
        controls = new Controls(camera, canvas); controls.enableDamping = false; controls.enablePan = false;
        controls.minDistance = MODEL3D_MIN_DISTANCE; controls.maxDistance = MODEL3D_MAX_DISTANCE;
        controls.addEventListener("change", draw);
        check(); frame.prepend(canvas); resizeObserver = new ResizeObserver(resize); resizeObserver.observe(frame);
        ready = true; frame.setAttribute("aria-busy", "false"); reset(); resize(); refresh(locale);
        check(); resolveReady({ refresh, dispose }); await lifetime;
      } catch (error) {
        failed = true; dispose(); throw error;
      } finally {
        // itemEnd can precede texture/material promise continuations. Observe
        // actual dependencies without starting new loads and drain to a fixed
        // point, including dependencies created by a settling sibling.
        for (;;) {
          const batch = [...dependencies];
          await Promise.allSettled(batch);
          if (pendingLoads > 0) await new Promise<void>(resolve => { drained = resolve; });
          if (batch.length === dependencies.size && pendingLoads === 0) break;
        }
        revokeUrls();
        if (!current()) {
          releaseGraphics(); parser = undefined; manager = undefined;
          loadedResources.clear(); disposedResources.clear(); dependencies.clear();
        }
      }
  });
  void work.catch(() => { dispose(); });
  return mounted;
}
