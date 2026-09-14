import { retainedPersonalFalRecoverySql } from "./output-fal-recovery-policy.ts";
import { markOutputSchemaReady, outputSchemaIsReady } from "./output-schema-state.ts";
import { inheritRuntimeSchemaReadiness, type WorkerEnv } from "./runtime.ts";
import { outputAssertionStatements, OutputConflictError, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";

const privateWrite = (sql: string) => /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|REPLACE\s+INTO)\s+(?:event_write_stage|event_private_payloads|private_content|document_artifact_revisions|events)\b/iu.test(sql)
  || /\bUPDATE\s+document_jobs\s+SET\b[\s\S]*(?:result_json|request_json|lease_expires_at)/iu.test(sql);

/** Existing writers run unchanged, with the same transaction guarding their private writes. */
export function guardOutputPrivateWrites(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot, assertions: () => Promise<OutputSqlAssertion[]>,options:{retentionPolicy?:Record<string,unknown>|null;storyboardCompletionJson?:()=>string|undefined;videoCompletionJson?:()=>string|undefined;model3dCompletionJson?:()=>string|undefined}={}): WorkerEnv {
  const nativeKeys = new Map<string, string>();
  // The private-content INSERT also checks this exact policy version in its
  // transaction. Reusing one request-local read never bypasses a policy change.
  let retentionPolicy:Promise<unknown>|undefined=Object.hasOwn(options,"retentionPolicy")?Promise.resolve(options.retentionPolicy):undefined;
  const retentionQuery="SELECT transient_days,evidence_days,version FROM organization_retention_policies WHERE organization_id=?";
  const statements = new WeakMap<D1PreparedStatement, { statement: D1PreparedStatement; sql: string }>();
  const guardedBatch = async (inputs: D1PreparedStatement[], force = false) => {
    const unwrapped = inputs.map(input => statements.get(input) ?? { statement: input, sql: "" });
    const capturedAssertions = force || unwrapped.some(input => privateWrite(input.sql))
      ? (await assertions()).map(assertion => ({ ...assertion, bindings: [...(assertion.bindings ?? [])] })) : [];
    const guards = capturedAssertions.flatMap(assertion => outputAssertionStatements(env, assertion));
    // Only the execution hook can supply this immutable, verified receipt; an
    // event's self-described settings alone cannot retain native storage.
    // Audio separately binds its original approved job/slot and settled calls.
    const storyboardCompletion=options.storyboardCompletionJson?.()??null;
    const videoCompletion=options.videoCompletionJson?.()??null;
    const model3dCompletion=options.model3dCompletionJson?.()??null;
    const publication = guards.length ? [...nativeKeys].map(([storageKey, hash]) => env.DB.prepare(`UPDATE output_native_storage_writes SET publication_event_id=(
      SELECT completed.event_id FROM events completed JOIN event_private_payloads body ON body.private_event_id=completed.event_id
      JOIN output_operation_slots slot ON slot.scope_key=? AND slot.slot_id=? JOIN document_jobs job ON job.job_id=slot.job_id
      WHERE completed.stream_id=job.stream_id AND completed.correlation_id=job.correlation_id
       AND json_extract(body.private_json,'$.document_id')=? AND body.redacted_at IS NULL
       AND (completed.type='GenerationCompleted' AND json_extract(body.private_json,'$.media_url')=?
        OR completed.type='DocumentRenderCompleted' AND completed.actor='worker:renderer' AND body.owner_id=job.owner_id AND body.document_id=job.document_id
        AND json_extract(body.private_json,'$.artifact_kind')='storyboard' AND json_extract(body.private_json,'$.source_surface')='outputs'
        AND json_extract(body.private_json,'$.requested_by_user_id')=job.owner_id
        AND json_extract(body.private_json,'$.artifact_id')=json_extract(job.result_json,'$.artifactId')
        AND json_extract(body.private_json,'$.settings.output_storyboard')=json(?)
        AND json_extract(body.private_json,'$.settings.output_storyboard.jobId')=job.job_id
        AND json_extract(body.private_json,'$.settings.output_storyboard.slotId')=slot.slot_id
        AND json_extract(body.private_json,'$.settings.output_storyboard.actorUserId')=job.owner_id
        AND json_extract(body.private_json,'$.settings.output_storyboard.documentId')=job.document_id
        AND json_extract(body.private_json,'$.settings.output_storyboard.streamId')=job.stream_id
        AND json_extract(body.private_json,'$.settings.output_storyboard.correlationId')=job.correlation_id
        AND json_extract(body.private_json,'$.settings.output_storyboard.version')='output-storyboard-completion-v1'
        AND json_extract(body.private_json,'$.item_count')=4 AND json_type(body.private_json,'$.items')='array'
        AND json_array_length(body.private_json,'$.items')=4
        AND NOT EXISTS(SELECT 1 FROM json_each(body.private_json,'$.items') item
          LEFT JOIN json_each(body.private_json,'$.settings.output_storyboard.frames') frame ON frame.key=item.key
          WHERE frame.type IS NOT 'object' OR item.type IS NOT 'object'
           OR json_extract(frame.value,'$.frameIndex') IS NOT item.key
           OR json_extract(item.value,'$.id') IS NOT json_extract(frame.value,'$.id')
           OR json_extract(item.value,'$.media_url') IS NOT json_extract(frame.value,'$.mediaUrl')
           OR json_extract(item.value,'$.media_type') IS NOT json_extract(frame.value,'$.mimeType')
           OR json_extract(item.value,'$.width') IS NOT json_extract(frame.value,'$.width')
           OR json_extract(item.value,'$.height') IS NOT json_extract(frame.value,'$.height'))
        AND EXISTS(SELECT 1 FROM json_each(body.private_json,'$.settings.output_storyboard.frames') frame
          WHERE json_extract(frame.value,'$.mediaUrl')=? AND json_extract(frame.value,'$.sha256')=?)
        OR completed.type='DocumentRenderCompleted' AND completed.actor='worker:renderer' AND body.owner_id=job.owner_id AND body.document_id=job.document_id
        AND output_native_storage_writes.write_acknowledged=1
        AND json_extract(body.private_json,'$.artifact_kind')='video' AND json_extract(body.private_json,'$.source_surface')='outputs'
        AND json_extract(body.private_json,'$.requested_by_user_id')=job.owner_id
        AND json_extract(body.private_json,'$.settings.output_video')=json(?)
        AND json_extract(body.private_json,'$.settings.output_video.version')='output-video-completion-v1'
        AND json_extract(body.private_json,'$.settings.output_video.jobId')=job.job_id
        AND json_extract(body.private_json,'$.settings.output_video.slotId')=slot.slot_id
        AND json_extract(body.private_json,'$.settings.output_video.sourceDigest')=slot.source_digest
        AND json_extract(body.private_json,'$.settings.output_video.actorUserId')=job.owner_id
        AND json_extract(body.private_json,'$.settings.output_video.documentId')=job.document_id
        AND json_extract(body.private_json,'$.settings.output_video.correlationId')=job.correlation_id
        AND json_extract(body.private_json,'$.settings.output_video.contract')=json_extract(job.request_json,'$.outputVideo')
        AND json_extract(body.private_json,'$.artifact_id')=json_extract(body.private_json,'$.settings.output_video.artifactId')
        AND json_extract(body.private_json,'$.media_url')=? AND json_extract(body.private_json,'$.media_type')='video/mp4'
        AND json_extract(body.private_json,'$.settings.output_video.media.mediaUrl')=json_extract(body.private_json,'$.media_url')
        AND json_extract(body.private_json,'$.settings.output_video.media.sha256')=?
        AND json_extract(body.private_json,'$.settings.output_video.media.providerRequestId')=json_extract(body.private_json,'$.provider_job_id')
        AND json_extract(body.private_json,'$.item_count')=1 AND json_extract(body.private_json,'$.settings.output_video.providerCallCount')=2
        AND json_extract(body.private_json,'$.settings.source_media_sha256')=json_extract(body.private_json,'$.settings.output_video.media.sha256')
        AND json_type(body.private_json,'$.items')='array' AND json_array_length(body.private_json,'$.items')=1
        AND json_extract(body.private_json,'$.items[0].id')=json_extract(body.private_json,'$.artifact_id')||'-item-1'
        AND json_extract(body.private_json,'$.items[0].media_url')=json_extract(body.private_json,'$.media_url')
        AND json_extract(body.private_json,'$.items[0].media_type')='video/mp4'
        OR completed.type='DocumentRenderCompleted' AND completed.actor='worker:renderer'
        AND ?='personal' AND job.owner_id=? AND job.kind='render_document'
        AND output_native_storage_writes.write_acknowledged=1 AND body.owner_id=job.owner_id AND body.document_id=job.document_id
        AND json_extract(body.private_json,'$.artifact_kind')='model3d'
        AND json_extract(body.private_json,'$.source_surface')='outputs'
        AND json_extract(body.private_json,'$.requested_by_user_id')=job.owner_id
        AND json_extract(body.private_json,'$.artifact_id')=json_extract(job.result_json,'$.artifactId')
        AND json_extract(body.private_json,'$.settings.output_model3d')=json(?)
        AND json_extract(body.private_json,'$.settings.output_model3d.jobId')=job.job_id
        AND json_extract(body.private_json,'$.settings.output_model3d.actorUserId')=job.owner_id
        AND json_extract(body.private_json,'$.settings.output_model3d.documentId')=job.document_id
        AND json_extract(body.private_json,'$.settings.output_model3d.artifactId')=json_extract(body.private_json,'$.artifact_id')
        AND json_extract(body.private_json,'$.settings.output_model3d.contract')=json_extract(job.request_json,'$.outputModel3d')
        AND json_extract(body.private_json,'$.settings.output_model3d.execution')=json_extract(job.request_json,'$.outputExecution')
        AND json_extract(body.private_json,'$.settings.output_model3d.execution.slotId')=slot.slot_id
        AND json_extract(body.private_json,'$.settings.output_model3d.execution.targetContractDigest')=slot.target_contract_digest
        AND json_extract(body.private_json,'$.settings.output_model3d.execution.sourceDigest')=slot.source_digest
        AND json_extract(job.request_json,'$.model3dCostConsent.requestId')=job.job_id
        AND json_type(job.request_json,'$.model3dCostConsent.confirmed')='true'
        AND json_type(job.request_json,'$.model3dCostConsent.providerTransferConfirmed')='true'
        AND EXISTS(SELECT 1 FROM json_each(body.private_json,'$.settings.output_model3d.files') file
          WHERE json_extract(file.value,'$.url')=? AND json_extract(file.value,'$.sha256')=?)
        AND (SELECT COUNT(*) FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id)=1
        AND EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id
          AND call.call_key='model3d:initial' AND call.stage_key='model3d:initial' AND call.provider='fal'
          AND call.model=json_extract(job.request_json,'$.model3dCostConsent.model')
          AND call.status='settled' AND call.used_microusd=json_extract(job.request_json,'$.model3dCostConsent.maximumMicrousd')
          AND call.client_request_id=json_extract(body.private_json,'$.settings.output_model3d.receipt.mediaCallId')
          AND call.provider_response_id=json_extract(body.private_json,'$.settings.output_model3d.receipt.providerRequestId')
          AND call.provider_response_id=json_extract(body.private_json,'$.provider_job_id')
          AND call.request_digest=json_extract(body.private_json,'$.settings.output_model3d.receipt.requestDigest'))
        OR completed.type='DocumentRenderCompleted' AND completed.actor='worker:renderer'
        AND ?='personal' AND job.owner_id=? AND job.kind='render_document'
        AND output_native_storage_writes.write_acknowledged=1
        AND body.owner_id=job.owner_id AND body.document_id=job.document_id
        AND json_extract(body.private_json,'$.artifact_kind')='audio'
        AND json_extract(body.private_json,'$.source_surface')='outputs'
        AND json_extract(body.private_json,'$.requested_by_user_id')=job.owner_id
        AND json_extract(body.private_json,'$.artifact_id')=json_extract(job.result_json,'$.artifactId')
        AND json_extract(body.private_json,'$.media_type')='audio/mpeg'
        AND json_extract(body.private_json,'$.media_url')=?
        AND json_extract(body.private_json,'$.settings.source_media_sha256')=?
        AND json_extract(body.private_json,'$.item_count')=1
        AND json_type(body.private_json,'$.items')='array' AND json_array_length(body.private_json,'$.items')=1
        AND json_extract(job.request_json,'$.outputAudio.schemaVersion')=1
        AND json_extract(job.request_json,'$.outputAudio.id')='forma.audio.instrumental-20@1'
        AND json_extract(job.request_json,'$.outputAudio.artifactKind')='audio'
        AND json_extract(job.request_json,'$.outputAudio.productionMode')='manual'
        AND json_extract(job.request_json,'$.outputAudio.trackCount')=1
        AND json_extract(job.request_json,'$.outputAudio.role')='score'
        AND json_extract(job.request_json,'$.outputAudio.goal')='timed_music'
        AND json_extract(job.request_json,'$.outputAudio.destination')='standalone'
        AND json_extract(job.request_json,'$.outputAudio.durationSeconds')=20
        AND json_type(job.request_json,'$.outputAudio.requireInstrumental')='true'
        AND json_extract(job.request_json,'$.audioCostConsent.requestId')=job.job_id
        AND json_type(job.request_json,'$.audioCostConsent.confirmed')='true'
        AND json_type(job.request_json,'$.audioCostConsent.providerTransferConfirmed')='true'
        AND json_extract(job.request_json,'$.audioCostConsent.actorUserId')=job.owner_id
        AND json_extract(job.request_json,'$.audioCostConsent.documentId')=job.document_id
        AND json_extract(job.request_json,'$.audioCostConsent.sourceDigest')=slot.source_digest
        AND json_extract(job.request_json,'$.audioCostConsent.draftId')=json_extract(job.request_json,'$.outputAudio.source.draftId')
        AND json_extract(body.private_json,'$.project_id')=json_extract(job.request_json,'$.audioCostConsent.projectId')
        AND json_extract(body.private_json,'$.settings.output_audio')=json_extract(job.request_json,'$.outputAudio')
        AND json_extract(body.private_json,'$.settings.output_audio_execution')=json_extract(job.request_json,'$.outputExecution')
        AND json_extract(job.request_json,'$.outputExecution.scopeKey')=slot.scope_key
        AND json_extract(job.request_json,'$.outputExecution.slotId')=slot.slot_id
        AND json_extract(job.request_json,'$.outputExecution.grantId')=slot.grant_id
        AND json_extract(job.request_json,'$.outputExecution.planRevisionId')=slot.plan_revision_id
        AND json_extract(job.request_json,'$.outputExecution.targetId')=slot.target_id
        AND json_extract(job.request_json,'$.outputExecution.targetContractDigest')=slot.target_contract_digest
        AND json_extract(job.request_json,'$.outputExecution.sourceDigest')=slot.source_digest
        AND json_extract(body.private_json,'$.settings.output_audio_receipt.schemaVersion')=1
        AND json_extract(body.private_json,'$.settings.output_audio_receipt.contract')=json_extract(job.request_json,'$.outputAudio')
        AND json_extract(body.private_json,'$.settings.output_audio_receipt.requestedSeconds')=20
        AND json_type(body.private_json,'$.settings.output_audio_receipt.measuredSeconds')='null'
        AND json_type(body.private_json,'$.settings.output_audio_receipt.requirementFulfilled')='false'
        AND json_type(body.private_json,'$.settings.output_audio_receipt.plannerCallIds')='array'
        AND json_array_length(body.private_json,'$.settings.output_audio_receipt.plannerCallIds') BETWEEN 1 AND 2
        AND (SELECT COUNT(DISTINCT value) FROM json_each(body.private_json,'$.settings.output_audio_receipt.plannerCallIds'))=json_array_length(body.private_json,'$.settings.output_audio_receipt.plannerCallIds')
        AND (SELECT COUNT(*) FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id)=json_array_length(body.private_json,'$.settings.output_audio_receipt.plannerCallIds')+1
        AND NOT EXISTS(SELECT 1 FROM json_each(body.private_json,'$.settings.output_audio_receipt.plannerCallIds') original
          LEFT JOIN output_provider_calls call ON call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND call.client_request_id=original.value
          WHERE original.type IS NOT 'text' OR call.status IS NOT 'settled' OR call.provider IS NOT 'openai'
            OR call.model IS NOT 'gpt-5.6-terra' OR call.stage_key NOT IN('planning:0:initial','planning:0:repair'))
        AND EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id
          AND call.stage_key='planning:0:initial' AND call.status='settled')
        AND EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id
          AND call.stage_key='audio:initial' AND call.provider='fal' AND call.model='fal-ai/stable-audio-3/medium/text-to-audio'
          AND call.status='settled' AND call.used_microusd>0
          AND call.client_request_id=json_extract(body.private_json,'$.settings.output_audio_receipt.mediaCallId')
          AND call.provider_response_id=json_extract(body.private_json,'$.settings.output_audio_receipt.providerRequestId')
          AND call.provider_response_id=json_extract(body.private_json,'$.provider_job_id')
          AND call.request_digest=json_extract(body.private_json,'$.settings.output_audio_receipt.requestDigest')))
      ORDER BY completed.sequence DESC LIMIT 1),updated_at=?
      WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND publication_event_id IS NULL`)
      .bind(scope.key,slot.slotId,scope.documentId,`/api/media/${encodeURIComponent(storageKey)}`,storyboardCompletion,`/api/media/${encodeURIComponent(storageKey)}`,hash,videoCompletion,`/api/media/${encodeURIComponent(storageKey)}`,hash,scope.kind,scope.ownerUserId,model3dCompletion,`/api/media/${encodeURIComponent(storageKey)}`,hash,scope.kind,scope.ownerUserId,`/api/media/${encodeURIComponent(storageKey)}`,hash,new Date().toISOString(),scope.key,slot.slotId,storageKey,hash)) : [];
    try {
      const result = await env.DB.batch([...guards, ...unwrapped.map(input => input.statement), ...publication]);
      if (!Array.isArray(result) || result.length !== guards.length + inputs.length + publication.length
        || Array.from({length:result.length},(_,index)=>index).some(index=>result[index]?.success !== true))
        throw new OutputConflictError("output_write_acknowledgment_invalid",409);
      return result.slice(guards.length,guards.length+inputs.length);
    } catch (error) {
      // This shared CHECK does not identify the original failing statement.
      // Re-read the SAME predicates only to diagnose whether the captured
      // authority can still be verified. Never refresh it, retry the write,
      // or infer that a guard caused the original transaction failure.
      if (capturedAssertions.length && error instanceof Error
        && /^(?:D1_ERROR:\s*)?CHECK constraint failed:\s*passed\s*=\s*1(?:\s*:\s*SQLITE_CONSTRAINT(?:_CHECK)?)?$/u.test(error.message)) {
        let authorityUnverified = false;
        try {
          const verification = await env.DB.batch<{ output_private_authority_passed: unknown }>(capturedAssertions.map(assertion => env.DB.prepare(
            `SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS output_private_authority_passed`,
          ).bind(...(assertion.bindings ?? []))));
          authorityUnverified = verification.length === capturedAssertions.length
            && verification.every(result => result.success === true && result.results.length === 1
              && (result.results[0]?.output_private_authority_passed === 0 || result.results[0]?.output_private_authority_passed === 1))
            && verification.some(result => result.results[0]?.output_private_authority_passed === 0);
        } catch {
          // Missing/unreadable proof cannot replace the original SQL failure.
        }
        if (authorityUnverified) {
          const refusal = new OutputConflictError("output_execution_authority_unverified", 409);
          Object.defineProperty(refusal, "cause", { value: error, configurable: true });
          throw refusal;
        }
      }
      throw error;
    }
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
  // Compile the complete personal recovery proof at its own query depth, then
  // reuse its exact grant identity inside the deeper storage-custody predicate.
  // Organization-only cleanup cannot retain a personal Fal recovery.
  await env.DB.prepare(`WITH retained_fal_grants AS MATERIALIZED (
    SELECT scope_key,grant_id FROM output_execution_grants WHERE actor_user_id=? AND ${retainedPersonalFalRecoverySql}
  ) UPDATE output_native_storage_writes SET status='cleanup_pending',updated_at=? WHERE status IN('writing','written') AND publication_event_id IS NULL
    AND EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      LEFT JOIN retained_fal_grants retained ON retained.scope_key=grant_row.scope_key AND retained.grant_id=grant_row.grant_id
      WHERE slot.scope_key=output_native_storage_writes.scope_key AND slot.slot_id=output_native_storage_writes.slot_id
      AND (grant_row.status='revoked' OR (grant_row.expires_at<=? AND NOT EXISTS(
        SELECT 1 FROM document_jobs recovery WHERE recovery.job_id=slot.job_id AND recovery.owner_id=grant_row.actor_user_id
          AND recovery.status='failed' AND (json_extract(recovery.result_json,'$.outputFalRecovery.version')='output-fal-recovery-v1'
          AND json_extract(recovery.result_json,'$.outputFalRecovery.clientRequestId')=json_extract(recovery.result_json,'$.outputFalCheckpoint.clientRequestId')
          AND length(json_extract(recovery.result_json,'$.outputFalRecovery.token'))=36
          AND output_native_storage_writes.storage_key=json_extract(recovery.result_json,'$.outputFalRecovery.storageKey')
          AND output_native_storage_writes.storage_key LIKE '%-recovery-'||json_extract(recovery.result_json,'$.outputFalRecovery.token')||'.png'
          AND retained.grant_id IS NOT NULL
          AND json_extract(recovery.result_json,'$.outputFalRecovery.expiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          OR recovery.kind='render_document' AND recovery.source_surface='outputs' AND recovery.document_id=plan.document_id AND plan.scope_kind='personal'
          AND plan.organization_id IS NULL AND plan.project_access_id IS NULL AND grant_row.context_id IS NULL
          AND recovery.owner_id=plan.owner_user_id AND recovery.stream_id='creative:'||plan.owner_user_id
          AND recovery.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND json_extract(recovery.request_json,'$.artifactKind')='video' AND json_type(recovery.result_json,'$.outputVideoStop') IS NULL
          AND json_extract(recovery.result_json,'$.outputVideoRecovery.version')='output-video-recovery-v1'
          AND length(json_extract(recovery.result_json,'$.outputVideoRecovery.token'))=36
          AND json_extract(recovery.result_json,'$.outputVideoRecovery.clientRequestId')=json_extract(recovery.result_json,'$.outputVideoMediaCheckpoint.clientRequestId')
          AND json_extract(recovery.result_json,'$.outputVideoRecovery.requestDigest')=json_extract(recovery.result_json,'$.outputVideoMediaCheckpoint.requestDigest')
          AND output_native_storage_writes.storage_key=json_extract(recovery.result_json,'$.outputVideoRecovery.storageKey')
          AND json_extract(recovery.result_json,'$.outputVideoRecovery.expiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))
      AND (? IS NULL OR plan.owner_user_id=?) AND (? IS NULL OR plan.organization_id=?)
      AND (?=0 OR (plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL)))`)
    .bind(filter.ownerUserId??null, now, now, filter.ownerUserId ?? null, filter.ownerUserId ?? null, filter.organizationId ?? null, filter.organizationId ?? null, Number(filter.personalOnly === true)).run();
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
