import { ASSISTANT_MESSAGES } from "../src/components/design-system/locales/assistant-messages.ts";
import { assistantPlaybookForSurface, assistantSurfaceForRoute, type AssistantSurface } from "../src/model/assistant-route-policy.ts";
import { ASSISTANT_CONTEXT_LIMITS, ASSISTANT_OUTPUT_KINDS, type AssistantContext } from "../src/model/conversation-context.ts";
import { applicationDefinition, navigationItemActive, SITE_ROUTE_ENTRIES } from "../src/platform/applications.ts";
import { PLATFORM_PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { POLICY_VERSION, requirePlatformAssistantPrincipal, type PlatformAssistantPrincipal } from "./pilot-policy.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";

type PlatformProposal = { id: string; turnId: string; kind: "navigate"; key: string; summaryKey: string; route: string };
type PlatformReply = { key: string; values?: Record<string, string | number> };
type PlatformTurn = { id: string; user: string; reply: PlatformReply; proposal: PlatformProposal | null };
type PlatformActor = { principal: PlatformAssistantPrincipal; surface: AssistantSurface };
type PlatformEventRow = { event_id: string; turn_id: string; event_type: string; sequence: number; reply_key: string | null;
  reply_values_json: string | null; proposal_json: string | null; content: string };

const initializedPlatformAssistants = new WeakMap<D1Database, Promise<void>>();
const responseHeaders = { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: responseHeaders });

async function ensurePlatformAssistantSchema(env: WorkerEnv) {
  let pending = initializedPlatformAssistants.get(env.DB);
  if (!pending) {
    pending = env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS platform_assistant_private_content(content_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,audience TEXT NOT NULL,route_family TEXT NOT NULL,permission_epoch TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('platform-chat-user','platform-chat-assistant')),content TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,redacted_at TEXT)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_platform_assistant_private_scope ON platform_assistant_private_content(actor_user_id,audience,route_family,permission_epoch,expires_at)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS platform_assistant_events(event_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,audience TEXT NOT NULL,route_family TEXT NOT NULL,permission_epoch TEXT NOT NULL,turn_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(event_type IN('PlatformChatMessageSent','PlatformAssistantReasoned','PlatformNavigationProposed')),sequence INTEGER NOT NULL,content_id TEXT,reply_key TEXT,reply_values_json TEXT,proposal_json TEXT,occurred_at TEXT NOT NULL,UNIQUE(actor_user_id,audience,route_family,permission_epoch,sequence),UNIQUE(actor_user_id,audience,route_family,permission_epoch,turn_id,event_type))"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_platform_assistant_events_actor_scope ON platform_assistant_events(actor_user_id,audience,route_family,permission_epoch,sequence)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS platform_assistant_commits(commit_id TEXT PRIMARY KEY NOT NULL,verified INTEGER NOT NULL CHECK(verified=1),created_at TEXT NOT NULL)"),
      env.DB.prepare("CREATE TRIGGER IF NOT EXISTS platform_assistant_event_block_update BEFORE UPDATE ON platform_assistant_events BEGIN SELECT RAISE(ABORT,'platform assistant events are append-only'); END"),
      env.DB.prepare("CREATE TRIGGER IF NOT EXISTS platform_assistant_event_block_delete BEFORE DELETE ON platform_assistant_events BEGIN SELECT RAISE(ABORT,'platform assistant events are append-only'); END"),
    ]).then(() => undefined).catch((error) => { initializedPlatformAssistants.delete(env.DB); throw error; });
    initializedPlatformAssistants.set(env.DB, pending);
  }
  return pending;
}

function admittedAssistant(env: WorkerEnv, userId: string) {
  return new Set((env.FORMA_ASSISTANT_INTERNAL_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean)).has(userId);
}

function protectedReplay(surface: AssistantSurface) {
  return surface.canonicalFamily === "/product/evaluation/actual" || surface.canonicalFamily === "/admin/events/replay";
}

