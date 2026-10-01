import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DOCUMENT_PROFILE_POLICY, NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, canonicalDocumentPalette,
  documentPaletteClaimKey, parseMemoryDocumentProfile } from "../src/model/memory-document-profile.ts";
import { nativeDocumentProfileHistoryQuery, nativeDocumentProfileSourcesQuery,
  nativeDocumentPaletteProfileValue, nativeDocumentProfileSuppressionsQuery,
  nativeDocumentProfileSuppressionsValue } from "../worker/memory-document-profile.ts";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");
const CHECKED = "2026-09-04T12:00:00.000Z", UNTIL = "2026-09-04T12:01:00.000Z";
const RECORDED = "2026-09-03T12:00:00.000Z";
const identity = () => ({ actorUserId: "actor", ownerUserId: "owner", organizationId: "org", projectAccessId: "access",
  projectId: "project", documentId: "document" });
const source = (sequence = 1, type = "BlockCreated") => ({ eventId: `event-${sequence}`, sequence, type, recordedAt: RECORDED });
const evidence = (blockId = "block-a", sequence = 1, intent = "prefer", lineage = "unknown") => ({
  blockId, intent, lineage, independentEvidence: false, sources: [source(sequence)] });
const choice = () => ({ claimKey: "a".repeat(64), colors: ["#112233", "#aabbcc"], status: "supported",
  supports: [evidence()], counterevidence: [] });
const fixture = () => ({ version: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, treatment: "document-authored-palette-choices",
  inferredPreferences: false, independentEvidence: false,
  scope: { organizationId: "org", projectAccessId: "access", projectId: "project", documentId: "document" },
  grant: { id: "grant-a", revision: 1 }, lifetime: { checkedAt: CHECKED, validUntil: UNTIL },
  coverage: { bounded: true, completeHistory: false, blockLimit: 16, sourceLimit: 128, selectedBlockCount: 1, eligibleChoiceCount: 1 },
  choices: [choice()] });
const parse = value => parseMemoryDocumentProfile(value, NOW);

test("document profile model: explicit scoped choices preserve uncertainty and original lease", () => {
  assert.equal(DOCUMENT_PROFILE_POLICY, "document-profile-v1");
  const input = fixture(), parsed = parse(input);
  assert.deepEqual(parsed, input);
  input.scope.documentId = "other"; input.grant.revision = 9; input.lifetime.validUntil = "2099-01-01T00:00:00.000Z";
  input.choices[0].colors[0] = "#ffffff"; input.choices[0].supports[0].sources[0].eventId = "replaced";
  assert.equal(parsed.scope.documentId, "document"); assert.equal(parsed.grant.revision, 1);
  assert.equal(parsed.lifetime.validUntil, UNTIL); assert.equal(parsed.choices[0].colors[0], "#112233");
  assert.equal(parsed.choices[0].supports[0].sources[0].eventId, "event-1");
  assert.equal(parseMemoryDocumentProfile(parsed, NOW + 59_999)?.lifetime.validUntil, UNTIL);
  assert.equal(parseMemoryDocumentProfile(parsed, NOW + 60_000), null);
});

test("document profile model: personal scope and empty bounded selection never claim zero history", () => {
  const input = fixture(); input.scope.organizationId = null; input.scope.projectAccessId = null;
  input.choices = []; input.coverage.eligibleChoiceCount = 0;
  for (const selected of [0, 1, 16]) {
    input.coverage.selectedBlockCount = selected;
    const parsed = parse(input); assert.deepEqual(parsed, input); assert.equal(parsed.coverage.completeHistory, false);
  }
});

test("document profile model: same ordered palette can retain explicit support and opposition without ranking", () => {
  const input = fixture(); input.coverage.selectedBlockCount = 3;
  input.choices[0].status = "conflicted";
  input.choices[0].supports[0].sources = [source(1), source(2, "BlockPropertyEdited"), source(3, "ChipEdited")];
  input.choices[0].counterevidence = [evidence("block-b", 4, "avoid", "assisted"), evidence("block-c", 5, "prohibit", "copy")];
  assert.deepEqual(parse(input), input);
  input.choices[0].supports = []; input.choices[0].status = "opposed";
  assert.deepEqual(parse(input), input);
});

test("document profile model: canonical palettes preserve order and repeated colors without normalizing wire input", () => {
  const colors = ["#000000", "#ffffff", "#000000"], parsed = canonicalDocumentPalette(colors);
  assert.deepEqual(parsed, colors); assert.notEqual(parsed, colors);
  assert.deepEqual(canonicalDocumentPalette(Array.from({ length: 16 }, () => "#010203")), Array(16).fill("#010203"));
  for (const value of [[], ["#ABCDEF"], ["#abc"], ["112233"], [" #112233"], ["#112233 "], ["rgb(1,2,3)"],
    ["#12345g"], [null], "#112233", Array(1), Array(17).fill("#112233")]) assert.equal(canonicalDocumentPalette(value), null);
});

test("document profile model: claim key binds recipe, complete subject custody scope and palette order", async () => {
  const current = identity(), colors = ["#112233", "#aabbcc"];
  const expected = createHash("sha256").update(JSON.stringify([NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE,
    current.actorUserId, current.ownerUserId, current.organizationId, current.projectAccessId, current.projectId, current.documentId, colors])).digest("hex");
  assert.equal(await documentPaletteClaimKey(current, colors), expected);
  for (const field of Object.keys(current)) assert.notEqual(await documentPaletteClaimKey({ ...current, [field]: `${current[field]}-other` }, colors), expected);
  assert.notEqual(await documentPaletteClaimKey(current, [...colors].reverse()), expected);
  assert.notEqual(await documentPaletteClaimKey(current, [...colors, colors[0]]), expected);
  const personal = { ...current, ownerUserId: current.actorUserId, organizationId: null, projectAccessId: null };
  assert.match(await documentPaletteClaimKey(personal, colors), /^[a-f0-9]{64}$/u);
  for (const [subject, palette] of [[{ ...current, grantRevision: 1 }, colors], [{ ...current, organizationId: null }, colors],
    [{ ...personal, ownerUserId: "other" }, colors], [{ ...current, actorUserId: "" }, colors], [current, ["#ABCDEF"]]])
    await assert.rejects(documentPaletteClaimKey(subject, palette), /document_palette_identity_invalid/u);
});

