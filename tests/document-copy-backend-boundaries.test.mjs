import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

// Reuse the actual routed Worker/SQLite fixture; do not replace its assertions or production guards.
const fixturePath = new URL("./document-duplication-api.test.mjs", import.meta.url);
const fixtureSource = fs.readFileSync(fixturePath, "utf8");
const firstTest = 'test("server-owned copy commits all 100 rich decisions and exactly 512 events in every supported custody mode"';
assert.equal(fixtureSource.split(firstTest).length, 2);
const fixtureURL = new URL(fixturePath); fixtureURL.search = "copy-backend-boundaries";
const hook = registerHooks({ load(url, context, next) {
  return url === fixtureURL.href ? { format: "module", source: fixtureSource.slice(0, fixtureSource.indexOf(firstTest))
    + "\nexport { fixture, operation, preview, confirm, counts, copyProof, scope };\n", shortCircuit: true } : next(url, context);
} });
const { fixture, operation, preview, confirm, counts, copyProof, scope } =
  await import(fixtureURL.href).finally(() => hook.deregister());

const modes = ["personal", "migrated", "shared", "editor"];
const finance = state => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations",
  "cost_budget_counters", "consequential_executions", "consequential_execution_steps"].map(table =>
  [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const retainedRow = (state, id) => state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(id);
const privateReturned = body => Boolean(body.preview && JSON.stringify(body.preview).includes("PRIVATE_SOURCE_"));

// Erasure/redaction/expiry are retention boundaries. Owner/kind/byte/custody changes below
// are explicitly defensive SQL controls, not claims of a demonstrated user tampering route.
function mutateRetained(state, id, fault) {
  if (fault === "healthy") return;
  if (fault === "redacted") state.sqlite.prepare("UPDATE private_content SET redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_id=?").run(id);
  else if (fault === "missing") state.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(id);
  else if (fault === "content") state.sqlite.prepare("UPDATE private_content SET content=content||char(10) WHERE content_id=?").run(id);
  else if (fault === "owner") state.sqlite.prepare("UPDATE private_content SET owner_id='different-owner' WHERE content_id=?").run(id);
  else if (fault === "kind") state.sqlite.prepare("UPDATE private_content SET kind='not-authoring-preview' WHERE content_id=?").run(id);
  else if (fault === "expiry") state.sqlite.prepare("UPDATE private_content SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE content_id=?").run(id);
  else if (fault === "authority") state.sqlite.prepare("UPDATE users SET updated_at=updated_at||'-withdrawn' WHERE user_id=?").run(state.headers["oai-authenticated-user-id"] ?? state.ownerId);
  else if (fault === "custody") {
    if (state.projectAccessId) state.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='different-actor' WHERE resource_kind='content' AND resource_id=?").run(id);
    else state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'content',?,?,?,?, 'actor_private',NULL,?,?)")
      .run("defensive-foreign-project", id, "defensive-foreign-organization", scope.projectId, state.ownerId, state.ownerId, new Date().toISOString());
  } else throw new Error("unknown control " + fault);
}
function atDisclosure(state, stage, previewId, fault) {
  const prepare = state.env.DB.prepare.bind(state.env.DB), batch = state.env.DB.batch.bind(state.env.DB);
  let visits = 0, id = previewId, beforeRow = null;
  const change = selected => { if (visits) return; visits++; id = selected; beforeRow = retainedRow(state, id); assert.ok(beforeRow); mutateRetained(state, id, fault); };
  if (stage === "fresh") state.env.DB.batch = async statements => {
    const result = await batch(statements);
    const stored = state.sqlite.prepare("SELECT content_id FROM private_content WHERE kind='authoring-preview' ORDER BY rowid DESC LIMIT 1").get();
    if (stored) change(stored.content_id);
    return result;
  };
  else state.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (!/^SELECT saved\.content AS preview_content/u.test(sql)) return statement;
    const bind = statement.bind;
    statement.bind = function(...values) {
      const bound = bind.apply(this, values), first = bound.first;
      bound.first = async function() { const row = await first.call(this); if (row?.preview_content) change(previewId); return row; };
      return bound;
    };
    return statement;
  };
  return { get visits() { return visits; }, get id() { return id; }, get beforeRow() { return beforeRow; },
    restore() { state.env.DB.prepare = prepare; state.env.DB.batch = batch; } };
}

