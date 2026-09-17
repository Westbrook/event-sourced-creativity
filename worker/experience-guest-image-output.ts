import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { insertEventAtHead } from "./event-append.ts";
import { makeEvent } from "./event-write-primitives.ts";
import { guestFail, guestHash, type GuestClaimProof } from "./experience-guest-session.ts";
import { readApprovedGuestSponsorCampaign } from "./experience-guest-sponsor-approval.ts";
import { guestImageOutputData, guestImageOutputSuccessorAssertion, inspectGuestImageOutput,
  recheckGuestImageOutput } from "./experience-guest-image-output-witness.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Internal structured input, never an HTTP credential/body transport. No route
 * imports this dormant writer. Both guest proof purposes remain required. */
export type GuestImageOutputInput = Readonly<{ proof: GuestClaimProof; campaignId: string; policyDigest: string; draftHash: string }>;
export type GuestImageOutputReceipt = Readonly<{ status: "saved"; documentId: string; requirementId: string;
  commandKey: string; eventId: string; revision: number; replayed: boolean; planConfirmed: false;
  admissionCommitted: false; generationAvailable: false; custodyTransferred: false }>;
type Context = Readonly<{ request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; headers: string; url: string }>;
const fail = (reason: string): never => guestFail(`image_output_${reason}`);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value)
  && !/^forma-guest-(session|claim)-v1\./u.test(value);
const requestHeaders = (request: Request) => JSON.stringify(Array.from(request.headers));

function current(ctx: Context) {
  const { request, env } = ctx;
  if (env.DB !== ctx.db) return fail("database_changed");
  const url = new URL(request.url), site = request.headers.get("sec-fetch-site");
  if (request.signal.aborted || request.method !== "POST" || request.url !== ctx.url || requestHeaders(request) !== ctx.headers
    || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || request.headers.get("origin") !== url.origin || site !== null && site !== "same-origin" && site !== "none"
    || env.FORMA_PILOT_COHORT_ID?.trim()
    || (request.headers.get("cookie") ?? "").split(";").some(part => ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim())))
    return fail("request_unavailable");
}
function context(request: Request, env: WorkerEnv, input: GuestImageOutputInput) {
  if (!(request instanceof Request)) return fail("request_unavailable");
  const headers = requestHeaders(request);
  if (new TextEncoder().encode(headers).byteLength > 32768) return fail("request_unavailable");
  const ctx: Context = { request, env, db: env.DB, headers, url: request.url };
  current(ctx);
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof", "campaignId", "policyDigest", "draftHash"])
    || !id(input.campaignId) || !guestHash(input.policyDigest) || !guestHash(input.draftHash)
    || new TextEncoder().encode(canonicalJson(input)).byteLength > 32768) return fail("input_invalid");
  return { ctx, copied: freeze(structuredClone(input)) };
}
async function inspect(ctx: Context, input: GuestImageOutputInput) {
  current(ctx);
  const approved = await readApprovedGuestSponsorCampaign(ctx.request, ctx.env,
    { campaignId: input.campaignId, policyDigest: input.policyDigest });
  current(ctx);
  const witness = await inspectGuestImageOutput(ctx.request, ctx.env, input, approved);
  current(ctx);
  return witness;
}
function receipt(ctx: Context, data: ReturnType<typeof guestImageOutputData>, replayed: boolean): GuestImageOutputReceipt {
  current(ctx);
  const saved = data.saved;
  if (data.state !== "saved" || !saved) return fail("original_unavailable");
  return Object.freeze({ status: "saved", documentId: data.plan.documentId, requirementId: data.requirementId,
    commandKey: data.commandKey, eventId: saved.eventId, revision: saved.revision, replayed,
    planConfirmed: false, admissionCommitted: false, generationAvailable: false, custodyTransferred: false });
}
async function original(ctx: Context, input: GuestImageOutputInput, expected: { commandKey: string; requestDigest: string },
  replayed: boolean, eventId?: string): Promise<GuestImageOutputReceipt> {
  const witness = await inspect(ctx, input); current(ctx);
  await recheckGuestImageOutput(ctx.request, ctx.env, witness); current(ctx);
  const data = guestImageOutputData(ctx.request, ctx.env, witness);
  if (data.commandKey !== expected.commandKey || data.requestDigest !== expected.requestDigest
    || data.state !== "saved" || !data.saved || eventId && data.saved.eventId !== eventId) return fail("original_unavailable");
  // Only source-free identifiers leave this final, completely current read.
  return receipt(ctx, data, replayed);
}

