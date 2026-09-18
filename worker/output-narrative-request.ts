import { assessShortStoryBody, parseShortStoryNarrativeContract, type ShortStoryNarrativeContract } from "../src/model/output-narrative-contract.ts";
import { OPENAI_TEXT_PRICING_VERSION } from "./openai-text-cost.ts";

export const OUTPUT_NARRATIVE_MODEL = "gpt-5.6-terra";
export const OUTPUT_NARRATIVE_INSTRUCTIONS = "Write one complete fictional short story in English. Return 600–800 words of plain prose in content_markdown. Count only the story body, not title, summary, or items. Use ordinary paragraphs and dialogue; no Markdown formatting, headings, lists, tables, links, HTML, or code. Preserve authored names and direct quotations. Do not pad, truncate, summarize, or include production instructions in the story.";

export type OutputNarrativeExecution = Readonly<{
  schemaVersion: 1;
  contract: ShortStoryNarrativeContract;
  contractDigest: string;
  model: typeof OUTPUT_NARRATIVE_MODEL;
  maximumInputTokens: number;
  maximumOutputTokens: 6000;
  maximumCalls: 1;
  stage: "planning:0:initial";
  pricingVersion: typeof OPENAI_TEXT_PRICING_VERSION;
  cachePolicy: "disabled-explicit";
  reasoningEffort: "low";
}>;

function ownData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length || Object.values(descriptors).some(entry => !("value" in entry) || !entry.enumerable)) return null;
  return Object.fromEntries(Object.entries(descriptors).map(([key, entry]) => [key, entry.value]));
}
const sha256 = async (body: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))), byte => byte.toString(16).padStart(2, "0")).join("");
// Only called on the exact, validated frozen contract. Matches outputDigest's
// canonical JSON, without importing the Output ledger into the renderer.
function contractJson(contract: ShortStoryNarrativeContract): string {
  const ordered = Object.fromEntries(Object.entries(contract).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  ordered.wordRange = { max: contract.wordRange.max, min: contract.wordRange.min };
  return JSON.stringify(ordered);
}

export async function createOutputNarrativeExecution(value: unknown, model: string, maximumInputTokens: number): Promise<OutputNarrativeExecution> {
  const contract = parseShortStoryNarrativeContract(value);
  if (!contract || model !== OUTPUT_NARRATIVE_MODEL || !Number.isSafeInteger(maximumInputTokens) || maximumInputTokens < 4096 || maximumInputTokens > 122000) throw new Error("output_narrative_execution_invalid");
  return Object.freeze({ schemaVersion: 1, contract, contractDigest: await sha256(contractJson(contract)), model, maximumInputTokens, maximumOutputTokens: 6000, maximumCalls: 1, stage: "planning:0:initial", pricingVersion: OPENAI_TEXT_PRICING_VERSION, cachePolicy: "disabled-explicit", reasoningEffort: "low" });
}

export async function readOutputNarrativeExecution(value: unknown): Promise<OutputNarrativeExecution | null> {
  const raw = ownData(value);
  if (!raw || typeof raw.model !== "string" || typeof raw.maximumInputTokens !== "number") return null;
  let expected: OutputNarrativeExecution;
  try { expected = await createOutputNarrativeExecution(raw.contract, raw.model, raw.maximumInputTokens); } catch { return null; }
  if (Object.keys(raw).length !== Object.keys(expected).length || Object.entries(expected).some(([key, field]) => key !== "contract" && raw[key] !== field)) return null;
  return expected;
}

/** Capture once, then recheck these exact bytes against the original slot before claiming its call. */
export async function captureOutputNarrativeRequest(value: unknown, kind: string, body: string, clientRequestId: string) {
  const execution = await readOutputNarrativeExecution(value);
  if (!execution || kind !== "short_story" || typeof body !== "string" || body.length > execution.maximumInputTokens || !/^forma-short_story-[A-Za-z0-9-]{1,80}$/u.test(clientRequestId)) throw new Error("output_narrative_request_invalid");
  const request: Record<string, unknown> = JSON.parse(body);
  const fields = ["model", "instructions", "input", "text", "reasoning", "max_output_tokens", "store", "safety_identifier", "service_tier", "prompt_cache_options"];
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== fields.length || fields.some(key => !Object.hasOwn(request, key)) || JSON.stringify(request) !== body) throw new Error("output_narrative_request_invalid");
  const input = typeof request.input === "string" ? ownData(JSON.parse(request.input)) : null;
  const text = ownData(request.text), format = ownData(text?.format);
  const maximumInputTokens = new TextEncoder().encode(body).byteLength + 4096;
  if (request.model !== execution.model || request.max_output_tokens !== execution.maximumOutputTokens || request.store !== false || request.service_tier !== "default"
    || JSON.stringify(request.reasoning) !== '{"effort":"low"}' || JSON.stringify(request.prompt_cache_options) !== '{"mode":"explicit"}'
    || typeof request.safety_identifier !== "string" || !request.safety_identifier || typeof request.instructions !== "string" || !request.instructions.endsWith(OUTPUT_NARRATIVE_INSTRUCTIONS)
    || !input || !parseShortStoryNarrativeContract(input.narrative_contract) || input.narrative_contract_digest !== execution.contractDigest
    || text?.verbosity !== "medium" || format?.type !== "json_schema" || format.strict !== true || format.name !== "document_short_story" || !ownData(format.schema)
    || maximumInputTokens > execution.maximumInputTokens) throw new Error("output_narrative_request_outside_contract");
  return Object.freeze({ body, execution, attempt: Object.freeze({ model: execution.model, maximumInputTokens, maximumOutputTokens: execution.maximumOutputTokens, clientRequestId, logicalCallKey: execution.stage, requestDigest: await sha256(body), reasoningEffort: execution.reasoningEffort, pricingVersion: execution.pricingVersion, cachePolicy: execution.cachePolicy, narrative: Object.freeze({ execution, requestBody: body }) }) });
}

