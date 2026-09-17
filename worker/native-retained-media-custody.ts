import { principalAccessFromRow } from "./access-policy.ts";
import { bytes, hash, eventCte, nativeRetainedSourceFinalGuard, opaque, readNativeRetainedContent,
  readNativeRetainedPrincipal, readNativeRetainedSelection, record, unavailable, Unavailable,
  type NativeRetainedIdentity } from "./native-retained-text-custody.ts";
import { nativeRetainedMediaReceiptReaders as readers } from "./retained-story-api.ts";
import { readRetainedOutputVideo, copyRetainedOutputVideoBytes } from "./output-video-retained.ts";
import { readRetainedOutputModel3d } from "./output-model3d-retained.ts";
import { captureExperienceVideoEvidence } from "../src/experiences/video-native-result.ts";
import { projectNativeRetainedOutput, type NativeRetainedOutputDto } from "../src/model/native-retained-output.ts";
import { selectRetainedModel3dEditFile } from "../src/model/native-retained-model3d.ts";
import { parseSelectedOutputShareMediaSelection, type SelectedOutputShareMediaSelection } from "../src/model/selected-output-share-media.ts";
import type { AudioMediaRevision, VideoMediaRevision } from "../src/model/document-artifacts.ts";
import type { Model3dMediaRevision } from "../src/model/model3d-media-revision.ts";
import type { WorkerEnv } from "./runtime.ts";

type SqlValue = string | number | null;
/** Complete native SELECT, suitable for sibling MATERIALIZED proof composition.
 * These fixed queries are produced internally, never supplied by a requester. */
export type NativeRetainedMediaAssertion = Readonly<{ sql: string; bindings: readonly SqlValue[] }>;
export type NativeRetainedMediaAsset = Readonly<{
  url: string; mimeType: "audio/wav" | "video/mp4" | "model/gltf-binary";
  sha256: string; byteLength: number | null;
  readMode: "owned-media" | "native-output-video";
  audioRevision: AudioMediaRevision | null;
  videoRevision: VideoMediaRevision | null;
  model3dRevision: Model3dMediaRevision | null;
}>;
export type NativeRetainedMediaSnapshot = Readonly<{
  identity: NativeRetainedIdentity;
  selection: SelectedOutputShareMediaSelection;
  projectId: string; contentId: string; completionId: string;
  sourceExpiresAt: string; expiresAt: string; authSnapshot: string;
  /** Private native DTO. Never a public serializer or publication permission. */
  dto: NativeRetainedOutputDto;
  media: NativeRetainedMediaAsset;
  /** Issued only after the actual completed original native proof. This is a
   * private relation between observed selections, never publishing authority. */
  nativeOriginal: Readonly<{
    output: "video" | "model3d"; relation: "selected-original" | "selected-restored-original";
    originalRevision: 0; originalContentSha256: string;
    selectedRevision: number; selectedContentSha256: string;
    mediaSha256: string; mediaByteLength: number;
  }> | null;
}>;
declare const mediaCustody: unique symbol;
export type NativeRetainedMediaCustody = Readonly<{ [mediaCustody]: true }>;
type State = {
  env: WorkerEnv; database: WorkerEnv["DB"]; media: WorkerEnv["MEDIA"];
  cohort: WorkerEnv["FORMA_PILOT_COHORT_ID"]; administrators: WorkerEnv["FORMA_ADMIN_EMAILS"];
  signal: AbortSignal; snapshot: NativeRetainedMediaSnapshot; assertion: NativeRetainedMediaAssertion;
  originalVideo: Awaited<ReturnType<typeof readRetainedOutputVideo>> | null;
};
const custodies = new WeakMap<NativeRetainedMediaCustody, State>();
const digest = /^[a-f0-9]{64}$/u;
const timestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function captureIdentity(value: NativeRetainedIdentity): NativeRetainedIdentity {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const names = Reflect.ownKeys(value), keys = ["userId", "email", "source"];
  if (names.length !== 3 || names.some(name => typeof name !== "string" || !keys.includes(name))) throw unavailable();
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) throw unavailable();
    captured[key] = field.value;
  }
  if (typeof captured.userId !== "string" || !captured.userId || bytes(captured.userId) > 240
    || typeof captured.email !== "string" || !captured.email || bytes(captured.email) > 320
    || captured.email !== captured.email.toLowerCase() || /[\0-\u0020\u007f]/u.test(captured.userId + captured.email)
    || captured.source !== "openai-workspace") throw unavailable();
  return Object.freeze(captured) as NativeRetainedIdentity;
}
function state(proof: NativeRetainedMediaCustody, env: WorkerEnv): State {
  const value = custodies.get(proof);
  if (!value || value.env !== env || value.database !== env.DB || value.media !== env.MEDIA
    || value.cohort !== env.FORMA_PILOT_COHORT_ID || value.administrators !== env.FORMA_ADMIN_EMAILS
    || value.signal.aborted || Date.parse(value.snapshot.expiresAt) <= Date.now()) throw unavailable();
  return value;
}

