function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function updateSphereDynamics({ world, people, config, rng, day, phase }) {
  if (!(config?.spheres?.enabled ?? true)) {
    return {
      events: [],
      metrics: null
    };
  }
  ensureSphereStructures(world, config, rng);
  ensurePeopleSphereState(people, world.spheres, rng);
  maybeCreateSphereEvents({ world, config, rng, day, phase });
  decayAndApplySphereEvents(world);
  evolveCitySphereProjection(world);
  const cityTrustDelta = applySphereExposureToPeople({ world, people });
  const metrics = computeSphereMetrics(world, cityTrustDelta);
  world.systemState.sphereMetrics = metrics;
  return {
    events: (world.systemState.sphereEvents?.active ?? []).map((e) => ({
      type: e.type,
      sphereId: e.sphereId ?? null,
      sphereA: e.sphereA ?? null,
      sphereB: e.sphereB ?? null,
      ttl: e.ttl
    })),
    metrics
  };
}

function ensureSphereStructures(world, config, rng) {
  world.spheres = Array.isArray(world.spheres) && world.spheres.length ? world.spheres : createConfigSpheres(config);
  world.citySphereState = world.citySphereState ?? {};
  world.communities = world.communities ?? [];
  world.institutions = world.institutions ?? [];
  world.systemState = world.systemState ?? {};
  world.systemState.sphereEvents = world.systemState.sphereEvents ?? {
    active: [],
    history: [],
    lastUpdateDay: -1
  };
  world.systemState.crossSphereSplit = world.systemState.crossSphereSplit ?? {};

  for (const city of world.cities ?? []) {
    const cityRow = (world.citySphereState[city.id] = world.citySphereState[city.id] ?? {});
    for (const sphere of world.spheres) {
      cityRow[sphere.id] = cityRow[sphere.id] ?? {
        rumorRate: Number(rng.range(0.08, 0.42).toFixed(4)),
        trustDecay: Number(rng.range(0.04, 0.24).toFixed(4)),
        feedMix: Number(rng.range(0.42, 0.74).toFixed(4)),
        localNarrativeBias: Number(rng.range(0.2, 0.52).toFixed(4))
      };
    }
  }
}

function createConfigSpheres(config) {
  const defaults = config?.spheres?.defaults ?? [];
  return defaults.map((s, i) => ({
    id: s.id ?? `S${i + 1}`,
    name: s.name ?? `Sphere ${i + 1}`,
    nestLevel: Number.isFinite(s.nestLevel) ? s.nestLevel : i,
    rankingPolicy: s.rankingPolicy ?? "neutral",
    moderationStrength: clamp(s.moderationStrength ?? 0.45, 0, 1),
    shareFriction: clamp(s.shareFriction ?? 0.2, 0, 1),
    botPressure: clamp(s.botPressure ?? 0.1, 0, 1),
    credibilityWeight: clamp(s.credibilityWeight ?? 0.5, 0, 1),
    crossSphereFriction: clamp(s.crossSphereFriction ?? 0.2, 0, 1)
  }));
}

function ensurePeopleSphereState(people, spheres, rng) {
  for (const person of people ?? []) {
    person.sphereAffinities = normalizeAffinities(person.sphereAffinities, spheres, rng);
    person.beliefVector = person.beliefVector ?? {
      orderOrientation: rng.range(0.25, 0.75),
      antiEstablishment: rng.range(0.2, 0.75),
      conspiracyResistance: rng.range(0.25, 0.78)
    };
    person.attentionBudget = clamp(person.attentionBudget ?? rng.range(0.45, 0.95), 0, 1);
    person.influence = clamp(person.influence ?? rng.range(0.02, 0.32), 0, 1);
    person.trustGraph = person.trustGraph ?? {
      person: rng.range(0.35, 0.74),
      community: rng.range(0.3, 0.78),
      media: rng.range(0.25, 0.72),
      institution: rng.range(0.28, 0.75)
    };
    person.homeCityUid = person.homeCityUid ?? person.homeCityId;
  }
}

function normalizeAffinities(raw, spheres, rng) {
  const sphereIds = (spheres ?? []).map((s) => s.id);
  const out = {};
  let sum = 0;
  for (const sphereId of sphereIds) {
    const seed = Number.isFinite(raw?.[sphereId]) ? raw[sphereId] : rng.range(0.1, 0.9);
    const v = clamp(seed, 0, 1);
    out[sphereId] = v;
    sum += v;
  }
  if (sum <= 0.0001) {
    const n = Math.max(1, sphereIds.length);
    for (const sphereId of sphereIds) {
      out[sphereId] = Number((1 / n).toFixed(6));
    }
    return out;
  }
  for (const sphereId of sphereIds) {
    out[sphereId] = Number((out[sphereId] / sum).toFixed(6));
  }
  return out;
}

