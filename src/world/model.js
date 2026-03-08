import { Rng } from "../core/rng.js";

export class SphereWorld {
  constructor({
    layers = [],
    geoZones = [],
    cities = [],
    edges = [],
    nations = [],
    spheres = [],
    communities = [],
    institutions = [],
    citySphereState = {},
    systemState = null
  } = {}) {
    this.layers = layers;
    this.geoZones = geoZones;
    this.cities = cities;
    this.edges = edges;
    this.nations = nations;
    this.spheres = spheres;
    this.communities = communities;
    this.institutions = institutions;
    this.citySphereState = citySphereState;
    this.cityIndex = new Map(cities.map((city) => [city.id, city]));
    this.nationIndex = new Map(nations.map((nation) => [nation.id, nation]));
    this.version = 1;
    this.systemState =
      systemState ?? {
        epidemicLevel: 0.12,
        climateStress: 0.18,
        culturalDrift: 0.22,
        marketIndex: 1,
        resources: {
          prices: {
            water: 1,
            food: 1,
            energy_fossil: 1,
            energy_renewable: 1,
            metals_bulk: 1,
            rare_minerals: 1,
            human: 1
          },
          globalScarcity: 0.2
        },
        currencies: {
          baseCode: "SCU",
          fxAgainstBase: {},
          inflation: {},
          policyRate: {},
          updatedDay: -1
        }
      };
    ensureCurrencyState(this);
    ensureSphereState(this);
    ensureCityGeoZoneState(this);
    ensureRoleLayerState(this);
  }

  getCityById(cityId) {
    return this.cityIndex.get(cityId);
  }

  getNationById(nationId) {
    return this.nationIndex.get(nationId);
  }

  hasTransitPath(fromCityId, toCityId) {
    return Number.isFinite(this.findShortestPathCost(fromCityId, toCityId));
  }

  findShortestPathCost(fromCityId, toCityId) {
    if (fromCityId === toCityId) {
      return 0;
    }
    const dist = new Map([[fromCityId, 0]]);
    const visited = new Set();

    while (true) {
      let current = null;
      let best = Infinity;
      for (const [id, d] of dist.entries()) {
        if (!visited.has(id) && d < best) {
          best = d;
          current = id;
        }
      }
      if (current == null) {
        break;
      }
      if (current === toCityId) {
        return best;
      }
      visited.add(current);

      for (const edge of this.edges) {
        if (edge.gatewayRestriction === "sealed") {
          continue;
        }
        let next = null;
        if (edge.fromCityId === current) {
          next = edge.toCityId;
        } else if (edge.toCityId === current) {
          next = edge.fromCityId;
        }
        if (!next || visited.has(next)) {
          continue;
        }
        const restrictionPenalty = edge.gatewayRestriction === "permit" ? 0.6 : 0;
        const hopCost = 1 + (1 - edge.connectivity) * 1.5 + restrictionPenalty;
        const nd = best + hopCost;
        if (nd < (dist.get(next) ?? Infinity)) {
          dist.set(next, nd);
        }
      }
    }
    return Infinity;
  }

  addCity(city) {
    this.cities.push(city);
    this.cityIndex.set(city.id, city);
    if (city.nationId) {
      const nation = this.nationIndex.get(city.nationId);
      if (nation) {
        nation.cityIds = nation.cityIds ?? [];
        if (!nation.cityIds.includes(city.id)) {
          nation.cityIds.push(city.id);
        }
      }
    }
    this.version += 1;
  }

  removeCity(cityId) {
    const city = this.cityIndex.get(cityId);
    this.cities = this.cities.filter((c) => c.id !== cityId);
    this.edges = this.edges.filter((e) => e.fromCityId !== cityId && e.toCityId !== cityId);
    if (city?.nationId) {
      const nation = this.nationIndex.get(city.nationId);
      if (nation?.cityIds) {
        nation.cityIds = nation.cityIds.filter((id) => id !== cityId);
      }
    }
    this.cityIndex = new Map(this.cities.map((city) => [city.id, city]));
    this.version += 1;
  }

