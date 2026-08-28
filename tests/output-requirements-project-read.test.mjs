import assert from "node:assert/strict";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";
const hook = registerOutputSourceImports();
const { ensureSchema, makeEvent, appendEvents } = await import("../worker/runtime.ts");
const { handleOutputRequirements, loadOutputTrustedContext, loadOutputCurrentContext, outputDigest } = await import("../worker/output-requirements-api.ts");
const { readOutputGovernanceWitness } = await import("../worker/output-governance-witness.ts");
const { handleWorkspaces } = await import("../worker/workspaces-api.ts");
const { handleEvents } = await import("../worker/events-api.ts");
const { parseOutputRequirement } = await import("../src/model/output-requirements.ts");
hook.deregister();
const previousFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("project_source_tests_cannot_use_network"); }; });
test.after(() => { globalThis.fetch = previousFetch; });
const owner = "dev-local-creative", project = "readonly-project", doc = "readonly-document", base = "/api/output-requirements";
const jsonRequest = (url, body, headers = {}) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function fixture() {
  const state = outputTestDatabase(); await ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(owner, "creative@local.forma", "Local creative", now, now, now);
  const spec = parseOutputRequirement({ id: "image-assignment", Type: "Output", Subtype: "Social media image", Content: 'One image at aspect ratio "1:1".' }).spec;
  for (const deliverable of spec.deliverables) {
    deliverable.quantity = { kind: "exact", unit: "image", value: 1 };
    for (const variant of deliverable.format_variants) variant.quantity = { kind: "exact", unit: "image", value: 1 };
  }
  await appendEvents(state.env, [
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "source", "ProjectCreated", { project_id: project, name: "Read-only source test" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "source", "DocumentCreated", { project_id: project, document_id: doc, title: "Exact authorized Document" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "source", "BlockCreated", { project_id: project, document_id: doc, block_id: "direction", scope: "document", type: "direction", position: "a", properties: { text: "Describe the owned test source without adding facts.", weight: 1 } }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "source", "BlockCreated", { project_id: project, document_id: doc, block_id: spec.id, scope: "document", type: "output", position: "b", properties: { text: spec.original_text, subtype: spec.label, output_spec: spec } }),
  ]);
  const workspace = (path, body) => handleWorkspaces(body ? jsonRequest(`/api/workspaces/${path.join("/")}`, body) : new Request(`http://localhost/api/workspaces/${path.join("/")}`, { method: "POST" }), state.env, path);
  const created = await workspace([], { name: "Read-only Output source" }); assert.equal(created.status, 201, await created.clone().text());
  const organizationId = (await created.json()).organizationId;
  const attached = await workspace([organizationId, "projects"], { projectId: project }); assert.equal(attached.status, 201, await attached.clone().text());
  const projectAccessId = (await attached.json()).projectAccessId;
  const opened = await workspace([organizationId, "projects", projectAccessId, "context"]); assert.equal(opened.status, 200, await opened.clone().text());
  const cookie = opened.headers.get("set-cookie").split(";")[0];
  // Normal browser scope entry loads the authorized source stream first. This is
  // the existing refresh route, not an Output read repairing the projection.
  const refreshed = await handleEvents(new Request("http://localhost/api/events", { headers: { cookie } }), state.env);
  assert.equal(refreshed.status, 200, await refreshed.clone().text());
  const get = () => handleOutputRequirements(new Request(`http://localhost${base}?documentId=${doc}`, { headers: { cookie } }), state.env, base, { waitUntil() { throw new Error("no_background_work"); } });
  const first = await get(); assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await first.json()).requirements.length, 1);
  const request = () => new Request(`http://localhost${base}?documentId=${doc}`, { headers: { cookie } });
  const refresh = async () => { const response = await handleEvents(new Request("http://localhost/api/events", { headers: { cookie } }), state.env); assert.equal(response.status, 200, await response.clone().text()); };
  let commandId = 0;
  const command = async (body, expected = 200) => {
    const before = await get(); assert.equal(before.status, 200, await before.clone().text());
    const snapshot = await before.json();
    const response = await handleOutputRequirements(jsonRequest(base, { documentId: doc, expectedRevision: snapshot.revision, clientMutationId: `governance-${++commandId}`, ...body }, { cookie }), state.env, base, { waitUntil() { throw new Error("no_background_work"); } });
    assert.equal(response.status, expected, await response.clone().text()); return response.json();
  };
  return { ...state, get, request, command, refresh, spec, cookie, projectAccessId, organizationId };
}

