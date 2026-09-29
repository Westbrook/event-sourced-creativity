import assert from "node:assert/strict";
import test from "node:test";
import { readWorkerFetchWrapper } from "./helpers/worker-fetch-wrapper.mjs";

// Normal integrated runs read the real worker index. The explicit override is
// only for reviewing the outside-checkout proposal before root integration.
const { indexText, preflightPath, supportsSponsorResponseIdentity, wrapper } = await readWorkerFetchWrapper(process.env.FORMA_ACCOUNTING_INDEX_FILE);

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
  for (const path of ["/api/admin/budget-hold-dispositions", "/api/admin/managed-video-reconciliation",
    "/api/retained-story", "/api/retained-story/example", "/api/retained-output", "/api/retained-output/example", preflightPath,
    "/api/selected-output-shares", "/api/selected-output-shares/availability", "/api/selected-output-shares/prepare",
    "/api/selected-output-shared", "/api/selected-output-shared/example", "/api/selected-output-shared/example/file"]) {
    const current = wrapper(200); await current.fetch(new Request(`https://forma.invalid${path}`), {}, {});
    assert.deepEqual(current.counts(), { retentionCalls: 0, routes: 1 }, path);
  }
  for (const path of ["/api/events", "/api/admin/generation-accounting-extra", "/api/admin/budget-hold-dispositions-extra",
    "/api/admin/managed-video-reconciliation-extra", "/api/retained-story-extra", "/api/retained-output-extra",
    "/api/output-schema-preflight", preflightPath + "-extra", "/api/selected-output-shares-extra", "/api/selected-output-shared-extra"]) {
    const current = wrapper(200); await current.fetch(new Request(`https://forma.invalid${path}`), {}, {});
    assert.deepEqual(current.counts(), { retentionCalls: 1, routes: 1 }, path);
  }
  if (supportsSponsorResponseIdentity) {
    const path = "/api/experiences/sponsor/image/drafts/example/output-confirmation";
    // The same prefix never grants an exemption by itself. A marked decoy has
    // identical status/body but is not the Response returned by the route port.
    for (const [status, identity, retentionCalls] of [[200, "returned", 0], [503, "returned", 0], [200, "unhandled", 1], [200, "different", 1]]) {
      const current = wrapper(status, identity);
      const response = await current.fetch(new Request(`https://forma.invalid${path}`), {}, {});
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { status });
      assert.deepEqual(current.counts(), { retentionCalls, routes: 1 }, identity);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  }
});
