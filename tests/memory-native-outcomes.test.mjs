import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { nativeMemoryOutcomesQuery, nativeMemoryOutcomesSchemaQuery, nativeMemoryOutcomesValue } from "../worker/memory-native-outcomes.ts";
import { parseMemoryAssistedOutcomes } from "../src/model/memory-assisted-outcomes.ts";

// Ordinary in-memory SQLite only. This does not execute the Worker, native
// authority resolver, deployed database, provider, scheduler or browser.
globalThis.fetch = async () => { throw new Error("external_fetch_forbidden"); };
const iso = at => new Date(at).toISOString();

function fixture(t, { shared = false, status = "accepted", kind = "context.create", offset = 0 } = {}) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(readFileSync(new URL("./fixtures/local-migrations/0020_assistant_runtime_tables.sql", import.meta.url), "utf8"));
  db.exec(`CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,type TEXT,actor TEXT,client_id TEXT,
    correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,recorded_at TEXT,payload TEXT);
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,document_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE event_client_receipts(stream_id TEXT,client_event_id TEXT,event_id TEXT,sequence INTEGER,created_at TEXT);
    CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT);
    CREATE TABLE private_content_retention_scopes(content_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,actor_user_id TEXT,assigned_expires_at TEXT);
    CREATE TABLE project_resource_scopes(project_access_id TEXT,resource_kind TEXT,resource_id TEXT,organization_id TEXT,project_id TEXT,
      owner_user_id TEXT,visibility TEXT,actor_user_id TEXT);
    CREATE TABLE project_event_scopes(event_id TEXT,source_stream_id TEXT,source_sequence INTEGER,organization_id TEXT,
      project_access_id TEXT,project_id TEXT,owner_user_id TEXT,actor_user_id TEXT);
    CREATE TABLE memory_live_sources(enrollment_id TEXT,event_id TEXT,sequence INTEGER,expires_at TEXT);`);
  const now = Date.now(), checkedAt = iso(now), until = iso(now + 60_000), expires = iso(now + 86_400_000);
  const created = iso(now - 1_200_000), issuedAt = iso(now - 1_199_000), decided = iso(now - 960_000), mutationAt = iso(now - 959_000);
  const actor = "alice", owner = shared ? "owner" : actor, stream = "creative:" + owner;
  const e = { enrollment_id: "enrollment", actor_user_id: actor, owner_user_id: owner, organization_id: shared ? "org" : null,
    project_access_id: shared ? "access" : null, project_id: "project", document_id: "document", permission_epoch: "epoch", revision: 1,
    enrolled_at: iso(now - 86_400_000), expires_at: expires, retention_days: 30, cursor_sequence: 100 + offset };
  const scopeKey = JSON.stringify([e.organization_id ?? "", e.project_access_id ?? "", e.project_id, e.document_id]);
  const proposalId = "proposal-" + offset, turn = "turn-" + offset, actionId = "action-" + offset;
  const corr = `assistant-${status}:${actor}:${proposalId}`;
  const base = { actor_user_id: actor, project_id: "project", document_id: "document" };
  const add = (eventId, sequence, type, payload, options = {}) => {
    db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(eventId, stream, sequence, type, options.actor ?? "user:alice",
      options.client ?? "web:assistant", options.correlation ?? corr, options.causation ?? null, null,
      options.at ?? decided, JSON.stringify(payload));
    if (shared && options.scoped !== false) db.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?)")
      .run(eventId, stream, sequence, "org", "access", "project", owner, actor);
  };
  const resource = (block, visibility = "collaborative_output", user = actor, org = "org") => db.prepare("INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?)")
    .run("access", "block", block, org, "project", owner, visibility, user);
  add("block-event-" + offset, offset + 1, "BlockCreated", { ...base, block_id: "block", properties: { text: "unreturned private prose" } }, { at: iso(now - 2_000_000), correlation: "block-create" + offset });
  add("second-event-" + offset, offset + 2, "BlockCreated", { ...base, block_id: "second" }, { at: iso(now - 2_000_000), correlation: "second-create" + offset });
  if (shared) { resource("block"); resource("second"); }
  const action = kind === "context.create" ? { kind, blockType: "palette", text: "secret instruction", intent: "prefer" }
    : kind === "context.edit" ? { kind, targetBlockId: "block", text: "secret edit" }
      : kind === "context.remove" ? { kind, targetBlockId: "block" }
        : { kind, fromBlockId: "block", toBlockId: "second", relationKind: "elaborates" };
  db.prepare("INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)").run(actionId, actor, "assistant-action", JSON.stringify(action), created, expires);
  if (shared) {
    db.prepare("INSERT INTO private_content_retention_scopes VALUES(?,?,?,?,?,?)").run(actionId, "org", "access", "project", actor, expires);
    db.prepare("INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?)").run("access", "content", actionId, "org", "project", owner, "actor_private", actor);
  }
  const versions = kind.includes("relation") ? [{ blockId: "block", version: 1 }, { blockId: "second", version: 1 }] : [{ blockId: "block", version: 1 }];
  db.prepare("INSERT INTO assistant_action_proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(proposalId, actor, scopeKey, turn, e.organization_id, e.project_access_id, "project", "document", kind, actionId,
      JSON.stringify(versions), offset + 8, "epoch", status, created, iso(now - 300_000), decided);
  db.prepare("INSERT INTO assistant_action_commits VALUES(?,1,?)").run(proposalId + ":" + status, decided);
  const issuance = "issued-" + offset, decision = "decision-" + offset, mutation = "mutation-" + offset;
  add(issuance, offset + 10, "MutationProposed", { ...base, proposal_id: proposalId, turn_id: turn, action_kind: kind, content_ref: actionId },
    { actor: "model:forma-assistant", client: "server:assistant", correlation: actor + ":" + turn, at: issuedAt, scoped: false });
  const receipt = (eventId, sequence, key) => db.prepare("INSERT INTO event_client_receipts VALUES(?,?,?,?,?)").run(stream, key, eventId, sequence, decided);
  receipt(issuance, offset + 10, `assistant:${actor}:${e.project_access_id ?? "personal"}:document:${turn}:proposal:${proposalId}`);
  add(decision, offset + 20, status === "accepted" ? "ProposalAccepted" : "ProposalRejected", { ...base, proposal_id: proposalId, turn_id: turn },
    { scoped: status === "accepted" });
  if (!shared || status === "rejected") receipt(decision, offset + 20, corr + ":0");
  const sources = [{ eventId: decision, sequence: offset + 20, type: status === "accepted" ? "ProposalAccepted" : "ProposalRejected", blockId: null, recordedAt: decided, validUntil: expires }];
  if (status === "accepted") {
    const type = { "context.create": "BlockCreated", "context.edit": "BlockPropertyEdited", "context.remove": "BlockRemoved",
      "context.relation.add": "BlockRelationAdded", "context.relation.remove": "BlockRelationRemoved" }[kind];
    const target = kind === "context.create" ? "new-block-" + offset : "block";
    const payload = kind.includes("relation") ? { from_block_id: "block", to_block_id: "second", relation_id: "relation" }
      : { block_id: target, properties: { text: "new private contents" } };
    add(mutation, offset + 21, type, { ...base, ...payload, source_chat_turn_id: turn }, { causation: shared ? null : decision, at: mutationAt });
    if (shared && kind === "context.create") resource(target);
    if (!shared) receipt(mutation, offset + 21, corr + ":1");
    sources.push({ eventId: mutation, sequence: offset + 21, type, blockId: kind.includes("relation") ? null : target, recordedAt: mutationAt, validUntil: expires });
  }
  sources.forEach(source => db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)").run(e.enrollment_id, source.eventId, source.sequence, expires));
  // A deliberately small, trusted native-source SELECT port. Full application q
  // and principal admission are exercised only by later composed HTTP tests.
  const q = { joins: "FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id " +
    "JOIN (SELECT ? AS actor,? AS scope_key,? AS project,? AS document,? AS org,? AS access) native",
    condition: "event.stream_id=? AND event.actor=? AND json_extract(event.payload,'$.project_id')=native.project " +
      "AND json_extract(event.payload,'$.document_id')=native.document AND " + (shared
        ? "EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id AND custody.source_stream_id=event.stream_id AND custody.source_sequence=event.sequence AND custody.organization_id=native.org AND custody.project_access_id=native.access AND custody.actor_user_id=native.actor)"
        : "NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id)"),
    bindings: [actor, scopeKey, "project", "document", e.organization_id, e.project_access_id, stream, "user:alice"] };
  const rows = () => { const query = nativeMemoryOutcomesQuery(e, q, sources); return db.prepare(query.sql).all(...query.bindings); };
  const read = () => nativeMemoryOutcomesValue(rows(), e, sources, checkedAt, until);
  return { db, e, q, sources, rows, read, now, checkedAt, until, expires, created, decided, actionId, proposalId, turn, issuance, decision, mutation, add, resource, receipt };
}

