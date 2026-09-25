import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';import {migrate,poolFromEnvironment,assertSchema} from '../src/database.mjs';
test('migration rollback is atomic and an older additive-compatible migration list remains runnable',{skip:!process.env.PILOT_DATABASE_URL},async()=>{
 const pool=poolFromEnvironment(),dir=await mkdtemp(join(tmpdir(),'still-migration-'));try{
 await migrate(pool);const suffix=randomUUID().replaceAll('-',''),name='probe_'+suffix,good=pathToFileURL(join(dir,'900-'+suffix+'.sql')),bad=pathToFileURL(join(dir,'901-'+suffix+'.sql'));
 await writeFile(good,`CREATE TABLE pilot.${name}(id integer PRIMARY KEY);`);await writeFile(bad,`INSERT INTO pilot.${name}(id) VALUES(1); SELECT deliberately_missing_column FROM pilot.${name};`);
 await assert.rejects(()=>migrate(pool,[good,bad]));assert.equal((await pool.query('SELECT to_regclass($1) AS name',['pilot.'+name])).rows[0].name,null);
 await migrate(pool,[good]);await migrate(pool);await assertSchema(pool);assert.equal((await pool.query('SELECT to_regclass($1) AS name',['pilot.'+name])).rows[0].name,'pilot.'+name);
 await writeFile(good,`CREATE TABLE pilot.${name}(id text);`);await assert.rejects(()=>migrate(pool,[good]),/checksum_mismatch/);
 }finally{await pool.end();await rm(dir,{recursive:true,force:true});}
});
