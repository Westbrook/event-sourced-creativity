// Separate row/error-envelope controls. Wrong-type IDs keep the legacy display
// renderable; no malformed row's administrative action is activated.
import assert from "node:assert/strict";
import test from "node:test";
import { settingsFixture, endpoint, tokenPath, method, memberReadLiveLocale } from "./helpers/workspace-settings-whole-read-fixture.mjs";

const options = { concurrency: false, timeout: 30_000 };
const PRIVATE = ["PRIVATE_A_MEMBER", "PRIVATE_A_PACKAGE", "PRIVATE_A_STORAGE", "PRIVATE_A_ASSURANCE"];
const TOKEN = "fixture-token-A-1", NOW = "2026-08-30T12:00:00.000Z";
const SAVED = "A scoped provisioning token was created and is displayed only during this authorized session.";
const cases = [
  { name: "holds", suffix: "/holds", field: "holds", row: organizationId => ({
    hold_id: 42, scope_kind: "organization", resource_id: organizationId, reason: "Finite malformed identity", status: "active", created_at: NOW,
  }) },
  { name: "recovery", suffix: "/recovery", field: "snapshots", row: () => ({
    snapshot_id: 42, key_id: "fixture-key", manifest_json: "{}", status: "removed", created_at: NOW,
  }) },
  { name: "credentials", suffix: "/security/provisioning-credentials", field: "credentials", row: () => ({
    id: 42, status: "active", createdAt: NOW, revokedAt: null,
  }) },
];
const get = url => request => method(request) === "GET" && request.url === url;
const privateMarkers = f => PRIVATE.filter(marker => f.privateText().includes(marker));
const snapshot = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
  authorization: f.store.captureAuthorizationScope() });

for (const resource of cases) for (const shape of ["wrong-type-row-id", "error-envelope"]) test(
  "B3 exact " + resource.name + " does not certify newer " + shape + " against older denial", options, async t => {
    const f = await settingsFixture(t, { locale: "en", section: "members" }), language = memberReadLiveLocale(f);
    const target = get(endpoint("A", resource.suffix)), old = f.service.queue(target, "headers", { status: 403, body: { error: "access_denied" } });
    f.navigate("A", "overview"); await f.until(() => old.used, "old exact resource waits at headers");
    language.change("ja"); await f.flush();
    assert.equal(Object.hasOwn(f.tokenButton().attributes, "disabled"), false);
    const original = snapshot(f), organizationId = f.service.reply({ url: endpoint("A"), init: {} }).body.organization.organizationId;
    const body = shape === "wrong-type-row-id" ? { [resource.field]: [resource.row(organizationId)] }
      : { ...structuredClone(f.service.reply({ url: endpoint("A", resource.suffix), init: {} }).body), error: "access_denied" };
    const newer = f.service.queue(target, "body", { status: 200, body });
    try {
      f.issue(); await f.until(() => newer.jsonCalls === 1, "newer exact malformed envelope is consumed"); newer.release.resolve();
      await f.until(() => f.token(TOKEN) && privateMarkers(f).length === PRIVATE.length, "legacy display completes with this deliberately renderable malformed shape");
      await f.flush(18);
      assert.equal(Object.hasOwn(f.tokenButton().attributes, "disabled"), false);
      assert.equal(f.text().includes(f.i18n.system(SAVED)), true);
      old.release.resolve(); await f.flush(18);
      assert.equal(old.jsonCalls, 0);
      assert.deepEqual(privateMarkers(f), [], "Neither a wrong-type identity nor an error envelope is a positive certificate");
      assert.equal(f.token(TOKEN), false); assert.equal(f.text().includes(f.i18n.system(SAVED)), true);
      const before = f.service.requests.length;
      f.click(f.find("button", node => node.text === f.i18n.t("action.retry", "Try again")));
      await f.until(() => privateMarkers(f).length === PRIVATE.length, "fresh exact valid read remains reachable"); await f.flush();
      assert.ok(f.service.requests.slice(before).every(request => method(request) === "GET"));
      assert.equal(f.token(TOKEN), false); assert.equal(f.text().includes(f.i18n.system(SAVED)), true);
      assert.deepEqual(snapshot(f), original);
      assert.equal(f.service.writes.length, 1); assert.equal(f.service.writes[0].url, tokenPath("A"));
      assert.equal(f.service.writes[0].receipt.token, TOKEN); assert.equal(f.service.tokenCount.A, 1); assert.equal(f.service.tokenCount.B, 0);
      f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
    } finally { old.release.resolve(); newer.release.resolve(); await f.flush(); }
  });
