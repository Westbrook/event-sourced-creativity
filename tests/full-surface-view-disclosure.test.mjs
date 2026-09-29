import assert from "node:assert/strict";
import test from "node:test";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../src/model/routes.ts";
import { createCalmFullPage, calmFullPageNativePorts, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installImageFormatNativeLifetime } from "./helpers/image-format-native-lifetime.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { installCreativeEditorNative } from "./helpers/creative-editor-command-fixture.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";

// Actual full Shell, StudioModeNav, shared native popover, Store and routed RAM
// Worker. Native DOM/URL ports are explicit: no browser/layout/AT certificate,
// provider request, production permission claim or replaced application method.
const locales = ["en", "fr", "ar", "ja"];
const expectedTrigger = {
  en: "Change view · {view}", fr: "Changer de vue · {view}",
  ar: "تغيير العرض · {view}", ja: "表示を変更 · {view}",
};
const views = [
  ["document", "Document", "/"], ["board", "Context board", "/studio/board"],
  ["guided", "Guided brief", "/studio/guided"], ["layers", "Reality layers", "/studio/layers"],
  ["adaptive", "Adaptive path", "/studio/adaptive"], ["editor", "Creative editor", "/studio/editor"],
  ["chat", "Chat", "/studio/chat"],
];
const hasClass = (node, value) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(value);
const under = (node, owner) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.component === owner) return true;
  return false;
};
function navigation(f) {
  const owners = f.components().filter(component => component.tag === "forma-studio-mode-nav");
  assert.equal(owners.length, 1, "one current navigation owner");
  return owners[0];
}
function viewMenu(f, nav = navigation(f)) {
  const owners = f.components().filter(component => component.tag === "forma-ui-popover"
    && component.parentElement === nav && hasClass(component, "studio-view-menu"));
  assert.equal(owners.length, 1, "one shared native menu replaces the lens strip");
  return owners[0];
}
const links = (f, menu) => f.tree().visible("a").filter(node =>
  node.owner === menu && Object.hasOwn(node.attributes, "data-studio-view"));
const nativeTrigger = (f, menu) => f.find("button", node => node.owner === menu && hasClass(node, "ui-popover-trigger"));
const taskLink = (f, key, labelKey = key) => {
  const nav = navigation(f);
  return f.find("a", node => node.owner === nav && hasClass(node, "studio-mode-family")
    && node.text === f.i18n.t("studio.family." + labelKey));
};
const exactRoute = (f, path) => {
  const p = f.store.projection.get();
  return withDocumentFocusInRoute(withDocumentInRoute(path, p.documentId, p.documentTitle),
    documentFocusFromRoute(f.store.route.get()));
};
const sourceSnapshot = f => {
  const p = f.store.projection.get();
  return JSON.stringify({ projectId: p.projectId, documentId: p.documentId, blocks: p.blocks,
    blockRelations: p.blockRelations, outputs: p.outputs, artifacts: p.artifacts });
};
const accountingSnapshot = f => Object.fromEntries(
  ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"]
    .map(table => [table, f.storeHost.worker.sqlite.prepare('SELECT * FROM "' + table + '"').all()]));
