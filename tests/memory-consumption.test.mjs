import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { reduceConsumptionEpisodes } from "../worker/memory-consumption.ts";

const CHECKED = "2026-09-05T12:00:00.000Z";
const clock = (offset) => new Date(Date.parse(CHECKED) + offset).toISOString();
const UNTIL = clock(60_000);
const AUTHORITY = Object.freeze({
  enrollment_id: "enrollment-1", actor_user_id: "user-1", owner_user_id: "user-1",
  organization_id: null, project_access_id: null, project_id: "project-1",
  document_id: "document-1", permission_epoch: "epoch-1", revision: 3, cursor_sequence: 64,
});

const source = (sequence, fields = {}) => ({
  eventId: `event-${sequence}`, sequence, type: "BlockPropertyEdited", blockId: "block-a",
  recordedAt: clock(-60_000 + sequence * 500), validUntil: UNTIL, ...fields,
});
const ref = ({ eventId, sequence }) => ({ eventId, sequence });
const observation = (event, fields = {}) => ({
  source: ref(event), authority: { ...AUTHORITY }, kind: "inspection",
  episodeId: "episode-1", resourceRevision: "content-revision-1", copiedFrom: null, ...fields,
});
const compensation = (event, target, fields = {}) => ({
  source: ref(event), authority: { ...AUTHORITY }, target: target === null ? null : ref(target), ...fields,
});
const input = (sources = [], fields = {}) => ({
  authority: { ...AUTHORITY }, checkedAt: CHECKED, validUntil: UNTIL, sources,
  observations: [], compensations: [], withdrawnSources: [], provenance: null, ...fields,
});
const reduce = (value) => {
  const result = reduceConsumptionEpisodes(value);
  assert.notEqual(result, null, "expected a valid consumption projection");
  return result;
};
const sourceIds = (projection, sources) => projection.episodes.flatMap((episode) =>
  episode.observations.map((entry) => sources[entry.sourceIndex].eventId));
const assist = (selection, { decision = 0, mutation = 1, accepted = true, validUntil = UNTIL } = {}) => ({
  value: {
    version: "native-assisted-outcomes-v1", treatment: "descriptive-assisted-decisions",
    exposure: "not-measured", inferredPreferences: false,
    coverage: {
      selectedSourceCount: selection.length,
      selectedDecisionCount: selection.filter((entry) => ["ProposalAccepted", "ProposalRejected"].includes(entry.type)).length,
      certifiedOutcomeCount: 1, completeHistory: false, bounded: true, freeAssistantOnly: true,
    },
    outcomes: [{
      proposalId: "proposal-1", turnId: "turn-1", status: accepted ? "accepted" : "rejected",
      actionKind: "context.edit", origin: "assistant-assisted", independentEvidence: false,
      decision: { sourceIndex: decision },
      mutation: accepted ? { sourceIndex: mutation, type: "BlockPropertyEdited", blockIds: ["block-a"], relationId: null } : null,
      recordedAt: selection[decision].recordedAt,
    }],
  }, validUntil,
});
const saved = (selection, { sourceIndexes = [0, 1], validUntil = UNTIL } = {}) => ({
  value: {
    version: "native-saved-outputs-v1", treatment: "descriptive-output-retention", inferredPreferences: false,
    coverage: {
      selectedSourceCount: selection.length,
      selectedRetentionActionCount: selection.filter((entry) => ["ObjectSaved", "ObjectPinned", "ObjectExported"].includes(entry.type)).length,
      certifiedOutputCount: 1, completeHistory: false, bounded: true, nativeImageJobsOnly: true,
    },
    outputs: [{ sourceIndexes, origin: "native-generated-output", independentEvidence: false, generatedAt: clock(-59_900) }],
  }, validUntil,
});
const assistedSources = () => [source(1, { type: "ProposalAccepted", blockId: null }), source(2)];
const retainedSources = () => [source(3, { type: "ObjectSaved" }), source(4, { type: "ObjectPinned" })];

let priorFetch;
before(() => {
  priorFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Consumption tests must never make network requests"); };
});
after(() => { globalThis.fetch = priorFetch; });

