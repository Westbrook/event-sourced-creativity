import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorSlidesCampaign, readSponsorInternalCommand } from "./experience-sponsor-approval.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { createSponsorSlidesIssuerAuthority, issueSponsorSlidesGrant, sponsorSlidesIssuerIntentKey } from "./experience-sponsor-slides-issuer.ts";
import { createSponsorExecutionAuthority } from "./experience-sponsor-execution.ts";
import { loadOutputTrustedContext, outputExperienceCommands, outputDigest, type OutputTrustedContext } from "./output-requirements-api.ts";
import { outputDocumentExecutionBridge } from "./output-document-execution.ts";
import { outputAssertionStatements, outputCommandReceiptAssertion, readOutputCommand, type OutputSqlAssertion } from "./output-command-core.ts";
import { runDocumentJob } from "./document-jobs-api.ts";
import type { WorkerEnv, WorkerExecutionContext } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object"
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function checkedBatch(value: unknown, expected: number) {
  if (!Array.isArray(value) || own(value, "length") !== expected || Array.from({ length: expected }, (_, index) => {
    const result = own(value, index);
    return own(result, "success") !== true || own(result, "error") !== undefined || !Array.isArray(own(result, "results"));
  }).some(Boolean)) return fail("sponsor_driver_batch_unconfirmed");
  return value;
}
async function batch(env: WorkerEnv, statements: D1PreparedStatement[]) {
  const expected = statements.length;
  return checkedBatch(await env.DB.batch(statements), expected);
}
function slidesTarget(target: unknown) {
  return record(target) && target.media_kind === "slides" && target.selected === true
    && Array.isArray(target.blocking_issues) && target.blocking_issues.length === 0
    && canonicalJson(target.quantity) === canonicalJson({ kind: "exact", unit: "presentation", value: 1 })
    && canonicalJson(target.content_quantity) === canonicalJson({ kind: "exact", unit: "slide", value: 5 })
    && canonicalJson(target.count_policy) === canonicalJson({ kind: "exact", unit: "slide", value: 5 })
    && record(target.source_scope) && target.source_scope.kind === "document"
    && record(target.coverage) && target.coverage.kind === "document_outline"
    && !target.aspect_ratio && !target.variant_id && !target.member_id
    && !["narrative_contract", "scene_contract", "audio_contract", "video_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(target, key));
}
const noDetachedWork: WorkerExecutionContext = { waitUntil() { fail("sponsor_driver_detached_work_unsupported"); } };
type Command = { action: "run-sponsored-slides"; campaignId: string; documentId: string; planRevisionId: string; targetId: string; intentKey: string };
type Intent = { driver_id: string; campaign_id: string; actor_user_id: string; session_digest: string; intent_key: string;
  document_id: string; command_json: string; command_digest: string; source_digest: string; requirements_digest: string; source_text_bytes: number };
type Stage = { command_json: string; command_digest: string };
type Guard = () => void;
async function guarded<T>(current: Guard, work: () => Promise<T>): Promise<T> {
  current();
  const value = await work();
  current();
  return value;
}
function approvedCampaign(request: Request, env: WorkerEnv, campaignId: string, current: Guard) {
  current();
  // This data-only loader has internal awaits. Its local view guards each DB
  // access while native capabilities below retain the original environment.
  const captured = { ...env };
  Object.defineProperty(captured, "DB", { get() { current(); return env.DB; } });
  return loadApprovedSponsorSlidesCampaign(request, captured, campaignId);
}

// Reuses the unchanged generic driver receipts. Importing this function adds
// no schema initializer, public route, campaign, queue or scheduled work.

async function commandFrom(request: Request): Promise<Command> {
  if (request.method !== "POST" || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return fail("sponsor_driver_post_required");
  const raw = await readSponsorInternalCommand(request, 4096);
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "campaignId", "documentId", "planRevisionId", "targetId", "intentKey"])
    || raw.action !== "run-sponsored-slides" || ![raw.campaignId, raw.documentId, raw.planRevisionId, raw.targetId, raw.intentKey].every(id)
    || String(raw.intentKey).length > 80) return fail("sponsor_driver_command_invalid");
  return JSON.parse(canonicalJson(raw)) as Command;
}
async function trustedFrom(request: Request, env: WorkerEnv, command: Command, current: Guard) {
  const trusted = await guarded(current, () => loadOutputTrustedContext(request, env, command.documentId, "request"));
  if (trusted instanceof Response) return fail("sponsor_driver_document_unavailable");
  if (trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.sourceProblems.length || !trusted.context)
    return fail("sponsor_driver_source_unsupported");
  const plan = await guarded(current, () => outputExperienceCommands.readConfirmedPlan(trusted, command.planRevisionId));
  if (!plan || plan.sourceDigest !== trusted.sourceDigest || plan.requirementsDigest !== trusted.requirementsDigest)
    return fail("sponsor_driver_source_changed");
  const selected = plan.plan.targets.filter(target => target.selected);
  if (plan.plan.targets.length !== 1 || selected.length !== 1 || selected[0]!.id !== command.targetId || !slidesTarget(selected[0]))
    return fail("sponsor_driver_target_unsupported");
  return trusted;
}
function sourceProofs(trusted: OutputTrustedContext): OutputSqlAssertion[] {
  return sponsorCurrentSourceAssertions(trusted);
}
function intentProof(intent: Intent): OutputSqlAssertion {
  return { sql: `EXISTS(SELECT 1 FROM experience_sponsor_driver_intents WHERE driver_id=? AND campaign_id=? AND actor_user_id=?
    AND session_digest=? AND intent_key=? AND document_id=? AND command_json=? AND command_digest=? AND source_digest=? AND requirements_digest=? AND source_text_bytes=?)`,
  bindings: [intent.driver_id, intent.campaign_id, intent.actor_user_id, intent.session_digest, intent.intent_key, intent.document_id,
    intent.command_json, intent.command_digest, intent.source_digest, intent.requirements_digest, intent.source_text_bytes] };
}
async function stageFrom(env: WorkerEnv, driverId: string, stage: string, current: Guard) {
  const row = await guarded(current, () => env.DB.prepare("SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage=?")
    .bind(driverId, stage).first<Stage>());
  if (!row) return null;
  let command: unknown; try { command = JSON.parse(row.command_json); } catch { return fail("sponsor_driver_stage_corrupt"); }
  if (jsonIssues(command).length || !record(command) || row.command_digest !== await guarded(current, () => outputDigest(command)) || command.action !== stage)
    return fail("sponsor_driver_stage_corrupt");
  return command;
}
function stageStatement(env: WorkerEnv, driverId: string, stage: string, command: Record<string, unknown>, commandDigest: string) {
  return env.DB.prepare("INSERT INTO experience_sponsor_driver_stages(driver_id,stage,command_json,command_digest) VALUES(?,?,?,?)")
    .bind(driverId, stage, canonicalJson(command), commandDigest);
}
async function recordStage(env: WorkerEnv, intent: Intent, stage: string, command: Record<string, unknown>, assertions: OutputSqlAssertion[], current: Guard) {
  const existing = await stageFrom(env, intent.driver_id, stage, current);
  if (existing) return existing;
  const commandDigest = await guarded(current, () => outputDigest(command));
  try { await guarded(current, () => batch(env, [...assertions, intentProof(intent)].flatMap(proof => outputAssertionStatements(env, proof)).concat([
    stageStatement(env, intent.driver_id, stage, command, commandDigest),
  ]))); } catch (error) {
    const committed = await stageFrom(env, intent.driver_id, stage, current);
    if (committed) return committed;
    throw error;
  }
  return command;
}

