import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

const file = new URL("./document-duplication-api.test.mjs", import.meta.url), raw = fs.readFileSync(file, "utf8");
const first = 'test("server-owned copy commits all 100 rich decisions and exactly 512 events in every supported custody mode"';
assert.equal(raw.split(first).length, 2);
const url = new URL(file); url.search = "copy-recovery-protocol";
const hook = registerHooks({ load(specifier, context, next) {
  return specifier === url.href ? { format: "module", shortCircuit: true,
    source: raw.slice(0, raw.indexOf(first)) + "\nexport { fixture, operation, preview, confirm, counts, scope };\n" } : next(specifier, context);
} });
const { fixture, operation, preview, confirm, counts, scope } = await import(url.href).finally(() => hook.deregister());
const modes = ["personal", "migrated", "shared", "editor"];
const row = (state, id) => state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(id);
const finance = state => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters",
  "consequential_executions", "consequential_execution_steps"].map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const discard = proposed => ({ ...confirm(proposed, "dismiss"), operationId: proposed.duplication.operationId, onlyIfUnapplied: true });
const expire = (state, id) => state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?")
  .run(new Date(Date.now() - 1_000).toISOString(), id);
async function erase(state, id) {
  expire(state, id); await preview(state, operation({ title: "Separate explicit retention cleanup" }));
  assert.equal(row(state, id).content, ""); assert.ok(row(state, id).redacted_at);
}
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
const noPrivate = body => { assert.equal(body.preview, undefined); assert.equal(JSON.stringify(body).includes("PRIVATE_SOURCE_"), false); };
const assertIdentity = (body, proposed) => {
  assert.equal(body.previewId, proposed.previewId); assert.equal(body.approvalHash, proposed.approvalHash);
  assert.equal(body.operationId, proposed.duplication.operationId);
};

for (const mode of modes) for (const lifecycle of ["review", "expired", "dismissed", "committed", "erased", "missing", "active-lease", "expired-lease"])
test("copy guarded Discard truthfully adjudicates " + lifecycle + ": " + mode, async () => {
  const state = await fixture({ mode }), release = deferred(), entered = deferred(); let applying;
  try {
    const proposed = await preview(state), original = row(state, proposed.previewId); let receipt;
    if (lifecycle === "expired") expire(state, proposed.previewId);
    if (lifecycle === "dismissed") assert.equal((await state.copy(confirm(proposed, "dismiss"))).status, 200);
    if (lifecycle === "committed") {
      const response = await state.copy(confirm(proposed)); receipt = await response.json(); assert.equal(response.status, 200);
    }
    if (lifecycle === "erased") await erase(state, proposed.previewId);
    if (lifecycle === "missing") state.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(proposed.previewId);
    if (lifecycle.endsWith("lease")) {
      state.controls.afterClaim = async () => { entered.resolve(); await release.promise; };
      applying = state.copy(confirm(proposed)); await entered.promise;
      if (lifecycle === "expired-lease") state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.leaseExpiresAt',?) WHERE content_id=?")
        .run(new Date(Date.now() - 1_000).toISOString(), proposed.previewId);
    }
    const retained = row(state, proposed.previewId), before = counts(state), beforeFinance = finance(state);
    const response = await state.copy(discard(proposed)), body = await response.json(); noPrivate(body);
    assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
    if (retained) assert.equal(row(state, proposed.previewId).expires_at, retained.expires_at, "Discard never extends private retention");
    if (["review", "expired", "dismissed"].includes(lifecycle)) {
      assert.equal(response.status, 200); assert.equal(body.status, "dismissed"); assertIdentity(body, proposed);
      assert.equal(JSON.parse(row(state, proposed.previewId).content).state, "dismissed");
      const old = await state.copy(confirm(proposed)); assert.equal(old.status, lifecycle === "expired" ? 403 : 409); assert.deepEqual(counts(state), before);
    } else if (lifecycle === "committed") {
      assert.equal(response.status, 200); assert.equal(body.status, "applied"); assert.equal(body.idempotent, true); assertIdentity(body, proposed);
      assert.equal(body.documentId, receipt.documentId); assert.equal(body.dismissed, undefined);
      assert.equal(JSON.parse(state.sqlite.prepare("SELECT result_json FROM authoring_commits WHERE preview_id=?").get(proposed.previewId).result_json).dismissed, undefined);
    } else if (lifecycle.endsWith("lease")) {
      assert.equal(response.status, 202); assert.equal(body.status, "applying"); assertIdentity(body, proposed);
      assert.deepEqual(row(state, proposed.previewId), retained, "guarded Discard neither cancels nor releases a live or expired Apply lease");
      release.resolve(); const applyResponse = await applying; applying = null; const result = await applyResponse.json();
      if (lifecycle === "active-lease") { assert.equal(applyResponse.status, 200); assert.equal(result.status, "applied"); }
      else { assert.notEqual(applyResponse.status, 200); assert.notEqual(result.status, "applied"); assert.deepEqual(counts(state), before); }
    } else {
      assert.equal(response.status, 403); assert.equal(body.status, undefined);
      assert.deepEqual(row(state, proposed.previewId), retained);
    }
    if (lifecycle === "review") assert.equal(row(state, proposed.previewId).expires_at, original.expires_at);
  } finally { release.resolve(); if (applying) await applying; await state.close(); }
});

