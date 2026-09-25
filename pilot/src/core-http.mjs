import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {CreationValidationError} from '../../src/model/creation-validation.ts';
import {CoreError} from './core-repository.mjs';
import {pageEntry} from './routes.mjs';
import {buildDecisionState,selectActions,evaluateActions,POLICY_VERSION as DECISION_POLICY} from '../../src/still/decisions.ts';
/** Same HTTP contracts and domain validators as the native clients; explicit PostgreSQL port. */
export function createCoreServer({repository,verify,origin,staticRoot,sourceCommit='local-uncommitted'}){
 const resourceFrom=req=>{try{const path=new URL(req.headers.referer??origin).pathname;return /^\/still\/project\/([^/]+)/.exec(path)?.[1]??/^\/document\/([^/]+)/.exec(path)?.[1]??null;}catch{return null;}};
 return http.createServer(async(req,res)=>{
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'private, no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
  try{
   const url=new URL(req.url,origin),path=url.pathname;
   if(path==='/healthz')return send(200,{ok:true,sourceCommit});
   if(path==='/readyz'){await repository.pool.query("SELECT 1 FROM public.pilot_migrations WHERE name='004-test-users.sql'").then(r=>{if(!r.rowCount)throw Error('migration_required');});return send(200,{ready:true,sourceCommit,release:'R1'});}
   // Every private operation derives its actor from a verified assertion. Caller identity headers are ignored.
   const identity=await verify(new Headers(req.headers)),controller=await repository.enroll(identity);
   if(!path.startsWith('/api/')){
    if(!staticRoot||!['GET','HEAD'].includes(req.method))return send(404,{error:'pilot_route_unavailable'});
    const file=pageEntry(path)??(/^\/assets\/[A-Za-z0-9_./-]+$/.test(path)&&!path.includes('..')?path.slice(1):null);if(!file)return send(404,{error:'pilot_route_unavailable'});
    let data=await readFile(resolve(staticRoot,file)).catch(()=>null);if(data&&file.endsWith('.html'))data=Buffer.from(data.toString().replace('<body>','<body><p style="margin:0;padding:4px;text-align:center;background:#ffefc1;color:#322b15;font:12px system-ui">LOCAL VERIFICATION · signed synthetic accounts · persistent PostgreSQL · not GKE</p>'));if(!data)return send(404,{error:'missing_asset'});res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream','cache-control':'private, no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);return;
   }
   let body={};if(!['GET','HEAD'].includes(req.method)){
    if(req.headers.origin!==origin)return send(403,{error:'origin_denied'});
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
    let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>1024*1024)return send(413,{error:'request_too_large'});chunks.push(c);}try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return send(400,{error:'invalid_json'});}if(!body||typeof body!=='object'||Array.isArray(body))return send(400,{error:'invalid_json'});
   }
   // Management stays with the authenticated controller, never the selected app user.
   if(path==='/api/pilot/test-users'&&req.method==='GET')return send(200,await repository.testUsers(controller.principal_id));
   if(path==='/api/pilot/test-users'&&req.method==='POST'){if(typeof body.displayName!=='string')return send(400,{error:'test_user_name_required'});return send(201,await repository.testUsers(controller.principal_id,body.displayName));}
   // The header is only a selector. Ownership is checked server-side on every request.
   const principal=await repository.selectTestUser(controller.principal_id,req.headers['x-still-test-user']),actor=principal.principal_id;
   const resource=resourceFrom(req);
   if(path==='/api/session'&&req.method==='GET')return send(200,await repository.session(actor,resource));
   if(path==='/api/session'&&req.method==='POST'){if(body.action!=='accept_terms'||body.ownershipConfirmed!==true||body.providerProcessingConfirmed!==true)return send(400,{error:'explicit_consent_required'});await repository.consent(actor,'pilot-2026-08-10');return send(200,await repository.session(actor,resource));}
   if(path==='/api/events'&&req.method==='GET'){const after=Number(url.searchParams.get('after')??0),limit=Math.min(6500,Number(url.searchParams.get('limit')??5000));if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1)return send(400,{error:'invalid_page'});return send(200,await repository.read(actor,url.searchParams.get('stillDocument')||resource,after,limit));}
   if(path==='/api/events'&&req.method==='POST')return send(200,await repository.append(actor,resource,body));
   if(path==='/api/document-jobs'&&req.method==='GET'){await repository.read(actor,resource,0,1);return send(200,{jobs:[],inference:false});}
   const match=/^\/api\/still\/creation\/drafts(?:\/([A-Za-z0-9:_-]+))?(?:\/(operations|review|refresh|interpret|preview|apply|use|use-preview)(?:\/([A-Za-z0-9:_-]+))?)?$/.exec(path);
   if(match){const [,id,action,operation]=match;if(!action&&(!id&&req.method==='POST'||id&&['GET','PUT','DELETE'].includes(req.method)))return send(!id?201:200,await repository.draft(actor,id,req.method,body));if(id&&action&&(req.method==='POST'||action==='operations'&&req.method==='GET'))return send(200,await repository.creation(actor,id,action,{...body,...(operation?{operationId:operation}:{})}));}
   if(path==='/api/still/decision'&&req.method==='POST'){
    const r=await repository.read(actor,body.projectId||resource),session=await repository.session(actor,body.projectId||resource),author=session.projectContext?session.projectContext.permissions.includes('project.author'):session.user.role==='creator';const abilities={author,generate:false,projectCreate:!session.projectContext&&author,formats:[]},position={...body,recentActions:Array.isArray(body.recentActions)?body.recentActions:[],actionLimit:Math.min(8,Math.max(1,Number(body.actionLimit)||4))},built=buildDecisionState(r.events,position,abilities,r.head);
    return send(200,{source:'fallback',reason:'model_free_test_release',policy:DECISION_POLICY,head:r.head,actions:selectActions(built.candidates,position,{},built.projection),rankedActions:evaluateActions(built.candidates,position,{},built.projection).ranked.map(a=>({id:a.id})),formats:[],candidateIds:built.candidates.map(a=>a.id)});
   }
   if(path==='/api/pilot/selection'&&req.method==='GET'){const p=url.searchParams.get('path')??'';const id=/\/block\/([A-Za-z0-9_-]+)/.exec(p)?.[1]??/\/document\/([A-Za-z0-9_-]+)/.exec(p)?.[1]??/\/project\/([A-Za-z0-9_-]+)/.exec(p)?.[1];return send(200,await repository.selection(actor,id));}
   if(path==='/api/pilot/share'&&req.method==='POST')return send(200,await repository.share(actor,body.projectId,body.email,body.role));
   if(path==='/api/pilot/source'&&req.method==='DELETE')return send(200,await repository.remove(actor,body.id));
   if(path==='/api/pilot/capabilities'&&req.method==='GET')return send(200,{release:'R1',sourceCommit,providers:false,uploads:false,memory:false,supported:['manual-creation','private-drafts','native-review','shared-events','conflicts','named-sharing','revocation','authored-source-deletion'],unsupported:['paid-models','semantic-search','media','background-generation','Memory','Canvas','public-sharing','administration']});
   return send(404,{error:'pilot_route_unavailable'});
  }catch(error){if(error instanceof CoreError)return send(error.status,{error:error.message,...error.extra});if(error instanceof CreationValidationError)return send(409,{error:'creation_validation_failed',issues:error.issues});if(error instanceof TypeError)return send(400,{error:'invalid_native_payload'});if(error?.code==='23505')return send(409,{error:'identity_or_operation_conflict'});if(error?.code?.startsWith('ERR_JWT')||error?.code?.startsWith('ERR_JWS')||['authentication_required','invalid_iap_claims'].includes(error?.message))return send(401,{error:'authentication_required'});console.error(JSON.stringify({event:'core-request-failed',code:error?.code??error?.name??'unknown'}));return send(500,{error:'request_failed'});}
 });
}
