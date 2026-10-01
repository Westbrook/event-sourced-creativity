import { MAINTENANCE_ADOPTION_PROTOCOL, readMaintenanceIntent, readMaintenanceOperationReceipt, maintenanceIntentDigest,
  type MaintenanceOperation, type MaintenanceIntent } from "../src/experiences/maintenance-adoption-contract.ts";
import { handleMaintenanceAdoptionRoutes, transitionMaintenanceAdoption, readAdoptedMaintenanceContext } from "./experience-maintenance-adoption.ts";
import { canonicalJson, digest, exactKeys, record } from "../src/experiences/compiler.ts";
import { REGISTERED_EXPERIENCE_MAINTENANCE, readExperienceMaintenanceForMaterial, previewExperienceMaintenanceForMaterial,
  REGISTERED_EXPERIENCE_MAINTENANCE_ADOPTIONS, type ExperienceMaintenanceAdoptionRegistration,
  type ExperienceMaintenanceRegistration } from "./experience-maintenance-material.ts";
import { describeExperiencePatch, proposePatch } from "../src/experiences/patches.ts";
import {
  EXPERIENCE_RELEASE_PROTOCOL, experienceBindingDigest, experienceEventId, experienceId, experienceIntentDigest, experienceReleaseHash,
  experienceRequestId, experienceTimestamp, experienceTransitionEventId,
  readExperienceIntent, readExperienceOperationReceipt, readExperienceProposal, readExperiencePublication,
  readExperienceReleaseBinding, readExperienceTransition, sameExperienceBinding, validExperienceDecisionId, readExperienceMaterialSelection,
  type ExperienceIntent, type ExperienceOperation, type ExperienceProposalIntent, type ExperiencePublicationIntent,
  type ExperienceReleaseBinding, type ExperienceTransitionIntent, type ExperienceMaterialSummary, type ExperienceMaterialInventory, type ExperienceMaterialDetail,
} from "../src/experiences/release-contract.ts";
import { canonicalDeliveryStatus, deliveryNeedsCompleteDependencies, deliveryNeedsEvidence, deliveryNeedsReleaseAuthority,
  deliveryTransitionAllowed } from "../src/platform/delivery-lifecycle.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { REGISTERED_EXPERIENCE_MATERIALS, resolveExperienceReleaseMaterial, listExperienceReleaseMaterials,
  type ExperienceReleaseMaterialRegistration, type ExperienceReleaseMaterial } from "./experience-release-material.ts";
import { productDeliveryAuthority, productDeliveryDependencies, productDeliveryReleaseAuthority,
  type ProductDeliveryAuthority, type ProductDeliveryPrincipal } from "./product-delivery-authority.ts";
import { requireCapability, type PilotUser } from "./pilot-policy.ts";
import { appendEvents, makeEvent, uuidV7, type WorkerEnv } from "./runtime.ts";

const STREAM = "platform:product-delivery", CLIENT = EXPERIENCE_RELEASE_PROTOCOL;
const eventTypes = { proposal: "ExperienceReleaseProposed", transition: "ExperienceReleaseDecisionTransitioned", publication: "ExperienceReleasePublished" } as const;
const maintenanceEventTypes = { "maintenance-proposal": "ExperienceMaintenanceAdoptionProposed",
  "maintenance-transition": "ExperienceMaintenanceDecisionTransitioned", "maintenance-adoption": "ExperienceMaintenanceAdopted" } as const;
type CommandOperation = ExperienceOperation | MaintenanceOperation;
type CommandIntent = ExperienceIntent | MaintenanceIntent;
const maintenanceOperation = (value: CommandOperation): value is MaintenanceOperation => Object.hasOwn(maintenanceEventTypes, value);
const clientFor = (operation: CommandOperation) => maintenanceOperation(operation) ? MAINTENANCE_ADOPTION_PROTOCOL : CLIENT;
const typeFor = (operation: CommandOperation) => maintenanceOperation(operation) ? maintenanceEventTypes[operation] : eventTypes[operation];
const commandIntentDigest = (operation: CommandOperation, actor: string, intent: CommandIntent) => maintenanceOperation(operation)
  ? maintenanceIntentDigest(operation, actor, intent as MaintenanceIntent) : experienceIntentDigest(operation, actor, intent as ExperienceIntent);
const headers = { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });
class ReleaseFailure extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
function fail(code: string, status = 409): never { throw new ReleaseFailure(code, status); }
const join = (...guards: ProductDeliveryAuthority[]): ProductDeliveryAuthority => ({ sql: guards.map(g => `(${g.sql})`).join(" AND "), bindings: guards.flatMap(g => g.bindings) });
const exactJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function materialSummary(value: ExperienceReleaseMaterial): ExperienceMaterialSummary {
  return { selection: { releaseHash: value.releaseHash, sourceHash: value.sourceHash, buildHash: value.buildHash, evaluationHash: value.evaluationHash },
    experienceId: value.release.definition.id, definitionRevision: value.release.definition.revision, output: value.release.output.output,
    evaluation: { outcome: value.evaluationReport.outcome, caseCount: value.evaluationReport.caseCount } };
}
/** A single typed JSON parameter keeps combined live proofs below D1's 100-bind limit. */
function packedProof(guard: ProductDeliveryAuthority) {
  let index = 0, quoted = false, sql = "";
  for (let offset = 0; offset < guard.sql.length; offset++) {
    const character = guard.sql[offset];
    if (character === "'") {
      sql += character;
      if (quoted && guard.sql[offset + 1] === "'") { sql += "'"; offset++; } else quoted = !quoted;
    } else if (character === "?" && !quoted) sql += `json_extract((SELECT body FROM experience_proof_values),'$[${index++}]')`;
    else sql += character;
  }
  if (index !== guard.bindings.length || quoted) fail("experience_release_proof_invalid", 503);
  return { sql, json: JSON.stringify(guard.bindings) };
}
const keyFor = async (operation: CommandOperation, actor: string, requestId: string) => `${clientFor(operation)}:${operation}:${await digest(actor)}:${requestId}`;
type Registrations = readonly ExperienceReleaseMaterialRegistration[];
type DecisionRow = { decision_id: string; title: string; audience: string; status: string; owner_user_id: string;
  owner_display_name: string; evidence: string; dependency_ids_json: string; created_by_user_id: string; created_at: string; updated_at: string };
type BindingRow = { decision_id: string; proposal_event_id: string; binding_hash: string; experience_id: string; channel: string; operation: string;
  release_hash: string; source_hash: string; build_hash: string; evaluation_hash: string; expected_head_revision: number;
  expected_head_event_id: string | null; rollback_event_id: string | null; created_at: string };
