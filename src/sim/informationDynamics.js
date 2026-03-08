function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const TOPICS = ["religion", "security", "diplomacy", "economy", "resources", "institutions"];
const SOURCE_TYPES = ["official", "influencer", "community", "anonymous", "bot"];
const MISINFO_TYPES = ["misinformation", "incitement", "false_authority"];
const LAYERS = ["Layer0", "Layer1", "Layer2"];

export function updateInformationDynamics({ world, people, config, rng, day, phase }) {
  if (!(config?.communication?.enabled ?? true)) {
    return { generated: 0, consumed: 0, shared: 0, metrics: null, actions: { counts: {}, recent: [] } };
  }
  const state = ensureInformationState(world, config);
  const generated = generateInfos({ world, state, config, rng, phase });
  const interaction = applyInfoConsumption({ world, people, state, config, rng, day, phase });
  trimInfoState(state, config);
  state.metrics = buildMetrics(state, interaction, day);
  world.systemState.information = state;
  return {
    generated,
    consumed: interaction.consumed,
    shared: interaction.shared,
    metrics: state.metrics,
    actions: {
      counts: {
        consume: interaction.consumed,
        share: interaction.shared,
        verify: interaction.verified,
        report: interaction.reported,
        persuade: interaction.persuaded
      },
      recent: interaction.actions.slice(-220)
    }
  };
}

function ensureInformationState(world, config) {
  world.systemState = world.systemState ?? {};
  const state = (world.systemState.information = world.systemState.information ?? {
    activeInfos: [],
    history: [],
    nextInfoSeq: 1,
    edgeAllowed: null,
    daily: { day: -1, generated: 0, consumed: 0, shared: 0, reported: 0, verified: 0 },
    typeTotals: {
      misinformation: 0,
      incitement: 0,
      false_authority: 0,
      factual: 0
    }
  });
  state.edgeAllowed = state.edgeAllowed ?? createEdgeAllowed(world, config);
  return state;
}

function createEdgeAllowed(world, config) {
  const fromConfig = config?.communication?.edgeAllowedBySphere ?? {};
  const out = {};
  for (const sphere of world.spheres ?? []) {
    out[sphere.id] = normalizeSphereEdgeRule(fromConfig[sphere.id] ?? {});
  }
  return out;
}

function normalizeSphereEdgeRule(raw) {
  const out = {};
  for (const from of LAYERS) {
    out[from] = {};
    for (const to of LAYERS) {
      const r = raw?.[from]?.[to] ?? {};
      out[from][to] = {
        prob: clamp(r.prob ?? 0.35, 0, 1),
        cost: clamp(r.cost ?? 0.25, 0, 1),
        latency: Math.max(1, Math.floor(r.latency ?? 1))
      };
    }
  }
  return out;
}

function generateInfos({ world, state, config, rng, phase }) {
  const baseGen = clamp(config?.communication?.baseInfoGenPerTick ?? 0.018, 0, 0.8);
  const phaseMult =
    phase === "Morning" ? 1.18
    : phase === "Evening" ? 1.22
    : phase === "Night" ? 0.94
    : 1;
  const sampleSize = Math.max(1, Math.floor((world.cities?.length ?? 1) * phaseMult * 0.9));
  let generated = 0;

  for (let i = 0; i < sampleSize; i += 1) {
    if (rng.next() > baseGen * phaseMult) {
      continue;
    }
    const city = pickOne(world.cities ?? [], rng);
    const sphere = pickOne(world.spheres ?? [], rng);
    if (!city || !sphere) {
      continue;
    }
    const sourceType = pickOne(SOURCE_TYPES, rng);
    const emotion = clamp(
      (sourceType === "bot" ? 0.55 : 0.35) +
        (sphere.rankingPolicy === "outrage_boost" ? 0.2 : sphere.rankingPolicy === "health_boost" ? -0.08 : 0) +
        rng.range(-0.18, 0.24),
      0,
      1
    );
    const truthValue = clamp(
      0.5 +
        (sourceType === "official" ? 0.22 : sourceType === "bot" ? -0.2 : 0) +
        (sphere.credibilityWeight ?? 0.5) * 0.24 -
        (sphere.botPressure ?? 0.1) * 0.2 +
        rng.range(-0.32, 0.28),
      0,
      1
    );
    const info = {
      infoId: `I${state.nextInfoSeq++}`,
      truthValue: Number(truthValue.toFixed(4)),
      emotion: Number(emotion.toFixed(4)),
      topic: pickOne(TOPICS, rng),
      sourceType,
      sourceLayer: sourceType === "official" ? "Layer2" : sourceType === "community" ? "Layer1" : "Layer0",
      sphereOrigin: sphere.id,
      cityOrigin: city.id,
      misinfoType: classifyMisinfoType({ truthValue, emotion, sourceType }),
      ttl: 16 + Math.floor(rng.range(0, 38))
    };
    state.activeInfos.push(info);
    state.history.push(info);
    if (info.misinfoType) {
      state.typeTotals[info.misinfoType] = (state.typeTotals[info.misinfoType] ?? 0) + 1;
    } else {
      state.typeTotals.factual = (state.typeTotals.factual ?? 0) + 1;
    }
    generated += 1;
  }
  return generated;
}

