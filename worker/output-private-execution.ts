import { markOutputSchemaReady, outputSchemaIsReady } from "./output-schema-state.ts";
import { inheritRuntimeSchemaReadiness, type WorkerEnv } from "./runtime.ts";
import { outputAssertionStatements, OutputConflictError, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";

const privateWrite = (sql: string) => /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|REPLACE\s+INTO)\s+(?:event_write_stage|event_private_payloads|private_content|document_artifact_revisions|events)\b/iu.test(sql)
  || /\bUPDATE\s+document_jobs\s+SET\b[\s\S]*(?:result_json|request_json|lease_expires_at)/iu.test(sql);

/** Existing writers run unchanged, with the same transaction guarding their private writes. */
export function guardOutputPrivateWrites(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot, assertions: () => Promise<OutputSqlAssertion[]>,options:{retentionPolicy?:Record<string,unknown>|null}={}): WorkerEnv {
  const nativeKeys = new Map<string, string>();
  // The private-content INSERT also checks this exact policy version in its
  // transaction. Reusing one request-local read never bypasses a policy change.
  let retentionPolicy:Promise<unknown>|undefined=Object.hasOwn(options,"retentionPolicy")?Promise.resolve(options.retentionPolicy):undefined;
  const retentionQuery="SELECT transient_days,evidence_days,version FROM organization_retention_policies WHERE organization_id=?";
  const statements = new WeakMap<D1PreparedStatement, { statement: D1PreparedStatement; sql: string }>();
  const guardedBatch = async (inputs: D1PreparedStatement[], force = false) => {
    const unwrapped = inputs.map(input => statements.get(input) ?? { statement: input, sql: "" });
    const guards = force || unwrapped.some(input => privateWrite(input.sql))
      ? (await assertions()).flatMap(assertion => outputAssertionStatements(env, assertion)) : [];
    const publication = guards.length ? [...nativeKeys].map(([storageKey, hash]) => env.DB.prepare(`UPDATE output_native_storage_writes SET publication_event_id=(
      SELECT completed.event_id FROM events completed JOIN event_private_payloads body ON body.private_event_id=completed.event_id
      JOIN output_operation_slots slot ON slot.scope_key=? AND slot.slot_id=? JOIN document_jobs job ON job.job_id=slot.job_id
      WHERE completed.type='GenerationCompleted' AND completed.stream_id=job.stream_id AND completed.correlation_id=job.correlation_id
       AND json_extract(body.private_json,'$.document_id')=? AND json_extract(body.private_json,'$.media_url')=? AND body.redacted_at IS NULL
      ORDER BY completed.sequence DESC LIMIT 1),updated_at=?
      WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND publication_event_id IS NULL`)
      .bind(scope.key,slot.slotId,scope.documentId,`/api/media/${encodeURIComponent(storageKey)}`,new Date().toISOString(),scope.key,slot.slotId,storageKey,hash)) : [];
    const result = await env.DB.batch([...guards, ...unwrapped.map(input => input.statement), ...publication]);
    return result.slice(guards.length,guards.length+inputs.length);
  };
  const wrap = (statement: D1PreparedStatement, sql: string, bindings:unknown[]=[]): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === "bind") return (...bindings: unknown[]) => wrap(target.bind(...bindings), sql,bindings);
        if (key === "first" && sql.trim()===retentionQuery && bindings.length===1 && bindings[0]===scope.organizationId) return async (...args:unknown[])=>{
          if(args.length)return Reflect.apply(target.first,target,args);
          retentionPolicy??=target.first();
          return structuredClone(await retentionPolicy);
        };
        if (key === "run" && privateWrite(sql)) return async () => (await guardedBatch([wrapped]))[0]!;
        // Private mutation helpers use run/batch. Do not permit an unguarded alternative execution form.
        if ((key === "first" || key === "all" || key === "raw") && privateWrite(sql)) return () => { throw new OutputConflictError("output_private_write_form_unsupported", 500); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    statements.set(wrapped, { statement, sql });
    return wrapped;
  };
  const DB = new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
      if (key === "batch") return (inputs: D1PreparedStatement[]) => guardedBatch(inputs);
      if (key === "withSession") return () => { throw new OutputConflictError("output_private_session_unsupported", 500); };
      if (key === "exec") return (sql: string) => {
        if (privateWrite(sql)) throw new OutputConflictError("output_private_write_form_unsupported", 500);
        const execute=Reflect.get(target,"exec",target);
        if(typeof execute!=="function")throw new OutputConflictError("output_private_write_form_unsupported",500);
        return execute.call(target,sql);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  if(outputSchemaIsReady(env.DB))markOutputSchemaReady(DB);
  inheritRuntimeSchemaReadiness(env.DB,DB);
  const MEDIA = new Proxy(env.MEDIA, {
    get(target, key) {
      if (key === "createMultipartUpload" || key === "resumeMultipartUpload") return () => { throw new OutputConflictError("output_native_multipart_unavailable", 422); };
      if (key !== "put") {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (storageKey: string, value: Parameters<R2Bucket["put"]>[1], options?: Parameters<WorkerEnv["MEDIA"]["put"]>[2]) => {
        let bytes: Uint8Array;
        if (typeof value === "string") bytes = new TextEncoder().encode(value);
        else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
        else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        else if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
        else throw new OutputConflictError("output_native_storage_input_unsupported", 422);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)), byte => byte.toString(16).padStart(2, "0")).join("");
        const now = new Date().toISOString();
        nativeKeys.set(storageKey,hash);
        await guardedBatch([
          env.DB.prepare("INSERT INTO output_native_storage_writes(scope_key,slot_id,storage_key,content_sha256,status,write_acknowledged,created_at,updated_at) VALUES(?,?,?,?,'writing',0,?,?)")
            .bind(scope.key, slot.slotId, storageKey, hash, now, now),
        ], true);
        let acknowledged = false;
        try {
          const stored = await target.put(storageKey, value, {...options,customMetadata:{...options?.customMetadata,outputNativeStorage:"1",outputScopeKey:scope.key,outputSlotId:slot.slotId,outputOwnerId:scope.ownerUserId,outputDocumentId:scope.documentId,outputSha256:hash}});
          if (!stored) throw new Error("output_native_storage_write_not_confirmed");
          acknowledged = true;
          await guardedBatch([env.DB.prepare("UPDATE output_native_storage_writes SET write_acknowledged=1,status=CASE WHEN status='writing' THEN 'written' ELSE status END,updated_at=? WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=?")
            .bind(new Date().toISOString(), scope.key, slot.slotId, storageKey, hash)],true);
          return stored;
        } catch (error) {
          await env.DB.prepare("UPDATE output_native_storage_writes SET status='cleanup_pending',write_acknowledged=MAX(write_acknowledged,?),updated_at=? WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=?")
            .bind(Number(acknowledged), new Date().toISOString(), scope.key, slot.slotId, storageKey, hash).run();
          await cleanupNativeStorageReceipt(env, { scope_key: scope.key, slot_id: slot.slotId, storage_key: storageKey, content_sha256:hash,owner_user_id:scope.ownerUserId,document_id:scope.documentId,write_acknowledged: Number(acknowledged) });
          throw error;
        }
      };
    },
  });
  return { ...env, DB, MEDIA };
}

