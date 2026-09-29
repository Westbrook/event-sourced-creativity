// Actual full DocumentArtifacts/Store and the existing in-memory Worker.
// Fault-response variants below deliberately corrupt a real no-op response; they
// are transport-negative controls, not claimed server acknowledgments.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const original = new URL("./artifact-review-edit-intent.test.mjs", import.meta.url);
const raw = fs.readFileSync(original, "utf8");
const tree = ts.createSourceFile(original.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const registration = statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
  && ["test", "test.after"].includes(statement.expression.expression.getText(tree));
const fixture = tree.statements.filter(statement => !registration(statement)
  && !(ts.isForOfStatement(statement) && registration(statement.statement)))
  .map(statement => statement.getFullText(tree)).join("\n")
  .replace('"DocumentArtifacts, documentPort, windowPort"', '"DocumentArtifacts, documentPort, windowPort, loadActual"')
  + "\nexport {editSetup,holdEditReply,native,createSceneStoreHost}; export function finishNoopFixture(){globalThis.fetch=originalFetch;return externalRequests;}";
assert.equal(ts.createSourceFile(original.pathname, fixture, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
const fixtureURL = pathToFileURL(original.pathname).href + "?phase5-verified-noop-fixture-r3";
const hook = registerHooks({ load(url, context, next) {
  return url === fixtureURL ? { format: "module", source: fixture, shortCircuit: true } : next(url, context);
} });
const { editSetup, holdEditReply, native, createSceneStoreHost, finishNoopFixture } = await import(fixtureURL);
hook.deregister();
test.after(() => assert.equal(finishNoopFixture(), 0, "zero external/provider requests"));

const artifactId = "saved-scene-story", noChanges = "No changes to this finished output.";
const ownerFor = p => {
  const source = p.h.store.captureSourceOwnership();
  return { authorizationKey: source.authorization.key, actorUserId: p.state.owner,
    projectId: p.state.projectId, sourceGeneration: source.generation };
};
const receipts = p => p.h.store.eventWriteAcknowledgments(ownerFor(p));
const retainedBytes = p => p.state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(p.state.contentRef).content;
const durable = p => ({
  bytes: retainedBytes(p),
  events: p.state.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all(),
  revisions: p.state.sqlite.prepare("SELECT * FROM artifact_revisions ORDER BY artifact_id,revision").all(),
});
const reopen = p => { p.click(p.button("#startArtifactEdit")); p.f.draw(); assert.ok(p.editor()); };
async function canonical(t, options = {}) {
  const p = await editSetup(t, options);
  p.type("Canonical A, saved before checking for changes.");
  p.click(p.button("#saveArtifactEdit"));
  assert.equal(await p.finish(), true); assert.equal(p.editor(), undefined); assert.equal(p.revision(), 1);
  assert.equal(receipts(p).length, 0);
  reopen(p); return p;
}
function fieldValue(p, field, index = 0) {
  if (field === "markdown") return p.editor()?.value;
  const node = (field === "title" ? p.own("input") : p.own("textarea"))
    .filter(item => item.handlers.input?.toString().includes("item." + field))[index];
  assert.ok(node && node.isConnected); return node.value;
}
function captureNoop(p, transform = response => response) {
  const seen = [], previous = p.h.intercept;
  p.h.intercept = async request => {
    if (request.init.method !== "PATCH" || request.url !== "/api/artifacts/" + artifactId)
      return previous ? previous(request) : undefined;
    const response = await p.h.worker.request(request.url, request.init), body = await response.clone().json();
    seen.push({ status: response.status, body, request: structuredClone(request.body) });
    return transform(response, body);
  };
  return seen;
}
function observeOwnRelease(p) {
  const observed = [], release = p.h.store.releaseEventWriteAcknowledgment.bind(p.h.store);
  p.h.store.releaseEventWriteAcknowledgment = (id, owner) => {
    observed.push(p.h.store.eventWriteAcknowledgments(owner).find(row => row.observationId === id));
    return release(id, owner);
  };
  return observed;
}

for (const [locale, translated] of [
  ["en", noChanges], ["fr", "Aucune modification de ce résultat final."],
  ["ar", "لا توجد تغييرات على هذا المخرج النهائي."], ["ja", "この完成済みの出力に変更はありません。"],
]) test("verified unchanged Save " + locale + ": no event or revision, current editor completes truthfully", async t => {
  const p = await canonical(t, { locale }), before = durable(p), events = p.h.store.events.get(), content = p.h.store.content.get(), head = p.h.store.head.get();
  const seen = captureNoop(p), releases = observeOwnRelease(p);
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(1), true);
  assert.equal(seen.length, 1); assert.equal(seen[0].status, 200);
  assert.deepEqual(Object.keys(seen[0].body).sort(), ["appended", "content", "revision"]);
  assert.deepEqual(seen[0].body.appended, []); assert.equal(seen[0].body.revision, 1);
  assert.equal(seen[0].body.content[p.state.contentRef], before.bytes);
  assert.deepEqual(durable(p), before); assert.equal(p.h.store.events.get(), events);
  assert.equal(p.h.store.content.get(), content); assert.equal(p.h.store.head.get(), head);
  assert.equal(p.editor(), undefined); assert.ok(p.view()?.open); assert.equal(p.patches().length, 2);
  assert.equal(p.h.store.ui.toast, noChanges);
  assert.equal(p.f.host.i18n.system(p.h.store.ui.toast), translated, "actual current viewer locale translates the no-change notice");
  assert.equal(receipts(p).length, 0);
  assert.equal(releases.length, 1); assert.deepEqual(releases[0].committed, []);
  assert.deepEqual(releases[0].rejectedIndices, []); assert.equal(releases[0].observedHead, null);
  assert.equal(releases[0].outcome, "observed", "administrative response observation, never a committed authoring event");
  assert.equal(releases[0].privateUnavailable, false);
});

for (const field of ["markdown", "title", "body", "notes"]) test("verified unchanged Save preserves later " + field + " B until a separate explicit Save", async t => {
  const p = await canonical(t, { count: field === "markdown" ? 1 : 2 }), before = durable(p), reply = holdEditReply(p);
  p.click(p.button("#saveArtifactEdit")); const actual = await reply.entered.promise;
  assert.equal(actual.status, 200); assert.deepEqual(actual.body.appended, []);
  p.type("Newer unsaved " + field + " B.", field); reply.release.resolve();
  assert.equal(await p.finish(1), true); assert.equal(fieldValue(p, field), "Newer unsaved " + field + " B.");
  assert.deepEqual(durable(p), before); assert.equal(p.revision(), 1); assert.equal(p.patches().length, 2);
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(2), true);
  assert.equal(p.calls[2].args[1].expectedRevision, 1); assert.equal(p.revision(), 2);
  assert.equal(p.patches().length, 3); assert.equal(p.editor(), undefined);
  assert.equal(field === "markdown" ? p.retained().content_markdown : p.retained().items[0][field], "Newer unsaved " + field + " B.");
});

for (const field of ["markdown", "title", "body", "notes"]) test("verified unchanged Save cannot erase " + field + " A-B-A input intent", async t => {
  const p = await canonical(t, { count: field === "markdown" ? 1 : 2 }), a = fieldValue(p, field), before = durable(p), reply = holdEditReply(p);
  p.click(p.button("#saveArtifactEdit")); assert.deepEqual((await reply.entered.promise).body.appended, []);
  p.type("Intermediate " + field + " B.", field); p.type(a, field); reply.release.resolve();
  assert.equal(await p.finish(1), true); assert.ok(p.editor()); assert.equal(fieldValue(p, field), a);
  assert.deepEqual(durable(p), before); assert.equal(p.patches().length, 2);
  // A second explicit unchanged Save is a new human activation, not an automatic retry.
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(2), true);
  assert.equal(p.editor(), undefined); assert.equal(p.patches().length, 3); assert.deepEqual(durable(p), before);
});

