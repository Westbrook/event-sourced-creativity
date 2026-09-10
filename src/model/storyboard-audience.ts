export interface StoryboardAudienceInput {
  title: string;
  markdown: string;
  frames: ReadonlyArray<Record<string, unknown>>;
  soundtracks?: ReadonlyArray<Record<string, unknown>>;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

const text = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("invalid_storyboard_audience");
  return escapeHtml(value);
};

const originalFile = (value: unknown, directory: "frames" | "soundtracks", position: number): string => {
  const stem = directory === "frames" ? "frame" : "soundtrack";
  const extensions = directory === "frames" ? "(?:jpg|png|webp|gif|avif)" : "(?:mp3|wav|m4a|ogg|webm|flac|aac|mp4)";
  const expected = new RegExp(`^${directory}/${stem}-${String(position).padStart(3, "0")}\\.${extensions}$`, "u");
  if (typeof value !== "string" || !expected.test(value)) throw new Error("invalid_storyboard_audience_file");
  return value;
};

/** A passive local document packaged with the exact authorized archive files. */
export function storyboardAudienceHtml(input: StoryboardAudienceInput): string {
  if (!input.frames.length) throw new Error("incomplete_storyboard_audience");
  const title = text(input.title), markdown = text(input.markdown);
  const frames = input.frames.map((frame, index) => {
    const position = index + 1;
    if (frame.position !== position) throw new Error("invalid_storyboard_audience_order");
    const file = originalFile(frame.file, "frames", position);
    const frameTitle = text(frame.title), description = text(frame.description), notes = text(frame.notes);
    return `<li><article class="frame" aria-labelledby="frame-${position}">
      <figure><img src="${file}" alt="Frame ${position}: ${frameTitle}"><figcaption><a href="${file}">Open original frame ${position}</a></figcaption></figure>
      <div class="frame-copy"><p class="eyebrow">Frame ${position}</p><h2 id="frame-${position}" dir="auto">${frameTitle}</h2>
        <div class="authored" dir="auto">${description}</div>
        ${notes ? `<section class="notes" aria-labelledby="notes-${position}"><h3 id="notes-${position}">Continuity notes</h3><div class="authored" dir="auto">${notes}</div></section>` : ""}
      </div>
    </article></li>`;
  }).join("\n");
  const soundtracks = (input.soundtracks ?? []).map((soundtrack, index) => {
    const position = index + 1;
    if (soundtrack.position !== position) throw new Error("invalid_storyboard_audience_order");
    const file = originalFile(soundtrack.file, "soundtracks", position), label = text(soundtrack.label);
    return `<li><a href="${file}"><span dir="auto">${label || `Soundtrack ${position}`}</span></a></li>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'">
<meta name="referrer" content="no-referrer"><title>${title}</title>
<style>
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;padding:clamp(16px,4vw,48px);background:#f7f6f2;color:#202420;font:16px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:auto}header{margin-bottom:32px}h1,h2,h3,p,figure{margin:0}h1{font-size:clamp(1.7rem,4vw,2.8rem);line-height:1.2}h2{font-size:1.5rem;line-height:1.35}h3{font-size:1rem;line-height:1.5}h1,h2,h3,.authored,a{overflow-wrap:anywhere}a{color:#205b47;text-underline-offset:.2em}a:focus-visible{outline:3px solid #245dab;outline-offset:4px}.summary,.eyebrow,figcaption{color:#50594f}.summary{margin-top:12px}.frames{display:grid;gap:32px;list-style:none;margin:0;padding:0}.frame{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:24px;padding:24px;background:white;border:1px solid #d5d9d1;border-radius:12px}.frame>*{min-width:0}img{display:block;width:100%;height:auto}figcaption{margin-top:12px;font-size:.875rem}.eyebrow{font-size:.875rem;margin-bottom:8px}.authored{white-space:pre-wrap;margin-top:16px}.notes{margin-top:24px;padding-top:16px;border-top:1px solid #d5d9d1}.notes .authored{margin-top:8px}.supporting{margin-top:40px;padding-top:24px;border-top:1px solid #d5d9d1}.supporting p,.supporting ul{margin-top:12px}.source{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:16px 0 0}footer{margin-top:40px;color:#50594f;font-size:.875rem}@media(max-width:650px){.frame{grid-template-columns:minmax(0,1fr);padding:16px;gap:20px}}@media print{body{padding:0;background:white}.frame{break-inside:avoid;border-radius:0}.supporting{break-before:auto}a{color:inherit}}
</style></head><body><main>
<header><h1 dir="auto">${title}</h1><p class="summary">${input.frames.length} ${input.frames.length === 1 ? "frame" : "frames"} · <a href="README.md">Original text file</a></p></header>
<ol class="frames">${frames}</ol>
<section class="supporting" aria-labelledby="soundtrack-heading"><h2 id="soundtrack-heading">Soundtrack</h2>${soundtracks ? `<ul>${soundtracks}</ul>` : "<p>No soundtrack is included.</p>"}</section>
<section class="supporting" aria-labelledby="source-heading"><h2 id="source-heading">Original text</h2><pre class="source" dir="auto">${markdown}</pre></section>
<footer>Keep this file beside README.md and the original media folders.</footer>
</main></body></html>`;
}
