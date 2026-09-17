import { digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceResourceId } from "../src/experiences/intake.ts";
import { experienceImageFormat } from "../src/experiences/image-ratio.ts";
import { guestContextInventoryData, inspectGuestContextInventory } from "./experience-guest-context-inventory.ts";
import { GUEST_DB_NOW, guestFail, guestHash, type GuestClaimProof } from "./experience-guest-session.ts";
import { compileGuestSponsorSessionBinding, compileGuestSponsorSourceBinding, deriveGuestSponsorDriver,
  readGuestSponsorPolicy } from "./experience-guest-sponsor-contract.ts";
import { createExperienceOutputRecipe } from "./experience-output-recipe.ts";
import type { WorkerEnv } from "./runtime.ts";

declare const preparationBrand: unique symbol;
/** Request-local source evidence only. It is never payer approval, a native
 * command capability, a sponsor grant, or provider-transfer authorization. */
export type GuestImagePreparation = Readonly<{ [preparationBrand]: true }>;
export type GuestImageProducerInput = Readonly<{ proof: GuestClaimProof; policy: unknown; draftHash: string }>;
type Proof = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
type SourceMetadata = { policy_id: string; policy_digest: string; request_digest: string };
type PreparationData = Readonly<{ request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; origin: string; proof: Proof }>;
const preparations = new WeakMap<GuestImagePreparation, PreparationData>();
const unavailable = (): never => guestFail("image_preparation_unavailable");

function requestBoundary(request: Request, expectedOrigin: string) {
  if (!(request instanceof Request) || request.signal.aborted) return unavailable();
  const url = new URL(request.url), site = request.headers.get("sec-fetch-site");
  if (request.method !== "POST" || url.protocol !== "https:" || url.origin !== expectedOrigin || url.search || url.hash
    || request.headers.get("origin") !== expectedOrigin || site !== null && site !== "same-origin" && site !== "none") return unavailable();
}
function current(request: Request, env: WorkerEnv, db: WorkerEnv["DB"], origin: string) {
  if (env.DB !== db) return guestFail("database_changed");
  requestBoundary(request, origin);
}
async function prove(request: Request, env: WorkerEnv, db: WorkerEnv["DB"], origin: string, proof: Proof) {
  current(request, env, db, origin);
  let row;
  try { row = await db.prepare(proof.sql).bind(...proof.bindings).first<{ current: number }>(); }
  catch { current(request, env, db, origin); return unavailable(); }
  current(request, env, db, origin);
  if (row?.current !== 1) return unavailable();
}

/** Dormant, read-only producer prerequisite. Candidate terms are supplied by a
 * future reviewed server caller, not loaded as an approved campaign here. Both
 * guest proof purposes and the full empty-output native inventory are required.
 * The final await repeats every source predicate; no helper result is a cached
 * authorization. No schema, account, output, grant, hold or provider is created. */
