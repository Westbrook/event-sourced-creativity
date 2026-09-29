import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeRichDocument,richDocumentText,richDocumentFromRuns} from '../src/still/vendor/elements/rich-document.js';
import {validateRichDocument} from '../src/still/vendor/elements/rich-text-editor/document.js';
import {resolveRichRange} from '../src/still/vendor/elements/rich-text-editor/ranges.js';
import {createEditorCommandMatcher} from '../src/still/vendor/elements/editor-command-matcher.js';
const token={kind:'token',id:'occurrence',type:'still-idea-reference',text:'Paul',label:'Paul',data:{schemaVersion:1,projectId:'p',blockId:'b'}};
const textDocument=text=>richDocumentFromRuns([{kind:'text',text}]);
test('portable codec is standalone, detached, Unicode preserving, and legacy @ remains text',()=>{
 const source=readFileSync(new URL('../src/still/vendor/elements/rich-document.js',import.meta.url),'utf8');assert.doesNotMatch(source,/^import /m);
 const original=textDocument('日本語 e\u0301 👩🏽‍💻\n@literal');const decoded=decodeRichDocument(original);assert.notEqual(decoded,original);assert.ok(Object.isFrozen(decoded.doc.content));assert.equal(richDocumentText(decoded),'日本語 e\u0301 👩🏽‍💻\n@literal');
});
test('public schema rejects unsafe links, unknown fields, occurrence duplicates and invalid containers',()=>{
 const invalid=[{...textDocument('x'),version:2},{...textDocument('x'),private:true},
 {type:'en-rich-text',version:1,doc:{type:'doc',content:[{type:'text',text:'unwrapped'}]}},
 {type:'en-rich-text',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]}}];
 for(const value of invalid)assert.throws(()=>decodeRichDocument(value),TypeError);
 assert.throws(()=>richDocumentFromRuns([token,token]),TypeError);
 assert.throws(()=>richDocumentFromRuns([{...token,id:42}]),TypeError);
 assert.throws(()=>decodeRichDocument({get type(){throw Error('Accessor executed');}}),/enumerable data/);
});
test('rich decoder enforces exact byte, node and depth bounds without truncation',()=>{
 const doc=textDocument('🌍');const bytes=new TextEncoder().encode(JSON.stringify(doc)).byteLength;
 assert.deepEqual(decodeRichDocument(doc,{maxBytes:bytes,maxNodes:3,maxDepth:3}),doc);
 for(const limits of [{maxBytes:bytes-1},{maxNodes:2},{maxDepth:2}])assert.throws(()=>decodeRichDocument(doc,limits),TypeError);
 let nested={type:'paragraph',content:[]};for(let i=0;i<16;i++)nested={type:'bullet_list',content:[{type:'list_item',content:[{type:'paragraph'},nested]}]};assert.throws(()=>decodeRichDocument({type:'en-rich-text',version:1,doc:{type:'doc',content:[nested]}}),/node limit/);
});
test('range resolution guards revision, expected text, graphemes and partial token crossings',()=>{
 const doc=validateRichDocument(richDocumentFromRuns([{kind:'text',text:'e\u0301 👩🏽‍💻 '},token,{kind:'text',text:' tail'}]));
 const range=(from,to,expectedText,revision=7)=>({coordinate:'text',from,to,expectedText,revision});
 assert.deepEqual(resolveRichRange(doc,7,range(0,2,'e\u0301')),{from:1,to:3});
 assert.equal(resolveRichRange(doc,7,range(0,1,'e')),undefined);
 assert.equal(resolveRichRange(doc,7,range(3,5,'👩')),undefined);
 assert.equal(resolveRichRange(doc,7,range(0,2,'e\u0301',6)),undefined);
 assert.equal(resolveRichRange(doc,7,range(0,2,'other')),undefined);
 assert.deepEqual(resolveRichRange(doc,7,range(11,15,'Paul')),{from:12,to:13});
 assert.equal(resolveRichRange(doc,7,range(11,14,'Pau')),undefined);
});
test('multiword custom command matcher excludes escaped, URL/path and unknown commands',()=>{
 const match=createEditorCommandMatcher(['image','3D','3D model']);
 assert.deepEqual(match('make /3D mo'),{from:5,query:'3D mo'});
 assert.deepEqual(match('/3D model'),{from:0,query:'3D model'});
 for(const input of ['https://image','/tmp/image','\\/image','/unknown','/3D models'])assert.equal(match(input),undefined);
});
