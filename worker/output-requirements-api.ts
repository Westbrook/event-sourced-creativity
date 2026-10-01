import { foldEvents, type CreativeEvent, type CreativeProjection } from "../src/model/events.ts";
import { inspectOutputRequirement, parseOutputRequirement, outputCountSatisfies, outputRequirementInterpretationNeedsReview, validateOutputCountPolicy, type OutputCountPolicy, type OutputQuantity, type OutputRequirementSpec } from "../src/model/output-requirements.ts";
import { compileOutputPlan, summarizeOutputPlan, type OutputPlan, type OutputPlanTarget, type OutputTargetState } from "../src/model/output-plan.ts";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES, MAX_OUTPUT_MODEL3D_ASSET_BYTES, validOutputAssetName, type OutputAssetInspection } from "../src/model/output-asset-inspection.ts";
import { createOutputDeliveryArchive, createOutputDeliveryArchiveStream, outputDeliveryScopeForPlan, planOutputDeliveryParts, type OutputDeliveryManifestInput, type OutputDeliveryScopeInput, type OutputDeliveryPart, type OutputDeliveryScopeAmendmentInput } from "../src/model/output-delivery-archive.ts";
import { OUTPUT_PREFLIGHT_TARGET_MAX_COUNT } from "../src/model/output-delivery-contract.ts";
import type { OutputAssetRow, OutputCommandResponse, OutputConfirmedPlan, OutputConfirmationOptions, OutputPlanSuggestions, OutputNativeTargetPreflight, OutputPreflight, OutputRequirementRow, OutputRequirementsSnapshot, OutputResultRow } from "../src/model/output-delivery-contract.ts";
import { outputScopeAmendmentReasonIssue } from "../src/model/output-scope-amendment.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority.ts";
import { captureOutputGovernanceAssertions } from "./output-requirement-governance-assertions.ts";
import { issueOutputGovernanceWitness, type OutputGovernanceWitness } from "./output-governance-witness.ts";
import { claimOutputAssetStorage, acknowledgeOutputAssetStorage, cleanupOutputAssetStorage, outputAssetPublicationAssertion, outputAssetPublicationStatements } from "./output-asset-storage-control.ts";
import { outputAssetDocumentPrefix, outputAssetObjectKeys, outputAssetStorageCustodyMatches } from "./output-asset-storage-identity.ts";
import { verifyOutputSourceEvidence, outputExtractedSourceReferences, type OutputSourceEvidenceCheck } from "./output-source-evidence-capacity.ts";
import { hasCapability, requireConsent, requireUser, type PilotUser } from "./pilot-policy.ts";
import { readProjectRequestContext, prepareProjectSourceEventsStatement, projectSourceProjectionCurrentAssertion, projectSourceProjectionPublicationAssertion, type ProjectRequestContext } from "./project-access.ts";
import { readEvents, serializeEvent, streamHead, uuidV7, type EventRow, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";
import { commitOutputCommand, ensureOutputRequirementsSchema, outputAssertionStatements, outputScopeAuthority, outputSourceEpochAssertion, outputRevision, parseOutputRevision, OutputConflictError, readOutputCommand, outputSlotFromRow,
  retainedOutputBodyAssertions, rememberOutputPrivateBody, resetRetainedOutputPrivateBodies, inheritRetainedOutputPrivateBodies, outputCommandReceiptAssertion,
  type OutputCommandReceipt, type OutputCommandPermission, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion, type OutputCommandWrite } from "./output-requirements-ledger.ts";

import { readOutputReadModel, outputBulkDeliveryAssertion, outputAssetReadAssertions, MAX_OUTPUT_DELIVERY_PART_READS, type OutputReadModel, type OutputBulkAssetEvidence } from "./output-requirements-read-model.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { OutputEventExecution } from "./output-execution-control.ts";

const BASE = "/api/output-requirements";
const RESOLVER_VERSION = "output-plan-v1";
const VALIDATION_POLICY = "output-owned-file-v1";
const MAX_COMMAND_BYTES = 512_000;
// These are verification limits, never changes to the authored source scope.
// Native and owned-file limits retain measured request headroom for their complete routes.
const OUTPUT_OWNED_SOURCE_OBJECT_CAPACITY = 4;
const OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY = 1;
const OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT = 2;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const nowIso = () => new Date().toISOString();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const outputJsonValue = (value: unknown) => typeof record(value).error === "string" ? { ...record(value), errorCode: record(value).error, errorValues: record(record(value).errorValues) } : value;
const json = (value: unknown, status = 200) => Response.json(outputJsonValue(value), { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
function fail(code: string, status = 400): never { throw new OutputConflictError(code, status); }
const identifier = (value: unknown, code = "invalid_identifier") => typeof value === "string" && idPattern.test(value) ? value : fail(code);
const ownedBuffer = (bytes: Uint8Array): ArrayBuffer => { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return copy.buffer; };
/** Internal model bytes are privately owned for this request; avoid a second 64 MiB allocation. */
const assetBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.byteLength > MAX_OUTPUT_ASSET_BYTES && bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : ownedBuffer(bytes);

export function canonicalOutputJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalOutputJson).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalOutputJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export async function outputDigest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalOutputJson(value)))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type OutputTrustedContext = {
  request: Request; env: WorkerEnv; scope: OutputScope; principal: PilotUser; projectContext: ProjectRequestContext | null;
  events: CreativeEvent[]; projection: CreativeProjection; ownerHead: number; projectHead: number;
  requirements: OutputRequirementRow[]; requirementsDigest: string; sourceDigest: string;
  context: ReturnType<typeof authoritativeCreativeContext> | null; sourceProblems: string[];
  sourceAssertions: OutputSqlAssertion[];
  sourcePrivateCaptured: boolean;
  sourceEvidence: OutputSourceEvidenceCheck;
  governanceWitness?: OutputGovernanceWitness;
};
export type OutputBridgeTargetInput = {
  request: Request; env: WorkerEnv; scope: OutputScope; principal: PilotUser;
  confirmedPlan: OutputConfirmedPlan; target: OutputPlanTarget;
  context: ReturnType<typeof authoritativeCreativeContext>;
  /** Already authorized source events for read-only reference rights verification. */
  sourceEvents?: readonly CreativeEvent[];
  sourceDigest: string; requirementsDigest: string;
};
export type OutputPreparedAdmission = {
  /** Retained source proofs run before command events in the same admission transaction. */
  sourceAssertions?: OutputSqlAssertion[];
  /** Existing queue-anchor events, known before transaction allocation. No creative text in public envelopes. */
  events: Array<{ type: string; payload: Record<string, unknown> }>;
  /** Must be side-effect free until these statements run in the enclosing D1 batch. */
  buildStatements: (events: EventRow[]) => { statements: D1PreparedStatement[]; assertions: OutputSqlAssertion[] };
};
export interface OutputExecutionBridge {
  preflight(input: OutputBridgeTargetInput): Promise<OutputNativeTargetPreflight>;
  prepareAdmission(input: Omit<OutputBridgeTargetInput, "target"> & {
    grantId: string; preflight: OutputPreflight; slots: OutputOperationSlot[]; governanceWitness?: OutputGovernanceWitness;
  }): Promise<OutputPreparedAdmission>;
  /** May schedule existing admitted job IDs only. The runner rechecks slot/grant/current authority before every call. */
  dispatch(input: { request: Request; env: WorkerEnv; scope: OutputScope; principal: PilotUser; executionContext: WorkerExecutionContext; slots: OutputOperationSlot[] }): Promise<void>;
  /** Resolve only a successful authorized ordinary/native result. Rejected private drafts are never candidates. */
  resolveResult?(input: OutputBridgeTargetInput & { nativeJobId: string }): Promise<{ bytes: Uint8Array; name: string; origin: Record<string, unknown>; assertions: OutputSqlAssertion[] }>;
  cleanupExpiredOrRevoked?(input: { request: Request; env: WorkerEnv; scope: OutputScope; principal: PilotUser; slots: OutputOperationSlot[] }): Promise<void>;
}

export { retainedOutputBodyAssertions, rememberOutputPrivateBody } from "./output-requirements-ledger.ts";
async function captureOutputPrivateSources(env: WorkerEnv, scope: OutputScope, events: CreativeEvent[], projection: CreativeProjection, expectedHead?: number, readAssertions: OutputSqlAssertion[] = []) {
  const pins = projection.outputs.filter((output) => output.pinned);
  const identifiers = [...new Set([...projection.blocks.flatMap((block) => block.sourceEvents), ...projection.blockRelations.flatMap((relation) => relation.sourceEvents),
    ...(projection.documents.find((document) => document.id === scope.documentId)?.sourceEvents ?? []), ...pins.map((output) => output.sourceEventId)])].filter(Boolean);
  const bodyStatement = env.DB.prepare("SELECT private_event_id,private_json,project_id,document_id FROM event_private_payloads WHERE owner_id=? AND private_event_id IN(SELECT value FROM json_each(?)) AND redacted_at IS NULL")
    .bind(scope.ownerUserId, JSON.stringify(identifiers));
  const results = expectedHead === undefined ? [await bodyStatement.all<Record<string, unknown>>()] : await env.DB.batch<Record<string, unknown>>([
    bodyStatement, env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(`creative:${scope.ownerUserId}`),
    ...outputProofReadStatements(env, readAssertions),
  ]);
  if (expectedHead !== undefined && Number(results[1]?.results[0]?.head ?? -1) !== expectedHead) fail("output_revision_or_authority_changed", 409);
  if (expectedHead !== undefined) assertOutputProofRead(results.slice(2), readAssertions.length);
  const rows = results[0].results as Array<{ private_event_id: string; private_json: string; project_id: string | null; document_id: string | null }>;
  if (rows.length !== identifiers.length) fail("output_source_private_evidence_unavailable", 409);
  const captured: Array<{ eventId: string; raw: string; projectId: string | null; documentId: string | null }> = [];
  for (const row of rows) {
    const previous = events.find((event) => event.eventId === row.private_event_id);
    if (!previous || canonicalOutputJson(JSON.parse(row.private_json)) !== canonicalOutputJson(previous.payload)) fail("output_source_changed_during_read", 409);
    if (row.project_id !== (String(previous.payload.project_id ?? "") || null) || row.document_id !== (String(previous.payload.document_id ?? "") || null)) fail("output_source_private_evidence_unavailable", 410);
    captured.push({ eventId: row.private_event_id, raw: row.private_json, projectId: row.project_id, documentId: row.document_id });
  }
  resetRetainedOutputPrivateBodies(scope);
  for (const evidence of captured) rememberOutputPrivateBody(scope, evidence.eventId, evidence.raw, evidence);
  return retainedOutputBodyAssertions(scope);
}

/** Keep each proof statement within D1 limits; never combine all bindings into one expression. */
function outputProofReadStatements(env: WorkerEnv, assertions: readonly OutputSqlAssertion[]) {
  const encoder = new TextEncoder();
  return assertions.map((assertion) => {
    const sql = `SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`;
    const bindings = assertion.bindings ?? [];
    if (encoder.encode(sql).byteLength > 100_000 || bindings.length > 100 || bindings.some((value) => typeof value === "string" && encoder.encode(value).byteLength > 2_000_000)) fail("output_source_proof_too_large", 413);
    return env.DB.prepare(sql).bind(...bindings);
  });
}
function assertOutputProofRead(results: Array<D1Result<Record<string, unknown>>>, expected: number) {
  if (results.length !== expected) fail("output_source_changed_during_read", 409);
  for (let index = 0; index < expected; index++) {
    const result = results[index];
    if (!result || result.success !== true || Number(result.results?.[0]?.current) !== 1) fail("output_source_changed_during_read", 409);
  }
}
/** Internal worker reads only: statements are fixed by trusted callers, never
 * supplied by an HTTP request or an LLM. Proofs and retained reads share a batch. */
export async function readOutputProofBatch(env: WorkerEnv, assertions: readonly OutputSqlAssertion[], reads: readonly D1PreparedStatement[] = []): Promise<D1Result<Record<string, unknown>>[]> {
  const proofs = outputProofReadStatements(env, assertions), proofCount = proofs.length;
  const statements = [...proofs, ...reads], expected = statements.length;
  const results = await env.DB.batch<Record<string, unknown>>(statements);
  if (results.length !== expected || statements.some((_, index) => !results[index] || results[index].success !== true)) fail("output_source_changed_during_read", 409);
  assertOutputProofRead(results.slice(0, proofCount), proofCount);
  return results.slice(proofCount);
}
async function verifyOutputSourceRead(env: WorkerEnv, scope: OutputScope, expectedHead: number, assertions: readonly OutputSqlAssertion[]) {
  const [head, ...checked] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(`creative:${scope.ownerUserId}`),
    ...outputProofReadStatements(env, assertions),
  ]);
  if (Number(head?.results[0]?.head ?? -1) !== expectedHead) fail("output_revision_or_authority_changed", 409);
  assertOutputProofRead(checked, assertions.length);
}

async function outputSourceDigests(projection: CreativeProjection, requirements: OutputRequirementRow[], documentId: string, projectId: string, context: ReturnType<typeof authoritativeCreativeContext> | null) {
  const document = projection.documents.find((candidate) => candidate.id === documentId);
  return {
    sourceDigest: await outputDigest({ version: 3, documentId, projectId,
      document: document ? { id: document.id, projectId: document.projectId, title: document.title, handle: document.handle, removed: document.removed } : null,
      context: context ? { snapshot: context.snapshot, sourceBlockVersions: context.sourceBlockVersions } : null,
      pinnedResults: projection.outputs.filter((output) => output.pinned),
      blocks: projection.blocks.filter((block) => !block.removed).map((block) => ({ id: block.id, type: block.type, properties: block.properties, sourceEvents: block.sourceEvents, locked: block.locked, position: block.position })),
      relations: projection.blockRelations.filter((relation) => !relation.removed) }),
    requirementsDigest: await outputDigest(requirements.map((row) => ({ blockId: row.blockId, content: row.content, subtype: row.subtype, stored: row.preserved, status: row.status, planSuggestions: row.planSuggestions }))),
  };
}

function outputRequirements(projection: CreativeProjection): OutputRequirementRow[] {
  return projection.blocks.filter((block) => String(block.type).toLowerCase() === "output" && !block.removed).map((block) => {
    const content = String(block.properties.text ?? block.properties.content ?? "");
    const subtype = String(block.properties.subtype ?? block.handle ?? "Output");
    if (block.properties.output_spec !== undefined) {
      const inspected = inspectOutputRequirement(block.properties.output_spec);
      return { blockId: block.id, subtype, content, locked: block.locked, status: inspected.status, spec: inspected.spec, preserved: inspected.preserved, issues: inspected.issues, planSuggestions: normalizePlanSuggestions(inspected.spec, block.properties.output_plan_suggestions, false) };
    }
    const draft = parseOutputRequirement({ id: block.id, type: "output", subtype, content });
    return { blockId: block.id, subtype, content, locked: block.locked, status: "draft", spec: draft.spec, preserved: { type: "output", subtype, content }, issues: draft.issues, planSuggestions: normalizePlanSuggestions(draft.spec, block.properties.output_plan_suggestions, false) };
  });
}

/** Planning proposals belong to one authored requirement and never grant dispatch. */
function normalizePlanSuggestions(spec: OutputRequirementSpec | null, value: unknown, strict: boolean): OutputPlanSuggestions {
  const input = record(value), policies: Record<string, OutputCountPolicy> = {}, suggestions: Record<string, number> = {};
  const reject = () => { if (strict) fail("invalid_output_plan_suggestions"); };
  if (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(input).some((key) => !["count_policies", "suggested_counts"].includes(key)))) reject();
  const quantities = new Map<string, OutputQuantity[]>(), content = new Map<string, OutputQuantity>();
  for (const deliverable of spec?.deliverables ?? []) {
    const rows = [...(deliverable.format_variants ?? []), ...(deliverable.series?.members ?? [])];
    const subjects = [{ id: deliverable.id, quantity: deliverable.quantity }, ...rows, ...(deliverable.series?.state === "unresolved" ? [{ id: `${deliverable.id}:membership`, quantity: deliverable.quantity }] : [])];
    for (const subject of subjects) {
      const values = [subject.quantity, ...(deliverable.content_quantity ? [deliverable.content_quantity] : [])];
      quantities.set(subject.id, values);
      for (const quantity of values) quantities.set(`${subject.id}:${quantity.unit}`, [quantity]);
      if (deliverable.content_quantity) content.set(subject.id, deliverable.content_quantity);
    }
  }
  for (const key of ["count_policies", "suggested_counts"] as const) if (input[key] !== undefined && (input[key] === null || typeof input[key] !== "object" || Array.isArray(input[key]) || Object.keys(record(input[key])).length > 1000)) reject();
  for (const [key, unknownPolicy] of Object.entries(record(input.count_policies)).slice(0, 1000)) {
    const policy = record(unknownPolicy) as OutputCountPolicy;
    const applicable = quantities.get(key)?.filter((quantity) => quantity.unit === policy.unit);
    if (!applicable?.length || !["exact", "flexible"].includes(policy.kind) || Object.keys(policy).some((field) => !(policy.kind === "exact" ? ["kind", "unit", "value"] : ["kind", "unit", "min", "max", "aim"]).includes(field)) || applicable.some((quantity) => validateOutputCountPolicy(quantity, policy).length)) { reject(); continue; }
    policies[key] = structuredClone(policy);
  }
  for (const [key, proposed] of Object.entries(record(input.suggested_counts)).slice(0, 1000)) {
    const quantity = content.get(key);
    if (!quantity || typeof proposed !== "number" || !Number.isFinite(proposed) || proposed <= 0 || proposed > Number.MAX_SAFE_INTEGER || quantity.unit !== "second" && !Number.isSafeInteger(proposed) || quantity.kind === "exact" && proposed !== quantity.value || quantity.kind === "range" && (proposed < quantity.min || proposed > quantity.max)) { reject(); continue; }
    suggestions[key] = proposed;
  }
  return { count_policies: policies, suggested_counts: suggestions };
}

