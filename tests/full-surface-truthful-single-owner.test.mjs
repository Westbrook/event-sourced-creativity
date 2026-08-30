import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents, generationHistoryItems } from "../src/model/events.ts";
import { buildWorkspaceQuickEditPlan } from "../src/model/workspace-local-proposal.ts";
import { createCalmFullPage, calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";

// Actual production components, templates, handlers, Store and existing routed
// RAM Worker fixture. Native ports do not certify Lit/browser layout or AT.
// No generation/Apply action is invoked. Existing tests and fixtures are unchanged.
const locales = ["en", "fr", "ar", "ja"];
const expectedCopy = {
  "en": {
    "summary": "{blocks} decisions and {relations} relationships will be saved.",
    "lab": "{creator} and {canvas} share project work. Other applications expose only evidence authorized for their audience."
  },
  "fr": {
    "summary": "{blocks} décisions et {relations} relations seront enregistrées.",
    "lab": "{creator} et {canvas} partagent le travail du projet. Les autres applications ne présentent que les éléments de preuve autorisés pour leur public."
  },
  "ar": {
    "summary": "سيتم حفظ {blocks} قرارات و{relations} علاقات.",
    "lab": "يتشارك {creator} و{canvas} عمل المشروع. وتعرض التطبيقات الأخرى فقط الأدلة المصرح بها لفئتها من المستخدمين."
  },
  "ja": {
    "summary": "決定{blocks}件と関係{relations}件を保存します。",
    "lab": "{creator}と{canvas}はプロジェクトの作業を共有します。他のアプリケーションには、各利用者層に許可された根拠だけが表示されます。"
  }
};
const hasClass = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const within = (node, predicate) => {
  for (let parent = node?.parent; parent; parent = parent.parent) if (predicate(parent)) return true;
  return false;
};
const childrenOf = (f, root, tag) => f.tree().nodes.filter(node => node.tag === tag && within(node, parent =>
  parent.tag === root.tag && parent.attributes.id === root.attributes.id && parent.owner === root.owner));
const escapeText = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function selectPane(f, workspace, pane) {
  const button = f.find("button", node => node.owner === workspace && node.attributes["data-workbench-pane"] === pane);
  assert.equal(button.attributes["aria-controls"], pane === "write" ? "document-context-panel" : "document-results-panel");
  if (pane === "result") assert.equal(button.text, f.i18n.t("workbench.creativeResults"));
  await f.act(button);
}

async function openImageOptions(f, generation) {
  const entry = f.find("button", node => node.owner === generation && hasClass(node, "generation-details-trigger"));
  assert.equal(entry.attributes["aria-haspopup"], "dialog");
  await f.act(entry);
  const dialog = f.tree().visible("dialog").find(node => node.owner === generation && hasClass(node, "generation-details-dialog"));
  assert.ok(dialog, "actual Image options dialog opens from its visible current control");
  const guidance = f.i18n.t("generation.choicesHelp");
  assert.ok(guidance && guidance !== "generation.choicesHelp", "integrated media-copy prerequisite");
  assert.ok(dialog.text.includes(guidance), "the shared Image options guide describes the choices without assuming a host location");
  const choice = f.find("input", node => node.owner === generation &&
    within(node, parent => hasClass(parent, "generation-production-mode")));
  assert.equal(choice.attributes.type, "checkbox");
  assert.equal(f.tree().visible("button").filter(node => node.owner === generation && hasClass(node, "generation-fan-button")).length, 2,
    "draft and full-quality fan choices remain available");
  assert.ok(f.components().some(component => component.tag === "forma-image-format-editor" && component.parentElement === generation),
    "the real image frame editor remains available");
  return choice;
}

async function closeImageOptions(f, generation) {
  await f.act(f.find("button", node => node.owner === generation && hasClass(node, "modal-close")));
  assert.equal(f.tree().visible("dialog").filter(node => node.owner === generation && hasClass(node, "generation-details-dialog")).length, 0);
}

for (const locale of locales) test("one Document generation owner survives panes and assistant posture with direct access " + locale, async t => {
  const f = await createCalmFullPage(t, { locale, assistant: false });
  const workspace = f.components().find(component => component.tag === "forma-workspace");
  assert.ok(workspace?.isConnected, "actual mounted Document prerequisite");
  assert.equal(f.store.session.get().policy.accepted, true);
  const generationOwners = () => f.components().filter(component => component.tag === "forma-generation-actions" && component.parentElement === workspace);
  assert.equal(generationOwners().length, 1, "one owner, not a second instance in the fallback composer");
  const generation = generationOwners()[0];
  // Native ResizeObserver dimensions only; not a CSS/viewport measurement.
  let studioWidth = 718;
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length;
    collect(markup, owner);
    for (const node of f.renderer.nodes.slice(start)) if (node.owner === workspace && hasClass(node, "studio-main")) {
      node.getBoundingClientRect = () => ({ left: 0, top: 0, right: studioWidth, bottom: 882, width: studioWidth, height: 882 });
    }
  };

  // Synthetic saved draft history exercises the actual fold/selection/render.
  // This does not claim that a provider ran, a review was approved or a file delivered.
  f.appendEvent("IdeationPreviewCompleted", {
    object_id: "single-owner-draft", generation_id: "single-owner-generation", title: "Unapproved draft café العربية 日本語",
    provider: "fixture", media_url: "data:image/png;base64,AA==", media_type: "image/png", image_width: 1, image_height: 1,
  });
  f.store.patchUi({ selectedOutputId: "single-owner-draft" });
  await f.settle();
  assert.equal(generation.selected?.id, "single-owner-draft");
  assert.equal(generation.selected?.quality, "low");
  const draft = "  Keep my Ask / Quick edit draft café العربية 日本語.\n";
  const prompt = f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
  prompt.port.value = draft;
  await f.act(prompt, "input");
  const sourceBefore = JSON.stringify(f.store.events.get());
  const requestsBefore = f.storeHost.requests.length;

  await selectPane(f, workspace, "result");
  let choice = await openImageOptions(f, generation);
  assert.equal(choice.properties.checked, false);
  choice.port.checked = true;
  await f.act(choice, "change");
  await closeImageOptions(f, generation);

  for (const assistant of [true, false]) {
    const session = f.store.session.get();
    f.store.session.set({ ...session, assistant: assistant
      ? { enabled: true, phase: "read-only", capabilities: ["project.assistant.read"] }
      : undefined });
    await f.settle();
    assert.equal(f.components().find(component => component.tag === "forma-workspace"), workspace,
      "posture does not replace the owning Document");
    assert.deepEqual(generationOwners(), [generation], "same connected generation instance retains local options");
    assert.equal(generation.selected?.id, "single-owner-draft");

    for (const pane of ["review", "write", "result"]) {
      await selectPane(f, workspace, pane);
      assert.deepEqual(generationOwners(), [generation]);
      const renderedOwner = f.tree().nodes.find(node => node.component === generation);
      assert.ok(renderedOwner);
      assert.equal(Boolean(renderedOwner.hiddenBy), pane === "write", "narrow fixture hides rather than unmounts Results");
      assert.ok(!within(renderedOwner, parent => hasClass(parent, "composer-dock")));
    }

    // A hidden owner has a labelled two-activation route, not a new menu.
    await selectPane(f, workspace, "write");
    assert.equal(f.tree().visible("button").filter(node => node.owner === generation && hasClass(node, "generation-details-trigger")).length, 0);
    studioWidth = 1184;
    await f.settle();
    assert.deepEqual(generationOwners(), [generation], "the wide posture keeps the same owner");
    assert.equal(f.tree().nodes.find(node => node.component === generation).hiddenBy, null,
      "wide Results stay visible even when the remembered pane is Write");
    studioWidth = 718;
    await f.settle();
    assert.ok(f.tree().nodes.find(node => node.component === generation).hiddenBy,
      "returning narrow restores Write without replacing the hidden owner");
    await selectPane(f, workspace, "result"); // first activation
    choice = await openImageOptions(f, generation); // second activation
    assert.equal(choice.properties.checked, true, "managed mode survives every posture and pane change");
    await closeImageOptions(f, generation);

    if (!assistant) {
      const currentPrompt = f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
      assert.equal(currentPrompt.properties.value, draft, "Ask/Quick edit draft is neither cleared nor resubmitted");
      const composer = f.find("form", node => node.owner === workspace && hasClass(node, "composer-command"));
      assert.equal(typeof composer.handlers.submit, "function", "existing Ask form remains native and functional");
      const ask = f.find("button", node => node.owner === workspace && hasClass(node, "ask"));
      assert.equal(ask.attributes.type, "submit");
      const quickEdit = f.find("button", node => node.owner === workspace && node.attributes.title === f.i18n.t("assistant.mode.quickEditDetail"));
      assert.equal(typeof quickEdit.handlers.click, "function", "existing Quick edit handler remains available");
    }
  }

  await f.act(f.find("button", node => node.owner === workspace && hasClass(node, "document-inspector-toggle")));
  const overview = f.tree().visible("aside").find(node => node.owner === workspace && node.attributes.id === "document-workbench-inspector");
  assert.ok(overview);
  const headings = childrenOf(f, overview, "h3");
  assert.ok(headings.some(node => node.text === f.i18n.t("workbench.creativeResults")));
  assert.ok(headings.every(node => node.text !== f.i18n.t("workbench.deliveryReady")), "inventory does not claim readiness");
  const section = headings.find(node => node.text === f.i18n.t("workbench.creativeResults")).parent;
  const count = section.children.find(node => typeof node !== "string" && node.tag === "strong");
  const projection = f.store.projection.get();
  assert.equal(count.text, f.i18n.number(generationHistoryItems(projection.outputs).length + projection.artifacts.length));
  assert.equal(JSON.stringify(f.store.events.get()), sourceBefore, "posture, options and overview do not author changes");
  assert.deepEqual(f.storeHost.requests.slice(requestsBefore).filter(request =>
    !["GET", "HEAD"].includes(String(request.init.method ?? "GET").toUpperCase()) &&
    !(request.url === "/api/generation-readiness" && request.init.method === "POST")), [],
  "only existing free readiness checks may POST; no generation, approval, request replay or authored write occurs");
});

