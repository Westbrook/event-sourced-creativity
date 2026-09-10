import { html, nothing, type PropertyValues } from "lit";
import { FormaElement, icon } from "./forma-element.ts";
import { ensureModalDialog } from "./modal-dialog.ts";
import { ReferenceCompositor, type ReferenceCompositionCapture } from "./reference-compositor.ts";
import { generatedImageEditCopy } from "./design-system/locales/generated-image-edit-messages.ts";
import { GENERATED_IMAGE_EDIT_LIMITS, prepareGeneratedImageEdit, type PreparedGeneratedImageEdit } from "../model/generated-image-edit.ts";
import type { CurrentGeneratedImageEdit } from "../model/generated-image-edit-current.ts";
import { generatedImageOwnedMediaUrl, generatedImageEditOperationSha256, parseGeneratedImageEditRequest, parseGeneratedImageRevision,
  type GeneratedImageEditSnapshot, type GeneratedImageEditRequest, type GeneratedImageEditAcknowledgment } from "../model/generated-image-revision.ts";
import { outputAssetSha256 } from "../model/output-asset-inspection.ts";
import { addReferenceCompositionLayer, createReferenceComposition, normalizeReferenceComposition,
  type ReferenceCompositionRecipe } from "../model/reference-composition.ts";
import "./generated-image-editor.css";

/** The owning card supplies authenticated personal-output ports. This object is
 * one opening, never a substitute for Store authorization or a saved receipt. */
export type GeneratedImageEditorOpening = Readonly<{
  token: object; ownerId: string; projectId: string; documentId: string; outputId: string;
  current(): boolean;
  read(): Promise<GeneratedImageEditSnapshot | null>;
  capture(sourceId: string): Promise<CurrentGeneratedImageEdit | null>;
  adopt(): Promise<boolean>;
  save(request: GeneratedImageEditRequest, privatePNG: Uint8Array): Promise<GeneratedImageEditAcknowledgment>;
  check(operationSHA: string): Promise<GeneratedImageEditAcknowledgment>;
}>;
type Phase = "closed" | "loading" | "adoption" | "adopting" | "editing" | "preparing" | "preview" | "saving" | "checking" | "unconfirmed" | "saved" | "unchanged" | "error";
type Failure = "unavailable" | "invalid" | "source_changed" | "forbidden";
type Lease = Readonly<{ opening: GeneratedImageEditorOpening; ports: GeneratedImageEditorOpening; token: object; epoch: number }>;
const arrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const arrayLength = Object.getOwnPropertyDescriptor(arrayPrototype, "byteLength")!.get!;
const arrayBuffer = Object.getOwnPropertyDescriptor(arrayPrototype, "buffer")!.get!;
const blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, "size")!.get!;
const blobType = Object.getOwnPropertyDescriptor(Blob.prototype, "type")!.get!;
function privateBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
  const length = arrayLength.call(value);
  if (!(arrayBuffer.call(value) instanceof ArrayBuffer) || !Number.isSafeInteger(length) || length < 1 || length > GENERATED_IMAGE_EDIT_LIMITS.pngBytes) return null;
  const result = new Uint8Array(length); Uint8Array.prototype.set.call(result, value); return result;
}

