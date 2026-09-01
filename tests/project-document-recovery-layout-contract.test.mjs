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
