import { canonicalJson, exactKeys, freeze, record } from "./compiler.ts";
import { canonicalDeliveryStatus, deliveryNeedsEvidence, deliveryTransitionAllowed, type DeliveryDecisionStatus } from "../platform/delivery-lifecycle.ts";
import type { ExperienceMaterialSelection } from "./release-contract.ts";
import { MAINTENANCE_ADOPTION_PROTOCOL, maintenanceAdoptionSnapshot, maintenanceBindingDigest, maintenanceHash,
  maintenanceSubjectDigest, maintenanceTransitionEventId, readMaintenanceAdoptionBinding, readMaintenanceIntent,
  readMaintenanceOperationReceipt, validMaintenanceDecisionId, type MaintenanceBinding, type MaintenanceIntent,
  type MaintenanceOperation, type MaintenanceOperationReceipt, type MaintenanceProposalIntent,
  type MaintenanceTransitionIntent, type MaintenanceAdoptionIntent } from "./maintenance-adoption-contract.ts";

type Flags = Readonly<{ version: 1; protocol: typeof MAINTENANCE_ADOPTION_PROTOCOL; qualification: "fixture";
  generationAvailable: false; canPublish: false }>;
export type MaintenanceHead = Readonly<{
  subjectHash: string; experienceId: string; channel: "managed-fixture"; revision: number; adoptionEventId: string;
  decisionId: string; bindingHash: string; baselineObservationHash: string; profileRef: "model3d.code-declarations@1";
  profileHash: string; inventoryHash: string;
}>;
export type MaintenanceHeadState = Readonly<{ status: "absent" | "corrupt"; head: null }>
  | Readonly<{ status: "eligible" | "ineligible"; head: MaintenanceHead }>;
export type MaintenanceAdoptionHead = MaintenanceHead;
export type MaintenanceAdoptionHeadState = MaintenanceHeadState;
export type MaintenanceAdoptionSubject = Readonly<{ base: ExperienceMaterialSelection; experienceId: string; subjectHash: string }>;
export type MaintenanceReviewDecision = Readonly<{
  decisionId: string; title: string; audience: "product"; status: DeliveryDecisionStatus; ownerUserId: string; owner: string;
  evidence: string; dependencyIds: readonly string[]; createdAt: string; updatedAt: string;
}>;
export type MaintenanceAdoptionNominations = Flags & Readonly<{
  base: ExperienceMaterialSelection; experienceId: string; subjectHash: string; headState: MaintenanceHeadState;
  nominations: readonly Readonly<{ binding: MaintenanceBinding; bindingHash: string }>[];
}>;
export type MaintenanceAdoptionDecision = Flags & Readonly<{
  base: ExperienceMaterialSelection; experienceId: string; subjectHash: string; decision: MaintenanceReviewDecision;
  binding: MaintenanceBinding; bindingHash: string; approvalEventId: string | null; eligible: boolean; headState: MaintenanceHeadState;
}>;
export type MaintenanceDecisionMutationResult = Flags & Readonly<{
  decision: MaintenanceReviewDecision; binding: MaintenanceBinding; bindingHash: string;
}>;
export type MaintenanceAdoptionMutationResult = Flags & Readonly<{
  decisionId: string; binding: MaintenanceBinding; bindingHash: string; head: MaintenanceHead;
}>;
export type MaintenanceAdoptionAcknowledgment = Readonly<{
  receipt: MaintenanceOperationReceipt; result: MaintenanceDecisionMutationResult | MaintenanceAdoptionMutationResult;
}>;

const flagKeys = ["version", "protocol", "qualification", "generationAvailable", "canPublish"];
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const experienceId = (raw: unknown): raw is string => typeof raw === "string" && /^[a-z][a-z0-9-]{1,63}(?![\s\S])/u.test(raw);
const eventId = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}(?![\s\S])/u.test(raw);
const identity = (raw: unknown): raw is string => typeof raw === "string" && raw.length > 0 && raw.length <= 240
  // eslint-disable-next-line no-control-regex -- Identity values must exclude control characters.
  && raw === raw.trim() && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(raw);
const text = (raw: unknown, maximum: number, required = false): raw is string => typeof raw === "string"
  && raw.length <= maximum && raw === raw.trim() && (!required || raw.length > 0);