function templateFixture(locale) {
  const f = { locale, trace: [], clipboard: [], requested: false, changed: new Map(), listeners: new Map(),
    timers: new Map(), frames: new Map(), resizeTargets: new Map(), storage: new Map(), timerSequence: 0,
    tick: async () => true };
  ports.bindFixture(f);
  const messages = { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] };
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC",
      messages, revision: 1 }, () => {});
    return true;
  } });
  f.i18n.hostConnected();
  f.renderer = new ports.RendererPort(f, {});
  f.host = new ports.ElementPort();
  return f;
}

function actualPreview(kind) {
  const events = [
    ["ProjectCreated", { project_id: "preview-project", name: "Preview project" }],
    ["DocumentCreated", { project_id: "preview-project", document_id: "preview-document", title: "Existing document" }],
    ["BlockCreated", { project_id: "preview-project", document_id: "preview-document", block_id: "existing-palette",
      scope: "document", type: "palette", handle: "palette/existing", properties: { label: "Café العربية 日本語", temperature: "neutral" } }],
  ].map(([type, payload], index) => ({ eventId: "preview-event-" + index, sequence: index + 1, streamId: "creative:fixture",
    occurredAt: "2026-08-29T00:00:00.000Z", recordedAt: "2026-08-29T00:00:00.000Z", actor: "user:fixture",
    clientId: "fixture", correlationId: "truthful-preview", type, payload }));
  const projection = foldEvents(events, Infinity, "preview-document", "preview-project");
  const plan = buildWorkspaceQuickEditPlan({ projection, sourceHead: events.length, createId: () => "new-decision",
    intent: { operationId: "truthful-preview-operation", prompt: kind === "edit" ? "make warmer" : "Keep exact café العربية 日本語.",
      targetBlockId: kind === "edit" ? "existing-palette" : null } });
  assert.equal(plan.changes[0].kind, kind);
  assert.equal(plan.events[1].type, kind === "edit" ? "BlockPropertyEdited" : "BlockCreated");
  return { previewId: "preview-exact", approvalHash: "a".repeat(64), sourceHash: "b".repeat(64),
    projectId: projection.projectId, documentId: projection.documentId, canvasId: null, blockId: "",
    events: plan.events, changes: plan.changes, localReview: plan.review, blockCount: plan.blockIds.length,
    relationCount: 0, expiresAt: "2026-08-30T00:00:00.000Z" };
}