type HeadRow = { experience_id: string; channel: string; revision: number; publication_event_id: string; decision_id: string; binding_hash: string; release_hash: string; updated_at: string };
type ApprovalAuthority = { principal: ProductDeliveryPrincipal; impersonationId: string };
type OriginalRow = { event_id: string | null; receipt_event_id: string | null; receipt_sequence: number | null; client_event_id: string | null;
  stream_id: string; sequence: number; type: string; actor: string; client_id: string; correlation_id: string; payload: string;
  private_json: string | null; owner_id: string; redacted_at: string | null; original_event_exists?: number };
type Original = { row: OriginalRow; operation: ExperienceOperation; intent: ExperienceIntent; actorUserId: string;
  approvalAuthority: ApprovalAuthority | null; responseBody: NonNullable<Awaited<ReturnType<typeof readExperienceOperationReceipt>>> };

type MaintenanceOriginal = Omit<Original, "operation" | "intent" | "responseBody"> & { operation: MaintenanceOperation; intent: MaintenanceIntent;
  responseBody: NonNullable<Awaited<ReturnType<typeof readMaintenanceOperationReceipt>>> };
type AnyOriginal = Original | MaintenanceOriginal;

function approvalSnapshot(request: Request, actor: PilotUser): ApprovalAuthority {
  const encoded = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith("forma_impersonation="))?.slice(20) ?? "";
  let impersonationId = ""; try { impersonationId = decodeURIComponent(encoded); } catch { /* Invalid is absent, matching current Product guard. */ }
  return { principal: { userId: actor.userId, email: actor.email, role: actor.role, authorizationSnapshot: structuredClone(actor.authorizationSnapshot) }, impersonationId };
}
function readApprovalSnapshot(value: unknown): ApprovalAuthority | null {
  if (!record(value) || !exactKeys(value, ["principal", "impersonationId"]) || typeof value.impersonationId !== "string"
    || value.impersonationId.length > 4096 || !record(value.principal) || !exactKeys(value.principal, ["userId", "email", "role", "authorizationSnapshot"])) return null;
  const p = value.principal, s = p.authorizationSnapshot;
  if (![p.userId, p.email].every(x => typeof x === "string" && x.length > 0 && x.length <= 240)
    || typeof p.role !== "string" || !["admin", "creator", "agent", "viewer"].includes(p.role) || !record(s)
    || !exactKeys(s, ["updatedAt", "rawEpoch", "grants", "organizations", "projects", "identityPolicies", "canvasRequirements"])
    || [s.updatedAt, s.rawEpoch, s.grants, s.organizations, s.projects, s.identityPolicies].some(x => typeof x !== "string")
    || !Number.isSafeInteger(s.canvasRequirements)) return null;
  return value as unknown as ApprovalAuthority;
}
function approvalGuard(env: WorkerEnv, saved: ApprovalAuthority): ProductDeliveryAuthority {
  return productDeliveryReleaseAuthority(new Request("https://forma.invalid/", { headers: { cookie: `forma_impersonation=${encodeURIComponent(saved.impersonationId)}` } }), env, saved.principal);
}

function retained(original: AnyOriginal): ProductDeliveryAuthority {
  const r = original.row;
  return { sql: `EXISTS(SELECT 1 FROM event_client_receipts receipt JOIN events event ON event.event_id=receipt.event_id
    JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE receipt.stream_id=? AND receipt.client_event_id=?
      AND receipt.event_id=? AND receipt.sequence=? AND event.stream_id=? AND event.sequence=receipt.sequence
      AND event.type=? AND event.actor='user' AND event.client_id=? AND event.correlation_id=receipt.client_event_id AND event.payload=?
      AND secret.owner_id=? AND secret.redacted_at IS NULL AND secret.private_json=?)`,
    bindings: [STREAM, r.client_event_id, r.event_id, r.sequence, STREAM, r.type, r.client_id, r.payload, STREAM, r.private_json] };
}
async function prove(env: WorkerEnv, guard: ProductDeliveryAuthority, code = "experience_release_authority_changed") {
  const packed = packedProof(guard);
  if (!await env.DB.prepare("WITH experience_proof_values(body) AS(VALUES(?)) SELECT 1 AS experience_release_current WHERE " + packed.sql).bind(packed.json).first()) fail(code, 403);
}
async function readEligibility(env: WorkerEnv, admission: ProductDeliveryAuthority, eligibility: ProductDeliveryAuthority): Promise<boolean> {
  const packed = packedProof({ sql: `CASE WHEN (${eligibility.sql}) THEN 1 ELSE 0 END AS eligible WHERE ${admission.sql}`,
    bindings: [...eligibility.bindings, ...admission.bindings] });
  const current = await env.DB.prepare(`WITH experience_proof_values(body) AS(VALUES(?)) SELECT ${packed.sql}`).bind(packed.json).first<{ eligible: number }>();
  if (!current) fail("experience_release_authority_changed", 403);
  return current.eligible === 1;
}
const originalSelect = `SELECT receipt.client_event_id,receipt.event_id AS receipt_event_id,receipt.sequence AS receipt_sequence,
  event.event_id,event.stream_id,event.sequence,event.type,event.actor,event.client_id,event.correlation_id,event.payload,
  secret.private_json,secret.owner_id,secret.redacted_at`;

