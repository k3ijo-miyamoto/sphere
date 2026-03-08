const PERSON_STATES = ["Home", "Commute", "Work", "Leisure", "Sleep"];

export const PERSONALITY_KEYS = [
  "riskTolerance",
  "sociability",
  "conformity",
  "familyOriented",
  "openness",
  "discipline",
  "noveltySeeking",
  "patience"
];

export const ABILITY_KEYS = [
  "cognitive",
  "productivity",
  "charisma",
  "health",
  "stressResilience",
  "creativity",
  "attention"
];

const NAME_BANK = {
  Solaris: {
    first: ["Arin", "Liora", "Soren", "Nami", "Kael", "Eris", "Toma", "Yuna", "Rei", "Darin"],
    last: ["Sunward", "Helion", "Auric", "Rayne", "Solis", "Brighton", "Veyl", "Cinder", "Vale", "Hale"]
  },
  River: {
    first: ["Mio", "Ren", "Aoi", "Shin", "Noa", "Haru", "Kira", "Yori", "Saki", "Toru"],
    last: ["Mizuno", "Kawara", "Asahi", "Minase", "Nagiri", "Amano", "Shirase", "Takane", "Seno", "Kuroda"]
  },
  Stone: {
    first: ["Bram", "Edda", "Tor", "Mara", "Ivo", "Runa", "Galen", "Petra", "Nils", "Kora"],
    last: ["Granite", "Fjord", "Kest", "Dorn", "Ridge", "Halberg", "Morne", "Stroud", "Kald", "Brigg"]
  },
  Free: {
    first: ["Alex", "Jordan", "Casey", "Riley", "Morgan", "Parker", "Taylor", "Avery", "Kai", "Rowan"],
    last: ["Lane", "Reed", "Quinn", "Sawyer", "Frost", "Mercer", "Nova", "Cruz", "Flynn", "Blake"]
  }
};

