import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

// Stylesheet/source contracts only: no DOM, browser geometry, network, or application execution.
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = relative => readFile(new URL("../" + relative, import.meta.url), "utf8");
const paths = [
  "src/styles.css", "src/design-system.css", "src/responsive-foundation.css",
  "src/components/design-system/slotted-element.ts", "src/components/design-system/layout.ts",
  "src/components/forma-library.ts", "src/components/forma-deliver.ts",
  "src/components/design-system/catalog.ts", "src/components/design-system/component-catalog.ts",
  "docs/components.md", "src/apps/product/actual-replay.ts",
  "src/components/design-system/assistant-panel.css",
];
const texts = Object.fromEntries(await Promise.all(paths.map(async path => [path, await read(path)])));
const base = postcss.parse(texts["src/styles.css"]);
const design = postcss.parse(texts["src/design-system.css"]);
const responsive = postcss.parse(texts["src/responsive-foundation.css"]);
const slotted = texts["src/components/design-system/slotted-element.ts"];
const marker = "const compositionStyles = css" + String.fromCharCode(96);
assert.ok(slotted.includes(marker), "inspect the actual shared adopted stylesheet");
const shadow = postcss.parse(slotted.split(marker)[1].split(String.fromCharCode(96) + ";")[0]);
const rules = sheet => { const found = []; sheet.walkRules(rule => found.push(rule)); return found; };
const declarations = rule => Object.fromEntries((rule?.nodes ?? []).filter(node => node.type === "decl").map(node => [node.prop, node.value]));
const unconditional = (sheet, selector) => {
  const found = rules(sheet).filter(rule => rule.selectors.includes(selector) && rule.parent.type === "root");
  assert.ok(found.length, "missing unconditional rule: " + selector);
  return Object.assign({}, ...found.map(declarations));
};
const inputSelector = ':where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, select)';
const cluster = 'forma-ui-cluster[alignment="stretch"]';
const actionHosts = ":is(forma-ui-button,forma-ui-icon-button,forma-ui-link)";

test("specialist grant identity preserves full long account text and lets the action wrap", () => {
  assert.equal(unconditional(responsive, ".access-grant-list > li")["flex-wrap"], "wrap");
  const copy = unconditional(responsive, ".access-grant-list > li > div");
  assert.equal(copy["min-inline-size"], "0");
  assert.equal(copy["overflow-wrap"], "anywhere");
  for (const rule of rules(responsive).filter(rule => rule.selector.includes("access-grant-list"))) {
    const declared = declarations(rule);
    assert.notEqual(declared["white-space"], "nowrap");
    assert.notEqual(declared["text-overflow"], "ellipsis");
    assert.notEqual(declared.overflow, "hidden");
    assert.equal(declared["line-clamp"], undefined);
    assert.equal(declared["-webkit-line-clamp"], undefined);
  }
});

test("supporting buttons and fields share declared block padding, typography and a border box", () => {
  const button = unconditional(design, ".button"), field = unconditional(design, inputSelector);
  assert.equal(button["padding-block"], "var(--forma-space-2, var(--space-2))");
  assert.ok(field.padding.startsWith(button["padding-block"] + " "));
  assert.equal(button["font-size"], field["font-size"]);
  assert.equal(button["line-height"], field["line-height"]);
  assert.equal(button.border, "1px solid transparent");
  assert.equal(field.border, "1px solid var(--line-strong)");
  assert.equal(unconditional(base, "*")["box-sizing"], "border-box");
  assert.equal(button["min-height"], "2.75rem");
  assert.equal(field["min-height"], "2.75rem");
  assert.equal(unconditional(design, ".button.compact")["min-height"], "2.75rem");
});

