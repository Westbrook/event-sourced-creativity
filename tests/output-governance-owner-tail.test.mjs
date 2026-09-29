import test from "node:test";
import assert from "node:assert/strict";
import { backup } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { database, captureOutputGovernanceAssertions, synchronizeProjectScope, org, targetOwner } from "./output-governance-budget-fixture.mjs";
const { outputSourceEpochAssertion } = await import("../worker/output-requirements-ledger.ts");
const { makeEvent, eventWriteBindings, EVENT_WRITE_COLUMNS } = await import("../worker/runtime.ts");

globalThis.fetch = async () => { throw new Error("network_sentinel"); };
const targetScope = { organizationId: org, projectAccessId: "target-access", projectId: "target-project", ownerUserId: targetOwner };
const headSql = "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?";
const capture = fixture => captureOutputGovernanceAssertions(fixture.env, org, [fixture.block], { deferValidation: true, maximumCaptureBatches: 2 });
const synchronizeTarget = fixture => synchronizeProjectScope(fixture.env, targetScope);
const cursor = fixture => fixture.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id='source-access'").get().last_owner_sequence;
const currentHead = fixture => fixture.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(`creative:${targetOwner}`).head;
async function check(fixture, assertions) {
  const results = await fixture.env.DB.batch(assertions.map(assertion => fixture.env.DB.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).bind(...(assertion.bindings ?? []))));
  return results.every(result => result.success && result.results[0]?.current === 1);
}
async function sameOwner() {
  const fixture = await database({ sourceUserId: targetOwner });
  await synchronizeTarget(fixture);
  return fixture;
}
function appendTarget(fixture, type, payload = {}, overrides = {}) {
  return fixture.append(targetOwner, type, { project_id: "target-project", document_id: "target-document", ...payload }, { clientId: "server:output-requirements", ...overrides });
}
async function outputTail(fixture) {
  const event = appendTarget(fixture, "BlockCreated", { block_id: "new-output", type: "output", scope: "document", properties: { text: "Other project private prose must not enter source proof" } });
  await synchronizeTarget(fixture); return event;
}
const storedPrivate = (fixture, event) => fixture.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(event.eventId).private_json;
const replacePrivate = (fixture, event, json) => fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(json, event.eventId);
const duplicateRoot = (json, key, value) => `${json.slice(0, -1)},${JSON.stringify(key)}:${JSON.stringify(value)}}`;
const synchronizeOriginFixture = fixture => synchronizeProjectScope(fixture.env, { ...targetScope, projectAccessId: "source-access", projectId: "source-project" });
async function strictIdentityReplay(t, fixture, assertions, expectedCurrent) {
  const captures = fixture.statements.filter(statement => statement.sql.includes("AS proof_json")).map(({ sql, bindings }) => ({ sql, bindings }));
  const directory = mkdtempSync(join(tmpdir(), "forma-governance-identity-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "fixture.sqlite"); await backup(fixture.sqlite, path);
  const script = String.raw`
import json,sqlite3,sys
request=json.load(sys.stdin); db=sqlite3.connect(request['database'])
db.setlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32)
db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100)
db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000)
db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH,2000000)
maximumSql=0; maximumRow=0
for statement in request['captures']:
    maximumSql=max(maximumSql,len(statement['sql'].encode('utf8')))
    assert len(statement['bindings'])<=100
    value=db.execute(statement['sql'],statement['bindings']).fetchone()[0]
    assert isinstance(value,str)
    maximumRow=max(maximumRow,len(value.encode('utf8')))
checks=[]
for assertion in request['assertions']:
    sql='SELECT CASE WHEN ('+assertion['sql']+') THEN 1 ELSE 0 END'
    maximumSql=max(maximumSql,len(sql.encode('utf8')))
    assert len(assertion.get('bindings',[]))<=100
    checks.append(db.execute(sql,assertion.get('bindings',[])).fetchone()[0])
assert all(checks)==request['expectedCurrent'],checks
print(json.dumps({'sqlite':sqlite3.sqlite_version,'maximumSqlBytes':maximumSql,'maximumProofRowBytes':maximumRow,'privateIdentityCurrent':all(checks),'statementCount':len(request['captures'])+len(request['assertions'])}))
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], { input: JSON.stringify({ database: path, captures, assertions, expectedCurrent }), encoding: "utf8", maxBuffer: 1_000_000, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error)); t.diagnostic(result.stdout.trim());
}

test("same-owner Output authoring in another project preserves source currency without changing its cursor", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const initialCursor = cursor(fixture);
  await outputTail(fixture);
  for (const type of ["OutputPlanConfirmed", "OutputPlanPreflighted", "OutputExecutionAuthorized", "OutputExecutionRunRequested", "OutputAssetAdopted", "OutputResultBound", "OutputTargetAccepted", "OutputDeliveryPrepared"]) {
    appendTarget(fixture, type); await synchronizeTarget(fixture);
    fixture.transport.d1 = 0;
    const assertions = await capture(fixture);
    assert.equal(fixture.transport.d1, 2);
    assert.equal(await check(fixture, assertions), true);
    assert.equal(cursor(fixture), initialCursor);
    assert.equal(JSON.stringify(assertions).includes("Other project private prose"), false);
  }
});

test("a package's new reference, rights and block effects belong to B while A provenance stays intact", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const initialCursor = cursor(fixture);
  appendTarget(fixture, "ReferenceIngested", { reference_id: "adopted-reference", content_hash: "a".repeat(64), source_ref: "/api/media/adopted-file.png", rights_class: "asserted" }, { clientId: `project:${targetOwner}` });
  appendTarget(fixture, "RightsAsserted", { reference_id: "adopted-reference", rights_class: "owned_or_licensed" }, { clientId: `project:${targetOwner}` });
  appendTarget(fixture, "BlockCreated", { block_id: "adopted-block", type: "reference", scope: "document", properties: { reference_id: "adopted-reference", organization_context_source_block_id: "source-block", source_document_id: "source-document" } }, { clientId: `project:${targetOwner}` });
  appendTarget(fixture, "BlockLocked", { block_id: "adopted-block" }, { clientId: `project:${targetOwner}` });
  await outputTail(fixture);
  appendTarget(fixture, "BlockRelationAdded", { relation_id: "adopted-relation", from_block_id: "adopted-block", to_block_id: "new-output", kind: "visual_evidence" }, { clientId: `project:${targetOwner}` });
  await synchronizeTarget(fixture);
  assert.equal(await check(fixture, await capture(fixture)), true);
  assert.equal(cursor(fixture), initialCursor);
});

test("exact package audit tuples explain metadata-only owner tail entries without inventing event-id links", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const initialCursor = cursor(fixture), now = new Date().toISOString();
  for (const [type, kind, id] of [
    ["OrganizationContextPackageCreated", "context-package", "package"],
    ["OrganizationContextPackageVersionDrafted", "context-package-version", "version"],
    ["OrganizationContextPackageVersionPublished", "context-package-version", "version"],
    ["OrganizationContextPackageAdopted", "context-package-binding", "binding"],
  ]) {
    fixture.insert("organization_audit_events", { audit_id: `audit-${type}`, organization_id: org, actor_user_id: targetOwner, action: type, resource_kind: kind, resource_id: id, detail_json: JSON.stringify({ note: "Other audit private prose" }), occurred_at: now });
    fixture.append(targetOwner, type, { organization_id: org, resource_kind: kind, resource_id: id }, { clientId: "server:workspace", correlationId: `different-event-correlation-${type}` });
  }
  const assertions = await capture(fixture);
  assert.equal(await check(fixture, assertions), true); assert.equal(cursor(fixture), initialCursor);
  assert.equal(JSON.stringify(assertions).includes("Other audit private prose"), false);
  assert.throws(() => fixture.sqlite.exec("DELETE FROM organization_audit_events WHERE action='OrganizationContextPackageCreated'"), /append-only/u);
  fixture.insert("organization_audit_events", { audit_id: "second-created-audit", organization_id: org, actor_user_id: targetOwner, action: "OrganizationContextPackageCreated", resource_kind: "context-package", resource_id: "package", detail_json: "{}", occurred_at: now });
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

for (const field of ["organization_id", "resource_kind", "resource_id", "unknown_private_property"]) test(`audit private ${field} cannot diverge from the exact metadata writer`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const type = "OrganizationContextPackageCreated", now = new Date().toISOString();
  fixture.insert("organization_audit_events", { audit_id: "one-audit", organization_id: org, actor_user_id: targetOwner, action: type, resource_kind: "context-package", resource_id: "package", detail_json: "{}", occurred_at: now });
  const event = fixture.append(targetOwner, type, { organization_id: org, resource_kind: "context-package", resource_id: "package" }, { clientId: "server:workspace" });
  const assertions = await capture(fixture);
  fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,?,?) WHERE private_event_id=?").run(`$.${field}`, "unexpected", event.eventId);
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("an audit type cannot hide effect metadata that its actual writer never emits", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const type = "OrganizationContextPackageCreated";
  fixture.insert("organization_audit_events", { audit_id: "one-audit", organization_id: org, actor_user_id: targetOwner, action: type, resource_kind: "context-package", resource_id: "package", detail_json: "{}", occurred_at: new Date().toISOString() });
  fixture.append(targetOwner, type, { organization_id: org, resource_kind: "context-package", resource_id: "package", object_ids: ["unknown-output"] }, { clientId: "server:workspace" });
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

for (const reference of [false, true]) test(`removing an unrelated B ${reference ? "reference" : "Output"} block preserves every earlier tail effect through retained historical custody`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const initialCursor = cursor(fixture);
  if (reference) {
    appendTarget(fixture, "ReferenceIngested", { reference_id: "scratch-reference", content_hash: "b".repeat(64), source_ref: "/api/media/scratch.png", rights_class: "owned_or_licensed" }, { clientId: `project:${targetOwner}` });
    appendTarget(fixture, "RightsAsserted", { reference_id: "scratch-reference", rights_class: "owned_or_licensed" }, { clientId: `project:${targetOwner}` });
  }
  const created = appendTarget(fixture, "BlockCreated", { block_id: "scratch-block", type: reference ? "reference" : "output", scope: "document", properties: reference ? { reference_id: "scratch-reference", text: "Scratch file" } : { text: "Scratch deliverable" } });
  await synchronizeTarget(fixture);
  appendTarget(fixture, "BlockPropertyEdited", { block_id: "scratch-block", property_path: "text", new_value: "Changed scratch text" });
  appendTarget(fixture, "BlockRemoved", { block_id: "scratch-block" });
  await synchronizeTarget(fixture);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE project_access_id='target-access' AND resource_id='scratch-block'").get().n, 0);
  if (reference) assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE project_access_id='target-access' AND resource_id='scratch-reference'").get().n, 0);
  const assertions = await capture(fixture);
  assert.equal(await check(fixture, assertions), true); assert.equal(cursor(fixture), initialCursor);
  fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(created.eventId);
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("a missing live block resource is not historical removal without a retained, correctly owned removal", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  await outputTail(fixture);
  fixture.sqlite.exec("DELETE FROM project_resource_scopes WHERE project_access_id='target-access' AND resource_kind='block' AND resource_id='new-output'");
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
  const removed = appendTarget(fixture, "BlockRemoved", { block_id: "new-output" }); await synchronizeTarget(fixture);
  const assertions = await capture(fixture); assert.equal(await check(fixture, assertions), true);
  fixture.sqlite.prepare("UPDATE event_private_payloads SET owner_id='wrong-owner' WHERE private_event_id=?").run(removed.eventId);
  assert.equal(await check(fixture, assertions), false);
});

test("resource visibility remains a current custody requirement for unrelated B targets", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); await outputTail(fixture);
  const assertions = await capture(fixture);
  fixture.sqlite.exec("UPDATE project_resource_scopes SET visibility='actor_private' WHERE project_access_id='target-access' AND resource_kind='block' AND resource_id='new-output'");
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

for (const key of ["block_id", "project_id", "document_id"]) test(`duplicate current private ${key} cannot use SQLite's first identity to hide JavaScript's last`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const event = await outputTail(fixture);
  const assertions = await capture(fixture), original = storedPrivate(fixture, event);
  const foreign = key === "block_id" ? "source-block" : key === "project_id" ? "source-project" : "source-document";
  const malformed = duplicateRoot(original, key, foreign); replacePrivate(fixture, event, malformed);
  assert.notEqual(fixture.sqlite.prepare("SELECT json_extract(?,?) AS value").get(malformed, `$.${key}`).value, JSON.parse(malformed)[key], "the regression must exercise the actual SQL/JS parsing disagreement");
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

for (const historical of [false, true]) test(`a removed B block cannot use duplicate creation identity, creation before cursor=${historical}`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const created = appendTarget(fixture, "BlockCreated", { block_id: "scratch-block", type: "direction", scope: "document", properties: { text: "Scratch direction" } });
  await synchronizeTarget(fixture);
  if (historical) await synchronizeOriginFixture(fixture);
  const initialCursor = cursor(fixture);
  appendTarget(fixture, "BlockRemoved", { block_id: "scratch-block" }); await synchronizeTarget(fixture);
  const assertions = await capture(fixture); assert.equal(await check(fixture, assertions), true);
  replacePrivate(fixture, created, duplicateRoot(storedPrivate(fixture, created), "block_id", "source-block"));
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
  assert.equal(cursor(fixture), initialCursor);
});

for (const mutation of ["properties", "reference_id", "escaped reference_id"]) test(`historical reference custody rejects duplicate ${mutation} rather than choosing a different copied source`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  appendTarget(fixture, "ReferenceIngested", { reference_id: "scratch-reference", content_hash: "b".repeat(64), source_ref: "/api/media/scratch.png", rights_class: "owned_or_licensed" }, { clientId: `project:${targetOwner}` });
  const created = appendTarget(fixture, "BlockCreated", { block_id: "scratch-block", type: "reference", scope: "document", properties: { reference_id: "scratch-reference", text: "Scratch reference" } });
  await synchronizeTarget(fixture); await synchronizeOriginFixture(fixture); const initialCursor = cursor(fixture);
  appendTarget(fixture, "RightsAsserted", { reference_id: "scratch-reference", rights_class: "owned_or_licensed" }, { clientId: `project:${targetOwner}` });
  appendTarget(fixture, "BlockRemoved", { block_id: "scratch-block" }); await synchronizeTarget(fixture);
  const assertions = await capture(fixture); assert.equal(await check(fixture, assertions), true);
  const original = storedPrivate(fixture, created), properties = JSON.stringify(JSON.parse(original).properties);
  const malformed = mutation === "properties" ? duplicateRoot(original, "properties", { reference_id: "source-reference" })
    : original.replace(`"properties":${properties}`, `"properties":${properties.slice(0, -1)},"${mutation === "escaped reference_id" ? "reference_\\u0069d" : "reference_id"}":"source-reference"}`);
  assert.notEqual(malformed, original); replacePrivate(fixture, created, malformed);
  assert.equal(fixture.sqlite.prepare("SELECT json_extract(?,'$.properties.reference_id') AS value").get(malformed).value, "scratch-reference");
  assert.equal(JSON.parse(malformed).properties.reference_id, "source-reference");
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
  assert.equal(cursor(fixture), initialCursor);
});

test("duplicate public metadata is refused even when its repeated values are identical", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); await outputTail(fixture);
  const event = makeEvent(`creative:${targetOwner}`, currentHead(fixture) + 1, `user:${targetOwner}`, "server:output-requirements", "malformed-public-fixture", "BlockPropertyEdited", { project_id: "target-project", document_id: "target-document", block_id: "new-output", property_path: "text", new_value: "Different wording" });
  const bindings = eventWriteBindings(event); bindings[12] = duplicateRoot(bindings[12], "block_id", "new-output");
  fixture.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${bindings.map(() => "?").join(",")})`).run(...bindings);
  await synchronizeTarget(fixture);
  const raw = fixture.sqlite.prepare("SELECT payload FROM events WHERE event_id=?").get(event.eventId).payload;
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM json_each(?) WHERE key='block_id'").get(raw).n, 2, "malformed retained data is not silently canonicalized by the fixture");
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("uninterpreted nested editorial content is not recursively treated as an identity object", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const event = await outputTail(fixture);
  const original = storedPrivate(fixture, event), parsed = JSON.parse(original);
  parsed.properties = { reference_id: "unrelated-provenance", editorial: { source_block_id: "source-block", note: "first" } };
  const withEditorial = JSON.stringify(parsed).replace('"note":"first"', '"note":"first","note":"second"');
  replacePrivate(fixture, event, withEditorial);
  assert.equal(await check(fixture, await capture(fixture)), true);
});