async function decodeOriginal(row: OriginalRow, client: typeof CLIENT | typeof MAINTENANCE_ADOPTION_PROTOCOL,
  expected?: { operation: CommandOperation; actor: string; intent?: CommandIntent }): Promise<AnyOriginal> {
  const maintenance = client === MAINTENANCE_ADOPTION_PROTOCOL;
  const unavailable = () => fail(maintenance ? "experience_maintenance_receipt_unavailable" : "experience_release_receipt_unavailable");
  if (!row.event_id || row.stream_id !== STREAM || row.actor !== "user" || row.client_id !== client
    || row.receipt_event_id !== row.event_id || row.receipt_sequence !== row.sequence || row.correlation_id !== row.client_event_id
    || row.owner_id !== STREAM || row.redacted_at !== null || typeof row.private_json !== "string" || row.private_json.length > 262144
    || typeof row.payload !== "string") return unavailable();
  let body: Record<string, unknown>, visible: Record<string, unknown>;
  try { body = JSON.parse(row.private_json); visible = JSON.parse(row.payload); } catch { return unavailable(); }
  if (!record(body) || !record(visible) || !exactKeys(body, ["operation", "request_id", "actor_user_id", "request_digest", "content_sha256", "source_digest", "intent", "acknowledgment", "approval_authority"])) return unavailable();
  const operation = body.operation as CommandOperation;
  if (!Object.hasOwn(maintenance ? maintenanceEventTypes : eventTypes, operation) || row.type !== typeFor(operation) || typeof body.actor_user_id !== "string"
    || expected && (expected.operation !== operation || expected.actor !== body.actor_user_id)) return unavailable();
  const intent = maintenance ? readMaintenanceIntent(operation as MaintenanceOperation, body.intent) : readExperienceIntent(operation as ExperienceOperation, body.intent);
  if (!intent || intent.requestId !== body.request_id || await keyFor(operation, body.actor_user_id, intent.requestId) !== row.client_event_id
    || publicEventPayload(row.event_id, body, true).privateJson !== row.private_json
    || JSON.stringify(publicEventPayload(row.event_id, body, true).payload) !== row.payload
    || body.source_digest !== await digest({ intent: body.intent, acknowledgment: body.acknowledgment, approvalAuthority: body.approval_authority })) return unavailable();
  if (expected?.intent && !exactJson(expected.intent, intent)) fail(maintenance ? "experience_maintenance_intent_conflict" : "experience_release_intent_conflict");
  const saved = body.approval_authority === null ? null : readApprovalSnapshot(body.approval_authority);
  if (body.approval_authority !== null && !saved || saved && (operation !== (maintenance ? "maintenance-transition" : "transition") || saved.principal.userId !== body.actor_user_id)) return unavailable();
  const receipt = { receipt: { version: 1, protocol: client, operation, requestId: intent.requestId,
    actorUserId: body.actor_user_id, intentDigest: body.request_digest, eventId: row.event_id, sequence: row.sequence,
    acknowledgmentDigest: body.content_sha256 }, result: body.acknowledgment };
  const decoded = maintenance
    ? await readMaintenanceOperationReceipt(receipt, { operation: operation as MaintenanceOperation, actorUserId: body.actor_user_id, intent: intent as MaintenanceIntent })
    : await readExperienceOperationReceipt(receipt, { operation: operation as ExperienceOperation, actorUserId: body.actor_user_id, intent: intent as ExperienceIntent });
  if (!decoded) return unavailable();
  return { row, operation, intent, actorUserId: body.actor_user_id, approvalAuthority: saved, responseBody: decoded } as AnyOriginal;
}

function originalRequest(env: WorkerEnv, authority: ProductDeliveryAuthority, operation: ExperienceOperation, actor: string, requestId: string, intent?: ExperienceIntent): Promise<Original | null>;
function originalRequest(env: WorkerEnv, authority: ProductDeliveryAuthority, operation: MaintenanceOperation, actor: string, requestId: string, intent?: MaintenanceIntent): Promise<MaintenanceOriginal | null>;
async function originalRequest(env: WorkerEnv, authority: ProductDeliveryAuthority, operation: CommandOperation, actor: string, requestId: string, intent?: CommandIntent): Promise<AnyOriginal | null> {
  const key = await keyFor(operation, actor, requestId);
  const row = await env.DB.prepare(`${originalSelect}, EXISTS(SELECT 1 FROM events orphan WHERE orphan.stream_id=? AND orphan.correlation_id=?) AS original_event_exists
    FROM(SELECT 1 WHERE ${authority.sql}) admitted
    LEFT JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=?
    LEFT JOIN events event ON event.event_id=receipt.event_id LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id`)
    .bind(STREAM, key, ...authority.bindings, STREAM, key).first<OriginalRow>();
  if (!row) fail("access_denied", 403);
  if (row.client_event_id === null) { if (row.original_event_exists) fail("experience_release_receipt_unavailable"); return null; }
  const original = await decodeOriginal(row, clientFor(operation), { operation, actor, intent });
  await prove(env, join(authority, retained(original)), "experience_release_receipt_unavailable");
  return original;
}
function originalEvent(env: WorkerEnv, eventId: string): Promise<Original>;
function originalEvent(env: WorkerEnv, eventId: string, client: typeof MAINTENANCE_ADOPTION_PROTOCOL): Promise<MaintenanceOriginal>;
async function originalEvent(env: WorkerEnv, eventId: string, client: typeof CLIENT | typeof MAINTENANCE_ADOPTION_PROTOCOL = CLIENT): Promise<AnyOriginal> {
  const row = await env.DB.prepare(`${originalSelect} FROM events event
    LEFT JOIN event_client_receipts receipt ON receipt.event_id=event.event_id AND receipt.stream_id=?
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.event_id=?`)
    .bind(STREAM, eventId).first<OriginalRow>();
  if (!row) fail("experience_release_receipt_unavailable");
  return decodeOriginal(row, client);
}

function decisionValue(row: DecisionRow) {
  let dependencyIds: unknown; try { dependencyIds = JSON.parse(row.dependency_ids_json); } catch { fail("experience_release_decision_unavailable"); }
  if (!Array.isArray(dependencyIds) || dependencyIds.length > 10 || dependencyIds.some(id => typeof id !== "string" || !id)
    || new Set(dependencyIds).size !== dependencyIds.length || typeof row.status !== "string"
    || canonicalDeliveryStatus(row.status) !== row.status) fail("experience_release_decision_unavailable");
  return { decisionId: row.decision_id, title: row.title, audience: row.audience, status: row.status, ownerUserId: row.owner_user_id,
    owner: row.owner_display_name, evidence: row.evidence, dependencyIds: dependencyIds as string[], createdAt: row.created_at, updatedAt: row.updated_at };
}
function decisionProof(row: DecisionRow): ProductDeliveryAuthority {
  return { sql: `EXISTS(SELECT 1 FROM delivery_decisions d WHERE (d.decision_id,d.title,d.audience,d.status,d.owner_user_id,d.owner_display_name,
      d.evidence,d.dependency_ids_json,d.created_by_user_id,d.created_at,d.updated_at)=(?,?,?,?,?,?,?,?,?,?,?))`,
    bindings: [row.decision_id, row.title, row.audience, row.status, row.owner_user_id, row.owner_display_name, row.evidence,
      row.dependency_ids_json, row.created_by_user_id, row.created_at, row.updated_at] };
}
const bindingValue = (row: BindingRow) => readExperienceReleaseBinding({ version: 1, operation: row.operation, channel: row.channel,
  experienceId: row.experience_id, releaseHash: row.release_hash, sourceHash: row.source_hash, buildHash: row.build_hash, evaluationHash: row.evaluation_hash,
  expectedHead: { revision: row.expected_head_revision, eventId: row.expected_head_event_id }, rollbackPublicationEventId: row.rollback_event_id });
