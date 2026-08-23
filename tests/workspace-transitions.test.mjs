import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workspaceTransitionAuthorized } from "../src/platform/workspace-transitions.ts";

test("workspace handoffs require fresh identity, Canvas eligibility, and exact project custody",()=>{
  const current={user:{userId:"creator-a"},canvas:{access:true}};
  assert.equal(workspaceTransitionAuthorized(current,{...current,canvas:{access:true}},"canvas"),true);
  assert.equal(workspaceTransitionAuthorized(current,{...current,canvas:{access:false}},"canvas"),false,"revoked Canvas access fails closed");
  assert.equal(workspaceTransitionAuthorized(current,{user:{userId:"creator-b"},canvas:{access:true}},"canvas"),false,"another account never inherits a stale session");
  assert.equal(workspaceTransitionAuthorized(current,{...current,projectContext:{organizationId:"org-a",projectAccessId:"project-a"}},"canvas"),false,"shared projects do not silently gain Canvas");
  assert.equal(workspaceTransitionAuthorized(current,{...current,canvas:{access:false}},"creative"),true,"leaving a revoked Canvas remains possible");
  const scoped={...current,projectContext:{organizationId:"org-a",projectAccessId:"project-a"}};
  assert.equal(workspaceTransitionAuthorized(scoped,{...scoped,projectContext:{organizationId:"org-b",projectAccessId:"project-a"}},"creative"),false);
  assert.equal(workspaceTransitionAuthorized(scoped,{...scoped,projectContext:{organizationId:"org-a",projectAccessId:"project-b"}},"creative"),false);
  assert.equal(workspaceTransitionAuthorized(scoped,current,"creative"),false,"scope cannot disappear during a handoff");
  assert.equal(workspaceTransitionAuthorized(null,current,"canvas"),false);
  assert.equal(workspaceTransitionAuthorized(current,current,"operations"),false);
});

test("all client-routed cross-workspace navigation revalidates on the server before history changes",async()=>{
  const store=await readFile(new URL("../src/state/store.ts",import.meta.url),"utf8");
  const shell=await readFile(new URL("../src/components/forma-shell.ts",import.meta.url),"utf8");
  assert.match(store,/if\(current!==destination\)\{[\s\S]*?void this\.transitionWorkspace\(path,options\)/);
  assert.match(store,/fetch\(`\/api\/session\?audience=\$\{encodeURIComponent\(destination\)\}`/);
  assert.match(store,/if\(!workspaceTransitionAuthorized\(previous,current,destination\)\)/);
  assert.match(store,/workspaceTransitionAuthorized\(previous,current,destination\)[\s\S]*?this\.#commitRoute\(path,options\)/);
  assert.doesNotMatch(shell,/current==="creative"&&next==="canvas"/);
});