async function authorizePlatformAssistant(request: Request, env: WorkerEnv): Promise<{ actor: PlatformActor | null; denied: Response | null }> {
  const url = new URL(request.url);
  const route = url.searchParams.get("route") ?? "";
  if ([...url.searchParams.keys()].some((key) => key !== "route") || url.searchParams.getAll("route").length !== 1
    || !route.startsWith("/") || route.startsWith("//") || route.includes("?") || route.includes("#")) {
    return { actor: null, denied: response({ error: "assistant_route_invalid" }, 400) };
  }
  const surface = assistantSurfaceForRoute(route);
  if (!surface.available || surface.host !== "platform" || !surface.requiredCapabilities.length) {
    return { actor: null, denied: response({ error: "assistant_not_available" }, 404) };
  }
  const audience = request.headers.get("x-forma-assistant-audience") ?? "";
  const expectedEpoch = request.headers.get("x-forma-platform-permission-epoch") ?? "";
  if (audience !== surface.application || !/^[a-f0-9]{64}$/u.test(expectedEpoch)) {
    return { actor: null, denied: response({ error: "assistant_audience_mismatch" }, 403) };
  }
  const authorization = await requirePlatformAssistantPrincipal(request, env);
  if (authorization.response || !authorization.principal) return { actor: null, denied: authorization.response! };
  const principal = authorization.principal;
  if (!admittedAssistant(env, principal.userId)) return { actor: null, denied: response({ error: "assistant_not_available" }, 404) };
  if (principal.consentVersion !== POLICY_VERSION) return { actor: null, denied: response({ error: "pilot_terms_required" }, 428) };
  if (principal.access.permissionEpoch !== expectedEpoch) return { actor: null, denied: response({ error: "assistant_authorization_changed" }, 403) };
  if (!surface.requiredCapabilities.some((capability) => principal.access.capabilities.includes(capability))) {
    return { actor: null, denied: response({ error: "access_denied" }, 403) };
  }
  if (protectedReplay(surface) && principal.role !== "admin") return { actor: null, denied: response({ error: "administrator_required" }, 403) };
  return { actor: { principal, surface }, denied: null };
}

function pageResponse(surface: AssistantSurface) {
  const path = surface.canonicalFamily;
  if (path === "/operations/providers") return "assistant.platform.providers";
  if (path === "/operations/access") return "assistant.platform.access";
  if (path === "/operations/canvas") return "assistant.platform.canvas";
  if (path === "/product/insights" || path === "/operations/analytics") return "assistant.platform.insights";
  if (path === "/product/delivery") return "assistant.platform.delivery";
  if (protectedReplay(surface)) return "assistant.platform.actual";
  if (path.includes("adapters")) return "assistant.platform.qualification";
  if (surface.application === "product" && (path.includes("evaluation") || path.startsWith("/laboratory"))) return "assistant.platform.evaluation";
  if (path === "/knowledge/landing-pages") return "assistant.platform.marketing";
  if (path.includes("focal-points")) return "assistant.platform.focal";
  if (path === "/knowledge/guidance") return "assistant.platform.guidance";
  if (path.includes("design-system") || path === "/knowledge/patterns") return "assistant.platform.design";
  if (surface.application === "engineering" && path.endsWith("/sync")) return "assistant.platform.sync";
  if (surface.application === "engineering" && path.endsWith("/jobs")) return "assistant.platform.jobs";
  if (surface.application === "engineering" && path.includes("events")) return "assistant.platform.events";
  return `assistant.platform.${surface.application}`;
}

function translatedReply(reply: PlatformReply, locale: unknown) {
  const requested = typeof locale === "string" ? locale.toLowerCase() : "en";
  const family = requested.startsWith("fr") ? "fr" : requested.startsWith("ar") ? "ar" : requested.startsWith("ja") ? "ja" : "en";
  const text = ASSISTANT_MESSAGES[family][reply.key as keyof typeof ASSISTANT_MESSAGES.en]
    ?? ASSISTANT_MESSAGES.en[reply.key as keyof typeof ASSISTANT_MESSAGES.en] ?? "";
  return text.replace(/\{([^}]+)\}/gu, (_, key: string) => String(reply.values?.[key] ?? `{${key}}`));
}

