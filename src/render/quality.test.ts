import { describe, expect, it } from "vitest";
import { QualityGovernor } from "./quality";

/** run the governor on a fixed frame interval (ms) for s seconds; the levels it went through */
function run(q: QualityGovernor, ms: number, s: number): number[] {
  const seen: number[] = [];
  for (let t = 0; t < s; t += ms / 1000)
    if (q.step(ms / 1000)) seen.push(q.level);
  return seen;
}

describe("adaptive quality", () => {
  it("steps down on sustained slow frames, one level per 4 s, to the floor", () => {
    const q = new QualityGovernor();
    run(q, 16.7, 10);
    expect(q.level).toBe(0);
    run(q, 40, 6);
    expect(q.level).toBe(1);
    run(q, 40, 20);
    expect(q.level).toBe(3);
  });

  it("comes back up on a steady 60 Hz display (16.7 ms frames), not only on faster ones", () => {
    const q = new QualityGovernor();
    run(q, 16.7, 10);
    run(q, 40, 6); // e.g. another app hogging the GPU for a while
    expect(q.level).toBe(1);
    run(q, 16.7, 45);
    expect(q.level).toBe(0);
  });

  it("does not move on a steady 120 Hz display, nor on a few long frames", () => {
    const q = new QualityGovernor();
    run(q, 8.3, 30);
    for (let i = 0; i < 5; i++) {
      q.step(0.25);
      run(q, 16.7, 1);
    }
    expect(q.level).toBe(0);
  });

  it("waits longer before each step up that had to be undone (no see-saw)", () => {
    const q = new QualityGovernor();
    run(q, 16.7, 10);
    run(q, 40, 6);
    expect(q.level).toBe(1);
    run(q, 16.7, 45); // back up after 40 s steady
    expect(q.level).toBe(0);
    run(q, 40, 6); // the full level is too heavy: down again at once
    expect(q.level).toBe(1);
    run(q, 16.7, 45); // the next try waits 80 s
    expect(q.level).toBe(1);
    run(q, 16.7, 40);
    expect(q.level).toBe(0);
  });
});
