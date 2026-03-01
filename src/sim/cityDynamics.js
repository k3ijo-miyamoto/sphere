function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const RESOURCE_KEYS = ["water", "food", "energy_fossil", "energy_renewable", "metals_bulk", "rare_minerals", "human"];
const RESOURCE_RL_ACTIONS = ["conserve", "balanced", "extract", "green_shift"];

export function updateCityDynamics({ world, frame, config, rng }) {
  updateSystemExtensions(world, config, rng, frame);
  ensureResourceSystems(world);
  ensureResourcePolicyState(world);
  ensurePolicyGenomeState(world, config);
  world.systemState.policyGenome.tick = (world.systemState.policyGenome.tick ?? 0) + 1;

  const presence = frame.people.cityPresence;
  const religionByCity = frame.people.religionByCity || {};
  const cityStats = frame.people.demographics?.cityStats || [];
  const policy = config.policy || {};

  const birthsDeaths = new Map(cityStats.map((item) => [item.cityId, item]));

  for (const city of world.cities) {
    ensureCityResourceProfile(city);
    city.lifecycle = city.lifecycle ?? { riseScore: 0.4, declineScore: 0.3, status: "stable" };
    ensureCityPolicyGenome(city, rng);
    const genomePolicy = getGenomePolicyBias(city, policy);
    const popNow = presence[city.id] || 0;
    const stats = birthsDeaths.get(city.id) || { births: 0, deaths: 0, net: 0, marriages: 0, divorces: 0 };
    const relRows = religionByCity[city.id] || [];

    const congestionTarget = clamp(popNow / Math.max(80, city.population * 0.012), 0.05, 1);
    city.metrics.congestion = city.metrics.congestion * 0.82 + congestionTarget * 0.18;

    const policySafetyBoost = genomePolicy.safetyBudget * 0.08;
    const inequalityPressure = city.metrics.inequality * 0.06;
    city.metrics.safety = clamp(
      city.metrics.safety + policySafetyBoost - inequalityPressure - city.metrics.congestion * 0.03,
      0.05,
      0.98
    );

    const policyWelfare = genomePolicy.welfareBudget * 0.07;
    city.metrics.trust = clamp(
      city.metrics.trust + policyWelfare + stats.marriages * 0.002 - stats.divorces * 0.003 - city.metrics.inequality * 0.025,
      0.05,
      0.98
    );

    const policyEducation = genomePolicy.educationBudget * 0.08;
    city.metrics.productivity = clamp(
      city.metrics.productivity + policyEducation * 0.03 - city.metrics.congestion * 0.015,
      0.25,
      1.8
    );

    const wageDrift = city.metrics.productivity * 0.01 - city.metrics.congestion * 0.008;
    city.metrics.wageLevel = clamp(city.metrics.wageLevel + wageDrift, 0.25, 2.2);

    const costDrift = city.metrics.wageLevel * 0.006 + city.metrics.congestion * 0.01;
    city.metrics.costOfLiving = clamp(city.metrics.costOfLiving + costDrift, 0.2, 2.6);

    const inequalityDrift =
      city.metrics.wageLevel * 0.003 -
      policyWelfare * 0.02 +
      city.metrics.congestion * 0.01 -
      city.metrics.trust * 0.008;
    city.metrics.inequality = clamp(city.metrics.inequality + inequalityDrift, 0.05, 0.98);
    city.metrics.employmentCapacity = clamp(
      city.metrics.employmentCapacity + city.metrics.productivity * 0.008 - city.metrics.congestion * 0.012,
      0.2,
      0.98
    );
    city.metrics.instabilityRisk = clamp(
      city.metrics.inequality * 0.56 + (1 - city.metrics.safety) * 0.44 + rng.range(-0.03, 0.03),
      0.01,
      0.99
    );

    const epidemic = world.systemState?.epidemicLevel ?? 0;
    const climate = world.systemState?.climateStress ?? 0;
    const culture = world.systemState?.culturalDrift ?? 0;
    city.metrics.safety = clamp(city.metrics.safety - epidemic * 0.01, 0.03, 0.99);
    city.metrics.productivity = clamp(city.metrics.productivity - epidemic * 0.008 - climate * 0.006 + culture * 0.004, 0.2, 2.2);
    city.metrics.costOfLiving = clamp(city.metrics.costOfLiving + climate * 0.006, 0.2, 2.8);
    city.metrics.trust = clamp(city.metrics.trust + culture * 0.004 - epidemic * 0.004, 0.02, 0.99);

    const resourcePolicy = chooseResourcePolicyAction(world, city.id, config, rng, city.policyGenome);
    const resourceEffect = applyCityResourceCycle({
      city,
      popNow,
      stats,
      resourceState: world.systemState.resources,
      resourcePolicy,
      config,
      rng
    });
    city.metrics.productivity = clamp(city.metrics.productivity + resourceEffect.productivityDelta, 0.2, 2.2);
    city.metrics.costOfLiving = clamp(city.metrics.costOfLiving + resourceEffect.costDelta, 0.2, 2.8);
    city.metrics.trust = clamp(city.metrics.trust + resourceEffect.trustDelta, 0.02, 0.99);
    city.metrics.safety = clamp(city.metrics.safety + resourceEffect.safetyDelta, 0.03, 0.99);
    city.metrics.instabilityRisk = clamp(city.metrics.instabilityRisk + resourceEffect.instabilityDelta, 0.01, 0.99);
    city.lifecycle.resourceStress = Number(resourceEffect.resourceStress.toFixed(3));
    city.lifecycle.resourceAbundance = Number(resourceEffect.resourceAbundance.toFixed(3));
    updateResourcePolicyLearning(world, city.id, resourcePolicy.action, {
      resourceStress: resourceEffect.resourceStress,
      productivityDelta: resourceEffect.productivityDelta,
      costDelta: resourceEffect.costDelta,
      instabilityDelta: resourceEffect.instabilityDelta
    }, config);

    city.population = Math.max(0, city.population + stats.net);
    city.religionComposition = relRows;

    const riseSignal = city.metrics.productivity * 0.65 + city.metrics.trust * 0.35 - city.metrics.congestion * 0.2;
    const declineSignal = city.metrics.inequality * 0.55 + city.metrics.congestion * 0.35 + (1 - city.metrics.safety) * 0.1;
    city.lifecycle.riseScore = clamp((city.lifecycle.riseScore ?? 0.4) * 0.88 + riseSignal * 0.12, 0, 1);
    city.lifecycle.declineScore = clamp((city.lifecycle.declineScore ?? 0.3) * 0.88 + declineSignal * 0.12, 0, 1);
    if (city.lifecycle.riseScore > (config.urbanDynamics?.hubRiseThreshold ?? 1.15) - 0.3) {
      city.lifecycle.status = "rising";
      if (city.cityType === "residential" && city.metrics.productivity > 0.95) {
        city.cityType = "mixed";
      }
      if (city.cityType === "mixed" && city.metrics.productivity > 1.2 && city.metrics.trust > 0.55) {
        city.cityType = "workHub";
      }
    } else if (city.lifecycle.declineScore > (config.urbanDynamics?.declineThreshold ?? 0.52) + 0.2) {
      city.lifecycle.status = "declining";
      if (city.cityType === "workHub" && city.metrics.productivity < 0.72) {
        city.cityType = "mixed";
      }
      if (city.cityType === "mixed" && city.metrics.productivity < 0.55 && city.metrics.inequality > 0.7) {
        city.cityType = "residential";
      }
    } else {
      city.lifecycle.status = "stable";
    }
  }

  maybeEvolvePolicyGenomes(world, config, rng);

  if (config.policy?.mode === "growth") {
    for (const city of world.cities) {
      city.metrics.productivity = clamp(city.metrics.productivity + 0.01, 0.25, 2.2);
      city.metrics.inequality = clamp(city.metrics.inequality + 0.007, 0.05, 0.98);
    }
  }

  if (config.policy?.mode === "stability") {
    for (const city of world.cities) {
      city.metrics.safety = clamp(city.metrics.safety + 0.01, 0.05, 0.99);
      city.metrics.trust = clamp(city.metrics.trust + 0.008, 0.05, 0.99);
      city.metrics.productivity = clamp(city.metrics.productivity - 0.004, 0.2, 2.2);
    }
  }

  const chaoticShift = rng.range(-0.003, 0.003);
  for (const city of world.cities) {
    city.metrics.congestion = clamp(city.metrics.congestion + chaoticShift, 0.01, 1);
  }

  const riotThreshold = config.instability?.riotThreshold ?? 0.72;
  for (const edge of world.edges) {
    const a = world.getCityById(edge.fromCityId);
    const b = world.getCityById(edge.toCityId);
    const risk = Math.max(a?.metrics?.instabilityRisk ?? 0, b?.metrics?.instabilityRisk ?? 0);
    if (risk > riotThreshold + 0.08) {
      edge.gatewayRestriction = "sealed";
    } else if (risk > riotThreshold - 0.05) {
      edge.gatewayRestriction = "permit";
    } else {
      edge.gatewayRestriction = "open";
    }
  }

  updateGlobalResourceMarket(world, config, rng);
  rewireTopology(world, rng);
  evolveCityNodes(world, frame, rng, config);
}

