import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { captureExperienceSceneTarget } from "../src/experiences/scene-target.ts";
import { parseSceneMiniAppCostPreview, sceneMiniAppCostApprovalMatches, type SceneMiniAppCostApproval } from "../src/model/scene-mini-app-consent.ts";
import { compileSponsorSceneEnvelope, SponsorEntitlementError, type SponsorEnvelopeV6 } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorSceneCampaign, readSponsorInternalCommand, sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { createSponsorAdmissionAuthority, sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { captureSponsorSceneJson, matchSponsorSceneTemplate } from "./experience-sponsor-scene-contract.ts";
import { describeSponsorSceneAdmission, readSponsorSceneTemplateEvidence } from "./experience-sponsor-scene-evidence.ts";
import { requireSceneSponsorAdmissionForEvidence, type SceneSponsorAdmissionPreparation } from "./output-scene-sponsored-handoff.ts";
import { outputScenePreflightProof } from "./output-scene-preflight.ts";
import { sceneSourceVersionAssertions } from "./scene-source-generation.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { outputAssertionStatements, rememberOutputPrivateBody, readOutputCommand, outputCommandReceiptAssertion, type OutputCommandReceipt, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import { outputDigest, outputExperienceCommands, type OutputTrustedContext } from "./output-requirements-api.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const selectionKeys = ["action", "campaignId", "documentId", "planRevisionId", "targetId", "intentKey"];
const runKeys = [...selectionKeys, "reviewedPolicyDigest", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "sceneCostConsent"];
const authorizeKeys = ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "sceneCostConsent"];
export type SponsorScenePrepareCommand = { action: "prepare-sponsored-scene"; campaignId: string; documentId: string; planRevisionId: string; targetId: string; intentKey: string };
export type SponsorSceneRunCommand = Omit<SponsorScenePrepareCommand, "action"> & { action: "run-sponsored-scene"; reviewedPolicyDigest: string;
  preflightId: string; termsDigest: string; maximumMicrousd: number; explicitAuthorization: true; sceneCostConsent: SceneMiniAppCostApproval };
export type SponsorSceneDriverCommand = SponsorScenePrepareCommand | SponsorSceneRunCommand;

/** Snapshot own data before reading fields; confirmation is copied from the
 * actor and never manufactured from the server's preview. This is shape only. */
export function readSponsorSceneDriverCommand(raw: unknown): SponsorSceneDriverCommand {
  let value: unknown;
  try { value = captureSponsorSceneJson(raw); } catch { return fail("sponsor_driver_command_invalid"); }
  if (!record(value) || !exactKeys(value, value.action === "prepare-sponsored-scene" ? selectionKeys : runKeys)
    || !["prepare-sponsored-scene", "run-sponsored-scene"].includes(String(value.action))
    || ![value.campaignId, value.documentId, value.planRevisionId, value.targetId, value.intentKey].every(id)
    || String(value.intentKey).length > 80 || new TextEncoder().encode(canonicalJson(value)).byteLength > 8192) return fail("sponsor_driver_command_invalid");
  if (value.action === "run-sponsored-scene") {
    if (!hash(value.reviewedPolicyDigest) || !id(value.preflightId) || typeof value.termsDigest !== "string" || !/^[a-f0-9]{64}$/u.test(value.termsDigest)
      || !Number.isSafeInteger(value.maximumMicrousd) || Number(value.maximumMicrousd) < 1 || value.explicitAuthorization !== true
      || !record(value.sceneCostConsent) || value.sceneCostConsent.confirmed !== true) return fail("sponsor_driver_command_invalid");
    const { confirmed: ignored, ...preview } = value.sceneCostConsent; void ignored;
    if (!parseSceneMiniAppCostPreview(preview)) return fail("sponsor_driver_command_invalid");
  }
  return freeze(JSON.parse(canonicalJson(value)) as SponsorSceneDriverCommand);
}
const selection = (command: SponsorSceneDriverCommand): SponsorScenePrepareCommand => ({ action: "prepare-sponsored-scene", campaignId: command.campaignId,
  documentId: command.documentId, planRevisionId: command.planRevisionId, targetId: command.targetId, intentKey: command.intentKey });
/** Changing content beneath an existing actor intent cannot create a new key. */
export async function sponsorSceneIssuerIntentKey(raw: unknown) {
  const command = readSponsorSceneDriverCommand(raw);
  return `sponsor-scene-authorize-${(await digest({ campaignId: command.campaignId, intentKey: command.intentKey })).slice(7)}`;
}

// Existing immutable output-neutral issuer/driver schemas are installed only
// by the caller's reviewed environment. This module registers no route or DDL.
declare const issuerAuthority: unique symbol;
export type SponsorSceneIssuerAuthority = Readonly<{ [issuerAuthority]: true }>;
type State = { request: Request; signal: AbortSignal; scope: OutputTrustedContext["scope"]; principal: OutputTrustedContext["principal"];
  capturedAssertions: OutputSqlAssertion[]; env: OutputTrustedContext["env"]; database: OutputTrustedContext["env"]["DB"];
  actorUserId: string; documentId: string; scopeJson: string; sourceBinding: string; driverCommand: SponsorSceneRunCommand;
  approved: Awaited<ReturnType<typeof loadApprovedSponsorSceneCampaign>>; resourceAssertion: OutputSqlAssertion;
  driverId: string; sessionDigest: string; textBytes: number; driverAssertions: OutputSqlAssertion[] };
