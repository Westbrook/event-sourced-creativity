// Regenerate Home Screen PNGs from Still's existing favicon, preserving its mark.
// Run on a machine with Georgia installed (the favicon's preferred typeface).
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const source=await readFile(new URL('../src/still/favicon.svg',import.meta.url),'utf8');
const background=source.match(/<rect[^>]*fill="([^"]+)"/)?.[1];
if(!background)throw new Error('The favicon needs an opaque background.');
const output=new URL('../public/assets/still/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({deviceScaleFactor:1});
  const fullBleed=source.replace('rx="14"','rx="0"');
  // A maskable icon keeps the entire mark inside the central safe circle.
  const maskable=fullBleed.replace(/(<svg[^>]*>)/,`$1<rect width="64" height="64" fill="${background}"/><g transform="translate(6.4 6.4) scale(.8)">`).replace('</svg>','</g></svg>');
  for(const [file,size,svg] of [['apple-touch-icon.png',180,fullBleed],['icon-192.png',192,fullBleed],['icon-512.png',512,fullBleed],['icon-maskable-512.png',512,maskable]]) {
    await page.setViewportSize({width:size,height:size});
    await page.setContent(`<style>html,body{margin:0;background:${background}}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:new URL(file,output).pathname});
  }
} finally {await browser.close();}
