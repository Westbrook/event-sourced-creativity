// Ephemeral, loopback-only UI fixture. Never included in the app or deployed bundle.
// API responses are synthetic and all paid generation admission is disabled.
import http from 'node:http';
const session={user:{userId:'still-ui-fixture',displayName:'Still test creator',role:'creator'},permissionEpoch:'fixture-1',policy:{accepted:true,retentionDays:30},provider:{configured:true,plannerConfigured:true,videoConfigured:true,audioConfigured:true,model3dConfigured:true},projects:[]};
const event=(type,payload,sequence,correlationId='fixture')=>({eventId:`fixture-${sequence}`,streamId:'creative:still-ui-fixture',sequence,type,payload,actor:'user',clientId:'web:still',correlationId,occurredAt:new Date().toISOString(),recordedAt:new Date().toISOString(),schemaVersion:1,causationId:null,compensatesEventId:null});
const events=[event('ProjectCreated',{project_id:'quiet-hour',name:'The quiet hour',state:'active'},1),event('DocumentCreated',{project_id:'quiet-hour',document_id:'observatory',title:'An observatory for small things',handle:'observatory'},2),event('BlockCreated',{project_id:'quiet-hour',document_id:'observatory',block_id:'subject',type:'subject',handle:'The object',position:'1',scope:'document',properties:{text:'A small ceramic observatory on a slender brass tripod. An object for noticing things that usually go unnoticed.',weight:.8}},3),event('BlockCreated',{project_id:'quiet-hour',document_id:'observatory',block_id:'atmosphere',type:'style',handle:'The feeling',position:'2',scope:'document',properties:{text:'Quiet, tactile, a little mysterious. The last warm light of the afternoon. Something you might discover in a room full of ordinary things.',weight:.8}},4)];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:5174');
  const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  if(url.pathname==='/api/session')return json(session);
  if(url.pathname==='/api/events'){
    if(req.method==='POST'){let data='';for await(const part of req)data+=part;const body=JSON.parse(data);const inputs=body.events??[body.event];const appended=inputs.map(e=>event(e.type,e.payload,events.length+1,body.correlationId));for(let i=0;i<appended.length;i++){appended[i].sequence=events.length+1;appended[i].eventId=`fixture-${events.length+1}`;events.push(appended[i]);}return json({appended,head:events.length,rejected:[]});}
    return json({events:events.filter(e=>e.sequence>Number(url.searchParams.get('after')??0)),head:events.length,nextAfter:events.length,hasMore:false,content:{}});
  }
  if(url.pathname==='/api/still/decision')return json({source:'fallback',reason:'ui_fixture',head:events.length,actions:[]});
  if(url.pathname==='/api/document-jobs')return req.method==='GET'?json({jobs:[]}):json({error:'fixture_provider_disabled',message:'This local UI fixture never starts a paid generation.'},403);
  if(url.pathname.startsWith('/api/'))return json({error:'fixture_endpoint_unavailable'},404);
  try{const response=await fetch(`http://127.0.0.1:5173${req.url}`);res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'text/plain','cache-control':'no-store'});res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(502);res.end('Start the Still Vite preview first.');}
});
server.listen(5174,'127.0.0.1',()=>console.log('Synthetic UI fixture: http://127.0.0.1:5174/still?project=quiet-hour&document=observatory'));
