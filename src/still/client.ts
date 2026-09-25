import { defaultGenerationSettings, validateGenerationOptions, type GenerationSettings } from './generation-settings.ts';
import { warmCompletedVideoCovers } from '../media/video-cover.ts';
import { normalizeAudioRequestProfile } from '../model/audio.ts';
import { generationOutcome } from './generation-outcome.ts';
import {stageEvidenceRefs} from './rejection-evidence.ts';
import { sharedIdeaEdits, independentIdeaEdits, ideaContentEdit } from '../model/shared-idea-edits.ts';
import { chooseSharedIdeaEdit, IdeaEditCanceled } from '../ui/shared-idea-choice.ts';
import { documentJobCanAcknowledgeSafety } from "../model/document-jobs.ts";
import { generationResult } from './results.ts';
import { GenerationActivity, generationNoticeKey } from './generation-activity.ts';
import { foldEvents, type CreativeEvent, type EventInput } from '../model/events.ts';
import { documentArtifactRevision } from '../model/document-artifacts.ts';
import type { DocumentJob } from '../model/document-jobs.ts';
import { DEFAULT_MODEL3D_SETTINGS, validateModel3dRequest } from '../model/model3d.ts';
import { isSceneCostPreview, type SceneCostPreview } from '../model/scene-cost-consent.ts';
import { POLICY_VERSION, type Abilities, type Position } from './decisions.ts';
import { adaptDocumentToModel3d, model3dAdaptationReceipt, type Model3dDocumentAdaptation } from '../model/model3d-prompt-adapter.ts';
import { documentSnapshot, documentSource } from './context.ts';
import { operationJournal, digest, type WriteJournal } from './operation-journal.ts';

export type Session = {
  user: { userId: string; displayName: string; role: string }; policy: { accepted: boolean; retentionDays: number };
  provider: { configured?: boolean; plannerConfigured?: boolean; videoConfigured?: boolean; audioConfigured?: boolean; model3dConfigured?: boolean };
  creation?:{enabled:boolean;manualOnly?:boolean}; permissionEpoch?: string; impersonation?: unknown;
  projectContext?: { projectId: string; projectAccessId: string; organizationId: string; permissions: string[] };
  projects?: { organizationId: string; projectAccessId: string; projectId: string; projectName: string; role: string }[];
};
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) { super(String(body.message ?? body.error ?? 'The request could not be completed.').replaceAll('_', ' ')); this.status = status; this.body = body; }
}
const scope = (s: Session | null) => s ? [s.user.userId, s.projectContext?.projectAccessId ?? 'personal', s.permissionEpoch ?? '', JSON.stringify(s.impersonation ?? null)].join(':') : '';
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', timeoutMs?:number,signal?:AbortSignal): Promise<T> {
  const controller = method === 'GET' || timeoutMs ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const response = await fetch(path, { method, credentials: 'same-origin', ...(signal?{signal:controller?AbortSignal.any([signal,controller.signal]):signal}:controller ? {signal:controller.signal} : {}), headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data: Record<string, unknown>;
    try { data = await response.json(); } catch { throw new Error(method === 'GET' ? 'The response was interrupted. Try again.' : 'Response interrupted. Refresh to check the save before retrying.'); }
    if (!response.ok) throw new ApiError(response.status, data);
    return data as T;
  };
  if (!controller) return read();
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error('The server took too long to respond. Try again.')); controller.abort(); }, timeoutMs??30_000);
    })]);
  } finally { clearTimeout(timer); }
}
export type GenerationDraft = { settings?: GenerationSettings; format: string; prompt: string; itemCount: number; tone: string; audience: string; requestId: string; sourceHead: number; documentId: string; scopeKey: string; attempted?: boolean; recoveryClosed?: boolean; previousUnconfirmed?: boolean; previousAttemptId?: string; previousDocumentRevision?: string | null; sourceSnapshot?: ReturnType<typeof documentSnapshot>; sourceBlockVersions?: Array<Record<string, unknown>>; sourceRevision?: string; adaptation?: Model3dDocumentAdaptation; scenePreview?: SceneCostPreview; acknowledgements?: Record<string, boolean> };

