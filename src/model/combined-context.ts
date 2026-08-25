import { promptFactIsActive } from "./prompt-policy.ts";

export const COMBINED_CONTEXT_ROLES = ["character","location","object","wardrobe","scene","sequence","slide_chapter","message","visual_system","custom"] as const;
export type CombinedContextRole = typeof COMBINED_CONTEXT_ROLES[number];
export const COMBINED_CONTEXT_APPLICATIONS = ["isolate","co_locate","ordered","recur"] as const;
export type CombinedContextApplication = typeof COMBINED_CONTEXT_APPLICATIONS[number];

export type CombinedContextMembership = {
  contextSetId: string;
  name: string;
  role: CombinedContextRole;
  target: string;
  application: CombinedContextApplication;
  relativity: number;
  memberOrder: number;
  sourceCanvasId: string;
};

export type CombinedContextGroup = {
  id: string;
  name: string;
  role: CombinedContextRole;
  target: string;
  application: CombinedContextApplication;
  relativity: number;
  depth?: number;
  path?: string[];
  members: Array<{ blockId:string; label:string; role:string; relativity:number; order:number; depth?:number; path?:string[] }>;
};

/** A document relationship, rather than a second kind of record, makes any block a group. */
export const CONTEXT_CONTAINS_RELATION = "context_contains";
export const CONTEXT_COMPOSITION_RELATIONS = new Set([CONTEXT_CONTAINS_RELATION,"combined_context_member"]);

export type ContextCompositionBlock = {
  id:string;
  projectId:string;
  documentId:string;
  canvasId?:string;
  scope?:string;
  locked:boolean;
  removed?:boolean;
};

export type ContextCompositionRelation = {
  id:string;
  fromBlockId:string;
  toBlockId:string;
  kind:string;
  removed?:boolean;
  properties:Record<string,unknown>;
};

export type ContextCompositionIssue = {index:number;code:string;message:string};

export const COMBINED_CONTEXT_ROLE_DEFINITIONS: ReadonlyArray<{id:CombinedContextRole;label:string;description:string}> = [
  {id:"character",label:"Character",description:"Wardrobe, appearance, objects, behavior, and references stay attached to one character."},
  {id:"location",label:"Location",description:"Architecture, atmosphere, material, light, and activity define one place."},
  {id:"object",label:"Object or prop",description:"Shape, material, markings, and handling describe one object."},
  {id:"wardrobe",label:"Wardrobe",description:"Garments, palette, materials, and styling travel together."},
  {id:"scene",label:"Scene",description:"Subjects, place, action, and treatment arrive as one scene unit."},
  {id:"sequence",label:"Ordered sequence",description:"Members retain their order as beats, shots, or stages."},
  {id:"slide_chapter",label:"Slide chapter",description:"Members are assigned to one contiguous slide or slide chapter."},
  {id:"message",label:"Message",description:"Evidence, audience, tone, and claim resolve as one communication unit."},
  {id:"visual_system",label:"Visual system",description:"Style, typography, palette, material, and layout form one reusable system."},
  {id:"custom",label:"Custom target",description:"Name the specific part of the result these decisions jointly define."},
];

export const COMBINED_CONTEXT_APPLICATION_DEFINITIONS: ReadonlyArray<{id:CombinedContextApplication;label:string;description:string}> = [
  {id:"isolate",label:"Keep isolated",description:"Apply every member only to the named target; do not leak it into unrelated content."},
  {id:"co_locate",label:"Keep together",description:"Introduce or resolve the members at the same narrative, visual, or presentation point."},
  {id:"ordered",label:"Preserve order",description:"Treat the member order as chronology, shot order, or a progression."},
  {id:"recur",label:"Recur together",description:"The group may return, but its members should return as one recognizable unit."},
];

export function combinedContextRoleForBlockType(type:string):CombinedContextRole{
  if(type==="subject")return"character";if(type==="environment"||type==="lighting")return"location";if(type==="motion"||type==="camera")return"sequence";if(type==="audience"||type==="message"||type==="direction")return"message";if(type==="style"||type==="palette"||type==="material"||type==="typography"||type==="brand")return"visual_system";return"custom";
}

const record=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const clamp=(value:unknown,fallback=.8)=>Math.max(0,Math.min(1,Number.isFinite(Number(value))?Number(value):fallback));
const role=(value:unknown):CombinedContextRole=>COMBINED_CONTEXT_ROLES.includes(value as CombinedContextRole)?value as CombinedContextRole:"custom";
const application=(value:unknown):CombinedContextApplication=>COMBINED_CONTEXT_APPLICATIONS.includes(value as CombinedContextApplication)?value as CombinedContextApplication:"isolate";

