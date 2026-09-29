import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifySource,verifyArchive} from '../scripts/verify-site-release.mjs';
import {copyReleaseMigrations} from '../build/release-migrations.ts';
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