function destinationFor(actor: PlatformActor, message: string, turnId: string): PlatformProposal | null {
  const destinations = SITE_ROUTE_ENTRIES.map((entry) => ({ entry, surface: assistantSurfaceForRoute(entry.path) }))
    .filter(({ surface }) => surface.available && surface.host === "platform"
      && surface.requiredCapabilities.some((capability) => actor.principal.access.capabilities.includes(capability))
      && (!protectedReplay(surface) || actor.principal.role === "admin"))
    .sort((left, right) => Number(right.surface.application === actor.surface.application) - Number(left.surface.application === actor.surface.application)
      || Number(right.entry.path.startsWith(`/${right.surface.application}`)) - Number(left.entry.path.startsWith(`/${left.surface.application}`)));
  const patterns: Array<[RegExp, RegExp]> = [
    [/actual|real[- ]data|réel|فعلي|実データ/iu, /\/product\/evaluation\/actual$|\/admin\/events\/replay$/iu],
    [/adapter|qualification|fournisseur.*qualifi|محول|アダプター/iu, /evaluation\/adapters|image-adapters/iu],
    [/focal|focus point|point focal|تركيز|注目点/iu, /focal-points/iu],
    [/(?:event|événement|حدث|イベント).*(?:permission|accès|صلاح|権限)|(?:permission|صلاح|権限).*(?:event|événement|حدث|イベント)/iu, /events\/permissions/iu],
    [/(?:event|événement|حدث|イベント).*(?:stream|flux|تدفق|ストリーム)/iu, /events\/stream/iu],
    [/provider|fournisseur|مزود|プロバイダー/iu, /\/operations\/providers$/iu],
    [/access|permission|accès|صلاح|アクセス|権限/iu, /\/operations\/access$|events\/permissions/iu],
    [/deliver|release|livraison|تسليم|リリース|提供/iu, /delivery|release/iu],
    [/insight|analytic|analyse|تحليل|分析/iu, /insight|analytic/iu],
    [/replay|relecture|استعادة|再生/iu, /evaluation\/replay|laboratory\/replay/iu],
    [/evaluat|test|évalu|تقييم|評価/iu, /\/product\/evaluation$/iu],
    [/guid|documentation|conseil|إرشاد|ガイド/iu, /guidance/iu],
    [/design|component|pattern|composant|تصميم|デザイン|コンポーネント/iu, /design|patterns/iu],
    [/sync|synchron|مزامنة|同期/iu, /\/engineering\/sync$|events\/sync/iu],
    [/job|worker|task|tâche|مهمة|ジョブ/iu, /\/engineering\/jobs$/iu],
    [/event|stream|événement|حدث|イベント/iu, /\/engineering\/events$|events\/stream/iu],
  ];
  const requested = patterns.find(([intent]) => intent.test(message));
  const wantsNextStep = /\b(?:next|suggest|help|open|navigate|show|go to|what should|useful|recommend)\b|(?:suivant|ouvrir|اقتراح|افتح|次|開く)/iu.test(message);
  const mentioned = requested ? destinations.find(({ entry }) => entry.path !== actor.surface.canonicalFamily && requested[1].test(entry.path)) : undefined;
  if (requested && !mentioned || !requested && !wantsNextStep) return null;
  const chosen = mentioned ?? destinations.find(({ surface }) => surface.application === actor.surface.application
    && surface.canonicalFamily !== actor.surface.canonicalFamily);
  if (!chosen || chosen.entry.path === actor.surface.canonicalFamily) return null;
  const application = applicationDefinition(chosen.surface.application);
  const task = application.navigation.find((item) => navigationItemActive(chosen.surface.application, item.id, chosen.entry.path));
  const path = chosen.surface.canonicalFamily;
  const exact = path === "/product/evaluation/actual" || path === "/admin/events/replay" ? "actual"
    : path.endsWith("/evaluation/adapters") || path === "/laboratory/image-adapters" ? "adapters"
    : path.endsWith("/evaluation/replay") || path === "/laboratory/replay" ? "replay"
    : path.endsWith("/events/permissions") ? "permissions"
    : path.endsWith("/events/stream") ? "stream"
    : path.includes("focal-points") ? "focal" : "";
  return { id: `platform-${turnId}`, turnId, kind: "navigate", key: "assistant.action.openPlatformPage",
    summaryKey: exact ? `assistant.platform.page.${exact}` : task ? `shell.navigation.${task.id}` : `shell.${chosen.surface.application}`,
    route: chosen.entry.path };
}

