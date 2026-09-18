import { canonicalJson, digest, freeze, record } from "../src/experiences/compiler.ts";
import { parseSceneMiniAppCostPreview, sceneMiniAppCostApprovalMatches } from "../src/model/scene-mini-app-consent.ts";
import { parseSceneOutputContract } from "../src/model/output-scene-contract.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorSceneCampaign, readSponsorInternalCommand } from "./experience-sponsor-approval.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { captureSponsorSceneJson } from "./experience-sponsor-scene-contract.ts";
import { createSponsorSceneIssuerAuthority, issueSponsorSceneGrant, readSponsorSceneDriverCommand,
  sponsorSceneIssuerIntentKey, type SponsorScenePrepareCommand, type SponsorSceneRunCommand } from "./experience-sponsor-scene-issuer.ts";
import { createSponsorExecutionAuthority } from "./experience-sponsor-execution.ts";
import { loadOutputTrustedContext, outputExperienceCommands, outputDigest, type OutputTrustedContext } from "./output-requirements-api.ts";
import { outputDocumentExecutionBridge } from "./output-document-execution.ts";
import { outputAssertionStatements, outputCommandReceiptAssertion, readOutputCommand, type OutputCommandReceipt, type OutputSqlAssertion } from "./output-command-core.ts";
import { runDocumentJob } from "./document-jobs-api.ts";
import { inheritRuntimeSchemaReadiness, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
type Guard = () => void;
type Command = SponsorScenePrepareCommand | SponsorSceneRunCommand;
type Intent = { driver_id: string; campaign_id: string; actor_user_id: string; session_digest: string; intent_key: string;
  document_id: string; command_json: string; command_digest: string; source_digest: string; requirements_digest: string; source_text_bytes: number };
type Stage = { command_json: string; command_digest: string };
const noDetachedWork: WorkerExecutionContext = { waitUntil() { fail("sponsor_driver_detached_work_unsupported"); } };

async function guarded<T>(current: Guard, work: () => Promise<T>): Promise<T> {
  current(); const value = await work(); current(); return value;
}
function errorPresent(value: unknown) {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const field = Object.getOwnPropertyDescriptor(value, "error");
  return !field || !Object.hasOwn(field, "value") || field.value !== undefined;
}
function checkedBatch(value: unknown, expected: number, finalRead = false) {
  if (!Array.isArray(value) || own(value, "length") !== expected || Array.from({ length: expected }, (_, index) => {
    const result = own(value, index);
    const rows = own(result, "results");
    return own(result, "success") !== true || errorPresent(result) || !Array.isArray(rows)
      || own(rows, "length") !== (finalRead && index === expected - 1 ? 1 : 0);
  }).some(Boolean)) return fail("sponsor_driver_batch_unconfirmed");
  return value;
}
async function batch(env: WorkerEnv, statements: D1PreparedStatement[], current: Guard, finalRead = false) {
  return checkedBatch(await guarded(current, () => env.DB.batch(statements)), statements.length, finalRead);
}
function lifetime(request: Request, env: WorkerEnv) {
  const database = env.DB, signal = request.signal;
  const nativeSignal = () => Object.getOwnPropertyDescriptor(Request.prototype, "signal")!.get!.call(request);
  const binding = () => canonicalJson({ request: { url: request.url, method: request.method, headers: [...request.headers.entries()] },
    configuration: { model: env.OPENAI_MODEL ?? null, key: env.OPENAI_API_KEY ?? null,
      cohort: env.FORMA_PILOT_COHORT_ID ?? null, admins: env.FORMA_ADMIN_EMAILS ?? null } });
  const captured = binding();
  const current = () => {
    if (env.DB !== database || signal !== nativeSignal() || request.signal !== signal
      || Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!.call(signal) !== false || binding() !== captured)
      fail("sponsor_driver_authority_changed");
  };
  current(); return current;
}
function loaderEnvironment(env: WorkerEnv, current: Guard): WorkerEnv {
  // Only data loaders and native preflight use this view. Opaque native
  // admission/Run handles always receive the actual captured environment.
  const database = env.DB, originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const statement = (prepared: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(prepared, { get(target, key) {
      current();
      const member = Reflect.get(target, key, target);
      if (typeof member !== "function") return member;
      if (key === "bind") return (...args: unknown[]) => { current(); return statement(Reflect.apply(member, target, args)); };
      return (...args: unknown[]) => guarded(current, () => Reflect.apply(member, target, args) as Promise<unknown>);
    } });
    originals.set(wrapped, prepared); return wrapped;
  };
  const guardedDatabase = new Proxy(database, { get(target, key) {
    current();
    const member = Reflect.get(target, key, target);
    if (key === "prepare") return (sql: string) => { current(); return statement(target.prepare(sql)); };
    if (key === "batch") return (statements: D1PreparedStatement[]) => guarded(current,
      () => target.batch(statements.map(value => originals.get(value) ?? value)));
    return typeof member === "function" ? (...args: unknown[]) => guarded(current, () => Reflect.apply(member, target, args) as Promise<unknown>) : member;
  } });
  inheritRuntimeSchemaReadiness(database, guardedDatabase);
  const captured = { ...env };
  Object.defineProperty(captured, "DB", { get() { current(); return guardedDatabase; } });
  return captured;
}
async function approvedCampaign(request: Request, env: WorkerEnv, campaignId: string, current: Guard) {
  return guarded(current, () => loadApprovedSponsorSceneCampaign(request, loaderEnvironment(env, current), campaignId));
}
function selection(command: Command): SponsorScenePrepareCommand {
  return { action: "prepare-sponsored-scene", campaignId: command.campaignId, documentId: command.documentId,
    planRevisionId: command.planRevisionId, targetId: command.targetId, intentKey: command.intentKey };
}
async function commandFrom(request: Request, action: Command["action"], current: Guard) {
  const command = readSponsorSceneDriverCommand(await guarded(current, () => readSponsorInternalCommand(request, 8192)));
  if (command.action !== action) fail("sponsor_driver_command_invalid");
  current(); return command;
}
function sceneTarget(target: unknown) {
  return record(target) && target.media_kind === "document" && target.selected === true && parseSceneOutputContract(target.scene_contract)
    && Array.isArray(target.blocking_issues) && target.blocking_issues.length === 0
    && canonicalJson(target.quantity) === canonicalJson({ kind: "exact", unit: "document", value: 1 })
    && record(target.source_scope) && target.source_scope.kind === "document"
    && record(target.coverage) && target.coverage.kind === "document_context"
    && !["narrative_contract", "audio_contract", "video_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(target, key));
}
async function trustedFrom(request: Request, env: WorkerEnv, command: Command, current: Guard) {
  // Guard nested data-loader accesses, then restore the actual environment before
  // minting any native capability. The original Request and scope are retained.
  const loaded = await guarded(current, () => loadOutputTrustedContext(request, loaderEnvironment(env, current), command.documentId, "request"));
  if (loaded instanceof Response) return fail("sponsor_driver_document_unavailable");
  const trusted: OutputTrustedContext = { ...loaded, env };
  if (trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.contextId
    || trusted.scope.organizationId || trusted.scope.projectAccessId || trusted.projectContext || trusted.principal.fictional
    || trusted.principal.projectExecution || trusted.principal.userId !== trusted.scope.actorUserId
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId
    || trusted.sourceProblems.length || !trusted.context || !trusted.sourcePrivateCaptured) return fail("sponsor_driver_source_unsupported");
  const plan = await guarded(current, () => outputExperienceCommands.readConfirmedPlan({ ...trusted, env: loaderEnvironment(env, current) }, command.planRevisionId));
  if (!plan || plan.sourceDigest !== trusted.sourceDigest || plan.requirementsDigest !== trusted.requirementsDigest)
    return fail("sponsor_driver_source_changed");
  if (plan.plan.targets.length !== 1 || plan.plan.targets[0]!.id !== command.targetId || !sceneTarget(plan.plan.targets[0]))
    return fail("sponsor_driver_target_unsupported");
  return trusted;
}
function sourceProofs(trusted: OutputTrustedContext) { return sponsorCurrentSourceAssertions(trusted); }
function intentProof(intent: Intent): OutputSqlAssertion {
  return { sql: `EXISTS(SELECT 1 FROM experience_sponsor_driver_intents WHERE driver_id=? AND campaign_id=? AND actor_user_id=?
    AND session_digest=? AND intent_key=? AND document_id=? AND command_json=? AND command_digest=? AND source_digest=? AND requirements_digest=? AND source_text_bytes=?)`,
  bindings: [intent.driver_id, intent.campaign_id, intent.actor_user_id, intent.session_digest, intent.intent_key, intent.document_id,
    intent.command_json, intent.command_digest, intent.source_digest, intent.requirements_digest, intent.source_text_bytes] };
}
function stageProof(driverId: string, stage: string, command: Record<string, unknown>, commandDigest: string): OutputSqlAssertion {
  return { sql: "EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage=? AND command_json=? AND command_digest=?)",
    bindings: [driverId, stage, canonicalJson(command), commandDigest] };
}
async function stageFrom(env: WorkerEnv, driverId: string, stage: string, current: Guard) {
  const row = await guarded(current, () => env.DB.prepare("SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage=?")
    .bind(driverId, stage).first<Stage>());
  if (!row) return null;
  let command: unknown;
  try { command = captureSponsorSceneJson(JSON.parse(row.command_json)); } catch { return fail("sponsor_driver_stage_corrupt"); }
  if (!record(command) || command.action !== stage || row.command_json !== canonicalJson(command)
    || row.command_digest !== await guarded(current, () => outputDigest(command))) return fail("sponsor_driver_stage_corrupt");
  return command;
}
function stageStatement(env: WorkerEnv, driverId: string, stage: string, command: Record<string, unknown>, commandDigest: string) {
  return env.DB.prepare("INSERT INTO experience_sponsor_driver_stages(driver_id,stage,command_json,command_digest) VALUES(?,?,?,?)")
    .bind(driverId, stage, canonicalJson(command), commandDigest);
}
async function recordStage(env: WorkerEnv, intent: Intent, stage: string, command: Record<string, unknown>, assertions: OutputSqlAssertion[], current: Guard) {
  const commandDigest = await guarded(current, () => outputDigest(command));
  try {
    await batch(env, [...assertions, intentProof(intent)].flatMap(proof => outputAssertionStatements(env, proof)).concat([
      stageStatement(env, intent.driver_id, stage, command, commandDigest),
      ...outputAssertionStatements(env, stageProof(intent.driver_id, stage, command, commandDigest)),
    ]), current);
  } catch (error) {
    if (error instanceof SponsorEntitlementError) throw error;
    current();
    const committed = await stageFrom(env, intent.driver_id, stage, current);
    if (committed && canonicalJson(committed) === canonicalJson(command)) return committed;
    if (committed) return fail("sponsor_driver_stage_changed");
    throw error;
  }
  current(); return command;
}
async function intentFrom(command: Command, approved: Awaited<ReturnType<typeof approvedCampaign>>, trusted: OutputTrustedContext, current: Guard) {
  if (approved.actor.userId !== trusted.scope.actorUserId) fail("sponsor_driver_actor_changed");
  const prepare = selection(command), sessionDigest = await guarded(current, () => sponsorPrincipalDigest(approved.actor));
  const intent: Intent = { driver_id: `sponsor-scene-driver-${(await guarded(current, () => digest({ campaignId: command.campaignId, actor: approved.actor.userId, intentKey: command.intentKey }))).slice(7)}`,
    campaign_id: command.campaignId, actor_user_id: approved.actor.userId, session_digest: sessionDigest, intent_key: command.intentKey,
    document_id: command.documentId, command_json: canonicalJson(prepare), command_digest: await guarded(current, () => digest(prepare)),
    source_digest: trusted.sourceDigest, requirements_digest: trusted.requirementsDigest,
    source_text_bytes: new TextEncoder().encode(canonicalJson(trusted.context!.snapshot)).byteLength };
  const original = await guarded(current, () => trusted.env.DB.prepare("SELECT * FROM experience_sponsor_driver_intents WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
    .bind(command.campaignId, approved.actor.userId, command.intentKey).first<Intent>());
  if (original && Object.keys(intent).some(key => original[key as keyof Intent] !== intent[key as keyof Intent])) fail("sponsor_driver_intent_changed");
  return { intent, original, resourceBase: { limits: approved.policy.resources, campaignId: command.campaignId, policyDigest: approved.policyDigest,
    actorUserId: approved.actor.userId, sessionDigest, intentKey: command.intentKey, textBytes: intent.source_text_bytes,
    payloadDigest: await guarded(current, () => digest({ command: prepare, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest })) } };
}
function nativeQuote(receipt: OutputCommandReceipt) {
  const body = captureSponsorSceneJson(receipt.payload), quote = record(body) && record(body.preflight) ? body.preflight : null;
  if (!quote || !id(quote.id) || typeof quote.termsDigest !== "string" || !Number.isSafeInteger(quote.maximumMicrousd)
    || Number(quote.maximumMicrousd) < 1 || typeof quote.expiresAt !== "string" || !Number.isFinite(Date.parse(quote.expiresAt))
    || !Array.isArray(quote.targets) || quote.targets.length !== 1 || !record(quote.targets[0]) || quote.targets[0].available !== true)
    return fail("sponsor_driver_preflight_unavailable");
  const offered = quote.targets[0], settings = record(offered.settings) ? offered.settings : null;
  const payload = settings && record(settings.payload) ? settings.payload : null;
  const scene = payload && record(payload.outputScene) ? payload.outputScene : null;
  const preview = scene && parseSceneMiniAppCostPreview(scene.costPreview);
  if (!preview) return fail("sponsor_driver_preflight_unavailable");
  return { quote, preview };
}
async function preflightFrom(env: WorkerEnv, trusted: OutputTrustedContext, intent: Intent, current: Guard) {
  const command = await stageFrom(env, intent.driver_id, "preflight", current);
  if (!command) return fail("sponsor_driver_prepare_required");
  const commandDigest = await guarded(current, () => outputDigest(command));
  const receipt = await guarded(current, () => readOutputCommand(loaderEnvironment(env, current), trusted.scope, String(command.clientMutationId), commandDigest));
  if (!receipt) return fail("sponsor_driver_stage_unknown");
  return { command, commandDigest, receipt, ...nativeQuote(receipt) };
}
function bounded<T>(value: T): T {
  const captured = captureSponsorSceneJson(value) as T;
  const json = canonicalJson(captured);
  if (new TextEncoder().encode(json).byteLength > 65536) fail("sponsor_driver_response_too_large");
  return freeze(JSON.parse(json) as T);
}

/** Dormant existing-Document preparation. Two semantic resource tickets own
 * one native preflight; no route, schema initializer or background task is added.
 * The actor must return with the exact preview and an explicit confirmation. */
export async function prepareSponsoredSceneDriver(request: Request, env: WorkerEnv, context: WorkerExecutionContext = noDetachedWork) {
  const current = lifetime(request, env), foreground: WorkerExecutionContext = { ...context, waitUntil: noDetachedWork.waitUntil };
  const command = await commandFrom(request, "prepare-sponsored-scene", current) as SponsorScenePrepareCommand;
  const approved = await approvedCampaign(request, env, command.campaignId, current);
  let trusted = await trustedFrom(request, env, command, current);
  const { intent, original, resourceBase } = await intentFrom(command, approved, trusted, current);
  const intake = await guarded(current, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "text-intake", resourceId: `${intent.driver_id}:text` }));
  const proofs = [...approved.assertions, ...sourceProofs(trusted)];
  if (!original) {
    await batch(env, [...proofs.flatMap(proof => outputAssertionStatements(env, proof)),
      env.DB.prepare(`INSERT INTO experience_sponsor_driver_intents(driver_id,campaign_id,actor_user_id,session_digest,intent_key,document_id,
        command_json,command_digest,source_digest,requirements_digest,source_text_bytes,created_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`)
        .bind(intent.driver_id, intent.campaign_id, intent.actor_user_id, intent.session_digest, intent.intent_key, intent.document_id,
          intent.command_json, intent.command_digest, intent.source_digest, intent.requirements_digest, intent.source_text_bytes),
      ...intake.statements.map(statement => env.DB.prepare(statement.sql).bind(...statement.bindings)),
      ...outputAssertionStatements(env, intentProof(intent)),
    ], current);
  } else await batch(env, [...proofs, intentProof(intent), ...intake.assertions.map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] })),
    { sql: intake.receiptAssertion.sql, bindings: [...intake.receiptAssertion.bindings] }]
    .flatMap(proof => outputAssertionStatements(env, proof)), current);
  let preflightCommand = await stageFrom(env, intent.driver_id, "preflight", current), ownsPreflight = false;
  if (!preflightCommand) {
    const suffix = (await guarded(current, () => sponsorSceneIssuerIntentKey(command))).slice("sponsor-scene-authorize-".length);
    preflightCommand = { action: "preflight", documentId: command.documentId, planRevisionId: command.planRevisionId, targetIds: [command.targetId],
      expectedRevision: `output:${trusted.ownerHead}`, clientMutationId: `sponsor-scene-preflight-${suffix}` };
    const ticket = await guarded(current, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "preflight", resourceId: `${intent.driver_id}:preflight` }));
    const absent: OutputSqlAssertion = { sql: `NOT EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts
      WHERE campaign_id=? AND actor_user_id=? AND operation='preflight' AND intent_key=?)
      AND NOT EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='preflight')`,
    bindings: [command.campaignId, approved.actor.userId, command.intentKey, intent.driver_id] };
    const commandDigest = await guarded(current, () => outputDigest(preflightCommand!));
    try {
      await batch(env, [...proofs, intentProof(intent), absent].flatMap(proof => outputAssertionStatements(env, proof)).concat([
        ...ticket.statements.map(statement => env.DB.prepare(statement.sql).bind(...statement.bindings)),
        stageStatement(env, intent.driver_id, "preflight", preflightCommand, commandDigest),
      ]), current);
      ownsPreflight = true;
    } catch (error) {
      if (error instanceof SponsorEntitlementError) throw error;
      current();
      if (await stageFrom(env, intent.driver_id, "preflight", current)) fail("sponsor_driver_stage_unknown");
      throw error;
    }
  }
  const preflightDigest = await guarded(current, () => outputDigest(preflightCommand!));
  let receipt = await guarded(current, () => readOutputCommand(loaderEnvironment(env, current), trusted.scope, String(preflightCommand!.clientMutationId), preflightDigest));
  if (!receipt) {
    if (!ownsPreflight) fail("sponsor_driver_stage_unknown");
    await guarded(current, () => outputExperienceCommands.execute({ ...trusted, env: loaderEnvironment(env, current) }, preflightCommand!, outputDocumentExecutionBridge, foreground));
    trusted = await trustedFrom(request, env, command, current);
    receipt = await guarded(current, () => readOutputCommand(loaderEnvironment(env, current), trusted.scope, String(preflightCommand!.clientMutationId), preflightDigest));
    if (!receipt) return fail("sponsor_driver_stage_unknown");
  }
  const { quote, preview } = nativeQuote(receipt);
  const preflightTicket = await guarded(current, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "preflight", resourceId: `${intent.driver_id}:preflight` }));
  const freshApproved = await approvedCampaign(request, env, command.campaignId, current);
  trusted = await trustedFrom(request, env, command, current);
  if (freshApproved.policyDigest !== approved.policyDigest || freshApproved.actor.userId !== intent.actor_user_id
    || await guarded(current, () => sponsorPrincipalDigest(freshApproved.actor)) !== intent.session_digest) fail("sponsor_driver_authority_changed");
  const disclosureProofs: OutputSqlAssertion[] = [...freshApproved.assertions, ...sourceProofs(trusted), intentProof(intent),
    ...preflightTicket.assertions.map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] })),
    { sql: preflightTicket.receiptAssertion.sql, bindings: [...preflightTicket.receiptAssertion.bindings] },
    stageProof(intent.driver_id, "preflight", preflightCommand!, preflightDigest), outputCommandReceiptAssertion(trusted.scope, receipt)];
  const deadline = Math.min(approved.policy.resources.expiresAtMs, Date.parse(String(quote.expiresAt)), Date.parse(preview.expiresAt),
    ...disclosureProofs.flatMap(p => p.deadlineMs === undefined ? [] : [p.deadlineMs]));
  const discloseCurrent = () => { current(); if (Date.now() >= deadline) fail("sponsor_driver_authority_changed"); };
  const result = bounded({ campaignId: command.campaignId, policyDigest: approved.policyDigest, payerUserId: approved.policy.payerUserId,
    documentId: command.documentId, planRevisionId: command.planRevisionId, targetId: command.targetId, intentKey: command.intentKey,
    preflight: { id: quote.id as string, termsDigest: quote.termsDigest as string, maximumMicrousd: quote.maximumMicrousd as number, expiresAt: quote.expiresAt as string },
    sceneCostPreview: preview });
  await batch(env, disclosureProofs.flatMap(proof => outputAssertionStatements(env, proof)), discloseCurrent);
  discloseCurrent(); return result;
}

