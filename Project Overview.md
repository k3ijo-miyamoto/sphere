Project Overview

This project simulates a multi-layer spherical world where human civilization emerges, evolves, and reorganizes through daily life, migration, family formation, genetics, religion, economics, and social dynamics.

The system visualizes civilization dynamics in real time using a 3D spherical layered world rendered in WebGL.

The experience should feel alive, organic, and emergent.

Core Vision

The simulation is NOT a game.

It is a living civilization model that allows observation of:

population flow

urban evolution

cultural formation

inequality & social structure

religious cohesion & division

family lineage & genetic inheritance

daily life rhythms

generational change

The world should feel like a living organism.

World Structure
Multi-layer Sphere Model

The world consists of nested spherical layers.

Each layer may represent:

economic strata

access level

civilization stage

environmental conditions

governance structure

Layer transitions may be restricted via gateways.

Time System

The simulation runs on continuous time with daily cycles.

Daily Cycle Phases

Morning:

commuting increases

work activity rises

Daytime:

production & social interaction peak

Evening:

commuting returns

Night:

leisure & social encounters increase

crime risk may increase

marriage encounters increase

Weekly cycle (optional future):

weekends increase social & religious gatherings

Population Model
Hybrid Population System

The simulation uses two population layers:

Statistical Population (for large-scale simulation)

Individual Persons (tracked with identity & genetics)

Only nearby individuals are rendered in detail.

Person Model

Each Person has:

Identity

id

name

age

sex (optional)

religion

homeCityId

workCityId

State

currentState: Home | Commute | Work | Leisure | Sleep

energy / fatigue

Personality Traits (Behavior Genes)

Values 0..1:

riskTolerance

sociability

conformity

familyOriented

openness

discipline

noveltySeeking

patience

Ability Traits (Ability Genes)

Values 0..1:

cognitive

productivity

charisma

health

stressResilience

creativity

attention

Socioeconomic

wealth

skill (learned ability)

education level

Relationships

partnerId

parents

childrenIds

Genetics & Inheritance

Children inherit traits using:

childGene = average(parentA, parentB) + small mutation

Mutation range:

personality genes: higher variation

ability genes: lower variation

Traits are influenced by environment during upbringing.

trait = gene + environmental influence

Family & Reproduction

Marriage probability increases via:

social interaction

nightlife encounters

shared religion or openness

compatible traits

economic stability

Birth probability depends on:

wealth

safety

familyOriented trait

city stability

Each family has a child limit to prevent exponential growth.

Religion System

Religion influences:

social cohesion

migration preference

marriage matching

cultural clustering

Cities maintain religious composition ratios.

Religion spreads via:

migration

family inheritance

social conversion (low probability)

Economy System

Cities have:

productivity

wage level

cost of living

inequality index

employment capacity

Individual income:

income = wage × productivityTrait × skill

Skill grows through:

skill growth = cognitive × education × experience

Society System

Cities maintain:

trust

safety

inequality

congestion

Safety decreases with:

inequality

overpopulation

instability

Trust increases with:

stability

cooperation

social cohesion

Migration & Flow

Population movement occurs through:

commuting

relocation

nightlife movement

economic migration

Movement probability depends on:

expected utility

congestion

safety

religion compatibility

personal traits

Flow is visualized along edges between cities.

Daily Movement Types
Commuting

Morning: residential → work hubs
Evening: reverse

Nightlife Movement

Night: flow toward entertainment hubs
Late night: return flow

Rendering & Visualization
Levels of Detail (LOD)

Far view:

city nodes

population scale

flow particles

Mid view:

activity density particles

Near view:

named individuals (simplified silhouettes)

Human Rendering

Humans are displayed as simplified silhouettes.

Far:

particle representation

Near:

billboard silhouettes

Close:

low-poly silhouette figures

Flow Visualization

Population movement is visualized using:

moving particles along edges

density representing flow volume

direction representing movement

congestion represented by clustering & slowdown

Emergent Behavior Goals

The simulation should allow:

economic hubs to emerge

religious clustering & cultural borders

inequality-driven instability

generational trait evolution

family lineage growth

urban rise & decline

social stratification

cultural fusion & division

Performance Constraints

The simulation must support:

thousands of tracked individuals

statistical population scaling

instanced rendering for large flows

LOD-based detail switching

Design Principles

Emergence over scripting

Simple rules → complex outcomes

No hard-coded narratives

Systems must influence each other

Environment shapes individuals

Individuals shape civilization

Generations reshape the world

Implementation Priority
Phase 1

spherical world & layers

city nodes & edges

commuting flow visualization

Phase 2

individual persons with traits

day/night cycle behavior

nightlife & social encounters

Phase 3

marriage & family

genetics & inheritance

Phase 4

religion & cultural clustering

inequality & social stability

Phase 5

generational evolution

emergent urban dynamics

Non-Goals (Important)

Not a combat simulation

Not a deterministic economic model

Not a rigid strategy game

This is an emergent civilization simulation.

Future Extensions

policy & governance systems

education & mobility

epidemics & resilience

climate & environmental pressure

cultural evolution

historical timeline replay

Specification Update (Reflected From Current Implementation)

Date: 2026-03-01

The items below are implemented and are now part of the active system specification.

Drift Summary (Original -> Current)

1) Governance was a future extension -> now implemented as active systems.
2) Geopolitics was out of scope -> now implemented as macro-level interstate dynamics.
3) Economy was simple city/person loop -> now includes currency, banking, resource market, and company finance loops.
4) Social systems were centered on family/religion -> now also include public institutions and service staffing dynamics.
5) Simulation analysis was local/manual -> now includes MCP tools, state API, report scripts, and snapshot workflows.

Implemented Extensions (Now in Spec)

Geopolitics Layer

- Nations have diplomacy state (peace/alliance/crisis/war) with tension dynamics.
- War/crisis can trigger sanctions, ceasefire, and territorial shifts.
- Nation lifecycle events are tracked (founding, territorial shift, extinction).
- Military companies and secret societies exist as non-state strategic actors.

Meta-Order Layer (5-level governance stack)

- world_system
- civilization_blocs
- institutional_zones
- nation_city_governance
- hegemonic_networks

Blocs, institutional zones, and hegemonic networks are updated in simulation runtime.

Policy and Learning Layer

- RL policies are used in multiple domains (company, diplomacy, resource, investment, institution).
- City Policy Genome is implemented and evolves by mutation/inheritance with fitness feedback.

Macro and Resource Layer

- Resource market pricing and scarcity feedback are active.
- Currency regime (FX/inflation/policy-rate) is active.
- Banking layer is active (deposits/loans/net state).
- Epidemic/climate/culture drifts are implemented as macro pressures.

Institutional/Social Layer

- Public service staffing and cooperation index are modeled per city.
- Education system has policy levers and outcomes by stage.

Observability and Tooling

- MCP server exposes world/state tools for analysis.
- State API provides bootstrap/summary/tick/reset/snapshot endpoints.
- Scenario and report scripts support reproducible comparative analysis.

Clarified Non-Goal Boundary

The system still does not aim for tactical combat simulation.
However, limited macro-geopolitical conflict (status transition and territorial shift) is included as emergent civilization dynamics.

Runtime Profiles

To support both the original minimal framing and expanded simulation:

- default profile: expanded systems enabled (current mainline behavior)
- overview profile: closer to original Project Overview scope
