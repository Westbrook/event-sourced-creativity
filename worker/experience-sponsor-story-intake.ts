import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, receiptPrefix, registeredExperience, validateIntakeRequest, type ExperiencePlan } from "../src/experiences/intake.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { identifySponsorStoryIntake, createSponsorStoryIntakeBudget, requireSponsorStoryIntakeBudget, finishSponsorStoryIntakeResponse, requireSponsorStoryIntakeFinishedResponse,
  readSponsorStoryIntakeWriteAuthority, type SponsorStoryIntakeBudget } from "./experience-sponsor-story-intake-reads.ts";
import { reserveSponsorStoryIntakeAttempt } from "./experience-sponsor-story-intake-attempts.ts";
import { prepareSponsorStoryIntakeStorage, readStoredSponsorStoryIntake, type SponsorStoryIntakeReceipt } from "./experience-sponsor-story-intake-resources.ts";
import { composeSponsorStoryIntakeGuards, composeSponsorStoryIntakeWriteGuard, createSponsorStoryIntakeCleanupRead,
  readSponsorStoryIntakeNativeDraft, sealSponsorStoryIntakeNativeReceipt, continueSponsorStoryIntakeNativeReceipt, sponsorStoryIntakeNativeReplayed } from "./experience-sponsor-story-intake-native.ts";
import { projectIntakeAuthority, commitAtomicIntake } from "./project-intake.ts";
import { retainedGuard } from "./experience-intake-read.ts";
import { experienceDraftStorageGuard } from "./experience-intake-api.ts";
import { preparePrivateContent } from "./private-content-storage.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { AtomicIntakeOptions } from "./intake-authority.ts";
import type { ProjectIntake } from "../src/model/project-intake.ts";

const family = "canonical-short-story-initial-intake@1" as const;
type StoryPlan = ExperiencePlan & { sponsor_intake: { version: 1; family: typeof family; receiptId: string } };
type Selector = { operation: "short-story-intake-prepare" | "short-story-intake-commit" }
  | ({ operation: "short-story-intake-draft" | "short-story-intake-receipt" } & ({ draftId: string } | { intentId: string }));
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const join = composeSponsorStoryIntakeGuards;
const proof = (value: { sql: string; bindings?: readonly (string | number | null)[] }): BudgetReservationGuard => ({ sql: value.sql, bindings: [...(value.bindings ?? [])] });

function marked(plan: ExperiencePlan): plan is StoryPlan {
  const marker = (plan as unknown as Record<string, unknown>).sponsor_intake;
  return record(marker) && exactKeys(marker, ["version", "family", "receiptId"])
    && marker.version === 1 && marker.family === family && typeof marker.receiptId === "string"
    && /^sponsor-story-intake-[a-f0-9]{64}$/u.test(marker.receiptId)
    && plan.request.experienceId === "short-story" && plan.release.output.output === "short_story"
    && !Object.hasOwn(plan.request, "reference") && !Object.hasOwn(plan, "reference");
}

/** The persisted canonical plan determines native payload key order. Counts are
 * logical private strings, not SQLite storage or provider invoice estimates. */
async function planFacts(budget: SponsorStoryIntakeBudget, plan: StoryPlan, content: string) {
  const state = requireSponsorStoryIntakeBudget(budget);
  const payloads = plan.events.map(event => JSON.stringify(event.payload));
  const facts = {
    contentDigest: await state.wait(() => digest(content)), sourceDigest: await state.wait(() => digest(plan.events)),
    eventPayloadDigest: await state.wait(() => digest(payloads)), eventCount: plan.events.length,
    draftBytes: bytes(content), eventBytes: payloads.reduce((total, payload) => total + bytes(payload), 0),
  };
  const totalBytes = facts.draftBytes + facts.eventBytes, limits = state.policyfacts.policy.storage;
  if (![9, 10].includes(facts.eventCount) || !Number.isSafeInteger(totalBytes)
    || facts.draftBytes > limits.maximumDraftBytes || facts.eventBytes > limits.maximumEventBytes
    || totalBytes > limits.maximumOriginalBytes) return fail("sponsor_story_intake_storage_limit");
  state.current(); return { ...facts, totalBytes };
}

