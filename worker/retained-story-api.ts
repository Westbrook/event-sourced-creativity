import { AUTH_BYTES, EVENT_BYTES, opaque, Unavailable, unavailable, record, bytes, hash, hostedIdentity,
  eventCte, selectNative, readNativeRetainedPrincipal, readNativeRetainedSelection,
  readNativeRetainedContent, nativeRetainedSourceFinalGuard, personalContentGuard,
} from "./native-retained-text-custody.ts";
import { recordStoryboardReadFailure, storyboardReadFailureDiagnostic, logStoryboardReadFailure, type StoryboardReadStage } from "./storyboard-read-diagnostic.ts";
import { readRetainedOutputVideo } from "./output-video-retained.ts";
import { parseNativeAudioCompletionUrl, validateNativeAudioCompletion, type NativeAudioHandle } from "../src/model/native-audio-completion.ts";
import { parseNativeVideoCompletionUrl, validateNativeVideoCompletion, type NativeVideoHandle } from "../src/model/native-video-completion.ts";
import { parseNativeModel3dCompletionUrl, validateNativeModel3dCompletion, type NativeModel3dHandle } from "../src/model/native-model3d-completion.ts";
import { RODIN_ADAPTER_VERSION, serializeRodinInput, validateModel3dRequest } from "../src/model/model3d.ts";
import { isVideoAudioMode, isVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { documentRenderGuidance } from "../src/model/document-render-guidance.ts";
import { parseNativeStoryboardCompletionUrl, validateNativeStoryboardCompletion, type NativeStoryboardHandle } from "../src/model/native-storyboard-completion.ts";
import { MAX_MANUAL_PRESENTATION_SLIDES } from "../src/model/presentation-count-policy.ts";
import { parseNativeSlidesCompletionUrl, validateNativeSlidesCompletion, type NativeSlidesHandle } from "../src/model/native-slides-completion.ts";
import { documentJobMaxAttempts } from "../src/model/document-jobs.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { model3dArtifactMediaFile, parseAudioMediaRevision, parseVideoMediaRevision } from "../src/model/document-artifacts.ts";
import { parseModel3dMediaRevision } from "../src/model/model3d-media-revision.ts";
import { parseNativeSceneCompletionUrl, validateNativeSceneCompletion, type NativeSceneHandle } from "../src/model/native-scene-completion.ts";
import { parseNativeStoryCompletionUrl, validateNativeStoryCompletion, type NativeStoryHandle } from "../src/model/native-short-story-generation.ts";
import {
  parseRetainedStoryRequestUrl, validateRetainedStoryDto,
  RETAINED_STORY_JSON_MAX_BYTES,
} from "../src/model/retained-short-story.ts";
import {
  parseNativeRetainedOutputRequestUrl, projectNativeRetainedOutput,
  type NativeRetainedOutputTarget,
} from "../src/model/native-retained-output.ts";
import type { WorkerEnv } from "./runtime.ts";
import { readRetainedOutputStoryboard } from "./output-storyboard-retained.ts";
import { readRetainedOutputModel3d } from "./output-model3d-retained.ts";

// Audio, Video and Model3D additionally witness complete bounded original request bytes.
const MEDIA_JOB_BYTES = AUTH_BYTES * 6 + 16384;
const MAX_NATIVE_COMPLETION_ATTEMPTS = documentJobMaxAttempts("render_document");
const headers = {
  "cache-control": "private, no-store",
  "vary": "Cookie, oai-authenticated-user-id, oai-authenticated-user-email",
  "x-content-type-options": "nosniff",
  "content-type": "application/json; charset=utf-8",
};

const error = (code: string, status: number) => new Response(JSON.stringify({ error: code }), { status, headers });

const storyboardReceiptGuard = () => `private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
  AND redacted_at IS NULL AND length(CAST(private_json AS BLOB))<=${EVENT_BYTES}`;

/** Frame identities/media are private completion metadata, not authored plan
 * fields. Read only the selected envelope after its public custody was proved.
 * Its exact bytes join the final current-source witness below.
 */
async function storyboardReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string }) {
  const bindings = [native.completionId, ownerId, selection.documentId, native.projectId];
  const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${storyboardReceiptGuard()}`)
    .bind(...bindings).first<{ private_json: string }>();
  if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
  const payload = record(JSON.parse(row.private_json));
  if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
    || payload.artifact_id !== selection.artifactId || payload.artifact_kind !== "storyboard"
    || payload.content_ref !== native.contentId || payload.requested_by_user_id !== ownerId
    || !Number.isSafeInteger(native.completionItemCount) || Number(native.completionItemCount) < 1
    || Number(native.completionItemCount) > 24 || payload.item_count !== native.completionItemCount
    || !Array.isArray(payload.items) || payload.items.length !== native.completionItemCount) throw unavailable();
  const prefix = `${ownerMediaNamespace(ownerId)}/generated/`;
  for (const value of payload.items) {
    const item = record(value);
    if (!item) throw unavailable();
    if (item.media_url === null) continue;
    if (typeof item.media_url !== "string" || !item.media_url.startsWith("/api/media/")) throw unavailable();
    let key: string;
    try { key = decodeURIComponent(item.media_url.slice("/api/media/".length)); } catch { throw unavailable(); }
    if (!key.startsWith(prefix)) throw unavailable();
  }
  return { bindings, raw: row.private_json, items: payload.items, payload };
}

const videoReceiptGuard = () => `private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
  AND redacted_at IS NULL AND length(CAST(private_json AS BLOB))<=${EVENT_BYTES}`;

// The immutable completion supplies clip identities and owned media URLs. The
// current authored content supplies text; neither implies a combined film or a
// digest of the media bytes. Exact envelope bytes join the final witness.
async function videoReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string }) {
  const bindings = [native.completionId, ownerId, selection.documentId, native.projectId];
  const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${videoReceiptGuard()}`)
    .bind(...bindings).first<{ private_json: string }>();
  if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
  const payload = record(JSON.parse(row.private_json));
  if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
    || payload.artifact_id !== selection.artifactId || payload.artifact_kind !== "video"
    || payload.content_ref !== native.contentId || payload.requested_by_user_id !== ownerId
    || typeof native.completionInputRef !== "string" || !opaque.test(native.completionInputRef)
    || payload.input_ref !== native.completionInputRef
    || !Number.isSafeInteger(native.completionItemCount) || Number(native.completionItemCount) < 1
    || Number(native.completionItemCount) > 100 || payload.item_count !== native.completionItemCount
    || !Array.isArray(payload.items) || payload.items.length !== native.completionItemCount) throw unavailable();
  const prefix = `${ownerMediaNamespace(ownerId)}/generated/`;
  const ownedMedia = (url: unknown) => {
    if (url === null) return;
    if (typeof url !== "string" || !url.startsWith("/api/media/")) throw unavailable();
    let key: string;
    try { key = decodeURIComponent(url.slice("/api/media/".length)); } catch { throw unavailable(); }
    if (!key.startsWith(prefix)) throw unavailable();
  };
  ownedMedia(payload.media_url);
  for (const value of payload.items) {
    const item = record(value);
    if (!item) throw unavailable();
    ownedMedia(item.media_url);
  }
  return { bindings, raw: row.private_json, payload };
}

const model3dReceiptGuard = () => `private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
  AND redacted_at IS NULL AND length(CAST(private_json AS BLOB))<=${EVENT_BYTES}`;

// Native file references belong to the selected completion envelope, not its
// prose generation plan. Its exact private bytes join the final witness.
async function model3dReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string }) {
  const bindings = [native.completionId, ownerId, selection.documentId, native.projectId];
  const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${model3dReceiptGuard()}`)
    .bind(...bindings).first<{ private_json: string }>();
  if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
  const payload = record(JSON.parse(row.private_json));
  if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
    || payload.artifact_id !== selection.artifactId || payload.artifact_kind !== "model3d"
    || payload.content_ref !== native.contentId || payload.requested_by_user_id !== ownerId) throw unavailable();
  const files = record(payload.settings)?.model3d_files;
  if (files !== undefined && !Array.isArray(files)) throw unavailable();
  const prefix = `${ownerMediaNamespace(ownerId)}/generated/`;
  for (const value of Array.isArray(files) ? files : []) {
    const file = record(value);
    if (!file || typeof file.url !== "string" || !file.url.startsWith("/api/media/")) throw unavailable();
    let key: string;
    try { key = decodeURIComponent(file.url.slice("/api/media/".length)); } catch { throw unavailable(); }
    if (!key.startsWith(prefix)) throw unavailable();
  }
  return { bindings, raw: row.private_json, payload };
}

const audioReceiptGuard = () => `private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
  AND redacted_at IS NULL AND length(CAST(private_json AS BLOB))<=${EVENT_BYTES}`;

// Bind the selected private Audio media and original input receipt. The raw
// content is authored text; it does not identify or replace playable bytes.
async function audioReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string }) {
  const bindings = [native.completionId, ownerId, selection.documentId, native.projectId];
  const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${audioReceiptGuard()}`)
    .bind(...bindings).first<{ private_json: string }>();
  if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
  const payload = record(JSON.parse(row.private_json));
  if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
    || payload.artifact_id !== selection.artifactId || payload.artifact_kind !== "audio"
    || payload.content_ref !== native.contentId || payload.requested_by_user_id !== ownerId
    || typeof native.completionInputRef !== "string" || !opaque.test(native.completionInputRef)
    || payload.input_ref !== native.completionInputRef) throw unavailable();
  if (payload.media_url !== null) {
    if (typeof payload.media_url !== "string" || !payload.media_url.startsWith("/api/media/")) throw unavailable();
    let key: string;
    try { key = decodeURIComponent(payload.media_url.slice("/api/media/".length)); } catch { throw unavailable(); }
    if (!key.startsWith(`${ownerMediaNamespace(ownerId)}/generated/`)) throw unavailable();
  }
  return { bindings, raw: row.private_json, payload };
}

