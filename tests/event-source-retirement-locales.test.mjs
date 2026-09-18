import {test} from "node:test";
import assert from "node:assert/strict";
import {writeFixture} from "./helpers/event-source-retirement-fixture.mjs";
import {formaSystemMessageId} from "../src/components/design-system/system-message-id.ts";
import en from "../src/components/design-system/locales/system-en.ts";
import fr from "../src/components/design-system/locales/system-fr.ts";
import ar from "../src/components/design-system/locales/system-ar.ts";
import ja from "../src/components/design-system/locales/system-ja.ts";
const catalogs={en,fr,ar,ja},messages=["Too many original changes await confirmation. No new change was sent.","The server acknowledged the original change. Its private view is unavailable.","The original change is unconfirmed. It has not been resubmitted.","This invocation was not sent because the source is unavailable.","The original finished-output change is only partly acknowledged. It has not been repeated.","Only part of the original change is acknowledged. It has not been resubmitted."];
for(const locale of["en","fr","ar","ja"])test("actual Store neutral receipt notices use the "+locale+" system catalog",async t=>{
 const h=await writeFixture(t,{shared:false}),localization=h.modules.get("src/components/design-system/localization.ts"),catalog=catalogs[locale];
 // Locale selection is a native host port. The production Store formatter and
 // real shipped catalog are used; no source/authority/receipt result is replaced.
 t.mock.method(localization,"currentFormaLocale",()=>({locale,formatLocale:locale,direction:locale==="ar"?"rtl":"ltr",messages:catalog}));
 for(const source of messages){
  const id=formaSystemMessageId(source);assert.equal(typeof catalog[id],"string");assert.ok(catalog[id]);
  h.store.toast(source);assert.equal(h.store.ui.toast,catalog[id]);if(locale!=="en")assert.notEqual(h.store.ui.toast,source);
 }
 assert.equal(h.requests.filter(request=>request.init.method&&request.init.method!=="GET").length,0);
});