async function original(budget: SponsorStoryIntakeBudget, request: Request, env: WorkerEnv) {
  const state = requireSponsorStoryIntakeBudget(budget, request, env);
  const metadata = await state.wait(() => readStoredSponsorStoryIntake(request, env,
    { draftId: state.draftId, actorUserId: state.auth.user.userId },
    { current: state.current, monotonicDeadline: state.monotonicDeadline, signal: request.signal }));
  state.accountBytes(metadata.controlBytes);
  if (!metadata.receipt) return null;
  const receipt = metadata.receipt;
  if (receipt.campaignId !== state.campaignId || receipt.sponsorPolicyDigest !== state.sponsorPolicyDigest
    || receipt.intakePolicyDigest !== state.policyfacts.intakePolicyDigest || receipt.intakeApprovalId !== state.policyfacts.approvalId)
    return fail("sponsor_story_intake_original_unavailable");
  const retained = await readSponsorStoryIntakeNativeDraft(budget, request, env, state.auth, state.draftId, join(...metadata.assertions.map(proof)));
  if (!retained || !marked(retained.plan)) return fail("sponsor_story_intake_original_unavailable");
  const plan = retained.plan, facts = await planFacts(budget, plan, retained.content);
  const originalBodyDigest = await state.wait(() => digest({ action: "prepare-sponsored-short-story-draft",
    campaignId: receipt.campaignId, request: plan.request }));
  if (plan.sponsor_intake.receiptId !== receipt.receiptId || plan.request.intentId !== receipt.nativeIntentId
    || plan.projectId !== receipt.projectId || plan.documentId !== receipt.documentId || plan.draftHash !== receipt.draftHash
    || originalBodyDigest !== receipt.bodyDigest || retained.expiresAt !== receipt.expiresAt
    || Object.entries(facts).some(([key, value]) => receipt[key as keyof SponsorStoryIntakeReceipt] !== value))
    return fail("sponsor_story_intake_original_unavailable");
  const originalProof = join(projectIntakeAuthority(env, state.auth, plan), retainedGuard(state.auth, plan, retained.content), ...metadata.assertions.map(proof));
  state.current(); return { ...retained, plan, receipt, proof: originalProof };
}

async function open(request: Request, env: WorkerEnv, selector: Selector) {
  const authority = await identifySponsorStoryIntake(request, env, selector);
  const attempt = await reserveSponsorStoryIntakeAttempt(authority, request, env, selector.operation);
  return createSponsorStoryIntakeBudget(authority, attempt, request, env);
}

async function prepared(budget: SponsorStoryIntakeBudget, request: Request, env: WorkerEnv,
  saved: NonNullable<Awaited<ReturnType<typeof original>>>, replayed: boolean) {
  return finishSponsorStoryIntakeResponse(budget, request, env,
    { status: "prepared", plan: saved.plan, expiresAt: saved.expiresAt, replayed }, [saved.proof]);
}

/** Dormant native composition. Every call owns a fresh finite IO reservation;
 * only the first exact native draft owns an initial-storage allocation. */
