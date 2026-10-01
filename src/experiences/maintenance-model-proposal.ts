import { canonicalJson, digest, exactKeys, freeze, record } from "./compiler.ts";
import { maintenanceAdoptionSnapshot, maintenanceHash } from "./maintenance-adoption-contract.ts";
import { bindExperienceMaintenanceProposal, type ExperienceMaintenanceContext, type ExperienceMaintenanceRequest,
  type ExperienceMaintenanceResult } from "./maintenance-proposal.ts";
import { readExperienceMaintenancePreviewRequest } from "./maintenance-review-contract.ts";
import { describeExperiencePatch, type ExperiencePatch, type ExperiencePatchDescriptor } from "./patches.ts";
import type { ExperienceMaterialSelection } from "./release-contract.ts";

export const EXPERIENCE_MAINTENANCE_MODEL_PROTOCOL = "forma-experience-maintenance-model-proposal@1";
export type ExperienceMaintenanceModelReferences = Readonly<{ evidenceRefs: readonly string[]; checkRefs: readonly string[] }>;
export type ExperienceMaintenanceModelNotes = Readonly<{
  intendedChange: string; evidenceRefs: readonly string[]; predictedEffects: readonly string[];
  checkRefs: readonly string[]; compatibilityQuestions: readonly string[];
}>;
export type ExperienceMaintenanceModelRequest = Readonly<{
  version: 1; protocol: typeof EXPERIENCE_MAINTENANCE_MODEL_PROTOCOL; qualification: "proposal-metadata-only";
  generationAvailable: false; canPublish: false; experienceId: string; output: "model3d";
  base: ExperienceMaterialSelection; baselineObservationHash: string; currentObservationHash: string;
  currentLayout: "stage-and-controls" | "stacked-stage"; reviewStatus: "unchanged" | "compatibility-review";
  descriptor: ExperiencePatchDescriptor; responseShape: typeof maintenanceResponseShape;
  brief: string; references: ExperienceMaintenanceModelReferences; requestHash: string;
}>;
type Failure = Readonly<{ ok: false; code: string }>;
type Prepared = Readonly<{ ok: true; request: ExperienceMaintenanceModelRequest }> | Failure;
type Accepted = Readonly<{
  ok: true; requestHash: string; notesQualification: "untrusted-nonexecutable"; notes: ExperienceMaintenanceModelNotes;
  result: Extract<ExperienceMaintenanceResult, { ok: true }>;
}> | Failure;

/** Process-local issuance, not a serializable capability or a provenance claim.
 * The caller retains this exact object while only its JSON packet faces a model.
 * A copied, rehashed or restored JSON request cannot manufacture issuance. */
const issued = new WeakMap<object, Readonly<{ requestJson: string; contextJson: string }>>();
/** Fixed response grammar only. Hash equality is a rule, not an embedded copy
 * of the eventual request hash; the whole descriptor is part of that hash. */
const maintenanceResponseShape = freeze({
  requiredKeys: ["version", "requestHash", "patch", "notes"], additionalKeys: false,
  versionValue: 1, maximumUtf8Bytes: 32768, requestHashRule: "equal-to-request.requestHash",
  patchRule: "null-or-request.descriptor.patch",
  notes: {
    requiredKeys: ["intendedChange", "evidenceRefs", "predictedEffects", "checkRefs", "compatibilityQuestions"], additionalKeys: false,
    intendedChange: { minimumLength: 1, maximumLength: 2048, trimmed: true },
    evidenceRefs: { maximumItems: 32, unique: true, rule: "subset-of-request.references.evidenceRefs" },
    predictedEffects: { maximumItems: 12, minimumItemLength: 1, maximumItemLength: 512, trimmedItems: true },
    checkRefs: { maximumItems: 32, unique: true, rule: "subset-of-request.references.checkRefs" },
    compatibilityQuestions: { maximumItems: 12, minimumItemLength: 1, maximumItemLength: 512, trimmedItems: true },
  },
} as const);
const failed = (code: string): Failure => freeze({ ok: false, code });
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const boundedText = (raw: unknown, maximum: number, required = false): raw is string => typeof raw === "string"
  && raw.length <= maximum && raw === raw.trim() && (!required || raw.length > 0);