test("identity uniqueness stays within actual D1 SQLite limits for a large retained B body and rejects a later duplicate", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const text = `OTHER_PROJECT_LARGE_PRIVATE_${"x".repeat(1_850_000)}`;
  const created = appendTarget(fixture, "BlockCreated", { block_id: "large-scratch", type: "direction", scope: "document", properties: { text, provenance: { source_block_id: "source-block" } } });
  await synchronizeTarget(fixture); fixture.transport.d1 = 0; fixture.statements.length = 0;
  const assertions = await capture(fixture);
  assert.equal(fixture.transport.d1, 2, "identity checks stay inside the existing two capture batches");
  assert.equal(JSON.stringify(assertions).includes("OTHER_PROJECT_LARGE_PRIVATE_"), false, "other-project prose never enters the retained proof binding");
  await strictIdentityReplay(t, fixture, assertions, true);
  replacePrivate(fixture, created, duplicateRoot(storedPrivate(fixture, created), "block_id", "source-block"));
  await strictIdentityReplay(t, fixture, assertions, false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

for (const mutation of ["missing scope", "foreign scope", "private erase", "private owner", "private project", "unknown event", "origin block", "origin reference", "origin relation endpoint", "unscoped known type"]) test(`a ${mutation} cannot be hidden in a purportedly unrelated owner tail`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const event = await outputTail(fixture), initialCursor = cursor(fixture);
  if (mutation === "missing scope") fixture.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(event.eventId);
  else if (mutation === "foreign scope") fixture.sqlite.prepare("UPDATE project_event_scopes SET organization_id='foreign' WHERE event_id=?").run(event.eventId);
  else if (mutation === "private erase") fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.eventId);
  else if (mutation === "private owner") fixture.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id=?").run(event.eventId);
  else if (mutation === "private project") fixture.sqlite.prepare("UPDATE event_private_payloads SET project_id='source-project' WHERE private_event_id=?").run(event.eventId);
  else if (mutation === "unknown event") appendTarget(fixture, "UnknownLaterSourceMeaning");
  else if (mutation === "unscoped known type") appendTarget(fixture, "OutputPlanConfirmed");
  else {
    const payload = mutation === "origin block" ? { block_id: "source-block", property_path: "text", new_value: "Foreign write" }
      : mutation === "origin reference" ? { reference_id: "source-reference", rights_class: "owned_or_licensed" }
        : { relation_id: "foreign-relation", from_block_id: "source-block", to_block_id: "new-output", kind: "visual_evidence" };
    const forged = appendTarget(fixture, mutation === "origin block" ? "BlockPropertyEdited" : mutation === "origin reference" ? "RightsAsserted" : "BlockRelationAdded", payload);
    // Deliberately malformed custody from an older implementation cannot make
    // a B project_id sufficient evidence that this event has no effects on A.
    fixture.insert("project_event_scopes", { event_id: forged.eventId, project_access_id: "target-access", organization_id: org, project_id: "target-project", owner_user_id: targetOwner, source_stream_id: forged.streamId, source_sequence: forged.sequence, project_sequence: 9000, actor_user_id: targetOwner, created_at: new Date().toISOString() });
  }
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
  assert.equal(cursor(fixture), initialCursor);
});

