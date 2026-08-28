import { artifactReviewState, artifactSourceVersions, creativeContextRightsValidity } from "../src/model/context-health.ts";
import { foldEvents, type CreativeEvent } from "../src/model/events.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import { canonicalConsent } from "./consequential-consent.ts";
import { serializeEvent, eventWriteBindings, type WorkerEnv } from "./runtime.ts";

export const ARTIFACT_REVIEW_EVENT_TYPES=new Set(["ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested"]);

type ReviewInput={
  type:string;
  payload:Record<string,unknown>;
  events:CreativeEvent[];
  actorUserId:string;
  projectId:string;
  canApprove:boolean;
  independentReviewer:boolean;
  expectedArtifactRevision?:number;
  expectedContentSha256?:string;
};

export type ArtifactReviewValidation={ok:true;payload:Record<string,unknown>}|{ok:false;code:string;message:string;status:403|409};

const actorIdentity=(actor:string)=>actor.startsWith("user:")?actor.slice("user:".length):"";

/** Validate approval against durable project reality rather than caller-supplied receipts. */
export function validateArtifactReview(input:ReviewInput):ArtifactReviewValidation{
  const artifactId=String(input.payload.artifact_id??"");
  const documentId=String(input.payload.document_id??"");
  const completed=[...input.events].reverse().find((event)=>event.type==="DocumentRenderCompleted"&&String(event.payload.artifact_id??"")===artifactId);
  if(!artifactId||!documentId||!completed||String(completed.payload.document_id??"")!==documentId||String(completed.payload.project_id??input.projectId)!==input.projectId){
    return{ok:false,code:"artifact_document_mismatch",message:"This output does not belong to the selected project and document.",status:403};
  }
  const versions=artifactSourceVersions(artifactId,input.events);
  if(!versions?.length)return{ok:false,code:"artifact_source_revision_unavailable",message:"This earlier output has no verifiable source revision; create a fresh version before review.",status:409};
  const projection=foldEvents(input.events,Number.POSITIVE_INFINITY,documentId,input.projectId);
  const artifact={id:artifactId,documentId,sequence:completed.sequence};
  const review=artifactReviewState(artifact,projection.blocks,input.events);
  if(review.status==="stale"&&input.type!=="ArtifactChangesRequested")return{ok:false,code:"artifact_source_stale",message:"Source decisions changed after this output was generated; update or regenerate it before approval.",status:409};

  try{authoritativeCreativeContext(input.events,{documentId,projectId:input.projectId});}
  catch(error){if(error instanceof ContextIntegrityError)return{ok:false,code:error.code,message:error.message,status:409};throw error;}

  const actual=versions.map((version)=>{const block=projection.blocks.find((candidate)=>candidate.id===String(version.block_id??""));return{block_id:String(version.block_id??""),version:Number(block?.sourceEvents.length??0)};});
  const claimed=Array.isArray(input.payload.source_block_versions)?input.payload.source_block_versions.map((value)=>value&&typeof value==="object"?value as Record<string,unknown>:{}):[];
  if(claimed.length!==actual.length||claimed.some((version)=>!actual.some((current)=>current.block_id===String(version.block_id??"")&&current.version===Number(version.version??-1)))){
    return{ok:false,code:"artifact_review_versions_mismatch",message:"The submitted review does not match the output's authorized source decisions.",status:409};
  }
  if(["ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested"].includes(input.type)&&input.expectedArtifactRevision!==undefined){
    if(!Number.isSafeInteger(input.payload.artifact_revision)||Number(input.payload.artifact_revision)!==input.expectedArtifactRevision
      ||!input.expectedContentSha256||String(input.payload.content_sha256??"")!==input.expectedContentSha256){
      return{ok:false,code:"stale_review_context",message:"The finished output changed before this exact revision could be submitted or independently approved.",status:409};
    }
  }

  if(input.type==="ArtifactChangesRequested"){
    const note=String(input.payload.review_note??"").trim();
    if(!note||note.length>500)return{ok:false,code:"actionable_review_note_required",message:"Explain the exact changes the author needs to make before requesting another review.",status:409};
  }

  if(input.type==="ArtifactApproved"||input.type==="ArtifactChangesRequested"){
    if(!input.canApprove)return{ok:false,code:"artifact_reviewer_required",message:"Only a designated project reviewer can approve this output.",status:403};
    if(review.status!=="in-review")return{ok:false,code:"artifact_review_request_required",message:"An output must be formally submitted for review before a reviewer can decide on its exact revision.",status:409};
    if(input.independentReviewer){
      const requested=[...input.events].reverse().find((event)=>event.type==="ArtifactReviewRequested"&&String(event.payload.artifact_id??"")===artifactId);
      const rendered=[...input.events].reverse().find((event)=>event.type==="DocumentRenderRequested"&&String(event.payload.artifact_id??"")===artifactId);
      const contributed=input.events.some((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId&&event.sequence>completed.sequence
        &&(actorIdentity(event.actor)===input.actorUserId||String(event.payload.edited_by_user_id??"")===input.actorUserId));
      const creator=String(completed.payload.requested_by_user_id??actorIdentity(rendered?.actor??""));
      if(actorIdentity(requested?.actor??"")===input.actorUserId||creator===input.actorUserId||contributed)return{ok:false,code:"artifact_independent_reviewer_required",message:"A different designated reviewer must approve work they did not create, edit, or submit.",status:403};
    }
  }

  return{ok:true,payload:{...input.payload,artifact_id:artifactId,document_id:documentId,project_id:input.projectId,source_block_versions:actual,artifact_source_event_id:completed.eventId}};
}

export type ExactArtifactContentBinding = {
  contentId: string; content: string; revision: number;
  rightsGuard: BudgetReservationGuard; rightsValidUntil: string | null;
};

/** Current byte/rights proof, shared by exact artifact and legacy whole-document release routes.
 * Materialize distinct rights separately from each content/revision lookup. Keeping the
 * same proof in the statement avoids D1's depth-100 limit without weakening commit custody. */
export function artifactExactBatchGuard(
  context:{projectAccessId:string;organizationId:string;projectId:string;ownerUserId:string},
  bindings:ReadonlyMap<string,ExactArtifactContentBinding>,
):BudgetReservationGuard|null{
  if(!bindings.size)return{sql:"",bindings:[]};
  const expressions:string[]=[],rights:Array<{kind:number;bindings:BudgetReservationGuard["bindings"]}>=[],rightKeys=new Map<string,number>();
  const artifacts=[...bindings].map(([artifactId,binding])=>{
    let kind=expressions.indexOf(binding.rightsGuard.sql);
    if(kind<0){kind=expressions.length;expressions.push(binding.rightsGuard.sql);}
    const key=JSON.stringify([kind,binding.rightsGuard.bindings]);let right=rightKeys.get(key);
    if(right===undefined){right=rights.length;rightKeys.set(key,right);rights.push({kind,bindings:binding.rightsGuard.bindings});}
    return{artifactId,contentId:binding.contentId,content:binding.content,revision:binding.revision,right,validUntil:binding.rightsValidUntil};
  });
  // Array keys are non-null: an unmatched key means the exact artifact's right is unavailable.
  const cases=expressions.map((expression,kind)=>{
    let index=0;const sql=expression.replace(/\?/gu,()=>"json_extract(exact_right.value,'$.bindings["+(index++)+"]')");
    if(rights.some(right=>right.kind===kind&&right.bindings.length!==index))throw new Error("artifact_rights_guard_invalid");
    return"WHEN "+kind+" THEN ("+sql+")";
  }).join(" ");
  const sql=` AND EXISTS(WITH exact_batch(value) AS MATERIALIZED(SELECT ?),
    exact_current_rights AS MATERIALIZED(SELECT exact_right.key FROM exact_batch,json_each(exact_batch.value,'$.rights') exact_right
      WHERE CASE json_extract(exact_right.value,'$.kind') ${cases} ELSE 0 END)
    SELECT 1 FROM exact_batch WHERE NOT EXISTS(
    SELECT 1 FROM json_each(exact_batch.value,'$.artifacts') expected
      LEFT JOIN exact_current_rights current_right ON current_right.key=json_extract(expected.value,'$.right')
      WHERE current_right.key IS NULL OR NOT EXISTS(SELECT 1 FROM private_content exact_content
      JOIN project_resource_scopes exact_artifact ON (exact_artifact.project_access_id,exact_artifact.organization_id,exact_artifact.project_id,exact_artifact.owner_user_id,
        exact_artifact.resource_kind,exact_artifact.resource_id,exact_artifact.visibility)=(json_extract(exact_batch.value,'$.context.projectAccessId'),
        json_extract(exact_batch.value,'$.context.organizationId'),json_extract(exact_batch.value,'$.context.projectId'),
        json_extract(exact_batch.value,'$.context.ownerUserId'),'artifact',json_extract(expected.value,'$.artifactId'),'collaborative_output')
      JOIN project_resource_scopes exact_retained ON (exact_retained.project_access_id,exact_retained.organization_id,exact_retained.project_id,exact_retained.owner_user_id,
        exact_retained.resource_kind,exact_retained.resource_id,exact_retained.visibility)=(exact_artifact.project_access_id,
        exact_artifact.organization_id,exact_artifact.project_id,exact_artifact.owner_user_id,'content',exact_content.content_id,'collaborative_output')
      WHERE (exact_content.content_id,exact_content.owner_id,exact_content.kind,exact_content.content)=(json_extract(expected.value,'$.contentId'),
        json_extract(exact_batch.value,'$.context.ownerUserId'),'document-artifact',json_extract(expected.value,'$.content'))
        AND exact_content.redacted_at IS NULL AND exact_content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND (SELECT COUNT(*) FROM events exact_revision WHERE (exact_revision.stream_id,exact_revision.type,json_extract(exact_revision.payload,'$.artifact_id'))=
          ('creative:'||json_extract(exact_batch.value,'$.context.ownerUserId'),'DocumentArtifactEdited',json_extract(expected.value,'$.artifactId')))
          =json_extract(expected.value,'$.revision')
        AND(json_extract(expected.value,'$.validUntil') IS NULL OR json_extract(expected.value,'$.validUntil')>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))`;
  const packed=JSON.stringify({context:artifactEvidenceScope(context),artifacts,rights}),encoder=new TextEncoder();
  if(encoder.encode(packed).byteLength>1_900_000||encoder.encode(sql).byteLength>50_000)return null;
  return{sql,bindings:[packed]};
}

export function artifactExactContentGuard(
  context:{projectAccessId:string;organizationId:string;projectId:string;ownerUserId:string},
  artifactId:string,binding?:ExactArtifactContentBinding,
):BudgetReservationGuard{
  return artifactExactBatchGuard(context,new Map(binding?[[artifactId,binding]]:[]))??{sql:" AND 0",bindings:[]};
}

type ArtifactEvidenceScope={projectAccessId:string;organizationId:string;projectId:string;ownerUserId:string};
const artifactEvidenceScope=(scope:ArtifactEvidenceScope)=>({projectAccessId:scope.projectAccessId,organizationId:scope.organizationId,projectId:scope.projectId,ownerUserId:scope.ownerUserId});
type ArtifactEvidenceRow={event_id:string;stream_id:string;sequence:number;type:string;actor:string;client_id:string;correlation_id:string;
  causation_id:string|null;compensates_event_id:string|null;payload:string;private_json:string|null;private_owner:string|null;redacted_at:string|null;custody_actor:string|null};

/** These server-only snapshots bind the bytes actually reviewed, not a redacted public fallback. */
export async function artifactSourceEvidenceGuard(env:WorkerEnv,scope:ArtifactEvidenceScope,documentId:string,events:CreativeEvent[],artifactIds:readonly string[]=[]){
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,documentId,scope.projectId);
  const document=projection.documents.find(item=>item.id===documentId&&item.projectId===scope.projectId&&!item.removed);
  if(!document)return null;
  const blocks=projection.blocks.filter(block=>!block.removed),blockIds=new Set(blocks.map(block=>block.id));
  const ids=new Set(document.sourceEvents),resources=new Map<string,{kind:string;id:string}>();
  const add=(kind:string,id:string)=>resources.set(kind+":"+id,{kind,id});add("document",documentId);
  const references=new Set<string>(),deadlines:string[]=[];
  for(const block of blocks){
    add("block",block.id);for(const id of block.sourceEvents)ids.add(id);
    const reference=String(block.properties.reference_id??"");if(reference){references.add(reference);add("reference",reference);}
    if(Number(block.properties.weight??.5)>0){
      const validity=creativeContextRightsValidity(block.properties);if(validity.issue)return null;if(validity.validUntil)deadlines.push(validity.validUntil);
      if(reference){
        const receipt=[...events].reverse().find(event=>["ReferenceIngested","RightsAsserted"].includes(event.type)&&String(event.payload.reference_id??"")===reference);
        if(!receipt)return null;
        const right=creativeContextRightsValidity(receipt.payload);if(right.issue)return null;if(right.validUntil)deadlines.push(right.validUntil);
      }
    }
  }
  for(const relation of projection.libraryBlockRelations)if(!relation.removed&&(blockIds.has(relation.fromBlockId)||blockIds.has(relation.toBlockId))){
    add("relation",relation.id);for(const id of relation.sourceEvents)ids.add(id);
  }
  for(const event of events)if(["ReferenceIngested","RightsAsserted"].includes(event.type)&&references.has(String(event.payload.reference_id??""))
    ||artifactIds.includes(String(event.payload.artifact_id??""))
      &&["DocumentRenderRequested","DocumentRenderCompleted","DocumentArtifactEdited",...ARTIFACT_REVIEW_EVENT_TYPES].includes(event.type))ids.add(event.eventId);
  const expected=new Map(events.filter(event=>ids.has(event.eventId)).map(event=>[event.eventId,event]));
  if(expected.size!==ids.size)return null;
  const rows=await env.DB.prepare(`SELECT event.*,secret.private_json,secret.owner_id AS private_owner,secret.redacted_at,custody.actor_user_id AS custody_actor
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    LEFT JOIN project_event_scopes custody ON custody.event_id=event.event_id AND custody.project_access_id=? AND custody.organization_id=?
      AND custody.project_id=? AND custody.owner_user_id=? AND custody.source_stream_id=event.stream_id AND custody.source_sequence=event.sequence
    WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))`)
    .bind(scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,"creative:"+scope.ownerUserId,JSON.stringify([...ids])).all<ArtifactEvidenceRow>();
  if(rows.results.length!==ids.size)return null;
  for(const row of rows.results){
    if(!row.custody_actor||row.redacted_at!==null||row.private_json!==null&&row.private_owner!==scope.ownerUserId)return null;
    let actual:CreativeEvent;try{actual=serializeEvent(row);}catch{return null;}
    if("_private_ref"in actual.payload||canonicalConsent(actual)!==canonicalConsent(expected.get(row.event_id)))return null;
  }
  const snapshot=JSON.stringify([{scope:artifactEvidenceScope(scope),events:rows.results.map(row=>({eventId:row.event_id,sequence:row.sequence,type:row.type,actor:row.actor,
    clientId:row.client_id,correlationId:row.correlation_id,causationId:row.causation_id,compensatesEventId:row.compensates_event_id,
    payload:row.payload,privateJson:row.private_json,privateOwner:row.private_owner,custodyActor:row.custody_actor})),resources:[...resources.values()]}]);
  if(new TextEncoder().encode(snapshot).byteLength>1_000_000)return null;
  // '=' retains each field's affinity/collation; nullable envelope/private fields keep null-safe IS.
  const guard:BudgetReservationGuard={sql:`NOT EXISTS(SELECT 1 FROM json_each(?) artifact_source WHERE NOT(
    NOT EXISTS(SELECT 1 FROM json_each(artifact_source.value,'$.events') expected WHERE NOT EXISTS(SELECT 1 FROM events event
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      JOIN project_event_scopes custody ON custody.event_id=event.event_id
      WHERE (event.event_id,event.stream_id,event.sequence,event.type,event.actor,event.client_id,event.correlation_id,event.payload)=
        (json_extract(expected.value,'$.eventId'),'creative:'||json_extract(artifact_source.value,'$.scope.ownerUserId'),
        json_extract(expected.value,'$.sequence'),json_extract(expected.value,'$.type'),json_extract(expected.value,'$.actor'),
        json_extract(expected.value,'$.clientId'),json_extract(expected.value,'$.correlationId'),json_extract(expected.value,'$.payload'))
        AND (event.causation_id,event.compensates_event_id,secret.private_json,secret.owner_id) IS
        (json_extract(expected.value,'$.causationId'),json_extract(expected.value,'$.compensatesEventId'),json_extract(expected.value,'$.privateJson'),json_extract(expected.value,'$.privateOwner'))
        AND secret.redacted_at IS NULL
        AND (custody.project_access_id,custody.organization_id,custody.project_id,custody.owner_user_id,custody.source_stream_id,custody.source_sequence,custody.actor_user_id)=
        (json_extract(artifact_source.value,'$.scope.projectAccessId'),json_extract(artifact_source.value,'$.scope.organizationId'),
        json_extract(artifact_source.value,'$.scope.projectId'),json_extract(artifact_source.value,'$.scope.ownerUserId'),event.stream_id,event.sequence,json_extract(expected.value,'$.custodyActor'))))
    AND NOT EXISTS(SELECT 1 FROM json_each(artifact_source.value,'$.resources') required WHERE NOT EXISTS(SELECT 1 FROM project_resource_scopes resource
      WHERE (resource.resource_kind,resource.resource_id,resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.visibility)=
        (json_extract(required.value,'$.kind'),json_extract(required.value,'$.id'),json_extract(artifact_source.value,'$.scope.projectAccessId'),
        json_extract(artifact_source.value,'$.scope.organizationId'),json_extract(artifact_source.value,'$.scope.projectId'),
        json_extract(artifact_source.value,'$.scope.ownerUserId'),'collaborative_output')))))`,
    bindings:[snapshot]};
  return{guard,validUntil:deadlines.sort()[0]??null};
}

