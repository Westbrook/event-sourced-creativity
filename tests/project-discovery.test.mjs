import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";

const event=(sequence,type,payload)=>({eventId:`event-${sequence}`,streamId:"creative:test",sequence,occurredAt:`2026-08-19T12:${String(sequence).padStart(2,"0")}:00.000Z`,recordedAt:"2026-08-19T12:00:00.000Z",actor:"user",clientId:"test",correlationId:`correlation-${sequence}`,causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});

test("projects expose the latest standalone generation or complete fan as a single visual result",()=>{
  const events=[
    event(1,"ProjectCreated",{project_id:"project-1",name:"Campaign",state:"active"}),
    event(2,"DocumentCreated",{project_id:"project-1",document_id:"document-1",title:"Hero",handle:"hero"}),
    ...["prose","bullets","json","xml"].map((promptTechnique,index)=>event(3+index,"GenerationCompleted",{generation_id:`generation-${index}`,prompt_fan_id:"fan-1",document_id:"document-1",object_ids:[`object-${index}`],prompt_technique:promptTechnique,media_url:`/media/${index}.png`,quality:"high"})),
  ];
  const projection=foldEvents(events);
  assert.equal(projection.projects[0].recentGenerations.length,1);
  assert.equal(projection.projects[0].recentGenerations[0].kind,"fan");
  assert.equal(projection.projects[0].recentGenerations[0].complete,4);
});

test("projects and collections explain and expose their navigation effect",async()=>{
  const [projects,rail,tree,contents,styles]=await Promise.all([
    readFile(new URL("../src/components/forma-projects.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/project-rail.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/collection-tree.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-project-contents.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/design-system.css",import.meta.url),"utf8"),
  ]);
  assert.match(projects,/Latest fan/);assert.match(projects,/forma-prompt-fan-visual/);assert.match(projects,/project-card-generation/);
  assert.match(rail,/surface==="library"\?"\/library":"\/studio\/project"/);
  assert.match(tree,/Open one to filter project contents/);assert.match(tree,/Filtering by/);assert.match(tree,/Clear/);
  assert.match(contents,/Showing collection/);assert.match(contents,/Clear collection filter/);
  assert.match(styles,/\.project-card-generation/);assert.match(styles,/\.collection-rail-filter/);assert.match(styles,/\.project-contents-filter/);
});
