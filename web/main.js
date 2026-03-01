function showBootError(message) {
  const el = document.getElementById("time");
  if (el) {
    el.textContent = `error: ${message}`;
  }
}

function showBootStage(message) {
  const el = document.getElementById("time");
  if (el) {
    el.textContent = message;
  }
}

async function boot() {
  showBootStage("LOADER: start");
  try {
    showBootStage("LOADER: importing main-app");
    await import("/web/main-app.js");
    showBootStage("LOADER: main-app loaded");
  } catch (error) {
    const msg = error?.message ?? String(error);
    console.error("Sphere boot failed:", error);
    showBootError(`3D boot failed (${msg}) -> LITE mode`);
    try {
      showBootStage("LOADER: importing lite");
      await import("/web/main-lite.js");
      showBootStage("LOADER: lite loaded");
    } catch (liteError) {
      const liteMsg = liteError?.message ?? String(liteError);
      showBootError(`LITE boot failed: ${liteMsg}`);
    }
  }
}

void boot();
