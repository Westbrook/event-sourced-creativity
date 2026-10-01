/** Knowledge R2 correction, 2026-09-07. This successor has not executed.
 * R1 remains a closed 2-pass/2-fail actual. Only the two Focal cases admit
 * the three exact public PNG fetches below, twice each for the existing
 * current/legacy samplers. Original response bytes are observed, never stubbed.
 * The gutter assertion measures actual hero content, preserving its intentional
 * full-bleed background and the original positive/symmetric gutter tolerance.
 * Reuses forma-engineering-return-paths.spec.mjs 23776/29ce07c9 admission,
 * session observation, handler drainage, fonts and native keyboard helpers.
 * Engineering reports, schema operations and held-response queues are absent.
 *
 * Read-only C baseline: knowledge entry 3242/e203740b, landing 4860/708f0209,
 * design lab 19495/f4ea2f94, focal lab 17275/e6e97aaa, catalog 41419/64eaa5ba.
 * The trailing-slash case is
 * intentionally a regression for the separately authored focal predicates;
 * ordinary permalink activation also covers the parent's guarded successor.
 * Canonical must admit its composed current sources and owned preview before running.
 *
 * Four cases, one English 1280x900 desktop profile, one synthetic session GET
 * and one delivered main document per case. Existing fixture teardown, trace,
 * no-write/no-egress and strict focus observers remain unchanged. Requires
 * FORMA_A11Y_SYNTHETIC_NETWORK=1 and the retained loopback :4186 transport.
 * No process/port/build/browser allocation, generated fixtures, provider work,
 * project data, permission enforcement, modified-click tab, AT or native PASS
 * is claimed. Focal's original automatic local image calculations remain real;
 * this slice adds no sampling request, image replacement or calculation stub.
 */
import { test, expect, browserMetrics, captureViewport, applyBrowserZoom } from "./fixtures.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { classifyTestRequest, localTestOrigin } from "./helpers/read-only-network.mjs";
import { syntheticNetworkEnabled } from "./helpers/synthetic-network.mjs";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";

// Frozen PUBLIC served-source expectation; current runtime admission is separate.
const manifestAsset = Object.freeze({
  "path": "/custom-elements.json",
  "filename": "custom-elements.json",
  "bytes": 527843,
  "sha256": "f6ec54bc8b4eb308ea075d21b9305733e7a78f4f5f2fa561a8697414566e7e12",
  "savedSource": "/Users/westbrook/.codex/visualizations/2026/08/26/01a03eaa-d5b7-7630-943d-7105f7a3067b/forma-recovery-20260831/knowledge-public-manifest-source-20260908-r1.json",
  "servedSource": "/Users/westbrook/.codex/visualizations/2026/08/26/01a03eaa-d5b7-7630-943d-7105f7a3067b/forma-recovery-20260831/checkout/public/custom-elements.json",
  "moduleCount": 104,
  "tagNames": [
    "forma-access-management",
    "forma-account-settings",
    "forma-activity",
    "forma-activity-issue-panel",
    "forma-actual-replay",
    "forma-adaptive-path",
    "forma-admin-events",
    "forma-analytics",
    "forma-area-navigation",
    "forma-artifact-summary",
    "forma-assistant-panel",
    "forma-attention-observer",
    "forma-canvas-application",
    "forma-canvas-governance",
    "forma-canvas-surface",
    "forma-canvas-sync-inspector",
    "forma-chat-studio",
    "forma-collection-tree",
    "forma-component-catalog",
    "forma-context-block",
    "forma-context-board",
    "forma-context-intelligence",
    "forma-creative-application",
    "forma-creative-assistant",
    "forma-creative-editor",
    "forma-deliver",
    "forma-design-system-lab",
    "forma-document-artifacts",
    "forma-document-continuity",
    "forma-document-generations",
    "forma-engineering-application",
    "forma-engineering-diagnostics",
    "forma-event-inspector",
    "forma-experience",
    "forma-experience-navigation",
    "forma-experience-review",
    "forma-focal-point-lab",
    "forma-generation-actions",
    "forma-generation-input-dialog",
    "forma-guided-brief",
    "forma-image-adapter-lab",
    "forma-image-format-editor",
    "forma-knowledge-application",
    "forma-laboratory-application",
    "forma-library",
    "forma-library-block-editor",
    "forma-memory",
    "forma-model3d-settings-editor",
    "forma-model3d-viewer",
    "forma-operations-application",
    "forma-operations-overview",
    "forma-operations-providers",
    "forma-output-card",
    "forma-output-input-editor",
    "forma-output-requirement-card",
    "forma-output-requirements",
    "forma-output-visual",
    "forma-personal-memory",
    "forma-platform-assistant",
    "forma-platform-shell",
    "forma-presentation-deck",
    "forma-presentation-rejected-drafts",
    "forma-presentation-slide",
    "forma-product-adapter-preview",
    "forma-product-application",
    "forma-product-delivery",
    "forma-product-evaluation",
    "forma-product-insights",
    "forma-project-contents",
    "forma-project-rail",
    "forma-projects",
    "forma-prompt-fan-review",
    "forma-prompt-fan-visual",
    "forma-public-share",
    "forma-reality-layers",
    "forma-reference-composition-editor",
    "forma-reference-compositor",
    "forma-reference-findings",
    "forma-reference-image",
    "forma-reference-palette-picker",
    "forma-reference-pixel-policy",
    "forma-replay-app-runner",
    "forma-retained-short-story",
    "forma-scout",
    "forma-sessions",
    "forma-shared-view",
    "forma-shell",
    "forma-spatial-scope-editor",
    "forma-studio-mode-nav",
    "forma-studio-navigator",
    "forma-synthetic-replay",
    "forma-system",
    "forma-ui-audience-navigation",
    "forma-ui-avatar",
    "forma-ui-badge",
    "forma-ui-breadcrumbs",
    "forma-ui-button",
    "forma-ui-card",
    "forma-ui-checkbox",
    "forma-ui-chip",
    "forma-ui-choice-card",
    "forma-ui-cluster",
    "forma-ui-conversation-composer",
    "forma-ui-copy-button",
    "forma-ui-dialog",
    "forma-ui-disclosure",
    "forma-ui-divider",
    "forma-ui-empty-state",
    "forma-ui-field",
    "forma-ui-icon",
    "forma-ui-icon-button",
    "forma-ui-kbd",
    "forma-ui-language-picker",
    "forma-ui-link",
    "forma-ui-list-item",
    "forma-ui-locale",
    "forma-ui-metric",
    "forma-ui-notice",
    "forma-ui-number-field",
    "forma-ui-page-header",
    "forma-ui-pagination",
    "forma-ui-popover",
    "forma-ui-progress",
    "forma-ui-radio-group",
    "forma-ui-rich-text",
    "forma-ui-search",
    "forma-ui-segmented-control",
    "forma-ui-select",
    "forma-ui-skeleton",
    "forma-ui-spinner",
    "forma-ui-stack",
    "forma-ui-status",
    "forma-ui-surface",
    "forma-ui-switch",
    "forma-ui-tabs",
    "forma-ui-textarea",
    "forma-ui-theme",
    "forma-ui-toolbar",
    "forma-ui-workspace-switcher",
    "forma-video-reference-preflight",
    "forma-workspace",
    "forma-workspace-settings"
  ]
});

