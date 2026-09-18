import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileSponsorEnvelope, SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { readSponsorStoryDriverCommand } from "./experience-sponsor-story-issuer.ts";
import { authorizationQuery, hostedIdentity, readNativeRetainedPrincipal } from "./native-retained-text-custody.ts";
import { SponsorNativeImageReadBudget } from "./experience-sponsor-native-image-budget.ts";
import type { WorkerEnv } from "./runtime.ts";

type Row = Record<string, unknown>;
export type SponsorStoryReadAssertion = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const boundedText = (column: string, maximum: number) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum} AND instr(${column},char(0))=0 THEN ${column} END`;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function sponsorStoryReadConjunction(terms: readonly string[]): string {
  if (!terms.length) return "1";
  if (terms.length === 1) return terms[0]!;
  const middle = Math.ceil(terms.length / 2);
  return `(${sponsorStoryReadConjunction(terms.slice(0, middle))} AND ${sponsorStoryReadConjunction(terms.slice(middle))})`;
}
const lineageCells = ["job.document_id", "job.stream_id", "job.correlation_id", "plan.project_id", "plan.source_digest", "slot.scope_key", "slot.slot_id",
  "slot.route_digest", "slot.model", "execution.grant_id", "execution.payer_user_id", "used.consumption_id", "used.campaign_id", "used.envelope_digest",
  "used.session_digest", "used.intent_key", "issued.grant_id", "issued.policy_digest", "plan.plan_revision_id", "slot.target_id"];

// Immutable original provenance, never a current generation authorization. No
// prompt, plan body, provider response, financial hold or creative output is read.
const ORIGINAL_FROM = `FROM document_jobs job
 JOIN output_operation_slots slot ON slot.job_id=job.job_id
 JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN output_commands native_command ON native_command.scope_key=execution.scope_key AND native_command.event_id=execution.authorization_event_id
 JOIN experience_sponsor_consumptions used ON used.job_id=job.job_id AND used.actor_user_id=job.owner_id
 JOIN experience_sponsor_grants issued ON issued.grant_id=used.grant_id AND issued.campaign_id=used.campaign_id
 JOIN experience_sponsor_issuances issuance ON issuance.grant_id=issued.grant_id AND issuance.campaign_id=issued.campaign_id
 JOIN experience_sponsor_approvals approval ON approval.campaign_id=issued.campaign_id AND approval.policy_digest=issued.policy_digest
 WHERE ${sponsorStoryReadConjunction([
  "job.job_id=?", "job.owner_id=?", "job.stream_id='creative:'||job.owner_id", "job.kind='render_document'", "job.source_surface='outputs'",
  "plan.scope_kind='personal'", "plan.owner_user_id=job.owner_id", "plan.document_id=job.document_id", "plan.organization_id IS NULL", "plan.project_access_id IS NULL",
  "execution.actor_user_id=job.owner_id", "execution.payer_user_id<>job.owner_id", "execution.context_id IS NULL", "execution.plan_revision_id=slot.plan_revision_id",
  "native_command.actor_user_id=job.owner_id", "native_command.action='authorize'", "native_command.command_key=issued.intent_key",
  "slot.attempt_ordinal=0", "slot.previous_slot_id IS NULL", "slot.source_digest=plan.source_digest", "slot.provider='openai'",
  "slot.maximum_calls=1", "execution.maximum_calls=1", "slot.maximum_tokens=128000",
  "(SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1",
  "(SELECT COUNT(*) FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id)=1",
  "EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id AND route.stage_key='planning:0:initial' AND route.provider=slot.provider AND route.model=slot.model AND route.maximum_calls=1)",
  "issued.actor_user_id=used.actor_user_id", "issued.intent_key=used.intent_key", "issued.session_digest=used.session_digest", "issued.envelope_digest=used.envelope_digest",
  "issuance.actor_user_id=used.actor_user_id", "issuance.intent_key=used.intent_key", "issuance.envelope_digest=used.envelope_digest", "issuance.policy_digest=issued.policy_digest",
  "approval.payer_user_id=execution.payer_user_id", "approval.approved_by_user_id=approval.payer_user_id", "slot.maximum_microusd=used.maximum_microusd", "execution.maximum_microusd=slot.maximum_microusd",
  ...lineageCells.map(cell => `(typeof(${cell})='text' AND length(CAST(${cell} AS BLOB))<=4096 AND instr(${cell},char(0))=0)`),
  "(slot.outcome_event_id IS NULL OR typeof(slot.outcome_event_id)='text' AND length(CAST(slot.outcome_event_id AS BLOB))<=200)",
  "NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=plan.project_id)",
  "NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='document' AND resource_id=job.document_id) OR (resource_kind='job' AND resource_id=job.job_id))",
 ])}`;

// A missing transport acknowledgment is not a successful SQL witness. Iterate
// every expected own index; Array.some/every skip sparse array holes.
function witnessed(rows: unknown, count: number): boolean {
  if (!Array.isArray(rows) || rows.length !== count) return false;
  for (let index = 0; index < count; index++) {
    if (!Object.hasOwn(rows, index)) return false;
    const result = rows[index];
    if (!record(result) || !Object.hasOwn(result, "success") || result.success !== true
      || !Array.isArray(result.results) || result.results.length !== 1 || !Object.hasOwn(result.results, 0)) return false;
    const row = result.results[0];
    if (!record(row) || Object.keys(row).length !== 1 || !Object.hasOwn(row, "current") || row.current !== 1) return false;
  }
  return true;
}

declare const readAuthority: unique symbol;
/** This seal admits resource accounting only, never retained creative bytes. */
export type SponsorStoryReadAuthority = Readonly<{ [readAuthority]: true }>;
type Facts = Readonly<{ actorUserId: string; campaignId: string; jobId: string; policyDigest: string; projectId: string; documentId: string;
  streamId: string; correlationId: string; slotId: string; scopeKey: string; outcomeEventId: string | null; controlBytes: number;
  assertions: readonly SponsorStoryReadAssertion[] }>;
type State = { request: Request; env: WorkerEnv; database: WorkerEnv["DB"]; headers: string; facts: Facts };
const authorities = new WeakMap<SponsorStoryReadAuthority, State>();
const requestIdentity = (request: Request, env: WorkerEnv) => canonicalJson({ method: request.method, url: request.url, identity: hostedIdentity(request), cookie: request.headers.get("cookie"),
  cohort: env.FORMA_PILOT_COHORT_ID ?? null, admins: env.FORMA_ADMIN_EMAILS ?? null });

/** Canonical, existing owner plus exact historical V4 lineage. The native
 * retained reader must separately establish current Document/revision custody.
 * Control reads have a hard technical bound and are charged to the eventual
 * request ticket by their actual returned JSON bytes; they are not a read grant. */
export async function identifySponsorStoryRead(request: Request, env: WorkerEnv, raw: unknown): Promise<SponsorStoryReadAuthority> {
  if (request.method !== "GET" || jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["jobId"]) || !id(raw.jobId)) return fail("sponsor_story_read_request_invalid");
  if (env.FORMA_PILOT_COHORT_ID?.trim()) return fail("sponsor_story_read_personal_principal_required");
  const database = env.DB, identity = hostedIdentity(request), headers = requestIdentity(request, env), jobId = raw.jobId;
  if (!identity) return fail("sponsor_story_read_personal_principal_required");
  const control = new SponsorNativeImageReadBudget(2_000_000, performance.now() + 30_000, request.signal);
  let controlBytes = 0;
  const current = () => { control.check(); if (env.DB !== database || requestIdentity(request, env) !== headers) return fail("sponsor_story_read_authority_changed"); };
  const run = async <T>(work: () => Promise<T>, account = true): Promise<T> => {
    current(); const value = await control.wait(work()); current(); if (account) { control.account(value); controlBytes += bytes(value); } return value;
  };
  // The unchanged native authorization query bounds auth_json before transport.
  // readNativeRetainedPrincipal does no schema/account/identity mutation.
  const principal = await run(() => readNativeRetainedPrincipal({ ...env, DB: database }, identity), false);
  control.account(principal.principal); controlBytes += bytes(principal.principal);
  current();
  const rows = await run(() => database.prepare(`SELECT job.document_id,job.stream_id,job.correlation_id,plan.project_id,plan.source_digest,plan.source_head,
    plan.plan_revision_id,slot.target_id,slot.scope_key,slot.slot_id,slot.outcome_event_id,slot.route_digest,slot.model,slot.maximum_tokens,slot.maximum_microusd,
    execution.grant_id AS execution_grant_id,execution.payer_user_id,used.consumption_id,used.campaign_id,used.envelope_digest,used.session_digest,used.intent_key,
    issued.grant_id AS issued_grant_id,issued.policy_digest,${boundedText("issuance.envelope_json", 131072)} AS envelope_json,
    ${boundedText("approval.policy_json", 262144)} AS policy_json,${boundedText("issuance.driver_command_json", 4096)} AS driver_command_json
    ${ORIGINAL_FROM} LIMIT 2`).bind(jobId, identity.userId).all<Row>());
  if (!rows.success || rows.results.length !== 1) return fail("sponsor_story_read_original_unavailable");
  const original = rows.results[0]!;
  if (![original.envelope_json, original.policy_json, original.driver_command_json].every(value => typeof value === "string")) return fail("sponsor_story_read_original_unavailable");
  let compiled: Awaited<ReturnType<typeof compileSponsorEnvelope>>, driver: ReturnType<typeof readSponsorStoryDriverCommand>;
  try {
    compiled = await run(() => compileSponsorEnvelope(JSON.parse(String(original.policy_json)), JSON.parse(String(original.envelope_json))), false);
    driver = readSponsorStoryDriverCommand(JSON.parse(String(original.driver_command_json)));
  } catch { return fail("sponsor_story_read_original_unavailable"); }
  const e = compiled.envelope, recipe = e.recipe;
  if (compiled.policy.version !== 4 || e.version !== 4 || compiled.policyDigest !== original.policy_digest || compiled.envelopeDigest !== original.envelope_digest
    || e.actorUserId !== identity.userId || e.ownerUserId !== identity.userId || e.campaignId !== original.campaign_id
    || e.consumptionId !== original.consumption_id || e.sessionDigest !== original.session_digest || e.intentKey !== original.intent_key
    || e.payerUserId !== original.payer_user_id || e.projectId !== original.project_id || e.documentId !== original.document_id
    || e.sourceDigest !== `sha256:${original.source_digest}` || e.sourceRevision !== original.source_head
    || driver.documentId !== e.documentId || driver.campaignId !== e.campaignId || driver.planRevisionId !== original.plan_revision_id || driver.targetId !== original.target_id
    || recipe.appId !== "short-story" || recipe.outputKind !== "short_story" || recipe.outputCount !== 1 || recipe.provider !== "openai"
    || recipe.model !== original.model || recipe.routeDigest !== `sha256:${original.route_digest}` || recipe.maximumTokens !== original.maximum_tokens
    || recipe.maximumMicrousd !== original.maximum_microusd || recipe.calls.parsing !== 0 || recipe.calls.planning !== 1 || recipe.calls.render !== 0 || recipe.calls.repair !== 0)
    return fail("sponsor_story_read_original_changed");
  const policy = compiled.policy, auth = authorizationQuery(env, identity);
  const assertions: SponsorStoryReadAssertion[] = [
    { sql: `EXISTS(WITH ${auth.cte} SELECT 1 FROM authorized WHERE auth_json=?)`, bindings: [...auth.bindings, principal.principal.auth_json] },
    { sql: `EXISTS(SELECT 1 ${ORIGINAL_FROM} AND ${sponsorStoryReadConjunction([
      "job.document_id=?", "job.stream_id=?", "job.correlation_id=?", "plan.project_id=?", "plan.plan_revision_id=?", "slot.target_id=?",
      "slot.scope_key=?", "slot.slot_id=?", "slot.outcome_event_id IS ?", "execution.grant_id=?", "issued.grant_id=?", "used.consumption_id=?", "used.campaign_id=?",
      "issued.policy_digest=?", "issuance.envelope_json=?", "approval.policy_json=?", "issuance.driver_command_json=?",
      "slot.route_digest=?", "slot.model=?", "slot.maximum_tokens=?", "slot.maximum_microusd=?", "execution.payer_user_id=?", "plan.source_digest=?", "plan.source_head=?",
    ])})`, bindings: [jobId, identity.userId, e.documentId, String(original.stream_id), String(original.correlation_id), e.projectId,
      driver.planRevisionId, driver.targetId, String(original.scope_key), String(original.slot_id), original.outcome_event_id === null ? null : String(original.outcome_event_id),
      String(original.execution_grant_id), String(original.issued_grant_id), e.consumptionId, e.campaignId, compiled.policyDigest,
      String(original.envelope_json), String(original.policy_json), String(original.driver_command_json), String(original.route_digest), recipe.model,
      recipe.maximumTokens, recipe.maximumMicrousd, e.payerUserId, String(original.source_digest), e.sourceRevision] },
  ];
  const issued = await run(() => sponsorIssuedAuthorityAssertion({ policy, policyDigest: compiled.policyDigest, grantId: String(original.issued_grant_id),
    actorUserId: identity.userId, sessionDigest: e.sessionDigest, intentKey: e.intentKey, envelopeDigest: compiled.envelopeDigest }), false);
  assertions.push({ sql: issued.sql, bindings: [...(issued.bindings ?? [])] });
  const witnesses = await run(() => database.batch(assertions.map(proof => database.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...proof.bindings))));
  if (!witnessed(witnesses, assertions.length)) return fail("sponsor_story_read_authority_changed");
  current();
  const authority = Object.freeze({}) as SponsorStoryReadAuthority;
  authorities.set(authority, { request, env, database, headers, facts: freeze({ actorUserId: identity.userId, campaignId: e.campaignId, jobId,
    policyDigest: compiled.policyDigest, projectId: e.projectId, documentId: e.documentId, streamId: String(original.stream_id), correlationId: String(original.correlation_id),
    slotId: String(original.slot_id), scopeKey: String(original.scope_key), outcomeEventId: original.outcome_event_id === null ? null : String(original.outcome_event_id), controlBytes, assertions }) });
  return authority;
}

export function requireSponsorStoryReadAuthority(authority: SponsorStoryReadAuthority, request: Request, env: WorkerEnv): Facts {
  const state = authorities.get(authority);
  if (!state || state.request !== request || state.env !== env || state.database !== env.DB || request.signal.aborted
    || requestIdentity(request, env) !== state.headers) return fail("sponsor_story_read_authority_unavailable");
  return freeze(structuredClone(state.facts));
}
