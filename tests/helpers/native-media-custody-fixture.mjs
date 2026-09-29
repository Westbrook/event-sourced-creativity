import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { outputTestDatabase, registerOutputSourceImports } from "../output-server-test-helpers.mjs";
import { wav, png, join, utf8 } from "../output-asset-fixtures.mjs";
import { ownerMediaNamespace } from "../../src/model/media-ownership.ts";
import { SELECTED_OUTPUT_SHARE_AUDIO_POLICY } from "../../src/model/selected-output-share-audio.ts";
import { SELECTED_OUTPUT_SHARE_VIDEO_POLICY, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY } from "../../src/model/selected-output-share-video.ts";
import { SELECTED_OUTPUT_SHARE_MODEL3D_POLICY, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY } from "../../src/model/selected-output-share-model3d.ts";
const imports = registerOutputSourceImports();
let ensureSchema, appendAuditEvent, handleNativeRetainedOutputRead, nativeRetainedOutputRequestPath;
let trimPcmWav, inspectPcmWav, trimVideoPrefix, inspectVideoPrefix, scaleModel3dGeometry;
let parseAudioMediaRevision, parseVideoMediaRevision, parseVideoTrimEditRequest, parseAudioTrimOperationRequest, parseModel3dMediaRevision, parseModel3dScaleEditRequest;
try {
  ({ ensureSchema, appendAuditEvent } = await import("../../worker/runtime.ts"));
  ({ handleNativeRetainedOutputRead } = await import("../../worker/retained-story-api.ts"));
  ({ nativeRetainedOutputRequestPath } = await import("../../src/model/native-retained-output.ts"));
  ({ trimPcmWav, inspectPcmWav } = await import("../../src/model/audio-container.ts"));
  ({ trimVideoPrefix, inspectVideoPrefix } = await import("../../src/model/video-container.ts"));
  ({ scaleModel3dGeometry } = await import("../../src/model/model3d-geometry-edit.ts"));
  ({ parseAudioMediaRevision, parseVideoMediaRevision, parseVideoTrimEditRequest } = await import("../../src/model/document-artifacts.ts"));
  ({ parseAudioTrimOperationRequest } = await import("../../src/model/audio-local-conversion.ts"));
  ({ parseModel3dMediaRevision } = await import("../../src/model/model3d-media-revision.ts"));
  ({ parseModel3dScaleEditRequest } = await import("../../src/model/model3d-artifact-revision.ts"));
} finally { imports.deregister(); }

