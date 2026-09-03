import { canonicalJson, compileExperience, digest, exactKeys, freeze, record } from "./compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, experienceDraftId, experienceResourceId, intakeValueIssues, isIntentId, registeredExperience, type ExperiencePlan, type IntakeRequest } from "./intake.ts";
import type { Catalog, CompiledRelease } from "./contracts.ts";
import type { CreativeEvent, EventInput } from "../model/events.ts";
import { normalizeOutputRequirementCreation } from "../model/output-requirement-creation.ts";
import { inspectOutputRequirement, outputRequirementInterpretationNeedsReview, type OutputRequirementSpec } from "../model/output-requirements.ts";

/**
 * Fresh-only setup grammar. This module is disconnected from registration,
 * transport, retention, commit, execution, and recovery dispatch.
 * A built/decoded plan is not proof of freshness, custody, consent or authority.
 * The future personal owner must independently enforce those boundaries.
 */
const SETUP_ID = "short_story.output-setup@2" as const;
const RECEIPT_PREFIX = "experience-intake:v2:";
const OUTPUT_SLOT = "output:short_story:setup@2";
const DELIVERABLE_SLOT = "deliverable:short_story:setup@2";
const LABEL = "Short story";
const WORDING = "1 short story";
const sourceGrammar = freeze({
  version: "short_story.source-events@1",
  projectState: "active", documentHandle: "short-story", sourceSurface: "experience",
  identitySlots: ["project", "document", "character", "causality", "ending", "format"],
  initialEventOrder: ["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"],
  inputEnvelopeKeys: ["type", "payload"],
  authorityByProvenance: { authored: "authored", default: "inferred" },
  contextPropertyKeys: ["text", "subtype", "weight", "authority", "experience_origin", "experience_release", "experience_binding", "experience_value"],
  formatPropertyKeys: ["text", "subtype", "weight", "authority", "experience_origin", "experience_release"],
  defaultOrigin: "default", formatAuthority: "inferred", typedValue: "unchanged", sourceRelease: "pinned-base-release",
  decisions: [
    { id: "character", type: "subject", subtype: "Hero subject", position: "z0001", text: "trimmed-string" },
    { id: "causality", type: "action", subtype: "Interaction", position: "z0002", text: "Goal/Obstacle/Decision:newline:trimmed-fields" },
    { id: "ending", type: "direction", subtype: "Campaign goal", position: "z0003", text: "Ending: registered-option-label" },
  ],
  weight: 0.8,
  format: { slot: "format", type: "format", subtype: "Aspect ratio", handle: "format/experience-deliverable", position: "z0099", text: WORDING },
});

// Independently captured by the owner's approved existing-code V1 baseline.
// This literal identifies the accepted release; a caller cannot replace it by
// supplying a self-rehashed definition/catalog. No current catalog is resolved.
export const SHORT_STORY_SETUP_V2_BASE_RELEASE_HASH = "sha256:da8cd1a20d106289e23ad9f6b8fcb0417928e2290a6f8168f6295c66dfbf4a88";
const suggested = (text: string) => ({ kind: "suggested" as const, text });
const requirementTemplate = freeze({
  schema_version: 1 as const, label: LABEL, original_text: WORDING,
  value_origins: { label: suggested(LABEL), original_text: suggested(WORDING), deliverables: suggested(WORDING) },
  deliverable: {
    label: LABEL, media_kind: "document" as const, artifact_format: { kind: "short_story" as const, version: 1 as const },
    required: true, quantity: { kind: "exact" as const, unit: "document" as const, value: 1 },
    source_scope: { kind: "document" as const }, coverage: { kind: "document_context" as const }, original_text: WORDING,
    value_origins: {
      label: suggested(LABEL), media_kind: suggested("Document"), artifact_format: suggested(LABEL), required: suggested(WORDING),
      quantity: suggested(WORDING), source_scope: suggested("Document context"), coverage: suggested("Document context"), original_text: suggested(WORDING),
    },
  },
});
export type ShortStorySetupV2Identity = Readonly<{
  id: typeof SETUP_ID; version: 2; baseReleaseHash: string; setupHash: string;
}>;
export type ShortStorySetupV2Plan = Readonly<Omit<ExperiencePlan, "version"> & {
  version: 2; setup: ShortStorySetupV2Identity; outputBlockId: string; deliverableId: string;
}>;
export type ShortStorySetupV2Receipt = Readonly<{
  status: "complete"; projectId: string; documentId: string; appended: readonly CreativeEvent[]; rejected: readonly never[];
  head: number; draftId: string; draftHash: string; generation: "unavailable"; documentRoute: string;
}>;
/** From the trusted retained record already held by the owner, never mirrored
 * from a browser candidate. This adds no storage field or custody mechanism. */
