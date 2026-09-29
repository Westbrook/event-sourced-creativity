import type { DecisionResponse } from './diagnostics.ts';
import { ApiError } from './client.ts';

/** Read-only decisions can arrive before optional enrichment. No mutation retry. */
export async function fetchDecision(body:Record<string,unknown>,onInitial?:(value:DecisionResponse)=>void,timeoutMs=30_000,signal?:AbortSignal):Promise<DecisionResponse>{
  const controller=new AbortController(),timer=timeoutMs>0?setTimeout(()=>controller.abort(),timeoutMs):undefined;
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let initial:DecisionResponse|undefined;
  try{
    const response=await fetch('/api/still/decision',{method:'POST',credentials:'same-origin',signal:controller.signal,
      headers:{'content-type':'application/json',...(onInitial?{accept:'application/x-ndjson'}:{})},body:JSON.stringify(body)});
    if(!response.ok)throw new ApiError(response.status,await response.json());
    if(!response.headers.get('content-type')?.includes('application/x-ndjson'))return await response.json();
    const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',final:DecisionResponse|undefined;
    const line=(raw:string)=>{
      if(!raw.trim())return;
      const message=JSON.parse(raw) as {stage:string;value:DecisionResponse;error?:string};
      if(message.stage==='error')throw new Error(message.error??'Decision interrupted');
      if(message.stage==='initial'){initial=message.value;onInitial?.(message.value);}
      if(message.stage==='complete')final=message.value;
    };
    try{for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
      if(buffer.length>2_000_000)throw new Error('Decision response too large');
      let end:number;while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}
      if(done){line(buffer);break;}
    }}finally{await reader.cancel().catch(()=>{});}
    if(!final)throw new Error('Decision interrupted');
    return final;
  }catch(error){
    // A valid first ranking stays useful if only the optional tail is interrupted.
    if(initial)return {...initial,delivery:{...initial.delivery!,stage:'initial',enrichment:'interrupted'}};
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
