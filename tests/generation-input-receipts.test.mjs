import test from "node:test";
import assert from "node:assert/strict";
import { documentGenerationInputInspection, failedGenerationInputInspection } from "../src/model/generation-inputs.ts";

const capturedAt="2026-08-23T12:00:00.000Z";
const snapshotHash="9c2dc2b85561f7fc326c0a5be2ec18243152db15835a84d88b777ba19c361c18";

const generationReceipt=(patch={})=>({
  schema_version:1,
  captured_at:capturedAt,
  artifact_kind:"slides",
  production_mode:"manual",
  provider:"openai",
  model:"gpt-5.6-terra",
  requested_slide_count:12,
  authored_slide_count:12,
  predicted_slide_count:12,
  slide_count_mismatch:false,
  batch_count:1,
  max_repair_call_count:1,
  maximum_provider_call_count:2,
  repair_calls_may_incur_additional_usage:true,
  reservation_microusd:1_000_000,
  settled_cost_microusd:0,
  reservation_status:"active",
  source_transmission_scope:"authorized_document_context",
  source_transmission_status:"not_transmitted",
  provider_request_status:"not_submitted",
  source_fact_count:3,
  source_snapshot_sha256:snapshotHash,
  settings:{item_count:12,audience:"Executive decision-makers",tone:"Preserve authored source facts",presentation_style:"editorial",presentation_fidelity:"strict"},
  input_ref:"actor-private-input-1",
  input_expires_at:"2026-09-23T12:00:00.000Z",
  ...patch,
});

const job=(patch={})=>({
  jobId:"job-executive-1",
  documentId:"document-executive-1",
  kind:"render_document",
  status:"queued",
  sourceSurface:"document",
  requestedSequence:41,
  documentRevision:"rev-executive-1",
  requestKey:"slides:executive:12",
  sourcePreviewId:null,
  productionMode:"manual",
  promptTechnique:"prose",
  promptFanId:null,
  parentJobId:null,
  fanKind:null,
  members:[],
  result:{artifactKind:"slides",generationReceipt:generationReceipt()},
  error:null,
  errorDetail:null,
  moderationPromptRef:null,
  dismissedAt:null,
  attemptCount:0,
  requestedAt:capturedAt,
  startedAt:null,
  completedAt:null,
  notifiedAt:null,
  leaseExpiresAt:null,
  updatedAt:capturedAt,
  stage:"queued",
  progressMessage:"Waiting to generate the authored presentation.",
  ...patch,
});

const privateInput=(patch={})=>({
  schema_version:1,
  job_id:"job-executive-1",
  artifact_kind:"slides",
  document_id:"document-executive-1",
  captured_at:capturedAt,
  request:{item_count:12,requested_slide_count:12,authored_slide_count:12,predicted_slide_count:12,audience:"Executive decision-makers",tone:"Preserve authored source facts",production_mode:"manual",presentation_style:"editorial",presentation_fidelity:"strict",batch_count:1,max_repair_call_count:1,maximum_provider_call_count:2,reservation_microusd:1_000_000},
  document_snapshot:{facts:[{block_id:"restricted-source-block-1",properties:{text:"Exact overall score: 61.125; displayed: 61.13."}}]},
  source_block_versions:[{block_id:"restricted-source-block-1",version:4}],
  planner:{provider:"openai",model:"gpt-5.6-terra",request_status:"not_submitted"},
  source:{scope:"authorized_document_context",status:"not_transmitted",snapshot_sha256:snapshotHash},
  accounting:{reservation_microusd:1_000_000,settled_cost_microusd:0,reservation_is_provider_hard_cap:false,reservation_is_application_hard_cap:true,maximum_authorized_cost_microusd:1_000_000},
  ...patch,
});

const authorizedContent=(input=privateInput())=>({"actor-private-input-1":JSON.stringify(input)});

