import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import type { OutputConfirmedPlan } from "../src/model/output-delivery-contract.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { preflightOutputVideoTarget, outputVideoPreflightProof, requireOutputVideoOriginal } from "./output-video-preflight.ts";
import { readVideoExecutionOffer } from "../src/model/output-video-offer.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { OUTPUT_VIDEO_TRANSPORT } from "./output-video-execution.ts";
import type { WorkerEnv } from "./runtime.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import { outputProofReadStatements, assertOutputProofRead, outputDigest } from "./output-disclosure-proof.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const commandKeys = ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization"];
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const principalColumns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const quoteSql = `SELECT preflight.terms_digest,preflight.expires_at,body.private_json,plan.source_head,plan.plan_revision_id,plan_body.private_json AS plan_json
  FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
  JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
  JOIN event_private_payloads plan_body ON plan_body.private_event_id=plan.confirmed_event_id AND plan_body.owner_id=plan.owner_user_id AND plan_body.project_id=plan.project_id AND plan_body.document_id=plan.document_id AND plan_body.redacted_at IS NULL
  WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
    AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?
    AND NOT EXISTS(SELECT 1 FROM output_plan_revisions newer WHERE newer.scope_key=plan.scope_key AND newer.revision>plan.revision)`;
type Quote = { terms_digest: string; expires_at: string; private_json: string; source_head: number; plan_revision_id: string; plan_json: string };

type ReadLifetime = { deadlineMs: number; check(): void; wait<T>(work: Promise<T>): Promise<T> };
const cancel = (body: ReadableStream<Uint8Array> | null | undefined) => { try { void body?.cancel().catch(() => undefined); } catch { /* Nonblocking retirement. */ } };
/** Native custody needs HEAD, provenance HEAD, GET, final HEAD. This local
 * read adapter bounds that exact work; it allocates no sponsor allowance. */
function boundedMedia(media: WorkerEnv["MEDIA"], lifetime: ReadLifetime): WorkerEnv["MEDIA"] {
  let heads = 0, gets = 0, originalKey: string | undefined;
  const key = (value: string) => {
    lifetime.check();
    if (originalKey === undefined) originalKey = value;
    if (value !== originalKey) fail("sponsor_video_media_scope_changed");
  };
  const limit = VIDEO_ADAPTER_CONTRACT.maxReferenceBytes;
  return new Proxy(media, { get(_target, name) {
    if (name === "head") return async (value: string) => {
      key(value); if (++heads > 3) fail("sponsor_video_media_read_limit");
      const object = await lifetime.wait(Promise.resolve().then(() => { lifetime.check(); return media.head(value); }));
      if (object && (typeof object.size !== "number" || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > limit)) fail("sponsor_video_media_byte_limit");
      return object;
    };
    if (name === "get") return async (value: string) => {
      key(value); if (++gets > 1) fail("sponsor_video_media_read_limit");
      const object = await lifetime.wait(Promise.resolve().then(() => { lifetime.check(); return media.get(value); }).then(object => {
        try { lifetime.check(); } catch (error) { if (object) cancel(object.body); throw error; } return object;
      }));
      if (!object) return null;
      const size = object.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > limit) { cancel(object.body); fail("sponsor_video_media_byte_limit"); }
      const headers = new Headers(); object.writeHttpMetadata(headers);
      const metadata = { ...object.customMetadata };
      const reader = object.body.getReader(), chunks: Uint8Array[] = [];
      let length = 0, complete = false;
      try {
        for (let index = 0; index < 65536; index++) {
          const next = await lifetime.wait(reader.read());
          if (next.done) { complete = true; break; }
          if (!(next.value instanceof Uint8Array) || !next.value.length || length + next.value.length > Number(size) || length + next.value.length > limit)
            fail("sponsor_video_media_byte_limit");
          chunks.push(next.value.slice()); length += next.value.length;
        }
        if (!complete || length !== size) fail("sponsor_video_media_byte_limit");
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        lifetime.check();
        return { size: length, body: new Blob([bytes.buffer]).stream(), customMetadata: metadata,
          writeHttpMetadata(target: Headers) { headers.forEach((value, key) => target.set(key, value)); } };
      } finally {
        if (!complete) { try { void reader.cancel().catch(() => undefined); } catch { /* No waiting for cancellation. */ } }
        try { reader.releaseLock(); } catch { /* Pending read is observed by wait. */ }
      }
    };
    return () => fail("sponsor_video_media_operation_unsupported");
  } }) as WorkerEnv["MEDIA"];
}
async function readNative(trusted: OutputTrustedContext, command: Record<string, unknown>) {
  const request = trusted.request, deadlineMs = Date.now() + 30000;
  let active = true, rejectStop!: (reason: unknown) => void;
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; });
  const abort = () => rejectStop(new SponsorEntitlementError("sponsor_video_read_interrupted"));
  const check = () => {
    if (!active || Date.now() >= deadlineMs || request.signal.aborted) fail("sponsor_video_read_interrupted");
  };
  const lifetime: ReadLifetime = { deadlineMs, check, async wait<T>(work: Promise<T>) {
    // Race first so even a reentrant abort observes work's later rejection.
    const pending = Promise.race([work, stop]);
    try { check(); } catch (error) { void pending.catch(() => undefined); throw error; }
    const value = await pending; check(); return value;
  } };
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 30000);
  // Invoke directly: command/source capture must precede the first yield.
  try { return await lifetime.wait(readNativeWithin(trusted, command, lifetime)); }
  finally { active = false; clearTimeout(timer); request.signal.removeEventListener("abort", abort); rejectStop(new SponsorEntitlementError("sponsor_video_read_retired")); }
}

