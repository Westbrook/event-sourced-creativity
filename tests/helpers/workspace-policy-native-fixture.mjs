// Actual complete Settings/Store; finite nonfinancial HTTP and native DOM ports only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { noChange, nothing } from "lit";
import { settingsFixture, endpoint, method } from "./workspace-settings-whole-read-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
const { _$LH: litParts } = await import(pathToFileURL(createRequire(import.meta.resolve("lit")).resolve("lit-html/private-ssr-support.js")).href);
const MARKER="#saveRetention";
const A={transientDays:"31",evidenceDays:"366",revisionDays:"120",legalHold:false};
const B={transientDays:"42",evidenceDays:"400",revisionDays:"150",legalHold:false};
const C={transientDays:"55",evidenceDays:"500",revisionDays:"180",legalHold:false};
const command=values=>({transientDays:Number(values.transientDays),evidenceDays:Number(values.evidenceDays),revisionDays:Number(values.revisionDays),legalHold:values.legalHold});
const within=(node,parent)=>{for(let value=node.parent;value;value=value.parent)if(value===parent||parent.port&&value.port===parent.port)return true;return false;};


// Native DOM holds the previously committed form while the actual host renders.
// This test-only adapter extends the original six-case PropertyPart port: actual
// AttributePart resolves metadata/live/noChange, and actual repeat paths own forms.
function retentionNativeForm(f,{owner:nestedOwner}={}){
  const currentOwner=()=>nestedOwner?nestedOwner():f.host;
  let records=[],sequence=0,capturing=false,templates=[];const all=[],commits=[];
  const query=f.renderer.query.bind(f.renderer),renderValue=f.renderer.value.bind(f.renderer);
  f.renderer.value=(value,owner,at,caches)=>{
    if(capturing&&owner===currentOwner()&&value?.strings
      &&(value.strings.join("").includes("data-workspace-policy=")
        ||value.values.some(item=>typeof item==="function"&&item.toString().includes(MARKER))))
      templates.push({path:at,template:value});
    return renderValue(value,owner,at,caches);
  };
  f.renderer.query=(owner,selector)=>owner===currentOwner()&&selector==="form[data-workspace-policy]"
    ?records.filter(record=>record.form.isConnected&&record.form.hasAttribute("data-workspace-policy")).map(record=>record.form)
    :query(owner,selector);
  const disconnect=record=>{record.form.isConnected=false;record.form.parentElement=null;for(const item of record.fields.values())item.node.isConnected=false;};
  const previousDisconnect=f.disconnect;
  f.disconnect=()=>{for(const record of records)disconnect(record);records=[];return previousDisconnect();};
  const isPolicy=form=>Object.hasOwn(form.attributes,"data-workspace-policy")||String(form.handlers.submit).includes(MARKER);
  const descriptions=form=>f.tree().nodes.filter(node=>within(node,form)&&["input","select","textarea"].includes(node.tag)&&node.attributes.name);
  const sync=record=>f.forms.set(record.form,new Map([...record.fields].flatMap(([name,item])=>
    item.property==="checked"?(item.node.checked?[[name,"on"]]:[]):[[name,String(item.node.value)]])));
  f.draw=()=>{
    ports.bindFixture(f);if(!f.host.isConnected)return"";
    const native=new Set(records.flatMap(record=>[record.form,...[...record.fields.values()].map(item=>item.node)]));
    for(const node of f.renderer.nodes)if(!native.has(node))node.isConnected=false;
    f.requested=false;templates=[];capturing=true;let markup;
    try{markup=f.renderer.draw(f.host);}finally{capturing=false;}
    const owner=currentOwner(),freshForms=owner?f.renderer.ownNodes(owner,"form").filter(isPolicy):[],next=[];
    assert.equal(templates.length,freshForms.length,"Actual policy templates and native forms agree");
    for(const [index,fresh]of freshForms.entries()){
      const entry=templates[index],key=String(fresh.attributes["data-workspace-policy"]??"retention");
      let record=records.find(item=>item.owner===owner&&item.path===entry.path);
      if(!record){record={id:++sequence,form:fresh,owner,path:entry.path,key,fields:new Map(),attributes:new Map()};all.push(record);}
      else{for(const name of ["full","handlers","properties"])record.form[name]=fresh[name];f.renderer.nodes[f.renderer.nodes.indexOf(fresh)]=record.form;}
      record.key=key;record.form.isConnected=true;record.form.parentElement=owner;
      // Do not overwrite unbound native dirty metadata with a newly allocated
      // fixture attribute object. Run the actual bound AttributePart instead.
      for(const [name,value]of Object.entries(fresh.attributes)){
        let part=record.attributes.get(name);
        if(!part){part=new litParts.AttributePart(record.form,name,["",""],litParts.connectedDisconnectable({}),{host:owner});record.attributes.set(name,part);}
        const committed=litParts.getAttributePartCommittedValue(part,value);
        if(committed===nothing)record.form.removeAttribute(name);
        else if(committed!==noChange)record.form.setAttribute(name,String(committed??""));
      }
      // Commit the real mounted subtree even while hidden/inert. Public
      // current/fill/submit below still require visible eligible controls.
      const form=f.tree().nodes.find(node=>node.tag==="form"&&node.port===record.form);assert.ok(form);
      const fields=descriptions(form);
      assert.equal(new Set(fields.map(field=>field.attributes.name)).size,fields.length);
      if(key==="retention"||key==="pilot-retention")assert.deepEqual(fields.map(field=>field.attributes.name),["transientDays","evidenceDays","revisionDays","legalHold"]);
      for(const field of fields){
        const name=field.attributes.name,property=field.attributes.type==="checkbox"?"checked":"value";
        assert.ok(Object.hasOwn(field.properties,property),"A actual controlled property, including live/noChange, is emitted");
        let item=record.fields.get(name);
        if(!item){item={node:field.port,property,part:new litParts.PropertyPart(field.port,property,["",""],litParts.connectedDisconnectable({}),{host:owner})};record.fields.set(name,item);}
        else{for(const part of ["full","handlers","attributes","properties"])item.node[part]=field.port[part];item.node.disabled=field.port.disabled;f.renderer.nodes[f.renderer.nodes.indexOf(field.port)]=item.node;}
        item.description=field;item.node.isConnected=true;item.node.parentElement=record.form;
        const committed=litParts.getAttributePartCommittedValue(item.part,field.properties[property]);
        if(committed!==noChange){const previous=item.node[property];item.node[property]=property==="checked"?Boolean(committed):String(committed??"");commits.push({form:record.id,name,property,previous,value:item.node[property]});}
      }
      record.form.elements={namedItem:name=>record.fields.get(name)?.node??null};
      // Native parentage, not a private application hook: Discard's current
      // button walks through its shared Cluster to this exact form.
      for(const button of f.tree().nodes.filter(node=>node.tag==="button"&&within(node,form))){
        assert.ok(button.port,"The authored native policy action has its actual host-owned port");
        let child=button.port;
        for(let parent=button.parent;parent;parent=parent.parent){
          const element=parent.port===record.form?record.form:parent.component??parent.port;
          assert.ok(element,"The actual action-to-form ancestor is represented");
          child.parentElement=element;
          if(element===record.form)break;
          child=element;
        }
      }
      sync(record);next.push(record);
    }
    for(const record of records)if(!next.includes(record))disconnect(record);
    records=next;return markup;
  };
  const record=(key="retention")=>{const found=records.filter(item=>item.key===key);assert.equal(found.length,1,"One current native policy form for "+key);return found[0];};
  const current=(key="retention")=>{f.draw();const chosen=record(key),nodes=f.tree().visible("form").filter(node=>node.port===chosen.form);assert.equal(nodes.length,1);return nodes[0];};
  const enabled=field=>{
    if(!field.port?.isConnected||field.hiddenBy||Object.hasOwn(field.attributes,"disabled")||field.properties.disabled===true||field.port.disabled)return false;
    if(Object.hasOwn(field.attributes,"readonly")||field.properties.readOnly===true)return false;
    for(let parent=field;parent;parent=parent.parent)if(Object.hasOwn(parent.attributes??{},"inert")||parent.tag==="fieldset"&&Object.hasOwn(parent.attributes,"disabled"))return false;
    return true;
  };
  const eligibility=(key="retention")=>descriptions(current(key)).map(field=>({name:field.attributes.name,enabled:enabled(field)}));
  const values=(key="retention")=>Object.fromEntries([...record(key).fields].map(([name,item])=>[name,item.property==="checked"?Boolean(item.node.checked):String(item.node.value)]));
  const fill=(input,key="retention")=>{
    const form=current(key),chosen=record(key),fields=descriptions(form);
    assert.deepEqual(fields.map(field=>field.attributes.name).sort(),Object.keys(input).sort());
    for(const field of fields){
      assert.ok(enabled(field),"Only a genuinely enabled visible native field may receive later input");
      const item=chosen.fields.get(field.attributes.name),value=input[field.attributes.name];
      if(item.property==="checked")item.node.checked=Boolean(value);
      else{
        if(field.tag==="select")assert.ok(f.tree().nodes.some(option=>option.tag==="option"&&within(option,field)&&String(option.attributes.value??option.text)===String(value)&&!Object.hasOwn(option.attributes,"disabled")));
        if(field.attributes.type==="number"){if(Object.hasOwn(field.attributes,"min"))assert.ok(Number(value)>=Number(field.attributes.min));if(Object.hasOwn(field.attributes,"max"))assert.ok(Number(value)<=Number(field.attributes.max));}
        item.node.value=String(value);
      }
      const eventName=item.property==="checked"||field.tag==="select"?"change":"input";
      item.node.handlers[eventName]?.call(field.owner,{type:eventName,target:item.node,currentTarget:item.node,preventDefault(){},stopPropagation(){}});
    }
    sync(chosen);return form;
  };
  const button=form=>{const buttons=f.tree().visible("button").filter(node=>within(node,form)&&node.attributes.type==="submit");assert.equal(buttons.length,1);return buttons[0];};
  const submit=(key="retention")=>{const form=current(key),control=button(form);assert.equal(Object.hasOwn(control.attributes,"disabled"),false);assert.ok(eligibility(key).every(item=>item.enabled));return f.submit(form,Object.fromEntries(f.forms.get(form.port)));};
  const discard=(key="retention")=>{const form=current(key),buttons=f.tree().visible("button").filter(node=>within(node,form)&&String(node.handlers.click).includes("#discardPolicy"));assert.equal(buttons.length,1);return f.click(buttons[0]);};
  return{current,fill,values,eligibility,button,submit,discard,all,commits,record,records:()=>[...records]};
}

