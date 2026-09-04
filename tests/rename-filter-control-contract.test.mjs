import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test, { after } from "node:test";
import { createCalmFullPage } from "./helpers/calm-full-page-fixture.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";

// Static CSS declarations plus actual full-class controls under the existing
// finite native ports. These tests do not measure CSS pixels, wrapping or AT.
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
const [responsiveText, designText, workspaceText, libraryText] = await Promise.all([
  "src/responsive-foundation.css", "src/design-system.css", "src/components/forma-workspace.ts", "src/components/forma-library.ts",
].map(read));
const responsive = postcss.parse(responsiveText), design = postcss.parse(designText);
function rule(sheet, selector) {
  const result = {}; let count = 0;
  sheet.walkRules(current => {
    if (current.parent.type !== "root" || !current.selectors.includes(selector)) return;
    count++;
    for (const item of current.nodes) if (item.type === "decl") result[item.prop] = item.value;
  });
  assert.ok(count, "current unconditional selector: " + selector); return result;
}
function noCeiling(value) {
  for (const key of ["height", "block-size", "max-height", "max-block-size", "overflow", "text-overflow", "line-clamp", "-webkit-line-clamp"])
    assert.equal(value[key], undefined, "a target floor must not hide or cap content: " + key);
}

test("E rename controls declare the shared growing floor and content-width wrapping without changing the form", () => {
  const group = rule(responsive, ".document-title-editor"), input = rule(responsive, ".document-title-editor > input");
  const peers = rule(responsive, ".document-title-editor > .button");
  assert.equal(group["min-inline-size"], "0"); assert.equal(group["flex-wrap"], "wrap");
  assert.equal(group["align-items"], "stretch"); assert.equal(group.gap, "var(--forma-cluster-gap)");
  assert.equal(input["min-height"], "var(--forma-hit-target)"); assert.equal(input["min-block-size"], input["min-height"]);
  assert.equal(input.flex, "1 1 min(100%, 16rem)"); assert.equal(input["min-inline-size"], "0");
  assert.equal(input["max-inline-size"], "100%"); assert.equal(peers.flex, "0 1 auto");
  assert.equal(peers["align-self"], "stretch"); assert.equal(peers["max-inline-size"], "100%");
  assert.equal(peers["white-space"], "normal"); assert.equal(peers["overflow-wrap"], "anywhere");
  noCeiling(group); noCeiling(input); noCeiling(peers);
  assert.equal(rule(responsive, ":root")["--forma-hit-target"], "var(--forma-control-min-size, 2.75rem)");
  assert.equal(rule(design, ".button.compact")["min-height"], "2.75rem");
  const start = workspaceText.indexOf('<form class="document-title-editor"'), end = workspaceText.indexOf("</form>", start);
  assert.ok(start >= 0 && end > start); const form = workspaceText.slice(start, end);
  assert.equal((form.match(/<input\b/gu) ?? []).length, 1); assert.equal((form.match(/<button\b/gu) ?? []).length, 2);
  assert.ok(form.includes('for="document-title-input"') && form.includes('id="document-title-input"'));
  assert.ok(form.includes("this.#renameDocument(event,p.documentId,p.documentTitle)"));
  assert.ok(form.includes('.value=${this.#documentName}') && form.includes('this.#documentName=(event.target as HTMLInputElement).value'));
});

