import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";
import { priceFalIdeogramImageBreakdownMicrousd, priceTextUsageMicrousd } from "../worker/replay-cost.ts";

const workspaceRoot = new URL("../", import.meta.url).href;
const sourceResolution = registerHooks({
  resolve(specifier, context, nextResolve) {
    const workspaceSource = typeof context.parentURL === "string"
      && context.parentURL.startsWith(workspaceRoot)
      && !context.parentURL.includes("/node_modules/");
    return nextResolve(workspaceSource && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier)
      ? `${specifier}.ts`
      : specifier, context);
  },
});
const { handleDocumentJobs } = await import("../worker/document-jobs-api.ts")
  .finally(() => sourceResolution.deregister());

const ownerId = "dev-local-creative";
const providerEndpoint = "https://queue.fal.run/ideogram/v4/fast";
const initialFrameId = "original-saved-storyboard-frame-1";
const rejectedFrameId = "provider-safety-rejected-storyboard-frame-2";
const saferFrameId = "owner-approved-safer-storyboard-frame-2";
const providerFrameIds = [
  initialFrameId,
  rejectedFrameId,
  saferFrameId,
  "remaining-storyboard-frame-3",
  "remaining-storyboard-frame-4",
];
const queueRoot = (requestId) => `https://queue.fal.run/ideogram/v4/requests/${requestId}`;
const mediaUrl = (requestId) => `https://cdn.fal.media/${requestId}.jpg`;

const storyboardPlan = {
  title: "One context, infinite paths",
  summary: "Four visual scenes preserve the authored context and audience choice.",
  content_markdown: "A shared creative context reaches four audience-selected forms.",
  presentation: null,
  items: Array.from({ length: 4 }, (_, index) => ({
    title: `One context reaches audience ${index + 1}`,
    body: [
      "An adult designer studies the shared creative brief beside the morning window.",
      "A producer arranges blank editorial cards into an emerging campaign direction.",
      "The creative team compares distinct audience treatments across the studio table.",
      "A finished visual sequence unites every approved direction around the central brief.",
    ][index],
    notes: `Wide establishing shot ${index + 1} with warm natural light and clear visual hierarchy.`,
    image_prompt: `Editorial wide photograph ${index + 1} of an adult designer arranging abstract blank cards around one central creative document, warm natural light.`,
    context_group_ids: [],
    slide: null,
  })),
};

async function routeFixture() {
  const sqlite = new DatabaseSync(":memory:");

  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    execute(kind) {
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.values) ?? null;
      if (kind === "all") return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
      return { results: [], success: true, meta: { changes: Number(statement.run(...this.values).changes) } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }

  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql) ? "all" : "run"));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const savedMedia = new Map();
  const env = {
    DB,
    OPENAI_API_KEY: "private-openai-safe-continuation-test-key",
    OPENAI_MODEL: "gpt-5.6-terra",
    FAL_KEY: "private-fal-safe-continuation-test-key",
    FORMA_IMAGE_PROVIDER: "fal-ideogram",
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    MEDIA: {
      put: async (key, value, options) => { savedMedia.set(key, { value, options }); },
      get: async () => null,
    },
  };
  const bootstrap = (path, init) => worker.fetch(new Request(`http://localhost${path}`, init), env, { waitUntil() {} });
  assert.equal((await bootstrap("/api/session")).status, 200);
  sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await bootstrap("/api/events?after=0&limit=2000&content=0")).status, 200);

  const route = (path = "", init = {}) => handleDocumentJobs(
    new Request(`http://localhost/api/document-jobs${path ? `/${path}` : ""}`, init),
    env,
    path,
  );
  return { sqlite, env, route, savedMedia };
}

async function admitStoryboard(fixture, itemCount = 4) {
  const response = await fixture.route("", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "render_document",
      documentId: "doc-atmosphere",
      sourceSurface: "storyboard-safe-continuation-e2e",
      payload: {
        artifactKind: "storyboard",
        productionMode: "manual",
        itemCount,
        paidMediaConfirmed: true,
        requestKey: "four-frame-safe-storyboard-continuation",
      },
    }),
  });
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  return (await response.json()).job;
}

