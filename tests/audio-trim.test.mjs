import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { PCM_WAV_EDIT_MAX_BYTES, inspectPcmWav, trimPcmWav, pcmWavPeaks } from '../src/model/audio-container.ts';

// Independent, non-silent PCM fixtures; no provider, browser, decoder or filesystem port.
function chunk(name, body, padding = true) {
  const header = Buffer.alloc(8);
  header.write(name, 0, 4, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body, ...(padding && body.length % 2 ? [Buffer.from([0x7f])] : [])]);
}

function container(chunks) {
  const header = Buffer.alloc(12);
  header.write('RIFF', 0);
  header.write('WAVE', 8);
  const wav = Buffer.concat([header, ...chunks]);
  wav.writeUInt32LE(wav.length - 8, 4);
  return wav;
}

function format(channels = 1, sampleRate = 8000, extension = false) {
  const fmt = Buffer.alloc(extension ? 18 : 16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * 2, 8);
  fmt.writeUInt16LE(channels * 2, 12);
  fmt.writeUInt16LE(16, 14);
  return fmt;
}

function pcm(samples) {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
  return bytes;
}

function wav(samples, channels = 1, sampleRate = 8000) {
  return container([chunk('fmt ', format(channels, sampleRate)), chunk('data', pcm(samples))]);
}

function canonicalSamples(bytes) {
  const value = Buffer.from(bytes);
  assert.equal(value.toString('ascii', 0, 4), 'RIFF');
  assert.equal(value.readUInt32LE(4), value.length - 8);
  assert.equal(value.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(value.readUInt32LE(16), 16);
  assert.equal(value.readUInt16LE(20), 1);
  assert.equal(value.readUInt16LE(34), 16);
  assert.equal(value.toString('ascii', 36, 40), 'data');
  assert.equal(value.readUInt32LE(40), value.length - 44);
  const samples = [];
  for (let offset = 44; offset < value.length; offset += 2) samples.push(value.readInt16LE(offset));
  return samples;
}

test('PCM inspection counts complete frames instead of interleaved samples', () => {
  const samples = [1, -2, 32767, -32768, 12000, -23000];
  assert.deepEqual(inspectPcmWav(wav(samples)), { sampleRate: 8000, channels: 1, bitsPerSample: 16, frameCount: 6, durationSeconds: 0.00075 });
  assert.deepEqual(inspectPcmWav(wav(samples, 2, 48000)), { sampleRate: 48000, channels: 2, bitsPerSample: 16, frameCount: 3, durationSeconds: 0.0000625 });
});

test('PCM mono trim preserves exactly the selected non-silent samples and current timing', () => {
  const source = wav([101, -202, 303, -404, 505, -606, 707, -808]);
  const original = Buffer.from(source);
  const result = trimPcmWav(source, 2, 6);
  assert.ok(result);
  assert.equal(result.changed, true);
  assert.equal(result.startFrame, 2);
  assert.equal(result.endFrame, 6);
  assert.equal(result.source.frameCount, 8);
  assert.equal(result.source.durationSeconds, 0.001);
  assert.equal(result.frameCount, 4);
  assert.equal(result.durationSeconds, 0.0005);
  assert.deepEqual(canonicalSamples(result.bytes), [303, -404, 505, -606]);
  assert.deepEqual(inspectPcmWav(result.bytes), { sampleRate: 8000, channels: 1, bitsPerSample: 16, frameCount: 4, durationSeconds: 0.0005 });
  assert.deepEqual(source, original);
  result.bytes[44] ^= 0xff;
  assert.deepEqual(source, original, 'editing the returned array cannot change the source');
});

test('PCM stereo trim keeps both channels at first and last frame boundaries', () => {
  const source = wav([100, -100, 200, -200, 300, -300, 400, -400], 2, 16000);
  const middle = trimPcmWav(source, 1, 3);
  assert.ok(middle);
  assert.deepEqual(canonicalSamples(middle.bytes), [200, -200, 300, -300]);
  assert.equal(middle.bytes.length, 52);
  assert.equal(middle.frameCount, 2);
  assert.equal(middle.durationSeconds, 0.000125);
  assert.equal(Buffer.from(middle.bytes).readUInt32LE(28), 64000);
  assert.equal(Buffer.from(middle.bytes).readUInt16LE(32), 4);
  assert.deepEqual(canonicalSamples(trimPcmWav(source, 0, 1).bytes), [100, -100]);
  assert.deepEqual(canonicalSamples(trimPcmWav(source, 3, 4).bytes), [400, -400]);
});

test('PCM parsing, crop and peaks respect a byte-offset input view', () => {
  const source = wav([8192, -16384, 24576, -32768]);
  const backing = new Uint8Array(source.length + 19).fill(0x5a);
  backing.set(source, 11);
  const view = backing.subarray(11, 11 + source.length);
  assert.equal(inspectPcmWav(view).frameCount, 4);
  assert.deepEqual(canonicalSamples(trimPcmWav(view, 1, 3).bytes), [-16384, 24576]);
  assert.deepEqual(pcmWavPeaks(view, 2), [0.5, 1]);
  assert.ok(backing.subarray(0, 11).every(value => value === 0x5a));
  assert.ok(backing.subarray(11 + source.length).every(value => value === 0x5a));
});

test('PCM full-span no-op makes a byte-identical independent copy including ancillary chunks', () => {
  const source = container([chunk('JUNK', Buffer.from([1, 2, 3])), chunk('fmt ', format(1, 8000, true)), chunk('data', pcm([111, -222, 333])), chunk('LIST', Buffer.from([4, 5]))]);
  const before = Buffer.from(source);
  const result = trimPcmWav(source, 0, 3);
  assert.ok(result);
  assert.equal(result.changed, false);
  assert.deepEqual(Buffer.from(result.bytes), before);
  assert.notEqual(result.bytes.buffer, source.buffer);
  result.bytes[0] = 0;
  assert.deepEqual(source, before);
  const partial = trimPcmWav(source, 1, 3);
  assert.equal(partial.changed, true);
  assert.equal(partial.bytes.length, 48, 'partial output is a canonical header and selected PCM, without old cue/metadata offsets');
  assert.deepEqual(canonicalSamples(partial.bytes), [-222, 333]);
});

test('PCM frame ranges reject empty, out-of-bounds and fractional selections without rounding', () => {
  const source = wav([100, -200, 300, -400]);
  for (const [start, end] of [[0, 0], [2, 2], [3, 2], [-1, 2], [0, 5], [0.5, 2], [1, 2.5], [NaN, 2], [0, Infinity], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]]) {
    assert.equal(trimPcmWav(source, start, end), null, `${start}, ${end}`);
  }
  assert.deepEqual(canonicalSamples(trimPcmWav(source, 1, 2).bytes), [-200]);
});

