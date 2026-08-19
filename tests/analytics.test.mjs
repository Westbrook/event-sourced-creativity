import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAnalyticsReport } from "../src/model/analytics.ts";

const at=(sequence,type,payload={},actor="user")=>({eventId:`event-${sequence}`,streamId:"creative:user-1",sequence,occurredAt:`2026-08-${String(10+Math.floor(sequence/20)).padStart(2,"0")}T12:${String(sequence%60).padStart(2,"0")}:00.000Z`,recordedAt:`2026-08-10T12:00:00.000Z`,actor,clientId:"test",correlationId:`correlation-${sequence}`,causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});

const observed=[
  at(1,"ProjectCreated",{project_id:"project-1",name:"Campaign"}),
  at(2,"DocumentCreated",{project_id:"project-1",document_id:"document-1",title:"Hero"}),
  at(3,"BlockCreated",{project_id:"project-1",document_id:"document-1",block_id:"block-used",type:"subject",properties:{text:"Lead runner",subtype:"person",weight:.9}}),
  at(4,"BlockCreated",{project_id:"project-1",document_id:"document-1",block_id:"block-unused",type:"material",properties:{text:"Canvas"}}),
  at(5,"DocumentViewVisited",{project_id:"project-1",document_id:"document-1",view:"chat",focused:false}),
  at(6,"GenerationRequested",{generation_id:"draft-1",document_id:"document-1",quality:"low",source_surface:"chat"}),
  at(7,"ContextCompiled",{generation_id:"draft-1",document_id:"document-1",source_block_versions:[{block_id:"block-used"}],quality:"low",source_surface:"chat"},"worker:compiler"),
  at(8,"IdeationPreviewCompleted",{generation_id:"draft-1",document_id:"document-1",object_ids:["draft-object"],media_url:"/api/media/draft-object.png",quality:"low",prompt_technique:"prose",latency_ms:8_000,source_surface:"chat",used_uploaded_reference_pixels:true},"worker:generator"),
  at(9,"GenerationUsageRecorded",{generation_id:"draft-1",document_id:"document-1",quality:"low",cost_microusd:30_000,cost_breakdown_microusd:{text_input_microusd:2_000,text_output_microusd:3_000,image_text_input_microusd:4_000,image_input_microusd:5_000,image_output_microusd:16_000}},"worker:policy"),
  at(10,"IdeationPromoted",{document_id:"document-1",draft_object_id:"draft-object"}),
  at(11,"GenerationRequested",{generation_id:"full-1",document_id:"document-1",quality:"high",source_surface:"editor"}),
  at(12,"ContextCompiled",{generation_id:"full-1",document_id:"document-1",source_block_versions:[{block_id:"block-used"}],quality:"high",source_surface:"editor"},"worker:compiler"),
  at(13,"GenerationCompleted",{generation_id:"full-1",document_id:"document-1",object_ids:["full-object"],media_url:"/api/media/full-object.png",quality:"high",prompt_technique:"json",latency_ms:42_000,source_surface:"editor",development_stage_kind:"composition",used_locked_study_pixels:true},"worker:generator"),
  at(14,"GenerationUsageRecorded",{generation_id:"full-1",document_id:"document-1",quality:"high",cost_microusd:120_000,cost_breakdown_microusd:{text_input_microusd:5_000,text_output_microusd:10_000,image_text_input_microusd:10_000,image_input_microusd:20_000,image_output_microusd:75_000}},"worker:policy"),
  at(15,"ObjectPinned",{object_id:"full-object",source_surface:"editor"}),
  at(16,"PromptTechniquePreferred",{document_id:"document-1",prompt_technique:"json"}),
  at(17,"ReferenceIngested",{document_id:"document-1",reference_id:"reference-1",source_type:"upload"}),
  at(18,"GenerationFailed",{generation_id:"failed-1",document_id:"document-1",quality:"high",error_class:"provider"},"worker:generator"),
  at(19,"ApplicationViewVisited",{application:"operations",surface:"operations-analytics",route_family:"operations-analytics"}),
];

