export const MEMORY_FIELD_RESPONSE_BYTES=16_384;
/** A stalled/oversized private response cannot keep field controls occupied or
 * buffer arbitrary prose. The owner supplies its bounded operation deadline. */
export async function readMemoryFieldResponse(response:Response,signal:AbortSignal):Promise<unknown>{
 if(signal.aborted||!response.body||!response.headers.get('content-type')?.toLowerCase().includes('application/json'))throw Error('memory-field-response');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='',finished=false;
 let rejectAbort:(reason:Error)=>void=()=>{};
 const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
 const stop=()=>{rejectAbort(Error('memory-field-aborted'));void reader.cancel().catch(()=>{});};
 signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
 try{
  for(;;){const part=await Promise.race([reader.read(),aborted]);if(signal.aborted)throw Error('memory-field-aborted');if(part.done)break;
   bytes+=part.value.byteLength;if(bytes>MEMORY_FIELD_RESPONSE_BYTES)throw Error('memory-field-too-large');text+=decoder.decode(part.value,{stream:true});
  }
  text+=decoder.decode();const value:unknown=JSON.parse(text);finished=true;return value;
 }finally{signal.removeEventListener('abort',stop);if(!finished)void reader.cancel().catch(()=>{});reader.releaseLock();}
}
