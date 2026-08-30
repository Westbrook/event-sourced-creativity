// Preparation only: no executed finding is claimed by this file's existence.
// All Worker/controller code and fixtures are the exact composed Phase8 sources.
// The sole failure injection is a one-shot completion error of one READ statement.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { foldEvents } from "../../src/model/events.ts";
import { readEvents } from "../../worker/runtime.ts";
import { publicEventPayload } from "../../worker/event-privacy.ts";

// Existing phase8-output-ui-forward fixture-declaration loader, without its
// unrelated locale port. Test registrations are excluded; declarations are exact.
async function fixtureDefinitions(file, names) {
  const url = new URL(file, import.meta.url), source = readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  const declarations = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && node.getText(tree) === "hooks.deregister();")
    .map(node => node.getFullText(tree)).join("\n");
  const fixtureUrl = new URL(url); fixtureUrl.search = "?phase8-postcommit-receipt-fixture";
  const hook = registerHooks({ load(request, context, next) {
    return request === fixtureUrl.href ? { format: "module", source: declarations + "\nexport { " + names.join(",") + " };\n", shortCircuit: true } : next(request, context);
  } });
  try { return await import(fixtureUrl.href); } finally { hook.deregister(); }
}
const routed = await fixtureDefinitions("../assistant-runtime.test.mjs", ["main170Phase8Fixture", "main170Phase8Ledgers",
  "phase8Request", "phase8PaidEvidence", "phase8AssertNoPayment"]);
const paid = await fixtureDefinitions("../adaptive-proposal-host.test.mjs", ["fixture"]);
const canonical = state => Object.fromEntries(["events", "event_private_payloads", "authoring_commits"]
  .map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const totalChanges = state => Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n);
const replyView = (http, body) => ({ http, status: body.status ?? null, error: body.error ?? null });
const view = controller => ({ phase: controller.phase, uncertain: controller.uncertain, canEdit: controller.canEdit,
  canPreview: controller.canPreview, canApply: controller.canApply, handle: structuredClone(controller.handle) });

function verifyOriginalCommit(state, preview) {
  const rows = state.sqlite.prepare("SELECT * FROM authoring_commits ORDER BY rowid").all();
  assert.equal(rows.length, 1); const row = rows[0];
  assert.equal(row.preview_id, preview.previewId); assert.equal(row.approval_hash, preview.approvalHash);
  assert.equal(row.verified, 1); assert.equal(row.actor_user_id, state.owner); assert.equal(row.operation, "adaptive-proposal");
  assert.equal(row.project_id, state.scope.projectId); assert.equal(row.document_id, state.scope.documentId);
  const result = JSON.parse(row.result_json);
  assert.equal(result.selectionKey, preview.adaptiveReview.selectionKey);
  assert.equal(result.executionId, state.paidQuote.executionId); assert.equal(result.bindingHash, state.paidQuote.bindingHash);
  assert.deepEqual(result.blockIds, preview.changes.filter(change => change.kind === "create" || change.kind === "edit").map(change => change.targetId));
  const events = state.sqlite.prepare("SELECT * FROM events WHERE correlation_id=? ORDER BY sequence")
    .all("authoring:" + state.owner + ":" + preview.previewId);
  assert.equal(events.length, preview.events.length); assert.equal(new Set(events.map(event => event.event_id)).size, events.length);
  assert.equal(events.at(-1).event_id, row.last_event_id);
  for (const [index, event] of events.entries()) {
    assert.equal(event.type, preview.events[index].type); assert.equal(event.actor, "user:" + state.owner);
    const expected = publicEventPayload(event.event_id, preview.events[index].payload, true);
    assert.deepEqual(JSON.parse(event.payload), expected.payload);
    const sidecar = state.sqlite.prepare("SELECT private_json,redacted_at FROM event_private_payloads WHERE private_event_id=?").get(event.event_id);
    assert.ok(sidecar); assert.equal(sidecar.redacted_at, null); assert.equal(sidecar.private_json, expected.privateJson);
  }
  return { previewId: row.preview_id, approvalHash: row.approval_hash, selectionKey: result.selectionKey,
    eventIds: events.map(event => event.event_id), lastEventId: row.last_event_id };
}