test("a real scoped Output read refuses a stale projection without updating its cursor", async () => {
  const state = await fixture();
  const cursor = state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId).last_owner_sequence;
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "opened-after-refresh", "DocumentOpened", { project_id: project, document_id: doc })]);
  const response = await state.get();
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json()).errorCode, "output_source_projection_stale");
  assert.equal(state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId).last_owner_sequence, cursor);
});

test("quarantine between selection validation and the Output source read remains disabled", async () => {
  const state = await fixture(), batch = state.env.DB.batch.bind(state.env.DB);
  let quarantined = false;
  state.env.DB.batch = async (statements) => {
    if (!quarantined && statements.some((statement) => statement.sql.includes("AS projection_current"))) {
      state.sqlite.prepare("UPDATE project_migration_states SET status='disabled' WHERE project_access_id=?").run(state.projectAccessId); quarantined = true;
    }
    return batch(statements);
  };
  const eventCount = state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const response = await state.get();
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal(quarantined, true);
  assert.equal((await response.json()).errorCode, "output_execution_authority_revoked");
  assert.equal(state.sqlite.prepare("SELECT status FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId).status, "disabled");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, eventCount);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

const hashText = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((value) => value.toString(16).padStart(2, "0")).join("");
async function governedFixture({ licensed = false } = {}) {
  const state = await fixture(), now = new Date().toISOString(), originDoc = "governed-origin-document", originBlock = "governed-origin-block";
  const insert = (table, value) => state.sqlite.prepare(`INSERT INTO ${table}(${Object.keys(value).join(",")}) VALUES(${Object.keys(value).map(() => "?").join(",")})`).run(...Object.values(value));
  const properties = { text: "An institutionally retained creative direction.", ...(licensed ? { license_expires_at: new Date(Date.now() + 3_600_000).toISOString() } : {}) };
  await appendEvents(state.env, [
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "origin", "DocumentCreated", { project_id: project, document_id: originDoc, title: "ORIGIN PRIVATE TITLE SHOULD NOT APPEAR IN SOURCE LABELS" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "origin", "BlockCreated", { project_id: project, document_id: originDoc, block_id: originBlock, scope: "document", type: "direction", position: "origin", properties }),
  ]);
  const addPackage = async ({ id, sourceBlockId, sourceDocumentId, sourceProperties, targetId, targetDoc = doc }) => {
    const versionId = `${id}-version`, bindingId = `${id}-binding`, memberHash = await hashText(JSON.stringify(sourceProperties));
    const snapshot = { schema: 1, organizationId: state.organizationId, sourceProjectAccessId: state.projectAccessId, sourceDocumentId,
      blocks: [{ sourceBlockId, type: "direction", properties: sourceProperties, contentSha256: memberHash, rightsExpiresAt: null }], relations: [] };
    const raw = JSON.stringify(snapshot);
    insert("organization_context_packages", { package_id: id, organization_id: state.organizationId, name: id, status: "active", created_by_user_id: owner, created_at: now, updated_at: now });
    insert("organization_context_package_versions", { version_id: versionId, package_id: id, organization_id: state.organizationId, version: 1, content_sha256: await hashText(raw), source_project_access_id: state.projectAccessId, source_document_id: sourceDocumentId, status: "draft", created_by_user_id: owner, approved_by_user_id: owner, published_at: now, created_at: now });
    insert("organization_context_package_contents", { version_id: versionId, organization_id: state.organizationId, content_json: raw, created_at: now });
    insert("organization_context_package_sources", { version_id: versionId, organization_id: state.organizationId, source_project_access_id: state.projectAccessId, source_block_id: sourceBlockId, source_kind: "direction", content_sha256: memberHash, rights_expires_at: null, position: 0 });
    state.sqlite.prepare("UPDATE organization_context_package_versions SET status='published' WHERE version_id=?").run(versionId);
    insert("project_context_package_bindings", { binding_id: bindingId, organization_id: state.organizationId, project_access_id: state.projectAccessId, project_id: project, document_id: targetDoc, package_id: id, version_id: versionId, update_mode: "pinned", status: "active", created_by_user_id: owner, created_at: now, updated_at: now });
    insert("project_context_package_members", { binding_id: bindingId, organization_id: state.organizationId, source_block_id: sourceBlockId, target_block_id: targetId, content_sha256: memberHash });
    return { organization_context_package_id: id, organization_context_package_version_id: versionId, organization_context_package_binding_id: bindingId, organization_context_source_block_id: sourceBlockId };
  };
  const provenance = await addPackage({ id: "current-package", sourceBlockId: originBlock, sourceDocumentId: originDoc, sourceProperties: properties, targetId: "current-governed-source" });
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "governed-source", "BlockCreated", { project_id: project, document_id: doc, block_id: "current-governed-source", scope: "document", type: "direction", position: "c", properties: { ...properties, ...provenance, label: "Current Document guidelines" } })]);
  await state.refresh();
  return { ...state, originDoc, originBlock, properties, insert, addPackage };
}
function observeReads(state) {
  const original = state.env.DB.batch.bind(state.env.DB), observed = { captures: 0, finalReads: 0, statements: [] };
  state.env.DB.batch = async (statements) => {
    if (statements.some((statement) => statement.sql.includes("AS proof_json"))) observed.captures++;
    if (statements.some((statement) => statement.sql.includes(" AS head FROM events")) && statements.some((statement) => statement.sql.includes(" AS current"))) observed.finalReads++;
    observed.statements.push(...statements.map((statement) => statement.sql));
    return original(statements);
  };
  return observed;
}

for (const licensed of [false, true]) test(`complete ${licensed ? "licensed" : "institutional"} governance is checked with the existing head read and only then becomes an opaque admission witness`, async () => {
  const state = await governedFixture({ licensed }), observed = observeReads(state), request = state.request();
  const trusted = await loadOutputTrustedContext(request, state.env, doc);
  assert.ok(!(trusted instanceof Response));
  assert.deepEqual(trusted.sourceProblems, []);
  assert.equal(observed.captures, licensed ? 2 : 1);
  assert.equal(observed.finalReads, 1);
  assert.equal(observed.statements.some((sql) => sql.startsWith("SELECT version.content_sha256,content.content_json")), false, "the redundant old generic rights traversal does not run");
  assert.ok(trusted.governanceWitness);
  const identity = { request, env: state.env, actorUserId: owner, ownerUserId: owner, organizationId: state.organizationId,
    projectAccessId: state.projectAccessId, projectId: project, documentId: doc, contextId: trusted.scope.contextId,
    sourceDigest: trusted.sourceDigest, contextSnapshotDigest: await outputDigest(trusted.context.snapshot) };
  const proof = readOutputGovernanceWitness(trusted.governanceWitness, identity);
  assert.ok(proof.length > 0);
  assert.ok(proof.every((guard) => trusted.sourceAssertions.some((retained) => retained.sql === guard.sql && JSON.stringify(retained.bindings) === JSON.stringify(guard.bindings))));
  assert.throws(() => readOutputGovernanceWitness(trusted.governanceWitness, { ...identity, request: state.request() }), /output_source_governance_unavailable/u);
  observed.captures = 0; observed.finalReads = 0;
  const native = await loadOutputCurrentContext(state.env, trusted.scope);
  assert.equal(observed.captures, licensed ? 2 : 1);
  assert.equal(observed.finalReads, 1, "native validation remains in the existing private-body/head batch");
  assert.equal(native.sourceDigest, trusted.sourceDigest);
  const snapshot = await (await state.get()).json();
  assert.deepEqual(snapshot.sourceVerification.governance, { captureBatchLimit: 2, sources: [{ blockId: "current-governed-source", label: "Current Document guidelines" }], sourcesComplete: true });
  assert.equal(snapshot.sourceVerification.status, "verified");
  assert.doesNotMatch(JSON.stringify(snapshot.sourceVerification), /governed-origin|ORIGIN PRIVATE TITLE/);
});

for (const native of [false, true]) test(`${native ? "native" : "HTTP"} source read rejects a governed package withdrawn between deferred capture and its final read`, async () => {
  const state = await governedFixture({ licensed: true });
  const initial = await loadOutputTrustedContext(state.request(), state.env, doc); assert.ok(!(initial instanceof Response));
  const original = state.env.DB.batch.bind(state.env.DB); let withdrawn = false;
  state.env.DB.batch = async (statements) => {
    if (!withdrawn && statements.some((statement) => statement.sql.includes(" AS head FROM events")) && statements.some((statement) => statement.sql.includes(" AS current") && statement.sql.includes("organization_context_packages"))) {
      withdrawn = true; state.sqlite.exec("UPDATE organization_context_packages SET status='withdrawn' WHERE package_id='current-package'");
    }
    return original(statements);
  };
  const before = state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  if (native) await assert.rejects(loadOutputCurrentContext(state.env, initial.scope), /output_source_changed_during_read/u);
  else { const response = await state.get(); assert.equal(response.status, 409, await response.clone().text()); assert.equal((await response.json()).errorCode, "output_source_changed_during_read"); }
  assert.equal(withdrawn, true);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, before);
});

