import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

// Source/declaration contracts after the separately adjudicated D recovery stack.
// Reuse the existing shared-control-layout PostCSS pattern; no app/DOM/AT claim.
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
const paths = ["src/styles.css", "src/design-system.css", "src/responsive-foundation.css",
  "src/components/document-copy.css", "src/components/forma-project-contents.ts", "src/components/forma-library.ts"];
const texts = Object.fromEntries(await Promise.all(paths.map(async path => [path, await read(path)])));
const base = postcss.parse(texts[paths[0]]), design = postcss.parse(texts[paths[1]]);
const responsive = postcss.parse(texts[paths[2]]), copy = postcss.parse(texts[paths[3]]);
const rules = sheet => { const found = []; sheet.walkRules(rule => found.push(rule)); return found; };
const declarations = rule => Object.fromEntries((rule.nodes ?? []).filter(node => node.type === "decl").map(node => [node.prop, node.value]));
const unconditional = (sheet, selector) => {
  const found = rules(sheet).filter(rule => rule.parent.type === "root" && rule.selectors.includes(selector));
  assert.ok(found.length, "missing unconditional rule: " + selector);
  return Object.assign({}, ...found.map(declarations));
};
const footer = ".project-document-dialog.new-document-dialog:not(.document-copy-dialog) > .modal-card > footer";

test("D recovery healthy: ordinary native controls retain title-qualified four-locale names", async () => {
  const source = texts[paths[4]], start = source.indexOf("  #ordinaryDocumentDialog(){");
  const end = source.indexOf("  #ordinaryDocumentRecovery(){", start);
  assert.ok(start >= 0 && end > start, "requires the actual conditional D ordinary recovery renderer");
  const dialog = source.slice(start, end);
  for (const fragment of ['<dialog class="modal project-document-dialog new-document-dialog"',
    'closedby="any" aria-labelledby="new-document-title"', '<form class="modal-card"',
    '@submit=${this.#createDocument}', '<h2 id="new-document-title">', '<label>Document name<input required',
    'role="status"', '<footer><button type="button" class="button ghost"',
    'const available=Boolean(original&&document&&(original.outcome==="created"||original.check==="found"));',
    'const blocked=this.#ordinaryOpenBlocked(),title=',
    'const openPrimary=available&&!owner.pending&&!blocked;',
    'class=${`button ${openPrimary?"primary":"secondary"} project-blank-original-open`}',
    'class=${`button ${openPrimary?"secondary":"primary"} project-blank-original-check`}',
    'html`<button type="submit" class=${`button ${openPrimary?"secondary":"primary"}`} ?disabled=${!this.#title.trim()||owner.pending}>',
    '?disabled=${owner.pending||original.check==="checking"} @click=${this.#checkOrdinaryDocument}',
    '@click=${this.#openOrdinaryDocument}', '@click=${this.#checkOrdinaryDocument}',
    'this.i18n.t("sessions.blank.discard")', '?disabled=${owner.pending||blocked}',
    'this.i18n.t("sessions.blank.openOriginal",undefined,{title})',
    'this.i18n.t("sessions.blank.checkOriginal",undefined,{title})', '\\u2068', '\\u2069'])
    assert.ok(dialog.includes(fragment), "preserve actual existing D semantics: " + fragment);
  assert.ok(!dialog.includes("<details") && !dialog.includes("<summary"));
  for (const path of ["src/components/design-system/localization.ts",
    ...["fr", "ar", "ja"].map(locale => "src/components/design-system/locales/" + locale + ".ts")]) {
    const catalog = await read(path);
    for (const key of ["sessions.blank.checkOriginal", "sessions.blank.openOriginal", "projects.blank.reviewOriginal"]) {
      const line = catalog.split("\n").find(value => value.trimStart().startsWith(JSON.stringify(key) + ":"));
      assert.ok(line?.includes("{title}"), path + " must preserve the current original title in " + key);
    }
    assert.ok(catalog.includes('"sessions.blank.discard":'));
  }
});

