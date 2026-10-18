// @vitest-environment jsdom
// Screen-flow contracts of the DOM UI: lobby START / FREE ROAM gating, credits as a modal that pauses and gives the
// keyboard back, the result card's buttons and keys, the crash panel. The 3D scene is not involved.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CLIPS } from "../game/score";
import type { Result, Session } from "../game/session";
import { InputState } from "../input";
import { Hud } from "./hud";
import { Lobby } from "./lobby";
import { forInput } from "./keys";

beforeAll(() => {
  // jsdom has no layout, canvas or ResizeObserver: the HUD only needs them to draw
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      observe() {}
      disconnect() {}
    };
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({}, { get: () => () => undefined })) as never;
});

const info = (known: string[]) => ({
  persona: "ENGINEER",
  distance: 2900,
  bestGrade: null,
  bestViews: 0,
  known: new Set(known),
});
const key = (code: string) => {
  const e = new KeyboardEvent("keydown", {
    code,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(e);
  return e;
};

describe("lobby", () => {
  it("gates START on loading, starts on Enter only while open, unlocks FREE ROAM with every clip", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const on = { start: vi.fn(), free: vi.fn() };
    const lobby = new Lobby(root, on);
    lobby.show(info([]));
    const start = root.querySelector<HTMLButtonElement>(".lb-start")!;
    const free = root.querySelector<HTMLButtonElement>(".lb-free")!;
    expect(start.disabled).toBe(true);
    expect(start.textContent).toBe("LOADING");
    key("Enter");
    expect(on.start).not.toHaveBeenCalled();
    lobby.setReady();
    expect(start.disabled).toBe(false);
    expect(free.disabled).toBe(true);
    key("Enter");
    expect(on.start).toHaveBeenCalledTimes(1);
    lobby.hide();
    expect(lobby.root.inert).toBe(true);
    key("Space");
    expect(on.start).toHaveBeenCalledTimes(1);
    // every stunt clip, no wipeout: FREE ROAM opens (nobody has to crash for it)
    lobby.show(info(CLIPS.filter((c) => c.id !== "news").map((c) => c.id)));
    expect(free.disabled).toBe(false);
    lobby.show(info(CLIPS.map((c) => c.id)));
    expect(lobby.root.inert).toBe(false);
    expect(free.disabled).toBe(false);
    expect(root.querySelectorAll(".lb-card.got")).toHaveLength(CLIPS.length);
    free.click();
    expect(on.free).toHaveBeenCalledTimes(1);
    // the author's links open in a new tab
    for (const a of Array.from(
      root.querySelectorAll<HTMLAnchorElement>(".lb-by a"),
    )) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
    }
    root.remove();
  });
});