test("a nested governed origin reports capacity with only current Document names and retains free planning and the whole assignment", async () => {
  const state = await governedFixture({ licensed: true });
  const confirmed = await state.command({ action: "confirm" });
  const inner = await state.addPackage({ id: "nested-package", sourceBlockId: "institutional-decision", sourceDocumentId: "earlier-document", sourceProperties: { text: "A retained institutional decision" }, targetId: state.originBlock, targetDoc: state.originDoc });
  await appendEvents(state.env, Object.entries(inner).map(([property_path, new_value]) => makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "nested-origin", "BlockPropertyEdited", { project_id: project, document_id: state.originDoc, block_id: state.originBlock, property_path, new_value })));
  await state.refresh();
  const observed = observeReads(state), response = await state.get();
  assert.equal(response.status, 200, await response.clone().text());
  const snapshot = await response.json();
  assert.equal(observed.captures, 2, "no third capture is issued");
  assert.ok(snapshot.sourceVerification.reasonCodes.includes("output_source_governance_capacity_exceeded"));
  assert.equal(snapshot.sourceVerification.status, "unavailable");
  assert.equal(snapshot.requirements.length, 1);
  assert.equal(snapshot.confirmedPlan.plan.obligations.length, confirmed.snapshot.confirmedPlan.plan.obligations.length);
  assert.equal(snapshot.summary.completion, "unknown");
  assert.deepEqual(snapshot.sourceVerification.governance.sources, [{ blockId: "current-governed-source", label: "Current Document guidelines" }]);
  assert.doesNotMatch(JSON.stringify(snapshot.sourceVerification.governance), /governed-origin|nested-package|earlier-document|institutional-decision/);
  const trusted = await loadOutputTrustedContext(state.request(), state.env, doc);
  assert.equal(trusted.governanceWitness, undefined);
  for (const body of [
    { action: "preflight", planRevisionId: snapshot.confirmedPlan.revisionId },
    { action: "bind", planRevisionId: snapshot.confirmedPlan.revisionId, targetId: snapshot.confirmedPlan.plan.targets[0].id, assetId: "not-adopted" },
    { action: "review", resultId: "not-produced", decision: "approve", reviewedCoverage: true, reviewedRights: true },
    { action: "export", planRevisionId: snapshot.confirmedPlan.revisionId },
  ]) assert.equal((await state.command(body, 409)).errorCode, "output_source_governance_capacity_exceeded", body.action);
  const draft = structuredClone(state.spec); draft.label = "A preserved next proposal";
  const saved = await state.command({ action: "save", blockId: draft.id, spec: draft });
  assert.equal(saved.snapshot.requirements[0].spec.label, draft.label);
  const agreed = await state.command({ action: "confirm" });
  assert.equal(agreed.snapshot.sourceVerification.status, "unavailable");
  assert.notEqual(agreed.snapshot.summary.completion, "complete");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_execution_grants").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);
  const originalBatch = state.env.DB.batch.bind(state.env.DB); let erased = false;
  state.env.DB.batch = async (statements) => {
    if (!erased && statements.some((statement) => statement.sql.includes("INSERT INTO output_commands") && statement.bindings.includes("save"))) {
      erased = true; state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE owner_id=?").run(new Date().toISOString(), owner);
    }
    return originalBatch(statements);
  };
  const before = state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const denied = await state.command({ action: "save", blockId: draft.id, spec: { ...draft, label: "Must not resurrect erased work" } }, 409);
  assert.equal(erased, true);
  assert.equal(denied.errorCode, "output_revision_or_authority_changed");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, before);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM event_private_payloads WHERE redacted_at IS NULL AND private_json LIKE '%Must not resurrect erased work%'").get().count, 0);
});