/** Reads the existing project projection without repairing or reactivating it. */
async function readOutputProjectSourceSnapshot(env: WorkerEnv, scope: OutputScope, permission: OutputCommandPermission) {
  if (scope.kind !== "project" || !scope.organizationId || !scope.projectAccessId) fail("invalid_output_scope", 403);
  const project = { organizationId: scope.organizationId, projectAccessId: scope.projectAccessId, projectId: scope.projectId, ownerUserId: scope.ownerUserId };
  const authority = outputScopeAuthority(scope, permission), projection = projectSourceProjectionCurrentAssertion(project);
  const [metadata, source] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT CASE WHEN (${authority.sql}) THEN 1 ELSE 0 END AS permitted,CASE WHEN (${projection.sql}) THEN 1 ELSE 0 END AS projection_current,
      (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS owner_head,
      (SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=?) AS project_head`)
      .bind(...(authority.bindings ?? []), ...projection.bindings, `creative:${scope.ownerUserId}`, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId),
    prepareProjectSourceEventsStatement(env, project),
  ]);
  const row = metadata.results[0];
  if (!Number(row?.permitted)) fail("output_execution_authority_revoked", 403);
  if (!Number(row?.projection_current)) fail("output_target_source_projection_stale", 409);
  const publicationAssertion = projectSourceProjectionPublicationAssertion(project);
  return { head: Number(row.owner_head), projectHead: Number(row.project_head), events: source.results.map(serializeEvent), assertion: projection as OutputSqlAssertion, publicationAssertion };
}

/** Read the real selected project; no owner-account fallback for a governed Document. */
export async function loadOutputTrustedContext(request: Request, env: WorkerEnv, documentId: string, permission: OutputCommandPermission = "read"): Promise<OutputTrustedContext | Response> {
  identifier(documentId, "document_id_required");
  const auth = await requireUser(request, env, "viewer", { account: "principal" });
  if (auth.response || !auth.user) return auth.response ?? json({ error: "authentication_required" }, 401);
  const principal = auth.user, consent = requireConsent(principal);
  if (consent) return consent;
  const selected = await readProjectRequestContext(request, env, principal);
  if (selected.response) return selected.response;
  const selectedContext = selected.context;
  const owner = selectedContext?.ownerUserId ?? principal.userId;
  const selectedScope: OutputScope | null = selectedContext ? { kind: "project", key: `project:${selectedContext.organizationId}:${selectedContext.projectAccessId}`,
    actorUserId: principal.userId, ownerUserId: owner, documentId, projectId: selectedContext.projectId,
    organizationId: selectedContext.organizationId, projectAccessId: selectedContext.projectAccessId, contextId: selectedContext.contextId } : null;
  const projectSource = selectedScope ? await readOutputProjectSourceSnapshot(env, selectedScope, permission) : null;
  const head = projectSource?.head ?? await streamHead(env, `creative:${owner}`);
  const events = projectSource?.events ?? await readEvents(env, principal.streamId);
  const initial = foldEvents(events, Number.POSITIVE_INFINITY, documentId, selectedContext?.projectId ?? "");
  const document = initial.documents.find((candidate) => candidate.id === documentId && !candidate.removed);
  if (!document || selectedContext && document.projectId !== selectedContext.projectId) return json({ error: "document_not_found" }, 404);
  if (!selectedContext) {
    const governed = await env.DB.prepare("SELECT 1 AS present FROM organization_projects WHERE owner_user_id=? AND project_id=? LIMIT 1").bind(owner, document.projectId).first();
    if (governed) return json({ error: "project_context_required", message: "Open this Document in its authorized shared project before using Outputs." }, 403);
  }
  const scope: OutputScope = selectedScope ?? { kind: "personal", key: `personal:${owner}:${document.projectId}`,
    actorUserId: principal.userId, ownerUserId: owner, documentId, projectId: document.projectId,
    organizationId: null, projectAccessId: null, contextId: null };
  const capabilityScope = selectedContext ? { organizationId: selectedContext.organizationId, projectAccessId: selectedContext.projectAccessId } : undefined;
  const required = permission === "author" ? "project.author" : permission === "request" ? "project.output.request" : permission === "review" && selectedContext ? "project.review.approve" : permission === "review" ? "project.author" : "project.read";
  if (selectedContext ? !hasCapability(principal, required, capabilityScope) : permission !== "read" && !["creator", "admin"].includes(principal.role)) return json({ error: "output_action_not_authorized" }, 403);
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, documentId, document.projectId);
  const requirements = outputRequirements(projection);
  // A complete Document binding is intentionally conservative; no selective-dependency claims.
  let context: ReturnType<typeof authoritativeCreativeContext> | null = null;
  const sourceProblems: string[] = [];
  try { context = authoritativeCreativeContext(events, { documentId, projectId: document.projectId }); }
  catch (error) { if (error instanceof ContextIntegrityError) sourceProblems.push(error.code); else throw error; }
  const { sourceDigest, requirementsDigest } = await outputSourceDigests(projection, requirements, documentId, document.projectId, context);
  const sourceAssertions: OutputSqlAssertion[] = projectSource ? [projectSource.assertion] : [];
  let sourcePrivateCaptured = false;
  try { sourceAssertions.push(...await captureOutputPrivateSources(env, scope, events, projection)); sourcePrivateCaptured = true; }
  catch (error) { if (error instanceof OutputConflictError) sourceProblems.push(error.code); else throw error; }
  let governanceAssertions: OutputSqlAssertion[] = [];
  if (selectedContext) try {
    governanceAssertions = await captureOutputGovernanceAssertions(env, selectedContext.organizationId, projection.blocks, { deferValidation: true, maximumCaptureBatches: OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT });
  } catch (error) { if (error instanceof OutputConflictError) sourceProblems.push(error.code); else throw error; }
  const sourceEvidence = await verifyOutputSourceEvidence(env, owner, projection.blocks, { maximumDistinctObjects: permission === "request" ? OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY : OUTPUT_OWNED_SOURCE_OBJECT_CAPACITY });
  if (sourceEvidence.reasonCode) sourceProblems.push(sourceEvidence.reasonCode);
  // The complete governance proof includes the former generic rights predicate,
  // immutable lineage and current permissions. Validate once with the final head,
  // then retain these exact same guards for every consequential transaction.
  await verifyOutputSourceRead(env, scope, head, [outputScopeAuthority(scope, permission), ...sourceAssertions, ...governanceAssertions]);
  sourceAssertions.push(...governanceAssertions);
  const governanceWitness = selectedContext && context && !sourceProblems.length ? issueOutputGovernanceWitness({ request, env,
    actorUserId: scope.actorUserId, ownerUserId: scope.ownerUserId, organizationId: selectedContext.organizationId,
    projectAccessId: selectedContext.projectAccessId, projectId: scope.projectId, documentId: scope.documentId, contextId: selectedContext.contextId,
    sourceDigest, contextSnapshotDigest: await outputDigest(context.snapshot) }, governanceAssertions) : undefined;
  return { request, env, scope, principal, projectContext: selectedContext, events, projection, ownerHead: head, projectHead: projectSource?.projectHead ?? 0, requirements, requirementsDigest, sourceDigest, context, sourceProblems, sourceAssertions, sourcePrivateCaptured, sourceEvidence, governanceWitness };
}

const sourceDeadlinePrepared = new WeakSet<OutputTrustedContext>();
/** Only active facts from the existing authorized context supply this deadline. */
export function outputActiveSourceDeadlineAssertions(context: ReturnType<typeof authoritativeCreativeContext>): OutputSqlAssertion[] {
  let earliest = Number.POSITIVE_INFINITY;
  for (const fact of context.snapshot.facts) {
    if (fact.active === false) continue;
    const properties = record(fact.properties);
    for (const field of ["source_expires_at", "license_expires_at", "rights_expires_at"] as const) {
      const value = properties[field];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string" || !Number.isSafeInteger(Date.parse(value))) fail("context_source_rights_expired", 409);
      earliest = Math.min(earliest, Date.parse(value));
    }
  }
  return Number.isFinite(earliest) ? [{ sql: "(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))<?", bindings: [earliest], deadlineMs: earliest }] : [];
}

function requireCurrentSource(trusted: OutputTrustedContext) {
  if (!trusted.context || trusted.sourceProblems.length) fail(trusted.sourceProblems[0] ?? "source_context_unavailable", 409);
  if (!sourceDeadlinePrepared.has(trusted)) {
    trusted.sourceAssertions.push(...outputActiveSourceDeadlineAssertions(trusted.context));
    sourceDeadlinePrepared.add(trusted);
  }
  return trusted.context;
}

function outputSourceNames(blocks: CreativeProjection["blocks"]) {
  const sources: Array<{ blockId: string; label: string }> = [];
  let sourcesComplete = blocks.length <= 32;
  for (const block of blocks.slice(0, 32)) {
    if (!idPattern.test(block.id)) { sourcesComplete = false; continue; }
    const authored = [block.properties.label, block.properties.title, block.handle].find((value) => typeof value === "string" && value.trim());
    const display = (typeof authored === "string" ? authored : "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
    const characters = [...display];
    if (characters.length > 120) sourcesComplete = false;
    sources.push({ blockId: block.id, label: characters.slice(0, 120).join("") });
  }
  return { sources, sourcesComplete };
}
function sourceCapacityDisclosure(trusted: OutputTrustedContext): OutputRequirementsSnapshot["sourceVerification"]["capacity"] {
  return { referenceCount: trusted.sourceEvidence.referenceCount, distinctObjectCount: trusted.sourceEvidence.distinctObjectCount,
    countsComplete: trusted.sourceEvidence.countsComplete, ownedReadLimit: OUTPUT_OWNED_SOURCE_OBJECT_CAPACITY, nativeLimit: OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY,
    ...outputSourceNames(outputExtractedSourceReferences(trusted.projection.blocks)) };
}
function sourceGovernanceDisclosure(trusted: OutputTrustedContext): OutputRequirementsSnapshot["sourceVerification"]["governance"] {
  if (trusted.scope.kind !== "project") return undefined;
  const fields = ["organization_context_package_id", "organization_context_package_version_id", "organization_context_package_binding_id", "organization_context_source_block_id"];
  const blocks = trusted.projection.blocks.filter((block) => fields.some((field) => block.properties[field] !== undefined && block.properties[field] !== null && block.properties[field] !== ""));
  // Names come only from the current authorized Document projection, never the
  // live origin rows traversed by the governance proof.
  return { captureBatchLimit: OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT, ...outputSourceNames(blocks) };
}

async function privateEventBody(env: WorkerEnv, scope: OutputScope, eventId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=? AND redacted_at IS NULL")
    .bind(eventId, scope.ownerUserId, scope.projectId, scope.documentId).first<{ private_json: string }>();
  if (!row) fail("output_private_evidence_unavailable", 410);
  return rememberOutputPrivateBody(scope, eventId, row.private_json);
}

export function outputReviewEligibility(scope: OutputScope, principal: PilotUser, resultCreatedByUserId: string, assetCreatedByUserId: string | null, origin: Record<string, unknown> | null) {
  const canReview = scope.kind === "project" ? hasCapability(principal, "project.review.approve", { organizationId: scope.organizationId!, projectAccessId: scope.projectAccessId! }) : ["creator", "admin"].includes(principal.role);
  const nativeContributorUnknown = origin?.kind === "native_job" && (typeof origin.createdByUserId !== "string" || !origin.createdByUserId);
  const contributors = [resultCreatedByUserId, assetCreatedByUserId, origin?.createdByUserId, ...(Array.isArray(origin?.editedByUserIds) ? origin.editedByUserIds : [])];
  const independentReviewBlocked = scope.kind === "project" && (!assetCreatedByUserId || !origin || Boolean(nativeContributorUnknown) || contributors.includes(scope.actorUserId));
  return { reviewAllowed: canReview && Boolean(assetCreatedByUserId && origin) && !independentReviewBlocked, independentReviewBlocked };
}

async function readConfirmedPlan(trusted: OutputTrustedContext, requestedId?: string): Promise<OutputConfirmedPlan | null> {
  const row = await trusted.env.DB.prepare(`SELECT * FROM output_plan_revisions WHERE scope_key=? AND document_id=? ${requestedId ? "AND plan_revision_id=?" : ""} ORDER BY revision DESC LIMIT 1`)
    .bind(trusted.scope.key, trusted.scope.documentId, ...(requestedId ? [requestedId] : [])).first<Record<string, unknown>>();
  if (!row) return null;
  const body = await privateEventBody(trusted.env, trusted.scope, String(row.confirmed_event_id));
  const stored = record(body.confirmed_plan);
  if (!stored.plan || stored.revisionId !== row.plan_revision_id || stored.sourceDigest !== row.source_digest || stored.requirementsDigest !== row.requirements_digest) fail("output_plan_evidence_mismatch", 409);
  return stored as OutputConfirmedPlan;
}

function currentPlan(trusted: OutputTrustedContext, plan: OutputConfirmedPlan | null): OutputConfirmedPlan {
  if (!plan) fail("confirmed_output_plan_required", 409);
  if (plan.requirementsDigest !== trusted.requirementsDigest || plan.sourceDigest !== trusted.sourceDigest) fail("output_plan_needs_reconfirmation", 409);
  return plan;
}

export async function outputTargetContractDigest(target: OutputPlanTarget, sourceDigest: string) {
  const { selected: _selected, ordinal: _ordinal, label: _label, requirement_revision: _requirementRevision, suggested_count: _suggestedCount, source_revision: _sourceRevision, ...contract } = target;
  return outputDigest({ policy: VALIDATION_POLICY, sourceDigest, contract });
}

const outputReadModels = new WeakMap<OutputTrustedContext, Promise<OutputReadModel>>();
function readOutputModel(trusted: OutputTrustedContext) {
  let pending = outputReadModels.get(trusted);
  if (!pending) {
    pending = readOutputReadModel(trusted.env, trusted.scope, trusted.events, {
      rememberPrivateBody: (id, raw) => rememberOutputPrivateBody(trusted.scope, id, raw),
      reviewEligibility: (resultAuthor, assetAuthor, origin) => outputReviewEligibility(trusted.scope, trusted.principal, resultAuthor, assetAuthor, origin),
      storagePrefixes: () => [outputAssetDocumentPrefix(trusted.scope)],
      legacyStorageKeys: (rows) => rows.flatMap((row) => {
        const extension = /\.([a-z0-9]+)$/u.exec(String(row.storage_key))?.[1];
        if (!extension) return [];
        try { const legacy = outputAssetObjectKeys(trusted.scope, String(row.asset_id), String(row.content_sha256), extension).legacyKey; return legacy && row.storage_key === legacy ? [legacy] : []; }
        catch { return []; }
      }),
      storageIdentityMatches: (row, _inspection, object) => outputAssetStorageCustodyMatches({ ownerUserId: trusted.scope.ownerUserId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId, assetId: String(row.asset_id), scopeKey: trusted.scope.key, sha256: String(row.content_sha256), storageKey: String(row.storage_key) }, object.customMetadata),
    });
    outputReadModels.set(trusted, pending);
  }
  return pending;
}
function requireCompleteOutputReadModel(model: OutputReadModel) {
  if (!model.complete) fail(model.reasonCodes[0] ?? "output_read_model_unavailable", 503);
  return model;
}
async function readResults(trusted: OutputTrustedContext): Promise<OutputResultRow[]> { return (await readOutputModel(trusted)).results; }

function retainedOutputAmendments(trusted: OutputTrustedContext) {
  return trusted.events.filter((event) => event.type === "OutputPlanConfirmed" && event.payload.document_id === trusted.scope.documentId && event.payload.project_id === trusted.scope.projectId && event.payload.scope_amendment !== undefined);
}

async function buildSnapshot(trusted: OutputTrustedContext, bridge?: OutputExecutionBridge): Promise<OutputRequirementsSnapshot> {
  const model = await readOutputModel(trusted);
  const { confirmedPlan, assets, grants } = model;
  const retainedAmendments = retainedOutputAmendments(trusted);
  const historyProblems = retainedAmendments.some((event) => outputScopeAmendmentReasonIssue(record(event.payload.scope_amendment).reason, { required: true })) ? ["output_scope_history_reason_unverified"] : [];
  const qualifyPackageSummary = (summary: NonNullable<OutputRequirementsSnapshot["summary"]>): NonNullable<OutputRequirementsSnapshot["summary"]> => historyProblems.length ? {
    ...summary, delivery_ready: false,
    ...(summary.completion === "complete" ? { completion: "unknown", headline: "The retained amendment history needs investigation before packaging." } : {}),
  } : summary;
  const sourceVerification: OutputRequirementsSnapshot["sourceVerification"] = { status: trusted.sourceProblems.length ? "unavailable" : "verified", reasonCodes: [...new Set(trusted.sourceProblems)], capacity: sourceCapacityDisclosure(trusted), governance: sourceGovernanceDisclosure(trusted) };
  const results = model.results.map((result) => ({ ...result, reviewAllowed: result.reviewAllowed && model.complete && sourceVerification.status === "verified" }));
  const memberships = confirmedPlan ? model.fulfillments.get(confirmedPlan.revisionId) : undefined;
  const targetStates: OutputTargetState[] = [];
  for (const target of confirmedPlan?.plan.targets ?? []) {
    const selectedAcceptance = memberships?.get(target.id);
    const fulfillment = selectedAcceptance ? { acceptance_id: selectedAcceptance } : null;
    const accepted = fulfillment ? results.find((candidate) => candidate.acceptanceId === fulfillment.acceptance_id && candidate.review === "approved" && candidate.targetContractDigest === confirmedPlan!.targetContractDigests[target.id]) : undefined;
    const candidate = accepted ?? results.find((result) => result.targetId === target.id && result.planRevisionId === confirmedPlan!.revisionId);
    const asset = candidate && assets.find((value) => value.id === candidate.assetId && value.sha256 === candidate.sha256 && value.available);
    const slot = grants.flatMap((grant) => grant.operations).find((operation) => operation.targetId === target.id);
    const freshness = confirmedPlan!.sourceDigest === trusted.sourceDigest && confirmedPlan!.requirementsDigest === trusted.requirementsDigest && !trusted.sourceProblems.length && (!candidate || candidate.sourceDigest === trusted.sourceDigest) ? "current" : "stale";
    // A GET does not claim bytes were freshly downloaded or content was reviewed; release rechecks both.
    const availability = !model.complete ? "unknown" : asset ? "available" : candidate ? "missing" : "unknown";
    const execution: OutputTargetState["execution"] = candidate ? "succeeded" : slot && ["queued", "running", "succeeded", "failed", "cancelled", "uncertain"].includes(slot.status) ? slot.status as OutputTargetState["execution"] : "not_started";
    targetStates.push({ target_id: target.id, execution, checks: candidate ? candidate.checksStatus === "passed" ? "passed" : candidate.checksStatus === "failed" ? "failed" : "unknown" : "not_checked",
      review: accepted ? "accepted" : candidate?.review === "changes_requested" ? "rejected" : candidate ? "pending" : "not_reviewed", freshness, availability,
      capability: asset ? "supported" : "unknown", export_available: Boolean(model.complete && accepted && asset && freshness === "current"), source_revision: trusted.sourceDigest, requirement_revision: trusted.requirementsDigest, ...(candidate ? { result_id: candidate.id } : {}) });
  }
  const capScope = trusted.projectContext ? { organizationId: trusted.projectContext.organizationId, projectAccessId: trusted.projectContext.projectAccessId } : undefined;
  const canAuthor = trusted.projectContext ? hasCapability(trusted.principal, "project.author", capScope) : ["creator", "admin"].includes(trusted.principal.role), canReview = trusted.projectContext ? hasCapability(trusted.principal, "project.review.approve", capScope) : canAuthor;
  const availability = { state: !model.complete ? "unavailable" as const : confirmedPlan?.requirementsDigest === trusted.requirementsDigest && confirmedPlan?.sourceDigest === trusted.sourceDigest && !trusted.sourceProblems.length ? "ready" as const : "stale" as const, source_revision: trusted.sourceDigest, requirement_revision: trusted.requirementsDigest };
  const requirementSummaries: OutputRequirementsSnapshot["requirementSummaries"] = {};
  const requirementFileCounts: OutputRequirementsSnapshot["requirementFileCounts"] = {};
  if (confirmedPlan) for (const requirement of trusted.requirements) {
    const filtered = { ...confirmedPlan.plan, groups: confirmedPlan.plan.groups.filter((group) => group.requirement_id === requirement.blockId), obligations: confirmedPlan.plan.obligations.filter((obligation) => obligation.requirement_id === requirement.blockId), targets: confirmedPlan.plan.targets.filter((target) => target.requirement_id === requirement.blockId), unresolved_groups: confirmedPlan.plan.unresolved_groups.filter((group) => group.requirement_id === requirement.blockId) };
    requirementSummaries[requirement.blockId] = qualifyPackageSummary(summarizeOutputPlan(filtered, targetStates.filter((state) => filtered.targets.some((target) => target.id === state.target_id)), availability));
    const acceptedFiles = new Set(targetStates.filter((state) => state.export_available && filtered.targets.some((target) => target.id === state.target_id)).map((state) => results.find((result) => result.id === state.result_id)?.assetId).filter((id): id is string => Boolean(id)));
    requirementFileCounts[requirement.blockId] = requirementSummaries[requirement.blockId].scope_known ? acceptedFiles.size : null;
  }
  for (const requirement of trusted.requirements) if (!(requirement.blockId in requirementFileCounts)) requirementFileCounts[requirement.blockId] = null;
  const scopeAmendments: OutputRequirementsSnapshot["scopeAmendments"] = retainedAmendments.map((event) => {
    const amendment = record(event.payload.scope_amendment);
    return { eventId: event.eventId, previousPlanRevisionId: String(amendment.previous_plan_revision_id ?? ""), planRevisionId: String(event.payload.plan_revision_id ?? ""), actorUserId: String(event.payload.actor_user_id ?? ""), occurredAt: event.occurredAt, reason: String(amendment.reason ?? ""), withdrawnTargetIds: Array.isArray(amendment.withdrawn_target_ids) ? amendment.withdrawn_target_ids.map(String) : [], withdrawnObligationIds: Array.isArray(amendment.withdrawn_obligation_ids) ? amendment.withdrawn_obligation_ids.map(String) : [] };
  });
  return { schemaVersion: 1, documentId: trusted.scope.documentId, projectId: trusted.scope.projectId,
    scope: { kind: trusted.scope.kind, organizationId: trusted.scope.organizationId, projectAccessId: trusted.scope.projectAccessId, actorUserId: trusted.scope.actorUserId },
    revision: outputRevision(trusted.ownerHead), requirementRevision: trusted.requirementsDigest, sourceRevision: trusted.sourceDigest, sourceVerification, requirements: trusted.requirements, confirmedPlan, targetStates,
    summary: confirmedPlan ? qualifyPackageSummary(summarizeOutputPlan(confirmedPlan.plan, targetStates, availability)) : null, requirementSummaries, requirementFileCounts, scopeAmendments,
    assets, results, grants, permissions: { canAuthor: model.complete && canAuthor, canRequest: model.complete && (trusted.projectContext ? hasCapability(trusted.principal, "project.output.request", capScope) : canAuthor), canReview: model.complete && canReview, canDownload: model.complete && (trusted.projectContext ? hasCapability(trusted.principal, "project.read", capScope) : true), independentReview: trusted.scope.kind === "project" },
    capabilities: { nativeGeneration: model.complete && Boolean(bridge), ownedFileAdoption: model.complete, supportedFileExtensions: ["png", "jpg", "wav", "mp3", "mp4", "pptx", "glb"], limitations: ["Stored source and target versions are checked conservatively against the full Document.", "File inspection checks structure and measured properties; human content and rights review remains required.", ...trusted.sourceProblems, ...model.reasonCodes, ...historyProblems, ...(!bridge ? ["Native generation has no installed execution bridge."] : [])], limitationCodes: ["output_full_document_recheck", "output_inspection_requires_human_review", ...trusted.sourceProblems, ...model.reasonCodes, ...historyProblems, ...(!bridge ? ["output_native_execution_unavailable"] : [])] } };
}

/** Trusted worker-only resolver shared by admission, dispatch, provider guards and recovery. */
export async function loadOutputCurrentContext(env: WorkerEnv, scope: OutputScope) {
  const authority = outputScopeAuthority(scope, "request");
  const projectSource = scope.kind === "project" ? await readOutputProjectSourceSnapshot(env, scope, "request") : null;
  const initial = projectSource ?? await env.DB.prepare(`SELECT (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS head WHERE (${authority.sql})`)
    .bind(`creative:${scope.ownerUserId}`, ...(authority.bindings ?? [])).first<{ head: number }>();
  if (!initial) fail("output_execution_authority_revoked", 403);
  const head = Number(initial.head);
  const events = projectSource?.events ?? await readEvents(env, `creative:${scope.ownerUserId}`);
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, scope.documentId, scope.projectId);
  if (!projection.documents.some((document) => document.id === scope.documentId && document.projectId === scope.projectId && !document.removed)) fail("document_not_found", 404);
  const requirements = outputRequirements(projection);
  const context = authoritativeCreativeContext(events, { documentId: scope.documentId, projectId: scope.projectId });
  const digests = await outputSourceDigests(projection, requirements, scope.documentId, scope.projectId, context);
  const governanceAssertions = scope.organizationId ? await captureOutputGovernanceAssertions(env, scope.organizationId, projection.blocks, { deferValidation: true, maximumCaptureBatches: OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT }) : [];
  const sourceAssertion = await captureOutputPrivateSources(env, scope, events, projection, head, [authority, ...(projectSource ? [projectSource.assertion] : []), ...governanceAssertions]);
  const sourceEvidence = await verifyOutputSourceEvidence(env, scope.ownerUserId, projection.blocks, { maximumDistinctObjects: OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY });
  if (sourceEvidence.reasonCode) fail(sourceEvidence.reasonCode, 409);
  const sourceAssertions: OutputSqlAssertion[] = [...sourceAssertion, ...governanceAssertions, ...outputActiveSourceDeadlineAssertions(context), { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${scope.ownerUserId}`, head] }];
  return { ...digests, context, head, events, requirements,
    assertions: [authority, ...(projectSource ? [projectSource.assertion] : []), ...sourceAssertions],
    publicationAssertions: [authority, ...(projectSource ? [projectSource.publicationAssertion] : []), ...sourceAssertions] };
}

