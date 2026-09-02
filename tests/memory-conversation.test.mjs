import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryConversationSegment, memoryConversationCoverage } from "../src/model/memory-conversation.ts";
import { memoryKey, memorySourceRef } from "../src/model/scoped-memory.ts";
import { hashMemoryText, memoryFixture, sourceMap } from "./helpers/scoped-memory.mjs";

function conversation(count = 8) {
  const f = memoryFixture({ targetScopeId: "document" });
  const rows = Array.from({ length: count }, (_, index) => {
    const role = index % 2 ? "assistant" : "user";
    const text = role === "user" ? `User requirement ${index}: keep the chart precise.` : `Possible approach ${index}: add a chart.`;
    const source = f.source({ id: `chat-${index}`, scopeId: "document", streamId: "private-conversation:alice", sequence: index * 3 + 2,
      contentHash: hashMemoryText(text), origin: role, speaker: role, independentEvidence: role === "user" });
    return { source, turn: { turnId: `turn-${Math.floor(index / 2)}`, conversationId: "conversation-1", role, status: "final", text, source: memorySourceRef(source) } };
  });
  const sources = sourceMap(rows.map((row) => row.source));
  const inventory = { conversationId: "conversation-1", scopeId: "document", completeFromStart: true, turns: rows.map((row) => row.turn) };
  const segment = (start, end, overrides = {}) => createMemoryConversationSegment({ id: `segment-${start}-${end}`, version: 1,
    inventory: { ...inventory, turns: inventory.turns.slice(start, end) }, ...overrides }, sources, f.access, f.graph);
  const coverage = (segments, overrides = {}) => memoryConversationCoverage({ inventory, segments, recentLimit: 2, ...overrides }, sources, f.access, f.graph);
  return { ...f, rows, sources, inventory, segment, coverage };
}

test("rolling context is an exact summarized prefix plus uncovered recent turns, despite unrelated-event sequence gaps", async () => {
  const f = conversation();
  const segments = [await f.segment(0, 4), await f.segment(4, 6)];
  const result = await f.coverage(segments);
  assert.equal(result.status, "ready");
  assert.equal(result.continuous, true);
  assert.equal(result.summarizedTurnIds.length, 6);
  assert.equal(result.recentTurnIds.length, 2);
  assert.deepEqual(result.omittedTurnIds, []);
  assert.equal(new Set([...result.summarizedTurnIds, ...result.recentTurnIds]).size, 8);
  assert.match(segments[0].record.body, /Assistant proposed \(not an accepted decision\)/u);
  assert.equal(segments[0].record.authority, "historical");
});

test("overlapping and duplicate segments never double-count source turns", async () => {
  const f = conversation(6);
  const first = await f.segment(0, 2), overlap = await f.segment(1, 4), next = await f.segment(2, 4);
  const result = await f.coverage([next, first, first, overlap]);
  assert.equal(result.continuous, true);
  assert.equal(result.segments.length, 2);
  assert.equal(result.summarizedTurnIds.length, 4);
});

test("lagging, gapped and partial inventories disclose missing coverage", async () => {
  const f = conversation(8);
  const first = await f.segment(0, 2), gap = await f.segment(4, 6);
  const result = await f.coverage([first, gap]);
  assert.equal(result.continuous, false);
  assert.equal(result.omittedTurnIds.length, 4);
  const partial = await f.coverage([], { inventory: { ...f.inventory, completeFromStart: false }, recentLimit: 8 });
  assert.equal(partial.completeFromStart, false);
  assert.equal(partial.continuous, false);
  assert.deepEqual(partial.omittedTurnIds, []);
});

test("pending/superseded answers are excluded; duplicate final messages are rejected", async () => {
  const f = conversation(4);
  f.inventory.turns[1].status = "pending";
  f.inventory.turns[2].status = "superseded";
  const result = await f.coverage([], { recentLimit: 8 });
  assert.equal(result.recentTurns.length, 2);
  assert.equal(result.recentTurns.some((turn) => turn.status !== "final"), false);
  const duplicate = structuredClone(f.inventory.turns[3]);
  f.inventory.turns.push(duplicate);
  assert.equal((await f.coverage([])).status, "blocked");
});

