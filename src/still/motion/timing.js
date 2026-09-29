/** Accepted timing shared by loading and Thread. Durations are milliseconds. */
export const INFUSION_TIMING = Object.freeze({right:900, hold:350, left:750, rest:1000});
export const THREAD_TIMING = Object.freeze({
  duration:1040,
  pagingDuration:800,
  openingSweepExtension:100,
  closingSweepRatio:INFUSION_TIMING.left / INFUSION_TIMING.right,
});
