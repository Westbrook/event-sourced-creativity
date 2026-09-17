import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

// This runner is opt-in, separately from unrelated accepted leaf suites.
if (process.env.FORMA_MP3_PUBLISHER_BROWSER_APPROVED !== "1") throw Error("Explicit local browser verification authorization required");
const root = fileURLToPath(new URL("../..", import.meta.url));
const evidence = resolve(process.argv[2] ?? `/private/tmp/forma-mp3-publisher-browser-evidence-20260917/run-${Date.now()}`);
const selectedCases = new Set(process.argv.slice(3));
await mkdir(evidence); // preserve every historical run; never overwrite a failure
const sourceFiles = ["src/selected-output-share-client.ts", "src/selected-output-share-media-client.ts",
  "src/components/forma-selected-output-share-review.ts", "src/components/forma-experience-host.ts",
  "src/components/selected-output-share-media-view.ts", "src/model/selected-output-share.ts",
  "src/model/selected-output-share-mp3-contract.ts", "tests/selected-output-share-mp3-browser/fixture.mjs",
  "tests/selected-output-share-mp3-browser/vite.config.mjs", "tests/selected-output-share-mp3-browser/index.html",
  "tests/selected-output-share-mp3-browser/run.mjs", "tests/selected-output-share-mp3-browser/stereo-20-prepared.wav",
  "tests/selected-output-share-mp3-browser/wav-provenance.json", "tests/selected-output-share-browser/vite.config.mjs",
  "tests/model3d-native/vite.config.mjs"];
const pins = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path,
  createHash("sha256").update(await readFile(resolve(root, path))).digest("hex")])));
