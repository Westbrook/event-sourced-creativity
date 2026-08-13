import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BLOCK_TYPES } from "../src/model/block-types.ts";
import { buildLiveReplayEvents, replayCoverage } from "../src/model/live-replay.ts";
import { buildComprehensiveScenario, REPLAY_CAPABILITIES, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { foldEvents } from "../src/model/events.ts";

const plan={
  title:"Provider-backed nocturne",summary:"A complete synthetic interaction populated with specific creative decisions.",user_goal:"Create a warm architectural nocturne with a quiet focal portrait.",project_name:"Night editorial",document_title:"Window study",
  reference:{label:"Amber window",description:"A tall window crossing a shadowed plaster room.",mood:"Quiet expectancy",composition:"Asymmetric vertical frame",materials:"Plaster, linen, aged brass",lighting:"Warm lateral window light",spatial:"Portrait on the right with open space on the left",palette:["#171c22","#b96f42","#e8d7bd","#58636b"]},
  chat_turns:[
    {user_message:"Keep the portrait on the right and make the room feel calmer.",assistant_reply:"I’ll protect the open left side, soften the room, and keep the portrait warm.",resolved_change:"Localized the subject and reduced environmental contrast.",live_preview:true},
    {user_message:"Make the linen cooler, but do not render yet.",assistant_reply:"I’ve cooled the linen and held the preview.",resolved_change:"Changed the material temperature without generating.",live_preview:false},
    {user_message:"Now make the brass feel older.",assistant_reply:"The brass now carries restrained age and wear.",resolved_change:"Refined the material finish.",live_preview:false},
  ],
  blocks:BLOCK_TYPES.map((definition,index)=>({type:definition.type,subtype:definition.subtypes[0],label:`${definition.label} decision`,instruction:`Use a specific ${definition.label.toLowerCase()} decision for the nocturne.`,intent:definition.type==="exclusion"?"avoid":index%7===0?"prefer":"include",applies_to:["document","left","right","top","bottom","foreground","background"][index%7],spatial_method:["document","region","aabb","subject","path"][index%5],weight:.75})),
  draft:{title:"Quiet window draft",rationale:"Tests the placement quickly.",scene:"A quiet figure beside an amber window.",palette:["#171c22","#b96f42","#e8d7bd"],next_moves:["Protect negative space","Refine fabric texture"]},
  final:{title:"Amber threshold",rationale:"Refines the approved draft while preserving its composition.",scene:"A polished editorial portrait beside an amber window.",palette:["#171c22","#b96f42","#e8d7bd","#58636b"],next_moves:["Compare","Export"]},
  critique:{axis:"composition",polarity:"positive",value:"protected negative space",note:"The right-side portrait leaves the intended breathing room."},collection:{name:"Warm nocturnes",reason:"Keep the strongest low-light studies together."},memory:{preference:"Favor restrained amber light over saturated orange.",resurface_condition:"After three new nocturne generations."},
  fan_review:{preferred_technique:"bullets",promoted_techniques:["bullets","json"],comparison_note:"Bullets held the local constraints most clearly.",reasons:{prose:"Natural visual flow.",bullets:"Local instructions remained distinct.",json:"Spatial fields stayed exact.",xml:"Relationships stayed legible."}},
  friction:{stuck_moment:"The editor felt too dense after the third decision.",recovery_action:"Moved to Chat and batched two refinements with Live preview off.",view:"editor"},
};

test("builds one reusable provider-backed fixture across the complete recent capability surface",()=>{
  const fanOutputs=["prose","bullets","json","xml"].map((technique,index)=>({technique,mediaUrl:`/api/media/private-${technique}`,generationId:`final-${technique}`,objectId:`object-${technique}`,latencyMs:4200+index*100,model:"gpt-image-2"}));
  const events=buildLiveReplayEvents(plan,{referenceMediaUrl:"/api/media/private-reference",previewMediaUrl:"/api/media/private-preview",referenceGenerationId:"reference-1",previewGenerationId:"preview-1",fanOutputs,plannerModel:"planner",imageModel:"gpt-image-2",referenceLatencyMs:900,previewLatencyMs:1200,createdAt:"2026-08-12T12:00:00.000Z"},"saved-1");
  const coverage=replayCoverage(events);assert.equal(coverage.eventTypes,SCENARIO_EVENT_TYPES.length);assert.equal(coverage.blockTypes,BLOCK_TYPES.length);assert.equal(coverage.allBlockTypes,true);assert.equal(coverage.passed,true);assert.equal(coverage.passedCount,REPLAY_CAPABILITIES.length);
  for(const type of ["ChatMessageSent","AssistantReasoned","IdeationPreviewCompleted","IdeationPromoted","GenerationCompleted","AttentionEpisodeObserved","ContextCompiled","ExtractionCompleted","TasteModelVersioned","ScoutBudgetExhausted"])assert.ok(events.some((event)=>event.type===type),type);
  const preview=events.find((event)=>event.type==="IdeationPreviewCompleted");const finals=events.filter((event)=>event.type==="GenerationCompleted"&&event.actor==="worker:generator"&&String(event.payload.prompt_fan_id??"").startsWith("live-prompt-fan-"));
  assert.equal(preview.payload.media_url,"/api/media/private-preview");assert.equal(preview.payload.quality,"low");assert.equal(preview.payload.media_type,"image/jpeg");assert.equal(preview.payload.image_width,816);assert.equal(preview.payload.output_compression,70);assert.equal(preview.payload.used_uploaded_reference_pixels,true);assert.equal(preview.payload.reference_input_count,1);assert.equal(finals.length,8);assert.deepEqual(new Set(finals.map((event)=>event.payload.prompt_technique)),new Set(["prose","bullets","json","xml"]));assert.equal(new Set(finals.map((event)=>event.payload.media_url)).size,4);assert.ok(finals.every((event)=>event.payload.quality==="high"&&event.payload.promoted_from_object_id==="draft-saved-1"&&event.payload.reference_input_count===2&&event.payload.used_ideation_preview_pixels===true));
  const pixelPolicy=events.find((event)=>event.type==="BlockPropertyEdited"&&event.payload.property_path==="pixel_reference_mode");assert.equal(pixelPolicy?.payload.new_value,"inspiration");assert.ok(events.some((event)=>event.type==="ReferenceIngested"&&event.payload.media_url==="/api/media/private-reference"));
  assert.ok(events.some((event)=>event.type==="BlockRelationAdded"&&event.payload.kind==="style_reference"));const compiled=events.find((event)=>event.type==="ContextCompiled");assert.ok(Array.isArray(compiled?.payload.compiled_snapshot.relationships));assert.ok(compiled.payload.compiled_snapshot.relationships.length>=2);
  assert.equal(events.every((event,index)=>event.sequence===index+1&&event.streamId==="replay-session:saved-1"),true);assert.doesNotThrow(()=>foldEvents(events));
});

test("semantic coverage fails when future functionality is present only by name",()=>{
  const complete=buildComprehensiveScenario();const baseline=evaluateReplayCoverage(complete,SCENARIO_EVENT_TYPES);assert.equal(baseline.passed,true);
  const withoutPathEdits=complete.filter((event)=>!(event.type==="BlockPropertyEdited"&&event.payload.property_path==="spatial_scope"&&event.payload.interaction==="drag-path-edge"));
  const degraded=evaluateReplayCoverage(withoutPathEdits,SCENARIO_EVENT_TYPES);assert.equal(degraded.passed,false);assert.equal(degraded.checks.find((check)=>check.key==="spatial-editing")?.passed,false);
  const collapsedFan=complete.map((event)=>event.type==="GenerationCompleted"&&event.payload.prompt_fan_id?{...event,payload:{...event.payload,media_url:"/api/media/replay/same.png",generation_id:"same",object_ids:["same"]}}:event);
  const fanCoverage=evaluateReplayCoverage(collapsedFan,SCENARIO_EVENT_TYPES);assert.equal(fanCoverage.checks.find((check)=>check.key==="prompt-fan")?.passed,false);
});

test("requires a direct one-use paid approval and stores provider-backed fixtures for reuse",async()=>{
  const [api,admin,runtime,adapter]=await Promise.all([
    readFile(new URL("../worker/replay-sessions-api.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/forma-admin-events.ts",import.meta.url),"utf8"),readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8"),readFile(new URL("../worker/openai-adapter.ts",import.meta.url),"utf8"),
  ]);
  assert.match(api,/requireUser\(request,env,"admin"\)/);assert.match(api,/I know what I'm doing/);assert.match(api,/consumed_at IS NULL AND expires_at>/);assert.match(api,/x-forma-automation/);assert.match(api,/direct-user/);assert.match(api,/estimateLiveReplayCost/);assert.match(api,/reserveCostBudget/);assert.match(api,/settleCostBudget/);assert.match(api,/approvedMaximumMicrousd/);assert.match(api,/allowUserBudgetOverride/);assert.doesNotMatch(api,/RESERVED_TOKENS/);assert.match(api,/generateLiveReplayPlan/);assert.match(api,/quality:"low"/);assert.match(api,/quality:"high"/);assert.match(api,/references:\[\{bytes:preview\.bytes/);assert.match(api,/uploadedReference/);assert.match(api,/provider_operations:7/);assert.match(api,/image_count=6/);assert.match(api,/PROMPT_TECHNIQUES/);assert.match(api,/live_replay_semantic_coverage_failed/);assert.match(api,/events_json/);assert.match(api,/preview_media_url/);assert.match(api,/final_media_url/);
  assert.match(admin,/event\.isTrusted/);assert.match(admin,/navigator\.userActivation/);assert.match(admin,/Generate actual-data mock/);assert.match(admin,/not being initiated by an agent or test/);assert.match(admin,/Completed events and images are saved/);assert.match(admin,/One-run maximum/);assert.match(admin,/bounded one-run budget exception/);assert.match(admin,/workspace ceiling/);assert.match(admin,/actual-replay-dialog/);assert.match(admin,/closedby="any"/);
  assert.match(runtime,/CREATE TABLE IF NOT EXISTS replay_approvals/);assert.match(runtime,/CREATE TABLE IF NOT EXISTS replay_cost_authorizations/);assert.match(runtime,/CREATE TABLE IF NOT EXISTS cost_budget_counters/);assert.match(runtime,/CREATE TABLE IF NOT EXISTS replay_sessions/);assert.match(adapter,/live_replay_plan/);assert.match(adapter,/required_block_types/);assert.match(adapter,/textInputTokens/);assert.match(adapter,/imageInputTokens/);
});
