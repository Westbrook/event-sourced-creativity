import http from 'node:http';
import {iapVerifier,resolvePrincipal} from './identity.mjs';
import {poolFromEnvironment,assertSchema} from './database.mjs';
/** Functional host boundary. Unported native routes cannot reach Sites or fixture code. */
const pool=poolFromEnvironment(),verify=iapVerifier({audience:process.env.PILOT_IAP_AUDIENCE});
await assertSchema(pool);
const server=http.createServer(async(req,res)=>{
 const json=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'private, no-store'});res.end(JSON.stringify(body));};
 if(req.url==='/healthz')return json(200,{ok:true});
 if(req.url==='/readyz')return json(503,{ready:false,reason:'native_http_port_unqualified'});
 try{
  const principal=await resolvePrincipal(pool,await verify(new Headers(req.headers)));
  if(req.url==='/api/pilot/capabilities')return json(200,{checkpoint:'B',qualified:false,principalId:principal.principal_id,providers:false,unsupported:['native-session','creation-http','forma-events','search','media-generation'],sourceCommit:process.env.SOURCE_COMMIT??'local-uncommitted'});
  return json(501,{error:'pilot_route_unported'});
 }catch{return json(401,{error:'authentication_required'});}
});
server.listen(Number(process.env.PORT??8080),process.env.PILOT_BIND??'127.0.0.1');
process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
