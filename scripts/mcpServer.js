import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { SimulationEngine } from "../src/sim/engine.js";
import { createSampleWorld } from "../src/world/model.js";

const SERVER_INFO = { name: "sphere-world-mcp", version: "0.1.0" };
const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_MCP_SNAPSHOT_PATH = path.resolve(process.cwd(), "web/mcp_snapshot.json");
const STATE_API_PORT = Number(process.env.SPHERE_STATE_API_PORT ?? 5180);
const STATE_API_HOST = process.env.SPHERE_STATE_API_HOST ?? "127.0.0.1";
const allowUnsafeExpose = String(process.env.SPHERE_ALLOW_UNSAFE_EXPOSE ?? "").trim() === "1";
const TOOL_AUDIT_LOG_PATH = path.resolve(process.cwd(), "web/tool_audit.log");

enforceLocalOnlyHost({ host: STATE_API_HOST, name: "state_api", allowUnsafeExpose });

let config = clone(DEFAULT_CONFIG);
let world = createSampleWorld(config.seed);
let engine = new SimulationEngine({ world, config });
let frame = engine.tick();
loadPersistedSnapshot();

const tools = [
  {
    name: "sphere_world_summary",
    description: "Get compact summary of current simulation world and latest frame.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "sphere_tick",
    description: "Advance simulation by N ticks and return updated summary.",
    inputSchema: {
      type: "object",
      properties: {
        steps: { type: "integer", minimum: 1, maximum: 1440, default: 1 }
      }
    }
  },
  {
    name: "sphere_get_city",
    description: "Get city details by city id (e.g., C1) or city name (e.g., Helio).",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City ID or name." }
      },
      required: ["city"]
    }
  },
  {
    name: "sphere_list_companies",
    description: "List top companies globally or for one city.",
    inputSchema: {
      type: "object",
      properties: {
        cityId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }
      }
    }
  },
  {
    name: "sphere_list_secret_societies",
    description: "List active secret societies globally or by nation/city.",
    inputSchema: {
      type: "object",
      properties: {
        nationId: { type: "string" },
        cityId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }
      }
    }
  },
  {
    name: "sphere_nation_history",
    description: "Get nation lifecycle history (founding / territorial shifts / extinction).",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["all", "nation_founded", "territory_shift", "nation_extinct"],
          default: "all"
        },
        nationId: { type: "string", description: "Optional nation id filter." },
        sinceDay: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 }
      }
    }
  },
  {
    name: "sphere_rank_public_services",
    description: "Rank cities by public service staffing fulfillment (administration/police/judiciary).",
    inputSchema: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Optional branch filter: administration | police | judiciary"
        },
        cityId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 }
      }
    }
  },
  {
    name: "sphere_hud_snapshot",
    description: "Get HUD-like snapshot (time/flows/religion/economy/geopolitics/events/population boards).",
    inputSchema: {
      type: "object",
      properties: {
        maxEvents: { type: "integer", minimum: 1, maximum: 20, default: 6 },
        maxCities: { type: "integer", minimum: 1, maximum: 20, default: 5 },
        lineageLines: { type: "integer", minimum: 1, maximum: 40, default: 8 },
        includeBoards: { type: "boolean", default: true },
        eventTypes: {
          type: "array",
          description: "Optional event type filter (e.g., nation_founded, war, territory_shift).",
          items: { type: "string" },
          maxItems: 10
        }
      }
    }
  },
  {
    name: "sphere_resource_status",
    description: "Get resource market, nation-level, and city-level resource status snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        nationId: { type: "string", description: "Optional nation filter (e.g., N1)." },
        cityId: { type: "string", description: "Optional city filter (e.g., C1)." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
        sort: {
          type: "string",
          description: "Sort cities by: weakest | strongest | scarcity",
          enum: ["weakest", "strongest", "scarcity"]
        }
      }
    }
  },
  {
    name: "sphere_company_financials",
    description: "Get company financials (P/L + pseudo B/S) by company id/name, or top companies.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string", description: "Exact company id." },
        companyName: { type: "string", description: "Partial or exact company name." },
        cityId: { type: "string", description: "Optional city filter when listing tops." },
        sortBy: {
          type: "string",
          description: "Sort key for top mode: revenue | profit | marketShare | stock | capital",
          enum: ["revenue", "profit", "marketShare", "stock", "capital"]
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 5 }
      }
    }
  },
  {
    name: "sphere_social_network",
    description: "Get human social network graph (especially coworker ties) for visualization.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string", description: "Filter by company id (coworker network focus)." },
        cityId: { type: "string", description: "Filter by city id." },
        minWeight: { type: "number", minimum: 0, maximum: 1, default: 0.08 },
        limitNodes: { type: "integer", minimum: 10, maximum: 500, default: 120 },
        limitEdges: { type: "integer", minimum: 10, maximum: 1000, default: 240 }
      }
    }
  },
  {
    name: "sphere_person_profile",
    description: "Get a person profile (assets/job/family/network/genetic potential) by id or name.",
    inputSchema: {
      type: "object",
      properties: {
        personId: { type: "integer", minimum: 1, description: "Tracked person id." },
        personName: { type: "string", description: "Full or partial name." },
        tiesLimit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        holdingsLimit: { type: "integer", minimum: 1, maximum: 20, default: 8 }
      }
    }
  },
  {
    name: "sphere_person_compare",
    description: "Compare two people by assets, work, genetics, and social metrics.",
    inputSchema: {
      type: "object",
      properties: {
        personAId: { type: "integer", minimum: 1 },
        personAName: { type: "string" },
        personBId: { type: "integer", minimum: 1 },
        personBName: { type: "string" },
        tiesLimit: { type: "integer", minimum: 1, maximum: 50, default: 8 },
        holdingsLimit: { type: "integer", minimum: 1, maximum: 20, default: 6 }
      }
    }
  },
  {
    name: "sphere_reset",
    description: "Reset simulation world with optional seed and tracked population size.",
    inputSchema: {
      type: "object",
      properties: {
        seed: { type: "integer" },
        trackedPopulation: { type: "integer", minimum: 100, maximum: 100000 }
      }
    }
  },
  {
    name: "sphere_export_snapshot",
    description: "Export current MCP simulation snapshot to a file.",
    inputSchema: {
      type: "object",
      properties: {
        outputPath: { type: "string", description: "Optional output file path." }
      }
    }
  },
  {
    name: "sphere_stratification_report",
    description: "Report current social stratification metrics from active MCP world state.",
    inputSchema: {
      type: "object",
      properties: {
        compareFrom: { type: "integer", minimum: 0, default: 0 }
      }
    }
  },
  {
    name: "sphere_geopolitics_report",
    description: "Report current interstate tension metrics from active MCP world state.",
    inputSchema: {
      type: "object",
      properties: {
        compareFrom: { type: "integer", minimum: 0, default: 0 },
        top: { type: "integer", minimum: 1, maximum: 20, default: 5 }
      }
    }
  },
  {
    name: "sphere_meta_order_report",
    description: "Report 5-layer governance stack: world system, blocs, institutional zones, nation/city, hegemonic networks.",
    inputSchema: {
      type: "object",
      properties: {
        top: { type: "integer", minimum: 1, maximum: 20, default: 5 }
      }
    }
  },
  {
    name: "sphere_rl_report",
    description: "Report RL policy/Q-value states across company, diplomacy, resource, and investment domains.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          enum: ["all", "company", "diplomacy", "resource", "investment"],
          default: "all"
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 }
      }
    }
  },
  {
    name: "sphere_institution_stability_report",
    description: "Report long-term institutional stability and meta-governance self-modification state.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

const toolHandlers = {
  sphere_world_summary: () => worldSummary(),
  sphere_tick: (args) => {
    const steps = clampInt(args.steps ?? 1, 1, 1440);
    for (let i = 0; i < steps; i += 1) {
      frame = engine.tick();
    }
    persistSnapshot();
    return { steps, ...worldSummary() };
  },
  sphere_get_city: (args) => {
    const query = String(args.city ?? "").trim();
    if (!query) {
      throw new Error("city is required");
    }
    const city = findCity(query);
    if (!city) {
      throw new Error(`city not found: ${query}`);
    }
    const presence = frame.people?.cityPresence?.[city.id] ?? 0;
    const populationEstimate = frame.people?.statisticalPopulation?.[city.id] ?? null;
    const religion = frame.people?.religionByCity?.[city.id] ?? [];
    const byCity = frame.people?.economy?.byCity ?? [];
    const econ = byCity.find((item) => item.cityId === city.id) ?? null;
    const institution = frame.people?.institutions?.byCity?.[city.id] ?? null;
    return {
      city,
      live: {
        presence,
        estimatedPopulation: populationEstimate,
        religion,
        economy: econ,
        institution
      }
    };
  },
  sphere_list_companies: (args) => {
    const limit = clampInt(args.limit ?? 10, 1, 50);
    const companyView = frame.people?.companies ?? {};
    if (args.cityId) {
      const cityId = String(args.cityId);
      const rows = (companyView.byCity ?? []).find((item) => item.cityId === cityId);
      return {
        cityId,
        total: rows?.count ?? 0,
        companies: (rows?.top ?? []).slice(0, limit)
      };
    }
    return {
      total: companyView.totalCompanies ?? 0,
      companies: (companyView.topCompanies ?? []).slice(0, limit)
    };
  },
  sphere_list_secret_societies: (args) => {
    const limit = clampInt(args.limit ?? 10, 1, 50);
    let rows = (frame.geopolitics?.secretSocieties ?? []).slice();
    if (args.nationId) {
      const nationId = String(args.nationId);
      rows = rows.filter((item) => item.nationId === nationId);
    }
    if (args.cityId) {
      const cityId = String(args.cityId);
      rows = rows.filter((item) => item.cityId === cityId);
    }
    rows.sort((a, b) => b.influence - a.influence || b.members - a.members);
    return {
      total: rows.length,
      secretSocieties: rows.slice(0, limit)
    };
  },
  sphere_nation_history: (args) => {
    const typeRaw = String(args.type ?? "all").trim().toLowerCase();
    const type = ["all", "nation_founded", "territory_shift", "nation_extinct"].includes(typeRaw) ? typeRaw : "all";
    const nationId = args.nationId ? String(args.nationId) : null;
    const sinceDay = clampInt(args.sinceDay ?? 0, 0, 1000000);
    const limit = clampInt(args.limit ?? 50, 1, 500);
    return buildNationHistory({ world, type, nationId, sinceDay, limit });
  },
  sphere_rank_public_services: (args) => {
    const limit = clampInt(args.limit ?? 10, 1, 100);
    const cityFilter = args.cityId ? String(args.cityId) : null;
    const branchRaw = args.branch ? String(args.branch).trim().toLowerCase() : null;
    const branch = branchRaw && ["administration", "police", "judiciary"].includes(branchRaw) ? branchRaw : null;
    const rows = buildPublicServiceRanking({ frame, world, cityFilter, branch });
    return {
      branch: branch ?? "all",
      total: rows.length,
      rankings: rows.slice(0, limit)
    };
  },
  sphere_hud_snapshot: (args) => {
    const maxEvents = clampInt(args.maxEvents ?? 6, 1, 20);
    const maxCities = clampInt(args.maxCities ?? 5, 1, 20);
    const lineageLines = clampInt(args.lineageLines ?? 8, 1, 40);
    const includeBoards = args.includeBoards !== false;
    const eventTypes = normalizeEventTypes(args.eventTypes);
    return buildHudSnapshot({ frame, world, maxEvents, maxCities, lineageLines, includeBoards, eventTypes });
  },
  sphere_resource_status: (args) => {
    const limit = clampInt(args.limit ?? 10, 1, 100);
    const nationId = args.nationId ? String(args.nationId) : null;
    const cityId = args.cityId ? String(args.cityId) : null;
    const sortRaw = String(args.sort ?? "weakest").trim().toLowerCase();
    const sort = ["weakest", "strongest", "scarcity"].includes(sortRaw) ? sortRaw : "weakest";
    return buildResourceStatus({ world, frame, limit, nationId, cityId, sort });
  },
  sphere_company_financials: (args) => {
    const companyId = args.companyId ? String(args.companyId) : null;
    const companyName = args.companyName ? String(args.companyName).trim() : null;
    const cityId = args.cityId ? String(args.cityId) : null;
    const sortRaw = String(args.sortBy ?? "revenue").trim();
    const sortBy = ["revenue", "profit", "marketShare", "stock", "capital"].includes(sortRaw) ? sortRaw : "revenue";
    const limit = clampInt(args.limit ?? 5, 1, 50);
    return buildCompanyFinancials({ world, frame, engine, companyId, companyName, cityId, sortBy, limit });
  },
  sphere_social_network: (args) => {
    const companyId = args.companyId ? String(args.companyId) : null;
    const cityId = args.cityId ? String(args.cityId) : null;
    const minWeight = Number.isFinite(args.minWeight) ? Math.max(0, Math.min(1, Number(args.minWeight))) : 0.08;
    const limitNodes = clampInt(args.limitNodes ?? 120, 10, 500);
    const limitEdges = clampInt(args.limitEdges ?? 240, 10, 1000);
    return buildSocialNetworkView({ frame, world, companyId, cityId, minWeight, limitNodes, limitEdges });
  },
  sphere_person_profile: (args) => {
    const personId = Number.isFinite(args.personId) ? Number(args.personId) : null;
    const personName = args.personName ? String(args.personName).trim() : null;
    const tiesLimit = clampInt(args.tiesLimit ?? 10, 1, 50);
    const holdingsLimit = clampInt(args.holdingsLimit ?? 8, 1, 20);
    return buildPersonProfile({ frame, world, engine, personId, personName, tiesLimit, holdingsLimit });
  },
  sphere_person_compare: (args) => {
    const personAId = Number.isFinite(args.personAId) ? Number(args.personAId) : null;
    const personAName = args.personAName ? String(args.personAName).trim() : null;
    const personBId = Number.isFinite(args.personBId) ? Number(args.personBId) : null;
    const personBName = args.personBName ? String(args.personBName).trim() : null;
    const tiesLimit = clampInt(args.tiesLimit ?? 8, 1, 50);
    const holdingsLimit = clampInt(args.holdingsLimit ?? 6, 1, 20);
    return buildPersonCompare({
      frame,
      world,
      engine,
      personAId,
      personAName,
      personBId,
      personBName,
      tiesLimit,
      holdingsLimit
    });
  },
  sphere_reset: (args) => {
    const next = clone(DEFAULT_CONFIG);
    if (Number.isFinite(args.seed)) {
      next.seed = args.seed;
    }
    if (Number.isFinite(args.trackedPopulation)) {
      next.population = { ...next.population, trackedIndividuals: clampInt(args.trackedPopulation, 100, 100000) };
      const detail = Math.max(20, Math.min(300, Math.floor(next.population.trackedIndividuals * 0.08)));
      next.population.activeDetailCount = detail;
    }
    config = next;
    world = createSampleWorld(config.seed);
    engine = new SimulationEngine({ world, config });
    frame = engine.tick();
    persistSnapshot();
    return worldSummary();
  },
  sphere_export_snapshot: (args) => {
    const target = args.outputPath ? resolveSnapshotPath(String(args.outputPath)) : DEFAULT_MCP_SNAPSHOT_PATH;
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, JSON.stringify(engine.exportSnapshot()), "utf8");
    return {
      ok: true,
      outputPath: target,
      frame: {
        time: frame.time,
        phase: frame.phase,
        history: formatHistory(frame)
      }
    };
  },
  sphere_stratification_report: (args) => {
    const compareFrom = clampInt(args.compareFrom ?? 0, 0, 1000000);
    return buildStratificationReport({ frame, engine, compareFrom });
  },
  sphere_geopolitics_report: (args) => {
    const compareFrom = clampInt(args.compareFrom ?? 0, 0, 1000000);
    const top = clampInt(args.top ?? 5, 1, 20);
    return buildGeopoliticsReport({ frame, compareFrom, top });
  },
  sphere_meta_order_report: (args) => {
    const top = clampInt(args.top ?? 5, 1, 20);
    return buildMetaOrderReport({ frame, world, top });
  },
  sphere_rl_report: (args) => {
    const domainRaw = String(args.domain ?? "all").trim().toLowerCase();
    const domain = ["all", "company", "diplomacy", "resource", "investment"].includes(domainRaw) ? domainRaw : "all";
    const limit = clampInt(args.limit ?? 10, 1, 100);
    return buildRlReport({ frame, world, engine, domain, limit });
  },
  sphere_institution_stability_report: () => {
    return buildInstitutionStabilityReport({ frame, world });
  }
};

