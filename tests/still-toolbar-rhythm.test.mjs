import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRequestRhythm, sampleRequestRhythm, startRequestRhythm, getRequestGroupDuration, REQUEST_RHYTHM_TIMING,
} from '../src/still/motion/request-rhythm.js';

const check = test;
function near(actual, expected, tolerance = .001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}
function clock() {
  let wall = 0, serial = 0;
  const queued = new Map();
  return {
    now: () => wall,
    requestFrame: callback => { queued.set(++serial, callback); return serial; },
    cancelFrame: id => queued.delete(id),
    elapse(milliseconds) { wall += milliseconds; },
    tick(milliseconds) {
      wall += milliseconds;
      const [id, callback] = queued.entries().next().value ?? [];
      assert.ok(callback, 'expected one pending animation frame');
      queued.delete(id);
      callback(wall);
    },
    pending: () => queued.size,
  };
}

check('Infusion sampler preserves accepted direction, CSS easing, tint peaks, and rest', () => {
  const start = sampleRequestRhythm(0);
  assert.equal(start.phase, 'right');
  assert.equal(start.shinePosition, 100);
  assert.equal(start.tint, 0);
  const rightMiddle = sampleRequestRhythm(450);
  assert.ok(rightMiddle.shinePosition < 50, 'right sweep must ease out');
  const firstPeak = sampleRequestRhythm(900 * .3425);
  near(firstPeak.shinePosition, 50, .02);
  near(firstPeak.tint, .72);
  const edge = sampleRequestRhythm(1100);
  assert.equal(edge.phase, 'edge');
  assert.equal(edge.shinePosition, 0);
  near(edge.tint, .72 * .472222);
  const leftMiddle = sampleRequestRhythm(1250 + 375);
  assert.equal(leftMiddle.phase, 'left');
  assert.ok(leftMiddle.shinePosition < 50, 'left sweep must ease in');
  const secondPeak = sampleRequestRhythm(1250 + 750 * .6575);
  near(secondPeak.shinePosition, 50, .02);
  near(secondPeak.tint, .72);
  for (const time of [2000, 2250, 2999]) {
    const rest = sampleRequestRhythm(time);
    assert.equal(rest.phase, 'rest');
    assert.equal(rest.shinePosition, 100);
    assert.equal(rest.tint, 0);
  }
});

check('Three compact cycles alternate with two waiting cycles; width follows expansion and second left', () => {
  const stages = [0, 3000, 6000, 8000, 11862.5, 15275, 18275, 21275, 23275, 27137.5, 30550]
    .map(time => sampleRequestRhythm(time).stage);
  assert.deepEqual(stages, ['loading', 'loading', 'loading', 'waiting', 'waiting', 'loading', 'loading', 'loading', 'waiting', 'waiting', 'loading']);
  assert.equal(sampleRequestRhythm(8000).waitingProgress, 0);
  assert.ok(sampleRequestRhythm(8225).waitingProgress > .5);
  assert.equal(sampleRequestRhythm(8450).waitingProgress, 1);
  assert.equal(sampleRequestRhythm(10862.5).waitingProgress, 1);
  assert.equal(sampleRequestRhythm(11862.5).waitingProgress, 1);
  assert.ok(sampleRequestRhythm(13806.25).waitingProgress > .5);
  assert.equal(sampleRequestRhythm(14275).waitingProgress, 0);
  assert.equal(sampleRequestRhythm(15274).waitingProgress, 0);
  assert.equal(sampleRequestRhythm(15275).stage, 'loading');
  assert.equal(getRequestGroupDuration(), 15275);
});