// Current Audio bytes are selected by the latest exact authored edit receipt.
// The immutable completion still supplies original input, lyrics and provenance.
// No object read occurs here: the existing explicit media reader verifies bytes.
async function audioEditReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string; revision: number; contentSha256: string },
  body: Record<string, unknown>, original: Awaited<ReturnType<typeof audioReceipt>>) {
  const hasBodyRevision = Object.hasOwn(body, "audio_revision");
  if (!native.latestEditId) {
    if (selection.revision !== 0 || hasBodyRevision) throw unavailable();
    return null;
  }
  const bindings = [native.latestEditId, ownerId, selection.documentId, native.projectId];
  const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${audioReceiptGuard()}`)
    .bind(...bindings).first<{ private_json: string }>();
  if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
  const payload = record(JSON.parse(row.private_json));
  if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
    || payload.artifact_id !== selection.artifactId || payload.content_ref !== native.contentId
    || payload.edited_by_user_id !== ownerId || payload.revision !== selection.revision
    || payload.content_sha256 !== selection.contentSha256
    || payload.artifact_kind !== undefined && payload.artifact_kind !== "audio") throw unavailable();
  const hasReceiptRevision = Object.hasOwn(payload, "audio_revision");
  if (!hasReceiptRevision) {
    // Legacy text-only edits preserve original audio, never an unbound override.
    if (hasBodyRevision) throw unavailable();
    return { bindings, raw: row.private_json, revision: undefined };
  }
  if (payload.artifact_kind !== "audio") throw unavailable();
  if (payload.audio_revision === null) {
    if (hasBodyRevision || payload.revision_action !== "restore" || payload.source_surface !== "document-artifact-history"
      || !Number.isSafeInteger(payload.restored_from_revision) || Number(payload.restored_from_revision) < 0
      || Number(payload.restored_from_revision) >= selection.revision) throw unavailable();
    return { bindings, raw: row.private_json, revision: undefined };
  }
  const revision = parseAudioMediaRevision(payload.audio_revision);
  const authored = hasBodyRevision ? parseAudioMediaRevision(body.audio_revision) : null;
  if (!revision || !authored || JSON.stringify(revision) !== JSON.stringify(authored)
    || revision.source.revision >= selection.revision) throw unavailable();
  const prefix = `${ownerMediaNamespace(ownerId)}/generated/`;
  for (const url of [revision.media.url, revision.source.url]) {
    let key: string;
    try { key = decodeURIComponent(url.slice("/api/media/".length)); } catch { throw unavailable(); }
    if (!key.startsWith(prefix)) throw unavailable();
  }
  if (revision.source.revision === 0) {
    if (revision.source.url !== original.payload.media_url
      || revision.source.sha256 !== record(original.payload.settings)?.source_media_sha256) throw unavailable();
  } else if (revision.source.contentSha256 !== native.editContentHashes[revision.source.revision - 1]) throw unavailable();
  return { bindings, raw: row.private_json, revision };
}

const videoSourceRevisionGuard = () => `owner_id=? AND artifact_id=? AND revision=? AND document_id=? AND project_id=?
  AND organization_id IS NULL AND project_access_id IS NULL AND redacted_at IS NULL
  AND typeof(content_json)='text' AND length(CAST(content_json AS BLOB)) BETWEEN 1 AND ${RETAINED_STORY_JSON_MAX_BYTES}
  AND content_sha256=? AND typeof(expires_at)='text' AND length(CAST(expires_at AS BLOB))=24
  AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

// Select edited Video from a separately retained private edit and one exact
// source snapshot. Original completion identity remains authoritative; no media
// is opened and no historical playback or recursive source traversal occurs.
async function videoEditReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string; revision: number; contentSha256: string },
  body: Record<string, unknown>, original: Awaited<ReturnType<typeof videoReceipt>>) {
  const hasBodyRevision = Object.hasOwn(body, "video_revision");
  if (Object.hasOwn(body, "audio_revision")) throw unavailable();
  if (!native.latestEditId) {
    if (selection.revision !== 0 || hasBodyRevision) throw unavailable();
    return null;
  }
  const readEdit = async (eventId: string, revision: number, contentSha256: string) => {
    const bindings = [eventId, ownerId, selection.documentId, native.projectId];
    const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${videoReceiptGuard()}`)
      .bind(...bindings).first<{ private_json: string }>();
    if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
    const payload = record(JSON.parse(row.private_json));
    if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
      || payload.artifact_id !== selection.artifactId || payload.content_ref !== native.contentId
      || payload.edited_by_user_id !== ownerId || payload.revision !== revision || payload.content_sha256 !== contentSha256
      || payload.artifact_kind !== undefined && payload.artifact_kind !== "video" || Object.hasOwn(payload, "audio_revision")) throw unavailable();
    return { bindings, raw: row.private_json, payload };
  };
  const restoredOriginal = (payload: Record<string, unknown>, revision: number) => payload.artifact_kind === "video"
    && payload.video_revision === null && payload.revision_action === "restore"
    && payload.source_surface === "document-artifact-history" && Number.isSafeInteger(payload.restored_from_revision)
    && Number(payload.restored_from_revision) >= 0 && Number(payload.restored_from_revision) < revision;
  const current = await readEdit(native.latestEditId, selection.revision, selection.contentSha256);
  const hasReceiptRevision = Object.hasOwn(current.payload, "video_revision");
  if (!hasReceiptRevision) {
    if (hasBodyRevision) throw unavailable();
    return { ...current, revision: undefined, source: undefined };
  }
  if (current.payload.artifact_kind !== "video") throw unavailable();
  if (current.payload.video_revision === null) {
    if (hasBodyRevision || !restoredOriginal(current.payload, selection.revision)) throw unavailable();
    return { ...current, revision: undefined, source: undefined };
  }
  const revision = parseVideoMediaRevision(current.payload.video_revision);
  const authored = hasBodyRevision ? parseVideoMediaRevision(body.video_revision) : null;
  if (!revision || !authored || JSON.stringify(revision) !== JSON.stringify(authored)
    || revision.source.revision >= selection.revision) throw unavailable();
  const prefix = `${ownerMediaNamespace(ownerId)}/generated/`;
  for (const url of [revision.media.url, revision.source.url]) {
    if (!decodeURIComponent(url.slice("/api/media/".length)).startsWith(prefix)) throw unavailable();
  }
  const originalItems = (original.payload.items as unknown[]).map(record);
  const mediaItems = originalItems.filter(item => item?.media_url !== null);
  if (mediaItems.length !== 1 || mediaItems[0]?.id !== revision.source.itemId
    || mediaItems[0]?.media_url !== original.payload.media_url || original.payload.media_type !== "video/mp4"
    || mediaItems[0]?.media_type !== "video/mp4") throw unavailable();
  const sourceBindings = [ownerId, selection.artifactId, revision.source.revision, selection.documentId,
    native.projectId, revision.source.contentSha256];
  const snapshot = await env.DB.prepare(`SELECT content_json,content_sha256,expires_at FROM artifact_revisions WHERE ${videoSourceRevisionGuard()}`)
    .bind(...sourceBindings).first<{ content_json: string; content_sha256: string; expires_at: string }>();
  if (!snapshot || typeof snapshot.content_json !== "string" || bytes(snapshot.content_json) > RETAINED_STORY_JSON_MAX_BYTES
    || !Number.isFinite(Date.parse(snapshot.expires_at)) || Date.parse(snapshot.expires_at) <= Date.now()
    || await hash(snapshot.content_json) !== revision.source.contentSha256) throw unavailable();
  const sourceBody = record(JSON.parse(snapshot.content_json));
  if (!sourceBody || Object.hasOwn(sourceBody, "audio_revision")) throw unavailable();
  const hasSourceRevision = Object.hasOwn(sourceBody, "video_revision");
  let sourceEdit: Awaited<ReturnType<typeof readEdit>> | null = null;
  if (revision.source.revision === 0) {
    if (hasSourceRevision) throw unavailable();
  } else {
    if (native.editContentHashes[revision.source.revision - 1] !== revision.source.contentSha256) throw unavailable();
    sourceEdit = await readEdit(native.editIds[revision.source.revision - 1]!, revision.source.revision, revision.source.contentSha256);
  }
  if (hasSourceRevision) {
    const previous = parseVideoMediaRevision(sourceBody.video_revision);
    const witnessed = sourceEdit ? parseVideoMediaRevision(sourceEdit.payload.video_revision) : null;
    if (!previous || !witnessed || sourceEdit?.payload.artifact_kind !== "video"
      || JSON.stringify(previous) !== JSON.stringify(witnessed) || previous.source.revision >= revision.source.revision
      || previous.source.itemId !== revision.source.itemId || previous.media.url !== revision.source.url
      || previous.media.sha256 !== revision.source.sha256
      || (["sampleCount", "timescale", "durationTicks", "width", "height"] as const).some(key =>
        previous[key] !== revision.source[key])) throw unavailable();
  } else {
    if (sourceEdit && Object.hasOwn(sourceEdit.payload, "video_revision")
      && !restoredOriginal(sourceEdit.payload, revision.source.revision)) throw unavailable();
    if (revision.source.url !== original.payload.media_url) throw unavailable();
    const settings = record(original.payload.settings);
    if (settings && Object.hasOwn(settings, "source_media_sha256") && settings.source_media_sha256 !== revision.source.sha256) throw unavailable();
  }
  return { ...current, revision, source: { bindings: sourceBindings, raw: snapshot.content_json,
    expiresAt: snapshot.expires_at, edit: sourceEdit } };
}

const model3dSourceRevisionGuard = () => `owner_id=? AND artifact_id=? AND revision=? AND document_id=? AND project_id=?
  AND organization_id IS NULL AND project_access_id IS NULL AND redacted_at IS NULL
  AND typeof(content_json)='text' AND length(CAST(content_json AS BLOB)) BETWEEN 1 AND ${RETAINED_STORY_JSON_MAX_BYTES}
  AND content_sha256=? AND typeof(expires_at)='text' AND length(CAST(expires_at AS BLOB))=24
  AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

// An authored current GLB needs both its exact private edit and the exact source
// revision it scaled. Original completion files remain immutable. This bounded
// witness reads metadata only; authenticated media reads establish actual bytes.
async function model3dEditReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string; revision: number; contentSha256: string },
  body: Record<string, unknown>, original: Awaited<ReturnType<typeof model3dReceipt>>) {
  const hasBodyRevision = Object.hasOwn(body, "model3d_revision");
  const crossKind = (value: Record<string, unknown>) => Object.hasOwn(value, "audio_revision") || Object.hasOwn(value, "video_revision");
  if (crossKind(body)) throw unavailable();
  if (!native.latestEditId) {
    if (selection.revision !== 0 || hasBodyRevision) throw unavailable();
    return null;
  }
  const readEdit = async (eventId: string, revision: number, contentSha256: string) => {
    const bindings = [eventId, ownerId, selection.documentId, native.projectId];
    const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${model3dReceiptGuard()}`)
      .bind(...bindings).first<{ private_json: string }>();
    if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
    const payload = record(JSON.parse(row.private_json));
    if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
      || payload.artifact_id !== selection.artifactId || payload.content_ref !== native.contentId
      || payload.edited_by_user_id !== ownerId || payload.revision !== revision || payload.content_sha256 !== contentSha256
      || payload.artifact_kind !== undefined && payload.artifact_kind !== "model3d" || crossKind(payload)) throw unavailable();
    return { bindings, raw: row.private_json, payload };
  };
  const restoredOriginal = (payload: Record<string, unknown>, revision: number) => payload.artifact_kind === "model3d"
    && payload.model3d_revision === null && payload.revision_action === "restore"
    && payload.source_surface === "document-artifact-history" && Number.isSafeInteger(payload.restored_from_revision)
    && Number(payload.restored_from_revision) >= 0 && Number(payload.restored_from_revision) < revision;
  const originalResetBefore = async (revision: number) => {
    const index = native.model3dMediaTransitions.filter(index => index + 1 < revision).at(-1);
    if (index === undefined) return undefined;
    const reset = await readEdit(native.editIds[index]!, index + 1, native.editContentHashes[index]!);
    if (!restoredOriginal(reset.payload, index + 1)) throw unavailable();
    return reset;
  };
  const current = await readEdit(native.latestEditId, selection.revision, selection.contentSha256);
  if (!Object.hasOwn(current.payload, "model3d_revision")) {
    if (hasBodyRevision || current.payload.source_surface === "document-artifact-model3d-scale" || current.payload.revision_action === "restore"
      || Array.isArray(current.payload.changed_fields) && current.payload.changed_fields.includes("model3d_revision")) throw unavailable();
    // A legacy text edit may carry original files, but omission after a geometry
    // edit cannot silently resurrect those files. A real intervening original
    // restore supplies its own private revision/hash witness and final SQL pin.
    return { ...current, revision: undefined, source: undefined, originalReset: await originalResetBefore(selection.revision) };
  }
  if (current.payload.artifact_kind !== "model3d") throw unavailable();
  if (current.payload.model3d_revision === null) {
    if (hasBodyRevision || !restoredOriginal(current.payload, selection.revision)) throw unavailable();
    return { ...current, revision: undefined, source: undefined, originalReset: undefined };
  }
  const revision = parseModel3dMediaRevision(current.payload.model3d_revision);
  const authored = hasBodyRevision ? parseModel3dMediaRevision(body.model3d_revision) : null;
  if (!revision || !authored || JSON.stringify(revision) !== JSON.stringify(authored)
    || revision.source.revision >= selection.revision) throw unavailable();
  const prefix = `${ownerMediaNamespace(ownerId)}/generated/`;
  for (const url of [revision.media.url, revision.source.url]) {
    if (!decodeURIComponent(url.slice("/api/media/".length)).startsWith(prefix)) throw unavailable();
  }
  const originalFile = model3dArtifactMediaFile({ kind: "model3d", settings: record(original.payload.settings) ?? {},
    mediaUrl: typeof original.payload.media_url === "string" ? original.payload.media_url : null });
  if (!originalFile) throw unavailable();
  const sourceBindings = [ownerId, selection.artifactId, revision.source.revision, selection.documentId,
    native.projectId, revision.source.contentSha256];
  const snapshot = await env.DB.prepare(`SELECT content_json,content_sha256,expires_at FROM artifact_revisions WHERE ${model3dSourceRevisionGuard()}`)
    .bind(...sourceBindings).first<{ content_json: string; content_sha256: string; expires_at: string }>();
  if (!snapshot || typeof snapshot.content_json !== "string" || bytes(snapshot.content_json) > RETAINED_STORY_JSON_MAX_BYTES
    || !Number.isFinite(Date.parse(snapshot.expires_at)) || Date.parse(snapshot.expires_at) <= Date.now()
    || await hash(snapshot.content_json) !== revision.source.contentSha256) throw unavailable();
  const sourceBody = record(JSON.parse(snapshot.content_json));
  if (!sourceBody || crossKind(sourceBody)) throw unavailable();
  const hasSourceRevision = Object.hasOwn(sourceBody, "model3d_revision");
  let sourceEdit: Awaited<ReturnType<typeof readEdit>> | null = null;
  if (revision.source.revision === 0) {
    if (hasSourceRevision) throw unavailable();
  } else {
    if (native.editContentHashes[revision.source.revision - 1] !== revision.source.contentSha256) throw unavailable();
    sourceEdit = await readEdit(native.editIds[revision.source.revision - 1]!, revision.source.revision, revision.source.contentSha256);
  }
  let originalReset: Awaited<ReturnType<typeof originalResetBefore>>;
  if (hasSourceRevision) {
    const previous = parseModel3dMediaRevision(sourceBody.model3d_revision);
    const witnessed = sourceEdit ? parseModel3dMediaRevision(sourceEdit.payload.model3d_revision) : null;
    if (!previous || !witnessed || sourceEdit?.payload.artifact_kind !== "model3d"
      || JSON.stringify(previous) !== JSON.stringify(witnessed) || previous.source.revision >= revision.source.revision
      || previous.media.url !== revision.source.url || previous.media.sha256 !== revision.source.sha256
      || previous.media.byteLength !== revision.source.byteLength
      || previous.vertexCount !== revision.vertexCount || previous.positionAccessorCount !== revision.positionAccessorCount
      || JSON.stringify(previous.afterBounds) !== JSON.stringify(revision.beforeBounds)) throw unavailable();
  } else {
    if (sourceEdit && Object.hasOwn(sourceEdit.payload, "model3d_revision")
      && !restoredOriginal(sourceEdit.payload, revision.source.revision)) throw unavailable();
    if (sourceEdit && !Object.hasOwn(sourceEdit.payload, "model3d_revision")) {
      if (sourceEdit.payload.source_surface === "document-artifact-model3d-scale" || sourceEdit.payload.revision_action === "restore"
        || Array.isArray(sourceEdit.payload.changed_fields) && sourceEdit.payload.changed_fields.includes("model3d_revision")) throw unavailable();
      originalReset = await originalResetBefore(revision.source.revision);
    }
    if (revision.source.url !== originalFile.url || revision.source.sha256 !== originalFile.sha256
      || revision.source.byteLength !== originalFile.fileSize) throw unavailable();
  }
  return { ...current, revision, originalReset, source: { bindings: sourceBindings, raw: snapshot.content_json,
    expiresAt: snapshot.expires_at, edit: sourceEdit } };
}


// A bounded, completed-only native association; not a new job runner or status/recovery API.
// The entire result JSON is byte-gated before transport, while only selected fields are returned.
// SQL JSON evaluation/scan work is not bounded by this transport cap.
const jobCte = `story_job AS (
  SELECT job.* FROM document_jobs job WHERE job.job_id=? AND job.document_id=? AND job.owner_id=? AND job.stream_id=?
    AND job.kind='render_document' AND job.status='completed' AND job.source_surface='document'
    AND typeof(job.attempt_count)='integer' AND job.attempt_count BETWEEN 1 AND ${MAX_NATIVE_COMPLETION_ATTEMPTS}
    AND job.correlation_id=(job.job_id||':attempt:'||CAST(job.attempt_count AS TEXT))
    AND job.error_message IS NULL AND job.completed_at IS NOT NULL
    AND typeof(job.expires_at)='text' AND length(CAST(job.expires_at AS BLOB))=24
    AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND json_valid(job.request_json) AND json_extract(job.request_json,'$.artifactKind')='short_story'
    AND json_extract(job.request_json,'$.productionMode')='manual' AND json_extract(job.request_json,'$.itemCount')=1
    AND json_type(job.request_json,'$.outputExecution') IS NULL AND json_type(job.request_json,'$.workflowId') IS NULL
    AND json_valid(job.result_json) AND length(CAST(job.result_json AS BLOB))<=${AUTH_BYTES}
    AND json_extract(job.result_json,'$.artifactKind')='short_story'
    AND json_type(job.result_json,'$.appendedEventIds')='array'
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE
      (scope.resource_kind='job' AND scope.resource_id=job.job_id) OR (scope.resource_kind='document' AND scope.resource_id=job.document_id))
    AND (SELECT COUNT(*) FROM events event WHERE event.stream_id=job.stream_id AND event.correlation_id=job.correlation_id
      AND event.type='DocumentRenderCompleted')=1
), story_job_json AS (
  SELECT json_object('jobId',job_id,'documentId',document_id,'correlationId',correlation_id,'attemptCount',attempt_count,'artifactId',json_extract(result_json,'$.artifactId'),
    'appendedEventIds',json_extract(result_json,'$.appendedEventIds'),'expiresAt',expires_at,
    'completionId',(SELECT event_id FROM events WHERE stream_id=story_job.stream_id AND correlation_id=story_job.correlation_id
      AND type='DocumentRenderCompleted' AND actor='worker:renderer' AND client_id='server:document-job:render_document')) AS job_json
  FROM story_job
), bounded_story_job AS (SELECT job_json FROM story_job_json WHERE length(CAST(job_json AS BLOB))<=16384)`;

// Scene retains its one-item consent. Manual Slides and Storyboard bind their
// exact numeric counts; Storyboard additionally requires explicit paid-media consent.
// These completed-only reads share the same attempt and final ownership witness.
function nativeCompletionJobCte(output: "scene" | "slides" | "storyboard" | "audio" | "video" | "model3d") {
  const requestGuard = output === "model3d" ? `
    AND length(CAST(job.request_json AS BLOB))<=${AUTH_BYTES}
    AND json_type(job.request_json,'$.itemCount')='integer' AND json_extract(job.request_json,'$.itemCount')=1
    AND json_type(job.request_json,'$.paidMediaConfirmed')='true'
    AND json_type(job.request_json,'$.sceneRequestId') IS NULL AND json_type(job.request_json,'$.sceneCostConsent') IS NULL
    AND json_type(job.request_json,'$.requestedSlideCount') IS NULL AND json_type(job.request_json,'$.slideCountPolicy') IS NULL` : output === "video" ? `
    AND length(CAST(job.request_json AS BLOB))<=${AUTH_BYTES}
    AND json_type(job.request_json,'$.paidMediaConfirmed')='true'
    AND json_type(job.request_json,'$.sceneRequestId') IS NULL AND json_type(job.request_json,'$.sceneCostConsent') IS NULL
    AND json_type(job.request_json,'$.requestedSlideCount') IS NULL AND json_type(job.request_json,'$.slideCountPolicy') IS NULL` : output === "audio" ? `
    AND length(CAST(job.request_json AS BLOB))<=${AUTH_BYTES}
    AND (json_type(job.request_json,'$.itemCount') IS NULL
      OR (json_type(job.request_json,'$.itemCount')='integer' AND json_extract(job.request_json,'$.itemCount')=1))
    AND json_type(job.request_json,'$.paidMediaConfirmed')='true'
    AND json_type(job.request_json,'$.sceneRequestId') IS NULL AND json_type(job.request_json,'$.sceneCostConsent') IS NULL
    AND json_type(job.request_json,'$.requestedSlideCount') IS NULL AND json_type(job.request_json,'$.slideCountPolicy') IS NULL` : output === "scene" ? `    AND (json_type(job.request_json,'$.itemCount') IS NULL
      OR (json_type(job.request_json,'$.itemCount')='integer' AND json_extract(job.request_json,'$.itemCount')=1))
    AND json_extract(job.request_json,'$.sceneRequestId')=job.job_id
    AND json_extract(job.request_json,'$.sceneCostConsent.version')='scene-cost-v1'
    AND json_type(job.request_json,'$.sceneCostConsent.confirmed')='true'
    AND json_extract(job.request_json,'$.sceneCostConsent.requestId')=job.job_id
    AND json_extract(job.request_json,'$.sceneCostConsent.actorUserId')=job.owner_id
    AND json_extract(job.request_json,'$.sceneCostConsent.documentId')=job.document_id
    AND json_extract(job.request_json,'$.sceneCostConsent.productionMode')='manual'
    AND json_type(job.request_json,'$.sceneCostConsent.itemCount')='integer'
    AND json_extract(job.request_json,'$.sceneCostConsent.itemCount')=1` : output === "storyboard" ? `
    AND json_type(job.request_json,'$.itemCount')='integer'
    AND json_extract(job.request_json,'$.itemCount') BETWEEN 1 AND 12
    AND json_type(job.request_json,'$.paidMediaConfirmed')='true'
    AND json_type(job.request_json,'$.sceneRequestId') IS NULL AND json_type(job.request_json,'$.sceneCostConsent') IS NULL
    AND json_type(job.request_json,'$.requestedSlideCount') IS NULL AND json_type(job.request_json,'$.slideCountPolicy') IS NULL` : `
    AND json_type(job.request_json,'$.itemCount')='integer'
    AND json_extract(job.request_json,'$.itemCount') BETWEEN 1 AND ${MAX_MANUAL_PRESENTATION_SLIDES}
    AND (json_type(job.request_json,'$.requestedSlideCount') IS NULL
      OR (json_type(job.request_json,'$.requestedSlideCount')='integer'
        AND json_extract(job.request_json,'$.requestedSlideCount')=json_extract(job.request_json,'$.itemCount')))
    AND json_type(job.request_json,'$.slideCountPolicy') IS NULL`;
  return `story_job AS (
  SELECT job.* FROM document_jobs job WHERE job.job_id=? AND job.document_id=? AND job.owner_id=? AND job.stream_id=?
    AND job.kind='render_document' AND job.status='completed' AND job.source_surface='document'
    AND typeof(job.attempt_count)='integer' AND job.attempt_count BETWEEN 1 AND ${MAX_NATIVE_COMPLETION_ATTEMPTS}
    AND job.correlation_id=(job.job_id||':attempt:'||CAST(job.attempt_count AS TEXT))
    AND job.error_message IS NULL AND job.completed_at IS NOT NULL
    AND typeof(job.expires_at)='text' AND length(CAST(job.expires_at AS BLOB))=24
    AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND json_valid(job.request_json) AND json_extract(job.request_json,'$.artifactKind')='${output}'
    AND json_extract(job.request_json,'$.productionMode')='manual'
${requestGuard}
    AND json_type(job.request_json,'$.outputExecution') IS NULL AND json_type(job.request_json,'$.workflowId') IS NULL
    AND json_type(job.request_json,'$.workflowStageId') IS NULL AND json_type(job.request_json,'$.workflowSources') IS NULL
    AND json_valid(job.result_json) AND length(CAST(job.result_json AS BLOB))<=${AUTH_BYTES}
    AND json_extract(job.result_json,'$.artifactKind')='${output}'
    AND json_type(job.result_json,'$.appendedEventIds')='array'
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE
      (scope.resource_kind='job' AND scope.resource_id=job.job_id) OR (scope.resource_kind='document' AND scope.resource_id=job.document_id))
    AND (SELECT COUNT(*) FROM events event WHERE event.stream_id=job.stream_id AND event.correlation_id=job.correlation_id
      AND event.type='DocumentRenderCompleted')=1
), story_job_json AS (
  SELECT json_object('jobId',job_id,'documentId',document_id,'correlationId',correlation_id,'attemptCount',attempt_count,'artifactId',json_extract(result_json,'$.artifactId'),
    'appendedEventIds',json_extract(result_json,'$.appendedEventIds'),'expiresAt',expires_at,
    ${output === "audio" || output === "video" || output === "model3d" ? "'requestSnapshot',request_json,'providerJobId',json_extract(result_json,'$.providerJobId'),'provider',json_extract(result_json,'$.provider')," : output === "slides" ? "'requestedSlideCount',json_extract(request_json,'$.itemCount')," : output === "storyboard" ? "'requestedFrameCount',json_extract(request_json,'$.itemCount')," : ""}
    'completionId',(SELECT event_id FROM events WHERE stream_id=story_job.stream_id AND correlation_id=story_job.correlation_id
      AND type='DocumentRenderCompleted' AND actor='worker:renderer' AND client_id='server:document-job:render_document')) AS job_json
  FROM story_job
), bounded_story_job AS (SELECT job_json FROM story_job_json WHERE length(CAST(job_json AS BLOB))<=${output === "audio" || output === "video" || output === "model3d" ? MEDIA_JOB_BYTES : 16384})`;
}

type NativeOutputCompletion =
  | { output: "scene"; handle: NativeSceneHandle }
  | { output: "slides"; handle: NativeSlidesHandle }
  | { output: "storyboard"; handle: NativeStoryboardHandle }
  | { output: "audio"; handle: NativeAudioHandle }
  | { output: "video"; handle: NativeVideoHandle }
  | { output: "model3d"; handle: NativeModel3dHandle };

async function completedStoryJob(env:WorkerEnv, handle:NativeStoryHandle | NativeSceneHandle | NativeSlidesHandle | NativeStoryboardHandle | NativeAudioHandle | NativeVideoHandle | NativeModel3dHandle, ownerId:string, streamId:string, output:"scene" | "slides" | "storyboard" | "audio" | "video" | "model3d" | null=null) {
  const bindings=[handle.jobId,handle.documentId,ownerId,streamId];
  const raw=await env.DB.prepare(`WITH ${output ? nativeCompletionJobCte(output) : jobCte} SELECT job_json FROM bounded_story_job`).bind(...bindings).first<{job_json:string}>();
  if(!raw||typeof raw.job_json!=="string"||bytes(raw.job_json)>(output === "audio" || output === "video" || output === "model3d" ? MEDIA_JOB_BYTES : 16384))throw unavailable();
  const row=record(JSON.parse(raw.job_json));
  if(!row||row.jobId!==handle.jobId||row.documentId!==handle.documentId
    ||typeof row.attemptCount!=="number"||!Number.isSafeInteger(row.attemptCount)||row.attemptCount<1||row.attemptCount>MAX_NATIVE_COMPLETION_ATTEMPTS
    ||row.correlationId!==`${handle.jobId}:attempt:${row.attemptCount}`
    ||typeof row.artifactId!=="string"||!opaque.test(row.artifactId)
    ||typeof row.completionId!=="string"||!opaque.test(row.completionId)
    ||!Array.isArray(row.appendedEventIds)||row.appendedEventIds.length<1||row.appendedEventIds.length>128
    ||row.appendedEventIds.some(id=>typeof id!=="string"||!opaque.test(id))
    ||new Set(row.appendedEventIds).size!==row.appendedEventIds.length||!row.appendedEventIds.includes(row.completionId)
    ||typeof row.expiresAt!=="string"||!(Date.parse(row.expiresAt)>Date.now())
    ||new Date(row.expiresAt).toISOString()!==row.expiresAt)throw unavailable();
  if ((output === "audio" || output === "video" || output === "model3d") && (typeof row.requestSnapshot !== "string" || bytes(row.requestSnapshot) > AUTH_BYTES
    || !record(JSON.parse(row.requestSnapshot)) || typeof row.providerJobId !== "string"
    || !opaque.test(row.providerJobId) || typeof row.provider !== "string" || !opaque.test(row.provider))) throw unavailable();
  const requestedSlideCount = output === "slides" && typeof row.requestedSlideCount === "number" ? row.requestedSlideCount : undefined;
  if (output === "slides" && (typeof requestedSlideCount !== "number" || !Number.isSafeInteger(requestedSlideCount)
    || requestedSlideCount < 1 || requestedSlideCount > MAX_MANUAL_PRESENTATION_SLIDES)) throw unavailable();
  const requestedFrameCount = output === "storyboard" && typeof row.requestedFrameCount === "number" ? row.requestedFrameCount : undefined;
  if (output === "storyboard" && (typeof requestedFrameCount !== "number" || !Number.isSafeInteger(requestedFrameCount)
    || requestedFrameCount < 1 || requestedFrameCount > 12)) throw unavailable();
  return {bindings,snapshot:raw.job_json,artifactId:row.artifactId,completionId:row.completionId,expiresAt:row.expiresAt,
    requestedSlideCount, requestedFrameCount,
    audioRequest: output === "audio" ? record(JSON.parse(row.requestSnapshot as string)) : null,
    audioProviderJobId: output === "audio" ? row.providerJobId as string : null,
    audioProvider: output === "audio" ? row.provider as string : null,
    videoRequest: output === "video" ? record(JSON.parse(row.requestSnapshot as string)) : null,
    videoProviderJobId: output === "video" ? row.providerJobId as string : null,
    videoProvider: output === "video" ? row.provider as string : null,
    model3dRequest: output === "model3d" ? record(JSON.parse(row.requestSnapshot as string)) : null,
    model3dProviderJobId: output === "model3d" ? row.providerJobId as string : null,
    model3dProvider: output === "model3d" ? row.provider as string : null};
}

// The admission generationReceipt.input_ref is a different row. Bind the selected
// completion's private input through the actual artifact and provider invocation.
function audioInputGuard() {
  return personalContentGuard().replace("kind='document-artifact'", "kind='document-artifact-input'") + " AND json_valid(content) AND json_type(content)='object'";
}
async function audioCompletionInput(env: WorkerEnv, job: Awaited<ReturnType<typeof completedStoryJob>>,
  audio: NonNullable<Awaited<ReturnType<typeof audioReceipt>>>, native: ReturnType<typeof selectNative>,
  ownerId: string, target: { documentId: string; artifactId: string }) {
  const original = job.audioRequest, snapshot = record(original?.snapshot);
  if (!original || original.documentId !== target.documentId || !snapshot || !Array.isArray(snapshot.facts)
    || typeof original.documentRevision !== "string" || !original.documentRevision
    || typeof original.requestKey !== "string" || !original.requestKey
    || !Array.isArray(original.sourceBlockVersions)
    || original.sourceBlockVersions.some(value => {
      const version = record(value);
      return !version || Object.keys(version).length !== 2 || typeof version.block_id !== "string" || !opaque.test(version.block_id)
        || typeof version.version !== "number" || !Number.isSafeInteger(version.version) || version.version < 0;
    }) || new Set(original.sourceBlockVersions.map(value => (value as Record<string, unknown>).block_id)).size !== original.sourceBlockVersions.length
    || JSON.stringify(original.sourceBlockVersions) !== JSON.stringify(audio.payload.source_block_versions)) throw unavailable();
  const bindings = [audio.payload.input_ref as string, ownerId, native.projectId, target.documentId, target.artifactId];
  const row = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${audioInputGuard()}`)
    .bind(...bindings).first<{ content: string; expires_at: string }>();
  if (!row || typeof row.content !== "string" || bytes(row.content) > RETAINED_STORY_JSON_MAX_BYTES
    || typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at)) || new Date(row.expires_at).toISOString() !== row.expires_at) throw unavailable();
  const input = record(JSON.parse(row.content)), request = record(input?.request), render = record(input?.render);
  const selectedSnapshot = record(input?.document_snapshot);
  if (!input || input.schema_version !== 1 || input.artifact_id !== target.artifactId || input.artifact_kind !== "audio"
    || input.document_id !== target.documentId || input.project_id !== native.projectId || !request || !render || !selectedSnapshot
    || record(selectedSnapshot.document)?.id !== target.documentId
    || request.item_count !== 1 || request.production_mode !== "manual" || request.source_surface !== "document"
    || render.provider_job_id !== job.audioProviderJobId || render.provider !== job.audioProvider
    || audio.payload.provider_job_id !== job.audioProviderJobId || audio.payload.provider !== job.audioProvider
    || typeof render.model !== "string" || render.model !== audio.payload.model_id
    || (original.audioProviderModel !== undefined && original.audioProviderModel !== render.model)
    || (original.audioProfile !== undefined && JSON.stringify(original.audioProfile) !== JSON.stringify(request.audio_profile))) throw unavailable();
  // The producer copies these fields verbatim, then adds current document metadata
  // and merges standing constraints. Preserve every original normalized constraint.
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== "document" && key !== "standing_constraints"
      && JSON.stringify(selectedSnapshot[key]) !== JSON.stringify(value)) throw unavailable();
  }
  const constraints = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is Record<string, unknown> => Boolean(record(item)));
  const constraintKey = (item: Record<string, unknown>) => String(item.preference_id ?? `${item.polarity}:${item.axis}:${item.value}`);
  const originalConstraints = new Map(constraints(snapshot.standing_constraints).map(item => [constraintKey(item), item]));
  const selectedConstraints = constraints(selectedSnapshot.standing_constraints);
  const byKey = new Map(selectedConstraints.map(item => [constraintKey(item), item]));
  if (byKey.size !== selectedConstraints.length) throw unavailable();
  for (const [key, value] of originalConstraints) {
    if (JSON.stringify(byKey.get(key)) !== JSON.stringify(value)) throw unavailable();
  }
  return { bindings, raw: row.content, expiresAt: row.expires_at };
}

