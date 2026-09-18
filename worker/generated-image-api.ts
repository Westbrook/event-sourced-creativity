import { type CreativeEvent } from "../src/model/events.ts";
import { originalGeneratedImageUrl } from "../src/model/generated-image-original-url.ts";
import {readImageWitness,imageWitnessStatement,imageWitnessAcknowledged,imageWitnessPublished,IMAGE_STREAM_SCAN_LIMITS,type ImageWitnessGuard} from './generated-image-witness.ts';
import {createImageEventConsumer} from './generated-image-event-consumer.ts';
import {captureSceneSourceVersion} from './scene-source-generation.ts';
import { GENERATED_IMAGE_EDIT_LIMITS } from "../src/model/generated-image-edit.ts";
import { generatedImageEditOperationSha256, parseGeneratedImageEditRequest, parseGeneratedImageRevision,
  type GeneratedImageEditRequest, type GeneratedImageEditSnapshot, type GeneratedImageRevision } from "../src/model/generated-image-revision.ts";
import { inspectOutputAsset, outputAssetSha256 } from "../src/model/output-asset-inspection.ts";
import { mediaKeyMatchesOwnerNamespace, ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { referenceCompositionMediaUrl, referenceCompositionSources, validateReferenceComposition } from "../src/model/reference-composition.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { configuredPilotAdmissionGuard, POLICY_VERSION, requireConsent, requireUser, type PilotUser } from "./pilot-policy.ts";
import { readProjectRequestContext } from "./project-access.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, serializeEvent, uuidV7, type WorkerEnv } from "./runtime.ts";

// This personal endpoint owns one server-only event type. It does not turn a
// CreativeOutput into a DocumentArtifact, modify planner content, or render PNGs.
const DEADLINE_MS = 30_000;
const MAX_EVENTS = 50_000;
const MAX_EVENT_BYTES = IMAGE_STREAM_SCAN_LIMITS.eventBytes;
const MAX_REVISIONS = 128;
const MAX_REVISION_BYTES = 8_000_000;
const MAX_REQUEST_BYTES = GENERATED_IMAGE_EDIT_LIMITS.pngBytes + 131_072;
const encoder = new TextEncoder();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const setBytes = Uint8Array.prototype.set;
type Row = Record<string, unknown>;
type Guard = { sql: string; bindings: Array<string | number | null> };
type ConditionalImageBucket = {
  put(key: string, value: ArrayBuffer, options: { onlyIf: { etagDoesNotMatch: "*" };
    httpMetadata: { contentType: "image/png" }; customMetadata: Record<string, string> }): Promise<unknown>;
};
const object = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(value);
const integer = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const exactKeys = (value: Row, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const textHash = (value: string) => outputAssetSha256(encoder.encode(value));
const future = (value: unknown) => typeof value === "string" && Date.parse(value) > Date.now() && new Date(value).toISOString() === value;
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
class Refusal extends Error {
  constructor(readonly code: "unavailable" | "source_changed" | "invalid" | "forbidden", readonly status = 409) { super(code); }
}
function requireFact(value: unknown, code: Refusal["code"] = "unavailable", status = 409): asserts value {
  if (!value) throw new Refusal(code, status);
}
function imageReadFailureKind(error: unknown): string {
  let current=error, fallback="unknown";
  // A database adapter may transport plain error records across a realm. Only
  // own data properties are inspected, and only fixed categories leave here.
  try { for(let depth=0;depth<3&&object(current);depth++){
    const raw=Object.getOwnPropertyDescriptor(current,"message")?.value;
    const message=typeof raw==="string"?raw.slice(0,2048):"";
    if(/^image_witness_(?:capacity(?:_(?:reads|event_count|event_bytes|event_page|event_row|event_json|revision_count|revision_row|revision_bytes|retained))?|changed|version|schema|epoch_absent|unavailable)$/u.test(message))return message;
    if(/\bSQLITE_TOOBIG\b|\bstring or blob too big\b/iu.test(message))return "d1_value_limit";
    if(/\bno such (?:table|column)\b|\bSQLITE_SCHEMA\b/iu.test(message))return "d1_schema";
    if(/\bExpression tree is too large\b/iu.test(message))return "d1_expression_depth";
    if(/\bWrong number of parameter bindings\b|\bSQLITE_RANGE\b/iu.test(message))return "d1_binding_count";
    // Reuse the fixed D1 categories already used by experience-output-api.
    if(/\bD1_TYPE_ERROR\b/u.test(message))return "d1_binding_type";
    if(/\bparser stack overflow\b/iu.test(message))return "d1_parser_depth";
    if(/\bmalformed JSON\b/iu.test(message))return "d1_malformed_json";
    if(/\bJSON cannot hold BLOB values\b/iu.test(message))return "d1_json_blob";
    if(/\bambiguous column name\b/iu.test(message))return "d1_ambiguous_column";
    if(/\bSQLITE_AUTH\b|\bnot authorized\b/iu.test(message)&&/\bD1_ERROR\b|\bSQLITE_AUTH\b/u.test(message))return "d1_sql_authorization";
    if(/\bSQL statement too long\b|\bstatement is too long\b/iu.test(message))return "d1_statement_length";
    if(/\btoo many SQL variables\b/iu.test(message))return "d1_parameter_limit";
    if(/\b(?:exceeded|exceeds|exceeding) (?:the )?maximum (?:response|result) size\b/iu.test(message))return "d1_response_limit";
    if(/\bSQLITE_BUSY\b|\bSQLITE_LOCKED\b|\bdatabase is locked\b/iu.test(message))return "d1_busy";
    if(/\bToo many API requests by single worker invocation\b|\bToo many subrequests\b/iu.test(message))return "worker_subrequest_limit";
    if(/\bD1_ERROR:\s*too many queries\b/iu.test(message))return "d1_query_limit";
    if(/\bD1_ERROR\b|\bSQLITE_ERROR\b/u.test(message))fallback="d1_error";
    current=Object.getOwnPropertyDescriptor(current,"cause")?.value;
  } } catch { /* Diagnostics never replace the original refusal. */ }
  return error instanceof Refusal?"refusal":fallback;
}

class Lifetime {
  active = true;
  writing = false;
  private sqlCount=0;
  get queryCount(){return this.sqlCount;}
  capacity(count:number){this.check();requireFact(integer(count)&&this.sqlCount+count<=900);}
  sql(count:number){this.capacity(count);this.sqlCount+=count;}
  readStage: "admission" | "witness_read" | "event_witness_capacity" | "revision_witness_capacity" | "witness_bounds" | "event_decode" | "event_order" | "origin_alias" | "origin_fields" | "origin_path" | "projection" | "origin_envelope" | "private_content" | "revision" | "sources" | "current_guard" | "media_read" | "media_hash" | "png_facts" = "admission";
  readonly cancellations = new Set<() => void>();
  check() { requireFact(this.active, "unavailable", 408); }
  stop() { this.active = false; for (const cancel of this.cancellations) { try { cancel(); } catch { /* Cancellation is best effort and never awaited. */ } } this.cancellations.clear(); }
  async wait<T>(promise: Promise<T>): Promise<T> { const result = await promise; this.check(); return result; }
}

function internalKey(outputId: string) {
  return "generated-image/" + Array.from(encoder.encode(outputId), byte => byte.toString(16).padStart(2, "0")).join("");
}
function principalAdmission(env: WorkerEnv, actor: PilotUser): Guard {
  const snapshot = actor.authorizationSnapshot, pilot = configuredPilotAdmissionGuard(env, actor);
  if (!snapshot) return { sql: "0", bindings: [] };
  return { sql: `EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal
    WHERE (principal.user_id,principal.email,principal.role,principal.updated_at,principal.consent_version,
      COALESCE(principal.permission_epoch,''),COALESCE(principal.grants_json,'[]'),COALESCE(principal.organizations_json,'[]'),
      COALESCE(principal.projects_json,'[]'),COALESCE(principal.identity_policies_json,'[]'),COALESCE(principal.approved_canvas_requirements,0))=(?,?,?,?,?,?,?,?,?,?,?))
    AND (${pilot.sql})`,bindings:[actor.userId,actor.userId,actor.email,actor.role,snapshot.updatedAt,POLICY_VERSION,snapshot.rawEpoch,snapshot.grants,
      snapshot.organizations,snapshot.projects,snapshot.identityPolicies,snapshot.canvasRequirements,...pilot.bindings]};
}
function admission(env: WorkerEnv, actor: PilotUser, projectId: string, documentId: string, outputId: string, contentId: string, mediaKeys: string[]): Guard {
  const principal=principalAdmission(env,actor);
  return {sql:`(${principal.sql}) AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='document' AND resource_id=?)
      OR (resource_kind='artifact' AND resource_id IN (?,?)) OR (resource_kind='content' AND resource_id=?)
      OR (resource_kind='media' AND resource_id IN (SELECT value FROM json_each(?))))
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)`,
    bindings: [...principal.bindings,
      projectId,documentId,outputId,internalKey(outputId),contentId,JSON.stringify(mediaKeys),contentId] };
}
type Origin = { outputId: string; documentId: string; generationId: string; sourceEventId: string; contentRef: string; contentSha256: string };
type Media = GeneratedImageRevision["media"];
type Envelope = { kind: "generated-image"; schemaVersion: 1; origin: Origin; initialMedia: Media;
  request: GeneratedImageEditRequest | null; imageRevision: GeneratedImageRevision | null };
type Retained = { row: Row; envelope: Envelope; event: CreativeEvent | null };
type Current = {
  snapshot: GeneratedImageEditSnapshot; origin: Origin; initialMedia: Media; retained: Retained[];
  eventCount: number; eventBytes: number; witnessGuards: ImageWitnessGuard[]; witnessQueries:number; rawExpires: string; originExpires: string | null; key: string; guard: Guard;
};

function mediaKey(value: unknown, owner: string): string | null {
  if (typeof value !== "string" || referenceCompositionMediaUrl(value) !== value) return null;
  const key = decodeURIComponent(value.slice("/api/media/".length));
  return mediaKeyMatchesOwnerNamespace(key, owner) ? key : null;
}
function sameOrigin(value: unknown, origin: Origin): boolean {
  return object(value) && exactKeys(value, Object.keys(origin)) && Object.entries(origin).every(([key, item]) => value[key] === item);
}
function sameMedia(value: unknown, media: Media): boolean {
  return object(value) && exactKeys(value, Object.keys(media)) && Object.entries(media).every(([key, item]) => value[key] === item);
}
function matchesRequest(request: GeneratedImageEditRequest, snapshot: GeneratedImageEditSnapshot) {
  return request.expectedRevision === snapshot.revision && request.expectedEditEventId === snapshot.editEventId
    && request.expectedContentSha256 === snapshot.contentSha256 && request.generationId === snapshot.generationId
    && request.sourceEventId === snapshot.sourceEventId && request.contentRef === snapshot.contentRef
    && request.sourceMediaUrl === snapshot.media.url && request.sourceMediaSha256 === snapshot.media.sha256;
}

async function observeCurrent(env: WorkerEnv, actor: PilotUser, outputId: string, life: Lifetime): Promise<Current> {
  life.check();
  const key = internalKey(outputId);
  life.readStage="witness_read";
  const consumer=createImageEventConsumer(outputId,key,(value:Row)=>{
    requireFact(object(value) && token(value.event_id) && value.stream_id === actor.streamId && integer(value.sequence, 1));
    if(value.private_json!==null)requireFact(value.private_owner===actor.userId&&typeof value.private_json==='string');
    const event=serializeEvent({...value,private_json:value.private_redacted===null?value.private_json:null});
    requireFact(object(event.payload));return event;
  });
  const witnesses = await readImageWitness(env,actor.streamId,actor.userId,key,outputId,life,consumer);
  life.readStage="event_witness_capacity";
  requireFact(witnesses.eventCount>0&&witnesses.eventCount<=MAX_EVENTS);
  life.readStage="revision_witness_capacity";
  requireFact(witnesses.revisionRows.length<=MAX_REVISIONS);
  life.readStage="witness_bounds";
  const {revisionRows}=witnesses;
  requireFact(Array.isArray(revisionRows) && revisionRows.length <= MAX_REVISIONS);
  life.readStage="event_decode";
  const consumed=consumer.finish(),{events,envelopes:eventRows,initial,projection}=consumed;
  const eventBytes=witnesses.eventBytes;
  life.readStage="event_order";
  requireFact(consumed.count===witnesses.eventCount&&consumed.head===witnesses.head);
  life.readStage="origin_alias";
  const aliases = events.filter(event => (event.type === "GenerationCompleted" || event.type === "IdeationPreviewCompleted")
    && (event.payload.object_id === outputId || Array.isArray(event.payload.object_ids) && event.payload.object_ids.includes(outputId)));
  requireFact(aliases.length === 1);
  const completed = aliases[0]!, p = completed.payload;
  life.readStage="origin_fields";
  requireFact(completed.type === "GenerationCompleted" && completed.actor === "worker:generator" && p.report_space !== "scout"
    && p.object_id === outputId && Array.isArray(p.object_ids) && p.object_ids.length === 1 && p.object_ids[0] === outputId
    && token(p.document_id) && token(p.generation_id) && /^[A-Za-z0-9._-]+$/u.test(p.generation_id) && token(p.output_ref)
    && p.media_type === "image/png" && hash(p.source_content_hash) && integer(p.image_width, 1) && p.image_width <= 16_384
    && integer(p.image_height, 1) && p.image_height <= 16_384 && p.quality === "high" && p.purpose === "final" && p.simulation === false
    && (p.content_expires_at == null || future(p.content_expires_at)));
  requireFact(!events.some(event => event !== completed && ["GenerationCompleted", "IdeationPreviewCompleted"].includes(event.type) && event.payload.generation_id === p.generation_id));
  life.readStage="origin_path";
  const originalUrl = originalGeneratedImageUrl(actor.userId,completed);
  requireFact(originalUrl);
  // The initial projection proves generated-output identity. Current projection
  // supplies removal and current Document/reference state, including later edits.
  life.readStage="projection";
  const initialOutput = initial.libraryOutputs.filter(output => output.id === outputId);
  requireFact(initialOutput.length === 1 && initialOutput[0]!.sourceEventId === completed.eventId && initialOutput[0]!.generationId === p.generation_id
    && initialOutput[0]!.contentRef === p.output_ref && initialOutput[0]!.mediaUrl === originalUrl && initialOutput[0]!.sequence === completed.sequence);
  const document = projection.documents.find(value => value.id === p.document_id), outputs = projection.libraryOutputs.filter(value => value.id === outputId);
  requireFact(document && !document.removed && token(document.projectId) && projection.documentId === document.id && projection.projectId === document.projectId
    && outputs.length === 1 && !outputs[0]!.discarded && outputs[0]!.documentId === document.id && outputs[0]!.generationId === p.generation_id
    && outputs[0]!.sourceEventId === completed.eventId && outputs[0]!.contentRef === p.output_ref);
  life.readStage="origin_envelope";
  const originEnvelope: unknown = eventRows.find((value: unknown) => object(value) && value.event_id === completed.eventId);
  requireFact(object(originEnvelope) && originEnvelope.private_owner === actor.userId && originEnvelope.private_redacted === null
    && originEnvelope.private_document === document.id && (originEnvelope.private_project === null || originEnvelope.private_project === document.projectId));
  requireFact(!events.some(event => ["DocumentRenderCompleted", "DocumentArtifactEdited"].includes(event.type)
    && [outputId, key].includes(String(event.payload.artifact_id ?? ""))));
  life.readStage="private_content";
  life.sql(1);
  const source = await life.wait(env.DB.prepare("SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL AND expires_at>?")
    .bind(p.output_ref, actor.userId, new Date().toISOString()).first<Row>());
  requireFact(source && typeof source.content === "string" && source.content.length > 0 && encoder.encode(source.content).length <= GENERATED_IMAGE_EDIT_LIMITS.rawBytes && future(source.expires_at));
  requireFact(object(JSON.parse(source.content)));
  const origin: Origin = { outputId, documentId: document.id, generationId: p.generation_id, sourceEventId: completed.eventId,
    contentRef: p.output_ref, contentSha256: await life.wait(textHash(source.content)) };
  // Original length is established by the actual private-object read below on
  // first Save; a retained revision-zero row must thereafter preserve it exactly.
  let initialMedia: Media = { url: originalUrl, mediaType: "image/png", sha256: p.source_content_hash, byteLength: 0, width: p.image_width, height: p.image_height };
  let media = initialMedia, editEventId: string | null = null;
  life.readStage="revision";
  const edits = events.filter(event => event.type === "GeneratedImageEdited" && (event.payload.output_id === outputId || event.payload.object_id === outputId));
  requireFact(revisionRows.length === (edits.length === 0 ? 0 : edits.length + 1));
  const retained: Retained[] = [];
  for (let index = 0; index < revisionRows.length; index++) {
    const value: unknown = revisionRows[index];
    requireFact(object(value) && value.artifact_id === key && value.owner_id === actor.userId && value.organization_id === null && value.project_access_id === null
      && value.project_id === document.projectId && value.document_id === document.id && value.revision === index && token(value.revision_id)
      && value.created_by_user_id === actor.userId && typeof value.created_at === "string" && value.redacted_at === null && future(value.expires_at)
      && typeof value.content_json === "string" && encoder.encode(value.content_json).length <= 100_000 && hash(value.content_sha256)
      && await life.wait(textHash(value.content_json)) === value.content_sha256);
    const envelope: unknown = JSON.parse(value.content_json);
    requireFact(object(envelope) && exactKeys(envelope, ["kind", "schemaVersion", "origin", "initialMedia", "request", "imageRevision"])
      && envelope.kind === "generated-image" && envelope.schemaVersion === 1 && sameOrigin(envelope.origin, origin));
    if (index === 0) {
      requireFact(object(envelope.initialMedia) && integer(envelope.initialMedia.byteLength, 1) && envelope.initialMedia.byteLength <= GENERATED_IMAGE_EDIT_LIMITS.pngBytes);
      initialMedia = { ...initialMedia, byteLength: envelope.initialMedia.byteLength };
      media = initialMedia;
      requireFact(sameMedia(envelope.initialMedia, initialMedia) && envelope.request === null && envelope.imageRevision === null);
      retained.push({ row: value, envelope: envelope as Envelope, event: null });
      continue;
    }
    requireFact(sameMedia(envelope.initialMedia, initialMedia));
    const record = parseGeneratedImageRevision(envelope.imageRevision, actor.userId), request = parseGeneratedImageEditRequest(envelope.request), event = edits[index - 1]!;
    requireFact(record && request && record.revision === index && sameOrigin({ outputId: record.outputId, documentId: record.documentId,
      generationId: record.generationId, sourceEventId: record.sourceEventId, contentRef: record.contentRef, contentSha256: record.contentSha256 }, origin)
      && record.source.eventId === (editEventId ?? completed.eventId) && record.source.mediaUrl === media.url && record.source.sha256 === media.sha256
      && record.source.width === media.width && record.source.height === media.height && request.expectedRevision === index - 1
      && request.expectedEditEventId === editEventId && request.expectedContentSha256 === origin.contentSha256 && request.generationId === origin.generationId
      && request.sourceEventId === origin.sourceEventId && request.contentRef === origin.contentRef && request.sourceMediaUrl === media.url
      && request.sourceMediaSha256 === media.sha256 && request.sourceId === record.sourceId && request.resultMediaSha256 === record.media.sha256
      && request.resultByteLength === record.media.byteLength && JSON.stringify(request.recipe) === JSON.stringify(record.recipe)
      && record.recipeSha256 === await life.wait(textHash(JSON.stringify(record.recipe)))
      && record.operationSha256 === await life.wait(generatedImageEditOperationSha256({ ownerId: actor.userId, projectId: document.projectId, documentId: document.id, outputId }, request)));
    const ep = event.payload;
    const editEnvelope: unknown = eventRows.find((row: unknown) => object(row) && row.event_id === event.eventId);
    requireFact(object(editEnvelope) && editEnvelope.private_owner === actor.userId && editEnvelope.private_redacted === null
      && editEnvelope.private_document === document.id && editEnvelope.private_project === document.projectId);
    requireFact(event.sequence > completed.sequence && event.eventId === record.editEventId && event.actor === "user" && event.clientId === "web:generated-image-editor"
      && ep.output_id === outputId && ep.object_id === outputId && ep.document_id === document.id && ep.project_id === document.projectId
      && ep.generation_id === origin.generationId && ep.source_event_id === origin.sourceEventId && ep.content_ref === origin.contentRef && ep.content_sha256 === origin.contentSha256
      && ep.revision === index && ep.previous_revision === index - 1 && ep.previous_edit_event_id === editEventId
      && ep.image_revision_id === value.revision_id && ep.image_revision_sha256 === value.content_sha256 && ep.image_edit_operation_sha256 === record.operationSha256
      && ep.media_url === record.media.url && ep.media_type === "image/png" && ep.source_content_hash === record.media.sha256
      && ep.image_width === record.media.width && ep.image_height === record.media.height && ep.image_byte_length === record.media.byteLength
      && ep.source_surface === "generated-image-editor" && ep.edited_by_user_id === actor.userId);
    media = record.media; editEventId = record.editEventId;
    retained.push({ row: value, envelope: { ...envelope, request, imageRevision: record } as Envelope, event });
  }
  requireFact(new Set(retained.flatMap(item => item.envelope.imageRevision ? [item.envelope.imageRevision.operationSha256] : [])).size === edits.length);
  life.readStage="sources";
  const sources = referenceCompositionSources(projection.libraryBlocks.filter(block => block.documentId === document.id && block.projectId === document.projectId), events)
    .filter(item => mediaKey(item.mediaUrl, actor.userId) !== null);
  requireFact(sources.length <= 128 && new Set(sources.map(item => item.id)).size === sources.length);
  const sourceIds = sources.filter(item => {
    if (item.kind !== "image" || item.requiresUnlock || item.mediaUrl !== media.url || item.contentHash !== media.sha256) return false;
    const block = projection.libraryBlocks.find(value => value.id === item.blockId);
    if (!block || block.type !== "reference" || !token(block.properties.reference_id)
      || block.properties.source_output_id !== outputId || block.properties.source_generation_id !== origin.generationId
      || block.properties.source_output_content_ref !== origin.contentRef || block.properties.source_document_id !== document.id) return false;
    const receipt = [...events].reverse().find(value => value.type === "ReferenceIngested" && value.payload.reference_id === block.properties.reference_id)?.payload;
    return receipt?.source_type === "generated-output" && receipt.source_output_id === outputId && receipt.source_generation_id === origin.generationId
      && receipt.source_document_id === document.id && receipt.document_id === document.id && receipt.project_id === document.projectId;
  }).map(item => item.id);
  const snapshot: GeneratedImageEditSnapshot = { status: "current", ownerId: actor.userId, projectId: document.projectId, ...origin, rawJson: source.content,
    revision: edits.length, editEventId, media: { ...media, ...(media.byteLength === 0 ? { byteLength: undefined } : {}) }, sources, sourceIds,
    head: witnesses.head };
  const keys = [originalUrl, media.url, ...sources.map(item => item.mediaUrl),
    ...retained.flatMap(item => item.envelope.imageRevision ? [item.envelope.imageRevision.media.url] : [])]
    .flatMap(url => [url, mediaKey(url, actor.userId)!]);
  const access = admission(env, actor, document.projectId, document.id, outputId, origin.contentRef, keys);
  const guard: Guard = { sql: `(${access.sql})
    AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND content=? AND expires_at=? AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND redacted_at IS NULL)
    AND (?='' OR ?>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND NOT EXISTS(SELECT 1 FROM artifact_revisions WHERE owner_id=? AND artifact_id=? AND (redacted_at IS NOT NULL OR expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    bindings: [...access.bindings,
      origin.contentRef, actor.userId, source.content, source.expires_at as string, new Date().toISOString(),
      typeof p.content_expires_at === "string" ? p.content_expires_at : "", typeof p.content_expires_at === "string" ? p.content_expires_at : "", actor.userId, key] };
  const current: Current = { snapshot, origin, initialMedia, retained, eventCount:witnesses.eventCount, eventBytes, witnessGuards:witnesses.guards,witnessQueries:witnesses.queryCount, rawExpires: source.expires_at as string,
    originExpires: typeof p.content_expires_at === "string" ? p.content_expires_at : null, key, guard };
  await assertCurrent(env, current, life);
  return current;
}

async function assertCurrent(env: WorkerEnv, current: Current, life: Lifetime) {
  life.readStage="current_guard";
  life.check();
  requireFact(future(current.rawExpires) && (current.originExpires === null || future(current.originExpires)) && current.retained.every(item => future(item.row.expires_at)), "source_changed");
  const guards=[...current.witnessGuards,current.guard];
  life.sql(guards.length);
  const results = await life.wait(env.DB.batch(guards.map(guard=>imageWitnessStatement(env,guard))));
  requireFact(imageWitnessAcknowledged(results,guards.length), "source_changed");
}

async function boundedStream(body: ReadableStream<Uint8Array>, limit: number, declared: number | null, life: Lifetime): Promise<Uint8Array> {
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let length = 0, reads = 0, complete = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  life.cancellations.add(cancel);
  try {
    while (true) {
      const result = await life.wait(reader.read());
      if (result.done) { complete = true; break; }
      requireFact(result.value instanceof Uint8Array && Object.getPrototypeOf(result.value) === Uint8Array.prototype
        && bufferOf.call(result.value) instanceof ArrayBuffer && ++reads <= 65_536, "invalid", 413);
      const chunkLength: number = byteLengthOf.call(result.value);
      length += chunkLength;
      requireFact(length <= limit && (declared === null || length <= declared), "invalid", 413);
      const chunk = new Uint8Array(chunkLength);
      setBytes.call(chunk, result.value);
      chunks.push(chunk);
    }
    requireFact(length > 0 && (declared === null || length === declared), "invalid", 400);
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally {
    life.cancellations.delete(cancel);
    if (!complete) cancel();
    for (const chunk of chunks) chunk.fill(0);
    try { reader.releaseLock(); } catch { /* A pending cancelled read may still own the reader. */ }
  }
}

async function ownedMedia(env: WorkerEnv, owner: string, url: string, expectedHash: string, life: Lifetime, expectedMime?: string): Promise<Uint8Array> {
  life.readStage="media_read";
  const key = mediaKey(url, owner); requireFact(key && hash(expectedHash)); life.check();
  const pending = env.MEDIA.get(key);
  void pending.then(value => { if (!life.active && value) void value.body.cancel().catch(() => {}); }).catch(() => {});
  const value = await life.wait(pending);
  requireFact(value);
  const cancel = () => { void value.body.cancel().catch(() => {}); };
  try {
    requireFact(value.customMetadata?.ownerId === owner && !value.customMetadata.projectAccessId && !value.customMetadata.organizationId && value.customMetadata.sha256 === expectedHash
      && integer(value.size, 1) && value.size <= GENERATED_IMAGE_EDIT_LIMITS.pngBytes);
    if (expectedMime) { const headers = new Headers(); value.writeHttpMetadata(headers); requireFact(headers.get("content-type") === expectedMime); }
    const bytes = await boundedStream(value.body, GENERATED_IMAGE_EDIT_LIMITS.pngBytes, value.size, life);
    life.readStage="media_hash";
    try { requireFact(await life.wait(outputAssetSha256(bytes)) === expectedHash); return bytes; }
    catch (error) { bytes.fill(0); throw error; }
  } catch (error) { cancel(); throw error; }
}
async function pngFacts(bytes: Uint8Array, expected: { sha256: string; width: number; height: number; byteLength?: number }, life: Lifetime) {
  life.readStage="png_facts";
  const facts = await life.wait(inspectOutputAsset(bytes, "image.png", { snapshot: false }));
  requireFact(facts.status === "inspected" && facts.kind === "image" && facts.extension === "png" && facts.mimeType === "image/png"
    && facts.sha256 === expected.sha256 && facts.facts.width === expected.width && facts.facts.height === expected.height
    && (expected.byteLength === undefined || expected.byteLength === bytes.length), "invalid", 422);
}
async function readMultipart(request: Request, life: Lifetime) {
  requireFact(request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"), "invalid", 415);
  const length = request.headers.get("content-length");
  requireFact(length === null || /^\d+$/u.test(length) && integer(Number(length), 1) && Number(length) <= MAX_REQUEST_BYTES, "invalid", 413);
  requireFact(request.body, "invalid", 400);
  const body = await boundedStream(request.body, MAX_REQUEST_BYTES, length === null ? null : Number(length), life);
  try {
    const form = await life.wait(new Response(body as Uint8Array<ArrayBuffer>, { headers: { "content-type": request.headers.get("content-type")! } }).formData());
    const entries = Array.from(form.entries());
    requireFact(entries.length === 2 && form.getAll("request").length === 1 && form.getAll("png").length === 1, "invalid", 400);
    const raw = form.get("request"), file = form.get("png");
    requireFact(typeof raw === "string" && encoder.encode(raw).length <= 65_536 && file instanceof File && file.type === "image/png"
      && file.size > 0 && file.size <= GENERATED_IMAGE_EDIT_LIMITS.pngBytes, "invalid", 400);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Refusal("invalid", 400); }
    const parsed = parseGeneratedImageEditRequest(value);
    requireFact(parsed && file.size === parsed.resultByteLength, "invalid", 400);
    const bytes = new Uint8Array(await life.wait(file.arrayBuffer()));
    return { request: parsed, bytes };
  } finally { body.fill(0); }
}

function committed(current: Current, operationSha256: string) {
  return current.retained.find(item => item.envelope.imageRevision?.operationSha256 === operationSha256);
}
function acknowledgment(current: Current, item: Retained) {
  const imageRevision = item.envelope.imageRevision!;
  return { status: "saved", code: "saved", imageRevision, operationSha256: imageRevision.operationSha256,
    stillCurrent: imageRevision.revision === current.snapshot.revision && imageRevision.editEventId === current.snapshot.editEventId,
    currentRevision: current.snapshot.revision, currentEditEventId: current.snapshot.editEventId,
    appended: item.event ? [item.event] : [], head: current.snapshot.head };
}
async function execute(request: Request, env: WorkerEnv, outputId: string, life: Lifetime): Promise<Response> {
  life.check();
  requireFact(token(outputId), "invalid", 400);
  const url = new URL(request.url), operation = url.searchParams.get("operationSha256"), check = operation !== null;
  requireFact(request.method === "GET" || request.method === "PATCH" || request.method === "POST", "invalid", 405);
  requireFact(check ? request.method === "GET" && hash(operation) && Array.from(url.searchParams).length === 1 : !url.search, "invalid", 400);
  if (request.method !== "GET") requireFact(!request.headers.get("origin") || request.headers.get("origin") === url.origin, "forbidden", 403);
  const authenticated = await life.wait(requireUser(request, env, "viewer", { account: "principal" }));
  if (authenticated.response || !authenticated.user) return authenticated.response ?? reply({ status: "refused", code: "forbidden" }, 401);
  const actor = authenticated.user, consent = requireConsent(actor);
  if (consent) return consent;
  requireFact(actor.streamId === "creative:" + actor.userId && (actor.role === "creator" || actor.role === "admin"), "forbidden", 403);
  const selected = await life.wait(readProjectRequestContext(request, env, actor));
  if (selected.response) return selected.response;
  requireFact(!selected.context, "forbidden", 403);
  if(request.method==='POST'){
    requireFact(request.headers.get('content-type')?.split(';')[0]?.trim()==='application/json'&&request.body,'invalid',400);
    const input=await boundedStream(request.body,128,null,life);
    try{
      const command:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input));
      requireFact(object(command)&&exactKeys(command,['operation'])&&command.operation==='prepare-current-read','invalid',400);
      life.sql(4);
      await life.wait(captureSceneSourceVersion(env,{streamId:actor.streamId},[principalAdmission(env,actor)]));
      return reply({status:'prepared'});
    }finally{input.fill(0);}
  }
  let current = await observeCurrent(env, actor, outputId, life);
  if (check) {
    const item = committed(current, operation!);
    if (!item) return reply({ status: "unconfirmed", code: "unconfirmed" });
    const bytes = await ownedMedia(env, actor.userId, item.envelope.imageRevision!.media.url, item.envelope.imageRevision!.media.sha256, life, "image/png");
    try { await pngFacts(bytes, item.envelope.imageRevision!.media, life); await assertCurrent(env, current, life); return reply(acknowledgment(current, item)); }
    finally { bytes.fill(0); }
  }
  if (request.method === "GET") {
    const bytes = await ownedMedia(env, actor.userId, current.snapshot.media.url, current.snapshot.media.sha256, life, "image/png");
    try { await pngFacts(bytes, current.snapshot.media, life); await assertCurrent(env, current, life); return reply(current.snapshot); }
    finally { bytes.fill(0); }
  }
  const input = await readMultipart(request, life);
  try {
    const operationSha256 = await life.wait(generatedImageEditOperationSha256({ ownerId: actor.userId, projectId: current.snapshot.projectId, documentId: current.snapshot.documentId, outputId }, input.request));
    requireFact(operationSha256, "invalid", 400);
    // Exact retransmission observes the already committed operation. It never
    // allocates another object/event, even if a newer edit is now current.
    const existing = committed(current, operationSha256);
    if (existing) {
      const media = existing.envelope.imageRevision!.media;
      const bytes = await ownedMedia(env, actor.userId, media.url, media.sha256, life, "image/png");
      try { await pngFacts(bytes, media, life); await assertCurrent(env, current, life); return reply(acknowledgment(current, existing)); }
      finally { bytes.fill(0); }
    }
    requireFact(matchesRequest(input.request, current.snapshot) && current.snapshot.sourceIds.includes(input.request.sourceId), "source_changed");
    requireFact(validateReferenceComposition(input.request.recipe, current.snapshot.sources) === null, "source_changed");
    await pngFacts(input.bytes, { sha256: input.request.resultMediaSha256, width: input.request.recipe.width, height: input.request.recipe.height, byteLength: input.request.resultByteLength }, life);
    const sourceBytes = await ownedMedia(env, actor.userId, current.snapshot.media.url, current.snapshot.media.sha256, life, "image/png");
    try {
      await pngFacts(sourceBytes, current.snapshot.media, life);
      if (current.snapshot.revision === 0) current.initialMedia = { ...current.initialMedia, byteLength: sourceBytes.length };
    } finally { sourceBytes.fill(0); }
    for (const source of input.request.recipe.sources) {
      if (source.mediaUrl === current.snapshot.media.url && source.contentHash === current.snapshot.media.sha256) continue;
      const bytes = await ownedMedia(env, actor.userId, source.mediaUrl, source.contentHash, life);
      bytes.fill(0);
    }
    await assertCurrent(env, current, life);
    if (input.request.resultMediaSha256 === current.snapshot.media.sha256) return reply({ status: "unchanged", code: "unchanged" });
    requireFact(current.eventCount < MAX_EVENTS && integer(current.snapshot.head + 1, 1)
      && current.retained.length + (current.snapshot.revision === 0 ? 2 : 1) <= MAX_REVISIONS, "unavailable");
    const mediaId = "image-edit-" + uuidV7(), key = ownerMediaNamespace(actor.userId) + "/generated/" + mediaId + ".png";
    const media: Media = { url: "/api/media/" + encodeURIComponent(key), mediaType: "image/png", sha256: input.request.resultMediaSha256,
      byteLength: input.bytes.length, width: input.request.recipe.width, height: input.request.recipe.height };
    const event = makeEvent(actor.streamId, current.snapshot.head + 1, "user", "web:generated-image-editor", uuidV7(), "GeneratedImageEdited", {});
    const record: GeneratedImageRevision = { schemaVersion: 1, operation: "composition", revision: current.snapshot.revision + 1, editEventId: event.eventId, ...current.origin,
      source: { revision: current.snapshot.revision, eventId: current.snapshot.editEventId ?? current.origin.sourceEventId,
        mediaUrl: current.snapshot.media.url, sha256: current.snapshot.media.sha256, width: current.snapshot.media.width, height: current.snapshot.media.height },
      media, sourceId: input.request.sourceId, recipe: input.request.recipe, recipeSha256: await life.wait(textHash(JSON.stringify(input.request.recipe))), operationSha256 };
    requireFact(parseGeneratedImageRevision(record, actor.userId));
    const envelope: Envelope = { kind: "generated-image", schemaVersion: 1, origin: current.origin, initialMedia: current.initialMedia, request: input.request, imageRevision: record };
    const json = JSON.stringify(envelope), sha = await life.wait(textHash(json)), revisionId = uuidV7();
    event.payload = { output_id: outputId, object_id: outputId, document_id: current.origin.documentId, project_id: current.snapshot.projectId,
      generation_id: current.origin.generationId, source_event_id: current.origin.sourceEventId, content_ref: current.origin.contentRef, content_sha256: current.origin.contentSha256,
      revision: record.revision, previous_revision: current.snapshot.revision, previous_edit_event_id: current.snapshot.editEventId,
      image_revision_id: revisionId, image_revision_sha256: sha, image_edit_operation_sha256: operationSha256,
      media_url: media.url, media_type: "image/png", source_content_hash: media.sha256, image_width: media.width, image_height: media.height,
      image_byte_length: media.byteLength, source_surface: "generated-image-editor", edited_by_user_id: actor.userId };
    const rows = [{ revisionId, revision: record.revision, json, sha }];
    if (current.snapshot.revision === 0) {
      const originalJson = JSON.stringify({ kind: "generated-image", schemaVersion: 1, origin: current.origin, initialMedia: current.initialMedia, request: null, imageRevision: null } satisfies Envelope);
      rows.unshift({ revisionId: uuidV7(), revision: 0, json: originalJson, sha: await life.wait(textHash(originalJson)) });
    }
    const bindings = eventWriteBindings(event);
    requireFact(current.eventBytes + encoder.encode(String(bindings[12])).length + encoder.encode(String(bindings[16] ?? "")).length <= MAX_EVENT_BYTES
      && rows.every(row => encoder.encode(row.json).length <= 100_000)
      && current.retained.reduce((total, item) => total + encoder.encode(String(item.row.content_json)).length, 0)
        + rows.reduce((total, row) => total + encoder.encode(row.json).length, 0) <= MAX_REVISION_BYTES);
    await assertCurrent(env, current, life);
    // The upload owns its own buffer until settlement. A timeout cannot zero
    // bytes while an already admitted R2 write is still consuming them.
    // Preserve room for original-proof checks and full authoritative readback;
    // known insufficient capacity refuses before allocating an immutable object.
    life.capacity(current.witnessQueries+current.witnessGuards.length*3+100);
    const upload = input.bytes.slice();
    life.writing = true;
    const pending = (() => { try { return (env.MEDIA as ConditionalImageBucket).put(key, upload.buffer, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "image/png" },
      customMetadata: { ownerId: actor.userId, artifactId: mediaId, model: "authored-composition", source: "generated-image-editor", sha256: media.sha256, mimeType: "image/png", outputId, operationSha256 } }); }
    catch (error) { upload.fill(0); throw error; } })();
    void pending.finally(() => upload.fill(0)).catch(() => {});
    requireFact(await life.wait(pending), "unavailable");
    const written = await ownedMedia(env, actor.userId, media.url, media.sha256, life, "image/png");
    try { await pngFacts(written, media, life); } finally { written.fill(0); }
    await assertCurrent(env, current, life);
    const statements = [env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${bindings.map(() => "?").join(",")} WHERE ${current.guard.sql}
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='media' AND resource_id IN (?,?))`).bind(...bindings, ...current.guard.bindings, key, media.url)];
    const expires = new Date(Math.min(Date.parse(current.rawExpires), Date.now() + 365 * 86_400_000)).toISOString();
    for (const row of rows) statements.push(env.DB.prepare(`INSERT INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at)
      SELECT ?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id
        WHERE e.event_id=? AND e.stream_id=? AND e.sequence=? AND e.type='GeneratedImageEdited' AND p.owner_id=? AND p.project_id=? AND p.document_id=? AND p.private_json=? AND p.redacted_at IS NULL)`)
      .bind(row.revisionId,actor.userId,current.snapshot.projectId,current.origin.documentId,current.key,row.revision,row.json,row.sha,actor.userId,event.recordedAt,expires,
        event.eventId,actor.streamId,event.sequence,actor.userId,current.snapshot.projectId,current.origin.documentId,JSON.stringify(event.payload)));
    life.check();
    // All original source and revision predicates precede every write in this
    // transaction. A failed predicate raises SQL error, rolling the batch back.
    const prefix=current.witnessGuards.map(guard=>imageWitnessStatement(env,guard,true));
    life.sql(prefix.length+statements.length);
    const results = await life.wait(env.DB.batch([...prefix,...statements]));
    requireFact(imageWitnessPublished(results,prefix.length,statements.length));
    // Publication uses authoritative readback, including event, full private
    // record and operation digest. A later edit is reported as historical.
    current = await observeCurrent(env, actor, outputId, life);
    const saved = committed(current, operationSha256);
    requireFact(saved && saved.envelope.imageRevision?.editEventId === event.eventId);
    return reply(acknowledgment(current, saved));
  } finally { input.bytes.fill(0); }
}