test("unchanged Save checks every item and keeps the same exact multi-item bytes", async t => {
  const p = await editSetup(t, { count: 2 });
  p.type("Canonical multi-item manuscript.");
  p.type("Second item exact title", "title", 1); p.type("Second item exact body", "body", 1); p.type("Second item exact notes", "notes", 1);
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(), true); reopen(p);
  const before = durable(p), seen = captureNoop(p);
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(1), true);
  assert.equal(seen[0].request.items.length, 2); assert.deepEqual(seen[0].body.appended, []);
  assert.deepEqual(durable(p), before); assert.equal(p.editor(), undefined); assert.equal(receipts(p).length, 0);
});

test("verified unchanged Save also completes at original revision zero", async t => {
  const p = await editSetup(t), before = durable(p), seen = captureNoop(p);
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(), true);
  assert.equal(seen[0].status, 200); assert.deepEqual(seen[0].body.appended, []);
  assert.equal(seen[0].body.revision, 0); assert.equal(p.revision(), 0);
  assert.deepEqual(durable(p), before); assert.equal(p.editor(), undefined); assert.equal(receipts(p).length, 0);
});

test("identical displayed text still submits when the existing parser normalizes retained item bytes", async t => {
  const p = await editSetup(t);
  // A real authored Save retains this newline verbatim. Reopening uses the
  // existing parser, which trims the item body but not the Markdown field.
  p.type("Canonical A with a trailing newline.\n");
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(), true); reopen(p);
  const before = retainedBytes(p), shown = p.editor().value, seen = captureNoop(p);
  assert.equal(p.retained().items[0].body, shown);
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(1), true);
  assert.equal(seen.length, 1); assert.equal(seen[0].request.markdown, shown);
  assert.equal(seen[0].request.items[0].body, shown.trim());
  assert.equal(seen[0].status, 200); assert.equal(seen[0].body.appended.filter(row => row.type === "DocumentArtifactEdited").length, 1);
  assert.notEqual(retainedBytes(p), before); assert.equal(p.revision(), 2); assert.equal(p.editor(), undefined);
  assert.notEqual(p.h.store.ui.toast, noChanges); assert.equal(receipts(p).length, 0);
  reopen(p); const normalized = durable(p);
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(2), true);
  assert.deepEqual(seen[1].body.appended, []); assert.deepEqual(durable(p), normalized);
});

