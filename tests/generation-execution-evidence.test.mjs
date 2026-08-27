import test from "node:test";
import assert from "node:assert/strict";
import { generationExecutionSummary, knownProviderRejection, managedProductionInputEvidence, isManagedVideoInspection } from "../src/model/generation-execution-evidence.ts";
import { failedGenerationInputInspection } from "../src/model/generation-inputs.ts";
import { generationFailureGuidance } from "../src/model/document-jobs.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import en from "../src/components/design-system/locales/system-en.ts";
import fr from "../src/components/design-system/locales/system-fr.ts";
import ar from "../src/components/design-system/locales/system-ar.ts";
import ja from "../src/components/design-system/locales/system-ja.ts";

const failure={code:"fal_content_policy_violation",category:"safety",scope:"request",requestId:"provider-scene-three",httpStatus:422,retryable:false,riskCategories:["audio-copyright"],message:"Output audio has sensitive content. Potential copyright violation."};
function checkpoint(){return {
  artifactKind:"video",generationReceipt:{provider:"fal",model:"video-model",provider_request_status:"submission_unknown",source_transmission_status:"transmitted",reservation_microusd:19_644_000,settled_cost_microusd:null,reservation_status:"executing",maximum_provider_call_count:4},
  providerSubmissions:{planner:{clientRequestId:"planner",provider:"openai",operation:"planning",model:"planner-model",status:"completed",providerRequestId:"plan",costMicrousd:100},anchor:{clientRequestId:"anchor",provider:"fal",operation:"image",model:"image-model",status:"completed",providerRequestId:"anchor",costMicrousd:200},scene:{clientRequestId:"scene",provider:"fal",operation:"video",model:"video-model",status:"accepted",providerRequestId:failure.requestId}},
  plannerInput:{provider_request_count:1},productionCompletedSceneCount:0,renderedItems:[],
  productionAnchor:{sceneId:"scene-three",provider:"fal",providerModel:"image-model",providerJobId:"anchor",mediaUrl:"/api/media/u-owner%2Fgenerated%2Fanchor.jpg",source:"account-generated",rights:"account-generated",providerResponseUrl:"https://private.example/never-copy"},
  productionSceneReceipts:{"scene-three":{sceneId:"scene-three",narrativeOrder:3,generationOrder:1,durationSeconds:15,status:"submitted",providerJobId:failure.requestId,providerModel:"video-model",providerCancelUrl:"https://private.example/never-copy",videoInputReceipt:{provider:"fal",model:"video-model",submitted_prompt:"Original ambience. No music or voices.",parameters:{generate_audio:true,duration:15,aspect_ratio:"16:9"},reference_inputs:[{sha256:"source-pixels-hash",pixels_submitted:true}],used_reference_pixels:true,adaptation:{audio_mode:"original_ambient"}}}}
};}

test("known provider rejection preserves charge uncertainty, original aggregate status, and all source state",()=>{
  const input=checkpoint(),before=JSON.stringify(input);const result=generationExecutionSummary(input,failure);
  assert.equal(result.provider_request_status,"rejected");assert.equal(result.provider_contacted,true);assert.equal(result.failure_stage,"provider");
  assert.equal(result.recorded_provider_request_status,"submission_unknown");assert.equal(result.settled_cost_microusd,null);
  assert.equal(result.reservation_microusd,19_644_000);assert.equal(result.reservation_status,"executing");assert.equal(result.retained_clip_count,0);
  assert.equal(JSON.stringify(input),before);
});

test("planner forecast is not compared with the sum of planner and media requests",()=>{
  const result=generationExecutionSummary(checkpoint(),failure);
  assert.equal(result.actual_provider_call_count,3);assert.equal(result.actual_planner_call_count,1);assert.equal(result.actual_media_call_count,2);assert.equal(result.provider_call_forecast_scope,"planning");assert.equal(result.maximum_provider_call_count,4);
});

test("uncertain submissions remain visible independently of a known failed request",()=>{
  const input=checkpoint();input.providerSubmissions.other={clientRequestId:"other",provider:"fal",operation:"video",model:"video-model",status:"pending"};
  const result=generationExecutionSummary(input,failure);assert.equal(result.provider_request_status,"rejected");assert.equal(result.unresolved_provider_call_count,1);assert.equal(result.settled_cost_microusd,null);
});

test("application preflight and unconfirmed transport are not invented provider rejection evidence",()=>{
  for(const detail of [null,{...failure,requestId:null},{...failure,httpStatus:null},{...failure,httpStatus:503},{...failure,code:"video_audio_profile_unsupported"},{...failure,code:"provider_submission_uncertain"}])assert.equal(knownProviderRejection(detail),false);
  assert.equal(generationExecutionSummary(checkpoint(),{...failure,requestId:null}).provider_request_status,"submission_unknown");
});