/** A parseable body cannot override provider completion, refusal, or model evidence. */
export function outputNarrativeResponseProblem(value: unknown, expectedModel: string): string | null {
  const response = ownData(value);
  if (!response || response.model !== expectedModel) return "narrative_effective_model_mismatch";
  const output = Array.isArray(response.output) ? response.output : [];
  const refused = output.some(item => { const row = ownData(item); return row?.type === "refusal" || (Array.isArray(row?.content) && row.content.some(item => { const content = ownData(item); return content?.type === "refusal" || Boolean(content?.refusal); })); });
  if (refused || ownData(response.incomplete_details)?.reason === "content_filter") return "narrative_provider_refused";
  if (response.status !== "completed" || response.incomplete_details != null) return "narrative_provider_response_incomplete";
  if (typeof response.id !== "string" || !response.id.trim()) return "narrative_response_identity_missing";
  return null;
}

/** Check the existing non-media provider schema without normalizing its values. */
export function outputNarrativeArtifactProblem(raw: string, finalBody: unknown): string | null {
  let artifact: Record<string, unknown> | null;
  try { artifact = ownData(JSON.parse(raw)); } catch { return "narrative_artifact_invalid"; }
  const fields = ["title", "summary", "content_markdown", "items"];
  const itemFields = ["title", "body", "notes", "image_prompt", "context_group_ids"];
  if (!artifact || Object.keys(artifact).length !== fields.length || fields.some(key => !Object.hasOwn(artifact, key))
    || typeof artifact.title !== "string" || typeof artifact.summary !== "string" || typeof artifact.content_markdown !== "string"
    || !Array.isArray(artifact.items) || artifact.items.length < 1 || artifact.items.length > 12) return "narrative_artifact_invalid";
  if (artifact.content_markdown !== finalBody) return "narrative_body_changed";
  for (const value of artifact.items) {
    const item = ownData(value);
    if (!item || Object.keys(item).length !== itemFields.length || itemFields.some(key => !Object.hasOwn(item, key))
      || ["title", "body", "notes", "image_prompt"].some(key => typeof item[key] !== "string")
      || !Array.isArray(item.context_group_ids) || item.context_group_ids.length > 24 || item.context_group_ids.some(id => typeof id !== "string")) return "narrative_artifact_invalid";
  }
  return null;
}

/** Validate the exact final body that will be returned and stored, without edits. */
export async function outputNarrativeBodyReceipt(execution: OutputNarrativeExecution, kind: string, body: unknown) {
  const assessment = assessShortStoryBody(kind, execution.contract, body);
  if (!assessment.valid || typeof body !== "string") throw new Error("output_narrative_body_invalid");
  return Object.freeze({ narrative_contract: execution.contract, narrative_contract_digest: execution.contractDigest, narrative_body_sha256: await sha256(body), narrative_word_count: assessment.wordCount, narrative_word_count_policy: assessment.policy });
}
