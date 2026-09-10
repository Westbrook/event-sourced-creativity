import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./tests/browser",
  testMatch:["forma-slides-content-first.spec.mjs","forma-library-search-first.spec.mjs"],
  outputDir:"./test-results/content-first",
  workers:1,retries:0,timeout:45000,reporter:"list",
  use:{browserName:"chromium",headless:true,deviceScaleFactor:2,trace:"retain-on-failure"},
  webServer:{
    command:"node scripts/content-first-test-preview.mjs",
    url:"http://127.0.0.1:4186/tests/presentation-responsive.fixture.html",
    reuseExistingServer:!process.env.CI,timeout:30000,
  },
  projects:[
    {name:"desktop",use:{viewport:{width:1280,height:900}}},
    {name:"reported-width",use:{viewport:{width:681,height:991}}},
    {name:"narrow-reflow",testMatch:"forma-slides-content-first.spec.mjs",use:{viewport:{width:360,height:800}}},
  ],
});