export const isContextCompositionRelation=(kind:unknown)=>CONTEXT_COMPOSITION_RELATIONS.has(String(kind??""));

export function contextRelationOrder(properties:Record<string,unknown>,fallback=0){
  const value=Number(properties.member_order??properties.order??fallback);
  return Number.isSafeInteger(value)&&value>=0?value:fallback;
}

/** Replay an entire proposed graph mutation before accepting any part of it. */
export function validateContextCompositionGraph(input:{
  blocks:readonly ContextCompositionBlock[];
  relations:readonly ContextCompositionRelation[];
  events:readonly {type?:string;payload?:Record<string,unknown>}[];
  ignoreLocks?:boolean;
}):ContextCompositionIssue|null{
  const blocks=new Map(input.blocks.filter((block)=>!block.removed).map((block)=>[block.id,{...block}]));
  const relations=new Map(input.relations.filter((relation)=>!relation.removed&&isContextCompositionRelation(relation.kind)).map((relation)=>[relation.id,{...relation}]));
  const issue=(index:number,code:string,message:string):ContextCompositionIssue=>({index,code,message});
  const reaches=(start:string,target:string)=>{
    const pending=[start],visited=new Set<string>();
    while(pending.length){const current=pending.pop()!;if(current===target)return true;if(visited.has(current))continue;visited.add(current);for(const relation of relations.values())if(relation.fromBlockId===current)pending.push(relation.toBlockId);}
    return false;
  };
  for(const [index,event]of input.events.entries()){
    const payload=record(event.payload),type=String(event.type??"");
    if(type==="BlockCreated"){
      const id=String(payload.block_id??"");if(!id)continue;
      blocks.set(id,{id,projectId:String(payload.project_id??""),documentId:String(payload.document_id??""),canvasId:String(payload.canvas_id??""),scope:String(payload.scope??(payload.canvas_id?"canvas":"document")),locked:false,removed:false});
      continue;
    }
    if(type==="BlockLocked"||type==="BlockUnlocked"){const block=blocks.get(String(payload.block_id??""));if(block)block.locked=type==="BlockLocked";continue;}
    if(type==="BlockRemoved"){blocks.delete(String(payload.block_id??""));continue;}
    if(type==="BlockRelationRemoved"){
      const relation=relations.get(String(payload.relation_id??""));if(!relation)continue;
      const parent=blocks.get(relation.fromBlockId),child=blocks.get(relation.toBlockId);
      if(!input.ignoreLocks&&(parent?.locked||child?.locked))return issue(index,"context_composition_locked","Unlock both context decisions before changing their relationship.");
      relations.delete(relation.id);continue;
    }
    if(type!=="BlockRelationAdded"||!isContextCompositionRelation(payload.kind))continue;
    const id=String(payload.relation_id??""),from=String(payload.from_block_id??""),to=String(payload.to_block_id??"");
    if(!id||!from||!to)return issue(index,"context_composition_endpoint_required","A context relationship needs two existing decisions.");
    if(from===to)return issue(index,"context_composition_cycle","A context decision cannot include itself.");
    const parent=blocks.get(from),child=blocks.get(to);
    if(!parent||!child)return issue(index,"context_composition_endpoint_missing","Both context decisions must exist in the current project.");
    if(!input.ignoreLocks&&(parent.locked||child.locked))return issue(index,"context_composition_locked","Unlock both context decisions before changing their relationship.");
    const project=String(payload.project_id??"");
    if(parent.projectId&&child.projectId&&parent.projectId!==child.projectId||project&&(parent.projectId&&parent.projectId!==project||child.projectId&&child.projectId!==project))return issue(index,"context_composition_cross_project","Context decisions cannot be connected across projects.");
    const document=String(payload.document_id??"");
    if(parent.documentId&&child.documentId&&parent.documentId!==child.documentId||document&&(parent.documentId&&parent.documentId!==document||child.documentId&&child.documentId!==document))return issue(index,"context_composition_cross_document","Context decisions must belong to the same document.");
    const properties=record(payload.properties),specified=properties.member_order??properties.order;
    if(specified!==undefined&&(typeof specified!=="number"||!Number.isSafeInteger(specified)||specified<0))return issue(index,"context_composition_order_invalid","The position of a context decision must be a nonnegative whole number.");
    if([...relations.values()].some((relation)=>relation.fromBlockId===from&&relation.toBlockId===to))return issue(index,"context_composition_duplicate","This context decision is already included in that group.");
    if(reaches(to,from))return issue(index,"context_composition_cycle","A context group cannot include one of its own ancestors.");
    relations.set(id,{id,fromBlockId:from,toBlockId:to,kind:String(payload.kind),properties});
  }
  return null;
}

