/** F exact-resource guest browser regression. Reuses the accepted B1 guest
 * read-truth and Skip host contracts, then checks native DOM/focus behavior.
 * The document and guest response are synthetic; no token, permission or
 * server is created. Test execution does not establish live guest authority.
 */
import { createHash } from "node:crypto";
import { test, expect, captureViewport } from
  "./fixtures.mjs";
import { tabTo, verifyFocus } from
  "./helpers/keyboard-journey.mjs";
import { classifyTestRequest, localTestOrigin } from
  "./helpers/read-only-network.mjs";
import { syntheticNetworkEnabled } from
  "./helpers/synthetic-network.mjs";

const token = "f-guest-retry-skip-synthetic-r1";
const documentPath = `/share/${token}`;
const apiPath = `/api/shared/${token}`;
const documentTitle = "Synthetic guest recovery document";
const projectName = "Synthetic exact-resource guest project";
const direction = "  Keep this exact direction: café, 雨, and 🌱.  ";
const markdown = "# The Signal Garden\n\nMara saved the last signal before dawn.\n\n“Keep the gate open,” she wrote — café, 雨, and 🌱 intact.\n\nThe garden answered.\n";
const markdownSha256 = "33e0cda6f9ee579ee130bd446e1382c47a8793b3611b1160067644254a85b4b0";
const hash = value => createHash("sha256").update(value).digest("hex");
const provenance = Object.freeze({
  mode: "declared-synthetic-exact-resource-guest",
  authority: "Finite browser responses only; no real token, authentication, authorization, account, provider or production evidence",
  source: "The accepted Story file's exact 153-byte text is reused under separately declared guest document/artifact identities",
  application: "Delivered index.html → main.ts → public-share entry → SharedView; no Store, component, fetch, focus or route injection",
  scope: "One EN desktop guest 503 → Retry → pending Skip → exact recovered projection; no token rotation, expired/revoked, physical AT or whole-F claim",
});
const projection = {
  projectName, documentTitle,
  blocks: [{ id: "guest-retry-direction", type: "direction", handle: "direction/guest-retry",
    properties: { label: "Retained guest direction", text: direction } }],
  outputs: [],
  artifacts: [{ id: "guest-retry-story", documentId: "guest-retry-document", kind: "short_story",
    title: "Synthetic retained Story", titleSource: "authored", summary: "Declared exact guest copy",
    contentRef: null, contentMarkdown: markdown, contentAvailable: true,
    itemCount: 1, mediaUrl: null, mediaType: null, provider: "synthetic", modelId: "synthetic",
    latency: 0, sequence: 1, library: false, sourceEventId: "guest-retry-source", sourceSurface: null,
    settings: {}, presentation: null,
    items: [{ id: "guest-retry-part", title: "The Signal Garden", body: markdown, notes: "",
      imagePrompt: "", mediaUrl: null, mediaType: null, width: null, height: null, focalPoint: null, slide: null }] }],
};
const reply = { projection, share: { expiresAt: "2026-12-31T23:59:59.000Z" } };
test.use({ geometry: { viewport: { width: 1280, height: 900 }, zoom: 1, locale: "en-US" } });

async function attach(info, name, observation) {
  await info.attach(name, { body: JSON.stringify({ provenance, observation }, null, 2), contentType: "application/json" });
}

