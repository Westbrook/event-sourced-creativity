import { intEnv, activeProjectBillingSql } from "./pilot-policy-primitives.ts";
import { privateContentIdentityAllowed } from "./private-content-identity.ts";
import { assertOutputAdmissionActor, readOutputAdmissionValue, type OutputAdmissionReads } from "./output-admission-reads.ts";
import { uuidV7 } from "./event-write-primitives.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { ProjectExecutionScope, BudgetReservationGuard } from "./pilot-policy.ts";
import { assertSponsorStoryIntakeCleanupRead, readSponsorStoryIntakeCleanupExclusion, type SponsorStoryIntakeCleanupRead } from "./experience-sponsor-story-intake-native.ts";
import { assertSponsorAudioIntakeCleanupRead, readSponsorAudioIntakeCleanupExclusion, type SponsorAudioIntakeCleanupRead } from "./experience-sponsor-audio-intake-native.ts";

export const DURABLE_WORK_RETENTION_END = "9999-12-31T23:59:59.999Z";
export const DEFAULT_EVIDENCE_RETENTION_DAYS = 365;

type PrivateContentKind = "prompt" | "provider-output" | "provider-response" | "intent" | "condition" | "critique" | "adaptive-intent" | "adaptive-structure" | "chat-user" | "chat-assistant" | "chat-assistant-memory" | "ideation-prompt" | "document-artifact" | "document-artifact-input" | "activity-issue-note" | "execution-consent" | "context-proposal" | "authoring-preview" | "memory-structured-ledger" | "memory-structured-origin" | "memory-document-job-origin" | "experience-draft" | "guest-image-stage-history";

export function privateContentRetentionClass(kind: PrivateContentKind): "durable-work" | "governed-evidence" | "transient-private" {
  return kind === "document-artifact" ? "durable-work" : ["document-artifact-input","activity-issue-note","execution-consent","context-proposal","authoring-preview"].includes(kind) ? "governed-evidence" : "transient-private";
}

export async function preparePrivateContent(env: WorkerEnv, ownerId: string, kind: PrivateContentKind, content: string, projectScope?: ProjectExecutionScope, admissionReads?:OutputAdmissionReads, guard?:BudgetReservationGuard, identity?:{contentId:string}, expiryCeiling?:string, storyCleanupRead?:SponsorStoryIntakeCleanupRead, audioCleanupRead?:SponsorAudioIntakeCleanupRead) {
  return preparePrivateContentInternal(env,ownerId,kind,content,projectScope,admissionReads,guard,identity,expiryCeiling,storyCleanupRead,audioCleanupRead);
}

/** Personal Slides publishes these exact two kinds for one owner. Sharing the
 * binding call does not share a qualified guard or remove either cleanup query.
 */
export async function preparePersonalSlidesPrivateContentPair(env: WorkerEnv, ownerId: string, artifactContent: string, inputContent: string) {
  if (typeof ownerId !== "string" || !ownerId || typeof artifactContent !== "string" || typeof inputContent !== "string") {
    throw new Error("personal_slides_private_content_pair_invalid");
  }
  const preparationDb = env.DB;
  let cleanupReads: Promise<PromiseSettledResult<BudgetReservationGuard>[]> | undefined;
  const cleanupFor = (index: 0 | 1) => async () => {
    if (env.DB !== preparationDb) throw new Error("native_structured_origin_schema_database_changed");
    cleanupReads ??= import("./memory-native-boundary.ts").then(({ nativePrivateContentMemoryExclusionPair }) => {
      if (env.DB !== preparationDb) throw new Error("native_structured_origin_schema_database_changed");
      return nativePrivateContentMemoryExclusionPair(env);
    });
    const outcome = (await cleanupReads)[index];
    if (env.DB !== preparationDb) throw new Error("native_structured_origin_schema_database_changed");
    if (!outcome) throw new Error("memory_boundary_schema_unavailable");
    if (outcome.status === "rejected") throw outcome.reason;
    return outcome.value;
  };
  const prepared = await Promise.all([
    preparePrivateContentInternal(env,ownerId,"document-artifact",artifactContent,undefined,undefined,undefined,undefined,undefined,undefined,undefined,cleanupFor(0)),
    preparePrivateContentInternal(env,ownerId,"document-artifact-input",inputContent,undefined,undefined,undefined,undefined,undefined,undefined,undefined,cleanupFor(1)),
  ]);
  if (env.DB !== preparationDb) throw new Error("native_structured_origin_schema_database_changed");
  return prepared;
}

