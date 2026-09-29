const observationalEvents = new Set([
  "ApplicationViewVisited", "DocumentViewVisited", "ObjectViewed",
  "DocumentArtifactViewed", "ComparisonOpened", "CanvasInteractionRecorded",
  "AttentionEpisodeObserved",
]);
// Match the existing application font import, not arbitrary third-party URLs.
const fontStylesheet = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap";

/** This suite is deliberately not a production writer or a sign-in workaround. */
export function localTestOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("FORMA_A11Y_BASE_URL must be a plain loopback HTTP origin for an existing local Forma preview.");
  }
  return url.origin;
}

/** No fabricated successful response: writes are aborted before reaching Forma. */
export function classifyTestRequest(request, baseURL) {
  const url = new URL(request.url);
  if (["data:", "blob:", "chrome-extension:"].includes(url.protocol)) return "local-browser";
  if (request.method === "GET" && (request.resourceType === "stylesheet" && url.href === fontStylesheet
    || request.resourceType === "font" && url.origin === "https://fonts.gstatic.com" && !url.search
      && /^\/s\/(?:dmmono|manrope)\/[\w/-]+\.woff2$/.test(url.pathname))) return "public-font";
  if (url.origin !== localTestOrigin(baseURL)) return "forbidden";
  if (["GET", "HEAD"].includes(request.method)) return "read";
  // This existing recovery query is POST-shaped, but resume's server branch
  // only reads the original preview/receipt (readAuthoringState: readOnly).
  // Preview, apply, retrieve and dismiss are deliberately not admitted here.
  if (request.method === "POST" && url.pathname === "/api/workspace/quick-edit") {
    try {
      const body = JSON.parse(request.postData ?? "");
      if (body && body.action === "resume" && Object.keys(body).every(key => ["action", "projectId", "documentId", "operationId"].includes(key))
        && typeof body.projectId === "string" && body.projectId.length > 0
        && typeof body.documentId === "string" && body.documentId.length > 0
        && (body.operationId === undefined || typeof body.operationId === "string" && /^[A-Za-z0-9_-]{16,120}$/.test(body.operationId))) return "recovery-read";
    } catch { /* Unknown POST bodies remain forbidden. */ }
  }
  if (request.method === "POST" && url.pathname === "/api/performance") return "suppressed-telemetry";
  if (request.method === "POST" && url.pathname === "/api/events/hot") {
    try {
      const body = JSON.parse(request.postData ?? "");
      const events = body.events ?? (body.event ? [body.event] : []);
      if (body.action === "hot" && Array.isArray(events) && events.length > 0
        && events.every(event => observationalEvents.has(event?.type))) return "suppressed-telemetry";
    } catch { /* Malformed or unexpected POSTs remain forbidden. */ }
  }
  return "forbidden";
}

export async function guardReadOnlyNetwork(context, baseURL) {
  const record = { reads: 0, publicFontReads: [], recoveryReads: [], suppressedTelemetry: [], forbidden: [] };
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const input = { method: request.method(), url: request.url(), postData: request.postData(), resourceType: request.resourceType() };
    const classification = classifyTestRequest(input, baseURL);
    if (["read", "local-browser", "public-font", "recovery-read"].includes(classification)) {
      record.reads += 1;
      if (classification === "public-font") record.publicFontReads.push({ origin: url.origin, path: url.pathname });
      if (classification === "recovery-read") record.recoveryReads.push({ method: input.method, path: url.pathname, action: "resume" });
      await route.continue();
      return;
    }
    // Keep content, query strings, tokens and headers out of the guard receipt.
    const item = { method: input.method, origin: url.origin, path: url.pathname, resourceType: request.resourceType() };
    record[classification === "suppressed-telemetry" ? "suppressedTelemetry" : "forbidden"].push(item);
    await route.abort("blockedbyclient");
  });
  return record;
}
