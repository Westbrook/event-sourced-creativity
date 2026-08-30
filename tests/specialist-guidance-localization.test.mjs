import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";

// Existing full-class/template ports and real LocaleController; only transport,
// FormData and account state are mocked. Not browser, AT or Worker certification.
const fixtureUrl = new URL("./output-contextual-names.test.mjs", import.meta.url);
const source = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstLoop = tree.statements.find(ts.isForOfStatement);
assert.ok(firstLoop);
const virtual = new URL(fixtureUrl); virtual.search = "?specialist-guidance-fixture";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source: source.slice(0, firstLoop.getFullStart())
    + "\nexport {fixture,loadActual,semanticNodes,localizeTemplateResult};", shortCircuit: true } : next(url, context);
} });
let shared;
try { shared = await import(virtual.href); } finally { hook.deregister(); }
const { fixture, loadActual, semanticNodes, localizeTemplateResult } = shared;
const { FormaProductAdapterPreview } = await loadActual("src/apps/product/adapter-preview.ts");
const { FormaAccessManagement } = await loadActual("src/apps/operations/access-management.ts");
const { FormaAccountSettings } = await loadActual("src/components/forma-account-settings.ts");
const { platformSession } = await loadActual("src/platform/session-controller.ts");
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const catalogs = Object.fromEntries(await Promise.all(["en", "fr", "ar", "ja"].map(async locale =>
  [locale, (await loadActual("src/components/design-system/locales/" + (locale === "en" ? "system-en" : locale) + ".ts")).default])));
const normalize = value => String(value).replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const reply = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const historicalFinding = "configured OpenAI image adapter", model = "model/Original_ID-日本語";
const report = { id: "evaluation", scope: "Frozen fictional evidence", refreshedAt: "2026-08-29T00:00:00Z",
  synthetic: true, metrics: [], evidence: [], qualification: { corpusVersion: "retained-corpus", caseCount: 1,
    passed: false, productionApproved: false, reports: [{ adapterVersion: "historical/v1", passed: false,
      candidateUsable: 0, evaluatedPairs: 1, referenceUsable: 1, referenceEvaluated: 1, finding: historicalFinding }] } };
const reasonCases = [
  ["one-reference Ideogram 4 image-to-image", "evaluation.preview.reason.oneReference"],
  ["configured Ideogram 4 text-to-image", "evaluation.preview.reason.configuredIdeogram"],
  ["Fal is not configured", "evaluation.preview.reason.falUnavailable"],
  ["Ideogram 4 accepts one reference; preserving the multi-reference contract", "evaluation.preview.reason.multipleReferences"],
  ["Ideogram 4 does not return WebP", "evaluation.preview.reason.webpUnsupported"],
  ["configured OpenAI image adapter", "evaluation.preview.reason.configuredOpenAI"],
];
const sizeCases = [
  ["Use WIDTHxHEIGHT dimensions.", "evaluation.preview.size.syntax"],
  ["Ideogram V4 requires each side to be at least 512 pixels.", "evaluation.preview.size.minimum"],
  ["Ideogram V4 accepts custom sides up to 3840 pixels.", "evaluation.preview.size.maximum"],
  ["Ideogram V4 custom dimensions must be multiples of 16.", "evaluation.preview.size.multiple"],
];
const input = { provider: "fal-ideogram", quality: "medium", size: "513x1024", outputFormat: "png", referenceCount: 1 };
const preview = (reason, sizeMessage = "") => ({ dryRun: true, providerCall: false, pixelsTransmitted: false,
  request: { ...input, wouldTransmitReferencePixels: true },
  selection: { provider: "fal-ideogram", model, adapterId: "retained-adapter", adapterVersion: "fixture/v1",
    reason, renderingSpeed: "BALANCED", sizeValid: !sizeMessage, sizeMessage, estimatedProviderCostUsd: null }, stages: [] });

