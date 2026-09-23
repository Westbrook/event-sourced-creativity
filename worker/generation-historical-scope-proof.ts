import type { CreativeEvent } from '../src/model/events.ts';

type Row = Record<string, unknown>;
type Result = { status: 'unavailable'; reason: string } | { status: 'candidate'; events: CreativeEvent[]; basis: { rule: string; eventSequence: number; throughSequenceExclusive: number; originEventIds: string[] } };
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u.test(v);
const harmless = new Set(['ProjectCreated','ProjectOpened','ProjectRenamed','DocumentCreated','DocumentOpened','DocumentRenamed',
  'DocumentRenderRequested','DocumentRenderCompleted','DocumentRenderFailed','DocumentArtifactEdited',
  'BlockCreated','BlockRenamed','BlockPropertyEdited','BlockWeightSet','BlockLocked','BlockUnlocked']);
const understood = new Set([...harmless,'ProjectStateChanged','DocumentForked','DocumentRemoved','DocumentRestored',
  'BlockDocumentAttached','BlockDocumentDetached','BlockRehomed','BlockRemoved','BlockRestored','BlockRelationAdded','BlockRelationRemoved']);

/** A candidate only, never an authority grant. The caller must authenticate all
 * returned events against retained producer envelopes and witness the complete
 * raw history again. No fold defaults or current projection are used here. */
export function historicalScopeCandidate(rows: Row[], events: CreativeEvent[], target: CreativeEvent, owner: string, document: string, project: string, before: number): Result {
  const unavailable = (reason: string): Result => ({ status: 'unavailable', reason });
  const p = target.payload, block = target.type === 'BlockPropertyEdited' ? p.block_id : null;
  if (target.type === 'BlockPropertyEdited' ? !identifier(block) || Object.hasOwn(p,'document_id') || Object.hasOwn(p,'project_id')
    : target.type !== 'DocumentRenamed' || p.document_id !== document || Object.hasOwn(p,'project_id')) return unavailable('unsupported_absence_shape');
  if (p.scope !== undefined && p.scope !== 'document' || p.canvas_id != null || p.library_block === true) return unavailable('unsupported_subject_scope');
  const byId = new Map(events.map(e => [e.eventId,e]));
  const relevant: CreativeEvent[] = [];
  for (const row of rows) {
    if (Number(row.sequence) >= before || !/^(Project|Document|Block)/u.test(String(row.type))) continue;
    if (!understood.has(String(row.type))) return unavailable('historical_event_type_unsupported');
    // A redacted/foreign/missing envelope could conceal an earlier incarnation
    // or transition. Refuse the proof instead of treating missing history as none.
    if (row.stream_id !== 'creative:'+owner || row.owner_id !== owner || row.private_event_id !== row.event_id || row.redacted_at != null || typeof row.private_json !== 'string') return unavailable('historical_identity_census_unavailable');
    let body: Record<string, unknown> | null, publicBody: Record<string, unknown> | null;
    try { body = object(JSON.parse(row.private_json)); publicBody = object(JSON.parse(String(row.payload))); } catch { return unavailable('historical_identity_census_unavailable'); }
    if (!body || !publicBody || publicBody._private_ref !== row.event_id) return unavailable('historical_identity_census_unavailable');
    // Both producer contracts preserve these operational identities. An absent
    // public identifier must never hide a conflicting retained private subject.
    for (const key of ['block_id','document_id','project_id']) {
      if (Object.hasOwn(body,key) !== Object.hasOwn(publicBody,key) || body[key] !== publicBody[key]
        || body[key] != null && !identifier(body[key])) return unavailable('historical_identity_census_inconsistent');
    }
    const type = String(row.type);
    if ((type === 'DocumentCreated' || type === 'DocumentForked') && !identifier(body.document_id)
      || type === 'BlockCreated' && !identifier(body.block_id)) return unavailable('historical_creation_identity_missing');
    const touches = type.startsWith('Project') && (body.project_id === project || body.project_id == null)
      || type.startsWith('Document') && (body.document_id === document || body.document_id == null)
      || block !== null && type.startsWith('Block') && body.block_id === block;
    if (!touches) continue;
    const event = byId.get(String(row.event_id));
    if (!event || event.type !== type || event.sequence !== Number(row.sequence)) return unavailable('historical_identity_changed');
    relevant.push(event);
    if (relevant.length > 128) return unavailable('historical_subject_capacity_exceeded');
  }
  const projectOrigins = relevant.filter(e => e.type === 'ProjectCreated');
  const documentOrigins = relevant.filter(e => e.type === 'DocumentCreated' || e.type === 'DocumentForked');
  const blockOrigins = relevant.filter(e => e.type === 'BlockCreated');
  const projectOrigin = projectOrigins[0], documentOrigin = documentOrigins[0], blockOrigin = blockOrigins[0];
  if (projectOrigins.length !== 1 || documentOrigins.length !== 1 || documentOrigin?.type !== 'DocumentCreated'
    || block !== null && blockOrigins.length !== 1) return unavailable('historical_origin_missing_or_recreated');
  if (!projectOrigin || !documentOrigin || projectOrigin.sequence >= documentOrigin.sequence || documentOrigin.sequence >= target.sequence
    || !identifier(projectOrigin.payload.project_id) || projectOrigin.payload.project_id !== project
    || documentOrigin.payload.project_id !== project || documentOrigin.payload.document_id !== document
    || block !== null && (!blockOrigin || blockOrigin.sequence <= documentOrigin.sequence || blockOrigin.sequence >= target.sequence
      || blockOrigin.payload.project_id !== project || blockOrigin.payload.document_id !== document
      || blockOrigin.payload.scope !== undefined && blockOrigin.payload.scope !== 'document'
      || blockOrigin.payload.canvas_id != null || blockOrigin.payload.library_block === true)) return unavailable('historical_origin_scope_unproven');
  for (const event of relevant) {
    // Reject transitions even if a later event moves the subject back. This rule
    // proves an unchanged incarnation through the original generation request.
    if (!harmless.has(event.type)) return unavailable('historical_subject_transition_unsupported');
    for (const [key,expected] of [['project_id',project],['document_id',document]] as const) {
      if (Object.hasOwn(event.payload,key) && event.payload[key] !== expected) return unavailable('historical_explicit_scope_conflict');
    }
    if (event.type.startsWith('Block') && (event.payload.scope !== undefined && event.payload.scope !== 'document'
      || event.payload.canvas_id != null || event.payload.library_block === true)) return unavailable('historical_subject_transition_unsupported');
  }
  if (!relevant.some(e => e.eventId === target.eventId)) return unavailable('historical_subject_missing');
  return { status: 'candidate', events: relevant, basis: { rule: block === null ? 'document-rename-explicit-unique-origin-v1' : 'block-property-explicit-unique-origin-v1',
    eventSequence: target.sequence, throughSequenceExclusive: before, originEventIds: [projectOrigin.eventId,documentOrigin.eventId,...(blockOrigin ? [blockOrigin.eventId] : [])] } };
}