for (const mode of modes) for (const stage of ["fresh", "retained"])
for (const fault of ["healthy", "redacted", "missing", "content", "owner", "kind", "expiry", "custody"])
test("copy backend final disclosure " + mode + "/" + stage + "/" + fault, async () => {
  const state = await fixture({ mode });
  let boundary;
  try {
    const proposed = stage === "retained" ? await preview(state) : null;
    const before = counts(state), beforeFinance = finance(state);
    boundary = atDisclosure(state, stage, proposed?.previewId ?? "", fault);
    const result = await state.copy(proposed ? confirm(proposed, "retrieve") : operation()), body = await result.json();
    assert.equal(boundary.visits, 1, "the real retained row existed before the selected final-disclosure boundary");
    assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
    if (fault === "healthy") {
      assert.equal(result.status, 200); assert.equal(privateReturned(body), true);
      assert.equal(body.preview.previewId, boundary.id);
      assert.deepEqual(retainedRow(state, boundary.id), boundary.beforeRow);
    } else {
      assert.equal(result.status, 403); assert.equal(body.preview, undefined); assert.equal(privateReturned(body), false);
      assert.equal(body.status, undefined, "a denied read is not proof that an original operation is unused");
      if (fault === "missing") assert.equal(retainedRow(state, boundary.id), undefined);
      if (fault === "expiry") assert.ok(retainedRow(state, boundary.id).expires_at < boundary.beforeRow.expires_at);
      if (fault === "content") assert.equal(retainedRow(state, boundary.id).content, boundary.beforeRow.content + "\n");
    }
  } finally { boundary?.restore(); await state.close(); }
});

for (const mode of modes) test("copy backend final disclosure rechecks current authority after private read: " + mode, async () => {
  const state = await fixture({ mode });
  let boundary;
  try {
    const proposed = await preview(state), before = counts(state), beforeFinance = finance(state);
    boundary = atDisclosure(state, "retained", proposed.previewId, "authority");
    const result = await state.copy(confirm(proposed, "retrieve")), body = await result.json();
    assert.equal(boundary.visits, 1); assert.equal(result.status, 403); assert.equal(body.preview, undefined);
    assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
  } finally { boundary?.restore(); await state.close(); }
});

for (const mode of modes) for (const action of ["retrieve", "resume"])
test("copy backend erased private preview keeps only its exact committed receipt: " + mode + "/" + action, async () => {
  const state = await fixture({ mode });
  let boundary;
  try {
    const proposed = await preview(state), appliedResponse = await state.copy(confirm(proposed)), applied = await appliedResponse.json();
    assert.equal(appliedResponse.status, 200); assert.equal(applied.status, "applied");
    const before = counts(state), beforeFinance = finance(state);
    boundary = atDisclosure(state, "retained", proposed.previewId, "redacted");
    const result = await state.copy(action === "resume" ? { action, operationId: proposed.duplication.operationId } : confirm(proposed, action));
    const body = await result.json();
    assert.equal(boundary.visits, 1); assert.equal(result.status, 200); assert.equal(body.status, "applied"); assert.equal(body.idempotent, true);
    for (const key of ["previewId", "approvalHash", "operationId", "documentId", "requestHash", "blockIds", "relationCount"]) assert.deepEqual(body[key], applied[key], key);
    assert.equal(body.preview, undefined); assert.equal(JSON.stringify(body).includes("PRIVATE_SOURCE_"), false);
    assert.deepEqual(counts(state), before); assert.deepEqual(finance(state), beforeFinance);
  } finally { boundary?.restore(); await state.close(); }
});