function classifyMisinfoType({ truthValue, emotion, sourceType }) {
  if (truthValue < 0.42 && emotion < 0.62) {
    return "misinformation";
  }
  if (emotion >= 0.62 && (sourceType === "anonymous" || sourceType === "bot" || truthValue < 0.5)) {
    return "incitement";
  }
  if (truthValue < 0.55 && sourceType === "official") {
    return "false_authority";
  }
  return null;
}

function applyInfoConsumption({ world, people, state, config, rng, day, phase }) {
  const activeInfos = state.activeInfos ?? [];
  if (!activeInfos.length || !people?.length) {
    return { consumed: 0, shared: 0, verified: 0, reported: 0, persuaded: 0, actions: [] };
  }
  if (state.daily.day !== day) {
    state.daily = { day, generated: 0, consumed: 0, shared: 0, reported: 0, verified: 0 };
  }

  const cityEffects = new Map((world.cities ?? []).map((c) => [c.id, { trustDrop: 0, instabilityUp: 0, n: 0 }]));
  const peopleByCity = buildPeopleByCity(people);
  let consumed = 0;
  let shared = 0;
  let verified = 0;
  let reported = 0;
  let persuaded = 0;
  const actions = [];

  for (const person of people) {
    const sphereId = pickByWeights(person.sphereAffinities, rng) ?? activeInfos[0]?.sphereOrigin;
    const pool = activeInfos.filter((x) => x.sphereOrigin === sphereId);
    if (!pool.length) {
      continue;
    }
    const focus = clamp(person.attentionBudget ?? 0.6, 0, 1);
    const consumeTrials =
      phase === "Daytime" ? 1 + (focus > 0.72 ? 1 : 0)
      : phase === "Evening" ? 2
      : 1;
    for (let i = 0; i < consumeTrials; i += 1) {
      const info = pickOne(pool, rng);
      if (!info) {
        continue;
      }
      const targetLayer = person.roleLayer ?? "Layer0";
      const allowed = getEdgeAllowed(state.edgeAllowed, info.sphereOrigin, info.sourceLayer ?? "Layer0", targetLayer);
      const gateProb = clamp((allowed.prob ?? 0.35) * (1 - (allowed.cost ?? 0.2) * 0.4), 0.01, 0.99);
      if (rng.next() > gateProb) {
        continue;
      }
      const cityId = person.currentCityId ?? person.homeCityId;
      consumed += 1;
      actions.push({
        type: "consume",
        actorId: person.id,
        infoId: info.infoId,
        sphereId: info.sphereOrigin,
        cityId: cityId,
        day,
        phase
      });
      const credibility =
        clamp(person.trustGraph?.media ?? 0.5, 0, 1) * 0.42 +
        clamp(person.trustGraph?.institution ?? 0.5, 0, 1) * 0.3 +
        clamp(person.beliefVector?.conspiracyResistance ?? 0.5, 0, 1) * 0.28;
      const perceivedTruth = clamp(info.truthValue * 0.62 + credibility * 0.38 + rng.range(-0.12, 0.1), 0, 1);
      const sharedNow = rng.next() < clamp(info.emotion * 0.42 + (1 - perceivedTruth) * 0.2 + (person.influence ?? 0.1) * 0.3, 0, 0.88);
      const verifyNow = rng.next() < clamp((person.beliefVector?.conspiracyResistance ?? 0.5) * 0.26 + credibility * 0.22, 0.02, 0.65);
      const reportNow = rng.next() < clamp((verifyNow ? 0.15 : 0.05) + (info.misinfoType ? 0.12 : 0), 0, 0.72);
      if (sharedNow) {
        shared += 1;
        actions.push({
          type: "share",
          actorId: person.id,
          infoId: info.infoId,
          sphereId: info.sphereOrigin,
          cityId,
          day,
          phase
        });
      }
      if (verifyNow) {
        verified += 1;
        actions.push({
          type: "verify",
          actorId: person.id,
          infoId: info.infoId,
          sphereId: info.sphereOrigin,
          cityId,
          day,
          phase
        });
      }
      if (reportNow) {
        reported += 1;
        actions.push({
          type: "report",
          actorId: person.id,
          infoId: info.infoId,
          sphereId: info.sphereOrigin,
          cityId,
          day,
          phase
        });
      }
      const persuadeNow = sharedNow && rng.next() < clamp((person.influence ?? 0.1) * 0.28 + (info.emotion ?? 0.4) * 0.22, 0, 0.75);
      if (persuadeNow) {
        const target = pickPersuasionTarget(peopleByCity, person, cityId, rng);
        if (target) {
          persuaded += 1;
          actions.push({
            type: "persuade",
            actorId: person.id,
            targetId: target.id,
            infoId: info.infoId,
            sphereId: info.sphereOrigin,
            cityId,
            day,
            phase
          });
        }
      }

      applyPersonBeliefDrift(person, info, perceivedTruth, sharedNow, verifyNow);
      const row = cityEffects.get(cityId);
      if (row) {
        const mistrustPulse = (1 - perceivedTruth) * (info.emotion ?? 0.4) * (info.misinfoType ? 1.15 : 0.7);
        row.trustDrop += mistrustPulse * 0.0018;
        row.instabilityUp += mistrustPulse * 0.0022 + (sharedNow ? 0.0008 : 0);
        row.n += 1;
      }
    }
  }

  applyCityInfoEffects(world, cityEffects);
  state.daily.consumed += consumed;
  state.daily.shared += shared;
  state.daily.verified += verified;
  state.daily.reported += reported;
  return { consumed, shared, verified, reported, persuaded, actions };
}

