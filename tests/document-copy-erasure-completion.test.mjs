import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

const file = new URL("./document-duplication-api.test.mjs", import.meta.url), raw = fs.readFileSync(file, "utf8");
const first = 'test("server-owned copy commits all 100 rich decisions and exactly 512 events in every supported custody mode"';
assert.equal(raw.split(first).length, 2);
const url = new URL(file); url.search = "copy-erasure-completion";
const hook = registerHooks({ load(specifier, context, next) {
  return specifier === url.href ? { format: "module", shortCircuit: true,
    source: raw.slice(0, raw.indexOf(first)) + "\nexport { fixture, operation, preview, confirm, counts, scope };\n" } : next(specifier, context);
} });
const { fixture, operation, preview, confirm, counts, scope } = await import(url.href).finally(() => hook.deregister());
const modes = ["personal", "migrated", "shared", "editor"];
const row = (state, id) => state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(id);
const actor = state => state.headers["oai-authenticated-user-id"] ?? state.ownerId;
const finance = state => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters",
  "consequential_executions", "consequential_execution_steps"].map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const check = (proposed, known = false) => ({ action: "resume", operationId: proposed.duplication.operationId, includeRetirement: true,
  ...(known ? { previewId: proposed.previewId, approvalHash: proposed.approvalHash } : {}) });
const noPrivate = body => { assert.equal(body.preview, undefined); assert.equal(JSON.stringify(body).includes("PRIVATE_SOURCE_"), false); };
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
async function erase(state, id) {
  state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(new Date(Date.now() - 1_000).toISOString(), id);
  await preview(state, operation({ title: "Separate human retention cleanup" }));
  assert.equal(row(state, id).content, ""); assert.ok(row(state, id).redacted_at);
}
function assertRetired(body, proposed, state, requestScope = scope) {
  assert.deepEqual(body, { status: "retired", previewId: proposed.previewId, operationId: proposed.duplication.operationId,
    retirement: { version: "document-copy-erased-operation-v1", meaning: "globally-erased-unapplied", scope: "authorized-request",
      ...requestScope, actorUserId: actor(state) } });
  noPrivate(body); assert.equal(body.approvalHash, undefined); assert.equal(body.documentId, undefined);
}

for (const mode of modes) for (const known of [false, true])
test("copy erasure completion is an explicit content-free read and keeps every old operation fenced: " + mode + "/" + known, async () => {
  const state = await fixture({ mode });
  try {
    const initial = operation(), proposed = await preview(state, initial); await erase(state, proposed.previewId);
    const unflagged = await state.copy({ action: "resume", operationId: initial.operationId });
    assert.equal(unflagged.status, 403, "the earlier unflagged recovery contract is unchanged");
    const before = counts(state), beforeFinance = finance(state), retained = row(state, proposed.previewId);
    const changes = Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n);
    state.controls.maxBinds = 0; state.controls.maxSqlBytes = 0; state.controls.queries = 0; state.controls.queryLimit = 199;
    const response = await state.copy(check(proposed, known)), body = await response.json();
    assert.equal(response.status, 200); assertRetired(body, proposed, state);
    assert.equal(Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n), changes, "the certificate adds no durable write, including lease cleanup");
    assert.ok(state.controls.queries < 200); assert.ok(state.controls.maxBinds <= 100); assert.ok(state.controls.maxSqlBytes <= 100_000);
    state.controls.queryLimit = 0;
    assert.deepEqual(row(state, proposed.previewId), retained); assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
    for (const request of [initial, { ...initial, action: "revise", title: "New candidate under old operation" }, confirm(proposed)]) {
      const response = await state.copy(request), body = await response.json(); assert.equal(response.status, 403); assert.notEqual(body.status, "applied"); assert.equal(body.preview, undefined);
      assert.deepEqual(row(state, proposed.previewId), retained); assert.deepEqual(counts(state), before);
    }
    // Separate deliberate new intent, not a follow-up performed by the certificate path.
    const fresh = await preview(state, operation({ title: "Separate newly authored review" }));
    assert.notEqual(fresh.duplication.operationId, initial.operationId); assert.notEqual(fresh.previewId, proposed.previewId); assert.deepEqual(counts(state), before);
    const saved = await state.copy(confirm(fresh)), savedBody = await saved.json(); assert.equal(saved.status, 200); assert.equal(savedBody.status, "applied");
    assert.equal(counts(state).receipts - before.receipts, 1); assert.equal(counts(state).events - before.events, fresh.events.length);
    assert.deepEqual(row(state, proposed.previewId), retained); assert.deepEqual(finance(state), beforeFinance);
  } finally { state.controls.queryLimit = 0; await state.close(); }
});

