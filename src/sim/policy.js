export const POLICY_PRESETS = {
  balanced: { mode: "balanced", safetyBudget: 0.5, welfareBudget: 0.5, educationBudget: 0.5 },
  growth: { mode: "growth", safetyBudget: 0.35, welfareBudget: 0.25, educationBudget: 0.75 },
  stability: { mode: "stability", safetyBudget: 0.8, welfareBudget: 0.7, educationBudget: 0.35 }
};

export function applyPolicyPreset(config, preset) {
  if (!POLICY_PRESETS[preset]) {
    return config;
  }
  config.policy = { ...POLICY_PRESETS[preset] };
  return config;
}
