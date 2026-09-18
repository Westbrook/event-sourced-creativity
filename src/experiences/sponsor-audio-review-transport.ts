import { canonicalJson, digest, exactKeys, freeze, record } from "./compiler.ts";
import { parseAudioMiniAppCostPreview } from "../model/audio-mini-app-consent.ts";
import { readSponsoredAudioActorRequest, readSponsoredAudioReview, digestSponsoredAudioReview,
  sponsoredAudioActorIntentMatchesNative, type SponsoredAudioActorRequest, type SponsoredAudioNativeReviewFacts,
  type SponsoredAudioReview } from "./sponsored-audio-actor-intent.ts";

export type SponsorAudioReviewIdentity = Readonly<{
  version: 1; campaignId: string; actorUserId: string; draftId: string; draftHash: string;
  projectId: string; documentId: string; sourceDigest: string; requirementsDigest: string;
}>;
/** Proposed display wire data only: neither native source proof nor payer authority. */
export type SponsorAudioReviewResponse = Readonly<{
  version: 1; kind: "sponsor-audio-review"; binding: SponsorAudioReviewIdentity;
  review: SponsoredAudioReview; reviewDigest: string; native: SponsoredAudioNativeReviewFacts;
}>;
export type SponsorAudioAuthorizeMessage = Readonly<{
  path: string; body: string; request: SponsoredAudioActorRequest; requestDigest: string;
}>;
/** A future server's acknowledgement metadata. Parsing does not prove a grant,
 * receipt, execution, user gesture or payment exists. No pre-approval receipt. */
export type SponsorAudioAuthorizationResponse = Readonly<{
  version: 1; kind: "sponsor-audio-authorization"; binding: SponsorAudioReviewIdentity;
  reviewDigest: string; actorRequestDigest: string; grantId: string; jobId: string;
  receipt: Readonly<{ key: string; eventId: string; requestDigest: string }>; replayed: boolean;
}>;
export class SponsorAudioReviewTransportError extends Error {
  readonly code = "sponsor_audio_review_transport_invalid";
  constructor() { super("sponsor_audio_review_transport_invalid"); this.name = "SponsorAudioReviewTransportError"; }
}
const fail = (): never => { throw new SponsorAudioReviewTransportError(); };
const closed = (raw: unknown, keys: readonly string[]): raw is Record<string, unknown> => record(raw) && exactKeys(raw, keys);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const nativeHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const nativeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identityKeys = ["version", "campaignId", "actorUserId", "draftId", "draftHash", "projectId", "documentId", "sourceDigest", "requirementsDigest"];
const reviewKeys = ["version", "kind", "binding", "review", "reviewDigest", "native"];

/** Capture bounded own data without invoking accessors or serialization hooks.
 * These closed wire shapes contain no arrays; no caller object survives an await. */
