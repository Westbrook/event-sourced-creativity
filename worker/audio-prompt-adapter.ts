import { AUDIO_ADAPTER_CONTRACT, audioContextDescription, audioContexts } from "../src/model/audio.ts";
import { combinedContextPromptDirectives } from "../src/model/combined-context.ts";
import { compileContextAdaptationSections, requiredContextAdaptationFacts, type CompiledContextAdaptation } from "../src/model/context-adaptation.ts";
import type { DocumentArtifactDraft } from "../src/model/document-artifacts.ts";

export type AudioPromptAdaptation = {
  adapterId: string;
  adapterVersion: string;
  prompt: string;
  compilation: CompiledContextAdaptation;
  sourceAudioBlockIds: string[];
  audioWaveformSubmitted: false;
  sourceAudioTreatment: "none" | "authored-description-only";
  orderedCueCount: number;
};

const privateMedia = /(?:https?:\/\/[^\s"')]+|\/api\/media\/[^\s"')]+)/giu;
const clean = (value: unknown) => String(value ?? "").replace(privateMedia, "[private source]").replace(/\r\n?/g, "\n").trim();

/** Translate approved sonic meaning into Lyria's text-only creative contract. */
export function adaptAudioPrompt(
  snapshot: Record<string, unknown>,
  plan: Pick<DocumentArtifactDraft, "title" | "summary" | "content_markdown" | "items">,
  options: { tone?: string; audience?: string; maxPromptCharacters?: number } = {},
): AudioPromptAdaptation {
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
  const orderedBeats = plan.items.flatMap((item, index) => {
    const description = [clean(item.title), clean(item.body), clean(item.notes)].filter(Boolean).join(" · ");
    return description ? [`${index + 1}. ${description}`] : [];
  });

  const sections = [
    {
      id: "originality-policy",
      priority: "required" as const,
      allowCompaction: false,
      content: "Compose wholly original music and sound design. Never imitate a named artist, recognizable melody, protected recording, celebrity voice, or copyrighted lyrics. Treat supplied listening descriptions as abstract creative inspiration, never as audio waveform conditioning.",
    },
    {
      id: "creative-brief",
      priority: "required" as const,
      content: [clean(plan.title), clean(plan.summary)].filter(Boolean).join("\n"),
    },
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
  const maxPromptCharacters = Math.min(options.maxPromptCharacters ?? AUDIO_ADAPTER_CONTRACT.maxPromptCharacters, AUDIO_ADAPTER_CONTRACT.maxPromptCharacters);
  const compilation = compileContextAdaptationSections(sections, maxPromptCharacters);
  return {
    adapterId: AUDIO_ADAPTER_CONTRACT.adapterId,
    adapterVersion: AUDIO_ADAPTER_CONTRACT.adapterVersion,
    prompt: compilation.prompt,
    compilation,
    sourceAudioBlockIds: references.map((reference) => reference.blockId).filter(Boolean),
    audioWaveformSubmitted: false,
    sourceAudioTreatment: references.length ? "authored-description-only" : "none",
    orderedCueCount: cues.length,
  };
}
