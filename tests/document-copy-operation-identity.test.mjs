import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

const file = new URL("./document-duplication-api.test.mjs", import.meta.url), raw = fs.readFileSync(file, "utf8");
const first = 'test("server-owned copy commits all 100 rich decisions and exactly 512 events in every supported custody mode"';
assert.equal(raw.split(first).length, 2);
const url = new URL(file); url.search = "copy-operation-identity";
const hook = registerHooks({ load(specifier, context, next) {
  return specifier === url.href ? { format: "module", shortCircuit: true,
    source: raw.slice(0, raw.indexOf(first)) + "\nexport { fixture, operation, preview, confirm, counts, consent, scope };\n" } : next(specifier, context);
} });
const { fixture, operation, preview, confirm, counts, consent, scope } = await import(url.href).finally(() => hook.deregister());
const [policy, authoring] = await Promise.all([import("../worker/pilot-policy.ts"), import("../worker/authoring-commits.ts")]);
const modes = ["personal", "migrated", "shared", "editor"];
const actor = state => state.headers["oai-authenticated-user-id"] ?? state.ownerId;
const custody = state => state.projectAccessId ? { organizationId: state.organizationId, projectAccessId: state.projectAccessId,
  projectId: scope.projectId, ownerUserId: state.ownerId, actorUserId: actor(state) } : undefined;
const rows = state => state.sqlite.prepare("SELECT * FROM private_content WHERE kind='authoring-preview' ORDER BY content_id").all();
const row = (state, id) => state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(id);
const finance = state => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters",
  "consequential_executions", "consequential_execution_steps"].map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const expire = (state, id) => state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?")
  .run(new Date(Date.now() - 1_000).toISOString(), id);
async function eraseThroughNormalRetention(state, id) {
  expire(state, id);
  await preview(state, operation({ title: "Separate explicit cleanup trigger" }));
  assert.equal(row(state, id).content, ""); assert.ok(row(state, id).redacted_at);
}

test("copy identity is domain-separated actor plus operation, never private title or destination", async () => {
  const operationId = crypto.randomUUID();
  const first = await authoring.documentCopyPreviewId("current-actor", operationId);
  assert.equal(first, "copy-preview-" + await consent.consentHash({ domain: "forma:document-copy-private-preview:v1", actorUserId: "current-actor", operationId }));
  assert.equal(first, await authoring.documentCopyPreviewId("current-actor", operationId));
  assert.notEqual(first, await authoring.documentCopyPreviewId("other-actor", operationId));
  assert.notEqual(first, await authoring.documentCopyPreviewId("current-actor", crypto.randomUUID()));
  assert.match(first, /^copy-preview-[a-f0-9]{64}$/u);
  await assert.rejects(() => authoring.documentCopyPreviewId("current-actor", "invalid"), /document_duplicate_intent_required/u);
});

for (const mode of modes) for (const lifecycle of ["first", "raced", "erased", "expired", "dismissed", "applied"])
test("copy identity keeps one original across " + lifecycle + ": " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const request = operation(), expected = await authoring.documentCopyPreviewId(actor(state), request.operationId);
    let proposed;
    if (lifecycle === "raced") {
      const responses = await Promise.all([state.copy(request), state.copy(request)]), bodies = await Promise.all(responses.map(value => value.json()));
      assert.ok(responses.every(value => value.status === 200));
      assert.deepEqual(bodies[0].preview, bodies[1].preview); proposed = bodies[0].preview;
    } else proposed = await preview(state, request);
    assert.equal(proposed.previewId, expected); assert.equal(rows(state).length, 1);
    assert.equal(JSON.stringify(rows(state)).includes(request.operationId), true, "the retained private plan remains the original complete evidence");
    let canonical;
    if (lifecycle === "erased") await eraseThroughNormalRetention(state, expected);
    if (lifecycle === "expired") expire(state, expected);
    if (lifecycle === "dismissed") {
      const response = await state.copy(confirm(proposed, "dismiss")); assert.equal(response.status, 200);
    }
    if (lifecycle === "applied") {
      const response = await state.copy(confirm(proposed)); canonical = await response.json(); assert.equal(response.status, 200);
      await eraseThroughNormalRetention(state, expected);
    }
    const before = counts(state), beforeFinance = finance(state), beforeRows = rows(state);
    const response = await state.copy(request), body = await response.json();
    assert.deepEqual(rows(state), beforeRows); assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
    if (["first", "raced"].includes(lifecycle)) {
      assert.equal(response.status, 200); assert.deepEqual(body.preview, proposed);
    } else if (lifecycle === "applied") {
      assert.equal(response.status, 200); assert.equal(body.status, "applied"); assert.equal(body.idempotent, true);
      assert.equal(body.previewId, expected); assert.equal(body.operationId, request.operationId); assert.equal(body.documentId, canonical.documentId);
      assert.equal(body.preview, undefined);
    } else {
      assert.equal(response.status, lifecycle === "dismissed" ? 409 : 403); assert.equal(body.preview, undefined);
      const oldApply = await state.copy(confirm(proposed)); assert.notEqual(oldApply.status, 200);
      assert.deepEqual(counts(state), before); assert.deepEqual(rows(state), beforeRows);
      const recovered = await state.copy({ action: "resume", operationId: request.operationId }), recoveredBody = await recovered.json();
      assert.notEqual(recovered.status, 200); assert.notEqual(recoveredBody.status, "none", "erased metadata still identifies the original unavailable operation");
    }
  } finally { await state.close(); }
});

