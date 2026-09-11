import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// New browser control of the real built component and CSS, with a synthetic Store boundary.
// No held fixtures, real API, paid call, or production export is used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist/client');
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
const entry = Object.values(manifest).find(row => /^assets\/forma-output-requirements-.*\.js$/.test(row.file));
assert.ok(entry, 'Build the current application first');
const styles = [...(manifest['index.html'].css ?? []), ...(entry.css ?? [])];
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${styles.map(css => `<link rel="stylesheet" href="/${css}">`).join('')}
<style>body{display:block;margin:0;padding:24px}main{max-width:960px;margin:auto}#test-ledger{display:block;margin:1rem 0}</style>
<main><h1>Recorded package recovery · isolated check</h1><output id="test-ledger">Exports: 0; downloads: 0</output></main>
<script type="module">
import '/${entry.file}';
const doc='recovery-document', auth={key:'recovery-auth'}, source={key:'recovery-source',generation:1};
const path='/api/output-requirements/deliveries/recovery-manifest?documentId='+doc;
let exports=0,downloads=0;
const options={selected_optional_ids:[],selected_target_ids:[],count_policies:{},suggested_counts:{}};
const snapshot={schemaVersion:1,documentId:doc,projectId:'recovery-project',scope:{kind:'personal',organizationId:null,projectAccessId:null,actorUserId:'user'},revision:'r1',sourceRevision:'s1',requirementRevision:'q1',requirements:[],
  sourceVerification:{status:'verified',reasonCodes:[]},confirmedPlan:{id:'plan',revisionId:'p1',revision:1,sourceDigest:'s1',requirementsDigest:'q1',plan:{targets:[],groups:[],unresolved:[]},confirmationOptions:options,targetContractDigests:{}},
  summary:{scope_known:true,delivery_ready:true,completion:'complete',required_groups:0,selected_optional_obligations:0,next_actions:[]},requirementSummaries:{},requirementFileCounts:{},targetStates:[],results:[],assets:[],grants:[],scopeAmendments:[],
  permissions:{canDownload:true,canAuthor:false,canRequest:false,canReview:false,independentReview:false},capabilities:{nativeGeneration:false,ownedFileAdoption:false,supportedFileExtensions:[],limitations:[],limitationCodes:[]}};
let resource={state:'ready',snapshot,privateRevision:0};
const element=document.createElement('forma-output-requirements');
const ledger=()=>document.querySelector('#test-ledger').textContent='Exports: '+exports+'; downloads: '+downloads;
const store={subscribe:()=>()=>{},captureAuthorizationScope:()=>auth,authorizationScopeActive:v=>v===auth,captureSourceOwnership:()=>source,sourceOwnershipScopeActive:v=>v===source,sourceOwnershipActive:v=>v===source,
  route:{get:()=>'/recovery'},session:{get:()=>({capabilities:['project.read']})},projection:{get:()=>({projectId:'recovery-project',documentId:doc,documents:[],libraryBlocks:[],jobs:[]})},
  outputRequirements:{resource:()=>resource,retainedWrite:()=>null,
    ensure:async()=>{resource={...resource,state:'ready'};element.requestUpdate();return resource;},
    download:async(_doc,url,init)=>{if(url!==path)throw Error('Wrong package');downloads++;ledger();await new Promise(r=>setTimeout(r,120));if(init.signal.aborted)return{status:'unavailable',body:null};return{status:'saved',body:{blob:new Blob(['synthetic package bytes'],{type:'application/zip'}),filename:'recovery-synthetic.zip'}};}},
  outputRequirementCommand:async request=>{if(request.action!=='export')throw Error('Unexpected command');exports++;ledger();resource={...resource,state:'unavailable'};element.requestUpdate();return{status:'saved',body:{ok:true,replayed:false,command:{action:'export',eventId:'recovery-event',manifestId:'recovery-manifest',downloadUrl:path,downloadUrls:[path],partCount:1},snapshot}};}};
