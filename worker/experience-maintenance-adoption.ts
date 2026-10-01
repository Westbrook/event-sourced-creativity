import type { MaintenanceHead, MaintenanceHeadState } from "../src/experiences/maintenance-adoption-review-contract.ts";
import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { MAINTENANCE_ADOPTION_PROTOCOL, maintenanceAdoptionSnapshot, maintenanceBindingDigest, maintenanceSubjectDigest,
  maintenanceTransitionEventId, maintenanceHash, readMaintenanceAdoptionBinding, readMaintenanceAdoptionProposal,
  readMaintenanceAdoptionTransition, readMaintenanceAdoptionIntent, sameMaintenanceBinding, validMaintenanceDecisionId,
  type MaintenanceBinding, type MaintenanceProposalIntent, type MaintenanceTransitionIntent, type MaintenanceAdoptionIntent,
  type MaintenanceOperation } from "../src/experiences/maintenance-adoption-contract.ts";
import { EXPERIENCE_MAINTENANCE_MODEL_PROTOCOL, prepareExperienceMaintenanceModelRequest,
  acceptExperienceMaintenanceModelResponse } from "../src/experiences/maintenance-model-proposal.ts";
import { experienceRequestId, experienceTimestamp, readExperienceMaterialSelection,
  type ExperienceMaterialSelection } from "../src/experiences/release-contract.ts";
import { deliveryNeedsCompleteDependencies, deliveryNeedsEvidence, deliveryNeedsReleaseAuthority, deliveryTransitionAllowed } from "../src/platform/delivery-lifecycle.ts";
import { listExperienceMaintenanceAdoptionNominations, resolveExperienceMaintenanceAdoptionEligibility, resolveAdoptedExperienceMaintenanceContext,
  resolveRegisteredExperienceMaintenanceContext, projectExperienceMaintenancePreview, snapshotMaintenanceAdoptionRegistrations, type ExperienceMaintenanceAdoptionRegistration } from "./experience-maintenance-material.ts";
import { resolveExperienceReleaseMaterial, type ExperienceReleaseMaterialRegistration } from "./experience-release-material.ts";
import { productDeliveryAuthority, productDeliveryDependencies, productDeliveryReleaseAuthority, type ProductDeliveryAuthority } from "./product-delivery-authority.ts";
import { appendEvents, uuidV7, type WorkerEnv } from "./runtime.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { MaintenanceAdoptionPorts } from "./experience-release-api.ts";

type Ports = MaintenanceAdoptionPorts;
type Materials = readonly ExperienceReleaseMaterialRegistration[];
type Adoptions = readonly ExperienceMaintenanceAdoptionRegistration[];
type DecisionRow = Parameters<Ports["decisionProof"]>[0];
type BindingRow = { decision_id: string; proposal_event_id: string; binding_hash: string; subject_hash: string; experience_id: string;
  channel: string; release_hash: string; source_hash: string; build_hash: string; evaluation_hash: string; binding_json: string;
  expected_head_revision: number; expected_head_event_id: string | null; created_at: string };
type HeadRow = { subject_hash: string; experience_id: string; channel: string; material_selection_hash: string; revision: number;
  adoption_event_id: string; decision_id: string; binding_hash: string; baseline_observation_hash: string; profile_ref: string;
  profile_hash: string; inventory_hash: string; updated_at: string };
const flags = { version: 1, protocol: MAINTENANCE_ADOPTION_PROTOCOL, qualification: "fixture", generationAvailable: false, canPublish: false } as const;
const yes = { sql: "1", bindings: [] } satisfies ProductDeliveryAuthority;

/** Capture code-owned data before this command's first DB/crypto await.
 * The public endpoint has already authenticated the request before dispatch. No HTTP registration,
 * accessor execution, live caller aliases or mutable registry authority is retained. */
function commandRegistries(p: Ports, materials: Materials, adoptions: Adoptions) {
  if (!Array.isArray(materials) || materials.length > 64) p.fail("experience_maintenance_adoption_registry_unavailable", 503);
  const descriptors = Object.getOwnPropertyDescriptors(materials), copied: ExperienceReleaseMaterialRegistration[] = [];
  if (Reflect.ownKeys(descriptors).length !== materials.length + 1) p.fail("experience_maintenance_adoption_registry_unavailable", 503);
  let bytes = 0;
  for (let i = 0; i < materials.length; i++) {
    const descriptor = descriptors[String(i)];
    const value = descriptor && descriptor.enumerable && Object.hasOwn(descriptor, "value") ? maintenanceAdoptionSnapshot(descriptor.value, 262144) : null;
    if (!value) p.fail("experience_maintenance_adoption_registry_unavailable", 503);
    bytes += new TextEncoder().encode(canonicalJson(value)).length;
    if (bytes > 4194304) p.fail("experience_maintenance_adoption_registry_unavailable", 503);
    copied.push(value as ExperienceReleaseMaterialRegistration);
  }
  const captured = snapshotMaintenanceAdoptionRegistrations(adoptions);
  if (!captured) p.fail("experience_maintenance_adoption_registry_unavailable", 503);
  return { materials: freeze(copied), adoptions: captured };
}

