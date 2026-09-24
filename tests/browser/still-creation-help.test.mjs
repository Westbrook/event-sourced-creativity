import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {createSceneCostFixture} from '../helpers/scene-cost-fixture.mjs';

// New v20 checks, independent of the earlier editor acceptance suite. This exercises
// the real UI, controller and Worker against disposable SQLite with no paid provider.
test('contextual creation help preserves writing and review across every entry', async t => {
  const fixture = await createSceneCostFixture(0);
  Object.assign(fixture.env, {STILL_UNIFIED_CREATION_ENABLED: 'true', OPENAI_API_KEY: '', JEV_API_KEY: ''});
  const markup = await readFile(new URL('../../still.html', import.meta.url), 'utf8');
  const requests = [];
  const server = await createServer({
    configFile: false,
    cacheDir: 'node_modules/.vite-creation-help-browser',
    optimizeDeps: {noDiscovery: true, include: []},
    server: {host: '127.0.0.1', port: 0},
    plugins: [{name: 'creation-help-browser-worker', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/')) {
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = Buffer.concat(chunks);
            requests.push({url: req.url, method: req.method});
            const headers = {...req.headers};
            if (headers.origin === `http://${req.headers.host}`) headers.origin = 'http://localhost';
            const response = await fixture.request(req.url, {method: req.method, headers, ...(body.length ? {body} : {})});
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (error) {
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
  let browser;
  try {
    await server.listen();
    const engines = await import(process.env.CREATION_PLAYWRIGHT_MODULE ?? '@playwright/test');
    browser = await engines[process.env.CREATION_TEST_BROWSER ?? 'chromium'].launch({headless: true});
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const paths = {
      project: '/still/action/new-project',
      document: `/still/project/${fixture.projectId}/action/new-document`,
      idea: `/still/project/${fixture.projectId}/document/${fixture.documentId}/action/add-context`,
    };
    const consequentialRequests = () => requests.filter(request => /\/(interpret|review|preview|apply|use|use-preview|split|generate|document-jobs)(?:[/?]|$)|\/api\/still\/(decision|onboarding)(?:[/?]|$)/.test(request.url));
    const waitSaved = page => page.waitForFunction(() => document.querySelector('.action-dock .toolbar-status')?.textContent?.trim() === 'Draft saved');
    const paste = async (input, payload) => {
      await input.click();
      await input.evaluate((el, data) => {
        const event = new ClipboardEvent('paste', {bubbles: true, composed: true, cancelable: true});
        Object.defineProperty(event, 'clipboardData', {value: {getData: type => data[type] ?? '', types: Object.keys(data)}});
        el.dispatchEvent(event);
      }, payload);
    };
    const dock = (page, name) => page.locator('.action-dock').getByRole('button', {name, exact: true});
    const help = page => page.getByRole('button', {name: 'How this works', exact: true});
    const dialog = page => page.getByRole('dialog', {name: 'From your description to organized content', exact: true});
    const assertFocusInside = async page => {
      assert.equal(await page.evaluate(() => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        for (let node = active; node; node = node.parentNode ?? node.host) {
          if (node.matches?.('.creation-help-dialog')) return true;
        }
        return false;
      }), true, 'Keyboard focus stays inside contextual help');
    };
    const assertRestored = async page => {
      await page.waitForFunction(() => document.activeElement?.matches('.creation-help-trigger'));
      assert.equal(await dialog(page).count(), 0);
    };
    const openHelp = async page => {
      await help(page).click();
      await dialog(page).waitFor();
      assert.equal(await page.locator('.creation-help-dialog').evaluate(host => host.shadowRoot.querySelector('dialog').matches(':modal')), true, 'Established dialog uses the native modal top layer and inert background');
      await assertFocusInside(page);
      const startsAtExplanation = await page.evaluate(() => document.activeElement?.id === 'creation-help-start');
      const startsAtClose = await dialog(page).getByRole('button', {name: 'Close', exact: true}).evaluateAll(buttons => {let active = document.activeElement;while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;return buttons.includes(active);});
      assert.ok(startsAtExplanation || startsAtClose, 'Initial focus starts at explanatory content or a named Close control: ' + await page.evaluate(() => {const chain=[];let active=document.activeElement;while(active){chain.push(active.outerHTML.slice(0,180));active=active.shadowRoot?.activeElement;}return JSON.stringify(chain);}));
    };
    const reviewSnapshot = page => page.evaluate(() => {
      const element = document.querySelector('still-creation-flow');
      return {review: structuredClone(element.flow.draft.review), plan: structuredClone(element.flow.plan), currentId: element.flow.currentId, stage: element.flow.currentStage, scroll: element.querySelector('.creation-full-content')?.scrollTop, contentReached: element.contentReached};
    });

    for (const entry of ['project', 'document', 'idea']) {
      await t.test(`${entry}: optional scope guidance, keyboard modality, editor tokens/selection/undo and mobile scrolling`, async () => {
        const context = await browser.newContext({viewport: {width: 1100, height: 850}});
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(`${base}${paths[entry]}?creation=1`);
          const input = page.getByRole('textbox', {name: entry === 'idea' ? 'Describe a detail worth keeping.' : 'A name is enough. Details welcome.', exact: true});
          await input.waitFor();
          assert.equal(await dialog(page).count(), 0, 'Help never opens automatically');
          assert.equal(await help(page).count(), 1);
          assert.equal(await help(page).getAttribute('type'), 'button');
          await page.getByRole('heading', {name: entry === 'idea' ? 'Capture an idea' : `Start a ${entry}`, exact: true}).waitFor();
          assert.equal(await page.locator('.creation-introduction').count(), 0, 'Input has a title/label pair without a separate introduction');
          assert.equal(await page.locator('#creation-input > [slot="description"] .creation-help-trigger').count(), 1, 'Help is part of the editor supporting description');
          assert.equal(await page.locator('#creation-input').evaluate(editor => editor.shadowRoot.querySelector('slot[name="description"]').assignedElements()[0]?.className), 'creation-editor-description');
          assert.match(await input.getAttribute('aria-describedby'), /(?:^| )description(?: |$)/, 'Editor associates its supporting description with the textbox');
          assert.equal(await page.locator('#creation-input .creation-draft-expiry').count(), 0, 'Draft retention is separate from input guidance');
          assert.deepEqual(await page.locator('.creation-marker-guidance .creation-guidance-token').allTextContents(), ['@','/']);
          const saveHint = await page.locator('.creation-save-expectation').innerText();
          assert.match(saveHint, /review/i);
          assert.match(saveHint, entry === 'idea' ? /body and type/i : /empty (?:Project|Document)/i, 'Only the essential Save expectation stays outside help');
          assert.equal(await page.locator('.creation-input-hint,.creation-draft-explanation').count(), 0, 'Detailed guidance stays in the optional dialog');
          const run = {kind: 'token', id: 'help-example-token', type: 'still-creation-declaration', text: '@Paul', label: 'Paul', data: {schemaVersion: 1, kind: 'declaration', draftId: 'clipboard-draft', targetId: 'temporary:paul'}};
          const text = '@Paul sits beside a microphone.';
          await paste(input, {'text/plain': text, 'application/x-en-editor+json': JSON.stringify({type: 'en-editor-clipboard', version: 1, runs: [run, {kind: 'text', text: ' sits beside a microphone.'}]})});
          await waitSaved(page);
          assert.equal(await page.locator('#creation-input [slot="description"] .creation-save-expectation').innerText(), 'Organize this description for review', 'The supporting description reflects the current Save action');
          await input.press('Shift+ArrowLeft');
          await page.waitForFunction(() => document.querySelector('#creation-input').captureRange().expectedText === '.');
          const before = await page.locator('#creation-input').evaluate(editor => {
            window.creationHelpOriginalEditor = editor;
            return {document: editor.document, selection: editor.captureRange(), undo: editor.getCommandState('undo'), redo: editor.getCommandState('redo')};
          });
          const requestCount = consequentialRequests().length;
          await openHelp(page);
          const illustrated = page.locator('.creation-help-content .creation-guidance-token');
          const syntax = await illustrated.allTextContents();
          for(const marker of ['@','/','/idea','/image','/video','/3D model','@Paul','@Jon']) assert.ok(syntax.includes(marker), `Help illustrates ${marker} as a single token`);
          assert.equal(await illustrated.evaluateAll(nodes=>nodes.every(node=>node.tagName==='BDI'&&node.dir==='ltr'&&node.tabIndex===-1&&!node.isContentEditable&&!node.hasAttribute('role'))), true, 'Syntax illustrations preserve readable text without creating interactive editor tokens');
          const palette = await page.evaluate(() => {
            const style = node => {const s=getComputedStyle(node);return [s.backgroundColor,s.color,s.borderColor,s.borderRadius];};
            return {editor:style(document.querySelector('#creation-input').shadowRoot.querySelector('[data-token]')),help:style(document.querySelector('.creation-help-content .creation-guidance-token')),description:style(document.querySelector('.creation-marker-guidance .creation-guidance-token'))};
          });
          assert.deepEqual(palette.help,palette.editor,'Help uses the editor token palette and radius');
          assert.deepEqual(palette.description,palette.editor,'Description uses the editor token palette and radius');
          const copy = await page.locator('.creation-help-content').innerText();
          assert.match(copy, /plain language|naturally/i);
          assert.match(copy, /optional/i);
          assert.match(copy, /reword/i);
          assert.match(copy, /never invent|does not invent|won.t invent/i);
          assert.match(copy, /matching name/i);
          assert.match(copy, /Format preferences/i);
          assert.match(copy, /other supported Output/i);
          assert.match(copy, /draft autosave|autosave.*draft/i);
          assert.match(copy, /independent/i);
          if (entry === 'project') {
            assert.match(copy, /new Documents.*Ideas|new content/i);
            assert.match(copy, /Open/i);
            assert.match(copy, /another Project|other Projects|cross.Project/i);
          } else {
            assert.match(copy, /this Project|same.Project/i);
            assert.match(copy, /Use in this draft/);
            assert.match(copy, /Use only this part/);
            if (entry === 'document') assert.match(copy, /constituent|choose.*Ideas|select.*Ideas/i);
            else assert.doesNotMatch(copy, /empty (?:Project|Document)|\/document|\/project/i);
          }
          const example = page.locator('.creation-help-example');
          assert.equal(await example.count(), 1);
          assert.match(await example.innerText(), /Paul.*Jon/s);
          assert.equal(await example.locator('input,textarea,[contenteditable="true"],button').count(), 0, 'The example is read-only and offers no insertion action');
          // The only relevant foreground action here is informational. Both platform
          // shortcut variants must leave the underlying Save workflow untouched.
          await page.keyboard.press('Control+Enter');
          await page.keyboard.press('Meta+Enter');
          await dialog(page).waitFor();
          for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
            await page.keyboard.press(key);
            try {await assertFocusInside(page);} catch (error) {throw new Error(`Focus escaped after ${key}: ` + await page.evaluate(() => document.activeElement?.outerHTML.slice(0,240)), {cause:error});}
          }
          await input.evaluate(el => el.focus());
          await assertFocusInside(page);
          await page.keyboard.press('Escape');
          await assertRestored(page);
          const after = await page.locator('#creation-input').evaluate(editor => ({sameInstance: editor === window.creationHelpOriginalEditor, document: editor.document, selection: editor.captureRange(), undo: editor.getCommandState('undo'), redo: editor.getCommandState('redo')}));
          assert.equal(after.sameInstance, true);
          delete after.sameInstance;
          assert.deepEqual(after, before, 'Opening and closing does not change the editor document, tokens, selection or history state');
          assert.equal(consequentialRequests().length, requestCount);
          await input.focus();
          await input.press('ControlOrMeta+z');
          await page.waitForFunction(() => document.querySelector('#creation-input').value === '');
          await input.press('ControlOrMeta+Shift+z');
          await page.waitForFunction(value => document.querySelector('#creation-input').value === value, text);
          assert.deepEqual(await page.locator('#creation-input').evaluate(editor => editor.document), before.document, 'Undo/redo restores the exact token-bearing document after help');
          await page.setViewportSize({width: 390, height: 560});
          await openHelp(page);
          await waitSaved(page); // A pending, ordinary draft autosave remains allowed while help is open.
          assert.deepEqual(await page.locator('#creation-input').evaluate(editor => editor.document), before.document);
          const columns = await page.locator('.creation-help-example-grid > div').evaluateAll(elements => elements.map(el => {const rect = el.getBoundingClientRect();return {x: rect.x, y: rect.y, width: rect.width};}));
          assert.equal(columns.length, 2);
          assert.ok(Math.abs(columns[0].x - columns[1].x) <= 1 && columns[1].y > columns[0].y, 'Mobile example input and reviewed organization stack vertically');
          const scrolling = await page.locator('.creation-help-dialog').evaluate(host => {
            const panel = host.shadowRoot.querySelector('dialog');
            const candidates = [panel, ...host.shadowRoot.querySelectorAll('*'), ...host.querySelectorAll('*')];
            const scrollable = candidates.filter(el => el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
            for (const el of scrollable) el.scrollTop = el.scrollHeight;
            return {scrollable: scrollable.length, moved: scrollable.some(el => el.scrollTop > 0), width: panel.getBoundingClientRect().width, viewport: innerWidth};
          });
          assert.ok(scrolling.scrollable && scrolling.moved, 'Long help is independently scrollable on mobile');
          assert.ok(scrolling.width <= scrolling.viewport + 1);
          if (entry === 'project' && (process.env.CREATION_TEST_BROWSER ?? 'chromium') === 'chromium') await page.screenshot({path: '/tmp/still-creation-help-mobile.png'});
          const close = dialog(page).getByRole('button', {name: 'Close', exact: true}).last();
          await close.scrollIntoViewIfNeeded();
          await close.click();
          await assertRestored(page);
          await waitSaved(page);
          let unloadPrompts=0;
          page.on('dialog', async prompt => {unloadPrompts++;await prompt.dismiss();});
          await page.reload();
          await input.waitFor();
          await waitSaved(page);
          assert.equal(unloadPrompts, 0, 'An acknowledged private draft reloads without a leave warning');
          assert.deepEqual(await page.locator('#creation-input').evaluate(editor => editor.document), before.document, 'Reload restores the acknowledged token-bearing draft');
          // Block the pending write to establish the distinct unsaved boundary.
          await page.route('**/api/still/creation/drafts/**', async route => {
            if(route.request().method() === 'PUT') await route.abort();
            else await route.continue();
          });
          await input.press('End');
          await input.press('x');
          assert.equal(await page.evaluate(() => {const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}), true, 'Unacknowledged edits retain the leave guard');
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });

      await t.test(`${entry}: help remains available during review without granting presentation or changing approvals`, async () => {
        const context = await browser.newContext({viewport: {width: 1100, height: 850}});
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        try {
          await page.goto(`${base}${paths[entry]}?creation=1`);
          const input = page.getByRole('textbox', {name: entry === 'idea' ? 'Describe a detail worth keeping.' : 'A name is enough. Details welcome.', exact: true});
          await input.waitFor();
          const text = Array.from({length: 30}, (_, index) => `Supplied observation ${index + 1}: Paul and Jon sit with their instruments on either side of a microphone.`).join('\n');
          await paste(input, {'text/plain': text});
          await waitSaved(page);
          await dock(page, 'Save').click();
          await page.getByRole('button', {name: 'Complete one Idea manually', exact: true}).click();
          await page.getByRole('heading', {name: 'Review Idea', exact: true}).waitFor();
          await page.getByRole('textbox', {name: 'Title', exact: true}).fill('Supplied musicians');
          const splitResponse = page.waitForResponse(response => response.url().endsWith('/split'));
          await page.getByRole('combobox', {name: 'Idea type'}).selectOption('direction');
          await waitSaved(page);
          await splitResponse; // Settle the earlier edit's debounced assessment before attributing requests to help.
          await page.locator('.creation-full-content').evaluate(el => {el.scrollTop = 80;});
          const before = await reviewSnapshot(page);
          const requestCount = consequentialRequests().length;
          await openHelp(page);
          await page.keyboard.press('ControlOrMeta+Enter');
          await dialog(page).getByRole('button', {name: 'Close', exact: true}).last().click();
          await assertRestored(page);
          assert.deepEqual(await reviewSnapshot(page), before, 'Unseen current review and its scroll position survive help unchanged');
          assert.equal(consequentialRequests().length, requestCount);
          assert.equal(await dock(page, 'Approve').isDisabled(), true, 'Help does not count as reading a proposal');
          const region = page.getByRole('region', {name: 'Full content and included relationships'});
          await region.focus();
          // Prepare the seen/approved fixture without depending on platform End-key scrolling.
          await region.evaluate(el => {el.scrollTop = el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
          await page.waitForFunction(() => !document.querySelector('.creation-continue')?.disabled);
          await page.getByRole('button', {name: 'Continue review', exact: true}).click();
          await page.getByRole('button', {name: 'Current version reviewed', exact: true}).waitFor();
          await dock(page, 'Approve').click();
          await waitSaved(page);
          const approved = await reviewSnapshot(page);
          assert.ok(approved.review.nodes[approved.currentId].approvedHash, 'The test starts with a real current-version approval');
          await openHelp(page);
          await page.keyboard.press('Escape');
          await assertRestored(page);
          assert.deepEqual(await reviewSnapshot(page), approved, 'Existing approval and review position survive help unchanged');
          // Review access also persists when moving to the entry's remaining stages.
          for (const stage of entry === 'project' ? ['Project'] : ['Documents']) {
            await page.getByRole('navigation', {name: 'Review stages'}).getByRole('button', {name: stage, exact: true}).click();
            await waitSaved(page);
            const stageBefore = await reviewSnapshot(page);
            await openHelp(page);
            await page.keyboard.press('Escape');
            await assertRestored(page);
            assert.deepEqual(await reviewSnapshot(page), stageBefore);
          }
          assert.equal(requests.filter(request => /\/apply$/.test(request.url)).length, 0);
        } finally {
          await context.close();
        }
      });
    }
    await t.test('help responds to locale changes, including RTL, without changing authored input', async () => {
      const context = await browser.newContext({viewport: {width: 390, height: 640}});
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      try {
        await page.goto(`${base}${paths.idea}?creation=1`);
        const input = page.getByRole('textbox', {name: 'Describe a detail worth keeping.', exact: true});
        await input.waitFor();
        await paste(input, {'text/plain': 'Paul and Jon sit beside the microphone.'});
        await waitSaved(page);
        const authored = await page.locator('#creation-input').evaluate(editor => editor.document);
        await openHelp(page);
        for (const locale of ['fr', 'ja', 'ar']) {
          const expected = await page.evaluate(async locale => {
            const {setFormaLocale} = await import('/src/components/design-system/localization.ts');
            const {creationHelpCopy} = await import('/src/still/creation-help-copy.ts');
            await setFormaLocale(locale, {persist: false});
            return creationHelpCopy(locale);
          }, locale);
          assert.notEqual(expected.title, 'From your description to organized content');
          assert.equal(await page.locator('#creation-input').getAttribute('label'), expected.ideaLabel);
          await page.getByRole('heading', {name: expected.ideaHeading, exact: true}).waitFor();
          const localized = page.getByRole('dialog', {name: expected.title, exact: true});
          await localized.waitFor();
          assert.ok((await page.locator('.creation-help-content').innerText()).includes(expected.writeHeading));
          assert.equal(await page.locator('.creation-help-trigger').innerText(), expected.trigger);
          assert.equal(await page.locator('.creation-help-dialog').evaluate(el => getComputedStyle(el).direction), locale === 'ar' ? 'rtl' : 'ltr');
          assert.deepEqual(await page.locator('#creation-input').evaluate(editor => editor.document), authored);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          if (locale === 'ar' && (process.env.CREATION_TEST_BROWSER ?? 'chromium') === 'chromium') await page.screenshot({path: '/tmp/still-creation-help-arabic.png'});
        }
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement?.matches('.creation-help-trigger'));
        assert.equal(consequentialRequests().filter(request => /\/apply$/.test(request.url)).length, 0);
      } finally {
        await context.close();
      }
    });
  } finally {
    await browser?.close();
    await server.close();
    await fixture.drainBackground();
    fixture.close();
  }
});