// Manual Video retains its primary render separately from nullable scene files.
// Bind the producer's requested options and private invocation without inventing
// a media digest, a one-scene contract, or a new provider/read operation.
async function videoCompletionInput(env: WorkerEnv, job: Awaited<ReturnType<typeof completedStoryJob>>,
  video: NonNullable<Awaited<ReturnType<typeof videoReceipt>>>, native: ReturnType<typeof selectNative>,
  ownerId: string, target: { documentId: string; artifactId: string }) {
  const original = job.videoRequest, snapshot = record(original?.snapshot);
  if (!original || original.documentId !== target.documentId || !snapshot || !Array.isArray(snapshot.facts)
    || typeof original.documentRevision !== "string" || !original.documentRevision
    || typeof original.requestKey !== "string" || !original.requestKey
    || !Array.isArray(original.sourceBlockVersions)
    || original.sourceBlockVersions.some(value => {
      const version = record(value);
      return !version || Object.keys(version).length !== 2 || typeof version.block_id !== "string" || !opaque.test(version.block_id)
        || typeof version.version !== "number" || !Number.isSafeInteger(version.version) || version.version < 0;
    }) || new Set(original.sourceBlockVersions.map(value => (value as Record<string, unknown>).block_id)).size !== original.sourceBlockVersions.length
    || JSON.stringify(original.sourceBlockVersions) !== JSON.stringify(video.payload.source_block_versions)) throw unavailable();
  // These are the unchanged manual normalization rules in events-api.ts.
  const itemCount = Math.max(1, Math.min(12, Math.floor(Number(original.itemCount ?? 1))));
  const seconds = original.videoSeconds === undefined ? VIDEO_ADAPTER_CONTRACT.defaultDuration : original.videoSeconds;
  const size = original.videoSize === undefined ? "1280x720" : original.videoSize;
  const audioMode = original.videoAudioMode === undefined ? VIDEO_ADAPTER_CONTRACT.defaultAudioMode : original.videoAudioMode;
  if (!Number.isSafeInteger(itemCount) || !isVideoDurationSeconds(seconds)
    || size !== "1280x720" && size !== "720x1280" || !isVideoAudioMode(audioMode)) throw unavailable();
  const soundtrackIds = [...new Set(Array.isArray(original.soundtrackBlockIds) ? original.soundtrackBlockIds.map(String).filter(Boolean) : [])];
  const guidance = documentRenderGuidance(original), settings = record(video.payload.settings);
  if (guidance.issues.length) throw unavailable();
  const bindings = [video.payload.input_ref as string, ownerId, native.projectId, target.documentId, target.artifactId];
  const row = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${audioInputGuard()}`)
    .bind(...bindings).first<{ content: string; expires_at: string }>();
  if (!row || typeof row.content !== "string" || bytes(row.content) > RETAINED_STORY_JSON_MAX_BYTES
    || typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at)) || new Date(row.expires_at).toISOString() !== row.expires_at) throw unavailable();
  const input = record(JSON.parse(row.content)), request = record(input?.request), render = record(input?.render);
  const selectedSnapshot = record(input?.document_snapshot);
  if (!input || input.schema_version !== 1 || input.artifact_id !== target.artifactId || input.artifact_kind !== "video"
    || input.document_id !== target.documentId || input.project_id !== native.projectId || !request || !render || !selectedSnapshot || !settings
    || record(selectedSnapshot.document)?.id !== target.documentId
    || request.source_surface !== "document" || video.payload.source_surface !== "document"
    || render.provider_job_id !== job.videoProviderJobId || render.provider !== job.videoProvider
    || video.payload.provider_job_id !== job.videoProviderJobId || video.payload.provider !== job.videoProvider
    || typeof render.model !== "string" || !render.model || render.model !== video.payload.model_id
    || JSON.stringify(request.soundtrack_block_ids) !== JSON.stringify(soundtrackIds)
    || request.soundtrack_provider_transfer !== (original.sendSoundtrackToVideoProvider === true)) throw unavailable();
  const expected = { item_count: itemCount, production_mode: "manual", video_seconds: seconds, video_size: size,
    video_audio_mode: audioMode, audience: guidance.audience || "general", tone: guidance.tone || "document-derived" };
  for (const [key, value] of Object.entries(expected)) {
    if (request[key] !== value || settings[key] !== value) throw unavailable();
  }
  // The planner validates manual item counts. Preserve every allowed count,
  // while matching both the selected public count and its immutable items.
  if (video.payload.item_count !== itemCount || !Array.isArray(video.payload.items)
    || video.payload.items.length !== itemCount) throw unavailable();
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== "document" && key !== "standing_constraints"
      && JSON.stringify(selectedSnapshot[key]) !== JSON.stringify(value)) throw unavailable();
  }
  const constraints = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is Record<string, unknown> => Boolean(record(item)));
  const constraintKey = (item: Record<string, unknown>) => String(item.preference_id ?? `${item.polarity}:${item.axis}:${item.value}`);
  const originalConstraints = new Map(constraints(snapshot.standing_constraints).map(item => [constraintKey(item), item]));
  const selectedConstraints = constraints(selectedSnapshot.standing_constraints);
  const byKey = new Map(selectedConstraints.map(item => [constraintKey(item), item]));
  if (byKey.size !== selectedConstraints.length) throw unavailable();
  for (const [key, value] of originalConstraints) {
    if (JSON.stringify(byKey.get(key)) !== JSON.stringify(value)) throw unavailable();
  }
  return { bindings, raw: row.content, expiresAt: row.expires_at, itemCount };
}


// Model3D saves one requested model as files and an empty authored item list.
// Rebuild only the pure Rodin input description; this read neither retrieves
// reference bytes nor imports the provider adapter or its recovery operations.
async function model3dCompletionInput(env: WorkerEnv, job: Awaited<ReturnType<typeof completedStoryJob>>,
  model3d: NonNullable<Awaited<ReturnType<typeof model3dReceipt>>>, native: ReturnType<typeof selectNative>,
  ownerId: string, target: { documentId: string; artifactId: string }) {
  const original = job.model3dRequest, snapshot = record(original?.snapshot), payload = model3d.payload;
  if (!original || original.documentId !== target.documentId || !snapshot || !Array.isArray(snapshot.facts)
    || original.itemCount !== 1 || typeof original.documentRevision !== "string" || !original.documentRevision
    || typeof original.requestKey !== "string" || !original.requestKey || !Array.isArray(original.sourceBlockVersions)
    || original.sourceBlockVersions.some(value => {
      const version = record(value);
      return !version || Object.keys(version).length !== 2 || typeof version.block_id !== "string" || !opaque.test(version.block_id)
        || typeof version.version !== "number" || !Number.isSafeInteger(version.version) || version.version < 0;
    }) || new Set(original.sourceBlockVersions.map(value => (value as Record<string, unknown>).block_id)).size !== original.sourceBlockVersions.length
    || JSON.stringify(original.sourceBlockVersions) !== JSON.stringify(payload.source_block_versions)
    || typeof native.completionInputRef !== "string" || !opaque.test(native.completionInputRef)
    || payload.input_ref !== native.completionInputRef || native.completionItemCount !== 0 || payload.item_count !== 0
    || !Array.isArray(payload.items) || payload.items.length !== 0 || payload.presentation !== null) throw unavailable();
  const ids = original.model3dReferenceBlockIds;
  if (!Array.isArray(ids) || ids.length > 5 || ids.some(id => typeof id !== "string" || !opaque.test(id))
    || new Set(ids).size !== ids.length || original.model3dPromptSource !== undefined
      && original.model3dPromptSource !== "exact" && original.model3dPromptSource !== "document"
    || original.model3dPromptSource !== "document" && original.model3dAdaptation !== undefined) throw unavailable();
  const checked = validateModel3dRequest({ prompt: original.model3dPrompt, settings: original.model3dSettings, referenceCount: ids.length });
  if (!checked.valid) throw unavailable();
  // Match the adapter's canonical input digest without importing provider code.
  const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
    return item;
  });
  const bindings = [payload.input_ref as string, ownerId, native.projectId, target.documentId, target.artifactId];
  const row = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${audioInputGuard()}`)
    .bind(...bindings).first<{ content: string; expires_at: string }>();
  if (!row || typeof row.content !== "string" || bytes(row.content) > RETAINED_STORY_JSON_MAX_BYTES
    || typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at)) || new Date(row.expires_at).toISOString() !== row.expires_at) throw unavailable();
  const input = record(JSON.parse(row.content)), request = record(input?.request), render = record(input?.render), settings = record(payload.settings);
  if (!input || input.schema_version !== 1 || input.artifact_id !== target.artifactId || input.artifact_kind !== "model3d"
    || input.document_id !== target.documentId || input.project_id !== native.projectId || !request || !render || !settings
    || input.planner !== null || JSON.stringify(input.document_snapshot) !== JSON.stringify(snapshot)
    || JSON.stringify(input.source_block_versions) !== JSON.stringify(original.sourceBlockVersions)
    || request.source_surface !== "document" || payload.source_surface !== "document"
    || request.model3d_prompt !== original.model3dPrompt || JSON.stringify(request.model3d_reference_block_ids) !== JSON.stringify(ids)
    || stableJson(request.model3d_settings) !== stableJson(checked.settings)
    || stableJson(settings.model3d) !== stableJson(checked.settings) || stableJson(settings.model3d_settings) !== stableJson(checked.settings)
    || stableJson(render.settings) !== stableJson(checked.settings)
    || render.provider !== "fal" || job.model3dProvider !== "fal" || payload.provider !== "fal"
    || render.providerJobId !== job.model3dProviderJobId || payload.provider_job_id !== job.model3dProviderJobId
    || render.model !== checked.model || payload.model_id !== checked.model
    || render.adapterVersion !== RODIN_ADAPTER_VERSION || settings.adapter_version !== RODIN_ADAPTER_VERSION
    || render.submittedPrompt !== original.model3dPrompt || render.submitted_prompt !== original.model3dPrompt
    || render.usedReferencePixels !== (ids.length > 0) || render.used_reference_pixels !== render.usedReferencePixels
    || payload.used_reference_pixels !== render.usedReferencePixels
    || !Array.isArray(render.referenceInputs) || render.referenceInputs.length !== ids.length
    || stableJson(render.reference_inputs) !== stableJson(render.referenceInputs)
    || stableJson(payload.reference_inputs) !== stableJson(render.referenceInputs)
    || render.estimatedCostMicrousd !== checked.estimatedCostMicrousd || request.estimated_cost_microusd !== checked.estimatedCostMicrousd
    || typeof request.reserved_cost_microusd !== "number" || !Number.isSafeInteger(request.reserved_cost_microusd)
    || request.reserved_cost_microusd < checked.estimatedCostMicrousd || settings.reserved_cost_microusd !== request.reserved_cost_microusd
    || settings.settled_cost_microusd !== checked.estimatedCostMicrousd
    || typeof render.seed !== "number" || !Number.isSafeInteger(render.seed) || render.seed < 0 || render.seed > 65535
    || settings.seed !== render.seed) throw unavailable();
  if (original.model3dPromptSource === "document") {
    if (!record(original.model3dAdaptation) || request.model3d_prompt_source !== "document"
      || JSON.stringify(request.model3d_adaptation) !== JSON.stringify(original.model3dAdaptation)) throw unavailable();
  } else if (request.model3d_prompt_source !== undefined || request.model3d_adaptation !== undefined) throw unavailable();
  for (const [index, value] of render.referenceInputs.entries()) {
    const reference = record(value);
    if (!reference || reference.index !== index || reference.blockId !== ids[index]
      || typeof reference.byteLength !== "number" || !Number.isSafeInteger(reference.byteLength) || reference.byteLength <= 0
      || typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(reference.sha256)
      || !["image/jpeg", "image/png", "image/webp"].includes(String(reference.mimeType)) || reference.transport !== "fal-storage-upload"
      || [reference.referenceId, reference.label].some(value => value !== null && typeof value !== "string")) throw unavailable();
  }
  const serialized = serializeRodinInput(original.model3dPrompt as string, checked.settings, ids.map((_, index) => `https://fal.media/reference-${index + 1}`)).input;
  const parameters = Object.fromEntries(Object.entries(serialized).filter(([key]) => key !== "image_urls"));
  if (stableJson(render.parameters) !== stableJson(parameters) || !Array.isArray(render.acceptedFields)
    || stableJson([...render.acceptedFields].sort()) !== stableJson(Object.keys(serialized).sort())
    || render.requestDigest !== await hash(stableJson({ model: checked.model, parameters, referenceInputs: render.referenceInputs }))) throw unavailable();
  const primary = Array.isArray(settings.model3d_files) ? record(settings.model3d_files[0]) : null;
  if (!primary || primary.role !== "mesh" || payload.media_url !== primary.url || payload.media_type !== primary.mimeType
    || settings.source_media_sha256 !== primary.sha256) throw unavailable();
  return { bindings, raw: row.content, expiresAt: row.expires_at, prompt: original.model3dPrompt };
}

