import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { createSampleWorld } from "../src/world/model.js";
import { SimulationEngine } from "../src/sim/engine.js";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    steps: 220,
    minWeight: 0,
    output: "web/social_network_data.json",
    outputJs: "web/social_network_data.js",
    companyId: null,
    companyName: null,
    cityId: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--steps" && v) {
      out.steps = Number.parseInt(v, 10);
      i += 1;
    } else if (a === "--min-weight" && v) {
      out.minWeight = Number.parseFloat(v);
      i += 1;
    } else if (a === "--output" && v) {
      out.output = v;
      i += 1;
    } else if (a === "--output-js" && v) {
      out.outputJs = v;
      i += 1;
    } else if (a === "--company-id" && v) {
      out.companyId = v;
      i += 1;
    } else if (a === "--company-name" && v) {
      out.companyName = v;
      i += 1;
    } else if (a === "--city-id" && v) {
      out.cityId = v;
      i += 1;
    }
  }
  return out;
}

function buildNetworkView({ frame, world, company, minWeight }) {
  const network = frame.people?.socialNetwork ?? { summary: { nodes: 0, edges: 0, averageTieWeight: 0 }, nodes: [], edges: [] };
  const nodes = (network.nodes ?? []).filter((n) => String(n.employerId ?? "") === String(company.id));
  const nodeSet = new Set(nodes.map((n) => n.id));
  const edges = (network.edges ?? [])
    .filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to) && (e.weight ?? 0) >= minWeight)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const topConnectors = nodes
    .slice()
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0) || (b.degree ?? 0) - (a.degree ?? 0))
    .slice(0, 20);

  const city = world.getCityById(company.cityId);
  const nation = city ? world.getNationById(city.nationId) : null;

  return {
    frame: {
      time: frame.time,
      phase: frame.phase
    },
    company: {
      id: company.id,
      name: company.name,
      sector: company.sector,
      city: city?.name ?? company.cityId,
      nation: nation?.name ?? null,
      capital: Number((company.capital ?? 0).toFixed(4)),
      profit: Number((company.profit ?? 0).toFixed(4)),
      stockPrice: Number((company.stockPrice ?? 0).toFixed(4))
    },
    network: {
      members: nodes.length,
      internalEdges: edges.length,
      avgInternalWeight: Number((edges.reduce((sum, e) => sum + (e.weight ?? 0), 0) / Math.max(1, edges.length)).toFixed(3)),
      topConnectors,
      strongestEdges: edges.slice(0, 60).map((e) => ({
        from: e.from,
        fromName: byId.get(e.from)?.name ?? String(e.from),
        to: e.to,
        toName: byId.get(e.to)?.name ?? String(e.to),
        weight: e.weight
      })),
      nodes,
      edges: edges.map((e) => ({
        from: e.from,
        to: e.to,
        weight: e.weight
      }))
    }
  };
}

function pickCompany(companies, opts) {
  let rows = companies.slice();
  if (opts.cityId) {
    rows = rows.filter((c) => c.cityId === opts.cityId);
  }
  if (opts.companyId) {
    rows = rows.filter((c) => String(c.id) === String(opts.companyId));
  }
  if (opts.companyName) {
    const q = opts.companyName.toLowerCase();
    rows = rows.filter((c) => c.name.toLowerCase().includes(q));
  }
  if (rows.length === 0) {
    return null;
  }
  return rows.sort((a, b) => (b.capital ?? 0) - (a.capital ?? 0))[0];
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const world = createSampleWorld(DEFAULT_CONFIG.seed);
  const engine = new SimulationEngine({ world, config: DEFAULT_CONFIG });
  let frame = engine.tick();
  const steps = Math.max(1, Number.isFinite(opts.steps) ? opts.steps : 220);
  for (let i = 1; i < steps; i += 1) {
    frame = engine.tick();
  }

  const company = pickCompany(engine.population.companies ?? [], opts);
  if (!company) {
    throw new Error("No matching company found.");
  }

  const data = buildNetworkView({
    frame,
    world,
    company,
    minWeight: Number.isFinite(opts.minWeight) ? opts.minWeight : 0
  });

  const outPath = path.resolve(process.cwd(), opts.output);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
  const outJsPath = path.resolve(process.cwd(), opts.outputJs);
  fs.writeFileSync(outJsPath, `window.__SOCIAL_NETWORK_DATA__ = ${JSON.stringify(data, null, 2)};\n`, "utf8");
  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(`Wrote ${outJsPath}\n`);
}

main();