export class StillClient {
  session: Session | null = null;
  events: CreativeEvent[] = [];
  content: Record<string, string> = {};
  head = 0;
  historyComplete = true;
  jobs: DocumentJob[] = [];
  readonly generationActivity = new GenerationActivity();
  private jobsReadKey = '';
  jobsError = '';
  private get jobsKey() { return `${this.epoch}:${this.scopeKey}:${this.position.documentId}:${['generation','rejection'].includes(this.position.view)?this.position.outputId:''}`; }
  get jobsLoaded() { return this.jobsReadKey===this.jobsKey; }
  epoch = 0;
  position: Position = { projectId: '', documentId: '', blockId: '', outputId: '', view: 'projects', intent: '', recentActions: [] };
  onChange = () => {};
  private refreshing: Promise<void> | null = null;
  private refreshingEpoch = -1;
  private pendingWrite: WriteJournal | null = null;
  private verifying: { epoch: number; promise: Promise<() => void> } | null = null;
  private jobRead = 0;
  private contentRevision = 0;
  private contentRead = 0;
  private contentApplied = 0;
  private contentWrites = new Map<string, number>();
  private polling: { key: string; promise: Promise<void> } | null = null;
  private hydrating: { epoch: number; promise: Promise<void> } | null = null;
  private projected: { view:string; events: CreativeEvent[]; length: number; document: string; project: string; value: ReturnType<typeof foldEvents> } | null = null;
  private get journalScope() { return this.session ? `${this.session.user.userId}:${this.session.projectContext?.projectAccessId ?? 'personal'}` : ''; }
  private retirePendingWrite() { this.pendingWrite = null; operationJournal.clearWrite(this.journalScope); }
  recoveredWrite = false;
  private creation: { signature: string; projectId: string; documentId: string } | null = null;
  get hasUnconfirmedWrite() { return !!this.pendingWrite || !!operationJournal.write(this.journalScope); }
  get pendingWriteId() { return (this.pendingWrite ?? operationJournal.write(this.journalScope))?.correlationId ?? ''; }
  get pendingGeneration() { return operationJournal.generation(this.journalScope, this.position.documentId); }
  get scopeKey() { return scope(this.session); }
  get projection() {
    const { documentId: document, projectId: project } = this.position, previous = this.projected;
    if (previous?.view===this.position.view && previous.events === this.events && previous.length === this.events.length && previous.document === document && previous.project === project) return previous.value;
    const folded = foldEvents(this.events, Infinity, document, project);
    const value = this.position.view==='ideas'?{...folded,documentId:"",documentTitle:"Ideas",blocks:folded.libraryBlocks,blockRelations:folded.libraryBlockRelations}:folded;
    this.projected = { view:this.position.view, events: this.events, length: this.events.length, document, project, value }; return value;
  }
  private clearSource() { ++this.epoch; this.generationRunAfter.clear(); this.generationActivity.clear(); this.events = []; this.content = {}; this.head = 0; this.jobs = []; this.creation = null; this.projected = null; this.contentWrites.clear(); }
  private async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const check = this.fence();
    try { const result = await api<T>(path, body, method); check(); return result; }
    catch (error) {
      check();
      if (error instanceof ApiError && ([401, 403].includes(error.status) || error.status === 404 && (path.startsWith('/api/session') || path.startsWith('/api/events?')))) { this.clearSource(); this.session = null; this.onChange(); }
      throw error;
    }
  }
  private mergeEvents(incoming: CreativeEvent[]) {
    const ids = new Set(this.events.map(e => e.eventId));
    const added = incoming.filter(e => { if (ids.has(e.eventId)) return false; ids.add(e.eventId); return true; });
    if (added.length) this.events = [...this.events, ...added].sort((a, b) => a.sequence - b.sequence);
    return added.length > 0;
  }
  private applyReceipt(result: { appended: CreativeEvent[]; head?: number; content?: Record<string, string> }) {
    this.mergeEvents(result.appended);
    if (result.content) {
      const revision = ++this.contentRevision;
      for (const key of Object.keys(result.content)) this.contentWrites.set(key, revision);
      this.content = { ...this.content, ...result.content };
    }
    // A receipt can arrive after another writer. Advance only through known events;
    // a later delta read fills any gap instead of skipping collaborator history.
    for (const event of this.events) { if (event.sequence === this.head + 1) this.head = event.sequence; }
    this.onChange();
    if ((result.head ?? this.head) > this.head || needsContent(result.appended.filter(e => e.type !== 'DocumentArtifactEdited' || !result.content), this.content)) void this.refresh().catch(() => {});
  }
  get abilities(): Abilities {
    const s = this.session, shared = s?.projectContext;
    const author = !!s && !s.impersonation && (shared ? shared.permissions.includes('project.author') : ['creator', 'agent', 'admin'].includes(s.user.role));
    const p = s?.provider;
    return { author, generate: !!s && !s.impersonation && (shared ? shared.permissions.includes('project.output.request') : author), projectCreate: author && !shared, formats: [...(p?.plannerConfigured ? ['image', 'storyboard'] : []), ...(p?.plannerConfigured ? ['short_story', 'scene', 'slides'] : []), ...(p?.videoConfigured ? ['video'] : []), ...(p?.audioConfigured ? ['audio'] : []), ...(p?.model3dConfigured ? ['model3d'] : [])] };
  }
  fence() { const epoch = this.epoch, key = scope(this.session); return () => { if (epoch !== this.epoch || key !== scope(this.session)) throw new Error('Workspace changed. Check the original workspace.'); }; }
  async load(options: { hydrateContent?: boolean; route?: {documentId:string;view?:string} } = {}) {
    const epoch = ++this.epoch;
    this.generationActivity.clear();
    this.events = []; this.content = {}; this.head = 0; this.jobs = []; this.session = null; this.projected = null; this.contentWrites.clear();
    const session = await api<Session>('/api/session?profile=still');
    if (epoch !== this.epoch) return;
    this.session = session; this.pendingWrite = operationJournal.write(this.journalScope);
    if (session.policy.accepted) { if(options.route&&options.route.view!=='ideas'){await this.loadRoute(options.route.documentId);this.historyComplete=false;}else{this.historyComplete=true;await this.refreshSource(this.fence(), options.hydrateContent !== false);await this.recoverPendingWrite();} }
    this.onChange();
  }
  private async loadRoute(documentId:string){
    const check=this.fence();let after=0,target:number|undefined;const events:CreativeEvent[]=[];
    for(let pages=0;;pages++){
      if(pages>=500)throw new Error('The page could not be verified.');
      const query='stillDocument='+encodeURIComponent(documentId);
      const page=await this.request<{events:CreativeEvent[];head:number;hasMore:boolean;nextAfter:number}>('/api/events?content=0&limit=5000&after='+after+'&'+query);check();
      target??=page.head;events.push(...page.events.filter(e=>e.sequence<=target!));
      if(!page.hasMore||page.nextAfter>=target)break;if(page.nextAfter<=after)throw new Error('The page could not be verified.');after=page.nextAfter;
    }
    this.events=events;this.head=target??0;
  }
  async completeHistory(){await this.refreshSource(this.fence(),false);await this.recoverPendingWrite();}
  async verifyScope() {
    if (this.verifying?.epoch === this.epoch) return this.verifying.promise;
    const epoch = this.epoch, check = this.fence();
    const promise = (async () => {
      const fresh = await this.request<Session>('/api/session?profile=still');
      check();
      if (scope(fresh) !== scope(this.session)) {
        this.clearSource(); this.session = fresh; this.pendingWrite = operationJournal.write(this.journalScope);
        this.position = { ...this.position, projectId: fresh.projectContext?.projectId ?? '', documentId: '', outputId: '', blockId: '', view: 'projects' };
        this.onChange(); throw new Error('Your workspace changed. Reopen before saving.');
      }
      const changed = JSON.stringify(this.session) !== JSON.stringify(fresh);
      this.session = fresh;
      if (changed) this.onChange();
      return check;
    })().finally(() => { if (this.verifying?.promise === promise) this.verifying = null; });
    this.verifying = { epoch, promise }; return promise;
  }
  async refresh() {
    if (this.refreshing && this.refreshingEpoch === this.epoch) return this.refreshing;
    return this.refreshSource(await this.verifyScope());
  }
  async ensureContent(reference: string):Promise<void> {
    if (!reference || reference in this.content) return;
    const check = this.fence();
    if (this.hydrating?.epoch === this.epoch) { await this.hydrating.promise;check();if(!(reference in this.content))return this.ensureContent(reference); }
    else {
      const revision = this.contentRevision, read = ++this.contentRead;
      const promise = (async () => {
        const result = await this.request<{content?: Record<string,string>}>(`/api/events?after=${this.head}&limit=1&content=1&contentId=${encodeURIComponent(reference)}`); check();
        const newer = Object.fromEntries(Object.entries(this.content).filter(([key]) => (this.contentWrites.get(key) ?? 0) > revision));
        if (read > this.contentApplied) {
          this.contentApplied = read;
          const retained={...this.content};delete retained[reference];
          this.content = { ...retained,...result.content, ...newer }; this.onChange();
        }
      })();
      this.hydrating = {epoch:this.epoch,promise};
      try { await promise; } finally { if (this.hydrating?.promise === promise) this.hydrating = null; }
    }
    check();
    if (!(reference in this.content)) throw new Error('This writing is unavailable.');
  }
  private refreshSource(check: () => void, hydrateContent = true) {
    check();
    if (this.refreshing && this.refreshingEpoch === this.epoch) return this.refreshing;
    this.refreshingEpoch = this.epoch;
    const operation = (async () => {
      const partial=!this.historyComplete;
      const start = partial?0:this.head, contentRevision = this.contentRevision;
      let contentRead = ++this.contentRead;
      let after = start, target: number | undefined;
      const incoming: CreativeEvent[] = []; let hydrated: Record<string, string> | undefined;
      for (let count = 0; ; count++) {
        if (count >= 500) throw new Error('The event history could not be verified.');
        // The creative projection does not need account telemetry. Jev still reads
        // the full authorized history server-side for its own state.
        const page = await this.request<{ events: CreativeEvent[]; head: number; nextAfter: number; hasMore: boolean; content?: Record<string, string> }>(`/api/events?after=${after}&limit=6500&profile=workspace&content=0`); check();
        if (!Array.isArray(page.events) || !Number.isSafeInteger(page.head) || page.head < start || page.events.some(e => !e.eventId || !Number.isSafeInteger(e.sequence) || e.sequence < 1 || !e.payload)) throw new Error('The event history could not be verified.');
        target ??= page.head;
        incoming.push(...page.events.filter(e => e.sequence <= target!));
        if (page.content) hydrated = { ...hydrated, ...page.content };
        if (!page.hasMore || page.nextAfter >= target) break;
        if (!Number.isSafeInteger(page.nextAfter) || page.nextAfter <= after) throw new Error('The event history did not advance.');
        after = page.nextAfter;
      }
      if (hydrateContent && needsContent(incoming, { ...this.content, ...hydrated })) {
        contentRead = ++this.contentRead;
        const page = await this.request<{ content?: Record<string, string> }>(`/api/events?after=${target}&limit=1&content=1`); check();
        hydrated = page.content;
      }
      check();
      if(partial){this.events=[...incoming,...this.events.filter(e=>e.sequence>target!)].sort((a,b)=>a.sequence-b.sequence);this.projected=null;this.historyComplete=true;}
      const changed = partial||this.mergeEvents(incoming), advanced = target! > this.head;
      if (hydrated && contentRead > this.contentApplied) {
        this.contentApplied = contentRead;
        // An artifact save may finish while this read is in flight. Its acknowledged
        // body is newer than this read; retain it while hydrating other references.
        const newer = Object.fromEntries(Object.entries(this.content).filter(([key]) => (this.contentWrites.get(key) ?? 0) > contentRevision));
        this.content = { ...hydrated, ...newer };
      }
      this.head = Math.max(this.head, target!);
      for (const event of this.events) { if (event.sequence === this.head + 1) this.head = event.sequence; }
      if (changed || advanced || hydrated) this.onChange();
    })().finally(() => { if (this.refreshing === operation) this.refreshing = null; });
    this.refreshing = operation; return operation;
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
  /** Receipt lookup is independent of a form draft and never repeats a write. */
  async checkPendingSave() {
    const check=await this.verifyScope(),correlationId=this.pendingWriteId;
    if(!correlationId)return {confirmed:true,correlationId};
    await this.refresh();check();
    const confirmed=await this.recoverPendingWrite();check();
    if(!confirmed&&this.pendingWriteId!==correlationId)throw new Error('The pending save changed. Check it again.');
    if(confirmed)this.creation=null;
    return {confirmed,correlationId};
  }
  /** Explicit acknowledgement of uncertainty; only releases this tab's lock.
   * It neither cancels the original server request nor submits another one. */
  async startNewSave(correlationId:string) {
    if(!correlationId||this.pendingWriteId!==correlationId)throw new Error('The pending save changed. Check it again.');
    const result=await this.checkPendingSave();
    if(result.correlationId!==correlationId)throw new Error('The pending save changed. Check it again.');
    if(!result.confirmed){
      if(this.pendingWriteId!==correlationId)throw new Error('The pending save changed. Check it again.');
      this.retirePendingWrite();
    }
    this.creation=null;this.onChange();return result;
  }
  async append(events: EventInput[]) {
    const check = await this.verifyScope();
    const exportOnly = events.every(e => ['ObjectExported', 'DocumentArtifactExported'].includes(e.type));
    if (!this.abilities.author && !(exportOnly && this.session?.projectContext)) throw new Error('This workspace is read only.');
    events=events.map(e=>e.type.startsWith('Block')&&!Object.hasOwn(e.payload,'document_id')?{...e,payload:{...e.payload,document_id:this.position.documentId}}:e);
    if(events.some(ideaContentEdit)&&!this.historyComplete){await this.completeHistory();check();}
    const shared=sharedIdeaEdits(this.projection,events);
    let replacementId='';
    if(shared.length&&typeof document!=='undefined'&&!this.hasUnconfirmedWrite){
      const head=this.head,position=JSON.stringify(this.position),epoch=this.epoch;
      const current=()=>this.head===head&&this.epoch===epoch&&JSON.stringify(this.position)===position;
      const choice=await chooseSharedIdeaEdit([...new Set(shared.flatMap(x=>x.documents.map(d=>d.title)))],this.position.documentId?this.projection.documentTitle:'',current);
      check();if(!current())throw new IdeaEditCanceled();
      if(choice==='new'){const plan=independentIdeaEdits(this.projection,events,this.position.documentId);events=plan.events;replacementId=plan.ids.get(this.position.blockId)??'';}
    }
    const inputs: EventInput[] = events.map(e => ({ ...e, payload: { ...e.payload, ...(e.type.startsWith('Block')?{project_id:e.payload.project_id??this.position.projectId,document_id:e.payload.document_id??this.position.documentId}:{}), source_surface: 'still', interaction_policy: POLICY_VERSION } }));
    this.pendingWrite ??= operationJournal.write(this.journalScope);
    const signature = await digest(inputs); check();
    if (this.pendingWrite) {
      const original = this.pendingWrite;
      await this.refresh(); check();
      if (await this.recoverPendingWrite()) {
        if (original.signature === signature) return;
        throw new Error('The earlier save was confirmed. Review it before saving again.');
      }
      throw new Error('Save still unconfirmed. It was not repeated. Refresh to check.');
    }
    const projection = this.projection;
    for (const event of events) {
      const block = projection.libraryBlocks.find(b => b.id === event.payload.block_id);
      if (event.type === 'BlockPropertyEdited' && block && JSON.stringify(block.properties[String(event.payload.property_path)] ?? null) !== JSON.stringify(event.payload.old_value ?? null)) throw new Error('This thought changed while you were writing. Draft kept; reopen before saving.');
      if (event.type === 'DocumentRenamed' && projection.documents.find(d => d.id === event.payload.document_id)?.title !== event.payload.old_title) throw new Error('Name changed. Reopen before saving.');
      if (event.type === 'BlockWeightSet' && block && Number(block.properties.weight ?? 1) !== Number(event.payload.previous_weight)) throw new Error('Context changed. Review its influence before saving.');
    }
    const correlationId = crypto.randomUUID(), journalScope = this.journalScope;
    const journal: WriteJournal = { correlationId, signature, receipts: await Promise.all(inputs.map(async e => ({type:e.type, keys:Object.keys(e.payload), digest:await digest(e.payload)}))) }; check();
    const submit = () => {
      operationJournal.saveWrite(this.journalScope,journal); this.pendingWrite = journal;
      return this.request<{ appended: CreativeEvent[]; head: number; rejected?: { reason: string }[] }>('/api/events', { action: inputs.length === 1 ? 'append' : 'batch', ...(inputs.length === 1 ? { event: inputs[0] } : { events: inputs }), expectedSequence: this.head, clientId: 'web:still', correlationId });
    };
    let result;
    try { result = await submit(); } catch (error) {
      if (error instanceof ApiError && [400, 401, 403, 409, 422, 428].includes(error.status)) {
        operationJournal.clearWrite(journalScope);
        if (this.pendingWrite === journal) this.pendingWrite = null;
      }
      check();
      if (!(error instanceof ApiError) || error.status !== 409 || error.body.error !== 'stale_sequence') throw error;
      await this.refresh(); check(); throw new Error('The workspace changed. Draft kept; review before retrying.');
    }
    check();
    if (!Number.isSafeInteger(result.head) || result.rejected?.length || !Array.isArray(result.appended) || !inputs.every(input => result.appended.some(e => receiptMatches(e, input, this.session!)))) {
      await this.refresh(); throw new Error('Save was not fully confirmed. Draft kept; check the document before retrying.');
    }
    this.retirePendingWrite();
    this.applyReceipt(result);
    if(replacementId)this.position={...this.position,blockId:replacementId};
  }
  /** Creation requests share the workspace fence; the controller journals only opaque IDs. */
  async creationRequest<T>(path:string,body?:unknown,method?:string,signal?:AbortSignal):Promise<T>{const check=this.fence();const result=await api<T>(path,body,method,undefined,signal);check();return result;}
  async createProject(name: string) {
    const signature = JSON.stringify(['project', name]);
    if (!this.creation || this.creation.signature !== signature) { if(this.hasUnconfirmedWrite) { await this.refresh(); await this.recoverPendingWrite(); throw new Error(this.hasUnconfirmedWrite ? 'Check the earlier save before starting another project.' : 'Project saved. Open it in Projects.'); } this.creation = { signature, projectId: crypto.randomUUID(), documentId: '' }; }
    const { projectId } = this.creation;
    await this.append([{ type: 'ProjectCreated', payload: { project_id: projectId, name, state: 'active' } }]);
    this.creation = null; return { projectId };
  }
  async createDocument(title: string, thought: string) {
    const signature = JSON.stringify(['document', this.position.projectId, title, thought]);
    if (!this.creation || this.creation.signature !== signature) { if(this.hasUnconfirmedWrite) { await this.refresh(); await this.recoverPendingWrite(); throw new Error(this.hasUnconfirmedWrite ? 'Check the earlier save before starting another document.' : 'Document saved. Open it in Documents.'); } this.creation = { signature, projectId: this.position.projectId, documentId: crypto.randomUUID() }; }
    const { projectId, documentId } = this.creation;
    await this.append([{ type: 'DocumentCreated', payload: { project_id: projectId, document_id: documentId, title, handle: `page-${documentId.slice(0, 8)}` } }, ...(thought ? [{ ...this.blockEvent(thought, 'Creative direction', 'direction', projectId, documentId), payload: { ...this.blockEvent(thought, 'Creative direction', 'direction', projectId, documentId).payload, block_id: `first-${documentId}` } }] : [])]);
    this.creation = null; return { projectId, documentId };
  }
  blockEvent(text: string, handle: string, type = 'direction', projectId = this.position.projectId, documentId = this.position.documentId): EventInput {
    return { type: 'BlockCreated', payload: { block_id: crypto.randomUUID(), project_id: projectId, document_id: documentId, scope: documentId?'document':'library', project_owned:true, type, handle, position: String(this.head + 1), properties: { text, weight: .8, authority: 'authored' } } };
  }
  async switchWorkspace(project?: NonNullable<Session['projects']>[number]) {
    this.generationActivity.clear();
    ++this.epoch; this.events = []; this.content = {}; this.head = 0; this.jobs = []; this.onChange();
    if (project) await api(`/api/workspaces/${encodeURIComponent(project.organizationId)}/projects/${encodeURIComponent(project.projectAccessId)}/context`, {}, 'POST');
    else await api('/api/workspaces/context', undefined, 'DELETE');
    this.position = { ...this.position, projectId: project?.projectId ?? '', documentId: '', blockId: '', outputId: '', view: project ? 'documents' : 'projects' };
    await this.load();
  }
  async editArtifact(id: string, markdown: string, expectedRevision: number, items?: { index: number; body: string }[]) {
    const check = await this.verifyScope();
    if (documentArtifactRevision(this.events, id) !== expectedRevision) throw new Error('This work changed while you were writing. Draft kept; reopen before saving.');
    const result = await this.request<{appended?:CreativeEvent[]; head?: number; content?: Record<string,string>; revision?: number}>(`/api/artifacts/${encodeURIComponent(id)}`, { markdown, expectedRevision, ...(items ? {items}: {}) }, 'PATCH'); check();
    const acknowledged = result.appended?.some(e => e.type === 'DocumentArtifactEdited' && e.payload.artifact_id === id);
    const unchanged = result.appended?.length === 0 && result.revision === expectedRevision && !!result.content;
    if (!acknowledged && !unchanged) throw new Error('Edit unconfirmed. Check the original before retrying.');
    this.applyReceipt({ ...result, appended: result.appended! });
  }
  model3dAdaptation() { return adaptDocumentToModel3d(documentSnapshot(this.projection, this.position.documentId), { referenceCount: 0 }); }
  prepareGeneration(format: string, previous?: GenerationDraft): GenerationDraft {
    const pending = this.pendingGeneration;
    if (previous?.attempted || pending && pending.format !== format) throw new Error('Check the earlier generation before changing format.');
    const p = this.projection;
    if (!pending && (!this.abilities.generate || !this.abilities.formats.includes(format))) throw new Error('Choose an available format.');
    if (!p.documents.some(d => d.id === p.documentId && !d.removed)) throw new Error('Select a document.');
    const source = documentSource(p, p.documentId);
    const adaptation = format === 'model3d' ? this.model3dAdaptation() : undefined;
    return { settings:defaultGenerationSettings(), format, prompt: adaptation?.prompt ?? '', ...(adaptation ? { adaptation } : {}), documentId:p.documentId, scopeKey:this.scopeKey, itemCount:format === 'slides' ? 6 : format === 'storyboard' ? 4 : 1, tone:'', audience:'', requestId:crypto.randomUUID(), sourceHead:this.head, sourceSnapshot:source.snapshot, sourceBlockVersions:source.sourceBlockVersions, sourceRevision:source.revision, ...(pending ? { attempted:true,recoveryClosed:pending.closed===true } : {}) };
  }
  reviewNewGeneration(draft: GenerationDraft) {
    const pending=this.pendingGeneration;
    if(draft.scopeKey!==this.scopeKey||draft.documentId!==this.position.documentId||!pending?.closed)throw new Error('Check the original generation first.');
    operationJournal.clearGeneration(this.journalScope,draft.documentId);
    return { ...this.prepareGeneration(draft.format), previousUnconfirmed:true };
  }
  generationPayload(draft: GenerationDraft) {
    const settings=draft.settings??defaultGenerationSettings();
    const payload: Record<string, unknown> = { locale: 'en', productionMode: settings.productionMode, promptTechnique: 'prose', requestKey: `still:${draft.documentId}:${draft.sourceHead}:${draft.requestId}`, ...(draft.sourceSnapshot ? {snapshot:draft.sourceSnapshot,sourceBlockVersions:draft.sourceBlockVersions,expectedDocumentRevision:draft.sourceRevision} : {}), ...(draft.format === 'image' ? {} : { artifactKind: draft.format, itemCount: draft.itemCount, tone: draft.tone, audience: draft.audience }) };
    if(draft.previousAttemptId)payload.previousAttemptId=draft.previousAttemptId;
    if (draft.format === 'scene') Object.assign(payload, { sceneRequestId: draft.requestId, sceneMedium: settings.sceneMedium, ...(draft.scenePreview ? { sceneCostConsent: { ...draft.scenePreview, confirmed: true } } : {}) });
    if (draft.format === 'model3d') Object.assign(payload, { model3dPrompt: draft.prompt, model3dSettings: structuredClone(settings.model3dSettings), model3dReferenceBlockIds: [], ...(draft.adaptation && draft.prompt === draft.adaptation.prompt ? { model3dPromptSource: 'document', model3dAdaptation: model3dAdaptationReceipt(draft.adaptation) } : {}) });
    if (draft.format === 'video') Object.assign(payload, { ...(settings.productionMode==='manual'?{videoSeconds:settings.videoSeconds}:{}), videoSize: settings.videoSize, videoAudioMode: settings.videoAudioMode });
    if(draft.format==='slides')Object.assign(payload,{requestedSlideCount:draft.itemCount,presentationFidelity:settings.presentationFidelity,...(settings.presentationStyle==='document'?{}:{presentationStyle:settings.presentationStyle})});
    if(draft.format==='audio')payload.audioProfile=normalizeAudioRequestProfile({goal:settings.audioGoal,destination:settings.audioDestination,...(['timed_music','sound_effects'].includes(settings.audioGoal)?{durationSeconds:settings.audioDuration}:{}),...(settings.audioGoal==='narration'?{speakerCount:settings.audioSpeakerCount}:{}),...(['music','timed_music'].includes(settings.audioGoal)?{requireInstrumental:settings.audioInstrumental}: {})});
    return { kind: draft.format === 'image' ? 'generate' : 'render_document', documentId: draft.documentId, sourceSurface: 'still', payload };
  }
  async previewScene(draft: GenerationDraft) {
    const check = await this.verifyScope(), request = this.generationPayload(draft);
    delete request.payload.sceneCostConsent; request.payload.sceneCostPreview = true;
    const result = await this.request<{ sceneCostPreview?: unknown; job?: DocumentJob }>('/api/document-jobs', request); check();
    if (result.job) { this.jobs = [result.job, ...this.jobs.filter(j => j.jobId !== result.job!.jobId)]; return null; }
    if (!isSceneCostPreview(result.sceneCostPreview)) throw new Error('A current scene cost could not be confirmed.');
    return result.sceneCostPreview;
  }
  async generate(draft: GenerationDraft) {
    const check = await this.verifyScope();
    if (draft.scopeKey !== this.scopeKey || draft.documentId !== this.position.documentId) throw new Error('Document changed. Review generation again.');
    if (!this.abilities.generate) throw new Error('Generation is unavailable for this account.');
    const pending = operationJournal.generation(this.journalScope,draft.documentId);
    if (draft.attempted || pending) {
      draft.attempted = true;
      const key = pending?.requestKey ?? String(this.generationPayload(draft).payload.requestKey);
      const result=await this.request<{documentId:string;requestKey:string;status:string;job?:DocumentJob}>('/api/document-jobs/still-reconcile',{documentId:draft.documentId,requestKey:key});check();
      if(draft.documentId!==this.position.documentId||result.documentId!==draft.documentId||result.requestKey!==key)throw new Error('Generation check unconfirmed. Reopen the original document.');
      const job=result.job,format=pending?.format??draft.format;
      if(result.status==='found'&&job?.jobId&&job.documentId===draft.documentId&&job.requestKey===key&&job.kind===(format==='image'?'generate':'render_document')&&(format==='image'||job.result?.artifactKind===format)) {
        operationJournal.clearGeneration(this.journalScope,draft.documentId);
        this.generationActivity.observe([job],false);
        this.jobs=[job,...this.jobs.filter(j=>j.jobId!==job.jobId)];this.onChange();
        this.dispatchGeneration(job,true);
        if(['completed','partial'].includes(job.status))void this.refresh().catch(()=>{});
        return job;
      }
      if(result.status==='closed'&&!job){
        operationJournal.saveGeneration(this.journalScope,{documentId:draft.documentId,format,requestKey:key,closed:true});draft.recoveryClosed=true;
        throw new Error('Original status unknown. Starting another may duplicate it.');
      }
      throw new Error('Generation check unconfirmed. Check again.');
    }
    validateGenerationOptions(draft);
    if (draft.sourceSnapshot) {
      // Admission checks this reviewed revision against authoritative server context.
      if (await digest(documentSnapshot(this.projection,draft.documentId)) !== await digest(draft.sourceSnapshot)) throw new Error('Document changed. Reopen generation to review it.');
    }
    check();
    if (draft.format === 'model3d') {
      if (draft.adaptation && draft.prompt === draft.adaptation.prompt && !draft.adaptation.valid) throw new Error(draft.adaptation.issues.map(i => i.message).join(' '));
      const validation = validateModel3dRequest({ prompt: draft.prompt, settings: draft.settings?.model3dSettings??DEFAULT_MODEL3D_SETTINGS, referenceCount: 0 });
      if (!validation.valid) throw new Error(validation.issues.map(i => i.message).join(' '));
    }
    const readiness=await this.checkGenerationReadiness(check);check();
    if(!readiness.ready)throw new ApiError(503,{error:'generation_preparation_unavailable',message:readiness.message});
    const request = this.generationPayload(draft), journalScope = this.journalScope;
    Object.assign(request.payload, { paidMediaConfirmed: true, ...draft.acknowledgements });
    operationJournal.saveGeneration(this.journalScope,{documentId:draft.documentId,format:draft.format,requestKey:String(request.payload.requestKey)});
    draft.attempted = true;
    let result: {job:DocumentJob};
    try { result = await this.request<{ job: DocumentJob }>('/api/document-jobs', request); }
    catch(error) {
      if(error instanceof ApiError && ([400,401,403,409,422,428].includes(error.status)||error.status===503&&error.body.error==='generation_preparation_unavailable'&&error.body.submission==='not-submitted') && error.body.error !== 'generation_request_closed' && !String(error.body.error).startsWith('generation_receipt_')) {
        draft.attempted = false; operationJournal.clearGeneration(journalScope,draft.documentId);
      }
      check();
      if(error instanceof ApiError && error.body.error==='generation_request_closed') {
        operationJournal.saveGeneration(this.journalScope,{documentId:draft.documentId,format:draft.format,requestKey:String(request.payload.requestKey),closed:true});draft.recoveryClosed=true;
      }
      throw error;
    }
    check();
    if (!result.job?.jobId || result.job.documentId !== this.position.documentId) throw new Error('Generation unconfirmed. Check results before retrying.');
    operationJournal.clearGeneration(this.journalScope,draft.documentId);
    this.generationActivity.observe([result.job],false);
    this.jobs = [result.job, ...this.jobs.filter(j => j.jobId !== result.job.jobId)]; this.onChange();
    this.dispatchGeneration(result.job,true);
    return result.job;
  }
  async refreshGeneration(job: DocumentJob) {
    const check=await this.verifyScope(),documentId=this.position.documentId,jobId=this.position.outputId;
    if(!job||job.documentId!==documentId||job.jobId!==jobId)return;
    const result=await this.request<{job:DocumentJob}>(`/api/document-jobs/${encodeURIComponent(jobId)}?inspection=1`);
    check();if(this.position.documentId!==documentId||this.position.outputId!==jobId)return;
    if(result.job?.jobId!==jobId||result.job.documentId!==documentId)throw new Error('Generation unavailable.');
    ++this.jobRead;this.jobs=this.jobs.map(current=>current.jobId===jobId?result.job:current);this.onChange();
  }
  async checkGenerationReadiness(verified?:()=>void) {
    const check=verified??await this.verifyScope(),documentId=this.position.documentId;
    const result=await this.request<{ready:boolean;code:string;message:string;documentId:string}>(`/api/document-jobs/still-readiness?documentId=${encodeURIComponent(documentId)}`);
    check();if(this.position.documentId!==documentId||result.documentId!==documentId)throw new Error('Document changed. Check readiness again.');
    return result;
  }
  async recoverGeneration(job: DocumentJob) {
    const check=await this.verifyScope();
    if(!this.abilities.generate||job.documentId!==this.position.documentId)throw new Error('Refresh this attempt before recovering it.');
    const recovery=generationOutcome(job).recovery;
    if(!recovery)throw new Error('No recoverable original result is recorded.');
    const result=await this.request<{job:DocumentJob}>(`/api/document-jobs/${encodeURIComponent(job.jobId)}/${recovery==='presentation'||recovery==='image'?'recover':'retry'}`,{recoveryOnly:true,attemptCount:job.attemptCount});
    check();if(result.job?.jobId!==job.jobId||result.job.documentId!==job.documentId)throw new Error('Recovery unconfirmed. Refresh status before trying again.');
    this.jobs=this.jobs.map(current=>current.jobId===job.jobId?result.job:current);this.onChange();
    if(['queued','running','committing'].includes(result.job.status))this.dispatchGeneration(result.job,true);
    await this.refresh();return result.job;
  }
  async acknowledgeGenerationSafety(job: DocumentJob) {
    const check=await this.verifyScope();
    if(!this.abilities.generate||!documentJobCanAcknowledgeSafety(job)||job.documentId!==this.position.documentId)throw new Error('This request cannot be submitted. Refresh its status.');
    const result=await this.request<{job:DocumentJob}>(`/api/document-jobs/${encodeURIComponent(job.jobId)}/acknowledge-safety`,{acknowledged:true,attemptCount:job.attemptCount});check();
    if(result.job?.jobId!==job.jobId||result.job.documentId!==job.documentId)throw new Error('Generation delivery unconfirmed. Refresh status before trying again.');
    this.generationActivity.observe([result.job],false);
    this.jobs=this.jobs.map(current=>current.jobId===job.jobId?result.job:current);this.onChange();
    this.dispatchGeneration(result.job,true);
    return result.job;
  }
  async dismissJob(job: DocumentJob) {
    const check = await this.verifyScope();
    const result = await this.request<{job:DocumentJob}>(`/api/document-jobs/${encodeURIComponent(job.jobId)}/dismiss`, {attempt:{documentId:job.documentId,attemptCount:job.attemptCount,status:job.status,completedAt:job.completedAt}}); check();
    if (result.job?.jobId !== job.jobId || result.job.documentId !== job.documentId || generationNoticeKey(result.job) !== generationNoticeKey(job) || !result.job.dismissedAt) throw new Error('Dismissal could not be confirmed.');
    // A feed already in flight must not restore the pre-dismissal snapshot.
    ++this.jobRead;
    this.generationActivity.consume(job);
    this.jobs = this.jobs.map(current => generationNoticeKey(current) === generationNoticeKey(job) ? result.job : current); this.onChange();
  }
  private generationRuns = new Set<string>();
  private generationRunAfter = new Map<string,number>();
  private dispatchGeneration(job:DocumentJob,explicit=false) {
    if(job.status!=='queued'||job.sourceSurface!=='still'||job.executionOwner==='durable'||job.memoryMode||!['preview','generate','render_document'].includes(job.kind)||(!explicit&&job.attemptCount!==0))return;
    const key=`${this.epoch}:${this.scopeKey}:${job.jobId}`;
    if(this.generationRuns.has(key)||Date.now()<(this.generationRunAfter.get(key)??0))return;
    this.generationRuns.add(key);
    const epoch=this.epoch;
    void this.request(`/api/document-jobs/${encodeURIComponent(job.jobId)}/run`,{}).catch(()=>{
      // Poll the saved attempt before deciding anything else; never create a replacement.
    }).finally(()=>{
      this.generationRuns.delete(key);
      if(epoch===this.epoch){
        this.generationRunAfter.set(key,Date.now()+5000);
        if(this.generationRunAfter.size>120)this.generationRunAfter.delete(this.generationRunAfter.keys().next().value!);
      }
    });
  }
  /** Response-only, actor-authorized evidence. Never put private receipts in shared caches. */
  async inspectGeneration(jobId:string,documentId:string,viewedJobId=jobId) {
    const check=await this.verifyScope(),shared=!!this.session?.projectContext;
    const current=()=>{check();if(this.position.outputId!==viewedJobId||this.position.documentId!==documentId||this.position.view!=='rejection')throw new Error('Inspection changed.');};
    current();
    const detail=await this.request<{job:DocumentJob}>(`/api/document-jobs/${encodeURIComponent(jobId)}?inspection=1`);current();
    const matches=(job:DocumentJob|undefined)=>job?.jobId===jobId&&job.documentId===documentId;
    if(!matches(detail.job))throw new Error('Generation unavailable.');
    let job=detail.job;const content:Record<string,string>={};const unavailable:string[]=[];
    if(shared){
      try{
        const privateReceipt=await this.request<{job:DocumentJob;content:Record<string,string>}>(`/api/document-jobs/${encodeURIComponent(jobId)}/private-receipt`);current();
        if(!matches(privateReceipt.job))throw new Error('Receipt does not match this attempt.');
        const receipt=privateReceipt.job.result?.generationReceipt as Record<string,unknown>|undefined,ref=receipt?.input_ref;
        const raw=typeof ref==='string'?privateReceipt.content?.[ref]:undefined;
        const parsed=raw?JSON.parse(raw):null;
        if(!parsed||parsed.job_id!==jobId||parsed.document_id!==documentId)throw new Error('Receipt does not match this attempt.');
        job=privateReceipt.job;content[String(ref)]=raw!;
      }catch(error){current();if(error instanceof ApiError&&![403,404,410].includes(error.status))throw error;unavailable.push('Private inputs are unavailable to this viewer or no longer retained.');}
    }else{
      const receipt=job.result?.generationReceipt as Record<string,unknown>|undefined;
      const evidenceRefs=stageEvidenceRefs(job).filter(row=>!row.expiresAt||Date.parse(row.expiresAt)>Date.now()).map(row=>row.ref);
      const refs=[...new Set([...evidenceRefs,receipt?.input_ref,job.moderationPromptRef,...(job.members??[]).map(member=>member.moderationPromptRef)].filter((ref):ref is string=>typeof ref==='string'&&!!ref))];
      await Promise.all(refs.map(async ref=>{
        try{
          const response=await this.request<{content?:Record<string,string>}>(`/api/events?after=${this.head}&limit=1&content=1&contentId=${encodeURIComponent(ref)}`);current();
          if(typeof response.content?.[ref]==='string')content[ref]=response.content[ref];
          else unavailable.push('Some original inputs are unavailable or their retention period expired.');
        }catch(error){current();if(error instanceof ApiError&&[401,403].includes(error.status))throw error;unavailable.push('Some retained inputs could not be loaded.');}
      }));
    }
    current();
    // A deadline can pass during parallel reads. Never hand expired bytes to presentation.
    const receipt=job.result?.generationReceipt as Record<string,unknown>|undefined;
    const deadlines=[...stageEvidenceRefs(job),{ref:typeof receipt?.input_ref==='string'?receipt.input_ref:null,expiresAt:typeof receipt?.input_expires_at==='string'?receipt.input_expires_at:null}];
    for(const row of deadlines)if(row.ref&&row.expiresAt&&!(Date.parse(row.expiresAt)>Date.now()))delete content[row.ref];
    return {job,content,unavailable:[...new Set(unavailable)]};
  }
  async pollJobs() {
    const document = this.position.documentId, key = this.jobsKey;
    if (this.polling?.key === key) return this.polling.promise;
    const read = ++this.jobRead;
    const operation = (async () => {
      const check = await this.verifyScope();
      if (read !== this.jobRead || document !== this.position.documentId) return;
      if(this.position.view==='rejection'){
        // Inspection is observational: never recover or dispatch queued jobs.
        const selected=this.position.outputId;
        const detail=await this.request<{job:DocumentJob}>(`/api/document-jobs/${encodeURIComponent(selected)}?inspection=1`);check();
        if(read!==this.jobRead||key!==this.jobsKey)return;
        if(detail.job?.jobId!==selected||detail.job.documentId!==document)throw new Error('Generation unavailable.');
        this.jobs=[...this.jobs.filter(j=>j.documentId===document&&j.jobId!==selected),detail.job];
        this.jobsReadKey=key;this.jobsError='';this.onChange();return;
      }
      const known=new Set(this.jobs.map(j=>j.jobId));
      const selected=['generation','rejection'].includes(this.position.view)?this.position.outputId:'';
      const result = await this.request<{ jobs: DocumentJob[] }>(document ? `/api/document-jobs?document=${encodeURIComponent(document)}` : '/api/document-jobs?scope=active'); check();
      if (read !== this.jobRead || document !== this.position.documentId) return;
      if (!Array.isArray(result.jobs) || result.jobs.some(j => !j || typeof j.documentId !== 'string' || typeof j.jobId !== 'string')) throw new Error('The job history could not be verified.');
      // Forma also returns authorized active/unnotified jobs from other documents.
      const previous = this.jobs.filter(j => j.documentId === document), jobs = result.jobs.filter(j => j.documentId === document);
      // A generation may be admitted while this older list request is in flight.
      jobs.push(...previous.filter(j=>!known.has(j.jobId)&&!jobs.some(next=>next.jobId===j.jobId)));
      if(selected&&!jobs.some(j=>j.jobId===selected)){
        try {
          const detail=await this.request<{job:DocumentJob}>(`/api/document-jobs/${encodeURIComponent(selected)}`);check();
          if(detail.job?.jobId!==selected||detail.job.documentId!==document)throw new Error('Generation unavailable.');
          jobs.push(detail.job);
        } catch(error) { if(!(error instanceof ApiError&&error.status===404))throw error; }
      }
      if(read!==this.jobRead||document!==this.position.documentId)return;
      // The feed contains authorized active/unnotified work across documents.
      // Keep result lists scoped, but observe completions across navigation.
      const nextQueued=result.jobs.filter(j=>j.status==='queued'&&j.sourceSurface==='still'&&j.attemptCount===0&&!j.executionOwner&&!j.memoryMode&&['preview','generate','render_document'].includes(j.kind)).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId))[0];
      if(nextQueued&&!result.jobs.some(j=>['running','committing'].includes(j.status)))this.dispatchGeneration(nextQueued);
      const noticesBefore=JSON.stringify(this.generationActivity.notices);
      this.generationActivity.observe([...result.jobs,...jobs.filter(j=>!result.jobs.some(row=>row.jobId===j.jobId))]);
      const terminal = (job: DocumentJob) => ['completed', 'partial', 'failed', 'canceled'].includes(job.status);
      const changed = this.jobs.some(j => j.documentId !== document) || JSON.stringify(previous) !== JSON.stringify(jobs);
      const needsRefresh = jobs.some(j => terminal(j) && JSON.stringify(j) !== JSON.stringify(previous.find(p => p.jobId === j.jobId)))
        || jobs.some(j=>j.jobId===selected&&j.status==='completed'&&!generationResult(j,this.projection,this.events,true))
        || previous.some(j => !terminal(j) && !jobs.some(next => next.jobId === j.jobId));
      const loaded=this.jobsLoaded,hadError=!!this.jobsError;
      this.jobsReadKey=key;this.jobsError='';
      if (changed || !loaded || hadError || noticesBefore!==JSON.stringify(this.generationActivity.notices)) { this.jobs = jobs; this.onChange(); }
      if (needsRefresh) {
        // A read already in flight may predate this completion. Follow it with a
        // delta that is known to start after the job acknowledgement.
        if (this.refreshing) await this.refreshing;
        await this.refreshSource(check);
        check();
        if(!this.session?.impersonation){
          const completed=new Set(jobs.filter(job=>job.status==='completed'&&previous.some(before=>before.jobId===job.jobId&&!terminal(before))).map(job=>job.result?.artifactId));
          warmCompletedVideoCovers(this.events.filter(event=>completed.has(String(event.payload.artifact_id??''))));
        }
      }
    })().catch(error=>{
      if(read===this.jobRead&&key===this.jobsKey){this.jobsError=error instanceof Error?error.message:'Could not load generations.';this.onChange();}
      throw error;
    }).finally(() => { if (this.polling?.promise === operation) this.polling = null; });
    this.polling = { key, promise: operation }; return operation;
  }
}

function receiptMatches(event: CreativeEvent, input: EventInput, session: Session) {
  if (!event.eventId || event.type !== input.type || event.actor !== (session.projectContext ? `user:${session.user.userId}` : 'user')) return false;
  if (session.projectContext && event.payload.project_id !== session.projectContext.projectId) return false;
  return ['project_id', 'document_id', 'block_id', 'artifact_id', 'object_id', 'new_value', 'new_title'].every(key => input.payload[key] === undefined || JSON.stringify(event.payload[key]) === JSON.stringify(input.payload[key]));
}

function needsContent(events: CreativeEvent[], content: Record<string, string>) {
  return events.some(event => event.type === 'DocumentArtifactEdited'
    || event.type === 'AssistantReasoned' && event.payload.operation === 'creative-chat' && event.payload.deterministic === false && !!event.payload.task_id
    || Object.entries(event.payload).some(([key, value]) => /(?:^|_)(?:content|prompt|intent|input|response|message|statement|condition|note|output|direction)_ref$/.test(key) && typeof value === 'string' && !(value in content)));
}