test("pinned lower and upper tail bounds survive a normal cursor advance but cannot hide later erasure", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const event = await outputTail(fixture), initialCursor = cursor(fixture), assertions = await capture(fixture);
  fixture.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=? WHERE project_access_id='source-access'").run(currentHead(fixture));
  assert.equal(await check(fixture, assertions), true, "only the cursor changes; the same exact prefix and old tail remain guarded");
  fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.eventId);
  assert.equal(await check(fixture, assertions), false, "advancing the cursor cannot remove this row from the captured interval");
  fixture.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=? WHERE project_access_id='source-access'").run(initialCursor - 1);
  assert.equal(await check(fixture, assertions), false, "cursor regression is also unavailable");
});

for (const race of ["origin rights", "origin private erase", "origin quarantine", "owner membership revoked"]) test(`${race} still invalidates a captured same-owner tail proof`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); await outputTail(fixture);
  const assertions = await capture(fixture);
  if (race === "origin rights") fixture.append(targetOwner, "RightsAsserted", { project_id: "source-project", document_id: "source-document", reference_id: "source-reference", rights_class: "revoked" });
  else if (race === "origin private erase") fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(fixture.ingestEvent.eventId);
  else if (race === "origin quarantine") fixture.sqlite.exec("UPDATE project_migration_states SET status='disabled' WHERE project_access_id='source-access'");
  else fixture.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE user_id=?").run(new Date().toISOString(), targetOwner);
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => fixture.env.DB.batch([...fixture.guards(assertions), fixture.env.DB.prepare("UPDATE organizations SET name='must roll back' WHERE organization_id=?").bind(org)]), /CHECK constraint/u);
  assert.notEqual(fixture.sqlite.prepare("SELECT name FROM organizations WHERE organization_id=?").get(org).name, "must roll back");
});