async function withGuest({ page, context, baseURL }, info, body) {
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  const origin = localTestOrigin(baseURL);
  const log = { documents: [], reads: [], denied: [], pageErrors: [], handlerErrors: [], downloads: [],
    recoveryReleased: false, cleanupAbort: false, pendingAtClose: null };
  let requestArrived = false, releaseRecovery;
  const recoveryGate = new Promise(resolve => { releaseRecovery = resolve; });
  const pending = new Set();
  const pageError = error => log.pageErrors.push({ name: error.name, message: error.message });
  const download = item => log.downloads.push({ suggestedFilename: item.suggestedFilename() });
  page.on("pageerror", pageError); page.on("download", download);
  const serve = async route => {
    const request = route.request(), url = new URL(request.url());
    const api = /^\/api(?:\/|$)/u.test(url.pathname);
    const document = request.resourceType() === "document";
    if (!api && !document) return route.fallback();
    const input = { method: request.method(), url: request.url(), postData: request.postData(), resourceType: request.resourceType() };
    const allowed = url.origin === origin && request.method() === "GET" && !url.search
      && request.frame() === page.mainFrame() && classifyTestRequest(input, origin) === "read"
      && (document ? url.pathname === documentPath && request.isNavigationRequest() : url.pathname === apiPath);
    if (!allowed || document && log.documents.length || api && log.reads.length >= 2) {
      log.denied.push({ method: request.method(), path: url.pathname, type: request.resourceType(), reason: "outside exact document/two-GET guest contract" });
      return route.abort("blockedbyclient");
    }
    if (document) {
      log.documents.push({ path: url.pathname, mainFrame: true, classification: "read" });
      return route.continue();
    }
    const row = { path: url.pathname, sequence: log.reads.length + 1, method: "GET", completed: false, status: null };
    log.reads.push(row);
    if (row.sequence === 2) {
      requestArrived = true;
      await recoveryGate;
      if (log.cleanupAbort) { await route.abort("aborted"); return; }
    }
    row.status = row.sequence === 1 ? 503 : 200;
    await route.fulfill({ status: row.status, contentType: "application/json",
      headers: { "cache-control": "private, no-store", "x-forma-guest-synthetic": "retry-skip-r1" },
      body: JSON.stringify(row.sequence === 1 ? { error: "temporary_fixture_failure" } : reply) });
    row.completed = true;
  };
  const handler = route => {
    const task = serve(route); pending.add(task);
    void task.then(() => pending.delete(task), error => {
      pending.delete(task); log.handlerErrors.push({ name: error?.name ?? "Error", message: String(error?.message ?? error) });
    });
    return task;
  };
  const verify = () => {
    expect(log.documents).toEqual([{ path: documentPath, mainFrame: true, classification: "read" }]);
    expect(log.reads).toEqual([1, 2].map(sequence => ({ path: apiPath, sequence, method: "GET", completed: true, status: sequence === 1 ? 503 : 200 })));
    expect(log.recoveryReleased).toBe(true);
    expect(log.cleanupAbort).toBe(false);
    expect(log.denied).toEqual([]); expect(log.pageErrors).toEqual([]);
    expect(log.handlerErrors).toEqual([]); expect(log.downloads).toEqual([]);
    expect(pending.size).toBe(0);
  };
  await context.route("**/*", handler);
  let complete = false;
  try {
    await body({ log, waitRecovery: () => expect.poll(() => requestArrived).toBe(true),
      releaseRecovery() { expect(requestArrived).toBe(true); expect(log.recoveryReleased).toBe(false); log.recoveryReleased = true; releaseRecovery(); } });
    await expect.poll(() => pending.size).toBe(0);
    verify(); complete = true;
  } finally {
    await context.unroute("**/*", handler);
    if (!log.recoveryReleased) { log.cleanupAbort = true; releaseRecovery(); }
    await Promise.allSettled([...pending]);
    log.pendingAtClose = pending.size;
    await attach(info, "guest-retry-skip-transport", log);
    page.off("pageerror", pageError); page.off("download", download);
    if (complete) verify();
  }
}

