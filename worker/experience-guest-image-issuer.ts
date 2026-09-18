import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import { compileGuestSponsorEnvelope, type GuestSponsorEnvelopeV3 } from "./experience-guest-sponsor-contract.ts";
import { guestImageAuthorizationData, observeGuestImageIssuer,
  type GuestImageAuthorization, type GuestImageIssuerObservation } from "./experience-guest-image-authorization.ts";
import { denseGuestImageAcknowledgement } from "./experience-guest-image-confirmation.ts";
import { guestImageIssuerStageData, guestImageIssuerSuccessor, guestImageQuoteRecipe,
  type GuestImageOutputInput, type GuestImageIssuerRows } from "./experience-guest-image-stage-witness.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import { GUEST_DB_NOW, guestFail } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (part: string): never => guestFail(`image_issuer_${part}`);
function data(observed: GuestImageIssuerObservation) {
  observed.life.check();
  return guestImageIssuerStageData(observed.ctx.request, observed.ctx.env, observed.witness);
}
function receipt(observed: GuestImageIssuerObservation, replayed: boolean) {
  const current = data(observed), rows = current.issuance;
  if (!rows || !current.stage.quote || rows.issuance.command_digest !== observed.authorizationDigest) return fail("original_unavailable");
  const result = freeze({ status: "issued" as const, documentId: current.stage.base.plan.documentId,
    preflightId: current.stage.quote.id, grantId: rows.grant.grant_id, expiresAtMs: rows.grant.expires_at_ms, replayed,
    nativeAuthorizationCommitted: false, admissionCommitted: false, generationAvailable: false, custodyTransferred: false });
  data(observed); return result;
}
async function read(request: Request, env: WorkerEnv, base: GuestImageOutputInput) {
  const observed = await observeGuestImageIssuer(request, env, base), current = data(observed);
  if (!current.issuance) { data(observed); return null; }
  return receipt(observed, true);
}
/** Exact current metadata only. Absence means a proved quoted-unissued source. */
export function readGuestImageIssuance(request: Request, env: WorkerEnv, base: GuestImageOutputInput) {
  return read(request, env, base);
}

async function prepare(observed: GuestImageIssuerObservation) {
  const original = data(observed), { stage, sessionBinding, sourceBinding } = original;
  if (original.issuance || stage.state !== "quoted" || !stage.quote || !stage.quoteEvent || !stage.confirmed) return fail("quote_required");
  const { ctx, life } = observed, { policy } = stage.base, quote = stage.quote;
  const recipe = await life.wait(() => guestImageQuoteRecipe(stage, quote.targets[0]!, stage.transport)); data(observed);
  const clock = await life.wait(() => ctx.db.prepare(`SELECT ${GUEST_DB_NOW} AS now_ms`).first<{ now_ms: number }>()); data(observed);
  if (!clock || !Number.isSafeInteger(clock.now_ms) || clock.now_ms < 0) return fail("clock_unavailable");
  const issuedAtMs = clock.now_ms, expiresAtMs = Math.min(stage.expiresAtMs, Date.parse(quote.expiresAt),
    sessionBinding.expiresAtMs, sourceBinding.expiresAtMs, policy.expiresAtMs, policy.resources.expiresAtMs,
    issuedAtMs + policy.maximumGrantLifetimeMs);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= issuedAtMs) return fail("expired");
  const actor = stage.base.session.row.guest_subject, intentKey = stage.driver.stageKeys.authorize;
  const [stableDigest, templateDigest, rightsDigest, compiledInputDigest, transferEnvelopeDigest] = await life.wait(() => Promise.all([
    digest({ campaignId: policy.campaignId, actorUserId: actor, intentKey }), digest(policy.templates[0]),
    digest({ domain: "forma-sponsor-guest-source-rights@1", guestAdmission: policy.guestAdmission,
      guestSource: sourceBinding, sourceRevision: stage.base.sourceHead + 3, sourceDigest: quote.sourceDigest }),
    digest({ snapshot: stage.context.snapshot, settings: quote.targets[0]!.settings }),
    digest({ sourceDigest: quote.sourceDigest, requirementsDigest: quote.requirementsDigest, settings: quote.targets[0]!.settings }),
  ])); data(observed);
  const stable = stableDigest.slice(7), grantId = `sponsor-issued-${stable}`, resourceId = `sponsor-resource-issue-${stable}`;
  const envelope: GuestSponsorEnvelopeV3 = { version: 3, campaignId: policy.campaignId, policyVersion: policy.policyVersion,
    consumptionId: `sponsor-consume-${stable}`, intentKey, actorKind: "guest", actorUserId: actor,
    sessionDigest: observed.authorization.sessionDigest, payerUserId: policy.payerUserId, ownerUserId: actor,
    projectId: stage.base.plan.projectId, documentId: stage.base.plan.documentId, sourceRevision: stage.base.sourceHead + 3,
    sourceDigest: `sha256:${quote.sourceDigest}`, orderedAssetDigests: [], rightsDigest, compiledInputDigest, transferEnvelopeDigest,
    recipe, templateDigest, issuedAtMs, expiresAtMs, guestSource: sourceBinding, guestAuthorizationDigest: observed.authorizationDigest };
  const compiled = await life.wait(() => compileGuestSponsorEnvelope(policy, envelope, { sessionBinding, authorization: observed.authorization,
    native: { sourceRevision: stage.base.sourceHead + 3, preflight: quote, contextSnapshot: stage.context.snapshot, transport: stage.transport } })); data(observed);
  if (compiled.policyDigest !== observed.base.policyDigest || compiled.envelope.guestAuthorizationDigest !== observed.authorizationDigest) return fail("binding_changed");
  const resource = await life.wait(() => prepareSponsorResourcePlan({ limits: policy.resources, campaignId: policy.campaignId,
    policyDigest: compiled.policyDigest, actorUserId: actor, sessionDigest: compiled.envelope.sessionDigest,
    intentKey, operation: "issuance", payloadDigest: compiled.envelopeDigest,
    textBytes: new TextEncoder().encode(canonicalJson(stage.context.snapshot)).byteLength, resourceId, issuedGrantId: grantId })); data(observed);
  const rows: GuestImageIssuerRows = {
    grant: { grant_id: grantId, campaign_id: policy.campaignId, policy_digest: compiled.policyDigest, actor_user_id: actor,
      session_digest: compiled.envelope.sessionDigest, intent_key: intentKey, envelope_digest: compiled.envelopeDigest,
      issued_at_ms: issuedAtMs, expires_at_ms: expiresAtMs, enabled: 1 },
    issuance: { grant_id: grantId, campaign_id: policy.campaignId, actor_user_id: actor, intent_key: intentKey,
      policy_digest: compiled.policyDigest, driver_command_json: stage.driver.commandJson, command_digest: observed.authorizationDigest,
      envelope_digest: compiled.envelopeDigest, envelope_json: compiled.envelopeJson },
    resource: { resource_id: resourceId, campaign_id: policy.campaignId, policy_digest: compiled.policyDigest,
      limits_digest: resource.limitsDigest, actor_user_id: actor, session_digest: compiled.envelope.sessionDigest,
      operation: "issuance", intent_key: intentKey, payload_digest: compiled.envelopeDigest,
      text_bytes: resource.input.textBytes, issued_grant_id: grantId },
  };
  const successor = await life.wait(() => guestImageIssuerSuccessor(ctx.request, ctx.env, observed.witness, rows)); data(observed);
  return { rows: freeze(rows), resource, successor };
}

