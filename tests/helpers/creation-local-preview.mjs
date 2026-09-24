// Local disposable acceptance environment: actual Worker, in-memory SQLite, no paid providers.
// Run with node --import tsx tests/helpers/creation-local-preview.mjs.
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {existsSync,renameSync} from 'node:fs';
import {createSceneCostFixture} from './scene-cost-fixture.mjs';

const fixture=await createSceneCostFixture(0);
// An optional private local snapshot lets this disposable preview resume drafts
// across server restarts. It is never used by the app or acceptance tests.
const snapshot=process.env.CREATION_PREVIEW_SNAPSHOT;
const quoteIdentifier=value=>'"'+value.replaceAll('"','""')+'"';
if(snapshot&&existsSync(snapshot)){
 fixture.sqlite.prepare('ATTACH DATABASE ? AS recovery').run(snapshot);
 const schema=fixture.sqlite.prepare("SELECT type,name,sql FROM recovery.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
 const existing=fixture.sqlite.prepare("SELECT type,name FROM main.sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC").all();
 fixture.sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN');
 try{
   for(const {type,name} of existing)fixture.sqlite.exec(`DROP ${type} IF EXISTS main.${quoteIdentifier(name)}`);
   for(const {name,sql} of schema.filter(item=>item.type==='table')){
     fixture.sqlite.exec(sql);
     fixture.sqlite.exec(`INSERT INTO main.${quoteIdentifier(name)} SELECT * FROM recovery.${quoteIdentifier(name)}`);
   }
   for(const {sql} of schema.filter(item=>item.type!=='table'))fixture.sqlite.exec(sql);
   fixture.sqlite.exec('COMMIT');
 }catch(error){fixture.sqlite.exec('ROLLBACK');throw error;}
 finally{fixture.sqlite.exec('DETACH DATABASE recovery; PRAGMA foreign_keys=ON');}
}
function checkpoint(){
 if(!snapshot)return;
 const temporary=snapshot+'.'+crypto.randomUUID()+'.tmp';
 fixture.sqlite.prepare('VACUUM INTO ?').run(temporary);
 renameSync(temporary,snapshot);
}
fixture.env.STILL_UNIFIED_CREATION_ENABLED='true';
fixture.env.OPENAI_API_KEY='';
fixture.env.JEV_API_KEY='';
const document=await readFile(new URL('../../still.html',import.meta.url), 'utf8');
const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-creation-acceptance',optimizeDeps:{entries:['src/still/entry.ts']},
 // Polling keeps this long-running preview current when editor writes do not
 // propagate native filesystem events into the preview process.
 server:{host:'127.0.0.1',port:Number(process.env.CREATION_PREVIEW_PORT||5191),strictPort:true,watch:{usePolling:true,interval:250}},
 plugins:[{name:'creation-local-worker',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
   if(req.url?.startsWith('/api/')){
     try{
       const chunks=[];for await(const chunk of req)chunks.push(chunk);
       const body=Buffer.concat(chunks);
       // The fixture's Request URL is http://localhost. Match the loopback UI origin
       // to that test transport; production CSRF checks remain active and unchanged.
       const headers={...req.headers};delete headers.host;
       if(headers.origin)headers.origin='http://localhost';
       const response=await fixture.request(req.url,{method:req.method,headers,...(body.length?{body}: {})});
       await fixture.drainBackground();
       checkpoint();
       res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
     }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(error)}));}
     return;
   }
   if(req.url?.startsWith('/still')){res.setHeader('content-type','text/html');res.end(await vite.transformIndexHtml('/still.html',document));return;}
   next();
 });}}]});
await server.listen();
console.log(`Disposable Still creation acceptance preview: http://127.0.0.1:${server.config.server.port}/still/action/new-project?creation=1&progress-report`);
async function close(){await server.close();await fixture.drainBackground();checkpoint();fixture.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
