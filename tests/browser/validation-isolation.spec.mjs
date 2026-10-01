import { test, expect, applyBrowserZoom } from './fixtures.mjs';

test('ordinary tests reuse a worker browser while cookies and pages remain context-local', async ({ context, page, ordinaryBrowser, baseURL }) => {
  const browser = await ordinaryBrowser();
  expect(context.browser()).toBe(browser);
  await context.addCookies([{ name: 'fixture-private', value: 'one', url: baseURL }]);
  await page.setContent('<button>Original context</button>');
  await page.evaluate(() => { globalThis.privateFixture = 'one'; });
  const fresh = await browser.newContext();
  try {
    expect(await fresh.cookies()).toEqual([]);
    const other = await fresh.newPage();
    expect(await other.evaluate(() => globalThis.privateFixture)).toBeUndefined();
    expect(await other.locator('button').count()).toBe(0);
    expect(await ordinaryBrowser()).toBe(browser);
  } finally { await fresh.close(); }
});

test.describe('true zoom keeps its dedicated extension profile', () => {
  test.use({ geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2 } });
  test('200% is native browser zoom with measured reflow', async ({ context, page }, info) => {
    await page.route('http://127.0.0.1:4178/tests/validation.fixture.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><button>Zoom fixture</button>' }));
    await page.goto('http://127.0.0.1:4178/tests/validation.fixture.html');
    await applyBrowserZoom(page, context, 2, info);
  });
});
