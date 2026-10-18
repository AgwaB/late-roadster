// DOM HUD: clock, gauges, compass arrow, BREAKING band, flash labels, minimap, result card, loading/title, touch buttons.
import * as C from "../game/constants";
import { type City, shortestPath } from "../game/city";
import { CLIPS, clipSpots, viewsText } from "../game/score";
import type { Result, Session } from "../game/session";
import type { InputState } from "../input";
import { CREDITS } from "../render/manifest";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent: HTMLElement,
  text = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
}

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

/** BREAKING headline per crash reason (src/game/session.ts crash events). */
const HEADLINES: Record<string, string> = {
  land: "ROADSTER LANDS ON ITS ROOF",
  sinkhole: "ROADSTER SWALLOWED BY SINKHOLE",
  skycar: "MID-AIR COLLISION OVER THE CORRIDOR",
  toll: "ROADSTER FLIES INTO TOLL PLAZA",
  sign: "ROADSTER PARKS IN OVERHEAD SIGN",
  building: "ROADSTER ENTERS BUILDING THE HARD WAY",
  wall: "ROADSTER MEETS WALL",
  pier: "ROADSTER HITS SKYWAY PILLAR",
  parapet: "ROADSTER CLIPS SKYWAY RAIL",
  ramp: "ROADSTER MISSES THE RAMP",
  pole: "ROADSTER HUGS A POLE",
  splash: "ROADSTER TAKES A SWIM",
  scooter: "ROADSTER VS SCOOTER",
  cyclist: "ROADSTER MEETS THE CYCLING CLUB",
};
/** One-time tip per crash reason: what to do differently. */
const TIPS: Record<string, string> = {
  land: "Finish the flip before you touch down: wheels first.",
  sinkhole: "Tap SPACE to hop a sinkhole, or steer around it.",
  skycar:
    "Flying cars keep right like the road. Fly over the outer lanes or stay under 10 m.",
  toll: "Climb early: the canopy roof is 7 m up. Or hop across the queue's roofs.",
  sign: "Overhead signs are solid. Fly above them or stay on the road.",
  splash: "The river is deep. Take a bridge or the tunnel.",
  ramp: "Hit the ramp straight and fast, at its foot.",
  cyclist: "The bike pack is head-high: a tap of SPACE clears the lot of them.",
  scooter: "Scooters weave. Hop them, or change lanes early.",
};
const WALL_TIP =
  "Walls at speed are a crash. Brake (S) or drift (CTRL) into the turn.";

function crashHeadline(reason: string): string {
  return "BREAKING: " + (HEADLINES[reason] ?? "COMMUTER ROADSTER WIPES OUT");
}
function crashTip(reason: string): string {
  return TIPS[reason] ?? WALL_TIP;
}

export class Hud {
  private resultOpen = false;
  private creditsOpen = false;
  /** the credits dialog is up: the run should not advance */
  get paused(): boolean {
    return this.creditsOpen;
  }
  private miniCssSize = 230;
  private miniObserver: ResizeObserver;
  private clock: HTMLElement;
  private fuel: HTMLElement;
  private spBar: HTMLElement;
  private speedo: HTMLElement;
  private lines: HTMLCanvasElement;
  private arrow: HTMLElement;
  private dist: HTMLElement;
  private band: HTMLElement;
  private result: HTMLElement;
  private resultGrade: HTMLElement;
  private resultTime: HTMLElement;
  private resultCrash: HTMLElement;
  private resultPersona: HTMLElement;
  private resultViews: HTMLElement;
  private resultCards: HTMLElement;
  private nextBtn: HTMLButtonElement;
  private lobbyBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private headline: HTMLElement;
  private crashInfo: HTMLElement;
  private crashCount: HTMLElement;
  private crashTipEl: HTMLElement;
  private penaltyEl: HTMLElement;
  private viewsEl: HTMLElement;
  private viewsPopEl: HTMLElement;
  private viewsPopT = 0;
  private toastEl: HTMLElement;
  private toastT = 0;
  private lastViews = "";
  private mini: HTMLCanvasElement;
  private miniBase: HTMLCanvasElement | null = null;
  private miniScale = 1;
  private faceEl: HTMLCanvasElement;
  private faceT = 0;
  private tickerEl: HTMLElement;
  private tickerT = 0;

