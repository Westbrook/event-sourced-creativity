import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { readSponsoredAudioActorRequest, readSponsoredAudioReview, sponsoredAudioActorIntentMatchesNative } from "../src/experiences/sponsored-audio-actor-intent.ts";
import { parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { parseAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { captureSponsorSceneJson } from "./experience-sponsor-scene-contract.ts";
import { requireAudioSponsorRunPreparation, type AudioSponsorRunPreparation } from "./output-audio-sponsored-handoff.ts";
import { outputAudioPreflightAssertions } from "./output-audio-preflight.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { outputDigest, outputProofReadStatements } from "./output-disclosure-proof.ts";
import { SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

const fail = (): never => { throw new SponsorEntitlementError("sponsor_audio_run_evidence_changed"); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function cleanAcknowledgementError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const error = Object.getOwnPropertyDescriptor(value, "error");
  return error ? Object.hasOwn(error, "value") && error.value === undefined : !("error" in value);
}
const principalColumns = ["user_id", "email", "display_name", "role", "consent_version", "consented_at", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const originalSql = `SELECT grant_row.authorization_event_id,grant_row.preflight_id,grant_row.expires_at,grant_row.payer_user_id,authorization.private_json AS authorization_json,
 command.command_key,command.request_digest,command.created_at AS command_created_at,quote.private_json AS quote_json,preflight.terms_digest,preflight.expires_at AS preflight_expires_at,
 slot.route_digest,slot.source_digest,slot.maximum_tokens,slot.maximum_microusd,slot.maximum_calls,slot.provider,slot.model
 FROM output_execution_grants grant_row
 JOIN output_operation_slots slot ON slot.scope_key=grant_row.scope_key AND slot.grant_id=grant_row.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN event_private_payloads authorization ON authorization.private_event_id=grant_row.authorization_event_id AND authorization.owner_id=plan.owner_user_id
  AND authorization.project_id=plan.project_id AND authorization.document_id=plan.document_id AND authorization.redacted_at IS NULL
 JOIN output_commands command ON command.scope_key=grant_row.scope_key AND command.actor_user_id=grant_row.actor_user_id
  AND command.event_id=grant_row.authorization_event_id AND command.action='authorize'
 JOIN events event ON event.event_id=command.event_id AND event.type='OutputExecutionAuthorized'
  AND event.stream_id='creative:'||plan.owner_user_id AND event.actor='user:'||grant_row.actor_user_id
  AND event.client_id='server:output-requirements' AND event.correlation_id=command.command_key AND event.compensates_event_id IS NULL
  AND json_extract(event.payload,'$.project_id')=plan.project_id AND json_extract(event.payload,'$.document_id')=plan.document_id
 JOIN output_preflights preflight ON preflight.scope_key=grant_row.scope_key AND preflight.preflight_id=grant_row.preflight_id
 JOIN event_private_payloads quote ON quote.private_event_id=preflight.event_id AND quote.owner_id=plan.owner_user_id
  AND quote.project_id=plan.project_id AND quote.document_id=plan.document_id AND quote.redacted_at IS NULL
 WHERE grant_row.scope_key=? AND grant_row.grant_id=? AND grant_row.actor_user_id=? AND plan.owner_user_id=?
  AND plan.document_id=? AND plan.project_id=? AND slot.slot_id=? AND slot.job_id=? AND slot.target_id=? AND slot.target_contract_digest=? AND plan.scope_kind='personal'
  AND grant_row.context_id IS NULL AND grant_row.plan_revision_id=slot.plan_revision_id
  AND preflight.plan_revision_id=slot.plan_revision_id AND preflight.actor_user_id=grant_row.actor_user_id
  AND grant_row.maximum_calls=slot.maximum_calls AND grant_row.maximum_microusd=slot.maximum_microusd
  AND (SELECT COUNT(*) FROM output_operation_slots member WHERE member.scope_key=grant_row.scope_key AND member.grant_id=grant_row.grant_id)=1
  AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
  AND length(CAST(authorization.private_json AS BLOB))<=524288 AND length(CAST(quote.private_json AS BLOB))<=524288`;
type Original = { authorization_event_id: string; preflight_id: string; expires_at: string; payer_user_id: string; authorization_json: string;
  command_key: string; request_digest: string; command_created_at: string; quote_json: string; preflight_expires_at: string;
  terms_digest: string; route_digest: string; source_digest: string; maximum_tokens: number; maximum_microusd: number; maximum_calls: number; provider: string; model: string };

/** Current native Run evidence from the original retained Audio authorization.
 * No fresh authorize body, rebased revision or reconstructed approval flags are
 * accepted. The execution owner must separately bind this exact actor intent to
 * the immutable V8 issuance and payer authority. This reader grants neither. */
export async function readSponsorAudioRunEvidence(trusted: OutputTrustedContext, commandInput: Record<string, unknown>, recipeInput: SponsorRecipe,
  preparation: AudioSponsorRunPreparation) {
  const command = freeze(captureSponsorSceneJson(commandInput)), recipe = freeze(captureSponsorSceneJson(recipeInput));
  if (!record(command) || !exactKeys(command, ["documentId", "action", "expectedRevision", "clientMutationId", "grantId"])
    || command.action !== "run" || command.documentId !== trusted.scope.documentId || !id(command.grantId) || !id(command.clientMutationId)
    || typeof command.expectedRevision !== "string" || !/^output:[0-9]+$/u.test(command.expectedRevision)) return fail();
  const request = trusted.request, env = trusted.env, database = env.DB, scope = trusted.scope, principal = trusted.principal;
  const signal = Object.getOwnPropertyDescriptor(Request.prototype, "signal")?.get?.call(request) as AbortSignal | undefined;
  if (!signal || request.signal !== signal || request.method !== "POST" || scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId
    || scope.contextId || scope.organizationId || scope.projectAccessId || trusted.projectContext
    || principal.userId !== scope.actorUserId || principal.streamId !== `creative:${scope.actorUserId}` || principal.fictional || principal.projectExecution
    || principal.billingUserId && principal.billingUserId !== principal.userId || env.FORMA_PILOT_COHORT_ID?.trim()
    || !trusted.context || !trusted.sourcePrivateCaptured || trusted.sourceProblems.length) return fail();
  const identities = { context: trusted.context, events: trusted.events, assertions: trusted.sourceAssertions };
  const lifetime = () => canonicalJson({ url: request.url, method: request.method, headers: [...request.headers.entries()],
    scope: trusted.scope, principal: trusted.principal, context: trusted.context, events: trusted.events,
    assertions: trusted.sourceAssertions, ownerHead: trusted.ownerHead, projectHead: trusted.projectHead,
    projectContext: Boolean(trusted.projectContext), sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    configuration: { model: env.OPENAI_MODEL ?? null, audioProvider: env.FORMA_AUDIO_PROVIDER ?? null,
      audioModel: env.FAL_AUDIO_MODEL ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null } });
  const lifetimeJson = lifetime(), credentials = [env.OPENAI_API_KEY, env.FAL_KEY];
  let nativeCurrent: (() => void) | undefined = undefined;
  let deadlineMs = Infinity;
  const assertCurrent = () => {
    if (Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get?.call(signal) !== false
      || request.signal !== signal || trusted.request !== request || trusted.env !== env || env.DB !== database
      || trusted.scope !== scope || trusted.principal !== principal || trusted.context !== identities.context
      || trusted.events !== identities.events || trusted.sourceAssertions !== identities.assertions
      || lifetime() !== lifetimeJson || env.OPENAI_API_KEY !== credentials[0] || env.FAL_KEY !== credentials[1]
      || !Number.isFinite(Date.now()) || Date.now() >= deadlineMs) return fail();
    nativeCurrent?.();
  };
  const checked = async <T>(work: () => Promise<T>): Promise<T> => { assertCurrent(); const value = await work(); assertCurrent(); return value; };
  const native = await checked(() => requireAudioSponsorRunPreparation(preparation, trusted, command));
  nativeCurrent = native.assertCurrent;
  deadlineMs = native.deadlineMs;
  assertCurrent();
  const nativeProof = outputAudioPreflightAssertions(native.nativePreflight);
  if (!native.nativePreflight.available || !nativeProof?.length || native.slot.grantId !== command.grantId || native.slot.scopeKey !== scope.key
    || native.slot.attemptOrdinal !== 0 || native.slot.previousSlotId !== null || !Number.isFinite(deadlineMs)) return fail();
  const auth = await checked(() => readExistingPrincipalRequest(request, env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || auth.user.consentVersion !== POLICY_VERSION || !same(auth.user, principal)) return fail();
  const capturedPrincipal = await checked(() => database.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(principal.userId).first<Record<string, unknown>>());
  if (!capturedPrincipal) return fail();
  const expected = { userId: String(capturedPrincipal.user_id), email: String(capturedPrincipal.email), displayName: String(capturedPrincipal.display_name),
    role: String(capturedPrincipal.role), consentVersion: capturedPrincipal.consent_version ? String(capturedPrincipal.consent_version) : null,
    consentedAt: capturedPrincipal.consented_at ? String(capturedPrincipal.consented_at) : null,
    authorizationSnapshot: { updatedAt: String(capturedPrincipal.updated_at ?? ""), rawEpoch: String(capturedPrincipal.permission_epoch ?? ""),
      grants: String(capturedPrincipal.grants_json ?? "[]"), organizations: String(capturedPrincipal.organizations_json ?? "[]"),
      projects: String(capturedPrincipal.projects_json ?? "[]"), identityPolicies: String(capturedPrincipal.identity_policies_json ?? "[]"), canvasRequirements: Number(capturedPrincipal.approved_canvas_requirements ?? 0) } };
  if (!same(expected, { userId: principal.userId, email: principal.email, displayName: principal.displayName, role: principal.role,
    consentVersion: principal.consentVersion, consentedAt: principal.consentedAt, authorizationSnapshot: principal.authorizationSnapshot })) return fail();
  const bindings = [scope.key, command.grantId, principal.userId, principal.userId, scope.documentId, scope.projectId,
    native.slot.slotId, native.slot.jobId, native.slot.targetId, native.slot.targetContractDigest];
  const original = await checked(() => database.prepare(originalSql).bind(...bindings).first<Original>());
  if (!original || typeof original.authorization_json !== "string" || typeof original.quote_json !== "string"
    || new TextEncoder().encode(original.authorization_json).byteLength > 524288 || new TextEncoder().encode(original.quote_json).byteLength > 524288
    || !Number.isFinite(Date.parse(original.expires_at))) return fail();
  deadlineMs = Math.min(deadlineMs, Date.parse(original.expires_at));
  assertCurrent();
  const authorization = captureSponsorSceneJson(JSON.parse(original.authorization_json)), quoteBody = captureSponsorSceneJson(JSON.parse(original.quote_json));
  const authorize = record(authorization) && record(authorization.output_command_envelope) ? authorization.output_command_envelope : null;
  const quote = record(quoteBody) && record(quoteBody.preflight) ? quoteBody.preflight : null;
  if (!authorize || !quote || !exactKeys(authorize, ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "audioCostConsent", "sponsor_entitlement"])
    || authorize.action !== "authorize" || authorize.documentId !== scope.documentId || authorize.explicitAuthorization !== true
    || typeof authorize.expectedRevision !== "string" || !/^output:[0-9]+$/u.test(authorize.expectedRevision) || !id(authorize.clientMutationId)
    || !record(authorize.sponsor_entitlement) || authorize.preflightId !== original.preflight_id || authorize.termsDigest !== original.terms_digest
    || authorize.clientMutationId !== original.command_key || !same(quote, native.quote) || quote.id !== original.preflight_id
    || quote.termsDigest !== original.terms_digest || quote.expiresAt !== original.preflight_expires_at
    || quote.planRevisionId !== native.slot.planRevisionId || quote.sourceDigest !== trusted.sourceDigest || quote.requirementsDigest !== trusted.requirementsDigest
    || authorize.maximumMicrousd !== quote.maximumMicrousd || quote.maximumCalls !== 3 || !Array.isArray(quote.targets) || quote.targets.length !== 1
    || !same(quote.targets[0], native.nativePreflight)) return fail();
  if (!record(authorization) || authorization.grant_id !== command.grantId || authorization.plan_revision_id !== native.slot.planRevisionId
    || authorization.preflight_id !== original.preflight_id || authorization.maximum_microusd !== native.slot.maximumMicrousd
    || authorization.maximum_calls !== 3 || authorization.source_digest !== trusted.sourceDigest
    || !same(authorization.authorized_targets, [{ target_id: native.slot.targetId, operation_slot_id: native.slot.slotId,
      job_id: native.slot.jobId, route_digest: native.slot.routeDigest }])) return fail();
  const marker = authorize.sponsor_entitlement;
  if (!exactKeys(marker, ["payer_user_id", "campaign_id", "policy_digest", "envelope_digest", "consumption_id", "audio_actor_intent"])
    || !id(marker.payer_user_id) || marker.payer_user_id === principal.userId || !id(marker.campaign_id) || !id(marker.consumption_id)
    || !hash(marker.policy_digest) || !hash(marker.envelope_digest) || !record(marker.audio_actor_intent)
    || !exactKeys(marker.audio_actor_intent, ["request", "review", "requestDigest", "reviewDigest", "commandDigest"])) return fail();
  const retainedIntent = marker.audio_actor_intent;
  if (![retainedIntent.requestDigest, retainedIntent.reviewDigest, retainedIntent.commandDigest].every(hash)) return fail();
  const actorRequest = readSponsoredAudioActorRequest(retainedIntent.request), review = readSponsoredAudioReview(retainedIntent.review);
  if (review.payerUserId !== marker.payer_user_id || marker.payer_user_id !== original.payer_user_id
    || review.campaignId !== marker.campaign_id || review.policyDigest !== marker.policy_digest
    || actorRequest.termsDigest !== authorize.termsDigest || actorRequest.maximumMicrousd !== authorize.maximumMicrousd
    || actorRequest.explicitAuthorization !== authorize.explicitAuthorization || !same(actorRequest.audioCostConsent, authorize.audioCostConsent)) return fail();
  const settings = record(native.nativePreflight.settings) ? native.nativePreflight.settings : null;
  const payload = settings && record(settings.payload) ? settings.payload : null;
  const contract = payload ? parseAudioOutputContract(payload.outputAudio) : null;
  const preview = settings ? parseAudioMiniAppCostPreview(settings.costPreview) : null;
  if (!settings || !contract || !preview || preview.requestId !== native.slot.jobId || preview.actorUserId !== principal.userId
    || preview.projectId !== scope.projectId || preview.documentId !== scope.documentId || preview.sourceDigest !== trusted.sourceDigest
    || preview.requirementsDigest !== trusted.requirementsDigest || preview.maximumMicrousd !== native.slot.maximumMicrousd
    || contract.source.draftId !== preview.draftId || typeof quote.expiresAt !== "string") return fail();
  const facts = { draftHash: contract.source.draftHash, termsDigest: original.terms_digest, preview, expiresAt: quote.expiresAt };
  if (!sponsoredAudioActorIntentMatchesNative(review, actorRequest, facts)) return fail();
  deadlineMs = Math.min(deadlineMs, Date.parse(review.expiresAt), Date.parse(preview.expiresAt), Date.parse(quote.expiresAt));
  assertCurrent();
  const { sponsor_entitlement: ignored, ...originalCommand } = authorize;
  void ignored;
  const requestDigest = await checked(() => digest(actorRequest));
  const reviewDigest = await checked(() => digest(review));
  const commandDigest = await checked(() => digest(originalCommand));
  const nativeRequestDigest = await checked(() => outputDigest(authorize));
  if (requestDigest !== retainedIntent.requestDigest || reviewDigest !== retainedIntent.reviewDigest
    || actorRequest.sponsorReview.reviewDigest !== reviewDigest || commandDigest !== retainedIntent.commandDigest
    || nativeRequestDigest !== original.request_digest) return fail();
  const actorIntent = freeze({ request: actorRequest, review, requestDigest, reviewDigest, commandDigest });
  const release = await checked(() => registeredExperience("audio"));
  if (!release || release.output.output !== "audio" || release.releaseHash !== contract.source.releaseHash) return fail();
  const routeDigest = await checked(() => digest(native.nativePreflight)), settingsDigest = await checked(() => digest(settings));
  const actual: SponsorRecipe = { appId: "audio", recipeVersion: `audio@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: "audio", provider: "fal", model: String(native.nativePreflight.model), routeDigest, settingsDigest,
    outputCount: 1, durationMs: 20000, width: 0, height: 0, calls: { parsing: 0, planning: 1, render: 1, repair: 1 },
    maximumTokens: 128000, maximumMicrousd: native.nativePreflight.maximumMicrousd };
  if (!same(actual, recipe) || actual.routeDigest !== `sha256:${original.route_digest}` || original.source_digest !== trusted.sourceDigest
    || actual.provider !== original.provider || actual.model !== original.model || actual.maximumTokens !== original.maximum_tokens
    || actual.maximumMicrousd !== original.maximum_microusd || original.maximum_calls !== 3
    || native.nativePreflight.maximumCalls !== 3 || native.nativePreflight.maximumTokens !== 128000
    || native.nativePreflight.provider !== "fal" || native.nativePreflight.model !== "fal-ai/stable-audio-3/medium/text-to-audio"
    || native.nativePreflight.route !== "document-audio-timed-music-manual-v1") return fail();
  const persistentAssertions: OutputSqlAssertion[] = [
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [principal.userId, JSON.stringify(principalColumns.map(column => capturedPrincipal[column] ?? null))] },
    { sql: `EXISTS(SELECT 1 FROM (${originalSql}) captured WHERE authorization_event_id=? AND preflight_id=? AND expires_at=? AND payer_user_id=?
       AND authorization_json=? AND command_key=? AND request_digest=? AND command_created_at=? AND quote_json=? AND terms_digest=? AND preflight_expires_at=?
       AND route_digest=? AND source_digest=? AND maximum_tokens=? AND maximum_microusd=? AND maximum_calls=? AND provider=? AND model=?)`,
      bindings: [...bindings, original.authorization_event_id, original.preflight_id, original.expires_at, original.payer_user_id,
        original.authorization_json, original.command_key, original.request_digest, original.command_created_at, original.quote_json, original.terms_digest, original.preflight_expires_at,
        original.route_digest, original.source_digest, original.maximum_tokens, original.maximum_microusd, original.maximum_calls, original.provider, original.model], deadlineMs },
  ];
  // Keep the native WeakMap proof itself in the final read even if a future
  // preparation changes how its other current assertions are collected.
  const assertions = [...new Map([...native.assertions, ...nativeProof, ...persistentAssertions].map(proof => [canonicalJson(proof), proof])).values()];
  if (!assertions.length || assertions.length > 160 || assertions.some(proof => !proof.sql || proof.sql.length > 100000 || (proof.bindings?.length ?? 0) > 100)
    || new TextEncoder().encode(canonicalJson(assertions)).byteLength > 2 * 1024 * 1024) return fail();
  deadlineMs = Math.min(deadlineMs, ...assertions.flatMap(proof => proof.deadlineMs === undefined ? [] : [proof.deadlineMs]));
  const checkedProof = await checked(() => database.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions)));
  if (!Array.isArray(checkedProof) || own(checkedProof, "length") !== assertions.length || Array.from({ length: assertions.length }, (_, index) => {
    const result = own(checkedProof, index), rows = own(result, "results");
    return own(result, "success") !== true || !cleanAcknowledgementError(result) || !Array.isArray(rows)
      || own(rows, "length") !== 1 || own(own(rows, 0), "current") !== 1;
  }).some(Boolean) || !sponsoredAudioActorIntentMatchesNative(review, actorRequest, facts)) return fail();
  assertCurrent();
  return freeze({ recipe: actual, offered: JSON.parse(canonicalJson(native.nativePreflight)) as Record<string, unknown>, actorIntent,
    originalRequestId: preview.requestId, originalExpiresAtMs: Date.parse(preview.expiresAt),
    assertions: structuredClone(assertions), persistentAssertions, deadlineMs, assertCurrent });
}
