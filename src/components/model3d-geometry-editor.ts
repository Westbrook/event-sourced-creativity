import { html, nothing } from "lit";
import type { CreativeBlock, CreativeEvent, EventInput } from "../model/events";
import type { FormaStore, EventWriteResult } from "../state/store";
import { creativeContextRightsValidity } from "../model/context-health";
import { referenceCompositionMediaUrl } from "../model/reference-composition";
import { MAX_MODEL3D_UPLOAD_BYTES, MODEL3D_MIME_TYPE } from "../model/model3d-assets";
import { GeometryScaleError, scaleModel3dGeometry } from "../model/model3d-geometry-edit";
import { FormaElement } from "./forma-element";

type ScaleResult = ReturnType<typeof scaleModel3dGeometry>;
type EditErrorCode = "unavailable" | "rights" | "source" | "upload" | "confirmation";
export class Model3dGeometryEditError extends Error {
  constructor(readonly code: EditErrorCode) { super(`model3d_geometry_${code}`); }
}
const fail: (code: EditErrorCode) => never = (code) => { throw new Model3dGeometryEditError(code); };
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
  value => value.toString(16).padStart(2, "0")).join("");
const allowedRights = new Set(["owned", "owned_or_licensed", "account-generated"]);

function liveModel(store: FormaStore, blockId: string) {
  const projection = store.projection.get(), session = store.session.get();
  const permissions = session?.projectContext?.permissions ?? session?.capabilities ?? [];
  if (!store.captureAuthorizationScope() || !permissions.includes("project.read") || !permissions.includes("project.author")) return;
  return projection.libraryBlocks.find(block => block.id === blockId && block.projectId === projection.projectId
    && block.scope === "library" && block.type === "model3d" && !block.removed && !block.locked
    && !block.properties.organization_context_package_binding_id);
}

/** Rights follow the current original's exact ingestion and latest assertion. A block label is not a license. */
function sourceRights(block: CreativeBlock, events: readonly CreativeEvent[]) {
  const id = block.properties.model_reference_id;
  let ingestion: CreativeEvent | undefined, assertion: CreativeEvent | undefined;
  for (const event of events) if (event.payload.reference_id === id) {
    if (event.type === "ReferenceIngested") { ingestion = event; assertion = undefined; }
    else if (event.type === "RightsAsserted") assertion = event;
  }
  const validity = [block.properties, ingestion?.payload ?? {}, assertion?.payload ?? {}].map(value => creativeContextRightsValidity(value));
  if (typeof id !== "string" || !id || !ingestion || !assertion || assertion.sequence <= ingestion.sequence
    || ingestion.payload.source_ref !== block.properties.model_url
    || ingestion.payload.content_hash !== block.properties.model_content_hash
    || ingestion.payload.source_mime_type !== MODEL3D_MIME_TYPE
    || !allowedRights.has(String(assertion.payload.rights_class))
    || validity.some(value => value.issue)) return null;
  return { rightsClass: String(assertion.payload.rights_class), referenceId: id, assertionEventId: assertion.eventId,
    rightsExpiresAt: validity.flatMap(value => value.validUntil ? [value.validUntil] : []).sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null };
}

/** Bound the owned wait, while observing a late dispatched operation without retrying it. */
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, owner: AbortSignal | undefined, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (owner?.aborted) abort(); else owner?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, milliseconds);
  let stop: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => reject(new Model3dGeometryEditError("unavailable"));
    if (controller.signal.aborted) stop(); else controller.signal.addEventListener("abort", stop, { once: true });
  });
  try { return await Promise.race([interrupted, controller.signal.aborted ? interrupted : work(controller.signal)]); }
  finally {
    clearTimeout(timer); owner?.removeEventListener("abort", abort);
    if (stop) controller.signal.removeEventListener("abort", stop);
    controller.abort();
  }
}

function discardBody(response: Response) {
  try { void response.body?.cancel().catch(() => {}); } catch { /* Preserve the original verification refusal. */ }
}

async function readBytes(response: Response, maximum: number, signal: AbortSignal, current: () => boolean) {
  const declared = response.headers.get("content-length");
  if (!response.body || declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) { discardBody(response); fail("source"); }
  const reader = response.body!.getReader(), chunks: Uint8Array[] = [];
  let length = 0, complete = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (let count = 0; count < 16_384; count++) {
      if (signal.aborted || !current()) fail("unavailable");
      const { done, value } = await reader.read();
      if (signal.aborted || !current()) fail("unavailable");
      if (done) { complete = true; break; }
      length += value.byteLength;
      if (length > maximum) fail("source");
      chunks.push(value);
    }
    if (!complete || declared !== null && length !== Number(declared)) fail("source");
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    // releaseLock must not turn an uncancellable source into a pending editor.
    try { reader.releaseLock(); } catch { /* The observed pending read settles after cancellation. */ }
  }
}

