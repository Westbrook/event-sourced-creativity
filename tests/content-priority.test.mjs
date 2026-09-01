import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { artifactReviewState } from "../src/model/context-health.ts";
import { documentIdFromRoute, withDocumentInRoute } from "../src/model/routes.ts";

const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [base, design, responsive, canvasCss, shell, workspace, artifacts, canvas, library, deliver, projects, projectContents, shared, dashboard, delivery, adapter, alternatives, editorAlternatives, deck, performance] = await Promise.all([
  read("../src/styles.css"),
  read("../src/design-system.css"),
  read("../src/responsive-foundation.css"),
  read("../src/canvas/canvas.css"),
  read("../src/components/forma-shell.ts"),
  read("../src/components/forma-workspace.ts"),
  read("../src/components/document-artifacts.ts"),
  read("../src/canvas/canvas-application.ts"),
  read("../src/components/forma-library.ts"),
  read("../src/components/forma-deliver.ts"),
  read("../src/components/forma-projects.ts"),
  read("../src/components/forma-project-contents.ts"),
  read("../src/components/forma-shared-view.ts"),
  read("../src/components/forma-role-dashboard.ts"),
  read("../src/apps/product/delivery.ts"),
  read("../src/apps/product/adapter-preview.ts"),
  read("../src/components/forma-studio-alternatives.ts"),
  read("../src/components/forma-studio-editor-alternatives.ts"),
  read("../src/components/presentation-deck.ts"),
  read("../src/performance.ts"),
]);

const feedback = await read("../src/components/design-system/feedback.ts");

const sheets = [
  ["styles.css", base],
  ["design-system.css", design],
  ["canvas.css", canvasCss],
  ["responsive-foundation.css", responsive],
].map(([name, source]) => ({ name, root: postcss.parse(source, { from: name }) }));

const portrait = { width: 390, height: 844, pointer: "coarse", rootRem: 16 };
const landscape = { width: 844, height: 390, pointer: "coarse", rootRem: 16 };
const desktop = { width: 1728, height: 1117, pointer: "fine", rootRem: 16 };

function length(number, unit, rootRem) {
  return Number(number) * (unit === "rem" ? rootRem : 1);
}

function conditionsMatch(params, viewport) {
  return params.split(",").some((branch) => {
    for (const [, bound, dimension, number, unit] of branch.matchAll(/\((min|max)-(width|height)\s*:\s*([\d.]+)(px|rem)\)/g)) {
      const threshold = length(number, unit, viewport.rootRem);
      if (bound === "max" ? viewport[dimension] > threshold : viewport[dimension] < threshold) return false;
    }

    for (const [, dimension, operator, number, unit] of branch.matchAll(/\((width|height)\s*(<=|>=|<|>|=)\s*([\d.]+)(px|rem)\)/g)) {
      const actual = viewport[dimension];
      const threshold = length(number, unit, viewport.rootRem);
      if (operator === "<" && !(actual < threshold)) return false;
      if (operator === "<=" && !(actual <= threshold)) return false;
      if (operator === ">" && !(actual > threshold)) return false;
      if (operator === ">=" && !(actual >= threshold)) return false;
      if (operator === "=" && actual !== threshold) return false;
    }

    const orientation = branch.match(/\(orientation\s*:\s*(portrait|landscape)\)/)?.[1];
    if (orientation && orientation !== (viewport.width > viewport.height ? "landscape" : "portrait")) return false;
    const pointer = branch.match(/\(pointer\s*:\s*(coarse|fine|none)\)/)?.[1];
    if (pointer && pointer !== viewport.pointer) return false;
    if (/\(forced-colors\s*:\s*active\)|\(prefers-reduced-motion\s*:\s*reduce\)/.test(branch)) return false;
    return true;
  });
}

function active(rule, viewport, container) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type !== "atrule") continue;
    if (parent.name === "media" && !conditionsMatch(parent.params, viewport)) return false;
    if (parent.name === "container") {
      if (!container) return false;
      const name = parent.params.match(/^([\w-]+)\s+\(/)?.[1];
      if (name && name !== container.name) return false;
      if (!conditionsMatch(parent.params, { ...viewport, width: container.width })) return false;
    }
  }
  return true;
}