const focalImages = Object.freeze([
  { path: "/focal-point-lab/children-in-park-01.png", bytes: 2774345, sha256: "9cbc4a6ac0ab9a04b6e9d340ccdd733766c720ba08bc3a557b88f80ad1d0ecda" },
  { path: "/focal-point-lab/children-in-park-02.png", bytes: 2777433, sha256: "cadd266a2d921b3a875adc8e9335caf1270c519edc4ff9bb63f9cd407856d45e" },
  { path: "/focal-point-lab/children-in-park-03.png", bytes: 2699418, sha256: "b90eb61663600b3c60cda4022bdb5991d529fdc94b1d5b978a15e315a465d916" },
]);

const provenance = Object.freeze({
  mode: "new-finite-knowledge-synthetic-session",
  authority: "Declared Knowledge capabilities only; not authentication or server authorization evidence",
  application: "Original delivered document and current platform/Knowledge components; no injected modules, bootstrap, Store state or fetch override",
  limits: "Four English desktop cases; no provider, private media, production, organization, other locales, AT or full-application acceptance",
});
const paths = Object.freeze({ home: "/knowledge", components: "/knowledge/design-system", patterns: "/knowledge/patterns",
  guidance: "/knowledge/guidance", landing: "/knowledge/landing-pages", focal: "/knowledge/focal-points", focalSlash: "/knowledge/focal-points/" });
const allCaps = ["design.catalog.read", "design.docs.read"];
const nav = page => page.locator("forma-ui-audience-navigation.platform-navigation");
const knowledge = page => page.locator("forma-knowledge-application");
const catalog = page => knowledge(page).locator("forma-component-catalog");
const focal = page => knowledge(page).locator("forma-focal-point-lab");
const main = page => page.locator("forma-platform-shell #main-content");

test.use({ geometry: { viewport: { width: 1280, height: 900 }, zoom: 1, locale: "en-US" } });

async function attach(testInfo, name, observation) {
  // The donor's Creative fixture label is not platform-session provenance.
  await testInfo.attach(name, { body: JSON.stringify({ provenance, observation }, null, 2), contentType: "application/json" });
}