test("derives improvement-first analytics, creative benefits, costs, timing, and scoped counts from events",()=>{
  const report=buildAnalyticsReport([{streamId:"creative:user-1",userId:"user-1",userName:"Ari",organizationId:"forma",organizationName:"Forma workspace",fictional:false,events:observed}],{rangeDays:30,now:Date.parse("2026-08-18T12:00:00.000Z")});
  assert.equal(report.totals.events,19);assert.equal(report.totals.projects,1);assert.equal(report.totals.documents,1);assert.equal(report.totals.generations,2);assert.equal(report.totals.uploads,1);assert.equal(report.totals.costMicrousd,150_000);
  assert.deepEqual(report.generations.quality,{low:1,medium:0,high:1});assert.equal(report.generations.techniques.prose,1);assert.equal(report.generations.techniques.json,1);assert.equal(report.generations.draftPromotions,1);assert.equal(report.generations.studyCompositions,1);assert.ok(report.generations.finalizationPreference.json>=1);
  assert.equal(report.cost.byInputType.referenceImageInput,25_000);assert.equal(report.cost.byQuality.low,30_000);assert.equal(report.cost.byQuality.high,120_000);assert.equal(report.source.exactCostReceipts,2);assert.equal(report.source.estimatedCostReceipts,0);
  assert.equal(report.blocks.active,2);assert.equal(report.blocks.used,1);assert.equal(report.blocks.unused,1);assert.equal(report.blocks.complete,1);assert.equal(report.dimensions.document[0].generations,2);assert.equal(report.dimensions.project[0].documents,1);
  assert.equal(report.timing.medianDraftMs,8_000);assert.equal(report.timing.medianFullMs,42_000);assert.ok(report.improvement.some((item)=>item.key==="generation-failures"));assert.ok(report.improvement.some((item)=>item.key==="unused-context"));assert.ok(report.benefits.some((item)=>item.key==="draft-promotion"));assert.ok(report.benefits.some((item)=>item.key==="study-composition"));
  const failureFinding=report.improvement.find((item)=>item.key==="generation-failures");const unusedFinding=report.improvement.find((item)=>item.key==="unused-context");const latencyFinding=report.improvement.find((item)=>item.key==="tail-latency");const costFinding=report.improvement.find((item)=>item.key==="cost-per-outcome");
  assert.equal(failureFinding?.evidence?.[0].status,"Terminal failure");assert.equal(failureFinding?.evidence?.[0].route,"/document/document-1/hero");assert.equal(unusedFinding?.evidence?.[0].title,"block-unused");assert.equal(unusedFinding?.evidence?.[0].facts.find((fact)=>fact.label==="Type")?.value,"material");assert.equal(latencyFinding?.evidence?.[0].media[0].url,"/api/media/full-object.png");assert.equal(costFinding?.evidence?.[0].facts.find((fact)=>fact.label==="Outcome")?.value,"Retained");
  assert.equal(report.reliability.terminalFailures,1);assert.equal(report.reliability.byCategory[0].id,"provider");assert.deepEqual(report.review,{generationSets:2,retained:1,progressed:1,reviewed:0,dismissed:0,needsDecision:0,decisionRate:100});
  assert.equal(report.views.find((row)=>row.id==="operations-analytics")?.visits,1);
});

