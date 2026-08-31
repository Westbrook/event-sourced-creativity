// Causal current-Shell Skip baseline. All application classes and Store methods
// are complete/current; native history/forms and HTTP are finite existing ports.
import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFragmentFixture, workspaceHistoryDelivery, endpoint, settingsPath, method }
  from "./helpers/workspace-settings-fragment-fixture.mjs";

const options = { concurrency: false, timeout: 45000 };
const modes = ["none", "skip", "path-ABA", "query-ABA", "principal"];
const states = ["unsent-raw", "pending-original", "recovered-known-ACK"];
const source = f => structuredClone({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() });

async function recoverKnownAck(x) {
  const { f, service, native, entry } = x;
  const denial = service.queue(request => method(request) === "GET" && request.url === endpoint("A"), "body",
    { status: 403, body: { error: "access_denied" } });
  native.fill(entry.a); native.submit();
  try {
    await f.until(() => denial.used, "the original invitation's actual follow-up detail read reaches known403");
    await f.flush();
    assert.equal(service.writes.length, 1); assert.deepEqual(service.writes[0].body, entry.a);
    assert.equal(denial.jsonCalls, 0, "installed whole-read repair withdraws before the held denial body");
    assert.ok(x.notice().includes(x.saved()), "positive201 remains honestly acknowledged after private read denial");
    assert.equal(x.currentForms().length, 0, "denied private detail does not retain its old form");
    assert.equal(f.values().some(value => value.includes("finite-original-token-A")), false);
    const before = service.requests.length;
    const retry = f.find("button", node => node.owner === x.currentOwner()
      && node.text === f.i18n.t("action.retry", "Try again"));
    f.click(retry);
    await f.until(() => x.currentForms().length === 1 && service.pending === 0, "fresh deliberate authorized read restores the form");
    await f.flush();
    assert.equal(service.requests.slice(before).every(request => method(request) === "GET"), true);
    assert.equal(service.writes.length, 1, "recovery does not create another invitation");
    assert.ok(x.notice().includes(x.saved()));
    assert.equal(f.values().some(value => value.includes("finite-original-token-A")), false,
      "read-only recovery does not recreate the one-time invitation secret");
  } finally { denial.release.resolve(); await f.flush(); }
}

for (const state of states) for (const mode of modes) test(
  "B3 Workspace current Shell fragment custody " + JSON.stringify({ state, mode }), options, async t => {
    const x = await workspaceFragmentFixture(t), { f, service, native, entry } = x;
    const originalSource = source(f), authority = f.store.captureAuthorizationScope();
    const originalRoute = f.store.route.get(), originalSession = structuredClone(f.store.session.get());
    let gate = null, form, before, atBoundary, after, traversals = [];
    if (state === "recovered-known-ACK") await recoverKnownAck(x);
    if (state === "pending-original") {
      form = native.fill(entry.a).port;
      gate = service.queue(request => method(request) === "POST" && request.url === entry.url, "headers");
      native.submit();
      await gate.seen.promise; f.draw();
      assert.equal(service.writes.length, 1, "existing finite service has committed its exact positive201");
      assert.deepEqual(service.writes[0].body, entry.a);
      assert.equal(gate.jsonCalls, 0, "the original ACK has not reached Settings yet");
      native.fill(entry.b);
      assert.equal(native.current().port, form);
      assert.equal(Object.hasOwn(native.button(native.current()).attributes, "disabled"), true,
        "one pending original blocks a second submission, not raw editing");
    } else form = native.fill(entry.b).port;
    before = x.observation(form);
    assert.deepEqual(before.raw, entry.b); assert.equal(before.sameOwner, true); assert.equal(before.sameForm, true);
    const expectedCommands = state === "unsent-raw" ? 0 : 1;
    assert.equal(service.writes.length, expectedCommands);
    try {
      if (mode === "skip") traversals.push(await workspaceHistoryDelivery(x, "#main-content", { skip: true }));
      else if (mode === "path-ABA") {
        traversals.push(await workspaceHistoryDelivery(x, settingsPath("B", "members")));
        traversals.push(await workspaceHistoryDelivery(x, originalRoute));
      } else if (mode === "query-ABA") {
        traversals.push(await workspaceHistoryDelivery(x, originalRoute + "?sort=name"));
        traversals.push(await workspaceHistoryDelivery(x, originalRoute));
      } else if (mode === "principal") {
        await f.refreshAuthority({ user: { ...service.session.user, userId: "different-workspace-fragment-principal" } });
        await f.flush();
      } else await f.flush();
      atBoundary = x.observation(form);
      f.focusCalls.length = 0;
      gate?.release.resolve(); await f.flush();
      after = x.observation(form);
      assert.equal(service.pending, 0, "all released finite response work is settled");
      assert.equal(service.writes.length, expectedCommands, "history/recovery/late completion never duplicates a command");
      assert.equal(service.requests.filter(request => method(request) !== "GET").length, expectedCommands);
      if (expectedCommands) {
        assert.deepEqual(service.writes[0].body, entry.a, "newer raw B is never submitted by A's completion");
        assert.equal(service.writes[0].receipt.invitationId, "finite-original-invitation-A");
      }
      if (mode !== "principal") {
        assert.deepEqual(source(f), originalSource); assert.deepEqual(f.store.session.get(), originalSession);
        assert.equal(f.store.authorizationScopeActive(authority), true);
      } else assert.equal(f.store.authorizationScopeActive(authority), false, "actual changed principal retires old authority");
      f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
      t.diagnostic(JSON.stringify({ state, mode, traversals, before, atBoundary, after,
        ackJsonCalls: gate?.jsonCalls ?? null, expectedCommands,
        finiteHttpOnly: true, applicationMethodsReplaced: false, physicalBrowserClaim: false }));
      const sameResource = mode === "none" || mode === "skip";
      if (sameResource) {
        assert.equal(atBoundary.gets, before.gets, "same-resource Skip is not a refresh or private-read authorization proof");
        assert.equal(atBoundary.sameOwner, true); assert.equal(atBoundary.sameForm, true);
        assert.deepEqual(atBoundary.raw, entry.b, "native Skip preserves every unsent current raw field");
        assert.equal(after.sameOwner, true); assert.equal(after.sameForm, true);
        assert.deepEqual(after.raw, entry.b, "original completion preserves newer B in the same native form");
        if (state !== "unsent-raw") assert.ok(after.notice.includes(x.saved()), "known positive ACK remains honestly reachable");
        if (state === "pending-original") {
          assert.equal(gate.jsonCalls, 1, "same-resource original ACK is decoded exactly once");
          assert.ok(after.notice.includes(f.i18n.t("workspace.admin.newerFormKept")));
          assert.equal(after.invitationVisible, true, "the original current private invitation result remains owned");
        } else if (state === "recovered-known-ACK") assert.equal(after.invitationVisible, false);
        if (mode === "skip") assert.equal(f.focusCalls.length, 0, "late work does not reclaim focus after the native Skip gesture");
      } else {
        assert.equal(form.isConnected, false, "real path/query/principal departure retires the original native form");
        assert.equal(after.sameForm, false); assert.notDeepEqual(after.raw, entry.b);
        assert.equal(after.invitationVisible, false, "retired original private reply never resurfaces");
        assert.equal(String(after.notice ?? "").includes(x.saved()), false, "saved copy does not cross owner departure or ABA");
        if (gate) assert.equal(gate.jsonCalls, 0, "retired original headers are rejected without reading private JSON");
      }
    } finally { gate?.release.resolve(); await f.flush(); }
  });
