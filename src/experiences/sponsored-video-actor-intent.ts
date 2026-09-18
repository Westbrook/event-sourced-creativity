import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { readVideoExecutionOffer } from "../model/output-video-offer.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../model/video-adapter.ts";

/** Displayed metadata, not authentic campaign/payer approval, a private-read
 * grant or proof that a person saw the review. The real issuer must prove those
 * separate authorities before any sponsored admission or transfer. */
export type SponsoredVideoReview = Readonly<{
  version: "sponsor-video-review@1"; campaignId: string; approvalReceiptDigest: string; policyDigest: string; templateDigest: string;
  payerUserId: string; actorChargeMicrousd: 0; termsDigest: string; offer: Readonly<Record<string, unknown>>;
  transfer: Readonly<{ referenceCount: 1; maximumReferenceBytes: number; referenceMimeTypes: readonly string[] }>;
  expiresAt: string;
}>;
/** Capture the supplied ordinary authorization and one exact review reference.
 * No field chooses financial authority, broadens data access, or starts Run. */
export type SponsoredVideoActorRequest = Readonly<{
  draftHash: string; termsDigest: string; maximumMicrousd: number; explicitAuthorization: true;
  sponsorReview: Readonly<{ campaignId: string; reviewDigest: string }>;
}>;
export type SponsoredVideoNativeReviewFacts = Readonly<{
  draftHash: string; termsDigest: string; offer: Readonly<Record<string, unknown>>; expiresAt: string;
}>;
export type SponsoredVideoActorIntent = Readonly<{
  review: SponsoredVideoReview; reviewDigest: string; request: SponsoredVideoActorRequest; requestDigest: string;
}>;
export class SponsoredVideoActorIntentError extends Error {
  readonly code = "sponsored_video_actor_intent_invalid";
  constructor() { super("sponsored_video_actor_intent_invalid"); this.name = "SponsoredVideoActorIntentError"; }
}
const fail = (): never => { throw new SponsoredVideoActorIntentError(); };
const keys = (raw: unknown, expected: readonly string[]): raw is Record<string, unknown> => record(raw) && exactKeys(raw, expected);
const hash = (raw: unknown): raw is string => typeof raw === "string" && /^sha256:[a-f0-9]{64}$/u.test(raw);
const nativeDigest = (raw: unknown): raw is string => typeof raw === "string" && /^[a-f0-9]{64}$/u.test(raw);
const campaignId = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(raw);
const userId = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(raw);
const iso = (raw: unknown): raw is string => typeof raw === "string" && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString() === raw;
function capture<T>(raw: unknown): T {
  // jsonIssues inspects own descriptors without invoking accessors or toJSON.
  // Its depth/node/string limits precede this aggregate byte limit and clone.
  if (jsonIssues(raw).length) return fail();
  const encoded = canonicalJson(raw);
  if (new TextEncoder().encode(encoded).length > 32768) return fail();
  return freeze(JSON.parse(encoded) as T);
}

/** Clock-independent structural capture keeps historical terms inspectable.
 * The full closed native offer binds source, original ID/deadline, two calls,
 * prices and the existing one-owned-still transfer; it grants none of them. */
export function readSponsoredVideoReview(raw: unknown): SponsoredVideoReview {
  const value = capture<unknown>(raw);
  if (!keys(value, ["version", "campaignId", "approvalReceiptDigest", "policyDigest", "templateDigest", "payerUserId", "actorChargeMicrousd", "termsDigest", "offer", "transfer", "expiresAt"])
    || value.version !== "sponsor-video-review@1" || !campaignId(value.campaignId)
    || ![value.approvalReceiptDigest, value.policyDigest, value.templateDigest].every(hash)
    || !userId(value.payerUserId) || value.actorChargeMicrousd !== 0 || !nativeDigest(value.termsDigest) || !iso(value.expiresAt)
    || !keys(value.transfer, ["referenceCount", "maximumReferenceBytes", "referenceMimeTypes"])
    || value.transfer.referenceCount !== 1 || value.transfer.maximumReferenceBytes !== VIDEO_ADAPTER_CONTRACT.maxReferenceBytes
    || canonicalJson(value.transfer.referenceMimeTypes) !== canonicalJson(VIDEO_ADAPTER_CONTRACT.supportedReferenceMimeTypes)) return fail();
  const video = readVideoExecutionOffer(value.offer);
  if (!video || value.payerUserId === video.original.actorUserId || Date.parse(value.expiresAt) > Date.parse(String(video.original.expiresAt))) return fail();
  return value as unknown as SponsoredVideoReview;
}

