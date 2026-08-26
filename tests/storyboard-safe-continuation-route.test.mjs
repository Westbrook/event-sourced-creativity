import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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

async function admitStoryboard(fixture) {
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
        itemCount: 4,
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

test("owner safely continues a four-frame storyboard after one rejected image while preserving its paid frame and original reservations", async () => {
  const fixture = await routeFixture();
  const provider = providerMock();

  try {
    const admitted = await admitStoryboard(fixture);
    const failedResponse = await fixture.route(`${admitted.jobId}/run`, { method: "POST" });
    assert.equal(failedResponse.status, 200, JSON.stringify(await failedResponse.clone().json()));
    const failed = (await failedResponse.json()).job;
    assert.equal(failed.status, "failed", JSON.stringify({ errorDetail: failed.errorDetail, result: failed.result, calls: provider.calls }));
    assert.equal(failed.errorDetail.category, "safety", JSON.stringify(failed.errorDetail));
    assert.equal(failed.errorDetail.httpStatus, 422);
    assert.equal(failed.errorDetail.retryable, false);
    assert.equal(failed.result.storyboardProviderSubmission, "confirmed");
    assert.equal(failed.result.providerJobId, rejectedFrameId);
    assert.equal(failed.result.renderedItems.length, 1, "the successfully paid first frame must already be durably checkpointed");
    assert.equal(fixture.savedMedia.size, 1);

    const originalTokenId = failed.result.reservationId;
    const originalCostId = failed.result.costReservationId;
    const originalCorrelation = fixture.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(failed.jobId).correlation_id;
    assert.equal(reservationState(fixture, originalTokenId, "budget_reservations").status, "active");
    assert.equal(reservationState(fixture, originalCostId, "cost_budget_reservations").status, "executing");
    assert.equal(reservationState(fixture, originalTokenId, "budget_reservations").correlation_id, originalCorrelation);
    assert.equal(reservationState(fixture, originalCostId, "cost_budget_reservations").correlation_id, originalCorrelation);

    const initialSubmissions = provider.calls.filter((call) => call.url === providerEndpoint && call.method === "POST");
    assert.equal(initialSubmissions.length, 2);
    const rejectedPrompt = initialSubmissions[1].body.prompt;

    const ordinaryRetry = await fixture.route(`${failed.jobId}/retry`, { method: "POST" });
    assert.equal(ordinaryRetry.status, 409, "the provider-rejected request must never be retried directly");
    assert.equal((await ordinaryRetry.json()).error, "provider_job_not_retryable");

    const continuedResponse = await fixture.route(`${failed.jobId}/continue-safer-frames`, { method: "POST" });
    assert.equal(continuedResponse.status, 202, await continuedResponse.clone().text());
    const continued = await continuedResponse.json();
    assert.equal(continued.job.jobId, failed.jobId);
    assert.equal(continued.job.status, "queued");
    assert.equal(continued.job.result.reservationId, originalTokenId);
    assert.equal(continued.job.result.costReservationId, originalCostId);
    assert.equal(continued.job.result.renderedItems.length, 1);
    assert.equal(continued.continuedWithSaferFrames, true);
    assert.equal(continued.reusedReservations, true);
    assert.equal(continued.job.result.storyboardSafeRecovery, undefined, "server-owned recovery authority must not be exposed to clients");
    const trustedCheckpoint = JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?")
      .get(failed.jobId).result_json);
    assert.equal(trustedCheckpoint.storyboardSafeRecovery.enabled, true);
    assert.equal(trustedCheckpoint.storyboardSafeRecovery.failedFrameIndex, 1);
    assert.equal(trustedCheckpoint.storyboardSafeRecovery.rejectedProviderJobId, rejectedFrameId);
    assert.equal(trustedCheckpoint.storyboardSafeRecovery.rejectedPromptSha256, sha256(rejectedPrompt));
    assert.equal(trustedCheckpoint.storyboardSafeRecovery.maxAttempts, 1);
    assert.ok(Date.parse(trustedCheckpoint.storyboardSafeRecovery.attemptedAt));
    assert.equal(trustedCheckpoint.storyboardRejectedProviderReceipt.providerJobId, rejectedFrameId);
    assert.equal(trustedCheckpoint.storyboardRejectedProviderReceipt.promptSha256, sha256(rejectedPrompt));
    assert.equal(fixture.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(failed.jobId).correlation_id,
      originalCorrelation, "continuation must retain the already-owned reservation correlation until execution handoff");
    assert.equal(reservationState(fixture, originalTokenId, "budget_reservations").status, "active");
    assert.equal(reservationState(fixture, originalCostId, "cost_budget_reservations").status, "executing");

    const duplicateContinuation = await fixture.route(`${failed.jobId}/continue-safer-frames`, { method: "POST" });
    assert.equal(duplicateContinuation.status, 409, "safe continuation must be bounded to one explicit owner-approved attempt");

    const completedResponse = await fixture.route(`${failed.jobId}/run`, { method: "POST" });
    assert.equal(completedResponse.status, 200, JSON.stringify(await completedResponse.clone().json()));
    const completed = (await completedResponse.json()).job;
    assert.equal(completed.status, "completed", JSON.stringify({ errorDetail: completed.errorDetail, result: completed.result, calls: provider.calls }));

    const submissions = provider.calls.filter((call) => call.url === providerEndpoint && call.method === "POST");
    assert.equal(submissions.length, 5, "only the first accepted frame, rejected frame, safer replacement, and remaining two frames may be submitted");
    assert.notEqual(submissions[2].body.prompt, rejectedPrompt, "the replacement must have a meaningfully changed, safer provider prompt");
    assert.notEqual(sha256(submissions[2].body.prompt), sha256(rejectedPrompt));
    assert.equal(provider.calls.filter((call) => call.url === queueRoot(rejectedFrameId)).length, 1,
      "the terminally rejected Fal request must never be polled, downloaded, or retried again");
    assert.equal(provider.calls.filter((call) => call.url === queueRoot(initialFrameId)).length, 1,
      "the completed first frame must not be polled, downloaded, or charged a second time");
    assert.equal(provider.calls.filter((call) => call.url.endsWith("/responses")).length, 1,
      "continuation must reuse the original paid storyboard plan");
    assert.equal(fixture.savedMedia.size, 4, "exactly four genuine storyboard images must be privately stored");

    const finalCorrelation = fixture.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(failed.jobId).correlation_id;
    assert.equal(reservationState(fixture, originalTokenId, "budget_reservations").status, "settled");
    assert.equal(reservationState(fixture, originalCostId, "cost_budget_reservations").status, "settled");
    assert.equal(reservationState(fixture, originalTokenId, "budget_reservations").correlation_id, finalCorrelation);
    assert.equal(reservationState(fixture, originalCostId, "cost_budget_reservations").correlation_id, finalCorrelation);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE owner_id=? AND operation='document-render:storyboard'").get(ownerId).count, 1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE owner_id=? AND operation='document-render:storyboard'").get(ownerId).count, 1);

    const completedEvent = fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' AND correlation_id=?").get(finalCorrelation);
    const artifact = JSON.parse(completedEvent.payload);
    assert.equal(artifact.artifact_kind, "storyboard");
    assert.equal(artifact.item_count, 4);
    assert.equal(artifact.provider, "fal");
    const privateArtifact = fixture.sqlite.prepare("SELECT owner_id,kind,content FROM private_content WHERE content_id=?")
      .get(artifact.content_ref);
    assert.equal(privateArtifact.owner_id, ownerId);
    assert.equal(privateArtifact.kind, "document-artifact");
    assert.equal(JSON.parse(privateArtifact.content).items.length, 4);
  } finally {
    provider.restore();
  }
});
