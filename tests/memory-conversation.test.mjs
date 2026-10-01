import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryConversationSegment, memoryConversationCoverage, liveConversationDigest } from "../src/model/memory-conversation.ts";
import { memoryKey, memorySourceRef } from "../src/model/scoped-memory.ts";
import { hashMemoryText, memoryFixture, sourceMap } from "./helpers/scoped-memory.mjs";
import { nativeMemoryAssistantReply, nativeMemoryConversationDigest } from "../worker/memory-assistant-reply.ts";

test("live digest keeps exact role-bound quotes, negation and code-point references without changing clips", () => {
  const clips = [{ user: '  🧭 Do not publish! Keep "not accepted" in the draft.  ', assistant: "I could publish? That is only a suggestion." }];
  const before = structuredClone(clips), digest = liveConversationDigest(clips);
  assert.equal(digest.method, "local-extractive-quotes-v1"); assert.equal(digest.completeFromStart, false);
  assert.equal(digest.showOriginals, false); assert.deepEqual(digest.excerptOnly, []);
  assert.deepEqual(digest.quotes.map(quote => [quote.role, quote.text]), [
    ["user", "🧭 Do not publish!"], ["user", 'Keep "not accepted" in the draft.'],
    ["assistant", "I could publish?"], ["assistant", "That is only a suggestion."],
  ]);
  assert.equal(digest.quotes[0].references[0].start, 2);
  for (const quote of digest.quotes) for (const reference of quote.references) {
    assert.equal(reference.role, quote.role);
    assert.equal(Array.from(clips[reference.excerptIndex][reference.role]).slice(reference.start, reference.end).join(""), quote.text);
  }
  assert.deepEqual(clips, before);
});

test("live quote deduplication is exact and role-specific and retains every occurrence in source order", () => {
  const clips = [
    { user: "Keep this! Do not ship.", assistant: "Do not ship." },
    { user: "Do not ship.", assistant: "Do not ship." },
    { user: "Keep  this!", assistant: "A separate suggestion." },
  ];
  const digest = liveConversationDigest(clips);
  const repeated = digest.quotes.filter(quote => quote.text === "Do not ship.");
  assert.deepEqual(repeated.map(quote => quote.role), ["user", "assistant"]);
  assert.deepEqual(repeated.map(quote => quote.references.map(ref => ref.excerptIndex)), [[0, 1], [0, 1]]);
  assert.deepEqual(digest.quotes.map(quote => quote.text), ["Keep this!", "Do not ship.", "Do not ship.", "Keep  this!", "A separate suggestion."]);
  assert.equal(digest.showOriginals, true, "deduplication keeps the original chronology visibly available");
});

test("nonadjacent repeated live quotes do not conceal the latest reassertion behind collapsed originals", () => {
  const clips = ["Use blue.", "Use red.", "Use blue."].map((user, index) => ({ user, assistant: `Suggestion ${index}.` }));
  const digest = liveConversationDigest(clips);
  assert.deepEqual(digest.quotes.find(quote => quote.text === "Use blue.").references.map(ref => ref.excerptIndex), [0, 2]);
  assert.deepEqual(digest.excerptOnly, []); assert.equal(digest.showOriginals, true);
});

test("live digest preserves multilingual punctuation, balanced quoted sentences and apostrophes verbatim", () => {
  const digest = liveConversationDigest([
    { user: "変更しないで。次は確認です！", assistant: "هل ننتظر؟ نعم، ننتظر." },
    { user: '"Do not ship. Wait!" Then ask.', assistant: "Don't change users' choices! L’utilisateur décide." },
  ]);
  assert.deepEqual(digest.quotes.map(quote => quote.text), [
    "変更しないで。", "次は確認です！", "هل ننتظر؟", "نعم، ننتظر.",
    '"Do not ship. Wait!"', "Then ask.", "Don't change users' choices!", "L’utilisateur décide.",
  ]);
  assert.equal(digest.showOriginals, false);
});

test("French and Arabic guillemets stay balanced around quoted qualifications", () => {
  const clips = [{ user: "«Ne changez pas. Gardez le bleu.»", assistant: "«لا تغيّر. حافظ على الأزرق.»" },
    { user: "«Pourquoi? Attendez.»", assistant: "«لماذا؟ انتظر.»" }];
  const digest = liveConversationDigest(clips);
  assert.deepEqual(digest.quotes.map(quote => quote.text), clips.flatMap(clip => [clip.user, clip.assistant]));
  assert.equal(digest.showOriginals, false);
  assert.equal(liveConversationDigest([{ user: "«Ne changez pas.", assistant: "Wait." }]).showOriginals, true);
});

test("interior ASCII periods stay together instead of splitting abbreviations or numbered statements", () => {
  const clips = [{ user: "Do not rename Dr. Smith. No. 4 is correct.", assistant: "Use e.g. the exact title. It is not accepted." }];
  const digest = liveConversationDigest(clips);
  assert.deepEqual(digest.quotes.map(quote => quote.text), [clips[0].user, clips[0].assistant]);
  assert.equal(digest.showOriginals, false);
});

test("unpunctuated, code-like and unbalanced clips require visible original-excerpt fallback", () => {
  const digest = liveConversationDigest([
    { user: "please do not publish yet", assistant: "const selected = `draft`;" },
    { user: "「公開しないで。", assistant: "Quoted prose remains! But keep the unpunctuated qualifier" },
  ]);
  assert.equal(digest.showOriginals, true);
  assert.deepEqual(digest.excerptOnly.map(item => [item.excerptIndex, item.role, item.reason]), [
    [0, "user", "unfinished"], [0, "assistant", "unsupported"], [1, "user", "unsupported"], [1, "assistant", "unfinished"],
  ]);
  assert.deepEqual(digest.quotes.map(quote => quote.text), ["Quoted prose remains!"]);
  assert.equal(liveConversationDigest([{ user: "بدون علامات ترقيم", assistant: "句読点がない依頼" }]).quotes.length, 0);
});

