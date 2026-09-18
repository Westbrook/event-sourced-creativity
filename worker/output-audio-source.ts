import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceResourceId, receiptPrefix, validateIntakeRequest } from "../src/experiences/intake.ts";
import { experienceSourceMatches } from "../src/experiences/host-source.ts";
import type { ExperienceIntakeReceipt } from "../src/experiences/native-host.ts";
import { createAudioOutputContract, parseAudioOutputContract, type AudioOutputContract } from "../src/model/output-audio-contract.ts";
import type { OutputConfirmedPlan } from "../src/model/output-delivery-contract.ts";
import { readDraft as readExperienceDraft, retainedGuard as experienceDraftGuard, join } from "./experience-intake-read.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { commitAtomicIntake } from "./project-intake.ts";
import { requireConsent } from "./principal-request-core.ts";
import { experienceOutputBinding } from "./experience-output-binding.ts";
import { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget } from "./experience-output-recipe.ts";
import { OutputConflictError, type OutputSqlAssertion } from "./output-command-core.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import { findSponsorAudioOutputReads, requireSponsorAudioOutputReads, readSponsorAudioOutputResponse, retainSponsorAudioOutputProofs,
  isSponsorAudioOutputPreflightInput, isSponsorAudioOutputLaterSourceInput, type SponsorAudioOutputReadOwner } from "./experience-sponsor-audio-output-reads.ts";
import { readSponsorAudioOutputNativeDraft, sponsorAudioOutputNativeProofs, sealSponsorAudioOutputNativeReceiptCheck } from "./experience-sponsor-audio-output-native.ts";

function fail(code = "output_audio_original_unavailable"): never { throw new OutputConflictError(code, 409); }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const exactIso = (value: string) => Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;

const sponsorAudioSourceProofs = new WeakMap<OutputSqlAssertion, SponsorAudioOutputReadOwner>();
/** Exact objects produced after native source validation, never caller DTOs. */
export function isSponsorAudioOutputSourceProof(owner: SponsorAudioOutputReadOwner, proof: OutputSqlAssertion): boolean {
  return sponsorAudioSourceProofs.get(proof) === owner;
}

/** Pure original-operation identity, not a job allocation or approval. Rechecks
 * retain the confirmed plan's timestamp, never Date.now()+TTL or a new UUID.
 * The admission owner must assign requestId verbatim to the original slot.jobId. */
