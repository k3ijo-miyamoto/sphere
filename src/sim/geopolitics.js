function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function band3(value, low, high) {
  if (value < low) {
    return 0;
  }
  if (value > high) {
    return 2;
  }
  return 1;
}

const DIPLOMACY_RL_ACTIONS = ["detente", "balanced", "assertive"];
const SECRET_SOCIETY_RL_ACTIONS = ["recruit", "hide", "market_infiltration", "state_infiltration", "border_disruption", "cooldown"];
const DEFAULT_BLOC_VALUES = ["mercantile", "technocratic", "communitarian", "security", "pluralist"];

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function updateGeopolitics({ world, frame, config, rng, day, phase, forceUpdate = false }) {
  if (!(config.geopolitics?.enabled ?? true)) {
    return {
      nations: [],
      relations: [],
      militaryCompanies: [],
      secretSocieties: [],
      blocs: [],
      institutionalZones: [],
      hegemonicNetworks: [],
      governanceStack: [],
      events: []
    };
  }

  const state = ensureGeopoliticsState(world);
  const events = [];
  const shouldDailyUpdate = phase === "Night" && state.lastUpdateDay !== day;
  const shouldUpdateNow = shouldDailyUpdate || forceUpdate;
  if (shouldUpdateNow) {
    attemptNationFormation({ world, frame, config, state, rng, day, events });
    updateMetaOrder({ world, frame, config, state, rng, day, events });
  }
  const nationStats = computeNationStats(world, frame);
  const relationRows = [];
  const nations = world.nations ?? [];
  const hotspot = computeGeopoliticalHotspotInputs(world, nations);
  const burst = forceUpdate ? 0.07 : 0;

  if (shouldUpdateNow) {
    if (shouldDailyUpdate) {
      state.lastUpdateDay = day;
    }
    updateCurrencyRegime(world, nationStats, rng, config, day);
    const tradeMatrix = computeTradeDependence(world);
    const valueMatrix = computeValueDistance(world);
    for (let i = 0; i < nations.length; i += 1) {
      for (let j = i + 1; j < nations.length; j += 1) {
        const a = nations[i];
        const b = nations[j];
        const key = pairKey(a.id, b.id);
        const prev = state.diplomacy[key] ?? {
          tension: 0.22,
          relation: 0.68,
          status: "peace",
          trustMemory: 0.58
        };
        const dPolicy = ensureDiplomacyPolicyState(state, key);
        const border = borderFriction(world, a.id, b.id);
        const stress = ((nationStats[a.id]?.stress ?? 0.3) + (nationStats[b.id]?.stress ?? 0.3)) * 0.5;
        const powerGap = Math.abs((nationStats[a.id]?.power ?? 0.4) - (nationStats[b.id]?.power ?? 0.4));
        const tradeDependence = tradeMatrix[key] ?? 0;
        const valueDistance = valueMatrix[key] ?? 0.45;
        const threat = sharedThreat(world, a.id, b.id);
        const market = world.systemState?.marketIndex ?? 1;
        const localShock =
          (hotspot.nationHotspot[a.id] ?? 0) * 0.08 +
          (hotspot.nationHotspot[b.id] ?? 0) * 0.08 +
          (hotspot.pairFlow[pairKey(a.id, b.id)] ?? 0) * 0.24 +
          hotspot.energyPriceShock * 0.06 +
          (hotspot.spill[a.id] ?? 0) * 0.05 +
          (hotspot.spill[b.id] ?? 0) * 0.05 +
          burst;
        const dStateKey = diplomacyStateKey(prev, { stress, tradeDependence });
        const dAction = chooseDiplomacyAction(dPolicy, dStateKey, config, rng);
        let geopoliticalDrift =
          border * 0.1 +
          stress * 0.08 +
          powerGap * 0.06 +
          valueDistance * 0.08 -
          tradeDependence * 0.14 -
          threat * 0.1 -
          prev.trustMemory * 0.09 -
          (market - 1) * 0.05 +
          localShock +
          rng.range(-0.035, 0.035);
        if (dAction === "detente") {
          geopoliticalDrift -= 0.06;
        } else if (dAction === "assertive") {
          geopoliticalDrift += 0.065;
        }
        const tension = clamp(prev.tension * 0.8 + geopoliticalDrift, 0.02, 0.99);
        const trustMemory = clamp(
          prev.trustMemory * 0.9 +
            (tradeDependence * 0.14 + threat * 0.08 - valueDistance * 0.08 - border * 0.05 - stress * 0.05),
          0,
          1
        );
        let status = prev.status;
        const warThreshold = config.geopolitics?.warThreshold ?? 0.78;
        const crisisThreshold = config.geopolitics?.crisisThreshold ?? 0.58;
        const allianceThreshold = config.geopolitics?.allianceThreshold ?? 0.24;
        if (status === "war") {
          if (tension < crisisThreshold - 0.08 && rng.next() < 0.35) {
            status = "crisis";
            events.push({ type: "ceasefire", text: `${a.name} と ${b.name} が停戦` });
          }
        } else if (tension > warThreshold && valueDistance > 0.35 && rng.next() < 0.22) {
          status = "war";
          events.push({ type: "war", text: `${a.name} と ${b.name} で武力衝突` });
        } else if (tension > crisisThreshold) {
          status = "crisis";
          if (rng.next() < 0.2) {
            events.push({ type: "sanction", text: `${a.name} と ${b.name} の外交緊張が上昇` });
          }
        } else if (tension < allianceThreshold && trustMemory > 0.52 && tradeDependence > 0.18 && rng.next() < 0.24) {
          status = "alliance";
          events.push({ type: "treaty", text: `${a.name} と ${b.name} が協調協定を締結` });
        } else {
          status = "peace";
        }
        const relation = clamp(1 - tension + (status === "alliance" ? 0.16 : 0) - (status === "war" ? 0.2 : 0), 0, 1);
        state.diplomacy[key] = { tension, relation, status, trustMemory, tradeDependence, valueDistance };
        updateDiplomacyPolicyLearning(dPolicy, dAction, dStateKey, { tension, relation, status }, config, day);
      }
    }
    applyGeopoliticalFeedbackToCities(world, state, hotspot, config);
    evolveMilitaryCompanies(world, state, nationStats, rng, day, events);
    evolveSecretSocieties(world, state, nationStats, rng, day, events, config);
    applyWarTerritorialShift(world, state, nationStats, rng, events);
    applyBorderPolicyByDiplomacy(world, state.diplomacy, state, config);
    syncNationEventHistory({ world, state, events, day });
  }

  for (let i = 0; i < nations.length; i += 1) {
    for (let j = i + 1; j < nations.length; j += 1) {
      const a = nations[i];
      const b = nations[j];
      const key = pairKey(a.id, b.id);
      const rel = state.diplomacy[key] ?? { tension: 0.2, relation: 0.7, status: "peace" };
      relationRows.push({
        nationAId: a.id,
        nationBId: b.id,
        tension: Number(rel.tension.toFixed(3)),
        relation: Number(rel.relation.toFixed(3)),
        status: rel.status,
        trustMemory: Number((rel.trustMemory ?? 0.5).toFixed(3)),
        tradeDependence: Number((rel.tradeDependence ?? 0).toFixed(3)),
        valueDistance: Number((rel.valueDistance ?? 0.5).toFixed(3))
      });
    }
  }

  const nationRows = nations.map((nation) => {
    const stats = nationStats[nation.id] ?? {};
    const currency = world.systemState?.currencies ?? {};
    const row = {
      id: nation.id,
      name: nation.name,
      color: nation.color,
      capitalCityId: nation.capitalCityId,
      population: stats.population ?? 0,
      power: Number((stats.power ?? 0).toFixed(3)),
      stress: Number((stats.stress ?? 0).toFixed(3)),
      resourceStrength: Number((stats.resourceStrength ?? 0).toFixed(3)),
      humanQuality: Number((stats.humanQuality ?? 0).toFixed(3)),
      currencyCode: currency.codes?.[nation.id] ?? `${nation.id}C`,
      fxAgainstBase: Number(((currency.fxAgainstBase?.[nation.id] ?? 1)).toFixed(3)),
      inflation: Number(((currency.inflation?.[nation.id] ?? 0.012)).toFixed(3)),
      policyRate: Number(((currency.policyRate?.[nation.id] ?? 0.02)).toFixed(3))
    };
    return row;
  });

  return {
    nations: nationRows,
    relations: relationRows,
    militaryCompanies: state.militaryCompanies.slice(0, 12),
    secretSocieties: state.secretSocieties
      .slice()
      .sort((a, b) => b.influence - a.influence)
      .slice(0, 16)
      .map((row) => ({
        id: row.id,
        name: row.name,
        nationId: row.nationId,
        cityId: row.cityId,
        agenda: row.agenda,
        lastAction: row.lastAction ?? null,
        influence: Number((row.influence ?? 0).toFixed(3)),
        secrecy: Number((row.secrecy ?? 0).toFixed(3)),
        members: row.members ?? 0,
        foundedDay: row.foundedDay ?? day
      })),
    blocs: summarizeBlocs(state),
    institutionalZones: summarizeInstitutionalZones(state),
    hegemonicNetworks: summarizeHegemonicNetworks(state),
    governanceStack: [
      { order: 1, layer: "world_system", status: "active" },
      { order: 2, layer: "civilization_blocs", status: "active" },
      { order: 3, layer: "institutional_zones", status: "active" },
      { order: 4, layer: "nation_city_governance", status: "active" },
      { order: 5, layer: "hegemonic_networks", status: "active" }
    ],
    events: events.slice(0, 6),
    nationHistoryTail: (state.nationHistory ?? []).slice(-20),
    edgeRestrictionStats: state.edgeRestrictionStats ?? { open: 0, permit: 0, sealed: 0, changedThisTick: 0 }
  };
}

