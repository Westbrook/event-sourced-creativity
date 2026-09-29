// E task separation + approved read-only Refresh. Actual complete Settings,
// Store, current controls and installed Lit parts; finite nonfinancial HTTP.
// No browser, Worker authority, policy activation, financial or provider claim.
import assert from "node:assert/strict";
import test from "node:test";
import { setup, A, B, endpoint, method } from "./helpers/workspace-policy-native-fixture.mjs";
import { settingsFixture } from "./helpers/workspace-settings-whole-read-fixture.mjs";
import { fixture as selectionFixture } from "./helpers/workspace-settings-grant-selection-fixture.mjs";

const options={concurrency:false,timeout:30000};
const refreshes=f=>f.nodes("button").filter(node=>Object.hasOwn(node.attributes,"data-workspace-settings-refresh"));
const refresh=f=>{const found=refreshes(f);assert.equal(found.length,1,"One visible current-task Refresh");return found[0];};
const retry=f=>{const found=f.nodes("button").filter(node=>String(node.handlers.click).includes("this.#load()"));assert.equal(found.length,1,"One current unavailable Retry");return found[0];};
const disabled=node=>Object.hasOwn(node.attributes,"disabled");
const snapshot=f=>structuredClone({route:f.store.route.get(),session:f.store.session.get(),events:f.store.events.get(),
  head:f.store.head.get(),content:f.store.content.get(),credentials:f.service.credentials,tokens:f.service.tokenCount});
function readOnly(f,start){
  const calls=f.service.requests.slice(start);assert.ok(calls.length>0);
  assert.ok(calls.every(request=>method(request)==="GET"));
  assert.equal(calls[0].url,"/api/workspaces");
  assert.equal(f.service.writes.length,0);assert.equal(f.service.pending,0);
  f.assertNoExternal();assert.deepEqual(f.transport.external,[]);
}

for(const locale of ["en","fr","ar","ja"])test("E current Members Refresh keeps native raw work and later focus "+locale,options,async t=>{
  const {f,service,native}=await setup(t,{locale,section:"members",nativeKey:"security"});
  const defaults=native.values("security"),later={...defaults,allowedDomains:"unsent-"+locale+".example.invalid",maxSessionMinutes:"75"};
  const form=native.fill(later,"security").port,before=snapshot(f),start=service.requests.length;
  const button=refresh(f);assert.equal(button.text,f.i18n.system("Refresh"));assert.equal(disabled(button),false);
  const gate=service.queue(request=>method(request)==="GET"&&request.url==="/api/workspaces","body");
  f.click(button);
  try{
    await gate.seen.promise;await f.flush(8);
    assert.equal(disabled(refresh(f)),true,"No second current load is admitted while one is pending");
    assert.equal(native.current("security").port,form);assert.deepEqual(native.values("security"),later);
    // A genuine newer focus choice while the current response is pending.
    const field=native.record("security").fields.get("allowedDomains").node;
    field.focus();const focusCount=f.focusCalls.length;
    gate.release.resolve();await f.flush(24);
    assert.equal(f.doc.activeElement,field);assert.equal(f.focusCalls.length,focusCount,"Refresh adds no deferred focus");
  }finally{gate.release.resolve();await f.flush(12);}
  assert.equal(native.current("security").port,form);assert.deepEqual(native.values("security"),later);
  assert.equal(disabled(refresh(f)),false);assert.deepEqual(snapshot(f),before);readOnly(f,start);
});

test("E ordinary Usage Refresh preserves the actual normal-retention draft",options,async t=>{
  const {f,service,native}=await setup(t),form=native.fill(B).port,before=snapshot(f),start=service.requests.length;
  assert.match(f.store.route.get(),/\/usage$/u);f.click(refresh(f));await f.flush(24);
  assert.equal(native.current().port,form);assert.deepEqual(native.values(),B);assert.deepEqual(snapshot(f),before);readOnly(f,start);
});

