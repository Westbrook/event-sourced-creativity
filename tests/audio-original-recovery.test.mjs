import test from "node:test";
import assert from "node:assert/strict";
import { AUDIO_ADAPTER_CONTRACT, MAX_AUDIO_UPLOAD_BYTES } from "../src/model/audio.ts";
import { recoverAcceptedAudio, verifiedAudioRecoveryQueue } from "../worker/fal-audio-adapter.ts";

const model = AUDIO_ADAPTER_CONTRACT.model;
const requestId = "req-original-audio-001";
const queueRoot = `https://queue.fal.run/fal-ai/lyria3/requests/${requestId}`;
const mediaUrl = "https://v3b.fal.media/files/original-recording.mp3";
const bytes = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
const environment = { FAL_KEY: "mock-original-audio-key", FAL_AUDIO_MODEL: "do-not-select-a-new-model" };

function recoveryOptions() {
  return {
    providerJobId: requestId,
    providerModel: model,
    providerStatusUrl: `${queueRoot}/status`,
    providerResponseUrl: queueRoot,
    providerCancelUrl: `${queueRoot}/cancel`,
    profile: { goal: "music", role: "score", destination: "standalone", requireInstrumental: true },
    retainedReceipt: {
      provider: "fal",
      model,
      submittedPrompt: "The original approved instrumental piano and cello arrangement.",
      parameters: { accepted_fields: ["prompt"], published_cost_microusd: 80_000 },
      imageReference: null,
      sourceAudioTreatment: "authored-description-only",
      audioWaveformSubmitted: false,
    },
  };
}

const originalResult = (audio = {}) => ({
  request_id: requestId,
  audio: { url: mediaUrl, content_type: "audio/mpeg", file_name: "original-recording.mp3", file_size: bytes.length, ...audio },
  lyrics: "Original instrumental cue notes.",
});

/** Every request is intercepted; the real fetch is never delegated to. */
async function withMockAudio(scenario, operation) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (value, init = {}) => {
    const url = String(value);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method, init });
    assert.equal(method, "GET", "Accepted-audio recovery must never submit, upload, or cancel");
    assert.equal(init.body, undefined, "Recovery must not transmit a new source payload");
    if (init.signal?.aborted) throw new DOMException("Recovery canceled", "AbortError");
    if (scenario.handle) {
      const response = await scenario.handle({ url, method, init, calls });
      if (response !== undefined) return response;
    }
    if (url === `${queueRoot}/status?logs=1`) return Response.json(scenario.status ?? { status: "COMPLETED", request_id: requestId });
    if (url === queueRoot) return Response.json(scenario.result ?? originalResult());
    if (url === (scenario.mediaUrl ?? mediaUrl)) {
      return scenario.download ? scenario.download() : new Response(bytes, { headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`Unexpected recovery request: ${method} ${url}`);
  };
  try {
    return await operation(calls);
  } finally {
    globalThis.fetch = previous;
    assert.ok(calls.every((call) => call.method === "GET"), "No POST, PUT, DELETE, or other provider mutation is allowed");
    assert.ok(calls.every((call) => call.init.body === undefined), "No source, image, or audio bytes may be uploaded");
    for (const call of calls) {
      assert.equal(call.init.redirect, "manual", "All recovery reads must refuse automatic redirects");
      if (new URL(call.url).origin === "https://queue.fal.run") {
        assert.equal(new Headers(call.init.headers).get("authorization"), `Key ${environment.FAL_KEY}`);
      } else {
        assert.equal(new Headers(call.init.headers).has("authorization"), false, "Fal credentials must not reach media storage");
      }
    }
  }
}

const failureCode = (code) => (error) => error.detail?.code === code && error.detail?.requestId === requestId;

test("original audio recovery binds the canonical application-level queue to its pinned model and request", () => {
  const options = recoveryOptions();
  assert.deepEqual(verifiedAudioRecoveryQueue(model, requestId, options), {
    statusUrl: `${queueRoot}/status`, responseUrl: queueRoot, cancelUrl: `${queueRoot}/cancel`,
  });
});