setupMcpStdio();
startStateApi();

let readBuffer = Buffer.alloc(0);

function onData(chunk) {
  readBuffer = Buffer.concat([readBuffer, chunk]);
  while (true) {
    const headerEnd = readBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }
    const header = readBuffer.slice(0, headerEnd).toString("utf8");
    const contentLength = parseContentLength(header);
    if (contentLength == null) {
      writeError(null, -32700, "Missing Content-Length header");
      readBuffer = Buffer.alloc(0);
      return;
    }
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (readBuffer.length < messageEnd) {
      return;
    }
    const body = readBuffer.slice(messageStart, messageEnd).toString("utf8");
    readBuffer = readBuffer.slice(messageEnd);
    handleMessage(body);
  }
}

function setupMcpStdio() {
  // When launched under nohup/background, stdin can be an invalid FD (EBADF).
  // Keep State API alive even if MCP stdio transport is unavailable.
  try {
    process.stdin.on("data", onData);
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("error", (error) => {
      const code = error?.code ?? "unknown";
      if (code === "EBADF") {
        console.error("[mcp] stdin unavailable (EBADF): stdio transport disabled, State API stays up");
        return;
      }
      console.error(`[mcp] stdin error: ${error?.message ?? String(error)}`);
    });
    process.stdin.resume();
  } catch (error) {
    console.error(`[mcp] stdio setup skipped: ${error?.message ?? String(error)}`);
  }
}

function parseContentLength(headerText) {
  const lines = headerText.split("\r\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "content-length") {
      const n = Number.parseInt(value, 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
  }
  return null;
}

function handleMessage(rawBody) {
  let msg;
  try {
    msg = JSON.parse(rawBody);
  } catch {
    writeError(null, -32700, "Invalid JSON payload");
    return;
  }

  if (!msg || msg.jsonrpc !== "2.0") {
    writeError(msg?.id ?? null, -32600, "Invalid request");
    return;
  }
  if (typeof msg.method !== "string") {
    writeError(msg.id ?? null, -32600, "Missing method");
    return;
  }

  if (msg.method === "notifications/initialized") {
    return;
  }
  if (msg.method === "initialize") {
    writeResult(msg.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    });
    return;
  }
  if (msg.method === "tools/list") {
    writeResult(msg.id, { tools });
    return;
  }
  if (msg.method === "tools/call") {
    handleToolCall(msg.id, msg.params ?? {});
    return;
  }

  writeError(msg.id ?? null, -32601, `Method not found: ${msg.method}`);
}

function handleToolCall(id, params) {
  const name = params.name;
  const args = params.arguments ?? {};
  const handler = toolHandlers[name];
  if (!handler) {
    writeResult(id, {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true
    });
    return;
  }

  try {
    const data = handler(args);
    appendToolAuditLog({ source: "mcp-stdio", name, ok: true, args });
    writeResult(id, {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data
    });
  } catch (error) {
    appendToolAuditLog({ source: "mcp-stdio", name, ok: false, args, error: error?.message ?? String(error) });
    writeResult(id, {
      content: [{ type: "text", text: `Tool error: ${error.message}` }],
      isError: true
    });
  }
}

function worldSummary() {
  return {
    frame: {
      time: frame.time,
      phase: frame.phase,
      dayOfWeek: frame.dayOfWeek,
      worldVersion: frame.worldVersion
    },
    world: {
      layers: world.layers.length,
      cities: world.cities.length,
      edges: world.edges.length,
      nations: world.nations?.length ?? 0,
      secretSocieties: frame.geopolitics?.secretSocieties?.length ?? 0,
      systemState: frame.system
    },
    people: {
      trackedIndividuals: engine.population.people.length,
      focusCityIds: frame.people?.focusCityIds ?? [],
      stateCounts: frame.people?.stateCounts ?? {}
    },
    economy: {
      avgIncome: frame.people?.economy?.avgIncome ?? 0,
      unemploymentRate: frame.people?.economy?.unemploymentRate ?? 0,
      totalCompanies: frame.people?.companies?.totalCompanies ?? 0
    },
    institutions: {
      cooperationIndex: frame.people?.institutions?.cooperationIndex ?? 0,
      publicServiceTotals: frame.people?.institutions?.publicServiceTotals ?? {},
      mutationCount: frame.people?.institutions?.mutationCount ?? 0,
      policyRevisionCount: frame.people?.institutions?.policyRevisionCount ?? 0
    }
  };
}

function loadPersistedSnapshot() {
  if (!fs.existsSync(DEFAULT_MCP_SNAPSHOT_PATH)) {
    return false;
  }
  try {
    const raw = fs.readFileSync(DEFAULT_MCP_SNAPSHOT_PATH, "utf8");
    const snapshot = JSON.parse(raw);
    engine.importSnapshot(snapshot);
    frame = engine.getHistoryFrame(0) ?? engine.tick();
    return true;
  } catch {
    return false;
  }
}

function persistSnapshot() {
  try {
    const dir = path.dirname(DEFAULT_MCP_SNAPSHOT_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DEFAULT_MCP_SNAPSHOT_PATH, JSON.stringify(engine.exportSnapshot()), "utf8");
    return true;
  } catch {
    return false;
  }
}

function resolveSnapshotPath(rawPath) {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(process.cwd(), rawPath);
}

function buildPublicServiceRanking({ frame, world, cityFilter = null, branch = null }) {
  const cityRows = frame.people?.institutions?.byCity ?? {};
  const stats = frame.people?.statisticalPopulation ?? {};
  const rows = [];
  for (const city of world.cities) {
    if (cityFilter && city.id !== cityFilter) {
      continue;
    }
    const cityInst = cityRows[city.id] ?? {};
    const staffed = cityInst.publicService ?? { administration: 0, police: 0, judiciary: 0 };
    const tracked = stats[city.id]?.tracked ?? 0;
    const workforce = Math.max(1, tracked);
    const targets = {
      administration: Math.max(1, Math.floor(workforce * 0.08)),
      police: Math.max(1, Math.floor(workforce * 0.06)),
      judiciary: Math.max(1, Math.floor(workforce * 0.03))
    };
    const rates = {
      administration: Number((staffed.administration / Math.max(1, targets.administration)).toFixed(3)),
      police: Number((staffed.police / Math.max(1, targets.police)).toFixed(3)),
      judiciary: Number((staffed.judiciary / Math.max(1, targets.judiciary)).toFixed(3))
    };
    const overallFulfillment = Number(
      (((Math.min(1, rates.administration) + Math.min(1, rates.police) + Math.min(1, rates.judiciary)) / 3) * 100).toFixed(1)
    );
    const branchScore = branch ? Number((Math.min(1, rates[branch] ?? 0) * 100).toFixed(1)) : overallFulfillment;
    rows.push({
      cityId: city.id,
      cityName: city.name,
      trackedWorkforce: workforce,
      bestAction: cityInst.bestAction?.key ?? "routine_operations",
      cooperationIndex: cityInst.cooperationIndex ?? 0,
      staffing: {
        administration: { staffed: staffed.administration ?? 0, target: targets.administration, rate: rates.administration },
        police: { staffed: staffed.police ?? 0, target: targets.police, rate: rates.police },
        judiciary: { staffed: staffed.judiciary ?? 0, target: targets.judiciary, rate: rates.judiciary }
      },
      overallFulfillment,
      score: branchScore
    });
  }
  rows.sort((a, b) => b.score - a.score || b.cooperationIndex - a.cooperationIndex || a.cityId.localeCompare(b.cityId));
  return rows;
}