/** Internal current-media observation. Identity comes from an actual hosted
 * principal or independently verified purpose record, never forged headers.
 * This retains native current receipts/edits and original-only read boundaries;
 * it neither proves actor-paid publishing provenance nor creates a share.
 */
export async function readNativeRetainedMediaCustody(env: WorkerEnv, identity: NativeRetainedIdentity,
  selection: SelectedOutputShareMediaSelection, signal: AbortSignal): Promise<NativeRetainedMediaCustody> {
  const database = env.DB, media = env.MEDIA, cohort = env.FORMA_PILOT_COHORT_ID, administrators = env.FORMA_ADMIN_EMAILS;
  const stable = () => {
    if (!(signal instanceof AbortSignal) || signal.aborted || database !== env.DB || media !== env.MEDIA
      || cohort !== env.FORMA_PILOT_COHORT_ID || administrators !== env.FORMA_ADMIN_EMAILS) throw unavailable();
  };
  stable();
  const actor = captureIdentity(identity), selected = parseSelectedOutputShareMediaSelection(selection);
  if (!selected) throw unavailable();
  const { auth, principal, observed, role } = await readNativeRetainedPrincipal(env, actor); stable();
  // Same stricter identity-policy observation as the existing text custody adapter.
  const publicAccess = await principalAccessFromRow(observed, role); stable();
  if (publicAccess.identityPolicyDeniedCustody) throw new Unavailable("retained_story_access_denied");
  const { snapshot, native } = await readNativeRetainedSelection(env, actor, selected, selected.output); stable();
  const audio = selected.output === "audio" ? await readers.audio.receipt(env, native, actor.userId, selected) : null; stable();
  const video = selected.output === "video" ? await readers.video.receipt(env, native, actor.userId, selected) : null; stable();
  const model3d = selected.output === "model3d" ? await readers.model3d.receipt(env, native, actor.userId, selected) : null; stable();
  const { contentBindings, source, body } = await readNativeRetainedContent(env, actor, selected, native); stable();
  let originalVideo: Awaited<ReturnType<typeof readRetainedOutputVideo>> | null = null;
  if (video && (video.payload.source_surface === "outputs" || Object.hasOwn(record(video.payload.settings) ?? {}, "output_video"))) {
    if (selected.revision !== 0 || native.latestEditId || typeof native.completionInputRef !== "string" || !opaque.test(native.completionInputRef)) throw unavailable();
    originalVideo = await readRetainedOutputVideo(env, { ownerId: actor.userId, completionId: native.completionId,
      documentId: selected.documentId, projectId: native.projectId, artifactId: selected.artifactId,
      contentId: native.contentId, inputId: native.completionInputRef, rawContent: source.content,
      contentExpiresAt: source.expires_at, completionRaw: video.raw, signal }); stable();
  }
  const audioEdit = audio ? await readers.audio.edit(env, native, actor.userId, selected, body, audio) : null; stable();
  const videoEdit = video ? await readers.video.edit(env, native, actor.userId, selected, body, video) : null; stable();
  const model3dEdit = model3d ? await readers.model3d.edit(env, native, actor.userId, selected, body, model3d) : null; stable();
  let originalModel3d: Awaited<ReturnType<typeof readRetainedOutputModel3d>> | null = null;
  let originalModel3dSource: { bindings: SqlValue[]; raw: string; expiresAt: string } | null = null;
  const directOriginalRestore = model3dEdit?.payload.artifact_kind === "model3d"
    && model3dEdit.payload.source_surface === "document-artifact-history" && model3dEdit.payload.revision_action === "restore"
    && model3dEdit.payload.restored_from_revision === 0 && model3dEdit.payload.model3d_revision === null;
  if (model3d && (selected.revision === 0 || directOriginalRestore)
    && Object.hasOwn(record(model3d.payload.settings) ?? {}, "output_model3d")) {
    if (selected.revision === 0 && native.latestEditId
      || typeof native.completionInputRef !== "string" || !opaque.test(native.completionInputRef)) throw unavailable();
    if (selected.revision !== 0) {
      // This is a real retained original snapshot, not a current DTO relabeled
      // revision zero. The current private restore receipt was checked above.
      if (!native.latestEditId || !directOriginalRestore || Object.hasOwn(body, "model3d_revision")
        || Object.hasOwn(body, "video_revision") || Object.hasOwn(body, "audio_revision")) throw unavailable();
      const bindings: SqlValue[] = [actor.userId, selected.artifactId, 0, selected.documentId, native.projectId, selected.contentSha256];
      const original = await database.prepare(`SELECT content_json,content_sha256,expires_at FROM artifact_revisions WHERE ${readers.model3d.sourceGuard()}`)
        .bind(...bindings).first<{ content_json: string; content_sha256: string; expires_at: string }>(); stable();
      if (!original || original.content_sha256 !== selected.contentSha256 || original.content_json !== source.content
        || !timestamp(original.expires_at) || Date.parse(original.expires_at) <= Date.now()
        || await hash(original.content_json) !== selected.contentSha256) throw unavailable();
      stable();
      originalModel3dSource = { bindings, raw: original.content_json, expiresAt: original.expires_at };
    }
    originalModel3d = await readRetainedOutputModel3d(env, { ownerId: actor.userId, completionId: native.completionId,
      documentId: selected.documentId, projectId: native.projectId, artifactId: selected.artifactId,
      contentId: native.contentId, inputId: native.completionInputRef, rawContent: originalModel3dSource?.raw ?? source.content,
      contentExpiresAt: originalModel3dSource?.expiresAt ?? source.expires_at, completionRaw: model3d.raw, signal }); stable();
  }
  const lifetimes = [source.expires_at, originalVideo?.expiresAt, originalModel3d?.expiresAt,
    originalModel3dSource?.expiresAt, videoEdit?.source?.expiresAt, model3dEdit?.source?.expiresAt].filter((value): value is string => value !== undefined);
  if (lifetimes.some(value => !timestamp(value) || Date.parse(value) <= Date.now())) throw unavailable();
  const expiresAt = [...lifetimes].sort()[0]!;
  const dto = projectNativeRetainedOutput({ output: selected.output, selection: { documentId: selected.documentId,
    artifactId: selected.artifactId, revision: selected.revision, contentSha256: selected.contentSha256 } }, body, expiresAt, native.sceneMedium, {
    audioReceipt: audio?.payload ?? null, videoReceipt: video?.payload ?? null, model3dReceipt: model3d?.payload ?? null,
    ...(audioEdit?.revision ? { audioRevision: audioEdit.revision } : {}),
    ...(videoEdit?.revision ? { videoRevision: videoEdit.revision } : {}),
    ...(model3dEdit?.revision ? { model3dRevision: model3dEdit.revision } : {}),
  });
  if (!dto || dto.output !== selected.output) throw unavailable();
  const revisions = { audioRevision: audioEdit?.revision ?? null, videoRevision: videoEdit?.revision ?? null,
    model3dRevision: model3dEdit?.revision ?? null };
  let asset: NativeRetainedMediaAsset;
  if (dto.output === "audio") {
    const current = dto.content.media;
    if (!current || current.mediaType !== "audio/wav" || current.sha256 !== selected.mediaSha256) throw unavailable();
    asset = { url: current.url, mimeType: "audio/wav", sha256: current.sha256,
      byteLength: audioEdit?.revision?.media.byteLength ?? null, readMode: "owned-media", ...revisions };
  } else if (dto.output === "video") {
    const current = dto.content.primaryMedia, clips = dto.content.clips.filter(clip => clip.media !== null);
    if (!current || clips.length !== 1 || clips[0]?.media?.url !== current.url || current.mediaType !== "video/mp4") throw unavailable();
    const original = originalVideo ? captureExperienceVideoEvidence(video?.payload.settings)?.receipt.media : null;
    const mediaHash = videoEdit?.revision?.media.sha256 ?? original?.sha256 ?? record(video?.payload.settings)?.source_media_sha256;
    if (typeof mediaHash !== "string" || !digest.test(mediaHash) || mediaHash !== selected.mediaSha256
      || original && original.mediaUrl !== current.url) throw unavailable();
    asset = { url: current.url, mimeType: "video/mp4", sha256: mediaHash,
      byteLength: videoEdit?.revision?.media.byteLength ?? original?.byteLength ?? null,
      readMode: originalVideo ? "native-output-video" : "owned-media", ...revisions };
  } else if (dto.output === "model3d") {
    const current = selectRetainedModel3dEditFile(dto.content.files, model3d?.payload.media_url);
    if (!current || current.sha256 !== selected.mediaSha256 || current.mimeType !== "model/gltf-binary") throw unavailable();
    asset = { url: current.url, mimeType: "model/gltf-binary", sha256: current.sha256,
      byteLength: current.fileSize, readMode: "owned-media", ...revisions };
  } else throw unavailable();

  let nativeOriginal: NativeRetainedMediaSnapshot["nativeOriginal"] = null;
  const model3dPrimary = originalModel3d?.evidence.files[0], model3dReceipt = originalModel3d?.evidence.receipt;
  const matchesModel3dPrimary = model3dPrimary && model3dReceipt && asset.url === model3dPrimary.url
    && asset.mimeType === model3dPrimary.mimeType && asset.sha256 === model3dReceipt.primarySha256
    && asset.byteLength === model3dReceipt.primaryByteLength;
  if (originalModel3dSource && !matchesModel3dPrimary) throw unavailable();
  if (originalVideo || matchesModel3dPrimary) {
    if (!Number.isSafeInteger(asset.byteLength) || Number(asset.byteLength) < 1) throw unavailable();
    nativeOriginal = { output: originalVideo ? "video" : "model3d",
      relation: originalModel3dSource ? "selected-restored-original" : "selected-original",
      originalRevision: 0, originalContentSha256: selected.contentSha256,
      selectedRevision: selected.revision, selectedContentSha256: selected.contentSha256,
      mediaSha256: asset.sha256, mediaByteLength: asset.byteLength! };
  }

  // Exact same media receipt/source predicates as the native final SELECT. The
  // complete SELECT is returned directly, with no recursive EXISTS/CASE wrapper.
  const predicates: { sql: string; bindings: SqlValue[] }[] = [];
  const receipt = (guard: () => string, value: { bindings: string[]; raw: string } | null | undefined) => {
    if (value) predicates.push({ sql: `EXISTS(SELECT 1 FROM event_private_payloads WHERE ${guard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`,
      bindings: [...value.bindings, value.raw] });
  };
  const sourceRevision = (guard: () => string, value: { bindings: SqlValue[]; raw: string; expiresAt: string } | null | undefined) => {
    if (value) predicates.push({ sql: `EXISTS(SELECT 1 FROM artifact_revisions WHERE ${guard()} AND CAST(content_json AS BLOB)=CAST(? AS BLOB) AND expires_at=?)`,
      bindings: [...value.bindings, value.raw, value.expiresAt] });
  };
  receipt(readers.audio.receiptGuard, audio); receipt(readers.audio.receiptGuard, audioEdit);
  receipt(readers.video.receiptGuard, video); receipt(readers.video.receiptGuard, videoEdit);
  sourceRevision(readers.video.sourceGuard, videoEdit?.source); receipt(readers.video.receiptGuard, videoEdit?.source?.edit);
  receipt(readers.model3d.receiptGuard, model3d); receipt(readers.model3d.receiptGuard, model3dEdit);
  sourceRevision(readers.model3d.sourceGuard, model3dEdit?.source); receipt(readers.model3d.receiptGuard, model3dEdit?.source?.edit);
  receipt(readers.model3d.receiptGuard, model3dEdit?.originalReset);
  sourceRevision(readers.model3d.sourceGuard, originalModel3dSource);
  const originalProofs: string[] = [], originalBindings: SqlValue[] = [];
  if (originalVideo) { originalProofs.push(`video_witness AS (SELECT ? AS bindings),video_proof AS MATERIALIZED (SELECT CASE WHEN (${originalVideo.witness.sql}) THEN 1 ELSE 0 END AS permitted)`); originalBindings.push(originalVideo.witness.json); }
  if (originalModel3d) {
    // The restored branch adds a genuine source snapshot to the native proof.
    // Omit CASE's expression levels so its full atomic lifecycle statement fits
    // D1. Missing/false/NULL still refuses through the unchanged scalar =1 below.
    originalProofs.push(`model3d_witness AS (SELECT ? AS bindings),model3d_proof AS MATERIALIZED (${originalModel3dSource
      ? `SELECT 1 AS permitted WHERE (${originalModel3d.witness.sql})`
      : `SELECT CASE WHEN (${originalModel3d.witness.sql}) THEN 1 ELSE 0 END AS permitted`})`);
    originalBindings.push(originalModel3d.witness.json);
  }
  // Group complete server-authored terms only for the restored-original proof;
  // their order and binding sequence are unchanged. Never parse or rewrite SQL.
  const currentGuard = originalModel3dSource
    ? `(${nativeRetainedSourceFinalGuard()}) AND (${predicates.map(value => `(${value.sql})`).join(" AND ")} AND (SELECT permitted FROM model3d_proof)=1)`
    : `${nativeRetainedSourceFinalGuard()}
      ${predicates.map(value => `AND (${value.sql})`).join("\n")}
      ${originalVideo ? "AND (SELECT permitted FROM video_proof)=1" : ""}${originalModel3d ? "AND (SELECT permitted FROM model3d_proof)=1" : ""}`;
  const assertion = immutable({
    sql: `WITH ${auth.cte},${eventCte},${originalProofs.length ? `${originalProofs.join(",")},` : ""}expected_events AS (SELECT value FROM json_each(?))
      SELECT 1 AS admitted FROM private_content WHERE ${currentGuard}`,
    bindings: [...auth.bindings, `creative:${actor.userId}`, ...originalBindings, snapshot, ...contentBindings,
      source.content, source.expires_at, principal.auth_json, ...predicates.flatMap(value => value.bindings)] as SqlValue[],
  });
  const final = await database.prepare(assertion.sql).bind(...assertion.bindings).first<{ admitted: number }>(); stable();
  if (final?.admitted !== 1 || lifetimes.some(value => Date.parse(value) <= Date.now())) throw unavailable();
  const proof = Object.freeze({}) as NativeRetainedMediaCustody;
  const sourceSnapshot = immutable({ identity: actor, selection: selected, projectId: native.projectId, contentId: native.contentId,
    completionId: native.completionId, sourceExpiresAt: source.expires_at, expiresAt, authSnapshot: principal.auth_json, dto, media: asset, nativeOriginal });
  custodies.set(proof, { env, database, media, cohort, administrators, signal, snapshot: sourceSnapshot, assertion, originalVideo });
  return proof;
}