type NativeStorageReceipt = { scope_key: string; slot_id: string; storage_key: string; content_sha256:string;owner_user_id:string;document_id:string;write_acknowledged: number;updated_at?:string };

async function cleanupNativeStorageReceipt(env: WorkerEnv, receipt: NativeStorageReceipt): Promise<boolean> {
  try {
    const object=await env.MEDIA.head(receipt.storage_key);
    if(object){
      const metadata=object.customMetadata??{};
      if(metadata.outputNativeStorage!=="1"||metadata.outputScopeKey!==receipt.scope_key||metadata.outputSlotId!==receipt.slot_id||metadata.outputOwnerId!==receipt.owner_user_id||metadata.outputDocumentId!==receipt.document_id||metadata.outputSha256!==receipt.content_sha256)return false;
      await env.MEDIA.delete(receipt.storage_key);
    }
    if (await env.MEDIA.head(receipt.storage_key)) return false;
    // A PUT without a durable acknowledgement may still finish after this delete.
    if (!receipt.write_acknowledged) return false;
    await env.DB.prepare("UPDATE output_native_storage_writes SET status='deleted',updated_at=? WHERE scope_key=? AND slot_id=? AND storage_key=? AND status='cleanup_pending' AND write_acknowledged=1")
      .bind(new Date().toISOString(), receipt.scope_key, receipt.slot_id, receipt.storage_key).run();
    return true;
  } catch { return false; }
}

