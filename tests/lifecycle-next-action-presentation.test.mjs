import assert from "node:assert/strict";
import test from "node:test";
import { nothing } from "lit";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
import { outcomeDeskHostActions, outcomeDeskHostActionAvailable } from "../src/canvas/outcome-desk-host.ts";
import { FORMA_NEXT_ACTION_MESSAGES } from "../src/components/design-system/locales/next-action-messages.ts";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";

// Pure current-fact DTOs and complete shared renderers/native choice-card handlers.
// No consumer opt-in, Store/Worker authority, private bytes, geometry or AT proof.
const { renderNextActionCards } = await ports.loadActual("src/components/next-action-cards.ts");
const { renderOutcomeDesk } = await ports.loadActual("src/components/outcome-desk.ts");
const { FormaUiChoiceCard } = await ports.loadActual("src/components/design-system/choice-card.ts");
const { FormaUiDisclosure } = await ports.loadActual("src/components/design-system/feedback.ts");
const locales = ["en", "fr", "ar", "ja"];
const lifecycleIds = ["inspect-source", "recover-job", "check-original-job", "assigned-review",
  "artifact-delivery", "canonical-output", "inspect-output-requirement"];
const legacyKinds = { "add-context": "context", "configure-output": "configure", "open-output": "output",
  "read-draft": "output", "compare-images": "compare", "check-job": "job", "inspect-job": "job" };
const title = "Même titre · الاسم نفسه · 同じ題名";
const scope = { projectId: "project-exact", documentId: "document-exact", canvasId: null, authorityKey: "current-scope", sourceGeneration: 7 };
const block = (id = "direction", type = "direction") => ({ id, projectId: scope.projectId, documentId: scope.documentId,
  canvasId: "", type, removed: false, scope: "document", handle: title, position: "a",
  properties: { text: "Current direction", label: title, weight: 1 }, sourceEvents: ["source-event"] });
const artifact = () => ({ id: "artifact-exact", documentId: scope.documentId, title, kind: "slides",
  sequence: 4, sourceEventId: "artifact-event", contentRef: "opaque-content-ref", provider: "fixture" });
const job = (result = null, extra = {}) => ({ jobId: "job-exact", documentId: scope.documentId, canvasId: null,
  kind: "render_document", sourceSurface: "document", status: "failed", requestedAt: "2026-08-27T00:00:00Z",
  dismissedAt: null, members: [], result, error: null, errorDetail: null, ...extra });
const review = () => ({ reviewId: "review-exact", organizationId: "organization-exact", projectAccessId: "access-exact",
  artifactId: "assigned-artifact", revision: 0, contentSha256: "a".repeat(64), title, createdAt: "2026-08-27T00:00:00Z" });
const canonical = () => ({ reference: { kind: "target", id: "target-exact", targetId: "target-exact",
  authorizationScopeKey: scope.authorityKey, projectId: scope.projectId, documentId: scope.documentId,
  actorUserId: "actor-exact", projectAccessId: null, revision: "read-revision", sourceRevision: "source-revision",
  requirementRevision: "requirement-revision", blockId: "requirement-exact", planRevisionId: "plan-exact",
  targetContractDigest: "target-digest", resultId: null, resultRevision: null, assetId: null, assetSha256: null,
  grantId: null, operationId: null, jobId: null },
  section: "inspect", refresh: false, urgency: "owed", title,
  labelKey: "output.delivery.actionCheck", label: "Check retained work and current requirements",
  reasonKey: "output.delivery.wholeScope", reason: "Whole confirmed scope" });
const facts = (extra = {}, lifecycle = {}) => ({ ...scope, canRead: true, canAuthor: true, canConfigure: true,
  blocks: [block()], outputs: [], artifacts: [], jobs: [], events: [],
  ...extra, lifecycle: { sourceBlockIds: [], reviews: [], deliveries: [],
    output: { state: "ready", scopeKnown: true, requirementBlockIds: [], choices: [] }, ...lifecycle } });
