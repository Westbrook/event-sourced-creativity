import {createHash,randomUUID} from 'node:crypto';
import {Storage} from '@google-cloud/storage';
import {transaction} from './database.mjs';
import {authority,PilotError} from './repository.mjs';
const validKey=key=>{if(!/^pilot\/[A-Za-z0-9_-]+\/[a-f0-9-]+$/.test(key))throw Error('object_key_invalid');return key;};
export class GcsObjects{
 constructor(bucket,storage=new Storage({retryOptions:{maxRetries:2,totalTimeout:20}})){if(!bucket)throw Error('private_bucket_required');this.bucket=storage.bucket(bucket);}
 async put(key,bytes,sha256){const file=this.bucket.file(validKey(key));await file.save(bytes,{timeout:10000,resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/octet-stream',cacheControl:'private, no-store',metadata:{sha256}}});const [m]=await file.getMetadata();return String(m.generation);}
 async get(key,generation,range){const file=this.bucket.file(validKey(key),{generation});const [data]=await file.download(range?{start:range.start,end:range.end}:{});return data;}
 async remove(key,generation){try{await this.bucket.file(validKey(key),generation?{generation}:{}).delete(generation?{ifGenerationMatch:generation}:{});}catch(e){if(Number(e.code)!==404)throw e;}}
 async versions(key){const [files,next]=await this.bucket.getFiles({prefix:validKey(key),versions:true,autoPaginate:false,maxResults:100});if(next)throw Error('object_version_bound_exceeded');return files.filter(f=>f.name===key).map(f=>({key:f.name,generation:String(f.metadata.generation)}));}
}
/** Register before upload so interrupted/late puts remain discoverable by cleanup. */
export async function putPrivate(pool,objects,actor,workspace,source,bytes){
 if(bytes.length>8*1024*1024)throw new PilotError('object_too_large',413);
 const id=randomUUID(),key=`pilot/${workspace}/${id}`,sha256=createHash('sha256').update(bytes).digest('hex');
 const generation=await transaction(pool,async db=>{await authority(db,actor,workspace,true);const {rows:[s]}=await db.query('SELECT * FROM pilot.sources WHERE source_id=$1 AND workspace_id=$2 AND withdrawn_at IS NULL FOR UPDATE',[source,workspace]);if(!s)throw new PilotError('source_unavailable',404);await db.query("INSERT INTO pilot.objects(object_id,workspace_id,source_id,source_generation,object_key,sha256,state) VALUES($1,$2,$3,$4,$5,$6,'pending')",[id,workspace,source,s.generation,key,sha256]);return s.generation;});
 const storageGeneration=await objects.put(key,bytes,sha256);
 const live=await transaction(pool,async db=>{await db.query('SELECT 1 FROM pilot.workspaces WHERE workspace_id=$1 FOR UPDATE',[workspace]);const {rowCount}=await db.query(`UPDATE pilot.objects o SET storage_generation=$2,state=CASE WHEN EXISTS(SELECT 1 FROM pilot.sources s WHERE s.source_id=o.source_id AND s.generation=$3 AND s.withdrawn_at IS NULL) THEN 'live' ELSE 'erase' END WHERE object_id=$1 RETURNING state`,[id,storageGeneration,generation]);return rowCount;});
 if(!live)throw Error('object_registration_lost');return {id,sha256};
}
export async function readPrivate(pool,objects,actor,workspace,id,range){
 if(range&&(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<range.start||range.end-range.start>=8*1024*1024))throw new PilotError('object_range_invalid',416);
 return transaction(pool,async db=>{await authority(db,actor,workspace);const {rows:[o]}=await db.query(`SELECT o.* FROM pilot.objects o JOIN pilot.sources s USING(source_id) WHERE object_id=$1 AND o.workspace_id=$2 AND o.state='live' AND s.withdrawn_at IS NULL AND s.generation=o.source_generation`,[id,workspace]);if(!o)throw new PilotError('object_unavailable',404);const bytes=await objects.get(o.object_key,o.storage_generation,range);if(!range&&createHash('sha256').update(bytes).digest('hex')!==o.sha256)throw Error('object_checksum_mismatch');return bytes;});
}