async function preparePrivateContentInternal(env: WorkerEnv, ownerId: string, kind: PrivateContentKind, content: string, projectScope?: ProjectExecutionScope, admissionReads?:OutputAdmissionReads, guard?:BudgetReservationGuard, identity?:{contentId:string}, expiryCeiling?:string, storyCleanupRead?:SponsorStoryIntakeCleanupRead, audioCleanupRead?:SponsorAudioIntakeCleanupRead, privateCleanupRead?:()=>Promise<BudgetReservationGuard>) {
  const preparationDb = env.DB;
  if(audioCleanupRead!==undefined){
    if(storyCleanupRead!==undefined)throw new Error("sponsor_audio_intake_native_unavailable");
    assertSponsorAudioIntakeCleanupRead(audioCleanupRead,env,ownerId,kind,content,projectScope,admissionReads,guard,identity,expiryCeiling);
  }
  if(storyCleanupRead)assertSponsorStoryIntakeCleanupRead(storyCleanupRead,env,ownerId,kind,content,projectScope,admissionReads,guard,identity,expiryCeiling);
  const boundedStageHistory = kind === "guest-image-stage-history";
  if (boundedStageHistory && (!guard || !identity || !privateContentIdentityAllowed(kind, identity)
    || typeof content !== "string" || !content || !content.isWellFormed() || new TextEncoder().encode(content).byteLength > 131_072))
    throw new Error("private_content_stage_history_bound_invalid");
  const boundedExperienceDraft = kind === "experience-draft" && expiryCeiling !== undefined;
  if (boundedExperienceDraft && (!guard || !identity || !privateContentIdentityAllowed(kind, identity)
    || typeof content !== "string" || !content || !content.isWellFormed() || new TextEncoder().encode(content).byteLength > 65_536))
    throw new Error("private_content_draft_bound_invalid");
  const boundedMemoryAnswer = kind === "chat-assistant-memory" && expiryCeiling !== undefined;
  const boundedJobUser = kind === "chat-user" && expiryCeiling !== undefined;
  const documentJobManifest = kind === "memory-document-job-origin";
  const boundedMemory = kind === "memory-structured-origin" || documentJobManifest || boundedMemoryAnswer || boundedJobUser;
  // Memory evidence cannot refresh the original private lifetime.
  if (documentJobManifest && (typeof content !== "string" || content.length === 0 || content.length > 65_536
    || !content.isWellFormed() || new TextEncoder().encode(content).byteLength > 65_536)) throw new Error("private_content_manifest_invalid");
  if (kind === "memory-structured-origin" && (typeof content !== "string" || content.length > 65_536 || new TextEncoder().encode(content).byteLength > 65_536)) throw new Error("private_content_manifest_invalid");
  if (boundedMemoryAnswer && (typeof content !== "string" || content.length === 0 || content.length > 65_536
    || !content.isWellFormed() || new TextEncoder().encode(content).byteLength > 65_536)) throw new Error("private_content_memory_answer_invalid");
  if (boundedJobUser && (typeof content !== "string" || !content.trim() || content.length > 4_000
    || !content.isWellFormed() || new TextEncoder().encode(content).byteLength > 16_000)) throw new Error("private_content_memory_user_invalid");
  if ((kind === "memory-structured-ledger" || kind === "memory-structured-origin" || documentJobManifest) && expiryCeiling === undefined) throw new Error("private_content_expiry_ceiling_invalid");
  if (expiryCeiling !== undefined && ((kind !== "memory-structured-ledger" && kind !== "memory-structured-origin" && kind !== "memory-document-job-origin" && kind !== "chat-assistant-memory" && kind !== "chat-user" && kind !== "experience-draft") || typeof expiryCeiling !== "string")) throw new Error("private_content_expiry_ceiling_invalid");
  if (boundedMemory && (typeof expiryCeiling !== "string" || expiryCeiling.length !== 24)) throw new Error("private_content_expiry_ceiling_invalid");
  const ceiling = expiryCeiling === undefined ? null : Date.parse(expiryCeiling);
  if (ceiling !== null && (!Number.isSafeInteger(ceiling) || new Date(ceiling).toISOString() !== expiryCeiling || ceiling <= Date.now())) throw new Error("private_content_expiry_ceiling_invalid");
  if(identity&&!privateContentIdentityAllowed(kind,identity))throw new Error("private_content_identity_invalid");
  if(projectScope&&projectScope.actorUserId!==ownerId)throw new Error("project_private_content_actor_mismatch");
  assertOutputAdmissionActor(admissionReads,env,ownerId,projectScope?.organizationId??null,projectScope?.projectAccessId??null);
  const policy=projectScope?await readOutputAdmissionValue(admissionReads,"private-retention-policy",()=>env.DB.prepare("SELECT transient_days,evidence_days,version FROM organization_retention_policies WHERE organization_id=?")
    .bind(projectScope.organizationId).first<{transient_days:number;evidence_days:number;version:number}>()):null;
  if ((boundedMemory || boundedExperienceDraft || boundedStageHistory) && env.DB !== preparationDb) throw new Error("private_content_preparation_database_changed");
  const contentId = identity?.contentId ?? uuidV7(); const createdAt = new Date(); const category=privateContentRetentionClass(kind);
  const days=category==="governed-evidence"?Number(policy?.evidence_days??Math.max(1,Math.min(3650,intEnv(env.FORMA_EVIDENCE_RETENTION_DAYS,DEFAULT_EVIDENCE_RETENTION_DAYS)))):Number(policy?.transient_days??intEnv(env.FORMA_RETENTION_DAYS,30));
  const expiresAt=category==="durable-work"?new Date(DURABLE_WORK_RETENTION_END):new Date(createdAt.getTime()+days*86_400_000);
  if (ceiling !== null) expiresAt.setTime(Math.min(expiresAt.getTime(), ceiling));
  // Policy reads may outlive the supplied ceiling; never prepare expired bounded memory.
  if ((boundedMemory || boundedExperienceDraft || boundedStageHistory) && (!Number.isSafeInteger(expiresAt.getTime()) || expiresAt.getTime() <= createdAt.getTime())) throw new Error("private_content_expiry_ceiling_invalid");
  const now=createdAt.toISOString();
  const statements=projectScope?[
    env.DB.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)
      SELECT ?,?,?,?,?,?,NULL WHERE ${activeProjectBillingSql}
        AND EXISTS(SELECT 1 FROM organization_projects WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND status='active')
        AND ((?=0 AND NOT EXISTS(SELECT 1 FROM organization_retention_policies current_policy WHERE current_policy.organization_id=?))
          OR EXISTS(SELECT 1 FROM organization_retention_policies current_policy WHERE current_policy.organization_id=? AND current_policy.version=?))${guard?` AND (${guard.sql})`:""}`)
      .bind(contentId,ownerId,kind,content,now,expiresAt.toISOString(),ownerId,ownerId,projectScope.projectAccessId,projectScope.organizationId,ownerId,projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,Number(policy?.version??0),projectScope.organizationId,projectScope.organizationId,Number(policy?.version??0),...(guard?.bindings??[])),
    env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
      SELECT ?,'content',?,?,?,?,'actor_private',NULL,?,? WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)`)
      .bind(projectScope.projectAccessId,contentId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,ownerId,now,contentId,ownerId),
    env.DB.prepare(`INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.project_access_id=? AND resource.organization_id=?
        AND resource.project_id=? AND resource.resource_kind='content' AND resource.resource_id=? AND resource.actor_user_id=?)`)
      .bind(contentId,projectScope.organizationId,projectScope.projectAccessId,projectScope.projectId,ownerId,category,Number(policy?.version??0),expiresAt.toISOString(),now,projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,contentId,ownerId),
  ]:[env.DB.prepare(`INSERT INTO private_content (content_id,owner_id,kind,content,created_at,expires_at,redacted_at) ${guard?`SELECT ?,?,?,?,?,?,NULL WHERE ${guard.sql}`:"VALUES (?,?,?,?,?,?,NULL)"}`).bind(contentId,ownerId,kind,content,now,expiresAt.toISOString(),...(guard?.bindings??[]))];
  // Identity-bound admission must insert once or abort before custody, cleanup, and publication.
  // The existing content NOT NULL constraint rejects a denied predicate inside this batch.
  const identityAdmission=identity?(projectScope?{sql:`${activeProjectBillingSql}
        AND EXISTS(SELECT 1 FROM organization_projects WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND status='active')
        AND ((?=0 AND NOT EXISTS(SELECT 1 FROM organization_retention_policies current_policy WHERE current_policy.organization_id=?))
          OR EXISTS(SELECT 1 FROM organization_retention_policies current_policy WHERE current_policy.organization_id=? AND current_policy.version=?))${guard?` AND (${guard.sql})`:""}`,
    bindings:[ownerId,ownerId,projectScope.projectAccessId,projectScope.organizationId,ownerId,projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,Number(policy?.version??0),projectScope.organizationId,projectScope.organizationId,Number(policy?.version??0),...(guard?.bindings??[])]}:guard):undefined;
  if(identityAdmission)statements[0]=env.DB.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)
    SELECT ?,?,?,CASE WHEN (${identityAdmission.sql}) THEN ? ELSE NULL END,?,?,NULL`)
    .bind(contentId,ownerId,kind,...identityAdmission.bindings,content,now,expiresAt.toISOString());
  // Optional expiry cleanup uses the same complete negative provenance boundary as
  // ordinary hydration. Retyped registered bodies and immutable event references
  // remain excluded; dedicated evidence retires only through its lifecycle path.
  let cleanupGuard: { condition: string; bindings: (string | number | null)[] } | null = null;
  if (kind !== "memory-structured-ledger" && kind !== "memory-structured-origin" && !documentJobManifest) {
    if (env.DB !== preparationDb) throw new Error("native_structured_origin_schema_database_changed");
    const { nativeMemoryAnswerExclusion } = await import("./memory-native-boundary.ts");
    if (env.DB !== preparationDb) throw new Error("native_structured_origin_schema_database_changed");
    try {
      const exclusion = privateCleanupRead
        ? await privateCleanupRead()
        : audioCleanupRead!==undefined
        ? await readSponsorAudioIntakeCleanupExclusion(audioCleanupRead,env,ownerId,kind,content,projectScope,admissionReads,guard,identity,expiryCeiling)
        : storyCleanupRead
        ? await readSponsorStoryIntakeCleanupExclusion(storyCleanupRead,env,ownerId,kind,content,projectScope,admissionReads,guard,identity,expiryCeiling)
        : await nativeMemoryAnswerExclusion(env, { answerAlias: "private_content" });
      if (env.DB !== preparationDb) throw new Error("native_structured_origin_schema_database_changed");
      cleanupGuard = { condition: exclusion.sql, bindings: [...exclusion.bindings] };
    } catch (error) {
      if (env.DB !== preparationDb) throw new Error("native_structured_origin_schema_database_changed");
      // Unavailable exact schema omits optional cleanup, never widens it. Body
      // insertion is unchanged; database changes and other failures still deny.
      if (!(error instanceof Error) || (error.message !== "native_structured_origin_schema_unavailable"
        && error.message !== "native_document_job_origin_schema_unavailable")) throw error;
    }
  }
  // Private ledger/origin preparation owns inserts only, not retirement.
  if(cleanupGuard)statements.push(projectScope?preparationDb.prepare(`UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND redacted_at IS NULL AND kind NOT IN('document-artifact','memory-structured-ledger','memory-structured-origin','memory-document-job-origin') AND expires_at<=?
    AND EXISTS(SELECT 1 FROM private_content_retention_scopes governed WHERE governed.content_id=private_content.content_id AND governed.organization_id=?)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_retention_policies policy ON policy.organization_id=governed.organization_id AND policy.legal_hold=1
      WHERE governed.content_id=private_content.content_id AND governed.classification='governed-evidence')
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_legal_holds hold
      ON hold.organization_id=governed.organization_id AND hold.status='active'
      WHERE governed.content_id=private_content.content_id
        AND(hold.scope_kind='organization'
          OR hold.scope_kind='project' AND hold.resource_id=governed.project_access_id
          OR hold.scope_kind='content' AND hold.resource_id=governed.content_id))
    AND EXISTS(SELECT 1 FROM private_content inserted WHERE inserted.content_id=? AND inserted.owner_id=?)
    AND ${cleanupGuard.condition}`)
    .bind(now,ownerId,now,projectScope.organizationId,contentId,ownerId,...cleanupGuard.bindings):preparationDb.prepare(`UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND redacted_at IS NULL AND kind NOT IN('document-artifact','memory-structured-ledger','memory-structured-origin','memory-document-job-origin') AND expires_at<=?
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id)
      AND ${cleanupGuard.condition}`)
    .bind(now,ownerId,now,...cleanupGuard.bindings));
  // Optional cleanup reads may also cross the original source deadline. The
  // publisher must still enforce these inserts in its own atomic proof batch.
  if ((boundedMemory || boundedExperienceDraft || boundedStageHistory) && env.DB !== preparationDb) throw new Error("private_content_preparation_database_changed");
  if ((boundedMemory || boundedExperienceDraft || boundedStageHistory) && expiresAt.getTime() <= Date.now()) throw new Error("private_content_expiry_ceiling_invalid");
  return { contentId, createdAt: now, expiresAt: expiresAt.toISOString(), statements, requiredInserts:projectScope?3:1 };
}

/** Existing callers keep their original storage behavior; atomic admissions collect the same statements. */
export async function storePrivateContent(env: WorkerEnv, ownerId: string, kind: PrivateContentKind, content: string, projectScope?: ProjectExecutionScope,guard?:BudgetReservationGuard,publish?:(stored:{contentId:string;expiresAt:string})=>Array<ReturnType<WorkerEnv["DB"]["prepare"]>>,identity?:{contentId:string}) {
  const prepared=await preparePrivateContent(env,ownerId,kind,content,projectScope,undefined,guard,identity);
  const publicationOffset=prepared.statements.length,publications=publish?.({contentId:prepared.contentId,expiresAt:prepared.expiresAt})??[];
  let results:Awaited<ReturnType<WorkerEnv["DB"]["batch"]>>;
  try{results=await env.DB.batch([...prepared.statements,...publications]);}
  catch(error){
    const cause=error instanceof Error?error.cause:undefined;
    if(identity&&(projectScope||guard)&&[error,cause].some(value=>value instanceof Error&&/(?:^|: )NOT NULL constraint failed: private_content\.content(?:$|:)/u.test(value.message)))
      throw new Error("project_private_content_access_revoked",{cause:error});
    throw error;
  }
  for(let index=0;index<prepared.requiredInserts;index++)if(Number(results[index]?.meta.changes??0)!==1)throw new Error("project_private_content_access_revoked");
  if(publications.some((_,index)=>Number(results[publicationOffset+index]?.meta.changes??0)!==1))throw new Error("private_content_publication_unavailable");
  return {contentId:prepared.contentId,expiresAt:prepared.expiresAt};
}
