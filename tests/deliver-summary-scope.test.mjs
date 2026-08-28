import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { ARTIFACT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/artifact-delivery-messages.ts";

// Reuse the existing actual HTTP fixtures and full Deliver/Output classes.
// Only their test registrations are omitted; no production method is replaced.
// SQLite and native-template/focus ports are not browser, human-review or provider certification.
async function fixtureDeclarations(file, names) {
  const url = new URL(file, import.meta.url), source = readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)
    || ts.isExpressionStatement(node) && (
      ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "deregister"
      || ts.isBinaryExpression(node.expression) && ts.isIdentifier(node.expression.left) && node.expression.left.text === "declarations"
    )).map(node => node.getFullText(tree)).join("\n");
  url.search = "?deliver-summary-scope-fixture";
  const hook = registerHooks({ load(request, context, next) {
    return request === url.href ? { format: "module", source: declarations + "\nexport { " + names.join(",") + " };", shortCircuit: true } : next(request, context);
  } });
  try { return await import(url.href); } finally { hook.deregister(); }
}
const { personal, legacyFixture, readEvents, artifactFocusOptionsFromRoute, libraryFocusRoute } = await fixtureDeclarations(
  "./phase5-output-artifact-coexistence.test.mjs", ["personal", "legacyFixture", "readEvents", "artifactFocusOptionsFromRoute", "libraryFocusRoute"]);
const ui = await fixtureDeclarations("./output-document-context-names.test.mjs",
  ["contextualFixture", "FormaDeliver", "FormaOutputRequirements", "FormaOutputRequirementCard", "foldEvents", "loadActual", "ElementPort"]);
const { FormaArtifactSummary } = await ui.loadActual("src/components/artifact-summary.ts");
const { OutputVisual } = await ui.loadActual("src/components/output-visual.ts");
// This is the existing native port's direction query, not an OutputVisual override.
const originalMatches = Object.getOwnPropertyDescriptor(ui.ElementPort.prototype, "matches");
Object.defineProperty(ui.ElementPort.prototype, "matches", { configurable: true, value(selector) {
  assert.equal(selector, ":dir(rtl)"); return this.fixture.locale === "ar";
} });
const originalFetch = globalThis.fetch;
let networkCalls = 0;
test.before(() => { globalThis.fetch = async () => { networkCalls++; throw Error("deliver_scope_no_network"); }; });
test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalMatches) Object.defineProperty(ui.ElementPort.prototype, "matches", originalMatches);
  else delete ui.ElementPort.prototype.matches;
  assert.equal(networkCalls, 0);
});

async function outputState(t, kind) {
  const db = await personal.fixture(); t.after(() => db.sqlite.close());
  let legacy = null, target = null, assetId = null;
  if (kind !== "empty") {
    const spec = personal.imageSpec();
    spec.deliverables[0].format_variants = [spec.deliverables[0].format_variants[0]];
    await db.command({ action: "save", blockId: spec.id, spec });
    const plan = (await db.command({ action: "confirm" })).snapshot.confirmedPlan;
    target = plan.plan.targets[0];
    const upload = await db.upload(personal.png({ width: 2, height: 2 }));
    assetId = upload.command.assetId;
    const bound = await db.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId });
    assert.equal(bound.snapshot.summary.delivery_ready, false, "Matching a file is not acceptance.");
    if (kind !== "unaccepted") await db.command({ action: "review", resultId: bound.command.resultId,
      decision: "approve", reviewedCoverage: true, reviewedRights: true });
    if (kind === "mixed") {
      // Historical saved-result evidence, not a real person's review or new provider work.
      // Deliberately overlapping IDs ensure the copy cannot assume disjoint Output plans.
      legacy = legacyFixture({ artifactId: target.id, sourceId: "source", documentId: personal.doc,
        projectId: personal.project, owner: personal.owner });
      const current = ui.foldEvents(await readEvents(db.env, "creative:" + personal.owner), Infinity, personal.doc, personal.project);
      const versions = current.blocks.filter(block => !block.removed).map(block => ({ block_id: block.id, version: block.sourceEvents.length }));
      await personal.appendEvents(db.env, legacy.events.filter(row =>
        ["DocumentRenderRequested", "DocumentRenderCompleted", "ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].includes(row.type))
        .map(row => row.type.startsWith("DocumentRender") ? { ...row, payload: { ...row.payload, source_block_versions: versions } } : row));
      await personal.appendEvents(db.env, [personal.makeEvent("creative:" + personal.owner, 0, "worker:generator",
        "deliver-scope-fixture", "retained-visual-history", "GenerationCompleted", {
          project_id: personal.project, document_id: personal.doc, object_ids: [assetId],
          title: "Retained visual history", media_url: "/api/media/fixture-owned-visual", provider: "simulation", simulation: true,
        })]);
    }
  }
  return { db, legacy, target, assetId, snapshot: await db.snapshot(), events: await readEvents(db.env, "creative:" + personal.owner) };
}

