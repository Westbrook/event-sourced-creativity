import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewHost, nodes, disabled, primary, panel, panelOpen, reviewControl,
  text, settle, click, openGallery, currentArtifact, currentHash, currentDelivery,
} from "./helpers/artifact-review-host.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { untilScene } from "./helpers/scene-cost-store-host.mjs";

// Complete current DocumentArtifacts, Popover, LocaleController, Store and
// routed RAM Worker. Native tree/focus ports do not certify a physical browser.
const locales = ["en", "fr", "ar", "ja"];
const hasClass = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const finance = worker => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"]
  .map(table => [table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
function tree(f) {
  // The existing single-host renderer also emits parent-owned native nodes for
  // its whole actual template. Recover their literal DOM ancestry only, so a
  // selector within the review panel cannot resolve a different workflow field.
  const own = f.renderer.nodes.filter(node => node.owner === f.host), root = { tag: "#root", children: [], parent: null };
  const stack = [root], rows = []; let offset = 0;
  for (const match of f.renderer.markup.matchAll(/<!--[\s\S]*?-->|<\/?[\w-]+\b[^>]*>/gu)) {
    const token = match[0]; if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) {
      const tag = token.slice(2).split(/[\s>]/u)[0], index = stack.findLastIndex(row => row.tag === tag);
      assert.ok(index > 0, "balanced actual native ancestry " + tag); stack.length = index; continue;
    }
    const port = own[offset++]; assert.equal(port?.full, token, "only the exact current emitted native node");
    const parent = stack.at(-1), attributes = port.attributes;
    let hiddenBy = parent.hiddenBy ?? null;
    if (!hiddenBy && Object.hasOwn(attributes, "hidden")) hiddenBy = "hidden";
    if (!hiddenBy && port.tag === "dialog" && !port.open) hiddenBy = "closed dialog";
    if (!hiddenBy && Object.hasOwn(attributes, "popover") && !f.renderer.openPopovers.has(attributes.id)) hiddenBy = "closed popover";
    if (!hiddenBy && parent.tag === "details" && !parent.port.open && port.tag !== "summary") hiddenBy = "closed details";
    const row = { tag: port.tag, port, owner: f.host, attributes, parent, hiddenBy, children: [] };
    parent.children.push(row); rows.push(row);
    if (!voids.has(port.tag) && !token.endsWith("/>")) stack.push(row);
  }
  assert.equal(offset, own.length); assert.equal(stack.length, 1);
  return { nodes: rows, visible: tag => rows.filter(row => row.tag === tag && !row.hiddenBy) };
}
const within = (row, predicate) => {
  for (let current = row?.parent; current; current = current.parent) if (predicate(current)) return true;
  return false;
};
function menuState(f) {
  const values = f.renderer.query(f.host, "forma-ui-popover").filter(value => hasClass(value, "artifact-viewer-actions-popover"));
  assert.equal(values.length, 1, "one existing native owner for the exact non-editing viewer");
  const menu = values[0], panel = menu.querySelector(".ui-popover-panel"), trigger = menu.querySelector(".ui-popover-trigger");
  assert.equal(panel.attributes.popover, "auto");
  assert.equal(trigger.attributes.popovertarget, panel.attributes.id);
  return { menu, panel, trigger };
}
async function currentHost(t, options, retainArtifactDialog = false, actor = null) {
  const x = await createReviewHost(t, options);
  if (actor) await x.switchActor(actor);
  if (retainArtifactDialog) {
    // Opening registers a close callback on the original native dialog. Install
    // exact retention before that callback exists, never adopt a later lookalike.
    x.f.tree = () => tree(x.f);
    x.native = installOutputNavigationFocusNative(t, x.f,
      { documentPort: x.f.host.ownerDocument, artifactDialogOwner: x.f.host });
  }
  await openGallery(x.f);
  x.f.tree = () => tree(x.f);
  if (!retainArtifactDialog) x.native = installOutputNavigationFocusNative(t, x.f, { documentPort: x.f.host.ownerDocument });
  x.beforeEvents = structuredClone(x.h.store.events.get()); x.beforeContent = structuredClone(x.h.store.content.get());
  x.beforeFinance = finance(x.worker); x.beforeRequests = x.h.requests.length; x.original = structuredClone(currentArtifact(x.f));
  return x;
}
function unchanged(x) {
  assert.deepEqual(x.h.store.events.get(), x.beforeEvents);
  assert.deepEqual(x.h.store.content.get(), x.beforeContent);
  assert.deepEqual(finance(x.worker), x.beforeFinance);
  assert.deepEqual(currentArtifact(x.f), x.original);
  assert.equal(x.h.requests.length, x.beforeRequests, "opening controls never authorizes export or repeats paid work");
}
async function openMore(x) {
  const { menu, panel, trigger } = menuState(x.f);
  assert.equal(panel.matches(":popover-open"), false);
  trigger.click(); await settle(x.f, () => menuState(x.f).panel.matches(":popover-open"));
  return menu;
}
async function chooseCurrent(x, needle) {
  const { f } = x, { menu, panel: nativePanel } = menuState(f);
  assert.equal(nativePanel.matches(":popover-open"), true);
  const row = tree(f).visible("button").find(value => value.port.handlers.click?.toString().includes(needle));
  assert.ok(row && within(row, parent => hasClass(parent, "artifact-viewer-actions-body")));
  const action = row.port, body = nodes(f, "div").find(node => hasClass(node, "artifact-viewer-actions-body"));
  let prevented = false, stopped = false;
  const event = { target: action, currentTarget: action, preventDefault() { prevented = true; },
    stopPropagation() {}, stopImmediatePropagation() { stopped = true; } };
  assert.equal(body.handlers.click.capture, true);
  body.handlers.click.handleEvent(event);
  assert.equal(prevented || stopped, false);
  assert.equal(menu.querySelector(".ui-popover-panel").matches(":popover-open"), false, "capture closes before the same current target handler");
  await action.handlers.click.call(action.owner, event); await settle(f);
}
for (const locale of locales) for (const kind of ["short_story", "audio", "video"]) {
  test("non-Slides current export promotes a real native format panel " + locale + "/" + kind, async t => {
    const x = await currentHost(t, { locale, artifactKind: kind }), { f, native } = x;
    assert.equal(currentDelivery(f).action, "exportPersonal");
    assert.equal(currentDelivery(f).releaseAllowed, true);
    assert.equal(menuState(f).panel.matches(":popover-open"), false);
    // The same host also renders the separate production-path footer.
    // Count this current viewer's footer, without hiding or changing that workflow.
    assert.equal(tree(f).visible("button").filter(row => within(row, parent => parent.tag === "footer"
      && within(parent, ancestor => ancestor.tag === "dialog" && hasClass(ancestor, "document-artifact-view")))).length, 1);
    const originalHash = currentHash(f), before = native.nativeFocus.length;
    click(f, primary(f));
    await settle(f, () => menuState(f).panel.matches(":popover-open"));
    const opened = menuState(f), choices = f.renderer.ownNodes(opened.menu, "button").filter(node => hasClass(node, "artifact-export-choice"));
    assert.equal(choices.length, 2, "retained text still offers both Markdown and Word; no synthetic media is invented");
    assert.ok(choices.every(node => !disabled(node)));
    assert.equal(text(f, primary(f)), f.i18n.t("artifact.delivery.action.exportPersonal"));
    assert.equal(primary(f).attributes["aria-controls"], "artifact-viewer-actions-" + f.artifactId);
    assert.equal(String(primary(f).attributes["aria-expanded"]), "true");
    const focused = native.nativeFocus.slice(before).at(-1)?.node;
    assert.ok(focused && hasClass(focused, "artifact-export-choice"), "promotion focuses an enabled real format, not an invisible old footer button");
    assert.ok(Object.hasOwn(focused.attributes, "data-artifact-export"));
    assert.equal(panelOpen(f), false, "export does not expand unrelated review");
    opened.panel.hidePopover(); await settle(f);
    assert.equal(String(primary(f).attributes["aria-expanded"]), "false");
    click(f, primary(f)); await settle(f, () => menuState(f).panel.matches(":popover-open"));
    assert.equal(currentHash(f), originalHash);
    unchanged(x);
  });
}
for (const locale of locales) for (const scenario of ["required", "rights", "unknown"]) {
  test("non-Slides primary keeps the actual current review/source/evidence next step " + locale + "/" + scenario, async t => {
    const options = { locale, shared: scenario === "required" || scenario === "unknown", final: scenario === "unknown", unverified: scenario === "unknown", managedPilot: scenario === "unknown" };
    const x = await currentHost(t, options), { f, h, worker, native } = x;
    if (scenario === "rights") {
      await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "ChipEdited", {
        project_id: worker.projectId, document_id: worker.documentId, block_id: "scene-reuse-direction",
        property: "rights_revoked", new_value: true,
      });
      await h.store.refreshEvents(); await settle(f);
      x.beforeEvents = structuredClone(h.store.events.get()); x.beforeContent = structuredClone(h.store.content.get());
      x.beforeRequests = h.requests.length;
    }
    const state = currentDelivery(f);
    assert.equal(state.action, { required: "assign", rights: "sources", unknown: "inspect" }[scenario]);
    assert.equal(state.releaseAllowed, false);
    assert.equal(menuState(f).panel.matches(":popover-open"), false);
    const before = native.nativeFocus.length;
    click(f, primary(f));
    await untilScene(() => native.nativeFocus.length > before, "actual owned primary focus completes");
    const focused = native.nativeFocus.at(-1).node;
    if (scenario === "unknown") {
      const details = nodes(f, "details").find(node => hasClass(node, "artifact-viewer-details"));
      assert.ok(details.open, "unverified required source exposes evidence, not a disabled download");
      assert.equal(primary(f).attributes["aria-controls"], details.attributes.id);
      assert.equal(Object.hasOwn(primary(f).attributes, "aria-expanded"), false, "the native inline disclosure owns expansion");
      assert.equal(focused.tag, "summary");
      assert.equal(panelOpen(f), false);
    } else {
      assert.equal(panelOpen(f), true);
      assert.equal(primary(f).attributes["aria-controls"], panel(f).attributes.id);
      const focusedRow = tree(f).nodes.find(row => row.port === focused);
      assert.ok(focused === panel(f) || within(focusedRow, parent => parent.port === panel(f)), "focus belongs to this exact review/source panel");
      if (scenario === "required") {
        const request = reviewControl(f, "ArtifactReviewRequested");
        assert.ok(request && !disabled(request));
        assert.equal(reviewControl(f, "ArtifactApproved"), undefined, "author never gains independent self-approval");
      } else {
        assert.ok(tree(f).visible("a").some(row => within(row, parent => parent.port === panel(f))));
        assert.ok(f.renderer.markup.includes(f.i18n.t("artifact.delivery.sourcesChanged")));
      }
    }
    assert.equal(menuState(f).panel.matches(":popover-open"), false, "required work is not hidden behind More");
    const downloads = nodes(f, "button").filter(node => hasClass(node, "artifact-export-choice"));
    assert.ok(downloads.length && downloads.every(disabled));
    unchanged(x);
  });
}
for (const locale of locales) test("non-Slides active correction keeps direct Save and Cancel " + locale, async t => {
  const x = await currentHost(t, { locale }), { f } = x;
  await openMore(x); await chooseCurrent(x, "#startArtifactEdit");
  const field = nodes(f, "textarea").find(node => node.attributes.rows === "12");
  assert.ok(field);
  const raw = "  Unsubmitted exact manuscript café العربية 日本語.\n";
  field.value = raw; field.handlers.input.call(f.host, { target: field, currentTarget: field }); await settle(f);
  assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, raw);
  assert.equal(f.renderer.query(f.host, "forma-ui-popover").filter(value => hasClass(value, "artifact-viewer-actions-popover")).length, 0);
  const footerButtons = tree(f).visible("button").filter(row => within(row, parent => parent.tag === "footer"
    && within(parent, ancestor => ancestor.tag === "dialog" && hasClass(ancestor, "document-artifact-view"))));
  assert.equal(footerButtons.length, 2, "active edit does not require another menu to Save or Cancel");
  assert.ok(footerButtons.some(row => row.port.handlers.click?.toString().includes("#saveArtifactEdit")));
  const cancel = footerButtons.find(row => row.port.handlers.click?.toString().includes("#cancelArtifactEdit")); assert.ok(cancel);
  assert.ok(disabled(primary(f)), "delivery cannot discard an active correction");
  click(f, cancel.port); await settle(f);
  assert.equal(menuState(f).panel.matches(":popover-open"), false);
  unchanged(x);
});
for (const boundary of ["current", "focus", "close", "route", "authorization", "rejected-render"]) {
  test("non-Slides pending native-panel handoff retains only current intent: " + boundary, async t => {
    const x = await currentHost(t, { locale: "en" }), { f, native, h } = x, original = menuState(f).menu;
    const gate = Promise.withResolvers(); let entered = 0;
    Object.defineProperty(original, "updateComplete", { configurable: true, get() { entered++; return gate.promise; } });
    t.after(() => { delete original.updateComplete; gate.resolve(true); });
    click(f, primary(f));
    await untilScene(() => entered > 0, "the actual existing native owner is waiting for its render");
    let newer;
    if (boundary === "focus") {
      newer = nodes(f, "button").find(node => hasClass(node, "artifact-viewer-focus-toggle")); native.focus(newer);
    } else if (boundary === "close") {
      nodes(f, "dialog").find(node => hasClass(node, "document-artifact-view")).close();
    } else if (boundary === "route") h.store.route.set("/library");
    else if (boundary === "authorization") h.store.session.set({ ...h.store.session.get(), permissionEpoch: "different-exact-scope" });
    const before = native.nativeFocus.length;
    if (boundary === "rejected-render") gate.reject(Error("native render was not committed")); else gate.resolve(true);
    await settle(f, () => boundary !== "current" || menuState(f).panel.matches(":popover-open"));
    if (boundary === "current") {
      assert.ok(menuState(f).panel.matches(":popover-open"), "a delayed but still-current original promotion remains usable");
      assert.equal(native.nativeFocus.length, before + 1, "one final handoff, not trigger focus followed by a lost lease");
      assert.ok(hasClass(native.nativeFocus.at(-1).node, "artifact-export-choice"));
    } else {
      assert.equal(native.nativeFocus.length, before, "no delayed focus can overrule a newer intent or failed render");
      assert.equal(f.renderer.openPopovers.size, 0, "no old export panel silently opens");
      if (boundary === "focus") assert.equal(native.document.activeElement, newer);
    }
    assert.deepEqual(finance(x.worker), x.beforeFinance);
    assert.deepEqual(h.store.events.get(), x.beforeEvents);
    assert.equal(h.requests.length, x.beforeRequests);
  });
}