for (const mode of modes) for (const winner of ["apply", "discard"])
test("copy guarded Discard and a separately invoked Apply have one transactional winner: " + mode + "/" + winner, async () => {
  const state = await fixture({ mode }), batch = state.env.DB.batch.bind(state.env.DB); let once = false, other;
  try {
    const proposed = await preview(state), before = counts(state), beforeFinance = finance(state);
    state.env.DB.batch = async statements => {
      const selected = !once && statements.length === 2 && statements[0].sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','dismissed')");
      if (!selected) return batch(statements); once = true;
      if (winner === "apply") { const response = await state.copy(confirm(proposed)); other = { status: response.status, body: await response.json() }; }
      const result = await batch(statements);
      if (winner === "discard") { const response = await state.copy(confirm(proposed)); other = { status: response.status, body: await response.json() }; }
      return result;
    };
    const response = await state.copy(discard(proposed)), body = await response.json();
    assert.equal(once, true); assert.equal(response.status, 200); assertIdentity(body, proposed); noPrivate(body);
    if (winner === "apply") {
      assert.equal(other.status, 200); assert.equal(body.status, "applied"); assert.equal(body.documentId, other.body.documentId);
      assert.equal(counts(state).events - before.events, proposed.events.length); assert.equal(counts(state).receipts - before.receipts, 1);
    } else { assert.equal(body.status, "dismissed"); assert.equal(other.status, 409); assert.notEqual(other.body.status, "applied"); assert.deepEqual(counts(state), before); }
    assert.deepEqual(finance(state), beforeFinance);
  } finally { state.env.DB.batch = batch; await state.close(); }
});

for (const mode of modes) for (const fault of ["authority", "custody", "bytes", "erasure"])
test("copy guarded Discard rechecks the complete current row at its transaction: " + mode + "/" + fault, async () => {
  const state = await fixture({ mode }), batch = state.env.DB.batch.bind(state.env.DB); let once = false;
  try {
    const proposed = await preview(state), before = counts(state), beforeFinance = finance(state);
    state.env.DB.batch = async statements => {
      if (!once && statements.length === 2 && statements[0].sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','dismissed')")) {
        once = true;
        if (fault === "authority") state.sqlite.prepare("UPDATE users SET updated_at=updated_at||'-withdrawn' WHERE user_id=?").run(state.headers["oai-authenticated-user-id"] ?? state.ownerId);
        else if (fault === "bytes") state.sqlite.prepare("UPDATE private_content SET content=content||char(10) WHERE content_id=?").run(proposed.previewId);
        else if (fault === "erasure") state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), proposed.previewId);
        else if (state.projectAccessId) state.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='defensive-other-actor' WHERE resource_kind='content' AND resource_id=?").run(proposed.previewId);
        else state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'content',?,?,?,?, 'actor_private',NULL,?,?)")
          .run("defensive-other-project", proposed.previewId, "defensive-other-organization", scope.projectId, state.ownerId, state.ownerId, new Date().toISOString());
      }
      return batch(statements);
    };
    const response = await state.copy(discard(proposed)), body = await response.json();
    assert.equal(once, true); assert.equal(response.status, 403); assert.equal(body.status, undefined); noPrivate(body);
    assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
    if (fault !== "erasure") assert.equal(JSON.parse(row(state, proposed.previewId).content).state, "review");
  } finally { state.env.DB.batch = batch; await state.close(); }
});

