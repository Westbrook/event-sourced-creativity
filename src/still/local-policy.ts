import type { CreativeProjection } from '../model/events.ts';
import type { Action, Position, RankingRow } from './decisions.ts';
import { editableIdea } from './composition.ts';
export const DOCUMENT_RETURN_REASON='Page navigation: return from the selected idea to review the whole document or choose an output.';
export function isIdeaPage(pos:Pick<Position,'view'|'blockId'|'palette'>){return pos.view==='document'&&!!pos.blockId&&!pos.palette;}
/** Document-wide maintenance stays in the palette while one idea is in focus. */
export function pageToolbarCandidates<T extends {id:string}>(actions:T[],pos:Pick<Position,'view'|'blockId'|'palette'>):T[]{
  return isIdeaPage(pos)?actions.filter(a=>a.id!=='rename'):actions;
}
/** Reserve parent navigation without altering Jev scores or claiming a generation intent. */
export function withDocumentReturn<T extends {id:string}>(actions:T[],eligible:T[],pos:Pick<Position,'view'|'blockId'|'palette'>,limit=4):T[]{
  const ordered=pageToolbarCandidates(actions,pos),parent=isIdeaPage(pos)?eligible.find(a=>a.id==='context'):undefined;
  if(!parent||limit<1)return ordered.slice(0,Math.max(0,limit));
  const rest=ordered.filter(a=>a.id!=='context');
  const index=ordered[0]?.id==='context'||limit===1?0:Math.min(1,rest.length);
  rest.splice(index,0,parent);return rest.slice(0,limit);
}
export type LocalRule={id:string;reason:string};
const formats=['image','short_story','scene','slides','storyboard','video','audio','model3d'];
/** Deliberately narrow: only a whole, explicit format instruction, never a mention in prose. */
export function explicitLocalFormat(intent:string){
  const text=intent.trim().toLowerCase().replace(/[.!]$/,'');
  const match=text.match(/^(?:(?:create|generate|make|write)(?: me)? (?:an? |the )?)?(image|picture|short story|story|scene|slides|presentation|storyboard|video|audio|3d|3d model)$/);
  return match?({picture:'image',story:'short_story','short story':'short_story',presentation:'slides','3d':'model3d','3d model':'model3d'} as Record<string,string>)[match[1]]??match[1]:undefined;
}
export function localFormatRules(p:CreativeProjection,pos:Position):LocalRule[]{
  const rules:LocalRule[]=[];const add=(id:string|undefined,reason:string)=>{if(id&&formats.includes(id)&&!rules.some(r=>r.id===id))rules.push({id,reason});};
  add(explicitLocalFormat(pos.intent),'Explicit output format in your current direction');
  add(pos.recentActions.findLast(id=>id.startsWith('format-choice:'))?.slice(14),'Format you selected in this document');
  const artifacts=p.artifacts.filter(a=>a.documentId===pos.documentId),outputs=p.outputs.filter(o=>o.documentId===pos.documentId);
  const selected=artifacts.find(a=>a.id===pos.outputId);
  add(selected?.kind??(outputs.some(o=>o.id===pos.outputId)?'image':undefined),'Continue the selected output format');
  const recent=[...artifacts.map(a=>({id:a.kind,sequence:a.sequence})),...outputs.filter(o=>!o.discarded).map(o=>({id:'image',sequence:o.sequence}))].sort((a,b)=>b.sequence-a.sequence);
  for(const output of recent)add(output.id,'Existing output format in this document');
  for(const id of formats)add(id,'Stable format order; no preference evidence');
  return rules;
}
/** Local facts choose useful starting actions. Unlisted actions stay accessible in More/Palette. */
export function localActionRules(p:CreativeProjection,pos:Position):LocalRule[]{
  const rules:LocalRule[]=[];const add=(id:string,reason:string)=>{if(!rules.some(r=>r.id===id))rules.push({id,reason});};
  const blocks=p.blocks.filter(b=>!b.removed),active=blocks.filter(b=>Number(b.properties.weight??1)>0);
  const block=(pos.view==='ideas'?p.libraryBlocks:blocks).find(b=>b.id===pos.blockId&&!b.removed),hasResults=p.outputs.some(o=>!o.discarded)||p.artifacts.length>0;
  const reusable=p.libraryBlocks.some(b=>!b.removed&&!p.blocks.some(used=>used.id===b.id));
  const done=pos.recentActions.findLast(id=>id.startsWith('completed:'))?.slice(10);
  if(pos.view==='projects'){add('new-project',p.projects.length?'Start another project':'Your workspace has no projects');return rules;}
  if(pos.view==='ideas'){if(pos.blockId){add('edit-block','Edit the shared project idea');add('use-in','Use this idea in a document');add('ideas','Browse every idea in the project');}else{add('add-context','Keep a new project idea without choosing a document');add('documents','Browse this project’s documents');}return rules;}
  if(pos.view==='documents'){add('ideas','Browse and reuse ideas across this project');add('new-document',p.documents.some(d=>!d.removed)?'Add a document to this project':'This project has no documents');add('projects','Browse another project');return rules;}
  if(pos.view==='rejection'){
    add('context','Review and revise the source document');add('view-output','Return to this attempt');add('clarify','Clarify the intended request');add('add-context','Change the contributing ideas');add('create','Consider another output');add('generate-again','Deliberately start another paid attempt');return rules;
  }
  if(pos.view==='generation'){
    if(pos.generation?.inspectable)add('inspect-rejection','Inspect retained failure evidence before another purchase');
    if(pos.generation?.mayDuplicateCharge){add('refresh-generation','Original request is unconfirmed; check saved status');add('context','Inspect the source before another request');}
    else{add('context',pos.generation?.active?'Work on the source while generation continues':'Inspect or revise the source');add('refresh-generation','Check the saved generation status');}
    add('results','Review existing results');if(!pos.generation?.mayDuplicateCharge)add('generate-again','Explicitly start a separate generation');return rules;
  }
  if(pos.view==='artifact'){add('export','A result is selected');add('edit-artifact','Selected writing can be revised');add('context','Return to the source ideas');add('create','Explore another output from this document');return rules;}
  if(pos.view==='results'){add('context',hasResults?'Review the source behind these results':'Add or review source ideas');add(active.length?'create':'add-context',active.length?'Create another output from active context':'This document has no active context');return rules;}
  if(!blocks.length){add('add-context','This document has no context');if(reusable)add('reuse','Reusable ideas exist in another document');add('documents','Return to this project’s documents');return rules;}
  // A lock expresses a preserved constraint, not a request to change it. Unlock
  // remains eligible for deliberate discovery and model-supported suggestions.
  if(block?.locked){add('context','Review the whole document with its locked constraint');add('use-in','Reuse this idea elsewhere');return rules;}
  if(block&&Number(block.properties.weight??1)<=0){add('toggle-context','Selected idea is excluded from generation');add('edit-block','Revise the excluded idea');add('context','Review the active document context');return rules;}
  if(done==='split-context'){add('context','Review the smaller ideas you just saved');add('compose','Arrange the saved pieces');add('edit-block','Refine the shared source direction');}
  else if(done==='find-references'||done==='research-context'||done==='supply-reference'){add('context','Review the reference or research you just saved');add('use-in','Use the enriched idea elsewhere');add('create','Try the updated context in an output');}
  else if(['compose','replace-part','edit-block','add-context','reuse'].includes(done??'')){add('context','Review your saved context changes');add('create','Try the updated context');if(hasResults)add('results','Compare with existing results');}
  if(block){
    add('edit-block','An editable idea is selected');add('context',DOCUMENT_RETURN_REASON);
    if(blocks.filter(editableIdea).length>1)add('compose','Other editable ideas are available to arrange');
    add('use-in','Use this idea in another document or composition');add('create','Create from the active document context');add('context','Review the whole document');
  }else{
    add('add-context','Extend the document’s ideas');if(reusable)add('reuse','Reusable ideas exist in another document');
    add('create',active.length?'Active context is ready for an output':'Include context before generating');if(hasResults)add('results','This document already has results');add('documents','Browse this project’s documents');
  }
  return rules;
}
export function evaluateLocalActions(candidates:Action[],p:CreativeProjection,pos:Position){
  const rules=localActionRules(p,pos),selected:Action[]=[];
  const ranked=pageToolbarCandidates([...candidates],pos).filter(a=>a.id!=='intent'&&!formats.includes(a.id)).sort((a,b)=>{
    const left=rules.findIndex(r=>r.id===a.id),right=rules.findIndex(r=>r.id===b.id);
    return (left<0?Infinity:left)-(right<0?Infinity:right)||a.label.localeCompare(b.label);
  });
  const rows:RankingRow[]=candidates.map(a=>{
    const index=rules.findIndex(r=>r.id===a.id),rank=ranked.indexOf(a),localReason=rules[index]?.reason??'Available on request; no local reason to suggest it';
    let reason='';const relevant=index>=0&&rank>=0;
    if(!relevant)reason='Available in More or Palette';
    // Selection is assigned below in ranked order, not catalog order.
    return {id:a.id,questionId:`use_${a.id}`,reason,localReason,base:relevant?Math.max(1,3-index*.2):0,value:relevant?Math.max(1,3-index*.2):0,basis:'policy' as const,...(rank>=0?{rank:rank+1}:{}),selected:undefined as number|undefined};
  });
  for(const action of ranked){const row=rows.find(r=>r.id===action.id)!;if(!rules.some(r=>r.id===action.id))continue;
    if(selected.length>=4)row.reason='Four-action limit';
    else if(action.group==='make'&&selected.some(a=>a.group==='make'))row.reason='One creation action limit';
    else if(selected.filter(a=>a.group===action.group).length>=2)row.reason='Two actions per group limit';
    else{selected.push(action);row.selected=selected.length;row.reason='';}
  }
  if(!selected.length){
    const fallback=candidates.find(a=>a.id===(pos.view==='projects'?'new-project':'projects'));
    if(fallback){selected.push(fallback);const row=rows.find(r=>r.id===fallback.id)!;row.selected=1;row.reason='';row.localReason='A useful next step when no contextual suggestions apply';}
  }
  return {selected,ranked,rows,modelRanked:false};
}