check('A failed third compact checkpoint immediately continues into the 450 ms waiting entry', () => {
  const checks = [], sequence = createRequestRhythm({onCheckpoint: frame => checks.push(frame)});
  sequence.advance(7999);
  assert.equal(sequence.getSnapshot().cycleIndex, 2);
  assert.equal(sequence.getSnapshot().phase, 'left');
  sequence.advance(1);
  assert.equal(checks.at(-1).logicalTime, 8000);
  assert.equal(checks.at(-1).ready, false);
  const entry = sequence.getSnapshot();
  assert.equal(entry.cycleIndex, 3);
  assert.equal(entry.stage, 'waiting');
  assert.equal(entry.phase, 'expand');
  assert.equal(entry.cycleTime, 0, 'no rest may be inserted between the third left and waiting expansion');
  assert.deepEqual(entry.timing, {right: 1125, hold: 350, left: 937.5, rest: 1000, expand: 450, active: 2862.5, total: 3862.5});
  sequence.advance(449);
  assert.ok(sequence.getSnapshot().waitingProgress < 1);
  assert.equal(sequence.getSnapshot().shinePosition, 100);
  assert.equal(sequence.getSnapshot().tint, 0);
  sequence.advance(1);
  assert.equal(sequence.getSnapshot().phase, 'right');
  assert.equal(sequence.getSnapshot().waitingProgress, 1);
});

check('Waiting finishes expanding before its 1125 ms right and 937.5 ms left swipes begin', () => {
  for (const time of [8000, 8100, 8225, 8449.999]) {
    const frame = sampleRequestRhythm(time);
    assert.equal(frame.phase, 'expand');
    assert.ok(frame.waitingProgress < 1);
    assert.equal(frame.shinePosition, 100);
    assert.equal(frame.tint, 0);
  }
  assert.equal(sampleRequestRhythm(8450).phase, 'right');
  assert.equal(sampleRequestRhythm(8450).waitingProgress, 1);
  for (const fraction of [.25, .5, .75]) {
    const waitingRight = sampleRequestRhythm(8450 + 1125 * fraction);
    const compactRight = sampleRequestRhythm(900 * fraction);
    near(waitingRight.shinePosition, compactRight.shinePosition);
    near(waitingRight.tint, compactRight.tint);
    assert.equal(waitingRight.waitingProgress, 1);
    const waitingLeft = sampleRequestRhythm(9925 + 937.5 * fraction);
    const compactLeft = sampleRequestRhythm(1250 + 750 * fraction);
    near(waitingLeft.shinePosition, compactLeft.shinePosition);
    near(waitingLeft.tint, compactLeft.tint);
    assert.equal(waitingLeft.waitingProgress, 1);
  }
  assert.equal(sampleRequestRhythm(9575).phase, 'edge');
  assert.equal(sampleRequestRhythm(9925).phase, 'left');
  assert.equal(sampleRequestRhythm(10862.5).phase, 'rest');
  const second = sampleRequestRhythm(11862.5);
  assert.equal(second.phase, 'right');
  assert.equal(second.timing.expand, 0);
  assert.equal(second.timing.right, 1125);
  assert.equal(second.timing.left, 937.5);
  assert.equal(sampleRequestRhythm(13337.5).phase, 'left');
  assert.equal(sampleRequestRhythm(14275).waitingProgress, 0);
});

check('Final actions ready at the third left preserve the 250 ms pause and bypass waiting', () => {
  const frames = [], opens = [], sequence = createRequestRhythm({
    isReady: frame => frame.logicalTime >= 8000,
    onFrame: frame => frames.push(frame), onOpen: frame => opens.push(frame),
  });
  sequence.advance(8000);
  assert.equal(sequence.getSnapshot().status, 'pending-open');
  assert.equal(sequence.getSnapshot().cycleIndex, 2);
  assert.equal(sequence.getSnapshot().stage, 'loading');
  sequence.advance(249);
  assert.equal(opens.length, 0);
  sequence.advance(1);
  assert.equal(opens[0].logicalTime, 8250);
  assert.equal(opens[0].waitingProgress, 0);
  assert.ok(frames.every(frame => frame.stage === 'loading'));
});