for (const locale of locales) test("non-Slides reader has no one-option More for unavailable media-only evidence " + locale, async t => {
  const x = await createReviewHost(t, { locale, shared: true, artifactKind: "audio" }), { f, h, worker } = x;
  // Historical, unverified media metadata only: no generated bytes or approval
  // is fabricated. Existing source/rights policy must keep download disabled.
  f.artifactId = "secondary-media-only-" + locale;
  await appendAuditEvent(worker.env, worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
    project_id: worker.projectId, document_id: worker.documentId, artifact_id: f.artifactId,
    artifact_kind: "audio", title: "Current media evidence café العربية 日本語", summary: "Retained bytes unavailable",
    media_url: "/api/media/secondary-unavailable", media_type: "audio/mpeg", item_count: 0,
    items: [], requested_by_user_id: worker.owner,
  });
  await x.switchActor("reviewer");
  await openGallery(f);
  f.tree = () => tree(f);
  const native = installOutputNavigationFocusNative(t, f, { documentPort: f.host.ownerDocument });
  assert.equal(h.store.session.get().projectContext.permissions.includes("project.author"), false);
  assert.equal(artifactDeliveryFor(h.store, currentArtifact(f), null).releaseAllowed, false);
  assert.equal(text(f, primary(f)), f.i18n.t("artifact.delivery.action.inspect"));
  assert.equal(f.renderer.query(f.host, "forma-ui-popover").filter(value => hasClass(value, "artifact-viewer-actions-popover")).length, 0);
  const buttons = tree(f).visible("button").filter(row => within(row, parent => parent.tag === "footer"
    && within(parent, ancestor => ancestor.tag === "dialog" && hasClass(ancestor, "document-artifact-view"))));
  assert.equal(buttons.length, 1, "the sole existing disabled download is direct, not hidden in an empty procedure");
  assert.ok(hasClass(buttons[0], "artifact-export-choice"));
  assert.equal(text(f, buttons[0].port), f.i18n.t("audio.output.download"));
  assert.ok(disabled(buttons[0].port), "simplification does not invent retained bytes or independent approval");
  const before = { events: structuredClone(h.store.events.get()), content: structuredClone(h.store.content.get()),
    requests: h.requests.length, financial: finance(worker), focus: native.nativeFocus.length };
  click(f, primary(f));
  await untilScene(() => native.nativeFocus.length > before.focus, "current evidence inspection remains direct");
  const details = nodes(f, "details").find(node => hasClass(node, "artifact-viewer-details"));
  assert.ok(details.open);
  assert.equal(native.nativeFocus.at(-1).node.tag, "summary");
  assert.deepEqual(h.store.events.get(), before.events);
  assert.deepEqual(h.store.content.get(), before.content);
  assert.equal(h.requests.length, before.requests);
  assert.deepEqual(finance(worker), before.financial);
});