test("E Library Clear filter reuses the compact ghost floor and supporting typography", () => {
  const selected = libraryText.split("\n").find(line => line.includes('<div class="collection-filter">'));
  assert.ok(selected?.includes('<button type="button" class="button ghost compact"'));
  assert.ok(selected.includes('this.store.patchUi({focusCollectionId:""})'));
  assert.ok(selected.includes(">Clear filter</button>"), "the existing localizable label and executor stay unchanged");
  const control = rule(responsive, ".collection-filter > .button"), shared = rule(design, ".button");
  assert.equal(rule(design, ".button.compact")["min-height"], shared["min-height"]);
  assert.equal(shared["min-height"], "2.75rem");
  assert.equal(shared["min-inline-size"], "var(--forma-control-min-size, 2.75rem)");
  assert.equal(control["font-size"], shared["font-size"], "older .collection-filter button must not retain micro text");
  assert.equal(control["line-height"], shared["line-height"]);
  assert.equal(control["max-inline-size"], "100%"); assert.equal(control["white-space"], "normal");
  assert.equal(control["overflow-wrap"], "anywhere"); noCeiling(control);
});

const originalFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw new Error("No external/provider transport in rename/filter controls"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(external, 0); });
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s/u).includes(name);
const within = (node, name) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (classed(parent, name)) return true;
  return false;
};

// Supply only two absent browser primitives: the exact descendant query and
// input.select(). The production rename method and controls are not replaced.
function renameNative(f) {
  const selections = [], query = f.renderer.query.bind(f.renderer), collect = f.renderer.collect.bind(f.renderer);
  f.renderer.query = (owner, selector) => selector === ".document-title-editor input"
    ? f.tree().nodes.filter(node => node.tag === "input" && node.owner === owner && within(node, "document-title-editor")).map(node => node.port)
    : query(owner, selector);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    for (const node of f.renderer.nodes.slice(start)) if (node.tag === "input" && node.attributes.id === "document-title-input")
      node.select = () => { node.selectionStart = 0; node.selectionEnd = String(node.value).length; selections.push(node.value); };
  };
  return selections;
}
function nativeHistory(t, f) {
  const previous = globalThis.history, location = f.storeHost.location;
  globalThis.history = {
    pushState(_state, _title, value) { const next = new URL(value, "http://localhost"); Object.assign(location, { pathname: next.pathname, search: next.search, hash: next.hash }); },
    replaceState(...args) { this.pushState(...args); },
  };
  t.after(() => { globalThis.history = previous; });
}
function unchanged(f) {
  const source = JSON.stringify(f.store.events.get()), money = financial(f.storeHost.worker), requests = f.storeHost.requests.length;
  return () => {
    assert.equal(JSON.stringify(f.store.events.get()), source);
    assert.deepEqual(financial(f.storeHost.worker), money);
    assert.deepEqual(f.storeHost.requests.slice(requests).filter(row => !["GET", "HEAD"].includes(row.init.method ?? "GET")), [],
      "these current local controls do not submit or buy work");
  };
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test(locale + " current Document rename keeps raw text and direct Cancel / unchanged-name Save", async t => {
    const f = await createCalmFullPage(t, { locale }), selections = renameNative(f);
    const workspace = f.components().find(owner => owner.tag === "forma-workspace"); assert.ok(workspace?.isConnected);
    const title = f.store.projection.get().documentTitle, route = f.store.route.get(), verify = unchanged(f);
    const begin = () => f.find("button", node => node.owner === workspace && node.attributes.title === "Rename document");
    const field = () => f.find("input", node => node.owner === workspace && node.attributes.id === "document-title-input");
    const form = () => f.find("form", node => node.owner === workspace && classed(node, "document-title-editor"));
    await f.act(begin()); assert.equal(field().properties.value, title);
    assert.equal(f.tree().visible("label").filter(node => node.attributes.for === "document-title-input").length, 1);
    const buttons = () => f.tree().visible("button").filter(node => node.owner === workspace && within(node, "document-title-editor"));
    assert.equal(buttons().length, 2); assert.deepEqual(buttons().map(node => node.attributes.type), ["button", "submit"]);
    assert.ok(buttons().every(node => classed(node, "button") && classed(node, "compact")));
    const raw = "  Café e\u0301 العربية 日本語 — unsent name  ", input = field(); input.port.value = raw;
    await f.act(input, "input"); f.store.notify(); await f.settle();
    assert.equal(field().properties.value, raw, "the existing raw field state is not normalized by presentation");
    await f.act(buttons().find(node => node.attributes.type === "button"));
    assert.equal(f.tree().visible("form").filter(node => classed(node, "document-title-editor")).length, 0);
    assert.equal(f.store.projection.get().documentTitle, title); verify();
    await f.act(begin()); const same = field(); same.port.value = "  " + title + "  "; await f.act(same, "input");
    assert.equal(Object.hasOwn(buttons().find(node => node.attributes.type === "submit").attributes, "disabled"), false);
    await f.act(form(), "submit");
    assert.equal(f.tree().visible("form").filter(node => classed(node, "document-title-editor")).length, 0);
    assert.ok(selections.length >= 2, "the unchanged native select call remains reachable");
    assert.equal(f.store.route.get(), route); assert.equal(f.store.projection.get().documentTitle, title); verify();
  });

  test(locale + " current Library Clear filter is direct and keeps query, route and source selection", async t => {
    const f = await createCalmFullPage(t, { locale }); nativeHistory(t, f);
    const documentId = f.store.projection.get().documentId, collectionId = "control-floor-collection";
    // Explicit synthetic display state; not a claim of a saved collection.
    f.appendEvent("CollectionCreated", { collection_id: collectionId, handle: "Café العربية 日本語", position: "z" });
    f.appendEvent("CollectionItemAdded", { collection_id: collectionId, item_ref: { document_id: documentId }, position: "a" });
    f.store.patchUi({ focusCollectionId: collectionId }); f.store.setRoute("/library?document=" + documentId); await f.settle();
    const library = f.components().find(owner => owner.tag === "forma-library"); assert.ok(library?.isConnected);
    const search = f.find("input", node => within(node, "library-toolbar") && node.owner.tag === "forma-ui-search");
    search.port.value = "Synthetic"; await f.act(search, "input");
    const verify = unchanged(f), route = f.store.route.get(), selected = f.store.ui.selectedOutputId;
    const clear = f.find("button", node => node.owner === library && within(node, "collection-filter"));
    assert.equal(clear.attributes.type, "button");
    assert.ok(["button", "ghost", "compact"].every(name => classed(clear, name)), "one shared control, not another menu");
    assert.equal(clear.text, { en: "Clear filter", fr: "Effacer le filtre", ar: "مسح عامل التصفية", ja: "フィルターをクリア" }[locale], "the actual localization path retains the complete existing catalog label");
    await f.act(clear);
    assert.equal(f.store.ui.focusCollectionId, "");
    assert.equal(f.tree().visible("div").filter(node => classed(node, "collection-filter")).length, 0);
    assert.equal(f.find("input", node => within(node, "library-toolbar") && node.owner.tag === "forma-ui-search").properties.value, "Synthetic");
    assert.equal(f.store.route.get(), route); assert.equal(f.store.projection.get().documentId, documentId);
    assert.equal(f.store.ui.selectedOutputId, selected); assert.equal(f.components().find(owner => owner.tag === "forma-library"), library); verify();
  });
}