function ensureGeopoliticsState(world) {
  world.systemState = world.systemState ?? {};
  world.systemState.currencies = world.systemState.currencies ?? {
    baseCode: "SCU",
    codes: {},
    fxAgainstBase: {},
    inflation: {},
    policyRate: {},
    updatedDay: -1
  };
  world.systemState.currencies.codes = world.systemState.currencies.codes ?? {};
  world.systemState.currencies.fxAgainstBase = world.systemState.currencies.fxAgainstBase ?? {};
  world.systemState.currencies.inflation = world.systemState.currencies.inflation ?? {};
  world.systemState.currencies.policyRate = world.systemState.currencies.policyRate ?? {};
  world.systemState.currencies.baseCode = world.systemState.currencies.baseCode ?? "SCU";
  if (!world.systemState.geopolitics) {
    world.systemState.geopolitics = {
      diplomacy: {},
      diplomacyPolicies: {},
      edgeShockById: {},
      edgeShockPairValueById: {},
      militaryCompanies: [],
      secretSocieties: [],
      secretSocietyPolicies: {},
      secretSocietyAgendaPriors: {},
      archivedSecretSocietyPolicies: {},
      nextMilCompanyId: 1,
      nextSecretSocietyId: 1,
      lastUpdateDay: -1,
      blocs: [],
      blocMembership: { nation: {}, city: {} },
      institutionalZones: [],
      hegemonicNetworks: []
    };
  }
  world.systemState.geopolitics.secretSocieties = world.systemState.geopolitics.secretSocieties ?? [];
  world.systemState.geopolitics.secretSocietyPolicies = world.systemState.geopolitics.secretSocietyPolicies ?? {};
  world.systemState.geopolitics.secretSocietyAgendaPriors = world.systemState.geopolitics.secretSocietyAgendaPriors ?? {};
  world.systemState.geopolitics.archivedSecretSocietyPolicies = world.systemState.geopolitics.archivedSecretSocietyPolicies ?? {};
  world.systemState.geopolitics.diplomacyPolicies = world.systemState.geopolitics.diplomacyPolicies ?? {};
  world.systemState.geopolitics.edgeShockById = world.systemState.geopolitics.edgeShockById ?? {};
  world.systemState.geopolitics.edgeShockPairValueById = world.systemState.geopolitics.edgeShockPairValueById ?? {};
  world.systemState.geopolitics.nextSecretSocietyId = world.systemState.geopolitics.nextSecretSocietyId ?? 1;
  world.systemState.geopolitics.nationFormationLastDay = world.systemState.geopolitics.nationFormationLastDay ?? -9999;
  world.systemState.geopolitics.nationHistory = world.systemState.geopolitics.nationHistory ?? [];
  world.systemState.geopolitics.knownNationIds = world.systemState.geopolitics.knownNationIds ?? (world.nations ?? []).map((n) => n.id);
  world.systemState.geopolitics.blocs = world.systemState.geopolitics.blocs ?? [];
  world.systemState.geopolitics.blocMembership = world.systemState.geopolitics.blocMembership ?? { nation: {}, city: {} };
  world.systemState.geopolitics.blocMembership.nation = world.systemState.geopolitics.blocMembership.nation ?? {};
  world.systemState.geopolitics.blocMembership.city = world.systemState.geopolitics.blocMembership.city ?? {};
  world.systemState.geopolitics.institutionalZones = world.systemState.geopolitics.institutionalZones ?? [];
  world.systemState.geopolitics.hegemonicNetworks = world.systemState.geopolitics.hegemonicNetworks ?? [];
  for (const nation of world.nations ?? []) {
    nation.cityIds = nation.cityIds ?? [];
    if (!nation.capitalCityId || !world.getCityById(nation.capitalCityId)) {
      nation.capitalCityId = nation.cityIds[0] ?? null;
    }
    if (!world.systemState.currencies.codes[nation.id]) {
      world.systemState.currencies.codes[nation.id] = `${nation.id}C`;
    }
    if (!Number.isFinite(world.systemState.currencies.fxAgainstBase[nation.id])) {
      world.systemState.currencies.fxAgainstBase[nation.id] = 1;
    }
    if (!Number.isFinite(world.systemState.currencies.inflation[nation.id])) {
      world.systemState.currencies.inflation[nation.id] = 0.012;
    }
    if (!Number.isFinite(world.systemState.currencies.policyRate[nation.id])) {
      world.systemState.currencies.policyRate[nation.id] = 0.02;
    }
  }
  return world.systemState.geopolitics;
}

function updateMetaOrder({ world, frame, config, state, rng, day, events }) {
  if (!(config?.metaOrder?.enabled ?? true)) {
    return;
  }
  ensureBlocs({ world, state, config, rng });
  updateBlocMembership({ world, state });
  updateBlocStrength({ world, state });
  updateInstitutionalZones({ world, state, config, rng });
  updateHegemonicNetworks({ world, frame, state, config, rng, day, events });
}

function ensureBlocs({ world, state, config, rng }) {
  const target = Math.max(1, Math.floor(config?.metaOrder?.blocCount ?? 3));
  if (state.blocs.length >= target) {
    return;
  }
  const start = state.blocs.length;
  for (let i = start; i < target; i += 1) {
    const id = `B${i + 1}`;
    const valueProfile = DEFAULT_BLOC_VALUES[i % DEFAULT_BLOC_VALUES.length];
    state.blocs.push({
      id,
      name: buildBlocName(id, valueProfile),
      valueProfile,
      cohesion: Number(clamp(0.52 + rng.range(-0.08, 0.1), 0.2, 0.95).toFixed(3)),
      influence: Number(clamp(0.44 + rng.range(-0.06, 0.08), 0.2, 0.95).toFixed(3)),
      memberNationIds: [],
      memberCityIds: []
    });
  }
  state.blocs = state.blocs.slice(0, target);
}

function updateBlocMembership({ world, state }) {
  const nationMap = state.blocMembership?.nation ?? {};
  const cityMap = state.blocMembership?.city ?? {};
  const blocIds = (state.blocs ?? []).map((b) => b.id);
  if (!blocIds.length) {
    return;
  }

  for (const nation of world.nations ?? []) {
    if (!nationMap[nation.id] || !blocIds.includes(nationMap[nation.id])) {
      nationMap[nation.id] = pickBlocForNation(nation.id, blocIds);
    }
  }
  for (const city of world.cities ?? []) {
    if (!cityMap[city.id] || !blocIds.includes(cityMap[city.id])) {
      cityMap[city.id] = pickBlocForCity(city, blocIds);
    }
    if (city.nationId && nationMap[city.nationId]) {
      cityMap[city.id] = nationMap[city.nationId];
    }
  }

  const nationSet = new Set((world.nations ?? []).map((n) => n.id));
  const citySet = new Set((world.cities ?? []).map((c) => c.id));
  for (const id of Object.keys(nationMap)) {
    if (!nationSet.has(id)) {
      delete nationMap[id];
    }
  }
  for (const id of Object.keys(cityMap)) {
    if (!citySet.has(id)) {
      delete cityMap[id];
    }
  }
  state.blocMembership = { nation: nationMap, city: cityMap };
}

function updateBlocStrength({ world, state }) {
  const nationMap = state.blocMembership?.nation ?? {};
  const cityMap = state.blocMembership?.city ?? {};
  for (const bloc of state.blocs ?? []) {
    const memberNationIds = (world.nations ?? []).filter((n) => nationMap[n.id] === bloc.id).map((n) => n.id);
    const memberCityIds = (world.cities ?? []).filter((c) => cityMap[c.id] === bloc.id).map((c) => c.id);
    const cities = memberCityIds.map((id) => world.getCityById(id)).filter(Boolean);
    const avgProd =
      cities.length > 0 ? cities.reduce((sum, c) => sum + (c.metrics?.productivity ?? 0.7), 0) / cities.length : 0.55;
    const avgTrust = cities.length > 0 ? cities.reduce((sum, c) => sum + (c.metrics?.trust ?? 0.5), 0) / cities.length : 0.5;
    const cityScale = Math.min(1, memberCityIds.length / 12);
    bloc.cohesion = Number(clamp(bloc.cohesion * 0.82 + avgTrust * 0.16 + cityScale * 0.04, 0.1, 0.99).toFixed(3));
    bloc.influence = Number(clamp(bloc.influence * 0.8 + avgProd * 0.17 + cityScale * 0.08, 0.1, 1.2).toFixed(3));
    bloc.memberNationIds = memberNationIds;
    bloc.memberCityIds = memberCityIds;
  }
}