  addNation(nation) {
    this.nations.push(nation);
    this.nationIndex.set(nation.id, nation);
    this.version += 1;
  }

  transferCityNation(cityId, toNationId) {
    const city = this.cityIndex.get(cityId);
    if (!city || city.nationId === toNationId) {
      return false;
    }
    const fromNationId = city.nationId;
    const fromNation = fromNationId ? this.nationIndex.get(fromNationId) : null;
    const toNation = this.nationIndex.get(toNationId);
    if (!toNation) {
      return false;
    }

    if (fromNation?.cityIds) {
      fromNation.cityIds = fromNation.cityIds.filter((id) => id !== cityId);
      if (fromNation.capitalCityId === cityId) {
        fromNation.capitalCityId = fromNation.cityIds[0] ?? null;
      }
    }
    toNation.cityIds = toNation.cityIds ?? [];
    if (!toNation.cityIds.includes(cityId)) {
      toNation.cityIds.push(cityId);
    }
    if (!toNation.capitalCityId) {
      toNation.capitalCityId = cityId;
    }
    city.nationId = toNationId;
    this.version += 1;
    return true;
  }

  addEdge(edge) {
    const exists = this.edges.some(
      (e) =>
        (e.fromCityId === edge.fromCityId && e.toCityId === edge.toCityId) ||
        (e.fromCityId === edge.toCityId && e.toCityId === edge.fromCityId)
    );
    if (!exists) {
      this.edges.push(edge);
      this.version += 1;
    }
  }

  removeEdge(edgeId) {
    const before = this.edges.length;
    this.edges = this.edges.filter((e) => e.id !== edgeId);
    if (this.edges.length !== before) {
      this.version += 1;
    }
  }
}

