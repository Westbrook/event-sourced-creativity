import { combinedContextMemberships, type CombinedContextMembership } from "./combined-context.ts";
import { promptFactIsActive } from "./prompt-policy.ts";

export type ContextAdapterOutput = "image" | "video" | "audio" | "story" | "short_story" | "scene" | "slides" | "storyboard";
export type ContextAdaptationPriority = "required" | "important" | "optional";

/** A provider-independent contract that future adapters can satisfy without sharing provider code. */
export type ContextAdapterContract = {
  adapterId: string;
  adapterVersion: string;
  provider: string;
  model: string;
  output: ContextAdapterOutput;
  maxPromptCharacters: number;
  capabilities: readonly string[];
};

export type ContextAdaptationSection = {
  id: string;
  content: string;
  priority?: ContextAdaptationPriority;
  allowCompaction?: boolean;
};

export type ContextAdaptationIssue = {
  code: "required_section_missing" | "required_context_exceeds_budget" | "prompt_budget_invalid" | "section_id_duplicated" | "adapted_prompt_empty";
  message: string;
  sectionIds: string[];
};

export type CompiledContextAdaptation = {
  prompt: string;
  valid: boolean;
  limit: number;
  originalCharacters: number;
  adaptedCharacters: number;
  compacted: boolean;
  includedSectionIds: string[];
  omittedSectionIds: string[];
  compactedSectionIds: string[];
  issues: ContextAdaptationIssue[];
};

export type RequiredContextAdaptationFact = {
  blockId: string;
  type: string;
  direction: string;
  fact: Record<string, unknown>;
  properties: Record<string, unknown>;
};

export type ScopedContextAdaptationFact<Fact extends { properties?: unknown }> = {
  fact: Fact;
  memberships: CombinedContextMembership[];
};

/** A target-local decision must never become a contradictory document-wide rule. */
export function partitionContextAdaptationFactScopes<Fact extends { properties?: unknown }>(facts: readonly Fact[]): {
  global: Fact[];
  scoped: ScopedContextAdaptationFact<Fact>[];
} {
  const global: Fact[] = [];
  const scoped: ScopedContextAdaptationFact<Fact>[] = [];
  for (const fact of facts) {
    const properties = fact.properties && typeof fact.properties === "object" && !Array.isArray(fact.properties) ? fact.properties as Record<string, unknown> : {};
    const memberships = combinedContextMemberships(properties);
    if (memberships.length) scoped.push({ fact, memberships });
    else global.push(fact);
  }
  return { global, scoped };
}

/** Normalize genuine authorial hard requirements once for every output adapter. */
export function requiredContextAdaptationFacts(snapshot: Record<string, unknown>): RequiredContextAdaptationFact[] {
  if (!Array.isArray(snapshot.facts)) return [];
  return snapshot.facts.filter(promptFactIsActive).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const fact = value as Record<string, unknown>;
    const properties = fact.properties && typeof fact.properties === "object" && !Array.isArray(fact.properties) ? fact.properties as Record<string, unknown> : {};
    if (fact.locked !== true && properties.locked !== true && properties.required !== true && properties.authority !== "locked") return [];
    const meaningfulFields = ["text", "instruction", "description", "value", "label", "exact_text", "colors", "palette", "aspect_ratio", "font_family", "font_weight", "lens", "camera_direction", "camera", "lighting", "brand_name", "motion", "materials", "safe_area", "image_format", "format", "resolution", "accessibility", "contrast", "minimum_contrast", "style", "wardrobe", "subject", "environment", "composition", "audio_role", "mood", "emotional_arc", "narrative_purpose", "instrumentation", "texture", "soundscape", "tempo_bpm", "vocal_policy", "transcript", "lyrics", "audio_cues"] as const;
    const values = meaningfulFields.flatMap((key) => {
      const candidate = properties[key];
      if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") return [String(candidate)];
      if (Array.isArray(candidate)) return [candidate.map((item) => {
        if (typeof item !== "object" || item === null) return String(item);
        if (key === "audio_cues") { const cue = item as Record<string, unknown>; return [cue.start_seconds ?? cue.startSeconds, cue.end_seconds ?? cue.endSeconds, cue.target_kind ?? cue.targetKind, cue.label, cue.emotional_intent ?? cue.emotionalIntent].filter((value) => value !== undefined && value !== null && String(value).trim()).join(" · "); }
        return JSON.stringify(item);
      }).filter(Boolean).join(", ")];
      if (candidate && typeof candidate === "object") return [JSON.stringify(candidate)];
      return [];
    });
    const direction = [...new Set(values.map((candidate) => candidate.replace(/\s+/g, " ").trim()))].filter(Boolean).join(" · ");
    return [{ blockId: String(fact.block_id ?? ""), type: String(fact.type ?? fact.role ?? "decision"), direction, fact, properties }];
  });
}

