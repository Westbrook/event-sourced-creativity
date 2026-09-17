import { validateSelectedOutputShareMediaPublicOutput, type SelectedOutputShareMediaPublicOutput } from "./model/selected-output-share.ts";
import { nativeRetainedAudioMediaUrl } from "./model/native-retained-audio.ts";

export type SelectedOutputShareMediaControls = Readonly<{ signal: AbortSignal; isCurrent: () => boolean }>;
declare const verifiedMedia: unique symbol;
/** Local byte integrity only. This handle grants no custody or publication authority. */
export type VerifiedSelectedOutputShareMedia = Readonly<{ [verifiedMedia]: true }>;
export type SelectedOutputShareReadMedia = (output: SelectedOutputShareMediaPublicOutput,
  controls: SelectedOutputShareMediaControls) => Promise<VerifiedSelectedOutputShareMedia>;
export type SelectedOutputShareMediaSource = Readonly<{ url: string; mimeType: string; byteLength: number; sha256: string }>;
type FileName = "forma-audio.wav" | "forma-video.mp4" | "forma-3d.glb";
type Access = Readonly<{ blob: Blob; fileName: FileName }>;
type Owned = { access: Access; signature: string; current: () => boolean; release: () => void };
const owned = new WeakMap<VerifiedSelectedOutputShareMedia, Owned>();
export const SELECTED_OUTPUT_SHARE_MEDIA_BUDGET_BYTES = 256 * 1024 * 1024;
export const SELECTED_OUTPUT_SHARE_MEDIA_READ_TIMEOUT_MS = 30_000;
let reservedBytes = 0;
const unavailable = () => new Error("selected_output_media_unavailable");
const fileName = (output: SelectedOutputShareMediaPublicOutput): FileName => output.output === "audio"
  ? "forma-audio.wav" : output.output === "video" ? "forma-video.mp4" : "forma-3d.glb";
function reserve(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 1 || reservedBytes + amount > SELECTED_OUTPUT_SHARE_MEDIA_BUDGET_BYTES)
    throw new Error("selected_output_media_capacity");
  reservedBytes += amount;
  let remaining = amount;
  return (release = remaining) => { const value = Math.min(remaining, Math.max(0, release)); remaining -= value; reservedBytes -= value; };
}
function captured(output: unknown) {
  const value = validateSelectedOutputShareMediaPublicOutput(output);
  if (!value) throw unavailable();
  return value;
}
function originValue(value: string) {
  const url = new URL(value);
  if (!/^https?:$/u.test(url.protocol) || url.origin !== value) throw unavailable();
  return value;
}
function safeCurrent(controls: SelectedOutputShareMediaControls) {
  try { return !controls.signal.aborted && controls.isCurrent() === true; } catch { return false; }
}
function sourceValue(source: SelectedOutputShareMediaSource, output: SelectedOutputShareMediaPublicOutput) {
  if (!source || typeof source !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(source))) throw unavailable();
  const keys = ["url", "mimeType", "byteLength", "sha256"], fields: Record<string, unknown> = {};
  if (Reflect.ownKeys(source).length !== keys.length) throw unavailable();
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(source, key);
    if (!property?.enumerable || !Object.hasOwn(property, "value")) throw unavailable();
    fields[key] = property.value;
  }
  const media = output.content.media, url = nativeRetainedAudioMediaUrl(fields.url);
  if (!url || fields.mimeType !== media.mimeType || fields.byteLength !== media.byteLength || fields.sha256 !== media.sha256) throw unavailable();
  return url;
}
function cancel(operation: (() => Promise<unknown>) | undefined) {
  try { if (operation) void operation().catch(() => undefined); } catch { /* Retirement never waits for cancellation. */ }
}

