import { html, noChange, nothing, type PropertyValues } from "lit";
import {
  REFERENCE_COMPOSITION_MAX_LAYERS, REFERENCE_COMPOSITION_MAX_SOURCE_BYTES,
  addReferenceCompositionLayer, createReferenceComposition, moveReferenceCompositionLayer,
  normalizeReferenceComposition, normalizeReferenceCompositionSource, referenceCompositionLayerRect,
  referenceCompositionMediaUrl, referenceCompositionSize, referenceCompositionSourcesFingerprint,
  removeReferenceCompositionLayer, updateReferenceCompositionLayer, updateReferenceCompositionSource, validateReferenceComposition,
  type ReferenceCompositionAspect, type ReferenceCompositionBackground, type ReferenceCompositionLayer,
  type ReferenceCompositionRecipe, type ReferenceCompositionSource,
} from "../model/reference-composition.ts";
import { FormaPresentationalElement } from "./presentational-element.ts";
import { icon } from "./icons.ts";
import { ensureModalDialog } from "./modal-dialog.ts";
import "./reference-compositor.css";

export type ReferenceCompositionCapture = { blob: Blob; recipe: ReferenceCompositionRecipe; label: string };
type CompositionFailure = "unavailable" | "hashMismatch" | "unsupported";
type LayerNumberKey = "x" | "y" | "scale" | "opacity";
type LayerNumberDraft = { value: string; valid: boolean };
class CompositionImageError extends Error { constructor(readonly reason: CompositionFailure) { super(reason); } }

async function imageBytes(source: ReferenceCompositionSource, signal: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const url = referenceCompositionMediaUrl(source.mediaUrl);
  if (!url) throw new CompositionImageError("unavailable");
  const response = await fetch(url, { credentials: "same-origin", redirect: "error", cache: "no-store", signal });
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"].includes(mime)
    || Number(response.headers.get("content-length")) > REFERENCE_COMPOSITION_MAX_SOURCE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new CompositionImageError("unavailable");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > REFERENCE_COMPOSITION_MAX_SOURCE_BYTES || signal.aborted) {
        await reader.cancel();
        throw new CompositionImageError("unavailable");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  if (!length) throw new CompositionImageError("unavailable");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  const actualHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  if (actualHash !== source.contentHash) throw new CompositionImageError("hashMismatch");
  return { bytes, mime };
}

async function compositionPng(recipe: ReferenceCompositionRecipe, owner: Document, signal: AbortSignal, current: () => boolean): Promise<Blob> {
  const assertCurrent = () => { if (signal.aborted || !current()) throw new DOMException("Composition retired", "AbortError"); };
  if (typeof createImageBitmap !== "function" || !crypto.subtle) throw new CompositionImageError("unsupported");
  assertCurrent();
  const canvas = owner.createElement("canvas");
  canvas.width = recipe.width; canvas.height = recipe.height;
  const context = canvas.getContext("2d");
  if (!context) throw new CompositionImageError("unsupported");
  try {
    if (recipe.background !== "transparent") { context.fillStyle = recipe.background; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    // Decode one bitmap at a time and close it after painting, bounding retained browser memory.
    for (const layer of recipe.layers) {
      if (!layer.opacity) continue;
      assertCurrent();
      const source = recipe.sources.find(candidate => candidate.id === layer.sourceId);
      if (!source) throw new CompositionImageError("unavailable");
      const { bytes, mime } = await imageBytes(source, signal);
      assertCurrent();
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: "from-image" });
      try {
        assertCurrent();
        if (bitmap.width > 32768 || bitmap.height > 32768 || bitmap.width * bitmap.height > 64_000_000) throw new CompositionImageError("unavailable");
        const rect = referenceCompositionLayerRect(recipe, layer, bitmap.width, bitmap.height);
        if (!rect) throw new CompositionImageError("unavailable");
        context.globalAlpha = layer.opacity / 100;
        context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
      } finally { bitmap.close(); }
    }
    assertCurrent();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new CompositionImageError("unsupported")), "image/png"));
    assertCurrent();
    return blob;
  } finally { canvas.width = 0; canvas.height = 0; }
}

