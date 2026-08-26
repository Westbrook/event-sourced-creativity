import { hasCapability, type PilotUser } from "./pilot-policy.ts";
import { recordOrganizationAudit } from "./project-access.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";

/** Cross-project review never requires guessing or entering another person's project first. */
export async function handleReviewInbox(env: WorkerEnv, actor: PilotUser) {
  const rows = await env.DB.prepare(`SELECT task.task_id,task.organization_id,organization.name AS organization_name,
      task.project_access_id,task.project_id,task.document_id,task.artifact_id,task.artifact_revision,task.content_sha256,
      task.status,task.due_at,task.created_at,task.requested_by_user_id,requester.display_name AS requested_by_name,
      COALESCE((SELECT CASE named.type WHEN 'ProjectRenamed' THEN json_extract(COALESCE(secret.private_json,named.payload),'$.new_name')
        ELSE json_extract(COALESCE(secret.private_json,named.payload),'$.name') END
        FROM project_event_scopes named_scope JOIN events named ON named.event_id=named_scope.event_id
          LEFT JOIN event_private_payloads secret ON secret.private_event_id=named.event_id AND secret.redacted_at IS NULL
        WHERE named_scope.project_access_id=task.project_access_id AND named_scope.organization_id=task.organization_id
          AND named.type IN('ProjectCreated','ProjectRenamed') ORDER BY named_scope.project_sequence DESC LIMIT 1),'') AS project_name,
      COALESCE((SELECT CASE named.type WHEN 'DocumentRenamed' THEN json_extract(COALESCE(secret.private_json,named.payload),'$.new_title')
        ELSE json_extract(COALESCE(secret.private_json,named.payload),'$.title') END
        FROM project_event_scopes named_scope JOIN events named ON named.event_id=named_scope.event_id
          LEFT JOIN event_private_payloads secret ON secret.private_event_id=named.event_id AND secret.redacted_at IS NULL
        WHERE named_scope.project_access_id=task.project_access_id AND named_scope.organization_id=task.organization_id
          AND named.type IN('DocumentCreated','DocumentRenamed') AND json_extract(named.payload,'$.document_id')=task.document_id
        ORDER BY named_scope.project_sequence DESC LIMIT 1),'') AS document_title,
      COALESCE((SELECT CASE rendered.type WHEN 'OutputRenamed' THEN json_extract(COALESCE(secret.private_json,rendered.payload),'$.new_title')
        ELSE json_extract(COALESCE(secret.private_json,rendered.payload),'$.title') END
        FROM project_event_scopes rendered_scope JOIN events rendered ON rendered.event_id=rendered_scope.event_id
          LEFT JOIN event_private_payloads secret ON secret.private_event_id=rendered.event_id AND secret.redacted_at IS NULL
        WHERE rendered_scope.project_access_id=task.project_access_id AND rendered_scope.organization_id=task.organization_id
          AND rendered.type IN('DocumentRenderCompleted','OutputRenamed') AND json_extract(rendered.payload,'$.artifact_id')=task.artifact_id
        ORDER BY rendered_scope.project_sequence DESC LIMIT 1),'') AS artifact_title,
      COALESCE((SELECT json_extract(rendered.payload,'$.artifact_kind')
        FROM project_event_scopes rendered_scope JOIN events rendered ON rendered.event_id=rendered_scope.event_id
        WHERE rendered_scope.project_access_id=task.project_access_id AND rendered_scope.organization_id=task.organization_id
          AND rendered.type='DocumentRenderCompleted' AND json_extract(rendered.payload,'$.artifact_id')=task.artifact_id
        ORDER BY rendered_scope.project_sequence DESC LIMIT 1),'') AS artifact_kind
    FROM project_review_tasks task
    JOIN organizations organization ON organization.organization_id=task.organization_id AND organization.status='active'
    JOIN organization_memberships membership ON membership.organization_id=task.organization_id AND membership.user_id=task.assigned_user_id
      AND membership.status='active' AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL
    JOIN organization_projects project ON project.project_access_id=task.project_access_id AND project.organization_id=task.organization_id AND project.status='active'
    JOIN users requester ON requester.user_id=task.requested_by_user_id
    LEFT JOIN project_memberships project_member ON project_member.project_access_id=task.project_access_id
      AND project_member.organization_id=task.organization_id AND project_member.user_id=task.assigned_user_id
      AND project_member.status='active' AND project_member.revoked_at IS NULL
    WHERE task.assigned_user_id=? AND task.status='pending'
      AND (project.owner_user_id=task.assigned_user_id OR project_member.membership_id IS NOT NULL)
      AND (
        project.owner_user_id=task.assigned_user_id
        OR EXISTS(SELECT 1 FROM capability_grants grant_row WHERE grant_row.user_id=task.assigned_user_id
          AND grant_row.capability='project.review.approve' AND grant_row.scope_type='project'
          AND grant_row.organization_id=task.organization_id AND grant_row.project_access_id=task.project_access_id
          AND grant_row.status='active' AND grant_row.revoked_at IS NULL
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      )
      AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=task.organization_id AND cohort.status IN('active','paused','closed')
        AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=task.organization_id AND successor.status IN('active','paused')))
        AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id
          AND participant.organization_id=task.organization_id AND participant.user_id=task.assigned_user_id
          AND participant.status='active' AND participant.revoked_at IS NULL))
    ORDER BY CASE WHEN task.due_at IS NULL THEN 1 ELSE 0 END,task.due_at,task.created_at DESC LIMIT 100`)
    .bind(actor.userId).all<Record<string, unknown>>();
  const tasks = rows.results
    .filter((row) => hasCapability(actor, "project.review.approve", { organizationId: String(row.organization_id), projectAccessId: String(row.project_access_id) }))
    .map((row) => ({
      id: String(row.task_id),
      organizationId: String(row.organization_id),
      organizationName: String(row.organization_name),
      projectAccessId: String(row.project_access_id),
      projectId: String(row.project_id),
      projectName:String(row.project_name),
      documentId: String(row.document_id),
      documentTitle:String(row.document_title),
      artifactId: String(row.artifact_id),
      artifactTitle:String(row.artifact_title),
      artifactKind:String(row.artifact_kind),
      revision: Number(row.artifact_revision),
      contentSha256: String(row.content_sha256),
      status: String(row.status),
      dueAt: row.due_at ? String(row.due_at) : null,
      createdAt: String(row.created_at),
      requestedByUserId: String(row.requested_by_user_id),
      requestedByName: String(row.requested_by_name),
    }));
  return Response.json({ tasks, count: tasks.length, delivery: "in-app-only" });
}

