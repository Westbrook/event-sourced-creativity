/** A content contract, never generation authority or a claim of creative quality.
 * This first policy covers the English Short story recipe only. New languages,
 * formats or counting rules need a distinct version; there is no locale fallback. */
export const SHORT_STORY_NARRATIVE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  id: "forma.short-story.en@1",
  artifactKind: "short_story",
  language: "en",
  genre: "fiction",
  contentField: "content_markdown",
  bodyFormat: "plain-prose@1",
  wordCountPolicy: "english-lexical@1",
  wordRange: Object.freeze({ min: 600, max: 800 }),
  maximumBodyBytes: 65_536,
} as const);
export type ShortStoryNarrativeContract = typeof SHORT_STORY_NARRATIVE_CONTRACT;
export type ShortStoryBodyIssue = Readonly<{
  code: "narrative_contract_invalid" | "narrative_kind_mismatch" | "narrative_body_invalid"
    | "narrative_body_too_large" | "narrative_body_not_plain_prose" | "narrative_word_count_out_of_range";
  path: "contract" | "artifactKind" | "content_markdown";
}>;
export type ShortStoryBodyAssessment = Readonly<{
  valid: boolean;
  wordCount: number | null;
  policy: "english-lexical@1" | null;
  issues: readonly ShortStoryBodyIssue[];
}>;

/** Inspect descriptors before values: no getter, toJSON, symbol or prototype capability. */
function closedRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => {
    const descriptor = descriptors[key];
    return descriptor && descriptor.enumerable && "value" in descriptor;
  });
}
export function parseShortStoryNarrativeContract(value: unknown): ShortStoryNarrativeContract | null {
  const contract = SHORT_STORY_NARRATIVE_CONTRACT;
  if (!closedRecord(value, Object.keys(contract))) return null;
  if (!closedRecord(value.wordRange, ["min", "max"]) || value.wordRange.min !== 600 || value.wordRange.max !== 800) return null;
  for (const key of Object.keys(contract) as (keyof ShortStoryNarrativeContract)[]) {
    if (key !== "wordRange" && value[key] !== contract[key]) return null;
  }
  // Canonical immutable value, not the caller's mutable envelope.
  return contract;
}

function assessment(code: ShortStoryBodyIssue["code"] | null, path: ShortStoryBodyIssue["path"], wordCount: number | null, policy: ShortStoryBodyAssessment["policy"]): ShortStoryBodyAssessment {
  return Object.freeze({ valid: code === null, wordCount, policy,
    issues: Object.freeze(code ? [Object.freeze({ code, path })] : []) });
}

/** Counts only a validated complete body, never title, summary, items or notes.
 * A lexical word starts with a Unicode letter/number and may contain marks.
 * Internal ASCII/curly apostrophes and hyphen/U+2010/U+2011 join one word.
 * En/em dashes, other punctuation and whitespace separate words. Numeral runs
 * count; punctuation-only strings do not. Unicode names are allowed in English
 * prose; this is not language detection or a general multilingual tokenizer.
 * No truncation, padding, normalization of returned content, I/O, repair or retry. */
export function assessShortStoryBody(artifactKind: unknown, rawContract: unknown, contentMarkdown: unknown): ShortStoryBodyAssessment {
  const contract = parseShortStoryNarrativeContract(rawContract);
  if (!contract) return assessment("narrative_contract_invalid", "contract", null, null);
  if (artifactKind !== contract.artifactKind) return assessment("narrative_kind_mismatch", "artifactKind", null, contract.wordCountPolicy);
  if (typeof contentMarkdown !== "string" || !contentMarkdown.trim()) return assessment("narrative_body_invalid", "content_markdown", null, contract.wordCountPolicy);
  if (contentMarkdown.length > contract.maximumBodyBytes || new TextEncoder().encode(contentMarkdown).byteLength > contract.maximumBodyBytes)
    return assessment("narrative_body_too_large", "content_markdown", null, contract.wordCountPolicy);
  // Only LF/CR/TAB controls are accepted. Format controls and unpaired surrogates
  // cannot hide countable source. Paragraph breaks and dialogue punctuation remain.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}\uD800-\uDFFF]/u.test(contentMarkdown))
    return assessment("narrative_body_invalid", "content_markdown", null, contract.wordCountPolicy);
  // Conservative plain-prose grammar. Do not strip markup and count hidden text.
  if (/[<>`*_~]/u.test(contentMarkdown)
    || /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/iu.test(contentMarkdown)
    || /\[[^[\]\r\n]*\][ \t]*(?:\(|\[|:)/u.test(contentMarkdown)
    || /^ {0,3}(?=[^\r\n]*\|)\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/mu.test(contentMarkdown)
    || /^ {0,3}(?:#{1,6}(?:\s|$)|[-+]\s|\d+[.)]\s|(?:=+|-+)\s*$|\[[^\]\r\n]+\]:)/mu.test(contentMarkdown)
    || /^(?: {4,}| *\t)[^\S\r\n]*\S/mu.test(contentMarkdown))
    return assessment("narrative_body_not_plain_prose", "content_markdown", null, contract.wordCountPolicy);
  const wordCount = [...contentMarkdown.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’\-‐‑][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu)].length;
  return assessment(wordCount >= contract.wordRange.min && wordCount <= contract.wordRange.max ? null : "narrative_word_count_out_of_range", "content_markdown", wordCount, contract.wordCountPolicy);
}
