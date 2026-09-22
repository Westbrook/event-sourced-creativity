import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../worker/index.ts";
import { seedLegacyStoryboard, LEGACY_STORYBOARD_PROMPT } from "./legacy-storyboard-recovery-fixture.mjs";

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
const providerModel = "ideogram/v4/fast";
const providerEndpoint = `https://queue.fal.run/${providerModel}`;
const historyEndpoint = "https://api.fal.ai/v1/models/requests/by-endpoint";
const recoveredProviderJobId = "owned-reconciled-storyboard-frame-01";
const queueRoot = (requestId) => `https://queue.fal.run/ideogram/v4/requests/${requestId}`;
const mediaUrl = (requestId) => `https://cdn.fal.media/${requestId}.jpg`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const storyboardPlan = (itemCount) => ({
  title: "One context, infinite paths",
  summary: "One protected context reaches every audience through its own visual path.",
  content_markdown: "The storyteller and audience choose among four distinct contextual paths.",
  presentation: null,
  items: Array.from({ length: itemCount }, (_, index) => ({
    title: `One context reaches audience ${index + 1}`,
    body: `An adult designer arranges distinct visual path ${index + 1} around one shared creative context.`,
    notes: `Wide establishing shot ${index + 1} with warm natural light and clear visual hierarchy.`,
    image_prompt: `Editorial wide photograph ${index + 1} of an adult designer arranging abstract blank cards around one central creative document, warm natural light.`,
    context_group_ids: [],
    slide: null,
  })),
});

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
    OPENAI_API_KEY: "private-openai-reconciliation-test-key",
    OPENAI_MODEL: "gpt-5.6-terra",
    FAL_KEY: "private-fal-reconciliation-test-key",
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

async function admitStoryboard(fixture, itemCount = 1) {
  const response = await fixture.route("", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "render_document",
      documentId: "doc-atmosphere",
      sourceSurface: "storyboard-provider-reconciliation-e2e",
      payload: {
        artifactKind: "storyboard",
        productionMode: "manual",
        itemCount,
        paidMediaConfirmed: true,
        requestKey: `storyboard-provider-reconciliation-${itemCount}`,
      },
    }),
  });
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  return (await response.json()).job;
}

function providerMock(fixture, { itemCount = 1, historyMode = "unique" } = {}) {
  const previousFetch = globalThis.fetch;
  const calls = [];
  let firstPrompt = LEGACY_STORYBOARD_PROMPT;
  let submissions = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body, authorization: new Headers(init.headers).get("authorization") });

    if (url.endsWith("/responses")) {
      return Response.json({
        id: "storyboard-reconciliation-planner-response-1",
        model: "gpt-5.6-terra",
        output_text: JSON.stringify(storyboardPlan(itemCount)),
        usage: { input_tokens: 250, output_tokens: 100, total_tokens: 350 },
      });
    }
    if (url.endsWith("/moderations")) {
      return Response.json({
        id: "storyboard-reconciliation-moderation-1",
        model: "omni-moderation-latest",
        results: [{ flagged: false, categories: {}, category_scores: {} }],
      });
    }
    if (url === providerEndpoint && method === "POST") {
      submissions += 1;
      if (submissions === 1) {
        firstPrompt = String(body.prompt);
        return Response.json({ status: "IN_QUEUE" });
      }
      return Response.json({ request_id: `owned-remaining-storyboard-frame-${submissions}`, status: "COMPLETED" });
    }
    if (url.startsWith(`${historyEndpoint}?`) && method === "GET") {
      const checkpoint = fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 1").get();
      const requestedAt = JSON.parse(checkpoint.result_json).storyboardProviderRequestedAt;
      const valid = (requestId = recoveredProviderJobId) => ({
        request_id: requestId,
        endpoint_id: providerModel,
        sent_at: requestedAt,
        status_code: 200,
        json_input: { prompt: firstPrompt },
      });
      const items = historyMode === "ambiguous"
        ? [valid(), valid("second-indistinguishable-storyboard-frame")]
        : historyMode === "no-match"
          ? [
            { ...valid("foreign-model-frame"), endpoint_id: "ideogram/v4" },
            { ...valid("foreign-prompt-frame"), json_input: { prompt: `${firstPrompt} changed` } },
            { ...valid("stale-frame"), sent_at: new Date(Date.parse(requestedAt) - 121_000).toISOString() },
            { ...valid("rejected-frame"), status_code: 429 },
            valid("../foreign-owner-frame"),
          ]
          : [valid()];
      return Response.json({ items });
    }

    const statusMatch = /^https:\/\/queue\.fal\.run\/ideogram\/v4\/requests\/([^/]+)\/status\?logs=1$/u.exec(url);
    if (statusMatch) return Response.json({ request_id: statusMatch[1], status: "COMPLETED" });

    const responseMatch = /^https:\/\/queue\.fal\.run\/ideogram\/v4\/requests\/([^/]+)$/u.exec(url);
    if (responseMatch) {
      return Response.json({
        images: [{ url: mediaUrl(responseMatch[1]), content_type: "image/jpeg", width: 1024, height: 1024 }],
      });
    }
    if (url.startsWith("https://cdn.fal.media/")) {
      return new Response(Uint8Array.from([255, 216, 255, 219, 0, 1, 255, 217]), {
        headers: { "content-type": "image/jpeg" },
      });
    }

    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };

  return { calls, firstPrompt: () => firstPrompt, restore() { globalThis.fetch = previousFetch; } };
}

