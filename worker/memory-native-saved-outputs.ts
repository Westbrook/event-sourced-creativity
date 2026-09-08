import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { nativeMemoryDescriptor as descriptor, nativeMemoryTimestamp as timestamp,
  type NativeMemoryQuery, type NativeMemorySqlValue } from "./memory-native-deadlines.ts";
import { MEMORY_SAVED_OUTPUTS_VERSION, MEMORY_SAVED_OUTPUTS_MAX_BYTES, parseMemorySavedOutputs } from "../src/model/memory-saved-outputs.ts";

/** Inspector-only native image-job lineage. The caller owns live authority,
 * observes/replays these descriptors, and enforces the absolute returned lease.
 * Nothing here reads output bytes, certifies their hash, or persists answer input. */
export type NativeMemorySavedOutputSource = { eventId: string; sequence: number; type: string; blockId: string | null; recordedAt: string; validUntil: string };
type Enrollment = Pick<LiveMemoryEnrollment, "enrollment_id" | "actor_user_id" | "owner_user_id" | "organization_id" | "project_access_id"
  | "project_id" | "document_id" | "permission_epoch" | "policy_version" | "revision" | "enrolled_at" | "expires_at" | "retention_days" | "cursor_sequence">;
type SourceQuery = { joins: string; condition: string; bindings: NativeMemorySqlValue[] };
type Row = Record<string, unknown>;
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 240 && v.trim() === v && v.isWellFormed();
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const b = (field: string) => `json_extract(binding.value,'$.${field}')`;
const raw = (alias: string) => `(CASE WHEN length(CAST(${alias}.private_json AS BLOB))<=131072 AND json_valid(${alias}.private_json) THEN ${alias}.private_json ELSE '{}' END)`;
const action = (type: string) => ["ObjectSaved", "ObjectPinned", "ObjectExported"].includes(type);
function selection(e: Enrollment, sources: readonly NativeMemorySavedOutputSource[]) {
  if (!e || ![e.enrollment_id,e.actor_user_id,e.owner_user_id,e.project_id,e.document_id,e.permission_epoch].every(id)
    || e.policy_version !== "personal-memory-v2" || !integer(e.revision) || !integer(e.retention_days) || e.retention_days > 365
    || !Number.isSafeInteger(e.cursor_sequence) || e.cursor_sequence < 0 || timestamp(e.enrolled_at) === null || timestamp(e.expires_at) === null
    || !(e.organization_id === null && e.project_access_id === null && e.actor_user_id === e.owner_user_id || id(e.organization_id) && id(e.project_access_id))
    || !Array.isArray(sources) || sources.length > 64 || Array.from({length:sources.length},(_,i)=>i).some(i=>!Object.hasOwn(sources,i))) throw new Error("native_saved_output_selection_invalid");
  const ids=new Set<string>(), positions=new Set<number>();
  return sources.map(source=>{
    if (!source || !id(source.eventId) || !id(source.type) || !integer(source.sequence) || source.sequence>e.cursor_sequence
      || source.blockId!==null&&!id(source.blockId) || timestamp(source.recordedAt)===null || timestamp(source.validUntil)===null
      || ids.has(source.eventId) || positions.has(source.sequence)) throw new Error("native_saved_output_selection_invalid");
    ids.add(source.eventId);positions.add(source.sequence);
    return {eventId:source.eventId,sequence:source.sequence,type:source.type,blockId:source.blockId,recordedAt:source.recordedAt,validUntil:source.validUntil};
  });
}

