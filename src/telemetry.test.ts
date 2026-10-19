import { describe, expect, it, vi } from "vitest";
import { onRequestPost, parsePlay } from "../functions/api/play";
import { Telemetry, anonId } from "./telemetry";

const ID = "0123456789abcdef0123456789abcdef";

describe("play counts: the client", () => {
  it("counts only the seconds actually played, per mode, and reports them with the next event", () => {
    const sent: Record<string, unknown>[] = [];
    const t = new Telemetry((b) => sent.push(JSON.parse(b)), ID, "desktop");
    t.event("visit");
    for (let i = 0; i < 600; i++) t.tick(0.1, null); // the lobby
    t.event("start", "run");
    for (let i = 0; i < 900; i++) t.tick(0.1, "run"); // a 90 s commute
    t.event("end", "run", { grade: "A", fin: true });
    t.event("start", "free");
    for (let i = 0; i < 300; i++) t.tick(0.1, "free");
    t.flush(); // back to the lobby
    t.flush(); // nothing new: nothing sent
    expect(sent.map((e) => [e.ev, e.mode, e.s])).toEqual([
      ["visit", "", 0],
      ["start", "run", 0],
      ["end", "run", 90],
      ["start", "free", 0],
      ["time", "free", 30],
    ]);
    expect(sent[2]).toMatchObject({
      id: ID,
      grade: "A",
      fin: true,
      dev: "desktop",
    });
    // every event the client sends is one the endpoint accepts
    for (const e of sent) expect(parsePlay(JSON.stringify(e))).not.toBeNull();
  });

  it("reports long sessions every two minutes, and ignores frame spikes", () => {
    const sent: { ev: string; s: number }[] = [];
    const t = new Telemetry((b) => sent.push(JSON.parse(b)), ID, "touch");
    t.tick(30, "free"); // a stalled frame counts as 0.25 s at most
    for (let i = 0; i < 1300; i++) t.tick(0.1, "free");
    expect(sent).toHaveLength(1);
    expect(sent[0].ev).toBe("time");
    expect(sent[0].s).toBeGreaterThanOrEqual(120);
    expect(sent[0].s).toBeLessThan(121);
  });

  it("does nothing when counting is off", () => {
    const t = new Telemetry(null, ID, "desktop");
    expect(() => {
      t.event("visit");
      t.tick(1, "run");
      t.flush();
    }).not.toThrow();
  });

  it("keeps one random ID per browser", () => {
    const m = new Map<string, string>();
    const store = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    const a = anonId(store);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(anonId(store)).toBe(a);
    expect(anonId(null)).not.toBe(a);
  });
});

describe("play counts: the endpoint", () => {
  const post = (
    body: string,
    origin: string | null = "https://late-roadster.pages.dev",
  ) =>
    new Request("https://late-roadster.pages.dev/api/play", {
      method: "POST",
      body,
      headers: origin ? { Origin: origin } : {},
    });
  const ok = JSON.stringify({
    id: ID,
    ev: "end",
    mode: "run",
    s: 88.04,
    grade: "S",
    fin: true,
    dev: "touch",
  });

  it("writes one data point per valid event", async () => {
    const writeDataPoint = vi.fn();
    const req = Object.assign(post(ok), { cf: { country: "KR" } });
    const res = await onRequestPost({
      request: req,
      env: { PLAYS: { writeDataPoint } },
    });
    expect(res.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [ID],
      blobs: ["end", "run", "S", "KR", "touch"],
      doubles: [88, 1],
    });
  });

  it("accepts and drops events while the dataset is not bound yet", async () => {
    expect((await onRequestPost({ request: post(ok), env: {} })).status).toBe(
      202,
    );
  });

  it("rejects other sites, malformed and out-of-range events", async () => {
    const writeDataPoint = vi.fn();
    const env = { PLAYS: { writeDataPoint } };
    expect(
      (await onRequestPost({ request: post(ok, "https://evil.example"), env }))
        .status,
    ).toBe(403);
    expect((await onRequestPost({ request: post(ok, null), env })).status).toBe(
      403,
    );
    for (const bad of [
      "not json",
      JSON.stringify({ id: "x", ev: "end", mode: "run", s: 1, dev: "touch" }),
      JSON.stringify({ id: ID, ev: "hack", mode: "run", s: 1, dev: "touch" }),
      JSON.stringify({ id: ID, ev: "time", mode: "run", s: 1e9, dev: "touch" }),
      JSON.stringify({ id: ID, ev: "time", mode: "run", s: -1, dev: "touch" }),
      JSON.stringify({
        id: ID,
        ev: "end",
        mode: "run",
        s: 1,
        grade: "Z",
        dev: "touch",
      }),
      JSON.stringify({ id: ID, ev: "time", mode: "run", s: 1, dev: "toaster" }),
      "x".repeat(600),
    ])
      expect((await onRequestPost({ request: post(bad), env })).status).toBe(
        400,
      );
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
});