test("D recovery footer wraps natural-width peers instead of squeezing a single line", () => {
  const inherited = unconditional(base, ".project-document-dialog footer"), row = unconditional(base, footer);
  assert.equal(inherited.display, "flex"); assert.equal(inherited["justify-content"], "flex-end");
  assert.equal(row["min-inline-size"], "0"); assert.equal(row["flex-wrap"], "wrap");
  assert.equal(row["align-items"], "stretch"); assert.equal(row.gap, "var(--forma-cluster-gap)");
  const peers = unconditional(base, footer + " > .button");
  assert.equal(peers.flex, "0 1 auto"); assert.equal(peers["max-inline-size"], "100%");
  assert.equal(peers["align-self"], "stretch"); assert.equal(peers["white-space"], "normal");
  assert.equal(peers["overflow-wrap"], "anywhere");
  assert.equal(unconditional(design, ".button")["min-height"], "2.75rem");
  for (const style of [row, peers]) {
    for (const property of ["height", "block-size", "max-height", "max-block-size", "padding-inline", "flex-direction", "text-overflow", "line-clamp", "-webkit-line-clamp"])
      assert.equal(style[property], undefined, "retain natural sizing and one existing gutter: " + property);
    assert.notEqual(style.overflow, "hidden");
  }
});

test("D recovery healthy: Library wrapping, page gutters and Duplicate remain separate", () => {
  const family = unconditional(base, ".family-actions");
  assert.equal(family.display, "flex"); assert.equal(family["flex-wrap"], "wrap");
  assert.equal(unconditional(design, ":is(.page-header-actions,.family-actions,.generation-failure-actions,.forma-activity-header-actions) > :is(.button,.icon-button,forma-ui-button,forma-ui-icon-button,forma-ui-link)")["align-self"], "stretch");
  const library = texts[paths[5]], start = library.indexOf("  #importRecovery(owner=this.#importOwner){");
  const end = library.indexOf("  #", start + 4);
  assert.ok(start >= 0 && end > start, "requires the actual conditional D Library recovery renderer");
  const recovery = library.slice(start, end);
  for (const fragment of ['class="library-import-recovery"', 'aria-labelledby="library-import-original-title"',
    'id="library-import-original-title"', '<p role="status">', '<div class="family-actions">'])
    assert.ok(recovery.includes(fragment));
  assert.ok(library.includes('${!imported?this.#importRecovery(importOwner):nothing}'));
  assert.equal(unconditional(responsive, ".studio-subpage-body:not(.studio-subpage-body--chat)")["padding-inline"], "var(--page-gutter)");
  assert.ok(unconditional(design, ".library-body").padding.includes("var(--page-gutter)"));
  const contents = texts[paths[4]], bodyAt = contents.indexOf('<div class="studio-subpage-body">');
  const recoveryAt = contents.indexOf('${this.#ordinaryDocumentRecovery()}'), gridAt = contents.indexOf('<div class="document-library-grid">');
  assert.ok(bodyAt >= 0 && recoveryAt > bodyAt && gridAt > recoveryAt, "ordinary recovery stays inside the existing gutter owner");
  assert.equal(unconditional(copy, ".document-copy-dialog footer")["flex-wrap"], "wrap");
  assert.equal(unconditional(copy, ".document-copy-dialog footer")["justify-content"], "flex-end");
  assert.equal(unconditional(copy, ".document-copy-dialog .modal-card").overflow, "auto");
});