function maybeCreateSphereEvents({ world, config, rng, day, phase }) {
  const eventsState = world.systemState.sphereEvents;
  if (phase !== "Night" || eventsState.lastUpdateDay === day) {
    return;
  }
  eventsState.lastUpdateDay = day;
  const active = eventsState.active ?? [];
  const rates = config?.spheres?.eventRates ?? {};
  const sphereIds = (world.spheres ?? []).map((s) => s.id);
  if (!sphereIds.length) {
    return;
  }

  if (rng.next() < clamp(rates.sphereSplitDaily ?? 0.06, 0, 1) && sphereIds.length > 1) {
    const a = sphereIds[Math.floor(rng.range(0, sphereIds.length))];
    let b = sphereIds[Math.floor(rng.range(0, sphereIds.length))];
    if (a === b) {
      b = sphereIds[(sphereIds.indexOf(a) + 1) % sphereIds.length];
    }
    active.push({
      type: "sphereSplit",
      sphereA: a,
      sphereB: b,
      ttl: Math.max(1, Math.floor(config?.spheres?.eventTtlTicks?.sphereSplit ?? 72))
    });
  }
  if (rng.next() < clamp(rates.trustShockDaily ?? 0.08, 0, 1)) {
    const sid = pickMostFragileSphere(world, sphereIds, rng);
    active.push({
      type: "trustShock",
      sphereId: sid,
      ttl: Math.max(1, Math.floor(config?.spheres?.eventTtlTicks?.trustShock ?? 48))
    });
  }
  if (rng.next() < clamp(rates.mobilizationDaily ?? 0.1, 0, 1)) {
    const sid = sphereIds[Math.floor(rng.range(0, sphereIds.length))];
    active.push({
      type: "mobilization",
      sphereId: sid,
      ttl: Math.max(1, Math.floor(config?.spheres?.eventTtlTicks?.mobilization ?? 56))
    });
  }
  eventsState.active = active.slice(-24);
}

function pickMostFragileSphere(world, sphereIds, rng) {
  const score = new Map(sphereIds.map((id) => [id, 0]));
  for (const city of world.cities ?? []) {
    const row = world.citySphereState?.[city.id] ?? {};
    for (const sid of sphereIds) {
      const s = row[sid] ?? {};
      const fragility = (s.rumorRate ?? 0.2) * 0.55 + (s.trustDecay ?? 0.1) * 0.45;
      score.set(sid, (score.get(sid) ?? 0) + fragility);
    }
  }
  let best = sphereIds[0];
  let bestValue = -Infinity;
  for (const sid of sphereIds) {
    const v = (score.get(sid) ?? 0) + rng.range(-0.03, 0.03);
    if (v > bestValue) {
      bestValue = v;
      best = sid;
    }
  }
  return best;
}

function decayAndApplySphereEvents(world) {
  const eventsState = world.systemState.sphereEvents;
  const splits = (world.systemState.crossSphereSplit = world.systemState.crossSphereSplit ?? {});
  for (const key of Object.keys(splits)) {
    splits[key] = Math.max(0, (splits[key] ?? 0) - 1);
    if (splits[key] <= 0) {
      delete splits[key];
    }
  }
  const kept = [];
  for (const ev of eventsState.active ?? []) {
    if (!ev || !Number.isFinite(ev.ttl) || ev.ttl <= 0) {
      continue;
    }
    ev.ttl -= 1;
    if (ev.type === "sphereSplit" && ev.sphereA && ev.sphereB) {
      splits[pairKey(ev.sphereA, ev.sphereB)] = Math.max(splits[pairKey(ev.sphereA, ev.sphereB)] ?? 0, ev.ttl);
    }
    if (ev.ttl > 0) {
      kept.push(ev);
    }
  }
  eventsState.active = kept;
  eventsState.history = [...(eventsState.history ?? []), ...kept.map((e) => ({ ...e }))].slice(-120);
}

function evolveCitySphereProjection(world) {
  const activeEvents = world.systemState.sphereEvents?.active ?? [];
  const eventsBySphere = new Map();
  for (const ev of activeEvents) {
    if (ev.sphereId) {
      const row = eventsBySphere.get(ev.sphereId) ?? { trustShock: 0, mobilization: 0 };
      if (ev.type === "trustShock") {
        row.trustShock += 1;
      } else if (ev.type === "mobilization") {
        row.mobilization += 1;
      }
      eventsBySphere.set(ev.sphereId, row);
    }
  }
  for (const city of world.cities ?? []) {
    const cityRow = world.citySphereState?.[city.id] ?? {};
    for (const sphere of world.spheres ?? []) {
      const state = cityRow[sphere.id];
      if (!state) {
        continue;
      }
      const pressure =
        clamp(city.metrics?.instabilityRisk ?? 0.2, 0, 1) * 0.35 +
        clamp(city.metrics?.inequality ?? 0.4, 0, 1) * 0.25 +
        (1 - clamp(city.metrics?.trust ?? 0.5, 0, 1)) * 0.2 +
        clamp(sphere.botPressure ?? 0.1, 0, 1) * 0.2;
      const eventRow = eventsBySphere.get(sphere.id) ?? { trustShock: 0, mobilization: 0 };
      state.rumorRate = Number(clamp(state.rumorRate * 0.9 + pressure * 0.1 + eventRow.mobilization * 0.02, 0, 1).toFixed(6));
      state.trustDecay = Number(
        clamp(state.trustDecay * 0.88 + (1 - (sphere.credibilityWeight ?? 0.5)) * 0.06 + eventRow.trustShock * 0.04, 0, 1).toFixed(6)
      );
      state.feedMix = Number(
        clamp(state.feedMix * 0.92 + (1 - (sphere.shareFriction ?? 0.2)) * 0.06 - eventRow.mobilization * 0.015, 0, 1).toFixed(6)
      );
      state.localNarrativeBias = Number(clamp(state.localNarrativeBias * 0.9 + pressure * 0.08 + eventRow.mobilization * 0.03, 0, 1).toFixed(6));
    }
  }
}

