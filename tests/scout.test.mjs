import assert from "node:assert/strict";
import test from "node:test";
import { buildScoutEnvelope, buildScoutTrajectory, scoutPrecisionLedger } from "../src/model/scout.ts";

const event = (sequence, type, payload, actor = "user") => ({
  eventId: `event-${sequence}`, streamId: "stream-scout", sequence,
  occurredAt: new Date(Date.UTC(2026, 7, 10, 12, 0, sequence)).toISOString(),
  recordedAt: new Date(Date.UTC(2026, 7, 10, 12, 0, sequence)).toISOString(),
  actor, clientId: "test", correlationId: `corr-${sequence}`, causationId: null,
  compensatesEventId: null, schemaVersion: 1, type, payload,
});

const corpus = [
  event(1, "ProjectCreated", { project_id: "project", name: "Trajectory study" }),
  event(2, "DocumentCreated", { document_id: "document", title: "Nocturne" }),
  event(3, "GenerationRequested", { generation_id: "g1" }),
  event(4, "ContextCompiled", { generation_id: "g1", compiled_snapshot: { facts: ["direction/nocturne", "palette/warm"] } }, "worker:compiler"),
  event(5, "GenerationCompleted", { generation_id: "g1", model_id: "m", object_ids: ["o1"] }, "worker:generator"),
  event(6, "GenerationRequested", { generation_id: "g2" }),
  event(7, "ContextCompiled", { generation_id: "g2", compiled_snapshot: { facts: ["direction/nocturne", "palette/warm"] } }, "worker:compiler"),
  event(8, "GenerationCompleted", { generation_id: "g2", model_id: "m", object_ids: ["o2"] }, "worker:generator"),
  event(9, "GenerationRequested", { generation_id: "g3" }),
  event(10, "FamilyDeclared", { family_id: "warm", label: "Warm nocturnes", confidence: .8 }, "worker:indexer"),
  event(11, "FamilyMembershipAsserted", { family_id: "warm", object_id: "o2", claim_ref: "family-membership:warm:o2" }, "worker:indexer"),
  event(12, "DocumentViewVisited", { document_id: "document", view: "editor", focused: true }),
];

test("builds deterministic typed trajectory slices with stable evidence", () => {
  const first = buildScoutTrajectory(corpus); const second = buildScoutTrajectory(corpus);
  assert.deepEqual(first, second);
  assert.ok(first.some((slice) => slice.type === "convergence"));
  assert.ok(first.some((slice) => slice.type === "stall"));
  assert.ok(first.some((slice) => slice.type === "adjacency"));
  assert.ok(first.some((slice) => slice.type === "workflow"));
  assert.ok(first.every((slice) => slice.sliceId && slice.signature && slice.evidenceRefs.length));
});

test("remembers rejected scout paths by observation signature", () => {
  const rejected = buildScoutTrajectory(corpus)[0];
  const withJudgment = [
    ...corpus,
    event(13, "ScoutObserved", { observation_id: "observation-1", signature: rejected.signature, type: rejected.type }, "worker:scout"),
    event(14, "ObservationJudged", { observation_id: "observation-1", observation_signature: rejected.signature, verdict: "rejected" }),
  ];
  assert.ok(!buildScoutTrajectory(withJudgment).some((slice) => slice.signature === rejected.signature));
});

test("treats budget exhaustion as a predictable envelope result", () => {
  const fits = buildScoutEnvelope(corpus, 10_000, 3); const exhausted = buildScoutEnvelope(corpus, 100, 3);
  assert.equal(fits.fits, true); assert.equal(exhausted.fits, false);
  assert.equal(exhausted.requestedTokens, exhausted.historicalTokensPerVariant * exhausted.plannedVariants);
});

test("reports confirmed observations per dollar", () => {
  const ledger = scoutPrecisionLedger([
    event(1, "ScoutObserved", { observation_id: "o1", type: "stall", confidence: .8 }, "worker:scout"),
    event(2, "ScoutObserved", { observation_id: "o2", type: "adjacency", confidence: .6 }, "worker:scout"),
    event(3, "ObservationJudged", { observation_id: "o1", verdict: "confirmed" }),
    event(4, "ObservationJudged", { observation_id: "o2", verdict: "rejected" }),
    event(5, "ScoutRunCompleted", { run_id: "run", cost_usd: 2 }, "worker:scout"),
  ]);
  assert.equal(ledger.confirmed, 1); assert.equal(ledger.rejected, 1); assert.equal(ledger.confirmedPerDollar, .5);
});