function bindingProof(row: BindingRow): ProductDeliveryAuthority {
  return { sql: `EXISTS(SELECT 1 FROM delivery_experience_maintenance_bindings b WHERE b.decision_id=? AND b.proposal_event_id=? AND b.binding_hash=?
    AND b.subject_hash=? AND b.experience_id=? AND b.channel=? AND b.release_hash=? AND b.source_hash=? AND b.build_hash=? AND b.evaluation_hash=?
    AND b.binding_json=? AND b.expected_head_revision=? AND b.expected_head_event_id IS ? AND b.created_at=?)`,
    bindings: [row.decision_id, row.proposal_event_id, row.binding_hash, row.subject_hash, row.experience_id, row.channel,
      row.release_hash, row.source_hash, row.build_hash, row.evaluation_hash, row.binding_json, row.expected_head_revision, row.expected_head_event_id, row.created_at] };
}
async function boundDecision(p: Ports, env: WorkerEnv, decisionId: string) {
  if (!validMaintenanceDecisionId(decisionId)) p.fail("experience_maintenance_binding_unavailable");
  const row = await env.DB.prepare("SELECT * FROM delivery_decisions WHERE decision_id=?").bind(decisionId).first<DecisionRow>();
  const bindingRow = await env.DB.prepare("SELECT * FROM delivery_experience_maintenance_bindings WHERE decision_id=?").bind(decisionId).first<BindingRow>();
  if (!row || !bindingRow || row.audience !== "product" || typeof bindingRow.binding_json !== "string" || bindingRow.binding_json.length > 32768) p.fail("experience_maintenance_binding_unavailable");
  let raw: unknown; try { raw = JSON.parse(bindingRow.binding_json); } catch { p.fail("experience_maintenance_binding_unavailable"); }
  const binding = readMaintenanceAdoptionBinding(raw);
  if (!binding || canonicalJson(binding) !== bindingRow.binding_json || bindingRow.subject_hash !== await maintenanceSubjectDigest(binding)
    || bindingRow.binding_hash !== await maintenanceBindingDigest(binding) || bindingRow.experience_id !== binding.experienceId || bindingRow.channel !== binding.channel
    || bindingRow.release_hash !== binding.material.releaseHash || bindingRow.source_hash !== binding.material.sourceHash
    || bindingRow.build_hash !== binding.material.buildHash || bindingRow.evaluation_hash !== binding.material.evaluationHash
    || bindingRow.expected_head_revision !== binding.expectedAdoption.revision || bindingRow.expected_head_event_id !== binding.expectedAdoption.eventId) p.fail("experience_maintenance_binding_unavailable");
  const original = await p.originalEvent(env, bindingRow.proposal_event_id);
  if (original.operation !== "maintenance-proposal" || !sameMaintenanceBinding((original.intent as MaintenanceProposalIntent).binding, binding)
    || original.responseBody.result.bindingHash !== bindingRow.binding_hash || original.actorUserId !== row.created_by_user_id
    || bindingRow.created_at !== row.created_at) p.fail("experience_maintenance_binding_unavailable");
  const decision = p.decisionValue(row), originalDecision = original.responseBody.result.decision;
  if (!originalDecision || typeof originalDecision !== "object" || Array.isArray(originalDecision)
    || (originalDecision as Record<string, unknown>).decisionId !== decisionId || (originalDecision as Record<string, unknown>).createdAt !== row.created_at
    || !p.exactJson(decision.dependencyIds, (original.intent as MaintenanceProposalIntent).dependencyIds)) p.fail("experience_maintenance_binding_unavailable");
  return { row, bindingRow, binding, original, decision, proof: p.join(bindingProof(bindingRow), p.retained(original)) };
}
type Bound = Awaited<ReturnType<typeof boundDecision>>;
async function eligibility(p: Ports, materials: Materials, adoptions: Adoptions, binding: MaintenanceBinding) {
  const result = await resolveExperienceMaintenanceAdoptionEligibility(materials, adoptions, binding);
  if (!result.ok) p.fail(result.error, result.status);
  return result.value;
}
async function approvalProvenance(p: Ports, env: WorkerEnv, bound: Bound) {
  if (bound.row.status !== "approved") p.fail("experience_maintenance_approval_required");
  const approval = await p.originalEvent(env, maintenanceTransitionEventId(bound.row.decision_id, bound.row.updated_at));
  const intent = approval.intent as MaintenanceTransitionIntent;
  if (approval.operation !== "maintenance-transition" || !approval.approvalAuthority || intent.status !== "approved"
    || intent.decisionId !== bound.row.decision_id || !sameMaintenanceBinding(intent.maintenanceAdoption, bound.binding)
    || !p.exactJson(approval.responseBody.result.decision, bound.decision)
    || approval.responseBody.result.bindingHash !== bound.bindingRow.binding_hash
    || [bound.row.created_by_user_id, bound.row.owner_user_id].includes(approval.actorUserId)) p.fail("experience_maintenance_approval_unavailable");
  return { approval, proof: p.join(bound.proof, p.decisionProof(bound.row), p.retained(approval)) };
}
async function eligibleApproval(p: Ports, env: WorkerEnv, bound: Bound, materials: Materials, adoptions: Adoptions) {
  const resolved = await eligibility(p, materials, adoptions, bound.binding), provenance = await approvalProvenance(p, env, bound);
  return { ...provenance, resolved, proof: p.join(provenance.proof,
    p.approvalGuard(env, provenance.approval.approvalAuthority!), productDeliveryDependencies(bound.decision.dependencyIds, true)) };
}

