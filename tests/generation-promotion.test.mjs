import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents, generationMix, isDraftOutput } from "../src/model/events.ts";
import { generationPromotionSignals, generationSuccessMetrics } from "../src/model/generation-signals.ts";
import { buildFewShotCorpus, buildVectorIndex } from "../src/model/indexing.ts";
import { buildScoutTrajectory } from "../src/model/scout.ts";
import { tasteMetrics } from "../src/model/taste.ts";

const base={streamId:"s",recordedAt:"2026-08-12T12:00:00.000Z",clientId:"web:test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1};
const event=(sequence,type,payload,actor="user",seconds=sequence)=>({...base,eventId:`e${sequence}`,sequence,type,payload,actor,occurredAt:new Date(Date.parse("2026-08-12T12:00:00.000Z")+seconds*1000).toISOString()});

const evidence=[
  event(1,"ProjectCreated",{project_id:"p",name:"Project"}),
  event(2,"DocumentCreated",{project_id:"p",document_id:"d",title:"Study"}),
  event(3,"BlockCreated",{block_id:"b",document_id:"d",type:"direction",handle:"direction/study",position:"a0",properties:{text:"Quiet confidence"}}),
  event(4,"IdeationPreviewCompleted",{generation_id:"draft-g",document_id:"d",object_id:"draft-o",object_ids:["draft-o"],model_id:"gpt-image-2",quality:"low",purpose:"ideate",source_surface:"chat",media_url:"/draft.png"},"worker:generator"),
  event(5,"IdeationPromoted",{promotion_id:"promotion-1",document_id:"d",draft_event_id:"e4",draft_sequence:4,draft_generation_id:"draft-g",draft_object_id:"draft-o",full_generation_id:"full-g",source_surface:"chat",elapsed_to_intent_ms:42_000,intervening_event_count:0,document_change_count:0,conversation_turn_count:0,context_changed:false,intent_weight:1},"user",46),
  event(6,"GenerationRequested",{generation_id:"full-g",document_id:"d",promotion_id:"promotion-1",quality:"high",purpose:"final"},"user",46),
  event(7,"ContextCompiled",{generation_id:"full-g",compiled_snapshot:{facts:["direction/study"]},source_block_versions:[{block_id:"b",version:1}],promotion_id:"promotion-1"},"worker:compiler",47),
  event(8,"GenerationCompleted",{generation_id:"full-g",document_id:"d",object_ids:["full-o"],model_id:"gpt-image-2",quality:"high",purpose:"final",promotion_id:"promotion-1",reference_preview_event_id:"e4",promoted_from_object_id:"draft-o",media_url:"/full.png"},"worker:generator",52),
];

test("projects drafts and full images into one quality-aware document history",()=>{
  const projection=foldEvents(evidence);const mix=generationMix(projection.outputs);
  assert.deepEqual(mix,{total:2,drafts:1,full:1});assert.equal(projection.outputs[0].id,"full-o");assert.equal(projection.outputs[0].promotedFromId,"draft-o");assert.equal(projection.outputs[1].id,"draft-o");assert.equal(isDraftOutput(projection.outputs[1]),true);
});

test("joins explicit draft intent to full-quality system success",()=>{
  const [signal]=generationPromotionSignals(evidence);assert.equal(signal.status,"completed");assert.equal(signal.intentWeight,1);assert.equal(signal.successWeight,1);assert.equal(signal.elapsedToIntentMs,42_000);assert.deepEqual(signal.evidenceRefs,["e5","e6","e8"]);
  assert.deepEqual(generationSuccessMetrics(evidence),{drafts:1,full:1,promotions:1,completed:1,failed:0,promotedDraftRate:1,promotionSuccessRate:1,medianElapsedToIntentMs:42_000});
});

test("feeds promotion evidence into retrieval, Scout, and Memory without inventing taste",()=>{
  assert.equal(buildVectorIndex(evidence).find((item)=>item.id==="draft-o")?.accepted,true);
  const exemplar=buildFewShotCorpus(evidence).find((item)=>item.exemplarId==="generation:e8");assert.ok(exemplar);assert.ok(exemplar.citations.includes("e5"));
  const scout=buildScoutTrajectory(evidence).find((slice)=>slice.type==="promotion");assert.equal(scout?.confidence,.99);assert.equal(scout?.metrics.success_weight,1);
  const memory=tasteMetrics(evidence);assert.equal(memory.generationPromotions,1);assert.equal(memory.completedGenerationPromotions,1);assert.equal(memory.inferred,0);
});
