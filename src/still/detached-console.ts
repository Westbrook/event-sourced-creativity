import './vendor/tokens/default.css';
import './theme.css';
import './vendor/elements/define/button.js';
import type { ExperimentResult } from './decision-lab.ts';
import { StillDeveloperConsole } from './developer-console.ts';
import { DEVELOPER_DESKTOP_QUERY } from './developer-layout.ts';
import { ConsoleWindowReceiver, validConsoleSession } from './console-window.ts';

export function startConsoleWindow(){
  document.title='Still · Decisions';
  document.body.style.cssText='margin:0;background:var(--en-color-canvas);color:var(--en-color-text);font:14px/1.5 system-ui,sans-serif';
  const session=new URL(location.href).searchParams.get('developer-console'),source=window.opener as Window|null;
  const status=document.createElement('p');status.style.cssText='margin:24px';status.setAttribute('role','status');document.body.append(status);
  if(!validConsoleSession(session)||!source){status.textContent='Open Decisions from Still.';return;}
  const desktop=window.matchMedia(DEVELOPER_DESKTOP_QUERY);
  let console:StillDeveloperConsole|undefined,scope='';
  const pending=new Map<string,(result?:ExperimentResult,error?:string)=>void>();
  const clear=(message:string)=>{for(const done of pending.values())done(undefined,'App disconnected.');pending.clear();console?.remove();console=undefined;status.hidden=false;status.textContent=message;};
  const receiver=new ConsoleWindowReceiver(window,source,session,async data=>{
    if(!desktop.matches){clear('Use a desktop-width window to inspect decisions.');return;}
    if(scope!==data.scope){clear('Connecting…');scope=data.scope;}
    if(!console){console=new StillDeveloperConsole();console.detached=true;console.scope=data.scope;console.addEventListener('developer-next-best',e=>receiver.command('next-best',{value:(e as CustomEvent).detail.value}));console.addEventListener('developer-flags',e=>receiver.command('flags',{value:(e as CustomEvent).detail.value}));console.addEventListener('developer-refresh',()=>receiver.command('refresh',{}));console.addEventListener('developer-density',e=>receiver.command('density',{value:(e as CustomEvent).detail.value}));console.addEventListener('developer-experiment',e=>{const d=(e as CustomEvent).detail,id=crypto.randomUUID();pending.set(id,d.complete);receiver.command('experiment',{id,scope,request:d.request});});console.addEventListener('developer-return',()=>receiver.returnToPanel());document.body.append(console);}
    // Preserve inspector disclosure state when an unrelated live field changes.
    for(const key of ['context','applied','received','pending','controls'] as const){
      if(JSON.stringify(console[key])!==JSON.stringify(data[key]))Object.assign(console,{[key]:data[key]});
    }
    status.hidden=true;await console.updateComplete;
  },clear,()=>Date.now(),data=>{const done=pending.get(data.id);pending.delete(data.id);done?.(data.result as ExperimentResult|undefined,data.error);});
  const resize=()=>{if(desktop.matches){status.textContent='Connecting…';receiver.start();}else{receiver.stop();clear('Use a desktop-width window to inspect decisions.');}};
  desktop.addEventListener('change',resize);window.addEventListener('pagehide',()=>desktop.removeEventListener('change',resize),{once:true});
  resize();
}