function updateSystemExtensions(world, config, rng, frame) {
  world.systemState = world.systemState ?? {
    epidemicLevel: 0.1,
    climateStress: 0.16,
    culturalDrift: 0.22,
    marketIndex: 1
  };
  const ext = config.extensions ?? {};
  if (ext.epidemic?.enabled) {
    const diseaseSignal =
      world.cities.reduce((sum, city) => sum + city.metrics.congestion * (1 - city.metrics.safety), 0) /
      Math.max(1, world.cities.length);
    const drift = (ext.epidemic?.baseDrift ?? 0.002) + diseaseSignal * 0.01 + rng.range(-0.004, 0.004);
    world.systemState.epidemicLevel = clamp(world.systemState.epidemicLevel * 0.93 + drift, 0.02, 0.95);
  }
  if (ext.climate?.enabled) {
    const congestion = world.cities.reduce((sum, city) => sum + city.metrics.congestion, 0) / Math.max(1, world.cities.length);
    const drift = (ext.climate?.baseDrift ?? 0.0015) + congestion * 0.003 + rng.range(-0.002, 0.002);
    world.systemState.climateStress = clamp(world.systemState.climateStress * 0.96 + drift, 0.05, 0.95);
  }
  if (ext.culture?.enabled) {
    const relDiversity = averageReligionDiversity(frame.people.religionByCity || {});
    const drift = (ext.culture?.traitDrift ?? 0.002) + relDiversity * 0.01 + rng.range(-0.002, 0.002);
    world.systemState.culturalDrift = clamp(world.systemState.culturalDrift * 0.95 + drift, 0.05, 0.95);
  }

  const macro =
    world.cities.reduce((sum, city) => sum + city.metrics.productivity - city.metrics.inequality * 0.6, 0) /
    Math.max(1, world.cities.length);
  world.systemState.marketIndex = clamp(
    world.systemState.marketIndex * (1 + macro * 0.002 + rng.range(-0.01, 0.01)),
    0.65,
    2.4
  );
}

