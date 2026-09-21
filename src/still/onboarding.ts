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
 'ui:show-all':'Browse every item in this list.',
 'ui:show-less':'Return to a short page of items.',
 'ui:more':'See the next suggested actions for this page.',
 'ui:palette':'Search all available actions. Open this anytime with Command or Control + K.',
 'ui:previous-page':'Show the previous set of items.', 'ui:next-page':'Show the next set of items.',
};
export function actionHelp(id:string,label:string){return ACTION_HELP[id]??({'Back':'Return to the previous step.','More':'See the next suggested actions.','Other outputs':'Choose another available output format.','More results':'Show the next set of items.','Previous results':'Show the previous set of items.','New project':ACTION_HELP['new-project'],'Document':ACTION_HELP.document,'Results':ACTION_HELP.results,'Palette':ACTION_HELP['ui:palette'],'Download':'Download this result to your device.'} as Record<string,string>)[label]??ACTIONS.find(a=>a.id===id)?.description??`Use “${label}” for the next step.`;}
export function readOnboardingFlag(url:string,storage:Pick<Storage,'getItem'>){const q=new URL(url).searchParams;return q.has('onboarding')||q.has('onbaording')||storage.getItem('still:flag:onboarding')==='true';}

export const ONBOARDING_MODEL='gpt-5.6-luna' as const;
export const ONBOARDING_VERSION=2;
export type OnboardingContext={
 surface?:'main'|'more'|'formats'|'workflow';
 basis?:Record<string,'next-best'|'model-ranked'|'page-default'|'local'|'alternative'>;
 available?:Partial<Record<'projects'|'documents'|'ideas'|'activeIdeas'|'results',number>>;
 selectedIdea?:{kind?:string;active?:boolean;locked?:boolean};
 recentActions?:string[];
 historyComplete?:boolean;
};
export type OnboardingInput={actions:string[];view:string;locale:string;context?:OnboardingContext};
/** Bounded observations only. Never forward arbitrary text, event bodies, IDs or telemetry. */
export function onboardingContext(raw:unknown,actions:string[]):OnboardingContext|undefined{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
 const r=raw as Record<string,unknown>,out:OnboardingContext={};
 if(['main','more','formats','workflow'].includes(String(r.surface)))out.surface=r.surface as OnboardingContext['surface'];
 if(typeof r.historyComplete==='boolean')out.historyComplete=r.historyComplete;
 if(r.basis&&typeof r.basis==='object'){
  const basis=r.basis as Record<string,unknown>;
  out.basis=Object.fromEntries([...actions].sort().filter(id=>['next-best','model-ranked','page-default','local','alternative'].includes(String(basis[id]))).map(id=>[id,basis[id]])) as OnboardingContext['basis'];
 }
 if(r.available&&typeof r.available==='object'){
  const available=r.available as Record<string,unknown>;
  out.available=Object.fromEntries(['projects','documents','ideas','activeIdeas','results'].filter(k=>typeof available[k]==='number'&&Number.isSafeInteger(available[k])&&(available[k] as number)>=0).map(k=>[k,Math.min(1000,available[k] as number)]));
 }
 if(r.selectedIdea&&typeof r.selectedIdea==='object'){
  const idea=r.selectedIdea as Record<string,unknown>;
  out.selectedIdea={};
  if(['direction','subject','environment','style','exclusion','message','material','audience','emotion','composition','reference'].includes(String(idea.kind)))out.selectedIdea.kind=String(idea.kind);
  if(typeof idea.active==='boolean')out.selectedIdea.active=idea.active;
  if(typeof idea.locked==='boolean')out.selectedIdea.locked=idea.locked;
 }
 if(Array.isArray(r.recentActions))out.recentActions=r.recentActions.slice(-12).filter((id):id is string=>typeof id==='string'&&(ACTIONS.some(a=>a.id===id||`completed:${a.id}`===id)||['ui:more','ui:palette'].includes(id))).slice(-4);
 return out;
}
export type OnboardingResult={source:'local'|'model';reason?:string;tips:Record<string,string>;model?:string;elapsedMs?:number;requestElapsedMs?:number;cache?:import('./decision-cache.ts').DecisionCacheInfo};
export const ONBOARDING_VIEWS=['projects','documents','document','block','results','result','generation','choose-format','edit','create','other'];
export function onboardingInput(raw:unknown):OnboardingInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const r=raw as Record<string,unknown>;
 if(r.enabled!==true||!Array.isArray(r.actions)||!r.actions.length||r.actions.length>7||r.actions.some(id=>typeof id!=='string'||!ACTIONS.some(a=>a.id===id))||new Set(r.actions).size!==r.actions.length||!ONBOARDING_VIEWS.includes(String(r.view))||typeof r.locale!=='string'||!/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(r.locale))return null;
 const actions=[...r.actions].sort() as string[],context=onboardingContext(r.context,actions);
 return {actions,view:String(r.view),locale:r.locale,...(context?{context}:{})};
}