// Additive E2 coverage: this is DocumentArtifacts' existing finished-output
// correction, not presentation style/view preferences or a generation claim.
for (const locale of ["en", "ja"]) test("Slides active artifact correction keeps direct Save and Cancel " + locale, async t => {
  const x = await currentHost(t, { locale, artifactKind: "slides" }), { f } = x;
  assert.equal(currentArtifact(f).kind, "slides");
  const decks = f.renderer.query(f.host, "forma-presentation-deck").filter(value => value.isConnected);
  assert.equal(decks.length, 1);
  assert.ok(decks[0] instanceof f.renderer.registry["forma-presentation-deck"], "The ordinary presentation viewer is the actual existing component");
  await openMore(x); await chooseCurrent(x, "#startArtifactEdit");
  const editor = nodes(f, "section").find(node => hasClass(node, "artifact-direct-editor"));
  const field = nodes(f, "textarea").find(node => node.attributes.rows === "12");
  assert.ok(editor && field && field.isConnected, "The real Slides artifact edit path is reached");
  assert.equal(f.renderer.query(f.host, "forma-presentation-deck").filter(value => value.isConnected).length, 0,
    "Presentation viewing/style/export controls do not supply this editor's Save/Cancel");
  const raw = "  Unsubmitted slide correction — 元の文章を保持。\n";
  field.value = raw; field.handlers.input.call(f.host, { target: field, currentTarget: field }); await settle(f);
  assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, raw);
  assert.equal(f.renderer.query(f.host, "forma-ui-popover").filter(value => hasClass(value, "artifact-viewer-actions-popover")).length, 0,
    "An active Slides correction must not require reopening More to finish or cancel");
  const buttons = tree(f).visible("button").filter(row => within(row, parent => parent.tag === "footer"
    && within(parent, ancestor => ancestor.tag === "dialog" && hasClass(ancestor, "document-artifact-view"))));
  assert.equal(buttons.length, 2);
  const save = buttons.find(row => row.port.handlers.click?.toString().includes("#saveArtifactEdit"));
  const cancel = buttons.find(row => row.port.handlers.click?.toString().includes("#cancelArtifactEdit"));
  assert.ok(save && cancel); assert.equal(disabled(save.port), false); assert.equal(disabled(cancel.port), false);
  assert.ok(disabled(primary(f)), "Delivery stays unavailable during the local correction");
  click(f, cancel.port); await settle(f);
  assert.equal(nodes(f, "section").some(node => hasClass(node, "artifact-direct-editor")), false);
  assert.equal(menuState(f).panel.matches(":popover-open"), false);
  assert.equal(f.renderer.query(f.host, "forma-presentation-deck").filter(value => value.isConnected).length, 1);
  unchanged(x); // No Save, export, approval, provider or new generation is submitted.
});

// Post-original E4 only. Reuse the same actual viewer, scoped Worker session,
// and native template ports; these fixtures are not generated Slides.
for (const retained of [true, false]) test("E4 reader Slides has only its actual footer alternatives / " + retained, async t => {
  const x = await currentHost(t, { locale: "en", shared: true, artifactKind: "slides" }), { f, h, worker } = x;
  assert.equal(currentArtifact(f).kind, "slides");
  assert.equal(h.store.session.get().projectContext.permissions.includes("project.author"), true);
  const author = menuState(f);
  author.trigger.click(); await settle(f, () => menuState(f).panel.matches(":popover-open"));
  const authorActions = tree(f).visible("button").filter(row => within(row, parent => hasClass(parent, "artifact-viewer-actions-body")));
  assert.equal(authorActions.length, 3, "the shared author retains History, Edit and Reuse in the same More");
  assert.ok(authorActions.some(row => row.port.handlers.click?.toString().includes("#loadHistory")));
  assert.ok(authorActions.some(row => row.port.handlers.click?.toString().includes("#startArtifactEdit")));
  assert.ok(authorActions.some(row => row.port.handlers.click?.toString().includes("#addArtifactContext")));
  author.menu.close(); await settle(f);
  click(f, nodes(f, "button").find(node => node.attributes["aria-label"] === f.i18n.t("action.close", "Close")));
  await settle(f);
  if (!retained) {
    // Existing missing-byte scenario pattern: no content reference, media,
    // approval or successful generation is manufactured.
    f.artifactId = "e4-reader-slides-metadata-only";
    await appendAuditEvent(worker.env, worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
      project_id: worker.projectId, document_id: worker.documentId, artifact_id: f.artifactId,
      artifact_kind: "slides", title: "Retained metadata only", summary: "Retained content unavailable",
      item_count: 0, items: [], requested_by_user_id: worker.owner,
    });
  }
  await x.switchActor("reviewer"); await openGallery(f);
  assert.equal(h.store.session.get().projectContext.permissions.includes("project.author"), false);
  assert.equal(currentArtifact(f).kind, "slides");
  assert.equal(Boolean(currentArtifact(f).mediaUrl), false);
  assert.equal(Boolean(h.store.content.get()[currentArtifact(f).contentRef ?? ""]), retained);
  const before = { events: structuredClone(h.store.events.get()), content: structuredClone(h.store.content.get()),
    artifact: structuredClone(currentArtifact(f)), requests: h.requests.length, financial: finance(worker) };
  const menus = f.renderer.query(f.host, "forma-ui-popover").filter(value => hasClass(value, "artifact-viewer-actions-popover"));
  const footer = tree(f).visible("button").filter(row => within(row, parent => parent.tag === "footer"));
  const observed = { menus: menus.length, footerCount: footer.length,
    historyDirect: footer.some(row => row.port.handlers.click?.toString().includes("#loadHistory")),
    authorActions: footer.some(row => /#startArtifactEdit|#addArtifactContext/u.test(row.port.handlers.click?.toString() ?? "")),
    primaryLabel: text(f, primary(f)), primaryDisabled: disabled(primary(f)) };
  assert.deepEqual(h.store.events.get(), before.events);
  assert.deepEqual(h.store.content.get(), before.content);
  assert.deepEqual(currentArtifact(f), before.artifact);
  assert.deepEqual(finance(worker), before.financial);
  assert.equal(h.requests.length, before.requests, "counting available actions neither reads nor mutates anything");
  assert.equal(observed.authorActions, false);
  assert.equal(observed.primaryDisabled, false, "the current delivery/evidence next action stays directly reachable");
  if (!retained) assert.equal(observed.primaryLabel, f.i18n.t("artifact.delivery.action.inspect"));
  assert.equal(observed.menus, 0, "zero or one actual alternative must not require More");
  assert.equal(observed.footerCount, retained ? 1 : 0);
  assert.equal(observed.historyDirect, retained);
});