/** Fail the existing transaction if a review/export row or its project custody sidecar was suppressed. */
export function artifactReviewCompletionGuard(scope:ArtifactEvidenceScope,events:readonly CreativeEvent[]):BudgetReservationGuard{
  return{sql:`NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM events event
    JOIN project_event_scopes custody ON custody.event_id=event.event_id
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.event_id=json_extract(expected.value,'$[0]') AND event.stream_id=? AND event.sequence=json_extract(expected.value,'$[2]')
      AND event.occurred_at=json_extract(expected.value,'$[3]') AND event.recorded_at=json_extract(expected.value,'$[4]')
      AND event.actor=json_extract(expected.value,'$[5]') AND event.client_id=json_extract(expected.value,'$[6]')
      AND event.correlation_id=json_extract(expected.value,'$[7]') AND event.causation_id IS json_extract(expected.value,'$[8]')
      AND event.compensates_event_id IS json_extract(expected.value,'$[9]') AND event.schema_version=json_extract(expected.value,'$[10]')
      AND event.type=json_extract(expected.value,'$[11]') AND event.payload=json_extract(expected.value,'$[12]')
      AND secret.private_json IS json_extract(expected.value,'$[16]') AND secret.redacted_at IS NULL
      AND (json_extract(expected.value,'$[16]') IS NULL OR secret.owner_id=json_extract(expected.value,'$[13]'))
      AND custody.project_access_id=? AND custody.organization_id=? AND custody.project_id=? AND custody.owner_user_id=?
      AND custody.actor_user_id=substr(event.actor,6) AND custody.source_stream_id=event.stream_id AND custody.source_sequence=event.sequence))`,
    bindings:[JSON.stringify(events.map(eventWriteBindings)),"creative:"+scope.ownerUserId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId]};
}