export function nativeMemorySavedOutputsSchemaQuery(): NativeMemoryQuery {
  return descriptor("SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN("+
    "'events','event_private_payloads','memory_live_sources','memory_live_enrollments','document_jobs','output_operation_slots',"+
    "'output_execution_grants','output_plan_revisions','output_plan_targets','output_native_storage_writes','project_event_scopes',"+
    "'project_resource_scopes','private_content','private_content_retention_scopes'))=14 THEN 1 ELSE 0 END AS ready",[]);
}
function custody(event:string) {
  return `(${b("organization_id")} IS NULL AND NOT EXISTS(SELECT 1 FROM project_event_scopes c WHERE c.event_id=${event}.event_id)
    OR ${b("organization_id")} IS NOT NULL AND (SELECT COUNT(*) FROM project_event_scopes c WHERE c.event_id=${event}.event_id)=1
    AND EXISTS(SELECT 1 FROM project_event_scopes c WHERE c.event_id=${event}.event_id AND
      (c.source_stream_id,c.source_sequence,c.organization_id,c.project_access_id,c.project_id,c.owner_user_id,c.actor_user_id)
      IS (${event}.stream_id,${event}.sequence,${b("organization_id")},${b("project_access_id")},${b("project_id")},${b("owner_user_id")},${b("actor_user_id")})))`;
}
function resource(kind:string,key:string,eventId:string|null,visibility="collaborative_output") {
  return `(${b("organization_id")} IS NULL AND NOT EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='${kind}' AND r.resource_id=${key})
    OR ${b("organization_id")} IS NOT NULL AND (SELECT COUNT(*) FROM project_resource_scopes r WHERE r.resource_kind='${kind}' AND r.resource_id=${key})=1
      AND EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='${kind}' AND r.resource_id=${key}
        AND (r.organization_id,r.project_access_id,r.project_id,r.owner_user_id,r.actor_user_id,r.visibility)
          IS (${b("organization_id")},${b("project_access_id")},${b("project_id")},${b("owner_user_id")},${b("actor_user_id")},'${visibility}')
        ${eventId===null?"":"AND r.source_event_id="+eventId}))`;
}
function envelope(event:string,secret:string) {
  const payload=raw(secret);
  // No raw prose is selected. Duplicate object keys are rejected rather than
  // depending on SQLite's first-key interpretation of mutable retained JSON.
  return `(${event}.stream_id='creative:'||${b("owner_user_id")} AND ${event}.compensates_event_id IS NULL
    AND json_extract(${event}.payload,'$._private_ref')=${event}.event_id
    AND (${secret}.owner_id,${secret}.project_id,${secret}.document_id,${secret}.redacted_at)
      IS (${b("owner_user_id")},json_extract(${event}.payload,'$.project_id'),${b("document_id")},NULL)
    AND json_type(${payload})='object' AND length(CAST(${secret}.private_json AS BLOB))<=131072
    AND NOT EXISTS(SELECT 1 FROM json_tree(${payload}) node WHERE node.key IS NOT NULL GROUP BY node.fullkey HAVING COUNT(*)>1)
    AND json_extract(${event}.payload,'$.document_id')=${b("document_id")}
    AND (json_extract(${event}.payload,'$.project_id') IS NULL OR json_extract(${event}.payload,'$.project_id')=${b("project_id")})
    AND NOT EXISTS(SELECT 1 FROM json_each(${event}.payload) public WHERE public.key IN
      ('actor_user_id','project_id','document_id','generation_id','object_id','object_ids','quality','purpose','simulation','prompt_ref','content_expires_at','job_id','kind','grant_id','plan_revision_id')
      AND (public.type IS NOT json_type(${payload},'$.'||public.key) OR public.value IS NOT json_extract(${payload},'$.'||public.key)))
    AND (json_type(${payload},'$.actor_user_id') IS NULL OR json_type(${payload},'$.actor_user_id')='text' AND json_extract(${payload},'$.actor_user_id')=${b("actor_user_id")})
    AND COALESCE(json_extract(${event}.payload,'$.synthetic'),0)=0 AND COALESCE(json_extract(${event}.payload,'$.simulation'),0)=0
    AND COALESCE(json_extract(${payload},'$.synthetic'),0)=0 AND COALESCE(json_extract(${payload},'$.simulation'),0)=0
    AND COALESCE(json_extract(${payload},'$.origin.synthetic'),0)=0 AND COALESCE(json_extract(${event}.payload,'$.origin.synthetic'),0)=0
    AND ${["canvas_id","context_set_id","report_space","replay_session_id","mock_data_source","fictional_user_id"].map(key=>
      `json_extract(${payload},'$.${key}') IS NULL AND json_extract(${event}.payload,'$.${key}') IS NULL`).join(" AND ")}
    AND ${custody(event)})`;
}
function retained(content:string,retention:string) {
  return `(${content}.owner_id=${b("actor_user_id")} AND ${content}.redacted_at IS NULL AND ${content}.expires_at>${clock}
    AND ${resource("content",content+".content_id",null,"actor_private")}
    AND (${b("organization_id")} IS NULL AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes r WHERE r.content_id=${content}.content_id)
      OR ${b("organization_id")} IS NOT NULL AND (SELECT COUNT(*) FROM private_content_retention_scopes r WHERE r.content_id=${content}.content_id)=1
        AND (${retention}.organization_id,${retention}.project_access_id,${retention}.project_id,${retention}.actor_user_id)
          IS (${b("organization_id")},${b("project_access_id")},${b("project_id")},${b("actor_user_id")})
        AND ${retention}.assigned_expires_at>${clock}))`;
}