async function setup(t,{locale="en"}={}){
  const f=await settingsFixture(t,{locale}),service=f.service,reply=service.reply;
  let policy={transient_days:30,evidence_days:365,revision_days:90,legal_hold:0,version:1,updated_at:"2026-08-30T12:00:00.000Z"};
  const target=endpoint("A","/retention");
  service.reply=request=>{
    if(method(request)==="PATCH"){
      assert.equal(request.url,target,"Only the one finite nonfinancial retention endpoint is permitted");
      assert.deepEqual(request.body,command(A),"Only the originally submitted A is delivered");
      assert.equal(request.body.legalHold,false,"No legal hold is activated, even in the finite service");
      policy={...policy,transient_days:request.body.transientDays,evidence_days:request.body.evidenceDays,
        revision_days:request.body.revisionDays,legal_hold:0,version:policy.version+1};
      const receipt={policy:structuredClone(policy),appliesTo:"new-scoped-content-only"};
      service.writes.push({method:"PATCH",url:target,body:structuredClone(request.body),receipt:structuredClone(receipt)});
      return{status:200,body:receipt};
    }
    assert.equal(method(request),"GET","No token, hold, budget, generation, organization or other mutation");
    const value=reply(request);
    if(request.url===target&&value.status===200)value.body.policy=structuredClone(policy);
    return value;
  };
  const native=retentionNativeForm(f);native.current();
  const snapshot=()=>structuredClone({events:f.store.events.get(),content:f.store.content.get(),head:f.store.head.get(),
    budgets:f.store.session.get().budgets,costBudgets:f.store.session.get().costBudgets,
    credentials:service.credentials,tokenCount:service.tokenCount});
  assert.equal(service.writes.length,0);
  return{f,service,native,target,policy:()=>structuredClone(policy),snapshot};
}
const notice=f=>f.nodes("p").find(node=>node.attributes.role==="status"&&String(node.attributes.class).includes("workspace-settings-notice"))?.text??"";
const saved=f=>f.i18n.system("Future project content will follow the updated retention periods.");

export { setup, retentionNativeForm, within, A, B, C, command, notice, saved, endpoint, method };
