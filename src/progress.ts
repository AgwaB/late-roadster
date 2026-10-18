// Progress kept across visits in localStorage (filmed clips, shown crash tips, best grade and VIEWS, own clip
// thumbnails). Storage can be unavailable or full: reads fall back to defaults, writes are best effort. Two tabs can
// be playing at once, so writes merge with what is stored instead of overwriting it with this tab's older copy.

/** the bits of Storage used here (localStorage, or a fake in tests) */
export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const GRADE_RANK = ["LATE", "C", "B", "A", "S"] as const;

export function load(store: Store | null, k: string): string | null {
  try {
    return store?.getItem(k) ?? null;
  } catch {
    return null;
  }
}

export function save(store: Store | null, k: string, v: string): void {
  try {
    store?.setItem(k, v);
  } catch {
    /* private mode / quota: this visit just will not be remembered */
  }
}

/** a stored JSON list of strings (empty when missing or not a list) */
export function parseSet(raw: string | null): Set<string> {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Save a set merged with what is stored now (another tab's additions are kept, and join this tab's set too). */
export function saveSetMerged(
  store: Store | null,
  k: string,
  s: Set<string>,
): void {
  for (const v of parseSet(load(store, k))) s.add(v);
  save(store, k, JSON.stringify([...s]));
}

export function finiteOr(v: string | null, d: number): number {
  const n = Number(v);
  return v !== null && Number.isFinite(n) && n >= 0 ? n : d;
}

/** the better of two grades (null / unknown = none) */
export function bestGradeOf(a: string | null, b: string | null): string | null {
  const ra = GRADE_RANK.indexOf(a as (typeof GRADE_RANK)[number]),
    rb = GRADE_RANK.indexOf(b as (typeof GRADE_RANK)[number]);
  if (ra < 0 && rb < 0) return null;
  return ra >= rb ? a : b;
}

/** Record a finished run's grade and VIEWS as bests, against what is stored now; returns the bests. */
export function saveBest(
  store: Store | null,
  grade: string,
  views: number,
): { grade: string | null; views: number } {
  const g = bestGradeOf(load(store, "lr.bestGrade"), grade);
  const v = Math.max(finiteOr(load(store, "lr.bestViews"), 0), views);
  if (g) save(store, "lr.bestGrade", g);
  save(store, "lr.bestViews", String(v));
  return { grade: g, views: v };
}