function completeWrite(write: EventWriteResult, inputs: EventInput[], expected: number) {
  const ack = write.acknowledgment;
  const contains = (expectedValue: unknown, actual: unknown): boolean => {
    if (expectedValue === null || typeof expectedValue !== "object") return Object.is(expectedValue, actual);
    if (Array.isArray(expectedValue)) return Array.isArray(actual) && expectedValue.length === actual.length
      && expectedValue.every((value, index) => contains(value, actual[index]));
    return Boolean(actual && typeof actual === "object" && !Array.isArray(actual)
      && Object.entries(expectedValue).every(([key, value]) => contains(value, (actual as Record<string, unknown>)[key])));
  };
  return write.publication === "published" && ack.outcome === "observed" && !ack.privateUnavailable
    && ack.rejectedIndices.length === 0 && ack.observedHead === expected + inputs.length
    && ack.committed.length === inputs.length && write.appended.length === inputs.length
    && new Set(write.appended.map(event => event.eventId)).size === inputs.length
    && inputs.every((input, index) => {
      const event = write.appended[index]!;
      return event.sequence === expected + index + 1 && event.type === input.type && contains(input.payload, event.payload)
        && ack.committed.some(item => item.eventId === event.eventId && item.sequence === event.sequence && item.type === event.type);
    });
}

export type Model3dGeometrySave = { status: "saved"; url: string; contentHash: string; beforeBounds: ScaleResult["beforeBounds"]; afterBounds: ScaleResult["afterBounds"] }
  | { status: "unchanged" | "unavailable" | "unconfirmed" };
export type Model3dGeometrySession = {
  blockId: string;
  current: () => boolean;
  owned: () => boolean;
  preview: (factor: number) => ScaleResult;
  save: (factor: number, options?: { nonSensitiveConfirmed?: boolean }) => Promise<Model3dGeometrySave>;
};

