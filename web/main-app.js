import * as THREE from "/node_modules/three/build/three.module.js";
import { OrbitControls } from "/node_modules/three/examples/jsm/controls/OrbitControls.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";

const __bootEl = document.getElementById("time");
if (__bootEl) {
  __bootEl.textContent = "APP: init";
}

const USE_SIM_WORKER = true;

const PHASE_STYLE = {
  Morning: {
    fog: 0x6f87a6,
    ambient: 0xaed4ff,
    particle: 0xa8fff0,
    edgeBase: 0x7aa1cf,
    autoRotateSpeed: 0.22
  },
  Daytime: {
    fog: 0x7ea3c5,
    ambient: 0xcbe4ff,
    particle: 0x7dffda,
    edgeBase: 0x86b0de,
    autoRotateSpeed: 0.14
  },
  Evening: {
    fog: 0x5e6b8f,
    ambient: 0x95b7f7,
    particle: 0xffc786,
    edgeBase: 0x6f8fc0,
    autoRotateSpeed: 0.26
  },
  Night: {
    fog: 0x081221,
    ambient: 0x7ea8e4,
    particle: 0x73d9ff,
    edgeBase: 0x48658a,
    autoRotateSpeed: 0.32
  }
};

const CITY_TYPE_COLOR = {
  residential: 0x8dd4ff,
  mixed: 0xa7f1be,
  workHub: 0xffcc7a
};
const PERSON_STATE_COLOR = {
  Home: 0x9ec4ff,
  Commute: 0xffc96f,
  Work: 0xff8c8c,
  Leisure: 0x85f7c7,
  Sleep: 0xc6a9ff
};
const CITY_LOD = {
  nearIn: 11.2,
  nearOut: 13.6
};
let selectedLineagePersonId = null;

const app = document.getElementById("app");
const timelineUi = {
  live: document.getElementById("tl-live"),
  prev: document.getElementById("tl-prev"),
  play: document.getElementById("tl-play"),
  next: document.getElementById("tl-next"),
  speed: document.getElementById("tl-speed"),
  range: document.getElementById("tl-range"),
  status: document.getElementById("tl-status")
};
const audioUi = {
  toggle: document.getElementById("bgm-toggle")
};
const snapshotUi = {
  saveNow: document.getElementById("snapshot-save-now")
};
const scaleUi = {
  preset: document.getElementById("scale-preset"),
  autoLodToggle: document.getElementById("perf-auto-toggle")
};
const insightUi = {
  populationBoard: document.getElementById("population-board"),
  cityNewsBoard: document.getElementById("city-news-board"),
  stockBoard: document.getElementById("stock-board"),
  phaseBoard: document.getElementById("phase-board"),
  stockCanvas: null,
  stockTape: null,
  stockTable: null,
  stockSummary: null,
  phaseCanvas: null,
  phaseSummary: null,
  phaseLegend: null,
  togglePopulation: document.getElementById("toggle-population"),
  toggleCityNews: document.getElementById("toggle-city-news"),
  toggleStock: document.getElementById("toggle-stock"),
  togglePhase: document.getElementById("toggle-phase")
};
const hud = {
  time: document.getElementById("time"),
  phase: document.getElementById("phase"),
  week: document.getElementById("week"),
  perf: document.getElementById("perf"),
  flow: document.getElementById("flow"),
  humanLod: document.getElementById("human-lod"),
  nameLabels: document.getElementById("name-labels"),
  states: document.getElementById("states"),
  encounters: document.getElementById("encounters"),
  focus: document.getElementById("focus"),
  religionCounts: document.getElementById("religion-counts"),
  religionInfluence: document.getElementById("religion-influence"),
  religionDoctrine: document.getElementById("religion-doctrine"),
  demoTotal: document.getElementById("demo-total"),
  demoCity: document.getElementById("demo-city"),
  economy: document.getElementById("economy"),
  companyTop: document.getElementById("company-top"),
  companyCity: document.getElementById("company-city"),
  macroSystem: document.getElementById("macro-system"),
  nations: document.getElementById("nations"),
  metaOrder: document.getElementById("meta-order"),
  diplomacy: document.getElementById("diplomacy"),
  alliances: document.getElementById("alliances"),
  hostilities: document.getElementById("hostilities"),
  military: document.getElementById("military"),
  events: document.getElementById("events"),
  nationEvents: document.getElementById("nation-events"),
  history: document.getElementById("history"),
  lineageSummary: document.getElementById("lineage-summary"),
  lineageTree: document.getElementById("lineage-tree"),
  lineageGraphTitle: document.getElementById("lineage-graph-title"),
  lineageGraph: document.getElementById("lineage-graph"),
  topEcon: document.getElementById("top-econ"),
  topCog: document.getElementById("top-cog"),
  topSoc: document.getElementById("top-soc"),
  topGene: document.getElementById("top-gene"),
  topEpi: document.getElementById("top-epi"),
  geneDiversity: document.getElementById("gene-diversity")
};

const SCALE_PRESETS = {
  base: { trackedIndividuals: 900, activeDetailCount: 60 },
  large: { trackedIndividuals: 3000, activeDetailCount: 120 },
  xlarge: { trackedIndividuals: 5000, activeDetailCount: 180 }
};

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

async function fetchBootstrapState() {
  try {
    const res = await fetch("/api/state/bootstrap");
    if (!res.ok) {
      throw new Error(`bootstrap failed: ${res.status}`);
    }
    const payload = await res.json();
    if (!payload?.frame || !payload?.world) {
      throw new Error("bootstrap payload missing frame/world");
    }
    return payload;
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error("bootstrap fallback:", message);
    return {
      config: DEFAULT_CONFIG,
      world: { layers: [], cities: [], edges: [], nations: [], version: 0 },
      frame: buildFallbackFrame(),
      bootstrapError: message
    };
  }
}

function buildFallbackFrame() {
  return {
    time: "-",
    phase: "Night",
    dayOfWeek: 0,
    isWeekend: false,
    historyCursor: 0,
    historyLength: 1,
    flowSummary: { outboundTotal: 0, inboundTotal: 0 },
    performance: { mode: "offline", workerMs: 0 },
    system: {
      epidemicLevel: 0,
      climateStress: 0,
      culturalDrift: 0,
      marketIndex: 1
    },
    people: {
      stateCounts: { Home: 0, Commute: 0, Work: 0, Leisure: 0, Sleep: 0 },
      encounters: 0,
      focusCityIds: [],
      religions: [],
      demographics: { totalBirths: 0, totalDeaths: 0, cityStats: [] },
      economy: { avgIncome: 0, unemploymentRate: 0, byCity: [] },
      companies: { topCompanies: [], byCity: [] },
      events: [],
      highlights: {},
      lineage: { summary: "state_api_unreachable", treeLines: [] },
      geneticsSummary: { diversity: { personality: 0, ability: 0 } },
      statisticalPopulation: {},
      phaseIndicators: {},
      phaseRegimes: {}
    },
    geopolitics: {
      nations: [],
      relations: [],
      militaryCompanies: []
    }
  };
}

function hydrateWorld(worldLike) {
  const w = worldLike ?? { layers: [], cities: [], edges: [], nations: [], version: 0 };
  w.layers = Array.isArray(w.layers) ? w.layers : [];
  w.cities = Array.isArray(w.cities) ? w.cities : [];
  w.edges = Array.isArray(w.edges) ? w.edges : [];
  w.nations = Array.isArray(w.nations) ? w.nations : [];
  w.cityIndex = new Map(w.cities.map((city) => [city.id, city]));
  w.nationIndex = new Map(w.nations.map((nation) => [nation.id, nation]));
  w.getCityById = (id) => w.cityIndex.get(id) ?? null;
  w.getNationById = (id) => w.nationIndex.get(id) ?? null;
  return w;
}

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x081221, 12, 40);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 4, 16);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x081221, 1);
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.18;
controls.minDistance = 7;
controls.maxDistance = 28;

const ambientLight = new THREE.AmbientLight(0x8db7ff, 0.75);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xb4d4ff, 1.2);
keyLight.position.set(8, 12, 6);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x7ea0dc, 0.45);
rimLight.position.set(-9, -5, -6);
scene.add(rimLight);

const bootstrap = await fetchBootstrapState();
if (__bootEl) {
  __bootEl.textContent = "APP: bootstrap ok";
}
let activeConfig = cloneConfig(bootstrap.config ?? DEFAULT_CONFIG);
let activeScalePreset = "base";
let world = hydrateWorld(bootstrap.world);
let simWorker = null;
let pendingWorkerFrame = null;
let pendingSnapshotSave = false;
let showNameLabels = false;
let timelineMode = false;
let timelinePlaying = false;
let timelineTimer = null;
const panelVisible = {
  population: true,
  cityNews: true,
  stock: true,
  phase: true
};
const stockVizState = {
  maxPoints: 140,
  indexHistory: [],
  companyHistories: new Map()
};
const phaseVizState = {
  maxPoints: 180,
  shockHistory: [],
  recoveryHistory: [],
  instabilityHistory: [],
  macroRegime: "stable",
  socialRegime: "stable"
};
const ambientAudio = {
  context: null,
  masterGain: null,
  droneGain: null,
  padGain: null,
  noiseGain: null,
  filter: null,
  oscillators: [],
  noiseSource: null,
  running: false,
  phase: null
};
const runtimeTuning = {
  autoLod: true,
  qualityLevel: 0,
  nearActorLimit: 320,
  midSpriteLimit: 180,
  maxNameLabels: 60,
  farDensityDivisor: 4,
  farDensityCap: 180,
  flowParticleCap: 120,
  flowParticleMultiplier: 1
};
const perfStats = {
  fpsEma: 60,
  simMsEma: 0,
  renderMsEma: 0,
  lowFpsFrames: 0,
  highFpsFrames: 0
};

const baseRadius = 5.2;
const layerStep = 0.95;
const layerRadiusById = new Map();
world.layers.forEach((layer, index) => {
  layerRadiusById.set(layer.id, baseRadius + index * layerStep);
});

buildStars(scene);
const layerMeshes = buildLayerMeshes(scene, world.layers, layerRadiusById);
let cityObjects = buildCities(scene, world.cities, layerRadiusById);
let cityStructures = buildCityStructures(scene, world.cities, cityObjects);
for (const [cityId, structure] of cityStructures) {
  const cityObj = cityObjects.get(cityId);
  if (cityObj) {
    cityObj.structure = structure;
  }
}
let edgeObjects = buildEdges(scene, world.edges, cityObjects);
let renderedWorldVersion = world.version;
const eventFx = createEventFxRenderer(scene, cityObjects, baseRadius + layerStep * (world.layers.length + 1.1));
const geopoliticsFx = createGeopoliticsOverlay(scene, cityObjects);
const nationTerritoryFx = createNationTerritoryOverlay(scene);
rebuildNationTerritories(nationTerritoryFx, world, cityObjects, [...layerRadiusById.values()]);

const particleGroup = new THREE.Group();
scene.add(particleGroup);
const humanLodRenderer = createHumanLodRenderer(scene);

let frame = bootstrap.frame;
let stateApiError = bootstrap.bootstrapError ?? null;
const initialPhaseStyle = PHASE_STYLE[frame?.phase] ?? PHASE_STYLE.Night;
let particleMeshes = buildFlowParticleMeshes(frame, cityObjects, initialPhaseStyle.particle);
for (const mesh of particleMeshes) {
  particleGroup.add(mesh.points);
}
rebuildHumanLod(humanLodRenderer, frame, cityObjects, camera);

updateEdgeStyle(edgeObjects, frame, initialPhaseStyle);
applyPhaseStyle(initialPhaseStyle);
updateHud(frame, world);
if (__bootEl) {
  __bootEl.textContent = frame?.time ?? "APP: frame ready";
}
if (stateApiError && hud.time) {
  hud.time.textContent = `state api unreachable (${stateApiError})`;
}

const simStepMs = 600;
let accMs = 0;
let lastNow = performance.now();
if (USE_SIM_WORKER && typeof Worker !== "undefined") {
  startSimulationWorker(activeConfig);
}

function startSimulationWorker(config) {
  if (simWorker) {
    simWorker.postMessage({ type: "stop" });
    simWorker.terminate();
    simWorker = null;
  }
  simWorker = new Worker("/web/simWorker.js", { type: "module" });
  simWorker.onmessage = (event) => {
    if (event.data?.type === "frame") {
      if (!timelineMode || event.data?.history) {
        pendingWorkerFrame = event.data.frame;
        stateApiError = null;
      }
    }
    if (event.data?.type === "error") {
      stateApiError = event.data.message ?? "state api unreachable";
      if (hud.time) {
        hud.time.textContent = `state api error: ${stateApiError}`;
      }
    }
    if (event.data?.type === "snapshot") {
      localStorage.setItem("sphere_snapshot", JSON.stringify(event.data.snapshot));
      pendingSnapshotSave = false;
      console.log("snapshot saved");
    }
  };
  simWorker.postMessage({ type: "init", config, resetOnInit: false, stepMs: simStepMs });
}

function setupSnapshotControls() {
  snapshotUi.saveNow?.addEventListener("click", () => {
    if (simWorker) {
      if (!pendingSnapshotSave) {
        pendingSnapshotSave = true;
        simWorker.postMessage({ type: "snapshot" });
      }
      return;
    }
  });
}

