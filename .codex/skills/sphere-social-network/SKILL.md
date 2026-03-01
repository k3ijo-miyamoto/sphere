# Sphere Social Network Skill

## Purpose
Export and visualize human social networks inside Sphere (especially coworker networks per company).

## When to use
- User asks to visualize a company's human network.
- User asks to compare internal network over time.
- User asks for top connectors or strongest ties.

## Inputs
- `company_name` (preferred) or `company_id`
- `steps` (simulation steps, default `220`)
- `min_weight` (edge threshold, default `0`)

## Workflow
1. Export network data JSON/JS.
2. Open the visualization HTML.
3. If requested, summarize key metrics (members, edges, strongest ties).

## Commands
### 1) Export data by company name
```bash
npm run export:social-network -- --company-name "Merca Industry 3" --steps 220 --output web/social_network_data.json --output-js web/social_network_data.js
```

### 2) Export data by company id
```bash
npm run export:social-network -- --company-id 3 --steps 220 --output web/social_network_data.json --output-js web/social_network_data.js
```

### 3) Start web viewer
```bash
npm run start:web
```

### 4) Open page
- `http://127.0.0.1:5173/web/merca_industry_3_network.html`
- For remote IDE/port-forwarding, append: `/web/merca_industry_3_network.html`

## Output checks
- Confirm files exist:
  - `web/social_network_data.json`
  - `web/social_network_data.js`
- Confirm summary in JSON:
  - `network.members`
  - `network.internalEdges`
  - `network.avgInternalWeight`

## Notes
- If `fetch` is blocked, the HTML falls back to `social_network_data.js`.
- If the richest company has zero members, export a specific company by name/id.
