import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exampleManifests, firstScreen } from '../evals/generation-reliability/catalog.mjs';
import { legacyCorpusInventory } from '../evals/generation-reliability/cases.mjs';
import { HIST, PROD, validateManifest } from '../evals/generation-reliability/core.mjs';
import { outcomeFixtures } from '../evals/generation-reliability/fixtures/outcomes.mjs';
import { runMockTrials } from '../evals/generation-reliability/results.mjs';
import { qualifyCell } from '../evals/generation-reliability/capabilities.mjs';
async function writeSnapshot(path, content, options) {
  try { await writeFile(path,content,{...options,flag:'wx'}); }
  catch(error) {
    if(error.code!=='EEXIST') throw error;
    if(await readFile(path,'utf8')!==content) throw new Error('immutable_example_exists_choose_new_output_directory');
  }
}
const args=process.argv.slice(2);
if(args.some(a=>a!=='--check'&&!a.startsWith('--out='))) throw new Error('Only --check and --out=<directory> supported. Live execution is not implemented.');
const manifests=[...exampleManifests(),firstScreen()];
for(const m of manifests) validateManifest(m);
const inventory=legacyCorpusInventory();
if(!args.includes('--check')){
  const out=resolve(args.find(a=>a.startsWith('--out='))?.slice(6)??'evals/generation-reliability/examples');
  await mkdir(out,{recursive:true,mode:0o700});
  for(const m of manifests) await writeSnapshot(resolve(out,`${m.experiment}.json`),`${JSON.stringify(m,null,2)}\n`,{mode:0o600});
  await writeSnapshot(resolve(out,'capability-qualification.json'),`${JSON.stringify(manifests.flatMap(m=>m.cells.map(qualifyCell)),null,2)}\n`,{mode:0o600});
  const screen=manifests.at(-1);
  const mocked=Object.fromEntries(Object.entries(outcomeFixtures(screen.cases[0])).map(([name,fixture])=>[name,runMockTrials(screen,{[screen.trials[0].id]:fixture})]));
  await writeSnapshot(resolve(out,'mocked-outcomes.json'),`${JSON.stringify(mocked,null,2)}\n`,{mode:0o600});
  await writeSnapshot(resolve(out,'baselines.json'),`${JSON.stringify({HIST,PROD},null,2)}\n`,{mode:0o600});
  await writeSnapshot(resolve(out,'legacy-corpus-inventory.json'),`${JSON.stringify(inventory,null,2)}\n`,{mode:0o600});
}
console.log(JSON.stringify({valid:true,manifests:manifests.length,planned:manifests.reduce((n,m)=>n+m.trials.length,0),initiated:0,dispatched:0,completed:0,blocked:0,unexecuted:manifests.reduce((n,m)=>n+m.trials.length,0),legacyCases:inventory.length,providerCalls:0,authorizedCostMicrousd:0,maximumFutureCostMicrousd:null,liveExecution:'not_implemented'}));