function buildHudSnapshot({ frame, world, maxEvents, maxCities, lineageLines, includeBoards, eventTypes = [] }) {
  const outFlow = (frame.flows ?? []).reduce((sum, row) => sum + (row.outbound ?? 0), 0);
  const inFlow = (frame.flows ?? []).reduce((sum, row) => sum + (row.inbound ?? 0), 0);
  const focusCities = (frame.people?.focusCityIds ?? []).map((id) => world.getCityById(id)?.name ?? id);
  const religionStats = frame.people?.religionStats ?? [];
  const demo = frame.people?.demographics ?? {};
  const economy = frame.people?.economy ?? {};
  const company = frame.people?.companies ?? {};
  const geo = frame.geopolitics ?? {};
  const highlights = frame.people?.highlights ?? {};
  const genetics = frame.people?.geneticsSummary ?? {};
  const lineage = frame.people?.lineage ?? {};
  const allEvents = frame.people?.events ?? [];
  const selectedEvents =
    eventTypes.length > 0
      ? allEvents.filter((e) => eventTypes.includes(String(e?.type ?? "").trim().toLowerCase()))
      : allEvents;

  const topDemoCities = (demo.cityStats ?? [])
    .filter((row) => (row.births ?? 0) > 0 || (row.deaths ?? 0) > 0)
    .sort((a, b) => Math.abs((b.net ?? 0)) - Math.abs((a.net ?? 0)))
    .slice(0, maxCities)
    .map((row) => ({
      cityId: row.cityId,
      city: world.getCityById(row.cityId)?.name ?? row.cityId,
      births: row.births ?? 0,
      deaths: row.deaths ?? 0,
      marriages: row.marriages ?? 0,
      divorces: row.divorces ?? 0,
      net: row.net ?? 0
    }));
  const topCompanyByCity = (company.byCity ?? [])
    .slice()
    .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
    .slice(0, maxCities)
    .map((row) => ({
      cityId: row.cityId,
      city: world.getCityById(row.cityId)?.name ?? row.cityId,
      companies: row.companies ?? 0,
      profit: row.profit ?? 0,
      revenue: row.revenue ?? 0
    }));
  const relationRows = geo.relations ?? [];
  const topDiplomacy = relationRows.slice().sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))[0] ?? null;
  const nationName = new Map((geo.nations ?? []).map((n) => [n.id, n.name]));
  const alliances = relationRows
    .filter((r) => r.status === "alliance")
    .sort((a, b) => (b.relation ?? 0) - (a.relation ?? 0))
    .slice(0, 3)
    .map((r) => ({
      nationA: nationName.get(r.nationAId) ?? r.nationAId,
      nationB: nationName.get(r.nationBId) ?? r.nationBId
    }));
  const hostilities = relationRows
    .filter((r) => r.status === "war" || r.status === "crisis")
    .sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))
    .slice(0, 3)
    .map((r) => ({
      status: r.status,
      nationA: nationName.get(r.nationAId) ?? r.nationAId,
      nationB: nationName.get(r.nationBId) ?? r.nationBId
    }));
  const populationBoard = includeBoards ? buildPopulationBoard(frame, world, maxCities) : null;
  const cityNewsBoard = includeBoards ? buildCityNewsBoard(frame, world, maxEvents, maxCities, selectedEvents) : null;

  return {
    meta: {
      note: "Browser-only runtime metrics (FPS/render/Lod labels) are not included in MCP snapshot."
    },
    frame: {
      time: frame.time,
      phase: frame.phase,
      week: formatWeek(frame.dayOfWeek, frame.isWeekend),
      history: formatHistory(frame)
    },
    flow: { outbound: outFlow, inbound: inFlow },
    people: {
      states: frame.people?.stateCounts ?? {},
      encounters: frame.people?.encounterSummary?.total ?? 0,
      focusCities,
      socialNetwork: frame.people?.socialNetwork?.summary ?? { nodes: 0, edges: 0, averageTieWeight: 0 }
    },
    religion: {
      counts: religionStats.map((row) => ({ religion: row.religion, count: row.count, share: row.share })),
      influence: religionStats.map((row) => ({ religion: row.religion, influence: row.influence })),
      doctrine: religionStats.slice(0, 3).map((row) => ({ religion: row.religion, doctrine: row.doctrine }))
    },
    demographics: {
      totals: {
        births: demo.totalBirths ?? 0,
        deaths: demo.totalDeaths ?? 0,
        marriages: demo.totalMarriages ?? 0,
        divorces: demo.totalDivorces ?? 0,
        cohabiting: demo.currentCohabitingCouples ?? 0,
        couples: demo.currentCouples ?? 0,
        net: (demo.totalBirths ?? 0) - (demo.totalDeaths ?? 0)
      },
      byCity: topDemoCities
    },
    economy: {
      avgIncome: economy.avgIncome ?? 0,
      unemploymentRate: economy.unemploymentRate ?? 0,
      avgWealth: economy.avgWealth ?? 0,
      banking: economy.banking ?? { deposits: 0, debt: 0, net: 0 },
      topCity: (economy.byCity ?? []).slice().sort((a, b) => (b.avgIncome ?? 0) - (a.avgIncome ?? 0))[0]?.cityId ?? null,
      topCompanies: (company.topCompanies ?? []).slice(0, 2).map((c) => ({
        id: c.id,
        name: c.name,
        cityId: c.cityId,
        city: world.getCityById(c.cityId)?.name ?? c.cityId,
        listed: !!c.listed,
        profit: c.profit,
        stock: c.stock
      })),
      byCity: topCompanyByCity
    },
    macroSystem: {
      epidemic: Number((frame.system?.epidemicLevel ?? 0).toFixed(3)),
      climate: Number((frame.system?.climateStress ?? 0).toFixed(3)),
      culture: Number((frame.system?.culturalDrift ?? 0).toFixed(3)),
      market: Number((frame.system?.marketIndex ?? 1).toFixed(3)),
      technology: summarizeTechnologySystem(frame.system?.technology ?? {}, geo.nations ?? []),
      currency: summarizeCurrencySystem(frame.system?.currencies ?? {}, geo.nations ?? [])
    },
    geopolitics: {
      nations: (geo.nations ?? [])
        .slice()
        .sort((a, b) => (b.power ?? 0) - (a.power ?? 0))
        .slice(0, 3),
      diplomacyTop: topDiplomacy,
      alliances,
      hostilities,
      nationEvents: summarizeNationEvents(selectedEvents),
      nationHistoryTail: (geo.nationHistoryTail ?? []).slice(-10),
      governanceStack: (geo.governanceStack ?? []).slice(0, 5),
      blocs: (geo.blocs ?? []).slice(0, 3),
      institutionalZones: (geo.institutionalZones ?? []).slice(0, 3),
      hegemonicNetworks: (geo.hegemonicNetworks ?? []).slice(0, 3),
      militaryCompanies: (geo.militaryCompanies ?? []).slice(0, 2).map((row) => ({
        ...row,
        city: row.cityId ? world.getCityById(row.cityId)?.name ?? row.cityId : null
      }))
    },
    institutions: frame.people?.institutions ?? null,
    events: selectedEvents.slice(0, maxEvents).map((e) => ({ type: e.type, text: e.text })),
    lineage: {
      summary: lineage.summary ?? "-",
      treeLines: (lineage.treeLines ?? []).slice(0, lineageLines)
    },
    highlights: {
      economicPower: toNamedHighlight(highlights.economicPower, world),
      cognitive: toNamedHighlight(highlights.cognitive, world),
      sociability: toNamedHighlight(highlights.sociability, world),
      geneticPotential: toNamedHighlight(genetics.topPotential, world),
      epigeneticShift: toNamedHighlight(genetics.topEpigeneticShift, world),
      diversity: genetics.diversity ?? null
    },
    boards: {
      population: populationBoard,
      cityNews: cityNewsBoard
    },
    lines: buildHudLines({ frame, world, focusCities, topDemoCities, topCompanyByCity, populationBoard, cityNewsBoard, events: selectedEvents })
  };
}

function buildResourceStatus({ world, frame, limit, nationId = null, cityId = null, sort = "weakest" }) {
  const keys = ["water", "food", "energy_fossil", "energy_renewable", "metals_bulk", "rare_minerals", "human"];
  const resourceName = {
    water: "water",
    food: "food",
    energy_fossil: "energy_fossil",
    energy_renewable: "energy_renewable",
    metals_bulk: "metals_bulk",
    rare_minerals: "rare_minerals",
    human: "human"
  };
  const ratio = (node) => {
    if (!node) {
      return 0;
    }
    return Number(((node.stock ?? 0) / Math.max(1, node.capacity ?? 1)).toFixed(3));
  };
  const cityRows = [];
  for (const city of world.cities ?? []) {
    if (nationId && city.nationId !== nationId) {
      continue;
    }
    if (cityId && city.id !== cityId) {
      continue;
    }
    const resourceRatios = {};
    for (const key of keys) {
      resourceRatios[key] = ratio(city.resources?.[key]);
    }
    const weakestKey = keys.slice().sort((a, b) => resourceRatios[a] - resourceRatios[b])[0];
    const strongestKey = keys.slice().sort((a, b) => resourceRatios[b] - resourceRatios[a])[0];
    const avg = Number((keys.reduce((sum, key) => sum + resourceRatios[key], 0) / keys.length).toFixed(3));
    const scarcity = Number((1 - avg).toFixed(3));
    cityRows.push({
      cityId: city.id,
      cityName: city.name,
      nationId: city.nationId ?? null,
      nationName: world.getNationById(city.nationId)?.name ?? city.nationId ?? null,
      averageRatio: avg,
      scarcity,
      weakestResource: resourceName[weakestKey],
      weakestRatio: resourceRatios[weakestKey],
      strongestResource: resourceName[strongestKey],
      strongestRatio: resourceRatios[strongestKey],
      humanQuality: Number((city.resources?.human?.quality ?? 0).toFixed(3)),
      resources: Object.fromEntries(
        keys.map((key) => [
          key,
          {
            ratio: resourceRatios[key],
            stock: Number((city.resources?.[key]?.stock ?? 0).toFixed(3)),
            capacity: Number((city.resources?.[key]?.capacity ?? 0).toFixed(3))
          }
        ])
      )
    });
  }

  const nationRows = (world.nations ?? [])
    .filter((nation) => !nationId || nation.id === nationId)
    .map((nation) => {
      const cities = cityRows.filter((row) => row.nationId === nation.id);
      const cityCount = cities.length;
      const avgByKey = {};
      for (const key of keys) {
        avgByKey[key] = cityCount
          ? Number((cities.reduce((sum, row) => sum + (row.resources[key]?.ratio ?? 0), 0) / cityCount).toFixed(3))
          : 0;
      }
      const weakestKey = keys.slice().sort((a, b) => avgByKey[a] - avgByKey[b])[0];
      const strongestKey = keys.slice().sort((a, b) => avgByKey[b] - avgByKey[a])[0];
      const averageRatio = Number((keys.reduce((sum, key) => sum + avgByKey[key], 0) / keys.length).toFixed(3));
      return {
        nationId: nation.id,
        nationName: nation.name,
        cityCount,
        averageRatio,
        scarcity: Number((1 - averageRatio).toFixed(3)),
        weakestResource: weakestKey,
        weakestRatio: avgByKey[weakestKey],
        strongestResource: strongestKey,
        strongestRatio: avgByKey[strongestKey],
        averageHumanQuality: cityCount
          ? Number((cities.reduce((sum, row) => sum + (row.humanQuality ?? 0), 0) / cityCount).toFixed(3))
          : 0,
        resources: avgByKey
      };
    });

  if (sort === "strongest") {
    cityRows.sort((a, b) => b.averageRatio - a.averageRatio || a.cityId.localeCompare(b.cityId));
  } else if (sort === "scarcity") {
    cityRows.sort((a, b) => b.scarcity - a.scarcity || a.cityId.localeCompare(b.cityId));
  } else {
    cityRows.sort((a, b) => a.averageRatio - b.averageRatio || a.cityId.localeCompare(b.cityId));
  }

  nationRows.sort((a, b) => a.averageRatio - b.averageRatio || a.nationId.localeCompare(b.nationId));

  return {
    frame: {
      time: frame.time,
      phase: frame.phase,
      worldVersion: frame.worldVersion
    },
    market: {
      globalScarcity: Number((frame.system?.resources?.globalScarcity ?? 0).toFixed(3)),
      prices: Object.fromEntries(
        keys.map((key) => [key, Number(((frame.system?.resources?.prices?.[key] ?? 1)).toFixed(3))])
      )
    },
    nations: nationRows.slice(0, limit),
    cities: cityRows.slice(0, limit),
    totalNations: nationRows.length,
    totalCities: cityRows.length,
    sort
  };
}

