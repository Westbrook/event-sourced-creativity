import { canonicalJson, compileExperience, digest, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import type { Catalog, CompiledRelease, OutputKind } from "./contracts.ts";
import { describeExperiencePatch, proposePatch, type ExperiencePatchDescriptor } from "./patches.ts";
import { canonicalDeliveryStatus, type DeliveryDecisionStatus } from "../platform/delivery-lifecycle.ts";

/** Managed definitions remain fixtures. This protocol never authorizes generation. */
export const EXPERIENCE_RELEASE_PROTOCOL = "forma-experience-release@1";
export const experienceReleaseHash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
export const experienceRequestId = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const isExperienceDecisionId = (value: unknown): value is string => typeof value === "string" && value.startsWith("experience-release:v1:");
export const validExperienceDecisionId = (value: unknown): value is string => isExperienceDecisionId(value) && experienceRequestId(value.slice("experience-release:v1:".length));
export const experienceId = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{1,63}$/.test(value);
export const experienceTimestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const experienceEventId = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(value);

export type ExperienceReleaseBinding = Readonly<{
  version: 1; operation: "publish" | "rollback"; channel: "managed-fixture"; experienceId: string;
  releaseHash: string; sourceHash: string; buildHash: string; evaluationHash: string;
  expectedHead: Readonly<{ revision: number; eventId: string | null }>;
  rollbackPublicationEventId: string | null;
}>;

export function readExperienceReleaseBinding(value: unknown): ExperienceReleaseBinding | null {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["version", "operation", "channel", "experienceId",
    "releaseHash", "sourceHash", "buildHash", "evaluationHash", "expectedHead", "rollbackPublicationEventId"])
    || value.version !== 1 || (value.operation !== "publish" && value.operation !== "rollback") || value.channel !== "managed-fixture"
    || !experienceId(value.experienceId) || ![value.releaseHash, value.sourceHash, value.buildHash, value.evaluationHash].every(experienceReleaseHash)
    || !record(value.expectedHead) || !exactKeys(value.expectedHead, ["revision", "eventId"])
    || !Number.isSafeInteger(value.expectedHead.revision) || Number(value.expectedHead.revision) < 0
    || (value.expectedHead.revision === 0 ? value.expectedHead.eventId !== null : !experienceEventId(value.expectedHead.eventId))
    || (value.operation === "publish" ? value.rollbackPublicationEventId !== null : !experienceEventId(value.rollbackPublicationEventId))) return null;
  return freeze(structuredClone(value)) as ExperienceReleaseBinding;
}

export type ExperienceProposalIntent = Readonly<{
  version: 1; requestId: string; title: string; ownerUserId: string; evidence: string; dependencyIds: readonly string[];
  binding: ExperienceReleaseBinding;
}>;
export type ExperienceTransitionIntent = Readonly<{
  version: 1; requestId: string; decisionId: string; expectedUpdatedAt: string; title: string;
  ownerUserId: string; evidence: string; status: DeliveryDecisionStatus; experienceRelease: ExperienceReleaseBinding;
}>;
export type ExperiencePublicationIntent = Readonly<{
  version: 1; requestId: string; decisionId: string; expectedDecisionUpdatedAt: string; approvalEventId: string;
  binding: ExperienceReleaseBinding;
}>;
export type ExperienceOperation = "proposal" | "transition" | "publication";
export type ExperienceIntent = ExperienceProposalIntent | ExperienceTransitionIntent | ExperiencePublicationIntent;
const text = (value: unknown, maximum: number, required = false): value is string => typeof value === "string"
  && value.length <= maximum && value === value.trim() && (!required || Boolean(value));
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && value === value.trim();

export function readExperienceProposal(value: unknown): ExperienceProposalIntent | null {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["version", "requestId", "title", "ownerUserId", "evidence", "dependencyIds", "binding"])
    || value.version !== 1 || !experienceRequestId(value.requestId) || !text(value.title, 160, true) || !text(value.evidence, 800)
    || !identity(value.ownerUserId) || !Array.isArray(value.dependencyIds) || value.dependencyIds.length > 10
    || value.dependencyIds.some(id => !identity(id)) || new Set(value.dependencyIds).size !== value.dependencyIds.length
    || !readExperienceReleaseBinding(value.binding)) return null;
  return freeze(structuredClone(value)) as ExperienceProposalIntent;
}