/** A time bound for the same currently selected request capability, not new authority. */
function outputRequestDeadlineCapture(scope: OutputScope): OutputSqlAssertion | null {
  if (scope.kind !== "project") return null;
  return { sql: `(SELECT json_array(selected.expires_at,project.owner_user_id,
      (SELECT member.role FROM project_memberships member WHERE member.project_access_id=project.project_access_id
        AND member.organization_id=project.organization_id AND member.project_id=project.project_id AND member.user_id=?
        AND member.status='active' AND member.revoked_at IS NULL),
      json((SELECT json_group_array(json_array(grant_id,expires_at)) FROM (
        SELECT grant_id,expires_at FROM capability_grants WHERE user_id=? AND capability='project.output.request'
          AND scope_type='project' AND organization_id=project.organization_id AND project_access_id=project.project_access_id
          AND status='active' AND revoked_at IS NULL ORDER BY grant_id))))
    FROM project_context_sessions selected JOIN organization_projects project
      ON project.project_access_id=selected.project_access_id AND project.organization_id=selected.organization_id
    WHERE selected.context_id=? AND selected.principal_user_id=? AND selected.project_access_id=?
      AND selected.organization_id=? AND project.project_id=? AND project.owner_user_id=?)`,
    bindings: [scope.actorUserId, scope.actorUserId, scope.contextId, scope.actorUserId, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId] };
}
function outputRequestDeadline(scope: OutputScope, raw: unknown) {
  if (scope.kind !== "project") return null;
  if (typeof raw !== "string" || raw.length > 32_768) fail("output_execution_authority_revoked", 403);
  const tuple: unknown = JSON.parse(raw);
  if (!Array.isArray(tuple) || tuple.length !== 4 || typeof tuple[0] !== "string" || !Number.isFinite(Date.parse(tuple[0]))
    || tuple[1] !== scope.ownerUserId || !Array.isArray(tuple[3]) || tuple[3].length > 128) fail("output_execution_authority_revoked", 403);
  const deadlines = tuple[3].map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string"
      || row[1] !== null && (typeof row[1] !== "string" || !Number.isFinite(Date.parse(row[1])))) fail("output_execution_authority_revoked", 403);
    return row[1] === null ? Number.POSITIVE_INFINITY : Date.parse(row[1]);
  });
  const permissionDeadline = scope.actorUserId === scope.ownerUserId || tuple[2] === "editor"
    ? Number.POSITIVE_INFINITY : Math.max(...deadlines);
  return Math.min(Date.parse(tuple[0]), permissionDeadline);
}

type OutputGrantEvidence = { row: Record<string, unknown>; confirmedPlan: OutputConfirmedPlan; preflight: OutputPreflight; slots: OutputOperationSlot[] };

/** One scoped read retains both immutable creative bodies; it never synthesizes a grant. */
async function readOutputGrantEvidence(env: WorkerEnv, scope: OutputScope, grantId: string, includeSlots = false): Promise<OutputGrantEvidence> {
  const requestDeadline = outputRequestDeadlineCapture(scope);
  const statements = [env.DB.prepare(`SELECT grant_row.*,plan.confirmed_event_id,plan.source_digest AS plan_source_digest,plan.requirements_digest AS plan_requirements_digest,
      preflight.event_id AS preflight_event_id,preflight.terms_digest,plan_body.private_json AS plan_private_json,preflight_body.private_json AS preflight_private_json,
      authorization_body.private_json AS authorization_private_json,
      ${requestDeadline?.sql ?? "NULL"} AS dispatch_scope,
      grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS deadline_current
    FROM output_execution_grants grant_row JOIN output_plan_revisions plan ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
    JOIN output_preflights preflight ON preflight.scope_key=grant_row.scope_key AND preflight.preflight_id=grant_row.preflight_id
    LEFT JOIN event_private_payloads plan_body ON plan_body.private_event_id=plan.confirmed_event_id AND plan_body.owner_id=plan.owner_user_id AND plan_body.project_id=plan.project_id AND plan_body.document_id=plan.document_id AND plan_body.redacted_at IS NULL
    LEFT JOIN event_private_payloads preflight_body ON preflight_body.private_event_id=preflight.event_id AND preflight_body.owner_id=plan.owner_user_id AND preflight_body.project_id=plan.project_id AND preflight_body.document_id=plan.document_id AND preflight_body.redacted_at IS NULL
    LEFT JOIN event_private_payloads authorization_body ON authorization_body.private_event_id=grant_row.authorization_event_id AND authorization_body.owner_id=plan.owner_user_id AND authorization_body.project_id=plan.project_id AND authorization_body.document_id=plan.document_id AND authorization_body.redacted_at IS NULL
    WHERE grant_row.scope_key=? AND grant_row.grant_id=? AND grant_row.actor_user_id=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=?`)
    .bind(...(requestDeadline?.bindings ?? []), scope.key, grantId, scope.actorUserId, scope.documentId, scope.projectId, scope.ownerUserId)];
  if (includeSlots) statements.push(env.DB.prepare(`SELECT slot.* FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    WHERE slot.scope_key=? AND slot.grant_id=? AND grant_row.actor_user_id=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=? ORDER BY slot.created_at,slot.slot_id`)
    .bind(scope.key, grantId, scope.actorUserId, scope.documentId, scope.projectId, scope.ownerUserId));
  const [grantResult, slotsResult] = await env.DB.batch<Record<string, unknown>>(statements);
  const row = grantResult.results[0];
  if (!row) fail("output_execution_grant_not_found", 404);
  if (row.context_id !== scope.contextId) fail("output_execution_context_changed", 403);
  if (typeof row.plan_private_json !== "string" || typeof row.preflight_private_json !== "string" || typeof row.authorization_private_json !== "string") fail("output_private_evidence_unavailable", 410);
  const confirmedPlan = record(rememberOutputPrivateBody(scope, String(row.confirmed_event_id), row.plan_private_json).confirmed_plan) as OutputConfirmedPlan;
  const preflight = record(rememberOutputPrivateBody(scope, String(row.preflight_event_id), row.preflight_private_json).preflight) as OutputPreflight;
  const authorization = rememberOutputPrivateBody(scope, String(row.authorization_event_id), row.authorization_private_json);
  if (confirmedPlan.id !== scope.documentId || confirmedPlan.revisionId !== row.plan_revision_id || confirmedPlan.sourceDigest !== row.plan_source_digest || confirmedPlan.requirementsDigest !== row.plan_requirements_digest
    || preflight.id !== row.preflight_id || preflight.planRevisionId !== confirmedPlan.revisionId || preflight.termsDigest !== row.terms_digest || authorization.grant_id !== row.grant_id) fail("output_execution_contract_changed", 409);
  return { row, confirmedPlan, preflight, slots: (slotsResult?.results ?? []).map((slot) => outputSlotFromRow(scope.key, slot)) };
}

async function validateOutputExecutionTarget(current: { sourceDigest: string; requirementsDigest: string }, evidence: OutputGrantEvidence, slot: OutputOperationSlot) {
  const { confirmedPlan, preflight } = evidence;
  const target = confirmedPlan.plan?.targets.find((candidate) => candidate.id === slot.targetId);
  const targetPreflight = preflight.targets?.find((candidate) => candidate.targetId === slot.targetId);
  if (evidence.row.grant_id !== slot.grantId || confirmedPlan.revisionId !== slot.planRevisionId || !target || !target.selected || target.blocking_issues.length || !targetPreflight?.available
    || current.sourceDigest !== slot.sourceDigest || confirmedPlan.sourceDigest !== current.sourceDigest || confirmedPlan.requirementsDigest !== current.requirementsDigest || confirmedPlan.targetContractDigests[target.id] !== slot.targetContractDigest
    || await outputTargetContractDigest(target, current.sourceDigest) !== slot.targetContractDigest || await outputDigest(targetPreflight) !== slot.routeDigest) fail("output_execution_contract_changed", 409);
  return { target, targetPreflight };
}

export async function resolveOutputExecutionAuthority(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot) {
  if (scope.key !== slot.scopeKey) fail("output_execution_scope_mismatch", 403);
  const current = await loadOutputCurrentContext(env, scope);
  const evidence = await readOutputGrantEvidence(env, scope, slot.grantId);
  if (!["authorized", "active"].includes(String(evidence.row.status)) || !Number(evidence.row.deadline_current)) fail("output_execution_grant_inactive", 403);
  const { target, targetPreflight } = await validateOutputExecutionTarget(current, evidence, slot);
  const grantDeadline = Date.parse(String(evidence.row.expires_at));
  if (!Number.isFinite(grantDeadline)) fail("output_execution_grant_inactive", 403);
  const requestCapture = outputRequestDeadlineCapture(scope), requestDeadline = outputRequestDeadline(scope, evidence.row.dispatch_scope);
  const deadlineAssertions: OutputSqlAssertion[] = [{ sql: "EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS ? AND expires_at=?)",
    bindings: [scope.key, slot.grantId, scope.actorUserId, scope.contextId, String(evidence.row.expires_at)], deadlineMs: grantDeadline }];
  if (requestCapture && requestDeadline !== null) deadlineAssertions.push({ sql: `${requestCapture.sql}=?`, bindings: [...(requestCapture.bindings ?? []), String(evidence.row.dispatch_scope)], deadlineMs: requestDeadline });
  const retainedAssertions = [...retainedOutputBodyAssertions(scope), ...deadlineAssertions];
  return { ...current, confirmedPlan: evidence.confirmedPlan, target, preflight: evidence.preflight, targetPreflight,
    assertions: [...current.assertions, ...retainedAssertions],
    publicationAssertions: [...current.publicationAssertions, ...retainedAssertions] };
}

export type OutputImageFinalizationPostState = { resultJson: string; completedAt: string; completionEventId: string };
export type OutputImageFinalizationAuthority = Awaited<ReturnType<typeof resolveOutputImageFinalizationAuthority>>;

/** Provider-free authority for one already-paid, fully retained Image result.
 * This purpose never changes the normal execution or acknowledgment contracts.
 * All input primitives are copied before the first await; returned assertions
 * bind the original attempt and separate pre-state from our exact post-state.
 */