export async function prepareGuestImageProducer(request: Request, env: WorkerEnv, input: GuestImageProducerInput) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof", "policy", "draftHash"]) || !guestHash(input.draftHash)) return unavailable();
  const copied = structuredClone(input), policy = readGuestSponsorPolicy(copied.policy), db = env.DB;
  const admission = policy.guestAdmission;
  current(request, env, db, admission.origin);
  const inventory = await inspectGuestContextInventory(request, env, { proof: copied.proof });
  current(request, env, db, admission.origin);
  const native = guestContextInventoryData(env, inventory), { plan, session, manifest } = native;
  if (copied.draftHash !== inventory.draftHash || session.row.policy_id !== admission.sessionPolicyId
    || session.row.terms_digest !== admission.sessionTermsDigest || session.policy.terms.origin !== admission.origin
    || plan.release.releaseHash !== admission.releaseHash || session.row.guest_subject === policy.payerUserId) return unavailable();
  const source = await db.prepare("SELECT policy_id,policy_digest,request_digest FROM experience_guest_sources WHERE session_id=?")
    .bind(session.row.session_id).first<SourceMetadata>();
  current(request, env, db, admission.origin);
  if (!source || source.policy_id !== admission.sourcePolicyId || source.policy_digest !== admission.sourcePolicyDigest || !guestHash(source.request_digest)) return unavailable();
  const ratio = plan.request.values.ratio, format = ratio?.provenance === "authored" ? experienceImageFormat(ratio.value) : null;
  const template = policy.templates[0];
  if (!format || template.width !== format.dimensions.width || template.height !== format.dimensions.height
    || template.recipeVersion !== `image@${plan.release.definition.revision}`) return unavailable();
  const clock = await db.prepare(`SELECT ${GUEST_DB_NOW} AS now`).first<{ now: number }>();
  current(request, env, db, admission.origin);
  if (!clock || !Number.isSafeInteger(clock.now) || clock.now < 0) return unavailable();
  const expiresAtMs = Math.min(clock.now + policy.maximumGrantLifetimeMs, policy.expiresAtMs, policy.resources.expiresAtMs,
    session.row.expires_at_ms, session.policy.terms.expiresAtMs, Date.parse(manifest.expiresAt));
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= clock.now) return unavailable();
  const sessionBinding = await compileGuestSponsorSessionBinding({ domain: "forma-sponsor-guest-session@1",
    sessionId: session.row.session_id, guestSubject: session.row.guest_subject, projectId: plan.projectId, documentId: plan.documentId,
    sessionPolicyId: session.row.policy_id, sessionTermsDigest: session.row.terms_digest, expiresAtMs: session.row.expires_at_ms });
  const sourceBinding = await compileGuestSponsorSourceBinding({ domain: "forma-sponsor-guest-source@1", sessionDigest: sessionBinding.sessionDigest,
    sourcePolicyId: source.policy_id, sourcePolicyDigest: source.policy_digest, draftId: plan.draftId, draftHash: plan.draftHash,
    requestDigest: source.request_digest, contentDigest: manifest.contentDigest, releaseHash: plan.release.releaseHash,
    sourceHead: manifest.sourceHead, sourceEventIds: [...manifest.sourceEventIds], expiresAtMs: Date.parse(manifest.expiresAt) });
  const driver = await deriveGuestSponsorDriver({ version: 1, action: "run-guest-sponsored-image", campaignId: policy.campaignId,
    sessionId: session.row.session_id, documentId: plan.documentId, draftId: plan.draftId, draftHash: plan.draftHash,
    guestSourceDigest: sourceBinding.guestSourceDigest });
  // The actual original authored ratio and IDs feed the existing native recipe.
  // Its unconfirmed requirement does not alter the persisted source digest/head.
  const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement");
  const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable");
  const variantId = await experienceResourceId(plan.draftId, "native-output-variant");
  const recipe = createExperienceOutputRecipe({ output: "image", requirementId, deliverableId, variantId, aspectRatio: format.aspect_ratio });
  const [policyDigest, proposedRequirementDigest] = await Promise.all([digest(policy), digest(recipe.spec)]);
  // Sibling MATERIALIZED proof relations preserve the full native assertion
  // without nesting additional AND nodes into D1's bounded expression tree.
  // Source-policy revocation is deliberately stricter for fresh production than
  // historical context custody. Any prior claim lease is outside this first slice.
  const proof: Proof = freeze({ sql: `WITH guest_bootstrap_native AS MATERIALIZED(SELECT 1 WHERE ${native.proof.sql}),
    guest_bootstrap_terms AS MATERIALIZED(SELECT 1 WHERE EXISTS(SELECT 1 FROM experience_guest_sources source
      JOIN experience_guest_source_policies policy ON policy.policy_id=source.policy_id AND policy.policy_digest=source.policy_digest
      WHERE source.session_id=? AND source.policy_id=? AND source.policy_digest=? AND source.request_digest=? AND policy.revoked_at_ms IS NULL)
      AND NOT EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=?)
      AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}<?)
    SELECT 1 AS current FROM guest_bootstrap_native,guest_bootstrap_terms`, bindings: [...native.proof.bindings,
    session.row.session_id, source.policy_id, source.policy_digest, source.request_digest, session.row.session_id,
    clock.now, policy.startsAtMs, policy.resources.startsAtMs, expiresAtMs] });
  const summary = freeze({ protocol: "guest-image-source@1" as const, sessionDigest: sessionBinding.sessionDigest,
    guestSourceDigest: sourceBinding.guestSourceDigest, policyDigest, campaignId: policy.campaignId, draftHash: plan.draftHash,
    intentKey: driver.intentKey, driverId: driver.driverId, expiresAtMs, proposedRequirementDigest, targetId: recipe.targetId,
    issuerVerified: false as const, admissionCommitted: false as const, providerSubmitted: false as const,
    generationAvailable: false as const, custodyTransferred: false as const });
  await prove(request, env, db, admission.origin, proof);
  // No asynchronous work follows the complete currentness proof.
  current(request, env, db, admission.origin);
  const preparation = Object.freeze(Object.create(null)) as GuestImagePreparation;
  preparations.set(preparation, { request, env, db, origin: admission.origin, proof });
  return freeze({ status: "source-bound" as const, preparation, summary });
}

/** Recheck only: no native writer accepts this seal. A future qualified writer
 * must consume the complete bootstrap SQL in its own atomic transaction and
 * prove only its exact successor footprint after the first Output write. */
export async function recheckGuestImagePreparation(request: Request, env: WorkerEnv, preparation: GuestImagePreparation): Promise<void> {
  const captured = preparation && typeof preparation === "object" ? preparations.get(preparation) : undefined;
  if (!captured || captured.request !== request || captured.env !== env) return unavailable();
  await prove(request, env, captured.db, captured.origin, captured.proof);
  current(request, env, captured.db, captured.origin);
}