const issuers = new WeakMap<SponsorSceneIssuerAuthority, State>();
type Guard = () => void;
async function guarded<T>(current: Guard, work: () => Promise<T>): Promise<T> { current(); const value = await work(); current(); return value; }
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function checkBatch(results: unknown, count: number, proof: boolean) {
  if (!Array.isArray(results) || own(results, "length") !== count) return fail("sponsor_issuer_authority_changed");
  for (let index = 0; index < count; index++) {
    const result = own(results, index), rows = own(result, "results");
    const resultObject = result && typeof result === "object" ? result : null;
    const error = resultObject ? Object.getOwnPropertyDescriptor(resultObject, "error") : undefined;
    if (own(result, "success") !== true || resultObject && "error" in resultObject && (!error || !("value" in error) || error.value !== undefined) || !Array.isArray(rows)
      || own(rows, "length") !== (proof ? 1 : 0) || proof && own(own(rows, 0), "current") !== 1) return fail("sponsor_issuer_authority_changed");
  }
}
function beforeDeadline(assertions: readonly OutputSqlAssertion[]) {
  const deadline = Math.min(Number.POSITIVE_INFINITY, ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
  if (Number.isNaN(deadline) || Date.now() >= deadline) return fail("sponsor_issuer_authority_changed");
}
type DatabaseState = Pick<State, "env" | "database">;
async function prove(state: DatabaseState, assertions: OutputSqlAssertion[], current: Guard) {
  current(); beforeDeadline(assertions);
  const statements = outputProofReadStatements(state.env, assertions);
  const results = await guarded(current, () => state.database.batch<Record<string, unknown>>(statements));
  current(); beforeDeadline(assertions); checkBatch(results, statements.length, true); current();
}
async function commit(state: State, statements: D1PreparedStatement[], current: Guard) {
  const results = await guarded(current, () => state.database.batch(statements));
  current(); checkBatch(results, statements.length, false); current();
}
// Private lifetime material; provider credentials/request headers never enter
// receipts, envelopes or returned metadata.
const sourceBinding = (trusted: OutputTrustedContext) => canonicalJson({ request: { url: trusted.request.url, method: trusted.request.method,
  headers: [...trusted.request.headers.entries()] }, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
  context: trusted.context, events: trusted.events, assertions: trusted.sourceAssertions, ownerHead: trusted.ownerHead, sourceProblems: trusted.sourceProblems,
  sourcePrivateCaptured: trusted.sourcePrivateCaptured, principal: trusted.principal, projectContext: trusted.projectContext,
  configuration: { cohort: trusted.env.FORMA_PILOT_COHORT_ID ?? null, model: trusted.env.OPENAI_MODEL ?? null,
    providerKey: trusted.env.OPENAI_API_KEY ?? null, admins: trusted.env.FORMA_ADMIN_EMAILS ?? null } });
const aborted = (signal: AbortSignal) => Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!, signal, []) as boolean;
const nativeSignal = (request: Request) => Reflect.apply(Object.getOwnPropertyDescriptor(Request.prototype, "signal")!.get!, request, []) as AbortSignal;
function stateFor(authority: SponsorSceneIssuerAuthority, trusted: OutputTrustedContext) {
  const state = issuers.get(authority);
  if (!state || aborted(state.signal) || state.request.signal !== state.signal || nativeSignal(state.request) !== state.signal || state.request !== trusted.request || state.scope !== trusted.scope
    || state.principal !== trusted.principal || state.env !== trusted.env || state.database !== trusted.env.DB
    || state.scopeJson !== canonicalJson(trusted.scope) || state.sourceBinding !== sourceBinding(trusted)) return fail("sponsor_issuer_authority_changed");
  beforeDeadline([...state.capturedAssertions, { sql: "1", deadlineMs: Math.min(state.approved.policy.expiresAtMs, state.approved.policy.resources.expiresAtMs) }]);
  return state;
}
function guardedEnv(env: WorkerEnv, database: WorkerEnv["DB"], current: Guard): WorkerEnv {
  return { ...env, get DB() { current(); return database; } };
}
function nativeView(trusted: OutputTrustedContext, current: Guard): OutputTrustedContext {
  const request = trusted.request, env = trusted.env, scope = trusted.scope;
  // requireCurrentSource appends its exact rights-deadline predicates to its
  // context's array. Give that native operation its own array, preserving the
  // issuer's captured source bytes and original opaque Request/env/scope. The
  // native handoff explicitly accepts the original plus/minus that deadline.
  return { ...trusted, sourceAssertions: structuredClone(trusted.sourceAssertions),
    get request() { current(); return request; }, get env() { current(); return env; }, get scope() { current(); return scope; } };
}
const asAssertion = (value: { sql: string; bindings: readonly (string | number | null)[] }): OutputSqlAssertion => ({ sql: value.sql, bindings: [...value.bindings] });

