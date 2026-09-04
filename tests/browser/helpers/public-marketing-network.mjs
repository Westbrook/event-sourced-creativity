// Intended destination: tests/browser/helpers/public-marketing-network.mjs.
// This shares the finite public renderer; it never starts a server/browser.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { localTestOrigin } from "./read-only-network.mjs";

const origin = "http://127.0.0.1:4186";
const marker = "e8-public-marketing-worker-ssr-r1";
const locales = Object.freeze(["en", "fr", "ar", "ja"]);
const profiles = Object.freeze(["generic", "marketers", "hollywood-filmmakers", "indie-filmmakers"]);
const documents = new Map(profiles.flatMap(profile => locales.map(locale => [
  `/welcome${profile === "generic" ? "" : "/" + profile}/${locale}`, { profile, locale },
])));
const hash = value => createHash("sha256").update(value).digest("hex");
const slash = value => value.split(sep).join("/");

export const publicMarketingProvenance = Object.freeze({
  mode: "finite-public-marketing-worker-ssr", version: marker, origin,
  documents: 16, profiles, locales,
  rendering: "Current built Worker fetch renders current source marketing.html for exact public locale/profile GET routes",
  assets: "One exact GET /marketing ASSETS response per SSR call; public source modules and referenced local media use the retained read-only guard",
  authority: "Public illustrative content only; no authenticated principal or successful synthetic application API responses",
  effects: "DB, MEDIA and waitUntil are denied; browser API/write/external/socket requests and Node global fetch are denied by their respective reviewed boundaries",
  browserLocalState: "The real public locale controller may retain its preference in the disposable browser profile",
  limits: "Source-preview renderer and native-browser evidence only; no deployment, production, account, provider, live propagation, approval or AT acceptance",
});

/** Preserve the observation exactly and add explicit public provenance. */
export function publicMarketingEvidence(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { stage: name, publicTransport: publicMarketingProvenance, observation: value };
  }
  if (Object.hasOwn(value, "publicTransport")) throw new Error("Public marketing evidence already owns its provenance key");
  return { ...value, publicTransport: publicMarketingProvenance };
}