element.store=store;element.documentId=doc;element.documentName='Isolated recovery';element.surface='deliver';document.querySelector('main').append(element);
</script></html>`;
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); return; }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!pathname.startsWith('/assets/')) { res.writeHead(404); res.end(); return; }
  const file = resolve(dist, '.' + pathname);
  if (!file.startsWith(dist + '/assets/')) { res.writeHead(404); res.end(); return; }
  try { res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const receipts = [];
  for (const profile of [{ width:1280,height:900,dpr:1 },{ width:360,height:900,dpr:2 }]) {
    const context = await browser.newContext({ viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.dpr,acceptDownloads:true });
    const page = await context.newPage(), errors = [], foreign = [];
    page.on('pageerror', error => errors.push(String(error)));
    await context.route('**/*', route => { if (!route.request().url().startsWith(origin+'/')) { foreign.push(route.request().url()); return route.abort(); } return route.continue(); });
    await page.goto(origin);
    const exportButton=page.getByRole('button',{name:/^Download files and manifest/});
    try { await exportButton.click({timeout:10000}); } catch(error) { throw new Error(JSON.stringify({errors,body:await page.locator('body').innerText(),cause:String(error)})); }
    const recovery=page.getByRole('button',{name:/^Download recorded package/});
    await recovery.waitFor(); assert.equal(await recovery.getAttribute('aria-disabled'),'true');
    assert.match(await page.locator('#test-ledger').innerText(),/Exports: 1; downloads: 0/);
    await page.getByRole('button',{name:/^Refresh outputs/}).click();
    await page.waitForFunction(()=>document.querySelector('.output-package-parts button')?.getAttribute('aria-disabled')==='false');
    assert.match(await page.locator('#test-ledger').innerText(),/Exports: 1; downloads: 0/);
    // Navigate from the actual Refresh control, rather than force-focus an offscreen node.
    for(let step=0;step<20 && !await recovery.evaluate(node=>node===document.activeElement);step++) await page.keyboard.press('Tab');
    const focusBefore=await recovery.boundingBox();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const focusAfterTab=await recovery.boundingBox();
    assert.equal(await recovery.evaluate(node=>node===document.activeElement),true);
    const download=page.waitForEvent('download'); await page.keyboard.press('Enter');
    assert.equal(await recovery.getAttribute('aria-disabled'),'true');
    assert.equal(await recovery.evaluate(node=>node===document.activeElement),true);
    const received=await download; assert.equal(received.suggestedFilename(),'recovery-synthetic.zip');
    await page.waitForFunction(()=>document.querySelector('.output-package-recovery')?.textContent.includes('Check your browser'));
    assert.match(await page.locator('#test-ledger').innerText(),/Exports: 1; downloads: 1/);
    assert.equal(await recovery.evaluate(node=>node===document.activeElement && node.matches(':focus-visible')),true);
    // Native focus can start the application's smooth scroll; wait for the actual
    // focused control to enter the viewport instead of capturing an animation frame.
    await page.waitForFunction(()=>{const r=document.querySelector('.output-package-parts button')?.getBoundingClientRect();return r && r.top>=6 && r.bottom<=innerHeight-6;},{},{timeout:2000});
    const layout=await page.evaluate(()=>{const rect=document.querySelector('.output-package-parts button').getBoundingClientRect();return{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth-innerWidth,focusTop:rect.top,focusBottom:rect.bottom};});
    assert.equal(layout.overflow,0);
    assert.ok(layout.focusTop>=0 && layout.focusBottom<=layout.height, JSON.stringify({layout,focusBefore,focusAfterTab}));
    const evidence=process.env.FORMA_RECOVERY_EVIDENCE_DIR;
    if(evidence)mkdirSync(evidence,{recursive:true});
    const shot=await page.screenshot({fullPage:false,scale:'device',...(evidence?{path:resolve(evidence,`recovery-${profile.width}-dpr${profile.dpr}.png`)}:{})});
    const captured={width:shot.readUInt32BE(16),height:shot.readUInt32BE(20)};
    assert.equal(captured.width,layout.width*layout.dpr);assert.equal(captured.height,layout.height*layout.dpr);
    assert.deepEqual(errors,[]);
    // The shipped stylesheet imports Google Fonts. Keep it blocked and declare
    // fallback-font layout coverage; no network access is needed for this check.
    assert.ok(foreign.every(url=>url==='https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap'));
    receipts.push({profile,layout,captured,exportPosts:1,downloadGets:1,keyboardFocus:'preserved',actualBrowserDownload:'synthetic fixture only',blockedFontRequests:foreign.length});
    await context.close();
  }
  console.log(JSON.stringify({status:'passed',component:entry.file,receipts},null,2));
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
