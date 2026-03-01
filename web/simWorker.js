const API_BASE = "/api/state";

let timer = null;
let stepMs = 600;

async function apiGet(pathname) {
  const res = await fetch(`${API_BASE}${pathname}`);
  if (!res.ok) {
    throw new Error(`GET ${pathname} failed: ${res.status}`);
  }
  return res.json();
}

async function apiPost(pathname, body) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  if (!res.ok) {
    throw new Error(`POST ${pathname} failed: ${res.status}`);
  }
  return res.json();
}

async function pushFrame() {
  try {
    const payload = await apiPost("/tick", { steps: 1 });
    if (payload?.frame) {
      self.postMessage({ type: "frame", frame: payload.frame });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message ?? String(error) });
  }
}

self.onmessage = async (event) => {
  const data = event.data ?? {};

  if (data.type === "init") {
    stepMs = data.stepMs || 600;
    if (data.config && data.resetOnInit === true) {
      try {
        await apiPost("/reset", { config: data.config });
      } catch (error) {
        self.postMessage({ type: "error", message: error?.message ?? String(error) });
      }
    }
    if (timer) {
      clearInterval(timer);
    }
    timer = setInterval(() => {
      void pushFrame();
    }, stepMs);
    void pushFrame();
    return;
  }

  if (data.type === "snapshot") {
    try {
      const payload = await apiPost("/snapshot/export", {});
      self.postMessage({ type: "snapshot", snapshot: payload.snapshot });
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message ?? String(error) });
    }
    return;
  }

  if (data.type === "loadSnapshot") {
    try {
      const payload = await apiPost("/snapshot/load", { snapshot: data.snapshot });
      if (payload?.frame) {
        self.postMessage({ type: "frame", frame: payload.frame, history: true });
      }
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message ?? String(error) });
    }
    return;
  }

  if (data.type === "setPolicy") {
    try {
      await apiPost("/setPolicy", { policy: data.policy ?? {} });
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message ?? String(error) });
    }
    return;
  }

  if (data.type === "setScalePreset") {
    try {
      await apiPost("/reset", { population: data.population ?? {} });
      const bootstrap = await apiGet("/bootstrap");
      if (bootstrap?.frame) {
        self.postMessage({ type: "frame", frame: bootstrap.frame });
      }
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message ?? String(error) });
    }
    return;
  }

  if (data.type === "historyStep") {
    try {
      const payload = await apiPost("/historyStep", { offset: data.offset || 0 });
      if (payload?.frame) {
        self.postMessage({ type: "frame", frame: payload.frame, history: true });
      }
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message ?? String(error) });
    }
    return;
  }

  if (data.type === "stop") {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
};
