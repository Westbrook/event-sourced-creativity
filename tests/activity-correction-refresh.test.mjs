// Complete actual Activity/IssuePanel/Store/Worker. Notification rows are named
// fixture seeds; actual GET/PATCH replies and original edit receipts are retained.
import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/u, "");
// Reuse all current fixture declarations, not old registered tests. Only test
// registrations are removed and exports added; no production method is changed.
const ts = createRequire(root + "/package.json")("typescript");
const path = root + "/tests/artifact-noop-save.test.mjs";
const raw = fs.readFileSync(path, "utf8");
const tree = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const registered = statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
  && ["test", "test.after"].includes(statement.expression.expression.getText(tree));
const source = tree.statements.filter(statement => !registered(statement) && !ts.isForOfStatement(statement))
  .map(statement => statement.getFullText(tree)).join("\n")
  + "\nexport {activitySetup,holdEditReply,native,finishNoopFixture};";
assert.equal(ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
const virtual = pathToFileURL(path).href + "?r4-current-activity-notification-owner";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual ? { format: "module", source, shortCircuit: true } : next(url, context);
} });
let activitySetup, holdEditReply, native, finishNoopFixture;
try { ({ activitySetup, holdEditReply, native, finishNoopFixture } = await import(virtual)); }
finally { hook.deregister(); }
test.after(() => assert.equal(finishNoopFixture(), 0, "zero external/provider requests"));
const { FormaActivity } = await native.loadActual("src/components/forma-activity.ts");
const { FormaActivityIssuePanel } = await native.loadActual("src/components/forma-activity-issue-panel.ts");
const tick = () => new Promise(setImmediate);
const financialTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
const aText = "Submitted actual Activity correction A.";
const bText = "Newer unsaved Activity correction B.";

