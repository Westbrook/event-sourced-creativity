import type {RichDocument,RichNode,TokenRun} from './vendor/elements/rich-document.js';
import type {EditorChoice} from './vendor/elements/editor/extensions.js';

/** Suggestions come from explicit, currently retained declarations, never name inference. */
export function draftIdeaChoices(document:RichDocument,draftId:string,query:string,description:string):EditorChoice[]{
  const targets=new Set<string>(),choices:EditorChoice[]=[];
  const needle=query.trim().toLocaleLowerCase();
  const visit=(node:RichNode)=>{
    const run=node.attrs?.run as TokenRun|undefined;
    const data=run?.data as Record<string,unknown>|undefined;
    if(node.type==='token'&&run?.type==='still-creation-declaration'&&data?.schemaVersion===1&&data.kind==='declaration'&&data.draftId===draftId&&typeof data.targetId==='string'&&data.targetId.startsWith('temporary:')&&data.targetId.length>'temporary:'.length&&!targets.has(data.targetId)){
      targets.add(data.targetId);
      const label=(run.label||run.text.replace(/^@/u,'')).trim();
      if(label&&label.toLocaleLowerCase().includes(needle))choices.push({
        id:`draft:${data.targetId}`,label,description,
        insert:[{...run,id:crypto.randomUUID(),data:{schemaVersion:1,kind:'declaration',draftId,targetId:data.targetId}}],
      });
    }
    node.content?.forEach(visit);
  };
  visit(document.doc);
  return choices.slice(0,20);
}