// D353 source/declaration contracts only. The existing retained-browser receipt
// proves the intent-title glyph collision; these cases do not measure text,
// execute the intake form, or certify keyboard/AT/zoom/RTL geometry.
test("D353 intake heading retains one named native Close and the shared logical control clearance", async () => {
  const source = await read("src/components/forma-projects.ts");
  const start = source.indexOf('<dialog class="modal project-create-dialog"');
  const end = source.indexOf("</dialog>", start);
  assert.ok(start >= 0 && end > start, "inspect the existing actual intake dialog renderer");
  const dialog = source.slice(start, end);
  assert.ok(dialog.includes('closedby="any" aria-labelledby="new-project-title"'));
  assert.ok(dialog.includes('<form class="modal-card wide project-intake"'));
  const headings = dialog.match(/<h2\b[^>]*>/gu) ?? [];
  assert.deepEqual(headings, ['<h2 id="new-project-title">'],
    "the localized chrome heading keeps its native identity and inherits the Close control's UI direction");
  assert.ok(dialog.includes('this.#intakeCopy(this.#intakePosture==="intent"&&!this.#intake?"outcome":"review")'),
    "intent and review reuse the same existing heading without changing their text");
  const close = dialog.match(/<button type="button" class="icon-button modal-close"[^>]*>/gu) ?? [];
  assert.equal(close.length, 1, "this dialog has one direct Close control, not the image viewer's two-control header");
  for (const fragment of ["aria-label=", 'this.i18n.t("action.close","Close")', "@click=", "this.#close"])
    assert.ok(close[0].includes(fragment), "retain the original native Close: " + fragment);
  assert.ok(dialog.indexOf(close[0]) < dialog.indexOf(headings[0]));
  assert.equal(unconditional(base, ".modal-card").position, "relative");
  assert.equal(unconditional(base, ".modal-card").overflow, "auto");
  assert.equal(unconditional(base, ".modal-close").position, "absolute");
  const control = unconditional(design, ".icon-button");
  assert.equal(control["min-width"], "2.75rem"); assert.equal(control["min-height"], "2.75rem");
  const logicalClose = unconditional(responsive, ".modal-close");
  assert.equal(logicalClose.right, "auto");
  assert.equal(logicalClose["inset-inline-end"], "1rem");
  const tokens = unconditional(responsive, ":root");
  assert.equal(tokens["--forma-hit-target"], "var(--forma-control-min-size, 2.75rem)");
  assert.equal(tokens["--forma-focus-clearance"], ".5rem");
  assert.equal(unconditional(responsive, ".context-set-picker-panel > header")["padding-inline-end"],
    "calc(var(--forma-hit-target) + var(--forma-focus-clearance))",
    "reuse the existing one-control logical-clearance convention");
  assert.equal(unconditional(design, ".modal-card h2")["font-size"], "clamp(1.65rem, 3vw, 2.75rem)",
    "the heading type scale is not reduced to disguise a collision");
});

test("D353 intake title reserves one logical Close slot and wraps without a typography or height override", async () => {
  const intake = postcss.parse(await read("src/components/forma-project-intake.css"));
  assert.equal(unconditional(intake, "forma-projects .project-intake")["min-inline-size"], "0",
    "the real existing intake stylesheet is loaded before the desired clearance assertion");
  const selector = "forma-projects .project-intake > h2";
  const heading = unconditional(intake, selector);
  const matches = rules(intake).filter(rule => rule.selectors.includes(selector));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].parent.type, "root",
    "the same logical reservation applies in both postures, all locales and all viewport/pointer sizes");
  assert.deepEqual(matches[0].selectors, [selector],
    "do not broaden this observed intake fix to unrelated authored dir-auto modal headings");
  assert.deepEqual(heading, {
    "min-inline-size": "0",
    "padding-inline-end": "calc(var(--forma-hit-target) + var(--forma-focus-clearance))",
    "white-space": "normal",
    "overflow-wrap": "anywhere",
  }, "reserve readable title content space; do not shrink type, truncate, clip, move Close or force a height");
});

// D388 source/declaration contracts only. Actual retained D358 browser evidence
// showed one stretched native checkbox and a 40.75px label at confirmed 200%.
// These cases preserve native markup/guards and check reusable declarations;
// they do not measure geometry, activate a label, or certify keyboard/AT.
const d388Choice = ":is(forma-projects .project-intake, forma-output-requirements .output-recipe-entry) label.ui-choice";
const d388RecipeRenderers = async () => {
  const result = [];
  for (const [path, startMarker, endMarker] of [
    ["src/components/forma-projects.ts", "  #recipePicker(){", "\n  #intakeCopy("],
    ["src/components/forma-output-requirements.ts", "  #recipeEntry(snapshot: OutputRequirementsSnapshot | null) {", "\n  #retryRecipeSave("],
  ]) {
    const source = await read(path), start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, "inspect the actual current recipe renderer: " + path);
    result.push(source.slice(start, end));
  }
  return result;
};

