import {setTimeout as delay} from 'node:timers/promises';
import {poolFromEnvironment,assertSchema} from './database.mjs';
import {GcsObjects} from './objects.mjs';
import {runBounded} from './jobs.mjs';
// The only active domain operation is cleanup. Native exact-shard indexing/outbox port is pending.
const pool=poolFromEnvironment(),objects=new GcsObjects(process.env.PILOT_BUCKET),abort=new AbortController();
process.on('SIGTERM',()=>abort.abort());process.on('SIGINT',()=>abort.abort());
try{
 await assertSchema(pool);
 while(!abort.signal.aborted){try{console.log(JSON.stringify(await runBounded(pool,objects,{limit:10,commit:process.env.SOURCE_COMMIT})));}catch{console.error(JSON.stringify({event:'worker-cleanup-failed',inference:false}));}try{await delay(60000,undefined,{signal:abort.signal});}catch{/* Graceful shutdown. */}}
}finally{await pool.end();}
