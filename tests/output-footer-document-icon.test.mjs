import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  JA_FOOTER_ICON_POLICY, JA_FOOTER_DOCUMENT_URL, JA_FOOTER_ICON_SVG, JA_FOOTER_ICON_HREF,
  prepareJapaneseFooterDocument, installJapaneseFooterIconPolicy,
} from "./browser/helpers/ja-footer-document-icon.mjs";

// SOURCE-ONLY proposal for tests/output-footer-document-icon.test.mjs.
// Compose the flat packet at its declared paths before any authorized unit run.
// These byte and route doubles do not prove favicon behavior in a browser.
const baseURL = "http://127.0.0.1:4186";
const documentURL = baseURL + "/document/doc-atmosphere/atmosphere-studies";
const declaredPolicy = "ja-footer-inert-icon-v1";
const literalSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';
const literalHref = "data:image/svg+xml," + encodeURIComponent(literalSvg);
const literalLink = `    <link rel="icon" type="image/svg+xml" href="${literalHref}" data-forma-footer-icon-policy="ja-footer-inert-icon-v1" />\n`;
const sourceText = '<!doctype html>\n<html lang="ja">\n  <head>\n    <meta charset="utf-8" />\n    <script type="module" src="/assets/app.js"></script>\n    <link rel="stylesheet" href="/assets/app.css" />\n  </head>\n  <body><main>日本語の本文</main><script>window.fixture = "unchanged";</script></body>\n</html>\n';
const pin = bytes => ({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
const clone = value => structuredClone(value);

function fixture(text = sourceText) {
  const source = Buffer.from(text, "utf8");
  // Independent fixed insertion: never call prepare() to derive its expected pin.
  const expected = Buffer.from(text.replace("  </head>", literalLink + "  </head>"), "utf8");
  return { source, expected, binding: { policy: declaredPolicy, source: pin(source), response: pin(expected) } };
}

function iconRouteDouble({ unrouteError = null, fulfill = async () => {}, abort = async () => {} } = {}) {
  const routes = [], calls = { registered: [], removed: [], fulfilled: [], aborted: [] };
  const context = {}, page = {}, frame = { page: () => page };
  page.context = () => context;
  page.url = () => "about:blank";
  page.mainFrame = () => frame;
  context.route = async (pattern, handler) => {
    calls.registered.push({ pattern, handler });
    routes.push({ pattern, handler });
  };
  context.unroute = async (pattern, handler) => {
    calls.removed.push({ pattern, handler });
    if (unrouteError) throw unrouteError;
    const index = routes.findIndex(row => row.pattern === pattern && row.handler === handler);
    if (index !== -1) routes.splice(index, 1);
  };
  const request = (overrides = {}) => ({ url: () => documentURL, method: () => "GET",
    resourceType: () => "document", frame: () => frame, ...overrides });
  const invoke = async (actualRequest = request()) => {
    const row = calls.registered.find(value => value.pattern === documentURL);
    assert.ok(row, "The policy registers its literal document URL");
    return row.handler({ request: () => actualRequest,
      fulfill: async value => { calls.fulfilled.push(value); await fulfill(value); },
      abort: async code => { calls.aborted.push(code); await abort(code); },
      fallback: async () => { assert.fail("This exact document policy must never fall through"); } });
  };
  const dispatchExact = async actualRequest => {
    const row = routes.find(value => value.pattern === actualRequest.url());
    if (!row) return "unmatched";
    await invoke(actualRequest);
    return "handled";
  };
  return { context, page, frame, routes, calls, request, invoke, dispatchExact };
}

async function installDouble(rig, input = fixture()) {
  const previous = process.env.FORMA_A11Y_SYNTHETIC_NETWORK;
  try {
    process.env.FORMA_A11Y_SYNTHETIC_NETWORK = "1";
    return await installJapaneseFooterIconPolicy(rig.context, rig.page, baseURL, input.binding, input.source);
  } finally {
    if (previous === undefined) delete process.env.FORMA_A11Y_SYNTHETIC_NETWORK;
    else process.env.FORMA_A11Y_SYNTHETIC_NETWORK = previous;
  }
}

async function withInstalledIcon(run) {
  const rig = iconRouteDouble(), input = fixture(), api = await installDouble(rig, input);
  let primary, hadPrimary = false;
  try { await run({ ...rig, input, api }); }
  catch (error) { primary = error; hadPrimary = true; }
  try { await api.dispose(); }
  catch (cleanup) {
    if (hadPrimary) throw new AggregateError([primary, cleanup], "Icon control and cleanup failed");
    throw cleanup;
  }
  if (hadPrimary) throw primary;
}

test("icon preparation inserts exactly one fixed head link and preserves every other UTF8 byte", () => {
  const input = fixture(), sourceBefore = Buffer.from(input.source), bindingBefore = clone(input.binding);
  const prepared = prepareJapaneseFooterDocument(input.source, input.binding);
  assert.equal(JA_FOOTER_ICON_POLICY, declaredPolicy);
  assert.equal(JA_FOOTER_DOCUMENT_URL, documentURL);
  assert.equal(JA_FOOTER_ICON_SVG, literalSvg);
  assert.equal(JA_FOOTER_ICON_HREF, literalHref);
  assert.deepEqual(prepared.body, input.expected);
  assert.deepEqual(input.source, sourceBefore);
  assert.deepEqual(input.binding, bindingBefore);
  const responseText = prepared.body.toString("utf8");
  assert.equal(responseText.split(literalLink).length - 1, 1);
  assert.equal(responseText.replace(literalLink, ""), sourceText);
  assert.equal(responseText.slice(responseText.indexOf("<body")), sourceText.slice(sourceText.indexOf("<body")));
  assert.deepEqual(prepared.evidence.source, pin(input.source));
  assert.deepEqual(prepared.evidence.response, pin(input.expected));
  assert.equal(prepared.evidence.productionIconAcceptance, false);
});

test("icon preparation refuses stale pins, undeclared policy, malformed UTF8 and oversized source", () => {
  for (const [name, mutate] of [
    ["source byte count", value => { value.binding.source.bytes++; }],
    ["source digest", value => { value.binding.source.sha256 = "0".repeat(64); }],
    ["response byte count", value => { value.binding.response.bytes++; }],
    ["response digest", value => { value.binding.response.sha256 = "0".repeat(64); }],
    ["policy", value => { value.binding.policy = "unadmitted-policy"; }],
    ["source exceeds 64 KiB", value => { value.source = Buffer.alloc(65537, 120); value.binding.source = pin(value.source); }],
    ["malformed UTF8", value => { value.source = Buffer.from([0xff]); value.binding.source = pin(value.source); }],
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => prepareJapaneseFooterDocument(input.source, input.binding), /JA_ICON_POLICY_STOP:/, name);
  }
});

test("icon preparation refuses existing icons, existing policy markers and duplicate head boundaries", () => {
  for (const [name, text] of [
    ["icon", sourceText.replace("  </head>", '    <link rel="icon" href="existing.svg" />\n  </head>')],
    ["shortcut icon", sourceText.replace("  </head>", '    <link rel="shortcut icon" href="existing.ico" />\n  </head>')],
    ["policy marker", sourceText.replace("  </head>", '    <meta data-forma-footer-icon-policy="prior" />\n  </head>')],
    ["duplicate opening head", sourceText.replace("  <head>", "  <head><head>")],
    ["duplicate closing head", sourceText.replace("  </head>", "  </head></head>")],
  ]) {
    const input = fixture(text);
    assert.throws(() => prepareJapaneseFooterDocument(input.source, input.binding), /JA_ICON_POLICY_STOP:/, name);
  }
});

test("icon installer fulfills only its exact main-document GET without adding other transport", { concurrency: false }, async () => {
  await withInstalledIcon(async rig => {
    assert.deepEqual(rig.calls.registered.map(value => value.pattern), [documentURL]);
    for (const url of [baseURL + "/assets/app.js", baseURL + "/favicon.ico", baseURL + "/api/session", documentURL + "?other=1"]) {
      assert.equal(await rig.dispatchExact(rig.request({ url: () => url })), "unmatched");
    }
    assert.equal(rig.api.evidence().starts, 0, "Unmatched doubles do not invoke this policy or request a network");
    assert.equal(await rig.dispatchExact(rig.request()), "handled");
    assert.equal(rig.calls.fulfilled.length, 1);
    assert.deepEqual(rig.calls.fulfilled[0], { status: 200, contentType: "text/html; charset=utf-8",
      headers: { "cache-control": "no-store" }, body: rig.input.expected });
    assert.deepEqual(rig.calls.aborted, []);
    const value = rig.api.evidence();
    assert.equal(value.starts, 1);
    assert.equal(value.fulfilled, 1);
    assert.equal(value.pending, 0);
    assert.equal(value.activeRouteTasks, 0);
    assert.deepEqual(value.errors, []);
    assert.equal(value.productionIconAcceptance, false);
  });
});

test("icon installer refuses wrong method, page, frame, resource type or URL without fulfillment", { concurrency: false }, async () => {
  for (const [name, changedRequest] of [
    ["method", rig => rig.request({ method: () => "POST" })],
    ["owning page", rig => { rig.frame.page = () => ({}); return rig.request(); }],
    ["frame identity", rig => rig.request({ frame: () => ({ page: () => rig.page }) })],
    ["resource type", rig => rig.request({ resourceType: () => "fetch" })],
    ["URL", rig => rig.request({ url: () => documentURL + "?other=1" })],
  ]) {
    await withInstalledIcon(async rig => {
      await rig.invoke(changedRequest(rig));
      const value = rig.api.evidence();
      assert.equal(value.starts, 1, name);
      assert.equal(value.fulfilled, 0, name);
      assert.equal(value.pending, 0, name);
      assert.deepEqual(value.errors, ["document_policy_route_failed"], name);
      assert.deepEqual(rig.calls.aborted, ["blockedbyclient"], name);
      assert.deepEqual(rig.calls.fulfilled, [], name);
    });
  }
});

test("icon installer refuses a duplicate document request after one fulfillment", { concurrency: false }, async () => {
  await withInstalledIcon(async rig => {
    await rig.invoke(rig.request());
    await rig.invoke(rig.request());
    const value = rig.api.evidence();
    assert.equal(value.starts, 2);
    assert.equal(value.fulfilled, 1);
    assert.equal(value.pending, 0);
    assert.deepEqual(value.errors, ["document_policy_route_failed"]);
    assert.equal(rig.calls.fulfilled.length, 1);
    assert.deepEqual(rig.calls.aborted, ["blockedbyclient"]);
  });
});

test("icon cleanup removes its exact handler, drains its owned fulfillment and is idempotent", { concurrency: false }, async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const rig = iconRouteDouble({ fulfill: () => gate });
  const untouched = () => {};
  await rig.context.route("**/untouched/*", untouched);
  const api = await installDouble(rig);
  const routeTask = rig.invoke();
  let primary, hadPrimary = false, cleanup;
  try {
    const pending = api.evidence();
    assert.equal(pending.starts, 1);
    assert.equal(pending.pending, 1);
    assert.equal(pending.fulfilled, 0);
    cleanup = api.dispose();
    assert.equal(api.dispose(), cleanup);
    assert.equal(rig.calls.removed.length, 1);
    assert.equal(rig.calls.removed[0].pattern, documentURL);
    assert.equal(rig.calls.removed[0].handler, rig.calls.registered.find(value => value.pattern === documentURL).handler);
    assert.deepEqual(rig.routes, [{ pattern: "**/untouched/*", handler: untouched }]);
    assert.equal(api.evidence().closed, false);
  } catch (error) { primary = error; hadPrimary = true; }
  finally { release(); cleanup ??= api.dispose(); }
  try { await Promise.all([routeTask, cleanup]); }
  catch (error) {
    if (hadPrimary) throw new AggregateError([primary, error], "Icon drain control and cleanup failed");
    throw error;
  }
  if (hadPrimary) throw primary;
  const value = api.evidence();
  assert.equal(value.closed, true);
  assert.equal(value.pending, 0);
  assert.equal(value.activeRouteTasks, 0);
  assert.equal(value.fulfilled, 1);
  assert.deepEqual(value.errors, []);
  await api.dispose();
  assert.equal(rig.calls.removed.length, 1);
});

test("icon route and cleanup failures retain their evidence and original cleanup error", { concurrency: false }, async () => {
  const unrouteError = new Error("synthetic unroute fault");
  const rig = iconRouteDouble({ unrouteError,
    fulfill: async () => { throw new Error("synthetic fulfill fault"); },
    abort: async () => { throw new Error("synthetic abort fault"); } });
  const api = await installDouble(rig);
  await rig.invoke();
  assert.equal(api.evidence().pending, 0);
  assert.equal(api.evidence().fulfilled, 0);
  assert.deepEqual(api.evidence().errors, ["document_policy_route_failed", "document_policy_abort_failed"]);
  const cleanup = api.dispose();
  await assert.rejects(cleanup, error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [unrouteError]);
    return true;
  });
  assert.equal(api.dispose(), cleanup);
  assert.equal(api.evidence().closed, false);
  assert.deepEqual(api.evidence().errors, ["document_policy_route_failed", "document_policy_abort_failed", "document_policy_unroute_failed"]);
  assert.equal(rig.calls.removed.length, 1);
});
