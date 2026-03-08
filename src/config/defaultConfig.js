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
  spheres: {
    enabled: true,
    defaults: [
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
    ],
    eventRates: {
      sphereSplitDaily: 0.06,
      trustShockDaily: 0.08,
      mobilizationDaily: 0.1
    },
    eventTtlTicks: {
      sphereSplit: 72,
      trustShock: 48,
      mobilization: 56
    }
  },
  communication: {
    enabled: true,
    baseInfoGenPerTick: 0.018,
    maxActiveInfos: 180,
    edgeAllowedBySphere: {
      S1: {
        Layer0: {
          Layer0: { prob: 0.82, cost: 0.12, latency: 1 },
          Layer1: { prob: 0.42, cost: 0.28, latency: 2 },
          Layer2: { prob: 0.22, cost: 0.45, latency: 3 }
        },
        Layer1: {
          Layer0: { prob: 0.66, cost: 0.18, latency: 1 },
          Layer1: { prob: 0.58, cost: 0.2, latency: 2 },
          Layer2: { prob: 0.32, cost: 0.34, latency: 2 }
        },
        Layer2: {
          Layer0: { prob: 0.72, cost: 0.14, latency: 1 },
          Layer1: { prob: 0.5, cost: 0.24, latency: 2 },
          Layer2: { prob: 0.38, cost: 0.3, latency: 2 }
        }
      },
      S2: {
        Layer0: {
          Layer0: { prob: 0.88, cost: 0.08, latency: 1 },
          Layer1: { prob: 0.54, cost: 0.22, latency: 1 },
          Layer2: { prob: 0.16, cost: 0.52, latency: 3 }
        },
        Layer1: {
          Layer0: { prob: 0.72, cost: 0.14, latency: 1 },
          Layer1: { prob: 0.62, cost: 0.18, latency: 1 },
          Layer2: { prob: 0.24, cost: 0.42, latency: 3 }
        },
        Layer2: {
          Layer0: { prob: 0.66, cost: 0.18, latency: 2 },
          Layer1: { prob: 0.44, cost: 0.28, latency: 2 },
          Layer2: { prob: 0.3, cost: 0.35, latency: 2 }
        }
      },
      S3: {
        Layer0: {
          Layer0: { prob: 0.74, cost: 0.18, latency: 1 },
          Layer1: { prob: 0.62, cost: 0.2, latency: 1 },
          Layer2: { prob: 0.42, cost: 0.3, latency: 2 }
        },
        Layer1: {
          Layer0: { prob: 0.68, cost: 0.16, latency: 1 },
          Layer1: { prob: 0.7, cost: 0.14, latency: 1 },
          Layer2: { prob: 0.48, cost: 0.24, latency: 2 }
        },
        Layer2: {
          Layer0: { prob: 0.76, cost: 0.14, latency: 1 },
          Layer1: { prob: 0.58, cost: 0.18, latency: 1 },
          Layer2: { prob: 0.52, cost: 0.2, latency: 1 }
        }
      }
    }
  },
  migration: {
    nightlyRelocationBaseRate: 0.01,
    religionCompatibilityWeight: 0.12,
    bandit: {
      enabled: true,
      learningRate: 0.12,
      forgetting: 0.02,
      epsilon: 0.08,
      explorationBonus: 0.06,
      utilityWeight: 0.82,
      useContext: true
    }
  },
  religion: {
    conversionBaseRate: 0.002
  },
  economy: {
    unemploymentPenalty: 0.06,
    skillLearningRate: 0.012,
    salaryWealthEma: 0.08,
    salaryWealthScale: 0.45
  },
  employment: {
    baseHireShareRegimeMult: {
      normal: 1,
      stressed: 0.9,
      fractured: 0.82
    },
    baseHireShareFloor: 0.08,
    baseHirePolicyCoupling: 0.12,
    baseHireStabilityCoupling: 0.08,
    unemploymentResponseThreshold: 18,
    unemploymentResponseScale: 0.3,
    policyActionEmploymentBoost: {
      balanced_focus: 0.4,
      security_focus: 0.1,
      justice_focus: 0.2,
      welfare_focus: 0.85,
      growth_focus: 1
    }
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
    restrictionPermitLockTicks: 48,
    restrictionSealedLockTicks: 96,
    sealedReleaseShockThreshold: 0.14,
    permitReleaseShockThreshold: 0.07,
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
  strain: {
    enabled: true,
    shockWindowReliefSuppressionEnabled: false,
    decayPerTick: 0.004,
    addScale: 0.08,
    reliefScale: 0.028,
    thresholds: {
      normalToStressed: 0.42,
      stressedToFractured: 0.72,
      stressedToNormalBack: 0.32,
      fracturedToStressedBack: 0.58
    },
    regimeEffects: {
      normal: {
        trustRecoveryMult: 1,
        instabilityAmplifier: 1,
        cityDestabilizeGain: 0,
        migrationMult: 1,
        hiringRecoveryMult: 1
      },
      stressed: {
        trustRecoveryMult: 0.78,
        instabilityAmplifier: 1.22,
        cityDestabilizeGain: 0.0015,
        migrationMult: 1.18,
        hiringRecoveryMult: 0.9
      },
      fractured: {
        trustRecoveryMult: 0.56,
        instabilityAmplifier: 1.45,
        cityDestabilizeGain: 0.0035,
        migrationMult: 1.45,
        hiringRecoveryMult: 0.75
      }
    },
    geopoliticalTriggerFracThreshold: 0.14
  },
  company: {
    competitionPenalty: 0.08,
    supplyChainEffect: 0.12,
    stockVolatility: 0.04,
    valuation: {
      baseCapitalWeight: 1.7,
      baseRevenueWeight: 0.45,
      profitScale: 4,
      growthScale: 1.35,
      lossPenaltyScale: 2.6,
      min: 0.05,
      max: 6
    },
    hyperGrowth: {
      chance: 0.003,
      minMultiplier: 1.8,
      maxMultiplier: 3.6,
      boostDecay: 0.9
    }
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
    educationBudget: 0.5,
    targetEmploymentCityId: null,
    targetEmploymentBoost: 0,
    targetEmploymentBoostTicks: 0,
    targetEmploymentBoostRegimeOnly: true
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
    investmentEpsilon: 0.14,
    companyAlpha: 0.12,
    investmentAlpha: 0.12,
    diplomacyAlpha: 0.1,
    resourceAlpha: 0.12,
    secretSocietyAlpha: 0.08,
    diplomacyUpdateIntervalDays: 30,
    investmentUpdateIntervalDays: 7,
    resourceUpdateIntervalTicks: 4,
    resourceRegimeShiftThreshold: 0.14
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