export async function prepareSponsorStoryDraft(request: Request, env: WorkerEnv): Promise<Response> {
  const budget = await open(request, env, { operation: "short-story-intake-prepare" });
  const state = requireSponsorStoryIntakeBudget(budget, request, env), command = state.command;
  if (!command || command.action !== "prepare-sponsored-short-story-draft" || !record(command.request)) return fail("sponsor_story_intake_request_invalid");
  const bodyDigest = await state.wait(() => digest(command)), saved = await original(budget, request, env);
  if (saved) {
    if (saved.receipt.bodyDigest !== bodyDigest) return fail("sponsor_story_intake_intent_conflict");
    return requireSponsorStoryIntakeFinishedResponse(budget, request, env, await prepared(budget, request, env, saved, true));
  }
  const approved = await readSponsorStoryIntakeWriteAuthority(budget, request, env);
  const validated = await state.wait(() => validateIntakeRequest(command.request));
  if (!validated || validated.request.experienceId !== "short-story" || validated.release.output.output !== "short_story"
    || validated.request.reference || !approved.policy.templates.some(template => template.appId === "short-story" && template.releaseDigest === validated.release.releaseHash))
    return fail("sponsor_story_intake_request_invalid");
  const native = await state.wait(() => buildExperiencePlan(state.auth.user.userId, validated.request, validated.release));
  const receiptId = `sponsor-story-intake-${(await state.wait(() => digest({ campaignId: state.campaignId,
    actor: state.auth.user.userId, intent: validated.request.intentId }))).slice(7)}`;
  const { draftHash: _hash, ...nativeBase } = native;
  const base = JSON.parse(canonicalJson({ ...nativeBase, sponsor_intake: { version: 1, family, receiptId } })) as Omit<StoryPlan, "draftHash">;
  const content = canonicalJson({ ...base, draftHash: await state.wait(() => digest(base)) });
  const plan = freeze(JSON.parse(content) as StoryPlan), facts = await planFacts(budget, plan, content);
  const live = composeSponsorStoryIntakeWriteGuard(budget, request, env,
    projectIntakeAuthority(env, state.auth, plan), ...approved.assertions.map(proof));
  // Absence and the ordinary daily ceiling govern the new insert. They cannot
  // remain in the post-insert proof after that same transaction creates it.
  const storageGuard = composeSponsorStoryIntakeWriteGuard(budget, request, env,
    live, experienceDraftStorageGuard(state.auth.user.userId), ...state.freshAbsenceAssertions.map(proof));
  const identity = { contentId: plan.draftId };
  const cleanup = createSponsorStoryIntakeCleanupRead(budget, request, env, state.auth, content, storageGuard, identity);
  const stored = await state.wait(() => preparePrivateContent(env, state.auth.user.userId, "experience-draft", content,
    undefined, undefined, storageGuard, identity, undefined, cleanup));
  const receipt: Omit<SponsorStoryIntakeReceipt, "recordedAtMs"> = {
    receiptId, allocationId: `${receiptId}:storage`, campaignId: state.campaignId, sponsorPolicyDigest: state.sponsorPolicyDigest,
    intakePolicyDigest: state.policyfacts.intakePolicyDigest, intakeApprovalId: state.policyfacts.approvalId,
    actorUserId: state.auth.user.userId, sessionDigest: approved.sessionDigest, nativeIntentId: validated.request.intentId,
    draftId: plan.draftId, projectId: plan.projectId, documentId: plan.documentId, draftHash: plan.draftHash,
    bodyDigest, ...facts, expiresAt: stored.expiresAt,
  };
  const allocation = await state.wait(() => prepareSponsorStoryIntakeStorage({ policy: state.policyfacts.policy, ...receipt }));
  const body: BudgetReservationGuard = { sql: `EXISTS(SELECT 1 FROM private_content
    WHERE content_id=? AND owner_id=? AND kind='experience-draft' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>${clock})`,
    bindings: [plan.draftId, state.auth.user.userId, content, stored.expiresAt] };
  const complete = composeSponsorStoryIntakeWriteGuard(budget, request, env, live, proof(allocation.receiptAssertion), proof(allocation.writeAssertion), body);
  const token = `${receiptId}:native-proof`;
  const assertion = packSponsorIntakeReadQuery(`INSERT INTO main.output_atomic_assertions(token,passed) VALUES(?,CASE WHEN ${complete.sql} THEN 1 ELSE 0 END)`, [token, ...complete.bindings]);
  const statements = [...stored.statements, ...allocation.statements.map(item => state.db.prepare(item.sql).bind(...item.bindings)),
    state.db.prepare(assertion.sql).bind(...assertion.bindings), state.db.prepare("DELETE FROM main.output_atomic_assertions WHERE token=?").bind(token)];
  let replayed = false;
  try {
    const acknowledgments = await state.wait(() => state.db.batch(statements));
    state.account(acknowledgments);
    if (!Array.isArray(acknowledgments) || acknowledgments.length !== statements.length) return fail("sponsor_story_intake_storage_acknowledgment_missing");
    for (let index = 0; index < statements.length; index++) {
      const row = Object.getOwnPropertyDescriptor(acknowledgments, String(index));
      if (!row || !Object.hasOwn(row, "value") || !record(row.value) || Object.getOwnPropertyDescriptor(row.value, "success")?.value !== true)
        return fail("sponsor_story_intake_storage_acknowledgment_missing");
      const meta = Object.getOwnPropertyDescriptor(row.value, "meta")?.value;
      if (index < stored.requiredInserts && (!record(meta) || Object.getOwnPropertyDescriptor(meta, "changes")?.value !== 1))
        return fail("sponsor_story_intake_storage_acknowledgment_missing");
    }
  } catch (cause) {
    state.current();
    const winner = await original(budget, request, env);
    if (!winner || winner.receipt.bodyDigest !== bodyDigest) throw cause;
    replayed = true;
    return requireSponsorStoryIntakeFinishedResponse(budget, request, env, await prepared(budget, request, env, winner, replayed));
  }
  const winner = await original(budget, request, env);
  if (!winner || winner.receipt.bodyDigest !== bodyDigest) return fail("sponsor_story_intake_save_unconfirmed");
  return requireSponsorStoryIntakeFinishedResponse(budget, request, env, await prepared(budget, request, env, winner, replayed));
}

async function receiptResult(budget: SponsorStoryIntakeBudget, response: Response) {
  const state = requireSponsorStoryIntakeBudget(budget);
  const text = await state.wait(() => response.text()); state.accountSerialized(text);
  let value: unknown; try { value = JSON.parse(text); } catch { return fail("sponsor_story_intake_native_receipt_invalid"); }
  if (!record(value)) return fail("sponsor_story_intake_native_receipt_invalid");
  state.current(); return { value, status: response.status };
}

