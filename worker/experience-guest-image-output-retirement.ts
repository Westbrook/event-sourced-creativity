import { exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { guestId } from "./experience-guest-session.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";
import { type Proof, type Context, fail, current, iso, together, canonicalRedactionSql, eventWitness,
  nativeBranches, unsupportedIdentityJson, boundedIdentityValue, historicalSource, sponsorSchema, saveAssociation, memoryProof } from "./experience-guest-image-history.ts";

type Scope = { guest: string; stream: string; project: string; document: string; draft: string; ids: string; prefix: string;
  scope: string; tail: string; command: string; resource: string; session: string; driver: string; sessionId: string };
function closure(scope: Scope, sponsor: { tables: Set<string> }, memory: { registries: string[] }): Proof {
  const rows: string[][] = nativeBranches.map(row => [...row]);
  const add = (table: string, predicate: string) => { if (sponsor.tables.has(table)) rows.push([table, predicate]); };
  add("experience_sponsor_resource_receipts", "(d.actor_user_id=s.guest OR d.session_digest=s.session) AND NOT(s.tail IS NOT NULL AND d.resource_id=s.resource)");
  for (const table of ["experience_sponsor_grants", "experience_sponsor_consumptions"]) add(table, "d.actor_user_id=s.guest OR d.session_digest=s.session");
  add("experience_sponsor_active_jobs", "d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_consumptions used WHERE used.consumption_id=d.consumption_id AND (used.actor_user_id=s.guest OR used.session_digest=s.session))");
  // Unsupported retained identity JSON cannot be silently classified as an
  // unrelated actor's work. This bounded inspector refuses that inventory;
  // it does not repair, delete or reinterpret another actor's receipt.
  add("experience_sponsor_issuances", `${unsupportedIdentityJson("d.driver_command_json")} OR ${unsupportedIdentityJson("d.envelope_json", ["documentId", "projectId", "ownerUserId", "actorUserId", "payerUserId", "sessionDigest"])}
    OR d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_grants issued WHERE issued.grant_id=d.grant_id AND (issued.actor_user_id=s.guest OR issued.session_digest=s.session))
    OR ${boundedIdentityValue("d.driver_command_json", "documentId")}=s.document
    OR ${boundedIdentityValue("d.envelope_json", "documentId")}=s.document
    OR ${boundedIdentityValue("d.envelope_json", "projectId")}=s.project
    OR ${boundedIdentityValue("d.envelope_json", "ownerUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "actorUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "payerUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "sessionDigest")}=s.session`);
  add("experience_sponsor_driver_intents", `${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver
    OR d.actor_user_id=s.guest OR d.session_digest=s.session OR d.document_id=s.document
    OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document`);
  add("experience_sponsor_driver_stages", `${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver
    OR EXISTS(SELECT 1 FROM experience_sponsor_driver_intents intent WHERE intent.driver_id=d.driver_id AND (intent.actor_user_id=s.guest OR intent.session_digest=s.session OR intent.document_id=s.document))
    OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document`);
  add("experience_sponsor_intakes", "d.actor_user_id=s.guest OR d.session_digest=s.session OR d.draft_id=s.draft OR d.project_id=s.project OR d.document_id=s.document");
  add("experience_sponsor_read_attempts", "d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=d.job_id AND (job.owner_id=s.guest OR job.stream_id=s.stream OR job.document_id=s.document))");
  add("experience_sponsor_intake_read_attempts", "d.actor_user_id=s.guest OR d.resource_key='draft:'||s.draft");
  for (const registry of memory.registries) rows.push([registry, "d.user_event_id IN(SELECT value FROM json_each(s.ids)) OR d.answer_event_id IN(SELECT value FROM json_each(s.ids))"]);
  add("experience_guest_context_adoptions", `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])}
    OR d.session_id=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "sessionId")}=s.sessionId
    OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project
    OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document`);
  add("experience_guest_plan_custodies", "d.session_id=s.sessionId OR d.draft_id=s.draft OR d.content_id=s.draft");
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  const names = ["guest", "stream", "project", "document", "draft", "ids", "prefix", "scope", "tail", "command", "resource", "session", "driver", "sessionId"];
  return { sql: `NOT EXISTS(WITH guest_output_closure_input AS(SELECT ? AS value),guest_output_closure_scope AS(
    SELECT ${names.map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM guest_output_closure_input),
    ${groups.map((group, i) => `guest_output_closure_${i} AS MATERIALIZED(${group.map(([table, predicate]) => `SELECT 1 FROM ${table} d,guest_output_closure_scope s WHERE ${predicate}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, i) => `EXISTS(SELECT 1 FROM guest_output_closure_${i})`).join(" OR ")})`, bindings: [JSON.stringify(scope)] };
}


export type GuestImageOutputRetirementReceipt = Readonly<{ status: "retired"; scope: "first-save-private-body";
  sessionId: string; documentId: string; requirementId: string; eventId: string; redactedAt: string; replayed: boolean }>;
/** Dormant historical cleanup of one original SAVE private body only. It uses
 * the original due-source deadline, never live payer/guest credentials, quota,
 * revocation eligibility or a caller-defined payload/SQL assertion. Source,
 * immutable public history, original tombstones and all financial rows survive.
 * Later output stages and completed custody require a separate retention proof. */
export async function retireExpiredGuestImageOutput(env: WorkerEnv, input: { sessionId: string }): Promise<GuestImageOutputRetirementReceipt> {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return fail();
  const sessionId = input.sessionId, ctx: Context = { env, db: env.DB };
  try {
    const original = await historicalSource(ctx, sessionId); current(ctx);
    const sponsor = await sponsorSchema(ctx); current(ctx);
    const saved = await saveAssociation(ctx, original); current(ctx);
    const memory = await memoryProof(ctx, original.draftId); current(ctx);
    const { eventIds, source, session, documentId, projectId, draftId, parts, blockIds } = original;
    blockIds.push(saved.requirementId);
    if (new Set(blockIds).size !== blockIds.length) return fail();
    parts.push(sponsor.proof, memory.proof,
      { sql: `NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='block' AND resource_id IN(SELECT value FROM json_each(?)))`, bindings: [JSON.stringify(blockIds)] },
      { sql: `(SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
        AND (SELECT COUNT(*) FROM event_client_receipts WHERE stream_id=?)=?`,
      bindings: [`creative:${session.guest_subject}`, eventIds.length + 1, `creative:${session.guest_subject}`, eventIds.length + 1, `creative:${session.guest_subject}`, eventIds.length] },
      closure({ guest: String(session.guest_subject), stream: `creative:${session.guest_subject}`, project: projectId, document: documentId, draft: draftId,
        ids: JSON.stringify([...eventIds, saved.eventId]), prefix: JSON.stringify(eventIds), scope: saved.scopeKey, tail: saved.eventId,
        command: saved.commandKey, resource: `${saved.commandKey}:text`, session: saved.sessionDigest, driver: saved.driverId, sessionId }, sponsor, memory));
    const before = together([...parts, { sql: `EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id
      WHERE ${eventWitness}=?)`, bindings: [saved.observed] }]);
    // Keep every native public/body association fixed, replacing only the two
    // permitted private tombstone fields. Already-erased bytes stay unknowable.
    const afterTail: Proof = { sql: `EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id
      WHERE json_set(${eventWitness},'$.private_json',json_extract(?,'$.private_json'),'$.redacted_at',json_extract(?,'$.redacted_at'))=?
        AND body.private_json='' AND (${canonicalRedactionSql("body.redacted_at")})
        AND (? IS NULL OR body.redacted_at=?) AND body.redacted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND (? IS NOT NULL OR body.redacted_at>=?))`,
    bindings: [saved.observed, saved.observed, saved.observed, saved.tail.redacted_at, saved.tail.redacted_at, saved.tail.redacted_at, source.expires_at] };
    const after = together([...parts, afterTail]);
    let uncertain = false;
    if (saved.tail.redacted_at === null) {
      current(ctx);
      const statements = [...outputAssertionStatements(env, before),
        ctx.db.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE private_event_id=? AND redacted_at IS NULL").bind(saved.eventId),
        ...outputAssertionStatements(env, after)];
      try {
        const result = await ctx.db.batch(statements);
        if (!Array.isArray(result) || result.length !== statements.length || statements.some((_, index) => !Object.hasOwn(result, index) || result[index]?.success !== true)
          || result[2]?.meta?.changes !== 1) uncertain = true;
      } catch { uncertain = true; }
      current(ctx);
    }
    // Final snapshot also resolves uncertain ACK. Never retry a mutation, mint
    // a fresh event, refresh expiry or erase the original source on recovery.
    const final = await ctx.db.prepare(`SELECT body.redacted_at FROM event_private_payloads body WHERE body.private_event_id=? AND (${after.sql})`)
      .bind(saved.eventId, ...after.bindings).first<{ redacted_at: string }>(); current(ctx);
    if (!final || !iso(final.redacted_at)) return fail();
    return Object.freeze({ status: "retired", scope: "first-save-private-body", sessionId, documentId, requirementId: saved.requirementId,
      eventId: saved.eventId, redactedAt: final.redacted_at, replayed: saved.tail.redacted_at !== null || uncertain });
  } catch (error) {
    current(ctx);
    if (error instanceof Error && error.message === "guest_image_output_retirement_not_due") throw error;
    return fail();
  }
}
