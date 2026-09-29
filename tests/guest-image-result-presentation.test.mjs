import assert from "node:assert/strict";
import test from "node:test";
import { parseGuestImageResultClaimEvent, parseGuestImageResultClaimEventOrigin } from "../src/model/guest-image-result-presentation.ts";
import { createCreativeEventFold, foldEvents } from "../src/model/events.ts";
import { eventMatchesProfile, PROJECT_BOOTSTRAP_EVENT_TYPES } from "../src/model/event-profiles.ts";
import { describeOutput, describeOutputs, imageOutputNamingCandidate } from "../src/model/output-naming.ts";
import { parseGuestImageResultInputView } from "../worker/generated-image-claimed-personal-wire.ts";
import { createGuestImageResultLocalAdoptionPair, matchGuestImageResultLocalAdoptionPair } from "../worker/generated-image-claimed-local-adoption.ts";

// Actual module imports and canonical event DTOs. This suite proves pure model
// behavior, not publication, current custody, media availability or paid work.
const owner = "owner:claim@example.test";
const projectId = "10000000-0000-4000-8000-000000000001";
const documentId = "20000000-0000-4000-8000-000000000002";
const blockA = "30000000-0000-4000-8000-000000000003";
const blockB = "30000000-0000-4000-8000-000000000004";
const generationId = "40000000-0000-4000-8000-123456789abc";
const custodyId = "50000000-0000-4000-8000-000000000005";
const claimEventId = "60000000-0000-4000-8000-000000000006";
const originalTime = "2026-09-01T10:11:12.000Z";
const claimTime = "2026-09-18T10:00:00.000Z";
const expiry = "2026-10-18T10:00:00.000Z";
const sha = "a".repeat(64), manifest = "sha256:" + "b".repeat(64);
const copyId = digit => "guest-image-result-history-" + digit.repeat(64);
const outputIdFor = generation => "object-" + generation.slice(-8);
const mediaUrlFor = (generation = generationId, custody = custodyId, account = owner) => "/api/media/" + encodeURIComponent(
  "guest-image-result-media-v1/u-" + Buffer.from(account, "utf8").toString("hex") + "/" + custody + "/" + outputIdFor(generation) + ".png");
const outputId = outputIdFor(generationId);

function event(sequence, type, payload, changes = {}) {
  return { eventId: "event-" + sequence, streamId: "creative:" + owner, sequence,
    occurredAt: claimTime, recordedAt: claimTime, actor: "user", clientId: "web:lit",
    correlationId: "context-prefix", causationId: null, compensatesEventId: null, schemaVersion: 1,
    type, payload, ...changes };
}
function fixture() {
  const prefix = [
    event(101, "ProjectCreated", { project_id: projectId, name: "Claimant project" }),
    event(102, "DocumentCreated", { project_id: projectId, document_id: documentId, title: "Original Document" }),
    event(103, "BlockCreated", { block_id: blockA, project_id: projectId, document_id: documentId,
      type: "direction", handle: "direction/original", position: "a0", properties: { text: "A quiet geometric still life", weight: .8, authority: "authored" } }),
    event(104, "BlockPropertyEdited", { block_id: blockA, document_id: documentId,
      property_path: "text", old_value: "A quiet geometric still life", new_value: "A quiet teal geometric still life" }),
    event(105, "BlockCreated", { block_id: blockB, project_id: projectId, document_id: documentId,
      type: "palette", handle: "palette/original", position: "a1", properties: { colors: ["#087f8c"], weight: .8, authority: "authored" } }),
    event(106, "DocumentOpened", { project_id: projectId, document_id: documentId }),
  ];
  const payload = {
    version: 1, project_id: projectId, document_id: documentId, custody_id: custodyId, object_id: outputId,
    generation_id: generationId, manifest_digest: manifest,
    claimed_origin: { version: 1, kind: "guest-image-result-event-origin-v1", custodyId, claimEventId,
      outputId, generationId, manifestDigest: manifest },
    original_created_at: originalTime, title: "  Teal café · 雨  ", model_id: "gpt-image-2",
    planner_model_id: "gpt-5.6-terra", provider: "openai", prompt_technique: "xml", quality: "high", purpose: "final",
    source_surface: "outputs", output_ref: copyId("c"), prompt_ref: copyId("d"), content_expires_at: expiry,
    media_url: mediaUrlFor(), media_type: "image/png", source_content_hash: sha, image_width: 1536,
    image_height: 1024, image_byte_length: 73_421, latency_ms: 12_345,
    source_block_versions: [{ block_id: blockA, version: 2 }, { block_id: blockB, version: 1 }],
    source_rights_digest: "sha256:" + "e".repeat(64),
  };
  const claim = event(107, "GuestImageResultClaimed", payload, { eventId: claimEventId,
    actor: "user:" + owner, clientId: "server:guest-image-result-claim", correlationId: "guest-image-result-claim:v1:" + custodyId });
  return { prefix, claim, events: [...prefix, claim] };
}
const project = events => foldEvents(events, Infinity, documentId, projectId);
const claimOutputs = events => project(events).libraryOutputs.filter(output => output.id === outputId || output.generationId === generationId);
function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}
function native(sequence, { id = outputId, generation = generationId, type = "GenerationCompleted" } = {}) {
  return event(sequence, type, { project_id: projectId, document_id: documentId, object_id: id, object_ids: [id],
    generation_id: generation, title: "Ordinary native image", model_id: "native-model", provider: "openai", prompt_technique: "bullets",
    quality: "high", purpose: "final", output_ref: "native-private-content", media_type: "image/png", media_url: "/api/media/native.png",
    image_width: 512, image_height: 512, latency_ms: 92, source_surface: "outputs", simulation: false }, { actor: "worker:generator" });
}

