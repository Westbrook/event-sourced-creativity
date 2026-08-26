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
  assert.equal(winning(".application-canvas :is(.canvas-intent-dock, .canvas-organize-menu)", "inset-inline-start", landscape)?.value, "auto");
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
  assert.match(artifacts, /<h3>\$\{guidance\.title\}<\/h3>/);
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
  assert.match(responsive, /\.project-rail\.expanded \.rail-content\s*\{[^}]*position:\s*absolute/s);
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
      const overlay = [".application-creative .project-rail.expanded .rail-content", '.application-creative[data-nav-posture="compact"] .project-rail.expanded .rail-content'];
      assert.equal(winning(overlay, "position", viewport)?.value, "absolute", `${viewport.name}: expanded project navigation remains usable`);
      assert.equal(winning(overlay, "overflow-y", viewport)?.value, "auto");
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

test("Activity rejects orphan, removed, cross-tenant, unauthorized, and impersonated records", () => {
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

  const personal = { ...session, projectContext: undefined };
  const noPersonalProject = { ...projection, projectId: "", documents: [], libraryArtifacts: [] };
  assert.deepEqual(scopedFormaActivity(personal, noPersonalProject, notifications, reviews, jobs).reviews.map((item) => item.id), ["review-a"]);
  assert.equal(scopedFormaActivity({ ...personal, projects: undefined }, noPersonalProject, notifications, reviews, jobs).reviews.length, 0);
  assert.equal(scopedFormaActivity({ ...personal, impersonation: { active: true } }, noPersonalProject, notifications, reviews, jobs).reviews.length, 0);
  assert.match(activity, /leaveProjectContext\(\)[\s\S]*?setRoute\("\/activity"\)/);
  assert.match(activity, /acknowledgeProjectNotification\(notification\.id\)/);
  assert.match(deliver, /documentIds\.has\(artifact\.documentId\)/);
  assert.match(deliver, /documentIds\.has\(output\.documentId\)/);
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
  assert.match(projectContents,/scopedFormaActivity\(session,p,\[\],this\.store\.reviewInbox\.get\(\),\[\]\)/);
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
