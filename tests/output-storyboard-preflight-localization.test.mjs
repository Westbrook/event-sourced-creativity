import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES as messages, outputDeliveryMessageDescriptor as descriptor} from '../src/components/design-system/locales/output-delivery-runtime-messages.ts';
const root=new URL('../',import.meta.url);
const codes=['output_storyboard_contract_unsupported','output_storyboard_provider_unavailable','output_storyboard_original_expired','output_storyboard_context_limit','output_storyboard_source_changed','output_storyboard_offer_invalid','output_storyboard_ready','output_transfer_storyboard_after_authorization'];
const text=code=>messages.en[descriptor(code).id];
test('every literal Storyboard preflight reason and transfer resolves in all four locales',async()=>{
 const preflight=await readFile(new URL('worker/output-storyboard-preflight.ts',root),'utf8');
 const emitted=[...preflight.matchAll(/unavailable\(target.id,"([^"]+)"\)/g)].map(m=>m[1]);
 emitted.push(...[...preflight.matchAll(/(?:reasonCode|transferCode):"(output_(?:storyboard|transfer_storyboard)[^"]+)"/g)].map(m=>m[1]));
 assert.deepEqual([...new Set(emitted)].sort(),codes.toSorted());
 for(const code of codes){const d=descriptor(code,{unused:'PRIVATE SOURCE'});assert.equal(d.known,true,code);assert.deepEqual(d.values,{});
  for(const [locale,entries]of Object.entries(messages)){assert.ok(entries[d.id]?.trim(),locale+code);assert.doesNotMatch(entries[d.id],/PRIVATE SOURCE|https?:\/\/|\{[^}]+\}/u);if(locale!=='en')assert.notEqual(entries[d.id],messages.en[d.id]);}}
});
test('expiry distinguishes never-authorized renewal from fresh draft after an attempt and preserves all prior accounting',()=>{
 const expired=text('output_storyboard_original_expired');assert.match(expired,/never authorized.*Renew preparation/);assert.match(expired,/After an authorized attempt, prepare a fresh Storyboard draft/);assert.match(expired,/same story beats and visual direction/);assert.match(expired,/previous Document, history, and any charges or holds remain/);assert.match(expired,/preparation does not start generation/);
});
test('ready and transfer English match the authoritative Storyboard offer without weakening safety disclosure',async()=>{
 const offer=await readFile(new URL('src/model/output-storyboard-offer.ts',root),'utf8');
 const literal=name=>JSON.parse(offer.match(new RegExp('export const '+name+' = ("(?:[^"\\\\]|\\\\.)*");'))[1]);
 assert.equal(text('output_storyboard_ready'),literal('STORYBOARD_READY_REASON'));
 assert.equal(text('output_transfer_storyboard_after_authorization'),literal('STORYBOARD_TRANSFER'));
});
test('unknown reasons remain fail-closed and cannot inject provider or authored prose',()=>{
 const d=descriptor('output_storyboard_future_PRIVATE_SOURCE',{message:'PRIVATE SOURCE'});assert.equal(d.known,false);assert.equal(d.id,'output.delivery.message.unknown');assert.deepEqual(d.values,{});
});