function animate(now) {
  const dt = now - lastNow;
  lastNow = now;
  accMs += dt;
  const simStart = performance.now();

  if (simWorker && pendingWorkerFrame) {
    frame = pendingWorkerFrame;
    pendingWorkerFrame = null;
    const phaseStyle = PHASE_STYLE[frame.phase] ?? PHASE_STYLE.Daytime;
    replaceParticles(frame, cityObjects, phaseStyle.particle);
    updateEdgeStyle(edgeObjects, frame, phaseStyle);
    applyPhaseStyle(phaseStyle);
    updateFocusHighlight(cityObjects, frame.people.focusCityIds);
    syncWorldVisualsIfNeeded(frame);
    rebuildHumanLod(humanLodRenderer, frame, cityObjects, camera);
    updateHud(frame, world);
  }
  const simMs = performance.now() - simStart;

  const phaseT = accMs / simStepMs;
  updateParticleAnimation(phaseT, now * 0.001);
  updateLayerRotation(layerMeshes, now * 0.001);
  updateEventFx(eventFx, frame, world, now * 0.001);
  updateGeopoliticsOverlay(geopoliticsFx, frame, world, now * 0.001);
  animateHumanLod(humanLodRenderer, now * 0.001);
  applyCameraMotion(now * 0.001, frame.phase);

  const renderStart = performance.now();
  controls.update();
  updateCityLod(cityObjects, camera, frame, now * 0.001);
  renderer.render(scene, camera);
  const renderMs = performance.now() - renderStart;
  updatePerformanceMetrics(dt, simMs, renderMs);
  if (hud.perf) {
    hud.perf.textContent =
      `FPS:${perfStats.fpsEma.toFixed(1)} ` +
      `SIM:${perfStats.simMsEma.toFixed(2)}ms ` +
      `REN:${perfStats.renderMsEma.toFixed(2)}ms ` +
      `Q:${3 - runtimeTuning.qualityLevel}`;
  }
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
setupTimelineControls();
setupInsightToggles();
setupAmbientAudioControls();
setupScaleControls();
setupSnapshotControls();
applyQualityLevel(0);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener("beforeunload", () => {
  stopAmbientAudio(true);
  if (simWorker) {
    simWorker.postMessage({ type: "stop" });
    simWorker.terminate();
    simWorker = null;
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "s") {
    if (simWorker) {
      if (!pendingSnapshotSave) {
        pendingSnapshotSave = true;
        simWorker.postMessage({ type: "snapshot" });
      }
    }
  }
  if (event.key.toLowerCase() === "l") {
    const raw = localStorage.getItem("sphere_snapshot");
    if (!raw) {
      return;
    }
    const snap = JSON.parse(raw);
    if (simWorker) {
      simWorker.postMessage({ type: "loadSnapshot", snapshot: snap });
    }
    console.log("snapshot loaded");
  }
  if (event.key === "1" || event.key === "2" || event.key === "3") {
    const preset =
      event.key === "1" ? { mode: "balanced", safetyBudget: 0.5, welfareBudget: 0.5, educationBudget: 0.5 } :
      event.key === "2" ? { mode: "growth", safetyBudget: 0.35, welfareBudget: 0.25, educationBudget: 0.75 } :
      { mode: "stability", safetyBudget: 0.8, welfareBudget: 0.7, educationBudget: 0.35 };

    if (simWorker) {
      simWorker.postMessage({ type: "setPolicy", policy: preset });
    }
    console.log(`policy switched: ${preset.mode}`);
  }
  if (event.key === "," || event.key === ".") {
    const offset = event.key === "," ? -1 : 1;
    if (simWorker) {
      timelineMode = true;
      simWorker.postMessage({ type: "historyStep", offset });
    }
  }
  if (event.key.toLowerCase() === "n") {
    showNameLabels = !showNameLabels;
    humanLodRenderer.showNameLabels = showNameLabels;
    rebuildHumanLod(humanLodRenderer, frame, cityObjects, camera);
    updateHud(frame, world);
  }
});

function setupTimelineControls() {
  timelineUi.live?.addEventListener("click", () => {
    timelineMode = false;
    timelinePlaying = false;
    if (timelineTimer) {
      clearInterval(timelineTimer);
      timelineTimer = null;
    }
    timelineUi.play.textContent = "Play";
    timelineUi.status.textContent = "Live";
  });
  timelineUi.prev?.addEventListener("click", () => {
    timelineMode = true;
    stepTimeline(-1);
  });
  timelineUi.next?.addEventListener("click", () => {
    timelineMode = true;
    stepTimeline(1);
  });
  timelineUi.play?.addEventListener("click", () => {
    timelineMode = true;
    timelinePlaying = !timelinePlaying;
    timelineUi.play.textContent = timelinePlaying ? "Pause" : "Play";
    if (!timelinePlaying) {
      if (timelineTimer) {
        clearInterval(timelineTimer);
        timelineTimer = null;
      }
      return;
    }
    const speed = Number(timelineUi.speed?.value || "1");
    if (timelineTimer) {
      clearInterval(timelineTimer);
    }
    timelineTimer = setInterval(() => {
      stepTimeline(speed);
    }, 220);
  });
  timelineUi.range?.addEventListener("input", () => {
    const target = Number(timelineUi.range.value);
    if (!Number.isFinite(frame?.historyCursor)) {
      return;
    }
    timelineMode = true;
    const delta = target - frame.historyCursor;
    if (delta !== 0) {
      stepTimeline(delta);
    }
  });
}

function setupInsightToggles() {
  insightUi.togglePopulation?.addEventListener("click", () => {
    panelVisible.population = !panelVisible.population;
    insightUi.populationBoard.style.display = panelVisible.population ? "block" : "none";
    insightUi.togglePopulation.textContent = panelVisible.population ? "Hide" : "Show";
  });
  insightUi.toggleCityNews?.addEventListener("click", () => {
    panelVisible.cityNews = !panelVisible.cityNews;
    insightUi.cityNewsBoard.style.display = panelVisible.cityNews ? "block" : "none";
    insightUi.toggleCityNews.textContent = panelVisible.cityNews ? "Hide" : "Show";
  });
  insightUi.toggleStock?.addEventListener("click", () => {
    panelVisible.stock = !panelVisible.stock;
    insightUi.stockBoard.style.display = panelVisible.stock ? "block" : "none";
    insightUi.toggleStock.textContent = panelVisible.stock ? "Hide" : "Show";
  });
  insightUi.togglePhase?.addEventListener("click", () => {
    panelVisible.phase = !panelVisible.phase;
    insightUi.phaseBoard.style.display = panelVisible.phase ? "block" : "none";
    insightUi.togglePhase.textContent = panelVisible.phase ? "Hide" : "Show";
  });
}

function setupAmbientAudioControls() {
  audioUi.toggle?.addEventListener("click", async () => {
    if (ambientAudio.running) {
      stopAmbientAudio();
      return;
    }
    try {
      await startAmbientAudio(frame?.phase ?? "Night");
    } catch (err) {
      console.error("ambient audio start failed", err);
    }
  });
}

async function startAmbientAudio(phase) {
  if (!ambientAudio.context) {
    createAmbientAudioGraph();
  }
  if (!ambientAudio.context || !ambientAudio.masterGain) {
    return;
  }
  if (ambientAudio.context.state !== "running") {
    await ambientAudio.context.resume();
  }
  const t = ambientAudio.context.currentTime;
  ambientAudio.masterGain.gain.cancelScheduledValues(t);
  ambientAudio.masterGain.gain.setValueAtTime(ambientAudio.masterGain.gain.value, t);
  ambientAudio.masterGain.gain.linearRampToValueAtTime(0.14, t + 1.4);
  ambientAudio.running = true;
  updateAmbientAudioForPhase(phase);
  if (audioUi.toggle) {
    audioUi.toggle.textContent = "BGM: ON";
  }
}

function stopAmbientAudio(force = false) {
  if (!ambientAudio.context || !ambientAudio.masterGain) {
    return;
  }
  const t = ambientAudio.context.currentTime;
  ambientAudio.masterGain.gain.cancelScheduledValues(t);
  ambientAudio.masterGain.gain.setValueAtTime(ambientAudio.masterGain.gain.value, t);
  ambientAudio.masterGain.gain.linearRampToValueAtTime(0, t + (force ? 0.05 : 0.9));
  ambientAudio.running = false;
  if (audioUi.toggle) {
    audioUi.toggle.textContent = "BGM: OFF";
  }
}

function createAmbientAudioGraph() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    return;
  }
  const context = new Ctor();
  const masterGain = context.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(context.destination);

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 920;
  filter.Q.value = 0.8;
  filter.connect(masterGain);

  const droneGain = context.createGain();
  droneGain.gain.value = 0.07;
  droneGain.connect(filter);

  const padGain = context.createGain();
  padGain.gain.value = 0.04;
  padGain.connect(filter);

  const noiseGain = context.createGain();
  noiseGain.gain.value = 0.012;
  noiseGain.connect(filter);

  const oscA = context.createOscillator();
  oscA.type = "triangle";
  oscA.frequency.value = 96;
  oscA.connect(droneGain);
  oscA.start();

  const oscB = context.createOscillator();
  oscB.type = "sine";
  oscB.frequency.value = 144;
  oscB.connect(padGain);
  oscB.start();

  const noiseSource = createNoiseSource(context);
  noiseSource.connect(noiseGain);
  noiseSource.start();

  const lfo = context.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.06;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 48;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();

  ambientAudio.context = context;
  ambientAudio.masterGain = masterGain;
  ambientAudio.droneGain = droneGain;
  ambientAudio.padGain = padGain;
  ambientAudio.noiseGain = noiseGain;
  ambientAudio.filter = filter;
  ambientAudio.oscillators = [oscA, oscB, lfo];
  ambientAudio.noiseSource = noiseSource;
}

function createNoiseSource(context) {
  const bufferSize = context.sampleRate * 2;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * 0.35;
  }
  const src = context.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

function updateAmbientAudioForPhase(phase) {
  if (!ambientAudio.running || !ambientAudio.context) {
    return;
  }
  if (ambientAudio.phase === phase) {
    return;
  }
  ambientAudio.phase = phase;
  const map = {
    Morning: { root: 110, pad: 165, filter: 1080, drone: 0.055, padGain: 0.032, noise: 0.008 },
    Daytime: { root: 98, pad: 147, filter: 980, drone: 0.065, padGain: 0.036, noise: 0.01 },
    Evening: { root: 87, pad: 130.5, filter: 860, drone: 0.078, padGain: 0.044, noise: 0.013 },
    Night: { root: 73.5, pad: 110, filter: 760, drone: 0.09, padGain: 0.052, noise: 0.016 }
  };
  const style = map[phase] ?? map.Night;
  const t = ambientAudio.context.currentTime;
  ambientAudio.filter?.frequency.setTargetAtTime(style.filter, t, 1.4);
  ambientAudio.droneGain?.gain.setTargetAtTime(style.drone, t, 1.1);
  ambientAudio.padGain?.gain.setTargetAtTime(style.padGain, t, 1.2);
  ambientAudio.noiseGain?.gain.setTargetAtTime(style.noise, t, 1.4);
  ambientAudio.oscillators[0]?.frequency.setTargetAtTime(style.root, t, 1.3);
  ambientAudio.oscillators[1]?.frequency.setTargetAtTime(style.pad, t, 1.3);
}

function setupScaleControls() {
  if (scaleUi.preset) {
    scaleUi.preset.value = activeScalePreset;
    scaleUi.preset.addEventListener("change", () => {
      applyScalePreset(scaleUi.preset.value);
    });
  }
  if (scaleUi.autoLodToggle) {
    scaleUi.autoLodToggle.textContent = `AutoLOD: ${runtimeTuning.autoLod ? "ON" : "OFF"}`;
    scaleUi.autoLodToggle.addEventListener("click", () => {
      runtimeTuning.autoLod = !runtimeTuning.autoLod;
      scaleUi.autoLodToggle.textContent = `AutoLOD: ${runtimeTuning.autoLod ? "ON" : "OFF"}`;
    });
  }
}

function applyScalePreset(presetKey) {
  const preset = SCALE_PRESETS[presetKey];
  if (!preset) {
    return;
  }
  activeScalePreset = presetKey;
  activeConfig.population.trackedIndividuals = preset.trackedIndividuals;
  activeConfig.population.activeDetailCount = preset.activeDetailCount;
  stockVizState.indexHistory = [];
  stockVizState.companyHistories.clear();
  phaseVizState.shockHistory = [];
  phaseVizState.recoveryHistory = [];
  phaseVizState.instabilityHistory = [];
  if (simWorker) {
    simWorker.postMessage({ type: "setScalePreset", population: activeConfig.population });
    return;
  }
}

function applyQualityLevel(level) {
  runtimeTuning.qualityLevel = Math.max(0, Math.min(2, level));
  const profiles = [
    {
      nearActorLimit: 320,
      midSpriteLimit: 180,
      maxNameLabels: 60,
      farDensityDivisor: 4,
      farDensityCap: 180,
      flowParticleCap: 120,
      flowParticleMultiplier: 1
    },
    {
      nearActorLimit: 220,
      midSpriteLimit: 120,
      maxNameLabels: 24,
      farDensityDivisor: 6,
      farDensityCap: 130,
      flowParticleCap: 90,
      flowParticleMultiplier: 0.82
    },
    {
      nearActorLimit: 140,
      midSpriteLimit: 80,
      maxNameLabels: 10,
      farDensityDivisor: 8,
      farDensityCap: 90,
      flowParticleCap: 65,
      flowParticleMultiplier: 0.62
    }
  ];
  Object.assign(runtimeTuning, profiles[runtimeTuning.qualityLevel]);
}

function updatePerformanceMetrics(dtMs, simMs, renderMs) {
  const fps = 1000 / Math.max(1, dtMs);
  perfStats.fpsEma = perfStats.fpsEma * 0.92 + fps * 0.08;
  perfStats.simMsEma = perfStats.simMsEma * 0.9 + simMs * 0.1;
  perfStats.renderMsEma = perfStats.renderMsEma * 0.9 + renderMs * 0.1;

  if (!runtimeTuning.autoLod) {
    perfStats.lowFpsFrames = 0;
    perfStats.highFpsFrames = 0;
    return;
  }

  if (perfStats.fpsEma < 36) {
    perfStats.lowFpsFrames += 1;
    perfStats.highFpsFrames = 0;
  } else if (perfStats.fpsEma > 54) {
    perfStats.highFpsFrames += 1;
    perfStats.lowFpsFrames = 0;
  } else {
    perfStats.lowFpsFrames = 0;
    perfStats.highFpsFrames = 0;
  }

  if (perfStats.lowFpsFrames > 100 && runtimeTuning.qualityLevel < 2) {
    applyQualityLevel(runtimeTuning.qualityLevel + 1);
    perfStats.lowFpsFrames = 0;
  }
  if (perfStats.highFpsFrames > 180 && runtimeTuning.qualityLevel > 0) {
    applyQualityLevel(runtimeTuning.qualityLevel - 1);
    perfStats.highFpsFrames = 0;
  }
}

function ensureStockBoardUi() {
  if (!insightUi.stockBoard || insightUi.stockCanvas) {
    return;
  }
  insightUi.stockBoard.classList.add("stock-market-board");
  insightUi.stockBoard.innerHTML = `
    <div id="stock-summary" class="stock-summary">MARKET: -</div>
    <canvas id="stock-index-chart" class="stock-index-chart" width="640" height="230"></canvas>
    <div id="stock-tape" class="stock-tape"></div>
    <div id="stock-table" class="stock-table"></div>
  `;
  insightUi.stockCanvas = document.getElementById("stock-index-chart");
  insightUi.stockTape = document.getElementById("stock-tape");
  insightUi.stockTable = document.getElementById("stock-table");
  insightUi.stockSummary = document.getElementById("stock-summary");
}

function ensurePhaseBoardUi() {
  if (!insightUi.phaseBoard || insightUi.phaseCanvas) {
    return;
  }
  insightUi.phaseBoard.classList.add("phase-board");
  insightUi.phaseBoard.innerHTML = `
    <div id="phase-summary" class="phase-summary">Macro: - / Social: -</div>
    <canvas id="phase-chart" class="phase-chart" width="640" height="180"></canvas>
    <div id="phase-legend" class="phase-legend">
      <span style="color:#ffad7a;">Shock</span>
      <span style="color:#7bc8ff;">Recovery</span>
      <span style="color:#ffd37f;">Instability</span>
    </div>
  `;
  insightUi.phaseCanvas = document.getElementById("phase-chart");
  insightUi.phaseSummary = document.getElementById("phase-summary");
  insightUi.phaseLegend = document.getElementById("phase-legend");
}

function stepTimeline(offset) {
  if (simWorker) {
    simWorker.postMessage({ type: "historyStep", offset });
  }
}

function buildStars(targetScene) {
  const count = 1000;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    const radius = 34 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const idx = i * 3;

    positions[idx] = radius * Math.sin(phi) * Math.cos(theta);
    positions[idx + 1] = radius * Math.cos(phi);
    positions[idx + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xc3deff,
    size: 0.04,
    transparent: true,
    opacity: 0.6,
    depthWrite: false
  });

  targetScene.add(new THREE.Points(geo, mat));
}

function buildLayerMeshes(targetScene, layers, radiusMap) {
  const meshes = [];
  layers.forEach((layer, idx) => {
    const radius = radiusMap.get(layer.id);
    const geometry = new THREE.SphereGeometry(radius, 48, 32);
    const material = new THREE.MeshBasicMaterial({
      color: idx % 2 === 0 ? 0xffd27b : 0xb4d2ff,
      transparent: true,
      opacity: 0.1,
      wireframe: true
    });
    const sphere = new THREE.Mesh(geometry, material);
    targetScene.add(sphere);
    meshes.push(sphere);
  });
  return meshes;
}

function buildCities(targetScene, cities, radiusMap) {
  const byCityId = new Map();
  const cityGeo = new THREE.SphereGeometry(0.12, 12, 12);

  for (const city of cities) {
    addCityVisual(targetScene, byCityId, city, radiusMap, cityGeo);
  }

  return byCityId;
}