const timestamp = (raw: unknown): raw is string => typeof raw === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z(?![\s\S])/u.test(raw)
  && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString() === raw;
function selection(raw: unknown): raw is ExperienceMaterialSelection {
  return record(raw) && exactKeys(raw, ["releaseHash", "sourceHash", "buildHash", "evaluationHash"]) && Object.values(raw).every(maintenanceHash);
}
function envelope(raw: unknown, fields: readonly string[]): raw is Record<string, unknown> & Flags {
  return record(raw) && exactKeys(raw, [...flagKeys, ...fields]) && raw.version === 1 && raw.protocol === MAINTENANCE_ADOPTION_PROTOCOL
    && raw.qualification === "fixture" && raw.generationAvailable === false && raw.canPublish === false;
}
function decision(raw: unknown): raw is MaintenanceReviewDecision {
  return record(raw) && exactKeys(raw, ["decisionId", "title", "audience", "status", "ownerUserId", "owner", "evidence", "dependencyIds", "createdAt", "updatedAt"])
    && validMaintenanceDecisionId(raw.decisionId) && text(raw.title, 160, true) && raw.audience === "product"
    && typeof raw.status === "string" && canonicalDeliveryStatus(raw.status) === raw.status && identity(raw.ownerUserId)
    && typeof raw.owner === "string" && raw.owner.length <= 8192
    && text(raw.evidence, 800) && Array.isArray(raw.dependencyIds) && raw.dependencyIds.length <= 10
    && raw.dependencyIds.every(identity) && new Set(raw.dependencyIds).size === raw.dependencyIds.length
    && timestamp(raw.createdAt) && timestamp(raw.updatedAt) && raw.createdAt <= raw.updatedAt;
}
function head(raw: unknown, subjectHash: string, selectedExperienceId: string): raw is MaintenanceHead {
  return record(raw) && exactKeys(raw, ["subjectHash", "experienceId", "channel", "revision", "adoptionEventId", "decisionId", "bindingHash", "baselineObservationHash", "profileRef", "profileHash", "inventoryHash"])
    && maintenanceHash(raw.subjectHash) && raw.subjectHash === subjectHash && raw.experienceId === selectedExperienceId && experienceId(raw.experienceId)
    && raw.channel === "managed-fixture" && typeof raw.revision === "number" && Number.isSafeInteger(raw.revision) && raw.revision > 0
    && eventId(raw.adoptionEventId) && validMaintenanceDecisionId(raw.decisionId)
    && [raw.bindingHash, raw.baselineObservationHash, raw.profileHash, raw.inventoryHash].every(maintenanceHash)
    && raw.profileRef === "model3d.code-declarations@1";
}
function headState(raw: unknown, subjectHash: string, selectedExperienceId: string): raw is MaintenanceHeadState {
  if (!record(raw) || !exactKeys(raw, ["status", "head"])) return false;
  return raw.status === "absent" || raw.status === "corrupt" ? raw.head === null
    : (raw.status === "eligible" || raw.status === "ineligible") && head(raw.head, subjectHash, selectedExperienceId);
}

/** Full expected-head agreement, not actor/approval authority. The supplied
 * subject is the digest-checked material/experience identity from a decoded DTO. */
export function maintenanceBindingMatchesHead(rawBinding: MaintenanceBinding, rawState: MaintenanceHeadState, rawSubject: MaintenanceAdoptionSubject): boolean {
  const binding = readMaintenanceAdoptionBinding(rawBinding), state = maintenanceAdoptionSnapshot(rawState);
  const subject = maintenanceAdoptionSnapshot(rawSubject, 262144);
  if (!binding || !record(subject) || !selection(subject.base) || !experienceId(subject.experienceId) || !maintenanceHash(subject.subjectHash)
    || !same(binding.material, subject.base) || binding.experienceId !== subject.experienceId
    || !headState(state, subject.subjectHash, subject.experienceId)) return false;
  if (state.status === "absent") return binding.expectedAdoption.revision === 0;
  if (state.status !== "eligible") return false;
  const expected = binding.expectedAdoption, current = state.head;
  return expected.revision === current.revision && expected.eventId === current.adoptionEventId
    && expected.baselineObservationHash === current.baselineObservationHash && expected.profileRef === current.profileRef
    && expected.profileHash === current.profileHash && binding.reviewed.baselineObservationHash === current.baselineObservationHash;
}

