import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../db/authoring-study-approval.pending.sql',import.meta.url),'utf8'));
const rows=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name GLOB 'authoring_study_*' ORDER BY name").all();db.close();
const path=new URL('../worker/authoring-study-schema.ts',import.meta.url),content='// Generated from the optional SQL by scripts/check-authoring-study-schema.mjs. Never installs a schema.\nexport const AUTHORING_STUDY_SCHEMA = '+JSON.stringify(rows,null,2)+' as const;\n';
if(process.argv.includes('--write'))writeFileSync(path,content);else if(readFileSync(path,'utf8')!==content)throw Error('authoring_study_schema_contract_stale');
console.log('Optional authoring study schema contract verified; no target accessed.');