function bindingProof(row: BindingRow): ProductDeliveryAuthority {
  return { sql: `EXISTS(SELECT 1 FROM delivery_experience_bindings b WHERE b.decision_id=? AND b.proposal_event_id=? AND b.binding_hash=?
    AND b.experience_id=? AND b.channel=? AND b.operation=? AND b.release_hash=? AND b.source_hash=? AND b.build_hash=? AND b.evaluation_hash=?
    AND b.expected_head_revision=? AND b.expected_head_event_id IS ? AND b.rollback_event_id IS ? AND b.created_at=?)`,
    bindings: [row.decision_id, row.proposal_event_id, row.binding_hash, row.experience_id, row.channel, row.operation, row.release_hash,
      row.source_hash, row.build_hash, row.evaluation_hash, row.expected_head_revision, row.expected_head_event_id, row.rollback_event_id, row.created_at] };
}
async function boundDecision(env: WorkerEnv, decisionId: string) {
  if (!validExperienceDecisionId(decisionId)) fail("experience_release_binding_unavailable");
  const row = await env.DB.prepare("SELECT * FROM delivery_decisions WHERE decision_id=?").bind(decisionId).first<DecisionRow>();
  const bindingRow = await env.DB.prepare("SELECT * FROM delivery_experience_bindings WHERE decision_id=?").bind(decisionId).first<BindingRow>();
  if (!row || !bindingRow || row.audience !== "product") fail("experience_release_binding_unavailable");
  const binding = bindingValue(bindingRow), original = await originalEvent(env, bindingRow.proposal_event_id);
  if (!binding || original.operation !== "proposal" || !sameExperienceBinding((original.intent as ExperienceProposalIntent).binding, binding)
    || bindingRow.binding_hash !== await experienceBindingDigest(binding) || original.responseBody.result.bindingHash !== bindingRow.binding_hash
    || !record(original.responseBody.result.decision) || original.responseBody.result.decision.decisionId !== decisionId
    || original.actorUserId !== row.created_by_user_id || original.responseBody.result.decision.createdAt !== row.created_at
    || bindingRow.created_at !== row.created_at) fail("experience_release_binding_unavailable");
  const decision = decisionValue(row);
  if (!exactJson(decision.dependencyIds, (original.intent as ExperienceProposalIntent).dependencyIds)) fail("experience_release_binding_unavailable");
  return { row, bindingRow, binding, original, decision, proof: join(bindingProof(bindingRow), retained(original)) };
}
type Bound = Awaited<ReturnType<typeof boundDecision>>;
function headExpected(binding: ExperienceReleaseBinding): ProductDeliveryAuthority {
  return binding.expectedHead.revision === 0
    ? { sql: "NOT EXISTS(SELECT 1 FROM experience_release_heads WHERE experience_id=? AND channel=?)", bindings: [binding.experienceId, binding.channel] }
    : { sql: "EXISTS(SELECT 1 FROM experience_release_heads WHERE experience_id=? AND channel=? AND revision=? AND publication_event_id=?)",
      bindings: [binding.experienceId, binding.channel, binding.expectedHead.revision, binding.expectedHead.eventId] };
}
function headValue(row: HeadRow) {
  if (!experienceId(row.experience_id) || row.channel !== "managed-fixture" || !Number.isSafeInteger(row.revision) || row.revision < 1
    || !experienceEventId(row.publication_event_id) || !validExperienceDecisionId(row.decision_id)
    || !experienceReleaseHash(row.binding_hash) || !experienceReleaseHash(row.release_hash) || !experienceTimestamp(row.updated_at)) fail("experience_release_head_unavailable");
  return { experienceId: row.experience_id, channel: row.channel, revision: row.revision, publicationEventId: row.publication_event_id,
    decisionId: row.decision_id, bindingHash: row.binding_hash, releaseHash: row.release_hash };
}
function currentHeadProof(row: HeadRow): ProductDeliveryAuthority {
  return { sql: `EXISTS(SELECT 1 FROM experience_release_heads WHERE (experience_id,channel,revision,publication_event_id,decision_id,binding_hash,release_hash,updated_at)=(?,?,?,?,?,?,?,?))`,
    bindings: [row.experience_id, row.channel, row.revision, row.publication_event_id, row.decision_id, row.binding_hash, row.release_hash, row.updated_at] };
}
async function material(registrations: Registrations, binding: ExperienceReleaseBinding) {
  const resolved = await resolveExperienceReleaseMaterial(registrations, { releaseHash: binding.releaseHash, sourceHash: binding.sourceHash, buildHash: binding.buildHash, evaluationHash: binding.evaluationHash });
  if (!resolved || resolved.release.definition.id !== binding.experienceId) fail("experience_release_material_unavailable");
  return resolved;
}
async function approvalProvenance(env: WorkerEnv, bound: Bound) {
  if (bound.row.status !== "approved") fail("experience_release_approval_required");
  const approval = await originalEvent(env, experienceTransitionEventId(bound.row.decision_id, bound.row.updated_at));
  if (approval.operation !== "transition" || !approval.approvalAuthority || (approval.intent as ExperienceTransitionIntent).status !== "approved"
    || !exactJson(approval.responseBody.result.decision, bound.decision)
    || !sameExperienceBinding((approval.intent as ExperienceTransitionIntent).experienceRelease, bound.binding)
    || [bound.row.created_by_user_id, bound.row.owner_user_id].includes(approval.actorUserId)) fail("experience_release_approval_unavailable");
  return { approval, proof: join(bound.proof, decisionProof(bound.row), retained(approval)) };
}
async function eligibleApproval(env: WorkerEnv, bound: Bound, registrations: Registrations) {
  await material(registrations, bound.binding);
  const provenance = await approvalProvenance(env, bound);
  return { approval: provenance.approval, proof: join(provenance.proof, approvalGuard(env, provenance.approval.approvalAuthority!), productDeliveryDependencies(bound.decision.dependencyIds, true)) };
}
async function rollbackProof(env: WorkerEnv, binding: ExperienceReleaseBinding, registrations: Registrations): Promise<ProductDeliveryAuthority> {
  if (binding.operation !== "rollback") return { sql: "1", bindings: [] };
  const publication = await originalEvent(env, binding.rollbackPublicationEventId!);
  if (publication.operation !== "publication") fail("experience_release_rollback_target_unavailable");
  const prior = publication.intent as ExperiencePublicationIntent;
  // Any prior publication can be the exact target. Each rollback carries its
  // own independent approval; ancestor approvals are not inherited authority.
  if (prior.binding.experienceId !== binding.experienceId || prior.binding.channel !== binding.channel
    || ["releaseHash", "sourceHash", "buildHash", "evaluationHash"].some(key => prior.binding[key as keyof ExperienceReleaseBinding] !== binding[key as keyof ExperienceReleaseBinding])) fail("experience_release_rollback_target_unavailable");
  const target = await boundDecision(env, prior.decisionId), approval = await eligibleApproval(env, target, registrations);
  if (prior.expectedDecisionUpdatedAt !== target.row.updated_at || prior.approvalEventId !== approval.approval.row.event_id
    || !sameExperienceBinding(prior.binding, target.binding)) fail("experience_release_rollback_target_unavailable");
  return join(retained(publication), approval.proof);
}
async function eligibleOwner(env: WorkerEnv, ownerUserId: string) {
  const owner = await env.DB.prepare(`SELECT user_id,display_name FROM users WHERE user_id=? AND (role='admin' OR EXISTS(
    SELECT 1 FROM capability_grants g WHERE g.user_id=users.user_id AND g.capability='product.delivery.manage' AND g.scope_type='platform'
      AND g.organization_id IS NULL AND g.project_access_id IS NULL AND g.status='active' AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))`).bind(ownerUserId).first<{ user_id: string; display_name: string }>();
  if (!owner) fail("eligible_delivery_owner_required", 403);
  return { owner, proof: { sql: `EXISTS(SELECT 1 FROM users owner WHERE owner.user_id=? AND owner.display_name=? AND (owner.role='admin' OR EXISTS(
    SELECT 1 FROM capability_grants g WHERE g.user_id=owner.user_id AND g.capability='product.delivery.manage' AND g.scope_type='platform'
      AND g.organization_id IS NULL AND g.project_access_id IS NULL AND g.status='active' AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))`, bindings: [owner.user_id, owner.display_name] } satisfies ProductDeliveryAuthority };
}

