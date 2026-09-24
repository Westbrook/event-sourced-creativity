/** Exact, user-selected reuse passages. This layer never resolves a spelling or guesses covered meaning. */
import type {CreativeBlock} from '../model/events.ts';
import type {Decision,DependencyVersion,ReferenceSelection} from '../model/creation.ts';
import {decodeIdeaBody,ideaBodyText} from '../model/idea-body.ts';
import type {RichRange,RichRangeDecoration,RichRangeReplacement} from './vendor/elements/rich-text-editor.js';
import {richDocumentFromRuns,richDocumentText,type TokenRun,type RichDocument,type RichNode} from './vendor/elements/rich-document.js';

type Run=TokenRun|{kind:'text';text:string};
export interface CreationReplacementEditor {
 readonly revision:number;
 readonly document:RichDocument;
 captureRange():RichRange|undefined;
 validateRange(range:RichRange):boolean;
 decorateRanges(decorations:readonly RichRangeDecoration[]):boolean;
 clearRangeDecorations():void;
 replaceRanges(replacements:readonly RichRangeReplacement[]):boolean;
}
/** En Reve permits whole-token edits. Still's passage reuse must preserve existing identities. */
export function isCreationReplacementRangeValid(editor:Pick<CreationReplacementEditor,'document'|'validateRange'>,range:RichRange):boolean {
 if(!editor.validateRange(range))return false;
 let textOffset=0,structuredOffset=0,firstBlock=true,overlaps=false;
 const visit=(node:RichNode)=>{
  if(node.type==='paragraph'||node.type==='heading'){if(!firstBlock)textOffset++;firstBlock=false;}
  if(node.type==='token'){
   const length=(node.attrs!.run as TokenRun).text.length;
   const start=range.coordinate==='text'?textOffset:structuredOffset;
   const end=start+(range.coordinate==='text'?length:1);
   if(range.from<end&&range.to>start)overlaps=true;
   textOffset+=length;structuredOffset++;
  }else if(node.type==='text'){
   textOffset+=node.text!.length;structuredOffset+=node.text!.length;
  }else if(node.type==='hard_break'){
   textOffset++;structuredOffset++;
  }else{
   if(node.type!=='doc')structuredOffset++;
   node.content?.forEach(visit);
   if(node.type!=='doc')structuredOffset++;
  }
 };
 visit(editor.document.doc);
 return !overlaps;
}
export interface CreationReplacementSource {readonly id:string;readonly title:string;readonly text:string;readonly revision:string;readonly hash:string;readonly root:boolean;}
export interface CreationReplacementPreview {
 readonly id:string;readonly draftId:string;readonly draftRevision:number;readonly projectId:string;
 readonly range:RichRange;readonly passage:string;readonly remainingText:string;readonly resultingText:string;
 readonly rootIds:readonly string[];readonly sources:readonly CreationReplacementSource[];readonly runs:readonly Run[];
}
function frozen<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
function sameVersion(source:{id:string;revision:string;hash:string},current:DependencyVersion|undefined,projectId:string){return !!current&&current.projectId===projectId&&source.id===current.id&&source.revision===current.revision&&source.hash===current.hash;}
/** Sources must come from the server's read-only /use-preview, scoped and freshly authorized. */
export function prepareCreationReplacement(editor:CreationReplacementEditor,options:{draftId:string;draftRevision:number;projectId:string;selection:ReferenceSelection;sourceBodies:readonly CreativeBlock[];range?:RichRange;remainingText?:string}):CreationReplacementPreview {
 const range=options.range??editor.captureRange();
 if(!range||!isCreationReplacementRangeValid(editor,range))throw new Error('Select the exact draft text or place the caret where these references should go. The passage must not cross an existing reference.');
 const selection=options.selection;
 if(!options.projectId||selection.projectId!==options.projectId||!selection.rootIds.length||selection.sources.some(source=>source.projectId!==options.projectId))throw new Error('Use is available only for authorized Ideas in this Project.');
 if(new Set(selection.rootIds).size!==selection.rootIds.length||new Set(selection.sources.map(source=>source.id)).size!==selection.sources.length)throw new Error('The source preview contains duplicate identities. Refresh it.');
 const sources=selection.sources.map(version=>{
  const block=options.sourceBodies.find(block=>block.id===version.id&&!block.removed&&block.projectId===options.projectId);
  if(!block||!version.revision||!version.hash)throw new Error('Included source content is unavailable. Refresh the source preview.');
  const text=block.properties.rich_text_body?ideaBodyText(decodeIdeaBody(block.properties.rich_text_body)):String(block.properties.text??'');
  if(!text.trim())throw new Error('Included source content is incomplete. Open its original location.');
  return {id:block.id,title:String(block.properties.label??block.handle),text,revision:version.revision,hash:version.hash,root:selection.rootIds.includes(block.id)};
 });
 if(selection.rootIds.some(id=>!sources.some(source=>source.id===id)))throw new Error('A selected source is missing from its authorized dependency preview.');
 // Retain every original qualification by default. Reductions are explicit user corrections, never inferred overlap.
 const remainingText=options.remainingText??range.expectedText,runs:Run[]=[];
 if(remainingText)runs.push({kind:'text',text:remainingText});
 for(const id of selection.rootIds){const source=sources.find(source=>source.id===id)!;
  if(runs.length&&!/\s$/u.test(runs.at(-1)!.text))runs.push({kind:'text',text:' '});
  runs.push({kind:'token',id:crypto.randomUUID(),type:'still-idea-reference',text:`@${source.title}`,label:source.title,data:{schemaVersion:1,kind:'idea-reference',projectId:options.projectId,blockId:id}});
 }
 if(range.from===range.to)runs.push({kind:'text',text:' '});
 return frozen({id:crypto.randomUUID(),draftId:options.draftId,draftRevision:options.draftRevision,projectId:options.projectId,range:{...range},passage:range.expectedText,remainingText,resultingText:richDocumentText(richDocumentFromRuns(runs)),rootIds:[...selection.rootIds],sources,runs});
}
export function decorateCreationReplacements(editor:CreationReplacementEditor,previews:readonly CreationReplacementPreview[]):boolean {
 return editor.decorateRanges(previews.map(preview=>({id:preview.id,range:preview.range})));
}
/** Fresh /use acceptance must bind expectedSources to the preview before calling this local transaction. */
export function acceptCreationReplacements(editor:CreationReplacementEditor,previews:readonly CreationReplacementPreview[],currentSelection:ReferenceSelection|readonly ReferenceSelection[]):Decision[] {
 if(!previews.length)throw new Error('Choose a passage or insertion point before accepting references.');
 const selections=Array.isArray(currentSelection)?currentSelection:[currentSelection as ReferenceSelection];
 const versions=selections.flatMap(selection=>selection.sources),rootIds=new Set(selections.flatMap(selection=>selection.rootIds));
 if(previews.some(preview=>preview.draftId!==previews[0].draftId||preview.projectId!==previews[0].projectId||preview.rootIds.some(id=>!rootIds.has(id))||preview.sources.some(source=>!sameVersion(source,versions.find(version=>version.id===source.id),preview.projectId))))throw new Error('The included source or dependencies changed. Refresh the preview and review them again.');
 if(previews.some(preview=>!isCreationReplacementRangeValid(editor,preview.range)))throw new Error('The draft passage changed or includes an existing reference. Select and review its current text again.');
 if(!editor.replaceRanges(previews.map(preview=>({range:preview.range,runs:preview.runs}))))throw new Error('Passages overlap, include a reference, or changed during review. Resolve them before applying.');
 editor.clearRangeDecorations();
 return previews.map(preview=>({id:crypto.randomUUID(),kind:'correction',nodeIds:[...preview.rootIds],revision:preview.draftRevision,accepted:true,...(preview.range.coordinate==='text'?{sourceRanges:[{start:preview.range.from,end:preview.range.to}]}:{}),detail:JSON.stringify({kind:'reviewed-reference-replacement',previewId:preview.id,range:preview.range,passage:preview.passage,remainingText:preview.remainingText,resultingText:preview.resultingText,sourceVersions:preview.sources.map(({id,revision,hash})=>({id,revision,hash}))})}));
}

/** Offer only an exact, unique source-backed passage; acceptance is always explicit. */
export function suggestCreationReplacementRange(editor:CreationReplacementEditor,sources:readonly CreativeBlock[]):RichRange|undefined{
 const text=richDocumentText(editor.document);
 const phrases=[...sources.flatMap(b=>{const body=String(b.properties.text??'');return [body,...body.split(/(?<=[.!?])\s+/u),...(text.length>=12&&body.includes(text)?[text]:[])];})].filter(s=>s.length>=12).sort((a,b)=>b.length-a.length);
 for(const phrase of phrases){const from=text.indexOf(phrase);if(from<0||text.indexOf(phrase,from+1)>=0)continue;const range:RichRange={coordinate:'text',from,to:from+phrase.length,expectedText:phrase,revision:editor.revision};if(isCreationReplacementRangeValid(editor,range))return range;}
}
