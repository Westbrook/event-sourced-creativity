// Read-only local assessment. No runtime test, credential, remote, or Site mutation.
import {readFileSync,readdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const hash=x=>createHash('sha256').update(x).digest('hex');
const source='38062b07d3456979885a373eef9970d1c2a78a9b';
const envelope=JSON.parse(readFileSync('docs/evidence/generation-p5/sites-r1/release-envelope.json'));
for(const [path,digest] of Object.entries(envelope.sources)){
 assert.equal(hash(readFileSync(path)),digest,path);
 assert.equal(hash(execFileSync('git',['show',source+':'+path])),digest,path+' source commit');
}
const archive=envelope.archive.archive;assert.equal(hash(readFileSync(archive)),envelope.archive.sha256);
const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');assert(entries.every(p=>p==='dist/'||p.startsWith('dist/')&&!p.split('/').includes('..')));
const tmp=mkdtempSync(join(tmpdir(),'p5-r2-archive-'));let migrationFiles;
try{
 execFileSync('tar',['-xzf',archive,'-C',tmp]);
 for(const [path,digest] of Object.entries(envelope.built))assert.equal(hash(readFileSync(join(tmp,path))),digest,path);
 migrationFiles=readdirSync(join(tmp,'dist/.openai/drizzle')).filter(p=>p.endsWith('.sql')).sort();assert.equal(migrationFiles.length,41);
}finally{rmSync(tmp,{recursive:true,force:true});}
if(process.argv.includes('--release-gate')){
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source);
 assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'');
 console.log(JSON.stringify({releaseGate:true,sourceCommit:source,archive:envelope.archive.archive,sha256:envelope.archive.sha256,migrations:41,sourceUnchanged:true}));process.exit(0);
}
const siteSql='/private/tmp/forma-n10h-sites/next-tasks/n10h-sites/v35/rehearsal/drizzle/0000_hesitant_red_skull.sql';
const retired=new DatabaseSync(':memory:'),current=new DatabaseSync(':memory:');retired.exec(readFileSync(siteSql,'utf8'));
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())current.exec(readFileSync('drizzle/'+file,'utf8'));
for(const file of ['generation-study.pending.sql','generation-study-supplied-v2.pending.sql','authoring-study-approval.pending.sql'])current.exec(readFileSync('db/'+file,'utf8'));
const query="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name";
const oldRows=retired.prepare(query).all(),newRows=current.prepare(query).all(),byName=new Map(newRows.map(r=>[r.name,r]));
const overlap=oldRows.filter(r=>byName.has(r.name)).map(r=>({name:r.name,type:r.type,sqlIdentical:r.sql===byName.get(r.name).sql,columns:r.type==='table'?JSON.stringify(retired.prepare(`PRAGMA table_info("${r.name}")`).all())===JSON.stringify(current.prepare(`PRAGMA table_info("${r.name}")`).all()):null}));
const receipt={version:'p5-sites-r2-local-assessment',sourceCommit:source,main:execFileSync('git',['rev-parse','main'],{encoding:'utf8'}).trim(),sourceHashesMatched:Object.keys(envelope.sources).length,archiveHash:envelope.archive.sha256,archiveFilesMatched:Object.keys(envelope.built).length,heldMigrations:migrationFiles.length,sourceMigrationFiles:readdirSync('drizzle').filter(f=>f.endsWith('.sql')).length,studySchemaPackaged:false,runtimeChanged:false,oldTestsRerun:false,retiredN10H:{schemaHash:hash(readFileSync(siteSql)),objects:oldRows.length,tables:oldRows.filter(r=>r.type==='table').length,commonObjects:overlap,additionalP5Objects:newRows.filter(r=>!oldRows.some(o=>o.name===r.name)).length,originalOnlyObjects:oldRows.filter(r=>!byName.has(r.name)).map(r=>r.name),note:'Local historical schema comparison, not current managed schema attestation or an installation plan. Preserve tombstone; never replay original importer.'}};
retired.close();current.close();
const output=JSON.stringify(receipt,null,2)+'\n';writeFileSync('docs/evidence/generation-p5/sites-r2/local-assessment.json',output);console.log(JSON.stringify({...receipt,retiredN10H:{...receipt.retiredN10H,commonObjects:receipt.retiredN10H.commonObjects.length,mismatchedDefinitions:overlap.filter(x=>!x.sqlIdentical).length,mismatchedTableColumns:overlap.filter(x=>x.columns===false).map(x=>x.name)}}));
