import { appendAuditEvent, ensureSchema, type WorkerEnv } from "./runtime";
import { requireCapability } from "./pilot-policy";
import { CANVAS_GOVERNANCE_VERSION, isCanvasGovernanceRequirement, readCanvasGovernance } from "./canvas-governance-policy";
import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION, falIdeogramAdapterReadiness } from "./fal-image-adapter";
import { IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE, IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE, IMAGE_ADAPTER_EVALUATION_PLAN, RETAINED_IMAGE_ADAPTER_EVALUATIONS, passingImageAdapterEvaluation } from "./image-adapter-evaluation-evidence";

const CONFIRMATION = "I understand, record this Canvas approval";
const clean=(value:unknown,max=500)=>String(value??"").trim().slice(0,max);

export async function handleCanvasGovernance(request:Request,env:WorkerEnv){
  await ensureSchema(env);const auth=await requireCapability(request,env,request.method==="POST"?"platform.release.approve":["platform.release.approve","platform.policy.manage"]);if(auth.response||!auth.user)return auth.response!;const actor=auth.user;
  if(request.method==="GET"){
    const readiness=falIdeogramAdapterReadiness(env);
    const passing=passingImageAdapterEvaluation(FAL_IDEOGRAM_ADAPTER_ID,FAL_IDEOGRAM_ADAPTER_VERSION,IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion);
    return Response.json({governance:await readCanvasGovernance(env,actor.role),confirmation:CONFIRMATION,adapterCandidate:{configured:readiness.configured,provider:"fal",adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,modelId:env.FAL_IMAGE_MODEL??"ideogram/v4",previewModelId:env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast",editModelId:env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image",capabilityReceiptRef:"docs/adapters/fal-ideogram-v4.md",evaluationRequired:!passing,readiness,retryPlan:{corpusVersion:IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion,caseCount:IMAGE_ADAPTER_EVALUATION_PLAN.caseCount,comparisonAdapter:"openai-image@v5",candidateAdapter:`${FAL_IDEOGRAM_ADAPTER_ID}@${FAL_IDEOGRAM_ADAPTER_VERSION}`,estimatedProviderCostUsd:{minimum:4,maximum:7},paid:true,requiresExplicitApproval:true,status:!readiness.configured?"configuration_required":passing?"passing_evidence_ready":String(IMAGE_ADAPTER_EVALUATION_PLAN.status)==="evaluation_failed"?"evaluation_failed":"ready_for_evaluation"},evaluationPlan:IMAGE_ADAPTER_EVALUATION_PLAN,currentEvaluation:passing,lastEvaluation:IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE,lastDiagnostic:IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE,retainedEvaluations:RETAINED_IMAGE_ADAPTER_EVALUATIONS}});
  }
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});
  const body=await request.json().catch(()=>({})) as {action?:string;requirement?:unknown;confirmation?:unknown;evidenceRef?:unknown;notes?:unknown;adapterId?:unknown;modelId?:unknown;contractVersion?:unknown;contractRef?:unknown;evaluationRef?:unknown;corpusVersion?:unknown;corpusItemCount?:unknown;capabilityReceiptRef?:unknown};
  if(body.confirmation!==CONFIRMATION)return Response.json({error:"explicit_canvas_governance_confirmation_required",confirmation:CONFIRMATION},{status:428});
  if(!isCanvasGovernanceRequirement(body.requirement))return Response.json({error:"valid_canvas_governance_requirement_required"},{status:400});
  const requirement=body.requirement;const action=body.action==="revoke"?"revoke":"approve";const now=new Date().toISOString();
  const evidenceRef=clean(body.evidenceRef,300);let approvalEvidenceRef=evidenceRef;const notes=clean(body.notes,1000);const details:Record<string,unknown>={notes,governance_version:CANVAS_GOVERNANCE_VERSION};
  if(action==="approve"&&requirement==="second_image_adapter"){
    const adapterId=clean(body.adapterId,100),modelId=clean(body.modelId,100),contractVersion=clean(body.contractVersion,80),contractRef=clean(body.contractRef,300),evaluationRef=clean(body.evaluationRef,300),corpusVersion=clean(body.corpusVersion,100),capabilityReceiptRef=clean(body.capabilityReceiptRef,300),corpusItemCount=Math.floor(Number(body.corpusItemCount??0));
    if(!adapterId||!modelId||!contractVersion||!contractRef||!evaluationRef||!corpusVersion||!capabilityReceiptRef||corpusItemCount<50)return Response.json({error:"complete_second_adapter_evidence_required",required:["a non-OpenAI adapter and model","contract version and procurement reference","server-retained passing same-context evaluation","frozen corpus version with at least 50 items","capability receipt covering reference input, rights, failure, and usage behavior"]},{status:400});
    if(adapterId==="openai-image"||/gpt-image/i.test(modelId))return Response.json({error:"second_adapter_must_be_provider_independent"},{status:400});
    if(adapterId!==FAL_IDEOGRAM_ADAPTER_ID||contractVersion!==FAL_IDEOGRAM_ADAPTER_VERSION||corpusVersion!==IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion)return Response.json({error:"approval_candidate_does_not_match_registered_adapter",registered:{adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,corpusVersion:IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion}},{status:409});
    const passing=passingImageAdapterEvaluation(adapterId,contractVersion,corpusVersion);if(!passing)return Response.json({error:"adapter_evaluation_not_passing",message:`The registered Ideogram 4 ${contractVersion} candidate has no server-retained passing ${corpusVersion} evaluation. Run the explicitly authorized paid comparison and retain its report before approval.`},{status:409});
    if(evaluationRef!==passing.evaluationRef)return Response.json({error:"adapter_evaluation_reference_mismatch",registeredEvaluation:passing.evaluationRef},{status:409});
    approvalEvidenceRef=passing.evaluationRef;Object.assign(details,{adapter_id:adapterId,model_id:modelId,contract_version:contractVersion,contract_ref:contractRef,evaluation_ref:passing.evaluationRef,corpus_version:corpusVersion,corpus_item_count:corpusItemCount,capability_receipt_ref:capabilityReceiptRef,evaluation_passed:true});
  }else if(action==="approve"&&!evidenceRef)return Response.json({error:"approval_evidence_reference_required"},{status:400});
  await env.DB.prepare(`INSERT INTO canvas_governance_requirements (requirement_id,status,approved_by_user_id,approved_by_name,approved_at,evidence_ref,details_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(requirement_id) DO UPDATE SET status=excluded.status,approved_by_user_id=excluded.approved_by_user_id,approved_by_name=excluded.approved_by_name,approved_at=excluded.approved_at,evidence_ref=excluded.evidence_ref,details_json=excluded.details_json,updated_at=excluded.updated_at`)
    .bind(requirement,action==="approve"?"approved":"revoked",actor.userId,actor.displayName,now,action==="approve"?(approvalEvidenceRef||clean(body.contractRef,300)):null,JSON.stringify(details),now).run();
  await appendAuditEvent(env,actor.streamId,"user",action==="approve"?"CanvasGovernanceRequirementApproved":"CanvasGovernanceRequirementRevoked",{requirement_id:requirement,governance_version:CANVAS_GOVERNANCE_VERSION,evidence_ref:action==="approve"?(approvalEvidenceRef||clean(body.contractRef,300)):null,details,approved_by_user_id:actor.userId,approved_by_name:actor.displayName,direct_administrator_attestation:true});
  return Response.json({governance:await readCanvasGovernance(env,actor.role)});
}
