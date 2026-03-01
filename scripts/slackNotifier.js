import process from "node:process";

const stateApiBase = process.env.SPHERE_STATE_API_URL ?? "http://127.0.0.1:5180";
const webhookUrl = process.env.SLACK_WEBHOOK_URL;
const intervalSec = Math.max(10, Number(process.env.SLACK_NOTIFY_INTERVAL_SEC ?? 60));
const mode = (process.env.SLACK_NOTIFY_MODE ?? "watch").toLowerCase();
const notifyOnEvents = String(process.env.SLACK_NOTIFY_ON_EVENTS ?? "1").trim() !== "0";
const alwaysNotifyFrameAdvance = String(process.env.SLACK_NOTIFY_ON_FRAME_ADVANCE ?? "0").trim() === "1";

const thresholds = {
  unemployment: Number(process.env.SLACK_ALERT_UNEMPLOYMENT ?? 12),
  tension: Number(process.env.SLACK_ALERT_TENSION ?? 0.65),
  scarcity: Number(process.env.SLACK_ALERT_SCARCITY ?? 0.7),
  netGrowth: Number(process.env.SLACK_ALERT_NET_GROWTH ?? -5),
  marketMovePct: Number(process.env.SLACK_ALERT_MARKET_MOVE_PCT ?? 5)
};

if (!webhookUrl) {
  console.error("SLACK_WEBHOOK_URL is required.");
  process.exit(1);
}

let prev = null;

async function callTool(name, args = {}) {
  const res = await fetch(`${stateApiBase}/tool`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, arguments: args })
  });
  if (!res.ok) {
    throw new Error(`tool call failed: ${name} (${res.status})`);
  }
  const body = await res.json();
  if (!body.ok) {
    throw new Error(`tool error: ${name} (${body.error ?? "unknown"})`);
  }
  return body.data;
}

function parseSnapshot(hud, resource) {
  const f = hud?.frame ?? {};
  const eco = hud?.economy ?? {};
  const demo = hud?.demographics?.totals ?? {};
  const geo = hud?.geopolitics ?? {};
  const macro = hud?.macroSystem ?? {};
  const lines = hud?.lines ?? [];
  const events = Array.isArray(hud?.events) ? hud.events : [];
  const eventTexts = events
    .map((e) => String(e?.text ?? "").trim())
    .filter((t) => t.length > 0);
  const eventSignature = eventTexts.join(" | ");
  const riskCities = (hud?.events ?? []).filter((e) => String(e?.text ?? "").includes("不安定化リスク高")).length;
  const market = Number(macro?.market ?? 1);
  const scarcity = Number(resource?.market?.globalScarcity ?? 0);

  return {
    time: String(f.time ?? "unknown"),
    phase: String(f.phase ?? "unknown"),
    week: String(f.week ?? "unknown"),
    unemploymentRate: Number(eco.unemploymentRate ?? 0),
    avgIncome: Number(eco.avgIncome ?? 0),
    bankNet: Number(eco?.banking?.net ?? 0),
    marketIndex: market,
    scarcity,
    netGrowth: Number(demo.net ?? 0),
    maxTension: Number(geo?.diplomacyTop?.tension ?? 0),
    diplomacyStatus: String(geo?.diplomacyTop?.status ?? "unknown"),
    hostilities: (geo?.hostilities ?? []).length,
    alliances: (geo?.alliances ?? []).length,
    riskCities,
    eventTexts,
    eventSignature,
    lines
  };
}

function diffEvents(current, previous) {
  const prevSet = new Set(previous?.eventTexts ?? []);
  const nextSet = new Set(current?.eventTexts ?? []);
  const added = [];
  for (const text of nextSet) {
    if (!prevSet.has(text)) {
      added.push(text);
    }
  }
  return added;
}

function shouldSend(current, previous) {
  if (!previous) {
    return { send: true, reasons: ["initial"] };
  }
  const reasons = [];
  if (`${current.time}|${current.phase}` !== `${previous.time}|${previous.phase}`) {
    if (alwaysNotifyFrameAdvance) {
      reasons.push("frame_advanced");
    }
  }
  const newEvents = diffEvents(current, previous);
  if (notifyOnEvents && newEvents.length > 0) {
    reasons.push(`new_events:${newEvents.length}`);
  }
  if (current.unemploymentRate >= thresholds.unemployment && previous.unemploymentRate < thresholds.unemployment) {
    reasons.push(`unemployment>=${thresholds.unemployment}%`);
  }
  if (current.maxTension >= thresholds.tension && previous.maxTension < thresholds.tension) {
    reasons.push(`tension>=${thresholds.tension}`);
  }
  if (current.scarcity >= thresholds.scarcity && previous.scarcity < thresholds.scarcity) {
    reasons.push(`scarcity>=${thresholds.scarcity}`);
  }
  if (current.netGrowth <= thresholds.netGrowth && previous.netGrowth > thresholds.netGrowth) {
    reasons.push(`netGrowth<=${thresholds.netGrowth}`);
  }
  const movePct = previous.marketIndex > 0 ? Math.abs(((current.marketIndex - previous.marketIndex) / previous.marketIndex) * 100) : 0;
  if (movePct >= thresholds.marketMovePct) {
    reasons.push(`market_move>=${thresholds.marketMovePct}%`);
  }
  return { send: reasons.length > 0, reasons };
}

function formatSlackText(s, reasons) {
  const eventsText = s.eventTexts?.length > 0 ? s.eventTexts.slice(0, 6).join(" | ") : "none";
  return [
    `*Sphere Status* (${s.time} / ${s.phase}, ${s.week})`,
    `reason: ${reasons.join(", ")}`,
    `population_net: ${s.netGrowth}`,
    `unemployment: ${s.unemploymentRate}%`,
    `avg_income: ${s.avgIncome}`,
    `bank_net: ${s.bankNet}`,
    `market_index: ${s.marketIndex}`,
    `global_scarcity: ${s.scarcity}`,
    `max_tension: ${s.maxTension} (${s.diplomacyStatus})`,
    `alliances/hostilities: ${s.alliances}/${s.hostilities}`,
    `city_risk_events: ${s.riskCities}`,
    `events: ${eventsText}`
  ].join("\n");
}

async function postSlack(text) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    throw new Error(`slack webhook failed (${res.status})`);
  }
}

async function sample() {
  const [hud, resource] = await Promise.all([
    callTool("sphere_hud_snapshot", {}),
    callTool("sphere_resource_status", { limit: 5 })
  ]);
  return parseSnapshot(hud, resource);
}

async function runOnce() {
  const current = await sample();
  const reasons = ["manual"];
  const text = formatSlackText(current, reasons);
  await postSlack(text);
  console.log(`posted: ${current.time} ${current.phase}`);
}

async function runWatch() {
  while (true) {
    try {
      const current = await sample();
      const decision = shouldSend(current, prev);
      if (decision.send) {
        const text = formatSlackText(current, decision.reasons);
        await postSlack(text);
        console.log(`posted: ${current.time} ${current.phase} [${decision.reasons.join(", ")}]`);
      } else {
        console.log(`skip: ${current.time} ${current.phase}`);
      }
      prev = current;
    } catch (err) {
      console.error(`error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

if (mode === "once") {
  runOnce().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  runWatch().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