for (const mode of modes) for (const condition of ["live", "unknown", "missing", "expired-unredacted", "empty-unredacted", "redacted-nonempty", "future-redaction"])
test("copy erasure completion never promotes ordinary unknown or incomplete erasure evidence: " + mode + "/" + condition, async () => {
  const state = await fixture({ mode });
  try {
    const proposed = await preview(state), request = check(proposed);
    if (condition === "unknown") request.operationId = crypto.randomUUID();
    if (condition === "missing") state.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(proposed.previewId);
    if (condition === "expired-unredacted") state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(new Date(Date.now() - 1_000).toISOString(), proposed.previewId);
    if (condition === "empty-unredacted") state.sqlite.prepare("UPDATE private_content SET content='' WHERE content_id=?").run(proposed.previewId);
    if (condition === "redacted-nonempty") state.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), proposed.previewId);
    if (condition === "future-redaction") state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date(Date.now() + 86_400_000).toISOString(), proposed.previewId);
    const before = counts(state), retained = row(state, proposed.previewId), beforeFinance = finance(state);
    const response = await state.copy(request), body = await response.json();
    assert.notEqual(body.status, "retired"); assert.equal(body.retirement, undefined); assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
    assert.deepEqual(row(state, proposed.previewId), retained);
    if (condition === "live") { assert.equal(response.status, 200); assert.equal(body.status, "not-applied"); assert.deepEqual(body.preview, proposed); }
    else if (["unknown", "missing"].includes(condition)) { assert.equal(response.status, 200); assert.equal(body.status, "none"); noPrivate(body); }
    else { assert.equal(response.status, 403); noPrivate(body); }
  } finally { await state.close(); }
});

for (const mode of modes) for (const fault of ["authority", "custody"])
test("copy erasure completion checks current authority and custody in the final snapshot: " + mode + "/" + fault, async () => {
  const state = await fixture({ mode }), prepare = state.env.DB.prepare.bind(state.env.DB); let entered = false;
  try {
    const proposed = await preview(state); await erase(state, proposed.previewId); const before = counts(state);
    state.env.DB.prepare = sql => {
      const statement = prepare(sql); if (!sql.includes("CASE WHEN EXISTS(SELECT 1 FROM private_content saved WHERE saved.content_id=requested.preview_id")) return statement;
      const bind = statement.bind;
      statement.bind = function(...values) { const bound = bind.apply(this, values), first = bound.first;
        bound.first = async function() {
          entered = true;
          if (fault === "authority") state.sqlite.prepare("UPDATE users SET updated_at=updated_at||'-withdrawn' WHERE user_id=?").run(actor(state));
          else if (state.projectAccessId) state.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='defensive-other-actor' WHERE resource_kind='content' AND resource_id=?").run(proposed.previewId);
          else state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'content',?,?,?,?, 'actor_private',NULL,?,?)")
            .run("defensive-other-project", proposed.previewId, "defensive-other-organization", scope.projectId, state.ownerId, state.ownerId, new Date().toISOString());
          return first.call(this);
        }; return bound; };
      return statement;
    };
    const response = await state.copy(check(proposed)), body = await response.json();
    assert.equal(entered, true); assert.equal(response.status, 403); assert.notEqual(body.status, "retired"); assert.equal(body.retirement, undefined);
    noPrivate(body); assert.deepEqual(counts(state), before);
  } finally { state.env.DB.prepare = prepare; await state.close(); }
});

