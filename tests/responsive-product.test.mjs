import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APPLICATIONS, applicationAccessible, applicationIdFromRoute, navigationItemActive, resolveServerRoute, routeRequiredCapabilities } from "../src/platform/applications.ts";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../src/model/routes.ts";
import { formaActivityAttention, formaActivityUnread, scopedFormaActivity } from "../src/model/activity.ts";
import { routeCapabilities } from "../src/state/route-capabilities.ts";
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM, canvasPinchViewport } from "../src/canvas/viewport-preferences.ts";
import { FORMA_RESPONSIVE_MESSAGES } from "../src/components/design-system/locales/responsive-messages.ts";
import french from "../src/components/design-system/locales/fr.ts";
import arabic from "../src/components/design-system/locales/ar.ts";
import japanese from "../src/components/design-system/locales/ja.ts";

const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [base, design, responsive, canvas, focal, shell, creativeEntry, studio, chat, activity, deliver, publicShare, localization] = await Promise.all([
  read("../src/styles.css"),
  read("../src/design-system.css"),
  read("../src/responsive-foundation.css"),
  read("../src/canvas/canvas.css"),
  read("../src/focal-point-lab.css"),
  read("../src/components/forma-shell.ts"),
  read("../src/apps/creative/entry.ts"),
  read("../src/components/studio-navigation.ts"),
  read("../src/components/forma-chat-studio.ts"),
  read("../src/components/forma-activity.ts"),
  read("../src/components/forma-deliver.ts"),
  read("../src/components/forma-shared-view.ts"),
  read("../src/components/design-system/localization.ts"),
]);

const [workspace, projectContents, projectRail, canvasApplication, slottedComponents, componentCatalog, artifacts, accessManagement, library] = await Promise.all([
  read("../src/components/forma-workspace.ts"),
  read("../src/components/forma-project-contents.ts"),
  read("../src/components/project-rail.ts"),
  read("../src/canvas/canvas-application.ts"),
  read("../src/components/design-system/slotted-element.ts"),
  read("../src/components/design-system/component-catalog.css"),
  read("../src/components/document-artifacts.ts"),
  read("../src/apps/operations/access-management.ts"),
  read("../src/components/forma-library.ts"),
]);

const sheets = [["styles.css", base], ["design-system.css", design], ["responsive-foundation.css", responsive], ["canvas.css", canvas], ["focal-point-lab.css", focal]]
  .map(([name, source]) => ({ name, root: postcss.parse(source, { from: name }) }));

const viewports = [
  { name: "small portrait phone", width: 320, height: 568, pointer: "coarse" },
  { name: "portrait phone", width: 390, height: 844, pointer: "coarse" },
  { name: "landscape phone", width: 844, height: 390, pointer: "coarse" },
  { name: "portrait tablet", width: 768, height: 1024, pointer: "coarse" },
  { name: "landscape tablet", width: 1024, height: 768, pointer: "coarse" },
  { name: "small laptop", width: 1280, height: 800, pointer: "fine" },
  { name: "large monitor", width: 1920, height: 1080, pointer: "fine" },
  { name: "narrow desktop window", width: 760, height: 900, pointer: "fine" },
  { name: "shallow desktop window", width: 1280, height: 390, pointer: "fine" },
];

function mediaMatches(params, viewport) {
  return params.split(",").some((branch) => {
    for (const match of branch.matchAll(/\((min|max)-(width|height)\s*:\s*([\d.]+)(px|rem)\)/g)) {
      const [, bound, dimension, number, unit] = match;
      const threshold = Number(number) * (unit === "rem" ? 16 : 1);
      if (bound === "max" ? viewport[dimension] > threshold : viewport[dimension] < threshold) return false;
    }
    const orientation = branch.match(/\(orientation\s*:\s*(portrait|landscape)\)/)?.[1];
    if (orientation && orientation !== (viewport.width > viewport.height ? "landscape" : "portrait")) return false;
    const pointer = branch.match(/\(pointer\s*:\s*(coarse|fine|none)\)/)?.[1];
    if (pointer && pointer !== viewport.pointer) return false;
    if (/\(forced-colors\s*:\s*active\)|\(prefers-reduced-motion\s*:\s*reduce\)/.test(branch)) return false;
    return true;
  });
}

function ruleActive(rule, viewport, container) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name === "media" && !mediaMatches(parent.params, viewport)) return false;
    if (container && parent.type === "atrule" && parent.name === "container") {
      const name = parent.params.match(/^([\w-]+)\s+\(/)?.[1];
      if (name && name !== container.name) continue;
      if (!mediaMatches(parent.params, { ...viewport, width: container.width })) return false;
    }
  }
  return true;
}

