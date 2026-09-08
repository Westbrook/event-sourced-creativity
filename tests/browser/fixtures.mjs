import { test as base, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guardReadOnlyNetwork } from "./helpers/read-only-network.mjs";
import { installSyntheticNetwork, syntheticNetworkEnabled, syntheticNetworkProvenance, syntheticEvidence } from "./helpers/synthetic-network.mjs";

import { installPublicMarketingNetwork, publicMarketingProvenance, publicMarketingEvidence } from "./helpers/public-marketing-network.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(directory, "zoom-extension");
const captureSessions = new WeakMap();

export const test = base.extend({
  geometry: [{ viewport: { width: 1280, height: 900 }, zoom: 1 }, { option: true }],
  publicMarketing: [false, { option: true }],
  publicJavaScript: [true, { option: true }],
  acceptDownloads: [false, { option: true }],
  context: async ({ geometry, baseURL, publicMarketing, publicJavaScript, acceptDownloads }, use, testInfo) => {
    const admittedDownloadCase = testInfo.project.name === "story-revision-download"
      && testInfo.title === "Story revision one: approved synthetic source downloads the exact Markdown file";
    if (acceptDownloads === true && !admittedDownloadCase)
      throw new Error("Downloads require the exact admitted project and positive test title");
    const synthetic = syntheticNetworkEnabled(baseURL);
    const profile = await mkdtemp(resolve(tmpdir(), "forma-a11y-"));
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: process.env.FORMA_A11Y_HEADED !== "1",
        viewport: geometry.viewport,
        baseURL,
        locale: geometry.locale ?? "en-US",
        ...(publicMarketing ? { javaScriptEnabled: publicJavaScript } : {}),
        ...(geometry.hasTouch === true ? { hasTouch: true } : {}),
        serviceWorkers: "block",
        acceptDownloads: acceptDownloads === true,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          ...(geometry.window ? [`--window-size=${geometry.window.width},${geometry.window.height}`] : []),
        ],
      });
      const network = await guardReadOnlyNetwork(context, baseURL);
      const publicNetwork = publicMarketing ? await installPublicMarketingNetwork(context, baseURL) : null;
      const syntheticNetwork = synthetic && !publicMarketing ? await installSyntheticNetwork(context, baseURL) : null;
      if (syntheticNetwork) testInfo.annotations.push({ type: "synthetic-network", description: syntheticNetworkProvenance.authority });
      if (publicNetwork) testInfo.annotations.push({ type: "public-marketing-network", description: publicMarketingProvenance.authority });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      try {
        await use(context);
      } finally {
        // Trace every run: successful focus/zoom evidence is useful to review too.
        const tracePath = testInfo.outputPath("trace.zip");
        await context.tracing.stop({ path: tracePath });
        await testInfo.attach("browser-trace", { path: tracePath, contentType: "application/zip" });
        if (testInfo.status !== testInfo.expectedStatus) {
          const page = context.pages()[0];
          if (page && !page.isClosed()) {
            await captureViewport(page, testInfo, "failure", { assertStable: false });
          }
        }
        await context.close();
        context = null;
        await testInfo.attach("read-only-network", { body: JSON.stringify(publicNetwork ? publicMarketingEvidence("read-only-network", network) : syntheticNetwork ? syntheticEvidence("read-only-network", network) : network, null, 2), contentType: "application/json" });
        if (publicNetwork) {
          await testInfo.attach("public-marketing-network", { body: JSON.stringify(publicNetwork, null, 2), contentType: "application/json" });
          expect(publicNetwork.denied, "Public SSR must not attempt private APIs, bindings, writes, unreviewed static traffic or sockets").toEqual([]);
          expect(publicNetwork.ssrCalls.length, "Public entry must be served by the actual current Worker SSR seam").toBeGreaterThan(0);
          expect(publicNetwork.ssrCalls.every(call => call.completed && call.status === 200 && call.assets.length === 1 && call.bindingsDenied.length === 0)).toBe(true);
        }
        if (syntheticNetwork) {
          await testInfo.attach("synthetic-network", { body: JSON.stringify(syntheticNetwork, null, 2), contentType: "application/json" });
          expect(syntheticNetwork.forbidden, "Finite synthetic mode must not attempt undeclared APIs, writes or sockets").toEqual([]);
        }
        expect(network.forbidden, "UI checks must not attempt writes or unreviewed external requests").toEqual([]);
      }
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? await context.newPage();
    await use(page);
  },
});

