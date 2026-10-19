#!/usr/bin/env node
// How many people play the site and for how long: the anonymous play counts (src/telemetry.ts ->
// functions/api/play.ts -> Workers Analytics Engine dataset late_roadster_plays, kept three months).
//   node scripts/stats.mjs [days=7]
// Needs a Cloudflare API token with Account | Account Analytics | Read, and the account ID: CF_API_TOKEN /
// CF_ACCOUNT_ID, else the macOS Keychain items late-roadster.cf-token / late-roadster.cf-account (read into this
// process only, never written anywhere). Days are counted in Asia/Seoul.
import { execFileSync } from "node:child_process";

const days = Math.max(
  1,
  Math.min(90, Math.floor(Number(process.argv[2] ?? 7)) || 7),
);
const secret = (env, item) => {
  if (process.env[env]) return process.env[env];
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", item, "-a", process.env.USER ?? "", "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "";
  }
};
const token = secret("CF_API_TOKEN", "late-roadster.cf-token");
const account = secret("CF_ACCOUNT_ID", "late-roadster.cf-account");
if (!token || !account) {
  console.error(
    "no Cloudflare credentials: set CF_API_TOKEN and CF_ACCOUNT_ID, or store them in the Keychain:\n" +
      '  security add-generic-password -s late-roadster.cf-token -a "$USER" -w\n' +
      '  security add-generic-password -s late-roadster.cf-account -a "$USER" -w',
  );
  process.exit(1);
}

const DS = "late_roadster_plays";
const TZ = "Asia/Seoul";
const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
async function q(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: sql + " FORMAT JSON",
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text).data.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        /^-?[\d.]+$/.test(String(v)) ? Number(v) : v,
      ]),
    ),
  );
}
const min = (s) => (s / 60).toFixed(1);

try {
  const [[t], [p], perPlayer, daily, dailyPlayers, countries, devices] =
    await Promise.all([
      q(`SELECT count(DISTINCT index1) AS visitors,
        sumIf(_sample_interval, blob1 = 'start' AND blob2 = 'run') AS runs,
        sumIf(_sample_interval, blob1 = 'start' AND blob2 = 'free') AS freeRoams,
        sumIf(_sample_interval, blob1 = 'end') AS ended,
        sumIf(_sample_interval, blob1 = 'end' AND double2 = 1) AS onTime,
        sumIf(_sample_interval * double1, blob2 = 'run') AS runSec,
        sumIf(_sample_interval * double1, blob2 = 'free') AS freeSec
      FROM ${DS} WHERE ${since}`),
      q(
        `SELECT count(DISTINCT index1) AS players FROM ${DS} WHERE ${since} AND blob1 = 'start'`,
      ),
      q(
        `SELECT index1 AS id, sum(_sample_interval * double1) AS sec FROM ${DS} WHERE ${since} GROUP BY id`,
      ),
      q(`SELECT formatDateTime(toStartOfInterval(timestamp, INTERVAL '1' DAY, '${TZ}'), '%Y-%m-%d', '${TZ}') AS day,
        count(DISTINCT index1) AS visitors,
        sumIf(_sample_interval, blob1 = 'start' AND blob2 = 'run') AS runs,
        sum(_sample_interval * double1) AS sec
      FROM ${DS} WHERE ${since} GROUP BY day ORDER BY day`),
      q(`SELECT formatDateTime(toStartOfInterval(timestamp, INTERVAL '1' DAY, '${TZ}'), '%Y-%m-%d', '${TZ}') AS day,
        count(DISTINCT index1) AS players
      FROM ${DS} WHERE ${since} AND blob1 = 'start' GROUP BY day ORDER BY day`),
      q(`SELECT blob4 AS country, count(DISTINCT index1) AS players FROM ${DS}
      WHERE ${since} AND blob1 = 'start' GROUP BY country ORDER BY players DESC LIMIT 10`),
      q(`SELECT blob5 AS device, count(DISTINCT index1) AS players FROM ${DS}
      WHERE ${since} AND blob1 = 'start' GROUP BY device ORDER BY players DESC`),
    ]);
  const secs = perPlayer
    .map((r) => r.sec)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  const median = secs.length ? secs[Math.floor(secs.length / 2)] : 0;
  const total = (t?.runSec ?? 0) + (t?.freeSec ?? 0);
  console.log(`Late Roadster, last ${days} day(s) (${TZ})`);
  console.log(`  visitors        ${t?.visitors ?? 0}`);
  console.log(
    `  players         ${p?.players ?? 0}  (started a commute or free roam)`,
  );
  console.log(
    `  commutes        ${t?.runs ?? 0} started, ${t?.ended ?? 0} finished the 90 s, ${t?.onTime ?? 0} on time`,
  );
  console.log(`  free roams      ${t?.freeRoams ?? 0}`);
  console.log(
    `  minutes played  ${min(total)} total (commutes ${min(t?.runSec ?? 0)}, free roam ${min(t?.freeSec ?? 0)})`,
  );
  if (secs.length)
    console.log(
      `  per player      ${min(total / secs.length)} min average, ${min(median)} min median`,
    );
  const players = new Map(dailyPlayers.map((r) => [r.day, r.players]));
  if (daily.length) {
    console.log("\n  day          visitors  players  commutes  minutes");
    for (const r of daily)
      console.log(
        `  ${r.day}  ${String(r.visitors).padStart(8)}  ${String(players.get(r.day) ?? 0).padStart(7)}  ${String(r.runs).padStart(8)}  ${min(r.sec).padStart(7)}`,
      );
  }
  if (countries.length)
    console.log(
      "\n  countries  " +
        countries.map((r) => `${r.country || "?"} ${r.players}`).join(", "),
    );
  if (devices.length)
    console.log(
      "  devices    " +
        devices.map((r) => `${r.device} ${r.players}`).join(", "),
    );
} catch (e) {
  const msg = String(e?.message ?? e);
  if (/unknown table|does not exist|UNKNOWN_TABLE/i.test(msg))
    console.log(
      "no plays recorded yet (the dataset appears with the first event from the site)",
    );
  else {
    console.error(msg);
    process.exit(1);
  }
}