test("original audio recovery performs three GETs and preserves the accepted receipt without replanning or uploads", async () => {
  await withMockAudio({}, async (calls) => {
    const options = recoveryOptions();
    options.retainedReceipt.imageReference = { reference_id: "original-approved-image", sha256: "retained-reference-digest", pixels_submitted: true };
    options.imageReference = { bytes: new Uint8Array([4, 5, 6]), mimeType: "image/png", blockId: "old-image", referenceId: "old-reference", label: "Never upload again" };
    const before = structuredClone(options);
    const audio = await recoverAcceptedAudio(environment, options);
    assert.deepEqual(calls.map((call) => call.url), [`${queueRoot}/status?logs=1`, queueRoot, mediaUrl]);
    assert.equal(audio.provider, "fal");
    assert.equal(audio.providerJobId, requestId);
    assert.equal(audio.model, model);
    assert.equal(audio.submittedPrompt, before.retainedReceipt.submittedPrompt);
    assert.deepEqual(audio.preparedReceipt, before.retainedReceipt);
    assert.deepEqual(options, before, "Recovery must not rewrite the original input receipt");
    assert.deepEqual(audio.bytes, bytes);
    assert.equal(audio.mimeType, "audio/mpeg");
    assert.equal(audio.costMicrousd, 80_000, "This is original provider cost evidence, not a new settlement");
    assert.equal(audio.lyrics, "Original instrumental cue notes.");
  });
});

test("original audio recovery retains an accepted historical prompt beyond today's admission limit", async () => {
  await withMockAudio({}, async (calls) => {
    const options = recoveryOptions();
    options.retainedReceipt.submittedPrompt = "Original accepted musical direction. ".repeat(200);
    assert.ok(options.retainedReceipt.submittedPrompt.length > AUDIO_ADAPTER_CONTRACT.maxPromptCharacters);
    const audio = await recoverAcceptedAudio(environment, options);
    assert.equal(audio.submittedPrompt, options.retainedReceipt.submittedPrompt);
    assert.equal(calls.length, 3);
  });
});

const invalidIdentities = [
  ["missing request ID", (options) => { delete options.providerJobId; }],
  ["empty request ID", (options) => { options.providerJobId = ""; }],
  ["placeholder request ID", (options) => { options.providerJobId = "SuBmItTeD"; }],
  ["path-shaped request ID", (options) => { options.providerJobId = "../another-request"; }],
  ["oversized request ID", (options) => { options.providerJobId = "a".repeat(201); }],
  ["contradictory request ID", (options) => { options.providerJobId = "another-accepted-request"; }],
  ["missing model", (options) => { delete options.providerModel; }],
  ["unapproved model", (options) => { options.providerModel = "fal-ai/unapproved-audio"; }],
  ["contradictory receipt model", (options) => { options.retainedReceipt.model = "fal-ai/stable-audio"; }],
  ["contradictory receipt provider", (options) => { options.retainedReceipt.provider = "another-provider"; }],
  ["missing receipt", (options) => { delete options.retainedReceipt; }],
  ["missing accepted prompt", (options) => { options.retainedReceipt.submittedPrompt = ""; }],
  ["whitespace-only accepted prompt", (options) => { options.retainedReceipt.submittedPrompt = " \n\t "; }],
  ["contradictory waveform submission", (options) => { options.retainedReceipt.audioWaveformSubmitted = true; }],
  ["missing cost evidence", (options) => { delete options.retainedReceipt.parameters.published_cost_microusd; }],
  ["zero cost evidence", (options) => { options.retainedReceipt.parameters.published_cost_microusd = 0; }],
  ["negative cost evidence", (options) => { options.retainedReceipt.parameters.published_cost_microusd = -1; }],
  ["nonfinite cost evidence", (options) => { options.retainedReceipt.parameters.published_cost_microusd = Infinity; }],
  ["fractional cost evidence", (options) => { options.retainedReceipt.parameters.published_cost_microusd = 80_000.5; }],
];
for (const [name, mutate] of invalidIdentities) {
  test(`original audio recovery rejects ${name} before fetching`, async () => {
    await withMockAudio({}, async (calls) => {
      const options = recoveryOptions();
      mutate(options);
      await assert.rejects(() => recoverAcceptedAudio(environment, options));
      assert.equal(calls.length, 0, name);
    });
  });
}

for (const field of ["providerStatusUrl", "providerResponseUrl", "providerCancelUrl"]) {
  test(`original audio recovery rejects missing or contradictory ${field} before fetching`, async () => {
    const canonical = recoveryOptions()[field];
    const invalidUrls = [
      undefined, "", canonical.replace(requestId, "different-request"), canonical.replace("/lyria3/", "/another-model/"),
      canonical.replace("https:", "http:"), canonical.replace("queue.fal.run", "queue.fal.run.invalid"),
      canonical.replace("https://", "https://user:password@"), canonical.replace("queue.fal.run", "queue.fal.run:8443"),
      `${canonical}?redirect=elsewhere`, `${canonical}#different-receipt`, `${canonical}/extra`,
    ];
    for (const value of invalidUrls) {
      await withMockAudio({}, async (calls) => {
        const options = recoveryOptions();
        options[field] = value;
        await assert.rejects(() => recoverAcceptedAudio(environment, options), failureCode("audio_recovery_receipt_invalid"));
        assert.equal(calls.length, 0, String(value));
      });
    }
  });
}

