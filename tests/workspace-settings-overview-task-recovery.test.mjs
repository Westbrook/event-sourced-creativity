// E task-scoped reach and denial-recovery controls. Actual complete Settings,
// Store and current native navigation reuse the existing finite HTTP fixture.
// Intentional task departure clears the old view before this new task read;
// these cases do NOT claim same-owner retention of a hidden prior cache.
import assert from "node:assert/strict";
import test from "node:test";
import { withSettingsShellFixture } from "./helpers/workspace-settings-shell-fixture.mjs";
import { settingsFixture, endpoint, method, path, clickWorkspaceTask } from "./helpers/workspace-settings-whole-read-fixture.mjs";

const options = { concurrency: false, timeout: 30_000 };
const tasks = [
  { section: "projects", resource: "/context-packages", marker: "PRIVATE_A_PACKAGE",
    absent: /PRIVATE_A_MEMBER|PRIVATE_A_STORAGE|PRIVATE_A_ASSURANCE/u },
  { section: "members", resource: "/security", marker: "PRIVATE_A_STORAGE",
    absent: /PRIVATE_A_PACKAGE|PRIVATE_A_ASSURANCE/u },
  { section: "activity", resource: "/assurance", marker: "PRIVATE_A_ASSURANCE",
    absent: /PRIVATE_A_MEMBER|PRIVATE_A_PACKAGE|PRIVATE_A_STORAGE/u },
];
const privatePattern = /PRIVATE_A_MEMBER|PRIVATE_A_PACKAGE|PRIVATE_A_STORAGE|PRIVATE_A_ASSURANCE/u;
const sourceState = f => structuredClone({ events: f.store.events.get(), content: f.store.content.get(),
  head: f.store.head.get(), session: f.store.session.get(), authorization: f.store.captureAuthorizationScope() });

for (const locale of ["en", "ja"]) for (const task of tasks) for (const status of [200, 403]) test(
  "E current " + task.section + " exact private task read " + status + " and deliberate recovery " + locale,
  options, async t => {
    const f = await withSettingsShellFixture(t, setupTest => settingsFixture(setupTest, { locale, section: "members" }));
    if (task.section !== "members") { clickWorkspaceTask(f, "A", task.section); await f.flush(); }
    assert.equal(f.store.route.get(), path("A", task.section));
    assert.ok(f.privateText().includes(task.marker), "The actual task initially exposes its authorized evidence");
    assert.doesNotMatch(f.privateText(), task.absent, "Unrelated task bodies are not restated on this task");
    const original = sourceState(f), serviceSession = structuredClone(f.service.session);
    const alternate = task.section === "members" ? "projects" : "members";
    clickWorkspaceTask(f, "A", alternate); await f.flush();
    assert.equal(f.privateText().includes(task.marker), false, "The deliberate task transition retires the former view");
    const url = endpoint("A", task.resource);
    const gate = f.service.queue(request => method(request) === "GET" && request.url === url, "body",
      status === 200 ? null : { status: 403, body: { error: "access_denied" } });
    try {
      clickWorkspaceTask(f, "A", task.section);
      await f.until(() => gate.used, "the current exact task resource reaches its original response");
      await f.flush();
      assert.equal(f.store.route.get(), path("A", task.section));
      assert.equal(gate.request.url, url); assert.equal(gate.jsonCalls, status === 200 ? 1 : 0);
      if (status === 403) assert.doesNotMatch(f.privateText(), privatePattern, "Known current denial admits no private task content");
      else assert.equal(f.privateText().includes(task.marker), false, "The held current body has not published early");
      assert.deepEqual(f.service.writes, []); assert.equal(f.token("fixture-token-A-1"), false);
      gate.release.resolve(); await f.flush(18);
      if (status === 403) {
        assert.doesNotMatch(f.privateText(), privatePattern);
        await f.until(() => f.nodes("button").some(node => node.text === f.i18n.t("action.retry", "Try again")),
          "the current denied task offers the existing read-only Retry");
        const before = f.service.requests.length;
        f.click(f.find("button", node => node.text === f.i18n.t("action.retry", "Try again")));
        await f.until(() => f.privateText().includes(task.marker), "fresh deliberate same-task recovery shows its actual evidence");
        await f.flush();
        assert.ok(f.service.requests.slice(before).every(request => method(request) === "GET"));
        assert.equal(f.service.requests.slice(before).filter(request => request.url === url).length, 1);
      }
      assert.equal(f.store.route.get(), path("A", task.section));
      assert.ok(f.privateText().includes(task.marker)); assert.doesNotMatch(f.privateText(), task.absent);
      assert.equal(f.nodes("p").filter(node => node.attributes.role === "alert").length, 0);
      assert.equal(f.token("fixture-token-A-1"), false);
      assert.equal(f.service.tokenCount.A, 0); assert.equal(f.service.tokenCount.B, 0);
      assert.deepEqual(f.service.writes, []); assert.ok(f.service.requests.every(request => method(request) === "GET"));
      assert.deepEqual(sourceState(f), original); assert.deepEqual(f.service.session, serviceSession);
      f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
      t.diagnostic(JSON.stringify({ locale, section: task.section, resource: url, status, jsonCalls: gate.jsonCalls,
        exactCurrentRoute: f.store.route.get(), visibleMarker: task.marker, privateBodySeparated: true,
        commands: 0, preservedSourceAndAuthority: true,
        scope: "actual current task navigation/read/recovery; not same-owner hidden-cache retention or Worker authorization" }));
    } finally { gate.release.resolve(); await f.flush(); }
  });
