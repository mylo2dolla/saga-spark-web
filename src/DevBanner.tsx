import { DEV_FINGERPRINT } from "./devFingerprint";

const DevBanner = () => {
  if (!import.meta.env.DEV) return null;

  const { runId, now, mode, base, href, appVersion, buildTime, gitSha } = DEV_FINGERPRINT;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 9999,
        maxWidth: 360,
        fontSize: 12,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid rgba(0, 0, 0, 0.2)",
        background: "#dff5e1",
        color: "#111",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.15)",
        lineHeight: 1.4,
      }}
    >
      <div>Runtime: DEV ({mode})</div>
      <div>version: {appVersion}</div>
      <div>build: {buildTime}</div>
      <div>git: {gitSha}</div>
      <div>runId: {runId}</div>
      <div>now: {now}</div>
      <div>base: {base}</div>
      <div>href: {href}</div>
    </div>
  );
};

export default DevBanner;
