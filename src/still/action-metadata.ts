import type { Action } from './decisions.ts';

export const ACTION_METADATA_VERSION = 'still-action-metadata-v1';
export type ActionMetadata = {
  family: 'navigation' | 'authoring' | 'structure' | 'research' | 'reference' | 'reuse' | 'review' | 'generation' | 'goal';
  launch: 'navigation' | 'configuration' | 'mutation';
  cost: 'free' | 'paid-after-submit' | 'quote-before-paid';
  risk: 'read-only' | 'shared-content' | 'charge' | 'download' | 'preference';
  reversal: 'navigate-back' | 'draft-only' | 'counter-change' | 'not-guaranteed';
  needs: string[];
  confirm: 'action-click' | 'save' | 'review-save' | 'submit' | 'quote-submit' | 'analyze-then-save';
  outcome: ('arrival' | 'status-read' | 'event-receipt' | 'job-status' | 'file-delivery' | 'preference-saved' | 'user-feedback')[];
};

/** Supply this once, alongside candidate metadata, rather than once per action. */
export const ACTION_METADATA_GUIDANCE = 'launch is the initial selection effect; cost and risk describe this step and its named submission. Choosing output only opens a free picker. paid-after-submit may be this action-click or a later explicit submit, as confirm states. Draft cancellation does not undo a committed change or refund provider use; counter-change means another explicit change, not exact undo. needs supplements server eligibility and is rechecked at execution. outcome names relevant evidence, not a claim that it was observed or that the user achieved quality. A receipt, job completion or download is not user acceptance.';

const navigation = (needs: string[] = []): ActionMetadata => ({ family: 'navigation', launch: 'navigation', cost: 'free', risk: 'read-only', reversal: 'navigate-back', needs, confirm: 'action-click', outcome: ['arrival', 'user-feedback'] });
const form = (family: ActionMetadata['family'], needs: string[], confirm: ActionMetadata['confirm'] = 'save'): ActionMetadata => ({ family, launch: 'configuration', cost: 'free', risk: 'shared-content', reversal: 'draft-only', needs, confirm, outcome: ['event-receipt', 'user-feedback'] });
const generation = (scene = false): ActionMetadata => ({ family: 'generation', launch: 'configuration', cost: scene ? 'quote-before-paid' : 'paid-after-submit', risk: 'charge', reversal: 'draft-only', needs: ['active-context'], confirm: scene ? 'quote-submit' : 'submit', outcome: ['job-status', 'user-feedback'] });
const analysis = (family: 'structure' | 'research' | 'reference', search = false): ActionMetadata => ({ family, launch: 'configuration', cost: 'paid-after-submit', risk: 'charge', reversal: 'draft-only', needs: search ? ['idea', 'public-topic'] : ['idea'], confirm: 'analyze-then-save', outcome: ['event-receipt', 'user-feedback'] });
const toggle = (): ActionMetadata => ({ family: 'structure', launch: 'mutation', cost: 'free', risk: 'shared-content', reversal: 'counter-change', needs: ['idea'], confirm: 'action-click', outcome: ['event-receipt', 'user-feedback'] });

// The launch/confirmation distinctions follow StillApp.choose and its workflows.
// In particular format choices do not submit generation, whereas generate-again
// calls startGeneration directly and can spend before a separate review appears.
const metadata: Record<string, ActionMetadata> = {
  projects: navigation(),
  ideas: navigation(['project']),
  documents: navigation(['project']),
  context: navigation(['document']),
  results: { ...navigation(['results']), family: 'review' },
  'inspect-rejection': { ...navigation(['failed-attempt']), family: 'review' },
  'view-output': navigation(['attempt']),
  'refresh-generation': { ...navigation(['attempt']), family: 'review', outcome: ['status-read', 'user-feedback'] },
  'new-project': form('authoring', ['name']),
  'new-document': form('authoring', ['project', 'name']),
  'add-context': form('authoring', ['idea-text']),
  'edit-block': form('authoring', ['editable-idea']),
  rename: form('authoring', ['document', 'name']),
  clarify: form('authoring', ['direction']),
  'edit-artifact': form('authoring', ['editable-result']),
  'split-context': analysis('structure'),
  'research-context': analysis('research', true),
  'find-references': analysis('reference', true),
  'supply-reference': form('reference', ['file', 'rights'], 'review-save'),
  compose: form('structure', ['ideas'], 'review-save'),
  'use-in': form('reuse', ['idea', 'destination'], 'review-save'),
  reuse: form('reuse', ['idea', 'document']),
  lock: toggle(),
  unlock: toggle(),
  'toggle-context': toggle(),
  create: { ...navigation(['active-context']), family: 'generation', launch: 'configuration' },
  image: generation(),
  short_story: generation(),
  scene: generation(true),
  slides: generation(),
  storyboard: generation(),
  video: generation(),
  audio: generation(),
  model3d: generation(),
  'generate-again': { ...generation(), launch: 'mutation', reversal: 'not-guaranteed', needs: ['attempt', 'context'], confirm: 'action-click' },
  export: { family: 'review', launch: 'mutation', cost: 'free', risk: 'download', reversal: 'not-guaranteed', needs: ['result'], confirm: 'action-click', outcome: ['file-delivery', 'user-feedback'] },
  intent: { family: 'goal', launch: 'configuration', cost: 'free', risk: 'preference', reversal: 'counter-change', needs: [], confirm: 'save', outcome: ['preference-saved', 'user-feedback'] },
};

/** Compact semantic metadata only; keep localized labels and descriptions on Action. */
export function describeAction(action: Pick<Action, 'id'>): ActionMetadata {
  const description = metadata[action.id];
  if (!description) throw new Error(`Missing Still action metadata: ${action.id}`);
  return { ...description, needs: [...description.needs], outcome: [...description.outcome] };
}