export function createSampleWorld(seed = 1337) {
  const rng = new Rng(seed);

  const layers = [
    { id: "Layer0", name: "Person", roleType: "person" },
    { id: "Layer1", name: "Community", roleType: "community" },
    { id: "Layer2", name: "Institution", roleType: "institution" }
  ];

  const geoZones = [
    { id: "G1", name: "Inner Core", accessLevel: "restricted" },
    { id: "G2", name: "Urban Belt", accessLevel: "mixed" },
    { id: "G3", name: "Outer Ring", accessLevel: "open" }
  ];

  const cities = [
    createCity("C1", "Helio", "G3", "residential", rng, { lat: 12, lon: -30 }),
    createCity("C2", "Merca", "G2", "workHub", rng, { lat: 16, lon: 5 }),
    createCity("C3", "Nava", "G3", "mixed", rng, { lat: -4, lon: 50 }),
    createCity("C4", "Atria", "G2", "workHub", rng, { lat: -18, lon: -75 }),
    createCity("C5", "Vale", "G1", "mixed", rng, { lat: 32, lon: 110 }),
    createCity("C6", "Orion", "G3", "residential", rng, { lat: 40, lon: -115 }),
    createCity("C7", "Lumen", "G2", "workHub", rng, { lat: 8, lon: 92 }),
    createCity("C8", "Brink", "G1", "mixed", rng, { lat: -28, lon: 130 }),
    createCity("C9", "Cairox", "G3", "mixed", rng, { lat: -36, lon: 8 }),
    createCity("C10", "Vesta", "G2", "residential", rng, { lat: 24, lon: -150 }),
    createCity("C11", "Riven", "G1", "workHub", rng, { lat: 5, lon: -168 }),
    createCity("C12", "Kepler", "G2", "mixed", rng, { lat: -42, lon: 76 }),
    createCity("C13", "Solis", "G3", "residential", rng, { lat: 48, lon: 28 }),
    createCity("C14", "Noct", "G1", "mixed", rng, { lat: -6, lon: -112 }),
    createCity("C15", "Talon", "G2", "workHub", rng, { lat: 14, lon: 146 }),
    createCity("C16", "Fjord", "G3", "residential", rng, { lat: 55, lon: -42 }),
    createCity("C17", "Mistral", "G2", "mixed", rng, { lat: -22, lon: -142 }),
    createCity("C18", "Pavo", "G1", "workHub", rng, { lat: 2, lon: 122 }),
    createCity("C19", "Galea", "G3", "mixed", rng, { lat: 36, lon: 64 }),
    createCity("C20", "Iris", "G2", "residential", rng, { lat: -48, lon: -18 }),
    createCity("C21", "Quill", "G1", "mixed", rng, { lat: 18, lon: -84 }),
    createCity("C22", "Rook", "G3", "workHub", rng, { lat: -12, lon: 168 }),
    createCity("C23", "Sable", "G2", "mixed", rng, { lat: 44, lon: -170 }),
    createCity("C24", "Thorn", "G1", "residential", rng, { lat: -30, lon: 34 }),
    createCity("C25", "Umber", "G2", "workHub", rng, { lat: 10, lon: -6 })
  ];

  const edges = [
    createEdge("E1", "C1", "C2", 0.85),
    createEdge("E2", "C1", "C3", 0.6),
    createEdge("E3", "C3", "C2", 0.7),
    createEdge("E4", "C3", "C4", 0.9),
    createEdge("E5", "C4", "C2", 0.75),
    createEdge("E6", "C2", "C5", 0.35),
    createEdge("E7", "C4", "C5", 0.4),
    createEdge("E8", "C1", "C6", 0.74),
    createEdge("E9", "C2", "C7", 0.83),
    createEdge("E10", "C5", "C8", 0.62),
    createEdge("E11", "C4", "C9", 0.78),
    createEdge("E12", "C6", "C10", 0.67),
    createEdge("E13", "C10", "C11", 0.58),
    createEdge("E14", "C8", "C12", 0.72),
    createEdge("E15", "C2", "C13", 0.69),
    createEdge("E16", "C6", "C14", 0.55),
    createEdge("E17", "C7", "C15", 0.81),
    createEdge("E18", "C12", "C3", 0.66),
    createEdge("E19", "C9", "C14", 0.6),
    createEdge("E20", "C11", "C14", 0.57),
    createEdge("E21", "C13", "C7", 0.76),
    createEdge("E22", "C15", "C8", 0.52),
    createEdge("E23", "C13", "C16", 0.72),
    createEdge("E24", "C14", "C17", 0.59),
    createEdge("E25", "C15", "C18", 0.77),
    createEdge("E26", "C7", "C19", 0.7),
    createEdge("E27", "C9", "C20", 0.64),
    createEdge("E28", "C5", "C21", 0.61),
    createEdge("E29", "C18", "C22", 0.82),
    createEdge("E30", "C10", "C23", 0.55),
    createEdge("E31", "C12", "C24", 0.68),
    createEdge("E32", "C2", "C25", 0.8),
    createEdge("E33", "C16", "C23", 0.58),
    createEdge("E34", "C17", "C21", 0.62),
    createEdge("E35", "C20", "C24", 0.66),
    createEdge("E36", "C25", "C19", 0.63)
  ];

  const nations = createInitialNations(cities, rng);
  const spheres = createDefaultSpheres();
  const citySphereState = createInitialCitySphereState(cities, spheres, rng);
  const communities = createDefaultCommunities(cities, rng);
  const institutions = createDefaultInstitutions(cities);
  return new SphereWorld({ layers, geoZones, cities, edges, nations, spheres, communities, institutions, citySphereState });
}

