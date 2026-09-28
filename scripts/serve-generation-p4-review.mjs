// Loopback-only development demonstration. Trusted identity/evidence is explicitly SYNTHETIC.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fixture} from '../tests/generation-p4-fixture.mjs';
const port=4194,origin=`http://127.0.0.1:${port}`,clean=[];
let f,busy=false;
async function reset(options){clean.splice(0).reverse().forEach(fn=>fn());f=await fixture({after:fn=>clean.push(fn)},options);}
await reset({});
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.headers.host!==`127.0.0.1:${port}`)return reply(403,{error:'loopback_host_required'});
 const files={'/':'review.html','/review.js':'review.js','/review.css':'review.css'};
 if(req.method==='GET'&&files[req.url]){res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html'});return res.end(readFileSync(new URL('../evals/generation-reliability/p4/'+files[req.url],import.meta.url)));}
 if(req.method==='GET'&&req.url==='/?progress-report'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(readFileSync(new URL('../evals/generation-reliability/p4/review.html',import.meta.url)));}
 if(req.method!=='POST'||req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'local_same_origin_required'});
 if(busy)return reply(409,{error:'fixture_busy'});busy=true;
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('command_too_large');}const body=JSON.parse(raw);
  if(req.url==='/api/reset'){
   if(!['accepted-estimate','bounded-proof'].includes(body.mode)||!['','baseline:account','treatment:lifecycle','treatment:deletion','treatment:bound'].includes(body.missing))throw Error('synthetic_scenario_required');
   await reset({mode:body.mode,missing:body.missing});return reply(200,{...(await f.preview()),syntheticOnly:true,counts:f.counts()});
  }
  if(req.url==='/api/command'){
   // Browser selects only the command. Fixed loopback fixture stands in for the trusted identity edge.
   const value=await f.call(body);return reply(200,{...value,syntheticOnly:true,counts:f.counts(),realProviderCalls:0});
  }
  return reply(404,{error:'unknown_demo_action'});
 }catch(error){reply(400,{error:error.message});}finally{busy=false;}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic review only: ${origin}/?progress-report`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{clean.reverse().forEach(fn=>fn());process.exit(0);}));
