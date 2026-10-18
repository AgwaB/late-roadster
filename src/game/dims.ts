// Vehicle body sizes = the rendered models' bodies, measured from the GLBs (half length, roof height, and the half
// width of the rear 60 % so wing mirrors don't inflate it; keep in sync when a model changes). Shared by the moving
// traffic (src/game/traffic.ts) and the parked / queueing cars the city places (src/game/city.ts), so a parked van is
// as tall to land on as a moving one, and as big as it is drawn.
export interface VehicleDims {
  halfL: number;
  halfW: number;
  h: number;
}

export const VEHICLE_DIMS = {
  sedan: { halfL: 2.2, halfW: 1.0, h: 1.5 },
  sedan2: { halfL: 2.25, halfW: 0.9, h: 1.25 },
  hatchback: { halfL: 2.05, halfW: 1.05, h: 1.85 },
  wagon: { halfL: 2.35, halfW: 1.05, h: 1.85 },
  suv: { halfL: 2.35, halfW: 1.1, h: 1.7 },
  taxi: { halfL: 2.25, halfW: 0.9, h: 1.4 },
  police: { halfL: 2.3, halfW: 1.05, h: 1.55 },
  van: { halfL: 2.5, halfW: 1.15, h: 2.15 },
  truck: { halfL: 3.25, halfW: 1.6, h: 3.55 },
  pickup: { halfL: 2.65, halfW: 1.15, h: 1.9 },
  sports: { halfL: 2.25, halfW: 1.0, h: 1.4 },
  convertible: { halfL: 2.3, halfW: 0.95, h: 1.4 },
  bus: { halfL: 5.75, halfW: 1.8, h: 3.55 },
  camper: { halfL: 2.5, halfW: 1.15, h: 2.15 },
  roadster: { halfL: 2.35, halfW: 1.0, h: 1.15 },
} as const satisfies Record<string, VehicleDims>;
