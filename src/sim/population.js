import {
  ABILITY_KEYS,
  PERSONALITY_KEYS,
  clampState,
  createEmptyEpigenetics,
  createGeneticsFromPhenotype,
  createPerson,
  derivePhenotypeFromGenetics,
  recombineGenetics
} from "./person.js";
import { RELIGION_BIBLES, RELIGION_NAMES } from "../data/religionBibles.js";

const RELIGION_PROFILES = RELIGION_BIBLES;
const COMPANY_RL_ACTIONS = ["balanced", "margin_focus", "labor_focus", "innovation_focus"];
const INVESTMENT_RL_ACTIONS = ["conservative", "balanced", "aggressive"];
const EDUCATION_RL_ACTIONS = ["balanced", "foundation_first", "tertiary_push", "retention_support", "equity_support"];

export class PopulationSystem {
  constructor({ world, config, rng }) {
    this.world = world;
    this.config = config;
    this.rng = rng;
    this.people = [];
    this.usedNames = new Map();
    this.focusCityIds = [];
    this.nextPersonId = 1;
    this.companies = [];
    this.companiesByCity = new Map();
    this.nextCompanyId = 1;
    this.lastCompanyLifecycleDay = -1;
    this.lastInstitutionAssignmentDay = -1;
    this.statisticalMemory = {};
    this.phaseTracker = {
      macroRegime: "stable",
      socialRegime: "stable"
    };
    ensureInvestmentInstitutions(world, this.companies, rng);
    this.buildInitialPopulation();
    this.buildInitialCompanies();
    ensureInvestmentInstitutions(world, this.companies, rng);
  }

  buildInitialPopulation() {
    const cityIds = this.world.cities.map((city) => city.id);
    const homeCandidates = this.world.cities
      .filter((city) => city.cityType !== "workHub")
      .map((city) => city.id);
    const workCandidates = this.world.cities
      .filter((city) => city.cityType !== "residential")
      .map((city) => city.id);

    const total = this.config.population.trackedIndividuals;

    for (let i = 0; i < total; i += 1) {
      const homeCityId = pickOne(homeCandidates.length > 0 ? homeCandidates : cityIds, this.rng);
      const workCityId = pickOne(workCandidates.length > 0 ? workCandidates : cityIds, this.rng);

      this.people.push(
        createPerson({
          id: this.nextPersonId,
          rng: this.rng,
          homeCityId,
          workCityId,
          religion: pickOne(RELIGION_NAMES, this.rng),
          usedNames: this.usedNames
        })
      );
      this.nextPersonId += 1;
    }
  }

  buildInitialCompanies() {
    const companies = [];
    for (const city of this.world.cities) {
      const count = city.cityType === "workHub" ? 6 : city.cityType === "mixed" ? 4 : 2;
      const cityCompanies = [];
      for (let i = 0; i < count; i += 1) {
        const company = createCompany({
          id: this.nextCompanyId,
          city,
          world: this.world,
          config: this.config,
          rng: this.rng,
          foundingDay: 0
        });
        assignFounderOwnership({ company, people: this.people, cityId: city.id, day: 0, rng: this.rng });
        this.nextCompanyId += 1;
        companies.push(company);
        cityCompanies.push(company);
      }
      this.companiesByCity.set(city.id, cityCompanies);
    }
    wireSupplyChains(companies, this.world, this.rng);
    this.companies = companies;
  }

  tick({ phase, day, minuteOfDay = 0, dayOfWeek = 0, isWeekend = false }) {
    const roleActionLog = [];
    for (const person of this.people) {
      ensurePersonGenetics(person, this.rng);
      const nextState = resolveState(person, phase, this.rng, isWeekend);
      person.currentState = clampState(nextState);
      updateLocation(person, phase, this.world, this.rng);
      updateEnergy(person);
      updateEpigeneticsAndPhenotype(person, this.world, phase, this.rng);
    }

    applyEmploymentAndEconomy({
      people: this.people,
      world: this.world,
      companies: this.companies,
      companiesByCity: this.companiesByCity,
      phase,
      day,
      config: this.config,
      isWeekend,
      minuteOfDay,
      rng: this.rng
    });

    const demographics = simulateDemographics({
      people: this.people,
      world: this.world,
      rng: this.rng,
      phase,
      day,
      nextPersonId: this.nextPersonId,
      usedNames: this.usedNames,
      religionProfiles: RELIGION_PROFILES
    });
    this.people = demographics.people;
    this.nextPersonId = demographics.nextPersonId;
    applyReligionConversion({
      people: this.people,
      world: this.world,
      rng: this.rng,
      phase,
      baseRate: this.config.religion?.conversionBaseRate ?? 0.002,
      isWeekend,
      weekendBoost: this.config.weekly?.weekendReligionBoost ?? 1
    });
    const migrationResult = applyRelocationMigration({
      people: this.people,
      world: this.world,
      rng: this.rng,
      phase,
      day,
      baseRate: this.config.migration?.nightlyRelocationBaseRate ?? 0.01,
      religionByCity: computeReligionByCity(this.people, this.world),
      religionCompatibilityWeight: this.config.migration?.religionCompatibilityWeight ?? 0.12,
      banditConfig: this.config.migration?.bandit ?? {}
    });
    if (migrationResult?.actions?.length) {
      roleActionLog.push(...migrationResult.actions);
    }
    const communityResult = applyCommunityMembershipDynamics({
      people: this.people,
      world: this.world,
      rng: this.rng,
      phase,
      day
    });
    if (communityResult?.actions?.length) {
      roleActionLog.push(...communityResult.actions);
    }

    const stateCounts = { Home: 0, Commute: 0, Work: 0, Leisure: 0, Sleep: 0 };
    const cityPresence = new Map(this.world.cities.map((city) => [city.id, 0]));
    for (const person of this.people) {
      stateCounts[person.currentState] += 1;
      cityPresence.set(person.currentCityId, (cityPresence.get(person.currentCityId) ?? 0) + 1);
    }
    const statisticalPopulation = buildStatisticalPopulation(cityPresence, this.world, this.statisticalMemory);
    this.statisticalMemory = statisticalPopulation;
    applyStatisticalFeedbackToCities(this.world, statisticalPopulation);
    const institutions = updateInstitutionalSystem({
      people: this.people,
      world: this.world,
      config: this.config,
      rng: this.rng,
      phase,
      day,
      statisticalPopulation,
      shouldAssign: phase === "Night" && this.lastInstitutionAssignmentDay !== day
    });
    if (phase === "Night" && this.lastInstitutionAssignmentDay !== day) {
      this.lastInstitutionAssignmentDay = day;
    }

    this.focusCityIds = this.world.cities
      .slice()
      .sort((a, b) => (cityPresence.get(b.id) ?? 0) - (cityPresence.get(a.id) ?? 0))
      .slice(0, 2)
      .map((city) => city.id);

    const encounterSummary = computeNightEncounters({
      phase,
      people: this.people,
      world: this.world,
      baseRate:
        this.config.social.nightlyEncounterBaseRate *
        (this.config.weekly?.enabled && isWeekend ? this.config.weekly?.weekendNightlifeBoost ?? 1 : 1)
    });
    const weeklyEvents = applyWeeklyDynamics({
      world: this.world,
      people: this.people,
      phase,
      dayOfWeek,
      isWeekend,
      rng: this.rng
    });

    const activeIndividuals = this.people
      .filter((person) => this.focusCityIds.includes(person.currentCityId))
      .slice(0, this.config.population.activeDetailCount)
      .map((person) => ({
        id: person.id,
        name: person.name,
        cityId: person.currentCityId,
        state: person.currentState,
        religion: person.religion,
        age: person.age
      }));
    const nearIndividuals = this.people
      .filter((person) => this.focusCityIds.includes(person.currentCityId))
      .slice(0, Math.max(this.config.population.activeDetailCount * 6, 360))
      .map((person) => ({
        id: person.id,
        name: person.name,
        cityId: person.currentCityId,
        state: person.currentState,
        religion: person.religion,
        age: person.age
      }));

    const highlights = computeHighlights(this.people);
    const geneticsSummary = computeGeneticsSummary(this.people);
    const religionStats = computeReligionStats(this.people, RELIGION_PROFILES);
    const religionByCity = computeReligionByCity(this.people, this.world);
    const lineage = computeLineageSnapshot(this.people);
    const socialNetwork = updateSocialNetwork({
      people: this.people,
      world: this.world,
      phase,
      day,
      rng: this.rng
    });
    let companyEvents = [];
    if (phase === "Night" && this.lastCompanyLifecycleDay !== day) {
      companyEvents = applyCompanyLifecycle({
        companies: this.companies,
        people: this.people,
        world: this.world,
        config: this.config,
        rng: this.rng,
        day,
        nextCompanyIdRef: () => {
          const id = this.nextCompanyId;
          this.nextCompanyId += 1;
          return id;
        }
      });
      this.lastCompanyLifecycleDay = day;
      this.companiesByCity = groupCompaniesByCity(this.companies, this.world);
      wireSupplyChains(this.companies, this.world, this.rng);
    }

    const economy = computeEconomySummary(this.people, this.world);
    this.world.systemState = this.world.systemState ?? {};
    this.world.systemState.lastEconomyByCity = Object.fromEntries(
      (economy.byCity ?? []).map((row) => [row.cityId, row])
    );
    const companySummary = computeCompanySummary(this.companies, this.world);
    const phaseTransition = computePhaseTransitionSignals({
      world: this.world,
      economy,
      demographics: demographics.summary,
      day,
      tracker: this.phaseTracker
    });
    this.phaseTracker = phaseTransition.tracker;
    const events = computePopulationEvents({
      world: this.world,
      demographics: demographics.summary,
      economy,
      day,
      companyEvents,
      weeklyEvents,
      phaseTransitionEvents: phaseTransition.events
    });
    return {
      stateCounts,
      cityPresence: Object.fromEntries(cityPresence.entries()),
      statisticalPopulation,
      focusCityIds: this.focusCityIds,
      activeIndividuals,
      nearIndividuals,
      encounterSummary,
      highlights,
      geneticsSummary,
      religionStats,
      religionByCity,
      economy,
      companies: companySummary,
      events,
      phaseTransitions: phaseTransition.events,
      phaseIndicators: phaseTransition.indicators,
      phaseRegimes: phaseTransition.tracker,
      week: {
        dayOfWeek,
        isWeekend
      },
      demographics: demographics.summary,
      lineage,
      socialNetwork,
      institutions,
      actions: summarizePopulationActionLog(roleActionLog)
    };
  }
}

function updateInstitutionalSystem({ people, world, config, rng, phase, day, statisticalPopulation, shouldAssign }) {
  if (!(config.institutions?.enabled ?? true)) {
    return {
      cooperationIndex: 0,
      publicServiceTotals: { administration: 0, police: 0, judiciary: 0 },
      byCity: {}
    };
  }
  const cityWorkers = new Map(world.cities.map((city) => [city.id, []]));
  const institutionState = ensureInstitutionState(world, config, rng);
  for (const person of people) {
    ensureOccupationProfile(person, rng);
    ensureSchoolProfile(person, rng);
    if (person.currentState === "Work") {
      cityWorkers.get(person.currentCityId)?.push(person);
    }
  }

  let schoolOutcomeByCity = institutionState.lastSchoolOutcomeByCity ?? {};
  if (shouldAssign) {
    updateLongTermStability({ world, config, institutionState, day });
    applyMetaInstitutionReform({ world, config, institutionState, day });
    updateInstitutionPolicies({ world, config, institutionState, day, rng });
    schoolOutcomeByCity = assignSchoolEnrollment({ people, world, statisticalPopulation, config, day, rng, institutionState });
    institutionState.lastSchoolOutcomeByCity = schoolOutcomeByCity;
    updateEducationPolicies({ world, config, institutionState, schoolOutcomeByCity, day, rng });
    assignPublicServiceRoles({ people, world, statisticalPopulation, day, config, institutionState });
    assignPrivateProfessions({ people, world });
  }
  const schoolByCity = summarizeSchoolByCity(people, world);

  const byCity = {};
  let globalCoordinationSum = 0;
  let cityCount = 0;
  for (const city of world.cities) {
    const workers = cityWorkers.get(city.id) ?? [];
    const roleStats = summarizeCityRoles(workers);
    const cityPolicy = institutionState.cities[city.id] ?? null;
    const bestAction = chooseBestOperationalAction(roleStats, cityPolicy);
    const cooperationIndex = computeCooperationIndex(workers, roleStats);
    if (phase === "Daytime") {
      applyOperationalEffects(city, bestAction, cooperationIndex);
      reinforceWorkStrategies(workers, bestAction, cooperationIndex, city);
      cityPolicy.lastObservedReward = computeCityGovernanceReward(city, cooperationIndex, world);
    }
    byCity[city.id] = {
      bestAction,
      cooperationIndex: Number(cooperationIndex.toFixed(3)),
      publicService: roleStats.publicService,
      professions: roleStats.professions,
      policy: cityPolicy
        ? {
            action: cityPolicy.currentAction,
            weights: cityPolicy.weights,
            mutationCount: cityPolicy.mutationCount,
            lastReward: Number((cityPolicy.lastObservedReward ?? 0).toFixed(3))
          }
        : null,
      educationPolicy: cityPolicy?.educationPolicy
        ? {
            action: cityPolicy.educationPolicy.currentAction,
            levers: cityPolicy.educationPolicy.levers,
            lastReward: Number((cityPolicy.educationPolicy.lastObservedReward ?? 0).toFixed(3)),
            updates: cityPolicy.educationPolicy.updates ?? 0
          }
        : null,
      schoolOutcome: schoolOutcomeByCity[city.id] ?? null,
      schools: schoolByCity.get(city.id) ?? { enrolled: 0, byStage: {} }
    };
    globalCoordinationSum += cooperationIndex;
    cityCount += 1;
  }

  const branchTotals = { administration: 0, police: 0, judiciary: 0 };
  for (const person of people) {
    const branch = person.publicService?.branch;
    if (branch && Object.prototype.hasOwnProperty.call(branchTotals, branch)) {
      branchTotals[branch] += 1;
    }
  }

  return {
    cooperationIndex: cityCount > 0 ? Number((globalCoordinationSum / cityCount).toFixed(3)) : 0,
    publicServiceTotals: branchTotals,
    schoolTotals: summarizeSchoolTotals(people),
    mutationCount: institutionState.mutationCount ?? 0,
    policyRevisionCount: institutionState.policyRevisionCount ?? 0,
    policyRevisionRate: Number((institutionState.policyRevisionRate ?? 0).toFixed(4)),
    longTermStability: institutionState.longTermStability?.report ?? null,
    metaGovernance: {
      profile: institutionState.metaGovernance?.profile ?? "adaptive",
      enabled: institutionState.metaGovernance?.enabled ?? true,
      revisionCount: institutionState.metaGovernance?.revisionCount ?? 0,
      lastRevisionDay: institutionState.metaGovernance?.lastRevisionDay ?? -1,
      learningRate: Number((institutionState.learningRate ?? 0).toFixed(3)),
      epsilon: Number((institutionState.epsilon ?? 0).toFixed(3)),
      mutationRate: Number((institutionState.mutationRate ?? 0).toFixed(3)),
      publicStaffRate: Number((institutionState.publicStaffRateOverride ?? (config.institutions?.publicStaffRate ?? 0.17)).toFixed(3))
    },
    byCity
  };
}

function ensureOccupationProfile(person, rng) {
  person.profession = person.profession ?? "generalist";
  person.publicService = person.publicService ?? { branch: null, responsibility: 0, lastAssignedDay: -1 };
  person.workStrategy = person.workStrategy ?? {
    cooperationBias: rng.range(0.35, 0.88),
    processDiscipline: rng.range(0.3, 0.9)
  };
}

function ensureSchoolProfile(person, rng) {
  person.school = person.school ?? {
    enrolled: false,
    stage: "none",
    cityId: null,
    year: 0,
    progress: 0,
    aptitude: rng.range(0.35, 0.92),
    graduated: false
  };
}

function assignPublicServiceRoles({ people, world, statisticalPopulation, day, config, institutionState }) {
  const residentsByCity = new Map(world.cities.map((city) => [city.id, []]));
  for (const person of people) {
    if (person.age >= 20) {
      residentsByCity.get(person.homeCityId)?.push(person);
    }
  }

  const branches = ["administration", "police", "judiciary"];
  for (const city of world.cities) {
    const residents = residentsByCity.get(city.id) ?? [];
    const tracked = statisticalPopulation?.[city.id]?.tracked ?? residents.length;
    const workforce = Math.max(1, tracked);
    const cityPolicy = institutionState.cities[city.id] ?? null;
    const weights = cityPolicy?.weights ?? { administration: 1, police: 1, judiciary: 1 };
    const budgetSum = Math.max(0.0001, weights.administration + weights.police + weights.judiciary);
    const publicStaffRate = clamp(
      institutionState.publicStaffRateOverride ?? config.institutions?.publicStaffRate ?? 0.17,
      0.06,
      0.4
    );
    const totalSlots = Math.max(3, Math.floor(workforce * publicStaffRate));
    const targets = {
      administration: Math.max(1, Math.round((weights.administration / budgetSum) * totalSlots)),
      police: Math.max(1, Math.round((weights.police / budgetSum) * totalSlots)),
      judiciary: Math.max(1, Math.round((weights.judiciary / budgetSum) * totalSlots))
    };
    const selected = new Set();
    for (const branch of branches) {
      const needed = Math.min(residents.length, targets[branch]);
      const ranking = residents
        .map((person) => ({
          person,
          score:
            scorePublicServiceFit(person, branch) +
            (person.publicService?.branch === branch ? 0.09 : 0) +
            (person.homeCityId === city.id ? 0.02 : 0)
        }))
        .sort((a, b) => b.score - a.score);
      let assigned = 0;
      for (const row of ranking) {
        if (assigned >= needed) {
          break;
        }
        if (selected.has(row.person.id)) {
          continue;
        }
        selected.add(row.person.id);
        row.person.publicService.branch = branch;
        row.person.publicService.responsibility = Number(clamp01(row.score / 1.6).toFixed(3));
        row.person.publicService.lastAssignedDay = day;
        row.person.profession = branch;
        assigned += 1;
      }
    }
    for (const person of residents) {
      if (!selected.has(person.id) && person.publicService.branch && person.publicService.lastAssignedDay !== day) {
        person.publicService.branch = null;
        person.publicService.responsibility = 0;
      }
    }
  }
}

function assignPrivateProfessions({ people, world }) {
  const cityTypeBias = {
    residential: ["healthcare", "education", "commerce", "maintenance", "logistics"],
    mixed: ["commerce", "logistics", "healthcare", "education", "manufacturing"],
    workHub: ["manufacturing", "logistics", "research", "commerce", "maintenance"]
  };
  for (const person of people) {
    if (person.school?.enrolled) {
      person.profession = "student";
      person.employed = false;
      person.employerId = null;
      continue;
    }
    if (person.publicService?.branch) {
      continue;
    }
    const city = world.getCityById(person.workCityId) ?? world.getCityById(person.homeCityId);
    const pool = cityTypeBias[city?.cityType ?? "mixed"] ?? cityTypeBias.mixed;
    if (person.profession === "generalist" || !pool.includes(person.profession)) {
      const score = person.ability.productivity + person.ability.cognitive + person.traits.openness;
      const idx = Math.floor(clamp(score * 2.1, 0, pool.length - 1));
      person.profession = pool[idx];
    }
  }
}

function getSchoolStageForAge(age) {
  if (age >= 6 && age <= 12) {
    return "primary";
  }
  if (age >= 13 && age <= 17) {
    return "secondary";
  }
  if (age >= 18 && age <= 22) {
    return "tertiary";
  }
  return "none";
}

function assignSchoolEnrollment({ people, world, statisticalPopulation, config, day, rng, institutionState = null }) {
  if (!(config.educationSystem?.enabled ?? true)) {
    for (const p of people) {
      ensureSchoolProfile(p, rng);
      p.school.enrolled = false;
      p.school.stage = "none";
      p.school.cityId = null;
    }
    return {};
  }
  const baseCap = clamp(config.educationSystem?.schoolCapacityRate ?? 0.22, 0.08, 0.55);
  const tertiaryCap = clamp(config.educationSystem?.tertiaryCapacityRate ?? 0.08, 0.02, 0.2);
  const dropoutBase = clamp(config.educationSystem?.dropoutBaseRate ?? 0.002, 0, 0.03);
  const compulsoryMaxAge = config.educationSystem?.compulsoryMaxAge ?? 17;
  const outcomeByCity = {};
  const residentsByCity = new Map(world.cities.map((city) => [city.id, []]));
  for (const person of people) {
    ensureSchoolProfile(person, rng);
    residentsByCity.get(person.homeCityId)?.push(person);
  }
  for (const city of world.cities) {
    const eduPolicy = institutionState?.cities?.[city.id]?.educationPolicy ?? null;
    const levers = eduPolicy?.levers ?? educationActionToLevers("balanced");
    const residents = residentsByCity.get(city.id) ?? [];
    const tracked = statisticalPopulation?.[city.id]?.tracked ?? residents.length;
    const seats = Math.max(6, Math.floor(Math.max(1, tracked) * baseCap * levers.capacityMultiplier));
    const tertiarySeats = Math.max(2, Math.floor(Math.max(1, tracked) * tertiaryCap * levers.tertiaryMultiplier));
    const cityDropoutBase = clamp(dropoutBase * levers.dropoutMultiplier, 0, 0.06);
    const groups = {
      primary: [],
      secondary: [],
      tertiary: []
    };
    const stats = {
      cityId: city.id,
      eligible: 0,
      enrolled: 0,
      dropoutCount: 0,
      capacityRejected: 0,
      byStage: {
        primary: { eligible: 0, enrolled: 0, dropoutCount: 0, capacityRejected: 0 },
        secondary: { eligible: 0, enrolled: 0, dropoutCount: 0, capacityRejected: 0 },
        tertiary: { eligible: 0, enrolled: 0, dropoutCount: 0, capacityRejected: 0 }
      }
    };
    for (const p of residents) {
      const stage = getSchoolStageForAge(p.age);
      if (stage !== "none") {
        groups[stage].push(p);
        stats.eligible += 1;
        stats.byStage[stage].eligible += 1;
      } else {
        p.school.enrolled = false;
        p.school.stage = "none";
        p.school.cityId = null;
      }
    }
    const assignStage = (stage, maxSeats) => {
      const ranked = groups[stage]
        .map((p) => ({
          p,
          score:
            (p.school?.aptitude ?? 0.5) * 0.42 +
            (p.ability?.cognitive ?? 0.5) * 0.3 +
            (p.traits?.discipline ?? 0.5) * 0.2 +
            (p.socioeconomic?.education ?? 0.5) * 0.08 +
            (levers.stageWeights?.[stage] ?? 1) * 0.1 +
            rng.range(-0.05, 0.05)
        }))
        .sort((a, b) => b.score - a.score);
      let assigned = 0;
      for (const row of ranked) {
        const p = row.p;
        const mandatory = p.age <= compulsoryMaxAge && stage !== "tertiary";
        const allow = mandatory || assigned < maxSeats;
        const dropoutRisk =
          cityDropoutBase * (1 - (p.school?.aptitude ?? 0.5)) * (1.1 - (p.traits?.discipline ?? 0.5) * 0.5) * (mandatory ? 0.45 : 1);
        if (!allow) {
          p.school.enrolled = false;
          p.school.stage = stage;
          p.school.cityId = city.id;
          stats.capacityRejected += 1;
          stats.byStage[stage].capacityRejected += 1;
          continue;
        }
        if (rng.next() < dropoutRisk) {
          p.school.enrolled = false;
          p.school.stage = stage;
          p.school.cityId = city.id;
          stats.dropoutCount += 1;
          stats.byStage[stage].dropoutCount += 1;
          continue;
        }
        p.school.enrolled = true;
        p.school.stage = stage;
        p.school.cityId = city.id;
        p.school.year = Math.max(0, p.school.year ?? 0);
        stats.enrolled += 1;
        stats.byStage[stage].enrolled += 1;
        assigned += 1;
      }
    };
    assignStage("primary", seats);
    assignStage("secondary", seats);
    assignStage("tertiary", tertiarySeats);
    outcomeByCity[city.id] = {
      cityId: city.id,
      eligible: stats.eligible,
      enrolled: stats.enrolled,
      enrollmentRate: Number((stats.enrolled / Math.max(1, stats.eligible)).toFixed(3)),
      dropoutRate: Number((stats.dropoutCount / Math.max(1, stats.eligible)).toFixed(3)),
      tertiaryShare: Number((stats.byStage.tertiary.enrolled / Math.max(1, stats.enrolled)).toFixed(3)),
      capacityPressure: Number((stats.capacityRejected / Math.max(1, stats.eligible)).toFixed(3)),
      byStage: stats.byStage
    };
  }
  for (const p of people) {
    const stage = p.school?.stage ?? "none";
    if (stage === "none") {
      continue;
    }
    p.profession = p.school?.enrolled ? "student" : p.profession === "student" ? "generalist" : p.profession;
    p.employed = p.school?.enrolled ? false : p.employed;
    p.employerId = p.school?.enrolled ? null : p.employerId;
    if (!p.school.enrolled && (p.age > 22 || stage === "tertiary")) {
      p.school.graduated = true;
    }
  }
  void day;
  return outcomeByCity;
}

function summarizeSchoolTotals(people) {
  const out = { enrolled: 0, primary: 0, secondary: 0, tertiary: 0, graduates: 0 };
  for (const p of people) {
    const s = p.school;
    if (!s) {
      continue;
    }
    if (s.enrolled) {
      out.enrolled += 1;
      if (s.stage === "primary" || s.stage === "secondary" || s.stage === "tertiary") {
        out[s.stage] += 1;
      }
    }
    if (s.graduated) {
      out.graduates += 1;
    }
  }
  return out;
}

function summarizeSchoolByCity(people, world) {
  const schoolByCity = new Map(world.cities.map((city) => [city.id, { enrolled: 0, byStage: {} }]));
  for (const person of people) {
    if (!person.school?.enrolled || !person.school?.cityId) {
      continue;
    }
    const row = schoolByCity.get(person.school.cityId);
    if (!row) {
      continue;
    }
    row.enrolled += 1;
    const stage = person.school.stage ?? "none";
    row.byStage[stage] = (row.byStage[stage] ?? 0) + 1;
  }
  return schoolByCity;
}

function scorePublicServiceFit(person, branch) {
  if (branch === "administration") {
    return person.ability.cognitive * 0.35 + person.traits.discipline * 0.3 + person.ability.charisma * 0.2 + person.traits.patience * 0.15;
  }
  if (branch === "police") {
    return person.ability.health * 0.32 + person.ability.stressResilience * 0.26 + person.traits.discipline * 0.24 + person.traits.riskTolerance * 0.18;
  }
  return (
    person.ability.cognitive * 0.34 +
    person.ability.attention * 0.26 +
    person.traits.patience * 0.22 +
    person.traits.discipline * 0.18
  );
}

function summarizeCityRoles(workers) {
  const publicService = { administration: 0, police: 0, judiciary: 0 };
  const professions = {};
  for (const worker of workers) {
    const branch = worker.publicService?.branch;
    if (branch && Object.prototype.hasOwnProperty.call(publicService, branch)) {
      publicService[branch] += 1;
    }
    professions[worker.profession] = (professions[worker.profession] ?? 0) + 1;
  }
  return { publicService, professions, workers: workers.length };
}

function chooseBestOperationalAction(roleStats, cityPolicy = null) {
  const plans = [
    {
      key: "governance_cycle",
      requires: { administration: 1, judiciary: 0.5, education: 0.4 },
      effect: "trust"
    },
    {
      key: "public_safety_sweep",
      requires: { police: 1, administration: 0.3, maintenance: 0.3 },
      effect: "safety"
    },
    {
      key: "justice_backlog_clear",
      requires: { judiciary: 1, administration: 0.4, police: 0.25 },
      effect: "instability"
    },
    {
      key: "logistics_acceleration",
      requires: { logistics: 1, maintenance: 0.45, administration: 0.25 },
      effect: "productivity"
    },
    {
      key: "social_welfare_alignment",
      requires: { administration: 0.8, healthcare: 0.7, education: 0.5 },
      effect: "inequality"
    }
  ];

  let best = { key: "routine_operations", score: 0, effect: "neutral" };
  const capacityBase = Math.max(1, roleStats.workers * 0.18);
  for (const plan of plans) {
    let score = 0;
    for (const [role, weight] of Object.entries(plan.requires)) {
      const count =
        roleStats.publicService[role] ??
        roleStats.professions[role] ??
        0;
      score += Math.min(1, count / capacityBase) * weight;
    }
    if (score > best.score) {
      best = { key: plan.key, score, effect: plan.effect };
    }
  }
  if (cityPolicy?.currentAction) {
    const actionToPlan = {
      security_focus: "public_safety_sweep",
      justice_focus: "justice_backlog_clear",
      welfare_focus: "social_welfare_alignment",
      growth_focus: "logistics_acceleration",
      balanced_focus: "governance_cycle"
    };
    const forced = actionToPlan[cityPolicy.currentAction];
    if (forced) {
      const chosen = plans.find((row) => row.key === forced);
      if (chosen) {
        best = { key: chosen.key, score: Math.max(best.score * 0.92, 0.45), effect: chosen.effect };
      }
    }
  }
  return { key: best.key, score: Number(best.score.toFixed(3)), effect: best.effect };
}