for (const [name, changed, refresh, newer] of [
  ["healthy changed A then B", true, false, true],
  ["same-ID refresh during changed A then B", true, true, true],
  ["same-ID refresh during no-op then B", false, true, true],
  ["same-ID refresh during changed A without newer B", true, true, false],
]) test(name, async t => {
  let releaseOriginal;
  t.after(() => releaseOriginal?.resolve());
  const p = await activitySetup(t), f = p.f;
  const financialRows = () => Object.fromEntries(financialTables.map(table => [table,
    p.state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
  ]));
  const beforeFinancialRows = financialRows();

  // Existing setup supplies two explicit RAM notification seeds, not evidence
  // of a performed review. Mount the complete actual parent before any tested
  // edit so its ordinary .notification property delivery is exercised.
  f.host.disconnectedCallback(); f.host.isConnected = false;
  f.host = new FormaActivity(); f.host.store = p.h.store; f.host.i18n = f.i18n;
  f.host.tag = "forma-activity"; f.host.isConnected = true;
  f.renderer.registry["forma-activity-issue-panel"] = FormaActivityIssuePanel;
  p.h.store.route.set("/activity?document=" + p.state.documentId);
  f.draw();
  const panel = () => [...f.renderer.instances.values()].map(row => row.instance)
    .find(instance => instance.isConnected && instance.notification?.id === p.ids[0]);
  const own = tag => f.renderer.ownNodes(panel(), tag);
  const editor = () => own("textarea").find(node => node.attributes.rows === "8");
  const click = node => {
    assert.ok(node?.isConnected && f.renderer.nodes.includes(node));
    assert.equal(Object.hasOwn(node.attributes, "disabled"), false); node.click();
  };
  click(own("button").find(node => node.handlers.click?.toString().includes("#startCorrection")));
  for (let i = 0; i < 40 && !editor(); i++) { await tick(); f.draw(); }
  assert.ok(editor());
  const originalPanel = panel(), originalNotification = panel().notification;
  const type = value => {
    const field = editor(); assert.ok(field?.isConnected && f.renderer.nodes.includes(field));
    assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
    assert.equal(Object.hasOwn(field.attributes, "readonly"), false);
    field.value = value; field.handlers.input.call(panel(), { target: field, currentTarget: field }); f.draw();
  };
  const save = () => {
    const form = own("form").find(node => node.handlers.submit?.toString().includes("#saveCorrection"));
    const button = own("button").find(node => node.attributes.type === "submit");
    assert.ok(form?.isConnected && f.renderer.nodes.includes(form)); assert.ok(button?.isConnected);
    assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    form.handlers.submit.call(panel(), { target: form, currentTarget: form, preventDefault() {} });
  };

  if (changed) type(aText);
  const gate = holdEditReply(p); releaseOriginal = gate.release; save(); const a = await gate.entered.promise;
  assert.equal(a.status, 200); assert.equal(a.body.revision, changed ? 1 : 0);
  assert.equal(a.body.appended.filter(event => event.type === "DocumentArtifactEdited").length, changed ? 1 : 0);
  if (newer) type(bText);
  let refreshedSameIdentity = null;
  if (refresh) {
    const start = p.h.requests.length;
    await p.h.store.syncProjectNotifications(); f.draw();
    const reads = p.h.requests.slice(start).filter(request => request.url === "/api/project-notifications"
      && (request.init.method ?? "GET") === "GET");
    assert.equal(reads.length, 1, "one actual current Store/Worker notification GET");
    assert.ok(panel() === originalPanel, "the same connected actual child receives the parent update");
    assert.notEqual(panel().notification, originalNotification, "parsed JSON supplies a fresh object");
    assert.deepEqual(panel().notification, originalNotification, "all notification fields and identity remain equal");
    refreshedSameIdentity = { exactGetCount: reads.length, sameConnectedChild: true,
      sameCompleteNotificationValue: true, sameObjectReference: false };
  }
  gate.release.resolve(); assert.equal(await p.calls[0].pending, true); await tick(); f.draw();
  const afterA = { editor: editor()?.value ?? null, acknowledgedIds: p.acknowledgments.map(row => row.id),
    sameConnectedChild: panel() === originalPanel && originalPanel.isConnected };

  // A second Save is a separate activation of the CURRENT visible enabled
  // form, never an automatic retry or retained obsolete handler invocation.
  let second = null;
  if (editor()) {
    let secondReply = null;
    p.h.intercept = async request => {
      if (request.init.method !== "PATCH" || request.url !== "/api/artifacts/saved-scene-story") return undefined;
      const response = await p.h.worker.request(request.url, request.init);
      const body = await response.clone().json();
      secondReply = { status: response.status, error: body.error ?? null,
        revision: body.revision ?? null, appended: (body.appended ?? []).map(event => event.type) };
      return response;
    };
    save(); const result = await p.calls[1].pending; await tick(); f.draw();
    second = { result, expectedRevision: p.calls[1].args[1].expectedRevision,
      editor: editor()?.value ?? null, toast: p.h.store.ui.toast, actualReply: secondReply };
  }
  for (const acknowledgment of p.acknowledgments) assert.equal(await acknowledgment.pending, true);
  await tick(); f.draw();
  const durable = JSON.parse(p.data().content);
  const editEvents = p.state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactEdited'").get().n;
  assert.deepEqual(financialRows(), beforeFinancialRows);
  assert.ok(p.mutations().every(request => request.init.method === "PATCH"
    && ["/api/artifacts/saved-scene-story", "/api/project-notifications"].includes(request.url)));
  const rows = p.state.sqlite.prepare("SELECT notification_id,read_at FROM project_notifications WHERE notification_id IN (?,?)").all(...p.ids);
  assert.equal(rows.find(row => row.notification_id === p.ids[1]).read_at, null, "unrelated notification is never acknowledged");
  t.diagnostic(JSON.stringify({ name, changed, refresh, newer,
    actualA: { status: a.status, revision: a.body.revision, appended: a.body.appended.map(event => event.type) },
    refreshedSameIdentity, afterA, second, retainedMarkdown: durable.content_markdown, editEvents,
    acknowledgedIds: p.acknowledgments.map(row => row.id), notificationRows: rows,
    mutations: p.mutations().map(request => ({ method: request.init.method, url: request.url,
      expectedRevision: request.body?.expectedRevision ?? null })),
    financialRowsUnchanged: true, externalProviderCalls: 0, physicalNativeOrATClaim: false,
  }));
  if (newer) {
    assert.equal(afterA.editor, bText, "A must preserve accepted newer B");
    assert.deepEqual(afterA.acknowledgedIds, [], "A cannot mark the card read while B remains unsaved");
    assert.equal(second?.result, true, "equivalent notification refresh cannot make the separate current B Save conflict with our own verified A");
    assert.equal(second.actualReply.status, 200);
    assert.equal(second.expectedRevision, changed ? 1 : 0);
    assert.equal(durable.content_markdown, bText); assert.equal(editEvents, changed ? 2 : 1);
    assert.deepEqual(p.acknowledgments.map(row => row.id), [p.ids[0]]);
    assert.equal(typeof rows.find(row => row.notification_id === p.ids[0]).read_at, "string");
  } else {
    assert.equal(durable.content_markdown, aText); assert.equal(editEvents, 1);
    assert.equal(afterA.editor, null, "the unchanged owned draft must complete after A's real acknowledgment despite equivalent notification refresh");
    assert.deepEqual(p.acknowledgments.map(row => row.id), [p.ids[0]]);
  }
});

