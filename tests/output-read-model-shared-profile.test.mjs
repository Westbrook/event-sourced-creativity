import assert from "node:assert/strict";
import test from "node:test";
import { outputReadModelFixture, outputReadModelOwner as owner, outputReadModelProject as project, outputReadModelDocument as doc } from "./output-read-model-fixture.mjs";
import { registerScalingSourceImports } from "./output-read-model-test-helpers.mjs";
const hooks = registerScalingSourceImports();
const { readStoredZip } = await import("./output-asset-fixtures.mjs");
const { appendEvents, makeEvent } = await import("../worker/runtime.ts");
const { handleOutputRequirements } = await import("../worker/output-requirements-api.ts");
hooks.deregister();

const originalFetch = globalThis.fetch;
let providerCalls = 0;
test.before(() => { globalThis.fetch = async () => { providerCalls++; throw new Error("shared_profile_provider_disabled"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(providerCalls, 0); });
const measured = (counter) => ({ db: counter.db, r2List: counter.r2List, r2Head: counter.r2Head, r2Get: counter.r2Get, total: counter.total });

for (const { count, actingReviewer } of [{ count: 65, actingReviewer: false }, { count: 1000, actingReviewer: false }, { count: 65, actingReviewer: true }, { count: 1000, actingReviewer: true }]) test(`governed ${actingReviewer ? "reviewer" : "owner"} ${count}-target HTTP profile: eight catalog pages and four exact extracted sources`, async (t) => {
  const state = await outputReadModelFixture(count, { shared: true, actingReviewer, sourceReferences: 4, pageSize: Math.ceil(count / 8) });
  t.after(() => state.sqlite.close());
  const initial = await state.snapshot(), get = measured(state.counters), getTrace = state.counters.trace.slice();
  assert.equal(initial.scope.kind, "project");
  assert.equal(initial.scope.organizationId, state.organizationId);
  assert.equal(initial.scope.projectAccessId, state.projectAccessId);
  assert.equal(initial.summary.required_targets, count);
  assert.equal(initial.summary.fulfilled_targets, count);
  assert.equal(initial.summary.completion, "complete");
  assert.equal(initial.confirmedPlan.plan.targets.length, count);
  assert.equal(initial.grants[0].operations.length, count);
  assert.ok(initial.results.every((result) => result.review === "approved" && (actingReviewer ? result.reviewAllowed && !result.independentReviewBlocked : !result.reviewAllowed && result.independentReviewBlocked)), "the selected principal's real review capability and independent contribution check both apply");
  if (actingReviewer) { assert.equal(initial.scope.actorUserId, state.reviewer); assert.equal(initial.permissions.canAuthor, false); assert.equal(initial.permissions.canRequest, false); assert.equal(initial.permissions.canReview, true); }
  assert.equal(get.r2List, 8);
  assert.equal(get.r2Head, 4);
  assert.equal(get.r2Get, 0);
  state.counters.reset();
  const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  assert.equal(prepared.status, 200, await prepared.clone().text());
  const exported = await prepared.json(), prepare = measured(state.counters), prepareTrace = state.counters.trace.slice();
  assert.equal(exported.command.partCount, Math.ceil(count / 16));
  assert.equal(exported.snapshot.summary.required_targets, count);
  assert.equal(exported.snapshot.summary.completion, "complete");
  assert.equal(prepare.r2Get, 0);
  state.counters.reset();
  const downloaded = await state.send(exported.command.downloadUrls[0]);
  assert.equal(downloaded.status, 200, await downloaded.clone().text());
  const part = measured(state.counters), partTrace = state.counters.trace.slice();
  assert.equal(part.r2List, 8);
  assert.equal(part.r2Head, 4);
  assert.equal(part.r2Get, 16);
  const files = readStoredZip(new Uint8Array(await downloaded.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
  assert.equal(manifest.scope.targets.length, count);
  assert.equal(manifest.targets.length, count);
  assert.equal(manifest.packagePart.count, Math.ceil(count / 16));
  assert.equal(manifest.packagePart.index, 1);
  console.log(JSON.stringify({ profile: actingReviewer ? "governed-reviewer" : "governed-owner", count, extractedSources: 4, catalogPagesPerRead: 8, get, prepare, part }));
  for (const [name, meter, trace] of [["get", get, getTrace], ["prepare", prepare, prepareTrace], ["part", part, partTrace]]) {
    if (meter.total > 50) console.log(JSON.stringify({ overBudget: name, count, dbTrace: trace.map((binding) => ({ kind: binding.kind, statements: binding.statements.map((sql) => sql.slice(0, 240)) })) }));
    assert.ok(meter.total <= 50, `${name} consumed ${meter.total} binding calls for the complete governed profile`);
  }
});

test("a governed Document never falls back to the owner's account when its selected context is missing", async (t) => {
  const state = await outputReadModelFixture(65, { shared: true, sourceReferences: 4, pageSize: 9 });
  t.after(() => state.sqlite.close());
  for (const identity of [{ id: owner, email: "creative@local.forma", status: 403 }, { id: state.reviewer, email: "reviewer@local.forma", status: 404 }]) {
    state.counters.reset();
    const response = await handleOutputRequirements(new Request(`http://localhost/api/output-requirements?documentId=${doc}`, { headers: { "oai-authenticated-user-id": identity.id, "oai-authenticated-user-email": identity.email } }), state.env, "/api/output-requirements", { waitUntil() { throw new Error("unexpected_background_dispatch"); } });
    assert.equal(response.status, identity.status, await response.clone().text());
    assert.equal(state.counters.r2List, 0);
    assert.equal(state.counters.r2Head, 0);
    assert.equal(state.counters.r2Get, 0);
  }
});

test("governed source snapshots reject stale/quarantined projections without repairing them", async (t) => {
  for (const mode of ["stale", "quarantined"]) {
    const state = await outputReadModelFixture(65, { shared: true, sourceReferences: 4, pageSize: 9 });
    t.after(() => state.sqlite.close());
    if (mode === "stale") state.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=0 WHERE project_access_id=?").run(state.projectAccessId);
    else state.sqlite.prepare("UPDATE project_migration_states SET status='disabled' WHERE project_access_id=?").run(state.projectAccessId);
    const before = state.sqlite.prepare("SELECT * FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId);
    state.counters.reset();
    const response = await state.send();
    assert.ok([403, 409].includes(response.status), `${mode}: ${await response.clone().text()}`);
    assert.equal(state.counters.r2List, 0);
    assert.equal(state.counters.r2Head, 0);
    assert.equal(state.counters.r2Get, 0);
    assert.deepEqual(state.sqlite.prepare("SELECT * FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId), before);
    assert.equal(state.counters.trace.some((binding) => binding.statements.some((sql) => /^(?:UPDATE|INSERT) project_migration_states/u.test(sql))), false);
  }
});

test("governed part release still fences late membership, projection, private evidence and source-rights changes", async (t) => {
  for (const mode of ["membership", "projection", "private", "source-rights"]) {
    const state = await outputReadModelFixture(65, { shared: true, sourceReferences: 4, pageSize: 9 });
    t.after(() => state.sqlite.close());
    const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
    assert.equal(prepared.status, 200, await prepared.clone().text());
    const exported = await prepared.json(), last = state.assets.at(-1), originalGet = state.env.MEDIA.get;
    let changed = false;
    state.env.MEDIA.get = async (...args) => {
      const object = await originalGet(...args);
      if (!changed) {
        changed = true;
        if (mode === "membership") state.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(), state.organizationId, owner);
        else if (mode === "projection") state.sqlite.prepare("UPDATE project_migration_states SET status='disabled' WHERE project_access_id=?").run(state.projectAccessId);
        else if (mode === "private") state.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), last.created.eventId);
        else await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "shared-meter", "rights-withdrawal", "RightsAsserted", { project_id: project, document_id: doc, reference_id: "owned-reference-0", rights_class: "unknown" })]);
      }
      return object;
    };
    state.counters.reset();
    const response = await state.send(exported.command.downloadUrls[0]);
    assert.ok([403, 409, 410].includes(response.status), `${mode}: ${await response.clone().text()}`);
    assert.notEqual(response.headers.get("content-type"), "application/zip", mode);
    assert.equal(state.counters.r2List, 8, mode);
    assert.equal(state.counters.r2Head, 4, mode);
    assert.ok(state.counters.r2Get <= 16, mode);
    assert.ok(state.counters.total <= 50, `${mode}: ${state.counters.total}`);
  }
});

test("governed download rejects a missing or changed accepted member in another part before reading any output bytes", async (t) => {
  for (const mode of ["missing", "identity", "private"]) {
    const state = await outputReadModelFixture(65, { shared: true, sourceReferences: 4, pageSize: 9 });
    t.after(() => state.sqlite.close());
    const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
    assert.equal(prepared.status, 200, await prepared.clone().text());
    const exported = await prepared.json(), last = state.assets.at(-1);
    if (mode === "missing") state.media.delete(last.key);
    else if (mode === "identity") state.media.get(last.key).metadata.projectId = "not-this-project";
    else state.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), last.accepted.eventId);
    state.counters.reset();
    const response = await state.send(exported.command.downloadUrls[0]);
    assert.ok([404, 409, 410].includes(response.status), `${mode}: ${await response.clone().text()}`);
    assert.equal(state.counters.r2Get, 0);
    assert.ok(state.counters.total <= 50);
  }
});
