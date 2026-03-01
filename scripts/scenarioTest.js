import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { createSampleWorld } from "../src/world/model.js";
import { SimulationEngine } from "../src/sim/engine.js";

function runScenario(name, mutator) {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  mutator(config);
  const world = createSampleWorld(config.seed);
  const engine = new SimulationEngine({ world, config });

  for (let i = 0; i < 96; i += 1) {
    engine.tick();
  }
  return { name, world };
}

const baseline = runScenario(
  "balanced",
  (config) => {
    config.policy.mode = "balanced";
  }
);

const growth = runScenario(
  "growth",
  (config) => {
    config.policy.mode = "growth";
  }
);

const stability = runScenario(
  "stability",
  (config) => {
    config.policy.mode = "stability";
  }
);

const b = baseline.world.cities[0].metrics;
const g = growth.world.cities[0].metrics;
const s = stability.world.cities[0].metrics;

const checks = [
  {
    ok: s.safety >= b.safety,
    message: `stability safety expected >= baseline (${s.safety.toFixed(3)} < ${b.safety.toFixed(3)})`
  },
  {
    ok: s.trust >= b.trust,
    message: `stability trust expected >= baseline (${s.trust.toFixed(3)} < ${b.trust.toFixed(3)})`
  },
  {
    ok: g.productivity >= b.productivity,
    message: `growth productivity expected >= baseline (${g.productivity.toFixed(3)} < ${b.productivity.toFixed(3)})`
  }
];

const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  throw new Error(failed.map((f) => f.message).join(" | "));
}

console.log("[pass] policy scenarios");
