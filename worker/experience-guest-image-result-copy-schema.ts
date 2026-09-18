/** Dormant DDL and exact schema-family metadata only. Nothing installs this
 * family or confers lease, byte, custody, disclosure, or cleanup authority.
 * The later caller must validate the complete inert contracts, use its actual
 * capabilities, and prove the whole graph before/after one atomic batch. In
 * particular, insertion order means custody/copy rows alone are not publication.
 */
const attempt = "experience_guest_image_result_copy_attempts";
const custody = "experience_guest_image_result_custodies";
const copies = "experience_guest_image_result_copies";
const text = (name: string, maximum = 256) => `typeof(${name})='text' AND length(${name}) BETWEEN 1 AND ${maximum}`;
const integer = (name: string, minimum = 0, maximum = 9_007_199_254_740_991) => `typeof(${name})='integer' AND ${name} BETWEEN ${minimum} AND ${maximum}`;
const hash = (name: string) => `typeof(${name})='text' AND length(${name})=64 AND ${name} NOT GLOB '*[^a-f0-9]*'`;
const digest = (name: string) => `typeof(${name})='text' AND length(${name})=71 AND substr(${name},1,7)='sha256:' AND substr(${name},8) NOT GLOB '*[^a-f0-9]*'`;
const uuid = (name: string) => `typeof(${name})='text' AND length(${name})=36 AND substr(${name},9,1)='-' AND substr(${name},14,1)='-' AND substr(${name},19,1)='-' AND substr(${name},24,1)='-' AND length(replace(${name},'-',''))=32 AND replace(${name},'-','') NOT GLOB '*[^a-f0-9]*'`;
const iso = (name: string) => `typeof(${name})='text' AND length(${name})=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',${name})=${name}`;
const jsonObject = (name: string, maximum: number) => `typeof(${name})='text' AND length(CAST(${name} AS BLOB)) BETWEEN 2 AND ${maximum} AND json_valid(${name}) AND json_type(${name})='object'`;
const check = (expression: string) => `CHECK((${expression}) IS 1)`;
const nullableTime = (name: string) => `${name} IS NULL OR (${integer(name)})`;
const immutableAttempt = ["attempt_id", "custody_id", "session_id", "destination_user_id", "lease_id", "lease_acquisition", "request_id", "manifest_digest", "descriptor_json", "descriptor_digest", "lease_snapshot_json", "source_expires_at_ms", "destination_key", "writer_nonce", "content_sha256", "byte_length", "mime_type", "width", "height", "destination_metadata_json", "created_at_ms"] as const;
const leaseFields = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id", "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"] as const;
const exactLease = (row: string) => `EXISTS(SELECT 1 FROM experience_guest_claim_leases lease WHERE lease.session_id=${row}.session_id
  AND lease.lease_id=${row}.lease_id AND lease.destination_user_id=${row}.destination_user_id AND lease.manifest_digest=${row}.manifest_digest
  AND lease.request_id=${row}.request_id AND lease.acquisitions=${row}.lease_acquisition
  AND ${leaseFields.map(name => `lease.${name} IS json_extract(${row}.lease_snapshot_json,'$.${name}')`).join(" AND ")})`;