const faults = [
  ["missing content", body => { delete body.content; return body; }],
  ["wrong content reference", (body, p) => ({ ...body, content: { wrong: body.content[p.state.contentRef] } })],
  ["extra content reference", body => ({ ...body, content: { ...body.content, unrelated: "private bytes" } })],
  ["different bytes", (body, p) => ({ ...body, content: { [p.state.contentRef]: body.content[p.state.contentRef] + " " } })],
  ["different submitted item", (body, p) => { const value = JSON.parse(body.content[p.state.contentRef]); value.items[0].notes = "Mismatched item"; return { ...body, content: { [p.state.contentRef]: JSON.stringify(value) } }; }],
  ["different revision", body => ({ ...body, revision: body.revision + 1 })],
  ["string revision", body => ({ ...body, revision: String(body.revision) })],
  ["missing revision", body => { delete body.revision; return body; }],
  ["generic empty append with head", body => ({ ...body, head: 1 })],
  ["extra status", body => ({ ...body, status: "saved" })],
  ["non-array appended", body => ({ ...body, appended: {} })],
  ["unmatched appended event", body => ({ ...body, appended: [{ type: "DocumentArtifactEdited" }] })],
  ["empty object", () => ({})],
  ["array body", () => []],
  ["null body", () => null],
];
for (const [label, fault] of faults) test("no-op transport negative: " + label + " remains unknown under the original observation", async t => {
  const p = await canonical(t), before = durable(p), events = p.h.store.events.get(), content = p.h.store.content.get(), releases = observeOwnRelease(p);
  const seen = captureNoop(p, (response, body) => Response.json(fault(body, p)));
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(1), false);
  assert.equal(seen.length, 1); assert.equal(seen[0].status, 200);
  assert.equal(p.patches().length, 2); assert.deepEqual(durable(p), before);
  assert.equal(p.h.store.events.get(), events); assert.equal(p.h.store.content.get(), content); assert.ok(p.editor());
  const observations = receipts(p); assert.equal(observations.length, 1); assert.equal(observations[0].outcome, "unconfirmed");
  assert.deepEqual(observations[0].committed, []); assert.equal(observations[0].observedHead, null);
  assert.equal(releases.length, 0); assert.notEqual(p.h.store.ui.toast, noChanges);
});

for (const fault of ["lost", "malformed JSON", "201", "500"]) test("no-op transport negative: " + fault + " cannot certify or repeat the original request", async t => {
  const p = await canonical(t), before = durable(p);
  const seen = captureNoop(p, (response, body) => {
    if (fault === "lost") throw new Error("SIMULATED lost actual no-op response");
    if (fault === "malformed JSON") return new Response("{", { status: 200, headers: { "content-type": "application/json" } });
    return Response.json(body, { status: Number(fault) });
  });
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(1), false);
  assert.equal(seen.length, 1); assert.equal(p.patches().length, 2); assert.ok(p.editor());
  assert.deepEqual(durable(p), before); assert.equal(receipts(p).length, 1);
  assert.equal(receipts(p)[0].outcome, "unconfirmed"); assert.deepEqual(receipts(p)[0].committed, []);
  assert.notEqual(p.h.store.ui.toast, noChanges);
});

