import { readSponsorIntakeCommand as commandFrom } from "./experience-sponsor-intake-command.ts";
import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, experienceDraftId, isDraftId, isIntentId, receiptPrefix, registeredExperience, validateIntakeRequest, type ExperiencePlan } from "../src/experiences/intake.ts";
import { authorizeExperienceIntake, experienceDraftGuard, experienceDraftStorageGuard, readExperienceDraft } from "./experience-intake-api.ts";
import { loadApprovedSponsorCampaign } from "./experience-sponsor-approval.ts";
import { sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { composeSponsorIntakePostGuards, composeSponsorIntakePostWriteGuard, prepareSponsorIntakePostStorageWitness, readSponsorIntakePostDraft, requireSponsorIntakePostReadAllowance, sealSponsorIntakePostNativeReceipt, verifySponsorIntakePostPrepared, type SponsorIntakePostReadAllowance } from "./experience-sponsor-intake-reads.ts";
import { commitAtomicIntake, projectIntakeAuthority, type ProjectIntakeAuthorization } from "./project-intake.ts";
import { storePrivateContent, type BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const databaseNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const join = composeSponsorIntakePostGuards;
type Marker = { version: 1; receiptId: string };
type Plan = ExperiencePlan & { sponsor_intake: Marker };
type Receipt = { receipt_id: string; resource_id: string; campaign_id: string; policy_digest: string; limits_digest: string;
  actor_user_id: string; session_digest: string; native_intent_id: string; draft_id: string; project_id: string; document_id: string;
  draft_hash: string; body_digest: string; content_digest: string; source_digest: string; content_bytes: number; expires_at: string };
type MeteredRead = { allowance: SponsorIntakePostReadAllowance; request: Request };

/** Dormant, immutable source-free linkage. Creative text remains only in the
 * existing erasable native private body; no route or initializer installs this. */
export const SPONSOR_INTAKE_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_intake_assertions(receipt_id TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1))`,
  `CREATE TABLE experience_sponsor_intakes(receipt_id TEXT PRIMARY KEY NOT NULL,resource_id TEXT UNIQUE NOT NULL REFERENCES experience_sponsor_resource_receipts(resource_id),
    campaign_id TEXT NOT NULL,policy_digest TEXT NOT NULL,limits_digest TEXT NOT NULL,actor_user_id TEXT NOT NULL,session_digest TEXT NOT NULL,
    native_intent_id TEXT NOT NULL,draft_id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL,document_id TEXT NOT NULL,draft_hash TEXT NOT NULL,
    body_digest TEXT NOT NULL,content_digest TEXT NOT NULL,source_digest TEXT NOT NULL,content_bytes INTEGER NOT NULL CHECK(content_bytes>0),
    expires_at TEXT NOT NULL,recorded_at_ms INTEGER NOT NULL,UNIQUE(actor_user_id,native_intent_id))`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_intake_no_${action.toLowerCase()} BEFORE ${action} ON experience_sponsor_intakes BEGIN SELECT RAISE(ABORT,'sponsor_intake_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_intake_no_replace BEFORE INSERT ON experience_sponsor_intakes
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_intakes old WHERE old.receipt_id=NEW.receipt_id OR old.draft_id=NEW.draft_id OR (old.actor_user_id=NEW.actor_user_id AND old.native_intent_id=NEW.native_intent_id))
    BEGIN SELECT RAISE(ABORT,'sponsor_intake_exists'); END`,
]);

