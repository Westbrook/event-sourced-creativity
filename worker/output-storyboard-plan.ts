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
function array(value: unknown, count?: number, maximum=4): unknown[] {
  if (!Array.isArray(value) || count !== undefined && value.length !== count || value.length > maximum) return fail();
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
function frame(value: unknown, allowedGroups:ReadonlySet<string>): DocumentArtifactDraftItem {
  const row = fields(value, ["title", "body", "notes", "image_prompt"], ["context_group_ids", "slide"]);
  if (Object.hasOwn(row, "slide") && row.slide !== null) return fail();
  // These are request-local annotations from the exact planner request, never
  // new source IDs or permission to fetch additional context.
  const groups=Object.hasOwn(row,"context_group_ids")?array(row.context_group_ids,undefined,24):null;
  if(groups&&(groups.some(id=>typeof id!=="string"||!allowedGroups.has(id))||new Set(groups).size!==groups.length))return fail();
  return { title: text(row.title, 512, true), body: text(row.body, 16_384, true), notes: text(row.notes, 8_192),
    image_prompt: text(row.image_prompt, 8_192, true), slide: null,
    ...(groups ? { context_group_ids: groups as string[] } : {}) };
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
export async function captureOutputStoryboardPlan(value: unknown, sourceContract: unknown, plannerResponseId: unknown, plannerRequestBody?:string) {
  const contract = parseStoryboardOutputContract(sourceContract);
  if (!contract || typeof plannerResponseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(plannerResponseId)) return fail();
  const allowedGroups=new Set<string>();
  if(plannerRequestBody!==undefined){
    if(typeof plannerRequestBody!=="string"||new TextEncoder().encode(plannerRequestBody).length>262144)return fail();
    const request=JSON.parse(plannerRequestBody),input=JSON.parse(request.input);
    if(JSON.stringify(parseStoryboardOutputContract(input.storyboard_contract))!==JSON.stringify(contract))return fail();
    const groups=array(input.combined_context_plan??[],undefined,64);
    for(let index=0;index<groups.length;index++){
      const group=groups[index] as Record<string,unknown>;
      if(!group||typeof group!=="object"||group.context_key!==`context_group_${index+1}`)return fail();
      allowedGroups.add(group.context_key as string);
    }
  }
  // The provider schema omits slide-only fields. Retained internal plans use
  // explicit nulls; accept both representations without changing creative text.
  const row = fields(value, ["title", "summary", "content_markdown", "items"], ["presentation"]);
  if (Object.hasOwn(row, "presentation") && row.presentation !== null) return fail();
  const plan: DocumentArtifactDraft = { title: text(row.title, 512, true), summary: text(row.summary, 4_096),
    content_markdown: text(row.content_markdown, 65_536, true), presentation: null, items: array(row.items, 4).map(value=>frame(value,allowedGroups)) };
  const raw = JSON.stringify(plan);
  if (new TextEncoder().encode(raw).length > contract.maximumPlanBytes) return fail();
  const hasGroups=plan.items.some(item=>item.context_group_ids?.length);
  const plannerRequestDigest=hasGroups?await sha(plannerRequestBody!):null;
  const planSha256 = await sha(raw), bindingSha256 = await sha(JSON.stringify({ contract, plannerResponseId, planSha256,...(plannerRequestDigest?{plannerRequestDigest}:{}) }));
  const captured = freeze({ contract, plannerResponseId, plan, raw, planSha256, bindingSha256,...(hasGroups?{plannerRequestBody,plannerRequestDigest}:{}) });
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
