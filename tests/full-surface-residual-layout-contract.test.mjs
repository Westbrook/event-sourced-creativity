import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

// Post-E2 source/declaration contracts, not rendered dimensions, native input or AT.
// Reuse the installed layout suites' PostCSS dependency and exact-rule inspection.
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const paths = [
  "src/components/output-card.css", "src/components/output-card.ts",
  "src/components/design-system/feedback.ts", "src/components/modal-dialog.ts",
  "src/design-system.css", "src/styles.css", "src/responsive-foundation.css",
  "src/canvas/canvas.css", "src/canvas/canvas-application.ts", "src/model/document-artifacts.ts",
];
const texts = Object.fromEntries(await Promise.all(paths.map(async path =>
  [path, await readFile(new URL("../" + path, import.meta.url), "utf8")])));
const sheets = Object.fromEntries(paths.filter(path => path.endsWith(".css")).map(path =>
  [path, postcss.parse(texts[path], { from: path })]));
const output = sheets["src/components/output-card.css"], design = sheets["src/design-system.css"];
const base = sheets["src/styles.css"], responsive = sheets["src/responsive-foundation.css"];
const canvas = sheets["src/canvas/canvas.css"];
const rules = sheet => { const found = []; sheet.walkRules(rule => found.push(rule)); return found; };
const declarations = rule => Object.fromEntries((rule.nodes ?? []).filter(node => node.type === "decl")
  .map(node => [node.prop, node.value]));
const unconditional = (sheet, selector) => {
  const found = rules(sheet).filter(rule => rule.parent.type === "root" && rule.selectors.includes(selector));
  assert.ok(found.length, "missing unconditional rule: " + selector);
  return Object.assign({}, ...found.map(declarations));
};
const popoverHost = ".output-actions-popover";
const popoverInner = popoverHost + " > .ui-popover";
const popoverTrigger = popoverInner + " > .ui-popover-trigger";
const proseViewer = '.canvas-artifact-viewer:not([data-output-focus="true"]):is([data-artifact-kind="short_story"],[data-artifact-kind="scene"],[data-artifact-kind="storyboard"])';
const proseCard = proseViewer + " > .canvas-artifact-viewer-card";
const focused = ':is(.canvas-artifact-viewer,.canvas-output-viewer)[data-output-focus="true"]';

test("E residual layout: More remains an actual named native popover beside direct actions", () => {
  const card = texts["src/components/output-card.ts"];
  assert.match(card, /<div class="output-actions">[\s\S]*<button type="button" class="output-open"[\s\S]*<button class="promote"[\s\S]*<forma-ui-popover class="output-actions-popover"/);
  assert.ok(card.includes('const groupActions=Boolean(out.mediaUrl&&canAuthor)'));
  assert.ok(card.includes('this.i18n.t("artifact.delivery.namedAction","{action} — {name}"'));
  assert.ok(card.includes('this.i18n.t("action.more","More actions"),name:actionContext'));
  const feedback = texts["src/components/design-system/feedback.ts"];
  const popover = feedback.slice(feedback.indexOf("export class FormaUiPopover"), feedback.indexOf("export class FormaUiDialog"));
  assert.ok(popover.includes('<div class="ui-popover"'));
  assert.ok(popover.includes('<button type="button" id='));
  assert.ok(popover.includes('class="button secondary ui-popover-trigger" popovertarget='));
  assert.ok(popover.includes('class="ui-popover-panel" popover="auto"'));
  assert.ok(popover.includes("aria-controls=") && popover.includes("aria-expanded="));
  assert.ok(popover.includes("@beforetoggle=") && popover.includes("@toggle="));
  assert.ok(!popover.includes("<details") && !popover.includes("<summary"));
  assert.equal(unconditional(base, ".output-actions").display, "flex");
  assert.equal(unconditional(responsive, ".output-actions")["flex-wrap"], "wrap");
});

test("E residual layout: the More host, inner wrapper and native trigger pass peer stretch through", () => {
  const host = unconditional(output, popoverHost), inner = unconditional(output, popoverInner);
  const trigger = unconditional(output, popoverTrigger);
  assert.equal(host.display, "flex");
  assert.equal(host["align-self"], "stretch");
  assert.equal(host["min-inline-size"], "0");
  assert.equal(host["max-inline-size"], "100%");
  assert.equal(inner.display, "flex");
  assert.equal(inner.flex, "1 1 auto");
  assert.equal(inner["min-inline-size"], "0");
  assert.equal(trigger.flex, "1 1 auto");
  assert.equal(trigger["align-self"], "stretch");
  for (const style of [host, inner, trigger])
    for (const property of ["height", "block-size", "max-height", "max-block-size", "overflow"])
      assert.equal(style[property], undefined, "stretch must not be replaced with a fixed height or clipping");
  const stretchRules = rules(output).filter(rule => {
    const value = declarations(rule);
    return value.flex !== undefined || value["align-self"] !== undefined;
  });
  assert.deepEqual(stretchRules.flatMap(rule => rule.selectors), [popoverHost, popoverInner, popoverTrigger]);
});

