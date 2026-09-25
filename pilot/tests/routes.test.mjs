import test from 'node:test';import assert from 'node:assert/strict';import {pageEntry,apiAllowed} from '../src/routes.mjs';
test('pilot routes use native Still grammar and the actual Forma document route; no arbitrary SPA fallback',()=>{
 for(const route of ['/still','/still/action/new-project','/still/project/p/action/new-document','/still/project/p/document/d/action/add-context','/still/project/p/ideas/block/b','/still/project/p/document/d/page/2'])assert.equal(pageEntry(route),'still.html',route);
 for(const route of ['/projects','/document/d','/document/d/notes'])assert.equal(pageEntry(route),'index.html');
 for(const route of ['/api/private','/assets/missing.js','/operations','/still/project/p/document/d/create/image','/still/project/p/document/d/result/r','/document/d/view/board','/still/project/%2f'])assert.equal(pageEntry(route),null,route);
 assert.equal(apiAllowed('/api/still/creation/drafts','POST'),true);assert.equal(apiAllowed('/api/document-jobs','POST'),false);assert.equal(apiAllowed('/api/admin','GET'),false);assert.equal(apiAllowed('/api/creation/drafts','POST'),false);
});
