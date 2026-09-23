import type { CreativeEvent } from '../src/model/events.ts';
import { publicEventPayload } from './event-privacy.ts';
import { canonicalConsent } from './consequential-consent.ts';

export const currentIdentifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(v);
export class CurrentSourceRefusal extends Error {}
export function refuseCurrent(code: string): never { throw new CurrentSourceRefusal(code); }
export const currentObject = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return refuseCurrent('envelope_invalid');
  return v as Record<string, unknown>;
};
const allowed = new Set(['ProjectCreated','ProjectOpened','ProjectRenamed','DocumentCreated','DocumentOpened','DocumentRenamed',
  'BlockCreated','BlockRenamed','BlockPropertyEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRelationAdded']);
const same = (a: unknown,b: unknown) => canonicalConsent(a) === canonicalConsent(b);

/** Conservative current incarnation proof, independent of a generation job.
 * Unknown effects and transitions are refused across the complete stream. No
 * unavailable row is declared unrelated, and current fold membership is not proof. */
export function proveCurrentIncarnation(events: CreativeEvent[], documentId: string) {
  const projects = new Map<string, CreativeEvent>(), documents = new Map<string, CreativeEvent>(), blocks = new Map<string, CreativeEvent>();
  const relations = new Set<string>();
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'PreferenceAuthored' || e.type === 'PreferenceRevoked') refuseCurrent('preference_history_unsupported');
    if (!allowed.has(e.type)) refuseCurrent('current_lifecycle_proof_unavailable');
    if (e.schemaVersion !== 1 || e.compensatesEventId || !currentIdentifier(e.eventId)) refuseCurrent('event_version_unsupported');
    for (const key of ['project_id','document_id','block_id']) if (Object.hasOwn(p,key) && !currentIdentifier(p[key])) refuseCurrent('scope_identity_invalid');
    if (p.scope !== undefined && p.scope !== 'document' || p.canvas_id != null || p.library_block === true) refuseCurrent('subject_scope_unsupported');
    if (e.type === 'ProjectCreated') {
      if (!currentIdentifier(p.project_id) || projects.has(p.project_id) || p.document_id !== undefined) refuseCurrent('project_origin_unproven');
      projects.set(p.project_id,e); continue;
    }
    if (e.type.startsWith('Project')) { if (!projects.has(String(p.project_id))) refuseCurrent('project_origin_unproven'); continue; }
    if (e.type === 'DocumentCreated') {
      if (!currentIdentifier(p.document_id) || documents.has(p.document_id) || !projects.has(String(p.project_id))) refuseCurrent('document_origin_unproven');
      documents.set(p.document_id,e); continue;
    }
    if (e.type.startsWith('Document')) {
      const origin=documents.get(String(p.document_id));
      if (!origin || p.project_id !== undefined && p.project_id !== origin.payload.project_id) refuseCurrent('document_binding_conflict');
      if (p.project_id === undefined && e.type !== 'DocumentRenamed') refuseCurrent('document_binding_unavailable');
      continue;
    }
    if (e.type === 'BlockCreated') {
      const doc=documents.get(String(p.document_id));
      if (!currentIdentifier(p.block_id) || blocks.has(p.block_id) || !doc || p.project_id !== doc.payload.project_id) refuseCurrent('block_origin_unproven');
      blocks.set(p.block_id,e); continue;
    }
    if (e.type === 'BlockRelationAdded') {
      const from=blocks.get(String(p.from_block_id)),to=blocks.get(String(p.to_block_id));
      if (!currentIdentifier(p.relation_id) || relations.has(p.relation_id) || !from || !to
        || from.payload.document_id !== to.payload.document_id || p.document_id !== from.payload.document_id
        || p.project_id !== from.payload.project_id || p.project_id !== to.payload.project_id) refuseCurrent('relation_binding_unavailable');
      relations.add(p.relation_id); continue;
    }
    const block=blocks.get(String(p.block_id));
    if (!block || p.document_id !== undefined && p.document_id !== block.payload.document_id
      || p.project_id !== undefined && p.project_id !== block.payload.project_id) refuseCurrent('block_binding_conflict');
    // This is event-specific writer omission support, with explicit unique
    // origins and complete no-transition history. It never changes stored rows.
    if ((p.document_id === undefined || p.project_id === undefined) && e.type !== 'BlockPropertyEdited') refuseCurrent('block_binding_unavailable');
  }
  const document=documents.get(documentId);
  if (!document) refuseCurrent('document_unavailable');
  const project=projects.get(String(document.payload.project_id))!;
  return {projectId:String(document.payload.project_id),documentOrigin:document.eventId,projectOrigin:project.eventId,
    blocks:[...blocks.values()].filter(e=>e.payload.document_id===documentId)};
}

export function verifyCurrentEnvelope(row: Record<string, unknown>, event: CreativeEvent) {
  if (row.custody !== 'custody_ok' || typeof row.private_json !== 'string') refuseCurrent('custody_changed');
  const body=currentObject(JSON.parse(row.private_json));
  if (!same(body,event.payload) || !same(JSON.parse(String(row.payload)),publicEventPayload(event.eventId,body,true).payload)) refuseCurrent('producer_envelope_mismatch');
  for (const key of ['project_id','document_id']) if (row[key] !== (String(body[key]??'') || null)) refuseCurrent('sidecar_binding_mismatch');
}