for (const shared of [false, true]) test("native outcomes: " + (shared ? "shared" : "personal") + " acceptance coalesces exact selected pair after proposal admission expires", t => {
  const f = fixture(t, { shared }), result = f.read(); assert.ok(result);
  assert.equal(result.value.outcomes.length, 1); const item = result.value.outcomes[0];
  assert.deepEqual(item.decision, { sourceIndex: 0 }); assert.equal(item.mutation.sourceIndex, 1);
  assert.equal(item.origin, "assistant-assisted"); assert.equal(item.independentEvidence, false);
  assert.equal(result.validUntil, f.until); assert.equal(result.value.exposure, "not-measured");
  assert.equal(Object.hasOwn(item, "sourceVersions"), false); assert.equal(Object.hasOwn(item, "issued"), false);
  assert.doesNotMatch(JSON.stringify(result), /secret|private contents|instruction|sourceVersions/u);
  assert.deepEqual(f.read(), result, "read/replay never multiplies evidence or renews retention");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM assistant_action_commits").get().n, 1);
});

test("native outcomes: personal rejection has no mutation and no inferred preference", t => {
  const f = fixture(t, { status: "rejected" }), result = f.read();
  assert.equal(result.value.outcomes.length, 1); assert.equal(result.value.outcomes[0].mutation, null);
  assert.equal(result.value.outcomes[0].status, "rejected");
});
test("native outcomes: unindexed shared rejection is not manufactured into eligible history", t => {
  const f = fixture(t, { shared: true, status: "rejected" }); assert.equal(f.read().value.outcomes.length, 0);
});
for (const kind of ["context.edit", "context.relation.add", "context.relation.remove"]) test("native outcomes: typed " + kind + " matches canonical target identities", t => {
  const f = fixture(t, { kind }); assert.equal(f.read().value.outcomes[0].actionKind, kind);
});
test("native outcomes: deleted target of accepted remove is omitted, not revived for a receipt", t => {
  const f = fixture(t, { kind: "context.remove" }); assert.equal(f.read().value.outcomes.length, 0);
});
test("native outcomes: query preserves the supplied predicate and six-join binding convention", t => {
  const f = fixture(t), query = nativeMemoryOutcomesQuery(f.e, f.q, f.sources);
  assert.ok(query.sql.includes(f.q.joins)); assert.ok(query.sql.includes(f.q.condition));
  assert.deepEqual(query.bindings.slice(0, 6), f.q.bindings.slice(0, 6));
  assert.equal(query.bindings[6], f.e.enrollment_id); assert.deepEqual(JSON.parse(query.bindings[7]), f.sources);
  assert.equal(query.bindings.length, (query.sql.match(/\?/gu) ?? []).length);
  assert.ok(query.bindings.length <= 99 && query.sql.length <= 90_000); assert.equal(query.role, "exact");
});