test("D388 recipe choices retain native inputs, authored selection guards and the existing full-label primitive", async () => {
  const [intake, output] = await d388RecipeRenderers();
  for (const fragment of [
    '<fieldset ?disabled=${!this.#intakeEditable()}><legend>${outcomeRecipeDraftMessage(this.i18n.locale,"choices")}</legend>',
    'outcomeRecipeFileChoices(this.#intakeRecipeId).map(choice=>html`',
    '<input type="checkbox" data-intake-recipe-file=${choice.key} .checked=${this.#intakeRecipeChoices.has(choice.key)} @change=${(event:Event)=>{',
    'if(!this.#intakeEditable()||this.#intakeComposing)return;',
    'if((event.target as HTMLInputElement).checked)this.#intakeRecipeChoices.add(choice.key);else this.#intakeRecipeChoices.delete(choice.key);this.requestUpdate();',
    '${labels.choices[choice.key]}',
    'outcomeRecipeDraftMessage(this.i18n.locale,"limitation")',
  ]) assert.ok(intake.includes(fragment), "preserve actual intake recipe semantics: " + fragment);
  for (const fragment of [
    'if (this.blockId || this.surface !== "document" || this.inspectionOnly || !snapshot?.permissions.canAuthor && !retained) return nothing;',
    'const blocked = !this.#recipeInputEditable();',
    '<fieldset ?disabled=${blocked}><legend>${this.#recipeMessage("choices")}</legend>',
    'outcomeRecipeFileChoices(this.#recipeId).map(choice => html`',
    '<input type="checkbox" .checked=${this.#recipeChoices.has(choice.key)} @change=${(event: Event) => {',
    'if (!this.#recipeInputEditable()) return;\n          this.#recipeEntryEdited();\n          if ((event.target as HTMLInputElement).checked) this.#recipeChoices.add(choice.key); else this.#recipeChoices.delete(choice.key); this.requestUpdate();',
    '${outcomeRecipeDraftLabels(this.i18n.locale, "").choices[choice.key]}',
  ]) assert.ok(output.includes(fragment), "preserve actual Document recipe semantics: " + fragment);
  for (const renderer of [intake, output]) {
    assert.equal((renderer.match(/<input type="checkbox"/gu) ?? []).length, 1);
    assert.ok(!renderer.includes('role="checkbox"') && !renderer.includes("<forma-ui-checkbox"),
      "keep the existing native input and enclosing label, not a replacement control or event API");
  }
  const primitive = unconditional(design, ".ui-choice"), input = unconditional(design, ".ui-choice > input");
  assert.equal(primitive.display, "flex");
  assert.equal(primitive["min-block-size"], "var(--forma-control-min-size,2.75rem)");
  assert.equal(input["inline-size"], "1.125rem"); assert.equal(input["block-size"], "1.125rem");
  assert.equal(input.flex, "0 0 auto");
  assert.equal(unconditional(base, ".project-create-dialog label").display, "grid",
    "the observed bare-label modal cascade is present before any desired alias assertion");
  const outputCss = postcss.parse(await read("src/components/forma-output-requirements.css"));
  assert.equal(unconditional(outputCss, "forma-output-requirements .output-recipe-entry fieldset label")["min-block-size"],
    "var(--forma-control-min-size,2.75rem)", "Document's existing full-label floor must not be removed");
  assert.equal(unconditional(outputCss, ".output-requirements input[type=\"checkbox\"]")["inline-size"], "1.2rem",
    "cover the stronger inherited nonempty/retained Document checkbox rule as well as the empty entry");
});

test("D388 both recipe mappings use the shared native choice label with one wrapping text span", async () => {
  const [intake, output] = await d388RecipeRenderers();
  for (const [renderer, copy] of [
    [intake, "${labels.choices[choice.key]}"],
    [output, '${outcomeRecipeDraftLabels(this.i18n.locale, "").choices[choice.key]}'],
  ]) {
    assert.ok(renderer.includes('<label class="ui-choice"><input type="checkbox"'),
      "the current native checkbox and text must share the existing full-label choice primitive");
    assert.ok(renderer.includes("}}><span>" + copy + "</span></label>"),
      "the unchanged authored/localized choice text has exactly one direct wrapping span after its native input");
    assert.equal((renderer.match(/<label class="ui-choice">/gu) ?? []).length, 1);
    assert.equal((renderer.match(/<span>/gu) ?? []).length, 1);
    assert.equal((renderer.match(/<\/span>/gu) ?? []).length, 1);
  }
});

