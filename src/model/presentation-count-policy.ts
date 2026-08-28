import type { OutputCountPolicy } from "./output-requirements.ts";

/** A confirmed policy is not the provider's suggested count for one attempt. */
export type SlideCountPolicy = OutputCountPolicy & { unit: "slide" };

export const MAX_MANUAL_PRESENTATION_SLIDES = 15;

export class PresentationCountPolicyError extends RangeError {
  readonly code: "presentation_slide_count_invalid" | "presentation_slide_count_conflict" | "presentation_count_policy_unsupported";
  constructor(code: PresentationCountPolicyError["code"], message: string) {
    super(message); this.name = "PresentationCountPolicyError"; this.code = code;
  }
}

const positiveInteger = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;

export function readSlideCountPolicy(value: unknown, maximum = 100): SlideCountPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PresentationCountPolicyError("presentation_slide_count_invalid", "A slide count policy must be an exact count or a bounded flexible range.");
  const policy = value as Record<string, unknown>;
  if (policy.unit !== "slide") throw new PresentationCountPolicyError("presentation_slide_count_invalid", "A presentation count policy must use the slide unit.");
  if (policy.kind === "exact" && positiveInteger(policy.value, maximum)
    && Object.keys(policy).every((key) => ["kind", "unit", "value"].includes(key))) return { kind: "exact", unit: "slide", value: policy.value };
  if (policy.kind === "flexible" && positiveInteger(policy.min, maximum) && positiveInteger(policy.max, maximum)
    && policy.min <= policy.max && (policy.aim === undefined || positiveInteger(policy.aim, maximum) && policy.aim >= policy.min && policy.aim <= policy.max)
    && Object.keys(policy).every((key) => ["kind", "unit", "min", "max", "aim"].includes(key))) return {
      kind: "flexible", unit: "slide", min: policy.min, max: policy.max, ...(policy.aim === undefined ? {} : { aim: policy.aim as number }),
    };
  throw new PresentationCountPolicyError("presentation_slide_count_invalid", `Slide counts must be whole numbers from 1 to ${maximum}, with the aim inside the accepted range.`);
}

export function slideCountBounds(policy: SlideCountPolicy) {
  return policy.kind === "exact" ? { minimum: policy.value, maximum: policy.value } : { minimum: policy.min, maximum: policy.max };
}

export function slideCountAccepted(actual: number, policy: SlideCountPolicy | undefined, exactFallback?: number | null): boolean {
  if (!Number.isSafeInteger(actual) || actual < 1) return false;
  if (policy) { const bounds = slideCountBounds(policy); return actual >= bounds.minimum && actual <= bounds.maximum; }
  return exactFallback == null || actual === exactFallback;
}

/** Retained candidates must have the policy admitted before their paid request. */
export function sameSlideCountPolicy(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  try { return JSON.stringify(readSlideCountPolicy(left)) === JSON.stringify(readSlideCountPolicy(right)); }
  catch { return false; }
}

export type PresentationCountRequest = {
  [key: string]: unknown;
  slideCountPolicy?: unknown;
  itemCount?: unknown;
  requestedSlideCount?: unknown;
  productionMode?: unknown;
};

/** Reject conflicting commitments before dispatch; never coerce strings or clamp an authored range. */
export function resolvePresentationCountRequest(input: PresentationCountRequest, sourceMinimum = 0) {
  const maximum = input.productionMode === "managed" ? 100 : MAX_MANUAL_PRESENTATION_SLIDES;
  for (const value of [input.itemCount, input.requestedSlideCount]) if (value !== undefined && !positiveInteger(value, maximum)) {
    throw new PresentationCountPolicyError("presentation_slide_count_invalid", `This presentation route supports whole counts from 1 to ${maximum}.`);
  }
  if (input.slideCountPolicy === undefined) {
    if (input.itemCount !== undefined && input.requestedSlideCount !== undefined && input.itemCount !== input.requestedSlideCount) throw new PresentationCountPolicyError("presentation_slide_count_conflict", "The exact requested slide count must match the presentation item count.");
    const requested = input.requestedSlideCount as number | undefined;
    const itemCount = (input.itemCount ?? requested ?? 7) as number;
    if ((input.itemCount !== undefined || requested !== undefined) && itemCount < sourceMinimum) throw new PresentationCountPolicyError("presentation_slide_count_conflict", "The exact requested count would omit required source-authored slides.");
    return { itemCount, requestedSlideCount: requested, slideCountPolicy: undefined };
  }
  const policy = readSlideCountPolicy(input.slideCountPolicy, maximum);
  if (input.productionMode === "managed" && policy.kind === "flexible") throw new PresentationCountPolicyError("presentation_count_policy_unsupported", "Flexible slide counts use the manual presentation route. Managed chapter plans require an exact count before authorization.");
  if (policy.kind === "flexible" && input.requestedSlideCount !== undefined) throw new PresentationCountPolicyError("presentation_slide_count_conflict", "An exact requestedSlideCount cannot replace an accepted flexible count policy. Keep the attempt's suggested count in itemCount.");
  const bounds = slideCountBounds(policy);
  if (sourceMinimum > bounds.maximum) throw new PresentationCountPolicyError("presentation_slide_count_conflict", "The accepted count policy cannot contain every required source-authored slide.");
  if (policy.kind === "exact" && (input.requestedSlideCount !== undefined && input.requestedSlideCount !== policy.value || input.itemCount !== undefined && input.itemCount !== policy.value)) throw new PresentationCountPolicyError("presentation_slide_count_conflict", "The request conflicts with its accepted exact slide count policy.");
  if (input.itemCount !== undefined && !slideCountAccepted(input.itemCount as number, policy)) throw new PresentationCountPolicyError("presentation_slide_count_conflict", "The suggested attempt count must remain inside its accepted count policy.");
  const itemCount = policy.kind === "exact" ? policy.value : Math.max(sourceMinimum, (input.itemCount ?? policy.aim ?? policy.min) as number);
  return { itemCount, requestedSlideCount: policy.kind === "exact" ? policy.value : undefined, slideCountPolicy: policy };
}

export function presentationCountInstruction(policy: SlideCountPolicy | undefined, itemCount: number): string {
  if (policy?.kind === "flexible") return `Return between ${policy.min} and ${policy.max} complete ordered slides. Aim for ${itemCount} slides, but that aim is not an exact count. Preserve all required coverage and authored positions within the accepted range.`;
  return `Return exactly ${itemCount} ordered item${itemCount === 1 ? "" : "s"}.`;
}

/** Reserve and disclose for the largest allowed response, not just the suggested count. */
export function manualPresentationMaximumOutputTokens(policy: SlideCountPolicy | undefined, itemCount: number): number {
  const count = policy ? slideCountBounds(policy).maximum : itemCount;
  return Math.max(6500, Math.min(13500, count * 900));
}