describe("hud", () => {
  const make = () => {
    const root = document.createElement("div");
    document.body.append(root);
    const input = new InputState(false);
    const hud = new Hud(root, input, false);
    return { root, input, hud };
  };

  it("credits pause the run, ESC closes only the credits (consumed), and driving input comes back", () => {
    const { root, input, hud } = make();
    input.setGameplayEnabled(true);
    root.querySelector<HTMLButtonElement>(".credits-btn")!.click();
    expect(hud.paused).toBe(true);
    expect(input.gameplayEnabled).toBe(false);
    const e = key("Escape");
    expect(e.defaultPrevented).toBe(true); // main.ts skips its ESC-to-lobby on a consumed event
    expect(hud.paused).toBe(false);
    expect(input.gameplayEnabled).toBe(true);
    root.remove();
  });

  it("shows the result with VIEWS and new clips; NEXT / LOBBY / Enter route to the right callbacks", () => {
    const { root, input, hud } = make();
    const r: Result = {
      grade: "A",
      timeLeft: 12,
      crashes: 1,
      finished: true,
      crashTimes: [30],
      persona: "ENGINEER",
      views: 120_000,
      finalViews: 240_000,
      newClips: ["toll", "ramp"],
    };
    const next = vi.fn(),
      lobby = vi.fn();
    hud.showResult(r, next, lobby);
    expect(input.gameplayEnabled).toBe(false);
    expect(root.querySelector(".rviews b")!.textContent).toBe("240K");
    expect(root.querySelector(".rviews small")!.textContent).toBe(
      "120K x2 on time",
    );
    expect(root.querySelector(".rtime b")!.textContent).toBe("+0:12");
    expect(
      Array.from(root.querySelectorAll(".rcards i")).map((e) => e.textContent),
    ).toEqual(["TOLL $0", "THE RAMP"]);
    // one primary button; the clip saves say what they film
    expect(
      root.querySelectorAll(".result button.next:not(.alt):not(.save)"),
    ).toHaveLength(1);
    hud.handleResultKey(key("Enter"));
    expect(next).toHaveBeenCalledTimes(1);
    expect(lobby).not.toHaveBeenCalled();
    expect(root.querySelector(".result")!.classList.contains("hidden")).toBe(
      true,
    );
    hud.showResult(
      { ...r, finished: false, grade: "LATE", finalViews: 60_000 },
      next,
      lobby,
    );
    expect(root.querySelector(".rviews small")!.textContent).toContain(
      "x0.5 late",
    );
    expect(root.querySelector(".rtime b")!.textContent).toBe("9:00:00");
    root.querySelector<HTMLButtonElement>(".next.alt")!.click();
    expect(lobby).toHaveBeenCalledTimes(1);
    // ESC / Q on the result card go through its LOBBY button: the card closes, and main.ts sees the key consumed
    hud.showResult(r, next, lobby);
    expect(hud.resultShowing).toBe(true);
    const esc = key("Escape");
    hud.handleResultKey(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(lobby).toHaveBeenCalledTimes(2);
    expect(hud.resultShowing).toBe(false);
    expect(root.querySelector(".result")!.classList.contains("hidden")).toBe(
      true,
    );
    expect(root.querySelector(".rcrash b")!.textContent).toBe("1");
    expect(root.querySelector(".rcrash span")!.textContent).toBe("WIPEOUTS");
    root.remove();
  });

  it("labels the clip saves by what they film, and keeps the label through saving", async () => {
    const { root, hud } = make();
    let finish: (ok: boolean) => void = () => {};
    hud.setSaveBest((setLabel) => {
      setLabel("SAVING…");
      return new Promise<boolean>((res) => (finish = res));
    }, "RAMP EXTRA FLIP");
    hud.setSaveClip(null, "ARRIVAL", "CLOCKED IN 8:59:21");
    const best = root.querySelector<HTMLButtonElement>(".next.save.best")!;
    expect(best.querySelector("b")!.textContent).toBe("BEST STUNT");
    expect(best.querySelector("small")!.textContent).toBe("RAMP EXTRA FLIP");
    expect(root.querySelector(".next.save:not(.best)")!.classList).toContain(
      "hidden",
    );
    best.click();
    expect(best.querySelector("b")!.textContent).toBe("SAVING…");
    expect(best.disabled).toBe(true);
    finish(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(best.querySelector("b")!.textContent).toBe("SAVED");
    expect(best.querySelector("small")!.textContent).toBe("RAMP EXTRA FLIP");
    root.remove();
  });

  it("names the on-screen buttons in hints and tips on a touch screen", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const hud = new Hud(root, new InputState(false), true);
    hud.crash("sinkhole", true, false);
    expect(root.querySelector(".ctip")!.textContent).toBe(
      "TIP  Tap JUMP to hop a sinkhole, or steer around it.",
    );
    expect(forInput("Press E in the tunnel (SHIFT helps)", true)).toBe(
      "Press STICK in the tunnel (BOOST helps)",
    );
    expect(forInput("Hold SPACE", false)).toBe("Hold SPACE");
    root.remove();
    const lroot = document.createElement("div");
    document.body.append(lroot);
    new Lobby(lroot, { start: vi.fn(), free: vi.fn() }, true);
    const caps = Array.from(lroot.querySelectorAll("kbd")).map(
      (k) => k.textContent,
    );
    expect(caps).toContain("JUMP");
    expect(caps).not.toContain("SPACE");
    lroot.remove();
  });

  it("a wipeout is not news: the band says WIPEOUT and the cause, with a tip only when asked", () => {
    const { root, hud } = make();
    hud.crash("sinkhole", true, false);
    expect(root.querySelector(".band")!.textContent).toBe(
      "WIPEOUTSWALLOWED BY A SINKHOLE",
    );
    expect(root.querySelector(".band")!.textContent).not.toContain("BREAKING");
    expect(root.querySelector(".ctip")!.classList.contains("show")).toBe(true);
    hud.crash("whatever", false, false);
    expect(root.querySelector(".wcause")!.textContent).toBe("");
    expect(root.querySelector(".ctip")!.classList.contains("show")).toBe(false);
    // the counter and the band follow the session state each frame
    const fake = {
      car: {
        state: "crash",
        crashT: 1.2,
        fuel: 1,
        sp: 100,
        v: 0,
        heading: 0,
        x: 0,
        y: 0,
      },
      clock: "8:59:00",
      timeLeft: 30,
      state: "run",
      views: 12_400,
      office: { x: 100, y: 0 },
      distanceToOffice: 100,
      traffic: { npcs: [] },
      tracker: { known: new Set() },
    } as unknown as Session;
    hud.update(fake, 1 / 60);
    expect(root.querySelector(".band")!.classList.contains("show")).toBe(true);
    expect(root.querySelector(".ccount")!.textContent).toContain("BACK IN 2");
    expect(root.querySelector(".views b")!.textContent).toBe("12.4K");
    root.remove();
  });

  it("shows a BREAKING NEWS card with a picture for ~6 s, and never over the result card", () => {
    const { root, hud } = make();
    const card = root.querySelector(".news")!;
    expect(card.classList.contains("show")).toBe(false);
    hud.news(
      "/assets/clips/hop.webp",
      "FLIP PILE-UP: ROADSTER LANDS ON THE CAR AHEAD",
    );
    expect(card.classList.contains("show")).toBe(true);
    expect(card.textContent).toContain("BREAKING NEWS");
    expect(card.querySelector(".nhead")!.textContent).toBe(
      "FLIP PILE-UP: ROADSTER LANDS ON THE CAR AHEAD",
    );
    expect(card.querySelector("img")!.getAttribute("src")).toBe(
      "/assets/clips/hop.webp",
    );
    const fake = {
      car: {
        state: "drive",
        crashT: 0,
        fuel: 1,
        sp: 100,
        v: 0,
        heading: 0,
        x: 0,
        y: 0,
      },
      clock: "8:59:00",
      timeLeft: 30,
      state: "run",
      views: 0,
      office: { x: 100, y: 0 },
      distanceToOffice: 100,
      traffic: { npcs: [] },
      tracker: { known: new Set() },
    } as unknown as Session;
    for (let i = 0; i < 5.5 * 60; i++) hud.update(fake, 1 / 60);
    expect(card.classList.contains("show")).toBe(true);
    for (let i = 0; i < 60; i++) hud.update(fake, 1 / 60);
    expect(card.classList.contains("show")).toBe(false);
    root.remove();
  });
});
