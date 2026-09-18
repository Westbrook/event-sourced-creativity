import compiledDecoder from "./decoder.wasm";

/** Exact pinned ABI; this adapter exposes no decoding or allocation authority. */
export const MPG123_SHARE_DECODER_SHA256 = "f0e9e8848367320ccb757e4092f0d6809668cfe38f43139d47b447151d7dff6b" as const;
export const MPG123_SHARE_MEMORY_BYTES = 16_973_824;
const INPUT_BYTES = 1441;
// The pinned C wrapper ignores out_size. Its full fixed output allocation is
// retained even though a separately checked single frame is much smaller.
const OUTPUT_FLOATS = 92_448;
const exportNames = ["k", "l", "m", "n", "o", "p", "q", "r", "s", "t"];
type Fn = (...args: number[]) => number;
type Codec = {
  heap: Uint8Array<ArrayBuffer>; words: Uint32Array<ArrayBuffer>; floats: Float32Array<ArrayBuffer>;
  malloc: Fn; free: Fn; create: Fn; feed: Fn; read: Fn; destroy: Fn;
};
let attempted = false, singleton: Codec | null = null, leased = false, poisoned = false;
function codec(): Codec {
  if (poisoned) throw new Error("decoder_unavailable");
  if (singleton) return singleton;
  if (attempted) throw new Error("decoder_unavailable");
  attempted = true; // A failed module initialization cannot allocate repeatedly.
  const forbidden = () => { throw new Error("decoder_forbidden_import"); };
  const instance = new WebAssembly.Instance(compiledDecoder, { a: {
    a: forbidden, b: () => 0, c: forbidden, d: forbidden, e: () => 0,
    f: () => 52, g: () => 52, h: () => 52, i: () => 70, j: forbidden,
  } });
  const exports = instance.exports;
  if (Object.keys(exports).length !== exportNames.length || exportNames.some(key => !Object.hasOwn(exports, key))
    || !(exports.k instanceof WebAssembly.Memory) || exports.k.buffer.byteLength !== MPG123_SHARE_MEMORY_BYTES
    || !(exports.o instanceof WebAssembly.Table)
    || exportNames.filter(key => key !== "k" && key !== "o").some(key => typeof exports[key] !== "function")) throw new Error("decoder_abi");
  (exports.l as Fn)();
  const heap = new Uint8Array(exports.k.buffer as ArrayBuffer);
  singleton = { heap, words: new Uint32Array(heap.buffer), floats: new Float32Array(heap.buffer),
    malloc: exports.m as Fn, free: exports.n as Fn, create: exports.p as Fn,
    feed: exports.q as Fn, read: exports.r as Fn, destroy: exports.s as Fn };
  return singleton;
}
export type Mp3DecoderLease = Readonly<{
  /** Feed exactly one parsed MPEG frame; no state or heap is exposed. */
  frame(bytes: Uint8Array, accept: (left: number, right: number) => void): Readonly<{ samples: number; rate: number; done: boolean; reads: number }>;
  close(): void;
}>;

/** One instance and one live lease per isolate; a concurrent caller refuses. */
export function acquireMp3ShareDecoder(): Mp3DecoderLease | null {
  if (leased || poisoned) return null;
  leased = true;
  const allocated: { pointer: number; bytes: number }[] = [];
  let current: Codec | null = null, decoder = 0, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      if (poisoned) { current?.heap.fill(0); singleton = null; return; }
      // destroy already frees the decoder's own struct. Never free it twice.
      if (decoder && current) current.destroy(decoder);
      if (current) for (let i = allocated.length - 1; i >= 0; i--) {
        const range = allocated[i]!; current.heap.fill(0, range.pointer, range.pointer + range.bytes); current.free(range.pointer);
      }
    } catch { poisoned = true; current?.heap.fill(0); singleton = null; }
    finally { leased = false; decoder = 0; allocated.length = 0; }
  };
  try {
    current = codec();
    const state = current;
    const allocate = (bytes: number) => {
      let pointer: number;
      try { pointer = state.malloc(bytes); }
      catch { poisoned = true; throw new Error("decoder_allocation_trap"); }
      if (pointer === 0) throw new Error("decoder_allocation");
      if (!Number.isSafeInteger(pointer) || pointer < 0 || pointer % 4 || pointer + bytes > state.heap.length) {
        poisoned = true; throw new Error("decoder_allocation");
      }
      allocated.push({ pointer, bytes }); state.heap.fill(0, pointer, pointer + bytes); return pointer;
    };
    const input = allocate(INPUT_BYTES + 3), output = allocate(OUTPUT_FLOATS * 4);
    const handle = allocate(4), count = allocate(4), rate = allocate(4), error = allocate(4);
    let created: number;
    try { created = state.create(handle, 1); }
    catch { poisoned = true; throw new Error("decoder_constructor_trap"); }
    decoder = state.words[handle / 4]!;
    if (!decoder || decoder % 4 || decoder + OUTPUT_FLOATS * 4 + 4 >= state.heap.length) {
      decoder = 0; poisoned = true; throw new Error("decoder_constructor");
    }
    // A returned error has initialized mh, possibly NULL. Pinned mpg123_delete
    // explicitly tolerates NULL, so normal partial initialization closes once.
    if (created !== 0) throw new Error("decoder_constructor");
    return Object.freeze({
      frame(bytes: Uint8Array, accept: (left: number, right: number) => void) {
        if (closed || bytes.length < 24 || bytes.length > INPUT_BYTES) throw new Error("decoder_frame");
        state.heap.fill(0, input, input + INPUT_BYTES); state.heap.set(bytes, input);
        let fed: number;
        try { fed = state.feed(decoder, input, bytes.length); }
        catch { poisoned = true; throw new Error("decoder_feed_trap"); }
        if (fed !== 0 && fed !== -10) throw new Error("decoder_feed");
        let samples = 0, sampleRate = 0, done = false;
        for (let reads = 1; reads <= 4; reads++) {
          state.words[count / 4] = 0; state.words[rate / 4] = 0;
          state.heap.fill(0, output, output + OUTPUT_FLOATS * 4);
          let result: number;
          try { result = state.read(decoder, output, OUTPUT_FLOATS, count, rate, error); }
          catch { poisoned = true; throw new Error("decoder_read_trap"); }
          const length = state.words[count / 4]!, observedRate = state.words[rate / 4]!;
          if (length > 2304 || samples + length > 2304 || length && observedRate !== 32000 && observedRate !== 44100 && observedRate !== 48000
            || length && sampleRate && observedRate !== sampleRate) throw new Error("decoder_samples");
          if (length) sampleRate = observedRate;
          for (let frame = 0; frame < length; frame++) accept(state.floats[output / 4 + frame]!, state.floats[output / 4 + length + frame]!);
          samples += length;
          if (result === -10 || result === -12) {
            done = result === -12;
            return Object.freeze({ samples, rate: sampleRate, done, reads });
          }
          if (result !== 0 && result !== -11) throw new Error("decoder_read");
        }
        throw new Error("decoder_read_bound");
      },
      close,
    });
  } catch { close(); return null; }
}
