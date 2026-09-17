import { nativeRetainedMediaCustodySnapshot, nativeRetainedMediaCustodySignal,
  assertNativeRetainedMediaCustody, copyNativeRetainedMediaOriginalVideoBytes,
  type NativeRetainedMediaCustody, type NativeRetainedMediaSnapshot } from "./native-retained-media-custody.ts";
import { unavailable } from "./native-retained-text-custody.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import { MAX_MODEL3D_UPLOAD_BYTES } from "../src/model/model3d-assets.ts";
import { inspectPcmWav } from "../src/model/audio-container.ts";
import { inspectVideoPrefix } from "../src/model/video-container.ts";
import { scaleModel3dGeometry } from "../src/model/model3d-geometry-edit.ts";
import { parseAudioTrimOperationRequest } from "../src/model/audio-local-conversion.ts";
import { parseVideoTrimEditRequest } from "../src/model/document-artifacts.ts";
import { parseModel3dScaleEditRequest } from "../src/model/model3d-artifact-revision.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { qualifySelectedOutputShareAudio } from "../src/model/selected-output-share-audio.ts";
import { qualifySelectedOutputShareVideo, qualifySelectedOutputShareVideoWithX264Declaration,
  SELECTED_OUTPUT_SHARE_VIDEO_POLICY } from "../src/model/selected-output-share-video.ts";
import { qualifySelectedOutputShareModel3d, qualifySelectedOutputShareTexturedModel3d,
  SELECTED_OUTPUT_SHARE_MODEL3D_POLICY } from "../src/model/selected-output-share-model3d.ts";
import { attachSelectedOutputShareMedia, copySelectedOutputShareMediaBytes,
  type SelectedOutputShareMediaAttachment, type SelectedOutputShareMediaDescriptor } from "../src/model/selected-output-share-media.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Finite local observation; this capability expires, and grants no publication permission. */
export const NATIVE_RETAINED_MEDIA_BYTES_BUDGET_MS = 30_000;
declare const nativeBytes: unique symbol;
export type NativeRetainedMediaBytes = Readonly<{ [nativeBytes]: true; descriptor: SelectedOutputShareMediaDescriptor }>;
type Budget = { env: WorkerEnv; custody: NativeRetainedMediaCustody;
  signal: AbortSignal; monotonicDeadline: number; wallDeadline: number; rightsDeadline: number };
type State = Budget & { attachment: SelectedOutputShareMediaAttachment };
const observations = new WeakMap<NativeRetainedMediaBytes, State>();
const hash = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  byte => byte.toString(16).padStart(2, "0")).join("");
const textHash = (value: unknown) => hash(new TextEncoder().encode(JSON.stringify(value)));
function current(value: Budget) {
  if (value.signal.aborted || performance.now() >= value.monotonicDeadline || Date.now() >= value.wallDeadline
    || Date.now() >= value.rightsDeadline) throw unavailable();
  nativeRetainedMediaCustodySnapshot(value.custody, value.env);
}
/** The operation itself is raced: cancellation never waits on an unresponsive stream. */
async function bounded<T>(value: Budget, operation: () => Promise<T>): Promise<T> {
  current(value);
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  const pending = operation();
  const stop = new Promise<never>((_, reject) => {
    abort = () => reject(unavailable());
    value.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, Math.max(0, Math.min(value.monotonicDeadline - performance.now(), value.wallDeadline - Date.now(), value.rightsDeadline - Date.now())));
    if (value.signal.aborted) abort();
  });
  try { const result = await Promise.race([pending, stop]); current(value); return result; }
  finally { clearTimeout(timer); if (abort) value.signal.removeEventListener("abort", abort); void pending.catch(() => {}); }
}
function keyOf(snapshot: NativeRetainedMediaSnapshot) {
  const { url, mimeType } = snapshot.media;
  if (!url.startsWith("/api/media/")) throw unavailable();
  const key = decodeURIComponent(url.slice("/api/media/".length));
  const suffix = mimeType === "audio/wav" ? ".wav" : mimeType === "video/mp4" ? ".mp4" : ".glb";
  if (url !== `/api/media/${encodeURIComponent(key)}` || !key.startsWith(`${ownerMediaNamespace(snapshot.identity.userId)}/generated/`)
    || !key.endsWith(suffix) || /[\p{Cc}\\]/u.test(key) || key.split("/").some(part => part === "." || part === "..")) throw unavailable();
  return key;
}
async function authoredMetadata(value: Budget, snapshot: NativeRetainedMediaSnapshot, metadata: Record<string, string>) {
  const { audioRevision: audio, videoRevision: video, model3dRevision: model } = snapshot.media;
  if (!audio && !video && !model) return;
  const revision = audio ?? video ?? model!;
  const expected = audio ? parseAudioTrimOperationRequest({ expectedRevision: audio.source.revision, expectedContentSha256: audio.source.contentSha256,
    audioTrim: { sourceMediaSha256: audio.source.sha256, sourceFrameCount: audio.source.frameCount,
      startFrame: audio.startFrame, endFrame: audio.endFrame, resultMediaSha256: audio.media.sha256,
      ...(audio.conversion ? { conversion: audio.conversion } : {}) } })
    : video ? parseVideoTrimEditRequest({ expectedRevision: video.source.revision, expectedContentSha256: video.source.contentSha256,
      videoTrim: { sourceMediaSha256: video.source.sha256, sourceSampleCount: video.source.sampleCount, startSample: 0,
        endSample: video.endSample, resultMediaSha256: video.media.sha256 } })
      : parseModel3dScaleEditRequest({ expectedRevision: model!.source.revision, expectedContentSha256: model!.source.contentSha256,
        model3dScale: { sourceMediaSha256: model!.source.sha256, factor: model!.factor, resultMediaSha256: model!.media.sha256 } });
  if (!expected || metadata.source !== `authored-${audio ? "audio" : video ? "video" : "model3d"}-edit`
    || metadata.artifactId !== snapshot.selection.artifactId || metadata.sourceMediaSha256 !== revision.source.sha256
    || metadata.sourceRevision !== String(revision.source.revision)
    || metadata.requestSha256 !== await bounded(value, () => textHash(expected))) throw unavailable();
  if (audio?.conversion && (metadata.conversionProvenance !== "client-local" || metadata.decodedMediaSha256 !== audio.conversion.decodedMediaSha256)) throw unavailable();
  if (video && (["durationSeconds", "sampleCount", "timescale", "durationTicks", "width", "height"] as const)
    .some(key => metadata[key] !== String(video[key]))) throw unavailable();
}
/** Exactly one R2 get for ordinary current bytes; original Outputs Video takes
 * the already inspected native buffer and never falls back to this path. */