test("a 512-code-point clip never promotes its boundary tail to a complete quote", () => {
  const user = "Keep this! " + "x".repeat(500) + ".";
  assert.equal(Array.from(user).length, 512);
  const digest = liveConversationDigest([{ user, assistant: "A short suggestion." }]);
  assert.deepEqual(digest.quotes.map(quote => quote.text), ["Keep this!", "A short suggestion."]);
  assert.deepEqual(digest.excerptOnly, [{ excerptIndex: 0, role: "user", reason: "clipped" }]);
  assert.equal(digest.showOriginals, true);
});

test("live quote selection is deterministic, bounded to eight units, and discloses every budget omission", () => {
  const clips = Array.from({ length: 6 }, (_, index) => ({ user: `Request ${index}! Qualification ${index}.`, assistant: `Suggestion ${index}! Alternative ${index}.` }));
  const digest = liveConversationDigest(clips);
  assert.deepEqual(digest, liveConversationDigest(clips)); assert.equal(digest.quotes.length, 8);
  assert.equal(digest.showOriginals, true); assert.equal(digest.excerptOnly.length, 12);
  assert.ok(digest.excerptOnly.every(item => item.reason === "budget"));
  assert.deepEqual(digest.quotes.map(quote => quote.text), ["Request 0!", "Suggestion 0!", "Request 1!", "Suggestion 1!",
    "Request 2!", "Suggestion 2!", "Request 3!", "Suggestion 3!"]);
});

test("the live digest UTF-8 budget omits whole quotes without splitting multibyte content", () => {
  const clips = Array.from({ length: 6 }, (_, index) => ({ user: "甲".repeat(500) + index + "。", assistant: "乙".repeat(500) + index + "。" }));
  const digest = liveConversationDigest(clips);
  assert.equal(digest.quotes.length, 1); assert.equal(digest.quotes[0].text, clips[0].user);
  assert.ok(digest.quotes.reduce((total, quote) => total + new TextEncoder().encode(quote.text).byteLength, 0) <= 2_048);
  assert.equal(digest.excerptOnly.length, 11); assert.equal(digest.showOriginals, true);
});

test("live digest has no invented coverage for empty input and rejects non-decoded bounds", () => {
  assert.deepEqual(liveConversationDigest([]), { method: "local-extractive-quotes-v1", completeFromStart: false, showOriginals: false, quotes: [], excerptOnly: [] });
  for (const clips of [Array.from({ length: 7 }, () => ({ user: "One.", assistant: "Two." })), [{ user: "x".repeat(513), assistant: "Two." }],
    [{ user: null, assistant: "Two." }], [null]]) assert.throws(() => liveConversationDigest(clips), /Invalid decoded live conversation clips/u);
});

for (const size of [509, 510, 511, 512]) test(`native conversation digest: ${size}-byte multilingual clips cannot promote their terminal span`, () => {
  const prefix = "Keep this! " + "甲".repeat(160);
  const user = prefix + "x".repeat(size - new TextEncoder().encode(prefix).byteLength - 1) + ".";
  assert.equal(new TextEncoder().encode(user).byteLength, size); assert.ok(Array.from(user).length < 512);
  const clips = [{ user, assistant: "A suggestion." }], native = liveConversationDigest(clips, "utf8-512");
  assert.deepEqual(native.quotes.map(quote => quote.text), ["Keep this!", "A suggestion."]);
  assert.deepEqual(native.excerptOnly, [{ excerptIndex: 0, role: "user", reason: "clipped" }]);
  assert.equal(native.showOriginals, true);
  assert.equal(liveConversationDigest(clips).quotes.length, 3, "legacy code-point clips retain their original contract");
});

test("native conversation digest: smaller complete native clips and legacy multibyte clips keep separate bounds", () => {
  const user = "甲".repeat(169) + ".";
  assert.equal(new TextEncoder().encode(user).byteLength, 508);
  assert.deepEqual(liveConversationDigest([{ user, assistant: "A suggestion." }], "utf8-512").excerptOnly, []);
  const legacy = [{ user: "甲".repeat(170) + "完成。", assistant: "A suggestion." }];
  assert.ok(liveConversationDigest(legacy).quotes.length > 0);
  assert.throws(() => liveConversationDigest(legacy, "utf8-512"), /Invalid decoded/);
  assert.throws(() => liveConversationDigest([{ user: "\ud800", assistant: "A suggestion." }], "utf8-512"), /Invalid decoded/);
  assert.throws(() => liveConversationDigest([], "unknown"), /Invalid decoded/);
});

// Pure presentation tests deliberately do not manufacture source authority.
// Actual admission, lineage and withdrawal are exercised by native consumer Worker tests.
function nativeConversationValue(clips) {
  return { actions: [], conversationPairs: clips.map((clip, index) => ({
    eventId: "native-source-" + index, turnId: "native-turn-" + index, sequence: index * 3 + 1,
    recordedAt: "2026-09-04T12:00:00.000Z", validUntil: "2026-09-04T12:01:00.000Z", ...clip,
  })) };
}

test("native conversation reply: source-bound repeated quotes retain role, exact offsets and correction chronology", () => {
  const value = nativeConversationValue(["Use blue.", "Use red.", "Use blue.", "Recent one", "Recent two"].map(user => ({ user, assistant: "Only a suggestion." })));
  value.conversationPairs[0].user = "  🧭 Use blue.";
  value.conversationPairs[2].user = "  🧭 Use blue.";
  const before = structuredClone(value), digest = nativeMemoryConversationDigest(value);
  assert.equal(digest.method, "source-bound-quotes-v1"); assert.equal(digest.completeFromStart, false);
  assert.deepEqual(digest.earlierQuotes.filter(quote => quote.role === "user").map(quote => quote.text), ["🧭 Use blue.", "Use red.", "🧭 Use blue."]);
  for (const quote of digest.earlierQuotes) {
    const pair = value.conversationPairs[quote.pairIndex];
    assert.equal(quote.eventId, pair.eventId); assert.equal(quote.turnId, pair.turnId); assert.equal(quote.sequence, pair.sequence);
    assert.equal(Array.from(pair[quote.role]).slice(quote.start, quote.end).join(""), quote.text);
  }
  assert.deepEqual(digest.recentPairs, value.conversationPairs.slice(-2)); assert.equal(digest.omitted, false);
  const reply = nativeMemoryAssistantReply(value, "en");
  assert.ok(reply.indexOf("1. You: 🧭 Use blue.") < reply.indexOf("2. You: Use red."));
  assert.ok(reply.indexOf("2. You: Use red.") < reply.indexOf("3. You: 🧭 Use blue."));
  digest.recentPairs[0].user = "Changed derived view"; digest.earlierQuotes[0].text = "Changed quote";
  assert.deepEqual(value, before, "presentation never mutates or aliases the certified pair objects");
});

