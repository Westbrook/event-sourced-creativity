import {defineConfig} from 'vite';
import {resolve} from 'node:path';
// Separate frontend build: the Sites Worker build and checks remain unchanged.
export default defineConfig({root:resolve(import.meta.dirname,'..'),build:{outDir:'pilot/dist/web',emptyOutDir:true,rollupOptions:{input:{still:resolve(import.meta.dirname,'../still.html'),forma:resolve(import.meta.dirname,'../index.html')}}},plugins:[{name:'still-pilot-disclosure',transformIndexHtml(html){return html.replace('<body>',`<body><aside role="note" style="position:sticky;top:0;left:0;right:0;z-index:2147483647;text-align:center;font:12px system-ui;background:#ffefc1;color:#322b15;padding:4px;pointer-events:none">LOCAL PILOT · synthetic data · disposable SQLite · simulated identity · providers disabled</aside>`);}}]});