function mount(t, locale, Component) {
  const f = fixture(t, { locale, facts: [] });
  f.host.disconnectedCallback(); f.host.isConnected = false; f.i18n.hostDisconnected();
  let publish, revision = 0;
  const snapshot = language => ({ locale: language, formatLocale: language, direction: language === "ar" ? "rtl" : "ltr",
    timeZone: "UTC", messages: { ...FORMA_DEFAULT_MESSAGES, ...catalogs[language] }, revision: ++revision });
  f.i18n = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    publish = event.callback; publish(snapshot(locale), () => {}); return true;
  } });
  f.i18n.hostConnected();
  f.host = new Component(); f.host.i18n = f.i18n; f.host.isConnected = true;
  f.draw = () => f.renderer.draw(f.host, () => localizeTemplateResult(f.host.render(), f.i18n));
  f.nodes = () => semanticNodes(f, f.host);
  f.changeLocale = language => { f.locale = language; publish(snapshot(language)); f.draw(); };
  f.calls = []; f.unexpected = [];
  f.transport = async () => { throw new Error("Unconfigured local endpoint"); };
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null };
    assert.ok(call.url.startsWith("/api/"), "No external network");
    f.calls.push(call);
    try { return await f.transport(call); } catch (error) { f.unexpected.push(call); throw error; }
  });
  return f;
}
const namedButtons = (f, key) => f.nodes().filter(node => node.tag === "button" && node.visibleLabel() === f.i18n.t(key));
const rowValue = (f, key) => {
  const nodes = f.nodes(), index = nodes.findIndex(node => node.tag === "dt" && node.name() === f.i18n.t(key));
  assert.ok(index >= 0, key); return nodes.slice(index + 1).find(node => node.tag === "dd").name();
};
function assertNames(f, buttons) {
  assert.equal(new Set(buttons.map(node => normalize(node.name()))).size, buttons.length);
  for (const button of buttons) {
    assert.ok(normalize(button.name()).startsWith(normalize(button.visibleLabel())), "Visible verb stays in the name");
    assert.ok(button.name().includes("\u2068") && button.name().includes("\u2069"), "Authored context is isolated");
  }
  assert.deepEqual(f.unexpected, []);
}
async function adapter(t, locale) {
  t.mock.method(platformSession, "get", () => ({ user: { role: "creator" }, capabilities: ["evaluation.qualification.run"] }));
  const f = mount(t, locale, FormaProductAdapterPreview);
  f.response = preview(reasonCases[0][0], sizeCases[1][0]);
  f.transport = async call => {
    if (call.url === "/api/portfolio/product/evaluation" && call.method === "GET") return reply({ report });
    assert.equal(call.url, "/api/portfolio/product/adapter-preview"); assert.equal(call.method, "POST");
    assert.deepEqual(call.body, input); return reply(f.response);
  };
  const formDataDescriptor = Object.getOwnPropertyDescriptor(globalThis, "FormData");
  Object.defineProperty(globalThis, "FormData", { configurable: true, writable: true, value: class FormDataPort {
    constructor(form) { assert.ok(form.fields); this.fields = form.fields; }
    get(key) { return this.fields[key] ?? null; }
  } });
  t.after(() => { if (formDataDescriptor) Object.defineProperty(globalThis, "FormData", formDataDescriptor); else delete globalThis.FormData; });
  f.host.connectedCallback(); await f.flush();
  f.simulate = async response => {
    f.response = response; f.draw();
    const form = f.renderer.ownNodes(f.host, "form").find(node => node.attributes.class === "adapter-preview-form");
    assert.ok(form);
    for (const key of Object.keys(input)) assert.ok(f.renderer.nodes.some(node => node.owner === f.host && node.attributes.name === key));
    form.fields = { ...input };
    await f.renderer.handler(f.host, "form", node => node === form, "submit")(); await f.flush();
  };
  return f;
}
const person = "Same person شخص 同名";
const grants = [
  { grant_id: "grant-prefix-A", user_id: "user-A", display_name: person, email: "same@example.test", capability: "design.catalog.read", scope_type: "platform", expires_at: null },
  { grant_id: "grant-prefix-B", user_id: "user-B", display_name: person, email: "same@example.test", capability: "design.catalog.read", scope_type: "platform", expires_at: null },
  { grant_id: "grant-distinct/子", user_id: "user-C", display_name: "Other person {customer} شخص 子", email: "other@example.test", capability: "design.catalog.read", scope_type: "platform", expires_at: null },
  { grant_id: "grant-capability", user_id: "user-A", display_name: person, email: "same@example.test", capability: "design.systems.read", scope_type: "platform", expires_at: null },
  { grant_id: "grant-expiry", user_id: "user-A", display_name: person, email: "same@example.test", capability: "design.catalog.read", scope_type: "platform", expires_at: "2026-09-02T12:30:00Z" },
  { grant_id: "grant-scope", user_id: "user-A", display_name: person, email: "same@example.test", capability: "design.catalog.read", scope_type: "project", expires_at: null },
];
async function access(t, locale, initialGrants = grants) {
  const f = mount(t, locale, FormaAccessManagement); f.currentGrants = structuredClone(initialGrants);
  f.transport = async call => {
    if (call.url === "/api/admin/users" && call.method === "GET") return reply({ users: initialGrants.map(grant => ({
      user_id: grant.user_id, email: grant.email, display_name: grant.display_name, role: "creator" })) });
    if (call.url === "/api/platform/access" && call.method === "GET") return reply({ grants: f.currentGrants });
    assert.equal(call.method, "DELETE");
    const match = f.currentGrants.find(grant => call.url === "/api/platform/access/" + encodeURIComponent(grant.grant_id));
    assert.ok(match, "Exact original grant target");
    f.currentGrants = f.currentGrants.filter(grant => grant !== match); return reply({ revoked: true });
  };
  f.host.connectedCallback(); await f.flush(); return f;
}
const documentTitle = "Same document مستند 同じ文書";
const shares = [
  { shareId: "link-prefix-A", resourceId: "document-A" },
  { shareId: "link-prefix-B", resourceId: "document-B" },
  { shareId: "link-prefix-A/子", resourceId: "document-A" },
  { shareId: "missing-document-link", resourceId: "missing" },
  { shareId: "distinct-document-link", resourceId: "document-C" },
  { shareId: "different-expiry-link", resourceId: "document-A", expiresAt: "2026-09-02T12:30:00Z" },
].map((row, index) => ({ resourceKind: "document", projectId: "p", expiresAt: "2026-09-01T00:00:00Z",
  createdAt: "2026-08-29T00:00:00Z", active: true, token: "PRIVATE-TOKEN-NOT-A-NAME-" + index, ...row }));