function createCity(id, name, geoZoneId, cityType, rng, geo) {
  const population = Math.floor(rng.range(4000, 15000));
  return {
    id,
    name,
    geoZoneId,
    cityType,
    geo,
    population,
    metrics: {
      productivity: rng.range(0.5, 1.1),
      wageLevel: rng.range(0.5, 1.2),
      costOfLiving: rng.range(0.4, 1.1),
      inequality: rng.range(0.2, 0.8),
      trust: rng.range(0.3, 0.8),
      safety: rng.range(0.3, 0.9),
      congestion: rng.range(0.15, 0.65),
      employmentCapacity: rng.range(0.45, 0.95),
      instabilityRisk: rng.range(0.05, 0.2)
    },
    lifecycle: {
      riseScore: rng.range(0.2, 0.6),
      declineScore: rng.range(0.1, 0.4),
      status: "stable"
    },
    resources: createCityResourceProfile({ rng, cityType, geo, population })
  };
}

function createEdge(id, fromCityId, toCityId, connectivity) {
  return {
    id,
    fromCityId,
    toCityId,
    connectivity,
    gatewayRestriction: connectivity < 0.5 ? "permit" : "open"
  };
}

function createInitialNations(cities, rng) {
  const nationDefs = [
    { id: "N1", name: "Aurora League", color: "#7cc4ff", cityIds: [] },
    { id: "N2", name: "Helix Dominion", color: "#ffd08a", cityIds: [] },
    { id: "N3", name: "Verdant Pact", color: "#92f3bf", cityIds: [] },
    { id: "N4", name: "Obsidian Union", color: "#f1a0a0", cityIds: [] }
  ];

  const seeds = [];
  const pool = cities.slice();
  for (const nation of nationDefs) {
    if (pool.length === 0) {
      break;
    }
    const idx = Math.floor(rng.range(0, pool.length));
    const city = pool.splice(Math.min(pool.length - 1, idx), 1)[0];
    city.nationId = nation.id;
    nation.cityIds.push(city.id);
    nation.capitalCityId = city.id;
    seeds.push({ nationId: nation.id, lat: city.geo.lat, lon: city.geo.lon });
  }

  for (const city of pool) {
    let bestNationId = seeds[0]?.nationId ?? nationDefs[0].id;
    let bestScore = -Infinity;
    for (const seed of seeds) {
      const d = geoDistance(city.geo, seed);
      const randomBias = rng.range(-6, 9);
      const score = 1 / Math.max(1, d + 20) + randomBias * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestNationId = seed.nationId;
      }
    }
    city.nationId = bestNationId;
    const nation = nationDefs.find((n) => n.id === bestNationId);
    if (nation) {
      nation.cityIds.push(city.id);
    }
  }
  for (const nation of nationDefs) {
    nation.capitalCityId = nation.capitalCityId ?? nation.cityIds[0] ?? null;
  }
  return nationDefs;
}

function geoDistance(a, b) {
  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;
  return Math.hypot(dLat, dLon);
}