async function withKnowledge({ page, context, baseURL }, testInfo, capabilities, initialPath, visitsFocal, body, manifestDelivery = false) {
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  expect(Object.values(paths)).toContain(initialPath);
  const origin = localTestOrigin(baseURL), counts = new Map(), pendingHandlers = new Set();
  const expectedReads = { "/api/session": 1 };
  const imageCounts = new Map();
  let manifestReads = 0;
  const expectedManifestReads = manifestDelivery ? 1 : 0;
  const expectedImageReads = visitsFocal ? Object.fromEntries(focalImages.map(image => [image.path, 2])) : {};
  const log = { documents: [], responses: [], imageRequests: [], imageResponses: [], manifestRequests: [], deniedTransport: [], handlerErrors: [], pageErrors: [],
    expectedReads, expectedImageReads, expectedManifestReads, imageProvenance: visitsFocal ? focalImages : [], capabilities: [...capabilities] };
  const session = { user: { userId: "new-knowledge-synthetic-principal", email: "knowledge@example.invalid",
    displayName: "Fictional Knowledge principal", role: "creator" }, audience: "knowledge", capabilities: [...capabilities],
    permissionEpoch: "new-knowledge-source-r1", organizations: [], availableApplications: [{ id: "knowledge", href: paths.home }] };
  const serve = async route => {
    const request = route.request(), url = new URL(request.url());
    let decodedPath;
    try { decodedPath = decodeURIComponent(url.pathname); }
    catch {
      log.deniedTransport.push({ method: request.method(), path: url.pathname, reason: "invalid path encoding" });
      return route.abort("blockedbyclient");
    }
    const apiRequest = /^\/api(?:\/|$)/i.test(decodedPath);
    const documentRequest = request.resourceType() === "document";
    const input = { method: request.method(), url: url.href, resourceType: request.resourceType(), postData: request.postData() };
    const classification = classifyTestRequest(input, origin);
    // Preserve the donor's explicit telemetry suppression; these requests are
    // aborted and recorded by its unchanged guard, never fulfilled as an API.
    if (classification === "suppressed-telemetry") return route.fallback();
    // Opt in only for the separately selected manifest-delivery case. Continue
    // one exact original static response; never synthesize or fetch a copy.
    // A completed browser download, not another delivered main document, is
    // required by that case before its body can complete.
    if (manifestDelivery && decodedPath === manifestAsset.path) {
      const sequence = manifestReads + 1;
      const mainFrame = request.frame() === page.mainFrame();
      const allowedManifest = url.href === origin + manifestAsset.path
        && request.method() === "GET" && request.postData() === null
        && classification === "read" && mainFrame && sequence <= expectedManifestReads;
      if (!allowedManifest) {
        log.deniedTransport.push({ method: input.method, path: url.pathname, resourceType: input.resourceType,
          reason: "non-exact or excess manifest download request", sequence });
        return route.abort("blockedbyclient");
      }
      manifestReads = sequence;
      log.manifestRequests.push({ path: manifestAsset.path, sequence, method: input.method,
        resourceType: input.resourceType, mainFrame, isNavigationRequest: request.isNavigationRequest(),
        classification, transport: "original public response via route.continue" });
      return route.continue();
    }
    const image = focalImages.find(image => image.path === decodedPath);
    if (image && request.resourceType() === "fetch") {
      const sequence = (imageCounts.get(image.path) ?? 0) + 1;
      const allowedImage = visitsFocal && url.href === `${origin}${image.path}` && request.method() === "GET"
        && classification === "read" && request.frame() === page.mainFrame()
        && !request.isNavigationRequest() && sequence <= expectedImageReads[image.path];
      if (!allowedImage) {
        log.deniedTransport.push({ method: input.method, path: url.pathname, resourceType: input.resourceType,
          reason: "undeclared, non-exact or excess public image fetch", sequence });
        return route.abort("blockedbyclient");
      }
      imageCounts.set(image.path, sequence);
      log.imageRequests.push({ path: image.path, sequence, method: input.method, resourceType: input.resourceType,
        mainFrame: true, classification, transport: "original public static response via route.continue" });
      const observedResponse = page.waitForResponse(response => response.request() === request, { timeout: 10_000 });
      void observedResponse.catch(() => {});
      await route.continue();
      const response = await observedResponse;
      const bytes = await response.body();
      const observed = { path: image.path, sequence, status: response.status(), contentType: response.headers()["content-type"],
        bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      log.imageResponses.push(observed);
      expect(observed.status).toBe(200);
      expect(observed.contentType).toMatch(/^image\/png(?:;|$)/i);
      expect(observed.bytes).toBe(image.bytes);
      expect(observed.sha256).toBe(image.sha256);
      return;
    }
    // Keep all static/browser/font traffic on the unchanged strict guards.
    // Claim every API/document so the Creative donor's allowlist cannot serve
    // an undeclared Knowledge API or an extra main-document departure.
    if (!apiRequest && !documentRequest) return route.fallback();
    const sessionRead = url.pathname === "/api/session" && ["", "?audience=knowledge"].includes(url.search);
    const allowed = url.origin === origin && !url.username && !url.password && !url.hash && request.method() === "GET"
      && classification === "read" && request.frame() === page.mainFrame()
      && (documentRequest ? url.pathname === initialPath && !url.search && request.isNavigationRequest() : sessionRead);
    if (!allowed) {
      log.deniedTransport.push({ method: input.method, path: url.pathname, resourceType: input.resourceType });
      return route.abort("blockedbyclient");
    }
    if (documentRequest) {
      if (log.documents.length !== 0) {
        log.deniedTransport.push({ method: input.method, path: url.pathname, reason: "unexpected second document navigation" });
        return route.abort("blockedbyclient");
      }
      log.documents.push({ method: input.method, path: url.pathname, mainFrame: true, classification: "read" });
      return route.continue();
    }
    const sequence = (counts.get(url.pathname) ?? 0) + 1;
    if (sequence > (expectedReads[url.pathname] ?? 0)) {
      log.deniedTransport.push({ method: input.method, path: url.pathname, reason: "undeclared or excess read", sequence });
      return route.abort("blockedbyclient");
    }
    counts.set(url.pathname, sequence);
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "private, no-store",
      "x-forma-knowledge-synthetic": "return-path-source-r1" }, body: JSON.stringify(session) });
    log.responses.push({ path: url.pathname, sequence, status: 200 });
  };
  const handler = route => {
    const task = serve(route);
    pendingHandlers.add(task);
    void task.then(() => pendingHandlers.delete(task), error => {
      pendingHandlers.delete(task);
      log.handlerErrors.push({ name: error?.name ?? "Error", message: String(error?.message ?? error) });
    });
    return task;
  };
  await context.route("**/*", handler);
  const onPageError = error => log.pageErrors.push({ name: error.name, message: error.message });
  page.on("pageerror", onPageError);
  let completed = false;
  try {
    await body({ session, initialPath });
    expect(log.deniedTransport).toEqual([]);
    expect(log.documents).toHaveLength(1);
    expect(Object.fromEntries(counts), "One exact session read, without retry or unrelated APIs").toEqual(expectedReads);
    completed = true;
  } finally {
    try {
      await context.unroute("**/*", handler);
      await Promise.allSettled([...pendingHandlers]);
      log.observedReads = Object.fromEntries(counts);
      log.observedImageReads = Object.fromEntries(imageCounts);
      log.observedManifestReads = manifestReads;
      log.pendingHandlersAtAttachment = pendingHandlers.size;
      await attach(testInfo, "knowledge-transport", log);
      if (completed) {
        expect(log.deniedTransport).toEqual([]);
        expect(log.observedReads).toEqual(expectedReads);
        expect(log.documents).toHaveLength(1);
        expect(log.responses).toHaveLength(1);
        expect(log.observedImageReads).toEqual(expectedImageReads);
        expect(log.imageResponses).toHaveLength(visitsFocal ? 6 : 0);
        expect(log.observedManifestReads).toBe(expectedManifestReads);
        expect(log.manifestRequests).toHaveLength(expectedManifestReads);
        expect(log.handlerErrors).toEqual([]);
        expect(log.pageErrors).toEqual([]);
        expect(pendingHandlers.size).toBe(0);
      }
    } finally {
      page.off("pageerror", onPageError);
    }
  }
}