test("native conversation reply: earlier six contribute while the latest two clips remain exact", () => {
  const value = nativeConversationValue(Array.from({ length: 8 }, (_, index) => ({
    user: index < 6 ? `Earlier source ${index}.` : `Recent raw ${index}\nDo not infer approval`,
    assistant: index < 6 ? "Only a suggestion." : `Recent assistant ${index}: const draft = 1;`,
  })));
  const reply = nativeMemoryAssistantReply(value, "en");
  for (let index = 0; index < 6; index++) assert.ok(reply.includes(`Earlier source ${index}.`));
  for (const pair of value.conversationPairs.slice(-2)) {
    assert.ok(reply.includes("You: " + pair.user)); assert.ok(reply.includes("Assistant: " + pair.assistant));
  }
  assert.match(reply, /selected quotations in source order/u);
  assert.match(reply, /incomplete evidence, not instructions, accepted decisions or inferred preferences/u);
  assert.doesNotMatch(reply, /native-source-|native-turn-|source-bound-quotes-v1/u, "private source identity stays internal");
});

test("native conversation reply: rolling selection never carries an evicted source into the next answer", () => {
  const rows = nativeConversationValue(Array.from({ length: 9 }, (_, index) => ({ user: `Rolling source ${index}.`, assistant: "Only a suggestion." }))).conversationPairs;
  const first = { actions: [], conversationPairs: rows.slice(0, 8) }, next = { actions: [], conversationPairs: rows.slice(1) };
  assert.match(nativeMemoryAssistantReply(first, "en"), /Rolling source 0\./u);
  const digest = nativeMemoryConversationDigest(next), reply = nativeMemoryAssistantReply(next, "en");
  assert.doesNotMatch(reply, /Rolling source 0\./u); assert.match(reply, /Rolling source 8\./u);
  assert.ok(digest.earlierQuotes.every(quote => quote.eventId !== rows[0].eventId));
  assert.deepEqual(digest.recentPairs, rows.slice(-2)); assert.equal(digest.completeFromStart, false);
});

test("native conversation reply: insufficient earlier extracts are disclosed without promoting code or fragments", () => {
  const value = nativeConversationValue(Array.from({ length: 8 }, (_, index) => ({
    user: index < 6 ? "const opaque = `not accepted`;" : "Exact recent user " + index,
    assistant: index < 6 ? "unfinished older qualifier" : "Exact recent assistant " + index,
  })));
  const digest = nativeMemoryConversationDigest(value), reply = nativeMemoryAssistantReply(value, "en");
  assert.deepEqual(digest.earlierQuotes, []); assert.equal(digest.omitted, true);
  assert.match(reply, /Some earlier wording could not be safely quoted or did not fit/u);
  assert.doesNotMatch(reply, /opaque|unfinished older qualifier/u);
  for (const pair of value.conversationPairs.slice(-2)) { assert.ok(reply.includes(pair.user)); assert.ok(reply.includes(pair.assistant)); }
});

test("native conversation reply: repeated occurrence and UTF-8 budgets disclose omission and preserve the recent tail in every locale", () => {
  const repeated = nativeConversationValue(Array.from({ length: 8 }, () => ({ user: "Repeat! ".repeat(50), assistant: "Suggestion! ".repeat(40) })));
  const digest = nativeMemoryConversationDigest(repeated);
  assert.equal(digest.earlierQuotes.length, 16); assert.equal(digest.omitted, true);
  assert.ok(digest.earlierQuotes.reduce((sum, quote) => sum + new TextEncoder().encode(quote.text).byteLength, 0) <= 2_048);
  const large = nativeConversationValue(Array.from({ length: 8 }, (_, index) => ({
    user: index < 6 ? "甲".repeat(100) + index + "! " + "x".repeat(208) : "😀".repeat(128),
    assistant: index < 6 ? "乙".repeat(100) + index + "! " + "y".repeat(208) : "🧭".repeat(128),
  })));
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const reply = nativeMemoryAssistantReply(large, locale);
    assert.equal(typeof reply, "string"); assert.equal(reply.isWellFormed(), true);
    assert.ok(new TextEncoder().encode(reply).byteLength <= 8_192);
    for (const pair of large.conversationPairs.slice(-2)) { assert.ok(reply.includes(pair.user)); assert.ok(reply.includes(pair.assistant)); }
  }
});

test("native conversation reply: invalid pair identity, chronology or byte bounds fail closed", () => {
  const valid = nativeConversationValue([{ user: "One.", assistant: "Suggestion." }, { user: "Two.", assistant: "Suggestion." }]);
  const invalid = [
    value => { value.conversationPairs[1].eventId = value.conversationPairs[0].eventId; },
    value => { value.conversationPairs[1].turnId = value.conversationPairs[0].turnId; },
    value => { value.conversationPairs.reverse(); },
    value => { value.conversationPairs[0].user = "甲".repeat(171); },
    value => { value.conversationPairs[0].assistant = "\ud800"; },
    value => { value.conversationPairs = Array.from({ length: 9 }, () => value.conversationPairs[0]); },
  ];
  for (const mutate of invalid) {
    const value = structuredClone(valid); mutate(value);
    assert.equal(nativeMemoryConversationDigest(value), null); assert.equal(nativeMemoryAssistantReply(value, "en"), null);
  }
  assert.equal(nativeMemoryAssistantReply({ actions: [], conversationPairs: [] }, "en"), null);
  const actions = { actions: [{ eventId: "action" }], conversationPairs: [] };
  assert.equal(nativeMemoryConversationDigest(actions).completeFromStart, false);
  assert.match(nativeMemoryAssistantReply(actions, "en"), /Recorded actions: 1\./u);
});

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

