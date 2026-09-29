import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Exercise the current host-owned await/catch and ownership predicates. These
// controlled navigation failures are not a completed media/result fixture.
const source=readFileSync(new URL("../src/components/forma-experience-host.ts",import.meta.url),"utf8");
const method=source.slice(source.indexOf("  async #navigate("),source.indexOf("  async #edit("));
assert(method.includes("await action()"));
const body=method.slice(method.indexOf("{")+1,method.lastIndexOf("}")).replaceAll("this.#","host.").replaceAll("this.","host.");
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const navigate=new AsyncFunction("action","host",body);
function fixture(){
  const source={},authorization={},binding={},state={source:true,authorization:true,departure:true,readable:true};
  const host={navigationEpoch:0,binding,status:"1 image",updates:0,
    store:{captureSourceOwnership:()=>source,captureAuthorizationScope:()=>authorization,
      sourceOwnershipActive:value=>value===source&&state.source,authorizationScopeActive:value=>value===authorization&&state.authorization},
    captureCommandDeparture:()=>({current:()=>state.departure}),
    readable:value=>value===binding&&state.readable,i18n:{system:value=>value},requestUpdate:()=>host.updates++};
  return {host,state};
}
for(const [name,action]of [["setup throw",()=>{throw Error("setup");}],["cleanup rejection",()=>Promise.reject(Error("cleanup"))],["undefined rejection",()=>Promise.reject(undefined)]]){
  test("owns "+name+" without leaking a rejection",async()=>{
    const {host}=fixture();await assert.doesNotReject(navigate(action,host));
    assert.equal(host.status,"Navigation unavailable");assert.equal(host.updates,1);
  });
}
for(const value of [true,false,undefined]){
  test("preserves Shell fulfilled/refused outcome "+String(value),async()=>{
    const {host}=fixture();await navigate(async()=>value,host);assert.equal(host.status,"1 image");assert.equal(host.updates,0);
  });
}
for(const [name,retire]of [
  ["newer host operation",({host})=>host.navigationEpoch++],
  ["newer navigation",({host})=>host.navigationEpoch++],
  ["different Store",({host})=>host.store={...host.store}],
  ["new binding",({host})=>host.binding={}],
  ["departure retired",({state})=>state.departure=false],
  ["away and back source",({state})=>state.source=false],
  ["authorization withdrawn",({state})=>state.authorization=false],
  ["host hidden or disconnected",({state})=>state.readable=false]
]){
  test("late rejection cannot overwrite "+name,async()=>{
    const f=fixture();let reject;const pending=new Promise((_,r)=>reject=r);
    const finished=navigate(()=>pending,f.host);retire(f);f.host.status="Newer work";reject(Error("late"));
    await assert.doesNotReject(finished);assert.equal(f.host.status,"Newer work");assert.equal(f.host.updates,0);
  });
}
test("both real navigation handlers use the owned wrapper",()=>{
  assert(source.includes('@click=${() => { if (!this.#busy) void this.#navigate(() => this.#edit()); }}'));
  assert(source.includes('@click=${() => { if (!this.#busy && !this.#loading) void this.#navigate(() => this.#exit()); }}'));
  const begin=source.slice(source.indexOf("  #beginOperation()"),source.indexOf("  #operationCurrent("));
  assert(begin.includes("this.#navigationEpoch++"));
  const visibility=source.slice(source.indexOf("  #visibility ="),source.indexOf("  #pagehide ="));
  assert(visibility.includes("this.#navigationEpoch++"));
});
test("failed ownership capture does not start navigation or leak rejection",async()=>{
  const {host}=fixture();host.store.captureSourceOwnership=()=>{throw Error("capture");};let started=false;
  await assert.doesNotReject(navigate(async()=>{started=true;},host));assert.equal(started,false);assert.equal(host.updates,0);
});
test("failed ownership recheck does not mutate UI or leak rejection",async()=>{
  const {host}=fixture();host.store.sourceOwnershipActive=()=>{throw Error("recheck");};
  await assert.doesNotReject(navigate(()=>Promise.reject(undefined),host));assert.equal(host.updates,0);assert.equal(host.status,"1 image");
});
test("retire and pagehide invalidate pending navigation",()=>{
  const retire=source.slice(source.indexOf("  #retire()"),source.indexOf("  #baseCurrent("));
  assert(retire.includes("this.#navigationEpoch++"));
  const pagehide=source.slice(source.indexOf("  #pagehide ="),source.indexOf("  #retire()"));
  assert(pagehide.includes("this.#retire()"));
});