// E7 follow-up: append after the original NI10, never replace those cases.
// These are declaration/source contracts. The existing browser observer owns
// actual target bodies, focus visibility and the retained title's word layout.
test("E7 display Rename retains its native action and a nonsqueezing shared target floor", () => {
  const start = workspaceText.indexOf('<div class="document-title-row">');
  const end = workspaceText.indexOf('<form class="document-title-editor"', start);
  assert.ok(start >= 0 && end > start);
  const display = workspaceText.slice(start, end);
  assert.ok(display.includes('<h1>${p.documentTitle}</h1>'), "the full authored title stays actual heading text");
  assert.equal((display.match(/<button\b/gu) ?? []).length, 1);
  assert.ok(display.includes('canAuthor?html`<button class="icon-button"'));
  assert.ok(display.includes('this.i18n.system("Rename {documentTitle}", { documentTitle: p.documentTitle })'));
  assert.ok(display.includes('title="Rename document" @click=${()=>this.#beginDocumentRename(p.documentTitle)}'));
  assert.ok(display.includes('${icon("edit")}'), "reuse the existing icon, not an invisible enlarged overlay");
  assert.ok(workspaceText.includes('store.sourceOwnershipActive(source) && Boolean(authorization && store.authorizationScopeActive(authorization))'));
  assert.ok(workspaceText.includes('field.select(); return true;'), "the existing guarded select-only rename entry is unchanged");
  const control = rule(responsive, ".document-title-row > .icon-button");
  assert.equal(control["min-inline-size"], "var(--forma-hit-target)");
  assert.equal(control["min-block-size"], "var(--forma-hit-target)");
  assert.equal(control.flex, "0 0 auto");
  noCeiling(control);
  assert.equal(control.position, undefined);
  assert.equal(control.transform, undefined);
  assert.equal(control["inline-size"], undefined, "use the shared minimum, not a new inline-size ceiling");
});

