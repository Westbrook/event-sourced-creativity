import {defineConfig} from 'vite';
import {resolve} from 'node:path';
const core=process.env.PILOT_RELEASE==='core';
export default defineConfig({
 root:resolve(import.meta.dirname,'..'),
 build:{outDir:core?'pilot/dist/core-web':'pilot/dist/web',emptyOutDir:true,rollupOptions:{input:{still:resolve(import.meta.dirname,'../still.html'),forma:resolve(import.meta.dirname,'../index.html')}}},
 plugins:[{name:'still-pilot-disclosure',generateBundle(){if(core)this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({revision:process.env.SOURCE_COMMIT??'local-uncommitted',release:'R1'})});},transformIndexHtml:{order:'pre',handler(html){
  if(core)html=html.replace('</body>','<script type="module" src="/pilot/web/controls.ts"></script></body>');
  return html.replace('<body>',`<body><aside role="note" style="position:sticky;top:0;left:0;right:0;z-index:2147483647;text-align:center;font:12px system-ui;background:#ffefc1;color:#322b15;padding:4px;pointer-events:none">${core?'ISOLATED TEST RELEASE · manual creation · models and uploads disabled':'LOCAL PILOT · synthetic data · disposable SQLite · simulated identity · providers disabled'}</aside>`);
 }}}]
});