async function preparationProofs(trusted: OutputTrustedContext, command: SponsorSceneRunCommand, approved: State["approved"], sessionDigest: string, current: Guard) {
  const database = trusted.env.DB, prepare = selection(command), prepareJson = canonicalJson(prepare);
  const commandDigest = await guarded(current, () => digest(prepare));
  const driverId = `sponsor-scene-driver-${(await guarded(current, () => digest({ campaignId: command.campaignId, actor: trusted.scope.actorUserId, intentKey: command.intentKey }))).slice(7)}`;
  const textBytes = new TextEncoder().encode(canonicalJson(trusted.context!.snapshot)).byteLength;
  const payloadDigest = await guarded(current, () => digest({ command: prepare, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest }));
  const resourceBase = { limits: approved.policy.resources, campaignId: command.campaignId, policyDigest: approved.policyDigest,
    actorUserId: trusted.scope.actorUserId, sessionDigest, intentKey: command.intentKey, payloadDigest, textBytes };
  const intake = await guarded(current, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "text-intake", resourceId: `${driverId}:text` }));
  const preflight = await guarded(current, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "preflight", resourceId: `${driverId}:preflight` }));
  const intent: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_driver_intents WHERE driver_id=? AND campaign_id=? AND actor_user_id=?
    AND session_digest=? AND intent_key=? AND document_id=? AND command_json=? AND command_digest=? AND source_digest=? AND requirements_digest=? AND source_text_bytes=?)`,
    bindings: [driverId, command.campaignId, trusted.scope.actorUserId, sessionDigest, command.intentKey, command.documentId, prepareJson, commandDigest,
      trusted.sourceDigest, trusted.requirementsDigest, textBytes] };
  const row = await guarded(current, () => database.prepare("SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='preflight'")
    .bind(driverId).first<{ command_json: string; command_digest: string }>());
  if (!row || typeof own(row, "command_json") !== "string" || typeof own(row, "command_digest") !== "string" || row.command_json.length > 8192) return fail("sponsor_issuer_preparation_required");
  let stage: unknown; try { stage = captureSponsorSceneJson(JSON.parse(row.command_json)); } catch { return fail("sponsor_issuer_preparation_required"); }
  const key = await guarded(current, () => sponsorSceneIssuerIntentKey(command));
  if (!record(stage) || !exactKeys(stage, ["action", "documentId", "planRevisionId", "targetIds", "expectedRevision", "clientMutationId"])
    || stage.action !== "preflight" || stage.documentId !== command.documentId || stage.planRevisionId !== command.planRevisionId
    || canonicalJson(stage.targetIds) !== canonicalJson([command.targetId]) || typeof stage.expectedRevision !== "string" || !/^output:[0-9]+$/u.test(stage.expectedRevision)
    || stage.clientMutationId !== `sponsor-scene-preflight-${key.slice("sponsor-scene-authorize-".length)}`
    || row.command_digest !== await guarded(current, () => outputDigest(stage))) return fail("sponsor_issuer_preparation_required");
  const receipt = await guarded(current, () => readOutputCommand(guardedEnv(trusted.env, database, current), trusted.scope, String(stage.clientMutationId), row.command_digest));
  const quote = receipt && record(receipt.payload.preflight) ? receipt.payload.preflight : null;
  if (!receipt || receipt.action !== "preflight" || canonicalJson(receipt.payload.output_command_envelope) !== canonicalJson(stage)
    || !quote || quote.id !== command.preflightId || quote.termsDigest !== command.termsDigest || quote.maximumMicrousd !== command.maximumMicrousd
    || quote.planRevisionId !== command.planRevisionId || quote.sourceDigest !== trusted.sourceDigest || quote.requirementsDigest !== trusted.requirementsDigest)
    return fail("sponsor_issuer_preparation_required");
  const stageProof: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='preflight' AND command_json=? AND command_digest=?)`,
    bindings: [driverId, row.command_json, row.command_digest] };
  return { driverId, textBytes, driverAssertions: [intent, asAssertion(intake.receiptAssertion), asAssertion(preflight.receiptAssertion), stageProof,
    outputCommandReceiptAssertion(trusted.scope, receipt)] };
}

/** Only the actual explicit run wire, real payer approval and already charged
 * foreground preparation can mint this private issuer seal. */
