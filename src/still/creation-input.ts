import type { CreationEntryKind, CreationMarker } from '../model/creation.ts';
import {richDocumentText,type RichDocument,type RichNode,type TokenRun} from './vendor/elements/rich-document.js';

/** Cues establish a conservative title candidate, never title intent by word count. */
const descriptivePredicate = /\b(?:is|are|was|were|be|being|been|has|have|had|does|do|did|can|cannot|should|must|will|would|could|may|might|shall|with|without|while|where|because|although|unless|until|include[sd]?|exclude[sd]?|show[sn]?|depicts?|sits?|stands?|walks?|waits?|runs?|moves?|looks?|faces?|turns?|opens?|closes?|holds?|carries|carry|places?|puts?|wears?|plays?|appears?|disappears?|leans?|rests?|sleeps?|smiles?|speaks?|says?|watches?|sees?|hears?|listens?|reaches?|touches?|crosses|cross|enters?|leaves?|follows?|fades?|glows?|shines?|reflects?|contains?|features?|surrounds?|frames?|balances?|destroys?|creates?|keeps?|remains?|becomes?|makes?|needs?|wants?|please|never|not)\b/iu;
const spatialDescription = /\b(?:beside|behind|between|beneath|underneath|across|towards?|through|into|onto|above|below|against|alongside)\b/iu;
// Transparent naming words retain common sentence-case titles, without accepting
// arbitrary lower-case prose merely because it lacks terminal punctuation.
const namingWords = new Set('the a an and or of for to in on at by from my our new old first second third final draft annual monthly weekly daily spring summer autumn fall winter project document idea notebook journal notes note album collection portfolio plan brief report research study studies sketch sketches board archive archives trip travel wedding vacation birthday'.split(' '));
export function classifyCreationInput(text:string, markers:readonly CreationMarker[] = []):'empty'|'title'|'description' {
  if(!text.trim())return 'empty';
  if(markers.length||creationMarkers(text).length||/[\r\n]/u.test(text)||/^\s*(?:[-*+]\s|\d+[.)]\s)/u.test(text)||/[.!?;:]/u.test(text))return 'description';
  if(descriptivePredicate.test(text)||spatialDescription.test(text)||/\b(?:playing|wearing|holding)\b/iu.test(text))return 'description';
  // Other languages and ambiguous sentence-case prose remain reviewable. The
  // user can explicitly choose Treat as title; no model is needed for that choice.
  if(/[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{M}]/u.test(text))return 'description';
  const words=text.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu)??[];
  if(!words.length)return 'description';
  return words.every(word=>/^\p{Lu}/u.test(word)||/^\p{N}/u.test(word)||namingWords.has(word.toLocaleLowerCase()))?'title':'description';
}
const commands=['/3D model','/short story','/presentation','/storyboard','/document','/project','/model3d','/image','/video','/audio','/slides','/scene','/idea'];
export function creationMarkers(text:string, previous:readonly CreationMarker[]=[]) {
  const result:CreationMarker[]=[];
  for(let i=0;i<text.length;i++){
    if(i&& !/[\s([{]/u.test(text[i-1]))continue;
    const command=commands.find(value=>text.slice(i,i+value.length).toLocaleLowerCase()===value.toLocaleLowerCase()&&(!text[i+value.length]||/[\s.,;:!?)}\]]/u.test(text[i+value.length])));
    const mention=text[i]==='@'?/^@[\p{L}\p{N}_][\p{L}\p{N}_'-]*/u.exec(text.slice(i))?.[0]:undefined;
    const found=command??mention;if(!found)continue;
    const old=previous.find(m=>m.start===i&&m.end===i+found.length&&m.text===text.slice(i,i+found.length));
    result.push({id:old?.id??crypto.randomUUID(),start:i,end:i+found.length,text:text.slice(i,i+found.length),kind:command?'command':old?.kind??'declaration',...(old?.targetId?{targetId:old.targetId}:{})});i+=found.length-1;
  }
  return result;
}
/** Token identity belongs to its exact occurrence, never another matching name. */
export function creationDocumentMarkers(document:RichDocument,scope:{draftId:string;projectId:string|null},previous:readonly CreationMarker[]=[]):CreationMarker[] {
  const text=richDocumentText(document);
  // A token changed to plain text is unresolved again, even at the same offset.
  let markers=creationMarkers(text,previous.map(({targetId:_targetId,...marker})=>({...marker,kind:marker.kind==='command'?'command':'declaration'})));
  let offset=0,firstBlock=true;
  const scan=(node:RichNode)=>{
    if(node.type==='paragraph'||node.type==='heading'){if(!firstBlock)offset++;firstBlock=false;}
    if(node.type==='text'){offset+=(node.text??'').length;return;}
    if(node.type==='hard_break'){offset++;return;}
    if(node.type==='token'){
      const run=node.attrs?.run as TokenRun,data=run.data as Record<string,unknown>|undefined,start=offset;offset+=run.text.length;
      let kind:CreationMarker['kind']|undefined,targetId:string|undefined;
      if(data?.schemaVersion===1&&run.type==='still-idea-reference'&&data.kind==='idea-reference'&&scope.projectId&&data.projectId===scope.projectId&&typeof data.blockId==='string'&&data.blockId){kind='reference';targetId=data.blockId;}
      if(data?.schemaVersion===1&&run.type==='still-creation-declaration'&&data.kind==='declaration'&&data.draftId===scope.draftId&&typeof data.targetId==='string'&&data.targetId.startsWith('temporary:')&&data.targetId.length>'temporary:'.length){kind='declaration';targetId=data.targetId;}
      if(kind){markers=markers.filter(marker=>marker.end<=start||marker.start>=offset);markers.push({id:run.id,start,end:offset,text:run.text,kind,targetId});}
      return;
    }
    node.content?.forEach(scan);
  };
  scan(document.doc);return markers.sort((a,b)=>a.start-b.start);
}
export function markerScopeProblem(markers:readonly CreationMarker[],entry:CreationEntryKind):string|undefined {
  const projects=markers.filter(m=>m.kind==='command'&&m.text.toLowerCase()==='/project');
  if(entry!=='project'&&projects.length)return '/project is available when creating a new Project. Keep this draft here or remove that marker.';
  if(entry==='idea'&&markers.some(m=>m.kind==='command'&&m.text.toLowerCase()==='/document'))return '/document is available when creating a Document. This draft can create Ideas and attach them to its current destination.';
  if(projects.length>1)return 'A new Project draft has one Project. Resolve the extra /project markers before continuing.';
}
