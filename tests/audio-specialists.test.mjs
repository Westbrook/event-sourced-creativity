import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_ADAPTER_CONTRACTS,
  AudioAdapterSelectionError,
  GEMINI_TTS_ADAPTER_CONTRACT,
  LYRIA_AUDIO_ADAPTER_CONTRACT,
  SEED_AUDIO_ADAPTER_CONTRACT,
  SONILO_MUSIC_ADAPTER_CONTRACT,
  SONILO_SOUND_EFFECTS_ADAPTER_CONTRACT,
  SONILO_VIDEO_MUSIC_ADAPTER_CONTRACT,
  SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT,
  STABLE_AUDIO_ADAPTER_CONTRACT,
  audioAuthoringConflict,
  estimateAudioProviderCostMicrousd,
  normalizeAudioRequestProfile,
  selectAudioAdapterContract,
} from "../src/model/audio.ts";
import { artifactContextEvents } from "../src/model/output-context.ts";
import { presentationServerOwnedCheckpointField } from "../src/model/generation-budget.ts";
import { serializeGeminiSpeechRequest } from "../worker/audio-adapters/gemini-tts.ts";
import { serializeLyriaAudioRequest } from "../worker/audio-adapters/lyria.ts";
import { serializeSeedAudioRequest } from "../worker/audio-adapters/seed-audio.ts";
import { serializeSoniloAudioRequest } from "../worker/audio-adapters/sonilo.ts";
import { serializeStableAudioRequest } from "../worker/audio-adapters/stable-audio.ts";
import { adaptAudioPrompt } from "../worker/audio-prompt-adapter.ts";
import { selectAudioAdapter } from "../worker/audio-selection.ts";
import { generateCreativeAudio } from "../worker/fal-audio-adapter.ts";
import { interruptedDocumentJobUsage } from "../worker/document-job-reservations.ts";

const profile = (value) => normalizeAudioRequestProfile(value);

async function withMockFal(options, operation) {
  const previous = globalThis.fetch;
  const calls = [];
  const requestId = options.requestId ?? "specialist-request-01";
  const mimeType = options.mimeType ?? "audio/mpeg";
  const suffix = mimeType === "audio/mp4" ? "m4a" : "mp3";
  globalThis.fetch = async (value, init = {}) => {
    const url = String(value);
    calls.push({ url, init });
    if (url.includes("/storage/upload/initiate")) {
      return Response.json({ upload_url: "https://upload.fal.media/approved.mp4", file_url: "https://v3b.fal.media/files/approved.mp4" });
    }
    if (url === "https://upload.fal.media/approved.mp4") return new Response("");
    if (url.startsWith("https://queue.fal.run/") && init.method === "POST") return Response.json({ request_id: requestId });
    if (url.endsWith("/status?logs=1")) return Response.json({ status: "COMPLETED" });
    if (url.startsWith("https://queue.fal.run/") && url.includes("/requests/")) {
      return Response.json({
        audio: {
          url: "https://v3b.fal.media/files/output." + suffix,
          content_type: mimeType,
          file_name: "output." + suffix,
          ...(options.duration === undefined ? {} : { duration: options.duration }),
        },
        ...(options.returnVideo ? { video: { url: "https://v3b.fal.media/files/ignored.mp4" } } : {}),
      });
    }
    if (url === "https://v3b.fal.media/files/output." + suffix) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": mimeType } });
    }
    throw new Error("Unexpected mocked Fal request: " + url);
  };
  try { return await operation(calls); }
  finally { globalThis.fetch = previous; }
}

