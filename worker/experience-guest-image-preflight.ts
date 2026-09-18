import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import type { OutputPreflight } from "../src/model/output-delivery-contract.ts";
import { insertEventAtHead } from "./event-append.ts";
import { makeEvent, uuidV7 } from "./event-write-primitives.ts";
import { guestFail } from "./experience-guest-session.ts";
import { captureGuestImageStage, currentGuestImageStage, denseGuestImageAcknowledgement, finalGuestImageStage,
  guestImageInsertRow, inspectCurrentGuestImageStage, type GuestImageStageContext } from "./experience-guest-image-confirmation.ts";
import { guestImageClaimSuccessor, guestImageQuoteRecipe, guestImageQuoteRow, guestImageQuoteSuccessor, guestImageStageData,
  recheckGuestImageStages, type GuestImageOutputInput, type StageData } from "./experience-guest-image-stage-witness.ts";
import { sponsorImageTransport } from "./experience-sponsor-image-evidence.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import { outputDigest } from "./output-disclosure-proof.ts";
import { preflightOutputImageSlidesTarget } from "./output-image-slides-preflight.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (reason: string): never => guestFail(`image_preflight_${reason}`);
function quotedReceipt(data: StageData, replayed: boolean) {
  if (data.state !== "quoted" || !data.quote || !data.quoteEvent) return fail("stage_unknown");
  return freeze({ status: "quoted" as const, documentId: data.base.plan.documentId, planRevisionId: data.confirmed!.revisionId,
    preflight: data.quote, eventId: data.quoteEvent.eventId, commandKey: String(data.preflightEnvelope!.clientMutationId),
    revision: data.base.sourceHead + 3, replayed, admissionCommitted: false, generationAvailable: false, custodyTransferred: false });
}
async function originalQuote(ctx: GuestImageStageContext, input: GuestImageOutputInput, expected: StageData, replayed: boolean, eventId?: string) {
  const data = await finalGuestImageStage(ctx, input, expected); currentGuestImageStage(ctx);
  if (eventId && data.quoteEvent?.eventId !== eventId) return fail("original_unavailable");
  return quotedReceipt(data, replayed);
}
function capturedQuoteConfiguration(env: WorkerEnv) {
  // These stay request-local (including credentials). The quote stores only the
  // native offer and non-secret actual transport descriptor, never env values.
  return [env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_IMAGE_MODEL, env.FORMA_IMAGE_PROVIDER, env.FAL_KEY,
    env.FAL_IMAGE_EDIT_MODEL, env.FAL_IMAGE_PREVIEW_MODEL, env.FAL_IMAGE_MODEL];
}

/** Null proves precisely an unclaimed confirmed original. A charged claim with
 * no retained quote is unknown, never a resumption credential. */
export async function readGuestImagePreflight(request: Request, env: WorkerEnv, input: GuestImageOutputInput) {
  const { ctx, base } = captureGuestImageStage(request, env, input), witness = await inspectCurrentGuestImageStage(ctx, base); currentGuestImageStage(ctx);
  await recheckGuestImageStages(request, env, witness); currentGuestImageStage(ctx);
  const data = guestImageStageData(request, env, witness);
  if (data.state === "saved") return fail("confirmation_required");
  if (data.state === "confirmed") return null;
  return quotedReceipt(data, true);
}

/** Initial unpaid native quote only. A complete original reservation ACK owns
 * one in-memory quote construction. Durable stage metadata never recreates it. */
