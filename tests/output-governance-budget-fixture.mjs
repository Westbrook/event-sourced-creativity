// Exact production SQLite fixture shared with the existing governance regressions.
import assert from "node:assert/strict";
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
  ,
  ,
  ,
  { governedPackageSourceRightsCurrent },
] = await Promise.all([
  import("../worker/output-requirement-governance-assertions.ts"),
  import("../worker/runtime.ts"),
  import("../worker/output-requirements-ledger.ts"),
  import("../worker/project-access.ts"),
  import("../worker/context-packages-api.ts"),
  import("../src/model/output-requirements.ts"),
  import("../worker/privacy-api.ts"),
  import("../worker/pilot-policy.ts"),
  import("../worker/context-package-rights.ts"),
]).finally(() => sourceResolution.deregister());

const privateText = "Retained private source wording must never return through an operational receipt";
const org = "organization", sourceOwner = "original-owner", targetOwner = "document-owner";
const sha = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Real production DDL/triggers, real SQLite transactions. Only D1 transport is adapted. */
async function database({ sourceUserId = sourceOwner, licensed = true, expiresAt = null, synchronized = true, frozenAssetHash = licensed ? "a".repeat(64) : null, evidenceHash = null } = {}) {
  const sourceOwner = sourceUserId;
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  let afterRead = null;
  const queries = [];
  const statements = [];
  const transport = { d1: 0, r2: 0 };
  class Statement {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { assert.ok(args.length <= 100, "D1 statement parameter ceiling"); return new Statement(this.sql, args); }
    execute(mode) {
      queries.push(this.sql);
      assert.ok(Buffer.byteLength(this.sql, "utf8") <= 100_000, "D1 SQL text ceiling");
      statements.push({ sql: this.sql, bindings: this.args, mode });
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
    if (!sqlite.prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND user_id=?").get(org, owner)) insert("organization_memberships", { membership_id: `${prefix}-member`, organization_id: org, user_id: owner, role: "member", status: "active", invited_by_user_id: targetOwner, accepted_at: now, created_at: now, updated_at: now, revoked_at: null });
  }
  const newEvent = (owner, type, payload) => makeEvent(`creative:${owner}`, Number(sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(`creative:${owner}`).head) + 1, `user:${owner}`, "fixture", "governance-fixture", type, payload);
  const append = (owner, type, payload, overrides = {}) => {
    const event = Object.assign(newEvent(owner, type, payload), overrides);
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
  return { sqlite, env, insert, append, snapshot, capture, guards, decisions, synchronize, block, blockHash, blockEvent, documentEvent, rightsEvent, ingestEvent, queries, statements, transport, version, packageRequest, preparePackageRequests, afterRead(callback) { afterRead = callback; } };
}

export { database, captureOutputGovernanceAssertions, governedPackageSourceRightsCurrent, synchronizeProjectScope, org, sourceOwner, targetOwner, privateText, sha };