test("current content fingerprints invalidate summaries even when content IDs have not changed", async () => {
  const f = conversation(4);
  const segment = await f.segment(0, 2);
  const original = f.rows[0].source;
  const revised = { ...original, contentHash: hashMemoryText("Corrected same-reference content") };
  f.sources.set(memoryKey(original.custodianId, original.id), revised);
  assert.equal((await f.coverage([segment])).status, "blocked");
  f.inventory.turns[0] = { ...f.inventory.turns[0], text: "Corrected same-reference content", source: memorySourceRef(revised) };
  const current = await f.coverage([segment]);
  assert.equal(current.status, "ready");
  assert.equal(current.segments.length, 0);
  assert.equal(current.continuous, false);
});

test("mixed stream order, foreign actor, shared visibility and missing sources fail closed", async () => {
  for (const change of ["stream", "actor", "visibility", "missing", "expired"]) {
    const f = conversation(2), source = f.rows[0].source;
    const changed = { ...source, ...(change === "stream" ? { streamId: "another-ledger" } : change === "actor" ? { actorUserId: "bob" }
      : change === "visibility" ? { visibility: "shared" } : change === "expired" ? { expiresAt: f.access.now } : {}) };
    if (change === "missing") f.sources.delete(memoryKey(source.custodianId, source.id));
    else f.sources.set(memoryKey(source.custodianId, source.id), changed);
    f.inventory.turns[0].source = memorySourceRef(changed);
    assert.equal((await f.coverage([])).status, "blocked", change);
  }
});

test("extractive body and conversation claim tampering never acquire source coverage", async () => {
  const f = conversation(4), segment = await f.segment(0, 2);
  for (const patch of [{ body: "An invented accepted decision" }, { claimKey: "another-conversation" }]) {
    const result = await f.coverage([{ ...segment, record: { ...segment.record, ...patch } }]);
    assert.equal(result.segments.length, 0);
    assert.equal(result.continuous, false);
  }
});

test("conversation role is bound to authenticated speaker, not mutable turn labels or content origin", async () => {
  const f = conversation(2);
  f.inventory.turns = [{ ...f.inventory.turns[1], role: "user" }];
  assert.equal(await f.segment(0, 1), null);
  assert.equal((await f.coverage([])).status, "blocked");
  const assisted = conversation(1), original = assisted.rows[0].source;
  const source = { ...original, origin: "assistant", independentEvidence: false, speaker: "user" };
  assisted.sources.set(memoryKey(source.custodianId, source.id), source);
  assisted.inventory.turns[0].source = memorySourceRef(source);
  const segment = await assisted.segment(0, 1);
  assert.match(segment.record.body, /^User stated:/u);
  assert.equal(segment.record.lastIndependentEvidenceAt, null);
});

test("turn mutation during asynchronous hashing cannot misattribute new content to an old hash", async () => {
  const f = conversation(2), original = f.inventory.turns[0].text;
  const pending = f.segment(0, 2);
  f.inventory.turns[0].text = "INJECTED DURING HASHING";
  f.inventory.turns[0].status = "pending";
  const result = await pending;
  assert.match(result.record.body, new RegExp(original.replaceAll(".", "\\.")));
  assert.equal(result.record.body.includes("INJECTED"), false);
});

test("source revocation while a summary hashes aborts construction", async () => {
  const f = conversation(2);
  const pending = f.segment(0, 2);
  const original = f.rows[0].source;
  f.sources.set(memoryKey(original.custodianId, original.id), { ...original, state: "revoked" });
  assert.equal(await pending, null);
});

test("summary-byte budgets disclose gaps instead of dropping or rewriting recent context", async () => {
  const f = conversation(8), segment = await f.segment(0, 6);
  const before = structuredClone(f.inventory);
  const result = await f.coverage([segment], { summaryByteLimit: 0 });
  assert.equal(result.segments.length, 0);
  assert.equal(result.omittedTurnIds.length, 6);
  assert.equal(result.recentTurns.length, 2);
  assert.deepEqual(f.inventory, before);
});

test("source-ref property order does not change exact coverage", async () => {
  const f = conversation(4), segment = await f.segment(0, 2);
  segment.covered[0].source = Object.fromEntries(Object.entries(segment.covered[0].source).reverse());
  assert.equal((await f.coverage([segment])).continuous, true);
});