// Structured declarations are caller-supplied evidence labels, not an LLM summary,
// authenticated acceptance, or an independently complete/durable conversation ledger.
import { createStructuredMemoryConversationSegment, structuredMemoryConversationCoverage } from "../src/model/memory-conversation.ts";

function declaredConversation(texts, roles = texts.map(() => "user")) {
  const f = conversation(texts.length);
  for (let index = 0; index < texts.length; index++) {
    const role = roles[index], text = texts[index];
    const source = { ...f.rows[index].source, contentHash: hashMemoryText(text), speaker: role,
      origin: role, independentEvidence: role === "user" };
    const turn = { ...f.rows[index].turn, turnId: `declared-turn-${index}`, role, text, source: memorySourceRef(source) };
    f.rows[index] = { source, turn }; f.inventory.turns[index] = turn;
    f.sources.set(memoryKey(source.custodianId, source.id), source);
  }
  const annotation = (index, itemId, category = "goal", overrides = {}) => {
    const turn = f.inventory.turns[index];
    return { itemId, revision: 1, category, operation: "assert", turnId: turn.turnId, role: turn.role,
      source: { ...turn.source }, start: 0, end: Array.from(turn.text).length, text: turn.text,
      predecessor: null, ...overrides };
  };
  const structuredSegment = (annotations, { start = 0, end = f.inventory.turns.length, ...overrides } = {}) =>
    createStructuredMemoryConversationSegment({ id: `declared-segment-${start}-${end}`, version: 1,
      inventory: { ...f.inventory, turns: f.inventory.turns.slice(start, end) }, annotations, ...overrides }, f.sources, f.access, f.graph);
  const structuredCoverage = (annotations, segments, overrides = {}, suppressions = []) =>
    structuredMemoryConversationCoverage({ inventory: f.inventory, annotations, segments,
      recentLimit: 2, summaryByteLimit: 8_192, ...overrides }, f.sources, f.access, f.graph, suppressions);
  return { ...f, annotation, structuredSegment, structuredCoverage };
}
function declaredReference(annotation) {
  const { predecessor, ...reference } = annotation;
  assert.ok(predecessor === null || typeof predecessor === "object");
  return structuredClone(reference);
}
const declaredRevision = (f, index, previous, operation) => f.annotation(index, previous.itemId, previous.category,
  { revision: previous.revision + 1, operation, predecessor: declaredReference(previous) });
const declaredTurnKey = turn => JSON.stringify([turn.turnId, turn.role]);

test("structured conversation: seven declared categories retain exact Unicode quotes without promoting semantic authority", async () => {
  const categories = ["goal", "decision", "proposal", "rejected-alternative", "question", "blocker", "next-step"];
  const f = declaredConversation(categories.map(category => `  🧭 ${category}: ne pas publier。  `));
  const annotations = categories.map((category, index) => f.annotation(index, `item-${index}`, category,
    { start: 2, end: Array.from(f.inventory.turns[index].text).length - 2, text: f.inventory.turns[index].text.trim() }));
  const before = structuredClone({ inventory: f.inventory, annotations });
  const segment = await f.structuredSegment(annotations);
  assert.ok(segment); assert.equal(segment.record.authority, "historical");
  assert.equal(segment.semanticAuthority, "caller-declared-unverified"); assert.equal(segment.semanticCompleteness, false);
  assert.deepEqual(segment.items.map(item => [item.category, item.role, item.current.text]),
    annotations.map(annotation => [annotation.category, "user", annotation.text]));
  for (const item of segment.items) {
    const reference = item.current, turn = f.inventory.turns.find(turn => turn.turnId === reference.turnId);
    assert.deepEqual(reference.source, turn.source);
    assert.equal(Array.from(turn.text).slice(reference.start, reference.end).join(""), reference.text);
  }
  const result = await f.structuredCoverage(annotations, [segment]);
  assert.equal(result.status, "ready"); assert.equal(result.continuous, true);
  assert.equal(result.semanticCompleteness, false, "complete structural coverage does not verify caller-declared meaning");
  assert.deepEqual(result.items, segment.items);
  result.items[0].current.text = "Mutated returned view";
  assert.deepEqual({ inventory: f.inventory, annotations }, before);
  assert.equal(segment.items[0].current.text, annotations[0].text, "returned structured views do not alias stored segments");
});

test("structured conversation: assistant proposals stay separate and cannot decide or revise a user claim", async () => {
  const f = declaredConversation(["Keep blue.", "Keep blue."], ["user", "assistant"]);
  const user = f.annotation(0, "user-goal"), proposal = f.annotation(1, "assistant-proposal", "proposal");
  const segment = await f.structuredSegment([user, proposal]);
  assert.ok(segment); assert.deepEqual(segment.items.map(item => [item.itemId, item.role, item.category]),
    [["user-goal", "user", "goal"], ["assistant-proposal", "assistant", "proposal"]]);
  assert.equal(await f.structuredSegment([user, { ...proposal, category: "decision" }]), null);
  const crossRole = declaredRevision(f, 1, user, "correct");
  assert.equal(await f.structuredSegment([user, crossRole]), null);
  const blocked = await f.structuredCoverage([user, crossRole], [segment]);
  assert.equal(blocked.status, "blocked"); assert.deepEqual(blocked.items, []);
});