function capture(raw: unknown): unknown {
  let nodes = 0, characters = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 512 || depth > 8) return fail();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : fail();
    if (typeof value === "string") {
      characters += value.length;
      return value.length <= 8192 && characters <= 32768 ? value : fail();
    }
    if (!record(value) || seen.has(value)) return fail();
    seen.add(value);
    const copied: Record<string, unknown> = Object.create(null), descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) return fail();
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail();
      copied[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
    return copied;
  };
  return freeze(visit(raw, 0));
}
function identity(raw: unknown): SponsorAudioReviewIdentity {
  if (!closed(raw, identityKeys) || raw.version !== 1 || !id(raw.campaignId)
    || ![raw.actorUserId, raw.projectId, raw.documentId].every(nativeId)
    || typeof raw.draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(raw.draftId)
    || !hash(raw.draftHash) || !nativeHash(raw.sourceDigest) || !nativeHash(raw.requirementsDigest)) return fail();
  return raw as SponsorAudioReviewIdentity;
}
export function captureSponsorAudioReviewIdentity(raw: unknown): SponsorAudioReviewIdentity {
  return identity(capture(raw));
}
/** Proposed dormant GET path. This helper does not install or call a route. */
export function sponsorAudioReviewPath(raw: unknown): string {
  return `/api/experiences/sponsor/audio/drafts/${captureSponsorAudioReviewIdentity(raw).draftId}/review`;
}
function reviewResponse(raw: unknown, expected?: SponsorAudioReviewIdentity): SponsorAudioReviewResponse {
  if (!closed(raw, reviewKeys) || raw.version !== 1 || raw.kind !== "sponsor-audio-review" || !hash(raw.reviewDigest)) return fail();
  const binding = identity(raw.binding);
  if (expected && canonicalJson(binding) !== canonicalJson(expected)) return fail();
  const review = readSponsoredAudioReview(raw.review), native = raw.native;
  if (!closed(native, ["draftHash", "termsDigest", "preview", "expiresAt"]) || native.draftHash !== binding.draftHash
    || native.termsDigest !== review.termsDigest || !instant(native.expiresAt) || !parseAudioMiniAppCostPreview(native.preview)
    || canonicalJson(native.preview) !== canonicalJson(review.preview) || review.campaignId !== binding.campaignId
    || Date.parse(review.expiresAt) > Date.parse(native.expiresAt)) return fail();
  const preview = review.preview;
  for (const key of ["actorUserId", "draftId", "projectId", "documentId", "sourceDigest", "requirementsDigest"] as const)
    if (preview[key] !== binding[key]) return fail();
  const result = freeze({ version: 1 as const, kind: "sponsor-audio-review" as const, binding, review,
    reviewDigest: raw.reviewDigest, native: native as SponsoredAudioNativeReviewFacts });
  current(result);
  return result;
}
function current(shown: SponsorAudioReviewResponse) {
  const now = Date.now();
  if (!Number.isFinite(now) || now >= Math.min(Date.parse(shown.review.expiresAt), Date.parse(shown.review.preview.expiresAt), Date.parse(shown.native.expiresAt))) return fail();
}
async function verifyReview(shown: SponsorAudioReviewResponse) {
  current(shown);
  const reviewedDigest = await digestSponsoredAudioReview(shown.review);
  current(shown);
  if (reviewedDigest !== shown.reviewDigest) return fail();
}
export async function readSponsorAudioReviewResponse(raw: unknown, rawIdentity: unknown): Promise<SponsorAudioReviewResponse> {
  const expected = captureSponsorAudioReviewIdentity(rawIdentity), captured = capture(raw);
  const shown = reviewResponse(captured, expected);
  await verifyReview(shown);
  current(shown);
  return shown;
}
function requestMatches(shown: SponsorAudioReviewResponse, request: SponsoredAudioActorRequest) {
  current(shown);
  if (request.sponsorReview.reviewDigest !== shown.reviewDigest
    || !sponsoredAudioActorIntentMatchesNative(shown.review, request, shown.native)) return fail();
}
async function authorizeMessage(shown: SponsorAudioReviewResponse, request: SponsoredAudioActorRequest): Promise<SponsorAudioAuthorizeMessage> {
  requestMatches(shown, request);
  await verifyReview(shown);
  requestMatches(shown, request);
  const body = canonicalJson(request);
  if (new TextEncoder().encode(body).byteLength > 4096) return fail();
  const requestDigest = await digest(request);
  requestMatches(shown, request);
  return freeze({ path: `/api/experiences/drafts/${shown.binding.draftId}/output/authorize`, body, request, requestDigest });
}
/** Preserve the separately supplied actual approval. No true flags, consent,
 * native command, Request provenance or Run are constructed from the preview. */
export async function prepareSponsorAudioAuthorize(rawShown: unknown, rawActualActorRequest: unknown): Promise<SponsorAudioAuthorizeMessage> {
  const capturedShown = capture(rawShown), capturedRequest = capture(rawActualActorRequest);
  const shown = reviewResponse(capturedShown), request = readSponsoredAudioActorRequest(capturedRequest);
  const message = await authorizeMessage(shown, request);
  requestMatches(shown, request);
  return message;
}
export async function readSponsorAudioAuthorizationResponse(raw: unknown, rawShown: unknown, rawMessage: unknown): Promise<SponsorAudioAuthorizationResponse> {
  const captured = capture(raw), capturedShown = capture(rawShown), message = capture(rawMessage);
  const shown = reviewResponse(capturedShown);
  if (!closed(message, ["path", "body", "request", "requestDigest"])) return fail();
  const request = readSponsoredAudioActorRequest(message.request);
  const expected = await authorizeMessage(shown, request);
  if (canonicalJson(message) !== canonicalJson(expected)) return fail();
  if (!closed(captured, ["version", "kind", "binding", "reviewDigest", "actorRequestDigest", "grantId", "jobId", "receipt", "replayed"])
    || captured.version !== 1 || captured.kind !== "sponsor-audio-authorization"
    || canonicalJson(identity(captured.binding)) !== canonicalJson(shown.binding) || captured.reviewDigest !== shown.reviewDigest
    || captured.actorRequestDigest !== expected.requestDigest || !id(captured.grantId) || captured.jobId !== shown.review.preview.requestId
    || typeof captured.replayed !== "boolean" || !closed(captured.receipt, ["key", "eventId", "requestDigest"])
    || !id(captured.receipt.key) || !uuid(captured.receipt.eventId) || !nativeHash(captured.receipt.requestDigest)) return fail();
  current(shown);
  return captured as SponsorAudioAuthorizationResponse;
}