/** This same controller is exercised against the real Store/Worker in the persistence controls. */
export async function prepareModel3dGeometryEdit(store: FormaStore, blockId: string, guard: () => boolean, options: { signal?: AbortSignal } = {}): Promise<Model3dGeometrySession> {
  const original = liveModel(store, blockId), source = store.captureSourceOwnership();
  if (!original || !guard() || !store.sourceOwnershipActive(source)) fail("unavailable");
  const block = structuredClone(original!), expected = store.head.get(), route = store.route.get();
  const fingerprint = JSON.stringify(block), rights = sourceRights(block, store.events.get());
  const url = referenceCompositionMediaUrl(block.properties.model_url), originalHash = block.properties.model_content_hash;
  if (!rights) fail("rights");
  if (!url || url !== block.properties.model_url || block.properties.model_mime_type !== MODEL3D_MIME_TYPE
    || typeof originalHash !== "string" || !/^[a-f0-9]{64}$/.test(originalHash)) fail("source");
  let retired = false, saving = false;
  const owned = () => !options.signal?.aborted && guard() && store.sourceOwnershipActive(source) && store.route.get() === route
    && Boolean(liveModel(store, blockId));
  const current = () => !retired && owned() && store.head.get() === expected
    && JSON.stringify(liveModel(store, blockId)) === fingerprint
    && JSON.stringify(sourceRights(block, store.events.get())) === JSON.stringify(rights);
  if (!current()) fail("unavailable");
  const bytes = await bounded(async signal => {
    const response = await store.guardedFetch(url!, { cache: "no-store", redirect: "error", signal }, "read this saved 3D model", { current });
    if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";")[0]?.trim() !== MODEL3D_MIME_TYPE) { discardBody(response); fail("source"); }
    const originalBytes = await readBytes(response, MAX_MODEL3D_UPLOAD_BYTES, signal, current);
    if (await digest(originalBytes) !== originalHash) fail("source");
    if (!current() || signal.aborted) fail("unavailable");
    return originalBytes;
  }, options.signal, 30_000);
  // Eligibility applies even to a no-op. The original bytes remain private and immutable.
  scaleModel3dGeometry(bytes, 1);
  return {
    blockId, current, owned,
    preview(factor) { if (!current() || saving) fail("unavailable"); return scaleModel3dGeometry(bytes, factor); },
    async save(factor, confirmation = {}) {
      if (!current() || saving) return { status: "unavailable" };
      const changed = scaleModel3dGeometry(bytes, factor);
      if (!changed.changed) return { status: "unchanged" };
      if (confirmation.nonSensitiveConfirmed !== true) fail("confirmation");
      saving = true;
      let uploadAttempted = false;
      try {
        const contentHash = await digest(changed.bytes);
        if (!current()) return { status: "unavailable" };
        const filename = "scaled-model.glb", form = new FormData();
        form.append("file", new File([new Uint8Array(changed.bytes)], filename, { type: MODEL3D_MIME_TYPE }));
        // The currently valid source assertion above authorizes a local derivative;
        // no newly invented or unrelated rights assertion is used.
        form.append("rightsConfirmed", "true");
        // Separate explicit user confirmation; a license alone does not prove sensitivity.
        form.append("nonSensitiveConfirmed", "true");
        const media = await bounded(async signal => {
          const uploaded = await store.guardedFetch("/api/media", { method: "POST", body: form, redirect: "error" }, "save this scaled 3D model",
            { current: () => uploadAttempted || current(), onDispatch: () => { uploadAttempted = true; } });
          if (!uploaded.ok || uploaded.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") { discardBody(uploaded); fail("upload"); }
          const body = await readBytes(uploaded, 64 * 1024, signal, () => uploadAttempted || current());
          return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as { url?: string; mimeType?: string; contentHash?: string };
        }, options.signal, 90_000);
        if (!current()) return { status: "unavailable" };
        if (!media.url || referenceCompositionMediaUrl(media.url) !== media.url
          || media.mimeType !== MODEL3D_MIME_TYPE || media.contentHash !== contentHash) fail("upload");
        const referenceId = crypto.randomUUID();
        const properties: Record<string, unknown> = {
          model_url: media.url, model_mime_type: MODEL3D_MIME_TYPE, model_content_hash: contentHash,
          model_reference_id: referenceId, model_filename: filename,
          media_url: null, media_type: null, source_mime_type: null, source_content_hash: null,
          reference_id: null, model_view: null, pixel_reference_mode: "context_only",
        };
        const events: EventInput[] = [
          { type: "ReferenceIngested", payload: { reference_id: referenceId, source_type: "model3d-geometry-edit", source_ref: media.url,
            content_hash: contentHash, source_mime_type: MODEL3D_MIME_TYPE, rights_class: "asserted",
            source_model_reference_id: rights!.referenceId, source_model_content_hash: originalHash, geometry_scale: factor } },
          { type: "RightsAsserted", payload: { reference_id: referenceId, rights_class: rights!.rightsClass,
            assertion_method: "inherited-model3d-source-assertion", source_reference_id: rights!.referenceId,
            source_assertion_event_id: rights!.assertionEventId,
            ...(rights!.rightsExpiresAt ? { rights_expires_at: rights!.rightsExpiresAt } : {}) } },
          ...Object.entries(properties).map(([key, value]) => ({ type: "BlockPropertyEdited", payload: {
            block_id: block.id, document_id: block.documentId, property_path: key,
            old_value: block.properties[key] ?? null, new_value: value, source_surface: "model3d-geometry-editor",
          } })),
        ];
        // An edited mesh must never rebase onto an unseen original. A late upload
        // may remain unreferenced; never delete, roll back or retry an uncertain write.
        const write = await bounded(() => store.appendBatchWithReceipt(events, { expected, current }), options.signal, 90_000);
        if (!owned() || !completeWrite(write, events, expected)
          || !Object.entries(properties).every(([key, value]) => JSON.stringify(liveModel(store, blockId)?.properties[key] ?? null) === JSON.stringify(value))) return { status: "unconfirmed" };
        return { status: "saved", url: media.url, contentHash, beforeBounds: changed.beforeBounds, afterBounds: changed.afterBounds };
      } catch (error) {
        if (uploadAttempted) return { status: "unconfirmed" };
        throw error;
      } finally { saving = false; if (uploadAttempted) retired = true; }
    },
  };
}