async function discloseCurrentJob(request: Request, env: WorkerEnv, command: SponsorSceneRunCommand, intent: Intent,
  grantId: string, jobId: string, issuance: Awaited<ReturnType<typeof issueSponsorSceneGrant>>, originalReceipt: OutputCommandReceipt, runCommand: Record<string, unknown>, current: Guard) {
  const approved = await approvedCampaign(request, env, command.campaignId, current), trusted = await trustedFrom(request, env, command, current);
  if (approved.policyDigest !== command.reviewedPolicyDigest || approved.actor.userId !== intent.actor_user_id
    || await guarded(current, () => sponsorPrincipalDigest(approved.actor)) !== intent.session_digest
    || trusted.sourceDigest !== intent.source_digest || trusted.requirementsDigest !== intent.requirements_digest) fail("sponsor_driver_authority_changed");
  const runDigest = await guarded(current, () => outputDigest(runCommand));
  const resourceBase = { limits: approved.policy.resources, campaignId: command.campaignId, policyDigest: approved.policyDigest,
    actorUserId: intent.actor_user_id, sessionDigest: intent.session_digest, intentKey: intent.intent_key, textBytes: intent.source_text_bytes,
    payloadDigest: await guarded(current, () => digest({ command: selection(command), sourceDigest: intent.source_digest, requirementsDigest: intent.requirements_digest })) };
  const intake = await guarded(current, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "text-intake", resourceId: `${intent.driver_id}:text` }));
  const preflight = await guarded(current, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "preflight", resourceId: `${intent.driver_id}:preflight` }));
  const envelopeDigest = await guarded(current, () => digest(issuance.envelope));
  const issued = await guarded(current, () => prepareSponsorResourcePlan({ ...resourceBase, operation: "issuance",
    intentKey: issuance.envelope.intentKey, payloadDigest: envelopeDigest,
    resourceId: `${issuance.grantId}:issuance`, issuedGrantId: issuance.grantId }));
  const resourceProofs = [intake, preflight, issued].flatMap(plan => [...plan.assertions, plan.receiptAssertion])
    .map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] }));
  const proofs: OutputSqlAssertion[] = [...resourceProofs, ...approved.assertions, ...sourceProofs(trusted), intentProof(intent), outputCommandReceiptAssertion(trusted.scope, originalReceipt),
    stageProof(intent.driver_id, "run", runCommand, runDigest)];
  const deadline = Math.min(approved.policy.resources.expiresAtMs, issuance.envelope.expiresAtMs, ...proofs.flatMap(proof => proof.deadlineMs === undefined ? [] : [proof.deadlineMs]));
  const discloseCurrent = () => { current(); if (Date.now() >= deadline) fail("sponsor_driver_authority_changed"); };
  const rows = await batch(env, [...proofs.flatMap(proof => outputAssertionStatements(env, proof)),
    env.DB.prepare(`SELECT job.status FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
      JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
      WHERE job.job_id=? AND job.owner_id=? AND job.document_id=? AND job.stream_id=? AND job.scene_source_protocol=1
        AND slot.scope_key=? AND slot.grant_id=? AND execution.actor_user_id=? AND execution.payer_user_id=?`)
      .bind(jobId, intent.actor_user_id, command.documentId, `creative:${intent.actor_user_id}`, trusted.scope.key, grantId, intent.actor_user_id, approved.policy.payerUserId),
  ], discloseCurrent, true);
  const results = own(own(rows, rows.length - 1), "results"), status = own(own(results, 0), "status");
  if (!Array.isArray(results) || own(results, "length") !== 1 || typeof status !== "string"
    || !["queued", "running", "completed", "failed", "canceled"].includes(status)) fail("sponsor_driver_original_job_unavailable");
  const result = bounded({ jobId, status: status as string, replayed: issuance.kind === "admitted" });
  discloseCurrent(); return { result, assertCurrent: discloseCurrent };
}