export type ExpectedShortStorySetupV2Identity = Readonly<{
  intentId: string; draftId: string; draftHash: string; projectId: string; documentId: string; setupHash: string;
}>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };
const sha256 = /^sha256:[a-f0-9]{64}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function invalid(): never { throw new Error("experience_setup_invalid"); }
function check(value: unknown): asserts value { if (!value) invalid(); }
function owner(value: unknown): string {
  check(typeof value === "string" && value.length > 0 && value.length <= 240 && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value));
  return value;
}
function exact(value: Json | undefined, keys: readonly string[]): Obj {
  check(record(value) && exactKeys(value, keys)); return value as Obj;
}

// Quarantine caller descriptors before the first await; never validate one live
// Proxy value and later hash, clone or return a different live value.
function capture(input: unknown): Json {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>(), encoder = new TextEncoder();
  const charge = (amount: number) => { bytes += amount; check(bytes <= 262_144); };
  const visit = (value: unknown, depth: number): Json => {
    check(++nodes <= 8192 && depth <= 16);
    if (value === null || typeof value === "boolean") { charge(5); return value; }
    if (typeof value === "number") { check(Number.isFinite(value)); charge(String(value).length); return value; }
    if (typeof value === "string") { check(value.length <= 8192); charge(encoder.encode(JSON.stringify(value)).length); return value; }
    check(value && typeof value === "object" && !ancestors.has(value));
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    check(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null);
    const keys = Reflect.ownKeys(value); check(keys.every(key => typeof key === "string")); ancestors.add(value);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      check(Number.isSafeInteger(length) && length >= 0 && length <= 64 && keys.length === length + 1);
      const result: Json[] = []; charge(length + 2);
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        check(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, "value"));
        result.push(visit(descriptor.value, depth + 1));
      }
      ancestors.delete(value); return result;
    }
    check(keys.length <= 64); charge(keys.length + 2);
    const result: Obj = {};
    for (const key of keys as string[]) {
      check(key.length <= 128 && !["__proto__", "constructor", "prototype"].includes(key));
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, "value"));
      charge(encoder.encode(JSON.stringify(key)).length + 1); result[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value); return result;
  };
  return visit(input, 0);
}

async function pinnedRelease(value: Json): Promise<CompiledRelease> {
  const release = exact(value, ["schemaVersion", "qualification", "definition", "output", "interactions", "copy", "definitionHash", "releaseHash", "dependencies"]);
  check(release.releaseHash === SHORT_STORY_SETUP_V2_BASE_RELEASE_HASH && record(release.definition) && release.definition.id === "short-story"
    && record(release.output) && release.output.output === "short_story" && typeof release.output.id === "string" && record(release.interactions) && record(release.copy));
  const interactions = Object.values(release.interactions);
  check(interactions.every(item => record(item) && typeof item.id === "string"));
  const catalog = { version: "forma-experience-fixture@1", qualification: "fixture",
    interactions: Object.fromEntries(interactions.map(item => [(item as Obj).id, item])),
    outputs: { [release.output.id]: release.output }, copy: release.copy } as unknown as Catalog;
  const compiled = await compileExperience(release.definition, catalog).catch(() => invalid());
  check(compiled.ok && compiled.release.releaseHash === SHORT_STORY_SETUP_V2_BASE_RELEASE_HASH
    && canonicalJson(compiled.release) === canonicalJson(release));
  return compiled.release;
}
/** Code-owned setup semantics plus a cryptographically pinned archived release.
 * Inspecting this identity is not approval. The future owner independently pins
 * the setup identity; callers cannot alter either semantic contract by rehashing. */