function createCityResourceProfile({ rng, cityType, geo, population }) {
  const absLat = Math.abs(geo?.lat ?? 0);
  const dryness = clamp(absLat / 90, 0, 1);
  const industryBias = cityType === "workHub" ? 1.2 : cityType === "mixed" ? 1 : 0.82;
  const agriBias = cityType === "residential" ? 1.2 : cityType === "mixed" ? 1 : 0.85;
  const waterCap = Math.floor(rng.range(900, 1800) * (1.1 - dryness * 0.55));
  const foodCap = Math.floor(rng.range(800, 1650) * agriBias * (1.05 - dryness * 0.25));
  const fossilCap = Math.floor(rng.range(600, 1600) * industryBias);
  const renewableCap = Math.floor(rng.range(700, 1700) * (0.8 + dryness * 0.45));
  const metalsCap = Math.floor(rng.range(500, 1500) * industryBias);
  const rareCap = Math.floor(rng.range(180, 720) * (cityType === "workHub" ? 1.18 : 0.96));
  const humanCap = Math.max(population, Math.floor(population * rng.range(1.25, 1.95)));
  return {
    water: {
      stock: waterCap * rng.range(0.45, 0.82),
      capacity: waterCap,
      regenRate: rng.range(0.65, 1.25),
      extractionRate: rng.range(0.75, 1.15)
    },
    food: {
      stock: foodCap * rng.range(0.42, 0.8),
      capacity: foodCap,
      regenRate: rng.range(0.6, 1.18),
      extractionRate: rng.range(0.72, 1.18)
    },
    energy_fossil: {
      stock: fossilCap * rng.range(0.42, 0.88),
      capacity: fossilCap,
      regenRate: rng.range(0.02, 0.08),
      extractionRate: rng.range(0.85, 1.2)
    },
    energy_renewable: {
      stock: renewableCap * rng.range(0.55, 0.95),
      capacity: renewableCap,
      regenRate: rng.range(0.75, 1.4),
      extractionRate: rng.range(0.58, 1.02)
    },
    metals_bulk: {
      stock: metalsCap * rng.range(0.4, 0.86),
      capacity: metalsCap,
      regenRate: rng.range(0.04, 0.12),
      extractionRate: rng.range(0.8, 1.24)
    },
    rare_minerals: {
      stock: rareCap * rng.range(0.35, 0.8),
      capacity: rareCap,
      regenRate: rng.range(0.01, 0.04),
      extractionRate: rng.range(0.76, 1.28)
    },
    human: {
      stock: population,
      capacity: humanCap,
      regenRate: rng.range(0.2, 0.5),
      extractionRate: 1,
      quality: rng.range(0.4, 0.86)
    }
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function ensureCurrencyState(world) {
  world.systemState = world.systemState ?? {};
  world.systemState.currencies = world.systemState.currencies ?? {
    baseCode: "SCU",
    fxAgainstBase: {},
    inflation: {},
    policyRate: {},
    updatedDay: -1
  };
  const cur = world.systemState.currencies;
  cur.baseCode = cur.baseCode ?? "SCU";
  cur.fxAgainstBase = cur.fxAgainstBase ?? {};
  cur.inflation = cur.inflation ?? {};
  cur.policyRate = cur.policyRate ?? {};
  for (const nation of world.nations ?? []) {
    if (!Number.isFinite(cur.fxAgainstBase[nation.id])) {
      cur.fxAgainstBase[nation.id] = 1;
    }
    if (!Number.isFinite(cur.inflation[nation.id])) {
      cur.inflation[nation.id] = 0.012;
    }
    if (!Number.isFinite(cur.policyRate[nation.id])) {
      cur.policyRate[nation.id] = 0.02;
    }
  }
}

function ensureSphereState(world) {
  world.spheres = world.spheres ?? [];
  world.communities = world.communities ?? [];
  world.institutions = world.institutions ?? [];
  world.citySphereState = world.citySphereState ?? {};
}

function ensureCityGeoZoneState(world) {
  const fallback = "G2";
  for (const city of world.cities ?? []) {
    if (!city.geoZoneId) {
      city.geoZoneId = mapLegacyLayerToGeoZone(city.layerId) ?? fallback;
    }
    if (city.layerId && /^L\d+$/i.test(String(city.layerId))) {
      delete city.layerId;
    }
  }
  world.geoZones = world.geoZones ?? [
    { id: "G1", name: "Inner Core", accessLevel: "restricted" },
    { id: "G2", name: "Urban Belt", accessLevel: "mixed" },
    { id: "G3", name: "Outer Ring", accessLevel: "open" }
  ];
}

function ensureRoleLayerState(world) {
  const hasLegacyGeoLayers =
    Array.isArray(world.layers) &&
    world.layers.length > 0 &&
    world.layers.every((l) => /^L\d+$/i.test(String(l?.id ?? "")));
  if (hasLegacyGeoLayers && (!Array.isArray(world.geoZones) || world.geoZones.length === 0)) {
    world.geoZones = world.layers.map((l) => ({
      id:
        l.id === "L1" ? "G1"
        : l.id === "L2" ? "G2"
        : l.id === "L3" ? "G3"
        : `G${String(l.id).replace(/\D+/g, "") || "2"}`,
      name: l.name ?? "Geo Zone",
      accessLevel: l.accessLevel ?? "mixed"
    }));
  }
  world.layers = [
    { id: "Layer0", name: "Person", roleType: "person" },
    { id: "Layer1", name: "Community", roleType: "community" },
    { id: "Layer2", name: "Institution", roleType: "institution" }
  ];
}

function mapLegacyLayerToGeoZone(layerId) {
  if (layerId === "L1") {
    return "G1";
  }
  if (layerId === "L2") {
    return "G2";
  }
  if (layerId === "L3") {
    return "G3";
  }
  return null;
}

function createDefaultSpheres() {
  return [
    {
      id: "S1",
      name: "Open Sphere",
      nestLevel: 0,
      rankingPolicy: "neutral",
      moderationStrength: 0.45,
      shareFriction: 0.28,
      botPressure: 0.14,
      credibilityWeight: 0.56,
      crossSphereFriction: 0.22
    },
    {
      id: "S2",
      name: "Amplifier Sphere",
      nestLevel: 1,
      rankingPolicy: "outrage_boost",
      moderationStrength: 0.2,
      shareFriction: 0.15,
      botPressure: 0.38,
      credibilityWeight: 0.34,
      crossSphereFriction: 0.32
    },
    {
      id: "S3",
      name: "Curated Sphere",
      nestLevel: 2,
      rankingPolicy: "health_boost",
      moderationStrength: 0.72,
      shareFriction: 0.42,
      botPressure: 0.08,
      credibilityWeight: 0.74,
      crossSphereFriction: 0.4
    }
  ];
}

function createInitialCitySphereState(cities, spheres, rng) {
  const out = {};
  for (const city of cities ?? []) {
    out[city.id] = {};
    for (const sphere of spheres ?? []) {
      out[city.id][sphere.id] = {
        rumorRate: Number(rng.range(0.08, 0.42).toFixed(4)),
        trustDecay: Number(rng.range(0.04, 0.24).toFixed(4)),
        feedMix: Number(rng.range(0.42, 0.74).toFixed(4)),
        localNarrativeBias: Number(rng.range(0.2, 0.52).toFixed(4))
      };
    }
  }
  return out;
}

function createDefaultCommunities(cities, rng) {
  const templates = [
    { id: "COM1", name: "Trade Guild Arc", type: "company" },
    { id: "COM2", name: "River Covenant", type: "religion" },
    { id: "COM3", name: "Neighborhood Assembly", type: "neighborhood" },
    { id: "COM4", name: "Night Mechanics Club", type: "hobby" }
  ];
  return templates.map((t) => ({
    ...t,
    roleLayer: "Layer1",
    cohesion: Number(rng.range(0.4, 0.78).toFixed(3)),
    gatekeeping: Number(rng.range(0.22, 0.68).toFixed(3)),
    normStrength: Number(rng.range(0.3, 0.75).toFixed(3)),
    outgroupPenalty: Number(rng.range(0.2, 0.64).toFixed(3)),
    roles: ["elder", "moderator", "storyteller", "gatekeeper"],
    memberCityUids: (cities ?? [])
      .slice(0, Math.min(8, cities.length))
      .map((c) => c.id)
  }));
}

function createDefaultInstitutions(cities) {
  return [
    {
      id: "INST1",
      name: "Civic Council",
      type: "gov",
      roleLayer: "Layer2",
      jurisdiction: (cities ?? []).slice(0, Math.min(10, cities.length)).map((c) => c.id),
      regulationStrength: 0.56,
      enforcement: 0.58,
      officialNarrativeBoost: 0.42,
      crisisMode: false
    },
    {
      id: "INST2",
      name: "Protocol Authority",
      type: "platform",
      roleLayer: "Layer2",
      jurisdiction: (cities ?? []).slice(Math.max(0, (cities?.length ?? 0) - 10)).map((c) => c.id),
      regulationStrength: 0.62,
      enforcement: 0.54,
      officialNarrativeBoost: 0.5,
      crisisMode: false
    }
  ];
}
