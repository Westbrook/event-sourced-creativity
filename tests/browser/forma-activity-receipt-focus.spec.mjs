import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { accountingResponse } from "../helpers/generation-accounting-fixture.mjs";
import { failedJob } from "../helpers/activity-receipt-focus-data.mjs";

// Never activated by the default suite against its unrelated shared fixture.
test.skip(process.env.FORMA_ACTIVITY_RECEIPT_FOCUS!=="1","Owner-run isolated Activity focus proposal only");
test("real Activity delayed receipt remains focusable and header Close returns its exact opener",async({page,context},testInfo)=>{
  const origin=testInfo.project.use.baseURL, path="/tests/activity-receipt-focus.fixture.html";
  const base=new URL(origin);
  expect(base.protocol).toBe("http:");expect(base.hostname).toBe("127.0.0.1");
  expect(base.port).not.toBe("4186");expect(base.port).not.toBe("");
  const detailURL=origin+"/api/document-jobs/job-1?inspection=1", accountingURL=origin+"/api/admin/generation-accounting?jobId=job-1";
  const record={detail:0,accounting:0,pending:0,totalRequests:0,dropped:0,forbidden:[],routeErrors:[],pageErrors:[],consoleErrors:[],newPages:0,downloads:0,fontRequests:0,closedDevSockets:0};
  const retainRecord=(list,value)=>{if(list.length<32)list.push(value);else record.dropped++;};
  let releaseDetail;const detailGate=new Promise(resolve=>{releaseDetail=resolve;});
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
        if(url.href===detailURL){if(++record.detail>1)throw new Error("Duplicate detail read");await detailGate;}
        else if(++record.accounting>1)throw new Error("Duplicate accounting read");
        await route.fulfill({status:200,contentType:"application/json",headers:{"cache-control":"private, no-store"},
          body:JSON.stringify(url.href===detailURL?{job:failedJob()}:accountingResponse())});return;
      }
      const font=fonts.get(url.href);
      if(font&&request.method()==="GET"&&request.resourceType()===font.resourceType){
        if(++record.fontRequests>16)throw new Error("Font request cap");
        await route.fulfill({status:200,headers:{"content-type":font.contentType,"access-control-allow-origin":"*","cache-control":"no-store"},body:font.body});return;
      }
      const staticPath=url.pathname===path||url.pathname.startsWith("/assets/");
      if(url.origin===origin&&request.method()==="GET"&&staticPath&&!["fetch","xhr","eventsource"].includes(request.resourceType())){await route.continue();return;}
      retainRecord(record.forbidden,{method:request.method(),url:url.href,type:request.resourceType()});
      await route.abort("blockedbyclient");
    }catch(error){retainRecord(record.routeErrors,String(error).slice(0,1000));try{await route.abort("blockedbyclient");}catch(abort){retainRecord(record.routeErrors,String(abort).slice(0,1000));}}
    finally{record.pending--;}
  });
  let primaryFailed=false,primaryError;
  const finalErrors=[];const retain=async action=>{try{await action();}catch(error){finalErrors.push(error);}};
  try{
    await page.goto(path,{waitUntil:"domcontentloaded"});
    await expect(page.locator("#activity-focus-ready")).toHaveText("Real Activity issue panel ready");
    const panel=page.locator("forma-activity-issue-panel"),opener=panel.getByRole("button",{name:"Inspect request and receipt",exact:true});
    await expect(opener).toBeInViewport();
    const original=await opener.elementHandle(),before=await page.evaluate(()=>({scrollY,innerWidth,innerHeight,dpr:devicePixelRatio}));
    expect(before).toMatchObject({innerWidth:681,innerHeight:991,dpr:2});
    await opener.click();await expect.poll(()=>record.detail).toBe(1);
    await expect(opener).toHaveAttribute("aria-disabled","true");await expect(opener).toHaveJSProperty("disabled",false);expect(await opener.evaluate(node=>node.matches(":disabled"))).toBe(false);await expect(opener).toBeFocused();
    await page.keyboard.press("Enter"); // Native duplicate activation while its read is deliberately held.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(record.detail).toBe(1);expect(record.accounting).toBe(0);
    releaseDetail();
    const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(node=>node.matches(":modal"))).toBe(true);
    const receipt=dialog.getByRole("textbox",{name:"Complete generation input receipt",exact:true});
    const input=JSON.parse(await receipt.inputValue());
    expect(input.job).toMatchObject({job_id:"job-1",document_id:"doc-1",attempt_count:1,status:"failed",artifact_kind:"video"});
    await dialog.getByRole("button",{name:"Inspect accounting",exact:true}).click();
    const accounting=dialog.getByRole("textbox",{name:"Accounting diagnostic receipt",exact:true});
    await expect(accounting).toBeVisible();expect(JSON.parse(await accounting.inputValue()).job.jobId).toBe("job-1");
    await dialog.getByRole("button",{name:"Close generation inputs",exact:true}).click();
    await expect(dialog).toBeHidden();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect(opener).toBeFocused();await expect(opener).toHaveAttribute("aria-disabled","false");
    expect(await original.evaluate(node=>node.isConnected&&document.activeElement===node)).toBe(true);
    expect(Math.abs(await page.evaluate(()=>scrollY)-before.scrollY)).toBeLessThanOrEqual(0.5);
    const png=await page.screenshot({scale:"device",fullPage:false,animations:"disabled"});
    expect(png.readUInt32BE(16)).toBe(1362);expect(png.readUInt32BE(20)).toBe(1982);
    await testInfo.attach("activity-exact-opener-after-pointer-close",{body:png,contentType:"image/png"});
    await testInfo.attach("activity-focus-measurements",{contentType:"application/json",body:JSON.stringify({before,
      after:await page.evaluate(()=>({scrollY,innerWidth,innerHeight,dpr:devicePixelRatio,tag:document.activeElement?.tagName,
        label:document.activeElement?.textContent?.trim(),focusVisible:document.activeElement?.matches(":focus-visible")})),
      screenshot:{scale:"device",encodedWidth:1362,encodedHeight:1982},limit:"Pointer close requires exact active element, not a forced focus ring. Synthetic isolated panel, not production Activity or live billing acceptance."})});
  }catch(error){primaryFailed=true;primaryError=error;}
  finally{
    releaseDetail();
    await retain(()=>expect.poll(()=>record.pending,{timeout:2500}).toBe(0));
    await retain(()=>expect(record.forbidden).toEqual([]));await retain(()=>expect(record.routeErrors).toEqual([]));
    await retain(()=>expect(record.pageErrors).toEqual([]));await retain(()=>expect(record.consoleErrors).toEqual([]));
    await retain(()=>expect(record.downloads).toBe(0));await retain(()=>expect(record.newPages).toBe(0));
    await retain(()=>expect(record.closedDevSockets).toBe(0));
    await retain(()=>expect(record.dropped).toBe(0));
    await retain(()=>expect(page.locator("#blocked-reads")).toHaveText("0"));
    await retain(()=>testInfo.attach("activity-focus-network-and-errors",{contentType:"application/json",body:JSON.stringify({record,primaryFailed,
      primaryError:primaryFailed?String(primaryError):null,finalErrors:finalErrors.map(String),
      pendingMeaning:"Route-handler operations only, not browser response-body completion."})}));
  }
  if(primaryFailed&&finalErrors.length)throw new AggregateError([primaryError,...finalErrors],"Primary Activity focus failure plus final diagnostics");
  if(primaryFailed)throw primaryError;if(finalErrors.length)throw new AggregateError(finalErrors,"Activity focus final diagnostics failed");
});