async function openKnowledge(page, context, geometry, transport, testInfo) {
  const origin = new URL(testInfo.project.use.baseURL).origin;
  const sessionObserved = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === "/api/session" && ["", "?audience=knowledge"].includes(url.search)
      && response.request().method() === "GET" && response.request().frame() === page.mainFrame();
  });
  void sessionObserved.catch(() => {});
  const document = await page.goto(transport.initialPath, { waitUntil: "domcontentloaded" });
  expect(document?.ok()).toBe(true);
  expect(document.request().frame()).toBe(page.mainFrame());
  expect(document.request().isNavigationRequest()).toBe(true);
  expect(new URL(document.url()).pathname).toBe(transport.initialPath);
  expect(await document.text()).not.toMatch(/id=["']forma-session-bootstrap["']/);
  const reply = await sessionObserved;
  expect(reply.status()).toBe(200);
  expect(reply.headers()["x-forma-knowledge-synthetic"]).toBe("return-path-source-r1");
  expect(await reply.json()).toEqual(transport.session);
  await expect(main(page)).toHaveAttribute("aria-busy", "false");
  await expect(knowledge(page)).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => ({ loaded: [...document.fonts].some(face => face.family.replaceAll('"', "") === "Manrope" && face.status === "loaded"),
    selected: getComputedStyle(document.body).fontFamily.split(",")[0] }))).toEqual({ loaded: true, selected: "Manrope" });
  await applyBrowserZoom(page, context, geometry.zoom, testInfo);
  expect(await browserMetrics(page)).toMatchObject({ width: 1280, height: 900, visualScale: 1 });
  await attach(testInfo, "knowledge-initial-session", { documentPath: new URL(document.url()).pathname, documentStatus: document.status(),
    actualSessionPath: new URL(reply.url()).pathname + new URL(reply.url()).search, sessionStatus: reply.status(), mainFrameRequestBound: true,
    bootstrapPresent: false, authenticatedUserPresent: false, synthetic: true, audience: "knowledge", capabilities: transport.session.capabilities });
}

async function activate(page, locator, testInfo, stage, key = "Tab") {
  await tabTo(page, locator, 80, key);
  await verifyFocus(page, locator, testInfo, `${stage}-focus`);
  await page.keyboard.press("Enter");
}
async function reached(page, path, activeTask, heading, testInfo, stage) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  await expect(main(page)).toHaveAttribute("aria-busy", "false");
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveAttribute("href", activeTask);
  await expect(knowledge(page).getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  // Scope the shell's route failure separately from live catalog previews.
  await expect(main(page).locator(':scope > [role="alert"]')).toHaveCount(0);
  await captureViewport(page, testInfo, stage);
}
async function go(page, task, testInfo, stage) {
  // The persistent task navigation precedes main; reverse native traversal
  // avoids walking every unrelated component demo to return from a leaf.
  await activate(page, nav(page).locator(`a[href="${task}"]`), testInfo, stage, "Shift+Tab");
}

async function focalCalculationsReached(page) {
  // Both real samplers must finish before departure; no synthetic image or
  // focal result is supplied, and no sampling/crop/verdict action is invoked.
  await expect(focal(page).locator(".focal-lab-asset")).toHaveCount(3);
  await expect(focal(page).locator(".focal-lab-result")).toHaveCount(6);
}