for(const section of ["overview","projects","activity"])test("E authorized "+section+" has one explicit read-only Refresh",options,async t=>{
  const f=await settingsFixture(t,{section:"projects"});
  if(section!=="projects"){f.navigate("A",section);await f.flush(24);}
  const before=snapshot(f),start=f.service.requests.length;
  f.click(refresh(f));await f.flush(24);
  assert.deepEqual(snapshot(f),before);assert.equal(disabled(refresh(f)),false);readOnly(f,start);
});

test("E unavailable Settings uses only existing Retry and restores the same native draft",options,async t=>{
  const {f,service,native}=await setup(t,{section:"members",nativeKey:"security"});
  const later={...native.values("security"),allowedDomains:"retained-unavailable.example.invalid",maxSessionMinutes:"75"};
  const form=native.fill(later,"security").port,before=snapshot(f),start=service.requests.length;
  const gate=service.queue(request=>method(request)==="GET"&&request.url===endpoint("A","/security"),"body",
    {status:503,body:{error:"finite_settings_read_unavailable"}});
  f.click(refresh(f));try{await gate.seen.promise;}finally{gate.release.resolve();await f.flush(24);}
  assert.equal(refreshes(f).length,0,"The healthy action is not presented within the inactive subtree");
  assert.equal(form.isConnected,true);assert.deepEqual(native.values("security"),later);
  const record=f.tree().nodes.find(node=>node.tag==="form"&&node.port===form);assert.ok(record?.hiddenBy);
  let inert=false;for(let node=record;node;node=node.parent)inert ||= Object.hasOwn(node.attributes??{},"inert");
  assert.equal(inert,true);assert.equal(disabled(retry(f)),false);
  f.click(retry(f));await f.flush(24);
  assert.equal(native.current("security").port,form);assert.deepEqual(native.values("security"),later);
  assert.equal(refreshes(f).length,1);assert.deepEqual(snapshot(f),before);readOnly(f,start);
});

test("E Refresh is unavailable during an existing positive policy command, then returns",options,async t=>{
  const {f,service,native,target}=await setup(t),before=snapshot(f);
  native.fill(A);
  const gate=service.queue(request=>method(request)==="PATCH"&&request.url===target,"headers");
  native.submit();
  try{await gate.seen.promise;await f.flush(8);assert.equal(disabled(refresh(f)),true);}
  finally{gate.release.resolve();await f.flush(24);}
  assert.equal(disabled(refresh(f)),false);
  assert.deepEqual(service.writes.map(write=>({method:write.method,url:write.url})),[{method:"PATCH",url:target}]);
  const cursor=service.requests.length;f.click(refresh(f));await f.flush(24);
  assert.ok(service.requests.slice(cursor).every(request=>method(request)==="GET"));assert.equal(service.writes.length,1);
  assert.deepEqual(snapshot(f),before);assert.deepEqual(native.values(),A);f.assertNoExternal();
});

test("E an actual pending Transfer confirmation disables Refresh; Cancel restores it without a command",options,async t=>{
  const {f,service,members,native}=await selectionFixture(t,"ja",{section:"members",memberRole:"administrator",
    selection:{formHandler:"#confirmOwnershipTransfer",fieldName:"targetUserId",roleField:false,allowNoPlaceholder:true}});
  native.choose(members.C.user_id);const record=native.current(),before=snapshot(f);
  const form=f.find("form",node=>node.port===record.form&&String(node.handlers.submit).includes("#confirmOwnershipTransfer"));
  f.submit(form,Object.fromEntries(new FormData(record.form).entries()));await f.flush(2);
  assert.ok(f.dialog());
  const action=f.tree().nodes.filter(node=>node.tag==="button"&&Object.hasOwn(node.attributes,"data-workspace-settings-refresh"));
  assert.equal(action.length,1);assert.equal(disabled(action[0]),true);
  assert.equal(service.writes.length,0);
  f.cancel();await f.flush(12);
  assert.equal(f.dialog(),null);assert.equal(disabled(refresh(f)),false);
  assert.deepEqual(snapshot(f),before);assert.equal(service.writes.length,0);
  assert.ok(service.requests.every(request=>method(request)==="GET"));f.assertNoExternal();
});