async function nativeReceipt(budget: SponsorStoryIntakeBudget, request: Request, env: WorkerEnv,
  saved: NonNullable<Awaited<ReturnType<typeof original>>>, action: "commit" | "check", guard: BudgetReservationGuard,
  previous?: { intake: ProjectIntake; options: AtomicIntakeOptions }) {
  const state = requireSponsorStoryIntakeBudget(budget, request, env), plan = saved.plan;
  const intake = previous?.intake ?? { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) as ExperiencePlan["events"][number][] };
  if (previous && action !== "commit") return fail("sponsor_story_intake_native_continuation_invalid");
  const options = previous
    ? continueSponsorStoryIntakeNativeReceipt(budget, request, env, state.auth, intake, previous.options, guard)
    : sealSponsorStoryIntakeNativeReceipt(budget, request, env, state.auth, intake,
      { receiptPrefix: receiptPrefix(plan.draftId), clientId: "web:experience-intake", correlationPrefix: "experience-intake:", guard });
  const response = await state.wait(() => commitAtomicIntake(env, state.auth, intake, action, options));
  return { ...await receiptResult(budget, response), native: { intake, options } };
}

async function discloseReceipt(budget: SponsorStoryIntakeBudget, request: Request, env: WorkerEnv,
  saved: NonNullable<Awaited<ReturnType<typeof original>>>, result: Awaited<ReturnType<typeof receiptResult>>, replayed: boolean) {
  const plan = saved.plan;
  return finishSponsorStoryIntakeResponse(budget, request, env, { ...result.value, draftId: plan.draftId, draftHash: plan.draftHash,
    generation: "unavailable", ...(result.value.status === "complete" ? { documentRoute: experienceDocumentRoute(plan) } : {}), replayed }, [saved.proof], result.status);
}

/** Actual native check precedes new-write eligibility. Recovery never issues a
 * new storage allocation, extends the original draft, or starts generation. */
export async function commitSponsorStoryDraft(request: Request, env: WorkerEnv): Promise<Response> {
  const budget = await open(request, env, { operation: "short-story-intake-commit" });
  const state = requireSponsorStoryIntakeBudget(budget, request, env), saved = await original(budget, request, env);
  if (!saved || state.command?.action !== "commit-sponsored-short-story-draft" || state.command.draftHash !== saved.plan.draftHash) return fail("sponsor_story_intake_review_stale");
  const before = await nativeReceipt(budget, request, env, saved, "check", saved.proof);
  if (before.value.status === "complete") return requireSponsorStoryIntakeFinishedResponse(budget, request, env, await discloseReceipt(budget, request, env, saved, before, true));
  const approved = await readSponsorStoryIntakeWriteAuthority(budget, request, env);
  if (approved.policyDigest !== saved.receipt.sponsorPolicyDigest || approved.sessionDigest !== saved.receipt.sessionDigest
    || (await state.wait(() => registeredExperience("short-story")))?.releaseHash !== saved.plan.release.releaseHash)
    return fail("sponsor_story_intake_authority_changed");
  // Recompile the original's live-write predicate only. Its recording clock is
  // retained evidence, not new input; no returned allocation statement runs.
  const { recordedAtMs: _recordedAtMs, ...originalAllocation } = saved.receipt;
  const allocation = await state.wait(() => prepareSponsorStoryIntakeStorage({ policy: state.policyfacts.policy, ...originalAllocation }));
  const result = await nativeReceipt(budget, request, env, saved, "commit",
    join(saved.proof, proof(allocation.writeAssertion), ...approved.assertions.map(proof)), before.native);
  if (result.value.status !== "complete") return fail("sponsor_story_intake_commit_unconfirmed");
  const replayed = sponsorStoryIntakeNativeReplayed(budget);
  return requireSponsorStoryIntakeFinishedResponse(budget, request, env, await discloseReceipt(budget, request, env, saved, result, replayed));
}

/** Selected original intake reads only. There is no route registration here. */
export async function readSponsorStoryIntake(request: Request, env: WorkerEnv,
  selector: { operation: "short-story-intake-draft" | "short-story-intake-receipt" } & ({ draftId: string } | { intentId: string })): Promise<Response> {
  const budget = await open(request, env, selector), saved = await original(budget, request, env);
  if (!saved) return fail("sponsor_story_intake_original_unavailable");
  if (selector.operation === "short-story-intake-draft") return requireSponsorStoryIntakeFinishedResponse(budget, request, env, await prepared(budget, request, env, saved, true));
  return requireSponsorStoryIntakeFinishedResponse(budget, request, env, await discloseReceipt(budget, request, env, saved, await nativeReceipt(budget, request, env, saved, "check", saved.proof), true));
}
