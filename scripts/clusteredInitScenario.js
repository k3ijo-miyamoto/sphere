import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { createSampleWorld } from "../src/world/model.js";
import { SimulationEngine } from "../src/sim/engine.js";

const args = parseArgs(process.argv.slice(2));
const days = args.days ?? 120;
const seed = args.seed ?? DEFAULT_CONFIG.seed;
const cityId = args.city ?? "C1";
const noNations = args.noNations === true;
const noCities = args.noCities === true;
const outPath = path.resolve(process.cwd(), args.out ?? "clustered_init_report.json");
const slackWebhookUrl = args.slackWebhook ?? process.env.SLACK_WEBHOOK_URL ?? null;
const notifyEveryTicks = Math.max(1, args.notifyEveryTicks ?? 240);

const slack = createSlackNotifier({
  webhookUrl: slackWebhookUrl,
  notifyEveryTicks
});

await slack.post(
  `clustered-init start\nseed=${seed} days=${days} clusterCity=${cityId} noNations=${noNations} noCities=${noCities} notifyEveryTicks=${notifyEveryTicks}`
);

const baseline = await runScenario({ mode: "baseline", days, seed, cityId, noNations, noCities, slack });
const clustered = await runScenario({ mode: "clustered", days, seed, cityId, noNations, noCities, slack });

