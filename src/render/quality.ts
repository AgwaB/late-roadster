// Adaptive quality policy (pixel ratio -> bloom -> shadows), apart from the renderer so it can be tested with made-up
// frame times. Every step resizes the render targets (and the shadow step recompiles every material), so it moves
// only on sustained evidence: down after 4 s of slow frames, back up after a long run of steady ones.

/** frame-time EMA (ms) above which frames count as slow (under ~45 fps) */
const SLOW_MS = 22;
/**
 * EMA under which frames count as steady: a 60 Hz display's own frame interval is 16.7 ms, so "steady 60" has to
 * pass (a bar under the display interval could never be met, and quality would never come back once it dropped)
 */
const STEADY_MS = 18.5;
const DOWN_AFTER = 4;
const UP_AFTER = 40;
const UP_AFTER_MAX = 320;
/** a step down this soon after a step up means the step up did not hold */
const FAILED_UP = 20;

export class QualityGovernor {
  level = 0;
  private ema = 16.7;
  private slowFor = 0;
  private steadyFor = 0;
  private age = 0;
  /** s of steady frames needed for the next step up; doubles each time a step up has to be undone */
  private upAfter = UP_AFTER;
  private sinceUp = Infinity;

  constructor(private readonly maxLevel = 3) {}

  /** Feed one frame's delta (s). Returns true when the level changed. */
  step(dt: number): boolean {
    this.age += dt;
    this.sinceUp += dt;
    if (this.age < 8) return false; // load-time compile/upload hitches must not trigger a downgrade
    const ms = Math.min(40, dt * 1000); // single hitches are capped; only sustained slowness moves the EMA
    this.ema += (ms - this.ema) * 0.1;
    if (this.ema > SLOW_MS) {
      this.slowFor += dt;
      this.steadyFor = 0;
    } else if (this.ema < STEADY_MS) {
      this.steadyFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.steadyFor = 0;
    }
    if (this.slowFor > DOWN_AFTER && this.level < this.maxLevel) {
      if (this.sinceUp < FAILED_UP)
        this.upAfter = Math.min(UP_AFTER_MAX, this.upAfter * 2);
      this.level++;
      this.slowFor = this.steadyFor = 0;
      return true;
    }
    if (this.steadyFor > this.upAfter && this.level > 0) {
      this.level--;
      this.steadyFor = 0;
      this.sinceUp = 0;
      return true;
    }
    return false;
  }
}
