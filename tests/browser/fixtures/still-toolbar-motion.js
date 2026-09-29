/** Finite, synthetic data for the real Still app. Never calls a provider. */
export async function mountStillMotionFixture(){
  const {StillApp}=await import('/src/still/app.ts');
  const {POLICY_VERSION}=await import('/src/still/decisions.ts');
  const events=[['ProjectCreated',{project_id:'p',name:'Quiet hour'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Observatory'}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'subject',handle:'Evening light',position:'1',properties:{text:'A study of evening light.',weight:1}}]].map(([type,payload],i)=>({type,payload,sequence:i+1,eventId:'e'+i,streamId:'fixture',occurredAt:'2026-09-28T12:00:00Z',actor:'user'}));
  const app=window.app=new StillApp();window.requests=[];window.hold=new URL(location.href).searchParams.get('motion-scenario')==='long-wait';
  app.poll=()=>{};
  app.client.load=async()=>{
   app.client.session={user:{userId:'fixture',displayName:'Fictional reviewer',role:'creator'},policy:{accepted:true,retentionDays:30},provider:{plannerConfigured:true},projects:[]};
   app.client.events=events;app.client.head=events.length;app.client.historyComplete=true;
  };
  app.client.completeHistory=async()=>{};app.client.pollJobs=async()=>{};app.client.refresh=async()=>{};
  app.requestDecision=async function(body){
   const request={body,number:window.requests.length};window.requests.push(request);
   if(window.hold)await new Promise(resolve=>request.resolve=resolve);
   return {source:'jev',head:app.client.head,policy:POLICY_VERSION,actions:app.candidates().filter(a=>['add-context','research-context','results','projects'].includes(a.id)).slice(0,4),delivery:{stage:'complete',enrichment:'complete'}};
  };
  if(window.hold)setTimeout(()=>{window.hold=false;window.requests.forEach(request=>request.resolve?.());},18000);
  document.body.append(app);await app.updateComplete;
}