// A stalled read loses the deadline race even if a browser/stream ignores abort.
// Cancellation is observed separately; no successful-cancellation claim is made
// when its own one-second bound expires. All collected chunks are private copies.
async function cancelRead(stream: ReadableStreamDefaultReader<Uint8Array> | ReadableStream<Uint8Array> | null): Promise<boolean> {
  if (!stream) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(stream.cancel()).then(() => true, () => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000); })]);
  } catch { return false; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
async function sourcePng(url: string, controller: AbortController, current: () => boolean): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array<ArrayBuffer>[] = []; let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let response: Response | null = null, length = 0, complete = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = () => new DOMException("Image source read retired", "AbortError");
  let rejectAbort: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(fail());
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail()); }, 15_000); });
  const bounded = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted, deadline]);
  const assertCurrent = () => { if (controller.signal.aborted || !current()) { controller.abort(); throw fail(); } };
  try {
    assertCurrent();
    const fetching = fetch(url, { credentials: "same-origin", redirect: "error", cache: "no-store", signal: controller.signal });
    void fetching.then(value => { if (controller.signal.aborted) return cancelRead(value.body); return undefined; }, () => undefined);
    response = await bounded(fetching); assertCurrent();
    const size = response.headers.get("content-length"), mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!response.ok || mime !== "image/png" || !response.body || size !== null && (!/^\d+$/u.test(size) || Number(size) > GENERATED_IMAGE_EDIT_LIMITS.pngBytes)) throw new Error("image_source_unavailable");
    reader = response.body.getReader();
    while (true) {
      const chunk = await bounded(reader.read()); assertCurrent();
      if (chunk.done) break;
      if (arrayLength.call(chunk.value) === 0) continue;
      const copy = privateBytes(chunk.value);
      if (!copy || length + copy.byteLength > GENERATED_IMAGE_EDIT_LIMITS.pngBytes) { copy?.fill(0); throw new Error("image_source_size"); }
      chunks.push(copy); length += copy.byteLength;
    }
    if (!length || size !== null && Number(size) !== length) throw new Error("image_source_size");
    assertCurrent();
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    complete = true; return bytes;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
    if (!complete) { controller.abort(); void cancelRead(reader ?? response?.body ?? null); }
    if (reader) { try { reader.releaseLock(); } catch { /* A pending native read may already have released its lock. */ } }
    for (const chunk of chunks) chunk.fill(0);
  }
}

async function capturedPng(blob: Blob, controller: AbortController, current: () => boolean): Promise<Uint8Array<ArrayBuffer>> {
  let abandoned = false, timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { abandoned = true; rejectAbort(new Error("image_capture_retired")); };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const reading = Blob.prototype.arrayBuffer.call(blob).then((buffer: ArrayBuffer) => {
    const view = new Uint8Array(buffer);
    try {
      if (abandoned || controller.signal.aborted || !current()) throw new Error("image_capture_retired");
      const copy = privateBytes(view); if (!copy) throw new Error("image_capture_size"); return copy;
    } finally { view.fill(0); }
  });
  try {
    return await Promise.race([reading, aborted, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { abandoned = true; controller.abort(); reject(new Error("image_capture_deadline")); }, 15_000);
    })]);
  } finally { abandoned = true; controller.signal.removeEventListener("abort", onAbort); if (timer !== undefined) clearTimeout(timer); }
}

export class GeneratedImageEditor extends FormaElement {
  static properties = { opening: { attribute: false } };
  opening: GeneratedImageEditorOpening | null = null;
  #lease: Lease | null = null;
  #epoch = 0;
  #phase: Phase = "closed";
  #failure: Failure = "unavailable";
  #snapshot: GeneratedImageEditSnapshot | null = null;
  #captured: CurrentGeneratedImageEdit | null = null;
  #recipe: ReferenceCompositionRecipe | null = null;
  #prepared: PreparedGeneratedImageEdit | null = null;
  #original: Uint8Array<ArrayBuffer> | null = null;
  #upload: Uint8Array<ArrayBuffer> | null = null;
  #previewUrl = "";
  #previewReady = false;
  #controller: AbortController | null = null;
  #pending: Readonly<{ request: GeneratedImageEditRequest; operationSha256: string }> | null = null;
  #busy = false;
  #prefix = "generated-image-editor-" + crypto.randomUUID();

