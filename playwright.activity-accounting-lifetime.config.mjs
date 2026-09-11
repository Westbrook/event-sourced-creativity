import { defineConfig } from "@playwright/test";
import base from "./playwright.activity-receipt-focus.config.mjs";

if(process.env.FORMA_ACTIVITY_ACCOUNTING_LIFETIME!=="1")throw new Error("Explicit Activity accounting lifetime opt-in required");
// Reuse the existing isolated build→preview, never the Worker/project config.
// Existing base also requires FORMA_ACTIVITY_RECEIPT_FOCUS=1 and an owner-allocated non-4186 loopback origin.
export default defineConfig(base,{
  testMatch:"forma-activity-accounting-lifetime.spec.mjs",
  outputDir:"test-results/activity-accounting-lifetime",
  reporter:[["list"],["json",{outputFile:"test-results/activity-accounting-lifetime-report.json"}]],
});