test("structured conversation: stale identity, actor, scope, role, hash and non-code-point spans never certify quoted text", async () => {
  const f = declaredConversation(["  🧭 Keep é exactly.  "]);
  const valid = f.annotation(0, "goal", "goal", { start: 2, end: Array.from(f.inventory.turns[0].text).length - 2,
    text: f.inventory.turns[0].text.trim() });
  assert.ok(await f.structuredSegment([valid]));
  const changes = [
    a => { a.source.actorUserId = "bob"; }, a => { a.source.scopeId = "other-document"; },
    a => { a.source.revision = "r2"; }, a => { a.source.contentHash = "0".repeat(64); },
    a => { a.turnId = "another-turn"; }, a => { a.role = "assistant"; },
    a => { a.start = 3; }, a => { a.text = a.text.normalize("NFC"); },
    a => { a.text = "\ud800"; },
  ];
  for (const change of changes) {
    const annotation = structuredClone(valid); change(annotation);
    assert.equal(await f.structuredSegment([annotation]), null);
    assert.equal((await f.structuredCoverage([annotation], [])).status, "blocked");
  }
  const invalidUnicode = declaredConversation(["Do not replace this unpaired \ud800 character."]);
  assert.equal(await invalidUnicode.structuredSegment([invalidUnicode.annotation(0, "goal")]), null);
});

test("structured conversation: corrections, supersession, withdrawal and linked reassertion retain every exact predecessor", async () => {
  const f = declaredConversation(["Use blue.", "Correction: use red.", "Replace red with green.", "Withdraw that choice.", "Reassert blue explicitly."]);
  const first = f.annotation(0, "color", "decision"), corrected = declaredRevision(f, 1, first, "correct");
  const superseded = declaredRevision(f, 2, corrected, "supersede"), withdrawn = declaredRevision(f, 3, superseded, "withdraw");
  const reasserted = declaredRevision(f, 4, withdrawn, "correct"), annotations = [first, corrected, superseded, withdrawn, reasserted];
  const withdrawnSegment = await f.structuredSegment(annotations.slice(0, 4), { end: 4 });
  assert.equal(withdrawnSegment.items[0].state, "withdrawn");
  const segment = await f.structuredSegment(annotations);
  assert.ok(segment); assert.equal(segment.items.length, 1); assert.equal(segment.items[0].state, "asserted");
  assert.deepEqual(segment.items[0].current, declaredReference(reasserted));
  assert.deepEqual(segment.items[0].history, annotations);
  assert.deepEqual(segment.record.sources, f.inventory.turns.map(turn => turn.source));
  assert.deepEqual(segment.covered.map(declaredTurnKey), f.inventory.turns.map(declaredTurnKey));
  const result = await f.structuredCoverage(annotations, [segment]);
  assert.equal(result.status, "ready"); assert.deepEqual(result.items[0].history.map(a => a.operation),
    ["assert", "correct", "supersede", "withdraw", "correct"]);
  const restarted = f.annotation(4, "color", "decision");
  assert.equal(await f.structuredSegment([...annotations.slice(0, 4), restarted]), null,
    "a fresh revision1 cannot erase a prior withdrawal of the same item");
});

test("structured conversation: missing, forward, cyclic, stale and ambiguous revision targets block fallback to older claims", async () => {
  const f = declaredConversation(["Use blue.", "Use red.", "Use green."]);
  const first = f.annotation(0, "color"), second = declaredRevision(f, 1, first, "correct");
  const third = declaredRevision(f, 2, second, "supersede"), old = await f.structuredSegment([first], { end: 1 });
  const variants = [
    [{ ...first, predecessor: false }], [{ ...first, predecessor: 0 }], [{ ...first, predecessor: "" }],
    [{ ...second, predecessor: null }],
    [first, { ...second, predecessor: { ...declaredReference(first), itemId: "absent" } }],
    [first, { ...second, predecessor: declaredReference(third) }, third],
    [first, { ...second, predecessor: declaredReference(second) }],
    [first, { ...second, predecessor: declaredReference(third) }, { ...third, predecessor: declaredReference(second) }],
    [first, second, { ...third, predecessor: declaredReference(first) }],
    [first, second, { ...second, category: "question" }],
    [first, { ...second, category: "question" }],
  ];
  for (const annotations of variants) {
    assert.equal(await f.structuredSegment(annotations), null);
    const result = await f.structuredCoverage(annotations, [old]);
    assert.equal(result.status, "blocked"); assert.deepEqual(result.items, []);
  }
});

test("structured conversation: same-turn revisions use exact increasing Unicode spans, not input array position", async () => {
  const firstText = "🧭 Use blue.", secondText = "Use red.", text = firstText + " " + secondText;
  const f = declaredConversation([text]);
  const first = f.annotation(0, "color", "goal", { end: Array.from(firstText).length, text: firstText });
  const second = f.annotation(0, "color", "goal", { revision: 2, operation: "correct", predecessor: declaredReference(first),
    start: Array.from(firstText).length + 1, end: Array.from(text).length, text: secondText });
  const segment = await f.structuredSegment([first, second]);
  assert.ok(segment); assert.equal(segment.items[0].current.text, secondText);
  const reordered = structuredClone([second, first]);
  for (const annotation of reordered) {
    annotation.source = Object.fromEntries(Object.entries(annotation.source).reverse());
    if (annotation.predecessor)
      annotation.predecessor.source = Object.fromEntries(Object.entries(annotation.predecessor.source).reverse());
  }
  assert.deepEqual(await f.structuredSegment(reordered), segment,
    "input order and source-ref key order cannot change canonical body or correction history");
  const samePlace = { ...second, start: first.start, end: first.end, text: first.text };
  assert.equal(await f.structuredSegment([first, samePlace]), null);
  const overlapping = { ...second, start: 2, text: Array.from(text).slice(2).join("") };
  assert.equal(await f.structuredSegment([first, overlapping]), null,
    "a later starting offset does not establish a causal correction when its quote still overlaps the predecessor");
  const backwards = { ...first, revision: 3, operation: "correct", predecessor: declaredReference(second) };
  assert.equal(await f.structuredSegment([first, second, backwards]), null);
});