const corruption = {
  "missing verified commit": f => f.db.prepare("DELETE FROM assistant_action_commits").run(),
  "missing issuance receipt": f => f.db.prepare("DELETE FROM event_client_receipts WHERE event_id=?").run(f.issuance),
  "duplicate issuance receipts": f => f.db.prepare("INSERT INTO event_client_receipts SELECT * FROM event_client_receipts WHERE event_id=?").run(f.issuance),
  "duplicate receipt key with different target": f => f.db.prepare("INSERT INTO event_client_receipts SELECT stream_id,client_event_id,'other-event',999,created_at FROM event_client_receipts WHERE event_id=?").run(f.issuance),
  "missing decision receipt": f => f.db.prepare("DELETE FROM event_client_receipts WHERE event_id=?").run(f.decision),
  "missing mutation receipt": f => f.db.prepare("DELETE FROM event_client_receipts WHERE event_id=?").run(f.mutation),
  "wrong proposal actor": f => f.db.prepare("UPDATE assistant_action_proposals SET actor_user_id='other'").run(),
  "wrong proposal custody": f => f.db.prepare("UPDATE assistant_action_proposals SET organization_id='foreign',project_access_id='foreign'").run(),
  "wrong proposal permission epoch": f => f.db.prepare("UPDATE assistant_action_proposals SET permission_epoch='other'").run(),
  "wrong proposal document": f => f.db.prepare("UPDATE assistant_action_proposals SET document_id='other'").run(),
  "rewritten action kind": f => f.db.prepare("UPDATE assistant_action_proposals SET action_kind='context.remove'").run(),
  "redacted private action": f => f.db.prepare("UPDATE private_content SET redacted_at=?").run(f.checkedAt),
  "expired private action": f => f.db.prepare("UPDATE private_content SET expires_at=?").run(iso(f.now - 1)),
  "missing mutation": f => f.db.prepare("DELETE FROM events WHERE event_id=?").run(f.mutation),
  "wrong remembered sequence": f => f.db.prepare("UPDATE memory_live_sources SET sequence=999 WHERE event_id=?").run(f.mutation),
  "expired remembered source": f => f.db.prepare("UPDATE memory_live_sources SET expires_at=? WHERE event_id=?").run(iso(f.now - 1), f.mutation),
  "decision after admission deadline": f => f.db.prepare("UPDATE assistant_action_proposals SET expires_at=?").run(iso(Date.parse(f.decided) - 1)),
  "future proposal resolution": f => f.db.prepare("UPDATE assistant_action_proposals SET resolved_at=?").run(iso(f.now + 1)),
  "pre-enrollment proposal": f => { f.e.enrolled_at = iso(f.now - 1_000_000); },
  "correlated extra event": f => f.add("extra", 22, "BlockWeightSet", { project_id: "project", document_id: "document", block_id: "block" }),
  "removed current source block": f => f.add("removed", 40, "BlockRemoved", { project_id: "project", document_id: "document", block_id: "block" }, { correlation: "later" }),
  "rehomed target": f => f.add("rehomed", 40, "BlockRehomed", { project_id: "project", document_id: "other", block_id: "block", scope: "document" }, { correlation: "later" }),
  "recreated source block": f => f.add("recreated", 40, "BlockCreated", { project_id: "project", document_id: "document", block_id: "block" }, { correlation: "later" }),
};
for (const [name, mutate] of Object.entries(corruption)) test("native outcomes: omits " + name, t => {
  const f = fixture(t); assert.equal(f.read().value.outcomes.length, 1); mutate(f);
  const value = f.read(); assert.ok(value === null || value.value.outcomes.length === 0);
});

