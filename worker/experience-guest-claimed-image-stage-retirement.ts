import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { guestHash, guestId } from "./experience-guest-session.ts";
import { current, collectDueGuestImageHistory, checkedDigest, json, snapshot, integer, iso, uuid, flatRow,
  together, objectSql, eventColumns, commandColumns, eventWitness, canonicalRedactionSql, unsupportedIdentityJson, boundedIdentityValue,
  type Context, type Proof, type Row, type Value } from "./experience-guest-image-history.ts";
import { collectGuestImageStageFacts, type History, type Tail } from "./experience-guest-image-stage-facts.ts";
import { readGuestImageClaimLineage } from "./experience-guest-image-claim.ts";
import { guestImageCopyProof } from "./experience-guest-image-copy-contract.ts";
import { readGuestImageStageCustodyMapping } from "./experience-guest-image-stage-custody.ts";
import { captureGuestSourceRetirementCustody } from "./experience-guest-source-retirement-custody.ts";
import { denseGuestImageAcknowledgement } from "./experience-guest-image-confirmation.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (): never => { throw new Error("guest_claimed_image_stage_retirement_unavailable"); };
type Facts = Awaited<ReturnType<typeof collectGuestImageStageFacts>>;
type Mapping = NonNullable<Awaited<ReturnType<typeof readGuestImageStageCustodyMapping>>>;
// The copy preserves logical IDs. Bare shared-ID matches may describe later
// canonical work, but every direct guest owner/actor/stream/scope remains a
// blocker. Missing or contradictory parent ownership is never an exemption.
const canonicalProject = (alias: string) => `EXISTS(SELECT 1 FROM organization_projects mapped
  WHERE mapped.project_access_id=${alias}.project_access_id AND mapped.organization_id=${alias}.organization_id
    AND mapped.project_id=${alias}.project_id AND mapped.project_id=s.project AND mapped.owner_user_id=s.destination)`;
// A copied Document can subsequently enter its owner's governed Project.
// That native scope remains independent canonical history, without requiring
// current membership, project status, or a live project-context session.
const canonicalProjectOutput = (alias: string) => `${alias}.scope_key IS 'project:'||${alias}.organization_id||':'||${alias}.project_access_id
  AND ${canonicalProject(alias)}`;
const canonicalOutputScope = (column: string) => `(${column} IS s.targetScope OR EXISTS(SELECT 1 FROM organization_projects mapped_output
  WHERE mapped_output.owner_user_id=s.destination AND mapped_output.project_id=s.project
    AND ${column}='project:'||mapped_output.organization_id||':'||mapped_output.project_access_id))`;