async function archiveFromCaptured(value: Json) {
  const release = await pinnedRelease(value);
  const descriptor = freeze({
    id: SETUP_ID, version: 2 as const, qualification: "setup-only" as const, baseReleaseHash: release.releaseHash,
    namespace: "experience-intake@1", sourceGrammar, requirementTemplate, outputSlot: OUTPUT_SLOT, deliverableSlot: DELIVERABLE_SLOT,
    receipt: {
      prefix: RECEIPT_PREFIX, ordinal: "zero-based-decimal", count: 8, clientId: "web:experience-intake", correlationPrefix: "experience-intake:",
      actor: "user", schemaVersion: 1, causationId: null, compensatesEventId: null, timestamps: "canonical-UTC-milliseconds",
      eventIds: "unique-UUID", sequence: "positive-contiguous", head: "at-least-last-sequence",
      eventKeys: ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId", "correlationId", "causationId", "compensatesEventId", "schemaVersion", "type", "payload"],
      responseKeys: ["status", "projectId", "documentId", "appended", "rejected", "head", "draftId", "draftHash", "generation", "documentRoute"],
    },
    output: {
      type: "output", scope: "document", handlePrefix: "output/", positionPrefix: "z-output-", authority: "inferred", experienceOrigin: "default",
      propertyKeys: ["text", "subtype", "output_spec", "output_plan_suggestions", "authority", "experience_origin", "experience_release"],
      planSuggestions: {}, interpretation: "review-required", influenceProperties: "absent",
    },
    route: { prefix: "/document/", suffix: "/short-story" }, generation: "unavailable",
  });
  const identity: ShortStorySetupV2Identity = freeze({ id: SETUP_ID, version: 2, baseReleaseHash: release.releaseHash, setupHash: await digest(descriptor) });
  return freeze({ qualification: "setup-only" as const, identity, descriptor, release });
}
export async function shortStorySetupV2Archive(baseReleaseInput: unknown) { return archiveFromCaptured(capture(baseReleaseInput)); }
type Archive = Awaited<ReturnType<typeof archiveFromCaptured>>;
async function approvedArchive(value: Json, releaseValue: Json): Promise<Archive> {
  const supplied = exact(value, ["id", "version", "baseReleaseHash", "setupHash"]);
  check(supplied.id === SETUP_ID && supplied.version === 2 && typeof supplied.baseReleaseHash === "string" && sha256.test(supplied.baseReleaseHash)
    && typeof supplied.setupHash === "string" && sha256.test(supplied.setupHash));
  const archive = await archiveFromCaptured(releaseValue);
  check(canonicalJson(supplied) === canonicalJson(archive.identity)); return archive;
}
function requestForArchive(value: Json, release: CompiledRelease): IntakeRequest {
  const request = exact(value, ["intentId", "experienceId", "releaseHash", "values"]);
  check(isIntentId(request.intentId) && request.experienceId === "short-story" && release.definition.id === "short-story" && release.output.output === "short_story"
    && request.releaseHash === release.releaseHash && !intakeValueIssues(release, request.values).length);
  return request as unknown as IntakeRequest;
}
function prefix(draftId: string) { return RECEIPT_PREFIX + draftId + ":"; }
function route(documentId: string) { return "/document/" + documentId + "/short-story"; }