test("E7 compact Document gives title copy a useful row before squeezing and keeps one native action strip", () => {
  const posture = '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"]';
  const header = posture + ' .workspace-page[data-workbench="document"] .page-header--document';
  const copy = posture + ' .page-header--document .page-header-copy';
  const strip = posture + ' .page-header--document .page-header-actions';
  assert.ok(workspaceText.includes('<div class="document-bar page-header page-header--document"><div class="page-header-copy">'));
  assert.ok(workspaceText.includes('class="document-actions page-header-actions" @focusin='));
  assert.ok(workspaceText.includes('this.#revealDocumentActionFocus(event, () => this.store === actionStore'));
  const group = rule(responsive, header), title = rule(responsive, copy), actions = rule(responsive, strip);
  assert.equal(group["flex-direction"], "row");
  assert.equal(group.gap, "var(--forma-cluster-gap)");
  assert.equal(group["padding-block"], ".125rem");
  assert.equal(group["padding-inline"], undefined, "the shared header gutter is not replaced");
  assert.equal(title["min-inline-size"], "0");
  assert.equal(actions["inline-size"], "auto");
  assert.equal(actions.width, "auto");
  assert.equal(actions["flex-wrap"], "nowrap");
  assert.equal(actions["overflow-x"], "auto");
  assert.equal(actions["overscroll-behavior-inline"], "contain");
  assert.equal(rule(responsive, strip + " > *").flex, "0 0 auto");
  assert.equal(rule(responsive, strip + " > *")["min-inline-size"], "var(--forma-hit-target)");
  assert.equal(rule(responsive, strip + " > .button")["white-space"], "nowrap");
  assert.equal(rule(responsive, strip + " > .button")["overflow-wrap"], "normal");
  const rail = '.application-creative[data-nav-posture="rail"][data-short-height="true"][data-layout-intent="workbench"] .workspace-page[data-workbench="document"] .page-header--document';
  const railRules = [];
  responsive.walkRules(current => { if (current.selectors.includes(rail + " > .page-header-copy")) railRules.push(current); });
  assert.equal(railRules.length, 1);
  assert.equal(railRules[0].parent.name, "media");
  assert.equal(railRules[0].parent.params, "(max-height: 37.5rem) and (orientation: landscape)");
  assert.equal(railRules[0].nodes.find(node => node.prop === "flex")?.value, "1 1 min(100%, 16rem)",
    "reuse the existing useful basis, but do not replace the distinct short-rail posture");
  noCeiling(group); noCeiling(title); noCeiling(actions);
  assert.equal(group["flex-wrap"], "wrap");
  assert.equal(title.flex, "1 1 min(100%, 16rem)");
  assert.equal(actions["max-inline-size"], "100%", "a wrapped strip may use its actual row without ceasing to be horizontal");
});