function buildCompanyFinancials({
  world,
  frame,
  engine,
  companyId = null,
  companyName = null,
  cityId = null,
  sortBy = "revenue",
  limit = 5
}) {
  const liveCompanies = engine?.population?.companies ?? [];
  const peopleById = new Map((engine?.population?.people ?? []).map((p) => [String(p.id), p]));
  const companiesById = new Map(liveCompanies.map((c) => [String(c.id), c]));
  const investmentState = world?.systemState?.investmentInstitutions ?? {};
  const sovereignFunds = investmentState.sovereignFunds ?? {};
  const institutionalFunds = investmentState.institutionalFunds ?? {};
  const summaryRows = frame.people?.companies?.topCompanies ?? [];
  const summaryById = new Map(summaryRows.map((row) => [String(row.id), row]));

  const withComputed = liveCompanies.map((company) => {
    const key = String(company.id);
    const s = summaryById.get(key) ?? {};
    const revenue = Number((s.revenue ?? company.revenue ?? 0).toFixed(3));
    const profit = Number((s.profit ?? company.profit ?? 0).toFixed(3));
    const cost = Number((revenue - profit).toFixed(3));
    const stock = Number((s.stock ?? company.stockPrice ?? 1).toFixed(3));
    const marketShare = Number(((s.marketShare ?? company.marketShare ?? 0)).toFixed(3));
    const capital = Number(((company.capital ?? 0)).toFixed(3));
    const margin = revenue > 0 ? Number((profit / revenue).toFixed(3)) : 0;
    const pseudoAssets = Number((capital * 1.8 + Math.max(0, revenue) * 0.35).toFixed(3));
    const pseudoLiabilities = Number((Math.max(0, pseudoAssets - capital)).toFixed(3));
    const sharesOutstanding = Math.max(1, Number(company.sharesOutstanding ?? 1000));
    const capTableRaw = company.capTable ?? { market: sharesOutstanding };
    const holderRows = Object.entries(capTableRaw)
      .map(([holder, shares]) => ({ holder, shares: Number(shares) || 0 }))
      .filter((r) => r.shares > 0)
      .sort((a, b) => b.shares - a.shares);
    const topHolders = holderRows.slice(0, 8).map((row) => {
      let holderType = "person";
      let holderId = String(row.holder);
      let holderName = `Person#${row.holder}`;
      if (row.holder === "market") {
        holderType = "market";
        holderId = null;
        holderName = "Market Float";
      } else if (String(row.holder).startsWith("C:")) {
        holderType = "company";
        const refId = String(row.holder).slice(2);
        const ref = companiesById.get(refId);
        holderId = String(row.holder);
        holderName = ref?.name ?? `Company#${refId}`;
      } else if (String(row.holder).startsWith("N:")) {
        holderType = "sovereign_fund";
        const fund = sovereignFunds[String(row.holder)];
        holderId = String(row.holder);
        holderName = fund?.name ?? `Sovereign Fund ${row.holder}`;
      } else if (String(row.holder).startsWith("B:")) {
        const fund = institutionalFunds[String(row.holder)];
        const isBank = fund?.type === "bank" || String(row.holder).startsWith("B:BANK:");
        holderType = isBank ? "bank" : "institutional_fund";
        holderId = String(row.holder);
        holderName = fund?.name ?? (isBank ? `Bank Fund ${row.holder}` : `Institutional Fund ${row.holder}`);
      } else {
        const person = peopleById.get(String(row.holder)) ?? null;
        holderType = "person";
        holderId = String(row.holder);
        holderName =
          person?.name || `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.trim() || `Person#${row.holder}`;
      }
      return {
        holderType,
        holderId,
        holderName,
        shares: Number(row.shares.toFixed(3)),
        ownershipPct: Number(((row.shares / sharesOutstanding) * 100).toFixed(2))
      };
    });
    const hhi =
      holderRows.reduce((sum, row) => {
        const p = row.shares / sharesOutstanding;
        return sum + p * p;
      }, 0) * 10000;
    const city = world.getCityById(company.cityId);
    const nation = city ? world.getNationById(city.nationId) : null;
    return {
      id: String(company.id),
      name: company.name,
      sector: company.sector,
      listed: !!company.listed,
      cityId: company.cityId,
      cityName: city?.name ?? company.cityId,
      nationId: city?.nationId ?? null,
      nationName: nation?.name ?? null,
      employees: s.employees ?? company.employeeCount ?? 0,
      revenue,
      cost,
      operatingProfit: profit,
      operatingMargin: margin,
      marketShare,
      stock,
      capital,
      sharesOutstanding: Number(sharesOutstanding.toFixed(3)),
      capTable: {
        holderCount: holderRows.length,
        concentrationHhi: Number(hhi.toFixed(1)),
        topHolders
      },
      balanceSheetPseudo: {
        assets: pseudoAssets,
        liabilities: pseudoLiabilities,
        equity: capital
      }
    };
  });

  const matches = withComputed.filter((row) => {
    if (companyId && row.id !== companyId) {
      return false;
    }
    if (companyName && !row.name.toLowerCase().includes(companyName.toLowerCase())) {
      return false;
    }
    if (cityId && row.cityId !== cityId) {
      return false;
    }
    return true;
  });

  const key = sortBy;
  matches.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0) || a.id.localeCompare(b.id));

  return {
    frame: {
      time: frame.time,
      phase: frame.phase,
      worldVersion: frame.worldVersion
    },
    filters: {
      companyId,
      companyName,
      cityId,
      sortBy,
      limit
    },
    count: matches.length,
    companies: matches.slice(0, limit),
    note:
      "This simulation tracks revenue/profit/capital/stock directly. balanceSheetPseudo values are derived proxies, not ledger-based accounting."
  };
}

function buildSocialNetworkView({
  frame,
  world,
  companyId = null,
  cityId = null,
  minWeight = 0.08,
  limitNodes = 120,
  limitEdges = 240
}) {
  const network = frame.people?.socialNetwork ?? { summary: { nodes: 0, edges: 0, averageTieWeight: 0 }, nodes: [], edges: [] };
  let nodes = (network.nodes ?? []).slice();
  if (cityId) {
    nodes = nodes.filter((n) => n.cityId === cityId);
  }
  if (companyId) {
    nodes = nodes.filter((n) => String(n.employerId ?? "") === companyId);
  }
  const nodeSet = new Set(nodes.map((n) => n.id));
  let edges = (network.edges ?? []).filter((e) => (e.weight ?? 0) >= minWeight);
  edges = edges.filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));
  if (companyId) {
    edges = edges.filter(
      (e) => String(e.fromEmployerId ?? "") === companyId && String(e.toEmployerId ?? "") === companyId
    );
  }
  edges.sort((a, b) => b.weight - a.weight || a.from - b.from || a.to - b.to);
  nodes.sort((a, b) => b.strength - a.strength || b.degree - a.degree || a.id - b.id);

  const topConnectors = nodes.slice(0, 12).map((n) => ({
    ...n,
    city: world.getCityById(n.cityId)?.name ?? n.cityId
  }));

  return {
    frame: {
      time: frame.time,
      phase: frame.phase,
      worldVersion: frame.worldVersion
    },
    filters: { companyId, cityId, minWeight, limitNodes, limitEdges },
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      averageTieWeight: network.summary?.averageTieWeight ?? 0
    },
    topConnectors,
    nodes: nodes.slice(0, limitNodes),
    edges: edges.slice(0, limitEdges)
  };
}

function buildPersonProfile({ frame, world, engine, personId = null, personName = null, tiesLimit = 10, holdingsLimit = 8 }) {
  const people = engine.population?.people ?? [];
  if (!people.length) {
    throw new Error("no tracked people");
  }
  if (!Number.isFinite(personId) && !personName) {
    throw new Error("personId or personName is required");
  }
  const person = selectPerson(people, { personId, personName });
  if (!person) {
    throw new Error(`person not found: ${personId ?? personName}`);
  }

  const companies = engine.population?.companies ?? [];
  const companyById = new Map(companies.map((c) => [Number(c.id), c]));
  const employer = person.employerId ? companyById.get(Number(person.employerId)) ?? null : null;
  const wealthRank = rankBy(people, (p) => p.socioeconomic?.wealth ?? 0, person.id);
  const potentialRank = rankBy(people, (p) => estimateGeneticPotential(p), person.id);
  const cognitiveRank = rankBy(people, (p) => p.ability?.cognitive ?? 0, person.id);
  const socialNode = (frame.people?.socialNetwork?.nodes ?? []).find((n) => Number(n.id) === Number(person.id)) ?? null;
  const topTies = collectPersonTies({ frame, people, personId: Number(person.id), limit: tiesLimit });
  const holdings = collectPersonHoldings({
    personId: Number(person.id),
    companies,
    world,
    limit: holdingsLimit
  });
  const h = frame.people?.highlights ?? {};
  const highlightFlags = {
    economicPower: Number(h.economicPower?.id) === Number(person.id),
    cognitive: Number(h.cognitive?.id) === Number(person.id),
    sociability: Number(h.sociability?.id) === Number(person.id),
    geneticPotential: Number(h.geneticPotential?.id) === Number(person.id),
    epigeneticShift: Number(h.epigeneticShift?.id) === Number(person.id)
  };

  return {
    frame: {
      time: frame.time,
      phase: frame.phase,
      worldVersion: frame.worldVersion
    },
    person: {
      id: person.id,
      name: person.name,
      sex: person.sex ?? null,
      age: Number(person.age ?? 0),
      religion: person.religion ?? null,
      generation: person.generation ?? 0,
      lineageRootId: person.lineageRootId ?? person.id,
      state: person.currentState ?? null,
      employed: !!person.employed,
      profession: person.profession ?? null
    },
    location: {
      current: cityRef(world, person.currentCityId),
      home: cityRef(world, person.homeCityId),
      work: cityRef(world, person.workCityId)
    },
    job: {
      employerId: person.employerId ?? null,
      employer: employer
        ? {
            id: employer.id,
            name: employer.name,
            sector: employer.sector ?? null,
            cityId: employer.cityId,
            city: world.getCityById(employer.cityId)?.name ?? employer.cityId,
            listed: !!employer.listed,
            stock: Number((employer.stockPrice ?? 0).toFixed(3)),
            profit: Number((employer.profit ?? 0).toFixed(3))
          }
        : null,
      publicService: person.publicService ?? null,
      workStrategy: person.workStrategy ?? null
    },
    assets: {
      wealth: Number((person.socioeconomic?.wealth ?? 0).toFixed(3)),
      cash: Number((person.socioeconomic?.cash ?? 0).toFixed(3)),
      realEstate: Number((person.socioeconomic?.realEstate ?? 0).toFixed(3)),
      stocks: Number((person.socioeconomic?.stocks ?? 0).toFixed(3)),
      bankDeposit: Number((person.socioeconomic?.bankDeposit ?? 0).toFixed(3)),
      debt: Number((person.socioeconomic?.debt ?? 0).toFixed(3)),
      wealthPercentile: Number((wealthRank.percentile * 100).toFixed(2)),
      wealthRank: wealthRank.rank,
      totalPeople: wealthRank.total,
      equityHoldings: holdings
    },
    genetics: {
      potentialEstimate: Number(estimateGeneticPotential(person).toFixed(3)),
      potentialPercentile: Number((potentialRank.percentile * 100).toFixed(2)),
      potentialRank: potentialRank.rank,
      cognitivePercentile: Number((cognitiveRank.percentile * 100).toFixed(2)),
      cognitiveRank: cognitiveRank.rank,
      ability: roundObj(person.ability ?? {}, 3),
      traits: roundObj(person.traits ?? {}, 3),
      epigeneticShiftMagnitude: Number(estimateEpigeneticShift(person).toFixed(3))
    },
    family: {
      partnerId: person.partnerId ?? null,
      parents: (person.parents ?? []).slice(0, 2),
      childrenCount: (person.childrenIds ?? []).length,
      childrenIds: (person.childrenIds ?? []).slice(0, 10)
    },
    social: {
      degree: socialNode?.degree ?? 0,
      strength: Number((socialNode?.strength ?? 0).toFixed(3)),
      topTies
    },
    highlights: highlightFlags
  };
}

