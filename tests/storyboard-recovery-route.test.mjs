import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";

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

const [{ handleDocumentJobs }, { reconcileFailedBudgetReservations }] = await Promise.all([
  import("../worker/document-jobs-api.ts"),
  import("../worker/pilot-policy.ts"),
]).finally(() => sourceResolution.deregister());

const ownerId = "dev-local-creative";
const providerJobId = "owned-storyboard-frame-01";
const providerEndpoint = "https://queue.fal.run/ideogram/v4/fast";
const providerRequestRoot = `https://queue.fal.run/ideogram/v4/requests/${providerJobId}`;
const mediaUrl = "https://cdn.fal.media/owned-storyboard-frame.jpg";

const storyboardPlan = {
  title: "One context, infinite paths",
  summary: "A single visual frame preserves the authored creative direction.",
  content_markdown: "1. A designer arranges distinct visual paths around one shared creative context.",
  presentation: null,
  items: [{
    title: "One context reaches every audience",
    body: "An adult designer arranges distinct visual paths around one shared creative context.",
    notes: "Wide establishing shot with warm natural light and clear visual hierarchy.",
    image_prompt: "Editorial wide photograph of an adult designer arranging abstract blank cards around one central creative document, warm natural light.",
    context_group_ids: [],
    slide: null,
  }],
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
    OPENAI_API_KEY: "private-openai-test-key",
    OPENAI_MODEL: "gpt-5.6-terra",
    FAL_KEY: "private-fal-test-key",
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

const json = (body, headers = {}) => ({
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function admitStoryboard(fixture, requestKey = "one-context-storyboard-recovery") {
  const response = await fixture.route("", json({
    kind: "render_document",
    documentId: "doc-atmosphere",
    sourceSurface: "storyboard-recovery-e2e",
    payload: {
      artifactKind: "storyboard",
      productionMode: "manual",
      itemCount: 1,
      paidMediaConfirmed: true,
      requestKey,
    },
  }));
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  return (await response.json()).job;
}

function providerMock({ failPollOnce = true, missingProviderJobId = false } = {}) {
  const previousFetch = globalThis.fetch;
  const calls = [];
  let pollFailed = false;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET");
    calls.push({ url, method, authorization: new Headers(init.headers).get("authorization") });

    if (url.endsWith("/responses")) {
      return Response.json({
        id: "storyboard-planner-response-1",
        model: "gpt-5.6-terra",
        output_text: JSON.stringify(storyboardPlan),
        usage: { input_tokens: 250, output_tokens: 100, total_tokens: 350 },
      });
    }
    if (url.endsWith("/moderations")) {
      return Response.json({
        id: "storyboard-moderation-1",
        model: "omni-moderation-latest",
        results: [{ flagged: false, categories: {}, category_scores: {} }],
      });
    }
    if (url === providerEndpoint && method === "POST") {
      return Response.json(missingProviderJobId
        ? { status: "IN_QUEUE" }
        : { request_id: providerJobId, status: "IN_QUEUE" });
    }
    if (url === `${providerRequestRoot}/status?logs=1`) {
      if (failPollOnce && !pollFailed) {
        pollFailed = true;
        throw new TypeError("The network connection ended after Fal accepted the paid storyboard frame.");
      }
      return Response.json({ request_id: providerJobId, status: "COMPLETED" });
    }
    if (url === providerRequestRoot) {
      return Response.json({
        images: [{ url: mediaUrl, content_type: "image/jpeg", width: 1024, height: 1024 }],
      });
    }
    if (url === mediaUrl) {
      return new Response(Uint8Array.from([255, 216, 255, 219, 0, 1, 255, 217]), {
        headers: { "content-type": "image/jpeg" },
      });
    }

    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };

  return { calls, restore() { globalThis.fetch = previousFetch; } };
}

test("the real owner-scoped storyboard retry resumes one accepted Fal request and settles its original reservations exactly once", async () => {
  const fixture = await routeFixture();
  const provider = providerMock();

  try {
    const admitted = await admitStoryboard(fixture);
    const failedResponse = await fixture.route(`${admitted.jobId}/run`, { method: "POST" });
    assert.equal(failedResponse.status, 200, JSON.stringify(await failedResponse.clone().json()));
    const failedJob = (await failedResponse.json()).job;
    assert.equal(failedJob.status, "failed");
    assert.equal(failedJob.errorDetail.category, "network");
    assert.equal(failedJob.result.storyboardProviderSubmission, "confirmed");
    assert.equal(failedJob.result.providerJobId, providerJobId);
    assert.equal(failedJob.result.providerModel, "ideogram/v4/fast");
    assert.equal(failedJob.result.providerStatusUrl, `${providerRequestRoot}/status`);
    assert.equal(failedJob.result.providerResponseUrl, providerRequestRoot);
    assert.equal(failedJob.result.providerCancelUrl, `${providerRequestRoot}/cancel`);
    assert.equal(failedJob.result.generationReceipt.provider_request_status, "submitted");
    assert.equal(failedJob.result.generationReceipt.source_transmission_status, "transmitted");
    assert.equal(failedJob.result.generationReceipt.settled_cost_microusd, null);

    const tokenReservationId = failedJob.result.reservationId;
    const costReservationId = failedJob.result.costReservationId;
    const originalCorrelation = fixture.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(admitted.jobId).correlation_id;
    assert.ok(tokenReservationId);
    assert.ok(costReservationId);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokenReservationId).status, "active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costReservationId).status, "executing");

    assert.deepEqual(await reconcileFailedBudgetReservations(fixture.env, {
      userId: ownerId,
      billingUserId: ownerId,
      streamId: `creative:${ownerId}`,
    }), { releasedTokens: 0, reservationCount: 0, releasedMicrousd: 0, costReservationCount: 0 });
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokenReservationId).status, "active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costReservationId).status, "executing");

    const retryResponse = await fixture.route(`${admitted.jobId}/retry`, { method: "POST" });
    assert.equal(retryResponse.status, 202, JSON.stringify(await retryResponse.clone().json()));
    const retried = await retryResponse.json();
    assert.equal(retried.reusedProviderRequest, true);
    assert.equal(retried.reusedReservations, true);
    assert.equal(retried.job.status, "queued");
    assert.equal(retried.job.result.providerJobId, providerJobId);
    assert.equal(retried.job.result.reservationId, tokenReservationId);
    assert.equal(retried.job.result.costReservationId, costReservationId);
    assert.equal(fixture.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(admitted.jobId).correlation_id, originalCorrelation);

    const completedResponse = await fixture.route(`${admitted.jobId}/run`, { method: "POST" });
    assert.equal(completedResponse.status, 200, JSON.stringify(await completedResponse.clone().json()));
    const completed = (await completedResponse.json()).job;
    assert.equal(completed.status, "completed", JSON.stringify({
      errorDetail: completed.errorDetail,
      result: completed.result,
      calls: provider.calls,
      retained: fixture.sqlite.prepare("SELECT status,attempt_count,correlation_id,result_json FROM document_jobs WHERE job_id=?").get(admitted.jobId),
    }));

    const falSubmissions = provider.calls.filter((call) => call.url === providerEndpoint && call.method === "POST");
    const falStatusPolls = provider.calls.filter((call) => call.url === `${providerRequestRoot}/status?logs=1`);
    const plannerCalls = provider.calls.filter((call) => call.url.endsWith("/responses"));
    assert.equal(falSubmissions.length, 1, "retry must resume its accepted frame instead of submitting a second paid Fal request");
    assert.equal(falStatusPolls.length, 2, "the resumed request must poll the original accepted Fal queue identifier");
    assert.equal(plannerCalls.length, 1, "the retained paid storyboard plan must not be generated or charged a second time");
    assert.ok(provider.calls.filter((call) => call.url.startsWith("https://queue.fal.run/")).every((call) => call.authorization === "Key private-fal-test-key"));

    const finalCorrelation = fixture.sqlite.prepare("SELECT correlation_id,attempt_count FROM document_jobs WHERE job_id=?").get(admitted.jobId);
    assert.notEqual(finalCorrelation.correlation_id, originalCorrelation, "the recovered attempt receives a fresh owner-scoped execution correlation");
    assert.equal(finalCorrelation.attempt_count, 2);
    const tokenReservation = fixture.sqlite.prepare("SELECT status,used_tokens,correlation_id FROM budget_reservations WHERE reservation_id=?").get(tokenReservationId);
    const costReservation = fixture.sqlite.prepare("SELECT status,used_microusd,correlation_id FROM cost_budget_reservations WHERE reservation_id=?").get(costReservationId);
    assert.equal(tokenReservation.status, "settled");
    assert.equal(tokenReservation.used_tokens, 350);
    assert.equal(tokenReservation.correlation_id, finalCorrelation.correlation_id);
    assert.equal(costReservation.status, "settled");
    assert.ok(Number(costReservation.used_microusd) > 0);
    assert.equal(costReservation.correlation_id, finalCorrelation.correlation_id);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE correlation_id=?").get(finalCorrelation.correlation_id).count, 1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE correlation_id=?").get(finalCorrelation.correlation_id).count, 1);

    const completedEvent = fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' AND correlation_id=?").get(finalCorrelation.correlation_id);
    assert.ok(completedEvent, "the recovered provider image must produce a real immutable completed artifact event");
    const artifact = JSON.parse(completedEvent.payload);
    assert.equal(artifact.artifact_kind, "storyboard");
    assert.equal(artifact.item_count, 1);
    assert.equal(artifact.provider, "fal");
    assert.equal(artifact.provider_job_id, providerJobId);
    assert.ok(fixture.savedMedia.size > 0, "the recovered Fal image must be privately stored before reporting completion");
  } finally {
    provider.restore();
  }
});