function applyPersonBeliefDrift(person, info, perceivedTruth, sharedNow, verifyNow) {
  const anti = person.beliefVector?.antiEstablishment ?? 0.5;
  const order = person.beliefVector?.orderOrientation ?? 0.5;
  const resist = person.beliefVector?.conspiracyResistance ?? 0.5;
  const emotion = info.emotion ?? 0.4;
  const uncertainty = 1 - perceivedTruth;
  person.beliefVector.antiEstablishment = clamp(anti * 0.987 + uncertainty * emotion * 0.03, 0, 1);
  person.beliefVector.orderOrientation = clamp(order * 0.988 + perceivedTruth * 0.014 - uncertainty * 0.009, 0, 1);
  person.beliefVector.conspiracyResistance = clamp(
    resist * 0.99 + (verifyNow ? 0.012 : -0.004) + (info.misinfoType === "false_authority" ? -0.005 : 0),
    0,
    1
  );
  person.trustGraph.media = clamp((person.trustGraph?.media ?? 0.5) * 0.992 - uncertainty * emotion * 0.01 + (verifyNow ? 0.003 : 0), 0, 1);
  person.trustGraph.institution = clamp(
    (person.trustGraph?.institution ?? 0.5) * 0.993 -
      (info.sourceType === "official" && info.misinfoType ? 0.008 : 0) +
      (sharedNow ? -0.002 : 0),
    0,
    1
  );
}

