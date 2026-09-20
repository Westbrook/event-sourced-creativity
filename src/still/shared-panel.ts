import './vendor/tokens/default.css';
import './theme.css';
import './vendor/elements/define/button.js';
import { StillDeveloperConsole } from './developer-console.ts';
import { readPanelLink, RemotePanelViewer } from './remote-panel.ts';
/** This entry point never constructs Forma's data client or performs Jev/generation calls. */
export function startSharedPanel(){
  document.title='Still · Shared panel';
  document.body.style.cssText='margin:0;background:var(--en-color-canvas);color:var(--en-color-text);font:14px/1.5 system-ui,sans-serif';
  const status=document.createElement('p');status.style.cssText='margin:16px 24px';status.setAttribute('role','status');status.textContent='Connecting…';document.body.append(status);
  const link=readPanelLink(location.href);if(!link){status.textContent='This panel link is invalid. Ask the host for a new link.';return;}
  const panel=new StillDeveloperConsole();panel.detached=true;panel.remote=true;
  let scope='';
  const viewer=new RemotePanelViewer(link,snapshot=>{
    if(scope!==snapshot.scope){panel.context=undefined as never;scope=snapshot.scope;}
    for(const key of ['scope','context','applied','received','pending','controls'] as const){if(JSON.stringify(panel[key])!==JSON.stringify(snapshot[key]))Object.assign(panel,{[key]:snapshot[key]});}
    panel.hostVisible=snapshot.shared.visible;
  },(message,live)=>{status.textContent=message;panel.hidden=!live;panel.inert=!live;});
  panel.addEventListener('developer-next-best',e=>void viewer.command('next-best',(e as CustomEvent).detail.value));
  panel.addEventListener('developer-flags',e=>void viewer.command('flags',(e as CustomEvent).detail.value));
  panel.addEventListener('developer-density',e=>void viewer.command('density',(e as CustomEvent).detail.value));
  panel.addEventListener('developer-visibility',e=>void viewer.command('visibility',(e as CustomEvent).detail.value));
  document.body.append(panel);window.addEventListener('pagehide',()=>{viewer.stop();panel.remove();},{once:true});viewer.start();
}
