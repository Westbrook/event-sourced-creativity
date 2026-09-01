import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { lifecyclePage } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { boardPage, drain } from "./helpers/board-lifecycle-navigation-fixture.mjs";
import { projectTaskDocumentIdFromRoute, routePathname } from "../src/model/routes.ts";

// Complete existing Activity/Shell/choice-card classes and actual Store through
// the existing RAM Worker fixture. The helper's authored projection is synthetic.
// Native ports + parsed CSS establish structure, not measured geometry or AT.
// This file never opens an action or issues an authoring/provider command.
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
const [foundationText, designText, actionsText, mainText] = await Promise.all([
  read("src/responsive-foundation.css"), read("src/design-system.css"),
  read("src/components/next-action-cards.css"), read("src/main.ts"),
]);
const foundation = postcss.parse(foundationText), design = postcss.parse(designText), actionSheet = postcss.parse(actionsText);
const declarations = (sheet, selector, media = null) => {
  const result = {};
  sheet.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    if (media === null ? rule.parent.type !== "root" : rule.parent.type !== "atrule" || rule.parent.name !== "media" || rule.parent.params !== media) return;
    rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
};
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, ancestor) => { for (let at = node.parent; at; at = at.parent) if (at === ancestor) return true; return false; };
const one = (rows, description) => { assert.equal(rows.length, 1, description); return rows[0]; };

test("Activity keeps its existing token-guttered responsive section owner", () => {
  assert.match(mainText, /import "\.\/design-system\.css";\s*import "\.\/responsive-foundation\.css";/u);
  const owner = declarations(foundation, ".forma-activity-sections");
  assert.equal(owner["margin-inline"], "var(--page-gutter)");
  assert.equal(owner.display, "grid"); assert.equal(owner["max-inline-size"], "80rem");
  assert.equal(owner.gap, "var(--forma-section-gap)");
  assert.equal(declarations(foundation, ".forma-activity-sections", "(min-width: 90rem)")["max-inline-size"], "none",
    "the existing large-screen exception remains the owner, not a new fixed-width lifecycle wrapper");
});

test("actual Activity lifecycle is first inside the existing sections without changing its native actions", { timeout: 45_000 }, async t => {
  const f = await lifecyclePage(t, { route: "/activity" });
  const tree = f.tree(), host = one(f.components().filter(value => value.tag === "forma-activity"), "one actual Activity host");
  const section = one(tree.visible("div").filter(node => node.owner === host && classed(node, "forma-activity-sections")), "one existing Activity section owner");
  const lifecycle = one(tree.visible("section").filter(node => node.owner === host && classed(node, "lifecycle-next-actions")), "one actual current lifecycle group");
  const choices = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, lifecycle));
  const actions = f.actions(); assert.ok(actions.length > 0 && actions.length <= 3);
  assert.equal(choices.length, actions.length);
  for (const [index, choice] of choices.entries()) {
    assert.ok(choice.component?.isConnected, "the original actual choice-card class owns this row");
    const button = one(tree.visible("button").filter(node => node.parent === choice), "the actual card has one direct native button");
    assert.equal(button.owner, choice.component); assert.equal(typeof button.handlers.click, "function");
    assert.equal(button.attributes["data-choice-value"], actions[index].id);
    assert.equal(Object.hasOwn(button.attributes, "aria-label"), false, "the full visible text remains the native name");
    assert.ok(button.text.length > 0); assert.equal(choice.attributes["data-primary"], String(index === 0));
  }
  const projection = f.store.projection.get(), current = projection.documents.find(value => value.id === f.documentId);
  assert.ok(current); assert.deepEqual(tree.visible("bdi").filter(node => inside(node, lifecycle)).map(node => node.text), [projection.projectName, current.title]);
  assert.equal(routePathname(f.store.route.get()), "/activity");
  assert.equal(projectTaskDocumentIdFromRoute(f.store.route.get()), f.documentId); f.sourceUnchanged();
  assert.equal(lifecycle.parent === section, true, "lifecycle content must inherit the existing Activity gutter/width owner");
  assert.equal(section.children.filter(node => typeof node !== "string")[0] === lifecycle, true, "the current lifecycle group precedes ordinary Activity sections inside that owner");
});