test("managed private scene evidence preserves final parameters and distinguishes the anchor's missing input receipt",()=>{
  const input=checkpoint(),before=JSON.stringify(input),result=managedProductionInputEvidence(input,failure);
  assert.equal(result.scenes.length,1);assert.equal(result.scenes[0].narrative_order,3);assert.equal(result.scenes[0].request_status,"rejected");assert.equal(result.scenes[0].input_status,"submitted");
  assert.deepEqual(result.scenes[0].render_input.parameters,{generate_audio:true,duration:15,aspect_ratio:"16:9"});assert.equal(result.scenes[0].render_input.reference_inputs[0].sha256,"source-pixels-hash");
  assert.equal(result.anchor.render_input,null);assert.equal(result.anchor.media_stored,true);assert.equal(result.anchor.provider_request_id,"anchor");
  assert.ok(!JSON.stringify(result).includes("never-copy"));assert.equal(JSON.stringify(input),before);
});

test("prepared-but-unaccepted scenes are not described as submitted and missing media count stays unknown",()=>{
  const input=checkpoint();delete input.productionSceneReceipts["scene-three"].providerJobId;delete input.renderedItems;delete input.productionCompletedSceneCount;
  assert.equal(managedProductionInputEvidence(input).scenes[0].input_status,"prepared");assert.equal(generationExecutionSummary(input).retained_clip_count,undefined);
});

test("redacted or absent managed inputs cannot be reconstructed from public metadata",()=>{
  assert.equal(managedProductionInputEvidence({artifactKind:"video",productionSceneCount:4}),null);
  assert.equal(managedProductionInputEvidence({productionSceneReceipts:{wrong:{sceneId:"other"}}}),null);
});

test("the existing failed-job inspector exposes managed inputs without mutating its private job",()=>{
  const job={jobId:"job",documentId:"doc",kind:"render_document",status:"failed",productionMode:"managed",attemptCount:1,promptTechnique:"prose",members:[],errorDetail:failure,result:checkpoint()};const before=JSON.stringify(job);
  const inspection=failedGenerationInputInspection(job,[],{});
  assert.equal(inspection.receipt.generation_receipt.provider_request_status,"rejected");assert.equal(inspection.receipt.generation_receipt.provider_contacted,true);assert.equal(inspection.receipt.generation_receipt.settled_cost_microusd,null);
  assert.equal(inspection.receipt.artifact_checkpoint.managed_inputs.scenes[0].render_input.parameters.generate_audio,true);assert.equal(JSON.stringify(job),before);
});

test("audio policy guidance neither prescribes silent substitution nor repeats the already-selected mode",()=>{
  const advice=generationFailureGuidance(failure,"",{kind:"render_document",status:"failed",stage:"failed",result:checkpoint()});
  assert.equal(advice.retryAllowed,false);assert.equal(advice.actionUrl,null);assert.match(advice.summary,/does not establish which source/);assert.match(advice.summary,/does not confirm the final charge/);assert.doesNotMatch(advice.summary,/Create a silent|choose original environmental/);
});

test("completed generation stays completed when result retrieval, CDN download, queue routing, or local validation fails",()=>{
  for(const [code,httpStatus] of [["fal_provider_request_failed",404],["fal_audio_download_failed",404],["fal_queue_route_method_not_allowed",405],["fal_audio_too_large",400],["fal_audio_preparation_failed",422]]){
    const input={generationReceipt:{provider_request_status:"completed",settled_cost_microusd:142_042,reservation_status:"settled"}};
    const detail={...failure,code,httpStatus,category:"provider",retryable:true};
    assert.equal(knownProviderRejection(detail),false,code);const result=generationExecutionSummary(input,detail);
    assert.equal(result.provider_request_status,"completed",code);assert.equal(result.settled_cost_microusd,142_042);assert.equal(result.reservation_status,"settled");
  }
});

test("partial generic records cannot reduce a previously recorded count or invent a complete media breakdown",()=>{
  const input=checkpoint();input.generationReceipt.actual_provider_call_count=7;input.providerSubmissions={planner:input.providerSubmissions.planner};delete input.productionAnchor;delete input.productionSceneReceipts;
  const result=generationExecutionSummary(input);assert.equal(result.actual_provider_call_count,7);assert.equal(result.actual_planner_call_count,null);assert.equal(result.actual_media_call_count,null);assert.equal(result.provider_call_breakdown_complete,false);
});

