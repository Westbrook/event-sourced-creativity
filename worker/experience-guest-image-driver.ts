import { freeze } from "../src/experiences/compiler.ts";
import { createGuestImageExecutionAuthority, guestImageExecutionInternal, requireGuestImageExecution,
  refreshGuestImageExecution, type GuestImageExecutionAuthority, type GuestImageRunInput } from "./experience-guest-image-execution.ts";
import { createGuestImageRunWitness, requireGuestImageRunWitness, prepareGuestImageRunTransition,
  type GuestImageRunPhase } from "./experience-guest-image-admission-witness.ts";
import type { GuestImageOutputInput } from "./experience-guest-image-stage-witness.ts";
import { runGuestImageDocumentJob } from "./document-jobs-api.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings } from "./event-write-primitives.ts";
import { guestFail } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (part: string): never => guestFail(`image_run_${part}`);
const own = (value: unknown, key: PropertyKey): unknown => {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
};
function acknowledged(results: unknown, length: number, changed: readonly number[], eventIndex: number) {
  if (!Array.isArray(results) || own(results, "length") !== length) return false;
  for (let index = 0; index < length; index++) {
    const item = own(results, index);
    if (!item || typeof item !== "object" || own(item, "success") !== true) return false;
    if ("error" in item) {
      const descriptor = Object.getOwnPropertyDescriptor(item, "error");
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value !== undefined) return false;
    }
  }
  // The native event staging trigger inserts its own private/public rows; its
  // acknowledgement is source-exactly verified by the complete successor read.
  const eventChanges = own(own(own(results, eventIndex), "meta"), "changes");
  return changed.every(index => own(own(own(results, index), "meta"), "changes") === 1)
    && Number.isSafeInteger(eventChanges) && Number(eventChanges) > 0;
}
type RunData = ReturnType<typeof requireGuestImageRunWitness>;
export type GuestImageRunReceipt = Readonly<{
  version: 1; status: GuestImageRunPhase; documentId: string; jobId: string; slotId: string; grantId: string;
  commandKey: string; runEventId: string | null; expiresAt: string; replayed: boolean;
  admissionCommitted: true; runRequested: boolean; generationCompleted: boolean;
  publicReadAvailable: false; custodyTransferred: false;
}>;
function receipt(data: RunData, replayed: boolean): GuestImageRunReceipt {
  data.check();
  const result = freeze({ version: 1 as const, status: data.phase, documentId: data.frame.documentId,
    jobId: data.frame.slot.jobId, slotId: data.frame.slot.slotId, grantId: data.frame.slot.grantId,
    commandKey: data.runKey, runEventId: data.runEvent?.eventId ?? null, expiresAt: data.frame.expiresAt,
    replayed, admissionCommitted: true as const, runRequested: data.runEvent !== null,
    generationCompleted: data.generationCompleted, publicReadAvailable: false as const, custodyTransferred: false as const });
  data.check(); return result;
}
async function transition(request: Request, env: WorkerEnv, authority: GuestImageExecutionAuthority) {
  const owner = guestImageExecutionInternal(request, env, authority);
  if (owner.data.phase !== "admitted") return true;
  const prepared = await owner.wait(() => prepareGuestImageRunTransition(request, env, owner.witness)); owner.check();
  const frame = owner.data.frame, database = env.DB;
  if (!prepared.beforeAssertions.length || !prepared.afterAssertions.length) return fail("complete_proof_required");
  const statements = prepared.beforeAssertions.flatMap(assertion => outputAssertionStatements(env, assertion));
  const eventIndex = statements.length;
  statements.push(database.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(...eventWriteBindings(prepared.event)));
  const changed: number[] = [];
  const add = (statement: D1PreparedStatement) => {
    changed.push(statements.length); statements.push(statement, ...outputAssertionStatements(env, { sql: "changes()=1" }));
  };
  add(database.prepare("UPDATE output_operation_slots SET status='queued',updated_at=? WHERE scope_key=? AND slot_id=? AND grant_id=? AND job_id=? AND status='authorized'")
    .bind(prepared.createdAt, frame.scope.key, frame.slot.slotId, frame.slot.grantId, frame.slot.jobId));
  add(database.prepare("UPDATE output_execution_grants SET status='active' WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND payer_user_id=? AND status='authorized'")
    .bind(frame.scope.key, frame.slot.grantId, frame.actorUserId, frame.payerUserId));
  add(database.prepare("INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at) VALUES(?,?,?,?,'run',?,?)")
    .bind(frame.scope.key, frame.actorUserId, owner.data.runKey, prepared.commandDigest, prepared.event.eventId, prepared.createdAt));
  statements.push(...prepared.afterAssertions.flatMap(assertion => outputAssertionStatements(env, assertion)));
  owner.check();
  let uncertain = false;
  try {
    const results = await owner.wait(() => database.batch(statements)); owner.check();
    if (!acknowledged(results, statements.length, changed, eventIndex)) uncertain = true;
  } catch (error) {
    owner.check(); uncertain = true;
    // A transaction failure is never retried; the exact candidate is the only
    // possible lost-acknowledgement continuation below.
    try { await refreshGuestImageExecution(request, env, authority); }
    catch { owner.check(); throw error; }
  }
  await refreshGuestImageExecution(request, env, authority);
  const current = guestImageExecutionInternal(request, env, authority);
  if (current.data.runEvent?.eventId !== prepared.event.eventId
    || current.data.runCommand?.request_digest !== prepared.commandDigest
    || current.data.runCommand?.created_at !== prepared.createdAt) return fail("original_run_unavailable");
  current.check(); return uncertain;
}
async function run(request: Request, env: WorkerEnv, input: GuestImageRunInput): Promise<GuestImageRunReceipt> {
  const authority = await createGuestImageExecutionAuthority(request, env, input);
  const before = guestImageExecutionInternal(request, env, authority);
  const replayed = await transition(request, env, authority); before.check();
  const current = guestImageExecutionInternal(request, env, authority);
  if (current.data.phase === "queued") {
    await current.wait(() => runGuestImageDocumentJob(env, request, authority));
    requireGuestImageExecution(request, env, authority).assertCurrent();
  }
  await refreshGuestImageExecution(request, env, authority);
  const final = guestImageExecutionInternal(request, env, authority);
  const result = receipt(final.data, replayed); final.check(); return result;
}
/** Dormant foreground entry: no public route, provider retry or second claim. */
export function runGuestImage(request: Request, env: WorkerEnv, input: GuestImageRunInput) {
  return run(request, env, input);
}
async function read(request: Request, env: WorkerEnv, input: GuestImageOutputInput): Promise<GuestImageRunReceipt> {
  const witness = await createGuestImageRunWitness(request, env, input);
  const data = requireGuestImageRunWitness(request, env, witness), result = receipt(data, true);
  data.check(); return result;
}
/** Complete original proof with source-free metadata; no generated body reads. */
export function readGuestImageRun(request: Request, env: WorkerEnv, input: GuestImageOutputInput) {
  return read(request, env, input);
}