export class ReferenceCompositor extends FormaPresentationalElement {
  static properties = { sources: { attribute: false }, recipe: { attribute: false }, label: { type: String }, usageHint: { attribute: false }, disabled: { type: Boolean } };
  sources: readonly ReferenceCompositionSource[] = [];
  recipe: ReferenceCompositionRecipe | null = null;
  label = "";
  usageHint = "";
  disabled = false;
  #draft = createReferenceComposition();
  #selected = "";
  #name: string | null = null;
  #busy = false;
  #closed = false;
  #invalidRecipe = false;
  #failure: CompositionFailure | "sourceChanged" | "sourceLocked" | "noPixels" | "invalid" | "invalidNumbers" | "" = "";
  #revision = 0;
  #controller?: AbortController;
  #sourceFingerprint = "";
  #dimensions = new Map<string, { width: number; height: number }>();
  #numberDrafts = new Map<string, Partial<Record<LayerNumberKey, LayerNumberDraft>>>();
  #prefix = `reference-composition-${crypto.randomUUID()}`;

  #available() {
    const normalized = this.sources.map(normalizeReferenceCompositionSource).filter((source): source is ReferenceCompositionSource => Boolean(source));
    const counts = new Map<string, number>();
    for (const source of normalized) counts.set(source.id, (counts.get(source.id) ?? 0) + 1);
    return normalized.filter(source => counts.get(source.id) === 1);
  }

  #retire() { this.#controller?.abort(); this.#controller = undefined; this.#revision += 1; this.#busy = false; }
  override disconnectedCallback() { this.#closed = true; this.#retire(); super.disconnectedCallback(); }
  protected override willUpdate(changed: PropertyValues) {
    const fingerprint = referenceCompositionSourcesFingerprint(this.#available());
    if (fingerprint !== this.#sourceFingerprint) { this.#sourceFingerprint = fingerprint; this.#retire(); }
    if (changed.has("recipe")) {
      this.#retire();
      const recipe = this.recipe === null ? createReferenceComposition() : normalizeReferenceComposition(this.recipe);
      this.#invalidRecipe = !recipe;
      this.#draft = recipe ?? createReferenceComposition();
      this.#numberDrafts.clear();
      this.#selected = this.#draft.layers.at(-1)?.id ?? "";
      this.#failure = "";
    }
    if (changed.has("label")) this.#name = null;
    if (changed.has("disabled") && this.disabled) this.#retire();
  }
  protected override updated() { if (!this.#closed) ensureModalDialog(this.querySelector<HTMLDialogElement>(".reference-compositor")); }

  closeForOwner() {
    if (this.#closed) return;
    this.#closed = true; this.#retire();
    const dialog = this.querySelector<HTMLDialogElement>(".reference-compositor"), active = this.ownerDocument.activeElement;
    // Let native close return to the opener only while this dialog still owns
    // focus. The parent removes a retired owner without taking newer focus.
    if (dialog?.open && (dialog.contains(active) || active === this.ownerDocument.body || active === this.ownerDocument.documentElement)) dialog.close();
  }

  #close() {
    if (this.#closed) return;
    if (this.disabled) { this.requestUpdate(); return; }
    this.closeForOwner();
    this.dispatchEvent(new Event("composition-close", { bubbles: true, composed: true }));
  }

  #edit(recipe: ReferenceCompositionRecipe) {
    if (this.disabled || this.#busy) return;
    const layerIds = new Set(recipe.layers.map(layer => layer.id));
    for (const id of this.#numberDrafts.keys()) if (!layerIds.has(id)) this.#numberDrafts.delete(id);
    this.#draft = recipe; this.#invalidRecipe = false; this.#failure = ""; this.#revision += 1; this.requestUpdate();
  }
  #add(source: ReferenceCompositionSource) {
    this.#flushNumbers();
    const id = crypto.randomUUID();
    this.#edit(addReferenceCompositionLayer(this.#draft, source, id));
    if (this.#draft.layers.some(layer => layer.id === id)) this.#selected = id;
  }
  #needsSourceUpdate(source: ReferenceCompositionSource) {
    const retained = this.#draft.sources.find(candidate => candidate.id === source.id && candidate.blockId === source.blockId && candidate.kind === source.kind);
    return Boolean(retained && (retained.mediaUrl !== source.mediaUrl || retained.contentHash !== source.contentHash));
  }
  async #focusAfterEdit(event: Event, selector: string) {
    const trigger = event.currentTarget as HTMLButtonElement | null;
    if (!trigger || this.ownerDocument.activeElement !== trigger) return;
    const revision = this.#revision;
    await this.updateComplete;
    const active = this.ownerDocument.activeElement;
    if (!this.isConnected || this.#closed || this.disabled || this.#busy || this.#revision !== revision
      || active !== trigger && active !== this.ownerDocument.body && active !== this.ownerDocument.documentElement) return;
    if (trigger.isConnected && !trigger.matches(":disabled")) return;
    (this.querySelector<HTMLButtonElement>(selector)
      ?? this.querySelector<HTMLButtonElement>(".modal-close:not(:disabled)"))?.focus();
  }
  #move(id: string, direction: 1 | -1, event: Event) {
    this.#edit(moveReferenceCompositionLayer(this.#draft, id, direction));
    void this.#focusAfterEdit(event, `.reference-compositor-layer-actions [data-layer-action="${direction === 1 ? "backward" : "forward"}"]:not(:disabled)`);
  }
  #remove(id: string, event: Event) {
    this.#flushNumbers();
    this.#edit(removeReferenceCompositionLayer(this.#draft, id));
    if (this.#selected === id) this.#selected = this.#draft.layers.at(-1)?.id ?? "";
    void this.#focusAfterEdit(event, ".reference-compositor-source-list button:not(:disabled)");
  }
  #source(layer: ReferenceCompositionLayer, available: readonly ReferenceCompositionSource[]) {
    const retained = this.#draft.sources.find(source => source.id === layer.sourceId);
    return retained ? available.find(source => source.id === retained.id && source.blockId === retained.blockId
      && source.mediaUrl === retained.mediaUrl && source.contentHash === retained.contentHash && source.kind === retained.kind) : undefined;
  }
  #loaded(event: Event, source: ReferenceCompositionSource) {
    const element = event.currentTarget as HTMLImageElement;
    if (element.naturalWidth && element.naturalHeight && !this.#dimensions.has(source.contentHash)) {
      this.#dimensions.set(source.contentHash, { width: element.naturalWidth, height: element.naturalHeight }); this.requestUpdate();
    }
  }
  #layerStyle(layer: ReferenceCompositionLayer, source: ReferenceCompositionSource) {
    const dimensions = this.#dimensions.get(source.contentHash);
    const rect = referenceCompositionLayerRect(this.#draft, layer, dimensions?.width ?? this.#draft.width, dimensions?.height ?? this.#draft.height)!;
    return `left:${rect.x / this.#draft.width * 100}%;top:${rect.y / this.#draft.height * 100}%;width:${rect.width / this.#draft.width * 100}%;height:${rect.height / this.#draft.height * 100}%;opacity:${layer.opacity / 100};`;
  }
  #invalidNumbers(id?: string) {
    return [...this.#numberDrafts].some(([layerId, values]) => (!id || id === layerId) && Object.values(values).some(value => value?.valid === false));
  }
  #number(layer: ReferenceCompositionLayer, key: LayerNumberKey, field: HTMLInputElement) {
    if (this.disabled || this.#busy) return;
    const value = field.value, valid = Boolean(value.trim()) && field.validity.valid && Number.isFinite(field.valueAsNumber);
    const values = this.#numberDrafts.get(layer.id) ?? {};
    this.#numberDrafts.set(layer.id, { ...values, [key]: { value, valid } });
    this.#edit(valid ? updateReferenceCompositionLayer(this.#draft, layer.id, { [key]: field.valueAsNumber }) : this.#draft);
  }
  #numberValue(layer: ReferenceCompositionLayer, key: LayerNumberKey) {
    const field = this.ownerDocument.activeElement;
    // Native number inputs retain incomplete text internally; writing .value would discard it.
    if (field instanceof HTMLInputElement && this.contains(field) && field.dataset.layerId === layer.id && field.dataset.layerKey === key) return noChange;
    return this.#numberDrafts.get(layer.id)?.[key]?.value ?? String(layer[key]);
  }
  #flushNumbers() {
    for (const field of this.querySelectorAll<HTMLInputElement>(".reference-compositor-numbers input")) {
      const layer = this.#draft.layers.find(candidate => candidate.id === field.dataset.layerId), key = field.dataset.layerKey;
      if (layer && ["x", "y", "scale", "opacity"].includes(key ?? "")) this.#number(layer, key as LayerNumberKey, field);
    }
  }
  #selectLayer(id: string) {
    if (this.disabled || this.#busy) return;
    this.#flushNumbers(); this.#selected = id; this.requestUpdate();
  }

  async #capture() {
    if (this.disabled || this.#busy || this.#closed) return;
    this.#flushNumbers();
    if (this.#invalidNumbers()) { this.#failure = "invalidNumbers"; this.requestUpdate(); return; }
    const recipe = normalizeReferenceComposition(this.#draft), available = this.#available();
    const issue = validateReferenceComposition(recipe, available);
    if (!recipe || issue) { this.#failure = issue === "empty" ? "noPixels" : issue === "invalid" ? "invalid" : issue === "source-locked" ? "sourceLocked" : "sourceChanged"; this.requestUpdate(); return; }
    const revision = ++this.#revision, fingerprint = referenceCompositionSourcesFingerprint(available);
    const controller = new AbortController(); this.#controller = controller;
    const current = () => this.isConnected && !this.#closed && !this.disabled && this.#revision === revision
      && referenceCompositionSourcesFingerprint(this.#available()) === fingerprint;
    this.#busy = true; this.#failure = ""; this.requestUpdate();
    const label = (this.#name ?? this.label).trim().slice(0, 120) || this.i18n.t("composition.defaultName");
    try {
      const blob = await compositionPng(recipe, this.ownerDocument, controller.signal, current);
      if (current()) this.dispatchEvent(new CustomEvent<ReferenceCompositionCapture>("composition-capture", { bubbles: true, composed: true, detail: { blob, recipe, label } }));
    } catch (error) {
      if (current() && !controller.signal.aborted) this.#failure = error instanceof CompositionImageError ? error.reason : "unavailable";
    } finally {
      if (this.#revision === revision) { this.#busy = false; this.#controller = undefined; this.requestUpdate(); }
    }
  }

  #controls(layer: ReferenceCompositionLayer) {
    return html`<div class="reference-compositor-numbers">${(["x", "y", "scale", "opacity"] as const).map(key => html`<label><span>${this.i18n.t(`composition.${key}`)}</span><input type="number" required min=${key === "scale" ? 5 : 0} max=${key === "scale" ? 200 : 100} step="1" data-layer-id=${layer.id} data-layer-key=${key} aria-invalid=${this.#numberDrafts.get(layer.id)?.[key]?.valid === false} .value=${this.#numberValue(layer, key)} @input=${(event: Event) => this.#number(layer, key, event.currentTarget as HTMLInputElement)} @change=${(event: Event) => this.#number(layer, key, event.currentTarget as HTMLInputElement)}></label>`)}</div>`;
  }

  override render() {
    const sources = this.#available(), draft = this.#draft, blocked = this.disabled || this.#busy;
    const selected = draft.layers.find(layer => layer.id === this.#selected);
    const issue = validateReferenceComposition(draft, sources);
    const status = this.#failure || (this.#invalidNumbers() ? "invalidNumbers" : this.#invalidRecipe ? "invalid" : issue === "source-locked" ? "sourceLocked" : issue === "source-changed" || issue === "source-unavailable" ? "sourceChanged" : "");
    return html`<dialog class="modal reference-compositor" closedby=${this.disabled ? "none" : "any"} aria-modal="true" aria-labelledby=${`${this.#prefix}-title`}
      @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#close(); }}
      @cancel=${(event: Event) => { event.preventDefault(); this.#close(); }} @close=${() => this.#close()}>
      <div class="modal-card wide reference-compositor-card">
        <button type="button" class="icon-button modal-close" aria-label=${this.i18n.t("action.close")} ?disabled=${this.disabled} @click=${() => this.#close()}>${icon("close")}</button>
        <h2 id=${`${this.#prefix}-title`}>${this.i18n.t("composition.title")}</h2><p>${this.i18n.t("composition.description")}</p>
        <fieldset class="reference-compositor-settings" ?disabled=${blocked}>
          <label class="reference-compositor-name"><span>${this.i18n.t("composition.label")}</span><input type="text" maxlength="120" .value=${this.#name ?? this.label} placeholder=${this.i18n.t("composition.defaultName")} @input=${(event: Event) => { this.#name = (event.currentTarget as HTMLInputElement).value; }}></label>
          <label><span>${this.i18n.t("composition.aspect")}</span><select .value=${draft.aspect} @change=${(event: Event) => { const aspect = (event.currentTarget as HTMLSelectElement).value as ReferenceCompositionAspect; this.#edit({ ...draft, aspect, ...referenceCompositionSize(aspect) }); }}>
            <option value="1:1" ?selected=${draft.aspect === "1:1"}>${this.i18n.t("composition.square")}</option><option value="16:9" ?selected=${draft.aspect === "16:9"}>${this.i18n.t("composition.landscape")}</option><option value="9:16" ?selected=${draft.aspect === "9:16"}>${this.i18n.t("composition.portrait")}</option>
          </select></label>
          <label><span>${this.i18n.t("composition.background")}</span><select .value=${draft.background} @change=${(event: Event) => this.#edit({ ...draft, background: (event.currentTarget as HTMLSelectElement).value as ReferenceCompositionBackground })}>
            <option value="#ffffff" ?selected=${draft.background === "#ffffff"}>${this.i18n.t("composition.white")}</option><option value="#171717" ?selected=${draft.background === "#171717"}>${this.i18n.t("composition.dark")}</option><option value="transparent" ?selected=${draft.background === "transparent"}>${this.i18n.t("composition.transparent")}</option>
          </select></label>
        </fieldset>
        <section class="reference-compositor-sources" aria-labelledby=${`${this.#prefix}-sources`}><h3 id=${`${this.#prefix}-sources`}>${this.i18n.t("composition.sources")}</h3>
          ${sources.length ? html`<div class="reference-compositor-source-list">${sources.map(source => { const refresh = this.#needsSourceUpdate(source); return html`<button type="button" ?disabled=${blocked || !refresh && draft.layers.length >= REFERENCE_COMPOSITION_MAX_LAYERS} aria-label=${this.i18n.t(refresh ? "composition.updateSource" : "composition.add", "", { label: source.label })} @click=${() => refresh ? this.#edit(updateReferenceCompositionSource(draft, source)) : this.#add(source)}><img src=${source.mediaUrl} alt="" loading="lazy" decoding="async" @load=${(event: Event) => this.#loaded(event, source)}><span><b dir="auto">${source.label}</b><small>${this.i18n.t(refresh ? "composition.updateSourceAction" : source.kind === "model-view" ? "composition.modelView" : "composition.image")}</small></span><span aria-hidden="true">${refresh ? "↻" : "+"}</span></button>`; })}</div>` : html`<p>${this.i18n.t("composition.empty")}</p>`}
        </section>
        <div class="reference-compositor-workarea">
          <div class="reference-compositor-preview"><div class="reference-compositor-stage" role="group" aria-label=${this.i18n.t("composition.canvas")} aria-describedby=${`${this.#prefix}-hint`} style=${`aspect-ratio:${draft.width}/${draft.height};--composition-ratio:${draft.width / draft.height};--composition-background:${draft.background};`}>
            ${draft.layers.map((layer, index) => { const source = this.#source(layer, sources); return source ? html`<button type="button" class=${`reference-compositor-layer ${layer.id === this.#selected ? "is-selected" : ""}`} style=${this.#layerStyle(layer, source)} aria-label=${this.i18n.t("composition.layer", "", { number: this.i18n.number(index + 1), label: source.label })} aria-pressed=${layer.id === this.#selected} ?disabled=${blocked} @click=${() => this.#selectLayer(layer.id)}><img src=${source.mediaUrl} alt="" decoding="async" @load=${(event: Event) => this.#loaded(event, source)}></button>` : nothing; })}
            ${!draft.layers.length ? html`<p class="reference-compositor-empty">${this.i18n.t("composition.layerEmpty")}</p>` : nothing}
          </div><small id=${`${this.#prefix}-hint`}>${this.i18n.t("composition.previewHint")}</small></div>
          <fieldset class="reference-compositor-inspector" ?disabled=${blocked}><legend>${this.i18n.t("composition.layers")}</legend>
            ${draft.layers.length ? html`<ol class="reference-compositor-layer-list">${[...draft.layers].reverse().map(layer => { const source = this.#source(layer, sources), retained = draft.sources.find(candidate => candidate.id === layer.sourceId); return html`<li><button type="button" class=${layer.id === this.#selected ? "is-selected" : ""} aria-pressed=${layer.id === this.#selected} @click=${() => this.#selectLayer(layer.id)}>${source ? html`<img src=${source.mediaUrl} alt="" loading="lazy" decoding="async">` : html`<span class="reference-compositor-missing" aria-hidden="true">${icon("image")}</span>`}<span dir="auto">${retained?.label ?? ""}${this.#invalidNumbers(layer.id) ? html`<small class="reference-compositor-invalid">${this.i18n.t("composition.checkNumbers")}</small>` : nothing}</span></button></li>`; })}</ol>` : html`<p>${this.i18n.t("composition.layerEmpty")}</p>`}
            ${selected ? html`${this.#controls(selected)}<div class="reference-compositor-layer-actions"><button type="button" class="button ghost compact" data-layer-action="forward" ?disabled=${draft.layers.at(-1)?.id === selected.id} @click=${(event: Event) => this.#move(selected.id, 1, event)}>${this.i18n.t("composition.forward")}</button><button type="button" class="button ghost compact" data-layer-action="backward" ?disabled=${draft.layers[0]?.id === selected.id} @click=${(event: Event) => this.#move(selected.id, -1, event)}>${this.i18n.t("composition.backward")}</button><button type="button" class="button ghost compact" data-layer-action="remove" @click=${(event: Event) => this.#remove(selected.id, event)}>${this.i18n.t("composition.remove")}</button></div>` : nothing}
            <small>${this.i18n.t("composition.limit", "", { count: this.i18n.number(REFERENCE_COMPOSITION_MAX_LAYERS) })}</small>
          </fieldset>
        </div>
        <p class="reference-compositor-notice" role="status" aria-live="polite">${status ? this.i18n.t(`composition.${status}`) : this.#busy ? this.i18n.t("composition.preparing") : this.usageHint || this.i18n.t("composition.usageHint")}</p>
        <footer><small>${this.i18n.t("composition.dimensions", "", { width: this.i18n.number(draft.width), height: this.i18n.number(draft.height) })}</small><div><button type="button" class="button ghost" ?disabled=${this.disabled} @click=${() => this.#close()}>${this.i18n.t("action.cancel")}</button><button type="button" class="button primary" ?disabled=${blocked || Boolean(issue) || this.#invalidNumbers()} @click=${() => void this.#capture()}>${this.#busy ? this.i18n.t("composition.preparing") : this.i18n.t("composition.use")}</button></div></footer>
      </div>
    </dialog>`;
  }
}

if (!customElements.get("forma-reference-compositor")) customElements.define("forma-reference-compositor", ReferenceCompositor);
declare global { interface HTMLElementTagNameMap { "forma-reference-compositor": ReferenceCompositor } }
