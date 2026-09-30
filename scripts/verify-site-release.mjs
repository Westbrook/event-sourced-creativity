/** Offline preflight only. Never fetches, pushes, deploys, changes access or applies SQL. */
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReleaseMigrations} from '../build/release-migrations.ts';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export function verifySource(root,plan){
 if(!sha(plan.baselineCommit)||!sha(plan.candidateCommit)||!plan.projectId||!Array.isArray(plan.allowedPaths)||!plan.allowedPaths.length)throw Error('A verified live baseline, candidate, project and explicit scope are required');
 const paths=plan.allowedPaths;
 if(paths.some(p=>typeof p!=='string'||!p||p.startsWith('/')||p.split('/').includes('..')||p==='.'||p.includes('\\')))throw Error('Invalid allowed source path');
 if(git(root,'rev-parse','HEAD')!==plan.candidateCommit)throw Error('Candidate is not the current checkout');
 git(root,'cat-file','-e',`${plan.baselineCommit}^{commit}`);
 if(git(root,'status','--porcelain'))throw Error('Release checkout must be clean, including untracked source');
 const changed=git(root,'diff','--no-renames','--name-only','-z',plan.baselineCommit,plan.candidateCommit).split('\0').filter(Boolean);
 const unexpected=changed.filter(file=>!paths.some(p=>p.endsWith('/')?file.startsWith(p):file===p));
 if(unexpected.length)throw Error(`Unexpected source changes: ${unexpected.join(', ')}`);
 const manifest=JSON.parse(readFileSync(join(root,'.openai/hosting.json')));
 const baseline=JSON.parse(git(root,'show',`${plan.baselineCommit}:.openai/hosting.json`));
 if(manifest.project_id!==plan.projectId||baseline.project_id!==plan.projectId)throw Error('Site identity mismatch');
 if(git(root,'diff',plan.baselineCommit,plan.candidateCommit,'--','build/memory-migration-release.json','.openai/hosting.json'))throw Error('Hosting or migration policy changed; qualify a separate release');
 return {candidateCommit:plan.candidateCommit,baselineCommit:plan.baselineCommit,projectId:plan.projectId,changed};
}
export async function verifyArchive(root,archive,savedVersion,source){
 const inspected=JSON.parse(execFileSync(process.env.PYTHON||'python3',[fileURLToPath(new URL('./lib/site-release-archive.py',import.meta.url)),resolve(archive)],{encoding:'utf8',maxBuffer:8*1024*1024}));
 const expected={};
 function walk(directory,prefix){
  for(const name of readdirSync(directory).sort()){
   const file=join(directory,name),key=`${prefix}/${name}`,stat=lstatSync(file);
   if(stat.isDirectory())walk(file,key);
   else if(stat.isFile())expected[key]=hash(readFileSync(file));
   else throw Error('Build output contains a non-regular file');
  }
 }
 walk(join(root,'dist'),'dist');
 if(!expected['dist/server/index.js']||!expected['dist/.openai/hosting.json'])throw Error('Missing Worker or hosting manifest');
 if(JSON.stringify(Object.entries(expected).sort())!==JSON.stringify(Object.entries(inspected.files).sort()))throw Error('Archive differs from the tested build');
 const migrations=await verifyReleaseMigrations(root,join(root,'dist/.openai/drizzle'));
 if(hash(readFileSync(join(root,'.openai/hosting.json')))!==expected['dist/.openai/hosting.json'])throw Error('Built Site manifest differs from source');
 if(savedVersion){
  if(savedVersion.project_id!==source.projectId||savedVersion.source?.commit_sha!==source.candidateCommit)throw Error('Saved version source identity mismatch');
  const stored=savedVersion.archive_storage;
  if(stored?.content_hash!==`sha256:${inspected.normalizedSha256}`||stored.file_count!==Object.keys(expected).length||stored.size_bytes!==inspected.normalizedBytes)throw Error('Saved archive receipt does not match inspected content');
 }
 return {archive:resolve(archive),archiveSha256:hash(readFileSync(archive)),normalizedSha256:inspected.normalizedSha256,files:Object.keys(expected).length,migrations:migrations.migrations,savedReceiptVerified:!!savedVersion};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [planPath,archive,receiptPath,...extra]=process.argv.slice(2);
  if(!planPath||!archive||extra.length)throw Error('Usage: node --experimental-strip-types scripts/verify-site-release.mjs plan.json archive.tar [saved-version.json]');
  const root=process.cwd(),plan=JSON.parse(readFileSync(planPath)),source=verifySource(root,plan);
  const saved=receiptPath?JSON.parse(readFileSync(receiptPath)):undefined;
  const evidence=await verifyArchive(root,archive,saved,source);
  // Recheck after archive IO so source changes cannot silently pass this run.
  verifySource(root,plan);
  console.log(JSON.stringify({...source,...evidence,hostedActions:0},null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