check('An arrival during waiting entry waits its left, and one just after that left waits the full rest', () => {
  for (const [arrival, openAt] of [[8000.001, 11112.5], [8225, 11112.5], [10862.5, 11112.5], [10862.501, 14525]]) {
    const opens = [], checks = [], sequence = createRequestRhythm({
      isReady: frame => frame.logicalTime >= arrival,
      onCheckpoint: frame => checks.push(frame), onOpen: frame => opens.push(frame),
    });
    sequence.advance(openAt - 1);
    assert.equal(opens.length, 0);
    sequence.advance(1);
    assert.equal(opens[0].logicalTime, openAt);
    assert.equal(checks.at(-1).logicalTime, openAt - 250);
    if (arrival > 10862.5) assert.deepEqual(checks.slice(-2).map(frame => [frame.logicalTime, frame.ready]), [[10862.5, false], [14275, true]]);
  }
});

check('Custom Infusion settings separate expansion and longer waiting swipes; speed and visibility preserve them', () => {
  const timing = {right: 600, hold: 100, left: 400, rest: 800};
  const timer = clock(), opens = [];
  let hidden = false;
  const sequence = startRequestRhythm({...timer, getTiming: () => timing, getScale: () => 2,
    isSuspended: () => hidden, isReady: frame => frame.logicalTime >= 5000,
    onOpen: frame => opens.push(frame),
  });
  timer.tick(9800);
  assert.equal(sequence.getSnapshot().logicalTime, 4900);
  assert.equal(sequence.getSnapshot().stage, 'waiting');
  assert.deepEqual(sequence.getSnapshot().timing, {right: 750, hold: 100, left: 500, rest: 800, expand: 300, active: 1650, total: 2450});
  timer.tick(300);
  const progress = sequence.getSnapshot().waitingProgress;
  assert.ok(progress > .5 && progress < 1);
  hidden = true;
  sequence.sync();
  timer.tick(100000);
  assert.equal(sequence.getSnapshot().waitingProgress, progress);
  hidden = false;
  sequence.sync();
  timer.tick(300);
  assert.equal(sequence.getSnapshot().phase, 'right');
  assert.equal(sequence.getSnapshot().waitingProgress, 1);
  assert.equal(sequence.getSnapshot().tint, 0);
  timer.tick(2700);
  assert.equal(sequence.getSnapshot().logicalTime, 6550);
  assert.equal(sequence.getSnapshot().status, 'pending-open');
  timer.tick(499);
  assert.equal(opens.length, 0);
  timer.tick(1);
  assert.equal(opens[0].logicalTime, 6800);
  assert.equal(getRequestGroupDuration(timing), 9500);
  assert.equal(sampleRequestRhythm(9500, timing).cycleIndex, 5);
  assert.equal(sampleRequestRhythm(9500, timing).cycleTime, 0);
});

check('Four arrival moments finish the complete swipe and admit results only after the 250 ms pause', () => {
  for (const [arrival, expectedOpen] of [[-100, 2250], [1000, 2250], [2100, 5250], [6500, 8250]]) {
    const opens = [], checks = [];
    const sequence = createRequestRhythm({
      isReady: frame => frame.logicalTime >= arrival,
      onCheckpoint: frame => checks.push(frame),
      onOpen: frame => opens.push(frame),
    });
    sequence.advance(expectedOpen - .5);
    assert.equal(opens.length, 0, `arrival ${arrival} opened before its pause ended`);
    sequence.advance(.5);
    assert.equal(opens.length, 1);
    assert.equal(opens[0].logicalTime, expectedOpen);
    assert.equal(opens[0].status, 'opened');
    assert.ok(checks.every(frame => frame.phase === 'left' && frame.phaseProgress === 1));
    sequence.advance(100000);
    assert.equal(opens.length, 1, 'completion must not reopen');
  }
});