test("structured conversation: expired or revoked correction evidence never revives its still-fresh predecessor", async () => {
  for (const change of ["expired", "revoked"]) {
    const f = declaredConversation(["Use blue.", "Correction: use red."]);
    const first = f.annotation(0, "color"), correction = declaredRevision(f, 1, first, "correct");
    const old = await f.structuredSegment([first], { end: 1 }), current = await f.structuredSegment([first, correction]);
    assert.equal((await f.structuredCoverage([first, correction], [current])).status, "ready");
    assert.equal((await f.structuredCoverage([first, correction], [old, current])).status, "ready",
      "a valid newer full chain can supersede the obsolete positive segment in a rolling pool");
    const source = f.rows[1].source;
    f.sources.set(memoryKey(source.custodianId, source.id), { ...source,
      ...(change === "expired" ? { expiresAt: f.access.now } : { state: "revoked" }) });
    assert.equal(f.sources.get(memoryKey(f.rows[0].source.custodianId, f.rows[0].source.id)).state, "active");
    const result = await f.structuredCoverage([first, correction], [current]);
    assert.equal(result.status, "blocked", change); assert.deepEqual(result.items, []);
    const pool = await f.structuredCoverage([first, correction], [old, current]);
    assert.equal(pool.status, "blocked"); assert.deepEqual(pool.items, [],
      "including the older segment cannot restore its predecessor claim");
  }
});

test("structured conversation: conversation suppression and correction-lineage suppression cannot be bypassed by an old or rekeyed segment", async () => {
  const canary = "PRIVATE SUPPRESSED SOURCE", f = declaredConversation([`${canary}: Use blue.`, `Withdraw ${canary}.`]);
  const assertSuppressed = (result, label) => {
    assert.equal(result.status, "blocked", label); assert.equal(result.validUntil, null);
    for (const field of ["segments", "items", "recentTurns", "examinedTurnIds", "annotatedTurnIds",
      "unannotatedTurnIds", "recentTurnIds", "omittedTurnIds"]) assert.deepEqual(result[field], [], `${label}: ${field}`);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(canary), false);
    for (const turn of f.inventory.turns) {
      assert.equal(serialized.includes(turn.turnId), false); assert.equal(serialized.includes(turn.source.id), false);
    }
  };
  const first = f.annotation(0, "color"), withdrawal = declaredRevision(f, 1, first, "withdraw");
  const old = await f.structuredSegment([first], { end: 1 }), current = await f.structuredSegment([first, withdrawal]);
  assert.equal((await f.structuredCoverage([first, withdrawal], [current])).status, "ready");
  assert.equal((await f.structuredCoverage([first, withdrawal], [old, current])).status, "ready");
  const invalid = { ...current, record: { ...current.record, body: "A fabricated structured body" } };
  const beforeSuppression = await f.structuredCoverage([first, withdrawal], [invalid]);
  assert.equal(beforeSuppression.status, "blocked");
  assert.deepEqual(beforeSuppression.recentTurns.map(turn => turn.text), f.inventory.turns.map(turn => turn.text));
  for (const by of ["conversation", "lineage"]) {
    const suppression = { actorUserId: f.access.actorUserId, custodianId: f.access.custodianId, scopeId: "document",
      claimKey: by === "conversation" ? current.record.claimKey : "unrelated-suppression-claim",
      lineageIds: by === "lineage" ? [withdrawal.source.lineageId] : [], state: "active" };
    const rekeyed = { ...current, record: { ...current.record, id: "another-record", claimKey: "another-claim" } };
    for (const unrelated of [{ ...suppression, actorUserId: "bob" }, { ...suppression, custodianId: "org:beta" },
      ...(by === "conversation" ? [{ ...suppression, scopeId: "other-document" }] : [])]) {
      const allowed = await f.structuredCoverage([first, withdrawal], [current], {}, [unrelated]);
      assert.equal(allowed.status, "ready"); assert.deepEqual(allowed.items, current.items);
    }
    // The current-only lineage case uses an unrelated claim key. Invalid/rekeyed
    // segments separately exercise suppression before any raw-history fallback.
    const cases = [[current], [old, current], [], [invalid], [rekeyed]].map(segments =>
      ({ annotations: [first, withdrawal], segments, overrides: {} }));
    if (by === "lineage") {
      const forgedInventory = structuredClone(f.inventory), forgedAnnotations = structuredClone([first, withdrawal]);
      const falseLineage = "caller-invented-unsuppressed-lineage", forgedCurrent = structuredClone(current);
      forgedInventory.turns[1].source.lineageId = falseLineage; forgedAnnotations[1].source.lineageId = falseLineage;
      for (const ref of [forgedCurrent.record.sources[1], forgedCurrent.covered[1].source,
        forgedCurrent.annotations[1].source, forgedCurrent.items[0].current.source, forgedCurrent.items[0].history[1].source])
        ref.lineageId = falseLineage;
      assert.equal(forgedInventory.turns[1].source.id, withdrawal.source.id);
      assert.equal(f.sources.get(memoryKey(withdrawal.source.custodianId, withdrawal.source.id)).lineageId,
        withdrawal.source.lineageId, "the current source map still knows this referenced event's suppressed lineage");
      // No intact current segment supplies the real negative lineage in these cases.
      // This is tampering with a known reference, not omission of an unknown ledger.
      for (const segments of [[], [old], [forgedCurrent]])
        cases.push({ annotations: forgedAnnotations, segments, overrides: { inventory: forgedInventory } });
    }
    for (const { annotations, segments, overrides } of cases) {
      const result = await f.structuredCoverage(annotations, segments, overrides, [suppression]);
      assertSuppressed(result, by);
    }
  }
  const lateLineage = "lineage-suppressed-during-hashing";
  const alreadyActive = { actorUserId: f.access.actorUserId, custodianId: f.access.custodianId, scopeId: "document",
    claimKey: "unrelated-active-claim", lineageIds: [lateLineage], state: "active" };
  assert.equal((await f.structuredCoverage([first, withdrawal], [current], {}, [alreadyActive])).status, "ready");
  const pending = f.structuredCoverage([first, withdrawal], [current], {}, [alreadyActive]);
  const key = memoryKey(withdrawal.source.custodianId, withdrawal.source.id), actual = f.sources.get(key);
  f.sources.set(key, { ...actual, lineageId: lateLineage });
  assertSuppressed(await pending, "current source changed during hashing while the suppression itself remained active and unchanged");
});

