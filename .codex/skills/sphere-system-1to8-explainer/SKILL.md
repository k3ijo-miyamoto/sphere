---
name: sphere-system-1to8-explainer
description: Explain Sphere world mechanics in 8 fixed sections (1.Time Loop, 2.Agent Behavior, 3.Employment/Income, 4.Company Dynamics, 5.Resources/Macro, 6.Geopolitics, 7.Meta-Order 1-5, 8.Reinforcement Learning). Use when user asks for system analysis at this granularity, Mermaid summaries, or repeatable post-change architecture explanations.
---

# Sphere System 1-8 Explainer

Use this skill when the user asks for a detailed system explanation in the fixed 1-8 format.
Always ground explanations in current code (not memory), because behavior can change after patches.

## Data Source Rule (important)

- Runtime geopolitics/meta-order state must be read from:
1. `frame.geopolitics` (tick output), or
2. `world.systemState.geopolitics` (persistent state)
- Do not use `world.geopolitics` as an authoritative source.
- When live state API is unstable, use `web/mcp_snapshot.json` and clearly label this as snapshot-based.

## Output Contract (always keep order)

1. Time Loop
2. Agent Behavior
3. Employment / Income
4. Company Dynamics
5. Resources / Macro
6. Geopolitics
7. Meta-Order (1-5 layers)
8. Reinforcement Learning

For each section:
- Explain decision flow in plain language.
- Include key formulas/thresholds if present.
- Add file references to exact implementation points.
- Mention known simplifications (what is not modeled).

## Depth Modes (must support both)

### Mode A: Overview
- Keep each section concise (high-level structure + major levers).

### Mode B: Formula Drilldown
- Use when user asks things like:
  - \"算出式を詳しく\"
  - \"この判定の中身は？\"
  - \"なぜその結果になる？\"
- For the asked subsystem, include:
1. Exact equation in math-like form
2. Variable meaning and range/clamp
3. Smoothing/memory effects (if any)
4. Threshold / gate conditions
5. A tiny numeric example
6. Exact code references (line-level)

When user asks a follow-up, do not repeat all 1-8. Expand only the requested part at formula level.

## Required Sources To Read

- `src/sim/engine.js`
- `src/sim/population.js`
- `src/sim/cityDynamics.js`
- `src/sim/geopolitics.js`
- `src/world/model.js`
- `src/config/defaultConfig.js`
- `scripts/mcpServer.js`

## Fast Discovery Commands

Use these searches first, then open only relevant ranges.

```bash
rg -n "class SimulationEngine|tick\(|updateGeopolitics|updateCityDynamics|population\.tick" src/sim src/main.js -S
rg -n "resolveState|applyEmploymentAndEconomy|pickEmployer|unemploymentRate|computeEconomySummary" src/sim/population.js -S
rg -n "chooseResourcePolicyAction|updateResourcePolicyLearning|RESOURCE_RL_ACTIONS" src/sim/cityDynamics.js -S
rg -n "chooseDiplomacyAction|updateDiplomacyPolicyLearning|chooseSecretSocietyAction|updateSecretSocietyPolicyLearning|nation_founded|territory_shift" src/sim/geopolitics.js -S
rg -n "rl:|epsilon|alpha|bandit" src/config/defaultConfig.js src/sim -S
```

## Mermaid Requirement

When asked for diagrams, include at least:
- One high-level architecture graph.
- One tick/update sequence diagram.
- One RL policy loop diagram.

For drilldown requests, also include one focused micro-diagram (decision gate or formula pipeline) when useful.

## Change-Aware Behavior

If the user says "after modification" or asks repeatedly over time:
1. Re-read the required sources.
2. Recompute formulas/thresholds from current code.
3. Call out deltas from previous explanation when detectable.

## Quality Bar

- Do not invent mechanisms not present in code.
- If behavior is heuristic/probabilistic, state that explicitly.
- Prefer concrete constants from code (example: `0.92 - shock + rehireBoost`).
- Keep sections stable so users can diff answers over time.
- If constants exist, always show them explicitly (avoid vague wording).
- Distinguish clearly between implemented logic and interpretation.