async function account(t, locale) {
  const f = mount(t, locale, FormaAccountSettings);
  f.store.session = { get: () => ({ user: { userId: "owner", role: "creator" }, policy: { accepted: false, retentionDays: 30 },
    budgets: { period: "2026-08", user: { used: 0, reserved: 0 } }, organizations: [], projects: [] }) };
  f.currentShares = structuredClone(shares); f.store.shares = { get: () => f.currentShares }; f.store.canManageProjectShares = () => true;
  f.shareLoads = 0; f.revoked = [];
  f.store.loadShares = async () => { f.shareLoads++; }; f.store.revokeShare = async id => { f.revoked.push(id); };
  f.documents = [{ id: "document-A", title: documentTitle }, { id: "document-B", title: documentTitle },
    { id: "document-C", title: "Distinct document {customer} مستند 文書" }];
  f.store.projection = { get: () => ({ documents: f.documents }) };
  f.host.connectedCallback(); await f.flush(); return f;
}
const isolate = value => "\u2068" + value + "\u2069";
const grantBase = (f, grant) => f.i18n.t("access.revokeNamed", "", {
  action: f.i18n.t("access.revoke"), name: isolate(grant.display_name), email: isolate(grant.email),
  capability: isolate(grant.capability), scope: isolate(grant.scope_type),
}) + (grant.expires_at ? " · " + f.i18n.t("access.expires") + " " + isolate(f.i18n.date(new Date(grant.expires_at),
  { dateStyle: "medium", timeStyle: "short" })) : "");