async function eventRows(env: WorkerEnv, actor: PlatformActor, turnId?: string): Promise<PlatformEventRow[]> {
  const now = new Date().toISOString();
  const conditions = turnId ? " AND event.turn_id=?" : "";
  const rows = await env.DB.prepare(`SELECT event.event_id,event.turn_id,event.event_type,event.sequence,event.reply_key,event.reply_values_json,event.proposal_json,content.content
    FROM platform_assistant_events event JOIN platform_assistant_private_content content
      ON content.content_id=event.content_id AND content.actor_user_id=event.actor_user_id AND content.audience=event.audience
        AND content.route_family=event.route_family AND content.permission_epoch=event.permission_epoch
        AND content.redacted_at IS NULL AND content.expires_at>?
    WHERE event.actor_user_id=? AND event.audience=? AND event.route_family=? AND event.permission_epoch=?${conditions}
      AND event.event_type IN('PlatformChatMessageSent','PlatformAssistantReasoned') ORDER BY event.sequence DESC LIMIT 12`)
    .bind(now, actor.principal.userId, actor.surface.application, actor.surface.canonicalFamily, actor.principal.access.permissionEpoch,
      ...(turnId ? [turnId] : [])).all<PlatformEventRow>();
  return rows.results.reverse();
}

function turnHistory(rows: PlatformEventRow[]): PlatformTurn[] {
  const turns = new Map<string, PlatformTurn>();
  for (const row of rows) {
    if (row.event_type === "PlatformChatMessageSent") {
      turns.set(row.turn_id, { id: row.turn_id, user: row.content, reply: { key: "assistant.platform.operations" }, proposal: null });
    } else {
      const turn = turns.get(row.turn_id);
      if (!turn) continue;
      let values: Record<string, string | number> | undefined;
      try { values = row.reply_values_json ? JSON.parse(row.reply_values_json) as Record<string, string | number> : undefined; } catch { values = undefined; }
      turn.reply = { key: row.reply_key ?? "assistant.platform.operations", ...(values ? { values } : {}) };
      try { turn.proposal = row.proposal_json ? JSON.parse(row.proposal_json) as PlatformProposal : null; } catch { turn.proposal = null; }
    }
  }
  return [...turns.values()];
}

