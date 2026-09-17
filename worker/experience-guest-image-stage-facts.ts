import { canonicalJson, digest, exactKeys, record } from "../src/experiences/compiler.ts";
import { foldEvents } from "../src/model/events.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import { outputRequirementInterpretationNeedsReview } from "../src/model/output-requirements.ts";
import type { OutputPreflight } from "../src/model/output-delivery-contract.ts";
import { authoritativeCreativeContext } from "./context-authority.ts";
import { publicEventPayload } from "./event-privacy.ts";
import type { EventRow } from "./event-write-primitives.ts";
import { collectRetainedGuestImageHistory, collectDueGuestImageHistory, current, json, flatRow,
  bytes, integer, iso, uuid, eventWitness, eventColumns, bodyColumns, commandColumns, resourceColumns,
  nativeBranches, unsupportedIdentityJson, boundedIdentityValue, type Context, type Proof, type Row, type Value } from "./experience-guest-image-history.ts";
import { GUEST_DB_NOW, guestHash } from "./experience-guest-session.ts";
import { experienceOutputEnvelope, type ExperienceOutputBinding } from "./experience-output-binding.ts";
import { matchExperienceOutputRecipeTarget } from "./experience-output-recipe.ts";
import { guestImageStageConfirmedPlan, guestImageStageNativePayload, guestImageStagePlanRows, guestImageStageIntentRow,
  guestImageStageQuoteRow, guestImageStageQuoteShape, guestImageStageQuoteRecipe } from "./experience-guest-image-stage-contract.ts";
import { sponsorImageTextSource } from "./experience-sponsor-image-format.ts";
import { outputDigest } from "./output-disclosure-proof.ts";
import { outputTargetContractDigest } from "./output-requirements-api.ts";
import { outputRequirements, outputSourceDigests } from "./output-trusted-context.ts";

export type History = Awaited<ReturnType<typeof collectRetainedGuestImageHistory>> | Awaited<ReturnType<typeof collectDueGuestImageHistory>>;
export type GuestImageHistoricalStage = "confirmed" | "preflight-claimed-unknown" | "quoted";
export type Tail = { eventId: string; row: Row; observed: string; payload: Record<string, unknown> | null };
export const fail = (part = "unavailable"): never => { throw new Error(`guest_image_stage_inventory_${part}`); };
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const objectSql = (columns: readonly string[], alias = "") => {
  const first = columns.slice(0, 15), rest = columns.slice(15);
  const base = `json_object(${first.flatMap(key => [`'${key}'`, `${alias}${key}`]).join(",")})`;
  return rest.length ? `json_set(${base},${rest.flatMap(key => [`'$.${key}'`, `${alias}${key}`]).join(",")})` : base;
};
const planColumns = ["scope_key", "scope_kind", "owner_user_id", "project_id", "document_id", "organization_id", "project_access_id",
  "plan_revision_id", "plan_id", "revision", "confirmed_event_id", "requirements_digest", "source_digest", "resolver_version", "source_head", "target_count", "created_at"];
const targetColumns = ["scope_key", "plan_revision_id", "target_id", "target_contract_digest", "media_kind", "required", "selected", "ordinal"];
const quoteColumns = ["scope_key", "preflight_id", "plan_revision_id", "actor_user_id", "terms_digest", "event_id", "expires_at", "created_at"];
const intentColumns = ["driver_id", "campaign_id", "actor_user_id", "session_digest", "intent_key", "document_id", "command_json", "command_digest",
  "source_digest", "requirements_digest", "source_text_bytes", "created_at_ms"];
const stageColumns = ["driver_id", "stage", "command_json", "command_digest"];