test("every supported end-user goal selects its capability-specific Fal adapter", () => {
  const cases = [
    [{ goal: "music" }, LYRIA_AUDIO_ADAPTER_CONTRACT.model, 80_000],
    [{ goal: "timed_music", durationSeconds: 30 }, STABLE_AUDIO_ADAPTER_CONTRACT.model, 37_600],
    [{ goal: "timed_music", durationSeconds: 381 }, SONILO_MUSIC_ADAPTER_CONTRACT.model, 952_500],
    [{ goal: "sound_effects", durationSeconds: 8 }, SONILO_SOUND_EFFECTS_ADAPTER_CONTRACT.model, 14_400],
    [{ goal: "narration", speakerCount: 2 }, GEMINI_TTS_ADAPTER_CONTRACT.model, 250_000],
    [{ goal: "mixed_audio" }, SEED_AUDIO_ADAPTER_CONTRACT.model, 375_000],
    [{ goal: "video_music", durationSeconds: 12, videoReferenceId: "approved-video" }, SONILO_VIDEO_MUSIC_ADAPTER_CONTRACT.model, 108_000],
    [{ goal: "video_sound_effects", durationSeconds: 12, videoReferenceId: "approved-video" }, SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT.model, 108_000],
  ];
  for (const [request, expectedModel, expectedCost] of cases) {
    const selected = selectAudioAdapterContract(request);
    assert.equal(selected.contract.model, expectedModel);
    assert.equal(selected.estimatedCostMicrousd, expectedCost);
  }
  assert.equal(AUDIO_ADAPTER_CONTRACTS.length, 8);
});

test("configured original-music defaults never override specialist or long-duration capabilities", () => {
  assert.equal(selectAudioAdapter({ FAL_AUDIO_MODEL: STABLE_AUDIO_ADAPTER_CONTRACT.model }, { goal: "music" }).model, STABLE_AUDIO_ADAPTER_CONTRACT.model);
  assert.equal(selectAudioAdapter({ FAL_AUDIO_MODEL: GEMINI_TTS_ADAPTER_CONTRACT.model }, { goal: "music" }).model, LYRIA_AUDIO_ADAPTER_CONTRACT.model);
  assert.equal(selectAudioAdapter({ FAL_AUDIO_MODEL: LYRIA_AUDIO_ADAPTER_CONTRACT.model }, { goal: "narration" }).model, GEMINI_TTS_ADAPTER_CONTRACT.model);
  assert.equal(selectAudioAdapter({ FAL_AUDIO_MODEL: LYRIA_AUDIO_ADAPTER_CONTRACT.model }, { goal: "music", durationSeconds: 500 }).model, SONILO_MUSIC_ADAPTER_CONTRACT.model);
  assert.throws(() => selectAudioAdapterContract({ goal: "music" }, { preferredModel: SEED_AUDIO_ADAPTER_CONTRACT.model }), (error) => error.code === "audio_provider_model_incompatible");
});

test("invalid goals, silence, durations, speakers, scripts, and unavailable capabilities fail before a purchase", () => {
  for (const [value, code] of [
    [{ goal: "silence" }, "audio_silence_requested"],
    [{ goal: "silent" }, "audio_silence_requested"],
    [{ goal: "unknown" }, "audio_goal_unsupported"],
    [{ goal: "music", role: "unknown" }, "audio_role_unsupported"],
    [{ goal: "sound_effects", durationSeconds: 0 }, "audio_duration_invalid"],
    [{ goal: "sound_effects", durationSeconds: 1.5 }, "audio_duration_invalid"],
    [{ goal: "narration", speakerCount: 0 }, "audio_speaker_count_invalid"],
    [{ goal: "narration", speakerCount: 3 }, "audio_speaker_count_unsupported"],
    [{ goal: "narration", transcript: "x".repeat(5_001) }, "audio_prompt_too_long"],
    [{ goal: "timed_music", durationSeconds: 381, requireInstrumental: true }, "audio_instrumental_unsupported"],
  ]) {
    assert.throws(() => selectAudioAdapterContract(value), (error) => error instanceof AudioAdapterSelectionError && error.code === code);
  }
  assert.throws(() => selectAudioAdapterContract({ goal: "video_music" }, { videoReferenceAvailable: false }), (error) => error.code === "audio_video_reference_required");
});

test("source listening duration never silently increases the requested output price", () => {
  const snapshot = { facts: [{ block_id: "listening", type: "audio", active: true, properties: { inform_generation: true, audio_role: "score", duration_seconds: 500 } }] };
  const request = normalizeAudioRequestProfile(undefined, snapshot);
  assert.equal(request.durationSeconds, undefined);
  assert.equal(selectAudioAdapterContract(request).estimatedCostMicrousd, 80_000);
});