export function readSponsoredVideoActorRequest(raw: unknown): SponsoredVideoActorRequest {
  const value = capture<unknown>(raw);
  if (!keys(value, ["draftHash", "termsDigest", "maximumMicrousd", "explicitAuthorization", "sponsorReview"])
    || !hash(value.draftHash) || !nativeDigest(value.termsDigest) || value.explicitAuthorization !== true
    || !Number.isSafeInteger(value.maximumMicrousd) || Number(value.maximumMicrousd) <= 0
    || !keys(value.sponsorReview, ["campaignId", "reviewDigest"]) || !campaignId(value.sponsorReview.campaignId) || !hash(value.sponsorReview.reviewDigest)) return fail();
  return value as unknown as SponsoredVideoActorRequest;
}

export function digestSponsoredVideoReview(raw: unknown): Promise<string> {
  return digest(readSponsoredVideoReview(raw));
}

function readNativeFacts(raw: unknown): SponsoredVideoNativeReviewFacts {
  const value = capture<unknown>(raw);
  if (!keys(value, ["draftHash", "termsDigest", "offer", "expiresAt"])
    || !hash(value.draftHash) || !nativeDigest(value.termsDigest) || !iso(value.expiresAt)) return fail();
  const video = readVideoExecutionOffer(value.offer);
  if (!video || video.contract.source.draftHash !== value.draftHash) return fail();
  return value as unknown as SponsoredVideoNativeReviewFacts;
}
type Captured = { review: SponsoredVideoReview; request: SponsoredVideoActorRequest; native: SponsoredVideoNativeReviewFacts };
function captureMatch(rawReview: unknown, rawRequest: unknown, rawNative: unknown): Captured | null {
  try { return { review: readSponsoredVideoReview(rawReview), request: readSponsoredVideoActorRequest(rawRequest), native: readNativeFacts(rawNative) }; }
  catch (error) { if (error instanceof SponsoredVideoActorIntentError) return null; throw error; }
}
function matches({ review, request, native }: Captured, now: number): boolean {
  return request.draftHash === native.draftHash && request.termsDigest === native.termsDigest && review.termsDigest === native.termsDigest
    && request.maximumMicrousd === native.offer.maximumMicrousd && canonicalJson(review.offer) === canonicalJson(native.offer)
    && request.sponsorReview.campaignId === review.campaignId && Date.parse(review.expiresAt) <= Date.parse(native.expiresAt)
    && Number.isFinite(now) && now < Math.min(Date.parse(review.expiresAt), Date.parse(native.expiresAt));
}

/** Synchronous facts comparison after the server's final native proof read.
 * The caller separately checks the captured review digest. Caller-shaped facts
 * do not prove request provenance, payer authority, or a current DB snapshot. */
export function sponsoredVideoActorIntentMatchesNative(rawReview: unknown, rawRequest: unknown, rawNative: unknown, now = Date.now()): boolean {
  const captured = captureMatch(rawReview, rawRequest, rawNative);
  return captured !== null && matches(captured, now);
}

export async function matchSponsoredVideoActorIntent(rawReview: unknown, rawRequest: unknown, rawNative: unknown): Promise<SponsoredVideoActorIntent | null> {
  const captured = captureMatch(rawReview, rawRequest, rawNative);
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
