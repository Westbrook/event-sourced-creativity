import type { CreativeProjection } from '../model/events.ts';
import type { DocumentJob } from '../model/document-jobs.ts';
import { parseStillRoute } from './routes.ts';
import { generationFormat } from './results.ts';

const formats:Record<string,string>={image:'Image',short_story:'Short story',scene:'Scene',slides:'Presentation',storyboard:'Storyboard',video:'Video',audio:'Audio',model3d:'3D model'};
const actions:Record<string,string>={actions:'All actions',workspaces:'Workspaces','new-project':'New project','new-document':'New document','add-context':'Add idea','edit-block':'Edit idea',rename:'Rename document',intent:'Set next goal','edit-artifact':'Edit result','use-in':'Use idea in document',reuse:'Use existing idea','split-context':'Split idea','research-context':'Research idea','find-references':'Find reference','supply-reference':'Supply reference',compose:'Arrange ideas',surprise:'Add idea',clarify:'Clarify idea'};
const clean=(value:unknown,limit=80)=>typeof value==='string'?value.replace(/\s+/gu,' ').trim().slice(0,limit):'';
const join=(...parts:unknown[])=>[...parts.map(p=>clean(p)).filter(Boolean),'Still'].join(' · ');

/** Derive titles from the addressed records, never the projection's fallback selection. */
export function stillPageTitle(address:string,p?:CreativeProjection,jobs:readonly DocumentJob[]=[],problem=''):string {
 const route=parseStillRoute(address);
 if(!route)return join('Page not found');
 if(problem)return join(problem);
 const project=p?.projects.find(x=>x.id===route.projectId);
 const doc=p?.documents.find(x=>x.id===route.documentId&&x.projectId===route.projectId&&!x.removed);
 const block=route.view==='ideas'?p?.libraryBlocks.find(x=>x.id===route.blockId&&x.projectId===route.projectId&&!x.removed):doc?p?.blocks.find(x=>x.id===route.blockId&&x.documentId===doc.id&&x.projectId===route.projectId&&!x.removed):undefined;
 const label=clean(block?.properties.label)||clean(block?.handle);
 // Generic historical labels do not distinguish ideas; the existing text does.
 const generic=!label||label===block?.type||label.toLowerCase()===`${block?.type}/${block?.type}`||['something','a thought','subject','style','idea'].includes(label.toLowerCase());
 const idea=block?(generic?clean(block.properties.text||block.properties.description,60)||label:label):'';
 const scope=idea||clean(doc?.title)||clean(project?.name);
 if(route.mode==='generate')return join(route.format?`Create ${formats[route.format]?.toLowerCase()||'output'}`:'Choose output',scope);
 if(route.mode)return join(actions[route.mode]||'Action',route.mode==='new-project'||route.mode==='workspaces'?'':scope);
 const page=route.page?`Page ${route.page+1}`:'';
 if(route.view==='projects')return join('Projects',page);
 if(route.view==='documents')return join('Documents',project?.name,page);
 if(route.view==='ideas')return join(route.blockId?idea||'Idea':'Ideas',project?.name,page);
 if(route.view==='results')return join('Results',doc?.title,page);
 if(route.view==='rejection')return join('Inspect generation failure',doc?.title);
 if(route.view==='generation'){
  const job=doc?jobs.find(j=>j.jobId===route.outputId&&j.documentId===doc.id):undefined;
  const format=job?formats[generationFormat(job)]||'Generation':'Generation';
  return join(`${format} request`,clean((job?.result?.artifactPlan as {title?:unknown}|undefined)?.title)||doc?.title);
 }
 if(route.view==='artifact'){
  const artifact=doc?p?.artifacts.find(x=>x.id===route.outputId&&x.documentId===doc.id):undefined;
  const output=doc?p?.outputs.find(x=>x.id===route.outputId&&x.documentId===doc.id&&!x.discarded):undefined;
  const kind=artifact?formats[artifact.kind]||'Result':output?'Image':'Result';
  if(artifact&&['slides','storyboard'].includes(artifact.kind))return join(`${artifact.kind==='slides'?'Slide':'Frame'} ${route.itemIndex+1}`,artifact.items[route.itemIndex]?.title||artifact.title,doc?.title);
  return join(kind,artifact?.title||output?.title||doc?.title);
 }
 if(route.blockId)return join(idea||'Idea',doc?.title);
 return join(doc?.title||'Document',page);
}
