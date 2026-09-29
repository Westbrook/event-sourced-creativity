// Explicit E successors to the archived invitation+View access inverse pair.
// Both actions now live on the actual Projects task: current View access and
// GET-only Refresh. No invitation/ACK or hidden Members form is claimed.
import assert from "node:assert/strict";
import test from "node:test";
import { settingsFixture, endpoint, method } from "./helpers/workspace-settings-whole-read-fixture.mjs";

const MEMBER_URL=endpoint("A","/projects/settings-access-A/members");
const PACKAGE_URL=endpoint("A","/context-packages");
const MARKER="PRIVATE_A_PROJECT_MEMBER";
const memberRead=request=>method(request)==="GET"&&request.url===MEMBER_URL;
const sourceSnapshot=f=>structuredClone({route:f.store.route.get(),session:f.store.session.get(),
  events:f.store.events.get(),content:f.store.content.get(),head:f.store.head.get(),
  authorization:f.store.captureAuthorizationScope()});
function view(f){
  const label=f.i18n.t("workspace.admin.viewAccessNamed","View access to {name}",{name:"PRIVATE_A_PROJECT"});
  return f.click(f.find("button",node=>node.attributes["aria-label"]===label));
}
function observed(f){
  return{privateMemberVisible:f.privateText().includes(MARKER),
    alerts:f.nodes("p").filter(node=>node.attributes.role==="alert").map(node=>node.text)};
}

for(const changedAuthority of [false,true])test(
  "E project-member denial across explicit whole Refresh "+(changedAuthority?"genuine authority retirement control":"same owner, no exact member certificate"),
  {concurrency:false,timeout:45000},async t=>{
    const f=await settingsFixture(t,{locale:"en",section:"projects"}),service=f.service;
    const original=sourceSnapshot(f),authority=f.store.captureAuthorizationScope();
    const fiscal=()=>structuredClone({store:[f.store.session.get().budgets,f.store.session.get().costBudgets],
      service:[service.session.budgets,service.session.costBudgets],credentials:service.credentials});
    const fiscalBefore=fiscal();
    const originalMembers=structuredClone(service.projectMembers),memberStart=service.requests.filter(memberRead).length;
    let old,whole,duringWhole,afterDenial,afterWhole,recovered,retiredSource;
    try{
      view(f);await f.until(()=>f.privateText().includes(MARKER),"initial current private membership renders");
      await f.flush();assert.deepEqual(observed(f),{privateMemberVisible:true,alerts:[]});
      old=service.queue(memberRead,"headers",{status:403,raw:"old exact member denial JSON is unnecessary"});
      whole=service.queue(request=>method(request)==="GET"&&request.url===PACKAGE_URL,"body");
      view(f);await old.seen.promise;assert.equal(old.jsonCalls,0);
      f.click(f.find("button",node=>Object.hasOwn(node.attributes,"data-workspace-settings-refresh")));
      await whole.bodyStarted.promise;await f.flush(16);
      if(changedAuthority){
        // Existing finite session publication through the real Store. The
        // original pending collection cannot own the resulting new authority.
        await f.refreshAuthority();await f.flush(16);
      }
      assert.equal(service.writes.length,0);
      assert.equal(service.requests.filter(memberRead).length-memberStart,2,
        "Neither a pending nor completed whole collection certifies exact project membership");
      assert.equal(f.store.authorizationScopeActive(authority),!changedAuthority);
      retiredSource=sourceSnapshot(f);
      if(!changedAuthority)assert.deepEqual(retiredSource,original);
      else assert.deepEqual(f.store.events.get(),[],"Actual Store authority retirement clears the previous Source");
      duringWhole=observed(f);

      old.release.resolve();await f.flush(16);
      assert.equal(old.jsonCalls,0,"Old denied bytes are not consumed in either ownership case");
      afterDenial=observed(f);
      whole.release.resolve();await f.flush(24);
      assert.equal(service.pending,0);afterWhole=observed(f);
      view(f);await f.until(()=>f.privateText().includes(MARKER),"one fresh exact authorized View access recovers");
      await f.flush();recovered=observed(f);
      assert.deepEqual(recovered,{privateMemberVisible:true,alerts:[]});
      assert.deepEqual(sourceSnapshot(f),retiredSource,"Exact member reads neither mutate nor recertify Source");
      assert.deepEqual(service.projectMembers,originalMembers);assert.deepEqual(fiscal(),fiscalBefore);
      assert.equal(service.requests.filter(memberRead).length-memberStart,3);
      assert.equal(service.writes.length,0);assert.ok(service.requests.every(request=>method(request)==="GET"));
      assert.equal(service.tokenCount.A+service.tokenCount.B,0);f.assertNoExternal();assert.deepEqual(f.transport.external,[]);
      t.diagnostic(JSON.stringify({changedAuthority,duringWhole,afterDenial,afterWhole,recovered,
        oldJsonCalls:old.jsonCalls,wholeJsonCalls:whole.jsonCalls,memberReads:3,
        finiteInvitationCommands:0,acknowledgments:0,actualInvitationsOrGrants:0,memberWrites:0,providers:0,
        sourceRetirement:changedAuthority?"actual Store after finite session epoch publication":"same original authority and Source",
        evidence:"actual full Settings/Store/current Projects Refresh and View access; finite GET-only HTTP, not Worker authority or browser"}));
    }finally{old?.release.resolve();whole?.release.resolve();await f.flush();}
    assert.equal(duringWhole.privateMemberVisible,!changedAuthority,
      "A read alone differs from actual authority retirement");
    const expected={privateMemberVisible:false,alerts:changedAuthority?[]:[f.i18n.t("workspace.admin.unavailable","This workspace is unavailable.")]};
    assert.deepEqual(afterDenial,expected,"Only completed exact-member proof may suppress same-owner denial");
    assert.deepEqual(afterWhole,expected,"A sibling collection cannot restore the denied exact member resource");
  });