/** Refresh current authority after the runner's awaits. Metadata disclosure and
 * its exact original job read share one guarded batch; known settlement is never
 * undone merely because campaign or source access was subsequently revoked. */
async function discloseCurrentJob(request: Request, env: WorkerEnv, command: Command, intent: Intent, grantId: string, jobId: string, replayed: boolean, current: Guard) {
  const approved = await guarded(current, () => approvedCampaign(request, env, command.campaignId, current));
  const trusted = await trustedFrom(request, env, command, current);
  if (approved.actor.userId !== intent.actor_user_id || trusted.sourceDigest !== intent.source_digest
    || trusted.requirementsDigest !== intent.requirements_digest || await guarded(current, () => sponsorPrincipalDigest(approved.actor)) !== intent.session_digest)
    return fail("sponsor_driver_authority_changed");
  const proofs = [...approved.assertions, ...sourceProofs(trusted), intentProof(intent)];
  const deadline = Math.min(...proofs.flatMap(proof => proof.deadlineMs === undefined ? [] : [proof.deadlineMs]));
  const disclosureCurrent = () => { current(); if (Date.now() >= deadline) return fail("sponsor_driver_authority_changed"); };
  const rows = await guarded(disclosureCurrent, () => batch(env, [
    ...proofs.flatMap(proof => outputAssertionStatements(env, proof)),
    env.DB.prepare(`SELECT job.status FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
      JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
      WHERE job.job_id=? AND job.owner_id=? AND job.document_id=? AND job.stream_id=?
        AND slot.scope_key=? AND slot.grant_id=? AND execution.actor_user_id=?`)
      .bind(jobId, intent.actor_user_id, command.documentId, `creative:${intent.actor_user_id}`, trusted.scope.key, grantId, intent.actor_user_id),
  ]));
  const result = own(rows, Number(own(rows, "length")) - 1), results = own(result, "results"), row = own(results, 0), status = own(row, "status");
  if (!Array.isArray(results) || own(results, "length") !== 1 || typeof status !== "string") return fail("sponsor_driver_original_job_unavailable");
  disclosureCurrent();
  // The enclosing public driver's await is another lifetime boundary. This
  // synchronous assertion remains private and cannot perform I/O.
  return { result: { jobId, status, replayed }, assertCurrent: disclosureCurrent };
}