export { expect };

export async function attachJSON(testInfo, name, value) {
  const labeled = testInfo.project.use.publicMarketing === true ? publicMarketingEvidence(name, value)
    : syntheticNetworkEnabled(testInfo.project.use.baseURL) ? syntheticEvidence(name, value) : value;
  await testInfo.attach(name, { body: JSON.stringify(labeled, null, 2), contentType: "application/json" });
}

export async function browserMetrics(page) {
  return page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    outerWidth, outerHeight, dpr: devicePixelRatio,
    visualScale: visualViewport?.scale ?? null,
    visualWidth: visualViewport?.width ?? null,
    documentWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));
}

/** Capture the owned browser's whole physical viewport, without a CSS-pixel clip. */
export async function captureViewport(page, testInfo, name, { assertStable = true } = {}) {
  let session = captureSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    captureSessions.set(page, session);
  }
  const focused = await page.evaluateHandle(() => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  });
  try {
    const before = await browserMetrics(page);
    // Playwright's CSS-pixel screenshot clip can crop a genuinely zoomed tab.
    // No clip/emulation override, full-page scroll, focus, or viewport mutation.
    const { data } = await session.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: false,
    });
    const body = Buffer.from(data, "base64");
    const png = body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const dimensions = png && body.length >= 24
      ? { width: body.readUInt32BE(16), height: body.readUInt32BE(20) } : null;
    const after = await browserMetrics(page);
    const focusUnchanged = await page.evaluate(previous => {
      let element = document.activeElement;
      while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      return element === previous;
    }, focused);
    // innerWidth/Height round to CSS pixels; the physical surface can retain a
    // fractional CSS edge. Permit only that single-pixel rounding per axis.
    const tolerance = Math.ceil(before.dpr);
    const completeViewport = Boolean(dimensions
      && Math.abs(dimensions.width - before.width * before.dpr) <= tolerance
      && Math.abs(dimensions.height - before.height * before.dpr) <= tolerance);
    await attachJSON(testInfo, `${name}-capture`, {
      mechanism: "owned-context CDP Page.captureScreenshot without clip",
      before, after, dimensions, tolerance, completeViewport, focusUnchanged,
    });
    await testInfo.attach(`${name}-screenshot`, { body, contentType: "image/png" });
    if (assertStable) {
      expect(completeViewport, "Capture must include the complete physical browser viewport").toBe(true);
      expect(after, "Capturing evidence must not change layout or browser zoom").toEqual(before);
      expect(focusUnchanged, "Capturing evidence must leave native focus unchanged").toBe(true);
    }
    return { dimensions, completeViewport, focusUnchanged };
  } finally {
    await focused.dispose();
  }
}

/** API read-back AND actual layout changes; never substitute pinch scale or CSS zoom. */
export async function applyBrowserZoom(page, context, factor, testInfo) {
  let worker = context.serviceWorkers().find(item => item.url().startsWith("chrome-extension://"));
  worker ??= await context.waitForEvent("serviceworker", { predicate: item => item.url().startsWith("chrome-extension://"), timeout: 15_000 });
  const command = async zoom => worker.evaluate(
    async input => globalThis.formaTestBrowserZoom(input), { url: page.url(), factor: zoom });
  const reset = await command(1);
  await expect.poll(async () => (await browserMetrics(page)).visualScale).toBe(1);
  const before = await browserMetrics(page);
  const result = await command(factor);
  await expect.poll(async () => (await browserMetrics(page)).dpr).toBeCloseTo(before.dpr * factor, 5);
  const after = await browserMetrics(page);
  await attachJSON(testInfo, `browser-zoom-${factor * 100}`, { mechanism: "chrome.tabs.setZoom", reset, result, before, after });
  expect(reset.factor).toBe(1);
  expect(result.factor).toBe(factor);
  expect(result.settings).toMatchObject({ mode: "automatic", scope: "per-tab" });
  expect(result.url).toBe(page.url());
  expect(after.visualScale, "pinch/visual scaling is not desktop browser zoom").toBe(1);
  expect(Math.abs(after.width * factor - before.width)).toBeLessThanOrEqual(factor);
  expect(Math.abs(after.height * factor - before.height)).toBeLessThanOrEqual(factor);
  expect(after.dpr / before.dpr).toBeCloseTo(factor, 5);
  return { before, after, result };
}

