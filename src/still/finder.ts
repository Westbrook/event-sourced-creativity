import type { Action } from './decisions.ts';
export const UTILITIES=[{id:'ui:workspaces',label:'Workspaces'},{id:'ui:refresh',label:'Refresh'},{id:'ui:developer',label:'Developer console'}];
const terms:Record<string,string[]>={model3d:['3d','mesh','three dimensional'],image:['image','picture','illustration'],short_story:['story','fiction'],scene:['scene'],slides:['slides','presentation'],storyboard:['storyboard'],video:['video','motion','movie'],audio:['audio','sound','music'],'use-in':['add this to','use in','attach to','give to','put this in','connect to'],'split-context':['split','break into','smaller pieces'],surprise:['another use','unexpected','variation','surprise'],'research-context':['research','investigate','learn more'],'find-references':['reference','reference images'],compose:['arrange','recompose','combine'],intent:['direction','goal']};
export function findActions(query:string,candidates:Action[]){
  const q=query.trim().toLowerCase();
  if(!q)return [...candidates,...UTILITIES];
  const matches=[...candidates,...UTILITIES].filter(a=>`${a.label} ${a.id}`.toLowerCase().includes(q)||(terms[a.id]??[]).some(term=>q.includes(term)));
  return [...matches,...[...candidates,...UTILITIES].filter(a=>!matches.some(m=>m.id===a.id))];
}
export function explicitAction(query:string,candidates:Action[]):string{
  const q=query.trim().toLowerCase();if(!q)return '';
  const exact=candidates.find(a=>[a.id,a.label.toLowerCase()].includes(q));if(exact)return exact.id;
  if(/\b(not|never|don't|instead|or|and|without)\b/.test(q))return '';
  if(/^(?:add|attach|give|connect) (?:this|it) to .+$|^use (?:this|it) in .+$/.test(q))return candidates.some(a=>a.id==='use-in')?'use-in':'';
  const command=q.match(/^(?:(?:make|create|generate|render|write) (?:(?:this|it|an?|the) )?(?:as |into )?)?(3d(?: model)?|three dimensional(?: model)?|image|picture|illustration|short story|story|scene|slides|presentation|storyboard|video|audio)$/);
  if(!command)return '';
  const match=Object.entries(terms).find(([id,aliases])=>['model3d','image','short_story','scene','slides','storyboard','video','audio'].includes(id)&&aliases.some(term=>command[1]===term||command[1]===`${term} model`));
  return match&&candidates.some(a=>a.id===match[0])?match[0]:'';
}
// An inferred action opens a view or review. It never performs a mutation/download.
export function finderEntry(id:string){return ['lock','unlock','toggle-context'].includes(id)?'context':id==='export'?'view-result':id;}