const invalid = [
  ["unknown recipe", value => { value.version = "future"; }],
  ["inferred preference", value => { value.inferredPreferences = true; }],
  ["global independence", value => { value.independentEvidence = true; }],
  ["different treatment", value => { value.treatment = "personal-preferences"; }],
  ["unknown top-level data", value => { value.privateText = "not permitted"; }],
  ["missing scope", value => { delete value.scope; }],
  ["partial shared scope", value => { value.scope.organizationId = null; }],
  ["missing access scope", value => { delete value.scope.projectAccessId; }],
  ["actor disclosure", value => { value.scope.actorUserId = "actor"; }],
  ["empty document", value => { value.scope.documentId = ""; }],
  ["whitespace identifier", value => { value.scope.projectId = " project"; }],
  ["control identifier", value => { value.scope.projectId = "project\nother"; }],
  ["malformed Unicode identifier", value => { value.scope.documentId = "\ud800"; }],
  ["oversized identifier", value => { value.grant.id = "x".repeat(241); }],
  ["nonpositive grant revision", value => { value.grant.revision = 0; }],
  ["coerced grant revision", value => { value.grant.revision = "1"; }],
  ["unsafe grant revision", value => { value.grant.revision = Number.MAX_SAFE_INTEGER + 1; }],
  ["extra grant field", value => { value.grant.learn = true; }],
  ["future check", value => { value.lifetime.checkedAt = "2026-09-04T12:00:00.001Z"; }],
  ["expired", value => { value.lifetime.validUntil = CHECKED; }],
  ["lease extension", value => { value.lifetime.validUntil = "2026-09-04T12:01:00.001Z"; }],
  ["noncanonical timestamp", value => { value.lifetime.checkedAt = "2026-09-04T12:00:00Z"; }],
  ["invalid date", value => { value.lifetime.checkedAt = "2026-02-30T12:00:00.000Z"; }],
  ["extra lifetime field", value => { value.lifetime.ttl = 60; }],
  ["complete history", value => { value.coverage.completeHistory = true; }],
  ["unbounded history", value => { value.coverage.bounded = false; }],
  ["changed source limit", value => { value.coverage.sourceLimit = 129; }],
  ["changed block limit", value => { value.coverage.blockLimit = 17; }],
  ["excess selected blocks", value => { value.coverage.selectedBlockCount = 17; }],
  ["insufficient selected blocks", value => { value.coverage.selectedBlockCount = 0; }],
  ["mismatched choice count", value => { value.coverage.eligibleChoiceCount = 0; }],
  ["extra analytics count", value => { value.coverage.independentOutcomes = 1; }],
  ["sparse choices", value => { value.choices = Array(1); }],
  ["claim key uppercase", value => { value.choices[0].claimKey = "A".repeat(64); }],
  ["short claim key", value => { value.choices[0].claimKey = "a".repeat(63); }],
  ["wire color uppercase", value => { value.choices[0].colors[0] = "#ABCDEF"; }],
  ["sparse colors", value => { value.choices[0].colors = Array(1); }],
  ["extra choice label", value => { value.choices[0].label = "my palette"; }],
  ["confidence", value => { value.choices[0].confidence = 1; }],
  ["unsupported empty claim", value => { value.choices[0].supports = []; }],
  ["incorrect supported status", value => { value.choices[0].status = "conflicted"; }],
  ["opposition as support", value => { value.choices[0].supports[0].intent = "avoid"; }],
  ["default include as preference", value => { value.choices[0].supports[0].intent = "include"; }],
  ["independent evidence", value => { value.choices[0].supports[0].independentEvidence = true; }],
  ["asserted user lineage", value => { value.choices[0].supports[0].lineage = "user"; }],
  ["coercible lineage", value => { value.choices[0].supports[0].lineage = { toString: () => "unknown" }; }],
  ["evidence private payload", value => { value.choices[0].supports[0].payload = {}; }],
  ["no evidence sources", value => { value.choices[0].supports[0].sources = []; }],
  ["sparse evidence sources", value => { value.choices[0].supports[0].sources = Array(1); }],
  ["excess evidence sources", value => { value.choices[0].supports[0].sources = [source(1), source(2), source(3), source(4)]; }],
  ["source event metadata", value => { value.choices[0].supports[0].sources[0].revision = 1; }],
  ["unsupported source event", value => { value.choices[0].supports[0].sources[0].type = "PreferenceAuthored"; }],
  ["coercible source event", value => { value.choices[0].supports[0].sources[0].type = { toString: () => "BlockCreated" }; }],
  ["zero source sequence", value => { value.choices[0].supports[0].sources[0].sequence = 0; }],
  ["coerced sequence", value => { value.choices[0].supports[0].sources[0].sequence = "1"; }],
  ["future source", value => { value.choices[0].supports[0].sources[0].recordedAt = UNTIL; }],
  ["noncanonical source timestamp", value => { value.choices[0].supports[0].sources[0].recordedAt = "2026-09-03T12:00:00Z"; }],
  ["unordered sources", value => { value.choices[0].supports[0].sources = [source(2), source(1)]; }],
  ["duplicate source ID", value => { value.choices[0].supports[0].sources = [source(1), { ...source(2), eventId: "event-1" }]; }],
  ["duplicate source sequence", value => { value.choices[0].supports[0].sources = [source(1), { ...source(1), eventId: "other" }]; }],
  ["array hidden field", value => { value.choices[0].colors.note = "hidden"; }],
  ["symbol field", value => { value[Symbol("hidden")] = "hidden"; }],
];
for (const [name, edit] of invalid) test(`document profile model: rejects ${name}`, () => {
  const value = fixture(); edit(value); assert.equal(parse(value), null);
});

