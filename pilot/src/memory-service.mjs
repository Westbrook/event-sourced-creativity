import http from 'node:http';
import pg from 'pg';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {MemoryRepository} from './memory.mjs';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export function machineVerifier({audience,subjects,jwks=keys}){
 if(!audience||!subjects?.length)throw Error('memory_identity_configuration_required');
 return async token=>{const {payload}=await jwtVerify(token,jwks,{issuer:'https://accounts.google.com',audience,algorithms:['RS256'],requiredClaims:['sub','iat','exp'],maxTokenAge:'1h',clockTolerance:30});if(!subjects.includes(payload.sub))throw Error('machine_denied');return payload.sub;};
}
export function memoryHandler(repository,verify){return async request=>{
 const json=(status,value)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
 try{
  const url=new URL(request.url);if(url.pathname==='/healthz')return json(200,{service:'memory-pg-v1',provider:'disabled'});
  if(request.method!=='POST'||!/^\/v1\/(upsert|query|delete|reconcile)$/.test(url.pathname))return json(404,{error:'unavailable'});
  const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];if(!token)return json(401,{error:'machine_authentication_required'});
  let principal;try{principal=await verify(token);}catch{return json(401,{error:'machine_authentication_required'});}
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json(415,{error:'json_required'});
  const body=await request.text();if(Buffer.byteLength(body)>32768)return json(413,{error:'too_large'});const input=JSON.parse(body);
  const method=url.pathname.slice(4);if(method==='reconcile')return json(501,{error:'native_intent_reconciler_not_ported'});
  return json(200,await repository[method](principal,input));
 }catch(e){return json(/denied/.test(e.message)?403:409,{error:e.message.startsWith('memory_')?e.message:'memory_operation_failed'});}
};}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const pool=new pg.Pool({connectionString:process.env.PILOT_MEMORY_DATABASE_URL,max:3,statement_timeout:15000});
 const handler=memoryHandler(new MemoryRepository(pool),machineVerifier({audience:process.env.MEMORY_AUDIENCE,subjects:process.env.MEMORY_MACHINE_SUBJECTS?.split(',')}));
 const server=http.createServer(async(req,res)=>{try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>32768){res.writeHead(413);res.end();return;}chunks.push(c);}const body=Buffer.concat(chunks);const response=await handler(new Request('http://memory.internal'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(400);res.end();}});
 server.listen(Number(process.env.PORT??8081),process.env.PILOT_BIND??'127.0.0.1');
 process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
}
