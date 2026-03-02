---
name: sphere-richest-person-check
description: Find the richest person in Sphere (or top N) from the active world snapshot, with optional live profile verification via MCP state API. Use when users ask who is wealthiest now or request rich-person ranking.
---

# Sphere Richest Person Check

Find wealth ranking deterministically from snapshot data and report source explicitly.

## Data Source Rule (important)

- Primary source: `web/mcp_snapshot.json` (`people[].socioeconomic.wealth`)
- Optional verification source: state API tool `sphere_person_profile`
- In responses, always cite source(s):
1. snapshot path
2. whether live profile verification succeeded

## Run Report

```bash
npm run report:richest-person -- --top 1 --output richest_person_report.json
```

Common options:
- `--top 5`: output top 5 people
- `--verify-live false`: skip state API verification
- `--snapshot web/mcp_snapshot.json`: custom snapshot path

## Read Results

Inspect `richest_person_report.json`:
- `frame.time`, `frame.phase`, `frame.worldVersion`
- `population`
- `top[]`:
1. `personId`, `name`, `wealth`
2. `cash`, `realEstate`, `stocks`, `bankDeposit`, `debt`
3. `currentCityName`, `nationId`, `profession`
4. `liveProfile.wealthRank` (if verification succeeded)

## Summarize for User

Report in this order:
1. Richest person name and `personId`
2. Wealth value and top asset breakdown
3. City / nation / profession
4. Source attribution (snapshot + live verification status)

## Troubleshooting

- If report command is missing, add:
```json
"report:richest-person": "node scripts/richestPersonReport.js"
```
- If state API is down, run with `--verify-live false` and use snapshot-only output.