function buildPersonCompare({
  frame,
  world,
  engine,
  personAId = null,
  personAName = null,
  personBId = null,
  personBName = null,
  tiesLimit = 8,
  holdingsLimit = 6
}) {
  const a = buildPersonProfile({
    frame,
    world,
    engine,
    personId: personAId,
    personName: personAName,
    tiesLimit,
    holdingsLimit
  });
  const b = buildPersonProfile({
    frame,
    world,
    engine,
    personId: personBId,
    personName: personBName,
    tiesLimit,
    holdingsLimit
  });
  const delta = {
    wealth: Number((a.assets.wealth - b.assets.wealth).toFixed(3)),
    wealthPercentile: Number((a.assets.wealthPercentile - b.assets.wealthPercentile).toFixed(2)),
    cash: Number((a.assets.cash - b.assets.cash).toFixed(3)),
    realEstate: Number((a.assets.realEstate - b.assets.realEstate).toFixed(3)),
    stocks: Number((a.assets.stocks - b.assets.stocks).toFixed(3)),
    bankDeposit: Number((a.assets.bankDeposit - b.assets.bankDeposit).toFixed(3)),
    debt: Number((a.assets.debt - b.assets.debt).toFixed(3)),
    geneticPotential: Number((a.genetics.potentialEstimate - b.genetics.potentialEstimate).toFixed(3)),
    cognitive: Number(((a.genetics.ability.cognitive ?? 0) - (b.genetics.ability.cognitive ?? 0)).toFixed(3)),
    productivity: Number(((a.genetics.ability.productivity ?? 0) - (b.genetics.ability.productivity ?? 0)).toFixed(3)),
    socialDegree: Number((a.social.degree - b.social.degree).toFixed(3)),
    socialStrength: Number((a.social.strength - b.social.strength).toFixed(3))
  };
  const interpretation = {
    richer: delta.wealth > 0 ? a.person.name : delta.wealth < 0 ? b.person.name : "tie",
    higherPotential: delta.geneticPotential > 0 ? a.person.name : delta.geneticPotential < 0 ? b.person.name : "tie",
    higherCognitive: delta.cognitive > 0 ? a.person.name : delta.cognitive < 0 ? b.person.name : "tie"
  };
  return {
    frame: {
      time: frame.time,
      phase: frame.phase,
      worldVersion: frame.worldVersion
    },
    personA: a,
    personB: b,
    deltaAminusB: delta,
    interpretation
  };
}

function selectPerson(people, { personId = null, personName = null }) {
  if (Number.isFinite(personId)) {
    return people.find((p) => Number(p.id) === Number(personId)) ?? null;
  }
  const q = String(personName ?? "").trim().toLowerCase();
  if (!q) {
    return null;
  }
  const exact = people.find((p) => String(p.name ?? "").toLowerCase() === q);
  if (exact) {
    return exact;
  }
  return people.find((p) => String(p.name ?? "").toLowerCase().includes(q)) ?? null;
}

function collectPersonTies({ frame, people, personId, limit = 10 }) {
  const nodes = frame.people?.socialNetwork?.nodes ?? [];
  const edges = frame.people?.socialNetwork?.edges ?? [];
  const nodeById = new Map(nodes.map((n) => [Number(n.id), n]));
  const personById = new Map(people.map((p) => [Number(p.id), p]));
  const rows = [];
  for (const e of edges) {
    const a = Number(e.from);
    const b = Number(e.to);
    if (a !== personId && b !== personId) {
      continue;
    }
    const peerId = a === personId ? b : a;
    const peerNode = nodeById.get(peerId);
    const peer = personById.get(peerId);
    rows.push({
      personId: peerId,
      name: peer?.name ?? peerNode?.name ?? `Person#${peerId}`,
      cityId: peerNode?.cityId ?? peer?.currentCityId ?? null,
      city: peerNode?.city ?? null,
      employerId: peerNode?.employerId ?? peer?.employerId ?? null,
      state: peerNode?.state ?? peer?.currentState ?? null,
      weight: Number((e.weight ?? 0).toFixed(3))
    });
  }
  rows.sort((x, y) => y.weight - x.weight || x.personId - y.personId);
  return rows.slice(0, limit);
}

function collectPersonHoldings({ personId, companies, world, limit = 8 }) {
  const holderKey = String(personId);
  const rows = [];
  for (const c of companies) {
    const shares = Number(c.capTable?.[holderKey] ?? 0);
    if (!Number.isFinite(shares) || shares <= 0) {
      continue;
    }
    const price = Math.max(0, Number(c.stockPrice ?? 0));
    const value = shares * price;
    rows.push({
      companyId: c.id,
      company: c.name,
      cityId: c.cityId,
      city: world.getCityById(c.cityId)?.name ?? c.cityId,
      shares: Number(shares.toFixed(6)),
      stock: Number(price.toFixed(3)),
      marketValue: Number(value.toFixed(3))
    });
  }
  rows.sort((a, b) => b.marketValue - a.marketValue || String(a.companyId).localeCompare(String(b.companyId)));
  return {
    totalPositions: rows.length,
    totalMarketValue: Number(rows.reduce((s, r) => s + r.marketValue, 0).toFixed(3)),
    positions: rows.slice(0, limit)
  };
}

function estimateGeneticPotential(person) {
  if (person.genetics?.abilityChromosomes) {
    const keys = ["cognitive", "productivity", "charisma", "health", "stressResilience", "creativity", "attention"];
    const sum = keys.reduce((acc, key) => {
      const a1 = Number(person.genetics.abilityChromosomes?.[0]?.[key] ?? 0.5);
      const a2 = Number(person.genetics.abilityChromosomes?.[1]?.[key] ?? 0.5);
      return acc + (a1 + a2) * 0.5;
    }, 0);
    return sum / Math.max(1, keys.length);
  }
  const ab = person.ability ?? {};
  const vals = Object.values(ab).map((v) => Number(v)).filter(Number.isFinite);
  if (!vals.length) {
    return 0;
  }
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function estimateEpigeneticShift(person) {
  const epi = person.epigenetics ?? {};
  const vals = [
    ...Object.values(epi.personality ?? {}).map((v) => Math.abs(Number(v) || 0)),
    ...Object.values(epi.ability ?? {}).map((v) => Math.abs(Number(v) || 0))
  ];
  if (!vals.length) {
    return 0;
  }
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function rankBy(people, metricFn, personId) {
  const rows = people
    .map((p) => ({ id: Number(p.id), score: Number(metricFn(p) ?? 0) }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
  const idx = rows.findIndex((r) => r.id === Number(personId));
  const rank = idx >= 0 ? idx + 1 : rows.length;
  const total = Math.max(1, rows.length);
  const percentile = idx >= 0 ? (total - idx) / total : 0;
  return { rank, total, percentile };
}

function cityRef(world, cityId) {
  if (!cityId) {
    return null;
  }
  const city = world.getCityById(cityId);
  return {
    cityId,
    city: city?.name ?? cityId,
    nationId: city?.nationId ?? null
  };
}

function roundObj(obj, digits = 3) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const num = Number(v);
    out[k] = Number.isFinite(num) ? Number(num.toFixed(digits)) : v;
  }
  return out;
}

function buildHudLines({ frame, world, focusCities, topDemoCities, topCompanyByCity, populationBoard, cityNewsBoard, events = null }) {
  const rows = [];
  const s = frame.people?.stateCounts ?? {};
  const outFlow = (frame.flows ?? []).reduce((sum, row) => sum + (row.outbound ?? 0), 0);
  const inFlow = (frame.flows ?? []).reduce((sum, row) => sum + (row.inbound ?? 0), 0);
  rows.push(`時刻: ${frame.time}`);
  rows.push(`フェーズ: ${frame.phase}`);
  rows.push(`週次: ${formatWeek(frame.dayOfWeek, frame.isWeekend)}`);
  rows.push(`フロー: out ${outFlow} / in ${inFlow}`);
  rows.push(`状態: H:${s.Home ?? 0} C:${s.Commute ?? 0} W:${s.Work ?? 0} L:${s.Leisure ?? 0} S:${s.Sleep ?? 0}`);
  rows.push(`夜間交流: ${frame.people?.encounterSummary?.total ?? 0}`);
  rows.push(
    `人的ネットワーク: N${frame.people?.socialNetwork?.summary?.nodes ?? 0} E${frame.people?.socialNetwork?.summary?.edges ?? 0} 平均強度${frame.people?.socialNetwork?.summary?.averageTieWeight ?? 0}`
  );
  rows.push(`フォーカス都市: ${focusCities.join(", ") || "-"}`);
  rows.push(`宗教分布: ${formatReligionCounts(frame.people?.religionStats ?? [])}`);
  rows.push(`宗教影響: ${formatReligionInfluence(frame.people?.religionStats ?? [])}`);
  rows.push(`宗教教条: ${formatReligionDoctrine(frame.people?.religionStats ?? [])}`);
  rows.push(`出生/死亡(全体): ${formatDemographicTotals(frame.people?.demographics ?? {})}`);
  rows.push(
    `出生/死亡(都市別): ${
      topDemoCities.length
        ? topDemoCities
            .map((row) => `${row.city}(+${row.births}/-${row.deaths}/婚${row.marriages}/離${row.divorces})`)
            .join(" | ")
        : "変化なし"
    }`
  );
  rows.push(`経済サマリ: ${formatEconomy(frame.people?.economy ?? {}, world)}`);
  rows.push(`銀行サマリ: ${formatBanking(frame.people?.economy ?? {})}`);
  rows.push(`企業トップ: ${formatTopCompanies(frame.people?.companies ?? {}, world)}`);
  rows.push(
    `企業(都市別): ${
      topCompanyByCity.length ? topCompanyByCity.map((row) => `${row.city}:${row.companies}社/利${row.profit}`).join(" | ") : "-"
    }`
  );
  rows.push(`マクロ: ${formatMacroSystem(frame.system ?? {})}`);
  rows.push(`通貨: ${formatCurrencySystem(frame.system?.currencies ?? {}, frame.geopolitics?.nations ?? [])}`);
  rows.push(`国家: ${formatNationSummary(frame.geopolitics ?? {})}`);
  rows.push(`外交: ${formatDiplomacySummary(frame.geopolitics ?? {})}`);
  rows.push(`同盟関係: ${formatAllianceSummary(frame.geopolitics ?? {})}`);
  rows.push(`敵対関係: ${formatHostilitySummary(frame.geopolitics ?? {})}`);
  rows.push(`軍事企業: ${formatMilitarySummary(frame.geopolitics ?? {}, world)}`);
  rows.push(`学校制度: ${formatSchoolSummary(frame.people?.institutions ?? {})}`);
  rows.push(`イベント: ${formatEvents(events ?? frame.people?.events ?? [])}`);
  rows.push(`履歴: ${formatHistory(frame)}`);
  rows.push(`家系サマリ: ${frame.people?.lineage?.summary ?? "-"}`);
  if (populationBoard) {
    rows.push(`現在人口\n${populationBoard}`);
  }
  if (cityNewsBoard) {
    rows.push(`都市ニュース\n${cityNewsBoard}`);
  }
  return rows;
}

function toNamedHighlight(row, world) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    value: row.value,
    cityId: row.cityId,
    city: world.getCityById(row.cityId)?.name ?? row.cityId
  };
}

