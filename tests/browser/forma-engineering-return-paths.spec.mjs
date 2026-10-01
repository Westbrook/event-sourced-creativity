/** NEW Engineering source, 2026-09-06. Not the missing F1 fixture or a recovery
 * of its unverified historical 136/136 claim. Future browser execution only.
 *
 * Exact current C source relation (read-only intake; SHA-256):
 * src/apps/engineering/entry.ts 739/8161a046716425a9ea511e7dd3b448b37e32a6c5c2f9baa7c98e98feb1a248ed
 * src/apps/engineering/diagnostics.ts 4755/70566032646098e61e3589ea4ef4300f9138bc2236cfacf2ef5bca05e1a6ba27
 * src/components/forma-role-dashboard.ts 6944/4b2d4652d0470a72f474296548ff62f145d27fa7d8eef7fd3ef71596ee7ffec1
 * src/platform/session-controller.ts 4191/2b6ce918cb3ff532f18176025d43edec18f4ca1eb4a3d577045645972c08c0ab
 * src/platform/applications.ts 30954/51088f2d16cef3ebd75dbea928a581867983d6ff634d7daaf9c3bb86e04a0df9
 * src/components/forma-platform-shell.ts 13811/63215d532792457366533b79a15a07092de55cacb86cdb829a1dc46d5d98b2ce
 * src/state/session-bootstrap.ts 2919/9535aa306edf0094f31962822bc5ee392035c7f1375decc1a90b903d433f8167
 * src/components/design-system/navigation.ts 19102/aea6fc28c1e4e41d1bd3836eb357dd30a7eb8f481a01d1f112a6a805995ae076
 * index.html 808/912357a164b08dd74d76010a02282b62935ead270d245b36cec181e2b7a12c40
 * src/main.ts 1078/9c3a390106464723e3c3b31f0263d5df1bb616a01171031953b961e914df5a40
 * C=/Users/westbrook/.codex/visualizations/2026/08/26/01a03eaa-d5b7-7630-943d-7105f7a3067b/forma-recovery-20260831/checkout
 * No assertion that this equals R12, a current build, or a later checkout.
 *
 * Retained fresh-profile/trace/cleanup and strict keyboard/focus helpers below
 * remain external dependencies, not copied or weakened. Canonical must bind
 * these sources and its preview before a genuine run. The existing transport
 * requires FORMA_A11Y_SYNTHETIC_NETWORK=1 and loopback :4186; this file allocates
 * no process, port, account, execution directory or provider operation.
 */
import { test, expect, browserMetrics, captureViewport, applyBrowserZoom } from
  "./fixtures.mjs";
import { tabTo, verifyFocus } from
  "./helpers/keyboard-journey.mjs";
import { classifyTestRequest, localTestOrigin } from
  "./helpers/read-only-network.mjs";
import { syntheticNetworkEnabled } from
  "./helpers/synthetic-network.mjs";

const provenance = Object.freeze({
  mode: "new-finite-engineering-synthetic-responses",
  historicalF1: "136/136 claim unverified; old source unavailable; no reuse credit",
  authority: "Declared Engineering capabilities only; no authentication or server authorization evidence",
  application: "Original delivered Engineering document and current platform components; no injected modules, Store state, bootstrap or fetch override",
  limits: "One English desktop profile; no provider, production, organization, permission enforcement, other locales, AT or full-F completion claim",
});
const paths = Object.freeze({ health: "/engineering", events: "/engineering/events", sync: "/engineering/sync", jobs: "/engineering/jobs" });
const allCaps = ["engineering.diagnostics.read", "engineering.events.read", "engineering.sync.read", "platform.identity.manage"];
const schemaPath = "/api/portfolio/engineering/schema-preflight";
const api = view => `/api/portfolio/engineering/${view}`;
const nav = page => page.locator("forma-ui-audience-navigation.platform-navigation");
const diagnostics = page => page.locator("forma-engineering-diagnostics");
const schema = page => diagnostics(page).locator('section[aria-labelledby="schema-preflight-heading"]');
const inspect = page => schema(page).getByRole("button", { name: "Inspect schema metadata", exact: true });
const refresh = page => diagnostics(page).getByRole("button", { name: "Refresh evidence", exact: true });

test.use({ geometry: { viewport: { width: 1280, height: 900 }, zoom: 1, locale: "en-US" } });