export function readExperienceTransition(value: unknown): ExperienceTransitionIntent | null {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["version", "requestId", "decisionId", "expectedUpdatedAt", "title", "ownerUserId", "evidence", "status", "experienceRelease"])
    || value.version !== 1 || !experienceRequestId(value.requestId) || !validExperienceDecisionId(value.decisionId)
    || !experienceTimestamp(value.expectedUpdatedAt) || !text(value.title, 160, true) || !text(value.evidence, 800)
    || !identity(value.ownerUserId) || typeof value.status !== "string" || canonicalDeliveryStatus(value.status) !== value.status
    || !readExperienceReleaseBinding(value.experienceRelease)) return null;
  return freeze(structuredClone(value)) as ExperienceTransitionIntent;
}

export function readExperiencePublication(value: unknown): ExperiencePublicationIntent | null {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["version", "requestId", "decisionId", "expectedDecisionUpdatedAt", "approvalEventId", "binding"])
    || value.version !== 1 || !experienceRequestId(value.requestId) || !validExperienceDecisionId(value.decisionId)
    || !experienceTimestamp(value.expectedDecisionUpdatedAt) || !experienceEventId(value.approvalEventId)
    || !readExperienceReleaseBinding(value.binding)) return null;
  return freeze(structuredClone(value)) as ExperiencePublicationIntent;
}

export const readExperienceIntent = (operation: ExperienceOperation, value: unknown): ExperienceIntent | null =>
  operation === "proposal" ? readExperienceProposal(value) : operation === "transition" ? readExperienceTransition(value)
    : operation === "publication" ? readExperiencePublication(value) : null;
export const experienceIntentDigest = (operation: ExperienceOperation, actorUserId: string, intent: ExperienceIntent) =>
  digest({ protocol: EXPERIENCE_RELEASE_PROTOCOL, operation, actorUserId, intent });
export const experienceBindingDigest = (binding: ExperienceReleaseBinding) => digest(binding);
export const experienceTransitionEventId = (decisionId: string, updatedAt: string) => `experience-transition:v1:${decisionId.slice("experience-release:v1:".length)}:${updatedAt}`;

export type ExperienceOperationReceipt = Readonly<{
  version: 1; protocol: typeof EXPERIENCE_RELEASE_PROTOCOL; operation: ExperienceOperation; requestId: string;
  actorUserId: string; intentDigest: string; eventId: string; sequence: number; acknowledgmentDigest: string;
}>;

/** Byte-bound original acknowledgment. Current authority/head is deliberately separate. */
export async function readExperienceOperationReceipt(value: unknown, expected: {
  operation: ExperienceOperation; actorUserId: string; intent: ExperienceIntent;
}): Promise<{ receipt: ExperienceOperationReceipt; result: Record<string, unknown> } | null> {
  if (jsonIssues(value).length || jsonIssues(expected).length) return null;
  const expectedIntent = readExperienceIntent(expected.operation, expected.intent);
  if (!expectedIntent || typeof expected.actorUserId !== "string") return null;
  const expectedActor = expected.actorUserId, expectedOperation = expected.operation;
  value = structuredClone(value);
  if (!record(value) || !exactKeys(value, ["receipt", "result"]) || !record(value.receipt) || !record(value.result)) return null;
  const receipt = value.receipt;
  if (!exactKeys(receipt, ["version", "protocol", "operation", "requestId", "actorUserId", "intentDigest", "eventId", "sequence", "acknowledgmentDigest"])
    || receipt.version !== 1 || receipt.protocol !== EXPERIENCE_RELEASE_PROTOCOL || receipt.operation !== expectedOperation
    || receipt.requestId !== expectedIntent.requestId || receipt.actorUserId !== expectedActor
    || !experienceEventId(receipt.eventId) || !Number.isSafeInteger(receipt.sequence) || Number(receipt.sequence) < 1
    || !experienceReleaseHash(receipt.intentDigest) || !experienceReleaseHash(receipt.acknowledgmentDigest)
    || receipt.intentDigest !== await experienceIntentDigest(expectedOperation, expectedActor, expectedIntent)
    || receipt.acknowledgmentDigest !== await digest(value.result)) return null;
  // Never return live aliases to request objects or parsed retained JSON.
  return freeze(structuredClone({ receipt, result: value.result })) as { receipt: ExperienceOperationReceipt; result: Record<string, unknown> };
}

export const sameExperienceBinding = (left: ExperienceReleaseBinding, right: ExperienceReleaseBinding) => canonicalJson(left) === canonicalJson(right);