// Post-original E4 only. Invoke the existing current native bindings. The
// cancel default below is this finite port's declared native-close behavior,
// not evidence of a physical browser's light-dismiss or event queue.
const e4CorrectionCopy = {
  en: { finish: (save, cancel) => "Choose " + save + " to keep this correction, or " + cancel + " to discard the local changes.",
    saving: "Wait for the current save to finish before closing this output.",
    busy: "A save is still pending. You can keep viewing or close this output.", pending: edit => edit + " (save pending)" },
  fr: { finish: (save, cancel) => "Choisissez « " + save + " » pour conserver cette correction, ou « " + cancel + " » pour abandonner les modifications locales.",
    saving: "Attendez la fin de l’enregistrement en cours avant de fermer ce résultat.",
    busy: "Un enregistrement est encore en cours. Vous pouvez continuer à consulter ce résultat ou le fermer.", pending: edit => edit + " (enregistrement en attente)" },
  ar: { finish: (save, cancel) => "اختر «" + save + "» للاحتفاظ بهذا التصحيح، أو «" + cancel + "» لتجاهل التعديلات المحلية.",
    saving: "انتظر حتى يكتمل الحفظ الجاري قبل إغلاق هذا المخرج.",
    busy: "لا تزال عملية حفظ معلّقة. يمكنك متابعة عرض هذا المخرج أو إغلاقه.", pending: edit => edit + " (بانتظار اكتمال الحفظ)" },
  ja: { finish: (save, cancel) => "この修正を保存するには「" + save + "」、ローカルの変更を破棄するには「" + cancel + "」を選んでください。",
    saving: "現在の保存処理が終わるまで、この出力を閉じずにお待ちください。",
    busy: "保存処理がまだ完了していません。この出力の閲覧を続けるか、閉じることができます。", pending: edit => edit + "（保存完了待ち）" },
};
function e4DismissCurrent(f, gesture) {
  const dialog = nodes(f, "dialog").find(node => hasClass(node, "document-artifact-view"));
  assert.ok(dialog?.open);
  if (gesture === "close") {
    click(f, nodes(f, "button").find(node => node.attributes["aria-label"] === f.i18n.t("action.close", "Close")));
    return;
  }
  let prevented = false;
  const event = { type: gesture === "escape" ? "cancel" : "click", target: dialog, currentTarget: dialog,
    preventDefault() { prevented = true; }, stopPropagation() {} };
  if (gesture === "escape") {
    assert.equal(typeof dialog.handlers.cancel, "function");
    dialog.handlers.cancel.call(f.host, event);
    if (!prevented) dialog.close();
  } else {
    assert.equal(gesture, "backdrop");
    dialog.handlers.click.call(f.host, event);
  }
}
for (const [locale, artifactKind, gesture, changed] of [
  ["en", "short_story", "close", true], ["fr", "scene", "escape", true],
  ["ar", "storyboard", "backdrop", true], ["ja", "slides", "close", true],
  ["en", "video", "backdrop", true], ["en", "short_story", "escape", false],
]) test("E4 current correction survives incidental dismissal / " + [locale, artifactKind, gesture, changed].join("/"), async t => {
  const x = await currentHost(t, { locale, artifactKind }), { f, h } = x;
  await openMore(x); await chooseCurrent(x, "#startArtifactEdit");
  const field = nodes(f, "textarea").find(node => node.attributes.rows === "12"); assert.ok(field);
  const raw = changed ? "  Still local café العربية 日本語 correction.\n" : field.value;
  if (changed) { field.value = raw; field.handlers.input.call(f.host, { target: field, currentTarget: field }); await settle(f); }
  const owned = nodes(f, "dialog").find(node => hasClass(node, "document-artifact-view"));
  const closedby = owned.attributes.closedby;
  e4DismissCurrent(f, gesture); await settle(f);
  const after = nodes(f, "dialog").find(node => hasClass(node, "document-artifact-view"));
  const observed = { open: Boolean(after?.open), raw: nodes(f, "textarea").find(node => node.attributes.rows === "12")?.value,
    toast: h.store.ui.toast, closedby };
  unchanged(x);
  // Cleanup is conditional only on the observed failure/success state. The
  // final oracle still requires the real direct Cancel path to have existed.
  let cancelled = false;
  if (observed.open && nodes(f, "textarea").some(node => node.attributes.rows === "12")) {
    const cancel = tree(f).visible("button").find(row => row.port.handlers.click?.toString().includes("#cancelArtifactEdit"))?.port;
    assert.ok(cancel && !disabled(cancel));
    click(f, cancel); await settle(f);
    cancelled = !nodes(f, "textarea").some(node => node.attributes.rows === "12");
    assert.equal(menuState(f).panel.matches(":popover-open"), false);
  }
  unchanged(x);
  assert.equal(observed.open, true, "ordinary dismissal cannot abandon this active correction");
  assert.equal(observed.raw, raw, "even an untouched active edit keeps its original disposition owner");
  assert.equal(observed.closedby, "closerequest", "native light-dismiss is disabled while this correction is owned");
  assert.equal(observed.toast, e4CorrectionCopy[locale].finish(f.i18n.system("Save finished output"), f.i18n.system("Cancel")));
  assert.equal(f.i18n.t("artifact.delivery.savingCorrection"), e4CorrectionCopy[locale].saving);
  assert.equal(f.i18n.t("artifact.delivery.editBusy"), e4CorrectionCopy[locale].busy);
  assert.equal(f.i18n.t("artifact.delivery.editPending", "", { edit: f.i18n.system("Edit finished output") }), e4CorrectionCopy[locale].pending(f.i18n.system("Edit finished output")));
  assert.equal(cancelled, true, "deliberate current Cancel still discards only the local correction");
});