export async function resolveOutputImageFinalizationAuthority(env: WorkerEnv, suppliedScope: OutputScope, suppliedSlot: OutputOperationSlot,
  suppliedJob: DocumentJobRow, payerUserId: string) {
  const scope = { ...suppliedScope }, slot = { ...suppliedSlot }, job = { ...suppliedJob }, admittedAt = nowIso();
  const maximumEvidenceBytes = 2_000_000, encoder = new TextEncoder();
  const boundedText = (value: unknown): value is string => typeof value === "string" && value.length <= maximumEvidenceBytes && encoder.encode(value).byteLength <= maximumEvidenceBytes;
  if (!boundedText(job.request_json) || !boundedText(job.result_json)) fail("output_image_finalization_evidence_too_large", 413);
  const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  let request: Record<string, unknown>, checkpoint: Record<string, unknown>;
  try { request = record(JSON.parse(job.request_json)); checkpoint = record(JSON.parse(job.result_json ?? "null")); }
  catch { return fail("output_image_finalization_evidence_invalid", 409); }
  const reference = { scopeKey: scope.key, grantId: slot.grantId, slotId: slot.slotId, planRevisionId: slot.planRevisionId,
    targetId: slot.targetId, targetContractDigest: slot.targetContractDigest, sourceDigest: slot.sourceDigest };
  if (scope.key !== slot.scopeKey || slot.jobId !== job.job_id || job.output_slot_id !== slot.slotId || job.kind !== "generate"
    || job.owner_id !== scope.actorUserId || job.stream_id !== `creative:${scope.ownerUserId}` || job.document_id !== scope.documentId
    || job.source_surface !== "outputs" || !payerUserId || !Number.isSafeInteger(job.attempt_count) || job.attempt_count < 1
    || job.correlation_id !== `${job.job_id}:attempt:${job.attempt_count}` || !iso(job.expires_at) || job.expires_at <= admittedAt
    || canonicalOutputJson(request.outputExecution) !== canonicalOutputJson(reference)
    || record(checkpoint.imageRecovery).stage !== "rendered" || ["force_failed_by_admin", "canceled_by_user"].includes(String(record(checkpoint.errorDetail).code))
    || ["force_failed_by_admin", "canceled_by_user"].includes(String(job.error_message))
    || !(job.status === "committing" && slot.status === "running" && iso(job.lease_expires_at) && job.lease_expires_at <= admittedAt
      || job.status === "failed" && slot.status === "failed" && (job.lease_expires_at === null || iso(job.lease_expires_at) && job.lease_expires_at <= admittedAt)))
    fail("output_image_finalization_ineligible", 409);

  const current = await loadOutputCurrentContext(env, scope);
  // Retain the existing scoped grant predicates and decoder for this purpose,
  // with byte ceilings before any private JSON crosses the read boundary.
  const grantRequestCapture = outputRequestDeadlineCapture(scope);
  const [grantRead] = await readOutputProofBatch(env, current.assertions, [env.DB.prepare(`SELECT grant_row.*,plan.confirmed_event_id,plan.source_digest AS plan_source_digest,plan.requirements_digest AS plan_requirements_digest,
      preflight.event_id AS preflight_event_id,preflight.terms_digest,plan_body.private_json AS plan_private_json,preflight_body.private_json AS preflight_private_json,
      authorization_body.private_json AS authorization_private_json,
      ${grantRequestCapture?.sql ?? "NULL"} AS dispatch_scope,
      grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS deadline_current
    FROM output_execution_grants grant_row JOIN output_plan_revisions plan ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
    JOIN output_preflights preflight ON preflight.scope_key=grant_row.scope_key AND preflight.preflight_id=grant_row.preflight_id
    LEFT JOIN event_private_payloads plan_body ON plan_body.private_event_id=plan.confirmed_event_id AND plan_body.owner_id=plan.owner_user_id AND plan_body.project_id=plan.project_id AND plan_body.document_id=plan.document_id AND plan_body.redacted_at IS NULL
      AND length(CAST(plan_body.private_json AS BLOB))<=2000000
    LEFT JOIN event_private_payloads preflight_body ON preflight_body.private_event_id=preflight.event_id AND preflight_body.owner_id=plan.owner_user_id AND preflight_body.project_id=plan.project_id AND preflight_body.document_id=plan.document_id AND preflight_body.redacted_at IS NULL
      AND length(CAST(preflight_body.private_json AS BLOB))<=2000000
    LEFT JOIN event_private_payloads authorization_body ON authorization_body.private_event_id=grant_row.authorization_event_id AND authorization_body.owner_id=plan.owner_user_id AND authorization_body.project_id=plan.project_id AND authorization_body.document_id=plan.document_id AND authorization_body.redacted_at IS NULL
      AND length(CAST(authorization_body.private_json AS BLOB))<=2000000
    WHERE grant_row.scope_key=? AND grant_row.grant_id=? AND grant_row.actor_user_id=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=?`)
    .bind(...(grantRequestCapture?.bindings ?? []), scope.key, slot.grantId, scope.actorUserId, scope.documentId, scope.projectId, scope.ownerUserId)]);
  const grantRow = grantRead?.results[0];
  if (!grantRow) fail("output_execution_grant_not_found", 404);
  if (grantRow.context_id !== scope.contextId) fail("output_execution_context_changed", 403);
  if (!boundedText(grantRow.plan_private_json) || !boundedText(grantRow.preflight_private_json) || !boundedText(grantRow.authorization_private_json)) fail("output_private_evidence_unavailable", 410);
  const confirmedPlan = record(rememberOutputPrivateBody(scope, String(grantRow.confirmed_event_id), grantRow.plan_private_json).confirmed_plan) as OutputConfirmedPlan;
  const preflight = record(rememberOutputPrivateBody(scope, String(grantRow.preflight_event_id), grantRow.preflight_private_json).preflight) as OutputPreflight;
  const authorization = rememberOutputPrivateBody(scope, String(grantRow.authorization_event_id), grantRow.authorization_private_json);
  if (confirmedPlan.id !== scope.documentId || confirmedPlan.revisionId !== grantRow.plan_revision_id || confirmedPlan.sourceDigest !== grantRow.plan_source_digest || confirmedPlan.requirementsDigest !== grantRow.plan_requirements_digest
    || preflight.id !== grantRow.preflight_id || preflight.planRevisionId !== confirmedPlan.revisionId || preflight.termsDigest !== grantRow.terms_digest || authorization.grant_id !== grantRow.grant_id) fail("output_execution_contract_changed", 409);
  const evidence: OutputGrantEvidence = { row: grantRow, confirmedPlan, preflight, slots: [] };
  const grantStatus = String(evidence.row.status);
  if (evidence.row.payer_user_id !== payerUserId || !Number(evidence.row.deadline_current)
    || !(grantStatus === "active" || job.status === "failed" && grantStatus === "completed")) fail("output_image_finalization_grant_inactive", 403);
  const { target, targetPreflight } = await validateOutputExecutionTarget(current, evidence, slot);
  const settings = record(targetPreflight.settings);
  if (target.media_kind !== "image" || settings.kind !== "generate" || !settings.payload || typeof settings.payload !== "object" || Array.isArray(settings.payload))
    fail("output_image_finalization_route_invalid", 409);
  const targets = authorization.authorized_targets;
  if (authorization.grant_id !== slot.grantId || authorization.plan_revision_id !== slot.planRevisionId
    || authorization.preflight_id !== evidence.row.preflight_id || authorization.source_digest !== slot.sourceDigest
    || authorization.maximum_microusd !== evidence.row.maximum_microusd || authorization.maximum_calls !== evidence.row.maximum_calls
    || !Array.isArray(targets) || targets.filter(value => record(value).operation_slot_id === slot.slotId).length !== 1
    || !targets.some(value => { const entry = record(value); return entry.operation_slot_id === slot.slotId && entry.target_id === slot.targetId
      && entry.job_id === job.job_id && entry.route_digest === slot.routeDigest; })) fail("output_image_finalization_authorization_changed", 409);

  const slotColumns = ["scope_key", "slot_id", "grant_id", "plan_revision_id", "target_id", "target_contract_digest", "source_digest", "provider", "model", "route_digest",
    "job_id", "cost_reservation_id", "token_reservation_id", "maximum_microusd", "maximum_calls", "maximum_tokens", "attempt_ordinal", "previous_slot_id", "created_at"];
  const grantColumns = ["scope_key", "grant_id", "plan_revision_id", "actor_user_id", "payer_user_id", "context_id", "preflight_id", "authorization_event_id", "maximum_microusd", "maximum_calls", "expires_at", "created_at"];
  const jobColumns = ["job_id", "owner_id", "stream_id", "document_id", "kind", "source_surface", "correlation_id", "requested_sequence", "request_json", "attempt_count", "requested_at", "started_at", "notified_at", "expires_at"];
  const values = (row: Record<string, unknown>, columns: readonly string[]) => columns.map(column => {
    const value = row[column];
    if (value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) fail("output_image_finalization_evidence_invalid", 409);
    return value as string | number | null;
  });
  // Column names are worker-owned constants, never decoded request data.
  const exact = (table: string, columns: readonly string[], bindings: Array<string | number | null>): OutputSqlAssertion => ({
    sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(column => `${column} IS ?`).join(" AND ")})`, bindings,
  });
  const jobIdentity = values(job, jobColumns), grantIdentity = values(evidence.row, grantColumns);
  const originalJobAssertion = exact("document_jobs", [...jobColumns, "status", "result_json", "error_message", "completed_at", "lease_expires_at", "updated_at"],
    [...jobIdentity, job.status, job.result_json, job.error_message, job.completed_at, job.lease_expires_at, job.updated_at]);
  const originalGrantAssertion = exact("output_execution_grants", [...grantColumns, "status"], [...grantIdentity, grantStatus]);
  const siblingSql = `(SELECT json_group_array(json_array(slot_id,status,outcome_event_id,updated_at)) FROM
    (SELECT slot_id,status,outcome_event_id,updated_at FROM output_operation_slots WHERE scope_key=? AND grant_id=? AND slot_id<>? ORDER BY slot_id))`;
  const contractSql = `EXISTS(SELECT 1 FROM output_plan_revisions plan
    JOIN output_plan_targets target ON target.scope_key=plan.scope_key AND target.plan_revision_id=plan.plan_revision_id
    JOIN output_preflights preflight ON preflight.scope_key=plan.scope_key AND preflight.plan_revision_id=plan.plan_revision_id
    WHERE plan.scope_key=? AND plan.plan_revision_id=? AND plan.scope_kind=? AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=?
      AND plan.organization_id IS ? AND plan.project_access_id IS ? AND plan.confirmed_event_id=? AND plan.source_digest=? AND plan.requirements_digest=?
      AND target.target_id=? AND target.target_contract_digest=? AND target.media_kind='image' AND target.selected=1
      AND preflight.preflight_id=? AND preflight.actor_user_id=? AND preflight.event_id=? AND preflight.terms_digest=?)`;
  const contract: OutputSqlAssertion = { sql: contractSql, bindings: [scope.key, slot.planRevisionId, scope.kind, scope.ownerUserId, scope.projectId, scope.documentId,
    scope.organizationId, scope.projectAccessId, String(evidence.row.confirmed_event_id), slot.sourceDigest, current.requirementsDigest, slot.targetId,
    slot.targetContractDigest, String(evidence.row.preflight_id), scope.actorUserId, String(evidence.row.preflight_event_id), String(evidence.row.terms_digest)] };
  const contractSnapshotSql = `(SELECT json_array(plan.scope_key,plan.scope_kind,plan.owner_user_id,plan.project_id,plan.document_id,plan.organization_id,plan.project_access_id,
    plan.plan_revision_id,plan.plan_id,plan.revision,plan.confirmed_event_id,plan.requirements_digest,plan.source_digest,plan.resolver_version,plan.source_head,plan.target_count,plan.created_at,
    target.target_id,target.target_contract_digest,target.media_kind,target.required,target.selected,target.ordinal,
    preflight.preflight_id,preflight.actor_user_id,preflight.terms_digest,preflight.event_id,preflight.expires_at,preflight.created_at)
    FROM output_plan_revisions plan JOIN output_plan_targets target ON target.scope_key=plan.scope_key AND target.plan_revision_id=plan.plan_revision_id
    JOIN output_preflights preflight ON preflight.scope_key=plan.scope_key AND preflight.plan_revision_id=plan.plan_revision_id
    WHERE plan.scope_key=? AND plan.plan_revision_id=? AND target.target_id=? AND preflight.preflight_id=?)`;
  const contractBindings = [scope.key, slot.planRevisionId, slot.targetId, String(evidence.row.preflight_id)];
  const queueCustody: OutputSqlAssertion = scope.kind === "project" ? {
    sql: `EXISTS(SELECT 1 FROM project_resource_scopes custody WHERE custody.resource_kind='job' AND custody.resource_id=?
      AND custody.project_access_id=? AND custody.organization_id=? AND custody.project_id=? AND custody.owner_user_id=? AND custody.actor_user_id=?
      AND custody.visibility='actor_private' AND custody.source_event_id=anchor.event_id)
      AND EXISTS(SELECT 1 FROM project_resource_scopes document WHERE document.resource_kind='document' AND document.resource_id=?
        AND document.project_access_id=? AND document.organization_id=? AND document.project_id=? AND document.owner_user_id=?)`,
    bindings: [job.job_id, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, scope.actorUserId,
      scope.documentId, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId],
  } : { sql: "NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?)", bindings: [job.job_id] };
  const [slotRead, siblingRead, authorizationRead, contractRead, queueRead] = await readOutputProofBatch(env,
    [...current.assertions, ...retainedOutputBodyAssertions(scope), originalJobAssertion, originalGrantAssertion, contract], [
    env.DB.prepare("SELECT * FROM output_operation_slots WHERE scope_key=? AND slot_id=?").bind(scope.key, slot.slotId),
    env.DB.prepare(`SELECT siblings FROM (SELECT ${siblingSql} AS siblings) WHERE length(CAST(siblings AS BLOB))<=?`).bind(scope.key, slot.grantId, slot.slotId, maximumEvidenceBytes),
    env.DB.prepare("SELECT * FROM events WHERE event_id=? AND stream_id=? AND actor=? AND type='OutputExecutionAuthorized'")
      .bind(String(evidence.row.authorization_event_id), job.stream_id, `user:${scope.actorUserId}`),
    env.DB.prepare(`SELECT contract FROM (SELECT ${contractSnapshotSql} AS contract) WHERE length(CAST(contract AS BLOB))<=?`).bind(...contractBindings, maximumEvidenceBytes),
    env.DB.prepare(`SELECT anchor.*,body.private_json AS queue_private_json FROM events anchor
      JOIN events authorization ON authorization.event_id=? AND authorization.stream_id=anchor.stream_id AND authorization.correlation_id=anchor.correlation_id AND authorization.sequence>anchor.sequence
      JOIN event_private_payloads body ON body.private_event_id=anchor.event_id AND body.owner_id=? AND body.project_id=? AND body.document_id=? AND body.redacted_at IS NULL
        AND length(CAST(body.private_json AS BLOB))<=?
      WHERE anchor.stream_id=? AND anchor.actor=? AND anchor.client_id='server:output-requirements' AND anchor.type=?
        AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.job_id')=? AND (${queueCustody.sql}) LIMIT 2`)
      .bind(String(evidence.row.authorization_event_id), scope.ownerUserId, scope.projectId, scope.documentId, maximumEvidenceBytes, job.stream_id, `user:${scope.actorUserId}`,
        scope.kind === "project" ? "ProjectDocumentJobQueued" : "OutputOperationJobQueued", job.job_id, ...(queueCustody.bindings ?? [])),
  ]);
  const slotRow = slotRead.results[0], siblingRaw = siblingRead.results[0]?.siblings;
  if (!slotRow || canonicalOutputJson(outputSlotFromRow(scope.key, slotRow)) !== canonicalOutputJson(slot)
    || !boundedText(siblingRaw)) fail("output_image_finalization_slot_changed", 409);
  const siblings: unknown = JSON.parse(siblingRaw);
  if (!Array.isArray(siblings) || siblings.some(row => !Array.isArray(row) || row.length !== 4 || typeof row[0] !== "string"
    || !["authorized", "queued", "running", "uncertain", "succeeded", "failed", "cancelled", "unavailable"].includes(String(row[1]))))
    fail("output_image_finalization_slot_changed", 409);
  const pendingSibling = siblings.some(row => ["authorized", "queued", "running", "uncertain"].includes((row as unknown[])[1] as string));
  if (grantStatus === "completed" && pendingSibling) fail("output_image_finalization_grant_incoherent", 409);
  const expectedGrantStatus: "active" | "completed" = pendingSibling ? "active" : "completed";
  const slotIdentity = values(slotRow, slotColumns);
  const authorizationEvent = authorizationRead.results[0];
  const contractRaw = contractRead.results[0]?.contract;
  if (!authorizationEvent || !boundedText(contractRaw)) fail("output_image_finalization_authorization_changed", 409);
  const eventColumns = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"];
  const queueEvent = queueRead.results[0];
  if (queueRead.results.length !== 1 || !queueEvent || !boundedText(queueEvent.queue_private_json)) fail("output_image_finalization_queue_changed", 409);
  const queue = rememberOutputPrivateBody(scope, String(queueEvent.event_id), queueEvent.queue_private_json);
  if (queue.job_id !== job.job_id || queue.document_id !== scope.documentId || queue.project_id !== scope.projectId || queue.actor_user_id !== scope.actorUserId
    || queue.kind !== "generate" || queue.output_slot_id !== slot.slotId || queue.output_grant_id !== slot.grantId
    || scope.kind === "project" && (queue.organization_id !== scope.organizationId || queue.project_access_id !== scope.projectAccessId || queue.history_owner_user_id !== scope.ownerUserId))
    fail("output_image_finalization_queue_changed", 409);
  const immutable = [exact("output_operation_slots", slotColumns, slotIdentity), exact("output_execution_grants", grantColumns, grantIdentity), contract,
    { sql: "(SELECT COUNT(*) FROM output_operation_slots WHERE job_id=?)=1", bindings: [job.job_id] } satisfies OutputSqlAssertion,
    exact("events", eventColumns, values(authorizationEvent, eventColumns)),
    exact("events", eventColumns, values(queueEvent, eventColumns)),
    { sql: `EXISTS(SELECT 1 FROM events anchor WHERE anchor.event_id=? AND (${queueCustody.sql}))`, bindings: [String(queueEvent.event_id), ...(queueCustody.bindings ?? [])] } satisfies OutputSqlAssertion,
    { sql: `${contractSnapshotSql}=?`, bindings: [...contractBindings, contractRaw] } satisfies OutputSqlAssertion,
    { sql: `${siblingSql}=?`, bindings: [scope.key, slot.grantId, slot.slotId, siblingRaw] } satisfies OutputSqlAssertion];
  const grantDeadline = Date.parse(String(evidence.row.expires_at));
  if (!iso(evidence.row.expires_at)) fail("output_image_finalization_grant_inactive", 403);
  const requestCapture = outputRequestDeadlineCapture(scope), requestDeadline = outputRequestDeadline(scope, evidence.row.dispatch_scope);
  const deadlines: OutputSqlAssertion[] = [{ sql: "EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND expires_at=? AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
    bindings: [scope.key, slot.grantId, String(evidence.row.expires_at), admittedAt], deadlineMs: grantDeadline },
    { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND expires_at=? AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
      bindings: [job.job_id, job.expires_at, admittedAt], deadlineMs: Date.parse(job.expires_at) }];
  if (requestCapture && requestDeadline !== null) deadlines.push({ sql: `${requestCapture.sql}=?`, bindings: [...(requestCapture.bindings ?? []), String(evidence.row.dispatch_scope)], deadlineMs: requestDeadline });
  const source = prepareOutputExecutionProof(scope, { ...current, confirmedPlan: evidence.confirmedPlan, target, preflight: evidence.preflight, targetPreflight });
  const retained = [...retainedOutputBodyAssertions(scope), ...immutable, ...deadlines];
  const preState: OutputSqlAssertion[] = [originalJobAssertion,
    exact("output_operation_slots", ["scope_key", "slot_id", "status", "outcome_event_id", "updated_at"], values(slotRow, ["scope_key", "slot_id", "status", "outcome_event_id", "updated_at"])),
    exact("output_execution_grants", ["scope_key", "grant_id", "status"], [scope.key, slot.grantId, grantStatus]),
    { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND (lease_expires_at IS NULL OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))", bindings: [job.job_id] }];
  const assertions = [...source.assertions, ...retained, ...preState];
  const [verifiedHead] = await readOutputProofBatch(env, assertions,
    [env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(`creative:${scope.ownerUserId}`)]);
  if (Number(verifiedHead?.results[0]?.head ?? -1) !== current.head) fail("output_revision_or_authority_changed", 409);
  return { ...source, scope: { ...scope }, slot: { ...slot }, originalJob: { ...job }, reference: { ...reference }, settings: settings.payload as Record<string, unknown>, imageRender: settings.imageRender as OutputEventExecution["imageRender"],
    grantStatus: grantStatus as "active" | "completed", expectedGrantStatus, payerUserId, assertions,
    lateAssertions: [...source.publicationAssertions, ...retained, ...preState],
    publicationAssertions(post: OutputImageFinalizationPostState): OutputSqlAssertion[] {
      if (!boundedText(post.resultJson)) fail("output_image_finalization_evidence_too_large", 413);
      let result: Record<string, unknown>;
      try { result = record(JSON.parse(post.resultJson)); } catch { return fail("output_image_finalization_result_invalid", 409); }
      if (!idPattern.test(post.completionEventId) || !iso(post.completedAt) || post.completedAt < admittedAt
        || ["reservationId", "costReservationId", "costReservationPeriod", "costReservationMicrousd", "providerSubmissionProtocol", "providerSubmissions", "imageRecovery"]
          .some(key => canonicalOutputJson(result[key]) !== canonicalOutputJson(checkpoint[key]))) fail("output_image_finalization_result_invalid", 409);
      return [...source.publicationAssertions, ...retained,
        exact("document_jobs", [...jobColumns, "status", "result_json", "error_message", "completed_at", "lease_expires_at", "updated_at"],
          [...jobIdentity, "completed", post.resultJson, null, post.completedAt, null, post.completedAt]),
        exact("output_operation_slots", ["scope_key", "slot_id", "status", "outcome_event_id"], [scope.key, slot.slotId, "succeeded", post.completionEventId]),
        exact("output_execution_grants", ["scope_key", "grant_id", "status"], [scope.key, slot.grantId, expectedGrantStatus]),
        { sql: `EXISTS(SELECT 1 FROM events event WHERE event.event_id=? AND event.stream_id=? AND event.correlation_id=? AND event.type='GenerationCompleted'
          AND event.actor='worker:generator' AND event.client_id='server:document-job:generate')
          AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=? AND calls.slot_id=? AND calls.status IN('pending','uncertain'))`,
          bindings: [post.completionEventId, job.stream_id, job.correlation_id, scope.key, slot.slotId] }];
    },
  };
}

/** Read-only proof for acknowledging an already published native Image result.
 * A completed original grant is not reopened and no execution capability escapes. */
