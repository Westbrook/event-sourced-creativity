import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { registeredExperience, experienceResourceId } from "../src/experiences/intake.ts";
import { readStoryboardExecutionOffer } from "../src/model/output-storyboard-offer.ts";
import type { OutputConfirmedPlan, OutputPreflight } from "../src/model/output-delivery-contract.ts";
import { readExistingPrincipalRequest, decodedCookieValue } from "./principal-request-core.ts";
import { continueExperienceAuthorization, readDraft, retainedGuard } from "./experience-intake-read.ts";
import { readExperienceBody } from "./experience-intake-body.ts";
import { classifySponsorIntakeDraft } from "./experience-sponsor-intake-classification.ts";
import { OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY, outputRequirements, outputSourceDigests } from "./output-trusted-context.ts";
import { foldEvents } from "../src/model/events.ts";
import { readEvents, streamHead } from "./event-stream-read.ts";
import { authoritativeCreativeContext } from "./context-authority.ts";
import { outputExtractedSourceReferences, verifyOutputSourceEvidence } from "./output-source-evidence-capacity.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { ProjectIntakeAuthorization } from "./intake-authority.ts";
import { experienceOutputAuthorization, experienceOutputBinding, experienceOutputCommandKey, experienceOutputEnvelope } from "./experience-output-binding.ts";
import { readExperienceOutputLineage } from "./experience-output-originals.ts";
import { sceneRenewalIndexAssertion, sceneRenewalNoExecutionAssertion } from "./experience-scene-renewal-proof.ts";
import { outputCommandReceiptAssertion, outputScopeAuthority, type OutputScope, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputProofReadStatements, assertOutputProofRead, captureOutputPrivateSources, verifyOutputSourceRead } from "./output-disclosure-proof.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { describeSponsorStoryboardAdmission } from "./experience-sponsor-storyboard-evidence.ts";
import { STORYBOARD_SPONSOR_TRANSFER } from "./experience-sponsor-storyboard-contract.ts";
import { outputStoryboardPreparationIdentity } from "./output-storyboard-source.ts";
import { preflightOutputStoryboardTarget, outputStoryboardPreflightProof } from "./output-storyboard-preflight.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

declare const storyboardIntent: unique symbol;
/** Dormant actor intent only. This seal is neither payer nor admission authority. */
export type SponsorStoryboardIntentProof = Readonly<{ [storyboardIntent]: true }>;
type Description = Awaited<ReturnType<typeof describeSponsorStoryboardAdmission>>;
export type SponsorStoryboardIntentReview = Readonly<{
  version: 1; kind: "storyboard-actor-intent"; actorUserId: string; sessionDigest: string;
  documentId: string; projectId: string; originalRequestId: string; deadlineMs: number;
  command: Awaited<ReturnType<typeof experienceOutputEnvelope>>; commandDigest: string;
  description: Description; transfer: typeof STORYBOARD_SPONSOR_TRANSFER;
}>;
type State = { request: Request; env: WorkerEnv; database: WorkerEnv["DB"]; assertions: OutputSqlAssertion[];
  assertCurrent: () => void; review: SponsorStoryboardIntentReview };
