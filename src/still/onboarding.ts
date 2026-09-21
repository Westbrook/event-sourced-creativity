import { ACTIONS } from './decisions.ts';
/** Immediate, factual help remains available if optional wording enrichment is slow. */
export const ACTION_HELP:Record<string,string>={
 'new-project':'Start a project to collect related ideas and documents.',
 'new-document':'Create a document in this project. Add ideas and make outputs from them.',
 'add-context':'Add one idea, detail, constraint, or reference to this document.',
 'reuse':'Copy an existing idea from another document into this document.',
 'surprise':'Write a new variation as an idea; this does not generate a result.',
 'clarify':'Add a direction idea describing what matters for this document.',
 'intent':'Tell Still your next goal to guide its action suggestions.',
 'edit-block':'Change this idea without rewriting the rest of the document.',
 'split-context':'Break this idea into smaller pieces you can edit and reuse separately.',
 'research-context':'Find sourced details that make this idea more precise, then review what to add.',
 'find-references':'Find files that clarify this idea, then review their sources before adding.',
 'supply-reference':'Attach a file you already have to make this idea more precise.',
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
/** Workflow commands have known outcomes. Keep their help immediate and tied to the actual step. */
export function workflowHelp(mode:string,id:string,label:string,unconfirmedSave=false):string|undefined{
 if(!mode||mode==='generate')return;
 if(label==='Check save')return 'Check whether the earlier save completed before continuing.';
 if(label==='More actions')return 'See the remaining actions for this step.';
 const save:Record<string,string>={
  'new-project':'Create this project. Add documents when you’re ready.',
  'new-document':'Create this document in the current project and open it.',
  'add-context':'Add this idea to the document so you can use it in your work.',
  'edit-block':'Save changes to this idea and return to your content.',
  rename:'Save the document’s new name.',
  'edit-artifact':'Save your edits to this result.',
 };
 if(label==='Save')return save[mode]??(id.startsWith('workflow:source-refine:')?'Save the shared direction after splitting this idea.':undefined);
 if(label==='Back'){
  if(unconfirmedSave)return 'Return to your content. The earlier save is still unconfirmed.';
  if(mode==='use-in'&&id.startsWith('workflow:review:'))return 'Return to destination selection without applying this change.';
  if(id.startsWith('workflow:intake:'))return 'Return to the suggestions without adding this reference.';
  if(id.startsWith('workflow:compose-behavior:')||id.startsWith('workflow:compose-review:'))return 'Return to choosing the ideas in this group.';
  return ({
   'new-project':'Return without creating a new project.',
   'new-document':'Return without creating a new document.',
   'add-context':'Return without adding a new idea.',
   'edit-block':'Return without saving your edits to this idea.',
   rename:'Return without changing the document’s name.',
   'edit-artifact':'Return without saving your edits to this result.',
   intent:'Return without changing your next goal.',
   reuse:'Return without copying an idea.',
   workspaces:'Keep the current workspace and return.',
  } as Record<string,string>)[mode]??'Close this workflow and return to your content.';
 }
 const help:Record<string,string>={
  'Suggest actions':'Use this goal to update Still’s suggested actions.',
  'Open':'Switch to the selected workspace.',
  'Copy idea':'Save an independent copy of this idea in the selected document.',
  'Link idea':'Use this existing idea in the selected destination.',
  'Save group':'Save this group and its chosen relationships.',
  'Keep original':'Keep the original shared direction and finish.',
  'Edit shared direction':'Refine the shared direction now that the smaller ideas are saved.',
  'Explore again':'Start another exploration of this idea.',
  'Split idea':ACTION_HELP['split-context'],
  'Research idea':ACTION_HELP['research-context'],
  'Find reference':ACTION_HELP['find-references'],
  'Check analysis':'Check the status of the existing analysis.',
  'Add reference':'Review this reference before adding it to your document.',
  'Apply':'Save the reviewed changes to your document.',
  'Change selection':'Return to the suggestions to change what you include.',
  'Close':'Close this workflow and return to your content.',
  'Review':'Review how this idea will be used in the selected destination before saving.',
  'Continue':'Choose how the ideas in this group relate to each other.',
  'Preview':'Review the group and its relationships before saving.',
  'Add':'Include the selected idea in this group.',
  'Remove last':'Remove the last idea from this group’s selection.',
  'Select':'Include this suggestion in the changes you will review.',
  'Deselect':'Leave this suggestion out of the changes you will review.',
  'Next':mode==='use-in'?'Choose where to use the selected idea.':'View the next suggestion.',
 };
 if(label==='Add reference'&&id.startsWith('workflow:intake:'))return 'Save this reference with its source and credit.';
 if(label.startsWith('Review ('))return 'Review your selected suggestions before applying them.';
 return help[label];
}
export function actionHelp(id:string,label:string){if(label.startsWith('Back to '))return `Return to the ${label.slice(8)} without starting a generation.`;return ACTION_HELP[id]??({'Back':'Return to the previous view.','Save':'Save your changes.','Check save':'Check whether the earlier save completed before continuing.','More actions':'See the next suggested actions.','Other outputs':'Choose another available output format.','Next page':'Show the next set of items.','Previous page':'Show the previous set of items.','New project':ACTION_HELP['new-project'],'View document':ACTION_HELP.document,'View results':ACTION_HELP.results,'Find action':ACTION_HELP['ui:palette'],'Download':'Download this result to your device.','Estimate cost':'Get a cost estimate before deciding whether to generate.','Check request':'Look for the existing request; an existing queued job may resume.','Review new request':'Prepare a separate request to review before generating.','Review ideas':'Review the ideas contributing to this request.','Acknowledge & send':'Acknowledge the displayed review and send the request. Usage may be charged.','Previous slide':'View the previous slide.','Next slide':'View the next slide.','Previous frame':'View the previous storyboard frame.','Next frame':'View the next storyboard frame.'} as Record<string,string>)[label]??ACTION_HELP[ACTIONS.find(a=>a.label===label)?.id??'']??ACTIONS.find(a=>a.id===id)?.description??`Choose “${label}”.`;}
export function readOnboardingFlag(url:string,storage:Pick<Storage,'getItem'>){const q=new URL(url).searchParams;return q.has('onboarding')||q.has('onbaording')||storage.getItem('still:flag:onboarding')==='true';}

export const ONBOARDING_MODEL='gpt-5.6-luna' as const;
export const ONBOARDING_VERSION=5;
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
