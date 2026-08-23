import { foldEvents } from "../src/model/events";
import { parseDocumentArtifactContent } from "../src/model/document-artifacts";
import { documentShareScope, sanitizeSharedValue, shareAllowsMedia, type DocumentShareScope } from "../src/model/share-scope";
import { requireConsent, requireUser } from "./pilot-policy";
import { applySafeMediaResponseHeaders } from "./media-api";
import { appendAuditEvent, ensureSchema, readWorkspaceEvents, uuidV7, type WorkerEnv } from "./runtime";
import { readProjectRequestContext, readProjectSourceEvents, recordOrganizationAudit } from "./project-access";

const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const hashToken = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const serializeShare = (row: Record<string, unknown>) => ({ shareId: String(row.share_id), resourceKind: String(row.resource_kind ?? ""), resourceId: String(row.resource_id ?? ""), projectId: String(row.project_id ?? ""), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at), active: !row.revoked_at && String(row.expires_at) > new Date().toISOString() });
const activeShare=async(env:WorkerEnv,rawToken:string)=>env.DB.prepare(`SELECT shares.*,scope.resource_kind,scope.resource_id,scope.project_id,scope.media_keys_json
  FROM shares JOIN share_scopes scope ON scope.share_id=shares.share_id AND scope.owner_id=shares.owner_id
  WHERE shares.token_hash=? AND shares.revoked_at IS NULL AND shares.expires_at>?
    AND((NOT EXISTS(SELECT 1 FROM project_resource_scopes tagged WHERE tagged.resource_kind='share' AND tagged.resource_id=shares.share_id)
        AND NOT EXISTS(SELECT 1 FROM organization_projects registered WHERE registered.owner_user_id=shares.owner_id AND registered.project_id=scope.project_id))
      OR EXISTS(SELECT 1 FROM project_resource_scopes tagged
        JOIN organization_projects project ON project.project_access_id=tagged.project_access_id AND project.organization_id=tagged.organization_id
          AND project.project_id=tagged.project_id AND project.owner_user_id=tagged.owner_user_id AND project.status='active'
        JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
        JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=project.owner_user_id
          AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
        JOIN project_resource_scopes document ON document.project_access_id=tagged.project_access_id AND document.organization_id=tagged.organization_id
          AND document.project_id=tagged.project_id AND document.owner_user_id=tagged.owner_user_id AND document.resource_kind='document' AND document.resource_id=scope.resource_id
        WHERE tagged.resource_kind='share' AND tagged.resource_id=shares.share_id AND tagged.owner_user_id=shares.owner_id AND tagged.project_id=scope.project_id))`)
  .bind(await hashToken(rawToken),new Date().toISOString()).first<Record<string,unknown>>();
const rowScope=(row:Record<string,unknown>):DocumentShareScope|null=>{try{const keys=JSON.parse(String(row.media_keys_json??"[]")) as unknown;if(row.resource_kind!=="document"||!Array.isArray(keys)||keys.some((key)=>typeof key!=="string"))return null;return{resourceKind:"document",resourceId:String(row.resource_id??""),projectId:String(row.project_id??""),ownerId:String(row.owner_id??""),mediaKeys:keys as string[]};}catch{return null;}};