test("legacy compact and Library action rules do not undo shared block padding or shrink their text", () => {
  for (const selector of [".button", ".button.compact", ".family-actions .button", ".library-output-actions .button"]) {
    assert.ok(unconditional(base, selector).padding.startsWith("var(--forma-space-2, var(--space-2)) "), selector);
  }
  assert.equal(unconditional(base, ".library-output-actions .button")["font-size"], "var(--forma-font-size-supporting, var(--type-small))");
  for (const selector of [".button", inputSelector]) {
    const rule = unconditional(design, selector);
    assert.equal(rule.height, undefined);
    assert.equal(rule["block-size"], undefined);
    assert.equal(rule["max-height"], undefined);
    assert.equal(rule["white-space"], undefined, "wrapped text is not truncated to fake equal heights");
  }
});

test("Account privacy checkboxes give the whole existing label a target without enlarging the glyph", () => {
  const label = unconditional(base, ".toggle-row");
  assert.equal(label["min-inline-size"], "var(--forma-control-min-size, 2.75rem)");
  assert.equal(label["min-block-size"], label["min-inline-size"]);
  assert.equal(label["align-items"], "center");
  assert.equal(label["font-size"], "var(--forma-font-size-supporting, var(--type-small))");
  const input = unconditional(base, '.toggle-row > input[type="checkbox"]');
  assert.equal(input.flex, "0 0 auto");
  assert.equal(input["min-block-size"], undefined);
  assert.equal(input["block-size"], undefined);
  assert.equal(unconditional(base, ".toggle-row > span")["overflow-wrap"], "anywhere");
});

test("old segmented consumers keep the target floor while Library history reuses the real primitive", () => {
  const old = unconditional(design, ".segmented button");
  assert.equal(old["min-height"], "var(--forma-control-min-size, 2.75rem)");
  assert.equal(old["min-inline-size"], old["min-height"]);
  const library = texts["src/components/forma-library.ts"];
  assert.ok(library.includes('<forma-ui-segmented-control class="compact-segmented"'));
  assert.ok(library.includes(".value=" + String.fromCharCode(36) + "{this.#outputScope}"));
  assert.ok(library.includes('value:"recent"') && library.includes('value:"kept"'));
  assert.ok(library.includes('if(value==="recent"||value==="kept")this.#setOutputScope(value)'));
  assert.ok(library.includes('recentOutputItems.length+allArtifacts.length') && library.includes('keptCount'));
  assert.ok(!library.includes('<div class="segmented compact-segmented"'));
});

test("Library result rows reuse the authored-child Cluster while keeping current anchors and handlers", () => {
  const library = texts["src/components/forma-library.ts"];
  assert.ok(library.includes('import "./design-system/layout";'));
  assert.equal(library.split('<forma-ui-cluster class="library-output-actions" alignment="stretch">').length - 1, 2);
  assert.ok(library.includes('this.#navigate(event,"output",output.id)'));
  // Source binding only: the actual native control now enters shared admission.
  // Original copy execution remains the full-host Library ACK suite's evidence.
  assert.ok(library.includes('${canAuthor?html`<forma-ui-cluster class="library-output-actions" alignment="stretch"><button type="button" class="button secondary compact" aria-label=${this.#inputAction(adopted,artifact.title)} @click=${(event:MouseEvent)=>this.#useArtifactInput(artifact,event)}>${this.#inputLabel(adopted)}</button>'));
  const useStart = library.indexOf("\n  async #useArtifactInput(artifact:DocumentArtifact,event:MouseEvent){");
  const useEnd = library.indexOf("\n  #relatedReferenceCount(", useStart);
  assert.ok(useStart >= 0 && useEnd > useStart, "Inspect the actual current Library copy member");
  const use = library.slice(useStart, useEnd);
  for (const binding of [
    "const destination=this.store.projection.get().documentId;",
    "await reuseManualOutput(this,this.store,this.#outputReuse,event,{",
    "destinationDocumentId:destination,",
    "current:()=>this.store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id",
    "&&value.documentId===artifact.documentId&&value.sequence===artifact.sequence",
    "&&value.sourceEventId===artifact.sourceEventId&&value.contentRef===artifact.contentRef)",
    'copy:()=>this.store.addArtifactAsContext(artifact.id,destination,"library",{reveal:false}),',
  ]) assert.ok(use.includes(binding), "Exact source dispatch binding: " + binding);
  assert.ok(library.includes('this.#toggleLibrary(artifact)') && library.includes('this.#toggleLibrary(output)'));
  assert.equal(unconditional(design, ".library-output-actions")["flex-wrap"], "wrap");
  assert.equal(unconditional(base, ".family-actions")["flex-wrap"], "wrap");
});

