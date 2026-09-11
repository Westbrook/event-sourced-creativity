import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { accountingResponse } from "../helpers/generation-accounting-fixture.mjs";
import { failedJob } from "../helpers/activity-receipt-focus-data.mjs";

// Never activated by the default suite against its unrelated shared fixture.
test.skip(process.env.FORMA_ACTIVITY_ACCOUNTING_LIFETIME!=="1","Owner-run isolated actual Activity lifetime regression only");
test("actual Activity parent rerender preserves pending/ready accounting but changed receipt retires it",async({page,context},testInfo)=>{
  const origin=testInfo.project.use.baseURL, path="/tests/activity-receipt-focus.fixture.html", entry=path+"?accounting-lifetime=1";
  const base=new URL(origin);
  expect(base.protocol).toBe("http:");expect(base.hostname).toBe("127.0.0.1");
  expect(base.port).not.toBe("4186");expect(base.port).not.toBe("");
  const detailURL=origin+"/api/document-jobs/job-1?inspection=1", accountingURL=origin+"/api/admin/generation-accounting?jobId=job-1";
  const record={detail:0,accounting:0,pending:0,totalRequests:0,dropped:0,forbidden:[],routeErrors:[],pageErrors:[],consoleErrors:[],newPages:0,downloads:0,fontRequests:0,closedDevSockets:0};
  const retainRecord=(list,value)=>{if(list.length<32)list.push(value);else record.dropped++;};
  let releaseAccounting;const accountingGate=new Promise(resolve=>{releaseAccounting=resolve;});
  const detail=failedJob();detail.moderationPromptRef="fixture-lifetime-prompt";
  const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
  // Reuse exact already-retained font bytes, not remote retrieval or substitute CSS.
  const cacheBytes=await readFile(new URL("./data/shared-reader-fonts.json",import.meta.url));
  expect(cacheBytes.length).toBe(74821);
  expect(digest(cacheBytes)).toBe("23c3ee19555b401e8d40f830ba8b1187cc3b6c22a016b940bce0a29c3044e84b");
  const cached=JSON.parse(cacheBytes.toString("utf8"));expect(cached.responses).toHaveLength(4);
  const fonts=new Map(cached.responses.map(row=>{const body=Buffer.from(row.bodyBase64,"base64");
    expect(body.length).toBe(row.bytes);expect(digest(body)).toBe(row.sha256);return[row.url,{...row,body}];}));
  page.on("pageerror",error=>retainRecord(record.pageErrors,String(error).slice(0,1000)));
  page.on("console",message=>{if(message.type()==="error")retainRecord(record.consoleErrors,{text:message.text().slice(0,1200),location:message.location()});});
  page.on("download",()=>record.downloads++);context.on("page",opened=>{if(opened!==page)record.newPages++;});
  await context.routeWebSocket("**/*",async socket=>{
    record.closedDevSockets++;
    retainRecord(record.forbidden,{transport:"websocket",url:socket.url()});
    try{await socket.close({code:1000,reason:"Isolated fixture prevents sockets"});}
    catch(error){retainRecord(record.routeErrors,String(error).slice(0,1000));}
  });
  await context.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url());record.pending++;
    try{
      if(++record.totalRequests>256)throw new Error("Total request cap");
      if(request.frame()!==page.mainFrame())throw new Error("Unadmitted frame");
      if(request.method()==="GET"&&(url.href===detailURL||url.href===accountingURL)){
        if(url.href===detailURL){if(++record.detail>1)throw new Error("Duplicate detail read");}
        else {if(++record.accounting>1)throw new Error("Duplicate accounting read");await accountingGate;}
        await route.fulfill({status:200,contentType:"application/json",headers:{"cache-control":"private, no-store"},
          body:JSON.stringify(url.href===detailURL?{job:detail}:accountingResponse())});return;
      }
      const font=fonts.get(url.href);
      if(font&&request.method()==="GET"&&request.resourceType()===font.resourceType){
        if(++record.fontRequests>16)throw new Error("Font request cap");
        await route.fulfill({status:200,headers:{"content-type":font.contentType,"access-control-allow-origin":"*","cache-control":"no-store"},body:font.body});return;
      }
      const staticPath=url.href===origin+entry||url.pathname.startsWith("/assets/")&&!url.search;
      if(url.origin===origin&&request.method()==="GET"&&staticPath&&!["fetch","xhr","eventsource"].includes(request.resourceType())){await route.continue();return;}
      retainRecord(record.forbidden,{method:request.method(),url:url.href,type:request.resourceType()});
      await route.abort("blockedbyclient");
    }catch(error){retainRecord(record.routeErrors,String(error).slice(0,1000));try{await route.abort("blockedbyclient");}catch(abort){retainRecord(record.routeErrors,String(abort).slice(0,1000));}}
    finally{record.pending--;}
  });

  let primaryFailed=false,primaryError;
  const finalErrors=[],observations=[];
  const retain=async action=>{try{await action();}catch(error){finalErrors.push(error);}};
  try{
    await page.goto(entry,{waitUntil:"domcontentloaded"});
    await expect(page.locator("#activity-focus-ready")).toHaveText("Real Activity issue panel ready");
    const panel=page.locator("forma-activity-issue-panel"),opener=panel.getByRole("button",{name:"Inspect request and receipt",exact:true});
    const parentHandle=await panel.elementHandle();
    await opener.click();await expect.poll(()=>record.detail).toBe(1);
    const dialog=page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(node=>node.matches(":modal"))).toBe(true);
    const dialogHandle=await dialog.elementHandle();
    const receipt=dialog.getByRole("textbox",{name:"Complete generation input receipt",exact:true});
    const originalReceipt=await receipt.inputValue();
    expect(JSON.parse(originalReceipt).job).toMatchObject({job_id:"job-1",document_id:"doc-1",attempt_count:1,status:"failed",artifact_kind:"video"});
    expect(originalReceipt).toContain("Synthetic lifetime original prompt");
    const region=dialog.getByRole("region",{name:"Accounting inspection",exact:true});
    const accounting=dialog.getByRole("textbox",{name:"Accounting diagnostic receipt",exact:true});
    await region.getByRole("button",{name:"Inspect accounting",exact:true}).click();
    await expect.poll(()=>record.accounting).toBe(1);
    await expect(region).toHaveAttribute("aria-busy","true");
    await expect(region.getByRole("button",{name:"Reading accounting…",exact:true})).toBeVisible();
    // Real trusted keyboard → fixture-only real Store.notify → actual parent render.
    // No parent method, reader or child predicate is substituted.
    await page.keyboard.press("F8");
    await expect.poll(async()=>JSON.parse(await page.locator("#activity-lifetime-observation").textContent())).toMatchObject({
      phase:"updated",action:"F8",notifications:1,promptChanges:0,sameParent:true,sameChild:true,sameInspection:true,nativeDialogOpen:true,
    });
    observations.push(JSON.parse(await page.locator("#activity-lifetime-observation").textContent()));
    expect(await parentHandle.evaluate(node=>node.isConnected)).toBe(true);
    expect(await dialogHandle.evaluate(node=>node.isConnected&&node.open&&node.matches(":modal"))).toBe(true);
    await expect(region).toHaveAttribute("aria-busy","true");
    await expect(region.getByRole("button",{name:"Reading accounting…",exact:true})).toBeVisible();
    expect(await receipt.inputValue()).toBe(originalReceipt);
    await expect(accounting).toHaveCount(0);
    expect(record.detail).toBe(1);expect(record.accounting).toBe(1);
    releaseAccounting();
    await expect(accounting).toBeVisible();
    const readyReceipt=await accounting.inputValue();
    expect(JSON.parse(readyReceipt).job.jobId).toBe("job-1");
    await expect(region.getByRole("button",{name:"Refresh accounting",exact:true})).toBeVisible();
    await expect(region).toHaveAttribute("aria-busy","false");
    await page.keyboard.press("F8");
    await expect.poll(async()=>JSON.parse(await page.locator("#activity-lifetime-observation").textContent())).toMatchObject({
      phase:"updated",action:"F8",notifications:2,promptChanges:0,sameParent:true,sameChild:true,sameInspection:true,nativeDialogOpen:true,
    });
    observations.push(JSON.parse(await page.locator("#activity-lifetime-observation").textContent()));
    expect(await receipt.inputValue()).toBe(originalReceipt);
    expect(await accounting.inputValue()).toBe(readyReceipt);
    expect(record.accounting).toBe(1);
    const measured=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visualScale:visualViewport?.scale}));
    expect(measured).toMatchObject({width:681,height:991,dpr:2,visualScale:1});
    const png=await page.screenshot({scale:"device",fullPage:false,animations:"disabled"});
    const encoded={width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
    expect(encoded.width).toBe(Math.round(measured.width*measured.dpr));
    expect(encoded.height).toBe(Math.round(measured.height*measured.dpr));
    await testInfo.attach("actual-Activity-ready-after-parent-notify",{body:png,contentType:"image/png"});
    // Meaningful control: change the synthetic retained source through real Store
    // content and notify. Real parent must produce a new inspection and real
    // unchanged child currentness must retire its already-ready accounting.
    await page.keyboard.press("F9");
    await expect.poll(async()=>JSON.parse(await page.locator("#activity-lifetime-observation").textContent())).toMatchObject({
      phase:"updated",action:"F9",notifications:2,promptChanges:1,sameParent:true,sameChild:true,sameInspection:false,nativeDialogOpen:true,
    });
    observations.push(JSON.parse(await page.locator("#activity-lifetime-observation").textContent()));
    await expect(receipt).toHaveValue(/Synthetic lifetime changed prompt/);
    expect(await receipt.inputValue()).not.toBe(originalReceipt);
    await expect(accounting).toHaveCount(0);
    await expect(region.getByRole("button",{name:"Inspect accounting",exact:true})).toBeVisible();
    await expect(region).toHaveAttribute("aria-busy","false");
    expect(record.detail).toBe(1);expect(record.accounting).toBe(1);
    await expect(page.locator("#detail-reads")).toHaveText("1");
    await expect(page.locator("#accounting-reads")).toHaveText("1");
    await dialog.getByRole("button",{name:"Close generation inputs",exact:true}).click();
    await expect(dialog).toBeHidden();await expect(opener).toBeFocused();
    await testInfo.attach("actual-Activity-lifetime-observations",{contentType:"application/json",body:JSON.stringify({
      observations,measured,screenshot:{scale:"device",encoded},receiptChanged:true,accountingGets:1,
      scope:"Actual isolated parent, Store and unchanged child guards; synthetic data and exact inert GETs. No live billing, financial authority, historical live trigger or true browser zoom claim.",
    })});
  }catch(error){primaryFailed=true;primaryError=error;}
  finally{
    releaseAccounting();
    await retain(()=>expect.poll(()=>record.pending,{timeout:2500}).toBe(0));
    await retain(()=>expect(record.forbidden).toEqual([]));await retain(()=>expect(record.routeErrors).toEqual([]));
    await retain(()=>expect(record.pageErrors).toEqual([]));await retain(()=>expect(record.consoleErrors).toEqual([]));
    await retain(()=>expect(record.downloads).toBe(0));await retain(()=>expect(record.newPages).toBe(0));
    await retain(()=>expect(record.closedDevSockets).toBe(0));await retain(()=>expect(record.dropped).toBe(0));
    await retain(()=>expect(page.locator("#blocked-reads")).toHaveText("0"));
    await retain(()=>testInfo.attach("activity-lifetime-network-and-errors",{contentType:"application/json",body:JSON.stringify({record,observations,primaryFailed,
      primaryError:primaryFailed?String(primaryError):null,finalErrors:finalErrors.map(String),
      pendingMeaning:"Route-handler operations only, not browser response-body completion."})}));
  }
  if(primaryFailed&&finalErrors.length)throw new AggregateError([primaryError,...finalErrors],"Primary Activity lifetime failure plus final diagnostics");
  if(primaryFailed)throw primaryError;if(finalErrors.length)throw new AggregateError(finalErrors,"Activity lifetime final diagnostics failed");
});

