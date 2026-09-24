import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

// Synthetic UI-only fixture. The actual Still client and presenter are used;
// current authority and provider behavior are deliberately not simulated.
async function mountReviewFixture() {
  const {html, LitElement} = await import('/@id/lit');
  const {StillApp} = await import('/src/still/app.ts');
  const {StillClient} = await import('/src/still/client.ts');
  await import('/src/still/vendor/tokens/default.css');
  await import('/src/still/theme.css');
  const style = document.createElement('style');
  style.textContent = (await import('/src/still/style.css?raw')).default.replaceAll('still-app', 'n6-review-fixture');
  document.head.append(style);

  const trace = window.n6Trace = {requests: [], unexpectedFetches: [], acknowledgedRequests: 0, createdJobs: 0, inspections: 0};
  const injectedText = '<img data-n6-injected="true" src="https://invalid.example/pixel" onerror="window.n6MarkupExecuted=true">';
  const raw = [
    ['ProjectCreated', {project_id: 'n6-project', name: 'Synthetic source review'}],
    ['DocumentCreated', {project_id: 'n6-project', document_id: 'n6-document', title: 'Quiet observatory'}],
    ...[
      ['known', 'Creative direction', 'An observatory beside a quiet forest.'],
      ['empty', 'Category unavailable', injectedText],
      ['legacy', 'Legacy highlight', 'A blue ceramic cup.'],
      ['clear', 'Clear isolated input', 'Soft daylight.'],
    ].map(([block_id, handle, text], index) => ['BlockCreated', {
      project_id: 'n6-project', document_id: 'n6-document', block_id,
      type: 'direction', handle, position: String(index + 1), properties: {text, weight: 1, authority: 'authored'},
    }]),
  ];
  const events = raw.map(([type, payload], index) => ({
    type, payload, sequence: index + 1, eventId: `n6-event-${index}`, streamId: 'n6-synthetic-stream',
    occurredAt: '2026-09-24T00:00:00.000Z', actor: 'user',
  }));
  const issue = {
    id: 'context-safety', label: 'Source advisory', status: 'warning', severity: 'warning',
    summary: `Source advisory flagged the overall inputs: hate, violence. Synthetic inert text: ${injectedText}`,
    blockIds: ['known', 'empty'],
    sourceVerdicts: [
      {index: 0, sourceIndex: null, blockId: null, kind: 'snapshot', truncated: false, flagged: true, categories: ['violence'], scores: {violence: .9}},
      {index: 1, sourceIndex: 0, blockId: 'known', kind: 'fact', truncated: false, flagged: true, categories: ['hate'], scores: {hate: .8}},
      {index: 2, sourceIndex: 1, blockId: 'empty', kind: 'fact', truncated: false, flagged: true, categories: [], scores: null},
      {index: 3, sourceIndex: 2, blockId: 'legacy', kind: 'fact', truncated: false, flagged: false, categories: [], scores: null},
      {index: 4, sourceIndex: 3, blockId: 'clear', kind: 'fact', truncated: false, flagged: false, categories: [], scores: null},
    ],
  };
  const legacy = new URL(location.href).searchParams.get('variant') === 'legacy';
  if (legacy) { delete issue.sourceVerdicts; issue.blockIds = ['legacy']; }
  const gate = {error: 'generation_preflight_review_required', readiness: {
    preflightId: 'n6-synthetic-original-preflight', documentId:'n6-document', probes: [issue],
    advisoryCapture: {status: legacy?'unavailable':'retained', inspection: legacy?'unavailable-before-admission':'selected-preflight', refs: {}},
  }};
  window.n6Readiness = gate.readiness;
  let releaseAcknowledgement;
  let app;
  const state = () => {
    const draft = app?.generation;
    document.querySelector('#n6-fixture-state').textContent = JSON.stringify({
      fixture: 'synthetic-only', variant: legacy ? 'legacy' : 'current', inspection: gate.readiness.advisoryCapture.inspection,
      ...trace, clientJobs: app?.client.jobs.length ?? 0,
      acknowledgements: draft?.acknowledgements ?? {},
      requestId: draft?.requestId ?? null, pending: !!releaseAcknowledgement,
      destination: window.n6Destination ?? null,
    }, null, 2);
  };

  // This intercept exists before the app is attached. No application fetch can
  // escape to a server; CSP separately blocks non-local subresources.
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if(url.origin===location.origin&&url.pathname==='/api/source-advisory'&&(init.method??'GET')==='GET'){
      trace.inspections++;state();
      if(url.searchParams.get('documentId')!=='n6-document'||url.searchParams.get('preflightId')!=='n6-synthetic-original-preflight')throw Error('Wrong inspection selection');
      if(legacy)return Response.json({status:'unavailable',reason:'witness_unavailable',rawAvailable:false},{status:409});
      return Response.json({status:'available',validity:'valid',adopted:false,expiresAt:new Date(Date.now()+600000).toISOString(),
       identity:{requestedModel:'omni-moderation-latest',returnedModel:'synthetic-returned-model',requestId:'synthetic-request',responseId:null},
       inputs:issue.sourceVerdicts.map(item=>({...item,utf16Length:128,utf8Length:128})),
       raw:{requestBody:JSON.stringify({model:'omni-moderation-latest',input:[injectedText]}),responseBody:JSON.stringify({model:'synthetic-returned-model',results:[{flagged:true,categories:{hate:true},category_scores:{hate:.8}}]})}});
    }
    if (url.origin !== location.origin || url.pathname !== '/api/document-jobs' || init.method !== 'POST') {
      trace.unexpectedFetches.push({url: url.href, method: init.method ?? 'GET'});
      state();
      throw new Error('Synthetic fixture blocked an unexpected fetch.');
    }
    const request = JSON.parse(init.body);
    trace.requests.push(structuredClone(request));
    state();
    if (request.payload.preflightAcknowledged !== true) return Response.json(gate, {status: 428});
    trace.acknowledgedRequests++;
    await new Promise(resolve => { releaseAcknowledgement = resolve; state(); });
    trace.createdJobs++;
    state();
    return Response.json({job: {
      jobId: 'n6-synthetic-job', documentId: 'n6-document', requestKey: request.payload.requestKey,
      status: 'completed', kind: 'generate', sourceSurface: 'still', members: [], attemptCount: 1,
    }});
  };
  document.querySelector('#n6-release').addEventListener('click', () => {
    const release = releaseAcknowledgement;
    releaseAcknowledgement = undefined;
    if (release) release();
    state();
  });
  class FixtureClient extends StillClient {
    async verifyScope() { return this.fence(); }
    async checkGenerationReadiness() { return {ready: true, documentId: this.position.documentId}; }
  }
  class ReviewFixture extends StillApp {
    connectedCallback() { LitElement.prototype.connectedCallback.call(this); }
    updated() { this.scheduleDockFit(); state(); }
    decide() {}
    writeRoute() {}
    currentRouteProblem() { return ''; }
    navigate(view, ids) { window.n6Destination = {view, ...ids}; this.mode = ''; this.changed(); }
    render() {
      return html`<div class="still-shell"><main tabindex="-1">${window.n6Destination
        ? html`<h1>Synthetic acknowledgement accepted</h1><p>The fixture recorded one synthetic job. No provider was called.</p>`
        : this.renderCanvas()}</main>${window.n6Destination ? '' : this.renderDock()}${this.renderDockProbes()}${this.renderNotifications()}</div>`;
    }
  }
  customElements.define('n6-review-fixture', ReviewFixture);
  const client = new FixtureClient();
  client.session = {user: {userId: 'n6-synthetic-owner', displayName: 'Fixture', role: 'creator'},
    policy: {accepted: true, retentionDays: 1}, provider: {plannerConfigured: true}, projects: []};
  client.events = events;
  client.head = events.length;
  client.position = {projectId: 'n6-project', documentId: 'n6-document', blockId: '', outputId: '', view: 'document', intent: '', recentActions: []};
  app = window.n6App = new ReviewFixture();
  app.loading = false;
  app.mode = app.routeMode = 'generate';
  app.client = client;
  app.generation = client.prepareGeneration('image');
  app.generation.requestId = 'n6-retained-synthetic-request';
  client.onChange = () => app.changed();
  document.querySelector('#n6-product').append(app);
  await app.updateComplete;
  state();
}

