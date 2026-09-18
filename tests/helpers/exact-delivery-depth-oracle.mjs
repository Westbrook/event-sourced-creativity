// Frozen Phase5 R2 SQL oracle. Test-only: its intentionally deep SQL must fail the native D1 gate.
const artifactEvidenceScope = (scope) => ({ projectAccessId: scope.projectAccessId, organizationId: scope.organizationId, projectId: scope.projectId, ownerUserId: scope.ownerUserId });
export function legacyArtifactExactBatchGuard(context, bindings) {
    if (!bindings.size)
        return { sql: "", bindings: [] };
    const expressions = [], rights = [], rightKeys = new Map();
    const artifacts = [...bindings].map(([artifactId, binding]) => {
        let kind = expressions.indexOf(binding.rightsGuard.sql);
        if (kind < 0) {
            kind = expressions.length;
            expressions.push(binding.rightsGuard.sql);
        }
        const key = JSON.stringify([kind, binding.rightsGuard.bindings]);
        let right = rightKeys.get(key);
        if (right === undefined) {
            right = rights.length;
            rightKeys.set(key, right);
            rights.push({ kind, bindings: binding.rightsGuard.bindings });
        }
        return { artifactId, contentId: binding.contentId, content: binding.content, revision: binding.revision, right, validUntil: binding.rightsValidUntil };
    });
    const cases = expressions.map((expression, kind) => {
        let index = 0;
        const sql = expression.replace(/\?/gu, () => "json_extract(exact_right.value,'$.bindings[" + (index++) + "]')");
        if (rights.some(right => right.kind === kind && right.bindings.length !== index))
            throw new Error("artifact_rights_guard_invalid");
        return "WHEN " + kind + " THEN (" + sql + ")";
    }).join(" ");
    const sql = ` AND EXISTS(SELECT 1 FROM(SELECT ? AS value) exact_batch WHERE NOT EXISTS(
    SELECT 1 FROM json_each(exact_batch.value,'$.artifacts') expected WHERE NOT EXISTS(SELECT 1 FROM private_content exact_content
      JOIN project_resource_scopes exact_artifact ON exact_artifact.project_access_id=json_extract(exact_batch.value,'$.context.projectAccessId')
        AND exact_artifact.organization_id=json_extract(exact_batch.value,'$.context.organizationId')
        AND exact_artifact.project_id=json_extract(exact_batch.value,'$.context.projectId')
        AND exact_artifact.owner_user_id=json_extract(exact_batch.value,'$.context.ownerUserId') AND exact_artifact.resource_kind='artifact'
        AND exact_artifact.resource_id=json_extract(expected.value,'$.artifactId') AND exact_artifact.visibility='collaborative_output'
      JOIN project_resource_scopes exact_retained ON exact_retained.project_access_id=exact_artifact.project_access_id
        AND exact_retained.organization_id=exact_artifact.organization_id AND exact_retained.project_id=exact_artifact.project_id
        AND exact_retained.owner_user_id=exact_artifact.owner_user_id AND exact_retained.resource_kind='content'
        AND exact_retained.resource_id=exact_content.content_id AND exact_retained.visibility='collaborative_output'
      WHERE exact_content.content_id=json_extract(expected.value,'$.contentId')
        AND exact_content.owner_id=json_extract(exact_batch.value,'$.context.ownerUserId') AND exact_content.kind='document-artifact'
        AND exact_content.redacted_at IS NULL AND exact_content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND exact_content.content=json_extract(expected.value,'$.content')
        AND (SELECT COUNT(*) FROM events exact_revision WHERE exact_revision.stream_id='creative:'||json_extract(exact_batch.value,'$.context.ownerUserId')
          AND exact_revision.type='DocumentArtifactEdited' AND json_extract(exact_revision.payload,'$.artifact_id')=json_extract(expected.value,'$.artifactId'))
          =json_extract(expected.value,'$.revision')
        AND EXISTS(SELECT 1 FROM json_each(exact_batch.value,'$.rights') exact_right
          WHERE exact_right.key=json_extract(expected.value,'$.right') AND CASE json_extract(exact_right.value,'$.kind') ${cases} ELSE 0 END)
        AND(json_extract(expected.value,'$.validUntil') IS NULL OR json_extract(expected.value,'$.validUntil')>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))`;
    const packed = JSON.stringify({ context: artifactEvidenceScope(context), artifacts, rights }), encoder = new TextEncoder();
    if (encoder.encode(packed).byteLength > 1_900_000 || encoder.encode(sql).byteLength > 50_000)
        return null;
    return { sql, bindings: [packed] };
}
export const legacyNativeEvidenceSql = "NOT EXISTS(SELECT 1 FROM json_each(?) artifact_source WHERE NOT(\n    NOT EXISTS(SELECT 1 FROM json_each(artifact_source.value,'$.events') expected WHERE NOT EXISTS(SELECT 1 FROM events event\n      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id\n      JOIN project_event_scopes custody ON custody.event_id=event.event_id\n      WHERE event.event_id=json_extract(expected.value,'$.eventId') AND event.stream_id='creative:'||json_extract(artifact_source.value,'$.scope.ownerUserId')\n        AND event.sequence=json_extract(expected.value,'$.sequence') AND event.type=json_extract(expected.value,'$.type')\n        AND event.actor=json_extract(expected.value,'$.actor') AND event.client_id=json_extract(expected.value,'$.clientId')\n        AND event.correlation_id=json_extract(expected.value,'$.correlationId') AND event.causation_id IS json_extract(expected.value,'$.causationId')\n        AND event.compensates_event_id IS json_extract(expected.value,'$.compensatesEventId')\n        AND event.payload=json_extract(expected.value,'$.payload') AND secret.private_json IS json_extract(expected.value,'$.privateJson')\n        AND secret.owner_id IS json_extract(expected.value,'$.privateOwner') AND secret.redacted_at IS NULL\n        AND custody.project_access_id=json_extract(artifact_source.value,'$.scope.projectAccessId')\n        AND custody.organization_id=json_extract(artifact_source.value,'$.scope.organizationId')\n        AND custody.project_id=json_extract(artifact_source.value,'$.scope.projectId')\n        AND custody.owner_user_id=json_extract(artifact_source.value,'$.scope.ownerUserId')\n        AND custody.source_stream_id=event.stream_id AND custody.source_sequence=event.sequence\n        AND custody.actor_user_id=json_extract(expected.value,'$.custodyActor')))\n    AND NOT EXISTS(SELECT 1 FROM json_each(artifact_source.value,'$.resources') required WHERE NOT EXISTS(SELECT 1 FROM project_resource_scopes resource\n      WHERE resource.resource_kind=json_extract(required.value,'$.kind') AND resource.resource_id=json_extract(required.value,'$.id')\n        AND resource.project_access_id=json_extract(artifact_source.value,'$.scope.projectAccessId')\n        AND resource.organization_id=json_extract(artifact_source.value,'$.scope.organizationId')\n        AND resource.project_id=json_extract(artifact_source.value,'$.scope.projectId')\n        AND resource.owner_user_id=json_extract(artifact_source.value,'$.scope.ownerUserId') AND resource.visibility='collaborative_output'))))";
