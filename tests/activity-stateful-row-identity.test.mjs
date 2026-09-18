// Actual stateful Activity rows. First three oracle bodies are unchanged from
// the frozen same-list proof. Extra reorder tests use complete real GET rows.
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import test, { after } from "node:test";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const path = ROOT + "tests/helpers/assigned-review-action-fixture.mjs";
const raw = fs.readFileSync(path, "utf8");
const seam = "return { h, w, f, task, secondTask, thirdTask, button, targetDocument, artifactId, hash, nativeRequest, serverRequest, receive, activatePrincipal, expireCookie, entryDocument, entryProject, viewerCalls, usedViewAll, revoke, supersede };";
assert.equal(raw.split(seam).length, 2);
const source = raw.replace(seam, `
  const acceptExactReviewEffect = async (target) => {
    const current = await sourceRows(w);
    assert.deepEqual(current.slice(0, expectedSource.length), expectedSource);
    assert.equal(current.length, expectedSource.length + 1);
    const effect = current.at(-1);
    assert.equal(effect.type, "ArtifactChangesRequested");
    assert.equal(effect.payload.artifact_id, target.artifactId);
    assert.equal(effect.payload.document_id, target.documentId);
    assert.equal(effect.payload.artifact_revision, target.revision);
    assert.equal(effect.payload.content_sha256, target.contentSha256);
    expectedSource = current;
  };
  return { h, w, f, nativeRequest, acceptExactReviewEffect };
`);
const virtual = pathToFileURL(path).href + "?experience-same-list-identity-r4";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual ? { format: "module", source, shortCircuit: true } : next(url, context);
} });
const { assignmentPage, sceneDeferred, flushStoreFrames, externalCount, originalFetch } = await import(virtual);
const rows = [];
for (const scenario of ["identical-feed", "remove-last", "remove-first"]) test("actual same-list review identity / " + scenario, { timeout: 25_000 }, async t => {
  const q = await assignmentPage(t, "same-document"), { h, f } = q;
  await flushStoreFrames(h); await f.settle();
  // Mount the complete actual Activity directly in the same existing ports.
  // This removes unrelated full-Shell template lifetime from the test, without
  // replacing the Activity template or any Store/Worker implementation.
  const { FormaActivity } = await f.modules.get("src/components/forma-activity.ts");
  assert.equal(typeof FormaActivity, "function");
  f.host.disconnectedCallback(); f.host.isConnected = false;
  f.host = new FormaActivity(); f.host.store = h.store; f.host.i18n = f.i18n;
  f.host.tag = "forma-activity"; f.host.isConnected = true;
  await f.settle();
  const fields = () => f.tree().visible("textarea").filter(node => node.owner.tag === "forma-activity-issue-panel"
    && node.handlers.input?.toString().includes("#reviewNote"));
  const field = taskId => f.find("textarea", node => node.owner.tag === "forma-activity-issue-panel"
    && node.owner.review?.id === taskId && node.handlers.input?.toString().includes("#reviewNote"));
  const form = taskId => f.find("form", node => node.owner.tag === "forma-activity-issue-panel"
    && node.owner.review?.id === taskId && node.handlers.submit?.toString().includes("#resolveReview"));
  const type = async (task, text) => {
    const node = field(task.id);
    assert.ok(node.owner.isConnected && node.port.isConnected);
    assert.equal(Object.hasOwn(node.attributes, "disabled"), false);
    assert.equal(Object.hasOwn(node.attributes, "readonly"), false);
    node.port.value = text; await f.act(node, "input");
  };
  const beforeTasks = fields().map(node => node.owner.review);
  assert.equal(beforeTasks.length, 3);
  assert.deepEqual(beforeTasks.map(task => task.id), h.store.reviewInbox.get().map(task => task.id), "Actual current inbox order");
  const target = scenario === "remove-last" ? beforeTasks.at(-1) : beforeTasks[0];
  const sibling = beforeTasks[1], draft = "Unsent note owned only by " + sibling.artifactTitle + ".";
  const originalOwners = new Map(fields().map(node => [node.owner.review.id, node.owner]));
  await type(sibling, draft);
  let submitted = null;
  if (scenario === "identical-feed") {
    const baseline = h.requests.length;
    await h.store.syncReviewInbox(); await f.settle();
    assert.equal(h.requests.slice(baseline).filter(request => request.url === "/api/workspaces/reviews").length, 1);
  } else {
    await type(target, "Original change requested for " + target.artifactTitle + ".");
    const entered = sceneDeferred(), release = sceneDeferred(); let pending;
    const originalAppend = h.store.append;
    t.mock.method(h.store, "append", function (event, ...args) {
      const promise = originalAppend.call(this, event, ...args);
      if (event.type === "ArtifactChangesRequested") pending = promise;
      return promise;
    });
    h.intercept = async request => {
      if (request.init.method !== "POST" || request.url !== "/api/events"
        || !JSON.stringify(request.body).includes("ArtifactChangesRequested")) return;
      const response = await q.nativeRequest(request);
      const body = await response.clone().json(); assert.equal(response.status, 200, JSON.stringify(body));
      await q.acceptExactReviewEffect(target);
      submitted = { taskId: target.id, artifactId: target.artifactId, status: response.status,
        appendedTypes: body.appended.map(event => event.type) };
      entered.resolve(); await release.promise; return response;
    };
    t.after(async () => { release.resolve(); await pending; });
    await f.act(form(target.id), "submit"); await entered.promise; await f.settle();
    assert.equal(field(sibling.id).port.value, draft, "Sibling's ordinary input remains present before the response");
    release.resolve(); await pending;
    for (let i = 0; i < 6; i++) await f.settle();
    assert.equal(q.w.sqlite.prepare("SELECT status FROM project_review_tasks WHERE task_id=?").get(target.id).status, "changes-requested");
  }
  const after = fields().map(node => ({ taskId: node.owner.review.id, artifactId: node.owner.review.artifactId,
    value: node.port.value, originalOwnerTaskId: [...originalOwners].find(([, owner]) => owner === node.owner)?.[0] ?? null }));
  assert.equal(q.w.sqlite.prepare("SELECT status FROM project_review_tasks WHERE task_id=?").get(sibling.id).status, "pending");
  const row = { scenario, before: beforeTasks.map(task => ({ taskId: task.id, artifactId: task.artifactId })),
    siblingId: sibling.id, siblingArtifact: sibling.artifactId, draft, submitted, after,
    ownDraft: after.find(item => item.taskId === sibling.id)?.value,
    migratedToOtherTask: after.filter(item => item.taskId !== sibling.id && item.value === draft),
    external: externalCount(), boundary: "Actual direct Activity/Store/Worker and native/template ports; Lit index semantics independently inspected, not browser/AT certification." };
  rows.push(row); console.log("SAME_LIST_OBSERVATION", JSON.stringify(row));
  assert.equal(row.ownDraft, draft, "Still-pending exact task retains its own draft after another row completes");
  assert.equal(row.migratedToOtherTask.length, 0, "A draft cannot become a different task's current input");
});
after(() => { assert.equal(externalCount(), 0); globalThis.fetch = originalFetch; hook.deregister(); });