test("document profile model: rejects claim, palette, block and source collisions across rows", () => {
  const second = () => ({ ...choice(), claimKey: "b".repeat(64), colors: ["#445566"], supports: [evidence("block-b", 2)] });
  for (const edit of [row => { row.claimKey = "a".repeat(64); }, row => { row.colors = ["#112233", "#aabbcc"]; },
    row => { row.supports[0].blockId = "block-a"; }, row => { row.supports[0].sources[0].eventId = "event-1"; },
    row => { row.supports[0].sources[0].sequence = 1; }]) {
    const value = fixture(), row = second(); edit(row); value.choices.push(row);
    value.coverage.selectedBlockCount = 2; value.coverage.eligibleChoiceCount = 2;
    assert.equal(parse(value), null);
  }
  const value = fixture(); value.coverage.selectedBlockCount = 2;
  value.choices[0].status = "conflicted"; value.choices[0].counterevidence = [evidence("block-a", 2, "avoid")];
  assert.equal(parse(value), null);
});

test("document profile model: bounded maximum survives without counts implying independent outcomes", () => {
  const value = fixture(); value.coverage.selectedBlockCount = 16; value.coverage.eligibleChoiceCount = 16;
  value.choices = Array.from({ length: 16 }, (_, index) => ({ ...choice(), claimKey: index.toString(16).padStart(64, "0"),
    colors: [`#${index.toString(16).padStart(6, "0")}`], supports: [{ ...evidence(`block-${index}`, index * 3 + 1),
      sources: [source(index * 3 + 1), source(index * 3 + 2, "BlockPropertyEdited"), source(index * 3 + 3, "ChipEdited")] }] }));
  assert.deepEqual(parse(value), value);
  assert.equal(parseMemoryDocumentProfile(value, NaN), null);
  value.choices[0].supports[0].sources[0].recordedAt = value;
  assert.equal(parse(value), null);
});

