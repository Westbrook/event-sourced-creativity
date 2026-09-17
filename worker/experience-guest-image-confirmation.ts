import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import type { OutputConfirmedPlan } from "../src/model/output-delivery-contract.ts";
import { insertEventAtHead } from "./event-append.ts";
import { makeEvent, uuidV7 } from "./event-write-primitives.ts";
import { guestFail, guestHash } from "./experience-guest-session.ts";
import { readApprovedGuestSponsorCampaign } from "./experience-guest-sponsor-approval.ts";
import { guestImageStageData, guestImageConfirmationSuccessor, guestImageIntentRow, guestImagePlanRows,
  inspectGuestImageStages, recheckGuestImageStages, type GuestImageOutputInput, type GuestImageStageWitness, type StageData } from "./experience-guest-image-stage-witness.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

export type GuestImageConfirmationInput = GuestImageOutputInput & Readonly<{
  reviewedRequirementDigest: string; explicitRequirementsConfirmation: true;
}>;
export type GuestImageStageContext = Readonly<{ request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; headers: string; url: string }>;
const fail = (reason: string): never => guestFail(`image_stage_${reason}`);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
export function currentGuestImageStage(ctx: GuestImageStageContext) {
  const { request, env } = ctx, url = new URL(request.url), site = request.headers.get("sec-fetch-site");
  if (env.DB !== ctx.db || request.signal.aborted || request.method !== "POST" || request.url !== ctx.url
    || JSON.stringify(Array.from(request.headers)) !== ctx.headers || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || request.headers.get("origin") !== url.origin || site !== null && site !== "same-origin" && site !== "none" || env.FORMA_PILOT_COHORT_ID?.trim()
    || (request.headers.get("cookie") ?? "").split(";").some(part => ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim())))
    return fail("request_unavailable");
}
/** Structured internal calls only; no body parser, route or authority adapter. */
export function captureGuestImageStage(request: Request, env: WorkerEnv, input: GuestImageOutputInput | GuestImageConfirmationInput, confirm = false) {
  if (!(request instanceof Request)) return fail("request_unavailable");
  const ctx: GuestImageStageContext = { request, env, db: env.DB, headers: JSON.stringify(Array.from(request.headers)), url: request.url };
  currentGuestImageStage(ctx);
  if (new TextEncoder().encode(ctx.headers).byteLength > 32768 || jsonIssues(input).length || !record(input)
    || !exactKeys(input, ["proof", "campaignId", "policyDigest", "draftHash", ...(confirm ? ["reviewedRequirementDigest", "explicitRequirementsConfirmation"] : [])])
    || !id(input.campaignId) || !guestHash(input.policyDigest) || !guestHash(input.draftHash)
    || confirm && (!("explicitRequirementsConfirmation" in input) || input.explicitRequirementsConfirmation !== true
      || !("reviewedRequirementDigest" in input) || !guestHash(input.reviewedRequirementDigest))
    || new TextEncoder().encode(canonicalJson(input)).byteLength > 32768) return fail("input_invalid");
  const copied = freeze(structuredClone(input));
  return { ctx, copied, base: freeze({ proof: copied.proof, campaignId: copied.campaignId, policyDigest: copied.policyDigest, draftHash: copied.draftHash }) };
}
export async function inspectCurrentGuestImageStage(ctx: GuestImageStageContext, input: GuestImageOutputInput) {
  currentGuestImageStage(ctx);
  const approved = await readApprovedGuestSponsorCampaign(ctx.request, ctx.env, { campaignId: input.campaignId, policyDigest: input.policyDigest });
  currentGuestImageStage(ctx);
  const witness = await inspectGuestImageStages(ctx.request, ctx.env, input, approved); currentGuestImageStage(ctx);
  return witness;
}
export function guestImageInsertRow(env: WorkerEnv, table: "output_plan_revisions" | "output_plan_targets" | "experience_sponsor_driver_intents" | "output_preflights",
  row: Record<string, string | number | null>) {
  const keys = Object.keys(row);
  return env.DB.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).bind(...Object.values(row));
}
export function denseGuestImageAcknowledgement(results: D1Result[], count: number, exactIndexes: number[], eventIndex?: number) {
  // Native acknowledgements are own data, not inherited slots or accessors.
  // A sparse array must never manufacture the one-use construction permission.
  const own = (value: unknown, key: PropertyKey): unknown => {
    if (value === null || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  };
  const changes = (index: number) => {
    const row = own(results, index), meta = record(row) ? own(row, "meta") : undefined;
    return record(meta) ? own(meta, "changes") : undefined;
  };
  return Array.isArray(results) && results.length === count
    && Array.from({ length: count }, (_, index) => index).every(index => {
      const row = own(results, index); return record(row) && own(row, "success") === true;
    })
    && exactIndexes.every(index => changes(index) === 1)
    && (eventIndex === undefined || Number.isSafeInteger(changes(eventIndex)) && Number(changes(eventIndex)) > 0);
}
export async function finalGuestImageStage(ctx: GuestImageStageContext, input: GuestImageOutputInput, expected: StageData) {
  const witness = await inspectCurrentGuestImageStage(ctx, input); currentGuestImageStage(ctx);
  await recheckGuestImageStages(ctx.request, ctx.env, witness); currentGuestImageStage(ctx);
  const data = guestImageStageData(ctx.request, ctx.env, witness);
  if (data.confirmKey !== expected.confirmKey || data.confirmDigest !== expected.confirmDigest
    || data.base.requestDigest !== expected.base.requestDigest || data.reviewedRequirementDigest !== expected.reviewedRequirementDigest
    || expected.confirmed && data.confirmed?.revisionId !== expected.confirmed.revisionId
    || expected.preflightDigest && data.preflightDigest !== expected.preflightDigest) return fail("original_unavailable");
  return data;
}
function confirmedReceipt(data: StageData, replayed: boolean) {
  if (!data.confirmed || !data.confirmEvent) return fail("original_unavailable");
  return freeze({ status: "confirmed" as const, documentId: data.base.plan.documentId, planRevisionId: data.confirmed.revisionId,
    plan: data.compiledPlan, reviewedRequirementDigest: data.reviewedRequirementDigest, revision: data.base.sourceHead + 2,
    eventId: data.confirmEvent.eventId, commandKey: data.confirmKey, replayed, admissionCommitted: false,
    generationAvailable: false, custodyTransferred: false });
}
/** Bounded current source-derived review, not a receipt granting confirmation. */
export async function prepareGuestImageConfirmation(request: Request, env: WorkerEnv, input: GuestImageOutputInput) {
  const { ctx, base } = captureGuestImageStage(request, env, input), witness = await inspectCurrentGuestImageStage(ctx, base); currentGuestImageStage(ctx);
  await recheckGuestImageStages(request, env, witness); currentGuestImageStage(ctx);
  const data = guestImageStageData(request, env, witness);
  return freeze({ status: "review" as const, documentId: data.base.plan.documentId, sourceRevision: data.base.sourceHead + 1,
    reviewedRequirementDigest: data.reviewedRequirementDigest, requirement: data.review.requirement, plan: data.compiledPlan,
    sourceDigest: data.sourceDigest, requirementsDigest: data.requirementsDigest, confirmationOptions: data.confirmationOptions });
}

/** One deliberate review action, one native plan and one distinct source-work
 * receipt. No canonical principal, grant, spending consent or provider work. */
export async function confirmGuestImageRequirement(request: Request, env: WorkerEnv, input: GuestImageConfirmationInput) {
  const { ctx, copied, base } = captureGuestImageStage(request, env, input, true);
  const witness: GuestImageStageWitness = await inspectCurrentGuestImageStage(ctx, base); currentGuestImageStage(ctx);
  const data = guestImageStageData(request, env, witness);
  if (!("reviewedRequirementDigest" in copied) || copied.reviewedRequirementDigest !== data.reviewedRequirementDigest) return fail("review_changed");
  if (data.state !== "saved") {
    await recheckGuestImageStages(request, env, witness); currentGuestImageStage(ctx);
    return confirmedReceipt(data, true);
  }
  const resource = await prepareSponsorResourcePlan(data.confirmResource); currentGuestImageStage(ctx);
  const createdAt = new Date().toISOString(), revisionId = uuidV7(), intentTime = Date.parse(createdAt);
  const confirmed: OutputConfirmedPlan = { id: data.base.plan.documentId, revisionId, revision: 1, confirmedAt: createdAt,
    requirementsDigest: data.requirementsDigest, sourceDigest: data.sourceDigest, plan: data.compiledPlan,
    targetContractDigests: { [data.target.id]: data.contractDigest }, confirmationOptions: data.confirmationOptions };
  const event = makeEvent(data.base.plan.streamId, data.base.sourceHead + 2, data.base.session.row.guest_subject,
    "server:guest-output", data.confirmKey, "OutputPlanConfirmed", { plan_revision_id: revisionId, confirmed_plan: confirmed,
      output_command_envelope: structuredClone(data.confirmEnvelope), project_id: data.base.plan.projectId,
      document_id: data.base.plan.documentId, actor_user_id: data.base.session.row.guest_subject });
  // Native event and confirmed plan share exactly one server-selected instant.
  event.occurredAt = createdAt; event.recordedAt = createdAt;
  const after = await guestImageConfirmationSuccessor(request, env, witness, event, intentTime); currentGuestImageStage(ctx);
  const statements = [...outputAssertionStatements(env, data.assertion)], exact: number[] = [];
  for (const statement of resource.statements) {
    if (/INSERT INTO experience_sponsor_resource_receipts\(/u.test(statement.sql)) exact.push(statements.length);
    statements.push(ctx.db.prepare(statement.sql).bind(...statement.bindings));
  }
  if (exact.length !== 1) return fail("resource_plan_unavailable");
  exact.push(statements.length); statements.push(guestImageInsertRow(env, "experience_sponsor_driver_intents", guestImageIntentRow(data, intentTime)));
  const eventIndex = statements.length; statements.push(insertEventAtHead(env, event, data.base.sourceHead + 1));
  const rows = guestImagePlanRows(data, confirmed, event);
  exact.push(statements.length); statements.push(guestImageInsertRow(env, "output_plan_revisions", rows.plan));
  exact.push(statements.length); statements.push(guestImageInsertRow(env, "output_plan_targets", rows.target));
  exact.push(statements.length); statements.push(ctx.db.prepare(`INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at)
    VALUES(?,?,?,?,?,?,?)`).bind(data.base.scopeKey, data.base.session.row.guest_subject, data.confirmKey, data.confirmDigest, "confirm", event.eventId, createdAt));
  statements.push(...outputAssertionStatements(env, after)); currentGuestImageStage(ctx);
  try {
    const results = await ctx.db.batch(statements); currentGuestImageStage(ctx);
    if (!denseGuestImageAcknowledgement(results, statements.length, exact, eventIndex)) return fail("acknowledgement_unavailable");
  } catch (error) {
    currentGuestImageStage(ctx);
    try {
      const original = await finalGuestImageStage(ctx, base, data); currentGuestImageStage(ctx);
      return confirmedReceipt(original, true);
    }
    catch { currentGuestImageStage(ctx); throw error; }
  }
  const original = await finalGuestImageStage(ctx, base, data); currentGuestImageStage(ctx);
  if (original.confirmEvent?.eventId !== event.eventId) return fail("original_unavailable");
  return confirmedReceipt(original, false);
}
