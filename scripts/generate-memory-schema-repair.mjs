import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readLocalMigrations,migrateLocalDatabase} from './lib/local-migrations.mjs';
import {memoryRepairJournal} from './lib/still-migration-journal.mjs';
const root=new URL('../',import.meta.url), allMigrations=readLocalMigrations(new URL('drizzle/',root));
const policy=JSON.parse(readFileSync(new URL('build/memory-migration-release.json',root),'utf8'));
const baseline=JSON.parse(policy.baselineJournal).entries.length;
const hash=s=>createHash('sha256').update(s).digest('hex');
const sourceJournal=readFileSync(new URL('drizzle/meta/_journal.json',root));
const repair=memoryRepairJournal(sourceJournal,allMigrations.at(-1).sql);
if(hash(sourceJournal)!==policy.sourceJournalSha256||baseline!==41)throw Error('Unreviewed source journal');
// Still0074 belongs to its own bootstrap; retain the historical Memory repair.
const migrations=allMigrations.slice(0,repair.count);
const db=new DatabaseSync(':memory:');
try{
 migrateLocalDatabase(db,{migrations:migrations.slice(0,baseline)});
 const read=()=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name!='__forma_local_migrations' ORDER BY name").all();
 const original=new Map(read().map(r=>[r.name,r])), variants=new Map(), affected=new Set();
 for(const migration of migrations.slice(baseline))for(const sql of migration.sql.split('--> statement-breakpoint').filter(s=>s.trim())){
  db.exec(sql);
  for(const row of read())if(JSON.stringify(row)!==JSON.stringify(original.get(row.name))){affected.add(row.name);const list=variants.get(row.name)??[];if(!list.some(r=>JSON.stringify(r)===JSON.stringify(row)))list.push(row);variants.set(row.name,list);}
 }
 const objects=read().filter(r=>affected.has(r.name));
 if(objects.some(r=>original.has(r.name)))throw Error('Repair cannot change baseline objects');
 const tables=objects.filter(r=>r.type==='table').map(r=>r.name);
 const dependencies=[...new Set(objects.filter(r=>r.type==='trigger'&&!tables.includes(r.tbl_name)).map(r=>r.tbl_name).concat(tables.flatMap(n=>db.prepare(`PRAGMA foreign_key_list("${n}")`).all().map(r=>r.table))))].filter(n=>!tables.includes(n)).sort();
 const columns=Object.fromEntries(dependencies.map(n=>[n,db.prepare(`PRAGMA table_xinfo("${n}")`).all().map(r=>({name:r.name,type:r.type.toUpperCase(),pk:r.pk,hidden:r.hidden}))]));
 const contract={version:1,baselineCommit:policy.baselineCommit,sourceJournalSha256:repair.sourceJournalSha256,migrations:migrations.slice(baseline).map(({tag,hash})=>({tag,hash})),objects,variants:Object.fromEntries(variants),tables,dependencies:columns};
 const manifest={...contract,sha256:hash(JSON.stringify(contract))};
 const output=JSON.stringify(manifest,null,2)+'\n',path=new URL('worker/memory-schema-repair-manifest.json',root);
 if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==output)throw Error('Stale repair manifest');}else writeFileSync(path,output);
 console.log(JSON.stringify({manifest:manifest.sha256,migrations:manifest.migrations.length,objects:objects.length,tables:tables.length,dependencies:dependencies.length}));
}finally{db.close();}