for (const mode of modes) for (const fault of ["healthy", "erased", "changed-plan", "receipt", "authority", "custody"])
test("copy backend conservative applying proves current original transition: " + mode + "/" + fault, async () => {
  const state = await fixture({ mode });
  const prepare = state.env.DB.prepare.bind(state.env.DB);
  let entered = false, writerChanges = 0, controlChanges = 0, winningReceipt;
  try {
    const proposed = await preview(state), retained = JSON.parse(retainedRow(state, proposed.previewId).content);
    retained.state = "applying"; retained.leaseId = "existing-expired-copy-lease";
    retained.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString();
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(retained), proposed.previewId);
    const before = counts(state), beforeFinance = finance(state);
    const total = () => Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n);
    const beforeChanges = total();
    state.env.DB.prepare = sql => {
      const statement = prepare(sql);
      if (!/^SELECT saved\.content AS preview_content/u.test(sql)) return statement;
      const bind = statement.bind;
      statement.bind = function(...values) {
        const bound = bind.apply(this, values), first = bound.first;
        bound.first = async function() {
          const row = await first.call(this);
          if (entered || !row?.preview_content) return row;
          entered = true;
          assert.equal(JSON.parse(row.preview_content).state, "applying");
          const writerStart = total(), applied = await state.copy(confirm(proposed));
          winningReceipt = await applied.json(); writerChanges = total() - writerStart;
          assert.equal(applied.status, 200); assert.equal(winningReceipt.status, "applied");
          const controlStart = total();
          if (fault === "erased") state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_id=?").run(proposed.previewId);
          else if (fault === "changed-plan") {
            const current = JSON.parse(retainedRow(state, proposed.previewId).content);
            current.plan.duplication.title = "Defensive different retained plan";
            state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(current), proposed.previewId);
          } else if (fault === "receipt") state.sqlite.prepare("UPDATE authoring_commits SET result_json=json_set(result_json,'$.documentId','defensive-different-copy') WHERE preview_id=?").run(proposed.previewId);
          else if (fault !== "healthy") mutateRetained(state, proposed.previewId, fault);
          controlChanges = total() - controlStart;
          return row;
        };
        return bound;
      };
      return statement;
    };
    const result = await state.copy({ action: "resume", operationId: proposed.duplication.operationId }), body = await result.json();
    assert.equal(entered, true); assert.equal(body.preview, undefined); assert.equal(JSON.stringify(body).includes("PRIVATE_SOURCE_"), false);
    assert.equal(total() - beforeChanges, writerChanges + controlChanges, "the exact resume itself makes no durable change");
    assert.equal(counts(state).events - before.events, proposed.events.length); assert.equal(counts(state).receipts - before.receipts, 1);
    assert.deepEqual(finance(state), beforeFinance);
    if (fault === "healthy") {
      assert.equal(result.status, 202); assert.equal(body.status, "applying");
      assert.equal(body.previewId, proposed.previewId); assert.equal(body.approvalHash, proposed.approvalHash);
      assert.equal(body.operationId, proposed.duplication.operationId);
      const recovered = await state.copy({ action: "resume", operationId: proposed.duplication.operationId }), receipt = await recovered.json();
      assert.equal(recovered.status, 200); assert.equal(receipt.status, "applied");
      assert.equal(receipt.documentId, winningReceipt.documentId); assert.equal(receipt.operationId, body.operationId);
      assert.equal(counts(state).events - before.events, proposed.events.length); assert.equal(counts(state).receipts - before.receipts, 1);
    } else {
      assert.equal(result.status, 403); assert.equal(body.status, undefined);
      assert.equal(body.operationId, undefined, "a failed final proof must not masquerade as an authoritative progress transition");
    }
  } finally { state.env.DB.prepare = prepare; await state.close(); }
});