function ensureResourceSystems(world) {
  world.systemState = world.systemState ?? {};
  world.systemState.resources = world.systemState.resources ?? {};
  world.systemState.resources.prices = world.systemState.resources.prices ?? {};
  for (const key of RESOURCE_KEYS) {
    if (!Number.isFinite(world.systemState.resources.prices[key])) {
      world.systemState.resources.prices[key] = 1;
    }
  }
  world.systemState.resources.globalScarcity = Number.isFinite(world.systemState.resources.globalScarcity)
    ? world.systemState.resources.globalScarcity
    : 0.2;
}

function ensureResourcePolicyState(world) {
  world.systemState = world.systemState ?? {};
  world.systemState.resourcePolicies = world.systemState.resourcePolicies ?? { cities: {} };
}

function ensurePolicyGenomeState(world, config) {
  world.systemState = world.systemState ?? {};
  world.systemState.policyGenome = world.systemState.policyGenome ?? {};
  world.systemState.policyGenome.enabled = config?.policyGenome?.enabled !== false;
  world.systemState.policyGenome.tick = world.systemState.policyGenome.tick ?? 0;
  world.systemState.policyGenome.lastEvolutionTick = world.systemState.policyGenome.lastEvolutionTick ?? 0;
}

function ensureCityPolicyGenome(city, rng) {
  city.policyGenome = city.policyGenome ?? {
    safetyFocus: clamp(0.5 + rng.range(-0.2, 0.2), 0, 1),
    welfareFocus: clamp(0.5 + rng.range(-0.2, 0.2), 0, 1),
    educationFocus: clamp(0.5 + rng.range(-0.2, 0.2), 0, 1),
    greenAffinity: clamp(0.5 + rng.range(-0.22, 0.22), 0, 1),
    growthAffinity: clamp(0.5 + rng.range(-0.22, 0.22), 0, 1),
    explorationBias: clamp(0.5 + rng.range(-0.25, 0.25), 0, 1),
    mutationRate: clamp(0.5 + rng.range(-0.2, 0.2), 0.05, 1),
    fitnessEma: 0.5
  };
}

function getGenomePolicyBias(city, policy) {
  const g = city.policyGenome ?? {};
  const safetyWeight = 0.65 + (g.safetyFocus ?? 0.5) * 0.7;
  const welfareWeight = 0.65 + (g.welfareFocus ?? 0.5) * 0.7;
  const educationWeight = 0.65 + (g.educationFocus ?? 0.5) * 0.7;
  return {
    safetyBudget: clamp((policy.safetyBudget ?? 0.5) * safetyWeight, 0.05, 1.6),
    welfareBudget: clamp((policy.welfareBudget ?? 0.5) * welfareWeight, 0.05, 1.6),
    educationBudget: clamp((policy.educationBudget ?? 0.5) * educationWeight, 0.05, 1.6)
  };
}

function ensureCityResourcePolicy(world, cityId) {
  ensureResourcePolicyState(world);
  const row = (world.systemState.resourcePolicies.cities[cityId] = world.systemState.resourcePolicies.cities[cityId] ?? {
    qByAction: {},
    nByAction: {},
    lastAction: "balanced"
  });
  for (const action of RESOURCE_RL_ACTIONS) {
    if (!Number.isFinite(row.qByAction[action])) {
      row.qByAction[action] = 0.5;
    }
    if (!Number.isFinite(row.nByAction[action])) {
      row.nByAction[action] = 0;
    }
  }
  return row;
}