const normalizedSection = (content: string) => content.replace(/\r\n?/g, "\n").trim();

function compactSection(content: string, remaining: number) {
  if (remaining < 32) return "";
  const candidate = content.slice(0, remaining);
  const sentenceBoundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("! "), candidate.lastIndexOf("? "), candidate.lastIndexOf("\n"));
  if (sentenceBoundary < 24) return "";
  return candidate.slice(0, sentenceBoundary + (candidate[sentenceBoundary] === "\n" ? 0 : 1)).trimEnd();
}

/**
 * Reserve every mandatory section first, then spend any remaining budget on
 * important and optional sections without changing their original order.
 */
export function compileContextAdaptationSections(
  sections: readonly ContextAdaptationSection[],
  maxPromptCharacters: number,
  separator = "\n\n",
): CompiledContextAdaptation {
  const limit = Number.isInteger(maxPromptCharacters) && maxPromptCharacters > 0 ? maxPromptCharacters : 0;
  const normalized = sections.map((section, index) => ({
    ...section,
    index,
    priority: section.priority ?? "important",
    content: normalizedSection(section.content),
  }));
  const issues: ContextAdaptationIssue[] = normalized.filter((section) => section.priority === "required" && !section.content).map((section) => ({
    code: "required_section_missing",
    message: `Required adaptation section "${section.id}" is empty.`,
    sectionIds: [section.id],
  }));
  if (!limit) issues.push({ code: "prompt_budget_invalid", message: "The adapter must declare a positive, whole-number provider prompt budget.", sectionIds: [] });
  const identifiers = new Set<string>();
  for (const section of normalized) {
    if (identifiers.has(section.id)) issues.push({ code: "section_id_duplicated", message: `The adaptation section "${section.id}" was declared more than once.`, sectionIds: [section.id] });
    identifiers.add(section.id);
  }
  const available = normalized.filter((section) => section.content);
  if (!available.length) issues.push({ code: "adapted_prompt_empty", message: "The adapter did not produce any provider-facing creative direction.", sectionIds: [] });
  const originalCharacters = available.map((section) => section.content).join(separator).length;
  const required = available.filter((section) => section.priority === "required");
  const requiredCharacters = required.map((section) => section.content).join(separator).length;
  if (requiredCharacters > limit) issues.push({
    code: "required_context_exceeds_budget",
    message: `Required creative context needs ${requiredCharacters.toLocaleString()} characters, exceeding the provider limit of ${limit.toLocaleString()}.`,
    sectionIds: required.map((section) => section.id),
  });

  if (issues.length) return {
    prompt: required.map((section) => section.content).join(separator),
    valid: false,
    limit,
    originalCharacters,
    adaptedCharacters: requiredCharacters,
    compacted: originalCharacters !== requiredCharacters,
    includedSectionIds: required.map((section) => section.id),
    omittedSectionIds: available.filter((section) => section.priority !== "required").map((section) => section.id),
    compactedSectionIds: [],
    issues,
  };

  if (originalCharacters <= limit) return {
    prompt: available.map((section) => section.content).join(separator),
    valid: true,
    limit,
    originalCharacters,
    adaptedCharacters: originalCharacters,
    compacted: false,
    includedSectionIds: available.map((section) => section.id),
    omittedSectionIds: [],
    compactedSectionIds: [],
    issues: [],
  };

  const included = new Map(required.map((section) => [section.index, section.content]));
  const compactedSectionIds: string[] = [];
  let used = requiredCharacters;
  for (const priority of ["important", "optional"] as const) {
    for (const section of available.filter((candidate) => candidate.priority === priority)) {
      const joinCost = included.size ? separator.length : 0;
      const remaining = limit - used - joinCost;
      if (remaining <= 0) continue;
      const content = section.content.length <= remaining
        ? section.content
        : section.allowCompaction === false ? "" : compactSection(section.content, remaining);
      if (!content) continue;
      included.set(section.index, content);
      used += content.length + joinCost;
      if (content !== section.content) compactedSectionIds.push(section.id);
    }
  }

  const chosen = available.filter((section) => included.has(section.index));
  const prompt = chosen.map((section) => included.get(section.index)).join(separator);
  if (!prompt) {
    issues.push({ code: "adapted_prompt_empty", message: "No provider-facing creative direction fits the declared adapter prompt budget.", sectionIds: available.map((section) => section.id) });
  }
  return {
    prompt,
    valid: issues.length === 0,
    limit,
    originalCharacters,
    adaptedCharacters: prompt.length,
    compacted: true,
    includedSectionIds: chosen.map((section) => section.id),
    omittedSectionIds: available.filter((section) => !included.has(section.index)).map((section) => section.id),
    compactedSectionIds,
    issues,
  };
}
