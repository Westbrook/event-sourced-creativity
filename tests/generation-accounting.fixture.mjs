import { inputInspection } from "./helpers/generation-accounting-fixture.mjs";

const origin = "http://127.0.0.1:4186", path = "/tests/generation-accounting.fixture.html";
const parameters = new URLSearchParams(location.search), locale = parameters.get("locale") ?? "en";
if (location.origin !== origin || location.pathname !== path || location.hash || !["en", "fr", "ar"].includes(locale)
  || parameters.getAll("locale").length > 1 || [...parameters.keys()].some(key => key !== "locale")) throw new Error("Invalid isolated accounting fixture entry");

// Installed before importing the real Store or connecting any owner. The sole
// admitted request still requires Playwright's synthetic response interceptor;
// this finite Vite-only server has no Worker, proxy or accounting backend.
const nativeFetch = globalThis.fetch.bind(globalThis);
let reads = 0, blocked = 0;
const blockedError = () => { document.querySelector("#accounting-fixture-blocked").textContent = String(++blocked); return new TypeError("Undeclared fixture transport blocked"); };
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  if (request.url !== `${origin}/api/admin/generation-accounting?jobId=job-1` || request.method !== "GET") return Promise.reject(blockedError());
  document.querySelector("#accounting-fixture-reads").textContent = String(++reads);
  return nativeFetch(request);
};
globalThis.XMLHttpRequest = class { constructor() { throw blockedError(); } };
globalThis.EventSource = class { constructor() { throw blockedError(); } };
Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: () => { blockedError(); return false; } });

const { store } = await import("/src/state/store.ts");
const { setFormaLocale } = await import("/src/components/design-system/localization.ts");
await setFormaLocale(locale, { persist: false, timeZone: "UTC" });
await import("/src/components/generation-input-dialog.ts");

// Declared synthetic personal principal; no login, credential, real role change,
// authorization predicate override, app-method substitution or provider setup.
store.session.set({
  user: { userId: "fixture-accounting", email: "accounting@example.invalid", displayName: "Synthetic accounting fixture", role: "admin", consentVersion: "fixture", consentedAt: "2026-09-10T12:00:00.000Z" },
  impersonation: null, projectContext: null, audience: "creative",
  policy: { version: "fixture", accepted: true, passiveCapture: false, externalAssetsRequireAssertion: true, retentionDays: 30, sharing: "fixture" },
  provider: { name: "fixture", model: "fixture", configured: false, plannerConfigured: false, videoConfigured: false, audioConfigured: false },
  budgets: { period: "fixture", user: { used: 0, reserved: 0, limit: 0 }, workspace: { used: 0, reserved: 0, limit: 0 } }, capabilities: [],
});
store.route.set("/activity"); store.loading.set(false);

const opener = document.querySelector("#accounting-fixture-opener"), mount = document.querySelector("#accounting-fixture-owner");
const host = document.createElement("forma-generation-input-dialog");
let opening = null;
host.addEventListener("generation-input-close", () => { opening = null; });
opener.addEventListener("click", () => {
  const owner = { scope: store.captureAuthorizationScope()?.key, route: store.route.get() }; opening = owner;
  const inspection = inputInspection();
  inspection.title = locale === "fr" ? "Justificatif synthétique de génération et détails comptables conservés pour cette tentative" : locale === "ar" ? "إيصال توليد اصطناعي مع تفاصيل المحاسبة المحفوظة" : "Synthetic generation receipt";
  inspection.receipt.fixture_marker = "ORIGINAL_SYNTHETIC_RECEIPT_NO_ACCOUNT_DATA";
  host.openingCurrent = () => opening === owner && opener.isConnected && store.captureAuthorizationScope()?.key === owner.scope && store.route.get() === owner.route;
  host.inspection = inspection; host.open = true;
  // No manual focus calls: actual showModal() and native close own the return.
});
mount.append(host); await host.updateComplete;
if (host.constructor !== customElements.get("forma-generation-input-dialog")) throw new Error("Actual accounting dialog was not mounted");
opener.disabled = false;
document.querySelector("#accounting-fixture-ready").textContent = "Isolated accounting fixture ready";
