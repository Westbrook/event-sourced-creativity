import { readVideoReferencePlan } from "./video-reference-plan.ts";
import { readVideoReferenceCandidate, type VideoReferenceCandidate } from "./video-reference-candidate.ts";
import { readVideoReferenceIntent, EXPERIENCE_VIDEO_INTENT, type VideoReferenceIntent } from "./video-reference.ts";
import { canonicalJson, jsonIssues, record } from "./compiler.ts";
import { readModel3dReferenceCandidate, type Model3dReferenceCandidate } from "./model3d-reference-candidate.ts";
import { readModel3dReferenceIntent, type Model3dReferenceIntent } from "./model3d-reference.ts";

const cap = 24 * 1024 * 1024;
const mimeTypes = ["image/png", "image/jpeg", "image/webp"];
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
type ReferenceIntent = Model3dReferenceIntent | VideoReferenceIntent;
type ReferenceCandidate = Model3dReferenceCandidate | VideoReferenceCandidate;
type Changed = (selection: ReferenceIntent | null, ready: boolean) => void;
type PickerPolicy = "model3d" | "video";
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item;
};
const sameSource = (candidate: ReferenceCandidate, intent: ReferenceIntent) => {
  const { permissionAttestation: _, ...source } = intent; return canonicalJson(candidate.source) === canonicalJson(source);
};

const previewTimeoutMs = 30_000, previewChunkLimit = 65_536;
const cancelPreview = (operation: () => Promise<unknown>) => {
  try { void operation().catch(() => undefined); } catch { /* Already released. */ }
};
// One finite client lifetime; neither this clock nor its signal grants source authority.
function previewLease(parent: AbortSignal) {
  const controller = new AbortController(), deadline = Date.now() + previewTimeoutMs;
  let reject!: (reason: Error) => void;
  const stopped = new Promise<never>((_, failure) => { reject = failure; });
  void stopped.catch(() => undefined);
  const stop = () => { controller.abort(); reject(Error("preview_unavailable")); };
  const timer = setTimeout(stop, previewTimeoutMs);
  parent.addEventListener("abort", stop, { once: true });
  if (parent.aborted) stop();
  const current = () => !parent.aborted && !controller.signal.aborted && Date.now() < deadline;
  const check = () => { if (!current()) { stop(); throw Error("preview_unavailable"); } };
  return {
    signal: controller.signal, current, check,
    async settle<T>(operation: Promise<T>): Promise<T> {
      // Attach the rejection observer even when the lease was already retired.
      const pending = Promise.race([operation, stopped]); void pending.catch(() => undefined); check();
      const value = await pending; check(); return value;
    },
    dispose() { clearTimeout(timer); parent.removeEventListener("abort", stop); controller.abort(); },
  };
}
type PreviewLease = ReturnType<typeof previewLease>;

async function previewBytes(response: Response, expectedHash: string, lease: PreviewLease, maximumBytes = cap) {
  lease.check();
  const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!response.ok || !mimeTypes.includes(mime) || !response.body) {
    if (response.body) cancelPreview(() => response.body!.cancel());
    throw Error("preview_unavailable");
  }
  const reader = response.body.getReader(), storage = new Uint8Array(maximumBytes); let size = 0, chunks = 0;
  try {
    while (true) {
      lease.check(); const part = await lease.settle(reader.read());
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || !part.value.byteLength || ++chunks > previewChunkLimit
        || size + part.value.byteLength > maximumBytes) throw Error("preview_unavailable");
      storage.set(part.value, size); size += part.value.byteLength;
    }
  } finally {
    cancelPreview(() => reader.cancel());
    try { reader.releaseLock(); } catch { /* A refused cancellation must not retain the busy control. */ }
  }
  if (!size) throw Error("preview_unavailable");
  const bytes = storage.slice(0, size);
  const digest = await lease.settle(crypto.subtle.digest("SHA-256", bytes));
  const sha = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (sha !== expectedHash) throw Error("preview_unavailable");
  return { bytes, mime };
}

/** Bounded exact bytes for an ordinary private image, never an arbitrary URL. */
export async function readModel3dPreviewBytes(response: Response, expectedHash: string, signal: AbortSignal) {
  const lease = previewLease(signal);
  try { return await previewBytes(response, expectedHash, lease); } finally { lease.dispose(); }
}