test("D388 scoped choice aliases beat both inherited layouts without shrinking, clipping or detaching text", () => {
  const sharedLabelRules = rules(design).filter(rule => rule.parent.type === "root" && rule.selectors.includes(".ui-choice"));
  const sharedInputRules = rules(design).filter(rule => rule.parent.type === "root" && rule.selectors.includes(".ui-choice > input"));
  assert.equal(sharedLabelRules.length, 1); assert.equal(sharedInputRules.length, 1);
  assert.deepEqual(sharedLabelRules[0].selectors, [".ui-choice", d388Choice],
    "reuse the original label declaration block through only the two D recipe contexts");
  assert.deepEqual(sharedInputRules[0].selectors, [".ui-choice > input", d388Choice + " > input"],
    "reuse the original finite native glyph declaration block; no global input or modal rule change");
  const row = unconditional(design, d388Choice), input = unconditional(design, d388Choice + " > input");
  const copy = unconditional(design, d388Choice + " > span");
  assert.deepEqual(row, { ...unconditional(design, ".ui-choice"), "min-inline-size": "0", "flex-wrap": "nowrap" });
  assert.deepEqual(input, unconditional(design, ".ui-choice > input"));
  assert.deepEqual(copy, { "min-inline-size": "0", "white-space": "normal", "overflow-wrap": "anywhere" },
    "keep the glyph beside text, while the sentence itself wraps at useful available width");
  assert.equal(unconditional(design, ".ui-choice > span").display, "grid");
  for (const [selector, expected] of [
    [d388Choice, 2], [d388Choice + " > input", 1], [d388Choice + " > span", 1],
  ]) assert.equal(rules(design).filter(rule => rule.selectors.includes(selector)).length, expected,
    "do not add hidden media-specific or competing recipe declarations: " + selector);
  for (const style of [row, copy]) {
    for (const property of ["height", "block-size", "max-height", "max-block-size", "overflow", "overflow-x",
      "overflow-y", "text-overflow", "line-clamp", "-webkit-line-clamp", "word-break", "position", "direction"])
      assert.equal(style[property], undefined, "preserve natural height, direction and visible content: " + property);
  }
});

// D428 R21: the retained narrow ordinary-PC screenshot shows the heading
// crossing Close/focus paint. The browser Range helper was not reached there.
// This additive source/declaration contract reuses D353; it is not geometry,
// keyboard, locale, recovery-state, or full-dialog physical acceptance.
test("D428 ordinary Project Contents heading reuses one logical Close slot without changing Copy or typography", async () => {
  const contents = texts[paths[4]], start = contents.indexOf("  #ordinaryDocumentDialog(){");
  const end = contents.indexOf("  #ordinaryDocumentRecovery(){", start);
  assert.ok(start >= 0 && end > start, "inspect the actual current ordinary creation/recovery renderer");
  const dialog = contents.slice(start, end);
  for (const fragment of [
    '<dialog class="modal project-document-dialog new-document-dialog"',
    'closedby="any" aria-labelledby="new-document-title"',
    '<form class="modal-card"',
    '@submit=${this.#createDocument}',
    '<button type="button" class="icon-button modal-close"',
    'aria-label=${this.i18n.t("action.close")} @click=${()=>this.#closeNew()}',
    '<label>Document name<input required maxlength="80"',
  ]) assert.ok(dialog.includes(fragment), "preserve the owned native ordinary form: " + fragment);
  assert.deepEqual(dialog.match(/<h2\b[^>]*>/gu) ?? [], ['<h2 id="new-document-title">'],
    "localized chrome and its Close keep the same inherited UI direction; do not generalize to authored dir-auto titles");
  assert.equal((dialog.match(/class="icon-button modal-close"/gu) ?? []).length, 1);
  assert.equal(unconditional(base, ".modal-card").position, "relative");
  assert.equal(unconditional(base, ".modal-card").overflow, "auto");
  assert.equal(unconditional(base, ".modal-close").position, "absolute");
  assert.equal(unconditional(design, ".icon-button")["min-width"], "2.75rem");
  assert.equal(unconditional(design, ".icon-button")["min-height"], "2.75rem");
  assert.equal(unconditional(design, ".modal-card h2")["font-size"], "clamp(1.65rem, 3vw, 2.75rem)");
  assert.equal(unconditional(responsive, ".modal-close").right, "auto");
  assert.equal(unconditional(responsive, ".modal-close")["inset-inline-end"], "1rem");
  assert.equal(unconditional(responsive, ":root")["--forma-hit-target"], "var(--forma-control-min-size, 2.75rem)");
  assert.equal(unconditional(responsive, ":root")["--forma-focus-clearance"], ".5rem");
  assert.equal(unconditional(copy, ".document-copy-dialog .modal-card").overflow, "auto");

  const intake = postcss.parse(await read("src/components/forma-project-intake.css"));
  const existing = unconditional(intake, "forma-projects .project-intake > h2");
  assert.deepEqual(existing, {
    "min-inline-size": "0",
    "padding-inline-end": "calc(var(--forma-hit-target) + var(--forma-focus-clearance))",
    "white-space": "normal",
    "overflow-wrap": "anywhere",
  }, "the existing D353 one-control treatment is a healthy prerequisite, not a new style system");

  const selector = ".project-document-dialog.new-document-dialog:not(.document-copy-dialog) > .modal-card > h2";
  const heading = unconditional(base, selector);
  const matches = rules(base).filter(rule => rule.selectors.includes(selector));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].parent.type, "root");
  assert.deepEqual(matches[0].selectors, [selector], "ordinary PC only; exclude the separately owned Copy dialog");
  assert.deepEqual(heading, existing,
    "reuse logical clearance and natural wrapping without font/height/Close/overflow/physical-side overrides");
});

