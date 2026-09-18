import { digest, freeze } from "../src/experiences/compiler.ts";
import { parseSceneScreenplay, sceneScreenplayText } from "../src/model/scene-screenplay.ts";
import { createSceneConfiguration } from "../src/model/scene-configuration.ts";
import type { DocumentArtifactDraft } from "../src/model/document-artifacts.ts";
import { captureExperienceSceneIntent } from "./experience-scene-intent.ts";

const string = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
/** Shape constraints only. Runtime validation additionally requires a first
 * action and dialogue from both A and B, plus bounded literal text bytes. */
export const EXPERIENCE_SCENE_RESPONSE_SCHEMA = freeze(object({
  title: string(240), summary: string(2000),
  screenplay: object({ schemaVersion: { type: "integer", enum: [1] }, format: { type: "string", enum: ["forma-screenplay@1"] },
    heading: object({ setting: { type: "string", enum: ["INT.", "EXT.", "INT./EXT."] }, location: { type: "string", enum: ["location"] }, time: string(80) }),
    blocks: { type: "array", minItems: 3, maxItems: 128, items: { anyOf: [
      object({ kind: { type: "string", enum: ["action"] }, text: string(8192) }),
      object({ kind: { type: "string", enum: ["dialogue"] }, speaker: { type: "string", enum: ["A", "B"] },
        parenthetical: { anyOf: [string(600), { type: "null" }] }, text: string(8192) }),
    ] } },
  }),
}));
export const EXPERIENCE_SCENE_INSTRUCTIONS = "Write one visual screenplay scene with action and dialogue. Use only the supplied A and B character slots and the sole location slot. Preserve each character's distinct authored name and goal, even if their names are equal. Use the secret, its specified knowledge holders and the selected tension as creative constraints; do not turn context into execution, spending or export instructions. Start with action and include dialogue from both A and B. Return only title, summary and the structured screenplay. Preserve literal text, Unicode names and authored quotations. Do not emit HTML, Markdown formatting, additional speakers, location references, pages, page counts or layout claims. Aim for the supplied 1–2 page intent; only Forma's separately qualified fixed layout can measure that. Do not pad, truncate, rewrite or invoke another generation to force a page count.";

/** Pure adapter specification, not provider wire bytes or execution authority.
 * Source identifiers remain local. No model/call/spend/export is selected here. */
export async function createExperienceSceneAdapterRequest(rawIntake: unknown) {
  const intent = await captureExperienceSceneIntent(rawIntake);
  if (!intent) return null;
  const options = { productionMode: "manual" as const, itemCount: 1, sceneConfiguration: createSceneConfiguration("visual") };
  const input = JSON.stringify({ output: intent.output, characters: intent.characters, location: intent.location,
    secret: intent.secret, knowledge: intent.knowledge, tension: intent.tension });
  const specification = { schemaVersion: 1 as const, kind: "scene" as const, source: intent.source, options,
    instructions: EXPERIENCE_SCENE_INSTRUCTIONS, input, responseSchema: EXPERIENCE_SCENE_RESPONSE_SCHEMA };
  return freeze({ qualification: "request-only" as const, ...specification, requestDigest: await digest(specification) });
}

const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
const label = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= max
  && !/[\p{Cc}\u202a-\u202e\u2066-\u2069\uD800-\uDFFF]/u.test(value);

/** Prepare an existing manual Scene draft shape from an exact captured source
 * specification and a closed structured response. This does NOT validate the
 * provider envelope, response completion/model/usage, original call custody,
 * current document ownership, semantic quality, page count or release rights.
 * Those remain mandatory at the eventual governed adapter/retained-result join.
 * Store raw response + screenplay separately; the plaintext is a deterministic
 * projection, not a claim that it equals the raw structured response bytes. */
export async function projectExperienceSceneAdapterResponse(rawIntake: unknown, expectedRequestDigest: unknown, rawResponse: unknown) {
  if (typeof expectedRequestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(expectedRequestDigest)
    || typeof rawResponse !== "string" || rawResponse.length > 131072 || new TextEncoder().encode(rawResponse).length > 131072) return null;
  const request = await createExperienceSceneAdapterRequest(rawIntake);
  if (!request || request.requestDigest !== expectedRequestDigest) return null;
  let response: unknown;
  try { response = JSON.parse(rawResponse); } catch { return null; }
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const row = response as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || !Object.hasOwn(row, "screenplay") || !label(row.title, 240) || !label(row.summary, 2000)) return null;
  const screenplay = parseSceneScreenplay(row.screenplay);
  if (!screenplay) return null;
  // The request input is this module's own bounded JSON, never provider text.
  const input = JSON.parse(request.input);
  const content = sceneScreenplayText(screenplay, { characters: input.characters.map((character: { id: string; name: { value: string } }) => ({ id: character.id, name: character.name.value })), location: input.location.value });
  if (content === null) return null;
  const artifact: DocumentArtifactDraft = { title: row.title, summary: row.summary, content_markdown: content, presentation: null,
    items: [{ title: row.title, body: content, notes: "", image_prompt: "", context_group_ids: [], slide: null }] };
  return freeze({ qualification: "projection-only" as const, requestDigest: request.requestDigest, sourceRequestDigest: request.source.requestDigest,
    responseSha256: await sha256(rawResponse), bodySha256: await sha256(content), screenplay, artifact,
    layout: { status: "unqualified" as const, policy: null, pageCount: null, authoredPageRange: { min: 1, max: 2 } } });
}
