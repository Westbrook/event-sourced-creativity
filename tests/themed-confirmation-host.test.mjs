import test from "node:test";
import assert from "node:assert/strict";
import { confirmationFixture, deferred, turn, until } from "./helpers/themed-confirmation-native.mjs";

// Complete current Account/Replay classes and the real shared confirmation.
// Creator session/authorization is the existing in-memory Worker/Store fixture;
// privacy execution is an observed public-method boundary, not a deletion test.
// Replay uses the real platform session module, with native event and exact HTTP
// response ports. No paid, persona, provider or real server mutation is invoked.
async function account(t) {
  const f = await confirmationFixture(t, { application: true });
  f.store.route.set("/settings");
  assert.equal(f.store.session.get().user.role, "admin", "genuine existing local Worker bootstrap is the administrator");
  assert.equal(f.store.session.get().projectContext, undefined);
  await f.mount("src/components/forma-account-settings.ts", "FormaAccountSettings", "forma-account-settings");
  return f;
}
const methods = { migrate: "migrateHistoricalEventPrivacy", erase: "erasePersonalAuthoredContext" };
const descriptions = {
  migrate: "Move historical authored event bodies into erasable owner-scoped storage? Event identities, revisions, project permissions, and finished outputs are preserved.",
  erase: "Permanently erase the authored context and temporary private processing data from your personal projects? Finished outputs, uploaded files, shared organization work, backups, and other devices are not deleted.",
};
function observePrivacy(f, action, result = Promise.resolve(true)) {
  const calls = [], original = f.store[methods[action]];
  f.store[methods[action]] = function (...args) { calls.push({ owner: this, args }); return result; };
  return { calls, restore: () => { f.store[methods[action]] = original; } };
}
for (const action of Object.keys(methods)) test(`Account ${action} confirms the exact unchanged intent once and does not hold focus during its request`, async (t) => {
  const f = await account(t), gate = deferred(), observed = observePrivacy(f, action, gate.promise); t.after(observed.restore);
  const invoker = f.control(JSON.stringify(action)), pending = f.click(invoker);
  const dialog = f.dialog(); assert.ok(dialog); assert.equal(dialog.querySelector("p").textContent, f.i18n.system(descriptions[action]));
  await f.click(invoker); assert.equal(f.dialog(), dialog); assert.equal(observed.calls.length, 0);
  f.confirm(); await until(() => observed.calls.length === 1, "one actual privacy method dispatch");
  assert.equal(f.doc.activeElement, invoker); assert.equal(f.dialog(), null);
  assert.equal(observed.calls[0].owner, f.store); assert.deepEqual(observed.calls[0].args, []);
  const disabled = f.control(JSON.stringify(action)); assert.equal(disabled.disabled, true);
  await f.click(invoker); assert.equal(observed.calls.length, 1, "the pending slot also rejects a stale handler");
  const other = f.native("input"); f.doc.body.append(other); other.focus(); f.emitWindow("keydown", { target: other });
  gate.resolve(true); await pending; assert.equal(f.doc.activeElement, other);
  assert.equal(f.control(JSON.stringify(action)).disabled, false); assert.equal(observed.calls.length, 1);
});

for (const action of Object.keys(methods)) test(`Account ${action} Cancel executes no privacy operation and permits a fresh explicit confirmation`, async (t) => {
  const f = await account(t), observed = observePrivacy(f, action); t.after(observed.restore);
  const invoker = f.control(JSON.stringify(action)), pending = f.click(invoker);
  f.cancel(); await pending; assert.equal(observed.calls.length, 0); assert.equal(f.doc.activeElement, invoker);
  const next = f.click(f.control(JSON.stringify(action))); f.confirm(); await next; assert.equal(observed.calls.length, 1);
});

