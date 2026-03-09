function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function fmtWeek(dayOfWeek, isWeekend) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const i = Number.isFinite(dayOfWeek) ? Math.max(0, Math.min(6, dayOfWeek)) : 0;
  return `${labels[i]}${isWeekend ? " (Weekend)" : ""}`;
}

function sumFlows(frame) {
  const flows = Array.isArray(frame?.flows) ? frame.flows : [];
  const out = flows.reduce((s, f) => s + (f.outbound ?? 0), 0);
  const inn = flows.reduce((s, f) => s + (f.inbound ?? 0), 0);
  return { out, inn };
}

function updateHud(frame) {
  const people = frame?.people ?? {};
  const s = people.stateCounts ?? {};
  const f = sumFlows(frame);
  setText("time", frame?.time ?? "-");
  setText("phase", frame?.phase ?? "-");
  setText("week", fmtWeek(frame?.dayOfWeek, frame?.isWeekend));
  setText("flow", `out ${f.out} / in ${f.inn}`);
  setText("human-lod", "LITE");
  setText("name-labels", "OFF");
  setText("states", `H:${s.Home ?? 0} C:${s.Commute ?? 0} W:${s.Work ?? 0} L:${s.Leisure ?? 0} S:${s.Sleep ?? 0}`);
  setText("encounters", String(people?.encounterSummary?.total ?? 0));
  setText("focus", (people?.focusCityIds ?? []).join(", "));
  setText("religion-counts", ((people?.religionStats ?? []).map((r) => `${r.religion}:${r.count}`).join(" | ")) || "-");
  setText("religion-influence", ((people?.religionStats ?? []).map((r) => `${r.religion}:${r.influence}`).join(" | ")) || "-");
  setText("religion-doctrine", ((people?.religionStats ?? []).map((r) => `${r.religion}:${r.doctrine}`).join(" | ")) || "-");
  setText(
    "demo-total",
    `出生:${people?.demographics?.totalBirths ?? 0} / 死亡:${people?.demographics?.totalDeaths ?? 0}(戦${people?.demographics?.totalWarDeaths ?? 0})`
  );
  setText(
    "economy",
    `平均所得:${people?.economy?.avgIncome ?? 0} / 失業率:${people?.economy?.unemploymentRate ?? 0}%`
  );
  setText(
    "company-top",
    ((people?.companies?.topCompanies ?? [])
      .slice(0, 2)
      .map((c) => `${c.name}(株${c.stock})`)
      .join(" | ")) || "-"
  );
  setText(
    "macro-system",
    `疫${Number(frame?.system?.epidemicLevel ?? 0).toFixed(2)} 気${Number(frame?.system?.climateStress ?? 0).toFixed(2)} 文${Number(frame?.system?.culturalDrift ?? 0).toFixed(2)} 市${Number(frame?.system?.marketIndex ?? 1).toFixed(2)}`
  );
  setText(
    "nations",
    ((frame?.geopolitics?.nations ?? []).slice(0, 3).map((n) => `${n.name}(力${n.power})`).join(" | ")) || "-"
  );
  setText(
    "diplomacy",
    ((frame?.geopolitics?.relations ?? [])
      .slice()
      .sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))
      .slice(0, 1)
      .map((r) => `${r.nationAId}-${r.nationBId}:${r.status} T${Number(r.tension ?? 0).toFixed(2)}`)
      .join(" | ")) || "-"
  );
  setText("events", ((people?.events ?? []).slice(0, 2).map((e) => e.text).join(" | ")) || "なし");
  setText(
    "history",
    Number.isFinite(frame?.historyLength) ? `${(frame?.historyCursor ?? 0) + 1}/${frame.historyLength}` : "-"
  );
}

async function apiGet(path) {
  const res = await fetch(`/api/state${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`/api/state${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

async function run() {
  setText("time", "LITE booting...");
  try {
    const boot = await apiGet("/bootstrap");
    if (boot?.frame) {
      updateHud(boot.frame);
    }
    setInterval(async () => {
      try {
        const r = await apiPost("/tick", { steps: 1 });
        if (r?.frame) {
          updateHud(r.frame);
        }
      } catch (error) {
        setText("time", `LITE error: ${error?.message ?? String(error)}`);
      }
    }, 700);
  } catch (error) {
    setText("time", `LITE error: ${error?.message ?? String(error)}`);
  }
}

void run();