function computeCooperationIndex(workers, roleStats) {
  if (workers.length === 0) {
    return 0;
  }
  const avgBias =
    workers.reduce((sum, worker) => sum + (worker.workStrategy?.cooperationBias ?? 0.55), 0) / workers.length;
  const avgDiscipline =
    workers.reduce((sum, worker) => sum + (worker.workStrategy?.processDiscipline ?? 0.55), 0) / workers.length;
  const roleVariety =
    Object.keys(roleStats.professions).length +
    Object.values(roleStats.publicService).filter((n) => n > 0).length;
  const varietyBoost = clamp(roleVariety / 9, 0.12, 1);
  return clamp(avgBias * 0.45 + avgDiscipline * 0.35 + varietyBoost * 0.2, 0, 1);
}

function applyOperationalEffects(city, bestAction, cooperationIndex) {
  const gain = bestAction.score * cooperationIndex;
  if (bestAction.effect === "trust") {
    city.metrics.trust = clamp(city.metrics.trust + gain * 0.006, 0.02, 0.99);
    city.metrics.safety = clamp(city.metrics.safety + gain * 0.003, 0.02, 0.99);
  } else if (bestAction.effect === "safety") {
    city.metrics.safety = clamp(city.metrics.safety + gain * 0.008, 0.02, 0.99);
    city.metrics.instabilityRisk = clamp(city.metrics.instabilityRisk - gain * 0.006, 0.02, 0.99);
  } else if (bestAction.effect === "instability") {
    city.metrics.instabilityRisk = clamp(city.metrics.instabilityRisk - gain * 0.008, 0.02, 0.99);
    city.metrics.trust = clamp(city.metrics.trust + gain * 0.003, 0.02, 0.99);
  } else if (bestAction.effect === "productivity") {
    city.metrics.productivity = clamp(city.metrics.productivity + gain * 0.012, 0.2, 2.2);
    city.metrics.congestion = clamp(city.metrics.congestion - gain * 0.005, 0.02, 0.99);
  } else if (bestAction.effect === "inequality") {
    city.metrics.inequality = clamp(city.metrics.inequality - gain * 0.007, 0.02, 0.99);
    city.metrics.trust = clamp(city.metrics.trust + gain * 0.003, 0.02, 0.99);
  }
}

function reinforceWorkStrategies(workers, bestAction, cooperationIndex, city) {
  if (!workers.length) {
    return;
  }
  const reward = computeCityGovernanceReward(city, cooperationIndex);
  const nudge = clamp((reward - 0.45) * 0.03 + bestAction.score * 0.008, -0.03, 0.03);
  for (const worker of workers) {
    worker.workStrategy.cooperationBias = clamp01(worker.workStrategy.cooperationBias + nudge);
    worker.workStrategy.processDiscipline = clamp01(
      worker.workStrategy.processDiscipline + nudge * (bestAction.effect === "instability" ? 1.2 : 0.8)
    );
  }
}

function ensureInstitutionState(world, config, rng) {
  world.systemState = world.systemState ?? {};
  world.systemState.institutions = world.systemState.institutions ?? {
    mutationCount: 0,
    policyRevisionCount: 0,
    policyRevisionRate: 0,
    policyRevisionHistory: [],
    policyRevisionToday: 0,
    lastRevisionDay: -1,
    lastSchoolOutcomeByCity: {},
    publicStaffRateOverride: null,
    longTermStability: {
      history: [],
      report: null,
      lastUpdatedDay: -1
    },
    metaGovernance: {
      enabled: true,
      profile: "adaptive",
      revisionCount: 0,
      lastRevisionDay: -1
    },
    cities: {}
  };
  const state = world.systemState.institutions;
  for (const city of world.cities) {
    state.cities[city.id] = state.cities[city.id] ?? createCityInstitutionPolicy(rng);
    const cityState = state.cities[city.id];
    cityState.weights = cityState.weights ?? { administration: 1, police: 1, judiciary: 1 };
    cityState.qByAction = cityState.qByAction ?? {};
    cityState.nByAction = cityState.nByAction ?? {};
    cityState.currentAction = cityState.currentAction ?? "balanced_focus";
    cityState.lastAction = cityState.lastAction ?? "balanced_focus";
    cityState.lastObservedReward = cityState.lastObservedReward ?? 0.45;
    cityState.mutationCount = cityState.mutationCount ?? 0;
    cityState.lastMutationDay = cityState.lastMutationDay ?? -1;
    cityState.educationPolicy = cityState.educationPolicy ?? createCityEducationPolicy();
    cityState.educationPolicy.currentAction = cityState.educationPolicy.currentAction ?? "balanced";
    cityState.educationPolicy.lastAction = cityState.educationPolicy.lastAction ?? "balanced";
    cityState.educationPolicy.levers = cityState.educationPolicy.levers ?? educationActionToLevers("balanced");
    cityState.educationPolicy.qByAction = cityState.educationPolicy.qByAction ?? {};
    cityState.educationPolicy.nByAction = cityState.educationPolicy.nByAction ?? {};
    cityState.educationPolicy.lastObservedReward = cityState.educationPolicy.lastObservedReward ?? 0.45;
    cityState.educationPolicy.updates = cityState.educationPolicy.updates ?? 0;
  }
  state.learningRate = clamp(config.institutions?.policyLearningRate ?? 0.12, 0.01, 0.6);
  state.epsilon = clamp(config.institutions?.policyEpsilon ?? 0.12, 0.01, 0.45);
  state.mutationRate = clamp(config.institutions?.mutationRate ?? 0.08, 0, 0.4);
  state.publicStaffRateOverride = Number.isFinite(state.publicStaffRateOverride) ? state.publicStaffRateOverride : null;
  state.policyRevisionRate = Number.isFinite(state.policyRevisionRate) ? state.policyRevisionRate : 0;
  state.policyRevisionHistory = Array.isArray(state.policyRevisionHistory) ? state.policyRevisionHistory : [];
  state.policyRevisionToday = Number.isFinite(state.policyRevisionToday) ? state.policyRevisionToday : 0;
  state.lastRevisionDay = Number.isFinite(state.lastRevisionDay) ? state.lastRevisionDay : -1;
  state.lastSchoolOutcomeByCity = state.lastSchoolOutcomeByCity ?? {};
  state.longTermStability = state.longTermStability ?? { history: [], report: null, lastUpdatedDay: -1 };
  state.longTermStability.history = Array.isArray(state.longTermStability.history) ? state.longTermStability.history : [];
  state.longTermStability.lastUpdatedDay = state.longTermStability.lastUpdatedDay ?? -1;
  state.metaGovernance = state.metaGovernance ?? { enabled: true, profile: "adaptive", revisionCount: 0, lastRevisionDay: -1 };
  state.metaGovernance.enabled = state.metaGovernance.enabled ?? true;
  state.metaGovernance.profile = state.metaGovernance.profile ?? "adaptive";
  state.metaGovernance.revisionCount = state.metaGovernance.revisionCount ?? 0;
  state.metaGovernance.lastRevisionDay = state.metaGovernance.lastRevisionDay ?? -1;
  return state;
}

function notePolicyRevision(institutionState, day) {
  institutionState.policyRevisionCount += 1;
  if (institutionState.lastRevisionDay !== day) {
    if (institutionState.lastRevisionDay >= 0) {
      institutionState.policyRevisionHistory.push({
        day: institutionState.lastRevisionDay,
        count: institutionState.policyRevisionToday ?? 0
      });
      if (institutionState.policyRevisionHistory.length > 240) {
        institutionState.policyRevisionHistory.splice(0, institutionState.policyRevisionHistory.length - 240);
      }
    }
    institutionState.lastRevisionDay = day;
    institutionState.policyRevisionToday = 0;
  }
  institutionState.policyRevisionToday = (institutionState.policyRevisionToday ?? 0) + 1;
  const recent = institutionState.policyRevisionHistory.slice(-30);
  const denom = Math.max(1, recent.length + 1);
  const sum = recent.reduce((s, r) => s + (r.count ?? 0), 0) + (institutionState.policyRevisionToday ?? 0);
  institutionState.policyRevisionRate = Number((sum / denom).toFixed(4));
}

function updateEducationPolicies({ world, config, institutionState, schoolOutcomeByCity, day, rng }) {
  const alpha = clamp(config.rl?.alpha ?? institutionState.learningRate ?? 0.12, 0.01, 0.5);
  for (const city of world.cities) {
    const cityState = institutionState.cities[city.id];
    const edu = cityState.educationPolicy ?? (cityState.educationPolicy = createCityEducationPolicy());
    for (const action of EDUCATION_RL_ACTIONS) {
      if (!Number.isFinite(edu.qByAction[action])) {
        edu.qByAction[action] = 0.5;
      }
      if (!Number.isFinite(edu.nByAction[action])) {
        edu.nByAction[action] = 0;
      }
    }
    const outcome = schoolOutcomeByCity?.[city.id] ?? null;
    const reward = computeEducationReward(city, outcome);
    const prevAction = edu.currentAction ?? "balanced";
    const prevQ = edu.qByAction[prevAction] ?? 0.5;
    edu.qByAction[prevAction] = Number((prevQ + alpha * (reward - prevQ)).toFixed(4));
    edu.nByAction[prevAction] = (edu.nByAction[prevAction] ?? 0) + 1;
    edu.lastObservedReward = reward;
    edu.updates = (edu.updates ?? 0) + 1;
    edu.lastAction = prevAction;

    let nextAction;
    if (rng.next() < institutionState.epsilon) {
      nextAction = EDUCATION_RL_ACTIONS[Math.floor(rng.next() * EDUCATION_RL_ACTIONS.length)] ?? "balanced";
    } else {
      nextAction = EDUCATION_RL_ACTIONS
        .slice()
        .sort((a, b) => (edu.qByAction[b] ?? 0) - (edu.qByAction[a] ?? 0))[0];
    }
    edu.currentAction = nextAction;
    edu.levers = educationActionToLevers(nextAction);
    edu.lastRevisionDay = day;
    notePolicyRevision(institutionState, day);
  }
}

function updateInstitutionPolicies({ world, config, institutionState, day, rng }) {
  const actions = ["balanced_focus", "security_focus", "justice_focus", "welfare_focus", "growth_focus"];
  const threshold = clamp((config?.employment?.unemploymentResponseThreshold ?? 18) / 100, 0.05, 0.9);
  const targetCityId = config?.policy?.targetEmploymentCityId ? String(config.policy.targetEmploymentCityId) : null;
  for (const city of world.cities) {
    const cityState = institutionState.cities[city.id];
    const reward = computeCityGovernanceReward(city, 0.5, world);
    const prevAction = cityState.currentAction ?? "balanced_focus";
    const prevQ = cityState.qByAction[prevAction] ?? reward;
    const alpha = institutionState.learningRate;
    cityState.qByAction[prevAction] = Number((prevQ + alpha * (reward - prevQ)).toFixed(4));
    cityState.nByAction[prevAction] = (cityState.nByAction[prevAction] ?? 0) + 1;

    let nextAction;
    if (rng.next() < institutionState.epsilon) {
      nextAction = actions[Math.floor(rng.next() * actions.length)] ?? "balanced_focus";
    } else {
      nextAction = actions
        .slice()
        .sort((a, b) => (cityState.qByAction[b] ?? 0) - (cityState.qByAction[a] ?? 0))[0];
    }
    const unemployment = getCityUnemploymentRate(world, city.id);
    if (targetCityId && city.id === targetCityId && unemployment != null && unemployment > threshold) {
      const pressure = clamp((unemployment - threshold) / Math.max(0.05, 1 - threshold), 0, 1);
      const forcedAction =
        pressure >= 0.55 || city.metrics?.productivity < 0.8 ? "growth_focus"
        : "welfare_focus";
      if (rng.next() < 0.6 + pressure * 0.35) {
        nextAction = forcedAction;
      }
    }
    cityState.lastAction = prevAction;
    cityState.currentAction = nextAction;
    cityState.weights = actionToBudgetWeights(nextAction);
    cityState.lastObservedReward = reward;
    notePolicyRevision(institutionState, day);

    if (rng.next() < institutionState.mutationRate) {
      mutateInstitutionWeights(cityState, rng);
      cityState.lastMutationDay = day;
      cityState.mutationCount += 1;
      institutionState.mutationCount += 1;
    }
  }
}

function updateLongTermStability({ world, config, institutionState, day }) {
  const cities = world.cities ?? [];
  const cityCount = Math.max(1, cities.length);
  const avgInstability = cities.reduce((s, c) => s + (c.metrics?.instabilityRisk ?? 0), 0) / cityCount;
  const avgTrust = cities.reduce((s, c) => s + (c.metrics?.trust ?? 0), 0) / cityCount;
  const avgSafety = cities.reduce((s, c) => s + (c.metrics?.safety ?? 0), 0) / cityCount;
  const avgInequality = cities.reduce((s, c) => s + (c.metrics?.inequality ?? 0), 0) / cityCount;
  const avgProductivity = cities.reduce((s, c) => s + (c.metrics?.productivity ?? 1), 0) / cityCount;
  const market = world.systemState?.marketIndex ?? 1;
  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const climate = world.systemState?.climateStress ?? 0;
  const marketSoft = clamp((market - 0.6) / 0.8, 0, 1);
  const productivitySoft = clamp((avgProductivity - 0.55) / 1.15, 0, 1);
  const stress = clamp(
    epidemic * 0.28 + climate * 0.2 + avgInstability * 0.31 + avgInequality * 0.13 + (1 - marketSoft) * 0.08,
    0,
    1
  );
  const resilience = clamp(
    avgTrust * 0.31 + avgSafety * 0.25 + (1 - avgInstability) * 0.24 + productivitySoft * 0.12 + (1 - avgInequality) * 0.08,
    0,
    1
  );
  const row = {
    day,
    stress: Number(stress.toFixed(4)),
    resilience: Number(resilience.toFixed(4)),
    avgInstability: Number(avgInstability.toFixed(4)),
    avgInequality: Number(avgInequality.toFixed(4)),
    avgTrust: Number(avgTrust.toFixed(4)),
    avgSafety: Number(avgSafety.toFixed(4)),
    market: Number(market.toFixed(4)),
    epidemic: Number(epidemic.toFixed(4)),
    climate: Number(climate.toFixed(4))
  };
  const tracker = institutionState.longTermStability ?? (institutionState.longTermStability = { history: [], report: null, lastUpdatedDay: -1 });
  tracker.history.push(row);
  const maxHistory = Math.round(clamp(config.institutions?.stabilityHistoryLimit ?? 720, 120, 2000));
  if (tracker.history.length > maxHistory) {
    tracker.history.splice(0, tracker.history.length - maxHistory);
  }
  tracker.lastUpdatedDay = day;
  tracker.report = buildStabilityReport(tracker.history);
}

function buildStabilityReport(history) {
  const recent = history.slice(-30);
  const short = history.slice(-14);
  const prevShort = history.slice(-28, -14);
  const medium = history.slice(-90);
  const avg = (rows, key) => {
    if (!rows.length) return 0;
    return rows.reduce((s, r) => s + (r[key] ?? 0), 0) / rows.length;
  };
  const std = (rows, key) => {
    if (rows.length < 2) return 0;
    const m = avg(rows, key);
    const v = rows.reduce((s, r) => s + (r[key] - m) * (r[key] - m), 0) / rows.length;
    return Math.sqrt(v);
  };
  const stressNow = avg(short, "stress");
  const resilienceNow = avg(short, "resilience");
  const hasTrendBaseline = prevShort.length >= 7;
  const instabilityTrend = hasTrendBaseline ? avg(short, "avgInstability") - avg(prevShort, "avgInstability") : 0;
  const inequalityTrend = hasTrendBaseline ? avg(short, "avgInequality") - avg(prevShort, "avgInequality") : 0;
  const resilienceTrend = hasTrendBaseline ? avg(short, "resilience") - avg(prevShort, "resilience") : 0;
  const volatility = std(recent, "resilience");
  const highStressDays = medium.filter((r) => (r.stress ?? 0) >= 0.62).length;
  const instabilityDays = medium.filter((r) => (r.avgInstability ?? 0) >= 0.67).length;
  const score = clamp(
    resilienceNow * 0.42 + (1 - stressNow) * 0.28 + (1 - volatility) * 0.2 + (1 - Math.max(0, instabilityTrend * 8)) * 0.1,
    0,
    1
  );
  const alertLevel =
    stressNow >= 0.72 || instabilityTrend >= 0.02 || instabilityDays > 30
      ? "high"
      : stressNow >= 0.58 || instabilityTrend >= 0.01 || highStressDays > 20
      ? "elevated"
      : "normal";
  return {
    daysTracked: history.length,
    score: Number(score.toFixed(3)),
    alertLevel,
    current: {
      stress: Number(stressNow.toFixed(3)),
      resilience: Number(resilienceNow.toFixed(3)),
      volatility30d: Number(volatility.toFixed(3))
    },
    trends: {
      instability14d: Number(instabilityTrend.toFixed(4)),
      inequality14d: Number(inequalityTrend.toFixed(4)),
      resilience14d: Number(resilienceTrend.toFixed(4))
    },
    pressure: {
      highStressDays90d: highStressDays,
      highInstabilityDays90d: instabilityDays
    }
  };
}

function applyMetaInstitutionReform({ world, config, institutionState, day }) {
  const metaEnabled = config.institutions?.metaGovernanceEnabled ?? true;
  if (!metaEnabled) {
    return;
  }
  const report = institutionState.longTermStability?.report;
  if (!report) {
    return;
  }
  const meta = institutionState.metaGovernance ?? (institutionState.metaGovernance = {
    enabled: true,
    profile: "adaptive",
    revisionCount: 0,
    lastRevisionDay: -1
  });
  const alert = report.alertLevel ?? "normal";
  const riseIneq = report.trends?.inequality14d ?? 0;
  const riseInst = report.trends?.instability14d ?? 0;

  let profile = "adaptive";
  if (alert === "high") {
    profile = "stabilize";
  } else if (riseIneq > 0.012) {
    profile = "equity";
  } else if (report.score >= 0.7 && riseInst <= 0) {
    profile = "optimize";
  }

  const prevProfile = meta.profile ?? "adaptive";
  meta.profile = profile;
  if (prevProfile !== profile) {
    meta.revisionCount = (meta.revisionCount ?? 0) + 1;
    meta.lastRevisionDay = day;
  }

  const target = profile === "stabilize"
    ? { learningRate: 0.2, epsilon: 0.22, mutationRate: 0.12, staffRate: 0.24, weights: { administration: 1.0, police: 1.4, judiciary: 1.35 } }
    : profile === "equity"
    ? { learningRate: 0.15, epsilon: 0.16, mutationRate: 0.08, staffRate: 0.2, weights: { administration: 1.45, police: 0.95, judiciary: 1.15 } }
    : profile === "optimize"
    ? { learningRate: 0.1, epsilon: 0.08, mutationRate: 0.05, staffRate: 0.16, weights: { administration: 1.1, police: 1.0, judiciary: 0.95 } }
    : { learningRate: 0.13, epsilon: 0.12, mutationRate: 0.08, staffRate: 0.18, weights: { administration: 1.15, police: 1.05, judiciary: 1.0 } };

  institutionState.learningRate = clamp(institutionState.learningRate * 0.72 + target.learningRate * 0.28, 0.01, 0.6);
  institutionState.epsilon = clamp(institutionState.epsilon * 0.72 + target.epsilon * 0.28, 0.01, 0.45);
  institutionState.mutationRate = clamp(institutionState.mutationRate * 0.72 + target.mutationRate * 0.28, 0, 0.4);
  institutionState.publicStaffRateOverride = clamp(
    (institutionState.publicStaffRateOverride ?? (config.institutions?.publicStaffRate ?? 0.17)) * 0.72 + target.staffRate * 0.28,
    0.06,
    0.42
  );

  for (const city of world.cities) {
    const cityState = institutionState.cities[city.id];
    if (!cityState) {
      continue;
    }
    cityState.weights = normalizeBranchWeights({
      administration: (cityState.weights?.administration ?? 1) * target.weights.administration,
      police: (cityState.weights?.police ?? 1) * target.weights.police,
      judiciary: (cityState.weights?.judiciary ?? 1) * target.weights.judiciary
    });
  }
}

function createCityInstitutionPolicy(rng) {
  return {
    currentAction: "balanced_focus",
    lastAction: "balanced_focus",
    weights: actionToBudgetWeights("balanced_focus"),
    qByAction: {},
    nByAction: {},
    mutationCount: 0,
    lastObservedReward: 0.45,
    lastMutationDay: -1
  };
}

function normalizeBranchWeights(weights) {
  const a = clamp(weights.administration ?? 1, 0.3, 3.2);
  const p = clamp(weights.police ?? 1, 0.3, 3.2);
  const j = clamp(weights.judiciary ?? 1, 0.3, 3.2);
  const sum = Math.max(0.0001, a + p + j);
  return {
    administration: Number((a / sum * 3).toFixed(3)),
    police: Number((p / sum * 3).toFixed(3)),
    judiciary: Number((j / sum * 3).toFixed(3))
  };
}

function createCityEducationPolicy() {
  return {
    currentAction: "balanced",
    lastAction: "balanced",
    levers: educationActionToLevers("balanced"),
    qByAction: {},
    nByAction: {},
    lastObservedReward: 0.45,
    updates: 0,
    lastRevisionDay: -1
  };
}

function educationActionToLevers(action) {
  if (action === "foundation_first") {
    return {
      capacityMultiplier: 1.12,
      tertiaryMultiplier: 0.9,
      dropoutMultiplier: 0.92,
      stageWeights: { primary: 1.25, secondary: 1.08, tertiary: 0.85 }
    };
  }
  if (action === "tertiary_push") {
    return {
      capacityMultiplier: 0.95,
      tertiaryMultiplier: 1.35,
      dropoutMultiplier: 1.05,
      stageWeights: { primary: 0.92, secondary: 1, tertiary: 1.35 }
    };
  }
  if (action === "retention_support") {
    return {
      capacityMultiplier: 1.04,
      tertiaryMultiplier: 1.05,
      dropoutMultiplier: 0.68,
      stageWeights: { primary: 1.05, secondary: 1.1, tertiary: 1.05 }
    };
  }
  if (action === "equity_support") {
    return {
      capacityMultiplier: 1.08,
      tertiaryMultiplier: 0.98,
      dropoutMultiplier: 0.82,
      stageWeights: { primary: 1.12, secondary: 1.08, tertiary: 0.95 }
    };
  }
  return {
    capacityMultiplier: 1,
    tertiaryMultiplier: 1,
    dropoutMultiplier: 1,
    stageWeights: { primary: 1, secondary: 1, tertiary: 1 }
  };
}

function actionToBudgetWeights(action) {
  if (action === "security_focus") {
    return { administration: 1, police: 1.8, judiciary: 0.8 };
  }
  if (action === "justice_focus") {
    return { administration: 0.95, police: 1.05, judiciary: 1.9 };
  }
  if (action === "welfare_focus") {
    return { administration: 1.9, police: 0.85, judiciary: 0.75 };
  }
  if (action === "growth_focus") {
    return { administration: 1.5, police: 0.9, judiciary: 0.8 };
  }
  return { administration: 1.3, police: 1.1, judiciary: 1.0 };
}

function mutateInstitutionWeights(cityState, rng) {
  const next = { ...cityState.weights };
  next.administration = clamp(next.administration + rng.range(-0.22, 0.22), 0.45, 2.4);
  next.police = clamp(next.police + rng.range(-0.22, 0.22), 0.45, 2.4);
  next.judiciary = clamp(next.judiciary + rng.range(-0.22, 0.22), 0.45, 2.4);
  const total = Math.max(0.001, next.administration + next.police + next.judiciary);
  cityState.weights = {
    administration: Number((next.administration / total * 3).toFixed(3)),
    police: Number((next.police / total * 3).toFixed(3)),
    judiciary: Number((next.judiciary / total * 3).toFixed(3))
  };
}

function getCityUnemploymentRate(world, cityId) {
  const byCity = world?.systemState?.lastEconomyByCity;
  if (!byCity) {
    return null;
  }
  const row = byCity[cityId];
  if (!row) {
    return null;
  }
  return clamp((row.unemploymentRate ?? 0) / 100, 0, 1);
}

function computeCityGovernanceReward(city, cooperationIndex, world = null) {
  const unemployment = getCityUnemploymentRate(world, city.id);
  const unemploymentScore = unemployment == null ? 0.7 : 1 - unemployment;
  return clamp(
    city.metrics.trust * 0.26 +
      city.metrics.safety * 0.24 +
      city.metrics.productivity * 0.14 +
      (1 - city.metrics.instabilityRisk) * 0.24 +
      (1 - city.metrics.inequality) * 0.08 +
      unemploymentScore * 0.08 +
      cooperationIndex * 0.2,
    0,
    1.8
  );
}

function computeEducationReward(city, outcome) {
  const enrollmentRate = outcome?.enrollmentRate ?? 0;
  const dropoutRate = outcome?.dropoutRate ?? 0;
  const tertiaryShare = outcome?.tertiaryShare ?? 0;
  const productivity = city?.metrics?.productivity ?? 0.7;
  const trust = city?.metrics?.trust ?? 0.5;
  const inequality = city?.metrics?.inequality ?? 0.5;
  const instability = city?.metrics?.instabilityRisk ?? 0.4;
  return clamp(
    enrollmentRate * 0.42 +
      (1 - dropoutRate) * 0.2 +
      tertiaryShare * 0.08 +
      productivity * 0.12 +
      trust * 0.11 +
      (1 - inequality) * 0.05 +
      (1 - instability) * 0.04,
    0,
    1.8
  );
}

function resolveState(person, phase, rng, isWeekend = false) {
  const faith = getReligionProfile(person.religion).modifiers;

  if (phase === "Morning") {
    const commuteDrive = 0.78 + person.traits.discipline * 0.2 + faith.workEthic * 0.08;
    return rng.next() < commuteDrive ? "Commute" : "Home";
  }

  if (phase === "Daytime") {
    if (person.currentCityId === person.workCityId) {
      return "Work";
    }
    return rng.next() < 0.7 ? "Commute" : "Home";
  }

  if (phase === "Evening") {
    const leisureProb =
      person.traits.sociability * 0.3 +
      person.traits.noveltySeeking * 0.25 +
      faith.socialBond * 0.18 -
      faith.workEthic * 0.06;
    const weekendBoost = isWeekend ? 0.1 : 0;
    return rng.next() < leisureProb + weekendBoost ? "Leisure" : "Commute";
  }

  const sleepProb =
    0.4 +
    person.traits.discipline * 0.3 -
    person.traits.noveltySeeking * 0.2 -
    faith.riskNorm * 0.08;
  return rng.next() < sleepProb ? "Sleep" : "Leisure";
}

function updateLocation(person, phase, world, rng) {
  if (phase === "Morning" && person.currentState === "Commute") {
    if (world.hasTransitPath(person.currentCityId, person.workCityId)) {
      person.currentCityId = person.workCityId;
    }
    return;
  }

  if (phase === "Daytime") {
    if (person.currentState === "Work") {
      person.currentCityId = person.workCityId;
    }
    return;
  }

  if (phase === "Evening") {
    if (person.currentState === "Commute") {
      if (world.hasTransitPath(person.currentCityId, person.homeCityId)) {
        person.currentCityId = person.homeCityId;
      }
      return;
    }
    if (person.currentState === "Leisure") {
      const leisureCandidates = world.cities
        .filter((city) => world.hasTransitPath(person.currentCityId, city.id))
        .map((city) => city.id);
      person.currentCityId = pickOne(leisureCandidates.length > 0 ? leisureCandidates : [person.currentCityId], rng);
    }
    return;
  }

  if (person.currentState === "Sleep") {
    person.currentCityId = person.homeCityId;
  }
}

function updateEnergy(person) {
  if (person.currentState === "Sleep") {
    person.energy = Math.min(1, person.energy + 0.15);
    person.fatigue = Math.max(0, person.fatigue - 0.12);
    return;
  }

  if (person.currentState === "Work") {
    person.energy = Math.max(0, person.energy - 0.08);
    person.fatigue = Math.min(1, person.fatigue + 0.09);
    return;
  }

  if (person.currentState === "Leisure") {
    person.energy = Math.max(0, person.energy - 0.05);
    person.fatigue = Math.min(1, person.fatigue + 0.05);
    return;
  }

  person.energy = Math.max(0, person.energy - 0.03);
  person.fatigue = Math.min(1, person.fatigue + 0.03);
}

function ensurePersonGenetics(person, rng) {
  if (!person.genetics) {
    person.genetics = createGeneticsFromPhenotype(person.traits ?? {}, person.ability ?? {}, rng);
  }
  if (!person.epigenetics) {
    person.epigenetics = createEmptyEpigenetics();
  }
}