test("shared next-action card hosts stretch their one native button without fixed heights", () => {
  const parent = declarations(actionSheet, ".exact-next-actions"), host = declarations(actionSheet, ".exact-next-actions > forma-ui-choice-card");
  assert.equal(parent.display, "grid");
  assert.equal(host.display, "grid", "a stretched block host does not stretch its native button; the scoped host must provide the grid track");
  for (const property of ["height", "block-size", "max-height", "max-block-size", "align-items", "align-self", "overflow", "white-space", "text-overflow"]) {
    assert.equal(host[property], undefined, "host stretch adds no fixed height, alignment override or clipping: " + property);
  }
  const button = declarations(design, ".ui-choice-card");
  assert.equal(button.display, "grid"); assert.equal(button["inline-size"], "100%");
  assert.equal(button["min-block-size"], "var(--forma-control-min-size,2.75rem)");
  assert.equal(button["align-self"], undefined); assert.equal(button["block-size"], undefined); assert.equal(button.height, undefined);
});

test("shared card copy and existing Canvas overflow exceptions stay intact", () => {
  const copy = declarations(actionSheet, ".exact-next-actions .ui-choice-card-copy");
  assert.equal(copy["min-inline-size"], "0"); assert.equal(copy["overflow-wrap"], "anywhere");
  for (const property of ["overflow", "white-space", "text-overflow", "line-clamp", "-webkit-line-clamp"]) assert.equal(copy[property], undefined);
  assert.equal(declarations(actionSheet, ".canvas-next-document .exact-next-actions")["grid-template-columns"], "repeat(auto-fit,minmax(min(100%,13rem),1fr))");
  const compact = declarations(actionSheet, ".canvas-next-document", "(max-width:48rem)");
  assert.equal(compact.display, "block"); assert.equal(compact["max-block-size"], "40dvh"); assert.equal(compact.overflow, "auto");
  assert.equal(declarations(actionSheet, ".canvas-next-document .exact-next-actions", "(max-width:48rem)")["grid-template-columns"], "1fr");
  assert.equal(declarations(actionSheet, ".exact-next-actions > forma-ui-choice-card[data-primary=true] .ui-choice-card", "(forced-colors:active)")["border-color"], "Highlight");
});


// New C board copy must share the existing planning group, not become another
// auto-sized flex sibling that competes with the zero-basis action grid.
test("actual Canvas planning identity and scope sentence form one group beside unchanged native choices", { timeout: 45_000 }, async t => {
  const f = await boardPage(t), current = f.store.projection.get().documents.find(value => value.id === f.documentId);
  const title = "A deliberately long current planning document name — 文書の名前 — اسم المستند";
  await f.external("DocumentRenamed", { document_id: f.documentId, old_title: current.title, new_title: title }); await drain(f, 2);
  const tree = f.tree(), bar = one(tree.visible("section").filter(node => node.owner === f.canvas && classed(node, "canvas-next-document")), "one actual current board guidance bar");
  const summary = one(tree.visible("div").filter(node => node.owner === f.canvas && node.parent === bar && classed(node, "canvas-planning-summary")), "existing planning summary");
  const scope = one(tree.visible("p").filter(node => inside(node, bar) && node.text === f.i18n.t("next.lifecycle.boardScope")), "complete localized board/document scope copy");
  const heading = one(tree.visible("b").filter(node => inside(node, summary)), "exact visible planning identity");
  assert.equal(heading.text, title); assert.equal(f.store.canvasPlanningDocumentId(), f.documentId);
  const actions = one(tree.visible("aside").filter(node => node.parent === bar && classed(node, "exact-next-actions")), "existing direct action-grid peer");
  const choices = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, actions));
  assert.ok(choices.length > 0 && choices.length <= 3); assert.equal(choices.filter(node => node.attributes["data-primary"] === "true").length, 1);
  for (const choice of choices) {
    const button = one(tree.visible("button").filter(node => node.parent === choice), "one actual native choice button");
    assert.ok(choice.component?.isConnected && button.port?.isConnected);
    assert.equal(button.owner, choice.component); assert.equal(typeof button.handlers.click, "function");
    assert.ok(button.text.includes(choice.component.label)); assert.equal(Object.hasOwn(button.attributes, "aria-label"), false);
  }
  await f.sourceUnchanged();
  assert.strictEqual(scope.parent, summary, "scope copy belongs inside the existing planning summary, never a third auto-basis flex peer");
  assert.deepEqual(bar.children.filter(node => typeof node !== "string"), [summary, actions], "exactly two existing desktop groups, with no new wrapper");
});

