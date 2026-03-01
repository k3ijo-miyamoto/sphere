# Sphere Civilization Simulation (Phase 2 Foundation)

This repository now contains an initial implementation scaffold for the project vision in `Project Overview.md`.

## Implemented

- Deterministic simulation clock with daily phases.
- Multi-layer spherical world data model (layers, cities, edges).
- City socioeconomic metrics for flow utility estimation.
- Commuting flow model influenced by day phase, city type, economics, congestion, and safety.
- Flow-to-particle translation layer (rendering-ready payloads).
- Individual `Person` model with identity, traits, ability, and socioeconomic attributes.
- Daily behavior state machine: `Home | Commute | Work | Leisure | Sleep`.
- Night-time social encounter estimator by city.
- Hybrid population view:
  - tracked individuals for behavior simulation
  - sampled active individuals in focus cities for near-detail rendering
- Runnable entry point that simulates one full day and prints flow + person state summaries.

## Run

```bash
npm start
```

## Web Viewer (Three.js)

```bash
npm run start:web
```

Then open:

```text
http://127.0.0.1:5173/
```

Notes:
- The web viewer uses local `node_modules/three` (no CDN dependency).
- The simulation core is shared with the CLI run; the browser renders sphere layers, city nodes, and moving flow particles with a HUD.
- Simulation can run in a Web Worker (`web/simWorker.js`) to decouple render and simulation loops.

## MCP Server

```bash
npm run start:mcp
```

This starts a stdio MCP server (`scripts/mcpServer.js`) that exposes tools to inspect and advance the simulation world:

- `sphere_world_summary`
- `sphere_tick`
- `sphere_get_city`
- `sphere_list_companies`
- `sphere_list_secret_societies`
- `sphere_rank_public_services`
- `sphere_hud_snapshot`
- `sphere_reset`

### MCP Client Config

Use [mcp.config.example.json](/home/hacker/Project/sphere/mcp.config.example.json) as a template in your MCP client.

Core settings:

- `command`: `npm`
- `args`: `["run", "start:mcp"]`
- `cwd`: `/home/hacker/Project/sphere`

### Codex

Project-local Codex config is included at [`.codex/config.toml`](/home/hacker/Project/sphere/.codex/config.toml).
From this project directory, run:

```bash
codex mcp list
```

You should see `sphere-world` in the list.

## Quick Start (Recommended)

```bash
npm install
npm run dev:all
```

Default endpoints:

- Web: `http://127.0.0.1:5174`
- State API: `http://127.0.0.1:5180`

## Safe Defaults

This project is **local-only by default**.

- `start:web` refuses non-loopback hosts unless explicitly overridden.
- `start:mcp` (State API) refuses non-loopback hosts unless explicitly overridden.

To intentionally expose beyond localhost (unsafe), set:

```bash
SPHERE_ALLOW_UNSAFE_EXPOSE=1
```

And then pass explicit hosts/ports as needed.

Tool calls are audit-logged to:

- `web/tool_audit.log`

## Scenario Regression

```bash
npm run test:scenarios
```

This runs deterministic policy scenarios against city dynamics to catch behavioral regressions.

## Current Scope

This is a **Phase 2 foundation**, not full WebGL rendering yet. It establishes core simulation outputs (`flows`, `particles`, `people`) so a WebGL/Three.js front-end can be attached without changing core logic.

## Recommended Next Build Step

- Add a browser renderer (Three.js) that draws:
  - sphere layers
  - city nodes
  - animated edge flow particles
- Move simulation loop to a Web Worker for stable frame rates.