/** Native q is supplied by the caller, including its original first-six JOIN
 * bindings. Nothing expands the remembered parent selection. All other rows
 * are metadata-only dependency witnesses, not newly disclosed memory sources. */
export function nativeMemorySavedOutputsQuery(e:Enrollment,q:SourceQuery,sources:readonly NativeMemorySavedOutputSource[]):NativeMemoryQuery {
  const selected=selection(e,sources), completeRaw=raw("completed_secret"), compileRaw=raw("compiled_secret"), queuedRaw=raw("queued_secret"), authRaw=raw("authorized_secret");
  const eventAliases=["queued","authorized","requested","compiled","completed"];
  const objectId="json_extract(completed.payload,'$.object_id')";
  const sql=`WITH eligible AS (
    SELECT event.*,remembered.expires_at AS remembered_expires_at ${q.joins}
    JOIN memory_live_sources remembered ON remembered.enrollment_id=? AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence
    JOIN json_each(?) selected ON event.event_id=json_extract(selected.value,'$.eventId') AND event.sequence=json_extract(selected.value,'$.sequence')
      AND event.type=json_extract(selected.value,'$.type') AND event.recorded_at=json_extract(selected.value,'$.recordedAt')
      AND json_extract(event.payload,'$.block_id') IS json_extract(selected.value,'$.blockId')
    WHERE ${q.condition} AND event.sequence<=? AND remembered.expires_at>${clock}
  ) SELECT event.event_id AS source_id,event.sequence AS source_sequence,event.type AS source_type,event.recorded_at AS source_recorded_at,
    event.remembered_expires_at,completed.event_id AS completion_id,${objectId} AS object_id,
    queued.recorded_at AS queued_at,authorized.recorded_at AS authorized_at,requested.recorded_at AS requested_at,
    compiled.recorded_at AS compiled_at,completed.recorded_at AS generated_at,
    job.expires_at AS job_expires_at,json_extract(completed.payload,'$.content_expires_at') AS content_expires_at,
    output.expires_at AS output_expires_at,output_retention.assigned_expires_at AS output_assigned_expires_at,
    prompt.expires_at AS prompt_expires_at,prompt_retention.assigned_expires_at AS prompt_assigned_expires_at,
    stored.storage_key AS storage_key,json_extract(${completeRaw},'$.media_url') AS media_url
  FROM eligible event JOIN (SELECT ? AS value) binding
  JOIN event_private_payloads event_secret ON event_secret.private_event_id=event.event_id
  JOIN events completed ON completed.stream_id=event.stream_id AND completed.type='GenerationCompleted'
    AND ${objectId}=json_extract(event.payload,'$.object_id')
  JOIN event_private_payloads completed_secret ON completed_secret.private_event_id=completed.event_id
  JOIN events compiled ON compiled.event_id=completed.causation_id AND compiled.type='ContextCompiled'
  JOIN event_private_payloads compiled_secret ON compiled_secret.private_event_id=compiled.event_id
  JOIN events requested ON requested.event_id=compiled.causation_id AND requested.type='GenerationRequested'
  JOIN event_private_payloads requested_secret ON requested_secret.private_event_id=requested.event_id
  JOIN output_operation_slots slot ON slot.outcome_event_id=completed.event_id AND slot.status='succeeded'
  JOIN document_jobs job ON job.job_id=slot.job_id AND job.kind='generate' AND job.status='completed'
    AND (job.owner_id,job.stream_id,job.document_id,job.correlation_id)
      IS (${b("actor_user_id")},event.stream_id,${b("document_id")},completed.correlation_id)
    AND typeof(job.attempt_count)='integer' AND job.attempt_count BETWEEN 1 AND 9007199254740991
    AND completed.correlation_id=job.job_id||':attempt:'||job.attempt_count
  JOIN events queued ON queued.stream_id=job.stream_id AND queued.sequence=job.requested_sequence
    AND json_extract(queued.payload,'$.job_id')=job.job_id
  JOIN event_private_payloads queued_secret ON queued_secret.private_event_id=queued.event_id
  JOIN output_execution_grants grant_row ON (grant_row.scope_key,grant_row.grant_id,grant_row.plan_revision_id)
    IS (slot.scope_key,slot.grant_id,slot.plan_revision_id) AND grant_row.actor_user_id=${b("actor_user_id")}
  JOIN events authorized ON authorized.event_id=grant_row.authorization_event_id AND authorized.type='OutputExecutionAuthorized'
  JOIN event_private_payloads authorized_secret ON authorized_secret.private_event_id=authorized.event_id
  JOIN output_plan_revisions plan ON (plan.scope_key,plan.plan_revision_id) IS (slot.scope_key,slot.plan_revision_id)
  JOIN output_plan_targets target ON (target.scope_key,target.plan_revision_id,target.target_id,target.target_contract_digest)
    IS (slot.scope_key,slot.plan_revision_id,slot.target_id,slot.target_contract_digest) AND target.media_kind='image' AND target.selected=1
  JOIN output_native_storage_writes stored ON stored.scope_key=slot.scope_key AND stored.slot_id=slot.slot_id
    AND stored.publication_event_id=completed.event_id AND stored.status='written' AND stored.write_acknowledged=1
    AND length(stored.content_sha256)=64 AND stored.content_sha256 NOT GLOB '*[^a-f0-9]*'
    AND stored.content_sha256=json_extract(${completeRaw},'$.source_content_hash')
  JOIN private_content output ON output.content_id=json_extract(${completeRaw},'$.output_ref') AND output.kind='provider-output'
  LEFT JOIN private_content_retention_scopes output_retention ON output_retention.content_id=output.content_id
  JOIN private_content prompt ON prompt.content_id=json_extract(completed.payload,'$.prompt_ref') AND prompt.kind='prompt'
  LEFT JOIN private_content_retention_scopes prompt_retention ON prompt_retention.content_id=prompt.content_id
  WHERE event.type IN('ObjectSaved','ObjectPinned','ObjectExported')
    AND (event.actor='user:'||${b("actor_user_id")} OR ${b("organization_id")} IS NULL AND event.actor='user')
    AND ${envelope("event","event_secret")}
    AND EXISTS(SELECT 1 FROM memory_live_enrollments enrollment WHERE
      (enrollment.enrollment_id,enrollment.actor_user_id,enrollment.owner_user_id,enrollment.organization_id,enrollment.project_access_id,
        enrollment.project_id,enrollment.document_id,enrollment.permission_epoch,enrollment.policy_version,enrollment.revision,enrollment.cursor_sequence,
        enrollment.enrolled_at,enrollment.expires_at,enrollment.retention_days,enrollment.recall_enabled)
      IS (${["enrollment_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","permission_epoch","policy_version","revision","cursor_sequence","enrolled_at","expires_at","retention_days"].map(b).join(",")},1)
      AND enrollment.expires_at>${clock})
    AND (plan.owner_user_id,plan.organization_id,plan.project_access_id,plan.project_id,plan.document_id)
      IS (${b("owner_user_id")},${b("organization_id")},${b("project_access_id")},${b("project_id")},${b("document_id")})
    AND plan.scope_kind=CASE WHEN ${b("organization_id")} IS NULL THEN 'personal' ELSE 'project' END
    AND slot.scope_key=CASE WHEN ${b("organization_id")} IS NULL THEN 'personal:'||${b("owner_user_id")}||':'||${b("project_id")}
      ELSE 'project:'||${b("organization_id")}||':'||${b("project_access_id")} END
    AND slot.source_digest=plan.source_digest AND length(slot.source_digest)>0 AND length(slot.target_contract_digest)>0
    AND grant_row.status IN('completed','active','authorized')
    AND queued.type=CASE WHEN ${b("organization_id")} IS NULL THEN 'OutputOperationJobQueued' ELSE 'ProjectDocumentJobQueued' END
    AND queued.actor='user:'||${b("actor_user_id")} AND queued.client_id='server:output-requirements'
    AND authorized.actor=queued.actor AND authorized.client_id=queued.client_id AND authorized.correlation_id=queued.correlation_id
    AND json_extract(authorized.payload,'$.grant_id')=slot.grant_id AND json_extract(authorized.payload,'$.plan_revision_id')=slot.plan_revision_id
    AND json_extract(${queuedRaw},'$.output_slot_id')=slot.slot_id AND json_extract(${queuedRaw},'$.output_grant_id')=slot.grant_id
    AND json_extract(queued.payload,'$.kind')='generate'
    AND json_type(${authRaw},'$.authorized_targets')='array' AND json_array_length(${authRaw},'$.authorized_targets') BETWEEN 1 AND 64
    AND (SELECT COUNT(*) FROM json_each(${authRaw},'$.authorized_targets') target WHERE target.type='object'
      AND json_extract(CASE WHEN target.type='object' THEN target.value ELSE '{}' END,'$.job_id')=job.job_id
      AND json_extract(CASE WHEN target.type='object' THEN target.value ELSE '{}' END,'$.operation_slot_id')=slot.slot_id
      AND json_extract(CASE WHEN target.type='object' THEN target.value ELSE '{}' END,'$.target_id')=slot.target_id
      AND json_extract(CASE WHEN target.type='object' THEN target.value ELSE '{}' END,'$.route_digest')=slot.route_digest)=1
    AND requested.actor=CASE WHEN ${b("organization_id")} IS NULL THEN 'user' ELSE 'user:'||${b("actor_user_id")} END
    AND compiled.actor='worker:compiler' AND completed.actor='worker:generator'
    AND requested.client_id='server:document-job:generate' AND compiled.client_id=requested.client_id AND completed.client_id=requested.client_id
    AND requested.stream_id=completed.stream_id AND compiled.stream_id=completed.stream_id
    AND requested.correlation_id=completed.correlation_id AND compiled.correlation_id=completed.correlation_id
    AND queued.sequence<authorized.sequence AND authorized.sequence<requested.sequence AND requested.sequence+1=compiled.sequence
    AND compiled.sequence<completed.sequence AND completed.sequence<event.sequence
    AND json_extract(compiled.payload,'$.project_id')=${b("project_id")}
    AND json_extract(requested.payload,'$.generation_id')=json_extract(completed.payload,'$.generation_id')
    AND json_extract(compiled.payload,'$.generation_id')=json_extract(completed.payload,'$.generation_id')
    AND json_type(completed.payload,'$.object_ids')='array' AND json_array_length(completed.payload,'$.object_ids')=1
    AND json_extract(completed.payload,'$.object_ids[0]')=${objectId}
    AND json_type(completed.payload,'$.simulation')='false'
    AND ${["requested","compiled","completed"].map(a=>`json_extract(${a}.payload,'$.quality')='high' AND json_extract(${a}.payload,'$.purpose')='final'`).join(" AND ")}
    AND length(json_extract(${compileRaw},'$.context_hash')) BETWEEN 1 AND 240
    AND json_extract(${compileRaw},'$.context_hash')=json_extract(${completeRaw},'$.context_hash')
    AND json_type(${compileRaw},'$.compiled_snapshot')='object' AND json_extract(${compileRaw},'$.compiled_snapshot.document.id')=${b("document_id")}
    AND ${eventAliases.map(a=>envelope(a,a+"_secret")).join(" AND ")}
    AND ${resource("job","job.job_id","queued.event_id","actor_private")}
    AND ${resource("output",objectId,"completed.event_id")} AND ${resource("media","stored.storage_key","completed.event_id")}
    AND ${retained("output","output_retention")} AND ${retained("prompt","prompt_retention")}
    AND job.expires_at>${clock} AND json_extract(completed.payload,'$.content_expires_at')>${clock}
    AND ${eventAliases.map(a=>`${a}.recorded_at>=${b("enrolled_at")} AND strftime('%Y-%m-%dT%H:%M:%fZ',${a}.recorded_at,'+'||${b("retention_days")}||' days')>${clock}`).join(" AND ")}
    AND (SELECT COUNT(*) FROM output_operation_slots s WHERE s.job_id=job.job_id)=1
    AND (SELECT COUNT(*) FROM output_native_storage_writes s WHERE s.publication_event_id=completed.event_id)=1
    AND (SELECT COUNT(*) FROM events c WHERE c.stream_id=event.stream_id AND c.type IN('GenerationCompleted','IdeationPreviewCompleted')
      AND (json_extract(c.payload,'$.object_id')=${objectId} OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_type(c.payload,'$.object_ids')='array' THEN json_extract(c.payload,'$.object_ids') ELSE '[]' END) ids WHERE ids.value=${objectId})))=1
    AND ${["GenerationRequested","ContextCompiled","GenerationCompleted"].map(type=>`(SELECT COUNT(*) FROM events c WHERE c.stream_id=job.stream_id AND c.correlation_id=job.correlation_id AND c.type='${type}')=1`).join(" AND ")}
    AND (SELECT COUNT(*) FROM events c WHERE c.stream_id=job.stream_id AND c.type IN('OutputOperationJobQueued','ProjectDocumentJobQueued') AND json_extract(c.payload,'$.job_id')=job.job_id)=1
    AND NOT EXISTS(SELECT 1 FROM events discarded WHERE discarded.stream_id=event.stream_id AND discarded.type='ObjectDiscarded'
      AND json_extract(discarded.payload,'$.object_id')=${objectId} AND discarded.sequence>completed.sequence)
    AND length(event.event_id) BETWEEN 1 AND 240 AND length(completed.event_id) BETWEEN 1 AND 240
    AND length(${objectId}) BETWEEN 1 AND 240 AND length(stored.storage_key) BETWEEN 1 AND 1024
    AND length(json_extract(${completeRaw},'$.media_url')) BETWEEN 1 AND 3100
    AND ${["event.recorded_at","event.remembered_expires_at",...eventAliases.map(a=>a+".recorded_at"),"job.expires_at",
      "json_extract(completed.payload,'$.content_expires_at')","output.expires_at","prompt.expires_at"].map(field=>`typeof(${field})='text' AND length(${field})=24`).join(" AND ")}
    AND (output_retention.assigned_expires_at IS NULL OR typeof(output_retention.assigned_expires_at)='text' AND length(output_retention.assigned_expires_at)=24)
    AND (prompt_retention.assigned_expires_at IS NULL OR typeof(prompt_retention.assigned_expires_at)='text' AND length(prompt_retention.assigned_expires_at)=24)
  ORDER BY event.sequence,event.event_id,completed.event_id LIMIT 65`;
  const binding={enrollment_id:e.enrollment_id,actor_user_id:e.actor_user_id,owner_user_id:e.owner_user_id,organization_id:e.organization_id,
    project_access_id:e.project_access_id,project_id:e.project_id,document_id:e.document_id,permission_epoch:e.permission_epoch,
    policy_version:e.policy_version,revision:e.revision,cursor_sequence:e.cursor_sequence,enrolled_at:e.enrolled_at,expires_at:e.expires_at,retention_days:e.retention_days};
  return descriptor(sql,[...q.bindings.slice(0,6),e.enrollment_id,JSON.stringify(selected),...q.bindings.slice(6),e.cursor_sequence,JSON.stringify(binding)]);
}