test("original audio recovery refuses unavailable provider configuration without falling back", async () => {
  for (const env of [{}, { FAL_KEY: " " }, { ...environment, FORMA_AUDIO_PROVIDER: "another-provider" }]) {
    await withMockAudio({}, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(env, recoveryOptions()), (error) => error.detail?.code === "audio_provider_not_configured");
      assert.equal(calls.length, 0);
    });
  }
});

for (const phase of ["status", "result"]) {
  test(`original audio recovery rejects an echoed ${phase} request ID mismatch`, async () => {
    const scenario = phase === "status"
      ? { status: { status: "COMPLETED", request_id: "different-paid-recording" } }
      : { result: { ...originalResult(), request_id: "different-paid-recording" } };
    await withMockAudio(scenario, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), failureCode("fal_audio_receipt_mismatch"));
      assert.equal(calls.length, phase === "status" ? 1 : 2);
    });
  });

  test(`original audio recovery rejects a ${phase} error despite otherwise completed audio evidence`, async () => {
    const error = { message: "The original provider operation was rejected." };
    const scenario = phase === "status"
      ? { status: { status: "COMPLETED", request_id: requestId, error } }
      : { result: { ...originalResult(), error } };
    await withMockAudio(scenario, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), (failure) =>
        failureCode("fal_audio_result_rejected")(failure)
        && failure.detail?.httpStatus === 422 && failure.detail?.retryable === false);
      assert.equal(calls.length, phase === "status" ? 1 : 2);
      assert.equal(calls.some((call) => call.url === mediaUrl), false, "Rejected evidence must not be published as playable audio");
    });
  });

  test(`original audio recovery rejects ${phase} redirects without following or submitting`, async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const redirectUrl = phase === "status" ? `${queueRoot}/status?logs=1` : queueRoot;
      await withMockAudio({ handle: ({ url }) => url === redirectUrl
        ? new Response(null, { status, headers: { location: "https://untrusted.invalid/recording" } }) : undefined }, async (calls) => {
        await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), (error) => error.detail?.httpStatus === status);
        assert.equal(calls.length, phase === "status" ? 1 : 2);
        assert.equal(calls.some((call) => call.url.includes("untrusted.invalid")), false);
      });
    }
  });

  test(`original audio recovery respects a terminal ${phase} provider rejection`, async () => {
    const rejectedUrl = phase === "status" ? `${queueRoot}/status?logs=1` : queueRoot;
    await withMockAudio({ handle: ({ url }) => url === rejectedUrl
      ? Response.json({ error: { message: "The generated audio was blocked by the safety filter." } }, { status: 422 }) : undefined }, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), (error) => error.detail?.httpStatus === 422 && error.detail?.category === "safety" && error.detail?.retryable === false);
      assert.equal(calls.length, phase === "status" ? 1 : 2);
    });
  });
}

for (const status of ["FAILED", "CANCELLED"]) {
  test(`original audio recovery does not resume a ${status} provider recording`, async () => {
    await withMockAudio({ status: { status, request_id: requestId } }, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), (error) =>
        error.detail?.code === `fal_audio_${status.toLowerCase()}` && error.detail?.httpStatus === 422 && error.detail?.retryable === false);
      assert.equal(calls.length, 1);
    });
  });
}

test("original audio recovery rejects an unrecognized status without requesting a result", async () => {
  await withMockAudio({ status: { status: "SOMETHING_ELSE" } }, async (calls) => {
    await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), failureCode("fal_audio_status_invalid"));
    assert.equal(calls.length, 1);
  });
});

test("original audio recovery rejects a completed result without audio instead of generating a replacement", async () => {
  await withMockAudio({ result: { request_id: requestId } }, async (calls) => {
    await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), failureCode("fal_audio_result_missing"));
    assert.equal(calls.length, 2);
  });
});

for (const phase of ["before-start", "polling", "downloading"]) {
  test(`original audio recovery aborts during ${phase} without canceling the original provider request`, async () => {
    const controller = new AbortController();
    const abort = () => controller.abort(new DOMException("Recovery canceled", "AbortError"));
    const scenario = phase === "polling" ? { status: { status: "IN_PROGRESS", request_id: requestId } }
      : phase === "downloading" ? { handle: ({ url }) => { if (url === mediaUrl) { abort(); throw controller.signal.reason; } } } : {};
    if (phase === "before-start") abort();
    await withMockAudio(scenario, async (calls) => {
      const options = { ...recoveryOptions(), signal: controller.signal, onStage: (stage) => { if (phase === "polling" && stage === "rendering-audio") abort(); } };
      await assert.rejects(() => recoverAcceptedAudio(environment, options), (error) => error.name === "AbortError" || error.detail?.category === "canceled");
      assert.ok(controller.signal.aborted);
      assert.ok(calls.length <= (phase === "downloading" ? 3 : 1));
      assert.equal(calls.some((call) => call.url.endsWith("/cancel")), false);
    });
  });
}

