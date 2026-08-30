import test from "node:test";
import assert from "node:assert/strict";
import { backup } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  database, captureOutputGovernanceAssertions, governedPackageSourceRightsCurrent,
  synchronizeProjectScope, org, sourceOwner, targetOwner, sha,
} from "./output-governance-budget-fixture.mjs";

globalThis.fetch = async () => { throw new Error("network_sentinel"); };
const bounded = (fixture, blocks = [fixture.block], maximumCaptureBatches = 2) =>
  captureOutputGovernanceAssertions(fixture.env, org, blocks, { deferValidation: true, maximumCaptureBatches });
const currentStatement = (fixture, assertion) => fixture.env.DB.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).bind(...(assertion.bindings ?? []));
async function finalRead(fixture, assertions) {
  // The API must do this check in its existing final source/head read, not turn
  // the deferred capture into an unvalidated boolean or a persistent witness.
  const rows = await fixture.env.DB.batch([
    ...assertions.map(assertion => currentStatement(fixture, assertion)),
    fixture.env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(`creative:${targetOwner}`),
  ]);
  return rows.slice(0, -1).every(result => result.success && result.results[0]?.current === 1);
}

async function addPackage(fixture, { id, snapshot = fixture.snapshot, targetId = `${id}-target`, targetPrefix = "target" }) {
  const now = new Date().toISOString(), copy = structuredClone(snapshot), versionId = `${id}-version`, bindingId = `${id}-binding`;
  const json = JSON.stringify(copy);
  fixture.insert("organization_context_packages", { package_id: id, organization_id: org, name: id, status: "active", created_by_user_id: targetOwner, created_at: now, updated_at: now });
  fixture.insert("organization_context_package_versions", { version_id: versionId, package_id: id, organization_id: org, version: 1, content_sha256: await sha(json), source_project_access_id: copy.sourceProjectAccessId, source_document_id: copy.sourceDocumentId, status: "draft", created_by_user_id: targetOwner, approved_by_user_id: targetOwner, published_at: now, created_at: now });
  fixture.insert("organization_context_package_contents", { version_id: versionId, organization_id: org, content_json: json, created_at: now });
  for (const [position, member] of copy.blocks.entries()) fixture.insert("organization_context_package_sources", { version_id: versionId, organization_id: org, source_project_access_id: copy.sourceProjectAccessId, source_block_id: member.sourceBlockId, source_kind: member.type, content_sha256: member.contentSha256, rights_expires_at: member.rightsExpiresAt, position });
  fixture.sqlite.prepare("UPDATE organization_context_package_versions SET status='published' WHERE version_id=?").run(versionId);
  fixture.insert("project_context_package_bindings", { binding_id: bindingId, organization_id: org, project_access_id: `${targetPrefix}-access`, project_id: `${targetPrefix}-project`, document_id: `${targetPrefix}-document`, package_id: id, version_id: versionId, status: "active", created_by_user_id: targetOwner, created_at: now, updated_at: now });
  assert.equal(copy.blocks.length, 1, "the fixture attaches one full package member");
  fixture.insert("project_context_package_members", { binding_id: bindingId, organization_id: org, source_block_id: copy.blocks[0].sourceBlockId, target_block_id: targetId, content_sha256: copy.blocks[0].contentSha256 });
  return { id: targetId, projectId: `${targetPrefix}-project`, documentId: `${targetPrefix}-document`, properties: {
    organization_context_package_id: id, organization_context_package_version_id: versionId,
    organization_context_package_binding_id: bindingId, organization_context_source_block_id: copy.blocks[0].sourceBlockId,
  } };
}

async function attachNestedBinding(fixture) {
  const snapshot = structuredClone(fixture.snapshot), properties = { text: "An institutionally retained decision" };
  snapshot.blocks = [{ ...snapshot.blocks[0], type: "direction", properties, contentSha256: await sha(JSON.stringify(properties)), rightsExpiresAt: null }];
  delete snapshot.blocks[0].source;
  const nested = await addPackage(fixture, { id: "inner", snapshot, targetId: "source-block", targetPrefix: "source" });
  for (const [property_path, new_value] of Object.entries(nested.properties)) fixture.append(sourceOwner, "BlockPropertyEdited", { project_id: "source-project", document_id: "source-document", block_id: "source-block", property_path, new_value });
  await fixture.synchronize();
}