export function createPerson({
  id,
  rng,
  homeCityId,
  workCityId,
  religion,
  usedNames,
  age,
  sex,
  traits,
  ability,
  socioeconomic,
  parents,
  generation,
  lineageRootId,
  genetics,
  epigenetics,
  sphereAffinities,
  beliefVector,
  attentionBudget,
  influence,
  trustGraph
}) {
  const resolvedGenetics = genetics ?? createRandomGenetics(rng);
  const resolvedEpigenetics = epigenetics ?? createEmptyEpigenetics();
  const phenotype =
    traits && ability
      ? { traits, ability }
      : derivePhenotypeFromGenetics(resolvedGenetics, resolvedEpigenetics, {
          personalityShift: 0,
          abilityShift: 0
        });
  const socio = socioeconomic ?? {};
  const baseWealth = clamp01(
    Number.isFinite(socio.wealth)
      ? socio.wealth
      : rng.range(0, 1)
  );
  const cash =
    Number.isFinite(socio.cash) ? socio.cash : clamp01(baseWealth * rng.range(0.25, 0.7));
  const realEstate =
    Number.isFinite(socio.realEstate) ? socio.realEstate : clamp01(baseWealth * rng.range(0.15, 0.62));
  const stocks =
    Number.isFinite(socio.stocks) ? socio.stocks : clamp01(baseWealth * rng.range(0.08, 0.55));
  const bankDeposit =
    Number.isFinite(socio.bankDeposit) ? socio.bankDeposit : clamp01(baseWealth * rng.range(0.06, 0.28));
  const debt =
    Number.isFinite(socio.debt) ? clamp01(socio.debt) : clamp01(baseWealth * rng.range(0.01, 0.12));
  const wealth = clamp01(
    Number.isFinite(socio.wealth)
      ? socio.wealth
      : cash * 0.32 + realEstate * 0.28 + stocks * 0.22 + bankDeposit * 0.18 - debt * 0.25
  );

  return {
    id,
    name: generateName({ rng, religion, id, usedNames }),
    age: age ?? Math.floor(rng.range(18, 65)),
    sex: sex ?? (rng.next() < 0.5 ? "F" : "M"),
    religion,
    roleLayer: "Layer0",
    homeCityId,
    homeCityUid: homeCityId,
    workCityId,
    currentCityId: homeCityId,
    currentState: "Home",
    energy: rng.range(0.55, 1.0),
    fatigue: rng.range(0.0, 0.25),
    traits: phenotype.traits,
    ability: phenotype.ability,
    genetics: resolvedGenetics,
    epigenetics: resolvedEpigenetics,
    socioeconomic: {
      wealth,
      cash,
      realEstate,
      stocks,
      bankDeposit,
      debt,
      skill: Number.isFinite(socio.skill) ? socio.skill : rng.range(0.1, 0.8),
      education: Number.isFinite(socio.education) ? socio.education : rng.range(0.1, 0.9)
    },
    employed: rng.next() < 0.82,
    employerId: null,
    profession: "generalist",
    publicService: {
      branch: null,
      responsibility: 0,
      lastAssignedDay: -1
    },
    workStrategy: {
      cooperationBias: rng.range(0.35, 0.88),
      processDiscipline: rng.range(0.3, 0.9)
    },
    incomeLastTick: 0,
    experience: rng.range(0, 0.35),
    partnerId: null,
    partnerSinceDay: null,
    relationshipQuality: rng.range(0.4, 0.7),
    householdStability: rng.range(0.45, 0.75),
    cohabiting: false,
    parents: parents ?? [],
    childrenIds: [],
    generation: generation ?? 0,
    lineageRootId: lineageRootId ?? id,
    lastBreakupDay: null,
    social: {
      ties: {},
      updatedDay: -1
    },
    sphereAffinities: normalizeAffinities(sphereAffinities, rng),
    beliefVector: {
      orderOrientation: clamp01(beliefVector?.orderOrientation ?? rng.range(0.25, 0.75)),
      antiEstablishment: clamp01(beliefVector?.antiEstablishment ?? rng.range(0.2, 0.75)),
      conspiracyResistance: clamp01(beliefVector?.conspiracyResistance ?? rng.range(0.25, 0.78))
    },
    attentionBudget: clamp01(Number.isFinite(attentionBudget) ? attentionBudget : rng.range(0.45, 0.95)),
    influence: clamp01(Number.isFinite(influence) ? influence : rng.range(0.02, 0.32)),
    trustGraph: {
      person: clamp01(trustGraph?.person ?? rng.range(0.35, 0.74)),
      community: clamp01(trustGraph?.community ?? rng.range(0.3, 0.78)),
      media: clamp01(trustGraph?.media ?? rng.range(0.25, 0.72)),
      institution: clamp01(trustGraph?.institution ?? rng.range(0.28, 0.75))
    }
  };
}

export function createRandomGenetics(rng) {
  return {
    loci: {
      personality: Object.fromEntries(PERSONALITY_KEYS.map((k, i) => [k, i])),
      ability: Object.fromEntries(ABILITY_KEYS.map((k, i) => [k, i]))
    },
    personalityChromosomes: [createRandomChromosome(PERSONALITY_KEYS, rng), createRandomChromosome(PERSONALITY_KEYS, rng)],
    abilityChromosomes: [createRandomChromosome(ABILITY_KEYS, rng), createRandomChromosome(ABILITY_KEYS, rng)],
    dominance: {
      personality: [createRandomChromosome(PERSONALITY_KEYS, rng), createRandomChromosome(PERSONALITY_KEYS, rng)],
      ability: [createRandomChromosome(ABILITY_KEYS, rng), createRandomChromosome(ABILITY_KEYS, rng)]
    }
  };
}