for (const locale of locales) for (const kind of ["create", "edit"]) test("actual authoring preview describes affected decisions, not only additions " + locale + " " + kind, async t => {
  const f = templateFixture(locale);
  t.after(() => f.i18n.hostDisconnected());
  const { renderAuthoringPreview } = await ports.loadActual("src/components/authoring-preview.ts");
  const preview = actualPreview(kind), before = JSON.stringify(preview);
  for (const status of ["review", "applying", "applied"]) {
    f.renderer.draw(f.host, () => renderAuthoringPreview(preview, f.i18n, { id: "truthful-preview", status }));
    const tree = fullPageTree(f), statusRows = tree.nodes.filter(node => node.tag === "p" && node.attributes.role === "status");
    assert.equal(statusRows.length, 1);
    const expected = status === "review"
      ? expectedCopy[locale].summary.replace("{blocks}", f.i18n.number(1)).replace("{relations}", f.i18n.number(0))
      : f.i18n.t("context.changes." + status, "", { blocks: f.i18n.number(1), relations: f.i18n.number(0) });
    assert.equal(statusRows[0].text, expected);
    assert.ok(tree.root.text.includes(f.i18n.t("context.changes." + kind)));
    assert.ok(tree.root.text.includes(preview.changes[0].text));
    assert.ok(f.renderer.markup.includes(escapeText(JSON.stringify(preview.events, null, 2))));
    assert.ok(tree.root.text.includes(preview.sourceHash) && tree.root.text.includes(preview.expiresAt));
    assert.equal(tree.nodes.filter(node => ["button", "input", "select", "textarea", "form"].includes(node.tag)).length, 0,
      "the common preview is still a display, not a new approval interface");
  }
  f.renderer.draw(f.host, () => renderAuthoringPreview(preview, f.i18n, {
    id: "truthful-preview", status: "review", summary: "EXACT CALLER STATUS", readOnly: true,
  }));
  assert.equal(fullPageTree(f).nodes.find(node => node.tag === "p" && node.attributes.role === "status").text, "EXACT CALLER STATUS");
  assert.ok(!fullPageTree(f).root.text.includes(f.i18n.t("context.changes.atomic")), "existing reader/caller overrides survive");
  assert.equal(JSON.stringify(preview), before);
});

