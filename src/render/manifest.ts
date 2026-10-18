// Generated/assembled models and poly.pizza models (CC0 / CC BY 4.0). Attribution appears in the in-game credits.
export type Cat = "car" | "prop" | "building";
export interface ModelSpec {
  id: string;
  name: string;
  author: string;
  license: "CC0" | "CC BY 4.0";
  source?: string;
  changes?: string;
  cat: Cat;
  len?: number;
  height?: number;
  fwd?: 1 | -1;
  dir?: string;
  /** mesh names left out of the baked model (drawn separately in game) */
  omit?: RegExp;
}

const POLY_PIZZA_CHANGES =
  "Normalized scale/orientation; meshopt compression and WebP texture optimisation where applicable; material tweaks for the game.";
const LICENSE_URLS = {
  CC0: "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
};

// len = target length in metres (cars, along the forward axis); height = target height (props/buildings).
export const MODELS: ModelSpec[] = [
  ...[1, 2, 3, 4, 5, 6].map((i) => ({
    id: "euro_" + i,
    name:
      "Apartment block " +
      i +
      " (assembled from Poly Haven modular_urban_apartments_facade)",
    author: "Poly Haven / Late Roadster",
    license: "CC0" as const,
    cat: "building" as const,
    dir: "gen",
  })),
  ...[
    "a1",
    "a2",
    "a3",
    "a4",
    "a5",
    "a6",
    "a7",
    "a8",
    "a9",
    "a10",
    "a11",
    "a12",
    "a13",
    "a14",
    "t1",
    "t2",
    "t3",
    "t4",
    "t5",
    "t6",
  ].map((k) => ({
    id: "photo_" + k,
    name: "Photo-facade slab " + k + " (Blender box, generated elevation)",
    author: "Late Roadster",
    license: "CC0" as const,
    cat: "building" as const,
    dir: "gen",
  })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
    id: "bldg_" + i,
    name: "Commercial building " + i,
    author: "Late Roadster (Blender, procedural)",
    license: "CC0" as const,
    cat: "building" as const,
    dir: "gen",
  })),
  {
    // the player's car and the fellow-commuter roadster (tools/blender/r3/roadster.py)
    id: "roadster_r3",
    name: "Roadster",
    author: "Late Roadster (Blender, from generated images)",
    license: "CC0",
    cat: "car",
    len: 4.6,
    fwd: 1,
    dir: "gen",
  },
  {
    id: "1mkmFkAz5v",
    source: "https://poly.pizza/m/1mkmFkAz5v",
    changes: POLY_PIZZA_CHANGES,
    name: "Sports Car",
    author: "Quaternius",
    license: "CC0",
    cat: "car",
    len: 4.5,
  },
  {
    id: "unqqkULtRU",
    source: "https://poly.pizza/m/unqqkULtRU",
    changes: POLY_PIZZA_CHANGES,
    name: "Car",
    author: "Quaternius",
    license: "CC0",
    cat: "car",
    len: 4.4,
  },
  {
    id: "Cz6yDaUcM9",
    source: "https://poly.pizza/m/Cz6yDaUcM9",
    changes: POLY_PIZZA_CHANGES,
    name: "Car",
    author: "Quaternius",
    license: "CC0",
    cat: "car",
    len: 4.5,
  },
  {
    id: "xsMtZhBkxL",
    source: "https://poly.pizza/m/xsMtZhBkxL",
    changes: POLY_PIZZA_CHANGES,
    name: "SUV",
    author: "Quaternius",
    license: "CC0",
    cat: "car",
    len: 4.7,
  },
  {
    id: "BwwnUrWGmV",
    source: "https://poly.pizza/m/BwwnUrWGmV",
    changes: POLY_PIZZA_CHANGES,
    name: "Police Car",
    author: "Quaternius",
    license: "CC0",
    cat: "car",
    len: 4.6,
  },
  {
    id: "x43lOScTpN",
    source: "https://poly.pizza/m/x43lOScTpN",
    changes: POLY_PIZZA_CHANGES,
    name: "Taxi",
    author: "Quaternius",
    license: "CC0",
    cat: "car",
    len: 4.5,
  },
  {
    id: "cXw6oiFtZ8",
    source: "https://poly.pizza/m/cXw6oiFtZ8",
    changes: POLY_PIZZA_CHANGES,
    name: "Truck",
    author: "Quaternius",
    license: "CC0",
    cat: "car",
    len: 6.5,
  },
  {
    id: "qn4grQgHm8",
    source: "https://poly.pizza/m/qn4grQgHm8",
    changes: POLY_PIZZA_CHANGES,
    name: "Pickup Truck",
    author: "Quaternius",
    license: "CC0",
    cat: "car",
    len: 5.3,
  },
  {
    id: "BG0KAhmGDt",
    source: "https://poly.pizza/m/BG0KAhmGDt",
    changes: POLY_PIZZA_CHANGES,
    name: "Car Hatchback",
    author: "Kay Lousberg",
    license: "CC0",
    cat: "car",
    len: 4.1,
  },
  {
    id: "vTTTjDoxhV",
    source: "https://poly.pizza/m/vTTTjDoxhV",
    changes: POLY_PIZZA_CHANGES,
    name: "Stationwagon",
    author: "Kay Lousberg",
    license: "CC0",
    cat: "car",
    len: 4.7,
  },
  {
    id: "aT_24cDaW1a",
    source: "https://poly.pizza/m/aT_24cDaW1a",
    changes: POLY_PIZZA_CHANGES,
    name: "Van",
    author: "Poly by Google",
    license: "CC BY 4.0",
    cat: "car",
    len: 5.0,
  },
  {
    id: "dggOiBLYyuR",
    source: "https://poly.pizza/m/dggOiBLYyuR",
    changes: POLY_PIZZA_CHANGES,
    name: "Convertible",
    author: "Poly by Google",
    license: "CC BY 4.0",
    cat: "car",
    len: 4.6,
  },
  {
    id: "4CPpvEmrMoF",
    source: "https://poly.pizza/m/4CPpvEmrMoF",
    changes: POLY_PIZZA_CHANGES,
    name: "Bus",
    author: "Poly by Google",
    license: "CC BY 4.0",
    cat: "car",
    len: 11.5,
    // the whole roof is "cabin", so the cabin heuristic guessed the wrong end: the windscreen end is the front
    fwd: 1,
  },
  {
    id: "fFCCghvRImG",
    source: "https://poly.pizza/m/fFCCghvRImG",
    changes: POLY_PIZZA_CHANGES,
    name: "Montreal Bus",
    author: "Nick Ladd",
    license: "CC BY 4.0",
    cat: "car",
    len: 12,
  },
  {
    id: "57rxXzowK8w",
    source: "https://poly.pizza/m/57rxXzowK8w",
    changes: POLY_PIZZA_CHANGES,
    name: "Traffic light",
    author: "Poly by Google",
    license: "CC BY 4.0",
    cat: "prop",
    height: 6.5,
  },
  {
    id: "OWczicNWhO",
    source: "https://poly.pizza/m/OWczicNWhO",
    changes: POLY_PIZZA_CHANGES,
    name: "Bus Stop",
    author: "Zsky",
    license: "CC BY 4.0",
    cat: "prop",
    height: 3.2,
  },
  {
    id: "60GyU9CdZ9r",
    source: "https://poly.pizza/m/60GyU9CdZ9r",
    changes: POLY_PIZZA_CHANGES,
    name: "Stop sign",
    author: "Poly by Google",
    license: "CC BY 4.0",
    cat: "prop",
    height: 2.6,
  },
  {
    id: "i7HDuYDLkx",
    source: "https://poly.pizza/m/i7HDuYDLkx",
    changes: POLY_PIZZA_CHANGES,
    name: "Trashcan Small",
    author: "Quaternius",
    license: "CC0",
    cat: "prop",
    height: 1.0,
  },
  {
    id: "dOSjmdmKaxi",
    source: "https://poly.pizza/m/dOSjmdmKaxi",
    changes: POLY_PIZZA_CHANGES,
    name: "Bench",
    author: "Ev Amitay",
    license: "CC BY 4.0",
    cat: "prop",
    height: 0.9,
  },
  {
    id: "e5jmUgocmaT",
    source: "https://poly.pizza/m/e5jmUgocmaT",
    changes: POLY_PIZZA_CHANGES,
    name: "Billboard",
    author: "Poly by Google",
    license: "CC BY 4.0",
    cat: "prop",
    height: 9,
  },
  {
    id: "AVCS8jUd2l",
    source: "https://poly.pizza/m/AVCS8jUd2l",
    changes: POLY_PIZZA_CHANGES,
    name: "Big Building",
    author: "Quaternius",
    license: "CC0",
    cat: "building",
  },
  {
    id: "GoF3zph6WI",
    source: "https://poly.pizza/m/GoF3zph6WI",
    changes: POLY_PIZZA_CHANGES,
    name: "Business Building",
    author: "Quaternius",
    license: "CC0",
    cat: "building",
  },
  {
    id: "T3oyvK6VEU",
    source: "https://poly.pizza/m/T3oyvK6VEU",
    changes: POLY_PIZZA_CHANGES,
    name: "Building",
    author: "Kay Lousberg",
    license: "CC0",
    cat: "building",
  },
  {
    id: "ppwtREejXg",
    source: "https://poly.pizza/m/ppwtREejXg",
    changes: POLY_PIZZA_CHANGES,
    name: "Large Building",
    author: "Kenney",
    license: "CC0",
    cat: "building",
  },
  {
    id: "obYD8hWLTZ",
    source: "https://poly.pizza/m/obYD8hWLTZ",
    changes: POLY_PIZZA_CHANGES,
    name: "Skyscraper",
    author: "Kenney",
    license: "CC0",
    cat: "building",
  },
  {
    id: "01lqee-dZAr",
    source: "https://poly.pizza/m/01lqee-dZAr",
    changes: POLY_PIZZA_CHANGES,
    name: "Apartment building",
    author: "Poly by Google",
    license: "CC BY 4.0",
    cat: "building",
  },
  // round 3: modelled in Blender from generated reference images (tools/blender/r3/*.py)
  ...(
    [
      ["dumpster_r3", "Dumpster", 1.3],
      ["container_r3_red", "Shipping container (red)", 2.59],
      ["container_r3_blue", "Shipping container (blue)", 2.59],
      ["scooter_r3", "Rental e-scooter", 1.2],
    ] as const
  ).map(([id, name, height]) => ({
    id,
    name,
    author: "Late Roadster (Blender, from generated images)",
    license: "CC0" as const,
    cat: "prop" as const,
    height,
    dir: "gen",
  })),
  // real-size round-3 props and landmarks (no rescale)
  ...(
    [
      ["toll_booth_r3", "Toll booth", "prop"],
      ["bridge_lamp_r3", "Bridge lamp post", "prop"],
      ["bridge_parapet_r3", "Bridge parapet", "prop"],
      ["cz_barrier", "Water-filled road barrier", "prop"],
      ["cz_sign", "Road-work A-frame sign", "prop"],
      ["cz_arrowboard", "Arrow-board trailer", "prop"],
      ["cz_excavator", "Mini excavator", "prop"],
      ["hq_r3", "ONTIME HOLDINGS headquarters", "building"],
      ["villa_r3", "MAPLE VILLA", "building"],
    ] as const
  ).map(([id, name, cat]) => ({
    id,
    name,
    author: "Late Roadster (Blender, from generated images)",
    license: "CC0" as const,
    cat,
    dir: "gen",
    // the clock hands are drawn in game (stopped at the 9:00 deadline); the car-park annex would overhang most lots
    omit:
      id === "hq_r3"
        ? /^(clock_hour|clock_minute|hq_staff_parking)$/
        : undefined,
  })),
];

