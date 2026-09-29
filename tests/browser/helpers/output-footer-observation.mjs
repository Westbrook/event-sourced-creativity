import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { classifyTestRequest } from "./read-only-network.mjs";
import { reconcileNativeTelemetry } from "./owned-telemetry-native.mjs";
import { installJapaneseFooterIconPolicy, JA_FOOTER_DOCUMENT_URL, JA_FOOTER_ICON_HREF } from "./ja-footer-document-icon.mjs";

/**
 * Corrected launcher-only read-only observer. UNEXECUTED. Not a fixture or pass oracle.
 * R1 incorrectly required an expanded Assistant; preserve that packet as superseded.
 * Run only inside the owner-approved inert original fixture after its native
 * pre-Escape Cancel-focus stage. All bindings come from permitted fixture data.
 * Browser zoom must be independently established by the existing real-zoom
 * runner; page metrics and the supplied receipt do not establish it themselves.
 */
export function observeRequirementFooter(binding) {
  const require = (condition, message) => {
    if (!condition) throw new Error(`PRIORITY1_BINDING_STOP: ${message}`);
  };
  require(binding && binding.stage === "requirement-cancel-unactivated", "stage");
  require(["127.0.0.1", "localhost", "[::1]"].includes(location.hostname), "local fixture only");
  require(location.protocol === "http:" && location.origin === binding.origin
    && location.pathname === binding.pathname, "exact approved fixture route");
  require(binding.locale === undefined || binding.locale === "fr" || binding.locale === "ja", "only registered French or Japanese locale");
  const japanese = binding.locale === "ja";
  require(document.documentElement.lang.toLowerCase().split("-")[0] === (japanese ? "ja" : "fr"), "registered locale");
  require(binding.zoomReceipt?.mechanism === "chrome.tabs.setZoom"
    && binding.zoomReceipt.factor === (japanese ? 1 : 2)
    && typeof binding.zoomReceipt.receiptId === "string"
    && binding.zoomReceipt.receiptId.length > 0, "independent genuine browser zoom receipt");
  require(innerWidth === binding.innerWidth && innerHeight === binding.innerHeight
    && devicePixelRatio === binding.devicePixelRatio, "exact registered CSS viewport and DPR");
  require(visualViewport && visualViewport.scale === 1, "no pinch/page-scale substitute");
  const identity = binding.identity;
  require(identity && ["projectId", "documentId", "authorizationScopeKey", "requirementId"]
    .every(key => typeof identity[key] === "string" && identity[key].length > 0)
    && Object.hasOwn(identity, "revision"), "exact synthetic requirement identity");
  const cards = [...document.querySelectorAll("forma-output-requirement-card")].filter(card => {
    const input = card.snapshot ?? card.newDraft;
    return input && input.requirementId === identity.requirementId
      && input.revision === identity.revision
      && ["projectId", "documentId", "authorizationScopeKey"]
        .every(key => input.scope?.[key] === identity[key]);
  });
  require(cards.length === 1, "unique current requirement owner");
  const card = cards[0];
  const exact = (root, selector) => {
    const nodes = root.querySelectorAll(selector);
    require(nodes.length === 1, `unique ${selector}`);
    return nodes[0];
  };
  const footer = exact(card, ".output-requirement-form-footer");
  const paragraph = exact(footer, ":scope > p");
  const cancel = exact(footer, ":scope > .output-requirement-actions > button[type=button]");
  const save = exact(footer, ":scope > .output-requirement-actions > button[type=submit]");
  const expectedText = japanese ? binding.expectedJapaneseText : binding.expectedFrenchText;
  require(typeof expectedText === "string" && expectedText.length > 0, "source-bound full text");
  if (japanese) require(expectedText === "この解釈を保存します。生成前に納品計画を確認して確定してください。保存によって生成の開始、結果の承認、支出の許可が行われることはありません。", "exact current Japanese source text");
  require(paragraph.textContent === expectedText, "unchanged full paragraph");
  require(cancel.textContent.trim() === (japanese ? "キャンセル" : "Annuler") && !cancel.disabled, "native Cancel");
  require(document.activeElement === cancel && cancel.matches(":focus-visible"),
    "native Cancel focus before activation; no forced focus in observer");
  require(binding.saveDisabled === true && save.disabled === true,
    "original Save state, not changed to make case pass");
  require(binding.askKind === "launcher", "original launcher-only observation");
  const launcher = exact(document, "forma-assistant-panel > button.forma-assistant-launcher");
  const assistantOwner = launcher.parentElement;
  require(launcher instanceof HTMLButtonElement
    && launcher.getAttribute("aria-haspopup") === "dialog", "native Ask launcher");
  require(assistantOwner?.open === false
    && assistantOwner.querySelector(":scope > .forma-assistant-panel[role=dialog]") === null,
    "collapsed Assistant; an expanded panel is a different observation");
  const expectedLauncher = japanese ? binding.expectedJapaneseLauncherLabel : binding.expectedFrenchLauncherLabel;
  require(expectedLauncher === (japanese ? "Forma に質問" : "Demander à Forma")
    && launcher.getAttribute("aria-label") === expectedLauncher, "exact retained launcher label");
  const launcherBounds = launcher.getBoundingClientRect();
  require(launcherBounds.width > 0 && launcherBounds.height > 0
    && getComputedStyle(launcher).visibility === "visible", "rendered launcher");
  const box = r => ({ x: r.x, y: r.y, left: r.left, top: r.top,
    right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const view = { left: visualViewport.offsetLeft, top: visualViewport.offsetTop,
    right: visualViewport.offsetLeft + visualViewport.width,
    bottom: visualViewport.offsetTop + visualViewport.height };
  const inside = r => r.left >= view.left && r.top >= view.top
    && r.right <= view.right && r.bottom <= view.bottom;
  const describe = element => element ? { tag: element.localName, id: element.id,
    classes: element.getAttribute("class") ?? "" } : null;
  const ask = box(launcherBounds);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(box);
  require(lines.length > 0, "rendered paragraph line boxes");
  const samples = lines.map(rect => {
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const stack = inside({ left: x, right: x, top: y, bottom: y })
      ? document.elementsFromPoint(x, y) : [];
    const front = stack[0];
    return { rect, insideViewport: inside(rect), askIntersectionArea: overlap(rect, ask),
      centerTop: describe(front), paragraphOwnsCenter: Boolean(front && (front === paragraph || paragraph.contains(front))) };
  });
  const style = element => {
    const s = getComputedStyle(element);
    return { display: s.display, visibility: s.visibility, opacity: s.opacity,
      fontSize: s.fontSize, lineHeight: s.lineHeight, overflowX: s.overflowX,
      overflowY: s.overflowY, clipPath: s.clipPath, outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth, outlineOffset: s.outlineOffset };
  };
  return {
    status: "MEASUREMENTS_ONLY_REQUIRES_OWNER_VISUAL_REVIEW",
    stage: binding.stage, zoomReceipt: binding.zoomReceipt,
    identity: { projectId: identity.projectId, documentId: identity.documentId,
      authorizationScopeKey: identity.authorizationScopeKey,
      requirementId: identity.requirementId, revision: identity.revision },
    paragraph: { text: paragraph.textContent, box: box(paragraph.getBoundingClientRect()),
      style: style(paragraph), lines: samples },
    ask: { kind: "launcher", assistantState: "collapsed", box: ask, style: style(launcher),
      selector: "forma-assistant-panel > button.forma-assistant-launcher",
      ariaLabel: launcher.getAttribute("aria-label"), text: launcher.textContent.trim() },
    cancel: { box: box(cancel.getBoundingClientRect()), style: style(cancel),
      ariaLabel: cancel.getAttribute("aria-label"), focusVisible: true },
    save: { disabled: save.disabled, box: box(save.getBoundingClientRect()), style: style(save) },
    viewport: { innerWidth, innerHeight, devicePixelRatio, visualScale: visualViewport.scale,
      ...view, scrollX, scrollY },
    allParagraphLinesInsideViewport: samples.every(s => s.insideViewport),
    anyLineBoxIntersectsAsk: samples.some(s => s.askIntersectionArea > 0),
    allSampleCentersOwnedByParagraph: samples.every(s => s.paragraphOwnsCenter),
    limits: "Line boxes and center hit tests are not complete glyph, clipping, focus-perimeter or accessibility proof. No state is changed by this observer."
  };
}

/** JA-only built opener. FR continues to use the unchanged fixtures.openForma.
 * Expected bytes come from separately read build files in the JA configuration,
 * never from the response being assessed. No stylesheet/Store/font injection.
 */
export async function openJapaneseBuiltFooter(page, context, geometry, path, testInfo, helpers) {
  const { expect, attachJSON, applyBrowserZoom, browserMetrics } = helpers;
  expect(geometry).toEqual({ viewport: { width: 768, height: 900 }, zoom: 1, locale: "ja", hasTouch: false });
  expect(page.url()).toBe("about:blank");
  expect(testInfo.project.use.baseURL).toBe("http://127.0.0.1:4186");
  const binding = testInfo.config.metadata.outputFooterJapaneseBuild;
  expect(binding).toBeTruthy();
  expect(binding.href).toMatch(/^\/assets\/index-[A-Za-z0-9_-]+\.css$/);
  expect(binding.bytes).toBeGreaterThan(0); expect(binding.bytes).toBeLessThan(2000000);
  expect(binding.sha256).toMatch(/^[a-f0-9]{64}$/);
  const cssUrl = "http://127.0.0.1:4186" + binding.href;
  const iconBinding = testInfo.config.metadata.outputFooterJapaneseDocumentIcon;
  expect(new URL(path, testInfo.project.use.baseURL).href).toBe(JA_FOOTER_DOCUMENT_URL);
  // Fixed Vite SPA-fallback input, independently pinned in this JA-only config.
  // This admitted head variation is not an unchanged production-document claim.
  const iconPolicy = await installJapaneseFooterIconPolicy(context, page,
    testInfo.project.use.baseURL, iconBinding,
    await readFile(new URL("../../../dist/client/index.html", import.meta.url)));
  const startupErrors = [];
  let settled = [], actualDocument = null;
  try {
    // Register before navigation and join both outcomes. A failed navigation must
    // not leave an unowned wait-for-response rejection.
    const cssResponse = page.waitForResponse(response => response.url() === cssUrl, { timeout: 10000 });
    settled = await Promise.allSettled([
      Promise.resolve().then(() => page.goto(path, { waitUntil: "domcontentloaded" })).then(async response => {
        expect(response).toBeTruthy();
        expect(response.url()).toBe(JA_FOOTER_DOCUMENT_URL);
        expect(response.request().method()).toBe("GET");
        expect(response.request().resourceType()).toBe("document");
        expect(response.request().frame()).toBe(page.mainFrame());
        expect(response.status()).toBe(200);
        const body = await response.body();
        actualDocument = { bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") };
        expect(actualDocument).toEqual(iconBinding.response);
        return response;
      }),
      cssResponse.then(async response => {
        expect(response.request().method()).toBe("GET");
        expect(response.request().resourceType()).toBe("stylesheet");
        expect(response.request().frame()).toBe(page.mainFrame());
        expect(response.status()).toBe(200);
        const body = await response.body();
        const observed = { url: response.url(), bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") };
        expect(observed).toEqual({ url: cssUrl, bytes: binding.bytes, sha256: binding.sha256 });
        return observed;
      }),
    ]);
    startupErrors.push(...settled.filter(result => result.status === "rejected").map(result => result.reason));
    if (!startupErrors.length) {
      const icon = page.locator('head > link[rel="icon"][data-forma-footer-icon-policy="ja-footer-inert-icon-v1"]');
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute("type", "image/svg+xml");
      await expect(icon).toHaveAttribute("href", JA_FOOTER_ICON_HREF);
    }
  } catch (error) { startupErrors.push(error); }
  finally {
    try { await iconPolicy.dispose(); } catch (error) { startupErrors.push(error); }
  }
  const documentPolicyEvidence = iconPolicy.evidence();
  try { expect(documentPolicyEvidence).toMatchObject({ starts: 1, fulfilled: 1,
    pending: 0, closed: true, errors: [], activeRouteTasks: 0 }); }
  catch (error) { startupErrors.push(error); }
  try { await attachJSON(testInfo, "japanese-fixture-document-icon-policy", {
    ...documentPolicyEvidence, actualDocument,
  }); } catch (error) { startupErrors.push(error); }
  try { await attachJSON(testInfo, "japanese-built-stylesheet-response", {
    expected: binding,
    outcomes: settled.map(value => value.status === "fulfilled"
      ? { status: value.status, value: typeof value.value?.url === "string" ? value.value : "navigation response" }
      : { status: value.status, error: String(value.reason).slice(0, 2000) }),
  }); } catch (error) { startupErrors.push(error); }
  if (startupErrors.length) throw new AggregateError(startupErrors, "JA built document/stylesheet evidence failed");
  expect(settled[0].value?.ok()).toBe(true);
  await expect(page.locator("forma-shell")).toBeAttached();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.evaluate(() => document.fonts.ready);
  const readPolicy = () => page.evaluate(href => {
    const normalize = value => value.split(",").map(family => family.trim().replace(/^["']|["']$/g, "")).join(", ");
    const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
    const expectedSelector = ":root:lang(ja), forma-ui-locale:lang(ja)";
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => link.href === href);
    const sheets = [...document.styleSheets].filter(sheet => sheet.href === href && sheet.ownerNode === links[0]);
    const declarations = [], errors = [];
    if (links.length === 1 && sheets.length === 1) {
      try {
        for (const rule of sheets[0].cssRules) {
          if (rule.type !== CSSRule.STYLE_RULE || rule.selectorText !== expectedSelector) continue;
          declarations.push({ owner: href, ownerKind: "verified-built-asset", selector: rule.selectorText,
            sans: normalize(rule.style.getPropertyValue("--sans")), family: rule.style.getPropertyValue("--forma-font-family").trim(),
            sansPriority: rule.style.getPropertyPriority("--sans"), familyPriority: rule.style.getPropertyPriority("--forma-font-family") });
        }
      } catch (error) { errors.push(String(error).slice(0, 1000)); }
    }
    return { language: document.documentElement.lang, direction: document.documentElement.dir,
      bodyFont: normalize(body.fontFamily), sansToken: normalize(root.getPropertyValue("--sans")),
      fontFamilyToken: normalize(root.getPropertyValue("--forma-font-family")),
      links: links.length, sheets: sheets.length, declarations, errors, fontsStatus: document.fonts.status,
      declaredStackAvailable: document.fonts.check(`16px ${body.fontFamily}`, "日本語 ドキュメント名 フィルターをクリア"),
      coarse: matchMedia("(pointer: coarse)").matches, hoverNone: matchMedia("(hover: none)").matches,
      maxTouchPoints: navigator.maxTouchPoints };
  }, cssUrl);
  const stack = "Hiragino Sans, Yu Gothic, Noto Sans CJK JP, ui-sans-serif, system-ui, sans-serif";
  await expect.poll(readPolicy).toMatchObject({ language: "ja", direction: "ltr", bodyFont: stack,
    sansToken: stack, fontFamilyToken: stack, links: 1, sheets: 1, errors: [],
    fontsStatus: "loaded", declaredStackAvailable: true, coarse: false, hoverNone: false, maxTouchPoints: 0,
    declarations: [{ owner: cssUrl, ownerKind: "verified-built-asset", selector: ":root:lang(ja), forma-ui-locale:lang(ja)",
      sans: stack, family: "var(--sans)", sansPriority: "", familyPriority: "" }] });
  await attachJSON(testInfo, "application-japanese-typeface-source", { ...await readPolicy(),
    expectedStylesheet: binding, actualStylesheet: settled[1].value,
    limit: "Verified built CSS, computed policy and declared-stack availability. No per-glyph face or physical/AT conformance claim; no stylesheet alias or font substitution." });
  await attachJSON(testInfo, "application-typeface", { policy: "declared-japanese-system-font-stack", ...await readPolicy() });
  await applyBrowserZoom(page, context, 1, testInfo);
  expect(await browserMetrics(page)).toMatchObject({ width: 768, height: 900, dpr: 1, visualScale: 1 });
  await expect(page.locator(".consent-modal:modal"), "Complete normal local onboarding separately; this read-only suite does not accept terms").toHaveCount(0);
  await attachJSON(testInfo, "application-assets", await page.evaluate(() => ({
    url: location.href, language: document.documentElement.lang, direction: document.documentElement.dir,
    scripts: [...document.scripts].map(script => script.src).filter(Boolean),
    stylesheets: [...document.styleSheets].map(sheet => sheet.href).filter(Boolean),
    bodyFont: getComputedStyle(document.body).fontFamily,
    fonts: [...document.fonts].map(face => ({ family: face.family, weight: face.weight, status: face.status })),
  })));
}

/** Unexecuted fragment for tests/browser/helpers/output-footer-observation.mjs.
 * The relative data URL is resolved from that merged helper, not this support file.
 * Install only for the admitted JA case, after its personal fixture and before
 * navigation. Importing the helper alone never reads the cache or installs routes.
 */
export async function installCachedFooterFonts(context, page, baseURL) {
  const requireFont = (condition, reason) => {
    if (!condition) throw new Error(`FONT_CACHE_STOP: ${reason}`);
  };
  const base = new URL(baseURL);
  requireFont(base.origin === "http://127.0.0.1:4186" && base.pathname === "/"
    && !base.username && !base.password && !base.search && !base.hash, "exact loopback preview origin");
  requireFont(page.context() === context && page.url() === "about:blank", "existing fixture page before navigation");
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const cachePin = Object.freeze({ bytes: 74821,
    sha256: "23c3ee19555b401e8d40f830ba8b1187cc3b6c22a016b940bce0a29c3044e84b" });
  // Lazy, fixed file read. No linked provenance resources or live URL are read.
  const cacheBytes = await readFile(new URL("../data/shared-reader-fonts.json", import.meta.url));
  requireFont(cacheBytes.length === cachePin.bytes && digest(cacheBytes) === cachePin.sha256, "exact cached-font file pin");
  const cached = JSON.parse(cacheBytes.toString("utf8"));
  const expected = Object.freeze([
    Object.freeze({ url: "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap",
      bytes: 12597, sha256: "20ebf3a70449976ba09d84e9087f2a9ecdd8787fd95112e22f9c61507ec3d468",
      resourceType: "stylesheet", contentType: "text/css; charset=utf-8" }),
    Object.freeze({ url: "https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSvfedN4.woff2",
      bytes: 24576, sha256: "e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f",
      resourceType: "font", contentType: "font/woff2" }),
    Object.freeze({ url: "https://fonts.gstatic.com/s/dmmono/v16/aFTU7PB1QTsUX8KYthqQBK6PYK0.woff2",
      bytes: 8688, sha256: "fd7521f3531a5ccfc655b25c4f22e9871df3ec141ad79bb27fde20d0df347b6d",
      resourceType: "font", contentType: "font/woff2" }),
    Object.freeze({ url: "https://fonts.gstatic.com/s/dmmono/v16/aFTR7PB1QTsUX8KYvumzEYOtbYf-Vlg.woff2",
      bytes: 8724, sha256: "0e263db52797086e763679c54f84ded8cc1249879bc27dca2bd5dd446f6d9f36",
      resourceType: "font", contentType: "font/woff2" }),
  ]);
  requireFont(cached.schemaVersion === 1 && Array.isArray(cached.responses)
    && cached.responses.length === expected.length, "four cached responses only");
  const responses = new Map(cached.responses.map((row, index) => {
    const pin = expected[index];
    requireFont(Object.keys(pin).every(key => row[key] === pin[key]), "exact cached response identity and type");
    const body = Buffer.from(row.bodyBase64, "base64");
    requireFont(body.length === pin.bytes && digest(body) === pin.sha256, "exact decoded response bytes");
    return [pin.url, { ...pin, body }];
  }));

  const caps = Object.freeze({ requests: 16, perUrl: 4, records: 32, errors: 16, unfinishedSamples: 16 });
  const counts = { started: 0, finished: 0, failed: 0, fulfilled200: 0, blocked: 0,
    routeErrors: 0, abortErrors: 0, capErrors: 0, lifecycleErrors: 0,
    recordsDropped: 0, errorsDropped: 0 };
  const requests = new WeakMap(), unfinished = new Map(), perUrl = new Map(), records = [], errors = [];
  let pendingRequests = 0, handledRequests = 0, halted = false, firstError = null, lastError = null;
  const append = item => { if (records.length < caps.records) records.push(item); else counts.recordsDropped++; };
  const noteError = (stage, reason, error) => {
    const message = String(error?.message ?? "");
    const item = { stage, reason, name: String(error?.name ?? "Error").slice(0, 60),
      detail: message.startsWith("FONT_CACHE_STOP: ") ? message.slice(0, 240) : "No request body, headers or credentials recorded" };
    firstError ??= item; lastError = item;
    if (errors.length < caps.errors) errors.push(item); else counts.errorsDropped++;
  };
  const localBrowser = url => ["data:", "blob:", "chrome-extension:"].includes(url.protocol);
  const handled = url => url.origin !== base.origin && !localBrowser(url);
  const track = request => {
    if (requests.has(request)) return requests.get(request);
    const url = new URL(request.url());
    if (!handled(url)) return null;
    const record = { requestId: ++counts.started, method: request.method(), resourceType: request.resourceType(),
      origin: url.origin, path: url.pathname, decision: "pending", responseStatus: null };
    const state = { record, settled: false };
    requests.set(request, state); pendingRequests++;
    if (unfinished.size < caps.unfinishedSamples) unfinished.set(record.requestId, record);
    return state;
  };
  const settle = (request, outcome) => {
    const state = requests.get(request);
    if (!state || state.settled) return;
    state.settled = true; pendingRequests--;
    counts[outcome === "finished" ? "finished" : "failed"]++;
    unfinished.delete(state.record.requestId);
    append({ ...state.record, outcome });
  };
  context.on("request", request => {
    try { track(request); }
    catch (error) { counts.lifecycleErrors++; halted = true; noteError("request", "tracking_error", error); }
  });
  context.on("response", response => {
    try {
      const state = requests.get(response.request());
      if (state) state.record.responseStatus = response.status();
    } catch (error) { counts.lifecycleErrors++; halted = true; noteError("response", "tracking_error", error); }
  });
  context.on("requestfinished", request => settle(request, "finished"));
  context.on("requestfailed", request => settle(request, "failed"));
  const block = async (route, state, reason) => {
    halted = true; counts.blocked++;
    if (state) state.record.decision = "abort";
    noteError("route", reason);
    try { await route.abort("blockedbyclient"); }
    catch (error) { counts.abortErrors++; noteError("abort", "abort_error", error); }
  };

  await context.route("**/*", async route => {
    let state = null;
    try {
      const request = route.request(), url = new URL(request.url());
      // Preserve the personal finite fixture and generic guard below, including
      // their writer/telemetry policy. This fragment adds no API responses.
      if (!handled(url)) { await route.fallback(); return; }
      state = track(request); handledRequests++;
      if (halted) return await block(route, state, "font_transport_halted");
      if (handledRequests > caps.requests) {
        counts.capErrors++; return await block(route, state, "font_request_cap");
      }
      const retained = responses.get(url.href);
      if (url.username || url.password || url.hash || request.method() !== "GET"
        || !retained || request.resourceType() !== retained.resourceType) {
        return await block(route, state, "unadmitted_remote_request");
      }
      requireFont(request.frame().page() === page, "cached font belongs to the admitted page");
      const count = (perUrl.get(url.href) ?? 0) + 1;
      perUrl.set(url.href, count);
      if (count > caps.perUrl) {
        counts.capErrors++; return await block(route, state, "font_per_URL_cap");
      }
      Object.assign(state.record, { decision: "cached_font_fulfill_requested", cacheUrl: retained.url,
        bytes: retained.bytes, sha256: retained.sha256 });
      await route.fulfill({ status: 200, headers: { "content-type": retained.contentType,
        "access-control-allow-origin": "*", "cache-control": "no-store" }, body: retained.body });
      counts.fulfilled200++;
      // Fulfillment completion is not request completion. Only the actual
      // requestfinished/requestfailed events decrement pendingRequests.
    } catch (error) {
      counts.routeErrors++; halted = true; noteError("route", "unexpected_route_error", error);
      await block(route, state, "unexpected_route_error");
    }
  });
  return Object.freeze({
    evidence() {
      return {
        status: "FONT_TRANSPORT_ONLY_NOT_ACCEPTANCE", halted, cachePin: { ...cachePin },
        counts: { ...counts }, caps: { ...caps }, pendingRequests, handledRequests,
        unfinishedSamples: [...unfinished.values()].map(value => ({ ...value })),
        unfinishedSamplesTruncated: pendingRequests > unfinished.size,
        records: records.map(value => ({ ...value })), errors: errors.map(value => ({ ...value })),
        firstError: firstError ? { ...firstError } : null, lastError: lastError ? { ...lastError } : null,
        perUrlRequests: Object.fromEntries(perUrl), admittedResponses: expected.map(value => ({ ...value })),
        liveFontFallbacks: 0,
        limits: "Only actual intercepted requests are observed. The four available cached responses need not all be requested. No synthetic CSS, font substitution, installed-face/per-glyph proof, shared-reader identity, live request or application acceptance is supplied. Caller must preserve primary errors, attach this evidence in finally, and separately verify font policy and zero pending/error/blocked/cap counts.",
      };
    },
  });
}

/** JA-only diagnostics overlay; source proposal, not an execution receipt.
 * Install after cached fonts and before navigation. Everything except the two
 * already-suppressed observational POSTs falls through to the existing fixture.
 * Public ConsoleMessage timestamps bridge to native Log entries; native request
 * IDs bridge through unique full-body Request signatures. Missing identity fails.
 */
export async function installOwnedTelemetryDiagnostics(context, page, baseURL) {
  const requireTelemetry = (condition, reason) => {
    if (!condition) throw new Error(`OWNED_TELEMETRY_STOP: ${reason}`);
  };
  const base = new URL(baseURL);
  requireTelemetry(base.origin === "http://127.0.0.1:4186" && base.pathname === "/"
    && !base.username && !base.password && !base.search && !base.hash, "exact loopback preview origin");
  requireTelemetry(process.env.FORMA_A11Y_SYNTHETIC_NETWORK === "1"
    && page.context() === context && page.url() === "about:blank", "existing personal fixture before navigation");
  const paths = new Set(["/api/performance", "/api/events/hot"]);
  const blockedCode = /^net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/;
  const resourceNotice = /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/;
  const caps = Object.freeze({ telemetry: 24, console: 32, failed: 64, targetRequests: 64,
    bodyBytes: 65536, eventCount: 32, errors: 16, nativeRequests: 256, nativeEvents: 2048 });
  const raw = { consoleErrors: 0, requestFailures: 0, ownedAbortRequests: 0,
    abortErrors: 0, capErrors: 0, handlerErrors: 0, recordsDropped: 0, errorsDropped: 0 };
  const subscriptions = [];
  const listen = (emitter, name, callback) => { emitter.on(name, callback); subscriptions.push(() => emitter.off(name, callback)); };
  const byRequest = new WeakMap(), targets = [], owned = [], failures = [], consoles = [], errors = [];
  let ordinal = 0, requestId = 0, outstandingAbortOperations = 0, halted = false;
  let firstError = null, lastError = null;
  const noteError = (stage, reason, error) => {
    const text = String(error?.message ?? "");
    const item = { ordinal: ++ordinal, stage, reason, name: String(error?.name ?? "Error").slice(0, 60),
      detail: text.startsWith("OWNED_TELEMETRY_STOP: ") ? text.slice(0, 240) : "No body or credentials recorded" };
    firstError ??= item; lastError = item;
    if (errors.length < caps.errors) errors.push(item); else raw.errorsDropped++;
  };
  const capError = reason => { raw.capErrors++; halted = true; noteError("cap", reason); };
  const mainFrameOwned = request => {
    try { return request.frame().page() === page && request.frame() === page.mainFrame(); }
    catch { return false; }
  };
  const ensureRequest = request => {
    if (byRequest.has(request)) return byRequest.get(request);
    const url = new URL(request.url());
    const state = { id: ++requestId, startOrdinal: ++ordinal, url: url.href,
      origin: url.origin, path: url.pathname, queryPresent: Boolean(url.search),
      method: request.method(), resourceType: request.resourceType(), mainFrameOwned: mainFrameOwned(request),
      retainedTarget: false, owned: false, abortStartedOrdinal: null, abortCompletedOrdinal: null,
      abortSettled: false, abortCompleted: false, failedOrdinal: null, failureText: null, finishedOrdinal: null };
    byRequest.set(request, state);
    if (url.origin === base.origin && paths.has(url.pathname)) {
      const body = request.postDataBuffer();
      if (body && body.length <= caps.bodyBytes) {
        state.bodyBytes = body.length; state.bodySha256 = createHash("sha256").update(body).digest("hex");
      }
      if (targets.length < caps.targetRequests) { targets.push(state); state.retainedTarget = true; }
      else { raw.recordsDropped++; capError("target_request_records"); }
    }
    return state;
  };
  const handler = (stage, action) => {
    try { action(); }
    catch (error) { raw.handlerErrors++; halted = true; noteError(stage, "diagnostic_handler_error", error); }
  };
  listen(context, "request", request => handler("request", () => { ensureRequest(request); }));
  listen(context, "requestfinished", request => handler("requestfinished", () => {
    const state = ensureRequest(request);
    state.finishedOrdinal = ++ordinal;
    if (state.owned) {
      raw.handlerErrors++; halted = true; noteError("requestfinished", "owned_abort_finished_instead_of_failed");
    }
  }));
  listen(context, "requestfailed", request => handler("requestfailed", () => {
    raw.requestFailures++;
    const state = ensureRequest(request), failedOrdinal = ++ordinal;
    if (state.failedOrdinal !== null) {
      raw.handlerErrors++; halted = true; noteError("requestfailed", "duplicate_failure_event_for_Request");
    }
    state.failedOrdinal = failedOrdinal;
    state.failureText = String(request.failure()?.errorText ?? "");
    if (failures.length < caps.failed) failures.push({ state, ordinal: failedOrdinal });
    else { raw.recordsDropped++; capError("request_failure_records"); }
  }));
  const expectedFailure = state => state.owned && state.mainFrameOwned && state.abortCompleted
    && state.abortSettled && state.failedOrdinal > state.abortStartedOrdinal
    && state.finishedOrdinal === null && blockedCode.test(state.failureText ?? "");
  const pendingOwnedFailure = state => state.owned && !state.abortSettled
    && state.failedOrdinal > state.abortStartedOrdinal && blockedCode.test(state.failureText ?? "");

  const native = { ready: false, closed: false, mainFrameId: null, requestStarts: 0, eventCount: 0,
    logErrors: 0, runtimeConsoleErrors: 0, recordsDropped: 0, errors: [], requests: [], logs: [], runtime: [],
    nonTargetFailureCount: 0, nonTargetFailures: [] };
  const nativeIds = new Map();
  let session, disposal, routeHandler = null, closing = false;
  const routeTasks = new Set();
  const nativeError = (reason, error, { stopOwnership = true } = {}) => {
    if (stopOwnership) halted = true;
    raw.handlerErrors++;
    noteError("native", reason, error);
    if (native.errors.length < caps.errors) native.errors.push(reason);
    else { native.recordsDropped++; raw.errorsDropped++; }
    return lastError.ordinal;
  };
  // Diagnostic only: do not expose a URL/path/query, body, headers or source.
  // Hashes allow an owner to join the retained network trace without copying it.
  const nonTargetFailureWitness = (row, event, errorOrdinal) => {
    requireTelemetry(typeof row.url === "string" && Buffer.byteLength(row.url, "utf8") <= 8192,
      "bounded non-target failure URL witness");
    requireTelemetry(typeof event.errorText === "string" && event.errorText.length <= 1200,
      "bounded non-target failure code witness");
    const url = new URL(row.url);
    const resourceTypes = new Set(["document", "stylesheet", "image", "media", "font", "script", "texttrack",
      "xhr", "fetch", "prefetch", "eventsource", "websocket", "manifest", "signedexchange", "ping", "cspviolationreport", "preflight", "other"]);
    const resourceType = value => resourceTypes.has(String(value).toLowerCase()) ? String(value).toLowerCase() : "unknown";
    const digest = text => createHash("sha256").update(text).digest("hex");
    const blocked = event.blockedReason;
    requireTelemetry(blocked === undefined || typeof blocked === "string" && blocked.length <= 200,
      "bounded native blocked reason witness");
    return {
      errorOrdinal, requestId: row.id,
      method: /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/.test(row.method) ? row.method : "other",
      requestType: resourceType(row.resourceType), failureType: resourceType(event.type),
      frameId: typeof row.frameId === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(row.frameId) ? row.frameId : null,
      mainFrameMatch: row.frameId !== null && row.frameId === native.mainFrameId,
      url: { sha256: digest(row.url), bytes: Buffer.byteLength(row.url, "utf8"),
        scheme: ["http:", "https:", "data:", "blob:", "about:"].includes(url.protocol) ? url.protocol : "other",
        originRelation: url.origin === base.origin ? "same-origin" : "other-origin",
        queryPresent: Boolean(url.search), fragmentPresent: Boolean(row.urlFragment || url.hash),
        credentialsPresent: Boolean(url.username || url.password) },
      errorTextCode: /^net::ERR_[A-Z0-9_]+(?:\.Inspector)?$/.test(event.errorText) ? event.errorText : null,
      errorTextSha256: digest(event.errorText),
      canceled: typeof event.canceled === "boolean" ? event.canceled : null,
      blockedReasonSha256: blocked === undefined ? null : digest(blocked),
      requestCount: row.requestCount, failedCount: row.failedCount,
      responseCount: row.responseCount, finishedCount: row.finishedCount,
    };
  };
  const nativeEvent = (name, action) => event => {
    if (++native.eventCount > caps.nativeEvents) {
      native.recordsDropped++; raw.recordsDropped++; capError("native_event_records"); return;
    }
    try { action(event); } catch (error) { nativeError(name, error); }
  };
  const nativeBody = request => {
    let body;
    if (Array.isArray(request.postDataEntries)) {
      requireTelemetry(request.postDataEntries.length > 0 && request.postDataEntries.length <= 32, "bounded complete post entries");
      const chunks = request.postDataEntries.map(entry => {
        requireTelemetry(typeof entry.bytes === "string" && entry.bytes.length <= Math.ceil(caps.bodyBytes / 3) * 4,
          "complete base64 post entry");
        const chunk = Buffer.from(entry.bytes, "base64");
        requireTelemetry(chunk.toString("base64") === entry.bytes, "canonical complete base64 post entry");
        return chunk;
      });
      requireTelemetry(chunks.reduce((sum, chunk) => sum + chunk.length, 0) <= caps.bodyBytes, "bounded complete native body");
      body = Buffer.concat(chunks);
      if (typeof request.postData === "string") requireTelemetry(body.equals(Buffer.from(request.postData, "utf8")), "native body fields agree");
    } else {
      requireTelemetry(typeof request.postData === "string", "native POST body present, never substituted from Playwright");
      body = Buffer.from(request.postData, "utf8");
      requireTelemetry(body.toString("utf8") === request.postData, "native POST UTF8 roundtrip");
    }
    requireTelemetry(body.length <= caps.bodyBytes, "bounded native POST bytes");
    return { bodyBytes: body.length, bodySha256: createHash("sha256").update(body).digest("hex") };
  };
  const dispose = () => disposal ??= (async () => {
    closing = true;
    const cleanupErrors = [];
    const retainCleanup = async (name, action) => {
      try { await action(); } catch (error) { cleanupErrors.push(error); nativeError(name, error); }
    };
    // Stop new ownership before removing only this exact handler. Other fixture
    // and font routes remain installed. Keep observation active during the drain.
    if (routeHandler) {
      await retainCleanup("native_route_remove_failed", () => context.unroute("**/*", routeHandler));
      await retainCleanup("native_owned_route_drain_failed", async () => {
        let timer;
        try {
          await Promise.race([Promise.allSettled([...routeTasks]), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("OWNED_TELEMETRY_STOP: owned route drain timeout")), 2500);
          })]);
        } finally { clearTimeout(timer); }
        const deadline = Date.now() + 2500;
        for (;;) {
          const value = reconcileNativeTelemetry({ requests: targets, nativeRequests: native.requests,
            nativeLogs: native.logs, console: consoles, mainFrameId: native.mainFrameId,
            ready: native.ready, recordLoss: Boolean(raw.recordsDropped || raw.errorsDropped || native.recordsDropped),
            runtimeConsoleErrors: native.runtimeConsoleErrors });
          const unsettled = outstandingAbortOperations || owned.some(state => !state.abortSettled
            || state.abortCompleted && state.failedOrdinal === null && state.finishedOrdinal === null)
            || value.pendingNative || value.console.some(row => row.classification === "pending")
            || value.nativeLog.some(row => row.classification === "pending");
          if (!unsettled) break;
          requireTelemetry(Date.now() < deadline, "owned native lifecycle drain timeout");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        const { frameTree } = await session.send("Page.getFrameTree");
        requireTelemetry(frameTree.frame.id === native.mainFrameId && !frameTree.childFrames?.length,
          "same native main-frame identity at final checkpoint");
      });
    }
    await retainCleanup("native_session_detach_failed", async () => { if (session) await session.detach(); });
    native.closed = true;
    for (const unsubscribe of subscriptions.splice(0)) {
      try { unsubscribe(); } catch (error) { cleanupErrors.push(error); nativeError("native_listener_remove_failed", error); }
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Owned native diagnostic cleanup failed");
  })();
  try {
    requireTelemetry(page.frames().length === 1 && page.workers().length === 0, "one main-frame target, no worker console source");
    session = await context.newCDPSession(page);
    listen(page, "frameattached", () => nativeError("unsupported_auxiliary_frame"));
    listen(page, "worker", () => nativeError("unsupported_worker_console_source"));
    listen(session, "Page.frameNavigated", nativeEvent("frame_navigated", ({ frame }) => {
      if (!frame.parentId && native.mainFrameId && frame.id !== native.mainFrameId) nativeError("main_frame_identity_changed");
    }));
    listen(session, "Network.requestWillBeSent", nativeEvent("native_request", event => {
      native.requestStarts++;
      requireTelemetry(typeof event.requestId === "string" && event.requestId.length > 0 && event.requestId.length <= 160,
        "bounded native request ID");
      const previous = nativeIds.get(event.requestId);
      if (previous) {
        previous.requestCount++; previous.redirected = true;
        // Reused IDs are never rebound, even if the redirect changes URL.
        nativeError("reused_or_redirected_native_request_id"); return;
      }
      if (nativeIds.size >= caps.nativeRequests) { native.recordsDropped++; raw.recordsDropped++; capError("native_request_cap"); return; }
      const url = new URL(event.request.url), target = url.origin === base.origin && paths.has(url.pathname);
      const row = { id: event.requestId, url: url.href, method: event.request.method,
        urlFragment: event.request.urlFragment ?? "",
        resourceType: String(event.type ?? "").toLowerCase(), frameId: event.frameId ?? null,
        requestCount: 1, redirected: Boolean(event.redirectResponse), failedCount: 0, failureText: null,
        finishedCount: 0, responseCount: 0, target, bodyBytes: null, bodySha256: null };
      nativeIds.set(row.id, row);
      if (!target) return;
      if (native.requests.length >= caps.targetRequests) { native.recordsDropped++; raw.recordsDropped++; capError("native_target_cap"); return; }
      native.requests.push(row);
      Object.assign(row, nativeBody(event.request));
    }));
    for (const [eventName, field] of [["Network.loadingFinished", "finishedCount"], ["Network.responseReceived", "responseCount"]]) {
      listen(session, eventName, nativeEvent(eventName, event => {
        const row = nativeIds.get(event.requestId);
        if (!row) { nativeError("native_terminal_without_observed_request"); return; }
        row[field]++;
      }));
    }
    listen(session, "Network.loadingFailed", nativeEvent("native_loading_failed", event => {
      const row = nativeIds.get(event.requestId);
      if (!row) { nativeError("native_failure_without_observed_request"); return; }
      row.failedCount++; row.failureText = event.errorText;
      if (!row.target) {
        // Keep the first fault fatal in final evidence, but do not make an
        // unrelated failure prevent later telemetry from being observed/owned.
        const errorOrdinal = nativeError("native_failure_not_owned_telemetry", undefined, { stopOwnership: false });
        native.nonTargetFailureCount++;
        if (native.nonTargetFailures.length >= caps.errors) {
          native.recordsDropped++; raw.recordsDropped++; capError("native_non_target_failure_records"); return;
        }
        native.nonTargetFailures.push(nonTargetFailureWitness(row, event, errorOrdinal));
      }
    }));
    listen(session, "Log.entryAdded", nativeEvent("native_log", ({ entry }) => {
      if (entry.level !== "error") return;
      native.logErrors++;
      if (native.logs.length >= caps.console) { native.recordsDropped++; raw.recordsDropped++; capError("native_log_cap"); return; }
      requireTelemetry(typeof entry.text === "string" && entry.text.length <= 1200
        && typeof entry.url === "string" && entry.url.length <= 2048, "bounded native error location and text");
      native.logs.push({ id: native.logErrors, source: entry.source, level: entry.level,
        text: entry.text, url: entry.url, lineNumber: entry.lineNumber ?? 0, timestamp: entry.timestamp,
        networkRequestId: entry.networkRequestId ?? null, workerId: entry.workerId ?? null });
    }));
    listen(session, "Runtime.consoleAPICalled", nativeEvent("runtime_console", event => {
      if (!["error", "assert"].includes(event.type)) return;
      native.runtimeConsoleErrors++;
      if (native.runtime.length < caps.console) native.runtime.push({ type: event.type,
        timestamp: event.timestamp, executionContextId: event.executionContextId });
      else { native.recordsDropped++; raw.recordsDropped++; capError("runtime_console_cap"); }
    }));
    await session.send("Page.enable");
    const { frameTree } = await session.send("Page.getFrameTree");
    requireTelemetry(typeof frameTree.frame.id === "string" && frameTree.frame.id.length > 0
      && !frameTree.frame.parentId && !frameTree.childFrames?.length, "native main-frame identity before navigation");
    native.mainFrameId = frameTree.frame.id;
    await session.send("Network.enable", { maxPostDataSize: caps.bodyBytes });
    await session.send("Log.enable");
    await session.send("Runtime.enable");
    native.ready = true;
  } catch (error) {
    nativeError("native_setup_failed", error);
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native diagnostic setup and detach failed"); }
    throw error;
  }

  const handleRoute = async route => {
    let state = null;
    try {
      const request = route.request(), url = new URL(request.url());
      if (closing) {
        if (url.origin === base.origin && paths.has(url.pathname)) nativeError("telemetry_after_ownership_seal");
        await route.fallback(); return;
      }
      // Unknown methods, payloads, subframes and URLs remain the original
      // fixture's responsibility. Their failures receive no exemption below.
      if (url.origin !== base.origin || !paths.has(url.pathname) || url.search || url.hash
        || url.username || url.password || request.method() !== "POST"
        || !["fetch", "xhr"].includes(request.resourceType()) || !mainFrameOwned(request)) {
        await route.fallback(); return;
      }
      state = ensureRequest(request);
      const postData = request.postData() ?? "", bodyBytes = Buffer.byteLength(postData, "utf8");
      if (bodyBytes > caps.bodyBytes) { capError("telemetry_body_bytes"); await route.fallback(); return; }
      const input = { method: request.method(), url: url.href, resourceType: request.resourceType(), postData };
      if (classifyTestRequest(input, base.origin) !== "suppressed-telemetry") { await route.fallback(); return; }
      let eventTypes = [];
      if (url.pathname === "/api/events/hot") {
        const payload = JSON.parse(postData), events = payload.events ?? (payload.event ? [payload.event] : []);
        if (!Array.isArray(events) || events.length < 1 || events.length > caps.eventCount) {
          capError("telemetry_event_count"); await route.fallback(); return;
        }
        eventTypes = events.map(event => event.type);
      }
      if (halted || !state.retainedTarget) { await route.fallback(); return; }
      if (owned.length >= caps.telemetry) { capError("owned_telemetry_requests"); await route.fallback(); return; }
      requireTelemetry(!state.owned && state.failedOrdinal === null && state.finishedOrdinal === null,
        "own one live Request before its abort");
      const rawBody = request.postDataBuffer();
      requireTelemetry(Buffer.isBuffer(rawBody) && rawBody.equals(Buffer.from(postData, "utf8"))
        && state.bodyBytes === bodyBytes
        && state.bodySha256 === createHash("sha256").update(postData).digest("hex"),
        "classified text agrees with retained raw Playwright POST bytes");
      state.owned = true; state.abortStartedOrdinal = ++ordinal;
      state.eventTypes = eventTypes; owned.push(state); raw.ownedAbortRequests++;
      outstandingAbortOperations++;
      try {
        await route.abort("blockedbyclient");
        state.abortCompleted = true; state.abortCompletedOrdinal = ++ordinal;
      } catch (error) {
        raw.abortErrors++; halted = true; noteError("abort", "owned_abort_failed", error);
      } finally {
        state.abortSettled = true; outstandingAbortOperations--;
      }
    } catch (error) {
      raw.handlerErrors++; halted = true; noteError("route", "telemetry_route_error", error);
      // A handler error must not fall through into a backend or hide a failure.
      try { await route.abort("blockedbyclient"); }
      catch (abortError) { raw.abortErrors++; noteError("abort", "error_abort_failed", abortError); }
    }
  };
  routeHandler = route => {
    const task = handleRoute(route);
    routeTasks.add(task);
    task.then(() => routeTasks.delete(task), error => { routeTasks.delete(task); nativeError("route_task_failed", error); });
    return task;
  };
  try { await context.route("**/*", routeHandler); } catch (error) {
    nativeError("route_registration_failed", error);
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Telemetry route setup and native detach failed"); }
    throw error;
  }

  const reconcile = () => {
    const value = reconcileNativeTelemetry({ requests: targets, nativeRequests: native.requests,
      nativeLogs: native.logs, console: consoles, mainFrameId: native.mainFrameId,
      ready: native.ready, recordLoss: Boolean(raw.recordsDropped || raw.errorsDropped || native.recordsDropped),
      runtimeConsoleErrors: native.runtimeConsoleErrors });
    return { ...value, result: new Map(value.console.map(row => [row.id, row])) };
  };
  const requestRecord = state => ({ requestId: state.id, startOrdinal: state.startOrdinal,
    origin: state.origin, path: state.path, queryPresent: state.queryPresent, method: state.method,
    resourceType: state.resourceType, mainFrameOwned: state.mainFrameOwned, owned: state.owned,
    abortStartedOrdinal: state.abortStartedOrdinal, abortCompletedOrdinal: state.abortCompletedOrdinal,
    abortSettled: state.abortSettled, abortCompleted: state.abortCompleted,
    failedOrdinal: state.failedOrdinal, failureText: state.failureText?.slice(0, 200) ?? null,
    finishedOrdinal: state.finishedOrdinal, bodyBytes: state.bodyBytes ?? null, bodySha256: state.bodySha256 ?? null,
    eventTypes: state.eventTypes ? [...state.eventTypes] : [] });
  return Object.freeze({
    dispose,
    recordConsoleError(message) {
      handler("console", () => {
        requireTelemetry(message.type() === "error", "forward only raw console errors");
        raw.consoleErrors++;
        requireTelemetry(typeof message.timestamp === "function", "public ConsoleMessage.timestamp support");
        requireTelemetry(message.page() === page && typeof message.worker === "function" && message.worker() === null,
          "console belongs to the exact page, not a worker");
        const text = message.text(), location = message.location(), at = ++ordinal, timestamp = message.timestamp();
        if (consoles.length >= caps.console) { raw.recordsDropped++; capError("console_records"); return; }
        const url = typeof location.url === "string" ? location.url : "";
        const exactTelemetryUrl = [...paths].some(path => url === base.origin + path);
        consoles.push({ id: raw.consoleErrors, ordinal: at, url, text: text.slice(0, 1200),
          resourceNotice: resourceNotice.test(text), exactTelemetryUrl,
          lineNumber: location.lineNumber, columnNumber: location.columnNumber, timestamp });
      });
    },
    evidence() {
      let association, associationError = null;
      try { association = reconcile(); }
      catch (error) {
        associationError = { stage: "association", reason: String(error.message).slice(0, 80),
          detail: "Bounded association stopped; no console exemption granted" };
        association = { result: new Map(consoles.map(value => [value.id,
          { classification: "unexpected", reason: "association_stopped" }])), nativeLog: [], issues: ["association_stopped"], pendingNative: 0 };
      }
      const values = [...association.result.values()];
      const expectedConsoleErrors = values.filter(value => value.classification === "expected").length;
      const ambiguousConsoleErrors = values.filter(value => value.classification === "ambiguous").length;
      const pendingConsole = values.filter(value => value.classification === "pending").length;
      const ownedExpectedFailures = failures.filter(value => expectedFailure(value.state)).length;
      const pendingFailureClassification = failures.filter(value => pendingOwnedFailure(value.state)).length;
      const pendingTelemetry = owned.filter(state => !state.abortSettled
        || state.abortCompleted && state.failedOrdinal === null && state.finishedOrdinal === null).length;
      const nativeIssues = [...native.errors, ...association.issues];
      const nativeVerdicts = association.nativeLog;
      const expectedNativeLogErrors = nativeVerdicts.filter(row => row.classification === "expected").length;
      const pendingNativeLogErrors = nativeVerdicts.filter(row => row.classification === "pending").length;
      const ambiguousNativeLogErrors = nativeVerdicts.filter(row => row.classification === "ambiguous").length;
      const combinedErrors = associationError && errors.length < caps.errors ? [...errors, associationError] : errors;
      return {
        status: "OWNED_TELEMETRY_DIAGNOSTICS_ONLY", halted: halted || Boolean(associationError),
        counts: { ...raw, expectedConsoleErrors, ambiguousConsoleErrors, pendingConsole,
          unexpectedConsoleErrors: raw.consoleErrors - expectedConsoleErrors - ambiguousConsoleErrors - pendingConsole,
          ownedExpectedFailures, pendingFailureClassification,
          unexpectedRequestFailures: raw.requestFailures - ownedExpectedFailures - pendingFailureClassification,
          pendingTelemetry, outstandingAbortOperations,
          nativeLogErrors: native.logErrors, expectedNativeLogErrors, pendingNativeLogErrors, ambiguousNativeLogErrors,
          unexpectedNativeLogErrors: native.logErrors - expectedNativeLogErrors - pendingNativeLogErrors - ambiguousNativeLogErrors,
          pendingNativeAssociations: association.pendingNative, nativeIssues: nativeIssues.length,
          runtimeConsoleErrors: native.runtimeConsoleErrors,
          capErrors: raw.capErrors + (associationError ? 1 : 0),
          errorsDropped: raw.errorsDropped + (associationError && errors.length >= caps.errors ? 1 : 0) },
        caps: { ...caps },
        native: { ready: native.ready, closed: native.closed, ownershipSealed: closing, activeRouteTasks: routeTasks.size, mainFrameId: native.mainFrameId,
          requestStarts: native.requestStarts, eventCount: native.eventCount, issues: nativeIssues,
          nonTargetFailureCount: native.nonTargetFailureCount,
          nonTargetFailures: native.nonTargetFailures.map(row => ({ ...row, url: { ...row.url } })),
          requests: native.requests.map(row => ({ ...row })),
          logs: native.logs.map(row => ({ ...row, ...nativeVerdicts.find(verdict => verdict.id === row.id) })),
          runtime: native.runtime.map(row => ({ ...row })) },
        requests: targets.map(requestRecord), failures: failures.map(value => ({ ...requestRecord(value.state), observedFailureOrdinal: value.ordinal })),
        console: consoles.map(value => ({ ...value, ...association.result.get(value.id) })),
        errors: combinedErrors.map(value => ({ ...value })),
        firstError: firstError ? { ...firstError } : associationError,
        lastError: associationError ?? (lastError ? { ...lastError } : null),
        limits: "One public CDP page session: native Log networkRequestId joins Network events; unique full raw-body signatures bridge to actual owned Playwright Requests. Exact public ConsoleMessage timestamp/text/location joins native logs; duplicate signatures or console keys refuse. No private Playwright ID, FIFO, Fetch-domain interception, source override or blanket exception. Runtime error/assert and unsupported frame/worker sources fail. Optional native data must actually exist. Raw counts and unsettled states remain; caller owns terminal assertions and own-session detach. Source proposal until the owner executes it; no live or whole-journey acceptance.",
      };
    },
  });
}
