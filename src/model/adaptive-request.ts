import type { DocumentJob } from "./document-jobs.ts";

export function adaptiveRequestLocale(value:unknown):string{
  try{const locale=Intl.getCanonicalLocales(typeof value==="string"?value:"en")[0]||"en";return /^(?:en|fr|ar|ja)(?:-|$)/i.test(locale)?locale:"en";}catch{return"en";}
}

// Request identity is not consent. The server separately binds current source and authority.
export async function adaptiveRequestKey(input:{projectId:string;documentId:string;canvasId?:unknown;sourceSurface:string;projectScope?:unknown;locale?:unknown;prompt:unknown}):Promise<string>{
  const request={version:"adaptive-request-v1",projectId:input.projectId,documentId:input.documentId,canvasId:typeof input.canvasId==="string"?input.canvasId.trim()||null:null,sourceSurface:input.sourceSurface.slice(0,80)||"studio",projectScope:input.projectScope===true,locale:adaptiveRequestLocale(input.locale),prompt:String(input.prompt??"").trim()};
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(request)));
  return`adaptive:${Array.from(new Uint8Array(hash),(byte)=>byte.toString(16).padStart(2,"0")).join("")}`;
}

export function adaptiveJobMatchesRequest(job:DocumentJob,expected:{documentId:string;canvasId:string|null;sourceSurface:string;requestKey:string}):boolean{
  return job.kind==="structure_adaptive"&&job.documentId===expected.documentId&&(job.canvasId??null)===expected.canvasId&&job.sourceSurface===expected.sourceSurface&&job.requestKey===expected.requestKey;
}