async function readFile(output: SelectedOutputShareMediaPublicOutput, url: URL, publicFile: boolean,
  controls: SelectedOutputShareMediaControls, request: typeof fetch): Promise<VerifiedSelectedOutputShareMedia> {
  const descriptor = output.content.media, signature = JSON.stringify(output), expiresAt = Date.parse(output.expiresAt);
  // A caller may still hold its JavaScript object despite the readonly type.
  // Bind the original lease identities for the whole read and retained handle.
  const sourceSignal = controls.signal, sourceCurrent = controls.isCurrent;
  const lease = Object.freeze({ signal: sourceSignal, isCurrent: () => sourceCurrent.call(controls) });
  const expiryDeadline = performance.now() + Math.max(0, expiresAt - Date.now());
  const current = () => safeCurrent(lease) && Date.now() < expiresAt && performance.now() < expiryDeadline;
  if (!current()) throw unavailable();
  // Account for the owned assembly, digest input snapshot and immutable Blob.
  // Cancellation does not release the digest's reservation before it settles.
  const release = reserve(descriptor.byteLength * 3), controller = new AbortController();
  const deadline = performance.now() + SELECTED_OUTPUT_SHARE_MEDIA_READ_TIMEOUT_MS;
  let stop!: (error: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => { stop = reject; });
  const abort = () => { controller.abort(); stop(unavailable()); };
  sourceSignal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, SELECTED_OUTPUT_SHARE_MEDIA_READ_TIMEOUT_MS);
  const check = () => { if (controller.signal.aborted || !current() || performance.now() >= deadline) throw unavailable(); };
  const settle = <T>(operation: Promise<T>) => Promise.race([operation, stopped]);
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bytes: Uint8Array<ArrayBuffer> | undefined, digestWork: Promise<ArrayBuffer> | undefined, complete = false, retained = false;
  try {
    check();
    const pending = request(url.href, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      referrerPolicy: "no-referrer", headers: { accept: descriptor.mimeType }, signal: controller.signal });
    void pending.then(late => { if (controller.signal.aborted || !current()) cancel(late.body ? () => late.body!.cancel() : undefined); }, () => undefined).catch(() => undefined);
    response = await settle(pending); check();
    if (response.status !== 200 || response.redirected || response.url !== url.href
      || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== descriptor.mimeType
      || response.headers.has("content-range") || !response.body) throw unavailable();
    const length = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
    const identity = encoding === null || encoding.trim().toLowerCase() === "identity";
    if (length !== null && (!/^[1-9][0-9]*$/u.test(length) || !Number.isSafeInteger(Number(length))
      || identity && Number(length) !== descriptor.byteLength)) throw unavailable();
    if (publicFile && (!identity || length !== String(descriptor.byteLength)
      || response.headers.get("content-disposition") !== `attachment; filename="${fileName(output)}"`)) throw unavailable();
    reader = response.body.getReader();
    bytes = new Uint8Array(descriptor.byteLength);
    let size = 0, chunks = 0;
    for (;;) {
      check(); const part = await settle(reader.read()); check();
      if (part.done) break;
      if (++chunks > 65_536 || !(part.value instanceof Uint8Array) || !part.value.byteLength
        || size + part.value.byteLength > bytes.byteLength) throw unavailable();
      bytes.set(part.value, size); size += part.value.byteLength;
    }
    complete = true;
    if (size !== descriptor.byteLength) throw unavailable();
    digestWork = crypto.subtle.digest("SHA-256", bytes);
    const digest = await settle(digestWork); check();
    const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    if (actual !== descriptor.sha256) throw unavailable();
    const blob = new Blob([bytes], { type: descriptor.mimeType }); check();
    const handle = Object.freeze({}) as VerifiedSelectedOutputShareMedia;
    release(descriptor.byteLength * 2);
    owned.set(handle, { access: Object.freeze({ blob, fileName: fileName(output) }), signature, current, release });
    retained = true;
    return handle;
  } finally {
    clearTimeout(timer); sourceSignal.removeEventListener("abort", abort); controller.abort();
    if (!complete) cancel(reader ? () => reader!.cancel() : response?.body ? () => response!.body!.cancel() : undefined);
    try { reader?.releaseLock(); } catch { /* A cancelled pending read may still own its lock. */ }
    bytes?.fill(0);
    if (!retained) {
      if (digestWork) void digestWork.then(() => release(), () => release());
      else release();
    }
  }
}

/** A trusted host binds this native path and receipt before calling. It never
 * accepts a URL from the public candidate and proves only exact local bytes. */
export async function readSelectedOutputShareSourceMedia(output: SelectedOutputShareMediaPublicOutput,
  source: SelectedOutputShareMediaSource, controls: SelectedOutputShareMediaControls & { origin: string; request?: typeof fetch }) {
  const selected = captured(output), origin = originValue(controls.origin), path = sourceValue(source, selected), url = new URL(path, origin);
  if (url.origin !== origin || url.pathname !== path || url.search || url.hash) throw unavailable();
  return readFile(selected, url, false, controls, controls.request ?? fetch);
}

/** A recipient can request only this exact token-bound file, never a native URL. */
export function createSelectedOutputShareTokenMediaReader(token: string, origin: string): SelectedOutputShareReadMedia {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/u.test(token)) throw unavailable();
  const url = new URL(`/api/selected-output-shared/${token}/file`, originValue(origin));
  return (output, controls) => readFile(captured(output), url, true, controls, fetch);
}

export function accessVerifiedSelectedOutputShareMedia(handle: unknown, output: SelectedOutputShareMediaPublicOutput): Access | null {
  try {
    const state = handle && typeof handle === "object" ? owned.get(handle as VerifiedSelectedOutputShareMedia) : undefined;
    if (!state || !state.current() || JSON.stringify(captured(output)) !== state.signature) return null;
    return state.access;
  } catch { return null; }
}
export function disposeVerifiedSelectedOutputShareMedia(handle: unknown): void {
  if (!handle || typeof handle !== "object") return;
  const state = owned.get(handle as VerifiedSelectedOutputShareMedia);
  if (!state) return;
  owned.delete(handle as VerifiedSelectedOutputShareMedia); state.release();
}

/** The caller's parse may not be abortable. Keep this copy reserved until its
 * actual completion, even after the handle/UI has been synchronously retired. */
export async function withVerifiedSelectedOutputShareMediaBytes<T>(handle: VerifiedSelectedOutputShareMedia,
  output: SelectedOutputShareMediaPublicOutput, operation: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>): Promise<T> {
  const access = accessVerifiedSelectedOutputShareMedia(handle, output);
  if (!access) throw unavailable();
  // The Blob stays live through arrayBuffer/parse even if its original handle
  // is disposed meanwhile. Reserve both that reference and the fresh copy.
  const release = reserve(access.blob.size * 2);
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = new Uint8Array(await access.blob.arrayBuffer());
    if (!accessVerifiedSelectedOutputShareMedia(handle, output)) throw unavailable();
    return await operation(bytes);
  } finally { bytes?.fill(0); release(); }
}