check('Every source must be ready; late results cannot be admitted retroactively across a long frame', () => {
  const arrivals = {context: 1200, jev: 2100}, checks = [], opens = [];
  const sequence = createRequestRhythm({
    isReady: frame => Object.values(arrivals).every(arrival => arrival <= frame.logicalTime),
    onCheckpoint: frame => checks.push([frame.logicalTime, frame.ready]),
    onOpen: frame => opens.push(frame.logicalTime),
  });
  sequence.advance(20000);
  assert.deepEqual(checks, [[2000, false], [5000, true]]);
  assert.deepEqual(opens, [5250]);
});

check('Readiness at the left boundary succeeds; readiness immediately after it waits a full rest and cycle', () => {
  for (const [arrival, expectedOpen] of [[2000, 2250], [2000.001, 5250], [2250, 5250], [2999, 5250]]) {
    const opens = [];
    const sequence = createRequestRhythm({isReady: frame => arrival <= frame.logicalTime, onOpen: frame => opens.push(frame.logicalTime)});
    sequence.advance(6000);
    assert.deepEqual(opens, [expectedOpen]);
  }
});

check('Waiting can exit after either left; opener receives the actual expanded or collapsed surface', () => {
  for (const [arrival, openAt, waitingProgress, surface] of [[9500, 11112.5, 1, 'waiting'], [11500, 14525, 0, 'loading']]) {
    let opened;
    const sequence = createRequestRhythm({isReady: frame => arrival <= frame.logicalTime, onOpen: frame => { opened = frame; }});
    sequence.advance(20000);
    assert.equal(opened.logicalTime, openAt);
    assert.equal(opened.waitingProgress, waitingProgress);
    assert.equal(opened.surface, surface);
    assert.equal(opened.stage, 'waiting');
  }
});

check('Recovery defers an expanded waiting failure until the second left returns to compact loading', () => {
  const checkpoints = [], opens = [];
  const sequence = createRequestRhythm({
    isReady: frame => frame.logicalTime >= 9000,
    canOpen: frame => frame.surface === 'loading',
    onCheckpoint: frame => checkpoints.push(frame),
    onOpen: frame => opens.push(frame),
  });
  sequence.advance(11112.5);
  assert.equal(opens.length, 0, 'Recovery must not open from the expanded first waiting left');
  assert.equal(sequence.getSnapshot().status, 'running');
  assert.equal(sequence.getSnapshot().surface, 'waiting');
  assert.equal(checkpoints.at(-1).logicalTime, 10862.5);
  sequence.advance(3161.5);
  assert.equal(sequence.getSnapshot().phase, 'left');
  assert.ok(sequence.getSnapshot().waitingProgress > 0);
  assert.equal(opens.length, 0);
  sequence.advance(1);
  assert.equal(sequence.getSnapshot().status, 'pending-open');
  assert.equal(sequence.getSnapshot().surface, 'loading');
  sequence.advance(249);
  assert.equal(opens.length, 0);
  sequence.advance(1);
  assert.equal(opens.length, 1);
  assert.equal(opens[0].logicalTime, 14525);
  assert.equal(opens[0].waitingProgress, 0);
  assert.equal(opens[0].surface, 'loading');
});

check('Recovery from compact loading still waits for the complete left swipe and 250 ms pause', () => {
  const opens = [];
  const sequence = createRequestRhythm({
    isReady: frame => frame.logicalTime >= 1000,
    canOpen: frame => frame.surface === 'loading',
    onOpen: frame => opens.push(frame),
  });
  sequence.advance(2000);
  assert.equal(sequence.getSnapshot().status, 'pending-open');
  assert.equal(opens.length, 0);
  sequence.advance(249);
  assert.equal(opens.length, 0);
  sequence.advance(1);
  assert.equal(opens[0].logicalTime, 2250);
  assert.equal(opens[0].surface, 'loading');
});

