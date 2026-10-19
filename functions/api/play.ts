// POST /api/play: anonymous play counts from the site (sent by src/telemetry.ts), one Workers Analytics Engine data
// point per event. The dataset is bound in the Cloudflare dashboard (Pages project > Settings > Bindings > Analytics
// engine, or wrangler.toml) as PLAYS, dataset late_roadster_plays; without that binding events are accepted and
// dropped (202 instead of 204, so a deployment's binding can be checked from outside).
// Stored per event: the random player ID, event, mode, grade, the visitor's country (from Cloudflare, not the IP),
// touch or desktop, seconds played since the last event, finished on time. Read back with scripts/stats.mjs.

interface Dataset {
  writeDataPoint(p: {
    indexes?: string[];
    blobs?: string[];
    doubles?: number[];
  }): void;
}
interface Ctx {
  request: Request & { cf?: { country?: string } };
  env: { PLAYS?: Dataset };
}

export interface Play {
  id: string;
  ev: string;
  mode: string;
  /** seconds actually played since the last event in this mode */
  s: number;
  grade: string;
  /** 1: the run finished on time */
  fin: number;
  dev: string;
}

const EVENTS = new Set(["visit", "start", "end", "time"]);
const MODES = new Set(["", "run", "free"]);
const GRADES = new Set(["", "S", "A", "B", "C", "LATE"]);
const DEVICES = new Set(["touch", "desktop"]);

/** The event, or null for anything malformed, oversized or out of range. */
export function parsePlay(text: string): Play | null {
  if (text.length > 512) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const p: Play = {
    id: str(r.id),
    ev: str(r.ev),
    mode: str(r.mode),
    s: typeof r.s === "number" ? r.s : 0,
    grade: str(r.grade),
    fin: r.fin === true ? 1 : 0,
    dev: str(r.dev),
  };
  if (
    !/^[0-9a-f]{32}$/.test(p.id) ||
    !EVENTS.has(p.ev) ||
    !MODES.has(p.mode) ||
    !GRADES.has(p.grade) ||
    !DEVICES.has(p.dev) ||
    !Number.isFinite(p.s) ||
    p.s < 0 ||
    p.s > 3600
  )
    return null;
  p.s = Math.round(p.s * 10) / 10;
  return p;
}

/** Only from the site itself (a browser always sends Origin with a POST). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (Number(request.headers.get("Content-Length") ?? 0) > 512)
    return new Response(null, { status: 413 });
  const p = parsePlay(await request.text());
  if (!p) return new Response(null, { status: 400 });
  if (!env.PLAYS) return new Response(null, { status: 202 });
  env.PLAYS.writeDataPoint({
    indexes: [p.id],
    blobs: [p.ev, p.mode, p.grade, request.cf?.country ?? "", p.dev],
    doubles: [p.s, p.fin],
  });
  return new Response(null, { status: 204 });
}
