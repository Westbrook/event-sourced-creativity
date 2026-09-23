type ImageResponseLimits={signal?:AbortSignal;idleMilliseconds?:number;maximumBytes?:number;maximumMilliseconds?:number};
/** Limits apply to both JSON and SSE transports; cancellation never waits on the network. */
async function* imageResponseChunks(response:Response,options:ImageResponseLimits){
  if(!response.body)throw new Error('provider_returned_no_stream');
  const reader=response.body.getReader(),deadline=performance.now()+(options.maximumMilliseconds??600_000);
  let received=0;
  try{
    while(true){
      options.signal?.throwIfAborted();
      const remaining=deadline-performance.now();if(remaining<=0)throw new Error('image_response_deadline');
      let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
      const stopped=new Promise<never>((_,reject)=>{
        const idle=options.idleMilliseconds??300_000;
        timer=setTimeout(()=>reject(new Error(remaining<=idle?'image_response_deadline':'image_response_idle_timeout')),Math.min(remaining,idle));
        abort=()=>reject(options.signal?.reason??new Error('image_response_aborted'));
        options.signal?.addEventListener('abort',abort,{once:true});
      });
      let chunk:ReadableStreamReadResult<Uint8Array>;
      try{chunk=await Promise.race([reader.read(),stopped]);}
      finally{if(timer)clearTimeout(timer);if(abort)options.signal?.removeEventListener('abort',abort);}
      if(chunk.done)return;
      received+=chunk.value.byteLength;if(received>(options.maximumBytes??64*1024*1024))throw new Error('image_response_too_large');
      yield chunk.value;
    }
  }finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export async function readBoundedImageResponse(response:Response,options:ImageResponseLimits={}){
  const decoder=new TextDecoder('utf-8',{fatal:true});let text='';
  for await(const chunk of imageResponseChunks(response,options))text+=decoder.decode(chunk,{stream:true});
  return text+decoder.decode();
}
/** A final protocol event, not transport EOF, owns image completion. */
export async function readImageResponseStream<T>(response:Response,onEvent:(event:T,raw:string)=>Promise<boolean|void>,options:ImageResponseLimits={}){
  const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',terminal=false;
  const consume=async(eof=false)=>{
    // Accumulate first: a CR/LF pair may straddle reads.
    buffer=buffer.replaceAll('\r\n','\n');
    while(true){
      const boundary=buffer.indexOf('\n\n');if(boundary<0&&!eof)return;
      const block=boundary<0?buffer:buffer.slice(0,boundary);buffer=boundary<0?'':buffer.slice(boundary+2);
      const raw=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(raw&&raw!=='[DONE]'){
        let event:T;try{event=JSON.parse(raw) as T;}catch{throw new Error('provider_returned_invalid_stream_event');}
        if(await onEvent(event,raw)){terminal=true;return;}
      }
      if(boundary<0)return;
    }
  };
  for await(const chunk of imageResponseChunks(response,options)){
    buffer+=decoder.decode(chunk,{stream:true});await consume();if(terminal)return;
  }
  buffer+=decoder.decode();await consume(true);
  if(!terminal)throw new Error('provider_image_response_incomplete');
}
