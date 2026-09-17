/** A bounded decoder envelope, not a compressed-audio privacy qualification. */
export const AUDIO_SHARE_MP3_ENVELOPE_LIMITS = Object.freeze({
  bytes: 1_000_000, seconds: 20, id3Bytes: 65_536, id3Frames: 256, physicalFrames: 842,
});

export type AudioShareMp3Frame = Readonly<{ offset: number; length: number }>;
export type AudioShareMp3Envelope = Readonly<{
  ok: true;
  sampleRate: 32000 | 44100 | 48000;
  channels: 1 | 2;
  frames: readonly AudioShareMp3Frame[];
  firstAudioFrame: 1;
  encodedSamples: number;
  encoderDelay: number;
  encoderPadding: number;
  outputSamples: number;
}>;
export type AudioShareMp3Refusal = Readonly<{ ok: false; reason:
  "invalid_bytes" | "unsupported_metadata" | "invalid_metadata" | "unsupported_format"
  | "invalid_frame" | "missing_gapless" | "invalid_gapless" | "inconsistent_stream" | "duration_limit";
}>;

const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0] as const;
const rates = [44100, 48000, 32000] as const;
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const bufferGetter = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
// These frames are only length-delimited and discarded. Their contents are not decoded,
// returned, trusted as audio facts, or delivered to the codec.
const metadataIds = new Set((
  "AENC APIC COMM COMR ENCR EQU2 EQUA ETCO GEOB GRID IPLS LINK MCDI MLLT OWNE PCNT POPM POSS PRIV " +
  "RBUF RVA2 RVAD RVRB SEEK SIGN SYLT SYTC UFID USER USLT ASPI " +
  "TALB TBPM TCOM TCON TCOP TDAT TDEN TDLY TDOR TDRC TDRL TDTG TENC TEXT TFLT TIME TIPL TIT1 TIT2 TIT3 " +
  "TKEY TLAN TLEN TMCL TMED TMOO TOAL TOFN TOLY TOPE TORY TOWN TPE1 TPE2 TPE3 TPE4 TPOS TPRO TPUB " +
  "TRCK TRDA TRSN TRSO TSIZ TSOA TSOP TSOT TSRC TSSE TSST TXXX TYER " +
  "WCOM WCOP WOAF WOAR WOAS WORS WPAY WPUB WXXX"
).split(" "));

const fail = (reason: AudioShareMp3Refusal["reason"]): AudioShareMp3Refusal => Object.freeze({ ok: false, reason });
const u32 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
function synchsafe(bytes: Uint8Array, offset: number): number | null {
  if ((bytes[offset] | bytes[offset + 1] | bytes[offset + 2] | bytes[offset + 3]) & 128) return null;
  return bytes[offset] * 0x200000 + bytes[offset + 1] * 0x4000 + bytes[offset + 2] * 128 + bytes[offset + 3];
}
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let i = offset; i < offset + length; i++) value += String.fromCharCode(bytes[i]);
  return value;
}
function zero(bytes: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (bytes[i] !== 0) return false;
  return true;
}
function metadataEnd(bytes: Uint8Array, length: number): number | AudioShareMp3Refusal {
  if (length < 3 || ascii(bytes, 0, 3) !== "ID3") return 0;
  if (length < 10) return fail("invalid_metadata");
  const version = bytes[3];
  if ((version !== 3 && version !== 4) || bytes[4] !== 0 || bytes[5] !== 0) return fail("unsupported_metadata");
  const size = synchsafe(bytes, 6);
  if (size === null || size + 10 > length || size + 10 > AUDIO_SHARE_MP3_ENVELOPE_LIMITS.id3Bytes) return fail("invalid_metadata");
  const end = 10 + size;
  let offset = 10, count = 0;
  while (offset < end) {
    if (bytes[offset] === 0) return zero(bytes, offset, end) ? end : fail("invalid_metadata");
    if (end - offset < 10 || ++count > AUDIO_SHARE_MP3_ENVELOPE_LIMITS.id3Frames) return fail("invalid_metadata");
    const id = ascii(bytes, offset, 4);
    if (!metadataIds.has(id) || bytes[offset + 8] !== 0 || bytes[offset + 9] !== 0) return fail("unsupported_metadata");
    const frameLength = version === 4 ? synchsafe(bytes, offset + 4) : u32(bytes, offset + 4);
    if (frameLength === null || frameLength < 1 || frameLength > end - offset - 10) return fail("invalid_metadata");
    offset += 10 + frameLength;
  }
  return end;
}

/** The caller must capture the source before asynchronous work and must verify exact
 * decoded PCM length against outputSamples. No source payload is returned here.
 * MPEG envelope semantics follow the pinned mpg123 parse.c / frame.c; narrower
 * metadata, revision, padding and exact-end rules deliberately reject ambiguity. */