function updateEpigeneticsAndPhenotype(person, world, phase, rng) {
  const city = world.getCityById(person.currentCityId);
  const env = computeCityEnvironmentModifier(city);
  const stressLoad =
    person.fatigue * 0.55 +
    (1 - person.energy) * 0.35 +
    (city?.metrics?.inequality ?? 0.5) * 0.25 +
    (city?.metrics?.congestion ?? 0.4) * 0.14;
  const support =
    (city?.metrics?.trust ?? 0.5) * 0.3 +
    (city?.metrics?.safety ?? 0.5) * 0.32 +
    (city?.metrics?.productivity ?? 0.7) * 0.18;
  const phaseLoad = phase === "Daytime" && person.currentState === "Work" ? 0.012 : phase === "Night" ? -0.004 : 0;

  for (const key of PERSONALITY_KEYS) {
    const cur = person.epigenetics.personality[key] ?? 0;
    const drift = (support - stressLoad) * 0.013 + phaseLoad + rng.range(-0.003, 0.003);
    person.epigenetics.personality[key] = clamp(cur * 0.93 + drift, -0.25, 0.25);
  }
  for (const key of ABILITY_KEYS) {
    const cur = person.epigenetics.ability[key] ?? 0;
    const learning = (city?.metrics?.productivity ?? 0.7) * 0.008 + (city?.metrics?.trust ?? 0.5) * 0.004;
    const fatiguePenalty = person.fatigue * 0.01;
    const drift = learning - fatiguePenalty + phaseLoad * 0.5 + rng.range(-0.002, 0.002);
    person.epigenetics.ability[key] = clamp(cur * 0.94 + drift, -0.2, 0.2);
  }

  const phenotype = derivePhenotypeFromGenetics(person.genetics, person.epigenetics, env);
  person.traits = phenotype.traits;
  person.ability = phenotype.ability;
}

function computeEmploymentPolicySupport({
  world,
  city,
  config,
  targetCityId,
  baseEmploymentBoost,
  boostInWindow,
  boostRegimeOnly,
  workers
}) {
  const isTargetCityInWindow =
    targetCityId &&
    city.id === targetCityId &&
    boostInWindow;
  const regimeEligible = !boostRegimeOnly || city.regime === "stressed" || city.regime === "fractured";
  const targetedSupport = isTargetCityInWindow
    ? clamp(
        baseEmploymentBoost *
          (regimeEligible ? 1 : 0.45) *
          (0.6 + (config?.policy?.welfareBudget ?? 0.5) * 0.25 + (config?.policy?.safetyBudget ?? 0.5) * 0.15),
        0,
        0.28
      )
    : 0;
  if (!(targetCityId && city.id === targetCityId)) {
    return targetedSupport;
  }
  const cityPolicy = world?.systemState?.institutions?.cities?.[city.id] ?? null;
  const action = cityPolicy?.currentAction ?? "balanced_focus";
  const actionBoost = clamp(
    config?.employment?.policyActionEmploymentBoost?.[action] ??
      config?.employment?.policyActionEmploymentBoost?.balanced_focus ??
      0.4,
    0,
    1.2
  );
  const welfarePressure = clamp(
    (config?.policy?.welfareBudget ?? 0.5) * 0.65 + (config?.policy?.safetyBudget ?? 0.5) * 0.35,
    0,
    1
  );
  const threshold = clamp((config?.employment?.unemploymentResponseThreshold ?? 18) / 100, 0.05, 0.9);
  const lastUnemployment = getCityUnemploymentRate(world, city.id);
  const inferredUnemployment = clamp(1 - (city.metrics?.employmentCapacity ?? 0.5), 0, 1);
  const unemployment = lastUnemployment ?? inferredUnemployment;
  const pressure = clamp((unemployment - threshold) / Math.max(0.05, 1 - threshold), 0, 1);
  const crowdFactor = clamp((workers?.length ?? 0) / Math.max(1, city.population ?? 1), 0.04, 1);
  const adaptiveSupport = clamp(
    pressure *
      (config?.employment?.unemploymentResponseScale ?? 0.3) *
      actionBoost *
      welfarePressure *
      (0.6 + crowdFactor * 0.4),
    0,
    0.2
  );
  return clamp(targetedSupport + adaptiveSupport, 0, 0.32);
}

function applyEmploymentAndEconomy({
  people,
  world,
  companies,
  companiesByCity,
  phase,
  day,
  config,
  isWeekend,
  minuteOfDay,
  rng
}) {
  world.systemState = world.systemState ?? {};
  const policyState = ensureCompanyPolicyState(world, config?.policy ?? {});
  const policyCfg = config?.policy ?? {};
  const antitrustStrength = clamp((policyCfg.antitrustStrength ?? 0.22) + (policyState.antitrustAutoBoost ?? 0), 0, 1);
  const marketIndex = world.systemState?.marketIndex ?? 1;
  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const climate = world.systemState?.climateStress ?? 0;
  const resourcePrices = world.systemState?.resources?.prices ?? {};
  const currencyState = world.systemState?.currencies ?? {};
  const technologyState = ensureTechnologyState(world);
  const competitionPenalty = config.company?.competitionPenalty ?? 0.08;
  const supplyChainEffect = config.company?.supplyChainEffect ?? 0.12;
  const stockVolatility = config.company?.stockVolatility ?? 0.04;
  const typeCfg = config.companyTypes ?? {};
  const typeSafety = typeCfg.safety ?? {};
  if (phase === "Daytime") {
    applyCompanyRlActions({ companies, config, rng });
  }
  const workersByCity = new Map(world.cities.map((c) => [c.id, []]));
  for (const company of companies) {
    ensureCompanyTypeState(company);
    company.employeeCount = 0;
    company.revenueTick = 0;
    company.costTick = 0;
    company.marketShare = 0;
  }

  for (const person of people) {
    if (person.school?.enrolled) {
      person.employed = false;
      person.employerId = null;
      if (person.profession !== "student") {
        person.profession = "student";
      }
      continue;
    }
    const isJobSeekingAdult = !person.employed && person.age >= 18 && person.age <= 75;
    if (person.currentState === "Work" || (phase === "Daytime" && isJobSeekingAdult)) {
      workersByCity.get(person.currentCityId)?.push(person);
    } else if (phase === "Night" && rng.next() < 0.04) {
      person.employerId = null;
    }
  }

  const employmentDiag = {
    sampledWorkers: 0,
    baseHireShareSum: 0,
    baseHireShareEffectiveSum: 0,
    shockPenaltySum: 0,
    strainPenaltySum: 0,
    regimeHiringMultSum: 0,
    policySupportSum: 0,
    capacityRatioSum: 0,
    hireChanceSum: 0,
    baseHireShareEffectiveSamples: []
  };
  for (const city of world.cities) {
    const workers = workersByCity.get(city.id) ?? [];
    const cityCompanies = companiesByCity.get(city.id) ?? [];
    const companyCapacity = cityCompanies.reduce((sum, c) => sum + c.capacity, 0);
    const targetCityId = config?.policy?.targetEmploymentCityId ? String(config.policy.targetEmploymentCityId) : null;
    const baseEmploymentBoost = clamp(config?.policy?.targetEmploymentBoost ?? 0, 0, 0.25);
    const boostTicksLimit = Math.max(0, Math.floor(config?.policy?.targetEmploymentBoostTicks ?? 0));
    const ticksPerDay = Math.max(1, Math.floor((config?.dayMinutes ?? 1440) / (config?.tickMinutes ?? 30)));
    const tickOfDay = Math.max(0, Math.floor(minuteOfDay / Math.max(1, config?.tickMinutes ?? 30)));
    const globalTick = Math.max(0, day * ticksPerDay + tickOfDay);
    const boostInWindow = boostTicksLimit <= 0 || globalTick <= boostTicksLimit;
    const boostRegimeOnly = config?.policy?.targetEmploymentBoostRegimeOnly !== false;
    const cityPolicySupportBase = computeEmploymentPolicySupport({
      world,
      city,
      config,
      targetCityId,
      baseEmploymentBoost,
      boostInWindow,
      boostRegimeOnly,
      workers
    });
    const cityCapacityBoost = clamp(cityPolicySupportBase * 0.9, 0, 0.32);
    const cityBaseCapacity =
      cityCompanies.length > 0
        ? Math.max(1, Math.floor(companyCapacity * city.population * 0.06))
        : Math.max(1, Math.floor(city.population * (city.metrics.employmentCapacity ?? 0.6) * 0.08));
    const boostedCityBaseCapacity = Math.max(1, Math.floor(cityBaseCapacity * (1 + cityCapacityBoost)));
    const companyOpenings = computeCompanyOpenPositions({
      cityCompanies,
      city,
      cityBaseCapacity: boostedCityBaseCapacity,
      workerCount: workers.length,
      epidemic,
      climate,
      policySupport: cityPolicySupportBase
    });
    const capacity = companyOpenings.totalOpenings;
    for (const c of cityCompanies) {
      const posted = companyOpenings.byCompany.get(c.id) ?? 0;
      c.openPositionsPosted = posted;
      c.openPositions = posted;
    }

    workers.sort((a, b) => {
      const as = a.ability.productivity + a.socioeconomic.skill + a.socioeconomic.education;
      const bs = b.ability.productivity + b.socioeconomic.skill + b.socioeconomic.education;
      return bs - as;
    });

    for (let i = 0; i < workers.length; i += 1) {
      const worker = workers[i];
      worker.employmentHistory = worker.employmentHistory ?? { unemploymentStreak: 0, tenureByEmployer: {} };
      const baseHire = i < capacity ? 1 : 0;
      const shock = (world.systemState?.epidemicLevel ?? 0) * 0.08 + (world.systemState?.climateStress ?? 0) * 0.05;
      const rehireBoost = Math.min(0.16, worker.employmentHistory.unemploymentStreak * 0.012);
      const regimeFx = getCityRegimeEffects(city, config);
      const regime = city.regime ?? "normal";
      const regimeMult = clamp(
        config?.employment?.baseHireShareRegimeMult?.[regime] ??
          config?.employment?.baseHireShareRegimeMult?.normal ??
          1,
        0.65,
        1.25
      );
      const baseHireShareFloor = clamp(config?.employment?.baseHireShareFloor ?? 0.08, 0.01, 0.3);
      const policyCoupling = clamp(config?.employment?.baseHirePolicyCoupling ?? 0.12, 0, 0.5);
      const stabilityCoupling = clamp(config?.employment?.baseHireStabilityCoupling ?? 0.08, 0, 0.3);
      const cityPolicySupport = cityPolicySupportBase;
      const stabilityFactor = clamp(1 + ((city.metrics?.safety ?? 0.5) - (city.metrics?.instabilityRisk ?? 0.3)) * stabilityCoupling, 0.85, 1.2);
      let baseHireShareEffective = clamp(baseHire * regimeMult * (1 + cityPolicySupport * policyCoupling) * stabilityFactor, 0, 1);
      if (baseHire === 0) {
        baseHireShareEffective = baseHireShareFloor;
      } else {
        baseHireShareEffective = Math.max(baseHireShareFloor, baseHireShareEffective);
      }
      const hireChanceBase = Math.max(0.01, 0.08 + 0.84 * baseHireShareEffective + rehireBoost - shock);
      const strainPenalty = (city.strain ?? 0) * 0.15;
      const hireChance = clamp01(
        hireChanceBase * regimeFx.hiringRecoveryMult * (1 - strainPenalty) + cityPolicySupport
      );
      employmentDiag.sampledWorkers += 1;
      employmentDiag.baseHireShareSum += baseHire;
      employmentDiag.baseHireShareEffectiveSum += baseHireShareEffective;
      employmentDiag.shockPenaltySum += shock;
      employmentDiag.strainPenaltySum += strainPenalty;
      employmentDiag.regimeHiringMultSum += regimeFx.hiringRecoveryMult;
      employmentDiag.policySupportSum += cityPolicySupport;
      employmentDiag.capacityRatioSum += capacity / Math.max(1, workers.length);
      employmentDiag.hireChanceSum += hireChance;
      employmentDiag.baseHireShareEffectiveSamples.push(baseHireShareEffective);
      worker.employed = rng.next() < clamp01(hireChance);
      if (!worker.employed) {
        worker.employmentHistory.unemploymentStreak += 1;
        worker.employerId = null;
        continue;
      }
      const availableEmployers = cityCompanies.filter((c) => (c.openPositions ?? 0) > 0);
      const employer = pickEmployer(worker, availableEmployers, rng, world);
      worker.employerId = employer?.id ?? null;
      if (employer) {
        employer.employeeCount += 1;
        employer.openPositions = Math.max(0, (employer.openPositions ?? 0) - 1);
        worker.employmentHistory.unemploymentStreak = 0;
        worker.employmentHistory.tenureByEmployer[employer.id] =
          (worker.employmentHistory.tenureByEmployer[employer.id] ?? 0) + 1;
      } else {
        worker.employed = false;
        worker.employmentHistory.unemploymentStreak += 1;
      }
    }
  }
  if (employmentDiag.sampledWorkers > 0) {
    const n = employmentDiag.sampledWorkers;
    const sortedEffective = employmentDiag.baseHireShareEffectiveSamples.slice().sort((a, b) => a - b);
    const p95Idx = Math.max(0, Math.min(sortedEffective.length - 1, Math.floor((sortedEffective.length - 1) * 0.95)));
    world.systemState = world.systemState ?? {};
    world.systemState.lastEmploymentDiagnostics = {
      sampledWorkers: n,
      avgBaseHireShare: Number((employmentDiag.baseHireShareSum / n).toFixed(6)),
      avgBaseHireShareEffective: Number((employmentDiag.baseHireShareEffectiveSum / n).toFixed(6)),
      p95BaseHireShareEffective: Number(((sortedEffective[p95Idx] ?? 0)).toFixed(6)),
      avgShockPenalty: Number((employmentDiag.shockPenaltySum / n).toFixed(6)),
      avgStrainPenalty: Number((employmentDiag.strainPenaltySum / n).toFixed(6)),
      avgRegimeHiringMult: Number((employmentDiag.regimeHiringMultSum / n).toFixed(6)),
      avgPolicySupport: Number((employmentDiag.policySupportSum / n).toFixed(6)),
      avgCapacityRatio: Number((employmentDiag.capacityRatioSum / n).toFixed(6)),
      avgHireChance: Number((employmentDiag.hireChanceSum / n).toFixed(6))
    };
  }

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const sectorCrowdByCity = new Map();
  for (const city of world.cities) {
    const crowd = new Map();
    const rows = companiesByCity.get(city.id) ?? [];
    for (const company of rows) {
      crowd.set(company.sector, (crowd.get(company.sector) || 0) + 1);
    }
    sectorCrowdByCity.set(city.id, crowd);
  }
  const concentrationStats = computeConcentrationPenaltyByCompany(companies, world, typeCfg, antitrustStrength);
  const concentrationPenaltyByCompanyId = concentrationStats.byCompany;
  policyState.lastMaxHHI = concentrationStats.maxHhi;
  policyState.lastAvgHHI = concentrationStats.avgHhi;
  policyState.lastPenaltyRatio = concentrationStats.penaltyRatio;
  const hhiPressure = Math.max(0, concentrationStats.maxHhi - concentrationStats.threshold);
  policyState.antitrustAutoBoost = Number(clamp((policyState.antitrustAutoBoost ?? 0) * 0.8 + hhiPressure * 0.45, 0, 0.6).toFixed(4));
  policyState.effectiveAntitrust = antitrustStrength;

  const supplyEfficiencyBoost = buildSupplyBoostMap(companies, companyById, supplyChainEffect);
  const learningRate = config.economy?.skillLearningRate ?? 0.012;
  const salaryWealthEma = clamp(config.economy?.salaryWealthEma ?? 0.08, 0.01, 0.6);
  const salaryWealthScale = Math.max(0.01, Number(config.economy?.salaryWealthScale ?? 0.45));
  for (const person of people) {
    ensureSocioeconomicBreakdown(person);
    const city = world.getCityById(person.currentCityId);
    if (!city) {
      continue;
    }
    const resourceProfile = computeCityResourceEconomyProfile(city, resourcePrices);
    const currencyCtx = getCurrencyContextForCity(city, currencyState);
    const employer = person.employerId ? companyById.get(person.employerId) : null;
    const techCtx = getTechnologyContext(technologyState, city?.nationId ?? null, employer?.sector ?? null);
    const wageFactor = employer ? employer.wageMultiplier : 0.7;
    const employmentPenalty = person.employed ? 1 : 1 - (config.economy?.unemploymentPenalty ?? 0.06);
    const income =
      city.metrics.wageLevel *
      currencyCtx.purchasingPower *
      resourceProfile.humanWageFactor *
      wageFactor *
      person.ability.productivity *
      person.socioeconomic.skill *
      employmentPenalty;
    person.incomeLastTick = Number(income.toFixed(4));
    applyPersonalAssetDynamics({
      person,
      city,
      income,
      marketIndex,
      currencyCtx,
      salaryWealthEma,
      salaryWealthScale,
      config,
      rng
    });

    if (employer && person.employed && person.currentState === "Work") {
      const crowd = sectorCrowdByCity.get(city.id)?.get(employer.sector) ?? 1;
      const competition = Math.max(0.55, 1 - (crowd - 1) * competitionPenalty);
      const supplyBoost = supplyEfficiencyBoost.get(employer.id) ?? 1;
      const shockPenalty = Math.max(0.5, 1 - epidemic * 0.35 - climate * 0.22);
      const resourceDemand = applyTechnologyToResourceDemand(getSectorResourceDemand(employer.sector), techCtx.resourceEfficiency);
      const resourceOutputFactor = computeResourceOutputFactor(resourceProfile, resourceDemand);
      const resourceCostFactor = computeResourceCostFactor(resourcePrices, resourceDemand, resourceProfile);
      const exportCompetitiveness = clamp(1.18 - (currencyCtx.fx - 1) * 0.22, 0.78, 1.22);
      const fxCostFactor = clamp(1 + (currencyCtx.fx - 1) * 0.12 + currencyCtx.inflation * 0.1, 0.85, 1.22);
      const output =
        person.ability.productivity *
        person.socioeconomic.skill *
        (employer.efficiency * 0.6 + city.metrics.productivity * 0.4) *
        (isWeekend ? 0.9 : 1) *
        competition *
        supplyBoost *
        shockPenalty *
        resourceOutputFactor *
        techCtx.productivityBoost;
      const typeRevenueMult = computeCompanyTypeRevenueMultiplier({
        company: employer,
        world,
        city,
        person,
        config
      });
      employer.revenueTick += output * employer.pricePower * marketIndex * exportCompetitiveness * typeRevenueMult;
      employer.costTick += income * 0.9 * resourceCostFactor * fxCostFactor;
    }

    const workBoost = person.currentState === "Work" ? 1.3 : 0.6;
    const weekendPenalty = isWeekend && person.currentState === "Work" ? 0.86 : 1;
    const circadian = 0.9 + Math.sin((minuteOfDay / 1440) * Math.PI * 2 - Math.PI / 2) * 0.05;
    const growth =
      learningRate *
      person.ability.cognitive *
      person.socioeconomic.education *
      workBoost *
      weekendPenalty *
      circadian;
    person.socioeconomic.skill = clamp01(person.socioeconomic.skill + growth);
    person.socioeconomic.wealth = computeSocioeconomicWealth(person.socioeconomic);
    person.experience = clamp01((person.experience ?? 0) + growth * 0.4);
    if (world.systemState?.culturalDrift > 0.3 && rng.next() < 0.012) {
      const drift = (rng.next() - 0.5) * (world.systemState.culturalDrift * 0.02);
      person.traits.openness = clamp01(person.traits.openness + drift);
      person.traits.conformity = clamp01(person.traits.conformity - drift * 0.6);
    }
  }

  const cityRevenue = new Map();
  const valuationCfg = config.company?.valuation ?? {};
  const hyperGrowthCfg = config.company?.hyperGrowth ?? {};
  for (const company of companies) {
    ensureCompanyTypeState(company);
    const companyCity = world.getCityById(company.cityId);
    const regimeFx = getCityRegimeEffects(companyCity, config);
    const fixedCost = 0.08 + company.capacity * 0.06;
    const prevValuation = Math.max(0.0001, Number(company.valuation ?? company.capital ?? 0.3));
    company.revenue = company.revenue * 0.82 + company.revenueTick * 0.18;
    company.cost = company.cost * 0.82 + (company.costTick + fixedCost * (2 - regimeFx.hiringRecoveryMult)) * 0.18;
    const rawProfit = company.revenue - company.cost;
    const profitCapScale = Math.max(0.35, Number(typeSafety.profitCapScale ?? 1));
    const lossCapScale = Math.max(0.35, Number(typeSafety.lossCapScale ?? 1));
    const profitCap = Math.max(0.04, 0.35 * profitCapScale);
    const lossCap = Math.max(0.04, 0.35 * lossCapScale);
    company.profit = clamp(rawProfit, -lossCap, profitCap);
    if (company.companyType === "Military") {
      const warLoad = countWarRelationsForNation(world, companyCity?.nationId);
      const warAuditRate = clamp((policyCfg.warAuditRate ?? 0.08) * warLoad, 0, 0.25);
      if (warAuditRate > 0 && company.profit > 0) {
        const levy = company.profit * warAuditRate;
        company.profit -= levy;
        policyState.redistributionPool = Number(((policyState.redistributionPool ?? 0) + levy).toFixed(6));
      }
    }
    const recoveryDrag = 1 - clamp((companyCity?.strain ?? 0) * 0.35, 0, 0.45);
    company.capital = clamp01(company.capital + company.profit * 0.01 * regimeFx.hiringRecoveryMult * recoveryDrag);
    const trend = (company.profit - (company.profitPrev ?? 0)) * 0.2 + company.capital * 0.03;
    const noise = (rng.next() - 0.5) * stockVolatility;
    const baseCapitalWeight = Math.max(0.2, Number(valuationCfg.baseCapitalWeight ?? 1.7));
    const baseRevenueWeight = Math.max(0.1, Number(valuationCfg.baseRevenueWeight ?? 0.45));
    const profitScale = Math.max(0.5, Number(valuationCfg.profitScale ?? 4));
    const growthScale = Math.max(0.5, Number(valuationCfg.growthScale ?? 1.35));
    const lossPenaltyScale = Math.max(0.3, Number(valuationCfg.lossPenaltyScale ?? 2.6));
    const valMin = Math.max(0.01, Number(valuationCfg.min ?? 0.05));
    const valMax = Math.max(valMin + 0.5, Number(valuationCfg.max ?? 6));
    const positiveProfit = Math.max(0, Number(company.profit ?? 0));
    const loss = Math.max(0, Number(-(company.profit ?? 0)));
    const profitDelta = Number(company.profit ?? 0) - Number(company.profitPrev ?? 0);
    const profitSignal = 1 / (1 + Math.exp(-positiveProfit * 4.2));
    const trendSignal = 1 / (1 + Math.exp(-profitDelta * 7.5));
    const prevGrowthExpectation = clamp01(company.growthExpectation ?? 0.5);
    company.growthExpectation = clamp01(prevGrowthExpectation * 0.78 + (profitSignal * 0.62 + trendSignal * 0.38) * 0.22);
    const baseValuation = Math.max(
      valMin,
      Number(company.capital ?? 0) * baseCapitalWeight + Math.max(0, Number(company.revenue ?? 0)) * baseRevenueWeight
    );
    const nonlinear = Math.pow(1 + positiveProfit * profitScale, 1.08) * (1 + Math.pow(company.growthExpectation, growthScale));
    const lossDrag = 1 + loss * lossPenaltyScale;
    let valuation = baseValuation * nonlinear / lossDrag;
    const concentrationPenalty = concentrationPenaltyByCompanyId.get(company.id) ?? 1;
    company.concentrationPenalty = Number(concentrationPenalty.toFixed(6));
    valuation *= concentrationPenalty;

    const baseHyperChance = clamp(Number(hyperGrowthCfg.chance ?? 0.003), 0, 0.05);
    const hyperChance = baseHyperChance * clamp(0.6 + company.growthExpectation * 0.9 + positiveProfit * 0.6, 0.5, 2.2);
    company.hyperGrowthEvent = false;
    if (rng.next() < hyperChance) {
      const minMult = Math.max(1.05, Number(hyperGrowthCfg.minMultiplier ?? 1.8));
      const maxMult = Math.max(minMult + 0.1, Number(hyperGrowthCfg.maxMultiplier ?? 3.6));
      company.hyperGrowthBoost = Math.max(company.hyperGrowthBoost ?? 1, rng.range(minMult, maxMult));
      company.lastHyperGrowthDay = day;
      company.hyperGrowthEvent = true;
    }
    if ((company.hyperGrowthBoost ?? 1) > 1.001) {
      valuation *= company.hyperGrowthBoost;
      const decay = clamp(Number(hyperGrowthCfg.boostDecay ?? 0.9), 0.65, 0.99);
      company.hyperGrowthBoost = clamp(1 + (company.hyperGrowthBoost - 1) * decay, 1, 12);
    }
    const maxValuationGrowthPerTick = Math.max(0.01, Number(typeSafety.maxValuationGrowthPerTick ?? 0.25));
    const valuationGrowthRatio = clamp(valuation / Math.max(0.0001, prevValuation), 1 - maxValuationGrowthPerTick, 1 + maxValuationGrowthPerTick);
    const valuationCapped = prevValuation * valuationGrowthRatio;
    company.valuation = clamp(valuationCapped, valMin, valMax * 4);
    const valuationReturn = (company.valuation - prevValuation) / Math.max(0.0001, prevValuation);
    company.stockPrice = Math.max(0.4, (company.stockPrice ?? 1) * (1 + trend + noise + valuationReturn * 0.16));
    company.profitPrev = company.profit;
    cityRevenue.set(company.cityId, (cityRevenue.get(company.cityId) ?? 0) + Math.max(0.0001, company.revenue));
  }
  for (const company of companies) {
    const total = cityRevenue.get(company.cityId) ?? 1;
    company.marketShare = Number(((company.revenue / total) * 100).toFixed(2));
  }
  distributeCompanyDividends({ people, companies, config, world, phase });
  updateCompanyRlLearning({ companies, config, phase });
  simulateTechnologyProgress({ companies, world, rng, phase });
  advanceSchoolLearning({ people, world, phase, config, rng });

  simulateCompanyInvestments({ people, companies, world, rng, phase });
  simulateCorporateCrossHoldings({ companies, world, rng, phase });
  simulateInstitutionalInvestments({ companies, world, rng, phase, day, config });
  for (const company of companies) {
    normalizeCapTable(company);
  }
  syncPersonStockAssetsFromHoldings(people, companies, config);
}

function computeCityResourceEconomyProfile(city, prices) {
  const stockRatio = (key) => {
    const node = city.resources?.[key];
    if (!node) {
      return 0.55;
    }
    return clamp01((node.stock ?? 0) / Math.max(1, node.capacity ?? 1));
  };
  const human = city.resources?.human ?? {};
  const humanQuality = clamp01(human.quality ?? 0.55);
  const humanStockRatio = stockRatio("human");
  const energyAccess = stockRatio("energy_fossil") * 0.52 + stockRatio("energy_renewable") * 0.48;
  const materialsAccess = stockRatio("metals_bulk") * 0.65 + stockRatio("rare_minerals") * 0.35;
  const foodSecurity = stockRatio("food") * 0.58 + stockRatio("water") * 0.42;
  const scarcityPressure =
    (prices.water ?? 1) * (1 - stockRatio("water")) * 0.2 +
    (prices.food ?? 1) * (1 - stockRatio("food")) * 0.2 +
    (prices.energy_fossil ?? 1) * (1 - stockRatio("energy_fossil")) * 0.17 +
    (prices.energy_renewable ?? 1) * (1 - stockRatio("energy_renewable")) * 0.13 +
    (prices.metals_bulk ?? 1) * (1 - stockRatio("metals_bulk")) * 0.16 +
    (prices.rare_minerals ?? 1) * (1 - stockRatio("rare_minerals")) * 0.14;
  const humanWageFactor = clamp(0.9 + humanQuality * 0.1 + (1 - humanStockRatio) * 0.08, 0.82, 1.2);
  return {
    stockRatio,
    humanQuality,
    humanStockRatio,
    energyAccess,
    materialsAccess,
    foodSecurity,
    scarcityPressure,
    humanWageFactor
  };
}

function getSectorResourceDemand(sector) {
  const S = {
    water: 0.1,
    food: 0.1,
    energy_fossil: 0.2,
    energy_renewable: 0.2,
    metals_bulk: 0.2,
    rare_minerals: 0.1,
    human: 0.1
  };
  const map = {
    Industry: { water: 0.11, food: 0.05, energy_fossil: 0.28, energy_renewable: 0.12, metals_bulk: 0.25, rare_minerals: 0.1, human: 0.09 },
    Finance: { water: 0.05, food: 0.08, energy_fossil: 0.08, energy_renewable: 0.17, metals_bulk: 0.05, rare_minerals: 0.12, human: 0.45 },
    Logistics: { water: 0.08, food: 0.06, energy_fossil: 0.3, energy_renewable: 0.12, metals_bulk: 0.18, rare_minerals: 0.06, human: 0.2 },
    Tech: { water: 0.05, food: 0.06, energy_fossil: 0.1, energy_renewable: 0.22, metals_bulk: 0.14, rare_minerals: 0.18, human: 0.25 },
    Retail: { water: 0.12, food: 0.2, energy_fossil: 0.1, energy_renewable: 0.12, metals_bulk: 0.06, rare_minerals: 0.05, human: 0.35 },
    Services: { water: 0.08, food: 0.14, energy_fossil: 0.08, energy_renewable: 0.14, metals_bulk: 0.05, rare_minerals: 0.05, human: 0.46 },
    Craft: { water: 0.1, food: 0.08, energy_fossil: 0.17, energy_renewable: 0.15, metals_bulk: 0.2, rare_minerals: 0.08, human: 0.22 },
    LocalService: { water: 0.1, food: 0.18, energy_fossil: 0.1, energy_renewable: 0.12, metals_bulk: 0.05, rare_minerals: 0.03, human: 0.42 },
    Agri: { water: 0.28, food: 0.22, energy_fossil: 0.12, energy_renewable: 0.14, metals_bulk: 0.08, rare_minerals: 0.03, human: 0.13 }
  };
  return map[sector] ?? S;
}

