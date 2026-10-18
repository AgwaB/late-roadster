// Tuning constants. [튜닝] values are adjusted in play sessions. Feel target: Raycity (wide Seoul boulevards, 150-300 km/h, SP skills).

// ---- city grid (wide boulevards)
export const P = 200; // block pitch (m)
export const K = 5; // grid lines at k*P, k in [-K, K]
export const CITY_HALF = K * P; // 1000
export const LANE_W = 3.5;
export const LANES_PER_DIR = 4;
export const MEDIAN_HALF = 1.0;
export const ROADWAY_HALF = MEDIAN_HALF + LANES_PER_DIR * LANE_W; // 15
export const SIDEWALK_W = 10;
export const ROAD_HALF = ROADWAY_HALF + SIDEWALK_W; // 25
export const CURB_H = 0.15;
export const RIVER_HALF = 90;
export const CROSSINGS = [-3, 0, 3]; // rows with bridge / tunnel / bridge
export const TUNNEL_ROW = 0;
// the commute corridor: every route runs home column -> y = 0 -> river tunnel -> under the skyway -> office column,
// so the set pieces sit along y = 0 (city.ts routeCost keeps routes on it east of the tunnel up to CORRIDOR_X1)
export const CORRIDOR_X1 = 600;
export const EVENT_BLOCK_I = -2; // block x -400..-200 south of y = 0: open launch-event ground
export const MART_BLOCK_I = 2; // block x 400..600 south of y = 0: ORBIT MART plaza
export const TOLL_X = -520; // FLYERS TOLL $0 gate across y = 0
export const TUNNEL_HALF_X = 170; // stays clear of the bank-road intersections at x = ±P
export const CEIL_H = 6.5;
export const CEIL_RISE = 0.6; // s of the jet-powered rise to the tunnel ceiling (roll over in the second half)
// elevated expressway ("skyway") over the y = 0 arterial east of the river tunnel: a ramp at each end climbs from
// the inner lane up to the deck (and back down), one lane each way
export const SKY_H = 11; // deck surface height (m)
export const SKY_HALF = 8; // half width incl. parapets: covers the two inner lanes each way
export const SKY_X0 = 240;
export const SKY_X1 = 760;
// each end ramp: from the road at SKY_X0 up to the deck SKY_RAMP m on (an S-curve, ~13 % at its steepest), ending
// short of the zebra crossing before the x = 400 / 600 junctions; over the inner lane only (lane 1 runs beside it)
export const SKY_RAMP = 128;
export const SKY_RAMP_HALF = 4.9; // half width incl. parapets
export const SKY_TAPER = 30; // m over which the deck widens from the ramp to its full width
export const COMMUTE_MIN = 2800; // road distance home -> office (m)
export const COMMUTE_MAX = 3400;