const descriptorLinks = [
  ["attempt_id", "$.attemptId"], ["custody_id", "$.custodyId"], ["session_id", "$.manifest.sessionId"],
  ["destination_user_id", "$.destinationUserId"], ["lease_id", "$.leaseSnapshot.lease_id"],
  ["lease_acquisition", "$.leaseSnapshot.acquisitions"], ["request_id", "$.requestId"],
  ["manifest_digest", "$.manifestDigest"], ["destination_key", "$.destinationKey"], ["writer_nonce", "$.writerNonce"],
  ["content_sha256", "$.manifest.object.contentSha256"], ["byte_length", "$.source.byteLength"],
  ["mime_type", "$.manifest.object.mimeType"], ["width", "$.manifest.object.width"], ["height", "$.manifest.object.height"],
] as const;
const publicationAssociation = `EXISTS(SELECT 1 FROM ${custody} claim
  JOIN experience_guest_sessions session ON session.session_id=claim.session_id
  JOIN events event ON event.event_id=claim.claim_event_id
  JOIN event_private_payloads envelope ON envelope.private_event_id=event.event_id
  WHERE claim.copy_attempt_id=NEW.attempt_id AND claim.custody_id=NEW.custody_id
    AND claim.session_id=NEW.session_id AND claim.destination_user_id=NEW.destination_user_id
    AND claim.lease_id=NEW.lease_id AND claim.lease_acquisition=NEW.lease_acquisition AND claim.request_id=NEW.request_id
    AND claim.manifest_digest=NEW.manifest_digest AND claim.lineage_digest=NEW.published_claim_digest
    AND claim.created_at_ms=NEW.published_at_ms AND session.revoked_at_ms=claim.created_at_ms
    AND event.stream_id='creative:'||claim.destination_user_id AND event.sequence=claim.claim_event_sequence
    AND event.type='GuestImageResultClaimed' AND envelope.owner_id=claim.destination_user_id
    AND event.recorded_at=strftime('%Y-%m-%dT%H:%M:%fZ',claim.created_at_ms/1000.0,'unixepoch')
    AND event.occurred_at=event.recorded_at AND envelope.created_at=event.recorded_at
    AND envelope.redacted_at IS NULL AND json_valid(envelope.private_json)
    AND envelope.project_id=json_extract(claim.lineage_json,'$.copy.manifest.projectId')
    AND envelope.document_id=json_extract(claim.lineage_json,'$.copy.manifest.documentId')
    AND json_extract(envelope.private_json,'$.custody_id')=claim.custody_id
    AND json_extract(envelope.private_json,'$.object_id')=claim.output_id
    AND json_extract(envelope.private_json,'$.generation_id')=claim.generation_id
    AND json_extract(envelope.private_json,'$.manifest_digest')=claim.manifest_digest
    AND (SELECT COUNT(*) FROM ${copies} body WHERE body.custody_id=claim.custody_id)=2
    AND claim.canonical_expires_at=(SELECT MIN(expires_at) FROM ${copies} body WHERE body.custody_id=claim.custody_id)
    AND NOT EXISTS(SELECT 1 FROM ${copies} body LEFT JOIN private_content content ON content.content_id=body.content_id
      WHERE body.custody_id=claim.custody_id AND (content.content_id IS NULL OR content.owner_id IS NOT claim.destination_user_id
        OR content.kind IS NOT 'guest-image-result-history' OR content.created_at IS NOT body.created_at
        OR content.expires_at IS NOT body.expires_at OR content.redacted_at IS NOT NULL
        OR length(CAST(content.content AS BLOB)) IS NOT body.byte_length)))`;

