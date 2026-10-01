import { html, render } from "lit";
import { renderExperienceShortStory, type ExperienceShortStoryResult } from "../../../src/experiences/results/short-story-reader.ts";
import "../../../src/experiences/results/short-story-reader.css";
import "./reader.css";

// Local presentation fixture only. These are synthetic DTOs, not retained
// output, trusted read transport, custody, generation or handoff evidence.
// No Store, Worker, public entry, media or provider dependency is imported.
const samples = {
  standard: {
    label: "Standard", title: "The last light", lang: "en",
    text: "The light in the station changed from amber to green.\n\nMara folded the map along its oldest crease. On the other side of the platform, someone lifted a hand.\n\nShe lifted hers.",
  },
  literal: {
    label: "Literal text", title: "<em>Title</em>", lang: "en",
    text: "\ufeff  # Heading\r\n\r\n<script>throw new Error('literal')</script>\n<img src=/reader-fixture-must-not-load onerror=alert(1)>\n[Label](https://example.invalid)\n& < > \" ' \n終わり  ",
  },
  long: { label: "Long line", title: "Long line", lang: "en", text: "LongLine".repeat(256) },
  rtl: {
    label: "RTL", title: "الضوء الأخير", lang: "ar",
    text: "تغيّر الضوء في المحطة.\n\nطوت مريم الخريطة، ثم رفعت يدها.\n\nPlatform 12 — الرصيف ١٢\n\nانتهت الرحلة.",
  },
  maximum: {
    label: "Maximum", title: "Maximum", lang: "ja",
    text: "\ufeff\r\n" + "界".repeat(170_663) + "終\n  ",
  },
  blank: { label: "Blank title", title: " \t\n ", lang: "en", text: "The last train arrived.\n\nThe platform was empty.  " },
} as const;
type Sample = keyof typeof samples;
const controls = document.querySelector<HTMLElement>("#reader-controls")!;
const result = document.querySelector<HTMLElement>("#reader-result")!;
let selected: Sample = "standard";

function drawResult() {
  const sample = samples[selected];
  const dto: ExperienceShortStoryResult = {
    schemaVersion: 1, output: "short_story", viewerRef: "short_story.read-only@1", viewerContractRevision: 1,
    identity: {
      documentId: "reader-fixture-document", outputId: "reader-fixture-output", outputObjectKind: "artifact", outputRevision: 1,
      sourceRevision: "reader-fixture-revision", sourceDigest: "b".repeat(64), contentHash: null, releaseHash: "sha256:" + "c".repeat(64),
    },
    title: sample.title, content: { content_markdown: sample.text },
  };
  result.lang = sample.lang;
  result.dataset.sample = selected;
  render(renderExperienceShortStory(dto), result);
}

render(html`<header class="reader-fixture-controls">
  <h1>Short story <span>· Fixture</span></h1>
  <label>Sample<select @change=${(event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (!Object.hasOwn(samples, value)) return;
    selected = value as Sample;
    drawResult();
  }}>${Object.entries(samples).map(([value, sample]) => html`<option value=${value}>${sample.label}</option>`)}</select></label>
  <label>Text size<select @change=${(event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value === "100" || value === "200") document.documentElement.dataset.textSize = value;
  }}><option value="100">100%</option><option value="200">200%</option></select></label>
  <label>Appearance<select @change=${(event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value === "light dark" || value === "light" || value === "dark") document.documentElement.style.colorScheme = value;
  }}><option value="light dark">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
</header>`, controls);
drawResult();
