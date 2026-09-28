// Test fixture only. Seed exact observed platform DDL in an offline local D1 file.
// workerd reserves _cf_* names, so its public D1 binding cannot CREATE _cf_KV.
// Never shipped, never used on a hosted database, never modifies the plugin.
import{readdirSync}from'node:fs';import{execFileSync}from'node:child_process';import assert from'node:assert/strict';
export async function seedHostedMetadata(mf,options,metadata,Miniflare){
 if(!metadata.length)return mf;
 await(await mf.getD1Database('DB')).prepare('SELECT 1').first();await mf.dispose();
 const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);const files=walk(options.d1Persist).filter(p=>p.endsWith('.sqlite')&&!p.endsWith('/metadata.sqlite'));assert.equal(files.length,1);
 execFileSync('python3',['-c',`import sqlite3,json,sys
p=json.load(sys.stdin)
c=sqlite3.connect(p['file'])
for row in p['metadata']:
 old=c.execute('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=?',(row['name'],)).fetchone()
 if old: assert dict(zip(['type','name','tbl_name','sql'],old))==row
 else: c.execute(row['sql'])
c.commit();c.close()
`],{input:JSON.stringify({file:files[0],metadata}),encoding:'utf8'});
 return new Miniflare(options);
}
