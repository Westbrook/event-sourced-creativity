import { requireGuestImageExecution, type GuestImageExecutionAuthority } from "./experience-guest-image-execution.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import { priceTextUsageBreakdownMicrousd, priceImageUsageBreakdownMicrousd } from "./replay-cost.ts";
import type { WorkerEnv } from "./runtime.ts";
import { OutputConflictError, outputAssertionStatements, outputScopeAuthority, type OutputScope, type OutputSqlAssertion } from "./output-command-core.ts";
import { markOutputSchemaReady, outputSchemaIsReady } from "./output-schema-state.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA, upgradeOutputRequirementsSchema } from "./output-requirements-schema.ts";
import type { OutputProviderFinancialCheckpoint } from "./output-provider-financial-checkpoint.ts";

export { OutputConflictError, outputAssertionStatements, outputScopeAuthority, retainedOutputBodyAssertions, rememberOutputPrivateBody, resetRetainedOutputPrivateBodies, inheritRetainedOutputPrivateBodies, outputCommandReceiptAssertion, readOutputCommand, commitOutputCommand } from "./output-command-core.ts";
export type { OutputSqlValue, OutputSqlAssertion, OutputScope, OutputCommandPermission, OutputCommandReceipt, OutputCommandWrite } from "./output-command-core.ts";

export { OUTPUT_REQUIREMENTS_SCHEMA } from "./output-requirements-schema.ts";

const initialized = new WeakSet<object>();
export async function ensureOutputRequirementsSchema(env: WorkerEnv) {
  if (initialized.has(env.DB) || outputSchemaIsReady(env.DB)) { markOutputSchemaReady(env.DB); return; }
  await env.DB.batch(OUTPUT_REQUIREMENTS_SCHEMA.map((sql) => env.DB.prepare(sql)));
  await upgradeOutputRequirementsSchema(env.DB);
  initialized.add(env.DB);
  markOutputSchemaReady(env.DB);
}

export type OutputSourceEpoch = { head: number; sourceDigest: string };
export function outputSourceEpochAssertion(scope: OutputScope, epoch: OutputSourceEpoch): OutputSqlAssertion {
  if (!Number.isSafeInteger(epoch.head) || epoch.head < 0 || !epoch.sourceDigest) throw new OutputConflictError("output_source_epoch_required", 403);
  return { sql: `NOT EXISTS(SELECT 1 FROM events later WHERE later.stream_id=? AND later.sequence>? AND NOT(
    later.type IN('DocumentOpened','ProjectOpened') OR (
      (later.type IN('DocumentRenderRequested','DocumentRenderCompleted','DocumentRenderFailed','GenerationUsageRecorded','GenerationRequested','ContextCompiled','GenerationCompleted','GenerationFailed','BudgetReserved','BudgetReleased','BudgetExceeded')
        OR (later.type IN('ModelRegistered','AdapterVersioned','CapabilityDeclared') AND later.actor='worker:registry'))
      AND later.correlation_id IN(SELECT job.correlation_id FROM output_operation_slots slot JOIN document_jobs job ON job.job_id=slot.job_id WHERE slot.scope_key=? AND slot.source_digest=?))))`,
    bindings: [`creative:${scope.ownerUserId}`, epoch.head, scope.key, epoch.sourceDigest] };
}


export { outputRevision } from "./output-revision.ts";
export function parseOutputRevision(value: unknown) {
  const match = typeof value === "string" ? /^output:(0|[1-9]\d*)$/u.exec(value) : null;
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new OutputConflictError("expected_revision_required", 400);
  return Number(match[1]);
}