export async function openForma(page, context, geometry, path, testInfo) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), syntheticNetworkEnabled(testInfo.project.use.baseURL)
    ? "Reuse the actual source application with explicitly synthetic network declarations"
    : "Reuse a running, built Forma preview with its existing local account/data").toBe(true);
  await expect(page.locator("forma-shell")).toBeAttached();
  const language = geometry.locale ?? "en-US";
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await page.evaluate(() => document.fonts.ready);
  const readTypeface = () => page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const normalize = value => value.split(",").map(family => family.trim().replace(/^["']|["']$/g, "")).join(", ");
    return {
      language: document.documentElement.lang, direction: document.documentElement.dir,
      bodyFont: normalize(getComputedStyle(document.body).fontFamily),
      sansToken: normalize(root.getPropertyValue("--sans")),
      fontFamilyToken: normalize(root.getPropertyValue("--forma-font-family")),
      manropeLoaded: [...document.fonts].some(face => face.family.replace(/["']/g, "") === "Manrope" && face.status === "loaded"),
    };
  });
  const arabic = language.split("-")[0] === "ar";
  const japanese = language.split("-")[0] === "ja";
  const readJapanesePolicy = () => page.evaluate(() => {
    const expectedSelector = ":root:lang(ja), forma-ui-locale:lang(ja)";
    const normalize = value => value.split(",").map(family => family.trim().replace(/^["']|["']$/g, "")).join(", ");
    const declarations = [], errors = [];
    for (const sheet of document.styleSheets) {
      const viteSource = sheet.ownerNode?.getAttribute("data-vite-dev-id") ?? null;
      const href = sheet.href ? new URL(sheet.href, location.href) : null;
      const sourceOwner = sheet.ownerNode instanceof HTMLStyleElement && !href && Boolean(viteSource?.endsWith("/src/styles.css"))
        || sheet.ownerNode instanceof HTMLLinkElement && href?.origin === location.origin
          && href.pathname === "/src/styles.css" && !href.search && !href.hash;
      if (!sourceOwner) continue;
      try {
        for (const rule of sheet.cssRules) {
          if (rule.type !== CSSRule.STYLE_RULE || rule.selectorText !== expectedSelector) continue;
          declarations.push({ owner: sheet.href ?? viteSource, selector: rule.selectorText,
            sans: normalize(rule.style.getPropertyValue("--sans")), family: rule.style.getPropertyValue("--forma-font-family").trim(),
            sansPriority: rule.style.getPropertyPriority("--sans"), familyPriority: rule.style.getPropertyPriority("--forma-font-family") });
        }
      } catch (error) { errors.push(String(error)); }
    }
    return { declarations, errors, fontsStatus: document.fonts.status,
      declaredStackAvailable: document.fonts.check(`16px ${getComputedStyle(document.body).fontFamily}`, "日本語 ドキュメント名 フィルターをクリア") };
  });
  if (arabic) {
    // The actual Arabic policy in styles.css deliberately uses system fonts.
    // RTL alone or an empty FontFaceSet must never exempt another locale.
    const systemStack = "ui-sans-serif, system-ui, sans-serif";
    await expect.poll(readTypeface, {
      message: "Arabic layout requires the real Arabic locale and its declared system-font policy",
    }).toMatchObject({ language, direction: "rtl", bodyFont: systemStack, sansToken: systemStack, fontFamilyToken: systemStack });
  } else if (japanese) {
    // A positive source-declared Japanese stack and settled font set are required;
    // neither an empty FontFaceSet nor absence of Manrope creates an exemption.
    const japaneseStack = "Hiragino Sans, Yu Gothic, Noto Sans CJK JP, ui-sans-serif, system-ui, sans-serif";
    await expect.poll(readTypeface, {
      message: "Japanese layout requires the actual Japanese locale and selected source-declared stack",
    }).toMatchObject({ language, direction: "ltr", bodyFont: japaneseStack, sansToken: japaneseStack, fontFamilyToken: japaneseStack });
    await expect.poll(readJapanesePolicy, {
      message: "Japanese layout requires the current styles.css policy and a ready, available declared font stack",
    }).toMatchObject({ errors: [], fontsStatus: "loaded", declaredStackAvailable: true,
      declarations: [{ selector: ":root:lang(ja), forma-ui-locale:lang(ja)", sans: japaneseStack,
        family: "var(--sans)", sansPriority: "", familyPriority: "" }] });
    await attachJSON(testInfo, "application-japanese-typeface-source", {
      ...await readJapanesePolicy(),
      limit: "FontFaceSet.check covers availability of the declared stack, including permitted system fallback; it does not identify the face used for each glyph or prove a particular installed Hiragino font.",
    });
  } else {
    await expect.poll(async () => {
      const typeface = await readTypeface();
      return typeface.manropeLoaded && typeface.bodyFont.split(",")[0] === "Manrope";
    }, {
      message: "Layout checks require the application's loaded and selected Manrope typeface, not a silent fallback",
    }).toBe(true);
  }
  await attachJSON(testInfo, "application-typeface", {
    policy: arabic ? "declared-arabic-system-font-stack" : japanese ? "declared-japanese-system-font-stack" : "loaded-and-selected-manrope",
    expectedLanguage: language, ...await readTypeface(),
    limits: "Computed font policy is not platform glyph, contrast, or assistive-technology conformance.",
  });
  await applyBrowserZoom(page, context, geometry.zoom, testInfo);
  if (geometry.viewport) {
    const metrics = await browserMetrics(page);
    expect(metrics.width).toBe(geometry.viewport.width);
    expect(metrics.height).toBe(geometry.viewport.height);
  }
  await expect(page.locator(".consent-modal:modal"), "Complete normal local onboarding separately; this read-only suite does not accept terms").toHaveCount(0);
  await attachJSON(testInfo, "application-assets", await page.evaluate(() => ({
    url: location.href, language: document.documentElement.lang, direction: document.documentElement.dir,
    scripts: [...document.scripts].map(script => script.src).filter(Boolean),
    stylesheets: [...document.styleSheets].map(sheet => sheet.href).filter(Boolean),
    bodyFont: getComputedStyle(document.body).fontFamily,
    fonts: [...document.fonts].map(face => ({ family: face.family, weight: face.weight, status: face.status })),
  })));
}


/** Explicit public admission. Keep openForma's Shell/account/typeface assertions
 * unchanged; a public source document is a different real route owner. */
export async function openPublicMarketing(page, context, geometry, profile, locale, testInfo, { enhanced = true } = {}) {
  const profiles = ["generic", "marketers", "hollywood-filmmakers", "indie-filmmakers"];
  expect(testInfo.project.use.publicMarketing, "Only the explicit public project may use this admission").toBe(true);
  expect(profiles).toContain(profile); expect(["en", "fr", "ar", "ja"]).toContain(locale);
  const path = `/welcome${profile === "generic" ? "" : "/" + profile}/${locale}`;
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "Current built Worker SSR must serve this exact public GET").toBe(200);
  expect(response?.headers()["x-forma-route-family"]).toBe("marketing");
  expect(response?.headers()["content-language"]).toBe(locale);
  expect(new URL(page.url()).origin).toBe("http://127.0.0.1:4186");
  expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  await expect(page.locator("body")).toHaveAttribute("data-marketing-profile", profile);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", path);
  await expect(page.locator("forma-shell,.consent-modal")).toHaveCount(0);
  await expect(page.locator("details[data-public-change-demo]")).toHaveCount(1);
  await expect(page.locator("details[data-output-preview]")).toHaveCount(4);
  await expect(page.locator("dialog[data-marketing-preview-dialog]")).toHaveCount(1);
  if (enhanced) {
    await expect(page.locator("html")).toHaveAttribute("data-forma-experience", "marketing");
    await expect(page.locator("[data-language-picker] forma-ui-language-picker select")).toHaveValue(locale);
    await expect(page.locator("[data-language-picker] forma-ui-language-picker select")).toBeEnabled();
    // The top-level marker precedes catalog loading. These actual controller
    // attributes positively witness the completed preview initialization.
    for (const kind of ["story", "presentation"]) {
      await expect(page.locator(`[data-public-change-demo] a[data-demo-preview="${kind}"]`)).toHaveAttribute("aria-controls", "marketing-preview");
      await expect(page.locator(`[data-public-change-demo] a[data-demo-preview="${kind}"]`)).toHaveAttribute("aria-haspopup", "dialog");
    }
  } else {
    await expect(page.locator("html")).not.toHaveAttribute("data-forma-experience", "marketing");
    await expect(page.locator("[data-language-picker] forma-ui-language-picker")).toHaveCount(0);
    await expect(page.locator(".marketing-language__trigger[popovertarget=marketing-language-menu]")).toHaveCount(1);
    await expect(page.locator("[data-public-change-demo] a[aria-controls]")).toHaveCount(0);
  }
  await page.evaluate(() => document.fonts.ready);
  const stack = locale === "ar" ? "Geeza Pro, Noto Naskh Arabic, Tahoma, ui-sans-serif, system-ui, sans-serif"
    : locale === "ja" ? "Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, ui-sans-serif, system-ui, sans-serif"
      : "Manrope, ui-sans-serif, system-ui, sans-serif";
  const fontSelector = locale === "ar" ? "html:lang(ar)" : locale === "ja" ? "html:lang(ja)" : ":root";
  const readFont = () => page.evaluate(({ selector, sample }) => {
    const normalize = value => value.split(",").map(family => family.trim().replace(/^["']|["']$/g, "")).join(", ");
    const declarations = [], errors = [];
    for (const sheet of document.styleSheets) {
      const vite = sheet.ownerNode?.getAttribute("data-vite-dev-id") ?? null;
      const href = sheet.href ? new URL(sheet.href, location.href) : null;
      const sourceOwner = sheet.ownerNode instanceof HTMLStyleElement && !href && Boolean(vite?.endsWith("/src/marketing/marketing.css"))
        || sheet.ownerNode instanceof HTMLLinkElement && href?.origin === location.origin && href.pathname === "/src/marketing/marketing.css" && !href.search && !href.hash;
      if (!sourceOwner) continue;
      try { for (const rule of sheet.cssRules) {
        if (rule.type !== CSSRule.STYLE_RULE || rule.selectorText !== selector || !rule.style.getPropertyValue("--marketing-font")) continue;
        declarations.push({ owner: sheet.href ?? vite, selector: rule.selectorText, stack: normalize(rule.style.getPropertyValue("--marketing-font")), priority: rule.style.getPropertyPriority("--marketing-font") });
      } } catch (error) { errors.push(String(error)); }
    }
    return { language: document.documentElement.lang, direction: document.documentElement.dir,
      token: normalize(getComputedStyle(document.documentElement).getPropertyValue("--marketing-font")),
      body: normalize(getComputedStyle(document.body).fontFamily), fontsStatus: document.fonts.status,
      declaredStackAvailable: document.fonts.check(`16px ${getComputedStyle(document.body).fontFamily}`, sample), declarations, errors,
      fontFaces: [...document.fonts].map(face => ({ family: face.family, weight: face.weight, status: face.status })) };
  }, { selector: fontSelector, sample: locale === "ar" ? "مثال افتراضي المراجعة" : locale === "ja" ? "架空の例 レビュー" : "Illustrative décision review" });
  await expect.poll(readFont, { message: "Public geometry requires the actual marketing CSS declaration, selected stack and settled available fonts" }).toMatchObject({
    language: locale, direction: locale === "ar" ? "rtl" : "ltr", token: stack, body: stack,
    fontsStatus: "loaded", declaredStackAvailable: true, errors: [], declarations: [{ selector: fontSelector, stack, priority: "" }],
  });
  await attachJSON(testInfo, "public-typeface", { ...await readFont(),
    limit: "The public stylesheet declares system fallback and imports no webfont. This witnesses its exact selected stack/availability, not a loaded Manrope or per-glyph face, contrast or AT conformance." });
  await applyBrowserZoom(page, context, geometry.zoom, testInfo);
  if (geometry.viewport) {
    const metrics = await browserMetrics(page); expect(metrics.width).toBe(geometry.viewport.width); expect(metrics.height).toBe(geometry.viewport.height);
  }
  await attachJSON(testInfo, "public-admission", { profile, locale, path, enhanced,
    ...await page.evaluate(() => ({ url: location.href, scripts: [...document.scripts].map(script => script.src).filter(Boolean),
      stylesheets: [...document.styleSheets].map(sheet => sheet.href ?? sheet.ownerNode?.getAttribute("data-vite-dev-id")).filter(Boolean),
      title: document.title, hero: document.querySelector("h1")?.textContent,
      primaryCTA: document.querySelector(".marketing-header__actions > a.marketing-button--header")?.getAttribute("href") })),
    boundary: "Actual public Worker SSR plus unmodified source client, explicit finite ASSETS; no account, backend authorization, completed generation or publication evidence." });
}