export async function resolveOutputImageAcknowledgmentAuthority(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot, payerUserId: string): Promise<OutputSqlAssertion[]> {
  if (scope.key !== slot.scopeKey) fail("output_execution_scope_mismatch", 403);
  const current = await loadOutputCurrentContext(env, scope);
  const evidence = await readOutputGrantEvidence(env, scope, slot.grantId);
  const status = String(evidence.row.status), expiresAt = String(evidence.row.expires_at);
  if (evidence.row.payer_user_id !== payerUserId || !["authorized", "active", "completed"].includes(status) || !Number(evidence.row.deadline_current)
    || !Number.isFinite(Date.parse(expiresAt))) fail("output_execution_grant_inactive", 403);
  await validateOutputExecutionTarget(current, evidence, slot);
  const requestCapture = outputRequestDeadlineCapture(scope), requestDeadline = outputRequestDeadline(scope, evidence.row.dispatch_scope);
  if (requestDeadline !== null && (!Number.isFinite(requestDeadline) || requestDeadline <= Date.now())) fail("output_execution_authority_revoked", 403);
  const grantKeys = ["scope_key", "grant_id", "plan_revision_id", "actor_user_id", "payer_user_id", "context_id", "preflight_id", "authorization_event_id", "maximum_microusd", "maximum_calls", "status", "expires_at", "created_at"] as const;
  const grant: OutputSqlAssertion = {
    sql: `EXISTS(SELECT 1 FROM output_execution_grants WHERE ${grantKeys.map(key => `${key} IS ?`).join(" AND ")} AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    bindings: grantKeys.map(key => {
      const value = evidence.row[key];
      if (value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
      return fail("output_execution_grant_inactive", 403);
    }),
  };
  return [...current.assertions, ...retainedOutputBodyAssertions(scope), grant,
    ...(requestCapture ? [{ sql: `${requestCapture.sql}=?`, bindings: [...(requestCapture.bindings ?? []), String(evidence.row.dispatch_scope)] }] : [])];
}

/** Reuse retained evidence only while every later event is proven nonsemantic.
 * Scope/grant/slot/deadline checks remain live SQL at each write and provider call.
 */
export function prepareOutputExecutionProof(scope: OutputScope, authority: Awaited<ReturnType<typeof resolveOutputExecutionAuthority>>) {
  if (authority.confirmedPlan.id !== scope.documentId || authority.confirmedPlan.sourceDigest !== authority.sourceDigest) fail("output_execution_scope_mismatch", 403);
  const sourceEpoch = { head: authority.head, sourceDigest: authority.sourceDigest };
  const withSourceEpoch = (sourceAssertions: readonly OutputSqlAssertion[]) => {
    let replaced = 0;
    const assertions = sourceAssertions.map((assertion) => {
      if (assertion.sql === "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?" && assertion.bindings?.[0] === `creative:${scope.ownerUserId}`) {
        // The Document and a governed origin can share this owner. Every such
        // capture must agree on the exact same head before using the same epoch.
        if (assertion.bindings.length !== 2 || assertion.bindings[1] !== authority.head) fail("output_source_epoch_required", 403);
        replaced++; return outputSourceEpochAssertion(scope, sourceEpoch);
      }
      return assertion;
    });
    if (replaced < 1) fail("output_source_epoch_required", 403);
    return assertions;
  };
  return { ...authority, sourceEpoch, assertions: withSourceEpoch(authority.assertions), publicationAssertions: withSourceEpoch(authority.publicationAssertions) };
}

function isGovernancePlanningCapacity(code: string) {
  return code === "output_source_governance_capacity_exceeded" || code === "output_source_governance_proof_too_large";
}

function commandWrite(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, permission: OutputCommandPermission): Pick<OutputCommandWrite, "scope" | "permission" | "expectedHead" | "expectedProjectHead" | "key" | "digest" | "action" | "sourceAssertions"> {
  const expected = parseOutputRevision(body.expectedRevision);
  if (expected !== trusted.ownerHead) fail("output_revision_conflict", 409);
  const freeStructureEdit = permission === "author" && ["save", "confirm"].includes(String(body.action));
  const sourceProblem = trusted.sourceProblems.find((code) => code.startsWith("output_source_") && !(freeStructureEdit && isGovernancePlanningCapacity(code)));
  if (sourceProblem) fail(isGovernancePlanningCapacity(sourceProblem) ? sourceProblem : "output_source_private_evidence_unavailable", 409);
  return { scope: trusted.scope, permission, expectedHead: expected, expectedProjectHead: trusted.projectHead, key: identifier(body.clientMutationId, "client_mutation_id_required"), digest, action: String(body.action), sourceAssertions: [...trusted.sourceAssertions, ...retainedOutputBodyAssertions(trusted.scope)] };
}

async function saveRequirement(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string) {
  const reasonIssue = outputScopeAmendmentReasonIssue(body.amendmentReason);
  if (reasonIssue) fail(reasonIssue);
  const blockId = identifier(body.blockId, "block_id_required"), proposed = record(body.spec);
  if (proposed.id !== blockId) fail("requirement_block_identity_mismatch");
  const inspection = inspectOutputRequirement(proposed);
  if (inspection.status === "invalid") return json({ error: "invalid_output_requirement", issues: inspection.issues }, 400);
  const existing = trusted.projection.libraryBlocks.find((block) => block.id === blockId);
  const occupied = await trusted.env.DB.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?").bind(`creative:${trusted.scope.ownerUserId}`, blockId).first<{ count: number }>();
  if (Number(occupied?.count ?? 0) !== (existing ? 1 : 0)) fail("output_block_identity_unavailable", 409);
  if (existing && (existing.documentId !== trusted.scope.documentId || existing.projectId !== trusted.scope.projectId || existing.scope !== "document" || existing.removed)) fail("foreign_or_removed_output_block", 403);
  if (existing?.locked) fail("output_block_locked", 409);
  if (existing && existing.type.toLowerCase() !== "output") fail("output_requirement_endpoint_cannot_convert_source", 403);
  if (existing && Object.keys(existing.properties).some((key) => key.startsWith("organization_context_package_") || key === "organization_context_source_block_id")) fail("organization_context_package_decision_immutable", 403);
  const content = typeof proposed.original_text === "string" ? proposed.original_text : String(existing?.properties.text ?? "");
  const subtype = typeof proposed.label === "string" ? proposed.label : String(existing?.properties.subtype ?? "Output");
  const planSuggestions = normalizePlanSuggestions(inspection.spec, body.planSuggestions === undefined ? existing?.properties.output_plan_suggestions : body.planSuggestions, body.planSuggestions !== undefined);
  // Validate the raw value before checking blankness. Preserve valid authored
  // text exactly; omitting this field also leaves a retained draft reason intact.
  const amendmentReason = typeof body.amendmentReason === "string" && body.amendmentReason.trim() ? body.amendmentReason : "";
  const events: OutputCommandWrite["events"] = existing ? [
    ...(existing.type !== "output" ? [{ type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "type", old_value: existing.type, new_value: "output" } }] : []),
    { type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "text", old_value: existing.properties.text ?? null, new_value: content } },
    { type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "subtype", old_value: existing.properties.subtype ?? null, new_value: subtype } },
    { type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "output_spec", old_value: existing.properties.output_spec ?? null, new_value: proposed } },
    { type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "output_plan_suggestions", old_value: existing.properties.output_plan_suggestions ?? null, new_value: planSuggestions } },
    ...(body.amendmentReason !== undefined && amendmentReason !== (existing.properties.output_amendment_reason ?? "") ? [{ type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "output_amendment_reason", old_value: existing.properties.output_amendment_reason ?? null, new_value: amendmentReason } }] : []),
  ] : [{ type: "BlockCreated", payload: { block_id: blockId, type: "output", scope: "document", position: `z-output-${blockId}`, handle: `output/${blockId}`, properties: { text: content, subtype, output_spec: proposed, output_plan_suggestions: planSuggestions, ...(amendmentReason ? { output_amendment_reason: amendmentReason } : {}), authority: "authored" } } }];
  const assertions: OutputSqlAssertion[] = [...(!existing ? [{ sql: "NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?)", bindings: [`creative:${trusted.scope.ownerUserId}`, blockId] }] : []), ...(trusted.scope.kind === "project" ? [{ sql: "NOT EXISTS(SELECT 1 FROM project_context_package_members member JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id AND binding.organization_id=member.organization_id AND binding.status='active' WHERE binding.project_access_id=? AND binding.organization_id=? AND member.target_block_id=?)", bindings: [trusted.scope.projectAccessId, trusted.scope.organizationId, blockId] }] : [])];
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events, assertions });
}

async function removeRequirement(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string) {
  const blockId = identifier(body.blockId, "block_id_required");
  const block = trusted.projection.blocks.find((value) => value.id === blockId && value.type.toLowerCase() === "output" && !value.removed);
  if (!block) fail("output_block_not_found", 404);
  if (block.locked) fail("output_block_locked", 409);
  if (Object.keys(block.properties).some((key) => key.startsWith("organization_context_package_") || key === "organization_context_source_block_id")) fail("organization_context_package_decision_immutable", 403);
  const commitments = await retainedCommitmentGuards(trusted, null, blockId);
  if (commitments.blockers.length) return json({ error: "output_active_commitment_requires_cancellation", commitments: commitments.blockers }, 409);
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [{ type: "BlockRemoved", payload: { block_id: blockId, output_requirement_removed: true } }], assertions: commitments.assertions });
}

function owedTargetIds(plan: OutputPlan) {
  return new Set(plan.obligations.filter((obligation) => obligation.required || obligation.selected).flatMap((obligation) => obligation.target_ids));
}

/** A failed/cancelled display status does not settle an unknown provider charge. */
const activeCommitmentSql = `(slot.status IN('authorized','queued','running','uncertain') OR EXISTS(SELECT 1 FROM output_provider_calls pending
  WHERE pending.scope_key=slot.scope_key AND pending.slot_id=slot.slot_id AND (pending.used_microusd IS NULL OR pending.status IN('pending','uncertain'))))`;

async function retainedCommitmentGuards(trusted: OutputTrustedContext, next: OutputPlan | null, removedRequirementId?: string) {
  const rows = await trusted.env.DB.prepare(`SELECT slot.slot_id,slot.grant_id,slot.job_id,slot.target_id,slot.plan_revision_id,CASE WHEN ${activeCommitmentSql} THEN 1 ELSE 0 END AS active
    FROM output_operation_slots slot JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    WHERE slot.scope_key=? AND plan.document_id=?`).bind(trusted.scope.key, trusted.scope.documentId).all<Record<string, unknown>>();
  const plans = new Map<string, OutputConfirmedPlan>(), affected: string[] = [], blockers: Array<{ targetId: string; grantId: string; jobId: string; slotId: string }> = [];
  const owed = next ? owedTargetIds(next) : new Set<string>();
  for (const row of rows.results) {
    const planId = String(row.plan_revision_id);
    if (!plans.has(planId)) { const value = await readConfirmedPlan(trusted, planId); if (!value) fail("output_commitment_evidence_unavailable", 409); plans.set(planId, value); }
    const oldTarget = plans.get(planId)!.plan.targets.find((target) => target.id === row.target_id);
    if (!oldTarget) fail("output_commitment_evidence_unavailable", 409);
    if (removedRequirementId && oldTarget.requirement_id !== removedRequirementId) continue;
    const replacement = next?.targets.find((target) => target.id === oldTarget.id);
    // Compare the target contract without global source versions. Saving any source
    // edit still pauses execution separately through the conservative source hash.
    const changed = !replacement || !owed.has(oldTarget.id) || await outputTargetContractDigest(replacement, "scope-amendment") !== await outputTargetContractDigest(oldTarget, "scope-amendment");
    if (!changed) continue;
    affected.push(String(row.slot_id));
    if (Number(row.active) === 1) blockers.push({ targetId: String(row.target_id), grantId: String(row.grant_id), jobId: String(row.job_id), slotId: String(row.slot_id) });
  }
  const assertions: OutputSqlAssertion[] = affected.length ? [{ sql: `NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.scope_key=? AND slot.slot_id IN(SELECT value FROM json_each(?)) AND ${activeCommitmentSql})`, bindings: [trusted.scope.key, JSON.stringify(affected)] }] : [];
  return { blockers, assertions };
}

async function confirmPlan(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string) {
  const reasonIssue = outputScopeAmendmentReasonIssue(body.amendmentReason);
  if (reasonIssue) fail(reasonIssue);
  if (!trusted.requirements.length) fail("output_requirements_required", 409);
  if (trusted.requirements.some((requirement) => requirement.status !== "valid" || !requirement.spec)) return json({ error: "output_requirements_need_confirmation", issues: trusted.requirements.filter((row) => row.status !== "valid").map((row) => ({ blockId: row.blockId, status: row.status, issues: row.issues })) }, 409);
  if (trusted.requirements.some((requirement) => outputRequirementInterpretationNeedsReview(requirement.spec!))) fail("output_interpretation_review_required", 409);
  const proposals = trusted.requirements.reduce<OutputPlanSuggestions>((result, row) => ({ count_policies: { ...result.count_policies, ...row.planSuggestions.count_policies }, suggested_counts: { ...result.suggested_counts, ...row.planSuggestions.suggested_counts } }), { count_policies: {}, suggested_counts: {} });
  const options = { ...proposals, ...record(body.options) } as OutputConfirmationOptions;
  const allowed = new Set(["selected_optional_ids", "selected_target_ids", "count_policies", "suggested_counts"]);
  if (Object.keys(options).some((key) => !allowed.has(key))) fail("invalid_output_plan_options");
  for (const key of ["selected_optional_ids", "selected_target_ids"] as const) if (options[key] !== undefined && (!Array.isArray(options[key]) || options[key]!.some((value) => typeof value !== "string" || value.length > 500) || new Set(options[key]).size !== options[key]!.length)) fail("invalid_output_plan_selection");
  const plan = compileOutputPlan(trusted.requirements.map((row) => row.spec!) as OutputRequirementSpec[], { ...options, document_id: trusted.scope.documentId, source_revision: trusted.sourceDigest, requirement_revision: trusted.requirementsDigest, max_targets: 1000 });
  if (plan.issues.length) return json({ error: "invalid_output_plan", issues: plan.issues }, 400);
  const previous = await readConfirmedPlan(trusted), revisionId = uuidV7(), createdAt = nowIso();
  const commitments = await retainedCommitmentGuards(trusted, plan);
  if (commitments.blockers.length) return json({ error: "output_active_commitment_requires_cancellation", commitments: commitments.blockers }, 409);
  const nextOwed = owedTargetIds(plan), nextObligations = new Set(plan.obligations.filter((obligation) => obligation.required || obligation.selected).map((obligation) => obligation.id));
  const withdrawnTargetIds = previous ? [...owedTargetIds(previous.plan)].filter((id) => !nextOwed.has(id)) : [];
  const withdrawnObligationIds = previous?.plan.obligations.filter((obligation) => (obligation.required || obligation.selected) && !nextObligations.has(obligation.id)).map((obligation) => obligation.id) ?? [];
  const withdrawal = withdrawnTargetIds.length > 0 || withdrawnObligationIds.length > 0;
  const amendmentReason = typeof body.amendmentReason === "string" ? body.amendmentReason : "";
  if (withdrawal && outputScopeAmendmentReasonIssue(amendmentReason, { required: true })) return json({ error: "output_scope_amendment_reason_required", withdrawnTargetIds, withdrawnObligationIds }, 409);
  const targetContractDigests: Record<string, string> = {};
  for (const target of plan.targets) targetContractDigests[target.id] = await outputTargetContractDigest(target, trusted.sourceDigest);
  const confirmedPlan: OutputConfirmedPlan = { id: trusted.scope.documentId, revisionId, revision: (previous?.revision ?? 0) + 1, confirmedAt: createdAt, requirementsDigest: trusted.requirementsDigest, sourceDigest: trusted.sourceDigest, plan, targetContractDigests, confirmationOptions: options };
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [{ type: "OutputPlanConfirmed", payload: { plan_revision_id: revisionId, confirmed_plan: confirmedPlan, ...(withdrawal ? { scope_amendment: { previous_plan_revision_id: previous!.revisionId, reason: amendmentReason, withdrawn_target_ids: withdrawnTargetIds, withdrawn_obligation_ids: withdrawnObligationIds } } : {}) } }], assertions: commitments.assertions,
    buildSidecars: (events) => ({ statements: [trusted.env.DB.prepare(`INSERT INTO output_plan_revisions(scope_key,scope_kind,owner_user_id,project_id,document_id,organization_id,project_access_id,plan_revision_id,plan_id,revision,confirmed_event_id,requirements_digest,source_digest,resolver_version,source_head,target_count,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(trusted.scope.key, trusted.scope.kind, trusted.scope.ownerUserId, trusted.scope.projectId, trusted.scope.documentId, trusted.scope.organizationId, trusted.scope.projectAccessId, revisionId, confirmedPlan.id, confirmedPlan.revision, events.at(-1)!.eventId, trusted.requirementsDigest, trusted.sourceDigest, RESOLVER_VERSION, trusted.ownerHead, plan.targets.length, createdAt),
      ...plan.targets.map((target, index) => trusted.env.DB.prepare("INSERT INTO output_plan_targets(scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal) VALUES(?,?,?,?,?,?,?,?)").bind(trusted.scope.key, revisionId, target.id, targetContractDigests[target.id], target.media_kind, target.required ? 1 : 0, target.selected ? 1 : 0, index))] }) });
}

function bridgeTarget(trusted: OutputTrustedContext, plan: OutputConfirmedPlan, target: OutputPlanTarget): OutputBridgeTargetInput {
  return { request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, confirmedPlan: plan, target, context: requireCurrentSource(trusted), sourceEvents: trusted.events, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest };
}

async function preflightPlan(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge?: OutputExecutionBridge) {
  requireCurrentSource(trusted);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, identifier(body.planRevisionId, "plan_revision_id_required")));
  const requested = body.targetIds === undefined ? plan.plan.targets.filter((target) => target.selected).map((target) => target.id) : body.targetIds;
  if (!Array.isArray(requested) || !requested.length || requested.length > OUTPUT_PREFLIGHT_TARGET_MAX_COUNT || requested.some((value) => typeof value !== "string") || new Set(requested).size !== requested.length) fail("finite_target_selection_required", 409);
  const selected = requested.map((id) => plan.plan.targets.find((target) => target.id === id));
  if (selected.some((target) => !target?.selected)) fail("target_not_selected_in_confirmed_plan", 409);
  const targets: OutputNativeTargetPreflight[] = [];
  const operationAttempts: OutputPreflight["operationAttempts"] = {};
  if (body.alternativeOfSlotId && selected.length !== 1) fail("choose_one_target_for_explicit_alternative");
  const identities = (selected as OutputPlanTarget[]).map((target) => ({ targetId: target.id, contract: plan.targetContractDigests[target.id] }));
  const attempts = await trusted.env.DB.prepare(`SELECT slot.*,EXISTS(SELECT 1 FROM output_provider_calls call
      WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND (call.used_microusd IS NULL OR call.status IN('pending','uncertain'))) AS unresolved_cost
    FROM output_operation_slots slot JOIN output_plan_revisions retained_plan ON retained_plan.scope_key=slot.scope_key AND retained_plan.plan_revision_id=slot.plan_revision_id
    JOIN json_each(?) wanted ON slot.target_id=json_extract(wanted.value,'$.targetId') AND slot.target_contract_digest=json_extract(wanted.value,'$.contract')
    WHERE slot.scope_key=? AND retained_plan.document_id=? AND NOT EXISTS(SELECT 1 FROM output_operation_slots newer
      WHERE newer.scope_key=slot.scope_key AND newer.target_id=slot.target_id AND newer.target_contract_digest=slot.target_contract_digest AND newer.attempt_ordinal>slot.attempt_ordinal)`)
    .bind(JSON.stringify(identities), trusted.scope.key, trusted.scope.documentId).all<Record<string, unknown>>();
  const lastAttempt = new Map(attempts.results.map((row) => [String(row.target_id), row]));
  for (const target of selected as OutputPlanTarget[]) {
    const initial = lastAttempt.get(target.id);
    let recoveryReason = "";
    if (body.alternativeOfSlotId) {
      if (!initial || initial.slot_id !== body.alternativeOfSlotId || !["succeeded", "failed", "cancelled", "unavailable"].includes(String(initial.status))) fail("previous_output_operation_not_terminal", 409);
      if (Number(initial.unresolved_cost)) fail("reconcile_previous_output_cost_before_alternative", 409);
      operationAttempts[target.id] = { ordinal: Number(initial.attempt_ordinal) + 1, previousSlotId: String(initial.slot_id) };
    } else if (initial) recoveryReason = "This target already has an authorized operation. Recover its stored result or explicitly authorize an alternative; a second initial operation will not be created.";
    else operationAttempts[target.id] = { ordinal: 0, previousSlotId: null };
    if (!bridge || target.blocking_issues.length || recoveryReason) {
      targets.push({ targetId: target.id, available: false, reason: recoveryReason || target.blocking_issues.map((issue) => issue.message).join(" ") || "Native generation is unavailable because no verified execution bridge is installed.", reasonCode: recoveryReason ? "output_existing_operation_requires_recovery" : target.blocking_issues.length ? "output_target_requires_resolution" : "output_native_execution_unavailable", transferCode: "output_transfer_none_authorized", provider: null, model: null, route: null, maximumMicrousd: 0, maximumCalls: 0, maximumTokens: 0, settings: {}, transferDescription: "No source transmission is authorized." });
      continue;
    }
    const result = await bridge.preflight(bridgeTarget(trusted, plan, target));
    if (result.targetId !== target.id) fail("bridge_target_mismatch", 500);
    if (result.available && (![result.maximumMicrousd, result.maximumCalls, result.maximumTokens].every((number) => Number.isSafeInteger(number) && number > 0) || !result.provider || !result.model || !result.route)) fail("bridge_preflight_incomplete", 500);
    if (result.available) outputProviderStages(result);
    targets.push(result);
  }
  const createdAt = nowIso(), preflightId = uuidV7();
  const withoutDigest = { id: preflightId, planRevisionId: plan.revisionId, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, targets, operationAttempts,
    maximumMicrousd: targets.filter((target) => target.available).reduce((sum, target) => sum + target.maximumMicrousd, 0), maximumCalls: targets.filter((target) => target.available).reduce((sum, target) => sum + target.maximumCalls, 0), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), createdAt };
  const preflight: OutputPreflight = { ...withoutDigest, termsDigest: await outputDigest(withoutDigest) };
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "request"), events: [{ type: "OutputPlanPreflighted", payload: { preflight_id: preflightId, plan_revision_id: plan.revisionId, preflight } }],
    buildSidecars: (events) => ({ statements: [trusted.env.DB.prepare("INSERT INTO output_preflights(scope_key,preflight_id,plan_revision_id,actor_user_id,terms_digest,event_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(trusted.scope.key, preflightId, plan.revisionId, trusted.scope.actorUserId, preflight.termsDigest, events.at(-1)!.eventId, preflight.expiresAt, createdAt)] }) });
}

function outputProviderStages(offered: OutputNativeTargetPreflight): Array<{ stage: string; provider: string; model: string }> {
  if (!Array.isArray(offered.settings.calls) || !offered.settings.calls.length || offered.settings.calls.length !== offered.maximumCalls) fail("bridge_provider_call_routes_required", 500);
  const calls = offered.settings.calls.map(record);
  if (calls.some((call) => typeof call.stage !== "string" || !idPattern.test(call.stage) || typeof call.provider !== "string" || !call.provider || typeof call.model !== "string" || !call.model) || new Set(calls.map((call) => call.stage)).size !== calls.length) fail("bridge_provider_call_routes_invalid", 500);
  return calls as Array<{ stage: string; provider: string; model: string }>;
}

async function authorizePlan(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge?: OutputExecutionBridge) {
  if (!bridge) fail("native_execution_unavailable", 409);
  if (body.explicitAuthorization !== true || !Number.isSafeInteger(body.maximumMicrousd) || Number(body.maximumMicrousd) <= 0) fail("explicit_spending_authorization_required", 403);
  const preflightId = identifier(body.preflightId, "preflight_id_required");
  const row = await trusted.env.DB.prepare("SELECT * FROM output_preflights WHERE scope_key=? AND preflight_id=? AND actor_user_id=?").bind(trusted.scope.key, preflightId, trusted.scope.actorUserId).first<Record<string, unknown>>();
  if (!row || String(row.expires_at) <= nowIso()) fail("output_preflight_expired", 409);
  const preflight = record((await privateEventBody(trusted.env, trusted.scope, String(row.event_id))).preflight) as OutputPreflight;
  if (row.terms_digest !== body.termsDigest || preflight.termsDigest !== body.termsDigest || preflight.sourceDigest !== trusted.sourceDigest || preflight.requirementsDigest !== trusted.requirementsDigest) fail("output_authorization_terms_changed", 409);
  if (!preflight.targets.length || preflight.targets.some((target) => !target.available)) fail("unavailable_selected_output_route", 409);
  if (preflight.maximumMicrousd > Number(body.maximumMicrousd) || Number(body.maximumMicrousd) > 1_000_000_000_000) fail("output_authorization_ceiling_insufficient", 403);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, preflight.planRevisionId));
  const context = requireCurrentSource(trusted), grantId = uuidV7(), createdAt = nowIso();
  const slots: OutputOperationSlot[] = [];
  for (const offered of preflight.targets) {
    const target = plan.plan.targets.find((value) => value.id === offered.targetId);
    if (!target || !target.selected || target.blocking_issues.length) fail("output_target_no_longer_executable", 409);
    const current = await bridge.preflight(bridgeTarget(trusted, plan, target));
    if (canonicalOutputJson(current) !== canonicalOutputJson(offered)) fail("output_provider_terms_changed", 409);
    const attempt = preflight.operationAttempts[target.id];
    if (!attempt || !Number.isSafeInteger(attempt.ordinal) || attempt.ordinal < 0) fail("output_attempt_identity_missing", 409);
    slots.push({ scopeKey: trusted.scope.key, slotId: uuidV7(), grantId, planRevisionId: plan.revisionId, targetId: target.id, targetContractDigest: plan.targetContractDigests[target.id], sourceDigest: trusted.sourceDigest, provider: offered.provider!, model: offered.model!, routeDigest: await outputDigest(offered), jobId: uuidV7(), costReservationId: uuidV7(), tokenReservationId: uuidV7(), maximumMicrousd: offered.maximumMicrousd, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens, status: "authorized", attemptOrdinal: attempt.ordinal, previousSlotId: attempt.previousSlotId });
  }
  if (slots.reduce((sum, slot) => sum + slot.maximumMicrousd, 0) !== preflight.maximumMicrousd || slots.reduce((sum, slot) => sum + slot.maximumCalls, 0) !== preflight.maximumCalls) fail("output_allocation_mismatch", 500);
  const prepared = await bridge.prepareAdmission({ request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, confirmedPlan: plan, context, sourceEvents: trusted.events, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, grantId, preflight, slots, governanceWitness: trusted.governanceWitness });
  if (!prepared.events.length) fail("output_admission_receipt_required", 500);
  const write = commandWrite(trusted, body, digest, "request");
  const sourceAssertions = [...(write.sourceAssertions ?? [])], captured = new Set(sourceAssertions.map(canonicalOutputJson));
  for (const assertion of prepared.sourceAssertions ?? []) {
    const key = canonicalOutputJson(assertion);
    if (!captured.has(key)) { captured.add(key); sourceAssertions.push(assertion); }
  }
  return commitOutputCommand(trusted.env, { ...write, sourceAssertions, events: [...prepared.events, { type: "OutputExecutionAuthorized", payload: { grant_id: grantId, plan_revision_id: plan.revisionId, preflight_id: preflightId, maximum_microusd: Number(body.maximumMicrousd), maximum_calls: preflight.maximumCalls, authorized_targets: slots.map((slot) => ({ target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: slot.jobId, route_digest: slot.routeDigest })), source_digest: trusted.sourceDigest } }],
    assertions: [{ sql: "EXISTS(SELECT 1 FROM output_preflights preflight JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.redacted_at IS NULL WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND preflight.terms_digest=? AND preflight.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))", bindings: [trusted.scope.key, preflightId, trusted.scope.actorUserId, preflight.termsDigest, createdAt] }],
    buildSidecars: (events) => {
      const native = prepared.buildStatements(events);
      if (!native.statements.length || !native.assertions.length) throw new Error("output_atomic_native_admission_required");
      return { statements: [trusted.env.DB.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,context_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'authorized',?,?)")
        .bind(trusted.scope.key, grantId, plan.revisionId, trusted.scope.actorUserId, trusted.scope.actorUserId, trusted.scope.contextId, preflightId, events.at(-1)!.eventId, Number(body.maximumMicrousd), preflight.maximumCalls, preflight.expiresAt, createdAt),
        ...slots.map((slot) => trusted.env.DB.prepare(`INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,attempt_ordinal,previous_slot_id,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'authorized',?,?)`).bind(slot.scopeKey, slot.slotId, slot.grantId, slot.planRevisionId, slot.targetId, slot.targetContractDigest, slot.sourceDigest, slot.provider, slot.model, slot.routeDigest, slot.jobId, slot.costReservationId, slot.tokenReservationId, slot.maximumMicrousd, slot.maximumCalls, slot.maximumTokens, slot.attemptOrdinal, slot.previousSlotId, createdAt, createdAt)),
        ...slots.flatMap((slot) => outputProviderStages(preflight.targets.find((target) => target.targetId === slot.targetId)!).map((call) => trusted.env.DB.prepare("INSERT INTO output_operation_routes(scope_key,slot_id,stage_key,provider,model,maximum_calls) VALUES(?,?,?,?,?,1)").bind(slot.scopeKey, slot.slotId, call.stage, call.provider, call.model))),
        ...native.statements], assertions: [
          { sql: "(SELECT COALESCE(SUM(maximum_microusd),0) FROM output_operation_slots WHERE scope_key=? AND grant_id=?)<=? AND (SELECT COALESCE(SUM(maximum_calls),0) FROM output_operation_slots WHERE scope_key=? AND grant_id=?)=?", bindings: [trusted.scope.key, grantId, Number(body.maximumMicrousd), trusted.scope.key, grantId, preflight.maximumCalls] },
          ...slots.filter((slot) => slot.previousSlotId).map((slot) => ({ sql: "EXISTS(SELECT 1 FROM output_operation_slots previous WHERE previous.scope_key=? AND previous.slot_id=? AND previous.target_id=? AND previous.target_contract_digest=? AND previous.attempt_ordinal=? AND previous.status IN('succeeded','failed','cancelled','unavailable') AND NOT EXISTS(SELECT 1 FROM output_provider_calls pending WHERE pending.scope_key=previous.scope_key AND pending.slot_id=previous.slot_id AND pending.used_microusd IS NULL))", bindings: [slot.scopeKey, slot.previousSlotId, slot.targetId, slot.targetContractDigest, slot.attemptOrdinal - 1] })),
          ...native.assertions] };
    } });
}