test("instrumental preference routes through the supported Stable specialist", () => {
  const selected = selectAudioAdapterContract({ goal: "music", requireInstrumental: true });
  assert.equal(selected.contract.model, STABLE_AUDIO_ADAPTER_CONTRACT.model);
  const input = serializeStableAudioRequest({ prompt: "Warm acoustic music", profile: selected.profile });
  assert.match(input.negative_prompt, /vocals/i);
  assert.equal(input.output_format, "mp3");
});

test("specialist serializers expose only their documented provider-specific fields", () => {
  assert.deepEqual(serializeLyriaAudioRequest({ prompt: "Original score", profile: profile({ goal: "music" }), imageUrl: "approved-image" }), { prompt: "Original score", image_url: "approved-image" });
  assert.deepEqual(serializeSoniloAudioRequest(SONILO_MUSIC_ADAPTER_CONTRACT.model, { prompt: "Timed score", profile: profile({ goal: "timed_music", durationSeconds: 400 }) }), { prompt: "Timed score", duration: 400, num_samples: 1 });
  assert.deepEqual(serializeSoniloAudioRequest(SONILO_SOUND_EFFECTS_ADAPTER_CONTRACT.model, { prompt: "Quiet footsteps", profile: profile({ goal: "sound_effects", durationSeconds: 5 }) }), { prompt: "Quiet footsteps", duration: 5, audio_format: "mp3" });
  assert.deepEqual(serializeSeedAudioRequest({ prompt: "Host greets the guest over quiet rain", profile: profile({ goal: "mixed_audio" }) }), { prompt: "Host greets the guest over quiet rain", output_format: "mp3" });
  assert.deepEqual(serializeSoniloAudioRequest(SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT.model, { prompt: "Footsteps", profile: profile({ goal: "video_sound_effects", durationSeconds: 20 }), videoUrl: "approved-video" }), { video_url: "approved-video", prompt: "Footsteps", audio_format: "mp3" });
});

test("multilingual dialogue preserves spoken words while mapping localized names to provider-safe voices", () => {
  for (const script of ["Élodie: Bonjour\nFrançois: Salut", "ليلى: أهلاً\nعمر: مرحبًا", "花子：こんにちは\n太郎：こんばんは"]) {
    const input = serializeGeminiSpeechRequest({ profile: profile({ goal: "narration", speakerCount: 2 }), spokenScript: script });
    assert.deepEqual(input.speakers.map((speaker) => speaker.speaker_id), ["Speaker1", "Speaker2"]);
    assert.match(input.prompt, /^Speaker1:/u);
    assert.match(input.prompt, /\nSpeaker2:/u);
  }
  assert.throws(() => serializeGeminiSpeechRequest({ profile: profile({ goal: "narration", speakerCount: 2 }), spokenScript: "Alice: One\nBob: Two\nCara: Three" }), (error) => error.code === "audio_speaker_script_invalid");
});

test("speech adaptation keeps the spoken script separate from policy and production direction", () => {
  const script = "Speaker: Welcome home.";
  const adapted = adaptAudioPrompt({ facts: [] }, {
    title: "A quiet welcome", summary: "Gentle narration", content_markdown: script,
    items: [{ title: "Opening", body: script, notes: "Quietly", image_prompt: "" }],
  }, { profile: profile({ goal: "narration" }), model: GEMINI_TTS_ADAPTER_CONTRACT.model, tone: "calm" });
  assert.equal(adapted.spokenScript, script);
  assert.doesNotMatch(adapted.spokenScript, /Never imitate|production instructions|creative inspiration/i);
  assert.match(adapted.voiceDirection, /calm/i);
  assert.equal(adapted.adapterId, GEMINI_TTS_ADAPTER_CONTRACT.adapterId);
});