for (const mode of modes) test("copy identity does not alter default private storage, retention, custody or publication: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const before = counts(state), beforeFinance = finance(state), scope = custody(state), owner = actor(state);
    const prepared = await policy.preparePrivateContent(state.env, owner, "context-proposal", "default private evidence", scope);
    assert.match(prepared.contentId, /^[a-f0-9-]{36}$/u); assert.equal(row(state, prepared.contentId), undefined);
    const committed = await state.env.DB.batch(prepared.statements);
    assert.ok(committed.slice(0, prepared.requiredInserts).every(result => Number(result.meta.changes) === 1));
    assert.equal(row(state, prepared.contentId).content, "default private evidence");
    let published;
    const stored = await policy.storePrivateContent(state.env, owner, "context-proposal", "default private evidence", scope, { sql: "1", bindings: [] }, captured => {
      published = captured; return [state.env.DB.prepare("UPDATE private_content SET content=content WHERE content_id=? AND owner_id=?").bind(captured.contentId, owner)];
    });
    assert.match(stored.contentId, /^[a-f0-9-]{36}$/u); assert.notEqual(stored.contentId, prepared.contentId);
    assert.deepEqual(stored, published); assert.equal(row(state, stored.contentId).content, "default private evidence");
    assert.equal(row(state, stored.contentId).expires_at, stored.expiresAt); assert.equal(row(state, stored.contentId).redacted_at, null);
    if (scope) {
      const resource = state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(stored.contentId);
      assert.equal(resource.actor_user_id, owner); assert.equal(resource.visibility, "actor_private");
      const retention = state.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(stored.contentId);
      assert.equal(retention.classification, "governed-evidence"); assert.equal(retention.assigned_expires_at, stored.expiresAt);
    }
    const count = state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n;
    await assert.rejects(() => policy.storePrivateContent(state.env, owner, "context-proposal", "guarded refusal", scope, { sql: "0", bindings: [] }), /project_private_content_access_revoked/u);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n, count);
    assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
  } finally { await state.close(); }
});

for (const mode of modes) test("copy identity seam is server-only and never overwrites an occupied primary key: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const owner = actor(state), scope = custody(state), identity = { contentId: await authoring.documentCopyPreviewId(owner, crypto.randomUUID()) };
    for (const kind of ["context-proposal", "prompt"]) await assert.rejects(() =>
      policy.storePrivateContent(state.env, owner, kind, "not a copy preview", scope, undefined, undefined, identity), /private_content_identity_invalid/u);
    await assert.rejects(() => policy.storePrivateContent(state.env, owner, "authoring-preview", "invalid", scope, undefined, undefined, { contentId: "client-supplied" }), /private_content_identity_invalid/u);
    const saved = await policy.storePrivateContent(state.env, owner, "authoring-preview", "original opaque body", scope, undefined, undefined, identity);
    const before = row(state, saved.contentId);
    await assert.rejects(() => policy.storePrivateContent(state.env, owner, "authoring-preview", "replacement body", scope, undefined, undefined, identity), /UNIQUE constraint/u);
    assert.deepEqual(row(state, saved.contentId), before);
  } finally { await state.close(); }
});

