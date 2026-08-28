import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";

// Install the same temporary source resolver as the other Output HTTP tests
// before loading the worker's extensionless TypeScript dependency graph.
const sourceResolution = registerOutputSourceImports();
const [
  { captureOutputGovernanceAssertions },
  { ensureSchema, EVENT_WRITE_COLUMNS, eventWriteBindings, insertEvent, makeEvent },
  { ensureOutputRequirementsSchema, outputAssertionStatements },
  { synchronizeProjectScope },
  { handleContextPackages },
  { parseOutputRequirement },
  { handleEventPrivacy },
  { POLICY_VERSION },
] = await Promise.all([
  import("../worker/output-requirement-governance-assertions.ts"),
  import("../worker/runtime.ts"),
  import("../worker/output-requirements-ledger.ts"),
  import("../worker/project-access.ts"),
  import("../worker/context-packages-api.ts"),
  import("../src/model/output-requirements.ts"),
  import("../worker/privacy-api.ts"),
  import("../worker/pilot-policy.ts"),
]).finally(() => sourceResolution.deregister());

globalThis.fetch = async () => { throw new Error("Network and providers are forbidden in governance tests"); };
const privateText = "Retained private source wording must never return through an operational receipt";
const org = "organization", sourceOwner = "original-owner", targetOwner = "document-owner";
const sha = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Real production DDL/triggers, real SQLite transactions. Only D1 transport is adapted. */
async function database({ licensed = true, expiresAt = null, synchronized = true, frozenAssetHash = licensed ? "a".repeat(64) : null, evidenceHash = null } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  let afterRead = null;
  const queries = [];
  const transport = { d1: 0, r2: 0 };
  class Statement {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { assert.ok(args.length <= 100, "D1 statement parameter ceiling"); return new Statement(this.sql, args); }
    execute(mode) {
      queries.push(this.sql);
      const prepared = sqlite.prepare(this.sql);
      if (mode === "first") { const result = prepared.get(...this.args) ?? null; afterRead?.(this.sql); return result; }
      if (mode === "all") { const results = prepared.all(...this.args); afterRead?.(this.sql); return { results, success: true, meta: { changes: 0 } }; }
      const result = prepared.run(...this.args); return { results: [], success: true, meta: { changes: Number(result.changes) } };
    }
    async first() { transport.d1++; return this.execute("first"); }
    async all() { transport.d1++; return this.execute("all"); }
    async run() { transport.d1++; return this.execute("run"); }
  }
  const env = { DB: {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      transport.d1++;
      sqlite.exec("BEGIN");
      try { const results = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/u.test(statement.sql) ? "all" : "run")); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } };
  await ensureSchema(env); await ensureOutputRequirementsSchema(env);
  const now = new Date().toISOString();
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  insert("organizations", { organization_id: org, name: "Test organization", owner_user_id: targetOwner, status: "active", created_at: now, updated_at: now });
  for (const [prefix, owner] of [["source", sourceOwner], ["target", targetOwner]]) {
    insert("organization_projects", { project_access_id: `${prefix}-access`, project_id: `${prefix}-project`, organization_id: org, owner_user_id: owner, status: "active", created_at: now, updated_at: now });
    insert("project_migration_states", { project_access_id: `${prefix}-access`, organization_id: org, owner_user_id: owner, status: "active", last_owner_sequence: 0, updated_at: now });
    insert("organization_memberships", { membership_id: `${prefix}-member`, organization_id: org, user_id: owner, role: "member", status: "active", invited_by_user_id: targetOwner, accepted_at: now, created_at: now, updated_at: now, revoked_at: null });
  }
  const newEvent = (owner, type, payload) => makeEvent(`creative:${owner}`, Number(sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(`creative:${owner}`).head) + 1, `user:${owner}`, "fixture", "governance-fixture", type, payload);
  const append = (owner, type, payload) => {
    const event = newEvent(owner, type, payload);
    sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${eventWriteBindings(event).map(() => "?").join(",")})`).run(...eventWriteBindings(event));
    return event;
  };
  const sourceProperties = { text: privateText, ...(licensed ? { reference_id: "source-reference" } : {}), ...(expiresAt ? { license_expires_at: expiresAt } : {}),
    ...(frozenAssetHash ? { source_content_hash: frozenAssetHash, media_url: "/api/media/original-file.png" } : {}), ...(evidenceHash ? { source_evidence_hash: evidenceHash } : {}) };
  append(sourceOwner, "ProjectCreated", { project_id: "source-project", title: "Private origin" });
  const documentEvent = append(sourceOwner, "DocumentCreated", { project_id: "source-project", document_id: "source-document", title: "Private source document" });
  const blockEvent = append(sourceOwner, "BlockCreated", { project_id: "source-project", document_id: "source-document", block_id: "source-block", type: licensed ? "reference" : "direction", handle: "source/block", scope: "document", properties: sourceProperties });
  const ingestEvent = frozenAssetHash ? append(sourceOwner, "ReferenceIngested", { project_id: "source-project", document_id: "source-document", reference_id: "source-reference", source_ref: "/api/media/original-file.png", content_hash: frozenAssetHash, rights_class: "owned_or_licensed" }) : null;
  const rightsEvent = licensed ? append(sourceOwner, "RightsAsserted", { project_id: "source-project", document_id: "source-document", reference_id: "source-reference", rights_class: "owned_or_licensed", private_license_note: privateText }) : null;
  append(targetOwner, "ProjectCreated", { project_id: "target-project", title: "Target project" });
  append(targetOwner, "DocumentCreated", { project_id: "target-project", document_id: "target-document", title: "Target document" });
  const blockHash = await sha(JSON.stringify(sourceProperties));
  const snapshot = { schema: 1, organizationId: org, sourceProjectAccessId: "source-access", sourceDocumentId: "source-document", sourceHead: licensed ? frozenAssetHash ? 5 : 4 : 3,
    blocks: [{ sourceBlockId: "source-block", type: licensed ? "reference" : "direction", handle: "source/block", position: "a0", locked: false, properties: sourceProperties, sourceVersion: 1, contentSha256: blockHash, rightsExpiresAt: expiresAt,
      ...(frozenAssetHash ? { source: { objectKey: `organization-context/${org}/immutable-source`, contentSha256: frozenAssetHash, mimeType: "image/png", originalName: "Original file", sourceEvidenceSha256: evidenceHash, sourceClassification: "non-sensitive-licensed" } } : {}) }], relations: [] };
  const contents = JSON.stringify(snapshot);
  insert("organization_context_packages", { package_id: "package", organization_id: org, name: "Package", status: "active", created_by_user_id: sourceOwner, created_at: now, updated_at: now });
  insert("organization_context_package_versions", { version_id: "version", package_id: "package", organization_id: org, version: 1, content_sha256: await sha(contents), source_project_access_id: "source-access", source_document_id: "source-document", status: "draft", created_by_user_id: sourceOwner, approved_by_user_id: targetOwner, published_at: now, created_at: now, redacted_at: null });
  insert("organization_context_package_contents", { version_id: "version", organization_id: org, content_json: contents, created_at: now, redacted_at: null });
  insert("organization_context_package_sources", { version_id: "version", organization_id: org, source_project_access_id: "source-access", source_block_id: "source-block", source_kind: snapshot.blocks[0].type, content_sha256: blockHash, rights_expires_at: expiresAt, position: 0 });
  sqlite.exec("UPDATE organization_context_package_versions SET status='published'");
  insert("project_context_package_bindings", { binding_id: "binding", organization_id: org, project_access_id: "target-access", project_id: "target-project", document_id: "target-document", package_id: "package", version_id: "version", update_mode: "pinned", status: "active", pending_version_id: null, created_by_user_id: targetOwner, created_at: now, updated_at: now });
  insert("project_context_package_members", { binding_id: "binding", organization_id: org, source_block_id: "source-block", target_block_id: "target-block", content_sha256: blockHash });
  const block = { id: "target-block", projectId: "target-project", documentId: "target-document", properties: { text: privateText,
    organization_context_package_id: "package", organization_context_package_version_id: "version", organization_context_package_binding_id: "binding", organization_context_source_block_id: "source-block" } };
  const synchronize = () => synchronizeProjectScope(env, { organizationId: org, projectAccessId: "source-access", projectId: "source-project", ownerUserId: sourceOwner });
  if (synchronized) await synchronize();
  const capture = () => captureOutputGovernanceAssertions(env, org, [block]);
  const guards = (assertions) => assertions.flatMap((assertion) => outputAssertionStatements(env, assertion));
  const decisions = async (assertions, before = []) => {
    const event = newEvent(targetOwner, "OutputTargetAccepted", { project_id: "target-project", document_id: "target-document", acceptance_id: "new-acceptance", private_notes: "new private decision" });
    await env.DB.batch([insertEvent(env, event), ...before, ...guards(assertions)]);
    return event;
  };
  const version = async (type, properties, status = "published") => {
    const number = Number(sqlite.prepare("SELECT MAX(version) AS version FROM organization_context_package_versions").get().version) + 1;
    const id = `version-${number}`, copy = structuredClone(snapshot), hash = await sha(JSON.stringify(properties));
    copy.blocks = [{ ...copy.blocks[0], type, properties, contentSha256: hash, rightsExpiresAt: null }];
    const serialized = JSON.stringify(copy);
    insert("organization_context_package_versions", { version_id: id, package_id: "package", organization_id: org, version: number, content_sha256: await sha(serialized), source_project_access_id: "source-access", source_document_id: "source-document", status: "draft", created_by_user_id: sourceOwner, approved_by_user_id: targetOwner, published_at: now, created_at: now, redacted_at: null });
    insert("organization_context_package_contents", { version_id: id, organization_id: org, content_json: serialized, created_at: now, redacted_at: null });
    insert("organization_context_package_sources", { version_id: id, organization_id: org, source_project_access_id: "source-access", source_block_id: "source-block", source_kind: type, content_sha256: hash, rights_expires_at: null, position: 0 });
    if (status === "published") sqlite.prepare("UPDATE organization_context_package_versions SET status='published' WHERE version_id=?").run(id);
    return id;
  };
  const packageActor = { userId: targetOwner, role: "creator", streamId: `creative:${targetOwner}`, access: {
    capabilities: ["workspace.policy.manage", "project.read", "project.author", "project.library.manage"], grants: [], organizations: [{ organizationId: org, role: "administrator" }],
    projects: [{ organizationId: org, projectAccessId: "source-access", projectId: "source-project", role: "editor" }, { organizationId: org, projectAccessId: "target-access", projectId: "target-project", role: "owner" }], permissionEpoch: "fixture", canvasAccess: false,
  } };
  const packageRequest = async (path, method, body) => {
    const request = new Request(`https://forma.test/api/organization/${org}/${path.join("/")}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return handleContextPackages(request, env, packageActor, org, path);
  };
  const preparePackageRequests = async () => {
    sqlite.prepare("UPDATE organization_memberships SET role='administrator' WHERE user_id=?").run(targetOwner);
    await synchronizeProjectScope(env, { organizationId: org, projectAccessId: "target-access", projectId: "target-project", ownerUserId: targetOwner });
    env.MEDIA = Object.fromEntries(["put", "get", "head", "delete"].map((method) => [method, () => { throw new Error(`No file ${method} may occur for an unsupported Output package`); }]));
  };
  return { sqlite, env, insert, append, snapshot, capture, guards, decisions, synchronize, block, blockHash, blockEvent, documentEvent, rightsEvent, ingestEvent, queries, transport, version, packageRequest, preparePackageRequests, afterRead(callback) { afterRead = callback; } };
}

