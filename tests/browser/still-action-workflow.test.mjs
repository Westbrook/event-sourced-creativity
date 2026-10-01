import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {createSceneCostFixture} from '../helpers/scene-cost-fixture.mjs';

// Real browser -> Vite forwarding -> Worker -> disposable SQLite. Every response
// below is produced by the production API; no action endpoint is intercepted.
test('creation review retains explicit quality evidence separately from verified finalization outcomes', async () => {
  const fixture = await createSceneCostFixture(0);
  Object.assign(fixture.env, {STILL_UNIFIED_CREATION_ENABLED: 'true', OPENAI_API_KEY: '', JEV_API_KEY: ''});
  const scope = {projectId: fixture.projectId, documentId: fixture.documentId};
  const criteria = ['The beacon has a clear purpose', 'The harbor stays quiet'];
  const json = body => ({headers: {'content-type': 'application/json', origin: 'http://localhost'}, body: JSON.stringify(body)});
  const observations = [];
  const requests = [];
  const errors = [];
  const blockedExternalRequests = [];
  const output = resolve('outputs/still-actions-browser', new Date().toISOString().replaceAll(':', '-'), 'workflow');
  const receipt = {mode: 'fictional-browser-worker-sqlite', status: 'running'};
  let server;
  let browser;
  let context;
  let page;
  try {
    await mkdir(output, {recursive: true});
    const enabled = await fixture.request('/api/still/action-context', {method: 'PUT', ...json({scope, enabled: true})});
    assert.equal(enabled.status, 200, await enabled.clone().text());
    const remembered = await fixture.request('/api/still/goal', {method: 'PUT', ...json({scope, text: 'Keep a clear fictional beacon in the quiet harbor.', criteria, remember: true})});
    assert.equal(remembered.status, 200, await remembered.clone().text());
    const {goal} = await remembered.json();
    const creativeHead = fixture.sqlite.prepare('SELECT count(*) AS count FROM events').get().count;
    const markup = await readFile(new URL('../../still.html', import.meta.url), 'utf8');
    server = await createServer({
      configFile: false,
      cacheDir: 'node_modules/.vite-action-workflow-browser',
      optimizeDeps: {noDiscovery: true, include: []},
      server: {host: '127.0.0.1', port: 0, hmr: false},
      plugins: [{name: 'action-workflow-browser-worker', configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/api/')) {
            try {
              const chunks = [];
              for await (const chunk of req) chunks.push(chunk);
              const body = Buffer.concat(chunks);
              const request = {url: req.url, method: req.method, ...(body.length ? {body: JSON.parse(body.toString())} : {})};
              requests.push(request);
              const headers = {...req.headers};
              if (headers.origin === `http://${req.headers.host}`) headers.origin = 'http://localhost';
              const response = await fixture.request(req.url, {method: req.method, headers, ...(body.length ? {body} : {})});
              const bytes = Buffer.from(await response.arrayBuffer());
              if (req.url === '/api/still/action-observations') observations.push({...request, status: response.status, result: JSON.parse(bytes.toString())});
              res.writeHead(response.status, Object.fromEntries(response.headers));
              res.end(bytes);
            } catch (error) {
              errors.push(String(error));
              res.writeHead(500, {'content-type': 'application/json'});
              res.end(JSON.stringify({error: String(error)}));
            }
            return;
          }
          if (req.url?.startsWith('/still')) {
            res.setHeader('content-type', 'text/html');
            res.end(await vite.transformIndexHtml('/still.html', markup));
            return;
          }
          next();
        });
      }}],
    });
    await server.listen();
    const engines = await import(process.env.CREATION_PLAYWRIGHT_MODULE ?? '@playwright/test');
    browser = await engines[process.env.CREATION_TEST_BROWSER ?? 'chromium'].launch({headless: true});
    receipt.browser = browser.version();
    context = await browser.newContext({viewport: {width: 1100, height: 850}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === base || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      blockedExternalRequests.push(url.href);
      return route.abort('blockedbyclient');
    });
    const dock = name => page.locator('.toolbar-motion-live .action-dock').getByRole('button', {name, exact: true});
    const activateDock = async name => {
      if (await dock(name).isVisible()) return dock(name).click();
      await dock('More actions').click();
      await page.getByRole('menuitem', {name, exact: true}).click();
    };
    const waitSaved = () => page.waitForFunction(() => {
      const flow = document.querySelector('still-creation-flow')?.flow;
      return flow && !flow.busy && !flow.hasUnacknowledgedChanges && flow.status === 'Draft saved';
    });
    const flush = () => page.evaluate(() => document.querySelector('still-app').actionContext.flush());
    const review = () => page.evaluate(() => {
      const flow = document.querySelector('still-creation-flow').flow;
      const savedReview = structuredClone(flow.draft.review);
      // Loading a draft acknowledges the server revision without changing any
      // presentation, approval, or stage in the creative review itself.
      delete savedReview.lastAcknowledgedRevision;
      return JSON.parse(JSON.stringify({draftId: flow.draft.id, revision: flow.draft.revision, review: savedReview, plan: flow.plan, approvalHash: flow.hashes.approvalHash}));
    });
    const retained = async () => {
      await flush();
      const response = await fixture.request('/api/still/action-context?' + new URLSearchParams(scope));
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    const present = async () => {
      const region = page.getByRole('region', {name: 'Full content and included relationships'});
      await region.evaluate(element => {element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll'));});
      await page.getByRole('button', {name: 'Continue review', exact: true}).click();
      await page.getByRole('button', {name: 'Current version reviewed', exact: true}).waitFor();
      await waitSaved();
    };
    const openHelp = async () => {
      await page.getByRole('button', {name: 'How this works', exact: true}).click();
      await page.getByRole('dialog', {name: 'From your description to organized content', exact: true}).waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.matches('.creation-help-trigger'));
      await flush();
    };

    await page.goto(`${base}/still/project/${fixture.projectId}/document/${fixture.documentId}/action/add-context?creation=1`);
    await page.waitForFunction(() => document.querySelector('still-app')?.actionContext.loaded && document.querySelector('still-app').actionContext.value.enabled);
    const input = page.getByRole('textbox', {name: 'Describe a detail worth keeping.', exact: true});
    await input.fill('Fictional beacon');
    await waitSaved();
    await page.getByRole('button', {name: 'Treat as a title', exact: true}).click();
    await waitSaved();
    await dock('Save').click();
    await page.getByRole('heading', {name: 'Review Idea', exact: true}).waitFor();
    await page.locator('.creation-body-edit > summary').click();
    await page.getByRole('textbox', {name: 'Idea body', exact: true}).fill('A fictional beacon marks the safe harbor entrance while the keeper maintains the quiet watch.');
    await page.getByRole('combobox', {name: 'Idea type', exact: true}).selectOption('direction');
    await waitSaved();
    // Split insight also saves the current draft; settle it before attributing
    // review changes to help, presentation, or an optional assessment.
    await page.waitForFunction(() => {
      const flow = document.querySelector('still-creation-flow')?.flow;
      return flow?.split?.draftRevision === flow?.draft.revision && !flow.hasUnacknowledgedChanges;
    });
    assert.equal(await dock('Approve').isDisabled(), true);
    const unseen = await review();
    await openHelp();
    assert.deepEqual(await review(), unseen, 'Help does not present or approve the underlying revision');
    assert.equal(await dock('Approve').isDisabled(), true);
    await present();
    await dock('Approve').click();
    await waitSaved();
    const approved = await review();
    assert.ok(Object.values(approved.review.nodes).some(row => row.approvedHash), 'The real review saved a current-version approval');
    await openHelp();
    assert.deepEqual(await review(), approved, 'Help preserves the acknowledged approval');

    await page.getByRole('navigation', {name: 'Review stages'}).getByRole('button', {name: 'Documents', exact: true}).click();
    await page.getByRole('heading', {name: 'Review attachment', exact: true}).waitFor();
    await waitSaved();
    await present();
    await dock('Approve').click();
    await waitSaved();
    await activateDock('Final review');
    await page.getByRole('heading', {name: 'Ready to save', exact: true}).waitFor();
    await waitSaved();
    await dock('Back to Ideas').click();
    await page.getByRole('heading', {name: 'Review Idea', exact: true}).waitFor();
    await waitSaved();
    await activateDock('Final review');
    await page.getByRole('heading', {name: 'Ready to save', exact: true}).waitFor();
    await waitSaved();

    const quality = page.locator('.creation-quality');
    assert.equal(await quality.getAttribute('open'), null, 'The quality check remains optional');
    await quality.getByText('Optional quality check', {exact: true}).click();
    assert.match(await quality.innerText(), /does not approve or save the content/i);
    for (const criterion of criteria) assert.equal(await quality.getByRole('combobox', {name: criterion, exact: true}).inputValue(), 'unknown');
    assert.equal(await quality.getByRole('combobox', {name: 'Your assessment of this version', exact: true}).inputValue(), 'unknown');
    const beforeAssessment = await review();
    assert.equal(observations.some(row => row.body.kind === 'assessment'), false, 'Entering final review does not claim acceptance');
    await quality.getByRole('combobox', {name: criteria[0], exact: true}).selectOption('met');
    await quality.getByRole('combobox', {name: criteria[1], exact: true}).selectOption('unknown');
    await quality.getByRole('combobox', {name: 'Your assessment of this version', exact: true}).selectOption('needs-work');
    await quality.getByRole('button', {name: 'Save assessment', exact: true}).click();
    await quality.getByText('Assessment saved for this reviewed version.', {exact: true}).waitFor();
    await flush();
    const first = observations.find(row => row.body.kind === 'assessment');
    assert.ok(first, 'The UI submitted an assessment to the Worker');
    assert.equal(first.status, 201, JSON.stringify(first.result));
    assert.equal(first.result.observation.assessment.goalId, goal.id);
    assert.deepEqual(first.result.observation.assessment.target, {kind: 'creation-draft', id: beforeAssessment.draftId, revision: beforeAssessment.approvalHash});
    assert.equal(first.result.observation.assessment.workflowInstanceId, beforeAssessment.draftId);
    assert.deepEqual(first.result.observation.assessment.criteria, [{index: 0, result: 'met'}, {index: 1, result: 'unknown'}]);
    assert.equal(first.result.observation.assessment.acceptance, 'needs-work');
    assert.equal(first.result.observation.assessment.revision, 1);
    assert.ok(first.result.observation.assessment.horizonMs > 0 && first.result.observation.assessment.horizonMs <= 7 * 86400000);
    assert.deepEqual(await review(), beforeAssessment, 'Optional assessment neither changes approval nor edits the content');

    await quality.getByRole('combobox', {name: criteria[1], exact: true}).selectOption('met');
    await quality.getByRole('combobox', {name: 'Your assessment of this version', exact: true}).selectOption('accepted');
    await quality.getByRole('button', {name: 'Save corrected assessment', exact: true}).click();
    await quality.getByText('Correction saved; the earlier assessment remains in history.', {exact: true}).waitFor();
    await flush();
    const correction = observations.filter(row => row.body.kind === 'assessment')[1];
    assert.equal(correction.status, 201, JSON.stringify(correction.result));
    assert.equal(correction.result.observation.assessment.supersedesId, first.result.observation.id);
    assert.equal(correction.result.observation.assessment.assessmentId, first.result.observation.assessment.assessmentId);
    assert.equal(correction.result.observation.assessment.revision, 2);
    assert.equal(correction.result.observation.assessment.acceptance, 'accepted');
    assert.deepEqual(correction.result.observation.assessment.target, first.result.observation.assessment.target);
    assert.equal(correction.result.observation.assessment.horizonStartedAt, first.result.observation.assessment.horizonStartedAt);
    await quality.getByRole('button', {name: 'Withdraw assessment', exact: true}).click();
    await quality.getByText('Assessment withdrawn. The earlier record is retained until history expires or is erased.', {exact: true}).waitFor();
    const saved = await retained();
    const withdrawal = observations.filter(row => row.body.kind === 'assessment')[2];
    assert.equal(withdrawal.status, 201, JSON.stringify(withdrawal.result));
    assert.equal(withdrawal.result.observation.assessment.revision, 3);
    assert.equal(withdrawal.result.observation.assessment.supersedesId, correction.result.observation.id);
    assert.equal(withdrawal.result.observation.assessment.acceptance, 'revoked');
    assert.deepEqual(withdrawal.result.observation.assessment.criteria, []);
    for (const row of [first, correction, withdrawal]) assert.ok(saved.observations.some(observation => observation.id === row.result.observation.id), 'Each acknowledged correction remains in retained history');
    assert.deepEqual(await review(), beforeAssessment);
    assert.equal(fixture.sqlite.prepare('SELECT count(*) AS count FROM events').get().count, creativeHead, 'Workflow observations and quality feedback do not advance creative history');
    assert.equal(requests.some(request => /\/apply$/.test(request.url)), false, 'Quality acceptance never invokes content finalization');
    assert.equal(requests.some(request => request.method === 'POST' && /\/interpret$|\/api\/document-jobs/.test(request.url)), false, 'Fictional title/manual completion needs no provider attempt');

    const workflows = saved.observations.filter(row => row.kind === 'workflow');
    for (const transition of ['presented', 'approved', 'final-review', 'backtracked', 'help-opened']) {
      assert.ok(workflows.some(row => row.workflow.transition === transition && row.workflow.status === 'confirmed'), `Worker retained ${transition}`);
    }
    assert.ok(workflows.some(row => row.workflow.transition === 'presented' && row.workflow.target.kind === 'creation-node'));
    assert.ok(workflows.some(row => row.workflow.transition === 'approved' && row.workflow.target.kind === 'creation-use'));
    for (const row of workflows) {
      assert.deepEqual(row.scope, scope);
      assert.equal(row.actionId, 'add-context');
      assert.equal(row.workflow.instanceId, beforeAssessment.draftId);
      assert.ok(row.workflow.target.revision && Number.isFinite(Date.parse(row.workflow.occurredAt)) && Number.isFinite(Date.parse(row.recordedAt)));
      if (row.parentId) assert.ok(saved.observations.some(parent => parent.id === row.parentId), 'Workflow links to a retained causal parent');
    }
    // Reopen the saved draft to prove the later review uses retained API evidence,
    // rather than the creation component's in-memory assessment state.
    await page.reload();
    await page.getByRole('heading', {name: 'Ready to save', exact: true}).waitFor();
    await waitSaved();
    await page.waitForFunction(() => document.querySelector('still-app').actionContext.loaded);
    await page.getByRole('button', {name: 'Goal & suggestions', exact: true}).click();
    const settings = page.locator('en-dialog[label="Goal and suggestions"]');
    await settings.getByText('Optional quality check', {exact: true}).click();
    const delayedAcceptance = settings.getByRole('combobox', {name: 'Your assessment of this version', exact: true});
    assert.equal(await delayedAcceptance.inputValue(), 'revoked', 'The later review opens the latest retained assessment');
    await settings.getByRole('combobox', {name: criteria[0], exact: true}).selectOption('met');
    await settings.getByRole('combobox', {name: criteria[1], exact: true}).selectOption('not-met');
    await delayedAcceptance.selectOption('needs-work');
    await settings.getByRole('button', {name: 'Save corrected assessment', exact: true}).click();
    await settings.getByText('Assessment saved for this reviewed version.', {exact: true}).waitFor();
    const laterContext = await retained();
    const later = observations.filter(row => row.body.kind === 'assessment')[3];
    assert.equal(later.status, 201, JSON.stringify(later.result));
    assert.equal(later.result.observation.assessment.revision, 4);
    assert.equal(later.result.observation.assessment.supersedesId, withdrawal.result.observation.id);
    assert.equal(later.result.observation.assessment.assessmentId, first.result.observation.assessment.assessmentId);
    assert.deepEqual(later.result.observation.assessment.target, first.result.observation.assessment.target);
    assert.equal(later.result.observation.assessment.horizonStartedAt, first.result.observation.assessment.horizonStartedAt);
    assert.equal(later.result.observation.assessment.horizonMs, first.result.observation.assessment.horizonMs);
    assert.deepEqual(later.result.observation.assessment.criteria, [{index: 0, result: 'met'}, {index: 1, result: 'not-met'}]);
    assert.equal(later.result.observation.assessment.acceptance, 'needs-work');
    assert.ok(laterContext.observations.some(row => row.id === later.result.observation.id));
    assert.deepEqual(await review(), beforeAssessment, 'Later assessment preserves the exact saved creative review');
    assert.equal(fixture.sqlite.prepare('SELECT count(*) AS count FROM events').get().count, creativeHead);
    for (const width of [1100, 320]) {
      await page.setViewportSize({width, height: 850});
      const geometry = await settings.locator('dialog').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return {left: rect.left, right: rect.right, viewport: innerWidth, overflow: element.scrollWidth > element.clientWidth + 1};
      });
      assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
      assert.equal(geometry.overflow, false, 'Optional delayed review fits the dialog on a narrow viewport');
      await page.screenshot({path: resolve(output, `delayed-quality-${width}.png`), fullPage: true});
    }
    await page.setViewportSize({width: 1100, height: 850});
    assert.equal(requests.some(request => /\/apply$/.test(request.url)), false, 'Revisiting or correcting quality feedback still does not finalize content');
    await settings.getByRole('button', {name: 'Done', exact: true}).click();
    await settings.locator('dialog').waitFor({state: 'hidden'});
    const finalizationResponse = page.waitForResponse(response => /\/api\/still\/creation\/drafts\/[^/]+\/apply$/.test(new URL(response.url()).pathname));
    await dock('Approve selected (1)').click();
    const committedResponse = await finalizationResponse;
    const committed = await committedResponse.json();
    const apply = requests.find(request => /\/apply$/.test(request.url));
    assert.equal(committedResponse.status(), 200, JSON.stringify(committed));
    assert.equal(committed.receipt.status, 'committed');
    assert.equal(committed.receipt.operationId, apply.body.operationId);
    assert.equal(committed.receipt.previewId, apply.body.operationId);
    assert.equal(committed.receipt.approvalHash, apply.body.approvalHash);
    assert.equal(committed.receipt.approvalHash, beforeAssessment.approvalHash);
    assert.equal(committed.receipt.projectId, scope.projectId);
    assert.equal(committed.receipt.primaryDocumentId, scope.documentId);
    await page.waitForFunction(() => !document.querySelector('still-creation-flow') && !document.querySelector('still-app').busy);
    const afterCommit = await retained();
    const finalization = afterCommit.observations.find(row => row.workflow?.transition === 'finalize' && row.workflow.status === 'confirmed');
    assert.ok(finalization, 'The actual committed operation has a retained finalization observation');
    assert.equal(finalization.workflow.operationId, committed.receipt.operationId);
    assert.equal(finalization.workflow.draftRevision, committed.revision);
    assert.deepEqual(finalization.workflow.target, {kind: 'creation-draft', id: beforeAssessment.draftId, revision: String(committed.revision)});
    assert.equal(finalization.evidence.operationId, committed.receipt.operationId);
    assert.equal(finalization.evidence.operationStatus, 'applied');
    assert.equal(finalization.evidence.approvalHash, committed.receipt.approvalHash);
    const outcome = afterCommit.observations.find(row => row.outcome?.type === 'acknowledged-commit' && row.outcome.status === 'observed');
    assert.ok(outcome, 'The explicit content save produces an acknowledged-commit outcome');
    assert.equal(outcome.parentId, finalization.id);
    assert.equal(outcome.interpretation, 'verified-operation');
    assert.equal(outcome.outcome.workflowInstanceId, beforeAssessment.draftId);
    assert.equal(outcome.outcome.operationId, committed.receipt.operationId);
    assert.deepEqual(outcome.outcome.target, {kind: 'creation-draft', id: beforeAssessment.draftId, revision: committed.receipt.approvalHash});
    assert.equal(outcome.evidence.operationId, committed.receipt.operationId);
    assert.equal(outcome.evidence.approvalHash, committed.receipt.approvalHash);
    assert.equal(outcome.evidence.authority, 'server-verified-references');
    assert.equal(afterCommit.observations.filter(row => row.kind === 'assessment').length, 4, 'Saving content does not create another quality assessment');
    const committedHead = fixture.sqlite.prepare('SELECT count(*) AS count FROM events').get().count;
    assert.ok(committedHead > creativeHead, 'Only explicit finalization creates canonical creative events');
    assert.equal(requests.filter(request => /\/apply$/.test(request.url)).length, 1);
    assert.equal(requests.some(request => request.method === 'POST' && /\/interpret$|\/api\/document-jobs/.test(request.url)), false, 'Explicit finalization also needs no provider attempt');
    receipt.finalization = {request: apply.body, response: committed, observationId: finalization.id, outcomeId: outcome.id};
    await page.getByRole('button', {name: 'Goal & suggestions', exact: true}).click();
    await settings.getByRole('checkbox', {name: 'Remember action outcomes for this document', exact: true}).uncheck();
    await settings.getByText('Suggestion history disabled and saved history erased. Your remembered goal is unchanged.', {exact: true}).waitFor();
    const disabled = await retained();
    assert.equal(disabled.enabled, false);
    assert.deepEqual(disabled.observations, []);
    assert.equal(disabled.goal.id, goal.id);
    assert.equal(fixture.sqlite.prepare('SELECT count(*) AS count FROM still_action_observations').get().count, 0);
    assert.equal(fixture.sqlite.prepare('SELECT count(*) AS count FROM events').get().count, committedHead, 'Opt-out preserves finalized creative events');
    await settings.getByRole('button', {name: 'Erase saved suggestion history and goal', exact: true}).click();
    await settings.getByText('Saved suggestion history and remembered goal erased.', {exact: true}).waitFor();
    const erased = await retained();
    assert.equal(erased.goal, undefined);
    assert.deepEqual(erased.observations, []);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS count FROM private_content WHERE kind='still-goal' AND content<>''").get().count, 0);
    assert.equal(fixture.sqlite.prepare('SELECT count(*) AS count FROM events').get().count, committedHead, 'Erasing optional history preserves finalized creative events');
    assert.deepEqual(observations.filter(row => row.status !== 201 && row.status !== 200), [], 'Outbound attempts must be accepted by the actual Worker');
    assert.deepEqual(errors, []);
    receipt.status = 'passed';
    receipt.observationCount = observations.length;
    receipt.transitions = [...new Set(afterCommit.observations.filter(row => row.kind === 'workflow').map(row => row.workflow.transition))];
    receipt.assessments = [first, correction, withdrawal, later].map(row => ({id: row.result.observation.id, revision: row.result.observation.assessment.revision, acceptance: row.result.observation.assessment.acceptance}));
  } catch (error) {
    receipt.status = 'failed';
    receipt.failure = String(error.stack ?? error);
    if (page) await page.screenshot({path: resolve(output, 'failure.png'), fullPage: true}).catch(() => {});
    throw error;
  } finally {
    await writeFile(resolve(output, 'receipt.json'), JSON.stringify({...receipt, errors, blockedExternalRequests, requests, observations}, null, 2) + '\n');
    await context?.close();
    await browser?.close();
    await server?.close();
    await fixture.drainBackground();
    fixture.close();
  }
});