function providerMock() {
  const previousFetch = globalThis.fetch;
  const calls = [];
  let submissions = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body, authorization: new Headers(init.headers).get("authorization") });

    if (url.endsWith("/responses")) {
      return Response.json({
        id: "four-frame-storyboard-planner-response-1",
        model: "gpt-5.6-terra",
        output_text: JSON.stringify(storyboardPlan),
        usage: { input_tokens: 400, output_tokens: 200, total_tokens: 600 },
      });
    }
    if (url.endsWith("/moderations")) {
      return Response.json({
        id: "four-frame-storyboard-safety-moderation-1",
        model: "omni-moderation-latest",
        results: [{ flagged: false, categories: {}, category_scores: {} }],
      });
    }
    if (url === providerEndpoint && method === "POST") {
      const requestId = providerFrameIds[submissions];
      assert.ok(requestId, "the bounded continuation must not create unexpected paid provider submissions");
      submissions += 1;
      return Response.json({ request_id: requestId, status: "COMPLETED" });
    }

    const responseMatch = /^https:\/\/queue\.fal\.run\/ideogram\/v4\/requests\/([^/]+)$/u.exec(url);
    if (responseMatch) {
      const requestId = responseMatch[1];
      if (requestId === rejectedFrameId) {
        return Response.json({ error: { code: "safety_rejected", message: "Generated output was rejected by the image safety policy." } }, {
          status: 422,
          headers: { "x-fal-request-id": rejectedFrameId },
        });
      }
      return Response.json({
        images: [{ url: mediaUrl(requestId), content_type: "image/jpeg", width: 1024, height: 1024 }],
      });
    }
    if (url.startsWith("https://cdn.fal.media/")) {
      return new Response(Uint8Array.from([255, 216, 255, 219, 0, 1, 255, 217]), {
        headers: { "content-type": "image/jpeg" },
      });
    }

    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };

  return { calls, restore() { globalThis.fetch = previousFetch; } };
}

function reservationState(fixture, reservationId, table) {
  return fixture.sqlite.prepare(`SELECT reservation_id,status,correlation_id FROM ${table} WHERE reservation_id=?`).get(reservationId);
}