function buildEdges(targetScene, edges, cityObjects) {
  const byEdgeId = new Map();

  for (const edge of edges) {
    addEdgeVisual(targetScene, byEdgeId, edge, cityObjects);
  }

  return byEdgeId;
}

function syncWorldVisualsIfNeeded(simFrame) {
  if (!simFrame || !Number.isFinite(simFrame.worldVersion)) {
    return;
  }
  if (simFrame.worldVersion === renderedWorldVersion) {
    return;
  }
  renderedWorldVersion = simFrame.worldVersion;
  const cityGeo = new THREE.SphereGeometry(0.12, 12, 12);
  const knownCities = new Set(world.cities.map((c) => c.id));
  for (const city of world.cities) {
    if (!cityObjects.has(city.id)) {
      addCityVisual(scene, cityObjects, city, layerRadiusById, cityGeo);
      const structureMap = buildCityStructures(scene, [city], cityObjects);
      for (const [cityId, structure] of structureMap) {
        cityStructures.set(cityId, structure);
        const cityObj = cityObjects.get(cityId);
        if (cityObj) {
          cityObj.structure = structure;
        }
      }
    }
  }
  for (const [cityId, cityObj] of cityObjects.entries()) {
    if (!knownCities.has(cityId)) {
      cityObj.mesh.visible = false;
      cityObj.label.visible = false;
      if (cityObj.structure) {
        cityObj.structure.root.visible = false;
      }
    }
  }

  const knownEdges = new Set(world.edges.map((e) => e.id));
  for (const edge of world.edges) {
    if (!edgeObjects.has(edge.id)) {
      addEdgeVisual(scene, edgeObjects, edge, cityObjects);
    }
  }
  for (const [edgeId, edgeObj] of edgeObjects.entries()) {
    if (!knownEdges.has(edgeId)) {
      edgeObj.line.visible = false;
    }
  }
  rebuildNationTerritories(nationTerritoryFx, world, cityObjects, [...layerRadiusById.values()]);
}

function createEventFxRenderer(targetScene, cityObjects, shellRadius) {
  const group = new THREE.Group();
  targetScene.add(group);

  const epidemicShell = new THREE.Mesh(
    new THREE.SphereGeometry(shellRadius, 48, 24),
    new THREE.MeshBasicMaterial({
      color: 0x63ffbe,
      transparent: true,
      opacity: 0,
      wireframe: true,
      depthWrite: false
    })
  );
  group.add(epidemicShell);

  const climateShell = new THREE.Mesh(
    new THREE.SphereGeometry(shellRadius * 1.016, 48, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffae7a,
      transparent: true,
      opacity: 0,
      wireframe: true,
      depthWrite: false
    })
  );
  group.add(climateShell);

  return {
    group,
    nodes: new Map(),
    epidemicShell,
    climateShell
  };
}

function syncEventFxNodes(fx, cityObjects) {
  for (const [cityId, cityObj] of cityObjects.entries()) {
    const existing = fx.nodes.get(cityId);
    if (existing) {
      existing.cityObj = cityObj;
      continue;
    }
    const nodeGroup = new THREE.Group();
    fx.group.add(nodeGroup);

    const epidemicRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.013, 8, 40),
      new THREE.MeshBasicMaterial({
        color: 0x6dffbe,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    nodeGroup.add(epidemicRing);

    const disasterSpike = new THREE.Mesh(
      new THREE.ConeGeometry(0.045, 0.22, 9),
      new THREE.MeshBasicMaterial({
        color: 0xffa06f,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    disasterSpike.position.y = 0.12;
    nodeGroup.add(disasterSpike);

    const eventPulse = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createPulseTexture(),
        color: 0x9ed1ff,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    eventPulse.scale.set(0.22, 0.22, 1);
    eventPulse.position.y = 0.16;
    nodeGroup.add(eventPulse);

    fx.nodes.set(cityId, {
      cityObj,
      nodeGroup,
      epidemicRing,
      disasterSpike,
      eventPulse
    });
  }

  for (const [cityId, node] of fx.nodes.entries()) {
    if (!cityObjects.has(cityId)) {
      fx.group.remove(node.nodeGroup);
      fx.nodes.delete(cityId);
    }
  }
}

function updateEventFx(fx, simFrame, simWorld, elapsedSec) {
  if (!fx || !simFrame) {
    return;
  }
  syncEventFxNodes(fx, cityObjects);

  const epidemic = simFrame.system?.epidemicLevel ?? 0;
  const climate = simFrame.system?.climateStress ?? 0;
  fx.epidemicShell.material.opacity = Math.max(0, (epidemic - 0.08) * 0.22);
  fx.climateShell.material.opacity = Math.max(0, (climate - 0.1) * 0.25);
  fx.epidemicShell.rotation.y = elapsedSec * 0.07;
  fx.climateShell.rotation.y = -elapsedSec * 0.05;

  const presence = simFrame.people?.cityPresence ?? {};
  const maxPresence = Math.max(1, ...Object.values(presence));
  const hotByPresence = Object.entries(presence)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 6)
    .map(([cityId]) => cityId);
  const hotSet = new Set(hotByPresence);

  const impactCities = detectImpactedCities(simFrame.people?.events ?? [], simWorld, simFrame.people?.focusCityIds ?? []);
  const impactSet = new Set(impactCities);

  for (const [cityId, node] of fx.nodes.entries()) {
    const cityPos = node.cityObj.position.clone().multiplyScalar(1.022);
    const basis = buildTangentBasis(node.cityObj.position);
    node.nodeGroup.position.copy(cityPos);
    node.nodeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), basis.normal);
    node.nodeGroup.visible = node.cityObj.mesh.visible;

    const density = (presence[cityId] ?? 0) / maxPresence;
    const epiStrength = epidemic * (hotSet.has(cityId) ? 1 : 0.45) * (0.4 + density * 0.8);
    const disasterStrength = climate * (hotSet.has(cityId) ? 0.75 : 0.35);
    const hasImpact = impactSet.has(cityId);

    node.epidemicRing.material.opacity = THREE.MathUtils.clamp(epiStrength * 0.75, 0, 0.72);
    node.epidemicRing.rotation.z = elapsedSec * (0.6 + density * 0.4);
    const epiScale = 1 + Math.sin(elapsedSec * 2.2 + density * 4) * 0.12;
    node.epidemicRing.scale.setScalar(epiScale);

    node.disasterSpike.material.opacity = THREE.MathUtils.clamp(disasterStrength * 0.65, 0, 0.7);
    node.disasterSpike.rotation.y = elapsedSec * 1.3;
    const spikeScale = 0.9 + Math.sin(elapsedSec * 3.6 + density * 5) * 0.18;
    node.disasterSpike.scale.set(1, spikeScale, 1);

    node.eventPulse.material.opacity = hasImpact ? 0.88 : 0;
    const pulse = hasImpact ? 0.9 + Math.sin(elapsedSec * 6.3 + cityId.length * 0.5) * 0.22 : 0.8;
    node.eventPulse.scale.set(0.22 * pulse, 0.22 * pulse, 1);
    node.eventPulse.material.color.setHex(hasImpact ? 0x9ed1ff : 0x6b8aad);
  }
}

function detectImpactedCities(events, simWorld, fallbackCityIds = []) {
  const impacted = new Set();
  const cities = simWorld.cities ?? [];
  for (const event of events) {
    const text = event?.text ?? "";
    const direct = text.match(/^([^:：]+)[:：]/);
    if (direct) {
      const city = cities.find((c) => c.name === direct[1]);
      if (city) {
        impacted.add(city.id);
      }
    }
    for (const city of cities) {
      if (text.includes(city.name)) {
        impacted.add(city.id);
      }
    }
    if (event?.type === "job_crisis" || event?.type === "decline") {
      for (const id of fallbackCityIds.slice(0, 2)) {
        impacted.add(id);
      }
    }
  }
  return [...impacted];
}

function createPulseTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 58);
  g.addColorStop(0, "rgba(220,240,255,0.95)");
  g.addColorStop(0.35, "rgba(160,210,255,0.75)");
  g.addColorStop(1, "rgba(150,190,240,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function createGeopoliticsOverlay(targetScene, cityObjects) {
  const group = new THREE.Group();
  targetScene.add(group);
  return {
    group,
    cityObjects,
    lines: new Map()
  };
}

function updateGeopoliticsOverlay(overlay, simFrame, simWorld, elapsedSec) {
  if (!overlay || !simFrame?.geopolitics) {
    return;
  }
  const relations = simFrame.geopolitics.relations ?? [];
  const nations = simFrame.geopolitics.nations ?? [];
  const nationById = new Map(nations.map((n) => [n.id, n]));
  const active = new Set();

  for (const rel of relations) {
    const key = `${rel.nationAId}|${rel.nationBId}`;
    active.add(key);
    let lineObj = overlay.lines.get(key);
    if (!lineObj) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineBasicMaterial({ color: 0x9bbdff, transparent: true, opacity: 0.2 });
      const line = new THREE.Line(geo, mat);
      overlay.group.add(line);
      lineObj = { line, material: mat };
      overlay.lines.set(key, lineObj);
    }

    const na = nationById.get(rel.nationAId);
    const nb = nationById.get(rel.nationBId);
    const ca = na?.capitalCityId ? overlay.cityObjects.get(na.capitalCityId) : null;
    const cb = nb?.capitalCityId ? overlay.cityObjects.get(nb.capitalCityId) : null;
    if (!ca || !cb) {
      lineObj.line.visible = false;
      continue;
    }
    const curve = makeArc(ca.position, cb.position, 0.95);
    const points = curve.getPoints(28);
    lineObj.line.geometry.setFromPoints(points);
    lineObj.line.visible = true;

    const style = relationVisualStyle(rel, elapsedSec);
    lineObj.material.color.setHex(style.color);
    lineObj.material.opacity = style.opacity;
  }

  for (const [key, row] of overlay.lines.entries()) {
    if (!active.has(key)) {
      row.line.geometry.dispose();
      row.material.dispose();
      overlay.group.remove(row.line);
      overlay.lines.delete(key);
    }
  }
}

function relationVisualStyle(rel, elapsedSec) {
  if (rel.status === "war") {
    return {
      color: 0xff6d6d,
      opacity: 0.4 + Math.abs(Math.sin(elapsedSec * 3.4)) * 0.42
    };
  }
  if (rel.status === "crisis") {
    return {
      color: 0xffb37b,
      opacity: 0.25 + rel.tension * 0.35
    };
  }
  if (rel.status === "alliance") {
    return {
      color: 0x84d3ff,
      opacity: 0.22 + (1 - rel.tension) * 0.2
    };
  }
  return {
    color: 0x9bbdff,
    opacity: 0.12 + rel.tension * 0.2
  };
}

function createNationBorderOverlay(targetScene) {
  const group = new THREE.Group();
  targetScene.add(group);
  return { group, lineSegments: null };
}

function createNationTerritoryOverlay(targetScene) {
  const group = new THREE.Group();
  targetScene.add(group);
  return { group, meshes: [] };
}

function rebuildNationBorders(overlay, simWorld, cityObjects, radius) {
  if (!overlay || !simWorld?.nations?.length) {
    return;
  }
  if (overlay.lineSegments) {
    overlay.lineSegments.geometry.dispose();
    overlay.lineSegments.material.dispose();
    overlay.group.remove(overlay.lineSegments);
    overlay.lineSegments = null;
  }

  const influenceSources = buildNationInfluenceSources(simWorld, cityObjects);
  if (influenceSources.length < 2) {
    return;
  }

  const latSteps = 58;
  const lonSteps = 116;
  const grid = [];
  const nationGrid = [];
  for (let i = 0; i <= latSteps; i += 1) {
    const lat = -85 + (170 * i) / latSteps;
    const row = [];
    const nrow = [];
    for (let j = 0; j <= lonSteps; j += 1) {
      const lon = -180 + (360 * j) / lonSteps;
      const p = latLonToVec3(lat, lon, radius);
      row.push(p);
      nrow.push(resolveNationControlAtPoint(p, influenceSources));
    }
    grid.push(row);
    nationGrid.push(nrow);
  }

  const vertices = [];
  for (let i = 0; i <= latSteps; i += 1) {
    for (let j = 0; j < lonSteps; j += 1) {
      const aId = nationGrid[i][j];
      const bId = nationGrid[i][j + 1];
      if (aId !== bId) {
        const p1 = grid[i][j];
        const p2 = grid[i][j + 1];
        vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }
  }
  for (let i = 0; i < latSteps; i += 1) {
    for (let j = 0; j <= lonSteps; j += 1) {
      const aId = nationGrid[i][j];
      const bId = nationGrid[i + 1][j];
      if (aId !== bId) {
        const p1 = grid[i][j];
        const p2 = grid[i + 1][j];
        vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }
  }

  if (vertices.length === 0) {
    return;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xe8f3ff,
    transparent: true,
    opacity: 0.16,
    depthWrite: false
  });
  overlay.lineSegments = new THREE.LineSegments(geo, mat);
  overlay.group.add(overlay.lineSegments);
}

function rebuildNationTerritories(overlay, simWorld, cityObjects, radii) {
  if (!overlay || !simWorld?.nations?.length || !Array.isArray(radii) || radii.length === 0) {
    return;
  }
  for (const mesh of overlay.meshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
    overlay.group.remove(mesh);
  }
  overlay.meshes = [];

  const influenceSources = buildNationInfluenceSources(simWorld, cityObjects);
  if (influenceSources.length < 2) {
    return;
  }

  for (const radiusBase of radii) {
    const radius = radiusBase + 0.018;
    const latSteps = 34;
    const lonSteps = 68;
    const grid = [];
    const nationGrid = [];

    for (let i = 0; i <= latSteps; i += 1) {
      const lat = -85 + (170 * i) / latSteps;
      const row = [];
      const nrow = [];
      for (let j = 0; j <= lonSteps; j += 1) {
        const lon = -180 + (360 * j) / lonSteps;
        const p = latLonToVec3(lat, lon, radius);
        row.push(p);
        nrow.push(resolveNationControlAtPoint(p, influenceSources));
      }
      grid.push(row);
      nationGrid.push(nrow);
    }

    const triByNation = new Map();
    for (let i = 0; i < latSteps; i += 1) {
      for (let j = 0; j < lonSteps; j += 1) {
        const n00 = nationGrid[i][j];
        const n01 = nationGrid[i][j + 1];
        const n10 = nationGrid[i + 1][j];
        const n11 = nationGrid[i + 1][j + 1];
        if (!(n00 === n01 && n00 === n10 && n00 === n11)) {
          continue;
        }
        const p00 = grid[i][j];
        const p01 = grid[i][j + 1];
        const p10 = grid[i + 1][j];
        const p11 = grid[i + 1][j + 1];
        const arr = triByNation.get(n00) ?? [];
        arr.push(
          p00.x, p00.y, p00.z,
          p10.x, p10.y, p10.z,
          p11.x, p11.y, p11.z,
          p00.x, p00.y, p00.z,
          p11.x, p11.y, p11.z,
          p01.x, p01.y, p01.z
        );
        triByNation.set(n00, arr);
      }
    }

    for (const nation of simWorld.nations) {
      const vertices = triByNation.get(nation.id);
      if (!vertices || vertices.length < 9) {
        continue;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({
        color: nation.color ?? "#9bbdff",
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      overlay.group.add(mesh);
      overlay.meshes.push(mesh);
    }
  }
}

function buildNationInfluenceSources(simWorld, cityObjects) {
  const sources = [];
  for (const nation of simWorld.nations ?? []) {
    const cityIds = nation.cityIds ?? [];
    const cityObjs = cityIds.map((id) => cityObjects.get(id)).filter(Boolean);
    if (cityObjs.length === 0) {
      continue;
    }
    for (const c of cityObjs) {
      const dir = c.position.clone().normalize();
      const populationWeight = Math.max(0.3, (c.city.population ?? 2000) / 12000);
      const productivityWeight = Math.max(0.4, c.city.metrics?.productivity ?? 0.7);
      const weight = populationWeight * 0.65 + productivityWeight * 0.35;
      sources.push({ nationId: nation.id, dir, weight });
    }
  }
  return sources;
}

function resolveNationControlAtPoint(point, sources) {
  const dir = point.clone().normalize();
  const scoreByNation = new Map();
  for (const source of sources) {
    const dot = THREE.MathUtils.clamp(dir.dot(source.dir), -1, 1);
    const angular = 1 - dot;
    const influence = Math.exp(-angular * 9.5) * source.weight;
    scoreByNation.set(source.nationId, (scoreByNation.get(source.nationId) ?? 0) + influence);
  }
  let best = sources[0]?.nationId ?? null;
  let bestScore = -Infinity;
  for (const [nationId, score] of scoreByNation.entries()) {
    if (score > bestScore) {
      bestScore = score;
      best = nationId;
    }
  }
  return best;
}

function addCityVisual(targetScene, byCityId, city, radiusMap, cityGeo) {
  const radius = radiusMap.get(city.layerId) ?? baseRadius;
  const pos = latLonToVec3(city.geo.lat, city.geo.lon, radius);

  const mat = new THREE.MeshStandardMaterial({
    color: CITY_TYPE_COLOR[city.cityType] ?? 0x9ad1ff,
    emissive: 0x243a54,
    metalness: 0.3,
    roughness: 0.35
  });

  const mesh = new THREE.Mesh(cityGeo, mat);
  mesh.position.copy(pos);
  targetScene.add(mesh);

  const label = createCityLabel(`${city.name} (${city.cityType})`);
  label.position.copy(pos.clone().multiplyScalar(1.05));
  targetScene.add(label);

  byCityId.set(city.id, { city, position: pos.clone(), mesh, label });
}

function addEdgeVisual(targetScene, byEdgeId, edge, cityObjects) {
  const from = cityObjects.get(edge.fromCityId);
  const to = cityObjects.get(edge.toCityId);
  if (!from || !to) {
    return;
  }

  const curve = makeArc(from.position, to.position, 0.8);
  const points = curve.getPoints(40);
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0x4f6f92, transparent: true, opacity: 0.35 });
  const line = new THREE.Line(geo, mat);
  targetScene.add(line);

  byEdgeId.set(edge.id, { line, material: mat });
}

function buildCityStructures(targetScene, cities, cityObjects) {
  const byCityId = new Map();

  for (let cityIndex = 0; cityIndex < cities.length; cityIndex += 1) {
    const city = cities[cityIndex];
    const cityObj = cityObjects.get(city.id);
    if (!cityObj) {
      continue;
    }

    const basis = buildTangentBasis(cityObj.position);
    const root = new THREE.Group();
    root.position.copy(cityObj.position.clone().add(basis.normal.clone().multiplyScalar(0.12)));
    root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), basis.normal);

    const farGroup = createFarCityStructure(city, cityIndex);
    const nearGroup = createDetailedCityStructure(city, cityIndex);
    root.add(farGroup);
    root.add(nearGroup);
    targetScene.add(root);

    const farMaterials = collectMaterials(farGroup);
    const nearMaterials = collectMaterials(nearGroup);
    setMaterialOpacity(farMaterials, 1);
    setMaterialOpacity(nearMaterials, 0);
    nearGroup.visible = false;

    byCityId.set(city.id, { root, farGroup, nearGroup, farMaterials, nearMaterials, lodBlend: 0 });
  }

  return byCityId;
}