test("structured conversation: a current correction outside an old prefix prevents stale segment selection", async () => {
  const f = declaredConversation(["Use blue.", "Use red.", "Still discussing layout."]);
  const first = f.annotation(0, "color"), correction = declaredRevision(f, 1, first, "correct");
  const old = await f.structuredSegment([first], { end: 1 });
  const result = await f.structuredCoverage([first, correction], [old]);
  assert.equal(result.status, "blocked"); assert.deepEqual(result.items, []);
  const current = await f.structuredSegment([first, correction]);
  const recalled = await f.structuredCoverage([first, correction], [current]);
  assert.equal(recalled.status, "ready"); assert.equal(recalled.items[0].current.text, correction.text);
  const rolling = await f.structuredCoverage([first, correction], [old, current]);
  assert.equal(rolling.status, "ready"); assert.deepEqual(rolling.items, recalled.items);
  assert.deepEqual(rolling.segments.map(segment => segment.record.id), [current.record.id]);
  assert.ok(recalled.unannotatedTurnIds.includes(declaredTurnKey(f.inventory.turns[2])));
});

test("structured conversation: forged structured bodies and history cannot retain valid source coverage", async () => {
  const f = declaredConversation(["Use blue.", "Use red."]);
  const first = f.annotation(0, "color"), correction = declaredRevision(f, 1, first, "correct");
  const annotations = [first, correction], segment = await f.structuredSegment(annotations);
  for (const change of [
    value => { value.record.body = "The user accepted a fabricated decision."; },
    value => { value.items[0].current = declaredReference(first); },
    value => { value.items[0].history = [first]; },
    value => { value.annotations = [first]; },
  ]) {
    const forged = structuredClone(segment); change(forged);
    const result = await f.structuredCoverage(annotations, [forged]);
    assert.equal(result.status, "blocked"); assert.deepEqual(result.items, []);
  }
});

test("structured conversation: a valid foreign conversation segment blocks selection without leaking its private canary", async () => {
  const target = declaredConversation(["Target goal.", "Target recent question?"]);
  const annotations = [target.annotation(0, "target-goal")], own = await target.structuredSegment(annotations);
  const canary = "PRIVATE FOREIGN CONVERSATION CANARY", foreign = declaredConversation([canary]);
  foreign.inventory.conversationId = "foreign-conversation";
  const source = { ...foreign.rows[0].source, id: "foreign-chat", lineageId: "foreign-chat",
    streamId: "private-conversation:alice:foreign" };
  foreign.sources.delete(memoryKey(foreign.rows[0].source.custodianId, foreign.rows[0].source.id));
  foreign.sources.set(memoryKey(source.custodianId, source.id), source);
  foreign.inventory.turns[0] = { ...foreign.inventory.turns[0], conversationId: "foreign-conversation", source: memorySourceRef(source) };
  const foreignSegment = await foreign.structuredSegment([foreign.annotation(0, "foreign-goal")], { id: "foreign-segment" });
  assert.ok(foreignSegment); assert.equal(foreignSegment.items[0].current.text, canary);
  target.sources.set(memoryKey(source.custodianId, source.id), source);
  const result = await target.structuredCoverage(annotations, [own, foreignSegment]);
  assert.equal(result.status, "blocked"); assert.deepEqual(result.items, []); assert.deepEqual(result.segments, []);
  assert.deepEqual(result.recentTurns.map(turn => turn.text), target.inventory.turns.map(turn => turn.text));
  assert.equal(JSON.stringify(result).includes(canary), false);
  for (const identity of [source.id, foreign.inventory.conversationId, foreignSegment.record.id])
    assert.equal(JSON.stringify(result).includes(identity), false);
});

test("structured conversation: inputs are captured before hashing and returned history never aliases caller annotations", async () => {
  const f = declaredConversation(["Keep blue.", "Correction: keep red."]);
  const first = f.annotation(0, "color"), second = declaredRevision(f, 1, first, "correct");
  const annotations = [first, second], before = structuredClone(annotations);
  const pending = f.structuredSegment(annotations);
  annotations[1].text = "INJECTED"; annotations[1].predecessor.text = "INJECTED PREDECESSOR";
  f.inventory.turns[1].text = "INJECTED TURN";
  const segment = await pending;
  assert.ok(segment); assert.deepEqual(segment.items[0].history, before);
  assert.equal(segment.record.body.includes("INJECTED"), false);
  segment.items[0].history[0].text = "Mutated result";
  assert.equal(annotations[0].text, before[0].text);
});

test("structured conversation: source or grant revocation during hashing aborts creation and recall", async () => {
  for (const phase of ["create", "recall"]) for (const change of ["source", "grant"]) {
    const f = declaredConversation(["Use blue.", "Use red."]);
    const first = f.annotation(0, "color"), second = declaredRevision(f, 1, first, "correct"), annotations = [first, second];
    const segment = phase === "recall" ? await f.structuredSegment(annotations) : null;
    const pending = phase === "create" ? f.structuredSegment(annotations) : f.structuredCoverage(annotations, [segment]);
    if (change === "source") {
      const source = f.rows[1].source;
      f.sources.set(memoryKey(source.custodianId, source.id), { ...source, state: "revoked" });
    } else f.access.grants = f.access.grants.map(grant => grant.scopeId === "document" ? { ...grant, canRead: false } : grant);
    const result = await pending;
    if (phase === "create") assert.equal(result, null, change);
    else {
      assert.equal(result.status, "blocked", change); assert.deepEqual(result.items, []);
      assert.equal(JSON.stringify(result).includes(second.text), false);
      assert.equal(JSON.stringify(result).includes(second.source.id), false);
    }
  }
});

