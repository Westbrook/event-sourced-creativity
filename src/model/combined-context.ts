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
  members: Array<{ blockId:string; label:string; role:string; relativity:number; order:number }>;
};

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
  const facts=(Array.isArray(snapshot.facts)?snapshot.facts:[]).map(record).filter((fact)=>fact.active!==false);const grouped=new Map<string,CombinedContextGroup>();
  for(const fact of facts){const properties=record(fact.properties);for(const membership of combinedContextMemberships(properties)){const existing=grouped.get(membership.contextSetId)??{id:membership.contextSetId,name:membership.name,role:membership.role,target:membership.target,application:membership.application,relativity:membership.relativity,members:[]};existing.relativity=Math.max(existing.relativity,membership.relativity);existing.members.push({blockId:String(fact.block_id??""),label:factLabel(fact),role:String(fact.role??fact.type??"decision"),relativity:membership.relativity,order:membership.memberOrder});grouped.set(membership.contextSetId,existing);}}
  return[...grouped.values()].map((group)=>({...group,members:group.members.sort((left,right)=>left.order-right.order||left.blockId.localeCompare(right.blockId))})).sort((left,right)=>left.name.localeCompare(right.name)||left.id.localeCompare(right.id));
}

const roleBehavior=(role:CombinedContextRole)=>({
  character:"All appearance, wardrobe, prop, behavior, and reference decisions describe only this character.",location:"All environment, material, atmosphere, lighting, and activity decisions describe only this location.",object:"All shape, material, surface, marking, and handling decisions describe only this object or prop.",wardrobe:"All garment, palette, material, and styling decisions describe only this wardrobe system.",scene:"Treat the members as one scene unit rather than distributing them across unrelated scenes.",sequence:"Treat member order as binding chronology.",slide_chapter:"Assign the members to one slide or one contiguous slide chapter rather than distributing them deck-wide.",message:"Resolve the claim, audience, evidence, and tone together wherever this message appears.",visual_system:"Apply the members together as one visual system without assigning isolated pieces to unrelated subjects.",custom:"Apply every member only to the named target.",
}[role]);

const applicationBehavior=(application:CombinedContextApplication)=>({isolate:"Do not let any member affect unrelated targets.",co_locate:"Introduce, apply, and resolve these members at the same point.",ordered:"Preserve the listed member order.",recur:"If the group recurs, recur with the members together as the same recognizable unit."}[application]);

export function combinedContextPromptDirectives(snapshot:Record<string,unknown>,output:"image"|"video"|"short_story"|"scene"|"slides"|"storyboard"="image"){
  return combinedContextGroups(snapshot).map((group,index)=>{
    const outputRule=output==="slides"?"Reserve one slide or a contiguous run of slides for this group; identify that assignment before drafting slide copy.":output==="short_story"||output==="scene"?"Keep these decisions at the same narrative moments, scene beats, or aspects of the named subject.":output==="video"||output==="storyboard"?"Keep these decisions together in the same shots or ordered shot range; preserve chronology when ordered.":"Bind these decisions to one visual target and prevent their attributes from spreading to other subjects or regions.";
    const members=group.members.map((member)=>`${member.order+1}. ${member.role}: ${member.label} (${Math.round(member.relativity*100)}% relative)`).join(" | ");
    return `${index+1}. “${group.name}” targets ${group.role.replaceAll("_"," ")} “${group.target}” at ${Math.round(group.relativity*100)}% group relativity. ${roleBehavior(group.role)} ${applicationBehavior(group.application)} ${outputRule} Members: ${members}`;
  });
}
