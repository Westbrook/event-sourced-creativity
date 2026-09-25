import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const poolFromEnvironment=()=>{
 if(!process.env.PILOT_DATABASE_URL)throw Error('pilot_database_required');
 return new pg.Pool({connectionString:process.env.PILOT_DATABASE_URL,max:5,statement_timeout:15000,connectionTimeoutMillis:5000});
};
export async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export async function migrate(pool,migrations=[new URL('../sql/001-platform.sql',import.meta.url)]){
 return transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(73492117)');
  await db.query('CREATE TABLE IF NOT EXISTS public.pilot_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const file of migrations){const sql=await readFile(file,'utf8'),name=file.pathname.split('/').at(-1),hash=createHash('sha256').update(sql).digest('hex');const {rows:[prior]}=await db.query('SELECT sha256 FROM public.pilot_migrations WHERE name=$1',[name]);if(prior){if(prior.sha256!==hash)throw Error('migration_checksum_mismatch');continue;}await db.query(sql);await db.query('INSERT INTO public.pilot_migrations(name,sha256) VALUES($1,$2)',[name,hash]);}
 });
}
/** An older compatible image tolerates newer additive migrations. Destructive changes require a new epoch. */
export async function assertSchema(pool){const {rows:[r]}=await pool.query("SELECT sha256 FROM public.pilot_migrations WHERE name='001-platform.sql'");if(!r)throw Error('migration_required');}
if(process.argv[1]===new URL(import.meta.url).pathname){const pool=poolFromEnvironment();try{await migrate(pool);console.log(JSON.stringify({migration:'complete'}));}finally{await pool.end();}}