async function operationEvent(operation: CommandOperation, actor: PilotUser, intent: CommandIntent, acknowledgment: Record<string, unknown>, eventId?: string, authority: ApprovalAuthority | null = null) {
  const key = await keyFor(operation, actor.userId, intent.requestId), event = makeEvent(STREAM, 0, "user", clientFor(operation), key, typeFor(operation), {
    operation, request_id: intent.requestId, actor_user_id: actor.userId, request_digest: await commandIntentDigest(operation, actor.userId, intent),
    content_sha256: await digest(acknowledgment), source_digest: await digest({ intent, acknowledgment, approvalAuthority: authority }),
    intent, acknowledgment, approval_authority: authority,
  });
  if (eventId) event.eventId = eventId;
  return event;
}
/** A false predicate must fail the whole transaction, not merely omit the receipt. */
function finalReceipt(env: WorkerEnv, event: ReturnType<typeof makeEvent>, proof: ProductDeliveryAuthority, client: typeof CLIENT | typeof MAINTENANCE_ADOPTION_PROTOCOL = CLIENT) {
  const packed = packedProof(proof);
  return env.DB.prepare(`WITH experience_proof_values(body) AS(VALUES(?)) INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)
    VALUES(?,?,CASE WHEN changes()=1 AND ${packed.sql} AND EXISTS(SELECT 1 FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      WHERE event.event_id=? AND event.stream_id=? AND event.sequence=? AND event.client_id=? AND event.type=? AND event.correlation_id=?
        AND secret.owner_id=? AND secret.redacted_at IS NULL AND secret.private_json=?)
      AND NOT EXISTS(SELECT 1 FROM events other WHERE other.stream_id=? AND other.correlation_id=? AND other.event_id!=?)
      THEN ? ELSE NULL END,?,?)`).bind(packed.json, STREAM, event.correlationId,
        event.eventId, STREAM, event.sequence, client, event.type, event.correlationId, STREAM, JSON.stringify(event.payload),
        STREAM, event.correlationId, event.eventId, event.eventId, event.sequence, event.recordedAt);
}
async function settle(env: WorkerEnv, authority: ProductDeliveryAuthority, actor: PilotUser, operation: ExperienceOperation, intent: ExperienceIntent) {
  const original = await originalRequest(env, authority, operation, actor.userId, intent.requestId, intent);
  return original ? response(original.responseBody, operation === "transition" ? 200 : 201) : response({ error: "experience_release_commit_unknown", noAutomaticRetry: true }, 503);
}

/** Maintenance receives the existing custody and transaction primitives, not a second receipt framework.
 * Explicit protocol adapters keep the original release decoder and routes closed. */
const maintenancePorts = {
  fail, response, failureResponse, isFailure: (error: unknown) => error instanceof ReleaseFailure, join, exactJson, prove, readEligibility, decisionValue, decisionProof, eligibleOwner,
  approvalSnapshot, approvalGuard, operationEvent, readJson: readExperienceReleaseJson,
  readModelPreviewJson: (request: Request) => readBoundedExperienceJson(request, 65536),
  retained: (original: MaintenanceOriginal) => retained(original),
  originalRequest: (env: WorkerEnv, authority: ProductDeliveryAuthority, operation: MaintenanceOperation, actor: string, requestId: string, intent?: MaintenanceIntent) => originalRequest(env, authority, operation, actor, requestId, intent),
  originalEvent: (env: WorkerEnv, eventId: string) => originalEvent(env, eventId, MAINTENANCE_ADOPTION_PROTOCOL),
  finalReceipt: (env: WorkerEnv, event: ReturnType<typeof makeEvent>, proof: ProductDeliveryAuthority) => finalReceipt(env, event, proof, MAINTENANCE_ADOPTION_PROTOCOL),
  async settle(env: WorkerEnv, authority: ProductDeliveryAuthority, actor: PilotUser, operation: MaintenanceOperation, intent: MaintenanceIntent) {
    const original = await originalRequest(env, authority, operation, actor.userId, intent.requestId, intent);
    return original ? response(original.responseBody, operation === "maintenance-transition" ? 200 : 201)
      : response({ error: "experience_maintenance_commit_unknown", noAutomaticRetry: true, generationAvailable: false }, 503);
  },
};
export type MaintenanceAdoptionPorts = Omit<typeof maintenancePorts, "fail"> & { fail: (code: string, status?: number) => never };

export async function handleExperienceMaintenanceDeliveryTransition(request: Request, env: WorkerEnv, actor: PilotUser, raw: unknown,
  registrations: Registrations = REGISTERED_EXPERIENCE_MATERIALS,
  adoptionRegistrations: readonly ExperienceMaintenanceAdoptionRegistration[] = REGISTERED_EXPERIENCE_MAINTENANCE_ADOPTIONS): Promise<Response> {
  try { return await transitionMaintenanceAdoption(maintenancePorts, request, env, actor, raw, registrations, adoptionRegistrations); }
  catch (error) { return failureResponse(error); }
}

/** Internal-only adopted baseline consumer; it does not register or expose captures. */
export function resolveExperienceAdoptedMaintenanceContext(request: Request, env: WorkerEnv, actor: PilotUser, base: unknown, currentObservationHash: string,
  registrations: Registrations = REGISTERED_EXPERIENCE_MATERIALS,
  adoptionRegistrations: readonly ExperienceMaintenanceAdoptionRegistration[] = REGISTERED_EXPERIENCE_MAINTENANCE_ADOPTIONS) {
  return readAdoptedMaintenanceContext(maintenancePorts, request, env, actor, base, currentObservationHash, registrations, adoptionRegistrations);
}