function computeResourceOutputFactor(profile, demand) {
  const waterFood = profile.stockRatio("water") * 0.5 + profile.stockRatio("food") * 0.5;
  const energy = profile.stockRatio("energy_fossil") * 0.55 + profile.stockRatio("energy_renewable") * 0.45;
  const materials = profile.stockRatio("metals_bulk") * 0.68 + profile.stockRatio("rare_minerals") * 0.32;
  const human = profile.humanQuality * 0.6 + profile.humanStockRatio * 0.4;
  const weighted =
    waterFood * (demand.water + demand.food) +
    energy * (demand.energy_fossil + demand.energy_renewable) +
    materials * (demand.metals_bulk + demand.rare_minerals) +
    human * demand.human;
  return clamp(0.62 + weighted * 0.58, 0.45, 1.28);
}

function computeResourceCostFactor(prices, demand, profile) {
  const priceWeighted =
    (prices.water ?? 1) * demand.water +
    (prices.food ?? 1) * demand.food +
    (prices.energy_fossil ?? 1) * demand.energy_fossil +
    (prices.energy_renewable ?? 1) * demand.energy_renewable +
    (prices.metals_bulk ?? 1) * demand.metals_bulk +
    (prices.rare_minerals ?? 1) * demand.rare_minerals +
    (prices.human ?? 1) * demand.human;
  return clamp(0.9 + priceWeighted * 0.22 + profile.scarcityPressure * 0.08, 0.86, 1.65);
}

function ensureTechnologyState(world) {
  world.systemState = world.systemState ?? {};
  const tech = (world.systemState.technology = world.systemState.technology ?? {
    globalIndex: 1,
    knowledgeStock: 0.1,
    cumulativeRd: 0,
    nationIndex: {},
    sectorIndex: {}
  });
  for (const nation of world.nations ?? []) {
    if (!Number.isFinite(tech.nationIndex[nation.id])) {
      tech.nationIndex[nation.id] = 1;
    }
  }
  const sectors = ["Industry", "Finance", "Logistics", "Tech", "Retail", "Services", "Craft", "LocalService", "Agri"];
  for (const sector of sectors) {
    if (!Number.isFinite(tech.sectorIndex[sector])) {
      tech.sectorIndex[sector] = 1;
    }
  }
  return tech;
}

function getTechnologyContext(technologyState, nationId, sector) {
  const globalIndex = Number.isFinite(technologyState?.globalIndex) ? technologyState.globalIndex : 1;
  const nationIndex = nationId && Number.isFinite(technologyState?.nationIndex?.[nationId]) ? technologyState.nationIndex[nationId] : 1;
  const sectorIndex = sector && Number.isFinite(technologyState?.sectorIndex?.[sector]) ? technologyState.sectorIndex[sector] : 1;
  const productivityBoost = clamp(1 + (globalIndex - 1) * 0.28 + (nationIndex - 1) * 0.2 + (sectorIndex - 1) * 0.2, 0.85, 1.65);
  const resourceEfficiency = clamp(1 + (globalIndex - 1) * 0.45 + (sectorIndex - 1) * 0.3, 1, 2.2);
  return { globalIndex, nationIndex, sectorIndex, productivityBoost, resourceEfficiency };
}

function applyTechnologyToResourceDemand(demand, resourceEfficiency) {
  if (!demand) {
    return demand;
  }
  const eff = clamp(resourceEfficiency ?? 1, 1, 2.2);
  const copy = { ...demand };
  const shrink = (key, weight = 1) => {
    copy[key] = Math.max(0.005, (copy[key] ?? 0) / (1 + (eff - 1) * weight));
  };
  shrink("water", 0.5);
  shrink("food", 0.25);
  shrink("energy_fossil", 0.9);
  shrink("energy_renewable", 0.45);
  shrink("metals_bulk", 0.65);
  shrink("rare_minerals", 0.6);
  return copy;
}

function simulateTechnologyProgress({ companies, world, rng, phase }) {
  if (phase !== "Daytime" || !companies.length) {
    return;
  }
  const tech = ensureTechnologyState(world);
  const rdByNation = {};
  const rdBySector = {};
  let totalRd = 0;
  for (const company of companies) {
    const city = world.getCityById(company.cityId);
    const nationId = city?.nationId ?? null;
    const sector = company.sector ?? "Services";
    const sectorBias =
      sector === "Tech"
        ? 1.45
        : sector === "Industry" || sector === "Logistics"
          ? 1.2
          : sector === "Finance"
            ? 1.1
            : 0.95;
    const rdBias = clamp(company.rdBias ?? 1, 0.5, 2.4);
    const rdSpend =
      (Math.max(0, company.profit ?? 0) * 0.045 * sectorBias + Math.max(0, company.capital ?? 0) * 0.004 * sectorBias) * rdBias;
    if (rdSpend <= 0) {
      continue;
    }
    totalRd += rdSpend;
    if (nationId) {
      rdByNation[nationId] = (rdByNation[nationId] ?? 0) + rdSpend;
    }
    rdBySector[sector] = (rdBySector[sector] ?? 0) + rdSpend;
    company.capital = clamp01((company.capital ?? 0) - rdSpend * 0.02);
    company.rdBudget = Number((((company.rdBudget ?? 0) * 0.85) + rdSpend * 0.15).toFixed(6));
  }
  const progressBase = totalRd * 0.0014 + Math.sqrt(totalRd) * 0.0009;
  for (const [nationId, spend] of Object.entries(rdByNation)) {
    const bump = progressBase * (spend / Math.max(0.0001, totalRd)) * rng.range(0.88, 1.12);
    tech.nationIndex[nationId] = clamp((tech.nationIndex[nationId] ?? 1) * 0.9998 + bump, 0.9, 3.5);
  }
  for (const [sector, spend] of Object.entries(rdBySector)) {
    const bump = progressBase * (spend / Math.max(0.0001, totalRd)) * rng.range(0.9, 1.15);
    tech.sectorIndex[sector] = clamp((tech.sectorIndex[sector] ?? 1) * 0.9997 + bump, 0.9, 3.8);
  }
  const nationAvg =
    Object.values(tech.nationIndex).reduce((sum, v) => sum + v, 0) /
    Math.max(1, Object.keys(tech.nationIndex).length);
  const sectorAvg =
    Object.values(tech.sectorIndex).reduce((sum, v) => sum + v, 0) /
    Math.max(1, Object.keys(tech.sectorIndex).length);
  tech.knowledgeStock = clamp((tech.knowledgeStock ?? 0.1) * 0.999 + totalRd * 0.0004, 0, 10);
  tech.cumulativeRd = Number(((tech.cumulativeRd ?? 0) + totalRd).toFixed(6));
  tech.globalIndex = clamp(0.4 + nationAvg * 0.35 + sectorAvg * 0.35 + tech.knowledgeStock * 0.12, 0.9, 4);
}

function ensureRlPolicyState(target, actionSpace, fallback = "balanced") {
  target.rlPolicy = target.rlPolicy ?? {};
  target.rlPolicy.qByAction = target.rlPolicy.qByAction ?? {};
  target.rlPolicy.nByAction = target.rlPolicy.nByAction ?? {};
  target.rlPolicy.qByStateAction = target.rlPolicy.qByStateAction ?? {};
  target.rlPolicy.nByStateAction = target.rlPolicy.nByStateAction ?? {};
  for (const a of actionSpace) {
    if (!Number.isFinite(target.rlPolicy.qByAction[a])) {
      target.rlPolicy.qByAction[a] = 0.5;
    }
    if (!Number.isFinite(target.rlPolicy.nByAction[a])) {
      target.rlPolicy.nByAction[a] = 0;
    }
  }
  target.rlPolicy.lastAction = target.rlPolicy.lastAction ?? fallback;
  target.rlPolicy.lastStateKey = target.rlPolicy.lastStateKey ?? "global";
  return target.rlPolicy;
}

function stateActionKey(stateKey, action) {
  return `${stateKey}::${action}`;
}

function getPolicyQ(policy, stateKey, action) {
  const stateQ = policy.qByStateAction?.[stateActionKey(stateKey, action)];
  if (Number.isFinite(stateQ)) {
    return stateQ;
  }
  return policy.qByAction?.[action] ?? 0.5;
}

function updatePolicyQ(policy, stateKey, action, reward, alpha) {
  const key = stateActionKey(stateKey, action);
  const prevStateQ = Number.isFinite(policy.qByStateAction[key]) ? policy.qByStateAction[key] : getPolicyQ(policy, stateKey, action);
  policy.qByStateAction[key] = Number((prevStateQ + alpha * (reward - prevStateQ)).toFixed(6));
  policy.nByStateAction[key] = (policy.nByStateAction[key] ?? 0) + 1;
  const prevGlobalQ = policy.qByAction[action] ?? 0.5;
  policy.qByAction[action] = Number((prevGlobalQ + alpha * (reward - prevGlobalQ)).toFixed(6));
  policy.nByAction[action] = (policy.nByAction[action] ?? 0) + 1;
}

function chooseRlAction(policy, actionSpace, epsilon, rng, stateKey = "global") {
  if (rng.next() < epsilon) {
    return actionSpace[Math.floor(rng.range(0, actionSpace.length))];
  }
  let best = actionSpace[0];
  let bestQ = -Infinity;
  for (const a of actionSpace) {
    const q = getPolicyQ(policy, stateKey, a);
    if (q > bestQ) {
      bestQ = q;
      best = a;
    }
  }
  return best;
}

function companyStateKey(company) {
  const profitBand = band3((company.profit ?? 0) + 0.3, 0.2, 0.55);
  const distressBand = band3(company.distress ?? 0.2, 0.28, 0.56);
  const capitalBand = band3(company.capital ?? 0.45, 0.3, 0.62);
  const shareBand = band3((company.marketShare ?? 0) / 100, 0.2, 0.45);
  return `p${profitBand}|d${distressBand}|k${capitalBand}|m${shareBand}`;
}

function applyCompanyRlActions({ companies, config, rng }) {
  const eps = clamp(config.rl?.companyEpsilon ?? config.rl?.epsilon ?? 0.12, 0.01, 0.45);
  for (const c of companies) {
    const policy = ensureRlPolicyState(c, COMPANY_RL_ACTIONS, "balanced");
    const stateKey = companyStateKey(c);
    const action = chooseRlAction(policy, COMPANY_RL_ACTIONS, eps, rng, stateKey);
    policy.lastAction = action;
    policy.lastStateKey = stateKey;
    if (action === "margin_focus") {
      c.pricePower = clamp((c.pricePower ?? 1) * 1.03, 0.7, 2);
      c.wageMultiplier = clamp((c.wageMultiplier ?? 1) * 0.98, 0.65, 1.8);
      c.rdBias = 0.85;
    } else if (action === "labor_focus") {
      c.pricePower = clamp((c.pricePower ?? 1) * 0.995, 0.7, 2);
      c.wageMultiplier = clamp((c.wageMultiplier ?? 1) * 1.025, 0.65, 1.8);
      c.rdBias = 0.95;
    } else if (action === "innovation_focus") {
      c.pricePower = clamp((c.pricePower ?? 1) * 1.005, 0.7, 2);
      c.wageMultiplier = clamp((c.wageMultiplier ?? 1) * 0.995, 0.65, 1.8);
      c.rdBias = 1.35;
    } else {
      c.pricePower = clamp((c.pricePower ?? 1) * 1.0, 0.7, 2);
      c.wageMultiplier = clamp((c.wageMultiplier ?? 1) * 1.0, 0.65, 1.8);
      c.rdBias = 1;
    }
  }
}

function updateCompanyRlLearning({ companies, config, phase }) {
  if (phase !== "Daytime") {
    return;
  }
  const alpha = clamp(config.rl?.companyAlpha ?? config.rl?.alpha ?? 0.12, 0.01, 0.5);
  for (const c of companies) {
    const policy = ensureRlPolicyState(c, COMPANY_RL_ACTIONS, "balanced");
    const action = policy.lastAction ?? "balanced";
    const stateKey = policy.lastStateKey ?? companyStateKey(c);
    const employmentStability = clamp01((c.employeeCount ?? 0) / Math.max(1, c.capacity * 8));
    const reward = clamp(
      (c.profit ?? 0) * 2.1 +
        (c.marketShare ?? 0) * 0.008 +
        (c.capital ?? 0) * 0.28 -
        (c.distress ?? 0) * 0.5 +
        employmentStability * 0.22 +
        (c.employeeCount > 0 ? 0.03 : -0.08),
      -1,
      2
    );
    updatePolicyQ(policy, stateKey, action, reward, alpha);
  }
}

function advanceSchoolLearning({ people, world, phase, config, rng }) {
  if (!(config.educationSystem?.enabled ?? true)) {
    return;
  }
  if (phase !== "Morning" && phase !== "Daytime") {
    return;
  }
  const baseGain = clamp(config.educationSystem?.dailyStudyGain ?? 0.0045, 0.0005, 0.03);
  for (const person of people) {
    if (!person.school?.enrolled) {
      continue;
    }
    const city = world.getCityById(person.school.cityId ?? person.homeCityId);
    const cityEduQuality = clamp((city?.metrics?.productivity ?? 0.8) * 0.5 + (city?.metrics?.trust ?? 0.5) * 0.5, 0.25, 1.4);
    const stageBoost =
      person.school.stage === "primary" ? 0.85 : person.school.stage === "secondary" ? 1 : person.school.stage === "tertiary" ? 1.25 : 0.5;
    const gain =
      baseGain *
      stageBoost *
      cityEduQuality *
      (person.school.aptitude ?? 0.5) *
      (0.8 + (person.traits?.discipline ?? 0.5) * 0.4) *
      rng.range(0.92, 1.08);
    person.school.progress = clamp01((person.school.progress ?? 0) + gain * 3.2);
    person.school.year = Number((((person.school.year ?? 0) + gain * 1.7)).toFixed(4));
    person.socioeconomic.education = clamp01((person.socioeconomic.education ?? 0.4) + gain);
    person.socioeconomic.skill = clamp01((person.socioeconomic.skill ?? 0.4) + gain * 0.45);
    if (
      (person.school.stage === "primary" && person.age > 12.9) ||
      (person.school.stage === "secondary" && person.age > 17.9) ||
      (person.school.stage === "tertiary" && (person.age > 22.4 || person.school.year >= 4))
    ) {
      person.school.enrolled = false;
      person.school.graduated = true;
      person.school.stage = getSchoolStageForAge(person.age);
      if (person.profession === "student") {
        person.profession = "generalist";
      }
    }
    person.socioeconomic.wealth = computeSocioeconomicWealth(person.socioeconomic);
  }
}

function ensureSocioeconomicBreakdown(person) {
  person.socioeconomic = person.socioeconomic ?? {};
  const s = person.socioeconomic;
  s.skill = clamp01(s.skill ?? 0.4);
  s.education = clamp01(s.education ?? 0.4);
  const baseWealth = clamp01(s.wealth ?? 0.35);
  s.cash = clamp01(Number.isFinite(s.cash) ? s.cash : baseWealth * 0.45);
  s.realEstate = clamp01(Number.isFinite(s.realEstate) ? s.realEstate : baseWealth * 0.32);
  s.stocks = clamp01(Number.isFinite(s.stocks) ? s.stocks : baseWealth * 0.23);
  s.bankDeposit = clamp01(Number.isFinite(s.bankDeposit) ? s.bankDeposit : baseWealth * 0.18);
  s.debt = clamp01(Number.isFinite(s.debt) ? s.debt : baseWealth * 0.06);
  s.salaryWealth = clamp01(Number.isFinite(s.salaryWealth) ? s.salaryWealth : baseWealth * 0.45);
  s.equityWealth = clamp01(Number.isFinite(s.equityWealth) ? s.equityWealth : s.stocks ?? baseWealth * 0.23);
  s.wealthRaw = Number.isFinite(s.wealthRaw) ? s.wealthRaw : s.salaryWealth + s.equityWealth;
  s.wealth = computeSocioeconomicWealth(s);
}

function computeSocioeconomicWealth(s) {
  const salary = clamp01(s.salaryWealth ?? 0);
  const equity = clamp01(s.equityWealth ?? 0);
  const wealthRaw = Math.max(0, salary + equity);
  s.wealthRaw = Number(wealthRaw.toFixed(6));
  return clamp01(wealthRaw);
}

function getCurrencyContextForCity(city, currencyState) {
  const nationId = city?.nationId ?? null;
  const fx = Number.isFinite(currencyState?.fxAgainstBase?.[nationId]) ? currencyState.fxAgainstBase[nationId] : 1;
  const inflation = Number.isFinite(currencyState?.inflation?.[nationId]) ? currencyState.inflation[nationId] : 0.012;
  const policyRate = Number.isFinite(currencyState?.policyRate?.[nationId]) ? currencyState.policyRate[nationId] : 0.02;
  const purchasingPower = clamp(1 / Math.max(0.75, fx * (1 + inflation * 0.25)), 0.82, 1.2);
  return { nationId, fx, inflation, policyRate, purchasingPower };
}

function applyPersonalAssetDynamics({
  person,
  city,
  income,
  marketIndex,
  currencyCtx,
  salaryWealthEma,
  salaryWealthScale,
  config,
  rng
}) {
  const s = person.socioeconomic;
  const incomeFlow = Math.max(0, income) * 0.004;
  const inflationCost = 1 + (currencyCtx?.inflation ?? 0.012) * 0.6;
  const livingCost = (city.metrics.costOfLiving ?? 1) * 0.002 * inflationCost;
  const cognitive = person.ability?.cognitive ?? 0.5;
  const discipline = person.traits?.discipline ?? 0.5;
  const risk = person.traits?.riskTolerance ?? 0.5;
  const education = s.education ?? 0.5;
  const savingsCapacity = clamp01(cognitive * 0.3 + discipline * 0.35 + education * 0.25 + (1 - risk) * 0.1);
  const investability = clamp01(cognitive * 0.35 + education * 0.25 + risk * 0.25 + discipline * 0.15);
  const net = incomeFlow - livingCost;
  const reserveBias = 0.25 + (1 - investability) * 0.35;
  const investPool = Math.max(0, net * (1 - reserveBias) * (0.55 + savingsCapacity * 0.45));
  const stockBuy = investPool * (0.42 + investability * 0.28);
  const realEstateBuy = investPool * (0.3 + discipline * 0.24);
  const remaining = net - stockBuy - realEstateBuy;

  const stockReturn = (marketIndex - 1) * 0.02 + rng.range(-0.006, 0.006);
  const propertyTrend =
    (city.metrics.costOfLiving - 1) * 0.014 + city.metrics.productivity * 0.006 + city.metrics.trust * 0.002;
  const propertyReturn = clamp(propertyTrend + rng.range(-0.003, 0.003), -0.02, 0.03);

  s.cash = clamp01((s.cash ?? 0) + remaining);
  s.stocks = clamp01((s.stocks ?? 0) * (1 + stockReturn) + stockBuy);
  s.realEstate = clamp01((s.realEstate ?? 0) * (1 + propertyReturn) + realEstateBuy);

  if (config?.banking?.enabled ?? true) {
    const baseDepositFlow = config?.banking?.baseDepositFlow ?? 0.28;
    const loanSpread = config?.banking?.baseLoanRateSpread ?? 0.015;
    const policyRate = currencyCtx?.policyRate ?? 0.02;
    const inflation = currencyCtx?.inflation ?? 0.012;
    const depositRate = Math.max(0, policyRate * 0.42 - inflation * 0.48 + 0.001);
    const loanRate = Math.max(0.003, policyRate * 0.58 + inflation * 0.32 + loanSpread);
    const targetCash = clamp(0.05 + (1 - discipline) * 0.12 + (1 - education) * 0.08, 0.04, 0.28);
    const depositTransfer = Math.max(0, (s.cash ?? 0) - targetCash) * clamp(baseDepositFlow + discipline * 0.2, 0.08, 0.72);
    s.cash = clamp01((s.cash ?? 0) - depositTransfer);
    s.bankDeposit = clamp01((s.bankDeposit ?? 0) + depositTransfer);

    // Simple credit line for liquidity shortages, then progressive repayment.
    const liquidityGap = Math.max(0, livingCost * 0.85 - (s.cash ?? 0));
    if (liquidityGap > 0) {
      const borrow = clamp(liquidityGap * 0.8, 0, 0.08);
      s.cash = clamp01((s.cash ?? 0) + borrow);
      s.debt = clamp01((s.debt ?? 0) + borrow);
    }
    s.bankDeposit = clamp01((s.bankDeposit ?? 0) * (1 + depositRate + rng.range(-0.0015, 0.0015)));
    s.debt = clamp01((s.debt ?? 0) * (1 + loanRate + rng.range(-0.001, 0.001)));

    const repayCapacity = Math.max(0, (s.cash ?? 0) * 0.12 + incomeFlow * 0.18);
    const repay = Math.min(s.debt ?? 0, repayCapacity);
    s.cash = clamp01((s.cash ?? 0) - repay);
    s.debt = clamp01((s.debt ?? 0) - repay);
  }
  const salarySignal = clamp01(Math.max(0, income) * salaryWealthScale);
  const baseSalaryWealth = Number.isFinite(s.salaryWealth) ? s.salaryWealth : salarySignal;
  s.salaryWealth = clamp01(baseSalaryWealth * (1 - salaryWealthEma) + salarySignal * salaryWealthEma);
}

function computeNightEncounters({ phase, people, world, baseRate }) {
  if (phase !== "Night") {
    return { total: 0, byCity: {} };
  }

  const leisureByCity = new Map(world.cities.map((city) => [city.id, []]));
  for (const person of people) {
    if (person.currentState === "Leisure") {
      leisureByCity.get(person.currentCityId)?.push(person);
    }
  }

  const byCity = {};
  let total = 0;

  for (const city of world.cities) {
    const leisurePeople = leisureByCity.get(city.id) ?? [];
    if (leisurePeople.length < 2) {
      byCity[city.id] = 0;
      continue;
    }

    const avgSociability =
      leisurePeople.reduce((sum, person) => sum + person.traits.sociability, 0) / leisurePeople.length;
    const cityNightlifeAttraction = 0.5 + (1 - city.metrics.congestion) * 0.2 + city.metrics.safety * 0.3;

    const epidemicBrake = Math.max(0.35, 1 - (world.systemState?.epidemicLevel ?? 0) * 0.65);
    const expected =
      leisurePeople.length * baseRate * avgSociability * cityNightlifeAttraction * epidemicBrake;
    const cityEncounters = Math.floor(expected);

    byCity[city.id] = cityEncounters;
    total += cityEncounters;
  }

  return { total, byCity };
}

function updateSocialNetwork({ people, world, phase, day, rng }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const person of people) {
    person.social = person.social ?? { ties: {}, updatedDay: -1 };
    person.social.ties = person.social.ties ?? {};
    if (person.social.updatedDay !== day) {
      decaySocialTies(person, day);
    }
  }

  const workersByEmployer = new Map();
  for (const person of people) {
    if (!(person.employed && person.currentState === "Work" && person.employerId)) {
      continue;
    }
    const key = String(person.employerId);
    if (!workersByEmployer.has(key)) {
      workersByEmployer.set(key, []);
    }
    workersByEmployer.get(key).push(person);
  }
  for (const [, workers] of workersByEmployer) {
    if (workers.length < 2) {
      continue;
    }
    for (const person of workers) {
      const sample = Math.min(3, workers.length - 1);
      for (let i = 0; i < sample; i += 1) {
        const peer = workers[Math.floor(rng.range(0, workers.length))];
        if (!peer || peer.id === person.id) {
          continue;
        }
        const affinity =
          (person.traits.sociability + peer.traits.sociability) * 0.5 * 0.02 +
          (person.ability.charisma + peer.ability.charisma) * 0.5 * 0.018 +
          rng.range(-0.003, 0.004);
        updateTie(person, peer, byId, clamp(0.026 + affinity, 0.012, 0.065));
      }
    }
  }

  if (phase === "Night") {
    const byCity = new Map(world.cities.map((c) => [c.id, []]));
    for (const person of people) {
      if (person.currentState === "Leisure") {
        byCity.get(person.currentCityId)?.push(person);
      }
    }
    for (const [, rows] of byCity) {
      if (rows.length < 2) {
        continue;
      }
      const interactions = Math.min(80, Math.max(1, Math.floor(rows.length * 0.12)));
      for (let i = 0; i < interactions; i += 1) {
        const a = rows[Math.floor(rng.range(0, rows.length))];
        const b = rows[Math.floor(rng.range(0, rows.length))];
        if (!a || !b || a.id === b.id) {
          continue;
        }
        const sharedReligion = a.religion === b.religion ? 0.008 : 0;
        const opennessBoost = ((a.traits.openness + b.traits.openness) * 0.5 - 0.5) * 0.008;
        updateTie(a, b, byId, clamp(0.006 + sharedReligion + opennessBoost + rng.range(-0.002, 0.002), 0.001, 0.02));
      }
    }
  }

  for (const person of people) {
    if (person.partnerId && byId.has(person.partnerId)) {
      const partner = byId.get(person.partnerId);
      updateTie(person, partner, byId, 0.012);
    }
  }

  return buildSocialNetworkSnapshot(people, world);
}

function decaySocialTies(person, day) {
  const ties = person.social?.ties ?? {};
  const next = {};
  for (const [id, value] of Object.entries(ties)) {
    const decayed = value * 0.985;
    if (decayed >= 0.02) {
      next[id] = Number(decayed.toFixed(4));
    }
  }
  person.social.ties = next;
  person.social.updatedDay = day;
}

function updateTie(a, b, byId, delta) {
  const aSocial = a.social ?? { ties: {}, updatedDay: -1 };
  const bSocial = b.social ?? { ties: {}, updatedDay: -1 };
  const aid = String(a.id);
  const bid = String(b.id);
  aSocial.ties[bid] = clamp((aSocial.ties[bid] ?? 0) + delta, 0, 1);
  bSocial.ties[aid] = clamp((bSocial.ties[aid] ?? 0) + delta, 0, 1);
  a.social = aSocial;
  b.social = bSocial;
  if (!byId.has(a.id)) {
    byId.set(a.id, a);
  }
  if (!byId.has(b.id)) {
    byId.set(b.id, b);
  }
}