const report = (view, marker) => ({ report: {
  id: `new-engineering-${view}`, scope: "Fictional local diagnostics only", refreshedAt: "2026-09-06T12:00:00.000Z",
  synthetic: true, metrics: [], evidence: [{ id: `new-engineering-${marker}`, label: marker,
    status: "passed", detail: "Synthetic response used solely to distinguish this route and request." }],
} });
const schemaReply = marker => ({ contract: "forma.output-schema-preflight.v1", complete: true, synthetic: true, marker });

async function attach(testInfo, name, observation) {
  // Do not reuse the donor's Creative-only provenance label for a platform session.
  await testInfo.attach(name, { body: JSON.stringify({ provenance, observation }, null, 2), contentType: "application/json" });
}

/** Finite per-case response queues only. All other requests fall through to the
 * unchanged donor no-write/no-egress guard. The donor's document allowlist is
 * Creative-only, so the four exact local main-document GETs are admitted here
 * through the SAME request classifier; no API request is continued to a server.
 */
async function withEngineering({ page, context, baseURL }, testInfo, capabilities, expectedReports, body) {
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  const origin = localTestOrigin(baseURL);
  const queues = new Map(), counts = new Map(), held = new Set(), pendingHandlers = new Set();
  const expectedReads = { "/api/session": 1, ...Object.fromEntries(Object.entries(expectedReports).map(([view, count]) => [view === "schema" ? schemaPath : api(view), count])) };
  const log = { documents: [], responses: [], releaseBoundaries: [], deniedTransport: [], abortedHeld: [], handlerErrors: [], pageErrors: [], expectedReads, capabilities: [...capabilities] };
  const session = { user: { userId: "new-engineering-synthetic-principal", email: "engineering@example.invalid", displayName: "Fictional Engineering principal", role: "creator" },
    audience: "engineering", capabilities: [...capabilities], permissionEpoch: "new-engineering-source-r1",
    organizations: [], availableApplications: [{ id: "engineering", href: "/engineering" }] };
  const enqueue = (path, response, status = 200, hold = false) => {
    let resume;
    const slot = { response, status, request: null, wasHeld: hold, released: !hold, cancelled: false,
      gate: hold ? new Promise(resolve => { resume = resolve; }) : Promise.resolve(), resume: () => resume?.() };
    queues.set(path, [...(queues.get(path) ?? []), slot]);
    if (hold) held.add(slot);
    return slot;
  };
  const serve = async route => {
    const request = route.request(), url = new URL(request.url());
    const sessionRead = url.pathname === "/api/session" && ["", "?audience=engineering"].includes(url.search);
    const view = Object.keys(paths).find(item => api(item) === url.pathname);
    const ownedAPI = url.pathname.startsWith("/api/portfolio/engineering/") || sessionRead;
    const ownedDocument = request.resourceType() === "document" && Object.values(paths).includes(url.pathname);
    if (!ownedAPI && !ownedDocument) return route.fallback();
    const input = { method: request.method(), url: url.href, resourceType: request.resourceType(), postData: request.postData() };
    const allowed = url.origin === origin && request.method() === "GET"
      && classifyTestRequest(input, origin) === "read" && request.frame() === page.mainFrame()
      && (ownedDocument ? !url.search && request.isNavigationRequest() : sessionRead || !url.search && (view || url.pathname === schemaPath));
    if (!allowed) {
      log.deniedTransport.push({ method: input.method, path: url.pathname, resourceType: input.resourceType });
      return route.abort("blockedbyclient");
    }
    if (ownedDocument) {
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
    const slot = queues.get(url.pathname)?.shift();
    if (!sessionRead && !view && !slot) {
      log.deniedTransport.push({ method: input.method, path: url.pathname, reason: "unscheduled schema read" });
      return route.abort("blockedbyclient");
    }
    if (slot) { slot.request = request; await slot.gate; }
    if (slot?.cancelled) {
      await route.abort("aborted");
      slot.cleanup.abortCompleted = true;
      held.delete(slot);
      return;
    }
    const response = slot?.response ?? (sessionRead ? session : report(view, `${view}-receipt-${sequence}`));
    const status = slot?.status ?? 200;
    await route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "private, no-store", "x-forma-engineering-synthetic": "return-path-source-r1" }, body: JSON.stringify(response) });
    log.responses.push({ path: url.pathname, sequence, status, held: slot?.wasHeld ?? false, released: slot?.released ?? true });
    if (slot) held.delete(slot);
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
  const transport = {
    log, session, count: path => counts.get(path) ?? 0,
    reply: (path, response, status = 200) => enqueue(path, response, status),
    hold: (path, response, status = 200) => enqueue(path, response, status, true),
    waitHeld: slot => expect.poll(() => Boolean(slot.request), { message: "The actual request must arrive before native departure" }).toBe(true),
    async release(slot, disconnectedReportOwner = null) {
      expect(slot.request).not.toBeNull();
      expect(slot.released).toBe(false);
      if (disconnectedReportOwner !== null) {
        // This exact report owner returns at its currentness guard before reading
        // JSON. Require its actual departure; do not assume or induce an abort.
        expect(new URL(slot.request.url()).pathname).toBe(api("health"));
        expect(slot.status).toBe(200);
        expect(await disconnectedReportOwner.evaluate(element => ({
          connected: element.isConnected, tag: element.localName, view: element.view,
        }))).toEqual({ connected: false, tag: "forma-engineering-diagnostics", view: "health" });
      }
      const observed = page.waitForResponse(response => response.request() === slot.request);
      slot.released = true; slot.resume();
      const response = await observed;
      expect(response.status()).toBe(slot.status);
      // The slot leaves held only after the original route.fulfill has completed.
      await expect.poll(() => held.has(slot)).toBe(false);
      if (disconnectedReportOwner === null) expect(await response.finished()).toBeNull();
      // A departed report uses headers + fixture fulfillment + two paint turns;
      // body completion is unobserved, not waived into a full-delivery claim.
      // Schema replies retain finished() and are not delayed-body race coverage.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (disconnectedReportOwner !== null)
        expect(slot.request.failure(), "No failed-request outcome is admitted by the departed-report boundary").toBeNull();
      log.releaseBoundaries.push({ path: new URL(slot.request.url()).pathname, status: response.status(),
        exactRequestHeadersObserved: true, fixtureFulfillmentCompleted: true,
        disconnectedReportOwner: disconnectedReportOwner !== null,
        bodyCompletion: disconnectedReportOwner === null ? "finished-null" : "unobserved", paintTurns: 2 });
    },
  };
  const onPageError = error => log.pageErrors.push({ name: error.name, message: error.message });
  page.on("pageerror", onPageError);
  let completed = false;
  try {
    await body(transport);
    expect(log.deniedTransport).toEqual([]);
    expect(log.documents).toHaveLength(1);
    expect(held.size, "Every deliberately held response must be released and observed").toBe(0);
    expect(Object.fromEntries(counts), "Exact declared read counts; no hidden retry or polling success").toEqual(expectedReads);
    expect([...queues.values()].flat(), "Every queued denial or delayed reply must be consumed").toHaveLength(0);
    completed = true;
  } finally {
    try {
      for (const slot of held) {
        slot.cleanup = { arrived: Boolean(slot.request), abortRequested: Boolean(slot.request), abortCompleted: false };
        log.abortedHeld.push(slot.cleanup); slot.cancelled = true; slot.resume();
      }
      await context.unroute("**/*", handler);
      await Promise.allSettled([...pendingHandlers]);
      log.observedReads = Object.fromEntries(counts);
      log.pendingHandlersAtAttachment = pendingHandlers.size;
      await attach(testInfo, "engineering-transport", log);
      if (completed) {
        // Recheck at the drained boundary: a late denied request or pageerror
        // must not turn unchanged destination DOM into a false stale-read pass.
        expect(log.deniedTransport).toEqual([]);
        expect(log.observedReads).toEqual(expectedReads);
        expect([...queues.values()].flat()).toHaveLength(0);
        expect(log.documents).toHaveLength(1);
        expect(log.handlerErrors).toEqual([]);
        expect(log.pageErrors).toEqual([]);
        expect(pendingHandlers.size).toBe(0);
      }
    } finally {
      page.off("pageerror", onPageError);
    }
  }
}

