import { documentArtifactValidationIssues, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { foldEvents } from "../src/model/events.ts";
import { hasCapability, requireConsent, requireUser } from "./pilot-policy.ts";
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

/** Read recoverable, exactly scoped revisions or atomically correct/restore the real retained output. */
export async function handleArtifactEdit(request: Request, env: WorkerEnv, artifactId: string,path:string[]=[]): Promise<Response> {
  const historyRequest=path.length>=1&&path[0]==="revisions";
  const listRequest=historyRequest&&path.length===1&&request.method==="GET";
  const detailRequest=historyRequest&&path.length===2&&request.method==="GET";
  const restoreRequest=historyRequest&&path.length===3&&path[2]==="restore"&&request.method==="POST";
  const editRequest=path.length===0&&request.method==="PATCH";
  if(!artifactId||!listRequest&&!detailRequest&&!restoreRequest&&!editRequest)return new Response("Method not allowed",{status:405});
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
  if((editRequest||restoreRequest)&&!project&&actor.role!=="creator"&&actor.role!=="admin")return Response.json({error:"creator_required"},{status:403});
  const ownerId=project?.ownerUserId??actor.userId;
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
  if (!original) return Response.json({ error: "artifact_content_invalid" }, { status: 409 });
  const edits=history.filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId);
  const revision=edits.length;
  const latestEdit=edits.at(-1);
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
    if(!retained)return Response.json({error:"artifact_revision_unavailable"},{status:404});
    if(detailRequest)return Response.json({artifactId,documentId,revision:selectedRevision,currentRevision:revision,sha256:historical.content_sha256,createdByUserId:historical.created_by_user_id,createdAt:historical.created_at,content:{markdown:retained.content_markdown,items:retained.items.map((item)=>({title:item.title,body:item.body,notes:item.notes}))}});
  }

  let input:{markdown?:unknown;items?:unknown;expectedRevision?:unknown};
  try{input=await request.json() as typeof input;}catch{return Response.json({error:"invalid_artifact_edit"},{status:400});}
  if(!input||typeof input!=="object"||Array.isArray(input))return Response.json({error:"invalid_artifact_edit"},{status:400});
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
  const validation = documentArtifactValidationIssues(artifact.kind, edited, { itemCount: original.items.length, contextGroupIds: [...new Set(original.items.flatMap((item) => item.context_group_ids ?? []))] });
  if (validation.length) return Response.json({ error: "invalid_artifact_revision", message: validation[0]?.message ?? "The revised output is not valid.", issues: validation }, { status: 400 });
  const serialized=restoreRequest&&historical?historical.content_json:JSON.stringify(edited);
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
    changed_fields: ["content_markdown", ...(input.items !== undefined || edited.items.length === 1 ? ["items"] : [])],
    content_sha256: digest,
    edited_by_user_id: actor.userId,
    source_surface:restoreRequest?"document-artifact-history":"document-artifact-editor",
    ...(restoreRequest?{restored_from_revision:selectedRevision,revision_action:"restore"}:{}),
  };
  const currentStored=await env.DB.prepare("SELECT revision FROM artifact_revisions WHERE owner_id=? AND artifact_id=? AND revision=?")
    .bind(ownerId,artifactId,revision).first<{revision:number}>();
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

  const head = await streamHead(env, actor.streamId);
  const event = makeEvent(actor.streamId, head + 1, "user", "web:artifact-editor", uuidV7(), "DocumentArtifactEdited", payload);
  const restoreGuard=restoreSource?" AND EXISTS(SELECT 1 FROM artifact_revisions retained WHERE retained.owner_id=? AND retained.organization_id IS NULL AND retained.project_access_id IS NULL AND retained.artifact_id=? AND retained.revision=? AND retained.redacted_at IS NULL AND retained.expires_at>? AND retained.content_sha256=? AND retained.content_json=?)":"";
  const statements=[
    env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS})
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
        AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>? AND content=?)
        AND (SELECT COUNT(*) FROM events revision WHERE revision.stream_id=? AND revision.type='DocumentArtifactEdited' AND json_extract(revision.payload,'$.artifact_id')=?)=?${restoreGuard}`)
      .bind(...eventWriteBindings(event),event.streamId,head,contentId,ownerId,now,source.content,event.streamId,artifactId,revision,...(restoreSource?[ownerId,artifactId,restoreSource.revision,now,restoreSource.contentSha256,restoreSource.contentJson]:[])),
  ];
  for(const retained of revisions)statements.push(env.DB.prepare(`INSERT INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at)
    SELECT ?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
    .bind(retained.revisionId,ownerId,projection.projectId,documentId,artifactId,retained.revision,retained.contentJson,retained.contentSha256,retained.createdByUserId,retained.createdAt,retained.expiresAt,event.eventId));
  statements.push(env.DB.prepare("UPDATE private_content SET content=? WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>? AND content=? AND EXISTS(SELECT 1 FROM events WHERE event_id=?)")
    .bind(serialized,contentId,ownerId,now,source.content,event.eventId));
  const results=await env.DB.batch(statements);
  if (results.some((result) => Number(result.meta.changes ?? 0) !== 1)) return Response.json({ error: "artifact_revision_conflict", revision }, { status: 409 });
  return Response.json({ appended: [event], head: event.sequence, content: { [contentId]: serialized }, revision: revision + 1 });
}