test("a normally synchronized licensed source commits with actual private event staging", async () => {
  const fixture = await database();
  const assertions = await fixture.capture();
  assert.ok(assertions.length >= 7);
  const event = await fixture.decisions(assertions);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM event_write_stage").get().n, 0);
  assert.ok(fixture.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(event.eventId).private_json.includes("new private decision"));
  assert.equal(fixture.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id='source-access'").get().last_owner_sequence, 5);
  assert.equal(JSON.stringify(fixture.sqlite.prepare("SELECT payload FROM events").all()).includes(privateText), false);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM output_atomic_assertions").get().n, 0, "assertion bodies are never retained as authority");
});

test("a different owner's rights append invalidates acceptance with the target owner head unchanged", async () => {
  const fixture = await database(), assertions = await fixture.capture();
  const targetHead = fixture.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(`creative:${targetOwner}`).head;
  const revoked = fixture.append(sourceOwner, "RightsAsserted", { project_id: "source-project", document_id: "source-document", reference_id: "source-reference", rights_class: "revoked" });
  await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
  assert.equal(fixture.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(`creative:${targetOwner}`).head, targetHead);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(revoked.eventId).n, 1);
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_projection_stale");
  await fixture.synchronize();
  await assert.rejects(fixture.capture, (error) => error.code === "context_source_rights_expired");
});

