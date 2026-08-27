import {
  AudioAdapterSelectionError, audioAdapterContractForModel, audioAuthoringConflict, audioContextDescription, audioContexts,
  selectAudioAdapterContract, type AudioRequestProfile,
} from "../src/model/audio.ts";
import { combinedContextPromptDirectives } from "../src/model/combined-context.ts";
import { compileContextAdaptationSections, requiredContextAdaptationFacts, type CompiledContextAdaptation } from "../src/model/context-adaptation.ts";
import type { DocumentArtifactDraft } from "../src/model/document-artifacts.ts";
import { AUDIO_PROVIDER_INPUT_CONTRACTS, AudioProviderInputError, GEMINI_SPEECH_INPUT_POLICY, audioCharacterCount, audioUtf8Bytes, geminiSpeechInputBytes } from "../src/model/audio-provider-contracts.ts";
import { prepareGeminiSpeechScript, serializeGeminiSpeechRequest } from "./audio-adapters/gemini-tts.ts";
import { serializeAudioRequest } from "./audio-adapters/index.ts";

export type AudioPromptAdaptation = {
  adapterId: string;
  adapterVersion: string;
  prompt: string;
  compilation: CompiledContextAdaptation;
  sourceAudioBlockIds: string[];
  audioWaveformSubmitted: false;
  sourceAudioTreatment: "none" | "authored-description-only";
  orderedCueCount: number;
  spokenScript?: string;
  voiceDirection?: string;
  inputBudget?: { scriptCharacters: number; styleCharacters: number; combinedUtf8Bytes: number; maximumCombinedUtf8Bytes: number };
};

