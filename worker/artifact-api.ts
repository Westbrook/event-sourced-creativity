import { documentArtifactValidationIssues, model3dArtifactMediaFile, parseAudioMediaRevision, parseDocumentArtifactContent, parseVideoMediaRevision, parseVideoTrimEditRequest, videoArtifactMediaItem, type AudioTrimEditRequest, type VideoMediaRevision } from "../src/model/document-artifacts.ts";
import { PCM_WAV_EDIT_MAX_BYTES, inspectPcmWav, trimPcmWav } from "../src/model/audio-container.ts";
import { VIDEO_PREFIX_TRIM_MAX_BYTES, inspectVideoPrefix, trimVideoPrefix } from "../src/model/video-container.ts";
import { MAX_MODEL3D_UPLOAD_BYTES } from "../src/model/model3d-assets.ts";
import { GeometryScaleError, scaleModel3dGeometry } from "../src/model/model3d-geometry-edit.ts";
import { parseModel3dScaleEditRequest } from "../src/model/model3d-artifact-revision.ts";
import { parseModel3dMediaRevision, type Model3dMediaRevision } from "../src/model/model3d-media-revision.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { artifactSourceVersions, creativeContextRightsValidity } from "../src/model/context-health.ts";
import { authoritativeCreativeContext } from "./context-authority.ts";
import { foldEvents } from "../src/model/events.ts";
import { buildPresentationSourceContract, type PresentationSourceContract } from "../src/model/presentation-source.ts";
import { configuredPilotAdmissionGuard, hasCapability, POLICY_VERSION, requireConsent, requireUser, type PilotUser } from "./pilot-policy.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readOwnedAudioReference, storeGeneratedMedia } from "./media-api.ts";
import { appendProjectEvents, ownerDocumentBudgetScopes, readProjectRequestContext, readProjectSourceEvents, type ArtifactRevisionSnapshot, type ProjectRequestContext } from "./project-access.ts";
import { ensureSchema, EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, readWorkspaceEvents, serializeEvent, streamHead, uuidV7, type WorkerEnv } from "./runtime.ts";

const MAX_ARTIFACT_MARKDOWN_BYTES = 512_000;
const MAX_ARTIFACT_ITEM_BYTES = 80_000;
const MAX_ARTIFACT_ITEMS = 100;
const MAX_ARTIFACT_REVISION_BYTES = 1_000_000;
const DEFAULT_ARTIFACT_REVISION_DAYS = 365;

type EditedItem = { index?: unknown; title?: unknown; body?: unknown; notes?: unknown };
type RevisionRow={revision:number;content_json:string;content_sha256:string;created_by_user_id:string;created_at:string;expires_at:string;redacted_at:string|null;legally_held?:number};
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),(byte)=>byte.toString(16).padStart(2,"0")).join("");
const audioBytesSha256=async(value:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",value as Uint8Array<ArrayBuffer>)),byte=>byte.toString(16).padStart(2,"0")).join("");
function audioTrimRequest(value: unknown): AudioTrimEditRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, trim = row.audioTrim as Record<string, unknown>;
  const hash = (item: unknown) => typeof item === "string" && /^[a-f0-9]{64}$/u.test(item);
  if (Object.keys(row).sort().join(",") !== "audioTrim,expectedContentSha256,expectedRevision"
    || !Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 0 || !hash(row.expectedContentSha256)
    || !trim || typeof trim !== "object" || Array.isArray(trim)
    || Object.keys(trim).sort().join(",") !== "endFrame,resultMediaSha256,sourceFrameCount,sourceMediaSha256,startFrame"
    || !hash(trim.sourceMediaSha256) || !hash(trim.resultMediaSha256)
    || !Number.isSafeInteger(trim.sourceFrameCount) || Number(trim.sourceFrameCount) < 1
    || !Number.isSafeInteger(trim.startFrame) || !Number.isSafeInteger(trim.endFrame)
    || Number(trim.startFrame) < 0 || Number(trim.startFrame) >= Number(trim.endFrame) || Number(trim.endFrame) > Number(trim.sourceFrameCount)) return null;
  return { expectedRevision: Number(row.expectedRevision), expectedContentSha256: row.expectedContentSha256 as string,
    audioTrim: { sourceMediaSha256: trim.sourceMediaSha256 as string, sourceFrameCount: Number(trim.sourceFrameCount),
      startFrame: Number(trim.startFrame), endFrame: Number(trim.endFrame), resultMediaSha256: trim.resultMediaSha256 as string } };
}
function audioTrimAdmission(env: WorkerEnv, actor: PilotUser, projectId: string, documentId: string, artifactId: string, contentId: string) {
  const snapshot = actor.authorizationSnapshot, pilot = configuredPilotAdmissionGuard(env, actor);
  if (!snapshot) return { sql: "0", bindings: [] as Array<string | number> };
  return { sql: `EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal
    WHERE (principal.user_id,principal.email,principal.role,principal.updated_at,principal.consent_version,
      COALESCE(principal.permission_epoch,''),COALESCE(principal.grants_json,'[]'),COALESCE(principal.organizations_json,'[]'),
      COALESCE(principal.projects_json,'[]'),COALESCE(principal.identity_policies_json,'[]'),COALESCE(principal.approved_canvas_requirements,0))=(?,?,?,?,?,?,?,?,?,?,?))
    AND (${pilot.sql}) AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='document' AND resource_id=?)
      OR (resource_kind='artifact' AND resource_id=?) OR (resource_kind='content' AND resource_id=?))
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)`,
    bindings: [actor.userId,actor.userId,actor.email,actor.role,snapshot.updatedAt,POLICY_VERSION,snapshot.rawEpoch,snapshot.grants,
      snapshot.organizations,snapshot.projects,snapshot.identityPolicies,snapshot.canvasRequirements,...pilot.bindings,projectId,documentId,artifactId,contentId,contentId] };
}
/** The cap applies to observed stream bytes as well as the object's declared size. */
async function audioTrimSource(env: WorkerEnv, ownerId: string, url: string, expectedHash: string) {
  const metadata = await readOwnedAudioReference(env, ownerId, url, { metadataOnly: true });
  if (!metadata || url !== `/api/media/${encodeURIComponent(metadata.key)}` || !metadata.key.startsWith(`${ownerMediaNamespace(ownerId)}/generated/`)
    || metadata.mimeType !== "audio/wav" || metadata.metadata.sha256 !== expectedHash
    || !Number.isSafeInteger(metadata.size) || metadata.size < 45 || metadata.size > PCM_WAV_EDIT_MAX_BYTES) return null;
  const object = await env.MEDIA.get(metadata.key);
  if (!object || object.customMetadata?.ownerId !== ownerId || object.customMetadata.sha256 !== expectedHash
    || object.size !== metadata.size) return null;
  const headers = new Headers(); object.writeHttpMetadata(headers);
  if (headers.get("content-type") !== "audio/wav") return null;
  const bytes = new Uint8Array(object.size), reader = object.body.getReader();
  let offset = 0, chunks = 0, complete = false;
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 30_000);
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) { complete = offset === bytes.length; break; }
      if (!(next.value instanceof Uint8Array) || ++chunks > 65_536 || offset + next.value.byteLength > bytes.length
        || offset + next.value.byteLength > PCM_WAV_EDIT_MAX_BYTES) return null;
      bytes.set(next.value, offset); offset += next.value.byteLength;
    }
    return complete && await audioBytesSha256(bytes) === expectedHash ? bytes : null;
  } finally { clearTimeout(timer); if (!complete) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Race the operation itself; cancellation is observed without awaiting its settlement. */
async function boundedVideoOperation<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("video_trim_deadline")), 30_000); });
  try { return await Promise.race([operation, timeout]); }
  finally { clearTimeout(timer); void operation.catch(() => {}); }
}
async function videoTrimSource(env: WorkerEnv, ownerId: string, url: string, expectedHash: string | null) {
  let key: string;
  try { key = decodeURIComponent(url.slice("/api/media/".length)); }
  catch { return null; }
  if (url !== `/api/media/${encodeURIComponent(key)}` || !key.startsWith(`${ownerMediaNamespace(ownerId)}/generated/`)
    || !key.endsWith(".mp4") || /[\p{Cc}\\]/u.test(key) || key.split("/").some(part => part === "." || part === "..")) return null;
  let active = true, complete = false, body: ReadableStream<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const release = () => { try { reader?.releaseLock(); } catch { /* A pending read is observed by the raced operation. */ } };
  const cancel = () => {
    try { const pending = reader ? reader.cancel() : body?.cancel(); if (pending) void pending.catch(() => {}); } catch { /* Best effort, never a blocking wait. */ }
    release();
  };
  const operation = (async () => {
    const object = await env.MEDIA.get(key);
    body = object?.body ?? null;
    if (!active) { cancel(); return null; }
    const size = object?.size;
    if (!object || !body || object.customMetadata?.ownerId !== ownerId || object.customMetadata?.projectAccessId
      || typeof size !== "number" || !Number.isSafeInteger(size) || size < 32 || size > VIDEO_PREFIX_TRIM_MAX_BYTES) return null;
    const metadataHash = object.customMetadata.sha256;
    if (metadataHash !== undefined && (!/^[a-f0-9]{64}$/u.test(metadataHash) || expectedHash !== null && metadataHash !== expectedHash)) return null;
    const headers = new Headers(); object.writeHttpMetadata(headers);
    if (headers.get("content-type") !== "video/mp4" || object.customMetadata.mimeType !== undefined && object.customMetadata.mimeType !== "video/mp4") return null;
    const bytes = new Uint8Array(size); reader = body.getReader(); let offset = 0, chunks = 0;
    while (active) {
      const next = await reader.read();
      if (!active) return null;
      if (next.done) { complete = offset === bytes.length; break; }
      if (!(next.value instanceof Uint8Array) || ++chunks > 65_536 || next.value.byteLength > bytes.length - offset
        || offset + next.value.byteLength > VIDEO_PREFIX_TRIM_MAX_BYTES) return null;
      bytes.set(next.value, offset); offset += next.value.byteLength;
    }
    if (!complete) return null;
    const digest = await audioBytesSha256(bytes);
    return active && (expectedHash === null || digest === expectedHash) && (metadataHash === undefined || digest === metadataHash) ? bytes : null;
  })();
  try { return await boundedVideoOperation(operation); }
  catch { return null; }
  finally { active = false; if (!complete) cancel(); else release(); }
}
async function model3dScaleSource(env: WorkerEnv, ownerId: string, url: string, expectedHash: string, expectedSize: number, authored: Model3dMediaRevision | null = null, metadataOnly = false) {
  let key: string;
  try { key = decodeURIComponent(url.slice("/api/media/".length)); }
  catch { return null; }
  if (url !== `/api/media/${encodeURIComponent(key)}` || !key.startsWith(`${ownerMediaNamespace(ownerId)}/generated/`)
    || !key.endsWith(".glb") || /[\p{Cc}\\]/u.test(key) || key.split("/").some(part => part === "." || part === "..")) return null;
  let active = true, complete = false, body: ReadableStream<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const release = () => { try { reader?.releaseLock(); } catch { /* A pending read is observed by the raced operation. */ } };
  const cancel = () => {
    try { const pending = reader ? reader.cancel() : body?.cancel(); if (pending) void pending.catch(() => {}); } catch { /* Best effort, never a blocking wait. */ }
    release();
  };
  const operation = (async () => {
    const object = await env.MEDIA.get(key);
    body = object?.body ?? null;
    if (!active) { cancel(); return null; }
    const size = object?.size;
    if (!object || !body || object.customMetadata?.ownerId !== ownerId || object.customMetadata?.projectAccessId
      || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > MAX_MODEL3D_UPLOAD_BYTES || size !== expectedSize) return null;
    const metadata = object.customMetadata, metadataHash = metadata.sha256;
    if (metadataHash !== expectedHash || metadata.modelFormat !== "glb" || metadata.modelPreviewSafe === "false") return null;
    if (authored) {
      const fingerprint=await sha256(JSON.stringify(parseModel3dScaleEditRequest({expectedRevision:authored.source.revision,
        expectedContentSha256:authored.source.contentSha256,model3dScale:{sourceMediaSha256:authored.source.sha256,factor:authored.factor,resultMediaSha256:authored.media.sha256}})));
      if (!active || metadata.source !== "authored-model3d-edit" || metadata.sourceMediaSha256 !== authored.source.sha256
        || metadata.sourceRevision !== String(authored.source.revision) || metadata.requestSha256 !== fingerprint) return null;
    } else if (metadata.rights !== "asserted" && metadata.source !== "provider-generated-media") return null;
    const rights=creativeContextRightsValidity(metadata);
    if (rights.issue || ["revoked","denied","unlicensed"].includes(metadata.rights??"")) return null;
    const headers = new Headers(); object.writeHttpMetadata(headers);
    if (headers.get("content-type") !== "model/gltf-binary" || metadata.mimeType !== "model/gltf-binary") return null;
    if (metadataOnly) return {bytes:new Uint8Array(0),rightsValidUntil:rights.validUntil};
    const bytes = new Uint8Array(size); reader = body.getReader(); let offset = 0, chunks = 0;
    while (active) {
      const next = await reader.read();
      if (!active) return null;
      if (next.done) { complete = offset === bytes.length; break; }
      if (!(next.value instanceof Uint8Array) || ++chunks > 65_536 || next.value.byteLength > bytes.length - offset
        || offset + next.value.byteLength > MAX_MODEL3D_UPLOAD_BYTES) return null;
      bytes.set(next.value, offset); offset += next.value.byteLength;
    }
    if (!complete) return null;
    const digest = await audioBytesSha256(bytes);
    return active && digest === expectedHash ? {bytes,rightsValidUntil:rights.validUntil} : null;
  })();
  try { return await boundedVideoOperation(operation); }
  catch { return null; }
  finally { active = false; if (!complete) cancel(); else release(); }
}
const revisionHoldSql=(alias:string)=>`EXISTS(SELECT 1 FROM organization_retention_policies policy
    WHERE policy.organization_id=${alias}.organization_id AND policy.legal_hold=1)
  OR EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=${alias}.organization_id AND hold.status='active'
    AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=${alias}.project_access_id
      OR hold.scope_kind='artifact' AND hold.resource_id=${alias}.artifact_id))`;