const report = {
  args: { days, seed, cityId, noNations, noCities },
  baseline,
  clustered,
  delta: buildDelta(baseline.summary, clustered.summary)
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(`Clustered-init scenario report saved: ${outPath}`);
console.log(formatSummary(report));
await slack.post(
  [
    "clustered-init done",
    `seed=${seed} days=${days} city=${cityId} noNations=${noNations} noCities=${noCities}`,
    `delta_gini=${report.delta.inequality.gini}`,
    `delta_unemployment=${report.delta.economy.unemploymentRate}`,
    `delta_spawnedCities=${report.delta.cities.spawned}`,
    `out=${outPath}`
  ].join("\n")
);

async function runScenario({ mode, days, seed, cityId, noNations, noCities, slack }) {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.seed = seed;
  const world = createSampleWorld(seed);
  if (noCities) {
    applyNoCityInitialization(world);
  } else if (noNations) {
    applyNoNationInitialization(world);
  }
  const initialNationCount = world.nations?.length ?? 0;
  const initialCityCount = world.cities?.length ?? 0;
  const engine = new SimulationEngine({ world, config });

  if (mode === "clustered" && !noCities) {
    applyClusteredInitialization(engine, cityId);
  }

  const ticksPerDay = Math.floor(config.dayMinutes / config.tickMinutes);
  const totalTicks = days * ticksPerDay;
  let lastFrame = null;
  const daily = [];

  for (let i = 0; i < totalTicks; i += 1) {
    const frame = engine.tick();
    lastFrame = frame;
    if (slack.enabled && (i === 0 || (i + 1) % slack.notifyEveryTicks === 0 || i + 1 === totalTicks)) {
      const pct = ((i + 1) / totalTicks) * 100;
      await slack.post(
        `clustered-init progress\nmode=${mode}\nframe=${frame.time} ${frame.phase}\nprogress=${(pct).toFixed(1)}% (${i + 1}/${totalTicks})`
      );
    }
    if (frame.time.endsWith("00:00")) {
      daily.push({
        day: frame.time.split(" ")[1],
        marketIndex: round(frame.system?.marketIndex ?? 1),
        unemploymentRate: round(frame.people?.economy?.unemploymentRate ?? 0),
        avgIncome: round(frame.people?.economy?.avgIncome ?? 0),
        avgWealth: round(frame.people?.economy?.avgWealth ?? 0),
        cities: world.cities.length
      });
    }
  }

  const summary = buildSummary({ world, engine, frame: lastFrame, mode, days, seed, cityId, initialNationCount, initialCityCount, noCities });
  return { mode, summary, daily };
}

function applyClusteredInitialization(engine, cityId) {
  const city = engine.world.getCityById(cityId);
  if (!city) {
    throw new Error(`cluster city not found: ${cityId}`);
  }
  for (const person of engine.population.people) {
    person.homeCityId = cityId;
    person.workCityId = cityId;
    person.currentCityId = cityId;
    person.currentState = "Home";
  }
}

function buildSummary({ world, engine, frame, mode, days, seed, cityId, initialNationCount, initialCityCount, noCities }) {
  const people = engine.population.people;
  const cities = world.cities;
  const relations = frame?.geopolitics?.relations ?? [];

  const wealthRows = people.map((p) => Number(p.socioeconomic?.wealth ?? 0)).filter(Number.isFinite);
  const layerStats = aggregateLayerStats(cities);

  return {
    mode,
    days,
    seed,
    clusterCityId: cityId,
    noCities: noCities === true,
    noNations,
    frame: {
      time: frame?.time ?? "-",
      phase: frame?.phase ?? "-"
    },
    population: people.length,
    cities: {
      initial: initialCityCount ?? 0,
      total: cities.length,
      spawned: cities.filter((c) => /-N\d+$/.test(c.name)).length
    },
    nations: {
      initial: initialNationCount ?? 0,
      total: world.nations?.length ?? 0
    },
    economy: {
      avgIncome: round(frame?.people?.economy?.avgIncome ?? 0),
      unemploymentRate: round(frame?.people?.economy?.unemploymentRate ?? 0),
      avgWealth: round(frame?.people?.economy?.avgWealth ?? 0),
      totalCompanies: frame?.people?.companies?.totalCompanies ?? 0
    },
    inequality: {
      gini: round(gini(wealthRows)),
      top10SharePct: round(topShare(wealthRows, 0.1) * 100),
      top20SharePct: round(topShare(wealthRows, 0.2) * 100)
    },
    geopolitics: {
      avgTension: round(average(relations.map((r) => r.tension ?? 0))),
      statuses: countBy(relations.map((r) => r.status ?? "unknown"))
    },
    layers: layerStats
  };
}

function aggregateLayerStats(cities) {
  const by = new Map();
  for (const city of cities) {
    const row = by.get(city.layerId) ?? {
      layerId: city.layerId,
      cities: 0,
      spawnedCities: 0,
      population: 0,
      productivitySum: 0,
      congestionSum: 0,
      safetySum: 0
    };
    row.cities += 1;
    row.population += Number(city.population ?? 0);
    row.productivitySum += Number(city.metrics?.productivity ?? 0);
    row.congestionSum += Number(city.metrics?.congestion ?? 0);
    row.safetySum += Number(city.metrics?.safety ?? 0);
    if (/-N\d+$/.test(city.name)) {
      row.spawnedCities += 1;
    }
    by.set(city.layerId, row);
  }
  return Array.from(by.values())
    .map((row) => ({
      layerId: row.layerId,
      cities: row.cities,
      spawnedCities: row.spawnedCities,
      population: row.population,
      avgProductivity: round(row.productivitySum / Math.max(1, row.cities)),
      avgCongestion: round(row.congestionSum / Math.max(1, row.cities)),
      avgSafety: round(row.safetySum / Math.max(1, row.cities))
    }))
    .sort((a, b) => String(a.layerId).localeCompare(String(b.layerId)));
}

function buildDelta(base, next) {
  return {
    economy: {
      avgIncome: round(next.economy.avgIncome - base.economy.avgIncome),
      unemploymentRate: round(next.economy.unemploymentRate - base.economy.unemploymentRate),
      avgWealth: round(next.economy.avgWealth - base.economy.avgWealth)
    },
    inequality: {
      gini: round(next.inequality.gini - base.inequality.gini),
      top10SharePct: round(next.inequality.top10SharePct - base.inequality.top10SharePct),
      top20SharePct: round(next.inequality.top20SharePct - base.inequality.top20SharePct)
    },
    cities: {
      total: next.cities.total - base.cities.total,
      spawned: next.cities.spawned - base.cities.spawned
    },
    nations: {
      total: (next.nations?.total ?? 0) - (base.nations?.total ?? 0)
    },
    geopolitics: {
      avgTension: round(next.geopolitics.avgTension - base.geopolitics.avgTension)
    },
    layers: mergeLayerDelta(base.layers, next.layers)
  };
}

function mergeLayerDelta(baseLayers, nextLayers) {
  const baseMap = new Map(baseLayers.map((x) => [x.layerId, x]));
  const nextMap = new Map(nextLayers.map((x) => [x.layerId, x]));
  const ids = new Set([...baseMap.keys(), ...nextMap.keys()]);
  const out = [];
  for (const id of ids) {
    const b = baseMap.get(id) ?? {
      cities: 0,
      spawnedCities: 0,
      population: 0,
      avgProductivity: 0,
      avgCongestion: 0,
      avgSafety: 0
    };
    const n = nextMap.get(id) ?? {
      cities: 0,
      spawnedCities: 0,
      population: 0,
      avgProductivity: 0,
      avgCongestion: 0,
      avgSafety: 0
    };
    out.push({
      layerId: id,
      cities: n.cities - b.cities,
      spawnedCities: n.spawnedCities - b.spawnedCities,
      population: n.population - b.population,
      avgProductivity: round(n.avgProductivity - b.avgProductivity),
      avgCongestion: round(n.avgCongestion - b.avgCongestion),
      avgSafety: round(n.avgSafety - b.avgSafety)
    });
  }
  return out.sort((a, b) => String(a.layerId).localeCompare(String(b.layerId)));
}

function gini(values) {
  const rows = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = rows.length;
  if (n <= 1) {
    return 0;
  }
  const sum = rows.reduce((s, v) => s + v, 0);
  if (sum <= 0) {
    return 0;
  }
  let weighted = 0;
  for (let i = 0; i < n; i += 1) {
    weighted += (i + 1) * rows[i];
  }
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

function topShare(values, ratio) {
  const rows = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => b - a);
  const total = rows.reduce((s, v) => s + v, 0);
  if (rows.length === 0 || total <= 0) {
    return 0;
  }
  const k = Math.max(1, Math.floor(rows.length * ratio));
  const top = rows.slice(0, k).reduce((s, v) => s + v, 0);
  return top / total;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--days" && argv[i + 1]) {
      out.days = Number(argv[i + 1]);
      i += 1;
    } else if (t === "--seed" && argv[i + 1]) {
      out.seed = Number(argv[i + 1]);
      i += 1;
    } else if (t === "--city" && argv[i + 1]) {
      out.city = String(argv[i + 1]);
      i += 1;
    } else if (t === "--out" && argv[i + 1]) {
      out.out = String(argv[i + 1]);
      i += 1;
    } else if (t === "--slack-webhook" && argv[i + 1]) {
      out.slackWebhook = String(argv[i + 1]);
      i += 1;
    } else if (t === "--notify-every-ticks" && argv[i + 1]) {
      out.notifyEveryTicks = Number(argv[i + 1]);
      i += 1;
    } else if (t === "--no-nations") {
      out.noNations = true;
    } else if (t === "--no-cities") {
      out.noCities = true;
    }
  }
  return out;
}