test("podcast, radio, and video destinations change specialist delivery direction without changing spoken words", () => {
  const script = "Speaker: Welcome home.";
  const documentPlan = {
    title: "A quiet welcome", summary: "Gentle narration", content_markdown: script,
    items: [{ title: "Opening", body: script, notes: "Quietly", image_prompt: "" }],
  };
  const podcast = adaptAudioPrompt({ facts: [] }, documentPlan, { profile: profile({ goal: "narration", destination: "podcast" }), model: GEMINI_TTS_ADAPTER_CONTRACT.model });
  const radio = adaptAudioPrompt({ facts: [] }, documentPlan, { profile: profile({ goal: "narration", destination: "radio" }), model: GEMINI_TTS_ADAPTER_CONTRACT.model });
  const video = adaptAudioPrompt({ facts: [] }, documentPlan, { profile: profile({ goal: "music", destination: "video" }), model: LYRIA_AUDIO_ADAPTER_CONTRACT.model });
  assert.equal(podcast.spokenScript, script);
  assert.equal(radio.spokenScript, script);
  assert.match(podcast.voiceDirection, /podcast listening|intimate natural pacing/i);
  assert.match(radio.voiceDirection, /radio or advertising|broadcast-ready/i);
  assert.match(video.prompt, /visual action and transitions/i);
  assert.notEqual(podcast.voiceDirection, radio.voiceDirection);
});

test("speech provider direction retains locked prohibitions after long required delivery instructions", () => {
  const script = "Speaker: Welcome home.";
  const snapshot = { facts: [
    { block_id: "required", type: "direction", locked: true, properties: { text: "Preserve a gentle authored delivery. ".repeat(45) } },
    { block_id: "forbidden", type: "direction", locked: true, intent: "prohibit", properties: { text: "Never say ORCHID or imitate a real person." } },
  ] };
  const adapted = adaptAudioPrompt(snapshot, {
    title: "A quiet welcome", summary: "Gentle narration", content_markdown: script,
    items: [{ title: "Opening", body: script, notes: "Quietly", image_prompt: "" }],
  }, { profile: profile({ goal: "narration", destination: "podcast" }), model: GEMINI_TTS_ADAPTER_CONTRACT.model, tone: "calm" });
  assert.equal(adapted.compilation.valid, true);
  assert.match(adapted.voiceDirection, /ORCHID/u);
  const input = serializeGeminiSpeechRequest({ profile: profile({ goal: "narration" }), spokenScript: adapted.spokenScript, voiceDirection: adapted.voiceDirection });
  assert.match(input.style_instructions, /ORCHID/u);
  assert.doesNotMatch(input.prompt, /ORCHID/u);
});

test("narration preserves approved public website copy while redacting private media sources", () => {
  const publicScript = "Visit https://example.com/deals?utm_source=radio and save today.";
  const documentPlan = { title: "Radio offer", summary: "Approved advertising", content_markdown: publicScript, items: [] };
  const publicNarration = adaptAudioPrompt({ facts: [] }, documentPlan, {
    profile: profile({ goal: "narration", transcript: publicScript }), model: GEMINI_TTS_ADAPTER_CONTRACT.model,
  });
  assert.equal(publicNarration.spokenScript, publicScript);
  const privateNarration = adaptAudioPrompt({ facts: [] }, documentPlan, {
    profile: profile({ goal: "narration", transcript: "Private https://v3b.fal.media/files/secret.mp3 and /api/media/private.mp3" }), model: GEMINI_TTS_ADAPTER_CONTRACT.model,
  });
  assert.equal(privateNarration.spokenScript, "Private [private source] and [private source]");
  for (const source of [
    "https://v3b.fal.media./files/secret.mp3", "https://storage.googleapis.com./private.wav", "https://localhost./secret",
    "https://10.0.0.1/private", "https://demo:secret@example.com/deals", "https://example.com/#access_token=SECRET",
    "https://example.com/?api_key=SECRET", "https://example.com/?apikey=SECRET", "https://example.com/?password=SECRET",
    "https://example.com/?jwt=SECRET", "https://example.com/?session_token=SECRET", "https://example.com/?X-Amz-Credential=SECRET",
    "https://example.com/?accessToken=SECRET", "https://example.com/?sessionToken=SECRET", "https://example.com/?authToken=SECRET", "https://example.com/?oauthToken=SECRET", "https://example.com/?idToken=SECRET",
    "https://example.com/%61pi/media/private.mp3", "https://example.com/api%2fmedia%2fprivate.mp3",
    "https://127.0.0.2/private", "https://172.16.0.2/private", "https://192.168.1.2/private", "https://169.254.169.254/private",
    "https://[fe80::1]/private", "https://[fd12::1]/private", "file:///Users/person/private.wav", "s3://private-bucket/recording.wav",
  ]) {
    const adapted = adaptAudioPrompt({ facts: [] }, documentPlan, {
      profile: profile({ goal: "narration", transcript: "Visit " + source }), model: GEMINI_TTS_ADAPTER_CONTRACT.model,
    });
    assert.equal(adapted.spokenScript, "Visit [private source]", source);
  }
});