function createFarCityStructure(city, cityIndex) {
  const group = new THREE.Group();
  const baseGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.025, 18);
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingColor = CITY_TYPE_COLOR[city.cityType] ?? 0x9ad1ff;
  const typeScale = city.cityType === "workHub" ? 1.35 : city.cityType === "mixed" ? 1.1 : 0.9;
  const buildingCount = city.cityType === "workHub" ? 26 : city.cityType === "mixed" ? 20 : 14;
  const populationScale = Math.min(1.8, city.population / 12000);

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x21364f,
    emissive: 0x122136,
    metalness: 0.08,
    roughness: 0.72,
    transparent: true,
    opacity: 0.9
  });
  const base = new THREE.Mesh(baseGeo, baseMaterial);
  base.position.set(0, 0.012, 0);
  group.add(base);

  for (let i = 0; i < buildingCount; i += 1) {
    const seed = hashNoise((cityIndex + 1) * 100 + i * 17);
    const angle = seed * Math.PI * 2;
    const radius = 0.05 + hashNoise((cityIndex + 5) * 70 + i * 29) * 0.18;
    const footprint = 0.018 + hashNoise((cityIndex + 9) * 40 + i * 11) * 0.04;
    const height = (0.08 + hashNoise((cityIndex + 13) * 90 + i * 7) * 0.35) * typeScale * populationScale;

    const buildingMat = new THREE.MeshStandardMaterial({
      color: buildingColor,
      emissive: new THREE.Color(buildingColor).multiplyScalar(0.23),
      metalness: 0.22,
      roughness: 0.45,
      transparent: true,
      opacity: 0.95
    });

    const building = new THREE.Mesh(buildingGeo, buildingMat);
    building.scale.set(footprint, height, footprint);
    building.position.set(Math.cos(angle) * radius, height * 0.5 + 0.022, Math.sin(angle) * radius);
    group.add(building);
  }

  return group;
}

function createDetailedCityStructure(city, cityIndex) {
  const group = new THREE.Group();
  const color = CITY_TYPE_COLOR[city.cityType] ?? 0x9ad1ff;
  const density = city.cityType === "workHub" ? 1.25 : city.cityType === "mixed" ? 1.0 : 0.85;
  const heightBias = city.cityType === "workHub" ? 1.35 : city.cityType === "mixed" ? 1.0 : 0.75;
  const populationFactor = Math.min(1.6, city.population / 9000);
  const layout = buildProceduralCityLayout(city, cityIndex, density, populationFactor);

  addTerrainSurface(group, cityIndex, layout);

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24),
    new THREE.MeshStandardMaterial({
      color: 0x2f4560,
      emissive: 0x1a2d45,
      transparent: true,
      opacity: 0.95
    })
  );
  core.position.set(0, 0.03, 0);
  group.add(core);

  addCityRoadNetwork(group, cityIndex, layout);
  addGeneratedBlocks(group, city, cityIndex, color, heightBias, populationFactor, layout);
  addCityParks(group, cityIndex, layout);
  group.userData.pedestrians = addStreetPedestrians(group, city, cityIndex, layout);
  return group;
}

function buildProceduralCityLayout(city, cityIndex, density, populationFactor) {
  const radius = 0.6;
  const terrain = buildTerrainSampler(cityIndex, radius);
  const ringRoads = [0.17, 0.3, 0.46].map((base, i) => base + (hashNoise(cityIndex * 31 + i * 7) - 0.5) * 0.03);
  const avenueCount = city.cityType === "workHub" ? 10 : city.cityType === "mixed" ? 8 : 6;
  const radialAvenues = [];
  for (let i = 0; i < avenueCount; i += 1) {
    radialAvenues.push((i / avenueCount) * Math.PI * 2 + (hashNoise(cityIndex * 41 + i * 19) - 0.5) * 0.28);
  }

  const roads = [];
  const pedestrianPaths = [];
  for (let i = 0; i < ringRoads.length; i += 1) {
    const r = ringRoads[i];
    const points = createRoadCurvePoints({
      closed: true,
      segments: 72,
      radius: r,
      wobbleAmp: 0.012 + i * 0.004,
      wobbleFreq: 3 + i,
      phase: hashNoise(cityIndex * 53 + i * 11) * Math.PI * 2,
      sampler: terrain.heightAt
    });
    const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.12);
    roads.push({ curve, width: i === 0 ? 0.028 : 0.022, kind: "ring" });
    pedestrianPaths.push({ curve, loop: true });
  }

  for (let i = 0; i < radialAvenues.length; i += 1) {
    const angle = radialAvenues[i];
    const bend = (hashNoise(cityIndex * 61 + i * 29) - 0.5) * 0.08;
    const p0 = new THREE.Vector3(
      Math.cos(angle) * 0.05,
      terrain.heightAt(Math.cos(angle) * 0.05, Math.sin(angle) * 0.05) + 0.038,
      Math.sin(angle) * 0.05
    );
    const p1 = new THREE.Vector3(
      Math.cos(angle + bend) * 0.28,
      terrain.heightAt(Math.cos(angle + bend) * 0.28, Math.sin(angle + bend) * 0.28) + 0.038,
      Math.sin(angle + bend) * 0.28
    );
    const p2 = new THREE.Vector3(
      Math.cos(angle + bend * 0.45) * (radius * 0.92),
      terrain.heightAt(Math.cos(angle + bend * 0.45) * (radius * 0.92), Math.sin(angle + bend * 0.45) * (radius * 0.92)) + 0.038,
      Math.sin(angle + bend * 0.45) * (radius * 0.92)
    );
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2], false, "catmullrom", 0.08);
    roads.push({ curve, width: 0.024, kind: "arterial" });
    pedestrianPaths.push({ curve, loop: false });
  }

  for (let i = 0; i < 4; i += 1) {
    const angle = hashNoise(cityIndex * 79 + i * 13) * Math.PI * 2;
    const dist = 0.24 + hashNoise(cityIndex * 83 + i * 17) * 0.2;
    const len = 0.44 + hashNoise(cityIndex * 89 + i * 19) * 0.18;
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    const axis = angle + Math.PI * 0.5 + (hashNoise(cityIndex * 97 + i * 23) - 0.5) * 0.5;
    const p0x = cx - Math.cos(axis) * len * 0.5;
    const p0z = cz - Math.sin(axis) * len * 0.5;
    const p1x = cx + Math.cos(axis) * len * 0.5;
    const p1z = cz + Math.sin(axis) * len * 0.5;
    const curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(p0x, terrain.heightAt(p0x, p0z) + 0.037, p0z),
        new THREE.Vector3(cx, terrain.heightAt(cx, cz) + 0.037, cz),
        new THREE.Vector3(p1x, terrain.heightAt(p1x, p1z) + 0.037, p1z)
      ],
      false,
      "catmullrom",
      0.08
    );
    roads.push({ curve, width: 0.016, kind: "collector" });
    pedestrianPaths.push({ curve, loop: false });
  }

  const roadSamples = [];
  for (const road of roads) {
    roadSamples.push(...sampleRoadPoints(road.curve, road.kind === "collector" ? 24 : 48));
  }

  const plots = [];
  const step = 0.064;
  for (let x = -radius * 0.95; x <= radius * 0.95; x += step) {
    for (let z = -radius * 0.95; z <= radius * 0.95; z += step) {
      const r = Math.hypot(x, z);
      if (r > radius * 0.92) {
        continue;
      }
      const slope = terrain.slopeAt(x, z);
      if (slope > 0.2) {
        continue;
      }
      const roadDist = distanceToNearestRoadSample(x, z, roadSamples);
      if (roadDist < 0.03) {
        continue;
      }
      const zone = pickZoneFromTerrain(r, terrain.heightAt(x, z), slope, city.cityType);
      const keepProbBase = zone === "urban" ? 0.92 : zone === "suburban" ? 0.72 : 0.48;
      if (hashNoise(cityIndex * 901 + x * 133 + z * 211) > Math.min(0.98, keepProbBase * density)) {
        continue;
      }
      plots.push({
        x: x + (hashNoise(cityIndex * 991 + x * 11 + z * 7) - 0.5) * 0.01,
        z: z + (hashNoise(cityIndex * 1009 + x * 13 + z * 17) - 0.5) * 0.01,
        yaw: hashNoise(cityIndex * 1031 + x * 19 + z * 23) * Math.PI * 2,
        width: 0.028 + hashNoise(cityIndex * 1061 + x * 29 + z * 31) * 0.028,
        depth: 0.03 + hashNoise(cityIndex * 1091 + x * 37 + z * 41) * 0.03,
        zone,
        roadDist
      });
    }
  }

  return {
    radius,
    ringRoads,
    terrain,
    radialAvenues,
    roads,
    plots,
    populationFactor,
    pedestrianPaths
  };
}

function nearestAngularDistance(angle, angles) {
  let min = Infinity;
  for (const a of angles) {
    const d = Math.atan2(Math.sin(angle - a), Math.cos(angle - a));
    min = Math.min(min, Math.abs(d));
  }
  return min;
}

function buildTerrainSampler(cityIndex, radius) {
  const ridgeAngle = hashNoise(cityIndex * 211 + 7) * Math.PI * 2;
  const ridgeFreq = 2 + Math.floor(hashNoise(cityIndex * 211 + 13) * 3);

  function baseHeight(x, z) {
    const nx = x / radius;
    const nz = z / radius;
    const r = Math.hypot(nx, nz);
    const radialFalloff = Math.max(0, 1 - r * r);
    const undulate =
      Math.sin((nx + 0.31) * 6.1) * 0.012 +
      Math.cos((nz - 0.17) * 7.3) * 0.011 +
      Math.sin((nx * 0.7 + nz * 0.9) * 11.2) * 0.006;
    const ridgeAxis = nx * Math.cos(ridgeAngle) + nz * Math.sin(ridgeAngle);
    const ridge = Math.sin(ridgeAxis * ridgeFreq * Math.PI) * 0.014;
    const basin = -Math.max(0, (r - 0.78) * 0.08);
    return undulate * radialFalloff + ridge * (0.55 + radialFalloff * 0.45) + basin;
  }

  function heightAt(x, z) {
    return baseHeight(x, z);
  }

  function slopeAt(x, z) {
    const d = 0.018;
    const hx = (baseHeight(x + d, z) - baseHeight(x - d, z)) / (d * 2);
    const hz = (baseHeight(x, z + d) - baseHeight(x, z - d)) / (d * 2);
    return Math.hypot(hx, hz);
  }

  return { heightAt, slopeAt };
}

function createRoadCurvePoints({ closed, segments, radius, wobbleAmp, wobbleFreq, phase, sampler }) {
  const pts = [];
  const total = closed ? segments : segments + 1;
  for (let i = 0; i < total; i += 1) {
    const t = i / segments;
    const angle = t * Math.PI * 2;
    const r = radius + Math.sin(angle * wobbleFreq + phase) * wobbleAmp;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    pts.push(new THREE.Vector3(x, sampler(x, z) + 0.038, z));
  }
  return pts;
}

function sampleRoadPoints(curve, count) {
  const out = [];
  for (let i = 0; i <= count; i += 1) {
    out.push(curve.getPoint(i / count));
  }
  return out;
}

function distanceToNearestRoadSample(x, z, samples) {
  let min = Infinity;
  for (const p of samples) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < min) {
      min = d;
    }
  }
  return min;
}

function pickZoneFromTerrain(radius, h, slope, cityType) {
  if (slope > 0.16 || radius > 0.48 || h < -0.008) {
    return "rural";
  }
  if (radius < (cityType === "workHub" ? 0.24 : 0.2) && slope < 0.09) {
    return "urban";
  }
  return "suburban";
}

