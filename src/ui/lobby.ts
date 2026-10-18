// Lobby: what the game is, the keys, what is on the way, the clips to film, START (and FREE ROAM once every stunt
// clip is filmed), and the author's links. Shown while loading, before every run from the lobby, and on ESC.
import { CLIPS, FREE_ROAM_CLIPS, viewsText } from "../game/score";
import { forInput } from "./keys";

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

export interface LobbyInfo {
  persona: string;
  /** road distance home -> office, m */
  distance: number;
  bestGrade: string | null;
  bestViews: number;
  known: ReadonlySet<string>;
  /** your own shot of a filmed clip (a data URL), if one was taken */
  thumb?: (id: string) => string | null;
}

/** key groups: each row is the keycaps (alternatives) and what they do; columns hold one or more groups */
type KeyRow = [string[], string];
const KEY_COLUMNS: [string, KeyRow[]][][] = [
  [
    [
      "DRIVE",
      [
        [["W", "↑"], "Gas"],
        [["S", "↓"], "Brake / reverse"],
        [["A", "D"], "Steer"],
        [["SHIFT"], "Boost (uses SP)"],
        [["CTRL"], "Drift"],
        [["A A", "D D"], "Sidestep"],
      ],
    ],
  ],
  [
    [
      "AIR",
      [
        [["SPACE"], "Jump"],
        [["SPACE"], "Again in the air: flip"],
        [["HOLD SPACE"], "Fly (uses FUEL)"],
        [["E"], "Tunnel ceiling"],
      ],
    ],
    [
      "MORE",
      [
        [["SPACE"], "Skip crash replay"],
        [["Q", "ESC"], "Back to this lobby"],
      ],
    ],
  ],
];

/** clip thumbnails: public/assets/clips/<id>.webp (round-5 CL images, tools/r5_share.py) */
const THUMBS = true;

/** the same, named after the on-screen buttons on a touch screen */
const TOUCH_COLUMNS: [string, KeyRow[]][][] = [
  [
    [
      "DRIVE",
      [
        [["GAS"], "Gas"],
        [["BRAKE"], "Brake / reverse"],
        [["<", ">"], "Steer"],
        [["BOOST"], "Boost (uses SP)"],
        [["DRIFT"], "Drift"],
      ],
    ],
  ],
  [
    [
      "AIR",
      [
        [["JUMP"], "Jump"],
        [["JUMP"], "Again in the air: flip"],
        [["HOLD JUMP"], "Fly (uses FUEL)"],
        [["STICK"], "Tunnel ceiling"],
      ],
    ],
    [
      "MORE",
      [
        [["JUMP"], "Skip crash replay"],
        [["LOBBY"], "Back to this lobby"],
      ],
    ],
  ],
];

const WAY: [string, string, string][] = [
  ["toll", "TOLL QUEUE", "Every lane is stuck paying. Fly over the canopy."],
  ["sinkhole", "SINKHOLES", "Drive in and you wipe out. Hop them."],
  ["ramp", "THE RAMP", "At the event ground. Hit it fast, ride the wall."],
];

export class Lobby {
  readonly root: HTMLElement;
  private startBtn: HTMLButtonElement;
  private freeBtn: HTMLButtonElement;
  private loadFill: HTMLElement;
  private today: HTMLElement;
  private cardsCount: HTMLElement;
  private cardsFill: HTMLElement;
  private cards: HTMLElement;
  private ready = false;
  private canFree = false;
  isOpen = true;

