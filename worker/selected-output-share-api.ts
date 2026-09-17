import type { WorkerEnv } from "./runtime.ts";

// Deliberately closed until automatic metadata retention has explicit approval,
// completed qualification and a separately reviewed source change. No env flag,
// request parameter, schema presence or authenticated principal activates it.
const creationEnabled = false;
const headers = { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (body: unknown, status = 200, allow?: string) => new Response(JSON.stringify(body), {
  status, headers: { ...headers, ...(allow ? { allow } : {}) },
});
const refused = () => json({ error: "selected_output_share_unavailable" }, 404);
const wrongMethod = (allow: string) => json({ error: "method_not_allowed" }, 405, allow);

export function isSelectedOutputShareApiPath(pathname: string): boolean {
  return pathname === "/api/selected-output-shares" || pathname.startsWith("/api/selected-output-shares/")
    || pathname === "/api/selected-output-shared" || pathname.startsWith("/api/selected-output-shared/");
}

/** Finite additive routes. These do not initialize schema, provision principals,
 * schedule retention or fall back to Document sharing. The exact file route
 * privately resolves one fully qualified owned media buffer after all proofs. */
export async function handleSelectedOutputShareApi(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (request.signal.aborted || !isSelectedOutputShareApiPath(path)) return refused();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)
    && (request.headers.get("sec-fetch-site") === "cross-site"
      || request.headers.has("origin") && request.headers.get("origin") !== url.origin))
    return json({ error: "selected_output_share_same_origin_required" }, 403);
  if (path === "/api/selected-output-shares") {
    if (request.method !== "GET") return wrongMethod("GET");
    const { listSelectedOutputShares } = await import("./selected-output-share-management.ts");
    return listSelectedOutputShares(request, env);
  }
  if (url.search || url.hash) return refused();
  if (path === "/api/selected-output-shares/availability") {
    if (request.method !== "GET") return wrongMethod("GET");
    return json({ creationAvailable: creationEnabled });
  }
  if (path === "/api/selected-output-shares/prepare" || path === "/api/selected-output-shares/commit") {
    if (request.method !== "POST") return wrongMethod("POST");
    if (!creationEnabled) return json({ error: "selected_output_share_creation_unavailable" }, 503);
    const { prepareSelectedOutputShare, commitSelectedOutputShare } = await import("./selected-output-share-lifecycle.ts");
    return path.endsWith("/prepare") ? prepareSelectedOutputShare(request, env) : commitSelectedOutputShare(request, env);
  }
  const preparedFile = path.match(/^\/api\/selected-output-shares\/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})\/file$/u);
  if (preparedFile) {
    if (request.method !== "GET") return wrongMethod("GET");
    if (request.headers.get("sec-fetch-site") !== "same-origin"
      || request.headers.has("origin") && request.headers.get("origin") !== url.origin)
      return json({ error: "selected_output_share_same_origin_required" }, 403);
    if (!creationEnabled) return json({ error: "selected_output_share_creation_unavailable" }, 503);
    const { readPreparedSelectedOutputShareMediaFile } = await import("./selected-output-share-lifecycle.ts");
    return readPreparedSelectedOutputShareMediaFile(request, env, preparedFile[1]!);
  }
  const publicFile = path.match(/^\/api\/selected-output-shared\/([A-Za-z0-9_-]{32})\/file$/u);
  if (publicFile) {
    if (request.method !== "GET") return wrongMethod("GET");
    const { readSelectedOutputShareMediaFile } = await import("./selected-output-share-lifecycle.ts");
    return readSelectedOutputShareMediaFile(request, env, publicFile[1]!);
  }
  const publicRead = path.match(/^\/api\/selected-output-shared\/([A-Za-z0-9_-]{32})$/u);
  if (publicRead) {
    if (request.method !== "GET") return wrongMethod("GET");
    const { readSelectedOutputShare } = await import("./selected-output-share-lifecycle.ts");
    return readSelectedOutputShare(request, env, publicRead[1]!);
  }
  const management = path.match(/^\/api\/selected-output-shares\/([^/]+)$/u);
  if (management) {
    let id: string;
    try { id = decodeURIComponent(management[1]!); } catch { return refused(); }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(id)) return refused();
    if (request.method !== "DELETE") return wrongMethod("DELETE");
    const { revokeSelectedOutputShare } = await import("./selected-output-share-lifecycle.ts");
    return revokeSelectedOutputShare(request, env, id);
  }
  return refused();
}
