import{readFileSync,writeFileSync,mkdirSync,cpSync,symlinkSync,existsSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import{resolve}from'node:path';import assert from'node:assert/strict';
const base='rehearsal/p5-sites',stage='/private/tmp/forma-p5-sites-diagnostic-r8',ev='docs/evidence/generation-p5/sites-r8',sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(readFileSync(ev+'/../sites-r3/source-manifest.json'));mkdirSync(stage,{recursive:true});
// Retain every historical source file from the admitted native parent.
const parent='1565d8ac8a568bd0b9b7bde789eadc450e384364',native='/private/tmp/forma-p5-sites-publish-r5';
for(const path of execFileSync('git',['-C',native,'ls-tree','-r','--name-only',parent],{encoding:'utf8'}).trim().split('\n')){mkdirSync(stage+'/'+path.split('/').slice(0,-1).join('/'),{recursive:true});writeFileSync(stage+'/'+path,execFileSync('git',['-C',native,'show',parent+':'+path],{maxBuffer:16*1024*1024}));}
for(const f of manifest.files){const b=readFileSync(base+'/'+f.path);assert.equal(sha(b),f.sha256);mkdirSync(stage+'/'+f.path.split('/').slice(0,-1).join('/'),{recursive:true});writeFileSync(stage+'/'+f.path,b);}
cpSync('rehearsal/p5-sites-diagnostic/catalog.mjs',stage+'/src/catalog.mjs');
let worker=readFileSync(base+'/src/worker.mjs','utf8');
const replace=(old,next)=>{assert.equal(worker.split(old).length,2,old);worker=worker.replace(old,next);};
replace("import D from './dataset.json';","import D from './dataset.json';\nimport { CATALOG_SQL, CATALOG_VERSION, boundedCatalog, boundedCatalogResponse } from './catalog.mjs';");
replace('<button id="status">Status</button>','<button id="status">Status</button><button id="catalog">Read catalog</button>');
replace("for(const a of ['status','start','stop','cleanup'])","for(const a of ['status','catalog','start','stop','cleanup'])");
replace("check(['start', 'step', 'status', 'stop', 'cleanup'].includes(action)","check(['start', 'step', 'status', 'stop', 'cleanup', 'catalog'].includes(action)");
replace('                const db = bindings.DB;\n                let state',`                const db = bindings.DB;
                // Branch before every user-row/run read; same native-owner/origin/body gates.
                if (action === 'catalog') {
                    check(Date.now() < expiry, 'catalog_expired');
                    const catalog = boundedCatalog(await all(db, CATALOG_SQL));
                    return boundedCatalogResponse({ ok: true, action, diagnosticVersion: CATALOG_VERSION, dataset: D.datasetId, catalog, metrics: { ...c, bindings: undefined, deadline: undefined }, instance }, headers);
                }
                let state`);
writeFileSync(stage+'/src/worker.mjs',worker);writeFileSync('rehearsal/p5-sites-diagnostic/worker.mjs',worker);
if(!existsSync(stage+'/node_modules'))symlinkSync(resolve('node_modules'),stage+'/node_modules','dir');
execFileSync(process.execPath,[stage+'/build.mjs'],{stdio:'inherit'});
let patch;try{execFileSync('diff',['-u',base+'/src/worker.mjs',stage+'/src/worker.mjs'],{encoding:'utf8'});}catch(e){patch=e.stdout;}
writeFileSync(ev+'/worker.diff',patch);
console.log(JSON.stringify({stage,sourceChanged:['src/worker.mjs','src/catalog.mjs','artifact.json'],migrationsChanged:false,archiveAdmission:'not attempted; later native condition'}));