function addTerrainSurface(group, cityIndex, layout) {
  const size = layout.radius * 2.2;
  const geo = new THREE.PlaneGeometry(size, size, 56, 56);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const edgeFade = smoothstep(layout.radius * 0.9, layout.radius * 1.07, r);
    const y = layout.terrain.heightAt(x, z) - edgeFade * 0.085 + 0.024;
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const terrainMesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0x253647,
      emissive: 0x0f1a28,
      roughness: 0.9,
      metalness: 0.02,
      transparent: true,
      opacity: 0.96
    })
  );
  group.add(terrainMesh);

  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(layout.radius * 0.99, 0.008, 8, 96),
    new THREE.MeshStandardMaterial({
      color: 0x32485f,
      emissive: 0x17283b,
      roughness: 0.75,
      metalness: 0.08,
      transparent: true,
      opacity: 0.9
    })
  );
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.02;
  group.add(edge);
}

function pingPong01(v) {
  const m = THREE.MathUtils.euclideanModulo(v, 2);
  return m <= 1 ? m : 2 - m;
}

function addCityRoadNetwork(group, cityIndex, layout) {
  for (const road of layout.roads) {
    const roadMesh = new THREE.Mesh(
      new THREE.TubeGeometry(road.curve, 56, road.width * 0.5, 8, road.kind === "ring"),
      new THREE.MeshStandardMaterial({
        color: road.kind === "collector" ? 0x5d7389 : 0x7089a4,
        emissive: road.kind === "collector" ? 0x263c50 : 0x314c65,
        roughness: 0.62,
        metalness: 0.12,
        transparent: true,
        opacity: 0.96
      })
    );
    group.add(roadMesh);

    if (road.kind !== "collector") {
      const laneMesh = new THREE.Mesh(
        new THREE.TubeGeometry(road.curve, 56, road.width * 0.08, 6, road.kind === "ring"),
        new THREE.MeshStandardMaterial({
          color: 0xe3efff,
          emissive: 0x9bb4d6,
          roughness: 0.4,
          metalness: 0.12,
          transparent: true,
          opacity: 0.78
        })
      );
      group.add(laneMesh);
    }
  }
}

function addGeneratedBlocks(group, city, cityIndex, baseColor, heightBias, populationFactor, layout) {
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  const annexGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.BoxGeometry(1, 1, 1);
  let blockId = 0;

  for (const plot of layout.plots) {
    const seed = hashNoise(cityIndex * 3300 + blockId * 41 + 7);
    const zoneHeight =
      plot.zone === "urban" ? 2.2 : plot.zone === "suburban" ? (city.cityType === "workHub" ? 1.18 : 0.98) : 0.58;
    const towerBoost = plot.zone === "urban" && seed > 0.52 ? 1.55 : 1;
    const height =
      (0.055 + hashNoise(cityIndex * 4100 + blockId * 23 + 11) * 0.24) *
      zoneHeight *
      heightBias *
      populationFactor *
      towerBoost;
    const footprintW = Math.max(0.02, plot.width * (0.45 + hashNoise(cityIndex * 4900 + blockId * 29) * 0.35));
    const footprintD = Math.max(0.02, plot.depth * (0.48 + hashNoise(cityIndex * 5200 + blockId * 31) * 0.35));
    const groundY = layout.terrain.heightAt(plot.x, plot.z) + 0.04;

    const block = new THREE.Mesh(
      blockGeo,
      new THREE.MeshStandardMaterial({
        color:
          plot.zone === "urban"
            ? new THREE.Color(baseColor).lerp(new THREE.Color(0xe4f1ff), 0.18)
            : plot.zone === "suburban"
            ? new THREE.Color(baseColor).lerp(new THREE.Color(0xcbe1f8), 0.28)
            : new THREE.Color(0x8ca87c),
        emissive: new THREE.Color(baseColor).multiplyScalar(0.16),
        roughness: 0.42,
        metalness: 0.2,
        transparent: true,
        opacity: 0.95
      })
    );
    block.scale.set(footprintW, height, footprintD);
    block.position.set(plot.x, height * 0.5 + groundY, plot.z);
    block.rotation.y = plot.yaw + (hashNoise(cityIndex * 6100 + blockId * 17) - 0.5) * 0.16;
    group.add(block);

    if (height > 0.2 && hashNoise(cityIndex * 5000 + blockId * 5) > 0.45) {
      const roof = new THREE.Mesh(
        roofGeo,
        new THREE.MeshStandardMaterial({
          color: 0xbfd5ee,
          emissive: 0x5a7696,
          roughness: 0.35,
          metalness: 0.25,
          transparent: true,
          opacity: 0.9
        })
      );
      roof.scale.set(footprintW * 0.35, 0.012, footprintD * 0.35);
      roof.position.copy(block.position);
      roof.position.y = block.position.y + height * 0.5 + 0.008;
      roof.rotation.y = block.rotation.y;
      group.add(roof);
    }

    if (plot.zone !== "urban" && hashNoise(cityIndex * 7400 + blockId * 13) > 0.52) {
      const annexH = height * (0.35 + hashNoise(cityIndex * 8200 + blockId * 19) * 0.35);
      const annex = new THREE.Mesh(
        annexGeo,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(baseColor).lerp(new THREE.Color(0xd6e7fb), 0.24),
          emissive: 0x2b435e,
          roughness: 0.54,
          metalness: 0.12,
          transparent: true,
          opacity: 0.93
        })
      );
      const dx = Math.cos(plot.yaw) * (footprintW * 0.42);
      const dz = Math.sin(plot.yaw) * (footprintW * 0.42);
      annex.scale.set(footprintW * 0.5, annexH, footprintD * 0.45);
      annex.position.set(plot.x + dx, annexH * 0.5 + 0.04, plot.z + dz);
      annex.rotation.y = block.rotation.y;
      group.add(annex);
    }

    if (plot.zone === "rural" && hashNoise(cityIndex * 9600 + blockId * 5) > 0.45) {
      const lot = new THREE.Mesh(
        new THREE.BoxGeometry(footprintW * 0.95, 0.008, footprintD * 0.95),
        new THREE.MeshStandardMaterial({
          color: 0x3f556b,
          emissive: 0x1c2b3c,
          roughness: 0.8,
          metalness: 0.05,
          transparent: true,
          opacity: 0.85
        })
      );
      lot.position.set(plot.x, groundY + 0.003, plot.z);
      lot.rotation.y = plot.yaw;
      group.add(lot);
    }

    blockId += 1;
  }
}

function addCityParks(group, cityIndex, layout) {
  const parkMat = new THREE.MeshStandardMaterial({
    color: 0x2d7448,
    emissive: 0x123321,
    roughness: 0.9,
    transparent: true,
    opacity: 0.86
  });

  for (let i = 0; i < 5; i += 1) {
    const angle = hashNoise(cityIndex * 870 + i * 31) * Math.PI * 2;
    const radius = 0.16 + hashNoise(cityIndex * 420 + i * 17) * (layout.radius * 0.52);
    const park = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.01, 16), parkMat);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    park.position.set(x, layout.terrain.heightAt(x, z) + 0.03, z);
    park.rotation.y = hashNoise(cityIndex * 1160 + i * 23) * Math.PI;
    group.add(park);
  }
}

function collectMaterials(group) {
  const materials = [];
  group.traverse((obj) => {
    if (!obj.material) {
      return;
    }
    if (Array.isArray(obj.material)) {
      for (const mat of obj.material) {
        tagBaseOpacity(mat);
        materials.push(mat);
      }
      return;
    }
    tagBaseOpacity(obj.material);
    materials.push(obj.material);
  });
  return materials;
}

function tagBaseOpacity(mat) {
  if (mat.userData.baseOpacity === undefined) {
    mat.userData.baseOpacity = mat.opacity ?? 1;
  }
  mat.transparent = true;
}

function setMaterialOpacity(materials, factor) {
  for (const mat of materials) {
    const base = mat.userData.baseOpacity ?? 1;
    mat.opacity = base * factor;
    mat.visible = mat.opacity > 0.01;
  }
}

function updateCityLod(cityObjects, activeCamera, simFrame, elapsedSec) {
  for (const [, cityObj] of cityObjects) {
    if (!cityObj.structure) {
      continue;
    }

    const dist = activeCamera.position.distanceTo(cityObj.position);
    const targetBlend = smoothstep(CITY_LOD.nearOut, CITY_LOD.nearIn, dist);
    cityObj.structure.lodBlend += (targetBlend - cityObj.structure.lodBlend) * 0.12;

    const blend = cityObj.structure.lodBlend;
    cityObj.structure.nearGroup.visible = blend > 0.02;
    cityObj.structure.farGroup.visible = blend < 0.98;
    setMaterialOpacity(cityObj.structure.farMaterials, 1 - blend);
    setMaterialOpacity(cityObj.structure.nearMaterials, blend);

    if (cityObj.structure.nearGroup.visible) {
      const cityLoad = simFrame.people.cityPresence[cityObj.city.id] ?? 0;
      const activityScale = THREE.MathUtils.clamp(cityLoad / 120, 0.35, 1.6);
      updateStreetPedestrians(cityObj.structure.nearGroup.userData.pedestrians ?? [], elapsedSec, activityScale);
    }
  }
}

function addStreetPedestrians(group, city, cityIndex, layout) {
  const pedestrians = [];
  const pedestrianCount = city.cityType === "workHub" ? 42 : city.cityType === "mixed" ? 32 : 24;
  const baseColor = city.cityType === "workHub" ? 0xffd89d : city.cityType === "mixed" ? 0xb5ffd0 : 0xc6d9ff;

  for (let i = 0; i < pedestrianCount; i += 1) {
    const seed = hashNoise(cityIndex * 1000 + i * 19 + 5);
    const path = layout.pedestrianPaths[Math.floor(hashNoise(cityIndex * 1310 + i * 17) * layout.pedestrianPaths.length)];
    const ped = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.0045, 0.022, 3, 6),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(baseColor).offsetHSL((seed - 0.5) * 0.08, 0, 0),
        emissive: 0x314355,
        roughness: 0.5,
        metalness: 0.05,
        transparent: true,
        opacity: 0.95
      })
    );
    ped.castShadow = false;
    group.add(ped);

    pedestrians.push({
      mesh: ped,
      curve: path.curve,
      loop: path.loop,
      baseProgress: seed,
      direction: hashNoise(cityIndex * 1373 + i * 29) > 0.5 ? 1 : -1,
      speed: 0.35 + hashNoise(cityIndex * 250 + i * 29) * 0.9,
      phase: hashNoise(cityIndex * 700 + i * 17) * Math.PI * 2
    });
  }

  return pedestrians;
}

function updateStreetPedestrians(pedestrians, elapsedSec, activityScale) {
  for (const p of pedestrians) {
    const progress = p.baseProgress + elapsedSec * p.speed * activityScale * 0.08 * p.direction;
    const u = p.loop ? THREE.MathUtils.euclideanModulo(progress, 1) : pingPong01(progress);
    const point = p.curve.getPointAt(u);
    const tangent = p.curve.getTangentAt(u);
    p.mesh.position.copy(point);
    p.mesh.position.y += 0.01 + Math.sin(elapsedSec * 8 * p.speed + p.phase) * 0.0022;
    p.mesh.rotation.y = -Math.atan2(tangent.z, tangent.x) + Math.PI * 0.5;
  }
}

function buildFlowParticleMeshes(simFrame, cityObjects, particleColor) {
  const meshes = [];
  const particles = Array.isArray(simFrame?.particles) ? simFrame.particles : [];

  for (const particle of particles) {
    const source = cityObjects.get(particle.sourceCityId);
    const target = cityObjects.get(particle.targetCityId);
    if (!source || !target) {
      continue;
    }

    const scaled = Math.floor(particle.particleCount * runtimeTuning.flowParticleMultiplier);
    const count = Math.max(1, Math.min(runtimeTuning.flowParticleCap, scaled));
    const points = new Float32Array(count * 3);
    const offsets = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      offsets[i] = i / count;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));

    const material = new THREE.PointsMaterial({
      color: particleColor,
      size: 0.045 + Math.min(0.03, count / 3000),
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    });

    const curve = makeArc(source.position, target.position, 0.55 + particle.congestionHint * 0.5);
    const pointsMesh = new THREE.Points(geometry, material);

    meshes.push({
      points: pointsMesh,
      curve,
      offsets,
      speed: 0.08 + (1 - particle.congestionHint) * 0.3
    });
  }

  return meshes;
}

function replaceParticles(simFrame, cityObjects, particleColor) {
  for (const mesh of particleMeshes) {
    mesh.points.geometry.dispose();
    mesh.points.material.dispose();
    particleGroup.remove(mesh.points);
  }

  particleMeshes = buildFlowParticleMeshes(simFrame, cityObjects, particleColor);
  for (const mesh of particleMeshes) {
    particleGroup.add(mesh.points);
  }
}

function createHumanLodRenderer(targetScene) {
  const farGroup = new THREE.Group();
  const midGroup = new THREE.Group();
  const nearGroup = new THREE.Group();
  const nearLabelGroup = new THREE.Group();
  targetScene.add(farGroup);
  targetScene.add(midGroup);
  targetScene.add(nearGroup);
  targetScene.add(nearLabelGroup);

  const silhouetteTexture = createSilhouetteTexture();
  const nearBodyMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.03, 0.036, 0.15, 8),
    new THREE.MeshStandardMaterial({ color: 0xc9defa, metalness: 0.1, roughness: 0.65 }),
    360
  );
  nearBodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nearBodyMesh.count = 0;
  nearGroup.add(nearBodyMesh);

  const nearHeadMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.038, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8f2ff, metalness: 0.08, roughness: 0.5 }),
    360
  );
  nearHeadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nearHeadMesh.count = 0;
  nearGroup.add(nearHeadMesh);

  return {
    mode: "mid",
    farGroup,
    midGroup,
    nearGroup,
    nearLabelGroup,
    silhouetteTexture,
    nearBodyMesh,
    nearHeadMesh,
    farPoints: null,
    midSprites: [],
    nearActors: [],
    showNameLabels,
    nameTextureCache: new Map()
  };
}

function rebuildHumanLod(rendererState, simFrame, cityObjects, activeCamera) {
  const mode = pickHumanLodMode(activeCamera, cityObjects, rendererState.mode);
  rendererState.mode = mode;

  rendererState.farGroup.visible = mode === "far";
  rendererState.midGroup.visible = mode === "mid";
  rendererState.nearGroup.visible = mode === "near";
  rendererState.nearLabelGroup.visible = mode === "near" && rendererState.showNameLabels;

  if (mode === "far") {
    rebuildFarHumanDensity(rendererState, simFrame, cityObjects);
  } else if (mode === "mid") {
    rebuildMidHumanBillboards(rendererState, simFrame, cityObjects);
  } else {
    rebuildNearHumanFigures(rendererState, simFrame, cityObjects, activeCamera);
  }
}

