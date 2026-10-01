import type { CreativeProjection } from '../model/events.ts';
import type { Position } from './decisions.ts';

export const STILL_FORMATS = ['image','short_story','scene','slides','storyboard','video','audio','model3d'] as const;
// Addresses open views/forms only. Mutations such as lock, export, save, or generate
// are deliberately absent: visiting a link is never an instruction to execute one.
export const STILL_MODES = ['actions','workspaces','new-project','new-document','add-context','edit-block','rename','intent','user-settings','edit-artifact','use-in','reuse','split-context','research-context','find-references','supply-reference','compose','clarify'] as const;
export type StillRoute = Pick<Position,'projectId'|'documentId'|'blockId'|'outputId'|'view'> & { itemIndex:number; page:number; mode:string; format:string; legacy?:boolean; itemExplicit?:boolean };
const empty = ():StillRoute => ({projectId:'',documentId:'',blockId:'',outputId:'',view:'projects',itemIndex:0,page:0,mode:'',format:''});
// IDs reject path separators and control characters after decoding.
// eslint-disable-next-line no-control-regex
const id = (value:string) => { try {const decoded=decodeURIComponent(value);return decoded&&decoded.length<=180&&!/[\u0000-\u001f\u007f/\\]/u.test(decoded)&&!['.','..'].includes(decoded)?decoded:null;}catch{return null;} };
const index = (value:string) => /^[1-9]\d{0,5}$/.test(value)?Number(value)-1:null;
export function isStillNamespace(pathname:string){return pathname==='/still'||pathname==='/still.html'||pathname.startsWith('/still/');}

export function parseStillRoute(value:string|URL):StillRoute|null {
  const url=value instanceof URL?value:new URL(value,'https://still.local');
  const path=url.pathname.replace(/\/+$/,'');
  if(!isStillNamespace(url.pathname))return null;
  const route=empty();
  if(path==='/still'||path==='/still.html'){
    const keys=['project','document','work'];
    if(keys.some(k=>url.searchParams.getAll(k).length>1))return null;
    // URLSearchParams has already decoded legacy IDs; validate without decoding twice.
    for(const [key,target] of [['project','projectId'],['document','documentId'],['work','outputId']] as const){
      const value=url.searchParams.get(key);
      if(value!==null){if(!id(encodeURIComponent(value)))return null;route[target]=value;route.legacy=true;}
    }
    if(route.outputId&&!route.documentId)return null;
    route.view=route.outputId?'artifact':route.documentId?'document':route.projectId?'documents':'projects';
    return route;
  }
  const parts=path.slice('/still/'.length).split('/');let i=0;
  if(parts[i]==='project'){
    const project=id(parts[++i]??'');if(!project)return null;route.projectId=project;route.view='documents';i++;
    if(parts[i]==='ideas'){route.view='ideas';i++;if(parts[i]==='block'){const block=id(parts[++i]??'');if(!block)return null;route.blockId=block;i++;}}
    else if(parts[i]==='document'){
      const document=id(parts[++i]??'');if(!document)return null;route.documentId=document;route.view='document';i++;
      if(parts[i]==='block'){
        const block=id(parts[++i]??'');if(!block)return null;route.blockId=block;i++;
      }else if(parts[i]==='results'){route.view='results';i++;}
      else if(parts[i]==='generation'){
        const job=id(parts[++i]??'');if(!job)return null;route.outputId=job;route.view='generation';i++;
        if(parts[i]==='rejection'){route.view='rejection';i++;}
      }
      else if(parts[i]==='result'){
        const result=id(parts[++i]??'');if(!result)return null;route.outputId=result;route.view='artifact';i++;
        if(parts[i]==='item'){const item=index(parts[++i]??'');if(item===null||item>1000)return null;route.itemIndex=item;route.itemExplicit=true;i++;}
      }
    }
  }
  if(parts[i]==='page'){
    if(!['projects','documents','ideas','results','document'].includes(route.view)||!!route.blockId)return null;
    const page=index(parts[++i]??'');if(page===null)return null;route.page=page;i++;
  }
  if(parts[i]==='create'){
    if(!route.documentId)return null;route.mode='generate';i++;
    if(parts[i]){if(!STILL_FORMATS.includes(parts[i] as typeof STILL_FORMATS[number]))return null;route.format=parts[i++];}
  }else if(parts[i]==='action'){
    const requestedMode=parts[++i];
    const mode=requestedMode==='surprise'?'add-context':requestedMode;if(!STILL_MODES.includes(mode as typeof STILL_MODES[number]))return null;
    route.mode=mode;i++;
  }
  if(i!==parts.length)return null;
  return route;
}