async function readOwnedBytes(value: Budget, snapshot: NativeRetainedMediaSnapshot): Promise<Uint8Array<ArrayBuffer>> {
  let body: ReadableStream<Uint8Array> | null = null, reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let complete = false, active = true;
  const release = () => { try { reader?.releaseLock(); } catch { /* Pending reads are already raced and observed. */ } };
  const cancel = () => { try { const pending = reader ? reader.cancel() : body?.cancel(); if (pending) void pending.catch(() => {}); } catch { /* Never block. */ } release(); };
  const pendingObject = value.env.MEDIA.get(keyOf(snapshot));
  void pendingObject.then(object => { body = object?.body ?? null; if (!active) cancel(); }, () => {});
  try {
    const object = await bounded(value, () => pendingObject); body = object?.body ?? null;
    const metadata = object?.customMetadata ? Object.freeze({ ...object.customMetadata }) : null, size = object?.size;
    const cap = snapshot.selection.output === "model3d" ? MAX_MODEL3D_UPLOAD_BYTES : MAX_OUTPUT_ASSET_BYTES;
    if (!object || !body || !metadata || metadata.ownerId !== snapshot.identity.userId || metadata.projectAccessId
      || metadata.sha256 !== snapshot.media.sha256 || metadata.mimeType !== snapshot.media.mimeType
      || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > cap
      || snapshot.media.byteLength !== null && size !== snapshot.media.byteLength) throw unavailable();
    const headers = new Headers(); object.writeHttpMetadata(headers);
    if (headers.get("content-type") !== snapshot.media.mimeType) throw unavailable();
    await authoredMetadata(value, snapshot, metadata);
    if (snapshot.selection.output === "model3d") {
      if (metadata.modelFormat !== "glb" || metadata.modelPreviewSafe === "false"
        || !snapshot.media.model3dRevision && metadata.rights !== "asserted" && metadata.source !== "provider-generated-media") throw unavailable();
      const rights = creativeContextRightsValidity(metadata);
      if (rights.issue || ["revoked", "denied", "unlicensed"].includes(metadata.rights ?? "")) throw unavailable();
      if (rights.validUntil) value.rightsDeadline = Date.parse(rights.validUntil);
      current(value);
    }
    const bytes = new Uint8Array(size); reader = body.getReader(); let offset = 0, chunks = 0;
    while (true) {
      const next = await bounded(value, () => reader!.read());
      if (next.done) { complete = offset === size; break; }
      if (!(next.value instanceof Uint8Array) || ++chunks > 65_536 || next.value.byteLength > size - offset) throw unavailable();
      bytes.set(next.value, offset); offset += next.value.byteLength;
    }
    if (!complete || await bounded(value, () => hash(bytes)) !== snapshot.media.sha256) throw unavailable();
    return bytes;
  } finally { active = false; if (!complete) cancel(); else release(); }
}
async function authoredByteFacts(value: Budget, snapshot: NativeRetainedMediaSnapshot, bytes: Uint8Array<ArrayBuffer>) {
  const { audioRevision: audio, videoRevision: video, model3dRevision: model } = snapshot.media;
  if (audio) {
    const info = inspectPcmWav(bytes);
    if (!info || info.frameCount !== audio.frameCount || info.sampleRate !== audio.sampleRate || info.channels !== audio.channels) throw unavailable();
  }
  if (video) {
    const info = await bounded(value, () => inspectVideoPrefix(bytes));
    if (!info || (["sampleCount", "timescale", "durationTicks", "width", "height"] as const).some(key => info[key] !== video[key])) throw unavailable();
  }
  if (model) {
    // This inspection's temporary scale-1 copy is never returned or stored.
    const geometry = scaleModel3dGeometry(bytes, 1);
    if (geometry.vertexCount !== model.vertexCount || geometry.positionAccessorCount !== model.positionAccessorCount
      || JSON.stringify(geometry.beforeBounds) !== JSON.stringify(model.afterBounds)) throw unavailable();
  }
}
/** Private read/qualification only. No Request, caller key, published source,
 * owner impersonation, recovery/reconciliation, data write or lifecycle action.
 * Native identity/selection/content stay opaque through final current rejoin. */
