import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { NativeRetainedOutputDto } from "../model/native-retained-output.ts";
import "./model3d-viewer";
import "./model3d-generation.css";
import "./native-retained-model3d.css";
import { FormaPresentationalElement } from "./presentational-element";
import type { FormaLocaleController } from "./design-system/localization.ts";

type Model3dResult = Extract<NativeRetainedOutputDto, { output: "model3d" }>;
type Model3dLocale = Pick<FormaLocaleController, "t" | "number" | "system">;
type Inspection = {
  result: Model3dResult; origin: HTMLButtonElement; document: Document;
  scroll: Array<{ element: Element; top: number; left: number }>;
  window: { view: Window; x: number; y: number } | null;
};

// The host owns current source authority and retires this leaf on withdrawal.
// Only a deliberate inspection mounts a GLB viewer; the inline result never
// captures a scrolling finger or starts a second job.
export class NativeRetainedModel3d extends FormaPresentationalElement {
  static properties = { result: { attribute: false, noAccessor: true }, locale: { attribute: false } };
  locale: Model3dLocale | null = null;
  #result: Model3dResult | null = null;
  #inspection: Inspection | null = null;
  #dialogId = `retained-model3d-${crypto.randomUUID()}`;

  get result() { return this.#result; }
  set result(value: Model3dResult | null) {
    if (value === this.#result) return;
    const previous = this.#result;
    this.#endInspection(false);
    this.#result = value;
    this.requestUpdate("result", previous);
  }

  override disconnectedCallback() {
    this.#endInspection(false);
    super.disconnectedCallback();
  }

  #current(inspection: Inspection) {
    return this.#inspection === inspection && this.isConnected && this.result === inspection.result
      && this.ownerDocument === inspection.document && Date.parse(inspection.result.expiresAt) > Date.now()
      && inspection.origin.isConnected && this.contains(inspection.origin);
  }

  async #inspect(result: Model3dResult, event: Event) {
    const origin = event.currentTarget as HTMLButtonElement | null;
    if (!this.isConnected || this.result !== result || this.#inspection || !origin?.isConnected
      || !this.contains(origin) || !(Date.parse(result.expiresAt) > Date.now())) return;
    const document = this.ownerDocument, view = document.defaultView;
    const scroll: Inspection["scroll"] = [];
    for (let element: Element | null = origin.parentElement; element; element = element.parentElement)
      scroll.push({ element, top: element.scrollTop, left: element.scrollLeft });
    const inspection: Inspection = { result, origin, document, scroll,
      window: view ? { view, x: view.scrollX, y: view.scrollY } : null };
    this.#inspection = inspection; this.requestUpdate();
    try {
      await this.updateComplete;
      if (!this.#current(inspection)) return;
      const dialog = this.querySelector<HTMLDialogElement>("dialog");
      if (!dialog) throw Error("Model inspection unavailable");
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    } catch {
      if (this.#inspection === inspection) this.#endInspection(true);
    }
  }

  #endInspection(restore: boolean, inspection = this.#inspection) {
    if (!inspection || this.#inspection !== inspection) return;
    const current = this.#current(inspection), dialog = this.querySelector<HTMLDialogElement>("dialog");
    const focused = inspection.document.activeElement;
    const ownsFocus = focused === inspection.origin || focused === dialog || Boolean(dialog?.contains(focused));
    this.#inspection = null;
    // Dispose GPU resources synchronously, before a later Lit update or close event.
    for (const viewer of this.querySelectorAll("forma-model3d-viewer")) viewer.remove();
    if (restore && current && ownsFocus) {
      if (dialog?.open) dialog.close();
      inspection.origin.focus({ preventScroll: true });
      for (const { element, top, left } of inspection.scroll) {
        if (element.isConnected) { element.scrollTop = top; element.scrollLeft = left; }
      }
      if (inspection.window) inspection.window.view.scrollTo({ left: inspection.window.x, top: inspection.window.y, behavior: "instant" });
    } else {
      // Removal ends the modal without returning focus to a retired source.
      dialog?.remove();
    }
    this.requestUpdate();
  }

  override render() {
    const result = this.result;
    if (!result) return nothing;
    const locale = this.locale ?? this.i18n, files = result.content.files;
    const preview = files.find(file => file.role === "mesh" && file.format === "glb"
      && file.mimeType === "model/gltf-binary" && file.previewSupported !== false);
    const inspection = this.#inspection;
    return keyed(result, html`<article class="retained-story-reader native-retained-model3d-reader" aria-label=${locale.t("model3d.label", "3D model")}>
      ${result.title.trim() ? html`<h2 class="retained-story-title" dir="auto" translate="no">${result.title}</h2>` : nothing}
      ${preview ? html`<button type="button" class="button secondary native-retained-model3d-open" aria-haspopup="dialog"
        aria-controls=${this.#dialogId} @click=${(event: Event) => this.#inspect(result, event)}>${locale.t("model3d.viewer.open", "View model")}</button>` : nothing}
      ${inspection ? keyed(inspection, html`<dialog id=${this.#dialogId} class="native-retained-model3d-dialog" aria-label=${locale.t("model3d.viewer.preview", "Model preview")}
        @cancel=${(event: Event) => { event.preventDefault(); this.#endInspection(true, inspection); }} @close=${() => this.#endInspection(true, inspection)}>
        <header><h2>${locale.t("model3d.viewer.preview", "Model preview")}</h2><button type="button" class="button secondary"
          @click=${() => this.#endInspection(true, inspection)}>${locale.system("Close")}</button></header>
        <div class="native-retained-model3d-inspection">${preview && this.#inspection?.result === result
          ? html`<forma-model3d-viewer .src=${preview.url} .expectedSha256=${preview.sha256} .readonly=${true}></forma-model3d-viewer>` : nothing}</div>
      </dialog>`) : nothing}
      <section class="model3d-output-files" aria-label=${locale.t("model3d.output.files", "Returned model files and textures")}>
        <h3>${locale.t("model3d.output.files", "Returned model files and textures")}</h3>
        ${files.length ? html`<ul>${files.map(file => html`<li><div><bdi translate="no">${file.fileName}</bdi><small>
          ${file.role === "mesh" ? locale.t("model3d.output.mesh", "Mesh") : file.role === "texture"
            ? locale.t("model3d.output.texture", "Texture") : locale.t("model3d.output.preview", "Preview")}
          ${file.format ? html` · <bdi translate="no">${file.format.toUpperCase()}</bdi>` : nothing} · ${locale.number(file.fileSize)} B
        </small></div></li>`)}</ul>` : html`<p role="status">${locale.system("Unavailable")}</p>`}
      </section>
    </article>`);
  }
}

if (!customElements.get("forma-native-retained-model3d")) customElements.define("forma-native-retained-model3d", NativeRetainedModel3d);
declare global { interface HTMLElementTagNameMap { "forma-native-retained-model3d": NativeRetainedModel3d } }
export function renderNativeRetainedModel3d(result: Model3dResult, locale: Model3dLocale) {
  return html`<forma-native-retained-model3d .result=${result} .locale=${locale}></forma-native-retained-model3d>`;
}