for (const mode of modes) test("copy backend four rich independent copies stay inside native D1 budgets: " + mode, async t => {
  const state = await fixture({ mode, count: 100, rich: true, relations: 290 });
  try {
    const before = counts(state), beforeFinance = finance(state), records = [];
    for (let number = 1; number <= 4; number++) {
      let proposed;
      for (const action of ["preview", "apply"]) {
        Object.assign(state.controls, { queries: 0, queryLimit: 199, maxBinds: 0, maxSqlBytes: 0, maxValueBytes: 0, maxBatch: 0 });
        const result = await state.copy(action === "preview" ? operation({ title: "Rich copy " + number }) : confirm(proposed));
        const body = await result.json();
        assert.equal(result.status, 200, mode + "/" + number + "/" + action + ": " + JSON.stringify(body));
        assert.ok(state.controls.queries < 200); assert.ok(state.controls.maxBinds <= 100);
        assert.ok(state.controls.maxSqlBytes <= 100_000); assert.ok(state.controls.maxValueBytes <= 2_000_000);
        records.push({ number, action, queries: state.controls.queries, binds: state.controls.maxBinds,
          sqlBytes: state.controls.maxSqlBytes, valueBytes: state.controls.maxValueBytes });
        if (action === "preview") { proposed = body.preview; assert.equal(proposed.blockCount, 100); assert.equal(proposed.events.length, 512); }
        else { assert.equal(body.status, "applied"); assert.equal(body.previewId, proposed.previewId); assert.equal(body.approvalHash, proposed.approvalHash); }
      }
      assert.equal(counts(state).events - before.events, number * 512);
      assert.equal(counts(state).privateEvents - before.privateEvents, number * 512);
      assert.equal(counts(state).receipts - before.receipts, number);
      assert.deepEqual(finance(state), beforeFinance);
    }
    t.diagnostic("COPY_R2_FOUR_CAPACITY " + JSON.stringify({ mode, records }));
  } finally { state.controls.queryLimit = 0; await state.close(); }
});

const changedValue = value => typeof value === "number" ? value + 1 : typeof value === "string" ? value + "-different" : "not-null";
const proofValue = async (state, proof) => Number((await state.env.DB.prepare("SELECT CASE WHEN " + proof.sql + " THEN 1 ELSE 0 END AS verified").bind(...proof.bindings).first()).verified);
test("copy backend byte-packed event proofs retain every row, column, NULL and direct large-body comparison", async () => {
  const state = await fixture({ count: 100, rich: true, relations: 290 });
  try {
    const raw = state.sqlite.prepare("SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.stream_id=? ORDER BY event.sequence LIMIT 130").all(state.stream);
    assert.equal(raw.length, 130);
    const rows = raw.map(row => [...copyProof.AUTHORING_EVENT_COLUMNS.map(column => row[column] ?? null), row.owner_id ?? null, row.project_id ?? null, row.document_id ?? null, row.private_json ?? null]);
    const old = copyProof.authoringEventRowsProof(rows, true), packed = copyProof.authoringEventRowsProof(rows, true, { byteBoundedOnly: true });
    assert.equal(old.bindings.length, 2); assert.equal(packed.bindings.length, 1);
    const compare = async (expected, truth) => {
      assert.equal(await proofValue(state, copyProof.authoringEventRowsProof(expected, true)), truth);
      assert.equal(await proofValue(state, copyProof.authoringEventRowsProof(expected, true, { byteBoundedOnly: true })), truth);
    };
    await compare(rows, 1);
    for (let column = 0; column < 17; column++) {
      const wrong = structuredClone(rows); wrong[129][column] = changedValue(rows[129][column]); await compare(wrong, 0);
      const nullable = structuredClone(rows); nullable[129][column] = null; await compare(nullable, rows[129][column] === null ? 1 : 0);
    }
    state.sqlite.exec("SAVEPOINT copy_proof");
    state.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(raw[129].event_id);
    await compare(rows, 0);
    const absent = structuredClone(rows); absent[129].splice(13, 4, null, null, null, null); await compare(absent, 1);
    state.sqlite.exec("ROLLBACK TO copy_proof"); state.sqlite.exec("RELEASE copy_proof");
    state.sqlite.exec("SAVEPOINT copy_proof");
    state.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(raw[129].event_id);
    await compare(rows, 0);
    state.sqlite.exec("ROLLBACK TO copy_proof"); state.sqlite.exec("RELEASE copy_proof");
    const large = JSON.stringify({ text: "\n".repeat(700_000) }), values = [...rows[129].slice(0, 16), large];
    assert.ok(Buffer.byteLength(large) < 2_000_000); assert.ok(Buffer.byteLength(JSON.stringify(values)) > 1_900_000);
    state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(large, raw[129].event_id);
    const direct = copyProof.authoringEventRowsProof([values], true, { byteBoundedOnly: true });
    assert.equal(direct.bindings.length, 17); await compare([values], 1);
    values[16] += " "; await compare([values], 0);
  } finally { await state.close(); }
});

