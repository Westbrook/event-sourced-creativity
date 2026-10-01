import {fixtureCode} from "./fixture-code.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

export const canvasQueueTurn=()=>new Promise(setImmediate);
export const canvasQueueDeferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

// Synthetic IndexedDB transport: request success precedes transaction commit;
// read/write transactions serialize, failed transactions roll back their writes.
// This is an event-order/atomicity port, not a browser storage/quota certificate.
export function canvasQueueDatabase(){
  const values=new Map(),requests=[],transactions=[],requestGates=[],commitGates=[],committingGates=[];
  let created=false,active=null,sequence=0,blockOpen=false,failWrite=null,abortCommit=null;
  const waiting=[];
  const next=()=>{if(active||!waiting.length)return;active=waiting.shift();active.start();};
  const gate=(list,predicate)=>{
    const entered=canvasQueueDeferred(),release=canvasQueueDeferred();
    const value={predicate,entered,release};list.push(value);
    return{entered:entered.promise,release:release.resolve,reject:release.reject};
  };
  const take=(list,value)=>{const index=list.findIndex(item=>item.predicate(value));return index<0?null:list.splice(index,1)[0];};
  const database={
    objectStoreNames:{contains:()=>created},createObjectStore(){created=true;},close(){},
    transaction(storeName,mode){
      assert.equal(storeName,"events");assert.ok(["readonly","readwrite"].includes(mode));
      const operations=[],record={id:++sequence,mode,operations:[],completed:false,aborted:false,phase:"waiting",abortAttempts:0,abortUnavailable:0};
      transactions.push(record);
      let state="waiting",working,processing=false,commitScheduled=false;
      const transaction={error:null};
      const finish=()=>{if(active?.transaction===transaction)active=null;next();};
      const abort=error=>{
        if(state==="complete"||state==="aborted")return;
        state="aborted";record.phase="aborted";record.aborted=true;transaction.error=error??new DOMException("Aborted","AbortError");
        queueMicrotask(()=>{transaction.onabort?.({target:transaction});finish();});
      };
      transaction.abort=()=>{record.abortAttempts+=1;if(state==="committing"||state==="complete"||state==="aborted"){record.abortUnavailable+=1;throw new DOMException("Commit is no longer abortable","InvalidStateError");}abort();};
      const commit=async()=>{
        commitScheduled=false;if(state!=="active"||processing||operations.length)return;
        record.phase="abortable-pending";
        const pause=take(commitGates,record);
        if(pause){pause.entered.resolve(record);try{await pause.release.promise;}catch(error){abort(error);return;}}
        if(state==="aborted")return;
        if(abortCommit){const error=abortCommit;abortCommit=null;abort(error);return;}
        state="committing";record.phase="committing";const committing=take(committingGates,record);
        if(committing){committing.entered.resolve(record);try{await committing.release.promise;}catch(error){abort(error);return;}}
        if(mode==="readwrite"){values.clear();for(const[id,value]of working)values.set(id,structuredClone(value));}
        state="complete";record.phase="committed";record.completed=true;transaction.oncomplete?.({target:transaction});finish();
      };
      const advance=()=>{
        if(state!=="active"||processing)return;
        if(!operations.length){if(!commitScheduled){commitScheduled=true;setImmediate(()=>void commit());}return;}
        processing=true;
        const {request,method,key,value}=operations.shift(),detail={transaction:record,method,key,value};
        record.operations.push({method,key,value:structuredClone(value)});
        setImmediate(async()=>{
          try{
            if(state==="aborted")return;
            if(mode!=="readwrite"&&["put","delete"].includes(method))throw new DOMException("Read only","ReadOnlyError");
            if(method==="put"&&failWrite){const error=failWrite;failWrite=null;throw error;}
            if(method==="getAll")request.result=[...working.values()].map(value=>structuredClone(value));
            else if(method==="get")request.result=structuredClone(working.get(key));
            else if(method==="put"){working.set(value.id,structuredClone(value));request.result=value.id;}
            else if(method==="delete")working.delete(key);
            const pause=take(requestGates,detail);
            if(pause){pause.entered.resolve(detail);await pause.release.promise;}
            if(state==="aborted")return;
            request.onsuccess?.({target:request});
          }catch(error){request.error=error;request.onerror?.({target:request});abort(error);}
          finally{processing=false;advance();}
        });
      };
      const request=(method,key,value)=>{
        if(!["waiting","active"].includes(state))throw new DOMException("Inactive","TransactionInactiveError");
        const request={};requests.push({transaction:record.id,method,key,value:structuredClone(value)});
        operations.push({request,method,key,value:structuredClone(value)});advance();return request;
      };
      transaction.objectStore=()=>({
        getAll:()=>request("getAll"),get:key=>request("get",key),put:value=>request("put",undefined,value),delete:key=>request("delete",key),
      });
      waiting.push({transaction,start(){state="active";record.phase="request-processing";working=new Map([...values].map(([id,value])=>[id,structuredClone(value)]));advance();}});
      queueMicrotask(next);return transaction;
    },
  };
  const indexedDB={
    open(name,version){
      assert.equal(name,"canvas-offline-queue-v1");assert.equal(version,2);
      const request={result:database};
      setImmediate(()=>{if(blockOpen){blockOpen=false;request.onblocked?.({target:request});return;}if(!created)request.onupgradeneeded?.({target:request});request.onsuccess?.({target:request});});return request;
    },
  };
  return{
    values,requests,transactions,indexedDB,
    holdRequest:predicate=>gate(requestGates,predicate),
    // holdCommit pauses after request success while abort is still allowed.
    holdCommit:(predicate=()=>true)=>gate(commitGates,predicate),
    // Once committing begins, abort() throws: only actual terminal completion can release this gate.
    holdCommitting:(predicate=()=>true)=>gate(committingGates,predicate),
    failNextWrite(error=new DOMException("Synthetic quota","QuotaExceededError")){failWrite=error;},
    abortNextCommit(error=new DOMException("Synthetic abort","AbortError")){abortCommit=error;},
    blockNextOpen(){blockOpen=true;},
    install(t){const previous=Object.getOwnPropertyDescriptor(globalThis,"indexedDB");Object.defineProperty(globalThis,"indexedDB",{configurable:true,writable:true,value:indexedDB});t.after(()=>{if(previous)Object.defineProperty(globalThis,"indexedDB",previous);else delete globalThis.indexedDB;});},
  };
}

