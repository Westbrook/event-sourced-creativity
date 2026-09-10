import { composeFilmClips, FILM_COMPOSITION_MAX_CLIPS, type FilmClip, type FilmComposition } from "./film-composition.ts";
import { inspectVideoPrefix, VIDEO_PREFIX_TRIM_MAX_BYTES } from "./video-container.ts";
import type { OutputAssetRow } from "./output-delivery-contract.ts";

export type FilmCompositionDraftReason = "unavailable" | "rights" | "selection" | "bytes" | "unsupported" | "duration" | "superseded";
export type FilmCompositionDraftChoice = Readonly<{ id: string; name: string; byteLength: number; durationSeconds?: number }>;
export type FilmCompositionDraftAsset = Readonly<FilmCompositionDraftChoice & { sha256: string; sourceDigest: string; downloadUrl: string }>;
export type FilmCompositionDraftSnapshot = Readonly<{
  choices: readonly FilmCompositionDraftChoice[]; selectedIds: readonly string[]; rightsConfirmed: boolean;
  status: "idle" | "preparing" | "prepared" | "retired"; reason: FilmCompositionDraftReason | null;
}>;
export type FilmCompositionDraftContext = Readonly<{
  documentId: string; targetId: string; sourceRevision: string; contractKey: string; durationSeconds: number;
}>;
export type FilmCompositionDraftOptions = {
  context: FilmCompositionDraftContext; ready: true; assets: readonly OutputAssetRow[];
  current: () => boolean;
  download: (asset: FilmCompositionDraftAsset, signal: AbortSignal) => Promise<Blob | null>;
};
export type FilmCompositionDraftResult =
  | Readonly<{ status: "prepared"; film: FilmComposition; selectedAssetIds: readonly string[]; current: () => boolean }>
  | Readonly<{ status: "refused" | "superseded"; reason: FilmCompositionDraftReason }>;