test("Cluster stretch is explicit; default mixed badge and status rows remain centered", () => {
  assert.equal(unconditional(design, "forma-ui-cluster")["align-items"], "center");
  assert.equal(unconditional(design, "forma-ui-cluster")["flex-wrap"], "wrap");
  assert.equal(unconditional(design, cluster)["align-items"], "stretch");
  const layout = texts["src/components/design-system/layout.ts"];
  assert.ok(layout.includes('alignment: "center" | "stretch" = "center"'));
  for (const rule of rules(design).filter(rule => rule.selector.includes(cluster))) {
    assert.ok(!rule.selector.includes("forma-ui-badge") && !rule.selector.includes("forma-ui-status"), "noninteractive content is not forced into action sizing");
  }
});

test("opt-in wrapping hosts propagate cross-axis size to their real native controls", () => {
  const host = unconditional(design, cluster + " > " + actionHosts);
  assert.equal(host.display, "flex");
  assert.equal(host["min-inline-size"], "0");
  const control = unconditional(design, cluster + " > " + actionHosts + " > :is(button,a)");
  assert.equal(control.flex, "1 1 auto");
  assert.equal(control["align-self"], "stretch");
  for (const slot of ["actions", "trailing"]) {
    assert.equal(unconditional(design, actionHosts + '[slot="' + slot + '"]').display, "flex");
    assert.equal(unconditional(design, actionHosts + '[slot="' + slot + '"] > :is(button,a)').flex, "1 1 auto");
  }
});

test("shared slotted body copy inherits script leading rather than hardcoding English spacing", () => {
  assert.equal(unconditional(shadow, ":host")["line-height"], "var(--forma-body-line-height, 1.6)");
  assert.equal(unconditional(shadow, 'slot:not([name])::slotted(p)')["line-height"], "var(--forma-body-line-height, 1.6)");
  assert.equal(unconditional(shadow, ".button")["padding-block"], "var(--forma-space-2, var(--space-2))");
  assert.equal(unconditional(shadow, ".button")["font-weight"], "600");
  assert.ok(texts["src/styles.css"].includes("--forma-body-line-height: 1.7;"));
  assert.ok(texts["src/styles.css"].includes("--forma-body-line-height: 1.8;"));
});

test("slotted lists and headers wrap actions after preserving a useful copy basis", () => {
  assert.equal(unconditional(shadow, ".ui-list-item")["flex-wrap"], "wrap");
  const main = unconditional(shadow, ".ui-list-item-main"), copy = unconditional(shadow, ".ui-list-item-copy");
  assert.equal(main.display, "flex");
  assert.equal(main.flex, "1 1 min(100%, 16rem)", "leading visual and copy own one preferred basis");
  assert.equal(main["min-inline-size"], "0");
  assert.equal(main["align-items"], "center");
  assert.equal(main.gap, "var(--forma-space-3, var(--space-3))");
  for (const selector of ['.ui-list-item-main > slot[name="leading"]::slotted(*)', '.ui-list-item-main > slot[name="leading"] > *']) assert.equal(unconditional(shadow, selector).flex, "none", "meaningful leading content does not shrink");
  assert.equal(copy["white-space"], undefined, "authored pre/code whitespace is not replaced");
  assert.equal(copy.flex, "1", "copy flexes inside its main group instead of wrapping independently");
  assert.equal(copy["min-inline-size"], "0");
  assert.equal(copy["overflow-wrap"], "anywhere");
  assert.equal(main["inline-size"], undefined); assert.equal(copy["inline-size"], undefined);
  assert.equal(main.height, undefined); assert.equal(copy.height, undefined);
  assert.equal(unconditional(shadow, ".ui-page-header")["flex-wrap"], "wrap");
  assert.equal(unconditional(shadow, ".ui-page-header-copy").flex, "1 1 min(100%, 24rem)");
  assert.equal(unconditional(shadow, ".ui-list-item-trailing")["align-items"], "center", "badge/status alignment is not blanket-stretched");
  assert.equal(unconditional(shadow, '.ui-page-header-actions')["flex-wrap"], "wrap");
});