function updateInstitutionalZones({ world, state, config, rng }) {
  const drift = clamp(config?.metaOrder?.institutionalDrift ?? 0.018, 0.002, 0.08);
  const prev = new Map((state.institutionalZones ?? []).map((z) => [z.id, z]));
  const next = [];
  for (const bloc of state.blocs ?? []) {
    const id = `Z:${bloc.id}`;
    const old = prev.get(id) ?? {
      id,
      name: `${bloc.name} Protocol`,
      blocId: bloc.id,
      legalIndex: 0.56,
      educationNorm: 0.56,
      marketOpenness: 0.56
    };
    const cities = (bloc.memberCityIds ?? []).map((cityId) => world.getCityById(cityId)).filter(Boolean);
    const legalBase = cities.length ? cities.reduce((s, c) => s + (c.metrics?.safety ?? 0.5), 0) / cities.length : 0.52;
    const eduBase = cities.length ? cities.reduce((s, c) => s + (c.resources?.human?.quality ?? 0.5), 0) / cities.length : 0.5;
    const marketBase = clamp((world.systemState?.marketIndex ?? 1) / 2, 0.1, 1.2);
    next.push({
      id,
      name: old.name,
      blocId: bloc.id,
      legalIndex: Number(clamp(old.legalIndex * (1 - drift) + legalBase * drift + rng.range(-0.008, 0.008), 0.05, 1.3).toFixed(3)),
      educationNorm: Number(clamp(old.educationNorm * (1 - drift) + eduBase * drift + rng.range(-0.006, 0.006), 0.05, 1.3).toFixed(3)),
      marketOpenness: Number(clamp(old.marketOpenness * (1 - drift) + marketBase * drift + rng.range(-0.01, 0.01), 0.05, 1.4).toFixed(3)),
      memberNations: bloc.memberNationIds?.length ?? 0,
      memberCities: bloc.memberCityIds?.length ?? 0
    });
  }
  state.institutionalZones = next;
}

function updateHegemonicNetworks({ world, frame, state, config, rng, day, events }) {
  const threshold = clamp(config?.metaOrder?.hegemonyEventThreshold ?? 0.72, 0.35, 1.2);
  const topCompanies = (frame.people?.companies?.topCompanies ?? []).slice(0, 3);
  const topSocieties = (state.secretSocieties ?? []).slice().sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0)).slice(0, 3);
  const cooperation = frame.people?.institutions?.cooperationIndex ?? 0.45;
  const rows = [];

  for (const c of topCompanies) {
    const influence = Number(clamp((c.marketShare ?? 0) * 0.5 + Math.max(0, c.profit ?? 0) * 0.18 + (c.listed ? 0.15 : 0.05), 0.05, 1.5).toFixed(3));
    rows.push({
      id: `HN:C:${c.id}`,
      type: "corporate",
      actorId: c.id,
      actorName: c.name,
      scope: c.cityId ? `city:${c.cityId}` : "multi_city",
      influence
    });
  }
  for (const s of topSocieties) {
    const influence = Number(clamp((s.influence ?? 0) * 0.78 + (s.secrecy ?? 0) * 0.12 + (s.members ?? 0) / 6000, 0.05, 1.5).toFixed(3));
    rows.push({
      id: `HN:S:${s.id}`,
      type: "shadow",
      actorId: s.id,
      actorName: s.name,
      scope: s.nationId ? `nation:${s.nationId}` : "cross_border",
      influence
    });
  }
  rows.push({
    id: "HN:INSTITUTIONAL",
    type: "institutional",
    actorId: "institutional_core",
    actorName: "Institutional Core",
    scope: "system",
    influence: Number(clamp(cooperation * 0.88 + rng.range(-0.04, 0.05), 0.05, 1.5).toFixed(3))
  });

  rows.sort((a, b) => b.influence - a.influence);
  state.hegemonicNetworks = rows.slice(0, 8);
  const top = state.hegemonicNetworks[0];
  if (top && top.influence >= threshold && rng.next() < 0.25) {
    events.push({
      type: "hegemony_shift",
      text: `${top.actorName} が覇権ネットワークで主導権を拡大`
    });
  }
}

function summarizeBlocs(state) {
  return (state.blocs ?? [])
    .slice()
    .sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0))
    .map((b) => ({
      id: b.id,
      name: b.name,
      valueProfile: b.valueProfile,
      cohesion: Number((b.cohesion ?? 0).toFixed(3)),
      influence: Number((b.influence ?? 0).toFixed(3)),
      memberNations: b.memberNationIds?.length ?? 0,
      memberCities: b.memberCityIds?.length ?? 0
    }));
}

function summarizeInstitutionalZones(state) {
  return (state.institutionalZones ?? [])
    .slice()
    .sort((a, b) => (b.marketOpenness ?? 0) - (a.marketOpenness ?? 0))
    .map((z) => ({
      id: z.id,
      name: z.name,
      blocId: z.blocId,
      legalIndex: Number((z.legalIndex ?? 0).toFixed(3)),
      educationNorm: Number((z.educationNorm ?? 0).toFixed(3)),
      marketOpenness: Number((z.marketOpenness ?? 0).toFixed(3)),
      memberNations: z.memberNations ?? 0,
      memberCities: z.memberCities ?? 0
    }));
}

function summarizeHegemonicNetworks(state) {
  return (state.hegemonicNetworks ?? []).slice(0, 8).map((row) => ({
    id: row.id,
    type: row.type,
    actorId: row.actorId,
    actorName: row.actorName,
    scope: row.scope,
    influence: Number((row.influence ?? 0).toFixed(3))
  }));
}

function pickBlocForNation(nationId, blocIds) {
  return blocIds[stableHash(nationId) % blocIds.length];
}

function pickBlocForCity(city, blocIds) {
  const zoneId = city?.geoZoneId ?? city?.layerId;
  const byLayer =
    zoneId === "G1" || zoneId === "L1" ? 0
    : zoneId === "G2" || zoneId === "L2" ? 1
    : zoneId === "G3" || zoneId === "L3" ? 2
    : stableHash(city?.id ?? "city");
  return blocIds[byLayer % blocIds.length];
}

function buildBlocName(id, valueProfile) {
  const prefix = valueProfile[0]?.toUpperCase() + valueProfile.slice(1);
  return `${prefix} Bloc ${id}`;
}