const contentHoldSql=(content:string,artifact:string)=>`EXISTS(SELECT 1 FROM organization_legal_holds hold
    WHERE hold.organization_id=${artifact}.organization_id AND hold.status='active'
      AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=${artifact}.project_access_id
        OR hold.scope_kind='artifact' AND hold.resource_id=${artifact}.resource_id
        OR hold.scope_kind='content' AND hold.resource_id=${content}.content_id))
  OR EXISTS(SELECT 1 FROM organization_retention_policies policy JOIN private_content_retention_scopes retention
      ON retention.organization_id=policy.organization_id AND retention.content_id=${content}.content_id
        AND retention.project_access_id=${artifact}.project_access_id AND retention.classification='governed-evidence'
    WHERE policy.organization_id=${artifact}.organization_id AND policy.legal_hold=1)`;

/** An author's private generation receipt may authorize a revision, but never cross its custody boundary. */
async function trustedPresentationRevisionSourceContract(
  env:WorkerEnv,
  completedPayload:Record<string,unknown>,
  artifactId:string,
  documentId:string,
  projectId:string,
  actorUserId:string,
  itemCount:number,
  project:ProjectRequestContext|null|undefined,
  now:string,
):Promise<PresentationSourceContract|undefined>{
  const receiptId=typeof completedPayload.input_ref==="string"?completedPayload.input_ref:"";
  const generatingUserId=String(completedPayload.requested_by_user_id??project?.ownerUserId??actorUserId);
  if(!receiptId||!project&&generatingUserId!==actorUserId)return undefined;
  const containment=project
    ? ` AND EXISTS(SELECT 1 FROM project_resource_scopes artifact
          JOIN project_resource_scopes evidence ON evidence.project_access_id=artifact.project_access_id
            AND evidence.organization_id=artifact.organization_id AND evidence.project_id=artifact.project_id
            AND evidence.owner_user_id=artifact.owner_user_id AND evidence.resource_kind='content'
            AND evidence.resource_id=private_content.content_id AND evidence.visibility='actor_private'
            AND evidence.actor_user_id=?
          JOIN private_content_retention_scopes retention ON retention.content_id=private_content.content_id
            AND retention.organization_id=artifact.organization_id AND retention.project_access_id=artifact.project_access_id
            AND retention.project_id=artifact.project_id AND retention.actor_user_id=?
            AND retention.classification='governed-evidence'
          WHERE artifact.project_access_id=? AND artifact.organization_id=? AND artifact.project_id=?
            AND artifact.owner_user_id=? AND artifact.resource_kind='artifact' AND artifact.resource_id=?)`
    : " AND NOT EXISTS(SELECT 1 FROM project_resource_scopes evidence WHERE evidence.resource_kind='content' AND evidence.resource_id=private_content.content_id)";
  const retained=await env.DB.prepare(`SELECT content FROM private_content
      WHERE content_id=? AND owner_id=? AND kind='document-artifact-input' AND redacted_at IS NULL AND expires_at>?${containment}`)
    .bind(receiptId,generatingUserId,now,...(project?[generatingUserId,generatingUserId,project.projectAccessId,project.organizationId,project.projectId,project.ownerUserId,artifactId]:[]))
    .first<{content:string}>();
  if(!retained)return undefined;
  let receipt:Record<string,unknown>;
  try{
    const parsed:unknown=JSON.parse(retained.content);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return undefined;
    receipt=parsed as Record<string,unknown>;
  }catch{return undefined;}
  const request=receipt.request;
  const snapshot=receipt.document_snapshot;
  if(receipt.schema_version!==1||receipt.artifact_id!==artifactId||receipt.artifact_kind!=="slides"
    ||receipt.document_id!==documentId||receipt.project_id!==projectId
    ||!request||typeof request!=="object"||Array.isArray(request)
    ||Number((request as Record<string,unknown>).item_count)!==itemCount
    ||!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot))return undefined;
  const snapshotRecord=snapshot as Record<string,unknown>;
  const snapshotDocument=snapshotRecord.document;
  if(snapshotDocument&&typeof snapshotDocument==="object"&&!Array.isArray(snapshotDocument)
    &&typeof (snapshotDocument as Record<string,unknown>).id==="string"
    &&(snapshotDocument as Record<string,unknown>).id!==documentId)return undefined;
  const settings=request as Record<string,unknown>;
  const requested=Number(settings.requested_slide_count??itemCount);
  if(!Number.isSafeInteger(requested)||requested!==itemCount)return undefined;
  const sourceContract=buildPresentationSourceContract(snapshotRecord,{
    requestedSlideCount:itemCount,
    itemCount,
    ...(typeof settings.presentation_style==="string"?{presentationStyle:settings.presentation_style}:{}),
    fidelity:settings.presentation_fidelity==="creative"?"creative":"faithful",
  });
  return !sourceContract.slideCountMismatch&&sourceContract.sources.some((source)=>source.sourceKind==="block")?sourceContract:undefined;
}