/** Retained reconstruction uses this frozen grammar, not current UI defaults. */
async function archivedBasePlan(ownerId: string, request: IntakeRequest, release: CompiledRelease): Promise<ExperiencePlan> {
  const draftId = await experienceDraftId(ownerId, request.intentId);
  const projectId = await experienceResourceId(draftId, "project"), documentId = await experienceResourceId(draftId, "document");
  const plan = { version: 1 as const, draftId, request, release, streamId: "creative:" + ownerId, projectId, documentId, title: LABEL };
  const shared = { project_id: plan.projectId, document_id: plan.documentId };
  const events: EventInput[] = [
    { type: "ProjectCreated", payload: { project_id: plan.projectId, name: LABEL, state: "active" } },
    { type: "DocumentCreated", payload: { ...shared, handle: "short-story", title: LABEL } },
    { type: "EmptyCanvasChosen", payload: { ...shared, source_surface: "experience" } },
  ];
  for (const decision of sourceGrammar.decisions) {
    const entry = plan.request.values[decision.id];
    let text: string;
    if (decision.id === "character") text = (entry.value as string).trim();
    else if (decision.id === "causality") {
      const fields = entry.value as Record<string, string>;
      text = ["Goal: " + fields.goal.trim(), "Obstacle: " + fields.obstacle.trim(), "Decision: " + fields.decision.trim()].join("\n");
    } else {
      const label = { resolution: "Resolution", reversal: "Reversal", open: "Open" }[entry.value as "resolution" | "reversal" | "open"];
      check(label); text = "Ending: " + label;
    }
    events.push({ type: "BlockCreated", payload: {
      ...shared, block_id: await experienceResourceId(plan.draftId, decision.id), type: decision.type,
      handle: decision.type + "/experience-" + decision.id, position: decision.position,
      properties: { text, subtype: decision.subtype, weight: 0.8, authority: entry.provenance === "authored" ? "authored" : "inferred",
        experience_origin: entry.provenance, experience_release: release.releaseHash, experience_binding: decision.id, experience_value: entry.value },
    } });
  }
  events.push({ type: "BlockCreated", payload: {
    ...shared, block_id: await experienceResourceId(plan.draftId, "format"), type: "format", handle: "format/experience-deliverable", position: "z0099",
    properties: { text: WORDING, subtype: "Aspect ratio", weight: 0.8, authority: "inferred", experience_origin: "default", experience_release: release.releaseHash },
  } });
  events.forEach((event, index) => { event.payload.client_event_id = "experience-intake:v1:" + plan.draftId + ":" + index; });
  const base = { ...plan, events };
  return freeze({ ...base, draftHash: await digest(base) });
}
async function buildCaptured(ownerId: string, requestValue: Json, releaseValue: Json, approved: Json, fresh: boolean): Promise<ShortStorySetupV2Plan> {
  const archive = await approvedArchive(approved, releaseValue), request = requestForArchive(requestValue, archive.release);
  const base = await archivedBasePlan(ownerId, request, archive.release);
  if (fresh) {
    const registered = await registeredExperience("short-story");
    check(registered && registered.releaseHash === SHORT_STORY_SETUP_V2_BASE_RELEASE_HASH
      && canonicalJson(registered) === canonicalJson(archive.release));
    const current = await buildExperiencePlan(ownerId, request, archive.release);
    check(canonicalJson(current) === canonicalJson(base) && experienceDocumentRoute(current) === route(base.documentId));
  }
  const outputBlockId = await experienceResourceId(base.draftId, OUTPUT_SLOT), deliverableId = await experienceResourceId(base.draftId, DELIVERABLE_SLOT);
  const { deliverable, ...requirement } = requirementTemplate;
  const spec: OutputRequirementSpec = { ...structuredClone(requirement), id: outputBlockId, deliverables: [{ ...structuredClone(deliverable), id: deliverableId }] };
  check(inspectOutputRequirement(spec).status === "valid" && !Object.hasOwn(spec.value_origins, "interpretation_basis")
    && outputRequirementInterpretationNeedsReview(spec) === true);
  const events: EventInput[] = base.events.map((event, index) => ({
    type: event.type, payload: { ...structuredClone(event.payload), client_event_id: prefix(base.draftId) + index },
  }));
  const payload = {
    project_id: base.projectId, document_id: base.documentId, block_id: outputBlockId, type: "output", scope: "document",
    handle: "output/" + outputBlockId, position: "z-output-" + outputBlockId,
    properties: { text: WORDING, subtype: LABEL, output_spec: spec, output_plan_suggestions: {}, authority: "inferred",
      experience_origin: "default", experience_release: archive.release.releaseHash },
    client_event_id: prefix(base.draftId) + events.length,
  };
  // output_plan_suggestions is native internal creation metadata. This closed
  // candidate is NOT admitted by the generic client-event route or any V2 host.
  const normalized = normalizeOutputRequirementCreation(payload);
  check(canonicalJson(normalized) === canonicalJson(payload));
  events.push({ type: "BlockCreated", payload: normalized });
  const { draftHash: _v1Hash, ...unchanged } = base;
  const plan = { ...unchanged, version: 2 as const, setup: archive.identity, outputBlockId, deliverableId, events };
  return freeze({ ...plan, draftHash: await digest(plan) });
}