test("keeps attention, slow-generation inputs and outputs, unresolved work, and cost cases inspectable",()=>{
  const events=[
    at(1,"ProjectCreated",{project_id:"project-1",name:"Campaign"}),
    at(2,"DocumentCreated",{project_id:"project-1",document_id:"document-1",title:"Launch Study"}),
    at(3,"BlockCreated",{project_id:"project-1",document_id:"document-1",block_id:"subject-1",type:"subject",handle:"Hero figure",properties:{text:"A runner at the starting line",authority:"authored"}}),
    at(4,"GenerationRequested",{generation_id:"slow-1",document_id:"document-1",quality:"high",source_surface:"guided"}),
    at(5,"ContextCompiled",{generation_id:"slow-1",document_id:"document-1",source_block_versions:[{block_id:"subject-1"}],reference_input_count:1,quality:"high",prompt_technique:"bullets",source_surface:"guided"},"worker:compiler"),
    at(6,"GenerationCompleted",{generation_id:"slow-1",document_id:"document-1",object_ids:["slow-object"],media_url:"/api/media/slow-object.png",quality:"high",prompt_technique:"bullets",latency_ms:65_000,source_surface:"guided"},"worker:generator"),
    at(7,"GenerationUsageRecorded",{generation_id:"slow-1",document_id:"document-1",quality:"high",cost_microusd:250_000,cost_breakdown_microusd:{text_input_microusd:15_000,text_output_microusd:20_000,image_text_input_microusd:25_000,image_input_microusd:40_000,image_output_microusd:150_000}},"worker:policy"),
    at(8,"AttentionEpisodeObserved",{episode_id:"episode-1",document_id:"document-1",context:"writing-a-direction",active_ms:48_000,idle_ms:12_000,visible_refs:["subject-1","slow-object"],terminal_type:"generation_requested",terminal_ref:"slow-1",outcome_weight:.35,friction_score:.72,source_surface:"guided"}),
  ];
  const report=buildAnalyticsReport([{streamId:"creative:user-1",userId:"user-1",userName:"Ari",organizationId:"forma",organizationName:"Forma workspace",fictional:false,events}],{rangeDays:30,now:Date.parse("2026-08-18T12:00:00.000Z")});
  const attention=report.improvement.find((item)=>item.key==="view-friction")?.evidence?.[0];const latency=report.improvement.find((item)=>item.key==="tail-latency")?.evidence?.[0];const decision=report.improvement.find((item)=>item.key==="unretained-output")?.evidence?.[0];const cost=report.improvement.find((item)=>item.key==="cost-per-outcome")?.evidence?.[0];
  assert.equal(attention?.status,"Friction 72%");assert.match(attention?.detail??"",/availability, not proof of intent/);assert.equal(attention?.facts.find((fact)=>fact.label==="Visible content")?.value,"subject-1, slow-object");
  assert.match(latency?.detail??"",/Hero figure/);assert.equal(latency?.media[0].url,"/api/media/slow-object.png");assert.equal(decision?.status,"Needs a decision");assert.equal(decision?.media[0].url,"/api/media/slow-object.png");assert.equal(cost?.status,"Needs a decision");assert.match(report.improvement.find((item)=>item.key==="cost-per-outcome")?.metric??"",/no retained outcome/);
});

test("separates prompt-fan review, unique terminal failures, retries, cancellations, and administrative stops",()=>{
  const events=[
    at(1,"ProjectCreated",{project_id:"project-1",name:"Campaign"}),
    at(2,"DocumentCreated",{project_id:"project-1",document_id:"document-1",title:"Hero"}),
    at(3,"GenerationRequested",{generation_id:"fan-1",document_id:"document-1",quality:"high",source_surface:"chat"}),
    at(4,"GenerationCompleted",{generation_id:"fan-1",prompt_fan_id:"prompt-fan-1",document_id:"document-1",object_ids:["fan-a","fan-b","fan-c","fan-d"],quality:"high",prompt_technique:"prose",source_surface:"chat"},"worker:generator"),
    at(5,"ComparisonOpened",{object_ids:["fan-a","fan-b","fan-c","fan-d"],source_surface:"chat"}),
    at(6,"JobAttemptInterrupted",{job_id:"retry-job",document_id:"document-1",reason:"execution_interrupted_retrying",source_surface:"chat"},"worker:scheduler"),
    at(7,"JobCanceled",{job_id:"canceled-job",document_id:"document-1",source_surface:"chat"},"worker:scheduler"),
    at(8,"JobForceFailed",{job_id:"admin-job",document_id:"document-1",source_surface:"operations"},"worker:scheduler"),
    at(9,"GenerationFailed",{generation_id:"failed-quota",document_id:"document-1",error_class:"No credits remaining",source_surface:"editor"},"worker:generator"),
    at(10,"GenerationFailed",{generation_id:"failed-quota",document_id:"document-1",error_class:"No credits remaining",source_surface:"editor"},"worker:generator"),
  ];
  const report=buildAnalyticsReport([{streamId:"creative:user-1",userId:"user-1",userName:"Ari",organizationId:"forma",organizationName:"Forma workspace",fictional:false,events}],{rangeDays:30,now:Date.parse("2026-08-18T12:00:00.000Z")});
  assert.equal(report.totals.generations,1);assert.equal(report.totals.generationSets,1);assert.equal(report.review.reviewed,1);assert.equal(report.review.needsDecision,0);
  assert.equal(report.reliability.terminalFailures,1);assert.equal(report.reliability.interruptedAttempts,1);assert.equal(report.reliability.retryingInterruptions,1);assert.equal(report.reliability.userCanceled,1);assert.equal(report.reliability.administrativeStops,1);assert.deepEqual(report.reliability.byCategory,[{id:"quota",label:"Account capacity or billing",count:1}]);
  assert.ok(!report.improvement.some((item)=>item.key==="unretained-output"));
});

