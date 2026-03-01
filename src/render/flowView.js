export function buildFlowParticles(world, flows, particleScale = 0.1) {
  const particles = [];

  for (const flow of flows) {
    const from = world.getCityById(flow.fromCityId);
    const to = world.getCityById(flow.toCityId);

    particles.push(
      createParticle(flow.edgeId, from, to, flow.outbound, particleScale),
      createParticle(flow.edgeId, to, from, flow.inbound, particleScale)
    );
  }

  return particles;
}

function createParticle(edgeId, sourceCity, targetCity, volume, particleScale) {
  return {
    edgeId,
    sourceCityId: sourceCity.id,
    targetCityId: targetCity.id,
    sourceGeo: sourceCity.geo,
    targetGeo: targetCity.geo,
    volume,
    particleCount: Math.max(1, Math.floor(volume * particleScale)),
    congestionHint: targetCity.metrics.congestion
  };
}
