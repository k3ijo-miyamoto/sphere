import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { createSampleWorld } from "../src/world/model.js";
import { SimulationEngine } from "../src/sim/engine.js";

const EVAL_PROFILES = {
  "stability-first": {
    citySafety: 1.5,
    cityTrust: 1.3,
    cityInstability: 1.8,
    unemploymentGlobal: 0.18,
    unemploymentTargetCity: 0.27,
    income: 0.55
  },
  "employment-first": {
    citySafety: 0.8,
    cityTrust: 0.7,
    cityInstability: 1.0,
    unemploymentGlobal: 0.55,
    unemploymentTargetCity: 0.85,
    income: 1.1
  }
};

const args = parseArgs(process.argv.slice(2));
const days = args.days ?? 45;
const seed = args.seed ?? DEFAULT_CONFIG.seed;
const defaultOutRelPath = path.join("reports", "generative_principles", "generative_principles_report.json");
const outPath = path.resolve(process.cwd(), args.out ?? defaultOutRelPath);
const targetCityId = args.city ?? "C1";
const trackedIndividuals = args.tracked ?? null;
const evalProfile = resolveEvalProfile(args.evalProfile);

const report = run({ days, seed, targetCityId, trackedIndividuals, evalProfile });
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(`Wrote ${outPath}`);
console.log(formatSummary(report));

function run({ days, seed, targetCityId, trackedIndividuals, evalProfile }) {
  const baselineA = runScenario({
    name: "A_baseline",
    days,
    seed,
    targetCityId,
    trackedIndividuals,
    setup: ({ config }) => {
      config.strain.shockWindowReliefSuppressionEnabled = false;
      config.policy.targetEmploymentCityId = null;
      config.policy.targetEmploymentBoost = 0;
      config.policy.targetEmploymentBoostTicks = 0;
      config.policy.targetEmploymentBoostRegimeOnly = true;
    }
  });
  const interventionA = runScenario({
    name: "A_intervention",
    days,
    seed,
    targetCityId,
    trackedIndividuals,
    setup: ({ config, world }) => {
      config.strain.shockWindowReliefSuppressionEnabled = false;
      config.policy.safetyBudget = 0.84;
      config.policy.welfareBudget = 0.82;
      config.policy.educationBudget = 0.86;
      config.policy.targetEmploymentCityId = targetCityId;
      config.policy.targetEmploymentBoost = 0.06;
      config.policy.targetEmploymentBoostTicks = 40 * 48;
      config.policy.targetEmploymentBoostRegimeOnly = true;
      config.institutions.publicStaffRate = 0.23;
      const city = world.getCityById(targetCityId);
      if (city) {
        city.policyGenome = {
          safetyFocus: 0.92,
          welfareFocus: 0.86,
          educationFocus: 0.88,
          greenAffinity: 0.61,
          growthAffinity: 0.57,
          explorationBias: 0.46,
          mutationRate: 0.22,
          fitnessEma: 0.5
        };
      }
    }
  });
  const testA = evaluateTestA({ baseline: baselineA, intervention: interventionA, evalProfile });

  const baselineB = runScenario({
    name: "B_baseline",
    days,
    seed,
    targetCityId,
    trackedIndividuals,
    setup: ({ config }) => {
      config.strain.shockWindowReliefSuppressionEnabled = true;
    }
  });
  const shockB = runScenario({
    name: "B_shock",
    days,
    seed,
    targetCityId,
    trackedIndividuals,
    setup: ({ config, world }) => {
      config.strain.shockWindowReliefSuppressionEnabled = true;
      world.systemState.epidemicLevel = 0.72;
      world.systemState.climateStress = 0.62;
      world.systemState.marketIndex = 0.74;
    },
    tickHook: ({ world, tick }) => {
      if (tick < 120) {
        world.systemState.epidemicLevel = Math.max(world.systemState.epidemicLevel ?? 0, 0.68);
        world.systemState.climateStress = Math.max(world.systemState.climateStress ?? 0, 0.58);
        world.systemState.marketIndex = Math.min(world.systemState.marketIndex ?? 1, 0.78);
      }
    }
  });
  const testB = evaluateTestB({ baseline: baselineB, intervention: shockB });

  const baselineC = runScenario({
    name: "C_baseline",
    days,
    seed,
    targetCityId,
    trackedIndividuals,
    setup: ({ config }) => {
      config.strain.shockWindowReliefSuppressionEnabled = false;
    }
  });
  const traitBiasC = runScenario({
    name: "C_trait_bias",
    days,
    seed,
    targetCityId,
    trackedIndividuals,
    setup: ({ config, engine }) => {
      config.strain.shockWindowReliefSuppressionEnabled = false;
      for (const p of engine.population.people) {
        p.traits.openness = 0.16;
        p.traits.familyOriented = 0.9;
        p.traits.conformity = 0.84;
        p.traits.noveltySeeking = 0.28;
      }
    }
  });
  const testC = evaluateTestC({ baseline: baselineC, intervention: traitBiasC });

  const principles = {
    emergenceOverScripting: {
      pass: !!(testA.pass && testB.pass),
      rationale: "Interventions create systemic responses without scripted event injection.",
      evidenceFrom: ["testA", "testB"]
    },
    reciprocalCausality: {
      pass: !!testA.pass,
      rationale: "Policy/institution intervention -> individual behavior changes -> city/system indicators -> policy adaptation.",
      evidenceFrom: ["testA"]
    },
    multiScaleCoevolution: {
      pass: !!(testB.pass && testC.pass),
      rationale: "Shock and trait-distribution interventions propagate across person/city/nation/world-order layers.",
      evidenceFrom: ["testB", "testC"]
    }
  };

  const passCount = Object.values(principles).filter((p) => p.pass).length;
  return {
    meta: { days, seed, targetCityId, trackedIndividuals, evalProfile, generatedAt: new Date().toISOString() },
    tests: { testA, testB, testC },
    principles,
    verdict: {
      passCount,
      total: 3,
      pass: passCount === 3,
      label: passCount === 3 ? "All 3 principles verified in scenario evidence." : "Partial verification; inspect failing test evidence."
    }
  };
}

