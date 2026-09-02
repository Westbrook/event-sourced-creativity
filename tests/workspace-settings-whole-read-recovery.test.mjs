// Read-only coverage of the already-existing separately authorized deletion
// recovery presentation. No deletion, hold, release or confirmation is activated.
import assert from "node:assert/strict";
import test from "node:test";
import { settingsFixture, endpoint, tokenPath, method } from "./helpers/workspace-settings-whole-read-fixture.mjs";

const options = { concurrency: false, timeout: 30_000 };
// E presentation oracle: these are the actual current Members private surfaces.
// Package/assurance task reach and denial recovery are covered separately.
const PRIVATE = ["PRIVATE_A_MEMBER", "PRIVATE_A_STORAGE"];
const TOKEN = "fixture-token-A-1";
const SAVED = "A scoped provisioning token was created and is displayed only during this authorized session.";
const get = url => request => method(request) === "GET" && request.url === url;
const snapshot = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
  authorization: f.store.captureAuthorizationScope() });

for (const recoveryStatus of [200, 403]) test("B3 denied whole detail separately reads existing deletion recovery " + recoveryStatus, options, async t => {
  const f = await settingsFixture(t), original = snapshot(f), service = f.service;
  const denied = service.queue(get(endpoint("A")), "body", { status: 403, raw: "ordinary private detail denied" });
  const recovery = structuredClone(service.reply({ url: endpoint("A", "/deletion"), init: {} }));
  // Same existing finite job identity/status shape as workspace-settings-confirmation.
  recovery.body.job = { job_id: "fixture-removal", status: "partial" };
  const read = service.queue(get(endpoint("A", "/deletion")), "body", recoveryStatus === 200
    ? recovery : { status: 403, raw: "recovery eligibility denied" });
  const noOrdinaryPrivate = () => {
    assert.deepEqual(PRIVATE.filter(marker => f.privateText().includes(marker)), []);
    assert.equal(f.token(TOKEN), false); assert.equal(f.text().includes(f.i18n.system(SAVED)), true);
  };
  try {
    f.issue(); await f.until(() => read.used, "a separately issued current deletion-recovery GET follows known detail denial"); await f.flush();
    assert.equal(denied.jsonCalls, 0); noOrdinaryPrivate();
    assert.equal(f.nodes("h2").some(node => node.text === f.i18n.system("Organization ownership & offboarding")), false,
      "The old ordinary controls are gone while the separate response is unresolved or denied");
    assert.equal(read.jsonCalls, recoveryStatus === 200 ? 1 : 0);
    denied.release.resolve(); read.release.resolve(); await f.flush(18);
    noOrdinaryPrivate();
    if (recoveryStatus === 200) {
      assert.equal(f.nodes("h2").filter(node => node.text === f.i18n.system("Organization ownership & offboarding")).length, 1);
      const control = f.find("button", node => node.text === f.i18n.system("Try again"));
      assert.equal(Object.hasOwn(control.attributes, "disabled"), false);
      assert.ok(f.nodes("p").some(node => node.text === f.i18n.system("Permanently delete organization data") + " · " + f.i18n.system("Try again")));
      assert.equal(f.nodes("form").length, 0, "Only the original narrowly scoped recovery control is presented");
      // Deliberately do not click this destructive-action confirmation opener.
    } else {
      assert.equal(f.nodes("h2").some(node => node.text === f.i18n.system("Organization ownership & offboarding")), false);
      assert.equal(f.nodes("p").filter(node => node.attributes.role === "alert").length, 1);
      const before = service.requests.length;
      f.click(f.find("button", node => node.text === f.i18n.t("action.retry", "Try again")));
      await f.until(() => PRIVATE.every(marker => f.privateText().includes(marker)), "fresh ordinary authorized GET after both denials");
      await f.flush();
      assert.ok(service.requests.slice(before).every(request => method(request) === "GET"));
      assert.equal(f.token(TOKEN), false); assert.equal(f.text().includes(f.i18n.system(SAVED)), true);
    }
    assert.deepEqual(snapshot(f), original);
    assert.equal(service.writes.length, 1); assert.equal(service.writes[0].url, tokenPath("A"));
    assert.equal(service.writes[0].receipt.token, TOKEN);
    assert.deepEqual(service.requests.filter(request => !["GET", "HEAD"].includes(method(request)))
      .map(request => [method(request), request.url]), [["POST", tokenPath("A")]]);
    f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
  } finally { denied.release.resolve(); read.release.resolve(); await f.flush(); }
});