test("governed source labels are bounded current-Document display metadata and never confer verification", async () => {
  const state = await fixture();
  await appendEvents(state.env, Array.from({ length: 33 }, (_, index) => makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "governed-labels", "BlockCreated", {
    project_id: project, document_id: doc, block_id: `current-governed-${index}`, scope: "document", type: "direction", position: `c${index}`,
    properties: { text: "A preserved draft source", label: index ? `Current Document source ${index}` : "🌲".repeat(130),
      organization_context_package_id: "missing-package", organization_context_package_version_id: "private-origin-version", organization_context_package_binding_id: "private-origin-binding", organization_context_source_block_id: "private-origin-block" },
  })));
  await state.refresh();
  const response = await state.get(); assert.equal(response.status, 200, await response.clone().text());
  const snapshot = await response.json(), display = snapshot.sourceVerification.governance;
  assert.equal(snapshot.sourceVerification.status, "unavailable");
  assert.equal(snapshot.requirements.length, 1);
  assert.equal(display.captureBatchLimit, 2);
  assert.equal(display.sources.length, 32);
  assert.equal(display.sourcesComplete, false);
  assert.equal([...display.sources[0].label].length, 120);
  assert.ok(display.sources.every((source) => source.blockId.startsWith("current-governed-")));
  assert.doesNotMatch(JSON.stringify(display), /private-origin|missing-package/);
  const trusted = await loadOutputTrustedContext(state.request(), state.env, doc);
  assert.equal(trusted.governanceWitness, undefined);
});

