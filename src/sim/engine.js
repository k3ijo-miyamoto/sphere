import { SimClock } from "../core/time.js";
import { Rng } from "../core/rng.js";
import { computeCommuteFlows } from "./flow.js";
import { buildFlowParticles } from "../render/flowView.js";
import { PopulationSystem } from "./population.js";
import { updateCityDynamics } from "./cityDynamics.js";
import { updateGeopolitics } from "./geopolitics.js";
import { updateSphereDynamics } from "./sphereDynamics.js";
import { updateInformationDynamics } from "./informationDynamics.js";
import { createSnapshot, loadSnapshot } from "./snapshot.js";

export class SimulationEngine {
  constructor({ world, config }) {
    this.world = world;
    this.config = config;
    this.clock = new SimClock(config.dayMinutes);
    this.rng = new Rng(config.seed);
    this.population = new PopulationSystem({ world, config, rng: this.rng });
    this.history = [];
    this.historyCursor = -1;
  }

  tick() {
    const phase = this.clock.getPhase();
    const dayOfWeek = this.clock.day % 7;
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const weekCtx = { dayOfWeek, isWeekend };
    const flows = computeCommuteFlows(this.world, phase, this.config, weekCtx);
    const particles = buildFlowParticles(this.world, flows, this.config.flowParticleScale);
    const peopleFrame = this.population.tick({
      phase,
      day: this.clock.day,
      minuteOfDay: this.clock.minuteOfDay,
      dayOfWeek,
      isWeekend
    });
    const sphereDynamics = updateSphereDynamics({
      world: this.world,
      people: this.population.people,
      config: this.config,
      rng: this.rng,
      day: this.clock.day,
      phase
    });
    const informationDynamics = updateInformationDynamics({
      world: this.world,
      people: this.population.people,
      config: this.config,
      rng: this.rng,
      day: this.clock.day,
      phase
    });
    const populationActionRecent = peopleFrame.actions?.recent ?? [];
    const populationActionCounts = peopleFrame.actions?.counts ?? {};
    const infoActionRecent = informationDynamics.actions?.recent ?? [];
    const infoActionCounts = informationDynamics.actions?.counts ?? {};
    peopleFrame.actions = {
      counts: mergeActionCounts(populationActionCounts, infoActionCounts),
      recent: [...populationActionRecent, ...infoActionRecent].slice(-240)
    };
    const cityDynamics = updateCityDynamics({ world: this.world, frame: { people: peopleFrame }, config: this.config, rng: this.rng });
    const forceGeopoliticsTick = this.world.systemState?.systemicTriggers?.forceGeopoliticsTick ?? false;
    const geopolitics = updateGeopolitics({
      world: this.world,
      frame: { people: peopleFrame },
      config: this.config,
      rng: this.rng,
      day: this.clock.day,
      phase,
      forceUpdate: forceGeopoliticsTick
    });
    if (forceGeopoliticsTick && this.world.systemState?.systemicTriggers) {
      this.world.systemState.systemicTriggers.forceGeopoliticsTick = false;
    }
    if (geopolitics.events?.length) {
      peopleFrame.events = [...geopolitics.events, ...(peopleFrame.events ?? [])].slice(0, 12);
    }

    const frame = {
      time: this.clock.format(),
      phase,
      dayOfWeek,
      isWeekend,
      worldVersion: this.world.version,
      system: { ...this.world.systemState, cityDynamics, sphereDynamics, informationDynamics },
      flows,
      particles,
      people: peopleFrame,
      geopolitics,
      historyCursor: this.historyCursor
    };

    this.pushHistoryFrame(frame);
    frame.historyCursor = this.historyCursor;
    frame.historyLength = this.history.length;
    this.clock.tick(this.config.tickMinutes);
    return frame;
  }

  exportSnapshot() {
    return createSnapshot(this);
  }

  importSnapshot(snapshot) {
    loadSnapshot(this, snapshot);
  }

  pushHistoryFrame(frame) {
    const limit = this.config.timeline?.historyLimit ?? 240;
    const clone = JSON.parse(JSON.stringify(frame));
    this.history.push(clone);
    if (this.history.length > limit) {
      this.history.shift();
    }
    this.historyCursor = this.history.length - 1;
  }

  getHistoryFrame(offset = 0) {
    if (this.history.length === 0) {
      return null;
    }
    const next = Math.max(0, Math.min(this.history.length - 1, this.historyCursor + offset));
    this.historyCursor = next;
    const frame = this.history[next];
    return { ...frame, historyCursor: next, historyLength: this.history.length };
  }
}

function mergeActionCounts(a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out = {};
  for (const k of keys) {
    out[k] = (a?.[k] ?? 0) + (b?.[k] ?? 0);
  }
  return out;
}