for (const action of Object.keys(methods)) for (const change of ["route ABA", "principal ABA", "disconnect"]) test(`Account ${action} ${change} retires the old confirmation without dispatch`, async (t) => {
  const f = await account(t), observed = observePrivacy(f, action); t.after(observed.restore);
  const invoker = f.control(JSON.stringify(action)), pending = f.click(invoker), old = f.dialog(), form = old.querySelector("form"), confirm = f.buttons()[1];
  if (change === "route ABA") {
    const route = f.store.route.get(); f.store.route.set("/library"); f.store.notify(); f.store.route.set(route); f.store.notify();
  } else if (change === "principal ABA") {
    const session = f.store.session.get(); f.store.session.set({ ...session, user: { ...session.user, userId: "different-principal" } }); f.store.notify();
    f.store.session.set(session); f.store.notify();
  } else { f.host.isConnected = false; f.host.disconnectedCallback(); }
  confirm.emit("click", { isTrusted: true }); form.emit("submit", { submitter: confirm, isTrusted: true }); await pending;
  assert.equal(old.isConnected, false); assert.equal(observed.calls.length, 0);
});

test("Account retained handlers cannot bypass personal-context, impersonation or administrator gates", async (t) => {
  const f = await account(t), original = f.store.session.get(), migration = observePrivacy(f, "migrate"), erasure = observePrivacy(f, "erase");
  t.after(migration.restore); t.after(erasure.restore);
  const migrate = f.control(JSON.stringify("migrate")), erase = f.control(JSON.stringify("erase"));
  const fictionalUser = { ...original.user, userId: "other-persona", role: "creator" };
  for (const patch of [
    { projectContext: { organizationId: "other-organization", projectAccessId: "other-access", projectId: "other-project", ownerUserId: original.user.userId, role: "viewer", permissions: ["project.read"], expiresAt: new Date(Date.now() + 3600_000).toISOString() } },
    { user: fictionalUser, impersonation: { active: true, impersonationId: "other-impersonation", personaId: "other-persona", replaySessionId: "other-replay", actor: original.user, fictionalUser, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() } },
  ]) {
    f.store.session.set({ ...original, ...patch }); await f.click(migrate); await f.click(erase); assert.equal(f.dialog(), null);
  }
  f.store.session.set({ ...original, user: { ...original.user, role: "creator" } }); await f.click(migrate); assert.equal(f.dialog(), null);
  assert.equal(migration.calls.length, 0); assert.equal(erasure.calls.length, 0); f.store.session.set(original);
});

const failedSession = () => ({ sessionId: "failed-owned-A", status: "failed", title: "Original unfinished replay <literal>",
  summary: "An existing owner-isolated failed record", eventCount: 12, imageCount: 2, createdAt: "2026-08-27T00:00:00.000Z",
  error: "unfinished", persona: null, usage: {} });
async function replay(t, { locale = "en" } = {}) {
  const f = await confirmationFixture(t, { application: true, locale });
  f.store.route.set("/product/evaluation/actual"); f.replay = { rows: [failedSession()], gets: [], deletes: [], onGet: null, onDelete: null };
  f.transport.handler = async (request) => {
    if (request.method === "GET" && request.url === "/api/session?audience=product") return f.storeHost.worker.request(request.url);
    if (request.method === "GET" && request.url === "/api/replay-sessions") {
      f.replay.gets.push(request);
      if (f.replay.onGet) return f.replay.onGet(request);
      return Response.json({ sessions: f.replay.rows, liveGeneration: { enabled: false, configured: false, approvalPhrase: "unused", confirmationVersion: "unused" } });
    }
    if (request.method === "DELETE" && request.url === "/api/replay-sessions/failed-owned-A") {
      f.replay.deletes.push(request);
      if (f.replay.onDelete) return f.replay.onDelete(request);
      f.replay.rows = []; return Response.json({ archived: true });
    }
    assert.fail("Unexpected Replay transport: " + request.method + " " + request.url);
  };
  const session = await f.platform.platformSession.load("product"); assert.equal(session.audience, "product"); assert.equal(session.user.role, "admin");
  await f.mount("src/apps/product/actual-replay.ts", "FormaActualReplay", "forma-actual-replay");
  await until(() => f.draw().includes("Original unfinished replay"), "the actual Replay class renders its exact list response");
  f.archive = () => f.control("#archive"); f.refresh = () => f.control("#load");
  return f;
}