function buildPopulationBoard(frame, world, maxCities) {
  const tracked = Object.values(frame.people?.stateCounts ?? {}).reduce((sum, v) => sum + (v ?? 0), 0);
  const stats = frame.people?.statisticalPopulation ?? {};
  const estimated = Object.values(stats).reduce((sum, row) => sum + (row?.estimatedTotal ?? 0), 0);
  const lines = [`追跡人口: ${tracked}人`, `推定総人口: ${estimated}人`];
  const top = Object.entries(stats)
    .sort((a, b) => ((b[1]?.estimatedTotal ?? 0) - (a[1]?.estimatedTotal ?? 0)))
    .slice(0, maxCities);
  for (const [cityId, row] of top) {
    const city = world.getCityById(cityId)?.name ?? cityId;
    lines.push(`${city}: 推定${row?.estimatedTotal ?? 0} / 追跡${row?.tracked ?? 0}`);
  }
  return lines.join("\n");
}

function buildCityNewsBoard(frame, world, maxEvents, maxCities, events = null) {
  const lines = [];
  for (const event of (events ?? frame.people?.events ?? []).slice(0, maxEvents)) {
    lines.push(`• ${event.text}`);
  }
  const movers = (frame.people?.demographics?.cityStats ?? [])
    .slice()
    .sort((a, b) => Math.abs((b.net ?? 0)) - Math.abs((a.net ?? 0)))
    .slice(0, Math.max(1, Math.min(3, maxCities)));
  for (const row of movers) {
    const city = world.getCityById(row.cityId)?.name ?? row.cityId;
    lines.push(`• ${city}: 出生${row.births ?? 0} 死亡${row.deaths ?? 0} 純増${row.net ?? 0}`);
  }
  return lines.length ? lines.join("\n") : "ニュースなし";
}

function formatWeek(dayOfWeek, isWeekend) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const idx = Number.isFinite(dayOfWeek) ? dayOfWeek : 0;
  const safe = Math.max(0, Math.min(labels.length - 1, idx));
  return `${labels[safe]}${isWeekend ? " (Weekend)" : ""}`;
}

function formatReligionCounts(rows) {
  if (!rows?.length) {
    return "-";
  }
  return rows.map((row) => `${row.religion}:${row.count}人(${row.share}%)`).join(" | ");
}

function formatReligionInfluence(rows) {
  if (!rows?.length) {
    return "-";
  }
  return rows.map((row) => `${row.religion}:${row.influence}`).join(" | ");
}

function formatReligionDoctrine(rows) {
  if (!rows?.length) {
    return "-";
  }
  return rows.slice(0, 3).map((row) => `${row.religion}:${row.doctrine}`).join(" | ");
}

function formatDemographicTotals(demo) {
  return (
    `出生:${demo.totalBirths ?? 0} / 死亡:${demo.totalDeaths ?? 0} / 婚姻:${demo.totalMarriages ?? 0} / ` +
    `離婚:${demo.totalDivorces ?? 0} / 同居:${demo.currentCohabitingCouples ?? 0}/${demo.currentCouples ?? 0} / ` +
    `純増:${(demo.totalBirths ?? 0) - (demo.totalDeaths ?? 0)}`
  );
}

function formatEconomy(economy, world) {
  const topCity = (economy.byCity ?? []).slice().sort((a, b) => (b.avgIncome ?? 0) - (a.avgIncome ?? 0))[0];
  if (!topCity) {
    return `平均所得:${economy.avgIncome ?? 0} / 失業率:${economy.unemploymentRate ?? 0}% / 平均資産:${economy.avgWealth ?? 0}`;
  }
  const city = world.getCityById(topCity.cityId)?.name ?? topCity.cityId;
  return `平均所得:${economy.avgIncome ?? 0} / 失業率:${economy.unemploymentRate ?? 0}% / 平均資産:${economy.avgWealth ?? 0} / 最高:${city}`;
}

function formatBanking(economy) {
  const b = economy?.banking ?? {};
  return `預金:${b.deposits ?? 0} / 負債:${b.debt ?? 0} / ネット:${b.net ?? 0}`;
}

function formatTopCompanies(companies, world) {
  const rows = companies.topCompanies ?? [];
  if (!rows.length) {
    return "-";
  }
  return rows
    .slice(0, 2)
    .map((row) => {
      const city = world.getCityById(row.cityId)?.name ?? row.cityId;
      return `${row.listed ? "★" : ""}${row.name}(利${row.profit}/株${row.stock})@${city}`;
    })
    .join(" | ");
}

function formatMacroSystem(system) {
  const techIdx = Number(system?.technology?.globalIndex ?? 1);
  return `疫${(system.epidemicLevel ?? 0).toFixed(2)} 気${(system.climateStress ?? 0).toFixed(2)} 文${(system.culturalDrift ?? 0).toFixed(2)} 市${(system.marketIndex ?? 1).toFixed(2)} 技${techIdx.toFixed(2)}`;
}

function summarizeTechnologySystem(technology, nations) {
  const nationRows = nations ?? [];
  const nationIndex = technology?.nationIndex ?? {};
  const count = Math.max(1, nationRows.length);
  let nationAvg = 0;
  for (const n of nationRows) {
    nationAvg += nationIndex[n.id] ?? 1;
  }
  return {
    globalIndex: Number((technology?.globalIndex ?? 1).toFixed(3)),
    nationAvgIndex: Number((nationAvg / count).toFixed(3)),
    cumulativeRd: Number((technology?.cumulativeRd ?? 0).toFixed(3))
  };
}

function summarizeCurrencySystem(currencies, nations) {
  const nationRows = nations ?? [];
  if (!nationRows.length) {
    return null;
  }
  const fx = currencies?.fxAgainstBase ?? {};
  const inflation = currencies?.inflation ?? {};
  const policy = currencies?.policyRate ?? {};
  const count = Math.max(1, nationRows.length);
  let fxAvg = 0;
  let infAvg = 0;
  let rateAvg = 0;
  for (const n of nationRows) {
    fxAvg += fx[n.id] ?? 1;
    infAvg += inflation[n.id] ?? 0.012;
    rateAvg += policy[n.id] ?? 0.02;
  }
  return {
    baseCode: currencies?.baseCode ?? "SCU",
    avgFx: Number((fxAvg / count).toFixed(3)),
    avgInflation: Number((infAvg / count).toFixed(3)),
    avgPolicyRate: Number((rateAvg / count).toFixed(3)),
    updatedDay: currencies?.updatedDay ?? -1
  };
}

function formatCurrencySystem(currencies, nations) {
  const s = summarizeCurrencySystem(currencies, nations);
  if (!s) {
    return "-";
  }
  return `基軸:${s.baseCode} FX平均:${s.avgFx} 物価:${s.avgInflation} 金利:${s.avgPolicyRate} 更新日:${s.updatedDay}`;
}

function formatNationSummary(geo) {
  const rows = geo.nations ?? [];
  if (!rows.length) {
    return "-";
  }
  return rows
    .slice()
    .sort((a, b) => (b.power ?? 0) - (a.power ?? 0))
    .slice(0, 3)
    .map((row) => `${row.name}(力${row.power})`)
    .join(" | ");
}

function formatDiplomacySummary(geo) {
  const rows = geo.relations ?? [];
  if (!rows.length) {
    return "-";
  }
  const top = rows.slice().sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))[0];
  return (
    `${top.nationAId}-${top.nationBId}:${top.status} ` +
    `T${(top.tension ?? 0).toFixed(2)} ` +
    `信${(top.trustMemory ?? 0).toFixed(2)} ` +
    `交${(top.tradeDependence ?? 0).toFixed(2)} ` +
    `価${(top.valueDistance ?? 0).toFixed(2)}`
  );
}

function formatMilitarySummary(geo, world) {
  const rows = geo.militaryCompanies ?? [];
  if (!rows.length) {
    return "なし";
  }
  return rows
    .slice(0, 2)
    .map((row) => {
      const city = row.cityId ? world.getCityById(row.cityId)?.name ?? row.cityId : "-";
      return `${row.name}(準備${row.readiness}@${city})`;
    })
    .join(" | ");
}

function formatSchoolSummary(institutions) {
  const s = institutions?.schoolTotals;
  if (!s) {
    return "-";
  }
  return `在学:${s.enrolled ?? 0} (初等:${s.primary ?? 0}/中等:${s.secondary ?? 0}/高等:${s.tertiary ?? 0}) 卒業:${s.graduates ?? 0}`;
}

function formatAllianceSummary(geo) {
  const nationName = new Map((geo.nations ?? []).map((row) => [row.id, row.name]));
  const rows = (geo.relations ?? [])
    .filter((row) => row.status === "alliance")
    .sort((a, b) => (b.relation ?? 0) - (a.relation ?? 0))
    .slice(0, 3);
  if (!rows.length) {
    return "なし";
  }
  return rows.map((row) => `${nationName.get(row.nationAId) ?? row.nationAId}↔${nationName.get(row.nationBId) ?? row.nationBId}`).join(" | ");
}

function formatHostilitySummary(geo) {
  const nationName = new Map((geo.nations ?? []).map((row) => [row.id, row.name]));
  const rows = (geo.relations ?? [])
    .filter((row) => row.status === "war" || row.status === "crisis")
    .sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))
    .slice(0, 3);
  if (!rows.length) {
    return "なし";
  }
  return rows
    .map((row) => `${row.status === "war" ? "⚠" : "△"}${nationName.get(row.nationAId) ?? row.nationAId}×${nationName.get(row.nationBId) ?? row.nationBId}`)
    .join(" | ");
}

function formatEvents(events) {
  if (!events?.length) {
    return "なし";
  }
  return events.slice(0, 2).map((row) => row.text).join(" | ");
}

function summarizeNationEvents(events) {
  const rows = (events ?? []).filter((row) => ["nation_founded", "territory_shift", "nation_extinct"].includes(row?.type));
  if (!rows.length) {
    return { founded: 0, territorialShift: 0, extinct: 0, latest: null };
  }
  return {
    founded: rows.filter((row) => row.type === "nation_founded").length,
    territorialShift: rows.filter((row) => row.type === "territory_shift").length,
    extinct: rows.filter((row) => row.type === "nation_extinct").length,
    latest: rows[0]?.text ?? null
  };
}

function formatHistory(frame) {
  if (frame.historyLength) {
    return `${frame.historyCursor + 1}/${frame.historyLength}`;
  }
  if (Number.isFinite(frame.historyCursor)) {
    return `${frame.historyCursor + 1}`;
  }
  return "-";
}