test("Canvas desktop planning and action groups wrap from useful bases without changing compact overflow", () => {
  const bar = declarations(actionSheet, ".canvas-next-document");
  const summary = declarations(actionSheet, ".canvas-next-document > .canvas-planning-summary");
  const actions = declarations(actionSheet, ".canvas-next-document > .exact-next-actions");
  assert.equal(bar.display, "flex");
  assert.equal(bar["flex-wrap"], "wrap", "a narrow Canvas container may reflow even above the viewport breakpoint");
  assert.equal(summary.flex, "1 1 18rem", "planning copy receives a useful preferred text measure");
  assert.equal(actions.flex, "2 1 28rem", "the action group no longer grows from a zero basis after both text siblings");
  assert.equal(summary["min-inline-size"], "0"); assert.equal(actions["min-inline-size"], "0");
  for (const rule of [summary, actions]) for (const property of ["height", "block-size", "max-height", "max-block-size", "overflow", "white-space", "text-overflow"]) {
    assert.equal(rule[property], undefined, "no fixed height/truncation or hidden overflow: " + property);
  }
  const compact = declarations(actionSheet, ".canvas-next-document", "(max-width:48rem)");
  assert.equal(compact.display, "block"); assert.equal(compact["max-block-size"], "40dvh"); assert.equal(compact.overflow, "auto");
  assert.equal(declarations(actionSheet, ".canvas-next-document .exact-next-actions", "(max-width:48rem)")["grid-template-columns"], "1fr");
});

test("actual Document lifecycle uses the existing pane inset without changing full-bleed context blocks", { timeout: 45_000 }, async t => {
  const f = await lifecyclePage(t, { route: "document" });
  const tree = f.tree(), workspace = one(f.components().filter(value => value.tag === "forma-workspace"), "one actual ordinary Document");
  const pane = one(tree.visible("section").filter(node => node.owner === workspace && node.attributes.id === "document-context-panel"), "current context pane");
  const lifecycle = one(tree.visible("section").filter(node => node.owner === workspace && classed(node, "lifecycle-next-actions") && inside(node, pane)), "current Document continuation");
  assert.strictEqual(lifecycle.parent, pane, "scoped selector matches the real current composition, not a synthetic class alone");
  const choices = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, lifecycle));
  assert.ok(choices.length > 0 && choices.length <= 3); assert.equal(choices.filter(node => node.attributes["data-primary"] === "true").length, 1);
  for (const choice of choices) {
    const button = one(tree.visible("button").filter(node => node.parent === choice), "existing native Document choice");
    assert.ok(choice.component?.isConnected); assert.equal(button.owner, choice.component); assert.equal(typeof button.handlers.click, "function");
    assert.ok(button.text.includes(choice.component.label));
  }
  assert.equal(f.store.projection.get().documentId, f.documentId); f.sourceUnchanged();
  const inset = declarations(actionSheet, ".context-column > .lifecycle-next-actions");
  assert.equal(inset["margin-inline"], "var(--forma-pane-inset)", "new scope text/cards use the same existing inset as blank context and document insight");
  assert.equal(inset["min-inline-size"], "0");
  assert.equal(inset["padding-inline"], undefined, "one inset owner, not nested padding");
  for (const property of ["width", "inline-size", "height", "block-size", "overflow"]) assert.equal(inset[property], undefined);
});