test("E residual layout: More keeps wrapping target floors and a separately bounded top-layer panel", () => {
  const trigger = unconditional(output, ".output-actions-popover .ui-popover-trigger");
  assert.equal(trigger["min-inline-size"], "var(--forma-control-min-size,2.75rem)");
  assert.equal(trigger["min-block-size"], trigger["min-inline-size"]);
  assert.equal(trigger["white-space"], "normal");
  assert.equal(trigger["overflow-wrap"], "anywhere");
  assert.equal(trigger["text-align"], "start");
  const scopedPanel = unconditional(output, ".output-actions-popover .ui-popover-panel");
  assert.deepEqual(scopedPanel, { "inline-size": "min(24rem,calc(100dvi - 1rem))" });
  const panel = unconditional(design, ".ui-popover-panel[popover]");
  assert.equal(panel.position, "fixed");
  assert.equal(panel.overflow, "auto");
  assert.equal(panel["max-block-size"], "min(24rem,var(--forma-popover-max-height,calc(100dvh - 1rem)))");
  assert.equal(unconditional(design, ".ui-popover-panel[popover]:not(:popover-open)").display, "none");
  assert.equal(unconditional(design, ".ui-popover").display, "inline-block", "unrelated popovers retain the shared default");
});

test("E residual layout: Rename retains its real localized native form, field and action order", () => {
  const source = texts["src/components/modal-dialog.ts"];
  const textDialog = source.slice(source.indexOf("export function requestDialogText("));
  for (const fragment of [
    'dialog.lang = locale.locale;', 'dialog.dir = locale.direction;',
    'dialog.setAttribute("closedby", "any");', 'dialog.setAttribute("aria-labelledby", heading.id);',
    'form.className = "modal-card shared-text-dialog-card";', 'form.method = "dialog";',
    'input.required = true;', 'label.append(labelText, input);', 'cancel.type = "button";',
    'cancel.className = "button ghost";', 'confirm.className = "button primary";',
    'footer.append(cancel, confirm);', 'form.append(heading, label, footer);',
    'ensureModalDialog(dialog);', 'input.focus();', 'input.select();',
  ]) assert.ok(textDialog.includes(fragment), fragment);
  assert.ok(textDialog.includes('locale.messages["action.cancel"]'));
  assert.ok(textDialog.includes('locale.messages["action.save"]'));
  assert.equal(unconditional(design, ".button")["min-height"], "2.75rem");
  assert.equal(unconditional(design, ".shared-text-dialog-card").display, "grid");
  assert.equal(unconditional(design, ".shared-text-dialog-card").width, "min(30rem,calc(100vw - 2rem))");
  assert.equal(unconditional(design, ".ui-dialog-card > header")["align-items"], "center");
});

test("E residual layout: the existing Rename footer wraps without a separate control metric", () => {
  const footer = unconditional(design, ".shared-text-dialog-card>footer");
  assert.equal(footer.display, "flex");
  assert.equal(footer["flex-wrap"], "wrap");
  assert.equal(footer["justify-content"], "flex-end");
  assert.equal(footer.gap, "var(--space-3)");
  assert.ok(footer["align-items"] === undefined || footer["align-items"] === "stretch");
  for (const property of ["height", "block-size", "max-height", "max-block-size", "overflow"])
    assert.equal(footer[property], undefined);
});

test("E residual layout: ordinary prose and storyboard viewer sections use one logical card inset", () => {
  const kinds = texts["src/model/document-artifacts.ts"].match(/DOCUMENT_ARTIFACT_KINDS = \[([^\]]+)\]/)?.[1];
  assert.ok(kinds);
  for (const kind of ["short_story", "scene", "storyboard"]) assert.ok(kinds.includes('"' + kind + '"'));
  const host = texts["src/canvas/canvas-application.ts"];
  assert.ok(host.includes("data-output-focus=" + "$" + "{String(this.#viewerFocused)}"));
  assert.ok(host.includes("data-artifact-kind=" + "$" + "{artifact.kind}"));
  assert.ok(host.includes('<article class="modal-card canvas-artifact-viewer-card">'));
  const owner = unconditional(canvas, proseCard), header = unconditional(canvas, proseCard + " > header");
  assert.deepEqual(owner, { "--canvas-artifact-viewer-inset": "var(--forma-card-inset,1.25rem)" });
  assert.deepEqual(header, { "padding-inline-start": "var(--canvas-artifact-viewer-inset)" });
  for (const child of [" > .canvas-artifact-viewer-content", " > footer"])
    assert.deepEqual(unconditional(canvas, proseCard + child), { "padding-inline": header["padding-inline-start"] });
  const scoped = rules(canvas).filter(rule => rule.selector.includes(proseViewer));
  assert.equal(scoped.length, 3);
  for (const rule of scoped) {
    assert.equal(rule.parent.type, "root");
    assert.ok(!rule.selector.includes('kind="slides"') && !rule.selector.includes('kind="audio"')
      && !rule.selector.includes('kind="video"') && !rule.selector.includes(".canvas-output-viewer"));
  }
  assert.equal(unconditional(canvas, ".canvas-artifact-viewer-card").padding, "0");
  assert.equal(unconditional(responsive, ":root")["--forma-card-inset"], "clamp(1rem, 1.5vi, 1.25rem)");
});