test("an empty certified window reports descriptive limits without inventing observations", () => {
  const result = reduce(input());
  assert.deepEqual(result.episodes, []);
  assert.equal(result.coverage.observationCount, 0);
  assert.equal(result.coverage.completeHistory, false);
  assert.equal(result.attention, "not-measured");
  assert.equal(result.comprehension, "not-measured");
  assert.equal(result.inferredPreferences, false);
});

test("source types, accepted assistant changes, and saved output groups alone establish no consumption", () => {
  const sources = [...assistedSources(), ...retainedSources()];
  const result = reduce(input(sources, { provenance: {
    selection: sources, outcomes: assist(sources), savedOutputs: saved(sources, { sourceIndexes: [2, 3] }),
  } }));
  assert.deepEqual(result.episodes, []);
  assert.equal(result.coverage.observationCount, 0);
});

test("certified observations group only by known episode, block, and immutable content revision", () => {
  const sources = [source(1), source(2), source(3), source(4, { blockId: "block-b" }), source(5)];
  const observations = [
    observation(sources[0], { kind: "visit" }), observation(sources[1], { kind: "inspection" }),
    observation(sources[2], { kind: "reuse", resourceRevision: "content-revision-2" }),
    observation(sources[3]), observation(sources[4], { episodeId: "episode-2" }),
  ];
  const result = reduce(input(sources, { observations }));
  assert.equal(result.episodes.length, 4);
  const joined = result.episodes.find((entry) => entry.observations.length === 2);
  assert.deepEqual(joined.observations.map((entry) => entry.kind), ["visit", "inspection"]);
  assert.equal(joined.firstRecordedAt, sources[0].recordedAt);
  assert.equal(joined.lastRecordedAt, sources[1].recordedAt);
  assert.equal(joined.documentId, AUTHORITY.document_id);
  assert.equal(joined.resourceRevision, "content-revision-1");
  assert.equal(joined.independentEvidence, false);
  assert.deepEqual(joined.origins, ["unknown"]);
});

test("unknown episode or content revision is preserved and cannot merge separate observations", () => {
  const sources = [source(1), source(2), source(3), source(4)];
  const observations = sources.map((entry, position) => observation(entry,
    position < 2 ? { episodeId: null } : { resourceRevision: null }));
  const result = reduce(input(sources, { observations }));
  assert.equal(result.episodes.length, 4);
  assert.equal(result.episodes.filter((entry) => entry.episodeId === null).length, 2);
  assert.equal(result.episodes.filter((entry) => entry.resourceRevision === null).length, 2);
  assert.ok(result.episodes.every((entry) => entry.observations.length === 1));
  assert.ok(result.coverage.incompleteLineageCount > 0);
});

test("reordering selected sources remaps exact event identities and preserves source positions", () => {
  const first = source(1), unused = source(2), last = source(3);
  const observations = [observation(first), observation(last, { kind: "reuse" })];
  const originalSources = [first, unused, last], reordered = [last, first, unused];
  const original = reduce(input(originalSources, { observations }));
  const shifted = reduce(input(reordered, { observations }));
  assert.deepEqual(sourceIds(original, originalSources), sourceIds(shifted, reordered));
  assert.deepEqual(shifted.episodes[0].observations.map((entry) => entry.sourceIndex), [1, 0]);
});

test("every witness must repeat the enclosing enrollment, identity, scope, and permission authority", () => {
  const event = source(1);
  const changes = {
    enrollment_id: "enrollment-2", actor_user_id: "user-2", owner_user_id: "user-2",
    organization_id: "org-2", project_access_id: "access-2", project_id: "project-2",
    document_id: "document-2", permission_epoch: "epoch-2", revision: 4, cursor_sequence: 63,
  };
  for (const [field, value] of Object.entries(changes)) {
    const witness = observation(event, { authority: { ...AUTHORITY, [field]: value } });
    assert.equal(reduceConsumptionEpisodes(input([event], { observations: [witness] })), null, field);
  }
  const undo = source(2);
  assert.equal(reduceConsumptionEpisodes(input([event, undo], {
    observations: [observation(event)], compensations: [compensation(undo, event, {
      authority: { ...AUTHORITY, permission_epoch: "revoked-epoch" },
    })],
  })), null);
});