/** Native controls stay mounted through reads. No input grants authority; Save rereads. */
class ReferencePicker {
  #policy: PickerPolicy;
  #maximumBytes: number;
  #copy(model3d: string, video: string) { return this.#policy === "video" ? video : model3d; }
  readonly element = node("fieldset");
  #status = node("p");
  #choices = node("div");
  #selected = node("div");
  #image = node("img");
  #caption = node("p");
  #permission = node("input");
  #browse = node("button", "Browse Document references");
  #refresh = node("button", "Refresh reference list");
  #retry = node("button", "Check selected reference");
  #text = node("input");
  #fetch: Fetcher;
  #changed: Changed;
  #disposed = false;
  #listBusy = false;
  #listFailed = false;
  #awaitingDiscovery = false;
  #expectedSource?: ReferenceCandidate["source"];
  #next: { after: string; head: number } | null = null;
  #head?: number;
  #listEpoch = 0;
  #sourceEpoch = 0;
  #listAbort = new AbortController();
  #sourceAbort = new AbortController();
  #candidate?: ReferenceCandidate;
  #entries = new Map<string, { candidate: ReferenceCandidate; control: HTMLInputElement }>();
  #retained?: ReferenceIntent;
  #url?: string;
  #previewReady = false;
  #inspectionReady = false;
  #sourceBusy = false;
  #checkEpoch = 0;
  #checkAbort = new AbortController();
  constructor(changed: Changed, retained: ReferenceIntent | undefined, fetcher: Fetcher, policy: PickerPolicy) {
    this.#policy = policy; this.#maximumBytes = policy === "video" ? 30 * 1024 * 1024 : cap;
    if (policy === "video") { this.#browse.textContent = "Browse images"; this.#refresh.textContent = "Refresh images"; this.#retry.textContent = "Check image"; }
    this.#fetch = (path, init) => fetcher(path, init); this.#changed = changed; this.#retained = retained;
    this.element.className = "experience-model3d-reference";
    if (policy === "video") this.element.className += " experience-video-reference";
    const name = `experience-model3d-reference-${crypto.randomUUID()}`;
    const legend = node("legend", this.#copy("Reference", "Image")), textLabel = node("label"), permissionLabel = node("label");
    this.#text.type = "radio"; this.#text.name = name; this.#text.checked = policy === "model3d" && !retained;
    textLabel.append(this.#text, node("span", "Text only"));
    this.#choices.className = "experience-model3d-reference-choices";
    if (policy === "model3d") this.#choices.append(textLabel);
    this.#permission.type = "checkbox";
    permissionLabel.append(this.#permission, node("span", this.#copy("I own or have permission to use this reference and its contents.", "Ownership / permission confirmed")));
    this.#image.alt = this.#copy("Selected reference", "Selected image"); this.#image.hidden = true;
    this.#selected.className = "experience-model3d-reference-selected"; this.#selected.hidden = true;
    this.#caption.dir = "auto";
    this.#selected.append(this.#image, this.#caption, permissionLabel, this.#retry);
    this.#status.id = `${name}-status`; this.#status.setAttribute("role", "status"); this.#status.setAttribute("aria-live", "polite");
    this.element.setAttribute("aria-describedby", this.#status.id);
    this.#browse.type = this.#retry.type = this.#refresh.type = "button"; this.#browse.className = this.#retry.className = this.#refresh.className = "experience-button";
    this.#refresh.hidden = true;
    this.#refresh.addEventListener("click", () => this.#freshList());
    this.#browse.addEventListener("click", () => void this.#load());
    this.#retry.addEventListener("click", () => { if (!this.#sourceBusy && this.#candidate) void this.#readSelection(); });
    this.#text.addEventListener("change", () => { if (this.#text.checked) this.#select(undefined); });
    this.#permission.addEventListener("change", () => {
      if (this.#awaitingDiscovery && this.#candidate) this.#retained = this.#intent() ?? undefined;
      this.#checkAbort.abort(); this.#checkAbort = new AbortController(); this.#checkEpoch++; this.#inspectionReady = false;
      this.#notify(false);
      if (this.#permission.checked && this.#candidate) void this.#inspect();
      else this.#status.textContent = this.#copy("Permission is required for the selected reference. You may instead choose Text only.", "Permission required");
    });
    this.element.append(legend, node("p", this.#copy("Choose one image or saved 3D view from your personal Document references. URLs and uploaded meshes are not reference inputs.", "1 image · Required")), this.#choices, this.#browse, this.#refresh, this.#selected, this.#status);
    if (retained) queueMicrotask(() => { if (!this.#disposed) { this.#changed(retained, false); void this.#load(); } });
  }
  focus() { (this.#candidate ? this.#permission : this.#browse).focus(); }
  #options(signal: AbortSignal): RequestInit { return { credentials: "same-origin", cache: "no-store", redirect: "error", signal }; }
  #invalidateList() {
    this.#sourceEpoch++; this.#sourceAbort.abort(); this.#sourceAbort = new AbortController();
    this.#checkEpoch++; this.#checkAbort.abort(); this.#checkAbort = new AbortController();
    this.#sourceBusy = false; this.#retry.setAttribute("aria-disabled", "false");
    this.#inspectionReady = false; this.#awaitingDiscovery = Boolean(this.#candidate || this.#retained);
    this.#expectedSource = this.#candidate?.source;
    if (this.#candidate) { this.#retained = this.#intent() ?? undefined; this.#notify(false); }
    else if (this.#retained) this.#changed(this.#retained, false);
  }
  #freshList() {
    if (this.#disposed || this.#listBusy || !this.element.isConnected || !this.#refresh.isConnected) return;
    // This explicit action may replace list radios, but never remove a focused
    // radio unless the exact connected action has accepted its focus first.
    if (this.#choices.contains(document.activeElement)) {
      try { this.#refresh.focus({ preventScroll: true }); } catch { return; }
      if (document.activeElement !== this.#refresh) return;
    }
    this.#invalidateList(); this.#listFailed = false; this.#head = undefined; this.#next = null;
    this.#entries.clear(); this.#choices.replaceChildren(...(this.#policy === "model3d" ? [this.#text.parentElement!] : []));
    void this.#load();
  }
  async #load() {
    if (this.#disposed || this.#listBusy || this.#listFailed || this.#head !== undefined && !this.#next) return;
    const epoch = ++this.#listEpoch; this.#listBusy = true; this.#browse.setAttribute("aria-disabled", "true");
    this.#refresh.setAttribute("aria-disabled", "true");
    this.#status.textContent = this.#copy("Reading current Document references…", "Loading images");
    const cursor = this.#next ? `?after=${encodeURIComponent(this.#next.after)}&head=${this.#next.head}` : "";
    try {
      const response = await this.#fetch(`/api/experiences/${this.#policy}/references${cursor}`, this.#options(this.#listAbort.signal));
      const value: unknown = await response.json();
      if (!response.ok || jsonIssues(value).length || !record(value) || value.version !== 1 || value.scope !== "personal-document-references"
        || value.qualification !== "discovery-only" || !Number.isSafeInteger(value.head) || Number(value.head) < 0
        || this.#head !== undefined && this.#head !== value.head || !Array.isArray(value.candidates) || value.candidates.length > 20
        || value.next !== null && (!record(value.next) || value.next.head !== value.head || typeof value.next.after !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,239}\/(?:[A-Za-z0-9][A-Za-z0-9:_-]{0,239}|~)$/u.test(value.next.after))) throw Error("list_unavailable");
      const candidates = value.candidates.map(value => this.#policy === "video" ? readVideoReferenceCandidate(value) : readModel3dReferenceCandidate(value));
      if (candidates.some(item => !item) || new Set(candidates.map(item => item!.source.sourceBlockId)).size !== candidates.length
        || candidates.some(item => this.#entries.has(item!.source.sourceBlockId))) throw Error("list_unavailable");
      if (this.#disposed || epoch !== this.#listEpoch) return;
      this.#head = value.head as number; this.#next = value.next as { after: string; head: number } | null;
      for (const candidate of candidates as ReferenceCandidate[]) {
        const label = node("label"), input = node("input"), copy = node("span", candidate.label);
        input.type = "radio"; input.name = this.#text.name; input.value = candidate.source.sourceBlockId; copy.dir = "auto";
        label.append(input, copy); this.#choices.append(label); this.#entries.set(input.value, { candidate, control: input });
        input.addEventListener("change", () => { if (input.checked) this.#select(candidate); });
        if (this.#expectedSource && canonicalJson(candidate.source) === canonicalJson(this.#expectedSource) || this.#retained && sameSource(candidate, this.#retained)) {
          input.checked = true; this.#select(candidate, this.#retained); this.#retained = undefined;
        }
      }
      this.#browse.textContent = this.#next ? this.#copy("More Document references", "More images") : this.#copy("References loaded", "Images loaded");
      if (this.#awaitingDiscovery) this.#status.textContent = this.#copy("The selected source has not matched this fresh list. Read more references, or explicitly choose another source or Text only.", "Selected image unavailable");
      else if (!this.#candidate) this.#status.textContent = this.#retained ? this.#copy("The saved selection is not available on this page. Continue reading references or choose Text only.", "Saved image not listed") : candidates.length ? this.#copy("Choose one reference, or keep Text only. Files are checked only after selection.", "Select image") : this.#copy("No matching Document references on this page. Text only remains available.", "No images");
    } catch {
      if (!this.#disposed && epoch === this.#listEpoch) {
        this.#listFailed = true; this.#invalidateList(); this.#refresh.hidden = false;
        this.#browse.textContent = this.#copy("Reference list unavailable", "Images unavailable");
        this.#status.textContent = this.#copy("The reference list changed or is unavailable. Refresh this list without losing your authored text. The selected source must match and pass a fresh check before Save.", "Images changed · Refresh required");
      }
    } finally {
      if (!this.#disposed && epoch === this.#listEpoch) { this.#listBusy = false; this.#browse.setAttribute("aria-disabled", String(this.#listFailed || !this.#next && this.#head !== undefined)); this.#refresh.setAttribute("aria-disabled", "false"); }
    }
  }
  #select(candidate?: ReferenceCandidate, retained?: ReferenceIntent) {
    this.#sourceEpoch++; this.#sourceAbort.abort(); this.#sourceAbort = new AbortController();
    this.#checkEpoch++; this.#checkAbort.abort(); this.#checkAbort = new AbortController();
    this.#candidate = candidate; this.#retained = undefined; this.#sourceBusy = false;
    this.#expectedSource = undefined; this.#awaitingDiscovery = false;
    this.#previewReady = false; this.#inspectionReady = false; this.#permission.checked = Boolean(retained);
    this.#retireImage(); this.#selected.hidden = !candidate;
    if (!candidate) { this.#changed(null, this.#policy === "model3d"); this.#status.textContent = this.#copy("Text only. No reference will be saved.", "Image required"); return; }
    this.#caption.textContent = `${candidate.label} · ${"kind" in candidate.source && candidate.source.kind === "saved-model-view" ? "Saved 3D view" : "Image"}`;
    this.#changed(retained ?? null, false); void this.#readSelection();
  }
  #intent(): ReferenceIntent | null {
    if (!this.#candidate || !this.#permission.checked) return null;
    const value = { ...this.#candidate.source, permissionAttestation: "i-own-or-have-permission" as const };
    return this.#policy === "video" ? readVideoReferenceIntent(value) : readModel3dReferenceIntent(value);
  }
  #notify(ready: boolean) { this.#changed(this.#intent(), ready); }
  async #readSelection() {
    const candidate = this.#candidate; if (!candidate || this.#disposed || this.#sourceBusy || this.#awaitingDiscovery || this.#listFailed) return;
    const epoch = this.#sourceEpoch; this.#sourceBusy = true; this.#retry.setAttribute("aria-disabled", "true");
    this.#checkAbort.abort(); this.#checkAbort = new AbortController(); this.#checkEpoch++;
    this.#previewReady = false; this.#inspectionReady = false; this.#notify(false); this.#status.textContent = this.#copy("Reading the exact private image…", "Loading image");
    const lease = previewLease(this.#sourceAbort.signal);
    try {
      const request = this.#fetch(candidate.preview, this.#options(lease.signal));
      void request.then(response => {
        if (!lease.current() && response.body) cancelPreview(() => response.body!.cancel());
      }, () => undefined);
      const response = await lease.settle(request);
      const content = await previewBytes(response, candidate.source.sha256, lease, this.#maximumBytes);
      if (this.#disposed || epoch !== this.#sourceEpoch || this.#candidate !== candidate) return;
      this.#retireImage(); this.#url = URL.createObjectURL(new Blob([content.bytes], { type: content.mime }));
      this.#image.src = this.#url; this.#image.hidden = false;
      await lease.settle(this.#image.decode());
      if (this.#disposed || epoch !== this.#sourceEpoch || this.#candidate !== candidate) return;
      this.#previewReady = true; this.#settle();
      if (this.#permission.checked) void this.#inspect();
      else this.#status.textContent = this.#copy("Review this exact reference and confirm your permission to use it.", "Permission required");
    } catch {
      if (!this.#disposed && epoch === this.#sourceEpoch) { this.#retireImage(); this.#previewReady = false; this.#notify(false); this.#status.textContent = this.#copy("The exact private image is unavailable, changed or could not be displayed. Check it again or choose Text only.", "Image unavailable · Retry"); }
    } finally {
      lease.dispose();
      if (!this.#disposed && epoch === this.#sourceEpoch) { this.#sourceBusy = false; this.#retry.setAttribute("aria-disabled", "false"); }
    }
  }
  async #inspect() {
    const intent = this.#intent(); if (!intent || this.#disposed || this.#awaitingDiscovery || this.#listFailed) return;
    this.#checkAbort.abort(); this.#checkAbort = new AbortController(); const epoch = ++this.#checkEpoch;
    this.#inspectionReady = false; this.#notify(false); this.#status.textContent = this.#copy("Checking current source, permission records and private-file custody…", "Checking image");
    try {
      const response = await this.#fetch(`/api/experiences/${this.#policy}/reference/inspect`, { ...this.#options(this.#checkAbort.signal), method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent) });
      const value = await response.json();
      if (!response.ok || jsonIssues(value).length || !record(value) || value.version !== 1 || value.status !== "inspected" || value.generation !== "unavailable"
        || this.#policy === "video" && (value.persisted !== false || value.transferAuthorized !== false)
        || !record(value.inspection) || this.#policy === "video" && canonicalJson(value.inspection.intent) !== canonicalJson(EXPERIENCE_VIDEO_INTENT) || value.inspection.version !== 1 || value.inspection.qualification !== "read-only-reference-inspection"
        || canonicalJson(value.inspection.selection) !== canonicalJson(intent) || typeof value.inspection.sourceDigest !== "string"
        || !/^[a-f0-9]{64}$/u.test(value.inspection.sourceDigest) || !record(value.inspection.content)
        || value.inspection.content.sha256 !== intent.sha256 || !mimeTypes.includes(String(value.inspection.content.mimeType))
        || !Number.isSafeInteger(value.inspection.content.byteLength) || Number(value.inspection.content.byteLength) < 1 || Number(value.inspection.content.byteLength) > this.#maximumBytes) throw Error("inspection_unavailable");
      if (this.#disposed || epoch !== this.#checkEpoch || canonicalJson(this.#intent()) !== canonicalJson(intent)) return;
      this.#inspectionReady = true; this.#settle();
    } catch {
      if (!this.#disposed && epoch === this.#checkEpoch) { this.#inspectionReady = false; this.#notify(false); this.#status.textContent = this.#copy("The selected source cannot currently be used. Check its permissions and reference settings in Forma, or choose Text only.", "Image unavailable · Check permissions"); }
    }
  }
  #settle() {
    if (!this.#candidate || !this.#permission.checked || this.#awaitingDiscovery || this.#listFailed) return;
    const ready = this.#previewReady && this.#inspectionReady; this.#notify(ready);
    if (ready) this.#status.textContent = this.#copy("Exact image displayed and current source checked. Save checks again. This is your permission statement, not an approval or generation authorization.", "Image checked");
  }
  #retireImage() { this.#image.removeAttribute("src"); this.#image.hidden = true; if (this.#url) URL.revokeObjectURL(this.#url); this.#url = undefined; }
  dispose() {
    if (this.#disposed) return; this.#disposed = true; this.#listEpoch++; this.#sourceEpoch++; this.#checkEpoch++;
    this.#listAbort.abort(); this.#sourceAbort.abort(); this.#checkAbort.abort(); this.#retireImage();
  }
}


/** Existing3D policy remains the default public entry. */
export class Model3dReferencePicker extends ReferencePicker {
  constructor(changed: (selection: Model3dReferenceIntent | null, ready: boolean) => void, retained?: Model3dReferenceIntent, fetcher: Fetcher = fetch) {
    super((value, ready) => { const selection = readModel3dReferenceIntent(value); changed(selection, ready && (!value || Boolean(selection))); }, retained, fetcher, "model3d");
  }
}
/** Required ordinary image; Video's own closed intent and inspection endpoint. */
export class VideoReferencePicker extends ReferencePicker {
  constructor(changed: (selection: VideoReferenceIntent | null, ready: boolean) => void, retained?: VideoReferenceIntent, fetcher: Fetcher = fetch) {
    super((value, ready) => { const selection = readVideoReferenceIntent(value); changed(selection, ready && Boolean(selection)); }, retained, fetcher, "video");
  }
}

/** Exact saved image for review/recovery. GET-only; no inspection, permission,
 * ingestion, or generation is inferred from displaying previously selected bytes. */
export class VideoReferencePreview {
  readonly element = node("figure");
  #image = node("img");
  #status = node("p", "Image unavailable");
  #reload = node("button", "Reload image");
  #candidate: VideoReferenceCandidate | null = null;
  #abort = new AbortController();
  #fetch: Fetcher;
  #url?: string;
  #busy = false;
  #disposed = false;
  constructor(value: unknown, fetcher: Fetcher = fetch) {
    this.#fetch = (path, init) => fetcher(path, init);
    const reference = jsonIssues(value).length || !record(value) ? null : readVideoReferencePlan(value, value.selection);
    this.element.className = "experience-video-retained-image";
    this.#image.hidden = true; this.#image.alt = "Selected image";
    this.#status.setAttribute("role", "status"); this.#status.setAttribute("aria-live", "polite");
    this.#reload.type = "button"; this.#reload.className = "experience-button";
    this.#reload.addEventListener("click", () => void this.#read());
    this.element.append(this.#image);
    if (reference) {
      const { permissionAttestation: _, ...source } = reference.selection;
      const label = typeof reference.properties.label === "string" && reference.properties.label.trim() ? reference.properties.label : "Selected image";
      this.#candidate = readVideoReferenceCandidate({ source, label, preview: reference.properties.media_url });
      const caption = node("figcaption", label); caption.dir = "auto";
      const details = node("details"), hash = node("code", reference.selection.sha256);
      details.append(node("summary", "Image details"), node("p", "SHA-256"), hash);
      this.element.append(caption, details);
    }
    this.element.append(this.#status, this.#reload);
    if (!this.#candidate) this.#reload.hidden = true;
    else queueMicrotask(() => { if (!this.#disposed) void this.#read(); });
  }
  async #read() {
    if (this.#disposed || this.#busy || !this.#candidate) return;
    this.#busy = true; this.#reload.setAttribute("aria-disabled", "true");
    this.#retireImage(); this.#status.textContent = "Loading image";
    const lease = previewLease(this.#abort.signal);
    try {
      const pending = this.#fetch(this.#candidate.preview, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: lease.signal });
      void pending.then(response => { if (!lease.current() && response.body) cancelPreview(() => response.body!.cancel()); }, () => undefined);
      const response = await lease.settle(pending);
      const content = await previewBytes(response, this.#candidate.source.sha256, lease, 30 * 1024 * 1024);
      if (this.#disposed) return;
      this.#url = URL.createObjectURL(new Blob([content.bytes], { type: content.mime })); this.#image.src = this.#url;
      await lease.settle(this.#image.decode());
      if (this.#disposed) return;
      this.#image.hidden = false; this.#status.textContent = "";
    } catch {
      if (!this.#disposed) { this.#retireImage(); this.#status.textContent = "Image unavailable"; }
    } finally {
      lease.dispose(); this.#busy = false;
      if (!this.#disposed) this.#reload.setAttribute("aria-disabled", "false");
    }
  }
  #retireImage() { this.#image.removeAttribute("src"); this.#image.hidden = true; if (this.#url) URL.revokeObjectURL(this.#url); this.#url = undefined; }
  dispose() { if (this.#disposed) return; this.#disposed = true; this.#abort.abort(); this.#retireImage(); }
}
