import test from "node:test";
import assert from "node:assert/strict";
import { generationExecutionSummary, knownProviderRejection, managedProductionInputEvidence, isManagedVideoInspection, presentationProviderLabels, safePresentationProviderLabels } from "../src/model/generation-execution-evidence.ts";
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


test("a legacy pending slideshow repair stays uncertain after a completed initial response", () => {
  for (const generic of [false, true]) {
    const initial = { clientRequestId: "initial", provider: "openai", operation: "planning", model: "gpt-5.6-terra",
      status: "completed", providerRequestId: "initial-response", costMicrousd: 12000 };
    const input = { artifactKind: "slides", presentationProviderSubmission: "pending", presentationProviderClientRequestId: "repair",
      plannerResponseId: "initial-response", plannerResponseIds: ["initial-response"],
      generationReceipt: { artifact_kind: "slides", provider_request_status: "submission_unknown", actual_provider_call_count: 1,
        reservation_microusd: 1000000, settled_cost_microusd: null, reservation_status: "executing" },
      ...(generic ? { providerSubmissions: { initial } } : {}) };
    const before = JSON.stringify(input), result = generationExecutionSummary(input, { code: "provider_submission_uncertain" });
    assert.equal(result.provider_request_status, "submission_unknown");
    assert.equal(result.provider_submission_uncertain, true);
    assert.equal(result.unresolved_provider_call_count, null);
    assert.equal(result.provider_call_breakdown_complete, false);
    assert.equal(result.actual_provider_call_count, 1);
    assert.equal(result.reservation_status, "executing");
    assert.equal(result.settled_cost_microusd, null);
    assert.equal(JSON.stringify(input), before);
    input.providerSubmissions = { initial, repair: { ...initial, clientRequestId: "repair", status: "pending", providerRequestId: undefined, costMicrousd: undefined } };
    delete input.providerSubmissions.repair.costMicrousd;
    assert.equal(generationExecutionSummary(input).unresolved_provider_call_count, 1);
    input.presentationProviderClientRequestId = "another-unrepresented-repair";
    assert.equal(generationExecutionSummary(input).unresolved_provider_call_count, null);
  }
});

test("invalid generic paid evidence is uncertain for ordinary slideshow jobs too", () => {
  for (const providerSubmissions of [null, [], { bad: null },
    { bad: { clientRequestId: "different", provider: "openai", operation: "planning", model: "gpt-5.6-terra", status: "completed" } },
    { bad: { clientRequestId: "bad", provider: "openai", operation: "planning", model: "gpt-5.6-terra", status: "unknown" } },
    { bad: { clientRequestId: "bad", provider: "openai", operation: "planning", model: "gpt-5.6-terra", status: "completed", costMicrousd: -1 } }]) {
    const result = generationExecutionSummary({ artifactKind: "slides", providerSubmissions,
      generationReceipt: { actual_provider_call_count: 1, reservation_status: "executing", settled_cost_microusd: null } });
    assert.equal(result.provider_submission_uncertain, true);
    assert.equal(result.unresolved_provider_call_count, null);
    assert.equal(result.provider_call_breakdown_complete, false);
    assert.equal(result.actual_provider_call_count, 1);
    assert.equal(result.actual_planner_call_count, null);
    assert.equal(result.settled_cost_microusd, null);
  }
});