const nativeBranches = [
  ["events", "d.actor=s.guest AND d.event_id NOT IN(SELECT value FROM json_each(s.ids))"],
  ["private_content", "d.owner_id=s.guest AND d.content_id<>s.draft"], ["external_content", "d.owner_id=s.guest"],
  ["event_private_payloads", "d.owner_id=s.guest AND d.private_event_id NOT IN(SELECT value FROM json_each(s.ids))"],
  ["event_client_receipts", "d.stream_id=s.stream AND d.event_id NOT IN(SELECT value FROM json_each(s.prefix))"],
  ["event_write_stage", "d.owner_id=s.guest OR d.stream_id=s.stream"],
  ["organization_projects", "d.owner_user_id=s.guest OR d.project_id=s.project AND d.owner_user_id IS NOT s.destination"],
  ["project_resource_scopes", `d.owner_user_id=s.guest OR d.actor_user_id=s.guest OR d.source_event_id IN(SELECT value FROM json_each(s.ids)) OR d.resource_id=s.draft
    OR (d.project_id=s.project OR d.resource_id=s.document OR d.resource_kind='block' AND d.resource_id IN(SELECT value FROM json_each(s.blocks)))
      AND NOT(d.owner_user_id IS s.destination AND ${canonicalProject("d")})`],
  ["private_content_retention_scopes", `d.content_id=s.draft OR d.actor_user_id=s.guest OR d.project_id=s.project
    AND NOT EXISTS(SELECT 1 FROM private_content retained WHERE retained.content_id=d.content_id AND retained.owner_id=s.destination AND ${canonicalProject("d")})`],
  ["project_event_scopes", "d.event_id IN(SELECT value FROM json_each(s.ids)) OR d.source_stream_id=s.stream OR d.owner_user_id=s.guest OR d.actor_user_id=s.guest"],
  ["document_jobs", "d.owner_id=s.guest OR d.stream_id=s.stream OR d.document_id=s.document AND NOT(d.owner_id IS s.destination AND d.stream_id IS s.targetStream)"],
  ["generation_preflights", "d.owner_id=s.guest OR d.stream_id=s.stream OR d.document_id=s.document AND NOT(d.owner_id IS s.destination AND d.stream_id IS s.targetStream)"],
  ["artifact_revisions", `d.owner_id=s.guest OR d.created_by_user_id=s.guest OR (d.project_id=s.project OR d.document_id=s.document)
    AND NOT(d.owner_id IS s.destination AND d.project_id IS s.project
      AND (d.organization_id IS NULL AND d.project_access_id IS NULL OR ${canonicalProject("d")}))`],
  ["consequential_executions", "d.actor_user_id=s.guest OR d.stream_id=s.stream OR (d.project_id=s.project OR d.document_id=s.document) AND NOT(d.actor_user_id IS s.destination AND d.stream_id IS s.targetStream AND d.project_id IS s.project)"],
  ["authoring_commits", `d.actor_user_id=s.guest OR d.last_event_id IN(SELECT value FROM json_each(s.ids)) OR (d.project_id=s.project OR d.document_id=s.document)
    AND NOT EXISTS(SELECT 1 FROM events authored JOIN event_private_payloads body ON body.private_event_id=authored.event_id
      WHERE authored.event_id=d.last_event_id AND authored.stream_id=s.targetStream AND body.owner_id=s.destination
        AND body.project_id=d.project_id AND d.project_id=s.project)`],
  ["budget_reservations", "d.owner_id=s.guest OR d.stream_id=s.stream"], ["cost_budget_reservations", "d.owner_id=s.guest OR d.stream_id=s.stream"],
  ["shares", "d.owner_id=s.guest OR d.stream_id=s.stream"],
  ["share_scopes", `d.owner_id=s.guest OR (d.project_id=s.project OR d.resource_id=s.document)
    AND NOT EXISTS(SELECT 1 FROM shares shared WHERE shared.share_id=d.share_id AND shared.owner_id=s.destination
      AND shared.stream_id=s.targetStream AND d.owner_id=s.destination AND d.project_id=s.project)`],
  ["project_context_package_bindings", `d.created_by_user_id=s.guest OR (d.project_id=s.project OR d.document_id=s.document) AND NOT(${canonicalProject("d")})`],
  ["project_review_tasks", `d.requested_by_user_id=s.guest OR d.assigned_user_id=s.guest OR d.resolved_by_user_id=s.guest
    OR d.request_event_id IN(SELECT value FROM json_each(s.ids)) OR (d.project_id=s.project OR d.document_id=s.document) AND NOT(${canonicalProject("d")})`],
  ["output_commands", "(d.scope_key=s.scope OR d.actor_user_id=s.guest OR d.event_id IN(SELECT value FROM json_each(s.ids))) AND NOT(d.scope_key=s.scope AND d.actor_user_id=s.guest AND d.command_key=s.command AND d.event_id=s.tail)"],
  ["output_plan_revisions", `d.confirmed_event_id IN(SELECT value FROM json_each(s.ids)) OR d.scope_key=s.scope OR d.owner_user_id=s.guest
    OR (d.project_id=s.project OR d.document_id=s.document) AND NOT(d.owner_user_id IS s.destination AND d.project_id IS s.project
      AND (d.scope_key IS s.targetScope AND d.scope_kind IS 'personal' AND d.organization_id IS NULL AND d.project_access_id IS NULL
        OR d.scope_kind IS 'project' AND (${canonicalProjectOutput("d")})))`],
  ["output_plan_targets", "d.scope_key=s.scope"], ["output_preflights", "d.event_id IN(SELECT value FROM json_each(s.ids)) OR d.scope_key=s.scope OR d.actor_user_id=s.guest"],
  ["output_execution_grants", "d.authorization_event_id IN(SELECT value FROM json_each(s.ids)) OR d.scope_key=s.scope OR d.actor_user_id=s.guest OR d.payer_user_id=s.guest"],
  ...["output_operation_routes", "output_provider_calls"].map(table => [table, "d.scope_key=s.scope"]),
  ["output_operation_slots", "d.scope_key=s.scope OR d.outcome_event_id IN(SELECT value FROM json_each(s.ids))"],
  ["output_native_storage_writes", "d.scope_key=s.scope OR d.publication_event_id IN(SELECT value FROM json_each(s.ids))"],
  ["output_plan_fulfillments", "d.scope_key=s.scope OR d.eligibility_event_id IN(SELECT value FROM json_each(s.ids))"],
  ["output_assets", `d.created_event_id IN(SELECT value FROM json_each(s.ids)) OR d.scope_key=s.scope OR d.owner_user_id=s.guest OR d.created_by_user_id=s.guest
    OR d.document_id=s.document AND NOT(${canonicalOutputScope("d.scope_key")} AND d.owner_user_id IS s.destination)`],
  ["output_asset_storage_writes", `d.publication_event_id IN(SELECT value FROM json_each(s.ids)) OR d.scope_key=s.scope OR d.owner_user_id=s.guest OR d.actor_user_id=s.guest
    OR (d.project_id=s.project OR d.document_id=s.document) AND NOT(d.owner_user_id IS s.destination AND d.project_id IS s.project
      AND (d.scope_key IS s.targetScope OR (${canonicalProjectOutput("d")})))`],
  ["output_results", `d.bound_event_id IN(SELECT value FROM json_each(s.ids)) OR d.scope_key=s.scope OR d.created_by_user_id=s.guest OR d.document_id=s.document AND NOT EXISTS(
    SELECT 1 FROM output_assets asset JOIN output_plan_revisions plan ON plan.scope_key=asset.scope_key
    WHERE ${canonicalOutputScope("d.scope_key")} AND asset.scope_key=d.scope_key AND asset.asset_id=d.asset_id AND asset.owner_user_id=s.destination
      AND asset.document_id=d.document_id AND plan.plan_revision_id=d.plan_revision_id AND plan.owner_user_id=s.destination
      AND plan.project_id=s.project AND plan.document_id=d.document_id)`],
  ["output_target_acceptances", "d.approval_event_id IN(SELECT value FROM json_each(s.ids)) OR d.scope_key=s.scope OR d.reviewer_user_id=s.guest"],
  ["output_delivery_manifests", `d.event_id IN(SELECT value FROM json_each(s.ids)) OR d.scope_key=s.scope OR d.created_by_user_id=s.guest OR d.document_id=s.document AND NOT EXISTS(
    SELECT 1 FROM output_plan_revisions plan WHERE ${canonicalOutputScope("d.scope_key")} AND plan.scope_key=d.scope_key
      AND plan.plan_revision_id=d.plan_revision_id AND plan.owner_user_id=s.destination AND plan.project_id=s.project AND plan.document_id=d.document_id)`],
];
function completedClosure(scope: Record<string, Value>, sponsor: { tables: Set<string> }, memory: { registries: string[] }): Proof {
  const rows: string[][] = nativeBranches.map(row => [...row]);
  const allowed = new Map([
    ["output_commands", "d.scope_key=s.scope AND d.actor_user_id=s.guest AND d.command_key IN(SELECT value FROM json_each(s.commands))"],
    ["output_plan_revisions", "d.scope_key=s.scope AND d.plan_revision_id=s.plan"],
    ["output_plan_targets", "d.scope_key=s.scope AND d.plan_revision_id=s.plan AND d.target_id=s.target"],
    ["output_preflights", "s.quote IS NOT NULL AND d.scope_key=s.scope AND d.preflight_id=s.quote"],
  ]);
  for (const entry of rows) if (allowed.has(entry[0])) entry[1] = `(${entry[1]}) AND NOT(${allowed.get(entry[0])})`;
  const add = (table: string, predicate: string) => { if (sponsor.tables.has(table)) rows.push([table, predicate]); };
  add("experience_sponsor_resource_receipts", "(d.actor_user_id=s.guest OR d.session_digest=s.session) AND d.resource_id NOT IN(SELECT value FROM json_each(s.resources))");
  for (const table of ["experience_sponsor_grants", "experience_sponsor_consumptions"]) add(table, "d.actor_user_id=s.guest OR d.session_digest=s.session");
  add("experience_sponsor_active_jobs", "d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_consumptions used WHERE used.consumption_id=d.consumption_id AND (used.actor_user_id=s.guest OR used.session_digest=s.session))");
  // Unsupported retained identity JSON cannot be silently classified as an
  // unrelated actor's work. This bounded inspector refuses that inventory;
  // it does not repair, delete or reinterpret another actor's receipt.
  const issuerCanonical = `d.actor_user_id IS s.destination
    AND ${boundedIdentityValue("d.driver_command_json", "documentId")} IS ${boundedIdentityValue("d.envelope_json", "documentId")}
    AND ${boundedIdentityValue("d.envelope_json", "projectId")} IS s.project
    AND ${boundedIdentityValue("d.envelope_json", "ownerUserId")} IS s.destination
    AND ${boundedIdentityValue("d.envelope_json", "actorUserId")} IS s.destination
    AND ${boundedIdentityValue("d.envelope_json", "sessionDigest")} IS NOT s.session
    AND EXISTS(SELECT 1 FROM experience_sponsor_grants grant_row WHERE grant_row.grant_id=d.grant_id AND grant_row.actor_user_id=s.destination
      AND grant_row.session_digest=${boundedIdentityValue("d.envelope_json", "sessionDigest")})`;
  add("experience_sponsor_issuances", `${unsupportedIdentityJson("d.driver_command_json")} OR ${unsupportedIdentityJson("d.envelope_json", ["documentId", "projectId", "ownerUserId", "actorUserId", "payerUserId", "sessionDigest"])}
    OR d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_grants issued WHERE issued.grant_id=d.grant_id AND (issued.actor_user_id=s.guest OR issued.session_digest=s.session))
    OR ${boundedIdentityValue("d.envelope_json", "ownerUserId")}=s.guest OR ${boundedIdentityValue("d.envelope_json", "actorUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "payerUserId")}=s.guest OR ${boundedIdentityValue("d.envelope_json", "sessionDigest")}=s.session
    OR (${boundedIdentityValue("d.driver_command_json", "documentId")}=s.document OR ${boundedIdentityValue("d.envelope_json", "documentId")}=s.document
      OR ${boundedIdentityValue("d.envelope_json", "projectId")}=s.project) AND NOT(${issuerCanonical})`);
  add("experience_sponsor_driver_intents", `(${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver OR d.actor_user_id=s.guest OR d.session_digest=s.session
    OR (d.document_id=s.document OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document)
      AND NOT(d.actor_user_id IS s.destination AND d.session_digest IS NOT s.session AND d.document_id IS s.document
        AND ${boundedIdentityValue("d.command_json", "documentId")} IS s.document)) AND NOT(d.driver_id=s.driver)`);
  add("experience_sponsor_driver_stages", `(${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver
    OR EXISTS(SELECT 1 FROM experience_sponsor_driver_intents intent WHERE intent.driver_id=d.driver_id AND (intent.actor_user_id=s.guest OR intent.session_digest=s.session))
    OR (${boundedIdentityValue("d.command_json", "documentId")}=s.document OR EXISTS(
      SELECT 1 FROM experience_sponsor_driver_intents parent WHERE parent.driver_id=d.driver_id AND parent.document_id=s.document)) AND NOT EXISTS(
      SELECT 1 FROM experience_sponsor_driver_intents intent WHERE intent.driver_id=d.driver_id AND intent.actor_user_id=s.destination
        AND ${boundedIdentityValue("d.command_json", "documentId")}=s.document
        AND intent.session_digest IS NOT s.session AND intent.document_id=s.document
        AND NOT(${unsupportedIdentityJson("intent.command_json")}) AND ${boundedIdentityValue("intent.command_json", "documentId")}=s.document)) AND NOT(s.claimed=1 AND d.driver_id=s.driver AND d.stage='preflight')`);
  add("experience_sponsor_intakes", "d.actor_user_id=s.guest OR d.session_digest=s.session OR d.draft_id=s.draft OR (d.project_id=s.project OR d.document_id=s.document) AND NOT(d.actor_user_id IS s.destination AND d.project_id IS s.project AND d.session_digest IS NOT s.session)");
  add("experience_sponsor_read_attempts", `d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=d.job_id
    AND (job.owner_id=s.guest OR job.stream_id=s.stream OR job.document_id=s.document AND NOT(job.owner_id IS s.destination AND job.stream_id IS s.targetStream)))`);
  add("experience_sponsor_intake_read_attempts", "d.actor_user_id=s.guest OR d.resource_key='draft:'||s.draft");
  for (const registry of memory.registries) rows.push([registry, "d.user_event_id IN(SELECT value FROM json_each(s.ids)) OR d.answer_event_id IN(SELECT value FROM json_each(s.ids))"]);
  add("experience_guest_context_adoptions", `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])}
    OR (d.session_id=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "sessionId")}=s.sessionId
      OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project
      OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document)
      AND NOT(d.session_id IS s.sessionId AND d.destination_user_id IS s.destination AND d.lineage_digest IS s.contextDigest)`);
  add("experience_guest_plan_custodies", `(d.session_id=s.sessionId OR d.draft_id=s.draft OR d.content_id=s.draft)
    AND NOT(d.session_id IS s.sessionId AND d.destination_user_id IS s.destination AND d.draft_id IS s.draft
      AND d.lineage_digest IS s.contextDigest AND s.planContentId IS NOT NULL AND d.content_id IS s.planContentId)`);
  add("experience_guest_image_claims", `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])}
    OR (d.session_id=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "sessionId")}=s.sessionId
      OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project
      OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document)
      AND NOT(d.session_id IS s.sessionId AND d.destination_user_id IS s.destination AND d.lineage_digest IS s.claimDigest)`);
  rows.push(["experience_guest_image_stage_custodies", `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])}
    OR (d.session_id=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "sessionId")}=s.sessionId
      OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project
      OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document)
      AND NOT(d.session_id IS s.sessionId AND d.destination_user_id IS s.destination AND d.lineage_digest IS s.stageDigest)`]);
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  const names = Object.keys(scope);
  return { sql: `NOT EXISTS(WITH guest_output_closure_input AS(SELECT ? AS value),guest_output_closure_scope AS(
    SELECT ${names.map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM guest_output_closure_input),
    ${groups.map((group, i) => `guest_output_closure_${i} AS MATERIALIZED(${group.map(([table, predicate]) => `SELECT 1 FROM ${table} d,guest_output_closure_scope s WHERE ${predicate}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, i) => `EXISTS(SELECT 1 FROM guest_output_closure_${i})`).join(" OR ")})`, bindings: [JSON.stringify(scope)] };
}


const claimColumns = ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "context_lineage_digest", "lineage_json", "lineage_digest", "created_at_ms"];
const adoptionColumns = ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "lineage_json", "lineage_digest", "created_at_ms"];
const leaseColumns = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id", "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"];
const planColumns = ["session_id", "destination_user_id", "draft_id", "content_id", "draft_hash", "content_digest", "lineage_digest", "created_at", "expires_at"];
type PrefixIdentity = { id: string; sequence: number; occurred: string; recorded: string; type: string; public: string;
  privateDigest: string; project: string; document: string | null; key: string };

async function historicalClaim(collection: History) {
  const { ctx, original, saved, sponsor: schema } = collection;
  const { parts, session, source, eventIds, projectId, documentId, draftId, terms, policy } = original;
  const prefixEvents = original.prefixWitnesses.map(raw => { const value = json(raw); return { type: value.type, public: String(value.payload) }; });
  const sessionId = String(session.session_id);
  if (!schema.tables.has("experience_guest_image_claims") || !schema.tables.has("experience_guest_context_adoptions")) return fail();
  const row = await snapshot(ctx, parts, "experience_guest_image_claims", "session_id", sessionId, claimColumns,
    "typeof(lineage_json)='text' AND length(CAST(lineage_json AS BLOB)) BETWEEN 1 AND 65536");
  const lineage = readGuestImageClaimLineage(row.lineage_json), from = lineage.source, target = lineage.target;
  if (lineage.sessionId !== sessionId || lineage.guestSubject !== session.guest_subject || lineage.projectId !== projectId
    || lineage.documentId !== documentId || lineage.draftId !== draftId || lineage.draftHash !== source.draft_hash || lineage.origin !== terms.origin
    || row.destination_user_id !== lineage.destinationUserId || row.manifest_digest !== lineage.manifestDigest
    || row.context_lineage_digest !== lineage.contextLineageDigest || row.lineage_digest !== await checkedDigest(ctx, lineage)
    || !guestId(row.lease_id) || !guestId(row.request_id) || !integer(row.created_at_ms)
    || row.created_at_ms !== session.revoked_at_ms || row.created_at_ms >= Date.parse(String(source.expires_at))
    || row.created_at_ms < Number(session.created_at_ms) || Date.parse(String(saved.tail.recorded_at)) > row.created_at_ms
    || from.head !== eventIds.length || JSON.stringify(from.eventIds) !== JSON.stringify(eventIds) || from.expiresAt !== source.expires_at
    || from.sessionPolicyId !== session.policy_id || from.sessionTermsDigest !== session.terms_digest || from.sessionExpiresAtMs !== session.expires_at_ms
    || from.sourcePolicyId !== source.policy_id || from.sourcePolicyDigest !== source.policy_digest || from.requestDigest !== source.request_digest
    || from.contentDigest !== source.content_digest || from.releaseHash !== policy.releaseHash
    || from.save.id !== saved.eventId || from.save.sequence !== saved.tail.sequence || from.save.occurred !== saved.tail.occurred_at
    || from.save.recorded !== saved.tail.recorded_at || from.save.public !== saved.tail.payload
    || canonicalJson(from.command) !== canonicalJson(saved.command) || canonicalJson(from.resource) !== canonicalJson(saved.resource)
    || target.requirementId !== saved.requirementId || !uuid(target.id)) return fail();
  if (saved.tail.redacted_at === null && from.save.privateDigest !== await checkedDigest(ctx, String(saved.tail.private_json))) return fail();
  current(ctx);
  const adoption = await snapshot(ctx, parts, "experience_guest_context_adoptions", "session_id", sessionId, adoptionColumns,
    "typeof(lineage_json)='text' AND length(CAST(lineage_json AS BLOB)) BETWEEN 1 AND 65536");
  if (["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "created_at_ms"].some(key => adoption[key] !== row[key])
    || adoption.lineage_digest !== row.context_lineage_digest || !guestHash(adoption.lineage_digest)) return fail();
  let prefix: unknown; try { prefix = JSON.parse(String(adoption.lineage_json)); } catch { return fail(); }
  if (!record(prefix) || !record(prefix.lease) || typeof prefix.lease.request_ids_json !== "string" || prefix.lease.request_ids_json.length > 16301
    || jsonIssues({ ...prefix, lease: { ...prefix.lease, request_ids_json: "" } }).length
    || !exactKeys(prefix, ["version", "sessionId", "guestSubject", "projectId", "documentId", "draftHash", "manifestDigest", "sourceEventIds", "sourceHead", "destinationUserId", "origin", "targetStart", "targetHead", "events", "lease"])
    || prefix.version !== 1 || prefix.sessionId !== sessionId || prefix.guestSubject !== session.guest_subject || prefix.projectId !== projectId
    || prefix.documentId !== documentId || prefix.draftHash !== source.draft_hash || prefix.manifestDigest !== row.manifest_digest
    || prefix.destinationUserId !== row.destination_user_id || prefix.origin !== terms.origin || prefix.sourceHead !== eventIds.length
    || canonicalJson(prefix.sourceEventIds) !== canonicalJson(eventIds) || canonicalJson(prefix) !== adoption.lineage_json
    || await checkedDigest(ctx, prefix) !== adoption.lineage_digest || !integer(prefix.targetStart, 1)
    || prefix.targetHead !== prefix.targetStart + eventIds.length - 1 || target.contextHead !== prefix.targetHead
    || !Array.isArray(prefix.events) || prefix.events.length !== eventIds.length || !flatRow(prefix.lease, leaseColumns)) return fail();
  const lease = await snapshot(ctx, parts, "experience_guest_claim_leases", "session_id", sessionId, leaseColumns,
    "typeof(request_ids_json)='text' AND length(CAST(request_ids_json AS BLOB)) BETWEEN 1 AND 16301");
  if (canonicalJson(lease) !== canonicalJson(prefix.lease) || lease.session_id !== sessionId || lease.lease_id !== row.lease_id
    || lease.destination_user_id !== row.destination_user_id || lease.manifest_digest !== row.manifest_digest || lease.request_id !== row.request_id
    || !integer(lease.created_at_ms) || !integer(lease.expires_at_ms, 1) || lease.created_at_ms > row.created_at_ms
    || lease.expires_at_ms <= row.created_at_ms || !integer(lease.acquisitions, 1, 100)) return fail();
  let history: unknown; try { history = JSON.parse(String(lease.request_ids_json)); } catch { return fail(); }
  if (!Array.isArray(history) || history.length !== lease.acquisitions || history.some(value => !guestId(value))
    || new Set(history).size !== history.length || history.at(-1) !== lease.request_id || JSON.stringify(history) !== lease.request_ids_json) return fail();
  const canonicalPrefix: PrefixIdentity[] = [];
  for (const [index, item] of prefix.events.entries()) {
    const originalEvent = prefixEvents[index];
    if (!record(item) || !exactKeys(item, ["id", "sequence", "occurred", "recorded", "type", "public", "privateDigest", "project", "document", "key"])
      || !uuid(item.id) || !iso(item.occurred) || !iso(item.recorded) || Date.parse(item.recorded) > row.created_at_ms
      || item.sequence !== prefix.targetStart + index || item.type !== originalEvent.type || !guestHash(item.privateDigest)
      || item.project !== projectId || item.document !== (index === 0 ? null : documentId)
      || item.key !== `guest-context-adoption:v1:${sessionId}:${index}` || typeof item.public !== "string") return fail();
    const expected = { ...json(originalEvent.public), client_event_id: item.key, _private_ref: item.id };
    if (canonicalJson(json(item.public)) !== canonicalJson(expected)) return fail();
    canonicalPrefix.push(item as PrefixIdentity);
  }
  const allIds = [...eventIds, saved.eventId, ...canonicalPrefix.map(event => event.id), target.id];
  if (new Set(allIds).size !== allIds.length || Date.parse(target.recorded) > row.created_at_ms) return fail();
  const expectedKey = `guest-image-save-claim-v1:${(await checkedDigest(ctx, { domain: "forma-guest-image-save-claim@1", sessionId,
    destinationUserId: lineage.destinationUserId, manifestDigest: lineage.manifestDigest })).slice(7)}`;
  if (target.commandKey !== expectedKey) return fail();
  const canonicalCommand: Row = { scope_key: `personal:${lineage.destinationUserId}:${projectId}`, actor_user_id: lineage.destinationUserId,
    command_key: target.commandKey, request_digest: target.requestDigest, action: "save", event_id: target.id, created_at: target.recorded };
  parts.push({ sql: `EXISTS(SELECT 1 FROM output_commands WHERE ${objectSql(commandColumns)}=?)`, bindings: [JSON.stringify(canonicalCommand)] });
  // Durable public/native associations survive ordinary canonical edits and
  // native private tombstones. Do not read, re-hash, or pin the current body.
  const metadata = [...canonicalPrefix.map(event => ({
    event_id: event.id, stream_id: `creative:${lineage.destinationUserId}`, sequence: event.sequence, occurred_at: event.occurred,
    recorded_at: event.recorded, actor: "user", client_id: "server:guest-context-adoption", correlation_id: `guest-context-adoption:${sessionId}`,
    causation_id: null, compensates_event_id: null, schema_version: 1, type: event.type, payload: event.public,
    owner_id: lineage.destinationUserId, project_id: projectId, document_id: event.document, created_at: event.recorded,
  })), { event_id: target.id, stream_id: `creative:${lineage.destinationUserId}`, sequence: target.sequence, occurred_at: target.occurred,
    recorded_at: target.recorded, actor: `user:${lineage.destinationUserId}`, client_id: "server:output-requirements", correlation_id: target.commandKey,
    causation_id: null, compensates_event_id: null, schema_version: 1, type: "BlockCreated", payload: target.public,
    owner_id: lineage.destinationUserId, project_id: projectId, document_id: documentId, created_at: target.recorded }];
  const metadataSql = `json_set(${objectSql(eventColumns, "e.")},'$.owner_id',body.owner_id,'$.project_id',body.project_id,'$.document_id',body.document_id,'$.created_at',body.created_at)`;
  parts.push({ sql: `(SELECT COUNT(*) FROM json_each(?) expected JOIN events e ON e.event_id=json_extract(expected.value,'$.event_id')
    JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE ${metadataSql}=expected.value
      AND typeof(body.private_json)='text' AND (body.redacted_at IS NULL OR (body.private_json='' AND (${canonicalRedactionSql("body.redacted_at")}))))=?`,
  bindings: [JSON.stringify(metadata), metadata.length] });
  // A personal copy may later enter its destination's native Project. Scope
  // time belongs to that enrollment, not to the earlier copied event. Every
  // present association must still describe this exact canonical identity.
  const scopeIdentities = metadata.map(event => [event.event_id, event.owner_id, event.project_id, event.stream_id, event.sequence, event.recorded_at]);
  parts.push({ sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected JOIN project_event_scopes custody
    ON custody.event_id=json_extract(expected.value,'$[0]') WHERE NOT EXISTS(SELECT 1 FROM organization_projects mapped
      WHERE mapped.project_access_id=custody.project_access_id AND mapped.organization_id=custody.organization_id
        AND mapped.project_id=custody.project_id AND mapped.project_id=json_extract(expected.value,'$[2]')
        AND mapped.owner_user_id=json_extract(expected.value,'$[1]') AND custody.owner_user_id=mapped.owner_user_id
        AND custody.actor_user_id=mapped.owner_user_id AND custody.source_stream_id=json_extract(expected.value,'$[3]')
        AND custody.source_sequence=json_extract(expected.value,'$[4]') AND typeof(custody.source_sequence)='integer'
        AND typeof(custody.project_sequence)='integer' AND custody.project_sequence>=1
        AND (${canonicalRedactionSql("custody.created_at")}) AND custody.created_at>=json_extract(expected.value,'$[5]')
        AND custody.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))`, bindings: [JSON.stringify(scopeIdentities)] });
  parts.push({ sql: `(SELECT COUNT(*) FROM json_each(?) expected JOIN event_client_receipts receipt
    ON receipt.stream_id=? AND receipt.event_id=json_extract(expected.value,'$.id') AND receipt.sequence=json_extract(expected.value,'$.sequence')
      AND receipt.client_event_id=json_extract(expected.value,'$.key') AND receipt.created_at=json_extract(expected.value,'$.recorded'))=?`,
  bindings: [JSON.stringify(canonicalPrefix), `creative:${lineage.destinationUserId}`, canonicalPrefix.length] });
  let planContentId: string | null = null;
  if (schema.tables.has("experience_guest_plan_custodies")) {
    const found = await ctx.db.prepare("SELECT session_id FROM experience_guest_plan_custodies WHERE session_id=?").bind(sessionId).first(); current(ctx);
    if (found) {
      const retained = await snapshot(ctx, parts, "experience_guest_plan_custodies", "session_id", sessionId, planColumns,
        "length(CAST(content_id AS BLOB))<=128 AND length(CAST(created_at AS BLOB))=24 AND length(CAST(expires_at AS BLOB))=24");
      planContentId = `experience-draft-${(await checkedDigest(ctx, { domain: "forma-guest-plan-custody-v1", sessionId,
        destinationUserId: lineage.destinationUserId, lineageDigest: adoption.lineage_digest })).slice(7)}`;
      // The canonical copy has its own native retention deadline; it cannot
      // extend or inherit this original guest body's expiry.
      if (retained.destination_user_id !== lineage.destinationUserId || retained.draft_id !== draftId || retained.content_id !== planContentId
        || retained.draft_hash !== source.draft_hash || retained.content_digest !== source.content_digest || retained.lineage_digest !== adoption.lineage_digest
        || !iso(retained.created_at) || !iso(retained.expires_at)
        || Date.parse(retained.created_at) < row.created_at_ms || retained.created_at >= retained.expires_at || planContentId === draftId) return fail();
    } else parts.push({ sql: "NOT EXISTS(SELECT 1 FROM experience_guest_plan_custodies WHERE session_id=?)", bindings: [sessionId] });
  }
  return { lineage, row, adoption, planContentId, canonicalPrefix };
}

async function stageClaim(facts: Facts, claim: Awaited<ReturnType<typeof historicalClaim>>, mapping: Mapping) {
  const { ctx, history, tails, resources, rows } = facts, { original } = history, { row, lineage, copies } = mapping;
  const native = claim.lineage, source = lineage.source;
  if (["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "created_at_ms"].some(key =>
    (row as unknown as Row)[key] !== claim.row[key] || (row as unknown as Row)[key] !== claim.adoption[key])
    || row.context_lineage_digest !== claim.adoption.lineage_digest || row.save_lineage_digest !== claim.row.lineage_digest
    || lineage.contextLineageDigest !== claim.adoption.lineage_digest || lineage.saveLineageDigest !== claim.row.lineage_digest
    || lineage.guestSubject !== native.guestSubject || lineage.projectId !== native.projectId || lineage.documentId !== native.documentId
    || lineage.manifestDigest !== native.manifestDigest || source.head !== facts.sourceHead || source.saveHead !== facts.sourceSaveHead
    || source.stageHead !== facts.stageHead || source.state !== facts.stageState || source.expiresAt !== facts.expiresAt
    || source.saveEventId !== history.saved.eventId || source.originalPayerUserId !== history.saved.approval.policy.payerUserId
    || resources.some(value => Number(value.recorded_at_ms) > row.created_at_ms)
    || tails.some(value => Date.parse(String(value.row.recorded_at)) > row.created_at_ms)) return fail();
  const allIds = [...original.eventIds, ...tails.map(value => value.eventId), ...claim.canonicalPrefix.map(value => value.id), native.target.id];
  if (new Set(allIds).size !== allIds.length) return fail();
  async function event(value: Tail, expected: typeof source.confirmation) {
    if (value.eventId !== expected.id || value.row.sequence !== expected.sequence || value.row.occurred_at !== expected.occurred
      || value.row.recorded_at !== expected.recorded || value.row.payload !== expected.public) return fail();
    if (value.row.redacted_at === null && await checkedDigest(ctx, String(value.row.private_json)) !== expected.privateDigest) return fail();
    current(ctx);
  }
  await event(tails[1], source.confirmation); current(ctx);
  if (canonicalJson(rows.command) !== canonicalJson(source.confirmationCommand)
    || canonicalJson(resources[1]) !== canonicalJson(source.confirmationResource)) return fail();
  if (source.quote) {
    if (!rows.quoteIndex || !rows.preflightCommand || tails.length !== 3) return fail();
    await event(tails[2], source.quote); current(ctx);
    if (canonicalJson(rows.preflightCommand) !== canonicalJson(source.quoteCommand)
      || rows.quoteIndex.preflight_id !== source.quote.preflightId || rows.quoteIndex.plan_revision_id !== source.quote.planRevisionId
      || rows.quoteIndex.expires_at !== source.quote.expiresAt || rows.quoteIndex.terms_digest !== source.quote.termsDigest) return fail();
  } else if (rows.quoteIndex || rows.preflightCommand || tails.length !== 2) return fail();
  if (source.construction) {
    if (!rows.stage || rows.stage.driver_id !== source.construction.driverId || rows.stage.command_digest !== source.construction.commandDigest
      || canonicalJson(resources[2]) !== canonicalJson(source.construction.resource)) return fail();
    const construction = canonicalJson({ stage: rows.stage, resource: resources[2] });
    const expected = lineage.copies.find(value => value.role === "construction");
    if (!expected || expected.digest !== await checkedDigest(ctx, construction) || expected.bytes !== new TextEncoder().encode(construction).byteLength) return fail();
    current(ctx);
  } else if (rows.stage || resources.length !== 2) return fail();
  for (const copy of copies) {
    if (Date.parse(copy.created_at) > row.created_at_ms) return fail();
    const tail = copy.role === "confirmation" ? tails[1] : copy.role === "quote" ? tails[2] : null;
    if (tail?.row.redacted_at === null && new TextEncoder().encode(String(tail.row.private_json)).byteLength !== copy.byte_length) return fail();
  }
  // Only canonical metadata is needed for original-source retirement. Native
  // expiry or valid tombstoning never renews the guest's original deadline.
  const expected = copies.map(copy => [copy.content_id, lineage.destinationUserId, "guest-image-stage-history", copy.created_at, copy.expires_at]);
  const proof: Proof = { sql: `(SELECT COUNT(*) FROM json_each(?) expected JOIN private_content content ON content.content_id=json_extract(expected.value,'$[0]')
    WHERE json_array(content.content_id,content.owner_id,content.kind,content.created_at,content.expires_at)=expected.value
      AND typeof(content.content)='text' AND (content.redacted_at IS NULL OR (content.content='' AND (${canonicalRedactionSql("content.redacted_at")}))))=?`,
  bindings: [JSON.stringify(expected), copies.length] };
  return proof;
}

async function sourceCustody(facts: Facts) {
  const { ctx, history: { original } } = facts, { session, source } = original;
  const originals = original.prefixWitnesses.map(raw => {
    const row = json(raw); return { eventId: String(row.event_id), sequence: Number(row.sequence), occurredAt: String(row.occurred_at),
      recordedAt: String(row.recorded_at), type: String(row.type), publicJson: String(row.payload) };
  });
  const custody = await captureGuestSourceRetirementCustody(ctx.env, { sessionId: facts.sessionId,
    guestSubject: String(session.guest_subject), projectId: original.projectId, documentId: original.documentId, draftId: original.draftId,
    draftHash: String(source.draft_hash), sourceCreatedAt: String(original.draft.created_at), sourceExpiresAt: facts.expiresAt,
    sessionCreatedAtMs: Number(session.created_at_ms), sessionExpiresAtMs: Number(session.expires_at_ms),
    sessionRevokedAtMs: session.revoked_at_ms === null ? null : Number(session.revoked_at_ms), sessionPolicyId: String(session.policy_id),
    sessionTermsDigest: String(session.terms_digest), origin: original.terms.origin, committedHead: facts.sourceHead,
    sourceEventIds: [...original.eventIds], originals });
  current(ctx); return { sql: custody.proof.sql, bindings: [...custody.proof.bindings] };
}

export type ClaimedGuestImageStageRetirementReceipt = Readonly<{
  status: "retired"; scope: "claimed-original-image-stage-private-bodies"; sessionId: string; documentId: string;
  stageHead: number; stageState: "confirmed" | "preflight-claimed-unknown" | "quoted";
  tails: readonly Readonly<{ eventId: string; redactedAt: string; replayed: boolean }>[]; replayed: boolean;
}>;

/** Due original guest bodies only. Completed historical custody is proved
 * independently of current personal access and canonical creative availability.
 * No source/canonical body, payer receipt, financial hold or lease is changed. */
export async function retireExpiredClaimedGuestImageStage(env: WorkerEnv, input: { sessionId: string }): Promise<ClaimedGuestImageStageRetirementReceipt> {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return fail();
  const ctx: Context = { env, db: env.DB };
  try {
    const mapping = await readGuestImageStageCustodyMapping(env, input); current(ctx); if (!mapping) return fail();
    const history = await collectDueGuestImageHistory(env, input); current(ctx);
    const facts = await collectGuestImageStageFacts(history); current(ctx);
    const claim = await historicalClaim(history); current(ctx);
    const copied = await stageClaim(facts, claim, mapping); current(ctx);
    const prefixCustody = await sourceCustody(facts); current(ctx);
    const scope = { ...facts.scope, destination: claim.lineage.destinationUserId, targetStream: `creative:${claim.lineage.destinationUserId}`,
      targetScope: `personal:${claim.lineage.destinationUserId}:${history.original.projectId}`,
      blocks: JSON.stringify([...history.original.blockIds, history.saved.requirementId]), contextDigest: String(claim.adoption.lineage_digest),
      claimDigest: String(claim.row.lineage_digest), stageDigest: mapping.row.lineage_digest, planContentId: claim.planContentId };
    const commonProof = guestImageCopyProof([...history.original.parts, history.sponsor.proof, history.memory.proof, ...facts.stageParts,
      facts.eventCountProof, facts.recordedTimeProof, mapping.proof, copied, prefixCustody, completedClosure(scope, history.sponsor, history.memory)]);
    const before = together([commonProof, ...facts.tailProofs]), tails = facts.tails;
    const originals = JSON.stringify(tails.map(value => value.observed));
    const afterTails: Proof = { sql: `(SELECT COUNT(*) FROM json_each(?) expected
      JOIN events e ON e.event_id=json_extract(expected.value,'$.event_id') JOIN event_private_payloads body ON body.private_event_id=e.event_id
      WHERE json_set(${eventWitness},'$.private_json',json_extract(expected.value,'$.private_json'),
        '$.redacted_at',json_extract(expected.value,'$.redacted_at'))=expected.value
        AND body.private_json='' AND (${canonicalRedactionSql("body.redacted_at")})
        AND body.redacted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND (json_extract(expected.value,'$.redacted_at') IS NULL AND body.redacted_at>=?
          OR body.redacted_at=json_extract(expected.value,'$.redacted_at')))=?`,
    bindings: [originals, facts.expiresAt, tails.length] };
    const after = together([commonProof, afterTails]), pending = tails.filter(value => value.row.redacted_at === null);
    let uncertain = false;
    if (pending.length) {
      const statements = [...outputAssertionStatements(env, before)], indexes: number[] = [];
      for (const value of pending) {
        indexes.push(statements.length);
        statements.push(ctx.db.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE private_event_id=? AND redacted_at IS NULL").bind(value.eventId));
      }
      statements.push(...outputAssertionStatements(env, after)); current(ctx);
      try { uncertain = !denseGuestImageAcknowledgement(await ctx.db.batch(statements), statements.length, indexes); }
      catch { uncertain = true; }
      current(ctx);
    }
    // The same complete original/canonical metadata proof also resolves a lost
    // ACK. This invocation never attempts a second mutation.
    const result = await ctx.db.prepare(`SELECT body.private_event_id AS eventId,body.redacted_at AS redactedAt
      FROM json_each(?) expected JOIN event_private_payloads body ON body.private_event_id=json_extract(expected.value,'$.event_id')
      WHERE (${after.sql}) ORDER BY CAST(expected.key AS INTEGER)`).bind(originals, ...after.bindings).all<{ eventId: string; redactedAt: string }>();
    current(ctx);
    if (result.success !== true || !Array.isArray(result.results) || result.results.length !== tails.length) return fail();
    const retired = tails.map((tail, index) => {
      const row = result.results[index];
      if (!Object.hasOwn(result.results, index) || !row || row.eventId !== tail.eventId || !iso(row.redactedAt)) return fail();
      return { eventId: tail.eventId, redactedAt: row.redactedAt, replayed: tail.row.redacted_at !== null || uncertain };
    });
    current(ctx);
    return freeze({ status: "retired", scope: "claimed-original-image-stage-private-bodies", sessionId: facts.sessionId,
      documentId: facts.documentId, stageHead: facts.stageHead, stageState: facts.stageState, tails: retired,
      replayed: uncertain || pending.length !== tails.length });
  } catch { current(ctx); return fail(); }
}