test("Knowledge component permalink preserves native focus and returns through Components to Guidance", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withKnowledge({ page, context, baseURL }, testInfo, allCaps, paths.home, false, async transport => {
    await openKnowledge(page, context, geometry, transport, testInfo);
    await reached(page, paths.components, paths.components, "Components and foundations", testInfo, "knowledge-components");
    const search = catalog(page).locator('.component-library-search input[type="search"]');
    await tabTo(page, search);
    await verifyFocus(page, search, testInfo, "knowledge-component-search-focus");
    await page.keyboard.type("forma-ui-button");
    await expect(catalog(page).locator("article.component-reference-card")).toHaveCount(1);
    const card = catalog(page).locator("article#forma-ui-button");
    await expect(card.getByRole("heading", { name: "Button", exact: true })).toBeVisible();
    await activate(page, card.locator('a.component-permalink[href="#forma-ui-button"]'), testInfo, "knowledge-button-permalink");
    await expect.poll(() => new URL(page.url()).hash).toBe("#forma-ui-button");
    // A large reference article is a focus destination, not a 44px control.
    // Prove native ownership here; strict ring geometry belongs to its link.
    await expect(card).toBeFocused();
    await captureViewport(page, testInfo, "knowledge-button-fragment");
    await go(page, paths.patterns, testInfo, "knowledge-component-to-patterns");
    await reached(page, paths.patterns, paths.patterns, "Audience and navigation patterns", testInfo, "knowledge-patterns-after-component");
    await go(page, paths.components, testInfo, "knowledge-return-components");
    await reached(page, paths.components, paths.components, "Components and foundations", testInfo, "knowledge-returned-components");
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    await expect(catalog(page).locator('.component-library-search input[type="search"]')).toHaveValue("");
    await go(page, paths.guidance, testInfo, "knowledge-components-to-guidance");
    await reached(page, paths.guidance, paths.guidance, "Design and accessibility guidance", testInfo, "knowledge-guidance-after-return");
  });
});