/**
 * Authenticated CURRENT personal native revision only. This is neither an
 * Experience result nor generation/custody authority. All database operations
 * here are fixed SELECTs; no provider, budget, repair or writer entry.
 * Native mini-app Storyboard additionally re-reads its four original private
 * MEDIA objects with request-abort and retained-content deadline bounds.
 * Runtime/import/SQL qualification is separate from this detached source.
 */
async function readCurrentRetainedNative(request: Request, env: WorkerEnv, nativeOutput: NativeRetainedOutputTarget | null, nativeCompletion: NativeOutputCompletion | null = null): Promise<Response> {
  if (request.method !== "GET") return error("method_not_allowed", 405);
  const handle = nativeCompletion?.handle ?? (nativeOutput ? null : parseNativeStoryCompletionUrl(request.url));
  let selection = nativeOutput?.selection ?? parseRetainedStoryRequestUrl(request.url);
  if (!selection && !handle) return error("invalid_retained_story_selection", 400);
  let storyboardDiagnosticStage:StoryboardReadStage|undefined;
  const storyboardDiagnosticTarget=(nativeCompletion?.output??nativeOutput?.output)==="storyboard";
  try {
    const identity = hostedIdentity(request);
    if (!identity) return error("authentication_required", 401);
    const { auth, principal } = await readNativeRetainedPrincipal(env, identity);
    if(storyboardDiagnosticTarget)storyboardDiagnosticStage="read_selection";
    const streamId = `creative:${identity.userId}`;
    const job = handle ? await completedStoryJob(env, handle, identity.userId, streamId, nativeCompletion?.output ?? null) : null;
    const target = job && handle ? {documentId:handle.documentId,artifactId:job.artifactId,revision:0} : selection!;
    const { snapshot, native } = await readNativeRetainedSelection(env, identity, target,
      nativeCompletion?.output ?? nativeOutput?.output ?? "short_story", job?.completionId,
      job?.requestedSlideCount ?? job?.requestedFrameCount ?? (nativeCompletion?.output === "audio" ? 1 : nativeCompletion?.output === "model3d" ? 0 : undefined));
    if(storyboardDiagnosticTarget)storyboardDiagnosticStage="read_receipt";
    const storyboard = (nativeCompletion?.output ?? nativeOutput?.output) === "storyboard" ? await storyboardReceipt(env, native, identity.userId, target) : null;
    const model3d = (nativeCompletion?.output ?? nativeOutput?.output) === "model3d" ? await model3dReceipt(env, native, identity.userId, target) : null;
    const video = (nativeCompletion?.output ?? nativeOutput?.output) === "video" ? await videoReceipt(env, native, identity.userId, target) : null;
    const audio = (nativeCompletion?.output ?? nativeOutput?.output) === "audio" ? await audioReceipt(env, native, identity.userId, target) : null;
    const audioInput = nativeCompletion?.output === "audio" && job && audio
      ? await audioCompletionInput(env, job, audio, native, identity.userId, target) : null;
    const videoInput = nativeCompletion?.output === "video" && job && video
      ? await videoCompletionInput(env, job, video, native, identity.userId, target) : null;
    const model3dInput = nativeCompletion?.output === "model3d" && job && model3d
      ? await model3dCompletionInput(env, job, model3d, native, identity.userId, target) : null;
    const completionInput = audioInput ?? videoInput ?? model3dInput;
    if(storyboardDiagnosticTarget)storyboardDiagnosticStage="read_content";
    const retained = await readNativeRetainedContent(env, identity, target, native);
    const { contentBindings, source, body } = retained;
    selection ??= retained.selection;
    if(storyboardDiagnosticTarget)storyboardDiagnosticStage="read_evidence";
    let storyboardRead:Awaited<ReturnType<typeof readRetainedOutputStoryboard>>|null=null;
    if(storyboard&&(storyboard.payload.source_surface==="outputs"||Object.hasOwn(record(storyboard.payload.settings)??{},"output_storyboard"))){
      if(selection.revision!==0||native.latestEditId||typeof native.completionInputRef!=="string"||!opaque.test(native.completionInputRef))throw unavailable();
      try{storyboardRead=await readRetainedOutputStoryboard(env,{ownerId:identity.userId,completionId:native.completionId,
        documentId:selection.documentId,projectId:native.projectId,artifactId:selection.artifactId,contentId:native.contentId,
        inputId:native.completionInputRef,rawContent:source.content,contentExpiresAt:source.expires_at,completionRaw:storyboard.raw,signal:request.signal});}
      catch(failure){const refused=unavailable();const stage=storyboardReadFailureDiagnostic(failure);if(stage)recordStoryboardReadFailure(refused,stage);throw refused;}
    }
    let videoRead:Awaited<ReturnType<typeof readRetainedOutputVideo>>|null=null;
    if(video&&(video.payload.source_surface==="outputs"||Object.hasOwn(record(video.payload.settings)??{},"output_video"))){
      if(selection.revision!==0||native.latestEditId||typeof native.completionInputRef!=="string"||!opaque.test(native.completionInputRef))throw unavailable();
      try{videoRead=await readRetainedOutputVideo(env,{ownerId:identity.userId,completionId:native.completionId,documentId:selection.documentId,
        projectId:native.projectId,artifactId:selection.artifactId,contentId:native.contentId,inputId:native.completionInputRef,
        rawContent:source.content,contentExpiresAt:source.expires_at,completionRaw:video.raw,signal:request.signal});}catch{throw unavailable();}
    }
    const audioEdit = audio ? await audioEditReceipt(env, native, identity.userId, selection, body, audio) : null;
    const videoEdit = video ? await videoEditReceipt(env, native, identity.userId, selection, body, video) : null;
    const model3dEdit = model3d ? await model3dEditReceipt(env, native, identity.userId, selection, body, model3d) : null;
    let model3dRead: Awaited<ReturnType<typeof readRetainedOutputModel3d>> | null = null;
    if (model3d && selection.revision === 0 && Object.hasOwn(record(model3d.payload.settings) ?? {}, "output_model3d")) {
      if (native.latestEditId || typeof native.completionInputRef !== "string" || !opaque.test(native.completionInputRef)) throw unavailable();
      try { model3dRead = await readRetainedOutputModel3d(env, { ownerId: identity.userId, completionId: native.completionId,
        documentId: selection.documentId, projectId: native.projectId, artifactId: selection.artifactId, contentId: native.contentId,
        inputId: native.completionInputRef, rawContent: source.content, contentExpiresAt: source.expires_at, completionRaw: model3d.raw, signal: request.signal }); }
      catch { throw unavailable(); }
    }
    const retainedExpiresAt = videoRead?.expiresAt ?? model3dRead?.expiresAt ?? storyboardRead?.expiresAt ?? (model3dEdit?.source && Date.parse(model3dEdit.source.expiresAt) < Date.parse(source.expires_at)
      ? model3dEdit.source.expiresAt : source.expires_at);
    if(storyboardDiagnosticTarget)storyboardDiagnosticStage="read_dto";
    const outputTarget = nativeCompletion ? { output: nativeCompletion.output, selection } : nativeOutput;
    const dto = outputTarget
      ? projectNativeRetainedOutput(outputTarget, body, retainedExpiresAt, native.sceneMedium, {
        storyboardItems: storyboard?.items ?? null, model3dReceipt: model3d?.payload ?? null, audioReceipt: audio?.payload ?? null,
        ...(audioEdit?.revision ? { audioRevision: audioEdit.revision } : {}), videoReceipt: video?.payload ?? null,
        ...(videoEdit?.revision ? { videoRevision: videoEdit.revision } : {}),
        ...(model3dEdit?.revision ? { model3dRevision: model3dEdit.revision } : {}) })
      : validateRetainedStoryDto({ schemaVersion: 1, kind: "native-retained-short-story",
        selection, title: body.title, contentMarkdown: body.content_markdown, expiresAt: source.expires_at }, selection);
    if (!dto || nativeCompletion?.output === "scene" && body.items.length !== 1
      || nativeCompletion?.output === "slides" && body.items.length !== job?.requestedSlideCount
      || nativeCompletion?.output === "storyboard" && body.items.length !== job?.requestedFrameCount
      || nativeCompletion?.output === "audio" && (body.items.length !== 1 || dto.kind !== "native-retained-output" || dto.output !== "audio"
        || !dto.content.media || record(audio?.payload.settings)?.item_count !== 1
        || record(audio?.payload.settings)?.production_mode !== "manual")
      || nativeCompletion?.output === "video" && (body.items.length !== videoInput?.itemCount
        || dto.kind !== "native-retained-output" || dto.output !== "video" || !dto.content.primaryMedia)
      || nativeCompletion?.output === "model3d" && (body.items.length !== 0 || body.presentation !== null
        || body.content_markdown !== model3dInput?.prompt || dto.kind !== "native-retained-output" || dto.output !== "model3d"
        || dto.content.files.length === 0)) throw unavailable();
    const sourceCompletionExpiry = job && Date.parse(job.expiresAt)<Date.parse(retainedExpiresAt)?job.expiresAt:retainedExpiresAt;
    const completionExpiry = completionInput && Date.parse(completionInput.expiresAt) < Date.parse(sourceCompletionExpiry)
      ? completionInput.expiresAt : sourceCompletionExpiry;
    const completion = job && handle ? nativeCompletion?.output === "model3d"
      ? validateNativeModel3dCompletion({schemaVersion:1,kind:"native-model3d-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : nativeCompletion?.output === "video"
      ? validateNativeVideoCompletion({schemaVersion:1,kind:"native-video-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : nativeCompletion?.output === "audio"
      ? validateNativeAudioCompletion({schemaVersion:1,kind:"native-audio-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : nativeCompletion?.output === "storyboard"
      ? validateNativeStoryboardCompletion({schemaVersion:1,kind:"native-storyboard-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : nativeCompletion?.output === "slides"
      ? validateNativeSlidesCompletion({schemaVersion:1,kind:"native-slides-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : nativeCompletion?.output === "scene"
      ? validateNativeSceneCompletion({schemaVersion:1,kind:"native-scene-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : validateNativeStoryCompletion({schemaVersion:1,kind:"native-short-story-completion",handle,
        selection,expiresAt:completionExpiry},handle) : null;
    if (job && !completion) throw unavailable();
    const serialized = JSON.stringify(completion ?? dto);
    if (bytes(serialized) > RETAINED_STORY_JSON_MAX_BYTES) throw unavailable();
    // One final SELECT rechecks the exact auth and operational snapshots, all
    // source-redaction/scope metadata, personal custody and exact raw content.
    // The witness is a closed array generated above, never caller-supplied SQL.
    if(storyboardDiagnosticTarget)storyboardDiagnosticStage="read_final_witness";
    const final = await env.DB.prepare(`WITH ${auth.cte},${eventCte}${job?`,${nativeCompletion ? nativeCompletionJobCte(nativeCompletion.output) : jobCte}`:""},
      ${storyboardRead?`storyboard_witness AS (SELECT ? AS bindings),storyboard_proof AS MATERIALIZED (SELECT CASE WHEN (${storyboardRead.witness.sql}) THEN 1 ELSE 0 END AS permitted),`:""}${model3dRead?`model3d_witness AS (SELECT ? AS bindings),model3d_proof AS MATERIALIZED (SELECT CASE WHEN (${model3dRead.witness.sql}) THEN 1 ELSE 0 END AS permitted),`:""}${videoRead?`video_witness AS (SELECT ? AS bindings),video_proof AS MATERIALIZED (SELECT CASE WHEN (${videoRead.witness.sql}) THEN 1 ELSE 0 END AS permitted),`:""}expected_events AS (SELECT value FROM json_each(?))
      SELECT 1 AS admitted FROM private_content WHERE ${nativeRetainedSourceFinalGuard()}
        ${job?"AND EXISTS(SELECT 1 FROM bounded_story_job WHERE CAST(job_json AS BLOB)=CAST(? AS BLOB))":""}
        ${storyboard?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${storyboardReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${storyboardRead?"AND (SELECT permitted FROM storyboard_proof)=1":""}${videoRead?"AND (SELECT permitted FROM video_proof)=1":""}
        ${model3dRead?"AND (SELECT permitted FROM model3d_proof)=1":""}
        ${model3d?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${model3dReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${video?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${videoReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${audio?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${audioReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${audioEdit?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${audioReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${videoEdit?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${videoReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${videoEdit?.source?`AND EXISTS(SELECT 1 FROM artifact_revisions WHERE ${videoSourceRevisionGuard()} AND CAST(content_json AS BLOB)=CAST(? AS BLOB) AND expires_at=?)`:""}
        ${videoEdit?.source?.edit?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${videoReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${model3dEdit?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${model3dReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${model3dEdit?.source?`AND EXISTS(SELECT 1 FROM artifact_revisions WHERE ${model3dSourceRevisionGuard()} AND CAST(content_json AS BLOB)=CAST(? AS BLOB) AND expires_at=?)`:""}
        ${model3dEdit?.source?.edit?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${model3dReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${model3dEdit?.originalReset?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${model3dReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${completionInput?`AND EXISTS(SELECT 1 FROM private_content WHERE ${audioInputGuard()} AND CAST(content AS BLOB)=CAST(? AS BLOB) AND expires_at=?)`:""}`)
      .bind(...auth.bindings, streamId, ...(job?.bindings??[]), ...(storyboardRead?[storyboardRead.witness.json]:[]), ...(model3dRead?[model3dRead.witness.json]:[]), ...(videoRead?[videoRead.witness.json]:[]), snapshot, ...contentBindings, source.content, source.expires_at, principal.auth_json, ...(job?[job.snapshot]:[]), ...(storyboard?[...storyboard.bindings,storyboard.raw]:[]), ...(model3d?[...model3d.bindings,model3d.raw]:[]), ...(video?[...video.bindings,video.raw]:[]), ...(audio?[...audio.bindings,audio.raw]:[]), ...(audioEdit?[...audioEdit.bindings,audioEdit.raw]:[]), ...(videoEdit?[...videoEdit.bindings,videoEdit.raw]:[]), ...(videoEdit?.source?[...videoEdit.source.bindings,videoEdit.source.raw,videoEdit.source.expiresAt]:[]), ...(videoEdit?.source?.edit?[...videoEdit.source.edit.bindings,videoEdit.source.edit.raw]:[]), ...(model3dEdit?[...model3dEdit.bindings,model3dEdit.raw]:[]), ...(model3dEdit?.source?[...model3dEdit.source.bindings,model3dEdit.source.raw,model3dEdit.source.expiresAt]:[]), ...(model3dEdit?.source?.edit?[...model3dEdit.source.edit.bindings,model3dEdit.source.edit.raw]:[]), ...(model3dEdit?.originalReset?[...model3dEdit.originalReset.bindings,model3dEdit.originalReset.raw]:[]), ...(completionInput?[...completionInput.bindings,completionInput.raw,completionInput.expiresAt]:[]))
      .first<{ admitted: number }>();
    if(storyboardDiagnosticTarget&&final?.admitted===1)storyboardDiagnosticStage="read_final_lifetime";
    if (final?.admitted !== 1 || Date.parse(source.expires_at) <= Date.now() || job && Date.parse(job.expiresAt) <= Date.now()
      || storyboardRead && (Date.parse(storyboardRead.expiresAt)<=Date.now()||request.signal.aborted)
      || model3dRead && (Date.parse(model3dRead.expiresAt)<=Date.now()||request.signal.aborted)
      || videoRead && (Date.parse(videoRead.expiresAt)<=Date.now()||request.signal.aborted)
      || videoEdit?.source && Date.parse(videoEdit.source.expiresAt) <= Date.now()
      || model3dEdit?.source && Date.parse(model3dEdit.source.expiresAt) <= Date.now()
      || completionInput && Date.parse(completionInput.expiresAt) <= Date.now()) throw unavailable();
    // No asynchronous work occurs between the final read and literal response.
    return new Response(serialized, { status: 200, headers });
  } catch (failure) {
    if(storyboardDiagnosticStage)logStoryboardReadFailure(failure,storyboardDiagnosticStage);
    if (failure instanceof Unavailable) {
      const denied = failure.message === "personal_principal_required" || failure.message === "retained_story_access_denied";
      return error(denied ? failure.message : "retained_story_unavailable", denied ? 403 : 404);
    }
    // Missing schema, adapter failures and invalid stored JSON remain opaque.
    return error("retained_story_unavailable", 503);
  }
}

/** Preserve the original Short Story read and completed-job protocol. */
export function handleRetainedStoryRead(request: Request, env: WorkerEnv): Promise<Response> {
  return readCurrentRetainedNative(request, env, null);
}

/** Native outputs use the current personal read witness, with no generation or media authority. */
export function handleNativeRetainedOutputRead(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "GET") return Promise.resolve(error("method_not_allowed", 405));
  const sceneHandle = parseNativeSceneCompletionUrl(request.url);
  if (sceneHandle) return readCurrentRetainedNative(request, env, null, { output: "scene", handle: sceneHandle });
  const slidesHandle = parseNativeSlidesCompletionUrl(request.url);
  if (slidesHandle) return readCurrentRetainedNative(request, env, null, { output: "slides", handle: slidesHandle });
  const storyboardHandle = parseNativeStoryboardCompletionUrl(request.url);
  if (storyboardHandle) return readCurrentRetainedNative(request, env, null, { output: "storyboard", handle: storyboardHandle });
  const audioHandle = parseNativeAudioCompletionUrl(request.url);
  if (audioHandle) return readCurrentRetainedNative(request, env, null, { output: "audio", handle: audioHandle });
  const model3dHandle = parseNativeModel3dCompletionUrl(request.url);
  if (model3dHandle) return readCurrentRetainedNative(request, env, null, { output: "model3d", handle: model3dHandle });
  const videoHandle = parseNativeVideoCompletionUrl(request.url);
  if (videoHandle) return readCurrentRetainedNative(request, env, null, { output: "video", handle: videoHandle });
  const target = parseNativeRetainedOutputRequestUrl(request.url);
  if (!target) return Promise.resolve(error("invalid_native_retained_output_selection", 400));
  return readCurrentRetainedNative(request, env, target);
}

/** Internal reuse boundary for a separately observed current-media proof. These
 * are the exact functions used above, not an HTTP/authentication adapter. The
 * bundle supplies no caller identity, publication right or selected byte access. */
export const nativeRetainedMediaReceiptReaders = Object.freeze({
  audio: Object.freeze({ receipt: audioReceipt, edit: audioEditReceipt, receiptGuard: audioReceiptGuard }),
  video: Object.freeze({ receipt: videoReceipt, edit: videoEditReceipt, receiptGuard: videoReceiptGuard,
    sourceGuard: videoSourceRevisionGuard }),
  model3d: Object.freeze({ receipt: model3dReceipt, edit: model3dEditReceipt, receiptGuard: model3dReceiptGuard,
    sourceGuard: model3dSourceRevisionGuard }),
});
