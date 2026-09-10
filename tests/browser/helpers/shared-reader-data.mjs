/**
 * SOURCE-ONLY, UNEXECUTED data for one explicit synthetic shared-reader case.
 * No personal-author fixture relabel, real grant, approval, media or provider.
 * Source shapes: PilotSession; ProjectCreated/DocumentCreated/DocumentRenderCompleted;
 * parseDocumentArtifactContent; OutputRequirementsSnapshot and Store scope validator.
 * The parent owns HTTP/caps/navigation/source-retirement/cleanup and actual acceptance.
 */
const freeze = value => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export const SHARED_READER = freeze({
  "schemaVersion": 1,
  "fixtureId": "priority4-deliver-shared-reader-r1",
  "origin": "http://127.0.0.1:4186",
  "actorUserId": "synthetic-p4-deliver-reader",
  "ownerUserId": "synthetic-p4-deliver-owner",
  "organizationId": "synthetic-p4-deliver-organization",
  "projectAccessId": "synthetic-p4-deliver-access",
  "projectId": "synthetic-p4-deliver-project",
  "documentId": "synthetic-p4-deliver-document",
  "artifactId": "synthetic-p4-deliver-story",
  "artifactKind": "short_story",
  "artifactRevision": 0,
  "artifactTitle": "Synthetic shared-reader story",
  "artifactSummary": "A declared text-only fixture artifact for populated Deliver and denied re-entry.",
  "artifactMarkdown": "# Synthetic shared-reader story\n\nThe reader found a note beside the window. Its words remained unchanged while the room grew quiet.\n",
  "artifactContentRef": "synthetic:p4-deliver-story:revision-0",
  "artifactContent": "{\"title\":\"Synthetic shared-reader story\",\"summary\":\"A declared text-only fixture artifact for populated Deliver and denied re-entry.\",\"content_markdown\":\"# Synthetic shared-reader story\\n\\nThe reader found a note beside the window. Its words remained unchanged while the room grew quiet.\\n\",\"presentation\":null,\"items\":[]}",
  "artifactContentByteLength": 322,
  "artifactContentSha256": "60e517134cdefcc7b5c271c3536791d1366fe02b246728dfdf4fa5fc59275bab",
  "createdAt": "2026-09-10T00:00:00.000Z",
  "expiresAt": "2030-01-01T00:00:00.000Z",
  "permissionEpoch": "synthetic-p4-deliver-reader-epoch-r1",
  "deliverPath": "/deliver?document=synthetic-p4-deliver-document",
  "activityPath": "/activity?document=synthetic-p4-deliver-document",
  "session": {
    "user": {
      "userId": "synthetic-p4-deliver-reader",
      "email": "synthetic-p4-reader@example.invalid",
      "displayName": "Synthetic shared reader",
      "role": "creator",
      "consentVersion": "synthetic-p4-fixture",
      "consentedAt": "2026-09-10T00:00:00.000Z"
    },
    "impersonation": null,
    "audience": "creative",
    "permissionEpoch": "synthetic-p4-deliver-reader-epoch-r1",
    "capabilities": [
      "project.read"
    ],
    "organizations": [
      {
        "organizationId": "synthetic-p4-deliver-organization",
        "name": "Synthetic shared workspace",
        "role": "member"
      }
    ],
    "projects": [
      {
        "organizationId": "synthetic-p4-deliver-organization",
        "projectAccessId": "synthetic-p4-deliver-access",
        "projectId": "synthetic-p4-deliver-project",
        "projectName": "Synthetic reader project",
        "role": "reader"
      }
    ],
    "projectContext": {
      "organizationId": "synthetic-p4-deliver-organization",
      "projectAccessId": "synthetic-p4-deliver-access",
      "projectId": "synthetic-p4-deliver-project",
      "ownerUserId": "synthetic-p4-deliver-owner",
      "role": "reader",
      "permissions": [
        "project.read"
      ],
      "expiresAt": "2030-01-01T00:00:00.000Z"
    },
    "policy": {
      "version": "synthetic-p4-fixture",
      "accepted": true,
      "passiveCapture": false,
      "externalAssetsRequireAssertion": true,
      "retentionDays": 30,
      "sharing": "synthetic-shared-reader-only"
    },
    "canvas": {
      "version": "synthetic-p4-fixture",
      "mode": "pilot",
      "pilotAvailable": false,
      "access": false,
      "accessReason": "role-not-eligible",
      "blockedBy": [],
      "requirements": []
    },
    "provider": {
      "name": "No provider",
      "model": "synthetic-p4-fixture",
      "configured": false,
      "plannerConfigured": false,
      "videoConfigured": false,
      "audioConfigured": false,
      "model3dConfigured": false
    },
    "budgets": {
      "period": "synthetic-p4-fixture",
      "user": {
        "used": 0,
        "reserved": 0,
        "limit": 0
      },
      "workspace": {
        "used": 0,
        "reserved": 0,
        "limit": 0
      }
    },
    "costBudgets": {
      "period": "synthetic-p4-fixture",
      "currency": "USD",
      "user": {
        "usedMicrousd": 0,
        "reservedMicrousd": 0,
        "limitMicrousd": 0,
        "remainingMicrousd": 0
      },
      "workspace": {
        "usedMicrousd": 0,
        "reservedMicrousd": 0,
        "limitMicrousd": 0,
        "remainingMicrousd": 0
      }
    }
  },
  "events": [
    {
      "eventId": "synthetic-p4-deliver-event-1",
      "streamId": "project:synthetic-p4-deliver-access",
      "sequence": 1,
      "occurredAt": "2026-09-10T00:00:00.000Z",
      "recordedAt": "2026-09-10T00:00:00.000Z",
      "actor": "user",
      "clientId": "synthetic-p4-deliver-fixture",
      "correlationId": "synthetic-p4-declared-retained-story",
      "causationId": null,
      "compensatesEventId": null,
      "schemaVersion": 1,
      "type": "ProjectCreated",
      "payload": {
        "project_id": "synthetic-p4-deliver-project",
        "name": "Synthetic reader project",
        "state": "active"
      }
    },
    {
      "eventId": "synthetic-p4-deliver-event-2",
      "streamId": "project:synthetic-p4-deliver-access",
      "sequence": 2,
      "occurredAt": "2026-09-10T00:00:00.000Z",
      "recordedAt": "2026-09-10T00:00:00.000Z",
      "actor": "user",
      "clientId": "synthetic-p4-deliver-fixture",
      "correlationId": "synthetic-p4-declared-retained-story",
      "causationId": null,
      "compensatesEventId": null,
      "schemaVersion": 1,
      "type": "DocumentCreated",
      "payload": {
        "project_id": "synthetic-p4-deliver-project",
        "document_id": "synthetic-p4-deliver-document",
        "handle": "synthetic-shared-reader-document",
        "title": "Synthetic shared-reader document"
      }
    },
    {
      "eventId": "synthetic-p4-deliver-event-3",
      "streamId": "project:synthetic-p4-deliver-access",
      "sequence": 3,
      "occurredAt": "2026-09-10T00:00:00.000Z",
      "recordedAt": "2026-09-10T00:00:00.000Z",
      "actor": "worker:synthetic-fixture",
      "clientId": "synthetic-p4-deliver-fixture",
      "correlationId": "synthetic-p4-declared-retained-story",
      "causationId": null,
      "compensatesEventId": null,
      "schemaVersion": 1,
      "type": "DocumentRenderCompleted",
      "payload": {
        "project_id": "synthetic-p4-deliver-project",
        "document_id": "synthetic-p4-deliver-document",
        "artifact_id": "synthetic-p4-deliver-story",
        "artifact_kind": "short_story",
        "title": "Synthetic shared-reader story",
        "summary": "A declared text-only fixture artifact for populated Deliver and denied re-entry.",
        "content_ref": "synthetic:p4-deliver-story:revision-0",
        "input_ref": null,
        "item_count": 0,
        "items": [],
        "media_url": null,
        "media_type": null,
        "provider": "synthetic-fixture",
        "model_id": "declared-retained-story",
        "latency_ms": 0,
        "source_surface": "synthetic-shared-reader-fixture",
        "settings": {}
      }
    }
  ],
  "head": 3,
  "content": {
    "synthetic:p4-deliver-story:revision-0": "{\"title\":\"Synthetic shared-reader story\",\"summary\":\"A declared text-only fixture artifact for populated Deliver and denied re-entry.\",\"content_markdown\":\"# Synthetic shared-reader story\\n\\nThe reader found a note beside the window. Its words remained unchanged while the room grew quiet.\\n\",\"presentation\":null,\"items\":[]}"
  },
  "outputSnapshot": {
    "schemaVersion": 1,
    "documentId": "synthetic-p4-deliver-document",
    "projectId": "synthetic-p4-deliver-project",
    "scope": {
      "kind": "project",
      "organizationId": "synthetic-p4-deliver-organization",
      "projectAccessId": "synthetic-p4-deliver-access",
      "actorUserId": "synthetic-p4-deliver-reader"
    },
    "revision": "synthetic-p4-delivery-r1",
    "requirementRevision": "synthetic-p4-requirements-r1",
    "sourceRevision": "synthetic-p4-source-r1",
    "sourceVerification": {
      "status": "unavailable",
      "reasonCodes": [
        "synthetic_source_not_verified"
      ],
      "capacity": {
        "referenceCount": 0,
        "distinctObjectCount": 0,
        "countsComplete": false,
        "ownedReadLimit": 0,
        "nativeLimit": 0,
        "sources": [],
        "sourcesComplete": false
      }
    },
    "requirements": [],
    "confirmedPlan": null,
    "targetStates": [],
    "summary": null,
    "requirementSummaries": {},
    "requirementFileCounts": {},
    "assets": [],
    "results": [],
    "grants": [],
    "scopeAmendments": [],
    "permissions": {
      "canAuthor": false,
      "canRequest": false,
      "canReview": false,
      "canDownload": false,
      "independentReview": false
    },
    "capabilities": {
      "nativeGeneration": false,
      "ownedFileAdoption": false,
      "supportedFileExtensions": [],
      "limitations": [
        "Declared synthetic shared-reader resource only; no approval, export or generation authority."
      ]
    }
  },
  "premise": {
    "authority": "Intentionally fictional shared-reader declarations, not a captured account, authentication, membership change or live IAM result.",
    "globalRole": "user.role creator selects the Creator application only. Effective shared projectContext.role reader and both permission arrays contain only project.read; actorUserId differs from ownerUserId.",
    "artifact": "DocumentRenderCompleted is the actual artifact-fold event type, declared here as synthetic retained data. The real fold uses titleSource generated; this fixture does not claim a generation, provider run, approval or delivered file.",
    "contentIdentity": "artifactContentSha256 covers the exact UTF-8 artifactContent JSON string, not only the Markdown. content_ref is an explicitly synthetic opaque key whose content-map value is that exact string.",
    "revision": "Revision zero follows from no DocumentArtifactEdited events. No review, acceptance, export, job or grant events are declared.",
    "sourceVerification": "Output source verification remains unavailable and capacity completeness false. Empty Output scope results do not replace the populated retained Deliver artifact.",
    "lifetime": "Actual source generation, captured authorization key, native disconnect/reconnect, pending reads and retirement must be observed by the parent fixture; none are invented in this data object.",
    "execution": "SOURCE_ONLY_UNRUN. Parent must bind capped exact read-only HTTP responses and no-egress custody before isolated execution. This module does not install routes or execute application code."
  }
});