/** Project automation is bounded, versioned, and cannot authorize paid model work. */
export async function handleProjectAutomation(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string, projectAccessId: string, runs = false) {
  const project = actor.access.projects.find((candidate) => candidate.organizationId === organizationId && candidate.projectAccessId === projectAccessId);
  if (!project || !hasCapability(actor, "project.read", { organizationId, projectAccessId })) return Response.json({ error: "access_denied" }, { status: 403 });
  const manages = hasCapability(actor, "workspace.policy.manage", { organizationId }) || project.role === "owner";
  if (runs) {
    if (request.method !== "GET" || !manages) return Response.json({ error: "access_denied" }, { status: 403 });
    const history = await env.DB.prepare("SELECT run_id,event_id,rule_kind,status,recipient_count,created_at,completed_at FROM project_automation_runs WHERE organization_id=? AND project_access_id=? ORDER BY created_at DESC LIMIT 100")
      .bind(organizationId, projectAccessId).all<Record<string, unknown>>();
    return Response.json({ runs: history.results, channels: ["in-app"], providerSpendingAllowed: false });
  }
  const existing = await env.DB.prepare("SELECT * FROM project_automation_policies WHERE organization_id=? AND project_access_id=?")
    .bind(organizationId, projectAccessId).first<Record<string, unknown>>();
  if (request.method === "GET") return Response.json({
    policy: existing ? {
      enabled: Boolean(existing.enabled),
      notifyContextChanges: Boolean(existing.notify_context_changes),
      notifyOutputReady: Boolean(existing.notify_output_ready),
      reviewDueHours: Number(existing.review_due_hours),
      reminderHours: Number(existing.reminder_hours),
      version: Number(existing.version),
      updatedAt: String(existing.updated_at),
    } : { enabled: true, notifyContextChanges: true, notifyOutputReady: true, reviewDueHours: 48, reminderHours: 24, version: 0, updatedAt: null },
    channels: ["in-app"],
    externalDeliveryConfigured: false,
    providerSpendingAllowed: false,
  });
  if (request.method !== "PATCH") return new Response("Method not allowed", { status: 405 });
  if (!manages) return Response.json({ error: "access_denied" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const reviewDueHours = Number(body.reviewDueHours ?? existing?.review_due_hours ?? 48);
  const reminderHours = Number(body.reminderHours ?? existing?.reminder_hours ?? 24);
  const version = Number(existing?.version ?? 0);
  if (!Number.isSafeInteger(reviewDueHours) || reviewDueHours < 1 || reviewDueHours > 720 || !Number.isSafeInteger(reminderHours) || reminderHours < 1 || reminderHours > 720) {
    return Response.json({ error: "valid_automation_schedule_required" }, { status: 400 });
  }
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== version) return Response.json({ error: "automation_policy_version_conflict", version }, { status: 409 });
  const enabled = body.enabled === undefined ? Boolean(existing?.enabled ?? true) : Boolean(body.enabled);
  const context = body.notifyContextChanges === undefined ? Boolean(existing?.notify_context_changes ?? true) : Boolean(body.notifyContextChanges);
  const ready = body.notifyOutputReady === undefined ? Boolean(existing?.notify_output_ready ?? true) : Boolean(body.notifyOutputReady);
  const now = new Date().toISOString();
  const saved = await env.DB.prepare(`INSERT INTO project_automation_policies(project_access_id,organization_id,project_id,enabled,notify_context_changes,notify_output_ready,review_due_hours,reminder_hours,version,updated_by_user_id,updated_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(project_access_id) DO UPDATE SET enabled=excluded.enabled,
      notify_context_changes=excluded.notify_context_changes,notify_output_ready=excluded.notify_output_ready,
      review_due_hours=excluded.review_due_hours,reminder_hours=excluded.reminder_hours,
      version=project_automation_policies.version+1,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at
      WHERE project_automation_policies.organization_id=excluded.organization_id AND project_automation_policies.version=?`)
    .bind(projectAccessId, organizationId, project.projectId, Number(enabled), Number(context), Number(ready), reviewDueHours, reminderHours, actor.userId, now, version).run();
  if (Number(saved.meta.changes ?? 0) !== 1) return Response.json({ error: "automation_policy_version_conflict", version }, { status: 409 });
  await recordOrganizationAudit(env, organizationId, actor, "ProjectAutomationPolicyUpdated", "project", projectAccessId, { enabled, reviewDueHours, reminderHours, version: version + 1 });
  return Response.json({ policy: { enabled, notifyContextChanges: context, notifyOutputReady: ready, reviewDueHours, reminderHours, version: version + 1, updatedAt: now }, channels: ["in-app"], providerSpendingAllowed: false });
}

/** Scheduler delivery rechecks every current entitlement and never invokes a provider. */
export async function processReviewReminders(env: WorkerEnv, maximum = 100) {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(`SELECT task.task_id,task.project_access_id,task.organization_id,task.project_id,task.artifact_id,task.document_id,task.assigned_user_id,task.request_event_id
    FROM project_review_tasks task JOIN organizations organization ON organization.organization_id=task.organization_id AND organization.status='active'
      JOIN organization_memberships member ON member.organization_id=task.organization_id AND member.user_id=task.assigned_user_id
        AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN organization_projects project ON project.project_access_id=task.project_access_id AND project.organization_id=task.organization_id AND project.status='active'
      LEFT JOIN project_automation_policies policy ON policy.project_access_id=task.project_access_id AND policy.organization_id=task.organization_id
    WHERE task.status='pending' AND task.due_at IS NOT NULL
      AND julianday(task.due_at)-CAST(COALESCE(policy.reminder_hours,24) AS REAL)/24.0<=julianday(?)
      AND COALESCE(policy.enabled,1)=1
      AND (
        project.owner_user_id=task.assigned_user_id
        OR EXISTS(SELECT 1 FROM project_memberships project_member JOIN capability_grants reviewer ON reviewer.user_id=project_member.user_id
          AND reviewer.organization_id=project_member.organization_id AND reviewer.project_access_id=project_member.project_access_id
          AND reviewer.capability='project.review.approve' AND reviewer.scope_type='project' AND reviewer.status='active' AND reviewer.revoked_at IS NULL
          AND (reviewer.expires_at IS NULL OR reviewer.expires_at>?)
          WHERE project_member.project_access_id=task.project_access_id AND project_member.organization_id=task.organization_id
            AND project_member.user_id=task.assigned_user_id AND project_member.status='active' AND project_member.revoked_at IS NULL)
      )
      AND NOT EXISTS(SELECT 1 FROM project_automation_outbox sent WHERE sent.organization_id=task.organization_id AND sent.idempotency_key='review-due:'||task.task_id)
      AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=task.organization_id AND cohort.status IN('active','paused','closed')
        AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=task.organization_id AND successor.status IN('active','paused')))
        AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.organization_id=task.organization_id
          AND participant.user_id=task.assigned_user_id AND participant.status='active' AND participant.revoked_at IS NULL))
    ORDER BY task.due_at LIMIT ?`).bind(now, now, Math.max(1, Math.min(500, Math.floor(maximum) || 100))).all<Record<string, unknown>>();
  let processed = 0;
  for (const task of due.results) {
    const deliveryId = uuidV7();
    const eventId = `review-due:${String(task.task_id)}`;
    try {
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO project_automation_outbox(delivery_id,organization_id,project_access_id,task_id,recipient_user_id,kind,destination,idempotency_key,status,payload_json,available_at,attempt_count,created_at,delivered_at)
          SELECT ?,?,?,?,?,?,'in-app',?,'delivered','{}',?,1,?,?
          WHERE EXISTS(SELECT 1 FROM project_review_tasks current_task
            JOIN organizations current_organization ON current_organization.organization_id=current_task.organization_id AND current_organization.status='active'
            JOIN organization_memberships current_member ON current_member.organization_id=current_task.organization_id
              AND current_member.user_id=current_task.assigned_user_id AND current_member.status='active'
              AND current_member.accepted_at IS NOT NULL AND current_member.revoked_at IS NULL
            JOIN organization_projects current_project ON current_project.project_access_id=current_task.project_access_id
              AND current_project.organization_id=current_task.organization_id AND current_project.status='active'
            LEFT JOIN project_automation_policies current_policy ON current_policy.project_access_id=current_task.project_access_id
              AND current_policy.organization_id=current_task.organization_id
            WHERE current_task.task_id=? AND current_task.organization_id=? AND current_task.project_access_id=?
              AND current_task.assigned_user_id=? AND current_task.status='pending' AND COALESCE(current_policy.enabled,1)=1
              AND julianday(current_task.due_at)-CAST(COALESCE(current_policy.reminder_hours,24) AS REAL)/24.0<=julianday(?)
              AND(current_project.owner_user_id=current_task.assigned_user_id OR EXISTS(
                SELECT 1 FROM project_memberships current_project_member JOIN capability_grants current_reviewer
                  ON current_reviewer.user_id=current_project_member.user_id AND current_reviewer.organization_id=current_project_member.organization_id
                  AND current_reviewer.project_access_id=current_project_member.project_access_id
                  AND current_reviewer.capability='project.review.approve' AND current_reviewer.scope_type='project'
                  AND current_reviewer.status='active' AND current_reviewer.revoked_at IS NULL
                  AND(current_reviewer.expires_at IS NULL OR current_reviewer.expires_at>?)
                WHERE current_project_member.project_access_id=current_task.project_access_id
                  AND current_project_member.organization_id=current_task.organization_id
                  AND current_project_member.user_id=current_task.assigned_user_id
                  AND current_project_member.status='active' AND current_project_member.revoked_at IS NULL))
              AND NOT EXISTS(SELECT 1 FROM pilot_cohorts current_cohort
                WHERE current_cohort.organization_id=current_task.organization_id AND current_cohort.status IN('active','paused','closed')
                  AND(current_cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor
                    WHERE successor.organization_id=current_task.organization_id AND successor.status IN('active','paused')))
                  AND NOT EXISTS(SELECT 1 FROM pilot_participants current_participant
                    WHERE current_participant.cohort_id=current_cohort.cohort_id
                      AND current_participant.organization_id=current_task.organization_id
                      AND current_participant.user_id=current_task.assigned_user_id
                      AND current_participant.status='active' AND current_participant.revoked_at IS NULL)))`)
          .bind(deliveryId,String(task.organization_id),String(task.project_access_id),String(task.task_id),String(task.assigned_user_id),"review-due",eventId,now,now,now,
            String(task.task_id),String(task.organization_id),String(task.project_access_id),String(task.assigned_user_id),now,now),
        env.DB.prepare(`INSERT INTO project_notifications(notification_id,project_access_id,organization_id,project_id,recipient_user_id,event_id,kind,artifact_id,document_id,message,created_at,expires_at,read_at)
          SELECT ?,?,?,?,?,?,'review_due',?,?,'An assigned independent review is due.',?,strftime('%Y-%m-%dT%H:%M:%fZ',?,'+30 days'),NULL
          WHERE EXISTS(SELECT 1 FROM project_automation_outbox WHERE delivery_id=? AND status='delivered')`)
          .bind(uuidV7(), String(task.project_access_id), String(task.organization_id), String(task.project_id), String(task.assigned_user_id), eventId, String(task.artifact_id), String(task.document_id), now, now, deliveryId),
        env.DB.prepare(`INSERT INTO project_automation_runs(run_id,project_access_id,organization_id,project_id,event_id,rule_kind,status,recipient_count,created_at,completed_at)
          SELECT ?,?,?,?,?,'review-due-reminder','completed',1,?,? WHERE EXISTS(SELECT 1 FROM project_automation_outbox WHERE delivery_id=? AND status='delivered')`)
          .bind(uuidV7(), String(task.project_access_id), String(task.organization_id), String(task.project_id), eventId, now, now, deliveryId),
      ]);
      if (results.every((result) => Number(result.meta.changes ?? 0) === 1)) processed += 1;
    } catch { /* Another scheduled invocation won the tenant-scoped idempotency receipt. */ }
  }
  return processed;
}