test("shared authority stays explicit and a partially supplied organization authority is invalid", () => {
  const event = source(1);
  const shared = { ...AUTHORITY, actor_user_id: "collaborator-1", organization_id: "org-1", project_access_id: "access-1" };
  const result = reduce(input([event], { authority: shared, observations: [observation(event, { authority: shared })] }));
  assert.equal(result.coverage.observationCount, 1);
  for (const authority of [
    { ...shared, organization_id: null }, { ...shared, project_access_id: null },
    { ...AUTHORITY, actor_user_id: "unscoped-collaborator" },
  ]) assert.equal(reduceConsumptionEpisodes(input([event], { authority })), null);
});

test("source and witness references reject identity collisions, missing sources, and sequences beyond the cursor", () => {
  const event = source(1);
  for (const sources of [[event, { ...source(2), eventId: event.eventId }], [source(0)], [source(65)]]) {
    assert.equal(reduceConsumptionEpisodes(input(sources)), null);
  }
  for (const witness of [observation(source(2)), observation(event, { source: { eventId: event.eventId, sequence: 2 } })]) {
    assert.equal(reduceConsumptionEpisodes(input([event], { observations: [witness] })), null);
  }
});

test("identical repeated observations are idempotent and conflicting certification rejects the projection", () => {
  const event = source(1), witness = observation(event);
  const result = reduce(input([event], { observations: [witness, structuredClone(witness)] }));
  assert.equal(result.coverage.observationCount, 1);
  assert.equal(result.episodes[0].observations.length, 1);
  for (const fields of [{ kind: "reuse" }, { episodeId: "different-episode" }, { resourceRevision: null }]) {
    assert.equal(reduceConsumptionEpisodes(input([event], { observations: [witness, observation(event, fields)] })), null);
  }
});

test("a direct compensation suppresses the observation once, including duplicate receipts and duplicate targets", () => {
  const event = source(1), undo = source(2), secondUndo = source(3);
  const receipt = compensation(undo, event);
  const result = reduce(input([event, undo, secondUndo], {
    observations: [observation(event)], compensations: [receipt, structuredClone(receipt), compensation(secondUndo, event)],
  }));
  assert.deepEqual(result.episodes, []);
  assert.equal(result.coverage.compensatedObservationCount, 1);
  assert.equal(result.coverage.unresolvedCompensationCount, 0);
  assert.equal(reduceConsumptionEpisodes(input([event, undo], {
    compensations: [receipt, compensation(undo, null)],
  })), null);
});

test("missing compensation lineage and a selected but unobserved target remain unresolved", () => {
  const unobserved = source(1), noTarget = source(2), undoUnobserved = source(3);
  const result = reduce(input([unobserved, noTarget, undoUnobserved], {
    compensations: [compensation(noTarget, null), compensation(undoUnobserved, unobserved)],
  }));
  assert.equal(result.coverage.compensatedObservationCount, 0);
  assert.equal(result.coverage.unresolvedCompensationCount, 2);
  assert.deepEqual(result.episodes, []);
});

test("compensation source and any explicit target must resolve inside the exact selected window", () => {
  const event = source(1), undo = source(2), absent = source(3);
  assert.equal(reduceConsumptionEpisodes(input([event], { compensations: [compensation(undo, event)] })), null);
  assert.equal(reduceConsumptionEpisodes(input([event, undo], { compensations: [compensation(undo, absent)] })), null);
});

test("one source cannot be certified simultaneously as an observation and an undo receipt", () => {
  const event = source(1), ambiguous = source(2);
  assert.equal(reduceConsumptionEpisodes(input([event, ambiguous], {
    observations: [observation(event), observation(ambiguous)], compensations: [compensation(ambiguous, event)],
  })), null);
});

test("compensating a compensation is unresolved and does not act as redo", () => {
  const event = source(1), undo = source(2), undoUndo = source(3);
  const result = reduce(input([event, undo, undoUndo], {
    observations: [observation(event)], compensations: [compensation(undo, event), compensation(undoUndo, undo)],
  }));
  assert.deepEqual(result.episodes, []);
  assert.equal(result.coverage.compensatedObservationCount, 1);
  assert.equal(result.coverage.unresolvedCompensationCount, 1);
});