export function normalizeCombinedContextMembership(value:unknown,index=0):CombinedContextMembership|null{
  const input=record(value),contextSetId=String(input.context_set_id??input.contextSetId??"").trim();if(!contextSetId)return null;
  const name=String(input.name??"Combined context").trim()||"Combined context";
  return{contextSetId,name,role:role(input.role),target:String(input.target??name).trim()||name,application:application(input.application),relativity:clamp(input.relativity),memberOrder:Math.max(0,Math.floor(Number(input.member_order??input.memberOrder??index)||0)),sourceCanvasId:String(input.source_canvas_id??input.sourceCanvasId??"")};
}

export function combinedContextMemberships(properties:Record<string,unknown>):CombinedContextMembership[]{
  let raw=Array.isArray(properties.combined_context_memberships)?properties.combined_context_memberships:properties.combined_context?[properties.combined_context]:[];
  // Documents created before Combined Context isolation was first-class still retain
  // a durable context_set_id. Read that older shape as an isolation group so existing
  // work benefits immediately; the first edit migrates it to the richer membership.
  const legacyId=String(properties.context_set_id??"").trim();
  if(!raw.length&&legacyId&&(properties.copied_as_context_set===true||properties.reference_set_kind==="storyboard")){
    const storyboard=properties.reference_set_kind==="storyboard";
    const fallbackName=String(properties.context_set_name??properties.storyboard_title??`Combined context ${legacyId.slice(0,8)}`).trim();
    raw=[{context_set_id:legacyId,name:fallbackName,target:fallbackName,role:storyboard?"sequence":"custom",application:storyboard?"ordered":"isolate",relativity:properties.weight??.8,member_order:storyboard?Math.max(0,Number(properties.storyboard_frame_index??1)-1):0,source_canvas_id:properties.source_canvas_id??""}];
  }
  const seen=new Set<string>();return raw.map((value,index)=>normalizeCombinedContextMembership(value,index)).filter((item):item is CombinedContextMembership=>Boolean(item)).filter((item)=>{const key=`${item.contextSetId}:${item.memberOrder}`;if(seen.has(key))return false;seen.add(key);return true;});
}

const factLabel=(fact:Record<string,unknown>)=>{const properties=record(fact.properties);return String(properties.text??properties.label??fact.handle??fact.type??"decision");};

export function combinedContextGroups(snapshot:Record<string,unknown>):CombinedContextGroup[]{
  const facts=(Array.isArray(snapshot.facts)?snapshot.facts:[]).map(record).filter(promptFactIsActive);
  const grouped=new Map<string,CombinedContextGroup>();
  for(const fact of facts){const properties=record(fact.properties);for(const membership of combinedContextMemberships(properties)){const existing=grouped.get(membership.contextSetId)??{id:membership.contextSetId,name:membership.name,role:membership.role,target:membership.target,application:membership.application,relativity:membership.relativity,members:[]};existing.relativity=Math.max(existing.relativity,membership.relativity);existing.members.push({blockId:String(fact.block_id??""),label:factLabel(fact),role:String(fact.role??fact.type??"decision"),relativity:membership.relativity,order:membership.memberOrder});grouped.set(membership.contextSetId,existing);}}

  const factsById=new Map(facts.map((fact)=>[String(fact.block_id??""),fact]));
  const relationships=(Array.isArray(snapshot.relationships)?snapshot.relationships:[]).map(record).filter((relation)=>isContextCompositionRelation(relation.kind));
  const children=new Map<string,Array<{id:string;parent:string;child:string;kind:string;properties:Record<string,unknown>}>>();
  const incoming=new Map<string,string[]>();
  for(const relation of relationships){
    const parent=String(relation.from_block_id??relation.source??""),child=String(relation.to_block_id??relation.target??"");
    if(!factsById.has(parent)||!factsById.has(child)||parent===child)continue;
    const value={id:String(relation.relation_id??`${parent}:${child}`),parent,child,kind:String(relation.kind),properties:record(relation.properties)};
    children.set(parent,[...(children.get(parent)??[]),value]);incoming.set(child,[...(incoming.get(child)??[]),parent]);
  }
  for(const list of children.values())list.sort((left,right)=>contextRelationOrder(left.properties)-contextRelationOrder(right.properties)||left.child.localeCompare(right.child));

  const ancestorsFor=(id:string)=>{
    const labels:string[]=[],seen=new Set([id]);let cursor=id;
    while(incoming.get(cursor)?.length){const next=[...(incoming.get(cursor)??[])].sort()[0]!;if(seen.has(next))break;seen.add(next);const fact=factsById.get(next);if(fact)labels.unshift(factLabel(fact));cursor=next;}
    return labels;
  };

  for(const[rootId,edges]of children){
    const root=factsById.get(rootId);if(!root)continue;
    const rootProperties=record(root.properties),metadata=record(rootProperties.context_group);
    const legacyId=edges.some((edge)=>edge.kind===CONTEXT_CONTAINS_RELATION)?"":String(edges[0]?.properties.context_set_id??"");
    const legacy=combinedContextMemberships(rootProperties).find((membership)=>membership.contextSetId===legacyId);
    const id=legacyId||rootId;
    const name=String(metadata.name??legacy?.name??rootProperties.label??rootProperties.text??root.handle??"Combined context").trim()||"Combined context";
    const ancestors=ancestorsFor(rootId);
    const group:CombinedContextGroup={id,name,role:role(metadata.role??legacy?.role??combinedContextRoleForBlockType(String(root.type??""))),target:String(metadata.target??legacy?.target??name).trim()||name,application:application(metadata.application??legacy?.application),relativity:clamp(metadata.relativity??legacy?.relativity??rootProperties.weight),depth:ancestors.length,path:[...ancestors,name],members:[]};
    const visited=new Set<string>();
    const append=(blockId:string,depth:number,path:string[],weight:number)=>{
      if(visited.has(blockId))return;visited.add(blockId);const fact=factsById.get(blockId);if(!fact)return;
      const label=factLabel(fact),memberPath=[...path,label];group.members.push({blockId,label,role:String(fact.role??fact.type??"decision"),relativity:weight,order:group.members.length,depth,path:memberPath});
      for(const edge of children.get(blockId)??[])append(edge.child,depth+1,memberPath,clamp(edge.properties.relativity,weight));
    };
    append(rootId,0,[],group.relativity);
    const previous=grouped.get(id);
    if(previous)for(const member of previous.members)if(!visited.has(member.blockId))group.members.push({...member,order:group.members.length});
    grouped.set(id,group);
  }
  return[...grouped.values()].map((group)=>({...group,members:group.members.sort((left,right)=>left.order-right.order||left.blockId.localeCompare(right.blockId))})).sort((left,right)=>(left.depth??0)-(right.depth??0)||left.name.localeCompare(right.name)||left.id.localeCompare(right.id));
}