async function nativeFixture(fixture, options = {}) {
  const now = new Date().toISOString(), future = new Date(Date.now() + 60_000).toISOString(), hash = "d".repeat(64);
  const confirmed = appendTarget(fixture, "OutputPlanConfirmed");
  const preflight = appendTarget(fixture, "OutputPlanPreflighted");
  const authorized = appendTarget(fixture, "OutputExecutionAuthorized");
  const queue = appendTarget(fixture, "ProjectDocumentJobQueued", { job_id: "tail-job", kind: "render_document", organization_id: org, project_access_id: "target-access", history_owner_user_id: targetOwner, actor_user_id: targetOwner, output_slot_id: "tail-slot", output_grant_id: "tail-grant", ...options.queuePayload }, { ...options.queueEvent, ...(options.compensatingQueue ? { compensatesEventId: confirmed.eventId } : {}) });
  fixture.insert("output_plan_revisions", { scope_key: "tail-scope", scope_kind: "project", owner_user_id: targetOwner, project_id: "target-project", document_id: "target-document", organization_id: org, project_access_id: "target-access", plan_revision_id: "tail-plan", plan_id: "target-document", revision: 1, confirmed_event_id: confirmed.eventId, requirements_digest: hash, source_digest: hash, resolver_version: "fixture", source_head: confirmed.sequence, target_count: 1, created_at: now });
  fixture.insert("output_plan_targets", { scope_key: "tail-scope", plan_revision_id: "tail-plan", target_id: "tail-target", target_contract_digest: hash, media_kind: "slides", required: 1, selected: 1, ordinal: 0 });
  fixture.insert("output_preflights", { scope_key: "tail-scope", preflight_id: "tail-preflight", plan_revision_id: "tail-plan", actor_user_id: targetOwner, terms_digest: hash, event_id: preflight.eventId, expires_at: future, created_at: now });
  fixture.insert("output_execution_grants", { scope_key: "tail-scope", grant_id: "tail-grant", plan_revision_id: "tail-plan", actor_user_id: targetOwner, payer_user_id: targetOwner, context_id: "tail-context", preflight_id: "tail-preflight", authorization_event_id: authorized.eventId, maximum_microusd: 1000, maximum_calls: 1, status: "authorized", expires_at: future, created_at: now });
  fixture.insert("output_operation_slots", { scope_key: "tail-scope", slot_id: "tail-slot", grant_id: "tail-grant", plan_revision_id: "tail-plan", target_id: "tail-target", target_contract_digest: hash, source_digest: hash, provider: "fixture", model: "fixture", route_digest: hash, job_id: "tail-job", cost_reservation_id: "tail-cost", token_reservation_id: "tail-tokens", maximum_microusd: 1000, maximum_calls: 1, maximum_tokens: 100, status: "running", created_at: now, updated_at: now });
  fixture.insert("document_jobs", { job_id: "tail-job", owner_id: targetOwner, stream_id: `creative:${targetOwner}`, document_id: "target-document", kind: "render_document", status: "running", source_surface: "outputs", correlation_id: "tail-correlation", requested_sequence: queue.sequence, request_json: "{}", attempt_count: 1, requested_at: now, expires_at: future, updated_at: now });
  fixture.insert("project_resource_scopes", { project_access_id: "target-access", resource_kind: "job", resource_id: "tail-job", organization_id: org, project_id: "target-project", owner_user_id: targetOwner, visibility: "actor_private", source_event_id: queue.eventId, actor_user_id: targetOwner, created_at: now });
  fixture.insert("project_event_scopes", { event_id: queue.eventId, project_access_id: "target-access", organization_id: org, project_id: "target-project", owner_user_id: targetOwner, source_stream_id: queue.streamId, source_sequence: queue.sequence, project_sequence: 9000, actor_user_id: targetOwner, created_at: now });
  await synchronizeTarget(fixture);
  const append = (type = "GenerationUsageRecorded", overrides = {}, payload = {}) => fixture.append(targetOwner, type, payload, { actor: "worker:policy", clientId: "server:document-job:render_document", correlationId: "tail-correlation", ...overrides });
  return { queue, append, scope: { kind: "project", key: "tail-scope", ownerUserId: targetOwner, actorUserId: targetOwner, projectId: "target-project", documentId: "target-document", organizationId: org, projectAccessId: "target-access", contextId: "tail-context" }, sourceDigest: hash };
}