test("rights appended inside the transaction roll back its decision, body and earlier mutation", async () => {
  const fixture = await database(), assertions = await fixture.capture();
  const revoke = makeEvent(`creative:${sourceOwner}`, 6, `user:${sourceOwner}`, "fixture", "race", "RightsAsserted", { project_id: "source-project", reference_id: "source-reference", rights_class: "revoked" });
  await assert.rejects(() => fixture.decisions(assertions, [insertEvent(fixture.env, revoke)]), /CHECK constraint/u);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='OutputTargetAccepted'").get().n, 0);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(revoke.eventId).n, 0);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_event_id=?").get(revoke.eventId).n, 0);
});

for (const dependency of ["blockEvent", "documentEvent", "rightsEvent"]) test(`erasing ${dependency} without appending an event rejects the same-batch decision and cannot recreate evidence`, async () => {
  const fixture = await database(), assertions = await fixture.capture(), id = fixture[dependency].eventId;
  fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), id);
  await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
  assert.equal(fixture.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(id).private_json, "");
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='OutputTargetAccepted'").get().n, 0);
  await assert.rejects(fixture.capture, (error) => ["output_source_private_evidence_unavailable", "context_source_rights_expired", "output_source_governance_unavailable"].includes(error.code));
});

test("wrong retained owner or changed private rights body fails even with unchanged stream and scope heads", async () => {
  for (const change of ["UPDATE event_private_payloads SET owner_id='another-owner' WHERE private_event_id=?", "UPDATE event_private_payloads SET private_json=json_set(private_json,'$.rights_class','revoked') WHERE private_event_id=?"]) {
    const fixture = await database(), assertions = await fixture.capture();
    fixture.sqlite.prepare(change).run(fixture.rightsEvent.eventId);
    await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
    await assert.rejects(fixture.capture);
  }
});