test("notice actions move below their own copy at a container boundary, without an overlay", () => {
  assert.equal(unconditional(shadow, ":host(forma-ui-notice)").container, "forma-notice / inline-size");
  assert.equal(unconditional(shadow, ".ui-notice")["grid-template-columns"], "1.5rem minmax(0, 1fr) auto", "wide notice composition remains intact");
  const compact = rules(shadow).filter(rule => rule.parent.type === "atrule" && rule.parent.name === "container" && rule.parent.params === "forma-notice (max-width: 32rem)");
  assert.equal(compact.length, 2);
  assert.equal(declarations(compact.find(rule => rule.selector === ".ui-notice"))["grid-template-columns"], "1.5rem minmax(0, 1fr)");
  assert.equal(declarations(compact.find(rule => rule.selector === ".ui-notice-actions"))["grid-column"], "2");
  for (const rule of compact) assert.equal(declarations(rule).position, undefined);
});

test("RoleDashboard full-bleed chrome and its body share the same inline gutter owner", () => {
  const hero = unconditional(design, ".role-dashboard > .page-header--hero");
  assert.equal(hero["padding-inline"], "var(--page-gutter)");
  assert.equal(hero.padding, undefined, "a competing shorthand must not reset the inline gutter");
  assert.ok(unconditional(design, ".page-pad").padding.includes("var(--page-gutter)"));
  assert.ok(unconditional(design, ".page-header--hero").margin.includes("calc(-1 * var(--page-gutter))"));
  for (const rule of rules(responsive).filter(rule => rule.selectors.includes(".role-dashboard > .page-header--hero"))) {
    assert.equal(declarations(rule).padding, undefined);
    assert.equal(declarations(rule)["padding-inline"], undefined, "responsive refinements only change block rhythm");
  }
});

test("Deliver owns one body inset around unchanged keyed Outputs, results and the final caveat", () => {
  const deliver = texts["src/components/forma-deliver.ts"];
  const body = deliver.indexOf('<div class="forma-deliver-body">');
  const keyed = deliver.indexOf('repeat(activity.documents, document => document.id');
  const resultSection = deliver.indexOf('<section aria-label=', keyed);
  const caveat = deliver.indexOf('this.i18n.t("artifact.delivery.notDelivered"');
  assert.ok(body > 0 && body < keyed && keyed < resultSection && resultSection < caveat);
  assert.equal(unconditional(responsive, ".forma-deliver-body")["padding-inline"], "var(--page-gutter)");
  for (const selector of [".forma-deliver-section", ".forma-deliver-summary"]) {
    const rule = unconditional(responsive, selector);
    assert.equal(rule["margin-inline"], undefined);
    assert.equal(rule["padding-inline"], undefined, "route inset is not paid twice");
  }
  assert.equal(unconditional(responsive, ".forma-activity-sections")["margin-inline"], "var(--page-gutter)", "unrelated Activity ownership is preserved");
});

test("configuration grids target in-flow paid replay forms, not the persona modal", () => {
  const selector = ".actual-replay > section > form";
  assert.equal(unconditional(design, selector).display, "grid");
  assert.equal(unconditional(design, selector)["grid-template-columns"], "repeat(auto-fit, minmax(min(15rem, 100%), 1fr))");
  assert.ok(!rules(design).some(rule => rule.selectors.includes(".actual-replay form")));
  assert.ok(!rules(design).some(rule => rule.selectors.includes(".actual-replay form label")));
  const actual = texts["src/apps/product/actual-replay.ts"];
  assert.ok(actual.includes('class="modal actual-persona-confirmation"'));
  assert.ok(actual.includes('<form class="modal-card"'));
  assert.ok(actual.includes('name="personaAcknowledged"') && actual.includes("this.#confirmPersona(event,pendingPersona,personaOpening)"));
});