const proofs = new WeakMap<SponsorStoryboardIntentProof, State>();
function fail(code = "sponsor_storyboard_intent_unavailable"): never { throw new SponsorEntitlementError(code); }
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const principalColumns = ["user_id", "email", "display_name", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
async function check(state: State) {
  state.assertCurrent();
  const results = await state.database.batch<Record<string, unknown>>(outputProofReadStatements(state.env, state.assertions));
  state.assertCurrent();
  assertOutputProofRead(results, state.assertions.length);
}

/** Personal-only composition of the native context continuation. It retains the
 * same source snapshot/private WeakMap and request authority. Unsupported
 * extracted references refuse before the native verifier can touch MEDIA. */
async function personalContext(request: Request, env: WorkerEnv, documentId: string,
  auth: ProjectIntakeAuthorization, assertCurrent: () => void): Promise<OutputTrustedContext> {
  assertCurrent();
  const principal = auth.user, owner = principal.userId;
  if (auth.impersonation || auth.principal !== principal || principal.consentVersion !== POLICY_VERSION
    || principal.fictional || principal.projectExecution || principal.streamId !== `creative:${owner}`
    || !["creator", "admin"].includes(principal.role)) fail("sponsor_principal_changed");
  const head = await streamHead(env, `creative:${owner}`); assertCurrent();
  const events = await readEvents(env, principal.streamId); assertCurrent();
  const initial = foldEvents(events, Number.POSITIVE_INFINITY, documentId, "");
  const document = initial.documents.find(value => value.id === documentId && !value.removed);
  if (!document) fail();
  const governed = await env.DB.prepare("SELECT 1 AS present FROM organization_projects WHERE owner_user_id=? AND project_id=? LIMIT 1")
    .bind(owner, document.projectId).first(); assertCurrent();
  if (governed) fail("sponsor_principal_changed");
  const scope: OutputScope = { kind: "personal", key: `personal:${owner}:${document.projectId}`,
    actorUserId: owner, ownerUserId: owner, documentId, projectId: document.projectId,
    organizationId: null, projectAccessId: null, contextId: null };
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, documentId, document.projectId);
  const requirements = outputRequirements(projection);
  const context = authoritativeCreativeContext(events, { documentId, projectId: document.projectId });
  const { sourceDigest, requirementsDigest } = await outputSourceDigests(projection, requirements, documentId, document.projectId, context); assertCurrent();
  const sourceAssertions = await captureOutputPrivateSources(env, scope, events, projection); assertCurrent();
  if (outputExtractedSourceReferences(projection.blocks).length) fail("sponsor_storyboard_source_unsupported");
  const sourceEvidence = await verifyOutputSourceEvidence(env, owner, projection.blocks,
    { maximumDistinctObjects: OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY }); assertCurrent();
  if (sourceEvidence.status !== "verified" || sourceEvidence.reasonCode || !sourceEvidence.countsComplete
    || sourceEvidence.referenceCount || sourceEvidence.distinctObjectCount || sourceEvidence.objectReads) fail();
  await verifyOutputSourceRead(env, scope, head, [outputScopeAuthority(scope, "request"), ...sourceAssertions]); assertCurrent();
  return { request, env, scope, principal, projectContext: null, events, projection, ownerHead: head, projectHead: 0,
    requirements, requirementsDigest, sourceDigest, context, sourceProblems: [], sourceAssertions, sourcePrivateCaptured: true, sourceEvidence };
}

/** Genuine closed native POST, never a caller-supplied confirmation DTO. No
 * route calls this function. Only existing-account SELECT paths are used. */