function chooseResourcePolicyAction(world, cityId, config, rng, genome = null) {
  const row = ensureCityResourcePolicy(world, cityId);
  const genomeExploration = 0.8 + (genome?.explorationBias ?? 0.5) * 0.8;
  const eps = clamp((config?.rl?.resourceEpsilon ?? config?.rl?.epsilon ?? 0.12) * genomeExploration, 0.01, 0.55);
  let action = row.lastAction ?? "balanced";
  if (rng.next() < eps) {
    action = RESOURCE_RL_ACTIONS[Math.floor(rng.range(0, RESOURCE_RL_ACTIONS.length))];
  } else {
    let best = RESOURCE_RL_ACTIONS[0];
    let bestQ = -Infinity;
    for (const a of RESOURCE_RL_ACTIONS) {
      const q = (row.qByAction[a] ?? 0) + resourceActionGenomeBias(a, genome);
      if (q > bestQ) {
        bestQ = q;
        best = a;
      }
    }
    action = best;
  }
  row.lastAction = action;
  if (action === "conserve") {
    return { action, extractionMult: 0.85, renewableBoost: 1.08, demandMult: 0.94 };
  }
  if (action === "extract") {
    return { action, extractionMult: 1.18, renewableBoost: 0.96, demandMult: 1.02 };
  }
  if (action === "green_shift") {
    return { action, extractionMult: 0.9, renewableBoost: 1.28, demandMult: 0.95 };
  }
  return { action: "balanced", extractionMult: 1, renewableBoost: 1, demandMult: 1 };
}

function resourceActionGenomeBias(action, genome) {
  if (!genome) {
    return 0;
  }
  const green = genome.greenAffinity ?? 0.5;
  const growth = genome.growthAffinity ?? 0.5;
  const safety = genome.safetyFocus ?? 0.5;
  const edu = genome.educationFocus ?? 0.5;
  if (action === "green_shift") {
    return green * 0.14 + edu * 0.04;
  }
  if (action === "conserve") {
    return green * 0.08 + safety * 0.05;
  }
  if (action === "extract") {
    return growth * 0.12 - green * 0.07;
  }
  return 0.03;
}

function maybeEvolvePolicyGenomes(world, config, rng) {
  if (!(config?.policyGenome?.enabled ?? true)) {
    return;
  }
  const state = world.systemState?.policyGenome ?? {};
  const interval = Math.max(12, Math.floor(config?.policyGenome?.evolutionIntervalTicks ?? 48));
  const tick = state.tick ?? 0;
  const last = state.lastEvolutionTick ?? 0;
  if (tick - last < interval) {
    return;
  }
  const rows = (world.cities ?? [])
    .map((city) => {
      ensureCityPolicyGenome(city, rng);
      const fitness = clamp(
        city.metrics.productivity * 0.36 +
          city.metrics.trust * 0.24 +
          city.metrics.safety * 0.2 +
          (1 - city.metrics.inequality) * 0.12 +
          (1 - city.metrics.instabilityRisk) * 0.08,
        0,
        1.8
      );
      city.policyGenome.fitnessEma = Number(((city.policyGenome.fitnessEma ?? fitness) * 0.82 + fitness * 0.18).toFixed(4));
      city.lifecycle = city.lifecycle ?? {};
      city.lifecycle.genomeFitness = Number(city.policyGenome.fitnessEma.toFixed(3));
      return { city, fitness: city.policyGenome.fitnessEma };
    })
    .sort((a, b) => b.fitness - a.fitness);
  if (!rows.length) {
    state.lastEvolutionTick = tick;
    return;
  }
  const eliteCount = Math.max(1, Math.floor(rows.length * 0.3));
  const elites = rows.slice(0, eliteCount);
  const medianFitness = rows[Math.floor(rows.length / 2)]?.fitness ?? rows[0].fitness;
  const inheritBlend = clamp(config?.policyGenome?.inheritanceBlend ?? 0.72, 0.3, 0.95);
  const baseMutation = clamp(config?.policyGenome?.baseMutation ?? 0.04, 0.005, 0.2);
  for (const row of rows) {
    const city = row.city;
    if (row.fitness >= medianFitness && rng.next() > 0.35) {
      continue;
    }
    const donor = elites[Math.floor(rng.range(0, elites.length))]?.city;
    if (!donor || donor.id === city.id) {
      continue;
    }
    const mutationScale = baseMutation * (0.65 + (city.policyGenome.mutationRate ?? 0.5) * 0.9);
    blendGenome(city.policyGenome, donor.policyGenome, inheritBlend, mutationScale, rng);
  }
  state.lastEvolutionTick = tick;
}

function blendGenome(target, donor, blend, mutationScale, rng) {
  const keys = ["safetyFocus", "welfareFocus", "educationFocus", "greenAffinity", "growthAffinity", "explorationBias", "mutationRate"];
  for (const key of keys) {
    const base = clamp((target?.[key] ?? 0.5) * (1 - blend) + (donor?.[key] ?? 0.5) * blend, 0, 1);
    const mut = rng.range(-mutationScale, mutationScale);
    const min = key === "mutationRate" ? 0.05 : 0;
    target[key] = clamp(base + mut, min, 1);
  }
}

function updateResourcePolicyLearning(world, cityId, action, outcome, config) {
  const row = ensureCityResourcePolicy(world, cityId);
  const alpha = clamp(config?.rl?.alpha ?? 0.12, 0.01, 0.5);
  const reward = clamp(
    1 - (outcome.resourceStress ?? 0) * 0.9 + (outcome.productivityDelta ?? 0) * 18 - (outcome.costDelta ?? 0) * 9 - (outcome.instabilityDelta ?? 0) * 12,
    -1,
    2
  );
  const prev = row.qByAction[action] ?? 0.5;
  row.qByAction[action] = Number((prev + alpha * (reward - prev)).toFixed(6));
  row.nByAction[action] = (row.nByAction[action] ?? 0) + 1;
}