for (const gesture of ["close", "escape", "backdrop"]) test("E4 ordinary read-only viewer still dismisses / " + gesture, async t => {
  const x = await currentHost(t, { locale: "en" }), { f } = x;
  assert.equal(nodes(f, "textarea").some(node => node.attributes.rows === "12"), false);
  assert.equal(nodes(f, "dialog").find(node => hasClass(node, "document-artifact-view")).attributes.closedby, "any");
  e4DismissCurrent(f, gesture); await settle(f);
  const closed = !nodes(f, "dialog").some(node => hasClass(node, "document-artifact-view") && node.open);
  unchanged(x);
  assert.equal(closed, true, "read-only inspection does not acquire a correction-dismissal gate");
});

// Post-original E4 only: keep actual More capture, current target bindings and
// the existing native focus lease ports. Saved output bytes are never edited.
for (const [locale, artifactKind] of [["en", "short_story"], ["fr", "scene"], ["ar", "storyboard"], ["ja", "slides"], ["en", "video"]]) {
  test("E4 correction Edit and explicit Cancel hand off current native focus / " + locale + "/" + artifactKind, async t => {
    const x = await currentHost(t, { locale, artifactKind }, true), { f, native } = x;
    await openMore(x);
    const beforeEntry = native.nativeFocus.length;
    await chooseCurrent(x, "#startArtifactEdit");
    const entryFocus = native.nativeFocus.slice(beforeEntry).at(-1)?.node;
    const field = nodes(f, "textarea").find(node => node.attributes.rows === "12");
    assert.ok(field);
    const raw = "  Exact local correction café العربية 日本語.\n";
    field.value = raw; field.handlers.input.call(f.host, { target: field, currentTarget: field }); await settle(f);
    assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, raw);
    if (["slides", "storyboard", "video"].includes(artifactKind)) for (const [tag, property] of [["input", "title"], ["textarea", "body"], ["textarea", "notes"]]) {
      const part = nodes(f, tag).find(node => node.handlers.input?.toString().includes("item." + property));
      assert.ok(part && !disabled(part), "the current editable item has a real " + property + " field");
      const value = "  Unsubmitted " + property + " café العربية 日本語." + (tag === "textarea" ? "\n" : "");
      part.value = value; part.handlers.input.call(f.host, { target: part, currentTarget: part }); await settle(f);
      assert.equal(nodes(f, tag).find(node => node.handlers.input?.toString().includes("item." + property)).value, value);
    }
    const cancel = tree(f).visible("button").find(row => row.port.handlers.click?.toString().includes("#cancelArtifactEdit"));
    assert.ok(cancel && within(cancel, parent => parent.tag === "footer"));
    assert.equal(disabled(cancel.port), false);
    const beforeCancel = native.nativeFocus.length;
    click(f, cancel.port); await settle(f);
    const cancelFocus = native.nativeFocus.slice(beforeCancel).at(-1)?.node;
    const current = menuState(f);
    assert.equal(current.panel.matches(":popover-open"), false);
    assert.equal(nodes(f, "textarea").some(node => node.attributes.rows === "12"), false);
    unchanged(x);
    // The renderer recreates literal native ports after a draw. These records
    // prove the connected target at its actual focus call, not browser paint.
    assert.equal(entryFocus?.owner === f.host, true, "Edit owns this viewer's current manuscript, not the removed More trigger");
    assert.equal(entryFocus?.tag, "textarea");
    assert.equal(entryFocus?.attributes.rows, "12");
    assert.ok(cancelFocus && hasClass(cancelFocus, "ui-popover-trigger"), "explicit Cancel returns to the restored next-action owner");
    assert.equal(cancelFocus.owner === current.menu, true, "Cancel belongs to the exact current action owner");
    assert.equal(cancelFocus.attributes.popovertarget, current.panel.attributes.id);
  });
}

for (const boundary of ["focus", "newer-draft", "authorization", "native-close"]) test("E4 delayed Edit focus yields to current intent / " + boundary, async t => {
  const x = await currentHost(t, { locale: "en" }, true), { f, h, native } = x;
  await openMore(x);
  const gate = Promise.withResolvers();
  Object.defineProperty(f.host, "updateComplete", { configurable: true, get: () => gate.promise });
  t.after(() => { delete f.host.updateComplete; gate.resolve(true); });
  const entering = chooseCurrent(x, "#startArtifactEdit");
  let before, raw;
  try {
    await settle(f, () => nodes(f, "textarea").some(node => node.attributes.rows === "12"));
    if (boundary === "focus") {
      const next = tree(f).visible("button").find(row => row.port.handlers.click?.toString().includes("#cancelArtifactEdit"))?.port;
      assert.ok(next && !disabled(next), "newer focus belongs to a current visible enabled action");
      native.focus(next);
    }
    else if (boundary === "newer-draft") {
      const field = nodes(f, "textarea").find(node => node.attributes.rows === "12");
      raw = "  A newer local revision keeps its caret ownership.\n";
      field.value = raw; field.handlers.input.call(f.host, { target: field, currentTarget: field }); await settle(f);
    } else if (boundary === "native-close") nodes(f, "dialog").find(node => hasClass(node, "document-artifact-view")).close();
    else h.store.session.set({ ...h.store.session.get(), permissionEpoch: "E4-withdrawn-edit-focus-scope" });
    before = native.nativeFocus.length;
  } finally {
    delete f.host.updateComplete; gate.resolve(true); await entering; await settle(f);
  }
  if (raw) assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, raw);
  unchanged(x);
  assert.equal(native.nativeFocus.length, before, "a pending handoff has no authority over newer focus, raw input or authorization");
});

test("E4 delayed explicit Cancel return yields to a newer native focus", async t => {
  const x = await currentHost(t, { locale: "en" }, true), { f, native } = x;
  await openMore(x); await chooseCurrent(x, "#startArtifactEdit");
  const cancel = tree(f).visible("button").find(row => row.port.handlers.click?.toString().includes("#cancelArtifactEdit")).port;
  assert.equal(disabled(cancel), false);
  const gate = Promise.withResolvers();
  Object.defineProperty(f.host, "updateComplete", { configurable: true, get: () => gate.promise });
  t.after(() => { delete f.host.updateComplete; gate.resolve(true); });
  const leaving = cancel.handlers.click.call(f.host, { target: cancel, currentTarget: cancel });
  let before;
  try {
    await settle(f, () => !nodes(f, "textarea").some(node => node.attributes.rows === "12"));
    const next = primary(f); assert.ok(next && !disabled(next));
    native.focus(next); before = native.nativeFocus.length;
  } finally {
    delete f.host.updateComplete; gate.resolve(true); await leaving; await settle(f);
  }
  unchanged(x);
  assert.equal(native.nativeFocus.length, before, "the original Cancel gesture never overwrites a later native choice");
});