test("expired or withdrawn undo evidence cannot resurrect an earlier observation", () => {
  for (const state of ["expired", "withdrawn"]) {
    const event = source(1), undo = source(2, state === "expired" ? { validUntil: CHECKED } : {});
    const result = reduce(input([event, undo], {
      observations: [observation(event)], compensations: [compensation(undo, event)],
      withdrawnSources: state === "withdrawn" ? [ref(undo)] : [],
    }));
    assert.deepEqual(result.episodes, [], state);
    assert.equal(result.coverage.compensatedObservationCount, 0, state);
  }
});

test("a future undo receipt has not yet established negative evidence", () => {
  const event = source(1), undo = source(2, { recordedAt: clock(1) });
  const result = reduce(input([event, undo], {
    observations: [observation(event)], compensations: [compensation(undo, event)],
  }));
  assert.deepEqual(sourceIds(result, [event, undo]), [event.eventId]);
  assert.equal(result.coverage.compensatedObservationCount, 0);
  assert.equal(result.coverage.unresolvedCompensationCount, 0);
});

test("a future undo activation bounds both snapshot and episode reuse before the undo takes effect", () => {
  const event = source(1), undo = source(2, { recordedAt: clock(5_000) });
  const value = input([event, undo], {
    observations: [observation(event)], compensations: [compensation(undo, event)],
  });
  const beforeUndo = reduce(value);
  assert.equal(beforeUndo.coverage.observationCount, 1);
  assert.ok(Date.parse(beforeUndo.validUntil) <= Date.parse(undo.recordedAt));
  assert.ok(Date.parse(beforeUndo.episodes[0].validUntil) <= Date.parse(undo.recordedAt));
  const afterUndo = reduce({ ...value, checkedAt: undo.recordedAt });
  assert.deepEqual(afterUndo.episodes, []);
  assert.equal(afterUndo.coverage.compensatedObservationCount, 1);
});

test("self, forward, cyclic, and temporally reversed compensation links reject certification", () => {
  const first = source(1), second = source(2);
  for (const receipts of [
    [compensation(first, first)], [compensation(first, second)],
    [compensation(second, first), compensation(first, second)],
  ]) assert.equal(reduceConsumptionEpisodes(input([first, second], { compensations: receipts })), null);
  const earlierByTime = source(2, { recordedAt: clock(-60_000) });
  assert.equal(reduceConsumptionEpisodes(input([first, earlierByTime], {
    compensations: [compensation(earlierByTime, first)],
  })), null);
});

test("explicit copied revision and source identity survive without inventing upstream provenance", () => {
  const upstream = source(1), copied = source(2);
  const result = reduce(input([copied, upstream], { observations: [observation(copied, {
    kind: "reuse", copiedFrom: { source: ref(upstream), revision: "copied-revision-7" },
  })] }));
  assert.deepEqual(result.episodes[0].observations[0].copiedFrom, { sourceIndex: 1, revision: "copied-revision-7" });
  assert.ok(result.episodes[0].origins.includes("copy"));
  assert.ok(result.episodes[0].origins.includes("unknown"));
});

test("a copied revision may remain unknown and cannot be replaced by the enrollment revision", () => {
  const upstream = source(1), copied = source(2);
  const result = reduce(input([upstream, copied], { observations: [observation(copied, {
    copiedFrom: { source: ref(upstream), revision: null },
  })] }));
  assert.equal(result.episodes[0].observations[0].copiedFrom.revision, null);
  assert.ok(result.coverage.incompleteLineageCount > 0);
});

test("known copied revisions must match supplied parent observations while unknown revisions remain unknown", () => {
  const upstream = source(1), copied = source(2);
  assert.equal(reduceConsumptionEpisodes(input([upstream, copied], { observations: [
    observation(upstream, { resourceRevision: "parent-revision" }),
    observation(copied, { copiedFrom: { source: ref(upstream), revision: "different-parent-revision" } }),
  ] })), null);
  for (const [parentRevision, copiedRevision] of [[null, "known-copy-revision"], ["known-parent-revision", null]]) {
    const result = reduce(input([upstream, copied], { observations: [
      observation(upstream, { episodeId: "upstream-episode", resourceRevision: parentRevision }),
      observation(copied, { episodeId: "copied-episode", copiedFrom: { source: ref(upstream), revision: copiedRevision } }),
    ] }));
    const child = result.episodes.find((entry) => entry.episodeId === "copied-episode");
    assert.equal(child.observations[0].copiedFrom.revision, copiedRevision);
    assert.equal(result.episodes.find((entry) => entry.episodeId === "upstream-episode").resourceRevision, parentRevision);
  }
});