const input = state => ({ facts: state, document: { id: state.documentId, projectId: state.projectId, title, removed: false } });
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function lifecycleState(id) {
  if (id === "inspect-source") return facts({}, { sourceBlockIds: ["direction"] });
  if (id === "recover-job") return facts({ jobs: [job({ artifactKind: "slides", recoverablePresentationCandidate: true })] });
  if (id === "check-original-job") return facts({ jobs: [job({ generationReceipt: { provider_request_status: "submission_unknown" } })] });
  if (id === "assigned-review") return facts({}, { reviews: [review()] });
  if (id === "artifact-delivery") {
    const item = artifact();
    return facts({ artifacts: [item] }, { deliveries: [{ artifactId: item.id, sequence: item.sequence, revision: 0,
      sourceEventId: item.sourceEventId, contentRef: item.contentRef, action: "changes", intent: "review",
      proof: "presentation-only-fact", title, reviewStatus: "changes-requested" }] });
  }
  if (id === "canonical-output") return facts({}, { output: { state: "ready", scopeKnown: true, requirementBlockIds: [], choices: [canonical()] } });
  return facts({ blocks: [block(), block("requirement-exact", "output")] }, { output: {
    state: "unavailable", scopeKnown: null, requirementBlockIds: ["requirement-exact"], choices: [] } });
}
function renderer(t, locale) {
  const f = { locale, trace: [], clipboard: [], listeners: new Map(), changed: new Map(), requested: false,
    resizeTargets: new Map(), frames: new Map(), timers: new Map(), timerSequence: 0, storage: new Map() };
  ports.bindFixture(f);
  const messages = { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] };
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr",
      timeZone: "UTC", messages, revision: 1 }, () => {}); return true;
  } });
  f.i18n.hostConnected();
  f.host = new ports.ElementPort(); f.host.tag = "presentation-contract"; f.host.attributes = {};
  f.renderer = new ports.RendererPort(f, { "forma-ui-choice-card": FormaUiChoiceCard, "forma-ui-disclosure": FormaUiDisclosure });
  f.draw = render => { ports.bindFixture(f); f.renderer.draw(f.host, render); return fullPageTree(f); };
  t.after(() => { ports.bindFixture(f); for (const { instance } of f.renderer.instances.values()) {
    if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
  } f.i18n.hostDisconnected(); });
  return f;
}
const within = (node, ancestor) => { for (let at = node.parent; at; at = at.parent) if (at === ancestor) return true; return false; };
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
function cards(tree) {
  return tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && Object.hasOwn(node.attributes, "data-primary")).map(node => {
    const button = tree.visible("button").find(button => within(button, node)); assert.ok(button?.port);
    const strong = tree.visible("strong").find(strong => within(strong, button)), small = tree.visible("small").find(small => within(small, button));
    assert.ok(strong && small);
    assert.equal(Object.hasOwn(button.attributes, "aria-label"), false, "native name continues to use the complete visible copy");
    return { node, button, label: strong.text, reason: small.text };
  });
}
function deskPorts(f, current, open = () => assert.fail("rendering cannot open an executor")) {
  const host = { localize: (id, fallback) => f.i18n.t(id, fallback),
    delivery: () => assert.fail("these document/job cases do not call the saved-artifact delivery port") };
  return { host, render: { available: action => outcomeDeskHostActionAvailable(action, current, host), open,
    navigate: () => assert.fail("rendering cannot navigate"), dismiss: () => assert.fail("rendering cannot dismiss"),
    restoreSuggestions: () => assert.fail("rendering cannot restore"),
    title: row => row.object.value.title ?? row.object.value.jobId,
    accessibleName: row => (row.object.value.title ?? row.object.value.jobId) + " · " + row.reference.kind + " · " + row.reference.id,
    renderObject: () => nothing, renderOtherWays: () => nothing } };
}

test("lifecycle fallback catalog uses one existing owner and complete equal four-locale keys", () => {
  const keys = Object.keys(FORMA_NEXT_ACTION_MESSAGES.en);
  for (const locale of locales) {
    assert.deepEqual(Object.keys(FORMA_NEXT_ACTION_MESSAGES[locale]), keys);
    for (const id of lifecycleIds) for (const suffix of ["label", "reason"]) {
      const key = "next.exact." + id + "." + suffix, value = FORMA_NEXT_ACTION_MESSAGES[locale][key];
      assert.ok(typeof value === "string" && value.length > 0); assert.notEqual(value, key);
      if (locale !== "en") assert.notEqual(value, FORMA_NEXT_ACTION_MESSAGES.en[key], "no English fallback is presented as a locale translation");
    }
  }
});