export function canvasLegacySourceOwnership(store){
  const source=fs.readFileSync(new URL("../../src/state/store.ts",import.meta.url),"utf8"),tree=ts.createSourceFile("store.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const owner=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaStore");
  const names=["#sourceGeneration","#sourceRetired","#sourceOwners","captureSourceOwnership","sourceOwnershipScopeActive","sourceOwnershipActive","#sourceDeadlineCurrent","#sourceExpiryValid","#planningRecoverySequence","captureAdaptiveProposalRead"];
  const members=names.map(name=>{const member=owner.members.find(node=>node.name?.getText(tree)===name);assert.ok(member,"actual Store source member "+name);return member.getText(tree);});
  // Legacy component tests retain their original mock authorization boundary,
  // but the new source ownership methods/brand are read byte-for-byte from Store.
  const code=fixtureCode("class SourceOwner { constructor(store){this.store=store;this.session=store.session;} captureAuthorizationScope(){return this.store.captureAuthorizationScope();} authorizationScopeActive(scope){return this.store.authorizationScopeActive(scope);} "+members.join("\n")+" }\nexports.SourceOwner=SourceOwner;",{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
  const exports={};new Function("exports",code)(exports);const sourceOwner=new exports.SourceOwner(store);
  for(const name of names.filter(name=>!name.startsWith("#")))store[name]=sourceOwner[name].bind(sourceOwner);
}