async function platformContext(env: WorkerEnv, actor: PlatformActor, rows: PlatformEventRow[]): Promise<AssistantContext> {
  const head = await env.DB.prepare(`SELECT COALESCE(MAX(sequence),0) AS head FROM platform_assistant_events
    WHERE actor_user_id=? AND audience=? AND route_family=? AND permission_epoch=?`)
    .bind(actor.principal.userId, actor.surface.application, actor.surface.canonicalFamily, actor.principal.access.permissionEpoch)
    .first<{ head: number }>();
  const activity = await env.DB.prepare(`SELECT event_id,event_type,sequence FROM platform_assistant_events
    WHERE actor_user_id=? AND audience=? AND route_family=? AND permission_epoch=? AND event_type='PlatformNavigationProposed'
    ORDER BY sequence DESC LIMIT ?`)
    .bind(actor.principal.userId, actor.surface.application, actor.surface.canonicalFamily, actor.principal.access.permissionEpoch,
      ASSISTANT_CONTEXT_LIMITS.actions).all<{ event_id: string; event_type: string; sequence: number }>();
  const signals: NonNullable<AssistantContext["platformSignals"]> = [];
  const route = actor.surface.canonicalFamily;
  if (route === "/operations/providers") {
    const providers = await env.DB.prepare("SELECT status,COUNT(*) AS count FROM provider_health WHERE expires_at>? GROUP BY status ORDER BY status LIMIT 6")
      .bind(new Date().toISOString()).all<{ status: string; count: number }>();
    signals.push(...providers.results.map((item) => ({ kind: "provider-health", status: String(item.status), count: Number(item.count) })));
  } else if (route === "/operations/access") {
    const grants = await env.DB.prepare("SELECT COUNT(*) AS count FROM capability_grants WHERE scope_type IN('platform','synthetic') AND status='active' AND revoked_at IS NULL AND(expires_at IS NULL OR expires_at>?)")
      .bind(new Date().toISOString()).first<{ count: number }>();
    signals.push({ kind: "specialist-access", status: "active", count: Number(grants?.count ?? 0) });
  } else if (route === "/product/delivery") {
    const decisions = await env.DB.prepare("SELECT status,COUNT(*) AS count FROM delivery_decisions GROUP BY status ORDER BY status LIMIT 6")
      .all<{ status: string; count: number }>();
    signals.push(...decisions.results.map((item) => ({ kind: "release-decision", status: String(item.status), count: Number(item.count) })));
  } else if (route === "/operations/canvas" || route === "/operations" || route === "/system") {
    const governance = await env.DB.prepare("SELECT status,COUNT(*) AS count FROM canvas_governance_requirements GROUP BY status ORDER BY status LIMIT 4")
      .all<{ status: string; count: number }>();
    signals.push(...governance.results.map((item) => ({ kind: "governance-requirement", status: String(item.status), count: Number(item.count) })));
  } else if (actor.surface.application === "engineering") {
    const metrics = await env.DB.prepare("SELECT COUNT(*) AS count FROM route_performance_samples WHERE audience=?")
      .bind("engineering").first<{ count: number }>();
    signals.push({ kind: "anonymous-route-health", status: "observed", count: Number(metrics?.count ?? 0) });
  }
  return {
    surface: actor.surface,
    scope: { actorUserId: actor.principal.userId, organizationId: null, projectAccessId: null, projectId: null, documentId: null },
    documentTitle: null, selectedItems: [], decisionAtoms: [], relationships: [], unfinishedIntents: [], availableOutputs: [],
    availableOutputKinds: ASSISTANT_OUTPUT_KINDS, platformSignals: signals, totals: { decisions: 0, outputs: 0, outputsByKind: {} },
    recentTurns: rows.slice(-ASSISTANT_CONTEXT_LIMITS.turns).map((row) => ({ id: row.event_id,
      role: row.event_type === "PlatformChatMessageSent" ? "user" : "assistant", text: row.content, sequence: row.sequence })),
    recentActions: activity.results.reverse().map((event) => ({ id: event.event_id, type: event.event_type,
      sequence: Number(event.sequence), documentId: null })),
    capabilities: actor.principal.access.capabilities.filter((capability) => actor.surface.requiredCapabilities.includes(capability)),
    playbook: assistantPlaybookForSurface(actor.surface), evidence: { head: Number(head?.head ?? 0), eventIds: rows.map((row) => row.event_id) }, truncated: false,
  };
}

function contextualReply(actor: PlatformActor, context: AssistantContext, message: string): PlatformReply {
  if (/\b(?:audio|music|sound|soundtrack|formats?)\b|(?:musique|son|صوت|الصوت|音声|音楽)/iu.test(message)) {
    return { key: "assistant.platform.answer.audio" };
  }
  if (/\b(?:privacy|private|safe|security|secret|confidential)\b|(?:privé|sécurité|خصوص|أمان|プライバシー|安全)/iu.test(message)) {
    return { key: "assistant.platform.answer.privacy" };
  }
  if (/\b(?:permission|access|capabilit|grant|role|allowed|authorize)\b|(?:accès|autorisation|صلاح|الوصول|権限|アクセス)/iu.test(message)) {
    return { key: "assistant.platform.answer.permissions", values: { capabilities: context.capabilities.length } };
  }
  if (/\b(?:history|recent(?:ly)?|previous|last|changed|actions?|taken|done|activity)\b|(?:récent|historique|سابق|مؤخر|最近|履歴)/iu.test(message)) {
    return { key: "assistant.platform.answer.history", values: { actions: context.recentActions.length, turns: context.recentTurns.length } };
  }
  if (/\b(?:status|health|ready|readiness|blocked|pending|issue|problem)\b|(?:état|prêt|حالة|جاهز|状態|準備)/iu.test(message)) {
    return { key: "assistant.platform.answer.status", values: { signals: context.platformSignals?.length ?? 0,
      actions: context.recentActions.length } };
  }
  if (/\b(?:next|suggest|help|useful|what should|guide|recommend|open|navigate|show|go to)\b|(?:aide|suivant|ouvrir|اقتراح|التالي|افتح|次|おすすめ|開く)/iu.test(message)) {
    return { key: "assistant.platform.answer.next", values: { steps: context.playbook.length } };
  }
  return { key: pageResponse(actor.surface) };
}