/** Reads a non-null head against the caller's captured exact material subject. */
export async function readMaintenanceAdoptionHead(raw: unknown, expected: Readonly<{
  base: ExperienceMaterialSelection; experienceId: string;
}>): Promise<MaintenanceHead | null> {
  try {
    const value = maintenanceAdoptionSnapshot(raw), saved = maintenanceAdoptionSnapshot(expected);
    if (!record(saved) || !exactKeys(saved, ["base", "experienceId"]) || !selection(saved.base) || !experienceId(saved.experienceId)) return null;
    const subjectHash = await maintenanceSubjectDigest({ channel: "managed-fixture", experienceId: saved.experienceId, material: saved.base });
    return head(value, subjectHash, saved.experienceId) ? value : null;
  } catch { return null; }
}

/** Sanitized server nominations only. Neither preview hashes nor capture/profile
 * text can become an editable binding or an initial slot for a corrupt head. */
export async function readMaintenanceAdoptionNominations(raw: unknown, expected: Readonly<{
  base: ExperienceMaterialSelection; experienceId: string;
}>): Promise<MaintenanceAdoptionNominations | null> {
  try {
    const value = maintenanceAdoptionSnapshot(raw, 262144), saved = maintenanceAdoptionSnapshot(expected);
    if (!record(saved) || !exactKeys(saved, ["base", "experienceId"]) || !selection(saved.base) || !experienceId(saved.experienceId)
      || !envelope(value, ["base", "experienceId", "subjectHash", "headState", "nominations"])
      || !selection(value.base) || !same(value.base, saved.base) || value.experienceId !== saved.experienceId
      || !maintenanceHash(value.subjectHash) || !Array.isArray(value.nominations) || value.nominations.length > 64) return null;
    const subjectHash = await maintenanceSubjectDigest({ channel: "managed-fixture", experienceId: saved.experienceId, material: saved.base });
    if (value.subjectHash !== subjectHash || !headState(value.headState, subjectHash, saved.experienceId)
      || (value.headState.status === "corrupt" || value.headState.status === "ineligible") && value.nominations.length > 0) return null;
    let previous = "";
    for (const choice of value.nominations) {
      if (!record(choice) || !exactKeys(choice, ["binding", "bindingHash"]) || !maintenanceHash(choice.bindingHash) || choice.bindingHash <= previous) return null;
      const binding = readMaintenanceAdoptionBinding(choice.binding);
      if (!binding || !same(binding.material, saved.base) || binding.experienceId !== saved.experienceId
        || !maintenanceBindingMatchesHead(binding, value.headState, { base: saved.base, experienceId: saved.experienceId, subjectHash })
        || await maintenanceBindingDigest(binding) !== choice.bindingHash) return null;
      previous = choice.bindingHash;
    }
    return value as MaintenanceAdoptionNominations;
  } catch { return null; }
}

/** A stale decision remains readable for revocation. `eligible` is current
 * approval eligibility, not actor authority or agreement with the current head. */
export async function readMaintenanceAdoptionDecision(raw: unknown, expectedDecisionId: string): Promise<MaintenanceAdoptionDecision | null> {
  try {
    const value = maintenanceAdoptionSnapshot(raw, 65536), selectedId = expectedDecisionId;
    if (!validMaintenanceDecisionId(selectedId)
      || !envelope(value, ["base", "experienceId", "subjectHash", "decision", "binding", "bindingHash", "approvalEventId", "eligible", "headState"])
      || !selection(value.base) || !experienceId(value.experienceId) || !maintenanceHash(value.subjectHash)
      || !decision(value.decision) || value.decision.decisionId !== selectedId || !maintenanceHash(value.bindingHash) || typeof value.eligible !== "boolean") return null;
    const binding = readMaintenanceAdoptionBinding(value.binding);
    if (!binding || !same(binding.material, value.base) || binding.experienceId !== value.experienceId
      || await maintenanceBindingDigest(binding) !== value.bindingHash || await maintenanceSubjectDigest(binding) !== value.subjectHash
      || !headState(value.headState, value.subjectHash, value.experienceId)) return null;
    if (value.decision.status !== "approved") {
      if (value.approvalEventId !== null || value.eligible) return null;
    } else if (value.approvalEventId !== null && value.approvalEventId !== maintenanceTransitionEventId(selectedId, value.decision.updatedAt)
      || value.eligible && value.approvalEventId === null) return null;
    return value as MaintenanceAdoptionDecision;
  } catch { return null; }
}

