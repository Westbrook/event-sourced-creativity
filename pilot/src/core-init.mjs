import {readFile} from 'node:fs/promises';
import {poolFromEnvironment,transaction} from './database.mjs';
import {initializeCore} from './core-repository.mjs';
const admissions=JSON.parse(await readFile(process.env.PILOT_ADMISSIONS_FILE,'utf8'));
if(!Array.isArray(admissions)||admissions.length<2||admissions.length>20||admissions.some(a=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)||!['creator','viewer'].includes(a.role)))throw Error('two_to_twenty_named_test_accounts_required');
const password=(await readFile(process.env.PILOT_RUNTIME_PASSWORD_FILE,'utf8')).trim();if(password.length<32)throw Error('strong_fresh_runtime_password_required');
const pool=poolFromEnvironment();try{
 await initializeCore(pool);
 await transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(73492118)');
  // Values are quoted by PostgreSQL itself, never interpolated from untrusted SQL text.
  const {rows:[q]}=await db.query('SELECT quote_literal($1) AS password',[password]);
  const {rowCount}=await db.query("SELECT 1 FROM pg_roles WHERE rolname='still_core'");
  await db.query(`${rowCount?'ALTER':'CREATE'} ROLE still_core LOGIN PASSWORD ${q.password}`);
  await db.query('GRANT USAGE ON SCHEMA pilot TO still_core');await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pilot TO still_core');await db.query('GRANT SELECT ON public.pilot_migrations TO still_core');
  await db.query('UPDATE pilot.admissions SET disabled_at=clock_timestamp()');
  for(const a of admissions){const email=a.email.toLowerCase();await db.query('INSERT INTO pilot.admissions(email,role) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET role=EXCLUDED.role,disabled_at=NULL',[email,a.role]);await db.query('UPDATE pilot.principals SET role=$2,permission_epoch=permission_epoch+1 WHERE email=$1 AND role<>$2',[email,a.role]);}
 });console.log(JSON.stringify({schema:'R1',admittedAccounts:admissions.length,providers:false}));
}finally{await pool.end();}