/** Source-free exact native reopen. Null means the complete original empty
 * source was proven, never a partially written or unsupported successor. */
export async function readGuestImageRequirement(request: Request, env: WorkerEnv, input: GuestImageOutputInput): Promise<GuestImageOutputReceipt | null> {
  const { ctx, copied } = context(request, env, input), witness = await inspect(ctx, copied); current(ctx);
  await recheckGuestImageOutput(request, env, witness); current(ctx);
  const data = guestImageOutputData(request, env, witness);
  if (data.state === "empty") return null;
  return receipt(ctx, data, true);
}

/** One unconfirmed native requirement only. The original guest actor and
 * source bytes/IDs/head remain unchanged. No plan, grant, job, hold or provider
 * is created, and a receipt never represents generation or custody authority. */
export async function saveGuestImageRequirement(request: Request, env: WorkerEnv, input: GuestImageOutputInput): Promise<GuestImageOutputReceipt> {
  const { ctx, copied } = context(request, env, input), witness = await inspect(ctx, copied); current(ctx);
  const data = guestImageOutputData(request, env, witness);
  if (data.state === "saved") {
    await recheckGuestImageOutput(request, env, witness); current(ctx);
    return receipt(ctx, guestImageOutputData(request, env, witness), true);
  }
  if (!data.beforeProof) return fail("source_unavailable");
  const resource = await prepareSponsorResourcePlan(data.resourceInput); current(ctx);
  // A real native event uses the original bare guest actor. Canonical command
  // helpers deliberately retain their stricter user/principal grammar.
  const event = makeEvent(data.plan.streamId, data.sourceHead + 1, data.session.row.guest_subject,
    "server:guest-output", data.commandKey, "BlockCreated", structuredClone(data.payload));
  const successor = guestImageOutputSuccessorAssertion(request, env, witness, event);
  const statements = [...outputAssertionStatements(env, data.beforeProof)];
  const resourceOffset = statements.length;
  statements.push(...resource.statements.map(statement => ctx.db.prepare(statement.sql).bind(...statement.bindings)));
  const stageIndex = statements.length;
  statements.push(insertEventAtHead(env, event, data.sourceHead));
  const commandIndex = statements.length;
  statements.push(ctx.db.prepare(`INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at)
    VALUES(?,?,?,?,?,?,?)`).bind(data.scopeKey, data.session.row.guest_subject, data.commandKey, data.requestDigest, "save", event.eventId, event.recordedAt));
  statements.push(...outputAssertionStatements(env, successor));
  const resourceIndexes = resource.statements.flatMap((statement, index) => /INSERT INTO experience_sponsor_resource_receipts\(/u.test(statement.sql) ? [resourceOffset + index] : []);
  if (resourceIndexes.length !== 1) return fail("resource_plan_unavailable");
  current(ctx);
  try {
    const results = await ctx.db.batch(statements); current(ctx);
    // Native event-stage triggers can contribute more than one changed row.
    // Its exact one-event/private-body footprint is proved by the final CHECK.
    const stageChanges = results?.[stageIndex]?.meta?.changes;
    if (!Array.isArray(results) || results.length !== statements.length
      || Array.from({ length: statements.length }, (_, index) => index).some(index => results[index]?.success !== true)
      || !Number.isSafeInteger(stageChanges) || Number(stageChanges) <= 0
      || [commandIndex, ...resourceIndexes].some(index => results[index]?.meta?.changes !== 1)) return fail("acknowledgement_unavailable");
  } catch (error) {
    current(ctx);
    // No retry, new event ID, later head or second resource purchase. Only a
    // fresh complete native original can resolve an uncertain/competing write.
    try { const saved = await original(ctx, copied, data, true); current(ctx); return saved; }
    catch { current(ctx); throw error; }
  }
  const saved = await original(ctx, copied, data, false, event.eventId); current(ctx); return saved;
}