test("complete submitted fields prevent a forged no-op envelope from acknowledging a real changed Save", async t => {
  const p = await canonical(t), before = retainedBytes(p), oldEvents = p.h.store.events.get();
  p.type("Submitted changed B needs its own exact receipt.");
  const seen = captureNoop(p, () => Response.json({ appended: [], content: { [p.state.contentRef]: before }, revision: 1 }));
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(1), false);
  assert.equal(seen[0].status, 200); assert.equal(seen[0].body.appended.filter(row => row.type === "DocumentArtifactEdited").length, 1);
  assert.equal(p.retained().content_markdown, "Submitted changed B needs its own exact receipt.", "real server B remains durable despite the faulty transport envelope");
  assert.equal(p.editor().value, "Submitted changed B needs its own exact receipt.");
  assert.equal(p.h.store.events.get(), oldEvents); assert.equal(p.revision(), 1); assert.equal(p.patches().length, 2);
  assert.equal(receipts(p).length, 1); assert.equal(receipts(p)[0].outcome, "unconfirmed"); assert.deepEqual(receipts(p)[0].committed, []);
});

test("verified no-op removes only its own observation, never an older lost committed Save", async t => {
  const p = await canonical(t);
  p.type("Earlier changed B with a lost response.");
  captureNoop(p, () => { throw new Error("SIMULATED lost real changed acknowledgment"); });
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(1), false); p.h.intercept = null;
  const old = receipts(p); assert.equal(old.length, 1); assert.equal(old[0].outcome, "unconfirmed");
  assert.equal(p.retained().content_markdown, "Earlier changed B with a lost response.");
  await p.h.store.refreshEvents(); await p.h.store.ensurePrivateContent(p.state.contentRef, { force: true });
  p.f.draw(); p.click(p.button("#cancelArtifactEdit")); p.f.draw(); reopen(p);
  assert.equal(p.revision(), 2); const before = durable(p), seen = captureNoop(p), releases = observeOwnRelease(p);
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(2), true);
  assert.deepEqual(seen[0].body.appended, []); assert.deepEqual(durable(p), before); assert.equal(p.patches().length, 3);
  assert.deepEqual(receipts(p), old); assert.equal(releases.length, 1);
  assert.notEqual(releases[0].observationId, old[0].observationId); assert.equal(p.editor(), undefined);
});

test("no-op administrative completion cannot retire a newer explicit Store caller's queued write", async t => {
  const p = await canonical(t), replyA = holdEditReply(p);
  p.click(p.button("#saveArtifactEdit")); assert.deepEqual((await replyA.entered.promise).body.appended, []);
  const first = receipts(p); assert.equal(first.length, 1);
  const b = { ...structuredClone(p.calls[1].args[1]), markdown: "Separately requested B after A.",
    items: p.calls[1].args[1].items.map(item => ({ ...item, body: "Separately requested B after A." })) };
  // A second existing Store consumer can submit while this viewer owns A.
  // This is an explicit API caller, not a fabricated enabled second Save button.
  const pendingB = p.h.store.reviseDocumentArtifact(artifactId, b);
  const both = receipts(p); assert.equal(both.length, 2);
  const secondId = both.find(row => row.observationId !== first[0].observationId).observationId;
  assert.equal(p.patches().length, 2, "B has not bypassed the existing append pipeline");
  const replyB = holdEditReply(p); replyA.release.resolve(); assert.equal(await p.finish(1), true);
  const dispatchedB = await replyB.entered.promise;
  assert.equal(dispatchedB.status, 200); assert.equal(dispatchedB.body.appended.filter(row => row.type === "DocumentArtifactEdited").length, 1);
  assert.deepEqual(receipts(p).map(row => row.observationId), [secondId]);
  replyB.release.resolve(); assert.equal(await pendingB, true); assert.equal(receipts(p).length, 0);
  assert.equal(p.patches().length, 3); assert.equal(p.revision(), 2);
});