export type OutputOperationSlot = {
  scopeKey: string; slotId: string; grantId: string; planRevisionId: string; targetId: string; targetContractDigest: string; sourceDigest: string;
  provider: string; model: string; routeDigest: string; jobId: string; costReservationId: string; tokenReservationId: string;
  maximumMicrousd: number; maximumCalls: number; maximumTokens: number; status: string;
  attemptOrdinal: number; previousSlotId: string | null;
};
export async function readOutputSlots(env: WorkerEnv, scopeKey: string, grantId: string): Promise<OutputOperationSlot[]> {
  const rows = await env.DB.prepare("SELECT * FROM output_operation_slots WHERE scope_key=? AND grant_id=? ORDER BY created_at,slot_id").bind(scopeKey, grantId).all<Record<string, unknown>>();
  return rows.results.map((row) => outputSlotFromRow(scopeKey, row));
}
export function outputSlotFromRow(scopeKey: string, row: Record<string, unknown>): OutputOperationSlot {
  return { scopeKey, slotId: String(row.slot_id), grantId: String(row.grant_id), planRevisionId: String(row.plan_revision_id), targetId: String(row.target_id),
    targetContractDigest: String(row.target_contract_digest), sourceDigest: String(row.source_digest), provider: String(row.provider), model: String(row.model), routeDigest: String(row.route_digest),
    jobId: String(row.job_id), costReservationId: String(row.cost_reservation_id), tokenReservationId: String(row.token_reservation_id), maximumMicrousd: Number(row.maximum_microusd), maximumCalls: Number(row.maximum_calls), maximumTokens: Number(row.maximum_tokens), status: String(row.status), attemptOrdinal: Number(row.attempt_ordinal), previousSlotId: typeof row.previous_slot_id === "string" ? row.previous_slot_id : null };
}

type OutputProviderCallInput = {
  scope: OutputScope; slotId: string; jobId: string; callKey: string; clientRequestId: string; requestDigest: string;
  provider: string; model: string; maximumMicrousd: number; expectedHead: number; sourceDigest: string;
  routeDigest: string; stageKey: string; sourceEpoch?: OutputSourceEpoch;
  assertions: OutputSqlAssertion[];
};

/** A durable call slot is never refunded by a failed local request, cancellation or settlement. */
export async function claimOutputProviderCall(env: WorkerEnv, input: OutputProviderCallInput) {
  return claimProviderCall(env, input);
}