export function createGeneticsFromPhenotype(traits, ability, rng) {
  const genetics = createRandomGenetics(rng);
  imprintPhenotype(genetics.personalityChromosomes, genetics.dominance.personality, PERSONALITY_KEYS, traits, rng);
  imprintPhenotype(genetics.abilityChromosomes, genetics.dominance.ability, ABILITY_KEYS, ability, rng);
  return genetics;
}

export function createEmptyEpigenetics() {
  return {
    personality: Object.fromEntries(PERSONALITY_KEYS.map((k) => [k, 0])),
    ability: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 0]))
  };
}

export function recombineGenetics(motherGenetics, fatherGenetics, rng, options = {}) {
  const crossoverRate = options.crossoverRate ?? 0.22;
  const personalityMutation = options.personalityMutation ?? 0.12;
  const abilityMutation = options.abilityMutation ?? 0.05;
  const dominanceMutation = options.dominanceMutation ?? 0.03;

  const childPersonalityMaternal = makeGamete(
    motherGenetics.personalityChromosomes,
    PERSONALITY_KEYS,
    rng,
    crossoverRate
  );
  const childPersonalityPaternal = makeGamete(
    fatherGenetics.personalityChromosomes,
    PERSONALITY_KEYS,
    rng,
    crossoverRate
  );
  const childAbilityMaternal = makeGamete(
    motherGenetics.abilityChromosomes,
    ABILITY_KEYS,
    rng,
    crossoverRate
  );
  const childAbilityPaternal = makeGamete(
    fatherGenetics.abilityChromosomes,
    ABILITY_KEYS,
    rng,
    crossoverRate
  );
  const domPersonalityMaternal = makeGamete(
    motherGenetics.dominance.personality,
    PERSONALITY_KEYS,
    rng,
    crossoverRate
  );
  const domPersonalityPaternal = makeGamete(
    fatherGenetics.dominance.personality,
    PERSONALITY_KEYS,
    rng,
    crossoverRate
  );
  const domAbilityMaternal = makeGamete(
    motherGenetics.dominance.ability,
    ABILITY_KEYS,
    rng,
    crossoverRate
  );
  const domAbilityPaternal = makeGamete(
    fatherGenetics.dominance.ability,
    ABILITY_KEYS,
    rng,
    crossoverRate
  );

  mutateChromosome(childPersonalityMaternal, PERSONALITY_KEYS, personalityMutation, rng);
  mutateChromosome(childPersonalityPaternal, PERSONALITY_KEYS, personalityMutation, rng);
  mutateChromosome(childAbilityMaternal, ABILITY_KEYS, abilityMutation, rng);
  mutateChromosome(childAbilityPaternal, ABILITY_KEYS, abilityMutation, rng);
  mutateChromosome(domPersonalityMaternal, PERSONALITY_KEYS, dominanceMutation, rng);
  mutateChromosome(domPersonalityPaternal, PERSONALITY_KEYS, dominanceMutation, rng);
  mutateChromosome(domAbilityMaternal, ABILITY_KEYS, dominanceMutation, rng);
  mutateChromosome(domAbilityPaternal, ABILITY_KEYS, dominanceMutation, rng);

  return {
    loci: {
      personality: Object.fromEntries(PERSONALITY_KEYS.map((k, i) => [k, i])),
      ability: Object.fromEntries(ABILITY_KEYS.map((k, i) => [k, i]))
    },
    personalityChromosomes: [childPersonalityMaternal, childPersonalityPaternal],
    abilityChromosomes: [childAbilityMaternal, childAbilityPaternal],
    dominance: {
      personality: [domPersonalityMaternal, domPersonalityPaternal],
      ability: [domAbilityMaternal, domAbilityPaternal]
    }
  };
}

