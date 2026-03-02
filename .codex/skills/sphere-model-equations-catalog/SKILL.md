---
name: sphere-model-equations-catalog
description: Maintain and explain Sphere model equations in a single canonical list. Use when user asks for formulas, model equations, update-by-equation explanations, or wants the equation registry refreshed after code changes.
---

# Sphere Model Equations Catalog

Use this skill when the user asks any of:
- 「モデル方程式を教えて」
- 「数式で説明して」
- 「方程式一覧を更新して」
- 「変更後の式の差分は？」

## Canonical File

- Source of truth: `モデル方程式一覧.md`

Always keep this file synchronized with current code.

## Required Code Sources

- `src/sim/population.js`
- `src/sim/cityDynamics.js`
- `src/sim/geopolitics.js`
- `src/sim/engine.js`
- `src/config/defaultConfig.js`

## Refresh Workflow

1. Read `モデル方程式一覧.md`.
2. Re-scan code constants and formulas with `rg`.
3. Update equations, variable definitions, and thresholds.
4. Keep equations compact and implementation-faithful.
5. Add file references per equation block.

## Fast Search Commands

```bash
rg -n "strain|regime|threshold|clamp\(|epsilon|alpha|reward|utility|unemployment|migration|tension|war|policy" src/sim src/config/defaultConfig.js -S
rg -n "function updateCityStrainAndRegime|applyRegimeEffectsToCity|applyRelocationMigration|cityUtility|updateDiplomacyPolicyLearning|updateResourcePolicyLearning" src/sim -S
```

## Output Contract

When asked to explain formulas:
1. Show equation.
2. Explain variables and ranges.
3. Mention thresholds/gates.
4. Provide exact file references.
5. If changed recently, include delta summary.

## Quality Rules

- Do not infer formulas that are not implemented.
- Prefer exact coefficients from code.
- Distinguish equation-level facts from interpretation.
- If an equation is heuristic/probabilistic, state it explicitly.