export const OWNER = "custody-media-owner", EMAIL = "custody-media-owner@example.test";
export const DOCUMENT = "custody-document", PROJECT = "custody-personal-project", ARTIFACT = "custody-artifact", CONTENT = "custody-content";
export const EXPIRY = "2099-01-01T00:00:00.000Z";
export const digest = value => createHash("sha256").update(value).digest("hex");
// Test-only bytes reused from the independently qualified media gate fixtures.
// These synthetic assets make no provider call and contain no real private media.
const videoFixture = () => new Uint8Array(Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAK7bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABam1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASpzdGJsAAAAqnN0c2QAAAAAAAAAAQAAAJphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADABA8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAABMAAAAMAAAAFHN0Y28AAAAAAAAAAQAAAusAAAAIZnJlZQAAACdtZGF0AAAAD2WIhAAU//73x0/ApurcJwAAAAhBmiFsQS/+4A==", "base64"));
const encoderFixture = () => new Uint8Array(Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAK7bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABam1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASpzdGJsAAAAqnN0c2QAAAAAAAAAAQAAAJphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADABA8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAAwwAAAAMAAAAFHN0Y28AAAAAAAAAAQAAAusAAAAIZnJlZQAAAyBtZGF0AAAC9QYF///x3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2MyByMzA2MCA1ZGI2YWE2IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTEgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9MiBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MCA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0wIHRocmVhZHM9NiBsb29rYWhlYWRfdGhyZWFkcz0yIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MSBrZXlpbnQ9MjUwIGtleWludF9taW49MjQgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD0xMCByYz1hYnIgbWJ0cmVlPTEgYml0cmF0ZT0xMTQ5IHJhdGV0b2w9MS4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCB2YnZfbWF4cmF0ZT0xNzI0IHZidl9idWZzaXplPTIyOTkgbmFsX2hyZD1ub25lIGZpbGxlcj0wIGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEABT//vfHT8Cm6twnAAAACEGaIWxBL/7g", "base64"));
// Frozen test-only four-picture 32x18 baseline donor, derived offline from
// ownedSocialVideo("16:9") by removing its descriptive metadata/SEI and
// updating exact sample lengths/offsets; encoded picture bytes are unchanged.
// SHA256 8d9ec98b7b832d39124eec993af5dce5140174ab0fce33dc209b3c1977d28ac2.
const editableVideoFixture = () => new Uint8Array(Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAK/bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkt0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAASAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHDbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABbm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAS5zdGJsAAAApnN0c2QAAAAAAAAAAQAAAJZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAEgBIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMGF2Y0MBQsAe/+EAGGdCwB7ZCX4jARAAAAMAEAAAAwBA8WLkgAEABWjLg8sgAAAAEHBhc3AAAAABAAAAAQAAABhzdHRzAAAAAAAAAAEAAAAEAAAgAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAEAAAAAQAAACRzdHN6AAAAAAAAAAAAAAAEAAAAGgAAAAoAAAAKAAAACgAAABRzdGNvAAAAAAAAAAEAAALvAAAACGZyZWUAAABAbWRhdAAAABZliIQFPEYoAA4mxwABoCjgACLvJ114AAAABkGaOAp5YAAAAAZBmlQCnlgAAAAGQZpgEvLA", "base64"));
function glb(textured = false) {
  const model = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }], buffers: [{ byteLength: 36 }], bufferViews: [], accessors: [] };
  const parts = [];
  const append = bytes => {
    const used = parts.reduce((sum, part) => sum + part.length, 0), offset = Math.ceil(used / 4) * 4;
    if (offset > used) parts.push(new Uint8Array(offset - used));
    const index = model.bufferViews.length; parts.push(bytes); model.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); return index;
  };
  const add = (values, type, components, bounds = {}) => {
    const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat32(index * 4, value, true));
    model.accessors.push({ bufferView: append(bytes), componentType: 5126, count: values.length / components, type, ...bounds });
  };
  add([0, 0, 0, 1, 0, 0, 0, 1, 0], "VEC3", 3, { min: [0, 0, 0], max: [1, 1, 0] });
  if (textured) {
    add([0, 0, 1, 0, 0, 1, 0, 0, 1], "VEC3", 3); add([0, 0, 1, 0, 0, 1], "VEC2", 2);
    model.meshes[0].primitives[0].attributes.NORMAL = 1; model.meshes[0].primitives[0].attributes.TEXCOORD_0 = 2;
    model.meshes[0].primitives[0].material = 0;
    model.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    model.textures = [{ source: 0 }]; model.images = [{ bufferView: append(png()), mimeType: "image/png" }];
  }
  const bin = join(...parts); model.buffers[0].byteLength = bin.length;
  const json = utf8(JSON.stringify(model)), jsonLength = Math.ceil(json.length / 4) * 4, binLength = Math.ceil(bin.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + binLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(bin, 28 + jsonLength); return bytes;
}

export function syntheticMediaBytes(output, { textured = false, encoder = false, editable = false } = {}) {
  if (output === "audio") return wav();
  if (output === "video") return editable ? editableVideoFixture() : encoder ? encoderFixture() : videoFixture();
  if (output === "model3d") return glb(textured);
  throw new Error("Unknown synthetic media output");
}
export function syntheticMediaPolicy(output, { textured = false, encoder = false } = {}) {
  if (output === "audio") return SELECTED_OUTPUT_SHARE_AUDIO_POLICY;
  if (output === "video") return encoder ? SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY : SELECTED_OUTPUT_SHARE_VIDEO_POLICY;
  if (output === "model3d") return textured ? SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY : SELECTED_OUTPUT_SHARE_MODEL3D_POLICY;
  throw new Error("Unknown synthetic media output");
}
export const syntheticMediaUrl = (name, owner = OWNER) => `/api/media/${encodeURIComponent(`${ownerMediaNamespace(owner)}/generated/${name}`)}`;

/** Actual SQLite, canonical schema/events and ordinary hosted reader. Only
 * synthetic seed writes use state.env; every observed custody read is SELECT
 * only and every R2 get is counted. No reader or projection is replaced. */