const shareBase = (f, share) => f.i18n.t("share.revokeNamed", "", {
  action: f.i18n.t("share.revoke"), document: isolate(f.documents.find(document => document.id === share.resourceId)?.title
    ?? f.i18n.t("settings.sharedDocument")), expiry: f.i18n.t("share.expires", "", {
      date: isolate(f.i18n.date(new Date(share.expiresAt), { dateStyle: "medium", timeStyle: "short" })),
    }),
});
function assertContextualNames(f, buttons, rows, idKey, base, qualifierKey, collisionIds) {
  assertNames(f, buttons); assert.equal(buttons.length, rows.length);
  const ranks = new Map([...collisionIds].sort().map((id, index) => [id, index + 1]));
  for (const [index, button] of buttons.entries()) {
    const row = rows[index], ordinal = ranks.get(row[idKey]);
    const qualifier = ordinal ? f.i18n.t(qualifierKey, "", { number: f.i18n.number(ordinal) }) : "";
    assert.equal(button.name(), base(f, row) + (qualifier ? " · " + qualifier : ""));
    assert.ok(!button.name().includes(row[idKey]) && !button.name().includes(encodeURIComponent(row[idKey])),
      "Ordinary human context and collision ordinals do not speak opaque identities");
    assert.ok(!button.name().includes("PRIVATE-TOKEN"));
    if (qualifier) assert.ok(f.visible().includes(qualifier), "Collision qualifier is also visible beside the row");
  }
}
// The shared accessible-name helper intentionally omits <small> from labels.
// A visible destructive-target check must instead read the entire current row,
// not the whole page (whose Person options already contain both email values).
function visibleRowNodes(node) {
  if (typeof node === "string") return [node];
  if (node.attributes.hidden !== undefined || String(node.attributes.class ?? "").split(/\s+/u).includes("sr-only")) return [];
  return [node, ...node.children.flatMap(visibleRowNodes)];
}
function accessRow(button) {
  let row = button.parent;
  while (row && row.tag !== "li") row = row.parent;
  assert.ok(row && row.parent?.tag === "ul" && row.parent.attributes.class === "access-grant-list");
  return row;
}
function visibleRowText(row) { return normalize(visibleRowNodes(row).filter(node => typeof node === "string").join(" ")); }
for (const locale of ["en", "fr", "ar", "ja"]) {
  test("specialist visible Revoke target " + locale + ": same names with different emails stay distinguishable", async t => {
    const sameNamed = [
      { ...grants[0], grant_id: "visible-target-A", email: "first@example.test" },
      { ...grants[0], grant_id: "visible-target-B/子", user_id: "user-visible-B", email: "b".repeat(60) + "@" + "c".repeat(60) + ".example.test" },
    ];
    const original = structuredClone(sameNamed), f = await access(t, locale, sameNamed);
    const inspect = () => {
      const buttons = namedButtons(f, "access.revoke");
      assertContextualNames(f, buttons, f.currentGrants, "grant_id", grantBase, "access.grantQualifier", []);
      const contexts = new Map();
      for (const [index, grant] of f.currentGrants.entries()) {
        const row = accessRow(buttons[index]), visible = visibleRowNodes(row);
        const email = visible.find(node => typeof node !== "string" && node.tag === "bdi"
          && node.children.join("") === grant.email);
        assert.ok(email, "the exact account email is visible and bidi-isolated in its own Revoke row");
        const rowText = visibleRowText(row);
        assert.ok(rowText.includes(grant.email));
        assert.ok(!rowText.includes(sameNamed.find(peer => peer.email !== grant.email).email));
        assert.ok(!rowText.includes(grant.grant_id) && !rowText.includes("PRIVATE-TOKEN"));
        assert.equal(buttons[index].visibleLabel(), f.i18n.t("access.revoke"));
        contexts.set(grant.email, { text: rowText, name: buttons[index].name() });
      }
      assert.equal(new Set([...contexts.values()].map(value => value.text)).size, sameNamed.length);
      return contexts;
    };
    const originalContexts = inspect();
    f.currentGrants.reverse(); f.host.connectedCallback(); await f.flush();
    assert.deepEqual([...inspect()].sort(), [...originalContexts].sort(), "visible identity and names do not depend on row position");
    const target = sameNamed[1], button = namedButtons(f, "access.revoke").find(node => visibleRowText(accessRow(node)).includes(target.email));
    assert.ok(button, "choose the action by its visible account context");
    await f.renderer.handler(f.host, "button", node => node.attributes["aria-label"] === button.name())(); await f.flush();
    assert.deepEqual(f.calls.filter(call => call.method === "DELETE").map(call => call.url),
      ["/api/platform/access/" + encodeURIComponent(target.grant_id)]);
    assert.equal(f.currentGrants.length, 1); assert.equal(f.currentGrants[0].grant_id, sameNamed[0].grant_id);
    assert.deepEqual(sameNamed, original);
  });
  test("specialist guidance " + locale + ": full current routing and size copy uses bounded translations", async t => {
    const f = await adapter(t, locale), original = structuredClone(report);
    for (const [reason, key] of reasonCases) {
      const response = preview(reason), before = structuredClone(response);
      await f.simulate(response); assert.equal(rowValue(f, "evaluation.preview.reason"), f.i18n.t(key));
      if (locale !== "en") assert.notEqual(f.i18n.t(key), reason);
      assert.equal(rowValue(f, "evaluation.preview.model"), model);
      assert.ok(f.visible().includes(historicalFinding), "Historical findings remain original");
      assert.deepEqual(response, before);
    }
    for (const [message, key] of sizeCases) {
      await f.simulate(preview(reasonCases[0][0], message));
      assert.ok(f.nodes().some(node => node.tag === "p" && node.attributes.role === "status" && node.name() === f.i18n.t(key)));
      if (locale !== "en") assert.notEqual(f.i18n.t(key), message);
    }
    const unknown = preview("Unknown retained reason {customer} عربي 日本語", "Unknown dimensions note {original}");
    await f.simulate(unknown); assert.equal(rowValue(f, "evaluation.preview.reason"), unknown.selection.reason);
    assert.ok(f.nodes().some(node => node.tag === "p" && node.name() === unknown.selection.sizeMessage));
    assert.deepEqual(report, original); assert.deepEqual(f.unexpected, []);
    assert.equal(f.calls.filter(call => call.method === "POST").length, reasonCases.length + sizeCases.length + 1);
    assert.equal(f.state.requests.length, 0);
  });
test("specialist Revoke " + locale + ": concise human context, stable collisions and exact handlers", async t => {
    const before = structuredClone(grants), f = await access(t, locale), collisionIds = grants.slice(0, 2).map(grant => grant.grant_id);
    const buttons = namedButtons(f, "access.revoke");
    assertContextualNames(f, buttons, f.currentGrants, "grant_id", grantBase, "access.grantQualifier", collisionIds);
    const originalNames = new Map(f.currentGrants.map((grant, index) => [grant.grant_id, buttons[index].name()]));
    f.currentGrants.reverse(); f.host.connectedCallback(); await f.flush();
    assertContextualNames(f, namedButtons(f, "access.revoke"), f.currentGrants, "grant_id", grantBase, "access.grantQualifier", collisionIds);
    for (const [index, grant] of f.currentGrants.entries()) assert.equal(namedButtons(f, "access.revoke")[index].name(), originalNames.get(grant.grant_id));
    for (const target of [grants[1], grants[2]]) {
      const index = f.currentGrants.findIndex(grant => grant.grant_id === target.grant_id), button = namedButtons(f, "access.revoke")[index];
      await f.renderer.handler(f.host, "button", node => node.attributes["aria-label"] === button.name())(); await f.flush();
    }
    assert.deepEqual(f.calls.filter(call => call.method === "DELETE").map(call => call.url),
      [grants[1], grants[2]].map(grant => "/api/platform/access/" + encodeURIComponent(grant.grant_id)));
    assert.equal(namedButtons(f, "access.revoke").length, grants.length - 2); assert.deepEqual(grants, before);
  });
  test("personal Revoke " + locale + ": concise document/expiry context and stable same-context links", async t => {
    const before = structuredClone(shares), f = await account(t, locale), collisionIds = shares.slice(0, 3).map(share => share.shareId);
    const buttons = namedButtons(f, "share.revoke");
    assertContextualNames(f, buttons, f.currentShares, "shareId", shareBase, "share.linkQualifier", collisionIds);
    const originalNames = new Map(f.currentShares.map((share, index) => [share.shareId, buttons[index].name()]));
    f.currentShares.reverse(); f.draw();
    assertContextualNames(f, namedButtons(f, "share.revoke"), f.currentShares, "shareId", shareBase, "share.linkQualifier", collisionIds);
    for (const [index, share] of f.currentShares.entries()) assert.equal(namedButtons(f, "share.revoke")[index].name(), originalNames.get(share.shareId));
    const target = shares[2], index = f.currentShares.findIndex(share => share.shareId === target.shareId), button = namedButtons(f, "share.revoke")[index];
    await f.renderer.handler(f.host, "button", node => node.attributes["aria-label"] === button.name())();
    assert.deepEqual(f.revoked, [target.shareId]); assert.equal(f.shareLoads, 1);
    assert.deepEqual(shares, before); assert.deepEqual(f.calls, []); assert.ok(!f.visible().includes("PRIVATE-TOKEN"));
    f.store.canManageProjectShares = () => false;
    f.currentShares = f.currentShares.map(share => ({ ...share, expiresAt: "unavailable-private-date" })); f.draw();
    assert.equal(namedButtons(f, "share.revoke").length, 0); assert.ok(!f.visible().includes(documentTitle));
    assert.deepEqual(f.calls, [], "Inaccessible share context is not loaded or rendered");
  });
  test("shared display qualifier " + locale + ": authored composed-name collisions and final identity fallback", async t => {
    const f = await access(t, locale), { qualifyDisplayCollisions } = await import("../src/model/output-naming.ts");
    const format = number => f.i18n.t("access.grantQualifier", "", { number: f.i18n.number(number) });
    const identity = id => f.i18n.t("access.grantIdentity", "", { id: isolate("[" + encodeURIComponent(id) + "]") });
    const rows = [{ key: "same-prefix-A", label: person }, { key: "same-prefix-B", label: person },
      { key: "authored-composed", label: person + " · " + format(1) }];
    const original = structuredClone(rows), fallbackCalls = [];
    const labels = qualifyDisplayCollisions(rows, format, id => { fallbackCalls.push(id); return identity(id); });
    assert.equal(new Set([...labels.values()].map(row => normalize(row.label))).size, rows.length);
    assert.deepEqual(fallbackCalls, [], "Ordinary composed names use existing ordinals, not full IDs");
    assert.deepEqual(labels, qualifyDisplayCollisions(rows, format), "Existing two-argument behavior is unchanged");
    assert.deepEqual(rows, original);
    assert.deepEqual([...qualifyDisplayCollisions([...rows].reverse(), format, identity)].sort(), [...labels].sort());
    // Defensive formatter-collision control only; this is not a claim that real locale number formats collide.
    const fallbackRows = [{ key: "same-prefix-A", label: person }, { key: "same-prefix-B", label: person },
      { key: "authored-final", label: person + " · " + format(1) + " · " + identity("same-prefix-A") }];
    const final = qualifyDisplayCollisions(fallbackRows, () => format(1), identity);
    assert.equal(new Set([...final.values()].map(row => normalize(row.label))).size, fallbackRows.length);
    for (const row of fallbackRows) assert.ok(final.get(row.key).label.endsWith(identity(row.key)));
    assert.deepEqual([...qualifyDisplayCollisions([...fallbackRows].reverse(), () => format(1), identity)].sort(), [...final].sort());
    assert.deepEqual(f.calls.filter(call => call.method !== "GET"), []);
  });

}
test("specialist guidance locale switching reuses the same retained simulation without another request", async t => {
  const f = await adapter(t, "en"), response = preview(reasonCases[0][0], sizeCases[1][0]), before = structuredClone(response);
  await f.simulate(response); const calls = structuredClone(f.calls), host = f.host;
  for (const locale of ["fr", "ar", "ja", "en"]) {
    f.changeLocale(locale); assert.equal(f.host, host);
    assert.equal(rowValue(f, "evaluation.preview.reason"), f.i18n.t(reasonCases[0][1]));
    assert.ok(f.nodes().some(node => node.tag === "p" && node.name() === f.i18n.t(sizeCases[1][1])));
    assert.equal(rowValue(f, "evaluation.preview.model"), model); assert.ok(f.visible().includes(historicalFinding));
  }
  assert.deepEqual(f.calls, calls); assert.deepEqual(response, before);
});
for (const [kind, create, key] of [["specialist", access, "access.revoke"], ["personal", account, "share.revoke"]]) {
  test(kind + " Revoke locale switching keeps current target names and causes no requests", async t => {
    const f = await create(t, "en"), calls = structuredClone(f.calls), host = f.host;
    for (const locale of ["fr", "ar", "ja", "en"]) {
      f.changeLocale(locale); const buttons = namedButtons(f, key);
      assert.equal(f.host, host); assertNames(f, buttons);
      assert.equal(buttons.length, kind === "specialist" ? grants.length : shares.length);
      assertContextualNames(f, buttons, kind === "specialist" ? f.currentGrants : f.currentShares,
        kind === "specialist" ? "grant_id" : "shareId", kind === "specialist" ? grantBase : shareBase,
        kind === "specialist" ? "access.grantQualifier" : "share.linkQualifier",
        kind === "specialist" ? grants.slice(0, 2).map(grant => grant.grant_id) : shares.slice(0, 3).map(share => share.shareId));
    }
    assert.deepEqual(f.calls, calls);
  });
}
