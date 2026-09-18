// The three original actual-parent regression oracle bodies are byte-for-byte
// preserved from the frozen read-reparent proof; the saved checker owns physical pins.
import assert from "node:assert/strict";
import test from "node:test";
import { activitySetup, holdEditReply, FormaActivity, FormaActivityIssuePanel, tick, financialTables, aText, bText } from "./helpers/activity-correction-group-fixture.mjs";

for (const [name, markRead, newer] of [
  ["healthy original A then explicit B without regrouping", false, true],
  ["Mark as read must not discard newer unsaved B when Activity regroups", true, true],
  ["healthy Mark as read after unchanged submitted A", true, false],
]) test(name, async t => {
  let releaseOriginal; t.after(() => releaseOriginal?.resolve());
  const p = await activitySetup(t), f = p.f;
  const finance = () => Object.fromEntries(financialTables.map(table => [table,
    p.state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const beforeFinance = finance();
  // Reuse the two explicit scoped notification seeds; they are not a claim that
  // a reviewer requested changes. All current actions below use real Store/Worker.
  f.host.disconnectedCallback(); f.host.isConnected = false;
  f.host = new FormaActivity(); f.host.store = p.h.store; f.host.i18n = f.i18n;
  f.host.tag = "forma-activity"; f.host.isConnected = true;
  f.renderer.registry["forma-activity-issue-panel"] = FormaActivityIssuePanel;
  p.h.store.route.set("/activity?document=" + p.state.documentId); f.draw();
  const panel = () => [...f.renderer.instances.values()].map(row => row.instance)
    .find(instance => instance.isConnected && instance.notification?.id === p.ids[0]);
  const own = tag => f.renderer.ownNodes(panel(), tag);
  const editor = () => own("textarea").find(node => node.attributes.rows === "8");
  const activate = node => {
    assert.ok(node?.isConnected && f.renderer.nodes.includes(node), "only a current connected control");
    assert.equal(Object.hasOwn(node.attributes, "disabled"), false); node.click();
  };
  activate(own("button").find(node => node.handlers.click?.toString().includes("#startCorrection")));
  for (let turn=0;turn<40&&!editor();turn++){await tick();f.draw();}
  assert.ok(editor(), "the real correction editor opens");
  const originalPanel=panel();
  const type=value=>{
    const field=editor();assert.ok(field?.isConnected&&f.renderer.nodes.includes(field));
    assert.equal(Object.hasOwn(field.attributes,"disabled"),false);assert.equal(Object.hasOwn(field.attributes,"readonly"),false);
    field.value=value;field.handlers.input.call(panel(),{target:field,currentTarget:field});f.draw();
  };
  const save=()=>{
    const form=own("form").find(node=>node.handlers.submit?.toString().includes("#saveCorrection"));
    const button=own("button").find(node=>node.attributes.type==="submit");
    assert.ok(form?.isConnected&&f.renderer.nodes.includes(form));assert.ok(button?.isConnected);
    assert.equal(Object.hasOwn(button.attributes,"disabled"),false);
    form.handlers.submit.call(panel(),{target:form,currentTarget:form,preventDefault(){}});
  };
  type(aText);const held=holdEditReply(p);releaseOriginal=held.release;save();
  const actualA=await held.entered.promise;assert.equal(actualA.status,200);assert.equal(actualA.body.revision,1);
  assert.deepEqual(actualA.body.appended.map(event=>event.type),["DocumentArtifactEdited"]);
  if(newer)type(bText);
  const before={sameConnectedChild:panel()===originalPanel,editor:editor()?.value??null,readAt:panel().notification.readAt};
  let refresh=null;
  if(markRead){
    // The existing renderer's native node metadata identifies the exact card.
    // No handler is called after detachment and no UI permission is invented.
    const childNode=f.renderer.ownNodes(f.host,"forma-activity-issue-panel")
      .find(node=>node.properties.notification?.id===p.ids[0]);
    assert.ok(childNode);
    const childAt=f.renderer.markup.indexOf(childNode.full);
    const cardStart=f.renderer.markup.lastIndexOf("<article",childAt),cardEnd=f.renderer.markup.indexOf("</article>",childAt);
    assert.ok(cardStart>=0&&cardEnd>childAt);
    const mark=f.renderer.ownNodes(f.host,"button").find(node=>{
      if(!node.handlers.click?.toString().includes("acknowledgeProjectNotification"))return false;
      const at=f.renderer.markup.indexOf(node.full,cardStart);return at>=cardStart&&at<cardEnd;
    });
    assert.ok(mark,"the exact existing card's Mark as read button");
    activate(mark);
    const acknowledgment=p.acknowledgments[0];assert.equal(acknowledgment.id,p.ids[0]);
    assert.equal(await acknowledgment.pending,true);
    const readStart=p.h.requests.length;await p.h.store.syncProjectNotifications();
    const reads=p.h.requests.slice(readStart).filter(row=>row.url==="/api/project-notifications"&&(row.init.method??"GET")==="GET");
    assert.equal(reads.length,1,"actual canonical current notification GET");
    f.draw();
    refresh={actualMarkReadId:acknowledgment.id,actualGetCount:reads.length,
      sameConnectedChild:panel()===originalPanel,originalConnected:originalPanel.isConnected,
      currentSameIdChildPresent:Boolean(panel()),currentReadAt:panel()?.notification?.readAt??null,
      currentEditor:editor()?.value??null};
    assert.equal(typeof refresh.currentReadAt,"string");
  }
  held.release.resolve();assert.equal(await p.calls[0].pending,true);await tick();f.draw();
  const afterA={sameConnectedChild:panel()===originalPanel,originalConnected:originalPanel.isConnected,
    currentSameIdChildPresent:Boolean(panel()),editor:editor()?.value??null,
    originalReceiptRetained:JSON.parse(p.data().content).content_markdown===aText};
  let explicitB=null;
  if(!markRead&&newer){
    assert.equal(editor()?.value,bText);save();assert.equal(await p.calls[1].pending,true);
    for(const ack of p.acknowledgments)assert.equal(await ack.pending,true);
    await tick();f.draw();
    explicitB={expectedRevision:p.calls[1].args[1].expectedRevision,retainedMarkdown:JSON.parse(p.data().content).content_markdown};
    assert.equal(explicitB.expectedRevision,1);assert.equal(explicitB.retainedMarkdown,bText);
  }
  const rows=p.state.sqlite.prepare("SELECT notification_id,read_at FROM project_notifications WHERE notification_id IN (?,?)").all(...p.ids);
  assert.equal(rows.find(row=>row.notification_id===p.ids[1]).read_at,null);
  assert.deepEqual(finance(),beforeFinance);
  const edits=p.state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactEdited'").get().n;
  assert.equal(edits,!markRead&&newer?2:1);
  assert.equal(p.calls.length,!markRead&&newer?2:1,"no automatic save or retry");
  assert.equal(p.acknowledgments.length,1);assert.equal(p.acknowledgments[0].id,p.ids[0]);
  assert.ok(p.mutations().every(row=>row.init.method==="PATCH"
    &&["/api/artifacts/saved-scene-story","/api/project-notifications"].includes(row.url)));
  t.diagnostic(JSON.stringify({name,markRead,newer,before,refresh,afterA,explicitB,actualA:{status:actualA.status,revision:actualA.body.revision},
    editEvents:edits,saveCalls:p.calls.length,acknowledgedIds:p.acknowledgments.map(row=>row.id),
    mutations:p.mutations().map(row=>({method:row.init.method,url:row.url})),
    financialRowsUnchanged:true,externalProviderCalls:0,physicalNativeOrATClaim:false}));
  if(markRead&&newer){
    assert.ok(afterA.originalReceiptRetained,"the genuine original A commit is preserved");
    assert.equal(afterA.editor,bText,"Mark as read is not permission to discard the accepted newer unsaved draft");
  }else if(markRead){
    assert.ok(afterA.originalReceiptRetained);assert.equal(afterA.editor,null,"no newer draft was lost in this control");
  }
});