test("a late true no-op cannot replace newer canonical peer C or erase current B", async t => {
  const p = await canonical(t), reply = holdEditReply(p);
  p.click(p.button("#saveArtifactEdit")); const original = await reply.entered.promise;
  assert.equal(original.status, 200); assert.deepEqual(original.body.appended, []);
  p.type("New unsaved B while the no-op reply is delayed.");
  const input = { ...structuredClone(original.request), markdown: "Peer C became canonical.",
    items: original.request.items.map(item => ({ ...item, body: "Peer C became canonical." })) };
  const response = await p.h.worker.request("/api/artifacts/" + artifactId,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(response.status, 200); assert.equal((await response.json()).appended.filter(row => row.type === "DocumentArtifactEdited").length, 1);
  await p.h.store.refreshEvents(); await p.h.store.ensurePrivateContent(p.state.contentRef, { force: true });
  const before = durable(p), content = p.h.store.content.get(), events = p.h.store.events.get(), head = p.h.store.head.get();
  reply.release.resolve(); assert.equal(await p.finish(1), false);
  assert.equal(p.editor().value, "New unsaved B while the no-op reply is delayed.");
  assert.equal(p.revision(), 2); assert.equal(p.content().content_markdown, "Peer C became canonical.");
  assert.equal(p.h.store.content.get(), content); assert.equal(p.h.store.events.get(), events); assert.equal(p.h.store.head.get(), head);
  assert.deepEqual(durable(p), before); assert.equal(p.patches().length, 2);
  assert.equal(receipts(p).length, 1); assert.equal(receipts(p)[0].outcome, "unconfirmed"); assert.deepEqual(receipts(p)[0].committed, []);
});

test("same-revision local byte drift cannot certify an old no-op response", async t => {
  const p = await canonical(t), reply = holdEditReply(p);
  p.click(p.button("#saveArtifactEdit")); assert.deepEqual((await reply.entered.promise).body.appended, []);
  p.type("Newer B must survive mismatching current bytes.");
  // Explicit cache-corruption negative, not a claimed ordinary Worker edit.
  const changed = p.content(); changed.content_markdown = "Different local current bytes.";
  p.h.store.content.set({ ...p.h.store.content.get(), [p.state.contentRef]: JSON.stringify(changed) });
  const content = p.h.store.content.get(), before = durable(p);
  reply.release.resolve(); assert.equal(await p.finish(1), false);
  assert.equal(p.editor().value, "Newer B must survive mismatching current bytes.");
  assert.equal(p.h.store.content.get(), content); assert.deepEqual(durable(p), before); assert.equal(p.revision(), 1);
  assert.equal(receipts(p).length, 1); assert.equal(receipts(p)[0].outcome, "unconfirmed"); assert.equal(p.patches().length, 2);
});

test("genuine source denial during a held no-op keeps only the original unknown observation", async t => {
  const p = await canonical(t), reply = holdEditReply(p), owner = ownerFor(p), before = durable(p);
  p.click(p.button("#saveArtifactEdit")); assert.deepEqual((await reply.entered.promise).body.appended, []);
  p.type("Private newer B retires when source access is denied.");
  p.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND principal_user_id=?")
    .run(new Date().toISOString(), p.state.sharing.projectAccessId, p.state.owner);
  await assert.rejects(p.h.store.refreshEvents(), /403/); p.f.draw();
  assert.equal(p.editor(), undefined); assert.equal(p.view(), undefined);
  reply.release.resolve(); assert.equal(await p.finish(1), false);
  const original = p.h.store.eventWriteAcknowledgments(owner); assert.equal(original.length, 1);
  assert.equal(original[0].outcome, "unconfirmed"); assert.deepEqual(original[0].committed, []);
  assert.equal(original[0].privateUnavailable, true); assert.equal(JSON.stringify(original).includes("Private newer B"), false);
  assert.deepEqual(p.h.store.content.get(), {}); assert.deepEqual(durable(p), before); assert.equal(p.patches().length, 2);
});

test("actual denied artifact PATCH never becomes known no-change", async t => {
  const p = await canonical(t), before = durable(p), responses = [];
  p.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND principal_user_id=?")
    .run(new Date().toISOString(), p.state.sharing.projectAccessId, p.state.owner);
  p.h.intercept = async request => {
    if (request.init.method !== "PATCH") return;
    const response = await p.h.worker.request(request.url, request.init); responses.push(response.status); return response;
  };
  p.click(p.button("#saveArtifactEdit")); assert.equal(await p.finish(1), false);
  assert.deepEqual(responses, [403]); assert.equal(p.patches().length, 2); assert.deepEqual(durable(p), before);
  assert.equal(receipts(p).length, 1); assert.equal(receipts(p)[0].outcome, "unconfirmed");
  assert.deepEqual(receipts(p)[0].committed, []); assert.notEqual(p.h.store.ui.toast, noChanges);
});


async function activitySetup(t) {
  const h = await createSceneStoreHost({ count: 1, shared: true }), state = h.worker;
  const f = native.fixture("create", { artifact: true });
  f.host.disconnectedCallback(); f.host.isConnected = false; f.store = h.store;
  const { FormaActivityIssuePanel } = await native.loadActual("src/components/forma-activity-issue-panel.ts");
  f.host = new FormaActivityIssuePanel(); f.host.store = h.store; f.host.isConnected = true; f.host.connectedCallback();
  const project = h.store.session.get().projectContext, ids = ["current-activity-change", "unrelated-activity-change"];
  const event = state.sqlite.prepare("SELECT event_id FROM events WHERE type='DocumentRenderCompleted' ORDER BY sequence DESC LIMIT 1").get();
  const now = new Date().toISOString(), expires = new Date(Date.now() + 3600000).toISOString();
  // Explicit notification fixture seeds, not evidence of a performed independent
  // review. The read acknowledgment uses the actual scoped Worker endpoint.
  for (const [index, id] of ids.entries()) state.sqlite.prepare(
    "INSERT INTO project_notifications(notification_id,project_access_id,organization_id,project_id,recipient_user_id,event_id,kind,artifact_id,document_id,message,created_at,expires_at,read_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)"
  ).run(id, project.projectAccessId, project.organizationId, project.projectId, state.owner, event.event_id + "-notification-seed-" + index,
    "changes_requested", artifactId, state.documentId, "Fixture-owned correction notification.", now, expires);
  const notificationReply = await h.worker.request("/api/project-notifications"); assert.equal(notificationReply.status, 200);
  const notifications = (await notificationReply.json()).notifications;
  h.store.projectNotifications.set(notifications); f.host.notification = notifications.find(row => row.id === ids[0]);
  assert.ok(f.host.notification); f.draw();
  const financeTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
  const finance = () => Object.fromEntries(financeTables.map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const beforeFinance = finance(), calls = [], acknowledgments = [], releases = [];
  const originalRead = h.store.ensurePrivateContent.bind(h.store), originalSave = h.store.reviseDocumentArtifact.bind(h.store),
    originalAck = h.store.acknowledgeProjectNotification.bind(h.store);
  let readPending;
  h.store.ensurePrivateContent = (...args) => (readPending = originalRead(...args));
  h.store.reviseDocumentArtifact = (...args) => { const pending = originalSave(...args); calls.push({ args: structuredClone(args), pending }); return pending; };
  h.store.acknowledgeProjectNotification = id => { const pending = originalAck(id); acknowledgments.push({ id, pending }); return pending; };
  t.after(async () => {
    for (const release of releases) release.resolve();
    await Promise.allSettled([readPending, ...calls.map(row => row.pending), ...acknowledgments.map(row => row.pending)].filter(Boolean));
    assert.deepEqual(finance(), beforeFinance);
    h.store.ensurePrivateContent = originalRead; h.store.reviseDocumentArtifact = originalSave; h.store.acknowledgeProjectNotification = originalAck;
    f.host.disconnectedCallback(); f.host.isConnected = false; await h.close();
  });
  const own = tag => f.renderer.ownNodes(f.host, tag), editor = () => own("textarea").find(node => node.attributes.rows === "8");
  const itemInput = field => field === "markdown" ? editor()
    : own(field === "title" ? "input" : "textarea").find(node => node.handlers.input?.toString().includes("item." + field));
  const click = node => { assert.ok(node && node.isConnected && f.renderer.nodes.includes(node)); assert.equal(Object.hasOwn(node.attributes, "disabled"), false); node.click(); };
  const correct = own("button").find(node => node.handlers.click?.toString().includes("#startCorrection")); click(correct);
  assert.ok(readPending); await readPending; await Promise.resolve(); f.draw(); assert.ok(editor());
  const type = (value, field = "markdown") => {
    const node = itemInput(field); assert.ok(node && node.isConnected && f.renderer.nodes.includes(node));
    assert.equal(Object.hasOwn(node.attributes, "disabled"), false); assert.equal(Object.hasOwn(node.attributes, "readonly"), false);
    node.value = value; node.handlers.input.call(f.host, { target: node, currentTarget: node }); f.draw();
  };
  const save = () => {
    const form = own("form").find(node => node.handlers.submit?.toString().includes("#saveCorrection"));
    const button = own("button").find(node => node.attributes.type === "submit");
    assert.ok(form && form.isConnected); assert.ok(button); assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    let prevented = 0; form.handlers.submit.call(f.host, { target: form, currentTarget: form, preventDefault() { prevented++; } });
    assert.equal(prevented, 1);
  };
  const finish = async (index = 0) => {
    const result = await calls[index].pending; await Promise.resolve();
    for (const row of acknowledgments) assert.equal(await row.pending, true);
    f.draw(); return result;
  };
  const data = () => ({
    content: state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(state.contentRef).content,
    events: state.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all(),
    revisions: state.sqlite.prepare("SELECT * FROM artifact_revisions ORDER BY artifact_id,revision").all(),
    head: h.store.head.get(),
  });
  const mutations = () => h.requests.filter(row => ["POST", "PATCH"].includes(row.init.method));
  return { h, state, f, ids, calls, acknowledgments, releases, own, editor, itemInput, click, type, save, finish, data, mutations };
}

for (const changed of [false, true]) test("current Activity " + (changed ? "changed" : "unchanged") + " correction completes and separately marks only its existing notification read", async t => {
  const p = await activitySetup(t), before = p.data(), reply = holdEditReply(p);
  if (changed) p.type("Activity correction A.");
  p.save(); const actual = await reply.entered.promise; p.f.draw();
  assert.equal(actual.status, 200); assert.equal(actual.body.appended.filter(row => row.type === "DocumentArtifactEdited").length, changed ? 1 : 0);
  assert.equal(actual.body.revision, changed ? 1 : 0);
  const saveButton = p.own("button").find(node => node.attributes.type === "submit");
  assert.equal(Object.hasOwn(saveButton.attributes, "disabled"), true);
  assert.equal(Object.hasOwn(p.editor().attributes, "disabled"), false, "existing inputs remain editable; busy only disables another Save");
  reply.release.resolve(); assert.equal(await p.finish(), true); assert.equal(p.editor(), undefined);
  assert.deepEqual(p.acknowledgments.map(row => row.id), [p.ids[0]]);
  const rows = p.state.sqlite.prepare("SELECT notification_id,read_at FROM project_notifications WHERE notification_id IN (?,?) ORDER BY notification_id").all(...p.ids);
  assert.equal(typeof rows.find(row => row.notification_id === p.ids[0]).read_at, "string");
  assert.equal(rows.find(row => row.notification_id === p.ids[1]).read_at, null);
  assert.deepEqual(p.mutations().map(row => [row.init.method, row.url]),
    [["PATCH", "/api/artifacts/" + artifactId], ["PATCH", "/api/project-notifications"]]);
  assert.deepEqual(p.mutations()[1].body, { notificationId: p.ids[0] });
  if (!changed) { assert.deepEqual(p.data(), before); assert.equal(p.h.store.ui.toast, noChanges); }
  else { assert.equal(JSON.parse(p.data().content).content_markdown, "Activity correction A."); assert.notEqual(p.h.store.ui.toast, noChanges); }
});

for (const changed of [false, true]) for (const field of ["markdown", "title", "body", "notes"])
  test("Activity " + (changed ? "changed" : "no-op") + " A keeps newer " + field + " B and postpones Mark read until explicit B Save", async t => {
    const p = await activitySetup(t), before = p.data(), reply = holdEditReply(p);
    if (changed) p.type("Activity original changed A.");
    p.save(); const actual = await reply.entered.promise; assert.equal(actual.status, 200);
    p.type("Activity newer unsaved " + field + " B.", field);
    reply.release.resolve(); const result = await p.finish();
    t.diagnostic(JSON.stringify({ changed, field, result, editorVisible: Boolean(p.editor()),
      currentValue: p.itemInput(field)?.value ?? null, acknowledgedNotificationIds: p.acknowledgments.map(row => row.id),
      committedEditEvents: actual.body.appended.filter(row => row.type === "DocumentArtifactEdited").length }));
    assert.equal(result, true); assert.ok(p.editor()); assert.equal(p.itemInput(field).value, "Activity newer unsaved " + field + " B.");
    assert.deepEqual(p.acknowledgments, [], "A may not mark the card read while B remains unsaved");
    assert.equal(p.mutations().length, 1); if (!changed) assert.deepEqual(p.data(), before);
    p.save(); assert.equal(await p.finish(1), true); assert.equal(p.calls[1].args[1].expectedRevision, changed ? 1 : 0);
    assert.equal(p.editor(), undefined); assert.deepEqual(p.acknowledgments.map(row => row.id), [p.ids[0]]);
    assert.deepEqual(p.mutations().map(row => row.url), ["/api/artifacts/" + artifactId, "/api/artifacts/" + artifactId, "/api/project-notifications"]);
    const value = JSON.parse(p.data().content);
    assert.equal(field === "markdown" ? value.content_markdown : value.items[0][field], "Activity newer unsaved " + field + " B.");
  });

for (const field of ["markdown", "title", "body", "notes"]) test("Activity no-op " + field + " A-B-A remains a newer unsaved intent", async t => {
  const p = await activitySetup(t), before = p.data(), reply = holdEditReply(p), a = p.itemInput(field).value;
  p.save(); assert.deepEqual((await reply.entered.promise).body.appended, []);
  p.type("Intermediate Activity " + field + " B.", field); p.type(a, field); reply.release.resolve();
  const result = await p.finish();
  t.diagnostic(JSON.stringify({ field, result, editorVisible: Boolean(p.editor()), acknowledgedNotificationIds: p.acknowledgments.map(row => row.id) }));
  assert.equal(result, true); assert.ok(p.editor()); assert.equal(p.itemInput(field).value, a);
  assert.deepEqual(p.data(), before); assert.deepEqual(p.acknowledgments, []);
  p.save(); assert.equal(await p.finish(1), true); assert.equal(p.editor(), undefined);
  assert.deepEqual(p.data(), before); assert.deepEqual(p.acknowledgments.map(row => row.id), [p.ids[0]]);
});

test("Activity genuine revision conflict preserves B and never marks the notification read", async t => {
  const p = await activitySetup(t), reply = holdEditReply(p, { reject: true });
  p.type("Activity submitted A."); p.save(); const response = await reply.entered.promise;
  assert.equal(response.status, 409); assert.equal(response.body.error, "artifact_revision_conflict");
  p.type("Activity B after the rejected correction."); reply.release.resolve();
  assert.equal(await p.finish(), false); assert.equal(p.editor().value, "Activity B after the rejected correction.");
  assert.deepEqual(p.acknowledgments, []); assert.equal(p.mutations().length, 1);
  p.save(); assert.equal(await p.finish(1), true); assert.equal(p.calls[1].args[1].expectedRevision, 0);
  assert.equal(p.editor(), undefined); assert.deepEqual(p.acknowledgments.map(row => row.id), [p.ids[0]]);
});

test("Activity canceled edit ownership cannot mark its notification read after A acknowledgment", async t => {
  const p = await activitySetup(t), reply = holdEditReply(p);
  p.save(); assert.deepEqual((await reply.entered.promise).body.appended, []);
  const cancel = p.own("button").find(node => node.handlers.click?.toString().includes('this.#editingArtifactId = ""'));
  p.click(cancel); p.f.draw(); assert.equal(p.editor(), undefined);
  const correct = p.own("button").find(node => node.handlers.click?.toString().includes("#startCorrection"));
  assert.equal(Object.hasOwn(correct.attributes, "disabled"), true, "a new editor is not invented while the original operation is busy");
  reply.release.resolve(); assert.equal(await p.finish(), true);
  assert.equal(p.editor(), undefined); assert.deepEqual(p.acknowledgments, []); assert.equal(p.mutations().length, 1);
  assert.equal(Object.hasOwn(p.own("button").find(node => node.handlers.click?.toString().includes("#startCorrection")).attributes, "disabled"), false);
});

test("Activity notification property rebind cannot borrow B's notification or clear its current field", async t => {
  const p = await activitySetup(t), reply = holdEditReply(p);
  p.save(); assert.deepEqual((await reply.entered.promise).body.appended, []);
  // Scoped keys give another notification its own connected child; a foreign
  // prop no longer exposes the original child's draft. Model that real parent
  // replacement, then open B through its current native Correct control.
  const originalOwner = p.f.host;
  originalOwner.isConnected = false; originalOwner.disconnectedCallback();
  const { FormaActivityIssuePanel } = await native.loadActual("src/components/forma-activity-issue-panel.ts");
  p.f.host = new FormaActivityIssuePanel(); p.f.host.store = p.h.store; p.f.host.i18n = p.f.i18n;
  p.f.host.notification = p.h.store.projectNotifications.get().find(row => row.id === p.ids[1]);
  p.f.host.isConnected = true; p.f.host.connectedCallback(); p.f.draw();
  assert.notEqual(p.f.host, originalOwner); assert.equal(originalOwner.isConnected, false);
  p.click(p.own("button").find(node => node.handlers.click?.toString().includes("#startCorrection")));
  await p.f.host.updateComplete; p.f.draw();
  p.type("Current B belongs to the second notification."); reply.release.resolve();
  assert.equal(await p.finish(), true); assert.equal(p.editor().value, "Current B belongs to the second notification.");
  assert.deepEqual(p.acknowledgments, []); assert.equal(p.mutations().length, 1);
  p.save(); assert.equal(await p.finish(1), true); assert.deepEqual(p.acknowledgments.map(row => row.id), [p.ids[1]]);
  const rows = p.state.sqlite.prepare("SELECT notification_id,read_at FROM project_notifications WHERE notification_id IN (?,?)").all(...p.ids);
  assert.equal(rows.find(row => row.notification_id === p.ids[0]).read_at, null);
  assert.equal(typeof rows.find(row => row.notification_id === p.ids[1]).read_at, "string");
});
