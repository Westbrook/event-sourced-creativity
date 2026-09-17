// Run: node tests/browser/forma-image-400.mjs
// Only the ordinary Image setup fixture at genuine 400% browser zoom. This is
// synthetic software evidence, not sponsorship, physical input or AT coverage.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer, version as viteVersion } from "vite";
import sourceConfig from "../experience-display-browser/vite.config.mjs";
import { applyBrowserZoom, captureViewport, expect } from "./fixtures.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const output = process.env.FORMA_IMAGE400_OUTPUT
  ? resolve(process.env.FORMA_IMAGE400_OUTPUT) : await mkdtemp(resolve(tmpdir(), "forma-image400-evidence-"));
await mkdir(output, { recursive: true });
const runtime = await mkdtemp(resolve(tmpdir(), "forma-image400-runtime-"));
const port = Number(process.env.FORMA_IMAGE400_PORT ?? "59385");
assert.ok(Number.isInteger(port) && port > 1023 && port < 65536, "Use a dedicated unprivileged loopback port");
const baseURL = `http://127.0.0.1:${port}`;
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const receipt = { startedAt: new Date().toISOString(), root, head: git("rev-parse", "HEAD"),
  sourceStatus: git("status", "--short"), node: process.version, vite: viteVersion, baseURL, csp,
  scope: "English ordinary Image setup, synthetic native 400% desktop zoom only",
  requests: [], forbidden: [], sockets: [], pageErrors: [], consoleErrors: [], captures: [], keyboard: [] };
const testInfo = { project: { use: { baseURL } }, outputPath: name => resolve(output, name),
  async attach(name, { body, contentType }) {
    const path = resolve(output, `${name}.${contentType === "image/png" ? "png" : "json"}`);
    await writeFile(path, body); receipt.captures.push({ name, path });
  } };