function buildSocialNetworkSnapshot(people, world) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const nodes = [];
  const edges = [];
  const seen = new Set();
  let tieSum = 0;
  for (const person of people) {
    const ties = person.social?.ties ?? {};
    const entries = Object.entries(ties);
    const strength = entries.reduce((sum, [, v]) => sum + v, 0);
    nodes.push({
      id: person.id,
      name: person.name,
      cityId: person.currentCityId,
      city: world.getCityById(person.currentCityId)?.name ?? person.currentCityId,
      employerId: person.employerId ?? null,
      state: person.currentState,
      degree: entries.length,
      strength: Number(strength.toFixed(3))
    });
    for (const [peerId, weight] of entries) {
      const a = Math.min(person.id, Number(peerId));
      const b = Math.max(person.id, Number(peerId));
      const key = `${a}|${b}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const peer = byId.get(Number(peerId));
      edges.push({
        from: a,
        to: b,
        weight: Number(weight.toFixed(3)),
        fromEmployerId: person.id === a ? person.employerId ?? null : peer?.employerId ?? null,
        toEmployerId: person.id === b ? person.employerId ?? null : peer?.employerId ?? null
      });
      tieSum += weight;
    }
  }
  nodes.sort((a, b) => b.strength - a.strength || b.degree - a.degree || a.id - b.id);
  edges.sort((a, b) => b.weight - a.weight || a.from - b.from || a.to - b.to);
  return {
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      averageTieWeight: Number((tieSum / Math.max(1, edges.length)).toFixed(3))
    },
    topConnectors: nodes.slice(0, 12),
    nodes: nodes.slice(0, 220),
    edges: edges.slice(0, 420)
  };
}

function applyWeeklyDynamics({ world, people, phase, dayOfWeek, isWeekend, rng }) {
  const events = [];
  if (!isWeekend) {
    if (phase === "Morning" && dayOfWeek === 0) {
      for (const city of world.cities) {
        city.metrics.productivity = clamp01(city.metrics.productivity + 0.008);
      }
      events.push({ type: "policy_schedule", text: "週初: 教育施策が実行" });
    }
    if (phase === "Evening" && dayOfWeek === 2) {
      for (const city of world.cities) {
        city.metrics.trust = clamp01(city.metrics.trust + 0.01);
      }
      events.push({ type: "policy_schedule", text: "週中: 福祉施策が実行" });
    }
    if (phase === "Night" && dayOfWeek === 4) {
      for (const city of world.cities) {
        city.metrics.safety = clamp01(city.metrics.safety + 0.012);
      }
      events.push({ type: "policy_schedule", text: "週末前: 治安施策が実行" });
    }
    return events;
  }

  if (phase !== "Night") {
    return events;
  }
  const byCity = new Map(world.cities.map((city) => [city.id, []]));
  for (const person of people) {
    byCity.get(person.currentCityId)?.push(person);
  }
  for (const city of world.cities) {
    const rows = byCity.get(city.id) ?? [];
    if (rows.length < 12) {
      continue;
    }
    const religionCount = new Map();
    for (const p of rows) {
      religionCount.set(p.religion, (religionCount.get(p.religion) || 0) + 1);
    }
    const major = Array.from(religionCount.entries()).sort((a, b) => b[1] - a[1])[0];
    if (!major) {
      continue;
    }
    const share = major[1] / rows.length;
    const boost = 0.004 + share * 0.012;
    city.metrics.trust = clamp01(city.metrics.trust + boost);
    city.metrics.safety = clamp01(city.metrics.safety + boost * 0.6 - city.metrics.congestion * 0.002);
    if (rng.next() < 0.45) {
      events.push({ type: "gathering", text: `${city.name}: ${major[0]}集会で結束が上昇` });
    }
  }
  return events.slice(0, 4);
}

function pickOne(values, rng) {
  const index = Math.floor(rng.range(0, values.length));
  return values[Math.min(values.length - 1, index)];
}

function computeHighlights(people) {
  if (people.length === 0) {
    return {
      economicPower: null,
      cognitive: null,
      sociability: null
    };
  }

  const topBy = (scorer) => people.reduce((best, person) => (scorer(person) > scorer(best) ? person : best), people[0]);

  const richest = topBy((person) => economyPower(person));
  const smartest = topBy((person) => person.ability.cognitive);
  const mostSocial = topBy((person) => person.traits.sociability);

  return {
    economicPower: toCard(richest, economyPower(richest)),
    cognitive: toCard(smartest, smartest.ability.cognitive),
    sociability: toCard(mostSocial, mostSocial.traits.sociability)
  };
}

function computeGeneticsSummary(people) {
  if (people.length === 0) {
    return {
      topPotential: null,
      topEpigeneticShift: null,
      diversity: { personality: 0, ability: 0 }
    };
  }

  const topBy = (scorer) => people.reduce((best, person) => (scorer(person) > scorer(best) ? person : best), people[0]);
  const bestPotential = topBy((person) => geneticPotential(person));
  const bestEpigeneticShift = topBy((person) => epigeneticShiftMagnitude(person));

  let personalityHet = 0;
  let abilityHet = 0;
  let personalityCount = 0;
  let abilityCount = 0;
  for (const person of people) {
    if (!person.genetics) {
      continue;
    }
    for (const key of PERSONALITY_KEYS) {
      const a1 = person.genetics.personalityChromosomes?.[0]?.[key];
      const a2 = person.genetics.personalityChromosomes?.[1]?.[key];
      if (Number.isFinite(a1) && Number.isFinite(a2)) {
        personalityHet += Math.abs(a1 - a2);
        personalityCount += 1;
      }
    }
    for (const key of ABILITY_KEYS) {
      const a1 = person.genetics.abilityChromosomes?.[0]?.[key];
      const a2 = person.genetics.abilityChromosomes?.[1]?.[key];
      if (Number.isFinite(a1) && Number.isFinite(a2)) {
        abilityHet += Math.abs(a1 - a2);
        abilityCount += 1;
      }
    }
  }

  return {
    topPotential: toCard(bestPotential, geneticPotential(bestPotential)),
    topEpigeneticShift: toCard(bestEpigeneticShift, epigeneticShiftMagnitude(bestEpigeneticShift)),
    diversity: {
      personality: Number((personalityHet / Math.max(1, personalityCount)).toFixed(3)),
      ability: Number((abilityHet / Math.max(1, abilityCount)).toFixed(3))
    }
  };
}

function geneticPotential(person) {
  if (person.genetics?.abilityChromosomes) {
    let sum = 0;
    let count = 0;
    for (const key of ABILITY_KEYS) {
      const a1 = person.genetics.abilityChromosomes[0][key];
      const a2 = person.genetics.abilityChromosomes[1][key];
      if (Number.isFinite(a1) && Number.isFinite(a2)) {
        sum += (a1 + a2) * 0.5;
        count += 1;
      }
    }
    if (count > 0) {
      return sum / count;
    }
  }
  return ABILITY_KEYS.reduce((s, k) => s + (person.ability?.[k] ?? 0), 0) / ABILITY_KEYS.length;
}

function epigeneticShiftMagnitude(person) {
  const epi = person.epigenetics;
  if (!epi) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (const key of PERSONALITY_KEYS) {
    sum += Math.abs(epi.personality?.[key] ?? 0);
    count += 1;
  }
  for (const key of ABILITY_KEYS) {
    sum += Math.abs(epi.ability?.[key] ?? 0);
    count += 1;
  }
  return sum / Math.max(1, count);
}

function economyPower(person) {
  ensureSocioeconomicBreakdown(person);
  const assets =
    person.socioeconomic.cash * 0.24 +
    person.socioeconomic.realEstate * 0.3 +
    person.socioeconomic.stocks * 0.28 +
    person.socioeconomic.bankDeposit * 0.18 -
    person.socioeconomic.debt * 0.2;
  return (
    assets * 0.42 +
    person.socioeconomic.skill * 0.3 +
    person.ability.productivity * 0.2 +
    person.socioeconomic.education * 0.08
  );
}

function toCard(person, score) {
  return {
    id: person.id,
    name: person.name,
    cityId: person.currentCityId,
    score: Number(score.toFixed(3))
  };
}

function computeReligionStats(people, profiles) {
  if (people.length === 0) {
    return [];
  }

  const total = Math.max(1, people.length);
  const map = new Map();

  for (const person of people) {
    const key = person.religion;
    if (!map.has(key)) {
      map.set(key, {
        religion: key,
        count: 0,
        charismaSum: 0,
        conformitySum: 0,
        disciplineSum: 0
      });
    }

    const entry = map.get(key);
    entry.count += 1;
    entry.charismaSum += person.ability.charisma;
    entry.conformitySum += person.traits.conformity;
    entry.disciplineSum += person.traits.discipline;
  }

  const rows = Array.from(map.values()).map((entry) => {
    const share = entry.count / total;
    const avgCharisma = entry.charismaSum / entry.count;
    const avgConformity = entry.conformitySum / entry.count;
    const avgDiscipline = entry.disciplineSum / entry.count;
    const influenceRaw =
      share * (0.5 + avgCharisma * 0.25 + avgConformity * 0.15 + avgDiscipline * 0.1);

    return {
      religion: entry.religion,
      count: entry.count,
      share: Number((share * 100).toFixed(1)),
      influenceRaw
    };
  });

  const maxInfluence = Math.max(0.000001, ...rows.map((row) => row.influenceRaw));
  return rows
    .map((row) => ({
      religion: row.religion,
      count: row.count,
      share: row.share,
      influence: Number(((row.influenceRaw / maxInfluence) * 100).toFixed(1)),
      doctrine: (profiles[row.religion] ?? profiles.Free).doctrine
    }))
    .sort((a, b) => b.count - a.count);
}

function computeReligionByCity(people, world) {
  const counters = {};
  for (const city of world.cities) {
    counters[city.id] = { total: 0, map: new Map() };
  }
  for (const person of people) {
    const row = counters[person.currentCityId];
    if (!row) {
      continue;
    }
    row.total += 1;
    row.map.set(person.religion, (row.map.get(person.religion) || 0) + 1);
  }
  const out = {};
  for (const city of world.cities) {
    const row = counters[city.id];
    const total = Math.max(1, row.total);
    out[city.id] = Array.from(row.map.entries())
      .map(([religion, count]) => ({ religion, count, share: Number(((count / total) * 100).toFixed(1)) }))
      .sort((a, b) => b.count - a.count);
  }
  return out;
}

function applyReligionConversion({ people, world, rng, phase, baseRate, isWeekend, weekendBoost }) {
  if (phase !== "Night") {
    return;
  }
  const byCity = computeReligionByCity(people, world);
  for (const person of people) {
    const rows = byCity[person.currentCityId] || [];
    if (rows.length < 1) {
      continue;
    }
    const majority = rows[0];
    if (!majority || majority.religion === person.religion) {
      continue;
    }
    const openness = person.traits.openness;
    const conformity = person.traits.conformity;
    const pressure = majority.share / 100;
    const weekendFactor = isWeekend ? weekendBoost : 1;
    const prob = baseRate * weekendFactor * (0.4 + pressure * 0.9 + conformity * 0.35 + openness * 0.25);
    if (rng.next() < prob) {
      person.religion = majority.religion;
    }
  }
}

function applyRelocationMigration({
  people,
  world,
  rng,
  phase,
  day,
  baseRate,
  religionByCity,
  religionCompatibilityWeight,
  banditConfig: banditOverrides = {}
}) {
  if (phase !== "Night") {
    return { moves: 0, actions: [] };
  }
  world.systemState = world.systemState ?? {};
  world.systemState.migrationFlows = world.systemState.migrationFlows ?? {
    day: -1,
    pairDaily: {},
    pairEma: {}
  };
  if (world.systemState.migrationFlows.day !== day) {
    world.systemState.migrationFlows.day = day;
    world.systemState.migrationFlows.pairDaily = {};
    for (const key of Object.keys(world.systemState.migrationFlows.pairEma)) {
      world.systemState.migrationFlows.pairEma[key] = Number((world.systemState.migrationFlows.pairEma[key] * 0.94).toFixed(6));
    }
  }
  world.systemState.migrationRegimeStats = world.systemState.migrationRegimeStats ?? {
    day: -1,
    attemptsByRegime: { normal: 0, stressed: 0, fractured: 0 },
    movesByRegime: { normal: 0, stressed: 0, fractured: 0 }
  };
  if (world.systemState.migrationRegimeStats.day !== day) {
    world.systemState.migrationRegimeStats = {
      day,
      attemptsByRegime: { normal: 0, stressed: 0, fractured: 0 },
      movesByRegime: { normal: 0, stressed: 0, fractured: 0 }
    };
  }
  const banditConfig = {
    enabled: true,
    learningRate: 0.12,
    forgetting: 0.02,
    epsilon: 0.08,
    explorationBonus: 0.06,
    utilityWeight: 0.82,
    useContext: true,
    ...banditOverrides
  };
  const cityIds = world.cities.map((c) => c.id);
  const actions = [];
  let moves = 0;
  for (const person of people) {
    if (person.age < 18) {
      continue;
    }
    person.mobility = ensureMobilityModel(person.mobility);
    const cooldownPenalty = day - person.mobility.lastMoveDay < 4 ? 0.45 : 1;
    const fatiguePenalty = 1 - person.fatigue * 0.2;
    const homeCity = world.getCityById(person.homeCityId);
    const regimeMult =
      homeCity?.regime === "fractured" ? 1.55
      : homeCity?.regime === "stressed" ? 1.22
      : 1;
    const strainMult = 1 + clamp(homeCity?.strain ?? 0, 0, 1) * 0.28;
    const migrationDrive = sigmoid((person.traits.noveltySeeking - 0.45) * 2.2) * (0.7 + person.traits.openness * 0.6);
    const baseMigration = baseRate * migrationDrive * cooldownPenalty * fatiguePenalty * regimeMult * strainMult;
    const moveT = 0.48;
    const moveSlope = 0.12;
    const panicBase = 0.18 * sigmoid(((homeCity?.strain ?? 0) - moveT) / moveSlope);
    const panicRegimeMult =
      homeCity?.regime === "fractured" ? 2
      : homeCity?.regime === "stressed" ? 1.45
      : 1;
    const panicMigration = panicBase * panicRegimeMult;
    const moveProb = clamp(baseMigration + panicMigration, 0, 0.92);
    const homeRegime = homeCity?.regime ?? "normal";
    world.systemState.migrationRegimeStats.attemptsByRegime[homeRegime] =
      (world.systemState.migrationRegimeStats.attemptsByRegime[homeRegime] ?? 0) + 1;
    if (rng.next() > moveProb) {
      continue;
    }

    const current = homeCity;
    const currentUtility = cityUtility(current, person, world, religionByCity, religionCompatibilityWeight);
    person.mobility.homeSatisfaction = person.mobility.homeSatisfaction * 0.82 + currentUtility * 0.18;

    let bestId = person.homeCityId;
    let bestUtility = currentUtility;
    let bestScore = migrationBanditScore(person, person.homeCityId, currentUtility, current, banditConfig);
    for (const cityId of cityIds) {
      if (cityId === person.homeCityId) {
        continue;
      }
      if (!world.hasTransitPath(person.homeCityId, cityId)) {
        continue;
      }
      const city = world.getCityById(cityId);
      const util = cityUtility(city, person, world, religionByCity, religionCompatibilityWeight);
      const affinity = person.mobility.cityAffinity[cityId] ?? 0;
      const inertia = person.homeCityId === cityId ? 0.04 : 0;
      const score = migrationBanditScore(person, cityId, util + affinity * 0.05, city, banditConfig) - inertia;
      if (score > bestScore + 0.06) {
        bestScore = score;
        bestUtility = util;
        bestId = cityId;
      }
    }

    if (banditConfig.enabled && rng.next() < banditConfig.epsilon) {
      const candidates = cityIds.filter((cityId) => cityId !== person.homeCityId && world.hasTransitPath(person.homeCityId, cityId));
      if (candidates.length > 0) {
        const exploreId = candidates[Math.floor(rng.next() * candidates.length)];
        const exploreCity = world.getCityById(exploreId);
        const exploreUtility = cityUtility(exploreCity, person, world, religionByCity, religionCompatibilityWeight);
        if (exploreUtility > currentUtility - 0.16) {
          bestId = exploreId;
          bestUtility = exploreUtility;
        }
      }
    }
    if (bestId === person.homeCityId && panicMigration > 0.07) {
      const panicCandidates = cityIds
        .filter((cityId) => cityId !== person.homeCityId && world.hasTransitPath(person.homeCityId, cityId))
        .map((cityId) => {
          const city = world.getCityById(cityId);
          const util = cityUtility(city, person, world, religionByCity, religionCompatibilityWeight);
          const relative = util - currentUtility;
          return { cityId, util, relative };
        })
        .sort((a, b) => b.util - a.util)
        .slice(0, 5);
      if (panicCandidates.length > 0) {
        const temp = clamp(0.16 + (1 - panicMigration) * 0.22, 0.08, 0.4);
        const weights = panicCandidates.map((row) => Math.exp(row.relative / temp));
        const wsum = weights.reduce((s, w) => s + w, 0) || 1;
        let roll = rng.next() * wsum;
        let selected = panicCandidates[0];
        for (let i = 0; i < panicCandidates.length; i += 1) {
          roll -= weights[i];
          if (roll <= 0) {
            selected = panicCandidates[i];
            break;
          }
        }
        if (selected) {
          bestId = selected.cityId;
          bestUtility = selected.util;
        }
      }
    }

    if (bestId !== person.homeCityId) {
      const prevHome = person.homeCityId;
      updateMigrationBandit(person, bestId, bestUtility, world.getCityById(bestId), banditConfig);
      person.mobility.lastMoveDay = day;
      person.mobility.moveCount += 1;
      person.mobility.cityAffinity[bestId] = clamp01((person.mobility.cityAffinity[bestId] ?? 0.35) + 0.08);
      person.mobility.cityAffinity[person.homeCityId] = clamp01((person.mobility.cityAffinity[person.homeCityId] ?? 0.4) - 0.04);
      person.homeCityId = bestId;
      moves += 1;
      actions.push({
        type: "migrate",
        actorId: person.id,
        fromCityId: prevHome,
        toCityId: bestId,
        day
      });
      const fromNation = world.getCityById(prevHome)?.nationId ?? null;
      const toNation = world.getCityById(bestId)?.nationId ?? null;
      if (fromNation && toNation && fromNation !== toNation) {
        const key = fromNation < toNation ? `${fromNation}|${toNation}` : `${toNation}|${fromNation}`;
        world.systemState.migrationFlows.pairDaily[key] = (world.systemState.migrationFlows.pairDaily[key] ?? 0) + 1;
        const prevFlow = world.systemState.migrationFlows.pairEma[key] ?? 0;
        world.systemState.migrationFlows.pairEma[key] = Number((prevFlow * 0.86 + 0.14).toFixed(6));
      }
      world.systemState.migrationRegimeStats.movesByRegime[homeRegime] =
        (world.systemState.migrationRegimeStats.movesByRegime[homeRegime] ?? 0) + 1;
      if (person.currentState === "Home" || person.currentState === "Sleep") {
        person.currentCityId = bestId;
      }
    } else {
      updateMigrationBandit(person, person.homeCityId, currentUtility, current, banditConfig);
      person.mobility.cityAffinity[person.homeCityId] = clamp01((person.mobility.cityAffinity[person.homeCityId] ?? 0.4) + 0.02);
    }
  }
  return { moves, actions };
}

function applyCommunityMembershipDynamics({ people, world, rng, phase, day }) {
  if (phase !== "Night") {
    return { joinCount: 0, leaveCount: 0, actions: [] };
  }
  const communities = world.communities ?? [];
  if (!communities.length) {
    return { joinCount: 0, leaveCount: 0, actions: [] };
  }
  let joinCount = 0;
  let leaveCount = 0;
  const actions = [];
  for (const person of people) {
    person.communityIds = Array.isArray(person.communityIds) ? person.communityIds : [];
    const cityId = person.currentCityId ?? person.homeCityId;
    const localCommunities = communities.filter((c) => (c.memberCityUids ?? []).includes(cityId));
    if (!localCommunities.length) {
      continue;
    }
    const joinProb = clamp(
      0.002 + (person.traits?.sociability ?? 0.5) * 0.008 + (person.traits?.conformity ?? 0.5) * 0.004,
      0,
      0.05
    );
    const leaveProb = clamp(
      0.001 + (person.traits?.openness ?? 0.5) * 0.006 + (1 - (person.householdStability ?? 0.6)) * 0.003,
      0,
      0.04
    );

    if (person.communityIds.length < 3 && rng.next() < joinProb) {
      const candidates = localCommunities.filter((c) => !person.communityIds.includes(c.id));
      if (candidates.length > 0) {
        const com = pickOne(candidates, rng);
        if (com) {
          person.communityIds.push(com.id);
          joinCount += 1;
          actions.push({
            type: "join",
            actorId: person.id,
            communityId: com.id,
            cityId,
            day
          });
        }
      }
    }
    if (person.communityIds.length > 0 && rng.next() < leaveProb) {
      const idx = Math.floor(rng.range(0, person.communityIds.length));
      const communityId = person.communityIds.splice(Math.max(0, Math.min(person.communityIds.length - 1, idx)), 1)[0];
      if (communityId) {
        leaveCount += 1;
        actions.push({
          type: "leave",
          actorId: person.id,
          communityId,
          cityId,
          day
        });
      }
    }
  }
  return { joinCount, leaveCount, actions };
}

function summarizePopulationActionLog(actions) {
  const counts = { join: 0, leave: 0, migrate: 0 };
  for (const row of actions ?? []) {
    if (Object.prototype.hasOwnProperty.call(counts, row.type)) {
      counts[row.type] += 1;
    }
  }
  return {
    counts,
    recent: (actions ?? []).slice(-220)
  };
}

function ensureMobilityModel(mobility) {
  const safe = mobility ?? {};
  safe.lastMoveDay = Number.isFinite(safe.lastMoveDay) ? safe.lastMoveDay : -999;
  safe.moveCount = Number.isFinite(safe.moveCount) ? safe.moveCount : 0;
  safe.homeSatisfaction = Number.isFinite(safe.homeSatisfaction) ? safe.homeSatisfaction : 0.5;
  safe.cityAffinity = safe.cityAffinity ?? {};
  safe.bandit = safe.bandit ?? { qByCity: {}, nByCity: {}, qByStateAction: {}, nByStateAction: {} };
  safe.bandit.qByCity = safe.bandit.qByCity ?? {};
  safe.bandit.nByCity = safe.bandit.nByCity ?? {};
  safe.bandit.qByStateAction = safe.bandit.qByStateAction ?? {};
  safe.bandit.nByStateAction = safe.bandit.nByStateAction ?? {};
  return safe;
}

function migrationContextKey(person, city) {
  const wageBand = band3(city?.metrics?.wageLevel ?? 0.8, 0.7, 1.1);
  const costBand = band3(city?.metrics?.costOfLiving ?? 0.9, 0.85, 1.15);
  const safetyBand = band3(city?.metrics?.safety ?? 0.6, 0.45, 0.72);
  const trustBand = band3(city?.metrics?.trust ?? 0.6, 0.45, 0.72);
  const opennessBand = band3(person?.traits?.openness ?? 0.5, 0.35, 0.65);
  const riskBand = band3(person?.traits?.noveltySeeking ?? 0.5, 0.35, 0.65);
  return `w${wageBand}|c${costBand}|s${safetyBand}|t${trustBand}|o${opennessBand}|r${riskBand}`;
}

function migrationBanditScore(person, cityId, utility, city, config) {
  if (!config.enabled) {
    return utility;
  }
  person.mobility = ensureMobilityModel(person.mobility);
  const q = person.mobility?.bandit?.qByCity?.[cityId] ?? 0;
  const stateKey = config.useContext ? migrationContextKey(person, city) : "global";
  const stateActionKey = `${stateKey}::${cityId}`;
  const qState = person.mobility?.bandit?.qByStateAction?.[stateActionKey] ?? q;
  const n = person.mobility?.bandit?.nByCity?.[cityId] ?? 0;
  const nState = person.mobility?.bandit?.nByStateAction?.[stateActionKey] ?? n;
  const bonus = config.explorationBonus / Math.sqrt(n + 1);
  const contextualBonus = config.explorationBonus / Math.sqrt(nState + 1);
  return utility * config.utilityWeight + qState * 0.7 + q * 0.3 + bonus * 0.35 + contextualBonus * 0.65;
}

function updateMigrationBandit(person, cityId, reward, city, config) {
  if (!config.enabled) {
    return;
  }
  person.mobility = ensureMobilityModel(person.mobility);
  const forgetting = clamp(config.forgetting ?? 0, 0, 0.25);
  if (forgetting > 0) {
    for (const k of Object.keys(person.mobility.bandit.qByCity)) {
      person.mobility.bandit.qByCity[k] = Number((person.mobility.bandit.qByCity[k] * (1 - forgetting)).toFixed(4));
    }
  }
  const qPrev = person.mobility.bandit.qByCity[cityId] ?? reward;
  const nPrev = person.mobility.bandit.nByCity[cityId] ?? 0;
  const alpha = clamp(config.learningRate, 0.01, 0.8);
  const qNext = qPrev + alpha * (reward - qPrev);
  person.mobility.bandit.qByCity[cityId] = Number(qNext.toFixed(4));
  person.mobility.bandit.nByCity[cityId] = nPrev + 1;
  if (config.useContext) {
    const stateKey = migrationContextKey(person, city);
    const stateActionKey = `${stateKey}::${cityId}`;
    const qCtxPrev = person.mobility.bandit.qByStateAction[stateActionKey] ?? qPrev;
    const nCtxPrev = person.mobility.bandit.nByStateAction[stateActionKey] ?? 0;
    const qCtxNext = qCtxPrev + alpha * (reward - qCtxPrev);
    person.mobility.bandit.qByStateAction[stateActionKey] = Number(qCtxNext.toFixed(4));
    person.mobility.bandit.nByStateAction[stateActionKey] = nCtxPrev + 1;
  }
}

function cityUtility(city, person, world, religionByCity, religionCompatibilityWeight) {
  if (!city) {
    return 0;
  }
  const wagePower = city.metrics.wageLevel * city.metrics.productivity;
  const costPenalty = city.metrics.costOfLiving;
  const safety = city.metrics.safety;
  const trust = city.metrics.trust;
  const congestion = city.metrics.congestion;
  const strain = clamp(city.strain ?? 0, 0, 1);
  const regimePenalty =
    city.regime === "fractured" ? 0.18
    : city.regime === "stressed" ? 0.08
    : 0;
  const rows = religionByCity?.[city.id] ?? [];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const same = rows.find((row) => row.religion === person.religion)?.count ?? 0;
  const compatibility = total > 0 ? same / total : 0.25;
  const travelCost = world.findShortestPathCost(person.homeCityId, city.id);
  const distancePenalty = Number.isFinite(travelCost) ? Math.min(0.35, travelCost * 0.055) : 0.45;
  const familiarity = person.mobility?.cityAffinity?.[city.id] ?? 0.4;
  const householdAnchor = person.partnerId ? 0.05 : 0;
  const nonlinearWage = sigmoid((wagePower - 0.75) * 2.1);
  const nonlinearSafety = sigmoid((safety - 0.45) * 3.2);
  const nonlinearCost = sigmoid((costPenalty - 0.7) * 2.2);
  const nonlinearCongestion = sigmoid((congestion - 0.45) * 2.6);
  return (
    nonlinearWage * 0.42 +
    nonlinearSafety * 0.22 +
    trust * 0.12 +
    person.traits.openness * 0.06 +
    familiarity * 0.08 -
    nonlinearCost * 0.2 -
    nonlinearCongestion * 0.16 +
    compatibility * (religionCompatibilityWeight + 0.04) -
    householdAnchor * (city.id === person.homeCityId ? 0 : 1) -
    distancePenalty -
    strain * 0.12 -
    regimePenalty
  );
}

function simulateDemographics({ people, world, rng, phase, day, nextPersonId, usedNames, religionProfiles }) {
  const alive = [];
  const births = [];
  const cityBirths = new Map(world.cities.map((city) => [city.id, 0]));
  const cityDeaths = new Map(world.cities.map((city) => [city.id, 0]));
  const cityWarDeaths = new Map(world.cities.map((city) => [city.id, 0]));
  const cityMarriages = new Map(world.cities.map((city) => [city.id, 0]));
  const cityDivorces = new Map(world.cities.map((city) => [city.id, 0]));
  const allCityIds = world.cities.map((city) => city.id);
  const workCityIds = world.cities.filter((city) => city.cityType !== "residential").map((city) => city.id);
  const warExposureByCity = computeWarExposureByCity(world);
  let totalWarDeaths = 0;

  for (const person of people) {
    if (phase === "Night") {
      person.age += 1 / 365;
    }

    const deathCause = getDeathCause(person, world, rng, warExposureByCity);
    if (deathCause) {
      cityDeaths.set(person.currentCityId, (cityDeaths.get(person.currentCityId) ?? 0) + 1);
      if (deathCause === "war") {
        cityWarDeaths.set(person.currentCityId, (cityWarDeaths.get(person.currentCityId) ?? 0) + 1);
        totalWarDeaths += 1;
      }
      continue;
    }
    alive.push(person);
  }

  const byId = new Map(alive.map((person) => [person.id, person]));
  for (const person of alive) {
    if (person.partnerId && !byId.has(person.partnerId)) {
      person.partnerId = null;
      person.partnerSinceDay = null;
      person.cohabiting = false;
    }
  }

  const relationEvents = updatePartnershipDynamics({
    people: alive,
    world,
    rng,
    phase,
    day,
    cityDivorces
  });

  if (phase === "Night") {
    const marriages = formNightPartnerships(alive, world, rng, day);
    for (const marriage of marriages) {
      cityMarriages.set(marriage.cityId, (cityMarriages.get(marriage.cityId) ?? 0) + 1);
    }

    const mothers = alive.filter((person) => person.sex === "F" && person.partnerId);
    for (const mother of mothers) {
      const partner = byId.get(mother.partnerId);
      if (!partner) {
        continue;
      }

      if (!isBirthEvent(mother, partner, world, rng, religionProfiles, day)) {
        continue;
      }

      const baby = createChildFromParents({
        mother,
        father: partner,
        rng,
        world,
        id: nextPersonId,
        usedNames,
        workCityIds,
        allCityIds
      });
      nextPersonId += 1;
      births.push(baby);
      mother.childrenIds.push(baby.id);
      partner.childrenIds.push(baby.id);
      cityBirths.set(mother.homeCityId, (cityBirths.get(mother.homeCityId) ?? 0) + 1);
    }
  }

  const cityStats = world.cities.map((city) => {
    const b = cityBirths.get(city.id) ?? 0;
    const d = cityDeaths.get(city.id) ?? 0;
    const m = cityMarriages.get(city.id) ?? 0;
    const dv = cityDivorces.get(city.id) ?? 0;
    return {
      cityId: city.id,
      births: b,
      deaths: d,
      warDeaths: cityWarDeaths.get(city.id) ?? 0,
      marriages: m,
      divorces: dv,
      net: b - d
    };
  });

  let currentCouples = 0;
  let currentCohabitingCouples = 0;
  for (const person of alive) {
    if (!person.partnerId || person.id > person.partnerId) {
      continue;
    }
    currentCouples += 1;
    if (person.cohabiting) {
      currentCohabitingCouples += 1;
    }
  }

  return {
    people: alive.concat(births),
    nextPersonId,
    summary: {
      totalBirths: births.length,
      totalDeaths: people.length - alive.length,
      totalWarDeaths,
      totalMarriages: cityStats.reduce((sum, row) => sum + row.marriages, 0),
      totalDivorces: cityStats.reduce((sum, row) => sum + row.divorces, 0),
      totalCohabStarts: relationEvents.cohabStarts,
      totalCohabEnds: relationEvents.cohabEnds,
      currentCouples,
      currentCohabitingCouples,
      cityStats
    }
  };
}

function getDeathCause(person, world, rng, warExposureByCity = null) {
  const city = world.getCityById(person.currentCityId);
  const safety = city?.metrics?.safety ?? 0.5;
  const health = person.ability.health;

  const ageFactor =
    person.age < 50
      ? 0.00002
      : person.age < 70
      ? 0.00008 + (person.age - 49) * 0.00002
      : 0.00055 + (person.age - 69) * 0.00006;

  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const climate = world.systemState?.climateStress ?? 0;
  const naturalRisk = ageFactor * (1.2 - safety * 0.4) * (1.25 - health * 0.5) * (1 + epidemic * 0.8 + climate * 0.3);
  if (rng.next() < naturalRisk) {
    return "natural";
  }
  const warExposure = warExposureByCity?.get(person.currentCityId) ?? 0;
  if (warExposure <= 0) {
    return null;
  }
  const ageWarMult =
    person.age < 14 ? 0.38
    : person.age < 56 ? 1
    : 0.72;
  const warRisk = clamp((0.00008 + warExposure * 0.0024) * ageWarMult * (1.08 - safety * 0.35) * (1.06 - health * 0.25), 0, 0.04);
  return rng.next() < warRisk ? "war" : null;
}

function computeWarExposureByCity(world) {
  const out = new Map((world.cities ?? []).map((city) => [city.id, 0]));
  const diplomacy = world.systemState?.geopolitics?.diplomacy ?? {};
  const pairWarSet = new Set();
  for (const [key, rel] of Object.entries(diplomacy)) {
    if (rel?.status !== "war") {
      continue;
    }
    const [aId, bId] = key.split("|");
    if (!aId || !bId) {
      continue;
    }
    pairWarSet.add(`${aId}|${bId}`);
    const tension = clamp(rel.tension ?? 0.8, 0, 1);
    const pressure = 0.22 + tension * 0.28;
    const na = world.getNationById(aId);
    const nb = world.getNationById(bId);
    for (const cityId of na?.cityIds ?? []) {
      out.set(cityId, (out.get(cityId) ?? 0) + pressure);
    }
    for (const cityId of nb?.cityIds ?? []) {
      out.set(cityId, (out.get(cityId) ?? 0) + pressure);
    }
  }
  for (const edge of world.edges ?? []) {
    const a = world.getCityById(edge.fromCityId);
    const b = world.getCityById(edge.toCityId);
    if (!a || !b || !a.nationId || !b.nationId || a.nationId === b.nationId) {
      continue;
    }
    const fwd = `${a.nationId}|${b.nationId}`;
    const rev = `${b.nationId}|${a.nationId}`;
    if (!pairWarSet.has(fwd) && !pairWarSet.has(rev)) {
      continue;
    }
    const edgeEscalation = 0.35 + (edge.gatewayRestriction === "sealed" ? 0.12 : 0);
    out.set(a.id, (out.get(a.id) ?? 0) + edgeEscalation);
    out.set(b.id, (out.get(b.id) ?? 0) + edgeEscalation);
  }
  for (const [cityId, score] of out.entries()) {
    out.set(cityId, clamp(score, 0, 1.6));
  }
  return out;
}

function isBirthEvent(mother, father, world, rng, religionProfiles, day) {
  if (mother.age < 20 || mother.age > 42) {
    return false;
  }
  if (father.age < 20 || father.age > 60) {
    return false;
  }

  const city = world.getCityById(mother.homeCityId);
  const safety = city?.metrics?.safety ?? 0.5;
  const stability = city ? 1 - city.metrics.inequality * 0.6 : 0.6;
  const family = (mother.traits.familyOriented + father.traits.familyOriented) * 0.5;
  const wealth = (mother.socioeconomic.wealth + father.socioeconomic.wealth) * 0.5;
  const childLimit = 1 + Math.floor(family * 3);
  const existingChildren = Math.max(mother.childrenIds.length, father.childrenIds.length);
  if (existingChildren >= childLimit) {
    return false;
  }

  const faith = (religionProfiles[mother.religion] ?? religionProfiles.Free).modifiers;
  const prob = 0.0012 * (0.5 + family * 0.45 + wealth * 0.3 + safety * 0.2 + stability * 0.2);
  const cohabFactor = mother.cohabiting ? 1.35 : 0.35;
  const relationDuration = mother.partnerSinceDay == null ? 0 : Math.max(0, day - mother.partnerSinceDay);
  const durationFactor = relationDuration >= 4 ? 1 : 0.45 + relationDuration * 0.12;
  const qualityFactor = 0.7 + (mother.relationshipQuality + father.relationshipQuality) * 0.2;
  const faithAdjusted = prob * (1 + faith.familyPriority * 0.4) * cohabFactor * durationFactor * qualityFactor;
  return rng.next() < faithAdjusted;
}

function getReligionProfile(religion) {
  return RELIGION_PROFILES[religion] ?? RELIGION_PROFILES.Free;
}

function updatePartnershipDynamics({ people, world, rng, phase, day, cityDivorces }) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const seen = new Set();
  let cohabStarts = 0;
  let cohabEnds = 0;

  for (const person of people) {
    if (!person.partnerId) {
      continue;
    }
    const partner = byId.get(person.partnerId);
    if (!partner) {
      person.partnerId = null;
      person.partnerSinceDay = null;
      person.cohabiting = false;
      continue;
    }

    const pairKey = person.id < partner.id ? `${person.id}-${partner.id}` : `${partner.id}-${person.id}`;
    if (seen.has(pairKey)) {
      continue;
    }
    seen.add(pairKey);

    const sameCity = person.currentCityId === partner.currentCityId;
    const harmony = partnerCompatibility(person, partner);
    const wealthGap = Math.abs(person.socioeconomic.wealth - partner.socioeconomic.wealth);
    const noveltyPressure = (person.traits.noveltySeeking + partner.traits.noveltySeeking) * 0.5;
    const religionFriction =
      person.religion === partner.religion
        ? 0
        : (1 - (person.traits.openness + partner.traits.openness) * 0.5) * 0.03;
    const city = world.getCityById(person.homeCityId);
    const cityStress = city ? city.metrics.inequality * 0.04 + city.metrics.congestion * 0.03 : 0.03;

    let delta =
      (harmony - 0.6) * 0.08 -
      wealthGap * 0.035 -
      noveltyPressure * 0.018 -
      religionFriction -
      cityStress +
      rng.range(-0.012, 0.012);

    if (phase === "Night" && person.currentState === "Leisure" && partner.currentState === "Leisure" && sameCity) {
      delta += 0.02;
    }
    if (!sameCity) {
      delta -= 0.01;
    }

    person.relationshipQuality = clamp01(person.relationshipQuality + delta);
    partner.relationshipQuality = clamp01(partner.relationshipQuality + delta);

    const targetStability =
      0.42 +
      ((person.relationshipQuality + partner.relationshipQuality) * 0.5) * 0.45 +
      (person.cohabiting ? 0.08 : 0) -
      wealthGap * 0.08;
    person.householdStability = clamp01(person.householdStability * 0.8 + targetStability * 0.2);
    partner.householdStability = clamp01(partner.householdStability * 0.8 + targetStability * 0.2);

    const relationshipDays = person.partnerSinceDay == null ? 0 : Math.max(0, day - person.partnerSinceDay);
    if (!person.cohabiting && person.relationshipQuality > 0.62 && relationshipDays >= 2) {
      const familyDrive = (person.traits.familyOriented + partner.traits.familyOriented) * 0.5;
      if (rng.next() < 0.12 + familyDrive * 0.24) {
        person.cohabiting = true;
        partner.cohabiting = true;
        cohabStarts += 1;
      }
    } else if (person.cohabiting && person.relationshipQuality < 0.44) {
      const breakProb = 0.03 + noveltyPressure * 0.08;
      if (rng.next() < breakProb) {
        person.cohabiting = false;
        partner.cohabiting = false;
        cohabEnds += 1;
      }
    }

    let divorceRisk = 0;
    if (person.relationshipQuality < 0.32) {
      divorceRisk =
        0.02 +
        (0.32 - person.relationshipQuality) * 0.22 +
        noveltyPressure * 0.06 +
        (person.cohabiting ? 0 : 0.025);
    }
    if (relationshipDays < 4) {
      divorceRisk *= 0.5;
    }
    if (rng.next() < divorceRisk) {
      person.partnerId = null;
      partner.partnerId = null;
      person.partnerSinceDay = null;
      partner.partnerSinceDay = null;
      person.lastBreakupDay = day;
      partner.lastBreakupDay = day;
      if (person.cohabiting || partner.cohabiting) {
        cohabEnds += 1;
      }
      person.cohabiting = false;
      partner.cohabiting = false;

      const divorceCity = person.homeCityId;
      cityDivorces.set(divorceCity, (cityDivorces.get(divorceCity) ?? 0) + 1);
    }
  }

  return { cohabStarts, cohabEnds };
}

function formNightPartnerships(people, world, rng, day) {
  const singlesByCity = new Map(world.cities.map((city) => [city.id, []]));
  for (const person of people) {
    if (person.partnerId) {
      continue;
    }
    if (person.age < 18 || person.age > 58) {
      continue;
    }
    if (person.lastBreakupDay != null && day - person.lastBreakupDay < 2) {
      continue;
    }
    if (person.currentState !== "Leisure") {
      continue;
    }
    singlesByCity.get(person.currentCityId)?.push(person);
  }

  const marriages = [];
  for (const city of world.cities) {
    const singles = singlesByCity.get(city.id) ?? [];
    if (singles.length < 2) {
      continue;
    }

    shuffleInPlace(singles, rng);
    for (let i = 0; i < singles.length; i += 1) {
      const a = singles[i];
      if (a.partnerId) {
        continue;
      }

      let best = null;
      let bestScore = -1;
      for (let j = i + 1; j < singles.length; j += 1) {
        const b = singles[j];
        if (b.partnerId || a.sex === b.sex) {
          continue;
        }
        const score = partnerCompatibility(a, b, day);
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      }

      if (!best || bestScore < 0.5) {
        continue;
      }
      if (rng.next() > Math.min(0.97, bestScore + 0.08)) {
        continue;
      }

      a.partnerId = best.id;
      best.partnerId = a.id;
      a.partnerSinceDay = day;
      best.partnerSinceDay = day;
      a.relationshipQuality = clamp01(0.52 + bestScore * 0.45);
      best.relationshipQuality = a.relationshipQuality;
      a.householdStability = clamp01(0.45 + a.relationshipQuality * 0.4);
      best.householdStability = a.householdStability;
      const familyDrive = (a.traits.familyOriented + best.traits.familyOriented) * 0.5;
      const startCohab = bestScore > 0.74 && rng.next() < 0.14 + familyDrive * 0.26;
      a.cohabiting = startCohab;
      best.cohabiting = startCohab;
      marriages.push({ cityId: city.id, personAId: a.id, personBId: best.id });
    }
  }

  return marriages;
}

function partnerCompatibility(a, b, day = 0) {
  const religionAffinity = a.religion === b.religion ? 0.25 : (a.traits.openness + b.traits.openness) * 0.08;
  const familyAffinity = 1 - Math.abs(a.traits.familyOriented - b.traits.familyOriented);
  const socialAffinity = 1 - Math.abs(a.traits.sociability - b.traits.sociability);
  const disciplineAffinity = 1 - Math.abs(a.traits.discipline - b.traits.discipline);
  const wealthStability = 1 - Math.abs(a.socioeconomic.wealth - b.socioeconomic.wealth) * 0.6;
  const ageGap = Math.abs(a.age - b.age);
  const ageAffinity = 1 - sigmoid((ageGap - 8) * 0.35);
  const breakupGuardA = a.lastBreakupDay == null ? 1 : sigmoid((day - a.lastBreakupDay - 2) * 0.8);
  const breakupGuardB = b.lastBreakupDay == null ? 1 : sigmoid((day - b.lastBreakupDay - 2) * 0.8);
  const historyQuality =
    ((a.relationshipQuality ?? 0.5) + (b.relationshipQuality ?? 0.5)) * 0.5 * 0.08 +
    ((a.householdStability ?? 0.5) + (b.householdStability ?? 0.5)) * 0.5 * 0.06;
  return clamp01(
    (0.1 + religionAffinity + familyAffinity * 0.22 + socialAffinity * 0.18 + disciplineAffinity * 0.16 + wealthStability * 0.1 + ageAffinity * 0.18 + historyQuality) *
      breakupGuardA *
      breakupGuardB
  );
}

function createChildFromParents({ mother, father, rng, world, id, usedNames, workCityIds, allCityIds }) {
  const homeCityId = mother.homeCityId;
  const city = world.getCityById(homeCityId);
  const environment = computeCityEnvironmentModifier(city);
  const religion = rng.next() < 0.8 ? mother.religion : father.religion;
  const childGenetics = recombineGenetics(mother.genetics, father.genetics, rng, {
    crossoverRate: 0.26,
    personalityMutation: 0.12,
    abilityMutation: 0.05,
    dominanceMutation: 0.03
  });
  const childEpigenetics = inheritEpigenetics(mother, father, environment, rng);
  const childPhenotype = derivePhenotypeFromGenetics(childGenetics, childEpigenetics, environment);
  ensureSocioeconomicBreakdown(mother);
  ensureSocioeconomicBreakdown(father);
  const inheritance = transferParentalInheritance({ mother, father, rng });
  const inheritedPotential = childPhenotype.ability.cognitive * 0.06 + childPhenotype.traits.discipline * 0.04;
  const childSocioeconomic = {
    cash: inheritance.cash,
    realEstate: inheritance.realEstate,
    stocks: inheritance.stocks,
    bankDeposit: inheritance.bankDeposit,
    debt: inheritance.debt,
    wealth: clamp01(inheritance.wealth + inheritedPotential + rng.range(0, 0.06)),
    skill: clamp01((mother.socioeconomic.skill + father.socioeconomic.skill) * 0.25 + rng.range(0, 0.08)),
    education: clamp01((mother.socioeconomic.education + father.socioeconomic.education) * 0.35 + rng.range(0, 0.1))
  };

  const child = createPerson({
    id,
    rng,
    homeCityId,
    workCityId: pickOne(workCityIds.length > 0 ? workCityIds : allCityIds, rng),
    religion,
    usedNames,
    age: 0,
    sex: rng.next() < 0.5 ? "F" : "M",
    traits: childPhenotype.traits,
    ability: childPhenotype.ability,
    genetics: childGenetics,
    epigenetics: childEpigenetics,
    socioeconomic: childSocioeconomic,
    parents: [mother.id, father.id],
    generation: Math.max(mother.generation, father.generation) + 1,
    lineageRootId: mother.lineageRootId ?? mother.id
  });
  child.currentState = "Home";
  child.currentCityId = homeCityId;
  child.energy = 1;
  child.fatigue = 0;
  child.socioeconomic.wealth = computeSocioeconomicWealth(child.socioeconomic);
  return child;
}

function transferParentalInheritance({ mother, father, rng }) {
  const m = mother.socioeconomic;
  const f = father.socioeconomic;
  const fromCash = (m.cash + f.cash) * rng.range(0.04, 0.12);
  const fromRealEstate = (m.realEstate + f.realEstate) * rng.range(0.03, 0.1);
  const fromStocks = (m.stocks + f.stocks) * rng.range(0.04, 0.14);
  const fromDeposit = (m.bankDeposit + f.bankDeposit) * rng.range(0.03, 0.11);
  const inheritedDebt = (m.debt + f.debt) * rng.range(0.0, 0.06);

  m.cash = clamp01(m.cash - fromCash * 0.5);
  f.cash = clamp01(f.cash - fromCash * 0.5);
  m.realEstate = clamp01(m.realEstate - fromRealEstate * 0.5);
  f.realEstate = clamp01(f.realEstate - fromRealEstate * 0.5);
  m.stocks = clamp01(m.stocks - fromStocks * 0.5);
  f.stocks = clamp01(f.stocks - fromStocks * 0.5);
  m.bankDeposit = clamp01(m.bankDeposit - fromDeposit * 0.5);
  f.bankDeposit = clamp01(f.bankDeposit - fromDeposit * 0.5);
  m.debt = clamp01(m.debt * (1 - rng.range(0.01, 0.05)));
  f.debt = clamp01(f.debt * (1 - rng.range(0.01, 0.05)));
  m.wealth = computeSocioeconomicWealth(m);
  f.wealth = computeSocioeconomicWealth(f);

  const out = {
    cash: clamp01(fromCash + rng.range(0, 0.03)),
    realEstate: clamp01(fromRealEstate + rng.range(0, 0.02)),
    stocks: clamp01(fromStocks + rng.range(0, 0.03)),
    bankDeposit: clamp01(fromDeposit + rng.range(0, 0.03)),
    debt: clamp01(inheritedDebt)
  };
  out.wealth = computeSocioeconomicWealth(out);
  return out;
}

function inheritEpigenetics(mother, father, environment, rng) {
  const out = createEmptyEpigenetics();
  for (const key of PERSONALITY_KEYS) {
    const m = mother.epigenetics?.personality?.[key] ?? 0;
    const f = father.epigenetics?.personality?.[key] ?? 0;
    out.personality[key] = clamp((m + f) * 0.28 + environment.personalityShift * 0.32 + rng.range(-0.02, 0.02), -0.25, 0.25);
  }
  for (const key of ABILITY_KEYS) {
    const m = mother.epigenetics?.ability?.[key] ?? 0;
    const f = father.epigenetics?.ability?.[key] ?? 0;
    out.ability[key] = clamp((m + f) * 0.3 + environment.abilityShift * 0.35 + rng.range(-0.015, 0.015), -0.2, 0.2);
  }
  return out;
}

function computeCityEnvironmentModifier(city) {
  if (!city) {
    return { personalityShift: 0, abilityShift: 0 };
  }
  const safety = city.metrics.safety;
  const inequality = city.metrics.inequality;
  const productivity = city.metrics.productivity;
  return {
    personalityShift: (safety - 0.5) * 0.06 - (inequality - 0.4) * 0.04,
    abilityShift: (productivity - 0.6) * 0.07 - (inequality - 0.4) * 0.03
  };
}

function computeLineageSnapshot(people) {
  if (people.length === 0) {
    return {
      summary: "-",
      treeLines: [],
      graph: { nodes: [], parentEdges: [], partnerEdges: [] },
      rankings: null,
      allPeople: []
    };
  }

  const byRoot = new Map();
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const person of people) {
    const root = person.lineageRootId ?? person.id;
    if (!byRoot.has(root)) {
      byRoot.set(root, { rootId: root, members: 0, maxGeneration: 0, totalWealth: 0, powerScore: 0 });
    }
    const row = byRoot.get(root);
    row.members += 1;
    row.maxGeneration = Math.max(row.maxGeneration, person.generation ?? 0);
    row.totalWealth += Math.max(0, person.socioeconomic?.wealth ?? 0);
    row.powerScore += computeLineageMemberPower(person);
  }

  const allLineages = Array.from(byRoot.values());
  const topByMembers = allLineages.slice().sort((a, b) => b.members - a.members).slice(0, 3);
  const topByWealth = allLineages.slice().sort((a, b) => b.totalWealth - a.totalWealth).slice(0, 3);
  const topByPower = allLineages.slice().sort((a, b) => b.powerScore - a.powerScore).slice(0, 3);
  const sizeSummary = topByMembers
    .map((t) => `${byId.get(t.rootId)?.name ?? `Root${t.rootId}`}:${t.members}人(G${t.maxGeneration})`)
    .join(" | ");
  const wealthSummary = topByWealth
    .map((t) => `${byId.get(t.rootId)?.name ?? `Root${t.rootId}`}:${Number(t.totalWealth.toFixed(2))}`)
    .join(" | ");
  const powerSummary = topByPower
    .map((t) => `${byId.get(t.rootId)?.name ?? `Root${t.rootId}`}:${Number(t.powerScore.toFixed(2))}`)
    .join(" | ");
  const topSummary = `規模:${sizeSummary} | 資産:${wealthSummary} | 権力:${powerSummary}`;

  const spotlight = topByMembers[0];
  const treeLines = spotlight ? buildTreeLines(spotlight.rootId, byId) : [];
  const graph = spotlight ? buildLineageGraphData(spotlight.rootId, byId) : { nodes: [], parentEdges: [], partnerEdges: [] };
  const rankingLines = [
    `規模トップ: ${sizeSummary || "-"}`,
    `資産トップ: ${wealthSummary || "-"}`,
    `権力トップ: ${powerSummary || "-"}`
  ];
  const enrichedTree = rankingLines.concat(treeLines.length > 0 ? ["", ...treeLines] : []);
  const allPeople = people.map((p) => ({
    id: p.id,
    name: p.name,
    religion: p.religion,
    generation: p.generation ?? 0,
    parents: p.parents ?? [],
    childrenIds: p.childrenIds ?? [],
    partnerId: p.partnerId ?? null
  }));
  return {
    summary: topSummary,
    treeLines: enrichedTree,
    graph,
    rankings: {
      byMembers: topByMembers.map((r) => ({
        rootId: r.rootId,
        rootName: byId.get(r.rootId)?.name ?? `Root${r.rootId}`,
        members: r.members,
        maxGeneration: r.maxGeneration
      })),
      byWealth: topByWealth.map((r) => ({
        rootId: r.rootId,
        rootName: byId.get(r.rootId)?.name ?? `Root${r.rootId}`,
        totalWealth: Number(r.totalWealth.toFixed(3)),
        members: r.members
      })),
      byPower: topByPower.map((r) => ({
        rootId: r.rootId,
        rootName: byId.get(r.rootId)?.name ?? `Root${r.rootId}`,
        powerScore: Number(r.powerScore.toFixed(3)),
        members: r.members
      }))
    },
    allPeople
  };
}

function computeLineageMemberPower(person) {
  const wealth = clamp01(person.socioeconomic?.wealth ?? 0) * 0.52;
  const civicRole = person.publicService?.branch ? 0.1 : 0;
  const civicResponsibility = clamp01(person.publicService?.responsibility ?? 0) * 0.2;
  const socialStrengthRaw = person.social?.ties
    ? Object.values(person.social.ties).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0)
    : 0;
  const socialStrength = clamp01(socialStrengthRaw / 3.2) * 0.16;
  const strategicAbility =
    clamp01((person.ability?.cognitive ?? 0.5) * 0.55 + (person.ability?.charisma ?? 0.5) * 0.45) * 0.1;
  const economicPosition = person.employerId ? 0.02 : 0;
  return wealth + civicRole + civicResponsibility + socialStrength + strategicAbility + economicPosition;
}

function buildTreeLines(rootId, byId) {
  const root = byId.get(rootId);
  if (!root) {
    return [];
  }

  const lines = [`${root.name}`];
  const children = root.childrenIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 6);
  for (const child of children) {
    lines.push(`- ${child.name}`);
    const grand = child.childrenIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
    for (const g of grand) {
      lines.push(`  - ${g.name}`);
    }
  }
  return lines;
}

function buildLineageGraphData(rootId, byId) {
  const root = byId.get(rootId);
  if (!root) {
    return { nodes: [], parentEdges: [], partnerEdges: [] };
  }

  const queue = [{ id: root.id, depth: 0 }];
  const seen = new Set();
  const nodes = [];
  const parentEdges = [];
  const partnerEdges = [];
  const maxDepth = 4;
  const maxNodes = 48;

  while (queue.length > 0 && nodes.length < maxNodes) {
    const current = queue.shift();
    if (seen.has(current.id)) {
      continue;
    }
    seen.add(current.id);

    const person = byId.get(current.id);
    if (!person) {
      continue;
    }

    nodes.push({
      id: person.id,
      name: person.name,
      generation: person.generation ?? 0,
      depth: current.depth,
      religion: person.religion,
      age: Math.floor(person.age)
    });

    if (current.depth >= maxDepth) {
      continue;
    }

    for (const childId of person.childrenIds.slice(0, 6)) {
      if (!byId.has(childId)) {
        continue;
      }
      parentEdges.push({ from: person.id, to: childId });
      queue.push({ id: childId, depth: current.depth + 1 });
    }

    if (person.partnerId && byId.has(person.partnerId)) {
      const a = Math.min(person.id, person.partnerId);
      const b = Math.max(person.id, person.partnerId);
      if (!partnerEdges.find((edge) => edge.from === a && edge.to === b)) {
        partnerEdges.push({ from: a, to: b });
      }
    }
  }

  return { nodes, parentEdges, partnerEdges };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.range(0, i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

function computeEconomySummary(people, world) {
  if (people.length === 0) {
    return {
      avgIncome: 0,
      unemploymentRate: 0,
      avgWealth: 0,
      wealthDistribution: { gini: 0, top1SharePct: 0, top10SharePct: 0, top20SharePct: 0, min: 0, max: 0, avg: 0 },
      employmentDiagnostics: null,
      banking: { deposits: 0, debt: 0, net: 0 },
      byCity: []
    };
  }
  for (const person of people) {
    ensureSocioeconomicBreakdown(person);
  }
  const avgIncome = people.reduce((sum, p) => sum + (p.incomeLastTick ?? 0), 0) / people.length;
  const unemploymentRate = people.filter((p) => !p.employed).length / people.length;
  const avgWealth = people.reduce((sum, p) => sum + (p.socioeconomic?.wealth ?? 0), 0) / people.length;
  const wealthRows = people.map((p) => Math.max(0, Number(p.socioeconomic?.wealth ?? 0))).sort((a, b) => a - b);
  const deposits = people.reduce((sum, p) => sum + (p.socioeconomic?.bankDeposit ?? 0), 0);
  const debt = people.reduce((sum, p) => sum + (p.socioeconomic?.debt ?? 0), 0);
  const byCity = world.cities.map((city) => {
    const rows = people.filter((p) => p.currentCityId === city.id);
    if (rows.length === 0) {
      return { cityId: city.id, avgIncome: 0, unemploymentRate: 0, avgWealth: 0, deposits: 0, debt: 0 };
    }
    const cityIncome = rows.reduce((sum, p) => sum + (p.incomeLastTick ?? 0), 0) / rows.length;
    const cityUnemp = rows.filter((p) => !p.employed).length / rows.length;
    const cityWealth = rows.reduce((sum, p) => sum + (p.socioeconomic?.wealth ?? 0), 0) / rows.length;
    const cityDeposits = rows.reduce((sum, p) => sum + (p.socioeconomic?.bankDeposit ?? 0), 0);
    const cityDebt = rows.reduce((sum, p) => sum + (p.socioeconomic?.debt ?? 0), 0);
    return {
      cityId: city.id,
      avgIncome: Number(cityIncome.toFixed(3)),
      unemploymentRate: Number((cityUnemp * 100).toFixed(1)),
      avgWealth: Number(cityWealth.toFixed(3)),
      deposits: Number(cityDeposits.toFixed(3)),
      debt: Number(cityDebt.toFixed(3))
    };
  });
  return {
    avgIncome: Number(avgIncome.toFixed(3)),
    unemploymentRate: Number((unemploymentRate * 100).toFixed(1)),
    avgWealth: Number(avgWealth.toFixed(3)),
    wealthDistribution: {
      gini: Number(giniFromSorted(wealthRows).toFixed(3)),
      top1SharePct: Number((topShareFromSorted(wealthRows, 0.01) * 100).toFixed(2)),
      top10SharePct: Number((topShareFromSorted(wealthRows, 0.1) * 100).toFixed(2)),
      top20SharePct: Number((topShareFromSorted(wealthRows, 0.2) * 100).toFixed(2)),
      min: Number((wealthRows[0] ?? 0).toFixed(3)),
      max: Number((wealthRows[wealthRows.length - 1] ?? 0).toFixed(3)),
      avg: Number(avgWealth.toFixed(3))
    },
    employmentDiagnostics: world.systemState?.lastEmploymentDiagnostics ?? null,
    banking: {
      deposits: Number(deposits.toFixed(3)),
      debt: Number(debt.toFixed(3)),
      net: Number((deposits - debt).toFixed(3))
    },
    byCity
  };
}

function giniFromSorted(values) {
  const n = values.length;
  if (n === 0) {
    return 0;
  }
  const sum = values.reduce((acc, x) => acc + x, 0);
  if (sum <= 0) {
    return 0;
  }
  let cum = 0;
  for (let i = 0; i < n; i += 1) {
    cum += (i + 1) * values[i];
  }
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

function topShareFromSorted(sortedValues, share) {
  const n = sortedValues.length;
  if (n === 0) {
    return 0;
  }
  const total = sortedValues.reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    return 0;
  }
  const k = Math.max(1, Math.floor(n * share));
  const top = sortedValues.slice(n - k).reduce((sum, v) => sum + v, 0);
  return top / total;
}

function computePopulationEvents({
  world,
  demographics,
  economy,
  day,
  companyEvents = [],
  weeklyEvents = [],
  phaseTransitionEvents = []
}) {
  const events = [];
  if (demographics.totalBirths > demographics.totalDeaths + 2) {
    events.push({ type: "boom", text: `Day${day}: 人口増加フェーズ` });
  }
  if (demographics.totalDeaths > demographics.totalBirths + 2) {
    events.push({ type: "decline", text: `Day${day}: 人口減少フェーズ` });
  }
  if (economy.unemploymentRate >= 28) {
    events.push({ type: "job_crisis", text: `Day${day}: 雇用危機(${economy.unemploymentRate}%)` });
  }

  for (const city of world.cities) {
    city.lifecycle = city.lifecycle ?? { riseScore: 0.4, declineScore: 0.3, status: "stable" };
    const pressure = city.metrics.inequality * 0.55 + (1 - city.metrics.safety) * 0.45;
    city.metrics.instabilityRisk = clamp01((city.metrics.instabilityRisk ?? 0.1) * 0.86 + pressure * 0.14);
    const growthSignal = city.metrics.productivity * 0.6 + city.metrics.trust * 0.4 - city.metrics.congestion * 0.25;
    city.lifecycle.riseScore = clamp01((city.lifecycle.riseScore ?? 0.4) * 0.9 + growthSignal * 0.1);
    city.lifecycle.declineScore = clamp01((city.lifecycle.declineScore ?? 0.25) * 0.9 + pressure * 0.1);

    if (city.metrics.instabilityRisk > 0.75) {
      events.push({ type: "riot_risk", text: `${city.name}: 不安定化リスク高` });
    }
    if (city.lifecycle.riseScore > 0.82) {
      city.lifecycle.status = "rising";
      if (city.cityType !== "workHub" && growthSignal > 0.9) {
        city.cityType = "mixed";
        events.push({ type: "urban_rise", text: `${city.name}: 都市化進行` });
      }
    } else if (city.lifecycle.declineScore > 0.78) {
      city.lifecycle.status = "declining";
      if (city.cityType === "workHub" && city.metrics.productivity < 0.65) {
        city.cityType = "mixed";
        events.push({ type: "hub_decline", text: `${city.name}: ハブ機能低下` });
      }
    } else {
      city.lifecycle.status = "stable";
    }
  }

  for (const e of companyEvents) {
    events.push(e);
  }
  for (const e of weeklyEvents) {
    events.push(e);
  }
  for (const e of phaseTransitionEvents) {
    events.push(e);
  }

  return events.slice(0, 10);
}

function computePhaseTransitionSignals({ world, economy, demographics, day, tracker }) {
  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const climate = world.systemState?.climateStress ?? 0;
  const market = world.systemState?.marketIndex ?? 1;
  const avgInstability =
    world.cities.reduce((sum, city) => sum + (city.metrics.instabilityRisk ?? 0), 0) / Math.max(1, world.cities.length);
  const unemployment = (economy?.unemploymentRate ?? 0) / 100;
  const deathPressure = demographics.totalDeaths / Math.max(1, demographics.totalBirths + demographics.totalDeaths);

  const shockScore = epidemic * 0.34 + climate * 0.22 + avgInstability * 0.26 + unemployment * 0.12 + deathPressure * 0.06;
  const recoveryScore = market * 0.22 + (1 - unemployment) * 0.32 + (1 - epidemic) * 0.24 + (1 - avgInstability) * 0.22;

  const macroRegime =
    shockScore > 0.62 ? "shock" : shockScore < 0.42 && recoveryScore > 0.55 ? "recovery" : "stable";
  const socialRegime =
    avgInstability > 0.66 ? "fragmented" : avgInstability < 0.42 && unemployment < 0.18 ? "cohesive" : "tense";

  const events = [];
  if (tracker.macroRegime !== macroRegime) {
    events.push({
      type: "phase_macro",
      text: `Day${day}: マクロ位相 ${tracker.macroRegime}→${macroRegime} (shock:${shockScore.toFixed(2)})`
    });
  }
  if (tracker.socialRegime !== socialRegime) {
    events.push({
      type: "phase_social",
      text: `Day${day}: 社会位相 ${tracker.socialRegime}→${socialRegime} (inst:${avgInstability.toFixed(2)})`
    });
  }

  return {
    events,
    tracker: { macroRegime, socialRegime },
    indicators: {
      shockScore: Number(shockScore.toFixed(3)),
      recoveryScore: Number(recoveryScore.toFixed(3)),
      avgInstability: Number(avgInstability.toFixed(3))
    }
  };
}

function buildStatisticalPopulation(cityPresence, world, previous = {}) {
  const out = {};
  const trackedTotal = Math.max(
    1,
    world.cities.reduce((sum, city) => sum + (cityPresence.get(city.id) ?? 0), 0)
  );
  const populationTotal = Math.max(1, world.cities.reduce((sum, city) => sum + city.population, 0));
  const globalScale = populationTotal / trackedTotal;
  for (const city of world.cities) {
    const tracked = cityPresence.get(city.id) ?? 0;
    const prev = previous[city.id];
    const estimatedRaw = Math.max(tracked, Math.round(tracked * globalScale));
    const estimatedTotal = prev
      ? Math.round(prev.estimatedTotal * 0.74 + estimatedRaw * 0.26)
      : estimatedRaw;
    const scale = Number((estimatedTotal / Math.max(1, tracked)).toFixed(2));
    out[city.id] = {
      tracked,
      estimatedTotal,
      scale
    };
  }
  return out;
}

function applyStatisticalFeedbackToCities(world, statisticalPopulation) {
  for (const city of world.cities) {
    const stat = statisticalPopulation[city.id];
    if (!stat) {
      continue;
    }
    city.population = Math.max(120, Math.round(city.population * 0.9 + stat.estimatedTotal * 0.1));
    const crowd = stat.tracked / Math.max(1, stat.estimatedTotal);
    city.metrics.congestion = clamp01(city.metrics.congestion * 0.9 + crowd * 0.1);
  }
}

function groupCompaniesByCity(companies, world) {
  const byCity = new Map(world.cities.map((city) => [city.id, []]));
  for (const c of companies) {
    const rows = byCity.get(c.cityId) ?? [];
    rows.push(c);
    byCity.set(c.cityId, rows);
  }
  return byCity;
}

function applyCompanyLifecycle({ companies, people, world, config, rng, day, nextCompanyIdRef }) {
  const events = [];
  const removeIds = new Set();
  const byCity = groupCompaniesByCity(companies, world);

  for (const company of companies) {
    company.ageDays = (company.ageDays ?? 0) + 1;
    company.distress = clamp01((company.distress ?? 0.2) * 0.82 + (company.profit < 0 ? 0.22 : -0.14) + (company.capital < 0.18 ? 0.16 : 0));

    if (!company.listed && company.profit > 0.03 && company.capital > 0.62 && company.ageDays > 16 && rng.next() < 0.28) {
      company.listed = true;
      company.pricePower = Math.min(1.7, company.pricePower + 0.08);
      if (!company.name.endsWith(" Holdings")) {
        company.name += " Holdings";
      }
      events.push({ type: "ipo", text: `${company.name} が上場` });
    }

    if (company.distress > 0.82 && company.capital < 0.12 && rng.next() < 0.38) {
      removeIds.add(company.id);
      events.push({ type: "bankruptcy", text: `${company.name} が倒産` });
    }
  }

  for (const city of world.cities) {
    const rows = (byCity.get(city.id) ?? []).filter((c) => !removeIds.has(c.id));
    const healthy = rows
      .filter((c) => c.profit > 0.03 && c.capital > 0.35)
      .sort((a, b) => b.profit - a.profit);
    const weak = rows
      .filter((c) => c.distress > 0.56 || c.profit < -0.03)
      .sort((a, b) => b.distress - a.distress);
    if (healthy.length > 0 && weak.length > 0) {
      const acquirer = healthy[0];
      const target = weak.find((w) => w.id !== acquirer.id);
      if (target && rng.next() < 0.26) {
        acquirer.capacity = clamp01(acquirer.capacity + target.capacity * 0.45);
        acquirer.capital = clamp01(acquirer.capital + target.capital * 0.35);
        acquirer.efficiency = clamp01(acquirer.efficiency * 0.88 + target.efficiency * 0.12);
        acquirer.wageMultiplier = clamp01(acquirer.wageMultiplier * 0.9 + target.wageMultiplier * 0.1);
        removeIds.add(target.id);
        events.push({ type: "ma", text: `${acquirer.name} が ${target.name} を買収` });
      }
    }
  }

  if (removeIds.size > 0) {
    for (const p of people) {
      if (p.employerId && removeIds.has(p.employerId)) {
        p.employerId = null;
        p.employed = false;
      }
    }
    for (let i = companies.length - 1; i >= 0; i -= 1) {
      if (removeIds.has(companies[i].id)) {
        companies.splice(i, 1);
      }
    }
  }

  const refreshedByCity = groupCompaniesByCity(companies, world);
  for (const city of world.cities) {
    const minCount = city.cityType === "workHub" ? 4 : city.cityType === "mixed" ? 3 : 2;
    const current = refreshedByCity.get(city.id) ?? [];
    while (current.length < minCount) {
      const company = createCompany({
        id: nextCompanyIdRef(),
        city,
        world,
        config,
        rng,
        foundingDay: day
      });
      company.capital = clamp01(company.capital * 0.8);
      assignFounderOwnership({ company, people, cityId: city.id, day, rng });
      companies.push(company);
      current.push(company);
      events.push({ type: "startup", text: `${company.name} が創業` });
    }
  }

  return events.slice(0, 8);
}

function pickCompanyType({ city, world, config, rng }) {
  const typeCfg = config?.companyTypes ?? {};
  const base = typeCfg.baseTypeDistribution ?? {};
  const cityDist = base[city.cityType] ?? base.default ?? { General: 0.8, IT: 0.15, Military: 0.05 };
  const tension = estimateGlobalTension(world);
  const education = clamp01((city.metrics?.trust ?? 0.5) * 0.35 + (city.metrics?.productivity ?? 0.5) * 0.4 + (1 - (city.metrics?.instabilityRisk ?? 0.2)) * 0.25);
  let general = Math.max(0.01, Number(cityDist.General ?? 0.8));
  let it = Math.max(0.01, Number(cityDist.IT ?? 0.15));
  let military = Math.max(0.01, Number(cityDist.Military ?? 0.05));
  it *= 1 + education * 0.35 - tension * 0.1;
  military *= 1 + tension * 0.55;
  general *= 1 - tension * 0.12;
  const sum = general + it + military;
  const x = rng.range(0, sum);
  if (x < it) {
    return "IT";
  }
  if (x < it + military) {
    return "Military";
  }
  return "General";
}

function ensureCompanyTypeState(company) {
  company.companyType = company.companyType ?? "General";
  company.rdStock = clamp01(company.rdStock ?? (company.companyType === "IT" ? 0.32 : company.companyType === "Military" ? 0.14 : 0.18));
  company.networkEffect = Math.max(0, Number(company.networkEffect ?? (company.companyType === "IT" ? 0.28 : 0.08)));
  company.compliance = clamp01(company.compliance ?? (company.companyType === "Military" ? 0.72 : 0.58));
  company.lobbyPower = clamp01(company.lobbyPower ?? (company.companyType === "Military" ? 0.42 : 0.16));
  company.defenseContractShare = clamp01(company.defenseContractShare ?? (company.companyType === "Military" ? 0.58 : 0));
  company.concentrationPenalty = clamp(Number(company.concentrationPenalty ?? 1), 0.35, 1);
}

function ensureCompanyPolicyState(world, policyCfg = {}) {
  world.systemState = world.systemState ?? {};
  const state = (world.systemState.companyPolicy = world.systemState.companyPolicy ?? {
    antitrustAutoBoost: 0,
    redistributionPool: 0,
    lastRedistributed: 0,
    lastMaxHHI: 0,
    lastAvgHHI: 0,
    lastPenaltyRatio: 0,
    effectiveAntitrust: clamp(policyCfg?.antitrustStrength ?? 0.22, 0, 1)
  });
  state.antitrustAutoBoost = clamp(Number(state.antitrustAutoBoost ?? 0), 0, 0.6);
  state.redistributionPool = Math.max(0, Number(state.redistributionPool ?? 0));
  state.lastRedistributed = Math.max(0, Number(state.lastRedistributed ?? 0));
  state.lastMaxHHI = Math.max(0, Number(state.lastMaxHHI ?? 0));
  state.lastAvgHHI = Math.max(0, Number(state.lastAvgHHI ?? 0));
  state.lastPenaltyRatio = clamp(Number(state.lastPenaltyRatio ?? 0), 0, 1);
  state.effectiveAntitrust = clamp(Number(state.effectiveAntitrust ?? (policyCfg?.antitrustStrength ?? 0.22)), 0, 1);
  return state;
}

function estimateGlobalTension(world) {
  const geo = world?.systemState?.geopolitics ?? {};
  const rows = Array.isArray(geo.relations)
    ? geo.relations
    : Object.values(geo.diplomacy ?? {});
  if (!rows.length) {
    return 0.25;
  }
  const avg = rows.reduce((sum, row) => sum + (Number(row?.tension) || 0), 0) / rows.length;
  return clamp(avg, 0, 1);
}

function estimateDefenseBudgetFactor(world, city) {
  const nationId = city?.nationId ?? null;
  const geo = world?.systemState?.geopolitics ?? {};
  const nation = (geo.nations ?? []).find((n) => n.id === nationId);
  const stress = Number(nation?.stress ?? 0.2);
  const power = Number(nation?.power ?? 0.3);
  const tension = estimateGlobalTension(world);
  const explicitBudget = Number(nation?.defenseBudget ?? NaN);
  if (Number.isFinite(explicitBudget)) {
    return clamp(explicitBudget, 0, 1.4);
  }
  return clamp(0.18 + tension * 0.55 + stress * 0.3 + power * 0.08, 0.08, 1.4);
}

function computeCompanyTypeRevenueMultiplier({ company, world, city, person, config }) {
  ensureCompanyTypeState(company);
  const typeCfg = config?.companyTypes ?? {};
  const it = typeCfg.it ?? {};
  const military = typeCfg.military ?? {};
  const policyCfg = config?.policy ?? {};
  const nation = (world?.systemState?.geopolitics?.nations ?? []).find((n) => n.id === city?.nationId);
  const tension = estimateGlobalTension(world);
  const sanctions = clamp(
    Math.max(
      Number(world?.systemState?.geopolitics?.sanctionPressure ?? 0),
      Number(nation?.militaryExportControl ?? 0) * 0.8
    ),
    0,
    1
  );
  if (company.companyType === "IT") {
    const talent = clamp((person?.ability?.cognitive ?? 0.5) * 0.55 + (person?.socioeconomic?.education ?? 0.5) * 0.45, 0.3, 1.4);
    const rdFactor = 1 + company.rdStock * Math.max(0, Number(it.rdEfficiency ?? 0.35));
    const netCap = Math.max(0.1, Number(it.networkCap ?? 1.2));
    const networkFactor = 1 + Math.min(netCap, company.networkEffect) * Math.max(0, Number(it.networkStrength ?? 0.32));
    const baseReg = clamp(Number(nation?.itRegulationLevel ?? it.baseRegulation ?? 0.12), 0, 0.9);
    const regPenalty = 1 - baseReg * Math.max(0, Number(it.regulationSensitivity ?? 0.4));
    const conc = clamp(company.concentrationPenalty ?? 1, 0.35, 1);
    return clamp(talent * rdFactor * networkFactor * regPenalty * conc, 0.5, 2.4);
  }
  if (company.companyType === "Military") {
    const defenseBudgetFactor = estimateDefenseBudgetFactor(world, city);
    const tensionFactor = 1 + tension * Math.max(0, Number(military.tensionSensitivity ?? 0.7));
    const warMultiplier = 1 + Math.max(0, Number(military.warBonus ?? 0.45)) * countWarRelationsForNation(world, city?.nationId);
    const sanctionPenalty = 1 - sanctions * Math.max(0, Number(military.sanctionSensitivity ?? 0.35));
    const contract = 0.85 + company.defenseContractShare * 0.4;
    const procurementCap = clamp(Number(policyCfg.defenseProcurementCap ?? 0.68), 0.2, 1);
    const overCap = Math.max(0, company.defenseContractShare - procurementCap);
    const procurementCapPenalty = clamp(1 - overCap * 1.8, 0.45, 1);
    const conc = clamp(company.concentrationPenalty ?? 1, 0.35, 1);
    return clamp(defenseBudgetFactor * tensionFactor * warMultiplier * sanctionPenalty * contract * procurementCapPenalty * conc, 0.45, 2.6);
  }
  return clamp(company.concentrationPenalty ?? 1, 0.35, 1);
}

function countWarRelationsForNation(world, nationId) {
  if (!nationId) {
    return 0;
  }
  const geo = world?.systemState?.geopolitics ?? {};
  const rows = Array.isArray(geo.relations)
    ? geo.relations
    : Object.values(geo.diplomacy ?? {});
  if (!rows.length) {
    return 0;
  }
  const wars = rows.filter((r) => (r?.status ?? "") === "war" && (r?.nationAId === nationId || r?.nationBId === nationId)).length;
  return clamp(wars / 4, 0, 1.5);
}

function computeConcentrationPenaltyByCompany(companies, world, typeCfg, antitrustStrength = 0) {
  const out = new Map();
  if (!Array.isArray(companies) || companies.length === 0) {
    return { byCompany: out, maxHhi: 0, avgHhi: 0, threshold: 0.42, penaltyRatio: 0 };
  }
  const threshold = clamp(Number(typeCfg?.safety?.concentrationThreshold ?? 0.42), 0.1, 0.95);
  const antitrust = clamp(Number(antitrustStrength ?? 0), 0, 1);
  const penaltyScale = clamp(Number(typeCfg?.safety?.concentrationPenaltyScale ?? 0.7) * (1 + antitrust * 1.6), 0, 4.5);
  const groups = new Map();
  for (const c of companies) {
    ensureCompanyTypeState(c);
    const key = `${c.cityId}|${c.companyType}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  let hhiSum = 0;
  let groupCount = 0;
  let maxHhi = 0;
  let penalizedCompanies = 0;
  for (const arr of groups.values()) {
    const total = Math.max(0.0001, arr.reduce((sum, c) => sum + Math.max(0.0001, Number(c.capital ?? 0.1)), 0));
    let hhi = 0;
    for (const c of arr) {
      const share = Math.max(0, Number(c.capital ?? 0)) / total;
      hhi += share * share;
    }
    hhiSum += hhi;
    groupCount += 1;
    maxHhi = Math.max(maxHhi, hhi);
    const over = Math.max(0, hhi - threshold);
    const penalty = clamp(1 - over * penaltyScale, 0.35, 1);
    for (const c of arr) {
      out.set(c.id, penalty);
      if (penalty < 0.999) {
        penalizedCompanies += 1;
      }
    }
  }
  for (const c of companies) {
    if (!out.has(c.id)) {
      out.set(c.id, 1);
    }
  }
  return {
    byCompany: out,
    maxHhi: Number(maxHhi.toFixed(6)),
    avgHhi: Number((hhiSum / Math.max(1, groupCount)).toFixed(6)),
    threshold,
    penaltyRatio: Number((penalizedCompanies / Math.max(1, companies.length)).toFixed(6))
  };
}

function createCompany({ id, city, world, config, rng, foundingDay = 0 }) {
  const sectors = city.cityType === "workHub"
    ? ["Industry", "Finance", "Logistics", "Tech"]
    : city.cityType === "mixed"
    ? ["Retail", "Services", "Craft", "Tech"]
    : ["LocalService", "Agri", "Retail"];
  const sector = pickOne(sectors, rng);
  const companyType = pickCompanyType({ city, world, config, rng });
  const rdSeed = companyType === "IT" ? rng.range(0.22, 0.64) : companyType === "Military" ? rng.range(0.06, 0.22) : rng.range(0.08, 0.3);
  const networkSeed = companyType === "IT" ? rng.range(0.16, 0.62) : rng.range(0.02, 0.2);
  const complianceSeed = companyType === "Military" ? rng.range(0.45, 0.9) : rng.range(0.35, 0.85);
  const lobbySeed = companyType === "Military" ? rng.range(0.25, 0.7) : rng.range(0.04, 0.38);
  const defenseContractSeed = companyType === "Military" ? rng.range(0.35, 0.9) : rng.range(0, 0.08);
  return {
    id,
    name: `${city.name} ${sector} ${id}`,
    cityId: city.id,
    sector,
    companyType,
    capacity: rng.range(0.45, 0.95),
    efficiency: rng.range(0.5, 1.2),
    wageMultiplier: rng.range(0.85, 1.25),
    pricePower: rng.range(0.9, 1.35),
    capital: rng.range(0.35, 0.9),
    listed: false,
    suppliers: [],
    distress: rng.range(0.12, 0.35),
    ageDays: 0,
    foundingDay,
    stockPrice: rng.range(0.85, 1.25),
    sharesOutstanding: 1000,
    capTable: { market: 1000 },
    founderPersonId: null,
    founderAssignedDay: -1,
    dividendPaidLastTick: 0,
    profitPrev: 0,
    valuation: rng.range(0.6, 1.4),
    growthExpectation: rng.range(0.35, 0.62),
    hyperGrowthBoost: 1,
    hyperGrowthEvent: false,
    lastHyperGrowthDay: -1,
    rdStock: rdSeed,
    networkEffect: networkSeed,
    compliance: complianceSeed,
    lobbyPower: lobbySeed,
    defenseContractShare: defenseContractSeed,
    concentrationPenalty: 1,
    employeeCount: 0,
    revenueTick: 0,
    costTick: 0,
    revenue: 0,
    cost: 0,
    profit: 0,
    marketShare: 0,
    equityHolders: [],
    openPositions: 0,
    openPositionsPosted: 0,
    rlPolicy: {
      qByAction: {},
      nByAction: {},
      lastAction: "balanced"
    },
    rdBias: 1
  };
}

function assignFounderOwnership({ company, people, cityId, day, rng }) {
  if (!company || !Array.isArray(people) || people.length === 0) {
    return;
  }
  ensureCapTable(company);
  const candidates = people.filter(
    (p) =>
      Number(p.age ?? 0) >= 18 &&
      (p.homeCityId === cityId || p.workCityId === cityId || p.currentCityId === cityId)
  );
  if (!candidates.length) {
    return;
  }
  const ranked = candidates
    .map((p) => {
      const entrepreneurship =
        clamp01(
          (p.ability?.cognitive ?? 0.5) * 0.34 +
            (p.ability?.productivity ?? 0.5) * 0.22 +
            (p.traits?.riskTolerance ?? 0.5) * 0.2 +
            (p.traits?.discipline ?? 0.5) * 0.16 +
            (p.traits?.openness ?? 0.5) * 0.08
        ) + rng.range(-0.03, 0.03);
      return { person: p, score: entrepreneurship };
    })
    .sort((a, b) => b.score - a.score);
  const founder = ranked[0]?.person;
  if (!founder) {
    return;
  }
  const marketShares = Math.max(0, Number(company.capTable.market ?? company.sharesOutstanding));
  if (marketShares <= 0) {
    return;
  }
  const founderShares = Math.min(marketShares, Math.floor(rng.range(120, 280)));
  if (founderShares <= 0) {
    return;
  }
  company.capTable.market = Number((marketShares - founderShares).toFixed(6));
  const key = String(founder.id);
  company.capTable[key] = Number(((company.capTable[key] ?? 0) + founderShares).toFixed(6));
  company.founderPersonId = founder.id;
  company.founderAssignedDay = Number.isFinite(day) ? day : -1;
  normalizeCapTable(company);
}

function distributeCompanyDividends({ people, companies, config, world, phase }) {
  if (!Array.isArray(people) || !Array.isArray(companies) || !people.length || !companies.length) {
    return;
  }
  const payoutRatio = clamp(config?.company?.dividendPayoutRatio ?? 0.12, 0, 0.8);
  const payoutScale = clamp(config?.company?.dividendScale ?? 0.08, 0, 1);
  const dividendTaxRate = clamp(config?.policy?.dividendTaxRate ?? 0.08, 0, 0.7);
  const policyState = ensureCompanyPolicyState(world, config?.policy ?? {});
  const byId = new Map(people.map((p) => [Number(p.id), p]));
  let taxedTotal = 0;
  for (const company of companies) {
    ensureCapTable(company);
    const positiveProfit = Math.max(0, Number(company.profit ?? 0));
    if (positiveProfit <= 0) {
      company.dividendPaidLastTick = 0;
      continue;
    }
    const payoutPool = positiveProfit * payoutRatio * payoutScale;
    if (payoutPool <= 0) {
      company.dividendPaidLastTick = 0;
      continue;
    }
    const out = Math.max(1, Number(company.sharesOutstanding ?? 1000));
    let distributed = 0;
    for (const [holder, shares] of Object.entries(company.capTable)) {
      if (holder === "market") {
        continue;
      }
      const pid = Number.parseInt(holder, 10);
      if (!Number.isFinite(pid)) {
        continue;
      }
      const person = byId.get(pid);
      if (!person) {
        continue;
      }
      ensureSocioeconomicBreakdown(person);
      const ownership = Math.max(0, Number(shares ?? 0)) / out;
      if (ownership <= 0) {
        continue;
      }
      const grossDividend = payoutPool * ownership;
      const tax = grossDividend * dividendTaxRate;
      const netDividend = grossDividend - tax;
      const bankPart = netDividend * 0.82;
      const cashPart = netDividend - bankPart;
      person.socioeconomic.bankDeposit = clamp01((person.socioeconomic.bankDeposit ?? 0) + bankPart);
      person.socioeconomic.cash = clamp01((person.socioeconomic.cash ?? 0) + cashPart);
      person.socioeconomic.wealth = computeSocioeconomicWealth(person.socioeconomic);
      distributed += netDividend;
      taxedTotal += tax;
    }
    company.dividendPaidLastTick = Number(distributed.toFixed(6));
    company.capital = clamp01((company.capital ?? 0) - distributed * 0.6);
  }
  if (taxedTotal > 0) {
    policyState.redistributionPool = Number(((policyState.redistributionPool ?? 0) + taxedTotal).toFixed(6));
  }
  if (phase === "Night") {
    applyDividendRedistribution({ people, policyState });
  }
}

function applyDividendRedistribution({ people, policyState }) {
  const pool = Number(policyState?.redistributionPool ?? 0);
  if (!Number.isFinite(pool) || pool <= 0) {
    return;
  }
  const recipients = people
    .filter((p) => Number(p.age ?? 0) >= 18)
    .map((p) => {
      ensureSocioeconomicBreakdown(p);
      return { person: p, wealth: Number(p.socioeconomic?.wealth ?? 0) };
    })
    .sort((a, b) => a.wealth - b.wealth)
    .slice(0, Math.max(8, Math.floor(people.length * 0.4)));
  if (!recipients.length) {
    return;
  }
  const unit = pool / recipients.length;
  for (const row of recipients) {
    const person = row.person;
    const bankPart = unit * 0.8;
    const cashPart = unit - bankPart;
    person.socioeconomic.bankDeposit = clamp01((person.socioeconomic.bankDeposit ?? 0) + bankPart);
    person.socioeconomic.cash = clamp01((person.socioeconomic.cash ?? 0) + cashPart);
    person.socioeconomic.wealth = computeSocioeconomicWealth(person.socioeconomic);
  }
  policyState.lastRedistributed = Number(pool.toFixed(6));
  policyState.redistributionPool = 0;
}

function simulateCompanyInvestments({ people, companies, world, rng, phase }) {
  if (phase !== "Daytime") {
    return;
  }
  const listed = companies.filter((c) => c.listed);
  const universe =
    listed.length > 0
      ? listed
      : companies
          .slice()
          .sort((a, b) => (b.capital ?? 0) + (b.profit ?? 0) - ((a.capital ?? 0) + (a.profit ?? 0)))
          .slice(0, Math.max(24, Math.floor(companies.length * 0.25)));
  if (!universe.length) {
    return;
  }
  const byId = new Map(universe.map((c) => [c.id, c]));
  for (const c of universe) {
    ensureCapTable(c);
  }

  for (const person of people) {
    ensureSocioeconomicBreakdown(person);
    const s = person.socioeconomic;
    const investability = clamp01(
      (person.ability?.cognitive ?? 0.5) * 0.35 +
      (s.education ?? 0.5) * 0.25 +
      (person.traits?.riskTolerance ?? 0.5) * 0.22 +
      (person.traits?.discipline ?? 0.5) * 0.18
    );
    if (rng.next() > 0.08 + investability * 0.18) {
      continue;
    }
    const liquidity = Math.max(0, (s.bankDeposit ?? 0) * 0.75 + (s.cash ?? 0) * 0.35 - (s.debt ?? 0) * 0.12);
    const budget = Math.max(0, liquidity * (0.01 + investability * 0.03));
    if (budget < 0.0001) {
      continue;
    }

    const city = world.getCityById(person.currentCityId);
    const nationId = city?.nationId ?? null;
    const scored = universe
      .map((c) => {
        const cityMatch = c.cityId === person.currentCityId ? 0.12 : 0;
        const nationMatch = nationId && world.getCityById(c.cityId)?.nationId === nationId ? 0.06 : 0;
        const momentum = clamp((c.profit ?? 0) * 1.8 + (c.capital ?? 0) * 0.45 + ((c.stockPrice ?? 1) - 1) * 0.25, -0.25, 0.4);
        const distressPenalty = (c.distress ?? 0) * 0.16;
        const unlistedPenalty = c.listed ? 0 : 0.08;
        const score = 0.5 + cityMatch + nationMatch + momentum - distressPenalty - unlistedPenalty + rng.range(-0.05, 0.05);
        return { companyId: c.id, score };
      })
      .sort((a, b) => b.score - a.score);
    const target = byId.get(scored[0]?.companyId);
    if (!target) {
      continue;
    }

    const price = Math.max(0.2, target.stockPrice ?? 1);
    const sharesToBuy = Math.max(0, Math.floor((budget / price) * 1000) / 1000);
    if (sharesToBuy <= 0) {
      continue;
    }
    const issuerKey = "market";
    const issuerShares = target.capTable[issuerKey] ?? target.sharesOutstanding;
    const bought = Math.min(issuerShares, sharesToBuy);
    if (bought <= 0) {
      continue;
    }
    target.capTable[issuerKey] = Number((issuerShares - bought).toFixed(6));
    const holderKey = String(person.id);
    target.capTable[holderKey] = Number(((target.capTable[holderKey] ?? 0) + bought).toFixed(6));

    const spend = bought * price;
    const depositDraw = Math.min(s.bankDeposit ?? 0, spend * 0.75);
    s.bankDeposit = clamp01((s.bankDeposit ?? 0) - depositDraw);
    s.cash = clamp01((s.cash ?? 0) - Math.max(0, spend - depositDraw));
    target.capital = clamp01((target.capital ?? 0) + spend * 0.04);
  }

  for (const c of universe) {
    normalizeCapTable(c);
  }
}

function ensureInvestmentInstitutions(world, companies = [], rng = null) {
  world.systemState = world.systemState ?? {};
  const state = (world.systemState.investmentInstitutions = world.systemState.investmentInstitutions ?? {
    sovereignFunds: {},
    institutionalFunds: {},
    lastUpdatedDay: -1
  });
  for (const nation of world.nations ?? []) {
    const key = `N:${nation.id}`;
    if (!state.sovereignFunds[key]) {
      state.sovereignFunds[key] = {
        id: key,
        nationId: nation.id,
        name: `${nation.name} Sovereign Fund`,
        cash: 0.65,
        riskAppetite: rng ? rng.range(0.35, 0.75) : 0.55
      };
    }
  }
  const byNation = new Map();
  for (const city of world.cities ?? []) {
    if (!byNation.has(city.nationId)) {
      byNation.set(city.nationId, []);
    }
    byNation.get(city.nationId).push(city.id);
  }
  for (const [nationId] of byNation.entries()) {
    const bankId = `B:BANK:${nationId}`;
    if (!state.institutionalFunds[bankId]) {
      const nationName = world.getNationById(nationId)?.name ?? nationId;
      state.institutionalFunds[bankId] = {
        id: bankId,
        type: "bank",
        nationId,
        name: `${nationName} National Bank`,
        cash: 0.58,
        riskAppetite: rng ? rng.range(0.3, 0.62) : 0.46
      };
    }
  }
  const fundCount = Math.max(2, Math.min(5, Math.floor((companies.length || 12) / 20)));
  for (let i = 1; i <= fundCount; i += 1) {
    const fundId = `B:FUND:${i}`;
    if (!state.institutionalFunds[fundId]) {
      state.institutionalFunds[fundId] = {
        id: fundId,
        type: "institutional_fund",
        nationId: null,
        name: `Global Institutional Fund ${i}`,
        cash: rng ? rng.range(0.45, 0.78) : 0.62,
        riskAppetite: rng ? rng.range(0.42, 0.86) : 0.65
      };
    }
  }
  return state;
}

function ensureInvestmentRlState(world, holderKey) {
  world.systemState = world.systemState ?? {};
  const irl = (world.systemState.investmentRl = world.systemState.investmentRl ?? {
    entityPolicies: {},
    marketStressEma: 0.3,
    prevMarketStressEma: 0.3,
    regime: "normal",
    lastSimulationDay: -1,
    lastUpdateDay: -1
  });
  const row = (irl.entityPolicies[holderKey] = irl.entityPolicies[holderKey] ?? {
    qByAction: {},
    nByAction: {},
    qByStateAction: {},
    nByStateAction: {},
    pendingByStateAction: {},
    lastAction: "balanced",
    lastStateKey: "global"
  });
  row.qByAction = row.qByAction ?? {};
  row.nByAction = row.nByAction ?? {};
  row.qByStateAction = row.qByStateAction ?? {};
  row.nByStateAction = row.nByStateAction ?? {};
  row.pendingByStateAction = row.pendingByStateAction ?? {};
  for (const action of INVESTMENT_RL_ACTIONS) {
    if (!Number.isFinite(row.qByAction[action])) {
      row.qByAction[action] = 0.5;
    }
    if (!Number.isFinite(row.nByAction[action])) {
      row.nByAction[action] = 0;
    }
  }
  row.lastAction = row.lastAction ?? "balanced";
  return row;
}

function detectInvestmentRegime(world, config) {
  const irl = world.systemState?.investmentRl;
  if (!irl) {
    return { regime: "normal", alphaScale: 1 };
  }
  const prices = world.systemState?.resources?.prices ?? {};
  const resourceInflation =
    ((prices.water ?? 1) + (prices.food ?? 1) + (prices.energy_fossil ?? 1) + (prices.energy_renewable ?? 1)) / 4 - 1;
  const currency = world.systemState?.currencies ?? {};
  const inflationValues = Object.values(currency.inflation ?? {});
  const avgInflation = inflationValues.length
    ? inflationValues.reduce((sum, v) => sum + (Number(v) || 0), 0) / inflationValues.length
    : 0.012;
  const marketIndex = world.systemState?.marketIndex ?? 1;
  const climate = world.systemState?.climateStress ?? 0;
  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const stressRaw = clamp(
    (1 - clamp(marketIndex, 0.4, 1.8) / 1.2) * 0.42 +
      Math.max(0, avgInflation - 0.02) * 5.2 * 0.24 +
      Math.max(0, resourceInflation) * 0.22 +
      climate * 0.06 +
      epidemic * 0.06,
    0,
    1.4
  );
  const prev = irl.marketStressEma ?? stressRaw;
  const next = prev * 0.82 + stressRaw * 0.18;
  irl.prevMarketStressEma = prev;
  irl.marketStressEma = next;
  const delta = Math.abs(next - prev);
  const threshold = clamp(config?.rl?.resourceRegimeShiftThreshold ?? 0.14, 0.04, 0.4);
  const regime = next > 0.62 ? "crisis" : next > 0.38 ? "volatile" : marketIndex > 1.08 ? "growth" : "normal";
  irl.regime = regime;
  return { regime, alphaScale: delta > threshold ? 1.7 : 1, marketStress: next };
}

function investmentStateKey(entity, regime) {
  const riskBand = band3(entity?.riskAppetite ?? 0.5, 0.35, 0.65);
  return `${entity?.holderType ?? "fund"}|${regime}|r${riskBand}`;
}

function flushInvestmentPolicyPending(policy, alpha) {
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
    updatePolicyQ(policy, stateKey || "global", action, reward, alpha);
    pending[key] = { sum: 0, count: 0 };
  }
}