test("the safe catalog teaches both native and wrapped actions without stretching its badge example", () => {
  const catalog = texts["src/components/design-system/component-catalog.ts"];
  const example = catalog.split("\n").find(line => line.includes('case "forma-ui-cluster":'));
  assert.ok(example.includes('<forma-ui-cluster gap="small"><forma-ui-badge'));
  assert.ok(example.includes('<forma-ui-cluster alignment="stretch" gap="small">'));
  assert.ok(example.includes('<button type="button" class="button secondary"'));
  assert.ok(example.includes("<forma-ui-button ") && example.includes("<forma-ui-link "));
  assert.ok(example.includes('href="#forma-ui-cluster"'));
  assert.ok(!example.includes("this.store") && !example.includes("fetch("));
  const docs = texts["docs/components.md"];
  assert.ok(docs.includes("Shared control metrics and wrapping composition"));
  assert.ok(docs.includes("neither\nsuite certifies rendered heights"));
  assert.ok(docs.includes("regenerate both Custom Elements Manifests"));
});

test("actual header, family, failure and specialist action rows share peer-only cross-axis sizing", () => {
  const rows = ":is(.page-header-actions,.family-actions,.generation-failure-actions,.forma-activity-header-actions)";
  const controls = ":is(.button,.icon-button,forma-ui-button,forma-ui-icon-button,forma-ui-link)";
  assert.equal(unconditional(design, rows + " > " + controls)["align-self"], "stretch");
  assert.equal(unconditional(design, rows + " > " + actionHosts).display, "flex");
  assert.equal(unconditional(design, rows + " > " + actionHosts + " > :is(button,a)")["align-self"], "stretch");
  assert.equal(unconditional(base, ".page-header-actions")["align-items"], "center", "metadata keeps its centered posture");
  assert.equal(unconditional(base, ".generation-failure-actions")["align-items"], "center", "receipt/status children are not forced into action dimensions");
  assert.equal(unconditional(responsive, ".document-artifact-failures article > div.document-artifact-failure-actions")["align-items"], "stretch");
  const assistant = postcss.parse(texts["src/components/design-system/assistant-panel.css"]);
  assert.equal(unconditional(assistant, ".forma-assistant-specialist footer")["align-items"], "stretch");
  assert.equal(unconditional(assistant, ".forma-assistant-specialist footer")["flex-wrap"], "wrap");
  assert.equal(unconditional(assistant, ".forma-assistant-specialist footer button")["overflow-wrap"], "anywhere");
  const select = unconditional(assistant, ".forma-assistant-model select");
  assert.equal(select["font-size"], "var(--forma-font-size-supporting, .875rem)");
  assert.equal(select["line-height"], "var(--forma-body-line-height, 1.6)");
  assert.equal(select.padding, "var(--forma-space-2, .5rem) var(--forma-control-inset-inline, .75rem)");
  const intentional = '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"] .page-header--document .page-header-actions';
  assert.equal(unconditional(responsive, intentional)["flex-wrap"], "nowrap");
  assert.equal(unconditional(responsive, intentional)["overflow-x"], "auto");
});