export type ExperienceMaterialSelection = Readonly<{ releaseHash: string; sourceHash: string; buildHash: string; evaluationHash: string }>;
export type ExperienceMaterialSummary = Readonly<{
  selection: ExperienceMaterialSelection; experienceId: string; definitionRevision: number; output: OutputKind;
  evaluation: Readonly<{ outcome: "passed"; caseCount: number }>;
}>;
export type ExperienceMaterialInventory = Readonly<{
  version: 1; qualification: "fixture"; generationAvailable: false; materials: readonly ExperienceMaterialSummary[];
}>;
export type ExperienceMaterialDetail = Readonly<{
  version: 1; qualification: "fixture"; generationAvailable: false; material: ExperienceMaterialSummary;
  release: CompiledRelease; descriptor: ExperiencePatchDescriptor;
}>;
const materialSelectionKeys = ["releaseHash", "sourceHash", "buildHash", "evaluationHash"];
const materialOutputs = new Set(["image", "short_story", "scene", "slides", "storyboard", "video", "audio", "model3d"]);

export function readExperienceMaterialSelection(value: unknown): ExperienceMaterialSelection | null {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, materialSelectionKeys)
    || !Object.values(value).every(experienceReleaseHash)) return null;
  return freeze(structuredClone(value)) as ExperienceMaterialSelection;
}

function materialSummary(value: unknown): ExperienceMaterialSummary | null {
  if (!record(value) || !exactKeys(value, ["selection", "experienceId", "definitionRevision", "output", "evaluation"])
    || !readExperienceMaterialSelection(value.selection) || !experienceId(value.experienceId)
    || !Number.isSafeInteger(value.definitionRevision) || Number(value.definitionRevision) < 1
    || typeof value.output !== "string" || !materialOutputs.has(value.output)
    || !record(value.evaluation) || !exactKeys(value.evaluation, ["outcome", "caseCount"])
    || value.evaluation.outcome !== "passed" || !Number.isSafeInteger(value.evaluation.caseCount)
    || Number(value.evaluation.caseCount) < 1 || Number(value.evaluation.caseCount) > 1_000_000) return null;
  return freeze(structuredClone(value)) as ExperienceMaterialSummary;
}

export function readExperienceMaterialInventory(value: unknown): ExperienceMaterialInventory | null {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["version", "qualification", "generationAvailable", "materials"])
    || value.version !== 1 || value.qualification !== "fixture" || value.generationAvailable !== false
    || !Array.isArray(value.materials) || value.materials.length > 64) return null;
  const selections = new Set<string>();
  for (const row of value.materials) {
    const summary = materialSummary(row); if (!summary) return null;
    const key = canonicalJson(summary.selection); if (selections.has(key)) return null; selections.add(key);
  }
  return freeze(structuredClone(value)) as ExperienceMaterialInventory;
}

const materialText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 8192;
function materialPairs(value: unknown, key: "value" | "id"): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return false;
  const seen = new Set<string>();
  return value.every(pair => {
    if (!record(pair) || !exactKeys(pair, [key, "label"]) || !materialText(pair[key]) || !materialText(pair.label) || seen.has(pair[key])) return false;
    seen.add(pair[key]); return true;
  });
}

/** Validate a selected release without importing a Worker or disclosing a Catalog.
 * Reconstruct only its selected catalog slice and recompile before publication.
 * This proves DTO consistency, not source-file custody or a qualification pass.
 */
