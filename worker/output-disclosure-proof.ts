import { OutputConflictError, resetRetainedOutputPrivateBodies, rememberOutputPrivateBody, retainedOutputBodyAssertions, outputScopeAuthority, type OutputScope, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputReadModels } from "./output-read-state.ts";
import type { CreativeEvent, CreativeProjection } from "../src/model/events.ts";
import type { authoritativeCreativeContext } from "./context-authority.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { WorkerEnv } from "./runtime.ts";
import { recordOutputProofCapacity } from "./output-proof-capacity-diagnostic.ts";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const outputJsonValue = (value: unknown) => typeof record(value).error === "string" ? { ...record(value), errorCode: record(value).error, errorValues: record(record(value).errorValues) } : value;
const json = (value: unknown, status = 200) => Response.json(outputJsonValue(value), { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
function fail(code: string, status = 400): never { throw new OutputConflictError(code, status); }
const identifier = (value: unknown, code = "invalid_identifier") => typeof value === "string" && idPattern.test(value) ? value : fail(code);
const ownedBuffer = (bytes: Uint8Array): ArrayBuffer => { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return copy.buffer; };

export function canonicalOutputJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalOutputJson).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalOutputJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export async function outputDigest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalOutputJson(value)))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
    if (encoder.encode(sql).byteLength > 100_000) throw recordOutputProofCapacity(new OutputConflictError("output_source_proof_too_large", 413), "output_assertion_sql_bytes");
    if (bindings.length > 100) throw recordOutputProofCapacity(new OutputConflictError("output_source_proof_too_large", 413), "output_assertion_bindings");
    if (bindings.some((value) => typeof value === "string" && encoder.encode(value).byteLength > 2_000_000)) throw recordOutputProofCapacity(new OutputConflictError("output_source_proof_too_large", 413), "output_assertion_binding_bytes");
    return env.DB.prepare(sql).bind(...bindings);
  });
}
function assertOutputProofRead(results: Array<D1Result<Record<string, unknown>>>, expected: number) {
  if (results.length !== expected || results.some((result) => result.success === false || Number(result.results[0]?.current) !== 1)) fail("output_source_changed_during_read", 409);
}
async function verifyOutputSourceRead(env: WorkerEnv, scope: OutputScope, expectedHead: number, assertions: readonly OutputSqlAssertion[]) {
  const [head, ...checked] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(`creative:${scope.ownerUserId}`),
    ...outputProofReadStatements(env, assertions),
  ]);
  if (Number(head?.results[0]?.head ?? -1) !== expectedHead) fail("output_revision_or_authority_changed", 409);
  assertOutputProofRead(checked, assertions.length);
}

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
  const current = (start: number, count: number) => checks.length === authority.length + bodies.length + metadata.length
    && checks.slice(start, start + count).every(result => result.success !== false && Number(result.results[0]?.current) === 1);
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

export { idPattern, record, outputJsonValue, json, fail, identifier, ownedBuffer, captureOutputPrivateSources, outputProofReadStatements, assertOutputProofRead, verifyOutputSourceRead, discloseOutputResponse, discloseOutputJson };
