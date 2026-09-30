// Request playback has its own logical clock. A response is admitted only at
// the end of a left swipe; rendering and source readiness share that boundary.
import {INFUSION_TIMING} from './timing.js';
export const REQUEST_RHYTHM_TIMING = INFUSION_TIMING;

const clamp = value => Math.min(1, Math.max(0, value));
const EPSILON = 1e-7;

function normalizeTiming(value = REQUEST_RHYTHM_TIMING) {
  const timing = {};
  for (const key of ['right', 'hold', 'left', 'rest']) {
    const number = Number(value?.[key]);
    timing[key] = Number.isFinite(number) && number >= (key === 'right' || key === 'left' ? 1 : 0)
      ? number : REQUEST_RHYTHM_TIMING[key];
  }
  timing.active = timing.right + timing.hold + timing.left;
  timing.total = timing.active + timing.rest;
  return Object.freeze(timing);
}

function timingForCycle(cycleIndex, baseTiming) {
  const groupIndex = cycleIndex % 5;
  const timing = {...baseTiming, expand: groupIndex === 3 ? baseTiming.right * .5 : 0};
  // A failed third compact checkpoint continues directly into the waiting
  // expansion. Waiting's wash begins only after this separate expansion and
  // takes 1.25 times the selected swipe durations across its wider surface.
  if (groupIndex === 2) timing.rest = 0;
  if (groupIndex >= 3) { timing.right *= 1.25; timing.left *= 1.25; }
  timing.active = timing.expand + timing.right + timing.hold + timing.left;
  timing.total = timing.active + timing.rest;
  return Object.freeze(timing);
}

// CSS easing coordinates are x(time), y(progress), so solve x before sampling y.
function bezier(x1, y1, x2, y2) {
  const coordinate = (time, first, second) => 3 * (1 - time) ** 2 * time * first
    + 3 * (1 - time) * time ** 2 * second + time ** 3;
  return value => {
    const progress = clamp(value);
    if (progress === 0 || progress === 1) return progress;
    let low = 0, high = 1;
    for (let attempt = 0; attempt < 32; attempt++) {
      const time = (low + high) / 2;
      if (coordinate(time, x1, x2) < progress) low = time;
      else high = time;
    }
    return coordinate((low + high) / 2, y1, y2);
  };
}

const easeOut = bezier(0, 0, .58, 1);
const easeIn = bezier(.42, 0, 1, 1);
const easeInOut = bezier(.42, 0, .58, 1);

function tintAt(time, timing) {
  const {right, hold, left, expand} = timing;
  if (time < expand) return 0;
  time -= expand;
  // Keep the tone's easing and peak locations in sync with infusion-timing.js.
  const stops = [...new Map([
    [0, 0], [right * .3425, 1], [right, .472222],
    [right + hold, .472222], [right + hold + left * .6575, 1], [right + hold + left, 0],
  ]).entries()];
  for (let index = 1; index < stops.length; index++) {
    const [start, before] = stops[index - 1], [end, after] = stops[index];
    if (time <= end) return before + (after - before) * easeInOut((time - start) / (end - start));
  }
  return 0;
}

function sampleCycle(cycleIndex, cycleTime, timing, logicalTime) {
  const groupIndex = cycleIndex % 5;
  const stage = groupIndex < 3 ? 'loading' : 'waiting';
  const groupCycle = stage === 'loading' ? groupIndex + 1 : groupIndex - 2;
  const swipeTime = cycleTime - timing.expand;
  let phase, phaseProgress, shinePosition;
  if (cycleTime < timing.expand) {
    phase = 'expand';
    phaseProgress = clamp(cycleTime / timing.expand);
    shinePosition = 100;
  } else if (swipeTime < timing.right) {
    phase = 'right';
    phaseProgress = clamp(swipeTime / timing.right);
    shinePosition = 100 * (1 - easeOut(phaseProgress));
  } else if (swipeTime < timing.right + timing.hold) {
    phase = 'edge';
    phaseProgress = clamp((swipeTime - timing.right) / timing.hold);
    shinePosition = 0;
  } else if (cycleTime < timing.active) {
    phase = 'left';
    phaseProgress = clamp((swipeTime - timing.right - timing.hold) / timing.left);
    shinePosition = 100 * easeIn(phaseProgress);
  } else {
    phase = 'rest';
    phaseProgress = timing.rest ? clamp((cycleTime - timing.active) / timing.rest) : 1;
    shinePosition = 100;
  }
  let waitingProgress = 0;
  if (stage === 'waiting') {
    waitingProgress = groupCycle === 1
      ? (phase === 'expand' ? easeOut(phaseProgress) : 1)
      : (phase === 'left' ? 1 - easeIn(phaseProgress) : phase === 'rest' ? 0 : 1);
  }
  const tintStrength = tintAt(cycleTime, timing);
  return {
    stage, groupCycle, cycleIndex, phase, phaseProgress, waitingProgress,
    surface: waitingProgress > EPSILON ? 'waiting' : 'loading',
    shinePosition, tint: tintStrength * .72, tintStrength,
    cycleTime, logicalTime, timing,
  };
}

function groupTimings(timingValue) {
  const baseTiming = normalizeTiming(timingValue);
  return Array.from({length: 5}, (_, index) => timingForCycle(index, baseTiming));
}

/** Full 3 compact / 2 waiting group, including expansion and continuing rests. */
export function getRequestGroupDuration(timingValue = REQUEST_RHYTHM_TIMING) {
  return groupTimings(timingValue).reduce((total, timing) => total + timing.total, 0);
}