test("package withdrawal, version/content redaction and effective binding changes invalidate captured proofs", async () => {
  const mutations = [
    "UPDATE organization_context_packages SET status='withdrawn'",
    "UPDATE organization_context_package_versions SET redacted_at='2026-08-27T12:00:00.000Z'",
    "UPDATE organization_context_package_contents SET redacted_at='2026-08-27T12:00:00.000Z'",
    "UPDATE project_context_package_bindings SET version_id='another-version'",
    "UPDATE project_context_package_bindings SET status='removed'",
    "UPDATE project_context_package_members SET content_sha256='different'",
  ];
  for (const mutation of mutations) {
    const fixture = await database(), assertions = await fixture.capture(); fixture.sqlite.exec(mutation);
    await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
    await assert.rejects(fixture.capture);
  }
});

test("adding source or member dependencies invalidates the complete row set rather than only comparing observed rows", async () => {
  for (const kind of ["source", "member", "assignment"]) {
    const fixture = await database(), assertions = await fixture.capture();
    if (kind === "source") fixture.insert("organization_context_package_sources", { version_id: "version", organization_id: org, source_project_access_id: "source-access", source_block_id: "additional-source", source_kind: "reference", content_sha256: fixture.blockHash, rights_expires_at: null, position: 1 });
    else fixture.insert("project_context_package_members", { binding_id: kind === "assignment" ? "another-binding" : "binding", organization_id: org, source_block_id: "additional-source", target_block_id: kind === "assignment" ? "target-block" : "additional-target", content_sha256: fixture.blockHash });
    await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
    await assert.rejects(fixture.capture);
  }
});

test("organization, origin project, origin migration and owner membership must remain active at commit", async () => {
  for (const mutation of ["UPDATE organizations SET status='disabled'", "UPDATE organization_projects SET status='disabled' WHERE project_access_id='source-access'", "UPDATE project_migration_states SET status='disabled' WHERE project_access_id='source-access'", "UPDATE organization_memberships SET status='revoked',revoked_at='2026-08-27T12:00:00.000Z' WHERE user_id='original-owner'"]) {
    const fixture = await database(), assertions = await fixture.capture(); fixture.sqlite.exec(mutation);
    await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u); await assert.rejects(fixture.capture);
  }
});

test("an external append immediately after origin synchronization cannot become a supposedly current proof", async () => {
  const fixture = await database();
  let raced = false;
  fixture.afterRead((sql) => {
    if (!raced && sql.includes("AS proof_json") && sql.includes("FROM project_event_scopes scope JOIN events")) {
      raced = true;
      fixture.append(sourceOwner, "RightsAsserted", { project_id: "source-project", document_id: "source-document", reference_id: "source-reference", rights_class: "revoked" });
    }
  });
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_changed_during_read");
  assert.equal(raced, true);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='OutputTargetAccepted'").get().n, 0);
});

