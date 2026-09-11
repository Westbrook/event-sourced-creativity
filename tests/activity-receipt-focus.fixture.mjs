import { failedJob } from "./helpers/activity-receipt-focus-data.mjs";

const accountingLifetime = location.search === "?accounting-lifetime=1";
if (location.protocol !== "http:" || location.hostname !== "127.0.0.1" || !location.port
  || location.port === "4186" || location.pathname !== "/tests/activity-receipt-focus.fixture.html"
  || (location.search && !accountingLifetime) || location.hash) throw new Error("Unadmitted Activity focus fixture");
const origin=location.origin, nativeFetch=globalThis.fetch.bind(globalThis);
const admitted=new Map([
  [origin+"/api/document-jobs/job-1?inspection=1","detail-reads"],
  [origin+"/api/admin/generation-accounting?jobId=job-1","accounting-reads"],
]);
const blocked=()=>{const node=document.querySelector("#blocked-reads");node.textContent=String(Number(node.textContent)+1);return new TypeError("Undeclared Activity focus transport");};
// Installed before importing Store or connecting the real owner. No methods,
// permission predicates, receipt projection, focus or renderers are replaced.
globalThis.fetch=(input,init)=>{
  const request=new Request(input,init), counter=admitted.get(request.url);
  if(request.method!=="GET"||!counter)return Promise.reject(blocked());
  const node=document.getElementById(counter);node.textContent=String(Number(node.textContent)+1);
  return nativeFetch(request);
};
globalThis.XMLHttpRequest=class{constructor(){throw blocked();}};
globalThis.EventSource=class{constructor(){throw blocked();}};
Object.defineProperty(navigator,"sendBeacon",{configurable:true,value:()=>{blocked();return false;}});

const {store}=await import("/src/state/store.ts");
const {setFormaLocale}=await import("/src/components/design-system/localization.ts");
await setFormaLocale("en",{persist:false,timeZone:"UTC"});
await import("/src/components/forma-activity-issue-panel.ts");
store.session.set({
  user:{userId:"fixture-accounting",email:"accounting@example.invalid",displayName:"Synthetic accounting fixture",role:"admin",consentVersion:"fixture",consentedAt:"2026-09-10T12:00:00.000Z"},
  impersonation:null,projectContext:null,audience:"creative",
  policy:{version:"fixture",accepted:true,passiveCapture:false,externalAssetsRequireAssertion:true,retentionDays:30,sharing:"fixture"},
  provider:{name:"fixture",model:"fixture",configured:false,plannerConfigured:false,videoConfigured:false,audioConfigured:false},
  budgets:{period:"fixture",user:{used:0,reserved:0,limit:0},workspace:{used:0,reserved:0,limit:0}},capabilities:[],
});
store.route.set("/activity");store.loading.set(false);
const job=failedJob();
if(accountingLifetime){
  job.moderationPromptRef="fixture-lifetime-prompt";
  store.content.set({...store.content.get(),"fixture-lifetime-prompt":"Synthetic lifetime original prompt"});
}
store.documentJobs.set([job]);
if(!store.sourceOwnershipActive(store.captureSourceOwnership()))throw new Error("Synthetic source ownership unavailable");
const panel=document.createElement("forma-activity-issue-panel");
panel.job=job;panel.documentName="Synthetic failed video";
document.querySelector("#activity-focus-owner").append(panel);await panel.updateComplete;
if(panel.constructor!==customElements.get("forma-activity-issue-panel"))throw new Error("Real Activity panel not mounted");
document.querySelector("#activity-focus-ready").textContent="Real Activity issue panel ready";

if(accountingLifetime){
  // Finite inert fixture controls only; no production hooks or replaced methods.
  // Trusted F8 causes a genuine Store notification and actual parent/child updates.
  // Trusted F9 changes the owned synthetic prompt, exercising real receipt retirement.
  const output=document.createElement("output");output.id="activity-lifetime-observation";
  output.textContent=JSON.stringify({phase:"ready",notifications:0,promptChanges:0});
  document.querySelector("#activity-focus-owner").before(output);
  let notifications=0,promptChanges=0,busy=false;
  window.addEventListener("keydown",async event=>{
    if(!event.isTrusted||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!["F8","F9"].includes(event.code))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(busy){output.textContent=JSON.stringify({phase:"error",message:"Concurrent lifetime control"});return;}
    busy=true;
    try{
      const child=panel.querySelector("forma-generation-input-dialog");
      const native=child?.querySelector("dialog");
      if(!panel.isConnected||!child||!native?.open)throw new Error("Actual Activity dialog not open");
      const inspection=child.inspection;
      if(event.code==="F8"){
        if(++notifications>2)throw new Error("Notification cap");
        store.notify();
      }else{
        if(++promptChanges>1)throw new Error("Prompt-change cap");
        store.content.set({...store.content.get(),"fixture-lifetime-prompt":"Synthetic lifetime changed prompt"});
        store.notify();
      }
      await panel.updateComplete;
      const after=panel.querySelector("forma-generation-input-dialog");
      if(after)await after.updateComplete;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      output.textContent=JSON.stringify({phase:"updated",action:event.code,notifications,promptChanges,
        sameParent:panel.isConnected,sameChild:child===after,sameInspection:inspection===after?.inspection,
        nativeDialogOpen:after?.querySelector("dialog")?.open===true});
    }catch(error){
      output.textContent=JSON.stringify({phase:"error",message:String(error).slice(0,300)});
    }finally{busy=false;}
  },true);
}