test("structured conversation: recall while learning is paused preserves the original evidence lease without renewal", async () => {
  const f = declaredConversation(["Keep blue."]);
  const annotations = [f.annotation(0, "color")], segment = await f.structuredSegment(annotations);
  const original = structuredClone(segment), first = await f.structuredCoverage(annotations, [segment]);
  f.access.grants = f.access.grants.map(grant => ({ ...grant, purposes: ["recall"] }));
  f.access.now = "2026-09-03T06:00:00.000Z";
  const next = await f.structuredCoverage(annotations, [segment]);
  assert.equal(next.status, "ready"); assert.equal(next.items[0].current.text, annotations[0].text);
  assert.equal(next.validUntil, first.validUntil);
  assert.ok(Date.parse(next.validUntil) <= Date.parse(original.record.expiresAt));
  assert.deepEqual(segment, original);
  assert.equal(await f.structuredSegment(annotations, { id: "not-a-read-renewal", version: 2 }), null);
  f.access.now = original.record.expiresAt;
  const expired = await f.structuredCoverage(annotations, [segment]);
  assert.equal(expired.status, "blocked"); assert.deepEqual(expired.items, []);
});

test("structured conversation: coverage distinguishes examined, unannotated, recent and missing middle turns", async () => {
  const f = declaredConversation(Array.from({ length: 8 }, (_, index) => `Exact statement ${index}.`));
  const earliest = "2026-09-02T06:00:01.000Z", short = { ...f.rows[3].source, expiresAt: earliest };
  f.rows[3].source = short; f.sources.set(memoryKey(short.custodianId, short.id), short);
  const annotations = [0, 2, 4].map(index => f.annotation(index, `item-${index}`));
  const prefix = await f.structuredSegment([annotations[0]], { end: 2 });
  const gap = await f.structuredSegment([annotations[2]], { start: 4, end: 6 });
  const result = await f.structuredCoverage(annotations, [prefix, gap]);
  const keys = f.inventory.turns.map(declaredTurnKey);
  assert.equal(result.status, "ready"); assert.equal(result.continuous, false);
  assert.deepEqual(result.examinedTurnIds, keys);
  assert.deepEqual(result.annotatedTurnIds, [keys[0], keys[2], keys[4]]);
  assert.deepEqual(result.unannotatedTurnIds, [keys[1], keys[3], keys[5], keys[6], keys[7]]);
  assert.deepEqual(result.recentTurnIds, keys.slice(6)); assert.deepEqual(result.omittedTurnIds, keys.slice(2, 6));
  assert.deepEqual(result.recentTurns.map(turn => turn.text), f.inventory.turns.slice(6).map(turn => turn.text));
  assert.equal(result.validUntil, earliest, "an unannotated omitted-middle source still bounds the exposed inventory metadata");
  const budgeted = await f.structuredCoverage(annotations, [prefix, gap], { summaryByteLimit: 0 });
  assert.equal(budgeted.status, "ready"); assert.deepEqual(budgeted.segments, []);
  assert.deepEqual(budgeted.recentTurnIds, keys.slice(6)); assert.equal(budgeted.validUntil, earliest);
  const malformed = { ...prefix, record: { ...prefix.record, body: "Forged body" } };
  const fallback = await f.structuredCoverage(annotations, [malformed]);
  assert.equal(fallback.status, "blocked"); assert.deepEqual(fallback.items, []);
  assert.deepEqual(fallback.examinedTurnIds, keys); assert.deepEqual(fallback.omittedTurnIds, keys.slice(0, 6));
  assert.deepEqual(fallback.recentTurnIds, keys.slice(6)); assert.equal(fallback.validUntil, earliest,
    "raw-only fallback also expires with the earliest source whose identity it exposes");
  const partial = await f.structuredCoverage(annotations, [], { inventory: { ...f.inventory, completeFromStart: false }, recentLimit: 8 });
  assert.equal(partial.completeFromStart, false); assert.equal(partial.continuous, false);
  assert.equal(partial.semanticCompleteness, false); assert.deepEqual(partial.omittedTurnIds, []);
});

test("structured conversation: an insufficient UTF-8 budget omits a whole structured segment and discloses the unsummarized prefix", async () => {
  const f = declaredConversation(["🧭 保持藍色。", "Do not infer acceptance.", "Recent question?", "Recent proposal."]);
  const annotations = [f.annotation(0, "color"), f.annotation(1, "qualification", "blocker")];
  const segment = await f.structuredSegment(annotations, { end: 2 }), before = structuredClone(segment);
  const bytes = new TextEncoder().encode(segment.record.body).byteLength;
  const fit = await f.structuredCoverage(annotations, [segment], { summaryByteLimit: bytes });
  assert.equal(fit.segments.length, 1); assert.deepEqual(fit.items, segment.items);
  const omitted = await f.structuredCoverage(annotations, [segment], { summaryByteLimit: bytes - 1 });
  assert.equal(omitted.status, "ready"); assert.deepEqual(omitted.segments, []); assert.deepEqual(omitted.items, []);
  assert.deepEqual(omitted.omittedTurnIds, f.inventory.turns.slice(0, 2).map(declaredTurnKey));
  assert.deepEqual(omitted.recentTurns.map(turn => turn.text), f.inventory.turns.slice(2).map(turn => turn.text));
  assert.equal(omitted.continuous, false); assert.equal(omitted.semanticCompleteness, false); assert.deepEqual(segment, before);
});

test("structured conversation: stateless coverage cannot authenticate an entire correction annotation omitted by its caller", async () => {
  const f = declaredConversation(["Use blue.", "Correction: use red."]);
  const first = f.annotation(0, "color"), correction = declaredRevision(f, 1, first, "correct");
  const old = await f.structuredSegment([first], { end: 1 });
  assert.equal((await f.structuredCoverage([first, correction], [old])).status, "blocked");
  // This is deliberately not a durable-ledger guarantee: the complete turn text is
  // still present, but a pure model cannot infer the caller's omitted declaration.
  const omitted = await f.structuredCoverage([first], [old]);
  assert.equal(omitted.status, "ready"); assert.equal(omitted.items[0].current.text, first.text);
  assert.equal(omitted.semanticCompleteness, false);
  assert.ok(omitted.unannotatedTurnIds.includes(declaredTurnKey(f.inventory.turns[1])));
  assert.equal(omitted.recentTurns[0].text, correction.text);
});