  #current(lease: Lease | null = this.#lease): lease is Lease {
    try { return Boolean(lease && this.isConnected && this.#lease === lease && this.#epoch === lease.epoch
      && this.opening === lease.opening && this.opening.token === lease.token
      && (["ownerId", "projectId", "documentId", "outputId", "current", "read", "capture", "adopt", "save", "check"] as const)
        .every(key => lease.opening[key] === lease.ports[key]) && lease.ports.current()); } catch { return false; }
  }
  #editingCurrent(lease: Lease | null = this.#lease): boolean {
    try { return this.#current(lease) && Boolean(this.#captured?.current()); } catch { return false; }
  }
  #clearPrivate() {
    this.#controller?.abort(); this.#controller = null;
    this.#original?.fill(0); this.#original = null;
    this.#prepared?.dispose(); this.#prepared = null;
    if (this.#previewUrl) URL.revokeObjectURL(this.#previewUrl);
    this.#previewUrl = ""; this.#previewReady = false; this.#snapshot = null; this.#captured = null; this.#recipe = null;
  }
  #retire(notify = true) {
    const opening = this.#lease?.opening;
    this.#epoch++; this.#clearPrivate(); this.#upload?.fill(0); this.#upload = null;
    this.#pending = null; this.#busy = false; this.#phase = "closed"; this.#lease = null;
    this.requestUpdate();
    if (notify && opening) this.dispatchEvent(new CustomEvent("generated-image-editor-close", { bubbles: true, composed: true, detail: { opening, reason: "retired" } }));
  }
  override disconnectedCallback() {
    this.removeEventListener("click", this.#compositorCloseIntent, true);
    this.removeEventListener("cancel", this.#compositorCloseIntent, true);
    this.#retire(false); super.disconnectedCallback();
  }
  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener("click", this.#compositorCloseIntent, true);
    this.addEventListener("cancel", this.#compositorCloseIntent, true);
  }
  protected override willUpdate(changed: PropertyValues) {
    if (changed.has("opening")) {
      this.#retire(false);
      if (this.opening) {
        const lease = Object.freeze({ opening: this.opening, ports: Object.freeze({ ...this.opening }), token: this.opening.token, epoch: this.#epoch }); this.#lease = lease;
        if (this.#current(lease)) { this.#phase = "loading"; void this.#load(lease); } else this.#retire();
      }
    } else if (this.#lease && (!this.#current() || this.#captured && !["saving", "checking"].includes(this.#phase) && !this.#editingCurrent())) this.#retire();
  }
  protected override updated() {
    if (this.#current() && this.#phase !== "closed") ensureModalDialog(this.querySelector<HTMLDialogElement>(".generated-image-editor-dialog"));
  }
  #sameSnapshot(snapshot: GeneratedImageEditSnapshot, captured: CurrentGeneratedImageEdit) {
    const basis = captured.basis, opening = this.#lease?.ports;
    return snapshot.status === "current" && opening && snapshot.ownerId === opening.ownerId && snapshot.projectId === opening.projectId
      && snapshot.documentId === opening.documentId && snapshot.outputId === opening.outputId && basis.kind === "generated-image"
      && snapshot.ownerId === basis.ownerId && snapshot.documentId === basis.documentId && snapshot.outputId === basis.outputId
      && snapshot.generationId === basis.generationId && snapshot.sourceEventId === basis.sourceEventId && snapshot.contentRef === basis.contentRef
      && snapshot.contentSha256 === basis.contentSha256 && snapshot.rawJson === basis.rawJson && snapshot.revision === basis.revision
      && snapshot.editEventId === captured.editEventId
      && (snapshot.revision === 0 ? snapshot.editEventId === null : typeof snapshot.editEventId === "string" && Boolean(snapshot.editEventId))
      && snapshot.media.url === basis.media.url && snapshot.media.mediaType === basis.media.mediaType && snapshot.media.sha256 === basis.media.sha256
      && snapshot.media.width === basis.media.width && snapshot.media.height === basis.media.height
      && generatedImageOwnedMediaUrl(basis.media.url, opening.ownerId);
  }
  async #load(lease: Lease) {
    try {
      const read = await lease.ports.read(); if (!this.#current(lease)) return;
      const snapshot = read ? structuredClone(read) : null;
      if (!snapshot || snapshot.status !== "current" || snapshot.ownerId !== lease.opening.ownerId || snapshot.projectId !== lease.opening.projectId
        || snapshot.documentId !== lease.opening.documentId || snapshot.outputId !== lease.opening.outputId) { this.#retire(); return; }
      this.#snapshot = snapshot;
      const sourceId = snapshot.sourceIds.find(id => snapshot.sources.some(source => source.id === id && source.kind === "image" && !source.requiresUnlock
        && source.mediaUrl === snapshot.media.url && source.contentHash === snapshot.media.sha256));
      if (!sourceId) { this.#phase = "adoption"; this.requestUpdate(); return; }
      const captured = await lease.ports.capture(sourceId); if (!this.#current(lease)) return;
      if (!captured || captured.sourceId !== sourceId || !captured.current() || !this.#sameSnapshot(snapshot, captured)) { this.#retire(); return; }
      const source = captured.sources.find(value => value.id === sourceId && value.kind === "image" && !value.requiresUnlock);
      if (!source) { this.#retire(); return; }
      this.#captured = captured; this.#recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, crypto.randomUUID());
      this.#phase = "editing"; this.requestUpdate();
    } catch { if (this.#current(lease)) { this.#failure = "unavailable"; this.#phase = "error"; this.requestUpdate(); } }
  }
  async #adopt() {
    const lease = this.#lease; if (!this.#current(lease) || this.#phase !== "adoption") return;
    this.#phase = "adopting"; this.requestUpdate();
    try {
      const adopted = await lease.ports.adopt(); if (!this.#current(lease)) return;
      if (!adopted) { this.#failure = "unavailable"; this.#phase = "error"; this.requestUpdate(); return; }
      this.#phase = "loading"; await this.#load(lease);
    } catch { if (this.#current(lease)) { this.#failure = "unavailable"; this.#phase = "error"; this.requestUpdate(); } }
  }
  async #capture(event: CustomEvent<ReferenceCompositionCapture>) {
    const compositor = this.querySelector("forma-reference-compositor"), lease = this.#lease, captured = this.#captured;
    if (!(compositor instanceof ReferenceCompositor) || event.target !== compositor || !this.#current(lease) || !captured || this.#phase !== "editing" || !this.#editingCurrent()) return;
    event.stopPropagation();
    const recipe = normalizeReferenceComposition(event.detail?.recipe), blob = event.detail?.blob;
    if (!recipe || !recipe.sources.some(source => source.id === captured.sourceId) || !(blob instanceof Blob) || Object.getPrototypeOf(blob) !== Blob.prototype
      || blobType.call(blob) !== "image/png" || blobSize.call(blob) < 1 || blobSize.call(blob) > GENERATED_IMAGE_EDIT_LIMITS.pngBytes) {
      this.#failure = "invalid"; this.#phase = "error"; this.requestUpdate(); return;
    }
    const ids = new Set(recipe.sources.map(source => source.id)); this.#recipe = recipe;
    const current = () => {
      if (!this.#editingCurrent(lease)) return null;
      const value = captured.current(); return value ? { basis: value.basis, sources: value.sources.filter(source => ids.has(source.id)) } : null;
    };
    const selected = current(); if (!selected || selected.sources.length !== ids.size || ids.size > 12) { this.#retire(); return; }
    this.#phase = "preparing"; this.#controller = new AbortController(); const controller = this.#controller; this.requestUpdate();
    let original: Uint8Array<ArrayBuffer> | null = null, edited: Uint8Array<ArrayBuffer> | null = null;
    try {
      original = await sourcePng(captured.basis.media.url, controller, () => Boolean(current()));
      if (!current()) { if (this.#lease === lease) this.#retire(); return; }
      if (this.#snapshot?.media.byteLength !== undefined && original.byteLength !== this.#snapshot.media.byteLength) throw new Error("image_source_size");
      this.#original = original;
      edited = await capturedPng(blob, controller, () => Boolean(current()));
      if (!current()) { if (this.#lease === lease) this.#retire(); return; }
      const prepared = await prepareGeneratedImageEdit({ basis: selected.basis, sources: selected.sources, sourceId: captured.sourceId,
        recipe, originalPng: original, editedPng: edited }, current);
      if (!current()) { if (prepared.status === "prepared") prepared.dispose(); if (this.#lease === lease) this.#retire(); return; }
      if (prepared.status !== "prepared") { this.#failure = prepared.code === "invalid" ? "invalid" : "unavailable"; this.#phase = "error"; return; }
      this.#prepared = prepared;
      const previewCopy = prepared.copyPng();
      const owned = privateBytes(previewCopy); previewCopy?.fill(0); if (!owned) throw new Error("image_preview_retired");
      try { this.#previewUrl = URL.createObjectURL(new Blob([owned], { type: "image/png" })); } finally { owned.fill(0); }
      this.#previewReady = false; this.#phase = "preview";
    } catch {
      if (!this.#editingCurrent(lease)) { if (this.#lease === lease) this.#retire(); }
      else { this.#prepared?.dispose(); this.#prepared = null; this.#failure = "unavailable"; this.#phase = "error"; }
    } finally {
      edited?.fill(0); original?.fill(0); if (this.#original === original) this.#original = null;
      if (this.#controller === controller) this.#controller = null;
      if (this.#current(lease)) this.requestUpdate();
    }
  }
  #back() {
    if (!this.#editingCurrent() || this.#busy || !["preview", "error"].includes(this.#phase)) return;
    this.#prepared?.dispose(); this.#prepared = null;
    if (this.#previewUrl) URL.revokeObjectURL(this.#previewUrl); this.#previewUrl = ""; this.#previewReady = false;
    this.#phase = "editing"; this.requestUpdate();
  }
  async #save() {
    const lease = this.#lease, snapshot = this.#snapshot, prepared = this.#prepared;
    if (!this.#current(lease) || !this.#editingCurrent() || !snapshot || !prepared || this.#phase !== "preview" || !this.#previewReady || this.#busy || this.#pending) return;
    const uploadCopy = prepared.copyPng(); const bytes = privateBytes(uploadCopy); uploadCopy?.fill(0);
    if (!bytes) { this.#retire(); return; }
    const parsed = parseGeneratedImageEditRequest({ expectedRevision: snapshot.revision, expectedEditEventId: snapshot.editEventId,
      expectedContentSha256: snapshot.contentSha256, generationId: snapshot.generationId, sourceEventId: snapshot.sourceEventId, contentRef: snapshot.contentRef,
      sourceMediaUrl: snapshot.media.url, sourceMediaSha256: snapshot.media.sha256, sourceId: prepared.sourceId, recipe: prepared.recipe,
      resultMediaSha256: prepared.png.sha256, resultByteLength: prepared.png.byteLength });
    if (!parsed) { bytes.fill(0); this.#failure = "invalid"; this.#phase = "error"; this.requestUpdate(); return; }
    const request = Object.freeze({ ...parsed, recipe: prepared.recipe });
    this.#upload = bytes; this.#busy = true; this.requestUpdate();
    try {
      const operationSha256 = await generatedImageEditOperationSha256({ ownerId: lease.opening.ownerId, projectId: lease.opening.projectId,
        documentId: lease.opening.documentId, outputId: lease.opening.outputId }, request);
      if (!this.#editingCurrent(lease)) { if (this.#lease === lease) this.#retire(); return; }
      if (!operationSha256) throw new Error("image_operation_unavailable");
      this.#pending = Object.freeze({ request, operationSha256 });
      this.#phase = "saving"; this.#busy = false; this.#clearPrivate(); this.requestUpdate();
      const result = await lease.ports.save(parseGeneratedImageEditRequest(request)!, bytes);
      if (!this.#current(lease)) return;
      await this.#acknowledge(lease, result);
    } catch {
      if (this.#current(lease)) { this.#phase = this.#pending ? "unconfirmed" : "error"; this.#failure = "unavailable"; }
    } finally {
      bytes.fill(0); if (this.#upload === bytes) this.#upload = null;
      if (this.#current(lease)) { this.#busy = false; this.requestUpdate(); }
    }
  }
  async #acknowledge(lease: Lease, result: GeneratedImageEditAcknowledgment) {
    const pending = this.#pending; if (!this.#current(lease) || !pending) return;
    if (result.status === "saved") {
      const revision = parseGeneratedImageRevision(result.imageRevision, lease.opening.ownerId), request = pending.request;
      const recipeSha256 = await outputAssetSha256(new TextEncoder().encode(JSON.stringify(request.recipe)));
      if (!this.#current(lease) || this.#pending !== pending) return;
      if (!revision || result.code !== "saved" || result.operationSha256 !== pending.operationSha256 || revision.operationSha256 !== pending.operationSha256
        || revision.outputId !== lease.opening.outputId || revision.documentId !== lease.opening.documentId
        || revision.generationId !== request.generationId || revision.sourceEventId !== request.sourceEventId || revision.contentRef !== request.contentRef
        || revision.contentSha256 !== request.expectedContentSha256 || revision.revision !== request.expectedRevision + 1
        || revision.source.revision !== request.expectedRevision || revision.source.eventId !== (request.expectedEditEventId ?? request.sourceEventId)
        || revision.source.mediaUrl !== request.sourceMediaUrl || revision.source.sha256 !== request.sourceMediaSha256
        || revision.media.sha256 !== request.resultMediaSha256 || revision.media.byteLength !== request.resultByteLength
        || revision.sourceId !== request.sourceId || revision.recipeSha256 !== recipeSha256 || JSON.stringify(revision.recipe) !== JSON.stringify(request.recipe)) {
        this.#phase = "unconfirmed"; return;
      }
      this.#pending = null;
      if (result.stillCurrent !== true || result.currentRevision !== undefined && result.currentRevision !== revision.revision
        || result.currentEditEventId !== undefined && result.currentEditEventId !== revision.editEventId) { this.#failure = "source_changed"; this.#phase = "error"; }
      else this.#phase = "saved";
    } else if (result.status === "unchanged" && result.code === "unchanged") { this.#pending = null; this.#phase = "unchanged"; }
    else if (result.status === "refused" && ["unavailable", "invalid", "source_changed", "forbidden"].includes(result.code)) { this.#pending = null; this.#failure = result.code; this.#phase = "error"; }
    else this.#phase = "unconfirmed";
  }
  async #check() {
    const lease = this.#lease, pending = this.#pending;
    if (!this.#current(lease) || !pending || this.#phase !== "unconfirmed") return;
    this.#phase = "checking"; this.requestUpdate();
    try {
      const result = await lease.ports.check(pending.operationSha256);
      if (!this.#current(lease) || this.#pending !== pending) return;
      await this.#acknowledge(lease, result);
    } catch { if (this.#current(lease)) this.#phase = "unconfirmed"; }
    finally { if (this.#current(lease)) this.requestUpdate(); }
  }
  #close(reason: "cancel" | "done") {
    const lease = this.#lease; if (!this.#current(lease) || ["saving", "checking", "adopting"].includes(this.#phase)) return;
    // Parent captures the still-owned native focus before removing this opening.
    this.dispatchEvent(new CustomEvent("generated-image-editor-close", { bubbles: true, composed: true, detail: { opening: lease.opening, reason } }));
    if (this.#lease === lease) this.#retire(false);
  }
  #compositorCloseIntent = (event: Event) => {
    if (this.#phase !== "editing" || !this.#editingCurrent()) return;
    const compositor = this.querySelector("forma-reference-compositor");
    if (!(compositor instanceof ReferenceCompositor) || compositor.disabled) return;
    const dialog = compositor.querySelector<HTMLDialogElement>(":scope > dialog.reference-compositor");
    if (!dialog?.open || !dialog.contains(this.ownerDocument.activeElement)) return;
    const target = event.target;
    const button = target instanceof Element ? target.closest("button") : null;
    const close = compositor.querySelector(":scope > dialog > .reference-compositor-card > button.modal-close");
    const cancel = compositor.querySelector(":scope > dialog > .reference-compositor-card > footer > div > button.button.ghost:first-child");
    const intent = event.type === "cancel" && target === dialog || event.type === "click" && (target === dialog
      || button instanceof HTMLButtonElement && !button.disabled && (button === close || button === cancel));
    if (!intent) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.#close("cancel");
  };
  #previewLoaded(event: Event) {
    const image = event.currentTarget as HTMLImageElement, prepared = this.#prepared;
    if (!this.#editingCurrent() || this.#phase !== "preview" || !prepared
      || image !== this.querySelector(".generated-image-editor-preview") || !image.isConnected || !image.complete
      || image.getAttribute("src") !== this.#previewUrl || image.currentSrc !== this.#previewUrl) return;
    this.#previewReady = image.naturalWidth === prepared.png.width && image.naturalHeight === prepared.png.height;
    if (!this.#previewReady) { this.#failure = "unavailable"; this.#phase = "error"; }
    this.requestUpdate();
  }
  override render() {
    if (!this.#lease || this.#phase === "closed") return nothing;
    const copy = generatedImageEditCopy(this.i18n.locale);
    if (["editing", "preparing"].includes(this.#phase) && this.#captured) return html`<forma-reference-compositor
      .sources=${this.#captured.sources} .recipe=${this.#recipe} .usageHint=${copy.help} .disabled=${this.#phase !== "editing" || !this.#editingCurrent()}
      @composition-capture=${(event: CustomEvent<ReferenceCompositionCapture>) => void this.#capture(event)}
      @composition-close=${(event: Event) => { if (event.target === event.currentTarget) { event.stopPropagation(); this.#close("cancel"); } }}></forma-reference-compositor>`;
    const phase = this.#phase;
    const pending = ["saving", "checking", "adopting"].includes(phase), finished = ["saved", "unchanged"].includes(phase);
    const status = phase === "error" ? copy[this.#failure] : phase === "adoption" ? copy.adoption : phase === "preview" ? copy.previewHelp
      : phase === "loading" ? copy.loading : phase === "adopting" ? copy.adopting : phase === "saving" ? copy.saving
      : phase === "checking" ? copy.checking : phase === "saved" ? copy.saved : phase === "unchanged" ? copy.unchanged : copy.unconfirmed;
    return html`<dialog class="modal generated-image-editor-dialog" closedby=${pending ? "none" : "any"} aria-modal="true"
      lang=${this.i18n.locale} dir=${this.i18n.direction} aria-labelledby=${`${this.#prefix}-title`} aria-describedby=${`${this.#prefix}-status`}
      @cancel=${(event: Event) => { event.preventDefault(); this.#close(finished ? "done" : "cancel"); }}
      @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#close(finished ? "done" : "cancel"); }}>
      <div class="modal-card generated-image-editor-card">
        <button type="button" class="icon-button modal-close" ?disabled=${pending} aria-label=${finished ? copy.done : copy.cancel} @click=${() => this.#close(finished ? "done" : "cancel")}>${icon("close")}</button>
        <h2 id=${`${this.#prefix}-title`}>${phase === "preview" ? copy.previewTitle : copy.title}</h2>
        <p class="generated-image-editor-disclosure">${copy.help}</p>
        ${phase === "preview" && this.#previewUrl ? html`<img class="generated-image-editor-preview" src=${this.#previewUrl} alt=${copy.previewAlt}
          @load=${(event: Event) => this.#previewLoaded(event)} @error=${() => { if (this.#editingCurrent() && this.#phase === "preview") { this.#previewReady = false; this.#failure = "unavailable"; this.#phase = "error"; this.requestUpdate(); } }}>` : nothing}
        <p id=${`${this.#prefix}-status`} role="status" aria-live="polite">${status}</p>
        ${["adoption", "adopting", "preview"].includes(phase) ? html`<p class="generated-image-editor-disclosure">${copy.adoptionRemains}</p>` : nothing}
        ${["saving", "checking", "unconfirmed"].includes(phase) ? html`<p class="generated-image-editor-disclosure">${copy.pendingClose}</p>` : nothing}
        <footer>
          ${phase === "preview" || phase === "error" && this.#captured ? html`<button type="button" class="button ghost" ?disabled=${this.#busy} @click=${() => this.#back()}>${copy.back}</button>` : nothing}
          <button type="button" class="button ghost" ?disabled=${pending} @click=${() => this.#close(finished ? "done" : "cancel")}>${finished ? copy.done : copy.cancel}</button>
          ${phase === "adoption" ? html`<button type="button" class="button primary" @click=${() => void this.#adopt()}>${copy.adopt}</button>` : nothing}
          ${phase === "preview" ? html`<button type="button" class="button primary" ?disabled=${this.#busy || !this.#previewReady || !this.#editingCurrent()} @click=${() => void this.#save()}>${this.#busy ? copy.saving : copy.save}</button>` : nothing}
          ${phase === "unconfirmed" ? html`<button type="button" class="button primary" @click=${() => void this.#check()}>${copy.check}</button>` : nothing}
        </footer>
      </div>
    </dialog>`;
  }
}
if (!customElements.get("forma-generated-image-editor")) customElements.define("forma-generated-image-editor", GeneratedImageEditor);
export { sourcePng as readGeneratedImagePng };
declare global { interface HTMLElementTagNameMap { "forma-generated-image-editor": GeneratedImageEditor } }
