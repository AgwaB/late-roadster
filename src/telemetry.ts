// Anonymous play counts, on the published site only: how many people play, and for how long. A random ID kept in
// localStorage (no cookies, nothing personal), a page visit, when a run starts and ends (grade, on time), and the
// seconds actually played: a commute or free roam on screen and not paused (no lobby, no hidden tab). Received by
// functions/api/play.ts.
import type { Store } from "./progress";

export type PlayMode = "run" | "free";

/** time is reported at least this often while playing, so a tab killed without a pagehide loses little */
const FLUSH_S = 120;

export class Telemetry {
  private pending: Record<PlayMode, number> = { run: 0, free: 0 };

  constructor(
    /** null: counting is off (dev server, local builds) */
    private readonly post: ((body: string) => void) | null,
    private readonly id: string,
    private readonly dev: "touch" | "desktop",
  ) {}

  /** Real seconds of this frame, while playing in mode (null: not playing). */
  tick(dt: number, mode: PlayMode | null): void {
    if (!mode || !(dt > 0)) return;
    this.pending[mode] += Math.min(dt, 0.25);
    if (this.pending[mode] >= FLUSH_S) this.send("time", mode);
  }

  /** A visit (page load), a run started, or a commute ended (with its grade); carries the time played in mode. */
  event(
    ev: "visit" | "start" | "end",
    mode: PlayMode | "" = "",
    extra: { grade?: string; fin?: boolean } = {},
  ): void {
    this.send(ev, mode, extra);
  }

  /** Report the time played so far (leaving for the lobby, the tab going away). */
  flush(): void {
    for (const m of ["run", "free"] as const)
      if (this.pending[m] >= 0.5) this.send("time", m);
  }

  private send(
    ev: string,
    mode: PlayMode | "",
    extra: { grade?: string; fin?: boolean } = {},
  ): void {
    const s = mode ? this.pending[mode] : 0;
    if (mode) this.pending[mode] = 0;
    this.post?.(
      JSON.stringify({
        id: this.id,
        ev,
        mode,
        s: Math.round(s * 10) / 10,
        dev: this.dev,
        ...extra,
      }),
    );
  }
}

/** This browser's random player ID (kept in localStorage; a fresh one per page load if storage is unavailable). */
export function anonId(store: Store | null): string {
  const ok = (v: string | null): v is string => !!v && /^[0-9a-f]{32}$/.test(v);
  try {
    const v = store?.getItem("lr.anon") ?? null;
    if (ok(v)) return v;
  } catch {
    // storage blocked: a per-visit ID
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  try {
    store?.setItem("lr.anon", id);
  } catch {
    // storage full or blocked
  }
  return id;
}

/** Fire-and-forget POST that survives the page closing. */
export function beacon(url: string): (body: string) => void {
  return (body) => {
    try {
      if (navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" })))
        return;
    } catch {
      // fall through to fetch
    }
    fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
  };
}
