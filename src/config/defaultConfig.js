export const DEFAULT_CONFIG = {
  seed: 1337,
  tickMinutes: 30,
  dayMinutes: 24 * 60,
  flowParticleScale: 0.1,
  timeline: {
    historyLimit: 240
  },
  weekly: {
    enabled: true,
    weekendNightlifeBoost: 1.35,
    weekendReligionBoost: 1.3
  },
  migration: {
    nightlyRelocationBaseRate: 0.01,
    religionCompatibilityWeight: 0.12,
    bandit: {
      enabled: true,
      learningRate: 0.12,
      epsilon: 0.08,
      explorationBonus: 0.06,
      utilityWeight: 0.82
    }
  },
  religion: {
    conversionBaseRate: 0.002
  },
  economy: {
    unemploymentPenalty: 0.06,
    skillLearningRate: 0.012
  },
  currency: {
    enabled: true,
    baseCode: "SCU",
    fxVolatility: 0.01,
    inflationBase: 0.012,
    policyRateBase: 0.02
  },
  banking: {
    enabled: true,
    baseDepositFlow: 0.28,
    baseLoanRateSpread: 0.015
  },
  resources: {
    enabled: true,
    extractionBase: 0.018,
    regenBase: 0.011,
    marketSensitivity: 0.2
  },
  instability: {
    riotThreshold: 0.72,
    riotBaseRate: 0.008
  },
  geopolitics: {
    enabled: true,
    warThreshold: 0.78,
    crisisThreshold: 0.58,
    allianceThreshold: 0.24,
    nationFormationEnabled: true,
    nationFormationBaseChance: 0.09,
    nationFormationPressureThreshold: 0.46,
    nationFormationCooldownDays: 20,
    nationFormationMaxCities: 3,
    nationFormationMinRetainedCities: 1
  },
  metaOrder: {
    enabled: true,
    blocCount: 3,
    institutionalDrift: 0.018,
    hegemonyEventThreshold: 0.72
  },
  policyGenome: {
    enabled: true,
    evolutionIntervalTicks: 48,
    baseMutation: 0.04,
    inheritanceBlend: 0.72
  },
  urbanDynamics: {
    hubRiseThreshold: 1.15,
    declineThreshold: 0.52,
    genesisPressureThreshold: 0.64,
    genesisCapacityThreshold: 0.56,
    genesisPressureStreak: 4,
    genesisCooldownTicks: 14
  },
  company: {
    competitionPenalty: 0.08,
    supplyChainEffect: 0.12,
    stockVolatility: 0.04
  },
  extensions: {
    epidemic: {
      enabled: true,
      baseDrift: 0.002
    },
    climate: {
      enabled: true,
      baseDrift: 0.0015
    },
    culture: {
      enabled: true,
      traitDrift: 0.002
    }
  },
  policy: {
    mode: "balanced",
    safetyBudget: 0.5,
    welfareBudget: 0.5,
    educationBudget: 0.5
  },
  population: {
    trackedIndividuals: 900,
    activeDetailCount: 60
  },
  social: {
    nightlyEncounterBaseRate: 0.08
  },
  institutions: {
    enabled: true,
    publicStaffRate: 0.17,
    policyLearningRate: 0.12,
    policyEpsilon: 0.12,
    mutationRate: 0.08,
    metaGovernanceEnabled: true,
    stabilityHistoryLimit: 720
  },
  rl: {
    enabled: true,
    alpha: 0.12,
    epsilon: 0.12,
    companyEpsilon: 0.12,
    diplomacyEpsilon: 0.1,
    resourceEpsilon: 0.12,
    investmentEpsilon: 0.14
  },
  educationSystem: {
    enabled: true,
    schoolCapacityRate: 0.22,
    dailyStudyGain: 0.0045,
    tertiaryCapacityRate: 0.08,
    dropoutBaseRate: 0.002,
    compulsoryMaxAge: 17
  },
  cityTypes: {
    residential: { commuteOutBias: 1.25, commuteInBias: 0.75 },
    mixed: { commuteOutBias: 1.0, commuteInBias: 1.0 },
    workHub: { commuteOutBias: 0.7, commuteInBias: 1.35 }
  },
  phaseWeights: {
    Morning: { commute: 1.2, nightlife: 0.2 },
    Daytime: { commute: 0.45, nightlife: 0.1 },
    Evening: { commute: 1.15, nightlife: 0.5 },
    Night: { commute: 0.35, nightlife: 1.0 }
  }
};
