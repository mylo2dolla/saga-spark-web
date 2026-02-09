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
  };
})();