test("redacted execution summaries cannot turn reported uncertainty into a known zero", () => {
  for (const declared of [
    { provider_request_status: "submission_unknown" }, { provider_submission_uncertain: true },
  ]) {
    const receipt = { execution_evidence_version: 1, actual_provider_call_count: 1, provider_submission_uncertain: false,
      unresolved_provider_call_count: 0, provider_call_breakdown_complete: true, reservation_status: "executing", settled_cost_microusd: null, ...declared };
    const once = generationExecutionSummary({ generationReceipt: receipt });
    assert.equal(once.provider_submission_uncertain, true);
    assert.equal(once.unresolved_provider_call_count, null);
    assert.equal(once.provider_call_breakdown_complete, false);
    assert.deepEqual(generationExecutionSummary({ generationReceipt: once }), once);
    assert.equal(receipt.unresolved_provider_call_count, 0);
  }
  const legacy = generationExecutionSummary({ presentationProviderSubmission: "pending", plannerResponseId: "initial-response",
    generationReceipt: { execution_evidence_version: 1, unresolved_provider_call_count: 0, provider_submission_uncertain: false } });
  assert.equal(legacy.provider_submission_uncertain, true);
  assert.equal(legacy.unresolved_provider_call_count, null);
  const publicReceipt = { execution_evidence_version: 1, provider_submission_uncertain: true, unresolved_provider_call_count: 2,
    provider_call_breakdown_complete: true, actual_provider_call_count: 1, settled_cost_microusd: null };
  assert.deepEqual(generationExecutionSummary({ generationReceipt: publicReceipt }), publicReceipt);
  const failure = generationExecutionSummary({ generationReceipt: { execution_evidence_version: 1, unresolved_provider_call_count: 0 } }, { code: "provider_submission_uncertain" });
  assert.equal(failure.provider_submission_uncertain, true);
  assert.equal(failure.unresolved_provider_call_count, null);
});


test("new slideshow receipts expose safe per-call models, efforts and tariffs instead of an invented aggregate model",()=>{
  const version="openai-text-2026-09-02";
  const input={artifactKind:"slides",generationReceipt:{artifact_kind:"slides",model:"gpt-5.6-luna",provider:"openai",provider_request_status:"completed",reservation_status:"settled",settled_cost_microusd:6_640,input_ref:"retained-input"},providerSubmissions:{
    first:{clientRequestId:"first",provider:"openai",operation:"planning",status:"completed",providerRequestId:"PRIVATE_PROVIDER_RESPONSE_1",unitId:"planning:0:initial",model:"gpt-5.6-terra",effectiveModel:"gpt-5.6-terra",reasoningEffort:"medium",routingPhase:"composition",pricingVersion:version,usageCostBasis:"measured_usage_published_tariff",costMicrousd:1_840,requestDigest:"PRIVATE_REQUEST_DIGEST",responseRef:"PRIVATE_RESPONSE_REF"},
    second:{clientRequestId:"second",provider:"openai",operation:"planning",status:"completed",providerRequestId:"PRIVATE_PROVIDER_RESPONSE_2",unitId:"planning:0:repair",model:"gpt-5.6-sol",effectiveModel:"gpt-5.6-sol",reasoningEffort:"high",routingPhase:"validation-repair",pricingVersion:version,usageCostBasis:"measured_usage_request_policy_published_tariff",costMicrousd:4_800,preparedPrompt:"PRIVATE_PROMPT",sourceBlockId:"PRIVATE_SOURCE_BLOCK"},
  }};
  const before=JSON.stringify(input),summary=generationExecutionSummary(input);
  assert.equal(summary.model,null);assert.deepEqual(summary.model_ids,["gpt-5.6-terra","gpt-5.6-sol"]);
  assert.deepEqual(summary.requested_reasoning_efforts,["medium","high"]);assert.equal(summary.pricing_version,version);
  assert.deepEqual(summary.provider_call_labels.map(call=>[call.unit_id,call.requested_model,call.effective_model,call.requested_reasoning_effort,call.cost_basis]),[
    ["planning:0:initial","gpt-5.6-terra","gpt-5.6-terra","medium","measured_usage_published_tariff"],
    ["planning:0:repair","gpt-5.6-sol","gpt-5.6-sol","high","measured_usage_request_policy_published_tariff"],
  ]);
  assert.equal(summary.settled_cost_microusd,6_640);assert.doesNotMatch(JSON.stringify(summary),/PRIVATE_/);
  assert.equal(JSON.stringify(input),before,"display projection never mutates settled evidence");
  const redacted={artifactKind:"slides",generationReceipt:summary};
  assert.deepEqual(generationExecutionSummary(redacted),summary);
  const job={jobId:"label-job",documentId:"label-document",kind:"render_document",status:"completed",productionMode:"manual",attemptCount:1,promptTechnique:"prose",members:[],result:redacted};
  const inspection=failedGenerationInputInspection(job,[],{"retained-input":JSON.stringify({job_id:"label-job",document_id:"label-document",artifact_kind:"slides",planner:{provider:"openai",model:"gpt-5.6-luna"}})});
  const receipt=inspection.receipt.generation_receipt;
  assert.equal(receipt.model,null,"a retained old single-model input cannot overwrite a mixed-model result");
  assert.deepEqual(receipt.model_ids,summary.model_ids);assert.deepEqual(receipt.provider_call_labels,summary.provider_call_labels);
  assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_/);

  input.providerSubmissions.second.pricingVersion="openai-text-2026-10-01";
  const changed=presentationProviderLabels(input,true);assert.equal(changed.pricing_version,null);
  assert.deepEqual(changed.pricing_versions,[version,"openai-text-2026-10-01"],"distinct frozen tariffs cannot be reported as one tariff");
  delete input.providerSubmissions.second.pricingVersion;
  assert.equal(presentationProviderLabels(input,true).pricing_version,null,"missing tariff evidence is not replaced by the remaining call's version");
});