test("unscoped native accounting needs exact retained Output job custody, and mutable job status is not frozen", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const native = await nativeFixture(fixture), initialCursor = cursor(fixture);
  native.append();
  const assertions = await capture(fixture);
  assert.equal(await check(fixture, assertions), true);
  fixture.sqlite.exec("UPDATE document_jobs SET status='completed'; UPDATE output_operation_slots SET status='succeeded'; UPDATE output_execution_grants SET status='completed'");
  assert.equal(await check(fixture, assertions), true);
  assert.equal(cursor(fixture), initialCursor);
});

test("a native job cannot rebind its recorded admission sequence while reusing a captured queue identity", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const native = await nativeFixture(fixture);
  native.append(); const assertions = await capture(fixture); assert.equal(await check(fixture, assertions), true);
  fixture.sqlite.exec("UPDATE document_jobs SET requested_sequence=requested_sequence+1");
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("a future canonical queue cannot retroactively supply custody for an earlier native operation", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const native = await nativeFixture(fixture);
  const receipt = native.append();
  const future = appendTarget(fixture, "ProjectDocumentJobQueued", native.queue.payload);
  assert.ok(future.sequence > receipt.sequence);
  fixture.sqlite.prepare("UPDATE document_jobs SET requested_sequence=? WHERE job_id='tail-job'").run(future.sequence);
  fixture.sqlite.prepare("UPDATE project_resource_scopes SET source_event_id=? WHERE resource_kind='job' AND resource_id='tail-job'").run(future.eventId);
  const projectSequence = fixture.sqlite.prepare("SELECT COALESCE(MAX(project_sequence),0)+1 AS next FROM project_event_scopes WHERE project_access_id='target-access'").get().next;
  fixture.insert("project_event_scopes", { event_id: future.eventId, project_access_id: "target-access", organization_id: org, project_id: "target-project", owner_user_id: targetOwner, source_stream_id: future.streamId, source_sequence: future.sequence, project_sequence: projectSequence, actor_user_id: targetOwner, created_at: new Date().toISOString() });
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("a failed native render keeps source currency through its planned artifact without pretending that a file was published", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const native = await nativeFixture(fixture);
  native.append("DocumentRenderRequested", { actor: `user:${targetOwner}` }, { project_id: "target-project", document_id: "target-document", artifact_id: "planned-artifact", artifact_kind: "slides" });
  native.append("DocumentRenderFailed", { actor: "worker:renderer" }, { project_id: "target-project", document_id: "target-document", artifact_id: "planned-artifact", artifact_kind: "slides" });
  native.append("GenerationUsageRecorded", {}, { document_id: "target-document", artifact_id: "planned-artifact", artifact_kind: "slides", cost_microusd: 1200 });
  native.append("BudgetReleased", {}, { artifact_id: "planned-artifact", artifact_kind: "slides", used_tokens: 200 });
  await synchronizeTarget(fixture);
  fixture.sqlite.exec("UPDATE document_jobs SET status='failed'; UPDATE output_operation_slots SET status='failed'");
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='artifact' AND resource_id='planned-artifact'").get().n, 0);
  const assertions = await capture(fixture); assert.equal(await check(fixture, assertions), true);
  native.append("DocumentRenderCompleted", { actor: "worker:renderer" }, { project_id: "target-project", document_id: "target-document", artifact_id: "planned-artifact", artifact_kind: "slides" });
  // Deliberately omit the native publication sidecars: a completion cannot use
  // the planned-id exception reserved for a request/failure without a file.
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("an unpublished usage reference requires its retained matching native request even before the origin cursor", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const native = await nativeFixture(fixture);
  const requested = native.append("DocumentRenderRequested", { actor: `user:${targetOwner}` }, { project_id: "target-project", document_id: "target-document", artifact_id: "planned-artifact", artifact_kind: "slides" });
  await synchronizeProjectScope(fixture.env, { ...targetScope, projectAccessId: "source-access", projectId: "source-project" });
  const initialCursor = cursor(fixture); assert.ok(requested.sequence <= initialCursor);
  native.append("GenerationUsageRecorded", {}, { document_id: "target-document", artifact_id: "planned-artifact", artifact_kind: "slides", cost_microusd: 1200 });
  const assertions = await capture(fixture); assert.equal(await check(fixture, assertions), true);
  fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(requested.eventId);
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
  assert.equal(cursor(fixture), initialCursor);
});

test("a historical planned request cannot hide a second artifact identity in its private body", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const native = await nativeFixture(fixture);
  const requested = native.append("DocumentRenderRequested", { actor: `user:${targetOwner}` }, { project_id: "target-project", document_id: "target-document", artifact_id: "planned-artifact", artifact_kind: "slides" });
  await synchronizeOriginFixture(fixture);
  native.append("GenerationUsageRecorded", {}, { artifact_id: "planned-artifact", artifact_kind: "slides", document_id: "target-document" });
  const assertions = await capture(fixture); assert.equal(await check(fixture, assertions), true);
  replacePrivate(fixture, requested, duplicateRoot(storedPrivate(fixture, requested), "artifact_id", "another-artifact"));
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("a current native private envelope must be an object, even when all its public identity fields are absent", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const native = await nativeFixture(fixture);
  const receipt = native.append(); const assertions = await capture(fixture);
  replacePrivate(fixture, receipt, "[]");
  assert.equal(await check(fixture, assertions), false);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("a paid receipt cannot invent an unpublished artifact without its exact native request", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close()); const native = await nativeFixture(fixture);
  native.append("GenerationUsageRecorded", {}, { document_id: "target-document", artifact_id: "invented-artifact", artifact_kind: "slides", cost_microusd: 1200 });
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

for (const mutation of ["none", "schema", "compensation", "client", "public document", "extra private key", "duplicate private key"]) test(`a queue before the origin cursor still proves its canonical native identity: ${mutation}`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const native = await nativeFixture(fixture, {
    queueEvent: mutation === "schema" ? { schemaVersion: 2 } : mutation === "client" ? { clientId: "generic-client" } : {},
    queuePayload: mutation === "public document" ? { document_id: "source-document" } : {},
    compensatingQueue: mutation === "compensation",
  });
  if (mutation === "public document") fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.document_id','target-document'),document_id='target-document' WHERE private_event_id=?").run(native.queue.eventId);
  if (mutation === "extra private key") fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.unknown_effect','hidden') WHERE private_event_id=?").run(native.queue.eventId);
  if (mutation === "duplicate private key") fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json=substr(private_json,1,length(private_json)-1)||',\"document_id\":\"target-document\"}' WHERE private_event_id=?").run(native.queue.eventId);
  // This is fixture setup for an already historical queue, not a helper write.
  await synchronizeProjectScope(fixture.env, { ...targetScope, projectAccessId: "source-access", projectId: "source-project" });
  const initialCursor = cursor(fixture); assert.ok(native.queue.sequence <= initialCursor);
  native.append();
  if (mutation === "none") assert.equal(await check(fixture, await capture(fixture)), true);
  else await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
  assert.equal(cursor(fixture), initialCursor);
});

for (const mutation of ["wrong actor", "wrong client", "wrong correlation", "wrong plan document", "wrong source surface", "missing queue body", "changed queue slot"]) test(`native metadata with ${mutation} is unavailable rather than an unrelated-tail exemption`, async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const native = await nativeFixture(fixture);
  native.append("GenerationUsageRecorded", mutation === "wrong actor" ? { actor: `user:${targetOwner}` } : mutation === "wrong client" ? { clientId: "generic-client" } : mutation === "wrong correlation" ? { correlationId: "unknown" } : {});
  if (mutation === "wrong plan document") fixture.sqlite.exec("UPDATE output_plan_revisions SET document_id='source-document'");
  else if (mutation === "wrong source surface") fixture.sqlite.exec("UPDATE document_jobs SET source_surface='generic-studio'");
  else if (mutation === "missing queue body") fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(native.queue.eventId);
  else if (mutation === "changed queue slot") fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.output_slot_id','other-slot') WHERE private_event_id=?").run(native.queue.eventId);
  await assert.rejects(() => capture(fixture), error => error.code === "output_source_projection_stale");
});

test("execution may replace its matching exact head, but every old prefix/tail and foreign head stays guarded", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const native = await nativeFixture(fixture), assertions = await capture(fixture), head = currentHead(fixture);
  const epoch = outputSourceEpochAssertion(native.scope, { head, sourceDigest: native.sourceDigest });
  const executing = assertions.map(assertion => assertion.sql === headSql && assertion.bindings[0] === `creative:${targetOwner}` && assertion.bindings[1] === head ? epoch : assertion);
  native.append();
  assert.equal(await check(fixture, assertions), false, "ordinary reads still require the exact owner head");
  assert.equal(await check(fixture, executing), true, "only the already validated native source epoch admits later work");
  fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(native.queue.eventId);
  assert.equal(await check(fixture, executing), false, "epoch replacement never drops historical tail custody");
});

test("an unknown later native event cannot be hidden behind an otherwise matching Output correlation", async t => {
  const fixture = await sameOwner(); t.after(() => fixture.sqlite.close());
  const native = await nativeFixture(fixture), assertions = await capture(fixture), head = currentHead(fixture);
  const epoch = outputSourceEpochAssertion(native.scope, { head, sourceDigest: native.sourceDigest });
  const executing = assertions.map(assertion => assertion.sql === headSql ? epoch : assertion);
  native.append("UnknownNativeMutation");
  assert.equal(await check(fixture, executing), false);
});
