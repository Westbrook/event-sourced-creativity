/** Server-verified container timing; editable client properties are never trusted. */
export type VerifiedAudioTiming = {
  durationSeconds: number;
  sampleRate: number;
  format: "wav" | "mp3";
};

type Mp3Frame = { offset: number; length: number; samples: number; sampleRate: number };

const word = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
const uint16 = (bytes: Uint8Array, offset: number) => bytes[offset]! | bytes[offset + 1]! << 8;
const uint32 = (bytes: Uint8Array, offset: number) => (bytes[offset]! | bytes[offset + 1]! << 8 | bytes[offset + 2]! << 16 | bytes[offset + 3]! << 24) >>> 0;

function wavLayout(bytes: Uint8Array) {
  if (bytes.length < 44 || word(bytes, 0) !== "RIFF" || word(bytes, 8) !== "WAVE") return null;
  let sampleRate = 0, byteRate = 0, blockAlign = 0, dataOffset = 0, dataLength = 0;
  for (let cursor = 12; cursor + 8 <= bytes.length;) {
    const id = word(bytes, cursor), length = uint32(bytes, cursor + 4), start = cursor + 8;
    if (start + length > bytes.length) return null;
    if (id === "fmt " && length >= 16) { sampleRate = uint32(bytes, start + 4); byteRate = uint32(bytes, start + 8); blockAlign = uint16(bytes, start + 12); }
    if (id === "data") { dataOffset = start; dataLength = length; break; }
    cursor = start + length + length % 2;
  }
  if (!sampleRate || !byteRate || !blockAlign || !dataOffset || !dataLength || dataLength % blockAlign) return null;
  return { sampleRate, byteRate, blockAlign, dataOffset, dataLength, durationSeconds: dataLength / byteRate };
}

function mp3Frames(bytes: Uint8Array) {
  if (bytes.length < 8) return null;
  let cursor = word(bytes, 0).startsWith("ID3") && bytes.length >= 10
    ? 10 + ((bytes[6]! & 0x7f) << 21 | (bytes[7]! & 0x7f) << 14 | (bytes[8]! & 0x7f) << 7 | bytes[9]! & 0x7f)
    : 0;
  const frames: Mp3Frame[] = [];
  const v1Rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const v2Rates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const frequencies = [44_100, 48_000, 32_000];
  let skipped = 0;
  while (cursor + 4 <= bytes.length) {
    const first = bytes[cursor]!, second = bytes[cursor + 1]!, third = bytes[cursor + 2]!;
    const version = second >> 3 & 3, layer = second >> 1 & 3, rateIndex = third >> 4, frequencyIndex = third >> 2 & 3;
    if (first !== 0xff || (second & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || rateIndex === 0 || rateIndex === 15 || frequencyIndex === 3) {
      if (frames.length) break;
      if (++skipped > 16_384) return null;
      cursor += 1;
      continue;
    }
    const sampleRate = Math.floor(frequencies[frequencyIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4));
    const bitrate = (version === 3 ? v1Rates : v2Rates)[rateIndex]! * 1_000;
    const samples = version === 3 ? 1_152 : 576;
    const length = Math.floor((version === 3 ? 144 : 72) * bitrate / sampleRate) + (third >> 1 & 1);
    if (!sampleRate || !bitrate || length < 24 || cursor + length > bytes.length) break;
    frames.push({ offset: cursor, length, samples, sampleRate });
    cursor += length;
  }
  if (frames.length < 2 || frames.some((frame) => frame.sampleRate !== frames[0]!.sampleRate)) return null;
  return frames;
}

export function verifiedAudioTiming(bytes: Uint8Array, mimeType: string): VerifiedAudioTiming | null {
  if (/^audio\/(?:wav|x-wav|wave)$/i.test(mimeType)) {
    const wav = wavLayout(bytes);
    return wav && Number.isFinite(wav.durationSeconds) && wav.durationSeconds > 0 ? { durationSeconds: wav.durationSeconds, sampleRate: wav.sampleRate, format: "wav" } : null;
  }
  if (/^audio\/(?:mpeg|mp3)$/i.test(mimeType)) {
    const frames = mp3Frames(bytes);
    return frames ? { durationSeconds: frames.reduce((total, frame) => total + frame.samples / frame.sampleRate, 0), sampleRate: frames[0]!.sampleRate, format: "mp3" } : null;
  }
  return null;
}

/** Create a genuine bounded audio excerpt without transmitting the full recording. */
export function boundedAudioExcerpt(bytes: Uint8Array, mimeType: string, startSeconds: number, maximumSeconds: number) {
  const timing = verifiedAudioTiming(bytes, mimeType);
  if (!timing || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(maximumSeconds) || maximumSeconds <= 0 || startSeconds >= timing.durationSeconds) return null;
  if (timing.format === "wav") {
    const wav = wavLayout(bytes)!;
    const startByte = Math.floor(startSeconds * wav.byteRate / wav.blockAlign) * wav.blockAlign;
    const requestedLength = Math.floor(maximumSeconds * wav.byteRate / wav.blockAlign) * wav.blockAlign;
    const length = Math.min(wav.dataLength - startByte, requestedLength);
    if (!length) return null;
    const clipped = new Uint8Array(wav.dataOffset + length);
    clipped.set(bytes.slice(0, wav.dataOffset));
    clipped.set(bytes.slice(wav.dataOffset + startByte, wav.dataOffset + startByte + length), wav.dataOffset);
    new DataView(clipped.buffer).setUint32(wav.dataOffset - 4, length, true);
    new DataView(clipped.buffer).setUint32(4, clipped.length - 8, true);
    return { bytes: clipped, durationSeconds: length / wav.byteRate, startSeconds: startByte / wav.byteRate, originalDurationSeconds: timing.durationSeconds };
  }
  const frames = mp3Frames(bytes)!;
  let elapsed = 0, selectedDuration = 0;
  const selected: Mp3Frame[] = [];
  for (const frame of frames) {
    const duration = frame.samples / frame.sampleRate;
    if (elapsed + duration > startSeconds && selectedDuration + duration <= maximumSeconds) { selected.push(frame); selectedDuration += duration; }
    else if (selected.length && selectedDuration + duration > maximumSeconds) break;
    elapsed += duration;
  }
  if (selected.length < 2) return null;
  const clipped = new Uint8Array(selected.reduce((total, frame) => total + frame.length, 0));
  let offset = 0;
  for (const frame of selected) { clipped.set(bytes.slice(frame.offset, frame.offset + frame.length), offset); offset += frame.length; }
  return { bytes: clipped, durationSeconds: selectedDuration, startSeconds, originalDurationSeconds: timing.durationSeconds };
}