for (const kind of ["plain", "institutional", "licensed"]) test(`${kind} capture has an explicit, measured batch cost with and without deferred validation`, async t => {
  const fixture = await database({ licensed: kind === "licensed" });
  t.after(() => fixture.sqlite.close());
  if (kind === "plain") {
    fixture.sqlite.exec("DELETE FROM project_context_package_members");
    fixture.block.properties = { text: "An ordinary authored source" };
  }
  fixture.transport.d1 = 0;
  const assertions = await bounded(fixture);
  const captureCalls = fixture.transport.d1;
  assert.equal(captureCalls, kind === "licensed" ? 2 : 1);
  assert.equal(await finalRead(fixture, assertions), true);
  assert.equal(fixture.transport.d1, captureCalls + 1, "all assertions share the caller's existing head read batch");
  await fixture.decisions(assertions);
  fixture.transport.d1 = 0;
  await fixture.capture();
  assert.equal(fixture.transport.d1, kind === "licensed" ? 3 : 2, "default callers still receive a freshly checked proof");
});

test("all direct package bindings and repeated licensed origins share the same two capture batches", async t => {
  const fixture = await database(); t.after(() => fixture.sqlite.close());
  const blocks = [fixture.block];
  for (let index = 0; index < 7; index++) blocks.push(await addPackage(fixture, { id: `repeated-${index}` }));
  fixture.transport.d1 = 0;
  const assertions = await bounded(fixture, blocks);
  assert.equal(fixture.transport.d1, 2, "the bound is on capture batches, not the number of packages");
  assert.equal(await finalRead(fixture, assertions), true);
  const bindingCapture = fixture.queries.filter(sql => sql.includes("AS proof_json") && sql.includes("FROM project_context_package_bindings") && sql.includes("binding.update_mode"));
  assert.equal(bindingCapture.length, 1);
  await fixture.decisions(assertions);
});

test("independent licensed owner streams are captured together without losing their private evidence", async t => {
  const fixture = await database(); t.after(() => fixture.sqlite.close());
  const now = new Date().toISOString(), owner = "second-source-owner";
  fixture.insert("organization_projects", { project_access_id: "second-source-access", project_id: "second-source-project", organization_id: org, owner_user_id: owner, status: "active", created_at: now, updated_at: now });
  fixture.insert("project_migration_states", { project_access_id: "second-source-access", organization_id: org, owner_user_id: owner, status: "active", last_owner_sequence: 0, updated_at: now });
  fixture.insert("organization_memberships", { membership_id: "second-source-member", organization_id: org, user_id: owner, role: "member", status: "active", invited_by_user_id: targetOwner, accepted_at: now, created_at: now, updated_at: now });
  const snapshot = structuredClone(fixture.snapshot);
  snapshot.sourceProjectAccessId = "second-source-access"; snapshot.sourceDocumentId = "second-source-document";
  snapshot.blocks[0].sourceBlockId = "second-source-block";
  snapshot.blocks[0].properties.reference_id = "second-reference";
  snapshot.blocks[0].contentSha256 = await sha(JSON.stringify(snapshot.blocks[0].properties));
  fixture.append(owner, "ProjectCreated", { project_id: "second-source-project", title: "Second origin" });
  fixture.append(owner, "DocumentCreated", { project_id: "second-source-project", document_id: "second-source-document", title: "Second document" });
  fixture.append(owner, "BlockCreated", { project_id: "second-source-project", document_id: "second-source-document", block_id: "second-source-block", type: "reference", properties: snapshot.blocks[0].properties });
  const ingest = fixture.append(owner, "ReferenceIngested", { project_id: "second-source-project", document_id: "second-source-document", reference_id: "second-reference", source_ref: "/api/media/original-file.png", content_hash: snapshot.blocks[0].source.contentSha256, rights_class: "owned_or_licensed" });
  await synchronizeProjectScope(fixture.env, { organizationId: org, projectAccessId: "second-source-access", projectId: "second-source-project", ownerUserId: owner });
  const second = await addPackage(fixture, { id: "second-package", snapshot });
  fixture.transport.d1 = 0;
  const assertions = await bounded(fixture, [fixture.block, second]);
  assert.equal(fixture.transport.d1, 2);
  assert.equal(await finalRead(fixture, assertions), true);
  fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(ingest.eventId);
  assert.equal(await finalRead(fixture, assertions), false);
  await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
});

test("a deeper governed dependency stops before a third capture batch and leaves the full assignment untouched", async t => {
  const fixture = await database(); t.after(() => fixture.sqlite.close());
  await attachNestedBinding(fixture);
  const original = structuredClone(fixture.block);
  const before = fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  fixture.transport.d1 = 0;
  await assert.rejects(() => bounded(fixture), error => error.code === "output_source_governance_capacity_exceeded");
  assert.equal(fixture.transport.d1, 2);
  assert.deepEqual(fixture.block, original);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, before);
  fixture.transport.d1 = 0;
  const assertions = await captureOutputGovernanceAssertions(fixture.env, org, [fixture.block]);
  assert.equal(fixture.transport.d1, 4, "default capture still supports the same valid nested chain");
  await fixture.decisions(assertions);
});