let server, context, page, tracing = false;
const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const focused = () => page.evaluate(() => {
  let element = document.activeElement;
  while (element.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  const rect = element.getBoundingClientRect(), hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
  return { tag: element.tagName, id: element.id, text: (element.getAttribute("aria-label") || element.labels?.[0]?.textContent || element.textContent).trim().replace(/\s+/g, " "),
    rect: rect.toJSON(), invalid: element.getAttribute("aria-invalid"), scrollY,
    viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport?.width, visualHeight: visualViewport?.height, dpr: devicePixelRatio },
    // Retain the prior 1 CSS px edge tolerance for native zoomed layout;
    // complete control-border and focus-outline paint are not accepted here.
    visibilityToleranceCssPx: 1,
    visible: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
    unobscured: hit === element || element.contains(hit) || Boolean(hit?.contains(element)) };
});
async function tabToReview(stage) {
  const steps = []; receipt.keyboard.push({ stage, steps });
  for (let step = 0; step < 50; step++) {
    await page.keyboard.press("Tab"); await frame();
    await expect.poll(async () => { const active = await focused(); return active.visible && active.unobscured; }, { timeout: 2000 }).toBe(true);
    const active = await focused(); steps.push(active); assert.notEqual(active.tag, "BODY");
    if (active.tag === "BUTTON" && active.text === "Review") return;
  }
  assert.fail("Native Tab did not reach Review");
}
try {
  // Preserve the reviewed Vite version/hash guard and tooling-client transform.
  // Exclude all application Worker/Sites plugins and unrelated fixture scans.
  server = await createServer({ ...sourceConfig, configFile: false, publicDir: false,
    cacheDir: resolve(runtime, "vite-cache"), optimizeDeps: { entries: ["tests/experience-display-browser/index.html"] },
    server: { ...sourceConfig.server, port, strictPort: true,
      headers: { "Content-Security-Policy": csp, "Referrer-Policy": "no-referrer" } } });
  await server.listen();
  const extension = fileURLToPath(new URL("./zoom-extension", import.meta.url));
  context = await chromium.launchPersistentContext(resolve(runtime, "profile"), {
    channel: "chromium", headless: true, viewport: null, locale: "en-US",
    serviceWorkers: "block", acceptDownloads: false, timeout: 20000,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--window-size=1280,1000"] });
  receipt.browser = context.browser().version();
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const item = { method: request.method(), origin: url.origin, path: url.pathname, type: request.resourceType() };
    if (url.origin === baseURL && ["GET", "HEAD"].includes(item.method) && !url.pathname.startsWith("/api/")) {
      receipt.requests.push(item); await route.continue();
    } else { receipt.forbidden.push(item); await route.abort("blockedbyclient"); }
  });
  await context.routeWebSocket("**/*", socket => { receipt.sockets.push(socket.url()); socket.close(); });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  tracing = true;
  page = context.pages()[0]; page.setDefaultTimeout(10000);
  page.on("pageerror", error => receipt.pageErrors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") receipt.consoleErrors.push(message.text()); });
  assert.equal((await page.goto(`${baseURL}/experiences/image`, { waitUntil: "networkidle", timeout: 20000 })).status(), 200);
  await page.evaluate(() => document.fonts.ready);
  receipt.zoom = await applyBrowserZoom(page, context, 4, testInfo); await frame();
  await captureViewport(page, testInfo, "400-initial");
  await tabToReview("setup"); await captureViewport(page, testInfo, "400-review-focus");
  assert.ok(receipt.keyboard[0].steps.some(step => step.id === "experience-subject"));
  await page.keyboard.press("Enter"); await frame();
  receipt.errorFocus = await focused();
  assert.equal(receipt.errorFocus.id, "experience-subject"); assert.equal(receipt.errorFocus.invalid, "true");
  assert.ok(receipt.errorFocus.visible && receipt.errorFocus.unobscured);
  receipt.required = await page.locator("#experience-subject-error").evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { text: element.textContent, rect: rect.toJSON(), visible: rect.top >= 0 && rect.bottom <= innerHeight };
  });
  assert.equal(receipt.required.text, "Required"); assert.equal(receipt.required.visible, true);
  await captureViewport(page, testInfo, "400-required-error-focus");
  await tabToReview("required-errors"); await captureViewport(page, testInfo, "400-errors-review-focus");
  receipt.layout = await page.locator("#experience-root").evaluate(root => ({
    clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    clippedText: [...root.querySelectorAll("h1,h2,label,legend,.experience-error,button,p")].filter(element => {
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return false;
      const range = document.createRange(); range.selectNodeContents(element);
      return [...range.getClientRects()].some(text => text.left < rect.left - 1 || text.right > rect.right + 1)
        || element.scrollWidth > element.clientWidth + 1;
    }).map(element => ({ tag: element.tagName, text: element.textContent })) }));
  assert.equal(receipt.layout.scrollWidth, receipt.layout.clientWidth); assert.deepEqual(receipt.layout.clippedText, []);
  receipt.fixture = { entryMode: await page.locator("#fixture-mode-reads").textContent(),
    catalog: await page.locator("#fixture-reads").textContent(), forbidden: await page.locator("#fixture-blocked").textContent() };
  assert.deepEqual(receipt.fixture, { entryMode: "1 ordinary entry-mode reads", catalog: "1 catalog reads", forbidden: "0 forbidden requests" });
  assert.deepEqual(receipt.forbidden, []); assert.deepEqual(receipt.sockets, []);
  assert.deepEqual(receipt.pageErrors, []); assert.deepEqual(receipt.consoleErrors, []);
  receipt.status = "pass";
} catch (error) {
  receipt.status = "failed"; receipt.error = { message: String(error), stack: error.stack }; process.exitCode = 1;
  if (page && !page.isClosed()) {
    try { await captureViewport(page, testInfo, "failure", { assertStable: false }); receipt.failureFocus = await focused(); }
    catch (captureError) { receipt.captureError = String(captureError); }
  }
} finally {
  const files = new Set([fileURLToPath(import.meta.url), resolve(root, "package.json"), resolve(root, "pnpm-lock.yaml"),
    resolve(root, "tests/browser/fixtures.mjs"), resolve(root, "tests/browser/zoom-extension/background.js"),
    resolve(root, "tests/browser/zoom-extension/manifest.json"), resolve(root, "tests/experience-display-browser/vite.config.mjs"),
    resolve(root, "tests/experience-display-browser/index.html"), resolve(root, "tests/experience-display-browser/fixture.mjs"),
    resolve(root, "tests/model3d-native/vite.config.mjs"), ...(server ? [...server.environments.client.moduleGraph.idToModuleMap.values()].map(module => module.file).filter(Boolean) : [])]);
  receipt.sourcePins = []; receipt.finalizationErrors = [];
  const failedFinalization = (stage, error) => {
    receipt.finalizationErrors.push({ stage, error: String(error) }); receipt.status = "failed"; process.exitCode = 1;
  };
  for (const path of [...files].sort()) {
    try { const bytes = await readFile(path); receipt.sourcePins.push({ path, bytes: bytes.length, sha256: sha256(bytes) }); }
    catch (error) { failedFinalization(`source pin: ${path}`, error); }
  }
  for (const [stage, close] of [
    ["trace", () => tracing ? context.tracing.stop({ path: resolve(output, "trace.zip") }) : undefined],
    ["browser", () => context?.close()], ["server", () => server?.close()],
    ["temporary runtime", () => rm(runtime, { recursive: true, force: true })],
  ]) { try { await close(); } catch (error) { failedFinalization(stage, error); } }
  try { receipt.afterHead = git("rev-parse", "HEAD"); receipt.afterStatus = git("status", "--short"); }
  catch (error) { failedFinalization("final source identity", error); }
  receipt.endedAt = new Date().toISOString();
  await writeFile(resolve(output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, output, head: receipt.head, error: receipt.error?.message }));
}