function ensureCityResourceProfile(city) {
  city.resources = city.resources ?? {};
  const pop = Math.max(120, city.population ?? 1000);
  const fallback = {
    water: { capacity: pop * 0.22, regenRate: 1, extractionRate: 1 },
    food: { capacity: pop * 0.2, regenRate: 0.95, extractionRate: 1 },
    energy_fossil: { capacity: pop * 0.16, regenRate: 0.04, extractionRate: 1 },
    energy_renewable: { capacity: pop * 0.18, regenRate: 1.1, extractionRate: 0.9 },
    metals_bulk: { capacity: pop * 0.15, regenRate: 0.06, extractionRate: 1 },
    rare_minerals: { capacity: pop * 0.06, regenRate: 0.02, extractionRate: 1 },
    human: { capacity: pop * 1.4, regenRate: 0.32, extractionRate: 1, quality: 0.58 }
  };
  for (const key of RESOURCE_KEYS) {
    const cur = city.resources[key] ?? {};
    const cap = Math.max(1, cur.capacity ?? fallback[key].capacity);
    city.resources[key] = {
      stock: Number.isFinite(cur.stock) ? cur.stock : cap * 0.62,
      capacity: cap,
      regenRate: Number.isFinite(cur.regenRate) ? cur.regenRate : fallback[key].regenRate,
      extractionRate: Number.isFinite(cur.extractionRate) ? cur.extractionRate : fallback[key].extractionRate,
      quality: key === "human" ? clamp(cur.quality ?? fallback[key].quality, 0.15, 0.99) : undefined
    };
  }
}

function applyCityResourceCycle({ city, popNow, stats, resourceState, resourcePolicy, config, rng }) {
  const cfg = config.resources ?? {};
  const extractionBase = cfg.extractionBase ?? 0.018;
  const regenBase = cfg.regenBase ?? 0.011;
  const prices = resourceState?.prices ?? {};
  const demand = buildResourceDemand(city, popNow);
  const policy = resourcePolicy ?? { action: "balanced", extractionMult: 1, renewableBoost: 1, demandMult: 1 };
  const climate = city.metrics?.congestion ?? 0.4;
  let scarcitySum = 0;
  let abundanceSum = 0;
  let pricePressure = 0;
  let shortages = 0;
  let surpluses = 0;

  city.resourceTick = city.resourceTick ?? {};

  for (const key of RESOURCE_KEYS) {
    const node = city.resources[key];
    const cap = Math.max(1, node.capacity ?? 1);
    const stock = clamp(node.stock ?? cap * 0.6, 0, cap);
    const extractionFactor = city.cityType === "workHub" ? 1.1 : city.cityType === "mixed" ? 1 : 0.9;
    let extraction = Math.min(stock, cap * extractionBase * (node.extractionRate ?? 1) * extractionFactor * policy.extractionMult);
    if (key === "energy_fossil" && policy.action === "green_shift") {
      extraction *= 0.72;
    }
    const climatePenalty = key === "water" || key === "food" || key === "energy_renewable" ? climate * 0.22 : climate * 0.05;
    let regen = cap * regenBase * (node.regenRate ?? 1) * Math.max(0.08, 1 - climatePenalty);
    if (key === "energy_renewable") {
      regen *= policy.renewableBoost;
    }
    const targetDemand = Math.max(0, (demand[key] ?? 0) * policy.demandMult);
    const shortage = Math.max(0, targetDemand - extraction);
    const surplus = Math.max(0, extraction - targetDemand);
    const nextStock = clamp(stock - extraction + regen, 0, cap);
    const scarcity = clamp(shortage / Math.max(1, targetDemand), 0, 1.5);
    const abundance = clamp(surplus / Math.max(1, targetDemand), 0, 1.5);
    const localPressure = (prices[key] ?? 1) * scarcity;

    node.stock = nextStock;
    if (key === "human") {
      const learning = city.metrics.productivity * 0.004 + city.metrics.trust * 0.003;
      const burnout = city.metrics.congestion * 0.003 + city.metrics.inequality * 0.002;
      node.quality = clamp((node.quality ?? 0.56) + learning - burnout + rng.range(-0.002, 0.002), 0.15, 0.99);
      node.stock = clamp(city.population + (stats.net ?? 0), 0, cap);
    }

    city.resourceTick[key] = {
      stock: Number(nextStock.toFixed(2)),
      capacity: Number(cap.toFixed(2)),
      extraction: Number(extraction.toFixed(2)),
      demand: Number(targetDemand.toFixed(2)),
      shortage: Number(shortage.toFixed(2)),
      scarcity: Number(scarcity.toFixed(3))
    };
    scarcitySum += scarcity;
    abundanceSum += abundance;
    pricePressure += localPressure;
    if (shortage > 0) {
      shortages += 1;
    }
    if (surplus > 0) {
      surpluses += 1;
    }
  }

  const avgScarcity = scarcitySum / RESOURCE_KEYS.length;
  const avgAbundance = abundanceSum / RESOURCE_KEYS.length;
  const avgPressure = pricePressure / RESOURCE_KEYS.length;
  const humanQuality = city.resources.human?.quality ?? 0.55;
  const productivityDelta = -avgScarcity * 0.024 + avgAbundance * 0.011 + (humanQuality - 0.5) * 0.018;
  const costDelta = avgPressure * 0.012 + Math.max(0, avgScarcity - 0.35) * 0.012;
  const trustDelta = -avgScarcity * 0.008 + avgAbundance * 0.006;
  const safetyDelta = -Math.max(0, avgScarcity - 0.25) * 0.012;
  const instabilityDelta = avgScarcity * 0.016 + (shortages > 3 ? 0.01 : 0) - (surpluses > 4 ? 0.006 : 0);

  return {
    productivityDelta,
    costDelta,
    trustDelta,
    safetyDelta,
    instabilityDelta,
    resourceStress: avgScarcity,
    resourceAbundance: avgAbundance
  };
}

