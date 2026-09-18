import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { audioMiniAppCostApprovalMatches, parseAudioMiniAppCostPreview, type AudioMiniAppCostPreview } from "../model/audio-mini-app-consent.ts";
import type { ExperienceAudioCostApproval } from "./output-binding-contract.ts";

/** Displayed review metadata only. Parsing does not verify payer approval,
 * campaign availability, a complete sponsor deadline, or provider permission. */
export type SponsoredAudioReview = Readonly<{
  version: "sponsor-audio-review@1"; campaignId: string; approvalReceiptDigest: string; policyDigest: string; templateDigest: string;
  payerUserId: string; actorChargeMicrousd: 0; termsDigest: string; preview: AudioMiniAppCostPreview; expiresAt: string;
}>;
/** The existing deliberate Audio Authorize body plus one reviewed snapshot
 * reference. No field selects a payer, adds transfer permission or starts Run. */
export type SponsoredAudioActorRequest = Readonly<{
  draftHash: string; termsDigest: string; maximumMicrousd: number; explicitAuthorization: true;
  audioCostConsent: ExperienceAudioCostApproval;
  sponsorReview: Readonly<{ campaignId: string; reviewDigest: string }>;
}>;
export type SponsoredAudioNativeReviewFacts = Readonly<{
  draftHash: string; termsDigest: string; preview: AudioMiniAppCostPreview; expiresAt: string;
}>;
export type SponsoredAudioActorIntent = Readonly<{
  review: SponsoredAudioReview; reviewDigest: string; request: SponsoredAudioActorRequest; requestDigest: string;
}>;
export class SponsoredAudioActorIntentError extends Error {
  readonly code = "sponsored_audio_actor_intent_invalid";
  constructor() { super("sponsored_audio_actor_intent_invalid"); this.name = "SponsoredAudioActorIntentError"; }
}
const fail = (): never => { throw new SponsoredAudioActorIntentError(); };
const keys = (raw: unknown, expected: readonly string[]): raw is Record<string, unknown> => record(raw) && exactKeys(raw, expected);
const hash = (raw: unknown): raw is string => typeof raw === "string" && /^sha256:[a-f0-9]{64}$/u.test(raw);
const nativeDigest = (raw: unknown): raw is string => typeof raw === "string" && /^[a-f0-9]{64}$/u.test(raw);
const campaignId = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(raw);
const userId = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(raw);
const iso = (raw: unknown): raw is string => typeof raw === "string" && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString() === raw;
const clone = <T>(raw: unknown): T => freeze(JSON.parse(canonicalJson(raw)) as T);

/** Structural capture is clock-independent so historical review remains
 * inspectable. A parsed review has no enrollment or spending authority. */
export function readSponsoredAudioReview(raw: unknown): SponsoredAudioReview {
  if (jsonIssues(raw).length || !keys(raw, ["version", "campaignId", "approvalReceiptDigest", "policyDigest", "templateDigest", "payerUserId", "actorChargeMicrousd", "termsDigest", "preview", "expiresAt"])
    || raw.version !== "sponsor-audio-review@1" || !campaignId(raw.campaignId)
    || ![raw.approvalReceiptDigest, raw.policyDigest, raw.templateDigest].every(hash)
    || !userId(raw.payerUserId) || raw.actorChargeMicrousd !== 0 || !nativeDigest(raw.termsDigest) || !iso(raw.expiresAt)) return fail();
  const preview = parseAudioMiniAppCostPreview(raw.preview);
  if (!preview || raw.payerUserId === preview.actorUserId || Date.parse(raw.expiresAt) > Date.parse(preview.expiresAt)) return fail();
  return clone<SponsoredAudioReview>(raw);
}

/** Capture the supplied booleans and consent exactly. This does not attest a
 * physical gesture or manufacture approval from a server cost preview. */