test("slideshow label projection keeps pending and unsafe metadata unknown and leaves legacy/media receipts unchanged",()=>{
  const input={artifactKind:"slides",generationReceipt:{artifact_kind:"slides",model:"gpt-5.6-terra"},providerSubmissions:{
    pending:{clientRequestId:"pending",provider:"openai",operation:"planning",status:"pending",model:"gpt-5.6-sol",effectiveModel:"gpt-5.6-sol",reasoningEffort:"high",routingPhase:"validation-repair",pricingVersion:"openai-text-2026-09-02",unitId:"planning:0:repair"},
  }};
  const pending=generationExecutionSummary(input);assert.equal(pending.model,null);assert.deepEqual(pending.model_ids,[]);
  assert.deepEqual(pending.requested_model_ids,["gpt-5.6-sol"]);assert.equal(pending.provider_call_labels[0].effective_model,null);
  assert.equal(pending.unresolved_provider_call_count,1);
  const completed=structuredClone(input);
  Object.assign(completed.providerSubmissions.pending,{status:"completed",providerRequestId:"undisclosed-model-response",inputTokens:200,outputTokens:120,totalTokens:320,costMicrousd:3200});
  delete completed.providerSubmissions.pending.effectiveModel;
  const undisclosed=generationExecutionSummary(completed);
  assert.equal(undisclosed.model,null);assert.deepEqual(undisclosed.model_ids,[]);
  assert.deepEqual(undisclosed.requested_model_ids,["gpt-5.6-sol"]);
  assert.equal(undisclosed.provider_call_labels[0].effective_model,null,"completion does not disclose an omitted response model");
  const unsafe=safePresentationProviderLabels({provider_call_labels:[{unit_id:"PRIVATE_UNIT",status:"completed",requested_model:"PRIVATE_MODEL",effective_model:"PRIVATE_MODEL",requested_reasoning_effort:"PRIVATE_EFFORT",pricing_version:"PRIVATE_TARIFF",cost_basis:"PRIVATE_BASIS",prompt:"PRIVATE_PROMPT"}]});
  assert.doesNotMatch(JSON.stringify(unsafe),/PRIVATE_/);assert.equal(unsafe.model,null);assert.equal(unsafe.pricing_version,null);
  delete input.providerSubmissions.pending.pricingVersion;delete input.providerSubmissions.pending.routingPhase;
  assert.equal(presentationProviderLabels(input),null,"historical unversioned receipts keep their existing labels");
  const legacy=generationExecutionSummary(input);assert.equal(legacy.model,"gpt-5.6-terra");assert.equal(legacy.provider_call_labels,undefined);
  input.providerSubmissions.pending.pricingVersion="openai-text-2026-09-02";input.artifactKind="audio";input.generationReceipt.artifact_kind="audio";input.generationReceipt.model="audio-model";
  const media=generationExecutionSummary(input);assert.equal(media.model,"audio-model");assert.equal(media.provider_call_labels,undefined);
});