/** A malformed/oversized present row is never an absent optional stage. */
async function row(ctx: Context, parts: Proof[], table: string, columns: readonly string[], predicate: string, bindings: Value[], optional = false): Promise<Row | null> {
  const expression = objectSql(columns);
  const bounded = columns.map(key => `(${key} IS NULL OR typeof(${key}) IN('integer','real') OR typeof(${key})='text' AND length(CAST(${key} AS BLOB))<=65536 AND instr(${key},char(0))=0)`).join(" AND ");
  const result = await ctx.db.prepare(`SELECT CASE WHEN ${bounded} THEN ${expression} ELSE NULL END AS witness FROM ${table} WHERE ${predicate} LIMIT 2`)
    .bind(...bindings).all<{ witness: string | null }>(); current(ctx);
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 1) return fail();
  if (!result.results.length) {
    if (!optional) return fail();
    parts.push({ sql: `NOT EXISTS(SELECT 1 FROM ${table} WHERE ${predicate})`, bindings }); return null;
  }
  if (!Object.hasOwn(result.results, 0)) return fail();
  const witness = result.results[0]?.witness;
  if (typeof witness !== "string" || bytes(witness) > 131072) return fail();
  let value: unknown; try { value = JSON.parse(witness); } catch { return fail(); }
  if (!flatRow(value, columns)) return fail();
  parts.push({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${predicate} AND ${expression}=?)`, bindings: [...bindings, witness] });
  return value;
}
function equalRow(actual: Row, expected: object) { if (JSON.stringify(actual) !== JSON.stringify(expected)) return fail(); }
async function checked(ctx: Context, value: unknown) { const result = await outputDigest(value); current(ctx); return result; }
export async function sha(ctx: Context, value: unknown) { const result = await digest(value); current(ctx); return result; }
function bindingFrom(history: History, value: unknown): ExperienceOutputBinding {
  const { original: source } = history;
  if (!record(value) || !exactKeys(value, ["version", "draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash", "output", "projectId", "documentId", "streamId"])
    || value.version !== 1 || value.draftId !== source.draftId || value.draftHash !== source.source.draft_hash
    || value.releaseHash !== source.policy.releaseHash || value.requestHash !== source.source.request_digest || !guestHash(value.sourceBindingHash)
    || value.output !== "image" || value.projectId !== source.projectId || value.documentId !== source.documentId
    || value.streamId !== `creative:${source.session.guest_subject}`) return fail();
  return { version: 1, draftId: value.draftId, draftHash: String(value.draftHash), releaseHash: value.releaseHash,
    requestHash: String(value.requestHash), sourceBindingHash: value.sourceBindingHash, output: "image", projectId: value.projectId,
    documentId: value.documentId, streamId: value.streamId };
}
async function tail(history: History, command: Row, kind: "confirm" | "preflight", minimum: string): Promise<Tail> {
  const { ctx, original, saved, mode } = history, eventId = command.event_id;
  if (!uuid(eventId) || original.eventIds.includes(eventId) || eventId === saved.eventId || !iso(command.created_at)
    || command.created_at < minimum || Date.parse(command.created_at) < saved.minimum || Date.parse(command.created_at) >= saved.maximum) return fail();
  const result = await ctx.db.prepare(`SELECT CASE WHEN typeof(e.payload)='text' AND length(CAST(e.payload AS BLOB))<=65536
    AND typeof(body.private_json)='text' AND length(CAST(body.private_json AS BLOB))<=65536 THEN ${eventWitness} ELSE NULL END AS witness
    FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE e.event_id=?`).bind(eventId).first<{ witness: string | null }>(); current(ctx);
  if (!result || typeof result.witness !== "string") return fail();
  let value: unknown; try { value = JSON.parse(result.witness); } catch { return fail(); }
  if (!flatRow(value, [...eventColumns, ...bodyColumns]) || value.event_id !== eventId || value.stream_id !== `creative:${original.session.guest_subject}`
    || value.sequence !== original.eventIds.length + (kind === "confirm" ? 2 : 3) || value.actor !== original.session.guest_subject
    || value.client_id !== "server:guest-output" || value.correlation_id !== command.command_key || value.causation_id !== null || value.compensates_event_id !== null
    || value.schema_version !== 1 || value.type !== (kind === "confirm" ? "OutputPlanConfirmed" : "OutputPlanPreflighted")
    || value.recorded_at !== command.created_at || value.occurred_at !== value.recorded_at || value.created_at !== value.recorded_at
    || value.owner_id !== original.session.guest_subject || value.project_id !== original.projectId || value.document_id !== original.documentId
    || typeof value.private_json !== "string" || value.redacted_at !== null && (mode !== "due" || !iso(value.redacted_at) || value.private_json !== "")) return fail();
  const payload = value.redacted_at === null ? json(value.private_json) : null;
  if (payload && JSON.stringify(publicEventPayload(eventId, payload, true).payload) !== value.payload) return fail();
  return { eventId, row: value, observed: result.witness, payload };
}
function outputEvent(value: Tail, payload: Record<string, unknown>): EventRow {
  const event = value.row;
  return { eventId: value.eventId, streamId: String(event.stream_id), sequence: Number(event.sequence), occurredAt: String(event.occurred_at),
    recordedAt: String(event.recorded_at), actor: String(event.actor), clientId: String(event.client_id), correlationId: String(event.correlation_id),
    causationId: null, compensatesEventId: null, schemaVersion: 1, type: String(event.type), payload };
}
function assertPublic(value: Tail, payload: Record<string, unknown>) {
  if (JSON.stringify(publicEventPayload(value.eventId, payload, true).payload) !== value.row.payload) return fail();
}
export function guestImageStageClosureRows(history: History) {
  const rows: string[][] = nativeBranches.map(value => [...value]);
  const allowed = new Map([
    ["output_commands", "d.scope_key=s.scope AND d.actor_user_id=s.guest AND d.command_key IN(SELECT value FROM json_each(s.commands))"],
    ["output_plan_revisions", "d.scope_key=s.scope AND d.plan_revision_id=s.plan"],
    ["output_plan_targets", "d.scope_key=s.scope AND d.plan_revision_id=s.plan AND d.target_id=s.target"],
    ["output_preflights", "s.quote IS NOT NULL AND d.scope_key=s.scope AND d.preflight_id=s.quote"],
  ]);
  for (const entry of rows) if (allowed.has(entry[0])) entry[1] = `(${entry[1]}) AND NOT(${allowed.get(entry[0])})`;
  const add = (table: string, predicate: string) => { if (history.sponsor.tables.has(table)) rows.push([table, predicate]); };
  add("experience_sponsor_resource_receipts", "(d.actor_user_id=s.guest OR d.session_digest=s.session) AND d.resource_id NOT IN(SELECT value FROM json_each(s.resources))");
  for (const table of ["experience_sponsor_grants", "experience_sponsor_consumptions"]) add(table, "d.actor_user_id=s.guest OR d.session_digest=s.session");
  add("experience_sponsor_active_jobs", "d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_consumptions used WHERE used.consumption_id=d.consumption_id AND (used.actor_user_id=s.guest OR used.session_digest=s.session))");
  add("experience_sponsor_issuances", `${unsupportedIdentityJson("d.driver_command_json")} OR ${unsupportedIdentityJson("d.envelope_json", ["documentId", "projectId", "ownerUserId", "actorUserId", "payerUserId", "sessionDigest"])}
    OR d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_grants issued WHERE issued.grant_id=d.grant_id AND (issued.actor_user_id=s.guest OR issued.session_digest=s.session))
    OR ${boundedIdentityValue("d.driver_command_json", "documentId")}=s.document OR ${boundedIdentityValue("d.envelope_json", "documentId")}=s.document
    OR ${boundedIdentityValue("d.envelope_json", "projectId")}=s.project OR ${boundedIdentityValue("d.envelope_json", "ownerUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "actorUserId")}=s.guest OR ${boundedIdentityValue("d.envelope_json", "payerUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "sessionDigest")}=s.session`);
  add("experience_sponsor_driver_intents", `(${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver OR d.actor_user_id=s.guest OR d.session_digest=s.session
    OR d.document_id=s.document OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document) AND NOT(d.driver_id=s.driver)`);
  add("experience_sponsor_driver_stages", `(${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver
    OR EXISTS(SELECT 1 FROM experience_sponsor_driver_intents intent WHERE intent.driver_id=d.driver_id AND (intent.actor_user_id=s.guest OR intent.session_digest=s.session OR intent.document_id=s.document))
    OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document) AND NOT(s.claimed=1 AND d.driver_id=s.driver AND d.stage='preflight')`);
  add("experience_sponsor_intakes", "d.actor_user_id=s.guest OR d.session_digest=s.session OR d.draft_id=s.draft OR d.project_id=s.project OR d.document_id=s.document");
  add("experience_sponsor_read_attempts", "d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=d.job_id AND (job.owner_id=s.guest OR job.stream_id=s.stream OR job.document_id=s.document))");
  add("experience_sponsor_intake_read_attempts", "d.actor_user_id=s.guest OR d.resource_key='draft:'||s.draft");
  for (const registry of history.memory.registries) rows.push([registry, "d.user_event_id IN(SELECT value FROM json_each(s.ids)) OR d.answer_event_id IN(SELECT value FROM json_each(s.ids))"]);
  const originalGraphRows = rows.map(value => [...value]);
  const custodyOffset = rows.length;
  for (const table of ["experience_guest_context_adoptions", "experience_guest_image_claims"]) add(table,
    `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])} OR d.session_id=s.sessionId
      OR ${boundedIdentityValue("d.lineage_json", "sessionId")}=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest
      OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document`);
  add("experience_guest_plan_custodies", "d.session_id=s.sessionId OR d.draft_id=s.draft OR d.content_id=s.draft");
  const custodyRows = rows.slice(custodyOffset);
  const leaseRows = [["experience_guest_claim_leases", "d.session_id=s.sessionId"]];
  return { originalGraphRows, custodyRows, leaseRows };
}
export function guestImageStageUnclaimedClosure(facts: { history: History; scope: Record<string, Value> }): Proof {
  const { history, scope } = facts;
  const { originalGraphRows, custodyRows, leaseRows } = guestImageStageClosureRows(history);
  const rows = [...originalGraphRows, ...custodyRows, ...leaseRows];
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, index) => rows.slice(index * 4, index * 4 + 4));
  const names = Object.keys(scope);
  return { sql: `NOT EXISTS(WITH guest_stage_history_input AS(SELECT ? AS value),guest_stage_history_scope AS(
    SELECT ${names.map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM guest_stage_history_input),
    ${groups.map((group, index) => `guest_stage_history_${index} AS MATERIALIZED(${group.map(([table, predicate]) => `SELECT 1 FROM ${table} d,guest_stage_history_scope s WHERE ${predicate}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, index) => `EXISTS(SELECT 1 FROM guest_stage_history_${index})`).join(" OR ")})`, bindings: [JSON.stringify(scope)] };
}

/** Validated historical values and incomplete proof components only. The caller
 * must construct and execute a named full graph proof before disclosure or
 * mutation; this function creates no inventory or custody capability. */
export async function collectGuestImageStageFacts(history: History) {
  const { ctx, original, saved } = history, { source, session, draftId, projectId, documentId, eventIds } = original;
  const parts: Proof[] = [];
  const actorUserId = String(session.guest_subject), scopeKey = saved.scopeKey, sourceHead = eventIds.length, sessionId = String(session.session_id);
  const confirmKey = saved.commandKey.slice(0, -4) + "confirm", preflightKey = saved.commandKey.slice(0, -4) + "preflight";
  const command = await row(ctx, parts, "output_commands", commandColumns, "scope_key=? AND actor_user_id=? AND command_key=?", [scopeKey, actorUserId, confirmKey]);
  if (!command || command.action !== "confirm" || !hash(command.request_digest)) return fail();
  const confirmation = await tail(history, command, "confirm", String(saved.tail.recorded_at));
  const plan = await row(ctx, parts, "output_plan_revisions", planColumns, "scope_key=? AND confirmed_event_id=?", [scopeKey, confirmation.eventId]);
  if (!plan || !uuid(plan.plan_revision_id) || !hash(plan.source_digest) || !hash(plan.requirements_digest)) return fail();
  const sourceDigest = plan.source_digest, requirementsDigest = plan.requirements_digest, revisionId = plan.plan_revision_id;
  const confirmationOptions = { count_policies: {}, suggested_counts: {} };
  const compiledPlan = compileOutputPlan([saved.recipe.spec], { ...confirmationOptions, document_id: documentId,
    source_revision: sourceDigest, requirement_revision: requirementsDigest, max_targets: 1 });
  const target = matchExperienceOutputRecipeTarget(saved.recipe, compiledPlan, { documentId, sourceRevision: sourceDigest, requirementRevision: requirementsDigest });
  if (!target || compiledPlan.issues.length || compiledPlan.targets.length !== 1) return fail();
  const contractDigest = await outputTargetContractDigest(target, sourceDigest); current(ctx);
  const identity = { scopeKey, actorUserId, projectId, documentId, sourceHead, sourceDigest, requirementsDigest,
    targetId: target.id, contractDigest, compiledPlan, confirmationOptions };
  const confirmed = guestImageStageConfirmedPlan(identity, revisionId, String(confirmation.row.recorded_at));
  const expectedRows = guestImageStagePlanRows(identity, confirmed, { eventId: confirmation.eventId, recordedAt: String(confirmation.row.recorded_at) });
  equalRow(plan, expectedRows.plan);
  const nativeTarget = await row(ctx, parts, "output_plan_targets", targetColumns, "scope_key=? AND plan_revision_id=? AND target_id=?", [scopeKey, revisionId, target.id]);
  if (!nativeTarget) return fail(); equalRow(nativeTarget, expectedRows.target);
  const intent = await row(ctx, parts, "experience_sponsor_driver_intents", intentColumns, "driver_id=?", [saved.driver.driverId]);
  if (!intent || !integer(intent.source_text_bytes, 0, saved.approval.policy.resources.maximumOperationTextBytes)
    || intent.created_at_ms !== Date.parse(String(confirmation.row.recorded_at))) return fail();
  equalRow(intent, guestImageStageIntentRow({ actorUserId, campaignId: saved.approval.policy.campaignId, sessionDigest: saved.sessionDigest,
    documentId, driver: saved.driver, sourceDigest, requirementsDigest, confirmationTextBytes: intent.source_text_bytes }, intent.created_at_ms));
  const driverPayloadDigest = await sha(ctx, { command: saved.driver.command, sourceDigest, requirementsDigest });
  const resources: Row[] = [saved.resource];
  async function resource(operation: "text-intake" | "preflight", suffix: string, minimum: number) {
    const receipt = await row(ctx, parts, "experience_sponsor_resource_receipts", resourceColumns, "resource_id=?", [`${saved.driver.driverId}:${suffix}`]);
    if (!receipt || !integer(receipt.recorded_at_ms, minimum, saved.maximum - 1)) return fail();
    equalRow(receipt, { resource_id: `${saved.driver.driverId}:${suffix}`, campaign_id: saved.approval.policy.campaignId,
      policy_digest: saved.approval.policyDigest, limits_digest: saved.limitsDigest, actor_user_id: actorUserId, session_digest: saved.sessionDigest,
      operation, intent_key: saved.driver.intentKey, payload_digest: driverPayloadDigest, text_bytes: intent!.source_text_bytes,
      issued_grant_id: null, recorded_at_ms: receipt.recorded_at_ms });
    resources.push(receipt); return receipt;
  }
  await resource("text-intake", "text", Number(intent.created_at_ms)); current(ctx);
  let binding: ExperienceOutputBinding | null = saved.binding;
  let confirmEnvelope: Record<string, unknown> | null = null;
  if (original.plan && saved.expectedPayload && binding) {
    const savedTail: Tail = { eventId: saved.eventId, row: saved.tail, observed: saved.observed, payload: saved.expectedPayload };
    const events = [...original.contextEvents, outputEvent(savedTail, saved.expectedPayload)];
    const projection = foldEvents(events), nativeContext = authoritativeCreativeContext(events, { documentId, projectId });
    const requirements = outputRequirements(projection);
    if (requirements.length !== 1 || requirements[0].status !== "valid" || !requirements[0].spec
      || outputRequirementInterpretationNeedsReview(requirements[0].spec) || !await sponsorImageTextSource(nativeContext.snapshot.facts)) return fail();
    current(ctx);
    const actual = await outputSourceDigests(projection, requirements, documentId, projectId, nativeContext); current(ctx);
    if (actual.sourceDigest !== sourceDigest || actual.requirementsDigest !== requirementsDigest || bytes(canonicalJson(nativeContext.snapshot)) !== intent.source_text_bytes) return fail();
    const review = { version: 1, purpose: "confirm-guest-image-requirement", campaignId: saved.approval.policy.campaignId,
      policyDigest: saved.approval.policyDigest, sessionDigest: saved.sessionDigest, guestSourceDigest: saved.sourceBinding.guestSourceDigest,
      releaseHash: original.plan.release.releaseHash, documentId, sourceRevision: sourceHead + 1,
      save: { eventId: saved.eventId, commandKey: saved.commandKey, requestDigest: saved.command.request_digest }, ...actual,
      requirement: requirements[0], confirmationOptions, plan: compiledPlan, targetContractDigest: contractDigest };
    const reviewedRequirementDigest = await sha(ctx, review);
    confirmEnvelope = await experienceOutputEnvelope(binding, "confirm", sourceHead + 1,
      { options: confirmationOptions, explicitRequirementsConfirmation: true, reviewedRequirementDigest }); current(ctx);
    if (await checked(ctx, confirmEnvelope) !== command.request_digest) return fail();
  }
  if (confirmation.payload) {
    const envelope = confirmation.payload.output_command_envelope;
    if (!record(envelope) || !exactKeys(envelope, ["options", "explicitRequirementsConfirmation", "reviewedRequirementDigest", "action", "documentId", "expectedRevision", "clientMutationId", "experienceBinding"])
      || envelope.explicitRequirementsConfirmation !== true || !guestHash(envelope.reviewedRequirementDigest)) return fail();
    const recordedBinding = bindingFrom(history, envelope.experienceBinding);
    if (binding && canonicalJson(binding) !== canonicalJson(recordedBinding)) return fail(); binding = recordedBinding;
    const expectedEnvelope = confirmEnvelope ?? await experienceOutputEnvelope(binding, "confirm", sourceHead + 1,
      { options: confirmationOptions, explicitRequirementsConfirmation: true, reviewedRequirementDigest: envelope.reviewedRequirementDigest }); current(ctx);
    if (canonicalJson(envelope) !== canonicalJson(expectedEnvelope) || await checked(ctx, envelope) !== command.request_digest) return fail();
    confirmEnvelope = expectedEnvelope;
    const expected = guestImageStageNativePayload(identity, expectedEnvelope, { plan_revision_id: revisionId, confirmed_plan: confirmed });
    if (JSON.stringify(expected) !== confirmation.row.private_json) return fail();
  }
  assertPublic(confirmation, { plan_revision_id: revisionId, project_id: projectId, document_id: documentId, actor_user_id: actorUserId });
  const stage = await row(ctx, parts, "experience_sponsor_driver_stages", stageColumns, "driver_id=? AND stage='preflight'", [saved.driver.driverId], true);
  const preflightCommand = await row(ctx, parts, "output_commands", commandColumns, "scope_key=? AND actor_user_id=? AND command_key=?", [scopeKey, actorUserId, preflightKey], true);
  let preflightEnvelope: Record<string, unknown> | null = null, quote: OutputPreflight | null = null, transport: unknown = null;
  let quoteTail: Tail | null = null, quoteIndex: Row | null = null;
  if (stage) {
    if (!hash(stage.command_digest)) return fail();
    const envelope = json(stage.command_json);
    const recordedBinding = bindingFrom(history, envelope.experienceBinding);
    if (binding && canonicalJson(binding) !== canonicalJson(recordedBinding)) return fail(); binding = recordedBinding;
    preflightEnvelope = await experienceOutputEnvelope(binding, "preflight", sourceHead + 2, { planRevisionId: revisionId, targetIds: [target.id] }); current(ctx);
    if (stage.command_json !== canonicalJson(preflightEnvelope) || stage.command_digest !== await checked(ctx, preflightEnvelope)) return fail();
    await resource("preflight", "preflight", Date.parse(String(confirmation.row.recorded_at))); current(ctx);
  } else if (preflightCommand) return fail();
  if (preflightCommand) {
    if (!stage || !preflightEnvelope || preflightCommand.action !== "preflight" || preflightCommand.request_digest !== stage.command_digest) return fail();
    quoteTail = await tail(history, preflightCommand, "preflight", String(confirmation.row.recorded_at));
    if (quoteTail.eventId === confirmation.eventId) return fail();
    quoteIndex = await row(ctx, parts, "output_preflights", quoteColumns, "scope_key=? AND event_id=?", [scopeKey, quoteTail.eventId]);
    if (!quoteIndex || !uuid(quoteIndex.preflight_id) || !hash(quoteIndex.terms_digest) || !iso(quoteIndex.created_at) || !iso(quoteIndex.expires_at)
      || quoteIndex.created_at !== quoteTail.row.recorded_at || quoteIndex.expires_at <= quoteIndex.created_at
      || Date.parse(quoteIndex.expires_at) > Math.min(saved.maximum, Date.parse(quoteIndex.created_at) + 15 * 60_000)) return fail();
    equalRow(quoteIndex, guestImageStageQuoteRow(identity, { id: quoteIndex.preflight_id, planRevisionId: revisionId,
      termsDigest: quoteIndex.terms_digest, expiresAt: quoteIndex.expires_at, createdAt: quoteIndex.created_at }, { eventId: quoteTail.eventId }));
    if (quoteTail.payload) {
      quote = guestImageStageQuoteShape({ sourceDigest, requirementsDigest, targetId: target.id }, quoteTail.payload.preflight,
        { revisionId, recordedAt: String(quoteTail.row.recorded_at), expiresAtMs: saved.maximum });
      const { termsDigest, ...withoutDigest } = quote;
      if (termsDigest !== await checked(ctx, withoutDigest)) return fail();
      // The retained native body, not the index itself, supplies every expected
      // index field. In particular an independently valid expiry is not enough.
      equalRow(quoteIndex, guestImageStageQuoteRow(identity, quote, { eventId: quoteTail.eventId }));
      const template = saved.approval.policy.templates[0];
      const releaseRevision = original.plan?.release.definition.revision ?? Number(template.recipeVersion.slice("image@".length));
      if (!integer(releaseRevision, 1) || template.recipeVersion !== `image@${releaseRevision}`) return fail();
      transport = quoteTail.payload.guest_sponsor_quote_transport;
      await guestImageStageQuoteRecipe({ target, releaseRevision, releaseHash: original.policy.releaseHash, approvedTemplate: template }, quote.targets[0], transport); current(ctx);
      const expected = guestImageStageNativePayload(identity, preflightEnvelope, { preflight_id: quote.id, plan_revision_id: revisionId,
        preflight: quote, guest_sponsor_quote_transport: transport });
      if (JSON.stringify(expected) !== quoteTail.row.private_json) return fail();
    }
    assertPublic(quoteTail, { preflight_id: quoteIndex.preflight_id, plan_revision_id: revisionId, project_id: projectId, document_id: documentId, actor_user_id: actorUserId });
  }
  const stageState: GuestImageHistoricalStage = quoteTail ? "quoted" : stage ? "preflight-claimed-unknown" : "confirmed";
  const tails: Tail[] = [{ eventId: saved.eventId, row: saved.tail, observed: saved.observed,
    payload: saved.tail.redacted_at === null ? json(saved.tail.private_json) : null }, confirmation, ...(quoteTail ? [quoteTail] : [])];
  const stageHead = sourceHead + tails.length, blockIds = [...original.blockIds, saved.requirementId];
  if (new Set(blockIds).size !== blockIds.length) return fail();
  const scope = { guest: actorUserId, stream: `creative:${actorUserId}`, project: projectId, document: documentId, draft: draftId,
    ids: JSON.stringify([...eventIds, ...tails.map(item => item.eventId)]), prefix: JSON.stringify(eventIds), scope: scopeKey,
    tail: saved.eventId, command: saved.commandKey, resource: `${saved.commandKey}:text`, session: saved.sessionDigest, driver: saved.driver.driverId,
    commands: JSON.stringify([saved.commandKey, confirmKey, ...(quoteTail ? [preflightKey] : [])]), resources: JSON.stringify(resources.map(value => value.resource_id)),
    plan: revisionId, target: target.id, quote: quoteIndex?.preflight_id ?? null, claimed: stage ? 1 : 0, sessionId };
  const blockCustodyProof: Proof = { sql: `NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='block' AND resource_id IN(SELECT value FROM json_each(?)))`, bindings: [JSON.stringify(blockIds)] };
  const eventCountProof: Proof = { sql: `(SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND (SELECT COUNT(*) FROM event_client_receipts WHERE stream_id=?)=?`, bindings: [scope.stream, stageHead, scope.stream, stageHead, scope.stream, sourceHead] };
  // Historical evidence cannot have been recorded in the future. This is
  // current DB time, not a reconstruction of the unpersisted live quote clock.
  const recordedTimeProof: Proof = { sql: `NOT EXISTS(SELECT 1 FROM json_each(?) observed WHERE observed.value>${GUEST_DB_NOW})`,
    bindings: [JSON.stringify([...resources.map(value => value.recorded_at_ms), ...tails.map(value => Date.parse(String(value.row.recorded_at)))])] };
  const tailProofs: Proof[] = tails.map(value => ({ sql: `EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE ${eventWitness}=?)`, bindings: [value.observed] }));
  return { ctx, history, sessionId, documentId, sourceHead, sourceSaveHead: sourceHead + 1, stageHead, stageState,
    expiresAt: String(source.expires_at), tails, resources, stageParts: parts, blockCustodyProof, eventCountProof, recordedTimeProof, tailProofs, scope, confirmed, quote, transport,
    rows: { command, plan, target: nativeTarget, intent, stage, preflightCommand, quoteIndex } };
}
