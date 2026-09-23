import type { WorkerEnv } from './runtime.ts';
import { requireExistingHoldAdministrator } from './pilot-policy.ts';
import { continueOutputTrustedContext } from './output-trusted-context.ts';
import { outputActiveSourceDeadlineAssertions, verifyOutputSourceRead } from './output-disclosure-proof.ts';
import { outputScopeAuthority } from './output-command-core.ts';
import { canonicalConsent, consentHash } from './consequential-consent.ts';
import { nativeMemoryAnswerExclusion } from './memory-native-boundary.ts';
import { foldEvents } from '../src/model/events.ts';
import { authoritativeCreativeContext } from './context-authority.ts';
import { scopeObservationQuery, classifyScopeObservation } from './generation-source-scope-observation.ts';
import { historicalScopeCandidate } from './generation-historical-scope-proof.ts';

const MAX_ROWS = 50_000, MAX_HISTORY_BYTES = 64 * 1024 * 1024, MAX_CELL = 2_200_000, MAX_REPLY = 12_000_000;
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const bytes = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).length;
const parse = (v: unknown) => record(JSON.parse(String(v)));
const equal = (a: unknown, b: unknown) => canonicalConsent(a) === canonicalConsent(b);
function fail(code: string): never { throw new Error('generation_source_' + code); }
const ids = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length > 128 || v.some(x => typeof x !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u.test(x))) return fail('references_invalid');
  return [...new Set(v as string[])];
};
type Job = { owner_id: string; stream_id: string; document_id: string; request_json: string; expires_at: string };
type Row = Record<string, unknown>;

/** Transport/iteration ceilings, not a financial or database scan-cost ceiling. */
const footprintSql = `SELECT COUNT(*) AS rows,COALESCE(MAX(sequence),0) AS head,
 COALESCE(SUM(length(CAST(payload AS BLOB))+length(CAST(COALESCE(secret.private_json,'') AS BLOB))),0) AS bytes,
 COALESCE(MAX(MAX(length(CAST(payload AS BLOB)),length(CAST(COALESCE(secret.private_json,'') AS BLOB)))),0) AS largest
 FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=?`;

/** This membrane is confined to this reader. Native helpers cannot initialize,
 * reconcile, release leases, write media, or silently grow an unbounded history.
 * A page is admitted against the same complete SQL-side footprint before bytes
 * cross the DB boundary. Empty pages caused by a race are detected by head/count.
 */
function boundedEnvironment(env: WorkerEnv, stream: string, footprint: Row) {
  const db = env.DB; let statements = 0, returnedBytes = 0, returnedRows = 0;
  const historyRows: Row[] = [], historyWitnesses: Array<() => Promise<void>> = [];
  const checked = <T>(result: T): T => {
    returnedBytes += bytes(result); returnedRows += Array.isArray(record(result).results) ? (record(result).results as unknown[]).length : 1;
    if (returnedBytes > MAX_HISTORY_BYTES * 3 || returnedRows > MAX_ROWS * 3) fail('read_budget_exceeded');
    return result;
  };
  const tick = () => { if (++statements > 1024) fail('read_budget_exceeded'); };
  const underlying = new WeakMap<D1PreparedStatement, () => D1PreparedStatement>();
  const wrap = (sql: string, bindings: unknown[] = []): D1PreparedStatement => {
    const tokens = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//gu, ' ');
    if (!/^\s*(SELECT|WITH)\b/iu.test(tokens) || /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|ATTACH|DETACH|PRAGMA)\b/iu.test(tokens)) fail('write_forbidden');
    const page = sql.startsWith('SELECT * FROM events LEFT JOIN event_private_payloads secret');
    let actual = sql, args = bindings;
    if (page && bindings.length) {
      if (bindings[0] !== stream || !Number.isSafeInteger(bindings[1]) || !Number.isSafeInteger(bindings[2]) || Number(bindings[2]) > 5000) fail('history_query_invalid');
      actual = `WITH footprint AS (${footprintSql}) ${sql.replace('ORDER BY sequence ASC LIMIT ?', 'AND EXISTS(SELECT 1 FROM footprint WHERE rows=? AND head=? AND bytes=? AND largest=?) ORDER BY sequence ASC LIMIT ?')}`;
      args = [stream, bindings[0], bindings[1], footprint.rows, footprint.head, footprint.bytes, footprint.largest, bindings[2]];
    }
    const statement = () => { tick(); return db.prepare(actual).bind(...args); };
    const wrapped = {
      bind: (...v: unknown[]) => wrap(sql, v),
      all: async () => {
        const result = checked(await statement().all<Row>());
        if (page) {
          historyRows.push(...result.results.filter(row => /^(Project|Document|Block)/u.test(String(row.type))));
          const digest = await consentHash(result.results);
          historyWitnesses.push(async () => { if (await consentHash(checked(await statement().all<Row>()).results) !== digest) fail('historical_subject_changed'); });
        }
        return result;
      },
      first: async () => checked(await statement().first()),
      run: async () => fail('write_forbidden'), raw: async () => fail('raw_read_forbidden'),
    } as D1PreparedStatement;
    underlying.set(wrapped, statement); return wrapped;
  };
  const readonly = { prepare: (sql: string) => wrap(sql),
    batch: async (ss: D1PreparedStatement[]) => {
      const raw = ss.map(s => { const make = underlying.get(s); if (!make) fail('foreign_statement'); return make(); });
      const results = await db.batch(raw); return results.map(checked);
    },
    exec: async () => fail('write_forbidden'), dump: async () => fail('raw_read_forbidden'),
  } as unknown as WorkerEnv['DB'];
  // Unsupported referenced media fails closed instead of hydrating objects as a
  // side effect of qualifying this no-reference source reader.
  return { env: { ...env, DB: readonly, MEDIA: new Proxy(env.MEDIA ?? {}, { get: () => () => fail('media_reference_unsupported') }) } as WorkerEnv,
    historyRows, recheckHistory: async () => { for (const witness of historyWitnesses) await witness(); } };
}