check('Recovery arriving just after a compact checkpoint waits for the next eligible left', () => {
  for (const [arrival, openAt] of [[2000.001, 5250], [8000.001, 14525], [14275.001, 17525]]) {
    const opens = [], sequence = createRequestRhythm({
      isReady: frame => frame.logicalTime >= arrival,
      canOpen: frame => frame.surface === 'loading',
      onOpen: frame => opens.push(frame),
    });
    sequence.advance(openAt - 1);
    assert.equal(opens.length, 0, `Failure at ${arrival} must wait for its compact checkpoint`);
    sequence.advance(1);
    assert.equal(opens[0].logicalTime, openAt);
    assert.equal(opens[0].surface, 'loading');
  }
});

check('Cancelling a failure deferred during expanded waiting prevents a later Recovery opening', () => {
  const opens = [], sequence = createRequestRhythm({
    isReady: frame => frame.logicalTime >= 9000,
    canOpen: frame => frame.surface === 'loading',
    onOpen: frame => opens.push(frame),
  });
  sequence.advance(11112.5);
  assert.equal(sequence.getSnapshot().surface, 'waiting');
  assert.equal(sequence.getSnapshot().status, 'running');
  sequence.cancel();
  sequence.advance(100000);
  assert.equal(sequence.getSnapshot().status, 'cancelled');
  assert.deepEqual(opens, []);
});

check('A delayed frame visits all ten left checkpoints and repeats the 3 / 2 cadence exactly', () => {
  const checks = [];
  const sequence = createRequestRhythm({onCheckpoint: frame => checks.push(frame)});
  sequence.advance(30550);
  assert.equal(checks.length, 10);
  assert.deepEqual(checks.map(frame => frame.logicalTime), [2000, 5000, 8000, 10862.5, 14275, 17275, 20275, 23275, 26137.5, 29550]);
  assert.deepEqual(checks.map(frame => frame.stage), ['loading', 'loading', 'loading', 'waiting', 'waiting', 'loading', 'loading', 'loading', 'waiting', 'waiting']);
  assert.equal(sequence.getSnapshot().cycleIndex, 10);
  assert.equal(sequence.getSnapshot().cycleTime, 0);
  assert.equal(sequence.getSnapshot().checkpointNumber, 10);
});

check('Timing changes wait for the next cycle, including a zero-length hold and rest', () => {
  let timing = REQUEST_RHYTHM_TIMING;
  const checks = [], sequence = createRequestRhythm({getTiming: () => timing, onCheckpoint: frame => checks.push(frame.logicalTime)});
  sequence.advance(1000);
  timing = {right: 250, hold: 50, left: 250, rest: 450};
  sequence.advance(2000);
  assert.deepEqual(checks, [2000]);
  assert.equal(sequence.getSnapshot().timing.total, 1000);
  sequence.advance(550);
  assert.deepEqual(checks, [2000, 3550]);
  timing = {right: 250, hold: 0, left: 250, rest: 0};
  sequence.advance(1700);
  assert.deepEqual(checks, [2000, 3550, 4500, 5250]);
  assert.equal(sequence.getSnapshot().cycleIndex, 4);
  assert.throws(() => sequence.advance(-1), RangeError);
});

check('Live playback speed changes preserve logical progress and apply to the final pause', () => {
  const timer = clock();
  let scale = 1;
  const opens = [], sequence = startRequestRhythm({...timer, getScale: () => scale, isReady: () => true, onOpen: frame => opens.push(frame.logicalTime)});
  timer.tick(1000);
  assert.equal(sequence.getSnapshot().logicalTime, 1000);
  scale = 2;
  timer.tick(1000);
  assert.equal(sequence.getSnapshot().logicalTime, 1500);
  scale = .5;
  timer.tick(250);
  assert.equal(sequence.getSnapshot().logicalTime, 2000);
  assert.equal(sequence.getSnapshot().status, 'pending-open');
  timer.tick(124);
  assert.deepEqual(opens, []);
  timer.tick(1);
  assert.deepEqual(opens, [2250]);
  assert.equal(timer.pending(), 0);
});

