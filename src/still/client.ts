import { foldEvents, type CreativeEvent, type EventInput } from '../model/events.ts';
import { documentArtifactRevision } from '../model/document-artifacts.ts';
import type { DocumentJob } from '../model/document-jobs.ts';
import { DEFAULT_MODEL3D_SETTINGS, validateModel3dRequest } from '../model/model3d.ts';
import { isSceneCostPreview, type SceneCostPreview } from '../model/scene-cost-consent.ts';
import type { Abilities, Position } from './decisions.ts';
import { adaptDocumentToModel3d, model3dAdaptationReceipt, type Model3dDocumentAdaptation } from '../model/model3d-prompt-adapter.ts';
import { documentSnapshot } from './context.ts';
import { operationJournal, digest, type WriteJournal } from './operation-journal.ts';

export type Session = {
  user: { userId: string; displayName: string; role: string }; policy: { accepted: boolean; retentionDays: number };
  provider: { configured?: boolean; plannerConfigured?: boolean; videoConfigured?: boolean; audioConfigured?: boolean; model3dConfigured?: boolean };
  permissionEpoch?: string; impersonation?: unknown;
  projectContext?: { projectId: string; projectAccessId: string; organizationId: string; permissions: string[] };
  projects?: { organizationId: string; projectAccessId: string; projectId: string; projectName: string; role: string }[];
};
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) { super(String(body.message ?? body.error ?? 'The request could not be completed.').replaceAll('_', ' ')); this.status = status; this.body = body; }
}
const scope = (s: Session | null) => s ? [s.user.userId, s.projectContext?.projectAccessId ?? 'personal', s.permissionEpoch ?? '', JSON.stringify(s.impersonation ?? null)].join(':') : '';
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data: Record<string, unknown>;
  try { data = await response.json(); } catch { throw new Error('The response was interrupted. Refresh to check whether your work was saved before trying again.'); }
  if (!response.ok) throw new ApiError(response.status, data);
  return data as T;
}
export type GenerationDraft = { format: string; prompt: string; itemCount: number; tone: string; audience: string; requestId: string; sourceHead: number; documentId: string; scopeKey: string; attempted?: boolean; sourceSnapshot?: Record<string, unknown>; sourceBlockVersions?: Array<Record<string, unknown>>; sourceRevision?: string; adaptation?: Model3dDocumentAdaptation; scenePreview?: SceneCostPreview; acknowledgements?: Record<string, boolean> };

