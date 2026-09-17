import { sponsorImageTextSource } from "./experience-sponsor-image-format.ts";
import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorCampaign, readSponsorInternalCommand } from "./experience-sponsor-approval.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { createSponsorIssuerAuthority, issueSponsorGrant, sponsorIssuerIntentKey } from "./experience-sponsor-issuer.ts";
import { createSponsorExecutionAuthority } from "./experience-sponsor-execution.ts";
import { loadOutputTrustedContext, outputExperienceCommands, outputDigest, type OutputTrustedContext } from "./output-requirements-api.ts";
import { outputDocumentExecutionBridge } from "./output-document-execution.ts";
import { outputAssertionStatements, outputCommandReceiptAssertion, readOutputCommand, type OutputSqlAssertion } from "./output-command-core.ts";
import { runDocumentJob } from "./document-jobs-api.ts";
import type { WorkerEnv, WorkerExecutionContext } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const noDetachedWork: WorkerExecutionContext = { waitUntil() { fail("sponsor_driver_detached_work_unsupported"); } };
type Command = { action: "run-sponsored-image"; campaignId: string; documentId: string; planRevisionId: string; targetId: string; intentKey: string };
type Intent = { driver_id: string; campaign_id: string; actor_user_id: string; session_digest: string; intent_key: string;
  document_id: string; command_json: string; command_digest: string; source_digest: string; requirements_digest: string; source_text_bytes: number };
type Stage = { command_json: string; command_digest: string };

/** Dormant operational receipts only. No creative text is stored here, and no
 * route, schema initializer, queue driver or production policy imports this. */
export const SPONSOR_DRIVER_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_driver_intents(driver_id TEXT PRIMARY KEY NOT NULL,
    campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),actor_user_id TEXT NOT NULL,session_digest TEXT NOT NULL,
    intent_key TEXT NOT NULL,document_id TEXT NOT NULL,command_json TEXT NOT NULL,command_digest TEXT NOT NULL,
    source_digest TEXT NOT NULL,requirements_digest TEXT NOT NULL,source_text_bytes INTEGER NOT NULL CHECK(source_text_bytes>=0),
    created_at_ms INTEGER NOT NULL,UNIQUE(campaign_id,actor_user_id,intent_key))`,
  `CREATE TABLE experience_sponsor_driver_stages(driver_id TEXT NOT NULL REFERENCES experience_sponsor_driver_intents(driver_id),
    stage TEXT NOT NULL CHECK(stage IN('preflight','authorize','run')),command_json TEXT NOT NULL,command_digest TEXT NOT NULL,
    PRIMARY KEY(driver_id,stage))`,
  ...["intents", "stages"].flatMap(table => [
    ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_driver_${table}_no_${action.toLowerCase()}
      BEFORE ${action} ON experience_sponsor_driver_${table} BEGIN SELECT RAISE(ABORT,'sponsor_driver_receipt_immutable'); END`),
    `CREATE TRIGGER experience_sponsor_driver_${table}_no_replace BEFORE INSERT ON experience_sponsor_driver_${table}
      WHEN EXISTS(SELECT 1 FROM experience_sponsor_driver_${table} old WHERE old.driver_id=NEW.driver_id${table === "stages" ? " AND old.stage=NEW.stage" : " OR (old.campaign_id=NEW.campaign_id AND old.actor_user_id=NEW.actor_user_id AND old.intent_key=NEW.intent_key)"})
      BEGIN SELECT RAISE(ABORT,'sponsor_driver_receipt_exists'); END`,
  ]),
]);

