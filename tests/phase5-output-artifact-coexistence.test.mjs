import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
import { foldEvents } from "../src/model/events.ts";
import { artifactDeliveryState } from "../src/model/artifact-delivery.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { artifactSourceVersions } from "../src/model/context-health.ts";
import { documentArtifactDefinition } from "../src/model/document-artifacts.ts";
import { describeOutputs, imageOutputNamingCandidate } from "../src/model/output-naming.ts";
import { scopedFormaActivity } from "../src/model/activity.ts";
import { artifactFocusRoute, artifactFocusOptionsFromRoute, libraryFocusRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";
import { ARTIFACT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/artifact-delivery-messages.ts";
import { template as html, templates, binding, eventHandlers } from "./output-ui-source-harness.mjs";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import { calmFullPageNativePorts as lifecyclePorts } from "./helpers/calm-full-page-fixture.mjs";

// Reuse complete actual modules through the existing native/module boundary.
const { nextActionFacts } = await lifecyclePorts.loadActual("src/state/next-action-context.ts");
const { creativeNextActions } = await lifecyclePorts.loadActual("src/model/workspace-intelligence.ts");
const { renderLifecycleNextActionCards } = await lifecyclePorts.loadActual("src/components/next-action-cards.ts");
const { openCreativeNextActionDestination } = await lifecyclePorts.loadActual("src/components/creative-next-action-navigation.ts");

// Reuse the actual HTTP fixture declarations without registering its entire
// suite twice. SQL, author/source checks, uploads and receipts remain real RAM
// fixture operations; no provider or network transport is permitted.
async function fixtureDeclarations(file, exports) {
  const url = new URL(file, import.meta.url), raw = readFileSync(url, "utf8");
  const parsed = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = parsed.statements.flatMap(node => {
    if (ts.isImportDeclaration(node) || ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
      || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
        && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "deregister")
      return [node.getText(parsed)];
    return [];
  }).join("\n") + "\nexport { " + exports.join(",") + " };";
  url.search = "?phase5-output-artifact-coexistence-fixture";
  const hooks = registerHooks({ load(request, context, nextLoad) {
    if (request === url.href) return { format: "module", source, shortCircuit: true };
    return nextLoad(request, context);
  } });
  try { return await import(url.href); } finally { hooks.deregister(); }
}
const personal = await fixtureDeclarations("./output-requirements-api.test.mjs", ["fixture", "imageSpec", "png", "makeEvent", "appendEvents", "doc", "project", "owner"]);
const { readEvents } = await import("../worker/runtime.ts");
const originalFetch = globalThis.fetch;
let networkCalls = 0;
test.before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error("phase5_no_network"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });

const digest = value => createHash("sha256").update(value).digest("hex");
function strictFixture(t, state) {
  const depth = enforceD1ExpressionDepth(state);
  t.after(() => { depth.restore(); depth.assertVerified(); assert.equal(depth.failures.length, 0); });
  return state;
}
function legacyFixture({ stage = "exported", documentId = "legacy-document", projectId = "legacy-project", artifactId = "legacy-artifact", sourceId = "legacy-source", owner = "legacy-author" } = {}) {
  const content = JSON.stringify({ content_markdown: "One exact retained output.", items: [] }), sha = digest(content), events = [];
  const append = (type, payload, actor = "user:" + owner) => {
    const row = personal.makeEvent("creative:" + owner, events.length + 1, actor, "phase5-forward", "legacy-history", type, { project_id: projectId, document_id: documentId, ...payload });
    events.push(row); return row;
  };
  append("ProjectCreated", { name: "Independent delivery records" });
  append("DocumentCreated", { title: "Current source document", handle: "source" });
  append("BlockCreated", { block_id: sourceId, scope: "document", type: "direction", position: "a0", handle: "direction/source", properties: { text: "One current authored source.", weight: 1 } });
  const exact = { artifact_id: artifactId, artifact_revision: 0, content_sha256: sha };
  const versions = [{ block_id: sourceId, version: 1 }];
  append("DocumentRenderRequested", { ...exact, artifact_kind: "short_story", source_block_versions: versions });
  append("DocumentRenderCompleted", { ...exact, artifact_kind: "short_story", title: "Exact retained result", content_ref: "legacy-content", item_count: 1, items: [], settings: {}, summary: "A retained output.", requested_by_user_id: owner, source_block_versions: versions }, "worker:renderer");
  if (stage !== "unreviewed") {
    append("ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: "independent-reviewer" });
    append("ArtifactApproved", exact, "user:independent-reviewer");
  }
  if (stage === "exported") append("DocumentArtifactExported", { ...exact, format: "application/pdf", export_class: "independently-approved" });
  const projection = foldEvents(events, undefined, documentId, projectId);
  assert.equal(projection.libraryArtifacts.length, 1);
  return { events, projection, artifact: projection.libraryArtifacts[0], blocks: projection.blocks, exact, content, sha, documentId, projectId, owner };
}
const sharedAccess = owner => ({ actorUserId: owner, canRead: true, canAuthor: true, canReview: true, shared: true });

test("actual Output acceptance, reuse and prepared delivery do not approve or export a legacy artifact with a colliding target ID", async t => {
  const f = strictFixture(t, await personal.fixture()); t.after(() => f.sqlite.close());
  const spec = personal.imageSpec(); spec.deliverables[0].format_variants = [spec.deliverables[0].format_variants[0]];
  await f.command({ action: "save", blockId: spec.id, spec });
  const initial = (await f.command({ action: "confirm" })).snapshot.confirmedPlan, target = initial.plan.targets[0];
  const uploaded = await f.upload(personal.png({ width: 2, height: 2 }));
  const bound = await f.command({ action: "bind", planRevisionId: initial.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
  assert.equal(bound.snapshot.summary.delivery_ready, false, "binding is not acceptance");
  const reviewed = await f.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  const next = (await f.command({ action: "confirm" })).snapshot.confirmedPlan;
  assert.notEqual(next.revisionId, initial.revisionId);
  await f.command({ action: "bind", planRevisionId: next.revisionId, targetId: target.id, acceptanceId: reviewed.command.acceptanceId });
  const prepared = await f.command({ action: "export", planRevisionId: next.revisionId });
  assert.ok(prepared.command.manifestId);
  const rows = await readEvents(f.env, "creative:" + personal.owner);
  const outputReceipts = rows.filter(row => ["OutputTargetAccepted", "OutputFulfillmentSelected", "OutputDeliveryPrepared"].includes(row.type));
  assert.deepEqual(new Set(outputReceipts.map(row => row.type)), new Set(["OutputTargetAccepted", "OutputFulfillmentSelected", "OutputDeliveryPrepared"]));
  assert.equal(rows.some(row => ["ArtifactApproved", "DocumentArtifactExported"].includes(row.type)), false);
  for (const stage of ["unreviewed", "approved", "exported"]) {
    const legacy = legacyFixture({ stage, artifactId: target.id, documentId: personal.doc, projectId: personal.project, owner: personal.owner });
    const before = artifactDeliveryState(legacy.artifact, legacy.blocks, legacy.events, sharedAccess(legacy.owner), legacy.sha);
    const after = artifactDeliveryState(legacy.artifact, legacy.blocks, [...legacy.events, ...outputReceipts], sharedAccess(legacy.owner), legacy.sha);
    assert.deepEqual(after, before, "the actual Output namespace cannot change " + stage + " artifact evidence");
    assert.equal(after.deliveryStatus, "unconfirmed");
  }
  for (const table of ["document_jobs", "output_execution_grants", "output_operation_slots", "output_provider_calls"])
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 0, table);
});

test("legacy approval and export history do not fulfill a real confirmed Output target", async t => {
  const f = strictFixture(t, await personal.fixture()); t.after(() => f.sqlite.close());
  const spec = personal.imageSpec(); spec.deliverables[0].format_variants = [spec.deliverables[0].format_variants[0]];
  await f.command({ action: "save", blockId: spec.id, spec });
  const confirmed = await f.command({ action: "confirm" }), plan = confirmed.snapshot.confirmedPlan;
  const legacy = legacyFixture({ artifactId: plan.plan.targets[0].id, sourceId: "source", documentId: personal.doc, projectId: personal.project, owner: personal.owner });
  // Seed historical legacy evidence only; this fixture does not certify a real
  // person's review, file download, or delivery to a recipient.
  await personal.appendEvents(f.env, legacy.events.filter(row => ["DocumentRenderRequested", "DocumentRenderCompleted", "ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].includes(row.type)));
  const snapshot = await f.snapshot();
  assert.equal(snapshot.confirmedPlan.revisionId, plan.revisionId);
  assert.equal(snapshot.summary.fulfilled_targets, 0);
  assert.equal(snapshot.summary.delivery_ready, false);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM output_plan_fulfillments").get().count, 0);
  const delivery = artifactDeliveryState(legacy.artifact, legacy.blocks, legacy.events, sharedAccess(legacy.owner), legacy.sha);
  assert.equal(delivery.approved, true); assert.ok(delivery.exportReceipt); assert.equal(delivery.deliveryStatus, "unconfirmed");
});

// Reuse the existing Output template port for the complete actual FormaDeliver
// render and current permission/activity/artifact projections. This reduced
// evaluation host is not a connected Shell/native navigation composition.
// Its links prove exact source/handler/href bindings; ordinary arrival is gated
// by the separate full-host artifact/image destination companions and the
// existing Deliver-to-Activity continuity cases. No fake navigator is supplied.
const deliverSource = readFileSync(new URL("../src/components/forma-deliver.ts", import.meta.url), "utf8");
const deliverTree = ts.createSourceFile("forma-deliver.ts", deliverSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const deliverClass = deliverTree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaDeliver");
assert.ok(deliverClass);
const hostBindings = { FormaElement: class {}, html, nothing: null, repeat: (rows, _key, render) => [...rows].map(render), scopedFormaActivity, nextActionFacts, creativeNextActions, renderLifecycleNextActionCards, openCreativeNextActionDestination, artifactSourceVersions, artifactDeliveryFor, documentArtifactDefinition, describeOutputs, imageOutputNamingCandidate, artifactFocusRoute, libraryFocusRoute, withProjectTaskDocumentInRoute, icon: () => null };
const Deliver = new Function(...Object.keys(hostBindings), stripTypeScriptTypes(deliverClass.getText(deliverTree).replace(/^export\s+/u, "")) + "\nreturn FormaDeliver;")(...Object.values(hostBindings));
function deliverFixture(locale, stage = "exported") {
  const legacy = legacyFixture({ stage }), routes = [], state = { route: withProjectTaskDocumentInRoute("/deliver", legacy.documentId), session: {
    user: { userId: legacy.owner, role: "user" }, projectContext: { projectId: legacy.projectId, organizationId: "organization", projectAccessId: "access", role: "editor", managedPilot: true, permissions: ["project.read", "project.author", "project.output.request", "project.review.approve"] },
  } };
  const value = data => ({ get: () => data });
  const store = { route: { get: () => state.route }, session: { get: () => state.session }, projection: value(legacy.projection), eventView: value(legacy.events), events: value(legacy.events), asOf: value(undefined), content: value({ "legacy-content": legacy.content }), canvasProjection: value({ canvases: [], selectedCanvasId: null }), projectNotifications: value([]), reviewInbox: value([]), documentJobs: value([]), captureAuthorizationScope: () => state.session ? { key: "current-actor-scope" } : null, setRoute: path => routes.push(path), append: () => assert.fail("rendering cannot submit an approval"), authorizeProjectExport: () => assert.fail("rendering cannot authorize an export") };
  installSourceOwnershipPort(store);
  // This fixture has synchronously folded its declared complete local stream.
  // No Output GET was supplied: preserve the actual client's unread resource shape.
  store.routeDataReady = () => store.sourceOwnershipActive(store.captureSourceOwnership())
    && legacy.projection.documents.some(document => document.id === legacy.documentId && !document.removed);
  store.outputRequirements = { resource: () => ({ state: "loading", snapshot: null, error: null }) };
  const host = new Deliver(); host.store = store;
  const messages = ARTIFACT_DELIVERY_MESSAGES[locale], formatter = new Intl.NumberFormat(locale);
  host.i18n = { locale, timeZone: "UTC", number: number => formatter.format(number), system: text => text, t: (key, fallback, parameters = {}) => String(messages[key] ?? fallback ?? key).replace(/\{([^}]+)\}/gu, (match, name) => String(parameters[name] ?? match)) };
  return { host, state, routes, legacy, messages };
}
function markup(value) {
  if (value == null || typeof value === "function" || typeof value === "symbol") return "";
  if (Array.isArray(value)) return value.map(markup).join("");
  if (Array.isArray(value.strings)) return value.strings.reduce((result, text, index) => result + text + markup(value.values[index]), "");
  return typeof value === "object" ? "" : String(value);
}
function assertExactDeliverLinkBinding(handler, href, bindingName = "href") {
  assert.equal(typeof href, "string"); assert.ok(href.startsWith("/"));
  assert.ok(bindingName === "href" || bindingName === "activityHref", "only the two actual source bindings are recognized");
  assert.equal(handler.toString().replace(/\s+/gu, "").replace(/\(event\)=>/gu, "event=>"), `event=>this.#follow(event,${bindingName})`,
    "the actual emitted link binds its exact current href to the original follow handler");
  const source = deliverSource.replace(/\s+/gu, "");
  assert.ok(source.includes('#follow(event:MouseEvent,path:string){if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();this.#open(path);}'),
    "source retains native modifier admission and explicit default prevention before forwarding the unchanged path");
  assert.ok(source.includes('#open(path:string){if(path===this.store.route.get())returntrue;returnnavigateInApp(this,navigation=>navigation.route(path));}'),
    "ordinary routing belongs to the actual current Shell, not this reduced render host");
}
for (const locale of ["en", "fr", "ar", "ja"]) test("actual Deliver preserves scoped Output controls and exact artifact actions without a delivery claim in " + locale, () => {
  for (const stage of ["unreviewed", "approved", "exported"]) {
    const f = deliverFixture(locale, stage), rendered = f.host.render(), children = templates(rendered);
    const outputs = children.filter(value => value.strings.some(text => text.includes("<forma-output-requirements ")));
    assert.equal(outputs.length, 1);
    assert.equal(binding(outputs[0], ".documentId"), f.legacy.documentId);
    assert.equal(binding(outputs[0], ".documentName"), "Current source document");
    assert.equal(binding(outputs[0], ".surface"), "deliver");
    const card = children.find(value => value.strings.some(text => text.includes('<article class="forma-deliver-card"')));
    assert.ok(card);
    const href = binding(card, "href"), focus = artifactFocusOptionsFromRoute(href);
    assert.equal(focus.expectedRevision, 0);
    assert.equal(focus.intent, stage === "unreviewed" ? "review" : "export");
    if (stage !== "unreviewed") assert.equal(focus.expectedContentSha256, f.legacy.sha);
    const body = markup(rendered), summary = body.match(/class="forma-deliver-summary"[\s\S]*?<\/div><p>/u)?.[0];
    assert.ok(summary);
    assert.deepEqual([...summary.matchAll(/<b>(\d+)<\/b>/gu)].map(match => Number(match[1])), [1, 0, stage === "unreviewed" ? 0 : 1, stage === "exported" ? 1 : 0]);
    assert.ok(body.includes(f.messages["artifact.delivery.notDelivered"]));
    assert.ok(body.includes(f.messages["artifact.delivery.approvalCount"]));
    assert.ok(body.includes(f.messages["artifact.delivery.exportCount"]));
    assert.deepEqual(f.routes, [], "rendering is read-only");
    const open = eventHandlers(card, "click")[0];
    let prevented = 0;
    open({ defaultPrevented: false, button: 0, ctrlKey: true, preventDefault() { prevented++; } });
    assert.equal(prevented, 0); assert.deepEqual(f.routes, []);
    assertExactDeliverLinkBinding(open, href);
    assert.deepEqual(f.routes, [], "exact revision/hash/intent binding is not a completed reduced-host navigation");
  }
});
test("actual Deliver excludes Output and artifact surfaces after scope mismatch or sign-out", () => {
  for (const revoked of ["project", "session"]) {
    const f = deliverFixture("en");
    if (revoked === "project") f.state.session = { ...f.state.session, projectContext: { ...f.state.session.projectContext, projectId: "other-project" } };
    else f.state.session = null;
    const rendered = f.host.render();
    assert.equal(templates(rendered).filter(value => value.strings.some(text => text.includes("<forma-output-requirements ") || text.includes('<article class="forma-deliver-card"'))).length, 0);
    assert.deepEqual(f.routes, []);
  }
});

test("actual Deliver Activity and artifact links retain the same explicit Document context", () => {
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const f = deliverFixture(locale), rendered = f.host.render();
    const activityHref = binding(rendered, "href");
    assert.equal(activityHref, "/activity?document=" + encodeURIComponent(f.legacy.documentId));
    const card = templates(rendered).find(value => value.strings.some(text => text.includes('<article class="forma-deliver-card"')));
    const artifactHref = binding(card, "href");
    assert.deepEqual(new URL(artifactHref, "https://forma.local").searchParams.getAll("document"), [f.legacy.documentId]);
    assert.deepEqual(artifactFocusOptionsFromRoute(artifactHref), {
      expectedRevision: 0, expectedContentSha256: f.legacy.sha, intent: "export",
    });
    assert.deepEqual(f.routes, [], "constructing scoped hrefs cannot navigate or submit");
    const followActivity = eventHandlers(rendered, "click")[0];
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"])
      followActivity({ defaultPrevented: false, button: 0, [modifier]: true, preventDefault() { assert.fail("modified navigation must use the real href"); } });
    assert.deepEqual(f.routes, []);
    assertExactDeliverLinkBinding(followActivity, activityHref, "activityHref");
    assert.deepEqual(f.routes, [], "the explicit current Document route remains binding evidence here, not a fake Shell handoff");
    assert.equal(f.state.session.projectContext.projectId, f.legacy.projectId);
  }
});
