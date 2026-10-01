import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as createPortReservation} from 'node:net';
import {createServer} from 'vite';
import {ACTIONS,POLICY_VERSION} from '../../../src/still/decisions.ts';

const documentScope={projectId:'p',documentId:'d'};
const scopeKey=scope=>JSON.stringify({...(scope.projectId?{projectId:scope.projectId}:{}),...(scope.documentId?{documentId:scope.documentId}:{})});
const future=()=>new Date(Date.now()+30*86400000).toISOString();

/** Fictional API data only. A source server is owned by this test and never uses dist. */
export async function actionContextFixture(){
  const cacheDir=await mkdtemp(join(tmpdir(),'still-action-context-'));
  const reservation=createPortReservation();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=reservation.address().port;
  await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  let current;
  const server=await createServer({configFile:false,cacheDir,optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port,strictPort:true,hmr:false},plugins:[{name:'still-action-context-fixture',configureServer(server){
    server.middlewares.use('/api/',async(req,res)=>{
      const scenario=current;
      if(!scenario){res.statusCode=503;res.end();return;}
      const url=new URL(req.url,'http://fixture.local'),path=url.pathname;
      let body;
      try{let source='';for await(const part of req)source+=part;if(source)body=JSON.parse(source);}catch{res.statusCode=400;res.end();return;}
      const method=req.method,scope=body?.scope??Object.fromEntries(url.searchParams),key=scopeKey(scope);
      const reply=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
      scenario.requests.push({path,method,body});
      if(path==='/still/action-context'){
        const value=scenario.scopes.get(key)??{enabled:false};
        if(method==='GET'){reply({...value,observations:[]});return;}
        if(method==='PUT'){
          const next={...value,enabled:body.enabled,...(body.enabled?{expiresAt:future(),directDecisionId:'direct-fixture',directContextExpiresAt:future()}: {})};
          scenario.scopes.set(key,next);reply(next);return;
        }
        if(method==='DELETE'){scenario.scopes.set(key,{enabled:false});reply({erased:true});return;}
      }
      if(path==='/still/goal'){
        const value=scenario.scopes.get(key)??{enabled:false};
        if(method==='PUT'){
          const goal={id:'fictional-goal',scope,text:body.text,criteria:body.criteria,status:'active',createdAt:new Date().toISOString(),expiresAt:future()};
          scenario.scopes.set(key,{...value,goal});reply({goal});return;
        }
        if(['POST','DELETE'].includes(method)){scenario.scopes.set(key,{...value,goal:undefined});reply({saved:true});return;}
      }
      if(path==='/still/action-observations'&&method==='POST'){scenario.observations.push(body);reply({saved:true});return;}
      if(path==='/still/decision'&&method==='POST'){
        const number=scenario.decisions.length,actions=['rename','add-context','documents'].map(id=>ACTIONS.find(action=>action.id===id));
        const value={source:'jev',head:6,policy:POLICY_VERSION,decisionId:`decision-${number}`,actions,rankedActions:actions,delivery:{stage:'complete',enrichment:'complete'}};
        const decision={body,value};scenario.decisions.push(decision);
        if(scenario.stream&&number===0){
          res.setHeader('content-type','application/x-ndjson');
          const initial={...value,decisionId:'initial-must-not-appear',actions:[ACTIONS.find(action=>action.id==='research-context')],delivery:{stage:'initial',enrichment:'pending'}};
          res.write(JSON.stringify({stage:'initial',value:initial})+'\n');
          scenario.initialSent=true;
          scenario.release=()=>{if(!res.destroyed)res.end(JSON.stringify({stage:'complete',value})+'\n');};
          scenario.interrupt=()=>{if(!res.destroyed)res.end();};
          return;
        }
        reply(value);return;
      }
      scenario.unexpected.push({path,method});res.statusCode=503;reply({error:'synthetic_fixture_route_not_allowed'});
    });
    server.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');});
  }}]});
  try{await server.listen();}catch(error){await server.close();await rm(cacheDir,{recursive:true,force:true});throw error;}
  return {
    origin:`http://127.0.0.1:${server.httpServer.address().port}`,
    reset({enabled=false,stream=false,goal}={}){
      if(current)current.interrupt?.();
      current={stream,scopes:new Map([[scopeKey(documentScope),{enabled,...(enabled?{expiresAt:future(),directDecisionId:'direct-fixture',directContextExpiresAt:future()}:{}),...(goal?{goal}: {})}]]),requests:[],observations:[],decisions:[],unexpected:[],initialSent:false};
      return current;
    },
    async close(){current?.interrupt?.();try{await server.close();}finally{await rm(cacheDir,{recursive:true,force:true});}},
  };
}

export async function mountActionContextFixture(page,origin,options={}){
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.origin===origin?route.continue():route.abort('blockedbyclient');
  });
  await page.goto(origin+'/still/project/p/document/d');
  await page.evaluate(async({role,failFirstLoad})=>{
    const {StillApp}=await import('/src/still/app.ts');
    const rows=[
      ['ProjectCreated',{project_id:'p',name:'Fictional observatory'}],
      ['DocumentCreated',{project_id:'p',document_id:'d',title:'Night study'}],
      ['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'subject',handle:'Evening light',position:'1',properties:{text:'A fictional study of evening light.',weight:1}}],
      ['DocumentCreated',{project_id:'p',document_id:'d2',title:'Morning study'}],
      ['BlockCreated',{project_id:'p',document_id:'d2',block_id:'b2',type:'subject',handle:'Morning light',position:'1',properties:{text:'A fictional study of morning light.',weight:1}}],
      ['DocumentRenamed',{document_id:'d',old_title:'Night study',new_title:'Night study'}],
    ];
    const events=rows.map(([type,payload],i)=>({type,payload,sequence:i+1,eventId:'fixture-event-'+i,streamId:'fixture',occurredAt:'2026-09-30T12:00:00Z',actor:'user:fictional'}));
    const app=window.app=new StillApp();
    // Supply only fictional account/history. Decisions and preference I/O use the real client transport.
    app.poll=()=>{};
    let loads=0;
    app.client.load=async()=>{
      if(failFirstLoad&&!loads++)throw new Error('Fictional transient load failure');
      app.client.session={user:{userId:'fictional',displayName:'Fictional reviewer',role:role??'creator'},policy:{accepted:true,retentionDays:30},provider:{plannerConfigured:true},projects:[]};
      app.client.events=events;app.client.head=events.length;app.client.historyComplete=true;
    };
    app.client.completeHistory=async()=>{};app.client.pollJobs=async()=>{};app.client.refresh=async()=>{};
    document.body.append(app);await app.updateComplete;
  },options);
}

export const toolbarReady=page=>page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='ready');