/** Additional owner-administrator observation, opt-in from the original reader.
 * No caller-supplied source, content IDs, approval or configuration assertions.
 * Throws an explicit unavailable code rather than certifying missing custody.
 */
export async function readGenerationSourceEvidence(request: Request, env: WorkerEnv, job: Job, requestedSequence: number) {
  const db = env.DB;
  if (env.FORMA_PILOT_COHORT_ID?.trim()) fail('pilot_scope_unsupported');
  const auth = await requireExistingHoldAdministrator(request, env);
  if (!auth.user || auth.response || auth.user.userId !== job.owner_id) fail('administrator_required');
  const noPilot = { sql: "NOT EXISTS(SELECT 1 FROM pilot_participants p JOIN pilot_cohorts c ON c.cohort_id=p.cohort_id WHERE p.user_id=? AND p.status='active' AND p.revoked_at IS NULL AND c.status IN('active','paused','closed'))", bindings: [job.owner_id] };
  if (!await db.prepare('SELECT 1 AS allowed WHERE '+noPilot.sql).bind(...noPilot.bindings).first()) fail('pilot_scope_unsupported');
  const expiryDeadlines = [Date.parse(job.expires_at)];
  const configuration = { plannerModel: env.OPENAI_MODEL, imageModel: env.OPENAI_IMAGE_MODEL, projectHeader: env.OPENAI_PROJECT, pilot: env.FORMA_PILOT_COHORT_ID };
  const beforeAuth = canonicalConsent(auth.user.authorizationSnapshot);
  const footprint = await db.prepare(footprintSql).bind(job.stream_id).first<Row>();
  if (!footprint || Number(footprint.rows) > MAX_ROWS || Number(footprint.bytes) > MAX_HISTORY_BYTES || Number(footprint.largest) > MAX_CELL) fail('history_capacity_exceeded');
  const history = boundedEnvironment(env, job.stream_id, footprint), bounded = history.env;
  let historicalProofUsed = false;
  const trusted = await continueOutputTrustedContext(request, bounded, job.document_id, 'read', { user: auth.user, principal: auth.user, response: null, impersonation: null });
  if (trusted instanceof Response) fail('current_context_unavailable');
  if (!trusted.context || trusted.scope.kind !== 'personal' || trusted.scope.ownerUserId !== job.owner_id
    || !trusted.sourcePrivateCaptured || trusted.sourceProblems.length || trusted.sourceEvidence.status !== 'verified') fail('current_source_incomplete');
  if (trusted.events.length !== Number(footprint.rows) || trusted.ownerHead !== Number(footprint.head)) fail('history_changed');
  const source = trusted.context;
  const original = parse(job.request_json), originalSnapshot = record(original.snapshot);
  const originalFacts = Array.isArray(originalSnapshot.facts) ? originalSnapshot.facts.map(record) : fail('original_source_invalid');
  if (originalFacts.length > 128) fail('original_source_capacity_exceeded');
  const deadlines = outputActiveSourceDeadlineAssertions({ ...source, snapshot: { ...source.snapshot, facts: source.snapshot.facts.map(f => ({ ...f, active: true })) } });
  expiryDeadlines.push(...deadlines.map(d => d.deadlineMs!));
  // Historical rights must also survive; removed/inactive original facts are not
  // made eligible just because the current source no longer references them.
  for (const fact of originalFacts) for (const key of ['source_expires_at', 'license_expires_at', 'rights_expires_at']) {
    const value = record(fact.properties)[key];
    if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())) fail('original_rights_expired');
    if (typeof value === 'string' && value) expiryDeadlines.push(Date.parse(value));
  }
  const reasons: string[] = [];
  const preferenceCounts = { authored: 0, revoked: 0 };
  for (const event of trusted.events) { if (event.type === 'PreferenceAuthored') preferenceCounts.authored++; if (event.type === 'PreferenceRevoked') preferenceCounts.revoked++; }
  if (preferenceCounts.authored || preferenceCounts.revoked) reasons.push('preference_history_unsupported');
  if (source.snapshot.pins.length || trusted.sourceEvidence.referenceCount) reasons.push('references_or_pins_unsupported');
  if ([...source.snapshot.facts, ...originalFacts].some(f => f.authorship === 'accepted-memory-assisted' || Object.keys(record(f.properties)).some(k => /memory|private_content|content_ref/iu.test(k)))) fail('memory_or_private_pointer_unsupported');
  const historical = authoritativeCreativeContext(trusted.events.filter(e => e.sequence < requestedSequence), { documentId: job.document_id, projectId: trusted.scope.projectId });
  if (!equal(historical.snapshot, originalSnapshot) || !equal(historical.sourceBlockVersions, original.sourceBlockVersions) || historical.documentRevision !== original.documentRevision) fail('original_history_mismatch');
  const currentMatchesOriginal = equal(source.snapshot, historical.snapshot) && source.documentRevision === historical.documentRevision;
  if (!currentMatchesOriginal) reasons.push('historical_revision_differs_from_current');
  const historicalProjection = foldEvents(trusted.events.filter(e => e.sequence < requestedSequence), Number.POSITIVE_INFINITY, job.document_id, trusted.scope.projectId);
  const historicalDocument = historicalProjection.documents.find(d => d.id === job.document_id);
  const refIds = ids([...originalFacts.flatMap(f => ids(f.source_event_refs)), ...historical.snapshot.relationships.flatMap(r => ids(r.source_event_refs)), ...ids(historicalDocument?.sourceEvents)]);
  const exclusion = await nativeMemoryAnswerExclusion(bounded, { answerAlias: 'private_content' });
  const witnesses: Array<() => Promise<unknown>> = [], captured: unknown[] = [];
  const capture = async <T>(read: () => Promise<T>): Promise<T> => { const value = await read(); witnesses.push(read); captured.push(value); return value; };
  const recheck = async () => {
    if (env.DB !== db || Date.parse(job.expires_at) <= Date.now()) fail('custody_changed');
    for (let i = 0; i < witnesses.length; i++) if (!equal(await witnesses[i]!(), captured[i])) fail('producer_changed');
    if (historicalProofUsed) await history.recheckHistory();
    if (!equal(await db.prepare(footprintSql).bind(job.stream_id).first(), footprint)) fail('history_changed');
    await verifyOutputSourceRead(bounded, trusted.scope, trusted.ownerHead, [outputScopeAuthority(trusted.scope, 'read'), noPilot, ...trusted.sourceAssertions, ...deadlines]);
    const latest = await requireExistingHoldAdministrator(request, bounded);
    if (!latest.user || latest.response || canonicalConsent(latest.user.authorizationSnapshot) !== beforeAuth || env.DB !== db) fail('authority_changed');
  };
  const checkDeadline = () => {
    if (expiryDeadlines.some(d => !Number.isFinite(d) || d <= Date.now()) || env.DB !== db) fail('custody_expired');
    if (!equal(configuration, { plannerModel: env.OPENAI_MODEL, imageModel: env.OPENAI_IMAGE_MODEL, projectHeader: env.OPENAI_PROJECT, pilot: env.FORMA_PILOT_COHORT_ID })) fail('configuration_changed');
  };
  const readContent = async (id: string, kind: string) => {
    ids([id]);
    const row = await capture(() => bounded.DB.prepare(`SELECT content_id,kind,content,created_at,expires_at FROM private_content
      WHERE content_id=? AND owner_id=? AND kind=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND length(CAST(content AS BLOB))<=${MAX_CELL}
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes s WHERE s.resource_kind='content' AND s.resource_id=private_content.content_id)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes s WHERE s.content_id=private_content.content_id)
      AND ${exclusion.sql}`).bind(id, job.owner_id, kind, ...exclusion.bindings).first<Row>());
    if (!row) fail('producer_content_unavailable');
    expiryDeadlines.push(Date.parse(String(row.expires_at)));
    return row;
  };
  const eventQuery = (condition: string) => `SELECT event.event_id,event.sequence,event.type,event.payload,event.actor,event.client_id,event.correlation_id,event.occurred_at,
    secret.private_json,secret.owner_id AS private_owner,secret.document_id AS private_document,secret.project_id AS private_project
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.stream_id=? AND ${condition} AND event.sequence<?
    AND length(CAST(event.payload AS BLOB))<=${MAX_CELL}
    AND (secret.private_event_id IS NULL OR (secret.owner_id=? AND secret.document_id=? AND secret.project_id=? AND secret.redacted_at IS NULL AND length(CAST(secret.private_json AS BLOB))<=${MAX_CELL}))
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes s WHERE s.event_id=event.event_id)
    ORDER BY event.sequence LIMIT 257`;
  const sourceEvents = await capture(async () => (await bounded.DB.prepare(eventQuery('event.event_id IN(SELECT value FROM json_each(?))')).bind(job.stream_id, JSON.stringify(refIds), requestedSequence, job.owner_id, job.document_id, trusted.scope.projectId).all<Row>()).results);
  // Keep the captured lookup immutable: accepted compatibility rows are a
  // separate list so the original witness still compares the exact SQL result.
  const historicalScopeProofs: unknown[] = [], historicalSourceEvents: Row[] = [];
  if (sourceEvents.length !== refIds.length) {
    // Diagnose only server-resolved references from the authenticated history.
    // Read booleans, never rejected private bodies or another owner's metadata.
    const diagnosticRows = await capture(async () => (await bounded.DB.prepare(`SELECT event.event_id,
      event.sequence<? AS before_request,
      length(CAST(event.payload AS BLOB))<=${MAX_CELL} AS public_payload_within_limit,
      secret.private_event_id IS NULL AS no_private_row,
      secret.owner_id=? AS private_owner_matches,
      secret.document_id=? AS private_document_matches,
      secret.project_id=? AS private_project_matches,
      secret.redacted_at IS NULL AS private_unredacted,
      length(CAST(secret.private_json AS BLOB))<=${MAX_CELL} AS private_payload_within_limit,
      NOT EXISTS(SELECT 1 FROM project_event_scopes s WHERE s.event_id=event.event_id) AS personal_scope
      FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?)) ORDER BY event.sequence LIMIT 129`)
      .bind(requestedSequence, job.owner_id, job.document_id, trusted.scope.projectId, job.stream_id, JSON.stringify(refIds)).all<Row>()).results);
    const eventChecks = refIds.map(eventId => {
      const row = diagnosticRows.find(r => r.event_id === eventId);
      const failedChecks = !row ? ['event_in_owner_stream'] : [
        ...['before_request', 'public_payload_within_limit', 'personal_scope'].filter(k => row[k] !== 1),
        ...(row.no_private_row === 1 ? [] : ['private_owner_matches', 'private_document_matches', 'private_project_matches', 'private_unredacted', 'private_payload_within_limit'].filter(k => row[k] !== 1)),
      ];
      return { eventId, eventType: trusted.events.find(e => e.eventId === eventId)?.type, failedChecks };
    });
    if (eventChecks.filter(e => !e.failedChecks.length).length !== sourceEvents.length) fail('history_changed');
    const scopeObservations = [];
    const authenticatedHistory = new Map<string, Row | null>();
    const observe = async (event: typeof trusted.events[number]) => {
      if (authenticatedHistory.has(event.eventId)) return authenticatedHistory.get(event.eventId)!;
      if (authenticatedHistory.size >= 128) fail('historical_subject_capacity_exceeded');
      const query = scopeObservationQuery(event, job.owner_id, job.document_id, trusted.scope.projectId, requestedSequence, MAX_CELL);
      const row = await capture(() => bounded.DB.prepare(query.sql).bind(...query.bindings).first<Row>());
      authenticatedHistory.set(event.eventId,row); return row;
    };
    for (const check of eventChecks.filter(e => e.failedChecks.length)) {
      // Only scope-only failures receive additional observations. All other
      // custody failures remain opaque, including foreign/redacted sidecars.
      if (check.failedChecks.some(k => !['private_document_matches','private_project_matches'].includes(k))) continue;
      const event = trusted.events.find(e => e.eventId === check.eventId);
      if (!event) fail('history_changed');
      const row = await observe(event);
      if (!row || row.event_identity_matches !== 1 || row.private_body_matches_history !== 1) fail('producer_changed');
      const observation = classifyScopeObservation(row, event.type);
      let proof: { status: string; reason?: string; failedCensusCheck?: string } = { status: 'unavailable', reason: 'scope_not_genuinely_absent' };
      if (observation.classification === 'absent_scope_metadata') {
        const candidate = historicalScopeCandidate(history.historyRows, trusted.events, event, job.owner_id, job.document_id, trusted.scope.projectId, requestedSequence);
        proof = candidate;
        if (candidate.status === 'candidate') {
          let valid = true;
          for (const producer of candidate.events) {
            const evidence = await observe(producer);
            if (!evidence || evidence.event_identity_matches !== 1 || evidence.private_body_matches_history !== 1
              || evidence.writer_envelope_matches !== 1 && evidence.migration_envelope_matches !== 1
              || evidence.document_sidecar_matches_payload !== 1 || evidence.project_sidecar_matches_payload !== 1) { valid = false; break; }
          }
          if (valid) {
            historicalProofUsed = true;
            // The body is the exact authenticated retained body already read by
            // the native history reader. Never invent or backfill scope fields.
            const raw = history.historyRows.find(r => r.event_id === event.eventId)!;
            historicalSourceEvents.push({ event_id: raw.event_id, sequence: raw.sequence, type: raw.type, payload: raw.payload, actor: raw.actor,
              client_id: raw.client_id, correlation_id: raw.correlation_id, occurred_at: raw.occurred_at, private_json: raw.private_json,
              private_owner: raw.owner_id, private_document: raw.document_id, private_project: raw.project_id });
            historicalScopeProofs.push({ eventId: event.eventId, ...candidate.basis, evidenceEventIds: candidate.events.map(e => e.eventId) });
            proof = { status: 'proven' };
          } else proof = { status: 'unavailable', reason: 'historical_producer_envelope_unavailable' };
        }
      }
      // Only predicate state is disclosed when proof fails; candidate bodies stay
      // internal even when some other original event still blocks the response.
      scopeObservations.push({ eventId: check.eventId, ...observation, membershipProven: proof.status === 'proven', historicalProof: { status: proof.status, ...(proof.reason ? { reason: proof.reason } : {}), ...(proof.failedCensusCheck ? { failedCensusCheck: proof.failedCensusCheck } : {}) } });
    }
    if (sourceEvents.length + historicalSourceEvents.length !== refIds.length) {
    const certificate = { schemaVersion: 'forma-generation-source-diagnostic-v1', status: 'unavailable' as const,
      error: 'generation_source_original_events_unavailable', requiredEventCount: refIds.length, availableEventCount: sourceEvents.length,
      eventChecks, scopeObservations, eligibility: { eligibleForReview: false, humanReviewed: false, executionAuthorized: false } };
    await recheck(); checkDeadline();
    return { certificate, recheck, checkDeadline };
    }
  }
  const qualifiedSourceEvents = [...sourceEvents,...historicalSourceEvents].sort((a,b) => Number(a.sequence)-Number(b.sequence));
  const verifyEventBodies = (events: Row[]) => {
    for (const event of events) {
      const publicBody = parse(event.payload), folded = trusted.events.find(e => e.eventId === event.event_id);
      if (Object.hasOwn(publicBody, '_private_ref') && (publicBody._private_ref !== event.event_id || typeof event.private_json !== 'string')) fail('original_private_body_unavailable');
      if (!folded || folded.type !== event.type || !equal(folded.payload, parse(event.private_json ?? event.payload))) fail('original_body_changed');
    }
  };
  verifyEventBodies(qualifiedSourceEvents);
  const candidates = originalFacts.map((fact, factIndex) => ({ fact, factIndex, properties: record(fact.properties) })).filter(f => f.properties.created_from === 'approved-context-proposal');
  if (candidates.length > 16) fail('producer_capacity_exceeded');
  const producerChains: unknown[] = [], seen = new Set<string>();
  for (const candidate of candidates) {
    const created = qualifiedSourceEvents.find(e => e.type === 'BlockCreated' && parse(e.private_json ?? e.payload).block_id === candidate.fact.block_id);
    const prefix = `authoring:${job.owner_id}:`;
    if (!created || created.actor !== `user:${job.owner_id}` || created.client_id !== 'web:context-approval' || !String(created.correlation_id).startsWith(prefix)) fail('approval_origin_unavailable');
    const previewId = String(created.correlation_id).slice(prefix.length); ids([previewId]);
    if (seen.has(previewId)) continue; seen.add(previewId);
    const receipt = await capture(() => bounded.DB.prepare(`SELECT * FROM authoring_commits WHERE preview_id=? AND actor_user_id=? AND operation='context-proposal'
      AND project_id=? AND document_id=? AND organization_id IS NULL AND project_access_id IS NULL AND verified=1
      AND length(CAST(result_json AS BLOB))<=${MAX_CELL}`).bind(previewId, job.owner_id, trusted.scope.projectId, job.document_id).first<Row>());
    if (!receipt) fail('approval_receipt_unavailable');
    const preview = await readContent(previewId, 'authoring-preview'), saved = parse(preview.content), plan = record(saved.plan), binding = record(plan.binding), result = record(plan.result), review = record(plan.review);
    if (plan.operation !== 'context-proposal' || binding.actorUserId !== job.owner_id || binding.streamId !== job.stream_id || binding.documentId !== job.document_id || binding.projectId !== trusted.scope.projectId || binding.scope !== null
      || receipt.block_id !== binding.blockId || (receipt.canvas_id ?? null) !== (binding.canvasId ?? null)
      || await consentHash(plan) !== receipt.approval_hash || saved.approvalHash !== receipt.approval_hash || !equal(result, parse(receipt.result_json))) fail('approval_binding_mismatch');
    const approvalEvents = await capture(async () => (await bounded.DB.prepare(eventQuery('event.correlation_id=?')).bind(job.stream_id, created.correlation_id, requestedSequence, job.owner_id, job.document_id, trusted.scope.projectId).all<Row>()).results);
    verifyEventBodies(approvalEvents);
    const plannedEvents = Array.isArray(plan.events) ? plan.events.map(record) : [];
    if (!plannedEvents.length || approvalEvents.length > 256 || approvalEvents.length !== plannedEvents.length || approvalEvents.at(-1)?.event_id !== receipt.last_event_id
      || approvalEvents.some((e, i) => e.actor !== `user:${job.owner_id}` || e.client_id !== 'web:context-approval' || e.type !== plannedEvents[i].type || !equal(parse(e.private_json ?? e.payload), plannedEvents[i].payload))) fail('approval_events_mismatch');
    const selections = Array.isArray(review.selections) ? review.selections.map(record) : [];
    const proposals = Array.isArray(review.proposals) ? review.proposals.map(record) : [];
    if (!selections.length || selections.length > 48) fail('approval_selections_unavailable');
    const executions: unknown[] = [];
    for (const executionId of ids(selections.map(s => s.executionId))) {
      const execution = await capture(() => bounded.DB.prepare(`SELECT * FROM consequential_executions WHERE execution_id=? AND actor_user_id=? AND stream_id=? AND project_id=? AND document_id=? AND organization_id IS NULL AND project_access_id IS NULL`).bind(executionId, job.owner_id, job.stream_id, trusted.scope.projectId, job.document_id).first<Row>());
      if (!execution?.consent_ref || !execution.result_ref) fail('execution_evidence_unavailable');
      const consent = await readContent(String(execution.consent_ref), 'execution-consent'), output = await readContent(String(execution.result_ref), 'context-proposal');
      const consentBody = parse(consent.content), cb = record(consentBody.binding), outputBody = parse(output.content);
      if (cb.actorUserId !== job.owner_id || cb.projectId !== binding.projectId || cb.documentId !== binding.documentId || cb.blockId !== binding.blockId || (cb.canvasId ?? null) !== (binding.canvasId ?? null)
        || cb.scope !== null || cb.sourceHash !== binding.sourceHash || await consentHash(cb) !== execution.binding_hash || record(consentBody.preview).executionId !== executionId) fail('execution_binding_mismatch');
      for (const selection of selections.filter(s => s.executionId === executionId)) {
        const proposal = proposals.find(p => p.executionId === executionId && p.proposalId === selection.proposalId);
        const report = record(outputBody.report), decomposition = record(outputBody.plan);
        const research = ['inferred', 'related', 'learned'].flatMap(k => Array.isArray(report[k]) ? report[k] as unknown[] : []).map(record).find(p => p.id === selection.proposalId);
        const decomposed = (Array.isArray(decomposition.proposals) ? decomposition.proposals : []).map(record).find(p => p.id === selection.proposalId);
        if (!proposal || selection.bindingHash !== execution.binding_hash || !equal(proposal.edit, selection.edit)
          || (research ? !equal(proposal.research, research) : !decomposed || !equal(proposal.decomposition, { ...decomposed, addendum: Boolean(record(cb.request).addedText) }))) fail('selected_proposal_mismatch');
      }
      executions.push({ execution, consent, output });
    }
    for (const c of candidates.filter(c => qualifiedSourceEvents.some(e => e.correlation_id === created.correlation_id && e.type === 'BlockCreated' && parse(e.private_json ?? e.payload).block_id === c.fact.block_id))) {
      const event = plannedEvents.find(e => e.type === 'BlockCreated' && record(e.payload).block_id === c.fact.block_id), props = record(record(event?.payload).properties);
      if (props.created_from !== 'approved-context-proposal' || props.context_detail !== true || props.authority !== 'authored'
        || props.source_execution_id !== c.properties.source_execution_id || props.source_proposal_id !== c.properties.source_proposal_id
        || !selections.some(s => s.executionId === props.source_execution_id && s.proposalId === props.source_proposal_id)) fail('fact_producer_mismatch');
    }
    producerChains.push({ preview, receipt, approvalEvents, executions });
  }
  const certificate = {
    schemaVersion: 'forma-generation-source-evidence-v1', status: 'complete' as const, authority: 'current-personal-administrator',
    historical: { documentRevision: historical.documentRevision, sourceBlockVersions: historical.sourceBlockVersions, snapshot: originalSnapshot, sourceEvents: qualifiedSourceEvents, historicalScopeProofs, producerChains, originalRequestSequence: requestedSequence },
    current: { documentRevision: source.documentRevision, sourceBlockVersions: source.sourceBlockVersions, sourceDigest: trusted.sourceDigest, ownerHead: trusted.ownerHead,
      projectHead: trusted.projectHead, snapshot: { ...source.snapshot, document: { id: job.document_id, title: trusted.projection.documents.find(d => d.id === job.document_id)?.title } },
      sourceEvidence: trusted.sourceEvidence, sourceProblems: trusted.sourceProblems, preferenceCounts, sourceDeadlines: deadlines.map(d => d.deadlineMs), matchesHistorical: currentMatchesOriginal },
    configuration: { evidenceClass: 'current-environment-only', plannerModel: env.OPENAI_MODEL ?? 'gpt-5.6-terra', imageModel: env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst',
      plannerBasis: env.OPENAI_MODEL ? 'configured OPENAI_MODEL' : 'application-default', projectHeaderConfigured: Boolean(env.OPENAI_PROJECT), originalAccountBinding: null },
    eligibility: { eligibleForReview: reasons.length === 0, reasons, humanReviewed: false, executionAuthorized: false },
    limits: { historyRows: MAX_ROWS, historyBytes: MAX_HISTORY_BYTES, replyBytes: MAX_REPLY, producerPreviews: 16, queryCeiling: 1024 },
    limitations: ['Read-only observation, not a study grant or billing attestation.', 'Preview/execution confirmation deadlines remain historical; private-row retention is independently checked.', 'No synthetic producer binding or missing body is reconstructed.'],
  };
  if (bytes(certificate) > MAX_REPLY) fail('reply_capacity_exceeded');
  await recheck(); checkDeadline();
  return { certificate, recheck, checkDeadline };
}
