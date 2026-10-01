import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Offline analysis: never runs tests or consumes actual-data fixtures.
const files = process.argv.slice(2);
if (!files.length) throw Error('Pass one or more cases.jsonl files from managed validation runs.');
const records=files.flatMap(file=>readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));
const suites=new Map(), seen=new Map();
for(const row of records){
 if(row.parent)continue;
 const key=JSON.stringify([row.file,row.line,row.column,row.name]);
 const suite=suites.get(row.file)??{file:row.file,leaves:0,durationMs:0,failed:0,skipped:0};
 suite.leaves++;suite.durationMs+=row.durationMs??0;suite.failed+=Number(row.event==='test:fail');suite.skipped+=Number(Boolean(row.skip||row.todo));suites.set(row.file,suite);
 seen.set(key,(seen.get(key)??0)+1);
}
const report={schemaVersion:1,kind:'observed assertion durations, not process startup or p95',inputs:files,
 leafMembershipSha256:createHash('sha256').update([...seen.keys()].sort().join('\n')).digest('hex'),
 uniqueLeaves:seen.size, repeatedLeafObservations:[...seen].filter(([,count])=>count>1).map(([key,count])=>({identity:JSON.parse(key),count})),
 suites:[...suites.values()].sort((a,b)=>b.durationMs-a.durationMs)};
const path=files[0]+'.cost.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');console.log(path);
