import assert from "node:assert/strict";
import test from "node:test";
import { ATTENTION_ACTION_TERMINALS, ATTENTION_IDLE_GRACE_MS, ATTENTION_IDLE_TERMINAL_MS, ATTENTION_RETENTION_DAYS, attentionEvents, attentionMetrics, attentionTickTransition, buildAttentionEpisode, isAttentionActionTerminal, isPhantomAttentionEpisode } from "../src/model/attention.ts";
import { buildScoutTrajectory } from "../src/model/scout.ts";

const event=(sequence,type,payload,recordedAt="2026-08-10T12:00:00.000Z")=>({eventId:`event-${sequence}`,streamId:"attention-stream",sequence,occurredAt:recordedAt,recordedAt,actor:"user",clientId:"test",correlationId:`corr-${sequence}`,causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});

test("weights active terminal outcomes above page exits while capping attention below direct action authority",()=>{
  const base={episode_id:"episode",surface:"studio",context:"writing-direction",started_at:"2026-08-10T12:00:00.000Z",ended_at:"2026-08-10T12:02:00.000Z",active_ms:110_000,idle_ms:10_000,visible_refs:["block:a"],terminal_ref:null};
  const saved=buildAttentionEpisode({...base,terminal_type:"ObjectSaved"});
  const hidden=buildAttentionEpisode({...base,terminal_type:"page_hidden"});
  const away=buildAttentionEpisode({...base,active_ms:20_000,idle_ms:100_000,terminal_type:"idle_timeout"});
  assert.equal(ATTENTION_RETENTION_DAYS,14);assert.ok(saved.outcome_weight>hidden.outcome_weight);assert.ok(saved.outcome_weight<=.25);assert.ok(hidden.friction_score>away.friction_score);
  assert.equal(Date.parse(saved.expires_at)-Date.parse(saved.ended_at),14*86_400_000);
});

test("expiry and forget tombstones remove episodes from downstream attention projections",()=>{
  const now=Date.parse("2026-08-10T12:00:00.000Z");const payload={active_ms:30_000,idle_ms:0,outcome_weight:.2,friction_score:.5,expires_at:"2026-08-20T12:00:00.000Z"};
  const events=[event(1,"AttentionEpisodeObserved",payload),event(2,"AttentionSignalsForgotten",{before_sequence:1}),event(3,"AttentionEpisodeObserved",payload),event(4,"AttentionEpisodeObserved",{...payload,expires_at:"2026-08-09T12:00:00.000Z"})];
  assert.deepEqual(attentionEvents(events,now).map((item)=>item.sequence),[3]);assert.equal(attentionMetrics(events,now).episodes,1);
});

test("recognizes only precisely fingerprinted idle-timer artifacts while preserving real attention",()=>{
  const phantom={surface:"studio",context:"studio-overview",terminal_type:"idle_timeout",terminal_ref:null,active_ms:30_000,idle_ms:30_000,visible_refs:[],outcome_weight:.013,friction_score:0,capture_version:"attention-v2",expires_at:"2099-01-01T00:00:00.000Z"};
  assert.equal(isPhantomAttentionEpisode(phantom),true);
  assert.equal(isPhantomAttentionEpisode({...phantom,capture_version:"attention-v1"}),true);
  for(const genuine of [
    {...phantom,capture_version:"unknown"},
    {...phantom,active_ms:29_999},
    {...phantom,active_ms:30_001},
    {...phantom,idle_ms:29_999},
    {...phantom,visible_refs:["block:authored"]},
    {...phantom,context:"writing-direction"},
    {...phantom,terminal_type:"ObjectSaved"},
    {...phantom,terminal_ref:"object:authored"},
    {...phantom,friction_score:.45},
    {...phantom,outcome_weight:.18},
    {...phantom,surface:""},
    {},
  ])assert.equal(isPhantomAttentionEpisode(genuine),false,JSON.stringify(genuine));
  const genuine={...phantom,active_ms:30_001};
  const events=[event(1,"AttentionEpisodeObserved",phantom),event(2,"AttentionEpisodeObserved",genuine)];
  assert.deepEqual(attentionEvents(events,Date.parse("2026-08-18T00:00:00.000Z")).map((item)=>item.sequence),[2]);
  assert.equal(attentionMetrics(events,Date.parse("2026-08-18T00:00:00.000Z")).episodes,1);
});

test("idle timers remain dormant without user activity and only supported user actions end episodes",()=>{
  assert.equal(ATTENTION_IDLE_GRACE_MS,30_000);assert.equal(ATTENTION_IDLE_TERMINAL_MS,60_000);
  assert.equal(attentionTickTransition(null,0),"dormant");
  assert.equal(attentionTickTransition(null,65_000),"dormant");
  assert.equal(attentionTickTransition(null,120_000),"dormant");
  assert.equal(attentionTickTransition(0,59_999),"tracking");
  assert.equal(attentionTickTransition(0,60_000),"idle-timeout");
  for(const terminal of ATTENTION_ACTION_TERMINALS)assert.equal(isAttentionActionTerminal(terminal),true,terminal);
  for(const telemetry of ["ApplicationViewVisited","DocumentViewVisited","CanvasInteractionRecorded","AttentionEpisodeObserved"])assert.equal(isAttentionActionTerminal(telemetry),false,telemetry);
});

test("repeated friction can create only a low-confidence Scout support slice",()=>{
  const payload={active_ms:90_000,idle_ms:5_000,outcome_weight:.08,friction_score:.72,expires_at:"2099-01-01T00:00:00.000Z"};
  const slices=buildScoutTrajectory([event(1,"AttentionEpisodeObserved",payload),event(2,"AttentionEpisodeObserved",payload)]);
  const signal=slices.find((slice)=>slice.signature.startsWith("attention-friction:"));assert.ok(signal);assert.equal(signal.type,"stall");assert.ok(signal.confidence<=.44);assert.equal(signal.metrics.attention_weight_cap,.25);
});
