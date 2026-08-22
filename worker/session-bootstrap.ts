const SESSION_BOOTSTRAP_ID = "forma-session-bootstrap";

const escapedSessionJson = (value: string) => value.replace(/[<>&\u2028\u2029]/g, (character) => ({
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
}[character]!));

/** Keep private authentication behind the first streamed HTML head, never in a reusable cookie. */
export function streamNavigationSession(asset: Response, session: Promise<Response | null>, startedAt = performance.now()) {
  const headers = new Headers(asset.headers);
  headers.set("cache-control", "private, no-store");
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.delete("last-modified");
  headers.delete("content-md5");
  headers.delete("content-digest");
  // A Worker-personalized response already embeds its session; static-header
  // preload is needed only when the production router bypasses this Worker.
  headers.delete("link");

  const vary = new Set((headers.get("vary") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  for (const name of ["Cookie", "Authorization", "oai-authenticated-user-id", "cf-access-authenticated-user-email"]) vary.add(name);
  headers.set("vary", [...vary].join(", "));

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = asset.body!.getReader();
  let buffered = "";
  let inserted = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          const text = decoder.decode(value, { stream: !done });

          if (inserted) {
            if (text) controller.enqueue(encoder.encode(text));
          } else {
            buffered += text;
            const marker = /<body\b[^>]*>/i.exec(buffered);
            if (marker) {
              const boundary = marker.index + marker[0].length;
              const prefix = buffered.slice(0, boundary).replace(/<script\s+id="forma-static-session-prefetch">[\s\S]*?<\/script>\s*/i, "");
              controller.enqueue(encoder.encode(prefix));

              let bootstrap = "";
              try {
                const response = await session;
                if (response?.ok) {
                  const body = escapedSessionJson(await response.text());
                  const serverMs = Math.round((performance.now() - startedAt) * 10) / 10;
                  bootstrap = `<script id="${SESSION_BOOTSTRAP_ID}" type="application/json" data-server-ms="${serverMs}">${body}</script>`;
                }
              } catch {
                // The unchanged shell can still request its authenticated session normally.
              }

              controller.enqueue(encoder.encode(bootstrap + buffered.slice(boundary)));
              buffered = "";
              inserted = true;
            }
          }

          if (done) {
            if (buffered) controller.enqueue(encoder.encode(buffered));
            controller.close();
            return;
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(body, { status: asset.status, statusText: asset.statusText, headers });
}
