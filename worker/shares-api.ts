import { foldEvents } from "../src/model/events";
import { documentShareScope, sanitizeSharedValue, shareAllowsMedia, type DocumentShareScope } from "../src/model/share-scope";
import { requireConsent, requireUser } from "./pilot-policy";
import { appendAuditEvent, ensureSchema, readWorkspaceEvents, uuidV7, type WorkerEnv } from "./runtime";

const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const hashToken = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const serializeShare = (row: Record<string, unknown>) => ({ shareId: String(row.share_id), resourceKind: String(row.resource_kind ?? ""), resourceId: String(row.resource_id ?? ""), projectId: String(row.project_id ?? ""), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at), active: !row.revoked_at && String(row.expires_at) > new Date().toISOString() });
const activeShare = async (env:WorkerEnv,rawToken:string) => env.DB.prepare("SELECT shares.*,scope.resource_kind,scope.resource_id,scope.project_id,scope.media_keys_json FROM shares JOIN share_scopes scope ON scope.share_id=shares.share_id AND scope.owner_id=shares.owner_id WHERE shares.token_hash=? AND shares.revoked_at IS NULL AND shares.expires_at>?").bind(await hashToken(rawToken),new Date().toISOString()).first<Record<string,unknown>>();
const rowScope=(row:Record<string,unknown>):DocumentShareScope|null=>{try{const keys=JSON.parse(String(row.media_keys_json??"[]")) as unknown;if(row.resource_kind!=="document"||!Array.isArray(keys)||keys.some((key)=>typeof key!=="string"))return null;return{resourceKind:"document",resourceId:String(row.resource_id??""),projectId:String(row.project_id??""),ownerId:String(row.owner_id??""),mediaKeys:keys as string[]};}catch{return null;}};

export async function handleShares(request: Request, env: WorkerEnv, shareId = "") {
  const auth = await requireUser(request, env, request.method === "GET" ? "viewer" : "creator"); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT shares.*,scope.resource_kind,scope.resource_id,scope.project_id FROM shares JOIN share_scopes scope ON scope.share_id=shares.share_id AND scope.owner_id=shares.owner_id WHERE shares.owner_id=? ORDER BY shares.created_at DESC LIMIT 50").bind(user.userId).all<Record<string, unknown>>(); return Response.json({ shares: rows.results.map(serializeShare) });
  }
  const consent = requireConsent(user); if (consent) return consent;
  if (request.method === "POST") {
    const body = await request.json() as { expiresHours?: number; resourceKind?: string; documentId?: string; projectId?: string }; const expiresHours = Math.max(1, Math.min(168, Math.floor(Number(body.expiresHours ?? 24))));
    if(body.resourceKind!=="document"||!body.documentId?.trim()||!body.projectId?.trim())return Response.json({error:"share_resource_scope_required"},{status:400});
    const projection=foldEvents(await readWorkspaceEvents(env,user.streamId),Number.POSITIVE_INFINITY,body.documentId,body.projectId);const scope=documentShareScope(projection,user.userId,body.documentId,body.projectId);if(!scope)return Response.json({error:"share_document_not_found"},{status:404});
    const shareToken = token(); const id = uuidV7(); const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + expiresHours * 3_600_000);
    await env.DB.batch([env.DB.prepare("INSERT INTO shares (share_id,token_hash,owner_id,stream_id,expires_at,revoked_at,created_at) VALUES (?,?,?,?,?,NULL,?)").bind(id, await hashToken(shareToken), user.userId, user.streamId, expiresAt.toISOString(), createdAt.toISOString()),env.DB.prepare("INSERT INTO share_scopes (share_id,owner_id,resource_kind,resource_id,project_id,media_keys_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(id,user.userId,scope.resourceKind,scope.resourceId,scope.projectId,JSON.stringify(scope.mediaKeys),createdAt.toISOString())]);
    await appendAuditEvent(env, user.streamId, "user", "ShareLinkCreated", { share_id: id, resource_kind: scope.resourceKind, document_id: scope.resourceId, project_id: scope.projectId, media_count: scope.mediaKeys.length, expires_at: expiresAt.toISOString(), access: "read-only" });
    return Response.json({ share: { shareId: id, token: shareToken, resourceKind: scope.resourceKind, resourceId: scope.resourceId, projectId: scope.projectId, expiresAt: expiresAt.toISOString(), active: true } });
  }
  if (request.method === "DELETE" && shareId) {
    const now = new Date().toISOString(); const result = await env.DB.prepare("UPDATE shares SET revoked_at=? WHERE share_id=? AND owner_id=? AND revoked_at IS NULL").bind(now, shareId, user.userId).run();
    if (Number(result.meta.changes ?? 0) !== 1) return Response.json({ error: "share_not_found_or_revoked" }, { status: 404 });
    await appendAuditEvent(env, user.streamId, "user", "ShareLinkRevoked", { share_id: shareId, revoked_at: now }); return Response.json({ ok: true });
  }
  return new Response("Method not allowed", { status: 405 });
}

export async function handleSharedView(request: Request, env: WorkerEnv, rawToken: string) {
  await ensureSchema(env); if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const row = await activeShare(env,rawToken);
  if (!row) return Response.json({ error: "share_expired_or_revoked" }, { status: 404 });
  const scope=rowScope(row);if(!scope)return Response.json({error:"share_expired_or_revoked"},{status:404});
  const events = await readWorkspaceEvents(env, String(row.stream_id)); const projection = foldEvents(events,Number.POSITIVE_INFINITY,scope.resourceId,scope.projectId);if(!documentShareScope(projection,scope.ownerId,scope.resourceId,scope.projectId))return Response.json({error:"shared_document_unavailable"},{status:404});
  const blocks=projection.blocks.map(({id,type,handle,properties})=>({id,type,handle,properties:sanitizeSharedValue(properties,scope,rawToken)}));
  const outputs=projection.outputs.map(({ id, documentId, modelId, provider, variant, sequence, mediaUrl, mediaType, width, height, focalPoint, latency, purpose, promptFanId, promptTechnique })=>({id,documentId,modelId,provider,variant,sequence,mediaUrl:sanitizeSharedValue(mediaUrl,scope,rawToken),mediaType,width,height,focalPoint,latency,purpose,promptFanId,promptTechnique}));
  const artifacts=projection.artifacts.map(({id,documentId,kind,title,summary,itemCount,items,mediaUrl,mediaType,provider,modelId,sequence,presentation})=>({id,documentId,kind,title,summary,itemCount,items:sanitizeSharedValue(items,scope,rawToken),mediaUrl:sanitizeSharedValue(mediaUrl,scope,rawToken),mediaType,provider,modelId,sequence,presentation}));
  return Response.json({ share: serializeShare(row), projection: { projectName: projection.projectName, documentTitle: projection.documentTitle, blocks, outputs, artifacts } },{headers:{"cache-control":"private, no-store"}});
}

export async function handleSharedMedia(request:Request,env:WorkerEnv,rawToken:string,key:string){
  await ensureSchema(env);if(request.method!=="GET")return new Response("Method not allowed",{status:405});const row=await activeShare(env,rawToken);if(!row)return new Response("Not found",{status:404});
  const scope=rowScope(row);if(!scope||!shareAllowsMedia(scope,key))return new Response("Forbidden",{status:403});const object=await env.MEDIA.get(key);if(!object)return new Response("Not found",{status:404});const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);headers.set("cache-control","private, no-store");return new Response(object.body,{headers});
}