export async function handleShares(request: Request, env: WorkerEnv, shareId = "") {
  const scoped=/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"");
  const auth=await requireUser(request,env,scoped?"viewer":request.method==="GET"?"viewer":"creator",scoped?{account:"principal"}:{});
  if(auth.response||!auth.user)return auth.response!;
  const user=auth.user,selected=scoped?await readProjectRequestContext(request,env,user):{context:null,response:null};
  if(selected.response)return selected.response;
  const project=selected.context;
  if(project&&(project.ownerUserId!==user.userId||project.role!=="owner"))return Response.json({error:"project_share_owner_required"},{status:403,headers:{"cache-control":"private, no-store"}});
  const ownerStream=project?`creative:${project.ownerUserId}`:user.streamId;
  if (request.method === "GET") {
    const rows=await env.DB.prepare(`SELECT shares.*,scope.resource_kind,scope.resource_id,scope.project_id FROM shares JOIN share_scopes scope ON scope.share_id=shares.share_id AND scope.owner_id=shares.owner_id
      WHERE shares.owner_id=?${project?" AND scope.project_id=? AND EXISTS(SELECT 1 FROM project_resource_scopes document WHERE document.project_access_id=? AND document.organization_id=? AND document.owner_user_id=? AND document.resource_kind='document' AND document.resource_id=scope.resource_id)":""} ORDER BY shares.created_at DESC LIMIT 50`)
      .bind(user.userId,...(project?[project.projectId,project.projectAccessId,project.organizationId,project.ownerUserId]:[])).all<Record<string,unknown>>();
    return Response.json({shares:rows.results.map(serializeShare)},{headers:{"cache-control":"private, no-store"}});
  }
  const consent = requireConsent(user); if (consent) return consent;
  if (request.method === "POST") {
    const body = await request.json() as { expiresHours?: number; resourceKind?: string; documentId?: string; projectId?: string }; const expiresHours = Math.max(1, Math.min(168, Math.floor(Number(body.expiresHours ?? 24))));
    if(body.resourceKind!=="document"||!body.documentId?.trim()||!body.projectId?.trim())return Response.json({error:"share_resource_scope_required"},{status:400});
    if(project&&body.projectId!==project.projectId)return Response.json({error:"share_document_not_found"},{status:404});
    if(!project&&await env.DB.prepare("SELECT 1 AS present FROM organization_projects WHERE owner_user_id=? AND project_id=? LIMIT 1").bind(user.userId,body.projectId).first())return Response.json({error:"project_share_context_required"},{status:403,headers:{"cache-control":"private, no-store"}});
    const source=project?await readProjectSourceEvents(env,project):await readWorkspaceEvents(env,ownerStream);
    const projection=foldEvents(source,Number.POSITIVE_INFINITY,body.documentId,body.projectId);const scope=documentShareScope(projection,user.userId,body.documentId,body.projectId);if(!scope)return Response.json({error:"share_document_not_found"},{status:404});
    const verifiedMedia=await Promise.all(scope.mediaKeys.map(async(key)=>({key,object:await env.MEDIA.get(key)})));
    scope.mediaKeys=verifiedMedia.filter(({object})=>object?.customMetadata?.ownerId===user.userId).map(({key})=>key);
    const shareToken = token(); const id = uuidV7(); const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + expiresHours * 3_600_000);
    const hashed=await hashToken(shareToken),timestamp=createdAt.toISOString();
    const statements=project?[
      env.DB.prepare(`INSERT INTO shares(share_id,token_hash,owner_id,stream_id,expires_at,revoked_at,created_at)
        SELECT ?,?,?,?,?,NULL,? WHERE EXISTS(SELECT 1 FROM organization_projects project
          JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
          JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=project.owner_user_id AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
          JOIN project_resource_scopes document ON document.project_access_id=project.project_access_id AND document.organization_id=project.organization_id AND document.owner_user_id=project.owner_user_id AND document.resource_kind='document' AND document.resource_id=?
          WHERE project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND project.status='active')`)
        .bind(id,hashed,user.userId,ownerStream,expiresAt.toISOString(),timestamp,scope.resourceId,project.projectAccessId,project.organizationId,project.projectId,user.userId),
      env.DB.prepare("INSERT INTO share_scopes(share_id,owner_id,resource_kind,resource_id,project_id,media_keys_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shares WHERE share_id=? AND owner_id=?)")
        .bind(id,user.userId,scope.resourceKind,scope.resourceId,scope.projectId,JSON.stringify(scope.mediaKeys),timestamp,id,user.userId),
      env.DB.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) SELECT ?,'share',?,?,?,?,'collaborative_output',NULL,?,? WHERE EXISTS(SELECT 1 FROM shares WHERE share_id=? AND owner_id=?)")
        .bind(project.projectAccessId,id,project.organizationId,project.projectId,user.userId,user.userId,timestamp,id,user.userId),
    ]:[env.DB.prepare("INSERT INTO shares(share_id,token_hash,owner_id,stream_id,expires_at,revoked_at,created_at) SELECT ?,?,?,?,?,NULL,? WHERE NOT EXISTS(SELECT 1 FROM organization_projects WHERE owner_user_id=? AND project_id=?)").bind(id,hashed,user.userId,ownerStream,expiresAt.toISOString(),timestamp,user.userId,scope.projectId),env.DB.prepare("INSERT INTO share_scopes(share_id,owner_id,resource_kind,resource_id,project_id,media_keys_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shares WHERE share_id=? AND owner_id=?)").bind(id,user.userId,scope.resourceKind,scope.resourceId,scope.projectId,JSON.stringify(scope.mediaKeys),timestamp,id,user.userId)];
    const inserted=await env.DB.batch(statements);if(inserted.some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"project_share_access_revoked"},{status:403});
    await appendAuditEvent(env,ownerStream,project?`user:${user.userId}`:"user","ShareLinkCreated",{share_id:id,resource_kind:scope.resourceKind,document_id:scope.resourceId,project_id:scope.projectId,media_count:scope.mediaKeys.length,expires_at:expiresAt.toISOString(),access:"read-only"});
    if(project)await recordOrganizationAudit(env,project.organizationId,user,"project.share.created","share",id,{projectId:project.projectId,documentId:scope.resourceId});
    return Response.json({ share: { shareId: id, token: shareToken, resourceKind: scope.resourceKind, resourceId: scope.resourceId, projectId: scope.projectId, expiresAt: expiresAt.toISOString(), active: true } });
  }
  if (request.method === "DELETE" && shareId) {
    const now=new Date().toISOString();const result=await env.DB.prepare(`UPDATE shares SET revoked_at=? WHERE share_id=? AND owner_id=? AND revoked_at IS NULL${project?" AND EXISTS(SELECT 1 FROM share_scopes scope WHERE scope.share_id=shares.share_id AND scope.owner_id=shares.owner_id AND scope.project_id=?)":""}`)
      .bind(now,shareId,user.userId,...(project?[project.projectId]:[])).run();
    if (Number(result.meta.changes ?? 0) !== 1) return Response.json({ error: "share_not_found_or_revoked" }, { status: 404 });
    await appendAuditEvent(env,ownerStream,project?`user:${user.userId}`:"user","ShareLinkRevoked",{share_id:shareId,revoked_at:now});
    if(project)await recordOrganizationAudit(env,project.organizationId,user,"project.share.revoked","share",shareId,{projectId:project.projectId});
    return Response.json({ok:true});
  }
  return new Response("Method not allowed", { status: 405 });
}