export async function readExperienceMaterialDetail(value: unknown): Promise<ExperienceMaterialDetail | null> {
  try {
    if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["version", "qualification", "generationAvailable", "material", "release", "descriptor"])
      || value.version !== 1 || value.qualification !== "fixture" || value.generationAvailable !== false) return null;
    const snapshot = freeze(structuredClone(value)), summary = materialSummary(snapshot.material), release = snapshot.release;
    if (!summary || !record(release) || !exactKeys(release, ["schemaVersion", "qualification", "definition", "output", "interactions", "copy", "definitionHash", "releaseHash", "dependencies"])
      || release.schemaVersion !== 1 || release.qualification !== "fixture" || !record(release.definition) || !record(release.output)
      || !record(release.interactions) || !record(release.copy) || !record(release.dependencies)
      || !experienceReleaseHash(release.definitionHash) || release.releaseHash !== summary.selection.releaseHash
      || release.definition.id !== summary.experienceId || release.definition.revision !== summary.definitionRevision
      || release.output.output !== summary.output || !Object.values(release.copy).every(materialText)
      || !Object.values(release.dependencies).every(experienceReleaseHash)) return null;
    const output = release.output;
    if (!exactKeys(output, ["id", "version", "output", "label", "result", "bindingPackRef", "essentialInteractionRef", "viewerRef", "bindings"])
      || output.version !== 1 || ![output.id, output.label, output.result, output.bindingPackRef, output.essentialInteractionRef, output.viewerRef].every(materialText)
      || !Array.isArray(output.bindings) || output.bindings.length < 1 || output.bindings.length > 12) return null;
    for (const binding of output.bindings) {
      if (!record(binding) || !exactKeys(binding, ["slot", "decisionId", "interactionRef", "role", "target"])
        || ![binding.slot, binding.decisionId, binding.interactionRef].every(materialText)
        || !["subject", "direction", "evidence", "constraint"].includes(String(binding.role)) || binding.target !== summary.output) return null;
    }
    const interactions: Record<string, unknown> = Object.create(null);
    const required = ["id", "version", "kind", "renderer", "feedback", "required", "maxLength", "defaultValue"];
    const optional = ["options", "fields", "minimum", "maximum"];
    for (const interaction of Object.values(release.interactions)) {
      if (!record(interaction) || !required.every(key => Object.hasOwn(interaction, key))
        || !Object.keys(interaction).every(key => required.includes(key) || optional.includes(key))
        || !materialText(interaction.id) || interaction.version !== 1
        || ![interaction.kind, interaction.renderer, interaction.feedback].every(materialText) || typeof interaction.required !== "boolean"
        || !Number.isSafeInteger(interaction.maxLength) || Number(interaction.maxLength) < 1 || Number(interaction.maxLength) > 8192
        || Object.hasOwn(interaction, "options") && !materialPairs(interaction.options, "value")
        || Object.hasOwn(interaction, "fields") && !materialPairs(interaction.fields, "id")
        || Object.hasOwn(interaction, "minimum") && !Number.isSafeInteger(interaction.minimum)
        || Object.hasOwn(interaction, "maximum") && !Number.isSafeInteger(interaction.maximum)) return null;
      if (Object.hasOwn(interactions, interaction.id) && canonicalJson(interactions[interaction.id]) !== canonicalJson(interaction)) return null;
      const options = Object.hasOwn(interaction, "options"), fields = Object.hasOwn(interaction, "fields");
      const minimum = Object.hasOwn(interaction, "minimum"), maximum = Object.hasOwn(interaction, "maximum");
      if ((interaction.kind === "source" || interaction.kind === "order") && (options || fields || minimum || maximum)) return null;
      if ((interaction.kind === "spatial" || interaction.kind === "treatment") && (!options || fields || minimum || maximum)) return null;
      if (interaction.kind === "relationship" && (options || !fields || minimum || maximum)) return null;
      if ((interaction.kind === "profile" || interaction.kind === "proportion")
        && (options || !fields || !minimum || !maximum || Number(interaction.minimum) > Number(interaction.maximum))) return null;
      interactions[interaction.id] = interaction;
    }
    const catalog = { version: "forma-experience-fixture@1", qualification: "fixture", interactions,
      outputs: { [String(output.id)]: output }, copy: release.copy } as unknown as Catalog;
    if (jsonIssues(catalog).length) return null;
    const compiled = await compileExperience(release.definition, catalog);
    if (!compiled.ok || canonicalJson(compiled.release) !== canonicalJson(release)
      || canonicalJson(describeExperiencePatch(compiled.release)) !== canonicalJson(snapshot.descriptor)) return null;
    return freeze(structuredClone(snapshot)) as ExperienceMaterialDetail;
  } catch { return null; }
}

export type ExperienceMaterialPreview = Awaited<ReturnType<typeof proposePatch>> & Readonly<{
  descriptor: ExperiencePatchDescriptor; qualification: "fixture"; generationAvailable: false; canPublish: false;
}>;

/** A preview is never registered material. Validate its response against the
 * exact captured base and patch, without inventing source/build/evaluation hashes.
 */
export async function readExperienceMaterialPreview(value: unknown, expected: Readonly<{
  detail: ExperienceMaterialDetail; patch: unknown;
}>): Promise<ExperienceMaterialPreview | null> {
  try {
    if (jsonIssues(value).length || jsonIssues(expected).length || !record(expected) || !exactKeys(expected, ["detail", "patch"])) return null;
    const response = freeze(structuredClone(value)), captured = freeze(structuredClone(expected));
    const detail = await readExperienceMaterialDetail(captured.detail);
    if (!detail) return null;
    const { release } = detail;
    const catalog: Catalog = { version: "forma-experience-fixture@1", qualification: "fixture",
      outputs: { [release.output.id]: release.output },
      interactions: Object.fromEntries(Object.values(release.interactions).map(interaction => [interaction.id, interaction])), copy: release.copy };
    const candidate = await proposePatch(release, captured.patch, catalog);
    const verified = { ...candidate, descriptor: describeExperiencePatch(release), qualification: "fixture", generationAvailable: false, canPublish: false };
    return canonicalJson(response) === canonicalJson(verified) ? freeze(structuredClone(response)) as ExperienceMaterialPreview : null;
  } catch { return null; }
}