test("protected voice imitation is rejected in tone and authored requirements before provider serialization", () => {
  const request = profile({ goal: "narration" });
  for (const direction of [
    "Imitate Taylor Swift's voice exactly.", "Use Scarlett Johansson’s voice.", "Use Morgan Freeman’s voice.",
    "Read in the voice of Morgan Freeman.", "Narrate like Morgan Freeman.", "Speak in a Morgan Freeman voice.",
    "Voice should be Morgan Freeman.", "Use a Morgan Freeman-style voice.", "Narrate like Cher.",
    "Celebrity voice of Beyoncé.", "Narrate like morgan freeman.", "use morgan freeman's voice.",
    "in the voice of morgan freeman", "sound like morgan freeman", "use a morgan freeman-style delivery",
    "Morgan Freeman style voiceover", "voice matching Morgan Freeman", "voice like Morgan Freeman",
    "speak as the actor Morgan Freeman", "narrate in Morgan Freeman style", "voice of 花澤香菜",
    "voice of أم كلثوم", "sounding exactly like taylor swift", "copy the vocals of taylor swift", "impersonate taylor swift",
  ]) {
    assert.equal(audioAuthoringConflict({ facts: [] }, request, { tone: direction })?.code, "audio_originality_required", direction);
    const snapshot = { facts: [{ type: "direction", locked: true, properties: { text: direction } }] };
    assert.equal(audioAuthoringConflict(snapshot, request)?.code, "audio_originality_required", direction);
    assert.throws(() => adaptAudioPrompt({ facts: [] }, { title: "Approved narration", summary: "Original voice", content_markdown: "Welcome home.", items: [] }, {
      profile: request, model: GEMINI_TTS_ADAPTER_CONTRACT.model, tone: direction,
    }), (error) => error.code === "audio_originality_required", direction);
  }
  for (const direction of [
    "Speak in a calm voice.", "Narrate like a caring friend.", "Use an original narrator's voice.", "Do not imitate Morgan Freeman.",
    "Narrate like an experienced guide.", "Narrate like a trusted journalist.", "Narrate like a patient instructor.",
    "Narrate like a real estate agent.", "Narrate like an excited child.", "Narrate like a bedtime story.",
    "Read like a documentary host.", "Read like a news anchor.", "Read like a sports commentator.",
    "Read like a nature documentary.", "Speak in an upbeat conversational voice.", "Voice should be slow and reassuring.",
    "Voice should be joyful and energetic.", "Voice should be quiet and thoughtful.", "Use a cinematic documentary-style voice.",
    "In the voice of an excited child.",
  ]) {
    assert.equal(audioAuthoringConflict({ facts: [] }, request, { tone: direction }), null, direction);
  }
});

test("Sonilo's actual requested duration and ten-second minimum determine the paid music charge", async () => {
  const request = profile({ goal: "timed_music", durationSeconds: 400 });
  await withMockFal({ mimeType: "audio/mp4", duration: 1 }, async (calls) => {
    const audio = await generateCreativeAudio({ FAL_KEY: "test-secret" }, "Extended original score", {
      providerModel: SONILO_MUSIC_ADAPTER_CONTRACT.model, profile: request,
      estimatedCostMicrousd: estimateAudioProviderCostMicrousd(SONILO_MUSIC_ADAPTER_CONTRACT, request),
    });
    assert.equal(audio.mimeType, "audio/mp4");
    assert.equal(audio.costMicrousd, 1_000_000);
    const submitted = JSON.parse(calls.find((call) => call.init.method === "POST").init.body);
    assert.equal(submitted.duration, 400);
    assert.equal(audio.preparedReceipt.parameters.provider_parameters.duration, 400);
  });
  assert.equal(estimateAudioProviderCostMicrousd(SONILO_MUSIC_ADAPTER_CONTRACT, { durationSeconds: 2 }), 25_000);
});