function currentHeadProof(row: HeadRow): ProductDeliveryAuthority {
  return { sql: `EXISTS(SELECT 1 FROM experience_maintenance_heads WHERE (subject_hash,experience_id,channel,material_selection_hash,revision,adoption_event_id,
    decision_id,binding_hash,baseline_observation_hash,profile_ref,profile_hash,inventory_hash,updated_at)=(?,?,?,?,?,?,?,?,?,?,?,?,?))`,
    bindings: [row.subject_hash, row.experience_id, row.channel, row.material_selection_hash, row.revision, row.adoption_event_id,
      row.decision_id, row.binding_hash, row.baseline_observation_hash, row.profile_ref, row.profile_hash, row.inventory_hash, row.updated_at] };
}
function headValue(p: Ports, row: HeadRow): MaintenanceHead {
  if (![row.subject_hash, row.material_selection_hash, row.binding_hash, row.baseline_observation_hash, row.profile_hash, row.inventory_hash].every(maintenanceHash)
    || typeof row.experience_id !== "string" || !/^[a-z][a-z0-9-]{1,63}(?![\s\S])/u.test(row.experience_id) || row.channel !== "managed-fixture"
    || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.adoption_event_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}(?![\s\S])/u.test(row.adoption_event_id) || !validMaintenanceDecisionId(row.decision_id)
    || row.profile_ref !== "model3d.code-declarations@1" || !experienceTimestamp(row.updated_at)) p.fail("experience_maintenance_head_unavailable");
  return { subjectHash: row.subject_hash, experienceId: row.experience_id, channel: row.channel, revision: row.revision,
    adoptionEventId: row.adoption_event_id, decisionId: row.decision_id, bindingHash: row.binding_hash,
    baselineObservationHash: row.baseline_observation_hash, profileRef: row.profile_ref, profileHash: row.profile_hash, inventoryHash: row.inventory_hash } as MaintenanceHead;
}
async function eligibleHead(p: Ports, env: WorkerEnv, row: HeadRow, materials: Materials, adoptions: Adoptions) {
  const head = headValue(p, row), adoption = await p.originalEvent(env, row.adoption_event_id), bound = await boundDecision(p, env, row.decision_id);
  const approved = await eligibleApproval(p, env, bound, materials, adoptions), intent = adoption.intent as MaintenanceAdoptionIntent;
  if (adoption.operation !== "maintenance-adoption" || intent.decisionId !== row.decision_id || !sameMaintenanceBinding(intent.binding, bound.binding)
    || intent.expectedDecisionUpdatedAt !== bound.row.updated_at || intent.approvalEventId !== approved.approval.row.event_id
    || !p.exactJson(adoption.responseBody.result.head, head) || adoption.responseBody.result.bindingHash !== row.binding_hash
    || row.binding_hash !== bound.bindingRow.binding_hash || row.subject_hash !== bound.bindingRow.subject_hash
    || row.experience_id !== bound.binding.experienceId || row.channel !== bound.binding.channel || row.material_selection_hash !== await digest(bound.binding.material)
    || row.revision !== bound.binding.expectedAdoption.revision + 1 || row.baseline_observation_hash !== bound.binding.target.observationHash
    || row.profile_ref !== bound.binding.target.profileRef || row.profile_hash !== bound.binding.target.profileHash
    || row.inventory_hash !== bound.binding.target.inventoryHash) p.fail("experience_maintenance_head_unavailable");
  const custody = p.join(p.retained(adoption), approved.proof);
  return { head, bound, custody, proof: p.join(currentHeadProof(row), custody) };
}
const absentHead = (subject: string): ProductDeliveryAuthority => ({ sql: "NOT EXISTS(SELECT 1 FROM experience_maintenance_heads WHERE subject_hash=?)", bindings: [subject] });
async function expectedHead(p: Ports, env: WorkerEnv, binding: MaintenanceBinding, materials: Materials, adoptions: Adoptions) {
  const subject = await maintenanceSubjectDigest(binding), row = await env.DB.prepare("SELECT * FROM experience_maintenance_heads WHERE subject_hash=?").bind(subject).first<HeadRow>();
  if (binding.expectedAdoption.revision === 0) {
    // An ineligible or corrupt retained head never becomes an initial-adoption slot.
    if (row) p.fail("experience_maintenance_head_conflict");
    return { expected: absentHead(subject), priorEligibility: yes };
  }
  if (!row || row.revision !== binding.expectedAdoption.revision || row.adoption_event_id !== binding.expectedAdoption.eventId
    || row.baseline_observation_hash !== binding.expectedAdoption.baselineObservationHash || row.profile_ref !== binding.expectedAdoption.profileRef
    || row.profile_hash !== binding.expectedAdoption.profileHash || row.baseline_observation_hash !== binding.reviewed.baselineObservationHash
    || row.material_selection_hash !== await digest(binding.material)) p.fail("experience_maintenance_head_conflict");
  const prior = await eligibleHead(p, env, row, materials, adoptions);
  // The old head predicate disappears after CAS; its approval/original custody does not.
  return { expected: currentHeadProof(row), priorEligibility: prior.custody };
}