// Integrated model3d export uses the inline returned-file controls. These
// synthetic retained metadata receipts are read by the actual event projection;
// no model bytes, WebGL owner, provider execution or download is simulated.
const model3dReturnedFiles = [
  { url: "/api/media/inline-model-obj", mimeType: "model/obj", fileName: "Original model.obj",
    fileSize: 120, format: "obj", role: "mesh", sha256: "a".repeat(64) },
  { url: "/api/media/inline-model-texture", mimeType: "image/png", fileName: "Companion texture.png",
    fileSize: 80, format: null, role: "texture", sha256: "b".repeat(64) },
];
async function currentModel3dHost(t, { reader = false, blocked = false, files = model3dReturnedFiles, locale = "en" } = {}) {
  const x = await currentHost(t, { locale, shared: reader || blocked,
    legacy: reader && !blocked ? "exact" : null, artifactKind: "model3d", model3dFiles: files }, true, reader ? "reviewer" : null);
  const { f } = x, query = f.renderer.query.bind(f.renderer);
  // The existing native port supports class-to-field descendants. Extend only
  // this actual class-to-class query, using the same committed literal ancestry.
  // Return current emitted nodes, never a synthesized choice or focus result.
  f.renderer.query = (owner, selector) => {
    if (selector !== ".model3d-output-files .artifact-export-choice") return query(owner, selector);
    assert.equal(Boolean(f.renderer.updatingOwner), false, "inline export queries the committed host render");
    const rows = tree(f).nodes, dialog = rows.find(row => row.port === owner);
    assert.ok(dialog && hasClass(dialog, "document-artifact-view"), "the real current viewer owns the query");
    return query(owner, ".artifact-export-choice").filter(node => {
      const row = rows.find(candidate => candidate.port === node);
      return row && within(row, parent => hasClass(parent, "model3d-output-files")
        && within(parent, ancestor => ancestor === dialog));
    });
  };
  return x;
}
function model3dFileControls(f) {
  const rows = tree(f).nodes;
  const sections = rows.filter(row => row.tag === "section"
    && row.attributes.id === "artifact-model3d-files-" + f.artifactId);
  assert.equal(sections.length, 1, "one actual inline file section belongs to this artifact");
  const section = sections[0];
  return { section, choices: rows.filter(row => row.tag === "button" && hasClass(row, "artifact-export-choice")
    && within(row, parent => parent === section)) };
}
function model3dFooterActions(f) {
  const rows = tree(f).nodes, body = rows.find(row => row.attributes.id === "artifact-viewer-actions-" + f.artifactId);
  assert.ok(body && within(body, parent => parent.tag === "footer"));
  return rows.filter(row => row.tag === "button" && within(row, parent => parent === body));
}
function assertInlineModel3dFocus(x, before) {
  const { f, native } = x, { section, choices } = model3dFileControls(f);
  const focused = native.nativeFocus.slice(before);
  assert.equal(focused.length, 1, "the gesture makes one final handoff to an actual file choice");
  assert.ok(choices.length && choices.every(row => !disabled(row.port)));
  assert.equal(focused[0].node, choices[0].port, "the first returned enabled file is the actual focus target");
  assert.equal(native.document.activeElement, choices[0].port);
  assert.equal(choices[0].hiddenBy, null, "the target is not under a closed native owner");
  assert.equal(choices[0].port.isConnected, true);
  assert.notEqual(focused[0].args[0]?.preventScroll, true, "inline file focus allows the browser to reveal its scroll position");
  assert.equal(primary(f).attributes["aria-controls"], section.attributes.id);
  assert.equal(Object.hasOwn(primary(f).attributes, "aria-expanded"), false, "inline files have no popover expansion state");
  assert.equal(f.renderer.openPopovers.size, 0, "export does not open the unrelated footer menu");
}
for (const [locale, reader] of [["en", false], ["ar", true]]) {
  test("model3d current inline export preserves actual footer cardinality / " + locale + "/" + (reader ? "reader" : "author"), async t => {
    const x = await currentModel3dHost(t, { locale, reader }), { f, h, native } = x;
    assert.equal(currentArtifact(f).kind, "model3d");
    assert.equal(currentArtifact(f).mediaUrl, model3dReturnedFiles[0].url);
    assert.deepEqual(currentArtifact(f).settings.model3d_files, model3dReturnedFiles);
    assert.equal(currentDelivery(f).releaseAllowed, true);
    assert.equal(currentDelivery(f).approved, reader);
    assert.equal(currentDelivery(f).action, reader ? "export" : "exportPersonal");
    if (reader) assert.equal(h.store.session.get().projectContext.permissions.includes("project.author"), false);
    const actions = model3dFooterActions(f), files = model3dFileControls(f);
    assert.equal(files.choices.length, model3dReturnedFiles.length);
    assert.deepEqual(files.choices.map(row => row.port.attributes.title), model3dReturnedFiles.map(file => file.fileName));
    assert.equal(actions.length, reader ? 1 : 3, "only rendered footer alternatives count; inline downloads are separate");
    assert.ok(actions.some(row => row.port.handlers.click?.toString().includes("#loadHistory")));
    assert.equal(actions.some(row => hasClass(row, "artifact-export-choice")), false);
    assert.equal(actions.some(row => row.port.handlers.click?.toString().includes("#startArtifactEdit")), false);
    const menus = f.renderer.query(f.host, "forma-ui-popover").filter(value => hasClass(value, "artifact-viewer-actions-popover"));
    assert.equal(menus.length, reader ? 0 : 1);
    if (reader) assert.equal(actions[0].hiddenBy, null, "the sole History action is direct");
    else {
      const reuse = actions.find(row => Object.hasOwn(row.attributes, "data-artifact-reuse"));
      assert.ok(reuse && disabled(reuse.port), "an unsupported original OBJ still renders and counts its disabled reuse control");
      assert.equal(menuState(f).panel.matches(":popover-open"), false);
    }
    const before = native.nativeFocus.length;
    click(f, primary(f));
    await untilScene(() => native.nativeFocus.length > before, "current inline model-file focus completes");
    assertInlineModel3dFocus(x, before);
    assert.equal(panelOpen(f), false);
    await settle(f); unchanged(x);
  });
}
for (const reader of [false, true]) test("model3d blocked files retain the current review or evidence action / " + (reader ? "reader" : "author"), async t => {
  const x = await currentModel3dHost(t, { reader, blocked: true }), { f, native } = x;
  assert.equal(currentDelivery(f).releaseAllowed, false);
  assert.equal(currentDelivery(f).action, reader ? "inspect" : "assign");
  const files = model3dFileControls(f);
  assert.equal(files.choices.length, model3dReturnedFiles.length);
  assert.ok(files.choices.every(row => disabled(row.port)));
  const before = native.nativeFocus.length;
  click(f, primary(f));
  await untilScene(() => native.nativeFocus.length > before, "blocked model output reaches its actual current next step");
  const focused = native.nativeFocus.at(-1).node;
  assert.equal(hasClass(focused, "artifact-export-choice"), false);
  assert.ok(model3dFileControls(f).choices.every(row => disabled(row.port)));
  if (reader) {
    const details = nodes(f, "details").find(node => hasClass(node, "artifact-viewer-details"));
    assert.ok(details.open); assert.equal(focused.tag, "summary");
    assert.equal(primary(f).attributes["aria-controls"], details.attributes.id);
    assert.equal(Object.hasOwn(primary(f).attributes, "aria-expanded"), false);
  } else {
    assert.equal(panelOpen(f), true);
    assert.equal(primary(f).attributes["aria-controls"], panel(f).attributes.id);
    const row = tree(f).nodes.find(value => value.port === focused);
    assert.ok(focused === panel(f) || within(row, parent => parent.port === panel(f)));
  }
  assert.equal(f.renderer.openPopovers.size, 0);
  await settle(f); unchanged(x);
});
for (const reader of [false, true]) test("model3d export with no retained files invents no choice or download / " + (reader ? "reader" : "author"), async t => {
  const x = await currentModel3dHost(t, { reader, files: [] }), { f, native } = x;
  assert.equal(currentArtifact(f).mediaUrl, null, "there is no legacy primary-file fallback");
  assert.equal(currentDelivery(f).releaseAllowed, true, "existing delivery evidence does not manufacture a model file");
  assert.equal(model3dFileControls(f).choices.length, 0);
  const before = native.nativeFocus.length, active = native.document.activeElement;
  click(f, primary(f)); await settle(f);
  assert.equal(native.nativeFocus.length, before);
  assert.equal(native.document.activeElement, active);
  assert.equal(model3dFileControls(f).choices.length, 0);
  assert.equal(primary(f).attributes["aria-controls"], model3dFileControls(f).section.attributes.id);
  assert.equal(Object.hasOwn(primary(f).attributes, "aria-expanded"), false);
  assert.equal(f.renderer.openPopovers.size, 0);
  assert.equal(panelOpen(f), false);
  unchanged(x);
});
for (const boundary of ["current", "focus", "route", "source", "binding", "authorization", "close", "rejected-render"]) {
  test("model3d pending host-render handoff retains only its original current intent / " + boundary, async t => {
    const x = await currentModel3dHost(t), { f, h, native } = x;
    const source = h.store.captureSourceOwnership(), session = structuredClone(h.store.session.get());
    const originalHash = currentHash(f), gate = Promise.withResolvers(); let entered = 0;
    Object.defineProperty(f.host, "updateComplete", { configurable: true, get() { entered++; return gate.promise; } });
    t.after(() => { delete f.host.updateComplete; gate.resolve(true); });
    let newer, before;
    try {
      click(f, primary(f));
      await untilScene(() => entered > 0, "the actual model intent awaits its host render, not a footer-menu render");
      f.draw();
      assert.equal(f.renderer.openPopovers.size, 0);
      if (boundary === "focus") {
        newer = tree(f).visible("button").find(row => hasClass(row, "artifact-viewer-focus-toggle"))?.port;
        assert.ok(newer && !disabled(newer)); native.focus(newer);
      } else if (boundary === "route") h.store.route.set("/library");
      else if (boundary === "authorization") h.store.session.set({ ...h.store.session.get(), permissionEpoch: "model3d-newer-scope" });
      else if (boundary === "close") nodes(f, "dialog").find(node => hasClass(node, "document-artifact-view")).close();
      else if (boundary === "binding") {
        const ref = currentArtifact(f).contentRef;
        const replacement = { ...x.beforeContent, [ref]: x.beforeContent[ref] + "\n" };
        h.store.content.set(replacement);
        x.beforeContent = structuredClone(replacement);
        await settle(f, () => f.renderer.markup.includes(currentHash(f)), "a newly bound retained digest is rendered before the old handoff resumes");
        assert.notEqual(currentHash(f), originalHash);
        assert.equal(currentDelivery(f).releaseAllowed, true, "the replacement remains exportable under its own current binding");
      } else if (boundary === "source") {
        const transport = h.transport; let denials = 0;
        h.transport = async request => {
          if (request.url.startsWith("/api/events?")) { denials++; return new Response(null, { status: 403 }); }
          return transport(request);
        };
        try { await assert.rejects(h.store.refreshEvents(), /Event stream returned 403/u); }
        finally { h.transport = transport; }
        assert.equal(denials, 1, "one explicit finite transport denial retires the actual Store source");
        assert.equal(h.store.sourceOwnershipActive(source), false);
        assert.deepEqual(h.store.session.get(), session, "retirement does not fabricate a different actor or role");
        assert.deepEqual(h.store.events.get(), []); assert.deepEqual(h.store.content.get(), {});
        assert.equal(h.requests.length, x.beforeRequests + 1);
        // Only the explicit denial read and source erasure change expectations.
        // Releasing the old gesture must add no request, event, content or spend.
        x.beforeEvents = []; x.beforeContent = {}; x.original = undefined; x.beforeRequests += 1;
        await settle(f);
      }
      before = native.nativeFocus.length;
    } finally {
      delete f.host.updateComplete;
      if (boundary === "rejected-render") gate.reject(Error("model3d host render was not committed"));
      else gate.resolve(true);
    }
    await new Promise(setImmediate);
    if (boundary === "current") assertInlineModel3dFocus(x, before);
    else {
      assert.equal(native.nativeFocus.length, before, "a delayed inline handoff cannot overwrite retired ownership or newer focus");
      if (boundary === "focus") assert.equal(native.document.activeElement, newer);
    }
    assert.equal(f.renderer.openPopovers.size, 0);
    await settle(f);
    if (boundary === "source") assert.equal(nodes(f, "dialog").some(node => hasClass(node, "document-artifact-view")), false);
    unchanged(x);
  });
}

