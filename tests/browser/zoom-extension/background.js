/* global chrome */

// Only an exact, unique loopback URL in this isolated test profile is eligible.
globalThis.formaTestBrowserZoom = async ({ url, factor }) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(parsed.hostname)
    || ![1, 2, 4].includes(factor)) throw new Error("Unexpected Forma test zoom target.");
  const matches = (await chrome.tabs.query({})).filter(tab => tab.url === url);
  if (matches.length !== 1 || !Number.isInteger(matches[0].id)) throw new Error("Zoom requires one exact owned test tab.");
  const tabId = matches[0].id;
  await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" });
  await chrome.tabs.setZoom(tabId, factor);
  return {
    tabId, url: (await chrome.tabs.get(tabId)).url,
    factor: await chrome.tabs.getZoom(tabId),
    settings: await chrome.tabs.getZoomSettings(tabId),
  };
};