test("slotted native, wrapped and built-in actions all stretch while trailing badges remain centered", () => {
  for (const slot of ["actions", "trailing"]) for (const tag of ["button", "a", "forma-ui-button", "forma-ui-icon-button", "forma-ui-link"]) {
    assert.equal(unconditional(shadow, "::slotted(" + tag + '[slot="' + slot + '"])')["align-self"], "stretch");
  }
  for (const owner of [" > ", " > slot > "]) assert.equal(unconditional(shadow, ":is(.ui-card-actions,.ui-page-header-actions,.ui-notice-actions,.ui-list-item-trailing)" + owner + ":is(.button,.icon-button)")["align-self"], "stretch", "both direct dismiss and fallback slot-native actions share the peer row");
  for (const rule of rules(shadow).filter(rule => declarations(rule)["align-self"] === "stretch")) {
    assert.ok(!rule.selector.includes("badge") && !rule.selector.includes("status"));
  }
  const peers = "forma-ui-cluster > :is(button,a,forma-ui-button,forma-ui-icon-button,forma-ui-link)";
  assert.equal(unconditional(design, peers).flex, "0 1 auto", "intrinsic action width determines wrapping, not narrow token columns");
  assert.equal(unconditional(design, peers)["max-inline-size"], "100%");
  assert.equal(unconditional(design, "forma-ui-cluster > :is(button,a)")["white-space"], "normal");
  assert.equal(unconditional(design, "forma-ui-cluster > :is(button,a)")["overflow-wrap"], "anywhere");
});

test("shared dialog footer stretches its native action peers without fixed heights or changed common metrics", () => {
  const footer = unconditional(design, ".ui-dialog-card > footer");
  assert.equal(footer.display, "flex");
  assert.equal(footer["align-items"], "stretch");
  assert.equal(footer["flex-wrap"], "wrap");
  assert.equal(footer["justify-content"], "flex-end");
  assert.equal(footer.gap, "var(--forma-space-3,var(--space-3))");
  for (const selector of [".ui-dialog-card > footer", ".button", ".button.primary", ".button.ghost"]) {
    const declared = unconditional(design, selector);
    for (const prop of ["height", "block-size", "max-height", "max-block-size", "align-self"]) assert.equal(declared[prop], undefined, selector + " preserves natural block growth and inherited peer alignment");
  }
  const button = unconditional(design, ".button");
  assert.equal(button["min-height"], "2.75rem");
  assert.equal(button["padding-block"], "var(--forma-space-2, var(--space-2))");
  assert.equal(button["line-height"], "var(--forma-body-line-height, 1.6)");
});

test("shared dialog keeps centered headers and existing long-literal wrapping instead of clipping copy", () => {
  const header = unconditional(design, ".ui-dialog-card > header");
  assert.equal(header.display, "flex");
  assert.equal(header["align-items"], "center", "only the action footer changes alignment");
  assert.equal(header["justify-content"], "space-between");
  assert.equal(unconditional(design, ":where(h1, h2, h3, h4, p, dd, code, pre, small, strong)")["overflow-wrap"], "anywhere");
  const form = unconditional(design, ":where(fieldset, form, label, input, textarea, select, table, pre, code)");
  assert.equal(form["min-width"], "0");
  assert.equal(form["max-width"], "100%");
  assert.equal(unconditional(design, ".button")["overflow-wrap"], "anywhere");
  assert.equal(unconditional(design, ".button")["max-width"], "100%");
  assert.equal(unconditional(design, ".ui-dialog-card")["max-inline-size"], "100%");
  for (const sheet of [base, design, responsive]) for (const rule of rules(sheet).filter(rule => rule.selector.includes("ui-dialog-card"))) {
    const declared = declarations(rule);
    assert.notEqual(declared["white-space"], "nowrap");
    assert.notEqual(declared.overflow, "hidden");
    assert.notEqual(declared["overflow-wrap"], "normal");
    assert.notEqual(declared["text-overflow"], "ellipsis");
    assert.equal(declared["line-clamp"], undefined);
    assert.equal(declared["-webkit-line-clamp"], undefined);
  }
});