export async function preflightGuestImage(request: Request, env: WorkerEnv, input: GuestImageOutputInput) {
  const { ctx, base } = captureGuestImageStage(request, env, input), witness = await inspectCurrentGuestImageStage(ctx, base); currentGuestImageStage(ctx);
  const data = guestImageStageData(request, env, witness);
  if (data.state === "saved") return fail("confirmation_required");
  if (data.state === "quoted") {
    await recheckGuestImageStages(request, env, witness); currentGuestImageStage(ctx); return quotedReceipt(data, true);
  }
  if (data.state !== "confirmed" || !data.preflightEnvelope || !data.preflightDigest) return fail("stage_unknown");
  const ticket = await prepareSponsorResourcePlan(data.preflightResource); currentGuestImageStage(ctx);
  const afterClaim = guestImageClaimSuccessor(request, env, witness);
  const reservation = [...outputAssertionStatements(env, data.assertion)], exact: number[] = [];
  for (const statement of ticket.statements) {
    if (/INSERT INTO experience_sponsor_resource_receipts\(/u.test(statement.sql)) exact.push(reservation.length);
    reservation.push(ctx.db.prepare(statement.sql).bind(...statement.bindings));
  }
  if (exact.length !== 1) return fail("resource_plan_unavailable");
  exact.push(reservation.length);
  reservation.push(ctx.db.prepare("INSERT INTO experience_sponsor_driver_stages(driver_id,stage,command_json,command_digest) VALUES(?,?,?,?)")
    .bind(data.driver.driverId, "preflight", canonicalJson(data.preflightEnvelope), data.preflightDigest));
  reservation.push(...outputAssertionStatements(env, afterClaim));
  let ownsConstruction = false;
  currentGuestImageStage(ctx);
  try {
    const results = await ctx.db.batch(reservation); currentGuestImageStage(ctx);
    if (!denseGuestImageAcknowledgement(results, reservation.length, exact)) return fail("acknowledgement_unavailable");
    ownsConstruction = true;
  } catch (error) {
    currentGuestImageStage(ctx);
    // No reservation retry or refund. Lost ACK and competing requests may only
    // disclose an already complete N+3 original; claimed N+2 stays unknown.
    try { return await originalQuote(ctx, base, data, true); }
    catch { currentGuestImageStage(ctx); throw error; }
  }
  const claimedWitness = await inspectCurrentGuestImageStage(ctx, base); currentGuestImageStage(ctx);
  const claimed = guestImageStageData(request, env, claimedWitness);
  if (claimed.confirmed?.revisionId !== data.confirmed?.revisionId || claimed.preflightDigest !== data.preflightDigest
    || claimed.sourceDigest !== data.sourceDigest || claimed.requirementsDigest !== data.requirementsDigest
    || claimed.driver.driverId !== data.driver.driverId || claimed.state !== "claimed" || !ownsConstruction) return fail("stage_unknown");
  // Consume before protected quote work. No await, durable read or exception
  // can restore this permission; this invocation contains no construction loop.
  ownsConstruction = false;
  const configuration = capturedQuoteConfiguration(env);
  const currentConfiguration = () => {
    currentGuestImageStage(ctx);
    if (capturedQuoteConfiguration(env).some((value, index) => value !== configuration[index])) return fail("configuration_changed");
  };
  const offered = await preflightOutputImageSlidesTarget({ env, target: claimed.target, context: { snapshot: claimed.context.snapshot } }); currentConfiguration();
  const transport = await sponsorImageTransport(env); currentConfiguration();
  await guestImageQuoteRecipe(claimed, offered, transport); currentConfiguration();
  const createdAt = new Date().toISOString(), expiresAtMs = Math.min(Date.parse(createdAt) + 15 * 60_000, claimed.expiresAtMs);
  if (expiresAtMs <= Date.parse(createdAt)) return fail("expired");
  const withoutDigest = { id: uuidV7(), planRevisionId: claimed.confirmed!.revisionId, sourceDigest: claimed.sourceDigest,
    requirementsDigest: claimed.requirementsDigest, targets: [offered], operationAttempts: { [claimed.target.id]: { ordinal: 0, previousSlotId: null } },
    maximumMicrousd: offered.maximumMicrousd, maximumCalls: offered.maximumCalls, expiresAt: new Date(expiresAtMs).toISOString(), createdAt };
  const preflight: OutputPreflight = { ...withoutDigest, termsDigest: await outputDigest(withoutDigest) }; currentConfiguration();
  const event = makeEvent(claimed.base.plan.streamId, claimed.base.sourceHead + 3, claimed.base.session.row.guest_subject,
    "server:guest-output", String(claimed.preflightEnvelope!.clientMutationId), "OutputPlanPreflighted", {
      preflight_id: preflight.id, plan_revision_id: preflight.planRevisionId, preflight, guest_sponsor_quote_transport: transport,
      output_command_envelope: structuredClone(claimed.preflightEnvelope), project_id: claimed.base.plan.projectId,
      document_id: claimed.base.plan.documentId, actor_user_id: claimed.base.session.row.guest_subject });
  event.occurredAt = createdAt; event.recordedAt = createdAt;
  const afterQuote = await guestImageQuoteSuccessor(request, env, claimedWitness, event); currentConfiguration();
  const statements = [...outputAssertionStatements(env, claimed.assertion)], eventIndex = statements.length;
  statements.push(insertEventAtHead(env, event, claimed.base.sourceHead + 2));
  const rowIndex = statements.length; statements.push(guestImageInsertRow(env, "output_preflights", guestImageQuoteRow(claimed, preflight, event)));
  const commandIndex = statements.length;
  statements.push(ctx.db.prepare(`INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at)
    VALUES(?,?,?,?,?,?,?)`).bind(claimed.base.scopeKey, claimed.base.session.row.guest_subject, String(claimed.preflightEnvelope!.clientMutationId),
    claimed.preflightDigest, "preflight", event.eventId, createdAt));
  statements.push(...outputAssertionStatements(env, afterQuote)); currentConfiguration();
  try {
    const results = await ctx.db.batch(statements); currentGuestImageStage(ctx);
    if (!denseGuestImageAcknowledgement(results, statements.length, [rowIndex, commandIndex], eventIndex)) return fail("acknowledgement_unavailable");
  } catch (error) {
    currentGuestImageStage(ctx);
    try { return await originalQuote(ctx, base, claimed, true); }
    catch { currentGuestImageStage(ctx); throw error; }
  }
  return originalQuote(ctx, base, claimed, false, event.eventId);
}
