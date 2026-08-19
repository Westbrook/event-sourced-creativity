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
  at(8,"IdeationPreviewCompleted",{generation_id:"draft-1",document_id:"document-1",object_ids:["draft-object"],quality:"low",prompt_technique:"prose",latency_ms:8_000,source_surface:"chat",used_uploaded_reference_pixels:true},"worker:generator"),
  at(9,"GenerationUsageRecorded",{generation_id:"draft-1",document_id:"document-1",quality:"low",cost_microusd:30_000,cost_breakdown_microusd:{text_input_microusd:2_000,text_output_microusd:3_000,image_text_input_microusd:4_000,image_input_microusd:5_000,image_output_microusd:16_000}},"worker:policy"),
  at(10,"IdeationPromoted",{document_id:"document-1",draft_object_id:"draft-object"}),
  at(11,"GenerationRequested",{generation_id:"full-1",document_id:"document-1",quality:"high",source_surface:"editor"}),
  at(12,"ContextCompiled",{generation_id:"full-1",document_id:"document-1",source_block_versions:[{block_id:"block-used"}],quality:"high",source_surface:"editor"},"worker:compiler"),
  at(13,"GenerationCompleted",{generation_id:"full-1",document_id:"document-1",object_ids:["full-object"],quality:"high",prompt_technique:"json",latency_ms:42_000,source_surface:"editor",development_stage_kind:"composition",used_locked_study_pixels:true},"worker:generator"),
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
  assert.equal(report.views.find((row)=>row.id==="operations-analytics")?.visits,1);
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
  for(const phrase of ["Where Forma should improve","How Forma helps creative work","Generation economics","Generation and finalization","Views and working surfaces","Context health","Scope comparison","How these measures are derived"])assert.match(component,new RegExp(phrase));
  for(const selector of [".analytics-improvement",".analytics-benefits",".analytics-economics-grid",".analytics-view-list",".analytics-table-wrap"])assert.match(styles,new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});