// Keep the first named test independently runnable as the genuine positive.
test("claimed Image canonical prefix at nonzero head parses and projects exact original metadata", () => {
  const f = fixture(), before = structuredClone(f), parsed = parseGuestImageResultClaimEvent(f.claim);
  assert.ok(parsed); assert.deepEqual(parsed, f.claim); assert.notEqual(parsed, f.claim);
  assert.notEqual(parsed.payload, f.claim.payload); assert.notEqual(parsed.payload.claimed_origin, f.claim.payload.claimed_origin);
  assert.notEqual(parsed.payload.source_block_versions, f.claim.payload.source_block_versions); assertDeepFrozen(parsed);
  const state = project(f.events); assert.equal(state.projectId, projectId); assert.equal(state.documentId, documentId);
  assert.equal(state.outputs.length, 1); assert.equal(state.libraryOutputs.length, 1);
  const output = state.outputs[0];
  assert.deepEqual(output, { id: outputId, documentId, title: f.claim.payload.title, titleSource: "generated", createdAt: originalTime,
    canvasId: null, contextSetId: null, generationId, modelId: "gpt-image-2", variant: 0, latency: 12_345,
    sequence: 107, pinned: false, saved: false, discarded: false, library: false, contentRef: copyId("c"), promptRef: copyId("d"),
    promptTechnique: "xml", promptFanId: null, provider: "openai", mediaUrl: mediaUrlFor(), mediaType: "image/png",
    width: 1536, height: 1024, plannerModelId: "gpt-5.6-terra", quality: "high", purpose: "final", sourceEventId: claimEventId,
    sourceSurface: "outputs", promotionId: null, promotedFromId: null, promotedFromEventId: null, focalPoint: null,
    standalone: true, standaloneSequence: 107, claimedOrigin: f.claim.payload.claimed_origin });
  assert.equal(state.projects[0].outputCount, 1);
  assert.deepEqual(state.blocks.map(block => ({ block_id: block.id, version: block.sourceEvents.length })), f.claim.payload.source_block_versions);
  assert.deepEqual(state.blocks[0].sourceEvents, ["event-103", "event-104"]);
  assert.equal(f.events.some(row => row.type === "ContextCompiled" || row.type === "GenerationCompleted"), false);
  assert.deepEqual(f, before, "pure parsing/projection does not mutate producer or canonical context");
  f.claim.payload.title = "caller mutation"; f.claim.payload.source_block_versions[0].version = 19;
  assert.equal(parsed.payload.title, before.claim.payload.title); assert.equal(parsed.payload.source_block_versions[0].version, 2);
});

test("claim EventOrigin is a detached closed identity value, not a completed review", () => {
  const origin = fixture().claim.payload.claimed_origin, parsed = parseGuestImageResultClaimEventOrigin(origin);
  assert.deepEqual(parsed, origin); assert.notEqual(parsed, origin); assertDeepFrozen(parsed);
  for (const mutate of [value => { value.lineageDigest = "sha256:" + sha; }, value => { value.outputId = "object-ffffffff"; },
    value => { value.manifestDigest = sha; }, value => { value.kind = "guest-image-result-completed-review-v1"; },
    value => { value.version = 2; }, value => { value.claimEventId = "event-not-a-uuid"; }]) {
    const value = structuredClone(origin); mutate(value); assert.equal(parseGuestImageResultClaimEventOrigin(value), null);
  }
});

test("Image 2 and Sunburst claim presentation and Inputs preserve original model identity", () => {
  // Synthetic detached presentation/wire values only; these confer no custody or read authority.
  for (const model of ["gpt-image-2", "gpt-image-2.5-sunburst"]) {
    const f = fixture(); f.claim.payload.model_id = model;
    assert.equal(parseGuestImageResultClaimEvent(f.claim)?.payload.model_id, model);
    assert.equal(project(f.events).outputs[0].modelId, model);
    const p = f.claim.payload;
    const wire = { schema_version: 2, origin: "guest-image-result-claim",
      claim: { version: 1, kind: "guest-image-result-completed-review-v1", custodyId, claimEventId, lineageDigest: manifest },
      output: { object_id: outputId, generation_id: generationId, document_id: documentId, quality: "high", purpose: "final",
        prompt_technique: p.prompt_technique, provider: "openai", model, planner_model: "gpt-5.6-terra", source_surface: "outputs" },
      submitted_prompt: "A quiet teal geometric still life", retained_input_status: "available", source_block_versions: p.source_block_versions,
      compile_event_id: null, document_snapshot: null, context_hash: null, reference_inputs: [], used_reference_pixels: false };
    const parsed = parseGuestImageResultInputView(wire);
    assert.ok(parsed); assert.equal(parsed.output.model, model); assertDeepFrozen(parsed);
    const candidate = createGuestImageResultLocalAdoptionPair({
      snapshot: { status: "current", ownerId: owner, projectId, documentId, outputId, generationId, sourceEventId: claimEventId,
        contentRef: p.output_ref, contentSha256: null, revision: 0, editEventId: null,
        media: { url: p.media_url, mediaType: "image/png", sha256: p.source_content_hash, width: p.image_width,
          height: p.image_height, byteLength: p.image_byte_length }, sources: [], sourceIds: [], head: 107, claim: wire.claim },
      title: p.title, canonical: f.claim, retainedExpiresAt: expiry, occurredAt: claimTime,
      ids: Object.fromEntries(["referenceId", "blockId", "receiptEventId", "blockEventId", "correlationId"].map((key, index) =>
        [key, `70000000-0000-4000-8000-00000000000${index}`])),
    });
    assert.ok(candidate); assert.equal(candidate.receipt.payload.model_id, model);
    assert.equal(matchGuestImageResultLocalAdoptionPair(candidate, candidate)?.receipt.payload.model_id, model);
    for (const unknown of ["gpt-image-2.5-flare", "gpt-image-2-future"]) {
      const changed = structuredClone(wire); changed.output.model = unknown;
      assert.equal(parseGuestImageResultInputView(changed), null);
      const claim = structuredClone(f.claim); claim.payload.model_id = unknown;
      assert.equal(parseGuestImageResultClaimEvent(claim), null);
      const pair = structuredClone(candidate); pair.receipt.payload.model_id = unknown;
      assert.equal(matchGuestImageResultLocalAdoptionPair(pair, pair), null);
    }
  }
});

test("cold projects profile and incremental fold preserve one claimed output and original context counts", () => {
  const f = fixture(); assert.ok(PROJECT_BOOTSTRAP_EVENT_TYPES.includes("GuestImageResultClaimed"));
  assert.equal(eventMatchesProfile("projects", f.claim.type, f.claim.payload), true);
  const cold = f.events.filter(row => eventMatchesProfile("projects", row.type, row.payload));
  const state = project(cold); assert.equal(state.outputs.length, 1); assert.equal(state.outputs[0].sourceEventId, claimEventId);
  const fold = createCreativeEventFold(Infinity, documentId, projectId);
  for (const row of f.events) assert.equal(fold.accept(row), true);
  assert.deepEqual(fold.finish(), project(f.events));
  const later = event(109, "BlockPropertyEdited", { block_id: blockA, property_path: "text", new_value: "Later authored direction" });
  const changed = project([...f.events, later]); assert.equal(changed.blocks[0].sourceEvents.length, 3);
  assert.equal(parseGuestImageResultClaimEvent(f.claim).payload.source_block_versions[0].version, 2);
  assert.equal(changed.outputs[0].sourceEventId, claimEventId, "historical block count is not the current block revision");
});

