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