// These fixtures execute actual helper SQL against isolated in-memory SQLite.
// Their deliberately small caller predicate tests binding/composition, not the
// Worker, full native authority resolver, installed D1, or production access.
function nativeFixture(t, { shared = false } = {}) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,type TEXT,actor TEXT,client_id TEXT,
    correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,recorded_at TEXT,payload TEXT,schema_version INTEGER);
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,document_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE project_event_scopes(event_id TEXT,source_stream_id TEXT,source_sequence INTEGER,organization_id TEXT,
      project_access_id TEXT,project_id TEXT,owner_user_id TEXT,actor_user_id TEXT);
    CREATE TABLE project_resource_scopes(project_access_id TEXT,resource_kind TEXT,resource_id TEXT,organization_id TEXT,
      project_id TEXT,owner_user_id TEXT,visibility TEXT,actor_user_id TEXT,source_event_id TEXT);
    CREATE TABLE memory_live_sources(enrollment_id TEXT,event_id TEXT,sequence INTEGER,expires_at TEXT);`);
  const now = Date.now(), iso = value => new Date(value).toISOString(), actor = "alice", owner = shared ? "owner" : actor;
  const stream = "creative:" + owner, checkedAt = iso(now), validUntil = iso(now + 60_000), expires = iso(now + 3_600_000);
  const e = { enrollment_id: "enrollment", actor_user_id: actor, owner_user_id: owner, organization_id: shared ? "org" : null,
    project_access_id: shared ? "access" : null, project_id: "project", document_id: "document", permission_epoch: "epoch",
    revision: 1, policy_version: "personal-memory-v2", learn_enabled: 1, recall_enabled: 1, enrolled_at: iso(now - 120_000),
    expires_at: expires, retention_days: 30, cursor_sequence: 1_000, cutoff_sequence: null };
  const g = { grant_id: "grant", actor_user_id: actor, owner_user_id: owner, organization_id: e.organization_id,
    project_access_id: e.project_access_id, project_id: e.project_id, document_id: e.document_id, permission_epoch: e.permission_epoch,
    policy_version: DOCUMENT_PROFILE_POLICY, recipe_version: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, revision: 1,
    enrollment_id: e.enrollment_id, enrollment_revision: e.revision, infer_enabled: 1, inspect_enabled: 1, background_enabled: 0,
    source_after_sequence: 0, consented_at: iso(now - 60_000), expires_at: expires, retention_days: 30, revoked_at: null };
  const q = {
    joins: "FROM events event JOIN (SELECT ? AS actor,? AS owner,? AS org,? AS access,? AS project,? AS document) caller ON 1=1",
    condition: "event.stream_id=? AND event.actor=? AND json_extract(event.payload,'$.project_id')=? AND json_extract(event.payload,'$.document_id')=?",
    bindings: [actor, owner, e.organization_id, e.project_access_id, e.project_id, e.document_id, stream, "user:" + actor, e.project_id, e.document_id],
  };
  const run = query => db.prepare(query.sql).all(...query.bindings).map(row => ({ ...row }));
  let sequence = 0;
  const add = (type, fields, options = {}) => {
    sequence++;
    const eventId = "native-event-" + sequence, at = options.at ?? iso(now - 30_000 + sequence * 10);
    const payload = { project_id: e.project_id, document_id: e.document_id, ...fields };
    const visible = { _private_ref: eventId };
    for (const key of ["project_id", "document_id", "block_id", "scope", "canvas_id", "type", "property_path", "actor_user_id",
      "organization_id", "project_access_id", "owner_user_id", "source_surface", "source_chat_turn_id", "copied_from_block_id", "synthetic", "simulation"])
      if (Object.hasOwn(payload, key)) visible[key] = payload[key];
    db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,1)").run(eventId, stream, sequence, type, options.actor ?? "user:" + actor,
      options.client ?? "web:context-editor", options.correlation ?? "manual-edit", options.causation ?? null,
      options.compensates ?? null, at, JSON.stringify(visible));
    db.prepare("INSERT INTO event_private_payloads VALUES(?,?,?,?,?,NULL)").run(eventId, owner,
      payload.project_id ?? null, payload.document_id ?? null, JSON.stringify(payload));
    if (shared && options.custody !== false) db.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?)")
      .run(eventId, stream, sequence, e.organization_id, e.project_access_id, e.project_id, owner,
        (options.actor ?? "user:" + actor).replace(/^user:/u, ""));
    if (shared && type === "BlockCreated" && !db.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_id=?").get(payload.block_id))
      db.prepare("INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?,?)").run(e.project_access_id, "block", payload.block_id,
        e.organization_id, e.project_id, owner, "collaborative_output", actor, eventId);
    if (options.remember !== false) db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)").run(e.enrollment_id, eventId, sequence, options.expires ?? expires);
    return { eventId, sequence, type, blockId: payload.block_id, recordedAt: at, validUntil: options.expires ?? expires };
  };
  const create = (blockId = "block-a", properties = {}, options = {}) => add("BlockCreated", { block_id: blockId,
    type: "palette", scope: "document", properties: { colors: ["#112233", "#aabbcc"], intent: "prefer", ...properties } }, options);
  const edit = (blockId, property, value, options = {}) => add(options.chip ? "ChipEdited" : "BlockPropertyEdited", {
    block_id: blockId, [options.chip ? "property" : "property_path"]: property, new_value: value }, options);
  const selections = () => run(nativeDocumentProfileSourcesQuery(e, q, g)).map(row => ({ eventId: row.event_id,
    blockId: row.block_id, sequence: row.sequence, recordedAt: row.recorded_at, validUntil: row.expires_at }));
  const history = blockIds => run(nativeDocumentProfileHistoryQuery(e, blockIds, sequence));
  const profile = async (blockIds = ["block-a"], options = {}) => nativeDocumentPaletteProfileValue(
    options.rows ?? history(blockIds), options.selected ?? selections(), e, g, blockIds, options.suppressed ?? new Set(), checkedAt,
    options.validUntil ?? validUntil);
  const privateEdit = (eventId, modify) => {
    const row = db.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId);
    const value = JSON.parse(row.private_json); modify(value);
    db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(value), eventId);
  };
  return { db, e, g, q, run, add, create, edit, selections, history, profile, privateEdit, now, iso, checkedAt, validUntil, expires };
}
const noNativeChoices = value => assert.equal(value?.choices.length ?? 0, 0);

function rawNativePayload(f, eventId, privateBody, rewrite) {
  const table = privateBody ? "event_private_payloads" : "events", key = privateBody ? "private_event_id" : "event_id";
  const column = privateBody ? "private_json" : "payload";
  const row = f.db.prepare(`SELECT ${column} AS body FROM ${table} WHERE ${key}=?`).get(eventId);
  f.db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`).run(rewrite(row.body), eventId);
}

for (const shared of [false, true]) test("document profile native fixture: explicit current palette in " + (shared ? "shared" : "personal") + " scope", async t => {
  const f = nativeFixture(t, { shared }), created = f.create("block-a", { colors: ["#AABBCC", "#010203"], label: "never returned" });
  const result = await f.profile(); assert.ok(result); assert.equal(result.choices.length, 1);
  assert.deepEqual(result.choices[0].colors, ["#aabbcc", "#010203"]); assert.equal(result.choices[0].status, "supported");
  assert.deepEqual(result.choices[0].supports[0].sources, [{ eventId: created.eventId, sequence: created.sequence,
    type: "BlockCreated", recordedAt: created.recordedAt }]);
  assert.equal(result.choices[0].supports[0].lineage, "unknown"); assert.equal(result.independentEvidence, false);
  assert.equal(JSON.stringify(result).includes("never returned"), false);
});

test("document profile native fixture: prefer avoid and prohibit reconcile one palette without multiplying claims", async t => {
  const f = nativeFixture(t); f.create("support"); f.create("avoid", { intent: "avoid" }); f.create("prohibit", { intent: "prohibit" });
  const result = await f.profile(["support", "avoid", "prohibit"]); assert.ok(result);
  assert.equal(result.choices.length, 1); assert.equal(result.choices[0].status, "conflicted");
  assert.equal(result.choices[0].supports.length, 1); assert.equal(result.choices[0].counterevidence.length, 2);
  assert.equal(result.coverage.selectedBlockCount, 3); assert.equal(result.coverage.eligibleChoiceCount, 1);
  assert.equal(result.choices[0].supports[0].independentEvidence, false);
});

test("document profile native fixture: current fields replace older values and preserve ordered source identities", async t => {
  const f = nativeFixture(t); f.create(); const colors = f.edit("block-a", "colors", ["#334455"]);
  const intent = f.edit("block-a", "intent", "prohibit", { chip: true });
  const result = await f.profile(); assert.ok(result); assert.equal(result.choices[0].status, "opposed");
  assert.deepEqual(result.choices[0].colors, ["#334455"]);
  assert.deepEqual(result.choices[0].counterevidence[0].sources.map(row => row.eventId), [colors.eventId, intent.eventId]);
  f.edit("block-a", "colors", ["not-a-color"]); noNativeChoices(await f.profile());
});

