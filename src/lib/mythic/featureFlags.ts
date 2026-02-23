import { useCallback, useEffect, useMemo, useState } from "react";

const DEV_SURFACE_STORAGE_KEY = "mythic:dev-surfaces:v1";
const BOARD_RENDERER_STORAGE_KEY = "mythic:board-renderer";
const PIXI_FAILURE_UNTIL_STORAGE_KEY = "mythic:board-renderer:pixi-failure-until";
const PIXI_FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const PIXI_CANARY_EMAILS = String(import.meta.env.VITE_MYTHIC_PIXI_CANARY_EMAILS ?? "")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter((entry) => entry.length > 0);
const BOARD_RENDERER_DEFAULT = (() => {
  const env = String(import.meta.env.VITE_MYTHIC_BOARD_RENDERER_DEFAULT ?? "pixi")
    .trim()
    .toLowerCase();
  return env === "pixi" ? "pixi" : "dom";
})();

export const isDevSurfaceAllowed = import.meta.env.VITE_MYTHIC_DEV_SURFACES === "true";
export const mythicBoardRendererDefault = BOARD_RENDERER_DEFAULT;

type MythicBoardRenderer = "dom" | "pixi";
type MythicBoardRendererOverride = MythicBoardRenderer | null;

function readDevSurfaceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DEV_SURFACE_STORAGE_KEY);
  return raw === "true";
}

function readBoardRendererOverride(): MythicBoardRendererOverride {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(BOARD_RENDERER_STORAGE_KEY);
  if (raw === "dom" || raw === "pixi") return raw;
  return null;
}

function readPixiFailureUntil(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PIXI_FAILURE_UNTIL_STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= Date.now()) {
    window.localStorage.removeItem(PIXI_FAILURE_UNTIL_STORAGE_KEY);
    return null;
  }
  return parsed;
}

function writePixiFailureUntil(untilMs: number | null) {
  if (typeof window === "undefined") return;
  if (!untilMs) {
    window.localStorage.removeItem(PIXI_FAILURE_UNTIL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(PIXI_FAILURE_UNTIL_STORAGE_KEY, String(Math.max(Date.now(), Math.floor(untilMs))));
}

function isPixiRecoveryActive(pixiFailureUntil: number | null): boolean {
  return Boolean(pixiFailureUntil && pixiFailureUntil > Date.now());
}

export function resolveMythicBoardRenderer(userEmail?: string | null): "dom" | "pixi" {
  const override = readBoardRendererOverride();
  if (override) return override;
  if (isPixiRecoveryActive(readPixiFailureUntil())) return "dom";
  const normalizedEmail = typeof userEmail === "string" ? userEmail.trim().toLowerCase() : "";
  if (normalizedEmail && PIXI_CANARY_EMAILS.includes(normalizedEmail)) {
    return "pixi";
  }
  return BOARD_RENDERER_DEFAULT;
}

export function useMythicBoardRenderer(userEmail?: string | null) {
  const [override, setOverride] = useState<MythicBoardRendererOverride>(() => readBoardRendererOverride());
  const [pixiFailureUntil, setPixiFailureUntil] = useState<number | null>(() => readPixiFailureUntil());

  useEffect(() => {
    setOverride(readBoardRendererOverride());
    setPixiFailureUntil(readPixiFailureUntil());
  }, [userEmail]);

  const pixiRecoveryActive = useMemo(() => isPixiRecoveryActive(pixiFailureUntil), [pixiFailureUntil]);

  const effective = useMemo(() => {
    if (override) return override;
    if (pixiRecoveryActive) return "dom";
    const normalizedEmail = typeof userEmail === "string" ? userEmail.trim().toLowerCase() : "";
    if (normalizedEmail && PIXI_CANARY_EMAILS.includes(normalizedEmail)) return "pixi";
    return BOARD_RENDERER_DEFAULT;
  }, [override, pixiRecoveryActive, userEmail]);

  const setRenderer = useCallback((next: MythicBoardRendererOverride) => {
    if (typeof window === "undefined") return;
    if (!next) {
      window.localStorage.removeItem(BOARD_RENDERER_STORAGE_KEY);
      setOverride(null);
      return;
    }
    if (next === "pixi") {
      writePixiFailureUntil(null);
      setPixiFailureUntil(null);
    }
    window.localStorage.setItem(BOARD_RENDERER_STORAGE_KEY, next);
    setOverride(next);
  }, []);

  const markPixiRuntimeFailure = useCallback((ttlMs = PIXI_FAILURE_TTL_MS) => {
    const safeTtl = Number.isFinite(ttlMs) ? Math.max(30_000, Math.floor(ttlMs)) : PIXI_FAILURE_TTL_MS;
    const until = Date.now() + safeTtl;
    writePixiFailureUntil(until);
    setPixiFailureUntil(until);
  }, []);

  const clearPixiRuntimeFailure = useCallback(() => {
    writePixiFailureUntil(null);
    setPixiFailureUntil(null);
  }, []);

  return {
    effective,
    isPixiEnabled: effective === "pixi",
    override,
    setRenderer,
    pixiFailureUntil,
    pixiRecoveryActive,
    markPixiRuntimeFailure,
    clearPixiRuntimeFailure,
  };
}

export function useMythicDevSurfaces() {
  const allowed = isDevSurfaceAllowed;
  const [enabledRaw, setEnabledRaw] = useState<boolean>(() => (allowed ? readDevSurfaceEnabled() : false));

  useEffect(() => {
    if (!allowed) {
      setEnabledRaw(false);
      return;
    }
    setEnabledRaw(readDevSurfaceEnabled());
  }, [allowed]);

  useEffect(() => {
    if (!allowed || typeof window === "undefined") return;
    window.localStorage.setItem(DEV_SURFACE_STORAGE_KEY, enabledRaw ? "true" : "false");
  }, [allowed, enabledRaw]);

  const enabled = useMemo(() => allowed && enabledRaw, [allowed, enabledRaw]);
  const setEnabled = useCallback((next: boolean) => {
    setEnabledRaw(Boolean(next));
  }, []);
  const toggle = useCallback(() => {
    setEnabledRaw((prev) => !prev);
  }, []);

  return {
    allowed,
    enabled,
    setEnabled,
    toggle,
  };
}
