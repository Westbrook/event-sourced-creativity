/** General bounded transport; contains no feature authority or Memory behavior. */
export class CreationProviderError extends Error {
  constructor(readonly code:string, readonly retryAfterMs=0, readonly held=false){super(code);}
}
export async function withinSignal<T>(operation:Promise<T>, signal:AbortSignal):Promise<T>{
  if(signal.aborted){void operation.catch(()=>{});signal.throwIfAborted();}
  let abort:()=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason??new Error('creation_deadline'));signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([operation,cancelled]);}finally{signal.removeEventListener('abort',abort);}
}
export async function readProviderJSON(response:Response,limit=100_000,signal?:AbortSignal):Promise<unknown>{
  if(!response.ok){void response.body?.cancel();const retry=response.headers.get('retry-after');const ms=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):0;throw new CreationProviderError('provider_http_'+response.status,Math.min(900000,Math.max(0,ms||0)),[400,401,403,404].includes(response.status));}
  const reader=response.body?.getReader();if(!reader)throw new CreationProviderError('provider_empty');
  const parts:Uint8Array[]=[];let size=0;
  try{for(;;){const next=reader.read();const {done,value}=signal?await withinSignal(next,signal):await next;if(done)break;size+=value.byteLength;if(size>limit)throw new CreationProviderError('provider_response_budget',0,true);parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new CreationProviderError('provider_json_invalid',0,true);}}
  finally{void reader.cancel().catch(()=>{});}
}
export async function creationHTTP(key:string,project:string|undefined,path:'embeddings'|'responses',body:unknown,signal:AbortSignal,limit:number){
  const encoded=JSON.stringify(body);if(new TextEncoder().encode(encoded).length>1_000_000)throw new CreationProviderError('provider_request_budget',0,true);
  const response=await withinSignal(fetch('https://api.openai.com/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json',...(project?{'OpenAI-Project':project}:{})},body:encoded,signal}),signal);
  return readProviderJSON(response,limit,signal);
}