test("expired, future, or withdrawn primary observations disappear while eligible source positions remain unchanged", () => {
  for (const state of ["expired", "future", "withdrawn"]) {
    const unavailable = source(1, state === "expired" ? { validUntil: CHECKED }
      : state === "future" ? { recordedAt: clock(1) } : {});
    const eligible = source(2);
    const result = reduce(input([unavailable, eligible], {
      observations: [observation(unavailable), observation(eligible)],
      withdrawnSources: state === "withdrawn" ? [ref(unavailable)] : [],
    }));
    assert.deepEqual(sourceIds(result, [unavailable, eligible]), [eligible.eventId], state);
    assert.equal(result.episodes[0].observations[0].sourceIndex, 1, state);
  }
});

test("copied dependencies cascade omission through every explicit downstream observation", () => {
  for (const state of ["expired", "future", "withdrawn"]) {
    const upstream = source(1, state === "expired" ? { validUntil: CHECKED }
      : state === "future" ? { recordedAt: clock(1) } : {});
    const copied = source(2, state === "future" ? { recordedAt: clock(2) } : {});
    const copiedAgain = source(3, state === "future" ? { recordedAt: clock(3) } : {});
    const result = reduce(input([upstream, copied, copiedAgain], {
      observations: [observation(upstream), observation(copied, {
        copiedFrom: { source: ref(upstream), revision: "content-revision-1" },
      }), observation(copiedAgain, { copiedFrom: { source: ref(copied), revision: "content-revision-1" } })],
      withdrawnSources: state === "withdrawn" ? [ref(upstream)] : [],
    }));
    assert.deepEqual(result.episodes, [], state);
  }
});

test("a copied observation is omitted after its directly observed source is compensated", () => {
  const upstream = source(1), copied = source(2), undo = source(3);
  const result = reduce(input([upstream, copied, undo], {
    observations: [observation(upstream), observation(copied, { copiedFrom: { source: ref(upstream), revision: "content-revision-1" } })],
    compensations: [compensation(undo, upstream)],
  }));
  assert.deepEqual(result.episodes, []);
});

test("copied links reject absent, self, forward, cyclic, and reversed-time references", () => {
  const first = source(1), second = source(2), absent = source(3);
  for (const witnesses of [
    [observation(first, { copiedFrom: { source: ref(absent), revision: "r" } })],
    [observation(first, { copiedFrom: { source: ref(first), revision: "r" } })],
    [observation(first, { copiedFrom: { source: ref(second), revision: "r" } })],
    [observation(first, { copiedFrom: { source: ref(second), revision: "r" } }),
      observation(second, { copiedFrom: { source: ref(first), revision: "r" } })],
  ]) assert.equal(reduceConsumptionEpisodes(input([first, second], { observations: witnesses })), null);
  const reversed = source(2, { recordedAt: clock(-60_000) });
  assert.equal(reduceConsumptionEpisodes(input([first, reversed], { observations: [observation(reversed, {
    copiedFrom: { source: ref(first), revision: "r" },
  })] })), null);
});

test("parent lease expiry rejects the whole snapshot and eligible source deadlines bound the returned lease", () => {
  const observed = source(1, { validUntil: clock(45_000) }), other = source(2, { validUntil: clock(10_000) });
  for (const validUntil of [CHECKED, clock(-1)]) {
    assert.equal(reduceConsumptionEpisodes(input([observed], { validUntil })), null);
  }
  const result = reduce(input([observed, other], { observations: [observation(observed)] }));
  assert.ok(Date.parse(result.validUntil) <= Date.parse(other.validUntil));
  assert.ok(Date.parse(result.episodes[0].validUntil) <= Date.parse(observed.validUntil));
});

test("actual accepted assistant outcome schema annotates an explicit mutation observation", () => {
  const sources = assistedSources();
  const result = reduce(input(sources, {
    observations: [observation(sources[1])], provenance: { selection: sources, outcomes: assist(sources), savedOutputs: null },
  }));
  assert.ok(result.episodes[0].origins.includes("assistant-assisted"));
  assert.deepEqual(result.episodes[0].provenanceSourceIndexes, [0, 1]);
  assert.equal(result.episodes[0].observations.length, 1);
});

