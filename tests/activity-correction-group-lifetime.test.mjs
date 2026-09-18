// Actual complete Activity, IssuePanel, Store and in-memory Worker. Native DOM,
// render scheduling and delivery gates are explicit ports, not a browser certificate.
import assert from "node:assert/strict";
import test from "node:test";
import { correctionParent, holdEditReply, sceneDeferred, tick } from "./helpers/activity-correction-group-fixture.mjs";
import { formaActivityAttention, scopedFormaActivity } from "../src/model/activity.ts";

for (const locale of ["en", "fr", "ar", "ja"]) for (const otherTab of [false, true])
test("correction group / " + locale + " pre-save dirty draft survives " + (otherTab ? "another tab's real GET" : "current Mark read") + " until explicit Cancel", async t => {
  const p = await correctionParent(t, { locale }), original = await p.open(), draft = "Unsaved " + locale + " correction — exact original owner.";
  p.type(draft); p.assertGroups(p.ids, []);
  const before = p.data(), readAt = await p.mark(p.ids[0], otherTab);
  assert.ok(p.panel() === original && original.isConnected); assert.equal(p.editor().value, draft);
  assert.equal(p.panel().notification.readAt, readAt); assert.equal(p.markButton(), null);
  p.assertGroups(p.ids, []);
  assert.equal(formaActivityAttention(scopedFormaActivity(p.h.store.session.get(), p.h.store.projection.get(), p.h.store.projectNotifications.get(), [], [])), 1,
    "the global server-based unread badge is truthful even while a local unfinished correction keeps its row");
  assert.deepEqual(p.data(), before); assert.equal(p.calls.length, 0);
  let parentUpdates = 0; const requestUpdate = p.f.host.requestUpdate;
  t.mock.method(p.f.host, "requestUpdate", function(...args) { parentUpdates++; return requestUpdate.apply(this, args); });
  p.cancel();
  assert.ok(parentUpdates > 0, "explicit close notifies the existing parent without storing draft text");
  assert.equal(p.editor(), undefined); p.assertGroups([p.ids[1]], [p.ids[0]]);
  assert.equal(p.h.store.projectNotifications.get().find(row => row.id === p.ids[0]).readAt, readAt);
  assert.equal(p.calls.length, 0); assert.equal(p.acknowledgments.length, otherTab ? 0 : 1);
  const replacement = await p.open(); assert.notEqual(replacement, original);
  assert.notEqual(p.editor().value, draft, "Cancel does not leave a hidden duplicate draft"); p.cancel();
  assert.deepEqual(p.data(), before);
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const newer of [false, true])
test("correction group / " + locale + " held A after readAt " + (newer ? "retains B and its exact base" : "closes only unchanged A"), async t => {
  const p = await correctionParent(t, { locale }), original = await p.open();
  p.type("Actual original A " + locale); const gate = holdEditReply(p); p.save();
  const actual = await gate.entered.promise; assert.equal(actual.status, 200); assert.equal(actual.body.revision, 1);
  if (newer) p.type("Accepted unsaved B " + locale);
  const readAt = await p.mark(p.ids[0], true);
  assert.ok(p.panel() === original && original.isConnected); p.assertGroups(p.ids, []);
  gate.release.resolve(); assert.equal(await p.finish(), true);
  assert.equal(JSON.parse(p.data().content).content_markdown, "Actual original A " + locale);
  assert.deepEqual(p.acknowledgments, [], "the complete known readAt prevents an extra automatic ACK");
  if (newer) {
    assert.ok(p.panel() === original && original.isConnected); assert.equal(p.editor().value, "Accepted unsaved B " + locale);
    p.assertGroups(p.ids, []); assert.equal(p.calls.length, 1);
    p.save(); assert.equal(await p.finish(1), true); assert.equal(p.calls[1].args[1].expectedRevision, 1);
    assert.equal(JSON.parse(p.data().content).content_markdown, "Accepted unsaved B " + locale);
  }
  assert.equal(p.editor(), undefined); p.assertGroups([p.ids[1]], [p.ids[0]]);
  assert.equal(p.panel().notification.readAt, readAt); assert.deepEqual(p.acknowledgments, []);
  assert.equal(p.state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactEdited'").get().n, newer ? 2 : 1);
});

test("correction group / a verified unchanged Save releases a read row without an authoring event", async t => {
  const p = await correctionParent(t), original = await p.open(), before = p.data();
  await p.mark(p.ids[0], true); p.assertGroups(p.ids, []);
  const gate = holdEditReply(p); p.save(); const actual = await gate.entered.promise;
  assert.equal(actual.status, 200); assert.deepEqual(actual.body.appended, []); assert.equal(actual.body.revision, 0);
  gate.release.resolve(); assert.equal(await p.finish(), true);
  assert.equal(p.editor(), undefined); assert.equal(original.isConnected, false); p.assertGroups([p.ids[1]], [p.ids[0]]);
  assert.deepEqual(p.data(), before); assert.deepEqual(p.acknowledgments, []);
});

for (const otherTab of [false, true]) test("correction group / original loading owner survives " + (otherTab ? "remote readAt GET" : "current Mark read"), async t => {
  const p = await correctionParent(t), original = p.panel(), entered = sceneDeferred(), release = sceneDeferred();
  p.releases.push(release);
  // Evict only the page's optional cached value so the existing explicit opener
  // must perform its normal real Worker content read.
  const content = { ...p.h.store.content.get() }; delete content[p.state.contentRef]; p.h.store.content.set(content);
  p.h.intercept = async request => {
    if (!request.url.startsWith("/api/events?") || !request.url.includes("content=1")) return undefined;
    p.h.intercept = null;
    const response = await p.state.request(request.url, request.init); assert.equal(response.status, 200);
    entered.resolve(); await release.promise; return response;
  };
  p.start(); await entered.promise; p.draw();
  assert.equal(p.panel().correctionEditorOwner?.phase, "loading");
  const readAt = await p.mark(p.ids[0], otherTab);
  assert.ok(p.panel() === original && original.isConnected); assert.equal(p.panel().correctionEditorOwner?.phase, "loading");
  p.assertGroups(p.ids, []); release.resolve();
  for (let turn = 0; turn < 60 && !p.editor(); turn++) { await tick(); p.draw(); }
  assert.ok(p.editor()); assert.ok(p.panel() === original); assert.equal(p.panel().notification.readAt, readAt);
  assert.equal(p.panel().correctionEditorOwner?.phase, "editing"); assert.equal(p.calls.length, 0);
  p.cancel(); p.assertGroups([p.ids[1]], [p.ids[0]]);
});

for (const delayedA of [false, true]) test("correction group / genuine source403 " + (delayedA ? "during A" : "before Save") + " retires private B across source recovery", async t => {
  const p = await correctionParent(t), original = await p.open(), originalSource = p.h.store.captureSourceOwnership();
  let gate;
  if (delayedA) { p.type("Real A committed before source withdrawal."); gate = holdEditReply(p); p.save(); assert.equal((await gate.entered.promise).status, 200); }
  p.type("Private B must retire."); await p.mark(p.ids[0], true);
  p.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND principal_user_id=?")
    .run(new Date().toISOString(), p.state.sharing.projectAccessId, p.state.owner);
  await assert.rejects(p.h.store.refreshEvents(), /403/u); p.draw();
  assert.equal(p.h.store.sourceOwnershipActive(originalSource), false); assert.equal(original.correctionEditorOwner, null);
  assert.equal(original.isConnected, false); assert.equal(p.panel(), undefined);
  assert.equal(p.f.renderer.markup.includes("Private B must retire."), false);
  assert.deepEqual(p.h.store.content.get(), {});
  p.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE project_access_id=? AND principal_user_id=?")
    .run(p.state.sharing.projectAccessId, p.state.owner);
  await p.h.store.refreshEvents(); await p.h.store.syncProjectNotifications(); p.draw();
  assert.ok(p.h.store.sourceOwnershipActive(p.h.store.captureSourceOwnership())); assert.equal(p.h.store.sourceOwnershipActive(originalSource), false);
  assert.ok(p.panel() && p.panel() !== original); assert.equal(p.editor(), undefined);
  if (gate) { gate.release.resolve(); assert.equal(await p.finish(), false); }
  assert.equal(p.editor(), undefined); assert.equal(p.f.renderer.markup.includes("Private B must retire."), false);
  assert.equal(p.calls.length, delayedA ? 1 : 0); assert.deepEqual(p.acknowledgments, []);
  assert.equal(p.state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactEdited'").get().n, delayedA ? 1 : 0);
});

test("correction group / a real denied loading read cannot populate a recovered new owner", async t => {
  const p = await correctionParent(t), original = p.panel(), entered = sceneDeferred(), release = sceneDeferred(); p.releases.push(release);
  const content = { ...p.h.store.content.get() }; delete content[p.state.contentRef]; p.h.store.content.set(content);
  p.h.intercept = async request => {
    if (!request.url.startsWith("/api/events?") || !request.url.includes("content=1")) return undefined;
    p.h.intercept = null; const response = await p.state.request(request.url, request.init); assert.equal(response.status, 200);
    entered.resolve(); await release.promise; return response;
  };
  p.start(); await entered.promise; p.draw(); assert.equal(original.correctionEditorOwner?.phase, "loading");
  p.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?")
    .run(new Date().toISOString(), p.state.sharing.contextId);
  await assert.rejects(p.h.store.refreshEvents(), /403/u); p.draw();
  p.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(p.state.sharing.contextId);
  await p.h.store.refreshEvents(); await p.h.store.syncProjectNotifications(); p.draw();
  release.resolve(); for (let turn = 0; turn < 4; turn++) { await tick(); p.draw(); }
  assert.equal(original.isConnected, false); assert.equal(original.correctionEditorOwner, null);
  assert.ok(p.panel() !== original); assert.equal(p.editor(), undefined); assert.equal(p.calls.length, 0);
});

for (const reason of ["notification expired", "notification retargeted", "artifact custody absent", "retained body withdrawn", "route ABA", "captured deadline", "leave context"])
test("correction group / actual parent retires original owner for " + reason, async t => {
  const p = await correctionParent(t), original = await p.open(), before = p.data(), originalRoute = p.h.store.route.get();
  p.type("Original private draft for " + reason); await p.mark(p.ids[0], true);
  const currentNotifications = p.h.store.projectNotifications.get(), currentEvents = p.h.store.events.get(), currentContent = p.h.store.content.get();
  let restore = async () => {};
  if (reason === "notification expired") {
    const prior = p.state.sqlite.prepare("SELECT expires_at FROM project_notifications WHERE notification_id=?").get(p.ids[0]).expires_at;
    p.state.sqlite.prepare("UPDATE project_notifications SET expires_at=? WHERE notification_id=?").run("2020-01-01T00:00:00.000Z", p.ids[0]);
    await p.h.store.syncProjectNotifications();
    restore = async () => { p.state.sqlite.prepare("UPDATE project_notifications SET expires_at=? WHERE notification_id=?").run(prior, p.ids[0]); await p.h.store.syncProjectNotifications(); };
  } else if (reason === "notification retargeted") {
    // Exact current Store row delivery negative, not a claim that an ordinary
    // actor can rewrite immutable notification targets on the server.
    p.h.store.projectNotifications.set(currentNotifications.map(row => row.id === p.ids[0] ? { ...row, artifactId: "unavailable-other-output" } : row));
    restore = async () => p.h.store.projectNotifications.set(currentNotifications);
  } else if (reason === "artifact custody absent") {
    // Complete current source-projection withdrawal: use the actual fold after
    // withholding the artifact's retained publication event, never a permission mock.
    p.h.store.events.set(currentEvents.filter(row => row.payload.artifact_id !== "saved-scene-story"));
    restore = async () => p.h.store.events.set(currentEvents);
  } else if (reason === "retained body withdrawn") {
    const next = { ...currentContent }; delete next[p.state.contentRef]; p.h.store.content.set(next);
    restore = async () => p.h.store.content.set(currentContent);
  } else if (reason === "route ABA") {
    p.h.store.setRoute("/projects"); restore = async () => p.h.store.setRoute(originalRoute);
  } else if (reason === "captured deadline") {
    const deadline = Date.parse(p.h.store.session.get().projectContext.expiresAt);
    const clock = t.mock.method(Date, "now", () => deadline + 1); restore = async () => clock.mock.restore();
  } else {
    // Apply only genuine Set-Cookie headers in the in-memory transport, as a
    // browser would; the fixture otherwise deliberately keeps a fixed cookie.
    const cookies = new Map(p.state.sharing.headers.cookie.split(/;\s*/u).map(value => {
      const at = value.indexOf("="); return [value.slice(0, at), value.slice(at + 1)];
    }));
    p.h.transport = async request => {
      const response = await p.state.request(request.url, request.init);
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0], at = pair.indexOf("=");
        if (/max-age=0(?:;|$)/iu.test(cookie)) cookies.delete(pair.slice(0, at));
        else cookies.set(pair.slice(0, at), pair.slice(at + 1));
      }
      p.state.setScopedHeaders({ cookie: [...cookies].map(([name, value]) => name + "=" + value).join("; ") });
      return response;
    };
    assert.equal(await p.h.store.leaveProjectContext(), true);
    restore = async () => {
      const response = await p.state.request(`/api/workspaces/${p.state.sharing.organizationId}/projects/${p.state.sharing.projectAccessId}/context`, { method: "POST" });
      assert.equal(response.status, 200, await response.clone().text());
      const selected = response.headers.get("set-cookie").split(";")[0], at = selected.indexOf("=");
      cookies.set(selected.slice(0, at), selected.slice(at + 1));
      p.state.setScopedHeaders({ cookie: [...cookies].map(([name, value]) => name + "=" + value).join("; ") });
      await p.h.store.refreshSession(); await p.h.store.refreshEvents(); await p.h.store.syncProjectNotifications(); p.h.store.setRoute(originalRoute);
    };
  }
  p.draw(); assert.equal(original.correctionEditorOwner, null);
  assert.equal(p.editor(), undefined); assert.equal(p.f.renderer.markup.includes("Original private draft for " + reason), false);
  await restore(); p.draw(); assert.equal(p.editor(), undefined, "recovery does not resurrect a retired private draft");
  assert.equal(p.calls.length, 0); assert.deepEqual(p.acknowledgments, []);
  assert.equal(p.data().content, before.content); assert.deepEqual(p.data().events, before.events);
});

for (const order of ["reverse", "remove-first", "recent-reverse"]) test("correction group / distinct sibling drafts survive " + order, async t => {
  const p = await correctionParent(t);
  if (order === "recent-reverse") { await p.mark(p.ids[0], true); await p.mark(p.ids[1], true); }
  const owners = new Map();
  for (const id of p.ids) { owners.set(id, await p.open(id)); p.type("Only draft " + id, "markdown", id); }
  if (order === "remove-first") {
    p.state.sqlite.prepare("UPDATE project_notifications SET expires_at=? WHERE notification_id=?").run("2020-01-01T00:00:00.000Z", p.ids[0]);
    await p.h.store.syncProjectNotifications();
  } else {
    const response = await p.state.request("/api/project-notifications"); assert.equal(response.status, 200);
    const body = await response.json(); p.h.store.projectNotifications.set([...body.notifications].reverse());
  }
  p.draw();
  for (const id of order === "remove-first" ? [p.ids[1]] : p.ids) {
    assert.ok(p.panel(id) === owners.get(id) && owners.get(id).isConnected, "the exact sibling instance stays connected");
    assert.equal(p.editor(id)?.value, "Only draft " + id);
  }
  if (order === "remove-first") assert.equal(owners.get(p.ids[0]).isConnected, false);
  assert.equal(p.calls.length, 0); assert.deepEqual(p.acknowledgments, []);
});

test("correction group / willUpdate retires observed private-body withdrawal even without a group move", async t => {
  const p = await correctionParent(t), original = await p.open(), content = p.h.store.content.get();
  p.type("Private original draft cannot reappear after withdrawal.");
  const next = { ...content }; delete next[p.state.contentRef]; p.h.store.content.set(next);
  p.draw();
  assert.ok(p.panel() === original && original.isConnected, "the same unread row and component remain; no remount masks the lifecycle");
  assert.equal(original.correctionEditorOwner, null); assert.equal(p.editor(), undefined);
  p.h.store.content.set(content); p.draw();
  assert.ok(p.panel() === original && original.isConnected);
  assert.equal(original.correctionEditorOwner, null); assert.equal(p.editor(), undefined,
    "later cache availability does not resurrect a retired private draft");
  assert.equal(p.calls.length, 0); assert.deepEqual(p.acknowledgments, []);
});