function animateHumanLod(rendererState, elapsedSec) {
  if (rendererState.mode === "mid") {
    for (const item of rendererState.midSprites) {
      const t = elapsedSec * item.motion.spin + item.motion.phase;
      const radial = item.motion.radius * (1 + Math.sin(t * 0.9) * 0.15);
      const tangent = item.basis.tangent.clone().multiplyScalar(Math.cos(t) * radial);
      const bitangent = item.basis.bitangent.clone().multiplyScalar(Math.sin(t) * radial);
      const normal = item.basis.normal.clone().multiplyScalar(item.motion.height);
      item.sprite.position.copy(item.center).add(tangent).add(bitangent).add(normal);
    }
  }

  if (rendererState.mode === "near") {
    const bodyDummy = new THREE.Object3D();
    const headDummy = new THREE.Object3D();
    let i = 0;
    for (const actor of rendererState.nearActors) {
      const t = elapsedSec * actor.motion.spinSpeed + actor.motion.phase;
      const radial = actor.motion.radius * (1 + Math.sin(t * actor.motion.wobbleSpeed) * 0.15);
      const tangent = actor.basis.tangent.clone().multiplyScalar(Math.cos(t) * radial);
      const bitangent = actor.basis.bitangent.clone().multiplyScalar(Math.sin(t) * radial);
      const normal = actor.basis.normal.clone().multiplyScalar(actor.motion.height);
      const pos = actor.center.clone().add(tangent).add(bitangent).add(normal);
      const yaw = -t + Math.PI * 0.5;

      bodyDummy.position.copy(pos);
      bodyDummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), actor.basis.normal);
      bodyDummy.rotateOnAxis(actor.basis.normal, yaw);
      bodyDummy.scale.setScalar(1 + Math.sin(t * 1.8) * 0.04);
      bodyDummy.updateMatrix();
      rendererState.nearBodyMesh.setMatrixAt(i, bodyDummy.matrix);
      rendererState.nearBodyMesh.setColorAt(i, new THREE.Color(actor.color));

      headDummy.position.copy(pos).add(actor.basis.normal.clone().multiplyScalar(0.105));
      headDummy.scale.setScalar(1);
      headDummy.updateMatrix();
      rendererState.nearHeadMesh.setMatrixAt(i, headDummy.matrix);
      rendererState.nearHeadMesh.setColorAt(i, new THREE.Color(0xe8f2ff));
      if (actor.labelSprite) {
        actor.labelSprite.position.copy(pos).add(actor.basis.normal.clone().multiplyScalar(0.16));
      }
      i += 1;
    }
    rendererState.nearBodyMesh.count = i;
    rendererState.nearHeadMesh.count = i;
    rendererState.nearBodyMesh.instanceMatrix.needsUpdate = true;
    rendererState.nearHeadMesh.instanceMatrix.needsUpdate = true;
    if (rendererState.nearBodyMesh.instanceColor) {
      rendererState.nearBodyMesh.instanceColor.needsUpdate = true;
    }
    if (rendererState.nearHeadMesh.instanceColor) {
      rendererState.nearHeadMesh.instanceColor.needsUpdate = true;
    }
  }
}

function pickHumanLodMode(activeCamera, cityObjects, previous) {
  let minDist = Infinity;
  for (const [, cityObj] of cityObjects) {
    minDist = Math.min(minDist, activeCamera.position.distanceTo(cityObj.position));
  }
  const nearIn = 12.4;
  const nearOut = 14.2;
  const midOut = 22.2;
  const midIn = 20.4;

  if (previous === "near") {
    if (minDist <= nearOut) {
      return "near";
    }
    return minDist <= midOut ? "mid" : "far";
  }
  if (previous === "mid") {
    if (minDist <= nearIn) {
      return "near";
    }
    if (minDist >= midOut) {
      return "far";
    }
    return "mid";
  }
  if (minDist <= nearIn) {
    return "near";
  }
  if (minDist <= midIn) {
    return "mid";
  }
  return "far";
}

function rebuildFarHumanDensity(rendererState, simFrame, cityObjects) {
  if (rendererState.farPoints) {
    rendererState.farPoints.geometry.dispose();
    rendererState.farPoints.material.dispose();
    rendererState.farGroup.remove(rendererState.farPoints);
    rendererState.farPoints = null;
  }

  const positions = [];
  for (const [cityId, count] of Object.entries(simFrame.people.cityPresence)) {
    const cityObj = cityObjects.get(cityId);
    if (!cityObj) {
      continue;
    }
    const basis = buildTangentBasis(cityObj.position);
    const pointCount = Math.min(
      runtimeTuning.farDensityCap,
      Math.max(4, Math.floor(count / Math.max(1, runtimeTuning.farDensityDivisor)))
    );
    for (let i = 0; i < pointCount; i += 1) {
      const angle = hashNoise(i * 31 + count * 17) * Math.PI * 2;
      const radius = 0.05 + hashNoise(i * 47 + count * 11) * 0.28;
      const tangent = basis.tangent.clone().multiplyScalar(Math.cos(angle) * radius);
      const bitangent = basis.bitangent.clone().multiplyScalar(Math.sin(angle) * radius);
      const normal = basis.normal.clone().multiplyScalar(0.06);
      const p = cityObj.position.clone().add(tangent).add(bitangent).add(normal);
      positions.push(p.x, p.y, p.z);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xaec8e8,
    size: 0.07,
    transparent: true,
    opacity: 0.82,
    depthWrite: false
  });
  rendererState.farPoints = new THREE.Points(geo, mat);
  rendererState.farGroup.add(rendererState.farPoints);
}

function rebuildMidHumanBillboards(rendererState, simFrame, cityObjects) {
  for (const item of rendererState.midSprites) {
    rendererState.midGroup.remove(item.sprite);
    item.sprite.material.dispose();
  }
  rendererState.midSprites = [];

  for (const person of (simFrame.people.activeIndividuals ?? []).slice(0, runtimeTuning.midSpriteLimit)) {
    const cityObj = cityObjects.get(person.cityId);
    if (!cityObj) {
      continue;
    }
    const color = PERSON_STATE_COLOR[person.state] ?? 0xbcd7ff;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: rendererState.silhouetteTexture,
        color,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      })
    );
    sprite.scale.set(0.24, 0.36, 1);
    rendererState.midGroup.add(sprite);

    rendererState.midSprites.push({
      sprite,
      center: cityObj.position.clone(),
      basis: buildTangentBasis(cityObj.position),
      motion: buildMotionProfile(person.id, person.state)
    });
  }
}

function rebuildNearHumanFigures(rendererState, simFrame, cityObjects, activeCamera) {
  for (const actor of rendererState.nearActors) {
    if (actor.labelSprite) {
      rendererState.nearLabelGroup.remove(actor.labelSprite);
      actor.labelSprite.material.dispose();
    }
  }
  rendererState.nearActors = [];

  const nearestCityIds = [...cityObjects.values()]
    .sort((a, b) => activeCamera.position.distanceTo(a.position) - activeCamera.position.distanceTo(b.position))
    .slice(0, 2)
    .map((item) => item.city.id);
  const nearestSet = new Set(nearestCityIds);
  const nearSource = simFrame.people.nearIndividuals ?? simFrame.people.activeIndividuals;
  const nearbyPeople = nearSource.filter((person) => nearestSet.has(person.cityId));

  rendererState.nearActors = nearbyPeople
    .slice(0, runtimeTuning.nearActorLimit)
    .map((person) => {
      const cityObj = cityObjects.get(person.cityId);
      if (!cityObj) {
        return null;
      }
      return {
        id: person.id,
        name: person.name,
        state: person.state,
        color: PERSON_STATE_COLOR[person.state] ?? 0xbcd7ff,
        center: cityObj.position.clone(),
        basis: buildTangentBasis(cityObj.position),
        motion: buildMotionProfile(person.id, person.state),
        labelSprite: null
      };
    })
    .filter(Boolean);

  if (rendererState.showNameLabels) {
    for (let i = 0; i < rendererState.nearActors.length; i += 1) {
      if (i >= runtimeTuning.maxNameLabels) {
        break;
      }
      const actor = rendererState.nearActors[i];
      actor.labelSprite = createNameSprite(actor.name, rendererState.nameTextureCache);
      if (actor.labelSprite) {
        rendererState.nearLabelGroup.add(actor.labelSprite);
      }
    }
  }
}

function createNameSprite(name, cache) {
  const key = name || "-";
  let texture = cache.get(key);
  if (!texture) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(6,18,35,0.78)";
    ctx.fillRect(0, 16, canvas.width, 34);
    ctx.strokeStyle = "rgba(168,206,255,0.85)";
    ctx.strokeRect(0, 16, canvas.width, 34);
    ctx.font = "22px IBM Plex Sans, Noto Sans JP, sans-serif";
    ctx.fillStyle = "#e2f0ff";
    ctx.fillText(key, 10, 40);
    texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    cache.set(key, texture);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.93
    })
  );
  sprite.scale.set(0.54, 0.14, 1);
  return sprite;
}

function createSilhouetteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(32, 18, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(21, 58);
  ctx.lineTo(43, 58);
  ctx.lineTo(39, 28);
  ctx.lineTo(25, 28);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function updateParticleAnimation(phaseT, elapsedSec) {
  for (const mesh of particleMeshes) {
    const positions = mesh.points.geometry.attributes.position.array;

    for (let i = 0; i < mesh.offsets.length; i += 1) {
      const t = (mesh.offsets[i] + phaseT * mesh.speed + elapsedSec * 0.015) % 1;
      const point = mesh.curve.getPoint(t);
      const idx = i * 3;
      positions[idx] = point.x;
      positions[idx + 1] = point.y;
      positions[idx + 2] = point.z;
    }

    mesh.points.geometry.attributes.position.needsUpdate = true;
  }
}

function updateLayerRotation(layerMeshes, elapsedSec) {
  for (let i = 0; i < layerMeshes.length; i += 1) {
    const mesh = layerMeshes[i];
    const direction = i % 2 === 0 ? 1 : -1;
    const speed = 0.018 + i * 0.004;
    mesh.rotation.y = elapsedSec * speed * direction;
    mesh.rotation.x = elapsedSec * speed * 0.42 * -direction;
  }
}

function updateEdgeStyle(edgeObjects, simFrame, phaseStyle) {
  const flows = Array.isArray(simFrame?.flows) ? simFrame.flows : [];
  const maxFlow = Math.max(1, ...flows.map((item) => (item.outbound ?? 0) + (item.inbound ?? 0)));

  for (const flow of flows) {
    const edgeObj = edgeObjects.get(flow.edgeId);
    if (!edgeObj) {
      continue;
    }

    const intensity = (flow.outbound + flow.inbound) / maxFlow;
    const color = new THREE.Color(phaseStyle.edgeBase).lerp(new THREE.Color(0xeef7ff), intensity * 0.75);
    if (flow.gatewayRestriction === "permit") {
      color.lerp(new THREE.Color(0xffd27b), 0.4);
    } else if (flow.gatewayRestriction === "sealed") {
      color.lerp(new THREE.Color(0xff7b7b), 0.75);
    }

    edgeObj.material.color.copy(color);
    edgeObj.material.opacity = flow.gatewayRestriction === "sealed" ? 0.12 : 0.25 + intensity * 0.65;
  }
}

function applyPhaseStyle(phaseStyle) {
  scene.fog.color.setHex(phaseStyle.fog);
  ambientLight.color.setHex(phaseStyle.ambient);
  controls.autoRotateSpeed = phaseStyle.autoRotateSpeed;
}

function updateFocusHighlight(cityObjects, focusCityIds) {
  const focusSet = new Set(Array.isArray(focusCityIds) ? focusCityIds : []);

  for (const [, cityObj] of cityObjects) {
    const isFocus = focusSet.has(cityObj.city.id);
    cityObj.mesh.scale.setScalar(isFocus ? 1.5 : 1);
    cityObj.mesh.material.emissive.setHex(isFocus ? 0x3f6ea1 : 0x243a54);
    cityObj.label.material.opacity = isFocus ? 1 : 0.75;
    if (cityObj.structure) {
      cityObj.structure.root.scale.setScalar(isFocus ? 1.2 : 1);
    }
  }
}

function applyCameraMotion(elapsedSec, phase) {
  const amp = phase === "Night" ? 0.17 : 0.11;
  camera.position.y += Math.sin(elapsedSec * 0.35) * amp * 0.003;
}

function buildTangentBasis(position) {
  const normal = position.clone().normalize();
  const up = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(up, normal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return { normal, tangent, bitangent };
}

function buildMotionProfile(personId, state) {
  const seed = hashNoise(personId);
  const stateSpeed = {
    Home: 0.35,
    Commute: 1.15,
    Work: 0.55,
    Leisure: 0.85,
    Sleep: 0.2
  };

  return {
    radius: 0.08 + seed * 0.2,
    height: 0.04 + seed * 0.05,
    baseAngle: seed * Math.PI * 2,
    phase: hashNoise(personId + 17) * Math.PI * 2,
    spinSpeed: stateSpeed[state] ?? 0.5,
    wobbleSpeed: 0.9 + hashNoise(personId + 31) * 1.6
  };
}

function hashNoise(value) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function updateHud(simFrame, simWorld) {
  const safeFrame = simFrame ?? buildFallbackFrame();
  const people = safeFrame.people ?? {};
  const flows = Array.isArray(safeFrame.flows) ? safeFrame.flows : [];
  const stateCounts = people.stateCounts ?? {};
  const encounterSummary = people.encounterSummary ?? {};
  const resolvedWorld =
    typeof simWorld?.getCityById === "function"
      ? simWorld
      : hydrateWorld(simWorld ?? world);
  const outbound = flows.reduce((sum, item) => sum + (item.outbound ?? 0), 0);
  const inbound = flows.reduce((sum, item) => sum + (item.inbound ?? 0), 0);
  const s = {
    Home: stateCounts.Home ?? 0,
    Commute: stateCounts.Commute ?? 0,
    Work: stateCounts.Work ?? 0,
    Leisure: stateCounts.Leisure ?? 0,
    Sleep: stateCounts.Sleep ?? 0
  };

  hud.time.textContent = safeFrame.time ?? "-";
  hud.phase.textContent = safeFrame.phase ?? "-";
  hud.week.textContent = formatWeek(safeFrame.dayOfWeek, safeFrame.isWeekend);
  hud.flow.textContent = `out ${outbound} / in ${inbound}`;
  hud.humanLod.textContent = humanLodRenderer.mode.toUpperCase();
  hud.nameLabels.textContent = showNameLabels ? "ON" : "OFF";
  hud.states.textContent = `H:${s.Home} C:${s.Commute} W:${s.Work} L:${s.Leisure} S:${s.Sleep}`;
  hud.encounters.textContent = String(encounterSummary.total ?? 0);
  hud.focus.textContent = (people.focusCityIds ?? [])
    .map((id) => resolvedWorld.getCityById(id)?.name ?? id)
    .join(", ");
  hud.religionCounts.textContent = formatReligionCounts(people.religionStats);
  hud.religionInfluence.textContent = formatReligionInfluence(people.religionStats);
  hud.religionDoctrine.textContent = formatReligionDoctrine(people.religionStats);
  hud.demoTotal.textContent = formatDemographicTotals(people.demographics);
  hud.demoCity.textContent = formatDemographicByCity(people.demographics, resolvedWorld);
  hud.economy.textContent = formatEconomy(people.economy, resolvedWorld);
  hud.companyTop.textContent = formatTopCompanies(people.companies, resolvedWorld);
  hud.companyCity.textContent = formatCompaniesByCity(people.companies, resolvedWorld);
  hud.macroSystem.textContent = formatMacroSystem(safeFrame.system);
  hud.nations.textContent = formatNationSummary(safeFrame.geopolitics);
  hud.metaOrder.textContent = formatMetaOrderSummary(safeFrame.geopolitics);
  hud.diplomacy.textContent = formatDiplomacySummary(safeFrame.geopolitics);
  hud.alliances.textContent = formatAllianceSummary(safeFrame.geopolitics);
  hud.hostilities.textContent = formatHostilitySummary(safeFrame.geopolitics);
  hud.military.textContent = formatMilitarySummary(safeFrame.geopolitics, resolvedWorld);
  hud.events.textContent = formatEvents(people.events);
  hud.nationEvents.textContent = formatNationEventSummary(people.events);
  hud.history.textContent = formatHistory(safeFrame);
  hud.lineageSummary.textContent = people.lineage?.summary ?? "-";
  hud.lineageTree.textContent = formatLineageTree(people.lineage?.treeLines);
  const graphMeta = renderLineageGraph(people.lineage);
  const selectedName = graphMeta?.selectedName ? ` | SELECTED: ${graphMeta.selectedName}` : "";
  hud.lineageGraphTitle.textContent = `LINEAGE GRAPH | ${people.lineage?.summary ?? "-"}${selectedName}`;

  const top = people.highlights ?? {};
  hud.topEcon.textContent = formatHighlight(top.economicPower, resolvedWorld);
  hud.topCog.textContent = formatHighlight(top.cognitive, resolvedWorld);
  hud.topSoc.textContent = formatHighlight(top.sociability, resolvedWorld);
  const gs = people.geneticsSummary;
  hud.topGene.textContent = formatHighlight(gs?.topPotential, resolvedWorld);
  hud.topEpi.textContent = formatHighlight(gs?.topEpigeneticShift, resolvedWorld);
  hud.geneDiversity.textContent = gs ? `P:${gs.diversity.personality} / A:${gs.diversity.ability}` : "-";
  if (insightUi.populationBoard) {
    insightUi.populationBoard.textContent = formatPopulationBoard(safeFrame, resolvedWorld);
  }
  if (insightUi.cityNewsBoard) {
    insightUi.cityNewsBoard.textContent = formatCityNewsBoard(safeFrame, resolvedWorld);
  }
  if (insightUi.stockBoard) {
    renderStockMarketBoard(safeFrame, resolvedWorld);
  }
  if (insightUi.phaseBoard) {
    renderPhaseBoard(safeFrame);
  }
  updateAmbientAudioForPhase(safeFrame.phase ?? "Night");

  if (timelineUi.range && Number.isFinite(safeFrame.historyCursor)) {
    const max = Math.max(1, (safeFrame.historyLength ?? safeFrame.historyCursor + 1) - 1);
    timelineUi.range.max = String(max);
    timelineUi.range.value = String(Math.max(0, safeFrame.historyCursor));
    timelineUi.status.textContent = timelineMode
      ? `Timeline ${safeFrame.historyCursor + 1}/${max + 1}`
      : "Live";
  }
}

function formatReligionCounts(rows) {
  if (!rows || rows.length === 0) {
    return "-";
  }
  return rows.map((row) => `${row.religion}:${row.count}人(${row.share}%)`).join(" | ");
}

function formatReligionInfluence(rows) {
  if (!rows || rows.length === 0) {
    return "-";
  }
  return rows.map((row) => `${row.religion}:${row.influence}`).join(" | ");
}

function formatReligionDoctrine(rows) {
  if (!rows || rows.length === 0) {
    return "-";
  }
  return rows
    .slice(0, 3)
    .map((row) => `${row.religion}:${row.doctrine}`)
    .join(" | ");
}

function formatWeek(dayOfWeek, isWeekend) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const i = Number.isFinite(dayOfWeek) ? dayOfWeek : 0;
  return `${labels[Math.max(0, Math.min(labels.length - 1, i))]}${isWeekend ? " (Weekend)" : ""}`;
}

function formatDemographicTotals(demo) {
  if (!demo) {
    return "-";
  }
  return (
    `出生:${demo.totalBirths} / 死亡:${demo.totalDeaths} / 婚姻:${demo.totalMarriages ?? 0} / ` +
    `離婚:${demo.totalDivorces ?? 0} / 同居:${demo.currentCohabitingCouples ?? 0}/${demo.currentCouples ?? 0} / ` +
    `純増:${demo.totalBirths - demo.totalDeaths}`
  );
}

function formatDemographicByCity(demo, simWorld) {
  if (!demo || !demo.cityStats) {
    return "-";
  }

  const rows = demo.cityStats
    .filter((row) => row.births > 0 || row.deaths > 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 5);

  if (rows.length === 0) {
    return "変化なし";
  }

  return rows
    .map((row) => {
      const name = simWorld.getCityById(row.cityId)?.name ?? row.cityId;
      return `${name}(+${row.births}/-${row.deaths}/婚${row.marriages ?? 0}/離${row.divorces ?? 0})`;
    })
    .join(" | ");
}

function formatEconomy(economy, simWorld) {
  if (!economy) {
    return "-";
  }
  const topCity = (economy.byCity ?? [])
    .slice()
    .sort((a, b) => b.avgIncome - a.avgIncome)[0];
  if (!topCity) {
    return `平均所得:${economy.avgIncome} / 失業率:${economy.unemploymentRate}%`;
  }
  const cityName = simWorld.getCityById(topCity.cityId)?.name ?? topCity.cityId;
  return `平均所得:${economy.avgIncome} / 失業率:${economy.unemploymentRate}% / 最高:${cityName}`;
}

function formatTopCompanies(companies, simWorld) {
  const rows = companies?.topCompanies ?? [];
  if (rows.length === 0) {
    return "-";
  }
  return rows
    .slice(0, 2)
    .map((c) => {
      const city = simWorld.getCityById(c.cityId)?.name ?? c.cityId;
      return `${c.listed ? "★" : ""}${c.name}(利${c.profit}/株${c.stock})@${city}`;
    })
    .join(" | ");
}

function formatCompaniesByCity(companies, simWorld) {
  const rows = companies?.byCity ?? [];
  if (rows.length === 0) {
    return "-";
  }
  return rows
    .slice()
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 3)
    .map((r) => {
      const city = simWorld.getCityById(r.cityId)?.name ?? r.cityId;
      return `${city}:${r.companies}社/利${r.profit}`;
    })
    .join(" | ");
}