function reservationStates(fixture, failed) {
  const tokenReservationId = failed.result.reservationId;
  const costReservationId = failed.result.costReservationId;
  return {
    tokenReservationId,
    costReservationId,
    token: fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokenReservationId).status,
    cost: fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costReservationId).status,
  };
}

async function failedUnknownStoryboard(fixture) {
  const admitted = await admitStoryboard(fixture);
  const failed = await seedLegacyStoryboard(fixture, admitted, storyboardPlan(1));
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorDetail.code, "provider_submission_uncertain");
  assert.equal(failed.result.storyboardProviderSubmission, "pending");
  assert.ok(!failed.result.providerJobId);
  assert.equal(reservationStates(fixture, failed).token, "active");
  assert.equal(reservationStates(fixture, failed).cost, "executing");
  return failed;
}

test("an owner reconciles the exact already-paid Fal storyboard request and completes its original job without duplicate submission", async () => {
  const fixture = await routeFixture();
  const provider = providerMock(fixture);

  try {
    const failed = await failedUnknownStoryboard(fixture);
    const originalCheckpoint = JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(failed.jobId).result_json);
    const originalSubmission = Object.values(originalCheckpoint.providerSubmissions).find((entry) => entry.status === "pending");
    assert.equal(originalSubmission.operation, "image");
    const originalReservations = reservationStates(fixture, failed);
    const originalCorrelation = fixture.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(failed.jobId).correlation_id;
    const failedEvent = fixture.sqlite.prepare("SELECT json_extract(payload,'$.prompt_ref') AS prompt_ref FROM events WHERE correlation_id=? AND type='DocumentRenderFailed'").get(originalCorrelation);
    assert.ok(failedEvent.prompt_ref, "the exact original provider prompt must survive as owner-private evidence");
    const privatePrompt = fixture.sqlite.prepare("SELECT owner_id,kind,content FROM private_content WHERE content_id=?").get(failedEvent.prompt_ref);
    assert.equal(privatePrompt.owner_id, ownerId);
    assert.equal(privatePrompt.kind, "prompt");
    assert.equal(sha256(privatePrompt.content), sha256(provider.firstPrompt()), "only the exact accepted provider prompt can identify the paid request");

    const reconciledResponse = await fixture.route(`${failed.jobId}/reconcile-provider`, { method: "POST" });
    assert.equal(reconciledResponse.status, 200, JSON.stringify(await reconciledResponse.clone().json()));
    const reconciled = await reconciledResponse.json();
    assert.equal(reconciled.reconciledProviderRequest, true);
    assert.equal(reconciled.job.jobId, failed.jobId);
    assert.equal(reconciled.job.status, "failed", "receipt reconciliation must not start paid generation by itself");
    assert.equal(reconciled.job.errorDetail.code, "execution_interrupted");
    assert.equal(reconciled.job.errorDetail.retryable, true);
    assert.equal(reconciled.job.result.storyboardProviderSubmission, "confirmed");
    assert.equal(reconciled.job.result.providerJobId, recoveredProviderJobId);
    assert.equal(reconciled.job.result.providerModel, providerModel);
    assert.equal(reconciled.job.result.providerStatusUrl, `${queueRoot(recoveredProviderJobId)}/status`);
    assert.equal(reconciled.job.result.providerResponseUrl, queueRoot(recoveredProviderJobId));
    assert.equal(reconciled.job.result.providerCancelUrl, `${queueRoot(recoveredProviderJobId)}/cancel`);
    assert.equal(reconciled.job.result.generationReceipt.provider_request_status, "submitted");
    assert.equal(reconciled.job.result.generationReceipt.source_transmission_status, "transmitted");
    assert.equal(reconciled.job.result.generationReceipt.settled_cost_microusd, null);
    assert.deepEqual(reservationStates(fixture, reconciled.job), originalReservations);
    const reconciledCheckpoint = JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(failed.jobId).result_json);
    assert.equal(reconciledCheckpoint.providerSubmissions[originalSubmission.clientRequestId].status, "accepted");
    assert.equal(reconciledCheckpoint.providerSubmissions[originalSubmission.clientRequestId].providerRequestId, recoveredProviderJobId);

    const histories = provider.calls.filter((call) => call.url.startsWith(`${historyEndpoint}?`));
    assert.equal(histories.length, 1);
    assert.equal(histories[0].method, "GET", "provider reconciliation can only inspect history; it must not submit paid work");
    assert.equal(histories[0].authorization, "Key private-fal-reconciliation-test-key");
    const historyQuery = new URL(histories[0].url).searchParams;
    assert.equal(historyQuery.get("endpoint_id"), providerModel);
    assert.equal(historyQuery.get("start"), new Date(Date.parse(failed.result.storyboardProviderRequestedAt) - 120_000).toISOString());
    assert.equal(historyQuery.get("limit"), "25");
    assert.equal(historyQuery.get("expand"), "payloads");
    assert.equal(histories[0].url.includes(provider.firstPrompt()), false, "the private creative prompt must never be exposed in the management URL");
    assert.equal(provider.calls.filter((call) => call.url === providerEndpoint && call.method === "POST").length, 0);

    const retriedResponse = await fixture.route(`${failed.jobId}/retry`, { method: "POST" });
    assert.equal(retriedResponse.status, 202, JSON.stringify(await retriedResponse.clone().json()));
    const retried = await retriedResponse.json();
    assert.equal(retried.reusedProviderRequest, true);
    assert.equal(retried.reusedReservations, true);
    assert.equal(retried.job.result.reservationId, originalReservations.tokenReservationId);
    assert.equal(retried.job.result.costReservationId, originalReservations.costReservationId);

    const completedResponse = await fixture.route(`${failed.jobId}/run`, { method: "POST" });
    assert.equal(completedResponse.status, 200, JSON.stringify(await completedResponse.clone().json()));
    const completed = (await completedResponse.json()).job;
    assert.equal(completed.status, "completed", JSON.stringify({ errorDetail: completed.errorDetail, result: completed.result, calls: provider.calls }));
    assert.equal(provider.calls.filter((call) => call.url === providerEndpoint && call.method === "POST").length, 0,
      "recovery must never submit a second paid Fal request for the accepted frame");
    assert.equal(provider.calls.filter((call) => call.url.endsWith("/responses")).length, 0,
      "the already-paid storyboard planner must never be called again");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?")
      .get(originalReservations.tokenReservationId).status, "settled");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?")
      .get(originalReservations.costReservationId).status, "settled");
    assert.equal(fixture.savedMedia.size, 1);
    const completedEvent = fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' AND correlation_id=?")
      .get(fixture.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(failed.jobId).correlation_id);
    const artifact = JSON.parse(completedEvent.payload);
    assert.equal(artifact.artifact_kind, "storyboard");
    assert.equal(artifact.item_count, 1);
    assert.equal(artifact.provider, "fal");
    assert.equal(artifact.provider_job_id, recoveredProviderJobId);
  } finally {
    provider.restore();
  }
});

