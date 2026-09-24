import { validateFormatOutputPreferences } from '../src/model/document-output-intent.ts';
import { foldEvents, type CreativeEvent } from '../src/model/events.ts';
import { validateIdeaBodyProperties } from '../src/model/idea-body.ts';
import { ideaDependencies, genericIdeaReferences, validateIdeaDependencyGraph } from '../src/model/project-ideas.ts';

/** Validate the final atomic state, never an intermediate body/text property event. */
export function validateIdeaBodyEvents(history: CreativeEvent[], inputs: readonly {type?:string;payload?:Record<string,unknown>}[]) {
  const issue=(index:number,error:string,message:string)=>({index,error,message});
  const scopes=new Set(inputs.map(input=>String(input.payload?.project_id??'')).filter(Boolean));
  const initial=foldEvents(history);if(initial.projectId)scopes.add(initial.projectId);
  for(const project of initial.projects)scopes.add(project.id);
  const oldBlocks=new Map([...scopes].flatMap(project=>foldEvents(history,Infinity,'',project).libraryBlocks).map(block=>[block.id,block]));
  const touched=new Map<string,number>();
  for(const [index,input]of inputs.entries()){
    const p=input.payload??{},id=String(p.block_id??'');
    if(input.type==='BlockCreated'){const properties=p.properties as Record<string,unknown>|undefined;if(properties&&Object.hasOwn(properties,'rich_text_body')&&(p.copied_from_block_id||p.forked_from_block_id||properties.copied_from_block_id||properties.forked_from_block_id))return issue(index,'idea_copy_editor_required','Copying structured Idea bodies requires a compatible reference editor in Still. The source is unchanged.');}
    if(input.type==='BlockCreated'||['BlockPropertyEdited','ChipEdited','BlockRehomed','BlockRemoved','BlockRestored'].includes(String(input.type)))touched.set(id,index);
    const path=String(input.type==='ChipEdited'?p.property:p.property_path??'');
    if((input.type==='BlockPropertyEdited'||input.type==='ChipEdited')&&/^(rich_text_body|text)(\.|$)/u.test(path)){
      const old=oldBlocks.get(id);
      if(old&&Object.hasOwn(old.properties,'rich_text_body'))try{validateIdeaBodyProperties(old.properties);}catch(error){return issue(index,'idea_body_editor_required',error instanceof Error?error.message:'Open this Idea in a compatible Still editor.');}
      if(path.includes('.'))return issue(index,'idea_body_atomic_edit_required','Save the entire Idea body and readable text together in Still.');
    }
  }
  const sequence=history.reduce((head,event)=>Math.max(head,event.sequence),0);
  const replay=[...history,...inputs.map((input,index)=>({eventId:`idea-body-validation:${index}`,streamId:history[0]?.streamId??'',sequence:sequence+index+1,occurredAt:'',recordedAt:'',actor:'user',clientId:'',correlationId:'',causationId:null,compensatesEventId:null,schemaVersion:1,type:String(input.type),payload:input.payload??{}}))];
  for(const projectId of scopes){
    const projection=foldEvents(replay,Infinity,'',projectId);
    for(const block of projection.libraryBlocks){
      if(!touched.has(block.id))continue;
      const old=oldBlocks.get(block.id);
      if(old&&Object.hasOwn(old.properties,'rich_text_body')&&!Object.hasOwn(block.properties,'rich_text_body'))return issue(touched.get(block.id)!,'idea_body_atomic_edit_required','Rich Idea bodies cannot be flattened. Open this Idea in Still.');
      try{validateIdeaBodyProperties(block.properties);}catch(error){return issue(touched.get(block.id)!,'idea_body_invalid',error instanceof Error?error.message:'Open this Idea in Still.');}
      const preference=validateFormatOutputPreferences(block);if(!preference.valid)return issue(touched.get(block.id)!,'idea_output_preference_invalid',preference.issues.join(' '));
    }
    // Recheck affected rich roots, including incoming references to removed/rehomed targets.
    const richRoots=projection.libraryBlocks.filter(block=>!block.removed&&Object.hasOwn(block.properties,'rich_text_body'));
    for(const root of richRoots){
      const closure=ideaDependencies([root.id],projection.libraryBlocks,projection.libraryBlockRelations);
      const relevant=new Set(closure.map(block=>block.id));
      const affected=closure.some(block=>touched.has(block.id)||genericIdeaReferences(block.properties).some(ref=>touched.has(ref.blockId)))
        ||inputs.some(input=>input.type==='BlockRelationAdded'&&relevant.has(String(input.payload?.from_block_id))
          ||input.type==='BlockRelationRemoved'&&projection.libraryBlockRelations.some(relation=>relation.id===input.payload?.relation_id&&relevant.has(relation.fromBlockId)));
      if(!affected)continue;
      const graphIssue=validateIdeaDependencyGraph(closure,projection.libraryBlockRelations);
      if(graphIssue)return issue(touched.get(graphIssue.blockId)??0,graphIssue.code,graphIssue.message);
    }
  }
  return null;
}