// Shared private state keeps the browser static allowlist tied to the same
// finite renderer without exposing those mutable sets through the public API.
async function createPublicMarketingRendererState(baseURL) {
  assert.equal(process.env.FORMA_A11Y_SYNTHETIC_NETWORK, "1", "Public native preparation requires the existing explicit synthetic-network opt-in");
  assert.equal(localTestOrigin(baseURL), origin, "Public native preparation requires exactly 127.0.0.1:4186");
  // Root must preload its existing guard before Playwright and before this
  // deferred Worker import. Browser routes cannot constrain Node global fetch.
  const nodeGuardPath = "/private/tmp/forma-unit-test-no-provider-fetch.mjs";
  const nodeGuardSha256 = "4f2414721313eedd03b8814cc31fa4898de8cf9fcc2017daced55f3e1830853d";
  const nodeGuardBytes = await readFile(nodeGuardPath);
  assert.equal(hash(nodeGuardBytes), nodeGuardSha256, "The reviewed Node no-provider preload changed");
  const guardSource = nodeGuardBytes.toString("utf8").match(/globalThis\.fetch = (async function deniedUnmockedTestFetch\(\) \{[\s\S]*?\n\});/u)?.[1];
  const nodeFetchGuard = globalThis.fetch;
  const preloadPresent = process.execArgv.some((value, index, all) => value === "--import=" + nodeGuardPath || value === "--import" && all[index + 1] === nodeGuardPath);
  assert.ok(preloadPresent && guardSource && typeof nodeFetchGuard === "function"
    && Function.prototype.toString.call(nodeFetchGuard) === guardSource, "Preload the exact reviewed Node fetch guard before any built Worker import");
  const root = new URL("../../../", import.meta.url);
  const rootPath = fileURLToPath(root);
  const htmlURL = new URL("marketing.html", root);
  const workerURL = new URL("dist/server/index.js", root);
  const [htmlBytes, workerBytes, viteEnvPath, mediaEntries] = await Promise.all([
    readFile(htmlURL), readFile(workerURL),
    realpath(new URL("node_modules/vite/dist/client/env.mjs", root)),
    readdir(new URL("public/assets/marketing/", root), { withFileTypes: true }),
  ]);
  const html = htmlBytes.toString("utf8"), htmlSha256 = hash(htmlBytes), workerSha256 = hash(workerBytes);
  // The entry imports other built chunks. Bind the complete current server tree,
  // not only index.js, before importing it and around every public SSR call.
  const readBuiltServerTree = async () => {
    const files = [];
    const visit = async (url, prefix) => {
      const entries = (await readdir(url, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        const path = prefix + entry.name, target = new URL(encodeURIComponent(entry.name) + (entry.isDirectory() ? "/" : ""), url);
        if (entry.isDirectory()) await visit(target, path + "/");
        else { assert.ok(entry.isFile(), "The current built server tree must contain only regular files/directories");
          const bytes = await readFile(target); files.push({ path, bytes: bytes.length, sha256: hash(bytes) }); }
      }
    };
    await visit(new URL("dist/server/", root), "dist/server/");
    assert.ok(files.some(file => file.path === "dist/server/index.js"), "The current built server entry must be included");
    return files;
  };
  const serverTree = await readBuiltServerTree(), serverTreeSha256 = hash(JSON.stringify(serverTree));
  const envRelative = relative(rootPath, viteEnvPath);
  assert.ok(envRelative && !envRelative.startsWith(".." + sep) && envRelative !== "..", "The reviewed Vite env module must remain inside this source root");
  assert.ok(slash(envRelative).startsWith("node_modules/") && slash(envRelative).endsWith("/vite/dist/client/env.mjs"), "Unexpected Vite env module ownership");
  const viteEnvURLs = new Set(["/" + slash(envRelative), "/@fs/" + slash(viteEnvPath).replace(/^\/+/, "")]);
  const sourceModules = new Set([
    "/src/marketing/main.ts", "/src/marketing/profiles.ts", "/src/marketing/marketing.css",
    ...locales.map(locale => `/src/marketing/locales/${locale}.ts`),
    ...profiles.filter(profile => profile !== "generic").flatMap(profile => locales.map(locale => `/src/marketing/profiles/${profile}/${locale}.ts`)),
    "/src/components/design-system/language-picker.ts", "/src/components/design-system/language-picker.css",
    "/src/components/design-system/language-options.ts", "/src/components/design-system/native-dialog.ts",
  ]);
  const currentMedia = new Set(mediaEntries.filter(entry => entry.isFile()).map(entry => "/assets/marketing/" + entry.name));
  const referencedMedia = new Set();
  const denied = [];
  const record = {
    schema: marker, provenance: publicMarketingProvenance,
    source: { html: "marketing.html", htmlSha256, htmlBytes: htmlBytes.length,
      worker: "dist/server/index.js", workerSha256, workerBytes: workerBytes.length,
      workerImport: "Deferred until renderer creation; entry hash and full current dist/server tree identify the built inputs",
      serverTreeSha256, serverTree,
      staticEntry: "Unmodified source HTML references /src/marketing/marketing.css and /src/marketing/main.ts" },
    nodeFetchBoundary: { path: nodeGuardPath, sha256: nodeGuardSha256, preloadPresent,
      functionSourceMatches: true, preImportVerified: true, checks: [],
      attempts: "Existing root guard counts any unmocked global fetch and makes process exit nonzero; root must consume terminal evidence",
      limit: "Exact global-fetch and declared Worker-binding boundary, not an arbitrary Node socket sandbox" },
    allowedDocuments: [...documents].map(([path, value]) => ({ path, ...value })),
    staticPolicy: { sourceModules: [...sourceModules], viteClient: "/@vite/client", viteEnv: [...viteEnvURLs],
      sourceQuery: "Empty, or bounded ?t=13-digit timestamp syntax on enumerated source paths",
      media: "Only safe current public image/video filenames referenced by a successfully rendered document",
      externalFonts: "Denied: the current public graph declares no external font import",
      optimizedDependencies: "No /@id or optimized-dependency wildcard: the current public graph requires none" },
    staticReads: [], ssrCalls: [], denied,
  };
  const unchangedInputs = async phase => {
    assert.equal(globalThis.fetch, nodeFetchGuard, "The exact Node fetch boundary changed during import or SSR");
    const [currentHTML, currentWorker] = await Promise.all([readFile(htmlURL), readFile(workerURL)]);
    assert.equal(hash(currentHTML), htmlSha256, "Source marketing.html changed during the public native run");
    assert.equal(hash(currentWorker), workerSha256, "Built Worker entry changed during the public native run");
    assert.equal(hash(JSON.stringify(await readBuiltServerTree())), serverTreeSha256, "Built Worker transitive server tree changed during the public native run");
    record.nodeFetchBoundary.checks.push({ phase, identityPreserved: true, htmlAndBuiltServerTreeUnchanged: true });
  };
  const currentWorkerURL = new URL(workerURL);
  currentWorkerURL.searchParams.set("public-marketing-sha256", workerSha256);
  const worker = (await import(currentWorkerURL.href)).default;
  assert.equal(typeof worker?.fetch, "function", "A current built Worker fetch export is required");
  await unchangedInputs("after-worker-import");

  const renderDocument = async path => {
    const selected = typeof path === "string" && documents.get(path);
    assert.ok(selected, "Public renderer requires one exact declared document path");
    const item = { method: "GET", origin, path, resourceType: "document" };
    const call = { ...item, ...selected, assets: [], bindingsDenied: [], status: null };
    record.ssrCalls.push(call);
    const denyBinding = name => {
      call.bindingsDenied.push(name);
      denied.push({ ...item, reason: "worker-binding", binding: name });
      throw new Error("Public marketing accessed forbidden Worker binding: " + name);
    };
    try {
      await unchangedInputs("before-worker-SSR");
      const env = {
        get DB() { return denyBinding("DB"); },
        get MEDIA() { return denyBinding("MEDIA"); },
        ASSETS: { async fetch(assetRequest) {
          const assetURL = new URL(assetRequest.url);
          call.assets.push({ origin: assetURL.origin, path: assetURL.pathname, method: assetRequest.method });
          if (assetRequest.method !== "GET" || assetURL.href !== origin + "/marketing" || call.assets.length !== 1) return denyBinding("ASSETS-outside-exact-marketing-GET");
          return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
        } },
      };
      // Browser credentials/headers are deliberately never forwarded to SSR.
      const response = await worker.fetch(new Request(origin + path, { headers: { "accept-language": selected.locale } }), env, {
        waitUntil() { return denyBinding("waitUntil"); },
      });
      call.status = response.status;
      call.routeFamily = response.headers.get("x-forma-route-family");
      call.contentLanguage = response.headers.get("content-language");
      assert.equal(call.status, 200, "Public Worker SSR must return 200");
      assert.equal(call.routeFamily, "marketing", "Public Worker route family changed");
      assert.equal(call.contentLanguage, selected.locale, "Public Worker locale changed");
      assert.match(response.headers.get("content-type") ?? "", /^text\/html(?:;|$)/i);
      assert.equal(response.headers.get("set-cookie"), null, "Public Worker must not issue authentication state");
      assert.deepEqual(call.assets, [{ origin, path: "/marketing", method: "GET" }]);
      assert.deepEqual(call.bindingsDenied, []);
      const rendered = await response.text();
      call.renderedSha256 = hash(rendered);
      call.renderedBytes = Buffer.byteLength(rendered);
      call.referencedMedia = [...new Set([...rendered.matchAll(/\/assets\/marketing\/(?:quiet-coast|glass-meridian|brighter-hour|mercer-midnight)-[a-z0-9-]+\.[a-f0-9]{12}\.(?:avif|webp|jpg|png|mp4)\b/g)].map(match => match[0]))];
      for (const asset of call.referencedMedia) {
        assert.ok(currentMedia.has(asset), "Worker referenced absent public media: " + asset);
        referencedMedia.add(asset);
      }
      if (rendered.includes('content="/og.png"')) referencedMedia.add("/og.png");
      await unchangedInputs("after-worker-SSR");
      call.completed = true;
      // Preserve the actual Worker response headers and exact rendered body.
      return { status: response.status, headers: Object.fromEntries(response.headers), body: rendered, call };
    } catch (error) {
      call.completed = false;
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };
  return { record, renderDocument, sourceModules, viteEnvURLs, referencedMedia, denied };
}

/** Create the same finite renderer used by the browser installer.
 * Importing this helper does not import the Worker or read application files.
 * The caller must preload the existing Node guard before renderer creation.
 */
export async function createPublicMarketingRenderer(baseURL) {
  const { record, renderDocument } = await createPublicMarketingRendererState(baseURL);
  return { record, renderDocument };
}

/** Install AFTER guardReadOnlyNetwork and INSTEAD OF installSyntheticNetwork.
 * Last route runs first. Only reviewed static traffic reaches the retained guard.
 * Importing this helper does not import the Worker or read application files.
 */
export async function installPublicMarketingNetwork(context, baseURL) {
  const { record, renderDocument, sourceModules, viteEnvURLs, referencedMedia, denied } = await createPublicMarketingRendererState(baseURL);

  await context.routeWebSocket("**/*", async socket => {
    const url = new URL(socket.url());
    denied.push({ method: "WEBSOCKET", origin: url.origin, path: url.pathname, reason: "socket" });
    await socket.close({ code: 1008, reason: "No sockets in public marketing native preparation" });
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const item = { method: request.method(), origin: url.origin, path: url.pathname, resourceType: request.resourceType() };
    const reject = async reason => { denied.push({ ...item, reason }); await route.abort("blockedbyclient"); };
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return reject("malformed-path"); }
    if (url.origin !== origin || url.username || url.password || url.hash) return reject("origin-or-credentials");
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === "." || part === "..")
      || /%2f|%5c/i.test(url.pathname)) return reject("noncanonical-path");
    if (request.method() !== "GET") return reject("non-GET");
    // This precedes every fallback, including any mistakenly retained app route.
    if (/^\/api(?:\/|$)/i.test(path) || ["fetch", "xhr", "eventsource", "websocket"].includes(request.resourceType())) return reject("application-transport");
    const headers = await request.allHeaders();
    if (Object.keys(headers).some(name => /^(?:authorization|proxy-authorization|cookie|x-api-key|oai-authenticated-user-.+|cf-access-.+)$/.test(name))) return reject("authentication-header");

    if (request.resourceType() === "document") {
      const selected = documents.get(path);
      if (!selected || path !== url.pathname || url.search || !request.isNavigationRequest()) return reject("undeclared-document");
      let call;
      try {
        const rendered = await renderDocument(path);
        call = rendered.call;
        // Preserve route-fulfillment failure recording as well as SSR failures.
        await route.fulfill({ status: rendered.status, headers: rendered.headers, body: rendered.body });
      } catch (error) {
        if (call) {
          call.completed = false;
          call.error = error instanceof Error ? error.message : String(error);
        }
        return reject("worker-SSR-prerequisite");
      }
      return;
    }

    const moduleQuery = !url.search || /^\?t=\d{13}$/.test(url.search);
    let family = null;
    if (path === url.pathname && sourceModules.has(path) && moduleQuery
      && (request.resourceType() === "script" || path.endsWith(".css") && request.resourceType() === "stylesheet")) family = "public-source";
    else if (path === url.pathname && path === "/@vite/client" && !url.search && request.resourceType() === "script") family = "vite-client";
    else if (path === url.pathname && viteEnvURLs.has(path) && !url.search && request.resourceType() === "script") family = "exact-vite-env";
    else if (path === url.pathname && referencedMedia.has(path) && !url.search
      && (path.endsWith(".mp4") ? request.resourceType() === "media" : request.resourceType() === "image")) family = "referenced-public-media";
    if (!family) return reject("undeclared-static-request");
    record.staticReads.push({ ...item, family, query: url.search || null });
    await route.fallback();
  });
  return record;
}
