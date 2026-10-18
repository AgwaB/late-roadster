import { describe, expect, it } from "vitest";
import {
  bestGradeOf,
  parseSet,
  saveBest,
  saveSetMerged,
  type Store,
} from "./progress";

const fakeStore = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};

describe("progress across tabs", () => {
  it("two tabs filming different clips keep both", () => {
    const store = fakeStore();
    const a = parseSet(store.getItem("lr.cards")),
      b = parseSet(store.getItem("lr.cards")); // both tabs loaded the same (empty) progress
    a.add("toll");
    saveSetMerged(store, "lr.cards", a);
    b.add("sinkhole");
    saveSetMerged(store, "lr.cards", b);
    expect(parseSet(store.getItem("lr.cards"))).toEqual(
      new Set(["toll", "sinkhole"]),
    );
    expect(b.has("toll")).toBe(true); // the second tab now knows the first one's clip too
  });

  it("a lower run in another tab never lowers the stored bests", () => {
    const store = fakeStore();
    expect(saveBest(store, "S", 900_000)).toEqual({
      grade: "S",
      views: 900_000,
    });
    expect(saveBest(store, "B", 300_000)).toEqual({
      grade: "S",
      views: 900_000,
    });
    expect(store.getItem("lr.bestGrade")).toBe("S");
    expect(store.getItem("lr.bestViews")).toBe("900000");
    expect(saveBest(store, "LATE", 1_200_000).views).toBe(1_200_000);
  });

  it("survives broken or missing storage", () => {
    expect(parseSet("{oops")).toEqual(new Set());
    expect(bestGradeOf("nonsense", null)).toBeNull();
    expect(bestGradeOf("A", "nonsense")).toBe("A");
    const broken: Store = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const s = new Set(["toll"]);
    expect(() => saveSetMerged(broken, "lr.cards", s)).not.toThrow();
    expect(saveBest(broken, "A", 10)).toEqual({ grade: "A", views: 10 });
    expect(() => saveSetMerged(null, "lr.cards", s)).not.toThrow();
  });
});