async function openEngineering(page, context, geometry, transport, testInfo) {
  // The retained initial-session observer deliberately handles Creative shape
  // and query-less /api/session only. Observe the platform response directly.
  const origin = new URL(testInfo.project.use.baseURL).origin;
  const sessionObserved = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === "/api/session" && ["", "?audience=engineering"].includes(url.search)
      && response.request().method() === "GET" && response.request().frame() === page.mainFrame();
  });
  // Observe a possible rejection even when navigation fails before this await;
  // the awaited original promise still rejects normally on the success path.
  void sessionObserved.catch(() => {});
  const document = await page.goto(paths.health, { waitUntil: "domcontentloaded" });
  expect(document?.ok()).toBe(true);
  expect(document.request().frame()).toBe(page.mainFrame());
  expect(document.request().isNavigationRequest()).toBe(true);
  expect(new URL(document.url()).pathname).toBe(paths.health);
  expect(await document.text()).not.toMatch(/id=["']forma-session-bootstrap["']/);
  const reply = await sessionObserved;
  expect(reply.status()).toBe(200);
  expect(reply.headers()["x-forma-engineering-synthetic"]).toBe("return-path-source-r1");
  expect(await reply.json()).toEqual(transport.session);
  await expect(page.locator("forma-platform-shell #main-content")).toHaveAttribute("aria-busy", "false");
  await expect(diagnostics(page)).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => ({ loaded: [...document.fonts].some(face => face.family.replaceAll('"', "") === "Manrope" && face.status === "loaded"), selected: getComputedStyle(document.body).fontFamily.split(",")[0] }))).toEqual({ loaded: true, selected: "Manrope" });
  await applyBrowserZoom(page, context, geometry.zoom, testInfo);
  expect(await browserMetrics(page)).toMatchObject({ width: 1280, height: 900, visualScale: 1 });
  await attach(testInfo, "engineering-initial-session", { documentPath: new URL(document.url()).pathname, documentStatus: document.status(), actualSessionPath: new URL(reply.url()).pathname + new URL(reply.url()).search,
    sessionStatus: reply.status(), mainFrameRequestBound: true, bootstrapPresent: false, authenticatedUserPresent: false, synthetic: true, audience: "engineering", capabilities: transport.session.capabilities });
}

