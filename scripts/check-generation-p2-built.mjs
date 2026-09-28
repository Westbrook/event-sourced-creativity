// Build the optional host into a local artifact and execute its default-off boundary.
// This installs nothing, uses no credential, and never permits network dispatch.
import {build} from 'vite';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=await mkdtemp(join(tmpdir(),'p2-built-'));
try{
 const artifact=join(root,'host.mjs');
 const result=await build({configFile:false,logLevel:'silent',ssr:{noExternal:true},build:{ssr:'evals/generation-reliability/native-host/host.mjs',outDir:root,emptyOutDir:false,minify:false,rolldownOptions:{output:{entryFileNames:'host.mjs'}}}});
 const outputs=(Array.isArray(result)?result:[result]).flatMap(r=>r.output),sources=[...new Set(outputs.flatMap(o=>Object.keys(o.modules??{})))].filter(p=>!p.includes('\\0')&&!p.startsWith('\0')&&p.startsWith(process.cwd()+'/'));
 const sourceHashes=Object.fromEntries(await Promise.all(sources.sort().map(async p=>[p.slice(process.cwd().length+1),createHash('sha256').update(await readFile(p)).digest('hex')])));
 const artifacts=Object.fromEntries(await Promise.all(outputs.map(async o=>[o.fileName,createHash('sha256').update(await readFile(join(root,o.fileName))).digest('hex')])));
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected provider call');};
 try{
  const {createNativeStudyHost}=await import(pathToFileURL(artifact).href);
  const host=createNativeStudyHost({DB:new Proxy({},{get(){throw Error('default-off must not read database');}})},{plan:{version:'generation-supplied-study-v2'},runtimeIdentity:{}});
  assert.deepEqual(await host.execute(null,{grantId:'never-authorized',trialId:'baseline'}),{action:'disabled',newPurchases:0});assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
 const bytes=await readFile(artifact);console.log(JSON.stringify({check:'bundled optional host default-off',pass:true,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),providerCalls:0,installed:false,sourceHashes,artifacts}));
}finally{await rm(root,{recursive:true,force:true});}
