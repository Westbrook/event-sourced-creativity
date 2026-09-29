// Isolated, disposable verification data. No real provider calls or workspace data.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {isStillNamespace,parseStillRoute} from '../src/still/routes.ts';
const f=await createSceneCostFixture(1,'visual');
globalThis.fetch=async()=>{throw new Error('External calls disabled in project idea preview.');};
const post=async events=>{const {head}=await(await f.request('/api/events?after=0')).json();const response=await f.request('/api/events',f.json({action:'batch',expectedSequence:head,events}));if(!response.ok)throw new Error(await response.text());};
await post([{type:'DocumentRenamed',payload:{document_id:f.documentId,new_title:'Harbor story'}},{type:'DocumentCreated',payload:{project_id:f.projectId,document_id:'ideas-second',title:'Harbor poster'}},{type:'BlockDocumentAttached',payload:{project_id:f.projectId,document_id:'ideas-second',block_id:'scene-reuse-direction',position:'a'}},{type:'BlockCreated',payload:{project_id:f.projectId,scope:'library',block_id:'ideas-unplaced',handle:'Sea-glass palette',type:'direction',properties:{text:'Pale green, deep blue and weathered brass.',weight:.8}}}]);
const port=5188,root=resolve('dist/client');
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(url.pathname.startsWith('/api/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  const response=await f.request(req.url,{method:req.method,headers:{...req.headers,host:'localhost',origin:'http://localhost',referer:'http://localhost/still'},...(bytes.length?{body:bytes}:{})});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 if(isStillNamespace(url.pathname)&&!parseStillRoute(url)){res.writeHead(404);res.end();return;}
 const path=isStillNamespace(url.pathname)?'still.html':!extname(url.pathname)?'index.html':`.${url.pathname}`;
 const file=resolve(root,path);if(!file.startsWith(root+'/')){res.writeHead(404);res.end();return;}
 const bytes=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream','cache-control':'no-store'});res.end(bytes);
 }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(error.message);}
}).listen(port,'127.0.0.1',()=>console.log(`Idea preview: http://127.0.0.1:${port}/still/project/${f.projectId}?progress-report`));