test("preserves the accepted private receipt when persistence fails before the provider is contacted",()=>{
  const failure=job({
    status:"failed",
    stage:"planning",
    attemptCount:1,
    startedAt:"2026-08-23T12:00:01.000Z",
    completedAt:"2026-08-23T12:00:02.000Z",
    result:{artifactKind:"slides",generationReceipt:generationReceipt({reservation_status:"released",failure_stage:"planning",failure_category:"server",failure_code:"local_persistence_failed"})},
    errorDetail:{code:"local_persistence_failed",category:"server",scope:"unknown",action:"contact_support",message:"Internal event persistence failed.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null},
  });

  const inspection=failedGenerationInputInspection(failure,[],authorizedContent());
  const receipt=inspection.receipt.generation_receipt;

  assert.equal(inspection.title,"Failed generation inputs");
  assert.equal(inspection.outcome,"failed");
  assert.equal(inspection.retained,true);
  assert.equal(receipt.provider,"openai");
  assert.equal(receipt.model,"gpt-5.6-terra");
  assert.equal(receipt.provider_request_status,"not_submitted");
  assert.equal(receipt.provider_contacted,false);
  assert.equal(receipt.source_transmission_status,"not_transmitted");
  assert.equal(receipt.source_transmitted,false);
  assert.equal(receipt.reservation_microusd,1_000_000);
  assert.equal(receipt.settled_cost_microusd,0);
  assert.equal(receipt.reservation_status,"released");
  assert.equal(receipt.reservation_is_provider_hard_cap,false);
  assert.equal(receipt.reservation_is_application_hard_cap,true);
  assert.equal(receipt.maximum_authorized_cost_microusd,1_000_000);
  assert.equal(receipt.actual_provider_call_count,null);
  assert.equal(receipt.failure_stage,"planning");
  assert.equal(receipt.failure_category,"server");
  assert.equal(receipt.failure_code,"local_persistence_failed");
  assert.equal(receipt.authored_slide_count,12);
  assert.equal(receipt.predicted_slide_count,12);
  assert.equal(receipt.maximum_provider_call_count,2);
  assert.equal(receipt.repair_calls_may_incur_additional_usage,true);
  assert.equal(receipt.source_snapshot_sha256,snapshotHash);
  assert.equal(receipt.settings.presentation_style,"editorial");
  assert.equal(receipt.private_input_available,true);
  assert.deepEqual(inspection.receipt.private_input.document_snapshot,privateInput().document_snapshot);
  assert.deepEqual(inspection.receipt.frozen_inputs[0].source_block_versions,privateInput().source_block_versions);
  assert.equal(inspection.receipt.frozen_inputs[0].compile_event_id,null);
  assert.equal(inspection.receipt.technical_error.code,"local_persistence_failed");
  assert.deepEqual(inspection.receipt.request_receipts,[]);
});

test("does not describe metadata as complete private inputs or expose restricted receipt fields",()=>{
  const failure=job({
    status:"failed",
    result:{artifactKind:"slides",generationReceipt:generationReceipt({
      reservation_status:"released",
      document_snapshot:{facts:[{block_id:"leaked-block",properties:{text:"restricted authored source"}}]},
      source_block_versions:[{block_id:"leaked-block",version:99}],
      prompt:"restricted private prompt",
      settings:{item_count:12,presentation_style:"editorial",brand_palette:{accent:"#2244cc",background:"#ffffff",restricted_ref:"private-input-id",unsafe:"javascript:alert(1)"},block_id:"leaked-settings-block"},
    })},
  });

  const inspection=failedGenerationInputInspection(failure,[],{});
  const safeReceipt=inspection.receipt.generation_receipt;
  const serialized=JSON.stringify(inspection.receipt);

  assert.equal(inspection.retained,false);
  assert.equal(inspection.receipt.private_input,null);
  assert.equal(inspection.receipt.frozen_inputs.length,0);
  assert.equal(safeReceipt.private_input_available,false);
  assert.equal(safeReceipt.source_snapshot_sha256,snapshotHash);
  assert.equal(safeReceipt.provider_contacted,false);
  assert.deepEqual(safeReceipt.settings.brand_palette,{accent:"#2244cc",background:"#ffffff"});
  assert.equal("input_ref" in safeReceipt,false);
  assert.equal("document_snapshot" in safeReceipt,false);
  assert.equal("source_block_versions" in safeReceipt,false);
  assert.equal("block_id" in safeReceipt.settings,false);
  assert.doesNotMatch(serialized,/actor-private-input-1|leaked-block|restricted authored source|restricted private prompt|private-input-id|leaked-settings-block/);
  assert.match(inspection.receipt.retention_note,/actor-private frozen input is unavailable/i);
});

test("retains safe audio/visual scene variant settings without exposing private context lineage",()=>{
  const configuration={
    medium:"audio",
    source:"production-path",
    targetFormat:"audio",
    downstreamFormats:["audio"],
    alternateMedium:"visual",
    input_ref:"NEVER_EXPOSE_PRIVATE_SCENE_INPUT",
    document_snapshot:{facts:[{properties:{text:"NEVER_EXPOSE_PRIVATE_SCENE_CONTEXT"}}]},
    context_continuity:{source_block_ids:["NEVER_EXPOSE_PRIVATE_SCENE_BLOCK"]},
  };
  const receipt=generationReceipt({
    artifact_kind:"scene",
    settings:{scene_medium:"audio",scene_configuration:configuration},
  });
  const queued=job({result:{artifactKind:"scene",generationReceipt:receipt}});
  const inspection=documentGenerationInputInspection(queued,[],{});
  const safe=inspection.receipt.generation_receipt;

  assert.equal(safe.settings.scene_medium,"audio");
  assert.deepEqual(safe.settings.scene_configuration,{
    medium:"audio",
    source:"production-path",
    targetFormat:"audio",
    downstreamFormats:["audio"],
    alternateMedium:"visual",
  });
  assert.equal(safe.source_snapshot_sha256,snapshotHash);
  assert.doesNotMatch(JSON.stringify(inspection.receipt),/NEVER_EXPOSE_PRIVATE_SCENE/);
});

test("rejects malformed or contradictory scene variant metadata while preserving valid request fallbacks",()=>{
  const valid={medium:"visual",source:"manual",targetFormat:null,downstreamFormats:[],alternateMedium:"audio"};
  const authorized=privateInput({artifact_kind:"scene",request:{...privateInput().request,scene_medium:"visual",scene_configuration:valid}});
  const queued=job({result:{artifactKind:"scene",generationReceipt:generationReceipt({artifact_kind:"scene",settings:{}})}});
  assert.deepEqual(documentGenerationInputInspection(queued,[],authorizedContent(authorized)).receipt.generation_receipt.settings.scene_configuration,valid);

  for(const invalid of [
    {...valid,alternateMedium:"visual"},
    {...valid,source:"client-supplied-private-context"},
    {...valid,targetFormat:"PRIVATE_UNSAFE_TARGET"},
    {...valid,downstreamFormats:"PRIVATE_UNSAFE_DOWNSTREAM"},
  ]){
    const unsafe=job({result:{artifactKind:"scene",generationReceipt:generationReceipt({artifact_kind:"scene",settings:{scene_medium:"visual",scene_configuration:invalid}})}});
    const safe=documentGenerationInputInspection(unsafe,[],{}).receipt.generation_receipt.settings;
    assert.equal(safe.scene_medium,"visual");
    assert.equal("scene_configuration" in safe,false);
  }
});

test("rejects actor-private content referencing another job or document",()=>{
  for(const foreign of [
    privateInput({job_id:"job-other-creator"}),
    privateInput({document_id:"document-another-project"}),
    privateInput({job_id:"job-other-creator",document_id:"document-another-project"}),
  ]){
    const inspection=documentGenerationInputInspection(job(),[],authorizedContent(foreign));
    assert.equal(inspection.retained,false);
    assert.equal(inspection.receipt.private_input,null);
    assert.equal(inspection.receipt.frozen_inputs.length,0);
    assert.equal(inspection.receipt.generation_receipt.private_input_available,false);
    assert.doesNotMatch(JSON.stringify(inspection.receipt),/restricted-source-block-1|Exact overall score/);
  }
});

test("makes queued 23-slide managed plans, repair exposure, and intentional brand settings inspectable",()=>{
  const managedReceipt=generationReceipt({
    production_mode:"managed",
    requested_slide_count:23,
    authored_slide_count:23,
    predicted_slide_count:23,
    batch_count:3,
    minimum_provider_call_count:3,
    planned_provider_call_count:3,
    max_repair_call_count:3,
    maximum_provider_call_count:6,
    reservation_microusd:3_000_000,
    reservation_status:"estimated",
    settings:{item_count:23,audience:"Enterprise procurement",tone:"Evidence-led",presentation_style:"nocturne",presentation_fidelity:"strict",brand_name:"Forma",font_family:"Helvetica Neue",palette:{accent:"#3662e3",surface:"#101827"}},
  });
  const managedInput=privateInput({
    request:{...privateInput().request,item_count:23,requested_slide_count:23,authored_slide_count:23,predicted_slide_count:23,production_mode:"managed",batch_count:3,max_repair_call_count:3,maximum_provider_call_count:6,reservation_microusd:3_000_000},
    accounting:{reservation_microusd:3_000_000,settled_cost_microusd:0,reservation_is_provider_hard_cap:false},
  });
  const queued=job({productionMode:"managed",result:{artifactKind:"slides",generationReceipt:managedReceipt}});

  const inspection=documentGenerationInputInspection(queued,[],authorizedContent(managedInput));
  const receipt=inspection.receipt.generation_receipt;

  assert.equal(inspection.title,"Generation in progress");
  assert.equal(inspection.outcome,"in_progress");
  assert.equal(inspection.retained,true);
  assert.equal(receipt.production_mode,"managed");
  assert.equal(receipt.requested_slide_count,23);
  assert.equal(receipt.authored_slide_count,23);
  assert.equal(receipt.predicted_slide_count,23);
  assert.equal(receipt.slide_count_mismatch,false);
  assert.equal(receipt.batch_count,3);
  assert.equal(receipt.minimum_provider_call_count,3);
  assert.equal(receipt.planned_provider_call_count,3);
  assert.equal(receipt.max_repair_call_count,3);
  assert.equal(receipt.maximum_provider_call_count,6);
  assert.equal(receipt.actual_provider_call_count,null);
  assert.equal(receipt.actual_slide_count,null);
  assert.equal(receipt.settings.requested_slide_count,23);
  assert.equal(receipt.settings.predicted_slide_count,23);
  assert.equal(receipt.reservation_microusd,3_000_000);
  assert.equal(receipt.reservation_status,"estimated");
  assert.equal(receipt.provider_contacted,false);
  assert.equal(receipt.source_transmitted,false);
  assert.equal(receipt.settings.brand_name,"Forma");
  assert.equal(receipt.settings.font_family,"Helvetica Neue");
  assert.deepEqual(receipt.settings.brand_palette,{accent:"#3662e3",surface:"#101827"});
  assert.match(inspection.receipt.retention_note,/captured when the request was accepted/i);
});

test("reports an in-progress provider submission without mixing another artifact's request",()=>{
  const event=(eventId,documentId,artifactId)=>({eventId,streamId:"stream-1",sequence:43,occurredAt:capturedAt,recordedAt:capturedAt,actor:"user",clientId:"browser",correlationId:"correlation-1",causationId:null,compensatesEventId:null,schemaVersion:1,type:"DocumentRenderRequested",payload:{document_id:documentId,artifact_id:artifactId,artifact_kind:"slides",item_count:12}});
  const running=job({
    status:"running",
    attemptCount:1,
    stage:"planning",
    result:{artifactKind:"slides",artifactId:"artifact-executive-1",generationReceipt:generationReceipt({provider_request_status:"submitted",source_transmission_status:"transmitted",reservation_status:"executing"})},
  });

  const inspection=documentGenerationInputInspection(running,[
    event("request-authorized","document-executive-1","artifact-executive-1"),
    event("request-other-artifact","document-executive-1","artifact-other-1"),
    event("request-other-document","document-other-1","artifact-executive-1"),
  ],authorizedContent());

  assert.equal(inspection.outcome,"in_progress");
  assert.equal(inspection.receipt.generation_receipt.provider_contacted,true);
  assert.equal(inspection.receipt.generation_receipt.source_transmitted,true);
  assert.equal(inspection.receipt.generation_receipt.reservation_status,"executing");
  assert.equal(inspection.receipt.generation_receipt.actual_provider_call_count,null);
  assert.deepEqual(inspection.receipt.request_receipts.map((request)=>request.event_id),["request-authorized"]);
  assert.equal(inspection.receipt.technical_error,null);
});

test("preserves uncertainty when submission or transmission cannot be established",()=>{
  const unknownReceipt=generationReceipt({provider_request_status:"submission_unknown",source_transmission_status:"unknown",reservation_status:"unknown",settled_cost_microusd:undefined});
  const failure=job({status:"failed",result:{artifactKind:"slides",generationReceipt:unknownReceipt}});

  const inspection=failedGenerationInputInspection(failure,[],authorizedContent());
  const receipt=inspection.receipt.generation_receipt;

  assert.equal(receipt.provider_request_status,"submission_unknown");
  assert.equal(receipt.provider_contacted,null);
  assert.equal(receipt.source_transmission_status,"unknown");
  assert.equal(receipt.source_transmitted,null);
  assert.equal(receipt.reservation_status,"unknown");
  assert.equal(receipt.settled_cost_microusd,null);
});

test("derives an authored-versus-planned mismatch without inventing provider or spend details",()=>{
  const mismatch=generationReceipt({provider:undefined,model:undefined,authored_slide_count:12,predicted_slide_count:10,slide_count_mismatch:undefined,settled_cost_microusd:undefined,provider_request_status:"unknown",source_transmission_status:"unknown"});
  const inspection=documentGenerationInputInspection(job({result:{artifactKind:"slides",generationReceipt:mismatch}}),[],{});
  const receipt=inspection.receipt.generation_receipt;

  assert.equal(receipt.authored_slide_count,12);
  assert.equal(receipt.predicted_slide_count,10);
  assert.equal(receipt.slide_count_mismatch,true);
  assert.equal(receipt.provider,null);
  assert.equal(receipt.model,null);
  assert.equal(receipt.provider_contacted,null);
  assert.equal(receipt.source_transmitted,null);
  assert.equal(receipt.settled_cost_microusd,null);
});

test("keeps a failed two-request presentation truthful after source transmission and final settlement", () => {
  const failure = job({
    status: "failed",
    stage: "source-fidelity-validation",
    attemptCount: 1,
    completedAt: "2026-08-24T11:03:25.928Z",
    result: {
      artifactKind: "slides",
      generationReceipt: generationReceipt({
        provider_request_status: "submitted",
        source_transmission_status: "transmitted",
        reservation_status: "settled",
        settled_cost_microusd: 198_586,
        actual_provider_call_count: 2,
        failure_stage: "source_fidelity_validation",
        failure_code: "source_fidelity_validation_failed",
      }),
    },
    errorDetail: {
      code: "source_fidelity_validation_failed",
      category: "provider",
      scope: "request",
      action: "edit_request",
      message: "The completed presentation failed source-fidelity validation.",
      retryable: false,
      retryAfterMs: null,
      requestId: null,
      httpStatus: 502,
    },
  });

  const inspection = failedGenerationInputInspection(failure, [], authorizedContent());
  const receipt = inspection.receipt.generation_receipt;
  assert.equal(inspection.outcome, "failed");
  assert.equal(receipt.provider_request_status, "submitted");
  assert.equal(receipt.provider_contacted, true);
  assert.equal(receipt.source_transmission_status, "transmitted");
  assert.equal(receipt.source_transmitted, true);
  assert.equal(receipt.actual_provider_call_count, 2);
  assert.equal(receipt.maximum_provider_call_count, 2);
  assert.equal(receipt.reservation_microusd, 1_000_000);
  assert.equal(receipt.settled_cost_microusd, 198_586);
  assert.equal(receipt.reservation_status, "settled");
  assert.equal(receipt.failure_code, "source_fidelity_validation_failed");
});

test("keeps completed inspection truthful after provider settlement",()=>{
  const complete=job({status:"completed",stage:"completed",attemptCount:1,completedAt:"2026-08-23T12:02:00.000Z",result:{artifactKind:"slides",generationReceipt:generationReceipt({provider_request_status:"completed",source_transmission_status:"transmitted",reservation_status:"settled",settled_cost_microusd:52_952,actual_provider_call_count:1,actual_slide_count:12})}});

  const inspection=documentGenerationInputInspection(complete,[],authorizedContent());

  assert.equal(inspection.outcome,"completed");
  assert.equal(inspection.title,"Completed generation inputs");
  assert.equal(inspection.receipt.generation_receipt.provider_contacted,true);
  assert.equal(inspection.receipt.generation_receipt.source_transmitted,true);
  assert.equal(inspection.receipt.generation_receipt.reservation_status,"settled");
  assert.equal(inspection.receipt.generation_receipt.settled_cost_microusd,52_952);
  assert.equal(inspection.receipt.generation_receipt.actual_provider_call_count,1);
  assert.equal(inspection.receipt.generation_receipt.actual_slide_count,12);
});


test("restored requests use only the selected attempt's authorized frozen settings",async()=>{
  const {restoreDocumentRenderSettings,captureDocumentRenderSettings}=await import("../src/model/document-render-request.ts");
  const job={jobId:"restore-selected",documentId:"source",kind:"render_document",result:{artifactKind:"slides",generationReceipt:{input_ref:"restore-input"}}};
  const request={audience:"Selected slide audience",tone:"x".repeat(121),production_mode:"managed",requested_slide_count:6,presentation_style:"field-notes",presentation_fidelity:"faithful"};
  const retained={job_id:job.jobId,document_id:job.documentId,artifact_kind:"slides",request};
  const content={"restore-input":JSON.stringify(retained),"other-input":JSON.stringify({...retained,job_id:"other",request:{...request,tone:"Podcast"}})};
  const result=restoreDocumentRenderSettings(job,content);
  assert.equal(result.tone.length,121,"historical invalid values remain editable instead of silently clipped");assert.equal(result.audience,request.audience);assert.equal(result.itemCount,6);assert.equal(result.productionMode,"managed");assert.equal(result.presentationStyle,"field-notes");
  for(const patch of [{job_id:"other"},{document_id:"other"},{artifact_kind:"audio"}])assert.equal(restoreDocumentRenderSettings(job,{"restore-input":JSON.stringify({...retained,...patch})}),null);
  assert.equal(restoreDocumentRenderSettings(job,{}),null);assert.equal(restoreDocumentRenderSettings(job,{"restore-input":"{}"}),null);
  assert.equal(restoreDocumentRenderSettings(job,{"restore-input":JSON.stringify({...retained,request:{...request,tone:{}}})}),null);
  const captured=captureDocumentRenderSettings({artifactKind:"slides",productionMode:"manual",itemCount:6,audience:"Audience",tone:"Tone",presentationStyle:"editorial",presentationFidelity:"creative",providerJobId:"DO_NOT_COPY",snapshot:{private:"DO_NOT_COPY"},paidRetryConfirmed:true,costReservationId:"DO_NOT_COPY"});
  assert.doesNotMatch(JSON.stringify(captured),/DO_NOT_COPY|paidRetryConfirmed/);
  const current=restoreDocumentRenderSettings(job,{"restore-input":JSON.stringify({...retained,request:{editable_settings:captured}})});
  assert.equal(current.tone,"Tone");assert.equal(current.presentationFidelity,"creative");
  const model3dJob={...job,result:{...job.result,artifactKind:"model3d"}};
  const model3dCaptured=captureDocumentRenderSettings({artifactKind:"model3d",itemCount:1,productionMode:"manual",model3dPrompt:"  Exact private prompt  ",model3dSettings:{seed:42},model3dReferenceBlockIds:["view-b","view-a"]});
  const model3dInput={...retained,artifact_kind:"model3d",request:{editable_settings:model3dCaptured}};
  assert.equal(restoreDocumentRenderSettings(model3dJob,{"restore-input":JSON.stringify(model3dInput)}),null,"unsupported 3D restoration must not substitute current settings for missing frozen controls");
});

test("video resolution remains in the exact private editable request and rejects unsupported restoration", async () => {
  const { captureDocumentRenderSettings, restoreDocumentRenderSettings } = await import("../src/model/document-render-request.ts");
  const selected = { jobId: "resolution-job", documentId: "resolution-document", kind: "render_document", result: { artifactKind: "video", generationReceipt: { input_ref: "resolution-input" } } };
  const restore = resolution => {
    const captured = captureDocumentRenderSettings({ artifactKind: "video", videoSeconds: 4, videoAudioMode: "silent", ...(resolution === undefined ? {} : { videoResolution: resolution }) });
    const retained = { job_id: selected.jobId, document_id: selected.documentId, artifact_kind: "video", request: { editable_settings: captured } };
    return restoreDocumentRenderSettings(selected, { "resolution-input": JSON.stringify(retained) });
  };
  assert.equal(restore("480p").videoResolution, "480p");
  assert.equal(restore("720p").videoResolution, "720p");
  assert.equal(restore(undefined).videoResolution, undefined);
  for (const invalid of ["1080p", "480P", " 480p", 480, null, {}]) assert.equal(restore(invalid), null);
});
