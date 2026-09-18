import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { captureGuestImageStage, currentGuestImageStage, type GuestImageStageContext } from "./experience-guest-image-confirmation.ts";
import { readApprovedGuestSponsorCampaign } from "./experience-guest-sponsor-approval.ts";
import { guestImageIssuerStageData, inspectGuestImageIssuerStage, recheckGuestImageIssuerStage,
  type GuestImageOutputInput, type GuestImageIssuerStageWitness } from "./experience-guest-image-stage-witness.ts";
import { guestFail } from "./experience-guest-session.ts";
import type { GuestImageAuthorizationV1 } from "./experience-guest-sponsor-contract.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (part: string): never => guestFail(`image_authorization_${part}`);
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const authorizationKeys = ["version", "purpose", "sessionDigest", "guestSourceDigest", "policyDigest", "termsDigest", "maximumMicrousd", "preflightId", "explicitAuthorization"];

/** One public-operation owner. Outstanding observations remain observed after
 * cancellation; a timeout never grants a continuation or retries a mutation. */
class Lifetime {
  readonly deadline: number;
  readonly ctx: GuestImageStageContext;
  constructor(ctx: GuestImageStageContext, ownerDeadline = performance.now() + 30_000) {
    this.ctx = ctx;
    if (!Number.isFinite(ownerDeadline)) fail("deadline");
    this.deadline = Math.min(performance.now() + 30_000, ownerDeadline);
  }
  check() {
    currentGuestImageStage(this.ctx);
    if (performance.now() >= this.deadline) fail("deadline");
  }
  async wait<T>(run: () => Promise<T>): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("guest_image_authorization_deadline")), Math.max(1, this.deadline - performance.now()));
      abort = () => reject(new Error("guest_image_authorization_cancelled"));
      this.ctx.request.signal.addEventListener("abort", abort, { once: true });
      if (this.ctx.request.signal.aborted) abort();
    });
    try { const result = await Promise.race([run(), stopped]); this.check(); return result; }
    finally { clearTimeout(timer); if (abort) this.ctx.request.signal.removeEventListener("abort", abort); }
  }
}

export type GuestImageIssueInput = GuestImageOutputInput & Readonly<{ authorization: GuestImageAuthorizationV1 }>;
export type GuestImageIssuerObservation = Readonly<{
  ctx: GuestImageStageContext; base: GuestImageOutputInput; witness: GuestImageIssuerStageWitness;
  life: Lifetime; authorization: GuestImageAuthorizationV1; authorizationDigest: string;
}>;
declare const guestImageAuthorization: unique symbol;
export type GuestImageAuthorization = Readonly<{ [guestImageAuthorization]: true }>;
const authorities = new WeakMap<GuestImageAuthorization, GuestImageIssuerObservation>();

function capture(request: Request, env: WorkerEnv, raw: unknown, explicit: boolean, ownerDeadline?: number) {
  if (jsonIssues(raw).length || !record(raw)
    || !exactKeys(raw, ["proof", "campaignId", "policyDigest", "draftHash", ...(explicit ? ["authorization"] : [])])
    || bytes(canonicalJson(raw)) > 32768) return fail("input_invalid");
  const copied = freeze(structuredClone(raw));
  if (explicit && (!record(copied.authorization) || !exactKeys(copied.authorization, authorizationKeys)
    || copied.authorization.explicitAuthorization !== true)) return fail("explicit_consent_required");
  const base = { proof: copied.proof, campaignId: copied.campaignId, policyDigest: copied.policyDigest, draftHash: copied.draftHash } as GuestImageOutputInput;
  const captured = captureGuestImageStage(request, env, base);
  return { ...captured, submitted: explicit ? copied.authorization as GuestImageAuthorizationV1 : null, life: new Lifetime(captured.ctx, ownerDeadline) };
}

/** Internal authentic source observation, never an authorization capability.
 * Neither a review nor a reconstructed historical tuple supplies consent. */