export async function createN6ReviewServer({port = 0} = {}) {
  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    cacheDir: '/private/tmp/forma-n6-review-vite-cache',
    optimizeDeps: {noDiscovery: true, include: ['lit', 'lit/async-directive.js', 'lit/directives/if-defined.js', 'lit/directives/keyed.js', 'lit/directives/live.js', 'lit/directives/repeat.js', 'lit/static-html.js', 'qrcode', 'signal-polyfill', 'signal-utils/subtle/reaction']},
    server: {host: '127.0.0.1', port, strictPort: port !== 0, hmr: false},
    plugins: [{name: 'n6-source-advisory-synthetic-review', configureServer(vite) {
      vite.middlewares.use('/api', (_request, response) => {
        response.writeHead(451, {'content-type': 'application/json', 'cache-control': 'no-store'});
        response.end(JSON.stringify({error: 'synthetic_fixture_no_server_api'}));
      });
      vite.middlewares.use('/n6-review', (_request, response) => {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
        });
        response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>N6 synthetic boundary review</title><style>body{margin:0}#n6-fixture-disclosure{font:14px system-ui;padding:12px 20px;background:#fff6d9;color:#362e18}#n6-fixture-disclosure p{margin:4px 0}#n6-fixture-state{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}#n6-product{position:relative;min-height:700px}</style></head><body><aside id="n6-fixture-disclosure"><strong>N6 synthetic browser fixture</strong><p>This fixture reviews the actual N6 disclosure with synthetic retained bodies and the ordinary explicit acknowledgement flow. It certifies neither classifier quality nor historical evidence.</p><details><summary>Fixture counters and retained request</summary><pre id="n6-fixture-state"></pre><button id="n6-release" type="button">Finish synthetic acknowledgement</button></details></aside><div id="n6-product"></div><script type="module">(${mountReviewFixture.toString()})().catch(error=>{document.querySelector('#n6-fixture-state').textContent=error.stack;throw error;});</script></body></html>`);
      });
    }}],
  });
  await server.listen();
  return {server, url: `http://127.0.0.1:${server.httpServer.address().port}/n6-review`};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {url} = await createN6ReviewServer({port: Number(process.env.N6_REVIEW_PORT ?? 4196)});
  console.log(url);
}
