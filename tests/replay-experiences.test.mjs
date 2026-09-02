import assert from "node:assert/strict";
import test from "node:test";

import { REPLAY_ARTIFACT_KINDS } from "../src/model/replay-workflows.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { DEFAULT_REPLAY_EXPERIENCE, REPLAY_EXPERIENCE_PROFILES, normalizeReplayExperienceId } from "../src/model/replay-experiences.ts";
import { buildComprehensiveScenario, buildScenario, SCENARIOS, SCENARIO_EVENT_TYPES, scenarioEventCount } from "../src/model/scenarios.ts";

const record=(value)=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};

test("actual-data mocks offer distinct value-proposition contracts",()=>{
  assert.equal(DEFAULT_REPLAY_EXPERIENCE,"complete-system");
  assert.deepEqual(REPLAY_EXPERIENCE_PROFILES.map(({id})=>id),["complete-system","library-canvas","multi-output-storyworld","study-to-campaign","collaborative-review"]);
  assert.equal(new Set(REPLAY_EXPERIENCE_PROFILES.map(({label})=>label)).size,REPLAY_EXPERIENCE_PROFILES.length);
  assert.ok(REPLAY_EXPERIENCE_PROFILES.every((profile)=>profile.summary.length>80&&profile.plannerBrief.length>120));
  assert.equal(normalizeReplayExperienceId("library-canvas"),"library-canvas");
  assert.equal(normalizeReplayExperienceId("unknown"),DEFAULT_REPLAY_EXPERIENCE);
});

test("the output workbench gives every deliverable its own creative job",()=>{
  const events=buildScenario("output-workbench",scenarioEventCount("output-workbench"));
  const evidence=events.filter((event)=>event.type==="GenerationCompleted"||event.type==="DocumentRenderCompleted");
  const forms=new Map(evidence.map((event)=>[event.type==="GenerationCompleted"?"image":event.payload.artifact_kind,record(event.payload.output_brief)]));
  assert.deepEqual(new Set(forms.keys()),new Set(["image",...REPLAY_ARTIFACT_KINDS]));
  assert.ok([...forms.values()].every((brief)=>brief.title&&brief.purpose&&brief.audience&&brief.success_signal&&Array.isArray(brief.beats)&&brief.beats.length>=3));
  assert.equal(new Set([...forms.values()].map((brief)=>brief.title)).size,forms.size);
  assert.ok(new Set([...forms.values()].map((brief)=>brief.audience)).size>=5);
  const bodies=events.filter((event)=>event.type==="DocumentRenderCompleted").flatMap((event)=>event.payload.items??[]).map((item)=>item.body).filter(Boolean);
  assert.ok(bodies.length>=REPLAY_ARTIFACT_KINDS.length);
});

test("the Library and Canvas scenario proves reuse before generation",()=>{
  const events=buildScenario("library-canvas",scenarioEventCount("library-canvas"));
  assert.deepEqual(new Set(events.filter((event)=>event.type==="BlockCreated"&&event.payload.scope==="library").map((event)=>event.payload.type)),new Set(["style","reference","subject","palette","material","lighting"]));
  const first=(type,predicate=()=>true)=>events.find((event)=>event.type===type&&predicate(event));
  const library=first("BlockCreated",(event)=>event.payload.scope==="library");
  const placement=first("CanvasItemPlaced");
  const context=first("ContextSetFormalized");
  const document=first("DocumentCreated",(event)=>event.payload.created_from==="canvas-selection");
  const result=first("GenerationCompleted",(event)=>event.payload.source_surface==="canvas");
  assert.ok(library&&placement&&context&&document&&result);
  assert.ok(library.sequence<placement.sequence&&placement.sequence<context.sequence&&context.sequence<document.sequence&&document.sequence<result.sequence);
  assert.ok(events.some((event)=>event.type==="CanvasInteractionRecorded"&&event.payload.interaction_id==="source_searched"));
  assert.ok(events.some((event)=>event.type==="ProposalIssued"&&event.payload.report_space===true));
});

test("Do all the things advances coherent goal-owned chapters and enforces semantic coverage",()=>{
  const events=buildComprehensiveScenario();
  const byScenario=new Map(SCENARIOS.map((scenario)=>[scenario.key,events.filter((event)=>event.payload.narrative_scenario===scenario.key)]));
  for(const scenario of SCENARIOS)assert.equal(byScenario.get(scenario.key)?.length,scenarioEventCount(scenario.key),scenario.key);
  for(const scenario of SCENARIOS){const chapter=byScenario.get(scenario.key)??[];assert.ok(chapter.every((event,index)=>event.payload.narrative_position===index+1));assert.ok(chapter.every((event,index)=>index===0||event.sequence===chapter[index-1].sequence+1),`${scenario.key} should remain one coherent creator chapter`);}
  const byId=new Map(events.map((event)=>[event.eventId,event]));assert.ok(events.every((event)=>!event.causationId||byId.get(event.causationId)?.payload.workflow_id===event.payload.workflow_id));
  assert.deepEqual(new Set(events.map((event)=>event.payload.experience_area)),new Set(["document","library-canvas","canvas","outputs","intelligence","operations"]));
  const coverage=evaluateReplayCoverage(events,SCENARIO_EVENT_TYPES);
  assert.equal(coverage.passed,true,JSON.stringify(coverage.checks.filter((check)=>!check.passed)));
  for(const key of ["balanced-creative-tour","workflow-causal-integrity","intent-vector-lifecycle","unfinished-intent-recovery","one-context-many-outputs","artifact-first-reconstruction","purpose-built-outputs","library-canvas-journey"])assert.equal(coverage.checks.find((check)=>check.key===key)?.passed,true,key);

  const withoutLibraryJourney=events.filter((event)=>event.payload.narrative_scenario!=="library-canvas");
  const degraded=evaluateReplayCoverage(withoutLibraryJourney,SCENARIO_EVENT_TYPES);
  assert.equal(degraded.checks.find((check)=>check.key==="library-canvas-journey")?.passed,false);
  assert.equal(degraded.checks.find((check)=>check.key==="balanced-creative-tour")?.passed,false);
});