for (const table of ["project_event_scopes", "project_resource_scopes"])
test("copy backend byte-packed exact sidecars retain all ten fields and missing-row denial: " + table, async () => {
  const state = await fixture({ mode: "shared", count: 100, rich: true, relations: 290 });
  try {
    await preview(state);
    const raw = state.sqlite.prepare("SELECT rowid AS fixture_rowid,* FROM " + table + " WHERE project_access_id=? ORDER BY rowid LIMIT 130").all(state.projectAccessId);
    assert.equal(raw.length, 130);
    const rows = raw.map(row => copyProof.AUTHORING_SIDECAR_COLUMNS[table].map(column => row[column] ?? null));
    assert.equal(copyProof.authoringSidecarProof(table, rows).bindings.length, 2);
    assert.equal(copyProof.authoringSidecarProof(table, rows, { byteBoundedOnly: true }).bindings.length, 1);
    const compare = async (expected, truth) => {
      assert.equal(await proofValue(state, copyProof.authoringSidecarProof(table, expected)), truth);
      assert.equal(await proofValue(state, copyProof.authoringSidecarProof(table, expected, { byteBoundedOnly: true })), truth);
    };
    await compare(rows, 1);
    for (let column = 0; column < 10; column++) {
      const wrong = structuredClone(rows); wrong[129][column] = changedValue(rows[129][column]); await compare(wrong, 0);
      const nullable = structuredClone(rows); nullable[129][column] = null; await compare(nullable, rows[129][column] === null ? 1 : 0);
    }
    state.sqlite.prepare("DELETE FROM " + table + " WHERE rowid=?").run(raw[129].fixture_rowid); await compare(rows, 0);
  } finally { await state.close(); }
});

test("copy backend source proof paging keeps the original byte and default write-row limits", () => {
  const rows = Array.from({ length: 130 }, (_, index) => [index, "Exact source " + index, null]);
  assert.equal(copyProof.authoringJsonChunks(rows).length, 2);
  assert.equal(copyProof.authoringJsonChunks(rows, { byteBoundedOnly: true }).length, 1);
  const large = Array.from({ length: 6 }, (_, index) => [index, "x".repeat(400_000)]);
  const packed = copyProof.authoringJsonChunks(large, { byteBoundedOnly: true });
  assert.ok(packed.length > 1); assert.ok(packed.every(value => Buffer.byteLength(value) <= 1_900_000));
  assert.deepEqual(packed.flatMap(value => JSON.parse(value)), large);
  assert.throws(() => copyProof.authoringJsonChunks([["x".repeat(1_900_000)]], { byteBoundedOnly: true }), /authoring_payload_too_large/u);
});
