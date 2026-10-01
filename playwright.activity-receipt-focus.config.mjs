import { defineConfig } from "@playwright/test";

// Owner selects the isolated loopback port. Never reuse an unrelated server.
if(process.env.FORMA_ACTIVITY_RECEIPT_FOCUS!=="1")throw new Error("Explicit isolated Activity focus opt-in required");
const url=new URL(process.env.FORMA_ACTIVITY_RECEIPT_FOCUS_ORIGIN??"");
if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||!url.port||url.port==="4186"
  ||url.pathname!=="/"||url.search||url.hash||url.username||url.password)throw new Error("Use an owner-allocated non-4186 loopback preview");
export default defineConfig({
  testDir:"./tests/browser",testMatch:"forma-activity-receipt-focus.spec.mjs",
  workers:1,retries:0,forbidOnly:true,timeout:30000,
  outputDir:"test-results/activity-receipt-focus",
  reporter:[["list"],["json",{outputFile:"test-results/activity-receipt-focus-report.json"}]],
  webServer:{command:"node scripts/activity-receipt-test-preview.mjs",
    url:url.origin+"/tests/activity-receipt-focus.fixture.html",reuseExistingServer:false,timeout:60000},
  use:{baseURL:url.origin,viewport:{width:681,height:991},deviceScaleFactor:2,
    locale:"en-US",browserName:"chromium",channel:"chromium",serviceWorkers:"block",
    acceptDownloads:false,trace:"on",screenshot:"only-on-failure"},
});