test("capture capacity is enforced before the blocked database call, including invalid limits", async t => {
  const fixture = await database(); t.after(() => fixture.sqlite.close());
  fixture.transport.d1 = 0;
  await assert.rejects(() => bounded(fixture, [fixture.block], 1), error => error.code === "output_source_governance_capacity_exceeded");
  assert.equal(fixture.transport.d1, 1);
  for (const maximum of [0, -1, 1.5, 34, Infinity]) {
    fixture.transport.d1 = 0;
    await assert.rejects(() => bounded(fixture, [fixture.block], maximum), error => error.code === "output_source_governance_capacity_exceeded");
    assert.equal(fixture.transport.d1, 0);
  }
});

for (const race of ["private body", "origin quarantine", "new assignment", "new package member", "package withdrawal"]) test(`deferred proof still rejects a ${race} race in the caller's final read and decision transaction`, async t => {
  const fixture = await database(); t.after(() => fixture.sqlite.close());
  const assertions = await bounded(fixture);
  if (race === "private body") fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(fixture.ingestEvent.eventId);
  else if (race === "origin quarantine") fixture.sqlite.exec("UPDATE project_migration_states SET status='disabled' WHERE project_access_id='source-access'");
  else if (race === "new assignment") fixture.insert("project_context_package_members", { binding_id: "other-binding", organization_id: org, source_block_id: "other-source", target_block_id: "target-block", content_sha256: fixture.blockHash });
  else if (race === "new package member") fixture.insert("project_context_package_members", { binding_id: "binding", organization_id: org, source_block_id: "other-source", target_block_id: "other-target", content_sha256: fixture.blockHash });
  else fixture.sqlite.exec("UPDATE organization_context_packages SET status='withdrawn' WHERE package_id='package'");
  assert.equal(await finalRead(fixture, assertions), false);
  await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='OutputTargetAccepted'").get().n, 0);
});

test("SQL commit-time expiry remains part of a deferred proof", async t => {
  const fixture = await database({ expiresAt: new Date(Date.now() + 60_000).toISOString() }); t.after(() => fixture.sqlite.close());
  const assertions = await bounded(fixture);
  const expiry = assertions.find(assertion => assertion.sql.includes("strftime"));
  assert.ok(expiry);
  assert.equal(await finalRead(fixture, assertions), true);
  // Exercise the database clock predicate without replacing the current clock
  // or sleeping; existing regressions additionally wait through actual expiry.
  const elapsed = [...assertions.filter(assertion => assertion !== expiry), { ...expiry, bindings: ["2000-01-01T00:00:00.000Z"] }];
  assert.equal(await finalRead(fixture, elapsed), false);
  await assert.rejects(() => fixture.decisions(elapsed), /CHECK constraint/u);
});

test("institutional snapshots do not gain a new live-origin dependency when batched", async t => {
  const fixture = await database({ licensed: false }); t.after(() => fixture.sqlite.close());
  fixture.sqlite.exec("DELETE FROM organization_projects WHERE project_access_id='source-access'; DELETE FROM project_migration_states WHERE project_access_id='source-access'; DELETE FROM organization_memberships WHERE user_id='original-owner'; DELETE FROM event_private_payloads WHERE owner_id='original-owner'");
  fixture.transport.d1 = 0; fixture.queries.length = 0;
  const assertions = await bounded(fixture);
  assert.equal(fixture.transport.d1, 1);
  assert.equal(fixture.queries.some(sql => sql.includes("migration.last_owner_sequence") || sql.includes("FROM project_event_scopes scope JOIN events")), false);
  await fixture.decisions(assertions);
});