test("Guest recovery: native Retry and Skip retain the exact resource and current main focus", async ({ page, context, baseURL }, info) => {
  expect(Buffer.byteLength(markdown, "utf8")).toBe(153);
  expect(hash(markdown)).toBe(markdownSha256);
  await withGuest({ page, context, baseURL }, info, async transport => {
    const response = await page.goto(documentPath, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    const parent = page.locator("forma-public-share"), owner = parent.locator("forma-shared-view");
    const main = owner.locator("main#main-content");
    await expect(parent).toHaveCount(1); await expect(owner).toHaveCount(1);
    await expect(page.locator("forma-shell, forma-platform-shell, forma-assistant")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", /^en(?:-|$)/u);
    await expect(main.getByRole("heading", { name: "Link unavailable", exact: true })).toBeVisible();
    await expect(main).toContainText("This shared review could not be loaded. Try again.");
    await expect(main).not.toContainText(/expired or been revoked|temporary_fixture_failure|Synthetic guest recovery document/u);
    const retry = main.getByRole("button", { name: "Retry", exact: true });
    await tabTo(page, retry, 12);
    await page.evaluate(() => document.fonts.ready);
    await verifyFocus(page, retry, info, "guest-error-retry-focus");
    expect(transport.log.reads).toHaveLength(1);
    await page.keyboard.press("Enter");
    await transport.waitRecovery();
    await expect(main.getByRole("status")).toHaveText("Opening this shared creative document…");
    await expect(retry).toHaveCount(0);
    const skip = parent.locator('a.skip-link[href="#main-content"]');
    await tabTo(page, skip, 12);
    await verifyFocus(page, skip, info, "guest-pending-skip-focus");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new URL(documentPath + "#main-content", baseURL).href);
    await expect(main).toBeFocused();
    const pendingMain = await main.elementHandle();
    expect(pendingMain).not.toBeNull();
    try {
      await captureViewport(page, info, "guest-pending-main");
      expect(transport.log.reads).toHaveLength(2);
      transport.releaseRecovery();
      await expect(main.getByRole("heading", { name: documentTitle, exact: true })).toBeVisible();
      const custody = await page.evaluate(previous => {
        const current = document.querySelector("forma-public-share > forma-shared-view > main#main-content");
        return { route: location.pathname + location.search + location.hash,
          previousConnected: previous.isConnected, sameMain: current === previous,
          activeTag: document.activeElement?.tagName ?? null, activeId: document.activeElement?.id ?? null,
          currentMainFocused: document.activeElement === current,
          currentToken: document.querySelector("forma-shared-view")?.token,
          mainCount: document.querySelectorAll("main#main-content").length,
          title: document.title };
      }, pendingMain);
      await attach(info, "guest-recovery-main-custody", custody);
      await captureViewport(page, info, "guest-recovered-main");
      expect(custody.route).toBe(documentPath + "#main-content");
      expect(custody.currentToken).toBe(token); expect(custody.mainCount).toBe(1);
      expect(custody.title).toBe(documentTitle + " — Shared review — Forma");
      // This is the missing native result, not a source-host identity promise.
      // The test must not call focus() to repair a replaced Skip destination.
      expect(custody.currentMainFocused, "The user's native Skip destination must remain focused after the same-resource recovery").toBe(true);
      await expect(main).toBeFocused();
      await expect(main.locator(".shared-hero p bdi")).toHaveText(projectName);
      expect(await main.locator(".shared-direction article > p").textContent()).toBe(direction);
      const summary = main.locator(".shared-artifact .shared-result-details > summary");
      await expect(summary).toHaveCount(1); await tabTo(page, summary, 12);
      await verifyFocus(page, summary, info, "guest-recovered-story-details-focus");
      await page.keyboard.press("Enter");
      await expect(summary.locator("..")).toHaveAttribute("open", "");
      const copy = main.locator("pre.shared-artifact-copy");
      await expect(copy).toBeVisible();
      const actual = await copy.textContent();
      expect(actual).toBe(markdown); expect(hash(actual)).toBe(markdownSha256);
      expect(Buffer.byteLength(actual, "utf8")).toBe(153);
      await attach(info, "guest-exact-copy", { artifactId: projection.artifacts[0].id,
        declaredDocumentId: projection.artifacts[0].documentId, bytes: 153, sha256: hash(actual), direction,
        delivery: "Rendered browser text only; no download, live authorization or recipient delivery" });
      await captureViewport(page, info, "guest-recovered-story-copy");
      await page.keyboard.press("Enter");
      await expect(summary.locator("..")).not.toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
      expect(transport.log.reads).toHaveLength(2);
    } finally { await pendingMain.dispose(); }
  });
});
