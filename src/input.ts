// Keyboard + touch -> Input (Raycity layout). A hidden focused <input> receives keys so page-level shortcut
// extensions (Vimium etc.) don't swallow letters like 'd'.
import type { Input } from "./game/physics";

const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyE",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
]);

type TouchName =
  "left" | "right" | "accel" | "brake" | "drift" | "jump" | "boost" | "stick";

export class InputState {
  private keys = new Set<string>();
  private tapped = new Set<string>();
  private touch: Record<TouchName, boolean> = {
    left: false,
    right: false,
    accel: false,
    brake: false,
    drift: false,
    jump: false,
    boost: false,
    stick: false,
  };
  private touchTapped = new Set<string>();
  private lastTap: Record<string, number> = {};
  private sidestep = 0;
  private sink: HTMLInputElement | null = null;
  private gameplay = true;

  get gameplayEnabled(): boolean {
    return this.gameplay;
  }

  setGameplayEnabled(enabled: boolean): void {
    this.gameplay = enabled;
    this.keys.clear();
    this.tapped.clear();
    this.touchTapped.clear();
    this.lastTap = {};
    this.sidestep = 0;
    for (const name of Object.keys(this.touch) as TouchName[])
      this.touch[name] = false;
    if (enabled) this.sink?.focus({ preventScroll: true });
    else this.sink?.blur();
  }

  constructor(useSink = true) {
    if (useSink) {
      const s = document.createElement("input");
      s.setAttribute("aria-hidden", "true");
      s.autocomplete = "off";
      s.tabIndex = -1;
      s.style.cssText =
        "position:fixed;left:-20px;top:-20px;width:4px;height:4px;opacity:0.01;border:0;padding:0;pointer-events:none;";
      document.body.appendChild(s);
      this.sink = s;
      const refocus = () => {
        if (this.gameplay && document.activeElement === document.body)
          s.focus({ preventScroll: true });
      };
      refocus();
      window.addEventListener("pointerdown", () => setTimeout(refocus, 0));
      window.addEventListener("focus", refocus);
      s.addEventListener("blur", () => setTimeout(refocus, 50));
      s.addEventListener("input", () => {
        s.value = "";
      });
    }
    window.addEventListener("keydown", (e) => {
      if (
        !this.gameplay ||
        !GAME_KEYS.has(e.code) ||
        e.metaKey ||
        (e.target instanceof HTMLElement &&
          e.target !== this.sink &&
          !!e.target.closest(
            "button, a, input, textarea, select, [contenteditable]",
          ))
      )
        return;
      if (!e.repeat) {
        this.keys.add(e.code);
        this.tapped.add(e.code);
        const dir =
          e.code === "KeyA" || e.code === "ArrowLeft"
            ? 1
            : e.code === "KeyD" || e.code === "ArrowRight"
              ? -1
              : 0;
        if (dir !== 0) {
          const now = performance.now();
          const key = "dir" + dir;
          if (now - (this.lastTap[key] ?? -1e9) < 260) this.sidestep = dir;
          this.lastTap[key] = now;
        }
      }
      e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.tapped.clear();
      this.sidestep = 0;
    });
  }

  setTouch(name: TouchName, down: boolean): void {
    if (!this.gameplay) return;
    this.touch[name] = down;
    if (down) {
      this.touchTapped.add(name);
      if (name === "left" || name === "right") {
        const now = performance.now();
        if (now - (this.lastTap[name] ?? -1e9) < 300)
          this.sidestep = name === "left" ? 1 : -1;
        this.lastTap[name] = now;
      }
    }
  }

  read(): Input {
    const k = this.keys;
    const left = k.has("KeyA") || k.has("ArrowLeft") || this.touch.left;
    const right = k.has("KeyD") || k.has("ArrowRight") || this.touch.right;
    const out: Input = {
      steer: (left ? 1 : 0) - (right ? 1 : 0),
      accel: k.has("KeyW") || k.has("ArrowUp") || this.touch.accel,
      brake: k.has("KeyS") || k.has("ArrowDown") || this.touch.brake,
      drift:
        k.has("ControlLeft") ||
        k.has("ControlRight") ||
        k.has("AltLeft") ||
        k.has("AltRight") ||
        this.touch.drift,
      jump:
        k.has("Space") ||
        this.tapped.has("Space") ||
        this.touch.jump ||
        this.touchTapped.has("jump"),
      boost: k.has("ShiftLeft") || k.has("ShiftRight") || this.touch.boost,
      // tapped: a press shorter than one frame still toggles the ceiling
      stick:
        k.has("KeyE") ||
        this.tapped.has("KeyE") ||
        this.touch.stick ||
        this.touchTapped.has("stick"),
      sidestep: this.sidestep,
    };
    this.sidestep = 0;
    this.tapped.clear();
    this.touchTapped.clear();
    return out;
  }
}