const MAX_CHOICES = 256;
const identity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
function check(value: unknown): asserts value { if (!value) throw new TypeError("Unavailable Film draft input"); }
function record(value: unknown): asserts value is object {
  check(value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  check(descriptor?.enumerable && Object.hasOwn(descriptor, "value")); return descriptor.value;
}
function captureContext(input: unknown): FilmCompositionDraftContext {
  record(input);
  const documentId = own(input, "documentId"), targetId = own(input, "targetId"), sourceRevision = own(input, "sourceRevision");
  const contractKey = own(input, "contractKey"), durationSeconds = own(input, "durationSeconds");
  check(identity(documentId) && identity(targetId) && identity(sourceRevision));
  check(typeof contractKey === "string" && contractKey.trim() && contractKey.length <= 32768);
  check(positive(durationSeconds) && durationSeconds <= 21600);
  return Object.freeze({ documentId, targetId, sourceRevision, contractKey, durationSeconds });
}
function captureAsset(input: unknown, context: FilmCompositionDraftContext): FilmCompositionDraftAsset {
  record(input);
  const id = own(input, "id"), name = own(input, "name"), byteLength = own(input, "byteLength"), sha256 = own(input, "sha256");
  const sourceDigest = own(input, "sourceDigest"), downloadUrl = own(input, "downloadUrl");
  check(identity(id) && typeof name === "string" && name.trim() && new TextEncoder().encode(name).length <= 180);
  check(Number.isSafeInteger(byteLength) && typeof byteLength === "number" && byteLength > 0 && byteLength <= VIDEO_PREFIX_TRIM_MAX_BYTES);
  check(hash(sha256) && sourceDigest === context.sourceRevision);
  check(own(input, "available") === true && own(input, "mediaKind") === "video" && own(input, "mimeType") === "video/mp4");
  check(typeof downloadUrl === "string" && downloadUrl === `/api/output-requirements/assets/${encodeURIComponent(id)}?documentId=${encodeURIComponent(context.documentId)}`);
  const inspection = own(input, "inspection"); record(inspection);
  check(own(inspection, "status") === "inspected" && own(inspection, "kind") === "video" && own(inspection, "mimeType") === "video/mp4"
    && own(inspection, "sha256") === sha256 && own(inspection, "byteLength") === byteLength);
  const facts = own(inspection, "facts"); record(facts);
  const descriptor = Object.getOwnPropertyDescriptor(facts, "durationSeconds");
  check(!descriptor || Object.hasOwn(descriptor, "value"));
  const durationSeconds: unknown = descriptor?.value;
  check(durationSeconds === undefined || positive(durationSeconds) && durationSeconds <= 21600);
  return Object.freeze({ id, name, byteLength, sha256, sourceDigest, downloadUrl,
    ...(typeof durationSeconds === "number" ? { durationSeconds } : {}) });
}

/** Eligibility for a local choice list only; the host still owns authorization. */
export function isFilmCompositionDraftAsset(input: unknown, context: FilmCompositionDraftContext): boolean {
  try { captureAsset(input, captureContext(context)); return true; } catch { return false; }
}

/** Local preparation only. The host owns permissions and the complete current
 * source/route/private-revision/target contract. Metadata never grants authority.
 * The returned bytes are temporary: copy into a File while current, then retire.
 */
class Draft {
  #assets: readonly FilmCompositionDraftAsset[];
  #selected: string[] = [];
  #rights = false;
  #epoch = 0;
  #retired = false;
  #status: FilmCompositionDraftSnapshot["status"] = "idle";
  #reason: FilmCompositionDraftReason | null = null;
  #operation: { epoch: number; abort: AbortController } | null = null;
  #prepared: FilmComposition | null = null;
  private readonly context: FilmCompositionDraftContext;
  private readonly hostCurrent: () => boolean;
  private readonly download: FilmCompositionDraftOptions["download"];
  constructor(context: FilmCompositionDraftContext, assets: readonly FilmCompositionDraftAsset[], hostCurrent: () => boolean, download: FilmCompositionDraftOptions["download"]) {
    this.context = context; this.#assets = assets; this.hostCurrent = hostCurrent; this.download = download;
  }
  #alive(): boolean {
    if (this.#retired) return false;
    try { if (this.hostCurrent() === true && !this.#retired) return true; } catch { /* A failed owner check never permits work. */ }
    this.retire(); return false;
  }
  #clear() {
    this.#epoch++; this.#operation?.abort.abort(); this.#operation = null;
    this.#prepared?.bytes.fill(0); this.#prepared = null; this.#status = "idle"; this.#reason = null;
  }
  #edited() { this.#clear(); this.#rights = false; }
  snapshot(): FilmCompositionDraftSnapshot {
    this.#alive();
    return Object.freeze({ choices: Object.freeze(this.#assets.map(({ id, name, byteLength, durationSeconds }) => Object.freeze({ id, name, byteLength,
      ...(durationSeconds === undefined ? {} : { durationSeconds }) }))), selectedIds: Object.freeze([...this.#selected]),
      rightsConfirmed: this.#rights, status: this.#status, reason: this.#reason });
  }
  add(id: string): boolean {
    if (!this.#alive() || this.#selected.includes(id)) return false;
    const asset = this.#assets.find(value => value.id === id);
    if (!asset || this.#selected.length >= FILM_COMPOSITION_MAX_CLIPS) { this.#reason = "selection"; return false; }
    const total = this.#selected.reduce((sum, key) => sum + this.#assets.find(value => value.id === key)!.byteLength, asset.byteLength);
    if (total > VIDEO_PREFIX_TRIM_MAX_BYTES) { this.#reason = "bytes"; return false; }
    this.#edited(); this.#selected.push(id); return true;
  }
  remove(id: string): boolean {
    if (!this.#alive()) return false;
    const index = this.#selected.indexOf(id); if (index < 0) return false;
    this.#edited(); this.#selected.splice(index, 1); return true;
  }
  move(id: string, direction: -1 | 1): boolean {
    if (!this.#alive() || direction !== -1 && direction !== 1) return false;
    const from = this.#selected.indexOf(id), to = from + direction;
    if (from < 0 || to < 0 || to >= this.#selected.length) return false;
    this.#edited(); [this.#selected[from], this.#selected[to]] = [this.#selected[to]!, this.#selected[from]!]; return true;
  }
  setRightsConfirmed(value: boolean): boolean {
    if (!this.#alive() || typeof value !== "boolean") return false;
    if (value !== this.#rights) { this.#clear(); this.#rights = value; }
    return true;
  }
  retire(): void {
    if (this.#retired) return;
    this.#clear(); this.#retired = true; this.#rights = false; this.#selected = []; this.#assets = [];
    this.#status = "retired"; this.#reason = "superseded";
  }
  async prepare(): Promise<FilmCompositionDraftResult> {
    if (!this.#alive()) return { status: "superseded", reason: "superseded" };
    if (this.#status === "preparing") return { status: "refused", reason: "unavailable" };
    if (!this.#rights) { this.#reason = "rights"; return { status: "refused", reason: "rights" }; }
    if (this.#selected.length < 2 || this.#selected.length > FILM_COMPOSITION_MAX_CLIPS) {
      this.#reason = "selection"; return { status: "refused", reason: "selection" };
    }
    this.#clear();
    const operation = { epoch: this.#epoch, abort: new AbortController() }, selected = Object.freeze([...this.#selected]);
    const assets = selected.map(id => this.#assets.find(asset => asset.id === id)!);
    this.#operation = operation; this.#status = "preparing";
    const current = () => this.#alive() && this.#operation === operation && this.#epoch === operation.epoch
      && !operation.abort.signal.aborted && this.#rights && selected.every((id, index) => id === this.#selected[index]) && selected.length === this.#selected.length;
    const clips: FilmClip[] = [];
    const fail = (reason: FilmCompositionDraftReason): FilmCompositionDraftResult => {
      if (!current()) return { status: "superseded", reason: "superseded" };
      this.#status = "idle"; this.#reason = reason; this.#operation = null; operation.abort.abort();
      return { status: "refused", reason };
    };
    let timescale = 0, totalBytes = 0, totalTicks = 0;
    try {
      for (const [index, asset] of assets.entries()) {
        if (!current()) return { status: "superseded", reason: "superseded" };
        const blob = await this.download(asset, operation.abort.signal);
        if (!current()) return { status: "superseded", reason: "superseded" };
        if (!(blob instanceof Blob)) return fail("unavailable");
        const size: number = Object.getOwnPropertyDescriptor(Blob.prototype, "size")!.get!.call(blob);
        if (size !== asset.byteLength || totalBytes + size > VIDEO_PREFIX_TRIM_MAX_BYTES) return fail("bytes");
        const buffer = await Blob.prototype.arrayBuffer.call(blob);
        const bytes = new Uint8Array(buffer);
        if (!current()) { bytes.fill(0); return { status: "superseded", reason: "superseded" }; }
        totalBytes += bytes.byteLength;
        if (bytes.byteLength !== size || totalBytes > VIDEO_PREFIX_TRIM_MAX_BYTES) { bytes.fill(0); return fail("bytes"); }
        // Slot IDs are local composition identities; selectedAssetIds retains the
        // exact ordered Output asset identities, including permitted ':' IDs.
        clips.push({ id: `clip-${index + 1}`, bytes, sha256: asset.sha256 });
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        if (!current()) return { status: "superseded", reason: "superseded" };
        if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") !== asset.sha256) return fail("bytes");
        const info = await inspectVideoPrefix(bytes);
        if (!current()) return { status: "superseded", reason: "superseded" };
        if (!info || info.sourceSha256 !== asset.sha256) return fail("unsupported");
        if (!timescale) timescale = info.timescale;
        if (info.timescale !== timescale) return fail("unsupported");
        totalTicks += info.durationTicks;
        if (!Number.isSafeInteger(totalTicks) || totalTicks > 0xffffffff) return fail("duration");
      }
      const durationTicks = this.context.durationSeconds * timescale;
      if (!Number.isSafeInteger(durationTicks) || durationTicks < 1 || durationTicks > 0xffffffff || durationTicks !== totalTicks) return fail("duration");
      if (!current()) return { status: "superseded", reason: "superseded" };
      const film = await composeFilmClips(clips, { timescale, durationTicks });
      if (!current()) { film?.bytes.fill(0); return { status: "superseded", reason: "superseded" }; }
      if (!film) return fail("unsupported");
      if (film.info.durationTicks !== durationTicks || film.info.timescale !== timescale) { film.bytes.fill(0); return fail("duration"); }
      this.#prepared = film; this.#status = "prepared";
      return Object.freeze({ status: "prepared", film, selectedAssetIds: selected, current });
    } catch { return fail("unavailable"); }
    finally { for (const clip of clips) clip.bytes.fill(0); }
  }
}
export type FilmCompositionDraft = Draft;
export function createFilmCompositionDraft(options: FilmCompositionDraftOptions): FilmCompositionDraft | null {
  try {
    record(options);
    const ready = own(options, "ready"), current = own(options, "current"), download = own(options, "download");
    check(ready === true && typeof current === "function" && typeof download === "function" && current() === true);
    const context = captureContext(own(options, "context")), input = own(options, "assets");
    check(Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype);
    const length: unknown = Object.getOwnPropertyDescriptor(input, "length")!.value;
    check(typeof length === "number" && length >= 0 && length <= MAX_CHOICES);
    const assets: FilmCompositionDraftAsset[] = [], ids = new Set<string>();
    for (let index = 0; index < length; index++) {
      const row = Object.getOwnPropertyDescriptor(input, String(index)); check(row && Object.hasOwn(row, "value"));
      const asset = captureAsset(row.value, context); check(!ids.has(asset.id)); ids.add(asset.id); assets.push(asset);
    }
    check(current() === true);
    return new Draft(context, Object.freeze(assets), current as () => boolean, download as FilmCompositionDraftOptions["download"]);
  } catch { return null; }
}