/** Operational cleanup retains unknown storage writes and never reads private file content. */
export async function reconcileOutputNativeStorage(env: WorkerEnv, filter: { ownerUserId?: string; organizationId?: string; personalOnly?: boolean; limit?: number }) {
  if (!filter.ownerUserId && !filter.organizationId) throw new Error("output_storage_cleanup_scope_required");
  const now = new Date().toISOString();
  const limit=Number.isSafeInteger(filter.limit)&&Number(filter.limit)>0?Math.min(64,Number(filter.limit)):64;
  await env.DB.prepare(`UPDATE output_native_storage_writes SET status='cleanup_pending',updated_at=? WHERE status IN('writing','written') AND publication_event_id IS NULL
    AND EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      WHERE slot.scope_key=output_native_storage_writes.scope_key AND slot.slot_id=output_native_storage_writes.slot_id
      AND (grant_row.status='revoked' OR grant_row.expires_at<=?)
      AND (? IS NULL OR plan.owner_user_id=?) AND (? IS NULL OR plan.organization_id=?)
      AND (?=0 OR (plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL)))`)
    .bind(now, now, filter.ownerUserId ?? null, filter.ownerUserId ?? null, filter.organizationId ?? null, filter.organizationId ?? null, Number(filter.personalOnly === true)).run();
  const receipts = await env.DB.prepare(`SELECT stored.scope_key,stored.slot_id,stored.storage_key,stored.content_sha256,stored.write_acknowledged,stored.updated_at,plan.owner_user_id,plan.document_id
    FROM output_native_storage_writes stored JOIN output_operation_slots slot ON slot.scope_key=stored.scope_key AND slot.slot_id=stored.slot_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    WHERE stored.status='cleanup_pending' AND stored.publication_event_id IS NULL AND (? IS NULL OR plan.owner_user_id=?) AND (? IS NULL OR plan.organization_id=?)
      AND (?=0 OR (plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL))
    ORDER BY stored.updated_at,stored.storage_key LIMIT ?`)
    .bind(filter.ownerUserId ?? null, filter.ownerUserId ?? null, filter.organizationId ?? null, filter.organizationId ?? null, Number(filter.personalOnly === true),limit).all<NativeStorageReceipt>();
  let reconciled = 0;
  for (const receipt of receipts.results) {
    if (await cleanupNativeStorageReceipt(env, receipt)) reconciled++;
    else {
      // Unknown acknowledgements remain pending, but cannot starve later cleanup work.
      const attemptedAt=new Date(Math.max(Date.now(),(Date.parse(receipt.updated_at??"")||0)+1)).toISOString();
      await env.DB.prepare("UPDATE output_native_storage_writes SET updated_at=? WHERE scope_key=? AND slot_id=? AND storage_key=? AND status='cleanup_pending' AND publication_event_id IS NULL")
        .bind(attemptedAt,receipt.scope_key,receipt.slot_id,receipt.storage_key).run();
    }
  }
  const remaining=await env.DB.prepare(`SELECT COUNT(*) AS pending FROM output_native_storage_writes stored
    JOIN output_operation_slots slot ON slot.scope_key=stored.scope_key AND slot.slot_id=stored.slot_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    WHERE stored.status='cleanup_pending' AND stored.publication_event_id IS NULL
      AND (? IS NULL OR plan.owner_user_id=?) AND (? IS NULL OR plan.organization_id=?)
      AND (?=0 OR (plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL))`)
    .bind(filter.ownerUserId??null,filter.ownerUserId??null,filter.organizationId??null,filter.organizationId??null,Number(filter.personalOnly===true)).first<{pending:number}>();
  return { reconciled, pending:Number(remaining?.pending??0) };
}