test("speech reserves the conservative ceiling and settles only actual normalized script characters", async () => {
  const script = "Host: Welcome.\nGuest: Hello.";
  const request = profile({ goal: "narration", speakerCount: 2, transcript: script });
  await withMockFal({}, async (calls) => {
    const audio = await generateCreativeAudio({ FAL_KEY: "test-secret" }, "Never speak this production policy.", {
      providerModel: GEMINI_TTS_ADAPTER_CONTRACT.model, profile: request, spokenScript: script,
      estimatedCostMicrousd: 250_000,
    });
    const submitted = JSON.parse(calls.find((call) => call.init.method === "POST").init.body);
    assert.equal(audio.submittedPrompt, submitted.prompt);
    assert.doesNotMatch(submitted.prompt, /production policy/u);
    assert.equal(audio.costMicrousd, submitted.prompt.length * 50);
    assert.equal(audio.preparedReceipt.parameters.published_cost_microusd, 250_000);
  });
});

test("mixed audio reserves the documented maximum and reconciles the verified generated duration", async () => {
  await withMockFal({ duration: 24 }, async () => {
    const audio = await generateCreativeAudio({ FAL_KEY: "test-secret" }, "A complete original radio scene.", {
      providerModel: SEED_AUDIO_ADAPTER_CONTRACT.model, profile: profile({ goal: "mixed_audio" }), estimatedCostMicrousd: 375_000,
    });
    assert.equal(audio.costMicrousd, 75_000);
  });
  await withMockFal({ duration: 121 }, async () => {
    await assert.rejects(generateCreativeAudio({ FAL_KEY: "test-secret" }, "A complete original radio scene.", {
      providerModel: SEED_AUDIO_ADAPTER_CONTRACT.model, profile: profile({ goal: "mixed_audio" }), estimatedCostMicrousd: 375_000,
    }), (error) => error.detail?.code === "audio_provider_duration_exceeds_contract");
  });
});

test("synchronized sound effects upload the approved full clip once and never submit a fake duration", async () => {
  const clip = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "video/mp4", artifactId: "approved-video", referenceId: "approved-video", label: "Approved film", durationSeconds: 60 };
  const request = profile({ goal: "video_sound_effects", durationSeconds: 1, videoReferenceId: clip.artifactId });
  await withMockFal({ returnVideo: true }, async (calls) => {
    const audio = await generateCreativeAudio({ FAL_KEY: "test-secret" }, "Match every visible step.", {
      providerModel: SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT.model, profile: request, videoReference: clip, estimatedCostMicrousd: 540_000,
    });
    const submitted = JSON.parse(calls.find((call) => call.init.method === "POST" && call.url.startsWith("https://queue.fal.run/")).init.body);
    assert.deepEqual(submitted, { video_url: "https://v3b.fal.media/files/approved.mp4", prompt: "Match every visible step.", audio_format: "mp3" });
    assert.equal(audio.costMicrousd, 540_000);
    assert.equal(audio.preparedReceipt.videoReference.duration_seconds, 60);
    assert.equal(audio.preparedReceipt.videoReference.embedded_audio_may_be_transmitted, true);
  });
});

test("synchronized music always scores and charges the entire approved video clip", async () => {
  const clip = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "video/mp4", artifactId: "approved-video", referenceId: "approved-video", label: "Approved film", durationSeconds: 60 };
  const request = profile({ goal: "video_music", durationSeconds: 1, videoReferenceId: clip.artifactId });
  await withMockFal({ mimeType: "audio/mp4" }, async (calls) => {
    const audio = await generateCreativeAudio({ FAL_KEY: "test-secret" }, "Score the complete approved film.", {
      providerModel: SONILO_VIDEO_MUSIC_ADAPTER_CONTRACT.model, profile: request, videoReference: clip, estimatedCostMicrousd: 540_000,
    });
    const submitted = JSON.parse(calls.find((call) => call.init.method === "POST" && call.url.startsWith("https://queue.fal.run/")).init.body);
    assert.equal(submitted.duration, 60);
    assert.equal(audio.costMicrousd, 540_000);
  });
});

