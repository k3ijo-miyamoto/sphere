import fs from "node:fs";
import path from "node:path";

const STATE_API_PORT = Number(process.env.SPHERE_STATE_API_PORT ?? 5180);
const STATE_API_HOST = process.env.SPHERE_STATE_API_HOST ?? "127.0.0.1";
const DEFAULT_SNAPSHOT_PATH = "web/mcp_snapshot.json";

function parseArgs(argv) {
  const out = {
    top: 1,
    output: "richest_person_report.json",
    snapshot: DEFAULT_SNAPSHOT_PATH,
    verifyLive: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--top" && v) {
      out.top = Number.parseInt(v, 10);
      i += 1;
    } else if (a === "--output" && v) {
      out.output = v;
      i += 1;
    } else if (a === "--snapshot" && v) {
      out.snapshot = v;
      i += 1;
    } else if (a === "--verify-live" && v) {
      out.verifyLive = !["0", "false", "no"].includes(String(v).trim().toLowerCase());
      i += 1;
    }
  }
  if (!Number.isFinite(out.top) || out.top < 1) {
    out.top = 1;
  }
  out.top = Math.min(50, out.top);
  return out;
}

function safeNum(value, digits = 6) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Number(n.toFixed(digits));
}

function loadSnapshot(snapshotPath) {
  const absPath = path.resolve(process.cwd(), snapshotPath);
  const raw = fs.readFileSync(absPath, "utf8");
  return { absPath, snapshot: JSON.parse(raw) };
}

function buildCityMaps(world) {
  const cityById = new Map((world?.cities ?? []).map((c) => [c.id, c]));
  return { cityById };
}

async function callStateTool(name, args, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `http://${STATE_API_HOST}:${STATE_API_PORT}/tool`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: args ?? {} }),
      signal: controller.signal
    });
    if (!res.ok) {
      return null;
    }
    const payload = await res.json();
    if (!payload?.ok) {
      return null;
    }
    return payload.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toCandidate(person, cityById) {
  const currentCity = cityById.get(person.currentCityId) ?? null;
  const homeCity = cityById.get(person.homeCityId) ?? null;
  return {
    personId: person.id,
    name: person.name,
    wealth: safeNum(person?.socioeconomic?.wealth),
    cash: safeNum(person?.socioeconomic?.cash),
    realEstate: safeNum(person?.socioeconomic?.realEstate),
    stocks: safeNum(person?.socioeconomic?.stocks),
    bankDeposit: safeNum(person?.socioeconomic?.bankDeposit),
    debt: safeNum(person?.socioeconomic?.debt),
    age: safeNum(person?.age, 3),
    sex: person?.sex ?? null,
    profession: person?.profession ?? null,
    employed: Boolean(person?.employed),
    currentCityId: person?.currentCityId ?? null,
    currentCityName: currentCity?.name ?? null,
    homeCityId: person?.homeCityId ?? null,
    homeCityName: homeCity?.name ?? null,
    nationId: currentCity?.nationId ?? homeCity?.nationId ?? null
  };
}

async function maybeAttachLiveProfile(candidate) {
  const profile = await callStateTool("sphere_person_profile", { personId: candidate.personId });
  if (!profile?.person || !profile?.assets) {
    return { ...candidate, liveProfile: null };
  }
  return {
    ...candidate,
    liveProfile: {
      frame: profile.frame ?? null,
      wealth: safeNum(profile.assets.wealth, 3),
      wealthRank: profile.assets.wealthRank ?? null,
      wealthPercentile: safeNum(profile.assets.wealthPercentile, 2),
      location: profile.location ?? null,
      job: profile.job ?? null
    }
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { absPath, snapshot } = loadSnapshot(opts.snapshot);
  const people = snapshot.people ?? [];
  const { cityById } = buildCityMaps(snapshot.world ?? {});
  const history = snapshot.history ?? [];
  const frame = history[history.length - 1] ?? null;

  const top = people
    .map((p) => toCandidate(p, cityById))
    .sort((a, b) => b.wealth - a.wealth || a.personId - b.personId)
    .slice(0, opts.top);

  const withLive = [];
  for (const row of top) {
    if (!opts.verifyLive) {
      withLive.push({ ...row, liveProfile: null });
      continue;
    }
    withLive.push(await maybeAttachLiveProfile(row));
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      primary: "snapshot",
      snapshotPath: absPath,
      liveProfileChecked: opts.verifyLive,
      liveProfileEndpoint: `http://${STATE_API_HOST}:${STATE_API_PORT}/tool`
    },
    frame: frame
      ? {
          time: frame.time ?? null,
          phase: frame.phase ?? null,
          worldVersion: frame.worldVersion ?? null
        }
      : null,
    population: people.length,
    top: withLive
  };

  const outPath = path.resolve(process.cwd(), opts.output);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

await main();
