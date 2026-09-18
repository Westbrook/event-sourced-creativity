import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createStillPanelHandler} from '../worker/still-panel-api.ts';
import {sealPanel,openPanel,panelLink,readPanelLink,RemotePanelHost,RemotePanelViewer} from '../src/still/remote-panel.ts';
import {PANEL_LEASE_MS,validPanelCommand} from '../src/still/remote-protocol.ts';
const token='a'.repeat(64),scope='b'.repeat(64),key=Buffer.alloc(32,7).toString('base64url');
function harness(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0043_still_panel_relay.sql',import.meta.url),'utf8'));
 const env={DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}}};
 const handle=createStillPanelHandler(async req=>{const userId=req.headers.get('test-user');return userId?{user:{userId}}:{response:Response.json({error:'authentication_required'},{status:401})};});
 const call=async(path='',method='GET',body=undefined,user='host',secret=undefined,origin='https://still.test')=>handle(new Request('https://still.test/api/still/panel'+path,{method,headers:{origin,...(user?{'test-user':user}:{}),...(secret?{'x-still-panel-token':secret}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);
 return {db,call};
}
test('site identity and same-origin access remain mandatory even with a capability',async()=>{
 const h=harness();assert.equal((await h.call('','POST',{token},null)).status,401);assert.equal((await h.call('','POST',{token},'host',undefined,'https://elsewhere.test')).status,403);
});
test('another site user can read only the delegated encrypted panel; host endpoints remain owner-only',async()=>{
 const h=harness(),created=await h.call('','POST',{token}),{id}=await created.json();assert.equal(created.status,201);
 const encrypted=await sealPanel(key,{scope:'project',context:{secret:'creative idea'},controls:[]});
 assert.equal((await h.call('/'+id,'PUT',{scope,payload:encrypted})).status,200);
 const stored=h.db.prepare('SELECT * FROM still_panel_sessions').get();assert.notEqual(stored.token_hash,token);assert.ok(!stored.payload.includes('creative idea'));
 assert.equal((await h.call('/'+id+'/view','GET',undefined,'guest')).status,403);
 assert.equal((await h.call('/'+id+'/view','GET',undefined,null,token)).status,401);
 assert.equal((await h.call('/'+id,'DELETE',undefined,'guest',token)).status,403);
 assert.equal((await h.call('/'+id,'PUT',{scope,payload:encrypted},'guest',token)).status,403);
 const view=await (await h.call('/'+id+'/view','GET',undefined,'guest',token)).json();assert.equal((await openPanel(key,view.payload)).context.secret,'creative idea');
 const unchanged=await (await h.call('/'+id+'/view?after='+view.revision,'GET',undefined,'guest',token)).json();assert.equal(unchanged.payload,null);
});
test('only flags, limits 1–7, and panel visibility are accepted; scope and host lease prevent stale commands',async()=>{
 const h=harness(),{id}=await (await h.call('','POST',{token})).json();await h.call('/'+id,'PUT',{scope,payload:'AAAA'});
 for(const command of [{type:'generate',value:true,scope},{type:'density',value:8,scope},{type:'density',value:0,scope},{type:'flags',value:'true',scope},{type:'visibility',value:true,scope:'c'.repeat(64)}])assert.equal((await h.call('/'+id+'/command','POST',command,'guest',token)).status,409);
 for(const command of [{type:'flags',value:true,scope},{type:'density',value:1,scope},{type:'density',value:7,scope},{type:'visibility',value:false,scope}])assert.equal((await h.call('/'+id+'/command','POST',command,'guest',token)).status,200);
 const update=await (await h.call('/'+id,'PUT',{scope})).json();assert.equal(update.commands.length,3);assert.equal(update.commands.find(c=>c.type==='density').value,'7');
 const ack=Math.max(...update.commands.map(c=>c.seq));assert.equal((await (await h.call('/'+id,'PUT',{scope,ack})).json()).commands.length,0);
 h.db.prepare('UPDATE still_panel_sessions SET heartbeat=?').run(Date.now()-PANEL_LEASE_MS-1);
 assert.equal((await h.call('/'+id+'/view','GET',undefined,'guest',token)).status,409);
 assert.equal((await h.call('/'+id+'/command','POST',{type:'flags',value:false,scope},'guest',token)).status,409);
});
test('revocation and expiry remove access, and payload size is bounded',async()=>{
 const h=harness(),{id}=await (await h.call('','POST',{token})).json();assert.equal((await h.call('/'+id,'PUT',{scope,payload:'A'.repeat(1_850_001)})).status,413);
 await h.call('/'+id,'DELETE');assert.equal((await h.call('/'+id+'/view','GET',undefined,'guest',token)).status,410);
 const next=await (await h.call('','POST',{token})).json();h.db.prepare('UPDATE still_panel_sessions SET expires_at=?').run(Date.now()-1);
 assert.equal((await h.call('/'+next.id+'/view','GET',undefined,'guest',token)).status,410);
 await h.call('','POST',{token});assert.equal(h.db.prepare('SELECT count(*) n FROM still_panel_sessions').get().n,1);
});
test('snapshot encryption authenticates its bytes; credentials live only in the URL fragment',async()=>{
 const link={id:crypto.randomUUID(),token,key,expiresAt:100},url=panelLink(link,'https://still.test');
 assert.ok(!new URL(url).search.includes(token));assert.ok(!new URL(url).search.includes(key));assert.equal(readPanelLink(url).key,key);assert.equal(readPanelLink(url.replace(token,'broken')),null);
 const data={context:{head:1},controls:[]},encrypted=await sealPanel(key,data);assert.deepEqual(await openPanel(key,encrypted),data);
 await assert.rejects(openPanel(Buffer.alloc(32,8).toString('base64url'),encrypted));
 assert.equal(validPanelCommand({type:'experiment',value:true,scope}),false);
});
test('host survives a hidden panel, applies each command once and ignores late commands after navigation',async()=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window,oldLocation=globalThis.location;
 let raw={scope:'a',context:{head:1},controls:[]},visible=true,commands=[],calls=[],sent=false,navigate=false;
 globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.location={origin:'https://still.test',pathname:'/still'};
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body??'{}');calls.push({url,body});if(options.method==='POST')return Response.json({id:crypto.randomUUID(),expiresAt:Date.now()+3600000});if(options.method==='DELETE')return Response.json({ended:true});if(navigate)raw={...raw,scope:'other'};return Response.json({commands:sent?[]:[{seq:1,type:'visibility',value:'false',scope:body.scope}]});};
 const host=new RemotePanelHost(()=>raw,()=>visible,c=>{commands.push(c);visible=c.value;sent=true;},()=>{});
 try{await host.start();assert.equal(visible,false);assert.equal(commands.length,1);await host.tick();assert.equal(commands.length,1);sent=false;navigate=true;await host.tick();assert.equal(commands.length,1);await host.stop();assert.equal(host.link,undefined);assert.equal(calls.at(-1).url.includes('/api/still/panel/'),true);}
 finally{await host.stop();globalThis.fetch=oldFetch;globalThis.window=oldWindow;globalThis.location=oldLocation;}
});
test('viewer follows live snapshots, forwards scoped settings, and disables stale controls after revocation',async()=>{
 const saved=globalThis.fetch;let revision=1,ended=false,posted=[],applied=[],statuses=[];
 const link={id:crypto.randomUUID(),token,key,expiresAt:Date.now()+3600000};
 globalThis.fetch=async(url,options)=>{
  if(ended)return Response.json({error:'panel_expired'},{status:410});
  if(options.method==='POST'){posted.push(JSON.parse(options.body));return Response.json({queued:true});}
  return Response.json({revision,payload:await sealPanel(key,{scope:'document',context:{head:revision},controls:[],shared:{scope,visible:revision===1,path:'/still'}}),expiresAt:link.expiresAt});
 };
 const viewer=new RemotePanelViewer(link,s=>applied.push(s),(message,live)=>statuses.push({message,live}));
 try{await viewer.tick();assert.equal(applied.at(-1).context.head,1);await viewer.command('density',3);assert.deepEqual(posted,[{type:'density',value:3,scope}]);revision=2;await viewer.tick();assert.equal(applied.at(-1).shared.visible,false);ended=true;await viewer.tick();assert.equal(statuses.at(-1).live,false);assert.match(statuses.at(-1).message,/Sharing ended/);await viewer.command('flags',true);assert.equal(posted.length,1);}
 finally{viewer.stop();globalThis.fetch=saved;}
});