const before = await pins(), results = [];
const manifest = { syntheticOnly: true, productionCreation: false, physicalDeviceEvidence: false,
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), selectedCases: [...selectedCases], sources: before };
await writeFile(resolve(evidence, "source-before.json"), JSON.stringify(manifest, null, 2) + "\n");
let server, browser;
const publicHash = "eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7";
const snapshot = page => page.locator("#fixture-receipt").textContent().then(JSON.parse);
const host = page => page.locator("forma-selected-output-share-review");
const publish = page => host(page).getByRole("button", { name: "Publish link", exact: true });
async function prepare(page, title = "Synthetic prepared Audio") {
  await expect(host(page).locator("[data-selected-output-share-open]")).toBeVisible();
  assert.equal((await snapshot(page)).counts.preparedFile, 0);
  await host(page).locator("[data-selected-output-share-open]").click();
  await host(page).locator('input[name="share-title"]').fill(title);
  const expiry = await page.evaluate(() => {
    const date = new Date(Date.now() + 3_600_000), pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  await host(page).locator('input[name="share-expiry"]').fill(expiry);
  await host(page).getByRole("button", { name: "Review", exact: true }).click();
  await expect(host(page).locator("[data-selected-media-load]")).toBeVisible();
  await expect(publish(page)).toBeDisabled();
  assert.equal((await snapshot(page)).counts.preparedFile, 0, "opening and preparing never load media");
}
async function ready(page) {
  await expect(publish(page)).toBeEnabled(); await expect(host(page).locator("audio")).toHaveCount(1);
  await expect.poll(async () => (await snapshot(page)).objectUrls[0]?.sha256).toBe(publicHash);
  const media = await host(page).locator("audio").evaluate(element => ({ controls: element.controls, preload: element.preload,
    autoplay: element.autoplay, paused: element.paused, source: element.getAttribute("src") }));
  assert.deepEqual({ ...media, source: "blob:" }, { controls: true, preload: "none", autoplay: false, paused: true, source: "blob:" });
  assert.ok(media.source.startsWith("blob:"));
  const receipt = await snapshot(page); assert.equal(receipt.counts.plays, 0); assert.equal(receipt.activeObjectUrls, 1);
  assert.equal(receipt.objectUrls[0].size, 3528044); assert.equal(receipt.objectUrls[0].type, "audio/wav");
}
async function retired(page) {
  await expect(host(page).locator("audio")).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).activeObjectUrls).toBe(0);
  assert.equal(await publish(page).isVisible() && await publish(page).isEnabled(), false);
}
async function load(page, mode) {
  await page.locator("#fixture-mode").selectOption(mode); await host(page).locator("[data-selected-media-load]").click();
  await expect.poll(async () => (await snapshot(page)).counts.preparedFile).toBeGreaterThan(0);
}
async function run(name, exercise) {
  if (selectedCases.size && !selectedCases.has(name)) return;
  const context = await browser.newContext({ viewport: { width: 1120, height: 900 }, locale: "en-US", colorScheme: "light",
    serviceWorkers: "block", acceptDownloads: false, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage(), network = [], violations = [], errors = [], consoleMessages = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleMessages.push(message.text()); });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); network.push({ url: url.href, type: request.resourceType() });
    if (url.origin !== "http://127.0.0.1:5197" || url.pathname.startsWith("/api/") || /(?:\.mp3|\.wasm|\/decoder)/u.test(url.pathname)) {
      violations.push(url.href); return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  let status = "passed", failure;
  try {
    await page.goto("http://127.0.0.1:5197", { waitUntil: "networkidle" });
    await expect(page.locator("#fixture-status")).toContainText("Ready");
    await exercise(page);
    const receipt = await snapshot(page); assert.equal(receipt.counts.forbidden, 0); assert.equal(receipt.counts.plays, 0);
    assert.deepEqual(violations, []); assert.deepEqual(errors, []);
    for (const request of receipt.requests) {
      assert.match(request.path, /^\/api\/selected-output-shares(?:\/(?:availability|prepare|commit|fixture-mp3-candidate-\d+(?:\/file)?))?$/u);
      if (request.path.endsWith("/file")) assert.deepEqual({ credentials: request.credentials, cache: request.cache,
        redirect: request.redirect, referrerPolicy: request.referrerPolicy, accept: request.accept },
      { credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", accept: "audio/wav" });
    }
  } catch (error) { status = "failed"; failure = error.stack; }
  const receipt = await snapshot(page).catch(() => null);
  try { await page.screenshot({ path: resolve(evidence, name + ".png"), fullPage: true }); }
  catch (error) { status = "failed"; failure = [failure, "Screenshot failed: " + error.stack].filter(Boolean).join("\n"); }
  await writeFile(resolve(evidence, name + ".json"), JSON.stringify({ status, failure, receipt, network, violations, errors, consoleMessages }, null, 2) + "\n");
  results.push({ name, status, failure }); await context.close();
}
try {
  server = await createServer({ configFile: resolve(root, "tests/selected-output-share-mp3-browser/vite.config.mjs") }); await server.listen();
  browser = await chromium.launch({ headless: true });
  await run("complete-hash-and-explicit-publish", async page => {
    await prepare(page); await load(page, "hold-tail");
    assert.equal((await snapshot(page)).counts.bytesDelivered, 32768); await retired(page); await expect(publish(page)).toBeDisabled();
    await page.locator("#fixture-release").click(); await ready(page);
    const beforeLocale = await snapshot(page);
    await page.locator("#fixture-locale").click(); await expect(host(page).locator(".selected-output-share-review")).toHaveAttribute("lang", "ja");
    await page.locator("#fixture-locale").click(); await expect(host(page).locator(".selected-output-share-review")).toHaveAttribute("lang", "en");
    await ready(page); assert.equal((await snapshot(page)).counts.preparedFile, beforeLocale.counts.preparedFile);
    await page.screenshot({ path: resolve(evidence, "complete-hash-ready-player.png"), fullPage: true });
    await publish(page).click(); await expect.poll(async () => (await snapshot(page)).counts.commit).toBe(1);
    await retired(page); assert.equal((await snapshot(page)).counts.preparedFile, 1);
  });
  await run("absent-length-complete-file", async page => { await prepare(page); await load(page, "absent-length"); await ready(page);
    await host(page).locator("[data-selected-output-share-close]").click(); await retired(page); });
  await run("wrong-hash-denied", async page => { await prepare(page); await load(page, "wrong-hash");
    await expect(host(page).locator("[data-selected-media-status]")).toHaveText("File unavailable"); await retired(page); await expect(publish(page)).toBeDisabled();
    assert.equal((await snapshot(page)).counts.commit, 0); assert.equal((await snapshot(page)).counts.urlsCreated, 0); });
  await run("late-source-a-b-a", async page => { await prepare(page); await load(page, "hold-response");
    await page.locator("#fixture-source-b").click(); await page.locator("#fixture-source-a").click();
    await page.locator("#fixture-release").click(); await retired(page);
    await expect.poll(async () => (await snapshot(page)).counts.streamCancels).toBeGreaterThan(0);
    assert.equal((await snapshot(page)).generation, 3); assert.equal((await snapshot(page)).counts.urlsCreated, 0); });
  await run("late-candidate-replacement", async page => { await prepare(page); await load(page, "hold-tail");
    await host(page).locator('input[name="share-title"]').fill("Replacement candidate");
    await host(page).getByRole("button", { name: "Review", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).counts.prepare).toBe(2);
    await expect.poll(async () => (await snapshot(page)).counts.streamCancels).toBeGreaterThan(0);
    await page.locator("#fixture-release").click(); await retired(page); await expect(publish(page)).toBeDisabled();
    assert.equal((await snapshot(page)).counts.urlsCreated, 0, "retired candidate never creates a late preview URL");
    await load(page, "normal"); await ready(page);
    const receipt = await snapshot(page); assert.equal(receipt.counts.preparedFile, 2);
    assert.equal(receipt.requests.filter(request => request.path.endsWith("/file")).at(-1).path, "/api/selected-output-shares/fixture-mp3-candidate-2/file");
    await host(page).locator("[data-selected-output-share-close]").click(); await retired(page); });
  await run("late-expiry-with-clock-rollback", async page => { await prepare(page); await load(page, "hold-tail");
    assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    await page.locator("#fixture-rollback").click();
    await expect.poll(async () => (await snapshot(page)).counts.streamCancels).toBeGreaterThan(0);
    await page.locator("#fixture-release").click(); await retired(page);
    assert.equal((await snapshot(page)).counts.commit, 0); assert.equal((await snapshot(page)).counts.urlsCreated, 0); });
  await run("late-close-response", async page => { await prepare(page); await load(page, "hold-response");
    await host(page).locator("[data-selected-output-share-close]").click(); await page.locator("#fixture-release").click(); await retired(page);
    await expect.poll(async () => (await snapshot(page)).counts.streamCancels).toBeGreaterThan(0);
    assert.equal((await snapshot(page)).counts.urlsCreated, 0); });
  await run("late-disconnect-response", async page => { await prepare(page); await load(page, "hold-response");
    await page.locator("#fixture-disconnect").click(); await page.locator("#fixture-release").click(); await retired(page);
    await expect.poll(async () => (await snapshot(page)).counts.streamCancels).toBeGreaterThan(0);
    await page.locator("#fixture-reconnect").click(); await retired(page); assert.equal((await snapshot(page)).counts.urlsCreated, 0); });
} catch (error) {
  await writeFile(resolve(evidence, "run-failure.json"), JSON.stringify({ error: error.stack, completedCases: results }, null, 2) + "\n");
  throw error;
} finally {
  await browser?.close(); await server?.close();
  const after = await pins(); await writeFile(resolve(evidence, "source-after.json"), JSON.stringify(after, null, 2) + "\n");
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  await writeFile(resolve(evidence, "results.json"), JSON.stringify({ ...manifest, unchanged, results }, null, 2) + "\n");
  assert.equal(unchanged, true, "Source changed during browser verification");
}
console.log(JSON.stringify({ evidence, results: results.map(({ name, status }) => ({ name, status })) }, null, 2));
assert.ok(results.length === (selectedCases.size || 8) && results.every(result => result.status === "passed"), "Every selected bounded browser case must pass");
