import fs from "node:fs";
import path from "node:path";

const STATE_API_PORT = Number(process.env.SPHERE_STATE_API_PORT ?? 5180);
const STATE_API_HOST = process.env.SPHERE_STATE_API_HOST ?? "127.0.0.1";

function parseArgs(argv) {
  const out = {
    compareFrom: 0,
    output: "stratification_report.json"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--compare-from" && v) {
      out.compareFrom = Number.parseInt(v, 10);
      i += 1;
    } else if (a === "--output" && v) {
      out.output = v;
      i += 1;
    }
  }
  return out;
}

async function callStateTool(name, args) {
  const url = `http://${STATE_API_HOST}:${STATE_API_PORT}/tool`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args ?? {} })
  });
  if (!res.ok) {
    throw new Error(`state api error: ${res.status}`);
  }
  const payload = await res.json();
  if (!payload?.ok) {
    throw new Error(`tool failed: ${payload?.error ?? "unknown"}`);
  }
  return payload.data;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = await callStateTool("sphere_stratification_report", { compareFrom: Math.max(0, opts.compareFrom) });
  const outPath = path.resolve(process.cwd(), opts.output);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

await main();
