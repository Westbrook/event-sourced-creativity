import type { ConsoleSnapshot } from './console-window.ts';
import { panelHash, validPanelCommand, validPanelId, validPanelToken, PANEL_POLL_MS, type PanelCommand } from './remote-protocol.ts';
export type SharedSnapshot=ConsoleSnapshot & {shared:{scope:string;visible:boolean;path:string}};
type Link={id:string;token:string;key:string;expiresAt:number};
const base='/api/still/panel';
const encode=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
const decode=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const importKey=(key:string)=>crypto.subtle.importKey('raw',decode(key.replace(/-/g,'+').replace(/_/g,'/')),'AES-GCM',false,['encrypt','decrypt']);
export async function sealPanel(key:string,value:unknown){
  const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await importKey(key),new TextEncoder().encode(JSON.stringify(value))));
  const packed=new Uint8Array(iv.length+cipher.length);packed.set(iv);packed.set(cipher,iv.length);return encode(packed);
}
export async function openPanel(key:string,payload:string):Promise<SharedSnapshot>{
  const data=decode(payload);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12)},await importKey(key),data.slice(12))));
}
const errors:Record<string,string>={panel_expired:'Sharing ended. Ask the host for a new link.',host_offline:'Host disconnected. Waiting to reconnect…',panel_access_required:'This link is invalid.',authentication_required:'Sign in to this site, then reopen the link.',owner_required:'The host account changed. Sharing stopped.',panel_snapshot_too_large:'This snapshot is too large to share.',view_changed:'The host moved to another view. Try again.',too_many_shared_panels:'Too many active links. Stop an existing share or wait for it to expire.'};
async function request(path:string,method='GET',body?:unknown,token?:string){
  const response=await fetch(base+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{'x-still-panel-token':token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12_000)});
  const data=await response.json().catch(()=>({error:'request_failed'}));
  if(!response.ok)throw Object.assign(new Error(errors[data.error]??'Panel connection unavailable. Try again.'),{status:response.status});return data;
}
export function panelLink(link:Link,origin:string){const u=new URL('/still',origin);u.searchParams.set('shared-panel',link.id);u.hash=new URLSearchParams({token:link.token,key:link.key}).toString();return u.href;}
export function readPanelLink(href:string):Link|null{
  const u=new URL(href),id=u.searchParams.get('shared-panel')??'',fragment=new URLSearchParams(u.hash.slice(1)),token=fragment.get('token')??'',key=fragment.get('key')??'';
  return validPanelId(id)&&validPanelToken(token)&&/^[A-Za-z0-9_-]{43}$/.test(key)?{id,token,key,expiresAt:0}:null;
}
export class RemotePanelHost {
  link?:Link;private timer?:ReturnType<typeof setTimeout>;private stopped=false;private ack=0;private last='';private scope='';private epoch=crypto.randomUUID();
  constructor(private snapshot:()=>ConsoleSnapshot,private visible:()=>boolean,private command:(c:PanelCommand)=>void,private changed:(message:string)=>void,private ended:()=>void=()=>{}){}
  async start(){
    const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const key=encode(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const data=await request('','POST',{token});this.link={...data,token,key};
    if(this.stopped){await this.stop();return '';}
    window.addEventListener('pagehide',this.unload);await this.tick();if(!this.link)throw new Error('Sharing could not start.');return panelLink(this.link,location.origin);
  }
  private unload=()=>{this.stopped=true;clearTimeout(this.timer);if(this.link)void fetch(base+'/'+this.link.id,{method:'DELETE',credentials:'same-origin',keepalive:true}).catch(()=>{});};
  private async tick(){
    if(this.stopped||!this.link)return;
    try{
      const raw=this.snapshot(),scope=await panelHash(this.epoch+raw.scope+location.pathname);
      const snapshot:SharedSnapshot={...raw,shared:{scope,visible:this.visible(),path:location.pathname}};
      const serialized=JSON.stringify(snapshot),payload=serialized!==this.last?await sealPanel(this.link.key,snapshot):undefined;
      this.scope=scope;
      const result=await request('/'+this.link.id,'PUT',{scope,payload,ack:this.ack});
      if(this.stopped)return;this.last=serialized;
      // Ignore commands for a page that changed while this request was in flight.
      const currentScope=await panelHash(this.epoch+this.snapshot().scope+location.pathname);
      for(const item of result.commands??[]){
        const command={type:item.type,value:JSON.parse(item.value),scope:item.scope};
        if(item.seq>this.ack&&currentScope===this.scope&&validPanelCommand(command))this.command(command);
        this.ack=Math.max(this.ack,item.seq);
      }
      this.changed('Sharing live · updates every 2 seconds');
    }catch(error){
      if(this.stopped)return;this.changed(error instanceof Error?error.message:'Connection interrupted.');
      if([401,403,410,413].includes((error as {status?:number}).status??0)){await this.stop().catch(()=>{this.link=undefined;this.ended();});return;}
    }
    if(!this.stopped)this.timer=setTimeout(()=>void this.tick(),PANEL_POLL_MS);
  }
  async stop(){
    this.stopped=true;clearTimeout(this.timer);window.removeEventListener('pagehide',this.unload);
    if(this.link)try{await request('/'+this.link.id,'DELETE');}catch(error){if((error as {status?:number}).status!==410)throw error;}
    this.link=undefined;this.ended();
  }
}
export class RemotePanelViewer {
  private timer?:ReturnType<typeof setTimeout>;private stopped=false;private revision=0;private scope='';private epoch=0;
  constructor(private link:Link,private apply:(snapshot:SharedSnapshot)=>void,private status:(message:string,live:boolean)=>void){}
  start(){this.stopped=false;void this.tick();}
  stop(){this.stopped=true;this.epoch++;clearTimeout(this.timer);}
  async command(type:PanelCommand['type'],value:PanelCommand['value']){
    const command={type,value,scope:this.scope};if(this.stopped||!validPanelCommand(command))return;
    try{await request('/'+this.link.id+'/command','POST',command,this.link.token);this.status('Change sent. Waiting for host…',true);}catch(error){this.status((error as Error).message,false);this.scope='';this.revision=0;}
  }
  private async tick(){
    if(this.stopped)return;const epoch=this.epoch;
    try{
      const data=await request('/'+this.link.id+'/view?after='+this.revision,'GET',undefined,this.link.token);
      const snapshot=data.payload?await openPanel(this.link.key,data.payload):null;
      if(this.stopped||epoch!==this.epoch)return;
      if(snapshot){if(!snapshot.context||!snapshot.shared?.scope||!Array.isArray(snapshot.controls))throw new Error('Invalid panel snapshot.');this.apply(snapshot);this.scope=snapshot.shared.scope;this.revision=data.revision;}
      this.status(this.scope?'Live · expires '+new Date(data.expiresAt).toLocaleTimeString():'Waiting for host…',!!this.scope);
    }catch(error){
      if(this.stopped||epoch!==this.epoch)return;this.scope='';this.revision=0;this.status((error as Error).message,false);
      if([401,403,410].includes((error as {status?:number}).status??0)){this.stop();return;}
    }
    if(!this.stopped)this.timer=setTimeout(()=>void this.tick(),PANEL_POLL_MS);
  }
}