function stableHash(text) {
  const str = String(text ?? "");
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function attemptNationFormation({ world, frame, config, state, rng, day, events }) {
  if (!(config.geopolitics?.nationFormationEnabled ?? true)) {
    return false;
  }
  const cooldown = Math.max(1, Math.floor(config.geopolitics?.nationFormationCooldownDays ?? 20));
  if (day - (state.nationFormationLastDay ?? -9999) < cooldown) {
    return false;
  }
  const baseChance = clamp(config.geopolitics?.nationFormationBaseChance ?? 0.06, 0.005, 0.6);
  const threshold = clamp(config.geopolitics?.nationFormationPressureThreshold ?? 0.66, 0.2, 0.98);
  const maxCities = Math.max(1, Math.floor(config.geopolitics?.nationFormationMaxCities ?? 3));
  const minRetained = Math.max(0, Math.floor(config.geopolitics?.nationFormationMinRetainedCities ?? 1));
  const presence = frame.people?.cityPresence ?? {};

  const candidates = (world.cities ?? [])
    .filter((city) => city?.lifecycle?.status !== "collapsed")
    .map((city) => {
      const pressure = cityNationFormationPressure(city, presence[city.id] ?? 0);
      return {
        city,
        pressure,
        weighted: pressure + rng.range(-0.03, 0.03)
      };
    })
    .sort((a, b) => b.weighted - a.weighted);

  for (const row of candidates.slice(0, 10)) {
    const seed = row.city;
    if (!seed || row.pressure < threshold) {
      continue;
    }
    const sourceNationId = seed.nationId ?? null;
    const sourceNation = sourceNationId ? world.getNationById(sourceNationId) : null;
    let cluster = pickNationFormationCluster({
      world,
      seedCity: seed,
      sourceNationId,
      presence,
      threshold,
      maxCities
    });
    if (cluster.length === 0) {
      continue;
    }
    if (sourceNation) {
      const sourceTotal = (sourceNation.cityIds ?? []).length;
      const movable = Math.max(0, sourceTotal - minRetained);
      if (movable <= 0) {
        continue;
      }
      if (cluster.length > movable) {
        cluster = cluster.slice(0, movable);
      }
      if (cluster.length === 0) {
        continue;
      }
    }
    const chance = clamp(baseChance + Math.max(0, row.pressure - threshold) * 0.55, baseChance, 0.52);
    if (rng.next() > chance) {
      continue;
    }
    const nationId = nextNationId(world);
    const nation = {
      id: nationId,
      name: buildEmergentNationName(seed.name, rng),
      color: randomNationColor(rng),
      cityIds: [],
      capitalCityId: null
    };
    world.addNation(nation);

    const movedCities = [];
    for (const city of cluster) {
      const moved = world.transferCityNation(city.id, nationId);
      if (moved) {
        movedCities.push(city);
      }
    }
    if (movedCities.length === 0) {
      continue;
    }
    nation.capitalCityId = movedCities[0].id;
    state.nationFormationLastDay = day;
    events.push({
      type: "nation_founded",
      text: `${nation.name} が ${movedCities[0].name} を首都に建国`,
      nationId: nation.id,
      nationName: nation.name,
      capitalCityId: movedCities[0].id,
      sourceNationId,
      cityIds: movedCities.map((c) => c.id)
    });
    return true;
  }
  return false;
}

function syncNationEventHistory({ world, state, events, day }) {
  const history = (state.nationHistory = state.nationHistory ?? []);
  const historyLimit = 720;
  const allowed = new Set(["nation_founded", "territory_shift", "nation_extinct"]);
  for (const ev of events ?? []) {
    if (!allowed.has(ev?.type)) {
      continue;
    }
    const row = {
      day,
      type: ev.type,
      nationId: ev.nationId ?? null,
      nationName: ev.nationName ?? null,
      otherNationId: ev.otherNationId ?? null,
      otherNationName: ev.otherNationName ?? null,
      cityId: ev.cityId ?? ev.capitalCityId ?? null,
      cityName: ev.cityName ?? null,
      text: ev.text ?? ""
    };
    const key = `${row.day}|${row.type}|${row.nationId ?? "-"}|${row.otherNationId ?? "-"}|${row.cityId ?? "-"}|${row.text}`;
    if (!history.some((h) => `${h.day}|${h.type}|${h.nationId ?? "-"}|${h.otherNationId ?? "-"}|${h.cityId ?? "-"}|${h.text}` === key)) {
      history.push(row);
    }
  }

  const currentNationIds = new Set((world.nations ?? []).map((n) => n.id));
  const knownIds = new Set(state.knownNationIds ?? []);
  for (const oldId of knownIds) {
    if (currentNationIds.has(oldId)) {
      continue;
    }
    const nationName = oldId;
    const text = `${nationName} が消滅`;
    const key = `${day}|nation_extinct|${oldId}|-|-|${text}`;
    if (!history.some((h) => `${h.day}|${h.type}|${h.nationId ?? "-"}|${h.otherNationId ?? "-"}|${h.cityId ?? "-"}|${h.text}` === key)) {
      history.push({
        day,
        type: "nation_extinct",
        nationId: oldId,
        nationName,
        otherNationId: null,
        otherNationName: null,
        cityId: null,
        cityName: null,
        text
      });
    }
  }
  state.knownNationIds = Array.from(currentNationIds);
  if (history.length > historyLimit) {
    history.splice(0, history.length - historyLimit);
  }
}

function cityNationFormationPressure(city, activePresence) {
  const instability = clamp((city.metrics?.instabilityRisk ?? 0.2) / 1.5, 0, 1);
  const distrust = 1 - clamp(city.metrics?.trust ?? 0.5, 0, 1);
  const inequality = clamp((city.metrics?.inequality ?? 0.45) / 1.3, 0, 1);
  const productivity = clamp((city.metrics?.productivity ?? 0.75) / 1.8, 0, 1);
  const governance = 1 - clamp(city.metrics?.safety ?? 0.55, 0, 1);
  const organization = clamp((city.lifecycle?.orgCapacity ?? 0.55) / 1.8, 0, 1);
  const mobilization = clamp(activePresence / Math.max(60, city.population ?? 1), 0, 1);
  return clamp(
    instability * 0.28 +
      distrust * 0.16 +
      inequality * 0.15 +
      governance * 0.13 +
      organization * 0.16 +
      productivity * 0.06 +
      mobilization * 0.06,
    0,
    1.2
  );
}

function pickNationFormationCluster({ world, seedCity, sourceNationId, presence, threshold, maxCities }) {
  const selected = [seedCity];
  const seen = new Set([seedCity.id]);
  const queue = [seedCity.id];
  while (queue.length > 0 && selected.length < maxCities) {
    const current = queue.shift();
    const candidates = [];
    for (const edge of world.edges ?? []) {
      const neighborId =
        edge.fromCityId === current ? edge.toCityId
        : edge.toCityId === current ? edge.fromCityId
        : null;
      if (!neighborId || seen.has(neighborId)) {
        continue;
      }
      const neighbor = world.getCityById(neighborId);
      if (!neighbor) {
        continue;
      }
      if ((neighbor.nationId ?? null) !== sourceNationId) {
        continue;
      }
      const p = cityNationFormationPressure(neighbor, presence[neighborId] ?? 0);
      if (p < threshold - 0.08) {
        continue;
      }
      candidates.push({ city: neighbor, pressure: p });
    }
    candidates.sort((a, b) => b.pressure - a.pressure);
    for (const row of candidates) {
      if (selected.length >= maxCities) {
        break;
      }
      seen.add(row.city.id);
      selected.push(row.city);
      queue.push(row.city.id);
    }
  }
  return selected;
}

function nextNationId(world) {
  let maxId = 0;
  for (const nation of world.nations ?? []) {
    const m = /^N(\d+)$/.exec(String(nation.id ?? ""));
    if (m) {
      maxId = Math.max(maxId, Number(m[1]));
    }
  }
  return `N${maxId + 1}`;
}

function buildEmergentNationName(seedCityName, rng) {
  const suffixes = ["Republic", "Federation", "Compact", "Commonwealth", "Collective", "League"];
  const suffix = suffixes[Math.floor(rng.range(0, suffixes.length))] ?? suffixes[0];
  return `${seedCityName} ${suffix}`;
}

function randomNationColor(rng) {
  const h = Math.floor(rng.range(0, 360));
  const s = clamp(Math.floor(rng.range(56, 78)), 0, 100);
  const l = clamp(Math.floor(rng.range(50, 68)), 0, 100);
  return hslToHex(h, s, l);
}

function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function ensureDiplomacyPolicyState(state, key) {
  const row = (state.diplomacyPolicies[key] = state.diplomacyPolicies[key] ?? {
    qByAction: {},
    nByAction: {},
    qByStateAction: {},
    nByStateAction: {},
    pendingByStateAction: {},
    lastAction: "balanced",
    lastStateKey: "global",
    lastUpdateDay: -1
  });
  for (const action of DIPLOMACY_RL_ACTIONS) {
    if (!Number.isFinite(row.qByAction[action])) {
      row.qByAction[action] = 0.5;
    }
    if (!Number.isFinite(row.nByAction[action])) {
      row.nByAction[action] = 0;
    }
  }
  row.qByStateAction = row.qByStateAction ?? {};
  row.nByStateAction = row.nByStateAction ?? {};
  row.pendingByStateAction = row.pendingByStateAction ?? {};
  return row;
}

function diplomacyStateKey(prev, context) {
  const statusCode =
    prev?.status === "war" ? 3
    : prev?.status === "crisis" ? 2
    : prev?.status === "alliance" ? 0
    : 1;
  const tensionBand = band3(prev?.tension ?? 0.25, 0.3, 0.62);
  const dependenceBand = band3(context?.tradeDependence ?? 0.15, 0.12, 0.3);
  const stressBand = band3(context?.stress ?? 0.35, 0.32, 0.58);
  return `st${statusCode}|t${tensionBand}|d${dependenceBand}|s${stressBand}`;
}

function getPolicyQ(policy, stateKey, action) {
  const key = `${stateKey}::${action}`;
  const stateQ = policy.qByStateAction?.[key];
  if (Number.isFinite(stateQ)) {
    return stateQ;
  }
  return policy.qByAction?.[action] ?? 0.5;
}

function chooseDiplomacyAction(policy, stateKey, config, rng) {
  const eps = clamp(config?.rl?.diplomacyEpsilon ?? config?.rl?.epsilon ?? 0.1, 0.01, 0.45);
  if (rng.next() < eps) {
    const i = Math.floor(rng.range(0, DIPLOMACY_RL_ACTIONS.length));
    policy.lastAction = DIPLOMACY_RL_ACTIONS[i];
    policy.lastStateKey = stateKey;
    return policy.lastAction;
  }
  let best = DIPLOMACY_RL_ACTIONS[0];
  let bestQ = -Infinity;
  for (const a of DIPLOMACY_RL_ACTIONS) {
    const q = getPolicyQ(policy, stateKey, a);
    if (q > bestQ) {
      bestQ = q;
      best = a;
    }
  }
  policy.lastAction = best;
  policy.lastStateKey = stateKey;
  return best;
}

function flushDiplomacyPolicyPending(policy, alpha) {
  const pending = policy.pendingByStateAction ?? {};
  for (const [key, row] of Object.entries(pending)) {
    const count = row?.count ?? 0;
    if (count <= 0) {
      continue;
    }
    const reward = (row.sum ?? 0) / count;
    const [stateKey, action] = String(key).split("::");
    if (!action) {
      continue;
    }
    const stateActionKey = `${stateKey}::${action}`;
    const prevStateQ = Number.isFinite(policy.qByStateAction[stateActionKey]) ? policy.qByStateAction[stateActionKey] : getPolicyQ(policy, stateKey, action);
    policy.qByStateAction[stateActionKey] = Number((prevStateQ + alpha * (reward - prevStateQ)).toFixed(6));
    policy.nByStateAction[stateActionKey] = (policy.nByStateAction[stateActionKey] ?? 0) + count;
    const prevGlobal = policy.qByAction[action] ?? 0.5;
    policy.qByAction[action] = Number((prevGlobal + alpha * (reward - prevGlobal)).toFixed(6));
    policy.nByAction[action] = (policy.nByAction[action] ?? 0) + count;
    pending[key] = { sum: 0, count: 0 };
  }
}

function updateDiplomacyPolicyLearning(policy, action, stateKey, outcome, config, day) {
  const reward =
    outcome.status === "war" ? -0.9
    : outcome.status === "crisis" ? -0.35
    : clamp((outcome.relation ?? 0.5) * 0.8 - (outcome.tension ?? 0.2) * 0.7, -1, 1.4);
  const key = `${stateKey}::${action}`;
  const row = (policy.pendingByStateAction[key] = policy.pendingByStateAction[key] ?? { sum: 0, count: 0 });
  row.sum += reward;
  row.count += 1;
  const interval = Math.max(1, Math.floor(config?.rl?.diplomacyUpdateIntervalDays ?? 30));
  const shouldUpdate = !Number.isFinite(day) || (policy.lastUpdateDay ?? -1) < 0 || day - (policy.lastUpdateDay ?? -1) >= interval;
  if (shouldUpdate) {
    const alpha = clamp(config?.rl?.diplomacyAlpha ?? config?.rl?.alpha ?? 0.12, 0.01, 0.5);
    flushDiplomacyPolicyPending(policy, alpha);
    if (Number.isFinite(day)) {
      policy.lastUpdateDay = day;
    }
  }
}

function updateCurrencyRegime(world, nationStats, rng, config, day) {
  if (!(config.currency?.enabled ?? true)) {
    return;
  }
  const c = world.systemState.currencies;
  const baseInflation = config.currency?.inflationBase ?? 0.012;
  const basePolicyRate = config.currency?.policyRateBase ?? 0.02;
  const fxVolatility = config.currency?.fxVolatility ?? 0.01;
  const market = world.systemState?.marketIndex ?? 1;
  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const climate = world.systemState?.climateStress ?? 0;

  for (const nation of world.nations ?? []) {
    const stats = nationStats[nation.id] ?? {};
    const power = stats.power ?? 0.5;
    const stress = stats.stress ?? 0.4;
    const resource = stats.resourceStrength ?? 0.5;
    const prevFx = c.fxAgainstBase[nation.id] ?? 1;
    const prevInflation = c.inflation[nation.id] ?? baseInflation;

    const inflationTarget = clamp(
      baseInflation + stress * 0.026 + Math.max(0, 1 - market) * 0.02 + epidemic * 0.018 + climate * 0.015 - resource * 0.01,
      0.002,
      0.16
    );
    const policyTarget = clamp(basePolicyRate + inflationTarget * 0.6 + stress * 0.03 - power * 0.012, 0.003, 0.18);
    c.inflation[nation.id] = clamp(prevInflation * 0.75 + inflationTarget * 0.25, 0.002, 0.18);
    c.policyRate[nation.id] = clamp((c.policyRate[nation.id] ?? basePolicyRate) * 0.72 + policyTarget * 0.28, 0.003, 0.2);

    const fxTarget = clamp(
      1 + (power - 0.55) * 0.28 + (resource - 0.55) * 0.22 - c.inflation[nation.id] * 0.55 - stress * 0.1 + (market - 1) * 0.08,
      0.7,
      1.35
    );
    c.fxAgainstBase[nation.id] = clamp(prevFx * 0.84 + fxTarget * 0.16 + rng.range(-fxVolatility, fxVolatility), 0.65, 1.45);
  }
  c.updatedDay = day;
}

function computeNationStats(world, frame) {
  const presence = frame.people?.cityPresence ?? {};
  const out = {};
  for (const nation of world.nations ?? []) {
    const cities = (nation.cityIds ?? []).map((id) => world.getCityById(id)).filter(Boolean);
    const population = cities.reduce((sum, city) => sum + (city.population ?? 0), 0);
    const productivity = cities.reduce((sum, city) => sum + city.metrics.productivity, 0) / Math.max(1, cities.length);
    const trust = cities.reduce((sum, city) => sum + city.metrics.trust, 0) / Math.max(1, cities.length);
    const stress = cities.reduce((sum, city) => sum + city.metrics.instabilityRisk, 0) / Math.max(1, cities.length);
    const active = cities.reduce((sum, city) => sum + (presence[city.id] ?? 0), 0);
    const resourceStrength = computeNationResourceStrength(cities);
    const humanQuality = computeNationHumanQuality(cities);
    const laborMobilization = active / Math.max(1, population);
    const adjustedStress = clamp(stress + Math.max(0, 0.45 - resourceStrength) * 0.12, 0, 1.5);
    const power = clamp(
      productivity * 0.36 + trust * 0.16 + laborMobilization * 0.21 + resourceStrength * 0.19 + humanQuality * 0.08,
      0,
      1.8
    );
    out[nation.id] = { population, productivity, trust, stress: adjustedStress, power, resourceStrength, humanQuality };
    if (!nation.capitalCityId && cities[0]) {
      nation.capitalCityId = cities[0].id;
    }
  }
  return out;
}

function computeNationResourceStrength(cities) {
  if (!cities || cities.length === 0) {
    return 0.4;
  }
  const keys = ["water", "food", "energy_fossil", "energy_renewable", "metals_bulk", "rare_minerals"];
  let sum = 0;
  let count = 0;
  for (const city of cities) {
    for (const key of keys) {
      const node = city.resources?.[key];
      if (!node) {
        continue;
      }
      const ratio = (node.stock ?? 0) / Math.max(1, node.capacity ?? 1);
      sum += clamp(ratio, 0, 1.4);
      count += 1;
    }
  }
  return count > 0 ? clamp(sum / count, 0, 1.3) : 0.4;
}

function computeNationHumanQuality(cities) {
  if (!cities || cities.length === 0) {
    return 0.5;
  }
  let weighted = 0;
  let total = 0;
  for (const city of cities) {
    const pop = Math.max(1, city.population ?? 1);
    const q = clamp(city.resources?.human?.quality ?? 0.5, 0.05, 1);
    weighted += pop * q;
    total += pop;
  }
  return total > 0 ? clamp(weighted / total, 0.05, 1) : 0.5;
}

function borderFriction(world, nationAId, nationBId) {
  let total = 0;
  let cross = 0;
  for (const edge of world.edges) {
    const a = world.getCityById(edge.fromCityId);
    const b = world.getCityById(edge.toCityId);
    if (!a || !b) {
      continue;
    }
    if (a.nationId === nationAId || a.nationId === nationBId || b.nationId === nationAId || b.nationId === nationBId) {
      total += 1;
      if (
        (a.nationId === nationAId && b.nationId === nationBId) ||
        (a.nationId === nationBId && b.nationId === nationAId)
      ) {
        cross += 1;
      }
    }
  }
  return total > 0 ? cross / total : 0;
}

function computeGeopoliticalHotspotInputs(world, nations) {
  const nationHotspot = {};
  const prices = world.systemState?.resources?.prices ?? {};
  const energyPriceShock = clamp(((prices.energy_fossil ?? 1) + (prices.energy_renewable ?? 1)) * 0.5 - 1, 0, 1.2);
  const migrationPairFlow = world.systemState?.migrationFlows?.pairEma ?? {};
  for (const nation of nations ?? []) {
    const cities = (nation.cityIds ?? []).map((id) => world.getCityById(id)).filter(Boolean);
    const count = Math.max(1, cities.length);
    const fractured = cities.filter((c) => c?.regime === "fractured").length / count;
    const stressed = cities.filter((c) => c?.regime === "stressed").length / count;
    const avgStrain = cities.reduce((sum, c) => sum + (c?.strain ?? 0), 0) / count;
    const crossFlow = Object.entries(migrationPairFlow).reduce((sum, [k, v]) => {
      const [aId, bId] = k.split("|");
      if (aId === nation.id || bId === nation.id) {
        return sum + (Number(v) || 0);
      }
      return sum;
    }, 0);
    nationHotspot[nation.id] = clamp(fractured * 0.58 + stressed * 0.22 + avgStrain * 0.2 + crossFlow * 0.18 + energyPriceShock * 0.1, 0, 1.4);
  }
  const spill = {};
  for (const nation of nations ?? []) {
    const rel = Object.entries(world.systemState?.geopolitics?.diplomacy ?? {}).filter(([k]) => k.includes(`${nation.id}|`) || k.includes(`|${nation.id}`));
    const n = Math.max(1, rel.length);
    const s = rel.reduce((sum, [key]) => {
      const [a, b] = key.split("|");
      const other = a === nation.id ? b : a;
      return sum + (nationHotspot[other] ?? 0);
    }, 0);
    spill[nation.id] = clamp((s / n) * 0.35, 0, 0.8);
  }
  const pairFlow = {};
  for (const [k, v] of Object.entries(migrationPairFlow)) {
    pairFlow[k] = clamp(Number(v) || 0, 0, 1.5);
  }
  return { nationHotspot, spill, pairFlow, energyPriceShock };
}

function applyGeopoliticalFeedbackToCities(world, state, hotspot, config) {
  const diplomacy = state?.diplomacy ?? {};
  const nations = world.nations ?? [];
  const byNationTension = {};
  for (const nation of nations) {
    const rows = Object.entries(diplomacy).filter(([key]) => key.includes(`${nation.id}|`) || key.includes(`|${nation.id}`));
    const avg = rows.length
      ? rows.reduce((sum, [, rel]) => sum + (rel?.tension ?? 0.2), 0) / rows.length
      : 0.2;
    byNationTension[nation.id] = clamp(avg + (hotspot.nationHotspot[nation.id] ?? 0) * 0.08, 0, 1.2);
  }
  for (const city of world.cities ?? []) {
    city.lifecycle = city.lifecycle ?? {};
    const tension = byNationTension[city.nationId] ?? 0.2;
    const geoPriceShock = clamp(tension * 0.55 + (hotspot.energyPriceShock ?? 0) * 0.45, 0, 1.5);
    city.lifecycle.geoPriceShock = Number((geoPriceShock * 0.28).toFixed(5));
    city.metrics.costOfLiving = clamp(city.metrics.costOfLiving + city.lifecycle.geoPriceShock * 0.006, 0.2, 2.9);
    city.metrics.productivity = clamp(city.metrics.productivity - city.lifecycle.geoPriceShock * 0.004, 0.2, 2.2);
    city.metrics.trust = clamp(city.metrics.trust - city.lifecycle.geoPriceShock * 0.002, 0.02, 0.99);
  }
  state.edgeShockById = state.edgeShockById ?? {};
  state.edgeShockPairValueById = state.edgeShockPairValueById ?? {};
  for (const edge of world.edges ?? []) {
    const a = world.getCityById(edge.fromCityId);
    const b = world.getCityById(edge.toCityId);
    if (!a || !b || a.nationId === b.nationId) {
      continue;
    }
    const k = pairKey(a.nationId, b.nationId);
    const pairShock = clamp((hotspot.pairFlow[k] ?? 0) * 0.8 + ((hotspot.nationHotspot[a.nationId] ?? 0) + (hotspot.nationHotspot[b.nationId] ?? 0)) * 0.2, 0, 1.2);
    const prev = edge.geoShockLevel ?? 0;
    let next = prev;
    if (pairShock >= 0.32) {
      next = 2;
    } else if (pairShock >= 0.16) {
      next = Math.max(1, prev);
    } else if (prev === 2 && pairShock < 0.2) {
      next = 1;
    } else if (prev === 1 && pairShock < 0.1) {
      next = 0;
    }
    edge.geoShockLevel = next;
    state.edgeShockById[edge.id] = next;
    state.edgeShockPairValueById[edge.id] = Number(pairShock.toFixed(6));
  }
  void config;
}

function computeTradeDependence(world) {
  const matrix = {};
  const totalByNation = new Map((world.nations ?? []).map((n) => [n.id, 0]));
  for (const edge of world.edges) {
    const a = world.getCityById(edge.fromCityId);
    const b = world.getCityById(edge.toCityId);
    if (!a || !b || a.nationId === b.nationId) {
      continue;
    }
    const trade = edge.connectivity * (edge.gatewayRestriction === "open" ? 1 : edge.gatewayRestriction === "permit" ? 0.55 : 0.2);
    totalByNation.set(a.nationId, (totalByNation.get(a.nationId) ?? 0) + trade);
    totalByNation.set(b.nationId, (totalByNation.get(b.nationId) ?? 0) + trade);
    const k = pairKey(a.nationId, b.nationId);
    matrix[k] = (matrix[k] ?? 0) + trade;
  }
  for (const k of Object.keys(matrix)) {
    const [aId, bId] = k.split("|");
    const base = Math.max(1e-6, (totalByNation.get(aId) ?? 0) + (totalByNation.get(bId) ?? 0));
    matrix[k] = clamp((matrix[k] * 2) / base, 0, 1);
  }
  return matrix;
}

function computeValueDistance(world) {
  const profile = {};
  for (const nation of world.nations ?? []) {
    const cities = (nation.cityIds ?? []).map((id) => world.getCityById(id)).filter(Boolean);
    const count = Math.max(1, cities.length);
    profile[nation.id] = {
      trust: cities.reduce((s, c) => s + (c.metrics?.trust ?? 0.5), 0) / count,
      inequality: cities.reduce((s, c) => s + (c.metrics?.inequality ?? 0.5), 0) / count,
      productivity: cities.reduce((s, c) => s + (c.metrics?.productivity ?? 0.7), 0) / count,
      safety: cities.reduce((s, c) => s + (c.metrics?.safety ?? 0.5), 0) / count
    };
  }
  const matrix = {};
  const nations = world.nations ?? [];
  for (let i = 0; i < nations.length; i += 1) {
    for (let j = i + 1; j < nations.length; j += 1) {
      const a = profile[nations[i].id];
      const b = profile[nations[j].id];
      if (!a || !b) {
        continue;
      }
      const dist =
        Math.abs(a.trust - b.trust) * 0.32 +
        Math.abs(a.inequality - b.inequality) * 0.3 +
        Math.abs(a.productivity - b.productivity) * 0.2 +
        Math.abs(a.safety - b.safety) * 0.18;
      matrix[pairKey(nations[i].id, nations[j].id)] = clamp(dist, 0, 1);
    }
  }
  return matrix;
}

function sharedThreat(world, nationAId, nationBId) {
  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const climate = world.systemState?.climateStress ?? 0;
  const marketStress = Math.max(0, 1 - (world.systemState?.marketIndex ?? 1));
  const threat = epidemic * 0.42 + climate * 0.32 + marketStress * 0.26;
  if (nationAId === nationBId) {
    return threat;
  }
  return threat * 0.9;
}

function restrictionLevel(value) {
  return value === "sealed" ? 2 : value === "permit" ? 1 : 0;
}

function levelToRestriction(level) {
  return level >= 2 ? "sealed" : level >= 1 ? "permit" : "open";
}

function applyBorderPolicyByDiplomacy(world, diplomacy, state = null, config = null) {
  const stats = { open: 0, permit: 0, sealed: 0, changedThisTick: 0 };
  const permitLockTicks = Math.max(12, Math.floor(config?.geopolitics?.restrictionPermitLockTicks ?? 48));
  const sealedLockTicks = Math.max(24, Math.floor(config?.geopolitics?.restrictionSealedLockTicks ?? 96));
  const sealedReleaseShockThreshold = clamp(config?.geopolitics?.sealedReleaseShockThreshold ?? 0.14, 0.02, 0.4);
  const permitReleaseShockThreshold = clamp(config?.geopolitics?.permitReleaseShockThreshold ?? 0.07, 0.01, 0.25);
  for (const edge of world.edges) {
    const a = world.getCityById(edge.fromCityId);
    const b = world.getCityById(edge.toCityId);
    if (!a || !b || a.nationId === b.nationId) {
      continue;
    }
    const rel = diplomacy[pairKey(a.nationId, b.nationId)];
    if (!rel) {
      continue;
    }
    const diplomaticLevel =
      rel.status === "war" ? 2
      : rel.status === "crisis" ? 1
      : 0;
    const shockLevel = state?.edgeShockById?.[edge.id] ?? edge.geoShockLevel ?? 0;
    const pairShock = state?.edgeShockPairValueById?.[edge.id] ?? (shockLevel >= 2 ? 0.32 : shockLevel >= 1 ? 0.16 : 0);
    const currentLevel = restrictionLevel(edge.gatewayRestriction);
    let targetLevel = Math.max(diplomaticLevel, shockLevel);
    const prevLock = Math.max(0, Math.floor(edge.restrictionLockTicks ?? 0));
    let lock = prevLock;
    if (prevLock > 0) {
      lock = prevLock - 1;
      targetLevel = Math.max(targetLevel, currentLevel);
    } else {
      if (targetLevel >= 2 && diplomaticLevel < 2 && pairShock < sealedReleaseShockThreshold) {
        targetLevel = 1;
      }
      if (targetLevel === 1 && diplomaticLevel === 0 && pairShock < permitReleaseShockThreshold) {
        targetLevel = 0;
      }
      if (targetLevel < currentLevel) {
        targetLevel = Math.max(currentLevel - 1, targetLevel);
      }
    }
    if (targetLevel > currentLevel) {
      lock = targetLevel >= 2 ? sealedLockTicks : permitLockTicks;
    } else if (targetLevel === currentLevel && targetLevel > 0 && pairShock >= permitReleaseShockThreshold) {
      lock = Math.max(lock, targetLevel >= 2 ? Math.floor(sealedLockTicks * 0.5) : Math.floor(permitLockTicks * 0.5));
    }
    edge.restrictionLockTicks = lock;
    if (targetLevel !== currentLevel) {
      stats.changedThisTick += 1;
    }
    edge.gatewayRestriction = levelToRestriction(targetLevel);
    if (targetLevel >= 2) {
      edge.connectivity = clamp(edge.connectivity * 0.84, 0.08, 0.92);
    } else if (targetLevel === 1) {
      edge.connectivity = clamp(edge.connectivity * 0.95, 0.08, 0.95);
    } else {
      edge.connectivity = clamp(edge.connectivity + 0.01, 0.1, 0.98);
    }
    if (targetLevel >= 2) {
      stats.sealed += 1;
    } else if (targetLevel === 1) {
      stats.permit += 1;
    } else {
      stats.open += 1;
    }
  }
  if (state) {
    state.edgeRestrictionStats = stats;
  }
}

function evolveMilitaryCompanies(world, state, nationStats, rng, day, events) {
  const companies = state.militaryCompanies;
  const relations = Object.values(state.diplomacy);
  const warPairs = relations.filter((r) => r.status === "war").length;
  const crisisPairs = relations.filter((r) => r.status === "crisis").length;
  for (const nation of world.nations ?? []) {
    const nationId = nation.id;
    const local = companies.filter((c) => c.nationId === nationId);
    const nationRelations = relations.filter((r) => r.status === "war" || r.status === "crisis");
    const tensionAvg =
      nationRelations.length > 0
        ? nationRelations.reduce((sum, r) => sum + r.tension, 0) / nationRelations.length
        : 0.18;
    const desired = 1 + Math.floor(tensionAvg * 3) + (warPairs > 0 ? 1 : 0);
    if (local.length < desired && rng.next() < 0.45) {
      const id = state.nextMilCompanyId++;
      const cityId = nation.capitalCityId ?? nation.cityIds?.[0] ?? null;
      const company = {
        id: `MIL${id}`,
        name: `${nation.name.split(" ")[0]} Defense ${id}`,
        nationId,
        cityId,
        budget: Number((0.4 + tensionAvg * 0.8 + rng.range(0, 0.3)).toFixed(3)),
        readiness: Number((0.35 + tensionAvg * 0.6 + rng.range(0, 0.2)).toFixed(3)),
        foundedDay: day
      };
      companies.push(company);
      events.push({ type: "mil_company", text: `${company.name} が設立` });
    }
    if (local.length > desired + 1 && rng.next() < 0.25) {
      const remove = local[Math.floor(rng.range(0, local.length))];
      const idx = companies.findIndex((c) => c.id === remove.id);
      if (idx >= 0) {
        companies.splice(idx, 1);
      }
    }
  }

  for (const c of companies) {
    const power = nationStats[c.nationId]?.power ?? 0.5;
    const wartimeBoost = warPairs > 0 ? 0.05 : -0.02;
    c.budget = Number(clamp(c.budget * 0.88 + power * 0.18 + crisisPairs * 0.02 + rng.range(-0.03, 0.04), 0.08, 2.8).toFixed(3));
    c.readiness = Number(clamp(c.readiness * 0.84 + c.budget * 0.14 + wartimeBoost + rng.range(-0.04, 0.04), 0.05, 1.2).toFixed(3));
  }
}

function evolveSecretSocieties(world, state, nationStats, rng, day, events, config) {
  const societies = state.secretSocieties;
  for (const nation of world.nations ?? []) {
    const nationId = nation.id;
    const local = societies.filter((item) => item.nationId === nationId);
    const stats = nationStats[nationId] ?? {};
    const stress = stats.stress ?? 0.3;
    const trust = stats.trust ?? 0.5;
    const spawnRate = clamp(0.008 + stress * 0.045 + (1 - trust) * 0.03, 0, 0.2);
    if (local.length < 3 && rng.next() < spawnRate) {
      const id = state.nextSecretSocietyId++;
      const cityId = nation.capitalCityId ?? nation.cityIds?.[0] ?? null;
      if (!cityId) {
        continue;
      }
      const society = {
        id: `SEC${id}`,
        name: buildSecretSocietyName(nation.name, id),
        nationId,
        cityId,
        agenda: pickSecretAgenda(rng),
        lastAction: "cooldown",
        influence: Number(clamp(0.08 + stress * 0.28 + rng.range(-0.03, 0.06), 0.05, 0.72).toFixed(3)),
        secrecy: Number(clamp(0.58 + rng.range(-0.08, 0.24), 0.4, 0.98).toFixed(3)),
        members: Math.floor(35 + (stats.population ?? 2000) * rng.range(0.0008, 0.0055)),
        foundedDay: day
      };
      societies.push(society);
      ensureSecretSocietyPolicyState(state, society.id, society.agenda);
      events.push({ type: "secret_founding", text: `${society.name} が暗躍を開始` });
    }
  }

  for (const society of societies) {
    const stats = nationStats[society.nationId] ?? {};
    const stress = stats.stress ?? 0.3;
    const power = stats.power ?? 0.45;
    const trust = stats.trust ?? 0.5;
    const policy = ensureSecretSocietyPolicyState(state, society.id, society.agenda);
    const action = chooseSecretSocietyAction(policy, config, rng);
    society.lastAction = action;
    const actionFx = applySecretSocietyActionEffects({
      world,
      state,
      nationStats,
      society,
      action,
      rng,
      events
    });
    const prevInfluence = society.influence;
    const prevSecrecy = society.secrecy;
    const prevMembers = society.members;
    const influenceNext = clamp(
      society.influence * 0.88 +
        stress * 0.1 +
        (1 - trust) * 0.05 +
        society.secrecy * 0.03 -
        power * 0.04 +
        actionFx.influenceDelta +
        rng.range(-0.04, 0.04),
      0.01,
      0.99
    );
    const secrecyNext = clamp(
      society.secrecy * 0.9 + 0.68 + actionFx.secrecyDelta + rng.range(-0.05, 0.05) - influenceNext * 0.08,
      0.08,
      0.99
    );
    const memberChange = Math.round((influenceNext - 0.25) * 26 + actionFx.memberDelta + rng.range(-7, 9));
    society.members = Math.max(8, society.members + memberChange);
    society.influence = Number(influenceNext.toFixed(3));
    society.secrecy = Number(secrecyNext.toFixed(3));

    const exposureProb = clamp(0.04 + (1 - society.secrecy) * 0.24 + (society.influence > 0.45 ? 0.08 : 0) + actionFx.exposureDelta, 0, 0.65);
    if (society.secrecy < 0.24 && society.influence > 0.45 && rng.next() < exposureProb) {
      society.influence = Number(clamp(society.influence * 0.82, 0.01, 0.99).toFixed(3));
      society.secrecy = Number(clamp(society.secrecy + 0.28, 0.08, 0.99).toFixed(3));
      events.push({ type: "secret_exposed", text: `${society.name} の活動が露見` });
    }
    updateSecretSocietyPolicyLearning(policy, action, {
      society,
      prevInfluence,
      prevSecrecy,
      prevMembers,
      actionFx
    }, config);
    updateAgendaPrior(state, society.agenda, policy);
  }

  for (let i = societies.length - 1; i >= 0; i -= 1) {
    const row = societies[i];
    if ((row.influence < 0.05 || row.members < 14) && rng.next() < 0.45) {
      const policy = state.secretSocietyPolicies?.[row.id];
      if (policy) {
        state.archivedSecretSocietyPolicies[row.id] = {
          ...policy,
          archivedDay: day,
          finalInfluence: row.influence,
          finalMembers: row.members
        };
        delete state.secretSocietyPolicies[row.id];
      }
      events.push({ type: "secret_dissolved", text: `${row.name} は瓦解` });
      societies.splice(i, 1);
    }
  }

  societies.sort((a, b) => b.influence - a.influence || b.members - a.members);
  if (societies.length > 40) {
    societies.length = 40;
  }
}

function buildSecretSocietyName(nationName, id) {
  const prefix = nationName.split(" ")[0];
  const motifs = ["Circle", "Veil", "Obsidian", "Ash", "Silent", "Cinder", "Lantern", "Whisper"];
  const suffix = motifs[id % motifs.length];
  return `${prefix} ${suffix} ${id}`;
}

function pickSecretAgenda(rng) {
  const agendas = [
    "market_capture",
    "dynastic_control",
    "border_sabotage",
    "faith_unification",
    "elite_blackmail",
    "shadow_brokerage"
  ];
  return agendas[Math.floor(rng.next() * agendas.length)] ?? agendas[0];
}

function ensureSecretSocietyPolicyState(state, societyId, agenda) {
  const row = (state.secretSocietyPolicies[societyId] = state.secretSocietyPolicies[societyId] ?? {
    qByAction: {},
    nByAction: {},
    lastAction: "cooldown",
    agenda,
    updates: 0
  });
  const prior = state.secretSocietyAgendaPriors?.[agenda];
  for (const action of SECRET_SOCIETY_RL_ACTIONS) {
    if (!Number.isFinite(row.qByAction[action])) {
      row.qByAction[action] = Number.isFinite(prior?.qByAction?.[action]) ? prior.qByAction[action] : 0.5;
    }
    if (!Number.isFinite(row.nByAction[action])) {
      row.nByAction[action] = 0;
    }
  }
  row.agenda = agenda;
  return row;
}

function chooseSecretSocietyAction(policy, config, rng) {
  const eps = clamp(config?.rl?.secretSocietyEpsilon ?? config?.rl?.epsilon ?? 0.12, 0.01, 0.5);
  if (rng.next() < eps) {
    const i = Math.floor(rng.range(0, SECRET_SOCIETY_RL_ACTIONS.length));
    policy.lastAction = SECRET_SOCIETY_RL_ACTIONS[i];
    return policy.lastAction;
  }
  let best = SECRET_SOCIETY_RL_ACTIONS[0];
  let bestQ = -Infinity;
  for (const action of SECRET_SOCIETY_RL_ACTIONS) {
    const q = policy.qByAction[action] ?? 0;
    if (q > bestQ) {
      bestQ = q;
      best = action;
    }
  }
  policy.lastAction = best;
  return best;
}

function applySecretSocietyActionEffects({ world, state, society, action, rng, events }) {
  const fx = { influenceDelta: 0, secrecyDelta: 0, memberDelta: 0, exposureDelta: 0, impactScore: 0 };
  const agendaScale =
    society.agenda === "market_capture" && action === "market_infiltration" ? 1.2
    : society.agenda === "border_sabotage" && action === "border_disruption" ? 1.2
    : (society.agenda === "dynastic_control" || society.agenda === "elite_blackmail") && action === "state_infiltration" ? 1.2
    : 1;

  if (action === "recruit") {
    fx.influenceDelta += 0.018 * agendaScale;
    fx.memberDelta += 6 * agendaScale;
    fx.secrecyDelta -= 0.04;
    fx.exposureDelta += 0.05;
  } else if (action === "hide") {
    fx.secrecyDelta += 0.09;
    fx.influenceDelta -= 0.01;
    fx.memberDelta -= 2;
    fx.exposureDelta -= 0.08;
  } else if (action === "market_infiltration") {
    const hit = clamp(0.006 + society.influence * 0.015, 0.004, 0.028) * agendaScale;
    world.systemState.marketIndex = clamp((world.systemState.marketIndex ?? 1) - hit, 0.3, 4.5);
    fx.influenceDelta += 0.014 * agendaScale;
    fx.secrecyDelta -= 0.03;
    fx.memberDelta += 2;
    fx.exposureDelta += 0.04;
    fx.impactScore += hit * 4.5;
    if (rng.next() < 0.2) {
      events.push({ type: "secret_market", text: `${society.name} が市場操作を実行` });
    }
  } else if (action === "state_infiltration") {
    const cities = getNationCities(world, society.nationId);
    const trustHit = clamp(0.004 + society.influence * 0.012, 0.003, 0.02) * agendaScale;
    for (const city of cities) {
      city.metrics.trust = clamp(city.metrics.trust - trustHit, 0.05, 1.2);
      city.metrics.inequality = clamp(city.metrics.inequality + trustHit * 0.8, 0.05, 1.4);
      city.metrics.instabilityRisk = clamp(city.metrics.instabilityRisk + trustHit * 0.9, 0, 1.5);
    }
    fx.influenceDelta += 0.012 * agendaScale;
    fx.secrecyDelta -= 0.025;
    fx.exposureDelta += 0.05;
    fx.impactScore += trustHit * 50;
  } else if (action === "border_disruption") {
    const nationId = society.nationId;
    const diplomacy = state.diplomacy ?? {};
    const inc = clamp(0.006 + society.influence * 0.01, 0.005, 0.024) * agendaScale;
    let touched = 0;
    for (const key of Object.keys(diplomacy)) {
      const [aId, bId] = key.split("|");
      if (aId !== nationId && bId !== nationId) {
        continue;
      }
      const rel = diplomacy[key];
      rel.tension = clamp((rel.tension ?? 0.2) + inc, 0.02, 0.99);
      rel.relation = clamp((rel.relation ?? 0.7) - inc * 0.8, 0, 1);
      touched += 1;
    }
    if (touched > 0) {
      fx.impactScore += touched * inc * 15;
      if (rng.next() < 0.24) {
        events.push({ type: "secret_border", text: `${society.name} が国境工作を実行` });
      }
    }
    fx.influenceDelta += 0.01;
    fx.secrecyDelta -= 0.03;
    fx.exposureDelta += 0.055;
  } else if (action === "cooldown") {
    fx.secrecyDelta += 0.03;
  }

  return fx;
}

function updateSecretSocietyPolicyLearning(policy, action, outcome, config) {
  const alpha = clamp(config?.rl?.secretSocietyAlpha ?? config?.rl?.alpha ?? 0.12, 0.01, 0.4);
  const infGain = (outcome.society.influence ?? 0) - (outcome.prevInfluence ?? 0);
  const secGain = (outcome.society.secrecy ?? 0) - (outcome.prevSecrecy ?? 0);
  const memberGain = ((outcome.society.members ?? 0) - (outcome.prevMembers ?? 0)) / 120;
  const reward = clamp(infGain * 3.6 + secGain * 1.8 + memberGain + (outcome.actionFx?.impactScore ?? 0) * 0.2, -1.2, 2.4);
  for (const key of Object.keys(policy.qByAction ?? {})) {
    policy.qByAction[key] = Number((policy.qByAction[key] * 0.995).toFixed(6));
  }
  const prev = policy.qByAction[action] ?? 0.5;
  policy.qByAction[action] = Number((prev + alpha * (reward - prev)).toFixed(6));
  policy.nByAction[action] = (policy.nByAction[action] ?? 0) + 1;
  policy.updates = (policy.updates ?? 0) + 1;
}

function updateAgendaPrior(state, agenda, policy) {
  state.secretSocietyAgendaPriors = state.secretSocietyAgendaPriors ?? {};
  const row = (state.secretSocietyAgendaPriors[agenda] = state.secretSocietyAgendaPriors[agenda] ?? { qByAction: {}, samples: 0 });
  row.samples += 1;
  for (const action of SECRET_SOCIETY_RL_ACTIONS) {
    const prev = Number.isFinite(row.qByAction[action]) ? row.qByAction[action] : 0.5;
    const q = Number.isFinite(policy.qByAction[action]) ? policy.qByAction[action] : prev;
    row.qByAction[action] = Number((prev * 0.92 + q * 0.08).toFixed(6));
  }
}

function getNationCities(world, nationId) {
  const nation = world.getNationById(nationId);
  if (!nation) {
    return [];
  }
  return (nation.cityIds ?? []).map((id) => world.getCityById(id)).filter(Boolean);
}

function applyWarTerritorialShift(world, state, nationStats, rng, events) {
  const warPairs = Object.entries(state.diplomacy).filter(([, rel]) => rel.status === "war");
  if (warPairs.length === 0) {
    return;
  }
  for (const [key, rel] of warPairs) {
    const [aId, bId] = key.split("|");
    const front = world.edges.filter((e) => {
      const a = world.getCityById(e.fromCityId);
      const b = world.getCityById(e.toCityId);
      if (!a || !b) {
        return false;
      }
      return (
        (a.nationId === aId && b.nationId === bId) ||
        (a.nationId === bId && b.nationId === aId)
      );
    });
    if (front.length === 0) {
      continue;
    }
    if (rng.next() > 0.18 + rel.tension * 0.18) {
      continue;
    }
    const edge = front[Math.floor(rng.range(0, front.length))];
    const ca = world.getCityById(edge.fromCityId);
    const cb = world.getCityById(edge.toCityId);
    if (!ca || !cb || ca.nationId === cb.nationId) {
      continue;
    }

    const powerA = combatPower(aId, nationStats, state.militaryCompanies);
    const powerB = combatPower(bId, nationStats, state.militaryCompanies);
    const winnerId = powerA >= powerB ? aId : bId;
    const loserId = winnerId === aId ? bId : aId;
    const loserCity = ca.nationId === loserId ? ca : cb;
    const winnerNation = world.getNationById(winnerId);
    const loserNation = world.getNationById(loserId);
    if (!loserCity || !winnerNation || !loserNation) {
      continue;
    }
    if ((loserNation.cityIds?.length ?? 0) <= 1) {
      continue;
    }
    const changed = world.transferCityNation(loserCity.id, winnerId);
    if (!changed) {
      continue;
    }
    edge.gatewayRestriction = "sealed";
    edge.connectivity = clamp(edge.connectivity * 0.82, 0.08, 0.9);
    rel.tension = clamp(rel.tension * 0.94 + 0.06, 0.1, 0.99);
    rel.relation = clamp(1 - rel.tension - 0.12, 0, 1);
    events.push({
      type: "territory_shift",
      text: `${winnerNation.name} が ${loserCity.name} を掌握`,
      nationId: winnerNation.id,
      nationName: winnerNation.name,
      otherNationId: loserNation.id,
      otherNationName: loserNation.name,
      cityId: loserCity.id,
      cityName: loserCity.name
    });
  }
}

function combatPower(nationId, nationStats, militaryCompanies) {
  const base = nationStats[nationId]?.power ?? 0.45;
  const military = (militaryCompanies ?? [])
    .filter((c) => c.nationId === nationId)
    .reduce((sum, c) => sum + (c.readiness ?? 0.3) * 0.6 + (c.budget ?? 0.4) * 0.4, 0);
  return base + military * 0.12;
}