test("an unsynchronized origin is unavailable and this read cannot activate or update a migration", async () => {
  const fixture = await database({ synchronized: false }); fixture.queries.length = 0;
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_projection_stale");
  assert.equal(fixture.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id='source-access'").get().last_owner_sequence, 0);
  assert.equal(fixture.queries.some((sql) => /^\s*(?:INSERT|UPDATE|DELETE)/u.test(sql)), false);
});

test("quarantining the origin during its authority read remains disabled and aborts the proof", async () => {
  const fixture = await database(); let raced = false; fixture.queries.length = 0;
  fixture.afterRead((sql) => {
    if (!raced && sql.includes("AS proof_json") && sql.includes("migration.last_owner_sequence")) {
      raced = true; fixture.sqlite.exec("UPDATE project_migration_states SET status='disabled' WHERE project_access_id='source-access'");
    }
  });
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_changed_during_read");
  assert.equal(raced, true);
  assert.equal(fixture.sqlite.prepare("SELECT status FROM project_migration_states WHERE project_access_id='source-access'").get().status, "disabled");
  assert.equal(fixture.queries.some((sql) => /^\s*(?:INSERT|UPDATE|DELETE)/u.test(sql)), false);
});

test("private evidence erased between dependency capture and final consistency read fails closed", async () => {
  const fixture = await database(); let raced = false;
  fixture.afterRead((sql) => {
    if (!raced && sql.includes("AS proof_json") && sql.includes("FROM project_event_scopes scope JOIN events")) {
      raced = true; fixture.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(fixture.rightsEvent.eventId);
    }
  });
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_changed_during_read");
  assert.equal(raced, true);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_event_id=?").get(fixture.rightsEvent.eventId).n, 0);
});

test("SQL rechecks expiry at commit time; a legal hold cannot extend the source license", async () => {
  const expiry = new Date(Date.now() + 1800).toISOString();
  const fixture = await database({ expiresAt: expiry }), assertions = await fixture.capture();
  fixture.insert("organization_retention_policies", { organization_id: org, legal_hold: 1, updated_by_user_id: targetOwner, updated_at: new Date().toISOString() });
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(expiry) - Date.now() + 40)));
  await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
  assert.ok(fixture.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(fixture.blockEvent.eventId).private_json.includes(privateText), "held source bytes survive, without granting rights");
});

test("unlicensed organization decisions survive deletion of the origin project and owner without origin synchronization", async () => {
  const fixture = await database({ licensed: false });
  fixture.sqlite.exec("DELETE FROM organization_projects WHERE project_access_id='source-access'; DELETE FROM project_migration_states WHERE project_access_id='source-access'; DELETE FROM organization_memberships WHERE user_id='original-owner'; DELETE FROM event_private_payloads WHERE owner_id='original-owner'");
  fixture.queries.length = 0;
  const assertions = await fixture.capture(); await fixture.decisions(assertions);
  assert.equal(fixture.queries.some((sql) => sql.includes("migration.last_owner_sequence") || sql.includes("FROM project_event_scopes scope JOIN events")), false);
});

test("foreign organization or forged bound block identities cannot select another package's source authority", async () => {
  for (const patch of [{ id: "other-target" }, { projectId: "other-project" }, { documentId: "other-document" }, { properties: { organization_context_package_id: "package" } }]) {
    const fixture = await database(); await assert.rejects(() => captureOutputGovernanceAssertions(fixture.env, org, [{ ...fixture.block, ...patch }]));
  }
  const fixture = await database(); await assert.rejects(() => captureOutputGovernanceAssertions(fixture.env, "foreign-organization", [fixture.block]));
});