export const CREDITS = [
  ...MODELS.map((m) =>
    [
      `${m.name} — ${m.author} (${m.license})`,
      m.source && `Source: ${m.source}`,
      `License: ${LICENSE_URLS[m.license]}`,
      m.changes && `Changes: ${m.changes}`,
    ]
      .filter(Boolean)
      .join(" | "),
  ),
  "Facade kit — Poly Haven (CC0): modular_urban_apartments_facade (assembled into the euro_* blocks, its texture maps shipped under assets/ph/facade)",
  "Traffic cones — Kenney Car Kit (CC0)",
  "Landing boosters and jet shopping cart (booster_r4, booster_leg_r4, cart_r4) — modelled in Blender for Late Roadster from generated reference images (CC0)",
  "Photo-style textures, signs, key art, lobby and clip pictures, cyclists, share card and icons — generated project artwork for Late Roadster, fictional brands only (CC0)",
  "Share-card title font: Pretendard by Kil Hyung-jin (SIL Open Font License 1.1)",
  "Textures — ambientCG (CC0)",
  'Sky — Poly Haven "kloofendal_48d_partly_cloudy_puresky" (CC0)',
  "Cladding textures Tiles143 / Tiles140 / Bricks059 — ambientCG (CC0)",
  "Tree billboards — rendered in Blender for Late Roadster (CC0)",
];
