// Certificate-only counterexamples. Actual complete host/Store; the malformed
// successful finite HTTP payloads are not treated as fresh authority evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { withSettingsShellFixture } from "./helpers/workspace-settings-shell-fixture.mjs";
import { settingsFixture, endpoint, tokenPath, method, memberReadLiveLocale, clickWorkspaceTask } from "./helpers/workspace-settings-whole-read-fixture.mjs";

const options = { concurrency: false, timeout: 30_000 };
// E presentation oracle: these are the actual current Members private surfaces.
// Package/assurance task reach and denial recovery are covered separately.
const PRIVATE = ["PRIVATE_A_MEMBER", "PRIVATE_A_STORAGE"];
const TOKEN = "fixture-token-A-1";
const SAVED = "A scoped provisioning token was created and is displayed only during this authorized session.";
const cases = [
  { name: "holds", suffix: "/holds" },
  { name: "recovery", suffix: "/recovery" },
  { name: "credentials", suffix: "/security/provisioning-credentials" },
];
const snapshot = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
  authorization: f.store.captureAuthorizationScope() });
const privateMarkers = f => PRIVATE.filter(marker => f.privateText().includes(marker));
const get = url => request => method(request) === "GET" && request.url === url;

for (const resource of cases) for (const shape of ["valid", "null", "missing"]) test(
  "B3 exact " + resource.name + " older denial after newer completed " + shape + " envelope", options, async t => {
    const f = await withSettingsShellFixture(t, setupTest => settingsFixture(setupTest, { locale: "en", section: "projects" })), language = memberReadLiveLocale(f);
    const target = get(endpoint("A", resource.suffix));
    const old = f.service.queue(target, "headers", { status: 403, body: { error: "access_denied" } });
    clickWorkspaceTask(f, "A", "members"); await f.until(() => old.used, "old collection waits for this exact endpoint");
    // Same legitimate public locale-update/render prerequisite as the separate
    // ordering controls, then the current enabled original command.
    language.change("ja"); await f.flush();
    assert.match(f.privateText(), /PRIVATE_A_MEMBER/u);
    assert.equal(Object.hasOwn(f.tokenButton().attributes, "disabled"), false);
    const original = snapshot(f);
    const newer = f.service.queue(target, "body", shape === "valid" ? null
      : { status: 200, body: shape === "null" ? null : {} });
    try {
      f.issue(); await f.until(() => newer.jsonCalls === 1, "newer exact finite200 body is read"); newer.release.resolve();
      await f.until(() => f.token(TOKEN) && privateMarkers(f).length === PRIVATE.length, "existing optional-array presentation completes");
      await f.flush(18);
      assert.equal(Object.hasOwn(f.tokenButton().attributes, "disabled"), false, "This is a completed collection, not a pending body");
      assert.equal(f.text().includes(f.i18n.system(SAVED)), true);
      old.release.resolve(); await f.flush(18);
      assert.equal(old.jsonCalls, 0);
      if (shape === "valid") {
        assert.deepEqual(privateMarkers(f), PRIVATE); assert.equal(f.token(TOKEN), true);
        assert.equal(f.nodes("p").filter(node => node.attributes.role === "alert").length, 0,
          "The existing actual valid envelope can certify this exact endpoint");
      } else {
        assert.deepEqual(privateMarkers(f), []); assert.equal(f.token(TOKEN), false);
        assert.equal(f.text().includes(f.i18n.system(SAVED)), true);
        const before = f.service.requests.length;
        f.click(f.find("button", node => node.text === f.i18n.t("action.retry", "Try again")));
        await f.until(() => privateMarkers(f).length === PRIVATE.length, "fresh valid collection after malformed proof and exact denial");
        await f.flush();
        assert.ok(f.service.requests.slice(before).every(request => method(request) === "GET"));
        assert.equal(f.token(TOKEN), false);
      }
      assert.equal(f.text().includes(f.i18n.system(SAVED)), true);
      assert.deepEqual(snapshot(f), original);
      assert.equal(f.service.writes.length, 1); assert.equal(f.service.writes[0].url, tokenPath("A"));
      assert.equal(f.service.writes[0].receipt.token, TOKEN); assert.equal(f.service.tokenCount.A, 1); assert.equal(f.service.tokenCount.B, 0);
      f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
    } finally { old.release.resolve(); newer.release.resolve(); await f.flush(); }
  });
