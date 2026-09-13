import { foldEvents, type CreativeProjection } from "../src/model/events.ts";
import { inspectOutputRequirement, parseOutputRequirement, validateOutputCountPolicy, type OutputCountPolicy, type OutputQuantity, type OutputRequirementSpec } from "../src/model/output-requirements.ts";
import type { OutputRequirementRow, OutputPlanSuggestions } from "../src/model/output-delivery-contract.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority.ts";
import { captureOutputGovernanceAssertions } from "./output-requirement-governance-assertions.ts";
import { issueOutputGovernanceWitness } from "./output-governance-witness.ts";
import { verifyOutputSourceEvidence } from "./output-source-evidence-capacity.ts";
import { hasCapability, requireConsent } from "./principal-request-core.ts";
import { readProjectRequestContext } from "./project-request-context.ts";
import { prepareProjectSourceEventsStatement, projectSourceProjectionCurrentAssertion } from "./project-source-read.ts";
import { readEvents, streamHead } from "./event-stream-read.ts";
import { serializeEvent } from "./event-read-primitives.ts";
import { outputScopeAuthority, OutputConflictError, type OutputCommandPermission, type OutputScope, type OutputSqlAssertion } from "./output-command-core.ts";
import { record, fail, json, outputDigest, captureOutputPrivateSources, verifyOutputSourceRead } from "./output-disclosure-proof.ts";
import type { requireUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";

// These are verification limits, never changes to the authored source scope.
// Native and owned-file limits retain measured request headroom for their complete routes.
const OUTPUT_OWNED_SOURCE_OBJECT_CAPACITY = 4;
const OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY = 1;
const OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT = 2;

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
  return { head: Number(row.owner_head), projectHead: Number(row.project_head), events: source.results.map(serializeEvent), assertion: projection as OutputSqlAssertion };
}

export async function continueOutputTrustedContext(
  request: Request,
  env: WorkerEnv,
  documentId: string,
  permission: OutputCommandPermission,
  auth: Awaited<ReturnType<typeof requireUser>>,
): Promise<OutputTrustedContext | Response> {
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

export { OUTPUT_OWNED_SOURCE_OBJECT_CAPACITY, OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY, OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT, outputSourceDigests, outputRequirements, normalizePlanSuggestions, readOutputProjectSourceSnapshot };
