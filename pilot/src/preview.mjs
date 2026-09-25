import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createVisualAdapter} from './fixture.mjs';
import {apiAllowed,pageEntry} from './routes.mjs';
const adapter=await createVisualAdapter();
const root=resolve(import.meta.dirname,'../dist/web');
const port=Number(process.env.PILOT_PORT??5207);
const host=process.env.PILOT_BIND??'127.0.0.1';
if(host!=='127.0.0.1')throw Error('Non-loopback fixture requires separately confirmed IAP gateway');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{
 const json=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-still-pilot':'synthetic-visual-only'});res.end(JSON.stringify(data));};
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/healthz')return json(200,{ok:true,checkpoint:'A',providers:false});
  if(url.pathname==='/pilot.json')return json(200,{...adapter.description,commit:process.env.SOURCE_COMMIT??'local-uncommitted',hosted:false});
  if(url.pathname.startsWith('/api/')){
   if(!apiAllowed(url.pathname,req.method))return json(404,{error:'pilot_route_unavailable'});
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(403,{error:'origin_denied'});
   if(!['GET','HEAD'].includes(req.method)&&!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'json_required'});
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>1024*1024)return json(413,{error:'too_large'});chunks.push(c);}
   // Strip caller identity. A always uses one explicitly simulated local principal.
   const headers={'content-type':'application/json',origin:'http://localhost'};
   const body=Buffer.concat(chunks);
   const response=await adapter.request(url.pathname+url.search,{method:req.method,headers,...(body.length?{body}:{})});
   res.writeHead(response.status,{...Object.fromEntries(response.headers),'x-still-pilot':'synthetic-visual-only'});res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(!['GET','HEAD'].includes(req.method))return json(405,{error:'method_not_allowed'});
  let file;
  if(pageEntry(url.pathname))file=pageEntry(url.pathname);
  else if(/^\/assets\/[a-zA-Z0-9_./-]+$/.test(url.pathname)&&!url.pathname.includes('..'))file=url.pathname.slice(1);
  else return json(404,{error:'pilot_route_unavailable'});
  const bytes=await readFile(resolve(root,file)).catch(()=>null);if(!bytes)return json(404,{error:'missing_asset'});
  res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream','cache-control':'private, no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{json(500,{error:'pilot_request_failed'});}
});
server.listen(port,host,()=>console.log(`Still checkpoint A: http://${host}:${port}/still/action/new-project?progress-report`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await adapter.close();process.exit(0);}));
