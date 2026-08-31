// Additive ordering and current-locale controls. This reuses the complete actual
// host/Store and existing finite native/HTTP fixture; no Worker authority is claimed.
import assert from "node:assert/strict";
import test from "node:test";
import { settingsFixture, endpoint, tokenPath, method, memberReadLiveLocale } from "./helpers/workspace-settings-whole-read-fixture.mjs";

const options = { concurrency: false, timeout: 30_000 };
const PRIVATE = ["PRIVATE_A_MEMBER", "PRIVATE_A_PACKAGE", "PRIVATE_A_STORAGE", "PRIVATE_A_ASSURANCE"];
const TOKEN = "fixture-token-A-1";
const SAVED = "A scoped provisioning token was created and is displayed only during this authorized session.";
const snapshot = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
  authorization: f.store.captureAuthorizationScope() });
const privateMarkers = f => PRIVATE.filter(marker => f.privateText().includes(marker));
const alerts = f => f.nodes("p").filter(node => node.attributes.role === "alert").map(node => node.text);
const saved = f => f.text().includes(f.i18n.system(SAVED));
const get = url => request => method(request) === "GET" && request.url === url;
const packageRead = get(endpoint("A", "/context-packages"));
const memberRead = get(endpoint("A", "/projects/settings-access-A/members"));
function assertOriginal(f, original, writes = 1) {
  assert.deepEqual(snapshot(f), original, "Actual Source, route, session and authorization are unchanged");
  assert.equal(f.service.writes.length, writes);
  if (writes) {
    assert.deepEqual(f.service.writes.map(write => [write.method, write.url]), [["POST", tokenPath("A")]]);
    assert.equal(f.service.writes[0].receipt.token, TOKEN);
    assert.equal(f.service.tokenCount.A, 1); assert.equal(f.service.tokenCount.B, 0);
  }
  f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
}
async function recover(f, { retainedOriginalToken = false } = {}) {
  const content = () => f.tree().nodes.filter(node => node.tag === "div"
    && String(node.attributes.class ?? "").split(/\s+/u).includes("workspace-settings-content"));
  if (retainedOriginalToken) {
    const retained = content();
    assert.equal(retained.length, 1, "One existing same-owner native subtree is retained");
    assert.equal(Object.hasOwn(retained[0].attributes, "hidden"), true);
    assert.equal(Object.hasOwn(retained[0].attributes, "inert"), true);
    assert.equal(f.token(TOKEN), true, "The exact already-issued token is retained, not recreated by Retry");
    assert.equal(f.nodes("input").some(node => node.port?.value === TOKEN), false, "The retained token is not visible before successful recovery");
  }
  const before = f.service.requests.length;
  await f.until(() => f.nodes("button").some(node => node.text === f.i18n.t("action.retry", "Try again")), "existing deliberate read-only Retry");
  f.click(f.find("button", node => node.text === f.i18n.t("action.retry", "Try again")));
  await f.until(() => {
    if (privateMarkers(f).length !== PRIVATE.length) return false;
    if (!retainedOriginalToken) return true;
    const current = content();
    return current.length === 1 && !Object.hasOwn(current[0].attributes, "hidden")
      && !Object.hasOwn(current[0].attributes, "inert");
  }, "a fresh exact authorized collection");
  await f.flush();
  assert.ok(f.service.requests.slice(before).every(request => method(request) === "GET"), "Recovery does not issue another command");
  assert.deepEqual(privateMarkers(f), PRIVATE);
  assert.equal(f.token(TOKEN), retainedOriginalToken, retainedOriginalToken
    ? "A fresh same-owner collection reveals the retained original token without another command"
    : "An ordinary read never recreates the one-time token");
  assert.equal(saved(f), true, "Known command ACK survives the independent private-read failure");
  assert.deepEqual(alerts(f), []);
}

for (const status of [401, 403, 404]) test("B3 whole detail denied headers " + status + " follow same-host French to Japanese", options, async t => {
  const f = await settingsFixture(t, { locale: "fr" }), language = memberReadLiveLocale(f);
  const original = snapshot(f), host = f.host, controller = f.i18n;
  const gate = f.service.queue(get(endpoint("A")), "body", { status, raw: "not a private JSON response" });
  try {
    f.issue(); await f.until(() => gate.used, "actual post-ACK detail headers"); await f.flush();
    const french = f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.");
    assert.notEqual(french, "This workspace is unavailable.");
    assert.deepEqual(privateMarkers(f), []); assert.equal(f.token(TOKEN), false);
    assert.deepEqual(alerts(f), [french]); assert.equal(saved(f), true); assert.equal(gate.jsonCalls, 0);
    const requests = f.service.requests.length;
    language.change("ja"); await f.flush();
    const japanese = f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.");
    assert.notEqual(japanese, french);
    assert.equal(f.host, host); assert.equal(f.i18n, controller);
    assert.equal(f.service.requests.length, requests, "Locale publication is not a fresh authorization read");
    assert.deepEqual(alerts(f), [japanese]); assert.equal(saved(f), true);
    gate.release.resolve(); await f.flush(); await recover(f); assertOriginal(f, original);
  } finally { gate.release.resolve(); await f.flush(); }
});