function applyCityInfoEffects(world, cityEffects) {
  for (const [cityId, row] of cityEffects.entries()) {
    if ((row.n ?? 0) <= 0) {
      continue;
    }
    const city = world.getCityById(cityId);
    if (!city) {
      continue;
    }
    const trustDrop = row.trustDrop / row.n;
    const instabilityUp = row.instabilityUp / row.n;
    city.metrics.trust = clamp((city.metrics?.trust ?? 0.5) - trustDrop, 0.02, 0.99);
    city.metrics.instabilityRisk = clamp((city.metrics?.instabilityRisk ?? 0.2) + instabilityUp, 0.01, 0.99);
  }
}

function getEdgeAllowed(edgeAllowed, sphereId, fromLayer, toLayer) {
  const sid = edgeAllowed?.[sphereId] ? sphereId : Object.keys(edgeAllowed ?? {})[0];
  const sphereRule = edgeAllowed?.[sid] ?? {};
  return sphereRule?.[fromLayer]?.[toLayer] ?? { prob: 0.35, cost: 0.25, latency: 1 };
}

function trimInfoState(state, config) {
  const maxActive = Math.max(24, Math.floor(config?.communication?.maxActiveInfos ?? 180));
  for (const info of state.activeInfos ?? []) {
    info.ttl = Math.max(0, (info.ttl ?? 1) - 1);
  }
  state.activeInfos = (state.activeInfos ?? []).filter((x) => (x.ttl ?? 0) > 0).slice(-maxActive);
  state.history = (state.history ?? []).slice(-1200);
}

function buildMetrics(state, interaction, day) {
  const active = state.activeInfos ?? [];
  const misCount = active.filter((x) => x.misinfoType).length;
  const byTypeActive = {
    misinformation: active.filter((x) => x.misinfoType === "misinformation").length,
    incitement: active.filter((x) => x.misinfoType === "incitement").length,
    false_authority: active.filter((x) => x.misinfoType === "false_authority").length
  };
  return {
    day,
    activeInfoCount: active.length,
    activeMisinfoCount: misCount,
    activeMisinfoShare: Number((misCount / Math.max(1, active.length)).toFixed(4)),
    byTypeActive,
    consumedThisTick: interaction.consumed,
    sharedThisTick: interaction.shared,
    reportedThisTick: interaction.reported,
    verifiedThisTick: interaction.verified,
    typeTotals: { ...state.typeTotals }
  };
}

function pickOne(list, rng) {
  if (!list?.length) {
    return null;
  }
  const idx = Math.floor(rng.range(0, list.length));
  return list[Math.min(list.length - 1, Math.max(0, idx))] ?? null;
}

function pickByWeights(map, rng) {
  const entries = Object.entries(map ?? {}).filter(([, w]) => Number.isFinite(w) && w > 0);
  if (!entries.length) {
    return null;
  }
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rng.range(0, total);
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) {
      return k;
    }
  }
  return entries[entries.length - 1][0];
}

function pickPersuasionTarget(peopleByCity, actor, cityId, rng) {
  const candidates = peopleByCity.get(cityId) ?? [];
  if (!candidates.length) {
    return null;
  }
  if (candidates.length === 1 && candidates[0].id === actor.id) {
    return null;
  }
  const attempts = Math.min(4, candidates.length);
  for (let i = 0; i < attempts; i += 1) {
    const row = candidates[Math.floor(rng.range(0, candidates.length))];
    if (row && row.id !== actor.id) {
      return row;
    }
  }
  return candidates.find((x) => x.id !== actor.id) ?? null;
}

function buildPeopleByCity(people) {
  const out = new Map();
  for (const person of people ?? []) {
    const cityId = person.currentCityId ?? person.homeCityId;
    const arr = out.get(cityId) ?? [];
    arr.push(person);
    out.set(cityId, arr);
  }
  return out;
}