test("legacy accepted media and generic records are reconciled by exact request identity",()=>{
  const input=checkpoint();input.artifactKind="audio";input.generationReceipt.actual_provider_call_count=2;input.providerSubmissions={planner:input.providerSubmissions.planner};delete input.productionAnchor;delete input.productionSceneReceipts;
  input.audioProviderSubmission="confirmed";input.providerJobId="legacy-audio";
  let result=generationExecutionSummary(input);assert.equal(result.actual_provider_call_count,2);assert.equal(result.actual_media_call_count,1);
  input.providerSubmissions.audio={clientRequestId:"audio",provider:"fal",operation:"audio",model:"audio-model",status:"accepted",providerRequestId:"legacy-audio"};
  result=generationExecutionSummary(input);assert.equal(result.actual_provider_call_count,2);assert.equal(result.actual_media_call_count,1);
});

test("missing reference receipt fields remain unknown rather than becoming zero references or no pixels",()=>{
  const input=checkpoint();input.productionSceneReceipts["scene-three"].videoInputReceipt={provider:"fal",model:"video-model"};
  const result=managedProductionInputEvidence(input).scenes[0].render_input;
  assert.equal(result.parameters,null);assert.equal(result.reference_inputs,null);assert.equal(result.used_reference_pixels,null);
});

test("managed prompt provenance does not depend on having scene receipts",()=>{
  for(const artifact_checkpoint of [null,{plan:{title:"Plan only"}},{managed_inputs:{scenes:[],anchor:{provider_request_id:"anchor"}}}]){
    assert.equal(isManagedVideoInspection({job:{artifact_kind:"video",production_mode:"managed"},artifact_checkpoint}),true);
  }
  assert.equal(isManagedVideoInspection({generation_receipt:{artifact_kind:"video",production_mode:"managed"},artifact_checkpoint:null}),true);
  assert.equal(isManagedVideoInspection({job:{artifact_kind:"audio",production_mode:"manual"}}),false);
});

test("legacy pending audio remains uncertain even when a generic map contains only completed planning",()=>{
  const input=checkpoint();input.providerSubmissions={planner:input.providerSubmissions.planner};delete input.productionSceneReceipts;delete input.productionAnchor;input.audioProviderSubmission="pending";
  const result=generationExecutionSummary(input);assert.equal(result.unresolved_provider_call_count,null);assert.equal(result.provider_submission_uncertain,true);
  input.providerSubmissions.audio={clientRequestId:"audio",provider:"fal",operation:"audio",model:"audio-model",status:"pending"};
  assert.equal(generationExecutionSummary(input).unresolved_provider_call_count,1);
});

test("dynamic request and input states have exact translations in all four application languages",()=>{
  for(const source of ["rejected","prepared","preparing","unavailable"]){
    const id=formaSystemMessageId(source);assert.equal(en[id],source);
    for(const [locale,catalog] of Object.entries({fr,ar,ja})){assert.equal(typeof catalog[id],"string",`${locale}:${source}`);assert.notEqual(catalog[id],source,`${locale}:${source}`);assert.ok(catalog[id].length);}
  }
});

test("server summary survives observer redaction and the client's full failed-input projection",()=>{
  for(const legacy of [false,true]){
    const raw=checkpoint();raw.providerSubmissions.next={clientRequestId:"next",provider:"fal",operation:"video",model:"video-model",status:"pending"};
    if(legacy)raw.providerSubmissionLegacyUncertain=true;
    const summary=generationExecutionSummary(raw,failure),sanitized={...raw,generationReceipt:summary};
    delete sanitized.providerSubmissions;delete sanitized.providerSubmissionLegacyUncertain;
    assert.deepEqual(generationExecutionSummary(sanitized,failure),summary);
    const inspection=failedGenerationInputInspection({jobId:"job",documentId:"doc",kind:"render_document",status:"failed",productionMode:"managed",attemptCount:1,promptTechnique:"prose",members:[],errorDetail:failure,result:sanitized},[],{});
    assert.equal(inspection.receipt.generation_receipt.provider_submission_uncertain,true);
    assert.equal(inspection.receipt.generation_receipt.unresolved_provider_call_count,legacy?null:1);
    assert.equal(inspection.receipt.generation_receipt.settled_cost_microusd,null);
  }
});

test("legacy rendered-item-only provider_job_id evidence contributes exact deduplicated media calls",()=>{
  const input=checkpoint();input.providerSubmissions={planner:input.providerSubmissions.planner};delete input.productionAnchor;delete input.productionSceneReceipts;
  input.renderedItems=[{provider_job_id:"clip-one",media_url:"/api/media/one.mp4"},{provider_job_id:"clip-two",media_url:"/api/media/two.mp4"},{provider_job_id:"clip-one",media_url:"/api/media/one.mp4"}];
  const result=generationExecutionSummary(input);assert.equal(result.actual_provider_call_count,3);assert.equal(result.actual_media_call_count,2);assert.equal(result.provider_call_breakdown_complete,true);
});