for (const [name, properties] of [["missing explicit intent", { intent: undefined }], ["default include", { intent: "include" }],
  ["unknown intent", { intent: "sometimes" }], ["zero weight", { weight: 0 }], ["disabled creation", { active: false }],
  ["noncanonical source colors", { colors: ["red"] }]]) test("document profile native fixture: omits " + name, async t => {
  const f = nativeFixture(t); f.create("block-a", properties); noNativeChoices(await f.profile());
});

for (const [name, change] of [
  ["redacted private source", (f, event) => f.db.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(f.checkedAt, event.eventId)],
  ["missing private source", (f, event) => f.db.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.eventId)],
  ["malformed private source", (f, event) => f.db.prepare("UPDATE event_private_payloads SET private_json='{' WHERE private_event_id=?").run(event.eventId)],
  ["wrong private owner", (f, event) => f.db.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(event.eventId)],
  ["wrong private document", (f, event) => f.db.prepare("UPDATE event_private_payloads SET document_id='other' WHERE private_event_id=?").run(event.eventId)],
  ["wrong private actor", (f, event) => f.privateEdit(event.eventId, value => { value.actor_user_id = "other"; })],
  ["wrong private block", (f, event) => f.privateEdit(event.eventId, value => { value.block_id = "other"; })],
  ["wrong private project", (f, event) => f.privateEdit(event.eventId, value => { value.project_id = "other"; })],
  ["wrong public pointer", (f, event) => f.db.prepare("UPDATE events SET payload=json_set(payload,'$._private_ref','other') WHERE event_id=?").run(event.eventId)],
  ["wrong public type", (f, event) => f.db.prepare("UPDATE events SET payload=json_set(payload,'$.type','style') WHERE event_id=?").run(event.eventId)],
  ["unknown future event version", (f, event) => f.db.prepare("UPDATE events SET schema_version=2 WHERE event_id=?").run(event.eventId)],
  ["simulated private source", (f, event) => f.privateEdit(event.eventId, value => { value.simulation = true; })],
  ["missing event custody", (f, event) => f.db.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(event.eventId)],
  ["wrong event sequence custody", (f, event) => f.db.prepare("UPDATE project_event_scopes SET source_sequence=999 WHERE event_id=?").run(event.eventId)],
  ["duplicate event custody", (f, event) => f.db.prepare("INSERT INTO project_event_scopes SELECT * FROM project_event_scopes WHERE event_id=?").run(event.eventId)],
  ["wrong resource owner", f => f.db.prepare("UPDATE project_resource_scopes SET owner_user_id='other'").run()],
  ["actor-private foreign resource", f => f.db.prepare("UPDATE project_resource_scopes SET visibility='actor_private',actor_user_id='other'").run()],
  ["duplicate resource custody", f => f.db.prepare("INSERT INTO project_resource_scopes SELECT * FROM project_resource_scopes").run()],
]) test("document profile native fixture: withdraws " + name + " without replacing it from old evidence", async t => {
  const f = nativeFixture(t, { shared: true }), event = f.create(); assert.equal((await f.profile()).choices.length, 1);
  change(f, event); noNativeChoices(await f.profile());
});

for (const privateBody of [false, true]) for (const targetFirst of [false, true])
  test("document profile native fixture: duplicate " + (privateBody ? "private" : "public")
    + " block_id in " + (targetFirst ? "target-first" : "target-last") + " order cannot hide newer history", async t => {
    const f = nativeFixture(t, { shared: true }); f.create(); assert.equal((await f.profile()).choices.length, 1);
    const latest = f.edit("block-a", "colors", ["#ffffff"]);
    const order = targetFirst ? '"block_id":"block-a","block_id":"other"' : '"block_id":"other","block_id":"block-a"';
    rawNativePayload(f, latest.eventId, privateBody, body => body.replace('"block_id":"block-a"', order));
    // The opposite body names only the foreign block. History discovery must
    // notice the target in either duplicate order, not json_extract's first key.
    rawNativePayload(f, latest.eventId, !privateBody, body => body.replace('"block_id":"block-a"', '"block_id":"other"'));
    const rows = f.history(["block-a"]);
    assert.ok(rows.some(row => row.event_id === latest.eventId));
    assert.equal(rows.find(row => row.event_id === latest.eventId)[privateBody ? "private_json_unique" : "public_json_unique"], 0);
    noNativeChoices(await f.profile(["block-a"], { rows }));
  });

for (const [name, rewrite] of [
  ["colors", body => body.replace('"colors":["#112233","#aabbcc"]', '"colors":["#ffffff"],"colors":["#112233","#aabbcc"]')],
  ["intent", body => body.replace('"intent":"prefer"', '"intent":"avoid","intent":"prefer"')],
  ["properties", body => body.replace('"properties":', '"properties":{"colors":["#ffffff"],"intent":"avoid"},"properties":')],
]) test("document profile native fixture: duplicate private " + name + " keys are not authored evidence", async t => {
  const f = nativeFixture(t), created = f.create(); assert.equal((await f.profile()).choices.length, 1);
  rawNativePayload(f, created.eventId, true, rewrite);
  const rows = f.history(["block-a"]); assert.equal(rows[0].private_json_unique, 0);
  noNativeChoices(await f.profile(["block-a"], { rows }));
});

for (const targetFirst of [false, true]) test("document profile native fixture: duplicate private pointer in "
  + (targetFirst ? "target-first" : "target-last") + " order cannot preserve older choices", async t => {
  const f = nativeFixture(t); f.create(); assert.equal((await f.profile()).choices.length, 1);
  const latest = f.edit("block-a", "colors", ["#ffffff"]), pointer = JSON.stringify(latest.eventId);
  rawNativePayload(f, latest.eventId, false, body => body.replace('"_private_ref":' + pointer,
    targetFirst ? '"_private_ref":' + pointer + ',"_private_ref":"other"' : '"_private_ref":"other","_private_ref":' + pointer));
  const rows = f.history(["block-a"]); assert.equal(rows.at(-1).public_json_unique, 0);
  noNativeChoices(await f.profile(["block-a"], { rows }));
});