function formatEvents(events) {
  if (!events || events.length === 0) {
    return "なし";
  }
  return events.slice(0, 2).map((e) => e.text).join(" | ");
}

function formatNationEventSummary(events) {
  const rows = (events ?? []).filter((e) => ["nation_founded", "territory_shift", "nation_extinct"].includes(e?.type));
  if (rows.length === 0) {
    return "なし";
  }
  const founded = rows.filter((e) => e.type === "nation_founded").length;
  const shifts = rows.filter((e) => e.type === "territory_shift").length;
  const extinct = rows.filter((e) => e.type === "nation_extinct").length;
  const latest = rows[0]?.text ?? "-";
  return `建国:${founded} 領土変化:${shifts} 消滅:${extinct} | 最新:${latest}`;
}

function formatPopulationBoard(simFrame, simWorld) {
  const tracked = Object.values(simFrame.people.stateCounts ?? {}).reduce((sum, v) => sum + v, 0);
  const stats = simFrame.people.statisticalPopulation ?? {};
  const estimated = Object.values(stats).reduce((sum, row) => sum + (row.estimatedTotal ?? 0), 0);
  const rows = [`追跡人口: ${tracked}人`, `推定総人口: ${estimated}人`];
  const top = Object.entries(stats)
    .sort((a, b) => (b[1].estimatedTotal ?? 0) - (a[1].estimatedTotal ?? 0))
    .slice(0, 4);
  for (const [cityId, row] of top) {
    const name = simWorld.getCityById(cityId)?.name ?? cityId;
    rows.push(`${name}: 推定${row.estimatedTotal} / 追跡${row.tracked}`);
  }
  return rows.join("\n");
}

function formatCityNewsBoard(simFrame, simWorld) {
  const events = simFrame.people.events ?? [];
  const cityStats = simFrame.people.demographics?.cityStats ?? [];
  const lines = [];
  for (const e of events.slice(0, 6)) {
    lines.push(`• ${e.text}`);
  }
  const movers = cityStats
    .slice()
    .sort((a, b) => Math.abs((b.net ?? 0)) - Math.abs((a.net ?? 0)))
    .slice(0, 3);
  for (const row of movers) {
    const name = simWorld.getCityById(row.cityId)?.name ?? row.cityId;
    lines.push(`• ${name}: 出生${row.births} 死亡${row.deaths} 純増${row.net}`);
  }
  if (lines.length === 0) {
    return "ニュースなし";
  }
  return lines.join("\n");
}

function formatStockBoard(simFrame, simWorld) {
  const rows = simFrame.people.companies?.topCompanies ?? [];
  if (rows.length === 0) {
    return "企業データなし";
  }
  return rows
    .slice(0, 8)
    .map((c, i) => {
      const city = simWorld.getCityById(c.cityId)?.name ?? c.cityId;
      const mark = c.listed ? "★" : " ";
      return `${i + 1}. ${mark}${c.name}  株:${c.stock}  利:${c.profit}  都市:${city}`;
    })
    .join("\n");
}

function renderStockMarketBoard(simFrame, simWorld) {
  ensureStockBoardUi();
  if (!insightUi.stockBoard || !insightUi.stockCanvas || !insightUi.stockTape || !insightUi.stockTable || !insightUi.stockSummary) {
    return;
  }
  const rows = simFrame.people.companies?.topCompanies ?? [];
  if (rows.length === 0) {
    insightUi.stockSummary.textContent = "MARKET: N/A";
    insightUi.stockTape.textContent = "企業データなし";
    insightUi.stockTable.textContent = "";
    drawMarketIndexChart(insightUi.stockCanvas, stockVizState.indexHistory, false);
    return;
  }

  const indexValue = rows.reduce((sum, row) => sum + (row.stock ?? 1), 0) / Math.max(1, rows.length);
  pushLimited(stockVizState.indexHistory, indexValue, stockVizState.maxPoints);
  for (const row of rows) {
    const history = stockVizState.companyHistories.get(row.id) ?? [];
    pushLimited(history, row.stock ?? 1, stockVizState.maxPoints);
    stockVizState.companyHistories.set(row.id, history);
  }

  const prevIndex = stockVizState.indexHistory.at(-2) ?? indexValue;
  const indexDelta = indexValue - prevIndex;
  const indexPct = prevIndex !== 0 ? (indexDelta / prevIndex) * 100 : 0;
  const indexUp = indexDelta >= 0;
  insightUi.stockSummary.innerHTML =
    `SNC 100  ${indexValue.toFixed(3)}  ` +
    `<span class="${indexUp ? "stock-up" : "stock-down"}">${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)} (${indexPct >= 0 ? "+" : ""}${indexPct.toFixed(2)}%)</span>`;

  drawMarketIndexChart(insightUi.stockCanvas, stockVizState.indexHistory, indexUp);

  insightUi.stockTape.innerHTML = rows
    .slice(0, 6)
    .map((row) => {
      const symbol = toTicker(row.name);
      const hist = stockVizState.companyHistories.get(row.id) ?? [];
      const prev = hist.at(-2) ?? row.stock;
      const delta = row.stock - prev;
      const cls = delta >= 0 ? "stock-up" : "stock-down";
      const sign = delta >= 0 ? "+" : "";
      return `<span class="stock-tape-item"><strong>${symbol}</strong> <span class="${cls}">${row.stock.toFixed(3)} (${sign}${delta.toFixed(3)})</span></span>`;
    })
    .join("");

  const head = `<div class="stock-row stock-head"><span>SYMBOL</span><span>LAST</span><span>CHG%</span><span>P/L</span><span>CITY</span></div>`;
  const body = rows
    .slice(0, 8)
    .map((row) => {
      const symbol = toTicker(row.name);
      const city = simWorld.getCityById(row.cityId)?.name ?? row.cityId;
      const hist = stockVizState.companyHistories.get(row.id) ?? [];
      const prev = hist.at(-2) ?? row.stock;
      const delta = row.stock - prev;
      const pct = prev !== 0 ? (delta / prev) * 100 : 0;
      const cls = delta >= 0 ? "stock-up" : "stock-down";
      const listed = row.listed ? "★" : "";
      return (
        `<div class="stock-row">` +
        `<span>${listed}${symbol}</span>` +
        `<span>${row.stock.toFixed(3)}</span>` +
        `<span class="${cls}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>` +
        `<span class="${row.profit >= 0 ? "stock-up" : "stock-down"}">${row.profit.toFixed(3)}</span>` +
        `<span>${city}</span>` +
        `</div>`
      );
    })
    .join("");
  insightUi.stockTable.innerHTML = head + body;
}

function renderPhaseBoard(simFrame) {
  ensurePhaseBoardUi();
  if (!insightUi.phaseBoard || !insightUi.phaseCanvas || !insightUi.phaseSummary) {
    return;
  }
  const indicators = simFrame.people?.phaseIndicators ?? {};
  const regimes = simFrame.people?.phaseRegimes ?? {};
  const shock = Number(indicators.shockScore ?? 0);
  const recovery = Number(indicators.recoveryScore ?? 0);
  const instability = Number(indicators.avgInstability ?? 0);

  pushLimited(phaseVizState.shockHistory, shock, phaseVizState.maxPoints);
  pushLimited(phaseVizState.recoveryHistory, recovery, phaseVizState.maxPoints);
  pushLimited(phaseVizState.instabilityHistory, instability, phaseVizState.maxPoints);
  phaseVizState.macroRegime = regimes.macroRegime ?? phaseVizState.macroRegime;
  phaseVizState.socialRegime = regimes.socialRegime ?? phaseVizState.socialRegime;

  insightUi.phaseSummary.innerHTML =
    `Macro: <strong>${phaseVizState.macroRegime}</strong> | ` +
    `Social: <strong>${phaseVizState.socialRegime}</strong> | ` +
    `S:${shock.toFixed(2)} R:${recovery.toFixed(2)} I:${instability.toFixed(2)}`;

  drawPhaseChart(insightUi.phaseCanvas, phaseVizState);
}