async function propose(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser, intent: MaintenanceProposalIntent, materials: Materials, adoptions: Adoptions) {
  const authority = productDeliveryAuthority(request, env, actor), old = await p.originalRequest(env, authority, "maintenance-proposal", actor.userId, intent.requestId, intent);
  if (old) return p.response(old.responseBody, 201);
  await eligibility(p, materials, adoptions, intent.binding);
  const owner = await p.eligibleOwner(env, intent.ownerUserId), prior = await expectedHead(p, env, intent.binding, materials, adoptions);
  const bindingHash = await maintenanceBindingDigest(intent.binding), subjectHash = await maintenanceSubjectDigest(intent.binding);
  const now = new Date().toISOString(), decisionId = `experience-maintenance:v1:${uuidV7()}`;
  const row: DecisionRow = { decision_id: decisionId, title: intent.title, audience: "product", status: "planned", owner_user_id: owner.owner.user_id,
    owner_display_name: owner.owner.display_name, evidence: intent.evidence, dependency_ids_json: JSON.stringify(intent.dependencyIds), created_by_user_id: actor.userId, created_at: now, updated_at: now };
  const result = { ...flags, decision: p.decisionValue(row), binding: intent.binding, bindingHash };
  const event = await p.operationEvent("maintenance-proposal", actor, intent, result), b = intent.binding;
  const bindRow: BindingRow = { decision_id: decisionId, proposal_event_id: event.eventId, binding_hash: bindingHash, subject_hash: subjectHash,
    experience_id: b.experienceId, channel: b.channel, release_hash: b.material.releaseHash, source_hash: b.material.sourceHash,
    build_hash: b.material.buildHash, evaluation_hash: b.material.evaluationHash, binding_json: canonicalJson(b),
    expected_head_revision: b.expectedAdoption.revision, expected_head_event_id: b.expectedAdoption.eventId, created_at: now };
  const proof = p.join(authority, owner.proof, productDeliveryDependencies(intent.dependencyIds, false), prior.expected, prior.priorEligibility);
  await p.prove(env, proof);
  try {
    await appendEvents(env, [event], { retries: 1, prepareSidecars: ([assigned]) => [
      env.DB.prepare(`INSERT INTO delivery_decisions(decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND sequence=?)`)
        .bind(...p.decisionProof(row).bindings, assigned.eventId, assigned.sequence),
      env.DB.prepare(`INSERT INTO delivery_experience_maintenance_bindings(decision_id,proposal_event_id,binding_hash,subject_hash,experience_id,channel,release_hash,source_hash,
        build_hash,evaluation_hash,binding_json,expected_head_revision,expected_head_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...bindingProof(bindRow).bindings),
      p.finalReceipt(env, assigned, p.join(proof, p.decisionProof(row), bindingProof(bindRow))),
    ] });
  } catch { /* Only the actor's exact retained receipt resolves an uncertain commit. */ }
  return p.settle(env, authority, actor, "maintenance-proposal", intent);
}

/** Only the reserved Maintenance namespace reaches this lifecycle; legacy/release
 * requests cannot borrow its independent approval or immutable binding. */
export async function transitionMaintenanceAdoption(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser, raw: unknown, rawMaterials: Materials, rawAdoptions: Adoptions) {
  const intent = readMaintenanceAdoptionTransition(raw); if (!intent) p.fail("invalid_experience_maintenance_transition", 400);
  const { materials, adoptions } = commandRegistries(p, rawMaterials, rawAdoptions);
  const authority = productDeliveryAuthority(request, env, actor), old = await p.originalRequest(env, authority, "maintenance-transition", actor.userId, intent.requestId, intent);
  if (old) return p.response(old.responseBody);
  const bound = await boundDecision(p, env, intent.decisionId);
  if (!sameMaintenanceBinding(bound.binding, intent.maintenanceAdoption)) p.fail("experience_maintenance_binding_conflict");
  if (bound.row.updated_at !== intent.expectedUpdatedAt) p.fail("delivery_decision_revision_conflict");
  if (!deliveryTransitionAllowed(bound.row.status, intent.status)) p.fail("invalid_delivery_status_transition");
  if (deliveryNeedsEvidence(intent.status) && !intent.evidence) p.fail("delivery_evidence_required");
  const release = deliveryNeedsReleaseAuthority(intent.status) || ["approved", "revoked"].includes(bound.row.status);
  const currentAuthority = release ? productDeliveryReleaseAuthority(request, env, actor) : authority;
  const owner = await p.eligibleOwner(env, intent.ownerUserId);
  if (intent.status === "approved" && [bound.row.created_by_user_id, bound.row.owner_user_id, intent.ownerUserId].includes(actor.userId)) p.fail("independent_release_approver_required", 403);
  if (["passed", "approval_required", "approved"].includes(intent.status)) await eligibility(p, materials, adoptions, bound.binding);
  const prior = intent.status === "approved" && bound.row.status !== "approved" ? await expectedHead(p, env, bound.binding, materials, adoptions) : { expected: yes, priorEligibility: yes };
  const now = new Date(Math.max(Date.now(), Date.parse(intent.expectedUpdatedAt) + 1)).toISOString();
  const row: DecisionRow = { ...bound.row, title: intent.title, status: intent.status, evidence: intent.evidence,
    owner_user_id: owner.owner.user_id, owner_display_name: owner.owner.display_name, updated_at: now };
  const result = { ...flags, decision: p.decisionValue(row), binding: bound.binding, bindingHash: bound.bindingRow.binding_hash };
  const event = await p.operationEvent("maintenance-transition", actor, intent, result, maintenanceTransitionEventId(intent.decisionId, now), intent.status === "approved" ? p.approvalSnapshot(request, actor) : null);
  const proof = p.join(currentAuthority, bound.proof, owner.proof, productDeliveryDependencies(bound.decision.dependencyIds, deliveryNeedsCompleteDependencies(intent.status)), prior.expected, prior.priorEligibility);
  await p.prove(env, p.join(proof, p.decisionProof(bound.row)));
  try {
    await appendEvents(env, [event], { retries: 1, prepareSidecars: ([assigned]) => [
      env.DB.prepare(`UPDATE delivery_decisions SET title=?,status=?,evidence=?,owner_user_id=?,owner_display_name=?,updated_at=?
        WHERE decision_id=? AND updated_at=? AND ${p.decisionProof(bound.row).sql} AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND sequence=?)`)
        .bind(row.title, row.status, row.evidence, row.owner_user_id, row.owner_display_name, row.updated_at, row.decision_id, intent.expectedUpdatedAt,
          ...p.decisionProof(bound.row).bindings, assigned.eventId, assigned.sequence),
      p.finalReceipt(env, assigned, p.join(proof, p.decisionProof(row))),
    ] });
  } catch { /* No latest-decision fallback replaces the original acknowledgment. */ }
  return p.settle(env, authority, actor, "maintenance-transition", intent);
}

async function adopt(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser, intent: MaintenanceAdoptionIntent, materials: Materials, adoptions: Adoptions) {
  const authority = productDeliveryAuthority(request, env, actor), old = await p.originalRequest(env, authority, "maintenance-adoption", actor.userId, intent.requestId, intent);
  if (old) return p.response(old.responseBody, 201);
  const bound = await boundDecision(p, env, intent.decisionId);
  if (!sameMaintenanceBinding(bound.binding, intent.binding)) p.fail("experience_maintenance_binding_conflict");
  if (bound.row.updated_at !== intent.expectedDecisionUpdatedAt) p.fail("delivery_decision_revision_conflict");
  const approved = await eligibleApproval(p, env, bound, materials, adoptions);
  if (approved.approval.row.event_id !== intent.approvalEventId) p.fail("experience_maintenance_approval_changed");
  const prior = await expectedHead(p, env, intent.binding, materials, adoptions);
  const authorityNow = productDeliveryReleaseAuthority(request, env, actor);
  await p.prove(env, p.join(authorityNow, approved.proof, prior.expected, prior.priorEligibility));
  const adoptionId = uuidV7(), now = new Date().toISOString(), b = intent.binding;
  const headRow: HeadRow = { subject_hash: bound.bindingRow.subject_hash, experience_id: b.experienceId, channel: b.channel,
    material_selection_hash: await digest(b.material), revision: b.expectedAdoption.revision + 1, adoption_event_id: adoptionId,
    decision_id: intent.decisionId, binding_hash: bound.bindingRow.binding_hash, baseline_observation_hash: b.target.observationHash,
    profile_ref: b.target.profileRef, profile_hash: b.target.profileHash, inventory_hash: b.target.inventoryHash, updated_at: now };
  const result = { ...flags, decisionId: intent.decisionId, binding: b, bindingHash: bound.bindingRow.binding_hash, head: headValue(p, headRow) };
  const event = await p.operationEvent("maintenance-adoption", actor, intent, result, adoptionId);
  try {
    await appendEvents(env, [event], { retries: 1, prepareSidecars: ([assigned]) => {
      const headWrite = b.expectedAdoption.revision === 0
        ? env.DB.prepare(`INSERT INTO experience_maintenance_heads(subject_hash,experience_id,channel,material_selection_hash,revision,adoption_event_id,decision_id,
            binding_hash,baseline_observation_hash,profile_ref,profile_hash,inventory_hash,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM experience_maintenance_heads WHERE subject_hash=?)
            AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND sequence=?)`).bind(...currentHeadProof(headRow).bindings, headRow.subject_hash, assigned.eventId, assigned.sequence)
        : env.DB.prepare(`UPDATE experience_maintenance_heads SET revision=?,adoption_event_id=?,decision_id=?,binding_hash=?,baseline_observation_hash=?,profile_ref=?,profile_hash=?,inventory_hash=?,updated_at=?
            WHERE subject_hash=? AND revision=? AND adoption_event_id=? AND baseline_observation_hash=? AND profile_ref=? AND profile_hash=?
              AND material_selection_hash=? AND ${prior.expected.sql} AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND sequence=?)`)
          .bind(headRow.revision, headRow.adoption_event_id, headRow.decision_id, headRow.binding_hash, headRow.baseline_observation_hash, headRow.profile_ref,
            headRow.profile_hash, headRow.inventory_hash, headRow.updated_at, headRow.subject_hash, b.expectedAdoption.revision, b.expectedAdoption.eventId,
            b.expectedAdoption.baselineObservationHash, b.expectedAdoption.profileRef, b.expectedAdoption.profileHash, headRow.material_selection_hash, ...prior.expected.bindings, assigned.eventId, assigned.sequence);
      // changes()=1 plus the exact new head and all live approval/evidence/dependency
      // proofs must insert the receipt; a false predicate aborts the entire batch.
      return [headWrite, p.finalReceipt(env, assigned, p.join(productDeliveryReleaseAuthority(request, env, actor), approved.proof, prior.priorEligibility, currentHeadProof(headRow)))];
    } });
  } catch { /* Lost responses recover the original event, never a newer head. */ }
  return p.settle(env, authority, actor, "maintenance-adoption", intent);
}

async function current(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser, base: ExperienceMaterialSelection, materials: Materials, adoptions: Adoptions) {
  const authority = productDeliveryAuthority(request, env, actor), material = await resolveExperienceReleaseMaterial(materials, base);
  if (!material) { await p.prove(env, authority); p.fail("experience_release_material_unavailable", 404); }
  const subjectHash = await maintenanceSubjectDigest({ channel: "managed-fixture", experienceId: material.release.definition.id, material: base });
  const row = await env.DB.prepare("SELECT * FROM experience_maintenance_heads WHERE subject_hash=?").bind(subjectHash).first<HeadRow>();
  if (!row) { await p.prove(env, p.join(authority, absentHead(subjectHash))); return p.response({ ...flags, subjectHash, base, head: null, eligible: false }); }
  const head = headValue(p, row);
  if (row.material_selection_hash !== await digest(base) || row.experience_id !== material.release.definition.id) p.fail("experience_maintenance_head_unavailable");
  let proof: ProductDeliveryAuthority = { sql: "0", bindings: [] };
  try { proof = (await eligibleHead(p, env, row, materials, adoptions)).proof; }
  catch (error) { if (!p.isFailure(error)) throw error; }
  const eligible = await p.readEligibility(env, p.join(authority, currentHeadProof(row)), proof);
  return p.response({ ...flags, subjectHash, base, head, eligible });
}

/** Internal deterministic maintenance consumer. Both the retained adoption and the
 * explicitly selected current capture remain code-owned; no raw capture reaches HTTP. */
export async function readAdoptedMaintenanceContext(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser,
  rawBase: unknown, currentObservationHash: string, rawMaterials: Materials, rawAdoptions: Adoptions) {
  const base = readExperienceMaterialSelection(maintenanceAdoptionSnapshot(rawBase));
  if (!base || !Object.values(base).every(maintenanceHash) || !maintenanceHash(currentObservationHash)) p.fail("invalid_experience_maintenance_request", 400);
  if (request.signal.aborted) p.fail("experience_maintenance_request_changed");
  const { materials, adoptions } = commandRegistries(p, rawMaterials, rawAdoptions), authority = productDeliveryAuthority(request, env, actor);
  const material = await resolveExperienceReleaseMaterial(materials, base);
  if (!material) { await p.prove(env, authority); p.fail("experience_release_material_unavailable", 404); }
  const subjectHash = await maintenanceSubjectDigest({ channel: "managed-fixture", experienceId: material.release.definition.id, material: base });
  const row = await env.DB.prepare("SELECT * FROM experience_maintenance_heads WHERE subject_hash=?").bind(subjectHash).first<HeadRow>();
  if (!row) { await p.prove(env, p.join(authority, absentHead(subjectHash))); p.fail("experience_maintenance_adoption_required"); }
  const retained = await eligibleHead(p, env, row, materials, adoptions);
  if (row.material_selection_hash !== await digest(base)) p.fail("experience_maintenance_head_unavailable");
  await p.prove(env, p.join(authority, retained.proof));
  const result = await resolveAdoptedExperienceMaintenanceContext(materials, adoptions, retained.bound.binding, currentObservationHash);
  await p.prove(env, p.join(authority, retained.proof));
  if (request.signal.aborted) p.fail("experience_maintenance_request_changed");
  if (!result.ok) p.fail(result.error, result.status);
  return freeze({ ...result.value, head: retained.head });
}

/** Read custody separately from current eligibility. Revocation/retired evidence
 * cannot erase a retained head or prevent its decision from being reviewed. */
async function readHeadWitness(p: Ports, env: WorkerEnv, subjectHash: string, base: ExperienceMaterialSelection, experienceId: string,
  captured: ReturnType<typeof commandRegistries> | null): Promise<{
    state: MaintenanceHeadState; admission: ProductDeliveryAuthority; eligibility: ProductDeliveryAuthority;
  }> {
  const row = await env.DB.prepare("SELECT * FROM experience_maintenance_heads WHERE subject_hash=?").bind(subjectHash).first<HeadRow>();
  const noEligibility = { sql: "0", bindings: [] } satisfies ProductDeliveryAuthority;
  if (!row) return { state: { status: "absent", head: null }, admission: absentHead(subjectHash), eligibility: noEligibility };
  const admission = currentHeadProof(row);
  try {
    const head = headValue(p, row), original = await p.originalEvent(env, row.adoption_event_id), bound = await boundDecision(p, env, row.decision_id);
    const intent = original.intent as MaintenanceAdoptionIntent;
    if (row.subject_hash !== subjectHash || row.material_selection_hash !== await digest(base) || row.experience_id !== experienceId
      || original.operation !== "maintenance-adoption" || intent.decisionId !== row.decision_id || !sameMaintenanceBinding(intent.binding, bound.binding)
      || !p.exactJson(original.responseBody.result.head, head) || original.responseBody.result.bindingHash !== row.binding_hash
      || row.binding_hash !== bound.bindingRow.binding_hash || row.subject_hash !== bound.bindingRow.subject_hash
      || !p.exactJson(bound.binding.material, base) || row.channel !== bound.binding.channel || row.experience_id !== bound.binding.experienceId
      || row.revision !== bound.binding.expectedAdoption.revision + 1 || row.baseline_observation_hash !== bound.binding.target.observationHash
      || row.profile_ref !== bound.binding.target.profileRef || row.profile_hash !== bound.binding.target.profileHash
      || row.inventory_hash !== bound.binding.target.inventoryHash) p.fail("experience_maintenance_head_unavailable");
    const custody = p.join(admission, p.retained(original), bound.proof, p.decisionProof(bound.row));
    let eligibilityProof: ProductDeliveryAuthority = noEligibility;
    if (captured && bound.row.status === "approved") {
      try {
        const approved = await eligibleApproval(p, env, bound, captured.materials, captured.adoptions);
        if (intent.expectedDecisionUpdatedAt === bound.row.updated_at && intent.approvalEventId === approved.approval.row.event_id)
          eligibilityProof = approved.proof;
      } catch (error) { if (!p.isFailure(error)) throw error; }
    }
    return { state: { status: "ineligible", head }, admission: custody, eligibility: eligibilityProof };
  } catch (error) {
    if (!p.isFailure(error)) throw error;
    // No unvalidated identifiers are projected, but the retained row remains a
    // witnessed obstruction rather than an invented absent/initial head.
    return { state: { status: "corrupt", head: null }, admission, eligibility: noEligibility };
  }
}
function headState(witness: Awaited<ReturnType<typeof readHeadWitness>>, eligible: boolean): MaintenanceHeadState {
  return witness.state.head ? { status: eligible ? "eligible" : "ineligible", head: witness.state.head } : witness.state;
}
const initialAdoption = { revision: 0, eventId: null, baselineObservationHash: null, profileRef: null, profileHash: null } as const;
function nominationExpectation(state: MaintenanceHeadState): MaintenanceBinding["expectedAdoption"] | null {
  if (state.status === "absent") return initialAdoption;
  if (state.status !== "eligible") return null;
  return { revision: state.head.revision, eventId: state.head.adoptionEventId, baselineObservationHash: state.head.baselineObservationHash,
    profileRef: state.head.profileRef, profileHash: state.head.profileHash };
}
async function readNominations(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser, base: ExperienceMaterialSelection,
  captured: ReturnType<typeof commandRegistries>) {
  const authority = productDeliveryAuthority(request, env, actor), material = await resolveExperienceReleaseMaterial(captured.materials, base);
  if (!material) { await p.prove(env, authority); p.fail("experience_release_material_unavailable", 404); }
  const experienceId = material.release.definition.id, subjectHash = await maintenanceSubjectDigest({ channel: "managed-fixture", experienceId, material: base });
  const witness = await readHeadWitness(p, env, subjectHash, base, experienceId, captured), admission = p.join(authority, witness.admission);
  const beforeEligible = await p.readEligibility(env, admission, witness.eligibility);
  const nominated = await listExperienceMaintenanceAdoptionNominations(captured.materials, captured.adoptions, base, experienceId,
    nominationExpectation(headState(witness, beforeEligible)));
  // Re-read eligibility after awaited producer resolution; a withdrawn grant
  // removes all replacement choices, never converts the head to initial absence.
  const afterEligible = await p.readEligibility(env, admission, witness.eligibility);
  if (!nominated.ok) p.fail(nominated.error, nominated.status);
  const state = headState(witness, afterEligible);
  return p.response({ ...flags, base, experienceId, subjectHash, headState: state,
    nominations: state.status === "absent" || state.status === "eligible" ? nominated.value.nominations : [] });
}
async function readDecision(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser, decisionId: string,
  rawMaterials: Materials, rawAdoptions: Adoptions) {
  if (!validMaintenanceDecisionId(decisionId)) p.fail("invalid_experience_maintenance_decision", 400);
  // Missing/retired code-owned evidence is not permission to hide an otherwise
  // retained decision or remove its explicit revocation controls.
  let captured: ReturnType<typeof commandRegistries> | null = null;
  try { captured = commandRegistries(p, rawMaterials, rawAdoptions); }
  catch (error) { if (!p.isFailure(error)) throw error; }
  const authority = productDeliveryAuthority(request, env, actor), bound = await boundDecision(p, env, decisionId);
  const base = bound.binding.material, experienceId = bound.binding.experienceId, subjectHash = bound.bindingRow.subject_hash;
  let approvalEventId: string | null = null, provenance: ProductDeliveryAuthority = yes, eligibilityProof: ProductDeliveryAuthority = { sql: "0", bindings: [] };
  if (bound.row.status === "approved") {
    try {
      const saved = await approvalProvenance(p, env, bound); approvalEventId = saved.approval.row.event_id; provenance = saved.proof;
      if (captured) {
        try { eligibilityProof = (await eligibleApproval(p, env, bound, captured.materials, captured.adoptions)).proof; }
        catch (error) { if (!p.isFailure(error)) throw error; }
      }
    } catch (error) { if (!p.isFailure(error)) throw error; }
  }
  const witness = await readHeadWitness(p, env, subjectHash, base, experienceId, captured);
  const admission = p.join(authority, bound.proof, p.decisionProof(bound.row), provenance, witness.admission);
  const eligible = await p.readEligibility(env, admission, eligibilityProof);
  const headEligible = await p.readEligibility(env, admission, witness.eligibility);
  // These reads are separate scalar projections. Re-prove every affirmative
  // claim together after both awaits, in addition to the exact retained rows.
  await p.prove(env, p.join(admission, eligible ? eligibilityProof : yes, headEligible ? witness.eligibility : yes));
  return p.response({ ...flags, base, experienceId, subjectHash, decision: bound.decision, binding: bound.binding,
    bindingHash: bound.bindingRow.binding_hash, approvalEventId, eligible, headState: headState(witness, headEligible) });
}

/** This scope is private and retained across all prepare/accept awaits. A later
 * read of a different valid head cannot replace the originally selected witness. */
async function modelContext(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser, base: ExperienceMaterialSelection,
  currentObservationHash: string, captured: ReturnType<typeof commandRegistries>) {
  const authority = productDeliveryAuthority(request, env, actor), material = await resolveExperienceReleaseMaterial(captured.materials, base);
  if (!material || material.release.output.output !== "model3d") {
    await p.prove(env, authority); p.fail("experience_release_material_unavailable", 404);
  }
  const experienceId = material.release.definition.id, subjectHash = await maintenanceSubjectDigest({ channel: "managed-fixture", experienceId, material: base });
  const row = await env.DB.prepare("SELECT * FROM experience_maintenance_heads WHERE subject_hash=?").bind(subjectHash).first<HeadRow>();
  let head: MaintenanceHead | null = null, proof = p.join(authority, absentHead(subjectHash));
  let result: Awaited<ReturnType<typeof resolveAdoptedExperienceMaintenanceContext>>;
  if (row) {
    // Presence is never an absent-baseline fallback, including corrupt custody,
    // revoked approval, withdrawn evidence or an unsupported retained profile.
    const retained = await eligibleHead(p, env, row, captured.materials, captured.adoptions);
    if (row.subject_hash !== subjectHash || row.experience_id !== experienceId || row.material_selection_hash !== await digest(base)
      || !p.exactJson(retained.bound.binding.material, base)) p.fail("experience_maintenance_head_unavailable");
    head = retained.head; proof = p.join(authority, retained.proof);
    await p.prove(env, proof);
    result = await resolveAdoptedExperienceMaintenanceContext(captured.materials, captured.adoptions, retained.bound.binding, currentObservationHash);
  } else {
    await p.prove(env, proof);
    result = await resolveRegisteredExperienceMaintenanceContext(captured.materials, captured.adoptions, base, experienceId, currentObservationHash);
  }
  await p.prove(env, proof);
  if (!result.ok) p.fail(result.error, result.status);
  if (request.signal.aborted) p.fail("experience_maintenance_request_changed");
  return { ...result.value, proof, base, experienceId, subjectHash, head,
    contextSource: head ? "adopted-baseline" as const : "registered-baseline" as const };
}

async function modelWorkflow(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser, raw: unknown,
  preview: boolean, captured: ReturnType<typeof commandRegistries>) {
  const input = maintenanceAdoptionSnapshot(raw, preview ? 65536 : 32768);
  const keys = ["version", "base", "currentObservationHash", "brief", ...(preview ? ["requestHash", "response"] : [])];
  if (!record(input) || !exactKeys(input, keys) || input.version !== 1 || !maintenanceHash(input.currentObservationHash)
    || typeof input.brief !== "string" || !input.brief.length || input.brief.length > 4096 || input.brief.trim() !== input.brief
    || preview && !maintenanceHash(input.requestHash)) p.fail("invalid_experience_maintenance_model_request", 400);
  const base = readExperienceMaterialSelection(input.base);
  if (!base || !Object.values(base).every(maintenanceHash)) p.fail("invalid_experience_maintenance_model_request", 400);
  const selected = await modelContext(p, request, env, actor, base, input.currentObservationHash, captured);
  // The opaque context reference binds exact adoption revision/event/identities
  // (or proved absence) into the model input hash, including A→B→A changes.
  // Neither that hash nor the references issue permission, checks or approval.
  const scopeHash = await digest({ version: 1, base, subjectHash: selected.subjectHash, head: selected.head });
  const prepared = await prepareExperienceMaintenanceModelRequest(selected.context, input.brief, {
    evidenceRefs: [...new Set([`context:${scopeHash}`, `evidence:${selected.baselineEligibilityHash}`, `evidence:${selected.currentEligibilityHash}`])],
    checkRefs: ["check:maintenance-binding", "check:maintenance-patch"],
  });
  const metadata = { version: 1, protocol: EXPERIENCE_MAINTENANCE_MODEL_PROTOCOL, qualification: "proposal-metadata-only",
    generationAvailable: false, canPublish: false, base, experienceId: selected.experienceId,
    contextSource: selected.contextSource, head: selected.head } as const;
  if (!prepared.ok) { await p.prove(env, selected.proof); p.fail(prepared.code, 409); }
  if (!preview) {
    await p.prove(env, selected.proof);
    if (request.signal.aborted) p.fail("experience_maintenance_request_changed");
    return p.response({ ...metadata, request: prepared.request });
  }
  if (input.requestHash !== prepared.request.requestHash) {
    await p.prove(env, selected.proof); p.fail("experience_maintenance_model_request_changed");
  }
  // Freshly prepare in THIS call: a browser packet/serialized object cannot
  // substitute for the exact pure-adapter issuance object. The input hash is
  // checked independently from final live actor/head/approval/dependency proof.
  const accepted = await acceptExperienceMaintenanceModelResponse(input.response, prepared.request, selected.context);
  await p.prove(env, selected.proof);
  if (request.signal.aborted) p.fail("experience_maintenance_request_changed");
  if (!accepted.ok) p.fail(accepted.code, 400);
  return p.response({ ...metadata, requestHash: accepted.requestHash, notesQualification: accepted.notesQualification,
    notes: accepted.notes, result: projectExperienceMaintenancePreview(accepted.result, selected.context) });
}

/** Recognize only named adoption routes. All pre-existing maintenance routes,
 * including the deliberately unsupported bare actions, retain their old dispatch. */
export async function handleMaintenanceAdoptionRoutes(p: Ports, request: Request, env: WorkerEnv, actor: PilotUser,
  parts: readonly string[], rawMaterials: Materials, rawAdoptions: Adoptions): Promise<Response | null> {
  if (parts[0] !== "maintenance" || !["adoption-proposals", "adoptions", "adoption-operations", "adoption-nominations", "adoption-decisions", "model-request", "model-preview"].includes(parts[1] ?? "")) return null;
  const url = new URL(request.url), authority = productDeliveryAuthority(request, env, actor);
  if (request.method === "GET" && parts.length === 4 && parts[1] === "adoption-operations") {
    if ([...url.searchParams].length) p.fail("invalid_experience_maintenance_request", 400);
    const operation = parts[2] as MaintenanceOperation;
    if (!["maintenance-proposal", "maintenance-transition", "maintenance-adoption"].includes(operation)
      || !experienceRequestId(parts[3]) || parts[3].trim() !== parts[3]) p.fail("invalid_experience_maintenance_request", 400);
    const original = await p.originalRequest(env, authority, operation, actor.userId, parts[3]);
    return original ? p.response(original.responseBody) : p.response({ error: "experience_maintenance_request_not_found", generationAvailable: false }, 404);
  }
  if (request.method === "GET" && parts.length === 3 && parts[1] === "adoption-decisions") {
    if ([...url.searchParams].length) p.fail("invalid_experience_maintenance_request", 400);
    return readDecision(p, request, env, actor, parts[2], rawMaterials, rawAdoptions);
  }
  if (request.method === "GET" && parts.length === 2 && parts[1] === "adoption-nominations") {
    const keys = ["releaseHash", "sourceHash", "buildHash", "evaluationHash"];
    if ([...url.searchParams].length !== keys.length || keys.some(key => url.searchParams.getAll(key).length !== 1)) p.fail("invalid_experience_maintenance_request", 400);
    const base = readExperienceMaterialSelection(maintenanceAdoptionSnapshot(Object.fromEntries(url.searchParams)));
    if (!base || !Object.values(base).every(maintenanceHash)) p.fail("invalid_experience_maintenance_request", 400);
    return readNominations(p, request, env, actor, base, commandRegistries(p, rawMaterials, rawAdoptions));
  }
  const { materials, adoptions } = commandRegistries(p, rawMaterials, rawAdoptions);
  if (request.method === "GET" && parts.length === 3 && parts[1] === "adoptions" && parts[2] === "current") {
    const keys = ["releaseHash", "sourceHash", "buildHash", "evaluationHash"];
    if ([...url.searchParams].length !== keys.length || keys.some(key => url.searchParams.getAll(key).length !== 1)) p.fail("invalid_experience_maintenance_request", 400);
    const base = readExperienceMaterialSelection(maintenanceAdoptionSnapshot(Object.fromEntries(url.searchParams)));
    if (!base || !Object.values(base).every(maintenanceHash)) p.fail("invalid_experience_maintenance_request", 400);
    return current(p, request, env, actor, base, materials, adoptions);
  }
  if ([...url.searchParams].length) p.fail("invalid_experience_maintenance_request", 400);
  if (request.method === "POST" && parts.length === 2) {
    let raw: unknown;
    try { raw = await (parts[1] === "model-preview" ? p.readModelPreviewJson(request) : p.readJson(request)); }
    catch (error) { await p.prove(env, authority); throw error; }
    if (parts[1] === "model-request" || parts[1] === "model-preview")
      return modelWorkflow(p, request, env, actor, raw, parts[1] === "model-preview", { materials, adoptions });
    if (parts[1] === "adoption-proposals") {
      const intent = readMaintenanceAdoptionProposal(raw); if (!intent) p.fail("invalid_experience_maintenance_proposal", 400);
      return propose(p, request, env, actor, intent, materials, adoptions);
    }
    if (parts[1] === "adoptions") {
      const intent = readMaintenanceAdoptionIntent(raw); if (!intent) p.fail("invalid_experience_maintenance_adoption", 400);
      return adopt(p, request, env, actor, intent, materials, adoptions);
    }
  }
  return p.response({ error: "not_found" }, 404);
}