for (const [name, body] of [["malformed", "{"], ["oversized", JSON.stringify({ block_id: "other", padding: "x".repeat(8192) })]])
  test("document profile native fixture: " + name + " newer public history fails closed without older fallback", async t => {
    const f = nativeFixture(t); f.create(); assert.equal((await f.profile()).choices.length, 1);
    const selected = f.selections(), latest = f.edit("block-a", "colors", ["#ffffff"], { remember: false });
    rawNativePayload(f, latest.eventId, false, () => body);
    const rows = f.history(["block-a"]); assert.ok(rows.some(row => row.event_id === latest.eventId));
    assert.equal(await f.profile(["block-a"], { rows, selected }), null);
  });

for (const shared of [false, true]) for (const privateBody of [false, true]) test("document profile native fixture: "
  + (privateBody ? "current enveloped" : "legacy identifier-only") + " lock and unlock preserve choices in "
  + (shared ? "shared" : "personal") + " scope", async t => {
  const f = nativeFixture(t, { shared }); f.create(); const baseline = await f.profile(); assert.equal(baseline.choices.length, 1);
  for (const type of ["BlockLocked", "BlockUnlocked"]) {
    const event = f.add(type, { block_id: "block-a" });
    if (!privateBody) {
      rawNativePayload(f, event.eventId, false, () => JSON.stringify({ block_id: "block-a", source_surface: "context-editor" }));
      f.db.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.eventId);
    }
    const current = await f.profile(); assert.ok(current); assert.deepEqual(current.choices, baseline.choices);
  }
});

for (const [name, type, fields, options] of [
  ["authored edit", "BlockPropertyEdited", { property_path: "colors", new_value: ["#ffffff"] }, {}],
  ["unknown value field", "BlockLocked", { colors: ["#ffffff"] }, {}],
  ["retained private pointer", "BlockLocked", { _private_ref: "missing" }, {}],
  ["wrong document", "BlockLocked", { document_id: "other" }, {}],
  ["compensation", "BlockUnlocked", {}, { compensates: "native-event-1" }],
]) test("document profile native fixture: erased " + name + " is not rescued as a harmless legacy lock", async t => {
  const f = nativeFixture(t, { shared: true }); f.create(); assert.equal((await f.profile()).choices.length, 1);
  const event = f.add(type, { block_id: "block-a", ...fields }, options);
  rawNativePayload(f, event.eventId, false, () => JSON.stringify({ block_id: "block-a", ...fields }));
  f.db.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.eventId);
  noNativeChoices(await f.profile());
});

test("document profile native fixture: cutoff is future-only and partial post-consent fields do not import old choices", async t => {
  const f = nativeFixture(t), original = f.create(); f.g.source_after_sequence = original.sequence;
  assert.equal(f.selections().length, 0); noNativeChoices(await f.profile());
  f.edit("block-a", "colors", ["#ffffff"]); noNativeChoices(await f.profile());
  f.edit("block-a", "intent", "prefer"); assert.equal((await f.profile()).choices.length, 1);
  f.g.consented_at = f.iso(f.now - 1_000); assert.equal(f.selections().length, 0); noNativeChoices(await f.profile());
});

test("document profile native fixture: unavailable current selected source cannot revive an older choice", async t => {
  const f = nativeFixture(t); f.create(); f.edit("block-a", "colors", ["#ffffff"], { remember: false });
  noNativeChoices(await f.profile());
  f.edit("block-a", "colors", ["#eeeeee"], { expires: f.iso(f.now - 1) }); noNativeChoices(await f.profile());
});

for (const [name, invalidate] of [
  ["remove then restore", f => { f.add("BlockRemoved", { block_id: "block-a" }); f.add("BlockRestored", { block_id: "block-a" }); }],
  ["rehome", f => f.add("BlockRehomed", { block_id: "block-a", scope: "library", document_id: null })],
  ["compensating edit", f => f.edit("block-a", "colors", ["#ffffff"], { compensates: "native-event-1" })],
  ["re-authoring after compensation", f => { f.edit("block-a", "colors", ["#ffffff"], { compensates: "native-event-1" });
    f.edit("block-a", "colors", ["#eeeeee"]); f.edit("block-a", "intent", "prefer"); }],
  ["disabled via edit", f => f.edit("block-a", "active", false)],
  ["disabled via chip", f => f.edit("block-a", "active", false, { chip: true })],
  ["re-enabled without re-authoring", f => { f.edit("block-a", "active", false); f.edit("block-a", "active", true); }],
  ["root type roundtrip", f => { f.edit("block-a", "type", "style"); f.edit("block-a", "type", "palette"); }],
  ["foreign writer changes field", f => f.edit("block-a", "colors", ["#ffffff"], { actor: "user:other" })],
]) test("document profile native fixture: " + name + " does not resurrect old selected choice", async t => {
  const f = nativeFixture(t, { shared: true }); f.create(); invalidate(f); noNativeChoices(await f.profile());
});

test("document profile native fixture: enabling an initially disabled palette does not adopt its stored choices", async t => {
  const f = nativeFixture(t); f.create("block-a", { active: false }); f.edit("block-a", "active", true);
  noNativeChoices(await f.profile());
  f.edit("block-a", "colors", ["#ffffff"]); noNativeChoices(await f.profile());
  f.edit("block-a", "intent", "prefer"); assert.equal((await f.profile()).choices.length, 1);
});

