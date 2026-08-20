import { appendAuditEvent, ensureSchema, type WorkerEnv } from "./runtime";
import { requireUser } from "./pilot-policy";
import { CANVAS_GOVERNANCE_VERSION, isCanvasGovernanceRequirement, readCanvasGovernance, type CanvasGovernanceRequirementId } from "./canvas-governance-policy";

const CONFIRMATION = "I understand, record this Canvas approval";
const clean=(value:unknown,max=500)=>String(value??"").trim().slice(0,max);

export async function handleCanvasGovernance(request:Request,env:WorkerEnv){
  await ensureSchema(env);const auth=await requireUser(request,env,"admin",{account:"principal"});if(auth.response||!auth.user)return auth.response!;const actor=auth.user;
  if(request.method==="GET")return Response.json({governance:await readCanvasGovernance(env,actor.role),confirmation:CONFIRMATION,adapterCandidate:{configured:Boolean(env.FAL_KEY),provider:"fal",adapterId:"fal-ideogram-v4",adapterVersion:"v1",modelId:env.FAL_IMAGE_MODEL??"ideogram/v4",previewModelId:env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast",editModelId:env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image",capabilityReceiptRef:"docs/adapters/fal-ideogram-v4.md",evaluationRequired:true}});
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});
  const body=await request.json().catch(()=>({})) as {action?:string;requirement?:unknown;confirmation?:unknown;evidenceRef?:unknown;notes?:unknown;adapterId?:unknown;modelId?:unknown;contractVersion?:unknown;contractRef?:unknown;evaluationRef?:unknown;corpusVersion?:unknown;corpusItemCount?:unknown;capabilityReceiptRef?:unknown;evaluationPassed?:unknown};
  if(body.confirmation!==CONFIRMATION)return Response.json({error:"explicit_canvas_governance_confirmation_required",confirmation:CONFIRMATION},{status:428});
  if(!isCanvasGovernanceRequirement(body.requirement))return Response.json({error:"valid_canvas_governance_requirement_required"},{status:400});
  const requirement=body.requirement;const action=body.action==="revoke"?"revoke":"approve";const now=new Date().toISOString();
  const evidenceRef=clean(body.evidenceRef,300);const notes=clean(body.notes,1000);const details:Record<string,unknown>={notes,governance_version:CANVAS_GOVERNANCE_VERSION};
  if(action==="approve"&&requirement==="second_image_adapter"){
    const adapterId=clean(body.adapterId,100),modelId=clean(body.modelId,100),contractVersion=clean(body.contractVersion,80),contractRef=clean(body.contractRef,300),evaluationRef=clean(body.evaluationRef,300),corpusVersion=clean(body.corpusVersion,100),capabilityReceiptRef=clean(body.capabilityReceiptRef,300),corpusItemCount=Math.floor(Number(body.corpusItemCount??0));
    if(!adapterId||!modelId||!contractVersion||!contractRef||!evaluationRef||!corpusVersion||!capabilityReceiptRef||corpusItemCount<50||body.evaluationPassed!==true)return Response.json({error:"complete_second_adapter_evidence_required",required:["a non-OpenAI adapter and model","contract version and procurement reference","passing same-context evaluation reference","frozen corpus version with at least 50 items","capability receipt covering reference input, rights, failure, and usage behavior"]},{status:400});
    if(adapterId==="openai-image"||/gpt-image/i.test(modelId))return Response.json({error:"second_adapter_must_be_provider_independent"},{status:400});
    Object.assign(details,{adapter_id:adapterId,model_id:modelId,contract_version:contractVersion,contract_ref:contractRef,evaluation_ref:evaluationRef,corpus_version:corpusVersion,corpus_item_count:corpusItemCount,capability_receipt_ref:capabilityReceiptRef,same_context_evaluation:true,evaluation_passed:true});
  }else if(action==="approve"&&!evidenceRef)return Response.json({error:"approval_evidence_reference_required"},{status:400});
  await env.DB.prepare(`INSERT INTO canvas_governance_requirements (requirement_id,status,approved_by_user_id,approved_by_name,approved_at,evidence_ref,details_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(requirement_id) DO UPDATE SET status=excluded.status,approved_by_user_id=excluded.approved_by_user_id,approved_by_name=excluded.approved_by_name,approved_at=excluded.approved_at,evidence_ref=excluded.evidence_ref,details_json=excluded.details_json,updated_at=excluded.updated_at`)
    .bind(requirement,action==="approve"?"approved":"revoked",actor.userId,actor.displayName,now,action==="approve"?(evidenceRef||clean(body.contractRef,300)):null,JSON.stringify(details),now).run();
  await appendAuditEvent(env,actor.streamId,"user",action==="approve"?"CanvasGovernanceRequirementApproved":"CanvasGovernanceRequirementRevoked",{requirement_id:requirement,governance_version:CANVAS_GOVERNANCE_VERSION,evidence_ref:action==="approve"?(evidenceRef||clean(body.contractRef,300)):null,details,approved_by_user_id:actor.userId,approved_by_name:actor.displayName,direct_administrator_attestation:true});
  return Response.json({governance:await readCanvasGovernance(env,actor.role)});
}