function startStateApi() {
  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    if (method === "GET" && url === "/health") {
      return respondJson(res, 200, { ok: true, server: SERVER_INFO.name, frame: { time: frame.time, phase: frame.phase } });
    }
    if (method === "GET" && url === "/bootstrap") {
      return respondJson(res, 200, { config, world, frame });
    }
    if (method === "GET" && url === "/summary") {
      return respondJson(res, 200, worldSummary());
    }
    if (method === "POST" && url === "/tick") {
      return readJson(req, res, (body) => {
        const steps = clampInt(body?.steps ?? 1, 1, 1440);
        for (let i = 0; i < steps; i += 1) {
          frame = engine.tick();
        }
        persistSnapshot();
        respondJson(res, 200, { steps, frame, worldVersion: world.version });
      });
    }
    if (method === "POST" && url === "/historyStep") {
      return readJson(req, res, (body) => {
        const offset = Number.parseInt(String(body?.offset ?? 0), 10) || 0;
        const f = engine.getHistoryFrame(offset);
        if (!f) {
          return respondJson(res, 404, { ok: false, error: "history_empty" });
        }
        frame = f;
        respondJson(res, 200, { frame });
      });
    }
    if (method === "POST" && url === "/setPolicy") {
      return readJson(req, res, (body) => {
        engine.config.policy = { ...engine.config.policy, ...(body?.policy ?? {}) };
        respondJson(res, 200, { ok: true });
      });
    }
    if (method === "POST" && url === "/reset") {
      return readJson(req, res, (body) => {
        const args = body ?? {};
        const next = clone(DEFAULT_CONFIG);
        if (args.config && typeof args.config === "object") {
          Object.assign(next, clone(args.config));
        }
        if (Number.isFinite(args.seed)) {
          next.seed = args.seed;
        }
        if (args.population && typeof args.population === "object") {
          next.population = { ...next.population, ...args.population };
        }
        if (Number.isFinite(args.trackedPopulation)) {
          next.population = { ...next.population, trackedIndividuals: clampInt(args.trackedPopulation, 100, 100000) };
          const detail = Math.max(20, Math.min(300, Math.floor(next.population.trackedIndividuals * 0.08)));
          next.population.activeDetailCount = detail;
        }
        config = next;
        world = createSampleWorld(config.seed);
        engine = new SimulationEngine({ world, config });
        frame = engine.tick();
        persistSnapshot();
        respondJson(res, 200, { ok: true, config, world, frame });
      });
    }
    if (method === "POST" && url === "/snapshot/export") {
      return respondJson(res, 200, { snapshot: engine.exportSnapshot(), frame: { time: frame.time, phase: frame.phase } });
    }
    if (method === "POST" && url === "/snapshot/load") {
      return readJson(req, res, (body) => {
        if (!body?.snapshot) {
          return respondJson(res, 400, { ok: false, error: "snapshot_required" });
        }
        engine.importSnapshot(body.snapshot);
        frame = engine.getHistoryFrame(0) ?? engine.tick();
        persistSnapshot();
        respondJson(res, 200, { ok: true, frame, worldVersion: world.version });
      });
    }
    if (method === "POST" && url === "/tool") {
      return readJson(req, res, (body) => {
        const name = String(body?.name ?? "");
        const args = body?.arguments ?? body?.args ?? {};
        const handler = toolHandlers[name];
        if (!handler) {
          appendToolAuditLog({ source: "state-api", name, ok: false, args, error: "unknown_tool" });
          return respondJson(res, 404, { ok: false, error: `unknown_tool:${name}` });
        }
        try {
          const data = handler(args);
          appendToolAuditLog({ source: "state-api", name, ok: true, args });
          respondJson(res, 200, { ok: true, data });
        } catch (error) {
          appendToolAuditLog({ source: "state-api", name, ok: false, args, error: error?.message ?? String(error) });
          respondJson(res, 500, { ok: false, error: error?.message ?? String(error) });
        }
      });
    }
    respondJson(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(STATE_API_PORT, STATE_API_HOST, () => {
    console.error(`State API: http://${STATE_API_HOST}:${STATE_API_PORT}`);
  });
}

function readJson(req, res, done) {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 30 * 1024 * 1024) {
      req.destroy(new Error("payload too large"));
    }
  });
  req.on("end", () => {
    if (!body) {
      done({});
      return;
    }
    try {
      done(JSON.parse(body));
    } catch {
      respondJson(res, 400, { ok: false, error: "invalid_json" });
    }
  });
  req.on("error", () => respondJson(res, 413, { ok: false, error: "payload_too_large" }));
}

function respondJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function appendToolAuditLog({ source, name, ok, args, error = null }) {
  try {
    const dir = path.dirname(TOOL_AUDIT_LOG_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const row = {
      ts: new Date().toISOString(),
      source,
      tool: name,
      ok: !!ok,
      frame: { time: frame?.time ?? null, phase: frame?.phase ?? null, history: formatHistory(frame ?? {}) },
      args: sanitizeAuditArgs(args),
      error
    };
    fs.appendFileSync(TOOL_AUDIT_LOG_PATH, JSON.stringify(row) + "\n", "utf8");
  } catch {
    // no-op audit failure by design
  }
}

function sanitizeAuditArgs(args) {
  try {
    const json = JSON.stringify(args ?? {});
    if (json.length <= 1200) {
      return args ?? {};
    }
    return { truncated: true, size: json.length };
  } catch {
    return { unserializable: true };
  }
}

function enforceLocalOnlyHost({ host, name, allowUnsafeExpose }) {
  if (allowUnsafeExpose) {
    return;
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!loopbackHosts.has(String(host).toLowerCase())) {
    console.error(`[safe-default] Refusing non-local ${name} host: ${host}`);
    console.error("[safe-default] Set SPHERE_ALLOW_UNSAFE_EXPOSE=1 only if you intentionally want remote exposure.");
    process.exit(1);
  }
}

function buildStratificationReport({ frame, engine, compareFrom = 0 }) {
  const currentPeople = engine.population.people ?? [];
  const baseFrame = compareFrom > 0 ? engine.history[Math.min(engine.history.length - 1, Math.max(0, compareFrom - 1))] ?? frame : frame;
  const basePeople = currentPeople;
  const asRow = (people, srcFrame, source) => {
    const wealth = people.map((p) => Math.max(0, p.socioeconomic?.wealth ?? 0)).sort((a, b) => a - b);
    const deposits = people.reduce((s, p) => s + (p.socioeconomic?.bankDeposit ?? 0), 0);
    const debt = people.reduce((s, p) => s + (p.socioeconomic?.debt ?? 0), 0);
    const byCity = srcFrame?.people?.economy?.byCity ?? [];
    const income = stats(byCity.map((row) => row.avgIncome ?? 0));
    const unemp = stats(byCity.map((row) => row.unemploymentRate ?? 0));
    return {
      frame: { time: srcFrame?.time ?? frame.time, phase: srcFrame?.phase ?? frame.phase, source },
      population: people.length,
      wealth: {
        gini: giniFromSorted(wealth),
        top1SharePct: pct(wealth, 0.01),
        top10SharePct: pct(wealth, 0.1),
        top20SharePct: pct(wealth, 0.2),
        min: wealth[0] ?? 0,
        max: wealth[wealth.length - 1] ?? 0,
        avg: wealth.reduce((s, x) => s + x, 0) / Math.max(1, wealth.length)
      },
      banking: { deposits, debt, net: deposits - debt },
      cityGap: {
        incomeMean: income.mean,
        incomeStd: income.std,
        unemploymentMean: unemp.mean,
        unemploymentStd: unemp.std
      }
    };
  };
  const base = roundStratRow(asRow(basePeople, baseFrame, "history"));
  const current = roundStratRow(asRow(currentPeople, frame, "active_mcp"));
  const dg = current.wealth.gini - base.wealth.gini;
  return {
    base,
    current,
    delta: {
      gini: Number(dg.toFixed(3)),
      top10SharePct: Number((current.wealth.top10SharePct - base.wealth.top10SharePct).toFixed(2)),
      top20SharePct: Number((current.wealth.top20SharePct - base.wealth.top20SharePct).toFixed(2)),
      bankingNet: Number((current.banking.net - base.banking.net).toFixed(3))
    },
    note:
      compareFrom > 0
        ? "Wealth distribution comparison by historical step is approximated because full per-person wealth history is not retained."
        : "Base uses current active population at baseline frame.",
    interpretation: dg > 0.01 ? "Stratification is increasing." : dg < -0.01 ? "Stratification is decreasing." : "Stratification is mostly stable."
  };
}

function buildGeopoliticsReport({ frame, compareFrom = 0, top = 5 }) {
  const baseFrame = compareFrom > 0 ? engine.history[Math.min(engine.history.length - 1, Math.max(0, compareFrom - 1))] ?? frame : engine.history[0] ?? frame;
  const mapFrame = (src, source) => {
    const relations = src?.geopolitics?.relations ?? [];
    const names = new Map((src?.geopolitics?.nations ?? []).map((n) => [n.id, n.name]));
    const tensions = relations.map((r) => r.tension ?? 0);
    return {
      frame: { time: src?.time ?? frame.time, phase: src?.phase ?? frame.phase, source },
      thresholds: {
        crisis: DEFAULT_CONFIG.geopolitics?.crisisThreshold ?? 0.58,
        war: DEFAULT_CONFIG.geopolitics?.warThreshold ?? 0.78
      },
      pairs: relations.length,
      tension: { avg: avg(tensions), min: tensions.length ? Math.min(...tensions) : 0, max: tensions.length ? Math.max(...tensions) : 0 },
      statuses: summarizeStatuses(relations),
      topRelations: relations
        .slice()
        .sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))
        .slice(0, top)
        .map((r) => ({
          pair: `${names.get(r.nationAId) ?? r.nationAId}-${names.get(r.nationBId) ?? r.nationBId}`,
          status: r.status,
          tension: r.tension ?? 0,
          relation: r.relation ?? 0,
          trustMemory: r.trustMemory ?? 0,
          tradeDependence: r.tradeDependence ?? 0
        }))
    };
  };
  const base = roundGeoRow(mapFrame(baseFrame, "history"));
  const current = roundGeoRow(mapFrame(frame, "active_mcp"));
  const d = current.tension.avg - base.tension.avg;
  return {
    base,
    current,
    delta: {
      avgTension: Number(d.toFixed(3)),
      maxTension: Number((current.tension.max - base.tension.max).toFixed(3)),
      warPairs: (current.statuses.war ?? 0) - (base.statuses.war ?? 0),
      crisisPairs: (current.statuses.crisis ?? 0) - (base.statuses.crisis ?? 0)
    },
    interpretation:
      (current.statuses.war ?? 0) > 0
        ? "War is active."
        : (current.statuses.crisis ?? 0) > 0 || current.tension.max >= current.thresholds.crisis
        ? "High tension with crisis risk."
        : d > 0.03
        ? "Tension is rising."
        : d < -0.03
        ? "Tension is easing."
        : "Tension is mostly stable."
  };
}

function buildMetaOrderReport({ frame, world, top = 5 }) {
  const geo = frame.geopolitics ?? {};
  const stack = geo.governanceStack ?? [];
  const blocs = (geo.blocs ?? []).slice().sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0));
  const zones = (geo.institutionalZones ?? []).slice().sort((a, b) => (b.marketOpenness ?? 0) - (a.marketOpenness ?? 0));
  const heg = (geo.hegemonicNetworks ?? []).slice().sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0));
  return {
    frame: {
      time: frame.time,
      phase: frame.phase
    },
    worldSystem: {
      marketIndex: Number((frame.system?.marketIndex ?? 1).toFixed(3)),
      epidemicLevel: Number((frame.system?.epidemicLevel ?? 0).toFixed(3)),
      climateStress: Number((frame.system?.climateStress ?? 0).toFixed(3)),
      culturalDrift: Number((frame.system?.culturalDrift ?? 0).toFixed(3))
    },
    stack,
    civilizationBlocs: blocs.slice(0, top),
    institutionalZones: zones.slice(0, top),
    hegemonicNetworks: heg.slice(0, top),
    nationCityLayer: {
      nations: world.nations?.length ?? 0,
      cities: world.cities?.length ?? 0,
      topRelations: (geo.relations ?? [])
        .slice()
        .sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))
        .slice(0, top)
    }
  };
}