for(const boundary of ["resource-ABA","disconnect","principal"])test("E retired Refresh handler is refused at "+boundary+" (defensive delivery contract)",options,async t=>{
  const f=await settingsFixture(t,{section:"members"}),old=refresh(f);
  if(boundary==="resource-ABA"){f.navigate("B","members");await f.flush(24);f.navigate("A","members");await f.flush(24);}
  else if(boundary==="disconnect"){f.disconnect();f.reconnect();await f.flush(24);}
  else{await f.refreshAuthority({user:{...f.service.session.user,userId:"finite-new-refresh-principal"}});await f.flush(24);}
  const current=snapshot(f),start=f.service.requests.length;
  // This is an explicit stale-event delivery contract, not a user interaction
  // with a disconnected control or proof of a reachable production incident.
  old.handlers.click.call(old.owner,{target:old.port,currentTarget:old.port,preventDefault(){},stopPropagation(){}});
  await f.flush(12);
  assert.equal(f.service.requests.length,start);assert.deepEqual(snapshot(f),current);
  assert.equal(f.service.writes.length,0);f.assertNoExternal();
});

// E1 copy/state follow-up; append after the original 14 Refresh cases. Existing
// native policy and selection fixtures own all real controls and finite reads.
const e1RefreshHelpText = {
  en: "Refresh reads current settings; it does not save your edits.",
  fr: "L’actualisation recharge les paramètres actuels sans enregistrer vos modifications.",
  ar: "يجلب التحديث الإعدادات الحالية؛ ولا يحفظ تعديلاتك.",
  ja: "更新は現在の設定を読み込むだけで、編集内容は保存しません。",
};
function e1RefreshPresentation(f) {
  const tree = f.tree(), buttons = tree.nodes.filter(node => node.tag === "button" && Object.hasOwn(node.attributes, "data-workspace-settings-refresh"));
  assert.equal(buttons.length, 1);
  const button = buttons[0], help = tree.nodes.filter(node => node.attributes.id === "workspace-settings-refresh-help");
  const associated = button.attributes["aria-describedby"]?.split(/\s+/u).includes("workspace-settings-refresh-help") ?? false;
  return { label: button.text, helpCount: help.length, help: help[0]?.text ?? "", associated,
    ordinaryHelp: Boolean(help[0] && !Object.hasOwn(help[0].attributes, "role") && !Object.hasOwn(help[0].attributes, "aria-live")),
    grouped: Boolean(help[0] && buttons[0].parent?.tag === "forma-ui-cluster" && help[0].parent === buttons[0].parent) };
}
function e1ExpectedRefreshPresentation(f, locale, loading) {
  return { label: f.i18n.system(loading ? "Refreshing…" : "Refresh"), helpCount: 1, help: e1RefreshHelpText[locale],
    associated: true, ordinaryHelp: true, grouped: true };
}