/** The second explicit actor call authorizes and drives only the original Scene
 * in the foreground. Resource V1 funds semantic preparation/issuance, not a
 * public polling service; this function is deliberately unregistered. */
export async function driveSponsoredScene(request: Request, env: WorkerEnv, context: WorkerExecutionContext = noDetachedWork) {
  const outerCurrent = lifetime(request, env), nativeRequests: Guard[] = [];
  const current = () => { outerCurrent(); for (const check of nativeRequests) check(); };
  const foreground: WorkerExecutionContext = { ...context, waitUntil: noDetachedWork.waitUntil };
  const command = await commandFrom(request, "run-sponsored-scene", current) as SponsorSceneRunCommand;
  const approved = await approvedCampaign(request, env, command.campaignId, current);
  if (command.reviewedPolicyDigest !== approved.policyDigest) fail("sponsor_driver_review_changed");
  let trusted = await trustedFrom(request, env, command, current);
  const { intent, original } = await intentFrom(command, approved, trusted, current);
  if (!original) fail("sponsor_driver_prepare_required");
  const preflight = await preflightFrom(env, trusted, intent, current);
  if (command.preflightId !== preflight.quote.id || command.termsDigest !== preflight.quote.termsDigest
    || command.maximumMicrousd !== preflight.quote.maximumMicrousd) fail("sponsor_driver_review_changed");
  if (!sceneMiniAppCostApprovalMatches(command.sceneCostConsent, preflight.preview)) fail("sponsor_driver_review_changed");
  let authorizeCommand = await stageFrom(env, intent.driver_id, "authorize", current);
  const nativeKey = await guarded(current, () => sponsorSceneIssuerIntentKey(command));
  if (!authorizeCommand) authorizeCommand = await recordStage(env, intent, "authorize", {
    action: "authorize", documentId: command.documentId, expectedRevision: `output:${trusted.ownerHead}`, clientMutationId: nativeKey,
    preflightId: command.preflightId, termsDigest: command.termsDigest, maximumMicrousd: command.maximumMicrousd,
    explicitAuthorization: command.explicitAuthorization, sceneCostConsent: command.sceneCostConsent,
  }, [...approved.assertions, ...sourceProofs(trusted), outputCommandReceiptAssertion(trusted.scope, preflight.receipt)], current);
  if (authorizeCommand.clientMutationId !== nativeKey || authorizeCommand.documentId !== command.documentId
    || authorizeCommand.preflightId !== command.preflightId || authorizeCommand.termsDigest !== command.termsDigest
    || authorizeCommand.maximumMicrousd !== command.maximumMicrousd || authorizeCommand.explicitAuthorization !== true
    || canonicalJson(authorizeCommand.sceneCostConsent) !== canonicalJson(command.sceneCostConsent)) fail("sponsor_driver_review_changed");
  const issuer = await guarded(current, () => createSponsorSceneIssuerAuthority(trusted, command.campaignId));
  const issued = await guarded(current, () => issueSponsorSceneGrant(issuer, trusted, authorizeCommand!));
  const authorized = issued.kind === "admitted" ? null
    : await guarded(current, () => outputExperienceCommands.executeSponsored(trusted, authorizeCommand!, issued.admissionAuthority, outputDocumentExecutionBridge, foreground));
  if (authorized instanceof Response) return fail("sponsor_driver_authorization_unavailable");
  const receipt = issued.kind === "admitted" ? issued.nativeReceipt : authorized!.receipt;
  const grantId = receipt.payload.grant_id;
  if (!id(grantId)) return fail("sponsor_driver_authorization_unavailable");
  trusted = await trustedFrom(request, env, command, current);
  let runCommand = await stageFrom(env, intent.driver_id, "run", current);
  if (!runCommand) runCommand = await recordStage(env, intent, "run", { action: "run", documentId: command.documentId,
    expectedRevision: `output:${trusted.ownerHead}`, clientMutationId: `sponsor-scene-run-${nativeKey.slice("sponsor-scene-authorize-".length)}`, grantId },
  [...approved.assertions, ...sourceProofs(trusted), outputCommandReceiptAssertion(trusted.scope, receipt)], current);
  if (runCommand.grantId !== grantId || runCommand.documentId !== command.documentId
    || runCommand.clientMutationId !== `sponsor-scene-run-${nativeKey.slice("sponsor-scene-authorize-".length)}`) fail("sponsor_driver_stage_changed");
  const job = await guarded(current, () => env.DB.prepare(`SELECT job.job_id,job.status FROM output_operation_slots slot
    JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
    JOIN document_jobs job ON job.job_id=slot.job_id AND job.owner_id=execution.actor_user_id
    WHERE slot.scope_key=? AND slot.grant_id=? AND execution.actor_user_id=? AND execution.payer_user_id=? AND job.document_id=? AND job.scene_source_protocol=1`)
    .bind(trusted.scope.key, grantId, approved.actor.userId, approved.policy.payerUserId, command.documentId).first<{ job_id: string; status: string }>());
  if (!job || !id(job.job_id)) return fail("sponsor_driver_original_job_unavailable");
  if (!["completed", "failed", "canceled"].includes(job.status)) {
    const runRequest = new Request(request.url, { method: "POST", headers: request.headers, body: canonicalJson(runCommand), signal: request.signal });
    nativeRequests.push(lifetime(runRequest, env));
    const executionTrusted = await trustedFrom(runRequest, env, command, current);
    const scenePreparation = await guarded(current, () => outputExperienceCommands.prepareSponsoredSceneRun(executionTrusted, runCommand!));
    const authority = await guarded(current, () => createSponsorExecutionAuthority(executionTrusted, runCommand!, { scenePreparation }));
    await guarded(current, () => outputExperienceCommands.executeSponsoredRun(executionTrusted, runCommand!, authority, outputDocumentExecutionBridge, foreground));
    // Native Run advances its source witness. Dispatch must re-read that stored
    // successor with a new opaque Run preparation, never an admission baseline.
    const freshRequest = new Request(request.url, { method: "POST", headers: request.headers, body: canonicalJson(runCommand), signal: request.signal });
    nativeRequests.push(lifetime(freshRequest, env));
    const freshTrusted = await trustedFrom(freshRequest, env, command, current);
    const freshPreparation = await guarded(current, () => outputExperienceCommands.prepareSponsoredSceneRun(freshTrusted, runCommand!));
    const freshAuthority = await guarded(current, () => createSponsorExecutionAuthority(freshTrusted, runCommand!, { scenePreparation: freshPreparation }));
    await guarded(current, () => runDocumentJob(env, freshTrusted.principal, job.job_id, undefined, freshAuthority));
  }
  const disclosure = await discloseCurrentJob(request, env, command, intent, grantId, job.job_id, issued, receipt, runCommand, current);
  disclosure.assertCurrent(); return disclosure.result;
}
