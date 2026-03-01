import { DEFAULT_CONFIG } from "./config/defaultConfig.js";
import { createSampleWorld } from "./world/model.js";
import { SimulationEngine } from "./sim/engine.js";

function main() {
  const world = createSampleWorld(DEFAULT_CONFIG.seed);
  const engine = new SimulationEngine({ world, config: DEFAULT_CONFIG });

  const ticksPerDay = Math.floor(DEFAULT_CONFIG.dayMinutes / DEFAULT_CONFIG.tickMinutes);

  for (let i = 0; i < ticksPerDay; i += 1) {
    const frame = engine.tick();
    const totalOutbound = frame.flows.reduce((sum, item) => sum + item.outbound, 0);
    const totalInbound = frame.flows.reduce((sum, item) => sum + item.inbound, 0);
    const state = frame.people.stateCounts;
    const encounterTotal = frame.people.encounterSummary.total;
    const focusCities = frame.people.focusCityIds.join(",");

    console.log(
      `${frame.time} | ${frame.phase.padEnd(7)} | ` +
        `outbound=${totalOutbound.toString().padStart(6)} inbound=${totalInbound
          .toString()
          .padStart(6)} particles=${frame.particles.length} | ` +
        `H:${state.Home} C:${state.Commute} W:${state.Work} L:${state.Leisure} S:${state.Sleep} | ` +
        `encounters=${encounterTotal.toString().padStart(3)} focus=${focusCities}`
    );
  }
}

main();
