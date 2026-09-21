/** Peak envelope across all channels: opposite-phase stereo must not cancel. */
export function audioPeaks(channels: readonly Float32Array[], bins = 120): number[] {
  if (!Number.isInteger(bins) || bins < 1 || bins > 1024) throw new RangeError('Invalid waveform resolution');
  const length = channels[0]?.length ?? 0;
  if (!length || channels.some(channel => channel.length !== length)) return [];
  const count = Math.min(bins, length);
  return Array.from({length: count}, (_, bin) => {
    let peak = 0;
    const start = Math.floor(bin * length / count), end = Math.floor((bin + 1) * length / count);
    for (const channel of channels) for (let i = start; i < end; i++) {
      const sample = Math.abs(channel[i]!);
      if (Number.isFinite(sample)) peak = Math.max(peak, Math.min(1, sample));
    }
    return peak;
  });
}
/** Yield between small batches so large recordings do not stall navigation. */
export async function decodedAudioPeaks(channels: readonly Float32Array[], signal: AbortSignal): Promise<number[]> {
  const length = channels[0]?.length ?? 0, count = Math.min(120, length), peaks: number[] = [];
  for (let bin = 0; bin < count; bin++) {
    signal.throwIfAborted();
    const start = Math.floor(bin * length / count), end = Math.floor((bin + 1) * length / count);
    peaks.push(audioPeaks(channels.map(channel => channel.subarray(start, end)), 1)[0] ?? 0);
    if (bin % 16 === 15) await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return peaks;
}
export function waveformPath(peaks: readonly number[]): string {
  const maximum = Math.max(...peaks, 0);
  return peaks.map((peak, index) => {
    const x = (index + .5) / peaks.length * 600;
    // Normalized for readability; silence stays on the center line.
    const height = maximum ? peak / maximum * 78 : 0;
    return `M${x.toFixed(2)} ${(90-height).toFixed(2)}V${(90+height).toFixed(2)}`;
  }).join(' ');
}
export const MAX_WAVEFORM_BYTES = 32 * 1024 * 1024;
export const MAX_WAVEFORM_SECONDS = 20 * 60;
/** Bound the transfer even if Content-Length is absent or inaccurate. */
export async function readWaveformBytes(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_WAVEFORM_BYTES) {
    await response.body?.cancel(); throw new Error('Waveform unavailable');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WAVEFORM_BYTES) throw new Error('Waveform too large');
      chunks.push(value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