async function activate(page, locator, testInfo, stage) {
  await tabTo(page, locator);
  await verifyFocus(page, locator, testInfo, `${stage}-focus`);
  await page.keyboard.press("Enter");
}
async function reached(page, view, marker, testInfo) {
  await expect(page).toHaveURL(new RegExp(`${paths[view]}$`));
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveAttribute("href", paths[view]);
  await expect(diagnostics(page).getByText(marker, { exact: true })).toBeVisible();
  await expect(diagnostics(page).locator('[role="alert"]')).toHaveCount(0);
  await captureViewport(page, testInfo, `engineering-${view}-${marker}`);
}
async function go(page, view, testInfo) {
  await activate(page, nav(page).locator(`a[href="${paths[view]}"]`), testInfo, `navigate-${view}`);
}

test("Engineering Health → Events → Sync → Jobs → Health rejects a departed report", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withEngineering({ page, context, baseURL }, testInfo, allCaps, { health: 3, events: 1, sync: 1, jobs: 1 }, async transport => {
    await openEngineering(page, context, geometry, transport, testInfo);
    await expect(nav(page).locator("a")).toHaveText(["Health", "Events", "Synchronization", "Jobs"]);
    await reached(page, "health", "health-receipt-1", testInfo);
    const old = transport.hold(api("health"), report("health", "DEPARTED-HEALTH-MUST-NOT-PUBLISH"));
    await activate(page, refresh(page), testInfo, "hold-health-refresh");
    await transport.waitHeld(old);
    const oldOwner = await diagnostics(page).elementHandle();
    expect(oldOwner).not.toBeNull();
    expect(await oldOwner.evaluate(element => ({ connected: element.isConnected, view: element.view })))
      .toEqual({ connected: true, view: "health" });
    await go(page, "events", testInfo);
    await reached(page, "events", "events-receipt-1", testInfo);
    const focused = await page.locator(":focus").elementHandle();
    await transport.release(old, oldOwner);
    await expect(diagnostics(page).getByText("events-receipt-1", { exact: true })).toBeVisible();
    await expect(page.getByText("DEPARTED-HEALTH-MUST-NOT-PUBLISH", { exact: true })).toHaveCount(0);
    expect(await focused.evaluate(element => element === document.activeElement)).toBe(true);
    for (const view of ["sync", "jobs", "health"]) { await go(page, view, testInfo); await reached(page, view, `${view}-receipt-${view === "health" ? 3 : 1}`, testInfo); }
    await expect(page.getByText("health-receipt-1", { exact: true })).toHaveCount(0);
    await expect(page.getByText("DEPARTED-HEALTH-MUST-NOT-PUBLISH", { exact: true })).toHaveCount(0);
  });
});