// Exact API readSelectionReceipt statement. No broad read matching, write hook,
// fabricated result/ACK, handler replacement, or event/receipt insertion.
function selectionReadBoundary(state) {
  const prepare = state.env.DB.prepare, evidence = { calls: 0, realNulls: 0, realRows: 0, failures: 0, witnessed: null };
  let armed = null;
  state.env.DB.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    if (!sql.startsWith("SELECT preview_id,approval_hash,result_json FROM authoring_commits\n    WHERE(actor_user_id,operation,project_id,document_id,COALESCE(canvas_id,''),block_id,verified,")) return statement;
    const bind = statement.bind;
    statement.bind = (...values) => {
      const bound = bind.call(statement, ...values), first = bound.first;
      bound.first = async (...args) => {
        const before = totalChanges(state), row = await first.apply(bound, args);
        assert.equal(totalChanges(state), before, "the intercepted SQLite statement is read-only");
        evidence.calls++; if (row) evidence.realRows++; else evidence.realNulls++;
        if (armed && row?.preview_id === armed.previewId) {
          assert.equal(row.approval_hash, armed.approvalHash); assert.equal(values[0], state.owner);
          assert.equal(values[6], armed.adaptiveReview.selectionKey);
          evidence.witnessed = verifyOriginalCommit(state, armed); armed = null; evidence.failures++;
          // A driver/read completion failure, after a successful current read.
          // The native transaction and its verified receipt are already durable in RAM.
          throw new Error("injected_selection_receipt_read_completion_failure");
        }
        return row;
      };
      return bound;
    };
    return statement;
  };
  return { evidence, arm(preview) { assert.equal(armed, null); armed = preview; }, restore() { state.env.DB.prepare = prepare; } };
}

async function fixture(t, mode) {
  const state = await routed.main170Phase8Fixture(mode), paidBefore = routed.phase8PaidEvidence(state), ledgers = routed.main170Phase8Ledgers(state);
  const boundary = selectionReadBoundary(state), f = paid.fixture(), calls = [];
  t.after(async () => {
    try {
      boundary.restore(); routed.phase8AssertNoPayment(state, paidBefore);
      assert.deepEqual(routed.main170Phase8Ledgers(state), ledgers);
      await state.cleanup();
    } finally { state.sqlite.close(); }
  });
  const execution = state.sqlite.prepare("SELECT result_ref FROM consequential_executions WHERE execution_id=?").get(state.paidQuote.executionId);
  const original = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(execution.result_ref).content).structure;
  assert.ok(Array.isArray(original.suggested_blocks), "use actual retained original bytes, never a recreated suggestion");
  f.state.scope = { ...f.state.scope, ...state.scope, actorUserId: state.owner };
  f.state.source = { ...f.state.source, executionId: state.paidQuote.executionId, bindingHash: state.paidQuote.bindingHash, structure: original };
  const refresh = async () => { f.state.projection = foldEvents(await readEvents(state.env, state.stream), Infinity, state.scope.documentId, state.scope.projectId); };
  await refresh(); f.ports.refresh = refresh;
  f.ports.request = async body => {
    const response = await routed.phase8Request(state, body), result = await response.clone().json();
    calls.push({ command: structuredClone(body), ...replyView(response.status, result) }); return response;
  };
  f.controller.open(state.paidQuote.executionId, ["/suggested_blocks/0"]);
  assert.equal(f.controller.canPreview, true); const before = canonical(state);
  await f.controller.request("preview");
  assert.equal(f.controller.phase, "review", f.controller.notice); assert.equal(f.controller.canApply, true);
  assert.ok(boundary.evidence.realNulls >= 1, "healthy native null: no selection receipt exists before Apply");
  assert.deepEqual(canonical(state), before, "free preview creates no canonical event or authoring receipt");
  const preview = structuredClone(f.controller.preview);
  return { state, controller: f.controller, boundary, calls, before, preview };
}
async function checkOriginal(f) {
  const before = canonical(f.state), original = verifyOriginalCommit(f.state, f.preview);
  await f.controller.request("retrieve");
  assert.equal(f.controller.phase, "applied", f.controller.notice); assert.equal(f.controller.uncertain, false);
  assert.equal(f.controller.receipt.previewId, f.preview.previewId); assert.equal(f.controller.receipt.approvalHash, f.preview.approvalHash);
  assert.deepEqual(canonical(f.state), before, "explicit Check recovers the existing receipt without reauthoring");
  assert.deepEqual(verifyOriginalCommit(f.state, f.preview), original);
  return original;
}

export { routed, canonical, replyView, view, verifyOriginalCommit, fixture, checkOriginal };
