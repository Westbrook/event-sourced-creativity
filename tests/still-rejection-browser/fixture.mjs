import '../../src/still/vendor/tokens/default.css';
import '../../src/still/theme.css';
import '../../src/still/style.css';
import '../../src/still/vendor/elements/define/button.js';
import '../../src/still/rejection-page.ts';
import {StillClient} from '../../src/still/client.ts';
import {fixture,scenarios} from './fixtures.mjs';
const select=document.querySelector('#scenario');for(const name of scenarios)select.add(new Option(name,name));
const element=document.querySelector('still-rejection-page');
const session={user:{userId:'synthetic-owner',role:'creator'},policy:{accepted:true},provider:{plannerConfigured:true}};
window.fixtureRequests=[];let active=fixture(),comparison=fixture('image-output-block','comparison');
window.fetch=async(input,init)=>{
 const url=new URL(input,location.href);window.fixtureRequests.push({path:url.pathname+url.search,method:init?.method??'GET'});
 if(url.origin!==location.origin||(init?.method??'GET')!=='GET')throw Error('Offline fixture forbids nonlocal or write requests');
 if(url.pathname==='/api/session')return Response.json(session);
 if(url.pathname.startsWith('/api/document-jobs/')){
  if(url.search!=='?inspection=1')throw Error('No reconciliation permitted');
  const id=decodeURIComponent(url.pathname.split('/').at(-1));
  if(id==='slow')await new Promise(resolve=>window.releaseSlow=resolve);
  if(id==='denied')return Response.json({error:'denied'},{status:403});
  const selected=id==='original'?active:comparison;
  return Response.json({job:{...selected.job,jobId:id}});
 }
 if(url.pathname==='/api/events'){
  const ref=url.searchParams.get('contentId');const selected=window.fixtureRequests.filter(r=>r.path.startsWith('/api/document-jobs/')).at(-1)?.path.includes('original')?active:comparison;
  return Response.json({content:selected.content[ref]!==undefined?{[ref]:selected.content[ref]}:{}});
 }
 throw Error(`Unexpected fixture request ${url}`);
};
const c=new StillClient();c.session=session;c.position={view:'rejection',projectId:'project',documentId:'doc',outputId:'original',blockId:'',intent:'',recentActions:[]};
window.fixtureClient=c;window.fixtureElement=element;
function render(){active=fixture(select.value);element.client=c;element.scope=`synthetic-${select.value}`;}
select.value=new URL(location.href).searchParams.get('case')??'image-output-block';select.onchange=render;render();