export function parseAudioShareMp3Envelope(bytes: Uint8Array): AudioShareMp3Envelope | AudioShareMp3Refusal {
  let length: number;
  try {
    if (Object.getPrototypeOf(bytes) !== Uint8Array.prototype) return fail("invalid_bytes");
    length = Reflect.apply(byteLengthGetter, bytes, []);
    const buffer = Reflect.apply(bufferGetter, bytes, []);
    if (!(buffer instanceof ArrayBuffer) || length < 4 || length > AUDIO_SHARE_MP3_ENVELOPE_LIMITS.bytes) return fail("invalid_bytes");
  } catch { return fail("invalid_bytes"); }
  const start = metadataEnd(bytes, length);
  if (typeof start !== "number") return start;
  let offset = start;
  let sampleRate: 32000 | 44100 | 48000 | undefined;
  let channels: 1 | 2 | undefined;
  const frames: AudioShareMp3Frame[] = [];
  while (offset < length) {
    if (length - offset < 4) return fail("invalid_frame");
    const a = bytes[offset], b = bytes[offset + 1], c = bytes[offset + 2], d = bytes[offset + 3];
    // MPEG-1 Layer III, no CRC, no free format, no emphasis, no dual-channel mode.
    if (a !== 255 || b !== 251 || ((c >> 2) & 3) === 3 || (d & 3) !== 0 || (d >> 6) === 2) return fail("unsupported_format");
    const rate = rates[(c >> 2) & 3], kbps = bitrate[c >> 4];
    if (!rate || !kbps) return fail("unsupported_format");
    const channelCount = (d >> 6) === 3 ? 1 : 2;
    if (sampleRate !== undefined && (sampleRate !== rate || channels !== channelCount)) return fail("inconsistent_stream");
    sampleRate = rate; channels = channelCount;
    const frameLength = Math.floor(144000 * kbps / rate) + ((c >> 1) & 1);
    if (frameLength > length - offset || frameLength < 4 + (channelCount === 1 ? 17 : 32)) return fail("invalid_frame");
    // Each LAME trim endpoint has 12 bits. Include their full possible sum and
    // the non-audio Info frame, while retaining an independent absolute cap.
    const physicalLimit = Math.min(AUDIO_SHARE_MP3_ENVELOPE_LIMITS.physicalFrames,
      Math.floor((AUDIO_SHARE_MP3_ENVELOPE_LIMITS.seconds * rate + 8190) / 1152) + 1);
    if (frames.length >= physicalLimit) return fail("duration_limit");
    frames.push(Object.freeze({ offset, length: frameLength }));
    offset += frameLength;
  }
  if (!sampleRate || !channels || frames.length < 2) return fail("missing_gapless");
  const first = frames[0], frameEnd = first.offset + first.length;
  const marker = first.offset + 4 + (channels === 1 ? 17 : 32);
  if (marker + 8 > frameEnd || !zero(bytes, first.offset + 4, marker)) return fail("missing_gapless");
  const kind = ascii(bytes, marker, 4);
  if (kind !== "Xing" && kind !== "Info") return fail("missing_gapless");
  const flags = u32(bytes, marker + 4);
  if ((flags & 3) !== 3 || (flags & ~15) !== 0) return fail("invalid_gapless");
  let cursor = marker + 8;
  if (cursor + 8 > frameEnd) return fail("invalid_gapless");
  const declaredFrames = u32(bytes, cursor), declaredBytes = u32(bytes, cursor + 4);
  cursor += 8;
  if (flags & 4) {
    if (cursor + 100 > frameEnd || bytes[cursor] !== 0) return fail("invalid_gapless");
    for (let i = cursor + 1; i < cursor + 100; i++) if (bytes[i] < bytes[i - 1]) return fail("invalid_gapless");
    cursor += 100;
  }
  if (flags & 8) {
    if (cursor + 4 > frameEnd || u32(bytes, cursor) > 100) return fail("invalid_gapless");
    cursor += 4;
  }
  if (cursor + 36 > frameEnd) return fail("invalid_gapless");
  // Known LAME-layout tags only. A bare NUL-padded Lavf is emitted by FFmpeg.
  const encoderField = ascii(bytes, cursor, 9), nul = encoderField.indexOf(String.fromCharCode(0));
  if (nul >= 0 && !zero(bytes, cursor + nul, cursor + 9)) return fail("invalid_gapless");
  const encoder = nul < 0 ? encoderField : encoderField.slice(0, nul);
  if (!/^(?:LAME[0-9]\.[0-9]{2,3}[a-z]?|Lav[cf](?:[0-9]{1,2}\.[0-9]{1,3})?)$/.test(encoder)
    || (bytes[cursor + 9] >> 4) !== 0 || (bytes[cursor + 9] & 15) > 9) return fail("invalid_gapless");
  const encoderDelay = (bytes[cursor + 21] << 4) | (bytes[cursor + 22] >> 4);
  const encoderPadding = ((bytes[cursor + 22] & 15) << 8) | bytes[cursor + 23];
  const extensionBytes = u32(bytes, cursor + 28);
  if (!zero(bytes, cursor + 36, frameEnd)) return fail("invalid_gapless");
  if (declaredFrames !== frames.length - 1 || declaredBytes !== length - start || extensionBytes !== declaredBytes) return fail("inconsistent_stream");
  const encodedSamples = declaredFrames * 1152;
  const outputSamples = encodedSamples - encoderDelay - encoderPadding;
  // mpg123 adds 529 decoder-delay samples to both endpoints. Enough final padding
  // is required so the declared end is actually within the physical audio frames.
  if (encoderPadding < 529 || outputSamples < 1) return fail("invalid_gapless");
  if (outputSamples > AUDIO_SHARE_MP3_ENVELOPE_LIMITS.seconds * sampleRate) return fail("duration_limit");
  return Object.freeze({ ok: true, sampleRate, channels, frames: Object.freeze(frames), firstAudioFrame: 1,
    encodedSamples, encoderDelay, encoderPadding, outputSamples });
}