test("a rejected proposal cannot certify an assisted mutation or create consumption", () => {
  const decision = source(1, { type: "ProposalRejected", blockId: null }), observed = source(2);
  const sources = [decision, observed];
  const result = reduce(input(sources, {
    observations: [observation(observed)],
    provenance: { selection: sources, outcomes: assist(sources, { accepted: false }), savedOutputs: null },
  }));
  assert.deepEqual(result.episodes[0].origins, ["unknown"]);
  assert.deepEqual(result.episodes[0].provenanceSourceIndexes, []);
});

test("an explicitly inspected rejected decision retains certified assistance without creating acceptance or reuse", () => {
  const decision = source(1, { type: "ProposalRejected", blockId: null }), sources = [decision];
  const result = reduce(input(sources, {
    observations: [observation(decision, { kind: "inspection" })],
    provenance: { selection: sources, outcomes: assist(sources, { accepted: false }), savedOutputs: null },
  }));
  assert.equal(result.coverage.observationCount, 1);
  assert.deepEqual(result.episodes[0].origins, ["assistant-assisted"]);
  assert.deepEqual(result.episodes[0].provenanceSourceIndexes, [0]);
  assert.deepEqual(result.episodes[0].observations.map((entry) => entry.kind), ["inspection"]);
  assert.equal(result.inferredPreferences, false);
});

test("actual native saved-output group schema annotates only explicit retention observations", () => {
  const sources = retainedSources();
  const result = reduce(input(sources, {
    observations: [observation(sources[1], { kind: "reuse" })],
    provenance: { selection: sources, outcomes: null, savedOutputs: saved(sources) },
  }));
  assert.ok(result.episodes[0].origins.includes("native-generated-output"));
  assert.deepEqual(result.episodes[0].provenanceSourceIndexes, [0, 1]);
  assert.equal(result.episodes[0].observations.length, 1);
});

test("provenance selection subsets and reorderings remap helper indices to the current source selection", () => {
  const [decision, mutation] = assistedSources();
  const originalSelection = [decision, mutation], sources = [source(3), mutation, source(4), decision];
  const result = reduce(input(sources, {
    observations: [observation(mutation)],
    provenance: { selection: originalSelection, outcomes: assist(originalSelection), savedOutputs: null },
  }));
  assert.equal(result.episodes[0].observations[0].sourceIndex, 1);
  assert.deepEqual(result.episodes[0].provenanceSourceIndexes, [1, 3]);
  assert.ok(result.episodes[0].origins.includes("assistant-assisted"));
});

test("certified copied provenance is inherited while keeping copy identity and explicit copied revision", () => {
  const original = assistedSources(), copied = source(3), sources = [...original, copied];
  const result = reduce(input(sources, {
    observations: [observation(copied, { kind: "reuse", copiedFrom: { source: ref(original[1]), revision: "original-r1" } })],
    provenance: { selection: original, outcomes: assist(original), savedOutputs: null },
  }));
  assert.ok(result.episodes[0].origins.includes("assistant-assisted"));
  assert.ok(result.episodes[0].origins.includes("copy"));
  assert.equal(result.episodes[0].observations[0].copiedFrom.revision, "original-r1");
  assert.deepEqual(result.episodes[0].provenanceSourceIndexes, [0, 1]);
});