/** Read recoverable, exactly scoped revisions or atomically correct/restore the real retained output. */
export async function handleArtifactEdit(request: Request, env: WorkerEnv, artifactId: string,path:string[]=[]): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const videoCheck = search.has("videoTrimOperation");
  const model3dCheck = search.has("model3dScaleOperation");
  const checkKey = model3dCheck ? "model3dScaleOperation" : videoCheck ? "videoTrimOperation" : "audioTrimOperation";
  const checkRequest = path.length === 0 && request.method === "GET" && search.has(checkKey);
  const checkFingerprint = search.get(checkKey), checkRevision = Number(search.get("expectedRevision"));
  if (checkRequest && (!/^[a-f0-9]{64}$/u.test(checkFingerprint??"") || !/^\d+$/u.test(search.get("expectedRevision")??"")
    || !Number.isSafeInteger(checkRevision) || [...search.keys()].sort().join(",") !== [checkKey,"expectedRevision"].sort().join(",")))
    return Response.json({error:model3dCheck?"model3d_scale_invalid_scale":videoCheck?"video_trim_invalid_range":"audio_trim_invalid_range"},{status:400});
  const historyRequest=path.length>=1&&path[0]==="revisions";
  const listRequest=historyRequest&&path.length===1&&request.method==="GET";
  const detailRequest=historyRequest&&path.length===2&&request.method==="GET";
  const restoreRequest=historyRequest&&path.length===3&&path[2]==="restore"&&request.method==="POST";
  const editRequest=path.length===0&&request.method==="PATCH";
  if(!artifactId||!listRequest&&!detailRequest&&!restoreRequest&&!editRequest&&!checkRequest)return new Response("Method not allowed",{status:405});
  const origin=request.headers.get("origin");
  if((editRequest||restoreRequest)&&origin&&origin!==new URL(request.url).origin)return Response.json({error:"same_origin_required"},{status:403});
  await ensureSchema(env);
  const authenticated = await requireUser(request, env, "viewer", { account: "principal" });
  if (authenticated.response || !authenticated.user) return authenticated.response ?? Response.json({ error: "authentication_required" }, { status: 401 });
  const actor = authenticated.user;
  const consent=requireConsent(actor);if(consent)return consent;
  const selected = await readProjectRequestContext(request, env, actor);
  if (selected.response) return selected.response;
  let project=selected.context;
  if ((editRequest||restoreRequest)&&project&&!hasCapability(actor,"project.author",{organizationId:project.organizationId,projectAccessId:project.projectAccessId})) {
    return Response.json({ error: "project_read_only" }, { status: 403 });
  }
  if((editRequest||restoreRequest||checkRequest)&&!project&&actor.role!=="creator"&&actor.role!=="admin")return Response.json({error:"creator_required"},{status:403});
  const ownerId=project?.ownerUserId??actor.userId;
  const initialPersonalHead = project ? null : await streamHead(env, actor.streamId);
  let history=project?await readProjectSourceEvents(env,project):await readWorkspaceEvents(env,actor.streamId);
  let completed=[...history].reverse().find((event)=>event.type==="DocumentRenderCompleted"&&String(event.payload.artifact_id??"")===artifactId);
  if (!completed) return Response.json({ error: "artifact_not_found" }, { status: 404 });
  const documentId = String(completed.payload.document_id ?? "");
  let projection=foldEvents(history,Number.POSITIVE_INFINITY,documentId,project?.projectId??"");
  if(!project){
    const owners=await ownerDocumentBudgetScopes(env,actor.userId,documentId,projection.projectId);
    if(owners.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});
    const owned=owners[0];
    if(owned){
      project={contextId:"",organizationId:owned.organizationId,projectAccessId:owned.projectAccessId,projectId:projection.projectId,ownerUserId:actor.userId,principalUserId:actor.userId,role:"owner",permissions:[],expiresAt:""} satisfies ProjectRequestContext;
      history=await readProjectSourceEvents(env,project);
      completed=[...history].reverse().find((event)=>event.type==="DocumentRenderCompleted"&&String(event.payload.artifact_id??"")===artifactId);
      if(!completed)return Response.json({error:"artifact_not_found"},{status:404});
      projection=foldEvents(history,Number.POSITIVE_INFINITY,documentId,project.projectId);
    }
  }
  const artifact=projection.artifacts.find((candidate)=>candidate.id===artifactId&&candidate.documentId===documentId);
  const contentId=artifact?.contentRef??"";
  if (!artifact || !contentId || project && String(completed.payload.project_id ?? "") !== project.projectId) return Response.json({ error: "artifact_not_found" }, { status: 404 });

  const now = new Date().toISOString();
  const scopeGuard = project
    ? ` AND EXISTS(SELECT 1 FROM project_resource_scopes artifact JOIN project_resource_scopes retained
        ON retained.project_access_id=artifact.project_access_id AND retained.organization_id=artifact.organization_id AND retained.project_id=artifact.project_id
          AND retained.owner_user_id=artifact.owner_user_id AND retained.resource_kind='content' AND retained.resource_id=private_content.content_id AND retained.visibility='collaborative_output'
        WHERE artifact.project_access_id=? AND artifact.organization_id=? AND artifact.project_id=? AND artifact.owner_user_id=?
          AND artifact.resource_kind='artifact' AND artifact.resource_id=?
          AND(private_content.expires_at>? OR ${contentHoldSql("private_content","artifact")}))`
    : " AND private_content.expires_at>?";
  const source = await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL${scopeGuard}`)
    .bind(contentId,ownerId,...(project?[project.projectAccessId,project.organizationId,project.projectId,ownerId,artifactId,now]:[now])).first<{content:string}>();
  if (!source) return Response.json({ error: "artifact_content_unavailable" }, { status: 404 });
  const original = parseDocumentArtifactContent(source.content);
  if (!original || artifact.kind!=="model3d" && Object.hasOwn(JSON.parse(source.content),"model3d_revision"))
    return Response.json({ error: "artifact_content_invalid" }, { status: 409 });
  const edits=history.filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId);
  const revision=edits.length;
  const latestEdit=edits.at(-1);
  // Retain exact private envelopes and one source snapshot through every asynchronous
  // media operation. These predicates also participate in the reference transaction.
  const videoGuards: Array<{sql:string;bindings:Array<string|number>}> = [];
  const videoGuardSql = () => videoGuards.map(guard=>` AND (${guard.sql})`).join("");
  const videoGuardBindings = () => videoGuards.flatMap(guard=>guard.bindings);
  const originalVideoArtifact = artifact.kind === "video" ? foldEvents(history.slice(0,history.indexOf(completed)+1),Infinity,documentId,projection.projectId)
    .artifacts.find(candidate=>candidate.id===artifactId) : undefined;
  const originalVideoItem = originalVideoArtifact ? videoArtifactMediaItem(originalVideoArtifact) : null;
  const originalVideoRawItems = Array.isArray(completed.payload.items) ? completed.payload.items : [];
  const originalVideoRawItem = originalVideoRawItems.find(value=>value && typeof value==="object" && !Array.isArray(value)
    && (value as Record<string,unknown>).id===originalVideoItem?.id) as Record<string,unknown>|undefined;
  const retainVideoPrivate = async (event:typeof completed) => {
    const guard={sql:`EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
      AND redacted_at IS NULL AND private_json=?)`,bindings:[event.eventId,ownerId,documentId,projection.projectId,JSON.stringify(event.payload)]};
    if (!await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.bindings).first()) return false;
    videoGuards.push(guard); return true;
  };
  const retainVideoSnapshot = async (number:number, raw:string, digest:string) => {
    const guard={sql:`EXISTS(SELECT 1 FROM artifact_revisions WHERE owner_id=? AND artifact_id=? AND document_id=? AND project_id=?
      AND organization_id IS NULL AND project_access_id IS NULL AND revision=? AND content_json=? AND content_sha256=?
      AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      bindings:[ownerId,artifactId,documentId,projection.projectId,number,raw,digest]};
    if (!await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.bindings).first()) return false;
    videoGuards.push(guard); return true;
  };
  const videoSourceWitness = async (record:VideoMediaRevision) => {
    if (!originalVideoArtifact || !originalVideoItem || record.source.itemId !== originalVideoItem.id) return false;
    const row=await env.DB.prepare(`SELECT content_json,content_sha256 FROM artifact_revisions WHERE owner_id=? AND artifact_id=?
      AND document_id=? AND project_id=? AND revision=? AND organization_id IS NULL AND project_access_id IS NULL
      AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .bind(ownerId,artifactId,documentId,projection.projectId,record.source.revision).first<{content_json:string;content_sha256:string}>();
    if (!row || row.content_sha256 !== record.source.contentSha256 || await sha256(row.content_json) !== row.content_sha256) return false;
    const draft=parseDocumentArtifactContent(row.content_json);
    if (!draft || draft.audio_revision || !await retainVideoSnapshot(record.source.revision,row.content_json,row.content_sha256)) return false;
    if (record.source.revision>0) {
      const event=edits[record.source.revision-1];
      if (!event || event.payload.revision !== record.source.revision || event.payload.content_sha256 !== row.content_sha256
        || !await retainVideoPrivate(event)) return false;
      if (draft.video_revision) {
        if (JSON.stringify(parseVideoMediaRevision(event.payload.video_revision)) !== JSON.stringify(draft.video_revision)) return false;
      } else if (Object.hasOwn(event.payload,"video_revision") && !(event.payload.video_revision===null
        && event.payload.revision_action==="restore" && event.payload.source_surface==="document-artifact-history")) return false;
    } else if (draft.video_revision) return false;
    const previous=draft.video_revision;
    if (previous) return previous.source.revision<record.source.revision && previous.source.itemId===record.source.itemId && previous.media.url===record.source.url
      && previous.media.sha256===record.source.sha256 && previous.sampleCount===record.source.sampleCount
      && previous.timescale===record.source.timescale && previous.durationTicks===record.source.durationTicks
      && previous.width===record.source.width && previous.height===record.source.height;
    const originalHash=originalVideoArtifact.settings.source_media_sha256;
    return record.source.url===originalVideoItem.mediaUrl && (originalHash===undefined || originalHash===record.source.sha256);
  };
  const videoCurrentWitness = async () => {
    if (project || !originalVideoArtifact || !originalVideoItem || !originalVideoRawItem || typeof originalVideoRawItem.id!=="string"
      || !originalVideoRawItem.id.trim() || original.audio_revision || !await retainVideoPrivate(completed)) return false;
    const item=videoArtifactMediaItem(artifact);
    if (!item || item.id!==originalVideoItem.id) return false;
    if (latestEdit && (latestEdit.payload.revision!==revision || latestEdit.payload.content_sha256!==await sha256(source.content)
      || !await retainVideoPrivate(latestEdit))) return false;
    if (original.video_revision) return Boolean(latestEdit && original.video_revision.source.revision<revision
      && JSON.stringify(parseVideoMediaRevision(latestEdit.payload.video_revision))===JSON.stringify(original.video_revision)
      && item.mediaUrl===original.video_revision.media.url && artifact.settings.source_media_sha256===original.video_revision.media.sha256
      && await videoSourceWitness(original.video_revision));
    if (latestEdit && Object.hasOwn(latestEdit.payload,"video_revision") && !(latestEdit.payload.video_revision===null
      && latestEdit.payload.revision_action==="restore" && latestEdit.payload.source_surface==="document-artifact-history")) return false;
    return item.mediaUrl===originalVideoItem.mediaUrl;
  };
  const originalModel3dArtifact = artifact.kind === "model3d" ? foldEvents(history.slice(0,history.indexOf(completed)+1),Infinity,documentId,projection.projectId)
    .artifacts.find(candidate=>candidate.id===artifactId) : undefined;
  const originalModel3dFile = originalModel3dArtifact ? model3dArtifactMediaFile(originalModel3dArtifact) : null;
  const retainModel3dMediaScope = async (url:string) => {
    let key:string; try { key=decodeURIComponent(url.slice("/api/media/".length)); } catch { return false; }
    const guard={sql:"NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='media' AND resource_id=?)",bindings:[key]};
    if (!await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.bindings).first()) return false;
    videoGuards.push(guard); return true;
  };
  const retainModel3dInheritedRights = async () => {
    if (!originalModel3dFile) return false;
    const inherited=await model3dScaleSource(env,ownerId,originalModel3dFile.url,originalModel3dFile.sha256,originalModel3dFile.fileSize,null,true);
    if (!inherited) return false;
    if (inherited.rightsValidUntil) videoGuards.push({sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[inherited.rightsValidUntil]});
    return true;
  };
  const model3dContextWitness = async () => {
    const versions=artifactSourceVersions(artifactId,history);
    if (!versions?.length || new Set(versions.map(value=>value.block_id)).size!==versions.length
      || versions.some(value=>typeof value.block_id!=="string" || !Number.isSafeInteger(value.version) || Number(value.version)<1)) return false;
    let context:ReturnType<typeof authoritativeCreativeContext>;
    try { context=authoritativeCreativeContext(history,{documentId,projectId:projection.projectId,sourceBlockVersions:versions}); }
    catch { return false; }
    if (context.sourceBlockVersions.length!==versions.length) return false;
    const ids=new Set(context.projection.documents.find(value=>value.id===documentId)?.sourceEvents??[]);
    const deadlines:string[]=[];
    for (const block of context.projection.blocks.filter(value=>!value.removed)) {
      for (const id of block.sourceEvents) ids.add(id);
      if (Number(block.properties.weight??.5)<=0) continue;
      const rights=creativeContextRightsValidity(block.properties);
      if (rights.issue) return false; if (rights.validUntil) deadlines.push(rights.validUntil);
      const reference=String(block.properties.reference_id??"");
      if (reference) {
        const receipts=history.filter(event=>["ReferenceIngested","RightsAsserted"].includes(event.type) && event.payload.reference_id===reference);
        if (!receipts.length) return false;
        for (const event of receipts) ids.add(event.eventId);
        const latest=creativeContextRightsValidity(receipts.at(-1)!.payload);
        if (latest.issue) return false; if (latest.validUntil) deadlines.push(latest.validUntil);
      }
    }
    for (const relation of context.projection.blockRelations) for (const id of relation.sourceEvents) ids.add(id);
    const sourceVersionEvent=[...history].reverse().find(event=>["DocumentRenderCompleted","DocumentRenderRequested"].includes(event.type)
      && event.payload.artifact_id===artifactId && Array.isArray(event.payload.source_block_versions));
    if (!sourceVersionEvent) return false; ids.add(sourceVersionEvent.eventId);
    const rows=await env.DB.prepare(`SELECT event.*,secret.private_json,secret.owner_id AS private_owner,secret.redacted_at
      FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))`)
      .bind(actor.streamId,JSON.stringify([...ids])).all<Record<string,unknown>>();
    if (rows.results.length!==ids.size) return false;
    for (const row of rows.results) {
      const expected=history.find(event=>event.eventId===row.event_id);
      if (!expected || row.redacted_at!==null || row.private_json!==null && row.private_owner!==ownerId) return false;
      try { if (JSON.stringify(serializeEvent(row))!==JSON.stringify(expected)) return false; } catch { return false; }
    }
    const snapshot=JSON.stringify(rows.results.map(row=>({id:row.event_id,sequence:row.sequence,type:row.type,actor:row.actor,clientId:row.client_id,
      correlationId:row.correlation_id,causationId:row.causation_id,compensatesId:row.compensates_event_id,payload:row.payload,privateJson:row.private_json,privateOwner:row.private_owner})));
    if (new TextEncoder().encode(snapshot).length>1_000_000) return false;
    videoGuards.push({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM events event
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.stream_id=?
      AND (event.event_id,event.sequence,event.type,event.actor,event.client_id,event.correlation_id,event.payload)=
        (json_extract(expected.value,'$.id'),json_extract(expected.value,'$.sequence'),json_extract(expected.value,'$.type'),
         json_extract(expected.value,'$.actor'),json_extract(expected.value,'$.clientId'),json_extract(expected.value,'$.correlationId'),json_extract(expected.value,'$.payload'))
      AND (event.causation_id,event.compensates_event_id,secret.private_json,secret.owner_id) IS
        (json_extract(expected.value,'$.causationId'),json_extract(expected.value,'$.compensatesId'),json_extract(expected.value,'$.privateJson'),json_extract(expected.value,'$.privateOwner'))
      AND secret.redacted_at IS NULL))`,bindings:[snapshot,actor.streamId]});
    if (deadlines.length) videoGuards.push({sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[deadlines.sort()[0]!]});
    return true;
  };
  const model3dSourceWitness = async (record:Model3dMediaRevision) => {
    if (!originalModel3dFile || !await retainModel3dMediaScope(record.source.url)) return false;
    const row=await env.DB.prepare(`SELECT content_json,content_sha256 FROM artifact_revisions WHERE owner_id=? AND artifact_id=?
      AND document_id=? AND project_id=? AND revision=? AND organization_id IS NULL AND project_access_id IS NULL
      AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .bind(ownerId,artifactId,documentId,projection.projectId,record.source.revision).first<{content_json:string;content_sha256:string}>();
    if (!row || row.content_sha256!==record.source.contentSha256 || await sha256(row.content_json)!==row.content_sha256) return false;
    const draft=parseDocumentArtifactContent(row.content_json);
    if (!draft || draft.audio_revision || draft.video_revision || !await retainVideoSnapshot(record.source.revision,row.content_json,row.content_sha256)) return false;
    if (record.source.revision>0) {
      const event=edits[record.source.revision-1];
      if (!event || event.payload.revision!==record.source.revision || event.payload.content_sha256!==row.content_sha256 || !await retainVideoPrivate(event)) return false;
      if (draft.model3d_revision) {
        if (JSON.stringify(parseModel3dMediaRevision(event.payload.model3d_revision))!==JSON.stringify(draft.model3d_revision)) return false;
      } else if (Object.hasOwn(event.payload,"model3d_revision") && !(event.payload.model3d_revision===null
        && event.payload.revision_action==="restore" && event.payload.source_surface==="document-artifact-history")) return false;
    } else if (draft.model3d_revision) return false;
    const previous=draft.model3d_revision;
    return previous ? previous.source.revision<record.source.revision && previous.media.url===record.source.url
      && previous.media.sha256===record.source.sha256 && previous.media.byteLength===record.source.byteLength
      && JSON.stringify(previous.afterBounds)===JSON.stringify(record.beforeBounds)
      && previous.vertexCount===record.vertexCount && previous.positionAccessorCount===record.positionAccessorCount
      : originalModel3dFile.url===record.source.url && originalModel3dFile.sha256===record.source.sha256 && originalModel3dFile.fileSize===record.source.byteLength;
  };
  const model3dCurrentWitness = async () => {
    if (project || !originalModel3dFile || original.audio_revision || original.video_revision || !await retainVideoPrivate(completed)
      || !await model3dContextWitness()) return false;
    const file=model3dArtifactMediaFile(artifact);
    if (!file || !await retainModel3dMediaScope(originalModel3dFile.url) || !await retainModel3dMediaScope(file.url)
      || !await retainModel3dInheritedRights() || latestEdit && (latestEdit.payload.revision!==revision || latestEdit.payload.content_sha256!==await sha256(source.content)
      || !await retainVideoPrivate(latestEdit))) return false;
    if (original.model3d_revision) return Boolean(latestEdit && original.model3d_revision.source.revision<revision
      && JSON.stringify(parseModel3dMediaRevision(latestEdit.payload.model3d_revision))===JSON.stringify(original.model3d_revision)
      && file.url===original.model3d_revision.media.url && file.sha256===original.model3d_revision.media.sha256
      && file.fileSize===original.model3d_revision.media.byteLength && await model3dSourceWitness(original.model3d_revision));
    if (latestEdit && Object.hasOwn(latestEdit.payload,"model3d_revision") && !(latestEdit.payload.model3d_revision===null
      && latestEdit.payload.revision_action==="restore" && latestEdit.payload.source_surface==="document-artifact-history")) return false;
    return file.url===originalModel3dFile.url && file.sha256===originalModel3dFile.sha256 && file.fileSize===originalModel3dFile.fileSize;
  };
  if (checkRequest && model3dCheck) {
    if (project || artifact.kind!=="model3d") return Response.json({error:"model3d_scale_unsupported"},{status:400});
    if (revision<=checkRevision) return Response.json({error:"model3d_scale_unconfirmed"},{status:409});
    if (revision!==checkRevision+1 || latestEdit?.payload.model3d_scale_request_sha256!==checkFingerprint)
      return Response.json({error:"artifact_revision_conflict",revision},{status:409});
    if (!original.model3d_revision || original.model3d_revision.source.revision!==checkRevision || !await model3dCurrentWitness())
      return Response.json({error:"model3d_scale_unconfirmed"},{status:409});
    const admission=audioTrimAdmission(env,actor,projection.projectId,documentId,artifactId,contentId);
    const current=await env.DB.prepare(`SELECT 1 WHERE (${admission.sql})
      AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND content=? AND redacted_at IS NULL
        AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))${videoGuardSql()}`)
      .bind(...admission.bindings,actor.streamId,initialPersonalHead,contentId,ownerId,source.content,...videoGuardBindings()).first();
    if (!current) return Response.json({error:"model3d_scale_unconfirmed"},{status:409});
    return Response.json({appended:[latestEdit],head:initialPersonalHead,content:{[contentId]:source.content},revision},{headers:{"cache-control":"private, no-store"}});
  }
  if (checkRequest && videoCheck) {
    if (project || artifact.kind!=="video") return Response.json({error:"video_trim_unsupported"},{status:400});
    if (revision<=checkRevision) return Response.json({error:"video_trim_unconfirmed"},{status:409});
    if (revision!==checkRevision+1 || latestEdit?.payload.video_trim_request_sha256!==checkFingerprint)
      return Response.json({error:"artifact_revision_conflict",revision},{status:409});
    if (!original.video_revision || original.video_revision.source.revision!==checkRevision || !await videoCurrentWitness())
      return Response.json({error:"video_trim_unconfirmed"},{status:409});
    const admission=audioTrimAdmission(env,actor,projection.projectId,documentId,artifactId,contentId);
    const current=await env.DB.prepare(`SELECT 1 WHERE (${admission.sql})
      AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND content=? AND redacted_at IS NULL
        AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))${videoGuardSql()}`)
      .bind(...admission.bindings,actor.streamId,initialPersonalHead,contentId,ownerId,source.content,...videoGuardBindings()).first();
    if (!current) return Response.json({error:"video_trim_unconfirmed"},{status:409});
    return Response.json({appended:[latestEdit],head:initialPersonalHead,content:{[contentId]:source.content},revision},{headers:{"cache-control":"private, no-store"}});
  }
  if (checkRequest) {
    if (project || artifact.kind !== "audio") return Response.json({error:"audio_trim_unsupported"},{status:400});
    if (revision <= checkRevision) return Response.json({error:"audio_trim_unconfirmed"},{status:409});
    const saved = original.audio_revision;
    if (revision !== checkRevision + 1 || latestEdit?.payload.audio_trim_request_sha256 !== checkFingerprint)
      return Response.json({error:"artifact_revision_conflict",revision},{status:409});
    if (!saved || saved.source.revision !== checkRevision || latestEdit.payload.content_sha256 !== await sha256(source.content)
      || JSON.stringify(parseAudioMediaRevision(latestEdit.payload.audio_revision)) !== JSON.stringify(saved)
      || artifact.mediaUrl !== saved.media.url || artifact.settings.source_media_sha256 !== saved.media.sha256)
      return Response.json({error:"audio_trim_unconfirmed"},{status:409});
    const admission = audioTrimAdmission(env,actor,projection.projectId,documentId,artifactId,contentId);
    const current = await env.DB.prepare(`SELECT 1 AS current WHERE (${admission.sql})
      AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND content=? AND redacted_at IS NULL
        AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
        AND redacted_at IS NULL AND private_json=?)`)
      .bind(...admission.bindings,actor.streamId,initialPersonalHead,contentId,ownerId,source.content,
        latestEdit.eventId,ownerId,documentId,projection.projectId,JSON.stringify(latestEdit.payload)).first();
    if (!current) return Response.json({error:"audio_trim_unconfirmed"},{status:409});
    return Response.json({appended:[latestEdit],head:initialPersonalHead,content:{[contentId]:source.content},revision},
      {headers:{"cache-control":"private, no-store"}});
  }
  const currentAuthor=latestEdit?String(latestEdit.payload.edited_by_user_id??(latestEdit.actor.startsWith("user:")?latestEdit.actor.slice(5):ownerId)):String(completed.payload.requested_by_user_id??ownerId);
  const currentCreatedAt=latestEdit?.occurredAt??completed.occurredAt;
  const revisionScope=project?" AND organization_id=? AND project_access_id=? AND project_id=?":" AND organization_id IS NULL AND project_access_id IS NULL";
  const revisionBindings=project?[project.organizationId,project.projectAccessId,project.projectId]:[];
  if(listRequest){
    const beforeValue=new URL(request.url).searchParams.get("before");
    const before=beforeValue===null?null:Number(beforeValue);
    if(before!==null&&(!/^\d+$/.test(beforeValue??"")||!Number.isSafeInteger(before)))return Response.json({error:"invalid_revision_cursor"},{status:400});
    const revisions=await env.DB.prepare(`SELECT revision,content_sha256,created_by_user_id,created_at,expires_at,redacted_at,
      (${project?revisionHoldSql("artifact_revisions"):"0"}) AS legally_held
      FROM artifact_revisions WHERE owner_id=? AND artifact_id=?${revisionScope}${before===null?"":" AND revision<?"} ORDER BY revision DESC LIMIT 101`)
      .bind(ownerId,artifactId,...revisionBindings,...(before===null?[]:[before])).all<Omit<RevisionRow,"content_json">>();
    const entries=revisions.results.slice(0,100).map((entry)=>({revision:Number(entry.revision),sha256:entry.content_sha256,createdByUserId:entry.created_by_user_id,createdAt:entry.created_at,expiresAt:entry.expires_at,available:!entry.redacted_at&&(entry.expires_at>now||Boolean(entry.legally_held)),current:Number(entry.revision)===revision}));
    const current=entries.find((entry)=>entry.current);
    if(current&&!current.available){current.available=true;current.expiresAt="9999-12-31T23:59:59.999Z";current.sha256=await sha256(source.content);}
    if(!current&&before===null)entries.unshift({revision,sha256:await sha256(source.content),createdByUserId:currentAuthor,createdAt:currentCreatedAt,expiresAt:"9999-12-31T23:59:59.999Z",available:true,current:true});
    return Response.json({artifactId,documentId,currentRevision:revision,earlierHistoryUnavailable:revision>0&&!revisions.results.some((entry)=>Number(entry.revision)<revision),nextBefore:revisions.results.length>100?entries.at(-1)?.revision??null:null,revisions:entries});
  }
  const selectedRevision=detailRequest||restoreRequest?Number(path[1]):-1;
  if((detailRequest||restoreRequest)&&(!/^\d+$/.test(path[1]??"")||!Number.isSafeInteger(selectedRevision)||selectedRevision<0))return Response.json({error:"artifact_revision_unavailable"},{status:404});
  let historical:RevisionRow|null=null;
  if(detailRequest||restoreRequest){
    historical=await env.DB.prepare(`SELECT revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at,
      (${project?revisionHoldSql("artifact_revisions"):"0"}) AS legally_held
      FROM artifact_revisions WHERE owner_id=? AND artifact_id=? AND revision=?${revisionScope}`)
      .bind(ownerId,artifactId,selectedRevision,...revisionBindings).first<RevisionRow>();
    if((!historical||historical.redacted_at||historical.expires_at<=now&&!historical.legally_held)&&selectedRevision===revision)historical={revision,content_json:source.content,content_sha256:await sha256(source.content),created_by_user_id:currentAuthor,created_at:currentCreatedAt,expires_at:"9999-12-31T23:59:59.999Z",redacted_at:null};
    if(!historical||historical.redacted_at||historical.expires_at<=now&&!historical.legally_held)return Response.json({error:"artifact_revision_unavailable"},{status:404});
    if(await sha256(historical.content_json)!==historical.content_sha256)return Response.json({error:"artifact_revision_corrupted"},{status:409});
    const retained=parseDocumentArtifactContent(historical.content_json);
    if(!retained || artifact.kind!=="model3d" && Object.hasOwn(JSON.parse(historical.content_json),"model3d_revision"))
      return Response.json({error:"artifact_revision_unavailable"},{status:404});
    if(detailRequest)return Response.json({artifactId,documentId,revision:selectedRevision,currentRevision:revision,sha256:historical.content_sha256,createdByUserId:historical.created_by_user_id,createdAt:historical.created_at,content:{markdown:retained.content_markdown,items:retained.items.map((item)=>({title:item.title,body:item.body,notes:item.notes}))}});
  }

  let input:{markdown?:unknown;items?:unknown;expectedRevision?:unknown;expectedContentSha256?:unknown;audioTrim?:unknown;videoTrim?:unknown;model3dScale?:unknown};
  try{input=await request.json() as typeof input;}catch{return Response.json({error:"invalid_artifact_edit"},{status:400});}
  if(!input||typeof input!=="object"||Array.isArray(input))return Response.json({error:"invalid_artifact_edit"},{status:400});
  const trimRequested = editRequest && Object.hasOwn(input, "audioTrim");
  const trimInput = trimRequested ? audioTrimRequest(input) : null;
  const videoRequested = editRequest && Object.hasOwn(input,"videoTrim");
  const videoInput = videoRequested ? parseVideoTrimEditRequest(input) : null;
  const model3dRequested = editRequest && Object.hasOwn(input,"model3dScale");
  const model3dInput = model3dRequested ? parseModel3dScaleEditRequest(input) : null;
  if (model3dRequested && !model3dInput) return Response.json({error:"model3d_scale_invalid_scale"},{status:400});
  if (model3dInput && (project || artifact.kind!=="model3d")) return Response.json({error:"model3d_scale_unsupported"},{status:400});
  if (videoRequested && !videoInput) return Response.json({error:"video_trim_invalid_range"},{status:400});
  if (videoInput && (project || artifact.kind!=="video")) return Response.json({error:"video_trim_unsupported"},{status:400});
  if (trimRequested && !trimInput) return Response.json({error:"audio_trim_invalid_range"},{status:400});
  if (trimInput && (project || artifact.kind !== "audio")) return Response.json({error:"audio_trim_unsupported"},{status:400});
  const trimFingerprint = trimInput ? await sha256(JSON.stringify(trimInput)) : null;
  const videoFingerprint = videoInput ? await sha256(JSON.stringify(videoInput)) : null;
  const model3dFingerprint = model3dInput ? await sha256(JSON.stringify(model3dInput)) : null;
  const personalAudioRestore = restoreRequest && artifact.kind === "audio" && !project;
  const personalVideoRestore = restoreRequest && artifact.kind === "video" && !project;
  const personalModel3dRestore = restoreRequest && artifact.kind === "model3d" && !project;
  const videoOperation = Boolean(videoInput || personalVideoRestore);
  const model3dOperation = Boolean(model3dInput || personalModel3dRestore);
  const uncertainError = model3dOperation ? "model3d_scale_unconfirmed" : videoOperation ? "video_trim_unconfirmed" : "audio_trim_unconfirmed";
  if (model3dOperation && !await model3dCurrentWitness()) return Response.json({error:"model3d_scale_unavailable"},{status:404});
  if (videoOperation && !await videoCurrentWitness()) return Response.json({error:"video_trim_unavailable"},{status:404});
  const trimAdmission = trimInput || personalAudioRestore || videoOperation || model3dOperation ? audioTrimAdmission(env, actor, projection.projectId, documentId, artifactId, contentId) : null;
  const trimStillCurrent = async () => Boolean(trimAdmission && await env.DB.prepare(`SELECT 1 AS current
    WHERE (${trimAdmission.sql}) AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact'
        AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND content=?)${videoGuardSql()}`)
    .bind(...trimAdmission.bindings,actor.streamId,initialPersonalHead,contentId,ownerId,source.content,...videoGuardBindings()).first());
  if (model3dInput && model3dInput.expectedRevision!==revision) {
    const saved=original.model3d_revision;
    if (revision===model3dInput.expectedRevision+1 && latestEdit?.payload.model3d_scale_request_sha256===model3dFingerprint && saved
      && saved.source.revision===model3dInput.expectedRevision && saved.source.contentSha256===model3dInput.expectedContentSha256
      && saved.source.sha256===model3dInput.model3dScale.sourceMediaSha256 && saved.factor===model3dInput.model3dScale.factor
      && saved.media.sha256===model3dInput.model3dScale.resultMediaSha256 && await trimStillCurrent())
      return Response.json({appended:[latestEdit],head:initialPersonalHead,content:{[contentId]:source.content},revision});
    return Response.json({error:"artifact_revision_conflict",revision},{status:409});
  }
  if (videoInput && videoInput.expectedRevision!==revision) {
    const saved=original.video_revision;
    if (revision===videoInput.expectedRevision+1 && latestEdit?.payload.video_trim_request_sha256===videoFingerprint && saved
      && saved.source.revision===videoInput.expectedRevision && saved.source.contentSha256===videoInput.expectedContentSha256
      && saved.source.sha256===videoInput.videoTrim.sourceMediaSha256 && saved.source.sampleCount===videoInput.videoTrim.sourceSampleCount
      && saved.startSample===videoInput.videoTrim.startSample && saved.endSample===videoInput.videoTrim.endSample
      && saved.media.sha256===videoInput.videoTrim.resultMediaSha256 && await trimStillCurrent())
      return Response.json({appended:[latestEdit],head:initialPersonalHead,content:{[contentId]:source.content},revision});
    return Response.json({error:"artifact_revision_conflict",revision},{status:409});
  }
  if (trimInput && trimInput.expectedRevision !== revision) {
    // An explicit retry of this exact operation can observe its original commit;
    // it never stages another object or creates a second edit event.
    const saved = original.audio_revision;
    if (revision === trimInput.expectedRevision + 1 && latestEdit?.payload.audio_trim_request_sha256 === trimFingerprint
      && saved && JSON.stringify(parseAudioMediaRevision(latestEdit.payload.audio_revision)) === JSON.stringify(saved)
      && saved.source.revision === trimInput.expectedRevision && saved.source.contentSha256 === trimInput.expectedContentSha256
      && saved.source.sha256 === trimInput.audioTrim.sourceMediaSha256 && saved.source.frameCount === trimInput.audioTrim.sourceFrameCount
      && saved.startFrame === trimInput.audioTrim.startFrame && saved.endFrame === trimInput.audioTrim.endFrame
      && saved.media.sha256 === trimInput.audioTrim.resultMediaSha256 && latestEdit.payload.content_sha256 === await sha256(source.content)
      && await trimStillCurrent()) {
      return Response.json({appended:[latestEdit],head:initialPersonalHead,content:{[contentId]:source.content},revision});
    }
    return Response.json({error:"artifact_revision_conflict",revision},{status:409});
  }
  if (trimInput || videoInput || model3dInput) input = { ...input, markdown: original.content_markdown };
  if(restoreRequest&&historical){
    const retained=parseDocumentArtifactContent(historical.content_json)!;
    input={expectedRevision:input.expectedRevision,markdown:retained.content_markdown,items:retained.items.map((item,index)=>({index,title:item.title,body:item.body,notes:item.notes}))};
  }
  if(!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0)return Response.json({error:"artifact_revision_required"},{status:400});
  const markdown=typeof input.markdown==="string"?input.markdown:null;
  if(markdown===null||!markdown.trim()||new TextEncoder().encode(markdown).length>MAX_ARTIFACT_MARKDOWN_BYTES)return Response.json({error:"invalid_artifact_markdown",message:"The finished output must contain no more than 512 KB of writing."},{status:400});
  if (Number(input.expectedRevision) !== revision) return Response.json({ error: "artifact_revision_conflict", revision }, { status: 409 });

  const restoredOriginal=restoreRequest&&historical?parseDocumentArtifactContent(historical.content_json):null;
  const edited=restoredOriginal??{...original,content_markdown:markdown,items:original.items.map((item)=>({...item}))};
  if (personalAudioRestore) {
    if (edited.audio_revision) {
      const retained = edited.audio_revision;
      if (retained.source.revision >= selectedRevision) return Response.json({error:"artifact_revision_corrupted"},{status:409});
      let media: Uint8Array | null;
      try { media = await audioTrimSource(env,ownerId,retained.media.url,retained.media.sha256); }
      catch { return Response.json({error:"audio_trim_unavailable"},{status:404}); }
      const info = media ? inspectPcmWav(media) : null;
      if (!media || !info || media.length !== retained.media.byteLength || info.frameCount !== retained.frameCount
        || info.channels !== retained.channels || info.sampleRate !== retained.sampleRate)
        return Response.json({error:"audio_trim_unavailable"},{status:404});
    }
    if (!await trimStillCurrent()) return Response.json({error:"artifact_revision_conflict",revision},{status:409});
  }
  let stagedAudio: {key:string} | null = null;
  let pendingAudio: {operationId:string;bytes:Uint8Array;sourceMediaSha256:string} | null = null;
  let stagedVideo: {key:string} | null = null;
  let pendingVideo: {operationId:string;key:string;bytes:Uint8Array;record:VideoMediaRevision} | null = null;
  let stagedModel3d: {key:string} | null = null;
  let pendingModel3d: {operationId:string;key:string;bytes:Uint8Array;record:Model3dMediaRevision} | null = null;
  if (personalModel3dRestore) {
    if (selectedRevision<revision && (!historical || !await retainVideoSnapshot(selectedRevision,historical.content_json,historical.content_sha256)))
      return Response.json({error:"artifact_revision_unavailable"},{status:404});
    const retained=edited.model3d_revision;
    if (edited.audio_revision || edited.video_revision || retained && (retained.source.revision>=selectedRevision || !await model3dSourceWitness(retained)))
      return Response.json({error:"artifact_revision_corrupted"},{status:409});
    const selectedEvent=selectedRevision>0?edits[selectedRevision-1]:null;
    if (selectedRevision>0 && (!selectedEvent || selectedEvent.payload.content_sha256!==historical?.content_sha256
      || retained && JSON.stringify(parseModel3dMediaRevision(selectedEvent.payload.model3d_revision))!==JSON.stringify(retained)
      || !retained && Object.hasOwn(selectedEvent.payload,"model3d_revision") && !(selectedEvent.payload.model3d_revision===null
        && selectedEvent.payload.revision_action==="restore" && selectedEvent.payload.source_surface==="document-artifact-history")
      || !await retainVideoPrivate(selectedEvent))) return Response.json({error:"artifact_revision_corrupted"},{status:409});
    if (!await retainModel3dMediaScope(retained?.media.url??originalModel3dFile!.url)) return Response.json({error:"model3d_scale_unavailable"},{status:404});
    const media=await model3dScaleSource(env,ownerId,retained?.media.url??originalModel3dFile!.url,
      retained?.media.sha256??originalModel3dFile!.sha256,retained?.media.byteLength??originalModel3dFile!.fileSize,retained??null);
    if (!media) return Response.json({error:"model3d_scale_unavailable"},{status:404});
    if (media.rightsValidUntil) videoGuards.push({sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[media.rightsValidUntil]});
    try {
      const geometry=scaleModel3dGeometry(media.bytes,1);
      if (retained && (JSON.stringify(geometry.beforeBounds)!==JSON.stringify(retained.afterBounds)
        || geometry.vertexCount!==retained.vertexCount || geometry.positionAccessorCount!==retained.positionAccessorCount))
        return Response.json({error:"model3d_scale_unavailable"},{status:404});
    } catch { return Response.json({error:"model3d_scale_unavailable"},{status:404}); }
    if (!await trimStillCurrent()) return Response.json({error:"artifact_revision_conflict",revision},{status:409});
  }
  if (model3dInput) {
    const sourceHash=await sha256(source.content), file=model3dArtifactMediaFile(artifact)!;
    if (sourceHash!==model3dInput.expectedContentSha256) return Response.json({error:"artifact_revision_conflict",revision},{status:409});
    if (file.sha256!==model3dInput.model3dScale.sourceMediaSha256) return Response.json({error:"model3d_scale_source_changed"},{status:409});
    const media=await model3dScaleSource(env,ownerId,file.url,file.sha256,file.fileSize,original.model3d_revision??null);
    if (!media) return Response.json({error:"model3d_scale_unavailable"},{status:404});
    if (media.rightsValidUntil) videoGuards.push({sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[media.rightsValidUntil]});
    let geometry:ReturnType<typeof scaleModel3dGeometry>;
    try { geometry=scaleModel3dGeometry(media.bytes,model3dInput.model3dScale.factor); }
    catch (error) { return Response.json({error:error instanceof GeometryScaleError && error.code!=="unsupported"?"model3d_scale_invalid_scale":"model3d_scale_unsupported"},{status:400}); }
    const resultHash=await audioBytesSha256(geometry.bytes);
    if (!geometry.changed || resultHash!==model3dInput.model3dScale.resultMediaSha256)
      return Response.json({error:"model3d_scale_invalid_scale"},{status:400});
    if (original.model3d_revision && (JSON.stringify(geometry.beforeBounds)!==JSON.stringify(original.model3d_revision.afterBounds)
      || geometry.vertexCount!==original.model3d_revision.vertexCount || geometry.positionAccessorCount!==original.model3d_revision.positionAccessorCount))
      return Response.json({error:"model3d_scale_source_changed"},{status:409});
    if (!await trimStillCurrent()) return Response.json({error:"model3d_scale_source_changed"},{status:409});
    const operationId=`model3d-scale-${uuidV7()}`,key=`${ownerMediaNamespace(ownerId)}/generated/${operationId}.glb`;
    const record=parseModel3dMediaRevision({schemaVersion:1,operation:"uniform-scale",
      media:{url:`/api/media/${encodeURIComponent(key)}`,mediaType:"model/gltf-binary",sha256:resultHash,byteLength:geometry.bytes.length,fileName:"scaled-model.glb"},
      source:{url:file.url,sha256:file.sha256,byteLength:file.fileSize,revision,contentSha256:sourceHash},factor:geometry.factor,
      beforeBounds:geometry.beforeBounds,afterBounds:geometry.afterBounds,vertexCount:geometry.vertexCount,positionAccessorCount:geometry.positionAccessorCount});
    if (!record) return Response.json({error:"model3d_scale_invalid_scale"},{status:400});
    edited.model3d_revision=record; pendingModel3d={operationId,key,bytes:geometry.bytes,record};
  }
  if (personalVideoRestore) {
    if (selectedRevision<revision && (!historical || !await retainVideoSnapshot(selectedRevision,historical.content_json,historical.content_sha256)))
      return Response.json({error:"artifact_revision_unavailable"},{status:404});
    const retained=edited.video_revision;
    if (edited.audio_revision || retained && (retained.source.revision>=selectedRevision || !await videoSourceWitness(retained)))
      return Response.json({error:"artifact_revision_corrupted"},{status:409});
    const selectedEvent=selectedRevision>0?edits[selectedRevision-1]:null;
    if (selectedRevision>0 && (!selectedEvent || selectedEvent.payload.content_sha256!==historical?.content_sha256
      || retained && JSON.stringify(parseVideoMediaRevision(selectedEvent.payload.video_revision))!==JSON.stringify(retained)
      || !retained && Object.hasOwn(selectedEvent.payload,"video_revision") && !(selectedEvent.payload.video_revision===null
        && selectedEvent.payload.revision_action==="restore" && selectedEvent.payload.source_surface==="document-artifact-history")
      || !await retainVideoPrivate(selectedEvent))) return Response.json({error:"artifact_revision_corrupted"},{status:409});
    const url=retained?.media.url??originalVideoItem!.mediaUrl!;
    const originalHash=originalVideoArtifact!.settings.source_media_sha256;
    if (!retained && originalHash!==undefined && typeof originalHash!=="string") return Response.json({error:"video_trim_unavailable"},{status:404});
    const bytes=await videoTrimSource(env,ownerId,url,retained?.media.sha256??(typeof originalHash==="string"?originalHash:null));
    const info=bytes?await inspectVideoPrefix(bytes):null;
    if (!bytes || !info || retained && (bytes.length!==retained.media.byteLength || info.sampleCount!==retained.sampleCount
      || info.timescale!==retained.timescale || info.durationTicks!==retained.durationTicks || info.width!==retained.width || info.height!==retained.height))
      return Response.json({error:"video_trim_unavailable"},{status:404});
    if (!await trimStillCurrent()) return Response.json({error:"artifact_revision_conflict",revision},{status:409});
  }
  if (videoInput) {
    const sourceHash=await sha256(source.content), item=videoArtifactMediaItem(artifact)!;
    if (sourceHash!==videoInput.expectedContentSha256) return Response.json({error:"artifact_revision_conflict",revision},{status:409});
    const mediaHash=original.video_revision?.media.sha256??originalVideoArtifact!.settings.source_media_sha256;
    if (mediaHash!==undefined && mediaHash!==videoInput.videoTrim.sourceMediaSha256)
      return Response.json({error:"video_trim_source_changed"},{status:409});
    const bytes=await videoTrimSource(env,ownerId,item.mediaUrl!,videoInput.videoTrim.sourceMediaSha256);
    if (!bytes) return Response.json({error:"video_trim_unavailable"},{status:404});
    const info=await inspectVideoPrefix(bytes);
    if (!info) return Response.json({error:"video_trim_unsupported"},{status:400});
    if (info.sampleCount!==videoInput.videoTrim.sourceSampleCount || original.video_revision && (bytes.length!==original.video_revision.media.byteLength
      || info.sampleCount!==original.video_revision.sampleCount || info.timescale!==original.video_revision.timescale
      || info.durationTicks!==original.video_revision.durationTicks || info.width!==original.video_revision.width || info.height!==original.video_revision.height))
      return Response.json({error:"video_trim_source_changed"},{status:409});
    const trimmed=await trimVideoPrefix(bytes,{startSample:0,endSample:videoInput.videoTrim.endSample});
    if (!trimmed || trimmed.sha256!==videoInput.videoTrim.resultMediaSha256)
      return Response.json({error:"video_trim_invalid_range"},{status:400});
    if (!await trimStillCurrent()) return Response.json({error:"video_trim_source_changed"},{status:409});
    if (!trimmed.changed) return Response.json({appended:[],content:{[contentId]:source.content},revision});
    const operationId=`video-trim-${uuidV7()}`, key=`${ownerMediaNamespace(ownerId)}/generated/${operationId}.mp4`;
    const record=parseVideoMediaRevision({schemaVersion:1,operation:"prefix-trim",
      media:{url:`/api/media/${encodeURIComponent(key)}`,mediaType:"video/mp4",sha256:trimmed.sha256,byteLength:trimmed.bytes.length},
      source:{url:item.mediaUrl,sha256:info.sourceSha256,revision,contentSha256:sourceHash,itemId:item.id,sampleCount:info.sampleCount,
        timescale:info.timescale,durationTicks:info.durationTicks,width:info.width,height:info.height},
      startSample:0,endSample:videoInput.videoTrim.endSample,sampleCount:trimmed.info.sampleCount,timescale:trimmed.info.timescale,
      durationTicks:trimmed.info.durationTicks,durationSeconds:trimmed.info.durationSeconds,width:trimmed.info.width,height:trimmed.info.height});
    if (!record) return Response.json({error:"video_trim_invalid_range"},{status:400});
    edited.video_revision=record; pendingVideo={operationId,key,bytes:trimmed.bytes,record};
  }
  if (trimInput) {
    const sourceHash = await sha256(source.content);
    if (sourceHash !== trimInput.expectedContentSha256 || latestEdit && latestEdit.payload.content_sha256 !== sourceHash)
      return Response.json({error:"artifact_revision_conflict",revision},{status:409});
    const mediaUrl = original.audio_revision?.media.url ?? artifact.mediaUrl;
    const mediaHash = original.audio_revision?.media.sha256 ?? artifact.settings.source_media_sha256;
    if (!mediaUrl || typeof mediaHash !== "string" || mediaHash !== trimInput.audioTrim.sourceMediaSha256
      || artifact.mediaUrl !== mediaUrl || artifact.settings.source_media_sha256 !== mediaHash)
      return Response.json({error:"audio_trim_source_changed"},{status:409});
    if (artifact.mediaType !== "audio/wav") return Response.json({error:"audio_trim_unsupported"},{status:400});
    let sourceBytes: Uint8Array | null;
    try { sourceBytes = await audioTrimSource(env, ownerId, mediaUrl, mediaHash); }
    catch { return Response.json({error:"audio_trim_unavailable"},{status:404}); }
    if (!sourceBytes) return Response.json({error:"audio_trim_unavailable"},{status:404});
    const info = inspectPcmWav(sourceBytes);
    if (!info) return Response.json({error:"audio_trim_unsupported"},{status:400});
    if (info.frameCount !== trimInput.audioTrim.sourceFrameCount) return Response.json({error:"audio_trim_source_changed"},{status:409});
    const trimmed = trimPcmWav(sourceBytes, trimInput.audioTrim.startFrame, trimInput.audioTrim.endFrame);
    const resultHash = trimmed ? await audioBytesSha256(trimmed.bytes) : null;
    if (!trimmed || resultHash !== trimInput.audioTrim.resultMediaSha256)
      return Response.json({error:"audio_trim_invalid_range"},{status:400});
    if (!await trimStillCurrent()) return Response.json({error:"audio_trim_source_changed"},{status:409});
    if (!trimmed.changed) return Response.json({appended:[],content:{[contentId]:source.content},revision});
    // Allocate the immutable identity now, but validate the full revision before any R2 put.
    const operationId = `audio-trim-${uuidV7()}`, key = `${ownerMediaNamespace(ownerId)}/generated/${operationId}.wav`;
    const audioRevision = parseAudioMediaRevision({schemaVersion:1,operation:"trim",media:{url:`/api/media/${encodeURIComponent(key)}`,mediaType:"audio/wav",sha256:resultHash,byteLength:trimmed.bytes.length},
      source:{url:mediaUrl,sha256:mediaHash,revision,contentSha256:sourceHash,frameCount:info.frameCount},startFrame:trimmed.startFrame,endFrame:trimmed.endFrame,
      sampleRate:info.sampleRate,channels:info.channels,bitsPerSample:16,frameCount:trimmed.frameCount,durationSeconds:trimmed.durationSeconds});
    if (!audioRevision) return Response.json({error:"audio_trim_invalid_range"},{status:400});
    edited.audio_revision = audioRevision; pendingAudio = {operationId,bytes:trimmed.bytes,sourceMediaSha256:mediaHash};
  }
  if (input.items !== undefined) {
    if (!Array.isArray(input.items) || input.items.length > MAX_ARTIFACT_ITEMS) return Response.json({ error: "invalid_artifact_items" }, { status: 400 });
    for (const candidate of input.items as EditedItem[]) {
      if (!candidate || typeof candidate !== "object" || !Number.isSafeInteger(candidate.index)) return Response.json({ error: "invalid_artifact_items" }, { status: 400 });
      const index = Number(candidate.index);
      if (index < 0 || index >= edited.items.length) return Response.json({ error: "invalid_artifact_items" }, { status: 400 });
      for (const field of ["title", "body", "notes"] as const) {
        if (candidate[field] === undefined) continue;
        if (typeof candidate[field] !== "string" || new TextEncoder().encode(candidate[field]).length > MAX_ARTIFACT_ITEM_BYTES) return Response.json({ error: "invalid_artifact_items" }, { status: 400 });
        edited.items[index]![field] = candidate[field];
      }
    }
  } else if (edited.items.length === 1 && ["short_story", "scene"].includes(artifact.kind)) {
    edited.items[0]!.body = markdown;
  }
  const sourceContract=artifact.kind==="slides"
    ?await trustedPresentationRevisionSourceContract(env,completed.payload,artifactId,documentId,project?.projectId??projection.projectId,actor.userId,original.items.length,project??undefined,now)
    :undefined;
  const generatedModel3dBody = (raw:string) => {
    const body=JSON.parse(raw) as Record<string,unknown>;
    return typeof body.title==="string" && typeof body.summary==="string" && typeof body.content_markdown==="string"
      && Array.isArray(body.items) && body.items.length===0 && body.presentation===null;
  };
  // The production Model3D serializer stores a file descriptor and no narrative
  // items. Keep every other validation issue; zero is exact here, not a slide count.
  const generatedModel3dZeroItems = artifact.kind==="model3d" && original.items.length===0 && edited.items.length===0
    && original.presentation===null && edited.presentation===null && generatedModel3dBody(source.content)
    && (!historical || !restoreRequest || generatedModel3dBody(historical.content_json));
  const validation = documentArtifactValidationIssues(artifact.kind, edited, {
    itemCount: original.items.length,
    contextGroupIds: [...new Set(original.items.flatMap((item) => item.context_group_ids ?? []))],
    ...(sourceContract?{sourceContract,requireSourceGrounding:true,requireAllProtectedContent:true}:{}),
  }).filter(issue=>!generatedModel3dZeroItems || issue.code!=="wrong_item_count" || issue.path!=="items");
  if (validation.length) return Response.json({ error: "invalid_artifact_revision", message: validation[0]?.message ?? "The revised output is not valid.", issues: validation }, { status: 400 });
  const serialized=restoreRequest&&historical?historical.content_json:model3dInput
    ?JSON.stringify({...JSON.parse(source.content),model3d_revision:edited.model3d_revision}):videoInput
    ?JSON.stringify({...JSON.parse(source.content),video_revision:edited.video_revision}):JSON.stringify(edited);
  if(new TextEncoder().encode(serialized).length>MAX_ARTIFACT_REVISION_BYTES)return Response.json({error:"artifact_revision_too_large",message:"Recoverable output revisions cannot exceed one megabyte."},{status:400});
  if (serialized === source.content) return Response.json({ appended: [], content: { [contentId]: source.content }, revision });
  const digest=await sha256(serialized);
  const payload: Record<string, unknown> = {
    artifact_id: artifactId,
    artifact_kind: artifact.kind,
    document_id: documentId,
    project_id: project?.projectId ?? projection.projectId,
    content_ref: contentId,
    revision: revision + 1,
    changed_fields: model3dInput ? ["model3d_revision"] : videoInput ? ["video_revision"] : trimInput ? ["audio_revision"] : ["content_markdown", ...(input.items !== undefined || edited.items.length === 1 ? ["items"] : [])],
    content_sha256: digest,
    edited_by_user_id: actor.userId,
    source_surface:restoreRequest?"document-artifact-history":model3dInput?"document-artifact-model3d-scale":videoInput?"document-artifact-video-trim":trimInput?"document-artifact-audio-trim":"document-artifact-editor",
    ...(artifact.kind === "audio" && edited.audio_revision ? {audio_revision:edited.audio_revision} : artifact.kind === "audio" && restoreRequest ? {audio_revision:null} : {}),
    ...(trimFingerprint ? {audio_trim_request_sha256:trimFingerprint} : {}),
    ...(artifact.kind === "video" && edited.video_revision ? {video_revision:edited.video_revision} : artifact.kind === "video" && restoreRequest ? {video_revision:null} : {}),
    ...(videoFingerprint ? {video_trim_request_sha256:videoFingerprint} : {}),
    ...(artifact.kind === "model3d" && edited.model3d_revision ? {model3d_revision:edited.model3d_revision} : artifact.kind === "model3d" && restoreRequest ? {model3d_revision:null} : {}),
    ...(model3dFingerprint ? {model3d_scale_request_sha256:model3dFingerprint} : {}),
    ...(restoreRequest?{restored_from_revision:selectedRevision,revision_action:"restore"}:{}),
  };
  const currentStored=await env.DB.prepare("SELECT revision FROM artifact_revisions WHERE owner_id=? AND artifact_id=? AND revision=?")
    .bind(ownerId,artifactId,revision).first<{revision:number}>();
  if (videoOperation || model3dOperation) {
    if (currentStored) {
      if (!await retainVideoSnapshot(revision,source.content,await sha256(source.content))) return Response.json({error:model3dOperation?"model3d_scale_unavailable":"video_trim_unavailable"},{status:404});
    } else videoGuards.push({sql:"NOT EXISTS(SELECT 1 FROM artifact_revisions WHERE owner_id=? AND artifact_id=? AND revision=?)",bindings:[ownerId,artifactId,revision]});
  }
  const policy=project?await env.DB.prepare("SELECT revision_days FROM organization_retention_policies WHERE organization_id=?")
    .bind(project.organizationId).first<{revision_days:number}>():null;
  const expiresAt=new Date(Date.now()+Number(policy?.revision_days??DEFAULT_ARTIFACT_REVISION_DAYS)*86_400_000).toISOString();
  const revisions:ArtifactRevisionSnapshot[]=[];
  if(!currentStored)revisions.push({revisionId:uuidV7(),revision,contentJson:source.content,contentSha256:await sha256(source.content),createdByUserId:currentAuthor,createdAt:currentCreatedAt,expiresAt});
  revisions.push({revisionId:uuidV7(),revision:revision+1,contentJson:serialized,contentSha256:digest,createdByUserId:actor.userId,createdAt:now,expiresAt});
  const restoreSource=restoreRequest&&historical?{revision:selectedRevision,contentSha256:historical.content_sha256,contentJson:historical.content_json}:undefined;

  if (project) {
    const response=await appendProjectEvents(env,project,actor,{action:"append",clientId:"web:artifact-editor",event:{type:"DocumentArtifactEdited",payload}},{artifactId,contentId,oldContent:source.content,newContent:serialized,expectedRevision:revision,documentId,revisions,...(restoreSource?{restoreSource}:{})});
    if (!response.ok) return response;
    const result = await response.json() as Record<string, unknown>;
    if(!selected.context){
      const projected=Array.isArray(result.appended)?result.appended as Array<{eventId?:unknown}>:[];
      const ownerEvents=await Promise.all(projected.map(async(event)=>{
        const row=await env.DB.prepare("SELECT * FROM events WHERE event_id=? AND stream_id=?").bind(String(event.eventId??""),actor.streamId).first<Record<string,unknown>>();
        return row?serializeEvent(row):null;
      }));
      if(ownerEvents.some((event)=>event===null))return Response.json({error:"artifact_revision_conflict",revision},{status:409});
      return Response.json({...result,appended:ownerEvents,head:await streamHead(env,actor.streamId),content:{[contentId]:serialized},revision:revision+1});
    }
    return Response.json({ ...result, content: { [contentId]: serialized }, revision: revision + 1 });
  }

  if (pendingAudio) {
    if (!await trimStillCurrent()) return Response.json({error:"audio_trim_source_changed"},{status:409});
    try {
      // R2 staging remains separate from the atomic DB reference commit.
      const retained = await storeGeneratedMedia(env,ownerId,pendingAudio.operationId,pendingAudio.bytes,"local-pcm-trim","audio/wav",
        {source:"authored-audio-edit",artifactId,sourceMediaSha256:pendingAudio.sourceMediaSha256,sourceRevision:String(revision),requestSha256:trimFingerprint!});
      stagedAudio = {key:retained.key};
    } catch { return Response.json({error:"audio_trim_unconfirmed"},{status:503}); }
  }
  if (pendingVideo) {
    if (!await trimStillCurrent()) return Response.json({error:"video_trim_source_changed"},{status:409});
    try {
      const retained=await boundedVideoOperation(storeGeneratedMedia(env,ownerId,pendingVideo.operationId,pendingVideo.bytes,"local-video-prefix-trim","video/mp4",
        {source:"authored-video-edit",artifactId,sourceMediaSha256:pendingVideo.record.source.sha256,sourceRevision:String(revision),requestSha256:videoFingerprint!,
          durationSeconds:String(pendingVideo.record.durationSeconds),sampleCount:String(pendingVideo.record.sampleCount),timescale:String(pendingVideo.record.timescale),
          durationTicks:String(pendingVideo.record.durationTicks),width:String(pendingVideo.record.width),height:String(pendingVideo.record.height)}));
      if (retained.key!==pendingVideo.key || retained.url!==pendingVideo.record.media.url || retained.contentHash!==pendingVideo.record.media.sha256)
        return Response.json({error:"video_trim_unconfirmed"},{status:503});
      stagedVideo={key:retained.key};
    } catch { return Response.json({error:"video_trim_unconfirmed"},{status:503}); }
  }
  if (pendingModel3d) {
    if (!await retainModel3dMediaScope(pendingModel3d.record.media.url) || !await trimStillCurrent()) return Response.json({error:"model3d_scale_source_changed"},{status:409});
    try {
      const retained=await boundedVideoOperation(storeGeneratedMedia(env,ownerId,pendingModel3d.operationId,pendingModel3d.bytes,"local-model3d-uniform-scale","model/gltf-binary",
        {source:"authored-model3d-edit",artifactId,fileName:"scaled-model.glb",sourceMediaSha256:pendingModel3d.record.source.sha256,sourceRevision:String(revision),requestSha256:model3dFingerprint!}));
      if (retained.key!==pendingModel3d.key || retained.url!==pendingModel3d.record.media.url || retained.contentHash!==pendingModel3d.record.media.sha256
        || retained.previewSupported!==true) return Response.json({error:"model3d_scale_unconfirmed"},{status:503});
      stagedModel3d={key:retained.key};
    } catch { return Response.json({error:"model3d_scale_unconfirmed"},{status:503}); }
  }
  if (model3dOperation && !await retainModel3dInheritedRights()) {
    // The acknowledged stage is known uncommitted: no DB request has been dispatched.
    try { if (stagedModel3d) await boundedVideoOperation(env.MEDIA.delete(stagedModel3d.key)); }
    catch { return Response.json({error:"model3d_scale_unconfirmed"},{status:503}); }
    return Response.json({error:"model3d_scale_source_changed"},{status:409});
  }
  const head = trimAdmission ? initialPersonalHead! : await streamHead(env, actor.streamId);
  const event = makeEvent(actor.streamId, head + 1, "user", "web:artifact-editor", uuidV7(), "DocumentArtifactEdited", payload);
  const restoreGuard=restoreSource?` AND EXISTS(SELECT 1 FROM artifact_revisions retained WHERE retained.owner_id=? AND retained.organization_id IS NULL AND retained.project_access_id IS NULL AND retained.artifact_id=? AND retained.revision=? AND retained.redacted_at IS NULL AND retained.expires_at>?${personalAudioRestore||personalVideoRestore||personalModel3dRestore?" AND retained.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')":""} AND retained.content_sha256=? AND retained.content_json=?)`:"";
  const statements=[
    env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS})
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
        AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>? AND content=?)
        AND (SELECT COUNT(*) FROM events revision WHERE revision.stream_id=? AND revision.type='DocumentArtifactEdited' AND json_extract(revision.payload,'$.artifact_id')=?)=?${restoreGuard}${trimAdmission?` AND (${trimAdmission.sql}) AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`:""}${videoGuardSql()}`)
      .bind(...eventWriteBindings(event),event.streamId,head,contentId,ownerId,now,source.content,event.streamId,artifactId,revision,...(restoreSource?[ownerId,artifactId,restoreSource.revision,now,restoreSource.contentSha256,restoreSource.contentJson]:[]),...(trimAdmission?[...trimAdmission.bindings,contentId]:[]),...videoGuardBindings()),
  ];
  for(const retained of revisions)statements.push(env.DB.prepare(`INSERT INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at)
    SELECT ?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
    .bind(retained.revisionId,ownerId,projection.projectId,documentId,artifactId,retained.revision,retained.contentJson,retained.contentSha256,retained.createdByUserId,retained.createdAt,retained.expiresAt,event.eventId));
  statements.push(env.DB.prepare("UPDATE private_content SET content=? WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>? AND content=? AND EXISTS(SELECT 1 FROM events WHERE event_id=?)")
    .bind(serialized,contentId,ownerId,now,source.content,event.eventId));
  let results;
  try { results=await (videoOperation||model3dOperation?boundedVideoOperation(env.DB.batch(statements)):env.DB.batch(statements)); }
  catch (error) {
    // A lost transaction response is not proof that its media is unreferenced.
    if (trimAdmission) return Response.json({error:uncertainError},{status:503});
    throw error;
  }
  // D1 includes trigger writes in changes; every guarded personal statement must still write.
  const incompleteWrite = !Array.isArray(results) || results.length !== statements.length || statements.some((_, index) => {
    const changes = results[index]?.meta?.changes;
    return results[index]?.success !== true || typeof changes !== "number" || !Number.isSafeInteger(changes) || changes <= 0;
  });
  if (incompleteWrite) {
    if (trimAdmission) {
      try {
        const observation = env.DB.prepare("SELECT event_id FROM events WHERE event_id=?").bind(event.eventId).first();
        const committed = await (videoOperation||model3dOperation?boundedVideoOperation(observation):observation);
        if (committed) return Response.json({error:uncertainError},{status:503});
        // This request alone owns this fresh key, and its exact event was not committed.
        if (stagedAudio) await env.MEDIA.delete(stagedAudio.key);
        if (stagedVideo) await boundedVideoOperation(env.MEDIA.delete(stagedVideo.key));
        if (stagedModel3d) await boundedVideoOperation(env.MEDIA.delete(stagedModel3d.key));
      } catch { return Response.json({error:uncertainError},{status:503}); }
    }
    return Response.json({ error: "artifact_revision_conflict", revision }, { status: 409 });
  }
  return Response.json({ appended: [event], head: event.sequence, content: { [contentId]: serialized }, revision: revision + 1 });
}
