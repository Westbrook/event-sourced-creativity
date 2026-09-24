import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url),read=n=>JSON.parse(readFileSync(new URL(n,root),'utf8'));
const corpus=read('corpus.json'),held=read('heldout-inputs.json'),tuning=read('tuning-inputs.json'),organizer=read('organizer-inputs.json');
const sources=[...corpus.projects,...corpus.documents,...corpus.ideas]; const ids=new Set(sources.map(x=>x.id)); assert.equal(ids.size,sources.length);
const projects=new Map(corpus.projects.map(p=>[p.id,p]));
assert.ok(projects.size>=21);assert.ok(new Set(corpus.projects.map(p=>p.custody)).size>=2);
for(const item of sources){const p=projects.get(item.projectId??item.id); assert.ok(p);assert.equal(item.partitionId,JSON.stringify([p.custody,p.id]));assert.equal(item.custody,p.custody);}
for(const d of corpus.documents)for(const id of d.ideaIds){const idea=corpus.ideas.find(i=>i.id===id);assert.equal(idea?.projectId,d.projectId);assert.equal(idea?.custody,d.custody);}
assert.ok(held.queries.length>=60);const allQueries=[...held.queries,...tuning.queries];assert.equal(new Set(allQueries.map(q=>q.id)).size,allQueries.length);assert.equal(new Set(allQueries.map(q=>q.query.normalize('NFKC').toLowerCase().trim())).size,allQueries.length);
for(const q of allQueries){assert.ok(!('classification' in q));assert.ok(!('intended' in q));assert.equal(new Set(q.allowedIds).size,q.allowedIds.length);for(const id of q.allowedIds){const s=sources.find(s=>s.id===id);assert.ok(s);assert.ok(s.eligible!==false&&s.status!=='closed');assert.ok(q.permittedPartitions.some(p=>p.id===s.partitionId&&p.custodyId===s.custody));}}
assert.ok(organizer.cases.length>=30);assert.equal(new Set(organizer.cases.map(c=>c.id)).size,organizer.cases.length);assert.equal(new Set(organizer.cases.map(c=>c.input.text)).size,organizer.cases.length);
for(const scenario of ['missing-body','missing-type','exact-reference','faithful-extraction','faithful-rewording','split','merge','removal','correction','approval-preservation'])assert.ok(organizer.cases.some(c=>c.scenario===scenario),scenario);
for(const c of organizer.cases){assert.ok(c.input.text&&c.state);assert.equal(c.humanAdjudicationRequired,true);if(c.input.confirmedReplacement){const r=c.input.confirmedReplacement;const body=c.state.ideas.find(i=>i.id===r.ideaId).body;assert.equal(body.slice(r.start,r.end),r.original);}}
const hashes=read('input-hashes.json').hashes;for(const [name,hash] of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex'),hash,name);
console.log(JSON.stringify({fixtureId:corpus.fixtureId,sourceIdentities:sources.length,ideas:corpus.ideas.length,projects:projects.size,custodies:new Set(corpus.projects.map(p=>p.custody)).size,heldoutQueries:held.queries.length,tuningQueries:tuning.queries.length,organizerCases:organizer.cases.length,independentLabelsVerified:false,humanOrganizerReview:false},null,2));