test("two explicit copy hops retain known upstream provenance and its shortest lease", () => {
  const decision = source(1, { type: "ProposalAccepted", blockId: null });
  const mutation = source(2, { validUntil: clock(20_000) });
  const copied = source(3, { validUntil: clock(30_000) }), copiedAgain = source(4, { validUntil: clock(45_000) });
  const selection = [decision, mutation], sources = [decision, mutation, copied, copiedAgain];
  const result = reduce(input(sources, {
    observations: [
      observation(mutation, { episodeId: "episode-original", resourceRevision: "revision-original" }),
      observation(copied, { episodeId: "episode-copy-one", kind: "reuse", resourceRevision: "revision-copy-one",
        copiedFrom: { source: ref(mutation), revision: "revision-original" } }),
      observation(copiedAgain, { episodeId: "episode-copy-two", kind: "reuse", resourceRevision: "revision-copy-two",
        copiedFrom: { source: ref(copied), revision: "revision-copy-one" } }),
    ],
    provenance: { selection, outcomes: assist(selection, { validUntil: clock(12_000) }), savedOutputs: null },
  }));
  const finalCopy = result.episodes.find((entry) => entry.episodeId === "episode-copy-two");
  assert.equal(result.coverage.observationCount, 3);
  assert.ok(finalCopy.origins.includes("assistant-assisted"));
  assert.ok(finalCopy.origins.includes("copy"));
  assert.deepEqual(finalCopy.provenanceSourceIndexes, [0, 1, 2]);
  assert.deepEqual(finalCopy.observations[0].copiedFrom, { sourceIndex: 2, revision: "revision-copy-one" });
  assert.ok(Date.parse(finalCopy.validUntil) <= Date.parse(clock(12_000)));
  assert.ok(Date.parse(result.validUntil) <= Date.parse(clock(12_000)));
});

test("changed provenance source metadata or an unknown selection source rejects the projection", () => {
  const sources = assistedSources();
  for (const change of [
    { type: "AnotherType" }, { sequence: 3 }, { blockId: "another-block" },
    { recordedAt: clock(-59_999) }, { validUntil: clock(59_999) }, { eventId: "absent-event" },
  ]) {
    const selection = [{ ...sources[0], ...change }, sources[1]];
    assert.equal(reduceConsumptionEpisodes(input(sources, {
      observations: [observation(sources[1])], provenance: { selection, outcomes: assist(selection), savedOutputs: null },
    })), null, JSON.stringify(change));
  }
});

test("fresh malformed helper results reject instead of becoming trusted provenance", () => {
  const sources = assistedSources();
  for (const mutate of [
    (wrapper) => { wrapper.value.coverage.certifiedOutcomeCount = 2; },
    (wrapper) => { wrapper.value.outcomes[0].mutation.type = "BlockCreated"; },
    (wrapper) => { wrapper.value.outcomes[0].decision.sourceIndex = 63; },
  ]) {
    const outcomes = assist(sources);
    mutate(outcomes);
    assert.equal(reduceConsumptionEpisodes(input(sources, {
      observations: [observation(sources[1])], provenance: { selection: sources, outcomes, savedOutputs: null },
    })), null);
  }
  const retained = retainedSources(), savedOutputs = saved(retained);
  savedOutputs.value.outputs[0].sourceIndexes = [1, 0];
  assert.equal(reduceConsumptionEpisodes(input(retained, {
    observations: [observation(retained[1])], provenance: { selection: retained, outcomes: null, savedOutputs },
  })), null);
});

test("expired helper wrappers drop optional provenance and never erase a current explicit observation", () => {
  const sources = assistedSources();
  const result = reduce(input(sources, {
    observations: [observation(sources[1])],
    provenance: { selection: sources, outcomes: assist(sources, { validUntil: CHECKED }), savedOutputs: null },
  }));
  assert.equal(result.coverage.observationCount, 1);
  assert.deepEqual(result.episodes[0].origins, ["unknown"]);
  assert.deepEqual(result.episodes[0].provenanceSourceIndexes, []);
});

test("expired, future, or withdrawn provenance-only sources remove annotations while retaining the observation", () => {
  for (const state of ["expired", "future", "withdrawn"]) {
    const decision = source(1, { type: "ProposalAccepted", blockId: null,
      ...(state === "expired" ? { validUntil: CHECKED } : state === "future" ? { recordedAt: clock(1) } : {}),
    });
    const mutation = source(2), sources = [decision, mutation];
    const result = reduce(input(sources, {
      observations: [observation(mutation)],
      withdrawnSources: state === "withdrawn" ? [ref(decision)] : [],
      provenance: { selection: sources, outcomes: assist(sources), savedOutputs: null },
    }));
    assert.equal(result.coverage.observationCount, 1, state);
    assert.deepEqual(result.episodes[0].origins, ["unknown"], state);
    assert.deepEqual(result.episodes[0].provenanceSourceIndexes, [], state);
  }
});