export async function createSponsorStoryboardIntentProof(request: Request, env: WorkerEnv): Promise<SponsorStoryboardIntentProof> {
  const database = env.DB;
  const inputState = () => canonicalJson({ url: request.url, method: request.method, headers: [...request.headers],
    configuration: { model: env.OPENAI_MODEL ?? null, imageProvider: env.FORMA_IMAGE_PROVIDER ?? null, imageModel: env.FAL_IMAGE_MODEL ?? null,
      plannerConfigured: Boolean(env.OPENAI_API_KEY), imageConfigured: Boolean(env.FAL_KEY), cohort: env.FORMA_PILOT_COHORT_ID ?? null } });
  const capturedInput = inputState();
  const currentInput = () => { if (request.signal.aborted || env.DB !== database || inputState() !== capturedInput) fail("sponsor_authority_changed"); };
  currentInput();
  const url = new URL(request.url), match = /^\/api\/experiences\/drafts\/(experience-draft-[a-f0-9]{64})\/output\/authorize$/u.exec(url.pathname);
  if (!match || url.searchParams.size || request.method !== "POST" || url.username || url.password
    || request.headers.get("origin") && request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site"
    || decodedCookieValue(request, "forma_impersonation") || decodedCookieValue(request, "forma_project_context")) fail("sponsor_command_invalid");
  const raw = await readExperienceBody(request.clone(), request.signal); currentInput();
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["draftHash", "termsDigest", "maximumMicrousd", "explicitAuthorization"])
    || raw.explicitAuthorization !== true || typeof raw.draftHash !== "string" || typeof raw.termsDigest !== "string"
    || !Number.isSafeInteger(raw.maximumMicrousd) || Number(raw.maximumMicrousd) < 1) fail("sponsor_command_invalid");
  const body = JSON.parse(canonicalJson(raw)) as Record<string, unknown>;
  const existing = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" }); currentInput();
  if ("kind" in existing || existing.response || !existing.user || existing.user.consentVersion !== POLICY_VERSION
    || existing.user.fictional || existing.user.projectExecution || existing.user.billingUserId && existing.user.billingUserId !== existing.user.userId
    || env.FORMA_PILOT_COHORT_ID?.trim()) fail("sponsor_principal_changed");
  const auth = await continueExperienceAuthorization(request, env, existing); currentInput();
  if (auth instanceof Response) fail("sponsor_principal_changed");
  const principalRow = await database.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(auth.user.userId).first<Record<string, unknown>>(); currentInput();
  if (!principalRow) fail("sponsor_principal_changed");
  const draftId = match[1]!;
  const classification = await classifySponsorIntakeDraft(env, draftId); currentInput();
  if (classification.kind !== "ordinary") fail("sponsor_intake_internal_only");
  const retained = await readDraft(env, auth, draftId, classification.guard); currentInput();
  if (!retained || retained.plan.request.experienceId !== "storyboard" || retained.plan.release.output.output !== "storyboard"
    || retained.plan.draftHash !== body.draftHash) fail();
  const root = await experienceOutputBinding(retained.plan); currentInput();
  const release = await registeredExperience("storyboard"); currentInput();
  if (!release || release.releaseHash !== root.releaseHash || root.output !== "storyboard") fail();
  const trusted = await personalContext(request, env, root.documentId, auth, currentInput); currentInput();
  if (trusted.scope.kind !== "personal" || trusted.scope.actorUserId !== auth.user.userId
    || trusted.scope.ownerUserId !== auth.user.userId || trusted.scope.documentId !== root.documentId || trusted.scope.projectId !== root.projectId
    || trusted.scope.contextId || trusted.projectContext || !trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured) fail();
  const draftGuard = retainedGuard(auth, retained.plan, retained.content);
  trusted.sourceAssertions.push(draftGuard, classification.guard);
  const lineage = await readExperienceOutputLineage(trusted, root); currentInput();
  const { save, confirm, preflight, authorize, run } = lineage.originals;
  // A recorded operation is not fresh consent, even after failure or a lost ACK.
  if (!save || !confirm || !preflight || authorize || run) fail("sponsor_storyboard_intent_recorded");
  trusted.sourceAssertions.push(...lineage.witnesses.map(value => outputCommandReceiptAssertion(trusted.scope, value.receipt)),
    sceneRenewalIndexAssertion(trusted.scope, draftId, lineage.cycleCommandKeys, "storyboard"));
  const requirementId = await experienceResourceId(draftId, "native-output-requirement"); currentInput();
  const matches = trusted.projection.libraryBlocks.filter(value => value.id === requirementId), block = matches[0], saved = save.receipt.payload;
  const savedEvents = trusted.events.filter(value => value.eventId === save.receipt.eventId);
  if (matches.length !== 1 || !block || saved.block_id !== requirementId || saved.type !== "output" || saved.scope !== "document"
    || saved.project_id !== root.projectId || saved.document_id !== root.documentId || !record(saved.properties)
    || block.type !== "output" || block.scope !== "document" || block.removed || block.locked || block.canvasId !== ""
    || block.projectId !== root.projectId || block.documentId !== root.documentId || block.handle !== saved.handle || block.position !== saved.position
    || !same(block.properties, saved.properties) || !same(block.sourceEvents, [save.receipt.eventId]) || savedEvents.length !== 1
    || savedEvents[0]!.type !== "BlockCreated" || savedEvents[0]!.actor !== `user:${auth.user.userId}` || savedEvents[0]!.streamId !== root.streamId
    || savedEvents[0]!.sequence !== save.sequence || !same(savedEvents[0]!.payload, saved)) fail();
  const confirmed = confirm.receipt.payload.confirmed_plan as OutputConfirmedPlan;
  const quote = preflight.receipt.payload.preflight as OutputPreflight;
  if (!record(confirmed) || !record(confirmed.plan) || !Array.isArray(confirmed.plan.targets) || confirmed.plan.targets.length !== 1
    || confirmed.revisionId !== confirm.receipt.payload.plan_revision_id || !record(quote) || !Array.isArray(quote.targets) || quote.targets.length !== 1
    || quote.id !== preflight.receipt.payload.preflight_id || quote.planRevisionId !== confirmed.revisionId
    || preflight.envelope.planRevisionId !== confirmed.revisionId
    || preflight.receipt.payload.plan_revision_id !== confirmed.revisionId || quote.sourceDigest !== trusted.sourceDigest
    || confirmed.sourceDigest !== trusted.sourceDigest || quote.requirementsDigest !== trusted.requirementsDigest
    || confirmed.requirementsDigest !== trusted.requirementsDigest) fail();
  const deliberate = experienceOutputAuthorization(body, quote);
  const command = await experienceOutputEnvelope(lineage.binding, "authorize", trusted.ownerHead, { ...deliberate, preflightId: quote.id }); currentInput();
  // Preserve the entire native envelope; only this closed selection enters the
  // accepted evidence leaf, whose intentionally narrower parser stays unchanged.
  const projection = { documentId: command.documentId, action: command.action, expectedRevision: command.expectedRevision,
    clientMutationId: command.clientMutationId, preflightId: quote.id, ...deliberate };
  const native = await preflightOutputStoryboardTarget({ request, env, scope: trusted.scope, principal: trusted.principal,
    confirmedPlan: confirmed, target: confirmed.plan.targets[0]!, context: trusted.context, ownerHead: trusted.ownerHead,
    sourceEvents: trusted.events, sourceAssertions: trusted.sourceAssertions, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest }); currentInput();
  const proof = outputStoryboardPreflightProof(native), offered = readStoryboardExecutionOffer(native);
  if (!proof?.sourceAssertions.length || !offered || !same(native, quote.targets[0]) || offered.original.draftId !== draftId
    || proof.requestId !== offered.original.requestId || proof.expiresAt !== offered.original.expiresAt) fail();
  const description = await describeSponsorStoryboardAdmission(trusted, projection); currentInput();
  if (description.originalRequestId !== proof.requestId || description.originalExpiresAtMs !== Date.parse(proof.expiresAt)
    || description.recipe.maximumTokens !== 224000 || description.actorUserId !== auth.user.userId) fail();
  // Include every ancestor, not only the selected successor, in the final
  // no-execution fence. New orphan/changed-cycle rows are separately fenced.
  const keys = new Set<string>();
  for (const binding of [root, lineage.binding, ...lineage.witnesses.map(value => value.envelope.experienceBinding as typeof root)]) {
    keys.add(await experienceOutputCommandKey(binding, "authorize")); currentInput();
    keys.add(await experienceOutputCommandKey(binding, "run")); currentInput();
  }
  const originalRequestIds: string[] = [];
  for (const witness of lineage.witnesses) {
    if (witness.receipt.action !== "confirm") continue;
    const predecessor = witness.receipt.payload.confirmed_plan;
    if (!record(predecessor) || typeof predecessor.revisionId !== "string" || typeof predecessor.confirmedAt !== "string") fail();
    const identity = await outputStoryboardPreparationIdentity(offered.contract,
      { revisionId: predecessor.revisionId, confirmedAt: predecessor.confirmedAt }, native.targetId); currentInput();
    if (!identity) fail();
    originalRequestIds.push(identity.requestId);
  }
  const assertions: OutputSqlAssertion[] = [...sponsorCurrentSourceAssertions(trusted), ...structuredClone(proof.sourceAssertions),
    sceneRenewalNoExecutionAssertion(trusted.scope, originalRequestIds, "storyboard"),
    // The indexed quote/plan association is distinct from its retained command
    // and private body. Repeat both, including latest-plan selection, on reuse.
    { sql: `EXISTS(SELECT 1 FROM output_preflights quote JOIN output_plan_revisions plan
        ON plan.scope_key=quote.scope_key AND plan.plan_revision_id=quote.plan_revision_id
      WHERE quote.scope_key=? AND quote.preflight_id=? AND quote.actor_user_id=? AND quote.event_id=?
        AND quote.terms_digest=? AND quote.expires_at=? AND quote.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND plan.scope_kind='personal' AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=?
        AND plan.organization_id IS NULL AND plan.project_access_id IS NULL AND plan.plan_id=?
        AND plan.plan_revision_id=? AND plan.revision=? AND plan.confirmed_event_id=?
        AND plan.source_digest=? AND plan.requirements_digest=? AND plan.source_head=? AND plan.target_count=1
        AND NOT EXISTS(SELECT 1 FROM output_plan_revisions newer WHERE newer.scope_key=plan.scope_key AND newer.revision>plan.revision))`,
      bindings: [trusted.scope.key, quote.id, auth.user.userId, preflight.receipt.eventId, quote.termsDigest, quote.expiresAt,
        auth.user.userId, root.projectId, root.documentId, confirmed.id, confirmed.revisionId, confirmed.revision,
        confirm.receipt.eventId, trusted.sourceDigest, trusted.requirementsDigest, description.sourceRevision] },
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [auth.user.userId, JSON.stringify(principalColumns.map(column => principalRow[column] ?? null))] },
    { sql: `NOT EXISTS(SELECT 1 FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key IN(${[...keys].map(() => "?").join(",")}))`,
      bindings: [trusted.scope.key, trusted.scope.actorUserId, ...keys] },
    { sql: "NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=?) AND NOT EXISTS(SELECT 1 FROM document_jobs WHERE job_id=?)", bindings: [proof.requestId, proof.requestId] },
    { sql: "EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND expires_at=?)", bindings: [draftId, auth.user.userId, retained.expiresAt] }];
  const deadlineMs = Math.min(Date.parse(retained.expiresAt), description.preflightExpiresAtMs, description.originalExpiresAtMs,
    ...assertions.flatMap(value => value.deadlineMs === undefined ? [] : [value.deadlineMs]));
  const commandDigest = await digest(command); currentInput();
  const sourceState = () => canonicalJson({ scope: trusted.scope, principal: trusted.principal, ownerHead: trusted.ownerHead,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, context: trusted.context,
    events: trusted.events, sourceAssertions: trusted.sourceAssertions, sourceProblems: trusted.sourceProblems, sourcePrivateCaptured: trusted.sourcePrivateCaptured });
  const capturedSource = sourceState();
  const assertCurrent = () => { currentInput(); if (trusted.request !== request || trusted.env !== env || sourceState() !== capturedSource
    || !Number.isFinite(deadlineMs) || Date.now() >= deadlineMs) fail("sponsor_authority_changed"); };
  const review = freeze({ version: 1 as const, kind: "storyboard-actor-intent" as const, actorUserId: auth.user.userId,
    sessionDigest: description.sessionDigest, documentId: root.documentId, projectId: root.projectId,
    originalRequestId: proof.requestId, deadlineMs, command, commandDigest, description, transfer: STORYBOARD_SPONSOR_TRANSFER });
  const state: State = { request, env, database, assertions: structuredClone(assertions), assertCurrent, review };
  await check(state); assertCurrent();
  const sealed = Object.freeze({}) as SponsorStoryboardIntentProof;
  proofs.set(sealed, state);
  return sealed;
}

/** Re-read captured proofs before returning finite actor intent metadata. A
 * cloned seal, changed Request/Env/DB, stale source or recorded job is refused.
 * No payer, provider, performed-moderation, reservation or creative-read power. */
export async function readSponsorStoryboardIntentProof(proof: SponsorStoryboardIntentProof, request: Request, env: WorkerEnv): Promise<SponsorStoryboardIntentReview> {
  const state = proofs.get(proof);
  if (!state || state.request !== request || state.env !== env || state.database !== env.DB) fail("sponsor_authority_unavailable");
  await check(state); state.assertCurrent();
  return state.review;
}