function specificity(selector) {
  let simplified = selector.replace(/:where\([^)]*\)/g, "");
  const functional = [0, 0, 0];
  const compare = (left, right) => left.map((value, index) => value - right[index]).find((value) => value !== 0) ?? 0;
  simplified = simplified.replace(/:(?:is|not|has)\(([^()]*)\)/g, (_, list) => {
    const strongest = list.split(",").map((item) => specificity(item.trim())).reduce((left, right) => compare(left, right) >= 0 ? left : right, [0, 0, 0]);
    for (let index = 0; index < functional.length; index++) functional[index] += strongest[index];
    return "";
  });
  return [
    (simplified.match(/#[\w-]+/g) ?? []).length,
    (simplified.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length,
    (simplified.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g, "").match(/(^|[\s>+~])[\w-]+/g) ?? []).length,
  ].map((value, index) => value + functional[index]);
}

function winning(selectors, property, viewport, container) {
  const wanted = new Set(Array.isArray(selectors) ? selectors : [selectors]);
  let result;
  let order = 0;
  for (const sheet of sheets) sheet.root.walkRules((rule) => {
    if (!active(rule, viewport, container)) return;
    for (const selector of rule.selectors ?? []) {
      if (!wanted.has(selector)) continue;
      const weight = specificity(selector);
      rule.walkDecls(property, (declaration) => {
        const next = { value: declaration.value, important: Boolean(declaration.important), weight, order: order++, selector, file: sheet.name };
        if (!result) { result = next; return; }
        if (next.important !== result.important) { if (next.important) result = next; return; }
        const comparison = weight.map((value, index) => value - result.weight[index]).find((value) => value !== 0) ?? 0;
        if (comparison > 0 || comparison === 0 && next.order > result.order) result = next;
      });
    }
  });
  return result;
}

test("content-priority style sheets parse and modern fractional container ranges have no dead zone", () => {
  for (const width of [735.84, 735.85, 735.9, 735.99]) {
    const container = { name: "studio", width };
    assert.equal(winning(".document-workbench-tasks", "display", portrait, container)?.value, "flex", `${width}px still exposes the narrow work selector`);
    assert.equal(winning([".studio-grid", '.workspace-page[data-workbench="document"] .studio-grid'], "grid-template-columns", portrait, container)?.value, "minmax(0, 1fr)", `${width}px stays in the actual one-pane posture`);
  }

  const expanded = { name: "studio", width: 736 };
  assert.equal(winning(".document-workbench-tasks", "display", portrait, expanded)?.value, "none");
  assert.match(winning(".studio-grid", "grid-template-columns", portrait, expanded)?.value ?? "", /minmax\(18rem,\s*\.72fr\).*minmax\(25rem,\s*1fr\)/);

  const zoomed = { ...portrait, rootRem: 20 };
  assert.equal(winning(".document-workbench-tasks", "display", zoomed, { name: "studio", width: 919.99 })?.value, "flex");
  assert.equal(winning(".document-workbench-tasks", "display", zoomed, { name: "studio", width: 920 })?.value, "none");
  assert.equal(winning(['.studio-grid', '.workspace-page[data-workbench="document"] .studio-grid'], "display", portrait, { name: "studio", width: 320 })?.value, "grid");
});

test("document-only containment preserves neutral writing intent and exact result-directed project navigation", () => {
  assert.match(shell, /data-layout-intent=\$\{isCreative&&\(documentViewFromRoute\(path\)==="document"\|\|pathname==="\/creative\/create"\|\|pathname\.startsWith\("\/creative\/create\/"\)\)\?"workbench":"browse"\}/);
  assert.match(workspace, /#workbenchPane:"write"\|"result"\|"review"="write"/);
  assert.match(workspace, /#syncInspectorPosture=\(entries:ResizeObserverEntry\[\]\)=>\{[\s\S]*?const narrow=width<46\*rootSize/);
  const resize = workspace.split("#syncInspectorPosture=")[1].split("\n  #toggleWorkbenchInspector")[0];
  assert.doesNotMatch(resize, /#selectWorkbenchPane|setRoute\(|append\(|renderDocumentArtifact/);
  assert.match(projects, /displayArtifact\?\.documentId\?\?latest\?\.documentId/);
  assert.match(projects, /!canvas&&resultDocumentId\?withDocumentInRoute\("\/#output-title",resultDocumentId/);
  // The same exact destinations now pass through current-origin admission.
  // Keep the result-source builder tied to its actual native click, not only a route literal.
  assert.match(projects, /import \{ navigateInApp, performOperationInApp, type CommandDeparture, type CommandOperation, type OwnOperationAdmission \} from "\.\/command-departure";/);
  assert.match(projects, /#openProject\(projectId:string,destination:string\)\{\s*return navigateInApp\(this,navigation=>this\.store\.openProject\(projectId,destination,navigation\)\);\s*\}/);
  assert.match(projects, /@click=\$\{\(\)=>this\.#openProject\(project\.id,destination\)\}/);
  assert.match(projects, /@click=\$\{\(\)=>\{const resultDocumentId=displayArtifact\?\.documentId\?\?latest\?\.documentId;const resultDestination=!canvas&&resultDocumentId\?withDocumentInRoute\("\/#output-title",resultDocumentId,p\.documents\.find\(\(document\)=>document\.id===resultDocumentId\)\?\.title\?\?""\):destination;void this\.#openProject\(project\.id,resultDestination\);\}\}/);
  const route = withDocumentInRoute("/#output-title", "the-exact-source", "Signed-off design");
  assert.equal(documentIdFromRoute(route), "the-exact-source");
  assert.match(route, /#output-title$/);
  assert.match(workspace, /const linkedOutput=this\.store\.route\.get\(\)\.includes\("#output-title"\)/);
});

test("current-document review is always reachable without adding an empty desktop control bar", () => {
  assert.match(workspace, /scopedActivity\.reviews\.filter\(\(review\)=>review\.documentId===p\.documentId\)/);
  assert.match(workspace, /class="document-workbench-tasks" data-has-reviews=\$\{String\(documentReviews\.length>0\)\} role="group"/);
  assert.match(workspace, /aria-pressed=\$\{String\(this\.#workbenchPane===pane\)\} aria-controls=\$\{pane==="write"\?"document-context-panel":"document-results-panel"\}/);
  assert.match(workspace, /event\.key==="Home"[\s\S]*?event\.key==="End"[\s\S]*?event\.key==="ArrowRight"[\s\S]*?event\.key==="ArrowLeft"/);
  assert.equal(winning(".document-workbench-tasks", "display", desktop, { name: "studio", width: 1200 })?.value, "none");
  assert.equal(winning(['.document-workbench-tasks', '.document-workbench-tasks[data-has-reviews="true"]'], "display", desktop, { name: "studio", width: 1200 })?.value, "flex");
  assert.match(workspace, /#inlineInspectorPreference:boolean\|null=null/);
  assert.match(workspace, /const usefulOverview=Boolean\(p\.blocks\.length\|\|p\.artifacts\.length\|\|history\.length\|\|documentReviews\.length\|\|documentTasks\.length\)/);
});

test("authored source precedes suggestions, results survive async reordering, and genuine rights blockers remain visible", () => {
  const context = workspace.split('id="document-context-panel"')[1].split('id="document-results-panel"')[0];
  assert.ok(context.indexOf("document-workbench-critical") < context.indexOf('class="block-list"'));
  assert.ok(context.indexOf('class="block-list"') < context.indexOf("project-followup-actions"));
  assert.ok(context.indexOf('class="block-list"') < context.indexOf("context-health-actions"));
  assert.match(context, /class="block-list" data-forma-content="primary"/);
  assert.match(context, /class="blank-context" data-forma-empty-state/);
  assert.equal((workspace.match(/\$\{artifactGallery\}/g) ?? []).length, 1, "the artifact gallery stays mounted as one stable Lit part");
  assert.match(workspace, /const artifactFirst=!previewProgress/);
  assert.match(workspace, /p\.artifacts\[0\]!\.sequence>=selectedItem\.sequence/);
  assert.equal(winning(".context-block .block-copy", "white-space", portrait)?.value, "pre-wrap");
  assert.equal(winning(".context-block :is(.block-copy, .block-governed-context, .source-evidence-inspector)", "overflow-wrap", portrait)?.value, "anywhere");
});

test("retained work leads failures and retains explicit, scoped, paid-once recovery", () => {
  const gallery = artifacts.slice(artifacts.indexOf('return html`<section class=${`document-artifacts'));
  assert.ok(gallery.indexOf('class="document-artifact-list"') < gallery.indexOf('class="document-artifact-failure-digest"'));
  assert.ok(gallery.indexOf('class="document-artifact-failure-digest"') < gallery.indexOf("${this.#productionDesk"));
  assert.match(gallery, /<details class="document-artifact-failure-digest" \?open=\$\{!artifacts\.length\}/);
  assert.match(gallery, /recoverablePresentationJob&&artifacts\.length[\s\S]*?Recover saved render[\s\S]*?Paid once · replay without another provider call/);
  assert.match(artifacts, /documentJobCanRecoverPresentation\(job\)/,"only validated or safely repairable paid slideshow responses advertise free recovery");
  assert.match(artifacts, /documentJobCanRecoverProviderRender/);
  assert.match(artifacts, /session&&!session\.impersonation/);
  assert.match(artifacts, /productionOwner&&\(artifact\.kind==="slides"\|\|artifact\.kind==="audio"\|\|artifact\.kind==="storyboard"\|\|artifact\.kind==="video"\|\|artifact\.kind==="short_story"\|\|artifact\.kind==="scene"\)/, "settled generation costs remain owner-only across all six artifact families, including Story and Scene");
});

test("independent approval freshness resolves the exact artifact source document, not an identically named block elsewhere", () => {
  const artifact = { id: "artifact-a", documentId: "document-a", sequence: 10 };
  const approved = {
    sequence: 12,
    type: "ArtifactApproved",
    actor: "user:independent-reviewer",
    occurredAt: "2026-08-25T12:00:00.000Z",
    payload: { artifact_id: artifact.id },
  };
  const source = {
    sequence: 10,
    type: "DocumentRenderCompleted",
    payload: { artifact_id: artifact.id, source_block_versions: [{ block_id: "same-visible-id", version: 1 }] },
  };
  const own = { id: "same-visible-id", documentId: "document-a", projectId: "project-a", removed: false, sourceEvents: ["own-version"] };
  const foreignDuplicate = { id: "same-visible-id", documentId: "document-b", projectId: "project-a", removed: false, sourceEvents: ["b1", "b2"] };
  const foreignNew = { id: "unrelated-b", documentId: "document-b", projectId: "project-a", removed: false, sourceEvents: ["foreign"] };

  assert.equal(artifactReviewState(artifact, [foreignDuplicate, foreignNew, own], [source, approved]).status, "approved");
  assert.equal(artifactReviewState(artifact, [foreignDuplicate, foreignNew], [source, approved]).status, "stale", "another document cannot substitute for the actual source");
  assert.equal(artifactReviewState(artifact, [foreignDuplicate, { ...own, sourceEvents: ["own-version", "actual-edit"] }], [source, approved]).status, "stale");
  assert.match(artifacts, /block\.documentId===artifact\.documentId&&block\.projectId===current\.projectId/);
  assert.match(canvas, /block\.documentId===artifact\.documentId&&block\.projectId===projection\.projectId/);
});

test("Library prioritizes matching results, merges all artifact types by real sequence, and preserves explicit source filters", () => {
  assert.match(library, /const creativeResults:Array<\{kind:"history";item:GenerationHistoryItem;sequence:number\}\|\{kind:"artifact";artifact:DocumentArtifact;sequence:number\}>/);
  assert.match(library, /outputItems\.map\(\(item\)=>\(\{kind:"history" as const,item,sequence:item\.sequence\}\)\)/);
  assert.match(library, /artifactItems\.map\(\(artifact\)=>\(\{kind:"artifact" as const,artifact,sequence:artifact\.sequence\}\)\)/);
  assert.match(library, /\.sort\(\(left,right\)=>right\.sequence-left\.sequence\)/);
  const content = library.split('<div class="library-content">')[1].split('class="library-assigned-reviews"')[0];
  assert.ok(content.indexOf('this.#view==="all"&&creativeResults.length?resultsSection:nothing') < content.indexOf('this.#view==="all"||this.#view==="blocks"'));
  assert.ok(content.indexOf('this.#view==="all"||this.#view==="blocks"') < content.indexOf('this.#view==="all"&&creativeResults.length?nothing:resultsSection'));
  assert.match(library, /if\(item\.kind==="fan"\)return html`<article class="library-output library-prompt-fan" data-forma-content="primary"/);
  assert.match(library, /library-artifact-output" data-forma-content="primary"/);
  assert.match(library, /this\.i18n\.t\("artifact\.audio\.label","Audio"\)/);
  assert.match(library, /class="library-review-priority" role="status"/);
  assert.ok(library.indexOf('<div class="library-content">') < library.indexOf('class="library-organization-context"'));
});

test("delivery labels approval truthfully without blocking already releasable personal outputs", () => {
  assert.match(deliver, /documentIds\.has\(artifact\.documentId\)/);
  assert.match(deliver, /documentIds\.has\(output\.documentId\)/);
  assert.match(deliver, /const approvedArtifacts = reviewedArtifacts\.filter\(\(\{ delivery \}\) => delivery\.approved\)/);
  assert.match(deliver, /session\?\.projectContext && \(session\.projectContext\.managedPilot \|\| artifactSourceVersions\(artifact\.id, events\)\) && !delivery\.approved/);
  assert.match(deliver, /const readyArtifacts = reviewedArtifacts\.filter\(\(entry\) => !entry\.delivery\.approved && !independentlyGated\(entry\)\)/);
  assert.match(deliver, /artifactSection\(approvedArtifacts,[\s\S]*?artifactSection\(readyArtifacts,[\s\S]*?artifactSection\(pendingArtifacts,/);
  assert.match(deliver, /const reviewed = approvedArtifacts\.length/);
  assert.ok(deliver.indexOf("artifactSection(approvedArtifacts") < deliver.indexOf('class="forma-deliver-summary"'));
  assert.match(deliver, /forma-deliver-card--visual" data-forma-content="primary"/);
});

test("public shares render approved results first, expose slideshow immediately, and never hydrate account state", () => {
  assert.match(shared, /results\.length\?html`<section class="shared-results"[\s\S]*?<aside class="shared-direction"/);
  assert.match(shared, /:html`<aside class="shared-direction"[\s\S]*?<section class="shared-results"/);
  const artifactCard = shared.split('class="shared-output shared-artifact"')[1].split("const fan =")[0];
  assert.ok(artifactCard.indexOf("shared-presentation-open") < artifactCard.indexOf("shared-result-details"));
  assert.ok(artifactCard.indexOf("this.#presentationDialog()") > artifactCard.indexOf("</details>"));
  assert.match(shared, /class=\$\{`shared-output\$\{fan \? " shared-output-fan" : ""\}`\} data-forma-content="primary"/);
  assert.doesNotMatch(shared, /this\.store|from "\.\/forma-element"|from "\.\.\/state\/store"/);
});

test("project documents and concrete specialist evidence precede aggregate dashboards", () => {
  assert.ok(projectContents.indexOf('class="document-library-grid"') < projectContents.indexOf('class="project-overview-summary"'));
  assert.match(projectContents, /newestArtifact\.sequence>documentOutputs\[0\]\.sequence/);
  assert.match(dashboard, /const priority:Record<RoleEvidence\["status"\],number>=\{blocked:0,approval_required:1,pending:2,passed:3\}/);
  assert.ok(dashboard.indexOf('class="role-evidence"') < dashboard.indexOf('class="role-metric-grid"'));
  assert.match(dashboard, /dashboardHeadingLevel===1\?html`<h1/);
  assert.match(dashboard, /:html`<h2 id="role-dashboard-heading"/);
  assert.ok(delivery.indexOf('class="delivery-decision-list"') < delivery.indexOf('class="delivery-decision-form"'));
  assert.ok(delivery.indexOf('class="delivery-decision-list"') < delivery.lastIndexOf("this.dashboard("));
  assert.ok(adapter.indexOf('class="adapter-preview-form"') < adapter.lastIndexOf("super.render()"));
});

test("document-card previews contain every result and keep document actions above their media", () => {
  const preview = ".document-card-preview";
  const frame = ".document-card-preview > i";
  const actions = [".document-card-actions", ".document-card > .document-card-actions"];

  assert.ok(projectContents.includes("html`<i><forma-artifact-summary"), "artifact previews rely on the inherited default stack position");
  assert.ok(projectContents.includes("style=${`--stack:${index}`}"), "image previews retain their individual visual-stack offsets");

  for (const [posture, viewport] of [["portrait", portrait], ["landscape", landscape], ["desktop", desktop]]) {
    assert.equal(winning(preview, "--stack", viewport)?.value, "0", `${posture}: artifacts without an explicit stack index still fill their preview`);
    assert.equal(winning(preview, "position", viewport)?.value, "relative", `${posture}: media positions against its own preview`);
    assert.equal(winning(preview, "z-index", viewport)?.value, "0", `${posture}: previews own their background stacking layer`);
    assert.equal(winning(preview, "isolation", viewport)?.value, "isolate", `${posture}: embedded media cannot escape the preview stacking context`);
    assert.equal(winning(preview, "overflow", viewport)?.value, "hidden", `${posture}: oversized videos and image stacks stop at the preview boundary`);

    assert.equal(winning(frame, "position", viewport)?.value, "absolute", `${posture}: result frames remain inside their preview`);
    assert.equal(winning(frame, "overflow", viewport)?.value, "hidden", `${posture}: a frame also clips its own generated media`);
    assert.equal(winning(".document-card-preview i", "position", viewport), undefined, `${posture}: nested artifact slide and icon elements never become preview frames`);
    for (const edge of ["top", "right", "bottom", "left"]) {
      assert.match(winning(frame, edge, viewport)?.value ?? "", /var\(--stack,\s*0\)/, `${posture}: the ${edge} edge safely defaults while honoring individual image-stack positions`);
    }

    assert.equal(winning(actions, "position", viewport)?.value, "relative", `${posture}: document actions establish their own interactive layer`);
    const previewLayer = Number(winning(preview, "z-index", viewport)?.value);
    const actionLayer = Number(winning(actions, "z-index", viewport)?.value);
    assert.ok(Number.isFinite(actionLayer) && actionLayer > previewLayer, `${posture}: document actions outrank preview media for hit testing`);
  }
});

test("project document-card results cover their complete preview without inheriting global minimum media sizes", () => {
  const hosts = ".document-card-preview > i > :is(forma-output-visual, forma-artifact-summary)";
  const summary = ".document-card-preview > i > forma-artifact-summary > .artifact-summary";
  const artifactMedia = ".document-card-preview > i > forma-artifact-summary > .artifact-summary > :is(video, .artifact-summary-frames, forma-presentation-slide, .artifact-summary-copy)";
  const imageMedia = ".document-card-preview > i > forma-output-visual > :is(.generated-output-trigger, .generated-output-image)";
  const fittedMedia = [
    ".document-card-preview > i > forma-artifact-summary > .artifact-summary > video",
    ".document-card-preview > i > forma-artifact-summary > .artifact-summary > .artifact-summary-frames > img",
    ".document-card-preview > i > forma-output-visual > .generated-output-image",
    ".document-card-preview > i > forma-output-visual > .generated-output-trigger > .generated-output-image",
  ];

  for (const [posture, viewport] of [["portrait", portrait], ["landscape", landscape], ["desktop", desktop]]) {
    for (const selector of [hosts, summary, artifactMedia, imageMedia]) {
      assert.equal(winning(selector, "inline-size", viewport)?.value, "100%", `${posture}: ${selector} spans its complete preview width`);
      assert.equal(winning(selector, "block-size", viewport)?.value, "100%", `${posture}: ${selector} spans its complete preview height`);
      assert.equal(winning(selector, "min-inline-size", viewport)?.value, "0", `${posture}: ${selector} can shrink inside its preview`);
      assert.equal(winning(selector, "min-block-size", viewport)?.value, "0", `${posture}: ${selector} never expands beyond its preview`);
    }

    for (const selector of fittedMedia) {
      assert.equal(winning(selector, "object-fit", viewport)?.value, "cover", `${posture}: ${selector} fills its frame without letterboxing or restyling nested presentation artwork`);
    }

    const compactMinimum = winning(".artifact-summary.compact", "min-height", viewport);
    const storyboardMinimum = winning(".artifact-summary-frames", "min-height", viewport);
    assert.equal(compactMinimum?.value, "8rem", `${posture}: compact artifact summaries retain their global minimum elsewhere`);
    assert.equal(storyboardMinimum?.value, "11rem", `${posture}: storyboard frames retain their global minimum elsewhere`);

    for (const [selector, global, description] of [
      [summary, compactMinimum, "compact artifact summaries"],
      [artifactMedia, storyboardMinimum, "storyboard frames"],
    ]) {
      const scoped = winning(selector, "min-block-size", viewport);
      const comparison = scoped.weight.map((value, index) => value - global.weight[index]).find((value) => value !== 0) ?? 0;
      assert.ok(comparison > 0, `${posture}: scoped ${description} sizing overrides later global minimum-height rules`);
    }
  }
});

test("alternative creator lenses mount their real task before explanatory readiness and inherited navigation", () => {
  assert.match(alternatives, /class="studio-subpage-body">\s*\$\{body\}\s*<forma-output-requirements\s+\.documentId=\$\{projection\.documentId\}><\/forma-output-requirements>\s*<forma-studio-navigator/);
  assert.match(alternatives, /const body = html`\s*<div class="context-board" data-forma-content="primary">[\s\S]*?\$\{capture\}\s*\$\{readiness\}`/);
  assert.match(alternatives, /const body = html`\s*<form id=\$\{guidedFormId\}[\s\S]*?<section class="guided-brief guided-brief--focused">[\s\S]*?\$\{steps\}\s*\$\{readiness\}/);
  assert.match(editorAlternatives, /const body = html`\s*<div class="reality-editor" data-forma-content="primary">[\s\S]*?<\/div>\s*\$\{readiness\}/);
  assert.match(editorAlternatives, /const body = html`\$\{suggestions\}(?:<button class="text-button" type="button" @click=\$\{this\.#resumeProposalReview\}>\$\{this\.i18n\.t\("adaptive\.changes\.resume"\)\}<\/button>\$\{this\.#proposalDialog\(\)\})?\s*<div class=\$\{`adaptive-workspace adaptive-stage--\$\{stage\}`\} data-forma-content="primary">[\s\S]*?\$\{intent\}\s*\$\{readiness\}`/);
});

test("wide-screen support panes remain bounded and truly empty overviews do not claim the work surface", () => {
  assert.equal(winning('.studio-grid[data-inspector-open="true"]', "grid-template-columns", desktop, { name: "studio", width: 1400 })?.value, "minmax(15rem, 17rem) minmax(27rem, 1fr) minmax(17rem, 18rem)");
  assert.equal(winning(".studio-grid", "grid-template-columns", desktop, { name: "studio", width: 1400 })?.value, "minmax(17rem, 20rem) minmax(0, 1fr)");
  for (const selector of [".role-dashboard", ".delivery-planning", ".workspace-settings-page", ".forma-activity-sections", ".library-block-editor-layout", ".shared-grid"]) {
    assert.equal(winning(selector, "max-inline-size", desktop)?.value, "none", `${selector} can use actual available width`);
  }
  assert.match(workspace, /this\.#inlineInspectorOpen=this\.#inlineInspectorPreference\?\?usefulOverview/);
});

test("short-landscape output viewers reserve one normal identity row and zero focused slide rows", () => {
  const stage = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck--slideshow .presentation-deck-stage';
  const card = '.document-artifact-view[data-artifact-kind="slides"] > .document-artifact-reader';
  const focused = '.document-artifact-view[data-output-focus="true"][data-artifact-kind="slides"] > .document-artifact-reader';
  assert.equal(winning(stage, "grid-template-rows", landscape)?.value, "minmax(0, 1fr)");
  assert.equal(winning(stage, "padding", landscape)?.value, "0");
  assert.equal(winning(card, "grid-template-rows", landscape)?.value, "var(--forma-hit-target) minmax(0, 1fr)");
  assert.equal(winning([card, focused], "grid-template-rows", landscape)?.value, "minmax(0, 1fr)");
  assert.equal(winning(".shared-presentation-dialog .shared-presentation-stage", "grid-template-rows", landscape)?.value, "minmax(0, 1fr)");
  assert.equal(winning(stage, "grid-template-rows", portrait)?.value, undefined, "portrait retains its naturally useful supporting content");

  const idealHeight = landscape.height;
  const conservativeNormalHeight = landscape.height - 16 - 44;
  const conservativeFocusHeight = landscape.height - 8;
  assert.ok((conservativeNormalHeight / idealHeight) ** 2 > .70, "normal 16:9 landscape fit exceeds the approved 70% minimum");
  assert.ok((conservativeFocusHeight / idealHeight) ** 2 > .85, "focused 16:9 landscape fit exceeds the approved 85% minimum");
});

test("slide tools, source reading, direct jump, authorization and 44px controls survive compact focus", () => {
  const compactJump = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar .presentation-deck-jump--compact';
  const compactToggle = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar > .presentation-deck-tools-toggle';
  const nav = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage > nav';
  const normalJump = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage > nav > .presentation-deck-jump';
  const toolbar = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  const legacyFocusedToolbar = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-output-focus="true"] .presentation-deck-toolbar';

  assert.equal(winning(".presentation-deck-jump--compact", "display", portrait)?.value, "none");
  assert.equal(winning([".presentation-deck-jump--compact", compactJump], "display", landscape)?.value, "inline-flex");
  assert.equal(winning(normalJump, "display", landscape)?.value, "none");
  assert.equal(winning(compactToggle, "min-inline-size", landscape)?.value, "var(--forma-hit-target)");
  assert.equal(winning(nav, "position", landscape)?.value, "absolute");
  assert.equal(winning([toolbar, legacyFocusedToolbar], "display", landscape)?.value, "flex", "late final stylesheet restores the accessible focused control strip");
  assert.match(deck, /presentation-deck-tools-toggle" aria-label=\$\{this\.i18n\.system\("Slideshow controls"\)\}[\s\S]*?aria-expanded=\$\{String\(this\.#compactToolsOpen\)\} aria-controls=\$\{`\$\{this\.#exportMenuId\}-view \$\{this\.#exportMenuId\}-delivery`\}/);
  assert.match(deck, /presentation-deck-jump presentation-deck-jump--compact[\s\S]*?aria-label="Jump to slide"/);
  assert.match(deck, /aria-label=\$\{this\.i18n\.system\("Previous"\)\}[\s\S]*?aria-keyshortcuts=/);
  assert.match(deck, /aria-label=\$\{this\.i18n\.system\("Next"\)\}[\s\S]*?aria-keyshortcuts=/);
  assert.match(deck, /presentation-deck-reader-content[\s\S]*?Authorized source evidence/);
  assert.match(deck, /!this\.releaseAllowed/);
  for (const viewer of [artifacts, canvas]) {
    const popover = viewer.match(/<forma-ui-popover class="artifact-viewer-actions-popover"[\s\S]*?<\/forma-ui-popover>/)?.[0];
    assert.ok(popover, "More actions remains in the shared native popover");
    assert.match(popover, /\.label=\$\{this\.i18n\.t\("action\.more","More actions"\)\}/);
    assert.match(popover, /\.content=\$\{viewerActions\}/);
    assert.match(popover, /@forma-toggle=[\s\S]*this\.#viewerActionsOpen=event\.detail\.open/);
    assert.match(viewer, /class="artifact-viewer-actions-body"/);
  }
  assert.match(feedback, /class="button secondary ui-popover-trigger" popovertarget=\$\{this\.#id\} aria-controls=\$\{this\.#id\} aria-expanded=\$\{String\(this\.#open\)\}/, "the native trigger owns the same expanded panel ID");
  assert.match(feedback, /<section id=\$\{this\.#id\} class="ui-popover-panel" popover="auto" aria-label=\$\{this\.heading \|\| label\}/, "the browser-owned panel keeps an accessible name");
  assert.equal(winning(".ui-popover-panel[popover]:not(:popover-open)", "display", portrait)?.value, "none");
  for (const property of ["min-inline-size", "min-block-size"]) assert.equal(winning(".ui-popover-trigger", property, landscape)?.value, "var(--forma-control-min-size,2.75rem)", "native actions retain a 44px floor");
});

test("focused private and Canvas presentations retain a visible, readable, correctly scoped independent-review state", () => {
  const privateStatus = '.document-artifact-view[data-output-focus="true"][data-artifact-kind="slides"] .artifact-viewer-kicker > .artifact-review-status';
  const canvasStatus = '.canvas-artifact-viewer[data-output-focus="true"][data-artifact-kind="slides"] > .canvas-artifact-viewer-card > header > .artifact-review-status';
  for (const selector of [privateStatus, canvasStatus]) {
    assert.equal(winning(selector, "display", landscape)?.value, "block");
    assert.equal(winning(selector, "font-size", landscape)?.value, "var(--type-caption)", `${selector} must never shrink below the 12px reviewer-state floor`);
  }
  assert.match(artifacts, /artifact-review-status artifact-review-\$\{review\.status\}/);
  assert.match(canvas, /artifact-review-status artifact-review-\$\{review\.status\}/);
  assert.match(canvas, /this\.i18n\.t\(`deliver\.review\.\$\{review\.status\}`,review\.label\)/);
});

test("actual-content readiness rejects chrome-only shells and every priority workbench object is truthful", () => {
  assert.match(performance, /querySelectorAll\("\[data-forma-content=primary\],\[data-forma-empty-state\]"\)/);
  assert.match(performance, /\.some\(\(item\)=>!item\.closest\("\[hidden\]"\)\)/);
  assert.match(performance, /pathname==="\/deliver"[\s\S]*?\.forma-deliver-preview,\.forma-responsive-empty\[data-forma-empty-state\]/);
  assert.match(performance, /surface === "shared-document"[\s\S]*?\.shared-view \.shared-output/);
  assert.match(workspace, /class="blank-context" data-forma-empty-state/);
  assert.match(workspace, /class="empty-output" data-forma-empty-state/);
  assert.match(deliver, /class="forma-responsive-empty" data-forma-empty-state/);
});
