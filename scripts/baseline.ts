// Difficulty baseline. Run: npx vite-node scripts/baseline.ts
import { buildCity } from "../src/game/city";
import { Session } from "../src/game/session";
import { makeBot } from "./bot";

const city = buildCity(1);
const DT = 1 / 60;

const results: string[] = [];
for (let i = 0; i < city.commutes.length; i++) {
    const s = new Session(city, 99, i, i);
    const bot = makeBot(city, s);
    const evs: Record<string, number> = {};
    while (s.state === "run")
        for (const e of s.step(DT, bot())) {
            const k = e.startsWith("crash") ? e : e.split(":")[0];
            evs[k] = (evs[k] ?? 0) + 1;
        }
    const r = s.result!;
    results.push(
        JSON.stringify({
            i,
            dist: s.commute.dist,
            grade: r.grade,
            left: r.timeLeft.toFixed(1),
            crashes: r.crashes,
            t: s.t.toFixed(1),
            end: s.distanceToOffice.toFixed(0),
            evs,
        }),
    );
}
console.log(results.join("\n"));