test("Knowledge trailing-slash Focal leaf keeps control geometry and returns to Patterns then Landing catalog", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withKnowledge({ page, context, baseURL }, testInfo, allCaps, paths.focalSlash, true, async transport => {
    await openKnowledge(page, context, geometry, transport, testInfo);
    await reached(page, paths.focalSlash, paths.patterns, "Focal-point comparison", testInfo, "knowledge-focal-trailing-slash");
    await expect(page).toHaveTitle("Focal-point comparison — Design & Knowledge — Forma");
    await focalCalculationsReached(page);
    const shapes = focal(page).getByRole("group", { name: "Crop shape", exact: true }).getByRole("button");
    await expect(shapes).toHaveText(["wide", "square", "portrait"]);
    const observed = await shapes.evaluateAll(elements => elements.map(element => ({
      tag: element.localName, connected: element.isConnected, disabled: element.disabled,
      text: element.textContent, bounds: element.getBoundingClientRect().toJSON(),
    })));
    await attach(testInfo, "knowledge-focal-native-controls", observed);
    expect(observed).toHaveLength(3);
    for (const control of observed) {
      expect(control).toMatchObject({ tag: "button", connected: true, disabled: false });
      expect(control.bounds.width).toBeGreaterThanOrEqual(44);
      expect(control.bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(Math.max(...observed.map(item => item.bounds.height)) - Math.min(...observed.map(item => item.bounds.height)),
      "Comparable native crop controls retain equal heights; label widths need not match").toBeLessThanOrEqual(1);
    const gutter = await focal(page).locator("section.focal-point-lab").evaluate(element => {
      const owner = element.getBoundingClientRect(), headerElement = element.querySelector(":scope > header");
      const header = headerElement.getBoundingClientRect(), style = getComputedStyle(headerElement);
      const controls = element.querySelector(":scope > .focal-lab-controls").getBoundingClientRect();
      const headerContent = { left: header.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: header.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) };
      return { owner: owner.toJSON(), header: header.toJSON(), controls: controls.toJSON(),
        headerContent, copy: headerElement.querySelector(".page-header-copy").getBoundingClientRect().toJSON(),
        actions: headerElement.querySelector(".page-header-actions").getBoundingClientRect().toJSON(),
        left: controls.left - owner.left, right: owner.right - controls.right };
    });
    await attach(testInfo, "knowledge-focal-observed-gutters", gutter);
    expect(gutter.left).toBeGreaterThan(0); expect(gutter.right).toBeGreaterThan(0);
    expect(Math.abs(gutter.left - gutter.right)).toBeLessThanOrEqual(1);
    // The hero background intentionally bleeds to the viewport. Its content
    // edges and actual children must align with the page's inset control strip.
    expect(Math.abs(gutter.headerContent.left - gutter.controls.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(gutter.headerContent.right - gutter.controls.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(gutter.copy.left - gutter.headerContent.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(gutter.actions.right - gutter.headerContent.right)).toBeLessThanOrEqual(1);
    for (let index = 0; index < 3; index++) {
      await tabTo(page, shapes.nth(index));
      await verifyFocus(page, shapes.nth(index), testInfo, `knowledge-crop-${index}-focus`);
    }
    await activate(page, focal(page).getByRole("link", { name: "Return to patterns", exact: true }), testInfo, "knowledge-focal-return", "Shift+Tab");
    await reached(page, paths.patterns, paths.patterns, "Audience and navigation patterns", testInfo, "knowledge-returned-patterns");
    await expect(focal(page)).toHaveCount(0);
    await go(page, paths.landing, testInfo, "knowledge-patterns-to-landing");
    await reached(page, paths.landing, paths.landing, "Landing page catalog", testInfo, "knowledge-landing-after-focal");
    await expect(knowledge(page).locator(".knowledge-landing-pages__card")).toHaveCount(4);
  });
});

test("Knowledge docs-only grant lands on Patterns and keeps only granted return destinations", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withKnowledge({ page, context, baseURL }, testInfo, ["design.docs.read"], paths.home, false, async transport => {
    await openKnowledge(page, context, geometry, transport, testInfo);
    await reached(page, paths.patterns, paths.patterns, "Audience and navigation patterns", testInfo, "knowledge-docs-patterns");
    await expect(nav(page).locator("a")).toHaveText(["Patterns", "Guidance", "Landing page catalog"]);
    await expect(catalog(page)).toHaveCount(0);
    await expect(knowledge(page).locator(`a[href="${paths.focal}"]`)).toHaveCount(0);
    await go(page, paths.guidance, testInfo, "knowledge-docs-guidance");
    await reached(page, paths.guidance, paths.guidance, "Design and accessibility guidance", testInfo, "knowledge-docs-guidance-reached");
    await go(page, paths.patterns, testInfo, "knowledge-docs-return-patterns");
    await reached(page, paths.patterns, paths.patterns, "Audience and navigation patterns", testInfo, "knowledge-docs-patterns-returned");
    await expect(knowledge(page).locator(`a[href="${paths.focal}"]`)).toHaveCount(0);
    await go(page, paths.landing, testInfo, "knowledge-docs-landing");
    await reached(page, paths.landing, paths.landing, "Landing page catalog", testInfo, "knowledge-docs-landing-reached");
    await expect(knowledge(page).locator(".knowledge-landing-pages__card")).toHaveCount(4);
    const locale = knowledge(page).locator('.knowledge-landing-pages__locales a[lang="en"]').first();
    await tabTo(page, locale);
    await verifyFocus(page, locale, testInfo, "knowledge-landing-locale-focus");
    // Its marketing destination is outside this slice: focus is observed,
    // never a new-tab or cross-application transport bypass.
  });
});

test("Knowledge catalog-only grant opens the normal Focal leaf and returns without Guidance", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withKnowledge({ page, context, baseURL }, testInfo, ["design.catalog.read"], paths.patterns, true, async transport => {
    await openKnowledge(page, context, geometry, transport, testInfo);
    await reached(page, paths.patterns, paths.patterns, "Audience and navigation patterns", testInfo, "knowledge-catalog-patterns");
    await expect(nav(page).locator("a")).toHaveText(["Components", "Patterns", "Landing page catalog"]);
    await activate(page, knowledge(page).getByRole("link", { name: "Compare focal-point treatments", exact: true }), testInfo, "knowledge-open-focal");
    await reached(page, paths.focal, paths.patterns, "Focal-point comparison", testInfo, "knowledge-normal-focal");
    await focalCalculationsReached(page);
    await activate(page, focal(page).getByRole("link", { name: "Return to patterns", exact: true }), testInfo, "knowledge-catalog-focal-return");
    await reached(page, paths.patterns, paths.patterns, "Audience and navigation patterns", testInfo, "knowledge-catalog-patterns-returned");
    await go(page, paths.components, testInfo, "knowledge-catalog-components");
    await reached(page, paths.components, paths.components, "Components and foundations", testInfo, "knowledge-catalog-components-reached");
    await expect(nav(page).locator(`a[href="${paths.guidance}"]`)).toHaveCount(0);
    await expect(catalog(page)).toHaveCount(1);
  });
});

/**
 * One additive recovery case. The complete four-case R2 donor above is retained
 * as source history; the detached recovery config selects only this title.
 * Its inherited provenance describes that donor family. This case records its
 * narrower selection explicitly and never visits Focal or requests an image.
 */
test("Knowledge catalogue recovery restores filters and finds the intended component", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withKnowledge({ page, context, baseURL }, testInfo, allCaps, paths.home, false, async transport => {
    await openKnowledge(page, context, geometry, transport, testInfo);
    await reached(page, paths.components, paths.components, "Components and foundations", testInfo, "knowledge-recovery-initial");
    const owner = catalog(page);
    await expect(owner).toHaveCount(1);
    const search = owner.locator('.component-library-search input[type="search"]');
    const cards = owner.locator("article.component-reference-card");
    const levelButtons = owner.locator(".component-level-filters button");
    await expect(search).toHaveValue("");
    await expect.poll(() => cards.count()).toBeGreaterThan(1);
    await expect(owner.locator("article#forma-ui-button")).toHaveCount(1);
    await expect.poll(() => levelButtons.count()).toBeGreaterThan(1);
    const initialCards = await cards.evaluateAll(elements => elements.map(element => ({
      id: element.id, title: element.querySelector("h3")?.textContent,
    })));
    expect(initialCards.every(card => Boolean(card.id) && Boolean(card.title))).toBe(true);
    expect(new Set(initialCards.map(card => card.id)).size).toBe(initialCards.length);
    const initialLevels = await levelButtons.evaluateAll(elements => elements.map(element => ({
      label: element.textContent, pressed: element.getAttribute("aria-pressed"),
    })));
    expect(initialLevels.filter(level => level.pressed === "true")).toHaveLength(1);
    expect(initialLevels[0].pressed).toBe("true");
    expect(initialLevels[1].pressed).toBe("false");
    const initialURL = page.url();
    const catalogueOwner = await owner.elementHandle();
    expect(catalogueOwner).not.toBeNull();
    try {
      // Select the first existing non-All level without inventing a new label,
      // value, component inventory or product filter.
      const alternateLevel = levelButtons.nth(1);
      await activate(page, alternateLevel, testInfo, "knowledge-recovery-level");
      await expect(alternateLevel).toHaveAttribute("aria-pressed", "true");
      await expect(levelButtons.first()).toHaveAttribute("aria-pressed", "false");
      await tabTo(page, search, 80, "Shift+Tab");
      await verifyFocus(page, search, testInfo, "knowledge-recovery-query-focus");
      const unmatchedQuery = "__forma_no_matching_component_7e83__";
      await page.keyboard.type(unmatchedQuery);
      await expect(search).toHaveValue(unmatchedQuery);
      await expect(cards).toHaveCount(0);
      const empty = owner.locator(".component-no-results");
      await expect(empty).toHaveCount(1);
      await expect(empty.getByRole("heading", { name: "No matching components", exact: true })).toBeVisible();
      await expect(empty.locator("p")).toHaveText("Try a different name, purpose, or atomic level.");
      await expect(owner.locator(".component-results-count")).toContainText(unmatchedQuery);
      const emptyCopy = await empty.textContent();
      await captureViewport(page, testInfo, "knowledge-recovery-empty");

      const showEveryComponent = empty.getByRole("button", { name: "Show every component", exact: true });
      await activate(page, showEveryComponent, testInfo, "knowledge-recovery-show-all");
      // Observe the product's own focus handoff before any other action.
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await expect(empty).toHaveCount(0);
      await expect.poll(() => levelButtons.evaluateAll(elements => elements.map(element => ({
        label: element.textContent, pressed: element.getAttribute("aria-pressed"),
      })))).toEqual(initialLevels);
      await expect.poll(() => cards.evaluateAll(elements => elements.map(element => ({
        id: element.id, title: element.querySelector("h3")?.textContent,
      })))).toEqual(initialCards);
      await expect(owner.locator(".component-interaction-status")).toHaveText("Showing every available component.");
      await expect(owner.locator(".component-results-count")).not.toContainText(unmatchedQuery);
      await verifyFocus(page, search, testInfo, "knowledge-recovery-restored-search-focus");
      const restoredCards = await cards.evaluateAll(elements => elements.map(element => ({
        id: element.id, title: element.querySelector("h3")?.textContent,
      })));
      await captureViewport(page, testInfo, "knowledge-recovery-restored");

      // The business finish for this slice is finding the intended reference;
      // opening API details, clipboard and downloads are separate obligations.
      await page.keyboard.type("forma-ui-button");
      await expect(search).toHaveValue("forma-ui-button");
      await expect(cards).toHaveCount(1);
      const button = owner.locator("article#forma-ui-button");
      await expect(button).toHaveCount(1);
      await expect(button.getByRole("heading", { name: "Button", exact: true })).toBeVisible();
      await expect(button.locator(".component-tag > code")).toHaveText("<forma-ui-button>");
      const found = await button.evaluate(element => ({
        id: element.id, title: element.querySelector("h3")?.textContent,
        tag: element.querySelector(".component-tag > code")?.textContent,
      }));
      expect({ id: found.id, title: found.title }).toEqual(initialCards.find(card => card.id === "forma-ui-button"));
      await expect(search).toBeFocused();
      await verifyFocus(page, search, testInfo, "knowledge-recovery-found-search-focus");
      await expect.poll(() => page.url()).toBe(initialURL);
      await expect(knowledge(page)).toHaveCount(1);
      await expect(owner).toHaveCount(1);
      expect(await owner.evaluate((element, retained) => element.isConnected && element === retained, catalogueOwner)).toBe(true);
      await expect(main(page)).toHaveAttribute("aria-busy", "false");
      await expect(nav(page).locator('a[aria-current="page"]')).toHaveAttribute("href", paths.components);
      await expect(main(page).locator(':scope > [role="alert"]')).toHaveCount(0);
      await attach(testInfo, "knowledge-search-recovery", {
        selection: { selectedCases: 1, priorCasesSelected: 0, profile: "English desktop 1280x900 at zoom1" },
        initialURL, finalURL: page.url(), initialLevels, selectedLevel: initialLevels[1].label,
        unmatchedQuery, emptyCopy, initialCards, restoredCards, found,
        finalQuery: await search.inputValue(), sameCatalogueOwner: true,
        limits: "Synthetic read-only session; reference discovery only, no clipboard, download, project write or backend authorization claim",
      });
      await captureViewport(page, testInfo, "knowledge-recovery-found");
    } finally {
      await catalogueOwner?.dispose();
    }
  });
});