const editTarget = "saved-scene-story";
async function refreshConnectedIssue(p) {
  const before = p.f.host.notification;
  await p.h.store.syncProjectNotifications();
  const current = p.h.store.projectNotifications.get().find(row => row.id === before.id);
  assert.ok(current);
  // Explicit current-component property delivery, not a claim that the parent
  // keeps this child mounted when a row moves between unread and recent groups.
  p.f.host.notification = current; p.f.draw();
  assert.notEqual(current, before);
  return current;
}
for (const changed of [false, true]) for (const newer of [false, true]) test("connected IssuePanel read-status metadata preserves " + (changed ? "changed" : "no-op") + (newer ? " A then B" : " unchanged A") + " ownership without a duplicate Mark read", async t => {
  let releaseOriginal; t.after(() => releaseOriginal?.resolve());
  const p = await activitySetup(t), before = { ...p.f.host.notification }, initialContent = p.data().content;
  if (changed) p.type("Original metadata-control A.");
  const gate = holdEditReply(p); releaseOriginal = gate.release; p.save();
  const reply = await gate.entered.promise; assert.equal(reply.status, 200);
  if (newer) p.type("Explicit metadata-control B.");
  const marked = await p.h.worker.request("/api/project-notifications", { method: "PATCH",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ notificationId: p.ids[0] }) });
  assert.equal(marked.status, 200);
  const current = await refreshConnectedIssue(p);
  assert.equal(typeof current.readAt, "string");
  assert.deepEqual({ ...current, readAt: before.readAt }, before);
  gate.release.resolve(); assert.equal(await p.finish(), true);
  assert.deepEqual(p.acknowledgments.map(row => row.id), []);
  if (newer) {
    assert.equal(p.editor().value, "Explicit metadata-control B.");
    p.save(); assert.equal(await p.finish(1), true);
    assert.equal(p.calls[1].args[1].expectedRevision, changed ? 1 : 0);
    assert.equal(JSON.parse(p.data().content).content_markdown, "Explicit metadata-control B.");
  } else if (changed) assert.equal(JSON.parse(p.data().content).content_markdown, "Original metadata-control A.");
  else assert.equal(p.data().content, initialContent);
  assert.equal(Boolean(p.editor()), false, "the correction editor is closed");
  assert.deepEqual(p.acknowledgments.map(row => row.id), [], "known-read metadata never triggers another automatic acknowledgment");
  assert.deepEqual(p.mutations().map(row => [row.init.method, row.url]),
    Array.from({ length: newer ? 2 : 1 }, () => ["PATCH", "/api/artifacts/" + editTarget]));
});

