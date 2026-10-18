export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Same seed for everyone on the same (local) calendar day: "today's commute" changes at the player's midnight. */
export function dailySeed(date = new Date()): number {
  const p = (n: number) => String(n).padStart(2, "0");
  return hashStr(
    date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate()),
  );
}