test("an ambiguous storyboard submission with no Fal request identifier remains frozen and cannot be retried", async () => {
  const fixture = await routeFixture();
  const provider = providerMock({ missingProviderJobId: true });

  try {
    const admitted = await admitStoryboard(fixture, "unconfirmed-storyboard-submission");
    const failedResponse = await fixture.route(`${admitted.jobId}/run`, { method: "POST" });
    assert.equal(failedResponse.status, 200, JSON.stringify(await failedResponse.clone().json()));
    const failed = (await failedResponse.json()).job;
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorDetail.code, "provider_submission_uncertain");
    assert.equal(failed.result.storyboardProviderSubmission, "pending");
    assert.ok(!failed.result.providerJobId);

    const tokenReservationId = failed.result.reservationId;
    const costReservationId = failed.result.costReservationId;
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokenReservationId).status, "active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costReservationId).status, "executing");

    const retry = await fixture.route(`${admitted.jobId}/retry`, { method: "POST" });
    assert.equal(retry.status, 409, JSON.stringify(await retry.clone().json()));
    assert.equal((await retry.json()).error, "provider_job_not_retryable");
    assert.equal(provider.calls.filter((call) => call.url === providerEndpoint && call.method === "POST").length, 1);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokenReservationId).status, "active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costReservationId).status, "executing");
  } finally {
    provider.restore();
  }
});
