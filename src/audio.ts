// Synthesised sound (no audio assets): EV motor hum + inverter whine + wind, boost, drift screech, rain bed, and one-shots.
// Everything is Web Audio oscillators/noise so there is nothing to license. Unlocks on the first key/pointer input.
import type { Car } from "./game/physics";

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const b = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * seconds),
    ctx.sampleRate,
  );
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    // pink-ish: integrate white noise slightly
    const w = Math.random() * 2 - 1;
    last = 0.96 * last + 0.04 * w;
    d[i] = (w * 0.6 + last * 2.2) * 0.5;
  }
  return b;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private rumble!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private boostGain!: GainNode;
  private boostFilter!: BiquadFilterNode;
  private boostWhine!: OscillatorNode;
  private boostWhineGain!: GainNode;
  private driftGain!: GainNode;
  private rainGain!: GainNode;
  private noise!: AudioBuffer;
  private unlocked = false;

  /** Call from a user-gesture handler (keydown/pointerdown). Safe to call repeatedly. */
  unlock(): void {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.unlocked = true;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this.noise = noiseBuffer(ctx);

    // EV motor: soft triangle hum + sine octave through a gentle lowpass (no combustion rasp)
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.Q.value = 0.7;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = "triangle";
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = "sine";
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
    // inverter whine: a thin high sine that climbs with speed — the EV signature
    this.whine = ctx.createOscillator();
    this.whine.type = "sine";
    this.whine.frequency.value = 600;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start();
    // road rumble: lowpassed noise scaled by speed
    const rum = this.loop(ctx, 150, "lowpass");
    this.rumble = rum.gain;
    // wind rush: highpassed noise that grows with speed² — the sound of going fast in a quiet car
    const wd = this.loop(ctx, 900, "highpass", 0.5);
    this.wind = wd.gain;
    this.windFilter = wd.filter;
    // boost: band-passed noise sweep + whine
    const bo = this.loop(ctx, 900, "bandpass");
    this.boostGain = bo.gain;
    this.boostFilter = bo.filter;
    this.boostWhine = ctx.createOscillator();
    this.boostWhine.type = "sine";
    this.boostWhine.frequency.value = 900;
    this.boostWhineGain = ctx.createGain();
    this.boostWhineGain.gain.value = 0;
    this.boostWhine.connect(this.boostWhineGain).connect(this.master);
    this.boostWhine.start();
    // drift screech: narrow bandpass noise
    const dr = this.loop(ctx, 1500, "bandpass", 6);
    this.driftGain = dr.gain;
    // rain bed
    const rn = this.loop(ctx, 2600, "lowpass");
    this.rainGain = rn.gain;
  }

  private loop(
    ctx: AudioContext,
    freq: number,
    type: BiquadFilterType,
    q = 1,
  ): { gain: GainNode; filter: BiquadFilterNode } {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return { gain, filter };
  }

  /** Continuous layers; call every frame. */
  update(car: Car, accel: boolean, wet: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const tc = Math.min(0.2, Math.max(0.03, dt * 3));
    const speed = Math.abs(car.v);
    const alive = car.state === "drive";
    // motor hum follows speed (electric: pitch rises smoothly, no gear steps); near silent when stopped
    const f = 36 + speed * 1.7;
    this.engineOsc.frequency.setTargetAtTime(f, t, tc);
    this.engineOsc2.frequency.setTargetAtTime(f * 2, t, tc);
    this.engineFilter.frequency.setTargetAtTime(180 + speed * 9, t, tc);
    const sK = Math.min(1, speed / 42);
    this.engineGain.gain.setTargetAtTime(
      alive ? 0.03 + sK * 0.07 + (accel ? 0.02 : 0) : 0.01,
      t,
      tc,
    );
    // inverter whine: pitch 500 -> ~2.4 kHz over the speed range, a touch louder under throttle
    this.whine.frequency.setTargetAtTime(500 + speed * 45, t, tc);
    this.whineGain.gain.setTargetAtTime(
      alive ? sK * sK * 0.022 + (accel ? sK * 0.008 : 0) : 0,
      t,
      tc,
    );
    this.rumble.gain.setTargetAtTime(
      alive && car.grounded ? Math.min(0.1, speed * 0.002) : 0,
      t,
      tc,
    );
    this.wind.gain.setTargetAtTime(alive ? sK * sK * 0.14 : 0, t, tc);
    this.windFilter.frequency.setTargetAtTime(700 + sK * 900, t, tc);
    const boosting = alive && car.boosting;
    this.boostGain.gain.setTargetAtTime(
      boosting ? 0.6 : 0,
      t,
      boosting ? 0.05 : 0.25,
    );
    this.boostFilter.frequency.setTargetAtTime(
      boosting ? 900 + speed * 25 : 600,
      t,
      0.1,
    );
    this.boostWhineGain.gain.setTargetAtTime(boosting ? 0.08 : 0, t, 0.08);
    this.boostWhine.frequency.setTargetAtTime(700 + speed * 14, t, 0.1);
    const drifting = alive && car.drifting && car.grounded && speed > 8;
    this.driftGain.gain.setTargetAtTime(
      drifting ? Math.min(0.45, 0.15 + speed * 0.006) : 0,
      t,
      drifting ? 0.04 : 0.12,
    );
    this.rainGain.gain.setTargetAtTime(0.22 * wet, t, 0.5);
  }

  /** One-shots keyed by the session event name (see main.ts handleEvents). */
  event(k: string, v?: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    switch (k) {
      case "crash":
        this.thump(0.9, 70, 0.5);
        this.burst(0.7, 0.45, 600, "lowpass");
        this.burst(0.35, 0.25, 3000, "highpass", 0.05);
        this.sting();
        break;
      case "hit":
        this.thump(0.8, 80, 0.35);
        this.burst(0.5, 0.3, 900, "lowpass");
        break;
      case "bump":
      case "cone":
        this.thump(0.5, 110, 0.18);
        this.burst(0.25, 0.12, 1200, "bandpass");
        break;
      case "stomp":
        this.thump(0.6, 90, 0.25);
        break;
      case "land":
        this.thump(v === "clean" ? 0.35 : 0.55, 80, 0.22);
        break;
      case "jump":
        this.thump(0.3, 70, 0.2);
        this.whoosh(0.45, 1600, 300, 0.5);
        break;
      case "pothole":
        this.thump(0.7, 55, 0.3);
        this.burst(0.35, 0.2, 700, "lowpass");
        break;
      case "npcjet":
        this.whoosh(0.3, 1200, 500, 0.35);
        break;
      case "npccrash":
        this.thump(0.45, 75, 0.3);
        this.burst(0.3, 0.2, 900, "lowpass");
        break;
      case "thrust":
        this.thump(0.35, 55, 0.25);
        this.whoosh(1.2, 700, 1800, 0.7);
        break;
      case "skyway":
        this.thump(0.45, 60, 0.3);
        this.whoosh(0.6, v === "up" ? 900 : 2200, v === "up" ? 2600 : 400, 0.9);
        break;
      case "sidestep":
        this.whoosh(0.3, 400, 1400, 0.25);
        break;
      case "flipStart":
        // cold-gas burst: deep thud + long downward hiss
        this.thump(0.5, 60, 0.3);
        this.whoosh(0.55, 2200, 180, 0.9);
        break;
      case "flip":
        this.ding(880, 0.12);
        this.ding(1320, 0.12, 0.08);
        break;
      case "boost":
        if (v !== "off") {
          // ignition: thud + rising roar before the sustained boost bed takes over
          this.thump(0.45, 55, 0.25);
          this.whoosh(0.6, 150, 1200, 0.5);
        }
        break;
      case "ceil":
        if (v === "on") this.thump(0.4, 140, 0.15);
        break;
      case "thanks":
        this.ding(1047, 0.15);
        this.ding(1319, 0.15, 0.1);
        this.ding(1568, 0.2, 0.2);
        break;
      case "siren":
      case "ambulance":
        this.siren();
        break;
      case "event":
        this.ding(660, 0.08);
        this.ding(990, 0.08, 0.07);
        break;
      case "wire":
        this.burst(0.5, 0.3, 2200, "bandpass", 0, 8);
        this.thump(0.5, 60, 0.4);
        break;
      case "clip":
        // a new clip filmed: a short bright three-note chime (distinct from the finish fanfare)
        this.ding(1319, 0.12);
        this.ding(1760, 0.12, 0.09);
        this.ding(2093, 0.22, 0.18);
        break;
      case "wall":
        // onto the ramp wall: the suction takes hold, a low rising rumble
        this.thump(0.5, 50, 0.35);
        this.whoosh(0.9, 300, 1400, 0.8);
        break;
      case "walltop":
        // over the lip: thrusters cut the climb, a sharp downward hiss
        this.whoosh(0.6, 2600, 200, 0.7);
        break;
      case "views":
        break;
      case "finish":
        [523, 659, 784, 1047].forEach((f, i) => this.ding(f, 0.3, i * 0.11));
        break;
      case "late":
        [440, 415, 392, 311].forEach((f, i) => this.ding(f, 0.5, i * 0.25));
        break;
    }
  }

  private thump(gain: number, freq: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq * 2, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(
    gain: number,
    dur: number,
    freq: number,
    type: BiquadFilterType,
    delay = 0,
    q = 1,
  ): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  private whoosh(gain: number, f0: number, f1: number, dur: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  private ding(freq: number, dur: number, delay = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** BREAKING sting: three falling brass-ish tones. */
  private sting(): void {
    [
      [392, 0],
      [330, 0.16],
      [262, 0.32],
    ].forEach(([f, d]) => {
      const ctx = this.ctx!;
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const fl = ctx.createBiquadFilter();
      fl.type = "lowpass";
      fl.frequency.value = 1200;
      const g = ctx.createGain();
      const t = ctx.currentTime + d + 0.25;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(fl).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.5);
    });
  }

  private beatNext = 0;
  /** Last-10-seconds heartbeat (SPEC §7 clock gag): lub-dub, faster as time runs out. Call every frame. */
  heartbeat(timeLeft: number, running: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !running || timeLeft > 10 || timeLeft <= 0) return;
    const t = ctx.currentTime;
    if (t < this.beatNext) return;
    const period = 0.55 + (timeLeft / 10) * 0.45; // 1.0 s -> 0.55 s
    this.beatNext = t + period;
    this.thump(0.55, 55, 0.12);
    setTimeout(() => this.ctx && this.thump(0.4, 48, 0.14), 140);
  }

  private siren(): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "square";
    const g = ctx.createGain();
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++)
      o.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.3);
    g.gain.setValueAtTime(0.06, t);
    g.gain.setValueAtTime(0.06, t + 1.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
    const fl = ctx.createBiquadFilter();
    fl.type = "lowpass";
    fl.frequency.value = 2200;
    o.connect(fl).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 2);
  }
}
