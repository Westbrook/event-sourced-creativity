/** Authenticates a bounded, source-free delivery request, never provider content. */
export const ORDINARY_IMAGE_QUEUE_PATH='/api/internal/ordinary-images';
const encoder=new TextEncoder();
async function key(secret:string){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function imageQueueRequest(origin:string,secret:string,action:'sweep'|'run',body:Record<string,unknown>,now=Date.now()){
  const url=new URL(`${ORDINARY_IMAGE_QUEUE_PATH}/${action}`,origin),text=JSON.stringify(body),timestamp=String(now);
  const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(`POST\n${url.pathname}\n${timestamp}\n${text}`));
  const hex=Array.from(new Uint8Array(signature),byte=>byte.toString(16).padStart(2,'0')).join('');
  return new Request(url,{method:'POST',headers:{'content-type':'application/json','x-image-queue-time':timestamp,'x-image-queue-signature':hex},body:text});
}
export async function verifyImageQueueRequest(request:Request,secret:string,now=Date.now()):Promise<Record<string,unknown>|null>{
  if(secret.length<32||request.method!=='POST')return null;
  const timestamp=request.headers.get('x-image-queue-time')??'',signature=request.headers.get('x-image-queue-signature')??'';
  if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60_000||!/^[a-f0-9]{64}$/.test(signature))return null;
  if(Number(request.headers.get('content-length')??0)>1024)return null;
  const reader=request.body?.getReader();if(!reader)return null;
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>1024)return null;chunks.push(part.value);}}
  finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const text=new TextDecoder().decode(bytes),sig=Uint8Array.from(signature.match(/../g)!,hex=>parseInt(hex,16));
  if(!await crypto.subtle.verify('HMAC',await key(secret),sig,encoder.encode(`POST\n${new URL(request.url).pathname}\n${timestamp}\n${text}`)))return null;
  try{const body=JSON.parse(text);return body&&typeof body==='object'&&!Array.isArray(body)?body:null;}catch{return null;}
}
