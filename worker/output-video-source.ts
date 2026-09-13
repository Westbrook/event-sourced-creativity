import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import { experienceResourceId, receiptPrefix } from "../src/experiences/intake.ts";
import { experienceSourceMatches } from "../src/experiences/host-source.ts";
import type { ExperienceIntakeReceipt } from "../src/experiences/native-host.ts";
import { parseVideoOutputContract, type VideoOutputContract } from "../src/model/output-video-contract.ts";
import type { OutputConfirmedPlan } from "../src/model/output-delivery-contract.ts";
import { readDraft as readExperienceDraft, retainedGuard as experienceDraftGuard, join } from "./experience-intake-read.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { commitAtomicIntake } from "./project-intake.ts";
import { requireConsent } from "./principal-request-core.ts";
import { prepareExperienceVideoOutputSource } from "./experience-video-output-source.ts";
import { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget } from "./experience-output-recipe.ts";
import { OutputConflictError, type OutputSqlAssertion } from "./output-command-core.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";

function fail(code = "output_video_original_unavailable"): never { throw new OutputConflictError(code, 409); }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const exactIso = (value: string) => Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;

/** Pure original-operation identity, not a job allocation or approval. Rechecks
 * retain the confirmed plan's timestamp, never Date.now()+TTL or a new UUID.
 * The admission owner must assign requestId verbatim to the original slot.jobId. */
export async function outputVideoPreparationIdentity(contract: VideoOutputContract, plan: Pick<OutputConfirmedPlan, "revisionId" | "confirmedAt">, targetId: string) {
  if (!parseVideoOutputContract(contract) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(targetId)
    || typeof plan.revisionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(plan.revisionId)
    || typeof plan.confirmedAt !== "string" || !exactIso(plan.confirmedAt)) return null;
  const expiry = Date.parse(plan.confirmedAt) + 15 * 60_000;
  if (!Number.isSafeInteger(expiry) || !Number.isFinite(new Date(expiry).getTime())) return null;
  const requestId = "video-" + (await digest(["experience-video-initial-operation@1", contract.source.draftId, plan.revisionId, targetId])).slice(7);
  return Object.freeze({ requestId, expiresAt: new Date(expiry).toISOString() });
}

/** Preserve each actual original receipt and private body at the final admission
 * boundary. No receipt is inserted here; the original intake reader owns its
 * complete/absent/unavailable interpretation. */
function receiptAssertion(input: OutputBridgeTargetInput, receipt: ExperienceIntakeReceipt): OutputSqlAssertion {
  const prefix = receiptPrefix(receipt.draftId), expected = JSON.stringify(receipt.appended.map(event => ({
    key: event.payload.client_event_id, id: event.eventId, sequence: event.sequence,
    type: event.type, payload: JSON.stringify(event.payload),
  })));
  return { sql: `(SELECT COUNT(*) FROM event_client_receipts counted WHERE counted.stream_id=? AND substr(counted.client_event_id,1,?)=?)=?
    AND (SELECT COUNT(*) FROM json_each(?) expected
      JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=json_extract(expected.value,'$.key')
        AND receipt.event_id=json_extract(expected.value,'$.id') AND receipt.sequence=json_extract(expected.value,'$.sequence')
      JOIN events event ON event.event_id=receipt.event_id AND event.stream_id=receipt.stream_id AND event.sequence=receipt.sequence
        AND event.actor='user' AND event.type=json_extract(expected.value,'$.type') AND event.compensates_event_id IS NULL
      JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.owner_id=? AND body.redacted_at IS NULL
        AND body.private_json=json_extract(expected.value,'$.payload'))=?`,
  bindings: [input.principal.streamId, prefix.length, prefix, receipt.appended.length, expected,
    input.principal.streamId, input.principal.userId, receipt.appended.length] };
}

/** Resolve the retained Video intent against this real current native context.
 * This reuses the real personal principal; it does not synthesize an authenticated
 * Request or bypass the caller's full lifecycle/custody/source loader. */