async function setup(t, options) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No undeclared network/provider in view navigation"));
  const f = await createCalmFullPage(t, options);
  // Observe only original current-source Resume reads through the real Worker.
  // An endpoint/body match alone never waives the no-write boundary below.
  const resume = observeActualSceneResumeReads(f.storeHost);
  t.after(() => {
    resume.restore();
    t.diagnostic(JSON.stringify({ kind: "original-view-resume-evidence", locale: f.locale, observations: resume.observations() }));
  });
  // The retained Editor port reads the complete next draw synchronously.
  // Register Chat and its real CEM descendants before that later route exists.
  await registerCalmFullPageComponents(f, ["forma-chat-studio"]);
  f.navigationDiagnostic = value => t.diagnostic(JSON.stringify(value));
  // Complete the existing literal descendant/native identity ports before the
  // narrower ImageFormat lifetime port; application focus/dirty guards stay real.
  f.native = installOutputNavigationFocusNative(t, f, calmFullPageNativePorts);
  const act = f.act;
  // A current native click begins with its own pointer/focus intent. Deliver
  // that before the original handler, never as a repair after its result.
  f.act = async (node, eventName = "click", event = {}) => {
    if (eventName === "click") { f.native.emit("pointerdown", node.port); f.native.focus(node.port); }
    return act(node, eventName, event);
  };
  // Register before ImageFormat's cleanup: unwind nested Editor FormData
  // wrappers newest-first, then let ImageFormat restore its original parent.
  const editors = new WeakSet(), editorCleanups = [], nativeFormData = globalThis.FormData;
  t.after(() => { for (const cleanup of editorCleanups.reverse()) cleanup(); });
  // Reuse the current ImageFormat native form/field owner, including children
  // registered after a later View choice; never replace departure predicates.
  installImageFormatNativeLifetime({ f, h: f.storeHost, after: callback => t.after(callback) });
  t.after(() => assert.equal(globalThis.FormData, nativeFormData, "all nested native form adapters restore their original parent"));
  // Later View changes mount the actual Editor. Bind its existing emitted
  // native fields after settling and before any following test interaction.
  const settle = f.settle;
  f.settle = async (...args) => {
    await settle(...args);
    const owners = f.components().filter(owner => owner.tag === "forma-creative-editor" && owner.isConnected && owner.store === f.store);
    assert.ok(owners.length <= 1, "at most one current same-Store Creative Editor");
    const fresh = owners.filter(owner => !editors.has(owner));
    for (const owner of fresh) {
      installCreativeEditorNative({ after: callback => editorCleanups.push(callback) }, f, owner);
      editors.add(owner);
    }
    if (fresh.length) await settle(...args);
    await resume.settleOriginalRequests(); // join already-started originals; never replay
  };
  // Existing Store navigation uses the browser URL port, not an app substitute.
  const previous = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) {
      const url = new URL(route, f.storeHost.location.origin);
      Object.assign(f.storeHost.location, { pathname: url.pathname, search: url.search, hash: url.hash });
    },
    replaceState(...args) { this.pushState(...args); },
  };
  t.after(() => { globalThis.history = previous; });
  assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()), true);
  const source = sourceSnapshot(f), accounting = accountingSnapshot(f), requestStart = f.storeHost.requests.length;
  f.assertNavigationOnly = () => {
    assert.equal(resume.pendingOriginalCount(), 0, "all original transports are terminal before safety assertions");
    assert.equal(sourceSnapshot(f), source, "view controls never edit context, result or review state");
    assert.deepEqual(accountingSnapshot(f), accounting, "existing job and financial rows remain exact");
    assert.deepEqual(f.storeHost.requests.slice(requestStart).filter(request =>
      !["GET", "HEAD"].includes(String(request.init.method ?? "GET").toUpperCase())
      && !resume.isReadOnlyResume(request)
      && !(request.url === "/api/generation-readiness" && request.init.method === "POST")), [],
    "only free readiness or an exact independently certified original read-only Resume may POST; no generation, approval, source write or retry");
  };
  // The reused presentation fixture assigns a synthetic slug to the real title.
  // Synchronize through the existing Store before any case opens a menu or types
  // raw work; same-view means the exact current URL, not a dirty-route exemption.
  const initialRoute = f.store.route.get(), initialSource = f.store.captureSourceOwnership(), canonicalRoute = exactRoute(f, "/");
  assert.equal(documentIdFromRoute(initialRoute), f.store.projection.get().documentId);
  await f.store.syncDocumentFromRoute(initialRoute);
  await f.settle();
  assert.equal(f.store.route.get(), canonicalRoute, "clean entry uses the current Document title's exact route");
  assert.equal(f.store.sourceOwnershipActive(initialSource), true, "canonical entry retains the original Source");
  f.assertNavigationOnly();
  return f;
}
async function openViews(f) {
  const nav = navigation(f), menu = viewMenu(f, nav), trigger = nativeTrigger(f, menu);
  assert.equal(links(f, menu).length, 0, "closed options do not join the resting controls");
  const active = views.find(([id]) => id === documentViewFromRoute(f.store.route.get()));
  assert.ok(active);
  assert.equal(trigger.text, expectedTrigger[f.locale].replace("{view}", f.i18n.system(active[1])));
  assert.equal(trigger.attributes["aria-expanded"], "false");
  assert.equal(typeof trigger.attributes.popovertarget, "string", "actual declarative native trigger");
  const route = f.store.route.get();
  trigger.port.click(); // first activation: current real trigger + native default
  await f.settle();
  const panel = f.tree().visible("section").find(node => node.owner === menu && node.attributes.popover === "auto");
  assert.ok(panel, "one browser-owned auto-dismiss panel, not a details overlay");
  assert.equal(nativeTrigger(f, menu).attributes["aria-expanded"], "true");
  assert.equal(f.store.route.get(), route, "opening a choice does not navigate");
  const choices = links(f, menu);
  assert.deepEqual(choices.map(node => node.attributes["data-studio-view"]), views.map(([id]) => id));
  assert.deepEqual(choices.filter(node => node.attributes["aria-current"] === "page")
    .map(node => node.attributes["data-studio-view"]), [active[0]]);
  for (const [id, label, path] of views) {
    const choice = choices.find(node => node.attributes["data-studio-view"] === id);
    assert.equal(choice.text, f.i18n.system(label));
    assert.equal(choice.attributes.href, exactRoute(f, path), "exact original Document and focus stay in every href");
  }
  return { nav, menu, panel };
}
async function chooseView(f, id) {
  const { menu } = await openViews(f);
  const choice = links(f, menu).find(node => node.attributes["data-studio-view"] === id), href = choice.attributes.href;
  let prevented = false;
  await f.act(choice, "click", { button: 0, preventDefault() { prevented = true; } }); // second activation
  assert.equal(prevented, true, "ordinary activation uses the existing Store route");
  if (f.store.route.get() !== href && documentViewFromRoute(f.store.route.get()) === "layers") {
    const layer = f.components().find(component => component.tag === "forma-reality-layers");
    const tree = f.tree(), emittedForm = tree.nodes.find(node => node.owner === layer && node.tag === "form" && hasClass(node, "layer-inspector"));
    const form = layer?.querySelector(".layer-inspector"), departure = layer?.captureCommandDeparture();
    const describe = node => node ? { tag: node.tag, name: node.getAttribute?.("name") ?? null, value: node.value, connected: node.isConnected } : null;
    const fields = ["handle", "instructions", "subtype", "weight"].map(name => {
      const emitted = tree.nodes.filter(node => {
        if (node.owner !== layer || node.attributes.name !== name) return false;
        for (let parent = node.parent; parent; parent = parent.parent) if (parent === emittedForm) return true;
        return false;
      });
      const queried = form?.querySelector('[name="' + name + '"]');
      return { name, emittedCount: emitted.length, emitted: emitted.map(node => describe(node.port)),
        queried: describe(queried), samePort: emitted.length === 1 && emitted[0].port === queried };
    });
    const block = f.store.projection.get().blocks.find(value => value.id === emittedForm?.attributes["data-layer-inspector"]);
    f.navigationDiagnostic({ kind: "layers-view-departure", locale: f.locale, requested: href, actual: f.store.route.get(),
      current: departure?.current(), blocked: departure?.blocked(), formMatchesEmitted: form === emittedForm?.port,
      formConnected: form?.isConnected, block: block ? { id: block.id, handle: block.handle, type: block.type, properties: block.properties } : null, fields });
  }
  assert.equal(f.store.route.get(), href);
  assert.equal(documentViewFromRoute(f.store.route.get()), id);
  const currentMenu = viewMenu(f);
  assert.equal(links(f, currentMenu).length, 0, "navigation does not carry an open old menu");
  const label = views.find(([value]) => value === id)[1];
  assert.equal(nativeTrigger(f, currentMenu).text, expectedTrigger[f.locale].replace("{view}", f.i18n.system(label)));
}

for (const locale of locales) test("all seven exact views remain two activations; useful task shortcuts stay direct " + locale, async t => {
  const f = await setup(t, { locale, assistant: false }), nav = navigation(f);
  const controls = f.tree().nodes.filter(node => !node.hiddenBy && ["a", "button"].includes(node.tag) && under(node, nav));
  assert.equal(controls.length, 6, "3 task links + Change view + Add context + Focus; structural count, not viewport measurement");
  assert.equal(controls.filter(node => node.tag === "a").length, 3);
  const focus = f.find("button", node => node.owner === nav && hasClass(node, "document-focus-toggle"));
  await f.act(focus);
  assert.equal(documentFocusFromRoute(f.store.route.get()), true);
  const documentId = f.store.projection.get().documentId;
  for (const [id] of views) {
    await chooseView(f, id);
    assert.equal(documentIdFromRoute(f.store.route.get()), documentId);
    assert.equal(documentFocusFromRoute(f.store.route.get()), true, "view choice preserves the explicit focused URL posture");
  }
  for (const [key, path] of [["write", "/"], ["shape", "/studio/board"], ["present", "/#output-title"]]) {
    const choice = taskLink(f, key), href = exactRoute(f, path);
    assert.equal(choice.attributes.href, href);
    await f.act(choice, "click", { button: 0 });
    assert.equal(f.store.route.get(), href, "the task shortcut is still a direct single activation");
    assert.equal(documentIdFromRoute(f.store.route.get()), documentId);
  }
  f.assertNavigationOnly();
});