/** Continuous, explicit, foreground internal driver. Source preparation reads
 * an already-owned confirmed Document before metering its canonical snapshot
 * bytes. The two tickets bound existing-Document text preparation and native
 * preflight, NOT anonymous ingress, initial storage, uploads or provider usage.
 * A committed preflight ticket without its durable native receipt is unknown
 * and cannot be retried. An intake-only receipt can claim the still-absent
 * preflight stage once in its atomic resource transaction. No route invokes this dormant function. */
export async function driveSponsoredSlides(request: Request, env: WorkerEnv, context: WorkerExecutionContext = noDetachedWork) {
  const database = env.DB, signal = request.signal;
  const binding = () => canonicalJson({ request: { url: request.url, method: request.method, headers: [...request.headers.entries()] },
    configuration: { model: env.OPENAI_MODEL ?? null, compositionModel: env.OPENAI_SLIDES_COMPOSITION_MODEL ?? null,
      compositionEffort: env.OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT ?? null, repairModel: env.OPENAI_SLIDES_REPAIR_MODEL ?? null,
      repairEffort: env.OPENAI_SLIDES_REPAIR_REASONING_EFFORT ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null,
      providerConfigured: Boolean(env.OPENAI_API_KEY) } });
  const captured = binding();
  const foreground: WorkerExecutionContext = { ...context, waitUntil: noDetachedWork.waitUntil };
  const unchanged = () => { if (env.DB !== database || signal.aborted || request.signal !== signal || binding() !== captured)
    return fail("sponsor_driver_authority_changed"); };
  const command = await guarded(unchanged, () => commandFrom(request));
  const approved = await guarded(unchanged, () => approvedCampaign(request, env, command.campaignId, unchanged));
  unchanged();
  let trusted = await trustedFrom(request, env, command, unchanged);
  if (approved.actor.userId !== trusted.scope.actorUserId) return fail("sponsor_driver_actor_changed");
  const sessionDigest = await guarded(unchanged, () => sponsorPrincipalDigest(approved.actor)), commandJson = canonicalJson(command), commandDigest = await guarded(unchanged, () => digest(command));
  const sourceBytes = new TextEncoder().encode(canonicalJson(trusted.context!.snapshot)).byteLength;
  const stableStageKey = (await guarded(unchanged, () => sponsorSlidesIssuerIntentKey(command))).slice("sponsor-slides-authorize-".length);
  const driverId = `sponsor-slides-driver-${(await guarded(unchanged, () => digest({ campaignId: command.campaignId, actor: approved.actor.userId, intentKey: command.intentKey }))).slice(7)}`;
  const intent: Intent = { driver_id: driverId, campaign_id: command.campaignId, actor_user_id: approved.actor.userId,
    session_digest: sessionDigest, intent_key: command.intentKey, document_id: command.documentId,
    command_json: commandJson, command_digest: commandDigest, source_digest: trusted.sourceDigest,
    requirements_digest: trusted.requirementsDigest, source_text_bytes: sourceBytes };
  const original = await guarded(unchanged, () => env.DB.prepare("SELECT * FROM experience_sponsor_driver_intents WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
    .bind(command.campaignId, approved.actor.userId, command.intentKey).first<Intent>());
  if (original && Object.keys(intent).some(key => original[key as keyof Intent] !== intent[key as keyof Intent])) return fail("sponsor_driver_intent_changed");
  const resourceBase = { limits: approved.policy.resources, campaignId: command.campaignId, policyDigest: approved.policyDigest,
    actorUserId: approved.actor.userId, sessionDigest, intentKey: command.intentKey,
    payloadDigest: await guarded(unchanged, () => digest({ command, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest })), textBytes: sourceBytes };
  const intake = await guarded(unchanged, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "text-intake", resourceId: `${driverId}:text` }));
  const proofs = [...approved.assertions, ...sourceProofs(trusted)];
  unchanged();
  if (!original) {
    await guarded(unchanged, () => batch(env, [...proofs.flatMap(proof => outputAssertionStatements(env, proof)),
      env.DB.prepare(`INSERT INTO experience_sponsor_driver_intents(driver_id,campaign_id,actor_user_id,session_digest,intent_key,document_id,
        command_json,command_digest,source_digest,requirements_digest,source_text_bytes,created_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`)
        .bind(intent.driver_id, intent.campaign_id, intent.actor_user_id, intent.session_digest, intent.intent_key, intent.document_id,
          intent.command_json, intent.command_digest, intent.source_digest, intent.requirements_digest, intent.source_text_bytes),
      ...intake.statements.map(statement => env.DB.prepare(statement.sql).bind(...statement.bindings)),
      ...outputAssertionStatements(env, intentProof(intent)),
    ]));
  } else await guarded(unchanged, () => batch(env, [...proofs, intentProof(intent), { sql: intake.receiptAssertion.sql, bindings: [...intake.receiptAssertion.bindings] }]
    .flatMap(proof => outputAssertionStatements(env, proof))));

  unchanged();
  let preflightCommand = await stageFrom(env, driverId, "preflight", unchanged), ownsPreflight = false;
  if (!preflightCommand) {
    preflightCommand = { action: "preflight", documentId: command.documentId, planRevisionId: command.planRevisionId, targetIds: [command.targetId],
      expectedRevision: `output:${trusted.ownerHead}`, clientMutationId: `sponsor-slides-preflight-${stableStageKey}` };
    const ticket = await guarded(unchanged, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "preflight", resourceId: `${driverId}:preflight` }));
    const absent: OutputSqlAssertion = { sql: `NOT EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts
      WHERE campaign_id=? AND actor_user_id=? AND operation='preflight' AND intent_key=?)
      AND NOT EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='preflight')`,
    bindings: [command.campaignId, approved.actor.userId, command.intentKey, driverId] };
    const preflightDigest = await guarded(unchanged, () => outputDigest(preflightCommand!));
    try {
      await guarded(unchanged, () => batch(env, [...proofs, intentProof(intent), absent].flatMap(proof => outputAssertionStatements(env, proof)).concat([
        ...ticket.statements.map(statement => env.DB.prepare(statement.sql).bind(...statement.bindings)),
        stageStatement(env, driverId, "preflight", preflightCommand!, preflightDigest),
      ])));
      ownsPreflight = true;
    } catch (error) {
      // A committed claim with a lost acknowledgment, or another claimant,
      // grants no permission to repeat possibly started protected work.
      if (await stageFrom(env, driverId, "preflight", unchanged)) return fail("sponsor_driver_stage_unknown");
      throw error;
    }
  }
  const preflightDigest = await guarded(unchanged, () => outputDigest(preflightCommand!));
  let preflight = await guarded(unchanged, () => readOutputCommand(env, trusted.scope, String(preflightCommand!.clientMutationId), preflightDigest));
  if (!preflight) {
    if (!ownsPreflight) return fail("sponsor_driver_stage_unknown");
    await guarded(unchanged, () => outputExperienceCommands.execute(trusted, preflightCommand!, outputDocumentExecutionBridge, foreground));
    trusted = await trustedFrom(request, env, command, unchanged);
    preflight = await guarded(unchanged, () => readOutputCommand(env, trusted.scope, String(preflightCommand!.clientMutationId), preflightDigest));
    if (!preflight) return fail("sponsor_driver_stage_unknown");
  }
  const quote = record(preflight.payload.preflight) ? preflight.payload.preflight : null;
  if (!quote || !id(quote.id) || typeof quote.termsDigest !== "string" || !Number.isSafeInteger(quote.maximumMicrousd)
    || !Array.isArray(quote.targets) || quote.targets.length !== 1 || !record(quote.targets[0]) || quote.targets[0].available !== true)
    return fail("sponsor_driver_preflight_unavailable");
  trusted = await trustedFrom(request, env, command, unchanged);
  const authorizeCommand = await recordStage(env, intent, "authorize", {
    action: "authorize", documentId: command.documentId, expectedRevision: `output:${trusted.ownerHead}`,
    clientMutationId: await guarded(unchanged, () => sponsorSlidesIssuerIntentKey(command)), preflightId: quote.id, termsDigest: quote.termsDigest,
    maximumMicrousd: quote.maximumMicrousd, explicitAuthorization: true,
  }, [...approved.assertions, ...sourceProofs(trusted), outputCommandReceiptAssertion(trusted.scope, preflight)], unchanged);

  unchanged();
  let runCommand = await stageFrom(env, driverId, "run", unchanged);
  if (!runCommand) {
    const issuer = await guarded(unchanged, () => createSponsorSlidesIssuerAuthority(trusted, command.campaignId));
    const issued = await guarded(unchanged, () => issueSponsorSlidesGrant(issuer, trusted, authorizeCommand));
    const authorized = issued.kind === "admitted" ? null
      : await guarded(unchanged, () => outputExperienceCommands.executeSponsored(trusted, authorizeCommand, issued.admissionAuthority, outputDocumentExecutionBridge, foreground));
    if (authorized instanceof Response) return fail("sponsor_driver_authorization_unavailable");
    const receipt = issued.kind === "admitted" ? issued.nativeReceipt : authorized!.receipt;
    const grantId = receipt.payload.grant_id;
    if (!id(grantId)) return fail("sponsor_driver_authorization_unavailable");
    trusted = await trustedFrom(request, env, command, unchanged);
    runCommand = await recordStage(env, intent, "run", { action: "run", documentId: command.documentId,
      expectedRevision: `output:${trusted.ownerHead}`, clientMutationId: `sponsor-slides-run-${stableStageKey}`, grantId },
    [...approved.assertions, ...sourceProofs(trusted), outputCommandReceiptAssertion(trusted.scope, receipt)], unchanged);
  }
  unchanged();
  const grantId = String(runCommand.grantId);
  const job = await guarded(unchanged, () => env.DB.prepare(`SELECT job.job_id,job.status FROM output_operation_slots slot
    JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
    JOIN document_jobs job ON job.job_id=slot.job_id AND job.owner_id=execution.actor_user_id
    WHERE slot.scope_key=? AND slot.grant_id=? AND execution.actor_user_id=? AND job.document_id=?`)
    .bind(trusted.scope.key, grantId, approved.actor.userId, command.documentId).first<{ job_id: string; status: string }>());
  if (!job) return fail("sponsor_driver_original_job_unavailable");
  if (["completed", "failed", "canceled"].includes(job.status)) {
    const disclosure = await discloseCurrentJob(request, env, command, intent, grantId, job.job_id, true, unchanged);
    disclosure.assertCurrent();
    return disclosure.result;
  }
  // Fresh requests reconstruct authority from persisted native grants/holds.
  // They preserve the real actor headers; the wire never selects a payer.
  const executionRequest = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(runCommand), signal: request.signal });
  const executionTrusted = await trustedFrom(executionRequest, env, command, unchanged);
  const executionAuthority = await guarded(unchanged, () => createSponsorExecutionAuthority(executionTrusted, runCommand!));
  await guarded(unchanged, () => outputExperienceCommands.executeSponsoredRun(executionTrusted, runCommand!, executionAuthority, outputDocumentExecutionBridge, foreground));
  const freshRequest = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(runCommand), signal: request.signal });
  const freshTrusted = await trustedFrom(freshRequest, env, command, unchanged);
  const freshAuthority = await guarded(unchanged, () => createSponsorExecutionAuthority(freshTrusted, runCommand!));
  unchanged();
  await guarded(unchanged, () => runDocumentJob(env, freshTrusted.principal, job.job_id, undefined, freshAuthority));
  unchanged();
  const disclosure = await discloseCurrentJob(request, env, command, intent, grantId, job.job_id, Boolean(original), unchanged);
  disclosure.assertCurrent();
  return disclosure.result;
}