async function original(observed: GuestImageIssuerObservation, replayed: boolean) {
  const { ctx, life } = observed;
  const recovered = await life.wait(() => observeGuestImageIssuer(ctx.request, ctx.env, observed.base, observed.authorization, life.deadline));
  data(observed);
  const result = receipt(recovered, replayed); data(observed); return result;
}
async function issue(request: Request, env: WorkerEnv, authority: GuestImageAuthorization) {
  const authorized = guestImageAuthorizationData(request, env, authority);
  // Re-observe before selecting the write path. Reusing an earlier capability
  // after a successful issue must itself be a read-only exact replay.
  const observed = await authorized.life.wait(() => observeGuestImageIssuer(request, env, authorized.base,
    authorized.authorization, authorized.life.deadline));
  data(authorized); const current = data(observed);
  if (current.issuance) { const result = await original(observed, true); data(observed); return result; }
  const prepared = await observed.life.wait(() => prepare(observed)); data(observed);
  const { rows, resource, successor } = prepared, { ctx, life } = observed;
  const statements = [...outputAssertionStatements(env, current.assertion)], grantIndex = statements.length;
  const g = rows.grant;
  statements.push(ctx.db.prepare(`INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(g.grant_id,g.campaign_id,g.policy_digest,g.actor_user_id,g.session_digest,g.intent_key,g.envelope_digest,g.issued_at_ms,g.expires_at_ms,g.enabled));
  const exact = [grantIndex];
  for (const statement of resource.statements) {
    if (/INSERT INTO experience_sponsor_resource_receipts\(/u.test(statement.sql)) exact.push(statements.length);
    statements.push(ctx.db.prepare(statement.sql).bind(...statement.bindings));
  }
  if (exact.length !== 2) return fail("resource_plan_unavailable");
  exact.push(statements.length);
  const i = rows.issuance;
  statements.push(ctx.db.prepare(`INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(i.grant_id,i.campaign_id,i.actor_user_id,i.intent_key,i.policy_digest,i.driver_command_json,i.command_digest,i.envelope_digest,i.envelope_json));
  statements.push(...outputAssertionStatements(env, successor)); data(observed);
  try {
    const results = await life.wait(() => ctx.db.batch(statements)); data(observed);
    if (!denseGuestImageAcknowledgement(results, statements.length, exact)) return fail("acknowledgement_unavailable");
  } catch (error) {
    data(observed);
    // Only the already committed exact original can resolve an uncertain ACK.
    // Never retry this batch, renew timestamps or refund preparation work.
    try { const result = await original(observed, true); data(observed); return result; }
    catch { data(observed); throw error; }
  }
  const result = await original(observed, false); data(observed); return result;
}
/** Returns the owner's exact Promise; it mints no native admission capability. */
export function issueGuestImageGrant(request: Request, env: WorkerEnv, authority: GuestImageAuthorization) {
  return issue(request, env, authority);
}
