import { api, ApiError, StillClient } from './client.ts';
import { contextConsentAction, contextConsentFailure } from '../model/context-consent-state.ts';
import type { ContextResearchReport, ContextResearchSuggestion, DecompositionPlan, DecompositionProposal } from '../model/context-intelligence.ts';
import type { ContextProposalSelection } from '../model/context-proposal-application.ts';
import type { ConsequentialPreview } from '../../worker/consequential-consent.ts';
import type { AuthoringPreview } from '../../worker/authoring-commits.ts';

export type ContextQuote = ConsequentialPreview & { providerAvailable: boolean; canExecute?: boolean };
export type IdeaCandidate = { selection: ContextProposalSelection; proposal?: DecompositionProposal; research?: ContextResearchSuggestion; included: boolean; text: string };
/** Independent orchestration of Forma's retained execution and authoring protocols. */
export class ContextWorkflow {
  readonly target: { projectId: string; documentId: string; blockId: string; canvasId: null };
  readonly scopeKey: string;
  quote: ContextQuote | null = null;
  preview: AuthoringPreview | null = null;
  candidates: IdeaCandidate[] = [];
  publicQuery = '';
  status = 'start';
  stale = false;
  constructor(readonly client: StillClient, readonly kind: 'decompose' | 'research', readonly purpose: 'research'|'references' = 'research') {
    const { projectId, documentId, blockId } = client.position;
    this.target = { projectId, documentId, blockId, canvasId: null }; this.scopeKey = client.scopeKey;
  }
  private async guard() {
    const check = await this.client.verifyScope();
    const valid = () => { check(); if (this.scopeKey !== this.client.scopeKey || Object.entries(this.target).some(([k,v]) => k !== 'canvasId' && this.client.position[k as 'projectId'|'documentId'|'blockId'] !== v)) throw new Error('This review belongs to another context. Reopen it in its original document.'); };
    valid(); return valid;
  }
  private validate(value: { projectId: string; documentId: string; blockId: string; canvasId: string|null }) {
    if (Object.entries(this.target).some(([k,v]) => value[k as keyof typeof value] !== v)) throw new Error('The returned review does not match this context.');
  }
  async resume() {
    const check = await this.guard();
    const result = await api<{ status: string; preview?: AuthoringPreview; stale?: boolean }>('/api/context/apply', { ...this.target, action: 'resume' }); check();
    if (result.preview) { this.validate(result.preview); this.preview = result.preview; this.status = result.status; this.stale = !!result.stale; }
    if (result.status === 'applied') { await this.client.refresh(); this.status = 'applied'; }
  }
  /** A chosen Still action prepares its retained request and runs it without a cost-review screen. */
  async startAnalysis(publicQuery = this.publicQuery) {
    if (!this.quote || this.quote.status === 'quoted' && this.quote.publicQuery !== publicQuery.trim()) {
      this.publicQuery = publicQuery.trim();
      await this.prepareQuote();
    }
    // An uncertain or completed attempt is retrieved, never replaced by a new execution.
    await this.analyze();
  }
  async prepareQuote() {
    const check = await this.guard();
    if (this.quote && this.quote.status !== 'quoted') throw new Error('Check the original analysis before starting another.');
    const result = await api<{ quote: ContextQuote }>(`/api/context/${this.kind}`, { ...this.target, analysisProfile:'still-ideas-v1', purpose:this.purpose, action: 'quote', publicQuery: this.publicQuery.trim() }); check();
    this.validate(result.quote); this.quote = result.quote; this.publicQuery = result.quote.publicQuery ?? ''; this.status = 'quote';
  }
  async analyze() {
    const check = await this.guard(), quote = this.quote;
    if (!quote) throw new Error('Prepare the analysis first.');
    const next = contextConsentAction(quote.status, quote.providerAvailable, quote.canExecute ?? quote.providerAvailable);
    if (next.disabled) throw new Error('Analysis is unavailable for this account.');
    // Mark uncertainty before dispatch, so interrupted replies can only be retrieved.
    if (next.action === 'execute') this.quote = { ...quote, status: 'uncertain' };
    try {
      const result = await api<{ plan?: DecompositionPlan; report?: ContextResearchReport; executionId: string; bindingHash: string; status?: string; quote?: ContextQuote }>(`/api/context/${this.kind}`, { ...this.target, analysisProfile:'still-ideas-v1', purpose:this.purpose, publicQuery: this.publicQuery, action: next.action, executionId: quote.executionId, approvedBindingHash: quote.bindingHash }); check();
      if (!result.plan && !result.report) { this.quote = { ...quote, status: result.status ?? 'uncertain' }; throw new Error('The original analysis is still pending. Check it again shortly.'); }
      let retained = quote;
      if (result.quote) {
        this.validate(result.quote);
        if(result.quote.sourceHash !== quote.sourceHash || result.quote.operation !== quote.operation) throw new Error('The retained analysis source does not match this review.');
        retained = result.quote;
      }
      if (result.executionId !== retained.executionId || result.bindingHash !== retained.bindingHash || result.plan && result.plan.sourceBlockId !== this.target.blockId || result.report && result.report.blockId !== this.target.blockId) throw new Error('The analysis identity could not be verified.');
      if (!this.candidates.length) this.candidates = [...(result.plan ? [...result.plan.proposals,...result.plan.addenda].map(proposal => ({ proposal, text: proposal.text, id: proposal.id })) : []), ...(result.report ? [...result.report.inferred,...result.report.related,...result.report.learned].map(research => ({ research, text: research.text, id: research.id })) : [])].map(item => ({ ...item, selection: { executionId: result.executionId, bindingHash: result.bindingHash, proposalId: item.id }, included: false }));
      this.quote = { ...retained, status: 'completed' }; this.status = 'candidates';
    } catch (error) {
      const body = error instanceof ApiError ? error.body : {};
      this.quote = contextConsentFailure(this.quote, { transport: !(error instanceof ApiError), status: typeof body.status === 'string' ? body.status : undefined, error: String(body.error ?? ''), submission: String(body.submission ?? ''), providerAvailable: body.providerAvailable as boolean|undefined }).quote;
      throw error;
    }
  }
  async prepareChanges() {
    const check = await this.guard();
    const selections = this.candidates.filter(c => c.included && !(c.research?.type === 'reference' && !c.research.blockId)).map(c => ({ ...c.selection, ...(c.proposal && c.text !== c.proposal.text ? { edit: { text: c.text } } : {}) }));
    if (!selections.length) throw new Error('Choose at least one idea to keep.');
    const result = await api<{ preview: AuthoringPreview }>('/api/context/apply', { ...this.target, action: 'preview', selections }); check();
    this.validate(result.preview); this.preview = result.preview; this.status = 'review'; this.stale = false;
  }
  async apply() {
    const check = await this.guard(), preview = this.preview;
    if (!preview || this.stale) throw new Error('This review changed. Return to the document and prepare a fresh review.');
    const action = this.status === 'applying' ? 'retrieve' : 'apply'; this.status = 'applying';
    try {
      const result = await api<{ status: string }>('/api/context/apply', { ...this.target, action, previewId: preview.previewId, approvalHash: preview.approvalHash }); check();
      this.status = result.status;
      if (result.status === 'applied') await this.client.refresh();
    } catch (error) { if (error instanceof ApiError && error.body.status === 'not-applied') { this.status = 'review'; this.stale = true; } throw error; }
  }
  async dismiss() {
    const check = await this.guard();
    if (!this.preview || this.status === 'applying') throw new Error('Check the original save before changing this review.');
    await api('/api/context/apply', { ...this.target, action: 'dismiss', previewId: this.preview.previewId, approvalHash: this.preview.approvalHash }); check();
    this.preview = null; this.status = this.candidates.length ? 'candidates' : 'start';
  }
}