async function commandFrom(request: Request): Promise<Command> {
  if (request.method !== "POST" || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return fail("sponsor_driver_post_required");
  const raw = await readSponsorInternalCommand(request, 4096);
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "campaignId", "documentId", "planRevisionId", "targetId", "intentKey"])
    || raw.action !== "run-sponsored-image" || ![raw.campaignId, raw.documentId, raw.planRevisionId, raw.targetId, raw.intentKey].every(id)
    || String(raw.intentKey).length > 80) return fail("sponsor_driver_command_invalid");
  return JSON.parse(canonicalJson(raw)) as Command;
}
async function trustedFrom(request: Request, env: WorkerEnv, command: Command) {
  const trusted = await loadOutputTrustedContext(request, env, command.documentId, "request");
  if (trusted instanceof Response) return fail("sponsor_driver_document_unavailable");
  if (trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.sourceProblems.length || !trusted.context)
    return fail("sponsor_driver_source_unsupported");
  const plan = await outputExperienceCommands.readConfirmedPlan(trusted, command.planRevisionId);
  if (!plan || plan.sourceDigest !== trusted.sourceDigest || plan.requirementsDigest !== trusted.requirementsDigest)
    return fail("sponsor_driver_source_changed");
  const selected = plan.plan.targets.filter(target => target.selected);
  if (selected.length !== 1 || selected[0]!.id !== command.targetId || selected[0]!.media_kind !== "image" || selected[0]!.blocking_issues.length)
    return fail("sponsor_driver_target_unsupported");
  if (!await sponsorImageTextSource(trusted.context.snapshot.facts)) return fail("sponsor_driver_text_source_required");
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
async function stageFrom(env: WorkerEnv, driverId: string, stage: string) {
  const row = await env.DB.prepare("SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage=?")
    .bind(driverId, stage).first<Stage>();
  if (!row) return null;
  let command: unknown; try { command = JSON.parse(row.command_json); } catch { return fail("sponsor_driver_stage_corrupt"); }
  if (jsonIssues(command).length || !record(command) || row.command_digest !== await outputDigest(command) || command.action !== stage)
    return fail("sponsor_driver_stage_corrupt");
  return command;
}
function stageStatement(env: WorkerEnv, driverId: string, stage: string, command: Record<string, unknown>, commandDigest: string) {
  return env.DB.prepare("INSERT INTO experience_sponsor_driver_stages(driver_id,stage,command_json,command_digest) VALUES(?,?,?,?)")
    .bind(driverId, stage, canonicalJson(command), commandDigest);
}
async function recordStage(env: WorkerEnv, intent: Intent, stage: string, command: Record<string, unknown>, assertions: OutputSqlAssertion[]) {
  const existing = await stageFrom(env, intent.driver_id, stage);
  if (existing) return existing;
  try { await env.DB.batch([...assertions, intentProof(intent)].flatMap(proof => outputAssertionStatements(env, proof)).concat([
    stageStatement(env, intent.driver_id, stage, command, await outputDigest(command)),
  ])); } catch (error) {
    const committed = await stageFrom(env, intent.driver_id, stage);
    if (committed) return committed;
    throw error;
  }
  return command;
}

/** Refresh current authority after the runner's awaits. Metadata disclosure and
 * its exact original job read share one guarded batch; known settlement is never
 * undone merely because campaign or source access was subsequently revoked. */
async function discloseCurrentJob(request: Request, env: WorkerEnv, command: Command, intent: Intent, grantId: string, jobId: string, replayed: boolean) {
  const approved = await loadApprovedSponsorCampaign(request, env, command.campaignId);
  const trusted = await trustedFrom(request, env, command);
  if (approved.actor.userId !== intent.actor_user_id || trusted.sourceDigest !== intent.source_digest
    || trusted.requirementsDigest !== intent.requirements_digest || await sponsorPrincipalDigest(approved.actor) !== intent.session_digest)
    return fail("sponsor_driver_authority_changed");
  const rows = await env.DB.batch<{ status: string }>([
    ...[...approved.assertions, ...sourceProofs(trusted), intentProof(intent)].flatMap(proof => outputAssertionStatements(env, proof)),
    env.DB.prepare(`SELECT job.status FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
      JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
      WHERE job.job_id=? AND job.owner_id=? AND job.document_id=? AND job.stream_id=?
        AND slot.scope_key=? AND slot.grant_id=? AND execution.actor_user_id=?`)
      .bind(jobId, intent.actor_user_id, command.documentId, `creative:${intent.actor_user_id}`, trusted.scope.key, grantId, intent.actor_user_id),
  ]);
  const result = rows.at(-1);
  if (!result?.success || result.results.length !== 1 || typeof result.results[0]?.status !== "string") return fail("sponsor_driver_original_job_unavailable");
  return { jobId, status: result.results[0].status, replayed };
}

/** Continuous, explicit, foreground internal driver. Source preparation reads
 * an already-owned confirmed Document before metering its canonical snapshot
 * bytes. The two tickets bound existing-Document text preparation and native
 * preflight, NOT anonymous ingress, initial storage, uploads or provider usage.
 * A committed preflight ticket without its durable native receipt is unknown
 * and cannot be retried. An intake-only receipt can claim the still-absent
 * preflight stage once in its atomic resource transaction. No route invokes this dormant function. */
export async function driveSponsoredImage(request: Request, env: WorkerEnv, context: WorkerExecutionContext = noDetachedWork) {
  const command = await commandFrom(request), approved = await loadApprovedSponsorCampaign(request, env, command.campaignId);
  let trusted = await trustedFrom(request, env, command);
  if (approved.actor.userId !== trusted.scope.actorUserId) return fail("sponsor_driver_actor_changed");
  const sessionDigest = await sponsorPrincipalDigest(approved.actor), commandJson = canonicalJson(command), commandDigest = await digest(command);
  const sourceBytes = new TextEncoder().encode(canonicalJson(trusted.context!.snapshot)).byteLength;
  const stableStageKey = (await sponsorIssuerIntentKey(command)).slice("sponsor-authorize-".length);
  const driverId = `sponsor-driver-${(await digest({ campaignId: command.campaignId, actor: approved.actor.userId, intentKey: command.intentKey })).slice(7)}`;
  const intent: Intent = { driver_id: driverId, campaign_id: command.campaignId, actor_user_id: approved.actor.userId,
    session_digest: sessionDigest, intent_key: command.intentKey, document_id: command.documentId,
    command_json: commandJson, command_digest: commandDigest, source_digest: trusted.sourceDigest,
    requirements_digest: trusted.requirementsDigest, source_text_bytes: sourceBytes };
  const original = await env.DB.prepare("SELECT * FROM experience_sponsor_driver_intents WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
    .bind(command.campaignId, approved.actor.userId, command.intentKey).first<Intent>();
  if (original && Object.keys(intent).some(key => original[key as keyof Intent] !== intent[key as keyof Intent])) return fail("sponsor_driver_intent_changed");
  const resourceBase = { limits: approved.policy.resources, campaignId: command.campaignId, policyDigest: approved.policyDigest,
    actorUserId: approved.actor.userId, sessionDigest, intentKey: command.intentKey,
    payloadDigest: await digest({ command, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest }), textBytes: sourceBytes };
  const intake = await prepareSponsorResourcePlan({ ...resourceBase, operation: "text-intake", resourceId: `${driverId}:text` });
  const proofs = [...approved.assertions, ...sourceProofs(trusted)];
  if (!original) {
    await env.DB.batch([...proofs.flatMap(proof => outputAssertionStatements(env, proof)),
      env.DB.prepare(`INSERT INTO experience_sponsor_driver_intents(driver_id,campaign_id,actor_user_id,session_digest,intent_key,document_id,
        command_json,command_digest,source_digest,requirements_digest,source_text_bytes,created_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`)
        .bind(intent.driver_id, intent.campaign_id, intent.actor_user_id, intent.session_digest, intent.intent_key, intent.document_id,
          intent.command_json, intent.command_digest, intent.source_digest, intent.requirements_digest, intent.source_text_bytes),
      ...intake.statements.map(statement => env.DB.prepare(statement.sql).bind(...statement.bindings)),
      ...outputAssertionStatements(env, intentProof(intent)),
    ]);
  } else await env.DB.batch([...proofs, intentProof(intent), { sql: intake.receiptAssertion.sql, bindings: [...intake.receiptAssertion.bindings] }]
    .flatMap(proof => outputAssertionStatements(env, proof)));

  let preflightCommand = await stageFrom(env, driverId, "preflight"), ownsPreflight = false;
  if (!preflightCommand) {
    preflightCommand = { action: "preflight", documentId: command.documentId, planRevisionId: command.planRevisionId, targetIds: [command.targetId],
      expectedRevision: `output:${trusted.ownerHead}`, clientMutationId: `sponsor-preflight-${stableStageKey}` };
    const ticket = await prepareSponsorResourcePlan({ ...resourceBase, operation: "preflight", resourceId: `${driverId}:preflight` });
    const absent: OutputSqlAssertion = { sql: `NOT EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts
      WHERE campaign_id=? AND actor_user_id=? AND operation='preflight' AND intent_key=?)
      AND NOT EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='preflight')`,
    bindings: [command.campaignId, approved.actor.userId, command.intentKey, driverId] };
    try {
      await env.DB.batch([...proofs, intentProof(intent), absent].flatMap(proof => outputAssertionStatements(env, proof)).concat([
        ...ticket.statements.map(statement => env.DB.prepare(statement.sql).bind(...statement.bindings)),
        stageStatement(env, driverId, "preflight", preflightCommand, await outputDigest(preflightCommand)),
      ]));
      ownsPreflight = true;
    } catch (error) {
      // A committed claim with a lost acknowledgment, or another claimant,
      // grants no permission to repeat possibly started protected work.
      if (await stageFrom(env, driverId, "preflight")) return fail("sponsor_driver_stage_unknown");
      throw error;
    }
  }
  let preflight = await readOutputCommand(env, trusted.scope, String(preflightCommand.clientMutationId), await outputDigest(preflightCommand));
  if (!preflight) {
    if (!ownsPreflight) return fail("sponsor_driver_stage_unknown");
    await outputExperienceCommands.execute(trusted, preflightCommand, outputDocumentExecutionBridge, context);
    trusted = await trustedFrom(request, env, command);
    preflight = await readOutputCommand(env, trusted.scope, String(preflightCommand.clientMutationId), await outputDigest(preflightCommand));
    if (!preflight) return fail("sponsor_driver_stage_unknown");
  }
  const quote = record(preflight.payload.preflight) ? preflight.payload.preflight : null;
  if (!quote || !id(quote.id) || typeof quote.termsDigest !== "string" || !Number.isSafeInteger(quote.maximumMicrousd)
    || !Array.isArray(quote.targets) || quote.targets.length !== 1 || !record(quote.targets[0]) || quote.targets[0].available !== true)
    return fail("sponsor_driver_preflight_unavailable");
  trusted = await trustedFrom(request, env, command);
  const authorizeCommand = await recordStage(env, intent, "authorize", {
    action: "authorize", documentId: command.documentId, expectedRevision: `output:${trusted.ownerHead}`,
    clientMutationId: await sponsorIssuerIntentKey(command), preflightId: quote.id, termsDigest: quote.termsDigest,
    maximumMicrousd: quote.maximumMicrousd, explicitAuthorization: true,
  }, [...approved.assertions, ...sourceProofs(trusted), outputCommandReceiptAssertion(trusted.scope, preflight)]);

  let runCommand = await stageFrom(env, driverId, "run");
  if (!runCommand) {
    const issuer = await createSponsorIssuerAuthority(trusted, command.campaignId);
    const issued = await issueSponsorGrant(issuer, trusted, authorizeCommand);
    const authorized = await outputExperienceCommands.executeSponsored(trusted, authorizeCommand, issued.admissionAuthority, outputDocumentExecutionBridge, context);
    if (authorized instanceof Response) return fail("sponsor_driver_authorization_unavailable");
    const grantId = authorized.receipt.payload.grant_id;
    if (!id(grantId)) return fail("sponsor_driver_authorization_unavailable");
    trusted = await trustedFrom(request, env, command);
    runCommand = await recordStage(env, intent, "run", { action: "run", documentId: command.documentId,
      expectedRevision: `output:${trusted.ownerHead}`, clientMutationId: `sponsor-run-${stableStageKey}`, grantId },
    [...approved.assertions, ...sourceProofs(trusted), outputCommandReceiptAssertion(trusted.scope, authorized.receipt)]);
  }
  const grantId = String(runCommand.grantId);
  const job = await env.DB.prepare(`SELECT job.job_id,job.status FROM output_operation_slots slot
    JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
    JOIN document_jobs job ON job.job_id=slot.job_id AND job.owner_id=execution.actor_user_id
    WHERE slot.scope_key=? AND slot.grant_id=? AND execution.actor_user_id=? AND job.document_id=?`)
    .bind(trusted.scope.key, grantId, approved.actor.userId, command.documentId).first<{ job_id: string; status: string }>();
  if (!job) return fail("sponsor_driver_original_job_unavailable");
  if (["completed", "failed", "canceled"].includes(job.status)) return discloseCurrentJob(request, env, command, intent, grantId, job.job_id, true);
  // Fresh requests reconstruct authority from persisted native grants/holds.
  // They preserve the real actor headers; the wire never selects a payer.
  const executionRequest = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(runCommand), signal: request.signal });
  const executionTrusted = await trustedFrom(executionRequest, env, command);
  const executionAuthority = await createSponsorExecutionAuthority(executionTrusted, runCommand);
  await outputExperienceCommands.executeSponsoredRun(executionTrusted, runCommand, executionAuthority, outputDocumentExecutionBridge, context);
  const freshRequest = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(runCommand), signal: request.signal });
  const freshTrusted = await trustedFrom(freshRequest, env, command);
  const freshAuthority = await createSponsorExecutionAuthority(freshTrusted, runCommand);
  await runDocumentJob(env, freshTrusted.principal, job.job_id, undefined, freshAuthority);
  return discloseCurrentJob(request, env, command, intent, grantId, job.job_id, Boolean(original));
}