test("serialized governance proof capacity preserves finite free planning, precise consequential refusals and private-erasure fences", async () => {
  const state = await governedFixture();
  const confirmed = await state.command({ action: "confirm" });
  assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length, 1);
  const additions = [];
  for (let index = 1; index < 16; index++) {
    // Each immutable content row is legal on its own. Their complete grouped
    // proof exceeds the serialized-row budget without exceeding graph breadth.
    const sourceProperties = { text: `Retained source ${index}: ${"x".repeat(145_000)}` };
    const sourceBlockId = `large-origin-${index}`, targetId = `large-current-${index}`;
    const provenance = await state.addPackage({ id: `large-package-${index}`, sourceBlockId, sourceDocumentId: state.originDoc, sourceProperties, targetId });
    additions.push(
      makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "large-origin", "BlockCreated", { project_id: project, document_id: state.originDoc, block_id: sourceBlockId, scope: "document", type: "direction", position: `o${index}`, properties: sourceProperties }),
      makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "large-current", "BlockCreated", { project_id: project, document_id: doc, block_id: targetId, scope: "document", type: "direction", position: `l${index}`, properties: { ...sourceProperties, ...provenance, label: `Current Document retained source ${index}` } }),
    );
  }
  await appendEvents(state.env, additions);
  await state.refresh();
  const response = await state.get(); assert.equal(response.status, 200, await response.clone().text());
  const snapshot = await response.json(), code = "output_source_governance_proof_too_large";
  assert.ok(snapshot.sourceVerification.reasonCodes.includes(code));
  assert.equal(snapshot.sourceVerification.reasonCodes.includes("output_source_governance_capacity_exceeded"), false, "serialized size is not the two-capture limit");
  assert.equal(snapshot.sourceVerification.status, "unavailable");
  assert.equal(snapshot.requirements.length, 1);
  assert.equal(snapshot.confirmedPlan.plan.targets.length, 1);
  assert.equal(snapshot.summary.completion, "unknown");
  const trusted = await loadOutputTrustedContext(state.request(), state.env, doc);
  assert.equal(trusted.governanceWitness, undefined);
  for (const body of [
    { action: "preflight", planRevisionId: snapshot.confirmedPlan.revisionId },
    { action: "bind", planRevisionId: snapshot.confirmedPlan.revisionId, targetId: snapshot.confirmedPlan.plan.targets[0].id, assetId: "not-adopted" },
    { action: "review", resultId: "not-produced", decision: "approve", reviewedCoverage: true, reviewedRights: true },
    { action: "export", planRevisionId: snapshot.confirmedPlan.revisionId },
  ]) assert.equal((await state.command(body, 409)).errorCode, code, body.action);
  for (const suffix of ["assets/not-adopted", "deliveries/not-prepared"]) {
    const path = `${base}/${suffix}`;
    const denied = await handleOutputRequirements(new Request(`http://localhost${path}?documentId=${doc}`, { headers: { cookie: state.cookie } }), state.env, path, { waitUntil() { throw new Error("no_background_work"); } });
    assert.equal(denied.status, 409, await denied.clone().text());
    assert.equal((await denied.json()).errorCode, code);
  }
  const draft = structuredClone(state.spec); draft.label = "Preserved plan for a large governed source";
  const saved = await state.command({ action: "save", blockId: draft.id, spec: draft });
  assert.equal(saved.snapshot.requirements[0].spec.label, draft.label);
  const agreed = await state.command({ action: "confirm" });
  assert.equal(agreed.snapshot.confirmedPlan.plan.targets.length, 1);
  assert.equal(agreed.snapshot.sourceVerification.status, "unavailable");
  assert.notEqual(agreed.snapshot.summary.completion, "complete");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_execution_grants").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);
  const originalBatch = state.env.DB.batch.bind(state.env.DB); let erased = false;
  state.env.DB.batch = async (statements) => {
    if (!erased && statements.some((statement) => statement.sql.includes("INSERT INTO output_commands") && statement.bindings.includes("save"))) {
      erased = true; state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE owner_id=? AND document_id=?").run(new Date().toISOString(), owner, doc);
    }
    return originalBatch(statements);
  };
  const before = state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const denied = await state.command({ action: "save", blockId: draft.id, spec: { ...draft, label: "Erased work must not return" } }, 409);
  assert.equal(erased, true);
  assert.equal(denied.errorCode, "output_revision_or_authority_changed");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, before);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM event_private_payloads WHERE redacted_at IS NULL AND private_json LIKE '%Erased work must not return%'").get().count, 0);
});