export function stillPath(route:StillRoute):string {
  let path='/still';
  const encode=(value:string)=>{if(!id(encodeURIComponent(value)))throw new Error('Invalid Still address');return encodeURIComponent(value);};
  if(route.projectId)path+=`/project/${encode(route.projectId)}`;
  if(route.view==='ideas'){if(!route.projectId||route.documentId)throw new Error('Ideas address requires a project');path+='/ideas';if(route.blockId)path+=`/block/${encode(route.blockId)}`;}
  if(route.documentId){
    if(!route.projectId)throw new Error('Document address requires its project');
    path+=`/document/${encode(route.documentId)}`;
    if(route.view==='artifact'){
      path+=`/result/${encode(route.outputId)}`;
      if(route.itemIndex)path+=`/item/${route.itemIndex+1}`;
    }else if(['generation','rejection'].includes(route.view))path+=`/generation/${encode(route.outputId)}${route.view==='rejection'?'/rejection':''}`;
    else if(route.view==='results')path+='/results';
    else if(route.blockId)path+=`/block/${encode(route.blockId)}`;
  }
  if(route.page)path+=`/page/${route.page+1}`;
  if(route.mode==='generate')path+=`/create${route.format?`/${route.format}`:''}`;
  else if(route.mode)path+=`/action/${route.mode==='surprise'?'add-context':route.mode}`;
  if(!parseStillRoute(path))throw new Error('Invalid Still address');
  return path;
}
export function stillURL(route:StillRoute,current:string|URL):string {
  const url=new URL(String(current),'https://still.local');url.pathname=stillPath(route);
  for(const key of ['project','document','work'])url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

// foldEvents may infer a document's project. Check the requested ownership chain
// explicitly so a conflicting path cannot silently select another project.
export function stillRouteProblem(route:StillRoute,p:CreativeProjection,resultCount?:number):string {
  if(route.projectId&&!p.projects.some(x=>x.id===route.projectId))return 'Project unavailable';
  if(route.documentId&&!p.documents.some(x=>x.id===route.documentId&&x.projectId===route.projectId&&!x.removed))return 'Document unavailable';
  if(route.blockId&&!(route.view==='ideas'?p.libraryBlocks:p.blocks).some(x=>x.id===route.blockId&&(route.view==='ideas'||x.documentId===route.documentId)&&x.projectId===route.projectId&&!x.removed))return 'Idea unavailable';
  const artifact=p.artifacts.find(x=>x.id===route.outputId&&x.documentId===route.documentId);
  // Generation membership is checked against the authorized jobs endpoint by the view.
  if(!['generation','rejection'].includes(route.view)&&route.outputId&&!artifact&&!p.outputs.some(x=>x.id===route.outputId&&x.documentId===route.documentId&&!x.discarded))return 'Result unavailable';
  if((route.itemIndex||route.itemExplicit)&&(!artifact||!['slides','storyboard'].includes(artifact.kind)||!artifact.items[route.itemIndex]))return 'Item unavailable';
  const count=route.view==='projects'?p.projects.length:route.view==='documents'?p.documents.filter(d=>!d.removed).length:route.view==='ideas'?p.libraryBlocks.length:route.view==='document'?p.blocks.filter(b=>!b.removed).length:resultCount??p.outputs.filter(o=>!o.discarded).length+p.artifacts.length;
  if(route.page&&route.page*3>=count)return 'Page unavailable';
  return '';
}
