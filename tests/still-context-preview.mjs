// Isolated loopback UI verification with real Worker + simulated provider responses.
// Never use real provider credentials, never connect to an external provider.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { memoryMedia } from './helpers/still-media-fixture.mjs';
const f=await createSceneCostFixture(1,'visual');f.env.FORMA_ASSISTANT_PROVIDER_USER_IDS=f.owner;f.env.MEDIA=memoryMedia();
f.env.JEV_API_KEY='fixture-only-no-external-network';
const json=input=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
const current=await (await f.request('/api/events?after=0')).json();
await f.request('/api/events',json({action:'batch',expectedSequence:current.head,events:[{type:'DocumentRenamed',payload:{document_id:f.documentId,old_title:'One current authored direction',new_title:'LOCAL TEST · Small ideas'}},{type:'BlockCreated',payload:{project_id:f.projectId,document_id:f.documentId,block_id:'preview-light',type:'style',scope:'document',handle:'Evening light',position:'z',properties:{text:'Warm evening light across the harbor.',weight:.8}}}]}));
let calls=0;
globalThis.fetch=async(url,init)=>{
  if(String(url)==='https://api.typesafe.ai/v1/systemone') {
    const body=JSON.parse(init.body);
    if(body.state?.current?.view!=='choose-format')return new Response(null,{status:503});
    const score=(score,confidence)=>({type:'score',score,confidence});
    return Response.json({model:'simulated-jev',answers:{fit_short_story:score(3,.95),fit_scene:score(3,.9),fit_image:score(2,.9)}});
  }
  if(String(url)!=='https://api.openai.com/v1/responses')throw new Error('External network disabled in this fixture.');
  calls++;const body=JSON.parse(init.body),input=JSON.parse(body.input);
  const result=input.source?{proposals:[{type:'subject',subtype:'Hero subject',label:'keeper',text:'keeper',source_excerpt:'keeper',participants:[]}]}:{inferred:[],related:[],learned:[],image_query:''};
  return Response.json({id:`local-context-${calls}`,model:body.model,output_text:JSON.stringify(result),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
};
const clientRoot=resolve('dist/client');
const server=http.createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://127.0.0.1:5175').pathname;
    if(path.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const bytes=Buffer.concat(chunks),headers={...req.headers,host:'localhost',origin:'http://localhost',referer:'http://localhost/still'};
      const response=await f.request(req.url,{method:req.method,headers,...(bytes.length?{body:bytes}:{})});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const file=resolve(clientRoot,path==='/still'?'still.html':`.${path}`);
    if(!file.startsWith(clientRoot+'/')){res.writeHead(404);res.end();return;}
    const content=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream','cache-control':'no-store'});res.end(content);
  }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(String(error.message));}
});
server.listen(5175,'127.0.0.1',()=>console.log(`Isolated context verification: http://127.0.0.1:5175/still?project=${f.projectId}&document=${f.documentId}`));