function buildResourceDemand(city, popNow) {
  const popScale = Math.max(120, city.population ?? popNow ?? 0);
  const activeScale = Math.max(popScale * 0.15, popNow);
  const urban = city.cityType === "workHub" ? 1.12 : city.cityType === "mixed" ? 1 : 0.92;
  return {
    water: popScale * 0.0022 * urban,
    food: popScale * 0.002 * urban,
    energy_fossil: activeScale * 0.0014 * (urban + city.metrics.productivity * 0.15),
    energy_renewable: activeScale * 0.00125 * (1.35 - city.metrics.inequality * 0.25),
    metals_bulk: activeScale * 0.001 * (urban + city.metrics.productivity * 0.12),
    rare_minerals: activeScale * 0.0005 * (urban + city.metrics.productivity * 0.2),
    human: popScale * 0.24 * (0.86 + city.metrics.productivity * 0.08)
  };
}

function updateGlobalResourceMarket(world, config, rng) {
  const prices = world.systemState.resources.prices;
  const sensitivity = config.resources?.marketSensitivity ?? 0.2;
  let globalScarcitySum = 0;

  for (const key of RESOURCE_KEYS) {
    let stock = 0;
    let capacity = 0;
    let extraction = 0;
    let demand = 0;
    for (const city of world.cities) {
      const node = city.resources?.[key];
      if (!node) {
        continue;
      }
      stock += Math.max(0, node.stock ?? 0);
      capacity += Math.max(1, node.capacity ?? 1);
      extraction += Math.max(0, city.resourceTick?.[key]?.extraction ?? 0);
      demand += Math.max(0, city.resourceTick?.[key]?.demand ?? 0);
    }
    const scarcity = clamp(1 - stock / Math.max(1, capacity), 0, 1.2);
    const demandGap = clamp((demand - extraction) / Math.max(1, demand), 0, 1.2);
    const target = clamp(0.62 + scarcity * 1.05 + demandGap * 0.75, 0.45, 3.4);
    const noise = rng.range(-0.015, 0.015);
    const prev = prices[key] ?? 1;
    prices[key] = clamp(prev * (1 - sensitivity) + target * sensitivity + noise, 0.35, 3.6);
    globalScarcitySum += scarcity;
  }

  world.systemState.resources.globalScarcity = Number((globalScarcitySum / RESOURCE_KEYS.length).toFixed(3));
}

function averageReligionDiversity(religionByCity) {
  const rows = Object.values(religionByCity);
  if (rows.length === 0) {
    return 0.3;
  }
  let sum = 0;
  for (const cityRows of rows) {
    const shares = (cityRows || []).map((r) => (r.share ?? 0) / 100).filter((x) => x > 0);
    const hhi = shares.reduce((s, p) => s + p * p, 0);
    sum += 1 - hhi;
  }
  return sum / rows.length;
}

function rewireTopology(world, rng) {
  if (world.cities.length < 2) {
    return;
  }
  if (rng.next() < 0.09) {
    const candidates = world.cities
      .filter((c) => c.lifecycle?.status !== "collapsed")
      .slice()
      .sort((a, b) => (b.metrics.productivity + b.metrics.trust) - (a.metrics.productivity + a.metrics.trust));
    if (candidates.length >= 2) {
      const a = candidates[0];
      const b = candidates[1];
      world.addEdge({
        id: `E${Date.now()}${Math.floor(rng.range(10, 99))}`,
        fromCityId: a.id,
        toCityId: b.id,
        connectivity: clamp((a.metrics.productivity + b.metrics.productivity) * 0.5, 0.35, 0.95),
        gatewayRestriction: "open"
      });
    }
  }

  const removable = world.edges.filter((e) => e.gatewayRestriction === "sealed" || e.connectivity < 0.28);
  if (removable.length > 0 && rng.next() < 0.06) {
    const edge = removable[Math.floor(rng.range(0, removable.length))];
    world.removeEdge(edge.id);
  }
}