  constructor(
    parent: HTMLElement,
    private on: { start(): void; free(): void },
    /** a touch screen: name the on-screen buttons, not keys */
    private touch = false,
  ) {
    const base = import.meta.env.BASE_URL;
    this.root = el("div", "lobby", parent);
    // absolute: a relative url() in a custom property resolves against the stylesheet that uses it (assets/), not the
    // page, so with the production base "./" it pointed at assets/assets/... and the key art never showed on the site
    this.root.style.setProperty(
      "--ka",
      'url("' +
        new URL(base + "assets/photo/KA_01.webp", document.baseURI).href +
        '")',
    );
    const panel = el("div", "lb-panel", this.root);
    const left = el("div", "lb-left", panel);
    el("div", "lb-title", left, "LATE ROADSTER");
    el("div", "lb-sub", left, "THIS SIDE UP");
    const pitch = el("div", "lb-pitch", left);
    el("b", "", pitch, "It's 8:58:30. The office opens at 9:00.");
    el(
      "span",
      "",
      pitch,
      "Your roadster jumps, flips, flies and drives on ceilings.",
    );
    el(
      "span",
      "",
      pitch,
      "Every stunt earns VIEWS. Twelve clips are waiting to be filmed.",
    );
    this.today = el("div", "lb-stats", left);
    const keys = el("div", "lb-keys", left);
    for (const column of touch ? TOUCH_COLUMNS : KEY_COLUMNS) {
      const col = el("div", "lb-kcol", keys);
      for (const [group, rows] of column) {
        el("div", "lb-h", col, group);
        for (const [caps, what] of rows) {
          const r = el("div", "lb-krow", col);
          const kc = el("span", "kc", r);
          caps.forEach((k, i) => {
            if (i) el("span", "sep", kc, "/");
            el("kbd", "", kc, k);
          });
          el("span", "kd", r, what);
        }
      }
    }
    if (!touch) el("div", "lb-note", left, "Arrow keys work too.");
    const actions = el("div", "lb-actions", left);
    this.startBtn = el("button", "lb-start", actions, "LOADING");
    this.startBtn.disabled = true;
    this.startBtn.onclick = () => {
      if (this.ready && this.isOpen) this.on.start();
    };
    this.freeBtn = el("button", "lb-free", actions, "FREE ROAM");
    this.freeBtn.onclick = () => {
      if (this.ready && this.isOpen && this.canFree) this.on.free();
    };
    this.loadFill = el("i", "", el("b", "lb-load", left));
    const by = el("div", "lb-by", left, "MADE BY TOBY");
    for (const [label, href] of [
      ["GitHub @agwab", "https://github.com/AgwaB/late-roadster"],
      ["X @Toby_AgwaB", "https://x.com/Toby_AgwaB"],
    ]) {
      const a = el("a", "", by, label);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    const right = el("div", "lb-right", panel);
    el("div", "lb-h", right, "ON THE WAY");
    const way = el("div", "lb-way", right);
    for (const [img, title, line] of WAY) {
      const t = el("div", "lb-tile", way);
      const im = el("img", "", t);
      im.src = base + "assets/lobby/" + img + ".webp";
      im.alt = title;
      el("b", "", t, title);
      el("span", "", t, line);
    }
    const ch = el("div", "lb-cardshead", right);
    el("span", "lb-h", ch, "CLIPS");
    this.cardsCount = el("b", "", ch, "0 / " + CLIPS.length);
    this.cardsFill = el("i", "", el("span", "lb-prog", ch));
    el(
      "span",
      "lb-note",
      ch,
      FREE_ROAM_CLIPS.length + " stunt clips unlock FREE ROAM",
    );
    this.cards = el("div", "lb-cards", right);
    el(
      "div",
      "lb-note",
      right,
      "Coloured clips are marked on the minimap and by light beams in the city. Grey ones can be filmed anywhere.",
    );
    window.addEventListener("keydown", (e) => {
      if (!this.isOpen || !this.ready || e.repeat) return;
      if (e.code !== "Enter" && e.code !== "Space") return;
      // keep native activation for a focused link / FREE ROAM button
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("a, button") &&
        e.target !== this.startBtn
      )
        return;
      e.preventDefault();
      this.on.start();
    });
  }

  setLoading(f: number): void {
    this.loadFill.style.width = (f * 100).toFixed(0) + "%";
  }

  setReady(): void {
    this.ready = true;
    this.startBtn.disabled = false;
    this.startBtn.textContent = "START";
    this.root.classList.add("ready");
    if (this.isOpen) this.startBtn.focus({ preventScroll: true });
  }

  show(info: LobbyInfo): void {
    const base = import.meta.env.BASE_URL;
    this.isOpen = true;
    this.root.classList.remove("out");
    this.root.inert = false;
    this.today.replaceChildren();
    const stat = (label: string, big: string, small: string) => {
      const s = el("div", "lb-stat", this.today);
      el("span", "", s, label);
      el("b", "", s, big);
      el("small", "", s, small);
    };
    // (no persona yet: still loading, the same two lines as a placeholder)
    stat(
      "TODAY'S COMMUTE",
      info.persona || "...",
      info.persona
        ? (info.distance / 1000).toFixed(1) + " km to the office"
        : "finding today's route",
    );
    stat(
      "BEST",
      info.bestGrade ?? "-",
      info.bestGrade ? viewsText(info.bestViews) + " VIEWS" : "no run yet",
    );
    const n = CLIPS.filter((c) => info.known.has(c.id)).length;
    this.cardsCount.textContent = n + " / " + CLIPS.length;
    this.cardsFill.style.width = ((n / CLIPS.length) * 100).toFixed(0) + "%";
    this.cards.replaceChildren();
    for (const c of CLIPS) {
      const got = info.known.has(c.id);
      const d = el("div", "lb-card" + (got ? " got" : ""), this.cards);
      if (THUMBS) {
        const im = el("img", "lb-cthumb" + (got ? "" : " dim"), d);
        // your own shot of it once filmed (taken the moment it happened), else the stock picture
        im.src =
          (got && info.thumb?.(c.id)) ||
          base + "assets/clips/" + c.id + ".webp";
        im.alt = "";
        im.onerror = () => im.remove();
      }
      const hd = el("div", "lb-chd", d);
      // the clip's colour: the same as its dot on the minimap and its light beam in the city
      const dot = el("i", "dot" + (c.color ? "" : " any"), hd);
      if (c.color) dot.style.background = c.color;
      if (got) el("b", "", hd, c.title);
      else el("em", "", hd, "TO FILM");
      el("span", "", d, got ? c.caption : forInput(c.how, this.touch));
    }
    const nFree = FREE_ROAM_CLIPS.filter((c) => info.known.has(c.id)).length;
    this.canFree = nFree >= FREE_ROAM_CLIPS.length;
    this.freeBtn.disabled = !this.canFree;
    this.freeBtn.textContent = this.canFree
      ? "FREE ROAM"
      : "FREE ROAM  " + nFree + " / " + FREE_ROAM_CLIPS.length;
    if (this.ready) this.startBtn.focus({ preventScroll: true });
  }

  hide(): void {
    this.isOpen = false;
    this.root.classList.add("out");
    this.root.inert = true; // out of the tab order while a run is on
    this.startBtn.blur();
  }
}
