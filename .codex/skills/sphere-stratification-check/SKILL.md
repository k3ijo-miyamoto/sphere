---
name: sphere-stratification-check
description: Measure and compare social stratification in Sphere using inequality metrics (Gini, top wealth share, banking net, city-level gap). Use when checking whether hierarchy is deepening, auditing wealth concentration, or comparing before/after simulation or policy changes.
---

# Sphere Stratification Check

Run a deterministic stratification report from the simulation and summarize trend direction.
The report reads the active MCP world state (single source of truth).

## Run Report

```bash
npm run report:stratification -- --compare-from 0 --output stratification_report.json
```

Use nonzero `--compare-from` to compare two mature phases.

## Read Results

Inspect `stratification_report.json`:
- `base` and `current`: snapshots
- `wealth.gini`: inequality level
- `wealth.top10SharePct` and `wealth.top20SharePct`: concentration
- `banking.net`: balance-sheet pressure
- `cityGap.incomeStd` and `cityGap.unemploymentStd`: inter-city spread
- `delta`: change from base to current
- `interpretation`: automatic trend label

## Summarize for User

Report in this order:
1. Current inequality (`gini`, top shares)
2. Direction (`delta` and interpretation)
3. Main driver guess (wealth concentration, banking stress, or city gap)
4. One concrete next scenario to test

## Troubleshooting

If the command is missing, add this script in `package.json`:
```json
"report:stratification": "node scripts/stratificationReport.js"
```
If state API is unreachable, run `npm run start:mcp` first.