for (const previousEvidence of ["submission", "frame"]) {
  test(`provider reconciliation never reassigns a request already owned by a prior ${previousEvidence}`, async () => {
    const fixture = await routeFixture();
    const provider = providerMock(fixture);
    try {
      const failed = await failedUnknownStoryboard(fixture);
      const checkpoint = JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(failed.jobId).result_json);
      const pending = Object.values(checkpoint.providerSubmissions).find((entry) => entry.status === "pending");
      if (previousEvidence === "submission") {
        checkpoint.providerSubmissions["prior-paid-frame"] = { clientRequestId: "prior-paid-frame", provider: "fal", operation: "image", model: providerModel, unitId: "previous-unit", status: "completed", providerRequestId: recoveredProviderJobId, costMicrousd: 46516 };
      } else {
        checkpoint.renderedItems = [{ media_url: "/api/media/prior-frame", provider_request_id: recoveredProviderJobId, cost_microusd: 46516 }];
        pending.unitId = "frame:2";
      }
      fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint), failed.jobId);
      const response = await fixture.route(`${failed.jobId}/reconcile-provider`, { method: "POST" });
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal((await response.json()).error, "provider_receipt_not_found");
      const preserved = JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(failed.jobId).result_json);
      assert.equal(preserved.providerSubmissions[pending.clientRequestId].status, "pending");
      assert.equal(reservationStates(fixture, failed).cost, "executing");
      assert.equal(provider.calls.filter((call) => call.url === providerEndpoint && call.method === "POST").length, 0);
    } finally {
      provider.restore();
    }
  });
}