export async function createSponsorSceneIssuerAuthority(trusted: OutputTrustedContext, campaignId: string): Promise<SponsorSceneIssuerAuthority> {
  const captured = { request: trusted.request, signal: trusted.request.signal, scope: trusted.scope, principal: trusted.principal,
    capturedAssertions: structuredClone(sponsorCurrentSourceAssertions(trusted)), env: trusted.env, database: trusted.env.DB,
    actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId, scopeJson: canonicalJson(trusted.scope), sourceBinding: sourceBinding(trusted) };
  const current = () => {
    if (aborted(captured.signal) || captured.request.signal !== captured.signal || nativeSignal(captured.request) !== captured.signal || trusted.request !== captured.request || trusted.scope !== captured.scope
      || trusted.principal !== captured.principal || trusted.env !== captured.env || trusted.env.DB !== captured.database
      || canonicalJson(trusted.scope) !== captured.scopeJson || sourceBinding(trusted) !== captured.sourceBinding) return fail("sponsor_issuer_authority_changed");
  };
  const driverCommand = readSponsorSceneDriverCommand(await guarded(current, () => readSponsorInternalCommand(captured.request, 8192)));
  current();
  if (driverCommand.action !== "run-sponsored-scene" || driverCommand.campaignId !== campaignId || driverCommand.documentId !== captured.documentId
    || trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== captured.actorUserId || trusted.scope.contextId || trusted.scope.organizationId || trusted.scope.projectAccessId
    || trusted.projectContext || !trusted.context || !trusted.sourcePrivateCaptured || trusted.sourceProblems.length || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.userId !== captured.actorUserId || trusted.principal.streamId !== `creative:${captured.actorUserId}`
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== captured.actorUserId) return fail("sponsor_issuer_scope_unsupported");
  const approved = await guarded(current, () => loadApprovedSponsorSceneCampaign(captured.request, guardedEnv(captured.env, captured.database, current), campaignId));
  if (approved.actor.userId !== captured.actorUserId || driverCommand.reviewedPolicyDigest !== approved.policyDigest) return fail("sponsor_issuer_authority_changed");
  const sessionDigest = await guarded(current, () => sponsorPrincipalDigest(approved.actor));
  const limitsDigest = await guarded(current, () => digest(approved.policy.resources));
  const resourceAssertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_policies resources
    WHERE resources.campaign_id=? AND resources.enabled=1 AND resources.limits_digest=? AND resources.limits_json=?
      AND ?<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND ?>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`,
    bindings: [campaignId, limitsDigest, canonicalJson(approved.policy.resources), approved.policy.resources.startsAtMs, approved.policy.resources.expiresAtMs],
    deadlineMs: approved.policy.resources.expiresAtMs };
  const prepared = await guarded(current, () => preparationProofs(trusted, driverCommand, approved, sessionDigest, current));
  const state: State = { ...captured, driverCommand, approved, resourceAssertion, sessionDigest, ...prepared };
  await prove(state, [...approved.assertions, resourceAssertion, ...captured.capturedAssertions, ...prepared.driverAssertions, ...sponsorCurrentSourceAssertions(trusted)], current);
  current();
  const authority = Object.freeze({}) as SponsorSceneIssuerAuthority;
  issuers.set(authority, state); stateFor(authority, trusted); return authority;
}

type IntentProof = { sourceRevision: number; offered: Record<string, unknown>; assertion: OutputSqlAssertion };
/** This is retained original quote/plan data, never a native source recapture. */
async function issuerNativeIntentProof(trusted: OutputTrustedContext, command: Record<string, unknown>, requested: SponsorSceneRunCommand, current: Guard): Promise<IntentProof> {
  const sql = `SELECT preflight.plan_revision_id,preflight.event_id,preflight.terms_digest,preflight.expires_at,quote.private_json AS quote_json,
    plan.confirmed_event_id,plan.source_head,body.private_json AS plan_json
    FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
    JOIN event_private_payloads quote ON quote.private_event_id=preflight.event_id AND quote.owner_id=plan.owner_user_id AND quote.project_id=plan.project_id AND quote.document_id=plan.document_id AND quote.redacted_at IS NULL
    JOIN event_private_payloads body ON body.private_event_id=plan.confirmed_event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
    WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
      AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?
      AND length(CAST(quote.private_json AS BLOB))<=524288 AND length(CAST(body.private_json AS BLOB))<=524288
      AND NOT EXISTS(SELECT 1 FROM output_plan_revisions newer WHERE newer.scope_key=plan.scope_key AND newer.revision>plan.revision)`;
  const bindings = [trusted.scope.key, requested.preflightId, trusted.scope.actorUserId, trusted.scope.ownerUserId, trusted.scope.projectId,
    trusted.scope.documentId, trusted.sourceDigest, trusted.requirementsDigest];
  const row = await guarded(current, () => trusted.env.DB.prepare(sql).bind(...bindings).first<{ plan_revision_id: string; event_id: string; terms_digest: string;
    expires_at: string; quote_json: string; confirmed_event_id: string; source_head: number; plan_json: string }>());
  if (!row || row.plan_revision_id !== requested.planRevisionId || row.terms_digest !== command.termsDigest || !(Date.parse(row.expires_at) > Date.now())) return fail("sponsor_issuer_intent_mismatch");
  const quoteBody = rememberOutputPrivateBody(trusted.scope, row.event_id, row.quote_json), planBody = rememberOutputPrivateBody(trusted.scope, row.confirmed_event_id, row.plan_json);
  const quote = record(quoteBody.preflight) ? quoteBody.preflight : null, confirmed = record(planBody.confirmed_plan) ? planBody.confirmed_plan : null;
  const plan = confirmed && record(confirmed.plan) ? confirmed.plan : null;
  const offered = quote && Array.isArray(quote.targets) && quote.targets.length === 1 && record(quote.targets[0]) ? quote.targets[0] : null;
  const target = plan && Array.isArray(plan.targets) && plan.targets.length === 1 && record(plan.targets[0]) ? plan.targets[0] : null;
  const settings = offered && record(offered.settings) ? offered.settings : null, payload = settings && record(settings.payload) ? settings.payload : null;
  const scene = payload && record(payload.outputScene) ? payload.outputScene : null;
  if (!quote || quote.id !== requested.preflightId || quote.planRevisionId !== requested.planRevisionId || quote.termsDigest !== requested.termsDigest
    || quote.expiresAt !== row.expires_at || quote.maximumMicrousd !== requested.maximumMicrousd || quote.maximumCalls !== 1
    || quote.sourceDigest !== trusted.sourceDigest || quote.requirementsDigest !== trusted.requirementsDigest
    || confirmed?.revisionId !== requested.planRevisionId || confirmed.sourceDigest !== trusted.sourceDigest || confirmed.requirementsDigest !== trusted.requirementsDigest
    || offered?.targetId !== requested.targetId || offered.available !== true || offered.maximumMicrousd !== requested.maximumMicrousd
    || !target || target.id !== requested.targetId || target.selected !== true || !record(target.scene_contract)
    || !Array.isArray(target.blocking_issues) || target.blocking_issues.length || !scene
    || !record(scene.sceneContract) || !captureExperienceSceneTarget(target, scene.sceneContract.source)
    || canonicalJson(target.scene_contract) !== canonicalJson(scene.sceneContract)
    || ["narrative_contract", "audio_contract", "video_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(target, key))
    || !record(quote.operationAttempts) || Object.keys(quote.operationAttempts).length !== 1
    || canonicalJson(quote.operationAttempts[requested.targetId]) !== canonicalJson({ ordinal: 0, previousSlotId: null })
    || !sceneMiniAppCostApprovalMatches(command.sceneCostConsent, scene.costPreview)) return fail("sponsor_issuer_intent_mismatch");
  const { termsDigest, ...terms } = quote;
  if (await guarded(current, () => outputDigest(terms)) !== termsDigest) return fail("sponsor_issuer_intent_mismatch");
  return { sourceRevision: row.source_head, offered,
    assertion: { sql: `EXISTS(SELECT 1 FROM (${sql}) captured WHERE plan_revision_id=? AND event_id=? AND terms_digest=? AND expires_at=?
      AND quote_json=? AND confirmed_event_id=? AND source_head=? AND plan_json=?)`,
    bindings: [...bindings, row.plan_revision_id, row.event_id, row.terms_digest, row.expires_at, row.quote_json, row.confirmed_event_id, row.source_head, row.plan_json],
    deadlineMs: Math.min(Date.parse(row.expires_at), Date.parse(requested.sceneCostConsent.expiresAt)) } };
}

/** Original authorization is inert data. No native preparation/descriptor is
 * invoked here, and neither expectedRevision nor original consent is renewed. */
async function originalAdmission(state: State, trusted: OutputTrustedContext, command: Record<string, unknown>, grantId: string,
  compiled: Awaited<ReturnType<typeof compileSponsorSceneEnvelope>>, intent: IntentProof, current: Guard): Promise<{ receipt: OutputCommandReceipt; assertions: OutputSqlAssertion[] } | null> {
  const { policy, envelope, envelopeDigest, policyDigest } = compiled;
  const marker = { envelope_digest: envelopeDigest, policy_digest: policyDigest, consumption_id: envelope.consumptionId, campaign_id: policy.campaignId, payer_user_id: policy.payerUserId };
  const nativeCommand = { ...command, sponsor_entitlement: marker }, nativeDigest = await guarded(current, () => outputDigest({ ...command, sponsor_entitlement: marker }));
  const receipt = await guarded(current, () => readOutputCommand(guardedEnv(state.env, state.database, current), trusted.scope, String(command.clientMutationId), nativeDigest));
  if (!receipt) {
    const unknown = await guarded(current, () => state.database.prepare(`SELECT
      EXISTS(SELECT 1 FROM experience_sponsor_consumptions WHERE grant_id=?) OR
      EXISTS(SELECT 1 FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?) AS present`)
      .bind(grantId, trusted.scope.key, state.actorUserId, String(command.clientMutationId)).first<{ present: number }>());
    if (!unknown || own(unknown, "present") !== 0) return fail("sponsor_issuer_original_unavailable");
    return null;
  }
  const target = Array.isArray(receipt.payload.authorized_targets) && receipt.payload.authorized_targets.length === 1 && record(receipt.payload.authorized_targets[0])
    ? receipt.payload.authorized_targets[0] : null;
  if (receipt.action !== "authorize" || !id(receipt.payload.grant_id) || !target || target.target_id !== state.driverCommand.targetId
    || !id(target.operation_slot_id) || !id(target.job_id) || target.route_digest !== envelope.recipe.routeDigest.slice(7)
    || receipt.payload.plan_revision_id !== state.driverCommand.planRevisionId || receipt.payload.preflight_id !== command.preflightId
    || receipt.payload.source_digest !== trusted.sourceDigest || receipt.payload.maximum_calls !== 1
    || receipt.payload.maximum_microusd !== envelope.recipe.maximumMicrousd
    || canonicalJson(receipt.payload.output_command_envelope) !== canonicalJson(nativeCommand)) return fail("sponsor_issuer_original_unavailable");
  const offeredSettings = record(intent.offered.settings) ? intent.offered.settings : null;
  const offeredPayload = offeredSettings && record(offeredSettings.payload) ? offeredSettings.payload : null;
  const offeredScene = offeredPayload && record(offeredPayload.outputScene) ? offeredPayload.outputScene : null;
  const originalPreview = offeredScene && record(offeredScene.costPreview) ? offeredScene.costPreview : null;
  if (offeredPayload?.sceneRequestId !== target.job_id || originalPreview?.requestId !== target.job_id) return fail("sponsor_issuer_original_unavailable");
  const matches = await guarded(current, () => Promise.all(policy.templates.map(async template =>
    await digest(template) === envelope.templateDigest && await matchSponsorSceneTemplate(template, { recipe: envelope.recipe, offered: intent.offered }))));
  if (!matches.some(Boolean)) return fail("sponsor_issuer_original_unavailable");
  const settings = intent.offered.settings;
  if (await guarded(current, () => digest({ snapshot: trusted.context!.snapshot, settings })) !== envelope.compiledInputDigest
    || await guarded(current, () => digest({ sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, settings })) !== envelope.transferEnvelopeDigest)
    return fail("sponsor_issuer_original_unavailable");
  const execution: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_execution_grants execution
    JOIN output_operation_slots slot ON slot.scope_key=execution.scope_key AND slot.grant_id=execution.grant_id
    WHERE execution.scope_key=? AND execution.grant_id=? AND execution.actor_user_id=? AND execution.payer_user_id=?
      AND execution.authorization_event_id=? AND execution.context_id IS NULL AND execution.maximum_calls=1
      AND execution.plan_revision_id=? AND execution.preflight_id=? AND execution.maximum_microusd=slot.maximum_microusd
      AND slot.plan_revision_id=execution.plan_revision_id AND slot.target_id=? AND slot.slot_id=? AND slot.job_id=?
      AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
      AND (SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1)`,
    bindings: [trusted.scope.key, receipt.payload.grant_id, state.actorUserId, envelope.payerUserId, receipt.eventId, state.driverCommand.planRevisionId,
      String(command.preflightId), state.driverCommand.targetId, target.operation_slot_id, target.job_id] };
  const lineage: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_operation_slots slot JOIN document_jobs job ON job.job_id=slot.job_id
    JOIN experience_sponsor_consumptions used ON used.job_id=job.job_id
    WHERE slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.job_id=? AND slot.source_digest=?
      AND job.kind='render_document' AND job.source_surface='outputs' AND job.owner_id=? AND job.document_id=? AND job.stream_id=?
      AND used.consumption_id=? AND used.grant_id=? AND used.campaign_id=? AND used.actor_user_id=?
      AND used.session_digest=? AND used.intent_key=? AND used.envelope_digest=? AND used.maximum_microusd=slot.maximum_microusd)`,
    bindings: [trusted.scope.key, target.operation_slot_id, receipt.payload.grant_id, target.job_id, trusted.sourceDigest,
      state.actorUserId, state.documentId, `creative:${state.actorUserId}`, envelope.consumptionId, grantId, envelope.campaignId,
      state.actorUserId, envelope.sessionDigest, envelope.intentKey, envelopeDigest] };
  const sceneJob: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.document_id=?
    AND json_extract(job.request_json,'$.artifactKind')='scene' AND job.scene_source_protocol=1
    AND job.scene_source_version_json IS NOT NULL AND length(CAST(job.scene_source_version_json AS BLOB))<=16384
    AND json_extract(job.scene_source_version_json,'$.version')=1
    AND json_extract(job.scene_source_version_json,'$.phase') IN('admission','run','execution')
    AND json_type(job.scene_source_version_json,'$.eventIds')='array' AND json_type(job.scene_source_version_json,'$.eventSequences')='array'
    AND json_array_length(job.scene_source_version_json,'$.eventIds') BETWEEN 1 AND 64
    AND json_array_length(job.scene_source_version_json,'$.eventIds')=json_array_length(job.scene_source_version_json,'$.eventSequences'))`,
    bindings: [target.job_id, state.actorUserId, state.documentId] };
  // Terminal jobs retain their latest native witness. Prove its immutable
  // identity without demanding that an old successor still be current.
  const witnessIdentity: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM document_jobs job
    JOIN output_operation_slots slot ON slot.job_id=job.job_id WHERE job.job_id=? AND slot.scope_key=? AND slot.slot_id=?
    AND json_extract(job.scene_source_version_json,'$.scopeKey')=slot.scope_key
    AND json_extract(job.scene_source_version_json,'$.slotId')=slot.slot_id
    AND json_extract(job.scene_source_version_json,'$.grantId')=slot.grant_id
    AND json_extract(job.scene_source_version_json,'$.planRevisionId')=slot.plan_revision_id
    AND json_extract(job.scene_source_version_json,'$.targetId')=slot.target_id
    AND json_extract(job.scene_source_version_json,'$.routeDigest')=slot.route_digest
    AND json_extract(job.scene_source_version_json,'$.sourceDigest')=slot.source_digest
    AND json_extract(job.scene_source_version_json,'$.jobId')=job.job_id
    AND json_extract(job.scene_source_version_json,'$.ownerId')=job.owner_id
    AND json_extract(job.scene_source_version_json,'$.actorId')=?
    AND json_extract(job.scene_source_version_json,'$.projectId')=?
    AND json_extract(job.scene_source_version_json,'$.documentId')=job.document_id
    AND json_extract(job.scene_source_version_json,'$.streamId')=job.stream_id
    AND json_extract(job.scene_source_version_json,'$.correlationId')=job.correlation_id)`,
    bindings: [target.job_id, trusted.scope.key, target.operation_slot_id, state.actorUserId, trusted.scope.projectId] };
  const route: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_operation_slots slot
    JOIN output_operation_routes route ON route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id AND route.stage_key='planning:0:initial'
    WHERE slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.job_id=? AND slot.route_digest=?
      AND slot.provider=? AND slot.model=? AND slot.maximum_calls=1 AND slot.maximum_microusd=? AND slot.maximum_tokens=?
      AND route.provider=slot.provider AND route.model=slot.model AND route.maximum_calls=1
      AND (SELECT COUNT(*) FROM output_operation_routes sibling WHERE sibling.scope_key=slot.scope_key AND sibling.slot_id=slot.slot_id)=1)`,
    bindings: [trusted.scope.key, target.operation_slot_id, receipt.payload.grant_id, target.job_id, envelope.recipe.routeDigest.slice(7),
      envelope.recipe.provider, envelope.recipe.model, envelope.recipe.maximumMicrousd, envelope.recipe.maximumTokens] };
  return { receipt, assertions: [outputCommandReceiptAssertion(trusted.scope, receipt), execution, lineage, sceneJob, witnessIdentity, route] };
}