for (const locale of ["en", "fr", "ar", "ja"]) test(`${locale} Replay archive uses localized exact-source confirmation and Cancel sends no DELETE`, async (t) => {
  const f = await replay(t, { locale }), invoker = f.archive(), pending = f.click(invoker);
  const dialog = f.dialog(); assert.ok(dialog); assert.equal(dialog.lang, locale); assert.equal(dialog.dir, locale === "ar" ? "rtl" : "ltr");
  assert.equal(dialog.querySelector("p").textContent, f.i18n.t("replay.actual.confirmArchive", "Archive this failed session and permanently remove its unfinished generated media?") + "\n" + f.replay.rows[0].title);
  assert.equal(f.buttons()[1].textContent, f.i18n.t("replay.actual.archive", "Archive failed session"));
  f.cancel(); await pending; assert.equal(f.replay.deletes.length, 0); assert.equal(f.replay.gets.length, 1); assert.equal(f.doc.activeElement, invoker);
});

test("Replay archive requires trusted opening and a separate trusted positive confirmation", async (t) => {
  const f = await replay(t), invoker = f.archive();
  await f.click(invoker, false); assert.equal(f.dialog(), null); assert.equal(f.replay.deletes.length, 0);
  const pending = f.click(invoker); f.confirm(false); await turn(); assert.ok(f.dialog()); assert.equal(f.replay.deletes.length, 0);
  f.cancel(); await pending; assert.equal(f.replay.deletes.length, 0);
});

test("Replay archive dispatches exactly the selected failed ID once, then refreshes only its owned success", async (t) => {
  const f = await replay(t), gate = deferred(); f.replay.onDelete = () => gate.promise;
  const invoker = f.archive(), pending = f.click(invoker), originalDialog = f.dialog();
  await f.click(invoker); assert.equal(f.dialog(), originalDialog); assert.equal(f.replay.deletes.length, 0);
  f.confirm(); await until(() => f.replay.deletes.length === 1, "one exact archive DELETE");
  assert.deepEqual(f.replay.deletes[0], { method: "DELETE", url: "/api/replay-sessions/failed-owned-A", init: { method: "DELETE" } });
  assert.equal(f.archive().disabled, true);
  await f.click(invoker); assert.equal(f.replay.deletes.length, 1); assert.equal(f.doc.activeElement, invoker);
  const other = f.native("input"); f.doc.body.append(other); other.focus();
  f.replay.rows = []; gate.resolve(Response.json({ archived: true })); await pending;
  assert.equal(f.replay.gets.length, 2); assert.equal(f.replay.deletes.length, 1); assert.equal(f.doc.activeElement, other);
  assert.ok(!f.draw().includes("Original unfinished replay")); assert.equal(f.dialog(), null);
  assert.equal(f.transport.requests.filter((request) => request.method === "POST").length, 0);
});

for (const change of ["refresh", "route ABA", "platform principal ABA", "disconnect"]) test(`Replay archive ${change} retires an unsent confirmation`, async (t) => {
  const f = await replay(t), pending = f.click(f.archive()), old = f.dialog(), form = old.querySelector("form"), confirm = f.buttons()[1];
  if (change === "refresh") { f.replay.rows = [{ ...failedSession(), status: "complete" }]; await f.click(f.refresh()); }
  else if (change === "route ABA") {
    f.store.route.set("/product/evaluation"); f.emitWindow("popstate"); f.store.route.set("/product/evaluation/actual"); f.emitWindow("popstate");
  } else if (change === "platform principal ABA") { f.platform.platformSession.reset(); await f.platform.platformSession.load("product"); }
  else { f.host.isConnected = false; f.host.disconnectedCallback(); }
  confirm.emit("click", { isTrusted: true }); form.emit("submit", { submitter: confirm, isTrusted: true }); await pending;
  assert.equal(old.isConnected, false); assert.equal(f.replay.deletes.length, 0);
});

