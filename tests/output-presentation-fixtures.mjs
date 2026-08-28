import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";

// Independently authored deterministic fixtures; no retained user or provider material.
export const flexible = { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 };
export const exact = { kind: "exact", unit: "slide", value: 8 };
const content = [
  ["Orchard irrigation", "The north orchard uses drip irrigation around the mature pear trees.", "Water reaches the roots"],
  ["Archive indexing", "The town archive indexes handwritten maps by their original shelf marks.", "Provenance stays legible"],
  ["Harbor maintenance", "The harbor workshop inspects wooden hulls before the fishing season.", "Care protects the fleet"],
  ["Library access", "The library lends tactile atlases through its neighborhood reading rooms.", "Readers explore by touch"],
  ["Meadow restoration", "The eastern meadow shelters native grasses beside the old stone wall.", "Habitat regains continuity"],
  ["Mountain observatory", "The observatory shields its windows during nocturnal bird migration.", "Darkness supports safe passage"],
  ["Ceramic workshop", "The ceramic workshop dries unfinished bowls on sheltered timber racks.", "Patient preparation prevents cracks"],
  ["River crossing", "The footbridge connects the river trail to the community vegetable garden.", "Walking links shared places"],
  ["Station repair", "The station team restores the clock mechanism with replaceable brass gears.", "Repair extends useful life"],
  ["Seed exchange", "The seed exchange records growing conditions beside each donated variety.", "Local knowledge travels with seeds"],
  ["Theater costume", "The theater wardrobe stores linen costumes in breathable cotton covers.", "Materials need considered storage"],
  ["Community kitchen", "The community kitchen reserves separate utensils for allergy aware cooking.", "Preparation respects dietary needs"],
  ["Wetland survey", "The wetland survey follows reed boundaries without disturbing nesting herons.", "Observation protects quiet habitat"],
  ["Textile conservation", "The conservation studio supports fragile silk with reversible stitched backing.", "Intervention remains reversible"],
  ["Courtyard shade", "The courtyard planting provides afternoon shade beside the public fountain.", "Green space welcomes gathering"],
];

export function snapshot(count = 9) {
  return { facts: [
    ...content.slice(0, count).map(([label, body, emphasis], index) => ({ block_id: `source-${index}`, type: "message", properties: { label, text: `${body} ${emphasis}.` } })),
    { block_id: "output-mixed", type: "OUtput", properties: { subtype: "Executive summary", text: "OUTPUT_INSTRUCTION_SENTINEL: 1 slideshow with 5–15 slides, one podcast episode, and a series of TikTok style videos. SIBLING_VIDEO_SENTINEL." } },
    { block_id: "negative", type: "exclusion", intent: "prohibit", properties: { text: "Never invent measured success or reveal private customer records." } },
  ], relationships: [] };
}

export function outputFor(count = 9, source = snapshot(count)) {
  const contract = buildPresentationSourceContract(source, { itemCount: 8, slideCountPolicy: flexible });
  const items = content.slice(0, count).map(([title, body, emphasis], index) => {
    const alias = contract.sources.find((entry) => entry.sourceId === `source-${index}`).alias;
    return { title, body, notes: "", image_prompt: "Native editable typography; no image generation.", context_group_ids: [], slide: {
      layout: index === count - 1 ? "closing" : "statement", kicker: "", bullets: [], quote: null,
      citations: [{ source_id: alias, label: title, anchor: "Shared research", excerpt: body }], source_ids: [alias], section: null, source_order: index + 1,
      visual: { kind: "hero-type", label: "", value: emphasis, exact_value: null, display_value: null, unit: null, data: [] },
    } };
  });
  return { title: "Community stewardship", summary: "Distinct local practices support the places people share.", content_markdown: items.map((item) => `## ${item.title}\n${item.body}\n${item.slide.visual.value}`).join("\n\n"),
    presentation: { aspect_ratio: "16:9", theme: "Community evidence", footer_label: "Community stewardship", style_preset: "field-notes", mode: "light", palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" } }, items };
}

