---
name: sphere-geopolitics-tension-check
description: Measure and compare interstate tension in Sphere using diplomacy status and thresholds (peace/alliance/crisis/war). Use when checking war signals, crisis risk, or before/after policy and simulation-step changes.
---

# Sphere Geopolitics Tension Check

Run a deterministic geopolitics report and summarize interstate risk.
The report reads the active MCP world state (single source of truth).

## Run Report

```bash
npm run report:geopolitics -- --compare-from 0 --output geopolitics_tension_report.json --top 5
```

Use `--compare-from` to compare with an earlier baseline.

## Read Results

Inspect `geopolitics_tension_report.json`:
- `current.tension.avg` and `current.tension.max`
- `current.statuses` (`peace`, `alliance`, `crisis`, `war`)
- `current.topRelations` for hottest nation pairs
- `thresholds` (`crisis`, `war`)
- `delta` for change vs baseline
- `interpretation` for trend label

## Summarize for User

Report in this order:
1. Whether war/crisis exists now
2. Current average and maximum tension
3. Highest-tension nation pairs
4. Direction (`delta.avgTension`) and one concrete next action

## Troubleshooting

If the command is missing, add this script in `package.json`:
```json
"report:geopolitics": "node scripts/geopoliticsTensionReport.js"
```
If state API is unreachable, run `npm run start:mcp` first.