test("document profile native fixture: ChipEdited type cannot convert a non-palette root into palette", async t => {
  const f = nativeFixture(t); f.add("BlockCreated", { block_id: "block-a", type: "style", scope: "document", properties: {} });
  f.edit("block-a", "type", "palette", { chip: true }); f.edit("block-a", "colors", ["#ffffff"]); f.edit("block-a", "intent", "prefer");
  noNativeChoices(await f.profile());
});

for (const [name, mark, expected] of [
  ["copied creation", f => f.create("block-a", { copied_from_block_id: "source-block" }), "copy"],
  ["assisted creation", f => f.add("BlockCreated", { block_id: "block-a", type: "palette", scope: "document", source_chat_turn_id: "turn",
    properties: { colors: ["#112233"], intent: "prefer" } }), "assisted"],
  ["copy property edit", f => { f.create(); f.edit("block-a", "copied_from_block_id", "source-block"); }, "copy"],
  ["assistant chip edit", f => { f.create(); f.edit("block-a", "source_chat_turn_id", "turn", { chip: true }); }, "assisted"],
  ["cleared copy marker", f => { f.create(); f.edit("block-a", "copied_from_block_id", "source-block"); f.edit("block-a", "copied_from_block_id", null); }, "copy"],
]) test("document profile native fixture: " + name + " retains lineage without claiming independence", async t => {
  const f = nativeFixture(t); mark(f); const result = await f.profile(); assert.ok(result); assert.equal(result.choices.length, 1);
  assert.equal(result.choices[0].supports[0].lineage, expected); assert.equal(result.choices[0].supports[0].independentEvidence, false);
});

test("document profile native fixture: the source selector preserves caller predicate and six-join binding convention", t => {
  const f = nativeFixture(t); f.create(); f.add("PreferenceAuthored", { block_id: "block-a", preference_id: "p", axis: "palette", value: "red" });
  f.add("GenerationCompleted", { block_id: "block-a", object_ids: ["output"] });
  const query = nativeDocumentProfileSourcesQuery(f.e, f.q, f.g);
  assert.equal(f.run(query).length, 1); assert.deepEqual(query.bindings.slice(0, 7), [...f.q.bindings.slice(0, 6), f.e.enrollment_id]);
  assert.equal(f.run(nativeDocumentProfileSourcesQuery(f.e, { ...f.q, condition: "(" + f.q.condition + ") AND 0" }, f.g)).length, 0);
});

test("document profile native fixture: source and grant deadlines, suppression and limits cannot expand evidence", async t => {
  const f = nativeFixture(t), event = f.create("block-a", {}, { expires: f.iso(Date.now() + 10_000) });
  const result = await f.profile(); assert.ok(result); assert.equal(result.lifetime.validUntil, event.validUntil);
  noNativeChoices(await f.profile(["block-a"], { suppressed: new Set([result.choices[0].claimKey]) }));
  f.g.background_enabled = 1; assert.equal(await f.profile(), null); f.g.background_enabled = 0;
  f.g.enrollment_revision++; assert.equal(await f.profile(), null); f.g.enrollment_revision--;
  const rows = f.history(["block-a"]); assert.equal(await f.profile(["block-a"], { rows: [...rows, ...rows] }), null);
  assert.equal(await f.profile(["block-a"], { rows: Array.from({ length: 129 }, () => rows[0]) }), null);
  assert.throws(() => nativeDocumentProfileHistoryQuery(f.e, ["block-a", "block-a"], 1), /document_profile_selection_invalid/u);
});

for (const [name, fields] of [
  ["numeric synthetic", { synthetic: 1 }], ["string synthetic", { synthetic: "0" }],
  ["malformed origin", { origin: "unknown" }], ["nested synthetic origin", { origin: { synthetic: true } }],
  ["native replay ancestry", { source_replay_event_id: "replay-source" }], ["scout context", { report_space: "scout" }],
]) test("document profile native fixture: excludes " + name + " even when a reference was retained", async t => {
  const f = nativeFixture(t), event = f.create(); assert.equal((await f.profile()).choices.length, 1);
  f.privateEdit(event.eventId, value => Object.assign(value, fields)); noNativeChoices(await f.profile());
});

test("document profile native fixture: shorter purpose retention does not renew old parent references", async t => {
  const f = nativeFixture(t), day = 86_400_000;
  f.e.enrolled_at = f.iso(f.now - 7 * day); f.g.consented_at = f.iso(f.now - 6 * day); f.g.retention_days = 1;
  const event = f.create("block-a", {}, { at: f.iso(f.now - 2 * day) });
  assert.equal(f.selections().length, 0);
  noNativeChoices(await f.profile(["block-a"], { selected: [event] }));
  const fresh = f.edit("block-a", "colors", ["#ffffff"]); noNativeChoices(await f.profile());
  f.edit("block-a", "intent", "prefer");
  const result = await f.profile(); assert.equal(result.choices.length, 1);
  assert.equal(result.choices[0].supports[0].sources[0].eventId, fresh.eventId);
});

function nativeSuppressionFixture(t) {
  const f = nativeFixture(t);
  f.db.exec(`CREATE TABLE memory_document_profile_suppressions(grant_id TEXT,grant_revision INTEGER,
    claim_key TEXT,revision INTEGER,state TEXT,created_at TEXT,expires_at TEXT)`);
  const add = (claimKey, fields = {}) => {
    const row = { grant_id: f.g.grant_id, grant_revision: f.g.revision, claim_key: claimKey, revision: 1,
      state: "active", created_at: f.iso(f.now - 30_000), expires_at: f.iso(f.now + 20_000), ...fields };
    f.db.prepare("INSERT INTO memory_document_profile_suppressions VALUES(?,?,?,?,?,?,?)")
      .run(row.grant_id, row.grant_revision, row.claim_key, row.revision, row.state, row.created_at, row.expires_at);
  };
  const rows = () => f.run(nativeDocumentProfileSuppressionsQuery(f.g));
  const value = (at = f.now) => nativeDocumentProfileSuppressionsValue(rows(), f.g, at);
  return { ...f, suppress: add, suppressionRows: rows, suppressionValue: value };
}
const suppressionKey = index => index.toString(16).padStart(64, "0");

