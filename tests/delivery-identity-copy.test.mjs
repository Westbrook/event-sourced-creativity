import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { artifactFocusOptionsFromRoute, libraryFocusFromRoute } from "../src/model/routes.ts";
import { foldEvents } from "../src/model/events.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { ARTIFACT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/artifact-delivery-messages.ts";

// Complete current Deliver/Activity/ArtifactSummary classes and real locale
// controllers. Authorized history, DOM semantics and routing are fixture ports;
// this is not full Store/Worker authority, browser, AT or provider certification.
const fixtureUrl = new URL("./output-contextual-names.test.mjs", import.meta.url);
const original = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstLoop = tree.statements.find(ts.isForOfStatement);
assert.ok(firstLoop);
const fixtureSource = original.slice(0, firstLoop.getFullStart())
  + "\nexport {fixture,loadActual,semanticNodes,localizeTemplateResult,ElementPort};";
const virtual = new URL(fixtureUrl); virtual.search = "?delivery-identity-copy-fixture";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source: fixtureSource, shortCircuit: true } : next(url, context);
} });
let fixtureModule;
try { fixtureModule = await import(virtual.href); } finally { hook.deregister(); }
const { fixture, loadActual, semanticNodes, localizeTemplateResult, ElementPort } = fixtureModule;
const { FormaDeliver } = await loadActual("src/components/forma-deliver.ts");
const { FormaActivity } = await loadActual("src/components/forma-activity.ts");
const { FormaArtifactSummary } = await loadActual("src/components/artifact-summary.ts");
const { OutputVisual } = await loadActual("src/components/output-visual.ts");
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const localeCatalogs = Object.fromEntries(await Promise.all(["en", "fr", "ar", "ja"].map(async locale =>
  [locale, (await loadActual("src/components/design-system/locales/" + (locale === "en" ? "system-en" : locale) + ".ts")).default])));
const oldMatches = Object.getOwnPropertyDescriptor(ElementPort.prototype, "matches");
Object.defineProperty(ElementPort.prototype, "matches", { configurable: true, value(selector) {
  assert.equal(selector, ":dir(rtl)");
  return this.fixture.i18n.direction === "rtl";
} });
test.after(() => {
  if (oldMatches) Object.defineProperty(ElementPort.prototype, "matches", oldMatches);
  else delete ElementPort.prototype.matches;
});

const legacyUrl = new URL("./phase5-output-artifact-coexistence.test.mjs", import.meta.url);
const legacyText = fs.readFileSync(legacyUrl, "utf8");
const legacyTree = ts.createSourceFile(legacyUrl.pathname, legacyText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const legacyDeclarations = legacyTree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
  || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)).map(node => node.getText(legacyTree)).join("\n")
  + "\nexport {legacyFixture};";
legacyUrl.search = "?delivery-identity-historical-fixture";
const legacyHook = registerHooks({ load(url, context, next) {
  return url === legacyUrl.href ? { format: "module", source: legacyDeclarations, shortCircuit: true } : next(url, context);
} });
let legacyFixture;
try { ({ legacyFixture } = await import(legacyUrl.href)); } finally { legacyHook.deregister(); }

const normalize = value => String(value ?? "").replace(/[\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
const digest = value => createHash("sha256").update(value).digest("hex");
const title = "Shared output مخرج 同じ成果";
const documentTitle = "Shared document مستند 同じ文書";
const ancestor = (node, tag) => { while (node && node.tag !== tag) node = node.parent; return node; };

function localeController(t, f, initial) {
  let publish, revision = 0;
  const value = locale => ({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr",
    timeZone: "UTC", messages: { ...FORMA_DEFAULT_MESSAGES, ...localeCatalogs[locale] }, revision: ++revision });
  const controller = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    publish = event.callback; publish(value(initial), () => {}); return true;
  } });
  controller.hostConnected(); t.after(() => controller.hostDisconnected());
  f.i18n = controller;
  f.changeLocale = locale => { f.locale = locale; publish(value(locale)); };
}