/** Real atomic issuance: original grant + Resource V1 debit + immutable issuer
 * record. A failed admission never refunds or rewrites consumed preparation. */
export async function issueSponsorSceneGrant(authority: SponsorSceneIssuerAuthority, trusted: OutputTrustedContext, rawCommand: Record<string, unknown>) {
  let captured: unknown; try { captured = captureSponsorSceneJson(rawCommand); } catch { return fail("sponsor_command_invalid"); }
  if (!record(captured) || !exactKeys(captured, authorizeKeys) || captured.action !== "authorize" || captured.explicitAuthorization !== true
    || typeof captured.expectedRevision !== "string" || !/^output:[0-9]+$/u.test(captured.expectedRevision)) return fail("sponsor_command_invalid");
  const command = captured, state = stateFor(authority, trusted), current = () => { stateFor(authority, trusted); };
  const { policy, policyDigest, assertions } = state.approved, requested = state.driverCommand;
  const intentKey = await guarded(current, () => sponsorSceneIssuerIntentKey(requested));
  if (command.clientMutationId !== intentKey || command.documentId !== state.documentId || command.preflightId !== requested.preflightId
    || command.termsDigest !== requested.termsDigest || command.maximumMicrousd !== requested.maximumMicrousd
    || canonicalJson(command.sceneCostConsent) !== canonicalJson(requested.sceneCostConsent)) return fail("sponsor_issuer_intent_mismatch");
  const commandDigest = await guarded(current, () => digest(command)), nativeCommandDigest = await guarded(current, () => outputDigest(command));
  const driverCommandJson = canonicalJson(requested);
  const authorizeStage: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='authorize' AND command_json=? AND command_digest=?)`,
    bindings: [state.driverId, canonicalJson(command), nativeCommandDigest] };
  const base = [...assertions, state.resourceAssertion, ...state.capturedAssertions, ...state.driverAssertions, authorizeStage];
  await prove(state, base, current);
  const existing = await guarded(current, () => state.database.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
    .bind(policy.campaignId, state.actorUserId, intentKey).first<Record<string, string>>());
  const freshPreparation = async (guard: Guard) => guarded(guard, () => outputExperienceCommands.prepareSponsoredSceneAdmission(nativeView(trusted, guard), command));
  const finish = async (row: Record<string, string>, replayed: boolean, prepared?: SceneSponsorAdmissionPreparation) => {
    current();
    if (row.policy_digest !== policyDigest || row.driver_command_json !== driverCommandJson || row.command_digest !== commandDigest) return fail("sponsor_issuer_intent_conflict");
    const intent = await guarded(current, () => issuerNativeIntentProof(trusted, command, requested, current));
    const compiled = await guarded(current, () => compileSponsorSceneEnvelope(policy, JSON.parse(row.envelope_json!)));
    const envelope = compiled.envelope;
    if (!id(row.grant_id) || compiled.envelopeDigest !== row.envelope_digest || envelope.sourceRevision !== intent.sourceRevision
      || envelope.actorUserId !== state.actorUserId || envelope.ownerUserId !== state.actorUserId || envelope.projectId !== trusted.scope.projectId
      || envelope.documentId !== state.documentId || envelope.sourceDigest !== `sha256:${trusted.sourceDigest}` || envelope.sessionDigest !== state.sessionDigest
      || envelope.intentKey !== intentKey) return fail("sponsor_issuer_original_unavailable");
    const originalCurrent = () => { current(); if (Date.now() >= envelope.expiresAtMs) return fail("sponsor_issuer_authority_changed"); };
    originalCurrent();
    const grant: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_grants WHERE grant_id=? AND campaign_id=? AND policy_digest=?
      AND actor_user_id=? AND session_digest=? AND intent_key=? AND envelope_digest=? AND issued_at_ms=? AND expires_at_ms=? AND enabled=1)`,
      bindings: [row.grant_id, policy.campaignId, policyDigest, state.actorUserId, envelope.sessionDigest, intentKey, compiled.envelopeDigest,
        envelope.issuedAtMs, envelope.expiresAtMs], deadlineMs: envelope.expiresAtMs };
    const issuance: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_issuances WHERE grant_id=? AND campaign_id=? AND actor_user_id=?
      AND intent_key=? AND policy_digest=? AND driver_command_json=? AND command_digest=? AND envelope_digest=? AND envelope_json=?)`,
      bindings: [row.grant_id, policy.campaignId, state.actorUserId, intentKey, policyDigest, driverCommandJson, commandDigest, compiled.envelopeDigest, compiled.envelopeJson] };
    const resource = await guarded(originalCurrent, () => prepareSponsorResourcePlan({ limits: policy.resources, campaignId: policy.campaignId, policyDigest,
      actorUserId: state.actorUserId, sessionDigest: state.sessionDigest, intentKey, operation: "issuance", payloadDigest: compiled.envelopeDigest,
      textBytes: state.textBytes, resourceId: `${row.grant_id}:issuance`, issuedGrantId: row.grant_id! }));
    const issued = await guarded(originalCurrent, () => sponsorIssuedAuthorityAssertion({ policy, policyDigest, grantId: row.grant_id!, actorUserId: state.actorUserId,
      sessionDigest: state.sessionDigest, intentKey, envelopeDigest: compiled.envelopeDigest }));
    const proofs = [...base, ...sponsorCurrentSourceAssertions(trusted), intent.assertion, grant, issuance, asAssertion(resource.receiptAssertion), issued];
    const admitted = await guarded(originalCurrent, () => originalAdmission(state, trusted, command, row.grant_id!, compiled, intent, originalCurrent));
    if (admitted) {
      await prove(state, [...proofs, ...admitted.assertions, ...sponsorCurrentSourceAssertions(trusted)], originalCurrent); originalCurrent();
      return { kind: "admitted" as const, policy, envelope, grantId: row.grant_id!, nativeReceipt: admitted.receipt, replayed };
    }
    const unadmitted: OutputSqlAssertion = { sql: `NOT EXISTS(SELECT 1 FROM experience_sponsor_consumptions WHERE grant_id=?)
      AND NOT EXISTS(SELECT 1 FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?)`,
      bindings: [row.grant_id, trusted.scope.key, state.actorUserId, intentKey] };
    const scenePreparation = prepared ?? await freshPreparation(originalCurrent);
    originalCurrent();
    const admissionAuthority = await guarded(originalCurrent, () => createSponsorAdmissionAuthority({ trusted: nativeView(trusted, originalCurrent), command,
      policy, envelope, grantId: row.grant_id!, scenePreparation }));
    await prove(state, [...proofs, unadmitted, ...sponsorCurrentSourceAssertions(trusted)], originalCurrent); originalCurrent();
    return { kind: "issued" as const, policy, envelope, grantId: row.grant_id!, admissionAuthority, replayed };
  };
  const returnCurrent = <T extends { envelope: SponsorEnvelopeV6 }>(value: T): T => { current(); if (Date.now() >= value.envelope.expiresAtMs) return fail("sponsor_issuer_authority_changed"); return value; };
  if (existing) return returnCurrent(await finish(existing, true));
  const intent = await guarded(current, () => issuerNativeIntentProof(trusted, command, requested, current));
  const scenePreparation = await freshPreparation(current);
  const native = await guarded(current, () => requireSceneSponsorAdmissionForEvidence(scenePreparation, nativeView(trusted, current), command));
  const nativeProof = outputScenePreflightProof(native);
  if (!nativeProof?.prepared.sourceVersion || !nativeProof.sourceAssertions.length) return fail("sponsor_scene_original_proof_required");
  const nativeAssertions = structuredClone([...nativeProof.sourceAssertions, ...sceneSourceVersionAssertions(nativeProof.prepared.sourceVersion)]);
  const description = await guarded(current, () => describeSponsorSceneAdmission(nativeView(trusted, current), command, native));
  const evidence = await guarded(current, () => readSponsorSceneTemplateEvidence(nativeView(trusted, current), command, description.recipe, native));
  const matches = await guarded(current, () => Promise.all(policy.templates.map(template => matchSponsorSceneTemplate(template, evidence))));
  const template = policy.templates[matches.findIndex(Boolean)];
  if (!template || description.actorUserId !== state.actorUserId || description.sessionDigest !== state.sessionDigest || description.sourceRevision !== intent.sourceRevision)
    return fail("sponsor_campaign_template_mismatch");
  const clock = await guarded(current, () => state.database.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now_ms").first<{ now_ms: number }>());
  if (!clock || !Number.isSafeInteger(own(clock, "now_ms"))) return fail("sponsor_database_clock_unavailable");
  const stable = (await guarded(current, () => digest({ campaignId: policy.campaignId, actorUserId: state.actorUserId, intentKey }))).slice(7), grantId = `sponsor-scene-issued-${stable}`;
  const { preflightExpiresAtMs, ...nativeDescription } = description;
  const templateDigest = await guarded(current, () => digest(template));
  const envelope: SponsorEnvelopeV6 = { version: 6, family: "canonical-scene-screenplay@1", campaignId: policy.campaignId, policyVersion: policy.policyVersion,
    payerUserId: policy.payerUserId, consumptionId: `sponsor-scene-consume-${stable}`, intentKey, ...nativeDescription, templateDigest,
    issuedAtMs: clock.now_ms, expiresAtMs: Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, preflightExpiresAtMs, clock.now_ms + policy.maximumGrantLifetimeMs) };
  const compiled = await guarded(current, () => compileSponsorSceneEnvelope(policy, envelope));
  const resource = await guarded(current, () => prepareSponsorResourcePlan({ limits: policy.resources, campaignId: policy.campaignId, policyDigest,
    actorUserId: state.actorUserId, sessionDigest: state.sessionDigest, intentKey, operation: "issuance", payloadDigest: compiled.envelopeDigest,
    textBytes: state.textBytes, resourceId: `${grantId}:issuance`, issuedGrantId: grantId }));
  const issued = await guarded(current, () => sponsorIssuedAuthorityAssertion({ policy, policyDigest, grantId, actorUserId: state.actorUserId,
    sessionDigest: state.sessionDigest, intentKey, envelopeDigest: compiled.envelopeDigest }));
  await guarded(current, () => requireSceneSponsorAdmissionForEvidence(scenePreparation, nativeView(trusted, current), command));
  beforeDeadline([...base, ...nativeAssertions, intent.assertion, { sql: "1", deadlineMs: envelope.expiresAtMs }]);
  try {
    await commit(state, [
      ...[...base, ...nativeAssertions, ...sponsorCurrentSourceAssertions(trusted), intent.assertion].flatMap(proof => outputAssertionStatements(state.env, proof)),
      state.database.prepare("INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)")
        .bind(grantId, policy.campaignId, policyDigest, state.actorUserId, state.sessionDigest, intentKey, compiled.envelopeDigest, envelope.issuedAtMs, envelope.expiresAtMs),
      ...resource.statements.map(statement => state.database.prepare(statement.sql).bind(...statement.bindings)),
      state.database.prepare("INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(grantId, policy.campaignId, state.actorUserId, intentKey, policyDigest, driverCommandJson, commandDigest, compiled.envelopeDigest, compiled.envelopeJson),
      ...outputAssertionStatements(state.env, issued),
    ], current);
  } catch (error) {
    // A malformed acknowledgment or failed lifetime check is an observed
    // rejection, not a transport-level lost acknowledgment to recover.
    if (error instanceof SponsorEntitlementError) throw error;
    // Only an exact durable original can recover a lost ACK. No new time,
    // intent, resource debit or native authorization is manufactured here.
    const original = await guarded(current, () => state.database.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
      .bind(policy.campaignId, state.actorUserId, intentKey).first<Record<string, string>>());
    if (!original) throw error;
    return returnCurrent(await finish(original, true));
  }
  return returnCurrent(await finish({ grant_id: grantId, policy_digest: policyDigest, driver_command_json: driverCommandJson, command_digest: commandDigest,
    envelope_digest: compiled.envelopeDigest, envelope_json: compiled.envelopeJson }, false, scenePreparation));
}