test("document profile native suppression: more than128 expired or revoked rows do not exhaust live capacity", async t => {
  const f = nativeSuppressionFixture(t); f.create(); const original = await f.profile(), key = original.choices[0].claimKey;
  for (let index = 0; index < 257; index++) {
    f.suppress(suppressionKey(index), { expires_at: f.iso(f.now - 1_000) });
    f.suppress(suppressionKey(index + 300), { state: "revoked" });
  }
  assert.deepEqual(f.suppressionRows(), []); assert.deepEqual(f.suppressionValue(), { suppressed: new Set(), validUntil: null });
  f.suppress(key); const current = f.suppressionValue(); assert.ok(current);
  assert.equal(f.suppressionRows().length, 1); assert.deepEqual([...current.suppressed], [key]);
  assert.equal(current.validUntil, f.iso(f.now + 20_000));
  noNativeChoices(await f.profile(["block-a"], { suppressed: current.suppressed }));
});

test("document profile native suppression: exact128 live rows fit but an additional row fails closed", t => {
  const f = nativeSuppressionFixture(t);
  for (let index = 0; index < 128; index++) f.suppress(suppressionKey(index));
  assert.equal(f.suppressionRows().length, 128); assert.equal(f.suppressionValue().suppressed.size, 128);
  f.suppress(suppressionKey(128)); assert.equal(f.suppressionRows().length, 129); assert.equal(f.suppressionValue(), null);
});

for (const [name, fields] of [
  ["unknown state", { state: "future-state" }], ["null state", { state: null }],
  ["invalid key", { claim_key: "bad-key" }], ["NUL-suffixed key", { claim_key: "a".repeat(64) + "\0" }],
  ["unsafe revision", { revision: 9_007_199_254_740_992 }], ["fractional revision", { revision: 1.5 }],
  ["malformed expiration", { expires_at: "2000-not-a-date" }], ["noncanonical date", { expires_at: "2026-01-01 00:00:00.000Z" }],
  ["overflow date", { expires_at: "2026-02-31T12:00:00.000Z" }], ["future creation", { created_at: "2099-01-01T00:00:00.000Z" }],
  ["preconsent creation", { created_at: "2000-01-01T00:00:00.000Z" }],
  ["expiry before creation", { created_at: null }],
]) test("document profile native suppression: expired-looking " + name + " is not hidden as valid history", t => {
  const f = nativeSuppressionFixture(t);
  const values = { expires_at: f.iso(f.now - 1_000), ...fields };
  if (name === "expiry before creation") values.created_at = f.iso(f.now - 500);
  f.suppress(suppressionKey(1), values);
  if (name === "unsafe revision") {
    // Node SQLite refuses an imprecise integer read by default. Preserve the
    // native integer as bigint to verify that the descriptor retained it and
    // the value validator rejects it rather than treating it as expired.
    const query = nativeDocumentProfileSuppressionsQuery(f.g), statement = f.db.prepare(query.sql);
    statement.setReadBigInts(true); const rows = statement.all(...query.bindings);
    assert.equal(rows.length, 1); assert.equal(nativeDocumentProfileSuppressionsValue(rows, f.g, f.now), null);
  } else {
    assert.equal(f.suppressionRows().length, 1); assert.equal(f.suppressionValue(), null);
  }
});

test("document profile native suppression: invalid future revoked record is not silently omitted", t => {
  const f = nativeSuppressionFixture(t);
  f.suppress(suppressionKey(1), { state: "revoked", created_at: f.iso(f.now + 1_000) });
  assert.equal(f.suppressionRows().length, 1); assert.equal(f.suppressionValue(), null);
});

test("document profile native suppression: original exact descriptor detects applicability changes", t => {
  const f = nativeSuppressionFixture(t), query = nativeDocumentProfileSuppressionsQuery(f.g), key = suppressionKey(1);
  const original = f.run(query); assert.deepEqual(original, []);
  f.suppress(key); const active = f.run(query); assert.notDeepEqual(active, original);
  const selected = nativeDocumentProfileSuppressionsValue(active, f.g, f.now);
  assert.equal(selected.validUntil, f.iso(f.now + 20_000));
  assert.equal(nativeDocumentProfileSuppressionsValue(active, f.g, f.now + 20_000), null, "original expiry never slides");
  f.db.prepare("UPDATE memory_document_profile_suppressions SET state='revoked'").run();
  assert.notDeepEqual(f.run(query), active); assert.deepEqual(f.run(query), original);
  f.db.prepare("UPDATE memory_document_profile_suppressions SET state='active'").run();
  assert.deepEqual(f.run(query), active);
  f.db.prepare("UPDATE memory_document_profile_suppressions SET expires_at=?").run(f.iso(f.now - 1_000));
  assert.notDeepEqual(f.run(query), active); assert.deepEqual(f.run(query), original);
});

test("document profile native suppression: grant revision and grant identity do not leak between queries", t => {
  const f = nativeSuppressionFixture(t);
  f.suppress(suppressionKey(1), { grant_revision: f.g.revision + 1 });
  f.suppress(suppressionKey(2), { grant_id: "other-grant" });
  assert.deepEqual(f.suppressionRows(), []);
  const query = nativeDocumentProfileSuppressionsQuery(f.g);
  assert.deepEqual(query.bindings, [f.g.grant_id, f.g.revision, f.g.consented_at, f.g.expires_at]);
  assert.equal(query.role, "exact");
});