test("active provenance leases bound the projection and expired provenance cannot extend it", () => {
  const sources = assistedSources();
  const result = reduce(input(sources, {
    observations: [observation(sources[1])],
    provenance: { selection: sources, outcomes: assist(sources, { validUntil: clock(8_000) }), savedOutputs: null },
  }));
  assert.ok(Date.parse(result.validUntil) <= Date.parse(clock(8_000)));
  assert.ok(Date.parse(result.episodes[0].validUntil) <= Date.parse(clock(8_000)));
});

test("own-data capture rejects nested accessors without invoking them", () => {
  const paths = [
    [[], "checkedAt"], [["authority"], "permission_epoch"], [["sources", 0], "type"],
    [["observations", 0], "kind"], [["observations", 0, "source"], "sequence"],
    [["observations", 0, "copiedFrom"], "revision"],
    [["provenance", "outcomes", "value", "coverage"], "certifiedOutcomeCount"],
  ];
  let executions = 0;
  for (const [path, field] of paths) {
    const sources = assistedSources(), copied = source(3);
    const value = input([...sources, copied], {
      observations: [observation(copied, { copiedFrom: { source: ref(sources[1]), revision: "r1" } })],
      provenance: { selection: sources, outcomes: assist(sources), savedOutputs: null },
    });
    const owner = path.reduce((current, key) => current[key], value);
    Object.defineProperty(owner, field, { enumerable: true, configurable: true, get() { executions++; throw new Error("getter must not run"); } });
    assert.equal(reduceConsumptionEpisodes(value), null, [...path, field].join("."));
  }
  assert.equal(executions, 0);
});

test("symbols, hidden fields, and unexpected enumerable fields cannot hide outside the validated snapshot", () => {
  for (const choose of [
    (value) => value, (value) => value.authority, (value) => value.sources,
    (value) => value.sources[0], (value) => value.observations[0].source,
  ]) for (const mode of ["symbol", "hidden", "extra"]) {
    const event = source(1), value = input([event], { observations: [observation(event)] });
    const target = choose(value);
    if (mode === "symbol") target[Symbol("unexpected")] = "hidden";
    else if (mode === "hidden") Object.defineProperty(target, "unexpected", { value: "hidden", enumerable: false });
    else target.unexpected = "extra";
    assert.equal(reduceConsumptionEpisodes(value), null, mode);
  }
});

test("sparse arrays and inherited evidence slots are rejected at every evidence boundary", () => {
  for (const field of ["sources", "observations", "compensations", "withdrawnSources"]) {
    for (const inherited of [false, true]) {
      const event = source(1), undo = source(2);
      const value = input([event, undo], {
        observations: [observation(event)], compensations: [compensation(undo, event)], withdrawnSources: [ref(event)],
      });
      const array = value[field], item = array[0];
      delete array[0];
      if (inherited) {
        const prototype = Object.create(Array.prototype);
        Object.defineProperty(prototype, "0", { value: item, enumerable: true });
        Object.setPrototypeOf(array, prototype);
      }
      assert.equal(reduceConsumptionEpisodes(value), null, `${field}:${inherited}`);
    }
  }
});

test("cyclic structures and oversized evidence collections fail closed before any external work", () => {
  const event = source(1), undo = source(2), witness = observation(event), receipt = compensation(undo, event);
  for (const fields of [
    { sources: Array.from({ length: 65 }, (_, position) => source(position + 1)) },
    { observations: Array(257).fill(witness) }, { compensations: Array(129).fill(receipt) },
    { withdrawnSources: Array(65).fill(ref(event)) }, { observations: new Array(4_294_967_295) },
  ]) assert.equal(reduceConsumptionEpisodes(input([event, undo], fields)), null);
  const cyclic = input([event], { observations: [observation(event)] });
  cyclic.observations[0].copiedFrom = { source: cyclic.observations[0].source, revision: cyclic };
  assert.equal(reduceConsumptionEpisodes(cyclic), null);
});

test("valid input remains unchanged and the returned projection does not alias mutable witnesses", () => {
  const event = source(1), value = input([event], { observations: [observation(event)] });
  const beforeValue = structuredClone(value), result = reduce(value);
  assert.deepEqual(value, beforeValue);
  value.observations[0].kind = "reuse";
  value.sources[0].blockId = "changed-block";
  assert.equal(result.episodes[0].observations[0].kind, "inspection");
  assert.equal(result.episodes[0].blockId, "block-a");
});