/** Decode the exact retained receipt, then verify what its result means for this
 * captured intent. No latest decision/head can stand in for that original ACK. */
export async function readMaintenanceAdoptionAcknowledgment(raw: unknown, expected: Readonly<{
  operation: MaintenanceOperation; actorUserId: string; intent: MaintenanceIntent; priorDecision?: MaintenanceReviewDecision;
}>): Promise<MaintenanceAdoptionAcknowledgment | null> {
  try {
    const value = maintenanceAdoptionSnapshot(raw, 65536), saved = maintenanceAdoptionSnapshot(expected, 65536);
    if (!record(saved) || !["operation", "actorUserId", "intent"].every(key => Object.hasOwn(saved, key))
      || !Object.keys(saved).every(key => ["operation", "actorUserId", "intent", "priorDecision"].includes(key)) || !identity(saved.actorUserId)) return null;
    const operation = saved.operation as MaintenanceOperation, intent = readMaintenanceIntent(operation, saved.intent);
    if (!intent) return null;
    const checked = await readMaintenanceOperationReceipt(value, { operation, actorUserId: saved.actorUserId, intent });
    if (!checked) return null;
    const result = checked.result, selectedBinding = operation === "maintenance-transition"
      ? (intent as MaintenanceTransitionIntent).maintenanceAdoption : (intent as MaintenanceProposalIntent | MaintenanceAdoptionIntent).binding;
    const binding = readMaintenanceAdoptionBinding(result.binding);
    if (!binding || !same(binding, selectedBinding) || !maintenanceHash(result.bindingHash) || await maintenanceBindingDigest(binding) !== result.bindingHash) return null;
    if (operation === "maintenance-adoption") {
      const apply = intent as MaintenanceAdoptionIntent, subjectHash = await maintenanceSubjectDigest(binding);
      if (!envelope(result, ["decisionId", "binding", "bindingHash", "head"]) || result.decisionId !== apply.decisionId
        || !head(result.head, subjectHash, binding.experienceId) || result.head.decisionId !== apply.decisionId
        || result.head.bindingHash !== result.bindingHash || result.head.revision !== binding.expectedAdoption.revision + 1
        || result.head.adoptionEventId !== checked.receipt.eventId || result.head.baselineObservationHash !== binding.target.observationHash
        || result.head.profileRef !== binding.target.profileRef || result.head.profileHash !== binding.target.profileHash
        || result.head.inventoryHash !== binding.target.inventoryHash) return null;
    } else {
      if (!envelope(result, ["decision", "binding", "bindingHash"]) || !decision(result.decision)) return null;
      const row = result.decision;
      if (operation === "maintenance-proposal") {
        const proposal = intent as MaintenanceProposalIntent;
        if (row.status !== "planned" || row.title !== proposal.title || row.ownerUserId !== proposal.ownerUserId || row.evidence !== proposal.evidence
          || !same(row.dependencyIds, proposal.dependencyIds) || row.createdAt !== row.updatedAt) return null;
      } else {
        const transition = intent as MaintenanceTransitionIntent, prior = saved.priorDecision;
        if (!decision(prior) || prior.decisionId !== transition.decisionId || prior.updatedAt !== transition.expectedUpdatedAt
          || !deliveryTransitionAllowed(prior.status, transition.status) || deliveryNeedsEvidence(transition.status) && !transition.evidence
          || row.decisionId !== transition.decisionId || row.status !== transition.status || row.title !== transition.title
          || row.ownerUserId !== transition.ownerUserId || row.evidence !== transition.evidence || row.createdAt !== prior.createdAt
          || !same(row.dependencyIds, prior.dependencyIds) || row.updatedAt <= transition.expectedUpdatedAt
          || checked.receipt.eventId !== maintenanceTransitionEventId(transition.decisionId, row.updatedAt)
          || transition.status === "approved" && [prior.ownerUserId, transition.ownerUserId].includes(saved.actorUserId)) return null;
      }
    }
    return freeze(checked) as MaintenanceAdoptionAcknowledgment;
  } catch { return null; }
}