export async function handleSharedView(request: Request, env: WorkerEnv, rawToken: string) {
  await ensureSchema(env); if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const row = await activeShare(env,rawToken);
  if (!row) return Response.json({ error: "share_expired_or_revoked" }, { status: 404 });
  const scope=rowScope(row);if(!scope)return Response.json({error:"share_expired_or_revoked"},{status:404});
  const events = await readWorkspaceEvents(env, String(row.stream_id)); const projection = foldEvents(events,Number.POSITIVE_INFINITY,scope.resourceId,scope.projectId);if(!documentShareScope(projection,scope.ownerId,scope.resourceId,scope.projectId))return Response.json({error:"shared_document_unavailable"},{status:404});
  const contentIds=[...new Set(projection.artifacts.map((artifact)=>artifact.contentRef).filter((value):value is string=>Boolean(value)))];const contentStatements=[];const now=new Date().toISOString();for(let index=0;index<contentIds.length;index+=98){const ids=contentIds.slice(index,index+98);contentStatements.push(env.DB.prepare(`SELECT content_id,content FROM private_content WHERE owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>? AND content_id IN (${ids.map(()=>"?").join(",")})`).bind(scope.ownerId,now,...ids));}const retainedContent=new Map(contentStatements.length?(await env.DB.batch<{content_id:string;content:string}>(contentStatements)).flatMap((result)=>result.results).map((result)=>[result.content_id,parseDocumentArtifactContent(result.content)]):[]);
  const blocks=projection.blocks.map(({id,type,handle,properties})=>({id,type,handle,properties:sanitizeSharedValue(properties,scope,rawToken)}));
  const outputs=projection.outputs.map(({ id, sequence, mediaUrl, mediaType, width, height, focalPoint, purpose, promptFanId, promptTechnique })=>({id,sequence,mediaUrl:sanitizeSharedValue(mediaUrl,scope,rawToken,true),mediaType,width,height,focalPoint,purpose,promptFanId,promptTechnique}));
  const artifacts=projection.artifacts.map(({id,kind,title,summary,itemCount,items,mediaUrl,mediaType,sequence,presentation,contentRef})=>{
    const content=contentRef?retainedContent.get(contentRef):null;
    const authored=items.map((item,index)=>{const draft=content?.items[index];return{title:draft?.title??item.title,body:draft?.body??item.body,notes:draft?.notes??item.notes,mediaUrl:sanitizeSharedValue(item.mediaUrl,scope,rawToken,true),mediaType:item.mediaType,durationSeconds:item.durationSeconds??null,width:item.width,height:item.height,focalPoint:item.focalPoint,slide:sanitizeSharedValue(draft?.slide??item.slide,scope,rawToken)};});
    return{id,kind,title,summary,itemCount,items:authored,mediaUrl:sanitizeSharedValue(mediaUrl,scope,rawToken,true),mediaType,sequence,presentation:sanitizeSharedValue(content?.presentation??presentation,scope,rawToken),contentMarkdown:content?.content_markdown??null,contentAvailable:Boolean(content)};
  });
  return Response.json({share:{expiresAt:String(row.expires_at)},projection:{projectName:projection.projectName,documentTitle:projection.documentTitle,blocks,outputs,artifacts}},{headers:{"cache-control":"private, no-store"}});
}

export async function handleSharedMedia(request:Request,env:WorkerEnv,rawToken:string,key:string){
  await ensureSchema(env);if(request.method!=="GET")return new Response("Method not allowed",{status:405});const row=await activeShare(env,rawToken);if(!row)return new Response("Not found",{status:404});
  const scope=rowScope(row);if(!scope||!shareAllowsMedia(scope,key))return new Response("Forbidden",{status:403});const object=await env.MEDIA.get(key);if(!object)return new Response("Not found",{status:404});if(object.customMetadata?.ownerId!==scope.ownerId)return new Response("Forbidden",{status:403});const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);applySafeMediaResponseHeaders(headers);return new Response(object.body,{headers});
}