function runScenario({ name, days, seed, targetCityId, trackedIndividuals = null, setup = null, tickHook = null }) {
  const config = clone(DEFAULT_CONFIG);
  config.seed = seed;
  if (Number.isFinite(trackedIndividuals)) {
    config.population.trackedIndividuals = Math.max(120, Math.min(5000, Math.floor(trackedIndividuals)));
    config.population.activeDetailCount = Math.max(20, Math.min(300, Math.floor(config.population.trackedIndividuals * 0.08)));
  }
  const world = createSampleWorld(seed);
  const engine = new SimulationEngine({ world, config });
  if (setup) {
    setup({ config, world, engine });
  }

  const ticksPerDay = Math.floor(config.dayMinutes / config.tickMinutes);
  const totalTicks = Math.max(1, ticksPerDay * days);
  const moveTracker = new Map(engine.population.people.map((p) => [p.id, p.homeCityId]));
  let relocations = 0;
  let unemploymentSum = 0;
  let unemploymentTargetCitySum = 0;
  let incomeSum = 0;
  let instabilitySum = 0;
  let safetySum = 0;
  let tensionSum = 0;
  let tensionCount = 0;
  let maxAvgTension = 0;
  let maxWarPairs = 0;
  let maxCrisisPairs = 0;
  let maxBorderRestrictedEdges = 0;
  let maxInternationalEdgesCount = 0;
  let restrictionAppliedCount = 0;
  let maxRestrictionAppliedCount = 0;
  let unemploymentDriverSamples = 0;
  let openPositionsPerPersonSum = 0;
  let employmentCapacitySum = 0;
  let strainSum = 0;
  let hiringRecoveryMultSum = 0;
  let macroShockSum = 0;
  let baseHireShareSum = 0;
  let shockPenaltySum = 0;
  let strainPenaltySum = 0;
  let policySupportSum = 0;
  let capacityRatioSum = 0;
  let hireChanceSum = 0;
  let baseHireShareEffectiveSum = 0;
  let baseHireShareEffectiveP95Sum = 0;
  let regimeCountsByCity = {};
  let lastDemo = null;
  const demoDelta = { births: 0, marriages: 0, deaths: 0, divorces: 0 };
  const eventCounts = { riotRisk: 0, war: 0, crisis: 0, sanction: 0 };
  let frame = null;
  const lateStartTick = Math.floor(totalTicks * 0.8);
  let lateCount = 0;
  let lateSafetySum = 0;
  let lateTrustSum = 0;
  let lateInstabilitySum = 0;
  let lateUnemploymentSum = 0;
  let lateUnemploymentTargetCitySum = 0;
  let lateIncomeSum = 0;
  for (const city of world.cities ?? []) {
    regimeCountsByCity[city.id] = { normal: 0, stressed: 0, fractured: 0, samples: 0 };
  }

  for (let tick = 0; tick < totalTicks; tick += 1) {
    frame = engine.tick();
    if (tickHook) {
      tickHook({ world, engine, tick, frame });
    }
    for (const city of world.cities ?? []) {
      const row = (regimeCountsByCity[city.id] = regimeCountsByCity[city.id] ?? { normal: 0, stressed: 0, fractured: 0, samples: 0 });
      const regime = city.regime ?? "normal";
      row[regime] = (row[regime] ?? 0) + 1;
      row.samples += 1;
    }

    for (const p of engine.population.people) {
      const prev = moveTracker.get(p.id);
      if (prev !== p.homeCityId) {
        relocations += 1;
        moveTracker.set(p.id, p.homeCityId);
      }
    }

    unemploymentSum += frame.people?.economy?.unemploymentRate ?? 0;
    const targetCityRow = (frame.people?.economy?.byCity ?? []).find((row) => String(row.cityId) === String(targetCityId)) ?? null;
    unemploymentTargetCitySum += Number(targetCityRow?.unemploymentRate ?? 0);
    incomeSum += frame.people?.economy?.avgIncome ?? 0;
    instabilitySum += frame.people?.phaseIndicators?.avgInstability ?? 0;
    const avgSafety = average(world.cities.map((c) => c.metrics?.safety ?? 0));
    safetySum += avgSafety;
    const avgTrust = average(world.cities.map((c) => c.metrics?.trust ?? 0));

    const rel = frame.geopolitics?.relations ?? [];
    const avgT = average(rel.map((r) => r.tension ?? 0));
    maxAvgTension = Math.max(maxAvgTension, avgT);
    tensionSum += avgT;
    tensionCount += 1;
    maxWarPairs = Math.max(maxWarPairs, rel.filter((r) => r.status === "war").length);
    maxCrisisPairs = Math.max(maxCrisisPairs, rel.filter((r) => r.status === "crisis").length);
    const internationalEdgesNow = (world.edges ?? []).filter((e) => {
      const from = world.getCityById(e.fromCityId);
      const to = world.getCityById(e.toCityId);
      return !!from && !!to && from.nationId !== to.nationId;
    }).length;
    maxInternationalEdgesCount = Math.max(maxInternationalEdgesCount, internationalEdgesNow);
    const restrictionStats = world.systemState?.geopolitics?.edgeRestrictionStats ?? {};
    const restrictedPolicyEdgesNow = (restrictionStats.permit ?? 0) + (restrictionStats.sealed ?? 0);
    restrictionAppliedCount += restrictedPolicyEdgesNow;
    maxRestrictionAppliedCount = Math.max(maxRestrictionAppliedCount, restrictedPolicyEdgesNow);
    const restrictedNow = (world.edges ?? []).filter((e) => e.gatewayRestriction && e.gatewayRestriction !== "open").length;
    maxBorderRestrictedEdges = Math.max(maxBorderRestrictedEdges, restrictedNow);
    unemploymentDriverSamples += 1;
    const econDiag = frame.people?.economy?.employmentDiagnostics ?? null;
    if (econDiag) {
      baseHireShareSum += econDiag.avgBaseHireShare ?? 0;
      baseHireShareEffectiveSum += econDiag.avgBaseHireShareEffective ?? 0;
      baseHireShareEffectiveP95Sum += econDiag.p95BaseHireShareEffective ?? 0;
      shockPenaltySum += econDiag.avgShockPenalty ?? 0;
      strainPenaltySum += econDiag.avgStrainPenalty ?? 0;
      hiringRecoveryMultSum += econDiag.avgRegimeHiringMult ?? 0;
      policySupportSum += econDiag.avgPolicySupport ?? 0;
      capacityRatioSum += econDiag.avgCapacityRatio ?? 0;
      hireChanceSum += econDiag.avgHireChance ?? 0;
    } else {
      const populationNow = Math.max(1, engine.population.people.length);
      const openPositionsNow = (engine.population.companies ?? []).reduce((sum, c) => sum + Number(c.openPositionsPosted ?? 0), 0);
      openPositionsPerPersonSum += openPositionsNow / populationNow;
      employmentCapacitySum += average(world.cities.map((c) => c.metrics?.employmentCapacity ?? 0));
      strainSum += average(world.cities.map((c) => c.strain ?? 0));
      hiringRecoveryMultSum += average(
        world.cities.map((c) => {
          const regime = c.regime ?? "normal";
          const fx = config?.strain?.regimeEffects?.[regime] ?? config?.strain?.regimeEffects?.normal ?? {};
          return fx?.hiringRecoveryMult ?? 1;
        })
      );
    }
    const epidemicNow = world.systemState?.epidemicLevel ?? 0;
    const climateNow = world.systemState?.climateStress ?? 0;
    const marketNow = world.systemState?.marketIndex ?? 1;
    macroShockSum += epidemicNow * 0.42 + climateNow * 0.28 + Math.max(0, 1 - marketNow) * 0.3;
    strainSum += average(world.cities.map((c) => c.strain ?? 0));
    employmentCapacitySum += average(world.cities.map((c) => c.metrics?.employmentCapacity ?? 0));
    const populationNow = Math.max(1, engine.population.people.length);
    const openPositionsNow = (engine.population.companies ?? []).reduce((sum, c) => sum + Number(c.openPositionsPosted ?? 0), 0);
    openPositionsPerPersonSum += openPositionsNow / populationNow;

    for (const ev of frame.people?.events ?? []) {
      if (ev.type === "riot_risk") eventCounts.riotRisk += 1;
      if (ev.type === "war") eventCounts.war += 1;
      if (ev.type === "sanction") eventCounts.sanction += 1;
      if (ev.type === "ceasefire" || ev.type === "treaty") eventCounts.crisis += 1;
    }

    const d = frame.people?.demographics ?? {};
    if (lastDemo) {
      demoDelta.births += Math.max(0, (d.totalBirths ?? 0) - (lastDemo.totalBirths ?? 0));
      demoDelta.marriages += Math.max(0, (d.totalMarriages ?? 0) - (lastDemo.totalMarriages ?? 0));
      demoDelta.deaths += Math.max(0, (d.totalDeaths ?? 0) - (lastDemo.totalDeaths ?? 0));
      demoDelta.divorces += Math.max(0, (d.totalDivorces ?? 0) - (lastDemo.totalDivorces ?? 0));
    }
    lastDemo = {
      totalBirths: d.totalBirths ?? 0,
      totalMarriages: d.totalMarriages ?? 0,
      totalDeaths: d.totalDeaths ?? 0,
      totalDivorces: d.totalDivorces ?? 0
    };

    if (tick >= lateStartTick) {
      lateCount += 1;
      lateSafetySum += avgSafety;
      lateTrustSum += avgTrust;
      lateInstabilitySum += frame.people?.phaseIndicators?.avgInstability ?? 0;
      lateUnemploymentSum += frame.people?.economy?.unemploymentRate ?? 0;
      lateUnemploymentTargetCitySum += Number(targetCityRow?.unemploymentRate ?? 0);
      lateIncomeSum += frame.people?.economy?.avgIncome ?? 0;
    }
  }

  const city = world.getCityById(targetCityId);
  const inst = frame?.people?.institutions?.byCity?.[targetCityId] ?? null;
  const borderRestrictedEdges = (world.edges ?? []).filter((e) => e.gatewayRestriction && e.gatewayRestriction !== "open").length;
  const avgAge = average(engine.population.people.map((p) => p.age ?? 0));
  const avgOpenness = average(engine.population.people.map((p) => p.traits?.openness ?? 0));
  const avgFamily = average(engine.population.people.map((p) => p.traits?.familyOriented ?? 0));
  const religiousDiversity = shannonEntropy((frame?.people?.religionStats ?? []).map((r) => r.share ?? 0));
  const gini = estimateGini(engine.population.people.map((p) => p.socioeconomic?.wealth ?? 0));

  return {
    name,
    ticks: totalTicks,
    population: engine.population.people.length,
    behavior: {
      relocationRatePerTick: relocations / Math.max(1, totalTicks * engine.population.people.length),
      marriageRatePerTick: demoDelta.marriages / Math.max(1, totalTicks * engine.population.people.length),
      birthRatePerTick: demoDelta.births / Math.max(1, totalTicks * engine.population.people.length),
      avgUnemployment: unemploymentSum / Math.max(1, totalTicks),
      avgUnemploymentTargetCity: unemploymentTargetCitySum / Math.max(1, totalTicks),
      avgIncome: incomeSum / Math.max(1, totalTicks)
    },
    city: {
      targetCityId,
      productivity: city?.metrics?.productivity ?? null,
      safety: city?.metrics?.safety ?? null,
      trust: city?.metrics?.trust ?? null,
      instabilityRisk: city?.metrics?.instabilityRisk ?? null,
      inequality: city?.metrics?.inequality ?? null
    },
    institutions: {
      cooperationIndex: frame?.people?.institutions?.cooperationIndex ?? null,
      mutationCount: frame?.people?.institutions?.mutationCount ?? 0,
      policyRevisionCount: frame?.people?.institutions?.policyRevisionCount ?? 0,
      policyRevisionRate: frame?.people?.institutions?.policyRevisionRate ?? 0,
      cityPolicyAction: inst?.policy?.action ?? null,
      cityPolicyMutationCount: inst?.policy?.mutationCount ?? 0,
      cityEducationPolicyAction: inst?.educationPolicy?.action ?? null,
      cityEducationPolicyUpdates: inst?.educationPolicy?.updates ?? 0
    },
    policyGenome: {
      enabled: world.systemState?.policyGenome?.enabled ?? false,
      tick: world.systemState?.policyGenome?.tick ?? 0,
      lastEvolutionTick: world.systemState?.policyGenome?.lastEvolutionTick ?? 0,
      cityFitness: city?.policyGenome?.fitnessEma ?? null
    },
    geopolitics: {
      avgTension: tensionSum / Math.max(1, tensionCount),
      maxAvgTension,
      maxWarPairs,
      maxCrisisPairs,
      internationalEdgesCount: (world.edges ?? []).filter((e) => {
        const from = world.getCityById(e.fromCityId);
        const to = world.getCityById(e.toCityId);
        return !!from && !!to && from.nationId !== to.nationId;
      }).length,
      maxInternationalEdgesCount,
      restrictionAppliedCount,
      maxRestrictionAppliedCount,
      maxBorderRestrictedEdges,
      finalStatuses: countBy((frame?.geopolitics?.relations ?? []).map((r) => r.status ?? "unknown")),
      borderRestrictedEdges
    },
    social: {
      avgInstability: instabilitySum / Math.max(1, totalTicks),
      avgSafety: safetySum / Math.max(1, totalTicks),
      avgAge,
      avgOpenness,
      avgFamilyOriented: avgFamily,
      religiousDiversity,
      wealthGini: gini
    },
    unemploymentDrivers: {
      avgOpenPositionsPerPerson: openPositionsPerPersonSum / Math.max(1, unemploymentDriverSamples),
      avgEmploymentCapacity: employmentCapacitySum / Math.max(1, unemploymentDriverSamples),
      avgStrain: strainSum / Math.max(1, unemploymentDriverSamples),
      avgHiringRecoveryMult: hiringRecoveryMultSum / Math.max(1, unemploymentDriverSamples),
      avgMacroShock: macroShockSum / Math.max(1, unemploymentDriverSamples),
      avgBaseHireShare: baseHireShareSum / Math.max(1, unemploymentDriverSamples),
      avgBaseHireShareEffective: baseHireShareEffectiveSum / Math.max(1, unemploymentDriverSamples),
      p95BaseHireShareEffective: baseHireShareEffectiveP95Sum / Math.max(1, unemploymentDriverSamples),
      avgShockPenalty: shockPenaltySum / Math.max(1, unemploymentDriverSamples),
      avgStrainPenalty: strainPenaltySum / Math.max(1, unemploymentDriverSamples),
      avgPolicySupport: policySupportSum / Math.max(1, unemploymentDriverSamples),
      avgCapacityRatio: capacityRatioSum / Math.max(1, unemploymentDriverSamples),
      avgHireChance: hireChanceSum / Math.max(1, unemploymentDriverSamples)
    },
    regimeCountsByCity: Object.fromEntries(
      Object.entries(regimeCountsByCity).map(([cityId, row]) => {
        const n = Math.max(1, row.samples ?? 1);
        return [
          cityId,
          {
            normal: Number(((row.normal ?? 0) / n).toFixed(4)),
            stressed: Number(((row.stressed ?? 0) / n).toFixed(4)),
            fractured: Number(((row.fractured ?? 0) / n).toFixed(4)),
            samples: row.samples ?? 0
          }
        ];
      })
    ),
    lateWindow: {
      avgSafety: lateSafetySum / Math.max(1, lateCount),
      avgTrust: lateTrustSum / Math.max(1, lateCount),
      avgInstability: lateInstabilitySum / Math.max(1, lateCount),
      avgUnemployment: lateUnemploymentSum / Math.max(1, lateCount),
      avgUnemploymentTargetCity: lateUnemploymentTargetCitySum / Math.max(1, lateCount),
      avgIncome: lateIncomeSum / Math.max(1, lateCount)
    },
    events: eventCounts
  };
}

