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
const [base, design, responsive, canvas, shell, creativeEntry, studio, chat, activity, deliver, publicShare, localization] = await Promise.all([
  read("../src/styles.css"),
  read("../src/design-system.css"),
  read("../src/responsive-foundation.css"),
  read("../src/canvas/canvas.css"),
  read("../src/components/forma-shell.ts"),
  read("../src/apps/creative/entry.ts"),
  read("../src/components/studio-navigation.ts"),
  read("../src/components/forma-chat-studio.ts"),
  read("../src/components/forma-activity.ts"),
  read("../src/components/forma-deliver.ts"),
  read("../src/components/forma-shared-view.ts"),
  read("../src/components/design-system/localization.ts"),
]);

const [workspace, projectContents, projectRail, canvasApplication] = await Promise.all([
  read("../src/components/forma-workspace.ts"),
  read("../src/components/forma-project-contents.ts"),
  read("../src/components/project-rail.ts"),
  read("../src/canvas/canvas-application.ts"),
]);

const sheets = [["styles.css", base], ["design-system.css", design], ["responsive-foundation.css", responsive], ["canvas.css", canvas]]
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

function ruleActive(rule, viewport) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name === "media" && !mediaMatches(parent.params, viewport)) return false;
  }
  return true;
}

function specificity(selector) {
  const simplified = selector.replace(/:where\([^)]*\)/g, "");
  return [
    (simplified.match(/#[\w-]+/g) ?? []).length,
    (simplified.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length,
    (simplified.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g, "").match(/(^|[\s>+~])[\w-]+/g) ?? []).length,
  ];
}

function winning(selectors, property, viewport) {
  const matching = new Set(Array.isArray(selectors) ? selectors : [selectors]);
  let winner;
  let order = 0;
  for (const sheet of sheets) sheet.root.walkRules((rule) => {
    if (!ruleActive(rule, viewport)) return;
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
