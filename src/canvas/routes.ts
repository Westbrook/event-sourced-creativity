import type { CanvasView, ProjectCanvas } from "./model";

const pathOf=(value:string)=>new URL(value,"https://canvas.local").pathname.replace(/\/+$/,"")||"/";
export const canvasSlug=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,64)||"untitled-canvas";
export const canvasRoute=(canvas:Pick<ProjectCanvas,"id"|"name">)=>`/canvas/${encodeURIComponent(canvas.id)}/${canvasSlug(canvas.name)}`;
export function canvasIdFromRoute(value:string){const match=pathOf(value).match(/^\/canvas\/([^/]+)(?:\/[^/]+)?(?:\/view\/(?:spatial|list|compare|folders))?$/);if(!match||match[1]==="proposals")return null;try{return decodeURIComponent(match[1]);}catch{return match[1];}}
export function canvasProposalIdFromRoute(value:string){const match=pathOf(value).match(/^\/canvas\/proposals\/([^/]+)$/);if(!match)return null;try{return decodeURIComponent(match[1]);}catch{return match[1];}}
export function canvasViewFromRoute(value:string):CanvasView{const url=new URL(value,"https://canvas.local");const view=url.pathname.match(/\/view\/(spatial|list|compare|folders)$/)?.[1]??url.searchParams.get("view");return view==="list"||view==="compare"||view==="folders"?view:"spatial";}
export function withCanvasView(value:string,view:CanvasView){const url=new URL(value,"https://canvas.local");const base=url.pathname.replace(/\/view\/(?:spatial|list|compare|folders)$/," ").trim();url.pathname=view==="spatial"?base:`${base}/view/${view}`;url.searchParams.delete("view");return`${url.pathname}${url.search}${url.hash}`;}
export function canvasLensFromRoute(value:string){const url=new URL(value,"https://canvas.local");return{sort:url.searchParams.get("sort")??"authored",filter:url.searchParams.get("filter")??"all",seed:url.searchParams.get("seed")??""};}
export function withCanvasQuery(value:string,patch:Record<string,string|null>){const url=new URL(value,"https://canvas.local");for(const[key,next]of Object.entries(patch)){if(next&&next!=="authored"&&next!=="all")url.searchParams.set(key,next);else url.searchParams.delete(key);}return`${url.pathname}${url.search}${url.hash}`;}
