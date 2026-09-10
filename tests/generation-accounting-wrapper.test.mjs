import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Normal integrated runs read the real worker index. The explicit override is
// only for reviewing the outside-checkout proposal before root integration.
const indexText = await readFile(process.env.FORMA_ACCOUNTING_INDEX_FILE ?? new URL("../worker/index.ts", import.meta.url), "utf8");
const start = indexText.indexOf("  async fetch(request: Request, env: WorkerEnv, context: WorkerExecutionContext): Promise<Response>", indexText.indexOf("export default {"));
const end = indexText.indexOf("\n  async scheduled(", start);
assert.ok(start >= 0 && end > start, "The actual outer worker fetch wrapper must be located");
const wrapperText = indexText.slice(start, end).trim().replace(/,\s*$/u, "")
  .replace("async fetch(request: Request, env: WorkerEnv, context: WorkerExecutionContext): Promise<Response>", "async function fetch(request, env, context)");

function wrapper(status) {
  let retentionCalls = 0, routes = 0;
  const fetch = new Function("routeRequest", "schedulePrivateContentRetention", "OUTPUT_SCHEMA_PREFLIGHT_PATH", `return (${wrapperText});`)(
    async () => { routes++; return Response.json({ status }, { status }); },
    () => { retentionCalls++; }, "/api/output-schema-preflight");
  return { fetch, counts: () => ({ retentionCalls, routes }) };
}

test("the read-only diagnostics handler is registered at its exact route", () => {
  assert.match(indexText, /import \{ handleGenerationAccounting \} from "\.\/generation-accounting-api\.ts";/u);
  assert.match(indexText, /if\(url\.pathname==="\/api\/admin\/generation-accounting"\)return handleGenerationAccounting\(request,env\);/u);
});

test("outer worker fetch never schedules retention for accounting diagnostics, including errors and forbidden methods", async () => {
  for (const [status, method] of [[200, "GET"], [400, "GET"], [403, "GET"], [404, "GET"], [405, "POST"], [409, "GET"], [503, "GET"]]) {
    const current = wrapper(status);
    const response = await current.fetch(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1", { method }), {}, { waitUntil() { throw new Error("Background work forbidden"); } });
    assert.equal(response.status, status);
    assert.deepEqual(current.counts(), { retentionCalls: 0, routes: 1 });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("the new exact exemption preserves existing exemptions and unrelated retention behavior", async () => {
  for (const path of ["/api/admin/budget-hold-dispositions", "/api/retained-story/example", "/api/retained-output/example", "/api/output-schema-preflight"]) {
    const current = wrapper(200); await current.fetch(new Request(`https://forma.invalid${path}`), {}, {});
    assert.equal(current.counts().retentionCalls, 0);
  }
  for (const path of ["/api/events", "/api/admin/generation-accounting-extra"]) {
    const current = wrapper(200); await current.fetch(new Request(`https://forma.invalid${path}`), {}, {});
    assert.equal(current.counts().retentionCalls, 1);
  }
});