const roleBehavior=(role:CombinedContextRole)=>({
  character:"All appearance, wardrobe, prop, behavior, and reference decisions describe only this character.",location:"All environment, material, atmosphere, lighting, and activity decisions describe only this location.",object:"All shape, material, surface, marking, and handling decisions describe only this object or prop.",wardrobe:"All garment, palette, material, and styling decisions describe only this wardrobe system.",scene:"Treat the members as one scene unit rather than distributing them across unrelated scenes.",sequence:"Treat member order as binding chronology.",slide_chapter:"Assign the members to one slide or one contiguous slide chapter rather than distributing them deck-wide.",message:"Resolve the claim, audience, evidence, and tone together wherever this message appears.",visual_system:"Apply the members together as one visual system without assigning isolated pieces to unrelated subjects.",custom:"Apply every member only to the named target.",
}[role]);

const applicationBehavior=(application:CombinedContextApplication)=>({isolate:"Do not let any member affect unrelated targets.",co_locate:"Introduce, apply, and resolve these members at the same point.",ordered:"Preserve the listed member order.",recur:"If the group recurs, recur with the members together as the same recognizable unit."}[application]);

export function combinedContextPromptDirectives(snapshot:Record<string,unknown>,output:"image"|"video"|"audio"|"short_story"|"scene"|"slides"|"storyboard"="image"){
  return combinedContextGroups(snapshot).map((group,index)=>{
    const outputRule=output==="slides"?"Reserve one slide or a contiguous run of slides for this group; identify that assignment before drafting slide copy.":output==="audio"?"Keep this motif, emotional cue, instrumentation, and soundscape attached to its intended dramatic moment; preserve authored cue order and never leak it into unrelated scenes.":output==="short_story"||output==="scene"?"Keep these decisions at the same narrative moments, scene beats, or aspects of the named subject.":output==="video"||output==="storyboard"?"Keep these decisions together in the same shots or ordered shot range; preserve chronology when ordered.":"Bind these decisions to one visual target and prevent their attributes from spreading to other subjects or regions.";
    const members=group.members.map((member)=>`${member.order+1}. ${member.role}: ${member.path&&member.path.length>1?member.path.join(" > "):member.label} (${Math.round(member.relativity*100)}% relative)`).join(" | ");
    return `${index+1}. “${group.name}” targets ${group.role.replaceAll("_"," ")} “${group.target}” at ${Math.round(group.relativity*100)}% group relativity. ${roleBehavior(group.role)} ${applicationBehavior(group.application)} ${outputRule} Members: ${members}`;
  });
}
