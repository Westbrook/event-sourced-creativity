import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../font-fixtures/', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('provenance.json', root), 'utf8'));
const regular = { file: 'DMMono-Regular.ttf', sha256: '55b4c98f123daebb3ed27947ba47b2af00554fc6284d639a540bcef5e6258ad2',
  url: new URL('../../../public/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf', import.meta.url) };
const fonts = [...provenance.files.filter(item => item.file.endsWith('.ttf')), regular].map(item => {
  const body = readFileSync(item.url ?? new URL(item.file, root));
  if (createHash('sha256').update(body).digest('hex') !== item.sha256) throw Error('Pinned browser font changed: ' + item.file);
  return { ...item, body };
});
const stylesheet = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap';

export async function installPinnedFonts(context, baseURL) {
  const origin = new URL(baseURL).origin, prefix = origin + '/__forma_validation_fonts__/';
  const css = [['Manrope','200 800','Manrope.ttf'],['DM Mono','400','DMMono-Regular.ttf'],['DM Mono','500','DMMono-Medium.ttf']]
    .map(([family, weight, file]) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url("${prefix}${file}") format("truetype");}`).join('\n');
  const record = { sourceCommit: provenance.sourceCommit, fonts: fonts.map(({file,sha256}) => ({file,sha256})), requests: [] };
  await context.route(url => url.href === stylesheet, async route => {
    if (route.request().method() !== 'GET' || route.request().resourceType() !== 'stylesheet') return route.fallback();
    record.requests.push('stylesheet');
    await route.fulfill({ contentType: 'text/css', body: css });
  });
  await context.route(url => fonts.some(font => url.href === prefix + font.file), async route => {
    if (route.request().method() !== 'GET' || route.request().resourceType() !== 'font') return route.fallback();
    const font = fonts.find(font => route.request().url() === prefix + font.file);
    record.requests.push(font.file);
    await route.fulfill({ contentType: 'font/ttf', body: font.body });
  });
  return record;
}
