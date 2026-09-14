import { imageFormatEventFields } from "../src/model/image-format.ts";
import { readOutputFalImageContract, type OutputFalImageContract } from "../src/model/output-fal-image-contract.ts";
/** Narrow expiry-only cleanup exception; never a provider-dispatch permission.
 * Fixed internal aliases: output_execution_grants is the candidate grant.
 * Group equivalent AND predicates to keep nested cleanup queries within D1's
 * expression-depth limit; every original custody and retention check remains. */
export const retainedPersonalFalRecoverySql=`EXISTS(
  SELECT 1 FROM output_operation_slots original JOIN output_plan_revisions plan ON plan.scope_key=original.scope_key AND plan.plan_revision_id=original.plan_revision_id
  JOIN document_jobs job ON job.job_id=original.job_id
  JOIN output_provider_calls call ON call.scope_key=original.scope_key AND call.slot_id=original.slot_id
  JOIN private_content request ON request.content_id=json_extract(job.result_json,'$.outputFalCheckpoint.requestRef')
  JOIN private_content planning ON planning.content_id=json_extract(job.result_json,'$.outputFalCheckpoint.planningRef')
  WHERE (original.scope_key=output_execution_grants.scope_key AND original.grant_id=output_execution_grants.grant_id
    AND (SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=original.scope_key AND sibling.grant_id=original.grant_id)=1)
    AND (plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL
    AND plan.owner_user_id=output_execution_grants.actor_user_id AND output_execution_grants.context_id IS NULL)
    AND (original.provider='fal' AND original.model='ideogram/v4' AND original.attempt_ordinal=0 AND original.previous_slot_id IS NULL
    AND original.status IN('queued','running','uncertain','failed'))
    AND (job.kind='generate' AND job.status IN('running','committing','failed')
    AND job.owner_id=plan.owner_user_id AND job.document_id=plan.document_id AND job.stream_id='creative:'||plan.owner_user_id
    AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND (json_extract(job.result_json,'$.outputFalCheckpoint.version')='output-fal-checkpoint-v1'
    AND json_extract(job.result_json,'$.outputFalCheckpoint.provider')='fal' AND json_extract(job.result_json,'$.outputFalCheckpoint.model')='ideogram/v4'
    AND json_extract(job.result_json,'$.outputFalCheckpoint.stage')='image:initial')
    AND (call.call_key='image:initial' AND call.stage_key='image:initial' AND call.provider='fal' AND call.model='ideogram/v4'
    AND call.status IN('uncertain','settled') AND length(call.provider_response_id) BETWEEN 1 AND 200 AND lower(call.provider_response_id) NOT IN('pending','submitted','unknown')
    AND call.client_request_id=json_extract(job.result_json,'$.outputFalCheckpoint.clientRequestId')
    AND call.request_digest=json_extract(job.result_json,'$.outputFalCheckpoint.requestDigest'))
    AND (request.owner_id=job.owner_id AND request.kind='prompt' AND request.redacted_at IS NULL AND request.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND (planning.owner_id=job.owner_id AND planning.kind='provider-output' AND planning.redacted_at IS NULL AND planning.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id IN(request.content_id,planning.content_id)))`;

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function readFalRecoveryCheckpoint(value:unknown){
  const v=object(value),keys=["version","clientRequestId","requestDigest","stage","provider","model","requestRef","requestSha256","planningRef","planningSha256","expiresAt"];
  if(Object.keys(v).length!==keys.length||keys.some(k=>typeof v[k]!=="string")||v.version!=="output-fal-checkpoint-v1"||v.stage!=="image:initial"||v.provider!=="fal"||v.model!=="ideogram/v4"
    ||![v.requestDigest,v.requestSha256,v.planningSha256].every(x=>/^[a-f0-9]{64}$/u.test(String(x)))
    ||![v.clientRequestId,v.requestRef,v.planningRef].every(x=>/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(String(x)))
    ||v.requestRef===v.planningRef||!Number.isFinite(Date.parse(String(v.expiresAt))))return null;
  return v as Record<typeof keys[number],string>;
}


/** Original format and planning lineage, without a new provider response. */
export function falRecoveryEventProvenance(value:OutputFalImageContract,imageRender:unknown,compiledValue:unknown,planningSource:unknown){
  const contract=readOutputFalImageContract(value),render=object(imageRender),format=object(render.format),dimensions=object(format.dimensions),compiled=object(compiledValue);
  if(!contract||render.size!==`${contract.width}x${contract.height}`||dimensions.width!==contract.width||dimensions.height!==contract.height||dimensions.unit!=="px"
    ||typeof compiled.context_hash!=="string"||!compiled.context_hash||compiled.context_hash.length>256||planningSource!=="provider")throw new Error("output_fal_recovery_provenance_unavailable");
  return{...imageFormatEventFields(format,"full",typeof compiled.image_format_block_id==="string"?compiled.image_format_block_id:null),
    provider_render_size:render.size,size:render.size,context_hash:compiled.context_hash,planning_source:planningSource,planning_cache_hit:false};
}