export async function outputAudioPreparationIdentity(contract: AudioOutputContract, plan: Pick<OutputConfirmedPlan, "revisionId" | "confirmedAt">, targetId: string) {
  if (!parseAudioOutputContract(contract) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(targetId)
    || typeof plan.revisionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(plan.revisionId)
    || typeof plan.confirmedAt !== "string" || !exactIso(plan.confirmedAt)) return null;
  const expiry = Date.parse(plan.confirmedAt) + 15 * 60_000;
  if (!Number.isSafeInteger(expiry) || !Number.isFinite(new Date(expiry).getTime())) return null;
  const requestId = "audio-" + (await digest(["experience-audio-initial-operation@1", contract.source.draftId, plan.revisionId, targetId])).slice(7);
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

/** Resolve the retained Audio intent against this real current native context.
 * This reuses the real personal principal; it does not synthesize an authenticated
 * Request or bypass the caller's full lifecycle/custody/source loader. */
export async function resolveOutputAudioSource(input: OutputBridgeTargetInput) {
  const { scope, principal, target, confirmedPlan, context } = input;
  const contract = parseAudioOutputContract(target.audio_contract);
  if (!contract || scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.actorUserId !== principal.userId
    || principal.streamId !== `creative:${principal.userId}` || principal.projectExecution || principal.fictional
    || scope.organizationId !== null || scope.projectAccessId !== null || scope.contextId !== null
    || requireConsent(principal) || !principal.access.capabilities.includes("project.author")
    || !input.sourceEvents || !input.sourceAssertions?.length) fail("output_audio_personal_source_required");
  const owner = findSponsorAudioOutputReads(input.request, input.env);
  const owned = owner ? requireSponsorAudioOutputReads(owner, input.request, input.env) : null;
  const later = owned?.operation === "audio-output-review" || owned?.operation === "audio-output-authorize";
  if (owner && (later ? !isSponsorAudioOutputLaterSourceInput(owner, input) : !isSponsorAudioOutputPreflightInput(owner, input))) fail();
  if (owned && (owned.draftId !== contract.source.draftId || !later && (owned.env !== input.env || owned.auth.user !== principal
    || owned.operation !== "audio-output-prepare"))) fail();
  // Ordinary reconstruction keeps its existing same-principal behavior. A
  // sponsored original uses only the owner's genuine native authorization.
  const auth: ProjectIntakeAuthorization = owned ? owned.auth : { user: principal, principal, impersonation: null };
  const nativeEnv = owned?.nativeEnv ?? input.env;
  const retained = owner ? await readSponsorAudioOutputNativeDraft(owner, input.request, nativeEnv)
    : await readExperienceDraft(input.env, auth, contract.source.draftId);
  if (!retained) fail();
  const { plan } = retained;
  const valid = await validateIntakeRequest(plan.request);
  if (!valid || valid.request.experienceId !== "audio" || valid.release.output.output !== "audio"
    || !same(valid.release, plan.release) || !owner && !same(await buildExperiencePlan(principal.userId, valid.request, valid.release), plan)) fail();
  const binding = await experienceOutputBinding(plan), expectedContract = createAudioOutputContract({
    draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
    requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash,
  });
  if (!expectedContract || !same(contract, expectedContract) || plan.projectId !== scope.projectId || plan.documentId !== scope.documentId
    || confirmedPlan.sourceDigest !== input.sourceDigest || confirmedPlan.requirementsDigest !== input.requirementsDigest) fail();
  const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement");
  const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable");
  const recipe = createExperienceOutputRecipe({ output: "audio", requirementId, deliverableId, contract });
  const originalTarget = matchExperienceOutputRecipeTarget(recipe, confirmedPlan.plan, {
    documentId: plan.documentId, sourceRevision: input.sourceDigest, requirementRevision: input.requirementsDigest,
  });
  if (!originalTarget || !same(originalTarget, target)) fail("output_audio_target_changed");
  const intake = { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone([...plan.events]) };
  const options = { receiptPrefix: receiptPrefix(plan.draftId), clientId: "web:experience-intake", correlationPrefix: "experience-intake:",
    guard: experienceDraftGuard(auth, plan, retained.content) };
  const response = await commitAtomicIntake(nativeEnv, auth, intake, "check", owner
    ? sealSponsorAudioOutputNativeReceiptCheck(owner, input.request, nativeEnv, auth, intake, options) : options);
  const value: unknown = owner ? await readSponsorAudioOutputResponse(owner, response) : response.ok ? await response.json() : null;
  if (!response.ok || !record(value)) fail();
  const receipt = { ...value, draftId: plan.draftId, draftHash: plan.draftHash } as ExperienceIntakeReceipt;
  if (receipt.status !== "complete") fail();
  const projection = context.projection;
  if (!experienceSourceMatches(plan, receipt, { documentId: projection.documentId, projectId: projection.projectId,
    documents: projection.documents, blocks: projection.libraryBlocks.filter(block => block.id !== requirementId),
    relations: projection.libraryBlockRelations, events: input.sourceEvents })) fail("output_audio_source_changed");
  // Exclude only the exact managed requirement, not any arbitrary Output block.
  // The caller's original command assertions additionally retain its save index.
  const blocks = projection.libraryBlocks.filter(block => block.id === requirementId), block = blocks[0];
  if (blocks.length !== 1 || !block || block.type !== "output" || block.scope !== "document" || block.removed || block.locked
    || block.canvasId !== "" || block.projectId !== plan.projectId || block.documentId !== plan.documentId
    || block.sourceEvents.length !== 1 || !record(block.properties) || !same(block.properties.output_spec, recipe.spec)) fail("output_audio_requirement_changed");
  const events = input.sourceEvents.filter(event => event.eventId === block.sourceEvents[0]), created = events[0];
  if (events.length !== 1 || !created || created.type !== "BlockCreated" || created.actor !== `user:${principal.userId}`
    || created.streamId !== principal.streamId || created.clientId !== "server:output-requirements"
    || created.payload.block_id !== requirementId || created.payload.type !== "output" || created.payload.scope !== "document"
    || created.payload.project_id !== plan.projectId || created.payload.document_id !== plan.documentId
    || created.payload.handle !== block.handle || created.payload.position !== block.position
    || !same(created.payload.properties, block.properties)) fail("output_audio_requirement_changed");
  const identity = await outputAudioPreparationIdentity(contract, confirmedPlan, target.id);
  if (!identity || !exactIso(retained.expiresAt) || Date.parse(identity.expiresAt) > Date.parse(retained.expiresAt)) fail("output_audio_original_expired");
  const draft = join(projectIntakeAuthority(nativeEnv, auth, plan), experienceDraftGuard(auth, plan, retained.content));
  const sourceAssertions = [...input.sourceAssertions, draft, receiptAssertion(input, receipt), ...(owner ? sponsorAudioOutputNativeProofs(owner) : [])].map(assertion => ({
    ...assertion, bindings: [...(assertion.bindings ?? [])],
  }));
  owned?.current();
  if (owner) {
    for (const proof of sourceAssertions) {
      Object.freeze(proof.bindings);
      Object.freeze(proof);
      sponsorAudioSourceProofs.set(proof, owner);
    }
    retainSponsorAudioOutputProofs(owner, sourceAssertions);
  }
  return { plan: freeze(plan), contract, receipt, ...identity, sourceAssertions };
}
