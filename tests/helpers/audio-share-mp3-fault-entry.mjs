import {projectSelectedOutputShareMp3} from '../../worker/selected-output-share-mp3-projection.ts';
const original=WebAssembly.Instance;
let mode='',injected=false,wasmMemory=null;
const audit={instances:0,allocations:0,frees:0,creates:0,destroys:0,reads:0};
WebAssembly.Instance=function(module,imports){
 audit.instances++;
 if(mode==='initialization'){injected=true;throw Error('synthetic_initialization_failure');}
 const real=new original(module,imports),e=real.exports,overrides={...e};wasmMemory=e.k;
 overrides.m=(size)=>{if(mode==='allocation'&&!injected){injected=true;return 0;}audit.allocations++;return e.m(size);};
 overrides.n=(pointer)=>{audit.frees++;return e.n(pointer);};
 overrides.p=(...args)=>{audit.creates++;const value=e.p(...args);if(mode==='constructor'&&!injected){injected=true;return 1;}return value;};
 overrides.s=(pointer)=>{audit.destroys++;return e.s(pointer);};
 overrides.q=(...args)=>{if(mode==='feed-trap'&&!injected){injected=true;throw new WebAssembly.RuntimeError('synthetic_trap');}if(mode==='feed'&&!injected){injected=true;return 1;}return e.q(...args);};
 overrides.r=(...args)=>{
  audit.reads++;if(mode==='read-trap'&&!injected){injected=true;throw new WebAssembly.RuntimeError('synthetic_trap');}
  if(mode==='no-progress'&&!injected){const view=new Uint32Array(e.k.buffer);view[args[3]/4]=0;if(audit.reads===4)injected=true;return 0;}
  const result=e.r(...args),words=new Uint32Array(e.k.buffer),length=words[args[3]/4];
  if(length&&!injected&&['overshoot','nonfinite','clock','sample-cap'].includes(mode)){
   if(mode==='overshoot')new Float32Array(e.k.buffer)[args[1]/4]=1.5;
   if(mode==='nonfinite')new Float32Array(e.k.buffer)[args[1]/4]=NaN;
   if(mode==='clock')words[args[4]/4]=32000;
   if(mode==='sample-cap')words[args[3]/4]=100000;
   injected=true;
  }
  return result;
 };
 return {exports:overrides};
};
export default {async fetch(request){
 mode=new URL(request.url).pathname.slice(1);
 const bytes=new Uint8Array(await request.arrayBuffer()),facts={sha256:request.headers.get('x-sha256'),byteLength:bytes.length,mimeType:'audio/mpeg',recipe:'forma.audio.instrumental-20@1'};
 const first=await projectSelectedOutputShareMp3(bytes,facts,new AbortController().signal),firstAudit={...audit},quarantinedHeapZero=wasmMemory?new Uint8Array(wasmMemory.buffer).every(x=>x===0):null;
 mode='';const second=await projectSelectedOutputShareMp3(bytes,facts,new AbortController().signal);
 return Response.json({first,second,firstAudit,audit,injected,quarantinedHeapZero});
}};
