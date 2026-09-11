import { createHash } from "node:crypto";

// Explicit finite-fixture browser-chrome policy, not production branding.
export const JA_FOOTER_ICON_POLICY = "ja-footer-inert-icon-v1";
export const JA_FOOTER_DOCUMENT_URL = "http://127.0.0.1:4186/document/doc-atmosphere/atmosphere-studies";
export const JA_FOOTER_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';
export const JA_FOOTER_ICON_HREF = "data:image/svg+xml," + encodeURIComponent(JA_FOOTER_ICON_SVG);
const iconTag = `    <link rel="icon" type="image/svg+xml" href="${JA_FOOTER_ICON_HREF}" data-forma-footer-icon-policy="${JA_FOOTER_ICON_POLICY}" />\n`;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const requirePolicy = (ok, reason) => { if (!ok) throw new Error(`JA_ICON_POLICY_STOP: ${reason}`); };
const matchesPin = (bytes, pin) => pin && Number.isInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= 65536
  && typeof pin.sha256 === "string" && /^[a-f0-9]{64}$/.test(pin.sha256) && bytes.length === pin.bytes && digest(bytes) === pin.sha256;

export function prepareJapaneseFooterDocument(sourceBytes, binding) {
  requirePolicy(binding?.policy === JA_FOOTER_ICON_POLICY, "declared fixture policy");
  requirePolicy(Buffer.isBuffer(sourceBytes) && sourceBytes.length <= 65536
    && matchesPin(sourceBytes, binding.source), "independently pinned built HTML");
  const source = sourceBytes.toString("utf8");
  requirePolicy(Buffer.from(source, "utf8").equals(sourceBytes), "complete UTF8 HTML");
  requirePolicy((source.match(/<head(?:\s[^>]*)?>/gi) ?? []).length === 1
    && (source.match(/<\/head>/gi) ?? []).length === 1
    && (source.match(/<body(?:\s[^>]*)?>/gi) ?? []).length === 1, "one complete document head and body");
  const end = source.indexOf("  </head>");
  requirePolicy(end >= 0 && source.indexOf("<head") < end && source.indexOf("<body") > end,
    "exact insertion boundary in pinned HTML");
  const head = source.slice(0, end);
  requirePolicy(!/<link\b[^>]*\brel\s*=\s*(?:["'][^"']*\bicon\b|[^\s>]*icon)/i.test(head)
    && !head.includes("data-forma-footer-icon-policy"), "no pre-existing icon declaration");
  const body = Buffer.from(source.slice(0, end) + iconTag + source.slice(end), "utf8");
  requirePolicy(matchesPin(body, binding.response), "independently pinned transformed HTML");
  return { body, evidence: { policy: JA_FOOTER_ICON_POLICY,
    source: { bytes: sourceBytes.length, sha256: digest(sourceBytes) },
    response: { bytes: body.length, sha256: digest(body) },
    icon: { bytes: Buffer.byteLength(JA_FOOTER_ICON_SVG), sha256: digest(JA_FOOTER_ICON_SVG), href: JA_FOOTER_ICON_HREF },
    transformation: "one fixed head link before parsing; all other HTML bytes unchanged", productionIconAcceptance: false } };
}

export async function installJapaneseFooterIconPolicy(context, page, baseURL, binding, sourceBytes) {
  requirePolicy(baseURL === "http://127.0.0.1:4186" && process.env.FORMA_A11Y_SYNTHETIC_NETWORK === "1"
    && page.context() === context && page.url() === "about:blank", "exact unvisited JA synthetic fixture");
  const prepared = prepareJapaneseFooterDocument(sourceBytes, binding);
  const state = { starts: 0, fulfilled: 0, pending: 0, closed: false, errors: [] };
  let closing = false, disposal;
  const tasks = new Set();
  const note = reason => { if (state.errors.length < 4) state.errors.push(reason); };
  const handle = async route => {
    state.starts++; state.pending++;
    try {
      const request = route.request();
      requirePolicy(!closing && state.starts === 1 && request.url() === JA_FOOTER_DOCUMENT_URL
        && request.method() === "GET" && request.resourceType() === "document"
        && request.frame() === page.mainFrame() && request.frame().page() === page,
        "one exact main-document GET only");
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8",
        headers: { "cache-control": "no-store" }, body: prepared.body });
      state.fulfilled++;
    } catch {
      note("document_policy_route_failed");
      try { await route.abort("blockedbyclient"); } catch { note("document_policy_abort_failed"); }
    } finally { state.pending--; }
  };
  const handler = route => {
    const task = handle(route); tasks.add(task);
    task.then(() => tasks.delete(task), () => { tasks.delete(task); note("document_policy_task_failed"); });
    return task;
  };
  const dispose = () => disposal ??= (async () => {
    closing = true;
    const failures = [];
    try { await context.unroute(JA_FOOTER_DOCUMENT_URL, handler); }
    catch (error) { note("document_policy_unroute_failed"); failures.push(error); }
    let timer;
    try {
      await Promise.race([Promise.allSettled([...tasks]), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("JA_ICON_POLICY_STOP: document route drain timeout")), 2500);
      })]);
      requirePolicy(state.pending === 0, "document route drained");
    } catch (error) { note("document_policy_drain_failed"); failures.push(error); }
    finally { clearTimeout(timer); }
    state.closed = failures.length === 0;
    if (failures.length) throw new AggregateError(failures, "JA document-policy cleanup failed");
  })();
  try { await context.route(JA_FOOTER_DOCUMENT_URL, handler); }
  catch (error) {
    note("document_policy_install_failed");
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], "JA document-policy setup and cleanup failed"); }
    throw error;
  }
  return Object.freeze({ dispose, evidence: () => ({ ...prepared.evidence,
    source: { ...prepared.evidence.source }, response: { ...prepared.evidence.response }, icon: { ...prepared.evidence.icon },
    ...state, errors: [...state.errors], activeRouteTasks: tasks.size,
    limit: "Explicit fixture-head variation; no shipped icon, product-body change or native error exemption" }) });
}