test("both existing dialog consumers retain direct native footer controls and literal named content", async () => {
  const modal = await read("src/components/modal-dialog.ts");
  const confirmation = modal.slice(modal.indexOf("export function requestDialogConfirmation("), modal.indexOf("export function requestDialogText("));
  assert.ok(confirmation.includes('form.className = "modal-card ui-dialog-card";'));
  assert.ok(confirmation.includes('const footer = ownerDocument.createElement("footer");'));
  assert.ok(confirmation.includes('cancel.type = "button"; cancel.className = "button ghost";'));
  assert.ok(confirmation.includes('confirm.type = "submit"; confirm.className = "button primary";'));
  assert.ok(confirmation.includes("footer.append(cancel, confirm); form.append(heading, detail, footer);"));
  assert.ok(confirmation.includes("heading.textContent = options.title;") && confirmation.includes("detail.textContent = options.message;"));
  assert.ok(confirmation.includes('dialog.setAttribute("aria-labelledby", heading.id);'));
  assert.ok(confirmation.includes('dialog.setAttribute("aria-describedby", detail.id);'));
  const feedback = await read("src/components/design-system/feedback.ts");
  const primitive = feedback.slice(feedback.indexOf("export class FormaUiDialog "), feedback.indexOf("export class FormaUiCopyButton "));
  assert.ok(primitive.includes('<section class="ui-dialog-card"><header><h2'));
  assert.ok(primitive.includes('<button type="button" class="icon-button" aria-label='));
  assert.ok(primitive.includes('<footer><button type="button" class="button ghost"'));
  assert.ok(primitive.includes('<button type="button" class="button primary"'));
  assert.ok(primitive.includes('this.#close("cancel")') && primitive.includes('this.#close("confirm")'));
});

test("B3 exact target identities keep bidi markup and unrestricted long-token wrapping in existing rows", async () => {
  const settings = await read("src/components/forma-workspace-settings.ts");
  assert.ok(settings.includes("<b><bdi>${names.get(snapshot.snapshot_id)!.label}</bdi></b>"));
  assert.ok(settings.includes("<bdi>${names.get(credential.id)!.label}</bdi>"));
  assert.ok(settings.includes('<option value=${member.user_id}>${names.get(member.membership_id)!.label}</option>'));
  for (const binding of ['this.#confirmRecovery(event,"restore",snapshot)', 'this.#confirmRecovery(event,"cleanup",snapshot)',
    "this.#revokeCredential(event,credential)", "this.#confirmOwnershipTransfer(event)"])
    assert.ok(settings.includes(binding), "unchanged current executor binding: " + binding);
  const copy = unconditional(design, ".workspace-settings-list > li > div");
  assert.equal(copy["min-inline-size"], "0"); assert.equal(copy["overflow-wrap"], "anywhere");
  for (const property of ["width", "inline-size", "max-height", "max-block-size", "overflow", "text-overflow", "line-clamp", "-webkit-line-clamp"])
    assert.equal(copy[property], undefined, "identity remains complete, without a new clipping or size ceiling");
  // This is containment only. E separately owns the existing card row's
  // preferred copy basis and wrapping actions; it is not yet a geometry pass.
  assert.equal(unconditional(design, ".button")["min-height"], "2.75rem");
  assert.equal(unconditional(design, ".ui-dialog-card > footer")["align-items"], "stretch");
});