/** Guest identities and allowances are read only from the genuine execution seal. */
export async function claimGuestImageProviderCall(env:WorkerEnv,request:Request,authority:GuestImageExecutionAuthority,attempt:ProviderAttemptPreflight) {
  let frame=requireGuestImageExecution(request,env,authority);
  frame.assertCurrent();await frame.refresh();frame=requireGuestImageExecution(request,env,authority);frame.assertCurrent();
  const {scope,slot,job,proof,settings}=frame;
  const callKey=attempt.logicalCallKey;
  const route=settings.calls.find(candidate=>candidate.stage===callKey);
  if(job.kind!=="generate"||job.source_surface!=="outputs"||settings.kind!=="generate"||scope.kind!=="personal"
    ||!callKey||!route||route.provider!=="openai"||route.model!==attempt.model
    ||!attempt.clientRequestId||!attempt.requestDigest||!Number.isSafeInteger(attempt.maximumInputTokens)||attempt.maximumInputTokens<0
    ||!Number.isSafeInteger(attempt.maximumOutputTokens)||attempt.maximumOutputTokens<0
    ||["narrative","scene","video","videoPlanning","storyboardPlanning","storyboard","audio","falImage","presentationRoute"].some(key=>key in attempt))
    throw new OutputConflictError("output_guest_image_only",403);
  const maximumUsage={inputTokens:attempt.maximumInputTokens,outputTokens:attempt.maximumOutputTokens,totalTokens:attempt.maximumInputTokens+attempt.maximumOutputTokens};
  const pricedMaximum=callKey.startsWith("planning")?priceTextUsageBreakdownMicrousd(attempt.model,maximumUsage).totalMicrousd
    :priceImageUsageBreakdownMicrousd(attempt.model,{...maximumUsage,textInputTokens:attempt.maximumInputTokens,imageInputTokens:0},false).totalMicrousd;
  if(pricedMaximum>route.maximumMicrousd)throw new OutputConflictError("output_call_cost_allowance_exceeded",429);
  let checkpoint:Record<string,unknown>;
  try{checkpoint=JSON.parse(job.result_json??"{}");if(!checkpoint||typeof checkpoint!=="object"||Array.isArray(checkpoint))throw new Error("invalid_checkpoint");}catch{throw new OutputConflictError("output_admitted_reservations_missing",409);}
  const period=checkpoint.costReservationPeriod;
  if(typeof period!=="string"||!/^\d{4}-\d{2}$/u.test(period)||checkpoint.reservationId!==slot.tokenReservationId
    ||checkpoint.costReservationId!==slot.costReservationId||checkpoint.costReservationMicrousd!==slot.maximumMicrousd)
    throw new OutputConflictError("output_admitted_reservations_missing",409);
  const assertions:OutputSqlAssertion[]=[...proof.assertions,
    {sql:`EXISTS(SELECT 1 FROM document_jobs live WHERE live.job_id=? AND live.owner_id=? AND live.stream_id=? AND live.correlation_id=? AND live.attempt_count=? AND live.status='running'
      AND live.lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(live.result_json,'$.providerSubmissions'),'{}')) receipt
        WHERE json_extract(receipt.value,'$.status')='completed' AND (COALESCE(json_type(receipt.value,'$.totalTokens'),'')<>'integer' OR json_extract(receipt.value,'$.totalTokens')<0))
      AND (SELECT COALESCE(SUM(CASE WHEN json_extract(receipt.value,'$.status')='completed' THEN json_extract(receipt.value,'$.totalTokens') ELSE 0 END),0)
        FROM json_each(COALESCE(json_extract(live.result_json,'$.providerSubmissions'),'{}')) receipt)+?<=?)`,
      bindings:[job.job_id,frame.identity.actorUserId,job.stream_id,job.correlation_id,job.attempt_count,new Date().toISOString(),attempt.maximumInputTokens+attempt.maximumOutputTokens,slot.maximumTokens]},
    {sql:`EXISTS(SELECT 1 FROM cost_budget_reservations cost JOIN budget_reservations token
      ON token.owner_id=cost.owner_id AND token.stream_id=cost.stream_id AND token.correlation_id=cost.correlation_id AND token.period=cost.period AND token.operation=cost.operation
      WHERE cost.reservation_id=? AND token.reservation_id=? AND cost.owner_id=? AND cost.stream_id=? AND cost.correlation_id=? AND cost.operation='image-generation' AND cost.period=?
        AND cost.reserved_microusd=? AND token.reserved_tokens=? AND cost.status='executing' AND token.status='active')`,
      bindings:[slot.costReservationId,slot.tokenReservationId,frame.identity.payerUserId,job.stream_id,job.correlation_id,period,slot.maximumMicrousd,slot.maximumTokens]}];
  frame.assertCurrent();
  return claimProviderCall(env,{scope,slotId:slot.slotId,jobId:job.job_id,callKey,clientRequestId:attempt.clientRequestId,
    requestDigest:attempt.requestDigest,provider:route.provider,model:route.model,maximumMicrousd:route.maximumMicrousd,
    expectedHead:proof.head,sourceDigest:proof.sourceDigest,routeDigest:slot.routeDigest,stageKey:callKey,sourceEpoch:proof.sourceEpoch,assertions},
    {assertions:frame.assertions,assertCurrent:frame.assertCurrent,refresh:frame.refresh});
}

