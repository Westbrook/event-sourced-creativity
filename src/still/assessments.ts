import { foldEvents, type CreativeEvent } from '../model/events.ts';
import type { Action, Answer, Position, Question } from './decisions.ts';
import { destinationsFor, type Destination } from './use-in.ts';

export const COMPOSITIONS={
  intent:{label:'Intent',purpose:'Current goals, openness, progress and explicit requests.'},
  structure:{label:'Content structure',purpose:'Independent ideas, coherence, relationships, order and protected constraints.'},
  connections:{label:'Connections and reuse',purpose:'Existing ideas, destinations, research, references and provenance.'},
  exploration:{label:'Creative exploration',purpose:'Useful novelty, alternatives and possible output media.'},
};
export function questionComposition(id:string):keyof typeof COMPOSITIONS{
  if(/^(fit_|novel_)|surprise|variation|bold_|change_|viewpoint|genre|alternative|medium|model_|image_|sound_|story_to|audio_|audition|pacing|palette|light|motion|duration|diagram/.test(id))return 'exploration';
  if(/use-in|reuse|research|reference|source_|provenance|existing_|discover_connection|unexpected_pairing|portable_motif|independent_reuse/.test(id))return 'connections';
  if(/split|compose|replace|block|context|lock|separable|independent_|essential_|fragmentation|self_contained|shared_target|preserve_order|recur_|scope_|duplicate_|coherent_|part_in_whole|fixed_variable|constraint|continuity|causality|repetition/.test(id))return 'structure';
  return 'intent';
}
export function compositionIndex(questions:Record<string,Question>){return Object.entries(COMPOSITIONS).map(([id,composition])=>({id,...composition,questions:Object.keys(questions).filter(q=>questionComposition(q)===id)}));}
const safe=(v:unknown,n:number)=>String(v??'').replace(/https?:\/\/\S+/g,'[linked resource]').slice(0,n);
export function connectionEvidence(events:CreativeEvent[],pos:Position,prepared?:ReturnType<typeof foldEvents>){
  const p=prepared??foldEvents(events,Infinity,pos.documentId,pos.projectId),source=p.blocks.find(b=>b.id===pos.blockId);
  if(!source)return {destinations:[] as Destination[],details:[] as unknown[],source:null};
  const words=new Set(`${pos.intent} ${source.handle} ${source.properties.text??''}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[]);
  const all=destinationsFor(events,pos);
  const projections=new Map<string,ReturnType<typeof foldEvents>>([[pos.projectId,p]]),indexes=new Map<string,Map<string,typeof p.libraryBlocks[number]>>();
  const project=(id:string)=>{if(!projections.has(id))projections.set(id,foldEvents(events,Infinity,'',id));return projections.get(id)!;};
  const block=(d:Destination)=>{if(!indexes.has(d.projectId))indexes.set(d.projectId,new Map(project(d.projectId).libraryBlocks.map(b=>[b.id,b])));return indexes.get(d.projectId)!.get(d.blockId);};
  // Retrieve from short indexed fields, then hydrate only the six selected candidates.
  const ranked=all.map(d=>{const b=block(d),tokens=new Set(`${d.label} ${d.document} ${safe(b?.properties.text,500)}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[]);return {d,score:[...words].filter(w=>tokens.has(w)).length+(d.blockId?1:0)};}).sort((a,b)=>b.score-a.score||a.d.id.localeCompare(b.d.id)).slice(0,6);
  const details=(d:Destination)=>{const scope=project(d.projectId),b=block(d),neighbors=scope.libraryBlocks.filter(x=>!x.removed&&x.documentId===d.documentId&&x.id!==d.blockId);return {...d,label:safe(d.label,120),project:safe(d.project,120),document:safe(d.document,120),text:safe(b?.properties.text,1600),versions:(b?.sourceEvents??scope.documents.find(x=>x.id===d.documentId)?.sourceEvents??[]).slice(-12),provenance:b?{sourceBlock:safe(b.properties.source_block_id??b.properties.copied_from_block_id,180),excerpt:safe(b.properties.source_excerpt,300)}:{},relationships:scope.libraryBlockRelations.filter(r=>!r.removed&&(r.fromBlockId===d.blockId||r.toBlockId===d.blockId)).slice(0,12).map(r=>({from:r.fromBlockId,to:r.toBlockId,kind:r.kind})),neighbors:neighbors.slice(0,4).map(x=>({id:x.id,label:safe(x.handle,120),text:safe(x.properties.text,400),locked:x.locked})),coverage:{neighborTotal:neighbors.length,neighborIncluded:Math.min(4,neighbors.length)}};};
  return {destinations:ranked.map(x=>x.d),details:ranked.map(x=>details(x.d)),source:{id:source.id,projectId:source.projectId,documentId:source.documentId,handle:safe(source.handle,120),text:safe(source.properties.text,2400),versions:source.sourceEvents.slice(-12),properties:{group:!!source.properties.context_group,sourceBlock:safe(source.properties.source_block_id??source.properties.copied_from_block_id,180)},coverage:{textCharacters:String(source.properties.text??'').length,includedCharacters:Math.min(2400,String(source.properties.text??'').length)},destinationTotal:all.length}};
}
export function shouldEnrich(pos:Position,answers:Record<string,Answer>,count:number){
  const a=answers['use_use-in'];
  return !!pos.blockId&&count>0&&!['choose-format','find-action'].includes(pos.view)&&a?.type==='score'&&Number.isFinite(a.score)&&a.score!>=2&&a.score!<=3&&Number.isFinite(a.confidence)&&a.confidence!>=.5&&a.confidence!<=1;
}
export function enrichmentQuestions(destinations:Destination[],alternatives:Action[]):Record<string,Question>{return {
  ...Object.fromEntries(destinations.flatMap((d,i)=>[[`target_${i}`,{type:'score',instructions:`How useful is reviewing the current idea in destination ${d.id} for the current goal? Use its fuller text, relationships and constraints. A thematic coincidence alone is weak evidence. A review does not authorize a change.`,criteria:['Unrelated','Possible later','Useful connection','Directly supports the current need']}],[`conflict_${i}`,{type:'noul',instructions:`Would adding the current idea to destination ${d.id} duplicate existing meaning or contradict supplied constraints? Unknown is 0.5.`}]])),
  menu_redundant:{type:'noul',instructions:'Does the proposed menu contain at least two actions that address substantially the same immediate need, while an eligible useful alternative would provide a distinct direction? Unknown is 0.5.'},
  ...Object.fromEntries(alternatives.map(a=>[`distinct_${a.id}`,{type:'score',instructions:`Would replacing one redundant menu action with ${a.label} offer a useful, distinct path supported by the fuller evidence? Preserve accepted constraints. Do not reward novelty without purpose.`,criteria:['No useful difference','Possible later','Useful distinct path','Especially useful distinct path']}]))
} as Record<string,Question>;}
const good=(a:Answer|undefined,min:number)=>a?.type==='score'&&Number.isFinite(a.score)&&a.score!>=min&&a.score!<=3&&Number.isFinite(a.confidence)&&a.confidence!>=.7&&a.confidence!<=1;
export type MenuAdjustment={actionId:string;replacedId?:string;reason:string;questions:string[];passId:string;evidence:{passId:string;questionId:string}[]};
export function refineMenu(selected:Action[],candidates:Action[],first:Record<string,Answer>,second:Record<string,Answer>,destinations:Destination[],passId:string){
  const actions=[...selected],adjustments:MenuAdjustment[]=[];
  const targets=destinations.map((d,i)=>({d,i,a:second[`target_${i}`],conflict:second[`conflict_${i}`]})).filter(x=>good(x.a,2.5)&&x.conflict?.type==='noul'&&Number.isFinite(x.conflict.noul)&&x.conflict.noul!>=0&&x.conflict.noul!<=.2).sort((a,b)=>b.a!.score!-a.a!.score!);
  const target=targets[0];
  const insert=(action:Action,reason:string,questions:string[])=>{
    if(actions.some(a=>a.id===action.id))return;
    const evidence=questions.map(questionId=>({passId:questionId.startsWith('use_')?'assessment':passId,questionId}));
    if(actions.length<4&&actions.filter(a=>a.group===action.group).length<2){actions.push(action);adjustments.push({actionId:action.id,reason,questions,passId,evidence});return;}
    const index=actions.findLastIndex(a=>actions.filter(b=>a.group===b.group).length>1&&a.id!=='use-in');
    if(index<0)return;const removed=actions[index];const rest=actions.filter((_,i)=>i!==index);
    if(rest.filter(a=>a.group===action.group).length>=2||action.group==='make'&&rest.some(a=>a.group==='make'))return;
    actions[index]=action;adjustments.push({actionId:action.id,replacedId:removed.id,reason,questions,passId,evidence});
  };
  const use=candidates.find(a=>a.id==='use-in');
  if(target&&use&&good(first['use_use-in'],2))insert(use,'Concrete destination supports a connection',['use_use-in',`target_${target.i}`,`conflict_${target.i}`]);
  if(second.menu_redundant?.type==='noul'&&Number.isFinite(second.menu_redundant.noul)&&second.menu_redundant.noul!>=.8&&second.menu_redundant.noul!<=1){
    const alternative=candidates.filter(a=>['surprise','compose','new-document','use-in'].includes(a.id)&&!actions.some(x=>x.id===a.id)&&good(first[`use_${a.id}`],2)&&good(second[`distinct_${a.id}`],2.5)).sort((a,b)=>second[`distinct_${b.id}`].score!-second[`distinct_${a.id}`].score!)[0];
    if(alternative)insert(alternative,'Useful distinct path replaces redundant group member',['menu_redundant',`distinct_${alternative.id}`,`use_${alternative.id}`]);
  }
  return {actions,adjustments,target:target&&actions.some(a=>a.id==='use-in')?target.d:undefined};
}