export function readSponsoredAudioActorRequest(raw: unknown): SponsoredAudioActorRequest {
  if (jsonIssues(raw).length || !keys(raw, ["draftHash", "termsDigest", "maximumMicrousd", "explicitAuthorization", "audioCostConsent", "sponsorReview"])
    || !hash(raw.draftHash) || !nativeDigest(raw.termsDigest) || raw.explicitAuthorization !== true
    || !Number.isSafeInteger(raw.maximumMicrousd) || Number(raw.maximumMicrousd) <= 0 || Number(raw.maximumMicrousd) > 2_000_000
    || !record(raw.audioCostConsent) || raw.audioCostConsent.confirmed !== true || raw.audioCostConsent.providerTransferConfirmed !== true
    || !keys(raw.sponsorReview, ["campaignId", "reviewDigest"]) || !campaignId(raw.sponsorReview.campaignId) || !hash(raw.sponsorReview.reviewDigest)) return fail();
  // Only remove the two actual supplied flags to reuse the ordinary closed
  // preview parser. Return an owned copy of the request, not constructed flags.
  const { confirmed, providerTransferConfirmed, ...previewValue } = raw.audioCostConsent;
  void confirmed; void providerTransferConfirmed;
  const preview = parseAudioMiniAppCostPreview(previewValue);
  if (!preview || preview.maximumMicrousd !== raw.maximumMicrousd) return fail();
  return clone<SponsoredAudioActorRequest>(raw);
}

export async function digestSponsoredAudioReview(raw: unknown): Promise<string> {
  const review = readSponsoredAudioReview(raw);
  return digest(review);
}

function readNativeFacts(raw: unknown): SponsoredAudioNativeReviewFacts {
  if (jsonIssues(raw).length || !keys(raw, ["draftHash", "termsDigest", "preview", "expiresAt"])
    || !hash(raw.draftHash) || !nativeDigest(raw.termsDigest) || !iso(raw.expiresAt) || !parseAudioMiniAppCostPreview(raw.preview)) return fail();
  return clone<SponsoredAudioNativeReviewFacts>(raw);
}

type Captured = { review: SponsoredAudioReview; request: SponsoredAudioActorRequest; native: SponsoredAudioNativeReviewFacts };
function capture(rawReview: unknown, rawRequest: unknown, rawNative: unknown): Captured | null {
  try { return { review: readSponsoredAudioReview(rawReview), request: readSponsoredAudioActorRequest(rawRequest), native: readNativeFacts(rawNative) }; }
  catch (error) {
    if (error instanceof SponsoredAudioActorIntentError) return null;
    throw error;
  }
}
function matches({ review, request, native }: Captured, now: number): boolean {
  return request.draftHash === native.draftHash && request.termsDigest === native.termsDigest && review.termsDigest === native.termsDigest
    && request.maximumMicrousd === native.preview.maximumMicrousd && canonicalJson(review.preview) === canonicalJson(native.preview)
    && request.sponsorReview.campaignId === review.campaignId && Date.parse(review.expiresAt) <= Date.parse(native.expiresAt)
    && Number.isFinite(now) && now < Math.min(Date.parse(review.expiresAt), Date.parse(native.expiresAt), Date.parse(native.preview.expiresAt))
    && audioMiniAppCostApprovalMatches(request.audioCostConsent, native.preview, now);
}

/** Synchronous final native-facts comparison, for after the reader's last
 * proof read. The caller must separately compare sponsorReview.reviewDigest
 * with its already computed digest of the exact captured review. This helper
 * cannot recompute or attest that digest, payer approval, or HTTP provenance. */
export function sponsoredAudioActorIntentMatchesNative(rawReview: unknown, rawRequest: unknown, rawNative: unknown, now = Date.now()): boolean {
  const captured = capture(rawReview, rawRequest, rawNative);
  return captured !== null && matches(captured, now);
}

/** Pure matching of already obtained native facts. A caller-shaped facts DTO,
 * review or matching digest is not authenticated evidence. The server reader
 * must obtain the real current quote/source and later V8 integration must prove
 * payer approval, finite resource permission and the complete sponsor deadline. */
export async function matchSponsoredAudioActorIntent(rawReview: unknown, rawRequest: unknown, rawNative: unknown): Promise<SponsoredAudioActorIntent | null> {
  // Every input is captured and deeply frozen before the first owned await.
  const captured = capture(rawReview, rawRequest, rawNative);
  if (!captured) return null;
  const { review, request } = captured;
  const current = () => matches(captured, Date.now());
  if (!current()) return null;
  const reviewDigest = await digest(review);
  if (!current() || request.sponsorReview.reviewDigest !== reviewDigest) return null;
  const requestDigest = await digest(request);
  if (!current()) return null;
  return freeze({ review, reviewDigest, request, requestDigest });
}