check('Manual arrival sync flushes missed checkpoints before readiness changes', () => {
  const timer = clock(), checks = [], opens = [];
  let ready = false;
  const sequence = startRequestRhythm({...timer, isReady: () => ready, onCheckpoint: frame => checks.push([frame.logicalTime, frame.ready]), onOpen: frame => opens.push(frame.logicalTime)});
  timer.tick(1900);
  timer.elapse(250);
  sequence.sync();
  ready = true;
  assert.deepEqual(checks, [[2000, false]]);
  timer.tick(2850);
  assert.deepEqual(checks, [[2000, false], [5000, true]]);
  assert.deepEqual(opens, []);
  timer.tick(250);
  assert.deepEqual(opens, [5250]);
});

check('Abort stops work before or during a cycle and during the opening pause', () => {
  for (const when of ['before', 1000, 2200]) {
    const timer = clock(), controller = new AbortController(), opens = [];
    if (when === 'before') controller.abort();
    const sequence = startRequestRhythm({...timer, signal: controller.signal, isReady: () => true, onOpen: frame => opens.push(frame)});
    if (when !== 'before') { timer.tick(when); controller.abort(); }
    assert.equal(sequence.getSnapshot().status, 'cancelled');
    assert.equal(timer.pending(), 0);
    timer.elapse(10000);
    sequence.sync();
    assert.deepEqual(opens, []);
  }
});

check('Cancellation from the final render cannot fire a stale open callback', () => {
  const timer = clock(), opens = [];
  let sequence;
  sequence = startRequestRhythm({...timer, isReady: () => true,
    onFrame: frame => { if (frame.status === 'opened') sequence.cancel(); },
    onOpen: frame => opens.push(frame),
  });
  timer.tick(2250);
  assert.deepEqual(opens, []);
  assert.equal(timer.pending(), 0);
});

check('Hidden time cannot skip visible swipes or readiness checkpoints after resuming', () => {
  const timer = clock(), checks = [], opens = [];
  let hidden = false;
  const sequence = startRequestRhythm({...timer, isSuspended: () => hidden, isReady: () => true,
    onCheckpoint: frame => checks.push(frame.logicalTime), onOpen: frame => opens.push(frame.logicalTime),
  });
  timer.tick(1000);
  timer.elapse(100);
  hidden = true;
  sequence.sync();
  timer.elapse(100000);
  sequence.sync();
  assert.equal(sequence.getSnapshot().logicalTime, 1000);
  assert.deepEqual(checks, []);
  hidden = false;
  sequence.sync();
  timer.tick(999);
  assert.equal(sequence.getSnapshot().logicalTime, 1999);
  assert.deepEqual(checks, []);
  timer.tick(1);
  assert.deepEqual(checks, [2000]);
  timer.tick(250);
  assert.deepEqual(opens, [2250]);
});

check('Starting hidden and suspending the final pause preserve the entire visible sequence', () => {
  const timer = clock(), opens = [];
  let hidden = true;
  const sequence = startRequestRhythm({...timer, isSuspended: () => hidden, isReady: () => true,
    onOpen: frame => opens.push(frame.logicalTime),
  });
  timer.tick(100000);
  assert.equal(sequence.getSnapshot().logicalTime, 0);
  hidden = false;
  timer.tick(5000);
  assert.equal(sequence.getSnapshot().logicalTime, 0, 'first resumed frame must discard hidden elapsed time');
  timer.tick(2000);
  assert.equal(sequence.getSnapshot().status, 'pending-open');
  hidden = true;
  sequence.sync();
  timer.tick(100000);
  assert.deepEqual(opens, []);
  hidden = false;
  sequence.sync();
  timer.tick(249);
  assert.deepEqual(opens, []);
  timer.tick(1);
  assert.deepEqual(opens, [2250]);
});