for (const mode of modes) test("copy identity explicitly qualifies already-erased legacy random IDs: " + mode, async t => {
  const state = await fixture({ mode });
  try {
    const request = operation(), proposed = await preview(state, request), legacyId = crypto.randomUUID();
    // Named legacy fixture: the pre-upgrade implementation allocated a random row ID.
    // The plan/hash remain exact. This is not an invented server receipt or migration.
    state.sqlite.prepare("UPDATE private_content SET content_id=? WHERE content_id=?").run(legacyId, proposed.previewId);
    state.sqlite.prepare("UPDATE project_resource_scopes SET resource_id=? WHERE resource_kind='content' AND resource_id=?").run(legacyId, proposed.previewId);
    state.sqlite.prepare("UPDATE private_content_retention_scopes SET content_id=? WHERE content_id=?").run(legacyId, proposed.previewId);
    const retained = await state.copy(request), retainedBody = await retained.json();
    assert.equal(retained.status, 200); assert.equal(retainedBody.preview.previewId, legacyId);
    await eraseThroughNormalRetention(state, legacyId);
    const before = counts(state), resumed = await state.copy({ action: "resume", operationId: request.operationId }), resumeBody = await resumed.json();
    assert.equal(resumed.status, 200); assert.equal(resumeBody.status, "none", "already-erased legacy random IDs cannot be mapped retrospectively");
    const oldApply = await state.copy({ ...confirm(proposed), previewId: legacyId }); assert.equal(oldApply.status, 403);
    const fresh = await state.copy(request), freshBody = await fresh.json();
    assert.equal(fresh.status, 200); assert.notEqual(freshBody.preview.previewId, legacyId);
    assert.equal(freshBody.preview.previewId, proposed.previewId); assert.deepEqual(counts(state), before);
    t.diagnostic("LEGACY_COPY_ID_LIMITATION " + JSON.stringify({ mode, erasedLegacyResume: "none", explicitRetryCanCreateProspectiveReview: true, oldApply: 403, canonicalEventsAdded: 0, copyReceipts: 0 }));
  } finally { await state.close(); }
});

for (const mode of modes) test("copy identity prevents a held Apply and an erased operation from creating a copy: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const request = operation(), proposed = await preview(state, request), before = counts(state);
    state.controls.afterClaim = async () => { await eraseThroughNormalRetention(state, proposed.previewId); };
    const applied = await state.copy(confirm(proposed)), body = await applied.json();
    assert.notEqual(applied.status, 200); assert.notEqual(body.status, "applied");
    assert.equal(row(state, proposed.previewId).content, "");
    const retried = await state.copy(request); assert.equal(retried.status, 403);
    assert.deepEqual(counts(state), before);
  } finally { await state.close(); }
});

for (const mode of modes) test("copy identity fences a delayed older preview insert after its winning review is erased: " + mode, async () => {
  const state = await fixture({ mode }), batch = state.env.DB.batch.bind(state.env.DB);
  let release; const gate = new Promise(resolve => { release = resolve; });
  let entered; const waiting = new Promise(resolve => { entered = resolve; }); let held = false;
  try {
    const request = operation(), before = counts(state);
    state.env.DB.batch = async statements => {
      if (!held && statements.some(statement => /^INSERT INTO private_content\s*\(/u.test(statement.sql))) {
        held = true; entered(); await gate;
      }
      return batch(statements);
    };
    const old = state.copy(request); await waiting;
    const winner = await preview(state, request); await eraseThroughNormalRetention(state, winner.previewId);
    const beforeRows = rows(state); release();
    const oldResponse = await old, oldBody = await oldResponse.json();
    assert.equal(oldResponse.status, 403); assert.equal(oldBody.preview, undefined);
    assert.deepEqual(rows(state), beforeRows); assert.deepEqual(counts(state), before);
  } finally { release(); state.env.DB.batch = batch; await state.close(); }
});