function applyNoNationInitialization(world) {
  world.nations = [];
  world.nationIndex = new Map();
  for (const city of world.cities ?? []) {
    city.nationId = null;
  }
}

function applyNoCityInitialization(world) {
  world.cities = [];
  world.cityIndex = new Map();
  world.edges = [];
  world.nations = [];
  world.nationIndex = new Map();
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function countBy(rows) {
  const out = {};
  for (const v of rows) {
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

function average(values) {
  const rows = values.filter((v) => Number.isFinite(v));
  if (!rows.length) {
    return 0;
  }
  return rows.reduce((s, v) => s + v, 0) / rows.length;
}

function round(v) {
  return Number((Number.isFinite(v) ? v : 0).toFixed(3));
}

function createSlackNotifier({ webhookUrl = null, notifyEveryTicks = 240 }) {
  return {
    enabled: !!webhookUrl,
    notifyEveryTicks: Math.max(1, notifyEveryTicks),
    async post(text) {
      if (!webhookUrl) {
        return;
      }
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text })
        });
        if (!res.ok) {
          console.error(`slack webhook failed (${res.status})`);
        }
      } catch (error) {
        console.error(`slack webhook error: ${error?.message ?? String(error)}`);
      }
    }
  };
}

function formatSummary(report) {
  const b = report.baseline.summary;
  const c = report.clustered.summary;
  const d = report.delta;
  return [
    `Baseline: nations=${b.nations?.initial ?? 0}->${b.nations?.total ?? 0} cities=${b.cities?.initial ?? 0}->${b.cities.total} spawned=${b.cities.spawned} gini=${b.inequality.gini} unemp=${b.economy.unemploymentRate}%`,
    `Clustered: nations=${c.nations?.initial ?? 0}->${c.nations?.total ?? 0} cities=${c.cities?.initial ?? 0}->${c.cities.total} spawned=${c.cities.spawned} gini=${c.inequality.gini} unemp=${c.economy.unemploymentRate}%`,
    `Delta: nations=${d.nations?.total ?? 0} cities=${d.cities.total} spawned=${d.cities.spawned} gini=${d.inequality.gini} unemp=${d.economy.unemploymentRate}%`
  ].join("\n");
}