async function currentReviews(t) {
  const q = await assignmentPage(t, "same-document"), { h, f } = q;
  await flushStoreFrames(h); await f.settle();
  const { FormaActivity } = await f.modules.get("src/components/forma-activity.ts");
  f.host.disconnectedCallback(); f.host.isConnected = false;
  f.host = new FormaActivity(); f.host.store = h.store; f.host.i18n = f.i18n; f.host.tag = "forma-activity"; f.host.isConnected = true;
  await f.settle();
  const fields = () => f.tree().visible("textarea").filter(node => node.owner.tag === "forma-activity-issue-panel" && node.handlers.input?.toString().includes("#reviewNote"));
  const field = task => f.find("textarea", node => node.owner.tag === "forma-activity-issue-panel" && node.owner.review?.id === task.id && node.handlers.input?.toString().includes("#reviewNote"));
  const form = task => f.find("form", node => node.owner.tag === "forma-activity-issue-panel" && node.owner.review?.id === task.id && node.handlers.submit?.toString().includes("#resolveReview"));
  const type = async (task, value) => {
    const node = field(task); assert.ok(node.owner.isConnected && node.port.isConnected);
    assert.equal(Object.hasOwn(node.attributes, "readonly"), false); assert.equal(Object.hasOwn(node.attributes, "disabled"), false);
    node.port.value = value; await f.act(node, "input");
  };
  const tasks = fields().map(node => node.owner.review), owners = new Map(fields().map(node => [node.owner.review.id, node.owner]));
  assert.equal(tasks.length, 3);
  const requested = [], originalAppend = h.store.append;
  t.mock.method(h.store, "append", function(input, ...args) {
    const pending = originalAppend.call(this, input, ...args); requested.push({ input: structuredClone(input), pending }); return pending;
  });
  const complete = async (task, value) => {
    await type(task, value);
    const entered = sceneDeferred(); let wire;
    h.intercept = async request => {
      if (request.url !== "/api/events" || request.init.method !== "POST" || !JSON.stringify(request.body).includes("ArtifactChangesRequested")) return undefined;
      h.intercept = null;
      const response = await q.nativeRequest(request), body = await response.clone().json(); assert.equal(response.status, 200, JSON.stringify(body));
      await q.acceptExactReviewEffect(task); wire = structuredClone(request.body); entered.resolve(); return response;
    };
    const index = requested.length; await f.act(form(task), "submit"); await entered.promise;
    assert.ok(requested[index]); assert.equal((await requested[index].pending).length, 1);
    for (let turn = 0; turn < 6; turn++) await f.settle();
    const event = (wire.events ?? [wire.event]).find(row => row.type === "ArtifactChangesRequested");
    assert.equal(event.payload.artifact_id, task.artifactId); assert.equal(event.payload.document_id, task.documentId);
    assert.equal(event.payload.artifact_revision, task.revision); assert.equal(event.payload.content_sha256, task.contentSha256);
    assert.equal(event.payload.review_note, value);
    const privateNotes = q.w.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id IN(SELECT event_id FROM events WHERE type='ArtifactChangesRequested') ORDER BY rowid").all();
    assert.equal(JSON.parse(privateNotes.at(-1).private_json).review_note, value);
  };
  return { ...q, tasks, owners, fields, field, type, complete, requested };
}