// ---- car
// player roadster body box, measured from its model (4.7 m x 1.98 m, roof 1.13 m)
export const CAR_HALF_W = 1.0;
export const CAR_HALF_L = 2.35;
export const CAR_ROOF = 1.15;
export const CAR_H = 1.7; // ceiling clearance used for the upside-down lane
export const BASE_SPEED = 42; // m/s (151 km/h) with the accelerator held
export const BOOST_SPEED = 62; // m/s (223 km/h)
export const REVERSE_MAX = 10;
export const ACCEL = 16;
export const BOOST_ACCEL = 30;
export const COAST_DECEL = 5; // accelerator released
export const BRAKE_DECEL = 28;
export const TURN_RATE_LOW = 2.6; // rad/s at low speed
export const TURN_RATE_HIGH = 1.35; // rad/s at BASE_SPEED
export const DRIFT_TURN_MULT = 1.7;
export const DRIFT_SPEED_K = 0.8; // drift speed target as a fraction of BASE while accelerating
export const DRIFT_SLIDE = 9; // lateral m/s while drifting
export const SIDESTEP_V = 14; // 칼치기 lateral impulse
export const STEER_RAMP = 0.08; // s to full lock
export const STEER_RELEASE = 0.08;
export const YAW_RESPONSE = 22; // 1/s
export const JUMP_V = 9.6; // thruster hop: ~2.3 m peak, ~1 s airborne (one height only, no hold-to-climb)
export const FLIP_LIFT = 10; // m/s launch burst when the flip thrusters fire (2nd Space): +2.5 m above the press
export const FLIP_LIFT_CAP = 10.5; // m/s: the burst never sends the car up faster than this
export const FLIP_FORWARD = 7; // m/s forward kick with the flip launch
export const FLIP_LAUNCH = 0.12; // s the car shoots straight up before the rotation starts (reads as a jump, not a spin)
// Space is a thruster launch: a quick press is the ~2.3 m hop, keep holding and it turns into "Iron Man" flight
// (climb to at most 6x the hop height, hover while held, burning flight fuel). In the air: tap = flip, press-and-
// hold = fly again. High enough to clear the toll gantries and land on the skyway deck.
export const THRUST_MAX_H = (6 * JUMP_V * JUMP_V) / (2 * 20); // m above the ground: 6x the hop peak (~13.8 m)
export const THRUST_VMAX = 9; // m/s climb rate
export const THRUST_ACC = 30; // m/s² net push while the jets catch up to the target climb rate
export const TAP_MAX = 0.18; // s: an in-air press released sooner is a flip tap, held longer it is flight
export const LAUNCH_HOLD = 0.12; // s the launch press must stay down before the jets take over (a tap = the hop)
// flight fuel (the FUEL gauge, 0..1): a full tank is FUEL_FLY_S s of jet flight; it refills while on the ground
export const FUEL_FLY_S = 2.5;
export const FUEL_REFILL = 1.5 / 12; // per second on the ground (8 s from empty to full)
export const FLY_SINK = 2.5; // m/s descent once the tank is empty (still holding)
// with the gas held, the flight jets also push forward (gently, up to FLY_SPEED): a car stopped behind a jam can still
// fly over it instead of only bobbing up and down in place (found by a game-qa / Jev run at the toll queue)
export const FLY_SPEED = 22; // m/s
export const ROOF_HOP_V = 8; // m/s: at least this fast forward off any roof the car comes down on
export const ROOF_STEP_UP = 0.5; // m: airborne this close under a standing car's roof, the car hops up onto it
export const FLY_ACCEL = 10; // m/s²
// Down off the event ramp's lip, as in the reveal: the cold-gas jets right the car and brake the fall, so it settles
// onto its wheels instead of dropping 23 m. The allowed sink rate shrinks with height (DROP_TOUCH_V + DROP_K x height),
// so it falls freely at first, then hangs on its jets and touches down at DROP_TOUCH_V.
export const DROP_TOUCH_V = 3; // m/s sink at touchdown
export const DROP_K = 1.1; // 1/s: the allowed sink per metre of height
export const DROP_ACC = 34; // m/s² the jets can brake the fall by
export const DROP_ROLL_S = 0.9; // s to roll upright again (the side jets), instead of a flick
export const DROP_DRAG = 1.2; // 1/s: the jets also take out most of the speed back over the run-in
export const TWIST_ANGLE = (45 * Math.PI) / 180; // rotation axis tilted between pitch (flip) and roll: off-axis twist
export const FLIP_RATE = (360 * Math.PI) / 180; // slowest rotation: one full turn per second, as in the demo
export const FLIP_RATE_MAX = (900 * Math.PI) / 180; // fastest, for late presses
export const FLIP_MARGIN = 0.12; // s of airtime kept after the rotation finishes
export const FLIP_MIN_AIR = 0.45; // s of airtime needed to start a rotation at all
export const FLIP_MAX = 2; // rotations per jump
export const LAND_TOL = (45 * Math.PI) / 180;
export const GRAVITY = 20;

// ---- SP (skill points): regenerates, spent by skills. Raycity-style.
export const SP_MAX = 100;
export const SP_REGEN = 7; // per second
export const SP_DRIFT = 20; // per second while drifting
export const SP_FLIP = 25;
export const SP_STOMP = 15;
export const SP_JUMP = 8;
export const SP_SIDESTEP = 10;
export const SP_BOOST_DRAIN = 32; // per second while boosting
export const SP_BOOST_MIN = 15; // needed to start the booster

// ---- session
export const CLOCK_START = 8 * 3600 + 58 * 60 + 30;
export const RUN_TIME = 90;
export const CRASH_REPLAY = 3;
export const SLOWMO = 0.35;
export const RESPAWN_SPEED = 14;
export const INVULN = 1.5;
export const BUMP_MAX_REL = 10; // m/s relative speed below which a hit is a bump, not a crash
export const COMMUTER_COUNT = 18; // fellow roadster commuters (SPEC §6)
export const WIRE_H = 4.6; // low event cable height above the road
export const EVENT_GAP_MIN = 10;
export const EVENT_GAP_MAX = 15;
export const FINISH_RADIUS = 14;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
/** Lane centre offset to the right of the travel direction (lane 0 = inner). */
export function laneOffset(lane: number): number {
  return MEDIAN_HALF + LANE_W / 2 + lane * LANE_W;
}
