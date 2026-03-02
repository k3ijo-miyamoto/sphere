---
name: sphere-generative-principles-check
description: Validate Sphere against 3 core principles (Emergence over scripting, Reciprocal causality, Multi-scale coevolution) using Generative-test.md scenarios A/B/C and output a reproducible report.
---

# Sphere Generative Principles Check

Use this skill when the user asks to verify whether Sphere still satisfies its 3 defining principles.

## Source of Truth

- Scenario intent: `Generative-test.md`
- Execution script: `scripts/generativePrinciplesCheck.js`

## Run

```bash
npm run report:generative-principles -- --days 45 --seed 1337 --city C1 --out generative_principles_report.json
```

You may change:

- `--days`: simulation horizon
- `--seed`: deterministic seed
- `--city`: intervention city for test A
- `--out`: output report path

## What is validated

### Test A: Intervention -> response -> adaptation

- Policy/institution levers are changed.
- Individual behavior metrics must change.
- City metrics must change.
- Policy adaptation evidence must appear (institution policy revisions and/or genome evolution).

### Test B: External shock -> chain -> geopolitics

- Shock hits macro conditions.
- Economy/migration/city stability should react.
- Geopolitical tension/crisis/war or border restriction feedback should rise.

### Test C: Trait distribution pushes institutions

- Initial trait distribution is biased.
- Marriage/birth/religious composition and social structure should change.
- Institution policy changes should follow.

## Output

- JSON report with:
  - `tests.testA|B|C`
  - `principles.emergenceOverScripting`
  - `principles.reciprocalCausality`
  - `principles.multiScaleCoevolution`
  - `verdict`

## Summarize for User

Report in this order:

1. 3 principle pass/fail
2. Which test failed (if any)
3. Most important deltas (2-4 items)
4. One concrete next experiment
