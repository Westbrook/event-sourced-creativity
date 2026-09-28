import { AsyncLocalStorage } from 'node:async_hooks';
import { createSitesStudyApi, SITES_STUDY_PREFIX, hash, canonical, operationKey, HOST_LIMITS } from './application.mjs';
import D from './dataset.json';
const local = new AsyncLocalStorage();
const api = createSitesStudyApi(D.config);
const fail = (message) => { throw Error(message); };
const check = (value, message) => { if (!value)
    fail(message); };
const quote = (name) => '"' + name + '"';
const bytes = Uint8Array.from(atob(D.pngBase64), c => c.charCodeAt(0));
const allowedObjects = D.config.entries[0].proposal.plan.manifest.trials.map(t => { const id = operationKey('mock-owner', D.config.entries[0].proposal.plan, t); return { operation: id, key: `generation-study/${hash('mock-owner')}/${hash(id)}.png` }; });
const expiry = Date.parse(D.expiry), life = 3600000;
const steps = ['rollback', 'approve', 'baseline', 'recover-original', 'settle-baseline', 'observe', 'treatment', 'settle-treatment', 'expiry-revocation', 'terminal-stop'];
const limits = { statements: 6000, reads: 10000000, writes: 20000, databaseBytes: 16000000, requests: 80, objectBytes: bytes.length, objects: 2, providerResponses: 6 };
const headers = { 'cache-control': 'private, no-store' };
const guard = ['INSERT INTO p5_rehearsal_guard(ok) VALUES(changes())', 'DELETE FROM p5_rehearsal_guard'];
let instance;
function meter(results) { const c = local.getStore(); for (const r of results) {
    check(r.success && Number.isFinite(r.meta?.rows_read) && Number.isFinite(r.meta?.rows_written) && Number.isFinite(r.meta?.size_after), 'd1_metrics_required');
    c.statements++;
    c.reads += r.meta.rows_read;
    c.writes += r.meta.rows_written;
    c.databaseBytes = Math.max(c.databaseBytes, r.meta.size_after);
    check(c.statements <= limits.statements && c.reads <= limits.reads && c.writes <= limits.writes && c.databaseBytes <= limits.databaseBytes, 'resource_envelope_exceeded');
} check(Date.now() < c.deadline, 'request_deadline'); }
async function batch(db, items) { const c = local.getStore(); c.bindingCalls++; c.attemptedStatements += items.length; check(c.bindingCalls <= 950, 'binding_call_envelope'); check(items.every(([sql, v = []]) => new TextEncoder().encode(sql).length <= 100000 && v.length <= 100), 'd1_statement_bounds'); let r; try {
    r = await db.batch(items.map(([s, v = []]) => db.prepare(s).bind(...v)));
}
catch (e) {
    c.failedBatches++;
    throw e;
} meter(r); return r; }
async function all(db, s, v = []) { return (await batch(db, [[s, v]]))[0].results; }
async function one(db, s, v = []) { return (await all(db, s, v))[0]; }
async function claim(db, sql, v = []) { await batch(db, [[sql, v], ...guard.map(s => [s])]); }
function appDB(db) {
    const refs = new WeakMap();
    const wrap = (sql, values = []) => { const s = { bind: (...v) => wrap(sql, v), all: async () => { const r = await perform([s]); return r[0]; }, first: async () => { const r = await perform([s]); return r[0].results[0] ?? null; }, run: async () => { const r = await perform([s]); return r[0]; } }; refs.set(s, [sql, values]); return s; };
    async function perform(ss) {
        const c = local.getStore();
        const statements = ss.map(s => refs.get(s));
        check(statements.every(Boolean), 'uncompiled_statement');
        // The real D1 schema and results pass through unchanged. This guard only fences
        // the dedicated rehearsal controller; production qualification is untouched.
        const active = ["INSERT INTO p5_rehearsal_guard(ok) SELECT CASE WHEN phase='busy' AND dataset=? THEN 1 ELSE 0 END FROM p5_rehearsal_run WHERE id=1", [D.datasetId]];
        const rollback = c.rollback && statements.some(([s]) => /INSERT INTO authoring_study_commits/.test(s));
        if (rollback)
            c.rollbackInjected = true;
        try {
            const r = await batch(db, [active, ['DELETE FROM p5_rehearsal_guard'], ...statements, ...(rollback ? [['INSERT INTO p5_rehearsal_guard(ok) VALUES(0)']] : [])]);
            return r.slice(2);
        }
        catch (e) {
            c.databaseError = String(e).slice(0, 400);
            throw e;
        }
    }
    return { prepare: wrap, batch: perform };
}
function applicationEnv(bindings) { const c = local.getStore(); return { DB: appDB(bindings.DB), MEDIA: { put: async (key, value, options) => { check(c.providers <= 6 && allowedObjects.some(o => o.key === key) && value.byteLength === bytes.length && hash(Buffer.from(value)) === hash(Buffer.from(bytes)), 'object_scope'); c.r2.put++; return bindings.MEDIA.put(key, value, options); }, get: async (key) => { check(allowedObjects.some(o => o.key === key), 'object_scope'); c.r2.get++; return bindings.MEDIA.get(key); }, delete: async (key) => { check(allowedObjects.some(o => o.key === key), 'object_scope'); c.r2.delete++; return bindings.MEDIA.delete(key); } }, ASSETS: { fetch: () => fail('assets_forbidden') }, FORMA_GENERATION_STUDY_ENABLED: '1', FORMA_GENERATION_STUDY_APPROVAL_ENABLED: '1', FORMA_GENERATION_STUDY_ORIGIN: D.origin, OPENAI_API_KEY: 'OFFLINE-NON-CREDENTIAL', OPENAI_PROJECT: 'OFFLINE-project' }; }
async function invoke(bindings, action, body = {}, extra = {}) { const req = new Request(D.origin + SITES_STUDY_PREFIX + action, { method: 'POST', headers: { origin: D.origin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'mock-owner', 'oai-authenticated-user-email': 'owner@example.test', ...extra }, body: JSON.stringify({ proposalId: D.config.entries[0].proposal.proposalId, ...body }) }); const r = await api(req, applicationEnv(bindings)); if (r.headers.get('content-type')?.startsWith('image/')) {
    const data = new Uint8Array(await r.arrayBuffer());
    check(hash(Buffer.from(data)) === hash(Buffer.from(bytes)), 'original_hash');
    return { bytes: data.length, sha256: hash(Buffer.from(data)) };
} return r.json(); }
// No real network implementation is reachable from this bundle. Every response
// is compiled synthetic data, and unmatched URL/method/body/header is refused.
globalThis.fetch = (async (url, init) => { const c = local.getStore(); check(c && c.action === 'step' && ['baseline', 'treatment'].includes(c.step), 'provider_case_denied'); check(init?.method === 'POST' && init?.headers?.authorization === 'Bearer OFFLINE-NON-CREDENTIAL' && init.headers['OpenAI-Project'] === 'OFFLINE-project', 'transport_identity'); check(init.redirect === 'error' && Object.values(D.config.entries[0].proposal.plan.requests[c.step]).some((r) => r.body === init.body && 'https://api.openai.com' + r.endpoint === url), 'unmatched_transport_denied'); const body = JSON.parse(init.body); const moderation = url === 'https://api.openai.com/v1/moderations', image = url === 'https://api.openai.com/v1/images/generations'; check((moderation && body.model === 'omni-moderation-latest') || (image && body.model === 'gpt-image-2.5-sunburst' && body.n === 1 && body.size === '1536x1024' && body.quality === 'high'), 'unmatched_transport_denied'); const op = await one(c.bindings.DB, 'SELECT * FROM generation_study_operations WHERE trial_id=?', [c.step]); check(op, 'original_operation_required'); const intent = await one(c.bindings.DB, "SELECT * FROM generation_study_stages WHERE operation_id=? AND status='intent'", [op.operation_id]); check(intent, 'original_intent_required'); const state = await one(c.bindings.DB, 'SELECT phase FROM p5_rehearsal_run WHERE id=1'); check(state.phase === 'busy', 'stopped_before_transport'); c.providers++; check(c.providers <= 3, 'provider_inventory'); c.intent.push({ operationId: op.operation_id, providerStage: moderation ? 'moderation' : 'image', beforeResponse: true }); return moderation ? Response.json({ results: body.input.map(() => ({ flagged: false, categories: {} })) }, { headers: { 'x-request-id': 'P5-SYNTHETIC-' + c.step + '-' + c.providers } }) : Response.json({ data: [{ b64_json: D.pngBase64 }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { text_tokens: 10, image_tokens: 0 } } }, { headers: { 'x-request-id': 'P5-SYNTHETIC-' + c.step + '-' + c.providers } }); });
async function settle(bindings, arm) {
    const db = bindings.DB, p = D.config.entries[0].proposal;
    const o = await one(db, 'SELECT * FROM generation_study_operations WHERE trial_id=?', [arm]);
    check(o?.provider_request_id && o?.receipt_hash, 'original_receipt_missing');
    const policy = JSON.parse((await one(db, 'SELECT policy_json FROM generation_study_financial_grants WHERE operation_id=?', [o.operation_id])).policy_json);
    const now = new Date().toISOString();
    const charge = { operation_id: o.operation_id, provider_request_id: o.provider_request_id, receipt_hash: o.receipt_hash, used_microusd: 650, used_tokens: 30, authority_version: 'P5-SYNTHETIC-verifier', evidence_ref: 'P5-SYNTHETIC-original', recorded_at: now, inventory_hash: hash({ planId: p.plan.id, inventory: p.plan.inventory, limits: HOST_LIMITS }), stop_reason: null };
    // Values follow the unchanged original-charge table's exact column order.
    await batch(db, [['INSERT INTO generation_study_charges VALUES(?,?,?,?,?,?,?,?,?,?)', Object.values(charge)]]);
    const stored = await one(db, 'SELECT * FROM generation_study_charges WHERE operation_id=?', [o.operation_id]);
    const event = { evidence_id: arm + '-P5', operation_id: o.operation_id, sequence: 1, previous_id: null, original_charge_hash: hash(stored), policy_id: policy.id, evidence_kind: 'verified-incurred-charge', authority_version: 'P5-SYNTHETIC-verifier', evidence_ref: 'P5-SYNTHETIC-billing', recorded_at: now, provider_settled: 1, incurred_microusd: 650, incurred_tokens: 30, remaining_uncertainty_microusd: 0, lifecycle_microusd: 800, lifecycle_scope: policy.lifecycle.scope, liability_owner: 'mock-owner', lifecycle_through: policy.lifecycle.through, lifecycle_evidence_ref: 'P5-SYNTHETIC-lifecycle', lifecycle_closed: 0, lifecycle_incurred_microusd: null };
    await batch(db, [[`INSERT INTO generation_study_reconciliations (${Object.keys(event).join(',')}) VALUES(${Object.keys(event).map(() => '?').join(',')})`, Object.values(event)]]);
    const r = await invoke(bindings, 'reconcile', { arm });
    check(r.action === 'completed', 'original_reconciliation_failed:' + JSON.stringify(r));
    return r;
}
async function executeStep(bindings, index) {
    const db = bindings.DB, c = local.getStore(), p = D.config.entries[0].proposal;
    const step = steps[index];
    c.step = step;
    if (step === 'rollback' || step === 'approve') {
        const before = await all(db, 'SELECT (SELECT count(*) FROM authoring_study_commits) commits,(SELECT count(*) FROM generation_study_grants) grants,(SELECT count(*) FROM private_content) copies');
        const preview = await invoke(bindings, 'approval', { action: 'preview' });
        check(preview.committable === true, 'preview_failed:' + JSON.stringify(preview));
        c.rollback = step === 'rollback';
        const result = await invoke(bindings, 'approval', { action: 'commit', previewId: preview.previewId, displayHash: preview.displayHash, intentId: p.intentId, decision: preview.display.expectedDecision });
        if (c.rollback) {
            check(c.rollbackInjected && result.status === 'denied', 'rollback_injection_failed');
            const after = await one(db, 'SELECT (SELECT count(*) FROM authoring_study_commits) commits,(SELECT count(*) FROM generation_study_grants) grants');
            check(after.commits === before[0].commits && after.grants === before[0].grants, 'rollback_failed');
            return { rollback: true, commits: after.commits, grants: after.grants };
        }
        check(result.status === 'committed', 'commit_failed:' + JSON.stringify(result));
        return { status: result.status, receiptHash: hash(result) };
    }
    if (step === 'baseline' || step === 'treatment') {
        const result = await invoke(bindings, 'execute', { arm: step });
        check(result.reason === 'original_charge_unreconciled', 'execute_failed:' + JSON.stringify(result));
        check(c.providers === 3, 'provider_count');
        return { result, intent: c.intent, syntheticResponses: c.providers };
    }
    if (step === 'recover-original') {
        const original = await one(db, "SELECT * FROM generation_study_operations WHERE trial_id='baseline'");
        const again = await invoke(bindings, 'execute', { arm: 'baseline' });
        check(c.providers === 0, 'duplicate_dispatch');
        const after = await one(db, "SELECT * FROM generation_study_operations WHERE trial_id='baseline'");
        check(original.operation_id === after.operation_id && original.receipt_hash === after.receipt_hash, 'original_replaced');
        const recovered = await invoke(bindings, 'recover', { arm: 'baseline' });
        check(recovered.sha256 === hash(Buffer.from(bytes)), 'custody_failed');
        return { duplicate: again, originalOperation: original.operation_id, recovered, lostAcknowledgement: 'Previous committed result intentionally discarded by driver; cross-request original recovery; no forced restart' };
    }
    if (step === 'settle-baseline' || step === 'settle-treatment')
        return settle(bindings, step.slice(7));
    if (step === 'observe') {
        const blocked = await invoke(bindings, 'execute', { arm: 'treatment' });
        check(blocked.status === 'denied' && c.providers === 0, 'human_gate_missing');
        const observation = await invoke(bindings, 'observe', { arm: 'baseline', safety: 'clear', fidelity: 'expected-failure', finding: 'baseline tether', evidenceRef: 'P5-SYNTHETIC-observer-not-a-human-review', resume: true });
        check(observation.action === 'observation_recorded', 'observation_failed');
        return { blocked, observation, syntheticHumanSimulation: true };
    }
    if (step === 'expiry-revocation') {
        let immutable = false;
        try {
            await batch(db, [["UPDATE authoring_study_configurations SET expires_at='2000-01-01T00:00:00.000Z' WHERE proposal_id=?", [p.proposalId]]]);
        }
        catch {
            immutable = true;
        }
        check(immutable, 'immutable_expiry_changed');
        const ref = p.arms[0].evidence.find(e => e.kind === 'account').contentRef;
        await batch(db, [["UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?", [ref]]]);
        const expired = await invoke(bindings, 'execute', { arm: 'baseline' });
        check(expired.status === 'denied' && expired.error === 'authoring_study_evidence_unavailable', 'expired_evidence_accepted');
        await batch(db, [["UPDATE authoring_study_configurations SET status='revoked' WHERE proposal_id=?", [p.proposalId]]]);
        const revoked = await invoke(bindings, 'approval', { action: 'preview' });
        check(revoked.status === 'denied' && revoked.error === 'authoring_study_configuration_unavailable', 'revoked_configuration_accepted');
        return { immutableProposalExpiry: true, expiredPrivateEvidence: expired, revoked, renewal: false };
    }
    if (step === 'terminal-stop') {
        const stopped = await invoke(bindings, 'stop');
        const denied = await invoke(bindings, 'execute', { arm: 'treatment' });
        check(denied.status === 'denied' && c.providers === 0, 'terminal_stop_failed');
        return { stopped, denied };
    }
    fail('step_out_of_range');
}
async function preflight(db) { const schema = await all(db, "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN('d1_migrations','_cf_KV','_cf_METADATA') ORDER BY name"); check(canonical(schema) === canonical([...D.schema, {"type":"table","name":"__appgarden_migrations","tbl_name":"__appgarden_migrations","sql":"CREATE TABLE \"__appgarden_migrations\"(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)"}].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), 'schema_mismatch'); const old = await one(db, 'SELECT * FROM n10h_run WHERE id=1'); check(old?.phase === 'disabled' && old.report === null && old.next === 205 && old.cleanup === 205, 'retired_tombstone_changed'); return { schemaHash: hash(schema), retiredTombstoneHash: hash(old) }; }
async function cleanup(bindings) {
    const db = bindings.DB, state = await one(db, 'SELECT * FROM p5_rehearsal_run WHERE id=1');
    check(state.phase !== 'busy' || Date.now() - state.started > life, 'active_step_cleanup_denied');
    await claim(db, "UPDATE p5_rehearsal_run SET phase='cleaning' WHERE id=1 AND phase!='disabled'");
    const deleted = [];
    for (const o of allowedObjects) {
        const key = o.key;
        check(allowedObjects.some(o => o.key === key), 'cleanup_key');
        local.getStore().r2.get++;
        const original = await bindings.MEDIA.get(key);
        if (original) {
            const originalBytes = new Uint8Array(await original.arrayBuffer());
            check(hash(Buffer.from(originalBytes)) === hash(Buffer.from(bytes)), 'cleanup_original_hash');
        }
        local.getStore().r2.delete++;
        await bindings.MEDIA.delete(key);
        local.getStore().r2.get++;
        check(await bindings.MEDIA.get(key) === null, 'delete_not_null');
        deleted.push({ key, existed: !!original, readNull: true });
    }
    await batch(db, [["DELETE FROM private_content WHERE owner_id='mock-owner'"], ['DELETE FROM p5_rehearsal_guard']]);
    check((await one(db, 'SELECT count(*) n FROM private_content')).n === 0, 'private_cleanup_remaining');
    const residual = [];
    for (const table of D.addedTables) {
        const n = (await one(db, 'SELECT count(*) n FROM ' + quote(table))).n;
        if (n)
            residual.push({ table, rows: n });
    }
    const proof = await preflight(db);
    check(proof.retiredTombstoneHash === state.retained_hash, 'retired_tombstone_changed');
    await claim(db, "UPDATE p5_rehearsal_run SET phase='disabled',report=NULL WHERE id=1 AND phase='cleaning'");
    return { disabled: true, deleted, privateBodiesRemaining: 0, residual, proof, retained: 'Synthetic immutable original intent/accounting plus empty schema, compiled source and old/new tombstones. No production records.' };
}
const page = `<!doctype html><meta charset="utf-8"><title>P5 private rehearsal</title><style>body{font:18px system-ui;max-width:780px;margin:50px auto;background:#faf8f2;color:#222}button{padding:12px;margin:5px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}</style><h1>P5 synthetic rehearsal</h1><p>One finite run. Native owner access required. No real provider transport. Local preparation is not hosted authorization.</p><button id="status">Status</button><button id="start">Start</button><button id="next">Next fixed step</button><button id="stop">Stop</button><button id="cleanup">Clean and disable</button><pre id="output"></pre><script>let cursor=0;async function call(action){const b=action==='step'?{action,index:cursor}:{action};const r=await fetch('/p5',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const j=await r.json();document.querySelector('#output').textContent=JSON.stringify(j,null,2);if(j.state)cursor=j.state.cursor;}for(const a of ['status','start','stop','cleanup'])document.getElementById(a).onclick=()=>call(a);document.getElementById('next').onclick=()=>call('step');</script>`;
export default { async fetch(request, bindings) {
        instance ??= crypto.randomUUID();
        const c = { bindings, action: '', step: '', statements: 0, attemptedStatements: 0, bindingCalls: 0, failedBatches: 0, reads: 0, writes: 0, databaseBytes: 0, providers: 0, intent: [], r2: { put: 0, get: 0, delete: 0 }, deadline: Date.now() + 120000 };
        return local.run(c, async () => {
            let mutated = false;
            try {
                check(Object.keys(bindings).every(k => ['DB', 'MEDIA', 'ASSETS'].includes(k)) && bindings.DB && bindings.MEDIA, 'isolated_bindings_required');
                const url = new URL(request.url), uid = request.headers.get('oai-authenticated-user-id'), email = request.headers.get('oai-authenticated-user-email');
                check(uid && uid.length <= 256 && email && hash(email.trim().toLowerCase()) === D.ownerEmailSha256, 'native_owner_required');
                check(url.origin === D.origin && !url.search && !url.hash && !/(?:forma_impersonation|forma_project_context)=/.test(request.headers.get('cookie') ?? '') && !request.headers.has('authorization'), 'trusted_origin_required');
                if (request.method === 'GET' && url.pathname === '/')
                    return new Response(page, { headers: { ...headers, 'content-type': 'text/html;charset=utf-8' } });
                check(request.method === 'POST' && url.pathname === '/p5' && request.headers.get('origin') === D.origin && request.headers.get('content-type') === 'application/json' && (!request.headers.get('sec-fetch-site') || request.headers.get('sec-fetch-site') === 'same-origin'), 'same_origin_json_required');
                const reader = request.body?.getReader();
                check(reader, 'body_required');
                let raw = '', bodyBytes = 0;
                const decoder = new TextDecoder('utf-8', {fatal:true});
                for (;;) {
                    const r = await reader.read();
                    if (r.done)
                        break;
                    bodyBytes += r.value.length;
                    check(bodyBytes <= 128, 'body_bound');
                    raw += decoder.decode(r.value, {stream:true});
                }
                const input = JSON.parse(raw + decoder.decode());
                check(input && Object.getPrototypeOf(input) === Object.prototype, 'command_required');
                const action = input.action;
                c.action = action;
                check(['start', 'step', 'status', 'stop', 'cleanup'].includes(action) && JSON.stringify(Object.keys(input).sort()) === JSON.stringify(action === 'step' ? ['action', 'index'] : ['action']), 'fixed_fields_required');
                const db = bindings.DB;
                let state = await one(db, 'SELECT * FROM p5_rehearsal_run WHERE id=1');
                if (state)
                    check(state.owner === uid && state.dataset === D.datasetId, 'owner_or_dataset_changed');
                let result;
                if (action === 'status') {
                    result = { steps, dataset: D.datasetId, limits, instance };
                }
                else if (action === 'start') {
                    check(!state && Date.now() < expiry, 'run_consumed_or_expired');
                    const proof = await preflight(db);
                    for (const t of D.fixtureTables)
                        check((await one(db, 'SELECT count(*) n FROM ' + quote(t))).n === 0, 'fixture_tables_not_empty');
                    await batch(db, [["INSERT INTO p5_rehearsal_run(id,owner,dataset,phase,started,requests,retained_hash) VALUES(1,?,?,'ready',?,1,?)", [uid, D.datasetId, Date.now(), proof.retiredTombstoneHash]], ...D.rows.map(r => [r.sql, r.values])]);
                    mutated = true;
                    result = { imported: D.rows.length, proof, dataset: D.datasetId };
                }
                else {
                    check(state && state.phase !== 'disabled', 'run_disabled_or_absent');
                    check(state.requests < limits.requests || action === 'cleanup' || action === 'stop', 'request_envelope');
                    if (action === 'cleanup') {
                        mutated = true;
                        result = await cleanup(bindings);
                    }
                    else if (action === 'stop') {
                        await claim(db, "UPDATE p5_rehearsal_run SET phase='stopped',requests=requests+1 WHERE id=1 AND phase IN('ready','busy','stopped')");
                        mutated = true;
                        result = { terminal: true };
                    }
                    else {
                        check(Number.isInteger(input.index) && input.index >= 0 && input.index < steps.length && Date.now() < expiry && Date.now() - state.started < life, 'step_or_expiry');
                        await claim(db, "UPDATE p5_rehearsal_run SET phase='busy',requests=requests+1 WHERE id=1 AND phase='ready' AND cursor=? AND requests<?", [input.index, limits.requests]);
                        mutated = true;
                        result = await executeStep(bindings, input.index);
                        await claim(db, "UPDATE p5_rehearsal_run SET phase='ready',cursor=cursor+1,report=? WHERE id=1 AND phase='busy' AND cursor=?", [JSON.stringify({ step: steps[input.index], resultHash: hash(result) }), input.index]);
                    }
                }
                if (mutated)
                    await batch(db, [['UPDATE p5_rehearsal_run SET reads=reads+?,writes=writes+? WHERE id=1', [c.reads, c.writes]]]);
                state = await one(db, 'SELECT phase,cursor,requests,report,reads,writes FROM p5_rehearsal_run WHERE id=1');
                return Response.json({ ok: true, action, result, state, metrics: { ...c, bindings: undefined, deadline: undefined }, instance }, { headers });
            }
            catch (error) {
                if (mutated)
                    try {
                        await bindings.DB.prepare("UPDATE p5_rehearsal_run SET phase='stopped' WHERE id=1 AND phase IN('ready','busy')").run();
                    }
                    catch { /* Durable busy state still prevents replay if stop acknowledgement fails. */ }
                return Response.json({ ok: false, error: String(error), instance, metrics: { ...c, bindings: undefined, deadline: undefined } }, { status: 409, headers });
            }
        });
    } };