/** Fresh-only candidate. No absence check, retention, commit or execution occurs. */
export async function buildShortStorySetupV2(ownerInput: unknown, requestInput: unknown, baseReleaseInput: unknown, approvedIdentityInput: unknown): Promise<ShortStorySetupV2Plan> {
  const ownerId = owner(ownerInput), request = capture(requestInput), release = capture(baseReleaseInput), approved = capture(approvedIdentityInput);
  return buildCaptured(ownerId, request, release, approved, true);
}
async function decodeCaptured(ownerId: string, planValue: Json, approved: Json, expectedValue: Json): Promise<ShortStorySetupV2Plan> {
  const expected = exact(expectedValue, ["intentId", "draftId", "draftHash", "projectId", "documentId", "setupHash"]);
  check(isIntentId(expected.intentId) && typeof expected.draftId === "string" && /^experience-draft-[a-f0-9]{64}$/u.test(expected.draftId)
    && typeof expected.draftHash === "string" && sha256.test(expected.draftHash) && typeof expected.setupHash === "string" && sha256.test(expected.setupHash)
    && typeof expected.projectId === "string" && uuid.test(expected.projectId) && typeof expected.documentId === "string" && uuid.test(expected.documentId));
  const plan = exact(planValue, ["version", "draftId", "request", "release", "streamId", "projectId", "documentId", "title", "events", "draftHash", "setup", "outputBlockId", "deliverableId"]);
  check(plan.version === 2 && record(plan.request) && plan.request.intentId === expected.intentId && record(plan.setup) && plan.setup.setupHash === expected.setupHash);
  for (const key of ["draftId", "draftHash", "projectId", "documentId"]) check(plan[key] === expected[key]);
  const reconstructed = await buildCaptured(ownerId, plan.request!, plan.release!, approved, false);
  check(canonicalJson(plan) === canonicalJson(reconstructed)); return reconstructed;
}
/** Only the closed archived V2 grammar; never upgrades V1 or resolves current registration. */
export async function decodeShortStorySetupV2(ownerInput: unknown, planInput: unknown, approvedIdentityInput: unknown, expectedRetainedIdentityInput: unknown): Promise<ShortStorySetupV2Plan> {
  const ownerId = owner(ownerInput), plan = capture(planInput), approved = capture(approvedIdentityInput), expected = capture(expectedRetainedIdentityInput);
  return decodeCaptured(ownerId, plan, approved, expected);
}
function timestamp(value: Json | undefined): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const time = Date.parse(value); return Number.isFinite(time) && new Date(time).toISOString() === value;
}
/**
 * Prospective complete-response shape only, not server receipt/custody proof.
 * No synthetic timestamp/ID is generated and no partial batch is repaired.
 */
export async function decodeShortStorySetupV2Receipt(ownerInput: unknown, retainedPlanInput: unknown, receiptInput: unknown, approvedIdentityInput: unknown, expectedRetainedIdentityInput: unknown): Promise<ShortStorySetupV2Receipt> {
  const ownerId = owner(ownerInput), retainedPlan = capture(retainedPlanInput), receiptValue = capture(receiptInput), approved = capture(approvedIdentityInput), expected = capture(expectedRetainedIdentityInput);
  const receipt = exact(receiptValue, ["status", "projectId", "documentId", "appended", "rejected", "head", "draftId", "draftHash", "generation", "documentRoute"]);
  const plan = await decodeCaptured(ownerId, retainedPlan, approved, expected);
  check(receipt.status === "complete" && receipt.generation === "unavailable" && receipt.projectId === plan.projectId && receipt.documentId === plan.documentId
    && receipt.draftId === plan.draftId && receipt.draftHash === plan.draftHash && receipt.documentRoute === route(plan.documentId)
    && Array.isArray(receipt.rejected) && receipt.rejected.length === 0 && Number.isSafeInteger(receipt.head)
    && Array.isArray(receipt.appended) && receipt.appended.length === plan.events.length);
  const seen = new Set<string>();
  let previousSequence = 0;
  for (const [index, value] of receipt.appended.entries()) {
    const event = exact(value, ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId", "correlationId", "causationId", "compensatesEventId", "schemaVersion", "type", "payload"]);
    check(typeof event.eventId === "string" && uuid.test(event.eventId) && !seen.has(event.eventId) && event.actor === "user" && event.streamId === plan.streamId
      && event.clientId === "web:experience-intake" && event.correlationId === "experience-intake:" + plan.projectId
      && event.schemaVersion === 1 && event.causationId === null && event.compensatesEventId === null
      && timestamp(event.occurredAt) && timestamp(event.recordedAt) && Number.isSafeInteger(event.sequence) && Number(event.sequence) >= 1
      && (index === 0 || event.sequence === previousSequence + 1) && event.type === plan.events[index]!.type
      && canonicalJson(event.payload) === canonicalJson(plan.events[index]!.payload));
    seen.add(event.eventId); previousSequence = Number(event.sequence);
  }
  check(Number(receipt.head) >= previousSequence);
  return freeze(receipt) as unknown as ShortStorySetupV2Receipt;
}