export { readSponsorIntakeCommand } from "./experience-sponsor-intake-command.ts";
async function actorFrom(request: Request, env: WorkerEnv) {
  const auth = await authorizeExperienceIntake(request, env);
  if (auth instanceof Response) return fail("sponsor_intake_actor_unavailable");
  return auth;
}
function marked(plan: ExperiencePlan): plan is Plan {
  const marker = (plan as unknown as Record<string, unknown>).sponsor_intake;
  return record(marker) && exactKeys(marker, ["version", "receiptId"]) && marker.version === 1 && id(marker.receiptId);
}
/** A missing/redacted/expired body never becomes a fresh write or a new debit. */
async function original(env: WorkerEnv, auth: ProjectIntakeAuthorization, draftId: string, campaignId: string, read?: MeteredRead) {
  const metered = read ? await readSponsorIntakePostDraft(read.allowance, env, auth, draftId) : undefined;
  const stored = read ? metered : await readExperienceDraft(env, auth, draftId);
  if (!stored) return null;
  if (!marked(stored.plan)) return fail("sponsor_intake_existing_ordinary_draft");
  // The metered reader already captured this exact bounded source-free row.
  // Do not fetch it again through the unmetered legacy SELECT * path.
  let receipt: Receipt | null;
  if (read) {
    if (!metered) return fail("sponsor_intake_original_unavailable");
    receipt = metered.receipt;
  } else receipt = await env.DB.prepare("SELECT * FROM experience_sponsor_intakes WHERE draft_id=? AND actor_user_id=?")
    .bind(draftId, auth.user.userId).first<Receipt>();
  if (!receipt || receipt.campaign_id !== campaignId || receipt.receipt_id !== stored.plan.sponsor_intake.receiptId
    || receipt.native_intent_id !== stored.plan.request.intentId || receipt.project_id !== stored.plan.projectId || receipt.document_id !== stored.plan.documentId
    || receipt.draft_hash !== stored.plan.draftHash || receipt.expires_at !== stored.expiresAt || receipt.content_digest !== await digest(stored.content)
    || receipt.source_digest !== await digest(stored.plan.events) || receipt.content_bytes !== new TextEncoder().encode(stored.content).byteLength)
    return fail("sponsor_intake_original_unavailable");
  const proof: BudgetReservationGuard = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_intakes intake
    JOIN experience_sponsor_resource_receipts resource ON resource.resource_id=intake.resource_id
    JOIN private_content body ON body.content_id=intake.draft_id AND body.owner_id=intake.actor_user_id AND body.kind='experience-draft'
    WHERE intake.receipt_id=? AND intake.draft_id=? AND intake.actor_user_id=? AND intake.campaign_id=? AND intake.policy_digest=? AND intake.limits_digest=?
      AND intake.draft_hash=? AND intake.content_digest=? AND intake.body_digest=? AND intake.source_digest=? AND intake.expires_at=?
      AND body.content=? AND body.expires_at=intake.expires_at AND body.redacted_at IS NULL AND body.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND resource.campaign_id=intake.campaign_id AND resource.policy_digest=intake.policy_digest AND resource.limits_digest=intake.limits_digest
      AND resource.actor_user_id=intake.actor_user_id AND resource.session_digest=intake.session_digest AND resource.intent_key=intake.native_intent_id
      AND resource.operation='image-text-draft-storage' AND resource.payload_digest=intake.content_digest AND resource.text_bytes=intake.content_bytes)`,
  bindings: [receipt.receipt_id,draftId,auth.user.userId,campaignId,receipt.policy_digest,receipt.limits_digest,receipt.draft_hash,receipt.content_digest,
    receipt.body_digest,receipt.source_digest,receipt.expires_at,stored.content] };
  return { ...stored, plan: stored.plan, receipt, proof: join(projectIntakeAuthority(env,auth,stored.plan),experienceDraftGuard(auth,stored.plan,stored.content),proof) };
}
async function disclosePrepared(env: WorkerEnv, saved: NonNullable<Awaited<ReturnType<typeof original>>>, replayed: boolean, read?: MeteredRead) {
  if (read) await verifySponsorIntakePostPrepared(read.allowance,read.request,env,saved.proof);
  else if (!await env.DB.prepare(`SELECT 1 AS current WHERE ${saved.proof.sql}`).bind(...saved.proof.bindings).first()) return fail("sponsor_intake_original_unavailable");
  return { status: "prepared" as const, plan: saved.plan, expiresAt: saved.expiresAt, replayed };
}

/** Actual native draft storage plus intake allowance in one existing D1 batch.
 * No paid work, new financial hold, public route or caller-chosen payer. */
export async function prepareSponsorImageDraft(request: Request, env: WorkerEnv, allowance?: SponsorIntakePostReadAllowance) {
  const captured = allowance ? requireSponsorIntakePostReadAllowance(allowance, request, env, "prepare-sponsored-image-draft") : undefined;
  const command = captured?.command ?? await commandFrom(request), read = allowance ? { allowance, request } : undefined;
  if (!exactKeys(command,["action","campaignId","request"]) || command.action !== "prepare-sponsored-image-draft" || !id(command.campaignId)
    || !record(command.request) || !isIntentId(command.request.intentId) || command.request.experienceId !== "image" || Object.hasOwn(command.request,"reference")) return fail("sponsor_intake_request_invalid");
  const auth = captured?.auth ?? await actorFrom(request,env), campaignId = command.campaignId, draftId = await experienceDraftId(auth.user.userId,command.request.intentId);
  const bodyDigest = await digest(command), existing = await original(env,auth,draftId,campaignId,read);
  if (existing) {
    if (existing.receipt.body_digest !== bodyDigest) return fail("sponsor_intake_intent_conflict");
    return disclosePrepared(env,existing,true,read);
  }
  // A retained native identity may not be adopted after expiry/redaction or
  // retroactively attached to a new campaign by inserting only its receipt.
  if (await env.DB.prepare("SELECT 1 AS present FROM private_content WHERE content_id=?").bind(draftId).first()) return fail("sponsor_intake_original_unavailable");
  const approved = await loadApprovedSponsorCampaign(request,env,campaignId);
  if (approved.actor.userId !== auth.user.userId || approved.policy.resources.version !== 2) return fail("sponsor_initial_intake_not_approved");
  const validated = await validateIntakeRequest(command.request);
  if (!validated || validated.release.output.output !== "image" || validated.request.reference
    || !approved.policy.templates.some(template => template.appId === "image" && template.releaseDigest === validated.release.releaseHash)) return fail("sponsor_intake_request_invalid");
  const native = await buildExperiencePlan(auth.user.userId,validated.request,validated.release);
  const receiptId = `sponsor-intake-${(await digest({campaignId,actor:auth.user.userId,intent:validated.request.intentId})).slice(7)}`;
  const { draftHash: _nativeHash, ...nativeBase } = native;
  const base = { ...nativeBase, sponsor_intake: { version: 1 as const, receiptId } };
  const plan: Plan = freeze({ ...base, draftHash: await digest(base) }), content = canonicalJson(plan), contentDigest = await digest(content);
  const contentBytes = new TextEncoder().encode(content).byteLength, sessionDigest = await sponsorPrincipalDigest(approved.actor), sourceDigest = await digest(plan.events);
  const resource = await prepareSponsorResourcePlan({ limits:approved.policy.resources,campaignId,policyDigest:approved.policyDigest,actorUserId:auth.user.userId,
    sessionDigest,intentKey:validated.request.intentId,operation:"image-text-draft-storage",payloadDigest:contentDigest,textBytes:contentBytes,resourceId:`${receiptId}:resource` });
  const liveProofs = [projectIntakeAuthority(env,auth,plan),...approved.assertions.map(p=>({sql:p.sql,bindings:p.bindings??[]}))];
  const live = allowance ? composeSponsorIntakePostWriteGuard(allowance,request,env,...liveProofs) : join(...liveProofs);
  const storageGuard = join(experienceDraftStorageGuard(auth.user.userId),live);
  try {
    await storePrivateContent(env,auth.user.userId,"experience-draft",content,undefined,storageGuard,stored=>{
      const statements = [...resource.statements.map(statement=>env.DB.prepare(statement.sql).bind(...statement.bindings)),
        env.DB.prepare(`INSERT INTO experience_sponsor_intakes(receipt_id,resource_id,campaign_id,policy_digest,limits_digest,actor_user_id,session_digest,native_intent_id,draft_id,project_id,document_id,draft_hash,body_digest,content_digest,source_digest,content_bytes,expires_at,recorded_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${databaseNow})`).bind(receiptId,`${receiptId}:resource`,campaignId,approved.policyDigest,resource.limitsDigest,auth.user.userId,sessionDigest,
          validated.request.intentId,draftId,plan.projectId,plan.documentId,plan.draftHash,bodyDigest,contentDigest,sourceDigest,contentBytes,stored.expiresAt)];
      // A CHECK witness is checked inside the native storage transaction.
      // It cannot be replaced by storePrivateContent's post-commit change count.
      const witnessSql = `INSERT INTO experience_sponsor_intake_assertions(receipt_id,passed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM private_content body
        JOIN experience_sponsor_intakes intake ON intake.draft_id=body.content_id JOIN experience_sponsor_resource_receipts resource ON resource.resource_id=intake.resource_id
        WHERE intake.receipt_id=? AND body.owner_id=? AND body.kind='experience-draft' AND body.content=? AND body.redacted_at IS NULL AND body.expires_at=?
          AND intake.expires_at=body.expires_at AND intake.content_digest=? AND intake.content_bytes=? AND resource.operation='image-text-draft-storage'
          AND resource.payload_digest=intake.content_digest AND resource.text_bytes=intake.content_bytes
          AND resource.campaign_id=intake.campaign_id AND resource.actor_user_id=intake.actor_user_id AND resource.policy_digest=intake.policy_digest
          AND resource.limits_digest=intake.limits_digest AND resource.session_digest=intake.session_digest AND resource.intent_key=intake.native_intent_id)
        AND (${live.sql}) THEN 1 ELSE 0 END)`;
      const witnessBindings = [receiptId,receiptId,auth.user.userId,content,stored.expiresAt,contentDigest,contentBytes,...live.bindings];
      statements.push(allowance
        ? prepareSponsorIntakePostStorageWitness(allowance,request,env,live,witnessSql,witnessBindings)
        : env.DB.prepare(witnessSql).bind(...witnessBindings));
      statements.push(env.DB.prepare("DELETE FROM experience_sponsor_intake_assertions WHERE receipt_id=?").bind(receiptId));
      return statements;
    },{contentId:draftId});
  } catch (error) {
    const saved = await original(env,auth,draftId,campaignId,read);
    if (!saved || saved.receipt.body_digest !== bodyDigest) throw error;
    return disclosePrepared(env,saved,true,read);
  }
  const saved = await original(env,auth,draftId,campaignId,read);
  if (!saved || saved.receipt.body_digest !== bodyDigest) return fail("sponsor_intake_save_unconfirmed");
  return disclosePrepared(env,saved,false,read);
}

/** Explicit review commits the unchanged native event grammar. An already
 * completed native receipt is recovered under actor custody even when new
 * sponsor work has expired/revoked; no expiry or counter is reset. */
export async function commitSponsorImageDraft(request: Request, env: WorkerEnv, allowance?: SponsorIntakePostReadAllowance) {
  const captured = allowance ? requireSponsorIntakePostReadAllowance(allowance,request,env,"commit-sponsored-image-draft") : undefined;
  const command = captured?.command ?? await commandFrom(request), read = allowance ? { allowance, request } : undefined;
  if (!exactKeys(command,["action","campaignId","draftId","draftHash"]) || command.action !== "commit-sponsored-image-draft" || !id(command.campaignId)
    || typeof command.draftId !== "string" || !isDraftId(command.draftId) || typeof command.draftHash !== "string") return fail("sponsor_intake_request_invalid");
  const auth = captured?.auth ?? await actorFrom(request,env), saved = await original(env,auth,command.draftId,command.campaignId,read);
  if (!saved || command.draftHash !== saved.plan.draftHash) return fail("sponsor_intake_review_stale");
  const plan = saved.plan, intake = {projectId:plan.projectId,documentId:plan.documentId,events:structuredClone(plan.events) as ExperiencePlan["events"][number][]};
  const options = {receiptPrefix:receiptPrefix(plan.draftId),clientId:"web:experience-intake",correlationPrefix:"experience-intake:",guard:saved.proof};
  const checkOptions = allowance ? sealSponsorIntakePostNativeReceipt(allowance,request,env,auth,intake,options) : options;
  const before = await commitAtomicIntake(env,auth,intake,"check",checkOptions), originalReceipt = await before.json() as Record<string,unknown>;
  if (originalReceipt.status === "complete") return {...originalReceipt,draftId:plan.draftId,draftHash:plan.draftHash,documentRoute:experienceDocumentRoute(plan),generation:"unavailable",replayed:true};
  const approved = await loadApprovedSponsorCampaign(request,env,command.campaignId);
  if (approved.policy.resources.version !== 2 || approved.actor.userId !== auth.user.userId || approved.policyDigest !== saved.receipt.policy_digest
    || await sponsorPrincipalDigest(approved.actor) !== saved.receipt.session_digest || (await registeredExperience("image"))?.releaseHash !== plan.release.releaseHash) return fail("sponsor_intake_authority_changed");
  const resourceLive: BudgetReservationGuard = {sql:`EXISTS(SELECT 1 FROM experience_sponsor_resource_policies WHERE campaign_id=? AND enabled=1 AND limits_digest=? AND limits_json=?) AND ${databaseNow}>=? AND ${databaseNow}<?`,
    bindings:[command.campaignId,saved.receipt.limits_digest,canonicalJson(approved.policy.resources),approved.policy.resources.startsAtMs,approved.policy.resources.expiresAtMs]};
  const guard = join(saved.proof,resourceLive,...approved.assertions.map(p=>({sql:p.sql,bindings:p.bindings??[]})));
  const commitOptions = allowance ? sealSponsorIntakePostNativeReceipt(allowance,request,env,auth,intake,{...options,guard}) : {...options,guard};
  const response = await commitAtomicIntake(env,auth,intake,"commit",commitOptions), result = await response.json() as Record<string,unknown>;
  if (result.status !== "complete") return fail("sponsor_intake_commit_unconfirmed");
  return {...result,draftId:plan.draftId,draftHash:plan.draftHash,documentRoute:experienceDocumentRoute(plan),generation:"unavailable",replayed:false};
}