async function propose(request: Request, env: WorkerEnv, actor: PilotUser, intent: ExperienceProposalIntent, registrations: Registrations) {
  const authority = productDeliveryAuthority(request, env, actor), old = await originalRequest(env, authority, "proposal", actor.userId, intent.requestId, intent);
  if (old) return response(old.responseBody, 201);
  await material(registrations, intent.binding);
  const owner = await eligibleOwner(env, intent.ownerUserId), rollback = await rollbackProof(env, intent.binding, registrations);
  const bindingHash = await experienceBindingDigest(intent.binding), now = new Date().toISOString(), decisionId = `experience-release:v1:${uuidV7()}`;
  const row: DecisionRow = { decision_id: decisionId, title: intent.title, audience: "product", status: "planned", owner_user_id: owner.owner.user_id,
    owner_display_name: owner.owner.display_name, evidence: intent.evidence, dependency_ids_json: JSON.stringify(intent.dependencyIds), created_by_user_id: actor.userId, created_at: now, updated_at: now };
  const result = { decision: decisionValue(row), binding: intent.binding, bindingHash, qualification: "fixture", generationAvailable: false };
  const event = await operationEvent("proposal", actor, intent, result), b = intent.binding;
  const bindRow: BindingRow = { decision_id: decisionId, proposal_event_id: event.eventId, binding_hash: bindingHash, experience_id: b.experienceId, channel: b.channel, operation: b.operation,
    release_hash: b.releaseHash, source_hash: b.sourceHash, build_hash: b.buildHash, evaluation_hash: b.evaluationHash, expected_head_revision: b.expectedHead.revision,
    expected_head_event_id: b.expectedHead.eventId, rollback_event_id: b.rollbackPublicationEventId, created_at: now };
  const proof = join(authority, owner.proof, productDeliveryDependencies(intent.dependencyIds, false), headExpected(b), rollback);
  await prove(env, proof);
  try {
    await appendEvents(env, [event], { retries: 1, prepareSidecars: ([assigned]) => [
      env.DB.prepare(`INSERT INTO delivery_decisions(decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND sequence=?)`)
        .bind(...decisionProof(row).bindings, assigned.eventId, assigned.sequence),
      env.DB.prepare(`INSERT INTO delivery_experience_bindings(decision_id,proposal_event_id,binding_hash,experience_id,channel,operation,release_hash,source_hash,build_hash,evaluation_hash,
        expected_head_revision,expected_head_event_id,rollback_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...bindingProof(bindRow).bindings),
      finalReceipt(env, assigned, join(proof, decisionProof(row), bindingProof(bindRow))),
    ] });
  } catch { /* Only exact retained receipt recovery settles an uncertain commit. */ }
  return settle(env, authority, actor, "proposal", intent);
}

/** Reserved IDs prevent absent or corrupt bindings from falling through to legacy Product PATCH. */
export async function handleExperienceDeliveryTransition(request: Request, env: WorkerEnv, actor: PilotUser, raw: unknown, registrations: Registrations = REGISTERED_EXPERIENCE_MATERIALS): Promise<Response> {
  try {
    const intent = readExperienceTransition(raw); if (!intent) fail("invalid_experience_release_transition", 400);
    const authority = productDeliveryAuthority(request, env, actor), old = await originalRequest(env, authority, "transition", actor.userId, intent.requestId, intent);
    if (old) return response(old.responseBody);
    const bound = await boundDecision(env, intent.decisionId);
    if (!sameExperienceBinding(bound.binding, intent.experienceRelease)) fail("experience_release_binding_conflict");
    if (bound.row.updated_at !== intent.expectedUpdatedAt) fail("delivery_decision_revision_conflict");
    if (!deliveryTransitionAllowed(bound.row.status, intent.status)) fail("invalid_delivery_status_transition");
    if (deliveryNeedsEvidence(intent.status) && !intent.evidence) fail("delivery_evidence_required");
    const release = deliveryNeedsReleaseAuthority(intent.status) || ["approved", "revoked"].includes(bound.row.status);
    const currentAuthority = release ? productDeliveryReleaseAuthority(request, env, actor) : authority;
    const owner = await eligibleOwner(env, intent.ownerUserId);
    if (intent.status === "approved" && [bound.row.created_by_user_id, bound.row.owner_user_id, intent.ownerUserId].includes(actor.userId)) fail("independent_release_approver_required", 403);
    if (["passed", "approval_required", "approved"].includes(intent.status)) await material(registrations, bound.binding);
    const now = new Date(Math.max(Date.now(), Date.parse(intent.expectedUpdatedAt) + 1)).toISOString();
    const row: DecisionRow = { ...bound.row, title: intent.title, status: intent.status, evidence: intent.evidence,
      owner_user_id: owner.owner.user_id, owner_display_name: owner.owner.display_name, updated_at: now };
    const result = { decision: decisionValue(row), binding: bound.binding, bindingHash: bound.bindingRow.binding_hash, qualification: "fixture", generationAvailable: false };
    const event = await operationEvent("transition", actor, intent, result, experienceTransitionEventId(intent.decisionId, now), intent.status === "approved" ? approvalSnapshot(request, actor) : null);
    const proof = join(currentAuthority, bound.proof, owner.proof, productDeliveryDependencies(bound.decision.dependencyIds, deliveryNeedsCompleteDependencies(intent.status)),
      intent.status === "approved" && bound.row.status !== "approved" ? headExpected(bound.binding) : { sql: "1", bindings: [] });
    await prove(env, join(proof, decisionProof(bound.row)));
    try {
      await appendEvents(env, [event], { retries: 1, prepareSidecars: ([assigned]) => [
        env.DB.prepare(`UPDATE delivery_decisions SET title=?,status=?,evidence=?,owner_user_id=?,owner_display_name=?,updated_at=?
          WHERE decision_id=? AND updated_at=? AND ${decisionProof(bound.row).sql}
            AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND sequence=?)`)
          .bind(row.title, row.status, row.evidence, row.owner_user_id, row.owner_display_name, row.updated_at, row.decision_id, intent.expectedUpdatedAt,
            ...decisionProof(bound.row).bindings, assigned.eventId, assigned.sequence),
        finalReceipt(env, assigned, join(proof, decisionProof(row))),
      ] });
    } catch { /* Preserve ambiguity until exact original recovery. */ }
    return await settle(env, authority, actor, "transition", intent);
  } catch (error) { return failureResponse(error); }
}

async function publish(request: Request, env: WorkerEnv, actor: PilotUser, intent: ExperiencePublicationIntent, registrations: Registrations) {
  const authority = productDeliveryAuthority(request, env, actor), old = await originalRequest(env, authority, "publication", actor.userId, intent.requestId, intent);
  if (old) return response(old.responseBody, 201);
  const bound = await boundDecision(env, intent.decisionId);
  if (!sameExperienceBinding(bound.binding, intent.binding)) fail("experience_release_binding_conflict");
  if (bound.row.updated_at !== intent.expectedDecisionUpdatedAt) fail("delivery_decision_revision_conflict");
  const approved = await eligibleApproval(env, bound, registrations), rollback = await rollbackProof(env, intent.binding, registrations);
  if (approved.approval.row.event_id !== intent.approvalEventId) fail("experience_release_approval_changed");
  const proof = join(productDeliveryReleaseAuthority(request, env, actor), approved.proof, rollback, headExpected(intent.binding));
  await prove(env, proof);
  const publicationId = uuidV7(), now = new Date().toISOString(), headRow: HeadRow = { experience_id: intent.binding.experienceId, channel: intent.binding.channel,
    revision: intent.binding.expectedHead.revision + 1, publication_event_id: publicationId, decision_id: intent.decisionId,
    binding_hash: bound.bindingRow.binding_hash, release_hash: intent.binding.releaseHash, updated_at: now };
  if (!Number.isSafeInteger(headRow.revision)) fail("experience_release_head_limit");
  const result = { decisionId: intent.decisionId, binding: intent.binding, bindingHash: bound.bindingRow.binding_hash,
    head: headValue(headRow), qualification: "fixture", generationAvailable: false };
  const event = await operationEvent("publication", actor, intent, result, publicationId);
  try {
    await appendEvents(env, [event], { retries: 1, prepareSidecars: ([assigned]) => {
      const values = currentHeadProof(headRow).bindings;
      const headWrite = intent.binding.expectedHead.revision === 0
        ? env.DB.prepare(`INSERT INTO experience_release_heads(experience_id,channel,revision,publication_event_id,decision_id,binding_hash,release_hash,updated_at)
            SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM experience_release_heads WHERE experience_id=? AND channel=?)
              AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND sequence=?)`).bind(...values, headRow.experience_id, headRow.channel, assigned.eventId, assigned.sequence)
        : env.DB.prepare(`UPDATE experience_release_heads SET revision=?,publication_event_id=?,decision_id=?,binding_hash=?,release_hash=?,updated_at=?
            WHERE experience_id=? AND channel=? AND revision=? AND publication_event_id=? AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND sequence=?)`)
          .bind(headRow.revision, headRow.publication_event_id, headRow.decision_id, headRow.binding_hash, headRow.release_hash, headRow.updated_at,
            headRow.experience_id, headRow.channel, intent.binding.expectedHead.revision, intent.binding.expectedHead.eventId, assigned.eventId, assigned.sequence);
      // The old head no longer exists after the CAS. Re-prove all other admission/material/approval inputs plus exact new head.
      return [headWrite, finalReceipt(env, assigned, join(productDeliveryReleaseAuthority(request, env, actor), approved.proof, rollback, currentHeadProof(headRow)))];
    } });
  } catch { /* A later head must not replace the original publication acknowledgment. */ }
  return settle(env, authority, actor, "publication", intent);
}

function failureResponse(error: unknown): Response {
  return error instanceof ReleaseFailure ? response({ error: error.code, generationAvailable: false }, error.status)
    : response({ error: "experience_release_unavailable", generationAvailable: false }, 503);
}
/** The existing release/adoption transport retains its exact 32 KiB limit. */
export async function readExperienceReleaseJson(request: Request): Promise<unknown> {
  return readBoundedExperienceJson(request, 32768);
}
/** Bound the byte stream before allocation/decoding. Only the named model
 * preview port allows 64 KiB for a 32 KiB response plus brief/identity wrapper. */
async function readBoundedExperienceJson(request: Request, limit: 32768 | 65536): Promise<unknown> {
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let length = 0;
  if (!reader) fail("invalid_experience_release_request", 400);
  try {
    const declared = request.headers.get("content-length");
    if (declared && /^\d+$/.test(declared) && Number(declared) > limit) { await reader.cancel().catch(() => {}); fail("experience_release_request_limit", 413); }
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) { await reader.cancel().catch(() => {}); fail("experience_release_request_limit", 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("invalid_experience_release_request", 400); }
}

/** Real Product endpoint; the optional registry is an internal code-owned dependency, never a request or environment capability. */
export async function handleExperienceReleases(request: Request, env: WorkerEnv, parts: readonly string[], registrations: Registrations = REGISTERED_EXPERIENCE_MATERIALS,
  maintenanceRegistrations: readonly ExperienceMaintenanceRegistration[] = REGISTERED_EXPERIENCE_MAINTENANCE,
  adoptionRegistrations: readonly ExperienceMaintenanceAdoptionRegistration[] = REGISTERED_EXPERIENCE_MAINTENANCE_ADOPTIONS): Promise<Response> {
  try {
    const url = new URL(request.url), origin = request.headers.get("origin");
    if (!["GET", "HEAD"].includes(request.method) && origin && origin !== url.origin) fail("same_origin_required", 403);
    if (!["GET", "POST", "PATCH"].includes(request.method)) return response({ error: "method_not_allowed" }, 405);
    const auth = await requireCapability(request, env, "product.delivery.manage"); if (auth.response || !auth.user) return auth.response!;
    const actor = auth.user, authority = productDeliveryAuthority(request, env, actor);
    if (parts[0] === "maintenance" && ["adoption-proposals", "adoptions", "adoption-operations", "adoption-nominations", "adoption-decisions", "model-request", "model-preview"].includes(parts[1] ?? "")) {
      const maintenanceResponse = await handleMaintenanceAdoptionRoutes(maintenancePorts, request, env, actor, parts, registrations, adoptionRegistrations);
      if (maintenanceResponse) return maintenanceResponse;
    }
    if (request.method === "GET" && parts.length === 2 && parts[0] === "materials" && parts[1] === "maintenance") {
      const keys = ["releaseHash", "sourceHash", "buildHash", "evaluationHash"];
      if ([...url.searchParams].length !== keys.length || keys.some(key => url.searchParams.getAll(key).length !== 1)) fail("invalid_experience_maintenance_request", 400);
      const selected = readExperienceMaterialSelection(Object.fromEntries(url.searchParams));
      if (!selected) fail("invalid_experience_maintenance_request", 400);
      const result = await readExperienceMaintenanceForMaterial(registrations, maintenanceRegistrations, selected);
      await prove(env, authority);
      if (!result.ok) fail(result.error, result.status);
      return response(result.value);
    }
    if (request.method === "POST" && parts.length === 2 && parts[0] === "maintenance" && parts[1] === "preview") {
      if ([...url.searchParams].length) fail("invalid_experience_maintenance_request", 400);
      let body: unknown;
      try { body = await readExperienceReleaseJson(request); }
      catch (error) { await prove(env, authority); throw error; }
      const result = await previewExperienceMaintenanceForMaterial(registrations, maintenanceRegistrations, body);
      await prove(env, authority);
      if (!result.ok) fail(result.error, result.status);
      return response(result.value);
    }
    if (request.method === "GET" && parts.length === 1 && parts[0] === "materials") {
      if ([...url.searchParams].length) fail("invalid_experience_material_request", 400);
      const materials = await listExperienceReleaseMaterials(registrations);
      await prove(env, authority);
      if (!materials) fail("experience_release_material_unavailable", 503);
      return response({ version: 1, qualification: "fixture", generationAvailable: false,
        materials: materials.map(materialSummary) } satisfies ExperienceMaterialInventory);
    }
    if (request.method === "GET" && parts.length === 2 && parts[0] === "materials" && parts[1] === "detail") {
      const keys = ["releaseHash", "sourceHash", "buildHash", "evaluationHash"];
      if ([...url.searchParams].length !== keys.length || keys.some(key => url.searchParams.getAll(key).length !== 1)) fail("invalid_experience_material_request", 400);
      const selected = readExperienceMaterialSelection(Object.fromEntries(url.searchParams));
      if (!selected) fail("invalid_experience_material_request", 400);
      const material = await resolveExperienceReleaseMaterial(registrations, selected);
      await prove(env, authority);
      if (!material) fail("experience_release_material_unavailable", 404);
      return response({ version: 1, qualification: "fixture", generationAvailable: false, material: materialSummary(material),
        release: material.release, descriptor: describeExperiencePatch(material.release) } satisfies ExperienceMaterialDetail);
    }
    if (parts.length === 1 && parts[0] === "decisions" && request.method === "POST") {
      const intent = readExperienceProposal(await readExperienceReleaseJson(request)); if (!intent) fail("invalid_experience_release_proposal", 400);
      return await propose(request, env, actor, intent, registrations);
    }
    if (parts.length === 2 && parts[0] === "decisions" && request.method === "PATCH") {
      const raw = await readExperienceReleaseJson(request); if (!record(raw) || raw.decisionId !== parts[1]) fail("experience_release_decision_mismatch", 400);
      return await handleExperienceDeliveryTransition(request, env, actor, raw, registrations);
    }
    if (parts.length === 1 && parts[0] === "publications" && request.method === "POST") {
      const intent = readExperiencePublication(await readExperienceReleaseJson(request)); if (!intent) fail("invalid_experience_release_publication", 400);
      return await publish(request, env, actor, intent, registrations);
    }
    if (parts.length === 1 && parts[0] === "preview" && request.method === "POST") {
      const body = await readExperienceReleaseJson(request);
      if (!record(body) || !exactKeys(body, ["version", "base", "patch"]) || body.version !== 1 || !record(body.base)
        || !exactKeys(body.base, ["releaseHash", "sourceHash", "buildHash", "evaluationHash"])) fail("invalid_experience_release_preview", 400);
      const base = await resolveExperienceReleaseMaterial(registrations, body.base as { releaseHash: string; sourceHash: string; buildHash: string; evaluationHash: string });
      if (!base) fail("experience_release_material_unavailable");
      const candidate = await proposePatch(base.release, body.patch, base.catalog);
      await prove(env, authority);
      return response({ ...candidate, descriptor: describeExperiencePatch(base.release), qualification: "fixture", generationAvailable: false, canPublish: false });
    }
    if (request.method !== "GET") return response({ error: "not_found" }, 404);
    if (parts.length === 2 && parts[0] === "requests") {
      const operation = url.searchParams.get("operation") as ExperienceOperation;
      if (!Object.hasOwn(eventTypes, operation) || !experienceRequestId(parts[1])) fail("invalid_experience_release_request", 400);
      const original = await originalRequest(env, authority, operation, actor.userId, parts[1]);
      return original ? response(original.responseBody) : response({ error: "experience_release_request_not_found" }, 404);
    }
    if (parts.length === 2 && parts[0] === "publications") {
      if (!experienceEventId(parts[1])) fail("invalid_experience_release_publication", 400);
      const original = await originalEvent(env, parts[1]); if (original.operation !== "publication") fail("experience_release_publication_unavailable");
      await prove(env, join(authority, retained(original))); return response(original.responseBody);
    }
    if (parts.length === 2 && parts[0] === "decisions") {
      const bound = await boundDecision(env, parts[1]); let approvalEventId: string | null = null;
      let provenance: ProductDeliveryAuthority = { sql: "1", bindings: [] }, eligibility: ProductDeliveryAuthority = { sql: "0", bindings: [] };
      if (bound.row.status === "approved") {
        try { const saved = await approvalProvenance(env, bound); approvalEventId = saved.approval.row.event_id; provenance = saved.proof;
          try { eligibility = (await eligibleApproval(env, bound, registrations)).proof; } catch (error) { if (!(error instanceof ReleaseFailure)) throw error; }
        } catch (error) { if (!(error instanceof ReleaseFailure)) throw error; }
      }
      const eligible = await readEligibility(env, join(authority, bound.proof, decisionProof(bound.row), provenance), eligibility);
      return response({ decision: bound.decision, binding: bound.binding, bindingHash: bound.bindingRow.binding_hash, approvalEventId,
        approvalEligible: eligible, canPublish: false, qualification: "fixture", generationAvailable: false });
    }
    if (parts.length === 2 && parts[0] === "heads") {
      if (!experienceId(parts[1]) || url.searchParams.get("channel") !== "managed-fixture") fail("invalid_experience_release_head", 400);
      const row = await env.DB.prepare("SELECT * FROM experience_release_heads WHERE experience_id=? AND channel='managed-fixture'").bind(parts[1]).first<HeadRow>();
      if (!row) { await prove(env, join(authority, { sql: "NOT EXISTS(SELECT 1 FROM experience_release_heads WHERE experience_id=? AND channel='managed-fixture')", bindings: [parts[1]] })); return response({ head: null, eligible: false, qualification: "fixture", generationAvailable: false }); }
      const head = headValue(row); let eligibilityProof: ProductDeliveryAuthority = { sql: "0", bindings: [] };
      try {
        const publication = await originalEvent(env, row.publication_event_id), bound = await boundDecision(env, row.decision_id), approved = await eligibleApproval(env, bound, registrations);
        if (publication.operation === "publication" && exactJson(publication.responseBody.result.head, head)
          && row.binding_hash === bound.bindingRow.binding_hash && row.release_hash === bound.binding.releaseHash
          && (publication.intent as ExperiencePublicationIntent).expectedDecisionUpdatedAt === bound.row.updated_at
          && (publication.intent as ExperiencePublicationIntent).approvalEventId === approved.approval.row.event_id) {
          eligibilityProof = join(retained(publication), approved.proof);
        }
      } catch (error) { if (!(error instanceof ReleaseFailure)) throw error; }
      // A withdrawn approval makes this retained head ineligible, not absent. Read
      // eligibility and reader/head custody at the same final SQL boundary.
      const eligible = await readEligibility(env, join(authority, currentHeadProof(row)), eligibilityProof);
      return response({ head, eligible, qualification: "fixture", generationAvailable: false });
    }
    return response({ error: "not_found" }, 404);
  } catch (error) { return failureResponse(error); }
}
