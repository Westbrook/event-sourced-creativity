import { assessShortStoryBody, parseShortStoryNarrativeContract, type ShortStoryNarrativeContract } from "../model/output-narrative-contract.ts";
import { validateRetainedStoryDto, type RetainedStoryDto } from "../model/retained-short-story.ts";
import { digest } from "./compiler.ts";

export type ExperienceStoryEvidence = Readonly<{
  contract: ShortStoryNarrativeContract; contractDigest: string;
  bodySha256: string; wordCount: number; wordCountPolicy: "english-lexical@1";
}>;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** document is the requirement medium; short_story is the exact artifact promise. */
export function isExperienceStoryTarget(value: unknown): boolean {
  const target = record(value), quantity = record(target?.quantity);
  return Boolean(target && target.media_kind === "document" && parseShortStoryNarrativeContract(target.narrative_contract)
    && quantity?.kind === "exact" && quantity.unit === "document" && quantity.value === 1
    && record(target.source_scope)?.kind === "document" && record(target.coverage)?.kind === "document_context"
    && !target.aspect_ratio && !target.content_quantity && !target.count_policy && !target.variant_id && !target.member_id);
}

/** Capture only completion metadata; this is not a body read or an authorization. */
export function captureExperienceStoryEvidence(value: unknown): ExperienceStoryEvidence | null {
  const settings = record(value), contract = parseShortStoryNarrativeContract(settings?.narrative_contract);
  if (!settings || !contract || !hash(settings.narrative_contract_digest) || !hash(settings.narrative_body_sha256)
    || !Number.isSafeInteger(settings.narrative_word_count) || Number(settings.narrative_word_count) < 600 || Number(settings.narrative_word_count) > 800
    || settings.narrative_word_count_policy !== contract.wordCountPolicy) return null;
  return Object.freeze({ contract, contractDigest: settings.narrative_contract_digest, bodySha256: settings.narrative_body_sha256,
    wordCount: Number(settings.narrative_word_count), wordCountPolicy: contract.wordCountPolicy });
}

/** Recheck current complete retained JSON and literal prose, not projected text or a title match. */
export async function verifyExperienceStoryRead(evidence: ExperienceStoryEvidence, raw: string, story: RetainedStoryDto, now = Date.now()): Promise<boolean> {
  try {
    if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 1000000 || !Number.isFinite(now)
      || story.selection.revision !== 0 || !validateRetainedStoryDto(story, story.selection, now) || Date.parse(story.expiresAt) <= now
      || !parseShortStoryNarrativeContract(evidence.contract) || (await digest(evidence.contract)).slice(7) !== evidence.contractDigest) return false;
    const artifact = record(JSON.parse(raw));
    if (!artifact || Object.keys(artifact).some(key => !["title", "summary", "content_markdown", "presentation", "items"].includes(key))
      || artifact.presentation !== null || artifact.title !== story.title || artifact.content_markdown !== story.contentMarkdown
      || !Array.isArray(artifact.items) || artifact.items.length !== 3
      || artifact.items.some(value => { const item = record(value); return !item || item.slide != null || Object.keys(item).some(key => !["title", "body", "notes", "image_prompt", "context_group_ids", "slide"].includes(key)); })) return false;
    const body = assessShortStoryBody("short_story", evidence.contract, story.contentMarkdown);
    if (!body.valid || body.wordCount !== evidence.wordCount || body.policy !== evidence.wordCountPolicy) return false;
    const sha = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
    const [contentHash, bodyHash] = await Promise.all([sha(raw), sha(story.contentMarkdown)]);
    return contentHash === story.selection.contentSha256 && bodyHash === evidence.bodySha256;
  } catch { return false; }
}