export const GUEST_IMAGE_RESULT_COPY_SCHEMA = Object.freeze([
  `CREATE TABLE ${attempt}(
    attempt_id TEXT PRIMARY KEY NOT NULL ${check(uuid("attempt_id"))},
    custody_id TEXT UNIQUE NOT NULL ${check(uuid("custody_id"))},
    session_id TEXT NOT NULL ${check(text("session_id"))},destination_user_id TEXT NOT NULL ${check(text("destination_user_id"))},
    lease_id TEXT NOT NULL ${check(uuid("lease_id"))},lease_acquisition INTEGER NOT NULL ${check(integer("lease_acquisition", 1, 100))},
    request_id TEXT NOT NULL ${check(text("request_id"))},manifest_digest TEXT NOT NULL ${check(digest("manifest_digest"))},
    descriptor_json TEXT NOT NULL ${check(jsonObject("descriptor_json", 65_536))},descriptor_digest TEXT NOT NULL ${check(digest("descriptor_digest"))},
    lease_snapshot_json TEXT NOT NULL ${check(jsonObject("lease_snapshot_json", 65_536))},
    source_expires_at_ms INTEGER NOT NULL ${check(integer("source_expires_at_ms", 1))},
    destination_key TEXT UNIQUE NOT NULL ${check(text("destination_key", 2048))},writer_nonce TEXT UNIQUE NOT NULL ${check(uuid("writer_nonce"))},
    content_sha256 TEXT NOT NULL ${check(hash("content_sha256"))},byte_length INTEGER NOT NULL ${check(integer("byte_length", 1, 24_000_000))},
    mime_type TEXT NOT NULL CHECK(mime_type='image/png'),width INTEGER NOT NULL ${check(integer("width", 1, 8192))},height INTEGER NOT NULL ${check(integer("height", 1, 8192))},
    destination_metadata_json TEXT NOT NULL ${check(jsonObject("destination_metadata_json", 8192))},
    state TEXT NOT NULL CHECK(state IN('reserved','writing','ready','cleanup_pending','deleted','published')),
    row_version INTEGER NOT NULL ${check(integer("row_version"))},
    put_outcome TEXT NOT NULL CHECK(put_outcome IN('pending','unknown','success','conditional-null')),
    created_at_ms INTEGER NOT NULL ${check(integer("created_at_ms", 1))},updated_at_ms INTEGER NOT NULL ${check(integer("updated_at_ms"))},
    put_started_at_ms INTEGER ${check(nullableTime("put_started_at_ms"))},put_settled_at_ms INTEGER ${check(nullableTime("put_settled_at_ms"))},
    verified_at_ms INTEGER ${check(nullableTime("verified_at_ms"))},published_at_ms INTEGER ${check(nullableTime("published_at_ms"))},
    published_claim_digest TEXT ${check(`published_claim_digest IS NULL OR (${digest("published_claim_digest")})`)},
    UNIQUE(session_id,request_id),UNIQUE(session_id,lease_acquisition),
    FOREIGN KEY(session_id) REFERENCES experience_guest_claim_leases(session_id),
    ${check("updated_at_ms>=created_at_ms AND source_expires_at_ms>created_at_ms")},
    ${check("put_started_at_ms IS NULL OR put_started_at_ms BETWEEN created_at_ms AND updated_at_ms")},
    ${check("put_started_at_ms IS NULL OR put_started_at_ms<MIN(source_expires_at_ms,json_extract(lease_snapshot_json,'$.expires_at_ms'))")},
    ${check("put_settled_at_ms IS NULL OR (put_started_at_ms IS NOT NULL AND put_settled_at_ms BETWEEN put_started_at_ms AND updated_at_ms)")},
    ${check("verified_at_ms IS NULL OR (put_outcome='success' AND put_settled_at_ms IS NOT NULL AND verified_at_ms BETWEEN put_settled_at_ms AND updated_at_ms)")},
    ${check("verified_at_ms IS NULL OR verified_at_ms<MIN(source_expires_at_ms,json_extract(lease_snapshot_json,'$.expires_at_ms'))")},
    ${check("(put_outcome='pending' AND put_settled_at_ms IS NULL) OR (put_outcome='unknown' AND put_started_at_ms IS NOT NULL AND put_settled_at_ms IS NULL) OR (put_outcome IN('success','conditional-null') AND put_started_at_ms IS NOT NULL AND put_settled_at_ms IS NOT NULL)")},
    ${check("(state='reserved' AND put_outcome='pending' AND put_started_at_ms IS NULL AND verified_at_ms IS NULL) OR (state='writing' AND put_started_at_ms IS NOT NULL AND verified_at_ms IS NULL) OR (state IN('ready','published') AND put_outcome='success' AND verified_at_ms IS NOT NULL) OR state='cleanup_pending' OR (state='deleted' AND ((put_started_at_ms IS NULL AND put_outcome='pending') OR (put_started_at_ms IS NOT NULL AND put_outcome IN('success','conditional-null'))))")},
    ${check("(state='published' AND published_at_ms IS NOT NULL AND published_at_ms BETWEEN verified_at_ms AND updated_at_ms AND published_claim_digest IS NOT NULL) OR (state<>'published' AND published_at_ms IS NULL AND published_claim_digest IS NULL)")},
    ${check("json_extract(descriptor_json,'$.version') IS 1 AND json_extract(descriptor_json,'$.kind') IS 'guest-image-result-copy'")},
    ${check(descriptorLinks.map(([column, path]) => `${column} IS json_extract(descriptor_json,'${path}')`).join(" AND "))},
    ${check("lease_snapshot_json IS json_extract(descriptor_json,'$.leaseSnapshot') AND destination_metadata_json IS json_extract(descriptor_json,'$.destinationMetadata')")},
    ${check("json_extract(destination_metadata_json,'$.version') IS '1' AND json_extract(destination_metadata_json,'$.kind') IS 'guest-image-result-copy' AND json_extract(destination_metadata_json,'$.attemptId') IS attempt_id AND json_extract(destination_metadata_json,'$.custodyId') IS custody_id AND json_extract(destination_metadata_json,'$.ownerId') IS destination_user_id AND json_extract(destination_metadata_json,'$.generationId') IS json_extract(descriptor_json,'$.manifest.generationId') AND json_extract(destination_metadata_json,'$.outputId') IS 'object-'||substr(json_extract(descriptor_json,'$.manifest.generationId'),-8) AND json_extract(destination_metadata_json,'$.manifestDigest') IS manifest_digest AND json_extract(destination_metadata_json,'$.nativeSnapshotDigest') IS json_extract(descriptor_json,'$.manifest.nativeSnapshotDigest') AND json_extract(destination_metadata_json,'$.sha256') IS content_sha256 AND json_extract(destination_metadata_json,'$.mimeType') IS mime_type AND json_extract(destination_metadata_json,'$.writerNonce') IS writer_nonce")},
    ${check("source_expires_at_ms IS CAST(round((julianday(json_extract(descriptor_json,'$.manifest.expiresAt'))-2440587.5)*86400000) AS INTEGER)")},
    ${check("destination_key='guest-image-result-media-v1/u-'||lower(hex(CAST(destination_user_id AS BLOB)))||'/'||custody_id||'/object-'||substr(json_extract(descriptor_json,'$.manifest.generationId'),-8)||'.png'")}
  )`,
  `CREATE INDEX experience_guest_image_result_copy_cleanup ON ${attempt}(state,updated_at_ms,attempt_id)`,
  `CREATE TABLE ${custody}(
    custody_id TEXT PRIMARY KEY NOT NULL ${check(uuid("custody_id"))},session_id TEXT UNIQUE NOT NULL ${check(text("session_id"))},
    destination_user_id TEXT NOT NULL ${check(text("destination_user_id"))},lease_id TEXT NOT NULL ${check(uuid("lease_id"))},
    lease_acquisition INTEGER NOT NULL ${check(integer("lease_acquisition", 1, 100))},request_id TEXT NOT NULL ${check(text("request_id"))},
    manifest_digest TEXT NOT NULL ${check(digest("manifest_digest"))},native_snapshot_digest TEXT NOT NULL ${check(digest("native_snapshot_digest"))},
    context_lineage_digest TEXT NOT NULL ${check(digest("context_lineage_digest"))},save_lineage_digest TEXT NOT NULL ${check(digest("save_lineage_digest"))},stage_lineage_digest TEXT NOT NULL ${check(digest("stage_lineage_digest"))},
    claim_event_id TEXT UNIQUE NOT NULL ${check(uuid("claim_event_id"))},claim_event_sequence INTEGER NOT NULL ${check(integer("claim_event_sequence", 1))},
    original_completion_event_id TEXT NOT NULL ${check(uuid("original_completion_event_id"))},generation_id TEXT NOT NULL ${check(uuid("generation_id"))},output_id TEXT NOT NULL ${check(text("output_id"))},
    copy_attempt_id TEXT UNIQUE NOT NULL ${check(uuid("copy_attempt_id"))},lineage_json TEXT NOT NULL ${check(jsonObject("lineage_json", 262_144))},
    lineage_digest TEXT NOT NULL ${check(digest("lineage_digest"))},created_at_ms INTEGER NOT NULL ${check(integer("created_at_ms"))},
    canonical_expires_at TEXT NOT NULL ${check(iso("canonical_expires_at"))},
    UNIQUE(destination_user_id,output_id),FOREIGN KEY(session_id) REFERENCES experience_guest_image_stage_custodies(session_id),
    FOREIGN KEY(copy_attempt_id) REFERENCES ${attempt}(attempt_id),FOREIGN KEY(claim_event_id) REFERENCES events(event_id),
    ${check("claim_event_id<>original_completion_event_id AND output_id='object-'||substr(generation_id,-8)")},
    ${check("canonical_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ',created_at_ms/1000.0,'unixepoch')")},
    ${check("custody_id IS json_extract(lineage_json,'$.copy.custodyId') AND manifest_digest IS json_extract(lineage_json,'$.copy.manifestDigest') AND canonical_expires_at IS json_extract(lineage_json,'$.canonical.expiresAt')")},
    ${check("claim_event_id IS json_extract(lineage_json,'$.canonical.eventId') AND claim_event_sequence IS json_extract(lineage_json,'$.canonical.sequence')")}
  )`,
  `CREATE TABLE ${copies}(
    custody_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('planner','prompt')),
    content_id TEXT UNIQUE NOT NULL ${check("typeof(content_id)='text' AND length(content_id)=91 AND substr(content_id,1,27)='guest-image-result-history-' AND substr(content_id,28) NOT GLOB '*[^a-f0-9]*'")},
    original_content_id TEXT NOT NULL ${check(text("original_content_id"))},original_kind TEXT NOT NULL,
    original_digest TEXT NOT NULL ${check(digest("original_digest"))},byte_length INTEGER NOT NULL ${check(integer("byte_length", 1, 65_536))},
    created_at TEXT NOT NULL ${check(iso("created_at"))},expires_at TEXT NOT NULL ${check(iso("expires_at"))},
    PRIMARY KEY(custody_id,role),UNIQUE(custody_id,original_content_id),
    FOREIGN KEY(custody_id) REFERENCES ${custody}(custody_id),FOREIGN KEY(content_id) REFERENCES private_content(content_id),
    CHECK((role='planner' AND original_kind='provider-output') OR (role='prompt' AND original_kind='prompt')),
    CHECK(expires_at>created_at AND content_id<>original_content_id)
  )`,
  `CREATE TRIGGER experience_guest_image_result_attempt_insert BEFORE INSERT ON ${attempt}
    WHEN NEW.state<>'reserved' OR NEW.row_version<>0 OR NEW.updated_at_ms<>NEW.created_at_ms
      OR NEW.created_at_ms<json_extract(NEW.lease_snapshot_json,'$.created_at_ms') OR NEW.created_at_ms>=json_extract(NEW.lease_snapshot_json,'$.expires_at_ms')
      OR NOT (${exactLease("NEW")}) OR EXISTS(SELECT 1 FROM ${attempt} WHERE attempt_id=NEW.attempt_id OR custody_id=NEW.custody_id OR destination_key=NEW.destination_key OR writer_nonce=NEW.writer_nonce OR (session_id=NEW.session_id AND (request_id=NEW.request_id OR lease_acquisition=NEW.lease_acquisition OR state<>'deleted')))
    BEGIN SELECT RAISE(ABORT,'guest result attempt insertion refused'); END`,
  `CREATE TRIGGER experience_guest_image_result_attempt_update BEFORE UPDATE ON ${attempt}
    WHEN ${immutableAttempt.map(name => `NEW.${name} IS NOT OLD.${name}`).join(" OR ")}
      OR OLD.state IN('published','deleted') OR NEW.row_version<>OLD.row_version+1 OR NEW.updated_at_ms<OLD.updated_at_ms
      OR NOT ((OLD.state='reserved' AND NEW.state IN('writing','cleanup_pending')) OR (OLD.state='writing' AND NEW.state IN('writing','ready','cleanup_pending')) OR (OLD.state='ready' AND NEW.state IN('published','cleanup_pending')) OR (OLD.state='cleanup_pending' AND NEW.state IN('cleanup_pending','deleted')))
      OR NOT (NEW.put_outcome=OLD.put_outcome OR (OLD.put_outcome='pending' AND NEW.put_outcome IN('unknown','success','conditional-null')) OR (OLD.put_outcome='unknown' AND NEW.put_outcome IN('success','conditional-null')))
      OR (OLD.put_started_at_ms IS NOT NULL AND NEW.put_started_at_ms IS NOT OLD.put_started_at_ms)
      OR (OLD.put_settled_at_ms IS NOT NULL AND NEW.put_settled_at_ms IS NOT OLD.put_settled_at_ms)
      OR (OLD.verified_at_ms IS NOT NULL AND NEW.verified_at_ms IS NOT OLD.verified_at_ms)
      OR (OLD.state=NEW.state AND OLD.put_outcome=NEW.put_outcome)
      OR (OLD.put_started_at_ms IS NULL AND NEW.put_started_at_ms IS NOT NULL AND NOT(OLD.state='reserved' AND NEW.state='writing' AND NEW.put_outcome='pending' AND NEW.put_started_at_ms=NEW.updated_at_ms))
      OR (OLD.put_started_at_ms IS NULL AND NEW.put_started_at_ms IS NOT NULL AND NEW.put_started_at_ms>=MIN(NEW.source_expires_at_ms,json_extract(NEW.lease_snapshot_json,'$.expires_at_ms')))
      OR (OLD.put_settled_at_ms IS NULL AND NEW.put_settled_at_ms IS NOT NULL AND (OLD.put_started_at_ms IS NULL OR NEW.put_settled_at_ms<>NEW.updated_at_ms))
      OR (OLD.verified_at_ms IS NULL AND NEW.verified_at_ms IS NOT NULL AND NOT(OLD.state='writing' AND OLD.put_outcome='success' AND NEW.state='ready' AND NEW.verified_at_ms=NEW.updated_at_ms))
      OR (NEW.state IN('ready','published') AND NEW.updated_at_ms>=MIN(NEW.source_expires_at_ms,json_extract(NEW.lease_snapshot_json,'$.expires_at_ms')))
      OR (NEW.state='published' AND NEW.published_at_ms<>NEW.updated_at_ms)
      OR ((NEW.state IN('ready','published') OR (OLD.state='reserved' AND NEW.state='writing')) AND NOT (${exactLease("NEW")}))
      OR (NEW.state='published' AND NOT (${publicationAssociation}))
      OR (NEW.state IN('cleanup_pending','deleted') AND EXISTS(SELECT 1 FROM ${custody} WHERE copy_attempt_id=NEW.attempt_id))
    BEGIN SELECT RAISE(ABORT,'guest result attempt transition refused'); END`,
  `CREATE TRIGGER experience_guest_image_result_attempt_delete BEFORE DELETE ON ${attempt} BEGIN SELECT RAISE(ABORT,'guest result attempt immutable'); END`,
  `CREATE TRIGGER experience_guest_image_result_custody_insert BEFORE INSERT ON ${custody}
    WHEN EXISTS(SELECT 1 FROM ${custody} WHERE custody_id=NEW.custody_id OR session_id=NEW.session_id OR claim_event_id=NEW.claim_event_id OR copy_attempt_id=NEW.copy_attempt_id OR (destination_user_id=NEW.destination_user_id AND output_id=NEW.output_id))
      OR NOT EXISTS(SELECT 1 FROM ${attempt} a WHERE a.attempt_id=NEW.copy_attempt_id AND a.custody_id=NEW.custody_id AND a.state='ready' AND a.put_outcome='success'
        AND a.session_id=NEW.session_id AND a.destination_user_id=NEW.destination_user_id AND a.lease_id=NEW.lease_id AND a.lease_acquisition=NEW.lease_acquisition
        AND a.request_id=NEW.request_id AND a.manifest_digest=NEW.manifest_digest AND json_extract(a.descriptor_json,'$.manifest.generationId')=NEW.generation_id AND NEW.output_id='object-'||substr(NEW.generation_id,-8)
        AND json_extract(a.descriptor_json,'$.manifest.nativeSnapshotDigest')=NEW.native_snapshot_digest AND a.descriptor_json=json_extract(NEW.lineage_json,'$.copy')
        AND NEW.created_at_ms>=a.verified_at_ms AND NEW.created_at_ms<MIN(a.source_expires_at_ms,json_extract(a.lease_snapshot_json,'$.expires_at_ms')))
      OR NOT EXISTS(SELECT 1 FROM experience_guest_context_adoptions context JOIN experience_guest_image_claims save ON save.session_id=context.session_id
        JOIN experience_guest_image_stage_custodies stage ON stage.session_id=context.session_id
        WHERE context.session_id=NEW.session_id AND context.destination_user_id=NEW.destination_user_id AND save.destination_user_id=NEW.destination_user_id AND stage.destination_user_id=NEW.destination_user_id
          AND context.lease_id=NEW.lease_id AND save.lease_id=NEW.lease_id AND stage.lease_id=NEW.lease_id
          AND context.request_id=NEW.request_id AND save.request_id=NEW.request_id AND stage.request_id=NEW.request_id
          AND context.lineage_digest=NEW.context_lineage_digest AND save.lineage_digest=NEW.save_lineage_digest AND stage.lineage_digest=NEW.stage_lineage_digest
          AND save.context_lineage_digest=context.lineage_digest AND stage.context_lineage_digest=context.lineage_digest AND stage.save_lineage_digest=save.lineage_digest)
    BEGIN SELECT RAISE(ABORT,'guest result custody insertion refused'); END`,
  `CREATE TRIGGER experience_guest_image_result_copy_insert BEFORE INSERT ON ${copies}
    WHEN EXISTS(SELECT 1 FROM ${copies} WHERE (custody_id=NEW.custody_id AND (role=NEW.role OR original_content_id=NEW.original_content_id)) OR content_id=NEW.content_id)
      OR NOT EXISTS(SELECT 1 FROM ${custody} claim JOIN ${attempt} a ON a.attempt_id=claim.copy_attempt_id
        JOIN private_content content ON content.content_id=NEW.content_id WHERE claim.custody_id=NEW.custody_id AND a.state='ready'
          AND content.owner_id=claim.destination_user_id AND content.kind='guest-image-result-history' AND content.redacted_at IS NULL
          AND content.created_at=NEW.created_at AND content.expires_at=NEW.expires_at AND length(CAST(content.content AS BLOB))=NEW.byte_length
          AND EXISTS(SELECT 1 FROM json_each(claim.lineage_json,'$.resultCopies') expected WHERE
            ${["custody_id", "role", "content_id", "original_content_id", "original_kind", "original_digest", "byte_length", "created_at", "expires_at"].map(name => `NEW.${name} IS json_extract(expected.value,'$.${name}')`).join(" AND ")}))
    BEGIN SELECT RAISE(ABORT,'guest result copy insertion refused'); END`,
  ...[custody, copies].flatMap(table => ["UPDATE", "DELETE"].map(action =>
    `CREATE TRIGGER ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'guest result custody immutable'); END`)),
  `CREATE TRIGGER experience_guest_image_result_content_insert BEFORE INSERT ON private_content
    WHEN EXISTS(SELECT 1 FROM ${copies} WHERE content_id=NEW.content_id)
    BEGIN SELECT RAISE(ABORT,'guest result copied identity exists'); END`,
  `CREATE TRIGGER experience_guest_image_result_content_identity BEFORE UPDATE OF content_id,owner_id,kind,created_at,expires_at ON private_content
    WHEN (EXISTS(SELECT 1 FROM ${copies} WHERE content_id=OLD.content_id) AND (NEW.content_id IS NOT OLD.content_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at))
      OR (NEW.content_id IS NOT OLD.content_id AND EXISTS(SELECT 1 FROM ${copies} WHERE content_id=NEW.content_id))
    BEGIN SELECT RAISE(ABORT,'guest result copied identity immutable'); END`,
] as const);

export const GUEST_IMAGE_RESULT_COPY_SCHEMA_FAMILY = Object.freeze(GUEST_IMAGE_RESULT_COPY_SCHEMA.map(sql => {
  const match = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z_]+)(?:[\s(])/u.exec(sql);
  if (!match) throw new Error("guest_result_copy_schema_definition_invalid");
  const table = match[1] === "TABLE" ? match[2] : /\bON ([a-z_]+)/u.exec(sql)?.[1];
  if (!table) throw new Error("guest_result_copy_schema_definition_invalid");
  return Object.freeze({ type: match[1].toLowerCase(), name: match[2]!, table, sql: sql.replace(/\s+/gu, " ").trim() });
}));