test("Sessions original blank form keeps actions before a full-span current status", async () => {
  const sessions = await read("src/components/forma-sessions.ts");
  const start = sessions.indexOf("  #blankForm() {"), end = sessions.indexOf("\n  #brief()", start);
  assert.ok(start >= 0 && end > start, "The actual adopted original-draft form is a required candidate prerequisite");
  const method = sessions.slice(start, end);
  const formStart = method.indexOf('<form class="blank-document-form"'), formEnd = method.indexOf("</form>", formStart);
  assert.ok(formStart >= 0 && formEnd > formStart);
  const form = method.slice(formStart, formEnd);
  const label = form.indexOf('<label for="blank-document-name">'), input = form.indexOf('<input id="blank-document-name"');
  const actions = form.indexOf('<div>${name !== null ? html`<button type="button" class="button ghost blank-document-discard"');
  const actionsEnd = form.indexOf("</div>", actions), status = form.indexOf('<p role="status">');
  assert.ok(label >= 0 && label < input && input < actions && actions < actionsEnd && actionsEnd < status,
    "The same native label/input/actions precede status in semantic order; CSS does not visually reorder them");
  assert.equal(form.split('<p role="status">').length - 1, 1);
  assert.ok(method.includes('if (name === null && !original) return notice ?'),
    "An original without a name input retains the same styled form/action/status owner");
  assert.ok(form.includes('${name !== null ? html`<label for="blank-document-name">'),
    "Discard removes the named field and its label, not the original recovery controls");
  assert.ok(form.includes('@submit=${this.#startBlank}') && form.includes('@click=${this.#discardBlank}'));
  assert.ok(form.includes('.value=${name}') && form.includes('aria-busy=${String(Boolean(draft?.pending) || draft?.check === "checking")}'));
  assert.ok(form.includes('${draft?.mode === "unconfirmed" ? originalActions : html`<button type="submit"')
    && form.includes('!name?.trim() || !draft || draft.pending'),
    "Unconfirmed recovery replaces unusable Create; ordinary creation retains its existing admission floor");
  for (const selector of [".blank-document-form > div", '.blank-document-form > [role="status"]']) {
    const rule = unconditional(base, selector);
    assert.equal(rule["grid-column"], "1 / -1", "Long status and action copy cannot consume an auto track");
    assert.equal(rule["min-inline-size"], "0");
    assert.equal(rule.order, undefined); assert.equal(rule.position, undefined);
    assert.equal(rule["padding-inline"], undefined, "The original form remains the only inset owner");
  }
  const notice = unconditional(base, '.blank-document-form > [role="status"]');
  assert.equal(notice.margin, "0"); assert.equal(notice["overflow-wrap"], "anywhere");
});

test("Sessions original blank form reuses wrapping peer controls and the shared field floor", () => {
  const form = unconditional(base, ".blank-document-form"), actions = unconditional(base, ".blank-document-form > div");
  assert.equal(form.display, "grid"); assert.equal(form["min-inline-size"], "0");
  assert.equal(form["grid-template-columns"], "repeat(2,minmax(0,1fr))");
  assert.equal(form.gap, "var(--forma-cluster-gap)"); assert.equal(form.padding, "14px");
  const fields = unconditional(base, ".blank-document-form > :is(label,input)");
  assert.equal(fields["min-inline-size"], "0"); assert.equal(fields["max-inline-size"], "100%");
  assert.equal(unconditional(base, ".blank-document-form label b")["overflow-wrap"], "anywhere");
  const input = unconditional(base, ".blank-document-form input");
  assert.equal(input["min-height"], "var(--forma-hit-target)"); assert.equal(input["min-block-size"], input["min-height"]);
  assert.equal(input.padding, "var(--forma-space-2, var(--space-2)) var(--forma-control-inset-inline)");
  assert.equal(actions.display, "flex"); assert.equal(actions["flex-wrap"], "wrap");
  assert.equal(actions["align-items"], "stretch"); assert.equal(actions.gap, form.gap);
  const peers = unconditional(base, ".blank-document-form > div > .button");
  assert.equal(peers.flex, "0 1 auto"); assert.equal(peers["max-inline-size"], "100%");
  assert.equal(peers["align-self"], "stretch"); assert.equal(peers["white-space"], "normal");
  assert.equal(peers["overflow-wrap"], "anywhere");
  const narrow = rules(base).filter(rule => rule.selectors.includes(".blank-document-form")
    && rule.parent.type === "atrule" && rule.parent.name === "media" && rule.parent.params === "(max-width: 760px)");
  assert.equal(narrow.length, 1); assert.equal(declarations(narrow[0])["grid-template-columns"], "1fr");
  assert.equal(declarations(narrow[0])["align-items"], "stretch");
  for (const rule of rules(base).filter(rule => rule.selector.includes(".blank-document-form"))) {
    const value = declarations(rule);
    for (const property of ["height", "block-size", "max-height", "max-block-size", "text-overflow", "line-clamp", "-webkit-line-clamp"])
      assert.equal(value[property], undefined, "No fixed-height or truncated substitute for real wrapping");
    assert.notEqual(value.overflow, "hidden"); assert.notEqual(value["white-space"], "nowrap");
  }
});
