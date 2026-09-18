import { ACTIONS } from './decisions.ts';
/** Immediate, factual help remains available if optional wording enrichment is slow. */
export const ACTION_HELP:Record<string,string>={
 'new-project':'Start a project to collect related ideas and documents.',
 'new-document':'Create a document in this project. Add ideas and make outputs from them.',
 'add-context':'Add one idea, detail, constraint, or reference to this document.',
 'edit-block':'Change this idea without rewriting the rest of the document.',
 'split-context':'Break this idea into smaller pieces you can edit and reuse separately.',
 'research-context':'Research this idea and review information to add as context.',
 'find-references':'Find reference images for this idea and review them before adding.',
 'use-in':'Choose another document where this idea could be useful.',
 compose:'Combine smaller ideas while keeping their parts available to edit.',
 create:'Choose an output to make from the current document and its active context.',
 image:'Generate an image from this document’s active context. Required reviews still apply.',
 video:'Generate a video from this document’s active context. Required reviews still apply.',
 audio:'Generate audio from this document’s active context. Required reviews still apply.',
 model3d:'Generate a 3D model from this document’s active context. Required reviews still apply.',
 short_story:'Generate a short story from this document’s active context.',
 scene:'Generate a scene from this document’s active context.',
 slides:'Generate a presentation from this document’s active context.',
 storyboard:'Generate storyboard frames from this document’s active context.',
 projects:'Browse your projects.',documents:'Browse the documents in this project.',document:'Return to the document and its context.',results:'Browse this document’s generated work.',
 'ui:more':'See the next suggested actions for this page.',
 'ui:palette':'Search all available actions. Open this anytime with Command or Control + K.',
 'ui:previous-page':'Show the previous set of items.', 'ui:next-page':'Show the next set of items.',
};
export function actionHelp(id:string,label:string){return ACTION_HELP[id]??({'Back':'Return to the previous step.','More':'See the next suggested actions.','Other outputs':'Choose another available output format.','More results':'Show the next set of items.','Previous results':'Show the previous set of items.','New project':ACTION_HELP['new-project'],'Document':ACTION_HELP.document,'Results':ACTION_HELP.results,'Palette':ACTION_HELP['ui:palette'],'Download':'Download this result to your device.'} as Record<string,string>)[label]??ACTIONS.find(a=>a.id===id)?.description??`Use “${label}” for the next step.`;}
export function readOnboardingFlag(url:string,storage:Pick<Storage,'getItem'>){const q=new URL(url).searchParams;return q.has('onboarding')||q.has('onbaording')||storage.getItem('still:flag:onboarding')==='true';}
