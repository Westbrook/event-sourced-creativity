import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { flexible, snapshot, outputFor } from "./output-presentation-fixtures.mjs";

const root = new URL("../", import.meta.url).href;
const sourceResolution = registerHooks({ resolve(specifier, context, nextResolve) {
  const source = context.parentURL?.startsWith(root) && !context.parentURL.includes("/node_modules/");
  return nextResolve(source && specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const [{ handleSession }, { handleDocumentJobs }, { handleEvents }, { appendAuditEvent, readWorkspaceEvents }] = await Promise.all([
  import("../worker/pilot-policy.ts"), import("../worker/document-jobs-api.ts"), import("../worker/events-api.ts"), import("../worker/runtime.ts"),
]).finally(() => sourceResolution.deregister());

const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { assert.ok(values.length <= 100, "D1 binding limit"); return new Statement(this.sql, values); }
    execute(kind) {
      const stmt = sqlite.prepare(this.sql);
      if (kind === "first") return stmt.get(...this.values) ?? null;
      if (kind === "all") return { results: stmt.all(...this.values), success: true, meta: { changes: 0 } };
      return { results: [], success: true, meta: { changes: Number(stmt.run(...this.values).changes) } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }
  const DB = { prepare(sql) { return new Statement(sql); }, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const result = statements.map((stmt) => stmt.execute(/^\s*(?:SELECT|WITH)/i.test(stmt.sql) ? "all" : "run")); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const environment = { DB, OPENAI_API_KEY: "transport-test-only", OPENAI_MODEL: "gpt-5.6-terra", ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, MEDIA: { put: async () => undefined, get: async () => null } };
  assert.equal((await handleSession(new Request("http://localhost/api/session"), environment)).status, 200);
  sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await handleEvents(new Request("http://localhost/api/events?after=0&limit=2000&content=0"), environment)).status, 200);
  // Recovery reads the administrative hold ledger. Install its canonical schema
  // only in this disposable fixture, as in the adjacent receipt/recovery suites.
  sqlite.exec(readFileSync(new URL("../db/operations/budget-hold-dispositions.sql", import.meta.url), "utf8"));
  const documentId = "count-policy-document";
  await appendAuditEvent(environment, "creative:dev-local-creative", "user", "DocumentCreated", { project_id: "project-atmosphere", document_id: documentId, title: "Community stewardship" });
  for (const [index, fact] of snapshot().facts.entries()) await appendAuditEvent(environment, "creative:dev-local-creative", "user", "BlockCreated", {
    project_id: "project-atmosphere", document_id: documentId, block_id: fact.block_id, type: fact.type, handle: fact.block_id, position: `policy-${String(index).padStart(2, "0")}`, properties: { ...fact.properties, weight: 1, ...(fact.intent ? { intent: fact.intent } : {}) },
  });
  const jobs = (path = "", init) => handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path ? `/${path}` : ""}`, init), environment, path);
  const direct = (payload) => handleEvents(new Request("http://localhost/api/events", json({ action: "render_document", documentId, ...payload })), environment);
  const payload = { artifactKind: "slides", productionMode: "manual", itemCount: 8, slideCountPolicy: flexible, presentationStyle: "field-notes", presentationFidelity: "faithful", budgetAcknowledged: true, requestKey: "policy-fixture" };
  return { sqlite, environment, documentId, jobs, direct, payload, admit: (extra = {}) => jobs("", json({ kind: "render_document", documentId, payload: { ...payload, ...extra } })) };
}

test("both actual admission handlers reject conflicting or unsupported count policies before writes or provider contact", async (context) => {
  const f = await fixture();
  context.after(() => f.sqlite.close());
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Invalid counts must not contact providers"); });
  const before = { events: f.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, private: f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n };
  for (const [change, code] of [
    [{ requestedSlideCount: 8 }, "presentation_slide_count_conflict"],
    [{ slideCountPolicy: { ...flexible, max: 16 } }, "presentation_slide_count_invalid"],
    [{ slideCountPolicy: { ...flexible, unit: "episode" } }, "presentation_slide_count_invalid"],
    [{ productionMode: "managed" }, "presentation_count_policy_unsupported"],
    [{ slideCountPolicy: { kind: "exact", unit: "slide", value: 9 } }, "presentation_slide_count_conflict"],
  ]) for (const response of [await f.admit(change), await f.direct({ ...f.payload, ...change })]) {
    assert.ok([400, 409].includes(response.status), JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).error, code);
  }
  assert.equal(calls, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, before.events);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n, before.private);
});

test("queue admission retains accepted range, partitions source instructions, and includes policy in request identity", async (context) => {
  const f = await fixture(); context.after(() => f.sqlite.close());
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Admission alone does not call providers"); });
  const first = await f.admit(); assert.equal(first.status, 202, JSON.stringify(await first.clone().json()));
  const admitted = await first.json(), receipt = admitted.job.result.generationReceipt;
  assert.equal(receipt.requested_slide_count, null);
  assert.equal(receipt.predicted_slide_count, 8);
  assert.deepEqual(receipt.slide_count_policy, flexible);
  const stored = JSON.parse(f.sqlite.prepare("SELECT request_json FROM document_jobs WHERE job_id=?").get(admitted.job.jobId).request_json);
  assert.equal(Object.hasOwn(stored, "requestedSlideCount"), false);
  assert.deepEqual(stored.slideCountPolicy, flexible);
  assert.doesNotMatch(JSON.stringify(stored.snapshot), /OUTPUT_INSTRUCTION_SENTINEL|SIBLING_VIDEO_SENTINEL/);
  assert.ok(stored.sourceBlockVersions.some((version) => version.block_id === "output-mixed"));
  const sourceReceipt = JSON.parse(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(receipt.input_ref).content);
  assert.deepEqual(sourceReceipt.request.slide_count_policy, flexible);
  assert.doesNotMatch(JSON.stringify(sourceReceipt.document_snapshot), /OUTPUT_INSTRUCTION_SENTINEL|SIBLING_VIDEO_SENTINEL/);
  const repeated = await (await f.admit()).json(); assert.equal(repeated.job.jobId, admitted.job.jobId);
  const changed = await (await f.admit({ slideCountPolicy: { ...flexible, max: 12 } })).json(); assert.notEqual(changed.job.jobId, admitted.job.jobId);
  assert.equal(calls, 0);
});

test("direct execution persists an actual ninth slide under the original flexible policy", async (context) => {
  const f = await fixture(); context.after(() => f.sqlite.close());
  const requests = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses"); requests.push(JSON.parse(init.body));
    return Response.json({ id: "direct-flexible-nine", model: "gpt-5.6-terra", output_text: JSON.stringify(outputFor()), usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  });
  const response = await f.direct(f.payload); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].input).presentation_source.slideCountPolicy, flexible);
  assert.doesNotMatch(requests[0].input, /OUTPUT_INSTRUCTION_SENTINEL|SIBLING_VIDEO_SENTINEL/);
  const completed = (await readWorkspaceEvents(f.environment, "creative:dev-local-creative")).find((event) => event.type === "DocumentRenderCompleted" && event.payload.document_id === f.documentId).payload; assert.equal(completed.item_count, 9); assert.deepEqual(completed.settings.slide_count_policy, flexible);
  const artifact = JSON.parse(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(completed.content_ref).content);
  assert.equal(artifact.items.length, 9);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ArtifactApproved'").get().n, 0, "successful production cannot invent approval");
});

test("paid response recovery preserves the admitted range, rejects a changed policy, and never buys a replacement", async (context) => {
  const f = await fixture(); context.after(() => f.sqlite.close());
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (url) => { assert.equal(String(url), "https://api.openai.com/v1/responses"); calls++; return Response.json({ id: "recover-flexible-nine", model: "gpt-5.6-terra", output_text: JSON.stringify(outputFor()), usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } }); });
  const admission = await f.admit(); assert.equal(admission.status, 202, JSON.stringify(await admission.clone().json())); const { job } = await admission.json();
  f.sqlite.exec("CREATE TRIGGER fail_policy_artifact BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_policy_artifact_persistence_failure'); END");
  const run = await f.jobs(`${job.jobId}/run`, { method: "POST" }); assert.equal(run.status, 200, JSON.stringify(await run.clone().json()));
  const failed = (await run.json()).job; assert.equal(failed.status, "failed", JSON.stringify(failed));
  f.sqlite.exec("DROP TRIGGER fail_policy_artifact");
  assert.equal(calls, 1);
  const candidates = await f.jobs(`${job.jobId}/presentation-candidates`); assert.equal(candidates.status, 200, JSON.stringify(await candidates.clone().json()));
  const candidate = (await candidates.json()).candidates[0]; assert.equal(candidate.complete, true); assert.equal(candidate.generatedSlideCount, 9); assert.equal(candidate.requestedSlideCount, null); assert.deepEqual(candidate.slideCountPolicy, flexible);
  const original = f.sqlite.prepare("SELECT request_json FROM document_jobs WHERE job_id=?").get(job.jobId).request_json;
  const altered = JSON.parse(original); altered.slideCountPolicy = { kind: "exact", unit: "slide", value: 8 }; altered.requestedSlideCount = 8;
  f.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id=?").run(JSON.stringify(altered), job.jobId);
  const conflict = await f.jobs(`${job.jobId}/recover`, { method: "POST" }); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).reason, "slide_count_policy_changed");
  f.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id=?").run(original, job.jobId);
  const recovered = await f.jobs(`${job.jobId}/recover`, { method: "POST" }); assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
  const outcome = (await recovered.json()).job; assert.equal(outcome.status, "completed");
  const replay = await f.jobs(`${job.jobId}/recover`, { method: "POST" }); assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
  assert.equal(calls, 1, "recovery, policy conflict, and terminal replay issue no additional paid request");
  const completed = (await readWorkspaceEvents(f.environment, "creative:dev-local-creative")).find((event) => event.type === "DocumentRenderCompleted" && event.payload.document_id === f.documentId).payload;
  assert.equal(completed.item_count, 9); assert.equal(completed.settings.requested_slide_count, null); assert.deepEqual(completed.settings.slide_count_policy, flexible);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(f.documentId).n, 1);
});
