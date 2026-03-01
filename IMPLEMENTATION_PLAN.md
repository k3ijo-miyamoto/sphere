# Implementation Plan

This plan extends the current Phase 1 scaffold toward the full vision in `Project Overview.md`.

## Phase 1 (Now)

- Simulation tick loop and day phase scheduler.
- Layered sphere world model (layers, cities, edges).
- City economic/societal metrics.
- Commuting flow estimation and rendering payload generation.

## Phase 2 (Implemented)

- Add individual `Person` entities with:
  - identity and age
  - traits (personality + ability)
  - daily state machine (`Home | Commute | Work | Leisure | Sleep`)
- Add hybrid model bridge:
  - statistical population per city
  - sampled active individuals near focus zones
- Add nightlife movement and social encounter scoring.

Status notes:
- Core `Person` model is implemented.
- Tick-level state transitions are implemented.
- Night encounter summary is implemented for `Night` phase.
- Active individual sampling from focus cities is implemented.

## Phase 3

- Add relationship system:
  - partner matching
  - marriage eligibility and probability
- Add reproduction system:
  - child limit per family
  - birth probability gate
- Add genetics pipeline:
  - trait inheritance (parent average + mutation)
  - environment influence by city conditions.

## Phase 4

- Add religion dynamics:
  - city composition ratios
  - migration preference by compatibility
  - family inheritance and low-rate conversion
- Add society feedback loop:
  - trust/safety/inequality/congestion update functions
  - instability signals impacting migration and birth.

## Phase 5

- Add generation turnover and multi-decade accelerated mode.
- Add urban rise/decline metrics and trend detection.
- Tune parameters to produce repeatable emergent outcomes.

## Cross-Cutting Engineering

- Move simulation to Web Worker.
- Add Three.js renderer for sphere layers, cities, and flow particles.
- Add snapshot save/load and deterministic seed replay.
- Add scenario tests for regression:
  - high inequality city
  - religiously split region
  - high congestion corridor.