function transferSharesFromMarket({ target, holderKey, shares, price }) {
  ensureCapTable(target);
  const marketShares = target.capTable.market ?? target.sharesOutstanding;
  const bought = Math.min(Math.max(0, shares), marketShares);
  if (bought <= 0) {
    return { bought: 0, spend: 0 };
  }
  target.capTable.market = Number((marketShares - bought).toFixed(6));
  target.capTable[holderKey] = Number(((target.capTable[holderKey] ?? 0) + bought).toFixed(6));
  const spend = bought * Math.max(0.2, price ?? target.stockPrice ?? 1);
  target.capital = clamp01((target.capital ?? 0) + spend * 0.03);
  return { bought, spend };
}

function simulateCorporateCrossHoldings({ companies, world, rng, phase }) {
  if (phase !== "Daytime" || companies.length <= 1) {
    return;
  }
  const listed = companies.filter((c) => c.listed);
  const universe = listed.length > 0 ? listed : companies;
  for (const c of universe) {
    ensureCapTable(c);
  }
  const byId = new Map(universe.map((c) => [c.id, c]));
  for (const buyer of universe) {
    if ((buyer.capital ?? 0) < 0.25) {
      continue;
    }
    const activityChance = 0.06 + clamp01((buyer.capital ?? 0) * 0.22 + Math.max(0, buyer.profit ?? 0) * 0.1);
    if (rng.next() > activityChance) {
      continue;
    }
    const city = world.getCityById(buyer.cityId);
    const nationId = city?.nationId ?? null;
    const candidates = universe
      .filter((c) => c.id !== buyer.id)
      .map((target) => {
        const targetCity = world.getCityById(target.cityId);
        const sameNation = nationId && targetCity?.nationId === nationId ? 0.1 : 0;
        const supplierEdge = (buyer.suppliers ?? []).includes(target.id) ? 0.12 : 0;
        const score =
          0.45 +
          sameNation +
          supplierEdge +
          clamp((target.marketShare ?? 0) * 0.0035 + (target.capital ?? 0) * 0.14 + (target.profit ?? 0) * 0.12, -0.2, 0.35) +
          rng.range(-0.05, 0.05);
        return { id: target.id, score };
      })
      .sort((a, b) => b.score - a.score);
    const target = byId.get(candidates[0]?.id);
    if (!target) {
      continue;
    }
    const price = Math.max(0.2, target.stockPrice ?? 1);
    const liquidity = Math.max(0, (buyer.capital ?? 0) * 0.7 + Math.max(0, buyer.profit ?? 0) * 0.5);
    const budget = liquidity * (0.01 + rng.range(0.005, 0.025));
    const shares = Math.floor((budget / price) * 1000) / 1000;
    if (shares <= 0) {
      continue;
    }
    const holderKey = `C:${buyer.id}`;
    const { spend } = transferSharesFromMarket({ target, holderKey, shares, price });
    if (spend <= 0) {
      continue;
    }
    buyer.capital = clamp01((buyer.capital ?? 0) - spend * 0.07);
  }
}