function mount(t, locale, surface) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No API or provider call is permitted by this presentation fixture"));
  const f = fixture(t, { locale, facts: [{ id: "source-A", type: "direction", text: "Current author-owned source." }] });
  f.host.disconnectedCallback();
  localeController(t, f, locale);
  f.session = { ...f.store.session.get(), projectContext: { projectId: "p", organizationId: "org", projectAccessId: "access",
    role: "editor", managedPilot: true, permissions: ["project.read", "project.author", "project.output.request", "project.review.approve"] } };
  f.store.session = { get: () => f.session };
  f.route = "/" + surface + "?document=A"; f.routes = [];
  f.store.route = { get: () => f.route };
  f.store.setRoute = next => f.routes.push(next);
  f.store.planningRecoveryEntries = () => [];
  f.projectId = "p"; f.documentId = "A"; f.order = projection => projection;
  f.store.projection = { get: () => f.order(foldEvents(f.state.events, Infinity, f.documentId, f.projectId)) };
  f.renderer.registry["forma-artifact-summary"] = FormaArtifactSummary;
  f.renderer.registry["forma-output-visual"] = OutputVisual;
  f.host = surface === "deliver" ? new FormaDeliver() : new FormaActivity();
  f.host.i18n = f.i18n; f.host.tag = "forma-" + surface; f.host.isConnected = true;
  f.draw = () => { f.renderer.draw(f.host, () => localizeTemplateResult(f.host.render(), f.i18n)); return semanticNodes(f, f.host); };
  f.append = (type, payload, actor = "user:creator") => {
    const event = { eventId: "identity-" + (f.state.events.length + 1), streamId: "stream", sequence: f.state.events.length + 1,
      actor, correlationId: "identity", occurredAt: "2026-08-28T16:00:00Z", type, payload: { project_id: f.projectId, ...payload } };
    f.state.events.push(event); return event;
  };
  f.addDocument = (id, name) => {
    f.append("DocumentCreated", { document_id: id, title: name });
    f.append("BlockCreated", { document_id: id, block_id: "source-" + id, type: "direction", handle: "direction/source-" + id,
      position: "a0", properties: { text: "Current author-owned source.", weight: 1, intent: "include" } });
  };
  f.hashes = new Map();
  f.addArtifact = (id, doc, kind, name, stage) => {
    const content = JSON.stringify({ title: name, content_markdown: "Exact authored content for " + id, items: [] });
    const sha = digest(content), exact = { document_id: doc, artifact_id: id, artifact_kind: kind, artifact_revision: 0, content_sha256: sha };
    const versions = [{ block_id: "source-" + doc, version: 1 }];
    f.store.content.set({ ...f.store.content.get(), ["content:" + id]: content }); f.hashes.set(id, sha);
    f.append("DocumentRenderRequested", { ...exact, source_block_versions: versions });
    f.append("DocumentRenderCompleted", { ...exact, title: name, content_ref: "content:" + id, item_count: 1, items: [], settings: {},
      summary: "Exact authored summary for " + id, requested_by_user_id: "creator", source_block_versions: versions }, "worker:renderer");
    f.append("ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: "owner" }, "user:assigner");
    if (stage === "export") f.append("ArtifactApproved", exact, "user:owner");
  };
  f.state.events.find(event => event.type === "DocumentCreated").payload.title = documentTitle;
  return f;
}

function artifactActions(f, nodes = f.draw()) {
  return nodes.filter(node => node.tag === "a" && String(node.attributes.class ?? "").includes("button")
    && libraryFocusFromRoute(node.attributes.href ?? "")?.kind === "artifact");
}
function identityNames(f) {
  return new Map(artifactActions(f).map(node => [libraryFocusFromRoute(node.attributes.href).id, normalize(node.name())]));
}
function noCommands(f) { assert.deepEqual(f.state.requests, []); assert.deepEqual(f.state.loads, []); }