export async function readNativeRetainedMediaBytes(custody: NativeRetainedMediaCustody, env: WorkerEnv): Promise<NativeRetainedMediaBytes> {
  const snapshot = nativeRetainedMediaCustodySnapshot(custody, env), signal = nativeRetainedMediaCustodySignal(custody, env);
  const budget: Budget = { env, custody, signal,
    monotonicDeadline: performance.now() + NATIVE_RETAINED_MEDIA_BYTES_BUDGET_MS,
    wallDeadline: Date.now() + NATIVE_RETAINED_MEDIA_BYTES_BUDGET_MS, rightsDeadline: Infinity };
  // The budget applies to this entire byte operation, including hashes and final SQL.
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  try {
    await bounded(budget, () => assertNativeRetainedMediaCustody(custody, env));
    bytes = snapshot.media.readMode === "native-output-video" ? copyNativeRetainedMediaOriginalVideoBytes(custody, env) : await readOwnedBytes(budget, snapshot);
    if (!bytes) throw unavailable();
    current(budget); await authoredByteFacts(budget, snapshot, bytes); current(budget);
    const expected = Object.freeze({ sha256: snapshot.media.sha256, byteLength: bytes.length });
    let qualification: unknown;
    if (snapshot.selection.output === "audio") qualification = await bounded(budget,
      () => qualifySelectedOutputShareAudio(bytes, { ...expected, mimeType: "audio/wav" }));
    else if (snapshot.selection.output === "video") {
      const inspected = await bounded(budget, () => inspectOutputAsset(bytes!, "video.mp4", { snapshot: false }));
      if (inspected.status !== "inspected" || inspected.kind !== "video" || inspected.sha256 !== expected.sha256
        || !inspected.facts.width || !inspected.facts.height || !inspected.facts.durationSeconds) throw unavailable();
      const facts = Object.freeze({ ...expected, width: inspected.facts.width, height: inspected.facts.height, durationSeconds: inspected.facts.durationSeconds });
      qualification = await bounded<unknown>(budget, () => snapshot.selection.policy === SELECTED_OUTPUT_SHARE_VIDEO_POLICY
        ? qualifySelectedOutputShareVideo(bytes, facts) : qualifySelectedOutputShareVideoWithX264Declaration(bytes, facts));
    } else qualification = await bounded<unknown>(budget, () => snapshot.selection.policy === SELECTED_OUTPUT_SHARE_MODEL3D_POLICY
      ? qualifySelectedOutputShareModel3d(bytes, expected) : qualifySelectedOutputShareTexturedModel3d(bytes, expected));
    const attachment = attachSelectedOutputShareMedia(snapshot.selection, qualification);
    if (!attachment) throw unavailable();
    await bounded(budget, () => assertNativeRetainedMediaCustody(custody, env));
    const result = Object.freeze({ descriptor: attachment.descriptor }) as NativeRetainedMediaBytes;
    observations.set(result, { ...budget, attachment }); return result;
  } finally { bytes?.fill(0); }
}
/** Fresh exact bytes only after a new complete native current-selection check.
 * No sync accessor exposes a stale observation. The same finite read budget and
 * captured signal/DB/storage/identity/selection/rights boundaries still apply. */
export async function copyCurrentNativeRetainedMediaBytes(proof: NativeRetainedMediaBytes, env: WorkerEnv): Promise<Uint8Array<ArrayBuffer>> {
  const value = observations.get(proof);
  if (!value || value.env !== env) throw unavailable();
  await bounded(value, () => assertNativeRetainedMediaCustody(value.custody, env));
  const bytes = copySelectedOutputShareMediaBytes(value.attachment);
  current(value);
  if (!bytes) throw unavailable();
  return bytes;
}

/** After a separately executed final publication/share SELECT, synchronously
 * recheck this exact local byte observation's environment, signal and lifetimes.
 * This neither executes SQL nor grants publication authority or copies bytes. */
export function assertNativeRetainedMediaBytesCurrent(proof: NativeRetainedMediaBytes, env: WorkerEnv): void {
  const value = observations.get(proof);
  if (!value || value.env !== env) throw unavailable();
  current(value);
}
