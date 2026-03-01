export function computeCommuteFlows(world, phaseName, config, weekCtx = { dayOfWeek: 0, isWeekend: false }) {
  const phaseWeight = config.phaseWeights[phaseName] ?? config.phaseWeights.Daytime;

  return world.edges.map((edge) => {
    const fromCity = world.getCityById(edge.fromCityId);
    const toCity = world.getCityById(edge.toCityId);

    const outbound = estimateDirectionalFlow(fromCity, toCity, edge, phaseWeight, config, weekCtx);
    const inbound = estimateDirectionalFlow(toCity, fromCity, edge, phaseWeight, config, weekCtx);

    return {
      edgeId: edge.id,
      fromCityId: edge.fromCityId,
      toCityId: edge.toCityId,
      gatewayRestriction: edge.gatewayRestriction,
      outbound,
      inbound,
      net: outbound - inbound
    };
  });
}

function estimateDirectionalFlow(origin, target, edge, phaseWeight, config, weekCtx) {
  if (!origin || !target) {
    return 0;
  }
  if (edge.gatewayRestriction === "sealed") {
    return 0;
  }
  const originType = config.cityTypes[origin.cityType] ?? config.cityTypes.mixed;
  const targetType = config.cityTypes[target.cityType] ?? config.cityTypes.mixed;

  const commuteBias = originType.commuteOutBias * targetType.commuteInBias;
  const econAttraction = clamp(
    (target.metrics.wageLevel * target.metrics.productivity) /
      Math.max(0.1, target.metrics.costOfLiving),
    0.3,
    2.0
  );
  const congestionPenalty = 1 - target.metrics.congestion * 0.6;
  const safetyPenalty = 0.6 + target.metrics.safety * 0.4;

  const activeCommuters = origin.population * 0.08;
  const permitPenalty = edge.gatewayRestriction === "permit" ? 0.68 : 1;
  const weekendBoost =
    config.weekly?.enabled && weekCtx?.isWeekend && phaseWeight.nightlife > 0.6
      ? config.weekly?.weekendNightlifeBoost ?? 1
      : 1;
  const flow =
    activeCommuters *
    edge.connectivity *
    phaseWeight.commute *
    commuteBias *
    econAttraction *
    congestionPenalty *
    safetyPenalty *
    permitPenalty *
    weekendBoost;

  return Math.max(0, Math.floor(flow));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