export async function observeGuestImageIssuer(request: Request, env: WorkerEnv, raw: GuestImageOutputInput,
  submitted?: GuestImageAuthorizationV1, ownerDeadline?: number): Promise<GuestImageIssuerObservation> {
  const captured = capture(request, env, submitted === undefined ? raw : { ...raw, authorization: submitted }, submitted !== undefined, ownerDeadline);
  const { ctx, base, life } = captured;
  const approved = await life.wait(() => readApprovedGuestSponsorCampaign(request, env, { campaignId: base.campaignId, policyDigest: base.policyDigest }));
  const witness = await life.wait(() => inspectGuestImageIssuerStage(request, env, base, approved, life.deadline));
  const observed = guestImageIssuerStageData(request, env, witness), { stage } = observed;
  if (stage.state !== "quoted" || !stage.quote || !stage.quoteEvent || !stage.confirmed) return fail("quote_required");
  const authorization: GuestImageAuthorizationV1 = freeze({ version: 1, purpose: "authorize-guest-sponsored-image",
    sessionDigest: stage.base.resourceInput.sessionDigest, guestSourceDigest: (await life.wait(() => digest(observed.sourceBinding))),
    policyDigest: base.policyDigest, termsDigest: stage.quote.termsDigest, maximumMicrousd: stage.quote.maximumMicrousd,
    preflightId: stage.quote.id, explicitAuthorization: true });
  if (captured.submitted && canonicalJson(captured.submitted) !== canonicalJson(authorization)) return fail("review_changed");
  const authorizationDigest = await life.wait(() => digest(authorization));
  await life.wait(() => recheckGuestImageIssuerStage(request, env, witness));
  guestImageIssuerStageData(request, env, witness); life.check();
  return Object.freeze({ ctx, base, witness, life, authorization, authorizationDigest });
}

function current(observation: GuestImageIssuerObservation) {
  observation.life.check();
  guestImageIssuerStageData(observation.ctx.request, observation.ctx.env, observation.witness);
}
async function review(request: Request, env: WorkerEnv, base: GuestImageOutputInput) {
  const observed = await observeGuestImageIssuer(request, env, base); current(observed);
  const { stage } = guestImageIssuerStageData(request, env, observed.witness);
  const { explicitAuthorization: ignored, ...authorization } = observed.authorization; void ignored;
  const result = freeze({ status: "review" as const, documentId: stage.base.plan.documentId,
    sourceRevision: stage.base.sourceHead + 3, authorization, reviewedAuthorizationDigest: observed.authorizationDigest });
  current(observed); return result;
}
/** Review only. The caller must deliberately supply explicit consent later. */
export function prepareGuestImageAuthorization(request: Request, env: WorkerEnv, base: GuestImageOutputInput) {
  return review(request, env, base);
}
async function authorize(request: Request, env: WorkerEnv, raw: GuestImageIssueInput): Promise<GuestImageAuthorization> {
  const captured = capture(request, env, raw, true);
  const observed = await observeGuestImageIssuer(request, env, captured.base, captured.submitted!, captured.life.deadline); current(observed);
  const authority = Object.freeze(Object.create(null)) as GuestImageAuthorization;
  authorities.set(authority, observed); current(observed); return authority;
}
/** No database mutation. Only this actual explicit-input path mints the seal. */
export function createGuestImageAuthorization(request: Request, env: WorkerEnv, input: GuestImageIssueInput) {
  return authorize(request, env, input);
}
/** Internal caller only; never put its source, proof or credential data on wire. */
export function guestImageAuthorizationData(request: Request, env: WorkerEnv, authority: GuestImageAuthorization) {
  const observed = authority && typeof authority === "object" ? authorities.get(authority) : undefined;
  if (!observed || observed.ctx.request !== request || observed.ctx.env !== env) return fail("capability_unavailable");
  current(observed); return observed;
}
