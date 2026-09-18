import { model3dRecoveryAttemptSql } from "./output-model3d-recovery-attempt.ts";
/** Retention-only, expiry-only grace for an exact failed accepted recovery.
 * One binding: the cleanup owner. This does NOT prove current source contents,
 * authorize a PUT/read/publication, refresh any lease, or release any money.
 * The publisher must repeat its full live authority/private/source assertions
 * before every effect. Revocation/cancellation wins; pending cleanup is never
 * resurrected. The original server-issued lease is capped at 120 seconds and
 * bounded here again by the original job and retained draft expiries.
 */
export const retainedModel3dRecoveryStorageSql = `WITH recovery_attempt_slots AS MATERIALIZED (
  SELECT slot.scope_key,slot.slot_id FROM output_operation_slots slot JOIN document_jobs job ON job.job_id=slot.job_id
  WHERE ${model3dRecoveryAttemptSql}
) SELECT stored.scope_key,stored.slot_id,stored.storage_key,stored.content_sha256
  FROM output_native_storage_writes stored
  JOIN output_operation_slots slot ON slot.scope_key=stored.scope_key AND slot.slot_id=stored.slot_id
  JOIN recovery_attempt_slots attempt ON attempt.scope_key=slot.scope_key AND attempt.slot_id=slot.slot_id
  JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
  JOIN document_jobs job ON job.job_id=slot.job_id
  JOIN output_provider_calls call ON call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id
  JOIN private_content draft ON draft.content_id=json_extract(job.request_json,'$.outputModel3d.source.draftId')
  JOIN json_each(job.result_json,'$.outputModel3dRecoveryFiles') entry
  JOIN json_each(job.result_json,'$.providerSubmissions') submission ON submission.key=call.client_request_id
  WHERE (((((((job.owner_id=?
    AND plan.scope_kind='personal')
    AND (plan.owner_user_id=job.owner_id
    AND plan.document_id=job.document_id))
    AND ((plan.organization_id IS NULL
    AND plan.project_access_id IS NULL)
    AND job.stream_id='creative:'||job.owner_id))
    AND (((grant_row.actor_user_id=job.owner_id
    AND grant_row.payer_user_id=job.owner_id)
    AND grant_row.context_id IS NULL)
    AND ((grant_row.status IN('authorized','active','completed')
    AND slot.status IN('failed','uncertain'))
    AND slot.attempt_ordinal IN(0,1))))
    AND ((((slot.attempt_ordinal IN(0,1)
    AND slot.provider='fal')
    AND (slot.maximum_calls=1
    AND slot.maximum_tokens=1))
    AND ((slot.model=json_extract(job.result_json,'$.model3dInputReceipt.model')
    AND job.kind='render_document')
    AND job.source_surface='outputs'))
    AND (((job.status='failed'
    AND job.attempt_count=1)
    AND json_extract(job.request_json,'$.artifactKind')='model3d')
    AND ((json_extract(job.result_json,'$.artifactKind')='model3d'
    AND json_type(job.result_json,'$.outputModel3dStop') IS NULL)
    AND (job.lease_expires_at IS NULL
    OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))))))
    AND (((((json_extract(job.result_json,'$.outputModel3dRecovery.version')='output-model3d-recovery-v1'
    AND json_extract(job.result_json,'$.outputModel3dRecovery.jobId')=job.job_id)
    AND (json_extract(job.result_json,'$.outputModel3dRecovery.slotId')=slot.slot_id
    AND json_extract(job.request_json,'$.model3dCostPreview.requestId')=job.job_id))
    AND ((json_extract(job.request_json,'$.model3dCostPreview.draftId')=draft.content_id
    AND json_extract(job.result_json,'$.outputModel3dRecovery.expiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(job.result_json,'$.outputModel3dRecovery.expiresAt'))=json_extract(job.result_json,'$.outputModel3dRecovery.expiresAt')))
    AND (((json_extract(job.result_json,'$.outputModel3dRecovery.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now','+120 seconds')
    AND job.expires_at>=json_extract(job.result_json,'$.outputModel3dRecovery.expiresAt'))
    AND draft.expires_at>=json_extract(job.result_json,'$.outputModel3dRecovery.expiresAt'))
    AND ((draft.owner_id=job.owner_id
    AND draft.kind='experience-draft')
    AND draft.redacted_at IS NULL)))
    AND ((((json_type(job.result_json,'$.outputModel3dRecovery.token')='text'
    AND length(json_extract(job.result_json,'$.outputModel3dRecovery.token'))=36)
    AND length(replace(json_extract(job.result_json,'$.outputModel3dRecovery.token'),'-',''))=32)
    AND ((json_extract(job.result_json,'$.outputModel3dRecovery.token') NOT GLOB '*[^0-9a-f-]*'
    AND substr(json_extract(job.result_json,'$.outputModel3dRecovery.token'),9,1)='-')
    AND substr(json_extract(job.result_json,'$.outputModel3dRecovery.token'),14,1)='-'))
    AND (((substr(json_extract(job.result_json,'$.outputModel3dRecovery.token'),19,1)='-'
    AND substr(json_extract(job.result_json,'$.outputModel3dRecovery.token'),24,1)='-')
    AND json_extract(job.request_json,'$.outputExecution.scopeKey')=slot.scope_key)
    AND ((json_extract(job.request_json,'$.outputExecution.slotId')=slot.slot_id
    AND json_extract(job.request_json,'$.outputExecution.grantId')=slot.grant_id)
    AND json_extract(job.request_json,'$.outputExecution.planRevisionId')=slot.plan_revision_id)))))
    AND ((((((json_extract(job.request_json,'$.outputExecution.sourceDigest')=slot.source_digest
    AND plan.source_digest=slot.source_digest)
    AND (json_extract(job.result_json,'$.outputExecution')=json_extract(job.request_json,'$.outputExecution')
    AND call.call_key='model3d:initial'))
    AND ((call.stage_key='model3d:initial'
    AND call.provider='fal')
    AND call.model=slot.model))
    AND (((call.status IN('uncertain','settled')
    AND length(call.provider_response_id) BETWEEN 1 AND 200)
    AND lower(call.provider_response_id) NOT IN('pending','unknown','submitted'))
    AND ((call.client_request_id=json_extract(job.result_json,'$.outputModel3dRecovery.clientRequestId')
    AND call.provider_response_id=json_extract(job.result_json,'$.outputModel3dRecovery.providerRequestId'))
    AND call.request_digest=json_extract(job.result_json,'$.outputModel3dRecovery.requestDigest'))))
    AND ((((length(call.request_digest)=64
    AND call.request_digest NOT GLOB '*[^0-9a-f]*')
    AND call.request_digest=json_extract(job.result_json,'$.model3dInputReceipt.requestDigest'))
    AND ((json_extract(submission.value,'$.clientRequestId')=call.client_request_id
    AND json_extract(submission.value,'$.providerRequestId')=call.provider_response_id)
    AND json_extract(submission.value,'$.provider')='fal'))
    AND (((json_extract(submission.value,'$.operation')='model3d'
    AND json_extract(submission.value,'$.model')=call.model)
    AND json_extract(submission.value,'$.status') IN('accepted','completed'))
    AND (((json_type(submission.value,'$.requestDigest') IS NULL
    OR json_extract(submission.value,'$.requestDigest')=call.request_digest)
    AND (SELECT COUNT(*) FROM output_provider_calls other WHERE other.scope_key=slot.scope_key AND other.slot_id=slot.slot_id)=1)
    AND (SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1))))
    AND ((((((SELECT COUNT(*) FROM json_each(job.result_json,'$.providerSubmissions'))=1
    AND json_type(job.result_json,'$.outputModel3dRecoveryFiles')='array')
    AND (json_array_length(job.result_json,'$.outputModel3dRecoveryFiles') BETWEEN 1 AND 64
    AND length(CAST(json_extract(job.result_json,'$.outputModel3dRecoveryFiles') AS BLOB))<=65536))
    AND ((entry.type='object'
    AND json_type(entry.value,'$.index')='integer')
    AND json_extract(entry.value,'$.index')=entry.key))
    AND (((json_extract(entry.value,'$.token')=json_extract(job.result_json,'$.outputModel3dRecovery.token')
    AND json_extract(entry.value,'$.storageKey')=stored.storage_key)
    AND json_extract(entry.value,'$.sha256')=stored.content_sha256)
    AND ((json_extract(entry.value,'$.file.url')='/api/media/'||replace(replace(stored.storage_key,'/','%2F'),':','%3A')
    AND length(stored.content_sha256)=64)
    AND stored.content_sha256 NOT GLOB '*[^0-9a-f]*')))
    AND ((((json_extract(entry.value,'$.file.sha256')=stored.content_sha256
    AND json_extract(entry.value,'$.file.role') IN('mesh','texture','preview'))
    AND (SELECT COUNT(*) FROM json_each(job.result_json,'$.outputModel3dRecoveryFiles') duplicate WHERE json_extract(duplicate.value,'$.storageKey')=stored.storage_key)=1)
    AND ((json_type(job.result_json,'$.artifactId')='text'
    AND length(json_extract(job.result_json,'$.artifactId')) BETWEEN 1 AND 200)
    AND json_extract(job.result_json,'$.artifactId') NOT GLOB '*[^A-Za-z0-9._:-]*'))
    AND (((stored.storage_key='u-'||lower(hex(CAST(job.owner_id AS BLOB)))||'/generated/'||json_extract(job.result_json,'$.artifactId') ||'-recovery-'||json_extract(job.result_json,'$.outputModel3dRecovery.token') ||CASE WHEN entry.key=0 THEN '' ELSE '-'||json_extract(entry.value,'$.file.role')||'-'||entry.key END||'.' ||CASE json_extract(entry.value,'$.file.mimeType') WHEN 'model/gltf-binary' THEN 'glb' WHEN 'model/vnd.usdz+zip' THEN 'usdz' WHEN 'model/obj' THEN 'obj' WHEN 'model/stl' THEN 'stl' WHEN 'application/zip' THEN 'zip' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/webp' THEN 'webp' WHEN 'application/octet-stream' THEN CASE WHEN json_extract(entry.value,'$.file.format')='fbx' THEN 'fbx' ELSE 'png' END ELSE 'png' END
    AND (entry.key<>0
    OR ((json_extract(entry.value,'$.file.role')='mesh'
    AND json_extract(entry.value,'$.file.format')='glb')
    AND json_extract(entry.value,'$.file.mimeType')='model/gltf-binary')))
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE (resource.resource_kind='content' AND resource.resource_id=draft.content_id) OR (resource.resource_kind='job' AND resource.resource_id=job.job_id) OR (resource.resource_kind='document' AND resource.resource_id=job.document_id)))
    AND ((NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=draft.content_id)
    AND NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.owner_user_id=job.owner_id AND project.project_id=plan.project_id))
    AND NOT EXISTS(SELECT 1 FROM events removed WHERE removed.stream_id=job.stream_id AND removed.type IN('DocumentRemoved','ProjectRemoved') AND (removed.type='DocumentRemoved' AND json_extract(removed.payload,'$.document_id')=job.document_id OR removed.type='ProjectRemoved' AND json_extract(removed.payload,'$.project_id')=plan.project_id))))))))`;
