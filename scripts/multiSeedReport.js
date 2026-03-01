import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { createSampleWorld } from "../src/world/model.js";
import { SimulationEngine } from "../src/sim/engine.js";

const args = parseArgs(process.argv.slice(2));
const seeds = args.seeds ?? [1337, 2027, 4242, 7777, 9901];
const days = args.days ?? 180;
const ticksPerDay = Math.floor(DEFAULT_CONFIG.dayMinutes / DEFAULT_CONFIG.tickMinutes);
const totalTicks = days * ticksPerDay;

const reports = [];
for (const seed of seeds) {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.seed = seed;
  const world = createSampleWorld(seed);
  const engine = new SimulationEngine({ world, config });
  const eventCounts = new Map();
  let lastFrame = null;
  const timeline = [];
  const shockPoints = [Math.floor(totalTicks * 0.3), Math.floor(totalTicks * 0.6)];
  const shockRecords = [];

  for (let i = 0; i < totalTicks; i += 1) {
    if (shockPoints.includes(i)) {
      const baseline = computeRecentBaseline(timeline);
      injectSystemShock(world, engine.rng);
      shockRecords.push({ tick: i, baseline, recoveredTick: null });
    }
    const frame = engine.tick();
    lastFrame = frame;
    timeline.push({
      tick: i,
      marketIndex: frame.system?.marketIndex ?? 1,
      unemployment: frame.people?.economy?.unemploymentRate ?? 0,
      avgInstability: average(world.cities.map((c) => c.metrics.instabilityRisk ?? 0)),
      cooperation: frame.people?.institutions?.cooperationIndex ?? 0
    });
    for (const e of frame.people.events ?? []) {
      eventCounts.set(e.type, (eventCounts.get(e.type) ?? 0) + 1);
    }
  }

  const cityInst = world.cities.map((c) => c.metrics.instabilityRisk ?? 0);
  const avgInstability = cityInst.reduce((s, v) => s + v, 0) / Math.max(1, cityInst.length);
  const collapsedCities = world.cities.filter((c) => c.lifecycle?.status === "collapsed").length;
  const risingCities = world.cities.filter((c) => c.lifecycle?.status === "rising").length;
  const estimatedPopulation = Object.values(lastFrame?.people?.statisticalPopulation ?? {}).reduce(
    (sum, row) => sum + (row.estimatedTotal ?? 0),
    0
  );
  const marketIndex = lastFrame?.system?.marketIndex ?? 1;
  const epidemic = lastFrame?.system?.epidemicLevel ?? 0;
  const climate = lastFrame?.system?.climateStress ?? 0;
  const unemployment = lastFrame?.people?.economy?.unemploymentRate ?? 0;
  const cooperationSeries = timeline.map((row) => row.cooperation);
  const avgCooperation = average(cooperationSeries);
  const cooperationStd = stddev(cooperationSeries);
  const shockRecoveryTicks = evaluateShockRecovery(timeline, shockRecords, totalTicks);
  const institutionMutations = lastFrame?.people?.institutions?.mutationCount ?? 0;
  const policyRevisions = lastFrame?.people?.institutions?.policyRevisionCount ?? 0;

  reports.push({
    seed,
    days,
    estimatedPopulation,
    avgInstability: round(avgInstability),
    collapsedCities,
    risingCities,
    marketIndex: round(marketIndex),
    epidemic: round(epidemic),
    climate: round(climate),
    unemployment: round(unemployment),
    avgCooperation: round(avgCooperation),
    cooperationStd: round(cooperationStd),
    collapseRate: round(collapsedCities / Math.max(1, world.cities.length)),
    institutionMutations,
    policyRevisions,
    shockRecoveryTicks,
    avgShockRecovery: shockRecoveryTicks.length > 0 ? round(average(shockRecoveryTicks)) : null,
    phaseTransitions: (eventCounts.get("phase_macro") ?? 0) + (eventCounts.get("phase_social") ?? 0),
    eventCounts: Object.fromEntries([...eventCounts.entries()].sort((a, b) => b[1] - a[1]))
  });
}

const summary = {
  seeds,
  days,
  totalTicks,
  aggregate: {
    estimatedPopulation: meanStd(reports.map((r) => r.estimatedPopulation)),
    avgInstability: meanStd(reports.map((r) => r.avgInstability)),
    marketIndex: meanStd(reports.map((r) => r.marketIndex)),
    epidemic: meanStd(reports.map((r) => r.epidemic)),
    climate: meanStd(reports.map((r) => r.climate)),
    unemployment: meanStd(reports.map((r) => r.unemployment)),
    avgCooperation: meanStd(reports.map((r) => r.avgCooperation)),
    cooperationStd: meanStd(reports.map((r) => r.cooperationStd)),
    collapseRate: meanStd(reports.map((r) => r.collapseRate)),
    institutionMutations: meanStd(reports.map((r) => r.institutionMutations)),
    policyRevisions: meanStd(reports.map((r) => r.policyRevisions)),
    avgShockRecovery: meanStd(reports.map((r) => r.avgShockRecovery ?? totalTicks)),
    phaseTransitions: meanStd(reports.map((r) => r.phaseTransitions))
  },
  reports
};