/**
 * One separate delivery case. The four original R2 test bodies above remain
 * unchanged and unselected. Search recovery lives in its own frozen source.
 * The native download/file below is new evidence, never an href-only pass.
 */
test("Knowledge component manifest download yields the admitted JSON file", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withKnowledge({ page, context, baseURL }, testInfo, allCaps, paths.home, false, async transport => {
    await openKnowledge(page, context, geometry, transport, testInfo);
    await reached(page, paths.components, paths.components, "Components and foundations", testInfo, "knowledge-manifest-initial");
    const owner = catalog(page);
    await expect(owner).toHaveCount(1);
    const retainedOwner = await owner.elementHandle();
    expect(retainedOwner).not.toBeNull();
    try {
      const initialURL = page.url();
      const origin = new URL(initialURL).origin;
      const link = owner.getByRole("link", { name: "Download component manifest (JSON)", exact: true });
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute("href", manifestAsset.path);
      await expect(link).toHaveAttribute("download", manifestAsset.filename);
      await tabTo(page, link, 80);
      await verifyFocus(page, link, testInfo, "knowledge-manifest-download-focus");

      // Arm the real browser event only after reaching the native invoker.
      const pendingDownload = page.waitForEvent("download", { timeout: 10_000 });
      void pendingDownload.catch(() => {});
      await page.keyboard.press("Enter");
      const download = await pendingDownload;
      expect(download.url()).toBe(origin + manifestAsset.path);
      expect(download.suggestedFilename()).toBe(manifestAsset.filename);
      const failure = await download.failure();
      expect(failure, "The browser must complete its original download").toBeNull();

      const artifactPath = testInfo.outputPath(manifestAsset.filename);
      await expect(lstat(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
      await download.saveAs(artifactPath);
      // Keep the saved artifact on any failure, but admit its identity and size
      // before opening, reading or attaching bytes from it.
      const metadataBefore = await lstat(artifactPath, { bigint: true });
      expect(metadataBefore.isFile()).toBe(true);
      expect(metadataBefore.isSymbolicLink()).toBe(false);
      expect(metadataBefore.nlink).toBe(1n);
      expect(metadataBefore.size).toBe(BigInt(manifestAsset.bytes));
      const identityFields = ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"];
      const admittedIdentity = identityFields.map(field => metadataBefore[field]);
      const readLimit = manifestAsset.bytes + 1;
      const bounded = Buffer.alloc(readLimit);
      let bytesRead = 0;
      // NOFOLLOW rejects a replaced symlink; NONBLOCK prevents a replaced
      // special file from blocking open before the handle's regular-file check.
      const handle = await open(artifactPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
      try {
        const openedBefore = await handle.stat({ bigint: true });
        expect(openedBefore.isFile()).toBe(true);
        expect(openedBefore.nlink).toBe(1n);
        expect(identityFields.map(field => openedBefore[field])).toEqual(admittedIdentity);
        while (bytesRead < readLimit) {
          const read = await handle.read(bounded, bytesRead, readLimit - bytesRead, bytesRead);
          if (read.bytesRead === 0) break;
          bytesRead += read.bytesRead;
        }
        const openedAfter = await handle.stat({ bigint: true });
        expect(openedAfter.isFile()).toBe(true);
        expect(identityFields.map(field => openedAfter[field])).toEqual(admittedIdentity);
      } finally {
        await handle.close();
      }
      const metadataAfter = await lstat(artifactPath, { bigint: true });
      expect(metadataAfter.isFile()).toBe(true);
      expect(metadataAfter.isSymbolicLink()).toBe(false);
      expect(identityFields.map(field => metadataAfter[field])).toEqual(admittedIdentity);
      expect(metadataAfter.size).toBe(BigInt(manifestAsset.bytes));
      expect(bytesRead).toBe(manifestAsset.bytes);
      const bytes = bounded.subarray(0, bytesRead);
      expect(bytes.length).toBe(manifestAsset.bytes);
      // Attach the admitted bounded buffer, never cause another path-based read.
      await testInfo.attach("knowledge-delivered-component-manifest", { body: bytes, contentType: "application/json" });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(sha256).toBe(manifestAsset.sha256);

      // Parse data only: never load or execute a downloaded module. This is
      // the catalogue's actual modules/declarations/tagName consumer shape.
      const manifest = JSON.parse(bytes.toString("utf8"));
      expect(Array.isArray(manifest.modules)).toBe(true);
      expect(manifest.modules).toHaveLength(manifestAsset.moduleCount);
      for (const module of manifest.modules) {
        if (module.declarations !== undefined) expect(Array.isArray(module.declarations)).toBe(true);
      }
      const tags = manifest.modules.flatMap(module => module.declarations ?? [])
        .filter(declaration => declaration.tagName).map(declaration => declaration.tagName).sort();
      expect(tags).toEqual(manifestAsset.tagNames);
      expect(new Set(tags).size).toBe(manifestAsset.tagNames.length);
      expect(tags).toContain("forma-ui-button");

      await expect.poll(() => page.url()).toBe(initialURL);
      await expect(knowledge(page)).toHaveCount(1);
      await expect(owner).toHaveCount(1);
      expect(await owner.evaluate((element, retained) => element.isConnected && element === retained, retainedOwner)).toBe(true);
      await expect(main(page)).toHaveAttribute("aria-busy", "false");
      await expect(nav(page).locator('a[aria-current="page"]')).toHaveAttribute("href", paths.components);
      await expect(main(page).locator(':scope > [role="alert"]')).toHaveCount(0);
      await expect(link).toBeFocused();
      await verifyFocus(page, link, testInfo, "knowledge-manifest-return-focus");

      await attach(testInfo, "knowledge-manifest-delivery", {
        selection: { selectedCases: 1, priorCasesSelected: 0, searchRecoverySelected: false,
          profile: "English desktop 1280x900 at zoom1" },
        expected: { savedSource: manifestAsset.savedSource, servedSource: manifestAsset.servedSource,
          filename: manifestAsset.filename, bytes: manifestAsset.bytes, sha256: manifestAsset.sha256 },
        actual: { url: download.url(), suggestedFilename: download.suggestedFilename(), failure,
          savedPath: artifactPath, bytes: bytes.length, sha256, moduleCount: manifest.modules.length,
          tagCount: tags.length, tagNames: tags, parseSucceeded: true },
        initialURL, finalURL: page.url(), sameCatalogueOwner: true,
        limits: "Original static developer JSON delivery only; no imported code, clipboard, project write, live authorization, review/export or full-F claim",
      });
      await captureViewport(page, testInfo, "knowledge-manifest-delivered");
    } finally {
      await retainedOwner?.dispose();
    }
  }, true);
});