// D428 R25: actual EN/FR 200% and AR 320 Library preview headings intersect
// the native Close clearance. These are source/declaration assertions only;
// the retained six-profile browser baseline remains the physical gate.
test("D428 Library import heading reuses the existing logical Close clearance without broadening authored titles", () => {
  const library = texts[paths[5]], start = library.indexOf('<dialog class="modal library-import-dialog"');
  const end = library.indexOf("</dialog>", start);
  assert.ok(start >= 0 && end > start, "inspect the actual owned Library archive preview");
  const dialog = library.slice(start, end);
  for (const fragment of [
    'closedby="any" aria-labelledby="import-title"',
    '<div class="modal-card">',
    '<button class="icon-button modal-close"',
    'aria-label=${this.i18n.t("projects.closePreview","Close preview")}',
    '<div class="metric-grid">',
    'this.#importRecovery(importOwner)',
    '?disabled=${importOwner.pending||Boolean(importOwner.original)}',
    'aria-busy=${String(importOwner.pending)}',
    '@click=${()=>this.#forkImport(importOwner)}',
  ]) assert.ok(dialog.includes(fragment), "preserve native preview ownership and controls: " + fragment);
  assert.deepEqual(dialog.match(/<h2\b[^>]*>/gu) ?? [], ['<h2 id="import-title">'],
    "localized chrome inherits the Close direction; do not generalize to authored dir-auto titles");
  assert.equal((dialog.match(/class="icon-button modal-close"/gu) ?? []).length, 1);
  assert.equal(unconditional(base, ".modal-card").position, "relative");
  assert.equal(unconditional(base, ".modal-card").overflow, "auto");
  assert.equal(unconditional(base, ".modal-close").position, "absolute");
  assert.equal(unconditional(design, ".icon-button")["min-width"], "2.75rem");
  assert.equal(unconditional(design, ".icon-button")["min-height"], "2.75rem");
  assert.equal(unconditional(design, ".modal-card h2")["font-size"], "clamp(1.65rem, 3vw, 2.75rem)");
  assert.equal(unconditional(responsive, ".modal-close").right, "auto");
  assert.equal(unconditional(responsive, ".modal-close")["inset-inline-end"], "1rem");
  const existing = unconditional(base, ".project-document-dialog.new-document-dialog:not(.document-copy-dialog) > .modal-card > h2");
  assert.deepEqual(existing, {
    "min-inline-size": "0",
    "padding-inline-end": "calc(var(--forma-hit-target) + var(--forma-focus-clearance))",
    "white-space": "normal",
    "overflow-wrap": "anywhere",
  }, "reuse the already-qualified one-control treatment before checking the missing Library rule");

  const selector = "dialog.library-import-dialog > .modal-card > h2";
  const heading = unconditional(base, selector);
  const matches = rules(base).filter(rule => rule.selectors.includes(selector));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].parent.type, "root");
  assert.deepEqual(matches[0].selectors, [selector],
    "only the native Library archive preview; retain the separate PC and authored-preview scopes");
  assert.deepEqual(heading, existing,
    "preserve fonts, natural height, copy, native Close, scrolling and logical direction");
});