for (const field of ["id", "kind", "artifactId", "documentId", "message", "createdAt"])
test("correction ownership rejects changed notification " + field + " even when the artifact A reply is valid", async t => {
  let releaseOriginal; t.after(() => releaseOriginal?.resolve());
  const p = await activitySetup(t), before = { ...p.f.host.notification };
  p.type("Committed original-binding A.");
  const gate = holdEditReply(p); releaseOriginal = gate.release; p.save();
  const reply = await gate.entered.promise; assert.equal(reply.status, 200); assert.equal(reply.body.revision, 1);
  p.type("Unsent changed-binding B.");
  const values = { id: p.ids[1], kind: "artifact_approved", artifactId: "different-retained-output",
    documentId: "different-document", message: "Different correction instructions.", createdAt: "2020-01-01T00:00:00.000Z" };
  // Named negative current-property binding. These replaced fields do not claim
  // that an immutable server notification can be rewritten by an ordinary user.
  p.f.host.notification = { ...before, [field]: values[field] }; p.f.draw();
  gate.release.resolve(); assert.equal(await p.finish(), true);
  assert.deepEqual(p.acknowledgments.map(row => row.id), []);
  p.f.host.notification = { ...before }; p.f.draw();
  assert.equal(p.editor().value, "Unsent changed-binding B.");
  p.save(); assert.equal(await p.finish(1), false);
  assert.equal(p.calls[1].args[1].expectedRevision, 0, "another binding cannot borrow the original operation's canonical base");
  assert.equal(p.editor().value, "Unsent changed-binding B.");
  assert.equal(JSON.parse(p.data().content).content_markdown, "Committed original-binding A.");
  assert.deepEqual(p.acknowledgments.map(row => row.id), []);
  assert.equal(p.mutations().length, 2);
});
test("captured correction instructions cannot be mutated in place while A is pending", async t => {
  let releaseOriginal; t.after(() => releaseOriginal?.resolve());
  const p = await activitySetup(t), before = { ...p.f.host.notification }, originalObject = p.f.host.notification;
  p.type("Original immutable A."); const gate = holdEditReply(p); releaseOriginal = gate.release; p.save();
  assert.equal((await gate.entered.promise).status, 200); p.type("New unsent B.");
  originalObject.message = "Changed same-object instructions."; p.f.draw();
  assert.equal(p.f.host.notification, originalObject);
  gate.release.resolve(); assert.equal(await p.finish(), true); assert.deepEqual(p.acknowledgments.map(row => row.id), []);
  p.f.host.notification = { ...before }; p.f.draw(); p.save(); assert.equal(await p.finish(1), false);
  assert.equal(p.calls[1].args[1].expectedRevision, 0); assert.equal(p.editor().value, "New unsent B.");
});

for (const field of ["markdown", "title", "body", "notes"]) test("equivalent notification refresh retains newer " + field + " ABA as a separate unsaved intent", async t => {
  let releaseOriginal; t.after(() => releaseOriginal?.resolve());
  const p = await activitySetup(t), value = p.itemInput(field).value;
  const gate = holdEditReply(p); releaseOriginal = gate.release; p.save();
  assert.deepEqual((await gate.entered.promise).body.appended, []);
  p.type("Intermediate newer " + field, field); p.type(value, field);
  const original = { ...p.f.host.notification }, current = await refreshConnectedIssue(p);
  assert.deepEqual(current, original);
  gate.release.resolve(); assert.equal(await p.finish(), true);
  assert.ok(p.editor()); assert.equal(p.itemInput(field).value, value); assert.deepEqual(p.acknowledgments.map(row => row.id), []);
  p.save(); assert.equal(await p.finish(1), true); assert.equal(Boolean(p.editor()), false, "the correction editor is closed");
  assert.deepEqual(p.acknowledgments.map(row => row.id), [p.ids[0]]);
  assert.equal(p.state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactEdited'").get().n, 0);
});
test("Cancel still retires correction ownership across an equivalent notification refresh", async t => {
  let releaseOriginal; t.after(() => releaseOriginal?.resolve());
  const p = await activitySetup(t), gate = holdEditReply(p); releaseOriginal = gate.release;
  p.type("Submitted A before Cancel."); p.save(); assert.equal((await gate.entered.promise).status, 200);
  p.click(p.own("button").find(node => node.handlers.click?.toString().includes('this.#editingArtifactId = ""')));
  await refreshConnectedIssue(p); assert.equal(Boolean(p.editor()), false, "the correction editor is closed");
  gate.release.resolve(); assert.equal(await p.finish(), true);
  assert.equal(Boolean(p.editor()), false, "the correction editor is closed"); assert.deepEqual(p.acknowledgments.map(row => row.id), []); assert.equal(p.mutations().length, 1);
});