test("claim naming preserves historical creation time and stable take after an earlier claim is discarded", () => {
  const f = fixture(), second = structuredClone(f.claim);
  second.eventId = "60000000-0000-4000-8000-000000000007"; second.sequence = 110;
  second.payload.generation_id = "40000000-0000-4000-8000-abcdef123456"; second.payload.object_id = outputIdFor(second.payload.generation_id);
  second.payload.custody_id = "50000000-0000-4000-8000-000000000007";
  second.correlationId = "guest-image-result-claim:v1:" + second.payload.custody_id;
  Object.assign(second.payload.claimed_origin, { custodyId: second.payload.custody_id, claimEventId: second.eventId,
    generationId: second.payload.generation_id, outputId: second.payload.object_id });
  second.payload.media_url = mediaUrlFor(second.payload.generation_id, second.payload.custody_id);
  second.payload.output_ref = copyId("f"); second.payload.prompt_ref = copyId("1");
  const history = [...f.events, second, event(111, "ObjectDiscarded", { object_id: outputId })];
  const remaining = project(history).libraryOutputs; assert.equal(remaining.length, 1);
  const candidate = imageOutputNamingCandidate(remaining[0], {}, "Original Document");
  const label = describeOutput(candidate, [candidate], { events: history, includeTimestamp: true, timeZone: "UTC", locale: "en" });
  assert.equal(label.ordinal, 2); assert.equal(label.total, 2); assert.equal(label.createdAt, originalTime);
  assert.equal(label.title, "Teal café · 雨");
  const empty = fixture(); empty.claim.payload.title = "";
  const output = project(empty.events).outputs[0]; assert.ok(output); assert.notEqual(output.titleSource, "generated");
  const fallback = imageOutputNamingCandidate(output, {}, "Original Document"); assert.equal(fallback.title, "Original Document");
});