async function deliver(t, locale, state) {
  const f = await ui.contextualFixture(t, locale);
  f.host.disconnectedCallback();
  f.output = structuredClone(state.snapshot);
  f.state.events = structuredClone(state.events); f.state.projectId = personal.project;
  f.state.documentId = personal.doc; f.state.route = "/deliver"; f.routes = []; f.commandResults = [];
  f.store.session = { get: () => ({ user: { userId: personal.owner, role: "creator" },
    capabilities: ["project.read", "project.author", "project.output.request"] }) };
  f.store.projection = { get: () => ui.foldEvents(f.state.events, Infinity, f.state.documentId, f.state.projectId) };
  f.store.route = { get: () => f.state.route };
  f.store.setRoute = path => f.routes.push(path);
  f.store.refreshEvents = async () => true;
  if (state.legacy) f.store.content.set({ "legacy-content": state.legacy.content });
  f.store.outputRequirements.resource = id => ({ state: "ready", snapshot: id === personal.doc ? f.output : null, error: null });
  f.store.outputRequirements.ensure = async id => f.store.outputRequirements.resource(id);
  f.store.outputRequirementCommand = async command => {
    f.commands.push(command);
    const body = await state.db.command(command);
    f.commandResults.push(body); f.output = body.snapshot;
    return { status: "saved", body };
  };
  f.renderer.registry = { "forma-output-requirements": ui.FormaOutputRequirements,
    "forma-output-requirement-card": ui.FormaOutputRequirementCard,
    "forma-artifact-summary": FormaArtifactSummary, "forma-output-visual": OutputVisual };
  f.host = new ui.FormaDeliver(); f.host.isConnected = true; f.host.connectedCallback(); f.draw();
  const controllers = [...f.renderer.instances.values()].map(row => row.instance).filter(row => row instanceof ui.FormaOutputRequirements);
  assert.equal(controllers.length, 1); f.controller = controllers[0];
  assert.equal(f.controller.documentId, personal.doc);
  return f;
}

