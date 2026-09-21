export type NativeControlBody = { status: "parsed"; value: Record<string, unknown> } | { status: "invalid" | "too-large" };

export const NATIVE_CONTROL_READ_TIMEOUT_MS = 30_000;
/** Tiny control messages only. A slow, aborted or oversized upload never reaches
 * a native mutation or spending. Stream cancellation is best effort: an
 * uncooperative producer cannot hold the response open through its cancel hook. */
export async function readNativeControlBody(request: Request, maximumBytes = 4096): Promise<NativeControlBody> {
  if (!request.body || request.bodyUsed || request.body.locked || request.signal.aborted || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 65_536
    || request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return { status: "invalid" };
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    void request.body.cancel().catch(() => {}); return { status: /^\d+$/u.test(declared) && Number(declared) > maximumBytes ? "too-large" : "invalid" };
  }
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let text = "", length = 0, stopped = false;
  const stop = () => { stopped = true; void reader.cancel().catch(() => {}); };
  const timer = setTimeout(stop, NATIVE_CONTROL_READ_TIMEOUT_MS);
  request.signal.addEventListener("abort", stop, { once: true });
  try {
    if (request.signal.aborted) return { status: "invalid" };
    for (;;) { const next = await reader.read(); if (stopped || request.signal.aborted) return { status: "invalid" }; if (next.done) break; length += next.value.byteLength;
      if (length > maximumBytes) return { status: "too-large" }; text += decoder.decode(next.value, { stream: true }); }
    text += decoder.decode();
    if (declared !== null && Number(declared) !== length) return { status: "invalid" };
    const value: unknown = JSON.parse(text);
    // Grammar is parsed above; reject duplicate keys, including escaped keys.
    const stack: { keys: Set<string> | null; key: boolean }[] = [];
    for (const [token] of text.matchAll(/"(?:\\.|[^"\\])*"|[{}:,]|\[|\]/gsu)) {
      if (token === "{" || token === "[") { if (stack.length >= 5) return { status: "invalid" }; stack.push({ keys: token === "{" ? new Set() : null, key: token === "{" }); }
      else if (token === "}" || token === "]") stack.pop();
      else { const current = stack.at(-1); if (token === "," && current?.keys) current.key = true;
        else if (token.startsWith('"') && current?.keys && current.key) { const key: string = JSON.parse(token);
          if (current.keys.has(key)) return { status: "invalid" }; current.keys.add(key); current.key = false; } }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? { status: "parsed", value: value as Record<string, unknown> } : { status: "invalid" };
  } catch { return { status: "invalid" }; } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", stop);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
