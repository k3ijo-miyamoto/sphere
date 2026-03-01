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
  engine.world.cities = snapshot.world.cities;
  engine.world.edges = snapshot.world.edges;
  engine.world.nations = snapshot.world.nations ?? [];
  engine.world.cityIndex = new Map(engine.world.cities.map((city) => [city.id, city]));
  engine.world.nationIndex = new Map(engine.world.nations.map((nation) => [nation.id, nation]));

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