  constructor(
    root: HTMLElement,
    private input: InputState,
    touch: boolean,
  ) {
    this.clock = el("div", "clock", root, "8:58:30");
    const gauges = el("div", "gauges", root);
    const g1 = el("div", "gauge", gauges);
    el("span", "ic", g1, "FUEL");
    this.fuel = el("i", "fill fuel", el("b", "bar", g1));
    const g3 = el("div", "gauge", gauges);
    el("span", "ic", g3, "SP");
    this.spBar = el("i", "fill boost", el("b", "bar", g3));
    const nav = el("div", "nav", root);
    this.arrow = el("div", "arrow", nav);
    // drawn arrow: points straight up at rotate(0) = office dead ahead (update() rotates by -bearing)
    this.arrow.innerHTML =
      '<svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 3 L33 36 L20 28 L7 36 Z" fill="currentColor"/></svg>';
    this.dist = el("div", "dist", nav, "");
    this.penaltyEl = el("div", "penalty", root, "-3s");
    const vw = el("div", "views", root);
    this.viewsEl = el("b", "", vw, "0");
    el("span", "", vw, " VIEWS");
    this.viewsPopEl = el("div", "vpop", vw);
    this.toastEl = el("div", "toast", root);
    this.band = el("div", "band", root);
    el("span", "live", this.band, "● LIVE");
    this.headline = el("span", "breaking", this.band, "BREAKING");
    this.crashInfo = el("div", "crashinfo", root);
    this.crashCount = el("div", "ccount", this.crashInfo);
    this.crashTipEl = el("div", "ctip", this.crashInfo);
    this.faceEl = el("canvas", "facecam", root);
    this.faceEl.width = 240;
    this.faceEl.height = 180;
    this.tickerEl = el("div", "ticker", root);
    this.mini = el("canvas", "mini", root);
    this.miniObserver = new ResizeObserver(([entry]) => {
      this.miniCssSize = entry.contentRect.width || 230;
    });
    this.miniObserver.observe(this.mini);
    const sp = el("div", "speedo", root);
    this.speedo = el("b", "kmh", sp, "0");
    el("span", "unit", sp, "km/h");
    this.lines = el("canvas", "lines", root);
    const cb = el("button", "credits-btn", root, "CREDITS");
    const cv = el("div", "credits hidden", root);
    cv.setAttribute("role", "dialog");
    cv.setAttribute("aria-modal", "true");
    cv.setAttribute("aria-label", "Credits");
    const close = el("button", "credits-close", cv, "CLOSE");
    el("div", "ctitle", cv, "CREDITS");
    for (const line of CREDITS) el("div", "cline", cv, line);
    el(
      "div",
      "cline",
      cv,
      "Late Roadster is a fan-made parody. Not affiliated with any car maker.",
    );
    // credits restore whatever input state they interrupted: driving (the sink takes focus again), the result
    // card, or the lobby
    let drivingBefore = false;
    const closeCredits = () => {
      this.creditsOpen = false;
      cv.classList.add("hidden");
      this.result.inert = false;
      if (this.resultOpen) this.nextBtn.focus();
      else if (drivingBefore) this.input.setGameplayEnabled(true);
      else cb.focus();
    };
    cb.onclick = () => {
      this.creditsOpen = true;
      drivingBefore = this.input.gameplayEnabled && !this.resultOpen;
      cv.classList.remove("hidden");
      this.result.inert = true;
      this.input.setGameplayEnabled(false);
      close.focus();
    };
    close.onclick = closeCredits;
    window.addEventListener("keydown", (e) => {
      if (!this.creditsOpen) return;
      if (e.code === "Escape") {
        e.preventDefault();
        closeCredits();
      } else if (e.code === "Tab") {
        const links = cv.querySelectorAll<HTMLElement>(
          "button, a[href], [tabindex='0']",
        );
        const first = links[0],
          last = links[links.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    this.result = el("div", "result hidden", root);
    // round-4 key art (KA_01) behind the result card; its top-left is left empty for the title
    this.result.style.setProperty(
      "--ka",
      `url("${import.meta.env.BASE_URL}assets/photo/KA_01.webp")`,
    );
    el("div", "rtitle", this.result, "LATE ROADSTER");
    this.resultGrade = el("div", "grade", this.result, "S");
    this.resultTime = el("div", "rtime", this.result, "+0:00");
    this.resultCrash = el("div", "rcrash", this.result, "CRASH ×0");
    this.resultPersona = el("div", "rpersona", this.result, "");
    this.resultViews = el("div", "rviews", this.result, "");
    this.resultCards = el("div", "rcards", this.result, "");
    this.saveBtn = el("button", "next save hidden", this.result, "SAVE CLIP");
    const row = el("div", "rbtns", this.result);
    this.lobbyBtn = el("button", "next alt", row, "LOBBY");
    this.nextBtn = el("button", "next", row, "NEXT COMMUTE");
    // the keys are explained in the lobby (src/ui/lobby.ts)
    if (touch) this.buildTouch(root, input);
  }

  /** A crash: the cause as a news headline, the clock penalty, and (first time for this cause) what to do instead. */
  crash(reason: string, tip: boolean, free: boolean): void {
    setText(this.headline, crashHeadline(reason));
    setText(this.crashTipEl, tip ? "TIP  " + crashTip(reason) : "");
    this.crashTipEl.classList.toggle("show", tip);
    if (!free) {
      this.penaltyEl.classList.remove("show");
      void this.penaltyEl.offsetWidth;
      this.penaltyEl.classList.add("show");
    }
  }

  /** "+25K x1.5" next to the VIEWS counter. */
  viewsPop(n: number, mult: number): void {
    setText(
      this.viewsPopEl,
      "+" +
        viewsText(n) +
        (mult > 1 ? "  x" + mult.toFixed(2).replace(/0$/, "") : ""),
    );
    this.viewsPopEl.classList.remove("show");
    void this.viewsPopEl.offsetWidth;
    this.viewsPopEl.classList.add("show");
    this.viewsPopT = 1.4;
  }

  /** A clip filmed for the first time: a small toast under the clock. */
  clipToast(id: string): void {
    const c = CLIPS.find((q) => q.id === id);
    if (!c) return;
    this.toastEl.replaceChildren();
    el("span", "", this.toastEl, "NEW CLIP");
    el("b", "", this.toastEl, c.title);
    this.toastEl.classList.add("show");
    this.toastT = 2.6;
  }

  /** touch layouts have no Q / ESC: a small LOBBY button under the clock (main wires it) */
  onLobby: (() => void) | null = null;

  private buildTouch(root: HTMLElement, input: InputState): void {
    const lb = el("button", "lobby-btn", root, "LOBBY");
    lb.onclick = () => this.onLobby?.();
    const mk = (
      parent: HTMLElement,
      label: string,
      name: Parameters<InputState["setTouch"]>[0],
      cls = "",
    ) => {
      const b = el("div", "tb " + cls, parent, label);
      const down = (e: PointerEvent) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        input.setTouch(name, true);
        b.classList.add("on");
      };
      const up = () => {
        input.setTouch(name, false);
        b.classList.remove("on");
      };
      b.addEventListener("pointerdown", down);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("lostpointercapture", up);
    };
    const left = el("div", "touch left", root);
    mk(left, "<", "left", "big");
    mk(left, ">", "right", "big");
    mk(left, "DRIFT", "drift");
    mk(left, "BRAKE", "brake");
    const right = el("div", "touch right", root);
    mk(right, "GAS", "accel", "big");
    mk(right, "JUMP", "jump", "big");
    mk(right, "BOOST", "boost");
    mk(right, "STICK", "stick");
  }

  /** Dashcam close-up of the driver for half a second (clearing a tall vehicle). */
  faceCam(mood: "shock" | "cool"): void {
    if (this.resultOpen) return;
    const c = this.faceEl,
      g = c.getContext("2d")!;
    const W = c.width,
      H = c.height;
    g.fillStyle = "#1a1d24";
    g.fillRect(0, 0, W, H);
    // window light + seat
    g.fillStyle = "#3a4458";
    g.fillRect(0, 0, W, H * 0.55);
    g.fillStyle = "#2b2b30";
    g.fillRect(W * 0.2, H * 0.3, W * 0.6, H * 0.8);
    // head
    g.fillStyle = "#f2c6a0";
    g.beginPath();
    g.ellipse(W / 2, H * 0.52, 48, 56, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3b2a20";
    g.beginPath();
    g.ellipse(W / 2, H * 0.3, 52, 26, 0, Math.PI, 0);
    g.fill();
    // eyes
    const eyeR = mood === "shock" ? 11 : 7;
    for (const s of [-1, 1]) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(W / 2 + s * 20, H * 0.47, eyeR, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#111";
      g.beginPath();
      g.arc(
        W / 2 + s * 20,
        H * 0.47 + (mood === "shock" ? 0 : 2),
        eyeR * 0.45,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    // mouth
    g.fillStyle = "#6a1f1f";
    g.beginPath();
    if (mood === "shock") g.ellipse(W / 2, H * 0.7, 13, 17, 0, 0, Math.PI * 2);
    else g.ellipse(W / 2, H * 0.68, 16, 6, 0, 0, Math.PI);
    g.fill();
    // seatbelt
    g.strokeStyle = "#111";
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(W * 0.78, H * 0.35);
    g.lineTo(W * 0.3, H);
    g.stroke();
    // REC dot
    g.fillStyle = "#ff3b3b";
    g.beginPath();
    g.arc(16, 16, 6, 0, Math.PI * 2);
    g.fill();
    this.faceEl.classList.add("show");
    this.faceT = 0.6;
  }

  /** BREAKING ticker: a short icon line scrolling across the bottom. */
  ticker(icons: string): void {
    if (this.resultOpen) return;
    setText(this.tickerEl, icons);
    this.tickerEl.classList.remove("run");
    void this.tickerEl.offsetWidth;
    this.tickerEl.classList.add("run");
    this.tickerT = 5;
  }

  update(s: Session, dt: number): void {
    const car = s.car;
    setText(this.clock, s.clock);
    this.clock.classList.toggle("red", s.timeLeft <= 10);
    this.fuel.style.width = (car.fuel * 100).toFixed(0) + "%";
    this.fuel.classList.toggle("low", car.fuel < 0.2);
    this.spBar.style.width = ((car.sp / C.SP_MAX) * 100).toFixed(0) + "%";
    this.spBar.style.background = car.sp < C.SP_BOOST_MIN ? "#777" : "#ff7a1a";
    setText(this.speedo, Math.round(Math.abs(car.v) * 3.6).toString());
    const running = s.state === "run" && !this.resultOpen;
    this.drawSpeedLines(running && car.boosting ? 1 : 0, dt);
    const crashed = running && car.state === "crash";
    this.band.classList.toggle("show", crashed);
    this.crashInfo.classList.toggle("show", crashed);
    if (crashed)
      setText(
        this.crashCount,
        "BACK IN " +
          Math.max(1, Math.ceil(C.CRASH_REPLAY - car.crashT)) +
          "   SPACE  SKIP",
      );
    const v = viewsText(s.views);
    if (v !== this.lastViews) {
      this.lastViews = v;
      setText(this.viewsEl, v);
    }
    if (this.viewsPopT > 0) {
      this.viewsPopT -= dt;
      if (this.viewsPopT <= 0) this.viewsPopEl.classList.remove("show");
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.classList.remove("show");
    }
    if (!running) this.clearGameplayOverlays();
    const bearing =
      Math.atan2(s.office.y - car.y, s.office.x - car.x) - car.heading; // + = left
    this.arrow.style.transform =
      "rotate(" + (-bearing * 180) / Math.PI + "deg)";
    setText(this.dist, Math.round(s.distanceToOffice / 10) * 10 + "m");
    if (this.faceT > 0) {
      this.faceT -= dt;
      if (this.faceT <= 0) this.faceEl.classList.remove("show");
    }
    if (this.tickerT > 0) {
      this.tickerT -= dt;
      if (this.tickerT <= 0) this.tickerEl.classList.remove("run");
    }
    this.drawMini(s);
  }

  /** Wire the SAVE CLIP button; pass null to hide it (recording unsupported). */
  setSaveClip(
    handler: ((setLabel: (s: string) => void) => Promise<boolean>) | null,
  ): void {
    this.saveBtn.classList.toggle("hidden", !handler);
    this.saveBtn.textContent = "SAVE CLIP";
    this.saveBtn.disabled = false;
    this.saveBtn.onclick = handler
      ? async () => {
          const current = this.saveBtn.onclick;
          this.saveBtn.disabled = true;
          try {
            const saved = await handler((s) => {
              if (this.saveBtn.onclick === current) setText(this.saveBtn, s);
            });
            if (this.saveBtn.onclick === current)
              setText(this.saveBtn, saved ? "SAVED" : "CLIP UNAVAILABLE");
          } catch {
            if (this.saveBtn.onclick === current)
              setText(this.saveBtn, "CLIP UNAVAILABLE");
          } finally {
            if (this.saveBtn.onclick === current) this.saveBtn.disabled = false;
          }
        }
      : null;
  }

  private clearGameplayOverlays(): void {
    this.tickerT = this.faceT = 0;
    this.tickerEl.classList.remove("run");
    this.faceEl.classList.remove("show");
    this.band.classList.remove("show");
    this.crashInfo.classList.remove("show");
    this.penaltyEl.classList.remove("show");
    this.toastEl.classList.remove("show");
    this.viewsPopEl.classList.remove("show");
    this.toastT = this.viewsPopT = 0;
    this.linesAlpha = 0;
    this.lines
      .getContext("2d")
      ?.clearRect(0, 0, this.lines.width, this.lines.height);
  }

  handleResultKey(e: KeyboardEvent): void {
    if (
      !this.resultOpen ||
      this.creditsOpen ||
      e.repeat ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    )
      return;
    // Keep native Enter/Space activation for SAVE CLIP, NEXT and other buttons.
    if (
      e.code === "KeyN" ||
      ((e.code === "Enter" || e.code === "Space") &&
        !(
          e.target instanceof HTMLElement &&
          e.target.closest("button, a, input, textarea, select")
        ))
    ) {
      e.preventDefault();
      this.nextBtn.click();
    }
  }

  showResult(r: Result, onNext: () => void, onLobby: () => void): void {
    this.resultOpen = true;
    this.input.setGameplayEnabled(false);
    this.clearGameplayOverlays();
    this.resultGrade.textContent = r.grade;
    this.resultGrade.className = "grade g" + r.grade;
    const left = Math.floor(r.timeLeft);
    this.resultTime.textContent = r.finished
      ? "+" + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0")
      : "9:00:00";
    this.resultCrash.textContent = "CRASH ×" + r.crashes;
    this.resultPersona.textContent = r.persona;
    this.resultViews.replaceChildren();
    el("b", "", this.resultViews, viewsText(r.finalViews) + " VIEWS");
    el(
      "span",
      "",
      this.resultViews,
      viewsText(r.views) + (r.finished ? " x2 ON TIME" : " x0.5 LATE"),
    );
    const titles = r.newClips
      .map((id) => CLIPS.find((c) => c.id === id)?.title)
      .filter(Boolean);
    setText(
      this.resultCards,
      titles.length ? "NEW CLIPS: " + titles.join(", ") : "",
    );
    this.result.classList.remove("hidden");
    const close = (then: () => void) => () => {
      if (!this.resultOpen || this.creditsOpen) return;
      this.resultOpen = false;
      this.result.classList.add("hidden");
      this.input.setGameplayEnabled(true);
      then();
    };
    this.nextBtn.onclick = close(onNext);
    this.lobbyBtn.onclick = close(onLobby);
    if (!this.creditsOpen) this.nextBtn.focus({ preventScroll: true });
  }

  /** Pre-render the whole city once (roads at true width, river, blocks) for the heading-up local minimap. */
  prepareMini(city: City): void {
    const S = 2048,
      W = (C.CITY_HALF + 60) * 2;
    this.miniScale = S / W;
    this.miniCity = city;
    this.routeFrom = -1;
    const base = document.createElement("canvas");
    base.width = S;
    base.height = S;
    const ctx = base.getContext("2d")!;
    const k = this.miniScale;
    const m = (x: number, y: number) => ({
      x: (x + W / 2) * k,
      y: (W / 2 - y) * k,
    });
    ctx.fillStyle = "#0d1322";
    ctx.fillRect(0, 0, S, S);
    // city blocks
    ctx.fillStyle = "#26304a";
    const lim = C.CITY_HALF + C.ROAD_HALF;
    const a0 = m(-lim, lim),
      a1 = m(lim, -lim);
    ctx.fillRect(a0.x, a0.y, a1.x - a0.x, a1.y - a0.y);
    // river
    ctx.fillStyle = "#1d5b9c";
    const r0 = m(city.river.x0, W / 2),
      r1 = m(city.river.x1, -W / 2);
    ctx.fillRect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y);
    // roads at roadway width, then a thin centre line
    ctx.lineCap = "square";
    ctx.strokeStyle = "#8d96ad";
    ctx.lineWidth = C.ROADWAY_HALF * 2 * k;
    for (const e of city.edges) {
      const p = m(city.nodes[e.a].x, city.nodes[e.a].y),
        q = m(city.nodes[e.b].x, city.nodes[e.b].y);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,214,90,0.55)";
    ctx.lineWidth = Math.max(1, 0.8 * k);
    for (const e of city.edges) {
      const p = m(city.nodes[e.a].x, city.nodes[e.a].y),
        q = m(city.nodes[e.b].x, city.nodes[e.b].y);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    // tunnel deck darker
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    const t0 = m(city.tunnel.x0, city.tunnel.y1),
      t1 = m(city.tunnel.x1, city.tunnel.y0);
    ctx.fillRect(t0.x, t0.y, t1.x - t0.x, t1.y - t0.y);
    this.miniBase = base;
    this.spots = clipSpots(city).map((p) => ({
      ...p,
      color: CLIPS.find((c) => c.id === p.id)?.color ?? "#fff",
    }));
  }

  /** where the clips not filmed yet are: coloured dots (clamped to the rim when off the map) */
  private spots: { id: string; x: number; y: number; color: string }[] = [];

  private miniCity: City | null = null;
  private routeFrom = -1;
  private route: { x: number; y: number }[] = [];

  private routeSession: Session | null = null;

  private drawMini(s: Session): void {
    if (!this.miniBase || !this.miniCity) return;
    // a new commute has a new office: never reuse the previous session's route
    if (s !== this.routeSession) {
      this.routeSession = s;
      this.routeFrom = -1;
    }
    const city = this.miniCity;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = this.miniCssSize;
    const S = Math.round(css * dpr);
    if (this.mini.width !== S) {
      this.mini.width = S;
      this.mini.height = S;
    }
    const ctx = this.mini.getContext("2d")!;
    const car = s.car;
    // route: shortest path from the node nearest the car to the office, recomputed when that node changes
    let near = 0,
      nd = Infinity;
    for (const n of city.nodes) {
      const d = (n.x - car.x) ** 2 + (n.y - car.y) ** 2;
      if (d < nd) {
        nd = d;
        near = n.id;
      }
    }
    if (near !== this.routeFrom) {
      this.routeFrom = near;
      let off = 0,
        od = Infinity;
      for (const n of city.nodes) {
        const d = (n.x - s.office.x) ** 2 + (n.y - s.office.y) ** 2;
        if (d < od) {
          od = d;
          off = n.id;
        }
      }
      this.route = shortestPath(city, near, off).map((n) => ({
        x: n.x,
        y: n.y,
      }));
    }
    // view: ~400 m across, widening a little with speed; heading up
    const span = 400 + Math.min(1, Math.abs(car.v) / 60) * 140;
    const px = S / span; // canvas px per metre
    const W = (C.CITY_HALF + 60) * 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2 * dpr, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#0d1322";
    ctx.fillRect(0, 0, S, S);
    // world (x, y) -> canvas: centre on the car, rotate so its heading points up
    ctx.translate(S / 2, S / 2);
    ctx.rotate(car.heading - Math.PI / 2);
    ctx.scale(px, -px);
    ctx.translate(-car.x, -car.y);
    // base map is in its own pixel space: (x + W/2) * k, (W/2 - y) * k
    ctx.save();
    ctx.translate(-W / 2, W / 2);
    ctx.scale(1 / this.miniScale, -1 / this.miniScale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.miniBase, 0, 0);
    ctx.restore();
    // route line
    if (this.route.length) {
      ctx.strokeStyle = "rgba(255,210,63,0.95)";
      ctx.lineWidth = 9;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(car.x, car.y);
      for (const p of this.route) ctx.lineTo(p.x, p.y);
      ctx.lineTo(s.office.x, s.office.y);
      ctx.stroke();
    }
    // traffic dots
    for (const n of s.traffic.npcs) {
      if (n.dead) continue;
      const dx = n.x - car.x,
        dy = n.y - car.y;
      if (dx * dx + dy * dy > span * span) continue;
      ctx.fillStyle =
        n.kind === "roadster"
          ? "#ff8a3d"
          : n.kind === "police" || n.behavior === "ambulance"
            ? "#5fb4ff"
            : n.behavior === "wrongWay"
              ? "#ff4d4d"
              : "#d8dde8";
      ctx.beginPath();
      ctx.arc(n.x, n.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // office flag (if inside the view)
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(s.office.x, s.office.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // office marker clamped to the rim when it is off the map
    const bearing =
      Math.atan2(s.office.y - car.y, s.office.x - car.x) - car.heading; // + = left
    const dist = s.distanceToOffice;
    const R = S / 2 - 12 * dpr;
    const rr = Math.min(R, dist * px);
    const ox = S / 2 - Math.sin(bearing) * rr,
      oy = S / 2 - Math.cos(bearing) * rr;
    // office marker: drawn 3x3 chequered square
    {
      const q = 4 * dpr;
      ctx.fillStyle = "#fff";
      ctx.fillRect(
        ox - q * 1.5 - dpr,
        oy - q * 1.5 - dpr,
        q * 3 + 2 * dpr,
        q * 3 + 2 * dpr,
      );
      ctx.fillStyle = "#111";
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          if ((i + j) % 2 === 0)
            ctx.fillRect(ox - q * 1.5 + i * q, oy - q * 1.5 + j * q, q, q);
    }
    // clips still to film: coloured dots, on the map or pinned to its rim; every sinkhole while that clip is open
    {
      const known = s.tracker.known;
      const R2 = S / 2 - 10 * dpr;
      const dot = (
        x: number,
        y: number,
        color: string,
        r: number,
        rim: boolean,
      ) => {
        const b = Math.atan2(y - car.y, x - car.x) - car.heading;
        const d = Math.hypot(x - car.x, y - car.y) * px;
        if (d > R2 && !rim) return;
        const rr = Math.min(R2, d);
        const mx = S / 2 - Math.sin(b) * rr,
          my = S / 2 - Math.cos(b) * rr;
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(mx, my, (d > R2 ? r * 0.75 : r) * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
      const sink = CLIPS.find((c) => c.id === "sinkhole")?.color;
      if (sink && !known.has("sinkhole") && this.miniCity)
        for (const p of this.miniCity.potholes) dot(p.x, p.y, sink, 3.2, false);
      for (const p of this.spots)
        if (!known.has(p.id)) dot(p.x, p.y, p.color, 5.5, true);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // north tick on the rim
    const nb = Math.PI / 2 - car.heading; // world +y relative to heading
    const nx = S / 2 - Math.sin(nb) * (S / 2 - 9 * dpr),
      ny = S / 2 - Math.cos(nb) * (S / 2 - 9 * dpr);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = 700 + " " + Math.round(10 * dpr) + "px ui-monospace, monospace";
    ctx.fillText("N", nx, ny);
    // rim
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    // player arrow (always up)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ff3b3b";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private linesAlpha = 0;
  private drawSpeedLines(target: number, dt: number): void {
    this.linesAlpha += (target - this.linesAlpha) * Math.min(1, 8 * dt);
    const c = this.lines;
    if (c.width !== innerWidth || c.height !== innerHeight) {
      c.width = innerWidth;
      c.height = innerHeight;
    }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (this.linesAlpha < 0.02) return;
    const cx = c.width / 2,
      cy = c.height * 0.45;
    ctx.strokeStyle =
      "rgba(200,225,255," + (0.55 * this.linesAlpha).toFixed(3) + ")";
    ctx.lineWidth = 2;
    const R = Math.hypot(cx, cy);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = R * (0.35 + Math.random() * 0.3),
        r1 = r0 + R * (0.15 + Math.random() * 0.3);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
}