/** Sample an indefinite 3 loading / 2 waiting sequence from fixed settings. */
export function sampleRequestRhythm(logicalTime, timingValue = REQUEST_RHYTHM_TIMING) {
  const cycles = groupTimings(timingValue);
  const groupDuration = cycles.reduce((total, timing) => total + timing.total, 0);
  const time = Math.max(0, Number(logicalTime) || 0);
  const group = Math.floor(time / groupDuration);
  let cycleTime = time - group * groupDuration, groupIndex = 0;
  while (groupIndex < 4 && cycleTime >= cycles[groupIndex].total) {
    cycleTime -= cycles[groupIndex].total;
    groupIndex++;
  }
  return sampleCycle(group * 5 + groupIndex, cycleTime, cycles[groupIndex], time);
}

/**
 * Deterministic scheduler. advance() accepts elapsed logical milliseconds.
 * Timing is captured at each cycle's start. isReady receives the exact left
 * boundary even if one advance crosses multiple cycles, so a caller can compare
 * source arrival timestamps without admitting a response to an earlier check.
 * canOpen can defer a ready outcome until an eligible surface is reached.
 */
export function createRequestRhythm({
  getTiming = () => REQUEST_RHYTHM_TIMING,
  isReady = () => false,
  canOpen = () => true,
  onFrame = () => {},
  onCheckpoint = () => {},
  onOpen = () => {},
  openPause = 250,
} = {}) {
  const pause = Math.max(0, Number.isFinite(Number(openPause)) ? Number(openPause) : 250);
  let timing = timingForCycle(0, normalizeTiming(getTiming()));
  let logicalTime = 0, cycleStart = 0, cycleIndex = 0, checkpointNumber = 0;
  let checked = false, openAt = null, status = 'running', cancelled = false;
  const snapshot = () => ({
    ...sampleCycle(cycleIndex, logicalTime - cycleStart, timing, logicalTime),
    checkpointNumber, status, openingPending: status === 'pending-open', openAt,
  });
  const stopped = () => cancelled || status === 'opened';
  const emit = () => { const frame = snapshot(); onFrame(frame); return frame; };
  function advance(deltaMs = 0) {
    if (stopped()) return snapshot();
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('advance requires non-negative finite milliseconds');
    const target = logicalTime + deltaMs;
    while (!stopped()) {
      if (status === 'pending-open') {
        logicalTime = Math.min(target, openAt);
        if (logicalTime + EPSILON >= openAt) {
          logicalTime = openAt;
          status = 'opened';
          const frame = emit();
          if (!cancelled) onOpen(frame);
          return frame;
        }
        return emit();
      }
      const checkpointAt = cycleStart + timing.active;
      if (!checked && target + EPSILON >= checkpointAt) {
        logicalTime = checkpointAt;
        checked = true;
        checkpointNumber++;
        const checkpoint = {...snapshot(), phase: 'left', phaseProgress: 1};
        const ready = Boolean(isReady(checkpoint));
        if (stopped()) return snapshot();
        const eligible = Boolean(canOpen(checkpoint));
        if (stopped()) return snapshot();
        const openingPending = ready && eligible;
        if (openingPending) { status = 'pending-open'; openAt = logicalTime + pause; }
        onCheckpoint({...checkpoint, ready, eligible, status, openingPending, openAt});
        if (stopped()) return snapshot();
        emit();
        continue;
      }
      const cycleEnd = cycleStart + timing.total;
      if (checked && target + EPSILON >= cycleEnd) {
        logicalTime = cycleEnd;
        cycleStart = cycleEnd;
        cycleIndex++;
        timing = timingForCycle(cycleIndex, normalizeTiming(getTiming()));
        checked = false;
        continue;
      }
      logicalTime = target;
      return emit();
    }
    return snapshot();
  }
  return {
    advance,
    cancel() { if (!stopped()) status = 'cancelled'; cancelled = true; return snapshot(); },
    getSnapshot: snapshot,
  };
}

/** Browser clock adapter. scale 2 means half-speed; no CSS or DOM is required. */
export function startRequestRhythm({
  getScale = () => 1,
  isSuspended = () => false,
  signal,
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame(id),
  now = () => performance.now(),
  ...options
} = {}) {
  let frameId = null, lastTime = now(), stopped = false;
  let wasSuspended = Boolean(isSuspended());
  const removeAbort = () => signal?.removeEventListener('abort', cancel);
  const scheduler = createRequestRhythm({
    ...options,
    onOpen(frame) {
      if (stopped) return;
      stopped = true;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      removeAbort();
      options.onOpen?.(frame);
    },
  });
  function cancel() {
    stopped = true;
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    removeAbort();
    return scheduler.cancel();
  }
  function update(time) {
    if (stopped) return scheduler.getSnapshot();
    const suspended = Boolean(isSuspended());
    const elapsed = Math.max(0, time - lastTime);
    lastTime = time;
    // Discard hidden time, including the first update after returning. The
    // caller can sync on visibility changes even when rAF itself is suspended.
    const skipElapsed = suspended || wasSuspended;
    wasSuspended = suspended;
    if (skipElapsed) return scheduler.getSnapshot();
    const value = Number(getScale());
    const scale = Number.isFinite(value) && value > 0 ? value : 1;
    return scheduler.advance(elapsed / scale);
  }
  function tick(time) {
    frameId = null;
    if (stopped) return;
    update(time);
    if (!stopped) frameId = requestFrame(tick);
  }
  if (signal?.aborted) cancel();
  else {
    signal?.addEventListener('abort', cancel, {once: true});
    scheduler.advance(0);
    if (!stopped) frameId = requestFrame(tick);
  }
  // Flush elapsed wall time before recording an external/manual arrival. A late
  // response then cannot be retroactively admitted by a delayed animation frame.
  return {cancel, sync: () => update(now()), getSnapshot: scheduler.getSnapshot};
}
