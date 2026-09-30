import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium,firefox,webkit} from '@playwright/test';

const engines={chromium,firefox,webkit};
export const toolbarBrowsers=(process.env.STILL_TOOLBAR_BROWSERS||'chromium').split(',').map(name=>{
 if(!engines[name])throw new Error(`Unknown toolbar browser: ${name}`);
 return [name,engines[name]];
});

export async function mountToolbarFixture(page,url){
 await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'fixture_only'}}));
 await page.goto(url);
 await page.evaluate(async()=>{const {mountStillMotionFixture}=await import('/tests/browser/fixtures/still-toolbar-motion.js');await mountStillMotionFixture();});
}

export async function fixtureServer(){
 const cacheDir=await mkdtemp(join(tmpdir(),'still-toolbar-vite-'));
 const server=await createServer({configFile:false,cacheDir,optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');});}}]});
 const close=server.close.bind(server);
 server.close=async()=>{try{await close();}finally{await rm(cacheDir,{recursive:true,force:true});}};
 try{await server.listen();return server;}catch(error){await server.close();throw error;}
}

export const fixtureURL=server=>`http://127.0.0.1:${server.httpServer.address().port}/still/project/p/document/d`;
export const ready=page=>page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='ready');
export const activePhase=(page,phase)=>page.waitForFunction(phase=>{
 const root=document.querySelector('.toolbar-motion-root');
 return root?.dataset.toolbarPhase===phase&&root.querySelector('.toolbar-motion-visual').getAnimations({subtree:true}).some(a=>a.playState==='running');
},phase);
