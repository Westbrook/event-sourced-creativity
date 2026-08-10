import assert from "node:assert/strict";
import test from "node:test";
import { ATTENTION_RETENTION_DAYS, attentionEvents, attentionMetrics, buildAttentionEpisode } from "../src/model/attention.ts";
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

test("repeated friction can create only a low-confidence Scout support slice",()=>{
  const payload={active_ms:90_000,idle_ms:5_000,outcome_weight:.08,friction_score:.72,expires_at:"2099-01-01T00:00:00.000Z"};
  const slices=buildScoutTrajectory([event(1,"AttentionEpisodeObserved",payload),event(2,"AttentionEpisodeObserved",payload)]);
  const signal=slices.find((slice)=>slice.signature.startsWith("attention-friction:"));assert.ok(signal);assert.equal(signal.type,"stall");assert.ok(signal.confidence<=.44);assert.equal(signal.metrics.attention_weight_cap,.25);
});