function evaluateTestA({ baseline, intervention, evalProfile }) {
  const d = diffMetrics(baseline, intervention);
  const behaviorChanged =
    Math.abs(d.behavior.relocationRatePerTick) > 1e-5 ||
    Math.abs(d.behavior.marriageRatePerTick) > 1e-5 ||
    Math.abs(d.behavior.avgUnemployment) > 0.005;
  const cityChanged =
    Math.abs(d.city.safety) > 0.01 ||
    Math.abs(d.city.trust) > 0.01 ||
    Math.abs(d.city.instabilityRisk) > 0.01;
  const policyMoveSignals = {
    revisionCountUp: intervention.institutions.policyRevisionCount > baseline.institutions.policyRevisionCount,
    revisionRateUp: intervention.institutions.policyRevisionRate > baseline.institutions.policyRevisionRate + 0.01,
    educationUpdatesUp: intervention.institutions.cityEducationPolicyUpdates > baseline.institutions.cityEducationPolicyUpdates,
    mutationDelta: intervention.institutions.cityPolicyMutationCount !== baseline.institutions.cityPolicyMutationCount,
    policyActionChanged: intervention.institutions.cityPolicyAction !== baseline.institutions.cityPolicyAction,
    educationPolicyActionChanged:
      intervention.institutions.cityEducationPolicyAction !== baseline.institutions.cityEducationPolicyAction
  };
  const response = Object.values(policyMoveSignals).some(Boolean);
  const lateDelta = {
    avgSafety: round((intervention.lateWindow?.avgSafety ?? 0) - (baseline.lateWindow?.avgSafety ?? 0)),
    avgTrust: round((intervention.lateWindow?.avgTrust ?? 0) - (baseline.lateWindow?.avgTrust ?? 0)),
    avgInstability: round((intervention.lateWindow?.avgInstability ?? 0) - (baseline.lateWindow?.avgInstability ?? 0)),
    avgUnemployment: round((intervention.lateWindow?.avgUnemployment ?? 0) - (baseline.lateWindow?.avgUnemployment ?? 0)),
    avgUnemploymentTargetCity: round(
      (intervention.lateWindow?.avgUnemploymentTargetCity ?? 0) - (baseline.lateWindow?.avgUnemploymentTargetCity ?? 0)
    ),
    avgIncome: round((intervention.lateWindow?.avgIncome ?? 0) - (baseline.lateWindow?.avgIncome ?? 0))
  };
  const profileResults = {};
  for (const profile of Object.keys(EVAL_PROFILES)) {
    const effective = adaptiveEffectivenessScore(d, profile);
    const sustain = adaptiveSustainabilityScore(lateDelta, profile);
    const effectiveness = effective > 0.01;
    const sustainability = sustain > 0.005;
    profileResults[profile] = {
      effectiveness,
      sustainability,
      class: classifyAdaptiveOutcome({ response, effectiveness, sustainability }),
      effectivenessScore: round(effective),
      sustainScore: round(sustain)
    };
  }
  const primary = profileResults[evalProfile] ?? profileResults["stability-first"];
  const adaptiveClass = primary.class;
  const policyAdapted = response;
  const unemploymentContributions = [
    {
      key: "targetCityUnemployment",
      value: round(d.behavior.avgUnemploymentTargetCity * 1.05)
    },
    {
      key: "shockPenalty",
      value: round((d.unemploymentDrivers?.avgShockPenalty ?? 0) * 1.25)
    },
    {
      key: "strainPenalty",
      value: round((d.unemploymentDrivers?.avgStrainPenalty ?? 0) * 1.2)
    },
    {
      key: "baseHireShare",
      value: round(-(d.unemploymentDrivers?.avgBaseHireShare ?? 0) * 1.1)
    },
    {
      key: "capacityRatio",
      value: round(-(d.unemploymentDrivers?.avgCapacityRatio ?? 0) * 0.95)
    },
    {
      key: "hiringRecoveryMult",
      value: round(-(d.unemploymentDrivers?.avgHiringRecoveryMult ?? 0) * 1.05)
    },
    {
      key: "policySupport",
      value: round(-(d.unemploymentDrivers?.avgPolicySupport ?? 0) * 1.1)
    },
    {
      key: "macroShock",
      value: round((d.unemploymentDrivers?.avgMacroShock ?? 0) * 0.7)
    }
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const unemploymentDeltaDiagnostics = {
    deltaUnemployment: d.behavior.avgUnemployment,
    driverDelta: d.unemploymentDrivers ?? {},
    weightedContributions: unemploymentContributions,
    topContributor: unemploymentContributions[0] ?? null
  };
  return {
    name: "A",
    principle: "Individuals ↔ Institutions ↔ Environment",
    pass: behaviorChanged && cityChanged && (adaptiveClass === "Effective Adaptation" || adaptiveClass === "Effective & Stable"),
    checks: { behaviorChanged, cityChanged, policyAdapted },
    adaptiveAssessment: {
      evalProfile,
      response,
      effectiveness: primary.effectiveness,
      sustainability: primary.sustainability,
      class: adaptiveClass,
      effectivenessScore: primary.effectivenessScore,
      sustainScore: primary.sustainScore,
      policyMoveSignals,
      lateDelta,
      unemploymentDeltaDiagnostics,
      byProfile: profileResults
    },
    baseline,
    intervention,
    delta: d
  };
}

function evaluateTestB({ baseline, intervention }) {
  const d = diffMetrics(baseline, intervention);
  const strictChecks = {
    economyShock: d.behavior.avgUnemployment > 0.01 || d.behavior.avgIncome < -0.01,
    migrationShift: d.behavior.relocationRatePerTick > 0,
    cityDestabilize: d.social.avgInstability > 0.01 || d.social.avgSafety < -0.01,
    geopoliticalSpill:
      intervention.geopolitics.maxCrisisPairs > baseline.geopolitics.maxCrisisPairs ||
      intervention.geopolitics.maxWarPairs > baseline.geopolitics.maxWarPairs ||
      d.geopolitics.borderRestrictedEdges > 0 ||
      (d.geopolitics.maxBorderRestrictedEdges ?? 0) > 0,
    feedbackToCities: d.geopolitics.borderRestrictedEdges > 0 || (d.geopolitics.maxBorderRestrictedEdges ?? 0) > 0
  };
  const activationChecks = {
    economyShock:
      intervention.behavior.avgUnemployment > baseline.behavior.avgUnemployment + 0.01 ||
      intervention.behavior.avgIncome < baseline.behavior.avgIncome - 0.01,
    migrationShift:
      intervention.behavior.relocationRatePerTick > baseline.behavior.relocationRatePerTick + 1e-5 ||
      intervention.behavior.relocationRatePerTick > 1e-4,
    cityDestabilize:
      intervention.social.avgInstability > baseline.social.avgInstability + 0.005 ||
      intervention.social.avgSafety < baseline.social.avgSafety - 0.005,
    geopoliticalSpill:
      (intervention.geopolitics.maxWarPairs ?? 0) > 0 ||
      (intervention.geopolitics.maxCrisisPairs ?? 0) > 0 ||
      (intervention.geopolitics.maxBorderRestrictedEdges ?? 0) > 0,
    feedbackToCities:
      (intervention.geopolitics.borderRestrictedEdges ?? 0) > 0 ||
      (intervention.geopolitics.maxBorderRestrictedEdges ?? 0) > 0 ||
      (intervention.geopolitics.restrictionAppliedCount ?? 0) > 0
  };
  const strictScore = Object.values(strictChecks).filter(Boolean).length;
  const activationScore = Object.values(activationChecks).filter(Boolean).length;
  const geopoliticalSpill =
    intervention.geopolitics.maxCrisisPairs > baseline.geopolitics.maxCrisisPairs ||
    intervention.geopolitics.maxWarPairs > baseline.geopolitics.maxWarPairs ||
    d.geopolitics.borderRestrictedEdges > 0 ||
    (d.geopolitics.maxBorderRestrictedEdges ?? 0) > 0;
  const feedbackToCities = activationChecks.feedbackToCities;
  const score = activationScore;
  return {
    name: "B",
    principle: "Multi-scale coevolution",
    pass: activationScore >= 4 && strictScore >= 2,
    checks: activationChecks,
    strictChecks,
    strictScore,
    activationScore,
    mode: "dual",
    score,
    baseline,
    intervention,
    delta: d
  };
}

function evaluateTestC({ baseline, intervention }) {
  const d = diffMetrics(baseline, intervention);
  const socioChange =
    Math.abs(d.behavior.birthRatePerTick) > 1e-5 ||
    Math.abs(d.behavior.marriageRatePerTick) > 1e-5 ||
    Math.abs(d.social.religiousDiversity) > 0.01;
  const structureChange = Math.abs(d.social.avgAge) > 0.02 || Math.abs(d.social.wealthGini) > 0.01;
  const strictInstitutionPushback =
    intervention.institutions.policyRevisionRate > baseline.institutions.policyRevisionRate + 0.01 ||
    intervention.institutions.cityPolicyMutationCount > baseline.institutions.cityPolicyMutationCount ||
    intervention.institutions.cityEducationPolicyUpdates > baseline.institutions.cityEducationPolicyUpdates;
  const absoluteInstitutionActivation =
    (intervention.institutions.policyRevisionRate ?? 0) > 0 ||
    (intervention.institutions.policyRevisionCount ?? 0) > 0 ||
    (intervention.institutions.mutationCount ?? 0) >= 8 ||
    (intervention.institutions.cityPolicyMutationCount ?? 0) >= 1 ||
    intervention.institutions.cityPolicyAction !== baseline.institutions.cityPolicyAction;
  const institutionPushback = strictInstitutionPushback || absoluteInstitutionActivation;
  return {
    name: "C",
    principle: "Trait distribution pushes institutions",
    pass: socioChange && structureChange && institutionPushback,
    checks: { socioChange, structureChange, institutionPushback },
    strictChecks: {
      socioChange,
      structureChange,
      institutionPushback: strictInstitutionPushback
    },
    activationChecks: {
      socioChange,
      structureChange,
      institutionPushback: absoluteInstitutionActivation
    },
    baseline,
    intervention,
    delta: d
  };
}

function resolveEvalProfile(raw) {
  const key = String(raw ?? "stability-first").trim().toLowerCase();
  return EVAL_PROFILES[key] ? key : "stability-first";
}

function adaptiveEffectivenessScore(delta, profile = "stability-first") {
  const w = EVAL_PROFILES[profile] ?? EVAL_PROFILES["stability-first"];
  return (
    delta.city.safety * w.citySafety +
    delta.city.trust * w.cityTrust +
    (-delta.city.instabilityRisk) * w.cityInstability +
    (-delta.behavior.avgUnemployment) * (w.unemploymentGlobal ?? 0.2) +
    (-delta.behavior.avgUnemploymentTargetCity) * (w.unemploymentTargetCity ?? 0.25) +
    delta.behavior.avgIncome * w.income
  );
}

function adaptiveSustainabilityScore(lateDelta, profile = "stability-first") {
  const w = EVAL_PROFILES[profile] ?? EVAL_PROFILES["stability-first"];
  return (
    lateDelta.avgSafety * w.citySafety +
    lateDelta.avgTrust * w.cityTrust +
    (-lateDelta.avgInstability) * w.cityInstability +
    (-lateDelta.avgUnemployment) * (w.unemploymentGlobal ?? 0.2) +
    (-lateDelta.avgUnemploymentTargetCity) * (w.unemploymentTargetCity ?? 0.25) +
    lateDelta.avgIncome * w.income
  );
}

function classifyAdaptiveOutcome({ response, effectiveness, sustainability }) {
  if (!response) return "No Response";
  if (response && !effectiveness) return "Adaptive but Ineffective";
  if (response && effectiveness && !sustainability) return "Effective Adaptation";
  return "Effective & Stable";
}

function diffMetrics(a, b) {
  return {
    behavior: {
      relocationRatePerTick: round(b.behavior.relocationRatePerTick - a.behavior.relocationRatePerTick),
      marriageRatePerTick: round(b.behavior.marriageRatePerTick - a.behavior.marriageRatePerTick),
      birthRatePerTick: round(b.behavior.birthRatePerTick - a.behavior.birthRatePerTick),
      avgUnemployment: round(b.behavior.avgUnemployment - a.behavior.avgUnemployment),
      avgUnemploymentTargetCity: round((b.behavior.avgUnemploymentTargetCity ?? 0) - (a.behavior.avgUnemploymentTargetCity ?? 0)),
      avgIncome: round(b.behavior.avgIncome - a.behavior.avgIncome)
    },
    city: {
      productivity: round((b.city.productivity ?? 0) - (a.city.productivity ?? 0)),
      safety: round((b.city.safety ?? 0) - (a.city.safety ?? 0)),
      trust: round((b.city.trust ?? 0) - (a.city.trust ?? 0)),
      instabilityRisk: round((b.city.instabilityRisk ?? 0) - (a.city.instabilityRisk ?? 0)),
      inequality: round((b.city.inequality ?? 0) - (a.city.inequality ?? 0))
    },
    institutions: {
      cooperationIndex: round((b.institutions.cooperationIndex ?? 0) - (a.institutions.cooperationIndex ?? 0)),
      mutationCount: (b.institutions.mutationCount ?? 0) - (a.institutions.mutationCount ?? 0),
      policyRevisionCount: (b.institutions.policyRevisionCount ?? 0) - (a.institutions.policyRevisionCount ?? 0),
      policyRevisionRate: round((b.institutions.policyRevisionRate ?? 0) - (a.institutions.policyRevisionRate ?? 0)),
      cityPolicyMutationCount: (b.institutions.cityPolicyMutationCount ?? 0) - (a.institutions.cityPolicyMutationCount ?? 0),
      cityEducationPolicyUpdates: (b.institutions.cityEducationPolicyUpdates ?? 0) - (a.institutions.cityEducationPolicyUpdates ?? 0)
    },
    geopolitics: {
      avgTension: round((b.geopolitics.avgTension ?? 0) - (a.geopolitics.avgTension ?? 0)),
      maxAvgTension: round((b.geopolitics.maxAvgTension ?? 0) - (a.geopolitics.maxAvgTension ?? 0)),
      maxWarPairs: (b.geopolitics.maxWarPairs ?? 0) - (a.geopolitics.maxWarPairs ?? 0),
      maxCrisisPairs: (b.geopolitics.maxCrisisPairs ?? 0) - (a.geopolitics.maxCrisisPairs ?? 0),
      internationalEdgesCount: (b.geopolitics.internationalEdgesCount ?? 0) - (a.geopolitics.internationalEdgesCount ?? 0),
      maxInternationalEdgesCount: (b.geopolitics.maxInternationalEdgesCount ?? 0) - (a.geopolitics.maxInternationalEdgesCount ?? 0),
      restrictionAppliedCount: (b.geopolitics.restrictionAppliedCount ?? 0) - (a.geopolitics.restrictionAppliedCount ?? 0),
      maxRestrictionAppliedCount: (b.geopolitics.maxRestrictionAppliedCount ?? 0) - (a.geopolitics.maxRestrictionAppliedCount ?? 0),
      maxBorderRestrictedEdges: (b.geopolitics.maxBorderRestrictedEdges ?? 0) - (a.geopolitics.maxBorderRestrictedEdges ?? 0),
      borderRestrictedEdges: (b.geopolitics.borderRestrictedEdges ?? 0) - (a.geopolitics.borderRestrictedEdges ?? 0)
    },
    social: {
      avgInstability: round((b.social.avgInstability ?? 0) - (a.social.avgInstability ?? 0)),
      avgSafety: round((b.social.avgSafety ?? 0) - (a.social.avgSafety ?? 0)),
      avgAge: round((b.social.avgAge ?? 0) - (a.social.avgAge ?? 0)),
      religiousDiversity: round((b.social.religiousDiversity ?? 0) - (a.social.religiousDiversity ?? 0)),
      wealthGini: round((b.social.wealthGini ?? 0) - (a.social.wealthGini ?? 0))
    },
    unemploymentDrivers: {
      avgOpenPositionsPerPerson: round(
        (b.unemploymentDrivers?.avgOpenPositionsPerPerson ?? 0) - (a.unemploymentDrivers?.avgOpenPositionsPerPerson ?? 0)
      ),
      avgEmploymentCapacity: round(
        (b.unemploymentDrivers?.avgEmploymentCapacity ?? 0) - (a.unemploymentDrivers?.avgEmploymentCapacity ?? 0)
      ),
      avgStrain: round((b.unemploymentDrivers?.avgStrain ?? 0) - (a.unemploymentDrivers?.avgStrain ?? 0)),
      avgHiringRecoveryMult: round(
        (b.unemploymentDrivers?.avgHiringRecoveryMult ?? 0) - (a.unemploymentDrivers?.avgHiringRecoveryMult ?? 0)
      ),
      avgMacroShock: round((b.unemploymentDrivers?.avgMacroShock ?? 0) - (a.unemploymentDrivers?.avgMacroShock ?? 0)),
      avgBaseHireShare: round((b.unemploymentDrivers?.avgBaseHireShare ?? 0) - (a.unemploymentDrivers?.avgBaseHireShare ?? 0)),
      avgBaseHireShareEffective: round(
        (b.unemploymentDrivers?.avgBaseHireShareEffective ?? 0) - (a.unemploymentDrivers?.avgBaseHireShareEffective ?? 0)
      ),
      p95BaseHireShareEffective: round(
        (b.unemploymentDrivers?.p95BaseHireShareEffective ?? 0) - (a.unemploymentDrivers?.p95BaseHireShareEffective ?? 0)
      ),
      avgShockPenalty: round((b.unemploymentDrivers?.avgShockPenalty ?? 0) - (a.unemploymentDrivers?.avgShockPenalty ?? 0)),
      avgStrainPenalty: round((b.unemploymentDrivers?.avgStrainPenalty ?? 0) - (a.unemploymentDrivers?.avgStrainPenalty ?? 0)),
      avgPolicySupport: round((b.unemploymentDrivers?.avgPolicySupport ?? 0) - (a.unemploymentDrivers?.avgPolicySupport ?? 0)),
      avgCapacityRatio: round((b.unemploymentDrivers?.avgCapacityRatio ?? 0) - (a.unemploymentDrivers?.avgCapacityRatio ?? 0)),
      avgHireChance: round((b.unemploymentDrivers?.avgHireChance ?? 0) - (a.unemploymentDrivers?.avgHireChance ?? 0))
    }
  };
}

function average(values) {
  if (!values?.length) return 0;
  return values.reduce((s, v) => s + Number(v || 0), 0) / values.length;
}

function countBy(rows) {
  const out = {};
  for (const r of rows ?? []) out[r] = (out[r] ?? 0) + 1;
  return out;
}

function estimateGini(values) {
  const x = (values ?? []).map((v) => Number(v || 0)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = x.length;
  if (n === 0) return 0;
  const sum = x.reduce((s, v) => s + v, 0);
  if (sum <= 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i += 1) cum += (i + 1) * x[i];
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

function shannonEntropy(shares) {
  let h = 0;
  for (const p0 of shares ?? []) {
    const p = Math.max(0, Number(p0 || 0));
    if (p <= 0) continue;
    h -= p * Math.log(p);
  }
  return h;
}

function round(n) {
  return Number((Number(n) || 0).toFixed(6));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--days") out.days = Number.parseInt(argv[++i] ?? "0", 10);
    else if (a === "--seed") out.seed = Number.parseInt(argv[++i] ?? "0", 10);
    else if (a === "--city") out.city = String(argv[++i] ?? "C1");
    else if (a === "--out") out.out = String(argv[++i] ?? defaultOutRelPath);
    else if (a === "--tracked") out.tracked = Number.parseInt(argv[++i] ?? "0", 10);
    else if (a === "--eval-profile") out.evalProfile = String(argv[++i] ?? "stability-first");
  }
  return out;
}

function formatSummary(report) {
  const t = report.tests;
  const p = report.principles;
  const topDriver = t.testA?.adaptiveAssessment?.unemploymentDeltaDiagnostics?.topContributor ?? null;
  return [
    `[A] pass=${t.testA.pass} evalProfile=${t.testA.adaptiveAssessment?.evalProfile ?? "-"} class=${t.testA.adaptiveAssessment?.class ?? "-"} checks=${JSON.stringify(t.testA.checks)}`,
    `[A unemploymentDriver] top=${topDriver?.key ?? "-"} contribution=${topDriver?.value ?? 0}`,
    `[B] pass=${t.testB.pass} checks=${JSON.stringify(t.testB.checks)} score=${t.testB.score}/5`,
    `[C] pass=${t.testC.pass} checks=${JSON.stringify(t.testC.checks)}`,
    `[P1 Emergence] ${p.emergenceOverScripting.pass}`,
    `[P2 Reciprocal Causality] ${p.reciprocalCausality.pass}`,
    `[P3 Multi-scale Coevolution] ${p.multiScaleCoevolution.pass}`,
    `[VERDICT] ${report.verdict.label}`
  ].join("\n");
}
