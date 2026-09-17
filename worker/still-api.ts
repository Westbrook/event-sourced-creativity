import { handleEvents } from './events-api.ts';
import { handleSession, requireConsent, requireUser } from './pilot-policy.ts';
import type { WorkerEnv, WorkerExecutionContext } from './runtime.ts';
import type { CreativeEvent } from '../src/model/events.ts';
import { buildDecisionState, POLICY_VERSION, questionsFor, rankFormats, selectActions, type Abilities, type Answer, type Position } from '../src/still/decisions.ts';
import { decisionDiagnostics, type DecisionExchange } from '../src/still/diagnostics.ts';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', vary: 'Cookie, oai-authenticated-user-id' } });
const recentCalls = new Map<string, number>();
export async function handleStillDecision(request: Request, env: WorkerEnv, context: WorkerExecutionContext) {
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const auth = await requireUser(request, env);
  if (auth.response || !auth.user) return auth.response!;
  const consent = requireConsent(auth.user); if (consent) return consent;
  const raw = await request.text();
  if (raw.length > 12_000) return reply({ error: 'position_too_large' }, 413);
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw); } catch { return reply({ error: 'invalid_json' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({ error: 'invalid_position' }, 400);
  const clean = (key: string, max = 180) => typeof input[key] === 'string' ? String(input[key]).slice(0, max) : '';
  const position: Position = { projectId: clean('projectId'), documentId: clean('documentId'), blockId: clean('blockId'), outputId: clean('outputId'), view: clean('view', 40), itemIndex: Number.isSafeInteger(input.itemIndex) ? Math.max(0,Math.min(1000,Number(input.itemIndex))) : 0, intent: clean('intent', 2000), recentActions: Array.isArray(input.recentActions) ? input.recentActions.filter(x => typeof x === 'string').slice(-12).map(x => x.slice(0, 60)) : [] };
  const rateKey = auth.user.userId;
  const now = Date.now();
  if ((recentCalls.get(rateKey) ?? 0) > now - 1200) return reply({ error: 'decision_cooldown' }, 429);
  recentCalls.set(rateKey, now);
  if (recentCalls.size > 500) for (const [key, at] of recentCalls) if (at < now - 60_000) recentCalls.delete(key);
  // Reuse Forma's exact scope/retention checks. No client-supplied event history or arbitrary account IDs.
  const sessionResponse = await handleSession(new Request(new URL('/api/session', request.url), { headers: request.headers }), env, context);
  if (!sessionResponse.ok) return sessionResponse;
  const session = await sessionResponse.json() as { user: { role: string }; policy: { accepted: boolean }; provider: Record<string, unknown>; projectContext?: { projectId: string; permissions: string[] } };
  if (!session.policy.accepted) return reply({ error: 'consent_required' }, 403);
  const scoped = session.projectContext;
  const abilities: Abilities = { author: scoped ? scoped.permissions.includes('project.author') : ['creator', 'agent', 'admin'].includes(session.user.role), generate: scoped ? scoped.permissions.includes('project.output.request') : ['creator', 'agent', 'admin'].includes(session.user.role), projectCreate: !scoped && ['creator', 'admin', 'agent'].includes(session.user.role), formats: [...(session.provider.configured ? ['image', 'storyboard'] : []), ...(session.provider.plannerConfigured ? ['short_story', 'scene', 'slides'] : []), ...(session.provider.videoConfigured ? ['video'] : []), ...(session.provider.audioConfigured ? ['audio'] : []), ...(session.provider.model3dConfigured ? ['model3d'] : [])] };
  const events: CreativeEvent[] = []; let after = 0; let head = 0; let content: Record<string,string> = {};
  for (;;) {
    const read = new URL(`/api/events?after=${after}&limit=5000&content=${after ? 0 : 1}`, request.url);
    const response = await handleEvents(new Request(read, { headers: request.headers }), env);
    if (!response.ok) return response;
    const page = await response.json() as { events: CreativeEvent[]; head: number; hasMore: boolean; nextAfter: number; content?: Record<string,string> };
    if (!head) head = page.head;
    if (page.content) content = page.content;
    events.push(...page.events.filter(e => e.sequence <= head));
    if (!page.hasMore || page.nextAfter >= head) break;
    if (page.nextAfter <= after) return reply({ error: 'history_did_not_advance' }, 503);
    after = page.nextAfter;
    if (events.length > 150_000) return reply({ error: 'history_too_large_for_decision' }, 503);
  }
  const built = buildDecisionState(events, position, abilities, head, content);
  if (position.projectId && !built.projection.projects.some(p => p.id === position.projectId) || position.documentId && !built.projection.documents.some(d => d.id === position.documentId && !d.removed)) return reply({ error: 'selection_unavailable' }, 409);
  const choosingFormat = position.view === 'choose-format';
  let asked=false;
  let exchange:DecisionExchange|undefined;
  const diagnostics = (source:string, reason?:string, answers?:Record<string,Answer>, model?:string, observedAnswers?:Record<string,Answer>) => input.developer===true ? {diagnostics:decisionDiagnostics(built.projection,position,abilities,{head,source,reason,answers,model,observedAnswers,asked,exchange,artifactKind:built.state.selectedWork?.kind,coverage:built.state.history.coverage})} : {};
  const fallback = (reason: string, observedAnswers?:Record<string,Answer>) => reply({ source: 'fallback', reason, policy: POLICY_VERSION, head, actions: choosingFormat ? [] : selectActions(built.candidates, position), formats: [], candidateIds: built.candidates.map(a => a.id), ...diagnostics('fallback',reason,undefined,undefined,observedAnswers) });
  if (!env.JEV_API_KEY) return fallback('not_configured');
  try {
    const body = JSON.stringify({ model: 'jev-latest', state: built.state, questions: questionsFor(built.candidates,position,built.state.selectedWork?.kind) });
    if (new TextEncoder().encode(body).byteLength > 60_000) return fallback('context_budget');
    // Snapshot the wire representation once; expansion never rebuilds state or calls Jev.
    if(input.developer===true)exchange={requestId:crypto.randomUUID(),requestedAt:new Date().toISOString(),request:JSON.parse(body)};
    asked=true;
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { authorization: `Bearer ${env.JEV_API_KEY}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if(exchange)exchange.responseStatus=response.status;
    if (!response.ok) return fallback(response.status === 429 || response.status === 529 ? 'busy' : 'unavailable');
    const result = await response.json() as { model?: string; answers?: Record<string, Answer> };
    if (!result.answers || typeof result.answers !== 'object' || Array.isArray(result.answers)) return fallback('uncertain');
    if (!built.candidates.some(a => { if(a.id==='intent')return false; const x = result.answers?.[`${choosingFormat ? 'fit' : 'use'}_${a.id}`]; return x?.type === 'score' && Number.isFinite(x.score) && x.score! >= 0 && x.score! <= 3 && Number.isFinite(x.confidence) && x.confidence! >= .12 && x.confidence! <= 1; })) return fallback('uncertain',result.answers);
    return reply({ source: 'jev', model: result.model, policy: POLICY_VERSION, head, actions: choosingFormat ? [] : selectActions(built.candidates, position, result.answers), formats: choosingFormat ? rankFormats(built.candidates, result.answers) : [], candidateIds: built.candidates.map(a => a.id), stage: result.answers.stage?.choice, questionsEvaluated: Object.keys(questionsFor(built.candidates,position,built.state.selectedWork?.kind)).length, ...diagnostics('jev',undefined,result.answers,result.model) });
  } catch { return fallback('unavailable'); }
}