test('PCM waveform bins retain peaks from both channels without averaging cancellation', () => {
  const source = wav([8192, -8192, 16384, -16384, 24576, -24576, 32767, -32768], 2);
  assert.deepEqual(pcmWavPeaks(source, 2), [0.5, 1]);
  assert.deepEqual(pcmWavPeaks(source, 1), [1]);
  assert.deepEqual(pcmWavPeaks(source), [0.25, 0.5, 0.75, 1]);
  assert.deepEqual(pcmWavPeaks(source, 1024), [0.25, 0.5, 0.75, 1]);
});

test('PCM non-divisible waveform bins cover every frame including the last', () => {
  assert.deepEqual(pcmWavPeaks(wav([8192, 0, -16384, 0, -32768]), 3), [0.25, 0.5, 1]);
  assert.deepEqual(pcmWavPeaks(wav([32767]), 1), [32767 / 32768]);
  for (const bins of [0, -1, 1.5, 1025, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.equal(pcmWavPeaks(wav([1, -2]), bins), null);
});

function changedHeader(mutator) {
  const bytes = wav([101, -202, 303, -404]);
  mutator(bytes);
  return bytes;
}

const rejected = [
  ['non-RIFF container', () => changedHeader(bytes => bytes.write('RIFX', 0))],
  ['non-WAVE form', () => changedHeader(bytes => bytes.write('AVI ', 8))],
  ['declared RIFF shorter than bytes', () => changedHeader(bytes => bytes.writeUInt32LE(bytes.length - 10, 4))],
  ['declared RIFF longer than bytes', () => changedHeader(bytes => bytes.writeUInt32LE(bytes.length, 4))],
  ['truncated chunk payload', () => changedHeader(bytes => bytes.writeUInt32LE(0xffffffff, 40))],
  ['float encoding', () => changedHeader(bytes => bytes.writeUInt16LE(3, 20))],
  ['extensible encoding', () => changedHeader(bytes => bytes.writeUInt16LE(0xfffe, 20))],
  ['unsupported channels', () => changedHeader(bytes => bytes.writeUInt16LE(3, 22))],
  ['unsupported sample width', () => changedHeader(bytes => bytes.writeUInt16LE(8, 34))],
  ['zero sample rate', () => changedHeader(bytes => bytes.writeUInt32LE(0, 24))],
  ['inconsistent byte rate', () => changedHeader(bytes => bytes.writeUInt32LE(123, 28))],
  ['overflowing byte rate', () => changedHeader(bytes => { bytes.writeUInt32LE(0x80000000, 24); bytes.writeUInt32LE(0, 28); })],
  ['inconsistent block alignment', () => changedHeader(bytes => bytes.writeUInt16LE(1, 32))],
  ['duplicate format', () => container([chunk('fmt ', format()), chunk('fmt ', format()), chunk('data', pcm([1, -2]))])],
  ['duplicate data', () => container([chunk('fmt ', format()), chunk('data', pcm([1])), chunk('data', pcm([-2]))])],
  ['data preceding format', () => container([chunk('data', pcm([1, -2])), chunk('fmt ', format())])],
  ['empty data', () => container([chunk('fmt ', format()), chunk('data', Buffer.alloc(0))])],
  ['partial sample frame', () => container([chunk('fmt ', format()), chunk('data', Buffer.from([1, 2, 3]))])],
  ['incomplete format', () => container([chunk('fmt ', format().subarray(0, 15)), chunk('data', pcm([1, -2]))])],
  ['unsupported format extension', () => { const fmt = format(1, 8000, true); fmt.writeUInt16LE(1, 16); return container([chunk('fmt ', fmt), chunk('data', pcm([1, -2]))]); }],
  ['missing odd-chunk padding', () => container([chunk('fmt ', format()), chunk('data', pcm([1, -2])), chunk('JUNK', Buffer.from([1]), false)])],
  ['trailing partial chunk header', () => container([chunk('fmt ', format()), chunk('data', pcm([1, -2])), Buffer.from([1, 2, 3, 4])])],
];

test('PCM operations consistently reject malformed or unsupported containers', () => {
  for (const [label, make] of rejected) {
    const bytes = make();
    assert.equal(inspectPcmWav(bytes), null, label);
    assert.equal(trimPcmWav(bytes, 0, 1), null, label);
    assert.equal(pcmWavPeaks(bytes, 1), null, label);
  }
  assert.equal(inspectPcmWav(new Uint8Array(43)), null);
});

test('PCM input ceiling includes the container and rejects over-limit bytes before work', () => {
  assert.equal(PCM_WAV_EDIT_MAX_BYTES, 26_214_400);
  const atLimit = Buffer.alloc(PCM_WAV_EDIT_MAX_BYTES);
  const header = wav([1, -2]);
  header.copy(atLimit, 0, 0, 44);
  atLimit.writeUInt32LE(atLimit.length - 8, 4);
  atLimit.writeUInt32LE(atLimit.length - 44, 40);
  atLimit.writeInt16LE(12345, 44);
  assert.equal(inspectPcmWav(atLimit).frameCount, 13_107_178);
  assert.deepEqual(canonicalSamples(trimPcmWav(atLimit, 0, 1).bytes), [12345]);
  const tooLarge = Buffer.alloc(PCM_WAV_EDIT_MAX_BYTES + 1);
  assert.equal(inspectPcmWav(tooLarge), null);
  assert.equal(trimPcmWav(tooLarge, 0, 1), null);
  assert.equal(pcmWavPeaks(tooLarge), null);
});
