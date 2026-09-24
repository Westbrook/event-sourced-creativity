/** Offline observation only. Never changes source/index data or scheduler budgets. */
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const keyOf=row=>JSON.stringify([row.partition_key,row.source_id]);
const rangeOf=row=>JSON.stringify([row.start_offset,row.end_offset]);
const epoch=value=>Date.parse(value)/1000;

export function createRenewalObservation({sqlite,storage,nowSeconds,expectedSources}) {
  let byteHashes=new WeakMap();
  const objectValid=row=>{
    const object=storage.get(row.object_key);
    if(!object||object.bytes.byteLength!==row.byte_count||object.customMetadata?.checksum!==row.checksum)return false;
    if(!byteHashes.has(object))byteHashes.set(object,hash(object.bytes));
    return byteHashes.get(object)===row.checksum&&row.vector_offset>=0&&(row.vector_offset+1)*2048<=row.byte_count;
  };
  const hasSnapshots=sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN('creation_index_snapshots','creation_index_snapshot_heads')").all().filter(row=>['creation_index_snapshots','creation_index_snapshot_heads'].includes(row.name)).length===2;
  const snapshotFields=hasSnapshots?'cs.content_id AS snapshot_id,cs.content AS snapshot_content,cs.created_at AS snapshot_created_at,cs.expires_at AS snapshot_expires_at,cs.redacted_at AS snapshot_redacted_at,cs.owner_id AS snapshot_owner,cs.kind AS snapshot_kind,sh.generation AS snapshot_generation,':' ';
  const snapshotJoins=hasSnapshots?"LEFT JOIN creation_index_snapshots sn ON sn.partition_key=r.partition_key AND sn.entity_id=(CASE r.kind WHEN 'idea' THEN 'blocks:' WHEN 'document' THEN 'documents:' ELSE 'projects:' END)||r.source_id LEFT JOIN private_content cs ON cs.content_id=sn.content_id LEFT JOIN creation_index_snapshot_heads sh ON sh.partition_key=r.partition_key":'';
  const sourceQuery=sqlite.prepare(`SELECT ${snapshotFields} r.partition_key,r.source_id,r.revision,r.content_hash,r.source_version,r.semantic_revision,r.semantic_model,r.tombstone,
    p.content_version,p.index_version,p.invalidated,p.owner_id,p.project_access_id,
    c.content_id,c.content,c.created_at,c.expires_at,c.redacted_at,c.owner_id AS body_owner,c.kind AS body_kind,
    s.generation,s.revision AS published_revision,s.representation,s.expected,s.completed,s.published,s.expires AS source_expires
    FROM creation_search_records r JOIN creation_search_partitions p USING(partition_key)
    LEFT JOIN private_content c ON c.content_id=r.content_id
    LEFT JOIN creation_index_sources s ON s.partition_key=r.partition_key AND s.source_id=r.source_id AND s.representation=r.semantic_model
    ${snapshotJoins} WHERE r.tombstone=0 ORDER BY r.partition_key,r.source_id`);
  const memberQuery=sqlite.prepare(`SELECT o.*,m.source_id AS member_source_id,m.revision AS member_revision,m.vector_offset,m.start_offset,m.end_offset
    FROM creation_index_objects o JOIN creation_index_members m USING(object_key)
    WHERE o.state='active' ORDER BY o.partition_key,m.source_id,m.start_offset,m.end_offset,o.object_key`);
  const read=()=>{
    byteHashes=new WeakMap(); // Recheck durable bytes each observation, including in-place corruption.
    const sources=new Map(sourceQuery.all().map(row=>[keyOf(row),{...row,bodyExpiry:epoch(row.expires_at),bodyCreated:epoch(row.created_at),snapshotExpiry:epoch(row.snapshot_expires_at),snapshotCreated:epoch(row.snapshot_created_at),members:[]}])) ;
    for(const member of memberQuery.all()){
      const source=sources.get(keyOf({...member,source_id:member.member_source_id}));
      if(source&&member.generation===source.index_version&&member.member_revision===source.revision&&member.representation===source.representation)source.members.push(member);
    }
    return sources;
  };
  const valid=(source,at)=>!!source&&!source.invalidated&&!source.tombstone&&source.source_version===source.content_version&&source.semantic_revision===source.revision&&
    source.published===1&&source.published_revision===source.revision&&source.generation===source.index_version&&source.expected>0&&source.completed===source.expected&&source.source_expires>at&&
    source.body_kind==='creation-search-source'&&source.body_owner===source.owner_id&&!source.redacted_at&&source.bodyExpiry>at&&typeof source.content==='string'&&
    // The fixed qualification cohorts use two personal custodies. Do not imply shared-sidecar qualification.
    !source.project_access_id&&(!hasSnapshots||source.snapshot_generation==null||source.snapshot_id&&source.snapshot_kind==='creation-search-source'&&source.snapshot_owner===source.owner_id&&!source.snapshot_redacted_at&&source.snapshotExpiry>at&&source.snapshot_generation===source.index_version)&&source.members.length===source.expected&&new Set(source.members.map(rangeOf)).size===source.expected&&
    source.members.every(member=>member.expires>at&&objectValid(member));
  const initial=read(),baseline=[];
  for(const [key,source]of initial){
    const lifetime=source.bodyExpiry-source.bodyCreated,lead=Math.min(86400,Math.max(60,lifetime/10));
    const originalRanges=source.members.map(member=>({range:rangeOf(member),objectKey:member.object_key,expires:member.expires,checksum:member.checksum,byteCount:member.byte_count}));
    const sourceDeadline=Math.min(source.bodyExpiry,source.source_expires,...originalRanges.map(row=>row.expires));
    const snapshot=hasSnapshots&&source.snapshot_generation!=null?{id:source.snapshot_id,hash:hash(source.snapshot_content??''),created:source.snapshotCreated,expires:source.snapshotExpiry}:null;
    const deadline=Math.min(sourceDeadline,snapshot?.expires??Infinity);
    const snapshotDue=snapshot?snapshot.expires-Math.min(86400,Math.max(60,(snapshot.expires-snapshot.created)/10)):Infinity;
    baseline.push({key,partitionKey:source.partition_key,sourceId:source.source_id,revision:source.revision,contentHash:source.content_hash,bodyId:source.content_id,bodyHash:hash(source.content??''),bodyCreated:source.bodyCreated,bodyExpiry:source.bodyExpiry,sourceExpiry:source.source_expires,expected:source.expected,originalRanges,snapshot,sourceDeadline,deadline,lastDeadline:Math.max(source.bodyExpiry,source.source_expires,snapshot?.expires??0,...originalRanges.map(row=>row.expires)),due:Math.min(sourceDeadline-lead,snapshotDue),lead,initialValid:valid(source,nowSeconds),initialProof:{partitionInvalidated:source.invalidated,published:source.published,bodyPresent:!!source.content_id,bodyExpires:source.bodyExpiry,snapshotHeadPresent:source.snapshot_generation!=null,snapshotPresent:!!source.snapshot_id,snapshotExpires:source.snapshotExpiry,snapshotGeneration:source.snapshot_generation??null,generation:source.index_version,expected:source.expected,actualMembers:source.members.length}});
  }
  const snapshotDigest=hash(JSON.stringify(baseline));
  const firstSourceDeadline=Math.min(...baseline.map(row=>row.sourceDeadline));
  const firstDue=Math.min(...baseline.map(row=>row.due)),firstDeadline=Math.min(...baseline.map(row=>row.deadline)),lastDeadline=Math.max(...baseline.map(row=>row.lastDeadline));
  const renewed=new Map(),components=new Map(baseline.map(row=>[row.key,{body:null,snapshot:null,manifest:null,ranges:new Map()}])),missed=new Map(),observations=[];let gapTicks=0,minCoverage=Infinity,firstWindow=null;
  const observe=(at,tick)=>{
    const current=read();let coverage=0;
    for(const original of baseline){
      const source=current.get(original.key),available=valid(source,at);
      if(available)coverage++;
      const ranges=new Map(source?.members.map(member=>[rangeOf(member),member])??[]);
      const identity=available&&source.revision===original.revision&&source.content_hash===original.contentHash&&hash(source.content)===original.bodyHash&&source.expected===original.expected;
      const bodyExtended=identity&&source.bodyExpiry>original.bodyExpiry&&source.bodyCreated>original.bodyCreated&&source.bodyExpiry-source.bodyCreated>=original.bodyExpiry-original.bodyCreated-0.001;
      const snapshotExtended=!original.snapshot||identity&&source.snapshotExpiry>original.snapshot.expires&&source.snapshotCreated>original.snapshot.created&&source.snapshotExpiry-source.snapshotCreated>=original.snapshot.expires-original.snapshot.created-0.001&&hash(source.snapshot_content)===original.snapshot.hash;
      const manifestExtended=identity&&source.source_expires>original.sourceExpiry;
      const witnesses=components.get(original.key);
      if(bodyExtended&&!witnesses.body)witnesses.body={at,tick,bodyId:source.content_id,created:source.bodyCreated,expires:source.bodyExpiry};
      if(original.snapshot&&snapshotExtended&&!witnesses.snapshot)witnesses.snapshot={at,tick,id:source.snapshot_id,created:source.snapshotCreated,expires:source.snapshotExpiry};
      if(manifestExtended&&!witnesses.manifest)witnesses.manifest={at,tick,expires:source.source_expires};
      for(const range of original.originalRanges){const member=ranges.get(range.range);if(identity&&member?.expires>range.expires&&!witnesses.ranges.has(range.range))witnesses.ranges.set(range.range,{at,tick,objectKey:member.object_key,expires:member.expires,checksum:member.checksum});}
      const extended=bodyExtended&&snapshotExtended&&manifestExtended&&original.originalRanges.every(range=>ranges.get(range.range)?.expires>range.expires);
      if(extended&&!renewed.has(original.key))renewed.set(original.key,{tick,at,bodyId:source.content_id,bodyCreated:source.bodyCreated,bodyExpiry:source.bodyExpiry,sourceExpiry:source.source_expires,minObjectExpiry:Math.min(...source.members.map(row=>row.expires)),rangeProofDigest:hash(JSON.stringify(source.members.map(row=>[rangeOf(row),row.object_key,row.expires,row.checksum])))});
      const deadlines=[...(original.snapshot?[['snapshot',original.snapshot.expires,witnesses.snapshot]]:[]),['body',original.bodyExpiry,witnesses.body],['manifest',original.sourceExpiry,witnesses.manifest],...original.originalRanges.map(range=>['vector:'+range.range,range.expires,witnesses.ranges.get(range.range)])];
      for(const [component,deadline,witness]of deadlines){const missKey=original.key+':'+component;if(at>=deadline&&(!witness||witness.at>=deadline)&&!missed.has(missKey))missed.set(missKey,{sourceId:original.sourceId,partitionKey:original.partitionKey,component,deadline,observedAt:at,available,renewedAt:witness?.at??null});}
    }
    minCoverage=Math.min(minCoverage,coverage);if(coverage!==expectedSources)gapTicks++;
    const point={tick,at,coverage,expectedSources,renewed:renewed.size,deadlineMisses:missed.size};observations.push(point);
    if(at>=firstSourceDeadline&&firstWindow===null)firstWindow=point;
    return{...point,complete:baseline.length===expectedSources&&baseline.every(row=>row.initialValid)&&renewed.size===expectedSources&&coverage===expectedSources};
  };
  return{firstDue,firstDeadline,firstSourceDeadline,lastDeadline,baselineCount:baseline.length,observe,report(){return{
    contract:'all-original-source-body-manifest-vector-retention; strict per-source deadlines; every-minute durable coverage',
    snapshotDigest,sourceCount:baseline.length,initialDurableSources:baseline.filter(row=>row.initialValid).length,
    firstDue,firstDeadline,firstSourceDeadline,lastDeadline,snapshotSources:baseline.filter(row=>row.snapshot).length,snapshotPartitions:new Set(baseline.filter(row=>row.snapshot).map(row=>row.partitionKey)).size,firstShortWindow:firstWindow,minCoverage:minCoverage===Infinity?null:minCoverage,gapTicks,noCoverageGap:gapTicks===0,
    renewedSources:renewed.size,deadlineMisses:[...missed.values()],observations,
    sourceWitnesses:baseline.map(row=>({...row,renewal:renewed.get(row.key)??null,componentRenewals:{...components.get(row.key),ranges:Object.fromEntries(components.get(row.key).ranges)}})),
  };}};
}