for (const bad of ["not-json", '["x"]', '"x"', '[null]', '[1]', '{}', '[{"blockId":"block","version":0}]',
  '[{"blockId":"block","version":1,"private":"prose"}]', '[{"blockId":"block","version":1},{"blockId":"block","version":1}]', JSON.stringify(Array.from({ length: 17 }, (_, n) => ({ blockId: "block" + n, version: 1 })))])
  test("native outcomes: malformed recorded preconditions are omitted without SQLite JSON failure " + bad.slice(0, 36), t => {
    const f = fixture(t); f.db.prepare("UPDATE assistant_action_proposals SET source_versions_json=?").run(bad);
    const result = f.read(); assert.ok(result === null || result.value.outcomes.length === 0);
  });
test("native outcomes: mutable precondition version is never published as certified history", t => {
  const f = fixture(t), first = f.read(); f.db.prepare("UPDATE assistant_action_proposals SET source_versions_json=?").run('[{"blockId":"block","version":999}]');
  assert.deepEqual(f.read(), first); assert.equal(Object.hasOwn(first.value.outcomes[0], "sourceVersions"), false);
});
for (const change of ["assigned expiry", "private target", "conflicting resource", "missing content custody", "conflicting content custody", "duplicate assigned retention"]) test("native outcomes: shared " + change + " fails closed", t => {
  const f = fixture(t, { shared: true }); assert.equal(f.read().value.outcomes.length, 1);
  if (change === "assigned expiry") f.db.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=?").run(iso(f.now - 1));
  if (change === "private target") f.db.prepare("UPDATE project_resource_scopes SET visibility='actor_private',actor_user_id='other' WHERE resource_kind='block'").run();
  if (change === "conflicting resource") f.resource("block", "collaborative_output", "other", "foreign");
  if (change === "missing content custody") f.db.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content'").run();
  if (change === "conflicting content custody") f.db.prepare("INSERT INTO project_resource_scopes SELECT project_access_id,resource_kind,resource_id,'foreign',project_id,owner_user_id,visibility,actor_user_id FROM project_resource_scopes WHERE resource_kind='content'").run();
  if (change === "duplicate assigned retention") f.db.prepare("INSERT INTO private_content_retention_scopes SELECT * FROM private_content_retention_scopes").run();
  assert.equal(f.read().value.outcomes.length, 0);
});
test("native outcomes: absolute private and assigned deadlines constrain the outer recall lease", t => {
  const f = fixture(t, { shared: true }), privateUntil = iso(f.now + 40_000), assignedUntil = iso(f.now + 20_000);
  f.db.prepare("UPDATE private_content SET expires_at=?").run(privateUntil);
  f.db.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=?").run(assignedUntil);
  const rows = f.rows(), result = nativeMemoryOutcomesValue(rows, f.e, f.sources, f.checkedAt, f.until);
  assert.equal(result.validUntil, assignedUntil);
  assert.equal(nativeMemoryOutcomesValue(rows, f.e, f.sources, assignedUntil, iso(f.now + 50_000)).value.outcomes.length, 0);
});
test("native outcomes: selected-window omission cannot widen source authority", t => {
  const f = fixture(t); f.sources.pop(); assert.equal(f.read().value.outcomes.length, 0);
});
test("native outcomes: a posted lookalike decision remains an action, not a second certified outcome", t => {
  const f = fixture(t);
  f.add("forged-decision", 40, "ProposalAccepted", { actor_user_id: "alice", project_id: "project", document_id: "document", proposal_id: f.proposalId, turn_id: f.turn },
    { client: "web:events", correlation: "posted-lookalike", at: f.checkedAt });
  f.sources.push({ eventId: "forged-decision", sequence: 40, type: "ProposalAccepted", blockId: null, recordedAt: f.checkedAt, validUntil: f.expires });
  f.db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)").run(f.e.enrollment_id, "forged-decision", 40, f.expires);
  const result = f.read(); assert.equal(result.value.coverage.selectedDecisionCount, 2);
  assert.equal(result.value.outcomes.length, 1); assert.equal(result.value.outcomes[0].decision.sourceIndex, 0);
  assert.equal(result.value.coverage.completeHistory, false);
});
test("native outcomes: enrollment and original enclosing lease remain absolute minima", t => {
  const f = fixture(t), rows = f.rows(); f.e.expires_at = iso(f.now + 15_000);
  assert.equal(nativeMemoryOutcomesValue(rows, f.e, f.sources, f.checkedAt, f.until).validUntil, f.e.expires_at);
  assert.equal(nativeMemoryOutcomesValue(rows, f.e, f.sources, f.checkedAt, iso(f.now + 5_000)).validUntil, iso(f.now + 5_000));
  f.e.expires_at = f.checkedAt; assert.equal(nativeMemoryOutcomesValue(rows, f.e, f.sources, f.checkedAt, f.until), null);
});
test("native outcomes: caller source order is preserved in public indexes", t => {
  const f = fixture(t); f.sources.reverse(); const value = f.read().value;
  assert.equal(value.outcomes[0].decision.sourceIndex, 1); assert.equal(value.outcomes[0].mutation.sourceIndex, 0);
});
test("native outcomes: schema absence is explicit and never initialized", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close()); const q = nativeMemoryOutcomesSchemaQuery();
  assert.equal(db.prepare(q.sql).get(...q.bindings).ready, 0); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema").get().n, 0);
  const f = fixture(t); assert.equal(f.db.prepare(q.sql).get(...q.bindings).ready, 1);
});
test("native outcomes: duplicate native rows fail closed instead of choosing one", t => {
  const f = fixture(t), rows = f.rows(); assert.equal(nativeMemoryOutcomesValue([...rows, ...rows], f.e, f.sources, f.checkedAt, f.until), null);
});
test("native outcomes: source and row caps are hard failures", t => {
  const f = fixture(t), refs = Array.from({ length: 65 }, (_, n) => ({ ...f.sources[0], eventId: "event" + n, sequence: n + 1 }));
  assert.throws(() => nativeMemoryOutcomesQuery(f.e, f.q, refs), /selection_invalid/u);
  assert.equal(nativeMemoryOutcomesValue(Array.from({ length: 65 }, () => f.rows()[0]), f.e, f.sources, f.checkedAt, f.until), null);
});
test("native outcomes: malformed and sparse projection inputs fail closed without exceptions", t => {
  const f = fixture(t), row = f.rows()[0], circular = {}; circular.self = circular;
  for (const rows of [[null], new Array(1), [1], [circular], [{ ...row, hidden: 1n }]])
    assert.equal(nativeMemoryOutcomesValue(rows, f.e, f.sources, f.checkedAt, f.until), null);
  assert.equal(nativeMemoryOutcomesValue([row], f.e, new Array(1), f.checkedAt, f.until), null);
  assert.throws(() => nativeMemoryOutcomesQuery(f.e, f.q, new Array(1)), /selection_invalid/u);
});
test("native outcomes: personal source target cannot acquire a conflicting shared resource binding", t => {
  const f = fixture(t); f.resource("block"); assert.equal(f.read().value.outcomes.length, 0);
});
test("native outcomes: another authorized creator's collaborative block remains readable target evidence", t => {
  const f = fixture(t, { shared: true }), blockEvent = "block-event-0";
  f.db.prepare("UPDATE events SET actor='user:creator',payload=json_set(payload,'$.actor_user_id','creator','$._private_ref',event_id) WHERE event_id=?").run(blockEvent);
  const payload = f.db.prepare("SELECT payload FROM events WHERE event_id=?").get(blockEvent).payload;
  f.db.prepare("INSERT INTO event_private_payloads VALUES(?,?,?,?,?,NULL)").run(blockEvent, "owner", "project", "document", payload);
  f.db.prepare("UPDATE project_event_scopes SET actor_user_id='creator' WHERE event_id=?").run(blockEvent);
  assert.equal(f.read().value.outcomes.length, 1);
  f.db.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.actor_user_id','impostor') WHERE private_event_id=?").run(blockEvent);
  assert.equal(f.read().value.outcomes.length, 0);
});
test("native outcomes: legacy shared-owner resource anchor retains exact migrated owner attribution", t => {
  const f = fixture(t, { shared: true }), eventId = "block-event-0";
  f.db.prepare("UPDATE events SET actor='user',payload=json_set(payload,'$.actor_user_id','owner','$._private_ref',event_id) WHERE event_id=?").run(eventId);
  const payload = f.db.prepare("SELECT payload FROM events WHERE event_id=?").get(eventId).payload;
  f.db.prepare("INSERT INTO event_private_payloads VALUES(?,?,?,?,?,NULL)").run(eventId, "owner", "project", "document", payload);
  f.db.prepare("UPDATE project_event_scopes SET actor_user_id='owner' WHERE event_id=?").run(eventId);
  assert.equal(f.read().value.outcomes.length, 1);
  f.db.prepare("UPDATE project_event_scopes SET actor_user_id='alice' WHERE event_id=?").run(eventId);
  assert.equal(f.read().value.outcomes.length, 0, "legacy resource anchor cannot be attributed to a different collaborator");
});
for (const change of ["missing anchor custody", "foreign anchor custody", "wrong anchor sequence", "wrong anchor actor", "duplicate anchor custody", "foreign restore"]) test("native outcomes: shared target rejects " + change, t => {
  const f = fixture(t, { shared: true }); assert.equal(f.read().value.outcomes.length, 1);
  if (change === "missing anchor custody") f.db.prepare("DELETE FROM project_event_scopes WHERE event_id='block-event-0'").run();
  if (change === "foreign anchor custody") f.db.prepare("UPDATE project_event_scopes SET organization_id='other' WHERE event_id='block-event-0'").run();
  if (change === "wrong anchor sequence") f.db.prepare("UPDATE project_event_scopes SET source_sequence=999 WHERE event_id='block-event-0'").run();
  if (change === "wrong anchor actor") f.db.prepare("UPDATE project_event_scopes SET actor_user_id='impostor' WHERE event_id='block-event-0'").run();
  if (change === "duplicate anchor custody") f.db.prepare("INSERT INTO project_event_scopes SELECT * FROM project_event_scopes WHERE event_id='block-event-0'").run();
  if (change === "foreign restore") {
    f.add("removed", 40, "BlockRemoved", { actor_user_id: "alice", project_id: "project", document_id: "document", block_id: "block" }, { correlation: "removal" });
    f.add("foreign-restore", 41, "BlockRestored", { actor_user_id: "alice", project_id: "project", document_id: "document", block_id: "block" }, { correlation: "restore" });
    f.db.prepare("UPDATE project_event_scopes SET organization_id='other' WHERE event_id='foreign-restore'").run();
  }
  assert.equal(f.read().value.outcomes.length, 0);
});

