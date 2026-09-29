import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';

export type MigrationReleasePolicy={version:1;mode:string;baselineCommit:string;baselineVersion:number;sourceJournalSha256:string;baselineJournal:string;files:{path:string;sha256:string}[]};
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
function fail():never{throw Error('migration_release_unqualified');}
export async function releaseMigrationPolicy(root:string):Promise<MigrationReleasePolicy>{
 const policy=JSON.parse(await readFile(join(root,'build/memory-migration-release.json'),'utf8')) as MigrationReleasePolicy;
 if(policy.version!==1||policy.mode!=='hold-unqualified-memory-migrations'||!/^[0-9a-f]{40}$/.test(policy.baselineCommit)||!Number.isSafeInteger(policy.baselineVersion)||!Array.isArray(policy.files)||!policy.files.length)fail();
 const source=await readFile(join(root,'drizzle/meta/_journal.json'));
 if(hash(source)!==policy.sourceJournalSha256)fail();
 const current=JSON.parse(source.toString()),baseline=JSON.parse(policy.baselineJournal);
 if(!Array.isArray(baseline.entries)||JSON.stringify(current.entries.slice(0,baseline.entries.length))!==JSON.stringify(baseline.entries)||policy.files.length!==baseline.entries.length)fail();
 for(const [index,file] of policy.files.entries()){
  if(!/^[a-zA-Z0-9_]+\.sql$/.test(file.path)||file.path!==baseline.entries[index].tag+'.sql'||!/^[0-9a-f]{64}$/.test(file.sha256))fail();
  const name=join(root,'drizzle',file.path);if(!(await lstat(name)).isFile()||hash(await readFile(name))!==file.sha256)fail();
 }
 return policy;
}
/** This controls the deployment artifact only. Candidate SQL is kept intact in
 * source, and no live database or applied-history receipt is read or changed. */
export async function copyReleaseMigrations(root:string,destination:string){
 const policy=await releaseMigrationPolicy(root);
 await rm(destination,{recursive:true,force:true});await mkdir(join(destination,'meta'),{recursive:true});
 for(const file of policy.files){const bytes=await readFile(join(root,'drizzle',file.path));if(hash(bytes)!==file.sha256)fail();await writeFile(join(destination,file.path),bytes);}
 await writeFile(join(destination,'meta/_journal.json'),policy.baselineJournal);
 await verifyReleaseMigrations(root,destination);
}
export async function verifyReleaseMigrations(root:string,destination:string){
 const policy=await releaseMigrationPolicy(root),expected=new Map(policy.files.map(f=>[f.path,f.sha256]));expected.set('meta/_journal.json',hash(policy.baselineJournal));
 const seen:string[]=[];
 async function walk(directory:string,prefix=''){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const name=prefix+entry.name;
   if(entry.isDirectory()){if(name!=='meta')fail();await walk(join(directory,entry.name),name+'/');}
   else {if(!entry.isFile()||!expected.has(name)||hash(await readFile(join(directory,entry.name)))!==expected.get(name))fail();seen.push(name);}
  }
 }
 await walk(destination);if(seen.length!==expected.size)fail();
 return {mode:policy.mode,baselineCommit:policy.baselineCommit,baselineVersion:policy.baselineVersion,migrations:policy.files.length,sourceJournalSha256:policy.sourceJournalSha256};
}

/** Explicit offline candidate selection, never called by the normal build.
 * Requires independent hosted review before this 42-file directory can be used. */
export async function copyStudyPairCandidateMigrations(root:string,destination:string){
 const candidate=JSON.parse(await readFile(join(root,'build/study-pair-migration-candidate.json'),'utf8'));
 const baseline=await releaseMigrationPolicy(root);
 if(candidate.version!==1||candidate.mode!=='local-only-fresh-study-v3'||candidate.baselinePolicySha256!==hash(await readFile(join(root,'build/memory-migration-release.json')))||baseline.files.length!==41||candidate.source!=='db/generation-study-pair-v3.pending.sql'||candidate.path!=='0074_generation_study_pair_v3.sql'||baseline.files.some(f=>f.path===candidate.path))fail();
 const sql=await readFile(join(root,candidate.source));if(hash(sql)!==candidate.sha256)fail();
 await copyReleaseMigrations(root,destination);
 const journal=JSON.parse(baseline.baselineJournal),last=journal.entries.at(-1);
 if(candidate.entry.idx!==last.idx+1||candidate.entry.tag+'.sql'!==candidate.path||candidate.entry.version!==last.version||!Number.isSafeInteger(candidate.entry.when)||candidate.entry.when<=last.when||candidate.entry.breakpoints!==true)fail();
 journal.entries.push(candidate.entry);
 await writeFile(join(destination,candidate.path),sql);await writeFile(join(destination,'meta/_journal.json'),JSON.stringify(journal,null,2)+'\n');
 const expected=new Map(baseline.files.map(f=>[f.path,f.sha256]));expected.set(candidate.path,candidate.sha256);
 const names=(await readdir(destination)).filter(n=>n.endsWith('.sql'));
 if(names.length!==42||names.some(n=>!expected.has(n)))fail();
 for(const [name,sha] of expected)if(hash(await readFile(join(destination,name)))!==sha)fail();
 return {mode:candidate.mode,migrations:42,unchangedBaseline:41,heldExcluded:31,additiveSchemaSha256:candidate.sha256,nativeAdmission:false,hostedExecutionAuthorized:false};
}