test("E residual layout: viewer scrolling, media fit, focus posture and icon-end reservations remain separate", () => {
  assert.equal(unconditional(canvas, ".canvas-artifact-viewer-card > header")["padding-inline-end"],
    "calc((var(--forma-control-min-size,2.75rem) * 2) + 3rem)");
  assert.equal(unconditional(canvas, ".canvas-output-viewer-card > header")["padding-inline-end"],
    "calc((var(--forma-control-min-size,2.75rem) * 2) + 3rem)");
  assert.equal(unconditional(canvas, ".canvas-artifact-viewer-content").overflow, "auto");
  assert.equal(unconditional(canvas, ".canvas-artifact-viewer-content--slides").padding, "0");
  assert.equal(unconditional(canvas, ".canvas-artifact-viewer-content--slides>forma-presentation-deck").height, "100%");
  assert.equal(unconditional(canvas, ".canvas-artifact-viewer-content>pre")["max-width"], "52rem");
  assert.equal(unconditional(canvas, ".canvas-artifact-storyboard img")["aspect-ratio"], "16/9");
  assert.equal(unconditional(canvas, ".canvas-artifact-viewer .forma-video-reel-player")["object-fit"], "contain");
  assert.equal(unconditional(canvas, ".canvas-output-viewer-stage forma-output-visual")["object-fit"], "contain");
  assert.equal(unconditional(canvas, focused + " > .modal-card > header")["padding-inline-start"], ".8rem");
  assert.equal(unconditional(canvas, focused + " > .modal-card > header")["padding-inline-end"],
    "calc((var(--forma-control-min-size,2.75rem) * 2) + 2.5rem)");
  assert.equal(unconditional(canvas, focused + " > .modal-card > footer").display, "none");
  assert.equal(unconditional(canvas, '.canvas-artifact-viewer[data-output-focus="true"] .presentation-deck-viewport > .presentation-deck-frame')["inline-size"],
    "min(100cqi,calc(100cqb * 1.7778))");
});

test("F banner source layout: the shell alert wraps without replacing base typography or workbench flow", () => {
  assert.deepEqual(unconditional(responsive, ".app-shell > .error-banner"), {
    "min-inline-size": "0", "flex-wrap": "wrap", "overflow-wrap": "anywhere",
  });
  const original = unconditional(base, ".error-banner");
  assert.equal(original.display, "flex");
  assert.equal(original.padding, "9px");
  assert.equal(original["font-size"], "var(--type-caption)");
  assert.equal(unconditional(base, ".error-banner button")["text-decoration"], "underline");
  const workbench = '.application-creative[data-layout-intent="workbench"] > :is(.topbar, .application-task-navigation, .impersonation-banner, .error-banner)';
  assert.deepEqual(unconditional(responsive, workbench), { flex: "none" });
});

test("F banner source layout: only the two existing fixed side-rail predicates reserve inline space", () => {
  const measured = '.application-creative[data-nav-posture="rail"][data-short-height="true"]';
  const fallback = ".application-creative";
  const reservations = rules(responsive).filter(rule => rule.selector.includes(".error-banner")
    && declarations(rule)["margin-inline-start"] !== undefined);
  assert.deepEqual(reservations.map(rule => rule.selector), [
    measured + " > .error-banner", fallback + " > .error-banner",
  ]);
  assert.equal(reservations[0].parent.type, "root");
  assert.equal(reservations[1].parent.type, "atrule");
  assert.equal(reservations[1].parent.name, "media");
  assert.equal(reservations[1].parent.params, "(max-height: 37.5rem) and (orientation: landscape)");
  for (const [index, prefix] of [measured, fallback].entries()) {
    const reservation = reservations[index];
    assert.deepEqual(declarations(reservation), { "margin-inline-start": "var(--forma-landscape-rail-width)" });
    const siblingRule = selector => {
      const found = rules(responsive).filter(rule => rule.parent === reservation.parent && rule.selectors.includes(selector));
      assert.equal(found.length, 1, "one same-scope rule must own " + selector);
      return declarations(found[0]);
    };
    const navigation = siblingRule(prefix + ' > .application-task-navigation[data-primary-navigation="true"]');
    assert.equal(navigation.position, "fixed");
    assert.equal(navigation["inset-inline-start"], "0");
    assert.equal(navigation["inline-size"], "var(--forma-landscape-rail-width)");
    assert.equal(siblingRule(prefix + " > #main-content")["padding-inline-start"], "var(--forma-landscape-rail-width)");
  }
  assert.equal(unconditional(responsive, ":root")["--forma-landscape-rail-width"],
    "calc(var(--forma-nav-rail-width) + var(--forma-safe-inline-start))");
  assert.equal(unconditional(responsive, ':root[dir="rtl"]')["--forma-safe-inline-start"],
    "env(safe-area-inset-right, 0px)");
});