function evolveCityNodes(world, frame, rng, config = {}) {
  const presence = frame.people.cityPresence || {};
  const cityStats = frame.people.demographics?.cityStats || [];
  const statByCity = new Map(cityStats.map((s) => [s.cityId, s]));
  const dyn = config.urbanDynamics ?? {};
  const pressureThreshold = dyn.genesisPressureThreshold ?? 0.64;
  const capacityThreshold = dyn.genesisCapacityThreshold ?? 0.56;
  const pressureStreakNeed = dyn.genesisPressureStreak ?? 4;
  const cooldownTicks = dyn.genesisCooldownTicks ?? 14;

  world.systemState = world.systemState ?? {};
  world.systemState.urbanGenesisCooldown = Math.max(0, (world.systemState.urbanGenesisCooldown ?? 0) - 1);

  const activeCities = world.cities.filter((c) => c.lifecycle?.status !== "collapsed");

  const pressureRanks = activeCities
    .map((city) => {
      city.lifecycle = city.lifecycle ?? {};
      const observed = presence[city.id] ?? 0;
      const stats = statByCity.get(city.id) ?? { net: 0 };
      const pushPressure = clamp(
        city.metrics.congestion * 0.32 +
          city.metrics.costOfLiving * 0.12 +
          city.metrics.inequality * 0.22 +
          city.metrics.instabilityRisk * 0.18 +
          (stats.net < 0 ? 0.08 : 0),
        0,
        1.6
      );
      const organizationCapacity = clamp(
        (city.metrics.trust * 0.32 + city.metrics.productivity * 0.28 + city.metrics.employmentCapacity * 0.2 + (observed / Math.max(1, city.population)) * 0.2),
        0,
        1.8
      );
      city.lifecycle.pushPressure = (city.lifecycle.pushPressure ?? pushPressure) * 0.74 + pushPressure * 0.26;
      city.lifecycle.orgCapacity = (city.lifecycle.orgCapacity ?? organizationCapacity) * 0.72 + organizationCapacity * 0.28;
      if (city.lifecycle.pushPressure > pressureThreshold && city.lifecycle.orgCapacity > capacityThreshold) {
        city.lifecycle.genesisPressureStreak = (city.lifecycle.genesisPressureStreak ?? 0) + 1;
      } else {
        city.lifecycle.genesisPressureStreak = Math.max(0, (city.lifecycle.genesisPressureStreak ?? 0) - 1);
      }
      return { city, pushPressure: city.lifecycle.pushPressure, organizationCapacity: city.lifecycle.orgCapacity, observed };
    })
    .sort((a, b) => b.pushPressure + b.organizationCapacity - (a.pushPressure + a.organizationCapacity));

  const candidate = pressureRanks.find(
    (row) =>
      row.city.lifecycle?.genesisPressureStreak >= pressureStreakNeed &&
      row.observed > 24 &&
      row.city.lifecycle?.status !== "collapsed"
  );

  if (candidate && world.systemState.urbanGenesisCooldown <= 0) {
    const parent = candidate.city;
    const plan = pickSettlementSite(parent, world, rng);
    const macroPenalty =
      (world.systemState?.epidemicLevel ?? 0) * 0.26 + (world.systemState?.climateStress ?? 0) * 0.22;
    const viability = clamp(
      candidate.organizationCapacity * 0.42 + plan.pullScore * 0.4 + (world.systemState?.marketIndex ?? 1) * 0.12 - macroPenalty,
      0,
      1.8
    );
    const failureRisk = clamp(0.42 - viability * 0.32 + macroPenalty * 0.22, 0.04, 0.52);

    if (rng.next() < failureRisk) {
      parent.lifecycle.genesisPressureStreak = Math.max(0, (parent.lifecycle.genesisPressureStreak ?? 0) - 2);
      world.systemState.urbanGenesisCooldown = Math.max(3, Math.floor(cooldownTicks * 0.4));
    } else {
    const idx = world.cities.length + 1;
    const seedPopulation = Math.max(
      280,
      Math.floor(parent.population * clamp(0.06 + candidate.organizationCapacity * 0.06, 0.06, 0.16))
    );
    const city = {
      id: `C${idx}`,
      name: `${parent.name}-N${idx}`,
      nationId: parent.nationId,
      layerId: parent.layerId,
      cityType: viability > 0.82 ? "mixed" : "residential",
      geo: {
        lat: plan.geo.lat,
        lon: plan.geo.lon
      },
      population: seedPopulation,
      metrics: {
        productivity: clamp(parent.metrics.productivity * (0.72 + plan.pullScore * 0.2) + rng.range(-0.03, 0.06), 0.3, 1.85),
        wageLevel: clamp(parent.metrics.wageLevel * 0.84 + rng.range(-0.04, 0.04), 0.26, 2.1),
        costOfLiving: clamp(parent.metrics.costOfLiving * 0.78 + rng.range(-0.03, 0.02), 0.2, 2.2),
        inequality: clamp(parent.metrics.inequality * 0.7 + rng.range(-0.03, 0.04), 0.05, 0.95),
        trust: clamp(parent.metrics.trust * 0.88 + plan.pullScore * 0.08, 0.05, 0.95),
        safety: clamp(parent.metrics.safety * 0.86 + plan.pullScore * 0.09, 0.05, 0.95),
        congestion: clamp(parent.metrics.congestion * 0.62 + rng.range(-0.02, 0.03), 0.02, 0.95),
        employmentCapacity: clamp(parent.metrics.employmentCapacity * 0.82 + plan.pullScore * 0.1, 0.2, 0.98),
        instabilityRisk: clamp(parent.metrics.instabilityRisk * 0.72 + (1 - plan.pullScore) * 0.08, 0.01, 0.99)
      },
      resources: deriveSpawnCityResources(parent, seedPopulation, rng),
      lifecycle: {
        riseScore: clamp(0.42 + plan.pullScore * 0.25, 0, 1),
        declineScore: clamp(0.18 + (1 - viability) * 0.18, 0, 1),
        status: viability > 0.78 ? "rising" : "stable",
        genesisPressureStreak: 0,
        genesisSourceId: parent.id
      }
    };
    world.addCity(city);
    world.addEdge({
      id: `E${Date.now()}${Math.floor(rng.range(100, 999))}`,
      fromCityId: parent.id,
      toCityId: city.id,
      connectivity: clamp(parent.metrics.productivity * 0.6, 0.35, 0.9),
      gatewayRestriction: "open"
    });
      if (plan.linkCityId && world.getCityById(plan.linkCityId)) {
        world.addEdge({
          id: `E${Date.now()}${Math.floor(rng.range(1000, 9999))}`,
          fromCityId: plan.linkCityId,
          toCityId: city.id,
          connectivity: clamp(0.45 + plan.pullScore * 0.4, 0.3, 0.92),
          gatewayRestriction: "open"
        });
      }
      parent.population = Math.max(120, Math.floor(parent.population * (0.93 - candidate.organizationCapacity * 0.05)));
      parent.lifecycle.genesisPressureStreak = Math.max(0, (parent.lifecycle.genesisPressureStreak ?? 0) - 3);
      world.systemState.urbanGenesisCooldown = cooldownTicks;
    }
  }

  for (const city of world.cities) {
    if (city.lifecycle?.status === "collapsed") {
      continue;
    }
    const observed = presence[city.id] ?? 0;
    const collapseSignal = city.lifecycle?.declineScore > 0.9 && city.population < 280 && observed < 5;
    if (collapseSignal && rng.next() < 0.22) {
      city.lifecycle.status = "collapsed";
      city.cityType = "residential";
      city.metrics.productivity = clamp(city.metrics.productivity * 0.65, 0.25, 1.2);
      city.metrics.trust = clamp(city.metrics.trust * 0.7, 0.05, 0.95);
      city.metrics.safety = clamp(city.metrics.safety * 0.72, 0.05, 0.95);
      for (const edge of world.edges) {
        if (edge.fromCityId === city.id || edge.toCityId === city.id) {
          edge.gatewayRestriction = "sealed";
          edge.connectivity = clamp(edge.connectivity * 0.4, 0.05, 0.8);
        }
      }
    }
  }
}