function buildNationHistory({ world, type = "all", nationId = null, sinceDay = 0, limit = 50 }) {
  const history = world.systemState?.geopolitics?.nationHistory ?? [];
  let rows = history.slice();
  rows = rows.filter((row) => Number(row.day ?? 0) >= sinceDay);
  if (type !== "all") {
    rows = rows.filter((row) => row.type === type);
  }
  if (nationId) {
    rows = rows.filter((row) => row.nationId === nationId || row.otherNationId === nationId);
  }
  rows.sort((a, b) => Number(b.day ?? 0) - Number(a.day ?? 0));
  const counts = countBy(rows.map((row) => row.type ?? "unknown"));
  return {
    filters: { type, nationId, sinceDay, limit },
    total: rows.length,
    counts,
    rows: rows.slice(0, limit).map((row) => ({
      day: row.day ?? 0,
      type: row.type ?? "unknown",
      nationId: row.nationId ?? null,
      nationName: row.nationName ?? row.nationId ?? null,
      otherNationId: row.otherNationId ?? null,
      otherNationName: row.otherNationName ?? row.otherNationId ?? null,
      cityId: row.cityId ?? null,
      cityName: row.cityName ?? (row.cityId ? world.getCityById(row.cityId)?.name ?? row.cityId : null),
      text: row.text ?? ""
    }))
  };
}

function buildInstitutionStabilityReport({ frame, world }) {
  const institutions = frame.people?.institutions ?? null;
  const longTerm = institutions?.longTermStability ?? world?.systemState?.institutions?.longTermStability?.report ?? null;
  const meta = institutions?.metaGovernance ?? null;
  const byCity = institutions?.byCity ?? {};
  const cityRows = Object.entries(byCity)
    .map(([cityId, row]) => ({
      cityId,
      cooperationIndex: row?.cooperationIndex ?? 0,
      policyAction: row?.policy?.action ?? null,
      policyReward: row?.policy?.lastReward ?? 0,
      educationAction: row?.educationPolicy?.action ?? null,
      educationReward: row?.educationPolicy?.lastReward ?? 0
    }))
    .sort((a, b) => (b.cooperationIndex ?? 0) - (a.cooperationIndex ?? 0))
    .slice(0, 8);

  const score = longTerm?.score ?? 0;
  const alertLevel = longTerm?.alertLevel ?? "unknown";
  const profile = meta?.profile ?? "adaptive";
  const interpretation =
    alertLevel === "high"
      ? "Institutional stress is high; stabilization profile should stay active."
      : alertLevel === "elevated"
      ? "Institutions are under pressure; adaptive/equity profile changes should be monitored."
      : score >= 0.7
      ? "Institutions are relatively stable; optimization profile can improve efficiency."
      : "Institutions are mixed; keep adaptive profile and watch trend deltas.";

  return {
    frame: {
      time: frame.time,
      phase: frame.phase,
      history: formatHistory(frame)
    },
    longTermStability: longTerm,
    metaGovernance: meta,
    topCityCoordination: cityRows,
    interpretation,
    note: `meta_profile=${profile}, alert=${alertLevel}`
  };
}

function buildRlReport({ frame, world, engine, domain = "all", limit = 10 }) {
  const include = {
    company: domain === "all" || domain === "company",
    diplomacy: domain === "all" || domain === "diplomacy",
    resource: domain === "all" || domain === "resource",
    investment: domain === "all" || domain === "investment"
  };
  const out = {
    frame: {
      time: frame.time,
      phase: frame.phase,
      dayOfWeek: frame.dayOfWeek ?? null,
      history: formatHistory(frame)
    },
    domain,
    sections: {}
  };
  if (include.company) {
    const companies = engine.population?.companies ?? [];
    const rows = companies
      .map((c) => {
        const policy = summarizeRlPolicy(c.rlPolicy ?? {});
        const city = world.getCityById(c.cityId);
        return {
          companyId: c.id,
          name: c.name,
          cityId: c.cityId,
          city: city?.name ?? c.cityId,
          sector: c.sector ?? "general",
          rdBias: Number((c.rdBias ?? 1).toFixed(3)),
          ...policy
        };
      })
      .sort((a, b) => b.score - a.score || b.totalSamples - a.totalSamples);
    out.sections.company = {
      totalPolicies: rows.length,
      top: rows.slice(0, limit)
    };
  }
  if (include.diplomacy) {
    const nations = new Map((frame.geopolitics?.nations ?? []).map((n) => [n.id, n.name]));
    const policies =
      world.systemState?.geopolitics?.diplomacyPolicies ??
      frame.system?.geopolitics?.diplomacyPolicies ??
      {};
    const rows = Object.entries(policies)
      .map(([pair, row]) => {
        const [aId, bId] = String(pair).split("|");
        const policy = summarizeRlPolicy(row ?? {});
        return {
          pairKey: pair,
          pair: `${nations.get(aId) ?? aId}-${nations.get(bId) ?? bId}`,
          ...policy
        };
      })
      .sort((a, b) => b.score - a.score || b.totalSamples - a.totalSamples);
    out.sections.diplomacy = {
      totalPolicies: rows.length,
      top: rows.slice(0, limit)
    };
  }
  if (include.resource) {
    const policies = world.systemState?.resourcePolicies?.cities ?? frame.system?.resourcePolicies?.cities ?? {};
    const rows = Object.entries(policies)
      .map(([cityId, row]) => {
        const city = world.getCityById(cityId);
        const policy = summarizeRlPolicy(row ?? {});
        return {
          cityId,
          city: city?.name ?? cityId,
          ...policy
        };
      })
      .sort((a, b) => b.score - a.score || b.totalSamples - a.totalSamples);
    out.sections.resource = {
      totalPolicies: rows.length,
      top: rows.slice(0, limit)
    };
  }
  if (include.investment) {
    const policies = world.systemState?.investmentRl?.entityPolicies ?? frame.system?.investmentRl?.entityPolicies ?? {};
    const sovereignFunds = world.systemState?.investmentInstitutions?.sovereignFunds ?? {};
    const institutionalFunds = world.systemState?.investmentInstitutions?.institutionalFunds ?? {};
    const rows = Object.entries(policies)
      .map(([holderKey, row]) => {
        const label = sovereignFunds[holderKey]?.name ?? institutionalFunds[holderKey]?.name ?? holderKey;
        const holderType = holderKey.startsWith("N:") ? "sovereign_fund" : holderKey.startsWith("B:") ? "institutional" : holderKey.startsWith("C:") ? "company" : "other";
        const policy = summarizeRlPolicy(row ?? {});
        return {
          holderKey,
          holderType,
          holder: label,
          ...policy
        };
      })
      .sort((a, b) => b.score - a.score || b.totalSamples - a.totalSamples);
    out.sections.investment = {
      totalPolicies: rows.length,
      top: rows.slice(0, limit)
    };
  }
  return out;
}

function summarizeRlPolicy(policy) {
  const qByActionRaw = policy?.qByAction ?? {};
  const nByActionRaw = policy?.nByAction ?? {};
  const actions = Array.from(new Set([...Object.keys(qByActionRaw), ...Object.keys(nByActionRaw)]));
  if (actions.length === 0) {
    return {
      lastAction: policy?.lastAction ?? null,
      bestAction: null,
      bestQ: 0,
      avgQ: 0,
      qSpread: 0,
      totalSamples: 0,
      confidence: 0,
      score: 0,
      qByAction: {},
      nByAction: {}
    };
  }
  let bestAction = actions[0];
  let bestQ = Number(qByActionRaw[bestAction] ?? 0);
  let minQ = bestQ;
  let sumQ = 0;
  let totalSamples = 0;
  const qByAction = {};
  const nByAction = {};
  for (const action of actions) {
    const q = Number(qByActionRaw[action] ?? 0);
    const n = Math.max(0, Number(nByActionRaw[action] ?? 0));
    qByAction[action] = Number(q.toFixed(6));
    nByAction[action] = n;
    sumQ += q;
    totalSamples += n;
    if (q > bestQ) {
      bestQ = q;
      bestAction = action;
    }
    if (q < minQ) {
      minQ = q;
    }
  }
  const avgQ = sumQ / Math.max(1, actions.length);
  const qSpread = bestQ - minQ;
  const confidence = totalSamples / (totalSamples + 30);
  const score = bestQ + qSpread * 0.7 + Math.log1p(totalSamples) * 0.08;
  return {
    lastAction: policy?.lastAction ?? null,
    bestAction,
    bestQ: Number(bestQ.toFixed(6)),
    avgQ: Number(avgQ.toFixed(6)),
    qSpread: Number(qSpread.toFixed(6)),
    totalSamples,
    confidence: Number(confidence.toFixed(3)),
    score: Number(score.toFixed(6)),
    qByAction,
    nByAction
  };
}

function giniFromSorted(values) {
  const n = values.length;
  if (n === 0) {
    return 0;
  }
  const sum = values.reduce((s, x) => s + x, 0);
  if (sum <= 0) {
    return 0;
  }
  let cum = 0;
  for (let i = 0; i < n; i += 1) {
    cum += (i + 1) * values[i];
  }
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

function pct(sortedValues, share) {
  const n = sortedValues.length;
  if (n === 0) {
    return 0;
  }
  const k = Math.max(1, Math.floor(n * share));
  const total = sortedValues.reduce((s, x) => s + x, 0);
  if (total <= 0) {
    return 0;
  }
  return (sortedValues.slice(n - k).reduce((s, x) => s + x, 0) / total) * 100;
}

function stats(values) {
  if (!values.length) {
    return { mean: 0, std: 0 };
  }
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  return {
    mean,
    std: Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length)
  };
}

function avg(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeStatuses(relations) {
  const counts = { peace: 0, alliance: 0, crisis: 0, war: 0 };
  for (const row of relations) {
    const key = row.status ?? "peace";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function roundStratRow(row) {
  return {
    ...row,
    wealth: {
      gini: Number(row.wealth.gini.toFixed(3)),
      top1SharePct: Number(row.wealth.top1SharePct.toFixed(2)),
      top10SharePct: Number(row.wealth.top10SharePct.toFixed(2)),
      top20SharePct: Number(row.wealth.top20SharePct.toFixed(2)),
      min: Number(row.wealth.min.toFixed(3)),
      max: Number(row.wealth.max.toFixed(3)),
      avg: Number(row.wealth.avg.toFixed(3))
    },
    banking: {
      deposits: Number(row.banking.deposits.toFixed(3)),
      debt: Number(row.banking.debt.toFixed(3)),
      net: Number(row.banking.net.toFixed(3))
    },
    cityGap: {
      incomeMean: Number(row.cityGap.incomeMean.toFixed(3)),
      incomeStd: Number(row.cityGap.incomeStd.toFixed(3)),
      unemploymentMean: Number(row.cityGap.unemploymentMean.toFixed(2)),
      unemploymentStd: Number(row.cityGap.unemploymentStd.toFixed(2))
    }
  };
}

function roundGeoRow(row) {
  return {
    ...row,
    tension: {
      avg: Number(row.tension.avg.toFixed(3)),
      min: Number(row.tension.min.toFixed(3)),
      max: Number(row.tension.max.toFixed(3))
    },
    topRelations: row.topRelations.map((r) => ({
      ...r,
      tension: Number(r.tension.toFixed(3)),
      relation: Number(r.relation.toFixed(3)),
      trustMemory: Number(r.trustMemory.toFixed(3)),
      tradeDependence: Number(r.tradeDependence.toFixed(3))
    }))
  };
}

function findCity(query) {
  const upper = query.toUpperCase();
  return (
    world.getCityById(query) ??
    world.getCityById(upper) ??
    world.cities.find((city) => city.name.toLowerCase() === query.toLowerCase()) ??
    null
  );
}

function clampInt(value, min, max) {
  const num = Number.parseInt(String(value), 10);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.max(min, Math.min(max, num));
}

function normalizeEventTypes(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((row) => String(row ?? "").trim().toLowerCase())
        .filter((row) => row.length > 0)
    )
  ).slice(0, 10);
}

function countBy(rows) {
  const out = {};
  for (const row of rows ?? []) {
    const key = String(row ?? "unknown");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function writeResult(id, result) {
  if (id == null) {
    return;
  }
  writeMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message) {
  if (id == null) {
    return;
  }
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function writeMessage(payload) {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  process.stdout.write(header + body);
}