export async function nativeMediaFixture(t, output, options = {}) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env);
  const now = new Date().toISOString(), stream = `creative:${OWNER}`;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Synthetic retained owner", "creator", "pilot-2026-08-10", now, now, now);
  const bytes = options.bytes ?? syntheticMediaBytes(output, options), mediaHash = digest(bytes);
  const mimeType = output === "audio" ? "audio/wav" : output === "video" ? "video/mp4" : "model/gltf-binary";
  const fileName = output === "audio" ? "original.wav" : output === "video" ? "original.mp4" : "original.glb";
  const url = syntheticMediaUrl(fileName), key = decodeURIComponent(url.slice("/api/media/".length));
  const items = output === "model3d" ? [] : [{ title: "Private retained item", body: "Private item body.", notes: "Private notes", image_prompt: "", slide: null }];
  let raw = JSON.stringify({ title: "Private original title", summary: "Private summary", content_markdown: "Private original prose.", presentation: null, items });
  const settings = output === "audio" ? { audio_role: "voice", lyrics: "Private lyrics", audio_synthid_watermarked: true,
    source_media_sha256: mediaHash, duration_seconds: 0.5, estimated_duration_seconds: null, duration_basis: "media-container",
    duration_media_url: url, duration_media_sha256: mediaHash }
    : output === "video" ? { source_media_sha256: mediaHash }
    : { model3d_files: [{ url, mimeType, fileName, fileSize: bytes.length, format: "glb", role: "mesh", sha256: mediaHash, previewSupported: true }] };
  await appendAuditEvent(state.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Private Document" });
  const completion = await appendAuditEvent(state.env, stream, "worker:renderer", "DocumentRenderCompleted", {
    document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: output,
    requested_by_user_id: OWNER, title: "Private completion title", content_ref: CONTENT,
    input_ref: `original-${output}-input`, item_count: items.length, media_url: url, media_type: mimeType, settings,
    ...(output === "video" ? { items: [{ id: "clip-one", title: "Private clip", media_url: url, media_type: mimeType, duration_seconds: options.editable ? 2 : 1 }] } : {}),
    ...options.completionPayload,
  });
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  state.media.set(key, { bytes: new Uint8Array(bytes), contentType: mimeType, metadata: { ownerId: OWNER, artifactId: ARTIFACT,
    source: "provider-generated-media", model: "synthetic-fixture", sha256: mediaHash, mimeType,
    ...(output === "audio" ? { durationSeconds: "0.5", sampleRate: "8000" } : {}),
    ...(output === "video" ? { durationSeconds: options.editable ? "2" : "1", width: options.editable ? "32" : "16", height: options.editable ? "18" : "16" } : {}),
    ...(output === "model3d" ? { modelFormat: "glb", modelPreviewSafe: "true" } : {}),
  } });
  const calls = [], mediaCalls = [], forbidden = [];
  let beforeRead = null, beforeMediaGet = null;
  const DB = { prepare(sql) {
    if (!/^\s*(?:WITH|SELECT)\b/iu.test(sql)) { forbidden.push(sql); throw new Error("Custody prepared a writer"); }
    const prepared = state.DB.prepare(sql);
    const statement = bindings => ({ bind: (...values) => statement(values), async first() {
      calls.push(sql); if (beforeRead) await beforeRead(sql, bindings); return prepared.bind(...bindings).first();
    }, async all() {
      calls.push(sql); if (beforeRead) await beforeRead(sql, bindings); return prepared.bind(...bindings).all();
    } });
    return statement([]);
  }, batch() { forbidden.push("batch"); throw new Error("Custody may not write"); } };
  const MEDIA = { async get(selectedKey) {
    mediaCalls.push(selectedKey); if (beforeMediaGet) await beforeMediaGet(selectedKey);
    return state.env.MEDIA.get(selectedKey);
  }, head() { forbidden.push("head"); throw new Error("Custody must not reread through head"); },
  put() { forbidden.push("put"); throw new Error("Custody may not store media"); },
  delete() { forbidden.push("delete"); throw new Error("Custody may not remove media"); },
  list() { forbidden.push("list"); throw new Error("Custody may not enumerate media"); } };
  const env = { ...state.env, DB, MEDIA, ASSETS: { fetch() { forbidden.push("fetch"); throw new Error("Custody may not fetch"); } } };
  const identity = Object.freeze({ userId: OWNER, email: EMAIL, source: "openai-workspace" });
  const select = (revision = 0, overrides = {}) => ({ output, policy: syntheticMediaPolicy(output, options), documentId: DOCUMENT,
    artifactId: ARTIFACT, revision, contentSha256: digest(raw), mediaSha256: mediaHash, ...overrides });
  const readNative = (selection = select()) => handleNativeRetainedOutputRead(new Request(`https://forma.test${nativeRetainedOutputRequestPath({ output, selection: {
    documentId: selection.documentId, artifactId: selection.artifactId, revision: selection.revision, contentSha256: selection.contentSha256,
  } })}`, { headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL } }), env);
  const replace = value => { raw = typeof value === "string" ? value : JSON.stringify(value);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT); };
  const append = (type, payload) => appendAuditEvent(state.env, stream, "user", type, { project_id: PROJECT, document_id: DOCUMENT, ...payload });
  const privatePayload = (eventId = completion.eventId) => JSON.parse(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId).private_json);
  const changePrivate = (change, eventId = completion.eventId) => {
    const payload = privatePayload(eventId); change(payload);
    state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(payload), eventId);
  };
  t.after(() => assert.deepEqual(forbidden, [], "Caught forbidden operations still fail the fixture"));
  return { ...state, baseEnv: state.env, env, identity, select, readNative, currentBytes: bytes, url, key, mimeType,
    calls, mediaCalls, forbidden, completion, output, currentRevision: 0, originalRaw: raw, originalBytes: bytes, originalUrl: url, originalKey: key, raw: () => raw, replace, append, privatePayload, changePrivate,
    changes: () => state.sqlite.prepare("SELECT total_changes() AS count").get().count,
    setBeforeRead(value) { beforeRead = value; }, setBeforeMediaGet(value) { beforeMediaGet = value; } };
}