/** One finite request lifetime, including stalled get/read/put/D1 operations.
 * Cancellation never waits for an uncooperative stream. Admitted uncertain
 * writes retain their immutable object and are resolved only by exact Check. */
export async function handleGeneratedImageEdit(request: Request, env: WorkerEnv, outputId: string): Promise<Response> {
  const life = new Lifetime();
  if (request.body) life.cancellations.add(() => { void request.body!.cancel().catch(() => {}); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const interrupted = new Promise<Response>(resolve => {
    stop = () => {
      if(!life.active)return;
      if(request.method==="GET")console.warn("generated_image_read_interrupted",{stage:life.readStage,kind:request.signal.aborted?"request_aborted":"deadline",queries:life.queryCount});
      life.stop(); resolve(reply(life.writing ? { status: "unconfirmed", code: "unconfirmed" } : { status: "refused", code: "unavailable" }, life.writing ? 200 : 408));
    };
    timer = setTimeout(stop, DEADLINE_MS);
    request.signal.addEventListener("abort", stop, { once: true });
    if (request.signal.aborted) stop();
  });
  const work = execute(request, env, outputId, life).catch((error: unknown) => {
    if (life.writing) return reply({ status: "unconfirmed", code: "unconfirmed" });
    const failure = error instanceof Refusal ? error : new Refusal("unavailable");
    if(request.method==="GET")console.warn("generated_image_read_refused",{stage:life.readStage,code:failure.code,status:failure.status,kind:imageReadFailureKind(error)});
    return reply({ status: "refused", code: failure.code }, failure.status);
  });
  try { return await Promise.race([work, interrupted]); }
  finally { life.stop(); if (timer !== undefined) clearTimeout(timer); if (stop) request.signal.removeEventListener("abort", stop); }
}