for (const status of [401, 404]) test("B3 whole overview denied headers " + status + " skip malformed JSON and retain the known ACK", options, async t => {
  const f = await settingsFixture(t), original = snapshot(f);
  const gate = f.service.queue(get("/api/workspaces"), "body", { status, raw: "not JSON" });
  try {
    f.issue(); await f.until(() => gate.used, "actual post-ACK overview headers"); await f.flush();
    assert.deepEqual(privateMarkers(f), []); assert.equal(f.token(TOKEN), false);
    assert.equal(saved(f), true); assert.equal(gate.jsonCalls, 0);
    gate.release.resolve(); await f.flush(); await recover(f); assertOriginal(f, original);
  } finally { gate.release.resolve(); await f.flush(); }
});

test("B3 known saved command with failed session refresh keeps its app-owned error in the current locale", options, async t => {
  const f = await settingsFixture(t, { locale: "fr" }), language = memberReadLiveLocale(f), original = snapshot(f);
  const previous = f.storeHost.intercept; let failed = false;
  f.storeHost.intercept = request => {
    if (get("/api/session")(request) && !failed) { failed = true; throw new Error("finite session refresh interruption"); }
    return previous?.(request);
  };
  try {
    f.issue(); await f.until(() => failed, "the actual acknowledged action reaches Store.refreshSession"); await f.flush();
    const french = f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.");
    assert.deepEqual(alerts(f), [french]); assert.equal(saved(f), true); assert.equal(f.token(TOKEN), true);
    const requests = f.storeHost.requests.length;
    language.change("ja"); await f.flush();
    const japanese = f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.");
    assert.notEqual(japanese, french); assert.equal(f.storeHost.requests.length, requests);
    assert.deepEqual(alerts(f), [japanese]); assert.equal(saved(f), true);
    assertOriginal(f, original);
  } finally { f.storeHost.intercept = previous; }
});

test("B3 whole-read opaque diagnostic stays literal through the same-host locale change", options, async t => {
  const f = await settingsFixture(t, { locale: "fr" }), language = memberReadLiveLocale(f), original = snapshot(f);
  const literal = "Open document", previous = f.storeHost.intercept; let failed = false;
  f.storeHost.intercept = request => {
    if (get(endpoint("A"))(request) && !failed) { failed = true; throw new Error(literal); }
    return previous?.(request);
  };
  try {
    f.issue(); await f.until(() => failed, "the exact original whole-read transport fails"); await f.flush();
    assert.notEqual(f.i18n.system(literal), literal, "This diagnostic would translate if misclassified");
    assert.deepEqual(alerts(f), [literal]); assert.equal(saved(f), true);
    const requests = f.storeHost.requests.length;
    language.change("ja"); await f.flush();
    assert.notEqual(f.i18n.system(literal), literal);
    assert.equal(f.storeHost.requests.length, requests); assert.deepEqual(alerts(f), [literal]);
  } finally { f.storeHost.intercept = previous; }
  await recover(f, { retainedOriginalToken: true }); assertOriginal(f, original);
});

async function pendingCollection(t, spec, phase) {
  const f = await settingsFixture(t, { locale: "en", section: "members" }), language = memberReadLiveLocale(f);
  const old = f.service.queue(packageRead, phase, spec);
  f.navigate("A", "overview"); await f.until(() => old.used, "original exact collection reaches its parallel package read");
  // The existing LocaleController's public context publication requests a render
  // while base detail is present and this separate read remains pending. The
  // resulting ordinary token button is enabled; no private method is invoked.
  language.change("ja"); await f.flush();
  assert.match(f.privateText(), /PRIVATE_A_MEMBER/u);
  assert.equal(Object.hasOwn(f.tokenButton().attributes, "disabled"), false);
  assert.equal(f.service.writes.length, 0); assert.equal(old.jsonCalls, phase === "body" ? 1 : 0);
  return { f, old, original: snapshot(f) };
}

test("B3 older whole collection body cannot resurrect private state after the newer denied collection", options, async t => {
  const { f, old, original } = await pendingCollection(t, null, "body");
  const denial = f.service.queue(packageRead, "body", { status: 403, body: { error: "access_denied" } });
  try {
    f.issue(); await f.until(() => denial.used, "newer acknowledged action's exact package denial"); await f.flush();
    assert.deepEqual(privateMarkers(f), []); assert.equal(f.token(TOKEN), false); assert.equal(saved(f), true);
    old.release.resolve(); denial.release.resolve(); await f.flush(18);
    assert.deepEqual(privateMarkers(f), []); assert.equal(f.token(TOKEN), false);
    assert.equal(denial.jsonCalls, 0);
    await recover(f); assertOriginal(f, original);
  } finally { old.release.resolve(); denial.release.resolve(); await f.flush(); }
});

