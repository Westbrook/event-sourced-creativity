import { artifactReviewState, artifactSourceVersions } from "../src/model/context-health.ts";
import { foldEvents, type CreativeEvent } from "../src/model/events.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority.ts";

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
