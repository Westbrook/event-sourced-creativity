import { reconcileOutputAssetStorage } from "./output-asset-storage-control.ts";
import { reconcileOutputNativeStorage } from "./output-private-execution.ts";
import { EXPIRED_DOCUMENT_JOB_REDACTION_SQL } from "./document-jobs-api.ts";
import { releaseUndispatchedOutputReservations } from "./output-execution-control.ts";
import { personalOutputErasureStatements, personalOutputErasureProgress } from "./output-requirement-retention.ts";
import { preparePersonalSelectedOutputShareErasure } from "./selected-output-share-retention.ts";
import { prepareLiveMemoryErasureBarrier, prepareLiveMemoryErasureStatements } from "./memory-live-store.ts";
import { prepareNativeDocumentJobOriginRetentionStep } from "./memory-native-origin.ts";
import { migrateLegacyEventPayloads, unsafePublicIdentifierPredicate } from "./event-privacy-migration.ts";
import { requireConsent, requireUser } from "./pilot-policy.ts";
import { readProjectRequestContext } from "./project-access.ts";
import { ensureSchema, type WorkerEnv } from "./runtime.ts";

async function ownedLegacyCount(env: WorkerEnv, userId: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND json_valid(payload)
    AND(json_extract(payload,'$._private_ref') IS NULL OR ${unsafePublicIdentifierPredicate()})`)
    .bind(`creative:${userId}`).first<{ count: number }>();
  return Number(row?.count ?? 0);
}


// Both current custody paths can carry a hold, including custody assigned after
// a personal memory was published. Shared context remains outside personal erase.
const privacyContentHeld=(ref:string)=>`(EXISTS(SELECT 1 FROM private_content_retention_scopes governed
  JOIN organization_retention_policies policy ON policy.organization_id=governed.organization_id
  WHERE governed.content_id=${ref} AND governed.classification='governed-evidence' AND policy.legal_hold=1)
  OR EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_legal_holds hold
    ON hold.organization_id=governed.organization_id AND hold.status='active'
    WHERE governed.content_id=${ref} AND (hold.scope_kind='organization'
      OR hold.scope_kind='project' AND hold.resource_id=governed.project_access_id
      OR hold.scope_kind='content' AND hold.resource_id=governed.content_id))
  OR EXISTS(SELECT 1 FROM project_resource_scopes custody JOIN organization_legal_holds hold
    ON hold.organization_id=custody.organization_id AND hold.status='active'
    WHERE custody.resource_kind='content' AND custody.resource_id=${ref} AND (hold.scope_kind='organization'
      OR hold.scope_kind='project' AND hold.resource_id=custody.project_access_id
      OR hold.scope_kind='content' AND hold.resource_id=custody.resource_id)))`;

function privacyBatchChanges(value:unknown, length:number, writeStart:number, writeEnd:number, proofCount:number, heldCount:number):{changes:number[],held:number[]}|null {
  try {
    if(!Array.isArray(value))return null;
    const array=Object.getOwnPropertyDescriptors(value as object);
    if(array.length?.value!==length||Reflect.ownKeys(array).length!==length+1)return null;
    const changes:number[]=[],held:number[]=[];
    for(let index=0;index<length;index++){
      const receipt=array[String(index)];if(!receipt||!Object.hasOwn(receipt,'value'))return null;
      const row=receipt.value;if(!row||typeof row!=='object'||Array.isArray(row))return null;
      const descriptors=Object.getOwnPropertyDescriptors(row),meta=descriptors.meta;
      const error=descriptors.error;
      if(error?(!Object.hasOwn(error,'value')||error.value!==undefined):'error' in row)return null;
      if(descriptors.success?.value!==true||!meta||!Object.hasOwn(meta,'value')||!meta.value||typeof meta.value!=='object'||Array.isArray(meta.value))return null;
      const results=descriptors.results;
      if(!results||!Object.hasOwn(results,'value')||!Array.isArray(results.value))return null;
      const resultDescriptors=Object.getOwnPropertyDescriptors(results.value as object),resultLength=resultDescriptors.length?.value;
      if(!Number.isSafeInteger(resultLength)||resultLength<0||Reflect.ownKeys(resultDescriptors).length!==resultLength+1)return null;
      for(let rowIndex=0;rowIndex<resultLength;rowIndex++)if(!Object.hasOwn(resultDescriptors[String(rowIndex)]??{},'value'))return null;
      if(index>=writeStart&&index<=writeEnd&&resultLength!==0)return null;
      if(index>writeEnd&&index<=writeEnd+proofCount){
        if(resultLength!==1)return null;
        const proof=resultDescriptors['0'].value;
        if(!proof||typeof proof!=='object'||Array.isArray(proof))return null;
        const fields=Object.getOwnPropertyDescriptors(proof);
        if(Reflect.ownKeys(fields).length!==1||fields.privacy_erasure_verified?.value!==1)return null;
      }
      if(index>writeEnd+proofCount&&index<=writeEnd+proofCount+heldCount){
        if(resultLength!==1)return null;
        const proof=resultDescriptors['0'].value;
        if(!proof||typeof proof!=='object'||Array.isArray(proof))return null;
        const fields=Object.getOwnPropertyDescriptors(proof),count=fields.privacy_erasure_held;
        if(Reflect.ownKeys(fields).length!==1||!count||!Object.hasOwn(count,'value')||!Number.isSafeInteger(count.value)||count.value<0)return null;
        held.push(count.value);
      }
      const count=Object.getOwnPropertyDescriptor(meta.value,'changes');
      if(!count||!Object.hasOwn(count,'value')||!Number.isSafeInteger(count.value)||count.value<0)return null;
      changes.push(count.value);
    }
    return {changes,held};
  }catch{return null;}
}

/** Explicit customer erasure and administrator-only historical ledger migration. */
export async function handleEventPrivacy(request: Request, env: WorkerEnv): Promise<Response> {
  await ensureSchema(env);
  const authenticated = await requireUser(request, env, "viewer", { account: "principal" });
  if (authenticated.response || !authenticated.user) return authenticated.response ?? Response.json({ error: "authentication_required" }, { status: 401 });
  const actor = authenticated.user;
  if (actor.fictional) return Response.json({ error: "principal_account_required" }, { status: 403 });
  const selected = await readProjectRequestContext(request, env, actor);
  if (selected.response) return selected.response;

  if (request.method === "GET") {
    const [legacy, governed] = await Promise.all([
      ownedLegacyCount(env, actor.userId),
      env.DB.prepare("SELECT COUNT(*) AS count FROM event_private_payloads WHERE owner_id=? AND redacted_at IS NULL").bind(actor.userId).first<{ count: number }>(),
    ]);
    return Response.json({ legacyAuthoredEvents: legacy, governedAuthoredEvents: Number(governed?.count ?? 0), historicalMigrationAvailable: actor.role === "admin", sharedOrganizationContextExcluded: true, backupAndOtherDeviceErasure: "not-verified" });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const consent = requireConsent(actor);
  if (consent) return consent;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "same_origin_required" }, { status: 403 });
  if (selected.context) return Response.json({ error: "personal_privacy_context_required", message: "Leave the shared organization project before changing personal privacy controls." }, { status: 409 });
  let body: { action?: unknown; confirmation?: unknown };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "invalid_privacy_request" }, { status: 400 }); }

  if (body.action === "migrate-historical-events") {
    if (actor.role !== "admin") return Response.json({ error: "administrator_required" }, { status: 403 });
    if (body.confirmation !== "MIGRATE_HISTORICAL_EVENT_CONTENT") return Response.json({ error: "explicit_migration_confirmation_required" }, { status: 400 });
    try { return Response.json({ ...await migrateLegacyEventPayloads(env), rowIdentitiesPreserved: true, browserCachesMustBeRefreshed: true, historicalBackupsPurged: false }); }
    catch (error) { return Response.json({ error: "historical_migration_failed", message: error instanceof Error ? error.message : "Historical event privacy migration failed." }, { status: 409 }); }
  }

  if (body.action !== "erase-personal-authored-context") return Response.json({ error: "unsupported_privacy_action" }, { status: 400 });
  if (body.confirmation !== "ERASE_MY_PERSONAL_AUTHORED_CONTEXT") return Response.json({ error: "explicit_erasure_confirmation_required" }, { status: 400 });
  const remainingLegacy = await ownedLegacyCount(env, actor.userId);
  if (remainingLegacy) return Response.json({ error: "historical_privacy_migration_required", legacyAuthoredEvents: remainingLegacy, message: "An administrator must first migrate historical authored event bodies; erasure would otherwise be incomplete." }, { status: 409 });
  const db=env.DB,userId=actor.userId,now=new Date().toISOString();
  const current=()=>env.DB===db&&actor.userId===userId;
  const unconfirmed=()=>Response.json({error:'memory_erasure_unconfirmed',authoredContentErasurePending:true,
    memoryJobCleanupPending:true,continuationRequired:true}, {status:503});
  try {
    const platformAssistant=await db.prepare("SELECT 1 AS available FROM sqlite_schema WHERE type='table' AND name='platform_assistant_private_content' LIMIT 1")
      .first<{available:number}>();
    if(!current())return unconfirmed();
    const barrier=await prepareLiveMemoryErasureBarrier(env,{actorUserId:userId,personalOnly:true},now);
    if(!current())return unconfirmed();
    const outputErasure=await personalOutputErasureStatements(env,userId,now,EXPIRED_DOCUMENT_JOB_REDACTION_SQL);
    if(!current())return unconfirmed();
    const selectedShareErasure=await preparePersonalSelectedOutputShareErasure(env,userId,now);
    if(!current())return unconfirmed();
    const pending=barrier.pendingOrigins>0;
    const final=pending?null:await prepareLiveMemoryErasureStatements(env,{actorUserId:userId,personalOnly:true},now);
    if(!current())return unconfirmed();
    // The early barrier never invokes the ledger/source erasure owner. A later
    // explicitly confirmed request must prove job cleanup complete first.
    const prefix=final?.statements??barrier.statements,terminal=final?.terminalAssertions??[];
    const genericDefinitions=pending?[]:[
      {table:'event_private_payloads',set:"UPDATE event_private_payloads SET private_json='',redacted_at=?",timed:true,
        where:`owner_id=? AND redacted_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event_private_payloads.private_event_id)
          AND NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.owner_user_id=? AND project.status='active'
            AND (project.project_id=event_private_payloads.project_id OR EXISTS(SELECT 1 FROM project_resource_scopes resource
              WHERE resource.project_access_id=project.project_access_id AND resource.organization_id=project.organization_id AND resource.owner_user_id=project.owner_user_id
                AND resource.resource_kind='document' AND resource.resource_id=event_private_payloads.document_id)))`,
        hold:privacyContentHeld("CASE WHEN json_valid(event_private_payloads.private_json) THEN json_extract(event_private_payloads.private_json,'$.content_ref') ELSE NULL END"),bindings:[userId,userId]},
      {table:'private_content',set:"UPDATE private_content SET content='',redacted_at=?",timed:true,
        where:`owner_id=? AND redacted_at IS NULL AND kind!='document-artifact'
          AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id)`,
        hold:privacyContentHeld('private_content.content_id'),bindings:[userId]},
      {table:'external_content',set:'DELETE FROM external_content',timed:false,where:'owner_id=?',hold:null,bindings:[userId]},
      ...(platformAssistant?[{table:'platform_assistant_private_content',set:"UPDATE platform_assistant_private_content SET content='',redacted_at=?",
        timed:true,where:'actor_user_id=? AND redacted_at IS NULL',hold:null,bindings:[userId]}]:[]),
    ];
    const generic=genericDefinitions.map(item=>db.prepare(`${item.set} WHERE ${item.where}${item.hold?` AND NOT ${item.hold}`:''}`)
      .bind(...(item.timed?[now]:[]),...item.bindings));
    // A missing/dropped write cannot masquerade as a successful zero-count erase.
    // The same eligibility predicate excludes retained shared or held content.
    const genericChecks=genericDefinitions.map(item=>db.prepare(`SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM ${item.table} WHERE ${item.where}${item.hold?` AND NOT ${item.hold}`:''}) THEN 1 ELSE json('personal erasure incomplete') END AS privacy_erasure_verified`)
      .bind(...item.bindings));
    // Count held personal exclusions in the same transaction as the writes. A
    // completed job cleanup is not proof that held authored bodies were erased.
    const heldChecks=genericDefinitions.filter(item=>item.hold).map(item=>db.prepare(
      `SELECT COUNT(*) AS privacy_erasure_held FROM ${item.table} WHERE ${item.where} AND ${item.hold}`).bind(...item.bindings));
    // Legacy paid slide attempts have no Output grant. Their existing cancellation
    // and sanitization remain after the memory evidence barrier in this batch.
    const legacyPresentationErasure=db.prepare(`UPDATE document_jobs SET ${EXPIRED_DOCUMENT_JOB_REDACTION_SQL},
      status=CASE WHEN status IN('queued','running','committing') THEN 'canceled' ELSE status END,
      completed_at=CASE WHEN status IN('queued','running','committing') THEN COALESCE(completed_at,?) ELSE completed_at END,
      lease_expires_at=NULL,error_message=NULL,updated_at=?
      WHERE owner_id=? AND stream_id=? AND kind='render_document' AND json_extract(request_json,'$.artifactKind')='slides'
        AND COALESCE(json_extract(result_json,'$.providerSubmissionProtocol'),0)=1
        AND json_type(result_json,'$.providerSubmissions')='object' AND EXISTS(SELECT 1 FROM json_each(result_json,'$.providerSubmissions'))
        ${outputErasure.length?"AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id)":""}
        AND NOT EXISTS(SELECT 1 FROM project_resource_scopes custody WHERE
          custody.resource_kind='job' AND custody.resource_id=document_jobs.job_id
          OR custody.resource_kind='document' AND custody.resource_id=document_jobs.document_id)`)
      .bind(now,now,userId,`creative:${userId}`);
    const outputOffset=prefix.length+generic.length,legacyIndex=outputOffset+outputErasure.length;
    // Selected links retire in the same transaction even while memory cleanup
    // defers authored-body erasure. Each owner acknowledges only its receipts.
    const selectedShareOffset=legacyIndex+1+genericChecks.length+heldChecks.length;
    const selectedShareStatements=[...selectedShareErasure.statements,...selectedShareErasure.terminalAssertions];
    const terminalOffset=selectedShareOffset+selectedShareStatements.length;
    const statements=[...prefix,...generic,...outputErasure,legacyPresentationErasure,...genericChecks,...heldChecks,...selectedShareStatements,...terminal];
    if(!current())return unconfirmed();
    const result=await db.batch(statements),summary=privacyBatchChanges(result,statements.length,prefix.length,legacyIndex,genericChecks.length,heldChecks.length);
    if(!summary||!current())return unconfirmed();
    const {changes,held}=summary;
    const selectedShareSummary=selectedShareErasure.acknowledge(Array.prototype.slice.call(result,selectedShareOffset,terminalOffset));
    if(!selectedShareSummary||!current())return unconfirmed();
    const ownReceipts=[...Array.prototype.slice.call(result,0,prefix.length),...Array.prototype.slice.call(result,terminalOffset)];
    if(!(final?final.acknowledge(ownReceipts):barrier.acknowledge(ownReceipts))||!current())return unconfirmed();
    let advancedMemoryCleanupWorkUnits=0;
    if(pending)for(let index=0;index<16;index++){
      const input={now:new Date().toISOString(),personalErasureActorUserId:userId};
      const step=await prepareNativeDocumentJobOriginRetentionStep(env,input);
      if(!current())return unconfirmed();
      if(!step)break;
      const receipt=await db.batch(step.statements.map(query=>db.prepare(query.sql).bind(...query.bindings)));
      if(!current()||!step.acknowledge(receipt)||!current())return unconfirmed();
      advancedMemoryCleanupWorkUnits+=step.workUnits;
    }
    let outputReservationReconciliationPending=false,outputReconciliationCheckFailed=false;
    let outputProgress={providerReconciliationPending:0,storageCleanupPending:0};
    if(outputErasure.length){
      try { const remaining=await releaseUndispatchedOutputReservations(env,{ownerUserId:userId,personalOnly:true,limit:1});outputReservationReconciliationPending=remaining.pending>0; }
      catch { outputReservationReconciliationPending=true; }
      if(!current())return unconfirmed();
      try { await reconcileOutputNativeStorage(env,{ownerUserId:userId,personalOnly:true,limit:1}); }catch{outputReconciliationCheckFailed=true;}
      if(!current())return unconfirmed();
      try { await reconcileOutputAssetStorage(env,{ownerUserId:userId,personalOnly:true,limit:1}); }catch{outputReconciliationCheckFailed=true;}
      if(!current())return unconfirmed();
      try { outputProgress=await personalOutputErasureProgress(env,userId); }catch{outputReconciliationCheckFailed=true;}
      if(!current())return unconfirmed();
    }
    const heldAuthoredEventBodies=held[0]??0,heldTemporaryContent=held[1]??0;
    const authoredPending=pending||heldAuthoredEventBodies>0||heldTemporaryContent>0;
    return Response.json({
      authoredContentErasurePending:authoredPending,memoryJobCleanupPending:pending,continuationRequired:authoredPending,
      heldAuthoredEventBodies:pending?null:heldAuthoredEventBodies,heldTemporaryContent:pending?null:heldTemporaryContent,
      memoryJobOriginsPendingAtStart:barrier.pendingOrigins,initializedMemoryJobOrigins:pending?barrier.initializedOrigins:0,
      advancedMemoryCleanupWorkUnits,
      ...(pending?{message:'Authored content is retained while memory cleanup is pending. Repeat this confirmed erasure request to continue; active legal holds may defer cleanup.'}:authoredPending?{message:'Unheld personal content was erased; authored content covered by active legal holds is retained. Repeat this confirmed request after the holds are released.'}:{}),
      erasedAuthoredEventBodies:pending?0:changes[prefix.length],erasedTemporaryContent:pending?0:changes[prefix.length+1],
      clearedDerivedContent:pending?0:changes[prefix.length+2],erasedPlatformConversations:!pending&&platformAssistant?changes[prefix.length+3]:0,
      erasedLegacyPresentationJobs:changes[legacyIndex],revokedOutputGrantCount:outputErasure.length?changes[outputOffset]:0,
      uncertainProviderAccountingRetained:true,outputReservationReconciliationPending,
      outputProviderReconciliationPending:outputProgress.providerReconciliationPending,outputStorageCleanupPending:outputProgress.storageCleanupPending,outputReconciliationCheckFailed,
      ...(selectedShareErasure.installed?{selectedOutputShareMetadataMinimizedCount:selectedShareSummary.minimizedCount,
        selectedOutputShareTombstonesRetained:true}:{}),
      finishedOutputsRetained:true,sharedOrganizationContextRetained:true,uploadedFilesRetained:true,otherDevicesAndBackupsPurged:false,
    },{status:authoredPending?202:200});
  }catch{return unconfirmed();}
}