export class StillClient {
  session: Session | null = null;
  events: CreativeEvent[] = [];
  content: Record<string, string> = {};
  head = 0;
  jobs: DocumentJob[] = [];
  epoch = 0;
  position: Position = { projectId: '', documentId: '', blockId: '', outputId: '', view: 'projects', intent: '', recentActions: [] };
  onChange = () => {};
  private refreshing: Promise<void> | null = null;
  private refreshingEpoch = -1;
  private pendingWrite: WriteJournal | null = null;
  private get journalScope() { return this.session ? `${this.session.user.userId}:${this.session.projectContext?.projectAccessId ?? 'personal'}` : ''; }
  private retirePendingWrite() { this.pendingWrite = null; operationJournal.clearWrite(this.journalScope); }
  recoveredWrite = false;
  private creation: { signature: string; projectId: string; documentId: string } | null = null;
  get hasUnconfirmedWrite() { return !!this.pendingWrite || !!operationJournal.write(this.journalScope); }
  get scopeKey() { return scope(this.session); }
  get projection() { return foldEvents(this.events, Infinity, this.position.documentId, this.position.projectId); }
  get abilities(): Abilities {
    const s = this.session, shared = s?.projectContext;
    const author = !!s && !s.impersonation && (shared ? shared.permissions.includes('project.author') : ['creator', 'agent', 'admin'].includes(s.user.role));
    const p = s?.provider;
    return { author, generate: !!s && !s.impersonation && (shared ? shared.permissions.includes('project.output.request') : author), projectCreate: author && !shared, formats: [...(p?.configured ? ['image', 'storyboard'] : []), ...(p?.plannerConfigured ? ['short_story', 'scene', 'slides'] : []), ...(p?.videoConfigured ? ['video'] : []), ...(p?.audioConfigured ? ['audio'] : []), ...(p?.model3dConfigured ? ['model3d'] : [])] };
  }
  fence() { const epoch = this.epoch, key = scope(this.session); return () => { if (epoch !== this.epoch || key !== scope(this.session)) throw new Error('The workspace changed. Your draft has not been submitted to another workspace.'); }; }
  async load() {
    const epoch = ++this.epoch;
    this.events = []; this.content = {}; this.head = 0; this.jobs = [];
    const session = await api<Session>('/api/session');
    if (epoch !== this.epoch) return;
    this.session = session; this.pendingWrite = operationJournal.write(this.journalScope);
    if (session.policy.accepted) { await this.refresh(); await this.recoverPendingWrite(); }
    this.onChange();
  }
  async verifyScope() {
    const check = this.fence();
    let fresh: Session;
    try { fresh = await api<Session>('/api/session'); } catch (error) { if (error instanceof ApiError && [401,403,404].includes(error.status)) { ++this.epoch; this.session = null; this.events = []; this.content = {}; this.head = 0; this.jobs = []; this.onChange(); } throw error; }
    check();
    if (scope(fresh) !== scope(this.session)) { ++this.epoch; this.session = fresh; this.pendingWrite = operationJournal.write(this.journalScope); this.creation = null; this.events = []; this.content = {}; this.head = 0; this.jobs = []; this.position = { ...this.position, projectId: fresh.projectContext?.projectId ?? '', documentId: '', outputId: '', blockId: '', view: 'projects' }; this.onChange(); throw new Error('Your account or workspace changed. Reopen the workspace before saving.'); }
    return check;
  }
  async refresh() {
    if (this.refreshing && this.refreshingEpoch === this.epoch) return this.refreshing;
    this.refreshingEpoch = this.epoch;
    const operation = (async () => {
      const check = await this.verifyScope();
      let after = this.head, target = 0; const incoming: CreativeEvent[] = []; let content: Record<string, string> = {};
      for (;;) {
        const page = await api<{ events: CreativeEvent[]; head: number; nextAfter: number; hasMore: boolean; content?: Record<string, string> }>(`/api/events?after=${after}&limit=5000&content=${target ? 0 : 1}`); check();
        if (!Array.isArray(page.events) || !Number.isSafeInteger(page.head)) throw new Error('The event history could not be verified.');
        if (!target) target = page.head;
        incoming.push(...page.events.filter(e => e.sequence <= target)); content = { ...content, ...page.content };
        if (!page.hasMore || page.nextAfter >= target) break;
        if (page.nextAfter <= after) throw new Error('The event history did not advance.');
        after = page.nextAfter;
      }
      await this.verifyScope(); check(); const ids = new Set(this.events.map(e => e.eventId));
      this.events = [...this.events, ...incoming.filter(e => !ids.has(e.eventId))].sort((a, b) => a.sequence - b.sequence);
      this.content = content; this.head = target; this.onChange();
    })().catch(error => { if (error instanceof ApiError && [401,403,404].includes(error.status)) { ++this.epoch; this.events = []; this.content = {}; this.head = 0; this.jobs = []; this.session = null; this.onChange(); } throw error; }).finally(() => { if (this.refreshing === operation) this.refreshing = null; });
    this.refreshing = operation;
    return operation;
  }
  async acceptTerms() {
    await api('/api/session', { action: 'accept_terms', ownershipConfirmed: true, providerProcessingConfirmed: true });
    await this.load();
  }
  async recoverPendingWrite() {
    const original = this.pendingWrite ?? operationJournal.write(this.journalScope);
    if (!original) return false;
    const check = this.fence();
    const receipts = this.events.filter(e => e.correlationId === original.correlationId);
    const verified = await Promise.all(original.receipts.map(async expected => {
      for (const event of receipts) {
        if (event.type !== expected.type || event.actor !== (this.session?.projectContext ? `user:${this.session.user.userId}` : 'user')) continue;
        if (await digest(Object.fromEntries(expected.keys.map(k => [k,event.payload[k]]))) === expected.digest) return true;
      }
      return false;
    })); check();
    if (!verified.every(Boolean)) return false;
    this.retirePendingWrite(); this.recoveredWrite = true; this.onChange(); return true;
  }
  async append(events: EventInput[]) {
    const check = await this.verifyScope();
    const exportOnly = events.every(e => ['ObjectExported', 'DocumentArtifactExported'].includes(e.type));
    if (!this.abilities.author && !(exportOnly && this.session?.projectContext)) throw new Error('This workspace is read only.');
    const inputs: EventInput[] = events.map(e => ({ ...e, payload: { ...e.payload, source_surface: 'still', interaction_policy: 'still-2' } }));
    this.pendingWrite ??= operationJournal.write(this.journalScope);
    const signature = await digest(inputs); check();
    if (this.pendingWrite) {
      const original = this.pendingWrite;
      await this.refresh(); check();
      if (await this.recoverPendingWrite()) {
        if (original.signature === signature) return;
        throw new Error('The earlier save was confirmed. Review it before submitting a different change.');
      }
      throw new Error('The earlier save is still unconfirmed. It has not been repeated. Keep your draft and check the workspace again.');
    }
    const projection = this.projection;
    for (const event of events) {
      const block = projection.libraryBlocks.find(b => b.id === event.payload.block_id);
      if (event.type === 'BlockPropertyEdited' && block && JSON.stringify(block.properties[String(event.payload.property_path)] ?? null) !== JSON.stringify(event.payload.old_value ?? null)) throw new Error('This thought changed while you were writing. Your draft is preserved; reopen the current version before saving.');
      if (event.type === 'DocumentRenamed' && projection.documents.find(d => d.id === event.payload.document_id)?.title !== event.payload.old_title) throw new Error('The document name changed. Reopen its current name before saving.');
      if (event.type === 'BlockWeightSet' && block && Number(block.properties.weight ?? 1) !== Number(event.payload.previous_weight)) throw new Error('This context changed. Review its current influence before saving.');
    }
    const correlationId = crypto.randomUUID();
    const journal: WriteJournal = { correlationId, signature, receipts: await Promise.all(inputs.map(async e => ({type:e.type, keys:Object.keys(e.payload), digest:await digest(e.payload)}))) }; check();
    const submit = () => {
      operationJournal.saveWrite(this.journalScope,journal); this.pendingWrite = journal;
      return api<{ appended: CreativeEvent[]; head: number; rejected?: { reason: string }[] }>('/api/events', { action: inputs.length === 1 ? 'append' : 'batch', ...(inputs.length === 1 ? { event: inputs[0] } : { events: inputs }), expectedSequence: this.head, clientId: 'web:still', correlationId });
    };
    let result;
    try { result = await submit(); } catch (error) {
      if (error instanceof ApiError && [400, 401, 403, 409, 422, 428].includes(error.status)) this.retirePendingWrite();
      if (!(error instanceof ApiError) || error.status !== 409 || error.body.error !== 'stale_sequence') throw error;
      await this.refresh(); check(); throw new Error('The workspace changed before this save. Your draft is preserved. Review the current work before trying again.');
    }
    check();
    if (result.rejected?.length || !Array.isArray(result.appended) || !inputs.every(input => result.appended.some(e => receiptMatches(e, input, this.session!)))) {
      await this.refresh(); throw new Error('The save was not fully confirmed. Your draft is still here; inspect the refreshed document before retrying.');
    }
    this.retirePendingWrite();
    const ids = new Set(this.events.map(e => e.eventId)); this.events.push(...result.appended.filter(e => !ids.has(e.eventId))); this.events.sort((a,b) => a.sequence-b.sequence); this.head = result.head; this.onChange();
    await this.refresh().catch(() => {}); check();
  }
  async createProject(name: string, thought: string) {
    const signature = JSON.stringify(['project', name, thought]);
    if (!this.creation || this.creation.signature !== signature) { if(this.hasUnconfirmedWrite) { await this.refresh(); await this.recoverPendingWrite(); throw new Error(this.hasUnconfirmedWrite ? 'Check the earlier save before starting another project.' : 'The earlier project was saved. Return to your projects to open it.'); } this.creation = { signature, projectId: crypto.randomUUID(), documentId: crypto.randomUUID() }; }
    const { projectId, documentId } = this.creation;
    await this.append([{ type: 'ProjectCreated', payload: { project_id: projectId, name, state: 'active' } }, { type: 'DocumentCreated', payload: { project_id: projectId, document_id: documentId, handle: 'first-idea', title: name } }, ...(thought ? [{ ...this.blockEvent(thought, 'Creative direction', 'direction', projectId, documentId), payload: { ...this.blockEvent(thought, 'Creative direction', 'direction', projectId, documentId).payload, block_id: `first-${documentId}` } }] : [])]);
    this.creation = null; return { projectId, documentId };
  }
  async createDocument(title: string, thought: string) {
    const signature = JSON.stringify(['document', this.position.projectId, title, thought]);
    if (!this.creation || this.creation.signature !== signature) { if(this.hasUnconfirmedWrite) { await this.refresh(); await this.recoverPendingWrite(); throw new Error(this.hasUnconfirmedWrite ? 'Check the earlier save before starting another document.' : 'The earlier document was saved. Return to your documents to open it.'); } this.creation = { signature, projectId: this.position.projectId, documentId: crypto.randomUUID() }; }
    const { projectId, documentId } = this.creation;
    await this.append([{ type: 'DocumentCreated', payload: { project_id: projectId, document_id: documentId, title, handle: `page-${documentId.slice(0, 8)}` } }, ...(thought ? [{ ...this.blockEvent(thought, 'Creative direction', 'direction', projectId, documentId), payload: { ...this.blockEvent(thought, 'Creative direction', 'direction', projectId, documentId).payload, block_id: `first-${documentId}` } }] : [])]);
    this.creation = null; return { projectId, documentId };
  }
  blockEvent(text: string, handle: string, type = 'direction', projectId = this.position.projectId, documentId = this.position.documentId): EventInput {
    return { type: 'BlockCreated', payload: { block_id: crypto.randomUUID(), project_id: projectId, document_id: documentId, scope: 'document', type, handle, position: String(this.head + 1), properties: { text, weight: .8, authority: 'authored' } } };
  }
  async switchWorkspace(project?: NonNullable<Session['projects']>[number]) {
    ++this.epoch; this.events = []; this.content = {}; this.head = 0; this.jobs = []; this.onChange();
    if (project) await api(`/api/workspaces/${encodeURIComponent(project.organizationId)}/projects/${encodeURIComponent(project.projectAccessId)}/context`, {}, 'POST');
    else await api('/api/workspaces/context', undefined, 'DELETE');
    this.position = { ...this.position, projectId: project?.projectId ?? '', documentId: '', blockId: '', outputId: '', view: project ? 'documents' : 'projects' };
    await this.load();
  }
  async editArtifact(id: string, markdown: string, expectedRevision: number, items?: { index: number; body: string }[]) {
    const check = await this.verifyScope();
    if (documentArtifactRevision(this.events, id) !== expectedRevision) throw new Error('This work changed while you were writing. Your draft is preserved; reopen the current revision before saving.');
    const result = await api<{appended?:CreativeEvent[]}>(`/api/artifacts/${encodeURIComponent(id)}`, { markdown, expectedRevision, ...(items ? {items}: {}) }, 'PATCH'); check();
    if (!result.appended?.some(e => e.type === 'DocumentArtifactEdited' && e.payload.artifact_id === id)) throw new Error('The edit is unconfirmed. Check the original revision before retrying.');
    await this.refresh();
  }
  model3dAdaptation() { return adaptDocumentToModel3d(documentSnapshot(this.projection, this.position.documentId), { referenceCount: 0 }); }
  generationPayload(draft: GenerationDraft) {
    const payload: Record<string, unknown> = { locale: 'en', productionMode: 'manual', promptTechnique: 'prose', requestKey: `still:${draft.documentId}:${draft.sourceHead}:${draft.requestId}`, ...(draft.sourceSnapshot ? {snapshot:draft.sourceSnapshot,sourceBlockVersions:draft.sourceBlockVersions,expectedDocumentRevision:draft.sourceRevision} : {}), ...(draft.format === 'image' ? {} : { artifactKind: draft.format, itemCount: draft.itemCount, tone: draft.tone, audience: draft.audience }) };
    if (draft.format === 'scene') Object.assign(payload, { sceneRequestId: draft.requestId, sceneMedium: 'visual', ...(draft.scenePreview ? { sceneCostConsent: { ...draft.scenePreview, confirmed: true } } : {}) });
    if (draft.format === 'model3d') Object.assign(payload, { model3dPrompt: draft.prompt, model3dSettings: { ...DEFAULT_MODEL3D_SETTINGS }, model3dReferenceBlockIds: [], ...(draft.adaptation && draft.prompt === draft.adaptation.prompt ? { model3dPromptSource: 'document', model3dAdaptation: model3dAdaptationReceipt(draft.adaptation) } : {}) });
    if (draft.format === 'video') Object.assign(payload, { videoSeconds: 4, videoSize: '1280x720', videoAudioMode: 'silent' });
    return { kind: draft.format === 'image' ? 'generate' : 'render_document', documentId: draft.documentId, sourceSurface: 'still', payload };
  }
  async previewScene(draft: GenerationDraft) {
    const check = await this.verifyScope(), request = this.generationPayload(draft);
    delete request.payload.sceneCostConsent; request.payload.sceneCostPreview = true;
    const result = await api<{ sceneCostPreview?: unknown; job?: DocumentJob }>('/api/document-jobs', request); check();
    if (result.job) { this.jobs = [result.job, ...this.jobs.filter(j => j.jobId !== result.job!.jobId)]; return null; }
    if (!isSceneCostPreview(result.sceneCostPreview)) throw new Error('A current scene cost could not be confirmed.');
    return result.sceneCostPreview;
  }
  async generate(draft: GenerationDraft) {
    const check = await this.verifyScope();
    if (draft.scopeKey !== this.scopeKey || draft.documentId !== this.position.documentId) throw new Error('This generation belongs to a different document. Review a fresh request.');
    if (!this.abilities.generate) throw new Error('Generation is unavailable for this account.');
    const pending = operationJournal.generation(this.journalScope,draft.documentId);
    if (draft.attempted || pending) {
      draft.attempted = true;
      await this.pollJobs(); check();
      const key = pending?.requestKey ?? String(this.generationPayload(draft).payload.requestKey);
      const job = this.jobs.find(j => j.requestKey === key || j.requestKey.startsWith(`${key}:`));
      if (job) { operationJournal.clearGeneration(this.journalScope,draft.documentId); return job; }
      throw new Error('The original generation is unconfirmed. It has not been submitted again. Check back for its original receipt.');
    }
    if (draft.sourceSnapshot) {
      await this.refresh(); check();
      if (await digest(documentSnapshot(this.projection,draft.documentId)) !== await digest(draft.sourceSnapshot)) throw new Error('The document changed after you reviewed it. Reopen generation to review the current context.');
    }
    if (draft.format === 'model3d') {
      if (draft.adaptation && draft.prompt === draft.adaptation.prompt && !draft.adaptation.valid) throw new Error(draft.adaptation.issues.map(i => i.message).join(' '));
      const validation = validateModel3dRequest({ prompt: draft.prompt, settings: DEFAULT_MODEL3D_SETTINGS, referenceCount: 0 });
      if (!validation.valid) throw new Error(validation.issues.map(i => i.message).join(' '));
    }
    const request = this.generationPayload(draft);
    Object.assign(request.payload, { paidMediaConfirmed: true, ...draft.acknowledgements });
    operationJournal.saveGeneration(this.journalScope,{documentId:draft.documentId,format:draft.format,requestKey:String(request.payload.requestKey)});
    draft.attempted = true;
    let result: {job:DocumentJob};
    try { result = await api<{ job: DocumentJob }>('/api/document-jobs', request); }
    catch(error) { if(error instanceof ApiError && [400,401,403,409,422,428].includes(error.status)) { draft.attempted = false; operationJournal.clearGeneration(this.journalScope,draft.documentId); } throw error; }
    check();
    if (!result.job?.jobId || result.job.documentId !== this.position.documentId) throw new Error('The generation receipt could not be verified. Check the work before submitting again.');
    operationJournal.clearGeneration(this.journalScope,draft.documentId);
    this.jobs = [result.job, ...this.jobs.filter(j => j.jobId !== result.job.jobId)]; this.onChange();
    void api(`/api/document-jobs/${encodeURIComponent(result.job.jobId)}/run`, {}).catch(() => {});
    return result.job;
  }
  async pollJobs() {
    if (!this.position.documentId) return;
    const check = await this.verifyScope(), document = this.position.documentId;
    const result = await api<{ jobs: DocumentJob[] }>(`/api/document-jobs?document=${encodeURIComponent(document)}`); check();
    await this.verifyScope(); check(); if (document !== this.position.documentId) return;
    this.jobs = result.jobs ?? []; this.onChange();
    if (this.jobs.some(j => ['completed', 'partial', 'failed'].includes(j.status))) await this.refresh();
  }
}

function receiptMatches(event: CreativeEvent, input: EventInput, session: Session) {
  if (!event.eventId || event.type !== input.type || event.actor !== (session.projectContext ? `user:${session.user.userId}` : 'user')) return false;
  if (session.projectContext && event.payload.project_id !== session.projectContext.projectId) return false;
  return ['project_id', 'document_id', 'block_id', 'artifact_id', 'object_id', 'new_value', 'new_title'].every(key => input.payload[key] === undefined || JSON.stringify(event.payload[key]) === JSON.stringify(input.payload[key]));
}
