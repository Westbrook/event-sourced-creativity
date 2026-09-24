import test from 'node:test';
import assert from 'node:assert/strict';
import {creationHelpEnglish,creationHelpCatalogs,creationHelpCopy,creationEntryCopy} from '../src/still/creation-help-copy.ts';

const placeholders = text => [...text.matchAll(/\{[^}]+\}/g)].map(match=>match[0]).sort();
const commands = text => [...text.matchAll(/\/(?:3D model|project|document|idea|image|video)\b/g)].map(match=>match[0]).sort();

test('contextual help has complete translated catalogs and preserves interpolation and literal commands',()=>{
  assert.deepEqual(Object.keys(creationHelpCatalogs).sort(),['ar','en','fr','ja']);
  for(const [locale,copy] of Object.entries(creationHelpCatalogs)){
    assert.deepEqual(Object.keys(copy).sort(),Object.keys(creationHelpEnglish).sort(),locale);
    for(const [key,english] of Object.entries(creationHelpEnglish)){
      assert.ok(copy[key].trim(),`${locale}.${key} is nonempty`);
      assert.deepEqual(placeholders(copy[key]),placeholders(english),`${locale}.${key} placeholders`);
      assert.deepEqual(commands(copy[key]),commands(english),`${locale}.${key} commands`);
      if(english.includes('@'))assert.ok(copy[key].includes('@'),`${locale}.${key} retains @`);
      if(locale!=='en')assert.notEqual(copy[key],english,`${locale}.${key} is translated`);
    }
    assert.match(copy.shortcut,/⌘ Enter/);
    assert.match(copy.shortcut,/Ctrl Enter/);
  }
});

test('locale lookup handles supported regions and casing, with a stable English fallback',()=>{
  assert.equal(creationHelpCopy('FR-ca'),creationHelpCatalogs.fr);
  assert.equal(creationHelpCopy('ar-EG'),creationHelpCatalogs.ar);
  assert.equal(creationHelpCopy('ja-JP'),creationHelpCatalogs.ja);
  assert.equal(creationHelpCopy('en-US'),creationHelpEnglish);
  assert.equal(creationHelpCopy('zz-ZZ'),creationHelpEnglish);
  assert.equal(creationHelpCopy(''),creationHelpEnglish);
});

test('every entry has distinct scoped guidance and read-only examples with only eligible markers',()=>{
  for(const copy of Object.values(creationHelpCatalogs)){
    for(const suffix of ['Hint','Save','Identity','Markers','Review','Example','Result']){
      const entries=['project','document','idea'].map(kind=>creationEntryCopy(copy,kind,suffix));
      assert.equal(new Set(entries).size,3,`${suffix} distinguishes all three entry scopes`);
    }
    assert.deepEqual(commands(creationEntryCopy(copy,'project','Markers')),['/document','/idea','/project']);
    assert.deepEqual(commands(creationEntryCopy(copy,'document','Markers')),['/document','/idea']);
    assert.deepEqual(commands(creationEntryCopy(copy,'idea','Markers')),['/idea']);
    assert.deepEqual(commands(creationEntryCopy(copy,'project','Example')),['/document','/image']);
    assert.deepEqual(commands(creationEntryCopy(copy,'document','Example')),['/image']);
    assert.deepEqual(commands(creationEntryCopy(copy,'idea','Example')),[]);
    assert.deepEqual(commands(copy.outputs),['/3D model','/image','/video']);
  }
});