// The canonical entry retains its own scope gate. The guest entry can select
// another gate only after the separately branded registry proves that identity.
async function claimProviderCall(env:WorkerEnv,input:OutputProviderCallInput,guest?:{assertions:readonly OutputSqlAssertion[];assertCurrent:()=>void;refresh:()=>Promise<void>}) {
  if (!input.callKey || !input.clientRequestId || !input.requestDigest || !Number.isSafeInteger(input.maximumMicrousd) || input.maximumMicrousd <= 0 || !input.assertions.length) throw new OutputConflictError("provider_call_authority_required", 403);
  if (input.sourceEpoch && (input.sourceEpoch.sourceDigest !== input.sourceDigest || input.sourceEpoch.head !== input.expectedHead)) throw new OutputConflictError("output_source_epoch_mismatch", 403);
  const now = new Date().toISOString();
  const slotAuthority: OutputSqlAssertion = {
    sql: `EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row
      ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      WHERE slot.scope_key=? AND slot.slot_id=? AND slot.job_id=? AND slot.route_digest=? AND slot.source_digest=?
        AND EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id
          AND route.stage_key=? AND route.provider=? AND route.model=?
          AND (SELECT COUNT(*) FROM output_provider_calls calls WHERE calls.scope_key=route.scope_key AND calls.slot_id=route.slot_id AND calls.stage_key=route.stage_key)<route.maximum_calls)
        AND slot.status IN('queued','running') AND grant_row.status IN('authorized','active') AND grant_row.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND grant_row.actor_user_id=?
        AND grant_row.context_id IS ?
        AND NOT EXISTS(SELECT 1 FROM output_provider_calls unresolved WHERE unresolved.scope_key=slot.scope_key AND unresolved.slot_id=slot.slot_id AND (unresolved.used_microusd IS NULL OR unresolved.status IN('pending','uncertain')))
        AND (SELECT COUNT(*) FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)<slot.maximum_calls
        AND (SELECT COALESCE(SUM(CASE WHEN calls.used_microusd IS NULL THEN calls.reserved_microusd ELSE calls.used_microusd END),0)
          FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)+?<=slot.maximum_microusd
        AND (SELECT COALESCE(SUM(CASE WHEN calls.used_microusd IS NULL THEN calls.reserved_microusd ELSE calls.used_microusd END),0)
          FROM output_provider_calls calls JOIN output_operation_slots child ON child.scope_key=calls.scope_key AND child.slot_id=calls.slot_id
          WHERE child.scope_key=grant_row.scope_key AND child.grant_id=grant_row.grant_id)+?<=grant_row.maximum_microusd)`,
    bindings: [input.scope.key, input.slotId, input.jobId, input.routeDigest, input.sourceDigest, input.stageKey, input.provider, input.model, now, input.scope.actorUserId, input.scope.contextId, input.maximumMicrousd, input.maximumMicrousd],
  };
  const guards = [...(guest?guest.assertions:[outputScopeAuthority(input.scope, "request", now)]), slotAuthority,
    input.sourceEpoch ? outputSourceEpochAssertion(input.scope, input.sourceEpoch) : { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${input.scope.ownerUserId}`, input.expectedHead] } as OutputSqlAssertion,
    ...input.assertions];
  try {
    guest?.assertCurrent();
    const statements=[
      ...guards.flatMap((guard) => outputAssertionStatements(env, guard)),
      env.DB.prepare(`INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`).bind(input.scope.key, input.slotId, input.callKey, input.clientRequestId, input.requestDigest, input.stageKey, input.provider, input.model, input.maximumMicrousd, now),
      env.DB.prepare("UPDATE output_operation_slots SET status='running',updated_at=? WHERE scope_key=? AND slot_id=?").bind(now, input.scope.key, input.slotId),
      ...outputAssertionStatements(env, { sql: "changes()=1" }),
    ];
    const results=await env.DB.batch(statements);
    guest?.assertCurrent();
    if(guest){
      const own=(value:unknown,key:PropertyKey):unknown=>value&&typeof value==="object"?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
      const hasError=(value:unknown)=>{if(!value||typeof value!=="object"||!("error" in value))return false;const field=Object.getOwnPropertyDescriptor(value,"error");return !field||!Object.hasOwn(field,"value")||field.value!==undefined;};
      const expected=statements.length;
      if(!Array.isArray(results)||own(results,"length")!==expected||Array.from({length:expected},(_,index)=>{
        const result=own(results,index);return own(result,"success")!==true||hasError(result)||!Array.isArray(own(result,"results"));
      }).some(Boolean)||[guards.length*2,guards.length*2+1].some(index=>
        own(own(own(results,index),"meta"),"changes")!==1))throw new OutputConflictError("output_guest_provider_claim_acknowledgement_uncertain",409);
    }
  } catch (error) {
    guest?.assertCurrent();if(guest){await guest.refresh();guest.assertCurrent();}
    const replay = await env.DB.prepare("SELECT request_digest,status,client_request_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=?")
      .bind(input.scope.key, input.slotId, input.callKey).first<Record<string, unknown>>();
    guest?.assertCurrent();if(guest){await guest.refresh();guest.assertCurrent();}
    if (replay) {
      if (replay.request_digest !== input.requestDigest) throw new OutputConflictError("provider_call_key_collision");
      return { claimed: false, status: String(replay.status), clientRequestId: String(replay.client_request_id) };
    }
    if (String(error).includes("constraint failed")) throw new OutputConflictError("output_provider_call_not_authorized", 403);
    throw error;
  }
  return { claimed: true, status: "pending", clientRequestId: input.clientRequestId };
}

/** Observes true provider cost; existing account reservations perform the only billing settlement. */
export async function settleOutputProviderCall(env: WorkerEnv, input: {
  scopeKey: string; slotId: string; callKey: string; clientRequestId: string; usedMicrousd: number | null;
  status: "settled" | "uncertain" | "rejected"; providerResponseId?: string;
  /** HTTP reconciliation supplies current caller/job authority; provider observers omit it. */
  assertions?: OutputSqlAssertion[];
  /** Internal source-free observation; committed atomically with this receipt. */
  financialCheckpoint?: OutputProviderFinancialCheckpoint;
}) {
  if (input.usedMicrousd !== null && (!Number.isSafeInteger(input.usedMicrousd) || input.usedMicrousd < 0)) throw new Error("invalid_provider_cost");
  if (input.status === "settled" && input.usedMicrousd === null || input.status === "uncertain" && input.usedMicrousd !== null || input.status === "rejected" && input.usedMicrousd !== 0) throw new Error("invalid_provider_settlement");
  if (input.financialCheckpoint) {
    const { binding } = input.financialCheckpoint, { receipt } = binding;
    const status = receipt.status === "rejected" ? "rejected" : receipt.status === "completed" && receipt.costMicrousd !== undefined ? "settled" : "uncertain";
    const cost = status === "rejected" ? 0 : status === "settled" ? receipt.costMicrousd : null;
    if (binding.scopeKey !== input.scopeKey || binding.slotId !== input.slotId || binding.callKey !== input.callKey
      || receipt.clientRequestId !== input.clientRequestId || receipt.providerRequestId !== input.providerResponseId
      || status !== input.status || cost !== input.usedMicrousd) throw new Error("provider_observation_binding_mismatch");
  }
  const read = async () => {
    const proof = input.financialCheckpoint?.matches;
    const statement = env.DB.prepare(`SELECT used_microusd,status,provider_response_id,(${proof?.sql ?? "1"}) AS checkpoint_matches FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND client_request_id=?`)
      .bind(...(proof?.bindings ?? []), input.scopeKey, input.slotId, input.callKey, input.clientRequestId);
    if (!input.assertions?.length) return statement.first<Record<string, unknown>>();
    try {
      // A denied HTTP write cannot turn into an unauthorized canonical-receipt
      // read. Retest the caller's authority in the same transaction as replay.
      const rows = await env.DB.batch<Record<string, unknown>>([
        ...input.assertions.flatMap((assertion) => outputAssertionStatements(env, assertion)), statement,
      ]);
      return rows[rows.length - 1]?.results[0] ?? null;
    } catch (error) {
      if (String(error).includes("constraint failed")) throw new OutputConflictError("output_execution_authority_revoked", 403);
      throw error;
    }
  };
  const now = new Date().toISOString();
  try { await env.DB.batch([
    ...(input.assertions ?? []).flatMap((assertion) => outputAssertionStatements(env, assertion)),
    // Once acceptance identifies an external request, every later observation
    // belongs to that request. An omitted ID cannot erase it, and neither a
    // different ID nor a rejection can replace accepted-request custody.
    env.DB.prepare(`UPDATE output_provider_calls SET used_microusd=?,status=?,provider_response_id=COALESCE(provider_response_id,?),settled_at=?
      WHERE scope_key=? AND slot_id=? AND call_key=? AND client_request_id=? AND status IN('pending','uncertain')
        AND (provider_response_id IS NULL OR ? IS NULL OR provider_response_id=?)
        AND (?<>'rejected' OR provider_response_id IS NULL)`)
      .bind(input.usedMicrousd, input.status, input.providerResponseId ?? null, input.status === "uncertain" ? null : now, input.scopeKey, input.slotId, input.callKey, input.clientRequestId,
        input.providerResponseId ?? null, input.providerResponseId ?? null, input.status),
    ...outputAssertionStatements(env, { sql: "changes()=1" }),
    ...(input.financialCheckpoint ? [input.financialCheckpoint.write, ...outputAssertionStatements(env, { sql: "changes()=1" }),
      ...outputAssertionStatements(env, input.financialCheckpoint.matches)] : []),
    env.DB.prepare(`UPDATE output_execution_grants SET status='exceeded' WHERE scope_key=? AND grant_id=(SELECT grant_id FROM output_operation_slots WHERE scope_key=? AND slot_id=?)
      AND (EXISTS(SELECT 1 FROM output_operation_slots child WHERE child.scope_key=output_execution_grants.scope_key AND child.grant_id=output_execution_grants.grant_id
        AND (SELECT COALESCE(SUM(COALESCE(calls.used_microusd,calls.reserved_microusd)),0) FROM output_provider_calls calls WHERE calls.scope_key=child.scope_key AND calls.slot_id=child.slot_id)>child.maximum_microusd)
        OR (SELECT COALESCE(SUM(COALESCE(calls.used_microusd,calls.reserved_microusd)),0) FROM output_provider_calls calls JOIN output_operation_slots child ON child.scope_key=calls.scope_key AND child.slot_id=calls.slot_id
          WHERE child.scope_key=output_execution_grants.scope_key AND child.grant_id=output_execution_grants.grant_id)>maximum_microusd)`)
      .bind(input.scopeKey, input.scopeKey, input.slotId),
  ]); } catch (error) {
    // Attempt the guarded write first. A concurrent callback or lost D1
    // acknowledgement is successful only when the exact canonical receipt agrees.
    const committed = await read();
    if (committed && committed.status === input.status && committed.used_microusd === input.usedMicrousd
      && (input.providerResponseId === undefined || committed.provider_response_id === input.providerResponseId)
      && Number(committed.checkpoint_matches) === 1) return { replayed: true };
    if (committed?.provider_response_id && (input.status === "rejected" || input.providerResponseId !== undefined && committed.provider_response_id !== input.providerResponseId)) throw new OutputConflictError("provider_settlement_conflict");
    if (committed && ["settled", "rejected"].includes(String(committed.status))) throw new OutputConflictError("provider_settlement_conflict");
    if (!committed && String(error).includes("constraint failed")) throw new OutputConflictError("output_provider_call_missing", 404);
    throw error;
  }
  return { replayed: false };
}
