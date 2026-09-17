import './vendor/tokens/default.css';
import './vendor/elements/define/button.js';
import { StillDeveloperConsole } from './developer-console.ts';
import { ConsoleWindowReceiver, validConsoleSession } from './console-window.ts';

export function startConsoleWindow(){
  document.title='Still · Decisions';
  document.body.style.cssText='margin:0;background:#f7f6f2;color:#33332e;font:14px/1.5 system-ui,sans-serif';
  const session=new URL(location.href).searchParams.get('developer-console'),source=window.opener as Window|null;
  const status=document.createElement('p');status.style.cssText='margin:24px';status.setAttribute('role','status');document.body.append(status);
  if(!validConsoleSession(session)||!source){status.textContent='Open Decisions from Still.';return;}
  let console:StillDeveloperConsole|undefined,scope='';
  const clear=(message:string)=>{console?.remove();console=undefined;status.hidden=false;status.textContent=message;};
  const receiver=new ConsoleWindowReceiver(window,source,session,async data=>{
    if(scope!==data.scope){clear('Connecting…');scope=data.scope;}
    if(!console){console=new StillDeveloperConsole();console.detached=true;console.addEventListener('developer-return',()=>receiver.returnToDrawer());document.body.append(console);}
    // Preserve inspector disclosure state when an unrelated live field changes.
    for(const key of ['context','applied','received','pending','controls'] as const){
      if(JSON.stringify(console[key])!==JSON.stringify(data[key]))Object.assign(console,{[key]:data[key]});
    }
    status.hidden=true;await console.updateComplete;
  },clear);
  status.textContent='Connecting…';receiver.start();
}