test("keeps fictional actual-data mock accounts out of product analytics unless explicitly requested",()=>{
  const fictional={streamId:"creative:fictional",userId:"fictional",userName:"Mock creator",organizationId:"forma",organizationName:"Forma workspace",fictional:true,events:observed.map((event)=>({...event,eventId:`mock-${event.eventId}`,streamId:"creative:fictional"}))};
  const base={streamId:"creative:user-1",userId:"user-1",userName:"Ari",organizationId:"forma",organizationName:"Forma workspace",fictional:false,events:observed};
  const observedOnly=buildAnalyticsReport([base,fictional],{rangeDays:30,now:Date.parse("2026-08-18T12:00:00.000Z")});const withMocks=buildAnalyticsReport([base,fictional],{rangeDays:30,includeSynthetic:true,now:Date.parse("2026-08-18T12:00:00.000Z")});
  assert.equal(observedOnly.totals.events,19);assert.equal(observedOnly.totals.users,1);assert.equal(withMocks.totals.events,38);assert.equal(withMocks.totals.users,2);assert.ok(withMocks.dimensions.user.some((row)=>row.fictional));
});

test("ships analytics as an admin-only, server-first Operations surface",async()=>{
  const [component,api,worker,applications,navigation,styles]=await Promise.all([
    readFile(new URL("../src/components/forma-analytics.ts",import.meta.url),"utf8"),readFile(new URL("../worker/analytics-api.ts",import.meta.url),"utf8"),readFile(new URL("../worker/index.ts",import.meta.url),"utf8"),readFile(new URL("../src/platform/applications.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/area-navigation.ts",import.meta.url),"utf8"),readFile(new URL("../src/design-system.css",import.meta.url),"utf8"),
  ]);
  assert.match(api,/requireUser\(request,env,"admin",\{account:"principal"\}\)/);assert.match(api,/MAX_ANALYTICS_EVENTS/);assert.match(api,/includeSynthetic/);assert.match(worker,/\/api\/analytics/);assert.match(applications,/\/operations\/analytics/);assert.match(navigation,/Find product improvements and creative outcome evidence/);
  for(const phrase of ["Where Forma should improve","Generation reliability","Comparison and next-step funnel","How Forma helps creative work","Generation economics","Generation and finalization","Views and working surfaces","Context health","Scope comparison","How these measures are derived"])assert.match(component,new RegExp(phrase));
  assert.match(component,/Inspect referenced cases/);assert.match(component,/Open in its document/);assert.match(component,/analytics-evidence-media/);
  for(const selector of [".analytics-improvement",".analytics-evidence",".analytics-evidence-item",".analytics-evidence-media",".analytics-reliability-grid",".analytics-review-list",".analytics-benefits",".analytics-economics-grid",".analytics-view-list",".analytics-table-wrap"])assert.match(styles,new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});
