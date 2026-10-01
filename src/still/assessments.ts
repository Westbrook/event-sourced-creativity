import { inspectScoreAnswer } from './decision-answer.ts';
import { ideasInDocument } from '../model/project-ideas.ts';
import { foldEvents, type CreativeEvent } from '../model/events.ts';
import type { Action, Answer, Position, Question } from './decisions.ts';
import { destinationsFor, type Destination } from './use-in.ts';
import { selectDecisionEvidence } from './decision-retrieval.ts';

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
export function connectionEvidence(events:CreativeEvent[],pos:Position,prepared?:ReturnType<typeof foldEvents>,options?:{goal?:string}){
  const p=prepared??foldEvents(events,Infinity,pos.documentId,pos.projectId),source=(pos.view==='ideas'?p.libraryBlocks:p.blocks).find(b=>b.id===pos.blockId&&!b.removed);
  if(!source)return {destinations:[] as Destination[],details:[] as unknown[],source:null,coverage:{candidateTotal:0,included:0,omitted:0,limit:6,strategy:'goal-focus-relationships-diversity-v1',omissionReason:'no_selected_idea'}};
  const all=destinationsFor(events,pos);
  const projections=new Map<string,ReturnType<typeof foldEvents>>([[pos.projectId,p]]),indexes=new Map<string,Map<string,typeof p.libraryBlocks[number]>>();
  const project=(id:string)=>{if(!projections.has(id))projections.set(id,foldEvents(events,Infinity,'',id));return projections.get(id)!;};
  const block=(d:Destination)=>{if(!indexes.has(d.projectId))indexes.set(d.projectId,new Map(project(d.projectId).libraryBlocks.map(b=>[b.id,b])));return indexes.get(d.projectId)!.get(d.blockId);};
  const relatedIds=new Set(p.libraryBlockRelations.filter(r=>!r.removed&&(r.fromBlockId===source.id||r.toBlockId===source.id)).flatMap(r=>[r.fromBlockId,r.toBlockId]));
  const changes=events.filter(e=>/^(BlockCreated|BlockRenamed|BlockPropertyEdited|BlockWeightSet|BlockRehomed|BlockLocked|BlockUnlocked|BlockRemoved|BlockRestored|BlockDocumentAttached|BlockDocumentDetached|BlockRelationAdded|BlockRelationRemoved|DocumentCreated|DocumentRenamed)$/.test(e.type)).slice(-32);
  const recentChanges=new Set(changes.map(e=>e.eventId)),changedBlocks=new Set<string>(),changedDocuments=new Set<string>(),relationEnds=new Map<string,string[]>();
  for(const e of events)if(e.type==='BlockRelationAdded')relationEnds.set(String(e.payload.relation_id),[String(e.payload.from_block_id),String(e.payload.to_block_id)]);
  for(const e of changes){
    if(typeof e.payload.block_id==='string')changedBlocks.add(e.payload.block_id);
    if(e.type.startsWith('Document')&&typeof e.payload.document_id==='string')changedDocuments.add(e.payload.document_id);
    if(e.type.startsWith('BlockRelation'))for(const id of relationEnds.get(String(e.payload.relation_id))??[])changedBlocks.add(id);
  }
  const sourceOrigin=String(source.properties.source_block_id??source.properties.copied_from_block_id??source.id);
  // Index short fields across the already authorized catalog. Hydrate at most six
  // destinations; retrieval never creates destinations or grants permission.
  const retrieval=selectDecisionEvidence(all.map(d=>{
    const b=block(d),document=project(d.projectId).documents.find(x=>x.id===d.documentId),origin=b?.properties.source_block_id??b?.properties.copied_from_block_id;
    return {id:d.id,value:d,projectId:d.projectId,documentId:d.documentId,category:d.kind,title:`${safe(d.label,120)} ${safe(d.document,120)}`,text:safe(b?.properties.text,500),related:!!b&&(d.projectId===source.projectId&&relatedIds.has(b.id)||origin===sourceOrigin||b.id===sourceOrigin),changedRecently:changedBlocks.has(d.blockId)||!d.blockId&&changedDocuments.has(d.documentId)||[...(b?.sourceEvents??document?.sourceEvents??[]),...(b?.documentUses?.find(use=>use.documentId===d.documentId)?.sourceEvents??[])].some(id=>recentChanges.has(id))};
  }),{goal:`${pos.intent} ${options?.goal??''}`,focusText:`${safe(source.handle,120)} ${safe(source.properties.text,1600)}`,projectId:pos.projectId,documentId:pos.documentId},6);
  const details=(d:Destination,reasons:string[],score:number)=>{
    const scope=project(d.projectId),documentBlocks=ideasInDocument(scope,d.documentId),b=documentBlocks.find(x=>x.id===d.blockId),neighbors=documentBlocks.filter(x=>x.id!==d.blockId),versions=b?.sourceEvents??scope.documents.find(x=>x.id===d.documentId)?.sourceEvents??[];
    const relationships=scope.libraryBlockRelations.filter(r=>!r.removed&&(r.fromBlockId===d.blockId||r.toBlockId===d.blockId));
    const text=safe(b?.properties.text,1600);
    return {...d,label:safe(d.label,120),project:safe(d.project,120),document:safe(d.document,120),text,versions:versions.slice(-12),provenance:b?{sourceBlock:safe(b.properties.source_block_id??b.properties.copied_from_block_id,180),excerpt:safe(b.properties.source_excerpt,300)}:{},relationships:relationships.slice(0,12).map(r=>({from:r.fromBlockId,to:r.toBlockId,kind:r.kind})),neighbors:neighbors.slice(0,4).map(x=>({id:x.id,label:safe(x.handle,120),text:safe(x.properties.text,400),locked:x.locked})),retrieval:{reasons,score,scoreMeaning:'local evidence ordering, not probability or quality'},coverage:{textCharacters:String(b?.properties.text??'').length,includedCharacters:text.length,versionsTotal:versions.length,versionsIncluded:Math.min(12,versions.length),relationshipTotal:relationships.length,relationshipIncluded:Math.min(12,relationships.length),neighborTotal:neighbors.length,neighborIncluded:Math.min(4,neighbors.length)}};
  };
  return {destinations:retrieval.selected.map(x=>x.value),details:retrieval.selected.map(x=>details(x.value,x.reasons,x.score)),coverage:{...retrieval.coverage,indexedTextCharactersPerCandidate:500,focusTextCharacterLimit:1600,recentChangeEventLimit:32},source:{id:source.id,projectId:source.projectId,documentId:source.documentId,handle:safe(source.handle,120),text:safe(source.properties.text,2400),versions:source.sourceEvents.slice(-12),properties:{group:!!source.properties.context_group,sourceBlock:safe(source.properties.source_block_id??source.properties.copied_from_block_id,180)},coverage:{textCharacters:String(source.properties.text??'').length,includedCharacters:safe(source.properties.text,2400).length,versionsTotal:source.sourceEvents.length,versionsIncluded:Math.min(12,source.sourceEvents.length)},destinationTotal:all.length}};
}
export function shouldEnrich(pos:Position,answers:Record<string,Answer>,count:number){
  const a=inspectScoreAnswer(answers['use_use-in']);
  return !!pos.blockId&&count>0&&!['choose-format','find-action'].includes(pos.view)&&a.quality!=='unusable'&&a.score!==undefined&&a.score>=2&&a.confidence!==undefined&&a.confidence>=.5;
}
export function enrichmentQuestions(destinations:Destination[],alternatives:Action[]):Record<string,Question>{return {
  ...Object.fromEntries(destinations.flatMap((d,i)=>[[`target_${i}`,{type:'score',instructions:`How useful is reviewing the current idea in destination ${d.id} for the current goal? Use its fuller text, relationships and constraints. A thematic coincidence alone is weak evidence. A review does not authorize a change.`,criteria:['Unrelated','Possible later','Useful connection','Directly supports the current need']}],[`conflict_${i}`,{type:'noul',instructions:`Would adding the current idea to destination ${d.id} duplicate existing meaning or contradict supplied constraints? Unknown is 0.5.`}]])),
  menu_redundant:{type:'noul',instructions:'Does the proposed menu contain at least two actions that address substantially the same immediate need, while an eligible useful alternative would provide a distinct direction? Unknown is 0.5.'},
  ...Object.fromEntries(alternatives.map(a=>[`distinct_${a.id}`,{type:'score',instructions:`Would replacing one redundant menu action with ${a.label} offer a useful, distinct path supported by the fuller evidence? Preserve accepted constraints. Do not reward novelty without purpose.`,criteria:['No useful difference','Possible later','Useful distinct path','Especially useful distinct path']}]))
} as Record<string,Question>;}
const good=(answer:Answer|undefined,min:number)=>{const a=inspectScoreAnswer(answer);return a.quality!=='unusable'&&a.score!==undefined&&a.score>=min&&a.confidence!==undefined&&a.confidence>=.7;};
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
    const alternative=candidates.filter(a=>['add-context','compose','new-document','use-in'].includes(a.id)&&!actions.some(x=>x.id===a.id)&&good(first[`use_${a.id}`],2)&&good(second[`distinct_${a.id}`],2.5)).sort((a,b)=>second[`distinct_${b.id}`].score!-second[`distinct_${a.id}`].score!)[0];
    if(alternative)insert(alternative,'Useful distinct path replaces redundant group member',['menu_redundant',`distinct_${alternative.id}`,`use_${alternative.id}`]);
  }
  return {actions,adjustments,target:target&&actions.some(a=>a.id==='use-in')?target.d:undefined};
}
