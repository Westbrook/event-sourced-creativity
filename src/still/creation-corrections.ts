import { html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { live } from 'lit/directives/live.js';
import { BLOCK_TYPES } from '../model/block-types.ts';
import type { CreationDraft, CreationPlan, ProposedNode, ReviewState } from '../model/creation.ts';
import { ideaBodyText, plainTextIdeaBody } from '../model/idea-body.ts';
import {
  acceptCreationCorrection, previewLocalVariation, previewMergeIdeas, previewPartialReuse,
  previewRemoveDocument, previewRemoveIdea, undoLastCreationCorrection,
  type CorrectionPreview, type CorrectionSource, type RemovalRepair,
} from '../model/creation-corrections.ts';

type Patch = RemovalRepair['patch'];
type Mode = 'remove'|'variation'|'merge'|'partial';
export type CreationCorrectionsOptions = {
  draft: CreationDraft; plan: CreationPlan; review: ReviewState;
  onChange: (plan: CreationPlan, review: ReviewState) => void;
  onError: (message: string) => void;
  /** Persist a controller across renders, and redraw on local form changes. */
  controller?: CreationCorrectionsController; requestUpdate?: () => void;
  /** Authorized, exact-revision saved sources and their full disclosed closure. */
  sources?: readonly CorrectionSource[];
};
const copyPatch = (node: ProposedNode): Patch => ({
  title: node.title, text: node.text, body: structuredClone(node.body ?? plainTextIdeaBody(node.text ?? '')),
  type: node.type, subtype: node.subtype, intent: node.intent, preferredOutputKinds: node.preferredOutputKinds,
});

/** State remains local to the recoverable draft; only accepted graph corrections autosave. */
export class CreationCorrectionsController {
  selectedId = ''; targetId = ''; documentId = ''; mode: Mode = 'remove'; aliases = ''; excerpt = '';
  semanticReviewed = false; meaningReviewed = false; differentUsesAcknowledged = false;
  patch?: Patch; repairs = new Map<string, Patch>(); preview?: CorrectionPreview;
  differentIdentityRepairs = new Set<string>();
  undoPreview?: CorrectionPreview;
  select(node: ProposedNode) {
    this.selectedId = node.id; this.patch = copyPatch(node); this.preview = undefined;
    this.repairs.clear(); this.differentIdentityRepairs.clear(); this.semanticReviewed = false; this.meaningReviewed = false; this.aliases = '';
    this.excerpt = ''; this.targetId = ''; this.documentId = ''; this.mode = 'remove';
  }
  chooseMode(mode: Mode, node: ProposedNode) {
    this.mode = mode; this.preview = undefined; this.patch = copyPatch(node); this.meaningReviewed = false;
    if (mode === 'partial') this.patch = { ...this.patch, text: '', body: plainTextIdeaBody('') };
  }
  prepare(options: CreationCorrectionsOptions) {
    const id = `correction:${crypto.randomUUID()}`, { plan, sources } = options;
    const selected = plan.nodes.find(n => n.id === this.selectedId) ?? sources?.find(s => s.node.id === this.selectedId)?.node;
    if (!selected) throw new Error('Choose an available Idea or proposed Document.');
    if (selected.kind === 'document') this.preview = previewRemoveDocument(plan, selected.id, id);
    else if (this.mode === 'remove') this.preview = previewRemoveIdea(plan, {
      ideaId: selected.id, decisionId: id, aliases: this.aliases.split(',').map(v => v.trim()).filter(Boolean),
      semanticReviewComplete: this.semanticReviewed, sources,
      repairs: [...this.repairs].map(([nodeId, patch]) => ({ nodeId, patch,
        retainedAliasIsDifferentIdentity: this.differentIdentityRepairs.has(nodeId),
        ...(!plan.nodes.some(n => n.id === nodeId) ? { independentId: `${id}:repair:${nodeId}` } : {}),
      })),
    });
    else {
      if (!this.patch?.text?.trim() || !this.patch.type || !this.patch.title.trim())
        throw new Error('Complete the title, body and supported Idea type before previewing.');
      if (!this.meaningReviewed) throw new Error('Review the complete retained meaning before previewing this correction.');
      if (this.mode === 'variation') this.preview = previewLocalVariation(plan, {
        ideaId: selected.id, documentId: this.documentId, decisionId: id, newId: `${id}:idea`, patch: this.patch, sources,
      });
      if (this.mode === 'merge') this.preview = previewMergeIdeas(plan, {
        sourceId: selected.id, targetId: this.targetId, decisionId: id, independentId: `${id}:idea`, patch: this.patch,
        sources, differentUsesAcknowledged: this.differentUsesAcknowledged,
      });
      if (this.mode === 'partial') {
        const source = sources?.find(s => s.node.id === selected.id);
        if (!source) throw new Error('Refresh and explicitly select a saved source before partial reuse.');
        this.preview = previewPartialReuse(plan, { source, decisionId: id, newId: `${id}:idea`,
          patch: this.patch, excerpt: this.excerpt, ...(this.documentId ? { documentId: this.documentId } : {}),
        });
      }
    }
  }
  accept(options: CreationCorrectionsOptions) {
    if (!this.preview) throw new Error('Preview this correction first.');
    const result = acceptCreationCorrection(options.plan, options.review, this.preview);
    this.undoPreview = this.preview; this.preview = undefined; this.selectedId = '';
    options.onChange(result.plan, result.review);
  }
  undo(options: CreationCorrectionsOptions) {
    const result = undoLastCreationCorrection(options.plan, options.review, `undo:${crypto.randomUUID()}`);
    this.undoPreview = undefined; this.preview = undefined; options.onChange(result.plan, result.review);
  }
}

const controllers = new WeakMap<CreationDraft, CreationCorrectionsController>();
export function renderCreationCorrections(options: CreationCorrectionsOptions) {
  let state = options.controller ?? controllers.get(options.draft);
  if (!state) { state = new CreationCorrectionsController(); controllers.set(options.draft, state); }
  const c = state, { plan, sources = [] } = options;
  const nodes = [...plan.nodes.filter(n => n.disposition === 'retained' && n.kind !== 'project'),
    ...sources.map(s => s.node).filter(n => !plan.nodes.some(p => p.id === n.id))];
  const selected = nodes.find(n => n.id === c.selectedId);
  const documents = [...new Set([...plan.nodes.filter(n => n.kind === 'document' && n.disposition === 'retained').map(n => n.id),
    ...plan.uses.filter(u => u.disposition === 'retained').map(u => u.documentId)])];
  const label = (id: string) => nodes.find(n => n.id === id)?.title ?? (id === plan.scope.documentId ? 'Current Document' : id);
  const update = (work: () => void) => {
    try { work(); options.onError(''); } catch (error) { options.onError(error instanceof Error ? error.message : String(error)); }
    options.requestUpdate?.();
  };
  const edit = (work: () => void) => update(() => { work(); c.preview = undefined; });
  const checkbox = (label: string, value: boolean, change: (value: boolean) => void) => html`
    <label><input type="checkbox" .checked=${live(value)} @change=${(e: Event) => edit(() => change((e.target as HTMLInputElement).checked))}> ${label}</label>`;
  const patchEditor = (patch: Patch, key: string) => keyed(key, html`
    <label>Title <input .value=${live(patch.title)} @input=${(e: Event) => edit(() => { patch.title = (e.target as HTMLInputElement).value; })}></label>
    <label>Idea type <select .value=${live(patch.type ?? '')} @change=${(e: Event) => edit(() => { patch.type = (e.target as HTMLSelectElement).value as Patch['type']; patch.subtype = undefined; })}>
      <option value="">Choose type</option>${BLOCK_TYPES.map(type => html`<option value=${type.type}>${type.label}</option>`)}</select></label>
    <en-rich-text-editor aria-label="Complete replacement body" .document=${patch.body?.document}
      @en-change=${(event: CustomEvent<{ proposed: NonNullable<Patch['body']>['document'] }>) => edit(() => {
        patch.body = { schemaVersion: 1, document: structuredClone(event.detail.proposed) }; patch.text = ideaBodyText(patch.body);
      })}></en-rich-text-editor>
    <p>Existing inline references keep their identities. Remove or revise a reference explicitly when its meaning changes.</p>`);
  return html`<section class="creation-corrections" aria-label="Correct proposed organization">
    <details><summary>Correct the proposed organization</summary>
      <label>Idea or Document <select .value=${live(c.selectedId)} @change=${(e: Event) => edit(() => {
        const node = nodes.find(n => n.id === (e.target as HTMLSelectElement).value); if (node) c.select(node); else c.selectedId = '';
      })}><option value="">Choose an item</option>${nodes.map(n => html`<option value=${n.id}>${n.kind === 'idea' ? 'Idea' : 'Document'}: ${n.title}</option>`)}</select></label>
      ${selected ? html`
        <p>${selected.kind === 'document' ? 'Removing this Document preserves all finished and unfinished Idea proposals in the Project.' : 'Every change is previewed. Changed content and affected uses need fresh review.'}</p>
        ${selected.kind === 'idea' ? html`
          <label>Correction <select .value=${live(c.mode)} @change=${(e: Event) => edit(() => c.chooseMode((e.target as HTMLSelectElement).value as Mode, selected))}>
            <option value="remove">Remove this content from the draft</option><option value="variation">Make a local variation</option>
            ${plan.nodes.some(n => n.id === selected.id) ? html`<option value="merge">Merge into another Idea</option>` : html`<option value="partial">Use only this part</option>`}
          </select></label>
          ${c.mode === 'remove' ? html`
            <p>Review all retained wording, including aliases and pronouns. Supply explicit replacement wording for every affected Idea; a saved Idea is repaired as a new independent variation.</p>
            <label>Other names and aliases (comma-separated) <input .value=${live(c.aliases)} @input=${(e: Event) => edit(() => { c.aliases = (e.target as HTMLInputElement).value; })}></label>
            ${nodes.filter(n => n.kind === 'idea' && n.id !== selected.id).map(n => html`<details><summary>${n.title}</summary><p style="white-space:pre-wrap">${n.text}</p>
              ${checkbox('Replace this body to preserve its remaining meaning', c.repairs.has(n.id), checked => { if (checked) c.repairs.set(n.id, copyPatch(n)); else c.repairs.delete(n.id); })}
              ${c.repairs.has(n.id) ? html`${patchEditor(c.repairs.get(n.id)!, `repair:${n.id}`)}
                ${checkbox('Any retained matching name refers to a different identity, which I have checked.', c.differentIdentityRepairs.has(n.id), checked => {
                  if (checked) c.differentIdentityRepairs.add(n.id); else c.differentIdentityRepairs.delete(n.id);
                })}` : nothing}</details>`)}
            ${checkbox('I reviewed aliases, pronouns, relationships and remaining meaning in every retained Idea.', c.semanticReviewed, v => { c.semanticReviewed = v; })}
          ` : html`
            <p style="white-space:pre-wrap">Source: ${selected.text}</p>
            ${c.mode === 'merge' ? html`<label>Merge destination <select .value=${live(c.targetId)} @change=${(e: Event) => edit(() => { c.targetId = (e.target as HTMLSelectElement).value; })}>
              <option value="">Choose destination</option>${nodes.filter(n => n.kind === 'idea' && n.id !== selected.id).map(n => html`<option value=${n.id}>${n.title}</option>`)}</select></label>
              ${c.targetId ? html`<p style="white-space:pre-wrap">Destination: ${nodes.find(n => n.id === c.targetId)?.text}</p>` : nothing}
              ${checkbox('I reviewed both Ideas’ uses; an independent merge preserves destination-only uses.', c.differentUsesAcknowledged, v => { c.differentUsesAcknowledged = v; })}
            ` : html`<label>Destination <select .value=${live(c.documentId)} @change=${(e: Event) => edit(() => { c.documentId = (e.target as HTMLSelectElement).value; })}>
              <option value="">${c.mode === 'partial' ? 'Project Ideas only' : 'Choose Document'}</option>${documents.map(id => html`<option value=${id}>${label(id)}</option>`)}</select></label>`}
            ${c.mode === 'partial' ? html`<label>Exact source excerpt <textarea .value=${live(c.excerpt)} @input=${(e: Event) => edit(() => { c.excerpt = (e.target as HTMLTextAreaElement).value; })}></textarea></label>
              <p>Retain necessary qualifications. The saved source remains unchanged and provenance does not include its full content.</p>` : nothing}
            ${c.patch ? patchEditor(c.patch, `${selected.id}:${c.mode}`) : nothing}
            ${checkbox('I reviewed the complete retained meaning and supplied all required wording without adding unsupported content.', c.meaningReviewed, v => { c.meaningReviewed = v; })}
          `}
        ` : nothing}
        <button type="button" @click=${() => update(() => c.prepare(options))}>Preview correction</button>
      ` : nothing}
      ${c.preview ? html`<section aria-label="Correction preview" aria-live="polite"><h3>Review every effect</h3>
        ${c.preview.effects.map(effect => html`<article><h4>${effect.nodeId ? label(effect.nodeId) : effect.documentId ? label(effect.documentId) : 'Change'}</h4>
          <p>${effect.message}</p><p style="white-space:pre-wrap">Before: ${effect.before}</p><p style="white-space:pre-wrap">After: ${effect.after}</p>
          ${!effect.resolved ? html`<p role="status">Needs explicit repair</p>` : nothing}</article>`)}
        ${c.preview.blockers.length ? html`<ul>${c.preview.blockers.map(message => html`<li>${message}</li>`)}</ul>` : nothing}
        <button type="button" ?disabled=${c.preview.blockers.length > 0 || c.preview.effects.some(effect => !effect.resolved)} @click=${() => update(() => c.accept(options))}>Accept correction</button>
      </section>` : nothing}
      ${plan.decisions.at(-1)?.accepted && plan.decisions.at(-1)?.detail ? html`<button type="button" @click=${() => update(() => c.undo(options))}>Undo last correction</button>` : nothing}
    </details>
  </section>`;
}