const privateMedia = /(?:https?:\/\/[^\s"')]+|\/api\/media\/[^\s"')]+)/giu;
const spokenMediaSource = /(?:(?:https?|file|s3|gs|r2|blob):\/\/[^\s"')]+|\/api\/media\/[^\s"')]+)/giu;
const clean = (value: unknown) => String(value ?? "").replace(privateMedia, "[private source]").replace(/\r\n?/g, "\n").trim();
const cleanSpokenScript = (value: unknown) => String(value ?? "").replace(spokenMediaSource, (source) => {
  if (source.startsWith("/api/media/") || !/^https?:\/\//iu.test(source)) return "[private source]";
  try {
    const url = new URL(source);
    const hostname = url.hostname.replace(/\.+$/u, "");
    const privateHost = /^(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\]|\[(?:fe[89ab][0-9a-f]|f[cd][0-9a-f]{2}):[^\]]+\])$|(?:^|\.)(?:localhost|local|internal|fal\.media|fal\.run|r2\.cloudflarestorage\.com|amazonaws\.com|storage\.googleapis\.com|blob\.core\.windows\.net)$/iu.test(hostname);
    const fragmentParameters = new URLSearchParams(url.hash.replace(/^#/u, "").split("?").at(-1) ?? "");
    const privateParameter = [...url.searchParams.keys(), ...fragmentParameters.keys()].some((key) => /token(?:$|[-_])|(?:^|[-_])(?:api[-_]?key|password|passwd|secret|jwt|credential|signature|authorization)(?:$|[-_])|^(?:sig|googleaccessid)$/iu.test(key));
    let pathname = url.pathname;
    for (let count = 0; count < 2; count++) pathname = decodeURIComponent(pathname);
    return url.username || url.password || privateHost || /(?:^|\/)api\/media\//iu.test(pathname) || privateParameter ? "[private source]" : source;
  } catch { return "[private source]"; }
}).replace(/\r\n?/g, "\n").trim();

/** Translate approved sonic meaning into the selected specialist's actual input contract. */
export function adaptAudioPrompt(
  snapshot: Record<string, unknown>,
  plan: Pick<DocumentArtifactDraft, "title" | "summary" | "content_markdown" | "items">,
  options: { tone?: string; audience?: string; maxPromptCharacters?: number; profile?: AudioRequestProfile; model?: string; omitOptionalVoiceDirection?: boolean } = {},
): AudioPromptAdaptation {
  const { profile, contract } = selectAudioAdapterContract(options.profile, { snapshot, preferredModel: options.model });
  const conflict = audioAuthoringConflict(snapshot, profile, { tone: options.tone, audience: options.audience });
  if (conflict) throw new AudioAdapterSelectionError(conflict.code, conflict.message);
  const prohibitedAudioBlockIds = new Set((Array.isArray(snapshot.facts) ? snapshot.facts : []).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const fact = candidate as Record<string, unknown>;
    const properties = fact.properties && typeof fact.properties === "object" ? fact.properties as Record<string, unknown> : {};
    return [fact.intent, fact.effect, properties.intent, properties.effect, properties.polarity].some((value) => /^(?:avoid|prohibit|exclude|must_not_include|forbid|negative)$/i.test(String(value ?? "")))
      ? [String(fact.block_id ?? fact.id ?? "")] : [];
  }));
  const references = audioContexts(snapshot, "inform").filter((reference) => !prohibitedAudioBlockIds.has(reference.blockId));
  const hardFacts = requiredContextAdaptationFacts(snapshot);
  const prohibited = hardFacts.filter((fact) => [fact.fact.intent, fact.fact.effect, fact.properties.intent, fact.properties.effect, fact.properties.polarity].some((value) => /^(?:avoid|prohibit|exclude|must_not_include|forbid|negative)$/i.test(String(value ?? ""))));
  const requirements = hardFacts.filter((fact) => !prohibited.includes(fact)).map((fact) => clean(fact.direction)).filter(Boolean);
  const cues = references.flatMap((reference) => reference.cues);
  const destinationDirection = profile.destination === "podcast"
    ? "Shape this for podcast listening: foreground speech intelligibility, intimate natural pacing, and unobtrusive background space."
    : profile.destination === "radio"
      ? "Shape this for radio or advertising: clear foreground delivery, concise broadcast-ready pacing, and a memorable audible opening."
      : profile.destination === "video"
        ? "Shape this for video: follow visual action and transitions while leaving foreground space for dialogue and other picture-led sound."
        : "";
  const orderedBeats = plan.items.flatMap((item, index) => {
    const description = [clean(item.title), clean(item.body), clean(item.notes)].filter(Boolean).join(" · ");
    return description ? [`${index + 1}. ${description}`] : [];
  });

  if (profile.goal === "narration") {
    const spokenScript = cleanSpokenScript(profile.transcript ?? plan.content_markdown ?? plan.items.map((item) => item.body).join("\n"));
    const { prompt: script } = prepareGeminiSpeechScript({ profile, spokenScript });
    let voiceDirection = [...prohibited.map((fact) => `Avoid: ${clean(fact.direction)}`), ...requirements].filter(Boolean).join(" ");
    // Mandatory voice direction is checked before optional delivery preferences.
    // Neither an approved script nor a locked requirement may be truncated.
    serializeGeminiSpeechRequest({ prompt: script, profile, spokenScript, ...(voiceDirection ? { voiceDirection } : {}) });
    const omittedStyles: string[] = [];
    for (const [id, direction] of options.omitOptionalVoiceDirection ? [] : [["delivery-tone", options.tone ? `Delivery: ${clean(options.tone)}.` : ""], ["delivery-destination", destinationDirection]]) {
      if (!direction) continue;
      const next = [voiceDirection, direction].filter(Boolean).join(" ");
      if (audioCharacterCount(next) <= GEMINI_SPEECH_INPUT_POLICY.maxStyleCharacters && geminiSpeechInputBytes(script, next) <= GEMINI_SPEECH_INPUT_POLICY.maxCombinedUtf8Bytes) voiceDirection = next;
      else omittedStyles.push(id!);
    }
    const compilation = compileContextAdaptationSections([{ id: "spoken-script", content: script, priority: "required", allowCompaction: false }], Math.min(options.maxPromptCharacters ?? contract.maxPromptCharacters, contract.maxPromptCharacters));
    compilation.omittedSectionIds.push(...omittedStyles);
    compilation.compacted ||= omittedStyles.length > 0;
    return {
      adapterId: contract.adapterId, adapterVersion: contract.adapterVersion, prompt: script, compilation, spokenScript,
      ...(voiceDirection ? { voiceDirection } : {}),
      sourceAudioBlockIds: references.map((reference) => reference.blockId).filter(Boolean),
      audioWaveformSubmitted: false, sourceAudioTreatment: references.length ? "authored-description-only" : "none", orderedCueCount: cues.length,
      inputBudget: { scriptCharacters: audioCharacterCount(script), styleCharacters: audioCharacterCount(voiceDirection), combinedUtf8Bytes: geminiSpeechInputBytes(script, voiceDirection), maximumCombinedUtf8Bytes: GEMINI_SPEECH_INPUT_POLICY.maxCombinedUtf8Bytes },
    };
  }

  const sections = [
    {
      id: "originality-policy",
      priority: "required" as const,
      allowCompaction: false,
      content: profile.goal === "sound_effects" || profile.goal === "video_sound_effects"
          ? "Create original, precise sound effects and environmental texture. Do not introduce unwanted music, a recognizable melody, protected recording, or imitated voice."
          : profile.goal === "mixed_audio"
            ? "Create an original, produced audible scene with authored dialogue, atmosphere, sound effects, and music only when appropriate. Never imitate a protected recording, celebrity voice, or recognizable melody."
            : "Compose wholly original music and sound design. Never imitate a named artist, recognizable melody, protected recording, celebrity voice, or copyrighted lyrics. Treat supplied listening descriptions as abstract creative inspiration, never as audio waveform conditioning.",
    },
    {
      id: "creative-brief",
      priority: "required" as const,
      content: [clean(plan.title), clean(plan.summary)].filter(Boolean).join("\n"),
    },
    ...(destinationDirection ? [{ id: "delivery-destination", priority: "important" as const, content: destinationDirection }] : []),
    ...(requirements.length ? [{
      id: "authored-requirements",
      priority: "required" as const,
      content: `Protect these explicit authored requirements:\n${requirements.map((requirement, index) => `${index + 1}. ${requirement}`).join("\n")}`,
    }] : []),
    ...(prohibited.length ? [{
      id: "authored-prohibitions",
      priority: "required" as const,
      content: `NEVER include any of these protected authorial prohibitions:\n${prohibited.map((fact, index) => `${index + 1}. ${clean(fact.direction)}`).join("\n")}`,
    }] : []),
    ...(clean(plan.content_markdown) ? [{
      id: "detailed-composition-direction",
      priority: "important" as const,
      content: clean(plan.content_markdown),
    }] : []),
    ...(orderedBeats.length ? [{
      id: "ordered-dramatic-cues",
      priority: "important" as const,
      content: `Follow this authored dramatic sequence; let restraint, movement, texture, and resolution match each beat:\n${orderedBeats.join("\n")}`,
    }] : []),
    ...(references.length ? [{
      id: "approved-listening-context",
      priority: "important" as const,
      content: `Use these explicitly approved listening descriptions as semantic inspiration only:\n${references.map((reference, index) => `${index + 1}. ${clean(audioContextDescription(reference))}`).join("\n")}`,
    }] : []),
    ...(combinedContextPromptDirectives(snapshot, "audio").length ? [{
      id: "scoped-motifs",
      priority: "important" as const,
      content: `Keep each motif and environmental cue scoped to its authored subject or dramatic moment:\n${combinedContextPromptDirectives(snapshot, "audio").map(clean).join("\n")}`,
    }] : []),
    ...([clean(options.tone), clean(options.audience)].some(Boolean) ? [{
      id: "creative-audience",
      priority: "optional" as const,
      content: [options.tone ? `Emotional treatment: ${clean(options.tone)}.` : "", options.audience ? `Intended listener or creative audience: ${clean(options.audience)}.` : ""].filter(Boolean).join(" "),
    }] : []),
  ];
  const maxPromptCharacters = Math.min(options.maxPromptCharacters ?? contract.maxPromptCharacters, contract.maxPromptCharacters);
  const compilation = compileContextAdaptationSections(sections, maxPromptCharacters);
  if (compilation.valid) serializeAudioRequest(contract.model, { prompt: compilation.prompt, profile, ...(contract.supportsVideoReference ? { videoUrl: "https://fal.media/approved-video" } : {}) });
  return {
    adapterId: contract.adapterId,
    adapterVersion: contract.adapterVersion,
    prompt: compilation.prompt,
    compilation,
    sourceAudioBlockIds: references.map((reference) => reference.blockId).filter(Boolean),
    audioWaveformSubmitted: false,
    sourceAudioTreatment: references.length ? "authored-description-only" : "none",
    orderedCueCount: cues.length,
  };
}

/** Validate immutable inputs before planning and disclose the downstream budget. */
export function audioPreparationConstraints(snapshot: Record<string, unknown>, options: { profile: AudioRequestProfile; model: string; tone?: string; audience?: string }) {
  const contract = audioAdapterContractForModel(options.model);
  if (!contract) throw new AudioProviderInputError("audio_provider_model_unsupported", "The requested audio model is not approved.");
  const sampleScript = options.profile.speakerCount === 2 ? "Speaker1: A\nSpeaker2: B" : "A";
  const prepared = adaptAudioPrompt(snapshot, { title: "Audio", summary: "", content_markdown: options.profile.goal === "narration" ? sampleScript : "", items: [] }, { ...options, omitOptionalVoiceDirection: true });
  if (!prepared.compilation.valid) throw new AudioProviderInputError("audio_prompt_requirements_exceed_provider_limit", prepared.compilation.issues.map((issue) => issue.message).join(" "));
  const inputContract = AUDIO_PROVIDER_INPUT_CONTRACTS[contract.model]!;
  const scriptBytes = contract.model === "fal-ai/gemini-3.1-flash-tts"
    ? GEMINI_SPEECH_INPUT_POLICY.maxCombinedUtf8Bytes - (prepared.voiceDirection ? audioUtf8Bytes(prepared.voiceDirection) + 2 : 0) : null;
  return {
    model: contract.model, adapter_version: contract.adapterVersion,
    maximum_prompt_characters: contract.maxPromptCharacters,
    provider_prompt_character_limit: inputContract.parameters.prompt?.maxLength ?? null,
    maximum_content_characters: options.profile.transcript ? Math.max(options.profile.transcript.length, scriptBytes ?? contract.maxPromptCharacters) : scriptBytes ?? contract.maxPromptCharacters,
    approved_script_present: options.profile.goal === "narration" && Boolean(options.profile.transcript),
    supported_parameters: Object.keys(inputContract.parameters),
    parameter_limits: inputContract.parameters,
    duration: { parameter: inputContract.parameters.duration ?? null, requested_seconds: options.profile.durationSeconds ?? null, default_seconds: contract.defaultDurationSeconds, maximum_seconds: contract.maximumAdvertisedDurationSeconds, exact: contract.supportsExactDuration },
    ...(scriptBytes !== null ? {
      maximum_script_utf8_bytes: scriptBytes,
      target_script_utf8_bytes: Math.min(GEMINI_SPEECH_INPUT_POLICY.targetScriptUtf8Bytes, scriptBytes),
      maximum_style_characters: GEMINI_SPEECH_INPUT_POLICY.maxStyleCharacters,
      maximum_combined_utf8_bytes: GEMINI_SPEECH_INPUT_POLICY.maxCombinedUtf8Bytes,
      input_token_limit: GEMINI_SPEECH_INPUT_POLICY.inputTokenLimit,
      budget_basis: "conservative-utf8-with-wrapper-allowance",
      speaker_aliases: options.profile.speakerCount === 2 ? ["Speaker1", "Speaker2"] : [],
      preserve_approved_script: true,
    } : {}),
  };
}
