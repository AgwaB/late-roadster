# Late Roadster

90 seconds. 8:58:30 → 9:00:00. Flip over traffic, drive on tunnel ceilings, don't be late. Every stunt earns VIEWS; twelve clips wait to be filmed on the way.

Play: <https://late-roadster.pages.dev> · Spec: [SPEC.md](SPEC.md) · Code: MIT ([LICENSE](LICENSE)); assets keep their own licenses (see Credits).

The working notes (`research/`: prompts, reference images, reviews) are not part of the public repository; paths into it in `tools/` and the docs point at the author's checkout.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # game logic (city, physics, session)
npm run build    # static site in dist/
```

## Controls

| | Keyboard | Touch |
| --- | --- | --- |
| Gas (hold) | W / ↑ | GAS |
| Brake / reverse | S / ↓ | BRAKE |
| Steer | A / D, Left / Right | left / right buttons |
| Drift | Ctrl (or Alt/Option) + steering | DRIFT + left / right |
| Thruster hop (~2.3 m) | Space | JUMP |
| Fly on the jets (keep holding the launch, or press-and-hold in the air; up to 6x the hop, ~13.8 m: over the toll plaza canopy and onto the skyway deck; the camera rises and looks down while you are high up; burns FUEL, 2.5 s on a full tank, refills on the road, then sinks) | hold Space | hold JUMP |
| Twist flip (thruster launch up + off-axis roll+flip; A/D picks the side) | tap Space again in the air | tap JUMP again |
| Back to the lobby | ESC / Q | LOBBY (under the clock) |
| Booster (hold, with gas; drains SP) | Shift | BOOST |
| Sidestep | double-tap A/D or Left/Right | double-tap left / right |
| Ceiling on / off (tunnels, tap) | E | STICK |

Raycity layout. Boosting, jumps and sidesteps spend SP; flight burns FUEL instead. Ground drifting, successful flip landings, stomps and yielding to ambulances refill SP; it also regenerates while not boosting.

## Lobby, VIEWS and clips

- The lobby (`src/ui/lobby.ts`) comes up while loading and on ESC: what the game is, the keys, what is on the way, the clips to film, START, and the author's GitHub / X links. The run starts on START (Enter / Space).
- VIEWS (`src/game/score.ts`): flips, landing on roofs, flying the toll plaza, riding the event ramp, flipping over the kickflip row, ceiling and skyway, hopping sinkholes, jumping the cycling club (the PELOTON event: five riders abreast in your lane; drive through them instead and they go flying, no wipe-out), bouncing off a sky-lane roadster, even a wipeout (a small 5K, never multiplied). Stunts chained without 2.5 s of plain driving multiply (x0.25 each, up to x3). On time doubles the run's VIEWS, late halves them.
- Twelve clips are filmed the first time their stunt happens (kept in localStorage, merged across open tabs); filming the eleven stunt clips opens FREE ROAM (no clock, ESC / Q to leave; the WIPEOUT clip is not needed). Clips tied to a place have a colour: a dot on the minimap (off-map ones pinned to the rim) and a light beam with a pulsing ring in the city, both gone once filmed. SINKHOLE HOP is the exception: every sinkhole in view gets a small purple dot and there is no beam.
- Only three things are accidents: falling into the river, a sinkhole, and flying into a sky-lane roadster. Everything else (buildings, walls, signs, the toll plaza, barriers, botched landings, scooters, cyclists, traffic) is a bounce or a speed loss.
- Small gags: park on the toll canopy roof and a NOTICE lands under the wiper (it blows off at the next take-off: TICKET PENDING); ORBIT MART has a painted CART RETURN bay on its forecourt that fills the FUEL tank once a commute; the sky lane hops the toll plaza out of jet reach. The result card pins a PHOTO FINISH of the arrival (CLOCKED IN 8:59:41, or LATE), and offers SAVE CLIP (the last wipeout, else the finish) and SAVE <best stunt> (the ramp, an extra flip, the kickflip...). Filmed clips show your own shot of the moment in the lobby.
- A crash is not news: a WIPEOUT band names the cause (TOOK A SWIM / SWALLOWED BY A SINKHOLE / MID-AIR COLLISION), with the -3s it costs, a 3-2-1 back-on-the-road count, SPACE (JUMP on touch) to skip the replay (the clock still loses the full 3 s), and a one-time tip per cause. The car blinks while it is invulnerable after respawning.
- BREAKING NEWS is about the city's other roadsters: now and then (a nearby commuter wipeout or flip pile-up, or a story every 35-60 s) a small card slides in top right with a picture from the clip set (the pile-up on a sedan's roof, a roadster on its roof, a sinkhole) and one headline (`src/main.ts` NEWS, `Hud.news`).

## Visual memes

All fictional and unbranded (`src/render/memes.ts`, data in `src/game/city.ts`). Every commute starts facing down its first road and runs the same corridor along y = 0 (home column -> y = 0 -> river tunnel -> under the skyway -> office column), so the set pieces line that corridor in this order:

- Toll plaza: every lane jammed with drivers queueing at the booths; go over the top (jet flight over the canopy, FLYERS $0 painted on its roof, which you can also land on), or hop across the queue roofs. Fellow roadster commuters fly over it. A sky lane of roadsters flies 10.6-13.8 m over the corridor, keeping right like the road (THIS SIDE UP on the underside): flying into one is a crash, landing on one a bounce.
- Sinkholes in the lanes the commutes drive: commuters jet over them; drive into one and the car drops in nose-first (an accident, respawn past the hole). Hop or steer around.
- Launch-event venue beside the eastbound lanes, laid out after the reveal night: a dark floor with crossing white lines, red-lit grandstands and floodlights, "The Kickflip" (five vehicles parked side by side along a straight run-in, each broadside to it with its nose to the road, on a red-lit plinth: a gold coupe, a steel-grey SUV, the white cab-over truck in the middle, a silver and a dark sedan; the run-in lined with black crowd barriers and red/white light bars, light rigs and smoke cannons at the row ends, a power line behind) and "The Ramp" (as the footage shows it side on: a full "C": a broad foot filled to the floor, a vertical, then the top curls over to level and runs on as a long upper arm over the run-in (the car rides its underside upside down and drops off the end); a truss tower as wide as the wall right behind it and a boom along the whole upper arm; red strips and floodlights along the grandstands). Drive at the ramp foot fast enough and the car rides the wall, leaves the lip upside down, rolls upright and lands in front of it (a counted flip); too slow and it rolls back down. Coming down, as in the reveal, the side jets roll it upright and the bottom jets catch it, holding it up on long white plumes so it settles onto its wheels in a cloud (about 2.5 s, touching down at ~3 m/s instead of a 23 m drop). Over the lip the world slows for a moment and a set shot from beside the ramp films the drop (Space again for one more flip on the way down: the screen reads ONE MORE FLIP); on touchdown the stands jump and roar (synthesised applause), every light beam swings over the car, confetti and smoke go off, the LED screen reads NAILED IT, and the rocket on the pad beside the run-in lifts off: the camera cuts to a low shot beside the pad for about four seconds (Space / JUMP cuts back early; the car coasts meanwhile), every beam following the rocket up while the world all but stops, then cuts back (a fresh one stands there again 45 s later). Two demo roadsters loop both stunts when you are not on their line.
- River tunnel (ceiling lane: passing a ceiling car up there is an UPSIDE-DOWN OVERTAKE, +8K), then the skyway overhead (an on-ramp in the inner lane at each end, one lane each way, S-curved up to the 11 m deck; lane 1 traffic runs beside it; hop a parapet to drop back to the road; the middle of the deck is jammed solid, weave through or stomp roof to roof), ORBIT MART (pylon, store, jet-assist shopping carts) on the right; a roadster with a suited mannequin drifts in the sky and two boosters land beyond the east skyline straight ahead.
- Roadsters parked on roof edges (ROOF PARKING) and on top of parked cars.
- The finish is the CLOCK IN bay at the ONTIME HOLDINGS entrance, on the right just before the office crossing.

## Layout

```text
src/game/     city (grid + river), free-driving physics, road-graph traffic, session. No renderer deps; vitest tests.
src/render/   Three.js scene (bloom, shadows), city meshes, generated silver roadster, poly.pizza traffic, thruster FX, chase camera.
public/assets/ Generated project models/images; poly.pizza CC0/CC BY 4.0 models, Poly Haven CC0 facade kit/HDRI, ambientCG CC0 textures, Kenney CC0 cones (see folder LICENSE files).
src/ui/       lobby, HUD (VIEWS, card toast, crash headline/tips), result card, touch buttons.
tools/blender/ building.py (sign-banded commercial), euro_building.py, photo_building.py (photo-facade slabs); export public/assets/gen/*.glb
tools/optimize_assets.sh + optimize_glb.mjs  shrink shipped assets (meshopt GLBs with float UVs, WebP textures)
tools/photo_textures.py  generated images (research/raycity/generated/<date>) -> public/assets/photo (resize, seam blend, sky keying)
tools/r5_cutouts.py + r5_share.py  round 5: cyclist / truck / mannequin / barrier cut-outs and toll / grandstand textures; then the favicon (potrace), share card, clip thumbnails and lobby tiles
scripts/      baseline.ts — bot runs for difficulty tuning (npx vite-node scripts/baseline.ts); publish.sh — export the committed game without research/ to the public repo (Cloudflare Pages builds it)
```

Dev console: `lr.start()`, `lr.lobby()`, `lr.unlockAll(true|false)`, `lr.teleport(x, y, heading)`, `lr.commute(i)`, `lr.clearTraffic()`, `lr.session`, `lr.city`, `lr.pinCam([x, y, h], [x, y, h])` / `lr.pinCam(null)`.

## Play counts

The published site counts plays anonymously, to see how many people play and for how long: a random ID kept in
localStorage (no cookies, nothing personal), page visits, when a commute or free roam starts and when a commute ends
(grade, on time), the seconds actually played, and the country Cloudflare reports. They are kept for three months in
Cloudflare Workers Analytics Engine ([functions/api/play.ts](functions/api/play.ts), sent by
[src/telemetry.ts](src/telemetry.ts)); nothing is sent from the dev server or local builds. `node scripts/stats.mjs`
prints players, commutes and minutes played.

## Credits (third-party assets)

See the in-game CREDITS button and the folder notices below. The player and fellow commuters use the silver `roadster_r3`, made in Blender from generated reference images for Late Roadster (CC0). Traffic, props and buildings from poly.pizza use CC0 (Quaternius, Kenney, Kay Lousberg) or CC BY 4.0 (Poly by Google, Zsky, Ev Amitay, Nick Ladd). Poly Haven supplies the CC0 modular facade kit assembled into `euro_*` buildings, and the `kloofendal_48d_partly_cloudy_puresky` sky. Kenney Car Kit supplies CC0 cones; ambientCG supplies CC0 textures. Trees are Blender-rendered billboards (`tools/blender/tree_billboard.py`). Photo textures are generated project images with fictional brands, not photographs of real locations.

- [poly.pizza model attributions](public/assets/pp/LICENSE.txt): per-model source, author, license URL and changes.
- [Poly Haven inventory](public/assets/ph/LICENSE.txt), [generated Blender work](public/assets/gen/LICENSE.txt), [generated image families and pipelines](public/assets/photo/LICENSE.txt).
- [Surface textures and sky](public/assets/tex/LICENSE.txt), [Kenney Car Kit](public/assets/cars/LICENSE-kenney-car-kit.txt).

Runtime model metadata and generated credit lines live in `src/render/manifest.ts`. Image prompts are in `research/raycity/IMAGE_PROMPTS.md` and its round-2/3/4/5 companions.

## Blender pipeline

```sh
blender -b -P tools/blender/building.py -- --out public/assets/gen/bldg_1.glb --seed 8 --w 10 --d 10 --floors 3 [--preview /tmp/b.png]
```

Photo-facade slabs (the Raycity look: a box with a photographic elevation on the street side):

```sh
python3 tools/photo_textures.py research/raycity/generated/2026-10-17          # images -> public/assets/photo
blender -b -P tools/blender/photo_building.py -- --out public/assets/gen/photo_a1.glb --kind A --img A_01 --roof F_01 --clad Tiles143
blender -b -P tools/blender/photo_building.py -- --out public/assets/gen/photo_t1.glb --kind T --strip C_01 --module B_01 --stacks 2 --roof F_01 --clad Tiles143
```

Material names bind the textures at load (`photo:A_01`, `roof:F_01`, `wall:Tiles143`); nothing is embedded in the GLB. The D skyline panels, E adverts and G noise walls are placed in `src/render/cityMesh.ts` (city rim section).

Signboard text is not geometry: panels are UV-mapped to an 8x8 atlas that the game draws at load (`signAtlasTexture` in `src/render/procTex.ts`). Detailed building models are loaded at startup, then distance-culled at 290 m (170 m for the heavier `euro_*` models); a cheap inset box stands in beyond those radii. This is rendering-distance culling, not network streaming. The same goes for the rest of the city: traffic beyond 330 m, roadsters (sky lane, parked, demo) beyond 480 m, parked cars beyond 320 m, street furniture beyond 200-260 m and rooftop billboard frames beyond 480 m are not drawn, and empty instanced batches are hidden. Every shader is compiled in one offscreen warm draw when a commute is built (behind the lobby or the result card), so nothing compiles mid-drive. There is no screen-space AO: it cost about half of the GPU frame.