function specificity(selector) {
  let simplified = selector.replace(/:where\([^)]*\)/g, "");
  const functional = [0, 0, 0];
  const compare = (left, right) => left.map((value, index) => value - right[index]).find((value) => value !== 0) ?? 0;
  simplified = simplified.replace(/:(?:is|not|has)\(([^()]*)\)/g, (_, argumentsList) => {
    const strongest = argumentsList.split(",").map((argument) => specificity(argument.trim())).reduce((left, right) => compare(left, right) >= 0 ? left : right, [0, 0, 0]);
    for (let index = 0; index < functional.length; index++) functional[index] += strongest[index];
    return "";
  });
  const direct = [
    (simplified.match(/#[\w-]+/g) ?? []).length,
    (simplified.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length,
    (simplified.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g, "").match(/(^|[\s>+~])[\w-]+/g) ?? []).length,
  ];
  return direct.map((value, index) => value + functional[index]);
}

function winning(selectors, property, viewport, container) {
  const matching = new Set(Array.isArray(selectors) ? selectors : [selectors]);
  let winner;
  let order = 0;
  for (const sheet of sheets) sheet.root.walkRules((rule) => {
    if (!ruleActive(rule, viewport, container)) return;
    for (const selector of rule.selectors ?? []) {
      if (!matching.has(selector)) continue;
      const weight = specificity(selector);
      rule.walkDecls(property, (declaration) => {
        const next = { value: declaration.value, important: Boolean(declaration.important), weight, order: order++, selector, file: sheet.name };
        if (!winner) { winner = next; return; }
        if (next.important !== winner.important) { if (next.important) winner = next; return; }
        const comparison = next.weight.map((value, index) => value - winner.weight[index]).find((value) => value !== 0) ?? 0;
        if (comparison > 0 || comparison === 0 && next.order > winner.order) winner = next;
      });
    }
  });
  return winner;
}

test("document workbench hosts and grid tracks remain bounded at every viewport", () => {
  const studioMain = '.workspace-page[data-workbench="document"] > .studio-main';
  const routeHosts = [
    '.application-creative[data-layout-intent="workbench"] > #main-content > forma-creative-application',
    '.application-creative[data-layout-intent="workbench"] > #main-content > forma-creative-application > forma-workspace',
  ];
  const boundedChildren = [
    ".studio-header-stack",
    ".studio-header-stack > forma-studio-mode-nav",
    ".studio-mode-nav",
    ".document-workbench-tasks",
    ".studio-grid",
    ".composer-dock",
    ".composer",
    ".composer-command",
    "forma-generation-actions",
    ".generation-actions",
  ];
  const compactHeaderActions = '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"] .page-header--document .page-header-actions > *';
  const compactHeaderButtons = '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"] .page-header--document .page-header-actions > .button';

  for (const viewport of viewports) {
    assert.equal(winning("html", "min-width", viewport)?.value, "0", `${viewport.name}: root sizing leaves room for a visible scrollbar`);

    for (const selector of ["forma-shell", "forma-platform-shell", "forma-public-share"]) {
      assert.equal(winning(selector, "display", viewport)?.value, "block", `${viewport.name}: ${selector} is a measurable block host`);
      assert.equal(winning(selector, "inline-size", viewport)?.value, "100%", `${viewport.name}: ${selector} uses the available viewport`);
      assert.equal(winning(selector, "min-inline-size", viewport)?.value, "0", `${viewport.name}: ${selector} may shrink`);
      assert.equal(winning(selector, "max-inline-size", viewport)?.value, "100%", `${viewport.name}: ${selector} stays bounded`);
    }

    assert.equal(winning(studioMain, "grid-template-columns", viewport)?.value, "minmax(0, 1fr)", `${viewport.name}: navigation cannot inflate the implicit workbench column`);

    for (const selector of [...routeHosts, ...boundedChildren]) {
      assert.equal(winning(selector, "min-inline-size", viewport)?.value, "0", `${viewport.name}: ${selector} may shrink`);
      assert.equal(winning(selector, "max-inline-size", viewport)?.value, "100%", `${viewport.name}: ${selector} stays bounded`);
    }

    assert.equal(winning(compactHeaderActions, "flex", viewport)?.value, "0 0 auto", `${viewport.name}: compact toolbar actions keep their natural width`);
    assert.match(winning(compactHeaderActions, "min-inline-size", viewport)?.value ?? "", /--forma-hit-target/, `${viewport.name}: compact toolbar actions remain touch-sized`);
    assert.equal(winning(compactHeaderButtons, "white-space", viewport)?.value, "nowrap", `${viewport.name}: short toolbar labels never collapse letter by letter`);
    assert.equal(winning(compactHeaderButtons, "overflow-wrap", viewport)?.value, "normal", `${viewport.name}: compact toolbar labels scroll inside their strip`);
  }

  assert.equal(winning(".document-workbench-tasks", "overflow-x", viewports[0])?.value, "auto", "overflowing task choices scroll inside their bounded strip");
});

test("fixed generation controls respond to their dock instead of overflowing narrow panes", () => {
  const desktop = viewports.find((viewport) => viewport.name === "large monitor");
  const narrowDock = { name: "composer-dock", width: 560 };
  const tabletDock = { name: "composer-dock", width: 937 };
  const details = ".composer .generation-actions > .generation-details-trigger";

  assert.equal(winning(".composer-dock", "container", desktop)?.value, "composer-dock / inline-size");
  assert.equal(winning(".composer", "flex-wrap", desktop, narrowDock)?.value, "wrap");
  assert.equal(winning(details, "flex-wrap", desktop, tabletDock)?.value, "wrap", "tablet-sized docks wrap long generation labels without inflating the complete composer");
  assert.equal(winning(".composer-command", "flex", desktop, narrowDock)?.value, "1 1 100%");
  assert.equal(winning(".composer > forma-generation-actions", "flex", desktop, narrowDock)?.value, "1 1 100%");
  assert.equal(winning(".composer .generation-actions", "grid-template-columns", desktop, narrowDock)?.value, "repeat(2, minmax(0, 1fr))");
  assert.equal(winning(details, "grid-column", desktop, narrowDock)?.value, "1 / -1");
  assert.equal(winning(details, "white-space", desktop, narrowDock)?.value, "normal");
  assert.equal(winning(details, "max-inline-size", desktop, narrowDock)?.value, "100%");
});

test("production workflows adapt to their actual artifact pane instead of the outer viewport", () => {
  const desktop = viewports.find((viewport) => viewport.name === "large monitor");
  const narrowPane = { name: "document-artifacts", width: 480 };

  assert.equal(winning(".document-artifacts", "container", desktop)?.value, "document-artifacts / inline-size");
  assert.equal(winning(".production-workflow-form", "grid-template-columns", desktop, narrowPane)?.value, "minmax(0,1fr)");
  assert.equal(winning(".production-workflow-header", "grid-template-columns", desktop, narrowPane)?.value, "minmax(0,1fr)");
  assert.equal(winning(".production-workflow-footer", "flex-direction", desktop, narrowPane)?.value, "column");
  assert.equal(winning(".production-workflow-footer > .button", "inline-size", desktop, narrowPane)?.value, "100%");
  assert.equal(winning(".production-workflow-footer > .button", "white-space", desktop, narrowPane)?.value, "normal");
  assert.equal(winning(".production-workflow-footer > small", "flex", desktop, narrowPane)?.value, "1 1 auto");
});

test("E Library narrow header keeps native file-picker peers content-led before wrapping", () => {
  // Source/cascade contract only; existing native file actions and physical fit remain separate gates.
  const start = library.indexOf('<header class="page-header page-header--library">');
  const end = library.indexOf("</header>", start);
  assert.ok(start >= 0 && end > start, "inspect the actual shared Library header");
  const header = library.slice(start, end);
  assert.ok(header.includes('<div class="page-header-actions">'));
  assert.ok(header.includes('class="button primary" data-context-controls-id="__new__"'));
  assert.ok(header.includes('</form><button class="button secondary"'));
  for (const key of ["projects.newReusableBlock", "projects.importDocument", "projects.exportProject"])
    assert.ok(header.includes('this.i18n.t("' + key + '",'), "retain the actual localized peer: " + key);
  assert.match(header, /<form @submit=\$\{\(event:SubmitEvent\)=>event\.preventDefault\(\)\}><label class="button secondary file-button">[\s\S]*?<input type="file" accept="application\/json" @change=\$\{this\.#import\}>/);

  const viewport = viewports.find(entry => entry.name === "portrait phone");
  assert.ok(viewport);
  // Reuse the existing portrait viewport as a declared Library container; this is not measured geometry.
  const container = { name: "library", width: viewport.width };
  const row = ".page-header--library .page-header-actions";
  const rows = ":is(.page-header-actions,.family-actions,.generation-failure-actions,.forma-activity-header-actions)";
  const fileForm = rows + ' > form:has(> label.button.file-button:only-child > input[type="file"])';
  const peers = [row + " > *", ".page-header.page-header--library .page-header-actions > *", ".page-header-actions > *"];
  const buttons = [...peers, "button", ".button", ".page-header-actions .button",
    rows + " > :is(.button,.icon-button,forma-ui-button,forma-ui-icon-button,forma-ui-link)"];
  // The later mobile descendant-button rule matches New/Export, but not the Import form.
  for (const [name, selectors] of [["New", [...buttons, ".button.primary"]], ["Import form", [...peers, fileForm]], ["Export", [...buttons, ".button.secondary"]]])
    assert.equal(winning(selectors, "flex", viewport, container)?.value, "1 1 auto",
      name + ": the complete actual peer cascade must retain a content-led basis");
  assert.equal(winning([row, ".page-header-actions"], "flex-wrap", viewport, container)?.value, "wrap");
  assert.equal(winning(fileForm, "display", viewport, container)?.value, "flex");
  assert.equal(winning(fileForm, "align-self", viewport, container)?.value, "stretch");
  assert.equal(winning(fileForm, "flex", viewport, container)?.value, undefined, "the peer row still owns allocation, not an unrelated form-wide override");
  const fileLabel = fileForm + " > label.button.file-button";
  const fileLabelRules = [".button", ".button.secondary", ".file-button", ".page-header-actions .button", fileLabel];
  assert.equal(winning(fileLabelRules, "flex", viewport, container)?.value, "1 1 auto", "the nested native label keeps its own stronger stretch rule");
  assert.equal(winning(fileLabel, "align-self", viewport, container)?.value, "stretch");
  assert.equal(winning(fileLabel, "white-space", viewport, container)?.value, "normal");
  assert.equal(winning(fileLabel, "overflow-wrap", viewport, container)?.value, "anywhere");
});

test("every posture keeps text, actions, and trailing icons inside a shared logical edge inset", () => {
  const insetCases = [
    [[".context-next-actions>button", ".context-column > .context-next-actions > button"], "--forma-pane-inset"],
    [[".document-combined-contexts > summary", ".context-column > .document-combined-contexts > summary"], "--forma-pane-inset"],
    [[".system-application-list>a", ".system-application-list > a"], "--forma-row-inset-inline"],
    [[".role-evidence > ol > li"], "--forma-row-inset-inline"],
    [[".generation-readiness > summary"], "--forma-row-inset-inline"],
    [[".generation-context-links > li > a"], "--forma-row-inset-inline"],
    [[".adapter-scenarios button"], "--forma-row-inset-inline"],
    [[".workspace-settings-list > li"], "--forma-row-inset-inline"],
    [[".analytics-review-list article"], "--forma-row-inset-inline"],
    [[".design-next-actions article"], "--forma-row-inset-inline"],
    [[".focal-lab-controls"], "--forma-row-inset-inline"],
    [[".document-card > :is(header, h3, p, .document-card-actions)"], "--forma-card-inset"],
    [[".asset-card > :is(.block-type, h3, p, div:last-child)"], "--forma-card-inset"],
    [[".library-output-actions"], "--forma-card-inset"],
    [[".document-artifact-jobs > span"], "--forma-row-inset-inline"],
    [[".text-button"], "--forma-control-inset-inline"],
    [[".icon-button.labeled"], "--forma-control-inset-inline"],
    [[".gate-review .button"], "--forma-control-inset-inline"],
    [[".reality-tools button"], "--forma-control-inset-inline"],
    [[".editor-toolbar button"], "--forma-control-inset-inline"],
    [[".creative-editor-item-main"], "--forma-control-inset-inline"],
    [[".decision-spine button"], "--forma-control-inset-inline"],
    [[".new-layer-button"], "--forma-control-inset-inline"],
    [[".canvas-source-list button", ".application-canvas .canvas-source-list button"], "--forma-row-inset-inline"],
    [[".canvas-semantic-dialog li button", ".application-canvas .canvas-semantic-dialog li button"], "--forma-row-inset-inline"],
    [[".canvas-source-batch-actions", ".application-canvas .canvas-source-batch-actions"], "--forma-row-inset-inline"],
  ];

  for (const viewport of viewports) {
    for (const [selectors, token] of insetCases) {
      const declaration = winning(selectors, "padding-inline", viewport);
      assert.ok(declaration?.value.includes(token), `${viewport.name}: ${selectors.join(" or ")} must resolve ${token}; got ${JSON.stringify(declaration)}`);
    }

    assert.match(winning(".document-generation-list > button > span", "padding-inline-end", viewport)?.value ?? "", /--forma-control-inset-inline/);
    assert.equal(winning(".document-artifact-list > button", "padding", viewport)?.value, "0", `${viewport.name}: artwork remains intentionally full bleed`);
    assert.equal(winning(".document-artifact-list > button > span", "padding", viewport)?.value, ".9rem 1rem 1rem", `${viewport.name}: full-bleed artwork retains its inset caption`);
    assert.equal(winning([".context-next-actions>button", ".context-column > .context-next-actions > button"], "text-align", viewport)?.value, "start");
    assert.equal(winning(".adapter-scenarios button", "text-align", viewport)?.value, "start");
    for (const selector of [".forma-activity-card", ".forma-deliver-card", ".forma-deliver-summary > div"]) {
      assert.equal(winning(selector, "padding", viewport)?.value, "var(--forma-card-inset)", `${viewport.name}: ${selector} respects density-aware surface spacing`);
    }
  }
});

test("safe-area gutters, scroll focus, and analytics separators adapt correctly to direction and width", () => {
  assert.equal(winning(":root", "--forma-safe-inline-start", viewports[0])?.value, "env(safe-area-inset-left, 0px)");
  assert.equal(winning(":root", "--forma-safe-inline-end", viewports[0])?.value, "env(safe-area-inset-right, 0px)");
  assert.equal(winning(':root[dir="rtl"]', "--forma-safe-inline-start", viewports[0])?.value, "env(safe-area-inset-right, 0px)");
  assert.equal(winning(':root[dir="rtl"]', "--forma-safe-inline-end", viewports[0])?.value, "env(safe-area-inset-left, 0px)");

  for (const viewport of viewports.filter((entry) => entry.width <= 760)) {
    assert.match(winning(".topbar", "padding-inline-start", viewport)?.value ?? "", /--forma-safe-inline-start/);
    assert.match(winning(".topbar", "padding-inline-end", viewport)?.value ?? "", /--forma-safe-inline-end/);
  }

  for (const selector of [".workspace-settings-navigation > ul", ".artifact-kind-picker", ".studio-mode-links"]) {
    assert.match(winning(selector, "scroll-padding-inline", viewports[0])?.value ?? "", /--forma-focus-clearance/, selector);
  }

  const divider = ".analytics-canvas-summary > div + div";
  assert.equal(winning(divider, "border-inline-start", viewports[0])?.value, "0", "stacked phone metrics need horizontal separators only");
  assert.match(winning(divider, "border-inline-start", viewports[5])?.value ?? "", /1px solid/, "side-by-side metrics retain a visible start divider");
  assert.match(winning(divider, "padding-inline-start", viewports[0])?.value ?? "", /--forma-row-inset-inline/);

  const landscape = viewports[2];
  const navigation = ".application-creative > .application-task-navigation .ui-audience-navigation-list";
  const chatResult = '.application-creative .chat-view-page .chat-workspace[data-result-open="true"] .chat-generation';
  assert.match(winning(navigation, "padding-inline-start", landscape)?.value ?? "", /--forma-safe-inline-start/);
  assert.doesNotMatch(winning(navigation, "padding-inline-start", landscape)?.value ?? "", /\bmin\(/, "landscape notch clearance is never capped");
  assert.match(winning(".application-creative > #main-content", "padding-inline-start", landscape)?.value ?? "", /--forma-landscape-rail-width/);
  assert.match(winning(".application-creative > #main-content", "padding-inline-end", landscape)?.value ?? "", /--forma-safe-inline-end/);
  assert.match(winning(".application-creative .composer-dock", "inset-inline-end", landscape)?.value ?? "", /--forma-safe-inline-end/);
  assert.match(winning(chatResult, "inset-inline-start", landscape)?.value ?? "", /--forma-landscape-rail-width/);
  assert.match(winning(chatResult, "inset-inline-end", landscape)?.value ?? "", /--forma-safe-inline-end/);
  assert.equal(winning(".application-canvas .canvas-intent-dock", "inset-inline-start", landscape)?.value, "auto");
  for(const viewport of viewports){
    assert.equal(winning(".canvas-organize-menu", "position", viewport)?.value, undefined, "Organize content no longer creates an independent overlay");
    assert.equal(winning(".ui-popover-panel[popover]", "position", viewport)?.value, "fixed");
    assert.match(winning(".canvas-organize-control .ui-popover-panel", "max-inline-size", viewport)?.value ?? "", /--forma-popover-max-width/);
    assert.match(winning(".canvas-organize-control .ui-popover-panel", "max-block-size", viewport)?.value ?? "", /--forma-popover-max-height/);
  }
  assert.equal(winning(".application-canvas .canvas-intent-stack", "inset-inline-end", landscape)?.value, "auto");
  assert.match(winning(".application-canvas .canvas-zoom-hud", "inset-inline-start", landscape)?.value ?? "", /--forma-safe-inline-start/);
});

test("component shadow roots and component-library previews share the same nonzero spacing contract", () => {
  const shadowSource = slottedComponents.match(/const compositionStyles = css`([\s\S]*?)`;/)?.[1];
  assert.ok(shadowSource, "the shared shadow-root stylesheet is available for inspection");
  const shadow = postcss.parse(shadowSource, { from: "slotted-element.ts" });

  for (const [selector, token] of [
    [".ui-card", "--forma-card-inset"],
    [".ui-list-item", "--forma-row-inset-inline"],
    [".ui-disclosure > summary", "--forma-row-inset-inline"],
    [".ui-disclosure > p", "--forma-row-inset-inline"],
    [".ui-disclosure > slot:not([name])::slotted(p)", "--forma-row-inset-inline"],
  ]) {
    let declaration;
    shadow.walkRules(selector, (rule) => rule.walkDecls(/^(?:padding|padding-inline)$/, (candidate) => { declaration = candidate; }));
    assert.ok(declaration?.value.includes(token), `${selector}: expected ${token}, got ${declaration?.toString()}`);
  }

  assert.doesNotMatch(componentCatalog, /--forma-space-5\s*:\s*0(?:px)?\s*;/, "the reference must not teach edge-flush cards");
  assert.match(componentCatalog, /\.component-preview\s*>\s*forma-ui-card\s*\{[^}]*--forma-card-inset:\s*var\(--forma-space-4,\s*1rem\)/s);
  assert.match(responsive, /forma-ui-theme\[density="compact"\],[\s\S]*?--forma-row-inset-inline:\s*max\(\.75rem,\s*var\(--forma-space-3/s);
  assert.match(winning('forma-ui-theme[density="compact"]', "--forma-card-inset", viewports[0])?.value ?? "", /max\(1rem,/);
  assert.match(winning('forma-ui-theme[density="spacious"]', "--forma-card-inset", viewports[0])?.value ?? "", /max\(1\.5rem,/);
});

test("review, asynchronous production, organizational context, and exact-access workflows remain inset and reachable", () => {
  assert.match(artifacts, /class="artifact-review-guidance"/);
  assert.match(artifacts, /class="artifact-review-actions"/);
  assert.match(artifacts, /Independent reviewer<select/);
  assert.match(artifacts, /Required changes<textarea/);

  for (const selector of [".document-artifact-reader > .artifact-review-guidance", ".document-artifact-reader > .artifact-review-actions"]) {
    assert.match(winning(selector, "padding-inline", viewports[0])?.value ?? "", /--page-gutter/, selector);
  }
  assert.equal(winning(".document-artifact-reader", "overflow-y", viewports[2])?.value, "auto", "short landscape review remains scroll-reachable");
  assert.equal(winning(".document-artifact-jobs > span", "display", viewports[0])?.value, "flex", "Inspect and Stop can wrap without implicit grid collisions");
  assert.equal(winning(".document-artifact-jobs > span", "flex-wrap", viewports[0])?.value, "wrap");

  assert.match(accessManagement, /class="access-grant-form"/);
  assert.match(accessManagement, /class="access-grant-list"/);
  assert.equal(winning(".access-grant-form", "display", viewports[0])?.value, "grid");
  assert.equal(winning(".access-grant-list > li", "flex-wrap", viewports[0])?.value, "wrap");

  assert.match(library, /class="library-context-version-review"/);
  assert.match(library, /class="library-context-block-selection"/);
  assert.equal(winning(".library-context-version-review li", "overflow-wrap", viewports[0])?.value, "anywhere");
  assert.equal(winning(".library-assigned-reviews .workspace-settings-list > li", "flex-wrap", viewports[0])?.value, "wrap");
  assert.match(winning(".drag-handle", "min-inline-size", viewports[0])?.value ?? "", /--forma-hit-target/);
  assert.match(winning(".layer-order > button", "min-inline-size", viewports[0])?.value ?? "", /--forma-hit-target/);

  for (const selector of [
    ".filterbar input", ".filterbar select", ".builder-controls select", ".timeline-control select", ".analytics-controls select",
    ".output-actions > button", ".document-insight > button", ".compile-bridge > button", ".creative-plan-section > header > button",
    ".creative-editor-item-toggle", ".creative-inspector-order > button", ".creative-inspector-actions > button",
  ]) {
    assert.match(winning(selector, "min-block-size", viewports[0])?.value ?? "", /--forma-hit-target/, `${selector} remains a real 44px target`);
  }
  assert.match(winning(".document-artifact-failures article > div:last-child > .button", "min-height", viewports[0])?.value ?? "", /--forma-hit-target/);
  assert.match(winning(".reference-finding-preferences label > span", "min-block-size", viewports[0])?.value ?? "", /--forma-hit-target/);
  assert.match(winning(".focal-lab-controls button", "min-height", viewports[0])?.value ?? "", /--forma-hit-target/);
});

test("generation failure recovery cards adapt to their actual pane instead of crushing guidance beside actions", () => {
  const card = [".document-artifact-failures article", ".document-artifact-failures > article.document-artifact-failure-card"];
  const actions = [
    ".document-artifact-failures article > div:last-child",
    ".document-artifact-failures article>div:last-child",
    ".document-artifact-failures article > div.document-artifact-failure-actions",
  ];
  const actionButton = ".document-artifact-failures article > div.document-artifact-failure-actions > .button";

  assert.equal(winning(".document-artifact-failures", "container", viewports[6])?.value, "document-artifact-failures / inline-size");
  assert.match(artifacts, /class="document-artifact-failures" role="region" aria-label="Recent document render issues"/);
  assert.match(artifacts, /class="document-artifact-failure-copy"/);
  assert.match(artifacts, /class="document-artifact-failure-actions"/);
  assert.match(artifacts, /class="document-artifact-failure-format"/);
  assert.match(artifacts, /<h3 aria-label=\$\{applicationEligibility\?`\$\{guidance\.title\} · \$\{requestContext\}`:nothing\}>\$\{guidance\.title\}<\/h3>/, "the visible heading remains intact while exact Scene requests have distinct accessible names");
  const cardRule = sheets.find((sheet) => sheet.name === "responsive-foundation.css")?.root.nodes.find((rule) =>
    rule.type === "rule" && rule.selector === ".document-artifact-failures > article.document-artifact-failure-card",
  );
  assert.ok(cardRule, "failure cards have their own explicit design-system surface");
  assert.match(cardRule.nodes.find((declaration) => declaration.prop === "border")?.value ?? "", /^1px solid /);
  assert.equal(cardRule.nodes.some((declaration) => /^border-(?:inline|block)(?:-(?:start|end))?$/.test(declaration.prop ?? "")), false, "rounded failure cards preserve equally balanced borders on every edge");

  for (const viewport of viewports) for (const width of [240, 280, 320, 390, 480, 640, 799, 800, 960]) {
    const container = { name: "document-artifact-failures", width };
    const label = `${viewport.name}, ${width}px available pane`;
    assert.equal(winning(card, "display", viewport, container)?.value, "grid", `${label}: card layout overrides the legacy nonwrapping flex row`);
    assert.equal(
      winning(card, "grid-template-columns", viewport, container)?.value,
      width >= 800 ? "minmax(18rem, 1fr) minmax(0, 27rem)" : "minmax(0, 1fr)",
      `${label}: copy only shares its row when the component itself has enough space`,
    );
    assert.equal(winning(actions, "flex", viewport, container)?.value, "1 1 auto", `${label}: buttons never retain their legacy flex:none intrinsic width`);
    assert.equal(winning(actions, "display", viewport, container)?.value, width >= 544 ? "flex" : "grid", `${label}: narrow panes use a compact two-row action grid`);
    assert.match(winning(card, "padding", viewport, container)?.value ?? "", /--forma-card-inset/, `${label}: content preserves density-aware breathing room`);
    assert.equal(winning(actionButton, "white-space", viewport, container)?.value, "normal", `${label}: translated recovery actions can wrap`);
    assert.equal(winning(actionButton, "overflow-wrap", viewport, container)?.value, "anywhere", `${label}: unusually long recovery labels cannot overflow`);
    assert.match(winning(actionButton, "min-height", viewport, container)?.value ?? "", /--forma-hit-target/, `${label}: action controls remain at least 44px tall`);
  }

  assert.equal(winning(".document-artifact-failures article > div.document-artifact-failure-actions > .button:first-child", "grid-column", viewports[0])?.value, "1 / -1");
  assert.equal(winning(".document-artifact-failures article > div.document-artifact-failure-actions > .button:nth-child(4)", "grid-column", viewports[0])?.value, "1 / -1", "rare four-action administrative failures keep dismissal comfortably touchable");
  assert.match(winning(".document-artifact-failure-details > summary", "min-block-size", viewports[0])?.value ?? "", /--forma-hit-target/);
  assert.equal(winning(".document-artifact-failure-receipt", "overflow", viewports[0])?.value, "auto");
  assert.match(winning(".document-artifact-failure-receipt", "max-block-size", viewports[0])?.value ?? "", /11rem/);
  assert.equal(winning(".document-artifact-failure-receipt > code", "overflow-wrap", viewports[0])?.value, "anywhere");

  const failureMarkup = artifacts.split('class="document-artifact-failures"')[1].split("${this.#productionDesk")[0];
  assert.ok(failureMarkup.indexOf('class="button primary compact"') < failureMarkup.indexOf(">Inspect inputs</button>"), "the truthful recovery action is first in DOM and keyboard order");
  assert.ok(failureMarkup.indexOf(">Inspect inputs</button>") < failureMarkup.indexOf(">Dismiss</button>"), "inspection remains available before durable dismissal");
  assert.ok(failureMarkup.indexOf(">Dismiss</button>") < failureMarkup.indexOf("<summary>Technical details</summary>"), "bounded technical diagnostics stay collapsed after essential actions");
  assert.match(failureMarkup, /const infrastructureBlocked=Boolean\(detail&&!recoverable&&!guidance\.retryAllowed&&guidance\.actionUrl/);
  assert.match(failureMarkup, /authorizedGenerationFailureRemediation\(guidance,session\)/);
  assert.match(failureMarkup, /\{href:"\/settings",label:this\.i18n\.system\("Review settings"\),external:false\}/);
  assert.match(failureMarkup, /session&&!session\.impersonation/);
  assert.match(failureMarkup, /rel=\$\{remediation\.external\?"noopener noreferrer":nothing\}/);
  assert.ok(failureMarkup.indexOf('href=${remediation.href}') < failureMarkup.indexOf('>${this.i18n.system("Review & change request")}</button>'), "authorized terminal account failures prioritize their actual remedy without losing localized manual request review");
  assert.match(failureMarkup, /detail\?\.requestId\|\|detail\?\.code\|\|detail\?\.httpStatus(?:\|\|detail\?\.validationIssues\?\.length)?\?html`<details/);
  assert.match(failureMarkup, /class="document-artifact-failure-receipt" tabindex="0" aria-label=/);
  assert.doesNotMatch(failureMarkup, /\$\{(?:detail\?\.message|job\.error)\}/, "raw provider messages never enter the visible card or hidden disclosure");
  assert.match(artifacts, /#dismissFailure\(jobId:string,event:Event\)/);
  assert.match(artifacts, /next\?\.querySelector<HTMLElement>\("\.document-artifact-failure-actions > \.button"\)/);
});

test("Activity turns private generation failures into balanced, localized, safely actionable guidance", () => {
  assert.match(activity, /isDocumentArtifactKind\(job\.result\?\.artifactKind\)/);
  assert.match(activity, /localizedGenerationFailureGuidance\(generationFailureGuidance\(failure, job\.error \?\? "", job\)/);
  assert.match(activity, /<h3>\$\{guidance\?\.title \?\? operation\}<\/h3>/);
  assert.match(activity, /class="forma-activity-card-explanation">\$\{guidance\.summary\}/);
  assert.match(activity, /localizedDocumentJobProgress\(job, this\.i18n\)/);
  assert.match(activity, /localizedDocumentJobProgressDetail\(progress\.detail, job, this\.i18n\)/);
  assert.match(activity, /this\.i18n\.date\(updatedAt, \{ dateStyle: "medium", timeStyle: "short" \}\)/);
  assert.match(activity, /authorizedGenerationFailureRemediation\(guidance, this\.store\.session\.get\(\)\)/);
  assert.match(activity, /documentJobCanRecoverProviderRender\(job\)/);
  assert.match(activity, /recoverDocumentPresentation\(job\.jobId\)/);
  assert.match(activity, /recoverDocumentRender\(job\.jobId\)/);
  assert.match(activity, /dismissDocumentJobFailure\(job\.jobId\)/);
  assert.match(activity, /rel=\$\{remediation\.external \? "noopener noreferrer" : nothing\}/);
  assert.doesNotMatch(activity, /\$\{(?:job\.error|failure\?\.message)\}/, "raw provider errors never become visible Activity copy");

  const activitySheet = sheets.find((sheet) => sheet.name === "responsive-foundation.css");
  const cardRule = activitySheet?.root.nodes.find((rule) => rule.type === "rule" && rule.selector === ".forma-activity-card");
  assert.match(cardRule?.nodes.find((declaration) => declaration.prop === "border")?.value ?? "", /^1px solid /);
  for (const selector of [".forma-activity-card--attention", ".forma-activity-card--unread"]) {
    assert.match(winning(selector, "border-color", viewports[6])?.value ?? "", /color-mix/, `${selector} accents the complete perimeter`);
    for (const property of ["border-inline-start", "border-inline-end", "border-block-start", "border-block-end", "box-shadow"]) {
      assert.equal(winning(selector, property, viewports[6]), undefined, `${selector} never uses ${property} as a highlight`);
    }
  }
  assert.equal(winning(".forma-activity-card--job > .forma-activity-card-actions", "grid-column", viewports[6])?.value, "2");
  assert.equal(winning(".forma-activity-card--job > .forma-activity-card-actions", "grid-column", viewports[0])?.value, "1 / -1");
  const button = ".forma-activity-card--job > .forma-activity-card-actions > .button";
  assert.match(winning(button, "min-block-size", viewports[0])?.value ?? "", /--forma-hit-target/);
  assert.equal(winning(button, "white-space", viewports[0])?.value, "normal");
  assert.equal(winning(button, "overflow-wrap", viewports[0])?.value, "anywhere");
});

test("the document overview adapts to actual workbench width without losing keyboard access or desktop state", () => {
  assert.match(workspace, /#workbenchInspectorOpen=true/);
  assert.match(workspace, /#inlineInspectorOpen=true/);
  assert.match(workspace, /#drawerInspectorOpen=false/);
  assert.match(workspace, /new ResizeObserver\(this\.#syncInspectorPosture\)/);
  assert.match(workspace, /const compact=width<70\*rootSize/);
  assert.match(workspace, /const restoreFocus=this\.querySelector\("#document-workbench-inspector"\)\?\.contains\(document\.activeElement\)/);
  assert.match(workspace, /this\.#inspectorObserver\?\.disconnect\(\)/);
  assert.match(workspace, /#toggleWorkbenchInspector\(open=!this\.#workbenchInspectorOpen\)/);
  assert.match(workspace, /event\.key==="Escape"[\s\S]*?this\.#toggleWorkbenchInspector\(false\)/);
  assert.match(workspace, /open\?"\.document-inspector-close":"\.document-inspector-toggle"\)\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(workspace, /aria-expanded=\$\{this\.#workbenchInspectorOpen\}/);
  assert.match(responsive, /@container studio \(max-width: 69\.99rem\)[\s\S]*?\.document-workbench-inspector:not\(\[hidden\]\)\s*\{[^}]*position:\s*fixed/s);
  assert.match(responsive, /@container studio \(min-width: 70rem\)[\s\S]*?\.studio-grid\[data-inspector-open="true"\]/);
  assert.equal(winning(".document-inspector-toggle", "display", viewports[0])?.value, "inline-flex");
  assert.match(responsive, /\.layers-panel\s*>\s*ol\s*\{\s*container:\s*layers\s*\/\s*inline-size/);
  assert.match(responsive, /@container layers \(max-width: 19rem\)[\s\S]*?\.layers-panel li > \.layer-order/);
  assert.match(responsive, /@container studio \(max-width: 720px\)[\s\S]*?\.layers-panel > ol\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(19rem,\s*100%\),\s*1fr\)\)/);
  assert.equal(winning(".application-canvas .canvas-item.selected :is(.canvas-image-open, .reference-image-open, .canvas-artifact-open)", "inset-block-start", viewports[1])?.value, "auto", "selected artifact controls never stretch between legacy top and logical bottom anchors");
});

test("the final responsive cascade keeps Search, Ask, and every collection accessible", () => {
  for (const viewport of viewports.filter((entry) => entry.width <= 760)) {
    const search = winning([".command-trigger", ".topbar .command-trigger.forma-global-search"], "display", viewport);
    const ask = winning([".composer .ask", ".application-creative .composer .ask"], "display", viewport);
    const collections = winning([".collection-tree ul", ".project-rail .collection-tree ul"], "display", viewport);
    assert.notEqual(search?.value, "none", `${viewport.name}: ${JSON.stringify(search)}`);
    assert.notEqual(ask?.value, "none", `${viewport.name}: ${JSON.stringify(ask)}`);
    assert.notEqual(collections?.value, "none", `${viewport.name}: ${JSON.stringify(collections)}`);
    assert.equal(collections?.important, true);
  }
  assert.match(responsive, /data-nav-posture="compact"/);
  assert.match(responsive, /data-nav-posture="rail"\]\[data-short-height="true"/);
  assert.doesNotMatch(responsive, /\.project-rail\.expanded \.rail-content\s*\{[^}]*position:\s*absolute/s, "overlaid navigation uses the existing native top layer, not a body-relative float");
  assert.match(projectRail, /popover=\$\{this\.#nativePanel\?"auto":nothing\}/);
  assert.match(projectRail, /popovertarget=\$\{this\.#nativePanel\?this\.#contentId:nothing\}/);
});

test("the collapsed document rail stays coherent across the 760–768px compact-posture seam", () => {
  const legacyCollapsed = ".workspace-page:has(> forma-project-rail > .project-rail.collapsed)";
  assert.deepEqual(specificity(legacyCollapsed), [0, 3, 1], "regression checks model :has() specificity correctly");
  assert.match(shell, /inline < 768 \? "compact"/);

  for (const width of [759, 760, 761, 762, 766, 767, 767.5, 767.9, 768, 769]) {
    const viewport = { name: `${width}px compact rail seam`, width, height: 900, pointer: "fine" };
    const compact = width < 768;
    const postureSelectors = (selector) => compact ? [selector] : [];

    for (const page of ["workspace-page", "library-page"]) {
      const legacy = `.${page}:has(> forma-project-rail > .project-rail.collapsed)`;
      const compactPage = `.application-creative[data-nav-posture="compact"] .${page}`;
      const compactCollapsed = `${compactPage}:has(> forma-project-rail > .project-rail.collapsed)`;
      const selectors = [`.${page}`, legacy, `.${page}:has(.project-rail.collapsed)`, `.application-creative .${page}`, ...postureSelectors(compactPage), ...postureSelectors(compactCollapsed)];
      const columns = winning(selectors, "grid-template-columns", viewport);
      if (compact) {
        assert.equal(columns?.value, "minmax(0, 1fr)", `${viewport.name}: ${page} never retains an empty 72px sidebar`);
        assert.equal(columns?.selector, compactCollapsed, `${viewport.name}: measured compact posture defeats the legacy :has() rule`);
      } else assert.match(columns?.value ?? "", /--forma-nav-rail-width/, `${viewport.name}: wider windows preserve their zoom-aware token-sized side rail`);

      const host = `.application-creative[data-nav-posture="compact"] .${page} > forma-project-rail`;
      if (compact) assert.equal(winning(["forma-project-rail:has(.project-rail.collapsed)", host], "width", viewport)?.value, "100%", `${viewport.name}: ${page} rail fills its single row`);
    }

    const toolbar = [".project-rail.collapsed .rail-toolbar", ...postureSelectors('.application-creative[data-nav-posture="compact"] .project-rail.collapsed .rail-toolbar')];
    assert.equal(winning(toolbar, "justify-content", viewport)?.value, compact ? "space-between" : "center", `${viewport.name}: toolbar matches the active navigation posture`);

    const context = [".project-rail.collapsed .rail-toolbar-context", ...postureSelectors('.application-creative[data-nav-posture="compact"] .project-rail.collapsed .rail-toolbar-context')];
    assert.equal(winning(context, "display", viewport)?.value, compact ? "flex" : "none", `${viewport.name}: compact rails keep their project context visible`);

    const label = [".project-rail.collapsed .rail-collapse-toggle b", ...postureSelectors('.application-creative[data-nav-posture="compact"] .project-rail.collapsed .rail-collapse-toggle b')];
    assert.equal(winning(label, "position", viewport)?.value, compact ? "static" : "absolute", `${viewport.name}: compact expand action is visibly labeled`);
    if (compact) {
      assert.equal(winning(label, "clip", viewport)?.value, "auto", `${viewport.name}: the expand label is never visually clipped`);
      const toggle = [".project-rail.collapsed .rail-collapse-toggle", '.application-creative[data-nav-posture="compact"] .project-rail.collapsed .rail-collapse-toggle'];
      assert.equal(winning(toggle, "width", viewport)?.value, "auto");
      assert.match(winning(toggle, "min-inline-size", viewport)?.value ?? "", /--forma-hit-target/);
    }

    const dock = [".rail-dock", ".project-rail.collapsed .rail-dock", ".application-creative .project-rail.collapsed .rail-dock", ...postureSelectors('.application-creative[data-nav-posture="compact"] .project-rail.collapsed .rail-dock')];
    assert.equal(winning(dock, "display", viewport)?.value, compact ? "none" : "grid", `${viewport.name}: only true side rails show icon shortcuts`);

    const composer = [".workspace-page:has(.project-rail.collapsed) > .composer-dock", ...postureSelectors('.application-creative[data-nav-posture="compact"] .workspace-page:has(> forma-project-rail > .project-rail.collapsed) > .composer-dock')];
    assert.equal(winning(composer, "inset-inline-start", viewport)?.value, compact ? "0" : "var(--forma-nav-rail-width)", `${viewport.name}: composer starts at the correct logical edge`);

    if (compact) {
      const overlay = [".ui-popover-panel[popover]", ".project-rail .rail-content[popover]"];
      assert.equal(winning(overlay, "position", viewport)?.value, "fixed", `${viewport.name}: expanded project navigation uses shared native positioning`);
      assert.equal(winning(overlay, "overflow-y", viewport)?.value, "auto");
      assert.match(winning(overlay, "max-block-size", viewport)?.value??"", /--forma-popover-max-height/);
      assert.equal(winning(".ui-popover-panel[popover]:not(:popover-open)", "display", viewport)?.value, "none", `${viewport.name}: closed native navigation does not leak into body layout`);
      assert.equal(winning('.application-creative[data-nav-posture="compact"] .composer-dock', "inset-inline", viewport)?.value, "0", `${viewport.name}: expanding the project rail never reintroduces a desktop composer offset`);
    }
  }

  const narrowShellInWideBrowser = { name: "compact shell in wide browser", width: 1280, height: 900, pointer: "fine" };
  const measuredCompactPage = '.application-creative[data-nav-posture="compact"] .workspace-page:has(> forma-project-rail > .project-rail.collapsed)';
  assert.equal(winning([legacyCollapsed, measuredCompactPage], "grid-template-columns", narrowShellInWideBrowser)?.value, "minmax(0, 1fr)", "a narrow measured application never inherits the wider browser's desktop sidebar");
  assert.equal(winning('.application-creative[data-nav-posture="compact"] .composer-dock', "inset-inline", narrowShellInWideBrowser)?.value, "0", "expanded and collapsed measured-compact rails keep the composer within their shell");

  assert.match(projectRail, /aria-controls=\$\{this\.#contentId\}/);
  assert.match(projectRail, /id=\$\{this\.#contentId\}/);
  assert.match(projectRail, /aria-expanded=\$\{!collapsed\}/);
  assert.match(projectRail, /event\.key==="Escape"&&!collapsed/);
});

test("custom controls and zoomed Canvas handles retain real 44-pixel hit areas", () => {
  const phone = viewports[1];
  for (const [selector, property] of [[".canvas-history-actions button", "min-height"], [".canvas-zoom-hud button", "min-height"], [".canvas-batch-select>button", "min-height"]]) {
    const declaration = winning(selector, property, phone);
    assert.match(declaration?.value ?? "", /(?:2\.75rem|--forma-control-min-size)/, `${selector}: ${JSON.stringify(declaration)}`);
  }
  const handle = winning(".canvas-resize-handle", "width", phone);
  assert.match(handle?.value ?? "", /var\(--forma-control-min-size,\s*2\.75rem\)\s*\/\s*var\(--canvas-zoom\)/);
  assert.match(responsive, /\.topbar > \.top-actions > \.avatar\s*\{[^}]*inline-size:\s*var\(--forma-hit-target\)/s);
  assert.match(responsive, /\.rail-collapse-toggle[\s\S]*?min-block-size:\s*var\(--forma-hit-target\)/);
});

test("document view links stay on one line without losing their intrinsic content width",()=>{
  for(const viewport of viewports){
    assert.equal(winning(".studio-mode-links","margin-block",viewport)?.value,"-8px",`${viewport.name}: scrollbars retain vertical breathing room`);
    assert.equal(winning(".studio-mode-links","padding-block",viewport)?.value,"8px",`${viewport.name}: scrollbar spacing does not change the navigation row height`);
  }
  for(const viewport of viewports)for(const selector of [".studio-mode-nav > .studio-mode-links > a",".studio-mode-nav > .studio-mode-families > a"]){
    assert.equal(winning([".studio-mode-nav a",selector],"white-space",viewport)?.value,"nowrap",`${viewport.name}: ${selector}`);
    assert.equal(winning([".studio-mode-nav a",selector],"inline-size",viewport)?.value,"max-content",`${viewport.name}: ${selector}`);
    assert.equal(winning([".studio-mode-nav a",selector],"flex",viewport)?.value,"0 0 auto",`${viewport.name}: ${selector}`);
    assert.match(winning(".studio-mode-nav a","min-inline-size",viewport)?.value??"",/--forma-hit-target/,`${viewport.name}: minimum tap target remains intact`);
  }
  assert.match(base,/\.studio-mode-nav\s*>\s*div\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto/s);
});

test("shallow viewports fit Canvas and keep the truthful synchronization state", () => {
  for (const viewport of viewports.filter((entry) => entry.height <= 390)) {
    const declaration = winning([".canvas-workspace", ".application-canvas .canvas-workspace"], "min-height", viewport);
    assert.equal(declaration?.value, "0", `${viewport.name}: ${JSON.stringify(declaration)}`);
  }
  const status = winning([".canvas-sync-status:not(.pending)", ".application-canvas .canvas-sync-status"], "display", viewports[1]);
  assert.equal(status?.value, "block");
  assert.match(responsive, /@media \(max-height: 37\.5rem\) and \(orientation: landscape\)/);
});

test("exactly five primary destinations preserve one active destination across legacy routes", () => {
  const primary = ["projects", "work", "explore", "activity", "deliver"];
  const creative = APPLICATIONS.find((application) => application.id === "creative");
  assert.deepEqual(creative.navigation.slice(0, 5).map((item) => item.id), primary);
  for (const [route, expected] of [
    ["/projects", "projects"], ["/studio/project", "projects"], ["/document/d1/brief", "work"], ["/studio/chat", "work"],
    ["/library", "explore"], ["/library/artifact/a", "explore"], ["/scout", "explore"], ["/memory", "explore"],
    ["/activity", "activity"], ["/sessions", "activity"], ["/deliver", "deliver"],
  ]) assert.deepEqual(primary.filter((item) => navigationItemActive("creative", item, route)), [expected], route);
  assert.match(shell, /\["projects","work","explore","activity","deliver"\]\.includes\(item\.id\)/);
  assert.match(shell, /id==="create"\|\|id==="work"\?creativeCreationHref/);
  assert.match(shell, /isCanvas\?\[\{label:this\.i18n\.t\("shell\.navigation\.activity"/);
});

test("Activity and Deliver are refresh-safe, least-privilege Creator destinations", () => {
  for (const route of ["/activity", "/deliver"]) {
    assert.equal(applicationIdFromRoute(route), "creative");
    assert.equal(resolveServerRoute(route)?.application, "creative");
  }
  assert.deepEqual(routeCapabilities("/activity"), { profile: "workspace", privateContent: false, jobHistory: true });
  assert.deepEqual(routeCapabilities("/deliver"), { profile: "workspace", privateContent: false, jobHistory: false });
  assert.equal(applicationAccessible("canvas", { role: "creator", canvasAccess: false, capabilities: [] }), false);
  assert.equal(applicationAccessible("canvas", { role: "creator", canvasAccess: true, capabilities: ["project.canvas.use"] }), true);
  assert.equal(applicationAccessible("product", { role: "creator", capabilities: [] }), false);
  assert.deepEqual(routeRequiredCapabilities("/operations/analytics"), ["product.analytics.read"]);
  assert.deepEqual(routeRequiredCapabilities("/operations/events"), ["engineering.events.read"]);
  assert.match(creativeEntry, /components\/forma-activity/);
  assert.match(creativeEntry, /components\/forma-deliver/);
  assert.match(publicShare, /extends FormaPresentationalElement/);
  assert.doesNotMatch(publicShare, /extends FormaElement|from "\.\/forma-element"|from "\.\.\/state\/store"/);
});

test("Activity rejects orphan, removed, cross-tenant, unauthorized, and impersonated records", async () => {
  const grant = { organizationId: "org-a", projectAccessId: "access-a", projectId: "project-a" };
  const context = { ...grant, permissions: ["project.review.approve", "project.output.request"] };
  const projection = { projectId: "project-a", documents: [
    { id: "doc-a", projectId: "project-a", removed: false },
    { id: "doc-b", projectId: "project-b", removed: false },
    { id: "doc-removed", projectId: "project-a", removed: true },
  ], libraryArtifacts: [{ id: "artifact-a", documentId: "doc-a" }, { id: "orphan", documentId: "missing" }] };
  const session = { user: { userId: "alice" }, projectContext: context, projects: [grant], impersonation: null };
  const reviews = [
    { id: "review-a", ...grant, documentId: "doc-a", artifactId: "artifact-a", status: "pending" },
    { id: "wrong-org", ...grant, organizationId: "org-b", documentId: "doc-a", status: "pending" },
    { id: "wrong-access", ...grant, projectAccessId: "access-b", documentId: "doc-a", status: "pending" },
    { id: "complete", ...grant, documentId: "doc-a", status: "approved" },
  ];
  const notifications = [
    { id: "notice-a", documentId: "doc-a", artifactId: "artifact-a", readAt: null },
    { id: "foreign", documentId: "doc-b", artifactId: null, readAt: null },
    { id: "orphan", documentId: "doc-a", artifactId: "orphan", readAt: null },
  ];
  const jobs = [
    { jobId: "job-a", documentId: "doc-a", status: "failed", dismissedAt: null },
    { jobId: "job-b", documentId: "doc-b", status: "failed", dismissedAt: null },
  ];
  const scoped = scopedFormaActivity(session, projection, notifications, reviews, jobs);
  assert.deepEqual(scoped.documents.map((item) => item.id), ["doc-a"]);
  assert.deepEqual(scoped.notifications.map((item) => item.id), ["notice-a"]);
  assert.deepEqual(scoped.reviews.map((item) => item.id), ["review-a"]);
  assert.deepEqual(scoped.jobs.map((item) => item.jobId), ["job-a"]);
  assert.equal(formaActivityAttention(scoped), 3);
  const repeatedReview={...scoped,notifications:[{id:"review-due",artifactId:"artifact-a",kind:"review_due",readAt:null},{id:"review-request",artifactId:"artifact-a",kind:"review_requested",readAt:null},{id:"other-update",artifactId:"artifact-a",kind:"output_ready",readAt:null}]};
  assert.deepEqual(formaActivityUnread(repeatedReview).map((item)=>item.id),["other-update"],"assigned review reminders must not count as additional work");
  assert.equal(formaActivityAttention(repeatedReview),3,"one assigned review, one unrelated notice, and one failed job remain three distinct actions");

  const viewer = scopedFormaActivity({ ...session, projectContext: { ...context, permissions: [] } }, projection, notifications, reviews, jobs);
  assert.equal(viewer.notifications.length, 1);
  assert.equal(viewer.reviews.length, 0);
  assert.equal(viewer.jobs.length, 0);

  const planningJobs=[{jobId:"paid-own",planningExecutionId:"paid-own",kind:"structure_adaptive",documentId:"doc-a",status:"completed"},{jobId:"legacy",kind:"structure_adaptive",documentId:"doc-a",status:"completed"},{jobId:"foreign",planningExecutionId:"foreign",kind:"structure_adaptive",documentId:"doc-b",status:"completed"},...jobs];
  const reader=scopedFormaActivity({...session,projectContext:{...context,permissions:["project.read"]}},projection,notifications,reviews,planningJobs);
  assert.deepEqual(reader.jobs.map(job=>job.jobId),["paid-own"],"Current read authority exposes only exact previously authorized planning, not legacy or another project's jobs");

  const personal = { ...session, projectContext: undefined };
  const noPersonalProject = { ...projection, projectId: "", documents: [], libraryArtifacts: [] };
  assert.deepEqual(scopedFormaActivity(personal, noPersonalProject, notifications, reviews, jobs).reviews.map((item) => item.id), ["review-a"]);
  assert.equal(scopedFormaActivity({ ...personal, projects: undefined }, noPersonalProject, notifications, reviews, jobs).reviews.length, 0);
  assert.equal(scopedFormaActivity({ ...personal, impersonation: { active: true } }, noPersonalProject, notifications, reviews, jobs).reviews.length, 0);
  // The visible View-all control requests one guarded Store-owned commit;
  // it must not append a second route after a context operation has completed.
  assert.match(activity, /import \{ navigateInApp, type CommandDeparture \} from "\.\/command-departure";/);
  assert.match(activity, /@click=\$\{\(\) => void navigateInApp\(this,navigation=>this\.store\.leaveProjectContext\(\{\.\.\.navigation,destination:"\/activity"\}\)\)\}>\$\{this\.i18n\.t\("activity\.viewAllAssignments", "View all my assigned reviews"\)\}/);
  assert.equal((activity.match(/this\.store\.leaveProjectContext\(/g) ?? []).length, 1);
  assert.doesNotMatch(activity, /this\.store\.setRoute\("\/activity"\)/);
  const store = await read("../src/state/store.ts");
  const from = store.indexOf("  async leaveProjectContext("), to = store.indexOf("  async acceptTerms(", from);
  assert.ok(from >= 0 && to > from, "The actual Store context-exit implementation is present");
  const leave = store.slice(from, to).replace(/\s+/gu, "");
  assert.ok(leave.includes('options:Pick<WorkspaceNavigationOptions,"current"|"focus"|"onOriginHandoff"|"onDestinationSource">&{destination?:"/projects"|"/activity"}={}'));
  assert.ok(leave.includes('if(!workspaceNavigationCurrent(options))returnfalse;constselection=this.beginProjectContextSelection({current:()=>workspaceNavigationCurrent(options)});'));
  assert.ok(leave.includes('if(!this.session.get()?.projectContext&&!this.#projectContextHandshake)returnoptions.destination!=="/activity";'));
  assert.ok(leave.includes('constresponse=awaitselection.request(null);if(!response)returnfalse;constbody=awaitresponse.json()as{error?:string};if(!selection.sourceCurrent())returnfalse;'
    +'if(!response.ok)thrownewError(body.error??"project_context_exit_failed");if(options.onOriginHandoff&&(!workspaceNavigationCurrent(options)||!options.onOriginHandoff()))returnfalse;'
    +'if(!awaitselection.refreshSession(options.onDestinationSource)||!selection.current())returnfalse;'));
  const branchFrom = leave.indexOf('if(options.destination==="/activity"){'), branchTo = leave.indexOf('this.setRoute("/projects",', branchFrom);
  assert.ok(branchFrom >= 0 && branchTo > branchFrom, "The optional destination is separate from default Return");
  const branch = leave.slice(branchFrom, branchTo);
  assert.ok(branch.includes('constsource=this.captureSourceOwnership();if(!source||!this.sourceOwnershipActive(source))returnfalse;'));
  assert.ok(branch.includes('constrouteHandoff=newPromise<void>(resolve=>{finishRouteHandoff=resolve;});'));
  assert.ok(branch.includes('constloadRevision=this.#loadRevision+1;awaitthis.load({routeHandoff});'
    +'if(loadRevision!==this.#loadRevision||this.loading.get()||!selection.current()||!workspaceNavigationCurrent(options)||!this.sourceOwnershipActive(source)'
    +'||this.session.get()?.projectContext||this.error.get())returnfalse;'));
  assert.ok(branch.includes('constdocumentId=foldEvents(this.events.get(),this.asOf.get()).documentId;'
    +'constdestination=withProjectTaskDocumentInRoute("/activity",documentId);'
    +'this.setRoute(destination,{documentId,current:()=>selection.current()&&workspaceNavigationCurrent(options),focus:options.focus});'
    +'returnthis.route.get()===destination&&this.sourceOwnershipActive(source)&&workspaceNavigationCurrent(options);'));
  assert.equal((branch.match(/this\.setRoute\(/g) ?? []).length, 1, "One final commit uses the committed personal Document, including the empty-history route");
  assert.doesNotMatch(branch, /this\.(?:projection|eventView)\.get\(/);
  assert.ok(branch.includes('}finally{finishRouteHandoff();}'));
  assert.match(activity, /acknowledgeProjectNotification\(notification\.id\)/);
  assert.match(deliver, /documentIds\.has\(artifact\.documentId\)/);
  assert.match(deliver, /documentIds\.has\(output\.documentId\)/);
});

test("Project attention counts one failed Slides job without treating paid repairs or rejected drafts as outputs", () => {
  const projection = { projectId: "project-a", documents: [
    { id: "doc-a", projectId: "project-a", removed: false },
    { id: "doc-b", projectId: "project-b", removed: false },
    { id: "removed", projectId: "project-a", removed: true },
  ], libraryArtifacts: [] };
  const session = { user: { userId: "alice" }, projectContext: null, projects: [], impersonation: null };
  const failed = { jobId: "slides-job", documentId: "doc-a", kind: "render_document", status: "failed", dismissedAt: null,
    attemptCount: 1, result: { artifactKind: "slides", generationReceipt: { actual_provider_call_count: 2, settled_cost_microusd: 135008 } } };
  const jobs = [failed,
    { ...failed, jobId: "completed", status: "completed" },
    { ...failed, jobId: "dismissed", dismissedAt: "2026-08-27T15:30:00.000Z" },
    { ...failed, jobId: "foreign", documentId: "doc-b" },
    { ...failed, jobId: "removed", documentId: "removed" },
  ];
  const activity = scopedFormaActivity(session, projection, [], [], jobs);
  assert.equal(formaActivityAttention(activity), 1);
  assert.equal(projection.libraryArtifacts.length, 0, "paid provider responses do not create accepted artifacts");
  assert.equal(failed.result.generationReceipt.actual_provider_call_count, 2);
  assert.equal(failed.result.generationReceipt.settled_cost_microusd, 135008);
  assert.equal(formaActivityAttention(scopedFormaActivity(session, projection, [], [], jobs.map((job) => job.jobId === failed.jobId ? { ...job, dismissedAt: "2026-08-27T15:31:00.000Z" } : job))), 0);
});

test("Write, Shape, and Present preserve all seven authorized document lenses", () => {
  for (const family of ["studio.family.write", "studio.family.shape", "studio.family.present"]) assert.match(studio, new RegExp(family.replaceAll(".", "\\.")));
  assert.match(studio, /canAuthor\?\[\{id:"shape"/);
  assert.match(studio, /path:"\/#output-title"/);
  for (const view of ["document", "board", "guided", "layers", "adaptive", "editor", "chat"]) {
    const baseRoute = view === "document" ? "/?scope=active#context=x" : `/studio/${view}?scope=active#context=x`;
    const route = withDocumentInRoute(baseRoute, "document-42", "Responsive work");
    const focused = withDocumentFocusInRoute(route, true);
    assert.equal(documentIdFromRoute(focused), "document-42", view);
    assert.equal(documentViewFromRoute(focused), view);
    assert.equal(documentFocusFromRoute(focused), true);
    assert.match(focused, /\?scope=active/);
    assert.match(focused, /#context=x/);
  }
  const conversation = chat.indexOf("${conversation}");
  const generation = chat.search(/<section\b[^>]*\bclass="chat-generation"/);
  assert.ok(conversation >= 0 && conversation < generation, "conversation precedes generation in the actual accessible DOM");
  assert.match(chat, /aria-controls="chat-result-preview"/);
  assert.match(chat, /data-result-open=\$\{String\(this\.#showResult\)\}/);
  assert.match(responsive, /\.chat-workspace\[data-result-open="true"\]/);
  assert.match(responsive, /\.chat-thread\s*\{[^}]*overflow-y:\s*auto/s);
});

test("every Activity, Deliver, and work-family message is complete in all supported locales", () => {
  const keys = Object.keys(FORMA_RESPONSIVE_MESSAGES.en);
  assert.ok(keys.length >= 60);
  for (const [locale, dictionary] of [["fr", french], ["ar", arabic], ["ja", japanese]]) {
    for (const key of keys) assert.ok(dictionary[key]?.trim(), `${locale} is missing ${key}`);
    for (const task of ["projects", "work", "explore", "activity", "deliver"]) assert.ok(dictionary[`shell.navigation.${task}`]?.trim());
  }
  assert.match(localization, /\.\.\.FORMA_RESPONSIVE_MESSAGES\.en/);
  assert.equal(french["activity.needsYou"], "À traiter");
  assert.equal(arabic["studio.family.present"], "عرض");
  assert.equal(japanese["deliver.reviewActivity"], "アクティビティを確認");
  assert.match(deliver, /this\.i18n\.t\(`deliver\.review\.\$\{review\.status\}`,\s*review\.label\)/);
});

test("layout and keyboard observers remain presentation-only and clean up their subscriptions", () => {
  assert.match(shell, /new ResizeObserver\(this\.#syncLayout\)/);
  assert.match(shell, /visualViewport\?\.addEventListener\("resize",\s*this\.#syncLayout\)/);
  assert.match(shell, /visualViewport\?\.removeEventListener\("resize",\s*this\.#syncLayout\)/);
  assert.match(shell, /--forma-keyboard-offset/);
  const sync = shell.match(/#syncLayout\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\};/)?.[1];
  assert.ok(sync);
  assert.doesNotMatch(sync, /setRoute|openDocument|append|generate|acknowledge|approve/);
  assert.match(projectRail, /new ResizeObserver\(this\.#compactChanged\)/);
  assert.match(projectRail, /shell\?\.getBoundingClientRect\(\)\.width/);
  assert.match(projectRail, /this\.#inlineObserver\?\.disconnect\(\)/);
  for (const event of ["online", "offline"]) {
    assert.match(projectRail, new RegExp(`window\\.addEventListener\\("${event}", this\\.#connectionChanged\\)`));
    assert.match(projectRail, new RegExp(`window\\.removeEventListener\\("${event}", this\\.#connectionChanged\\)`));
  }
});

test("large workbenches expose real scoped project boards, review tasks, and a dismissible document overview",()=>{
  assert.match(projectContents,/const canAccessCanvas=Boolean\(session\?\.canvas\.access&&\(!context\|\|context\.permissions\.includes\("project\.canvas\.use"\)\)\)/);
  assert.match(projectContents,/const boards=canAccessCanvas\?this\.store\.canvasProjection/);
  assert.doesNotMatch(projectContents,/session\?\.canvas\.access\?html/);
  assert.match(projectContents,/board\.projectId===p\.projectId&&!board\.removed/);
  assert.match(projectContents,/scopedFormaActivity\(session,p,this\.store\.projectNotifications\.get\(\),this\.store\.reviewInbox\.get\(\),this\.store\.documentJobs\.get\(\)\)/);
  assert.match(projectContents,/const needsAttention=formaActivityAttention\(\{\.\.\.activity,reviews:assignedReviews\}\)/);
  assert.match(projectContents,/<b>\$\{this\.i18n\.number\(needsAttention\)\}<\/b><span>\$\{this\.i18n\.t\("activity\.needsYou","Needs you"\)\}/);
  assert.match(projectContents,/canvasRoute\(board\)/);
  assert.match(projectContents,/class="project-overview-summary"/);
  assert.match(workspace,/data-inspector-open=\$\{String\(this\.#workbenchInspectorOpen\)\}/);
  assert.match(workspace,/id="document-workbench-inspector"/);
  assert.match(workspace,/scopedActivity\.reviews\.filter\(\(review\)=>review\.documentId===p\.documentId\)/);
  assert.match(workspace,/scopedActivity\.jobs\.filter\(\(job\)=>job\.documentId===p\.documentId/);
  assert.match(responsive,/@container studio \(min-width: 70rem\)[\s\S]*?\.studio-grid\[data-inspector-open="true"\]/);
  assert.doesNotMatch(projectRail,/rail-live-dot/);
});

test("two-finger Canvas navigation preserves its world anchor without generating events", () => {
  const initial = { zoom: 1, cameraX: 40, cameraY: 80 };
  const starting = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  const spread = [{ x: 50, y: 100 }, { x: 250, y: 100 }];
  assert.deepEqual(canvasPinchViewport(initial, starting, spread), { zoom: 2, cameraX: 115, cameraY: 130 });
  assert.deepEqual(canvasPinchViewport(initial, starting, [{ x: 120, y: 130 }, { x: 220, y: 130 }]), { zoom: 1, cameraX: 20, cameraY: 50 });
  assert.deepEqual(canvasPinchViewport(initial, starting, [spread[1], spread[0]]), canvasPinchViewport(initial, starting, spread));
  assert.deepEqual(canvasPinchViewport(initial, starting, spread, { x: 50, y: 20 }), { zoom: 2, cameraX: 90, cameraY: 120 });
  assert.deepEqual(canvasPinchViewport(initial, starting, [{ x: 100, y: 100 }, { x: 100, y: 100 }]), initial);
  assert.equal(canvasPinchViewport({ ...initial, zoom: .2 }, starting, [{ x: 145, y: 100 }, { x: 155, y: 100 }]).zoom, CANVAS_MIN_ZOOM);
  assert.equal(canvasPinchViewport({ ...initial, zoom: 1.8 }, starting, spread).zoom, CANVAS_MAX_ZOOM);
  assert.match(canvas, /touch-action:none/);
  assert.match(responsive, /@container chat/);
  assert.match(canvasApplication,/!target\.closest\("\.canvas-resize-handle"\)/);
  assert.match(canvasApplication,/this\.i18n\.t\("canvas\.touchSelectionHint"/);
});

test("native overlay panels retain closed-state hiding and one RTL-safe positioning owner",()=>{
  const closed=[".ui-popover-panel[popover]:not(:popover-open)",".tree-menu[popover]:not(:popover-open)",".presentation-deck-export-menu[popover]:not(:popover-open)"];
  for(const viewport of viewports){
    for(const selector of closed)assert.equal(winning(selector,"display",viewport)?.value,"none");
    assert.equal(winning(".ui-popover-panel[popover]","position",viewport)?.value,"fixed");
    assert.equal(winning(".ui-popover-panel[popover]","inset",viewport)?.value,"auto");
    assert.match(winning(".ui-popover-panel[popover]","left",viewport)?.value??"",/--forma-popover-left/);
    assert.match(winning(".ui-popover-panel[popover]","max-inline-size",viewport)?.value??"",/--forma-popover-max-width/);
    assert.match(winning(".ui-popover-panel[popover]","max-block-size",viewport)?.value??"",/--forma-popover-max-height/);
    assert.equal(winning(".ui-popover-panel[popover]","scroll-padding",viewport)?.value,".25rem",
      "retain the existing inline native-scroll clearance");
    assert.equal(winning(".ui-popover-panel[popover]","scroll-padding-block",viewport)?.value,"var(--forma-focus-clearance,.5rem)",
      "E3: native vertical reveal reserves the shared outward focus-ring clearance");
  }
  for(const sheet of sheets)sheet.root.walkRules(rule=>{
    if(!rule.selector.includes("canvas-view-menu")||!rule.selector.includes("ui-popover-panel"))return;
    rule.walkDecls(decl=>assert.equal(/^(?:right|left|inset|inset-inline(?:-start|-end)?|position)$/.test(decl.prop),false,"View must not override the common finite RTL-aware position: "+decl.toString()));
  });
});

test("Slides More actions remain visible at every viewport while their panel is native",()=>{
  const trigger=".artifact-viewer-actions-popover .ui-popover-trigger";
  for(const viewport of viewports){
    assert.equal(winning(trigger,"display",viewport)?.value,"inline-flex",viewport.name);
    assert.match(winning(trigger,"min-block-size",viewport)?.value??"",/2\.75rem/);
    assert.match(winning(trigger,"min-inline-size",viewport)?.value??"",/2\.75rem/);
  }
  assert.doesNotMatch(responsive,/footer\[data-actions-open="false"\] > div|artifact-viewer-actions-toggle/,"obsolete floating-footer toggles cannot hide the only native invoker");
});

test("the final slide-toolbar cascade keeps its genuine inline disclosure even in wide short landscape",()=>{
  const selectors=[".presentation-deck-toolbar",':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar',':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar'];
  for(const width of [320,844,1280]){
    const viewport={width,height:390,pointer:"fine"},container={name:"presentation-deck-host",width};
    assert.equal(winning(selectors,"position",viewport,container)?.value,"relative");
    assert.equal(winning(selectors,"inset",viewport,container)?.value,"auto");
  }
});

test("E rail Current marker keeps a content-led nonfragmenting slot beside the current document title", () => {
  // Source/style contract, not glyph measurements or a native-popover geometry claim.
  const start = projectRail.indexOf('<nav class="rail-links rail-destinations rail-document-links"');
  const end = projectRail.indexOf("</nav>", start);
  assert.ok(start >= 0 && end > start, "inspect the real document-link group, not E1's View marker");
  const links = projectRail.slice(start, end);
  assert.match(links, /this\.i18n\.t\("pattern\.current","Current"\)/);
  assert.match(links, /aria-current=.*active\?"page":nothing/);
  assert.match(links, /this\.#openDocument\(event,document\.id,documentDestination\)/);
  assert.ok(links.includes('<span dir="auto">'));
  assert.ok(projectRail.includes('popover=' + String.fromCharCode(36) + '{this.#nativePanel?"auto":nothing}'));
  assert.doesNotMatch(links, /<details\b/, "the existing rail remains native navigation, not a details overlay");
  const row = [".rail-links a", ".rail-links.rail-document-links > a", ".rail-document-links > a"];
  const marker = [".rail-links small", ".rail-document-links > a > small"];
  for (const viewport of [...viewports, { name: "observed compact window", width: 656, height: 883, pointer: "fine" }]) {
    assert.equal(winning(marker, "flex", viewport)?.value, "0 0 auto", viewport.name + ": reserve the short localized marker's content width");
    assert.equal(winning(marker, "white-space", viewport)?.value, "nowrap", "Current must not become a letter column");
    assert.equal(winning(marker, "overflow-wrap", viewport)?.value, "normal");
    assert.equal(winning(row, "flex-wrap", viewport)?.value, "wrap", "the row may wrap instead of squeezing its marker");
    assert.equal(winning(row, "gap", viewport)?.value, "var(--forma-cluster-gap)");
    assert.equal(winning(".rail-document-links > a > span", "min-width", viewport)?.value, "0", "the existing title still yields space");
    assert.equal(winning(".rail-document-links > a > span > span", "text-overflow", viewport)?.value, "ellipsis", "do not replace the existing title policy");
  }
  const fitted = new Set([".rail-document-links > a", ".rail-document-links > a > small"]);
  for (const sheet of sheets) sheet.root.walkRules(rule => {
    if (!(rule.selectors ?? []).some(selector => fitted.has(selector))) return;
    rule.walkDecls(declaration => {
      assert.equal(/^(?:height|block-size|max-height|max-block-size|text-overflow|(?:-webkit-)?line-clamp)$/.test(declaration.prop), false, "do not fake marker fit with a fixed height or truncation");
      if (declaration.prop === "overflow") assert.notEqual(declaration.value, "hidden");
      if (declaration.prop === "display") assert.notEqual(declaration.value, "none");
    });
  });
});

test("E Output-pane compact generation controls wrap their complete options and status outside the composer", async () => {
  // Source/style contract: no generation, provider request, job action, or DOM measurement.
  const generation = await read("../src/components/generation-actions.ts");
  const pane = workspace.indexOf('<section id="document-results-panel" class="output-column"');
  const host = workspace.indexOf('<section class="document-result-generation"', pane);
  const composer = workspace.indexOf('<div class="composer-dock">', pane);
  assert.ok(pane >= 0 && host > pane && composer > host, "the current Output pane is not the composer dock");
  assert.ok(workspace.slice(host, workspace.indexOf("</section>", host)).includes('<forma-generation-actions source="document"'));
  const controls = generation.split("\n").find(line => line.includes('const compactControls=html'));
  assert.ok(controls?.includes('class="generation-actions compact"') && controls.includes('role="group"'));
  assert.ok(controls.includes('aria-haspopup="dialog"') && controls.includes("this.openConfiguration()"));
  assert.ok(controls.includes("Image options, {ratio} frame, {statusLabel}{label}") && controls.includes("<b>" + String.fromCharCode(36) + "{statusLabel}</b>"));
  assert.match(generation, /this\.i18n\.plural\("generation\.unread",unreadFailures,"\{count\} unread failure","\{count\} unread failures"\)/);
  const scope = ".document-result-generation .generation-actions.compact";
  const rows = [".generation-actions", ".generation-actions.compact", scope];
  const peer = scope + " > button", detail = scope + " > .generation-details-trigger";
  const copy = detail + " > :is(span, small, b)";
  for (const viewport of [...viewports, { name: "observed Output window", width: 1280, height: 720, pointer: "fine" }, { name: "observed compact window", width: 656, height: 883, pointer: "fine" }]) {
    assert.equal(winning(rows, "flex-wrap", viewport)?.value, "wrap", viewport.name + ": the actual pane row must not inherit compact nowrap");
    assert.equal(winning(rows, "align-items", viewport)?.value, "stretch", "native action peers share their wrapped row height");
    assert.equal(winning(rows, "gap", viewport)?.value, "var(--forma-cluster-gap)");
    assert.equal(winning(rows, "min-inline-size", viewport)?.value, "0");
    assert.equal(winning(rows, "max-inline-size", viewport)?.value, "100%");
    assert.equal(winning(peer, "flex", viewport)?.value, "0 1 auto", "content-led peers may wrap; no equal shrinking columns");
    assert.equal(winning(peer, "align-self", viewport)?.value, "stretch");
    assert.equal(winning(peer, "max-inline-size", viewport)?.value, "100%");
    assert.equal(winning(peer, "white-space", viewport)?.value, "normal");
    assert.equal(winning([".generation-details-trigger", peer, detail], "flex-wrap", viewport)?.value, "wrap");
    assert.equal(winning(copy, "min-inline-size", viewport)?.value, "0");
    assert.equal(winning(copy, "max-inline-size", viewport)?.value, "100%");
    assert.equal(winning(copy, "white-space", viewport)?.value, "normal");
    assert.equal(winning(copy, "overflow-wrap", viewport)?.value, "anywhere", "long localized tokens may emergency-wrap without clipping the status");
    assert.equal(winning(".generation-details-trigger", "min-block-size", viewport)?.value, "var(--forma-hit-target)");
    assert.equal(winning(".generation-details-trigger", "padding-inline", viewport)?.value, "var(--forma-control-inset-inline)");
  }
  for (const sheet of sheets) sheet.root.walkRules(rule => {
    if (!rule.selector.includes(".document-result-generation") || !rule.selector.includes("generation-actions")) return;
    rule.walkDecls(declaration => {
      assert.equal(/^(?:height|block-size|max-height|max-block-size|text-overflow|(?:-webkit-)?line-clamp)$/.test(declaration.prop), false, "fit is not a fixed-height or truncated substitute");
      if (declaration.prop === "overflow") assert.notEqual(declaration.value, "hidden");
      if (declaration.prop === "display") assert.notEqual(declaration.value, "none");
    });
  });
});

// Source/CSS contracts only: reuse this file's existing PostCSS/cascade helpers.
// Root's actual 431px Document observation is the physical baseline; these
// checks neither compute layout nor exercise recipe/save/provider behavior.
function d337OutputPaneGutter() {
  const found = [];
  sheets.find(sheet => sheet.name === "responsive-foundation.css").root.walkRules(rule => {
    const selector = rule.selectors?.find(value => value.startsWith(".context-column > :is(")
      && value.includes(".context-provenance"));
    if (selector) found.push({ rule, selector });
  });
  assert.equal(found.length, 1, "reuse the single existing parent-owned context gutter rule");
  return found[0];
}

test("D337 recipe entry, draft and retained card share the direct Document pane gutter", async () => {
  const output = await read("../src/components/forma-output-requirements.ts");
  const component = postcss.parse(await read("../src/components/forma-output-requirements.css"));
  const paneStart = workspace.indexOf('<section id="document-context-panel" class="context-column"');
  const hostStart = workspace.indexOf("<forma-output-requirements ", paneStart);
  const paneEnd = workspace.indexOf("</section>", paneStart);
  assert.ok(paneStart >= 0 && hostStart > paneStart && paneEnd > hostStart,
    "the existing output host is authored inside the actual Document context pane");
  assert.equal((workspace.match(/<forma-output-requirements\b/gu) ?? []).length, 1);
  assert.ok(output.includes('<details class="output-recipe-entry"'));
  assert.ok(output.includes('<section class="output-recipe-draft"'));
  assert.ok(output.includes("const empty = !rows.length && !snapshot.confirmedPlan;"));
  assert.match(output, /class=\$\{empty \? nothing : "output-requirements"\}/u);
  assert.ok(output.includes("this.#recipeEntry(snapshot)") && output.includes("this.#recipeCard(snapshot)"));
  assert.match(output, /\.newDraft=\$\{row \? null : draft\}\s+\.snapshot=\$\{row \? this\.#cardSnapshot\(snapshot, row\) : null\}/u,
    "the same existing Card remains mounted through draft and observed saved-row states");
  assert.ok(output.includes('if (!snapshot) return html') && output.includes("this.#recipeEntry(null)"),
    "unavailable/loading delivery remains within the same host rather than an entry-only wrapper");

  const host = component.nodes.filter(node => node.type === "rule" && node.selector === "forma-output-requirements");
  assert.equal(host.length, 1);
  const hostProperties = Object.fromEntries(host[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  assert.equal(hostProperties.display, "block"); assert.equal(hostProperties["min-inline-size"], "0");
  for (const property of ["width", "inline-size", "margin-inline", "padding-inline", "margin-left", "margin-right"])
    assert.equal(hostProperties[property], undefined, "the shared component does not own a second pane offset: " + property);
  const summary = component.nodes.find(node => node.type === "rule" && node.selector === "forma-output-requirements summary");
  assert.ok(summary);
  const summaryProperties = Object.fromEntries(summary.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  assert.equal(summaryProperties["min-block-size"], "var(--forma-control-min-size,2.75rem)");
  assert.equal(summaryProperties["padding-inline"], ".5rem", "native disclosure hit-area padding is distinct from the pane gutter");

  const { selector } = d337OutputPaneGutter();
  const members = selector.match(/^\.context-column > :is\(([^()]*)\)$/u)?.[1].split(",").map(value => value.trim());
  assert.ok(members);
  for (const sibling of [".blank-context", ".add-block", ".document-insight", ".context-provenance"])
    assert.ok(members.includes(sibling), "preserve the existing gutter sibling " + sibling);
  assert.ok(members.includes("forma-output-requirements"),
    "the whole direct host, not only its current recipe entry, must share the existing pane inset");
});

test("D337 delivery inset uses the same logical parent rule at all existing postures", () => {
  const { rule, selector } = d337OutputPaneGutter();
  const outputSibling = ".output-column > :is(forma-document-artifacts, forma-output-card, .output-card, .output-filmstrip, .reference-picker-form)";
  assert.ok(rule.selectors.includes(outputSibling), "the other original pane consumers remain in their unchanged shared rule");
  assert.equal(rule.selectors.length, 2); assert.equal(rule.parent.type, "root",
    "pane spacing is not restricted to a phone, pointer, direction or recipe-state condition");
  assert.deepEqual(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["margin-inline", "var(--forma-pane-inset)"]],
    "use the existing logical margin, not physical offsets, a second padding system or width arithmetic");
  const postures = [...viewports,
    { name: "observed 431px Document, fine pointer", width: 431, height: 883, pointer: "fine" },
    { name: "431px Document, coarse pointer", width: 431, height: 883, pointer: "coarse" }];
  for (const viewport of postures) {
    assert.equal(winning(":root", "--forma-pane-inset", viewport)?.value, "clamp(1rem, 1.6vi, 1.25rem)", viewport.name);
    assert.equal(winning(".context-column > .section-heading", "padding-inline", viewport)?.value,
      "var(--forma-pane-inset)", viewport.name + ": the neighboring heading owns the same logical edge token");
    assert.equal(winning(selector, "margin-inline", viewport)?.value, "var(--forma-pane-inset)",
      viewport.name + ": preserve existing parent spacing before checking the missing host member");
  }
  const expected = ".context-column > :is(.blank-context, .add-block, .document-insight, .context-provenance, forma-output-requirements)";
  const missing = postures.filter(viewport => winning(expected, "margin-inline", viewport)?.value !== "var(--forma-pane-inset)")
    .map(viewport => viewport.name);
  assert.deepEqual(missing, [],
    "the direct Document host inherits the same gutter without matching nested Output blocks, Library, Project or Deliver hosts");
});

// D406 source-policy regressions, not DOM geometry or browser zoom simulation.
// Reuse the existing cascade helper with explicit actual short-rail selectors;
// the earlier compact-only checks do not cover the observed rail posture.
test("D406 short-rail Document header wraps useful copy and intrinsic native actions before squeezing labels", () => {
  const header = '.application-creative[data-nav-posture="rail"][data-short-height="true"][data-layout-intent="workbench"] .workspace-page[data-workbench="document"] .page-header--document';
  const copy = header + " > .page-header-copy";
  const actions = header + " > .page-header-actions";
  const peer = actions + " > :is(.button, .icon-button)";
  const existingHeader = '.workspace-page[data-workbench="document"] .page-header--document';
  assert.match(shell, /const posture = short && inline > block \? "rail"/);
  assert.ok(workspace.includes('<div class="document-bar page-header page-header--document"><div class="page-header-copy">'));
  assert.ok(workspace.includes('<div class="document-actions page-header-actions" @focusin=${(event: FocusEvent) => this.#revealDocumentActionFocus(event, () => this.store === actionStore && actionStore.sourceOwnershipActive(actionSource) && actionStore.route.get() === actionRoute && actionStore.projection.get().projectId === p.projectId && actionStore.projection.get().documentId === p.documentId)}>'));
  for (const binding of ['?disabled=${!this.store.canUndo()}', '?disabled=${!this.store.canRedo()}',
    '?disabled=${!canCompare}', '?disabled=${p.documents.length<=1}', '@click=${() => this.store.undo()}',
    '@click=${() => this.store.redo()}', '@click=${this.#compare}', '@click=${this.#openDeleteDocument}'])
    assert.ok(workspace.includes(binding), "preserve the existing native action and its admission: " + binding);

  const postures = [
    { name: "observed D406 dimensions, fine source branch", width: 419, height: 398, pointer: "fine" },
    { name: "same dimensions, coarse source counterexample", width: 419, height: 398, pointer: "coarse" },
    { name: "existing landscape phone branch", width: 844, height: 390, pointer: "coarse" },
    { name: "existing shallow desktop branch", width: 1280, height: 390, pointer: "fine" },
  ];
  for (const viewport of postures) {
    assert.equal(winning(existingHeader, "min-block-size", viewport)?.value, "var(--forma-hit-target)", viewport.name + ": retain the current header floor");
    assert.equal(winning([".page-header", ".page-header--document", existingHeader, header], "flex-wrap", viewport)?.value,
      "wrap", viewport.name + ": wrap complete title/action groups instead of retaining the squeezed row");
    assert.equal(winning([".page-header-copy", copy], "flex", viewport)?.value, "1 1 min(100%, 16rem)",
      viewport.name + ": reuse the existing useful-copy preferred basis, not a zero-basis column");
    for (const property of ["width", "inline-size"])
      assert.equal(winning([".page-header-actions", ".page-header--document .page-header-actions", actions], property, viewport)?.value, "auto");
    assert.equal(winning(actions, "max-inline-size", viewport)?.value, "100%");
    assert.equal(winning(actions, "flex-wrap", viewport)?.value, "wrap");
    assert.equal(winning(actions, "flex", viewport)?.value, "0 1 auto");
    assert.equal(winning([".page-header-actions > *", ".document-actions > *", ".page-header-actions .button", peer], "flex", viewport)?.value,
      "0 1 auto", viewport.name + ": actual Compare must not inherit the narrow button's zero basis");
    assert.equal(winning(peer, "min-inline-size", viewport)?.value, "var(--forma-hit-target)");
    assert.equal(winning(peer, "max-inline-size", viewport)?.value, "100%");
    for (const selector of [header, copy, actions, peer]) for (const property of
      ["height", "block-size", "max-height", "max-block-size", "font-size", "line-height", "overflow", "overflow-x", "overflow-y", "white-space", "word-break"])
      assert.equal(winning(selector, property, viewport), undefined, "this scoped correction must not add a cap, clipping, font reduction, or forced text posture: " + selector + " " + property);
  }
  for (const viewport of [viewports[0], viewports[1], viewports[5], viewports[6]])
    assert.equal(winning(header, "flex-wrap", viewport), undefined, viewport.name + ": this new rail rule is not a compact/tall restyle");
  const compact = '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"] .page-header--document .page-header-actions';
  assert.equal(winning(compact, "overflow-x", viewports[0])?.value, "auto", "the separate existing compact strip keeps its owner");
  assert.equal(winning(compact + " > *", "flex", viewports[0])?.value, "0 0 auto");
});

test("D406 narrow Document action labels may compact without hiding their existing icon spans", () => {
  for (const [glyph, label] of [["undo", "Undo"], ["redo", "Redo"], ["trash", "Remove"]])
    assert.ok(workspace.includes('${icon("' + glyph + '")}<span>' + label + '</span>'),
      "retain the actual shared icon followed by its unchanged native button label");
  const oldLabel = ".document-actions .labeled span";
  const textLabel = ".document-actions .labeled span:not(.forma-icon)";
  const narrow = { name: "D406 narrow toolbar source branch", width: 419, height: 398, pointer: "fine" };
  assert.equal(winning(".forma-icon", "display", narrow)?.value, "inline-grid", "the existing icon primitive already supplies the glyph box");
  assert.equal(winning([oldLabel, textLabel], "display", narrow)?.value, "none", "text-only compact labels retain their existing treatment");
  assert.equal(winning([".forma-icon", oldLabel], "display", narrow)?.value, "inline-grid",
    "the label-only rule must stop matching the current aria-hidden icon span");
  assert.equal(winning(textLabel, "display", narrow)?.value, "none");
  assert.equal(winning(textLabel, "display", viewports[5]), undefined, "ordinary wide toolbar text remains untouched");
});

test("D406 Document panes reserve dock space only for a real direct composer and otherwise use symmetric focus clearance", () => {
  const pane = '.workspace-page[data-workbench="document"] .studio-grid > :is(.context-column, .output-column)';
  const dockPane = '.workspace-page[data-workbench="document"]:has(> .composer-dock) .studio-grid > :is(.context-column, .output-column)';
  const existingDockPadding = '.workspace-page[data-workbench="document"]:has(> .composer-dock) .studio-grid > :is(.context-column, .output-column, .document-workbench-inspector)';
  assert.ok(workspace.includes('${!assistantActive&&canAuthor&&canGenerate?html' + '`<div class="composer-dock">'),
    "the actual direct composer remains conditionally present; no readiness/DPR substitute owns its reserved space");
  for (const viewport of [...viewports, { name: "observed D406 dimensions", width: 419, height: 398, pointer: "fine" }]) {
    assert.equal(winning(pane, "overflow-y", viewport)?.value, "auto", "retain the actual pane scroll owner");
    assert.equal(winning(pane, "min-block-size", viewport)?.value, "0");
    assert.equal(winning(existingDockPadding, "padding-block-end", viewport)?.value, "calc(7rem + var(--forma-keyboard-offset))",
      "the genuine composer's physical padding and inspector exception are unchanged");
    assert.equal(winning(pane, "scroll-padding-block", viewport)?.value, "var(--forma-focus-clearance)",
      viewport.name + ": an undocked pane needs balanced existing focus clearance, not a phantom 112px end reserve");
    assert.equal(winning(pane, "scroll-padding-block-end", viewport), undefined, "no unconditional longhand may restore the phantom reserve");
    assert.equal(winning(dockPane, "scroll-padding-block-end", viewport)?.value, "calc(7rem + var(--forma-keyboard-offset))",
      "the exact original end reserve belongs only to the real direct dock");
    assert.equal(winning(dockPane, "scroll-padding-block-start", viewport), undefined, "the dock does not replace the base start clearance");
  }
});

// D428 source-policy coverage for the measured short-header Account focus clip.
// Uses the existing stylesheet/cascade fixture; these dimensions are not a
// browser-zoom simulation or a forced-colors rendering certification.
test("D428 short Creative and Canvas headers keep the Account focus ring inside its unchanged 44px control", () => {
  const hit = ".topbar > .top-actions > .avatar";
  const short = [
    { name: "observed true-200 CSS dimensions", width: 419, height: 398, pointer: "fine" },
    { name: "observed shallow landscape dimensions", width: 844, height: 390, pointer: "fine" },
    { name: "same shallow coarse branch", width: 844, height: 390, pointer: "coarse" },
  ];
  assert.ok(shell.includes('popovertarget="account-popover"'), "retain the existing native Account invoker");
  assert.match(responsive, /--forma-short-topbar-height:\s*3rem;/);
  for (const viewport of short) {
    for (const property of ["inline-size", "block-size", "min-inline-size", "min-block-size"])
      assert.equal(winning(hit, property, viewport)?.value, "var(--forma-hit-target)", "preserve the shared 44px floor and actual box");
    assert.equal(winning(hit, "flex", viewport)?.value, "0 0 var(--forma-hit-target)");
    for (const app of [".application-creative", ".application-canvas"]) {
      assert.equal(winning(app + " > .topbar", "block-size", viewport)?.value, "var(--forma-short-topbar-height)");
      assert.equal(winning(app + " > .topbar", "min-block-size", viewport)?.value, "var(--forma-short-topbar-height)",
        "do not consume the already-tight Document content height to make room for an exterior ring");
    }
  }
  const conditions = rule => {
    const result = [];
    for (let parent = rule.parent; parent; parent = parent.parent)
      if (parent.type === "atrule" && parent.name === "media") result.push(parent.params);
    return result;
  };
  const declarations = rule => Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  for (const app of [".application-creative", ".application-canvas"]) {
    const selector = app + " > .topbar > .top-actions > .avatar:focus-visible";
    for (const viewport of short) {
      assert.equal(winning([":focus-visible", selector], "outline-offset", viewport)?.value,
        "calc(-1 * var(--forma-focus-ring-width, .1875rem))", viewport.name + ": reuse the shared inset-focus treatment instead of clipping the ring at y=0");
      assert.equal(winning(selector, "outline-color", viewport)?.value, "currentColor",
        "ordinary colors reuse the filled avatar's contrast-paired foreground");
    }
    const rules = [];
    sheets.find(sheet => sheet.name === "responsive-foundation.css").root.walkRules(rule => {
      if (rule.selectors?.includes(selector)) rules.push(rule);
    });
    const inset = rules.find(rule => rule.nodes.some(node => node.type === "decl" && node.prop === "outline-offset"));
    const color = rules.find(rule => rule.nodes.some(node => node.type === "decl" && node.prop === "outline-color"));
    assert.ok(inset && color);
    assert.deepEqual(declarations(inset), { "outline-offset": "calc(-1 * var(--forma-focus-ring-width, .1875rem))" },
      "inset paint must not change dimensions, typography, overflow, outline width or style");
    assert.deepEqual(declarations(color), { "outline-color": "currentColor" });
    assert.deepEqual(conditions(inset), ["(max-height: 37.5rem) and (orientation: landscape)"],
      "forced-colors users also need the ring inset");
    assert.deepEqual(conditions(color), ["(forced-colors: none)", "(max-height: 37.5rem) and (orientation: landscape)"],
      "currentColor must not override the existing forced-colors Highlight rule");
    for (const viewport of [viewports[0], viewports[1], viewports[5], viewports[6]]) {
      assert.equal(winning(selector, "outline-offset", viewport), undefined, "ordinary tall/portrait avatar treatment stays unchanged");
      assert.equal(winning(selector, "outline-color", viewport), undefined);
    }
  }
  assert.match(design, /@media \(forced-colors: active\)\s*\{[\s\S]*?:focus-visible\s*\{\s*outline:\s*3px solid Highlight;/,
    "retain the existing high-contrast focus policy; this is a source assertion, not an HC browser result");
});

// D428 source-policy regression for the measured 844x390 shortcut-dock overlap.
// The actual expanded/collapsed interaction and hit stack remain browser gates.
test("D428 the floating short-landscape Document rail keeps only its Expand control while collapsed", () => {
  const posture = '.application-creative[data-nav-posture="rail"][data-short-height="true"][data-layout-intent="workbench"]';
  const page = posture + ' .workspace-page[data-workbench="document"]';
  const collapsed = page + ':has(> forma-project-rail > .project-rail.collapsed)';
  const host = page + ' > forma-project-rail:has(> .project-rail.collapsed)';
  const dock = page + ' > forma-project-rail > .project-rail.collapsed > .rail-dock';
  const oldDocks = [".rail-dock", ".project-rail.collapsed .rail-dock", ".application-creative .project-rail.collapsed .rail-dock"];
  const short = [
    { name: "observed shallow Document", width: 844, height: 390, pointer: "fine" },
    { name: "same shallow coarse branch", width: 844, height: 390, pointer: "coarse" },
    { name: "first wide non-popover seam", width: 768, height: 390, pointer: "fine" },
    { name: "wide shallow window", width: 1280, height: 390, pointer: "fine" },
  ];
  assert.ok(projectRail.includes('matchMedia("(max-width: 47.99rem)")'), "do not broaden native popover mode to repair a presentation-only gap");
  assert.ok(projectRail.includes('collapsed&&!this.#nativePanel ? html'));
  assert.ok(projectRail.includes('aria-controls=${this.#contentId}'));
  assert.ok(projectRail.includes('aria-expanded=${!collapsed}'));
  assert.ok(projectRail.includes('if(!this.#nativePanel)this.#setCollapsed(!collapsed);'),
    "the existing native Expand button still opens the actual full inline rail");
  assert.ok(projectRail.includes("this.#compactChoice = collapsed;"));
  for (const destination of ['class="rail-project-overview"', 'class="rail-links rail-destinations rail-document-links"',
    'class="rail-links rail-library-links"'])
    assert.ok(projectRail.includes(destination), "expanded navigation retains the original destination family " + destination);
  assert.equal(winning(".application-creative[data-nav-posture=\"compact\"] .project-rail.collapsed .rail-dock",
    "display", viewports[1])?.value, "none", "reuse the already-established collapsed compact treatment");
  for (const viewport of short) {
    assert.equal(winning(collapsed, "grid-template-columns", viewport)?.value, "minmax(0, 1fr)");
    assert.equal(winning(host, "position", viewport)?.value, "absolute");
    assert.equal(winning(host, "inline-size", viewport)?.value, "var(--forma-hit-target)");
    assert.equal(winning(".rail-collapse-toggle", "min-inline-size", viewport)?.value, "var(--forma-hit-target)");
    assert.equal(winning(".rail-collapse-toggle", "min-block-size", viewport)?.value,
      viewport.pointer === "coarse" ? "var(--forma-hit-target-coarse)" : "var(--forma-hit-target)",
      "preserve the existing 48px coarse-pointer height as well as the 44px fine-pointer floor");
    assert.equal(winning([".workspace-page", ".application-creative .workspace-page", '.workspace-page[data-workbench="document"]', page],
      "grid-template-columns", viewport)?.value, "15rem minmax(0, 1fr)",
      "the expanded inline case excludes collapsed-only selectors and keeps its reserved rail column");
  }
  for (const viewport of short)
    assert.equal(winning([...oldDocks, dock], "display", viewport)?.value, "none",
      viewport.name + ": the floating header control must not retain a desktop dock over Document copy and actions");
  const rules = [];
  sheets.find(sheet => sheet.name === "responsive-foundation.css").root.walkRules(rule => {
    if (rule.selectors?.includes(dock)) rules.push(rule);
  });
  assert.equal(rules.length, 1);
  assert.deepEqual(Object.fromEntries(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])), { display: "none" },
    "hide only the collapsed shortcut duplicate, without changing the rail, button, expanded content, focus, or typography");
  assert.equal(rules[0].parent.name, "media");
  assert.equal(rules[0].parent.params, "(max-height: 37.5rem) and (orientation: landscape)");
  for (const viewport of [viewports[0], viewports[1], viewports[5], viewports[6],
    { name: "wide tall seam", width: 768, height: 900, pointer: "fine" }])
    assert.equal(winning(dock, "display", viewport), undefined, "this correction does not replace portrait, tall, Library, or existing native-panel policy");
  for (const viewport of [viewports[5], viewports[6], { name: "wide tall seam", width: 768, height: 900, pointer: "fine" }])
    assert.equal(winning([...oldDocks, dock], "display", viewport)?.value, "grid", "true tall side rails keep their shortcut dock");
});

// D428 R6's wide inline rail keeps its 44px floating invoker. E6 reached a
// translated native-popover invoker whose body needs its own intrinsic row.
// This fixture checks the two source policies, not native paint or keyboard delivery.
test("D428 Document rail retains inset focus across floating inline and intrinsic native-popover owners", () => {
  const posture = '.application-creative[data-nav-posture="rail"][data-short-height="true"][data-layout-intent="workbench"]';
  const page = posture + ' .workspace-page[data-workbench="document"]';
  const collapsed = page + ':has(> forma-project-rail > .project-rail.collapsed)';
  const host = page + ' > forma-project-rail:has(> .project-rail.collapsed)';
  const nativePage = page + ':has(> forma-project-rail > .project-rail > .rail-toolbar > .rail-collapse-toggle[popovertarget])';
  const nativeHost = nativePage + ' > forma-project-rail';
  const nativeRail = nativeHost + ' > .project-rail';
  const nativeToolbar = nativeRail + ' > .rail-toolbar';
  const nativeToggle = nativeToolbar + ' > .rail-collapse-toggle';
  const selector = page + ' > forma-project-rail > .project-rail.collapsed > .rail-toolbar > .rail-collapse-toggle:focus-visible';
  const inset = "calc(-1 * var(--forma-focus-ring-width, .1875rem))";
  const short = [
    { name: "observed shallow inline rail", width: 844, height: 390, pointer: "fine", nativePanel: false },
    { name: "same shallow coarse inline rail", width: 844, height: 390, pointer: "coarse", nativePanel: false },
    { name: "first wide inline seam", width: 768, height: 390, pointer: "fine", nativePanel: false },
    { name: "observed true-200 native owner", width: 419, height: 398, pointer: "fine", nativePanel: true },
    { name: "same short native coarse owner", width: 419, height: 398, pointer: "coarse", nativePanel: true },
    { name: "existing short native media branch", width: 700, height: 390, pointer: "fine", nativePanel: true },
    { name: "wide shallow inline rail", width: 1280, height: 390, pointer: "fine", nativePanel: false },
  ];
  assert.ok(projectRail.includes('<button type="button" class="rail-collapse-toggle"'));
  assert.ok(projectRail.includes('"projects.railExpand"') && projectRail.includes('"projects.railCollapse"'));
  assert.ok(projectRail.includes('popovertarget=${this.#nativePanel?this.#contentId:nothing}'));
  assert.ok(projectRail.includes('popover=${this.#nativePanel?"auto":nothing}'));
  assert.ok(projectRail.includes('matchMedia("(max-width: 47.99rem)")'),
    "the runtime native-owner decision is unchanged; the CSS condition follows its actual trigger");
  assert.ok(projectRail.includes('if(!this.#nativePanel)this.#setCollapsed(!collapsed);'),
    "retain the same named native control and inline expansion path");
  assert.equal(winning(".ui-audience-navigation a:focus-visible", "outline-offset", short[0])?.value, inset,
    "reuse the established inset focus treatment");
  for (const viewport of short) {
    // As elsewhere in this fixture, list only selectors matching this declared
    // actual owner. Native host tests and the browser verify the owner itself.
    const hosts = [host, ...(viewport.nativePanel ? [nativeHost] : [])];
    const pages = [collapsed, ...(viewport.nativePanel ? [nativePage] : [])];
    assert.equal(winning(hosts, "position", viewport)?.value, viewport.nativePanel ? "relative" : "absolute");
    assert.equal(winning(hosts, "inline-size", viewport)?.value, viewport.nativePanel ? "100%" : "var(--forma-hit-target)");
    assert.equal(winning(pages, "grid-template-columns", viewport)?.value, "minmax(0, 1fr)");
    if (viewport.nativePanel) {
      assert.equal(winning(pages, "grid-template-rows", viewport)?.value, "auto minmax(0, 1fr)",
        "reserve the full native trigger row instead of putting translated content over the document header");
      assert.equal(winning(nativeHost, "grid-row", viewport)?.value, "1");
      assert.equal(winning(nativePage + " > .studio-main", "grid-row", viewport)?.value, "2");
      assert.equal(winning(nativeHost, "inset", viewport)?.value, "auto");
      const oldRail = page + " > forma-project-rail > .project-rail.collapsed";
      assert.equal(winning([oldRail, nativeRail], "inline-size", viewport)?.value, "100%");
      assert.equal(winning(nativeRail, "height", viewport)?.value, "auto");
      const oldToolbar = posture + " .project-rail.collapsed .rail-toolbar";
      assert.equal(winning([".rail-toolbar", oldToolbar, nativeToolbar], "height", viewport)?.value, "auto");
      assert.equal(winning(nativeToolbar, "padding-block", viewport)?.value, "var(--forma-focus-clearance)");
      assert.equal(winning(nativeToolbar, "flex-wrap", viewport)?.value, "wrap");
      assert.equal(winning([".project-rail.collapsed .rail-collapse-toggle", nativeToggle], "width", viewport)?.value, "auto");
      assert.equal(winning(nativeToggle, "max-inline-size", viewport)?.value, "100%");
      assert.equal(winning(nativeToggle, "white-space", viewport)?.value, "normal");
      assert.equal(winning(nativeToggle, "overflow-wrap", viewport)?.value, "anywhere");
      const label = ".project-rail.collapsed .rail-collapse-toggle b";
      for (const [property, value] of [["position", "static"], ["width", "auto"], ["height", "auto"], ["overflow", "visible"], ["clip", "auto"]])
        assert.equal(winning(label, property, viewport)?.value, value, "retain the visible native invoker wording");
      const copy = nativePage + " > .studio-main > .studio-header-stack > .page-header--document > .page-header-copy";
      assert.equal(winning([posture + " .page-header-copy", copy], "padding-inline-start", viewport)?.value, "0",
        "the reserved row consumes no obsolete floating-invoker gap inside document copy");
    }
    assert.equal(winning(".rail-collapse-toggle", "min-inline-size", viewport)?.value, "var(--forma-hit-target)");
    assert.equal(winning(".rail-collapse-toggle", "min-block-size", viewport)?.value,
      viewport.pointer === "coarse" ? "var(--forma-hit-target-coarse)" : "var(--forma-hit-target)",
      "preserve the existing 48px coarse height and 44px fine target");
  }
  for (const viewport of short)
    assert.equal(winning([":focus-visible", selector], "outline-offset", viewport)?.value, inset,
      viewport.name + ": retain the established inward ring for either short rail owner");
  const rules = [];
  sheets.find(sheet => sheet.name === "responsive-foundation.css").root.walkRules(rule => {
    if (rule.selectors?.includes(selector)) rules.push(rule);
  });
  assert.equal(rules.length, 1);
  assert.deepEqual(Object.fromEntries(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])),
    { "outline-offset": inset }, "change only paint offset, not size, grid, type, clipping, outline color, width, or style");
  const media = [];
  for (let parent = rules[0].parent; parent; parent = parent.parent)
    if (parent.type === "atrule" && parent.name === "media") media.push(parent.params);
  assert.deepEqual(media, ["(max-height: 37.5rem) and (orientation: landscape)"],
    "the same inset applies in forced colors without overriding the existing Highlight paint");
  assert.match(design, /@media \(forced-colors: active\)\s*\{[\s\S]*?:focus-visible\s*\{\s*outline:\s*3px solid Highlight;/);
  for (const viewport of [viewports[0], viewports[1], viewports[5], viewports[6]])
    assert.equal(winning(selector, "outline-offset", viewport), undefined,
      "the original floating-rail selector remains short-landscape only");
});

// E6 JA768 reached a healthy 44px native body whose outward ring crossed the
// same fixed toolbar edge already handled in the compact rail. No geometry or
// focus-event change is needed for this separate measured tall-rail condition.
test("E6 tall Document rail reuses inset focus for its actual toolbar toggle", () => {
  const selector = '.application-creative[data-nav-posture="rail"][data-short-height="false"][data-layout-intent="workbench"] .workspace-page[data-workbench="document"] > forma-project-rail > .project-rail > .rail-toolbar > .rail-collapse-toggle:focus-visible';
  const inset = "calc(-1 * var(--forma-focus-ring-width, .1875rem))";
  for (const viewport of [
    { name: "observed JA tall rail", width: 768, height: 900, pointer: "fine" },
    { name: "same tall coarse rail", width: 768, height: 900, pointer: "coarse" },
    { name: "existing tall rail owner", width: 934, height: 882, pointer: "fine" },
  ]) {
    assert.equal(winning([":focus-visible", selector], "outline-offset", viewport)?.value, inset, viewport.name);
    assert.equal(winning(".rail-toolbar", "height", viewport)?.value, "52px");
    assert.equal(winning(".rail-collapse-toggle", "min-inline-size", viewport)?.value, "var(--forma-hit-target)");
    assert.equal(winning(".rail-collapse-toggle", "min-block-size", viewport)?.value,
      viewport.pointer === "coarse" ? "var(--forma-hit-target-coarse)" : "var(--forma-hit-target)");
  }
  const rules = [];
  sheets.find(sheet => sheet.name === "responsive-foundation.css").root.walkRules(rule => {
    if (rule.selectors?.includes(selector)) rules.push(rule);
  });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, [selector], "only the actual tall rail toggle, not its popover descendants or other postures");
  assert.equal(rules[0].parent.type, "root");
  assert.deepEqual(Object.fromEntries(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])),
    { "outline-offset": inset }, "retain body size, clipping, text and existing focus ownership");
  assert.match(design, /@media \(forced-colors: active\)\s*\{[\s\S]*?:focus-visible\s*\{\s*outline:\s*3px solid Highlight;/);
});

// D428 R9 reached the compact rail's project link with a clear 44px body,
// but its outward focus ring crossed the Workspace's top clip by 2.5px.
// Library shares this exact toolbar; its physical paint is not measured here.
test("D428 compact Workspace and Library rail peers reuse inset focus without changing their shared toolbar", () => {
  const posture = '.application-creative[data-nav-posture="compact"]';
  const toolbar = posture + ' :is(.workspace-page, .library-page) > forma-project-rail > .project-rail > .rail-toolbar';
  const selectors = [
    toolbar + ' > .rail-toolbar-context > .rail-project-switch:focus-visible',
    toolbar + ' > .rail-collapse-toggle:focus-visible',
  ];
  const inset = "calc(-1 * var(--forma-focus-ring-width, .1875rem))";
  const compact = [
    { name: "observed R9 320px keyboard viewport", width: 320, height: 800, pointer: "fine" },
    { name: "same compact coarse controls", width: 320, height: 800, pointer: "coarse" },
    viewports[1],
    viewports[7],
  ];
  assert.ok(projectRail.includes('<header class="rail-toolbar">'));
  assert.ok(projectRail.includes('<span class="rail-toolbar-context"><a class="rail-project-switch"'));
  assert.ok(projectRail.includes('href=${projectIdentityRoute}'));
  assert.ok(projectRail.includes('this.#go(event,projectIdentityRoute)'));
  assert.ok(projectRail.includes('<button type="button" class="rail-collapse-toggle"'));
  assert.ok(projectRail.includes('aria-expanded=${!collapsed}'));
  assert.ok(projectRail.includes('popovertarget=${this.#nativePanel?this.#contentId:nothing}'));
  assert.ok(projectRail.includes('popover=${this.#nativePanel?"auto":nothing}'));
  assert.ok(library.includes('<section class="library-page"><forma-project-rail surface="library"></forma-project-rail>'),
    "Library uses the same existing rail, not a parallel toolbar");
  assert.equal(winning(".ui-audience-navigation a:focus-visible", "outline-offset", compact[0])?.value, inset,
    "reuse the existing inset treatment, including the earlier floating rail correction");
  assert.match(design, /@media \(forced-colors: active\)\s*\{[\s\S]*?:focus-visible\s*\{\s*outline:\s*3px solid Highlight;/);
  for (const viewport of compact) {
    assert.equal(winning(".rail-toolbar", "display", viewport)?.value, "flex");
    assert.equal(winning(".rail-toolbar", "align-items", viewport)?.value, "center");
    assert.equal(winning(".rail-toolbar", "height", viewport)?.value, "52px");
    assert.equal(winning(".rail-project-switch", "min-height", viewport)?.value, "2.75rem");
    assert.equal(winning(".rail-collapse-toggle", "min-inline-size", viewport)?.value, "var(--forma-hit-target)");
    assert.equal(winning(".rail-collapse-toggle", "min-block-size", viewport)?.value,
      viewport.pointer === "coarse" ? "var(--forma-hit-target-coarse)" : "var(--forma-hit-target)",
      "retain the existing 44px fine target and 48px coarse toggle height");
    for (const page of ["workspace-page", "library-page"]) {
      const host = posture + " ." + page + " > forma-project-rail";
      assert.equal(winning(host, "position", viewport)?.value, "relative");
      assert.equal(winning(host, "width", viewport)?.value, "100%");
    }
  }
  for (const viewport of compact) for (const selector of selectors)
    assert.equal(winning([":focus-visible", selector], "outline-offset", viewport)?.value, inset,
      viewport.name + ": keep either shared toolbar peer's ring inside its unchanged body");
  const rules = [];
  sheets.find(sheet => sheet.name === "responsive-foundation.css").root.walkRules(rule => {
    if (rule.selectors?.some(selector => selectors.includes(selector))) rules.push(rule);
  });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, selectors,
    "only the two direct toolbar peers, in either open state; never sibling popover links or noncompact rails");
  assert.deepEqual(Object.fromEntries(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])),
    { "outline-offset": inset }, "no control, header, clip, typography, outline width/style/color or focus-handler change");
  assert.equal(rules[0].parent.type, "root",
    "the existing measured compact posture owns this policy; it is not a new viewport or forced-colors exception");
});

// R6/R7 recorded Compare's raw 114.234375x44 body in a 158x44 native
// horizontal scroller, with only 54x44 currently visible. Compare was NOT
// focused before those runs stopped. This case checks the conditional paint
// policy only; native horizontal reveal and full-body fit remain browser gates.
test("E7 compact Document toolbar focus uses shared inset paint without replacing native horizontal scrolling", () => {
  const posture = '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"]';
  const strip = posture + ' .page-header--document .page-header-actions';
  const selector = posture + ' .workspace-page[data-workbench="document"] .page-header--document > .page-header-actions > :is(.button, .icon-button):focus-visible';
  const inset = "calc(-1 * var(--forma-focus-ring-width, .1875rem))";
  const compact = [
    { name: "recorded narrow portrait", width: 320, height: 800, pointer: "fine" },
    { name: "same narrow coarse branch", width: 320, height: 800, pointer: "coarse" },
    { name: "existing compact portrait", width: 390, height: 844, pointer: "coarse" },
  ];
  assert.ok(workspace.includes('class="document-actions page-header-actions"'));
  assert.ok(workspace.includes('@click=' + '$' + '{this.#compare}'));
  assert.ok(workspace.includes('?disabled=' + '$' + '{!canCompare}'),
    "the actual Compare control retains its existing handler and admission");
  assert.equal(winning(".ui-audience-navigation a:focus-visible", "outline-offset", compact[0])?.value, inset);
  for (const viewport of compact) {
    assert.equal(winning(strip, "max-inline-size", viewport)?.value, "55%");
    assert.equal(winning(strip, "flex-wrap", viewport)?.value, "nowrap");
    assert.equal(winning(strip, "overflow-x", viewport)?.value, "auto");
    assert.equal(winning(strip, "overscroll-behavior-inline", viewport)?.value, "contain");
    assert.equal(winning(strip + " > *", "min-inline-size", viewport)?.value, "var(--forma-hit-target)");
    assert.equal(winning(strip + " > *", "flex", viewport)?.value, "0 0 auto");
    assert.equal(winning(strip + " > .button", "white-space", viewport)?.value, "nowrap",
      "retain the intentional native action strip, not a clipping workaround or new menu");
  }
  for (const viewport of compact)
    assert.equal(winning([":focus-visible", selector], "outline-offset", viewport)?.value, inset,
      viewport.name + ": protect ring paint without claiming native horizontal reveal has occurred");
  const rules = [];
  sheets.find(sheet => sheet.name === "responsive-foundation.css").root.walkRules(rule => {
    if (rule.selectors?.includes(selector)) rules.push(rule);
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].parent.type, "root", "follow the existing compact-posture condition, not a guessed device");
  assert.deepEqual(Object.fromEntries(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])),
    { "outline-offset": inset }, "do not change target size, strip dimensions, scroll position, clipping, outline color, width, or style");
  assert.match(design, /@media \(forced-colors: active\)\s*\{[\s\S]*?:focus-visible\s*\{\s*outline:\s*3px solid Highlight;/,
    "the existing forced-colors focus paint remains authoritative");
});

// Conditional D428 follow-up: the narrow task strip has recorded overflow,
// but a native task-button focus failure has not yet been reached. This is
// source-policy coverage only, not proof of paint, focus delivery or body reveal.
test("D428 Document task-strip peers reuse inset focus without changing native scrolling or pane selection", () => {
  const strip = ".document-workbench-tasks";
  const button = strip + " > button";
  const selector = button + ":focus-visible";
  const pressed = button + '[aria-pressed="true"]';
  const inset = "calc(-1 * var(--forma-focus-ring-width, .1875rem))";
  const root = sheets.find(sheet => sheet.name === "responsive-foundation.css").root;
  assert.ok(workspace.includes('class="document-workbench-tasks"'));
  assert.ok(workspace.includes('data-has-reviews=' + '$' + '{String(documentReviews.length>0)}'));
  assert.ok(workspace.includes('role="group"'));
  assert.ok(workspace.includes('@keydown=' + '$' + '{this.#navigateWorkbenchPanes}'));
  assert.ok(workspace.includes('data-workbench-pane=' + '$' + '{pane}'));
  assert.ok(workspace.includes('aria-pressed=' + '$' + '{String(this.#workbenchPane===pane)}'));
  assert.ok(workspace.includes('@click=' + '$' + '{()=>this.#selectWorkbenchPane(pane)}'),
    "retain the actual native pane controls, selected-state semantics and handlers");
  assert.equal(winning(".ui-audience-navigation a:focus-visible", "outline-offset", viewports[0])?.value, inset);
  const sharedRules = [], pressedRules = [];
  root.walkRules(rule => {
    if (rule.selectors?.includes(strip) || rule.selectors?.includes(strip + '[data-has-reviews="true"]')) sharedRules.push(rule);
    if (rule.selectors?.includes(pressed)) pressedRules.push(rule);
  });
  assert.ok(sharedRules.some(rule => rule.selectors.includes(strip + '[data-has-reviews="true"]')
    && rule.parent.type === "root" && rule.nodes.some(node => node.prop === "display" && node.value === "flex")),
    "the same task strip is available with reviews outside narrow postures");
  assert.ok(sharedRules.some(rule => rule.selectors.includes(strip) && rule.parent.name === "container"
    && rule.parent.params === "studio (width < 46rem)"
    && rule.nodes.some(node => node.prop === "display" && node.value === "flex")),
    "retain the existing narrow-container presentation rather than inventing a new breakpoint");
  for (const viewport of viewports) {
    assert.equal(winning(strip, "overflow-x", viewport)?.value, "auto");
    assert.equal(winning(strip, "padding-inline", viewport)?.value, "var(--forma-pane-inset)");
    assert.equal(winning(strip, "scroll-padding-inline", viewport)?.value, "var(--forma-pane-inset)");
    assert.equal(winning(button, "flex", viewport)?.value, "0 0 auto");
    assert.equal(winning(button, "white-space", viewport)?.value, "nowrap");
    assert.equal(winning(button, "min-block-size", viewport)?.value,
      viewport.pointer === "coarse" ? "var(--forma-hit-target-coarse)" : "var(--forma-hit-target)",
      "retain the existing 48px coarse height and 44px fine target");
  }
  const forced = pressedRules.find(rule => rule.parent.name === "media" && rule.parent.params === "(forced-colors: active)");
  assert.ok(forced, "preserve the existing selected-task forced-colors treatment");
  assert.deepEqual(Object.fromEntries(forced.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])),
    { outline: "2px solid Highlight", "outline-offset": "-2px" });
  assert.deepEqual(specificity(selector), specificity(pressed),
    "the later selected-task forced-colors rule must keep its existing precedence");
  for (const viewport of viewports)
    assert.equal(winning([":focus-visible", selector], "outline-offset", viewport)?.value, inset,
      viewport.name + ": keep the ring inside a native task button without claiming full-body reveal");
  const rules = [];
  root.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, [selector]);
  assert.equal(rules[0].parent.type, "root", "the shared strip owns the rule, not one device or open-state subset");
  assert.deepEqual(Object.fromEntries(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])),
    { "outline-offset": inset }, "no size, scroll, typography, outline color/width/style, focus or pane-selection change");
  assert.ok(rules[0].source.start.line < forced.source.start.line,
    "the existing later forced-colors selected-task inset remains authoritative");
});

test("D428 Library native header buttons reserve existing focus clearance when scrolled into view", () => {
  // R28 reached a fully visible French Export body with an outward ring below
  // the viewport. This checks the source policy only; actual native Tab must
  // establish whether the browser honors it before any behavioral correction.
  const start = library.indexOf('<header class="page-header page-header--library">');
  const end = library.indexOf("</header>", start);
  assert.ok(start >= 0 && end > start);
  const header = library.slice(start, end);
  assert.ok(header.includes('<button type="button" class="button primary" data-context-controls-id="__new__"'));
  assert.ok(header.includes('</form><button class="button secondary"'));
  assert.ok(header.includes('this.store.authorizeProjectExport(receipt,authorization)'),
    "native scroll clearance must not change or activate the actual Export authorization/action");
  const selector = "forma-library .page-header--library > .page-header-actions > button";
  for (const viewport of viewports) {
    assert.equal(winning(":root", "--forma-focus-clearance", viewport)?.value, ".5rem");
    assert.equal(winning(":focus-visible", "outline-offset", viewport)?.value, "3px",
      "retain the existing outward native focus indicator");
    assert.equal(winning(selector, "scroll-margin-block", viewport)?.value, "var(--forma-focus-clearance)",
      viewport.name + ": reserve the existing clearance for native button reveal, not an inset or size workaround");
  }
  const rules = [];
  sheets.find(sheet => sheet.name === "styles.css").root.walkRules(rule => {
    if (rule.selectors?.includes(selector)) rules.push(rule);
  });
  assert.equal(rules.length, 1); assert.equal(rules[0].parent.type, "root");
  assert.deepEqual(Object.fromEntries(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])),
    { "scroll-margin-block": "var(--forma-focus-clearance)" });
});

// The native 200% journey reached a 94px pane containing a 94.78px textarea.
// These are source-policy cases; physical focus/body visibility remains a
// whole native-suite gate with the unchanged strict observer.
test("E6 short native-rail Document keeps a usable pane behind scrollable header rows", () => {
  const page = '.application-creative[data-nav-posture="rail"][data-short-height="true"][data-layout-intent="workbench"] .workspace-page[data-workbench="document"]:has(> forma-project-rail > .project-rail > .rail-toolbar > .rail-collapse-toggle[popovertarget])';
  const stage = page + " > .studio-main";
  const baseStage = '.workspace-page[data-workbench="document"] > .studio-main';
  const dockStage = page + ':has(> .composer-dock) > .studio-main';
  const pane = '.workspace-page[data-workbench="document"] .studio-grid > :is(.context-column, .output-column)';
  for (const viewport of [
    { name: "observed true-200 native owner", width: 419, height: 398, pointer: "fine" },
    { name: "same native coarse owner", width: 419, height: 398, pointer: "coarse" },
    { name: "short native media branch", width: 700, height: 390, pointer: "fine" },
    { name: "native owner above existing 760px static-header seam", width: 767, height: 390, pointer: "fine" },
    { name: "existing short-height boundary", width: 700, height: 600, pointer: "fine" },
  ]) {
    assert.equal(winning([baseStage, stage], "grid-template-rows", viewport)?.value, "auto auto minmax(16rem, 1fr)",
      viewport.name + ": header rows cannot consume the complete editing pane");
    assert.equal(winning(stage, "overflow-y", viewport)?.value, "auto", "native scrollIntoView can reveal the pane through this ancestor");
    assert.equal(winning(stage, "overscroll-behavior", viewport)?.value, "contain");
    assert.equal(winning([".studio-header-stack", stage + " > .studio-header-stack"], "position", viewport)?.value, "static",
      "the complete header scrolls out of the way even above the old 760px seam");
    assert.equal(winning(stage + " > .studio-header-stack", "top", viewport)?.value, "auto");
    assert.equal(winning(stage, "scroll-padding-block", viewport)?.value, "var(--forma-focus-clearance)");
    assert.equal(winning(stage, "scroll-padding-block-end", viewport), undefined, "an undocked stage has no phantom composer reserve");
    assert.equal(winning(dockStage, "scroll-padding-block-end", viewport)?.value, "calc(7rem + var(--forma-keyboard-offset))",
      "a real direct composer remains clear of the newly scrollable ancestor");
    assert.equal(winning(pane, "overflow-y", viewport)?.value, "auto", "the existing native pane stays independently scrollable");
    assert.equal(winning(pane, "scroll-padding-block", viewport)?.value, "var(--forma-focus-clearance)");
    assert.equal(winning(stage, "grid-row", viewport)?.value, "2", "the native invoker keeps its preceding full row");
    for (const property of ["font-size", "line-height", "height", "block-size", "max-height", "max-block-size", "display"])
      assert.equal(winning(stage, property, viewport), undefined, "do not shrink copy, cap the scroll owner, or hide content: " + property);
  }
  for (const viewport of [
    { name: "immediately taller native owner", width: 700, height: 601, pointer: "fine" },
    { name: "compact portrait owner", width: 390, height: 844, pointer: "coarse" },
    { name: "square seam", width: 600, height: 600, pointer: "fine" },
  ]) {
    assert.equal(winning([baseStage, stage], "grid-template-rows", viewport)?.value, "auto auto minmax(0, 1fr)");
    assert.equal(winning(stage, "overflow-y", viewport), undefined, viewport.name + ": preserve the ordinary bounded stage");
  }
  // Existing fixture matching lists only actual owners: an inline rail has no
  // popovertarget and therefore does not match the new native-stage selector.
  for (const viewport of [viewports[2], viewports[8]]) {
    assert.equal(winning(baseStage, "grid-template-rows", viewport)?.value, "auto auto minmax(0, 1fr)");
    assert.equal(winning(baseStage, "overflow-y", viewport), undefined);
  }
});

test("E6 short shared chrome removes only the application title already represented by the native current workspace", async () => {
  // Source/selector policy, not native :has(), text geometry or identity paint.
  // Keep the original whole-file membership and all earlier focus contracts.
  const navigationSource = await read("../src/components/design-system/navigation.ts");
  const switcherStart = navigationSource.indexOf("export class FormaUiWorkspaceSwitcher");
  const switcherEnd = navigationSource.indexOf("export class ", switcherStart + 1);
  assert.ok(switcherStart >= 0);
  const switcher = navigationSource.slice(switcherStart, switcherEnd < 0 ? undefined : switcherEnd);
  assert.ok(switcher.includes("const destinations = this.destinations.filter((destination) => !destination.disabled);"));
  assert.ok(switcher.includes("if (destinations.length < 2) return nothing;"),
    "zero/one available workspace has no emitted current link, so the title fallback must remain");
  assert.ok(switcher.includes("const current = destinations.find((destination) => destination.value === this.value) ?? destinations[0];"));
  assert.ok(switcher.includes('aria-current=' + '$' + '{destination.value === this.value ? "page" : nothing}'),
    "the proposed presence guard requires the real current application, not the fallback first option");
  assert.ok(switcher.includes('<span dir="auto">' + '$' + '{current.label}</span>'));
  assert.ok(switcher.includes("if (destinations.length === 2) return html"));
  assert.ok(switcher.includes('<nav class="ui-workspace-switcher application-switcher"'));
  assert.ok(switcher.includes('<div class="ui-workspace-switcher platform-switcher ui-popover">'),
    "the same current-link criterion serves both native two-link and popover presentations");
  assert.ok(shell.includes('label:this.i18n.t("shell."+candidate.id,candidate.label)'));
  assert.ok(shell.includes('.value=' + '$' + '{applicationId} .destinations=' + '$' + '{workspaceDestinations}'));
  assert.ok(shell.includes('<div class="application-context"><b>' + '$' + '{this.i18n.t("shell."+applicationId,application.label)}</b>'),
    "both current application labels use the same localized identity key; no English-text predicate");
  const actorStart = shell.indexOf('<span class="document-focus-actor"');
  const actorEnd = shell.indexOf('</span><button', actorStart);
  assert.ok(actorStart >= 0 && actorEnd > actorStart);
  const actor = shell.slice(actorStart, actorEnd);
  for (const identity of ["session.user.displayName", "focusedOrganization.name", "focusedMembership.role", "workspace.admin.role."])
    assert.ok(actor.includes(identity), "retain the distinct current actor/organization/role source: " + identity);
  assert.ok(shell.includes('class="button ghost compact document-focus-activity"'));
  assert.ok(shell.includes('this.#route(withProjectTaskDocumentInRoute("/activity",projection.documentId, this.store.route.get()))'));
  const shallow = { name: "retained shallow header", width: 844, height: 390, pointer: "fine" };
  assert.equal(winning(".application-context", "display", shallow)?.value, "flex");
  assert.equal(winning(".application-context", "flex", shallow)?.value, "1");
  assert.equal(winning(".application-context b", "flex", shallow)?.value, "none",
    "the current duplicate is nonshrinking while its context column may collapse");
  assert.equal(winning(".application-context span", "overflow", shallow)?.value, "hidden",
    "the distinct application description already owns its bounded text policy");
  assert.equal(winning(".document-focus-actor", "display", shallow)?.value, "grid");
  assert.equal(winning('.application-creative > .topbar', "block-size", shallow)?.value, "var(--forma-short-topbar-height)");
  assert.equal(winning('.application-canvas > .topbar', "block-size", shallow)?.value, "var(--forma-short-topbar-height)");
  assert.equal(winning(".ui-workspace-switcher-trigger", "min-block-size", shallow)?.value,
    "var(--forma-control-min-size, 2.75rem)");
  assert.equal(winning(".topbar > .top-actions > .avatar", "inline-size", shallow)?.value, "var(--forma-hit-target)");
  const compactHide = 'html[data-document-focus] .application-creative[data-nav-posture="compact"][data-layout-intent="workbench"] > .topbar > forma-ui-workspace-switcher';
  assert.equal(winning(compactHide, "display", shallow)?.value, "none",
    "the existing measured-compact policy can hide the switcher; do not use its unpainted link as an identity replacement");

  const selector = ':is(.application-creative, .application-canvas):not([data-nav-posture="compact"]) > .topbar:has(> forma-ui-workspace-switcher > .ui-workspace-switcher a[aria-current="page"]) > .application-context > b';
  const root = sheets.find(sheet => sheet.name === "responsive-foundation.css").root;
  const rules = [];
  root.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
  assert.equal(rules.length, 1, "desired source policy: deduplicate only when the same native current identity is present");
  assert.deepEqual(rules[0].selectors, [selector]);
  assert.equal(rules[0].parent.type, "atrule");
  assert.equal(rules[0].parent.name, "media");
  assert.equal(rules[0].parent.params, "(max-height: 37.5rem) and (orientation: landscape)");
  assert.equal(rules[0].parent.parent.type, "root");
  assert.deepEqual(Object.fromEntries(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])),
    { display: "none" }, "only the duplicate B, not its description, actor, role, Activity or any native control");
  for (const viewport of viewports) {
    const shortLandscape = viewport.height <= 600 && viewport.width > viewport.height;
    assert.equal(ruleActive(rules[0], viewport), shortLandscape, viewport.name + ": retain the existing short-chrome media scope");
  }
});