const outPath = path.resolve(process.cwd(), args.out ?? "multi_seed_report.json");
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log(`Multi-seed report saved: ${outPath}`);
console.log(formatAggregate(summary.aggregate));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--days" && argv[i + 1]) {
      out.days = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--seeds" && argv[i + 1]) {
      out.seeds = argv[i + 1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      i += 1;
    } else if (token === "--out" && argv[i + 1]) {
      out.out = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function meanStd(values) {
  const usable = values.filter((v) => Number.isFinite(v));
  if (!usable.length) {
    return { mean: 0, std: 0 };
  }
  const mean = usable.reduce((s, v) => s + v, 0) / usable.length;
  const variance = usable.reduce((s, v) => s + (v - mean) ** 2, 0) / usable.length;
  return { mean: round(mean), std: round(Math.sqrt(variance)) };
}

function average(values) {
  const usable = values.filter((v) => Number.isFinite(v));
  if (!usable.length) {
    return 0;
  }
  return usable.reduce((sum, v) => sum + v, 0) / usable.length;
}

function stddev(values) {
  const usable = values.filter((v) => Number.isFinite(v));
  if (!usable.length) {
    return 0;
  }
  const m = average(usable);
  const v = usable.reduce((sum, x) => sum + (x - m) ** 2, 0) / usable.length;
  return Math.sqrt(v);
}

function computeRecentBaseline(timeline, span = 48) {
  const recent = timeline.slice(-span);
  if (!recent.length) {
    return { marketIndex: 1, unemployment: 10, avgInstability: 0.5, cooperation: 0.4 };
  }
  return {
    marketIndex: average(recent.map((r) => r.marketIndex)),
    unemployment: average(recent.map((r) => r.unemployment)),
    avgInstability: average(recent.map((r) => r.avgInstability)),
    cooperation: average(recent.map((r) => r.cooperation))
  };
}

function injectSystemShock(world, rng) {
  world.systemState.marketIndex = Math.max(0.55, (world.systemState.marketIndex ?? 1) * (0.72 + rng.range(-0.04, 0.03)));
  world.systemState.epidemicLevel = Math.min(0.95, (world.systemState.epidemicLevel ?? 0.1) + rng.range(0.05, 0.12));
  world.systemState.climateStress = Math.min(0.95, (world.systemState.climateStress ?? 0.15) + rng.range(0.04, 0.1));
  const affected = world.cities.slice().sort(() => rng.next() - 0.5).slice(0, Math.max(3, Math.floor(world.cities.length * 0.2)));
  for (const city of affected) {
    city.metrics.instabilityRisk = Math.min(0.99, city.metrics.instabilityRisk + rng.range(0.05, 0.16));
    city.metrics.safety = Math.max(0.02, city.metrics.safety - rng.range(0.03, 0.08));
    city.metrics.productivity = Math.max(0.2, city.metrics.productivity - rng.range(0.03, 0.1));
  }
}

function evaluateShockRecovery(timeline, shocks, totalTicks) {
  const recoveries = [];
  for (const shock of shocks) {
    const targetMarket = shock.baseline.marketIndex * 0.95;
    const targetUnemployment = shock.baseline.unemployment * 1.08 + 0.6;
    const targetInstability = shock.baseline.avgInstability * 1.08 + 0.03;
    const targetCooperation = shock.baseline.cooperation * 0.9;
    let recoveredTick = null;
    for (const row of timeline) {
      if (row.tick <= shock.tick) {
        continue;
      }
      const ok =
        row.marketIndex >= targetMarket &&
        row.unemployment <= targetUnemployment &&
        row.avgInstability <= targetInstability &&
        row.cooperation >= targetCooperation;
      if (ok) {
        recoveredTick = row.tick;
        break;
      }
    }
    const recoveryTicks = recoveredTick == null ? totalTicks - shock.tick : recoveredTick - shock.tick;
    recoveries.push(recoveryTicks);
  }
  return recoveries;
}

function round(v) {
  return Number(v.toFixed(3));
}

function formatAggregate(agg) {
  return [
    `Population mean±std: ${agg.estimatedPopulation.mean} ± ${agg.estimatedPopulation.std}`,
    `Instability mean±std: ${agg.avgInstability.mean} ± ${agg.avgInstability.std}`,
    `Market mean±std: ${agg.marketIndex.mean} ± ${agg.marketIndex.std}`,
    `Epidemic mean±std: ${agg.epidemic.mean} ± ${agg.epidemic.std}`,
    `Climate mean±std: ${agg.climate.mean} ± ${agg.climate.std}`,
    `Unemployment mean±std: ${agg.unemployment.mean} ± ${agg.unemployment.std}`,
    `Cooperation mean±std: ${agg.avgCooperation.mean} ± ${agg.avgCooperation.std}`,
    `CooperationVol mean±std: ${agg.cooperationStd.mean} ± ${agg.cooperationStd.std}`,
    `CollapseRate mean±std: ${agg.collapseRate.mean} ± ${agg.collapseRate.std}`,
    `InstitutionMutations mean±std: ${agg.institutionMutations.mean} ± ${agg.institutionMutations.std}`,
    `PolicyRevisions mean±std: ${agg.policyRevisions.mean} ± ${agg.policyRevisions.std}`,
    `ShockRecoveryTicks mean±std: ${agg.avgShockRecovery.mean} ± ${agg.avgShockRecovery.std}`,
    `PhaseTransitions mean±std: ${agg.phaseTransitions.mean} ± ${agg.phaseTransitions.std}`
  ].join("\n");
}