function simulateInstitutionalInvestments({ companies, world, rng, phase, day, config = {} }) {
  if (phase !== "Daytime" || companies.length === 0) {
    return;
  }
  world.systemState = world.systemState ?? {};
  const irl = (world.systemState.investmentRl = world.systemState.investmentRl ?? {
    entityPolicies: {},
    marketStressEma: 0.3,
    prevMarketStressEma: 0.3,
    regime: "normal",
    lastSimulationDay: -1,
    lastUpdateDay: -1
  });
  const state = ensureInvestmentInstitutions(world, companies, rng);
  if (Number.isFinite(day) && irl.lastSimulationDay === day) {
    return;
  }
  if (Number.isFinite(day)) {
    irl.lastSimulationDay = day;
  }
  const listed = companies.filter((c) => c.listed);
  const universe = listed.length > 0 ? listed : companies;
  if (!universe.length) {
    return;
  }
  for (const c of universe) {
    ensureCapTable(c);
  }
  const byId = new Map(universe.map((c) => [c.id, c]));
  const regime = detectInvestmentRegime(world, config);
  const entities = [
    ...Object.values(state.sovereignFunds ?? {}).map((x) => ({ ...x, holderKey: x.id, holderType: "sovereign_fund" })),
    ...Object.values(state.institutionalFunds ?? {}).map((x) => ({ ...x, holderKey: x.id, holderType: x.type === "bank" ? "bank" : "institutional_fund" }))
  ];
  for (const entity of entities) {
    const policy = ensureInvestmentRlState(world, entity.holderKey);
    const stateKey = investmentStateKey(entity, regime.regime);
    const action = chooseRlAction(
      policy,
      INVESTMENT_RL_ACTIONS,
      clamp(config?.rl?.investmentEpsilon ?? config?.rl?.epsilon ?? 0.14, 0.01, 0.5),
      rng,
      stateKey
    );
    policy.lastAction = action;
    policy.lastStateKey = stateKey;
    const baseChance = entity.holderType === "sovereign_fund" ? 0.2 : entity.holderType === "bank" ? 0.16 : 0.24;
    if (rng.next() > baseChance + (entity.riskAppetite ?? 0.5) * 0.1) {
      continue;
    }
    const scored = universe
      .map((target) => {
        const city = world.getCityById(target.cityId);
        const sameNation = entity.nationId && city?.nationId === entity.nationId ? 0.14 : 0;
        const stability = clamp01((target.capital ?? 0) * 0.55 + Math.max(0, target.profit ?? 0) * 0.45);
        const distressPenalty = (target.distress ?? 0) * 0.2;
        const momentum = clamp(((target.stockPrice ?? 1) - 1) * 0.12 + Math.max(0, target.profit ?? 0) * 0.18, -0.2, 0.4);
        const strategyBias =
          action === "aggressive" ? momentum * 0.7 + stability * 0.2
          : action === "conservative" ? stability * 0.45 - distressPenalty * 0.4
          : stability * 0.3 + momentum * 0.2;
        const score = 0.4 + sameNation + strategyBias - distressPenalty + rng.range(-0.04, 0.04);
        return { companyId: target.id, score };
      })
      .sort((a, b) => b.score - a.score);
    const target = byId.get(scored[0]?.companyId);
    if (!target) {
      continue;
    }
    const price = Math.max(0.2, target.stockPrice ?? 1);
    const cash = Math.max(0, entity.cash ?? 0);
    const budgetBase = entity.holderType === "bank" ? 0.01 : entity.holderType === "sovereign_fund" ? 0.015 : 0.02;
    const actionMult = action === "aggressive" ? 1.55 : action === "conservative" ? 0.7 : 1;
    const budgetRatio = budgetBase * actionMult;
    const budget = cash * (budgetRatio + (entity.riskAppetite ?? 0.5) * 0.01);
    const shares = Math.floor((budget / price) * 1000) / 1000;
    if (shares <= 0) {
      continue;
    }
    const { spend } = transferSharesFromMarket({ target, holderKey: entity.holderKey, shares, price });
    if (spend <= 0) {
      continue;
    }
    const reward = clamp(
      Math.max(0, target.profit ?? 0) * 0.8 + ((target.stockPrice ?? 1) - 1) * 0.25 - (target.distress ?? 0) * (action === "aggressive" ? 0.2 : 0.35),
      -1,
      2
    );
    const pendingKey = stateActionKey(stateKey, action);
    const pending = (policy.pendingByStateAction[pendingKey] = policy.pendingByStateAction[pendingKey] ?? { sum: 0, count: 0 });
    pending.sum += reward;
    pending.count += 1;
    entity.cash = clamp01(cash - spend);
    const replenishment = entity.holderType === "bank" ? 0.0012 : entity.holderType === "sovereign_fund" ? 0.0015 : 0.001;
    entity.cash = clamp01(entity.cash + replenishment + Math.max(0, target.profit ?? 0) * 0.0002);
  }
  const interval = Math.max(1, Math.floor(config?.rl?.investmentUpdateIntervalDays ?? 7));
  const shouldUpdate = !Number.isFinite(day) || (irl.lastUpdateDay ?? -1) < 0 || day - (irl.lastUpdateDay ?? -1) >= interval;
  if (shouldUpdate) {
    const alphaBase = clamp(config?.rl?.investmentAlpha ?? config?.rl?.alpha ?? 0.12, 0.01, 0.5);
    const alpha = clamp(alphaBase * (regime.alphaScale ?? 1), 0.01, 0.65);
    for (const entity of entities) {
      const policy = ensureInvestmentRlState(world, entity.holderKey);
      flushInvestmentPolicyPending(policy, alpha);
    }
    if (Number.isFinite(day)) {
      irl.lastUpdateDay = day;
    }
  }
  state.sovereignFunds = Object.fromEntries(
    Object.entries(state.sovereignFunds ?? {}).map(([k, v]) => [k, { ...v, cash: clamp01(v.cash ?? 0) }])
  );
  state.institutionalFunds = Object.fromEntries(
    Object.entries(state.institutionalFunds ?? {}).map(([k, v]) => [k, { ...v, cash: clamp01(v.cash ?? 0) }])
  );
}