export class Model3dGeometryEditor extends FormaElement {
  static properties = { blockId: { attribute: false }, readOnly: { type: Boolean }, guard: { attribute: false } };
  blockId = "";
  readOnly = false;
  guard: () => boolean = () => true;
  #owner: object | null = null;
  #ownerCurrent: (() => boolean) | null = null;
  #abort: AbortController | null = null;
  #nonSensitiveConfirmed = false;
  // Standalone controls must not validate or implicitly submit the outer Library form.
  #fieldForm = `model3d-geometry-fields-${crypto.randomUUID()}`;
  #session: Model3dGeometrySession | null = null;
  #pending: object | null = null;
  #factor = "1";
  #preview: ScaleResult | null = null;
  #notice = "";
  get busy() { return Boolean(this.#pending); }
  get navigationBlocked() { return this.busy || Boolean(this.#session && this.#factor !== "1"); }
  #changed() { this.requestUpdate(); this.dispatchEvent(new CustomEvent("model3d-geometry-state", { bubbles: true, composed: true })); }
  override disconnectedCallback() { this.#abort?.abort(); this.#abort = null; this.#owner = null; this.#session = null; this.#pending = null; super.disconnectedCallback(); }
  #error(error: unknown) {
    if (error instanceof GeometryScaleError) {
      if (error.code === "factor") return this.i18n.t("model3d.geometry.factorError", "Enter a finite scale factor greater than zero.");
      if (error.code === "precision") return this.i18n.t("model3d.geometry.precision", "That scale would lose geometry. Choose a less extreme factor.");
      return this.i18n.t("model3d.geometry.unsupported", "This model cannot be scaled here. Use a static GLB with uncompressed geometry, identity transforms and no animation, skin or morph targets.");
    }
    if (error instanceof Model3dGeometryEditError && error.code === "confirmation") return this.i18n.t("model3d.geometry.confirmation", "Confirm that this model and its textures contain no sensitive information before saving.");
    if (error instanceof Model3dGeometryEditError && error.code === "rights") return this.i18n.t("model3d.geometry.rights", "This model needs a current, valid source rights assertion before its geometry can be edited.");
    return this.i18n.t("model3d.geometry.unavailable", "The current model could not be verified. Reopen it before editing.");
  }
  async #open() {
    if (this.busy || this.readOnly || !this.isConnected || !this.guard()) return;
    const pending = {}, store = this.store, blockId = this.blockId, route = store.route.get(), source = store.captureSourceOwnership();
    this.#abort?.abort(); this.#abort = new AbortController(); this.#nonSensitiveConfirmed = false;
    this.#owner = pending; this.#pending = pending; this.#session = null; this.#notice = ""; this.#changed();
    const current = () => this.isConnected && this.store === store && this.blockId === blockId
      && !this.readOnly && this.guard() && this.#owner === pending && store.route.get() === route && store.sourceOwnershipActive(source);
    this.#ownerCurrent = current;
    try {
      const session = await prepareModel3dGeometryEdit(store, blockId, current, { signal: this.#abort.signal });
      if (!current()) return;
      this.#session = session; this.#factor = "1"; this.#preview = session.preview(1);
    } catch (error) { if (current()) this.#notice = this.#error(error); }
    finally { if (this.#pending === pending) { this.#pending = null; this.#changed();
      await this.updateComplete;
      if (this.#session?.current()) this.querySelector<HTMLInputElement>("input[type=number]")?.focus();
      else if (current()) this.querySelector<HTMLButtonElement>("[data-geometry-open]")?.focus();
    } }
  }
  #input(event: Event) {
    this.#factor = (event.target as HTMLInputElement).value; this.#notice = ""; this.#preview = null;
    try { this.#preview = this.#session?.preview(Number(this.#factor)) ?? null; }
    catch (error) { this.#notice = this.#error(error); }
    this.#changed();
  }
  async #save() {
    const session = this.#session;
    if (!session?.current() || this.busy || !this.#preview?.changed) return;
    const pending = {}, blockId = this.blockId; let returnFocus = false; this.#pending = pending; this.#notice = ""; this.#changed();
    try {
      const result = await session.save(Number(this.#factor), { nonSensitiveConfirmed: this.#nonSensitiveConfirmed });
      if (!session.owned() || this.blockId !== blockId || this.#session !== session) return;
      if (result.status === "saved") {
        returnFocus = true; this.#session = null; this.#preview = null; this.#factor = "1";
        this.#notice = this.i18n.t("model3d.geometry.saved", "Scaled geometry saved. Save a new image view before using it for generation.");
        this.dispatchEvent(new CustomEvent("model3d-geometry-saved", { detail: { blockId }, bubbles: true, composed: true }));
      } else if (result.status !== "unchanged") {
        returnFocus = true; this.#session = null; this.#preview = null;
        this.#notice = result.status === "unconfirmed"
          ? this.i18n.t("model3d.geometry.unconfirmed", "The change was not fully acknowledged. It has not been retried. Check the current model before making another edit.")
          : this.#error(new Model3dGeometryEditError("unavailable"));
      }
    } catch (error) { if (session.owned() && this.#session === session) { returnFocus = true; this.#notice = this.#error(error); this.#session = null; this.#preview = null; } }
    finally { if (this.#pending === pending) { this.#pending = null; this.#changed();
      if (returnFocus && session.owned()) { await this.updateComplete; if (session.owned()) this.querySelector<HTMLButtonElement>("[data-geometry-open]")?.focus(); }
    } }
  }
  async #cancel() {
    if (this.busy) return;
    const store = this.store, blockId = this.blockId, route = store.route.get(), source = store.captureSourceOwnership();
    this.#abort?.abort(); this.#owner = null; this.#session = null; this.#preview = null; this.#factor = "1"; this.#notice = ""; this.#changed();
    await this.updateComplete;
    if (this.isConnected && this.store === store && this.blockId === blockId && this.#owner === null && !this.readOnly
      && this.guard() && store.route.get() === route && store.sourceOwnershipActive(source)) this.querySelector<HTMLButtonElement>("[data-geometry-open]")?.focus();
  }
  override render() {
    if (this.#ownerCurrent && !this.#ownerCurrent()) this.#abort?.abort();
    const session = this.#session;
    if (session && !this.busy && !session.current()) { this.#abort?.abort(); this.#session = null; this.#preview = null; this.#notice = this.#error(new Model3dGeometryEditError("unavailable")); }
    const dimensions = (bounds: ScaleResult["beforeBounds"]) => bounds.size.map(value => new Intl.NumberFormat(this.i18n.locale, { maximumSignificantDigits: 8 }).format(value)).join(" × ");
    return html`<section aria-label=${this.i18n.t("model3d.geometry.title", "Scale model geometry")}>
      <h4>${this.i18n.t("model3d.geometry.title", "Scale model geometry")}</h4>
      <p>${this.i18n.t("model3d.geometry.help", "Scale the saved vertices uniformly about the model origin. Dimensions are in model units; the preview automatically fits the model. The previous file is preserved. Saving clears the old image view.")}</p>
      ${this.#session ? html`<label>${this.i18n.t("model3d.geometry.factor", "Scale factor")}<input style="scroll-margin-block:var(--forma-focus-clearance,.5rem)" type="number" form=${this.#fieldForm} min="0" step="any" inputmode="decimal" .value=${this.#factor} ?disabled=${this.busy} @input=${this.#input}></label>
        ${this.#preview ? html`<p>${this.i18n.t("model3d.geometry.dimensions", "Dimensions (X × Y × Z), model units")}: <bdi>${dimensions(this.#preview.beforeBounds)}</bdi> → <bdi>${dimensions(this.#preview.afterBounds)}</bdi></p>` : nothing}
        <label class="rights-check"><input style="scroll-margin-block:var(--forma-focus-clearance,.5rem)" type="checkbox" form=${this.#fieldForm} .checked=${this.#nonSensitiveConfirmed} ?disabled=${this.busy} @change=${(event: Event) => { this.#nonSensitiveConfirmed = (event.target as HTMLInputElement).checked; this.#changed(); }}><span>${this.i18n.t("model3d.geometry.nonSensitive", "This model and its textures contain no sensitive information.")}</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:var(--forma-focus-clearance,.5rem);padding-block:var(--forma-focus-clearance,.5rem)">
        <button style="scroll-margin-block:var(--forma-focus-clearance,.5rem)" type="button" class="button primary compact" ?disabled=${this.busy || !this.#preview?.changed || !this.#nonSensitiveConfirmed} @click=${this.#save}>${this.i18n.t("model3d.geometry.save", "Save scaled geometry")}</button>
        <button style="scroll-margin-block:var(--forma-focus-clearance,.5rem)" type="button" class="button secondary compact" ?disabled=${this.busy} @click=${this.#cancel}>${this.i18n.system("Cancel")}</button></div>`
        : html`<button style="scroll-margin-block:var(--forma-focus-clearance,.5rem)" type="button" data-geometry-open class="button secondary compact" ?disabled=${this.readOnly || this.busy} @click=${this.#open}>${this.i18n.t("model3d.geometry.open", "Edit scale")}</button>`}
      ${this.busy ? html`<p role="status">${this.i18n.t("model3d.geometry.working", "Reading or saving model geometry…")}</p>` : nothing}
      ${this.#notice ? html`<p role="status">${this.#notice}</p>` : nothing}
    </section>`;
  }
}

if (!customElements.get("forma-model3d-geometry-editor")) customElements.define("forma-model3d-geometry-editor", Model3dGeometryEditor);
declare global { interface HTMLElementTagNameMap { "forma-model3d-geometry-editor": Model3dGeometryEditor } }
