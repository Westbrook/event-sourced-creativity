import { parseStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import type { DocumentArtifactDraft, DocumentArtifactDraftItem } from "../src/model/document-artifacts.ts";

const fail = (): never => { throw new Error("output_storyboard_plan_invalid"); };
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (!required.every(key => Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== "string"
    || ![...required, ...optional].includes(key) || !descriptors[key].enumerable || !("value" in descriptors[key]))) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== "string" || value.length > maximum || required && !value.trim()) return fail();
  for (const character of value) if ([0, 8, 11, 12].includes(character.charCodeAt(0))) return fail();
  return value;
}
function array(value: unknown, count?: number): unknown[] {
  if (!Array.isArray(value) || count !== undefined && value.length !== count || value.length > 4) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return fail();
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
    copy.push(descriptor.value);
  }
  return copy;
}
function frame(value: unknown): DocumentArtifactDraftItem {
  const row = fields(value, ["title", "body", "notes", "image_prompt", "slide"], ["context_group_ids"]);
  if (row.slide !== null) return fail();
  // The accepted mini-app has no group/reference authoring surface. An unknown
  // group cannot silently widen this initial route's source selection.
  if (Object.hasOwn(row, "context_group_ids") && array(row.context_group_ids, 0).length) return fail();
  return { title: text(row.title, 512, true), body: text(row.body, 16_384, true), notes: text(row.notes, 8_192),
    image_prompt: text(row.image_prompt, 8_192, true), slide: null,
    ...(Object.hasOwn(row, "context_group_ids") ? { context_group_ids: [] } : {}) };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
async function sha(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export type CapturedStoryboardPlan = Awaited<ReturnType<typeof captureOutputStoryboardPlan>>;
const capturedPlans = new WeakSet<object>();

/** Snapshot exactly four returned records before the first await. The existing
 * planner owns creative elaboration; this boundary does not split the author's
 * story, normalize text, manufacture frames or certify semantic faithfulness.
 * The caller must separately prove the original private source and paid receipt.
 */
export async function captureOutputStoryboardPlan(value: unknown, sourceContract: unknown, plannerResponseId: unknown) {
  const contract = parseStoryboardOutputContract(sourceContract);
  if (!contract || typeof plannerResponseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(plannerResponseId)) return fail();
  const row = fields(value, ["title", "summary", "content_markdown", "presentation", "items"]);
  if (row.presentation !== null) return fail();
  const plan: DocumentArtifactDraft = { title: text(row.title, 512, true), summary: text(row.summary, 4_096),
    content_markdown: text(row.content_markdown, 65_536, true), presentation: null, items: array(row.items, 4).map(frame) };
  const raw = JSON.stringify(plan);
  if (new TextEncoder().encode(raw).length > contract.maximumPlanBytes) return fail();
  const planSha256 = await sha(raw), bindingSha256 = await sha(JSON.stringify({ contract, plannerResponseId, planSha256 }));
  const captured = freeze({ contract, plannerResponseId, plan, raw, planSha256, bindingSha256 });
  capturedPlans.add(captured); return captured;
}

/** Literal planner scene to the existing image driver; no generic abstract
 * fallback, stylistic substitution or second planner. The full source snapshot
 * stays with the existing governed caller, never supplied by this helper.
 */
export function outputStoryboardFrameDirection(captured: CapturedStoryboardPlan, index: number) {
  if (!capturedPlans.has(captured) || !Number.isSafeInteger(index) || index < 0 || index >= 4) return fail();
  const item = captured.plan.items[index]!;
  return freeze({ title: item.title, rationale: item.notes, scene: item.image_prompt, palette: [] as string[], next_moves: [] as string[] });
}

/** A future per-frame native claim binds this captured planner result, its
 * original source contract, frame ordinal, and the final adapted Fal body.
 * Returning this digest alone grants no permission to send that body.
 */
export async function outputStoryboardFrameBinding(captured: CapturedStoryboardPlan, index: number, adaptedRequestDigest: string) {
  outputStoryboardFrameDirection(captured, index);
  if (!/^[a-f0-9]{64}$/u.test(adaptedRequestDigest)) return fail();
  return freeze({ stage: `image:frame:${index + 1}`, frameIndex: index,
    requestDigest: await sha(JSON.stringify({ storyboardBindingSha256: captured.bindingSha256, frameIndex: index, adaptedRequestDigest })) });
}