test("Engineering departed schema response cannot populate Jobs or the returned Health", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withEngineering({ page, context, baseURL }, testInfo, allCaps, { health: 2, jobs: 1, schema: 2 }, async transport => {
    await openEngineering(page, context, geometry, transport, testInfo);
    await reached(page, "health", "health-receipt-1", testInfo);
    const old = transport.hold(schemaPath, schemaReply("DEPARTED-SCHEMA-MUST-NOT-PUBLISH"));
    await activate(page, inspect(page), testInfo, "inspect-before-departure");
    await transport.waitHeld(old);
    await expect(inspect(page)).toBeDisabled();
    await go(page, "jobs", testInfo);
    await reached(page, "jobs", "jobs-receipt-1", testInfo);
    await transport.release(old);
    await expect(schema(page)).toHaveCount(0);
    await go(page, "health", testInfo);
    await reached(page, "health", "health-receipt-2", testInfo);
    await expect(inspect(page)).toBeEnabled();
    await expect(schema(page).locator("pre,[role=alert]")).toHaveCount(0);
    transport.reply(schemaPath, schemaReply("CURRENT-SCHEMA-EXPLICIT-REQUEST"));
    await activate(page, inspect(page), testInfo, "inspect-after-return");
    await expect(schema(page).locator("pre")).toContainText("CURRENT-SCHEMA-EXPLICIT-REQUEST");
    await expect(schema(page).locator("pre")).not.toContainText("DEPARTED-SCHEMA-MUST-NOT-PUBLISH");
    await captureViewport(page, testInfo, "engineering-returned-current-schema");
  });
});

for (const status of [401, 403, 404]) {
  test(`Engineering report ${status} retires pending schema and prior approved report`, async ({ page, context, baseURL, geometry }, testInfo) => {
    await withEngineering({ page, context, baseURL }, testInfo, allCaps, { health: 2, schema: 1 }, async transport => {
      await openEngineering(page, context, geometry, transport, testInfo);
      await reached(page, "health", "health-receipt-1", testInfo);
      const old = transport.hold(schemaPath, schemaReply("DENIED-SCHEMA-MUST-NOT-RESTORE"));
      await activate(page, inspect(page), testInfo, `inspect-before-${status}`);
      await transport.waitHeld(old);
      transport.reply(api("health"), { error: "Synthetic report denial" }, status);
      await activate(page, refresh(page), testInfo, `refresh-denied-${status}`);
      await expect(diagnostics(page).getByRole("alert")).toHaveText("Approved reporting is unavailable.");
      await expect(diagnostics(page).getByText("health-receipt-1", { exact: true })).toHaveCount(0);
      await expect(schema(page)).toHaveCount(0);
      await transport.release(old);
      await expect(schema(page)).toHaveCount(0);
      await expect(diagnostics(page).locator(".role-evidence,.role-metric-grid")).toHaveCount(0);
      await expect(diagnostics(page).getByRole("alert")).toHaveText("Approved reporting is unavailable.");
      await captureViewport(page, testInfo, `engineering-report-${status}-late-schema-rejected`);
    });
  });
}

test("Engineering Events-only grant lands on Events and omits ungranted tasks and schema", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withEngineering({ page, context, baseURL }, testInfo, ["engineering.events.read"], { events: 2 }, async transport => {
    await openEngineering(page, context, geometry, transport, testInfo);
    await reached(page, "events", "events-receipt-1", testInfo);
    await expect(nav(page).locator("a")).toHaveText(["Events"]);
    await expect(schema(page)).toHaveCount(0);
    expect(transport.count(api("health"))).toBe(0);
    expect(transport.count(schemaPath)).toBe(0);
    await activate(page, refresh(page), testInfo, "events-only-refresh");
    await reached(page, "events", "events-receipt-2", testInfo);
  });
});

test("Engineering diagnostics grant without identity management keeps reports but omits schema", async ({ page, context, baseURL, geometry }, testInfo) => {
  await withEngineering({ page, context, baseURL }, testInfo, ["engineering.diagnostics.read"], { health: 2, jobs: 1 }, async transport => {
    await openEngineering(page, context, geometry, transport, testInfo);
    await reached(page, "health", "health-receipt-1", testInfo);
    await expect(nav(page).locator("a")).toHaveText(["Health", "Jobs"]);
    await expect(schema(page)).toHaveCount(0);
    await go(page, "jobs", testInfo); await reached(page, "jobs", "jobs-receipt-1", testInfo);
    await go(page, "health", testInfo); await reached(page, "health", "health-receipt-2", testInfo);
    await expect(schema(page)).toHaveCount(0);
    expect(transport.count(schemaPath)).toBe(0);
  });
});
