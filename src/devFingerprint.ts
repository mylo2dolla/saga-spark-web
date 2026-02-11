export const DEV_FINGERPRINT = (() => {
  const runId =
    (globalThis.crypto?.randomUUID?.() ??
      `run_${Math.random().toString(16).slice(2)}_${Date.now()}`);

  const now = new Date().toISOString();

  return {
    runId,
    now,
    mode: import.meta.env.MODE,
    base: import.meta.env.BASE_URL,
    href: typeof window !== "undefined" ? window.location.href : "",
    appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown",
    buildTime: typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "unknown",
    gitSha: typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "unknown",
  };
})();