test("zero latency, empty title, all qualified techniques and upper numeric/string bounds are retained without fallback", () => {
  for (const technique of ["prose", "bullets", "json", "xml"]) {
    const f = fixture(); Object.assign(f.claim.payload, { prompt_technique: technique, title: "", latency_ms: 0 });
    assert.ok(parseGuestImageResultClaimEvent(f.claim));
    const output = project(f.events).outputs[0]; assert.equal(output.promptTechnique, technique); assert.equal(output.latency, 0);
  }
  const f = fixture(); Object.assign(f.claim.payload, { title: "界".repeat(8192), image_width: 8192, image_height: 8192,
    image_byte_length: 24_000_000, latency_ms: Number.MAX_SAFE_INTEGER });
  f.claim.payload.source_block_versions = Array.from({ length: 19 }, (_, index) => ({
    block_id: "30000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), version: 19 }));
  const parsed = parseGuestImageResultClaimEvent(f.claim); assert.ok(parsed); assert.equal(parsed.payload.title, f.claim.payload.title);
});

test("past retained expiry is structural history, not current private-read authority", () => {
  const f = fixture(); f.claim.payload.original_created_at = "2020-01-01T00:00:00.000Z";
  f.claim.occurredAt = f.claim.recordedAt = "2020-01-02T00:00:00.000Z";
  f.claim.payload.content_expires_at = "2020-02-01T00:00:00.000Z";
  assert.ok(parseGuestImageResultClaimEvent(f.claim));
});

const invalid = [
  ["missing payload field", row => { delete row.payload.latency_ms; }],
  ["unknown native singleton array", row => { row.payload.object_ids = [outputId]; }],
  ["completed lineage on stable origin", row => { row.payload.claimed_origin.lineageDigest = "sha256:" + sha; }],
  ["wrong kind", row => { row.type = "GenerationCompleted"; }],
  ["untrusted actor", row => { row.actor = "user"; }],
  ["another actor", row => { row.actor = "user:another-owner"; }],
  ["wrong client", row => { row.clientId = "web:lit"; }],
  ["wrong stream", row => { row.streamId = "project:" + projectId; }],
  ["wrong correlation", row => { row.correlationId = "guest-image-result-claim:v1:" + claimEventId; }],
  ["causation supplied", row => { row.causationId = claimEventId; }],
  ["compensation supplied", row => { row.compensatesEventId = claimEventId; }],
  ["header schema changed", row => { row.schemaVersion = 2; }],
  ["unknown header", row => { row.ownerId = owner; }],
  ["nonpositive sequence", row => { row.sequence = 0; }],
  ["fractional sequence", row => { row.sequence = 107.5; }],
  ["unsafe sequence", row => { row.sequence = Number.MAX_SAFE_INTEGER + 1; }],
  ["recorded time diverges", row => { row.recordedAt = "2026-09-18T10:00:00.001Z"; }],
  ["original time after claim", row => { row.payload.original_created_at = "2026-09-18T10:00:00.001Z"; }],
  ["noncanonical original ISO", row => { row.payload.original_created_at = "2026-09-01T10:11:12Z"; }],
  ["expiry not after publication", row => { row.payload.content_expires_at = claimTime; }],
  ["event UUID mismatch", row => { row.eventId = "60000000-0000-4000-8000-000000000008"; }],
  ["output ID mismatch", row => { row.payload.object_id = "object-ffffffff"; }],
  ["origin generation mismatch", row => { row.payload.claimed_origin.generationId = "40000000-0000-4000-8000-000000000009"; }],
  ["origin manifest mismatch", row => { row.payload.claimed_origin.manifestDigest = "sha256:" + sha; }],
  ["origin custody mismatch", row => { row.payload.claimed_origin.custodyId = claimEventId; }],
  ["model fallback forbidden", row => { row.payload.model_id = "adapter-neutral"; }],
  ["new model profile forbidden", row => { row.payload.model_id = "gpt-image-sunburst"; }],
  ["planner mismatch", row => { row.payload.planner_model_id = "gpt-5.6-sol"; }],
  ["provider mismatch", row => { row.payload.provider = "unknown"; }],
  ["invalid technique", row => { row.payload.prompt_technique = "default"; }],
  ["quality changed", row => { row.payload.quality = "low"; }],
  ["purpose changed", row => { row.payload.purpose = "ideate"; }],
  ["surface changed", row => { row.payload.source_surface = "chat"; }],
  ["original body ref substituted", row => { row.payload.output_ref = "original-guest-planner"; }],
  ["roles share copied body", row => { row.payload.prompt_ref = row.payload.output_ref; }],
  ["wrong media MIME", row => { row.payload.media_type = "image/jpeg"; }],
  ["prefixed media digest", row => { row.payload.source_content_hash = "sha256:" + sha; }],
  ["bare rights digest", row => { row.payload.source_rights_digest = sha; }],
  ["bare manifest digest", row => { row.payload.manifest_digest = "b".repeat(64); }],
  ["wrong canonical owner URL", row => { row.payload.media_url = mediaUrlFor(generationId, custodyId, "other"); }],
  ["wrong custody URL", row => { row.payload.media_url = mediaUrlFor(generationId, claimEventId); }],
  ["ordinary generated URL", row => { row.payload.media_url = "/api/media/" + encodeURIComponent("u-" + Buffer.from(owner).toString("hex") + "/generated/" + generationId + ".png"); }],
  ["URL not canonically encoded", row => { row.payload.media_url = decodeURIComponent(row.payload.media_url); }],
  ["URL query injected", row => { row.payload.media_url += "?download=1"; }],
  ["initial URL is a revision", row => { row.payload.media_url = "/api/media/" + encodeURIComponent("guest-image-result-media-v1/u-" + Buffer.from(owner).toString("hex") + "/" + custodyId + "/" + outputId + "/revisions/" + claimEventId + ".png"); }],
  ["zero width", row => { row.payload.image_width = 0; }],
  ["oversized height", row => { row.payload.image_height = 8193; }],
  ["fractional bytes", row => { row.payload.image_byte_length = 3.5; }],
  ["oversized bytes", row => { row.payload.image_byte_length = 24_000_001; }],
  ["negative latency", row => { row.payload.latency_ms = -1; }],
  ["coerced latency", row => { row.payload.latency_ms = "12345"; }],
  ["infinite latency", row => { row.payload.latency_ms = Infinity; }],
  ["title over bound", row => { row.payload.title = "x".repeat(8193); }],
  ["missing source context", row => { row.payload.source_block_versions = []; }],
  ["source count over bound", row => { row.payload.source_block_versions = Array.from({ length: 20 }, (_, i) => ({ block_id: "30000000-0000-4000-8000-" + String(i).padStart(12, "0"), version: 1 })); }],
  ["duplicate source block", row => { row.payload.source_block_versions[1].block_id = blockA; }],
  ["source sequence substituted for count", row => { row.payload.source_block_versions[0].version = 104; }],
  ["source count zero", row => { row.payload.source_block_versions[0].version = 0; }],
  ["source extra key", row => { row.payload.source_block_versions[0].eventId = "event-103"; }],
  ["sparse source list", row => { delete row.payload.source_block_versions[0]; }],
];
for (const [name, mutate] of invalid) test("claim parser refuses " + name, () => {
  const row = fixture().claim; mutate(row); assert.equal(parseGuestImageResultClaimEvent(row), null);
});

test("claim parser rejects accessors and hooks without invoking them, including nested/array headers", () => {
  for (const locate of [row => [row, "payload"], row => [row.payload, "title"],
    row => [row.payload.claimed_origin, "manifestDigest"], row => [row.payload.source_block_versions, "0"]]) {
    const row = fixture().claim; let reads = 0; const [target, key] = locate(row);
    Object.defineProperty(target, key, { enumerable: true, configurable: true, get() { reads++; throw new Error("must not execute getter"); } });
    assert.equal(parseGuestImageResultClaimEvent(row), null); assert.equal(reads, 0);
  }
  let hooks = 0; const row = fixture().claim;
  row.payload.toJSON = () => { hooks++; throw new Error("must not execute toJSON"); };
  assert.equal(parseGuestImageResultClaimEvent(row), null); assert.equal(hooks, 0);
});

test("claim parser rejects custom prototypes, symbols, hidden fields and prototype keys", () => {
  for (const mutate of [row => Object.setPrototypeOf(row.payload, { inherited: true }),
    row => { row.payload[Symbol("hidden")] = 1; },
    row => Object.defineProperty(row.payload, "hidden", { value: 1, enumerable: false }),
    row => Object.defineProperty(row.payload, "__proto__", { value: {}, enumerable: true }),
    row => { row.payload.source_block_versions.extra = true; },
    row => { row.payload.source_block_versions[0] = Object.create({ block_id: blockA, version: 2 }); }]) {
    const row = fixture().claim; mutate(row); assert.equal(parseGuestImageResultClaimEvent(row), null);
  }
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); assert.equal(parseGuestImageResultClaimEvent(proxy), null);
});

for (const type of ["GenerationCompleted", "IdeationPreviewCompleted"]) {
  for (const alias of ["output", "generation"]) for (const order of ["native first", "claim first"]) {
    test(`${type} ${alias} collision refuses both origins with ${order}`, () => {
      const f = fixture(), row = native(order === "native first" ? 107 : 108, {
        type, id: alias === "output" ? outputId : "native-other-output", generation: alias === "generation" ? generationId : "native-other-generation" });
      if (order === "native first") f.claim.sequence = 108;
      const events = [...f.prefix, ...(order === "native first" ? [row, f.claim] : [f.claim, row])];
      const targeted = project(events).libraryOutputs.filter(output => [outputId, row.payload.object_id].includes(output.id)
        || output.generationId === generationId);
      assert.equal(targeted.length, 0, "a contradictory native Map.set cannot supply fallback pixels");
    });
  }
}

for (const order of ["malformed first", "valid first"]) test("a malformed claimed alias cannot restore origin authority: " + order, () => {
  const f = fixture(), bad = structuredClone(f.claim); bad.eventId = "60000000-0000-4000-8000-000000000009";
  bad.payload.claimed_origin.claimEventId = bad.eventId; bad.payload.source_content_hash = "invalid";
  const pair = order === "malformed first" ? [bad, f.claim] : [f.claim, bad]; pair[0].sequence = 107; pair[1].sequence = 108;
  assert.equal(claimOutputs([...f.prefix, ...pair]).length, 0);
});

test("malformed claim generation aliases are refused even when their outer output ID differs", () => {
  for (const badFirst of [false, true]) {
    const f = fixture(), bad = structuredClone(f.claim);
    bad.eventId = "60000000-0000-4000-8000-000000000011";
    bad.payload.claimed_origin.claimEventId = bad.eventId;
    bad.payload.object_id = "object-00000000";
    const pair = badFirst ? [bad, f.claim] : [f.claim, bad]; pair[0].sequence = 107; pair[1].sequence = 108;
    assert.equal(parseGuestImageResultClaimEvent(bad), null);
    assert.equal(claimOutputs([...f.prefix, ...pair]).length, 0);
  }
});

test("duplicate valid claim and contradictory duplicate generation stay unavailable", () => {
  for (const sameEvent of [true, false]) {
    const f = fixture(), duplicate = structuredClone(f.claim); duplicate.sequence = 108;
    if (!sameEvent) { duplicate.eventId = "60000000-0000-4000-8000-000000000010"; duplicate.payload.claimed_origin.claimEventId = duplicate.eventId; }
    assert.equal(claimOutputs([...f.events, duplicate]).length, 0);
  }
});

test("missing removed and wrong-Project Documents never use the native absent-Document fallback", () => {
  for (const change of [f => { f.prefix = f.prefix.filter(row => row.type !== "DocumentCreated" && row.type !== "DocumentOpened"); },
    f => { f.prefix[1].payload.project_id = "10000000-0000-4000-8000-000000000009"; },
    f => { f.prefix.push(event(107, "DocumentRemoved", { document_id: documentId })); f.claim.sequence = 108; }]) {
    const f = fixture(); change(f); assert.equal(claimOutputs([...f.prefix, f.claim]).length, 0);
  }
  const f = fixture(); assert.equal(claimOutputs([...f.events, event(108, "DocumentRemoved", { document_id: documentId })]).length, 0);
});

test("ordinary flag and rename events affect a valid claim without changing its origin", () => {
  const f = fixture(), state = project([...f.events,
    event(108, "ObjectSaved", { object_id: outputId }), event(109, "ObjectPinned", { object_id: outputId }),
    event(110, "AddedToLibrary", { object_id: outputId }),
    event(111, "OutputRenamed", { output_id: outputId, object_id: outputId, output_kind: "image", document_id: documentId,
      project_id: projectId, new_title: "Claimant's edit" })]);
  const output = state.outputs[0]; assert.equal(output.saved, true); assert.equal(output.pinned, true); assert.equal(output.library, true);
  assert.equal(output.title, "Claimant's edit"); assert.equal(output.titleSource, "authored");
  assert.equal(output.sourceEventId, claimEventId); assert.equal(output.createdAt, originalTime);
  assert.deepEqual(output.claimedOrigin, f.claim.payload.claimed_origin);
});

test("unrelated native output keeps its existing projection and takes beside a rejected claim", () => {
  const f = fixture(), ordinary = native(108, { id: "unrelated-output", generation: "unrelated-generation" });
  const before = project([...f.prefix, ordinary]).outputs[0];
  f.claim.payload.prompt_technique = "not-a-technique";
  const after = project([...f.events, ordinary]); assert.equal(after.outputs.length, 1); assert.deepEqual(after.outputs[0], before);
  assert.equal(Object.hasOwn(after.outputs[0], "claimedOrigin"), false);
  const named = describeOutputs(after.outputs.map(value => imageOutputNamingCandidate(value)), { events: [...f.events, ordinary] });
  assert.equal(named[0].ordinal, 1); assert.equal(named[0].total, 1);
});

const namingScope = {
  documents: [{ id: documentId, title: "Original Document" }],
  formatDocument: number => "Document " + number, formatResult: number => "Result " + number,
};
const namingIdentity = description => ({ ordinal: description.ordinal, total: description.total,
  version: description.version, variantCount: description.variantCount, disambiguator: description.disambiguator,
  label: description.label, displayScope: description.displayScope });
function unrelatedNamingCandidate(sequence = 200) {
  const row = native(sequence, { id: "unrelated-naming-output", generation: "unrelated-naming-generation" });
  row.payload.title = "Shared display title";
  const value = imageOutputNamingCandidate(project([...fixture().prefix, row]).outputs[0]);
  return { row, value };
}

for (const failure of ["malformed", "duplicate", "missing Document", "removed Document", "wrong Project"]) {
  test(`naming fallbacks cannot count a known ${failure} claimed stale candidate or peer`, () => {
    const f = fixture();
    f.claim.payload.title = "Shared display title";
    const stale = imageOutputNamingCandidate(project(f.events).outputs[0]);
    const { row: ordinary, value: current } = unrelatedNamingCandidate();
    let history = [...f.events];
    if (failure === "malformed") f.claim.payload.source_content_hash = "invalid";
    if (failure === "duplicate") {
      const duplicate = structuredClone(f.claim); duplicate.sequence = 108;
      duplicate.eventId = "60000000-0000-4000-8000-000000000020";
      duplicate.payload.claimed_origin.claimEventId = duplicate.eventId; history.push(duplicate);
    }
    if (failure === "missing Document") history = history.filter(row => !["DocumentCreated", "DocumentOpened"].includes(row.type));
    if (failure === "removed Document") history.push(event(108, "DocumentRemoved", { document_id: documentId }));
    if (failure === "wrong Project") f.prefix[1].payload.project_id = "10000000-0000-4000-8000-000000000099";
    history.push(ordinary);
    const baseOptions = { events: history, scopedLabels: namingScope };
    const baseline = describeOutput(current, [current], baseOptions);
    assert.equal(baseline.total, 1); assert.equal(baseline.variantCount, 1);
    const fromPeers = describeOutput(current, [stale, current], baseOptions);
    assert.deepEqual(namingIdentity(fromPeers), namingIdentity(baseline));
    // describeOutputs retains caller-facing description order. An ineligible
    // stale descriptor must not enter any population or collision calculation.
    const fromCandidates = describeOutputs([stale, current], { ...baseOptions, peers: [stale, current] });
    assert.deepEqual(namingIdentity(fromCandidates[1]), namingIdentity(baseline));
    assertSafeRejectedScope(fromCandidates[0]);
    const fromDefaultPeers = describeOutputs([stale, current], baseOptions);
    assert.deepEqual(namingIdentity(fromDefaultPeers[1]), namingIdentity(baseline));
    assertSafeRejectedScope(fromDefaultPeers[0]);
  });
}

for (const order of ["native first", "claim first"]) {
  test(`naming generation-only aliases without candidate generationId cannot inflate unrelated labels: ${order}`, () => {
    const f = fixture();
    const alias = native(order === "native first" ? 107 : 108, { id: "native-generation-only-alias", generation: generationId });
    alias.payload.title = "Shared display title";
    // Obtain a real native candidate before the conflicting claim enters the
    // history, then model an older naming caller that supplied no generationId.
    const stale = imageOutputNamingCandidate(project([...f.prefix, alias]).outputs[0]);
    delete stale.generationId;
    assert.equal(Object.hasOwn(stale, "generationId"), false);
    if (order === "native first") f.claim.sequence = 108;
    const { row: ordinary, value: current } = unrelatedNamingCandidate();
    const history = [...f.prefix, ...(order === "native first" ? [alias, f.claim] : [f.claim, alias]), ordinary];
    const options = { events: history, scopedLabels: namingScope };
    const baseline = describeOutput(current, [current], options);
    assert.equal(baseline.ordinal, 1); assert.equal(baseline.total, 1); assert.equal(baseline.variantCount, 1);
    assert.equal(baseline.displayScope.showDocument, false); assert.equal(baseline.displayScope.qualifier, "");
    assert.deepEqual(namingIdentity(describeOutput(current, [stale, current], options)), namingIdentity(baseline));
    assert.deepEqual(namingIdentity(describeOutputs([stale, current], options)[1]), namingIdentity(baseline));
  });
}

test("naming ignores a malformed claim peer from another Document when computing scoped display collisions", () => {
  const f = fixture(); f.claim.payload.title = "Shared display title";
  const stale = imageOutputNamingCandidate(project(f.events).outputs[0]);
  f.claim.payload.prompt_technique = "invalid";
  const otherDocument = "20000000-0000-4000-8000-000000000021";
  const ordinary = native(201, { id: "other-document-output", generation: "other-document-generation" });
  ordinary.payload.document_id = otherDocument; ordinary.payload.title = "Shared display title";
  const extra = event(200, "DocumentCreated", { project_id: projectId, document_id: otherDocument, title: "Original Document" });
  const history = [...f.events, extra, ordinary];
  const state = foldEvents(history, Infinity, otherDocument, projectId);
  const current = imageOutputNamingCandidate(state.outputs[0]);
  const options = { events: history, scopedLabels: { ...namingScope,
    documents: [...namingScope.documents, { id: otherDocument, title: "Original Document" }] } };
  const baseline = describeOutput(current, [current], options);
  assert.equal(baseline.total, 1); assert.equal(baseline.variantCount, 1); assert.equal(baseline.displayScope.showDocument, false);
  assert.deepEqual(namingIdentity(describeOutput(current, [stale, current], options)), namingIdentity(baseline));
});

test("native naming still counts discarded historical siblings and respects multi-image creation order", () => {
  const f = fixture(), first = native(107, { id: "discarded-native", generation: "first-native-generation" });
  const fan = native(108, { id: "fan-z", generation: "native-fan-generation" });
  fan.payload.object_ids = ["fan-z", "fan-a"];
  const history = [...f.prefix, first, fan, event(109, "ObjectDiscarded", { object_id: "discarded-native" })];
  const outputs = project(history).outputs;
  assert.equal(outputs.length, 2); assert.equal(outputs.some(output => Object.hasOwn(output, "claimedOrigin")), false);
  const candidates = ["fan-a", "fan-z"].map(id => imageOutputNamingCandidate(outputs.find(output => output.id === id)));
  const names = describeOutputs(candidates, { events: history });
  assert.deepEqual(names.map(value => ({ id: value.id, ordinal: value.ordinal, total: value.total })), [
    { id: "fan-a", ordinal: 3, total: 3 }, { id: "fan-z", ordinal: 2, total: 3 },
  ]);
});

test("native naming keeps no-history fallback and ignores unrelated scout receipts", () => {
  const candidates = [
    { id: "late-native", documentId, sequence: 22, kind: "image", title: "Equal native title" },
    { id: "early-native", documentId, sequence: 11, kind: "image", title: "Equal native title" },
  ];
  const names = describeOutputs(candidates);
  assert.deepEqual(names.map(value => [value.ordinal, value.total, value.variantCount]), [[2, 2, 2], [1, 2, 2]]);
  const { row: ordinary, value: current } = unrelatedNamingCandidate();
  const scout = native(107, { id: "scout-only", generation: "scout-generation" }); scout.payload.report_space = "scout";
  const options = { events: [...fixture().prefix, scout, ordinary], scopedLabels: namingScope };
  const name = describeOutput(current, [current], options);
  assert.equal(name.ordinal, 1); assert.equal(name.total, 1); assert.equal(name.variantCount, 1);
  assert.equal(project(options.events).outputs.length, 1);
});

test("rejected claim identity history contributes measurable bounded fold state without visible outputs", () => {
  const f = fixture(), tracked = createCreativeEventFold(Infinity, documentId, projectId), ignored = createCreativeEventFold(Infinity, documentId, projectId);
  for (const row of f.prefix) { tracked.accept(row); ignored.accept(row); }
  const initial = tracked.measureRetainedState(); assert.deepEqual(initial, ignored.measureRetainedState());
  let afterFirst;
  for (let index = 1; index <= 24; index++) {
    const rejected = structuredClone(f.claim);
    const generation = "40000000-0000-4000-8000-" + String(index).padStart(12, "0");
    rejected.sequence = 106 + index; rejected.eventId = "60000000-0000-4000-8000-" + String(index).padStart(12, "0");
    rejected.payload.generation_id = generation; rejected.payload.object_id = outputIdFor(generation);
    Object.assign(rejected.payload.claimed_origin, { claimEventId: rejected.eventId, generationId: generation, outputId: rejected.payload.object_id });
    rejected.payload.media_url = mediaUrlFor(generation); rejected.payload.source_content_hash = "malformed";
    assert.equal(parseGuestImageResultClaimEvent(rejected), null);
    assert.equal(tracked.accept(rejected), true);
    // Same-sized caller input with an ignored type cannot be counted as retained
    // model state. The rejected claim's retained identity index is the difference.
    assert.equal(ignored.accept({ ...rejected, type: "UnretainedDiagnostic" }), true);
    if (index === 1) afterFirst = tracked.measureRetainedState();
  }
  const measured = tracked.measureRetainedState(), control = ignored.measureRetainedState();
  assert.deepEqual(control, initial);
  assert.ok(afterFirst.bytes > initial.bytes && afterFirst.nodes > initial.nodes);
  assert.ok(measured.bytes > afterFirst.bytes && measured.nodes > afterFirst.nodes);
  const byteBound = { bytes: initial.bytes + 1, nodes: measured.nodes + 100, depth: 96 };
  assert.doesNotThrow(() => ignored.measureRetainedState(byteBound));
  assert.throws(() => tracked.measureRetainedState(byteBound), { message: "retained_state_capacity" });
  const nodeBound = { bytes: measured.bytes + 100, nodes: initial.nodes + 1, depth: 96 };
  assert.doesNotThrow(() => ignored.measureRetainedState(nodeBound));
  assert.throws(() => tracked.measureRetainedState(nodeBound), { message: "retained_state_capacity" });
  assert.equal(tracked.finish().libraryOutputs.length, 0); assert.equal(ignored.finish().libraryOutputs.length, 0);
});


for (const alias of ["array output", "nested array output", "array generation", "preview array output"]) {
  for (const order of ["native first", "claim first"]) {
    test(`JSON-native ${alias} coercion cannot overwrite or count a claimed Image: ${order}`, () => {
      const f = fixture();
      const row = native(order === "native first" ? 107 : 108, {
        id: "coercion-native-other-output", generation: "coercion-native-other-generation",
        type: alias === "preview array output" ? "IdeationPreviewCompleted" : "GenerationCompleted",
      });
      if (alias === "array output" || alias === "nested array output") {
        delete row.payload.object_id;
        row.payload.object_ids = alias === "array output" ? [[outputId]] : [[[outputId]]];
      } else if (alias === "array generation") row.payload.generation_id = [generationId];
      else { row.payload.object_id = [outputId]; delete row.payload.object_ids; }
      // Exercise only ordinary JSON values, with no custom coercion hooks. The
      // native fold historically String-coerces each of these identities.
      const persisted = JSON.parse(JSON.stringify(row));
      const stale = imageOutputNamingCandidate(project([...f.prefix, persisted]).outputs[0]);
      if (order === "native first") f.claim.sequence = 108;
      const { row: ordinary, value: current } = unrelatedNamingCandidate();
      const events = [...f.prefix, ...(order === "native first" ? [persisted, f.claim] : [f.claim, persisted]), ordinary];
      const state = project(events);
      assert.deepEqual(state.libraryOutputs.map(output => output.id), [ordinary.payload.object_id]);
      assert.deepEqual(state.outputs[0], project([...f.prefix, ordinary]).outputs[0]);
      const options = { events, scopedLabels: namingScope };
      const baseline = describeOutput(current, [current], options);
      assert.equal(baseline.ordinal, 1); assert.equal(baseline.total, 1); assert.equal(baseline.variantCount, 1);
      assert.deepEqual(namingIdentity(describeOutput(current, [stale, current], options)), namingIdentity(baseline));
    });
  }
}

test("original JSON titles preserve escaped lone UTF-16 surrogates through parsing and projection", () => {
  const titles = [JSON.parse('"  original \\ud800 title  "'), JSON.parse('"original \\udfff title"'),
    "x".repeat(8191) + JSON.parse('"\\ud800"')];
  for (const title of titles) {
    const f = fixture(); f.claim.payload.title = title;
    const persisted = JSON.parse(JSON.stringify(f.claim));
    const parsed = parseGuestImageResultClaimEvent(persisted);
    assert.ok(parsed, "the original title is bounded by UTF-16 code units and is legal JSON");
    assertDeepFrozen(parsed); assert.equal(parsed.payload.title, title);
    assert.equal(JSON.stringify(parsed.payload.title), JSON.stringify(title));
    const output = project([...f.prefix, persisted]).outputs[0];
    assert.equal(output.title, title); assert.equal(output.titleSource, "generated");
    assert.equal(output.sourceEventId, claimEventId); assert.equal(output.generationId, generationId);
  }
});

test("owner namespaces still reject lone UTF-16 surrogates even when the other owner bindings agree", () => {
  for (const escaped of ['"owner\\ud800"', '"owner\\udfff"']) {
    const account = JSON.parse(escaped), f = fixture();
    f.claim.streamId = "creative:" + account; f.claim.actor = "user:" + account;
    f.claim.payload.media_url = mediaUrlFor(generationId, custodyId, account);
    assert.equal(parseGuestImageResultClaimEvent(JSON.parse(JSON.stringify(f.claim))), null);
  }
});


function assertSafeRejectedScope(presentation) {
  const scope = presentation.displayScope;
  assert.ok(scope, "every requested row needs a safe scope for consumers to dereference");
  for (const key of ["key", "title", "documentTitle", "qualifier", "context"]) assert.equal(typeof scope[key], "string", key);
  assert.equal(scope.showDocument, false); assert.equal(scope.qualifier, "");
  assert.equal(scope.title.length > 0, true); assert.equal(scope.context.includes(scope.title), true);
}

test("a redacted claim known only by source event ID stays out of naming populations and gets safe requested scope", () => {
  const f = fixture(); f.claim.payload.title = "Shared display title";
  const stale = imageOutputNamingCandidate(project(f.events).outputs[0]);
  const redacted = { ...f.claim, payload: {} };
  const { row: ordinary, value: current } = unrelatedNamingCandidate();
  const history = [...f.prefix, redacted, ordinary];
  assert.deepEqual(redacted.payload, {}); assert.equal(stale.sourceEventId, redacted.eventId);
  assert.equal(parseGuestImageResultClaimEvent(redacted), null);
  assert.deepEqual(project(history).outputs.map(output => output.id), [ordinary.payload.object_id]);
  const options = { events: history, scopedLabels: namingScope };
  const baseline = describeOutput(current, [current], options);
  assert.equal(baseline.ordinal, 1); assert.equal(baseline.total, 1); assert.equal(baseline.variantCount, 1);
  assert.deepEqual(namingIdentity(describeOutput(current, [stale, current], options)), namingIdentity(baseline));
  for (const described of [describeOutputs([stale, current], options),
    describeOutputs([stale, current], { ...options, peers: [stale, current] })]) {
    assert.equal(described.length, 2); assert.equal(described[0].id, stale.id);
    assertSafeRejectedScope(described[0]);
    assert.deepEqual(namingIdentity(described[1]), namingIdentity(baseline));
  }
  assertSafeRejectedScope(describeOutput(stale, [stale, current], options));
});

for (const type of ["DocumentCreated", "DocumentForked"]) {
  for (const selection of ["newly created Project", "reopened Project"]) {
    test(`${type} without project_id preserves implicit ${selection} in fold and historical naming`, () => {
      const f = fixture();
      f.prefix[1].type = type; delete f.prefix[1].payload.project_id;
      f.claim.payload.title = "Shared display title";
      if (selection === "reopened Project") {
        const otherProject = "10000000-0000-4000-8000-000000000031";
        f.prefix = [f.prefix[0],
          event(102, "ProjectCreated", { project_id: otherProject, name: "Other Project" }, { eventId: "project-other-created" }),
          event(103, "ProjectOpened", { project_id: projectId }, { eventId: "claimant-project-reopened" }), ...f.prefix.slice(1)];
      }
      f.prefix.forEach((row, index) => { row.sequence = 101 + index; });
      f.claim.sequence = 101 + f.prefix.length;
      const { row: ordinary, value: current } = unrelatedNamingCandidate();
      const implicit = [...f.prefix, f.claim, ordinary];
      const explicit = structuredClone(implicit);
      explicit.find(row => row.type === type && row.payload.document_id === documentId).payload.project_id = projectId;
      const state = project(implicit);
      assert.deepEqual(state, project(explicit));
      assert.equal(state.documents.find(document => document.id === documentId).projectId, projectId);
      assert.equal(state.outputs.find(output => output.id === outputId).sourceEventId, claimEventId);
      // Request only the later native row: its second Take must come from the
      // accepted claim in history, never from a fallback claimed candidate.
      const options = { events: implicit, scopedLabels: namingScope };
      const named = describeOutput(current, [current], options);
      assert.equal(named.ordinal, 2); assert.equal(named.total, 2);
      assert.deepEqual(namingIdentity(named), namingIdentity(describeOutput(current, [current], { ...options, events: explicit })));
    });
  }
}

function differentValidClaimWithSameEventId(original) {
  const value = structuredClone(original);
  const generation = "40000000-0000-4000-8000-abcdef123456", custody = "50000000-0000-4000-8000-000000000032";
  const digest = "sha256:" + "f".repeat(64);
  Object.assign(value.payload, { custody_id: custody, generation_id: generation, object_id: outputIdFor(generation),
    manifest_digest: digest, output_ref: copyId("1"), prompt_ref: copyId("2"), media_url: mediaUrlFor(generation, custody),
    title: "Other original Image" });
  Object.assign(value.payload.claimed_origin, { custodyId: custody, generationId: generation, outputId: outputIdFor(generation), manifestDigest: digest });
  value.correlationId = "guest-image-result-claim:v1:" + custody;
  return value;
}

for (const order of ["original first", "other first"]) {
  test(`different valid claim identities cannot reuse one canonical claim event ID: ${order}`, () => {
    const f = fixture(), other = differentValidClaimWithSameEventId(f.claim);
    assert.ok(parseGuestImageResultClaimEvent(f.claim)); assert.ok(parseGuestImageResultClaimEvent(other));
    assert.equal(other.eventId, f.claim.eventId); assert.notEqual(other.payload.object_id, f.claim.payload.object_id);
    assert.notEqual(other.payload.generation_id, f.claim.payload.generation_id);
    assert.notEqual(other.payload.custody_id, f.claim.payload.custody_id);
    const stale = [f.claim, other].map(row => imageOutputNamingCandidate(project([...f.prefix, row]).outputs[0]));
    const pair = order === "original first" ? [f.claim, other] : [other, f.claim];
    pair.forEach((row, index) => { row.sequence = 107 + index; });
    const { row: ordinary, value: current } = unrelatedNamingCandidate();
    const history = [...f.prefix, ...pair, ordinary], state = project(history);
    assert.deepEqual(state.outputs, project([...f.prefix, ordinary]).outputs);
    assert.deepEqual(state.libraryOutputs.map(output => output.id), [ordinary.payload.object_id]);
    const options = { events: history, scopedLabels: namingScope };
    const baseline = describeOutput(current, [current], options);
    assert.equal(baseline.ordinal, 1); assert.equal(baseline.total, 1); assert.equal(baseline.variantCount, 1);
    const names = describeOutputs([...stale, current], options);
    assert.deepEqual(namingIdentity(names[2]), namingIdentity(baseline));
    assertSafeRejectedScope(names[0]); assertSafeRejectedScope(names[1]);
  });
}

for (const order of ["valid first", "redacted first"]) {
  test(`redacted duplicate canonical claim event ID invalidates the original identity: ${order}`, () => {
    const f = fixture(), redacted = { ...f.claim, payload: {} };
    const stale = imageOutputNamingCandidate(project(f.events).outputs[0]);
    const pair = order === "valid first" ? [f.claim, redacted] : [redacted, f.claim];
    pair.forEach((row, index) => { row.sequence = 107 + index; });
    assert.ok(parseGuestImageResultClaimEvent(f.claim)); assert.equal(parseGuestImageResultClaimEvent(redacted), null);
    const { row: ordinary, value: current } = unrelatedNamingCandidate();
    const history = [...f.prefix, ...pair, ordinary], state = project(history);
    assert.deepEqual(state.outputs, project([...f.prefix, ordinary]).outputs);
    assert.deepEqual(state.libraryOutputs.map(output => output.id), [ordinary.payload.object_id]);
    const options = { events: history, scopedLabels: namingScope };
    const baseline = describeOutput(current, [current], options);
    assert.equal(baseline.ordinal, 1); assert.equal(baseline.total, 1);
    const names = describeOutputs([stale, current], options);
    assert.deepEqual(namingIdentity(names[1]), namingIdentity(baseline)); assertSafeRejectedScope(names[0]);
  });
}


for (const current of ["original current Document", "restored current Document"]) {
  test(`empty DocumentForked payload uses the ${current} after ProjectCreated changes only the current Project`, () => {
    const f = fixture(), nextProject = "10000000-0000-4000-8000-000000000041";
    const prefix = [...f.prefix];
    let sequence = 107;
    if (current === "restored current Document") {
      const otherDocument = "20000000-0000-4000-8000-000000000042";
      prefix.push(event(sequence++, "DocumentRemoved", { document_id: documentId }),
        event(sequence++, "DocumentCreated", { document_id: otherDocument, project_id: projectId, title: "Newer current Document" }),
        event(sequence++, "DocumentOpened", { document_id: otherDocument }),
        event(sequence++, "DocumentRestored", { document_id: documentId, was_current: true }));
    }
    prefix.push(event(sequence++, "ProjectCreated", { project_id: nextProject, name: "Next Project" }));
    const implicitFork = event(sequence++, "DocumentForked", {});
    prefix.push(implicitFork);
    f.claim.sequence = sequence++; f.claim.payload.project_id = nextProject;
    assert.ok(parseGuestImageResultClaimEvent(f.claim), "the claim itself has an explicit, valid Project and Document identity");
    const ordinary = native(sequence, { id: "after-implicit-fork", generation: "after-implicit-fork-generation" });
    ordinary.payload.project_id = nextProject;
    const implicit = [...prefix, f.claim, ordinary], explicit = structuredClone(implicit);
    explicit.find(row => row.eventId === implicitFork.eventId).payload = { document_id: documentId, project_id: nextProject };
    const state = foldEvents(implicit, Infinity, documentId, nextProject);
    const explicitState = foldEvents(explicit, Infinity, documentId, nextProject);
    assert.deepEqual(state, explicitState);
    assert.equal(state.projectId, nextProject); assert.equal(state.documentId, documentId);
    assert.equal(state.documents.find(document => document.id === documentId).projectId, nextProject);
    assert.deepEqual(state.outputs.map(output => output.id), [ordinary.payload.object_id, outputId]);
    assert.equal(state.outputs[1].sourceEventId, claimEventId);
    assert.deepEqual(state.outputs[1].claimedOrigin, f.claim.payload.claimed_origin);
    const candidate = imageOutputNamingCandidate(state.outputs[0]);
    const scopedLabels = { ...namingScope, documents: state.documents.map(document => ({ id: document.id, title: document.title })) };
    const named = describeOutput(candidate, [candidate], { events: implicit, scopedLabels });
    assert.equal(named.ordinal, 2); assert.equal(named.total, 2);
    assert.deepEqual(namingIdentity(named), namingIdentity(describeOutput(candidate, [candidate], { events: explicit, scopedLabels })));
  });
}
