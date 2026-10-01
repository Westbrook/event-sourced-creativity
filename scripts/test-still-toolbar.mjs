/** Synthetic-only batch. One owned Vite server; fresh browser state per case. */
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixtureServer } from '../tests/browser/helpers/still-toolbar.mjs';
import { fingerprint, withLock, runProcess, atomicJSON } from './lib/validation-process.mjs';

const argv=process.argv.slice(2),browserOnly=argv.includes('--browser-only');
const browsers=argv.find(a=>!a.startsWith('--'))||'chromium,firefox,webkit';
if(argv.some(a=>a.startsWith('--')&&a!=='--browser-only')||!browsers.split(',').every(name=>['chromium','firefox','webkit'].includes(name)))throw Error('Use [chromium,firefox,webkit] [--browser-only]');
const root=process.cwd(),input=fingerprint(root,{tests:true}),id=randomUUID();
const directory=resolve(root,'outputs/validation','toolbar-'+id),results=[];
const unitFiles=['still-toolbar-fit','still-thread-timing','still-toolbar-rhythm','still-toolbar-transport','still-decision-cache','still-generation-decision','still-direct-create'].map(s=>'tests/'+s+'.test.mjs');
const browserFiles=['motion','interruption','zoom','keyboard','orientation','geometry'].map(s=>'tests/browser/still-toolbar-'+s+'.test.mjs');
async function run(name,files,env={}){
 const result=await runProcess(process.execPath,['--import','tsx','--test','--test-concurrency=2',...files],{cwd:root,log:resolve(directory,name+'.log'),env:{STILL_TOOLBAR_BROWSERS:browsers,...env}});
 results.push({name,...result});if(result.code)throw Error(`${name} failed; see ${directory}`);
}
try{
 if(!browserOnly)await run('units',unitFiles);
 await withLock(resolve(root,'outputs/validation/toolbar-cache.lock'),async()=>{
  const identity={version:1,owner:process.pid,id,input,mode:'synthetic-toolbar-source'};
  const server=await fixtureServer({owned:true,identity,cacheDir:resolve(root,'outputs/validation/toolbar-vite-cache')});
  const lease={origin:`http://127.0.0.1:${server.httpServer.address().port}`,identity};
  try{await run('browsers',browserFiles,{STILL_TOOLBAR_FIXTURE:JSON.stringify(lease)});}
  finally{await server.close();}
 });
 if(input!==fingerprint(root,{tests:true}))throw Error('Source changed during the toolbar batch; results cannot qualify the new candidate.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{atomicJSON(resolve(directory,'receipt.json'),{input,browsers,browserOnly,serverStarts:results.some(r=>r.name==='browsers')?1:0,results,status:process.exitCode?'failed':'passed'});console.log(directory);}
