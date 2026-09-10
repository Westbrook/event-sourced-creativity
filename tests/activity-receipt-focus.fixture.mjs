import { failedJob } from "./helpers/activity-receipt-focus-data.mjs";

if (location.protocol !== "http:" || location.hostname !== "127.0.0.1" || !location.port
  || location.port === "4186" || location.pathname !== "/tests/activity-receipt-focus.fixture.html"
  || location.search || location.hash) throw new Error("Unadmitted Activity focus fixture");
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
const job=failedJob();store.documentJobs.set([job]);
if(!store.sourceOwnershipActive(store.captureSourceOwnership()))throw new Error("Synthetic source ownership unavailable");
const panel=document.createElement("forma-activity-issue-panel");
panel.job=job;panel.documentName="Synthetic failed video";
document.querySelector("#activity-focus-owner").append(panel);await panel.updateComplete;
if(panel.constructor!==customElements.get("forma-activity-issue-panel"))throw new Error("Real Activity panel not mounted");
document.querySelector("#activity-focus-ready").textContent="Real Activity issue panel ready";