const ref = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}(?![\s\S])/u.test(raw);
function refs(raw: unknown): raw is readonly string[] {
  return Array.isArray(raw) && raw.length <= 32 && raw.every(ref) && new Set(raw).size === raw.length;
}
function references(raw: unknown): raw is ExperienceMaintenanceModelReferences {
  return record(raw) && exactKeys(raw, ["evidenceRefs", "checkRefs"]) && refs(raw.evidenceRefs) && refs(raw.checkRefs);
}
function contextSnapshot(raw: unknown): ExperienceMaintenanceContext | null {
  const value = maintenanceAdoptionSnapshot(raw, 196608);
  if (!record(value) || !exactKeys(value, ["material", "catalog", "baseline", "current"]) || !record(value.material)
    || !exactKeys(value.material, ["selection", "release"]) || !record(value.material.selection)
    || !exactKeys(value.material.selection, ["releaseHash", "sourceHash", "buildHash", "evaluationHash"])
    || !Object.values(value.material.selection).every(maintenanceHash) || !record(value.material.release) || !record(value.catalog)
    || !record(value.baseline) || !record(value.current) || !maintenanceHash(value.baseline.observationHash)
    || !maintenanceHash(value.current.observationHash)) return null;
  // The existing binder, not this shallow admission, validates the retained
  // captures and recompiles the exact material against its code-owned catalog.
  return value as unknown as ExperienceMaintenanceContext;
}
const proposalRequest = (context: ExperienceMaintenanceContext, patch: ExperiencePatch | null): ExperienceMaintenanceRequest => ({
  version: 1, base: context.material.selection, baselineObservationHash: context.baseline.observationHash,
  currentObservationHash: context.current.observationHash, patch,
});
function strings(raw: unknown): raw is readonly string[] {
  return Array.isArray(raw) && raw.length <= 12 && raw.every(value => boundedText(value, 512, true));
}
function notes(raw: unknown, allowed: ExperienceMaintenanceModelReferences): raw is ExperienceMaintenanceModelNotes {
  return record(raw) && exactKeys(raw, ["intendedChange", "evidenceRefs", "predictedEffects", "checkRefs", "compatibilityQuestions"])
    && boundedText(raw.intendedChange, 2048, true) && refs(raw.evidenceRefs) && refs(raw.checkRefs)
    && raw.evidenceRefs.every(value => allowed.evidenceRefs.includes(value)) && raw.checkRefs.every(value => allowed.checkRefs.includes(value))
    && strings(raw.predictedEffects) && strings(raw.compatibilityQuestions);
}

/** Prepare only metadata for an external, separately authorized caller. This
 * function invokes no model, provider, check, tool, route or storage operation.
 * Raw captures, source paths/bytes, private documents and the catalog stay local.
 * References are code-nominated opaque identifiers, never paths or executable checks. */
export async function prepareExperienceMaintenanceModelRequest(rawContext: ExperienceMaintenanceContext, rawBrief: string,
  rawReferences: ExperienceMaintenanceModelReferences): Promise<Prepared> {
  try {
    const context = contextSnapshot(rawContext), brief = maintenanceAdoptionSnapshot(rawBrief);
    const permitted = maintenanceAdoptionSnapshot(rawReferences);
    if (!context) return failed("maintenance_model_context");
    if (!boundedText(brief, 4096, true) || !references(permitted)) return failed("maintenance_model_request");
    const contextJson = canonicalJson(context), referencesJson = canonicalJson(permitted);
    const validated = await bindExperienceMaintenanceProposal(proposalRequest(context, null), context);
    if (!validated.ok) return failed(validated.code);
    if (validated.status === "proposal") return failed("maintenance_model_context");
    const body = {
      version: 1 as const, protocol: EXPERIENCE_MAINTENANCE_MODEL_PROTOCOL, qualification: "proposal-metadata-only" as const,
      generationAvailable: false as const, canPublish: false as const, experienceId: context.material.release.definition.id,
      output: "model3d" as const, base: context.material.selection, baselineObservationHash: context.baseline.observationHash,
      currentObservationHash: context.current.observationHash, currentLayout: context.material.release.definition.layout,
      reviewStatus: validated.status, descriptor: describeExperiencePatch(context.material.release), responseShape: maintenanceResponseShape,
      brief, references: permitted,
    };
    const requestHash = await digest(body), request = maintenanceAdoptionSnapshot({ ...body, requestHash });
    if (!request) return failed("maintenance_model_request");
    const current = contextSnapshot(rawContext), currentReferences = maintenanceAdoptionSnapshot(rawReferences);
    if (!current || canonicalJson(current) !== contextJson) return failed("maintenance_model_context_changed");
    if (rawBrief !== brief || !currentReferences || canonicalJson(currentReferences) !== referencesJson) return failed("maintenance_model_request_changed");
    issued.set(request as object, freeze({ requestJson: canonicalJson(request), contextJson }));
    return freeze({ ok: true, request: request as ExperienceMaintenanceModelRequest });
  } catch { return failed("maintenance_model_request_unavailable"); }
}