for (const mode of modes) test("copy erasure completion blocks a scoped-out existing canonical receipt: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const otherDocument = "other-erasure-request-document";
    await state.seed([["DocumentCreated", { project_id: scope.projectId, document_id: otherDocument, title: "Other authorized source", handle: "other-source" }]]);
    const proposed = await preview(state), applied = await state.copy(confirm(proposed)), receipt = await applied.json();
    assert.equal(applied.status, 200); assert.equal(receipt.status, "applied"); await erase(state, proposed.previewId);
    const before = counts(state), scopedOut = await state.copy({ ...check(proposed), documentId: otherDocument }), body = await scopedOut.json();
    assert.equal(scopedOut.status, 403, "absence from the requested Document is not global receipt absence"); assert.notEqual(body.status, "retired"); assert.equal(body.retirement, undefined); noPrivate(body);
    const correct = await state.copy(check(proposed, true)), recovered = await correct.json();
    assert.equal(correct.status, 200); assert.equal(recovered.status, "applied"); assert.equal(recovered.previewId, proposed.previewId);
    assert.equal(recovered.operationId, proposed.duplication.operationId); assert.equal(recovered.documentId, receipt.documentId); assert.equal(recovered.retirement, undefined); noPrivate(recovered);
    assert.deepEqual(counts(state), before);
  } finally { await state.close(); }
});

for (const mode of modes) test("copy erasure completion labels current request scope, never lost historical Document provenance: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const target = { projectId: scope.projectId, documentId: "another-current-read-document" };
    await state.seed([["DocumentCreated", { project_id: target.projectId, document_id: target.documentId, title: "Current authorized document", handle: "current-authorized" }]]);
    const proposed = await preview(state); await erase(state, proposed.previewId); const before = counts(state);
    const response = await state.copy({ ...check(proposed), ...target }), body = await response.json();
    assert.equal(response.status, 200); assertRetired(body, proposed, state, target);
    assert.notEqual(body.retirement.documentId, scope.documentId); assert.deepEqual(counts(state), before);
    assert.equal((await state.copy(confirm(proposed))).status, 403);
  } finally { await state.close(); }
});

for (const mode of modes) test("copy erasure certificate fences an already-claimed original writer after the terminal snapshot: " + mode, async () => {
  const state = await fixture({ mode }), entered = deferred(), release = deferred(); let applying;
  try {
    const proposed = await preview(state), before = counts(state);
    state.controls.afterClaim = async () => { entered.resolve(); await release.promise; };
    applying = state.copy(confirm(proposed)); await entered.promise; await erase(state, proposed.previewId);
    const response = await state.copy(check(proposed, true)), body = await response.json();
    assert.equal(response.status, 200); assertRetired(body, proposed, state); assert.deepEqual(counts(state), before);
    const retained = row(state, proposed.previewId); release.resolve(); const old = await applying; applying = null; const oldBody = await old.json();
    assert.notEqual(old.status, 200); assert.notEqual(oldBody.status, "applied"); assert.deepEqual(counts(state), before); assert.deepEqual(row(state, proposed.previewId), retained);
  } finally { release.resolve(); if (applying) await applying; await state.close(); }
});

for (const mode of modes) test("copy retirement opt-in rejects malformed or mismatched known identity: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const proposed = await preview(state); await erase(state, proposed.previewId); const before = counts(state);
    const bodies = [
      { action: "resume", includeRetirement: true },
      { ...check(proposed), includeRetirement: false },
      { ...check(proposed), includeRetirement: "true" },
      { ...check(proposed), action: "retrieve" },
      { ...check(proposed), previewId: proposed.previewId },
      { ...check(proposed), approvalHash: proposed.approvalHash },
      { ...check(proposed, true), previewId: "copy-preview-" + "f".repeat(64) },
    ];
    for (const request of bodies) {
      const response = await state.copy(request), body = await response.json();
      assert.ok([400, 409, 428].includes(response.status)); assert.notEqual(body.status, "retired"); assert.equal(body.retirement, undefined); noPrivate(body);
      assert.deepEqual(counts(state), before);
    }
  } finally { await state.close(); }
});