function outputRunGrantAssertion(scope: OutputScope, grantId: string): OutputSqlAssertion {
  return { sql: "EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS ? AND status IN('authorized','active') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))", bindings: [scope.key, grantId, scope.actorUserId, scope.contextId] };
}

async function validateRecordedOutputRun(trusted: OutputTrustedContext, evidence: OutputGrantEvidence, bridge: OutputExecutionBridge, statuses: readonly string[]) {
  const slots = evidence.slots, ready = slots.filter((slot) => statuses.includes(slot.status));
  if (!slots.length) fail("output_execution_grant_not_found", 404);
  if (!ready.length) return ready;
  if (!["authorized", "active"].includes(String(evidence.row.status)) || !Number(evidence.row.deadline_current)) {
    await bridge.cleanupExpiredOrRevoked?.({ request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, slots });
    fail("output_execution_grant_inactive", 403);
  }
  requireCurrentSource(trusted);
  // All targets share this already-authorized Document and immutable grant body.
  // The later per-job HTTP runner rechecks its live route before any transfer.
  for (const slot of ready) await validateOutputExecutionTarget(trusted, evidence, slot);
  return ready;
}

async function runGrant(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge: OutputExecutionBridge | undefined, executionContext: WorkerExecutionContext) {
  if (!bridge) fail("native_execution_unavailable", 409);
  const grantId = identifier(body.grantId, "grant_id_required");
  const evidence = await readOutputGrantEvidence(trusted.env, trusted.scope, grantId, true);
  const ready = await validateRecordedOutputRun(trusted, evidence, bridge, ["authorized", "queued", "running"]);
  const readyIds = ready.map((slot) => slot.slotId);
  const saved = await commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "request"), events: [{ type: "OutputExecutionRunRequested", payload: { grant_id: grantId, job_ids: evidence.slots.map((slot) => slot.jobId), existing_jobs_only: true } }],
    assertions: ready.length ? [outputRunGrantAssertion(trusted.scope, grantId), { sql: "NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.scope_key=? AND slot.grant_id=? AND slot.status IN('authorized','queued','running') AND slot.slot_id NOT IN(SELECT value FROM json_each(?)))", bindings: [trusted.scope.key, grantId, JSON.stringify(readyIds)] }] : [],
    buildSidecars: () => ({ statements: [trusted.env.DB.prepare("UPDATE output_operation_slots SET status='queued',updated_at=? WHERE scope_key=? AND grant_id=? AND status='authorized' AND slot_id IN(SELECT value FROM json_each(?))").bind(nowIso(), trusted.scope.key, grantId, JSON.stringify(readyIds)), trusted.env.DB.prepare("UPDATE output_execution_grants SET status='active' WHERE scope_key=? AND grant_id=? AND status='authorized'").bind(trusted.scope.key, grantId)], assertions: ready.length ? [outputRunGrantAssertion(trusted.scope, grantId)] : [] }) });
  // Dispatch is an existing-job wake-up only. No new source read, slot, budget,
  // provider call or alternative is created here; the job HTTP runner owns work.
  if (ready.length) await bridge.dispatch({ request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, executionContext,
    slots: ready.map((slot) => slot.status === "authorized" ? { ...slot, status: "queued" } : slot) });
  return saved;
}

async function resumeRecordedOutputRun(trusted: OutputTrustedContext, grantId: string, bridge: OutputExecutionBridge | undefined, executionContext: WorkerExecutionContext) {
  if (!bridge) fail("native_execution_unavailable", 409);
  const evidence = await readOutputGrantEvidence(trusted.env, trusted.scope, grantId, true);
  const pending = await validateRecordedOutputRun(trusted, evidence, bridge, ["queued", "running"]);
  if (!pending.length) return;
  // Identical replay resumes only recorded jobs under fresh authority. Exact
  // provider receipts and leases decide whether a logical call was consumed.
  await trusted.env.DB.batch([outputScopeAuthority(trusted.scope, "request"), outputRunGrantAssertion(trusted.scope, grantId), ...trusted.sourceAssertions, ...retainedOutputBodyAssertions(trusted.scope),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${trusted.scope.ownerUserId}`, trusted.ownerHead] }].flatMap((assertion) => outputAssertionStatements(trusted.env, assertion)));
  await bridge.dispatch({ request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, executionContext, slots: pending });
}

export function outputAssetStorageIdentity(scope: OutputScope, assetId: string, inspection: OutputAssetInspection) {
  if (inspection.status !== "inspected" || !inspection.sha256 || !inspection.extension || !inspection.mimeType) fail("output_asset_not_inspected", 400);
  return { ...outputAssetObjectKeys(scope, assetId, inspection.sha256, inspection.extension),
    metadata: { ownerId: scope.ownerUserId, projectId: scope.projectId, scopeKey: scope.key, assetId, documentId: scope.documentId, sha256: inspection.sha256, mimeType: inspection.mimeType, outputRequirementAsset: "1" } };
}

async function readBoundedRequest(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maximumBytes) fail("output_request_too_large", 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > maximumBytes) { await reader.cancel(); fail("output_request_too_large", 413); }
    chunks.push(part.value);
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

type PreparedAsset = { id: string; name: string; storageKey: string; inspection: OutputAssetInspection; mediaKind: OutputAssetRow["mediaKind"]; createdAt: string; sourceDigest: string; origin: Record<string, unknown> };
async function prepareOwnedAsset(trusted: OutputTrustedContext, bytes: Uint8Array, name: string, origin: Record<string, unknown>, command: { key: string; digest: string; assertions?: OutputSqlAssertion[] }): Promise<PreparedAsset> {
  if (!validOutputAssetName(name)) fail("invalid_output_asset_name");
  const inspection = await inspectOutputAsset(bytes, name, { snapshot: false });
  if (inspection.status !== "inspected" || !inspection.kind || !inspection.sha256 || !inspection.mimeType) return fail(inspection.errors[0] ?? "output_asset_unsupported", 415);
  const candidateId = uuidV7(), candidateStorage = outputAssetStorageIdentity(trusted.scope, candidateId, inspection);
  const claimed = await claimOutputAssetStorage(trusted.env, { scope: trusted.scope, assetId: candidateId, commandKey: command.key, requestDigest: command.digest, sourceDigest: trusted.sourceDigest, storageKey: candidateStorage.key, sha256: inspection.sha256, byteLength: bytes.byteLength, expectedHead: trusted.ownerHead, expectedProjectHead: trusted.projectHead, sourceAssertions: [...trusted.sourceAssertions, ...(command.assertions ?? []), ...retainedOutputBodyAssertions(trusted.scope)] });
  const receipt = claimed.receipt, id = receipt.asset_id, identity = outputAssetStorageIdentity(trusted.scope, id, inspection);
  if (receipt.storage_key !== identity.key && receipt.storage_key !== identity.legacyKey) fail("output_asset_write_identity_conflict", 409);
  const storage = { ...identity, key: receipt.storage_key };
  if (!claimed.claimed && (receipt.status !== "written" || receipt.write_acknowledged !== 1 || receipt.publication_event_id)) fail("output_asset_write_reconciliation_required", 409);
  try {
    if (claimed.claimed) {
      const acknowledgement = await trusted.env.MEDIA.put(storage.key, assetBuffer(bytes), { httpMetadata: { contentType: inspection.mimeType }, customMetadata: storage.metadata });
      if (!acknowledgement || record(acknowledgement).key !== storage.key) fail("output_asset_write_unacknowledged", 409);
      await acknowledgeOutputAssetStorage(trusted.env, receipt);
    } else {
      // A retry can reuse a durably acknowledged unpublished write, but never
      // issues another PUT for an uncertain receipt or trusts metadata as bytes.
      const stored = await trusted.env.MEDIA.get(storage.key);
      if (!stored || !outputAssetStorageCustodyMatches({ ownerUserId: trusted.scope.ownerUserId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId, scopeKey: trusted.scope.key, assetId: id, sha256: inspection.sha256, storageKey: storage.key }, stored.customMetadata) || Number(stored.size) !== inspection.byteLength) fail("output_asset_custody_mismatch", 409);
      const retained = await inspectOutputAsset(new Uint8Array(await new Response(stored.body).arrayBuffer()), name);
      if (retained.status !== "inspected" || retained.sha256 !== inspection.sha256) fail("output_asset_bytes_changed", 409);
    }
    await trusted.env.DB.batch([outputScopeAuthority(trusted.scope, "author"), ...trusted.sourceAssertions, ...(command.assertions ?? []), ...retainedOutputBodyAssertions(trusted.scope), outputAssetPublicationAssertion(trusted.scope.key, id, storage.key, inspection.sha256)].flatMap((assertion) => outputAssertionStatements(trusted.env, assertion)));
    return { id, name, storageKey: storage.key, inspection, mediaKind: inspection.kind === "presentation" ? "slides" : inspection.kind, createdAt: receipt.created_at, sourceDigest: trusted.sourceDigest, origin };
  } catch (error) { await cleanupOutputAssetStorage(trusted.env, trusted.scope.key, id); throw error; }
}

function assetEvent(asset: PreparedAsset) {
  return { type: "OutputAssetAdopted", payload: { asset_id: asset.id, asset: { id: asset.id, name: asset.name, inspection: asset.inspection, origin: asset.origin, sourceDigest: asset.sourceDigest } } };
}
function assetStatements(trusted: OutputTrustedContext, asset: PreparedAsset, events: EventRow[]): D1PreparedStatement[] {
  const event = events.find((value) => value.type === "OutputAssetAdopted" && value.payload.asset_id === asset.id);
  if (!event) throw new Error("output_asset_event_required");
  return [...outputAssertionStatements(trusted.env, outputAssetPublicationAssertion(trusted.scope.key, asset.id, asset.storageKey, asset.inspection.sha256!)), trusted.env.DB.prepare(`INSERT INTO output_assets(scope_key,asset_id,document_id,owner_user_id,created_by_user_id,source_digest,storage_key,content_sha256,byte_length,mime_type,media_kind,created_event_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(trusted.scope.key, asset.id, trusted.scope.documentId, trusted.scope.ownerUserId, trusted.scope.actorUserId, asset.sourceDigest, asset.storageKey, asset.inspection.sha256!, asset.inspection.byteLength, asset.inspection.mimeType!, asset.mediaKind, event.eventId, asset.createdAt), ...outputAssetPublicationStatements(trusted.env, trusted.scope.key, asset.id, event.eventId)];
}

async function cleanupUncommittedOutputAsset(trusted: OutputTrustedContext, asset: PreparedAsset) {
  await cleanupOutputAssetStorage(trusted.env, trusted.scope.key, asset.id);
}

async function storeUpload(trusted: OutputTrustedContext, request: Request) {
  const body = { action: "adopt", documentId: trusted.scope.documentId, expectedRevision: request.headers.get("x-output-expected-revision"), clientMutationId: request.headers.get("x-output-client-mutation-id") };
  if (request.headers.get("x-output-rights-confirmed") !== "true") fail("owned_file_rights_attestation_required", 403);
  let name = "";
  try { name = decodeURIComponent(request.headers.get("x-output-filename") ?? ""); } catch { fail("invalid_output_asset_name"); }
  const bytes = await readBoundedRequest(request, /\.glb$/iu.test(name) ? MAX_OUTPUT_MODEL3D_ASSET_BYTES : MAX_OUTPUT_ASSET_BYTES);
  const inspection = await inspectOutputAsset(bytes, name, { snapshot: false });
  if (inspection.status !== "inspected") return json({ error: "output_asset_not_inspectable", inspection }, 415);
  const digest = await outputDigest({ ...body, name, sha256: inspection.sha256, rightsAttested: true });
  const previous = await readOutputCommand(trusted.env, trusted.scope, identifier(body.clientMutationId, "client_mutation_id_required"), digest, { allowUnavailableReceipt: true });
  if (previous) return { replayed: true, receipt: previous, events: [] as EventRow[] };
  commandWrite(trusted, body, digest, "author");
  requireCurrentSource(trusted);
  const asset = await prepareOwnedAsset(trusted, bytes, name, { kind: "owned_upload", rightsAttestedBy: trusted.scope.actorUserId, rightsAttestedAt: nowIso() }, { key: identifier(body.clientMutationId), digest });
  try {
    const saved = await commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [assetEvent(asset)], buildSidecars: (events) => ({ statements: assetStatements(trusted, asset, events) }) });
    return saved;
  } finally { await cleanupUncommittedOutputAsset(trusted, asset); }
}

async function loadOutputAssetEvidence(trusted: OutputTrustedContext, assetId: string, preloaded?: OutputBulkAssetEvidence) {
  requireCurrentSource(trusted);
  if (preloaded) {
    if (preloaded.row.asset_id !== assetId || preloaded.row.scope_key !== trusted.scope.key || preloaded.row.document_id !== trusted.scope.documentId || preloaded.row.owner_user_id !== trusted.scope.ownerUserId || preloaded.row.redacted_at) fail("output_asset_unavailable", 404);
    const { row, origin } = preloaded;
    if (origin.kind === "native_job" && row.source_digest !== trusted.sourceDigest) fail("native_output_source_needs_recheck", 409);
    if (origin.kind !== "native_job" && (origin.kind !== "owned_upload" || origin.rightsAttestedBy !== row.created_by_user_id)) fail("output_asset_rights_evidence_missing", 409);
    return preloaded;
  }
  const row = await trusted.env.DB.prepare("SELECT * FROM output_assets WHERE scope_key=? AND asset_id=? AND document_id=? AND owner_user_id=? AND redacted_at IS NULL")
    .bind(trusted.scope.key, assetId, trusted.scope.documentId, trusted.scope.ownerUserId).first<Record<string, unknown>>();
  if (!row) fail("output_asset_unavailable", 404);
  const body = await privateEventBody(trusted.env, trusted.scope, String(row.created_event_id)), asset = record(body.asset), origin = record(asset.origin);
  if (origin.kind === "native_job" && row.source_digest !== trusted.sourceDigest) fail("native_output_source_needs_recheck", 409);
  if (origin.kind !== "native_job" && (origin.kind !== "owned_upload" || origin.rightsAttestedBy !== row.created_by_user_id)) fail("output_asset_rights_evidence_missing", 409);
  return { row, asset, origin, name: String(asset.name ?? "") };
}

/** Read exact private bytes. MIME, filenames and supplied dimensions are never authority. */
async function loadExactAsset(trusted: OutputTrustedContext, assetId: string, preloaded?: OutputBulkAssetEvidence) {
  const { row, name, origin } = await loadOutputAssetEvidence(trusted, assetId, preloaded);
  const object = await trusted.env.MEDIA.get(String(row.storage_key));
  if (!object || Number(object.size ?? 0) > (row.media_kind === "model3d" ? MAX_OUTPUT_MODEL3D_ASSET_BYTES : MAX_OUTPUT_ASSET_BYTES) || !outputAssetStorageCustodyMatches({ ownerUserId: trusted.scope.ownerUserId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId, scopeKey: trusted.scope.key, assetId, sha256: String(row.content_sha256), storageKey: String(row.storage_key) }, object.customMetadata)) fail("output_asset_custody_mismatch", 409);
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  const inspection = await inspectOutputAsset(bytes, name, { snapshot: false });
  if (inspection.status !== "inspected" || inspection.sha256 !== row.content_sha256 || inspection.byteLength !== row.byte_length || inspection.mimeType !== row.mime_type) fail("output_asset_bytes_changed", 409);
  const expectedStorage = outputAssetStorageIdentity(trusted.scope, assetId, inspection);
  if (expectedStorage.key !== row.storage_key && expectedStorage.legacyKey !== row.storage_key) fail("output_asset_custody_mismatch", 409);
  return { row, bytes, name, inspection, origin };
}

export function inspectOutputTargetFile(target: OutputPlanTarget, inspection: OutputAssetInspection) {
  const problems = target.blocking_issues.map((issue) => issue.code);
  const checks = [...inspection.checks];
  const kind = inspection.kind === "presentation" ? "slides" : inspection.kind;
  if (inspection.status !== "inspected") problems.push("asset_structure_unverified");
  if (target.media_kind !== kind) problems.push("target_media_kind_mismatch");
  if (target.aspect_ratio) {
    const width = kind === "slides" ? inspection.facts.slideWidthEmu : inspection.facts.width;
    const height = kind === "slides" ? inspection.facts.slideHeightEmu : inspection.facts.height;
    if (!width || !height) problems.push("required_aspect_ratio_unmeasured");
    else if (width * target.aspect_ratio.height !== height * target.aspect_ratio.width) problems.push("required_aspect_ratio_mismatch");
    else checks.push("exact_authored_aspect_ratio");
  }
  if (target.content_quantity) {
    const actual = target.content_quantity.unit === "slide" ? inspection.facts.slideCount : target.content_quantity.unit === "second" ? inspection.facts.durationSeconds : undefined;
    if (actual === undefined || !target.count_policy) problems.push("required_content_quantity_unmeasured");
    else if (!outputCountSatisfies(actual, target.content_quantity, target.count_policy)) problems.push("required_content_quantity_mismatch");
    else checks.push("authored_and_confirmed_count_policy");
  }
  if (target.coverage.kind === "unresolved" || target.source_scope.kind === "unknown") problems.push("required_coverage_unresolved");
  return { status: problems.length ? "failed" as const : "passed" as const, checks: [...new Set(checks)], problems: [...new Set(problems)] };
}