/** Accept one parsed JSON object against the exact code-issued request. Notes
 * remain untrusted text, including any claims they contain. Only the existing
 * binder computes status, diff and candidate; compatibility review yields none.
 * No response can nominate authority, tests to execute, rendering or publication. */
export async function acceptExperienceMaintenanceModelResponse(rawResponse: unknown, issuedRequest: ExperienceMaintenanceModelRequest,
  rawContext: ExperienceMaintenanceContext): Promise<Accepted> {
  try {
    const retained = issuedRequest !== null && typeof issuedRequest === "object" ? issued.get(issuedRequest) : undefined;
    if (!retained) return failed("maintenance_model_request_unissued");
    // Capture every caller value before the first awaited digest or compilation.
    const response = maintenanceAdoptionSnapshot(rawResponse), request = maintenanceAdoptionSnapshot(issuedRequest);
    const context = contextSnapshot(rawContext);
    if (!request || canonicalJson(request) !== retained.requestJson) return failed("maintenance_model_request_changed");
    if (!context || canonicalJson(context) !== retained.contextJson) return failed("maintenance_model_context_changed");
    const captured = request as ExperienceMaintenanceModelRequest;
    if (!record(response) || !exactKeys(response, ["version", "requestHash", "patch", "notes"]) || response.version !== 1
      || !maintenanceHash(response.requestHash) || response.requestHash !== captured.requestHash
      || !notes(response.notes, captured.references)) return failed("maintenance_model_response");
    const candidateRequest = response.patch === null ? proposalRequest(context, null)
      : readExperienceMaintenancePreviewRequest(proposalRequest(context, response.patch as ExperiencePatch));
    if (!candidateRequest) return failed("maintenance_model_response");
    const { requestHash, ...body } = captured;
    if (await digest(body) !== requestHash || !same(captured.base, context.material.selection)
      || captured.baselineObservationHash !== context.baseline.observationHash || captured.currentObservationHash !== context.current.observationHash
      || captured.experienceId !== context.material.release.definition.id || captured.currentLayout !== context.material.release.definition.layout
      || !same(captured.descriptor, describeExperiencePatch(context.material.release))) return failed("maintenance_model_request_changed");
    const result = await bindExperienceMaintenanceProposal(candidateRequest, context);
    const currentRequest = maintenanceAdoptionSnapshot(issuedRequest), currentContext = contextSnapshot(rawContext);
    if (issued.get(issuedRequest) !== retained || !currentRequest || canonicalJson(currentRequest) !== retained.requestJson)
      return failed("maintenance_model_request_changed");
    if (!currentContext || canonicalJson(currentContext) !== retained.contextJson) return failed("maintenance_model_context_changed");
    if (!result.ok) return failed(result.code);
    if (captured.reviewStatus === "compatibility-review" ? result.status !== "compatibility-review" : result.status === "compatibility-review")
      return failed("maintenance_model_context_changed");
    return freeze({ ok: true, requestHash, notesQualification: "untrusted-nonexecutable", notes: response.notes, result });
  } catch { return failed("maintenance_model_response_unavailable"); }
}