function authorizationGuard(actor: PlatformActor, env: WorkerEnv) {
  const required = actor.surface.requiredCapabilities;
  const captured = actor.principal.authorizationSnapshot;
  const permissions = actor.principal.role === "admin" ? "principal.role='admin'"
    : `EXISTS(SELECT 1 FROM capability_grants grant_row WHERE grant_row.user_id=principal.user_id
        AND grant_row.scope_type IN('platform','synthetic') AND grant_row.organization_id IS NULL AND grant_row.project_access_id IS NULL
        AND grant_row.status='active' AND grant_row.revoked_at IS NULL AND(grant_row.expires_at IS NULL OR grant_row.expires_at>?)
        AND grant_row.capability IN(${required.map(() => "?").join(",")}))`;
  const restricted = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
  const breakglass = new Set((env.FORMA_ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const cohort = restricted && !breakglass.has(actor.principal.email)
    ? ` AND EXISTS(SELECT 1 FROM pilot_cohorts cohort JOIN organizations organization ON organization.organization_id=cohort.organization_id
        AND organization.status='active' JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id
        AND participant.organization_id=cohort.organization_id WHERE cohort.organization_id=(SELECT selected.organization_id FROM pilot_cohorts selected WHERE selected.cohort_id=?)
          AND cohort.status IN('active','paused') AND cohort.starts_at<=? AND cohort.ends_at>?
          AND participant.user_id=principal.user_id AND participant.email_normalized=? AND participant.status='active' AND participant.revoked_at IS NULL)` : "";
  const now = new Date().toISOString();
  return {
    sql: `EXISTS(SELECT 1 FROM(${PLATFORM_PRINCIPAL_WITH_ACCESS_SQL})principal
      WHERE principal.user_id=? AND principal.role=? AND principal.updated_at=? AND principal.consent_version=?
        AND COALESCE(principal.permission_epoch,'')=? AND COALESCE(principal.grants_json,'[]')=?
        AND COALESCE(principal.organizations_json,'[]')=? AND COALESCE(principal.projects_json,'[]')=?
        AND COALESCE(principal.identity_policies_json,'[]')=? AND COALESCE(principal.approved_canvas_requirements,0)=?
        AND ${permissions}${cohort})`,
    bindings: [actor.principal.userId, actor.principal.userId, actor.principal.role, actor.principal.updatedAt, POLICY_VERSION,
      captured.rawEpoch, captured.grants, captured.organizations, captured.projects, captured.identityPolicies, captured.canvasRequirements,
      ...(actor.principal.role === "admin" ? [] : [now, ...required]),
      ...(cohort ? [restricted, now, now, actor.principal.email] : [])] as Array<string | number | null>,
  };
}

async function commitPlatformTurn(env: WorkerEnv, actor: PlatformActor, turnId: string, message: string, locale: unknown,
  reply: PlatformReply, proposal: PlatformProposal | null) {
  const occurred = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const userContent = uuidV7(), replyContent = uuidV7();
  const authoredEvent = uuidV7(), answerEvent = uuidV7();
  const scope = [actor.principal.userId, actor.surface.application, actor.surface.canonicalFamily, actor.principal.access.permissionEpoch];
  const current = await env.DB.prepare(`SELECT COALESCE(MAX(sequence),0) AS head FROM platform_assistant_events
    WHERE actor_user_id=? AND audience=? AND route_family=? AND permission_epoch=?`).bind(...scope).first<{ head: number }>();
  const head = Number(current?.head ?? 0);
  const insertContent = "INSERT INTO platform_assistant_private_content(content_id,actor_user_id,audience,route_family,permission_epoch,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)";
  const insertEvent = "INSERT INTO platform_assistant_events(event_id,actor_user_id,audience,route_family,permission_epoch,turn_id,event_type,sequence,content_id,reply_key,reply_values_json,proposal_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)";
  const statements = [
    env.DB.prepare(insertContent).bind(userContent, ...scope, "platform-chat-user", message, occurred, expires),
    env.DB.prepare(insertContent).bind(replyContent, ...scope, "platform-chat-assistant", translatedReply(reply, locale), occurred, expires),
    env.DB.prepare(insertEvent).bind(authoredEvent, ...scope, turnId, "PlatformChatMessageSent", head + 1, userContent, null, null, null, occurred),
    env.DB.prepare(insertEvent).bind(answerEvent, ...scope, turnId, "PlatformAssistantReasoned", head + 2, replyContent, reply.key,
      reply.values ? JSON.stringify(reply.values) : null, proposal ? JSON.stringify(proposal) : null, occurred),
  ];
  if (proposal) statements.push(env.DB.prepare(insertEvent)
    .bind(uuidV7(), ...scope, turnId, "PlatformNavigationProposed", head + 3, null, null, null, JSON.stringify(proposal), occurred));
  const guard = authorizationGuard(actor, env);
  statements.push(env.DB.prepare(`INSERT INTO platform_assistant_commits(commit_id,verified,created_at) VALUES(?,CASE WHEN ${guard.sql}
    AND EXISTS(SELECT 1 FROM platform_assistant_events WHERE event_id=? AND actor_user_id=? AND event_type='PlatformChatMessageSent')
    AND EXISTS(SELECT 1 FROM platform_assistant_events WHERE event_id=? AND actor_user_id=? AND event_type='PlatformAssistantReasoned')
    THEN 1 ELSE 0 END,?)`)
    .bind(`platform:${actor.principal.userId}:${actor.surface.application}:${actor.surface.canonicalFamily}:${actor.principal.access.permissionEpoch}:${turnId}`,
      ...guard.bindings, authoredEvent, actor.principal.userId, answerEvent, actor.principal.userId, occurred));
  await env.DB.batch(statements);
}

/** Dedicated platform conversation: no Creator stream, private content, provider, budget, project document, or mutation. */
export async function handlePlatformAssistant(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const authorization = await authorizePlatformAssistant(request, env);
  if (authorization.denied || !authorization.actor) return authorization.denied!;
  const actor = authorization.actor;
  await ensurePlatformAssistantSchema(env);
  const rows = await eventRows(env, actor);
  const context = await platformContext(env, actor, rows);
  if (request.method === "GET") return response({ context, turns: turnHistory(rows), tasks: [] });

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return response({ error: "assistant_request_invalid" }, 400);
    body = parsed as Record<string, unknown>;
  } catch { return response({ error: "assistant_request_invalid" }, 400); }
  if (Object.keys(body).some((key) => !["turnId", "message", "locale"].includes(key))) return response({ error: "assistant_request_invalid" }, 400);
  const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(turnId)) return response({ error: "assistant_turn_invalid" }, 400);
  if (!message || message.length > ASSISTANT_CONTEXT_LIMITS.turnChars) return response({ error: "assistant_message_invalid" }, 400);
  const existing = turnHistory(await eventRows(env, actor, turnId))[0];
  if (existing) return existing.user === message ? response({ context, turn: existing }) : response({ error: "assistant_turn_conflict" }, 409);
  const reply = contextualReply(actor, context, message);
  const proposal = destinationFor(actor, message, turnId);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const live = await authorizePlatformAssistant(request, env);
    if (live.denied || !live.actor || live.actor.principal.access.permissionEpoch !== actor.principal.access.permissionEpoch) {
      return response({ error: "assistant_authorization_changed" }, 403);
    }
    try {
      await commitPlatformTurn(env, actor, turnId, message, body.locale, reply, proposal);
      return response({ context, turn: { id: turnId, user: message, reply, proposal } satisfies PlatformTurn }, 201);
    } catch (error) {
      const repeated = turnHistory(await eventRows(env, actor, turnId))[0];
      if (repeated) return repeated.user === message ? response({ context, turn: repeated }) : response({ error: "assistant_turn_conflict" }, 409);
      if (/CHECK constraint|platform_assistant_commits/iu.test(error instanceof Error ? error.message : String(error))) {
        return response({ error: "assistant_authorization_changed" }, 403);
      }
      if (attempt === 3) return response({ error: "assistant_unavailable" }, 409);
    }
  }
  return response({ error: "assistant_unavailable" }, 409);
}