function pickSettlementSite(parent, world, rng) {
  const activeCities = world.cities.filter((c) => c.id !== parent.id && c.lifecycle?.status !== "collapsed");
  const linkCity = activeCities.length > 0
    ? activeCities.slice().sort((a, b) => {
      const ad = geoDistance(parent.geo, a.geo);
      const bd = geoDistance(parent.geo, b.geo);
      return ad - bd;
    })[0]
    : null;

  const lonShift = rng.range(-18, 18);
  const latShift = rng.range(-10, 10);
  const geo = {
    lat: clamp(parent.geo.lat + latShift, -70, 70),
    lon: normalizeLon(parent.geo.lon + lonShift)
  };

  const distPenalty = linkCity ? Math.min(0.28, geoDistance(geo, linkCity.geo) * 0.0028) : 0.1;
  const market = world.systemState?.marketIndex ?? 1;
  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const climate = world.systemState?.climateStress ?? 0;
  const pullScore = clamp(
    parent.metrics.productivity * 0.22 +
      parent.metrics.trust * 0.2 +
      (2.2 - parent.metrics.costOfLiving) * 0.14 +
      market * 0.16 -
      epidemic * 0.18 -
      climate * 0.16 -
      distPenalty,
    0.18,
    1.2
  );

  return {
    geo,
    pullScore,
    linkCityId: linkCity?.id ?? null
  };
}

function geoDistance(a, b) {
  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;
  return Math.hypot(dLat, dLon);
}

function normalizeLon(lon) {
  let value = lon;
  while (value > 180) {
    value -= 360;
  }
  while (value < -180) {
    value += 360;
  }
  return value;
}

function deriveSpawnCityResources(parent, population, rng) {
  const out = {};
  for (const key of RESOURCE_KEYS) {
    const p = parent.resources?.[key];
    const parentCapacity = p?.capacity ?? (key === "human" ? population * 1.5 : population * 0.18);
    const cap =
      key === "human"
        ? Math.max(population, parentCapacity * rng.range(0.68, 0.92))
        : Math.max(20, parentCapacity * rng.range(0.26, 0.42));
    out[key] = {
      stock: key === "human" ? population : cap * rng.range(0.48, 0.72),
      capacity: cap,
      regenRate: p?.regenRate ?? (key === "human" ? 0.32 : 0.9),
      extractionRate: p?.extractionRate ?? 1,
      quality: key === "human" ? clamp((p?.quality ?? 0.56) + rng.range(-0.06, 0.06), 0.15, 0.98) : undefined
    };
  }
  return out;
}