test("specialist retries retain original duration and never upload or buy a second provider request", async () => {
  const request = profile({ goal: "timed_music", durationSeconds: 400 });
  let retained;
  await withMockFal({ mimeType: "audio/mp4" }, async () => {
    retained = (await generateCreativeAudio({ FAL_KEY: "test-secret" }, "Extended original score", {
      providerModel: SONILO_MUSIC_ADAPTER_CONTRACT.model, profile: request, estimatedCostMicrousd: 1_000_000,
    })).preparedReceipt;
  });
  await withMockFal({ mimeType: "audio/mp4" }, async (calls) => {
    const recovered = await generateCreativeAudio({ FAL_KEY: "test-secret" }, "This changed brief must be ignored.", {
      providerJobId: "specialist-request-01", retainedReceipt: retained,
    });
    assert.equal(recovered.costMicrousd, 1_000_000);
    assert.equal(calls.some((call) => call.init.method === "POST" || call.url.includes("/storage/upload")), false);
  });
});

test("incompatible specialist selections and underfunded full-video requests never contact Fal", async () => {
  const previous = globalThis.fetch;
  let contacts = 0;
  globalThis.fetch = async () => { contacts++; throw new Error("Provider must not be contacted"); };
  try {
    await assert.rejects(generateCreativeAudio({ FAL_KEY: "test-secret" }, "Narrate this.", {
      providerModel: LYRIA_AUDIO_ADAPTER_CONTRACT.model, profile: profile({ goal: "narration", transcript: "Narrate this." }),
    }), (error) => error.detail?.code === "audio_provider_model_incompatible");
    await assert.rejects(generateCreativeAudio({ FAL_KEY: "test-secret" }, "Match every visible step.", {
      providerModel: SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT.model,
      profile: profile({ goal: "video_sound_effects", durationSeconds: 1, videoReferenceId: "approved-video" }),
      videoReference: { bytes: new Uint8Array([1]), mimeType: "video/mp4", artifactId: "approved-video", referenceId: "approved-video", label: "Film", durationSeconds: 60 },
      estimatedCostMicrousd: 9_000,
    }), (error) => error.detail?.code === "audio_provider_reservation_insufficient");
    assert.equal(contacts, 0);
  } finally { globalThis.fetch = previous; }
});

test("accepted specialist checkpoints settle the model-specific duration instead of Lyria's fixed rate", () => {
  const checkpoint = {
    providerJobId: "specialist-request-01", providerModel: SONILO_MUSIC_ADAPTER_CONTRACT.model,
    audioInputReceipt: { model: SONILO_MUSIC_ADAPTER_CONTRACT.model, parameters: { goal: "timed_music", duration_seconds: 400 } },
  };
  const usage = interruptedDocumentJobUsage(checkpoint, { artifactKind: "audio", audioProfile: { goal: "timed_music", durationSeconds: 400 } });
  assert.equal(usage.singleAudioCostMicrousd, 1_000_000);
  assert.equal(presentationServerOwnedCheckpointField({ audioEstimatedCostMicrousd: 1 }), "audioEstimatedCostMicrousd");
});

test("authored music prohibitions respect the chosen specialist's real output role", () => {
  const snapshot = {
    facts: [
      { type: "audio", active: true, properties: { audio_role: "voice", inform_generation: true } },
      { type: "direction", locked: true, properties: { text: "No music or musical score." } },
    ],
  };
  assert.equal(audioAuthoringConflict(snapshot, profile({ goal: "narration" })), null);
  assert.equal(audioAuthoringConflict(snapshot, profile({ goal: "music" }))?.code, "audio_output_forbidden");
});