test("B3 newer pending whole collection and completed siblings are not proof against an older exact denial", options, async t => {
  const { f, old, original } = await pendingCollection(t, { status: 403, body: { error: "access_denied" } }, "headers");
  const newer = f.service.queue(packageRead, "body");
  try {
    f.issue(); await f.until(() => newer.jsonCalls === 1, "newer exact package body is still pending"); await f.flush();
    assert.equal(f.token(TOKEN), true); assert.equal(saved(f), true);
    assert.equal(Object.hasOwn(f.tokenButton().attributes, "disabled"), true, "The newer acknowledged action still awaits that body");
    assert.equal(f.service.requests.filter(get(endpoint("A"))).length >= 3, true, "Newer base/sibling reads really completed first");
    old.release.resolve(); await f.flush();
    assert.deepEqual(privateMarkers(f), []); assert.equal(f.token(TOKEN), false);
    newer.release.resolve(); await f.flush(18);
    assert.deepEqual(privateMarkers(f), []); assert.equal(f.token(TOKEN), false);
    assert.equal(old.jsonCalls, 0);
    await recover(f); assertOriginal(f, original);
  } finally { old.release.resolve(); newer.release.resolve(); await f.flush(); }
});

test("B3 fully completed newer exact collection survives an older denied response", options, async t => {
  const { f, old, original } = await pendingCollection(t, { status: 403, body: { error: "access_denied" } }, "headers");
  try {
    f.issue(); await f.until(() => f.token(TOKEN) && privateMarkers(f).length === PRIVATE.length, "newer whole exact collection completes"); await f.flush(18);
    assert.equal(saved(f), true); assert.deepEqual(alerts(f), []);
    assert.equal(Object.hasOwn(f.tokenButton().attributes, "disabled"), false, "The newer whole collection and acknowledged action have completed");
    const requests = f.service.requests.length;
    old.release.resolve(); await f.flush(18);
    assert.deepEqual(privateMarkers(f), PRIVATE); assert.equal(f.token(TOKEN), true); assert.equal(saved(f), true);
    assert.deepEqual(alerts(f), []); assert.equal(old.jsonCalls, 0);
    assert.equal(f.service.requests.length, requests, "An old denial neither clears the completed proof nor starts recovery");
    assertOriginal(f, original);
  } finally { old.release.resolve(); await f.flush(); }
});

test("B3 completed project-member read cannot shield a different whole-resource denial", options, async t => {
  const f = await settingsFixture(t), original = snapshot(f);
  const denial = f.service.queue(packageRead, "headers", { status: 403, body: { error: "access_denied" } });
  try {
    f.issue(); await f.until(() => denial.used, "actual post-ACK collection holds one exact resource");
    await f.flush(); assert.equal(f.token(TOKEN), true);
    f.click(f.find("button", node => node.attributes["aria-label"] ===
      f.i18n.t("workspace.admin.viewAccessNamed", "View access to {name}", { name: "PRIVATE_A_PROJECT" })));
    await f.until(() => f.privateText().includes("PRIVATE_A_PROJECT_MEMBER"), "the independent current project-member read completes");
    assert.equal(f.service.requests.filter(memberRead).length, 1);
    denial.release.resolve(); await f.flush();
    assert.deepEqual(privateMarkers(f), []); assert.doesNotMatch(f.privateText(), /PRIVATE_A_PROJECT_MEMBER/u);
    assert.equal(f.token(TOKEN), false); assert.equal(saved(f), true); assert.equal(denial.jsonCalls, 0);
    await recover(f); assertOriginal(f, original);
  } finally { denial.release.resolve(); await f.flush(); }
});

for (const boundary of ["route", "principal"]) test("B3 known original ACK is not published across a newer " + boundary, options, async t => {
  const f = await settingsFixture(t), source = structuredClone({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() });
  const old = f.service.queue(get(endpoint("A")), "headers", { status: 403, body: { error: "access_denied" } });
  try {
    f.issue(); await f.until(() => old.used, "the acknowledged original action awaits its exact follow-up");
    await f.flush(); assert.equal(saved(f), true);
    if (boundary === "route") f.navigate("B");
    else await f.refreshAuthority({ user: { ...f.service.session.user, userId: "another-settings-principal" } });
    await f.flush(18); const requests = f.service.requests.length;
    const currentSource = structuredClone({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() });
    if (boundary === "route") assert.deepEqual(currentSource, source);
    else assert.deepEqual(currentSource, { events: [], content: {}, head: 0 }, "The actual Store retires the prior principal's Source");
    old.release.resolve(); await f.flush(18);
    assert.equal(saved(f), false); assert.equal(f.token(TOKEN), false); assert.equal(old.jsonCalls, 0);
    assert.equal(f.service.requests.length, requests, "The old owner cannot start a recovery read");
    assert.deepEqual({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() }, currentSource);
    assert.equal(f.service.writes.length, 1); assert.equal(f.service.tokenCount.A, 1); assert.equal(f.service.tokenCount.B, 0);
    if (boundary === "route") assert.match(f.privateText(), /PRIVATE_B_MEMBER/u);
    f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
  } finally { old.release.resolve(); await f.flush(); }
});
