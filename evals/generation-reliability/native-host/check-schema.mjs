// Offline only: creates a disposable in-memory SQLite DB, never opens a product DB.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync,writeFileSync } from 'node:fs';
const root=new URL('../../../',import.meta.url),db=new DatabaseSync(':memory:');
for(const file of readdirSync(new URL('drizzle/',root)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL(`drizzle/${file}`,root),'utf8'));
db.exec(readFileSync(new URL('db/generation-study.pending.sql',root),'utf8'));
const rows=db.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name GLOB 'generation_study_*' ORDER BY name").all();db.close();
const text='// Generated from the optional SQL; no runtime installation.\nexport const schemaRows='+JSON.stringify(rows,null,2)+';\n';
const target=new URL('./schema-contract.mjs',import.meta.url);
if(process.argv.includes('--write'))writeFileSync(target,text);
else if(readFileSync(target,'utf8')!==text)throw Error('Optional schema contract differs; regenerate offline with --write and mint a new H3 envelope.');
console.log('Optional schema contract verified; no product database opened.');