for (const locale of locales) test("same-view disclosure and context picker preserve the unsent command " + locale, async t => {
  const f = await setup(t, { locale, assistant: false });
  const workspace = f.components().find(component => component.tag === "forma-workspace");
  const draft = "  Keep my unsent command café العربية 日本語.\nDo not submit this.  ";
  const field = f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
  field.port.value = draft;
  await f.act(field, "input");
  const route = f.store.route.get(), { menu } = await openViews(f);
  nativeTrigger(f, menu).port.click(); // ordinary current toggle closes, no retained callback
  await f.settle();
  assert.equal(links(f, menu).length, 0);
  assert.equal(f.store.route.get(), route);
  assert.equal(f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command").properties.value, draft);

  // Add context remains a direct, separate task; it is not buried in Change view.
  const nav = navigation(f);
  await f.act(f.find("button", node => node.owner === nav && hasClass(node, "context-set-trigger")));
  assert.equal(f.tree().visible("dialog").filter(node => node.owner === nav && hasClass(node, "context-set-picker-dialog")).length, 1);
  assert.equal(links(f, viewMenu(f)).length, 0);
  await f.act(f.find("button", node => node.owner === nav && hasClass(node, "modal-close")));
  assert.equal(f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command").properties.value, draft);
  assert.equal(f.store.route.get(), route);
  await chooseView(f, "document"); // fresh current choice works after both closures
  f.assertNavigationOnly();
});

for (const locale of locales) test("reader keeps direct Read and Present without a one-option change menu " + locale, async t => {
  // The existing full-page fixture supplies the read-only session tuple. This
  // asserts UI capability filtering, not a new backend/real-reader certificate.
  const f = await setup(t, { locale, reader: true }), nav = navigation(f);
  assert.equal(f.store.session.get().projectContext.permissions.includes("project.author"), false);
  assert.equal(f.components().filter(component => component.tag === "forma-ui-popover"
    && component.parentElement === nav && hasClass(component, "studio-view-menu")).length, 0);
  const controls = f.tree().nodes.filter(node => !node.hiddenBy && ["a", "button"].includes(node.tag) && under(node, nav));
  assert.equal(controls.length, 3, "Read, Present, Focus: no redundant single-choice control");
  assert.equal(controls.filter(node => hasClass(node, "context-set-trigger")).length, 0);
  const current = f.tree().visible("span").find(node => node.owner === nav && hasClass(node, "studio-current-view"));
  assert.equal(current.text, f.i18n.system("Document"));
  for (const [key, path] of [["present", "/#output-title"], ["write", "/"]]) {
    const link = taskLink(f, key, key === "write" ? "read" : key), href = exactRoute(f, path);
    await f.act(link, "click", { button: 0 });
    assert.equal(f.store.route.get(), href);
    assert.equal(documentViewFromRoute(f.store.route.get()), "document");
  }
  f.assertNavigationOnly();
});


const readerActionLabel = { en: "Read", fr: "Lire", ar: "قراءة", ja: "読む" };
for (const locale of locales) test("reader document action names the permitted task without implying authoring " + locale, async t => {
  const f = await setup(t, { locale, reader: true }), nav = navigation(f);
  const context = f.store.session.get().projectContext;
  assert.equal(context.permissions.includes("project.author"), false);
  assert.equal(f.components().filter(component => component.tag === "forma-ui-popover"
    && component.parentElement === nav && hasClass(component, "studio-view-menu")).length, 0);
  const controls = f.tree().nodes.filter(node => !node.hiddenBy && ["a", "button"].includes(node.tag) && under(node, nav));
  assert.equal(controls.length, 3, "two direct task links and Focus; no added reader capability");
  assert.equal(controls.filter(node => hasClass(node, "context-set-trigger")).length, 0);
  const current = f.tree().visible("span").find(node => node.owner === nav && hasClass(node, "studio-current-view"));
  assert.equal(current.text, f.i18n.system("Document"), "the current-view caption keeps its existing meaning");
  const observedLabels = [];
  for (const path of ["/#output-title", "/"]) {
    const href = exactRoute(f, path), owner = navigation(f);
    const choices = f.tree().visible("a").filter(node => node.owner === owner
      && hasClass(node, "studio-mode-family") && node.attributes.href === href);
    assert.equal(choices.length, 1, "locate the existing native task by exact destination, not desired copy");
    const link = choices[0];
    assert.ok(link.port.isConnected && !link.hiddenBy);
    assert.equal(typeof link.handlers.click, "function");
    assert.equal(link.port.handlers.click, link.handlers.click);
    let prevented = false;
    await f.act(link, "click", { button: 0, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(f.store.route.get(), href);
    assert.equal(documentViewFromRoute(f.store.route.get()), "document");
    assert.equal(f.store.session.get().projectContext.permissions.includes("project.author"), false);
    if (path === "/") observedLabels.push(link.text);
  }
  f.assertNavigationOnly();
  assert.deepEqual(observedLabels, [readerActionLabel[locale]],
    "reader task copy must not promise Write, while author navigation remains unchanged");
});

for (const locale of locales) test("current native anchors preserve modifier intent and close on a newer task route " + locale, async t => {
  const f = await setup(t, { locale });
  const { menu } = await openViews(f), route = f.store.route.get();
  for (const keys of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const link = links(f, menu).find(node => node.attributes["data-studio-view"] === "guided");
    let prevented = false;
    await f.act(link, "click", { button: 0, ...keys, preventDefault() { prevented = true; } });
    assert.equal(prevented, false, "browser link default remains available; no new-tab execution is simulated");
    assert.equal(f.store.route.get(), route, "modifier intent does not hijack the current task");
  }
  // A new visible task selection retires the old open view choice. No removed
  // callback, queued synthetic event or alleged physical race is invoked.
  const present = taskLink(f, "present"), href = present.attributes.href;
  await f.act(present, "click", { button: 0 });
  assert.equal(f.store.route.get(), href);
  assert.equal(links(f, viewMenu(f)).length, 0);
  await chooseView(f, "guided");
  f.assertNavigationOnly();
});

// Additive source/native-port controls. The shared full-page fixture does not
// compute CSS or simulate a coarse-pointer browser, physical input, or AT.
for (const locale of locales) test("E1 coarse-control contract: actual named wrapper and direct peers " + locale, async t => {
  const f = await setup(t, { locale, assistant: false }), nav = navigation(f);
  const menu = viewMenu(f, nav), trigger = nativeTrigger(f, menu);
  assert.equal(trigger.parent.tag, "div");
  assert.equal(hasClass(trigger.parent, "ui-popover"), true);
  assert.equal(trigger.parent.parent.component, menu, "the real native trigger is nested in the actual Popover host");
  const families = f.tree().visible("a").filter(node => node.owner === nav && hasClass(node, "studio-mode-family"));
  assert.equal(families.length, 3);
  for (const link of families) {
    assert.equal(hasClass(link.parent, "studio-mode-families"), true);
    assert.equal(hasClass(link.parent.parent, "studio-mode-nav"), true);
  }
  for (const name of ["context-set-trigger", "document-focus-toggle"]) {
    const button = f.find("button", node => node.owner === nav && hasClass(node, name));
    assert.equal(hasClass(button.parent, "studio-mode-nav"), true, "existing coarse rule reaches the direct button peer");
  }
  const route = f.store.route.get(), { panel } = await openViews(f);
  assert.equal(panel.attributes.popover, "auto");
  assert.equal(panel.attributes.id, nativeTrigger(f, menu).attributes.popovertarget);
  assert.equal(panel.parent.tag, "div");
  assert.equal(hasClass(panel.parent, "ui-popover"), true);
  assert.equal(panel.parent.children.filter(node => typeof node !== "string" && node.tag === "button").length, 1,
    "the top-layer panel is a sibling, not a second toolbar trigger");
  nativeTrigger(f, menu).port.click();
  await f.settle();
  assert.equal(links(f, menu).length, 0);
  assert.equal(f.store.route.get(), route);
  f.assertNavigationOnly();
});

async function studioMetricSources() {
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const postcss = createRequire(import.meta.resolve("vite"))("postcss");
  const paths = ["src/responsive-foundation.css", "src/components/studio-navigation.css"];
  return Object.fromEntries(await Promise.all(paths.map(async path =>
    [path, postcss.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"), { from: path })])));
}
const studioRules = sheet => { const result = []; sheet.walkRules(rule => result.push(rule)); return result; };
const studioDeclarations = rule => Object.fromEntries((rule?.nodes ?? [])
  .filter(node => node.type === "decl").map(node => [node.prop, node.value]));
const studioCoarseRules = sheet => studioRules(sheet).filter(rule => {
  for (let parent = rule.parent; parent; parent = parent.parent)
    if (parent.type === "atrule" && parent.name === "media" && parent.params === "(pointer: coarse)") return true;
  return false;
});
const studioCoarseDeclarations = (sheet, selector) => Object.assign({}, ...studioCoarseRules(sheet)
  .filter(rule => rule.selectors.includes(selector)).map(studioDeclarations));

test("E1 coarse-control contract: nested View and task links share the existing direct-peer floor", async () => {
  const sheets = await studioMetricSources(), responsive = sheets["src/responsive-foundation.css"];
  const view = sheets["src/components/studio-navigation.css"];
  const direct = studioCoarseDeclarations(responsive, ".studio-mode-nav > button");
  assert.equal(direct["min-block-size"], "var(--forma-hit-target-coarse)", "healthy current direct-button metric");
  const selectors = [
    ".studio-mode-nav > .studio-mode-families > a",
    ".studio-mode-nav .studio-view-menu > .ui-popover > .ui-popover-trigger",
  ];
  const floors = Object.fromEntries(selectors.map(selector => [selector, studioCoarseDeclarations(view, selector)["min-block-size"]]));
  assert.deepEqual(floors, Object.fromEntries(selectors.map(selector => [selector, direct["min-block-size"]])),
    "source contract: all actual same-strip action kinds use the existing coarse floor, not measured equal heights");
  assert.deepEqual(studioCoarseRules(view).flatMap(rule => rule.selectors), selectors,
    "the scoped correction excludes popover panels, menu choices, reader text, and other application buttons");
  for (const selector of selectors) assert.deepEqual(studioCoarseDeclarations(view, selector),
    { "min-block-size": direct["min-block-size"] }, "no fixed height, width, clipping, or new typography");
});

test("E1 coarse-control contract: compact workbench and scrolling contracts remain separate", async () => {
  const sheets = await studioMetricSources(), responsive = sheets["src/responsive-foundation.css"];
  const all = studioRules(responsive), values = selector => Object.assign({}, ...all
    .filter(rule => rule.selectors.includes(selector)).map(studioDeclarations));
  const compact = values('.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"] .studio-mode-nav');
  assert.equal(compact.display, "flex");
  assert.equal(compact["min-block-size"], "var(--forma-hit-target)");
  assert.equal(compact.gap, ".125rem", "keep the compact scroll-strip spacing, not its undersized historical ceiling");
  assert.equal(compact["overflow-x"], "auto");
  assert.equal(compact["overscroll-behavior-inline"], "contain");
  const chat = values(".application-creative .chat-view-page .studio-mode-nav");
  assert.equal(chat.display, "flex", "preserve the scroll-strip owner, not its too-small historical ceiling");
  assert.equal(chat["overflow-x"], "auto");
  assert.ok(all.some(rule => rule.selectors.includes(".studio-mode-nav")
    && studioDeclarations(rule)["grid-template-columns"] === "minmax(0, 1fr) var(--forma-hit-target) var(--forma-hit-target)"),
  "preserve the existing narrow columns without requiring fixed-height rows");
  const view = sheets["src/components/studio-navigation.css"];
  assert.ok(studioRules(view).some(rule => rule.selectors.includes(".studio-mode-nav .studio-view-options > a")
    && studioDeclarations(rule)["white-space"] === "normal"), "localized open-panel links may still wrap");
  assert.ok(!studioRules(view).some(rule => rule.selectors.includes(".studio-mode-nav")),
    "the supplement does not introduce a generic toolbar or content-frame layout owner");
});

test("E1 Chat fit contract: coarse landscape parent admits its native control floor and row flow", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const postcss = createRequire(import.meta.resolve("vite"))("postcss");
  const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
  const sheets = await studioMetricSources(), view = sheets["src/components/studio-navigation.css"];
  const responsive = sheets["src/responsive-foundation.css"];
  const [baseText, designText, chatSource] = await Promise.all([
    read("src/styles.css"), read("src/design-system.css"), read("src/components/forma-chat-studio.ts"),
  ]);
  const base = postcss.parse(baseText), design = postcss.parse(designText);
  const rootValues = (sheet, selector) => Object.assign({}, ...studioRules(sheet)
    .filter(rule => rule.parent.type === "root" && rule.selectors.includes(selector)).map(studioDeclarations));
  assert.equal(rootValues(base, "*")["box-sizing"], "border-box");
  assert.equal(rootValues(design, ".studio-mode-nav").padding, ".5rem var(--page-gutter)");
  assert.equal(rootValues(responsive, ".chat-view-page > .chat-view-main")["grid-template-rows"], "auto minmax(0, 1fr)",
    "the real header already has an intrinsic row; no new outer layout engine is needed");
  assert.ok(chatSource.includes('<section class="workspace-page studio-subpage chat-view-page">'));
  assert.ok(chatSource.includes('<forma-studio-mode-nav active="chat"></forma-studio-mode-nav>'));
  assert.equal(studioCoarseDeclarations(view,
    ".studio-mode-nav .studio-view-menu > .ui-popover > .ui-popover-trigger")["min-block-size"],
  "var(--forma-hit-target-coarse)", "the separately adjudicated coarse peer-floor supplement is installed first");
  const selector = ".application-creative .chat-view-page forma-studio-mode-nav > .studio-mode-nav";
  const matching = studioRules(view).filter(rule => rule.selectors.includes(selector));
  const actual = Object.assign({}, ...matching.map(studioDeclarations));
  assert.deepEqual(actual, {
    "min-block-size": "var(--forma-hit-target-coarse)", "max-block-size": "none", "flex-direction": "row",
  }, "desired source contract: admit the 3 rem children plus padding/border, without a new fixed ceiling or inherited narrow column");
  assert.equal(matching.length, 1);
  assert.equal(matching[0].parent.type, "atrule");
  assert.equal(matching[0].parent.name, "media");
  assert.equal(matching[0].parent.params, "(pointer: coarse) and (max-height: 37.5rem) and (orientation: landscape)");
  assert.deepEqual(matching[0].selectors, [selector], "only the actual short-landscape coarse Chat toolbar is changed");
  assert.equal(matching[0].parent.parent.type, "root");
});

test("E1 parent fit contract: existing narrow grid rows admit current native minima", async () => {
  const sheets = await studioMetricSources(), responsive = sheets["src/responsive-foundation.css"];
  const view = sheets["src/components/studio-navigation.css"];
  const narrow = responsive.nodes.filter(node => node.type === "atrule" && node.name === "media"
    && node.params === "(max-width: 47.99rem)"
    && studioRules(node).some(rule => rule.selectors.includes(".studio-mode-nav")));
  assert.equal(narrow.length, 1, "reuse the actual existing narrow toolbar boundary");
  const baseline = Object.assign({}, ...studioRules(narrow[0])
    .filter(rule => rule.selectors.includes(".studio-mode-nav")).map(studioDeclarations));
  assert.equal(baseline.display, "grid");
  assert.equal(baseline["grid-template-columns"], "minmax(0, 1fr) var(--forma-hit-target) var(--forma-hit-target)");
  assert.equal(baseline.gap, ".25rem");
  assert.equal(studioCoarseDeclarations(responsive, ".studio-mode-nav > button")["min-block-size"],
    "var(--forma-hit-target-coarse)");
  assert.equal(studioCoarseDeclarations(view,
    ".studio-mode-nav .studio-view-menu > .ui-popover > .ui-popover-trigger")["min-block-size"],
  "var(--forma-hit-target-coarse)", "the actual nested View peer uses the separately reviewed coarse floor");
  const selector = "forma-studio-mode-nav > .studio-mode-nav";
  const matching = studioRules(view).filter(rule => rule.selectors.includes(selector));
  assert.equal(matching.length, 1, "desired source contract: one scoped intrinsic-row correction");
  assert.deepEqual(studioDeclarations(matching[0]), {
    "grid-template-rows": "repeat(2, minmax(var(--forma-hit-target), auto))",
  }, "the row floor may grow for actual children; no fixed height, clipping or smaller control minimum");
  assert.deepEqual(matching[0].selectors, [selector]);
  assert.equal(matching[0].parent.type, "atrule");
  assert.equal(matching[0].parent.name, "media");
  assert.equal(matching[0].parent.params, "(max-width: 47.99rem)");
  assert.equal(matching[0].parent.parent.type, "root");
  const childValues = selector => Object.assign({}, ...studioRules(narrow[0])
    .filter(rule => rule.selectors.includes(selector)).map(studioDeclarations));
  assert.equal(childValues(".studio-mode-nav > .studio-mode-families")["overflow-x"], "auto");
  assert.equal(childValues(".studio-mode-nav > .studio-mode-families")["grid-row"], "1");
  assert.equal(childValues(".studio-mode-nav > .studio-mode-links")["grid-row"], "2");
});

test("E1 parent fit contract: padded compact workbench keeps natural horizontal flow", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const postcss = createRequire(import.meta.resolve("vite"))("postcss");
  const sheets = await studioMetricSources(), responsive = sheets["src/responsive-foundation.css"];
  const view = sheets["src/components/studio-navigation.css"];
  const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
  const [baseText, designText, workspace] = await Promise.all([
    read("src/styles.css"), read("src/design-system.css"), read("src/components/forma-workspace.ts"),
  ]);
  const rootValues = (sheet, selector) => Object.assign({}, ...studioRules(sheet)
    .filter(rule => rule.parent.type === "root" && rule.selectors.includes(selector)).map(studioDeclarations));
  assert.equal(rootValues(postcss.parse(baseText), "*")["box-sizing"], "border-box");
  assert.equal(rootValues(postcss.parse(designText), ".studio-mode-nav").padding, ".5rem var(--page-gutter)");
  assert.ok(workspace.includes("<forma-studio-mode-nav"), "the actual Workspace renders this shared toolbar host");
  const owners = [
    '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"]',
    '.application-creative[data-short-height="true"][data-layout-intent="workbench"]',
  ];
  const selectors = owners.map(owner => owner + " forma-studio-mode-nav > .studio-mode-nav");
  for (const owner of owners) {
    const existing = rootValues(responsive, owner + " .studio-mode-nav");
    assert.equal(existing.display, "flex");
    assert.equal(existing["min-block-size"], "var(--forma-hit-target)");
    assert.equal(existing["overflow-x"], "auto");
    assert.equal(existing["overscroll-behavior-inline"], "contain");
  }
  const matching = studioRules(view).filter(rule => rule.selectors.some(selector => selectors.includes(selector)));
  assert.equal(matching.length, 1, "desired source contract: one shared correction for the two actual workbench postures");
  assert.deepEqual(matching[0].selectors, selectors);
  assert.equal(matching[0].parent.type, "root");
  assert.deepEqual(studioDeclarations(matching[0]), {
    "max-block-size": "none", "flex-direction": "row",
  }, "fit children plus existing padding; do not replace the cap with another fixed height or clip overflow");
  assert.ok(!matching[0].selectors.some(selector => selector.includes("chat-view-page") || selector.includes("ui-popover-panel")),
    "Chat's separate fit rule and the native top-layer panel retain their own owners");
});

for (const locale of ["en", "ja"]) test("current view menu refuses raw departure until deliberate clear " + locale, async t => {
  const f = await setup(t, { locale, assistant: false });
  const workspace = f.components().find(component => component.tag === "forma-workspace");
  assert.ok(workspace?.isConnected, "actual current Document owner");
  const raw = "  Unsent direction café العربية 日本語.\nKeep this exact local value.  ";
  let field = f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
  assert.ok(field.port.isConnected && !field.port.disabled);
  field.port.value = raw;
  await f.act(field, "input");
  const route = f.store.route.get(), documentId = f.store.projection.get().documentId;
  const source = f.store.captureSourceOwnership();
  const { menu, panel } = await openViews(f);
  assert.equal(nativeTrigger(f, menu).attributes.popovertarget, panel.attributes.id,
    "the real menu panel and exact native invoker are paired");
  const choice = links(f, menu).find(node => node.attributes["data-studio-view"] === "guided");
  assert.ok(choice?.port.isConnected);
  const href = choice.attributes.href;
  assert.notEqual(href, route, "this choice would actually replace the current view");
  let prevented = false;
  await f.act(choice, "click", { button: 0, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.store.route.get(), route, "dirty current work refuses the different view");
  assert.ok(workspace.isConnected && f.components().includes(workspace));
  field = f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
  assert.ok(field.port.isConnected && !field.port.disabled);
  assert.equal(field.properties.value, raw);
  assert.equal(field.port.value, raw, "reacquire the current native field, not a detached port");
  assert.equal(viewMenu(f), menu);
  assert.equal(nativeTrigger(f, menu).attributes["aria-expanded"], "true",
    "a refused departure does not close the menu before origin admission");
  assert.equal(links(f, menu).length, views.length);
  assert.ok(f.store.sourceOwnershipActive(source));
  f.assertNavigationOnly();

  field.port.value = "";
  await f.act(field, "input");
  const cleared = f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
  assert.equal(cleared.properties.value, "");
  assert.equal(cleared.port.value, "");
  const liveMenu = viewMenu(f);
  const liveChoice = links(f, liveMenu).find(node => node.attributes["data-studio-view"] === "guided");
  assert.ok(liveChoice?.port.isConnected);
  assert.equal(liveChoice.attributes.href, href, "clear admits the same exact public choice");
  await f.act(liveChoice, "click", { button: 0 });
  assert.equal(f.store.route.get(), href);
  assert.equal(documentIdFromRoute(f.store.route.get()), documentId);
  assert.equal(documentViewFromRoute(f.store.route.get()), "guided");
  assert.equal(links(f, viewMenu(f)).length, 0, "the admitted choice closes its old menu");
  assert.ok(f.store.sourceOwnershipActive(source));
  f.assertNavigationOnly();
});

test("focused Document Escape yields to an open native overlay or an already consumed key", async t => {
  const f = await setup(t, { locale: "en", assistant: false }), nav = navigation(f);
  const workspace = f.components().find(component => component.tag === "forma-workspace");
  assert.ok(workspace?.isConnected);
  const source = f.store.captureSourceOwnership(), initialRoute = f.store.route.get();
  const focusControl = () => f.find("button", node => node.owner === nav && hasClass(node, "document-focus-toggle"));
  const outsideControl = () => f.find("button", node => node.owner === nav && hasClass(node, "context-set-trigger"));
  const command = () => f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
  const raw = command().port.value;
  // The shared query port does not interpret this pseudo. Resolve only this
  // exact native query from emitted popover attributes and its existing native
  // open-state matcher; do not supply a desired result or alter other cases.
  const query = f.renderer.query;
  f.renderer.query = (owner, selector) => selector === ":popover-open"
    ? query.call(f.renderer, owner, "[popover]").filter(node => node.matches(":popover-open"))
    : query.call(f.renderer, owner, selector);
  t.after(() => { f.renderer.query = query; });
  const posture = () => ({
    route: f.store.route.get(),
    focused: documentFocusFromRoute(f.store.route.get()),
    reflected: f.native.document.documentElement.hasAttribute("data-document-focus"),
    pressed: String(focusControl().attributes["aria-pressed"]),
  });
  const sameWork = () => {
    assert.equal(navigation(f), nav); assert.ok(nav.isConnected && workspace.isConnected);
    assert.equal(f.store.sourceOwnershipActive(source), true);
    const current = command(); assert.ok(current.port.isConnected);
    assert.equal(current.port.value, raw); assert.equal(current.properties.value, raw);
    f.assertNavigationOnly();
  };
  const key = (target, consumed = false) => {
    assert.ok(target.isConnected && f.renderer.nodes.includes(target));
    assert.equal(target.matches(":disabled"), false);
    f.native.focus(target);
    const row = f.tree().nodes.find(node => node.port === target); assert.ok(row);
    const path = [];
    for (let current = row; current; current = current.parent) {
      const element = current.port ?? current.component;
      if (element && !path.includes(element)) path.push(element);
    }
    path.push(f.native.document, calmFullPageNativePorts.windowPort);
    const event = { type: "keydown", key: "Escape", target, currentTarget: calmFullPageNativePorts.windowPort,
      isComposing: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      defaultPrevented: false, composedPath: () => path,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    if (consumed) event.preventDefault(); // declared prior consumer, not browser timing evidence
    const callbacks = [...(f.listeners.get("keydown") ?? [])];
    assert.ok(callbacks.length >= 2, "the complete Shell and Studio register their original listeners");
    for (const callback of callbacks) callback(event);
    return event;
  };

  assert.equal(posture().focused, false);
  assert.equal(f.native.document.querySelector("dialog[open], :popover-open"), null);
  await f.act(focusControl());
  assert.deepEqual(posture(), { route: withDocumentFocusInRoute(initialRoute, true),
    focused: true, reflected: true, pressed: "true" });
  assert.equal(workspace.captureCommandDeparture().blocked(), false, "clean work cannot mask an Escape route");
  const normal = key(outsideControl().port); await f.settle();
  assert.equal(normal.defaultPrevented, false);
  assert.deepEqual(posture(), { route: initialRoute, focused: false, reflected: false, pressed: "false" },
    "an unconsumed Escape without an overlay still runs the actual focus-exit handler");
  sameWork();

  await f.act(focusControl());
  const focused = posture(); assert.equal(focused.focused, true);
  await f.act(outsideControl());
  const dialog = f.tree().visible("dialog").find(node => node.owner === nav && hasClass(node, "context-set-picker-dialog"));
  assert.ok(dialog?.port.open);
  assert.equal(f.native.document.querySelector("dialog[open]"), dialog.port);
  const close = f.find("button", node => node.owner === nav && hasClass(node, "modal-close"));
  const modalKey = key(close.port); await f.settle();
  assert.equal(modalKey.defaultPrevented, false);
  assert.deepEqual(posture(), focused, "the existing native-dialog exclusion remains intact");
  assert.ok(f.native.document.querySelector("dialog[open]"), "no native dialog default is fabricated by the Window port");
  await f.act(f.find("button", node => node.owner === nav && hasClass(node, "modal-close")));
  assert.equal(f.native.document.querySelector("dialog[open], :popover-open"), null);
  sameWork();

  assert.equal(workspace.captureCommandDeparture().blocked(), false);
  const beforeConsumed = posture(), consumedKey = key(outsideControl().port, true);
  await f.settle();
  const consumed = { retained: JSON.stringify(posture()) === JSON.stringify(beforeConsumed),
    defaultPrevented: consumedKey.defaultPrevented };
  sameWork();
  // A later real Focus-button gesture starts the independent open-View check.
  // The preceding result is already recorded and cannot be repaired by it.
  if (!posture().focused) await f.act(focusControl());
  assert.equal(posture().focused, true);
  const trigger = nativeTrigger(f, viewMenu(f));
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
  const { menu, panel } = await openViews(f);
  assert.equal(f.native.document.querySelector(":popover-open"), panel.port);
  assert.equal(f.native.document.querySelector("dialog[open]"), null);
  const outside = outsideControl();
  assert.equal(hasClass(outside.parent, "studio-mode-nav"), true);
  assert.equal(under(outside, menu), false, "the real direct peer is outside the popover keydown subtree");
  assert.equal(workspace.captureCommandDeparture().blocked(), false);
  const beforeOpen = posture(), hrefs = links(f, menu).map(node => node.attributes.href);
  const overlayKey = key(outside.port); await f.settle();
  const currentPanel = viewMenu(f).querySelector(".ui-popover-panel"); assert.ok(currentPanel?.isConnected);
  const open = { retained: JSON.stringify(posture()) === JSON.stringify(beforeOpen),
    panelStillOpen: currentPanel.matches(":popover-open"),
    hrefsRetained: JSON.stringify(links(f, viewMenu(f)).map(node => node.attributes.href)) === JSON.stringify(hrefs),
    defaultPrevented: overlayKey.defaultPrevented };
  sameWork();
  // The finite Window port intentionally does not run the UA Escape default.
  // Close through the actual current trigger only after recording app behavior.
  if (currentPanel.matches(":popover-open")) {
    nativeTrigger(f, viewMenu(f)).port.click(); await f.settle();
  }
  assert.equal(f.native.document.querySelector("dialog[open], :popover-open"), null);
  sameWork();
  t.diagnostic(JSON.stringify({ kind: "focused-document-overlay-escape", open, consumed,
    boundary: "original full-class Window callbacks and native state ports; no UA Escape, Tab, focus-return, paint or keyboard certificate" }));
  assert.deepEqual({ open, consumed }, {
    open: { retained: true, panelStillOpen: true, hrefsRetained: true, defaultPrevented: false },
    consumed: { retained: true, defaultPrevented: true },
  }, "outside-open and already-consumed Escape must not also change the focused Document route");
});

test("E3 compact Studio source policy: one intrinsic scroll strip keeps native paint inside its budget", async () => {
  // Declaration/owner checks only. R1 actual 44px family clips and 147px
  // Document pane motivate this case; it is not a native geometry certificate.
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const postcss = createRequire(import.meta.resolve("vite"))("postcss");
  const sheets = await studioMetricSources(), responsive = sheets["src/responsive-foundation.css"];
  const view = sheets["src/components/studio-navigation.css"];
  const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
  const [baseText, designText, studio] = await Promise.all([
    read("src/styles.css"), read("src/design-system.css"), read("src/components/studio-navigation.ts"),
  ]);
  const rootValues = (sheet, selector) => Object.assign({}, ...studioRules(sheet)
    .filter(rule => rule.parent.type === "root" && rule.selectors.includes(selector)).map(studioDeclarations));
  const inheritedWidth = studioRules(postcss.parse(baseText)).filter(rule =>
    rule.selectors.includes(".studio-mode-nav > div") && rule.parent.type === "atrule"
    && rule.parent.name === "media" && rule.parent.params === "(max-width: 760px)");
  assert.equal(inheritedWidth.length, 1);
  assert.equal(studioDeclarations(inheritedWidth[0]).width, "100%", "the old independent rows contribute a real inherited width");
  assert.equal(rootValues(postcss.parse(designText), ".studio-mode-nav").padding, ".5rem var(--page-gutter)");
  assert.deepEqual(rootValues(responsive, ".studio-mode-links"), {
    "margin-block": "-8px", "padding-block": "8px",
    "padding-inline": "var(--forma-focus-clearance)", "scroll-padding-inline": "var(--forma-focus-clearance)",
  }, "the prior inner scroll owner still carries its own clearance");
  for (const markup of ['<div class="studio-mode-families" role="group"', '<div class="studio-mode-links">',
    '<forma-ui-popover class="studio-view-menu"', 'class="context-set-trigger"', 'class="document-focus-toggle"'])
    assert.ok(studio.includes(markup), "the existing native owner remains in current source: " + markup);
  const oldOwners = [
    '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"]',
    '.application-creative[data-short-height="true"][data-layout-intent="workbench"]',
  ];
  for (const owner of oldOwners) {
    const strip = rootValues(responsive, owner + " .studio-mode-nav");
    assert.equal(strip.display, "flex");
    assert.equal(strip["min-block-size"], "var(--forma-hit-target)");
    assert.equal(strip["overflow-x"], "auto");
    assert.equal(strip["overscroll-behavior-inline"], "contain");
    const groups = rootValues(responsive, owner + " .studio-mode-nav > :is(.studio-mode-families, .studio-mode-links)");
    assert.equal(groups["min-inline-size"], "max-content");
    assert.equal(groups.flex, "0 0 auto");
    assert.deepEqual(rootValues(view, owner + " forma-studio-mode-nav > .studio-mode-nav"),
      { "max-block-size": "none", "flex-direction": "row" }, "retain the earlier natural-parent correction byte-for-byte");
  }
  assert.equal(rootValues(responsive, ".studio-mode-nav a")["min-block-size"], "var(--forma-hit-target)");
  assert.equal(studioCoarseDeclarations(responsive, ".studio-mode-nav > button")["min-block-size"], "var(--forma-hit-target-coarse)");
  for (const selector of [".studio-mode-nav > .studio-mode-families > a",
    ".studio-mode-nav .studio-view-menu > .ui-popover > .ui-popover-trigger"])
    assert.equal(studioCoarseDeclarations(view, selector)["min-block-size"], "var(--forma-hit-target-coarse)");
  const inset = "calc(-1 * var(--forma-focus-ring-width, .1875rem))";
  assert.equal(rootValues(responsive, ".document-workbench-tasks > button:focus-visible")["outline-offset"], inset,
    "reuse the existing native scroll-strip paint policy, not a new ring style");
  assert.equal(rootValues(view, ".studio-mode-nav .studio-view-options > a")["white-space"], "normal",
    "the native top-layer options retain their independent wrapping policy");

  const owner = '.application-creative[data-layout-intent="workbench"]:is([data-nav-posture="compact"], [data-short-height="true"])';
  const strip = owner + " forma-studio-mode-nav > .studio-mode-nav";
  const desired = [
    [strip, { "padding-block": "var(--forma-space-1, .25rem)", "scroll-padding-inline": "var(--forma-focus-clearance)" }],
    [strip + " > :is(.studio-mode-families, .studio-mode-links)",
      { "inline-size": "auto", overflow: "visible", "scroll-padding-inline": "0" }],
    [strip + " > .studio-mode-links", { "margin-block": "0", padding: "0" }],
  ];
  for (const [selector, declarations] of desired) {
    const matching = studioRules(view).filter(rule => rule.selectors.includes(selector));
    assert.equal(matching.length, 1, "desired compact source policy: " + selector);
    assert.equal(matching[0].parent.type, "root");
    assert.deepEqual(matching[0].selectors, [selector]);
    assert.deepEqual(studioDeclarations(matching[0]), declarations,
      "only intrinsic sizing and duplicate clearance change; no control/font/height ceiling");
  }
  const focusSelectors = [
    strip + " > .studio-mode-families > a:focus-visible",
    strip + " > .studio-mode-links > .studio-view-menu > .ui-popover > .ui-popover-trigger:focus-visible",
    strip + " > button:focus-visible",
  ];
  const paint = studioRules(view).filter(rule => rule.selectors.some(selector => focusSelectors.includes(selector)));
  assert.equal(paint.length, 1);
  assert.equal(paint[0].parent.type, "root");
  assert.deepEqual(paint[0].selectors, focusSelectors, "only native strip peers, never the promoted panel or its options");
  assert.deepEqual(studioDeclarations(paint[0]), { "outline-offset": inset },
    "preserve width, color and forced-colors Highlight while drawing the existing ring inward");
});

test("E3 action labels keep their containing block in the native toolbar button", async t => {
  // Actual emitted ownership plus source policy only; the retained R2 native
  // 464px/393px overflow and an unchanged full browser replay own geometry.
  const f = await setup(t, { locale: "en", assistant: false }), nav = navigation(f);
  const tree = f.tree();
  for (const name of ["context-set-trigger", "document-focus-toggle"]) {
    const buttons = tree.visible("button").filter(node => node.owner === nav && hasClass(node, name));
    assert.equal(buttons.length, 1, "one current native action: " + name);
    const button = buttons[0];
    assert.equal(hasClass(button.parent, "studio-mode-nav"), true);
    assert.equal(button.attributes.type, "button");
    assert.ok(button.port.isConnected && !button.port.disabled);
    assert.equal(typeof button.handlers.click, "function", "retain the original native action binding");
    const labels = tree.visible("span").filter(node => node.owner === nav
      && node.parent === button && hasClass(node, "studio-mode-action-label"));
    assert.equal(labels.length, 1, "the existing text label is a direct child of its own button");
    assert.ok(labels[0].text.trim(), "retain the current label, not display:none or removed copy");
  }
  f.assertNavigationOnly();

  const sheets = await studioMetricSources(), responsive = sheets["src/responsive-foundation.css"];
  const view = sheets["src/components/studio-navigation.css"];
  const selector = ".studio-mode-nav > :is(.context-set-trigger, .document-focus-toggle)";
  const hidden = studioRules(responsive).filter(rule => rule.selectors.includes(selector + " .studio-mode-action-label")
    && rule.parent.type === "atrule" && rule.parent.name === "media"
    && rule.parent.params === "(max-width: 30rem), (max-height: 24rem) and (orientation: landscape)");
  assert.equal(hidden.length, 1, "the reached compact label policy already exists");
  const hiddenValues = studioDeclarations(hidden[0]);
  assert.equal(hiddenValues.position, "absolute");
  assert.equal(hiddenValues["inline-size"], "1px");
  assert.equal(hiddenValues["block-size"], "1px");
  assert.equal(hiddenValues.overflow, "hidden");
  assert.equal(hiddenValues["clip-path"], "inset(50%)");
  assert.equal(studioCoarseDeclarations(responsive, ".studio-mode-nav > button")["min-block-size"],
    "var(--forma-hit-target-coarse)", "no smaller coarse native action");
  for (const owner of [
    '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"]',
    '.application-creative[data-short-height="true"][data-layout-intent="workbench"]',
  ]) {
    const strip = Object.assign({}, ...studioRules(responsive)
      .filter(rule => rule.parent.type === "root" && rule.selectors.includes(owner + " .studio-mode-nav"))
      .map(studioDeclarations));
    assert.equal(strip["overflow-x"], "auto", "retain the real horizontal scroll owner");
    assert.equal(strip["min-block-size"], "var(--forma-hit-target)");
  }
  const matching = studioRules(view).filter(rule => rule.selectors.includes(selector));
  assert.equal(matching.length, 1, "desired local containing block for the two actual action-label owners");
  assert.equal(matching[0].parent.type, "root", "all existing label-collapse variants retain their own control owner");
  assert.deepEqual(matching[0].selectors, [selector], "exclude the View popover and all unrelated controls");
  assert.deepEqual(studioDeclarations(matching[0]), { position: "relative" },
    "bind absolute labels only; no size, inset, overflow, ring, font or focus-policy change");
});

test("current closed View keyboard focus reveals only its owned horizontal strip", async t => {
  // Conditional after the R2 containing-block correction's real replay. These
  // are declared R2 EN200 ports, not measured repaired geometry or native Tab.
  const f = await setup(t, { locale: "en", assistant: false }), nav = navigation(f), native = f.native;
  const workspace = f.components().find(owner => owner.tag === "forma-workspace");
  assert.ok(workspace?.isConnected);
  const ask = () => f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
  const raw = ask().port.value, route = f.store.route.get(), source = f.store.captureSourceOwnership();
  const sameWork = () => {
    assert.equal(navigation(f), nav); assert.ok(nav.isConnected && workspace.isConnected);
    assert.equal(f.store.sourceOwnershipActive(source), true);
    assert.equal(ask().port.value, raw); assert.equal(ask().properties.value, raw);
    f.assertNavigationOnly();
  };
  const observed = [], view = native.document.defaultView;
  let overflowX = "auto";
  const deliver = (label, { focusVisible = true, disabled = false, focusLeft = false, handler: retainedHandler } = {}) => {
    const menu = viewMenu(f, nav), tree = f.tree(), trigger = nativeTrigger(f, menu);
    const strips = tree.visible("nav").filter(node => node.owner === nav && hasClass(node, "studio-mode-nav"));
    assert.equal(strips.length, 1); const strip = strips[0].port;
    const panel = menu.querySelector(".ui-popover-panel");
    assert.ok(menu.isConnected && trigger.port.isConnected && panel?.isConnected && strip.isConnected);
    assert.equal(trigger.port.tagName, "BUTTON");
    assert.equal(trigger.port.ownerDocument, native.document);
    assert.equal(menu.querySelectorAll(".ui-popover-trigger").length, 1);
    assert.equal(menu.querySelector(".ui-popover-trigger"), trigger.port);
    assert.equal(trigger.port.getAttribute("popovertarget"), panel.getAttribute("id"));
    assert.equal(strip.contains(menu), true); assert.equal(strip.closest("forma-studio-mode-nav"), nav);
    assert.equal(strip.querySelector(".ui-popover-trigger"), trigger.port);
    const previousRect = strip.getBoundingClientRect, previousTargetRect = trigger.port.getBoundingClientRect;
    const previousMatches = trigger.port.matches, previousDisabled = trigger.port.disabled;
    const originalStyle = view.getComputedStyle;
    // Start each declared native event with the observed R2 x-clip. Projection
    // below models only this finite horizontal scroll; it is not UA layout.
    strip.scrollLeft = 0; strip.scrollTop = 0;
    strip.getBoundingClientRect = () => ({ left: 72, right: 419, top: 141, bottom: 193, width: 347, height: 52 });
    trigger.port.getBoundingClientRect = () => ({ left: 270.484375 - strip.scrollLeft,
      right: 465.6953125 - strip.scrollLeft, top: 145, bottom: 189, width: 195.2109375, height: 44 });
    trigger.port.matches = function(selector) { return selector === ":focus-visible" ? focusVisible : previousMatches.call(this, selector); };
    native.focus(focusLeft ? ask().port : trigger.port);
    trigger.port.disabled = disabled; // deliberate native disabled-state input, never a desired result
    const path = [];
    for (let row = trigger; row; row = row.parent) {
      // A custom-element row also has a collected markup port. Native events
      // pass through its actual class instance, as the existing closest port does.
      const port = row.component ?? row.port; if (port && !path.includes(port)) path.push(port);
    }
    path.push(native.document);
    assert.equal(path[0], trigger.port); assert.ok(path.includes(menu) && path.includes(strip));
    const active = native.document.activeElement, focusAt = native.nativeFocus.length, scrollAt = native.nativeScroll.length;
    const currentRoute = f.store.route.get(), panelWasOpen = panel.matches(":popover-open");
    const handler = retainedHandler ?? menu.eventBindings?.focusin;
    const event = { type: "focusin", target: trigger.port, currentTarget: menu, composedPath: () => path,
      preventDefault() { assert.fail("native focus is not canceled"); }, stopPropagation() { assert.fail("native focus is not intercepted"); } };
    // Deliver only the actual current EventPart when present. Old runtime has
    // no handler and must reach the final desired x-scroll vector, not fail a
    // prerequisite or manufacture component bubbling in the generic port.
    let result;
    try {
      view.getComputedStyle = function(element) {
        const style = originalStyle.call(this, element);
        return element === strip ? { ...style, overflowX } : style;
      };
      result = typeof handler === "function" ? handler.call(nav, event) : undefined;
    }
    finally {
      view.getComputedStyle = originalStyle; strip.getBoundingClientRect = previousRect;
      trigger.port.getBoundingClientRect = previousTargetRect; trigger.port.matches = previousMatches;
      trigger.port.disabled = previousDisabled;
    }
    assert.equal(result, undefined); assert.equal(native.document.activeElement, active);
    assert.equal(native.nativeFocus.length, focusAt); assert.equal(native.nativeScroll.length, scrollAt);
    assert.equal(strip.scrollTop, 0, "the actual method never requests vertical reveal");
    assert.equal(f.store.route.get(), currentRoute); assert.equal(panel.matches(":popover-open"), panelWasOpen);
    sameWork();
    observed.push({ label, left: strip.scrollLeft });
    return handler;
  };

  assert.equal(viewMenu(f).querySelector(".ui-popover-panel").matches(":popover-open"), false);
  deliver("current");
  deliver("not-focus-visible", { focusVisible: false });
  deliver("disabled", { disabled: true });
  deliver("focus-left", { focusLeft: true });
  overflowX = "visible"; deliver("not-scroll-owner"); overflowX = "auto";
  const opening = nativeTrigger(f, viewMenu(f)); native.emit("pointerdown", opening.port); native.focus(opening.port);
  const opened = await openViews(f); assert.equal(opened.panel.port.matches(":popover-open"), true);
  deliver("open-panel");
  nativeTrigger(f, viewMenu(f)).port.click(); await f.settle(); sameWork();
  const stale = viewMenu(f).eventBindings?.focusin;
  // A real Store route change can retire an old callback before the next draw.
  // Keep the existing connected native owner; never fake isConnected or restore
  // its old route to make a stale delivery current.
  f.store.route.set(route + "#retired-view-reveal");
  deliver("stale-route", { handler: stale });
  assert.equal(f.store.route.get(), route + "#retired-view-reveal");
  t.diagnostic(JSON.stringify({ kind: "owned-view-horizontal-reveal", observed,
    boundary: "original EventPart, declared R2 x-geometry/focus-visible/native overflow ports; no UA scrolling, repaired viewport, Tab or paint certificate" }));
  assert.deepEqual(observed, [
    { label: "current", left: 54.6953125 },
    ...["not-focus-visible", "disabled", "focus-left", "not-scroll-owner", "open-panel", "stale-route"].map(label => ({ label, left: 0 })),
  ], "only a current closed keyboard trigger may adjust its own horizontal scroll owner");
});