// The unchanged native port emits document focusin synchronously after recording
// focus arguments and before focus returns. These observations assert ownership
// and command order only; they do not model viewport, caret or scroll geometry.
function observeOwnedEditArrival(t, x, onArrival = () => {}) {
  const { f, native } = x, observations = [], errors = []; let armed = true;
  const listener = event => {
    const target = event.target;
    if (!armed || target?.owner !== f.host || target.tag !== "textarea" || target.attributes.rows !== "12") return;
    armed = false;
    try {
      const dialogs = nodes(f, "dialog").filter(node => hasClass(node, "document-artifact-view"));
      assert.equal(dialogs.length, 1);
      const dialog = dialogs[0], focus = native.nativeFocus.at(-1);
      const observation = { target, dialog, focus, scrollCount: native.nativeScroll.length, raw: target.value };
      observations.push(observation);
      assert.equal(target.isConnected, true);
      assert.equal(dialog.open, true);
      assert.equal(target.ownerDocument, native.document);
      assert.equal(native.document.activeElement, target);
      assert.equal(dialog.querySelector('.artifact-direct-editor textarea[rows="12"]'), target);
      assert.equal(focus?.node, target, "the arrival was recorded by the actual product focus call");
      onArrival(observation);
    } catch (error) { errors.push(error); }
  };
  native.document.addEventListener("focusin", listener);
  const dispose = () => native.document.removeEventListener("focusin", listener);
  t.after(dispose);
  return { observations, errors, dispose };
}
function requireOwnedEditArrival(observed) {
  // Product's retired-opening catch must not swallow a test-listener assertion.
  assert.deepEqual(observed.errors, []);
  assert.equal(observed.observations.length, 1, "the synchronous post-focus seam was independently reached");
  return observed.observations[0];
}
async function cancelUnsubmittedOwnedEdit(x, raw) {
  const { f, native } = x;
  const field = nodes(f, "textarea").find(node => node.attributes.rows === "12");
  assert.ok(field && !disabled(field));
  field.value = raw; field.handlers.input.call(f.host, { target: field, currentTarget: field }); await settle(f);
  assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, raw);
  unchanged(x);
  const cancel = tree(f).visible("button").find(row => row.port.handlers.click?.toString().includes("#cancelArtifactEdit"));
  assert.ok(cancel && within(cancel, parent => parent.tag === "footer") && !disabled(cancel.port));
  const beforeFocus = native.nativeFocus.length, beforeScroll = native.nativeScroll.length;
  click(f, cancel.port); await settle(f);
  const returned = native.nativeFocus.slice(beforeFocus).at(-1)?.node, menu = menuState(f);
  assert.ok(returned && hasClass(returned, "ui-popover-trigger"));
  assert.equal(returned.owner, menu.menu);
  assert.equal(returned.attributes.popovertarget, menu.panel.attributes.id);
  assert.equal(menu.panel.matches(":popover-open"), false);
  assert.equal(nodes(f, "textarea").some(node => node.attributes.rows === "12"), false);
  assert.equal(native.nativeScroll.length, beforeScroll, "Cancel retains its existing focus-only return");
  unchanged(x);
}
for (const [artifactKind, focused] of [["short_story", false], ["short_story", true], ["scene", false], ["storyboard", false], ["slides", false], ["video", false]]) {
  test("Story owned editor reveal keeps the exact edit mode / " + artifactKind + "/" + (focused ? "focused" : "normal"), async t => {
    const x = await currentHost(t, { locale: "en", artifactKind }, true), { f, native } = x;
    if (focused) {
      const toggle = tree(f).visible("button").find(row => hasClass(row.port, "artifact-viewer-focus-toggle"))?.port;
      assert.ok(toggle && !disabled(toggle)); click(f, toggle);
      await settle(f, () => nodes(f, "dialog").some(node => hasClass(node, "document-artifact-view") && node.getAttribute("data-output-focus") === "true"));
    }
    await openMore(x);
    const beforeFocus = native.nativeFocus.length, beforeScroll = native.nativeScroll.length;
    const observed = observeOwnedEditArrival(t, x, ({ dialog }) => {
      assert.equal(dialog.getAttribute("data-artifact-kind"), artifactKind);
      assert.equal(dialog.getAttribute("data-output-focus"), String(focused));
    });
    try { await chooseCurrent(x, "#startArtifactEdit"); } finally { observed.dispose(); }
    const arrival = requireOwnedEditArrival(observed);
    assert.equal(arrival.scrollCount, beforeScroll, "the actual focus call precedes any editor reveal");
    assert.equal(native.nativeFocus.slice(beforeFocus).filter(row => row.node.owner === f.host && row.node.tag === "textarea" && row.node.attributes.rows === "12").length, 1);
    const reveal = native.nativeScroll.slice(beforeScroll);
    if (artifactKind === "short_story" && !focused) {
      assert.deepEqual(arrival.focus.args, [{ preventScroll: true }], "normal Story acquires focus without the browser's default focus scroll");
      assert.equal(reveal.length, 1, "one owned native reveal completes normal Story arrival");
      assert.equal(reveal[0].node, arrival.target);
      assert.deepEqual(reveal[0].args, [{ block: "nearest", inline: "nearest", behavior: "instant" }]);
    } else {
      assert.deepEqual(arrival.focus.args, [], "other editable kinds and focused Story retain plain focus");
      assert.deepEqual(reveal, [], "the new reveal has no authority in another edit mode");
    }
    unchanged(x);
    await cancelUnsubmittedOwnedEdit(x, "  Unsubmitted " + artifactKind + " café العربية 日本語.\n");
  });
}
test("Story programmatic Edit without an event retains no focus or reveal lease", async t => {
  const x = await currentHost(t, { locale: "en", artifactKind: "short_story" }, true), { f, native } = x;
  await openMore(x);
  const row = tree(f).visible("button").find(value => value.port.handlers.click?.toString().includes("#startArtifactEdit"));
  assert.ok(row && within(row, parent => hasClass(parent, "artifact-viewer-actions-body")) && !disabled(row.port));
  const action = row.port;
  // Deliver the actual action EventPart without an event. This is a finite
  // programmatic-call control, not a claimed native click or private-method call.
  menuState(f).panel.hidePopover();
  const beforeFocus = native.nativeFocus.length, beforeScroll = native.nativeScroll.length;
  await action.handlers.click.call(action.owner); await settle(f);
  assert.ok(nodes(f, "textarea").some(node => node.attributes.rows === "12"));
  assert.equal(native.nativeFocus.length, beforeFocus);
  assert.equal(native.nativeScroll.length, beforeScroll);
  unchanged(x);
  await cancelUnsubmittedOwnedEdit(x, "  No-event raw draft remains local.\n");
});
for (const boundary of ["source-retirement-event", "authorization", "native-close", "target-replacement", "newer-draft", "focus-transfer"]) {
  test("Story post-focus reveal yields synchronously / " + boundary, async t => {
    const x = await currentHost(t, { locale: "en", artifactKind: "short_story" }, true), { f, h, native } = x;
    await openMore(x);
    const beforeScroll = native.nativeScroll.length, source = h.store.captureSourceOwnership();
    assert.ok(source && h.store.sourceOwnershipActive(source));
    let mutation = null;
    const observed = observeOwnedEditArrival(t, x, ({ target, dialog, scrollCount }) => {
      assert.equal(dialog.getAttribute("data-artifact-kind"), "short_story");
      assert.equal(dialog.getAttribute("data-output-focus"), "false");
      assert.equal(scrollCount, beforeScroll);
      if (boundary === "source-retirement-event") {
        const callbacks = [...(f.listeners.get("forma-event-source-retired") ?? [])];
        assert.ok(callbacks.length > 0, "the current component registered its real source-retirement callback");
        assert.equal(h.store.sourceOwnershipScopeActive(source), true);
        for (const callback of callbacks) callback({ type: "forma-event-source-retired", detail: { source } });
        assert.equal(dialog.open, false, "actual component source retirement closes its original native dialog");
        assert.equal(h.store.sourceOwnershipActive(source), true, "explicit event delivery does not pretend a Store 403 or source erasure");
        mutation = { kind: boundary, closed: dialog };
      } else if (boundary === "authorization") {
        const authorization = h.store.captureAuthorizationScope(); assert.ok(authorization);
        h.store.session.set({ ...h.store.session.get(), permissionEpoch: "Story-post-focus-withdrawn-scope" });
        assert.equal(h.store.authorizationScopeActive(authorization), false);
        mutation = { kind: boundary };
      } else if (boundary === "native-close") {
        dialog.close(); assert.equal(dialog.open, false); mutation = { kind: boundary, closed: dialog };
      } else if (boundary === "target-replacement") {
        f.draw();
        const replacement = dialog.querySelector('.artifact-direct-editor textarea[rows="12"]');
        assert.equal(nodes(f, "dialog").find(node => hasClass(node, "document-artifact-view")), dialog);
        assert.equal(target.isConnected, false);
        assert.ok(replacement && replacement.isConnected && replacement !== target);
        assert.equal(replacement.value, target.value);
        mutation = { kind: boundary, replacement };
      } else if (boundary === "newer-draft") {
        const raw = "  A synchronous newer draft keeps its own caret and exact text.\n";
        target.value = raw; target.handlers.input.call(f.host, { target, currentTarget: target });
        assert.equal(target.value, raw); mutation = { kind: boundary, raw };
      } else {
        const next = tree(f).visible("button").find(row => row.port.handlers.click?.toString().includes("#cancelArtifactEdit"))?.port;
        assert.ok(next && !disabled(next) && next !== target);
        native.focus(next); assert.equal(native.document.activeElement, next);
        mutation = { kind: boundary, next };
      }
    });
    try { await chooseCurrent(x, "#startArtifactEdit"); } finally { observed.dispose(); }
    const arrival = requireOwnedEditArrival(observed);
    assert.equal(mutation?.kind, boundary, "this case reaches its own post-focus invalidation without relying on the positive case");
    assert.equal(native.nativeScroll.length, beforeScroll, "the invalidated arrival may not reveal any stale target or replacement");
    if (boundary === "focus-transfer") assert.equal(native.document.activeElement, mutation.next);
    if (boundary === "target-replacement") assert.equal(arrival.target.isConnected, false);
    if (boundary === "newer-draft") assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, mutation.raw);
    if (boundary === "source-retirement-event") assert.equal(nodes(f, "textarea").some(node => node.attributes.rows === "12"), false);
    if (mutation.closed) assert.equal(mutation.closed.open, false);
    unchanged(x);
  });
}