async function bindResult(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge?: OutputExecutionBridge) {
  requireCurrentSource(trusted);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, identifier(body.planRevisionId, "plan_revision_id_required")));
  const target = plan.plan.targets.find((candidate) => candidate.id === body.targetId);
  if (!target) fail("output_target_not_found", 404);
  if (target.blocking_issues.length) return json({ error: "output_target_unresolved", issues: target.blocking_issues }, 409);
  if ([body.assetId, body.nativeJobId, body.acceptanceId].filter(Boolean).length !== 1) fail("choose_one_output_result");
  if (body.acceptanceId) return reuseTargetAcceptance(trusted, body, digest, plan, target);
  commandWrite(trusted, body, digest, "author");
  let preparedAsset: PreparedAsset | undefined;
  let sourceAssertions: OutputSqlAssertion[] = [];
  if (body.nativeJobId) {
    if (!bridge?.resolveResult) fail("native_result_adoption_unavailable", 409);
    const native = await bridge.resolveResult({ ...bridgeTarget(trusted, plan, target), nativeJobId: identifier(body.nativeJobId, "native_job_id_required") });
    if (!native.assertions.length) fail("native_result_lineage_required", 500);
    preparedAsset = await prepareOwnedAsset(trusted, native.bytes, native.name, { ...native.origin, kind: "native_job", jobId: body.nativeJobId }, { key: identifier(body.clientMutationId), digest, assertions: native.assertions });
    sourceAssertions = native.assertions;
  }
  try {
    const stored = preparedAsset ? null : await loadExactAsset(trusted, identifier(body.assetId, "asset_id_required"));
    const inspection = preparedAsset?.inspection ?? stored!.inspection;
    const assetId = preparedAsset?.id ?? String(stored!.row.asset_id);
    const measured = inspectOutputTargetFile(target, inspection), resultId = uuidV7(), createdAt = nowIso();
    const result = { id: resultId, targetId: target.id, planRevisionId: plan.revisionId, assetId, resultRevision: inspection.sha256!, targetContractDigest: plan.targetContractDigests[target.id], sourceDigest: trusted.sourceDigest, sha256: inspection.sha256!, checksStatus: measured.status, checks: measured.checks, problems: measured.problems, createdByUserId: trusted.scope.actorUserId, createdAt };
    const saved = await commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [...(preparedAsset ? [assetEvent(preparedAsset)] : []), { type: "OutputResultBound", payload: { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, asset_id: assetId, result } }], assertions: sourceAssertions,
      buildSidecars: (events) => ({ statements: [...(preparedAsset ? assetStatements(trusted, preparedAsset, events) : []), trusted.env.DB.prepare(`INSERT INTO output_results(scope_key,result_id,document_id,plan_revision_id,target_id,target_contract_digest,source_digest,asset_id,result_revision,content_sha256,validation_policy,checks_status,created_by_user_id,bound_event_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(trusted.scope.key, resultId, trusted.scope.documentId, plan.revisionId, target.id, result.targetContractDigest, trusted.sourceDigest, assetId, result.resultRevision, result.sha256, VALIDATION_POLICY, measured.status, trusted.scope.actorUserId, events.at(-1)!.eventId, createdAt)],
        assertions: [{ sql: "EXISTS(SELECT 1 FROM output_assets asset JOIN event_private_payloads private_body ON private_body.private_event_id=asset.created_event_id AND private_body.redacted_at IS NULL WHERE asset.scope_key=? AND asset.asset_id=? AND asset.document_id=? AND asset.content_sha256=? AND asset.redacted_at IS NULL)", bindings: [trusted.scope.key, assetId, trusted.scope.documentId, result.sha256] }] }) });
    return saved;
  } finally { if (preparedAsset) await cleanupUncommittedOutputAsset(trusted, preparedAsset); }
}

async function reuseTargetAcceptance(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, plan: OutputConfirmedPlan, target: OutputPlanTarget) {
  const acceptanceId = identifier(body.acceptanceId, "acceptance_id_required");
  const result = (await readResults(trusted)).find((candidate) => candidate.acceptanceId === acceptanceId && candidate.review === "approved");
  if (!result || result.targetId !== target.id || result.targetContractDigest !== plan.targetContractDigests[target.id] || result.sourceDigest !== trusted.sourceDigest || result.checksStatus !== "passed") fail("prior_output_acceptance_not_eligible", 409);
  const asset = await loadExactAsset(trusted, result.assetId);
  if (asset.inspection.sha256 !== result.sha256 || result.resultRevision !== result.sha256 || inspectOutputTargetFile(target, asset.inspection).status !== "passed") fail("prior_output_acceptance_not_eligible", 409);
  const createdAt = nowIso();
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [{ type: "OutputFulfillmentSelected", payload: { plan_revision_id: plan.revisionId, target_id: target.id, acceptance_id: acceptanceId, result_id: result.id, reused_human_approval: true, eligibility: { sourceDigest: trusted.sourceDigest, targetContractDigest: result.targetContractDigest, resultRevision: result.resultRevision, sha256: result.sha256, checkedAt: createdAt } } }],
    assertions: [{ sql: `EXISTS(SELECT 1 FROM output_target_acceptances accepted JOIN output_results result ON result.scope_key=accepted.scope_key AND result.result_id=accepted.result_id
      JOIN output_assets asset ON asset.scope_key=result.scope_key AND asset.asset_id=result.asset_id AND asset.redacted_at IS NULL
      JOIN event_private_payloads approval_body ON approval_body.private_event_id=accepted.approval_event_id AND approval_body.redacted_at IS NULL
      JOIN event_private_payloads asset_body ON asset_body.private_event_id=asset.created_event_id AND asset_body.redacted_at IS NULL
      WHERE accepted.scope_key=? AND accepted.acceptance_id=? AND accepted.target_id=? AND accepted.target_contract_digest=? AND accepted.source_digest=?
        AND accepted.result_id=? AND accepted.result_revision=? AND accepted.content_sha256=? AND accepted.validation_policy=? AND result.checks_status='passed' AND asset.content_sha256=accepted.content_sha256)`,
      bindings: [trusted.scope.key, acceptanceId, target.id, plan.targetContractDigests[target.id], trusted.sourceDigest, result.id, result.resultRevision, result.sha256, VALIDATION_POLICY] }, distinctPhysicalFileAssertion(trusted, plan, target, result.sha256)],
    buildSidecars: (events) => ({ statements: [trusted.env.DB.prepare(`INSERT INTO output_plan_fulfillments(scope_key,plan_revision_id,target_id,acceptance_id,eligibility_event_id,checked_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(scope_key,plan_revision_id,target_id) DO UPDATE SET acceptance_id=excluded.acceptance_id,eligibility_event_id=excluded.eligibility_event_id,checked_at=excluded.checked_at`)
      .bind(trusted.scope.key, plan.revisionId, target.id, acceptanceId, events.at(-1)!.eventId, createdAt)] }) });
}

function distinctPhysicalFileAssertion(trusted: OutputTrustedContext, plan: OutputConfirmedPlan, target: OutputPlanTarget, sha256: string): OutputSqlAssertion {
  return { sql: `NOT EXISTS(SELECT 1 FROM output_plan_fulfillments selected JOIN output_target_acceptances accepted ON accepted.scope_key=selected.scope_key AND accepted.acceptance_id=selected.acceptance_id
    WHERE selected.scope_key=? AND selected.plan_revision_id=? AND selected.target_id<>? AND accepted.content_sha256=?)`, bindings: [trusted.scope.key, plan.revisionId, target.id, sha256] };
}

async function reviewResult(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string) {
  requireCurrentSource(trusted);
  const resultId = identifier(body.resultId, "result_id_required");
  if (!["approve", "changes_requested"].includes(String(body.decision))) fail("output_review_decision_required");
  const row = await trusted.env.DB.prepare("SELECT * FROM output_results WHERE scope_key=? AND result_id=? AND document_id=?").bind(trusted.scope.key, resultId, trusted.scope.documentId).first<Record<string, unknown>>();
  if (!row) fail("output_result_not_found", 404);
  await privateEventBody(trusted.env, trusted.scope, String(row.bound_event_id));
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, String(row.plan_revision_id)));
  const target = plan.plan.targets.find((candidate) => candidate.id === row.target_id);
  if (!target || plan.targetContractDigests[target.id] !== row.target_contract_digest || row.source_digest !== trusted.sourceDigest || row.validation_policy !== VALIDATION_POLICY) fail("output_result_needs_recheck", 409);
  const asset = await loadExactAsset(trusted, String(row.asset_id));
  const measured = inspectOutputTargetFile(target, asset.inspection);
  const approve = body.decision === "approve";
  if (approve && (body.reviewedCoverage !== true || body.reviewedRights !== true)) fail("output_content_and_rights_review_required", 403);
  if (approve && (measured.status !== "passed" || row.checks_status !== "passed" || row.content_sha256 !== asset.inspection.sha256 || row.result_revision !== asset.inspection.sha256)) return json({ error: "output_mandatory_checks_failed", problems: measured.problems }, 409);
  if (approve) {
    const unique = distinctPhysicalFileAssertion(trusted, plan, target, asset.inspection.sha256!);
    if (!await trusted.env.DB.prepare(`SELECT 1 AS distinct_file WHERE (${unique.sql})`).bind(...(unique.bindings ?? [])).first()) fail("physical_output_targets_require_distinct_files", 409);
  }
  const reviewEligibility = outputReviewEligibility(trusted.scope, trusted.principal, String(row.created_by_user_id), String(asset.row.created_by_user_id), asset.origin);
  if (!reviewEligibility.reviewAllowed) fail(reviewEligibility.independentReviewBlocked ? "independent_output_reviewer_required" : "output_action_not_authorized", 403);
  const acceptanceId = approve ? uuidV7() : null, createdAt = nowIso();
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 10_000) fail("output_review_note_too_long");
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "review"), events: [{ type: approve ? "OutputTargetAccepted" : "OutputTargetChangesRequested", payload: { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, ...(acceptanceId ? { acceptance_id: acceptanceId } : {}), content_sha256: row.content_sha256, result_revision: row.result_revision, target_contract_digest: row.target_contract_digest, source_digest: trusted.sourceDigest, validation_policy: VALIDATION_POLICY, reviewed_coverage: approve, reviewed_rights: approve, reviewer_user_id: trusted.scope.actorUserId, note } }],
    assertions: [{ sql: "EXISTS(SELECT 1 FROM output_results result JOIN output_assets asset ON asset.scope_key=result.scope_key AND asset.asset_id=result.asset_id JOIN event_private_payloads body ON body.private_event_id=result.bound_event_id AND body.redacted_at IS NULL WHERE result.scope_key=? AND result.result_id=? AND result.content_sha256=? AND result.source_digest=? AND asset.redacted_at IS NULL AND asset.content_sha256=result.content_sha256)", bindings: [trusted.scope.key, resultId, row.content_sha256 as string, trusted.sourceDigest] }, ...(approve ? [distinctPhysicalFileAssertion(trusted, plan, target, asset.inspection.sha256!)] : [])],
    buildSidecars: (events) => ({ statements: approve ? [trusted.env.DB.prepare(`INSERT INTO output_target_acceptances(scope_key,acceptance_id,target_id,target_contract_digest,result_id,result_revision,content_sha256,source_digest,validation_policy,reviewer_user_id,approval_event_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(trusted.scope.key, acceptanceId!, target.id, row.target_contract_digest as string, resultId, row.result_revision as string, row.content_sha256 as string, trusted.sourceDigest, VALIDATION_POLICY, trusted.scope.actorUserId, events.at(-1)!.eventId, createdAt),
      trusted.env.DB.prepare(`INSERT INTO output_plan_fulfillments(scope_key,plan_revision_id,target_id,acceptance_id,eligibility_event_id,checked_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(scope_key,plan_revision_id,target_id) DO UPDATE SET acceptance_id=excluded.acceptance_id,eligibility_event_id=excluded.eligibility_event_id,checked_at=excluded.checked_at`)
        .bind(trusted.scope.key, plan.revisionId, target.id, acceptanceId!, events.at(-1)!.eventId, createdAt)] : [trusted.env.DB.prepare(`DELETE FROM output_plan_fulfillments WHERE scope_key=? AND acceptance_id IN(SELECT acceptance_id FROM output_target_acceptances WHERE scope_key=? AND result_id=?)`).bind(trusted.scope.key, trusted.scope.key, resultId)] }) });
}

type DeliveryEntry = { targetId: string; assetId: string; acceptanceId: string; resultId: string; resultRevision: string; sha256: string; targetContractDigest: string };
async function currentDeliveryEntries(trusted: OutputTrustedContext, plan: OutputConfirmedPlan, options: { targetIds?: Set<string> } = {}): Promise<DeliveryEntry[]> {
  requireCurrentSource(trusted);
  const model = requireCompleteOutputReadModel(await readOutputModel(trusted));
  const entries: DeliveryEntry[] = [], owed = owedTargetIds(plan.plan), memberships = model.fulfillments.get(plan.revisionId);
  const acceptedResults = new Map(model.results.filter((result) => result.acceptanceId && result.review === "approved").map((result) => [result.acceptanceId, result]));
  for (const target of plan.plan.targets) {
    if (!owed.has(target.id) || options.targetIds && !options.targetIds.has(target.id)) continue;
    const acceptanceId = memberships?.get(target.id);
    if (!acceptanceId) continue;
    const result = acceptedResults.get(acceptanceId);
    if (!result || result.checksStatus !== "passed" || result.targetContractDigest !== plan.targetContractDigests[target.id] || result.sourceDigest !== trusted.sourceDigest || result.targetId !== target.id) fail("output_acceptance_needs_recheck", 409);
    const retained = model.assetEvidence.get(result.assetId);
    if (!retained) fail("output_asset_unavailable", 404);
    const evidence = await loadOutputAssetEvidence(trusted, result.assetId, retained), inspection = retained.inspection;
    if (!retained.available || evidence.row.content_sha256 !== result.sha256 || inspection.status !== "inspected" || inspection.sha256 !== result.sha256 || result.resultRevision !== result.sha256 || inspectOutputTargetFile(target, inspection).status !== "passed") fail("output_accepted_file_changed", 409);
    entries.push({ targetId: target.id, assetId: result.assetId, acceptanceId, resultId: result.id, resultRevision: result.resultRevision, sha256: result.sha256, targetContractDigest: result.targetContractDigest });
  }
  return entries;
}

function deliveryAssertions(trusted: OutputTrustedContext, plan: OutputConfirmedPlan, entries: DeliveryEntry[]): OutputSqlAssertion[] {
  return [outputBulkDeliveryAssertion(trusted.scope, plan.revisionId, trusted.sourceDigest, VALIDATION_POLICY, entries)];
}

function assertOutputHistoryReason(reason: unknown) {
  if (outputScopeAmendmentReasonIssue(reason, { required: true })) fail("output_scope_history_reason_unverified", 409);
}

async function readOutputScopeHistory(trusted: OutputTrustedContext, plan: OutputConfirmedPlan) {
  const rows = await trusted.env.DB.prepare(`SELECT revision.plan_revision_id,revision.revision,revision.confirmed_event_id,body.private_json,event.occurred_at,event.actor,event.client_id
    FROM output_plan_revisions revision JOIN events event ON event.event_id=revision.confirmed_event_id
    LEFT JOIN event_private_payloads body ON body.private_event_id=revision.confirmed_event_id AND body.owner_id=? AND body.project_id=? AND body.document_id=? AND body.redacted_at IS NULL
    WHERE revision.scope_key=? AND revision.document_id=? AND revision.owner_user_id=? AND revision.revision<=? ORDER BY revision.revision LIMIT 129`)
    .bind(trusted.scope.ownerUserId, trusted.scope.projectId, trusted.scope.documentId, trusted.scope.key, trusted.scope.documentId, trusted.scope.ownerUserId, plan.revision).all<Record<string, unknown>>();
  let scopeHistoryComplete = rows.results.length === plan.revision && plan.revision <= 128;
  const scopeAmendments: OutputDeliveryScopeAmendmentInput[] = [];
  let previous: OutputConfirmedPlan | null = null;
  for (const [index, row] of rows.results.entries()) {
    if (typeof row.private_json !== "string") { scopeHistoryComplete = false; previous = null; continue; }
    const payload = rememberOutputPrivateBody(trusted.scope, String(row.confirmed_event_id), row.private_json);
    // A retained incompatible reason cannot be omitted, rewritten, or hidden by
    // a later confirmation to make the assignment appear exportable.
    if (payload.scope_amendment !== undefined) assertOutputHistoryReason(record(payload.scope_amendment).reason);
    if (Number(row.revision) !== index + 1) { scopeHistoryComplete = false; previous = null; continue; }
    const current = record(payload.confirmed_plan) as OutputConfirmedPlan;
    if (!current.plan || current.revisionId !== row.plan_revision_id || current.revision !== Number(row.revision)) { scopeHistoryComplete = false; previous = null; continue; }
    if (previous) {
      const owed = owedTargetIds(current.plan), obligations = new Set(current.plan.obligations.filter((entry) => entry.required || entry.selected).map((entry) => entry.id));
      const withdrawnTargets = previous.plan.targets.filter((target) => owedTargetIds(previous!.plan).has(target.id) && !owed.has(target.id)).map((target) => ({ id: target.id, label: target.label }));
      const withdrawnObligations = previous.plan.obligations.filter((entry) => (entry.required || entry.selected) && !obligations.has(entry.id)).map((entry) => ({ id: entry.id, label: entry.label }));
      const amendment = record(payload.scope_amendment);
      if (withdrawnTargets.length || withdrawnObligations.length) {
        const sameIds = (value: unknown, expected: string[]) => Array.isArray(value) && value.every((id) => typeof id === "string") && canonicalOutputJson([...value].sort()) === canonicalOutputJson([...expected].sort());
        if (amendment.previous_plan_revision_id !== previous.revisionId || typeof amendment.reason !== "string" || !amendment.reason.trim() || !sameIds(amendment.withdrawn_target_ids, withdrawnTargets.map((target) => target.id)) || !sameIds(amendment.withdrawn_obligation_ids, withdrawnObligations.map((entry) => entry.id))) scopeHistoryComplete = false;
        else scopeAmendments.push({ id: String(row.confirmed_event_id), previousPlanRevisionId: previous.revisionId, planRevisionId: current.revisionId, occurredAt: String(row.occurred_at), reason: amendment.reason, actorRole: row.client_id === "server:output-requirements" && row.actor === `user:${String(payload.actor_user_id ?? "")}` ? "authorized_author" : "unknown", withdrawnObligations, withdrawnTargets });
      } else if (payload.scope_amendment) scopeHistoryComplete = false;
    } else if (Number(row.revision) !== 1) scopeHistoryComplete = false;
    previous = current;
  }
  if (previous?.revisionId !== plan.revisionId || scopeAmendments.length > 64) scopeHistoryComplete = false;
  if (scopeAmendments.length > 64) fail("output_delivery_history_capacity_exceeded", 409);
  return { scopeHistoryComplete, scopeAmendments };
}

async function prepareDelivery(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge?: OutputExecutionBridge) {
  requireCurrentSource(trusted);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, identifier(body.planRevisionId, "plan_revision_id_required")));
  requireCompleteOutputReadModel(await readOutputModel(trusted));
  const snapshot = await buildSnapshot(trusted, bridge);
  if (snapshot.confirmedPlan?.revisionId !== plan.revisionId) fail("latest_output_plan_required", 409);
  if (snapshot.capabilities.limitationCodes?.includes("output_scope_history_reason_unverified")) fail("output_scope_history_reason_unverified", 409);
  const partial = snapshot.summary?.delivery_ready !== true;
  if (partial && body.allowPartial !== true) return json({ error: "output_assignment_incomplete", summary: snapshot.summary }, 409);
  const entries = await currentDeliveryEntries(trusted, plan);
  if (!entries.length) fail("no_accepted_outputs_to_export", 409);
  const manifestId = uuidV7(), createdAt = nowIso();
  const history = await readOutputScopeHistory(trusted, plan);
  const scope = outputDeliveryScopeForPlan(plan.plan, { status: snapshot.summary?.scope_known ? partial ? "partial" : "complete" : "unknown", inventoryComplete: snapshot.summary?.scope_known === true, includedTargetIds: entries.map((entry) => entry.targetId) });
  const archiveInput: OutputDeliveryManifestInput = { schemaVersion: 1, deliveryId: manifestId, planId: plan.id, planRevision: plan.revisionId, createdAt, targets: entries.map((entry) => ({ targetId: entry.targetId, fileId: entry.assetId, acceptanceId: entry.acceptanceId })), scope, ...history };
  const fileIds = new Set(entries.map((entry) => entry.assetId));
  const files = snapshot.assets.filter((asset) => fileIds.has(asset.id)).map((asset) => ({ id: asset.id, byteLength: asset.byteLength, kind: asset.mediaKind }));
  if (files.length !== fileIds.size) fail("output_delivery_file_inventory_changed", 409);
  const parts = planOutputDeliveryParts(files, archiveInput);
  const manifest = { schemaVersion: 1, id: manifestId, planId: plan.id, planRevisionId: plan.revisionId, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, isPartial: partial, createdAt, entries, summary: snapshot.summary, scope, parts, ...history };
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "read"), events: [{ type: "OutputDeliveryPrepared", payload: { manifest_id: manifestId, plan_revision_id: plan.revisionId, is_partial: partial, manifest } }], assertions: deliveryAssertions(trusted, plan, entries),
    buildSidecars: (events) => ({ statements: [trusted.env.DB.prepare("INSERT INTO output_delivery_manifests(scope_key,manifest_id,document_id,plan_revision_id,created_by_user_id,event_id,is_partial,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(trusted.scope.key, manifestId, trusted.scope.documentId, plan.revisionId, trusted.scope.actorUserId, events.at(-1)!.eventId, partial ? 1 : 0, createdAt)] }) });
}

async function downloadDelivery(trusted: OutputTrustedContext, manifestId: string) {
  requireCurrentSource(trusted);
  // Older prepared manifests may predate the history fields. They still cannot
  // bypass an incompatible retained amendment in this Document's ancestry.
  for (const amendment of retainedOutputAmendments(trusted)) assertOutputHistoryReason(record(amendment.payload.scope_amendment).reason);
  const row = await trusted.env.DB.prepare("SELECT * FROM output_delivery_manifests WHERE scope_key=? AND manifest_id=? AND document_id=?").bind(trusted.scope.key, manifestId, trusted.scope.documentId).first<Record<string, unknown>>();
  if (!row) fail("output_delivery_not_found", 404);
  const manifest = record((await privateEventBody(trusted.env, trusted.scope, String(row.event_id))).manifest);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, String(row.plan_revision_id)));
  if (manifest.sourceDigest !== trusted.sourceDigest || manifest.requirementsDigest !== trusted.requirementsDigest || !Array.isArray(manifest.entries)) fail("output_delivery_needs_recheck", 409);
  const pinned = manifest.entries as DeliveryEntry[], eligible = await currentDeliveryEntries(trusted, plan, { targetIds: new Set(pinned.map((entry) => entry.targetId)) });
  if (pinned.some((entry) => !eligible.some((candidate) => canonicalOutputJson(candidate) === canonicalOutputJson(entry)))) fail("output_delivery_acceptance_changed", 409);
  const savedScope = manifest.scope as OutputDeliveryScopeInput | undefined;
  if (savedScope) {
    const currentScope = outputDeliveryScopeForPlan(plan.plan, { status: savedScope.status, inventoryComplete: savedScope.inventoryComplete, includedTargetIds: pinned.map((entry) => entry.targetId), reasonCodes: savedScope.reasonCodes });
    if (canonicalOutputJson(currentScope) !== canonicalOutputJson(savedScope)) fail("output_delivery_scope_changed", 409);
  }
  const history = { scopeHistoryComplete: manifest.scopeHistoryComplete === true, scopeAmendments: Array.isArray(manifest.scopeAmendments) ? manifest.scopeAmendments as OutputDeliveryScopeAmendmentInput[] : [] };
  for (const amendment of history.scopeAmendments) assertOutputHistoryReason(record(amendment).reason);
  if (manifest.scopeHistoryComplete !== undefined && canonicalOutputJson(history) !== canonicalOutputJson(await readOutputScopeHistory(trusted, plan))) fail("output_delivery_history_changed", 409);
  const archiveInput: OutputDeliveryManifestInput = { schemaVersion: 1, deliveryId: manifestId, planId: plan.id, planRevision: plan.revisionId, createdAt: String(manifest.createdAt), targets: pinned.map((entry) => ({ targetId: entry.targetId, fileId: entry.assetId, acceptanceId: entry.acceptanceId })), ...(savedScope ? { scope: savedScope } : {}), ...history };
  const model = requireCompleteOutputReadModel(await readOutputModel(trusted));
  const fileIds = new Set(pinned.map((entry) => entry.assetId));
  const files = model.assets.filter((asset) => fileIds.has(asset.id)).map((asset) => ({ id: asset.id, byteLength: asset.byteLength, kind: asset.mediaKind }));
  if (files.length !== fileIds.size) fail("output_delivery_file_inventory_changed", 409);
  const currentParts = planOutputDeliveryParts(files, archiveInput);
  const parts = Array.isArray(manifest.parts) ? manifest.parts as OutputDeliveryPart[] : currentParts;
  if (canonicalOutputJson(parts) !== canonicalOutputJson(currentParts)) fail("output_delivery_package_changed", 409);
  const requestedPart = new URL(trusted.request.url).searchParams.get("part") ?? "1";
  if (!/^[1-9]\d*$/u.test(requestedPart)) fail("invalid_output_delivery_part", 400);
  const part = parts.find((candidate) => candidate.index === Number(requestedPart));
  if (!part) fail("output_delivery_part_not_found", 404);
  if (part.fileIds.length > MAX_OUTPUT_DELIVERY_PART_READS) fail("output_delivery_package_needs_repreparation", 409);
  const assets = new Map<string, Awaited<ReturnType<typeof loadExactAsset>>>();
  for (const fileId of part.fileIds) {
    const evidence = model.assetEvidence.get(fileId);
    if (!evidence) fail("output_asset_unavailable", 404);
    assets.set(fileId, await loadExactAsset(trusted, fileId, evidence));
  }
  const archiveFiles = [...assets.entries()].map(([id, asset]) => ({ id, name: asset.name, bytes: asset.bytes, expectedSha256: asset.inspection.sha256! }));
  const archiveManifest = { ...archiveInput, packagePart: { index: part.index, parts } };
  if (archiveFiles.some(file => file.bytes.byteLength > MAX_OUTPUT_ASSET_BYTES)) {
    // Large meshes remain singleton parts. Their hashes are rechecked before
    // the same final authority proof discloses a bounded streaming ZIP.
    const archive = await createOutputDeliveryArchiveStream(archiveFiles, archiveManifest, { snapshot: false });
    const completion = archive.manifest.deliveryStatus, packageCount = archive.manifest.packagePart.count;
    return discloseOutputResponse(trusted, () => ({ body: archive.stream, init: { headers: { "content-type": archive.mimeType, "content-length": String(archive.byteLength), "content-disposition": `attachment; filename="forma-outputs-${completion}${packageCount > 1 ? `-part-${part.index}-of-${packageCount}` : ""}.zip"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-output-delivery-completion": completion, "x-output-delivery-scope": "entire-delivery-package", "x-output-package-part": String(part.index), "x-output-package-parts": String(packageCount), "x-output-contains-complete-package": packageCount === 1 ? "true" : "false" } } }), deliveryAssertions(trusted, plan, pinned));
  }
  const archive = await createOutputDeliveryArchive(archiveFiles, archiveManifest);
  const completion = archive.manifest.deliveryStatus, packageCount = archive.manifest.packagePart.count;
  // The shared final proof owns synchronous construction of this exact archive response.
  return discloseOutputResponse(trusted, () => ({ body: ownedBuffer(archive.bytes), init: { headers: { "content-type": archive.mimeType, "content-disposition": `attachment; filename="forma-outputs-${completion}${packageCount > 1 ? `-part-${part.index}-of-${packageCount}` : ""}.zip"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-output-delivery-completion": completion, "x-output-delivery-scope": "entire-delivery-package", "x-output-package-part": String(part.index), "x-output-package-parts": String(packageCount), "x-output-contains-complete-package": packageCount === 1 ? "true" : "false", "x-output-sha256": archive.sha256 } } }),
    deliveryAssertions(trusted, plan, pinned));
}

async function downloadAsset(trusted: OutputTrustedContext, assetId: string) {
  const asset = await loadExactAsset(trusted, assetId);
  return discloseOutputResponse(trusted, () => ({ body: assetBuffer(asset.bytes), init: { headers: { "content-type": asset.inspection.mimeType!, "content-disposition": `attachment; filename="output.${asset.inspection.extension}"; filename*=UTF-8''${encodeURIComponent(asset.name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-output-sha256": asset.inspection.sha256!, "x-output-review": "File inspection download does not establish assignment acceptance or complete delivery." } } }), [
    { sql: "EXISTS(SELECT 1 FROM output_assets asset JOIN event_private_payloads body ON body.private_event_id=asset.created_event_id AND body.redacted_at IS NULL WHERE asset.scope_key=? AND asset.asset_id=? AND asset.document_id=? AND asset.redacted_at IS NULL AND asset.content_sha256=?)", bindings: [trusted.scope.key, assetId, trusted.scope.documentId, asset.inspection.sha256!] }], outputAssetReadAssertions(trusted.scope, [asset.row]));
}


type OutputCommittedDisclosure = { scope: OutputScope; receipt: OutputCommandReceipt; replayed: boolean };

/** The same current read authority and exact retained bytes certify every private response. */
async function discloseOutputResponse(trusted: OutputTrustedContext, prepare: () => { body: BodyInit | null; init: ResponseInit }, extra: readonly OutputSqlAssertion[] = [], retainedRows: readonly OutputSqlAssertion[] = []): Promise<Response> {
  if (!trusted.sourcePrivateCaptured) fail("output_private_evidence_unavailable", 410);
  // A known non-ready source still permits free reading/editing of the user's
  // retained Output history. A source certified live for this response must
  // not cross its captured expiry and still be disclosed as verified.
  const pending = outputReadModels.get(trusted), model = pending ? await pending : null;
  const source = [...trusted.sourceAssertions, ...(trusted.context ? outputActiveSourceDeadlineAssertions(trusted.context) : [])];
  const bodies = [...retainedOutputBodyAssertions(trusted.scope), ...(model?.assertions ?? []), ...retainedRows];
  const authority = [outputScopeAuthority(trusted.scope, "read")];
  const selectedExpiry = trusted.projectContext?.expiresAt;
  const selectedDeadline = selectedExpiry === undefined ? Number.POSITIVE_INFINITY : Date.parse(selectedExpiry);
  if (trusted.scope.kind === "project") {
    if (!selectedExpiry || !Number.isFinite(selectedDeadline)) fail("output_execution_authority_revoked", 403);
    authority.push({ sql: "EXISTS(SELECT 1 FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND project_access_id=? AND organization_id=? AND expires_at=? AND revoked_at IS NULL)",
      bindings: [trusted.scope.contextId, trusted.scope.actorUserId, trusted.scope.projectAccessId, trusted.scope.organizationId, selectedExpiry] });
  }
  const metadata = [
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${trusted.scope.ownerUserId}`, trusted.ownerHead] },
    ...(trusted.scope.kind === "project" ? [{ sql: "(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?", bindings: [trusted.scope.projectAccessId, trusted.scope.organizationId, trusted.projectHead] }] : []),
    ...source, ...extra,
  ] as OutputSqlAssertion[];
  const checks = await trusted.env.DB.batch<Record<string, unknown>>(outputProofReadStatements(trusted.env, [...authority, ...bodies, ...metadata]));
  const current = (start: number, count: number) => {
    if (checks.length !== authority.length + bodies.length + metadata.length) return false;
    for (let index = start; index < start + count; index++) {
      const result = checks[index];
      if (!result || result.success !== true || Number(result.results?.[0]?.current) !== 1) return false;
    }
    return true;
  };
  if (!current(0, authority.length)) fail("output_execution_authority_revoked", 403);
  if (!current(authority.length, bodies.length)) fail("output_private_evidence_unavailable", 410);
  if (!current(authority.length + bodies.length, metadata.length)) fail("output_source_changed_during_read", 409);
  const sourceDeadline = Math.min(Number.POSITIVE_INFINITY, ...source.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [Number.isFinite(assertion.deadlineMs) ? assertion.deadlineMs : 0]));
  // This frame owns the last awaited proof and the actual response. Encode first:
  // even a large complete plan cannot cross a known deadline while serializing.
  // This certifies the observed final state, not an atomic database/HTTP delivery.
  const response = prepare();
  if (Date.now() >= selectedDeadline) fail("output_execution_authority_revoked", 403);
  if (Date.now() >= sourceDeadline) fail("output_private_evidence_unavailable", 410);
  return new Response(response.body, response.init);
}
function discloseOutputJson(trusted: OutputTrustedContext, value: unknown, status = 200, extra: readonly OutputSqlAssertion[] = []) {
  return discloseOutputResponse(trusted, () => ({
    body: ownedBuffer(new TextEncoder().encode(JSON.stringify(outputJsonValue(value)))),
    init: { status, headers: { "content-type": "application/json", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } },
  }), extra);
}

/** A verified commit is never relabeled as a failed purchase merely because its view was withdrawn. */
async function withholdCommittedOutput(env: WorkerEnv, committed: OutputCommittedDisclosure, status: number) {
  const proof = outputCommandReceiptAssertion(committed.scope, committed.receipt);
  const [authority, checked] = await env.DB.batch<Record<string, unknown>>(outputProofReadStatements(env, [outputScopeAuthority(committed.scope, "read"), proof]));
  const authorityDenied = status === 401 || status === 403 || authority?.success === false || Number(authority?.results[0]?.current) !== 1;
  const responseStatus = authorityDenied ? status === 401 ? 401 : 403 : 410;
  const code = authorityDenied ? "output_execution_authority_revoked" : "output_private_evidence_unavailable";
  if (checked?.success === false || Number(checked?.results[0]?.current) !== 1) return json({ error: code }, responseStatus);
  const { receipt, replayed } = committed;
  return Response.json({ ok: true, replayed, command: { action: receipt.action, eventId: receipt.eventId }, appended: [], snapshot: null,
    privateUnavailable: true, receipt: { committed: true, clientMutationId: receipt.key, action: receipt.action, eventId: receipt.eventId },
    error: code, errorCode: code }, { status: responseStatus, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

function responseCommand(receipt: { action: string; eventId: string; payload: Record<string, unknown> }, documentId: string): OutputCommandResponse["command"] {
  const payload = receipt.payload;
  const savedParts = record(payload.manifest).parts;
  const partCount = Array.isArray(savedParts) && savedParts.length ? savedParts.length : 1;
  const downloadUrl = typeof payload.manifest_id === "string" ? `${BASE}/deliveries/${encodeURIComponent(payload.manifest_id)}?documentId=${encodeURIComponent(documentId)}` : null;
  return { action: receipt.action, eventId: receipt.eventId,
    ...(typeof payload.plan_revision_id === "string" ? { planRevisionId: payload.plan_revision_id } : {}),
    ...(payload.preflight ? { preflight: payload.preflight as OutputPreflight } : {}),
    ...(typeof payload.grant_id === "string" ? { grantId: payload.grant_id } : {}),
    ...(typeof payload.asset_id === "string" ? { assetId: payload.asset_id } : {}),
    ...(typeof payload.result_id === "string" ? { resultId: payload.result_id } : {}),
    ...(typeof payload.acceptance_id === "string" ? { acceptanceId: payload.acceptance_id } : {}),
    ...(downloadUrl ? { manifestId: String(payload.manifest_id), downloadUrl, downloadUrls: Array.from({ length: partCount }, (_, index) => `${downloadUrl}${partCount > 1 ? `&part=${index + 1}` : ""}`), partCount } : {}) };
}

export async function handleOutputRequirements(request: Request, env: WorkerEnv, path: string, executionContext: WorkerExecutionContext, bridge?: OutputExecutionBridge): Promise<Response> {
  if (path !== BASE && !path.startsWith(`${BASE}/`)) return json({ error: "not_found" }, 404);
  let committed: OutputCommittedDisclosure | null = null;
  try {
    const url = new URL(request.url), isUpload = path === `${BASE}/assets` && request.method === "POST";
    let body: Record<string, unknown> = {};
    if (request.method === "POST" && !isUpload) {
      const raw = new TextDecoder().decode(await readBoundedRequest(request, MAX_COMMAND_BYTES));
      try { body = record(JSON.parse(raw)); } catch { return json({ error: "invalid_json" }, 400); }
    }
    const documentId = identifier(body.documentId ?? url.searchParams.get("documentId"), "document_id_required");
    const action = isUpload ? "adopt" : String(body.action ?? "");
    const permission: OutputCommandPermission = ["save", "remove", "bind", "adopt", "confirm"].includes(action) ? "author" : ["preflight", "authorize", "run"].includes(action) ? "request" : action === "review" ? "review" : "read";
    const trusted = await loadOutputTrustedContext(request, env, documentId, permission);
    if (trusted instanceof Response) return trusted;
    await ensureOutputRequirementsSchema(env);
    if (request.method === "GET") {
      if (path === BASE) return await discloseOutputJson(trusted, await buildSnapshot(trusted, bridge));
      const asset = /^\/api\/output-requirements\/assets\/([^/]+)$/u.exec(path), delivery = /^\/api\/output-requirements\/deliveries\/([^/]+)$/u.exec(path);
      if (asset) return await downloadAsset(trusted, identifier(decodeURIComponent(asset[1])));
      if (delivery) return await downloadDelivery(trusted, identifier(decodeURIComponent(delivery[1])));
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!isUpload && path !== BASE) return json({ error: "not_found" }, 404);
    if (!isUpload && !["save", "remove", "confirm", "preflight", "authorize", "run", "bind", "review", "export"].includes(action)) return json({ error: "unknown_output_action" }, 400);
    const digest = isUpload ? "" : await outputDigest(body);
    if (!isUpload) {
      parseOutputRevision(body.expectedRevision);
      const replay = await readOutputCommand(env, trusted.scope, identifier(body.clientMutationId, "client_mutation_id_required"), digest, { allowUnavailableReceipt: true });
      if (replay) {
        committed = { scope: trusted.scope, receipt: replay, replayed: true };
        if (replay.privateUnavailable) return await withholdCommittedOutput(env, committed, 410);
        if (replay.action === "run") await resumeRecordedOutputRun(trusted, identifier(replay.payload.grant_id, "grant_id_required"), bridge, executionContext);
        const current = replay.action === "run" ? await loadOutputTrustedContext(request, env, documentId, "read") : trusted;
        if (current instanceof Response) return await withholdCommittedOutput(env, committed, current.status);
        inheritRetainedOutputPrivateBodies(trusted.scope, current.scope);
        const snapshot = await buildSnapshot(current, bridge);
        return await discloseOutputJson(current, { ok: true, replayed: true, command: responseCommand(replay, documentId), appended: [], snapshot } satisfies OutputCommandResponse,
          200, [outputCommandReceiptAssertion(committed.scope, replay)]);
      }
      commandWrite(trusted, body, digest, permission);
    }
    const saved = isUpload ? await storeUpload(trusted, request)
      : action === "save" ? await saveRequirement(trusted, body, digest)
      : action === "remove" ? await removeRequirement(trusted, body, digest)
      : action === "confirm" ? await confirmPlan(trusted, body, digest)
      : action === "preflight" ? await preflightPlan(trusted, body, digest, bridge)
      : action === "authorize" ? await authorizePlan(trusted, body, digest, bridge)
      : action === "run" ? await runGrant(trusted, body, digest, bridge, executionContext)
      : action === "bind" ? await bindResult(trusted, body, digest, bridge)
      : action === "review" ? await reviewResult(trusted, body, digest)
      : await prepareDelivery(trusted, body, digest, bridge);
    if (saved instanceof Response) {
      const bytes = saved.body === null ? null : await saved.arrayBuffer();
      return await discloseOutputResponse(trusted, () => ({ body: bytes, init: { status: saved.status, statusText: saved.statusText, headers: saved.headers } }));
    }
    committed = { scope: trusted.scope, receipt: saved.receipt, replayed: saved.replayed };
    if (saved.receipt.privateUnavailable) return await withholdCommittedOutput(env, committed, 410);
    const latest = await loadOutputTrustedContext(request, env, documentId, "read");
    if (latest instanceof Response) return await withholdCommittedOutput(env, committed, latest.status);
    inheritRetainedOutputPrivateBodies(trusted.scope, latest.scope);
    const snapshot = await buildSnapshot(latest, bridge);
    return await discloseOutputJson(latest, { ok: true, replayed: saved.replayed, command: responseCommand(saved.receipt, documentId), appended: saved.events, snapshot } satisfies OutputCommandResponse,
      200, [outputCommandReceiptAssertion(committed.scope, saved.receipt)]);
  } catch (error) {
    if (committed) {
      try { return await withholdCommittedOutput(env, committed, error instanceof OutputConflictError ? error.status : 410); }
      catch { return json({ error: "output_private_evidence_unavailable" }, 410); }
    }
    if (error instanceof OutputConflictError) return json({ error: error.code }, error.status);
    if (error instanceof ContextIntegrityError) return json({ error: error.code }, 409);
    if (String(error).includes("CHECK constraint failed")) return json({ error: "output_revision_or_authority_changed" }, 409);
    // Never expose private source, filenames, provider prompts or internal SQL through errors.
    return json({ error: "output_requirements_failed", message: "This Output operation could not be completed. Saved requirements and historical work remain available." }, 500);
  }
}