function drawPhaseChart(canvas, phaseState) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = Math.max(320, Math.floor(canvas.clientWidth || 640));
  const cssHeight = Math.max(120, Math.floor(canvas.clientHeight || 140));
  const width = Math.floor(cssWidth * dpr);
  const height = Math.floor(cssHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(7, 16, 27, 0.95)";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(128, 170, 210, 0.14)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i += 1) {
    const y = (height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const drawLine = (history, color) => {
    if (!history || history.length < 2) {
      return;
    }
    ctx.beginPath();
    for (let i = 0; i < history.length; i += 1) {
      const x = 8 + (i / Math.max(1, history.length - 1)) * (width - 16);
      const y = 8 + (1 - THREE.MathUtils.clamp(history[i], 0, 1)) * (height - 16);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  drawLine(phaseState.shockHistory, "#ffad7a");
  drawLine(phaseState.recoveryHistory, "#7bc8ff");
  drawLine(phaseState.instabilityHistory, "#ffd37f");
}

function drawMarketIndexChart(canvas, history, isUp) {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = Math.max(320, Math.floor(canvas.clientWidth || 640));
  const cssHeight = Math.max(140, Math.floor(canvas.clientHeight || 180));
  const targetWidth = Math.floor(cssWidth * dpr);
  const targetHeight = Math.floor(cssHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const width = canvas.width;
  const height = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(5, 16, 30, 0.96)";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(130, 175, 220, 0.16)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i += 1) {
    const y = (height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let i = 1; i <= 6; i += 1) {
    const x = (width / 7) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  if (history.length < 2) {
    return;
  }
  const min = Math.min(...history);
  const max = Math.max(...history);
  const span = Math.max(0.0001, max - min);
  const left = 10;
  const top = 8;
  const chartW = width - 20;
  const chartH = height - 16;

  ctx.beginPath();
  history.forEach((value, idx) => {
    const x = left + (idx / Math.max(1, history.length - 1)) * chartW;
    const y = top + (1 - (value - min) / span) * chartH;
    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.strokeStyle = isUp ? "#6dffb8" : "#ff8f8f";
  ctx.lineWidth = 2;
  ctx.stroke();

  const last = history.at(-1);
  const lx = left + chartW;
  const ly = top + (1 - (last - min) / span) * chartH;
  ctx.fillStyle = isUp ? "#6dffb8" : "#ff8f8f";
  ctx.beginPath();
  ctx.arc(lx, ly, 3, 0, Math.PI * 2);
  ctx.fill();
}

function pushLimited(arr, value, maxLen) {
  arr.push(value);
  if (arr.length > maxLen) {
    arr.shift();
  }
}

function toTicker(name) {
  const ticker = String(name ?? "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 4);
  return ticker || "SNC";
}

function formatMacroSystem(system) {
  if (!system) {
    return "-";
  }
  return `疫${(system.epidemicLevel ?? 0).toFixed(2)} 気${(system.climateStress ?? 0).toFixed(2)} 文${(system.culturalDrift ?? 0).toFixed(2)} 市${(system.marketIndex ?? 1).toFixed(2)}`;
}

function formatNationSummary(geo) {
  const rows = geo?.nations ?? [];
  if (rows.length === 0) {
    return "-";
  }
  return rows
    .slice()
    .sort((a, b) => b.power - a.power)
    .slice(0, 3)
    .map((n) => `${n.name}(力${n.power})`)
    .join(" | ");
}

function formatMetaOrderSummary(geo) {
  const stack = geo?.governanceStack ?? [];
  const blocTop = (geo?.blocs ?? []).slice().sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0))[0];
  const hegTop = (geo?.hegemonicNetworks ?? []).slice().sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0))[0];
  const stackLabel = stack.length ? `${stack.length}層` : "0層";
  const blocLabel = blocTop ? `${blocTop.name}` : "-";
  const hegLabel = hegTop ? `${hegTop.actorName}` : "-";
  return `${stackLabel} / Bloc:${blocLabel} / Heg:${hegLabel}`;
}

function formatDiplomacySummary(geo) {
  const rows = geo?.relations ?? [];
  if (rows.length === 0) {
    return "-";
  }
  const top = rows.slice().sort((a, b) => b.tension - a.tension)[0];
  if (!top) {
    return "-";
  }
  return (
    `${top.nationAId}-${top.nationBId}:${top.status} ` +
    `T${top.tension.toFixed(2)} ` +
    `信${(top.trustMemory ?? 0).toFixed(2)} ` +
    `交${(top.tradeDependence ?? 0).toFixed(2)} ` +
    `価${(top.valueDistance ?? 0).toFixed(2)}`
  );
}

function formatMilitarySummary(geo, simWorld) {
  const rows = geo?.militaryCompanies ?? [];
  if (rows.length === 0) {
    return "なし";
  }
  return rows
    .slice(0, 2)
    .map((c) => {
      const city = c.cityId ? simWorld.getCityById(c.cityId)?.name ?? c.cityId : "-";
      return `${c.name}(準備${c.readiness}@${city})`;
    })
    .join(" | ");
}

function formatAllianceSummary(geo) {
  const relations = geo?.relations ?? [];
  const nationName = new Map((geo?.nations ?? []).map((n) => [n.id, n.name]));
  const rows = relations
    .filter((r) => r.status === "alliance")
    .sort((a, b) => (b.relation ?? 0) - (a.relation ?? 0))
    .slice(0, 3);
  if (rows.length === 0) {
    return "なし";
  }
  return rows
    .map((r) => `${nationName.get(r.nationAId) ?? r.nationAId}↔${nationName.get(r.nationBId) ?? r.nationBId}`)
    .join(" | ");
}

function formatHostilitySummary(geo) {
  const relations = geo?.relations ?? [];
  const nationName = new Map((geo?.nations ?? []).map((n) => [n.id, n.name]));
  const rows = relations
    .filter((r) => r.status === "war" || r.status === "crisis")
    .sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))
    .slice(0, 3);
  if (rows.length === 0) {
    return "なし";
  }
  return rows
    .map((r) => {
      const mark = r.status === "war" ? "⚠" : "△";
      return `${mark}${nationName.get(r.nationAId) ?? r.nationAId}×${nationName.get(r.nationBId) ?? r.nationBId}`;
    })
    .join(" | ");
}

function formatHistory(simFrame) {
  if (simFrame.historyLength) {
    return `${simFrame.historyCursor + 1}/${simFrame.historyLength}`;
  }
  if (Number.isFinite(simFrame.historyCursor)) {
    return `${simFrame.historyCursor + 1}`;
  }
  return "-";
}

function formatLineageTree(lines) {
  if (!lines || lines.length === 0) {
    return "家系データなし";
  }
  return lines.join("\n");
}

function renderLineageGraph(lineage) {
  const svg = hud.lineageGraph;
  if (!svg) {
    return;
  }
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }

  const allPeople = lineage?.allPeople ?? [];
  if (allPeople.length === 0) {
    return null;
  }
  const graph = buildRenderableLineageGraph(lineage, selectedLineagePersonId);
  if (!graph || graph.nodes.length === 0) {
    return null;
  }

  const width = 620;
  const height = 420;
  const padX = 56;
  const padY = 28;
  const religionColor = {
    Solaris: "#ffd27b",
    River: "#7de8d8",
    Stone: "#a6b3c7",
    Free: "#a4c8ff"
  };

  const positions = buildLineageTreeLayout(graph, width, height, padX, padY);

  const bg = makeSvg("rect", {
    x: 0,
    y: 0,
    width,
    height,
    fill: "rgba(0,0,0,0)"
  });
  bg.style.cursor = "pointer";
  bg.addEventListener("click", () => {
    selectedLineagePersonId = null;
  });
  svg.appendChild(bg);

  const defs = makeSvg("defs", {});
  const parentArrow = makeSvg("marker", {
    id: "lineage-parent-arrow",
    viewBox: "0 0 10 10",
    refX: 8,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto"
  });
  parentArrow.appendChild(
    makeSvg("path", {
      d: "M 0 0 L 10 5 L 0 10 z",
      fill: "#9ec2eb",
      opacity: 0.95
    })
  );
  defs.appendChild(parentArrow);
  svg.appendChild(defs);

  for (const edge of graph.parentEdges) {
    const a = positions.get(edge.from);
    const b = positions.get(edge.to);
    if (!a || !b) {
      continue;
    }
    const midY = (a.y + b.y) * 0.5;
    const d = `M ${a.x} ${a.y + 8} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y - 8}`;
    svg.appendChild(makeSvg("path", {
      d,
      fill: "none",
      stroke: "#8fb1d6",
      "stroke-width": 1.6,
      opacity: 0.92,
      "marker-end": "url(#lineage-parent-arrow)"
    }));
  }

  for (const edge of graph.partnerEdges) {
    const a = positions.get(edge.from);
    const b = positions.get(edge.to);
    if (!a || !b) {
      continue;
    }
    const d = `M ${a.x} ${a.y} C ${(a.x + b.x) * 0.5} ${a.y - 12}, ${(a.x + b.x) * 0.5} ${b.y - 12}, ${b.x} ${b.y}`;
    svg.appendChild(makeSvg("path", {
      d,
      fill: "none",
      stroke: "#c8d8ee",
      "stroke-width": 1.1,
      "stroke-dasharray": "4 3",
      opacity: 0.6
    }));
  }

  for (const [, pos] of positions) {
    const color = religionColor[pos.node.religion] ?? "#bcd1ea";
    const nodeCircle = makeSvg("circle", {
      cx: pos.x,
      cy: pos.y,
      r: 7,
      fill: color,
      stroke: "#112237",
      "stroke-width": 1
    });
    nodeCircle.style.cursor = "pointer";
    nodeCircle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectedLineagePersonId = pos.node.id;
    });
    if (selectedLineagePersonId === pos.node.id) {
      nodeCircle.setAttribute("r", "9");
      nodeCircle.setAttribute("stroke", "#ffffff");
      nodeCircle.setAttribute("stroke-width", "2");
    }
    svg.appendChild(nodeCircle);
    const label = makeSvg("text", {
      x: pos.x + 10,
      y: pos.y + 4,
      fill: "#d9ebff",
      "font-size": 10
    });
    label.textContent = pos.node.name;
    svg.appendChild(label);
  }

  const selected = selectedLineagePersonId
    ? (lineage?.allPeople ?? []).find((p) => p.id === selectedLineagePersonId)
    : null;
  return { selectedName: selected?.name ?? null };
}

function buildLineageTreeLayout(graph, width, height, padX, padY) {
  const positions = new Map();
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const children = new Map(graph.nodes.map((n) => [n.id, []]));
  const parents = new Map(graph.nodes.map((n) => [n.id, []]));
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));

  for (const edge of graph.parentEdges ?? []) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      continue;
    }
    children.get(edge.from).push(edge.to);
    parents.get(edge.to).push(edge.from);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  for (const ids of children.values()) {
    ids.sort((a, b) => a - b);
  }
  for (const ids of parents.values()) {
    ids.sort((a, b) => a - b);
  }

  const level = new Map(graph.nodes.map((n) => [n.id, 0]));
  const queue = [];
  for (const n of graph.nodes) {
    if ((indegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift();
    const base = level.get(id) ?? 0;
    for (const cid of children.get(id) ?? []) {
      level.set(cid, Math.max(level.get(cid) ?? 0, base + 1));
      indegree.set(cid, (indegree.get(cid) ?? 1) - 1);
      if ((indegree.get(cid) ?? 0) <= 0) {
        queue.push(cid);
      }
    }
  }

  const byLevel = new Map();
  let maxLevel = 0;
  for (const n of graph.nodes) {
    const lv = Math.max(0, level.get(n.id) ?? 0);
    maxLevel = Math.max(maxLevel, lv);
    if (!byLevel.has(lv)) {
      byLevel.set(lv, []);
    }
    byLevel.get(lv).push(n.id);
  }
  for (const ids of byLevel.values()) {
    ids.sort((a, b) => a - b);
  }

  const xUnit = new Map();
  const minSep = 1;
  for (let lv = 0; lv <= maxLevel; lv += 1) {
    const ids = byLevel.get(lv) ?? [];
    for (let i = 0; i < ids.length; i += 1) {
      xUnit.set(ids[i], i);
    }
  }

  function reorderLevel(lv, useParents) {
    const ids = [...(byLevel.get(lv) ?? [])];
    if (ids.length <= 1) {
      return;
    }
    const weighted = ids.map((id, idx) => {
      const refs = useParents ? (parents.get(id) ?? []) : (children.get(id) ?? []);
      if (refs.length === 0) {
        return { id, target: xUnit.get(id) ?? idx };
      }
      let sum = 0;
      let cnt = 0;
      for (const rid of refs) {
        if (!xUnit.has(rid)) {
          continue;
        }
        sum += xUnit.get(rid);
        cnt += 1;
      }
      return { id, target: cnt > 0 ? sum / cnt : (xUnit.get(id) ?? idx) };
    });
    weighted.sort((a, b) => a.target - b.target || a.id - b.id);
    let cursor = 0;
    for (const row of weighted) {
      const t = Math.max(cursor, row.target);
      xUnit.set(row.id, t);
      cursor = t + minSep;
    }

    const first = xUnit.get(weighted[0].id) ?? 0;
    const last = xUnit.get(weighted[weighted.length - 1].id) ?? first;
    const centerShift = (first + last) * 0.5;
    for (const row of weighted) {
      xUnit.set(row.id, (xUnit.get(row.id) ?? 0) - centerShift);
    }
    byLevel.set(lv, weighted.map((w) => w.id));
  }

  for (let iter = 0; iter < 6; iter += 1) {
    for (let lv = 1; lv <= maxLevel; lv += 1) {
      reorderLevel(lv, true);
    }
    for (let lv = maxLevel - 1; lv >= 0; lv -= 1) {
      reorderLevel(lv, false);
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  for (const n of graph.nodes) {
    const x = xUnit.get(n.id) ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    positions.set(n.id, { xUnit: x, yLevel: level.get(n.id) ?? 0, node: n });
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = 0;
    maxX = 1;
  }
  const spanX = Math.max(1, maxX - minX);
  const maxY = Math.max(1, maxLevel);
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;

  for (const [id, pos] of positions) {
    const x = padX + ((pos.xUnit - minX) / spanX) * usableW;
    const y = padY + (pos.yLevel / maxY) * usableH;
    positions.set(id, { x, y, node: pos.node });
  }

  return positions;
}

function buildRenderableLineageGraph(lineage, focusId) {
  if (!lineage) {
    return null;
  }
  if (!focusId) {
    return lineage.graph;
  }

  const people = lineage.allPeople ?? [];
  const byId = new Map(people.map((p) => [p.id, p]));
  if (!byId.has(focusId)) {
    selectedLineagePersonId = null;
    return lineage.graph;
  }

  const keep = new Set([focusId]);
  const qUp = [{ id: focusId, depth: 0 }];
  const qDown = [{ id: focusId, depth: 0 }];

  while (qUp.length > 0) {
    const cur = qUp.shift();
    if (cur.depth >= 2) {
      continue;
    }
    const person = byId.get(cur.id);
    if (!person) {
      continue;
    }
    for (const pid of person.parents ?? []) {
      if (!byId.has(pid) || keep.has(pid)) {
        continue;
      }
      keep.add(pid);
      qUp.push({ id: pid, depth: cur.depth + 1 });
    }
  }

  while (qDown.length > 0) {
    const cur = qDown.shift();
    if (cur.depth >= 2) {
      continue;
    }
    const person = byId.get(cur.id);
    if (!person) {
      continue;
    }
    for (const cid of person.childrenIds ?? []) {
      if (!byId.has(cid) || keep.has(cid)) {
        continue;
      }
      keep.add(cid);
      qDown.push({ id: cid, depth: cur.depth + 1 });
    }
  }

  const focused = byId.get(focusId);
  if (focused?.partnerId && byId.has(focused.partnerId)) {
    keep.add(focused.partnerId);
  }

  const nodes = [];
  const parentEdges = [];
  const partnerEdges = [];
  for (const id of keep) {
    const p = byId.get(id);
    if (!p) {
      continue;
    }
    nodes.push({ id: p.id, name: p.name, generation: p.generation ?? 0, religion: p.religion, age: p.age ?? 0 });
  }

  for (const p of nodes) {
    const src = byId.get(p.id);
    for (const cid of src.childrenIds ?? []) {
      if (keep.has(cid)) {
        parentEdges.push({ from: p.id, to: cid });
      }
    }
    if (src.partnerId && keep.has(src.partnerId) && p.id < src.partnerId) {
      partnerEdges.push({ from: p.id, to: src.partnerId });
    }
  }

  return { nodes, parentEdges, partnerEdges };
}

function makeSvg(tag, attrs) {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function formatHighlight(card, simWorld) {
  if (!card) {
    return "-";
  }
  const cityName = simWorld.getCityById(card.cityId)?.name ?? card.cityId;
  return `${card.name} (${card.score}) @ ${cityName}`;
}

function createCityLabel(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = 360;
  canvas.height = 80;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(6, 18, 36, 0.75)";
  ctx.fillRect(0, 16, canvas.width, 48);
  ctx.strokeStyle = "rgba(138, 185, 245, 0.9)";
  ctx.strokeRect(0, 16, canvas.width, 48);
  ctx.font = "28px IBM Plex Sans, Noto Sans JP, sans-serif";
  ctx.fillStyle = "#dbeeff";
  ctx.fillText(text, 14, 50);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.8 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.7, 0.6, 1);
  return sprite;
}

function latLonToVec3(latDeg, lonDeg, radius) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);

  const x = radius * Math.cos(lat) * Math.cos(lon);
  const y = radius * Math.sin(lat);
  const z = radius * Math.cos(lat) * Math.sin(lon);

  return new THREE.Vector3(x, y, z);
}

function makeArc(from, to, heightFactor) {
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  const up = mid.clone().normalize().multiplyScalar(mid.length() * (1 + heightFactor * 0.08));
  return new THREE.QuadraticBezierCurve3(from.clone(), up, to.clone());
}
