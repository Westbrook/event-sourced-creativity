import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Independent content renderer. It has no dependency on Forma's UI components. */
export class StillModelView extends HTMLElement {
  static observedAttributes = ['src'];
  private clean = () => {};
  private generation = 0;
  connectedCallback() { void this.load(); }
  attributeChangedCallback() { if (this.isConnected) void this.load(); }
  disconnectedCallback() { ++this.generation; this.clean(); }
  async load() {
    this.clean(); const generation = ++this.generation;
    this.replaceChildren();
    const source = this.getAttribute('src') ?? '';
    if (!source.startsWith('/api/media/')) { this.textContent = 'Download available.'; return; }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, .01, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0);
    renderer.domElement.setAttribute('aria-label', '3D model. Drag to rotate, scroll to zoom.');
    renderer.domElement.setAttribute('role', 'img');
    this.append(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xaaa397, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    let model: THREE.Object3D | undefined; let frame = 0;
    const resize = new ResizeObserver(() => { const w = this.clientWidth, h = this.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); }); resize.observe(this);
    const render = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render); };
    const disposeModel = (object: THREE.Object3D) => object.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); for (const material of Array.isArray(child.material) ? child.material : [child.material]) { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); } } });
    this.clean = () => { cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); if (model) disposeModel(model); renderer.dispose(); renderer.forceContextLoss(); };
    try {
      const loaded = await new GLTFLoader().loadAsync(source);
      if (generation !== this.generation || !this.isConnected) { disposeModel(loaded.scene); return; }
      model = loaded.scene; const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      model.position.sub(center); scene.add(model);
      const extent = Math.max(size.x, size.y, size.z, .1); camera.position.set(extent * 1.5, extent * .7, extent * 2); controls.target.set(0, 0, 0); controls.update(); render();
    } catch { if (generation === this.generation) { this.clean(); this.textContent = 'Preview unavailable. Download the original model.'; } }
  }
}
if (!customElements.get('still-model-view')) customElements.define('still-model-view', StillModelView);