test("original audio recovery rejects media outside its trusted HTTPS authority before downloading", async () => {
  for (const url of [
    "http://fal.media/recording.mp3", "https://fal.media.untrusted.invalid/recording.mp3", "https://untrusted.invalid/recording.mp3",
    "https://user:password@fal.media/recording.mp3", "https://fal.media:8443/recording.mp3",
    "file:///private/recording.mp3", "data:audio/mpeg;base64,AQID", "not-a-url",
  ]) {
    await withMockAudio({ result: originalResult({ url }) }, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), (error) =>
        ["fal_audio_url_untrusted", "fal_audio_url_invalid"].includes(error.detail?.code));
      assert.equal(calls.length, 2, url);
    });
  }
});

test("original audio recovery rejects media redirects without following or leaking credentials", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    await withMockAudio({ download: () => new Response(null, { status, headers: { location: "https://untrusted.invalid/audio.mp3" } }) }, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), (error) =>
        error.detail?.code === "fal_audio_download_failed" && error.detail?.httpStatus === status);
      assert.equal(calls.length, 3);
    });
  }
});

for (const [name, advertised, downloaded] of [
  ["unsupported advertised audio", "audio/wav", "audio/wav"],
  ["non-audio response", undefined, "text/html"],
  ["HTML hidden behind an advertised MPEG type", "audio/mpeg", "text/html"],
  ["unsupported downloaded audio hidden behind an advertised MPEG type", "audio/mpeg", "audio/wav"],
]) {
  test(`original audio recovery rejects ${name}`, async () => {
    await withMockAudio({ result: originalResult({ content_type: advertised }), download: () => new Response(bytes, { headers: { "content-type": downloaded } }) }, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), failureCode("fal_audio_type_invalid"));
      assert.equal(calls.length, 3);
    });
  });
}

test("original audio recovery permits a binary media response when the original provider identifies MPEG", async () => {
  await withMockAudio({ download: () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } }) }, async () => {
    assert.equal((await recoverAcceptedAudio(environment, recoveryOptions())).mimeType, "audio/mpeg");
  });
});

for (const evidence of ["provider file size", "HTTP content length"]) {
  test(`original audio recovery enforces the media size limit from ${evidence}`, async () => {
    await withMockAudio({
      result: originalResult({ file_size: evidence === "provider file size" ? MAX_AUDIO_UPLOAD_BYTES + 1 : undefined }),
      download: () => new Response(bytes, { headers: { "content-type": "audio/mpeg", ...(evidence === "HTTP content length" ? { "content-length": String(MAX_AUDIO_UPLOAD_BYTES + 1) } : {}) } }),
    }, async (calls) => {
      await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), failureCode("fal_audio_too_large"));
      assert.equal(calls.length, 3);
    });
  });
}

test("original audio recovery enforces streamed bytes even when the provider understates file size", async () => {
  let canceled = false;
  await withMockAudio({
    result: originalResult({ file_size: 1 }),
    download: () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_AUDIO_UPLOAD_BYTES)); controller.enqueue(new Uint8Array([1])); },
      cancel() { canceled = true; },
    }), { headers: { "content-type": "audio/mpeg" } }),
  }, async (calls) => {
    await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), failureCode("fal_audio_too_large"));
    assert.equal(canceled, true, "The oversized local download stream must be canceled, not the provider job");
    assert.equal(calls.length, 3);
  });
});

test("original audio recovery enforces the size limit for an arrayBuffer-only response", async () => {
  await withMockAudio({
    result: originalResult({ file_size: 1 }),
    download: () => ({ ok: true, headers: new Headers({ "content-type": "audio/mpeg" }), body: null, arrayBuffer: async () => new ArrayBuffer(MAX_AUDIO_UPLOAD_BYTES + 1) }),
  }, async (calls) => {
    await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), failureCode("fal_audio_too_large"));
    assert.equal(calls.length, 3);
  });
});

test("original audio recovery rejects an empty recording", async () => {
  await withMockAudio({ download: () => new Response(new Uint8Array(), { headers: { "content-type": "audio/mpeg" } }) }, async (calls) => {
    await assert.rejects(() => recoverAcceptedAudio(environment, recoveryOptions()), failureCode("fal_audio_empty"));
    assert.equal(calls.length, 3);
  });
});
