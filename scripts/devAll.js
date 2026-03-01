import { spawn } from "node:child_process";

const WEB_PORT = String(process.env.PORT ?? process.env.SPHERE_WEB_PORT ?? "5174");

const children = [];

function start(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    // Keep stdin open for MCP process. If stdin is /dev/null, mcpServer exits on EOF.
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv }
  });
  children.push(child);
  child.stdout.on("data", (buf) => process.stdout.write(`[${name}] ${buf}`));
  child.stderr.on("data", (buf) => process.stderr.write(`[${name}] ${buf}`));
  child.on("exit", (code, signal) => {
    process.stderr.write(`[${name}] exited code=${code ?? "null"} signal=${signal ?? "null"}\n`);
    if (code && code !== 0) {
      stopAll(code);
    }
  });
  return child;
}

function stopAll(code = 0) {
  for (const c of children) {
    if (!c.killed) {
      c.kill("SIGTERM");
    }
  }
  setTimeout(() => {
    for (const c of children) {
      if (!c.killed) {
        c.kill("SIGKILL");
      }
    }
    process.exit(code);
  }, 700);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

start("mcp", "npm", ["run", "start:mcp"]);
start("web", "npm", ["run", "start:web"], { PORT: WEB_PORT });

process.stdout.write(`\n[dev:all] web=http://127.0.0.1:${WEB_PORT} state_api=http://127.0.0.1:5180\n`);
