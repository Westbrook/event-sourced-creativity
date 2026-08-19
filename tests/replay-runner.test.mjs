import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";
import { adjacentVisibleReplaySequence, replayEventIsUserVisible, replayRunnerEvent, replaySurfaceForEvent, replayVisibleLandmarks } from "../src/model/replay-runner.ts";

const event=(sequence,type,actor="user",payload={})=>({eventId:`event-${sequence}`,streamId:"runner-test",sequence,occurredAt:`2026-01-01T00:00:${String(sequence).padStart(2,"0")}.000Z`,recordedAt:`2026-01-01T00:00:${String(sequence).padStart(2,"0")}.100Z`,actor,clientId:"web:test",correlationId:"runner",causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});

const events=[
  event(1,"ProjectCreated","user",{project_id:"project-1",name:"Nocturne studies",state:"active"}),
  event(2,"DocumentCreated","user",{project_id:"project-1",document_id:"document-1",title:"Window study"}),
  event(3,"DocumentViewVisited","user",{project_id:"project-1",document_id:"document-1",view:"editor",focused:true,source_surface:"document-view-navigation"}),
  event(4,"ContextCompiled","worker:compiler",{document_id:"document-1",source_surface:"creative-editor"}),
  event(5,"GenerationCompleted","worker:generator",{document_id:"document-1",generation_id:"generation-1",object_ids:["object-1"],quality:"high",source_surface:"creative-editor"}),
  event(6,"AddedToLibrary","user",{object_id:"object-1",source_surface:"library"}),
  event(7,"ScoutObserved","worker:scout",{observation_id:"observation-1",label:"The editor is carrying progress",summary:"Retained work follows focused editor sessions.",confidence:.8}),
  event(8,"CanvasCreated","user",{project_id:"project-1",canvas_id:"canvas-1",name:"Working wall"}),
];

const projection=foldEvents(events);

test("the replay runner separates user-visible events from hidden projection machinery",()=>{
  assert.equal(replayEventIsUserVisible(events[2]),true);
  assert.equal(replayEventIsUserVisible(events[3]),false);
  assert.equal(replayEventIsUserVisible(events[4]),true);
  assert.equal(adjacentVisibleReplaySequence(events,3,1),5);
  assert.equal(adjacentVisibleReplaySequence(events,5,-1),3);
  assert.equal(replayRunnerEvent(events,4)?.eventId,"event-3");
});

test("visible events drive the application runner to the surface where their effect is experienced",()=>{
  const editor=replaySurfaceForEvent(events[2],projection,events);
  assert.equal(editor.application,"creative");assert.equal(editor.kind,"document");assert.equal(editor.view,"editor");assert.equal(editor.focused,true);assert.equal(editor.route,"/document/document-1/window-study/view/editor/focus");
  assert.deepEqual(replaySurfaceForEvent(events[5],projection,events),{application:"creative",kind:"library",label:"Library",route:"/library",targetLabel:"object-1"});
  assert.equal(replaySurfaceForEvent(events[6],projection,events).route,"/scout");
  assert.equal(replaySurfaceForEvent(events[7],projection,events).route,"/canvas/canvas-1/working-wall");
  assert.equal(replaySurfaceForEvent(event(9,"ProjectOpened","user",{project_id:"project-1"}),projection,events).route,"/studio/project");
  const canvasGeneration=event(9,"GenerationCompleted","worker:generator",{document_id:"document-1",generation_id:"canvas-generation"});canvasGeneration.correlationId=events[7].correlationId;
  assert.equal(replaySurfaceForEvent(canvasGeneration,projection,[...events,canvasGeneration]).application,"canvas");
  assert.equal(replaySurfaceForEvent(event(9,"GenerationRequested","worker:scout",{document_id:"document-1",report_space:"scout"}),projection,events).route,"/scout");
});

test("large streams expose bounded jump landmarks while preserving both ends",()=>{
  const long=Array.from({length:1_000},(_,index)=>event(index+1,"DocumentViewVisited","user",{document_id:"document-1",view:index%2?"chat":"editor"}));
  const landmarks=replayVisibleLandmarks(long,80);
  assert.equal(landmarks.length,80);assert.equal(landmarks[0].sequence,1);assert.equal(landmarks.at(-1).sequence,1_000);
});

test("Projection replay ships an app runner, persistent generations, and explicit user-visible event navigation",async()=>{
  const [admin,runner,styles]=await Promise.all([readFile(new URL("../src/components/forma-admin-events.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/forma-replay-app-runner.ts",import.meta.url),"utf8"),readFile(new URL("../src/design-system.css",import.meta.url),"utf8")]);
  for(const phrase of ["Application runner","Previous visible event","Next visible event","Jump to visible event","Step over","Follow visible events","Images created so far","Generation results stay available here"])assert.match(admin,new RegExp(phrase));
  for(const phrase of ["Images in this replay","Every saved image remains visible independent of the current replay position","Saved · upcoming","Reached in replay"])assert.match(admin,new RegExp(phrase.replace(/[·]/g,"·")));
  assert.match(admin,/<forma-replay-app-runner/);assert.match(admin,/#replayGenerations\(projection\.libraryOutputs,stream\)/);assert.match(admin,/<forma-output-visual \.output=\$\{output\} \.interactive=\$\{true\}/);assert.match(runner,/The runner is read-only; state comes from the replay projection/);assert.match(styles,/\.replay-runner-layout/);assert.match(styles,/\.replay-app-shell/);assert.match(styles,/\.replay-generation-grid/);
  assert.match(styles,/\.replay-app-output-stage\s*\{[^}]*position:\s*relative/);assert.match(styles,/\.replay-app-output-stage forma-output-visual\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*overflow:\s*hidden/);assert.match(styles,/\.replay-app-output-stage \.generated-output-trigger > img\s*\{[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;[^}]*object-fit:\s*contain/);
});
