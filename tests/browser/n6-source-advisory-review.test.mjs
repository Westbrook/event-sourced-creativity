import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createN6ReviewServer} from '../helpers/n6-source-advisory-review-fixture.mjs';

test('N6 selected inspector preserves inert disclosure, attribution and explicit acknowledgement', async () => {
  const {server, url} = await createN6ReviewServer();
  let browser;
  try {
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 1280, height: 950}});
    page.setDefaultTimeout(15000);
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(url);
    const dock = page.locator('.action-dock');
    const button = name => dock.getByRole('button', {name, exact: true});
    await expect(button('Generate')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.n6Trace), {requests: [], unexpectedFetches: [], acknowledgedRequests: 0, createdJobs: 0, inspections: 0});
    assert.equal(await page.evaluate(() => window.n6App.client.jobs.length), 0);

    await button('Generate').click();
    await expect(button('Acknowledge & send')).toBeVisible();
    const known = page.locator('#generation-context-known .context-review-reason');
    await expect(known).toContainText('flagged: hate');
    await expect(known).not.toContainText('violence');
    await expect(page.locator('#generation-context-empty .context-review-reason')).toContainText('category unavailable');
    await expect(page.locator('#generation-context-legacy .context-review-reason')).toHaveCount(0);
    await expect(page.locator('#generation-context-clear .context-review-reason')).toHaveCount(0);
    await expect(page.locator('#generation-context-empty')).toContainText('<img data-n6-injected="true"');
    await expect(page.locator('[data-n6-injected]')).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.n6MarkupExecuted), undefined);
    await page.getByRole('button',{name:'Inspect source advisory',exact:true}).click();
    await expect(page.getByText('Returned model',{exact:true})).toBeVisible();
    await page.getByText('Exact request body',{exact:true}).click();
    await expect(page.locator('still-source-advisory-inspector pre').first()).toContainText('<img data-n6-injected=');
    await expect(page.locator('[data-n6-injected]')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>window.n6Trace.inspections),1);
    assert.equal(await page.evaluate(()=>window.n6Trace.acknowledgedRequests),0);

    // Reading/reflowing the warning has no acknowledgement or job side effect.
    await page.setViewportSize({width: 390, height: 844});
    await expect(button('Acknowledge & send')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const before = await page.evaluate(() => ({trace: window.n6Trace, jobs: window.n6App.client.jobs.length, acknowledgements: window.n6App.generation.acknowledgements ?? {}}));
    assert.equal(before.trace.requests.length, 1);
    assert.equal(before.trace.requests[0].payload.preflightAcknowledged, undefined);
    assert.equal(before.trace.acknowledgedRequests, 0);
    assert.equal(before.trace.createdJobs, 0);
    assert.equal(before.jobs, 0);
    assert.deepEqual(before.acknowledgements, {});

    await button('Acknowledge & send').click();
    await expect.poll(() => page.evaluate(() => window.n6Trace.acknowledgedRequests)).toBe(1);
    await expect(button('Check request')).toBeDisabled();
    const during = await page.evaluate(() => window.n6Trace);
    assert.equal(during.requests.length, 2);
    assert.equal(during.createdJobs, 0);
    const original = structuredClone(during.requests[0]), acknowledged = structuredClone(during.requests[1]);
    assert.equal(acknowledged.payload.preflightAcknowledged, true);
    delete acknowledged.payload.preflightAcknowledged;
    assert.deepEqual(acknowledged, original, 'the explicit acknowledgement retains the original request and source');
    await page.getByText('Fixture counters and retained request', {exact: true}).click();
    await page.getByRole('button', {name: 'Finish synthetic acknowledgement', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Synthetic acknowledgement accepted'})).toBeVisible();
    const after = await page.evaluate(() => ({trace: window.n6Trace, jobs: window.n6App.client.jobs.length, pending: window.n6App.client.pendingGeneration}));
    assert.equal(after.trace.requests.length, 2);
    assert.equal(after.trace.acknowledgedRequests, 1);
    assert.equal(after.trace.createdJobs, 1);
    assert.equal(after.jobs, 1);
    assert.equal(after.pending, null);
    assert.deepEqual(after.trace.unexpectedFetches, []);

    await page.goto(`${url}?variant=legacy`);
    await button('Generate').click();
    await expect(button('Acknowledge & send')).toBeVisible();
    await page.getByRole('button',{name:'Inspect source advisory',exact:true}).click();
    await expect(page.getByText(/Source advisory details are unavailable/)).toBeVisible();
    await expect(page.locator('still-source-advisory-inspector pre')).toHaveCount(0);
    const legacy = page.locator('#generation-context-legacy .context-review-reason');
    await expect(legacy).toContainText('individual categories were not recorded');
    await expect(legacy).not.toContainText('violence');
    assert.equal(await page.evaluate(() => window.n6Trace.requests.length), 1);
    assert.equal(await page.evaluate(() => window.n6Trace.acknowledgedRequests), 0);
    assert.equal(await page.evaluate(() => window.n6App.client.jobs.length), 0);
    assert.deepEqual(await page.evaluate(() => window.n6Trace.unexpectedFetches), []);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
