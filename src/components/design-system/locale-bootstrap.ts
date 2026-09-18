import { initializeFormaLocale } from "./localization";

// Settle the saved/browser locale before main imports a stateful application.
// Initial catalog loading is not a later user-requested language change.
await initializeFormaLocale();