/** Read-only native evidence, never sponsor authority. The registered ordinary
 * video preflight is recomputed from current authorized context without egress.
 * Original Request/DB/source bytes and all retained proof are checked again in
 * one final read batch. Callers must still run commit-time sponsorship checks. */
async function readNativeWithin(trusted: OutputTrustedContext, rawCommand: Record<string, unknown>, lifetime: ReadLifetime) {
  lifetime.check();
  if (jsonIssues(rawCommand).length || !exactKeys(rawCommand, commandKeys) || rawCommand.action !== "authorize"
    || !id(rawCommand.clientMutationId) || !id(rawCommand.preflightId) || rawCommand.documentId !== trusted.scope.documentId
    || rawCommand.expectedRevision !== `output:${trusted.ownerHead}` || rawCommand.explicitAuthorization !== true
    || !Number.isSafeInteger(rawCommand.maximumMicrousd) || Number(rawCommand.maximumMicrousd) < 1) return fail("sponsor_command_invalid");
  const command = JSON.parse(canonicalJson(rawCommand)) as Record<string, unknown>;
  if (trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.contextId
    || trusted.scope.organizationId || trusted.scope.projectAccessId || trusted.projectContext || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId || trusted.env.FORMA_PILOT_COHORT_ID?.trim()
    || !trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured) return fail("sponsor_scope_unsupported");
  const request = trusted.request, env = trusted.env, database = env.DB;
  const source = () => canonicalJson({ scope: trusted.scope, principal: { userId: trusted.principal.userId, consentVersion: trusted.principal.consentVersion,
    fictional: trusted.principal.fictional ?? false, projectExecution: trusted.principal.projectExecution ?? null, billingUserId: trusted.principal.billingUserId ?? null,
    authorizationSnapshot: trusted.principal.authorizationSnapshot ?? null }, projectContext: Boolean(trusted.projectContext),
    sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    configuration: { model: env.OPENAI_MODEL ?? null, videoProvider: env.FORMA_VIDEO_PROVIDER ?? null, plannerConfigured: Boolean(env.OPENAI_API_KEY), videoConfigured: Boolean(env.FAL_KEY), cohort: env.FORMA_PILOT_COHORT_ID ?? null }, ownerHead: trusted.ownerHead,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, context: trusted.context, events: trusted.events, assertions: trusted.sourceAssertions });
  const captured = source(), media = env.MEDIA, plannerKey = env.OPENAI_API_KEY, videoKey = env.FAL_KEY;
  const current = () => trusted.request === request && trusted.env === env && env.DB === database && env.MEDIA === media
    && env.OPENAI_API_KEY === plannerKey && env.FAL_KEY === videoKey && source() === captured && !request.signal.aborted;
  const assertCurrent = () => { lifetime.check(); if (!current()) fail("sponsor_authority_changed"); };
  const capturedAssertions = structuredClone(sponsorCurrentSourceAssertions(trusted));
  const native = { ...trusted, scope: structuredClone(trusted.scope), context: structuredClone(trusted.context),
    events: structuredClone(trusted.events), sourceAssertions: structuredClone(trusted.sourceAssertions),
    sourceProblems: [...trusted.sourceProblems], env: { ...env, MEDIA: boundedMedia(media, lifetime) } };
  assertCurrent();
  const principalRow = await lifetime.wait(database.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(trusted.scope.actorUserId).first<Record<string, unknown>>());
  assertCurrent();
  if (!principalRow) return fail("sponsor_principal_changed");
  const auth = await lifetime.wait(readExistingPrincipalRequest(request, env, "creator", { account: "principal" }));
  assertCurrent();
  if (!current() || "kind" in auth || auth.response || !auth.user || auth.user.userId !== trusted.scope.actorUserId
    || auth.user.consentVersion !== POLICY_VERSION || auth.user.fictional || auth.user.projectExecution
    || canonicalJson(auth.user.authorizationSnapshot) !== canonicalJson(trusted.principal.authorizationSnapshot)) return fail("sponsor_principal_changed");
  const principal = auth.user;
  const bindings = [trusted.scope.key, String(command.preflightId), principal.userId, principal.userId, trusted.scope.projectId,
    trusted.scope.documentId, trusted.sourceDigest, trusted.requirementsDigest];
  const row = await lifetime.wait(database.prepare(quoteSql).bind(...bindings).first<Quote>());
  assertCurrent();
  if (!row || row.terms_digest !== command.termsDigest || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) return fail("sponsor_native_terms_changed");
  const body: unknown = JSON.parse(row.private_json), planBody: unknown = JSON.parse(row.plan_json);
  const quote = record(body) && record(body.preflight) ? body.preflight : null;
  const plan = record(planBody) && record(planBody.confirmed_plan) ? planBody.confirmed_plan as unknown as OutputConfirmedPlan : null;
  if (!quote || !plan || !record(plan.plan) || !Array.isArray(plan.plan.targets) || plan.plan.targets.length !== 1
    || plan.id !== trusted.scope.documentId || plan.revisionId !== row.plan_revision_id || quote.planRevisionId !== plan.revisionId
    || quote.id !== command.preflightId || quote.termsDigest !== row.terms_digest || quote.expiresAt !== row.expires_at
    || [quote.sourceDigest, plan.sourceDigest].some(value => value !== trusted.sourceDigest)
    || [quote.requirementsDigest, plan.requirementsDigest].some(value => value !== trusted.requirementsDigest)
    || !Array.isArray(quote.targets) || quote.targets.length !== 1 || !record(quote.targets[0]) || !record(quote.operationAttempts)) return fail("sponsor_recipe_unsupported");
  const { termsDigest, ...quotedTerms } = quote;
  if (await outputDigest(quotedTerms) !== termsDigest) return fail("sponsor_native_terms_changed");
  assertCurrent();
  const offered = quote.targets[0], target = plan.plan.targets[0], attempt = quote.operationAttempts[target.id];
  if (!record(target) || ["narrative_contract", "scene_contract", "audio_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(target, key))) return fail("sponsor_recipe_unsupported");
  if (!record(attempt) || !exactKeys(attempt, ["ordinal", "previousSlotId"]) || attempt.ordinal !== 0 || attempt.previousSlotId !== null
    || Object.keys(quote.operationAttempts).length !== 1 || offered.targetId !== target.id || quote.maximumCalls !== 2
    || quote.maximumMicrousd !== command.maximumMicrousd || offered.maximumMicrousd !== command.maximumMicrousd) return fail("sponsor_recipe_unsupported");
  const input = { request, env: native.env, scope: native.scope, principal, confirmedPlan: plan, target,
    context: native.context, ownerHead: native.ownerHead, sourceEvents: native.events, sourceAssertions: native.sourceAssertions,
    sourceDigest: native.sourceDigest, requirementsDigest: native.requirementsDigest };
  const expected = await lifetime.wait(preflightOutputVideoTarget(input));
  assertCurrent();
  if (!expected.available || canonicalJson(expected) !== canonicalJson(offered)) return fail("sponsor_recipe_unsupported");
  const original = requireOutputVideoOriginal(input, expected, { attemptOrdinal: 0, previousSlotId: null });
  const proof = outputVideoPreflightProof(expected), video = readVideoExecutionOffer(offered);
  if (!video || !proof?.sourceAssertions.length || original.proof !== proof) return fail("sponsor_video_original_unavailable");
  const release = await lifetime.wait(registeredExperience("video"));
  assertCurrent();
  if (!release || release.output.output !== "video" || video.contract.source.releaseHash !== release.releaseHash)
    return fail("sponsor_recipe_unsupported");
  const recipe: SponsorRecipe = { appId: "video", recipeVersion: `video@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: "video", provider: "fal", model: String(offered.model), routeDigest: await digest(offered), settingsDigest: await digest(offered.settings),
    outputCount: 1, durationMs: 4000, width: 0, height: 0, calls: { parsing: 0, planning: 1, render: 1, repair: 0 }, maximumTokens: 152000, maximumMicrousd: Number(offered.maximumMicrousd) };
  const description = { actorKind: "canonical-principal" as const, actorUserId: principal.userId,
    sessionDigest: await digest({ version: "sponsor-canonical-principal@1", userId: principal.userId, consentVersion: principal.consentVersion, authorizationSnapshot: principal.authorizationSnapshot ?? null }),
    ownerUserId: principal.userId, projectId: native.scope.projectId, documentId: native.scope.documentId, sourceRevision: row.source_head,
    sourceDigest: `sha256:${native.sourceDigest}`, orderedAssetDigests: [`sha256:${video.contract.reference.sha256}`], rightsDigest: await digest(proof.sourceAssertions),
    compiledInputDigest: await digest({ snapshot: native.context.snapshot, settings: offered.settings }),
    transferEnvelopeDigest: await digest({ sourceDigest: native.sourceDigest, requirementsDigest: native.requirementsDigest, settings: offered.settings,
      maximumReferenceBytes: VIDEO_ADAPTER_CONTRACT.maxReferenceBytes, referenceMimeTypes: VIDEO_ADAPTER_CONTRACT.supportedReferenceMimeTypes,
      transport: OUTPUT_VIDEO_TRANSPORT, stagingLifetimeSeconds: 86400 }), recipe,
    preflightExpiresAtMs: Date.parse(row.expires_at) };
  const assertions: OutputSqlAssertion[] = [...capturedAssertions, ...structuredClone(proof.sourceAssertions),
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`, bindings: [principal.userId, JSON.stringify(principalColumns.map(column => principalRow[column] ?? null))] },
    { sql: `EXISTS(SELECT 1 FROM (${quoteSql}) captured WHERE terms_digest=? AND expires_at=? AND private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?)`,
      bindings: [...bindings, row.terms_digest, row.expires_at, row.private_json, row.source_head, row.plan_revision_id, row.plan_json] }];
  const deadline = Math.min(lifetime.deadlineMs, Date.parse(proof.expiresAt), description.preflightExpiresAtMs, ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
  if (!current() || !Number.isFinite(deadline) || deadline <= Date.now()) return fail("sponsor_authority_changed");
  assertCurrent();
  const checked = await lifetime.wait(database.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions)));
  assertCurrent();
  assertOutputProofRead(checked, assertions.length);
  if (!current() || deadline <= Date.now()) return fail("sponsor_authority_changed");
  return freeze({ description, offered: JSON.parse(canonicalJson(offered)) as Record<string, unknown> });
}

export async function describeSponsorVideoAdmission(trusted: OutputTrustedContext, command: Record<string, unknown>) {
  return (await readNative(trusted, command)).description;
}
export async function readSponsorVideoTemplateEvidence(trusted: OutputTrustedContext, command: Record<string, unknown>, recipe: SponsorRecipe) {
  if (jsonIssues(recipe).length) return fail("sponsor_native_envelope_mismatch");
  const capturedRecipe = JSON.parse(canonicalJson(recipe)) as SponsorRecipe;
  const native = await readNative(trusted, command);
  if (canonicalJson(native.description.recipe) !== canonicalJson(capturedRecipe)) return fail("sponsor_native_envelope_mismatch");
  return freeze({ recipe: native.description.recipe, offered: native.offered });
}