export function derivePhenotypeFromGenetics(genetics, epigenetics = createEmptyEpigenetics(), environment = {}) {
  const personalityShift = environment.personalityShift ?? 0;
  const abilityShift = environment.abilityShift ?? 0;
  const traits = {};
  const ability = {};

  for (const key of PERSONALITY_KEYS) {
    const a1 = genetics.personalityChromosomes[0][key];
    const a2 = genetics.personalityChromosomes[1][key];
    const d1 = genetics.dominance.personality[0][key];
    const d2 = genetics.dominance.personality[1][key];
    const epi = epigenetics.personality[key] ?? 0;
    traits[key] = clamp01(expressDiploidLocus(a1, a2, d1, d2) + epi + personalityShift);
  }

  for (const key of ABILITY_KEYS) {
    const a1 = genetics.abilityChromosomes[0][key];
    const a2 = genetics.abilityChromosomes[1][key];
    const d1 = genetics.dominance.ability[0][key];
    const d2 = genetics.dominance.ability[1][key];
    const epi = epigenetics.ability[key] ?? 0;
    ability[key] = clamp01(expressDiploidLocus(a1, a2, d1, d2) + epi + abilityShift);
  }
  return { traits, ability };
}

export function clampState(candidate) {
  return PERSON_STATES.includes(candidate) ? candidate : "Home";
}

function expressDiploidLocus(a1, a2, d1, d2) {
  const dominanceBias = (d1 - d2) * 0.26;
  const codominant = (a1 + a2) * 0.5;
  return codominant + (a1 - a2) * dominanceBias;
}

function createRandomChromosome(keys, rng) {
  const out = {};
  for (const key of keys) {
    out[key] = rng.range(0, 1);
  }
  return out;
}

function makeGamete(chromosomes, keys, rng, crossoverRate) {
  let active = rng.next() < 0.5 ? 0 : 1;
  const out = {};
  for (const key of keys) {
    if (rng.next() < crossoverRate) {
      active = 1 - active;
    }
    out[key] = chromosomes[active][key];
  }
  return out;
}

function mutateChromosome(chromosome, keys, mutation, rng) {
  for (const key of keys) {
    chromosome[key] = clamp01(chromosome[key] + rng.range(-mutation, mutation));
  }
}

function imprintPhenotype(chromosomes, dominance, keys, phenotype, rng) {
  for (const key of keys) {
    const base = clamp01(phenotype?.[key] ?? rng.range(0, 1));
    chromosomes[0][key] = clamp01(base + rng.range(-0.08, 0.08));
    chromosomes[1][key] = clamp01(base + rng.range(-0.08, 0.08));
    dominance[0][key] = clamp01(0.5 + rng.range(-0.25, 0.25));
    dominance[1][key] = clamp01(0.5 + rng.range(-0.25, 0.25));
  }
}

function generateName({ rng, religion, id, usedNames }) {
  const bank = NAME_BANK[religion] ?? NAME_BANK.Free;
  const first = pickOne(bank.first, rng);
  const last = pickOne(bank.last, rng);
  const base = `${first} ${last}`;

  if (!usedNames) {
    return base;
  }

  const count = usedNames.get(base) ?? 0;
  usedNames.set(base, count + 1);
  return count === 0 ? base : `${base} ${count + 1}`;
}

function pickOne(list, rng) {
  const idx = Math.floor(rng.range(0, list.length));
  const safeIdx = Math.min(list.length - 1, idx);
  return list[safeIdx] ?? `Citizen${idx}`;
}

function normalizeAffinities(raw, rng) {
  const fallback = { S1: 0.5, S2: 0.3, S3: 0.2 };
  const source = raw && typeof raw === "object" ? raw : fallback;
  const keys = Object.keys(source);
  if (!keys.length) {
    return fallback;
  }
  let sum = 0;
  const out = {};
  for (const key of keys) {
    const v = clamp01(Number.isFinite(source[key]) ? source[key] : rng.range(0.1, 0.8));
    out[key] = v;
    sum += v;
  }
  if (sum <= 0.0001) {
    return fallback;
  }
  for (const key of Object.keys(out)) {
    out[key] = Number((out[key] / sum).toFixed(6));
  }
  return out;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