for (const outcome of ["success", "error"]) test(`Replay ignores a sent archive's late ${outcome} after route retirement without claiming cancellation`, async (t) => {
  const f = await replay(t), gate = deferred(); f.replay.onDelete = () => gate.promise;
  const pending = f.click(f.archive()); f.confirm(); await until(() => f.replay.deletes.length === 1, "archive dispatched before retirement");
  f.store.route.set("/product/evaluation"); f.emitWindow("popstate"); f.store.route.set("/product/evaluation/actual"); f.emitWindow("popstate");
  const other = f.native("button"); f.doc.body.append(other); other.focus();
  gate.resolve(outcome === "success" ? Response.json({ archived: true }) : Response.json({ error: "OLD_ARCHIVE_FAILURE" }, { status: 409 })); await pending;
  assert.equal(f.replay.deletes.length, 1, "already sent is not described as canceled"); assert.equal(f.replay.gets.length, 1, "retired completion cannot refresh");
  assert.ok(!f.draw().includes("OLD_ARCHIVE_FAILURE")); assert.equal(f.doc.activeElement, other); assert.equal(f.dialog(), null);
});

test("Replay rejects a late error body after platform authority changes", async (t) => {
  const f = await replay(t), body = deferred(); let parsing = false;
  f.replay.onDelete = () => ({ ok: false, json: () => { parsing = true; return body.promise; } });
  const pending = f.click(f.archive()); f.confirm(); await until(() => parsing, "actual archive reached response JSON");
  f.platform.platformSession.reset(); body.resolve({ error: "OLD_PRIVATE_ARCHIVE_FAILURE" }); await pending;
  assert.ok(!f.draw().includes("OLD_PRIVATE_ARCHIVE_FAILURE")); assert.equal(f.replay.gets.length, 1); assert.equal(f.replay.deletes.length, 1);
});

test("Replay preserves an owned archive refusal and permits a separately confirmed retry", async (t) => {
  const f = await replay(t); f.replay.onDelete = () => Response.json({ error: "archive_not_failed" }, { status: 409 });
  const pending = f.click(f.archive()); f.confirm(); await pending;
  assert.ok(f.draw().includes("archive_not_failed")); assert.equal(f.replay.gets.length, 1); assert.equal(f.replay.deletes.length, 1);
  f.replay.onDelete = null;
  const next = f.click(f.archive()); f.confirm(); await next;
  assert.equal(f.replay.deletes.length, 2); assert.equal(f.replay.gets.length, 2); assert.ok(!f.draw().includes("archive_not_failed"));
});

test("Replay a newer Refresh owns publication over an old post-archive list response", async (t) => {
  const f = await replay(t), oldList = deferred();
  f.replay.onGet = () => oldList.promise;
  const pending = f.click(f.archive()); f.confirm(); await until(() => f.replay.gets.length === 2, "owned post-archive list is pending");
  f.replay.onGet = null; f.replay.rows = [{ ...failedSession(), sessionId: "new-owned-B", title: "NEW_CURRENT_ROW", status: "complete" }];
  await f.click(f.refresh()); assert.ok(f.draw().includes("NEW_CURRENT_ROW"));
  oldList.resolve(Response.json({ sessions: [{ ...failedSession(), title: "OLD_LIST_ROW" }] })); await pending;
  assert.ok(f.draw().includes("NEW_CURRENT_ROW")); assert.ok(!f.draw().includes("OLD_LIST_ROW"));
  assert.equal(f.replay.deletes.length, 1); assert.equal(f.replay.gets.length, 3);
});