/** SQL delivers only bounded identifiers/timestamps. Mutable private metadata
 * is a current availability prerequisite, never proof of original output bytes. */
export function nativeMemorySavedOutputsValue(rows:readonly Row[],e:Enrollment,sources:readonly NativeMemorySavedOutputSource[],checkedAt:string,outerValidUntil:string) {
  try {
    const refs=selection(e,sources),checked=timestamp(checkedAt),outer=timestamp(outerValidUntil);
    if(checked===null||outer===null||outer<=checked||outer-checked>60_000||!Array.isArray(rows)||rows.length>64
      || new TextEncoder().encode(JSON.stringify(rows)).byteLength>131072) return null;
    let deadline=Math.min(outer,timestamp(e.expires_at)!);
    const grouped=new Map<string,{sourceIndexes:number[];origin:"native-generated-output";independentEvidence:false;generatedAt:string}>(),seen=new Set<number>();
    for(const row of rows){
      if(!row||typeof row!=="object"||Array.isArray(row)||!id(row.source_id)||!integer(row.source_sequence)||!id(row.completion_id)||!id(row.object_id))return null;
      const position=refs.findIndex(ref=>ref.eventId===row.source_id&&ref.sequence===row.source_sequence&&ref.type===row.source_type&&ref.recordedAt===row.source_recorded_at);
      if(position<0||seen.has(position)||!action(refs[position].type))return null;
      seen.add(position);
      if(typeof row.storage_key!=="string"||row.storage_key.length<1||row.storage_key.length>1024||row.media_url!=="/api/media/"+encodeURIComponent(row.storage_key))return null;
      const times=[row.queued_at,row.authorized_at,row.requested_at,row.compiled_at,row.generated_at,row.source_recorded_at].map(timestamp);
      if(times.some(time=>time===null||time>checked||time<timestamp(e.enrolled_at)!)||times.some((time,i)=>i>0&&time!<times[i-1]!))return null;
      const deadlines=[row.remembered_expires_at,row.job_expires_at,row.content_expires_at,row.output_expires_at,row.prompt_expires_at,refs[position].validUntil];
      if(e.organization_id!==null)deadlines.push(row.output_assigned_expires_at,row.prompt_assigned_expires_at);
      else if(row.output_assigned_expires_at!==null||row.prompt_assigned_expires_at!==null)return null;
      const parsed=deadlines.map(timestamp);if(parsed.some(time=>time===null||time<=checked))return null;
      deadline=Math.min(deadline,...parsed as number[],...times.map(time=>time!+e.retention_days*86_400_000));
      const key=JSON.stringify([row.completion_id,row.object_id]),prior=grouped.get(key);
      if(prior){if(prior.generatedAt!==row.generated_at)return null;prior.sourceIndexes.push(position);}
      else grouped.set(key,{sourceIndexes:[position],origin:"native-generated-output",independentEvidence:false,generatedAt:row.generated_at as string});
    }
    if(deadline<=checked)return null;
    const outputs=[...grouped.values()].map(output=>({...output,sourceIndexes:output.sourceIndexes.sort((a,b)=>a-b)})).sort((a,b)=>a.sourceIndexes[0]-b.sourceIndexes[0]);
    const value={version:MEMORY_SAVED_OUTPUTS_VERSION,treatment:"descriptive-output-retention",inferredPreferences:false,
      coverage:{selectedSourceCount:refs.length,selectedRetentionActionCount:refs.filter(ref=>action(ref.type)).length,certifiedOutputCount:outputs.length,
        completeHistory:false,bounded:true,nativeImageJobsOnly:true},outputs};
    if(new TextEncoder().encode(JSON.stringify(value)).byteLength>MEMORY_SAVED_OUTPUTS_MAX_BYTES)return null;
    const validUntil=new Date(deadline).toISOString(),parsed=parseMemorySavedOutputs(value,refs,{checkedAt,validUntil});
    return parsed?{value:parsed,validUntil}:null;
  }catch{return null;}
}