test("a governed licensed origin cycle is unavailable rather than silently severing license dependencies", async () => {
  const fixture = await database();
  fixture.insert("project_context_package_bindings", { binding_id: "origin-binding", organization_id: org, project_access_id: "source-access", project_id: "source-project", document_id: "source-document", package_id: "package", version_id: "version", status: "active", created_by_user_id: sourceOwner, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  fixture.insert("project_context_package_members", { binding_id: "origin-binding", organization_id: org, source_block_id: "source-block", target_block_id: "source-block", content_sha256: fixture.blockHash });
  for (const [property_path, new_value] of Object.entries({ organization_context_package_id: "package", organization_context_package_version_id: "version", organization_context_package_binding_id: "origin-binding", organization_context_source_block_id: "source-block" })) fixture.append(sourceOwner, "BlockPropertyEdited", { project_id: "source-project", document_id: "source-document", block_id: "source-block", property_path, new_value });
  await fixture.synchronize();
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_governance_cycle");
});

const outputProperties = () => ({ text: "One executive slideshow", output_spec: parseOutputRequirement({ id: "source-block", type: "Output", subtype: "Executive summary", content: "One executive slideshow" }).spec });
const packageMutationCounts = (sqlite) => Object.fromEntries(["events", "event_private_payloads", "organization_context_packages", "organization_context_package_versions", "organization_context_package_contents", "organization_context_package_sources", "project_context_package_bindings", "project_context_package_members", "organization_audit_events"].map((table) => [table, Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)]));

for (const action of ["publish", "adopt", "accept", "policy", "version"]) test(`the actual package ${action} endpoint rejects Output before canonical events, files or package mutations`, async () => {
  const fixture = await database({ licensed: false }); await fixture.preparePackageRequests();
  const version = await fixture.version("OUtput", outputProperties(), action === "publish" ? "draft" : "published");
  if (action === "policy") fixture.sqlite.prepare("UPDATE project_context_package_bindings SET version_id=?").run(version);
  const before = packageMutationCounts(fixture.sqlite), previousBinding = { ...fixture.sqlite.prepare("SELECT * FROM project_context_package_bindings").get() };
  const path = action === "publish" ? ["context-packages", "package", "versions", version, "publish"]
    : action === "adopt" ? ["context-packages", "package", "adopt"]
      : action === "version" ? ["context-packages", "package", "versions"] : ["context-packages", "package", "bindings", "binding"];
  const response = await fixture.packageRequest(path, ["accept", "policy"].includes(action) ? "PATCH" : "POST", {
    action, versionId: version, projectAccessId: "target-access", sourceProjectAccessId: "source-access", documentId: action === "version" ? "source-document" : "target-document", updateMode: "follow-approved",
  });
  assert.equal(response.status, 409);
  const failure = await response.json(); assert.equal(failure.error, "output_context_package_unsupported"); assert.match(failure.message, /Document/u);
  assert.deepEqual(packageMutationCounts(fixture.sqlite), before);
  assert.deepEqual({ ...fixture.sqlite.prepare("SELECT * FROM project_context_package_bindings").get() }, previousBinding);
});

test("new package authoring rejects a selected Output block before preparing or storing any package", async () => {
  const fixture = await database({ licensed: false }); await fixture.preparePackageRequests();
  fixture.append(sourceOwner, "BlockCreated", { project_id: "source-project", document_id: "source-document", block_id: "source-output", type: "Output", properties: outputProperties() });
  await fixture.synchronize(); const before = packageMutationCounts(fixture.sqlite);
  const response = await fixture.packageRequest(["context-packages"], "POST", { name: "Unsupported output package", sourceProjectAccessId: "source-access", documentId: "source-document", blockIds: ["source-output"] });
  assert.equal(response.status, 409); assert.equal((await response.json()).error, "output_context_package_unsupported");
  assert.deepEqual(packageMutationCounts(fixture.sqlite), before);
});

test("personal privacy cleans one native file and reservation, reports an unknown upload, and stays within the hosted request budget", async (t) => {
  const fixture = await database({ licensed: false }), { sqlite, env, insert, append } = fixture;
  const now = new Date().toISOString(), hash = "a".repeat(64);
  insert("users", { user_id: targetOwner, email: "test-owner@example.test", display_name: "Test owner", role: "creator", consent_version: POLICY_VERSION, consented_at: now, created_at: now, updated_at: now });
  append(targetOwner, "ProjectCreated", { project_id: "personal-project", title: "Personal source" });
  append(targetOwner, "DocumentCreated", { project_id: "personal-project", document_id: "personal-document", title: "Personal document" });
  const source = append(targetOwner, "BlockCreated", { project_id: "personal-project", document_id: "personal-document", block_id: "personal-source", type: "direction", properties: { text: privateText } });
  insert("output_asset_storage_writes", { scope_key: "personal-scope", asset_id: "upload-asset", owner_user_id: targetOwner, actor_user_id: targetOwner,
    organization_id: null, project_access_id: null, project_id: "personal-project", document_id: "personal-document", context_id: null,
    command_key: "upload-command", request_digest: hash, source_digest: hash, storage_key: `output-requirements/${targetOwner}/upload-asset/${hash}.png`, content_sha256: hash, byte_length: 128,
    status: "writing", write_acknowledged: 0, publication_event_id: null, created_at: now, updated_at: now });
  const confirmed = append(targetOwner, "OutputPlanConfirmed", { project_id: "personal-project", document_id: "personal-document", plan_id: "privacy-plan" });
  const preflight = append(targetOwner, "OutputPlanPreflighted", { project_id: "personal-project", document_id: "personal-document", preflight_id: "privacy-preflight" });
  const authorization = append(targetOwner, "OutputExecutionAuthorized", { project_id: "personal-project", document_id: "personal-document", grant_id: "privacy-grant" });
  const future = new Date(Date.now() + 60_000).toISOString();
  insert("output_plan_revisions", { scope_key: "personal-scope", scope_kind: "personal", owner_user_id: targetOwner, project_id: "personal-project", document_id: "personal-document", organization_id: null, project_access_id: null, plan_revision_id: "privacy-plan", plan_id: "privacy-plan", revision: 1, confirmed_event_id: confirmed.eventId, requirements_digest: hash, source_digest: hash, resolver_version: "fixture", source_head: confirmed.sequence, target_count: 2, created_at: now });
  for (const [ordinal, target] of ["queued", "native"].entries()) insert("output_plan_targets", { scope_key: "personal-scope", plan_revision_id: "privacy-plan", target_id: target, target_contract_digest: hash, media_kind: "image", required: 1, selected: 1, ordinal });
  insert("output_preflights", { scope_key: "personal-scope", preflight_id: "privacy-preflight", plan_revision_id: "privacy-plan", actor_user_id: targetOwner, terms_digest: hash, event_id: preflight.eventId, expires_at: future, created_at: now });
  insert("output_execution_grants", { scope_key: "personal-scope", grant_id: "privacy-grant", plan_revision_id: "privacy-plan", actor_user_id: targetOwner, payer_user_id: targetOwner, context_id: null, preflight_id: "privacy-preflight", authorization_event_id: authorization.eventId, maximum_microusd: 2000, maximum_calls: 2, status: "authorized", expires_at: future, created_at: now });
  for (const target of ["queued", "native"]) {
    insert("output_operation_slots", { scope_key: "personal-scope", slot_id: `${target}-slot`, grant_id: "privacy-grant", plan_revision_id: "privacy-plan", target_id: target, target_contract_digest: hash, source_digest: hash, provider: "fixture", model: "fixture", route_digest: hash, job_id: `${target}-job`, cost_reservation_id: `${target}-cost`, token_reservation_id: `${target}-tokens`, maximum_microusd: 1000, maximum_calls: 1, maximum_tokens: 100, status: target === "queued" ? "queued" : "failed", outcome_event_id: null, created_at: now, updated_at: now });
    insert("document_jobs", { job_id: `${target}-job`, owner_id: targetOwner, stream_id: `creative:${targetOwner}`, document_id: "personal-document", kind: "generate", status: target === "queued" ? "queued" : "failed", source_surface: "output-requirements", correlation_id: `${target}-correlation`, requested_sequence: authorization.sequence, request_json: JSON.stringify({ source: privateText }), result_json: JSON.stringify({ privateDraft: privateText }), error_message: privateText, attempt_count: target === "queued" ? 0 : 1, requested_at: now, expires_at: future, updated_at: now });
  }
  insert("budget_reservations", { reservation_id: "queued-tokens", owner_id: targetOwner, stream_id: `creative:${targetOwner}`, correlation_id: "queued-correlation", operation: "generate", period: "privacy-period", reserved_tokens: 100, used_tokens: 0, status: "active", created_at: now, updated_at: now });
  insert("cost_budget_reservations", { reservation_id: "queued-cost", owner_id: targetOwner, workspace_id: "forma", stream_id: `creative:${targetOwner}`, correlation_id: "queued-correlation", operation: "generate", period: "privacy-period", reserved_microusd: 1000, used_microusd: 0, status: "active", created_at: now, updated_at: now });
  for (const [scope, scope_id] of [["user", targetOwner], ["workspace", "forma"]]) {
    insert("budget_counters", { scope, scope_id, period: "privacy-period", used_tokens: 0, reserved_tokens: 100, hard_limit_tokens: 1000, updated_at: now });
    insert("cost_budget_counters", { scope, scope_id, period: "privacy-period", used_microusd: 0, reserved_microusd: 1000, hard_limit_microusd: 10000, updated_at: now });
  }
  const nativeKey = "native/personal-file.png";
  insert("output_native_storage_writes", { scope_key: "personal-scope", slot_id: "native-slot", storage_key: nativeKey, content_sha256: hash, status: "written", write_acknowledged: 1, publication_event_id: null, created_at: now, updated_at: now });
  const objects = new Map([[nativeKey, { customMetadata: { outputNativeStorage: "1", outputOwnerId: targetOwner, outputScopeKey: "personal-scope", outputSlotId: "native-slot", outputDocumentId: "personal-document", outputSha256: hash } }]]);
  env.MEDIA = { async head(key) { fixture.transport.r2++; return objects.get(key) ?? null; }, async delete(key) { fixture.transport.r2++; objects.delete(key); } };
  const request = () => new Request("https://forma.test/api/privacy/events", { method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-id": targetOwner, "oai-authenticated-user-email": "test-owner@example.test", "oai-authenticated-user-full-name": "Test owner", "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8" }, body: JSON.stringify({ action: "erase-personal-authored-context", confirmation: "ERASE_MY_PERSONAL_AUTHORED_CONTEXT" }) });
  fixture.transport.d1 = 0; fixture.transport.r2 = 0;
  const response = await handleEventPrivacy(request(), env);
  assert.equal(response.status, 200); const receipt = await response.json();
  assert.ok(receipt.erasedAuthoredEventBodies >= 3); assert.equal(receipt.outputStorageCleanupPending, 1);
  assert.equal(receipt.finishedOutputsRetained, true); assert.equal(receipt.outputReconciliationCheckFailed, false);
  assert.equal(sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(source.eventId).private_json, "");
  assert.equal(sqlite.prepare("SELECT status FROM output_asset_storage_writes").get().status, "cleanup_pending");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM output_execution_grants").get().n, 1, "erasure never created new authority");
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants").get().status, "revoked");
  assert.equal(sqlite.prepare("SELECT status FROM output_native_storage_writes").get().status, "deleted");
  assert.equal(objects.has(nativeKey), false);
  assert.equal(JSON.stringify(sqlite.prepare("SELECT request_json,result_json,error_message FROM document_jobs").all()).includes(privateText), false);
  assert.ok(["released", "settled"].includes(sqlite.prepare("SELECT status FROM budget_reservations").get().status));
  assert.ok(["released", "settled"].includes(sqlite.prepare("SELECT status FROM cost_budget_reservations").get().status));
  assert.equal(sqlite.prepare("SELECT SUM(reserved_tokens) AS reserved FROM budget_counters").get().reserved, 0);
  assert.equal(sqlite.prepare("SELECT SUM(reserved_microusd) AS reserved FROM cost_budget_counters").get().reserved, 0);
  assert.ok(fixture.transport.d1 + fixture.transport.r2 <= 50, `privacy transport subrequests: ${JSON.stringify(fixture.transport)}`);
  t.diagnostic(`Erasure with all three cleanup categories used ${fixture.transport.d1} D1 and ${fixture.transport.r2} R2 subrequests (schema already initialized).`);
  const again = await handleEventPrivacy(request(), env); assert.equal((await again.json()).outputStorageCleanupPending, 1);
  assert.equal(sqlite.prepare("SELECT write_acknowledged FROM output_asset_storage_writes").get().write_acknowledged, 0);
});

test("frozen source media uses its asset digest, and renewal for the same immutable bytes remains valid", async () => {
  const assetHash = "a".repeat(64), fixture = await database({ frozenAssetHash: assetHash, evidenceHash: "e".repeat(64) });
  assert.notEqual(fixture.blockHash, assetHash, "the block JSON hash and media bytes hash are different identities");
  await fixture.capture();
  fixture.append(sourceOwner, "ReferenceIngested", { project_id: "source-project", document_id: "source-document", reference_id: "source-reference", source_ref: "/api/media/original-file.png", content_hash: assetHash, rights_class: "owned_or_licensed", license_expires_at: "2000-01-01T00:00:00.000Z" });
  fixture.append(sourceOwner, "RightsAsserted", { project_id: "source-project", document_id: "source-document", reference_id: "source-reference", rights_class: "owned_or_licensed", license_note: "Renewal for unchanged bytes" });
  await fixture.synchronize();
  await fixture.decisions(await fixture.capture());
});

test("a block repointed to newly licensed media B cannot supply a license for frozen package media A", async () => {
  const fixture = await database({ frozenAssetHash: "a".repeat(64) }); await fixture.capture();
  fixture.append(sourceOwner, "RightsAsserted", { project_id: "source-project", reference_id: "source-reference", rights_class: "revoked" });
  fixture.append(sourceOwner, "ReferenceIngested", { project_id: "source-project", document_id: "source-document", reference_id: "replacement-reference", source_ref: "/api/media/replacement.png", content_hash: "b".repeat(64), rights_class: "owned_or_licensed" });
  fixture.append(sourceOwner, "RightsAsserted", { project_id: "source-project", reference_id: "replacement-reference", rights_class: "owned_or_licensed" });
  for (const [property_path, new_value] of Object.entries({ reference_id: "replacement-reference", media_url: "/api/media/replacement.png", source_content_hash: "b".repeat(64) })) fixture.append(sourceOwner, "BlockPropertyEdited", { project_id: "source-project", document_id: "source-document", block_id: "source-block", property_path, new_value });
  await fixture.synchronize();
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_governance_unavailable");
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='OutputTargetAccepted'").get().n, 0);
});

test("frozen source identity fails when its exact ingest body disappears between capture and acceptance", async () => {
  const fixture = await database({ frozenAssetHash: "a".repeat(64) }), assertions = await fixture.capture();
  fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), fixture.ingestEvent.eventId);
  await assert.rejects(() => fixture.decisions(assertions), /CHECK constraint/u);
  await assert.rejects(fixture.capture);
  assert.equal(fixture.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(fixture.ingestEvent.eventId).private_json, "");
});

test("frozen source evidence hash cannot be replaced while reusing a matching media digest", async () => {
  const fixture = await database({ frozenAssetHash: "a".repeat(64), evidenceHash: "e".repeat(64) }); await fixture.capture();
  fixture.append(sourceOwner, "BlockPropertyEdited", { project_id: "source-project", document_id: "source-document", block_id: "source-block", property_path: "source_evidence_hash", new_value: "f".repeat(64) });
  await fixture.synchronize();
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_governance_unavailable");
});

test("a legacy reference package without a frozen media identity is unavailable rather than inheriting current-reference rights", async () => {
  const fixture = await database({ frozenAssetHash: null });
  await assert.rejects(fixture.capture, (error) => error.code === "output_source_governance_unavailable");
});