for (const scenario of ["reverse GET order", "middle removal", "equivalent GET then exact submission"])
test("stateful review rows / " + scenario + " preserves every original draft and executor", async t => {
  const p = await currentReviews(t);
  for (const task of p.tasks) await p.type(task, "Unsent note only for " + task.id);
  if (scenario === "middle removal") await p.complete(p.tasks[1], "Submitted middle task only.");
  else {
    const before = p.h.requests.length; await p.h.store.syncReviewInbox();
    assert.equal(p.h.requests.slice(before).filter(row => row.url === "/api/workspaces/reviews").length, 1);
    if (scenario === "reverse GET order") p.h.store.reviewInbox.set([...p.h.store.reviewInbox.get()].reverse());
    await p.f.settle();
  }
  const survivors = scenario === "middle removal" ? [p.tasks[0], p.tasks[2]] : p.tasks;
  for (const task of survivors) {
    const node = p.field(task); assert.ok(node.owner === p.owners.get(task.id) && node.owner.isConnected);
    assert.equal(node.port.value, "Unsent note only for " + task.id);
  }
  assert.equal(new Set(p.fields().map(node => node.owner.review.id)).size, survivors.length);
  const last = survivors.at(-1); await p.complete(last, "Separate exact executor note for " + last.id);
  const remaining = survivors.filter(task => task.id !== last.id);
  for (const task of remaining) assert.equal(p.field(task).port.value, "Unsent note only for " + task.id);
  assert.equal(p.requested.length, scenario === "middle removal" ? 2 : 1);
  assert.equal(p.w.sqlite.prepare("SELECT status FROM project_review_tasks WHERE task_id=?").get(last.id).status, "changes-requested");
});

// Reuse A's actual failed-job/private-note fixture declarations without any
// registered cases or replacement production behavior. This is a defensive
// identity control, NOT a server Dismiss race or provider-execution claim.
const ts = createRequire(ROOT + "package.json")("typescript");
const notesPath = ROOT + "tests/activity-private-note-pending.test.mjs", notesRaw = fs.readFileSync(notesPath, "utf8");
const notesTree = ts.createSourceFile(notesPath, notesRaw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const notesRegistration = node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && ["test", "test.after"].includes(node.expression.expression.getText(notesTree));
const notesSource = notesTree.statements.filter(node => !notesRegistration(node) && !ts.isForOfStatement(node))
  .map(node => node.getFullText(notesTree)).join("\n") + "\nexport { noteSetup, settle };";
assert.equal(ts.createSourceFile(notesPath, notesSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
const notesURL = pathToFileURL(notesPath).href + "?E-defensive-stateful-job-identity";
const notesHook = registerHooks({ load(url, context, next) { return url === notesURL ? { format: "module", source: notesSource, shortCircuit: true } : next(url, context); } });
const { noteSetup, settle } = await import(notesURL); notesHook.deregister();

for (const reordered of [false, true]) test("stateful failed-job rows / " + (reordered ? "reordered" : "equivalent") + " real GET preserves actor-private notes without Dismiss", async t => {
  const p = await noteSetup(t, "en"), owners = new Map(p.ids.map(id => [id, p.panel(id)]));
  for (const id of p.ids) p.type(id, "Unsent private note only for " + id);
  const start = p.h.requests.length; await p.h.store.syncDocumentJobs();
  assert.ok(p.h.requests.slice(start).some(row => (row.init.method ?? "GET") === "GET" && row.url.startsWith("/api/document-jobs")));
  if (reordered) p.h.store.documentJobs.set([...p.h.store.documentJobs.get()].reverse());
  p.f.draw();
  for (const id of p.ids) {
    assert.ok(p.panel(id) === owners.get(id) && p.panel(id).isConnected);
    assert.equal(p.editor(id).value, "Unsent private note only for " + id);
  }
  p.save(); const saved = await p.saves[0].pending; assert.equal(saved.body, "Unsent private note only for " + p.ids[0]);
  await settle(p.f, () => p.editor(p.ids[0]).value === "");
  assert.equal(p.editor(p.ids[1]).value, "Unsent private note only for " + p.ids[1]);
  assert.equal(p.saves.length, 1); assert.equal(p.saves[0].args[0], p.ids[0]);
  assert.deepEqual(p.finance(), p.initialFinance);
  assert.equal(p.h.requests.filter(row => /\/dismiss(?:\?|$)/u.test(row.url)).length, 0);
  assert.equal(p.h.requests.filter(row => row.init.method === "POST" && !row.url.endsWith("/notes")).length, 0);
});
