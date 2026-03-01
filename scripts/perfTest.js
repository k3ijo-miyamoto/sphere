import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { createSampleWorld } from "../src/world/model.js";
import { SimulationEngine } from "../src/sim/engine.js";

function runPerfCase(label, trackedIndividuals, ticks = 120) {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  config.population.trackedIndividuals = trackedIndividuals;
  config.population.activeDetailCount = Math.min(120, Math.max(60, Math.floor(trackedIndividuals * 0.03)));
  const world = createSampleWorld(config.seed);
  const engine = new SimulationEngine({ world, config });

  const t0 = performance.now();
  let frame = null;
  for (let i = 0; i < ticks; i += 1) {
    frame = engine.tick();
  }
  const t1 = performance.now();
  const ms = t1 - t0;
  const perTick = ms / ticks;
  const tps = 1000 / Math.max(0.0001, perTick);

  const cityCount = world.cities.length;
  const edgeCount = world.edges.length;
  const people = frame?.people?.stateCounts
    ? Object.values(frame.people.stateCounts).reduce((sum, n) => sum + n, 0)
    : trackedIndividuals;

  return {
    label,
    trackedIndividuals,
    ticks,
    people,
    cityCount,
    edgeCount,
    ms: Number(ms.toFixed(2)),
    perTick: Number(perTick.toFixed(3)),
    tps: Number(tps.toFixed(1))
  };
}

const cases = [
  runPerfCase("2k", 2000),
  runPerfCase("3k", 3000),
  runPerfCase("5k", 5000)
];

for (const c of cases) {
  console.log(
    `[perf] ${c.label} tracked=${c.trackedIndividuals} cities=${c.cityCount} edges=${c.edgeCount} ` +
      `ticks=${c.ticks} totalMs=${c.ms} perTickMs=${c.perTick} tps=${c.tps}`
  );
}
