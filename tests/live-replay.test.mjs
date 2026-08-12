import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BLOCK_TYPES } from "../src/model/block-types.ts";
import { buildLiveReplayEvents, replayCoverage } from "../src/model/live-replay.ts";
import { REPLAY_CAPABILITIES, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { foldEvents } from "../src/model/events.ts";

const plan={
  title:"Provider-backed nocturne",summary:"A complete synthetic interaction populated with specific creative decisions.",user_goal:"Create a warm architectural nocturne with a quiet focal portrait.",project_name:"Night editorial",document_title:"Window study",
  reference:{label:"Amber window",description:"A tall window crossing a shadowed plaster room.",mood:"Quiet expectancy",composition:"Asymmetric vertical frame",materials:"Plaster, linen, aged brass",lighting:"Warm lateral window light",spatial:"Portrait on the right with open space on the left",palette:["#171c22","#b96f42","#e8d7bd","#58636b"]},
  chat:{user_message:"Keep the portrait on the right and make the room feel calmer.",assistant_reply:"I’ll protect the open left side, soften the room, and keep the portrait warm.",resolved_change:"Localized the subject and reduced environmental contrast."},
  blocks:BLOCK_TYPES.map((definition,index)=>({type:definition.type,subtype:definition.subtypes[0],label:`${definition.label} decision`,instruction:`Use a specific ${definition.label.toLowerCase()} decision for the nocturne.`,intent:definition.type==="exclusion"?"avoid":index%7===0?"prefer":"include",applies_to:["document","left","right","top","bottom","foreground","background"][index%7],weight:.75})),
  draft:{title:"Quiet window draft",rationale:"Tests the placement quickly.",scene:"A quiet figure beside an amber window.",palette:["#171c22","#b96f42","#e8d7bd"],next_moves:["Protect negative space","Refine fabric texture"]},
  final:{title:"Amber threshold",rationale:"Refines the approved draft while preserving its composition.",scene:"A polished editorial portrait beside an amber window.",palette:["#171c22","#b96f42","#e8d7bd","#58636b"],next_moves:["Compare","Export"]},
  critique:{axis:"composition",polarity:"positive",value:"protected negative space",note:"The right-side portrait leaves the intended breathing room."},collection:{name:"Warm nocturnes",reason:"Keep the strongest low-light studies together."},memory:{preference:"Favor restrained amber light over saturated orange.",resurface_condition:"After three new nocturne generations."},
};

test("builds one reusable provider-backed fixture across the complete recent capability surface",()=>{
  const events=buildLiveReplayEvents(plan,{previewMediaUrl:"/api/media/private-preview",finalMediaUrl:"/api/media/private-final",previewGenerationId:"preview-1",finalGenerationId:"final-1",plannerModel:"planner",imageModel:"gpt-image-2",previewLatencyMs:1200,finalLatencyMs:4200,createdAt:"2026-08-12T12:00:00.000Z"},"saved-1");
  const coverage=replayCoverage(events);assert.equal(coverage.eventTypes,SCENARIO_EVENT_TYPES.length);assert.equal(coverage.blockTypes,BLOCK_TYPES.length);assert.equal(coverage.allBlockTypes,true);assert.ok(REPLAY_CAPABILITIES.length>=12);
  for(const type of ["ChatMessageSent","AssistantReasoned","IdeationPreviewCompleted","IdeationPromoted","GenerationCompleted","AttentionEpisodeObserved","ContextCompiled","ExtractionCompleted","TasteModelVersioned","ScoutBudgetExhausted"])assert.ok(events.some((event)=>event.type===type),type);
  const preview=events.find((event)=>event.type==="IdeationPreviewCompleted");const final=events.find((event)=>event.type==="GenerationCompleted"&&event.actor==="worker:generator");
  assert.equal(preview.payload.media_url,"/api/media/private-preview");assert.equal(preview.payload.quality,"low");assert.equal(final.payload.media_url,"/api/media/private-final");assert.equal(final.payload.quality,"high");assert.equal(final.payload.promoted_from_object_id,"draft-saved-1");
  assert.equal(events.every((event,index)=>event.sequence===index+1&&event.streamId==="replay-session:saved-1"),true);assert.doesNotThrow(()=>foldEvents(events));
});

test("requires a direct one-use paid approval and stores provider-backed fixtures for reuse",async()=>{
  const [api,admin,runtime,adapter]=await Promise.all([
    readFile(new URL("../worker/replay-sessions-api.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/forma-admin-events.ts",import.meta.url),"utf8"),readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8"),readFile(new URL("../worker/openai-adapter.ts",import.meta.url),"utf8"),
  ]);
  assert.match(api,/requireUser\(request,env,"admin"\)/);assert.match(api,/I know what I'm doing/);assert.match(api,/consumed_at IS NULL AND expires_at>/);assert.match(api,/x-forma-automation/);assert.match(api,/direct-user/);assert.match(api,/reserveBudget/);assert.match(api,/generateLiveReplayPlan/);assert.match(api,/quality:"low"/);assert.match(api,/quality:"high"/);assert.match(api,/reference:\{bytes:preview\.bytes/);assert.match(api,/events_json/);assert.match(api,/preview_media_url/);assert.match(api,/final_media_url/);
  assert.match(admin,/event\.isTrusted/);assert.match(admin,/navigator\.userActivation/);assert.match(admin,/Generate actual-data mock/);assert.match(admin,/not being initiated by an agent or test/);assert.match(admin,/Opening or exporting the mock later does not spend again/);assert.match(admin,/actual-replay-dialog/);assert.match(admin,/closedby="any"/);
  assert.match(runtime,/CREATE TABLE IF NOT EXISTS replay_approvals/);assert.match(runtime,/CREATE TABLE IF NOT EXISTS replay_sessions/);assert.match(adapter,/live_replay_plan/);assert.match(adapter,/required_block_types/);
});
