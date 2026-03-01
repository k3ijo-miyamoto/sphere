---
name: sphere-devall-control
description: Start, restart, and verify Sphere local runtime with npm run dev:all (web + MCP state API). Use when user asks to launch, relaunch, or recover the local simulation servers.
---

# Sphere DevAll Control

Use this skill to operate the local runtime quickly and consistently.

## Start

```bash
npm run dev:all
```

## Restart (Clean)

```bash
pkill -f 'node scripts/devAll.js' || true
pkill -f 'node scripts/mcpServer.js' || true
npm run dev:all
```

## Verify Runtime

Check process:

```bash
ps -ef | rg 'scripts/devAll.js|scripts/mcpServer.js' | rg -v rg
```

Check state API health:

```bash
curl -sS http://127.0.0.1:5180/health
```

Expected: JSON response with `ok: true`.

## Optional Reset Before Restart

When user requests Day 0 reset, stop processes and remove persisted snapshot:

```bash
pkill -f 'node scripts/devAll.js' || true
pkill -f 'node scripts/mcpServer.js' || true
rm -f web/mcp_snapshot.json
npm run dev:all
```

If browser still restores old state, clear localStorage key `sphere_snapshot` in DevTools.
