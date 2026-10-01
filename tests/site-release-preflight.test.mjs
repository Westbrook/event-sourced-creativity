import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifySource,verifyArchive} from '../scripts/verify-site-release.mjs';
import {copyReleaseMigrations} from '../build/release-migrations.ts';
import {STILL_JOURNAL_TRANSITION,STILL_USER_SETTINGS_JOURNAL_TRANSITION,memoryRepairJournal} from '../scripts/lib/still-migration-journal.mjs';
const run=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const write=(root,file,value)=>{mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),value);};
async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'site-release-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 run(root,'init','-q');run(root,'config','user.name','Fixture');run(root,'config','user.email','fixture@example.invalid');
 write(root,'.gitignore','/dist/\n');write(root,'.openai/hosting.json',JSON.stringify({project_id:'fixture-site',d1:'DB',r2:'MEDIA'}));
 write(root,'src/still/motion.js','export const time=1;');
 for(const path of ['build/memory-migration-release.json','drizzle'])cpSync(new URL('../'+path,import.meta.url),join(root,path),{recursive:true});
 run(root,'add','.');run(root,'commit','-qm','baseline');const baselineCommit=run(root,'rev-parse','HEAD');
 write(root,'src/still/motion.js','export const time=2;');run(root,'add','.');run(root,'commit','-qm','toolbar');
 const plan={baselineCommit,candidateCommit:run(root,'rev-parse','HEAD'),projectId:'fixture-site',allowedPaths:['src/still/']};
 write(root,'dist/server/index.js','/* fictional Worker */');write(root,'dist/.openai/hosting.json',readFileSync(join(root,'.openai/hosting.json')));
 await copyReleaseMigrations(root,join(root,'dist/.openai/drizzle'));
 const archive=join(root,'..',root.split('/').at(-1)+'.tar');t.after(()=>rmSync(archive,{force:true}));
 execFileSync('tar',['-cf',archive,'-C',root,'dist'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
 return {root,plan,archive};
}
test('release preflight admits only explicit changes on the verified baseline',async t=>{
 const {root,plan}=await fixture(t);assert.deepEqual(verifySource(root,plan).changed,['src/still/motion.js']);
 write(root,'worker/index.ts','unexpected');run(root,'add','.');run(root,'commit','-qm','unrelated');
 assert.throws(()=>verifySource(root,{...plan,candidateCommit:run(root,'rev-parse','HEAD')}),/Unexpected source changes/);
});
test('release preflight rejects dirty source and a changed Site identity',async t=>{
 const {root,plan}=await fixture(t);write(root,'untracked.js','extra');assert.throws(()=>verifySource(root,plan),/clean/);rmSync(join(root,'untracked.js'));
 assert.throws(()=>verifySource(root,{...plan,projectId:'wrong-site'}),/identity/);
 assert.throws(()=>verifySource(root,{...plan,candidateCommit:plan.baselineCommit}),/current checkout/);
});
test('archive and native receipt bind the exact Worker, migrations, source and canonical tar',async t=>{
 const {root,plan,archive}=await fixture(t);const source=verifySource(root,plan),evidence=await verifyArchive(root,archive,null,source);
 assert.equal(evidence.migrations,41);
 const script=new URL('../scripts/lib/site-release-archive.py',import.meta.url);
 const inspection=JSON.parse(execFileSync('python3',[script.pathname,archive],{encoding:'utf8'}));
 const saved={project_id:plan.projectId,source:{commit_sha:plan.candidateCommit},archive_storage:{content_hash:'sha256:'+evidence.normalizedSha256,file_count:evidence.files,size_bytes:inspection.normalizedBytes}};
 assert.equal((await verifyArchive(root,archive,saved,source)).savedReceiptVerified,true);
 const planPath=archive+'.plan.json',receiptPath=archive+'.saved.json';
 writeFileSync(planPath,JSON.stringify(plan));writeFileSync(receiptPath,JSON.stringify(saved));
 t.after(()=>{rmSync(planPath,{force:true});rmSync(receiptPath,{force:true});});
 const cli=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types',new URL('../scripts/verify-site-release.mjs',import.meta.url).pathname,planPath,archive,receiptPath],{cwd:root,encoding:'utf8'}));
 assert.equal(cli.savedReceiptVerified,true);assert.equal(cli.hostedActions,0);

 await assert.rejects(()=>verifyArchive(root,archive,{...saved,source:{commit_sha:plan.baselineCommit}},source),/identity/);
 await assert.rejects(()=>verifyArchive(root,archive,{...saved,archive_storage:{...saved.archive_storage,content_hash:'sha256:bad'}},source),/receipt/);
 write(root,'dist/server/index.js','different Worker');await assert.rejects(()=>verifyArchive(root,archive,null,source),/differs/);
});
test('archive inspection rejects links and directory traversal without extraction',async t=>{
 const {archive}=await fixture(t),script=new URL('../scripts/lib/site-release-archive.py',import.meta.url).pathname;
 for(const name of ['../outside','dist/link']){
  execFileSync('python3',['-c',"import tarfile,sys\nwith tarfile.open(sys.argv[1],'w') as t:\n i=tarfile.TarInfo(sys.argv[2]);i.type=tarfile.SYMTYPE;i.linkname='/etc/passwd';t.addfile(i)",archive,name]);
  assert.throws(()=>execFileSync('python3',[script,archive],{stdio:'pipe'}));
 }
});
test('archive rejects an extra candidate migration even when it matches dist',async t=>{
 const {root,plan,archive}=await fixture(t);write(root,'dist/.openai/drizzle/candidate.sql','CREATE TABLE not_approved(x);');
 execFileSync('tar',['-cf',archive,'-C',root,'dist'],{env:{...process.env,COPYFILE_DISABLE:'1'}});await assert.rejects(()=>verifyArchive(root,archive,null,plan),/migration_release_unqualified/);
});

const policyFile='build/memory-migration-release.json',journalFile='drizzle/meta/_journal.json';
const originalSql='drizzle/0074_still_action_outcomes.sql',settingsSql='drizzle/0075_still_user_settings.sql';
const journalCases=[
 {transition:STILL_JOURNAL_TRANSITION,count:73,sqlFile:originalSql},
 {transition:STILL_USER_SETTINGS_JOURNAL_TRANSITION,count:74,sqlFile:settingsSql},
];
async function journalFixture(t,{transition,count,sqlFile}){
 const f=await fixture(t),{root}=f;
 const files=[policyFile,journalFile,originalSql,...(count===74?[settingsSql]:[])];
 const saved=Object.fromEntries(files.map(file=>[file,readFileSync(join(root,file),'utf8')]));
 const currentJournal=JSON.parse(saved[journalFile]),currentPolicy=JSON.parse(saved[policyFile]);
 saved[journalFile]=JSON.stringify({...currentJournal,entries:currentJournal.entries.slice(0,count)},null,2)+'\n';
 saved[policyFile]=saved[policyFile].replace(currentPolicy.sourceJournalSha256,transition.after);
 write(root,policyFile,saved[policyFile].replace(transition.after,transition.before));
 write(root,journalFile,JSON.stringify({...currentJournal,entries:currentJournal.entries.slice(0,count-1)},null,2)+'\n');
 rmSync(join(root,sqlFile));if(count===73)rmSync(join(root,settingsSql));
 run(root,'add','.');run(root,'commit','-qm','historical journal');
 const baselineCommit=run(root,'rev-parse','HEAD');
 for(const file of files)write(root,file,saved[file]);run(root,'add','.');run(root,'commit','-qm','qualified Still journal');
 return {...f,saved,plan:{...f.plan,baselineCommit,candidateCommit:run(root,'rev-parse','HEAD'),allowedPaths:[...f.plan.allowedPaths,policyFile,'drizzle/'],migrationSourceJournalTransition:{...transition}}};
}
for(const journalCase of journalCases){
 const {transition,sqlFile}=journalCase;
 test(`exact ${transition.kind} journal extension retains41 packaged migrations and the historical repair contract`,async t=>{
  const {root,plan,archive,saved}=await journalFixture(t,journalCase),source=verifySource(root,plan);
  assert.deepEqual(source.migrationSourceQualification,{...transition,packagedMigrationPolicy:'unchanged'});
  const proposal='drizzle/candidates/still_semantic_index.sql';
  assert.equal(readFileSync(join(root,proposal),'utf8'),readFileSync(new URL('../'+proposal,import.meta.url),'utf8'));
  const evidence=await verifyArchive(root,archive,null,source);assert.equal(evidence.migrations,41);
  assert.deepEqual(memoryRepairJournal(saved[journalFile],saved),{count:72,sourceJournalSha256:STILL_JOURNAL_TRANSITION.before});
  if(transition===STILL_JOURNAL_TRANSITION)assert.deepEqual(memoryRepairJournal(saved[journalFile],saved[sqlFile]),{count:72,sourceJournalSha256:STILL_JOURNAL_TRANSITION.before});
  const manifest=new URL('../worker/memory-schema-repair-manifest.json',import.meta.url),before=readFileSync(manifest,'utf8'),contract=JSON.parse(before);
  assert.equal(contract.migrations.length,31);assert.equal(contract.sha256,'fd1752125f0e8818adc70a7805e74413c00d165adc898ccb2b2ad8ab25bd3ef9');
  execFileSync(process.execPath,[new URL('../scripts/generate-memory-schema-repair.mjs',import.meta.url).pathname,'--check'],{stdio:'pipe'});
  assert.equal(readFileSync(manifest,'utf8'),before);
 });
 test(`${transition.kind} qualification rejects absent declarations and unrelated policy or schema changes`,async t=>{
  const {root,plan,saved}=await journalFixture(t,journalCase);
  for(const declaration of [undefined,{...transition,before:'0'.repeat(64)},{...transition,after:'0'.repeat(64)},{...transition,sql:'0'.repeat(64)},{...transition,extra:true},journalCases.find(other=>other!==journalCase).transition]){
   assert.throws(()=>verifySource(root,{...plan,migrationSourceJournalTransition:declaration}),/Unreviewed/);
  }
  const mutations=[
   ...['files','baselineJournal','mode','reason','baselineVersion','extra'].map(key=>[policyFile,()=>JSON.stringify({...JSON.parse(saved[policyFile]),[key]:'changed'},null,2)+'\n']),
   [policyFile,()=>saved[policyFile]+'\n'],
   [journalFile,()=>{const j=JSON.parse(saved[journalFile]);j.entries.at(-1).when++;return JSON.stringify(j,null,2)+'\n';}],
   [journalFile,()=>{const j=JSON.parse(saved[journalFile]);j.entries[0].when++;return JSON.stringify(j,null,2)+'\n';}],
   [journalFile,()=>{const j=JSON.parse(saved[journalFile]);j.entries.push({...j.entries.at(-1),idx:j.entries.length,tag:'0076_extra'});return JSON.stringify(j,null,2)+'\n';}],
   [sqlFile,()=>saved[sqlFile]+'\n-- changed'],
   ...(transition===STILL_USER_SETTINGS_JOURNAL_TRANSITION?[[originalSql,()=>saved[originalSql]+'\n-- changed historical Still schema']]:[]),
  ];
  for(const [file,mutate] of mutations){
   write(root,file,mutate());run(root,'add','.');run(root,'commit','-qm','negative mutation');
   assert.throws(()=>verifySource(root,{...plan,candidateCommit:run(root,'rev-parse','HEAD')}),/Unreviewed/);
   write(root,file,saved[file]);run(root,'add','.');run(root,'commit','-qm','restore fixture');
  }
  const extraSql='drizzle/0076_extra.sql';write(root,extraSql,'CREATE TABLE not_approved(x);');run(root,'add','.');run(root,'commit','-qm','unjournaled SQL');
  assert.throws(()=>verifySource(root,{...plan,candidateCommit:run(root,'rev-parse','HEAD')}),/Unreviewed/);
  rmSync(join(root,extraSql));run(root,'add','.');run(root,'commit','-qm','restore fixture');
  const oldSql='drizzle/0000_lively_owl.sql';write(root,oldSql,readFileSync(join(root,oldSql),'utf8')+'\n-- historical mutation');run(root,'add','.');run(root,'commit','-qm','historical SQL');
  assert.throws(()=>verifySource(root,{...plan,candidateCommit:run(root,'rev-parse','HEAD')}),/Historical migration/);
  assert.throws(()=>memoryRepairJournal(saved[journalFile],{...saved,[sqlFile]:saved[sqlFile]+'changed'}),/Unreviewed/);
  if(transition===STILL_USER_SETTINGS_JOURNAL_TRANSITION){
   assert.throws(()=>memoryRepairJournal(saved[journalFile],saved[settingsSql]),/Unreviewed/);
   assert.throws(()=>memoryRepairJournal(saved[journalFile],{[settingsSql]:saved[settingsSql]}),/Unreviewed/);
   assert.throws(()=>memoryRepairJournal(saved[journalFile],{...saved,[originalSql]:saved[originalSql]+'changed'}),/Unreviewed/);
  }
 });
}
test('source migration changes cannot bypass qualification by leaving the policy unchanged',async t=>{
 const {root,plan}=await fixture(t);
 write(root,journalFile,readFileSync(join(root,journalFile),'utf8')+'\n');run(root,'add','.');run(root,'commit','-qm','undeclared journal');
 assert.throws(()=>verifySource(root,{...plan,candidateCommit:run(root,'rev-parse','HEAD'),allowedPaths:[...plan.allowedPaths,'drizzle/']}),/Unreviewed/);
});