function applySphereExposureToPeople({ world, people }) {
  const cityAgg = new Map((world.cities ?? []).map((c) => [c.id, { trustDelta: 0, n: 0 }]));
  for (const person of people ?? []) {
    const cityId = person.currentCityId ?? person.homeCityId;
    const row = world.citySphereState?.[cityId];
    if (!row) {
      continue;
    }
    let rumor = 0;
    let trustDecay = 0;
    let narrativeBias = 0;
    for (const sphere of world.spheres ?? []) {
      const w = clamp(person.sphereAffinities?.[sphere.id] ?? 0, 0, 1);
      const s = row[sphere.id];
      if (!s) {
        continue;
      }
      rumor += w * (s.rumorRate ?? 0);
      trustDecay += w * (s.trustDecay ?? 0);
      narrativeBias += w * (s.localNarrativeBias ?? 0);
    }
    const focus = clamp(person.attentionBudget ?? 0.6, 0, 1);
    const signal = clamp(rumor * 0.45 + trustDecay * 0.35 + narrativeBias * 0.2, 0, 1.4) * focus;
    person.beliefVector.orderOrientation = clamp((person.beliefVector.orderOrientation ?? 0.5) * 0.985 + (1 - signal) * 0.015, 0, 1);
    person.beliefVector.antiEstablishment = clamp((person.beliefVector.antiEstablishment ?? 0.5) * 0.985 + signal * 0.02, 0, 1);
    person.beliefVector.conspiracyResistance = clamp((person.beliefVector.conspiracyResistance ?? 0.5) * 0.988 - rumor * 0.012, 0, 1);
    person.trustGraph.media = clamp((person.trustGraph.media ?? 0.5) * 0.985 - trustDecay * 0.014 + (1 - rumor) * 0.004, 0, 1);
    person.trustGraph.institution = clamp((person.trustGraph.institution ?? 0.5) * 0.986 - signal * 0.01 + (person.beliefVector.orderOrientation ?? 0.5) * 0.006, 0, 1);
    const cityRow = cityAgg.get(cityId);
    if (cityRow) {
      cityRow.trustDelta += signal * 0.0025;
      cityRow.n += 1;
    }
  }
  for (const [cityId, row] of cityAgg.entries()) {
    if (row.n <= 0) {
      continue;
    }
    const city = world.getCityById(cityId);
    if (!city) {
      continue;
    }
    const delta = row.trustDelta / row.n;
    city.metrics.trust = clamp((city.metrics?.trust ?? 0.5) - delta, 0.02, 0.99);
    city.metrics.instabilityRisk = clamp((city.metrics?.instabilityRisk ?? 0.2) + delta * 0.8, 0.01, 0.99);
  }
  return cityAgg;
}

function computeSphereMetrics(world, cityTrustDelta) {
  const cityCount = Math.max(1, world.cities?.length ?? 0);
  let rumorSum = 0;
  let trustDecaySum = 0;
  let n = 0;
  for (const city of world.cities ?? []) {
    const row = world.citySphereState?.[city.id] ?? {};
    for (const sphere of world.spheres ?? []) {
      const s = row[sphere.id];
      if (!s) {
        continue;
      }
      rumorSum += s.rumorRate ?? 0;
      trustDecaySum += s.trustDecay ?? 0;
      n += 1;
    }
  }
  const activeEvents = world.systemState.sphereEvents?.active ?? [];
  return {
    sphereCount: world.spheres?.length ?? 0,
    activeEvents: activeEvents.length,
    meanRumorRate: Number(((rumorSum / Math.max(1, n)) || 0).toFixed(4)),
    meanTrustDecay: Number(((trustDecaySum / Math.max(1, n)) || 0).toFixed(4)),
    cityTrustImpact: Number(
      (
        Array.from(cityTrustDelta.values()).reduce((s, x) => s + (x.n > 0 ? x.trustDelta / x.n : 0), 0) / cityCount
      ).toFixed(6)
    ),
    splitPairs: Object.keys(world.systemState.crossSphereSplit ?? {}).length
  };
}