test("saved storyboard inspection and the disabled legacy continuation preserve the original rejection, paid frames, and holds", async () => {
  const fixture = await routeFixture();
  const provider = providerMock();
  try {
    const admitted = await admitStoryboard(fixture);
    const failedResponse = await fixture.route(`${admitted.jobId}/run`, { method: "POST" });
    assert.equal(failedResponse.status, 200, await failedResponse.clone().text());
    const failed = (await failedResponse.json()).job;
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorDetail.category, "safety");
    assert.equal(failed.result.renderedItems.length, 1);
    assert.equal(fixture.savedMedia.size, 1);
    const tokenId = failed.result.reservationId, costId = failed.result.costReservationId;
    assert.equal(reservationState(fixture, tokenId, "budget_reservations").status, "active");
    assert.equal(reservationState(fixture, costId, "cost_budget_reservations").status, "executing");

    const ordinaryRetry = await fixture.route(`${failed.jobId}/retry`, { method: "POST" });
    assert.equal(ordinaryRetry.status, 409);
    assert.equal((await ordinaryRetry.json()).error, "provider_job_not_retryable");

    // A different expired lease must not turn a read-only detail request into
    // maintenance or a queue-dispatch side effect.
    const existing = fixture.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(failed.jobId);
    const stale = { ...existing, job_id: "unrelated-stale-job", correlation_id: "unrelated-stale-correlation", status: "running", attempt_count: 10, lease_expires_at: "2000-01-01T00:00:00.000Z" };
    const columns = Object.keys(stale);
    fixture.sqlite.prepare(`INSERT INTO document_jobs (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((key) => stale[key]));
    const state = () => ({
      jobs: fixture.sqlite.prepare("SELECT * FROM document_jobs ORDER BY job_id").all(),
      tokens: fixture.sqlite.prepare("SELECT * FROM budget_reservations ORDER BY reservation_id").all(),
      costs: fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),
      events: fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,
      privateContent: fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,
      mediaCount: fixture.savedMedia.size,
      calls: provider.calls.length,
    });
    const original = state();
    let dispatched = 0;
    const inspect = (jobId) => handleDocumentJobs(
      new Request(`http://localhost/api/document-jobs/${jobId}?inspection=1`),
      fixture.env, jobId, { waitUntil() { dispatched += 1; } },
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const inspected = await inspect(failed.jobId);
      assert.equal(inspected.status, 200, await inspected.clone().text());
      assert.equal(inspected.headers.get("cache-control"), "private, no-store");
      const observed = (await inspected.json()).job;
      assert.equal(observed.status, "failed");
      assert.equal(observed.errorDetail.category, "safety");
      assert.equal(observed.result.providerJobId, rejectedFrameId);
      assert.equal(observed.result.renderedItems.length, 1);
      assert.equal(observed.result.artifactPlan.items.length, 4);
      const disabled = await fixture.route(`${failed.jobId}/continue-safer-frames`, { method: "POST" });
      assert.equal(disabled.status, 409);
      assert.equal((await disabled.json()).error, "storyboard_revised_direction_approval_required");
      assert.deepEqual(state(), original);
    }
    assert.equal(dispatched, 0);
    assert.equal(provider.calls.filter((call) => call.url === providerEndpoint && call.method === "POST").length, 2);
    assert.equal(provider.calls.filter((call) => call.url === queueRoot(initialFrameId)).length, 1);
    assert.equal(provider.calls.filter((call) => call.url === queueRoot(rejectedFrameId)).length, 1);

    for (const [column, value] of [["owner_id", "another-owner"], ["stream_id", "another-stream"], ["expires_at", "2000-01-01T00:00:00.000Z"]]) {
      fixture.sqlite.prepare(`UPDATE document_jobs SET ${column}=? WHERE job_id=?`).run(value, failed.jobId);
      assert.equal((await inspect(failed.jobId)).status, 404, column);
      fixture.sqlite.prepare(`UPDATE document_jobs SET ${column}=? WHERE job_id=?`).run(existing[column], failed.jobId);
    }
    assert.equal((await inspect("nonexistent-job")).status, 404);
    assert.deepEqual(state(), original);
    assert.equal(dispatched, 0);
  } finally { provider.restore(); }
});
for (const interruptAcceptedFrame of [false, true]) {
  test(`eight-frame storyboard ${interruptAcceptedFrame ? "resumes an accepted frame" : "completes in one foreground run"} without duplicate calls or lost costs`, async () => {
    const fixture = await routeFixture();
    const provider = providerMock();
    const baseFetch = globalThis.fetch;
    let plannerCalls = 0;
    let imagePosts = 0;
    let interrupted = false;
    let lastPaidCheckpoint;
    const basePut = fixture.env.MEDIA.put;
    fixture.env.MEDIA.put = async (...args) => {
      await basePut(...args);
      const row = fixture.sqlite.prepare("SELECT result_json FROM document_jobs ORDER BY requested_at DESC LIMIT 1").get();
      lastPaidCheckpoint = JSON.parse(row.result_json);
    };
    const plan = {
      ...storyboardPlan,
      summary: "Eight ordered visual scenes retain the same approved creative direction.",
      items: Array.from({ length: 8 }, (_, index) => ({
        ...storyboardPlan.items[index % 4],
        title: `Distinct storyboard moment ${index + 1}`,
        body: [
          "An overwhelmed creator confronts crowded controls while unfinished deliverables surround them.",
          "Nine specialist perspectives converge around evidence, revealing calm beneath product complexity.",
          "A spacious Canvas reveals forty four objects organized with effortless clarity.",
          "Existing decisions and documents connect only through explicitly confirmed context groups.",
          "One contextual next action guides completed work toward its intended outcome.",
          "A clear consent checkpoint discloses source, provider, cost, and explicit approval.",
          "An independent reviewer approves the exact revision before trustworthy delivery begins.",
          "Seven expressive output formats emerge from one explicit, governed creative direction.",
        ][index],
        image_prompt: `Editorial scene ${index + 1}: ${storyboardPlan.items[index % 4].image_prompt}`,
      })),
    };
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/responses")) {
        plannerCalls += 1;
        return Response.json({ id: "eight-frame-planner", model: "gpt-5.6-terra", output_text: JSON.stringify(plan), usage: { input_tokens: 400, output_tokens: 200, total_tokens: 600 } });
      }
      if (url === providerEndpoint && init.method === "POST") {
        imagePosts += 1;
        assert.ok(imagePosts <= 8, "an eight-frame run must not purchase a ninth frame");
        return Response.json({ request_id: `ordinary-frame-${imagePosts}`, status: "COMPLETED" });
      }
      if (url.endsWith("/status?logs=1")) return Response.json({ status: "COMPLETED" });
      if (url === queueRoot("ordinary-frame-2") && interruptAcceptedFrame && !interrupted) {
        interrupted = true;
        throw new TypeError("Interrupted after the second frame was accepted");
      }
      return baseFetch(input, init);
    };
    try {
      const admitted = await admitStoryboard(fixture, 8);
      let response = await fixture.route(`${admitted.jobId}/run`, { method: "POST" });
      assert.equal(response.status, 200, await response.clone().text());
      let job = (await response.json()).job;
      const originalTokenId = job.result.reservationId ?? lastPaidCheckpoint.reservationId;
      const originalCostId = job.result.costReservationId ?? lastPaidCheckpoint.costReservationId;
      if (interruptAcceptedFrame) {
        assert.equal(job.status, "failed", JSON.stringify(job));
        assert.equal(job.result.providerJobId, "ordinary-frame-2");
        assert.equal(job.result.renderedItems.length, 1);
        assert.equal(imagePosts, 2);
        assert.equal(reservationState(fixture, originalTokenId, "budget_reservations").status, "active");
        assert.equal(reservationState(fixture, originalCostId, "cost_budget_reservations").status, "executing");
        const retried = await fixture.route(`${admitted.jobId}/retry`, { method: "POST" });
        assert.equal(retried.status, 202, await retried.clone().text());
        const queued = (await retried.json()).job;
        assert.equal(queued.result.reservationId, originalTokenId);
        assert.equal(queued.result.costReservationId, originalCostId);
        response = await fixture.route(`${admitted.jobId}/run`, { method: "POST" });
        assert.equal(response.status, 200, await response.clone().text());
        job = (await response.json()).job;
      }
      assert.equal(job.status, "completed", JSON.stringify(job));
      assert.equal(plannerCalls, 1, "the paid plan must be reused on recovery");
      assert.equal(imagePosts, 8, "each distinct frame is submitted exactly once");
      assert.equal(fixture.savedMedia.size, 8);
      const receipts = Object.values(lastPaidCheckpoint.providerSubmissions);
      assert.equal(receipts.length, 9);
      assert.ok(receipts.every((receipt) => receipt.status === "completed"));
      const correlation = fixture.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(admitted.jobId).correlation_id;
      const completedEvent = fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' AND correlation_id=?").get(correlation);
      const artifact = JSON.parse(completedEvent.payload);
      const content = JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(artifact.content_ref).content);
      assert.equal(content.items.length, 8);
      assert.equal(lastPaidCheckpoint.renderedItems.length, 7, "the first seven frames precede the eighth frame's storage checkpoint");
      for (const frame of lastPaidCheckpoint.renderedItems) {
        assert.ok(receipts.some((receipt) => receipt.clientRequestId === frame.provider_submission_id && receipt.providerRequestId === frame.provider_request_id), "saved frames retain their original canonical submission identity");
      }
      const plannerCost = priceTextUsageMicrousd("gpt-5.6-terra", { inputTokens: 400, outputTokens: 200, totalTokens: 600 });
      const frameCost = priceFalIdeogramImageBreakdownMicrousd("ideogram/v4/fast", 1024, 1024, "BALANCED", "Medium").totalMicrousd;
      const cost = fixture.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(originalCostId);
      assert.equal(cost.status, "settled");
      assert.equal(cost.used_microusd, plannerCost + 8 * frameCost, "earlier retained frames and the resumed frame are billed exactly once");
      assert.equal(reservationState(fixture, originalTokenId, "budget_reservations").status, "settled");
      for (const table of ["budget_reservations", "cost_budget_reservations"]) {
        assert.equal(fixture.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=? AND operation='document-render:storyboard'`).get(ownerId).count, 1);
      }
    } finally {
      provider.restore();
    }
  });
}