for (const locale of ["en", "fr", "ar", "ja"]) for (const surface of ["deliver", "activity"]) for (const stage of ["review", "export"]) {
  test(surface + " repeated exact " + stage + " actions have unique contextual names in " + locale, t => {
    const f = mount(t, locale, surface); f.addDocument("B", documentTitle);
    for (const doc of ["A", "B"]) for (const take of [1, 2]) f.addArtifact("artifact:" + doc + ":" + take, doc, "short_story", title, stage);
    const before = structuredClone({ events: f.state.events, content: f.store.content.get() });
    const nodes = f.draw(), controls = artifactActions(f, nodes), action = f.i18n.t("artifact.delivery.action." + stage);
    assert.equal(controls.length, 4);
    assert.equal(new Set(controls.map(node => normalize(node.name()))).size, 4);
    const cards = controls.map(node => ancestor(node, "article"));
    assert.equal(new Set(cards.map(card => normalize(card.name()))).size, 4);
    assert.equal(new Set(cards.map(card => normalize(card.visibleLabel()))).size, 4);
    for (const control of controls) {
      const name = normalize(control.name()), card = ancestor(control, "article");
      assert.equal(normalize(control.visibleLabel()), normalize(action), "the entire visible action phrase stays unchanged");
      assert.ok(name.startsWith(normalize(action)));
      assert.ok(name.includes(title)); assert.ok(name.includes(documentTitle));
      assert.ok(name.includes(f.i18n.t("artifact.delivery.documentQualifier", "", { number: f.i18n.number(1) }))
        || name.includes(f.i18n.t("artifact.delivery.documentQualifier", "", { number: f.i18n.number(2) })));
      const focus = libraryFocusFromRoute(control.attributes.href), options = artifactFocusOptionsFromRoute(control.attributes.href);
      assert.equal(options.intent, stage); assert.equal(options.expectedRevision, 0); assert.equal(options.expectedContentSha256, f.hashes.get(focus.id));
      assert.ok(card.visibleLabel().includes(title)); assert.ok(card.visibleLabel().includes(documentTitle));
      if (surface === "deliver") assert.ok(card.visibleLabel().includes("Exact authored summary for " + focus.id), "the real summary child keeps the authored summary");
      for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
        control.handlers.click.call(f.host, { defaultPrevented: false, button: 0, [modifier]: true, preventDefault() { assert.fail("modifier follows the unchanged native href"); } });
      }
      let prevented = 0;
      control.handlers.click.call(f.host, { defaultPrevented: false, button: 0, preventDefault() { prevented++; } });
      assert.equal(prevented, 1); assert.equal(f.routes.at(-1), control.attributes.href);
    }
    assert.equal(new Set(f.routes).size, 4);
    const previews = nodes.filter(node => node.tag === "a" && node.attributes.class === "forma-deliver-preview");
    if (surface === "deliver") assert.equal(new Set(previews.map(node => normalize(node.name()))).size, 4);
    assert.deepEqual({ events: f.state.events, content: f.store.content.get() }, before);
    f.session = { ...f.session, projectContext: { ...f.session.projectContext, projectId: "another-project" } };
    assert.equal(artifactActions(f).length, 0);
    f.session = null; assert.equal(artifactActions(f).length, 0);
    noCommands(f);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const surface of ["deliver", "activity"]) {
  test(surface + " resolves composed name aliases and different artifact kinds in " + locale, t => {
    const f = mount(t, locale, surface);
    f.state.events.find(event => event.type === "DocumentCreated").payload.title = "End";
    f.addDocument("B", "Mid · End");
    f.addArtifact("alias-a", "A", "short_story", "Start · Mid", "export");
    f.addArtifact("alias-b", "B", "short_story", "Start", "export");
    const controls = artifactActions(f);
    assert.equal(controls.length, 2); assert.equal(new Set(controls.map(node => normalize(node.name()))).size, 2);
    for (const node of controls) {
      const card = ancestor(node, "article");
      assert.ok(card.visibleLabel().includes(f.i18n.t("artifact.delivery.resultQualifier", "", { number: f.i18n.number(1) }))
        || card.visibleLabel().includes(f.i18n.t("artifact.delivery.resultQualifier", "", { number: f.i18n.number(2) })));
    }
    f.addArtifact("different-kind-slides", "B", "slides", "Start", "export");
    f.addArtifact("different-kind-scene", "B", "scene", "Start", "export");
    const after = artifactActions(f);
    assert.equal(after.length, 4); assert.equal(new Set(after.map(node => normalize(node.name()))).size, 4);
    for (const node of after) {
      const id = libraryFocusFromRoute(node.attributes.href).id;
      assert.equal(artifactFocusOptionsFromRoute(node.attributes.href).expectedContentSha256, f.hashes.get(id));
    }
    assert.deepEqual(f.routes, []); noCommands(f);
  });

  test(surface + " scoped names stay stable on reorder, unrelated addition and actual locale changes from " + locale, t => {
    const f = mount(t, locale, surface); f.addDocument("B", documentTitle);
    for (const doc of ["A", "B"]) for (const take of [1, 2]) f.addArtifact("stable:" + doc + ":" + take, doc, "short_story", title, "export");
    const before = identityNames(f), routes = new Map(artifactActions(f).map(node => [libraryFocusFromRoute(node.attributes.href).id, node.attributes.href]));
    f.order = projection => ({ ...projection, documents: [...projection.documents].reverse(), libraryArtifacts: [...projection.libraryArtifacts].reverse() });
    assert.deepEqual(identityNames(f), before);
    f.addDocument("0-unrelated", "A different document");
    f.addArtifact("unrelated-result", "0-unrelated", "short_story", "A distinct result", "export");
    const added = identityNames(f);
    for (const [id, name] of before) assert.equal(added.get(id), name);
    for (const next of ["en", "fr", "ar", "ja"]) {
      f.changeLocale(next);
      assert.equal(f.i18n.locale, next); assert.equal(f.i18n.direction, next === "ar" ? "rtl" : "ltr");
      const controls = artifactActions(f);
      assert.equal(new Set(controls.map(node => normalize(node.name()))).size, controls.length);
      for (const node of controls) {
        const id = libraryFocusFromRoute(node.attributes.href).id;
        assert.ok(normalize(node.name()).startsWith(normalize(node.visibleLabel())));
        if (routes.has(id)) assert.equal(node.attributes.href, routes.get(id));
        if (id !== "unrelated-result") assert.ok(normalize(node.name()).includes(f.i18n.t("artifact.delivery.documentQualifier", "", { number: f.i18n.number(1) }))
          || normalize(node.name()).includes(f.i18n.t("artifact.delivery.documentQualifier", "", { number: f.i18n.number(2) })));
      }
    }
    f.changeLocale(locale);
    for (const [id, name] of before) assert.equal(identityNames(f).get(id), name);
    assert.deepEqual(f.routes, []); noCommands(f);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const scenario of [
  "legacy-current", "legacy-revoked", "versioned-current", "versioned-revoked", "legacy-no-read",
]) {
  test("Deliver historical export acknowledgment and current source blocker remain separate: " + locale + "/" + scenario, t => {
    const legacy = legacyFixture({ stage: "exported" }), f = mount(t, locale, "deliver");
    let events = structuredClone(legacy.events);
    if (scenario.startsWith("legacy")) {
      events = events.filter(row => !["ArtifactReviewRequested", "ArtifactApproved"].includes(row.type));
      for (const row of events) {
        if (["DocumentRenderRequested", "DocumentRenderCompleted"].includes(row.type)) delete row.payload.source_block_versions;
        if (row.type === "DocumentArtifactExported") row.payload.export_class = "unreviewed-draft";
      }
    }
    if (scenario.endsWith("revoked")) events.push({ ...events[0], eventId: "current-rights-revocation",
      sequence: Math.max(...events.map(row => row.sequence)) + 1, type: "BlockPropertyEdited", actor: "user:" + legacy.owner,
      payload: { project_id: legacy.projectId, document_id: legacy.documentId, block_id: "legacy-source",
        property_path: "rights_revoked", old_value: false, new_value: true } });
    f.state.events = events; f.projectId = legacy.projectId; f.documentId = legacy.documentId;
    f.route = "/deliver?document=" + encodeURIComponent(legacy.documentId);
    f.store.content.set({ "legacy-content": legacy.content });
    f.session = { ...f.session, user: { userId: legacy.owner }, projectContext: { ...f.session.projectContext,
      projectId: legacy.projectId, managedPilot: false } };
    if (scenario === "legacy-no-read") f.session = null;
    const projection = f.store.projection.get(), artifact = projection.libraryArtifacts[0];
    const state = artifactDeliveryFor(f.store, artifact, legacy.sha), originalReceipt = events.find(row => row.type === "DocumentArtifactExported");
    const before = structuredClone({ events, content: f.store.content.get(), state });
    const nodes = f.draw(), cards = nodes.filter(node => node.tag === "article" && node.attributes.class === "forma-deliver-card");
    const footer = nodes.find(node => node.tag === "span" && String(node.attributes.class ?? "").includes("forma-deliver-status"));
    const text = normalize(footer?.name()), messages = ARTIFACT_DELIVERY_MESSAGES[locale];
    const historical = scenario === "legacy-current" || scenario === "legacy-revoked" || scenario === "versioned-current";
    assert.equal(Boolean(state.exportReceipt), historical);
    assert.equal(text.includes(messages["artifact.delivery.exportRecorded"]), historical);
    assert.equal(text.includes(messages["artifact.delivery.exportAuthorized"]), false, "a past acknowledgment never claims present authorization");
    assert.equal(text.includes(messages["artifact.delivery.currentSourcesBlocked"]), scenario.endsWith("revoked"));
    if (historical) assert.equal(state.exportReceipt.eventId, originalReceipt.eventId);
    if (scenario.endsWith("revoked")) { assert.equal(state.releaseAllowed, false); assert.equal(state.action, "sources"); assert.equal(state.rightsBlockIds.length, 1); }
    if (scenario === "legacy-current") { assert.equal(state.releaseAllowed, true); assert.equal(state.action, "exportDraft"); assert.equal(state.approved, false); }
    if (scenario === "versioned-current") { assert.equal(state.releaseAllowed, true); assert.equal(state.action, "export"); assert.equal(state.approved, true); }
    assert.equal(state.deliveryStatus, "unconfirmed"); assert.equal(cards.length, scenario === "legacy-no-read" ? 0 : 1);
    assert.ok(f.host.markup.includes(messages["artifact.delivery.notDelivered"]));
    const summary = nodes.find(node => String(node.attributes.class ?? "").includes("forma-deliver-summary"));
    const counts = nodes.filter(node => node.tag === "b" && ancestor(node, "div")?.parent === summary).map(node => Number(node.name()));
    assert.deepEqual(counts, [scenario === "legacy-no-read" ? 0 : 1, 0, scenario === "versioned-current" ? 1 : 0, historical ? 1 : 0]);
    assert.equal(events.find(row => row.eventId === originalReceipt.eventId), originalReceipt);
    assert.deepEqual({ events, content: f.store.content.get(), state: artifactDeliveryFor(f.store, artifact, legacy.sha) }, before);
    assert.deepEqual(f.routes, []); noCommands(f);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const surface of ["deliver", "activity"]) {
  test(surface + " keeps image and artifact namespaces, visible authored titles and exact destinations separate in " + locale, t => {
    const f = mount(t, locale, surface); f.addDocument("B", documentTitle);
    f.addArtifact("same-namespace-id", "A", "short_story", "Exact authored artifact title", "export");
    for (const [doc, id] of [["A", "same-namespace-id"], ["B", "image-B"]])
      f.append("GenerationCompleted", { document_id: doc, generation_id: "generation-" + doc, object_ids: [id],
        title: "Exact authored image title", quality: "high", purpose: "final", provider: "simulation",
        simulation: true, media_url: "/api/media/fixture-" + doc }, "worker:generator");
    const projection = f.store.projection.get();
    assert.equal(projection.libraryArtifacts[0].title, "Exact authored artifact title");
    assert.equal(projection.libraryOutputs.length, 2);
    assert.ok(projection.libraryOutputs.every(output => output.title === "Exact authored image title"));
    const before = structuredClone({ events: f.state.events, content: f.store.content.get() });
    const nodes = f.draw(), artifactAction = artifactActions(f, nodes)[0], card = ancestor(artifactAction, "article");
    const heading = nodes.find(node => node.tag === "h3" && ancestor(node, "article") === card
      && node.parent.attributes.class === (surface === "deliver" ? "forma-deliver-copy" : "forma-activity-card-copy"));
    assert.equal(normalize(heading.name()), "Exact authored artifact title", "another namespace with the same opaque ID cannot replace an authored title");
    assert.ok(normalize(artifactAction.name()).includes("Exact authored artifact title"));
    const images = surface === "deliver"
      ? nodes.filter(node => node.tag === "a" && String(node.attributes.class ?? "").includes("button")
        && libraryFocusFromRoute(node.attributes.href ?? "")?.kind === "output")
      : nodes.filter(node => node.tag === "button" && normalize(node.visibleLabel()) === normalize(f.i18n.t("activity.openResult", "Open result")));
    assert.equal(images.length, 2); assert.equal(new Set(images.map(node => normalize(node.name()))).size, 2);
    for (const image of images) {
      assert.ok(normalize(image.name()).startsWith(normalize(image.visibleLabel())));
      assert.ok(ancestor(image, "article").visibleLabel().includes(documentTitle));
      assert.ok(normalize(image.name()).includes("Exact authored image title"));
      image.handlers.click.call(f.host, { defaultPrevented: false, button: 0, preventDefault() {} });
    }
    assert.deepEqual(new Set(f.routes.map(route => libraryFocusFromRoute(route).id)), new Set(["same-namespace-id", "image-B"]));
    assert.ok(f.routes.every(route => libraryFocusFromRoute(route).kind === "output"));
    assert.deepEqual({ events: f.state.events, content: f.store.content.get() }, before);
    noCommands(f);
  });

  test(surface + " leaves a unique authored result without visible collision qualifiers in " + locale, t => {
    const f = mount(t, locale, surface);
    f.addArtifact("one-current-artifact", "A", "short_story", "One exact authored title", "export");
    const nodes = f.draw(), controls = artifactActions(f, nodes), card = ancestor(controls[0], "article");
    assert.equal(controls.length, 1);
    assert.ok(card.visibleLabel().includes("One exact authored title"));
    assert.equal(card.visibleLabel().includes(f.i18n.t("artifact.delivery.documentQualifier", "", { number: f.i18n.number(1) })), false);
    assert.equal(card.visibleLabel().includes(f.i18n.t("artifact.delivery.resultQualifier", "", { number: f.i18n.number(1) })), false);
    assert.ok(normalize(controls[0].name()).startsWith(normalize(controls[0].visibleLabel())));
    assert.equal(artifactFocusOptionsFromRoute(controls[0].attributes.href).expectedContentSha256, f.hashes.get("one-current-artifact"));
    assert.deepEqual(f.routes, []); noCommands(f);
  });
}