export function nativeRetainedMediaCustodySnapshot(proof: NativeRetainedMediaCustody, env: WorkerEnv): NativeRetainedMediaSnapshot {
  return state(proof, env).snapshot;
}
export function nativeRetainedMediaCustodyAssertion(proof: NativeRetainedMediaCustody, env: WorkerEnv): NativeRetainedMediaAssertion {
  const { assertion } = state(proof, env);
  return { sql: assertion.sql, bindings: [...assertion.bindings] };
}
/** Reexecute after every asynchronous byte operation and before any delivery.
 * This read is never a mutation, recovery lease, publishing grant or settlement. */
export async function assertNativeRetainedMediaCustody(proof: NativeRetainedMediaCustody, env: WorkerEnv): Promise<void> {
  const current = state(proof, env);
  const final = await current.database.prepare(current.assertion.sql).bind(...current.assertion.bindings).first<{ admitted: number }>();
  state(proof, env);
  if (final?.admitted !== 1) throw unavailable();
}
/** Only original Outputs Video has already-read bytes. A null result must never
 * trigger a fallback R2 fetch for that mode. The caller still rechecks custody. */
export function copyNativeRetainedMediaOriginalVideoBytes(proof: NativeRetainedMediaCustody, env: WorkerEnv): Uint8Array<ArrayBuffer> | null {
  const current = state(proof, env);
  return current.originalVideo ? copyRetainedOutputVideoBytes(current.originalVideo, env) : null;
}

/** Internal cancellation binding of the exact opaque observation. */
export function nativeRetainedMediaCustodySignal(proof: NativeRetainedMediaCustody, env: WorkerEnv): AbortSignal {
  return state(proof, env).signal;
}
