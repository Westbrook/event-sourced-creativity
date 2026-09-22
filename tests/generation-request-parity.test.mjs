import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { generateCreativeDirection, generateCreativeImage } from '../worker/openai-adapter.ts';
const baseline='1587f9067162e38ce437d9cf443faf5620b388ae';
const pass=()=>Response.json({results:[{flagged:false,categories:{}}]});
const usage={input_tokens:1,output_tokens:2,total_tokens:3};

test('reviewed HEAD request builders match current JSON bytes, multipart fields/pixels and retry loop',async()=>{
  const root=new URL('../',import.meta.url),file=new URL(`worker/.request-parity-${crypto.randomUUID()}.ts`,root);
  const source=execFileSync('git',['show',`${baseline}:worker/openai-adapter.ts`],{cwd:root,encoding:'utf8'});
  const current=await readFile(new URL('../worker/openai-adapter.ts',import.meta.url),'utf8');
  const retry=source=>source.slice(source.indexOf('async function openAIRequest('),source.indexOf('\nconst responseText='));
  assert.equal(retry(source),retry(current),'paid and unpaid retry implementation stays byte-identical');
  await writeFile(file,source);const oldFetch=globalThis.fetch;
  try{
    const original=await import(file.href);const env={OPENAI_API_KEY:'offline-only',OPENAI_IMAGE_MODEL:'gpt-image-2.5-sunburst'};
    const capture=async(run)=>{
      const calls=[];globalThis.fetch=async(url,init)=>{
        const body=init.body instanceof FormData?await Promise.all([...init.body.entries()].map(async([key,value])=>[key,typeof value==='string'?value:{name:value.name,type:value.type,bytes:[...new Uint8Array(await value.arrayBuffer())]}])):init.body;
        calls.push({url,body});
        if(String(url).endsWith('/moderations'))return pass();
        if(String(url).endsWith('/responses'))return Response.json({id:'response-id',output_text:'{"scene":"synthetic"}',usage});
        if(typeof body==='string'&&JSON.parse(body).stream)return new Response('data: '+JSON.stringify({type:'image_generation.completed',b64_json:btoa('image'),usage})+'\n\n');
        return Response.json({data:[{b64_json:btoa('image')}],usage});
      };await run(env);return calls;
    };
    const before=await capture(env=>original.generateCreativeDirection(env,'user',{facts:[]}));
    const after=await capture(env=>generateCreativeDirection(env,'user',{facts:[]},undefined,undefined,undefined,{onEvidence:()=>{}}));assert.deepEqual(after,before);
    for(const options of [{quality:'high'},{quality:'low',outputFormat:'jpeg',outputCompression:70,partialImages:1},{quality:'high',references:[{bytes:new Uint8Array([1,2,3]),mimeType:'image/png',source:'uploaded-reference'}]}]){
      const before=await capture(env=>original.generateCreativeImage(env,'user',{facts:[]},{scene:'synthetic'},options));
      const after=await capture(env=>generateCreativeImage(env,'user',{facts:[]},{scene:'synthetic'},{...options,onEvidence:()=>{}}));assert.deepEqual(after,before);
    }
  }finally{globalThis.fetch=oldFetch;await unlink(file);}
});