for (const locale of locales) test("actual Design lab template distinguishes shared project work from audience-scoped evidence " + locale, async t => {
  const f = templateFixture(locale);
  t.after(() => f.i18n.hostDisconnected());
  const { FormaDesignSystemLab } = await ports.loadActual("src/components/forma-design-system-lab.ts");
  f.host = new FormaDesignSystemLab();
  // Render the real Lab template and its own current controls. Nested example
  // primitives are not expanded here; no user/project Store is supplied.
  const expected = expectedCopy[locale].lab.replace("{creator}", f.i18n.t("shell.creative")).replace("{canvas}", f.i18n.t("shell.canvas"));
  for (const [index, application] of ["creative", "canvas", "operations", "product", "knowledge", "engineering"].entries()) {
    f.renderer.draw(f.host);
    const switches = f.renderer.ownNodes(f.host, "button").filter(node => Object.hasOwn(node.attributes, "aria-pressed"));
    assert.equal(switches.length, 12, "the existing template and architecture selectors remain");
    const current = switches[index];
    assert.equal(typeof current.handlers.click, "function");
    await current.handlers.click.call(f.host, { target: current, currentTarget: current, preventDefault() {}, stopPropagation() {} });
    f.renderer.draw(f.host);
    assert.ok(f.renderer.markup.includes(escapeText(expected)));
    assert.ok(f.renderer.markup.includes(escapeText(f.i18n.t("lab.syntheticNotice"))), "fictional preview boundary remains explicit");
    assert.ok(f.renderer.markup.includes(escapeText(f.i18n.t("lab." + application + "Heading"))));
    const selected = f.renderer.ownNodes(f.host, "button").filter(node => Object.hasOwn(node.attributes, "aria-pressed"));
    assert.equal(selected[index].attributes["aria-pressed"], "true");
    assert.equal(selected[6 + index].attributes["aria-pressed"], "true");
    assert.equal(f.host.store, undefined, "audience examples do not load customer work");
  }
});