for (const locale of locales) {
  test("lifecycle card copy " + locale + " preserves every existing no-override label, title and reason", t => {
    const f = renderer(t, locale);
    for (const [id, kind] of Object.entries(legacyKinds)) {
      const action = freeze({ id, label: "Unused literal", reason: "Unused reason", title: kind === "configure" ? "slides" : title,
        priority: 1, evidence: 1, target: { ...scope, kind } });
      const [card] = cards(f.draw(() => renderNextActionCards([action], f.i18n, () => assert.fail("render only"))));
      const name = kind === "job" ? "" : kind === "configure" ? f.i18n.t("artifact.slides.label", "slides") : title;
      assert.equal(card.label, f.i18n.t("next.exact." + id + ".label") + (name ? ": " + name : ""));
      assert.equal(card.reason, f.i18n.t("next.exact." + id + ".reason"));
      assert.equal(card.node.attributes["data-primary"], "true"); assert.equal(card.button.attributes["data-choice-value"], id);
    }
  });

  test("lifecycle card copy " + locale + " localizes all new fallbacks without changing exact native action identity", t => {
    const f = renderer(t, locale);
    for (const id of lifecycleIds) {
      const state = freeze(lifecycleState(id)), actual = creativeNextActions(state)[0]; assert.equal(actual.id, id);
      // Explicitly exercise the additive generic fallback contract; actual
      // specific keys remain covered separately and are not removed in a consumer.
      const action = freeze({ ...actual, labelKey: undefined, reasonKey: undefined }), selected = [];
      const [card] = cards(f.draw(() => renderNextActionCards([action], f.i18n, value => selected.push(value))));
      const expected = f.i18n.t("next.exact." + id + ".label");
      assert.equal(card.label, expected + (action.target.kind === "job" ? "" : ": " + action.title));
      assert.equal(card.reason, f.i18n.t("next.exact." + id + ".reason"));
      assert.deepEqual(selected, []);
      card.button.handlers.click.call(card.button.owner, { currentTarget: card.button.port, target: card.button.port });
      assert.equal(selected.length, 1); assert.equal(selected[0], action); assert.equal(selected[0].target, actual.target);
    }
  });

  test("lifecycle card and Desk " + locale + " honor existing Output and delivery keys independently", t => {
    const f = renderer(t, locale);
    for (const id of ["assigned-review", "artifact-delivery", "canonical-output"]) {
      const state = freeze(lifecycleState(id)), before = structuredClone(state), action = creativeNextActions(state)[0];
      const current = input(state), p = deskPorts(f, current), wrapped = outcomeDeskHostActions(current, "document:" + state.documentId, p.host)[0];
      assert.equal(wrapped.target.action.id, id);
      const label = f.i18n.t(action.labelKey ?? "next.exact." + id + ".label", action.label);
      const reason = f.i18n.t(action.reasonKey ?? "next.exact." + id + ".reason", action.reason);
      const [card] = cards(f.draw(() => renderNextActionCards([action], f.i18n, () => assert.fail("render only"))));
      assert.equal(card.label, label + ": " + action.title); assert.equal(card.reason, reason);
      assert.equal(wrapped.label, label + ": " + action.title); assert.equal(wrapped.detail, reason);
      assert.deepEqual(wrapped.target.action, action); assert.deepEqual(state, before);
    }
    const base = creativeNextActions(lifecycleState("inspect-source"))[0];
    for (const partial of [{ labelKey: "output.delivery.actionCheck" }, { reasonKey: "output.delivery.wholeScope" }]) {
      const action = { ...base, ...partial };
      const [card] = cards(f.draw(() => renderNextActionCards([action], f.i18n, () => assert.fail("render only"))));
      assert.equal(card.label, f.i18n.t(action.labelKey ?? "next.exact.inspect-source.label", action.label) + ": " + action.title);
      assert.equal(card.reason, f.i18n.t(action.reasonKey ?? "next.exact.inspect-source.reason", action.reason));
    }
    const unknown = { ...base, labelKey: "not.registered.label", reasonKey: "not.registered.reason",
      label: "Exact literal label", reason: "Exact literal reason" };
    const [fallback] = cards(f.draw(() => renderNextActionCards([unknown], f.i18n, () => assert.fail("render only"))));
    assert.equal(fallback.label, "Exact literal label: " + unknown.title); assert.equal(fallback.reason, "Exact literal reason");
  });

  test("lifecycle presentation " + locale + " keeps shared priority, one primary, two alternatives and exact Desk scope", t => {
    const f = renderer(t, locale);
    const state = freeze(facts({ canvasId: "board-exact", jobs: [job({ artifactKind: "slides", recoverablePresentationCandidate: true },
      { canvasId: "board-exact", sourceSurface: "canvas" })] }, { sourceBlockIds: ["direction"], reviews: [review()],
      output: { state: "ready", scopeKnown: true, requirementBlockIds: [], choices: [canonical()] } }));
    const before = structuredClone(state), actions = creativeNextActions(state);
    assert.deepEqual(actions.map(action => action.id), ["inspect-source", "recover-job", "assigned-review"]);
    const direct = cards(f.draw(() => renderNextActionCards(actions, f.i18n, () => assert.fail("render only"))));
    assert.equal(direct.length, 3); assert.deepEqual(direct.map(row => row.node.attributes["data-primary"]), ["true", "false", "false"]);
    const current = input(state), p = deskPorts(f, current), candidates = outcomeDeskHostActions(current, "document:" + state.documentId, p.host);
    assert.deepEqual(candidates.map(row => row.target.action.id), actions.map(row => row.id));
    const tree = f.draw(() => renderOutcomeDesk({ instanceId: "copy-contract", canvasReturnFocusId: "canvas-heading", locale,
      route: "/canvas/board-exact/board?posture=outcomes", current, selectedKey: "document:" + state.documentId,
      recipeId: null, candidates, dismissedKeys: [] }, p.render));
    const shown = cards(tree); assert.equal(shown.length, 3);
    assert.deepEqual(shown.map(row => row.node.attributes["data-primary"]), ["true", "false", "false"]);
    assert.deepEqual(shown.map(row => row.label), candidates.map(row => row.label));
    assert.deepEqual(shown.map(row => row.reason), candidates.map(row => row.detail));
    const section = tree.visible("section").find(node => classed(node, "outcome-desk"));
    assert.equal(section.attributes.lang, locale); assert.equal(section.attributes.dir, locale === "ar" ? "rtl" : "ltr");
    const heading = tree.visible("h3").find(node => node.attributes.id === "copy-contract-selected");
    assert.equal(heading.children.filter(node => typeof node !== "string" && node.tag === "bdi").length, 1);
    assert.equal(heading.text, title); assert.deepEqual(state, before);
  });

  test("lifecycle presentation " + locale + " preserves duplicate exact Desk names and native bidi wrappers", t => {
    const f = renderer(t, locale), ids = ["01990298-0123-7000-8000-00000000000a", "01990298-0123-7000-8000-00000000000b"];
    const state = freeze(facts({ canvasId: "board-exact", outputs: ids.map((id, index) => ({ id, documentId: scope.documentId,
      canvasId: "board-exact", title, sequence: index + 1, quality: "high", purpose: "final", discarded: false,
      promptFanId: null, provider: "fixture", mediaUrl: "/api/media/" + id })) }));
    const current = input(state), p = deskPorts(f, current), candidates = outcomeDeskHostActions(current, "document:" + state.documentId, p.host);
    const tree = f.draw(() => renderOutcomeDesk({ instanceId: "duplicate-copy", canvasReturnFocusId: "canvas-heading", locale,
      route: "/canvas/board-exact/board?posture=outcomes", current, selectedKey: "document:" + state.documentId,
      recipeId: null, candidates, dismissedKeys: [] }, p.render));
    const navigation = tree.visible("ul").find(node => classed(node, "outcome-desk-objects"));
    const links = tree.visible("a").filter(node => within(node, navigation));
    assert.equal(links.length, 3); assert.equal(new Set(links.map(node => node.attributes.href)).size, 3);
    assert.equal(new Set(links.map(node => node.attributes["aria-label"])).size, 3);
    for (const link of links) {
      const key = new URL(link.attributes.href, "https://fixture.invalid").searchParams.get("outcome");
      const id = key.slice(key.indexOf(":") + 1);
      assert.ok(link.text.includes(title)); assert.ok(link.text.includes(id), "complete identities survive a shared UUID prefix");
      assert.equal(link.text, link.attributes["aria-label"]);
      assert.equal(link.children.filter(node => typeof node !== "string" && node.tag === "bdi").length, 1);
    }
    const heading = tree.visible("h3").find(node => node.attributes.id === "duplicate-copy-selected");
    assert.equal(heading.text, links.find(node => node.attributes["aria-current"] === "true").attributes["aria-label"]);
  });

  test("lifecycle presentation " + locale + " preserves Creator Workspace suffix and terminal Desk request copy", t => {
    const f = renderer(t, locale), state = facts();
    for (const kind of ["context", "configure", "compare"]) {
      const id = { context: "add-context", configure: "configure-output", compare: "compare-images" }[kind];
      const action = { id, label: "Unused", reason: "Unused", title: kind === "configure" ? "slides" : "", target: { ...scope, kind } };
      const [card] = cards(f.draw(() => renderNextActionCards([action], f.i18n, () => assert.fail("render only"), { creatorHandoff: true })));
      assert.ok(card.label.endsWith(" · " + f.i18n.t("next.exact.creatorWorkspace")));
    }
    for (const status of ["completed", "canceled"]) {
      const current = input({ ...state, lifecycle: undefined, jobs: [job(null, { status })] }), p = deskPorts(f, current);
      const [wrapped] = outcomeDeskHostActions(current, "job:job-exact", p.host);
      assert.equal(wrapped.label, f.i18n.t("next.exact.inspect-terminal-job.label"));
      assert.equal(wrapped.detail, f.i18n.t("next.exact.inspect-terminal-job.reason"));
      assert.equal(wrapped.target.action.target.jobId, "job-exact");
    }
    assert.equal(renderNextActionCards([], f.i18n, () => assert.fail("no action")), nothing);
  });
}