export async function resolveOutputVideoSource(input: OutputBridgeTargetInput) {
  const { scope, principal, target, confirmedPlan, context } = input;
  const contract = parseVideoOutputContract(target.video_contract);
  if (!contract || scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.actorUserId !== principal.userId
    || principal.streamId !== `creative:${principal.userId}` || principal.projectExecution || principal.fictional
    || scope.organizationId !== null || scope.projectAccessId !== null || scope.contextId !== null
    || requireConsent(principal) || !principal.access.capabilities.includes("project.author")
    || !input.sourceEvents || !input.sourceAssertions?.length) fail("output_video_personal_source_required");
  // The actual principal remains the same object, not a completed-auth DTO.
  const auth: ProjectIntakeAuthorization = { user: principal, principal, impersonation: null };
  const retained = await readExperienceDraft(input.env, auth, contract.source.draftId);
  if (!retained) fail();
  const { plan } = retained;
  const original = await prepareExperienceVideoOutputSource(input.request, input.env, auth, retained);
  if (!Number.isSafeInteger(input.ownerHead) || input.ownerHead !== original.head) fail("output_video_source_changed");
  const expectedContract = original.contract;
  if (!expectedContract || !same(contract, expectedContract) || plan.projectId !== scope.projectId || plan.documentId !== scope.documentId
    || confirmedPlan.sourceDigest !== input.sourceDigest || confirmedPlan.requirementsDigest !== input.requirementsDigest) fail();
  const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement");
  const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable");
  const recipe = createExperienceOutputRecipe({ output: "video", requirementId, deliverableId, contract });
  const originalTarget = matchExperienceOutputRecipeTarget(recipe, confirmedPlan.plan, {
    documentId: plan.documentId, sourceRevision: input.sourceDigest, requirementRevision: input.requirementsDigest,
  });
  if (!originalTarget || !same(originalTarget, target)) fail("output_video_target_changed");
  const response = await commitAtomicIntake(input.env, auth,
    { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone([...plan.events]) }, "check", {
      receiptPrefix: receiptPrefix(plan.draftId), clientId: "web:experience-intake", correlationPrefix: "experience-intake:",
      guard: experienceDraftGuard(auth, plan, retained.content),
    });
  if (!response.ok) fail();
  const receipt = { ...await response.json(), draftId: plan.draftId, draftHash: plan.draftHash } as ExperienceIntakeReceipt;
  if (receipt.status !== "complete") fail();
  const projection = context.projection;
  if (!experienceSourceMatches(plan, receipt, { documentId: projection.documentId, projectId: projection.projectId,
    documents: projection.documents, blocks: projection.libraryBlocks.filter(block => block.id !== requirementId),
    relations: projection.libraryBlockRelations, events: input.sourceEvents })) fail("output_video_source_changed");
  // Exclude only the exact managed requirement, not any arbitrary Output block.
  // The caller's original command assertions additionally retain its save index.
  const blocks = projection.libraryBlocks.filter(block => block.id === requirementId), block = blocks[0];
  if (blocks.length !== 1 || !block || block.type !== "output" || block.scope !== "document" || block.removed || block.locked
    || block.canvasId !== "" || block.projectId !== plan.projectId || block.documentId !== plan.documentId
    || block.sourceEvents.length !== 1 || !record(block.properties) || !same(block.properties.output_spec, recipe.spec)) fail("output_video_requirement_changed");
  const events = input.sourceEvents.filter(event => event.eventId === block.sourceEvents[0]), created = events[0];
  if (events.length !== 1 || !created || created.type !== "BlockCreated" || created.actor !== `user:${principal.userId}`
    || created.streamId !== principal.streamId || created.clientId !== "server:output-requirements"
    || created.payload.block_id !== requirementId || created.payload.type !== "output" || created.payload.scope !== "document"
    || created.payload.project_id !== plan.projectId || created.payload.document_id !== plan.documentId
    || created.payload.handle !== block.handle || created.payload.position !== block.position
    || !same(created.payload.properties, block.properties)) fail("output_video_requirement_changed");
  const identity = await outputVideoPreparationIdentity(contract, confirmedPlan, target.id);
  if (!identity || Date.parse(confirmedPlan.confirmedAt) > Date.now() || Date.parse(identity.expiresAt) <= Date.now() || !exactIso(retained.expiresAt) || Date.parse(identity.expiresAt) > Date.parse(retained.expiresAt)) fail("output_video_original_expired");
  const draft = join(projectIntakeAuthority(input.env, auth, plan), experienceDraftGuard(auth, plan, retained.content));
  const sourceAssertions = [...input.sourceAssertions, draft, original.guard, receiptAssertion(input, receipt), {
    sql: "COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?", bindings: [principal.streamId, original.head],
  }].map(assertion => ({
    ...assertion, bindings: [...(assertion.bindings ?? [])],
  }));
  return { plan: freeze(plan), contract, receipt, ...identity, sourceAssertions };
}