for (const locale of ["en", "fr", "ar", "ja"]) test("E1 current-task Refresh explains its read and labels only the pending read " + locale, options, async t => {
  const { f, service, native } = await setup(t, { locale, section: "members", nativeKey: "security" });
  const raw = { ...native.values("security"), allowedDomains: "still-unsent-" + locale + ".example.invalid", maxSessionMinutes: "75" };
  const form = native.fill(raw, "security").port, before = snapshot(f), start = service.requests.length;
  const initial = e1RefreshPresentation(f), gate = service.queue(request => method(request) === "GET" && request.url === "/api/workspaces", "body");
  let pending;
  f.click(refresh(f));
  try {
    await gate.bodyStarted.promise; await f.flush(8);
    assert.equal(disabled(refresh(f)), true); assert.equal(native.current("security").port, form);
    assert.deepEqual(native.values("security"), raw); assert.deepEqual(snapshot(f), before);
    assert.equal(service.writes.length, 0); assert.equal(gate.used, true); assert.equal(gate.jsonCalls, 1);
    assert.equal(gate.request.url, "/api/workspaces", "The original collection body, not a generic busy count, is held");
    pending = e1RefreshPresentation(f);
    const field = native.record("security").fields.get("allowedDomains").node;
    field.focus(); const focusCount = f.focusCalls.length;
    gate.release.resolve(); await f.flush(24);
    assert.equal(f.doc.activeElement, field); assert.equal(f.focusCalls.length, focusCount);
  } finally { gate.release.resolve(); await f.flush(12); }
  const restored = e1RefreshPresentation(f);
  assert.equal(disabled(refresh(f)), false); assert.equal(native.current("security").port, form);
  assert.deepEqual(native.values("security"), raw); assert.deepEqual(snapshot(f), before); readOnly(f, start);
  // Missing help/loading wording is the final desired failure, not a shortcut
  // around raw native values, original financial fields or completed GET custody.
  assert.deepEqual({ initial, pending, restored }, { initial: e1ExpectedRefreshPresentation(f, locale, false),
    pending: e1ExpectedRefreshPresentation(f, locale, true), restored: e1ExpectedRefreshPresentation(f, locale, false) });
});

test("E1 disabled Refresh never calls an outstanding policy write a refresh", options, async t => {
  const { f, service, native, target } = await setup(t), before = snapshot(f);
  native.fill(A);
  const gate = service.queue(request => method(request) === "PATCH" && request.url === target, "headers");
  let heldLabel;
  native.submit();
  try {
    await gate.seen.promise; await f.flush(8); assert.equal(disabled(refresh(f)), true);
    assert.deepEqual(service.writes.map(write => ({ method: write.method, url: write.url })), [{ method: "PATCH", url: target }],
      "The finite service captures the original write at dispatch; its held headers are not yet a client acknowledgement");
    assert.equal(gate.jsonCalls, 0);
    heldLabel = refresh(f).text;
  } finally { gate.release.resolve(); await f.flush(24); }
  assert.equal(disabled(refresh(f)), false);
  assert.deepEqual(service.writes.map(write => ({ method: write.method, url: write.url })), [{ method: "PATCH", url: target }]);
  assert.deepEqual(snapshot(f), before); assert.deepEqual(native.values(), A); assert.equal(service.pending, 0);
  f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
  assert.equal(heldLabel, f.i18n.system("Refresh"), "Only #loading, not #busy, selects the read-in-progress label");
});

test("E1 a native confirmation disables Refresh without describing an unstarted read", options, async t => {
  const { f, service, members, native } = await selectionFixture(t, "ja", { section: "members", memberRole: "administrator",
    selection: { formHandler: "#confirmOwnershipTransfer", fieldName: "targetUserId", roleField: false, allowNoPlaceholder: true } });
  native.choose(members.C.user_id); const record = native.current(), before = snapshot(f), start = service.requests.length;
  const form = f.find("form", node => node.port === record.form && String(node.handlers.submit).includes("#confirmOwnershipTransfer"));
  f.submit(form, Object.fromEntries(new FormData(record.form).entries())); await f.flush(2);
  assert.ok(f.dialog());
  const button = f.tree().nodes.filter(node => node.tag === "button" && Object.hasOwn(node.attributes, "data-workspace-settings-refresh"));
  assert.equal(button.length, 1); assert.equal(disabled(button[0]), true); const heldLabel = button[0].text;
  assert.equal(service.writes.length, 0); assert.equal(service.requests.length, start);
  f.cancel(); await f.flush(12);
  assert.equal(f.dialog(), null); assert.equal(disabled(refresh(f)), false);
  assert.deepEqual(snapshot(f), before); assert.equal(service.writes.length, 0); assert.equal(service.pending, 0);
  assert.ok(service.requests.every(request => method(request) === "GET")); f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
  assert.equal(heldLabel, f.i18n.system("Refresh"), "The existing dialog is not a read or a successful save");
});
