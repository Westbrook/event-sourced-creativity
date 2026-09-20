import type { AttentionSnapshot } from './attention.ts';
import type { PaletteFeedback } from './palette-feedback.ts';
import type { DecisionDiagnostics, ReceivedDecision } from './diagnostics.ts';

export type ConsoleControl = { label:string; id:string; region:string; variant:string; size:string; emphasis:string; source?:string; disabled:boolean; options:string[] };
export type ConsoleContext = { nextBest?:import('./next-best.ts').NextBestAssessment; nextBestAnswer?:import('./next-best.ts').NextBestAnswer; toolbarFit?:{maximum:number;fits:number;hidden:string[];deferred:boolean}; generation?:import("./generation-decision.ts").GenerationDecisionContext; onboarding?:boolean; onboardingText?:import('./onboarding-client.ts').OnboardingStatus; historyComplete?:boolean; canRefreshDecision?:boolean; attention?:AttentionSnapshot; view:string; mode:string; head:number; selectedFormat:string; page:number; actionLimit?:number; more?:boolean; paletteOpen?:boolean; paletteFeedback?:PaletteFeedback; paletteOrder?:{rankedIds:string[];passedOverIds:string[]}; current:DecisionDiagnostics };
export type ConsoleSnapshot = { scope:string; context:ConsoleContext; applied?:DecisionDiagnostics; received?:ReceivedDecision; pending:boolean; controls:ConsoleControl[] };
const protocol='still-developer-console-v1';
export const validConsoleSession=(value:string|null):value is string=>!!value&&/^[a-f0-9-]{36}$/.test(value);
export function consoleMessage(event:MessageEvent, source:Window|null, origin:string, session:string){
  return !!source&&event.source===source&&event.origin===origin&&event.data?.protocol===protocol&&event.data?.session===session;
}
export const consoleEnvelope=(session:string,type:string,snapshot?:ConsoleSnapshot)=>({protocol,session,type,...(snapshot?{snapshot}:{})});

/** One host, one popup. No storage, broadcasts, backend requests or creative actions. */
export class ConsoleWindowHost {
  private popup:Window|null=null;
  private session='';
  private ready=false;
  private previous='';
  private timer=0;
  constructor(private owner:Window,private snapshot:()=>ConsoleSnapshot,private changed:(open:boolean,connected:boolean)=>void,private returned:()=>void,private command?:(data:{type:string;value?:number|boolean;request?:unknown;id?:string;scope?:string})=>void){}
  get isOpen(){return !!this.popup&&!this.popup.closed;}
  open(){
    if(this.isOpen){this.popup?.focus();return true;}
    this.dispose();
    this.session=crypto.randomUUID();
    const url=new URL('/still',this.owner.location.origin);url.searchParams.set('developer-console',this.session);
    this.owner.addEventListener('message',this.receive);
    this.owner.addEventListener('pagehide',this.dispose);
    this.popup=this.owner.open(url.href,`still-decisions-${this.session}`,'popup,width=1100,height=900');
    if(!this.popup){this.dispose();return false;}
    this.changed(true,false);
    this.timer=this.owner.setInterval(()=>{if(this.popup?.closed)this.dispose();else if(this.ready)this.send('alive');},1000);
    return true;
  }
  private receive=(event:MessageEvent)=>{
    if(!consoleMessage(event,this.popup,this.owner.location.origin,this.session))return;
    if(event.data.type==='ready'){this.ready=true;this.publish(true);}
    if(event.data.type==='rendered'&&this.ready)this.changed(true,true);
    if(event.data.type==='disconnected'){this.ready=false;this.changed(true,false);}
    if(this.ready&&['density','experiment','refresh','flags','next-best'].includes(event.data.type))this.command?.(event.data);
    if(event.data.type==='return'){this.dispose();this.returned();}
  };
  private send(type:string,snapshot?:ConsoleSnapshot){
    this.popup?.postMessage(consoleEnvelope(this.session,type,snapshot),this.owner.location.origin);
  }
  result(id:string,result:unknown,error?:string){this.popup?.postMessage({...consoleEnvelope(this.session,'experiment-result'),id,result,error},this.owner.location.origin);}
  publish(force=false){
    if(!this.ready||!this.isOpen)return;
    const snapshot=this.snapshot(),serialized=JSON.stringify(snapshot);
    if(force||serialized!==this.previous){this.send('snapshot',snapshot);this.previous=serialized;}
  }
  dispose=()=>{
    this.owner.clearInterval(this.timer);
    this.owner.removeEventListener('message',this.receive);this.owner.removeEventListener('pagehide',this.dispose);
    if(this.popup&&!this.popup.closed){this.send('ended');this.popup.close();}
    const wasOpen=!!this.popup;this.popup=null;this.ready=false;this.previous='';this.session='';
    if(wasOpen)this.changed(false,false);
  };
}

/** The viewer has no app client. It accepts only this opener's live snapshots. */
export class ConsoleWindowReceiver {
  private timer=0;
  private lastSeen=0;
  private connected=false;
  private active=false;
  private revision=0;
  constructor(private owner:Window,private source:Window,private session:string,private apply:(snapshot:ConsoleSnapshot)=>Promise<unknown>|void,private clear:(message:string)=>void,private now=()=>Date.now(),private result?:(data:{id:string;result:unknown;error?:string})=>void){}
  start(){
    this.active=true;this.lastSeen=this.now();
    this.owner.addEventListener('message',this.receive);this.owner.addEventListener('pagehide',this.pagehide);
    this.timer=this.owner.setInterval(this.pulse,1000);this.send('ready');
  }
  command(type:string,data:Record<string,unknown>){if(this.active)this.source.postMessage({...consoleEnvelope(this.session,type),...data},this.owner.location.origin);}
  returnToPanel(){if(this.active)this.send('return');}
  private send(type:string){this.source.postMessage(consoleEnvelope(this.session,type),this.owner.location.origin);}
  private receive=(event:MessageEvent)=>{
    if(!this.active||!consoleMessage(event,this.source,this.owner.location.origin,this.session))return;
    if(event.data.type==='experiment-result'){this.result?.(event.data);return;}
    if(!['snapshot','alive','ended'].includes(event.data.type))return;
    this.lastSeen=this.now();
    if(event.data.type==='ended'){this.stop();return;}
    if(event.data.type!=='snapshot')return;
    const data=event.data.snapshot as ConsoleSnapshot;
    if(!data?.context||!Array.isArray(data.controls)||typeof data.scope!=='string')return;
    this.connected=true;const revision=++this.revision;
    void Promise.resolve(this.apply(data)).then(()=>{if(this.active&&revision===this.revision)this.send('rendered');});
  };
  private pulse=()=>{
    if(this.source.closed){this.stop();return;}
    if(this.now()-this.lastSeen>15000){this.connected=false;++this.revision;this.clear('Waiting for app…');}
    if(!this.connected)this.send('ready');
  };
  private pagehide=()=>this.stop();
  stop(){
    if(this.active)this.send('disconnected');
    this.active=false;this.connected=false;++this.revision;
    this.owner.clearInterval(this.timer);this.owner.removeEventListener('message',this.receive);this.owner.removeEventListener('pagehide',this.pagehide);
    // A BFCache restore must never revive a frozen trace labelled Live.
    this.clear('App disconnected. Reopen Decisions from Still.');
  }
}