test("voice and sound-effect prohibitions block only specialists that would violate them", () => {
  const effectsForbidden = { facts: [{ type: "direction", locked: true, properties: { text: "No sound effects." } }] };
  assert.equal(audioAuthoringConflict(effectsForbidden, profile({ goal: "narration" })), null);
  assert.equal(audioAuthoringConflict(effectsForbidden, profile({ goal: "music" })), null);
  assert.equal(audioAuthoringConflict(effectsForbidden, profile({ goal: "sound_effects" }))?.code, "audio_output_forbidden");
  for (const direction of ["No Foley.", "No SFX."]) {
    const forbidden = { facts: [{ type: "direction", locked: true, properties: { text: direction } }] };
    assert.equal(audioAuthoringConflict(forbidden, profile({ goal: "narration" })), null);
    assert.equal(audioAuthoringConflict(forbidden, profile({ goal: "sound_effects" }))?.code, "audio_output_forbidden");
    assert.equal(audioAuthoringConflict(forbidden, profile({ goal: "video_sound_effects" }))?.code, "audio_output_forbidden");
    assert.equal(audioAuthoringConflict(forbidden, profile({ goal: "mixed_audio" }))?.code, "audio_output_forbidden");
  }
  for (const direction of ["No voiceover.", "No spoken words.", "No human voices.", "No talking.", "Dialogue-free.", "Speech-free."]) {
    const forbidden = { facts: [{ type: "direction", locked: true, properties: { text: direction } }] };
    assert.equal(audioAuthoringConflict(forbidden, profile({ goal: "music" })), null, direction);
    assert.equal(audioAuthoringConflict(forbidden, profile({ goal: "narration" }))?.code, "audio_output_forbidden", direction);
    assert.equal(audioAuthoringConflict(forbidden, profile({ goal: "mixed_audio" }))?.code, "audio_output_forbidden", direction);
  }
  const speechForbidden = { facts: [{ type: "direction", locked: true, properties: { text: "No dialogue or speech." } }] };
  assert.equal(audioAuthoringConflict(speechForbidden, profile({ goal: "music" })), null);
  assert.equal(audioAuthoringConflict(speechForbidden, profile({ goal: "narration" }))?.code, "audio_output_forbidden");
  assert.equal(audioAuthoringConflict(speechForbidden, profile({ goal: "mixed_audio" }))?.code, "audio_output_forbidden");
});

test("coordinated authored prohibitions reject every affected audio modality", () => {
  for (const [direction, forbiddenGoals, allowedGoals] of [
    ["No sound effects or music.", ["music", "timed_music", "video_music", "sound_effects", "video_sound_effects", "mixed_audio"], ["narration"]],
    ["No music or speech.", ["music", "timed_music", "video_music", "narration", "mixed_audio"], ["sound_effects", "video_sound_effects"]],
    ["No speech or Foley.", ["narration", "sound_effects", "video_sound_effects", "mixed_audio"], ["music", "timed_music", "video_music"]],
    ["No music, sound effects, or dialogue.", ["music", "timed_music", "video_music", "narration", "sound_effects", "video_sound_effects", "mixed_audio"], []],
    ["No Foley and no voices.", ["narration", "sound_effects", "video_sound_effects", "mixed_audio"], ["music", "timed_music", "video_music"]],
    ["No Foley; no music.", ["sound_effects", "video_sound_effects", "music", "timed_music", "video_music", "mixed_audio"], ["narration"]],
    ["No music, but no narration.", ["music", "timed_music", "video_music", "narration", "mixed_audio"], ["sound_effects", "video_sound_effects"]],
  ]) {
    const snapshot = { facts: [{ type: "direction", locked: true, properties: { text: direction } }] };
    for (const goal of forbiddenGoals) assert.equal(audioAuthoringConflict(snapshot, profile({ goal }))?.code, "audio_output_forbidden", direction + " → " + goal);
    for (const goal of allowedGoals) assert.equal(audioAuthoringConflict(snapshot, profile({ goal })), null, direction + " → " + goal);
  }
});

test("reused generated narration remains a voice input with every recording permission disabled", () => {
  const artifact = {
    id: "generated-narration", kind: "audio", documentId: "document", title: "Narration", summary: "Spoken welcome",
    itemCount: 1, items: [{ id: "part-1", title: "Opening" }], mediaUrl: "/api/media/private%2Fnarration.mp3",
    mediaType: "audio/mpeg", provider: "fal", modelId: GEMINI_TTS_ADAPTER_CONTRACT.model,
    contentRef: null, inputRef: null, settings: { audio_role: "voice", source_media_sha256: "verified-hash" },
  };
  let nextId = 0;
  const result = artifactContextEvents(artifact, { documentId: "document", projectId: "project", sourceSurface: "test", idFactory: () => "id-" + ++nextId });
  const created = result.events.find((event) => event.type === "BlockCreated").payload.properties;
  assert.equal(created.subtype, "Voice");
  assert.equal(created.audio_role, "voice");
  assert.equal(created.inform_generation, false);
  assert.equal(created.include_in_output, false);
  assert.equal(created.allow_provider_audio_transfer, false);
});