const wireChanges = {
  "unknown key": value => { value.secret = "not allowed"; },
  "false exposure claim": value => { value.exposure = "viewed"; },
  "independent preference": value => { value.outcomes[0].independentEvidence = true; },
  "boxed status": value => { value.outcomes[0].status = new String("accepted"); },
  "off-window decision": value => { value.outcomes[0].decision.sourceIndex = 99; },
  "wrong decision source": value => { value.outcomes[0].decision.sourceIndex = 1; },
  "same mutation source": value => { value.outcomes[0].mutation.sourceIndex = 0; },
  "wrong mutation type": value => { value.outcomes[0].mutation.type = "BlockRemoved"; },
  "wrong mutation block": value => { value.outcomes[0].mutation.blockIds = ["foreign"]; },
  "changed decision time": value => { value.outcomes[0].recordedAt = "2020-01-01T00:00:00.000Z"; },
  "invented history count": value => { value.coverage.certifiedOutcomeCount++; },
  "complete history claim": value => { value.coverage.completeHistory = true; },
  "duplicate proposal": value => { value.outcomes.push(structuredClone(value.outcomes[0])); value.coverage.certifiedOutcomeCount++; },
  "uncertified source versions": value => { value.outcomes[0].sourceVersions = [{ blockId: "block", version: 1 }]; },
};
for (const [name, mutate] of Object.entries(wireChanges)) test("native outcomes parser: rejects " + name, t => {
  const f = fixture(t), result = f.read(), value = structuredClone(result.value); mutate(value);
  assert.equal(parseMemoryAssistedOutcomes(value, f.sources, { checkedAt: f.checkedAt, validUntil: result.validUntil }), null);
});
test("native outcomes parser: rejects oversized metadata and expired parent lease without a partial result", t => {
  const f = fixture(t), result = f.read(), value = structuredClone(result.value); value.outcomes[0].proposalId = "x".repeat(16_385);
  assert.equal(parseMemoryAssistedOutcomes(value, f.sources, { checkedAt: f.checkedAt, validUntil: result.validUntil }), null);
  assert.equal(parseMemoryAssistedOutcomes(result.value, f.sources, { checkedAt: f.until, validUntil: f.until }), null);
});
test("native outcomes parser: rejects sparse relation target arrays instead of emitting undefined IDs", t => {
  const f = fixture(t, { kind: "context.relation.add" }), result = f.read(), value = structuredClone(result.value);
  delete value.outcomes[0].mutation.blockIds[1];
  assert.equal(parseMemoryAssistedOutcomes(value, f.sources, { checkedAt: f.checkedAt, validUntil: result.validUntil }), null);
});
test("native outcomes parser: 16KiB total cap rejects individually valid bounded outcome members", t => {
  const f = fixture(t, { status: "rejected" }), result = f.read();
  const make = count => {
    const sources = Array.from({ length: count }, (_, n) => ({ ...f.sources[0], eventId: "decision-" + n }));
    const value = structuredClone(result.value);
    value.outcomes = sources.map((_, n) => ({ ...structuredClone(result.value.outcomes[0]),
      proposalId: "p".repeat(236) + String(n).padStart(4, "0"), turnId: "t".repeat(236) + String(n).padStart(4, "0"), decision: { sourceIndex: n } }));
    value.coverage = { ...value.coverage, selectedSourceCount: count, selectedDecisionCount: count, certifiedOutcomeCount: count };
    return { sources, value };
  };
  const small = make(8), large = make(64), lifetime = { checkedAt: f.checkedAt, validUntil: result.validUntil };
  assert.ok(parseMemoryAssistedOutcomes(small.value, small.sources, lifetime));
  assert.ok(Buffer.byteLength(JSON.stringify(large.value)) > 16_384);
  assert.equal(parseMemoryAssistedOutcomes(large.value, large.sources, lifetime), null);
});
