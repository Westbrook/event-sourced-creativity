async function boundedBody(request: Request, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("body_cancelled");
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) throw new Error("content_type");
  if (Number(request.headers.get("content-length") ?? 0) > 32768) throw new Error("body_limit");
  const reader = request.body?.getReader(); if (!reader) throw new Error("body_required");
  const chunks: Uint8Array[] = []; let length = 0, chunkCount = 0;
  let cancel: (() => void) | undefined;
  const cancelled = signal ? new Promise<never>((_resolve, reject) => {
    cancel = () => { void reader.cancel().catch(() => undefined); reject(new Error("body_cancelled")); };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  }) : undefined;
  try {
    for (;;) {
      const item = await (cancelled ? Promise.race([reader.read(), cancelled]) : reader.read());
      if (signal?.aborted) throw new Error("body_cancelled");
      if (item.done) break;
      // Ready empty/tiny chunks must not starve the sponsored timer forever.
      // Omitted signals keep the ordinary reader's existing chunk behavior.
      if (signal && ++chunkCount > 1024) { void reader.cancel().catch(() => undefined); throw new Error("body_limit"); }
      length += item.value.byteLength;
      if (length > 32768) { void reader.cancel().catch(() => undefined); throw new Error("body_limit"); }
      chunks.push(item.value);
    }
  } finally { if (cancel) signal?.removeEventListener("abort", cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export { boundedBody as readExperienceBody };