for (const change of ["current", "renewed", "revoked", "withdrawn", "erased", "disabled", "expired member", "repointed bytes"]) test(`the complete proof dominates the old rights precheck for ${change} sources`, async t => {
  const fixture = await database(); t.after(() => fixture.sqlite.close());
  if (change === "renewed" || change === "revoked") {
    fixture.append(sourceOwner, "RightsAsserted", { project_id: "source-project", document_id: "source-document", reference_id: "source-reference", rights_class: change === "renewed" ? "owned_or_licensed" : "revoked" });
    await fixture.synchronize();
  } else if (change === "withdrawn") fixture.sqlite.exec("UPDATE organization_context_packages SET status='withdrawn' WHERE package_id='package'");
  else if (change === "erased") fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(fixture.ingestEvent.eventId);
  else if (change === "disabled") fixture.sqlite.exec("UPDATE project_migration_states SET status='disabled' WHERE project_access_id='source-access'");
  else if (change === "expired member") {
    const id = await fixture.version("reference", { ...fixture.snapshot.blocks[0].properties, license_expires_at: "2000-01-01T00:00:00.000Z" });
    fixture.sqlite.prepare("UPDATE project_context_package_bindings SET version_id=? WHERE binding_id='binding'").run(id);
    fixture.block.properties.organization_context_package_version_id = id;
    fixture.sqlite.prepare("UPDATE project_context_package_members SET content_sha256=(SELECT content_sha256 FROM organization_context_package_sources WHERE version_id=?) WHERE binding_id='binding'").run(id);
  } else if (change === "repointed bytes") {
    fixture.append(sourceOwner, "ReferenceIngested", { project_id: "source-project", document_id: "source-document", reference_id: "replacement", source_ref: "/api/media/replacement.png", content_hash: "b".repeat(64), rights_class: "owned_or_licensed" });
    for (const [property_path, new_value] of Object.entries({ reference_id: "replacement", source_content_hash: "b".repeat(64), media_url: "/api/media/replacement.png" })) fixture.append(sourceOwner, "BlockPropertyEdited", { project_id: "source-project", document_id: "source-document", block_id: "source-block", property_path, new_value });
    await fixture.synchronize();
  }
  const oldCurrent = await governedPackageSourceRightsCurrent(fixture.env, org, [fixture.block]);
  if (["current", "renewed"].includes(change)) {
    assert.equal(oldCurrent, true);
    assert.equal(await finalRead(fixture, await bounded(fixture)), true);
  } else {
    assert.equal(oldCurrent, change === "repointed bytes", "the rights precheck rejects erased private evidence; the complete proof additionally binds frozen source bytes");
    await assert.rejects(() => bounded(fixture));
  }
});

const pythonConformance = String.raw`
import json,sqlite3,sys
request=json.load(sys.stdin)
db=sqlite3.connect(request['database'])
db.setlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32)
db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100)
db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000)
db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH,2000000)
assert db.getlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG)==32
try:
    db.execute("SELECT json_object("+','.join(["'field'","NULL"]*17)+")")
except sqlite3.OperationalError as error:
    assert 'arguments' in str(error)
else:
    raise AssertionError('negative arity control unexpectedly succeeded')
for statement in request['captures']:
    assert len(statement['sql'].encode('utf-8'))<=100000
    assert len(statement['bindings'])<=100
    rows=db.execute(statement['sql'],statement['bindings']).fetchall()
    for value, in rows:
        if isinstance(value,str):
            for record in json.loads(value):
                if 'event_id' in record:
                    assert 'private_document_id' in record and 'private_redacted_at' in record
                    assert record['private_redacted_at'] is None
checks=[db.execute('SELECT CASE WHEN ('+item['sql']+') THEN 1 ELSE 0 END',item.get('bindings',[])).fetchone()[0] for item in request['assertions']]
assert all(checks),checks
db.execute("UPDATE organization_context_packages SET status='withdrawn' WHERE package_id='package'")
checks=[db.execute('SELECT CASE WHEN ('+item['sql']+') THEN 1 ELSE 0 END',item.get('bindings',[])).fetchone()[0] for item in request['assertions']]
assert not all(checks),'same retained proof must reject package withdrawal'
print(json.dumps({'sqlite':sqlite3.sqlite_version,'limit':32,'statements':len(request['captures'])+len(request['assertions'])*2,'withdrawalRejected':True}))
`;

for (const licensed of [false, true]) test(`actual SQLite at 32 function arguments accepts ${licensed ? "licensed" : "institutional"} proof SQL, preserves nulls and rejects withdrawal`, async t => {
  const fixture = await database({ licensed }); t.after(() => fixture.sqlite.close());
  fixture.statements.length = 0;
  const assertions = await bounded(fixture);
  const captures = fixture.statements.filter(statement => statement.sql.includes("AS proof_json"));
  const directory = mkdtempSync(join(tmpdir(), "forma-governance-d1-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "fixture.sqlite");
  await backup(fixture.sqlite, path);
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", pythonConformance], { input: JSON.stringify({ database: path, captures, assertions }), encoding: "utf8", maxBuffer: 1_000_000, timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.limit, 32); assert.equal(receipt.withdrawalRejected, true);
  t.diagnostic(JSON.stringify(receipt));
});