function ensureCapTable(company) {
  company.sharesOutstanding = Number.isFinite(company.sharesOutstanding) ? company.sharesOutstanding : 1000;
  company.capTable = company.capTable ?? { market: company.sharesOutstanding };
  if (!Number.isFinite(company.capTable.market)) {
    company.capTable.market = company.sharesOutstanding;
  }
  company.valuation = Number.isFinite(company.valuation) ? company.valuation : clamp(Number(company.capital ?? 0) * 1.7, 0.05, 24);
  company.growthExpectation = clamp01(company.growthExpectation ?? 0.5);
  company.hyperGrowthBoost = Math.max(1, Number(company.hyperGrowthBoost ?? 1));
  company.equityHolders = Array.isArray(company.equityHolders) ? company.equityHolders : [];
}

function normalizeCapTable(company) {
  ensureCapTable(company);
  const entries = Object.entries(company.capTable)
    .map(([k, v]) => [k, Math.max(0, Number(v) || 0)])
    .filter(([, v]) => v > 0);
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  if (sum <= 0) {
    company.capTable = { market: company.sharesOutstanding };
    refreshCompanyEquityHolders(company);
    return;
  }
  const scale = company.sharesOutstanding / sum;
  company.capTable = Object.fromEntries(entries.map(([k, v]) => [k, Number((v * scale).toFixed(6))]));
  refreshCompanyEquityHolders(company);
}

function refreshCompanyEquityHolders(company) {
  ensureCapTable(company);
  const out = Math.max(1, Number(company.sharesOutstanding ?? 1000));
  company.equityHolders = Object.entries(company.capTable)
    .filter(([holder, shares]) => holder !== "market" && Number(shares) > 0)
    .map(([holder, shares]) => {
      const shareNum = Number(shares) || 0;
      return {
        holderKey: String(holder),
        shares: Number(shareNum.toFixed(6)),
        ownershipPct: Number(((shareNum / out) * 100).toFixed(3))
      };
    })
    .sort((a, b) => b.shares - a.shares)
    .slice(0, 20);
}

function syncPersonStockAssetsFromHoldings(people, companies, config) {
  const valueByPerson = new Map();
  const maxValuation = Math.max(
    0.0001,
    ...companies.map((company) => Math.max(0, Number(company.valuation ?? company.capital ?? 0.1)))
  );
  const equityScale = Math.max(0.0001, Number(config?.company?.valuation?.max ?? 6) * 0.85 + maxValuation * 0.15);
  for (const company of companies) {
    ensureCapTable(company);
    refreshCompanyEquityHolders(company);
    const out = Math.max(1, company.sharesOutstanding);
    for (const [holder, shares] of Object.entries(company.capTable)) {
      if (holder === "market") {
        continue;
      }
      const pid = Number.parseInt(holder, 10);
      if (!Number.isFinite(pid)) {
        continue;
      }
      const ownership = shares / out;
      const contribution = ownership * Math.max(0, Number(company.valuation ?? 0));
      valueByPerson.set(pid, (valueByPerson.get(pid) ?? 0) + contribution);
    }
  }
  for (const person of people) {
    ensureSocioeconomicBreakdown(person);
    const s = person.socioeconomic;
    const equityRaw = Math.max(0, valueByPerson.get(person.id) ?? 0);
    const derived = clamp01(equityRaw / equityScale);
    s.stockAsset = Number(derived.toFixed(4));
    s.equityWealth = derived;
    s.stocks = clamp01((s.stocks ?? 0) * 0.68 + derived * 0.32);
    s.wealth = computeSocioeconomicWealth(s);
  }
}

function wireSupplyChains(companies, world, rng) {
  const byCity = groupCompaniesByCity(companies, world);
  const bySector = new Map();
  for (const company of companies) {
    if (!bySector.has(company.sector)) {
      bySector.set(company.sector, []);
    }
    bySector.get(company.sector).push(company);
  }
  for (const company of companies) {
    const local = (byCity.get(company.cityId) ?? []).filter((c) => c.id !== company.id);
    const peers = (bySector.get(company.sector) ?? []).filter((c) => c.id !== company.id);
    const pick = [];
    if (local.length > 0) {
      pick.push(local[Math.floor(rng.range(0, local.length))].id);
    }
    if (peers.length > 0 && rng.next() < 0.7) {
      pick.push(peers[Math.floor(rng.range(0, peers.length))].id);
    }
    if (rng.next() < 0.35) {
      const otherCityCompanies = companies.filter((c) => c.cityId !== company.cityId && c.id !== company.id);
      if (otherCityCompanies.length > 0) {
        pick.push(otherCityCompanies[Math.floor(rng.range(0, otherCityCompanies.length))].id);
      }
    }
    company.suppliers = Array.from(new Set(pick)).slice(0, 3);
  }
}

function buildSupplyBoostMap(companies, companyById, effect = 0.12) {
  const map = new Map();
  for (const company of companies) {
    const suppliers = company.suppliers ?? [];
    if (suppliers.length === 0) {
      map.set(company.id, 1);
      continue;
    }
    let sum = 0;
    let cnt = 0;
    for (const sid of suppliers) {
      const s = companyById.get(sid);
      if (!s) {
        continue;
      }
      sum += clamp01(s.capital * 0.6 + s.efficiency * 0.4);
      cnt += 1;
    }
    const avg = cnt > 0 ? sum / cnt : 1;
    map.set(company.id, 1 - effect + avg * (effect * 2));
  }
  return map;
}

function pickEmployer(person, cityCompanies, rng, world) {
  if (!cityCompanies || cityCompanies.length === 0) {
    return null;
  }
  let best = cityCompanies[0];
  let bestScore = -Infinity;
  const epidemic = world.systemState?.epidemicLevel ?? 0;
  const climate = world.systemState?.climateStress ?? 0;
  const shockPenalty = 1 - (epidemic * 0.08 + climate * 0.05);
  for (const company of cityCompanies) {
    ensureCompanyTypeState(company);
    const tenure = person.employmentHistory?.tenureByEmployer?.[company.id] ?? 0;
    const loyalty = Math.min(0.08, tenure * 0.004);
    const historyPenalty = person.employerId && person.employerId !== company.id ? 0.02 : 0;
    const typeFit =
      company.companyType === "IT"
        ? (person.ability?.cognitive ?? 0.5) * 0.4 + (person.socioeconomic?.education ?? 0.5) * 0.35 + (person.traits?.discipline ?? 0.5) * 0.15 + (person.traits?.openness ?? 0.5) * 0.1
        : company.companyType === "Military"
          ? (person.traits?.discipline ?? 0.5) * 0.35 + (person.ability?.stressResilience ?? 0.5) * 0.3 + (person.ability?.health ?? 0.5) * 0.2 + (person.traits?.conformity ?? 0.5) * 0.15
          : (person.ability?.productivity ?? 0.5) * 0.5 + (person.socioeconomic?.skill ?? 0.5) * 0.5;
    const score =
      company.efficiency * 0.4 +
      company.wageMultiplier * 0.35 +
      company.capital * 0.15 +
      typeFit * 0.1 +
      loyalty -
      historyPenalty +
      rng.range(0, 0.1);
    const adjusted = score * shockPenalty;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      best = company;
    }
  }
  return best;
}

function computeCompanyOpenPositions({ cityCompanies, city, cityBaseCapacity, workerCount, epidemic, climate, policySupport = 0 }) {
  const byCompany = new Map();
  if (!cityCompanies || cityCompanies.length === 0) {
    return { totalOpenings: cityBaseCapacity, byCompany };
  }
  const shockPenalty = clamp(1 - (epidemic * 0.34 + climate * 0.22), 0.55, 1.08);
  let totalRaw = 0;
  for (const company of cityCompanies) {
    ensureCompanyTypeState(company);
    const hiringMomentum = clamp((company.capital ?? 0) * 0.45 + Math.max(0, company.profit ?? 0) * 0.2 + (1 - (company.distress ?? 0)) * 0.35, 0.05, 1.6);
    const laborBias = company.rlPolicy?.lastAction === "labor_focus" ? 1.2 : company.rlPolicy?.lastAction === "margin_focus" ? 0.88 : 1;
    const typeLaborBias =
      company.companyType === "IT" ? 1.08
      : company.companyType === "Military" ? 0.94
      : 1;
    const base = Math.max(0.15, (company.capacity ?? 0.5) * hiringMomentum * laborBias * typeLaborBias * shockPenalty);
    byCompany.set(company.id, base);
    totalRaw += base;
  }
  const support = clamp(policySupport, 0, 0.32);
  const workerBound = Math.max(0, Math.floor((workerCount ?? 0) * (1.08 + support * 1.4)));
  const target = Math.max(0, Math.min(Math.floor(cityBaseCapacity * shockPenalty), workerBound));
  let totalOpenings = 0;
  for (const company of cityCompanies) {
    const raw = byCompany.get(company.id) ?? 0;
    const share = raw / Math.max(0.001, totalRaw);
    const openings = Math.max(0, Math.floor(target * share));
    byCompany.set(company.id, openings);
    totalOpenings += openings;
  }
  if (totalOpenings <= 0 && cityCompanies[0] && workerBound > 0) {
    byCompany.set(cityCompanies[0].id, 1);
    totalOpenings = 1;
  }
  const effectiveEmploymentCapacity = clamp((city.metrics?.employmentCapacity ?? 0.6) + support * 0.55, 0.08, 1.2);
  const cityEmploymentCap = Math.max(1, Math.floor((city.population ?? 1000) * effectiveEmploymentCapacity * 0.1));
  totalOpenings = Math.min(totalOpenings, cityEmploymentCap);
  return { totalOpenings, byCompany };
}

function computeCompanySummary(companies, world) {
  const rows = companies
    .map((c) => ({
      id: c.id,
      name: c.name,
      cityId: c.cityId,
      sector: c.sector,
      companyType: c.companyType ?? "General",
      listed: !!c.listed,
      employees: c.employeeCount,
      openingsPosted: c.openPositionsPosted ?? 0,
      openings: c.openPositions ?? 0,
      revenue: Number(c.revenue.toFixed(3)),
      profit: Number(c.profit.toFixed(3)),
      stock: Number((c.stockPrice ?? 1).toFixed(3)),
      marketShare: c.marketShare
    }))
    .sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);

  const byCity = world.cities.map((city) => {
    const cityRows = rows.filter((r) => r.cityId === city.id);
    const rev = cityRows.reduce((sum, r) => sum + r.revenue, 0);
    const profit = cityRows.reduce((sum, r) => sum + r.profit, 0);
    return {
      cityId: city.id,
      companies: cityRows.length,
      revenue: Number(rev.toFixed(3)),
      profit: Number(profit.toFixed(3))
    };
  });
  const byType = ["General", "IT", "Military"].map((companyType) => {
    const typeRows = rows.filter((r) => r.companyType === companyType);
    const typeProfit = typeRows.reduce((sum, r) => sum + r.profit, 0);
    return {
      companyType,
      count: typeRows.length,
      profit: Number(typeProfit.toFixed(3))
    };
  });
  const totalProfit = Math.max(0.0001, byType.reduce((sum, row) => sum + Math.max(0, row.profit), 0));
  const byTypeWithShare = byType.map((row) => ({
    ...row,
    profitShare: Number(((Math.max(0, row.profit) / totalProfit) * 100).toFixed(2))
  }));
  const concentration = summarizeCompanyConcentration(companies);
  const policyState = world?.systemState?.companyPolicy ?? {};

  return {
    totalCompanies: companies.length,
    byType: byTypeWithShare,
    concentration,
    policy: {
      effectiveAntitrust: Number((policyState.effectiveAntitrust ?? 0).toFixed(3)),
      antitrustAutoBoost: Number((policyState.antitrustAutoBoost ?? 0).toFixed(3)),
      redistributionPool: Number((policyState.redistributionPool ?? 0).toFixed(4)),
      redistributedLastTick: Number((policyState.lastRedistributed ?? 0).toFixed(4))
    },
    topCompanies: rows.slice(0, 8),
    byCity
  };
}

function summarizeCompanyConcentration(companies) {
  if (!Array.isArray(companies) || companies.length === 0) {
    return { avgHHI: 0, maxHHI: 0, penalizedCompanies: 0, penalizedRatio: 0 };
  }
  const groups = new Map();
  let penalized = 0;
  for (const c of companies) {
    ensureCompanyTypeState(c);
    const key = `${c.cityId}|${c.companyType}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
    if ((c.concentrationPenalty ?? 1) < 0.999) {
      penalized += 1;
    }
  }
  let sum = 0;
  let max = 0;
  let n = 0;
  for (const arr of groups.values()) {
    const total = Math.max(0.0001, arr.reduce((acc, c) => acc + Math.max(0.0001, Number(c.capital ?? 0.1)), 0));
    let hhi = 0;
    for (const c of arr) {
      const share = Math.max(0, Number(c.capital ?? 0)) / total;
      hhi += share * share;
    }
    sum += hhi;
    max = Math.max(max, hhi);
    n += 1;
  }
  return {
    avgHHI: Number((sum / Math.max(1, n)).toFixed(4)),
    maxHHI: Number(max.toFixed(4)),
    penalizedCompanies: penalized,
    penalizedRatio: Number((penalized / Math.max(1, companies.length)).toFixed(4))
  };
}

function getCityRegimeEffects(city, config) {
  const normal = config?.strain?.regimeEffects?.normal ?? { migrationMult: 1, hiringRecoveryMult: 1 };
  const regime = city?.regime ?? "normal";
  const fx = config?.strain?.regimeEffects?.[regime] ?? normal;
  return {
    migrationMult: clamp(fx?.migrationMult ?? normal.migrationMult ?? 1, 0.5, 2.2),
    hiringRecoveryMult: clamp(fx?.hiringRecoveryMult ?? normal.hiringRecoveryMult ?? 1, 0.5, 1.4)
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
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

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