function containedBy(node, parent) { for (let current = node?.parent; current; current = current.parent) if (current === parent) return true; return false; }
function assertSection(f, kind) {
  const nodes = f.nodes(), label = f.i18n.t("artifact.delivery.resultsSection");
  const section = nodes.find(node => node.tag === "section" && node.attributes["aria-label"] === label);
  assert.ok(section, "The named region scopes only Creative results.");
  assert.ok(nodes.some(node => node.tag === "b" && node.visibleLabel() === label && containedBy(node, section)));
  assert.ok(section.visibleLabel().includes(f.i18n.t("artifact.delivery.resultsScope")));
  const summary = nodes.find(node => node.attributes.class === "forma-deliver-summary");
  assert.ok(containedBy(summary, section));
  assert.equal(summary.name(), f.i18n.t("artifact.delivery.resultsSummary"));
  assert.notEqual(summary.name(), f.i18n.t("deliver.summary"));
  const counters = nodes.filter(node => node.tag === "b" && containedBy(node, summary)).map(node => Number(node.visibleLabel()));
  assert.deepEqual(counters, kind === "mixed" ? [1, 1, 1, 1] : [0, 0, 0, 0]);
  assert.ok(summary.visibleLabel().includes(f.i18n.t("artifact.delivery.documentCount")));
  assert.ok(summary.visibleLabel().includes(f.i18n.t("artifact.delivery.approvalCount")));
  assert.ok(summary.visibleLabel().includes(f.i18n.t("artifact.delivery.exportCount")));
  assert.ok(section.visibleLabel().includes(f.i18n.t("artifact.delivery.notDelivered")));
  const empty = nodes.find(node => node.attributes["data-forma-empty-state"] !== undefined && containedBy(node, section));
  assert.equal(Boolean(empty), kind !== "mixed");
  if (empty) {
    assert.ok(empty.visibleLabel().includes(f.i18n.t("artifact.delivery.resultsEmpty")));
    assert.ok(empty.visibleLabel().includes(f.i18n.t("artifact.delivery.resultsEmptyDescription")));
  }
  assert.equal(nodes.some(node => node.tag === "h2" && node.visibleLabel() === f.i18n.t("deliver.emptyTitle")), false);
  const output = nodes.find(node => node.tag === "forma-output-requirements");
  assert.ok(output); assert.equal(containedBy(output, section), false, "The same keyed Output controller stays outside the subsection.");
  assert.deepEqual(f.routes, []);
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["accepted", "mixed", "empty", "unaccepted"]) {
  test("Deliver subsection scope " + locale + ": actual " + kind + " Output and Creative results remain separately counted", async t => {
    const state = await outputState(t, kind), f = await deliver(t, locale, state);
    assertSection(f, kind);
    assert.deepEqual(f.output, state.snapshot); assert.deepEqual(f.commands, []); assert.deepEqual(f.downloads, []);
    assert.equal(f.state.requests.length, 0);
    const projection = f.store.projection.get(), before = structuredClone(f.output.summary);
    assert.equal(projection.libraryArtifacts.length, kind === "mixed" ? 1 : 0);
    assert.equal(projection.libraryOutputs.length, kind === "mixed" ? 1 : 0);
    const nodes = f.nodes(f.controller);
    const download = nodes.find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadFiles"));
    if (kind === "accepted" || kind === "mixed") {
      assert.equal(before.required_obligations, 1); assert.equal(before.fulfilled_required_obligations, 1);
      assert.equal(before.delivery_ready, true); assert.ok(download); assert.equal(download.disabled(), false);
      const review = nodes.find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadReview"));
      assert.ok(review); assert.equal(review.disabled(), false);
      await f.click(review, f.controller);
      assert.deepEqual(f.downloads[0], { documentId: personal.doc, path: f.output.assets.find(asset => asset.id === state.assetId).downloadUrl });
      const form = nodes.find(node => node.tag === "form" && node.attributes.class === "output-export");
      assert.ok(form); assert.equal(typeof form.handlers.submit, "function");
      await form.handlers.submit.call(f.controller, { preventDefault() {} }); await f.flush();
      assert.equal(f.commands.length, 1); assert.equal(f.commands[0].action, "export");
      assert.equal(f.commands[0].documentId, personal.doc);
      assert.equal(f.commands[0].planRevisionId, state.snapshot.confirmedPlan.revisionId);
      assert.equal(f.downloads.length, 2, "The real export handler requests the actual prepared manifest path, without releasing browser bytes in this port.");
      assert.equal(f.downloads[1].path, f.commandResults[0].command.downloadUrl);
      assert.ok(f.commandResults[0].command.manifestId);
      assert.equal(f.downloads[1].documentId, personal.doc);
      assert.deepEqual(f.output.summary, before);
      f.state.events = await readEvents(state.db.env, "creative:" + personal.owner); f.draw();
      assertSection(f, kind);
      if (kind === "mixed") {
        const links = f.nodes().filter(node => node.tag === "a" && typeof node.handlers.click === "function");
        const exact = links.find(node => node.attributes.class === "button secondary compact" && artifactFocusOptionsFromRoute(node.attributes.href)?.expectedContentSha256 === state.legacy.sha);
        assert.ok(exact);
        const focus = artifactFocusOptionsFromRoute(exact.attributes.href);
        assert.equal(focus.expectedRevision, 0); assert.equal(focus.intent, "export");
        let prevented = 0;
        exact.handlers.click.call(f.host, { defaultPrevented: false, button: 0, ctrlKey: true, preventDefault() { prevented++; } });
        assert.equal(prevented, 0); assert.deepEqual(f.routes, []);
        exact.handlers.click.call(f.host, { defaultPrevented: false, button: 0, preventDefault() { prevented++; } });
        assert.equal(prevented, 1); assert.deepEqual(f.routes, [exact.attributes.href]);
        assert.ok(links.some(node => node.attributes.href === libraryFocusRoute("output", state.assetId, "Retained visual history")));
      }
    } else if (kind === "unaccepted") {
      assert.equal(before.required_obligations, 1); assert.equal(before.fulfilled_required_obligations, 0);
      assert.equal(before.delivery_ready, false); assert.ok(download); assert.equal(download.disabled(), true);
    } else {
      assert.equal(f.output.requirements.length, 0); assert.equal(f.output.assets.length, 0);
      assert.equal(f.output.results.length, 0); assert.equal(download, undefined);
    }
    for (const table of ["document_jobs", "output_execution_grants", "output_operation_slots", "output_provider_calls"])
      assert.equal(state.db.sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 0, table);
  });
}

test("Deliver scope copy is complete in four catalogs and does not relabel the shared Project overview summary", () => {
  const keys = ["resultsSection", "resultsScope", "resultsEmpty", "resultsEmptyDescription", "resultsSummary", "documentCount"];
  for (const locale of ["en", "fr", "ar", "ja"]) for (const key of keys)
    assert.equal(typeof ARTIFACT_DELIVERY_MESSAGES[locale]["artifact.delivery." + key], "string");
  const projectContents = readFileSync(new URL("../src/components/forma-project-contents.ts", import.meta.url), "utf8");
  assert.match(projectContents, /this\.i18n\.t\("deliver\.summary"/u);
  for (const key of keys) assert.equal(projectContents.includes("artifact.delivery." + key), false);
});
