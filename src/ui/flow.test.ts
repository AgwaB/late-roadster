// @vitest-environment jsdom
// Screen-flow contracts of the DOM UI: lobby START / FREE ROAM gating, credits as a modal that pauses and gives the
// keyboard back, the result card's buttons and keys, the crash panel. The 3D scene is not involved.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CLIPS } from "../game/score";
import type { Result, Session } from "../game/session";
import { InputState } from "../input";
import { Hud } from "./hud";
import { Lobby } from "./lobby";

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
    expect(root.querySelector(".rviews")!.textContent).toContain("240K VIEWS");
    expect(root.querySelector(".rviews")!.textContent).toContain("x2 ON TIME");
    expect(root.querySelector(".rcards")!.textContent).toBe(
      "NEW CLIPS: TOLL $0, THE RAMP",
    );
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
    expect(root.querySelector(".rviews")!.textContent).toContain("x0.5 LATE");
    root.querySelector<HTMLButtonElement>(".next.alt")!.click();
    expect(lobby).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("names the crash cause in the BREAKING band and shows a tip only when asked", () => {
    const { root, hud } = make();
    hud.crash("sinkhole", true, false);
    expect(root.querySelector(".breaking")!.textContent).toBe(
      "BREAKING: ROADSTER SWALLOWED BY SINKHOLE",
    );
    expect(root.querySelector(".ctip")!.classList.contains("show")).toBe(true);
    hud.crash("whatever", false, false);
    expect(root.querySelector(".breaking")!.textContent).toBe(
      "BREAKING: COMMUTER ROADSTER WIPES OUT",
    );
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
});
