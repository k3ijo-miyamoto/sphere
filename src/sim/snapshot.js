export function createSnapshot(engine) {
  return {
    clock: {
      day: engine.clock.day,
      minuteOfDay: engine.clock.minuteOfDay
    },
    rngState: engine.rng.state,
    world: JSON.parse(JSON.stringify(engine.world)),
    people: JSON.parse(JSON.stringify(engine.population.people)),
    nextPersonId: engine.population.nextPersonId,
    companies: JSON.parse(JSON.stringify(engine.population.companies ?? [])),
    history: JSON.parse(JSON.stringify(engine.history ?? [])),
    historyCursor: engine.historyCursor ?? -1
  };
}

export function loadSnapshot(engine, snapshot) {
  engine.clock.day = snapshot.clock.day;
  engine.clock.minuteOfDay = snapshot.clock.minuteOfDay;
  engine.rng.state = snapshot.rngState;

  engine.world.layers = snapshot.world.layers;
  engine.world.geoZones = snapshot.world.geoZones ?? engine.world.geoZones ?? [];
  engine.world.cities = snapshot.world.cities;
  engine.world.edges = snapshot.world.edges;
  engine.world.nations = snapshot.world.nations ?? [];
  engine.world.spheres = snapshot.world.spheres ?? engine.world.spheres ?? [];
  engine.world.communities = snapshot.world.communities ?? engine.world.communities ?? [];
  engine.world.institutions = snapshot.world.institutions ?? engine.world.institutions ?? [];
  engine.world.citySphereState = snapshot.world.citySphereState ?? engine.world.citySphereState ?? {};
  engine.world.cityIndex = new Map(engine.world.cities.map((city) => [city.id, city]));
  engine.world.nationIndex = new Map(engine.world.nations.map((nation) => [nation.id, nation]));
  const hasLegacyGeoLayers =
    Array.isArray(engine.world.layers) &&
    engine.world.layers.length > 0 &&
    engine.world.layers.every((l) => /^L\d+$/i.test(String(l?.id ?? "")));
  if (hasLegacyGeoLayers && (!Array.isArray(engine.world.geoZones) || engine.world.geoZones.length === 0)) {
    engine.world.geoZones = engine.world.layers.map((l) => ({
      id:
        l.id === "L1" ? "G1"
        : l.id === "L2" ? "G2"
        : l.id === "L3" ? "G3"
        : `G${String(l.id).replace(/\D+/g, "") || "2"}`,
      name: l.name ?? "Geo Zone",
      accessLevel: l.accessLevel ?? "mixed"
    }));
  }
  engine.world.layers = [
    { id: "Layer0", name: "Person", roleType: "person" },
    { id: "Layer1", name: "Community", roleType: "community" },
    { id: "Layer2", name: "Institution", roleType: "institution" }
  ];
  for (const city of engine.world.cities) {
    if (!city.geoZoneId) {
      city.geoZoneId =
        city.layerId === "L1" ? "G1"
        : city.layerId === "L2" ? "G2"
        : city.layerId === "L3" ? "G3"
        : "G2";
    }
    if (city.layerId && /^L\d+$/i.test(String(city.layerId))) {
      delete city.layerId;
    }
  }

  engine.population.people = snapshot.people;
  engine.population.nextPersonId = snapshot.nextPersonId;
  engine.population.companies = snapshot.companies ?? [];
  engine.population.companiesByCity = new Map(engine.world.cities.map((city) => [city.id, []]));
  for (const company of engine.population.companies) {
    const arr = engine.population.companiesByCity.get(company.cityId) ?? [];
    arr.push(company);
    engine.population.companiesByCity.set(company.cityId, arr);
  }
  engine.history = snapshot.history ?? [];
  engine.historyCursor = snapshot.historyCursor ?? Math.max(-1, engine.history.length - 1);
}
