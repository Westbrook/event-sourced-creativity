import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { documentRenderSuggestions } from "../src/model/document-render-suggestions.ts";

const event=(sequence,type,documentId,payload={})=>({eventId:`e${sequence}`,streamId:"s",sequence,occurredAt:`2026-08-20T12:00:0${sequence}.000Z`,recordedAt:`2026-08-20T12:00:0${sequence}.000Z`,actor:"user",clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1,type,payload:{document_id:documentId,...payload}});

test("document render guidance reuses recent durable values within one document",()=>{
  const events=[
    event(1,"DocumentRenderCompleted","document-1",{settings:{audience:"Client team",tone:"Quietly assured"}}),
    event(2,"DocumentRenderRequested","document-2",{audience:"Other document",tone:"Unrelated"}),
    event(3,"DocumentRenderRequested","document-1",{audience:"Festival audience",tone:"Tense and anticipatory"}),
    event(4,"DocumentRenderRequested","document-1",{audience:"client team",tone:"QUIETLY ASSURED"}),
    event(5,"DocumentRenderCompleted","document-1",{settings:{audience:"general",tone:"document-derived"}}),
  ];
  assert.deepEqual(documentRenderSuggestions(events,"document-1","audience"),["client team","Festival audience"]);
  assert.deepEqual(documentRenderSuggestions(events,"document-1","tone"),["QUIETLY ASSURED","Tense and anticipatory"]);
});

test("artifact forms bind native datalists to event-backed Audience and Tone inputs",async()=>{
  const [component,store,events]=await Promise.all([
    readFile(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
  ]);
  assert.match(component,/documentRenderSuggestions/);
  assert.match(component,/list=\$\{audienceListId\}/);
  assert.match(component,/list=\$\{toneListId\}/);
  assert.match(component,/<datalist id=\$\{audienceListId\}>/);
  assert.match(component,/<datalist id=\$\{toneListId\}>/);
  assert.match(component,/#rememberedAudiences\.add\(audience\)/);
  assert.match(component,/#rememberedTones\.add\(tone\)/);
  assert.match(store,/encodeURIComponent\(audience\?\.toLocaleLowerCase\(\)\?\?"general"\)/);
  assert.match(store,/encodeURIComponent\(tone\?\.toLocaleLowerCase\(\)\?\?"document-derived"\)/);
  assert.match(events,/DocumentRenderRequested[^\n]*audience:audience\|\|null,tone:tone\|\|null/);
  assert.match(events,/document_render_guidance_too_long/);
});