for (const mode of modes) for (const scenario of ["requested", "saved-original", "raced-original", "committed", "lost-response", "erased", "expired", "dismissed"])
test("copy explicit revise preserves the same original operation: " + mode + "/" + scenario, async () => {
  const state = await fixture({ mode }), batch = state.env.DB.batch.bind(state.env.DB), release = deferred(), entered = deferred(); let pending;
  try {
    const initial = operation({ title: "Original human title", collectionId: null });
    const candidate = { ...initial, action: "revise", title: "New human candidate", collectionId: "duplicate-folder" };
    let original, receipt, once = false;
    if (scenario === "requested") {
      const failed = await state.copy({ ...initial, collectionId: "missing-user-folder" }), body = await failed.json();
      assert.equal(failed.status, 409); assert.equal(body.error, "document_duplicate_folder_unavailable"); assert.equal(body.preview, undefined);
    } else if (scenario === "raced-original") {
      state.env.DB.batch = async statements => {
        if (!once && statements.some(statement => /^INSERT INTO private_content\s*\(/u.test(statement.sql))) { once = true; entered.resolve(); await release.promise; }
        return batch(statements);
      };
      pending = state.copy(candidate); await entered.promise; original = await preview(state, initial);
    } else {
      original = await preview(state, initial);
      const ordinaryMismatch = await state.copy({ ...candidate, action: "preview" });
      assert.equal(ordinaryMismatch.status, 409); assert.equal((await ordinaryMismatch.json()).error, "document_duplicate_intent_changed");
      if (scenario === "committed") { const response = await state.copy(confirm(original)); receipt = await response.json(); assert.equal(response.status, 200); }
      if (scenario === "erased") await erase(state, original.previewId);
      if (scenario === "expired") expire(state, original.previewId);
      if (scenario === "dismissed") assert.equal((await state.copy(confirm(original, "dismiss"))).status, 200);
    }
    const before = counts(state), beforeFinance = finance(state), existing = state.sqlite.prepare("SELECT content_id FROM private_content WHERE kind='authoring-preview' ORDER BY content_id").all();
    release.resolve(); const response = pending ? await pending : await state.copy(candidate); pending = null; const body = await response.json();
    assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
    if (["erased", "expired", "dismissed"].includes(scenario)) {
      assert.equal(response.status, scenario === "dismissed" ? 409 : 403); assert.equal(body.preview, undefined);
      assert.deepEqual(state.sqlite.prepare("SELECT content_id FROM private_content WHERE kind='authoring-preview' ORDER BY content_id").all(), existing);
      assert.notEqual((await state.copy(confirm(original))).status, 200);
    } else if (scenario === "committed") {
      assert.equal(response.status, 200); assert.equal(body.status, "applied"); assert.equal(body.reviewDisposition, "saved-original");
      assertIdentity(body, original); assert.equal(body.documentId, receipt.documentId);
    } else {
      assert.equal(response.status, 200); assert.equal(body.status, "not-applied");
      assert.equal(body.preview.duplication.operationId, initial.operationId);
      assert.equal(body.reviewDisposition, scenario === "requested" ? "requested" : "saved-original");
      if (scenario === "requested") { assert.equal(body.preview.duplication.title, candidate.title); assert.equal(body.preview.duplication.collectionId, candidate.collectionId); }
      else assert.deepEqual(body.preview, original, "the canonical winning plan, not the edited candidate, is shown for a fresh human decision");
      if (scenario === "lost-response") {
        const check = await state.copy({ action: "resume", operationId: initial.operationId }), recovered = await check.json();
        assert.equal(check.status, 200); assert.deepEqual(recovered.preview, body.preview);
      }
      const applied = await state.copy(confirm(body.preview)), result = await applied.json();
      assert.equal(applied.status, 200); assert.equal(result.status, "applied"); assertIdentity(result, body.preview);
      assert.equal(counts(state).events - before.events, body.preview.events.length); assert.equal(counts(state).receipts - before.receipts, 1);
      const again = await state.copy(candidate), recovered = await again.json(); assert.equal(again.status, 200); assert.equal(recovered.status, "applied");
      assert.equal(recovered.documentId, result.documentId); assert.equal(counts(state).receipts - before.receipts, 1);
    }
  } finally { release.resolve(); if (pending) await pending; state.env.DB.batch = batch; await state.close(); }
});

test("copy recovery wire refuses malformed, foreign and client-authoring claims without an unused receipt", async () => {
  const state = await fixture();
  try {
    const proposed = await preview(state), before = counts(state), retained = row(state, proposed.previewId);
    const requests = [
      { ...discard(proposed), operationId: crypto.randomUUID() },
      { ...discard(proposed), approvalHash: "f".repeat(64) },
      { ...discard(proposed), onlyIfUnapplied: false },
      { ...discard(proposed), onlyIfUnapplied: "true" },
      { ...discard(proposed), operationId: null },
      { ...operation({ action: "revise" }), events: [] },
      { ...operation({ action: "revise" }), previewId: proposed.previewId },
      { ...operation({ action: "revise" }), operationId: "invalid" },
    ];
    for (const request of requests) {
      const response = await state.copy(request), body = await response.json();
      assert.ok([400, 409].includes(response.status), JSON.stringify(body)); assert.notEqual(body.status, "dismissed"); assert.notEqual(body.status, "applied");
      assert.equal(body.preview, undefined); assert.deepEqual(counts(state), before); assert.deepEqual(row(state, proposed.previewId), retained);
    }
  } finally { await state.close(); }
});