export function retainMediaSourceSnapshot(f, revision = f.currentRevision, raw = f.raw(), expiresAt = EXPIRY) {
  f.sqlite.prepare("INSERT OR IGNORE INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at) VALUES(?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,NULL)")
    .run(`custody-snapshot-${revision}`, OWNER, PROJECT, DOCUMENT, ARTIFACT, revision, raw, digest(raw), OWNER, new Date().toISOString(), expiresAt);
}
/** Performs a local synthetic byte operation, then seeds its actual closed
 * native edit records. This is not an artifact Save endpoint or provider test. */
export async function retainAuthoredMedia(f, options = {}) {
  const sourceRaw = f.raw(), sourceBytes = f.currentBytes, sourceUrl = f.url, sourceHash = digest(sourceBytes);
  const sourceRevision = f.currentRevision, number = sourceRevision + 1;
  retainMediaSourceSnapshot(f, sourceRevision, sourceRaw, options.sourceExpiresAt ?? EXPIRY);
  const fileName = `derivative-${number}.${f.output === "audio" ? "wav" : f.output === "video" ? "mp4" : "glb"}`;
  const url = syntheticMediaUrl(fileName), key = decodeURIComponent(url.slice("/api/media/".length));
  let result, revision, request;
  if (f.output === "audio") {
    const source = inspectPcmWav(sourceBytes);
    result = trimPcmWav(sourceBytes, 0, Math.floor(source.frameCount / 2)); assert.ok(result?.changed);
    revision = parseAudioMediaRevision({ schemaVersion: 1, operation: "trim",
      media: { url, mediaType: f.mimeType, sha256: digest(result.bytes), byteLength: result.bytes.length },
      source: { url: sourceUrl, sha256: sourceHash, revision: sourceRevision, contentSha256: digest(sourceRaw), frameCount: source.frameCount },
      startFrame: 0, endFrame: result.endFrame, sampleRate: source.sampleRate, channels: source.channels, bitsPerSample: 16,
      frameCount: result.frameCount, durationSeconds: result.durationSeconds });
    request = parseAudioTrimOperationRequest({ expectedRevision: sourceRevision, expectedContentSha256: digest(sourceRaw),
      audioTrim: { sourceMediaSha256: sourceHash, sourceFrameCount: source.frameCount, startFrame: 0,
        endFrame: result.endFrame, resultMediaSha256: digest(result.bytes) } });
  } else if (f.output === "video") {
    const source = await inspectVideoPrefix(sourceBytes); assert.ok(source);
    result = await trimVideoPrefix(sourceBytes, { startSample: 0, endSample: source.sampleCount - 1 }); assert.ok(result?.changed);
    const { sampleCount, timescale, durationTicks, durationSeconds, width, height } = result.info;
    revision = parseVideoMediaRevision({ schemaVersion: 1, operation: "prefix-trim",
      media: { url, mediaType: f.mimeType, sha256: digest(result.bytes), byteLength: result.bytes.length },
      source: { url: sourceUrl, sha256: sourceHash, revision: sourceRevision, contentSha256: digest(sourceRaw), itemId: "clip-one",
        sampleCount: source.sampleCount, timescale: source.timescale, durationTicks: source.durationTicks, width: source.width, height: source.height },
      startSample: 0, endSample: sampleCount, sampleCount, timescale, durationTicks, durationSeconds, width, height });
    request = parseVideoTrimEditRequest({ expectedRevision: sourceRevision, expectedContentSha256: digest(sourceRaw),
      videoTrim: { sourceMediaSha256: sourceHash, sourceSampleCount: source.sampleCount, startSample: 0,
        endSample: sampleCount, resultMediaSha256: digest(result.bytes) } });
  } else {
    result = scaleModel3dGeometry(sourceBytes, 2); assert.ok(result.changed);
    revision = parseModel3dMediaRevision({ schemaVersion: 1, operation: "uniform-scale",
      media: { url, mediaType: f.mimeType, sha256: digest(result.bytes), byteLength: result.bytes.length, fileName },
      source: { url: sourceUrl, sha256: sourceHash, byteLength: sourceBytes.length, revision: sourceRevision, contentSha256: digest(sourceRaw) },
      factor: result.factor, beforeBounds: result.beforeBounds, afterBounds: result.afterBounds,
      vertexCount: result.vertexCount, positionAccessorCount: result.positionAccessorCount });
    request = parseModel3dScaleEditRequest({ expectedRevision: sourceRevision, expectedContentSha256: digest(sourceRaw),
      model3dScale: { sourceMediaSha256: sourceHash, factor: result.factor, resultMediaSha256: digest(result.bytes) } });
  }
  assert.ok(revision, "Synthetic edit satisfies the actual closed native revision parser"); assert.ok(request);
  const marker = `${f.output}_revision`;
  f.replace({ ...JSON.parse(sourceRaw), [marker]: revision });
  const event = await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: f.output, content_ref: CONTENT,
    revision: number, content_sha256: digest(f.raw()), edited_by_user_id: OWNER, [marker]: revision,
    source_surface: f.output === "model3d" ? "document-artifact-model3d-scale" : `document-artifact-${f.output}-trim`, changed_fields: [marker] });
  f.media.set(key, { bytes: new Uint8Array(result.bytes), contentType: f.mimeType, metadata: {
    ownerId: OWNER, artifactId: ARTIFACT, source: `authored-${f.output}-edit`, sha256: revision.media.sha256, mimeType: f.mimeType,
    sourceMediaSha256: sourceHash, sourceRevision: String(sourceRevision), requestSha256: digest(JSON.stringify(request)),
    ...(f.output === "audio" ? { durationSeconds: String(revision.durationSeconds), sampleRate: String(revision.sampleRate) } : {}),
    ...(f.output === "video" ? Object.fromEntries(["durationSeconds", "sampleCount", "timescale", "durationTicks", "width", "height"].map(name => [name, String(revision[name])])) : {}),
    ...(f.output === "model3d" ? { modelFormat: "glb", modelPreviewSafe: "true", fileName } : {}),
  } });
  f.currentRevision = number; f.currentBytes = result.bytes; f.url = url; f.key = key;
  const selection = f.select(number, { mediaSha256: revision.media.sha256 });
  return { revision, event, sourceRaw, selection, bytes: result.bytes, key, url };
}
export async function retainOriginalMediaRestore(f) {
  retainMediaSourceSnapshot(f);
  const number = f.currentRevision + 1, marker = `${f.output}_revision`;
  f.replace(f.originalRaw);
  const event = await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: f.output, content_ref: CONTENT,
    revision: number, content_sha256: digest(f.raw()), edited_by_user_id: OWNER, [marker]: null,
    revision_action: "restore", restored_from_revision: 0, source_surface: "document-artifact-history" });
  f.currentRevision = number; f.currentBytes = f.originalBytes; f.url = f.originalUrl; f.key = f.originalKey;
  return { event, selection: f.select(number) };
}
