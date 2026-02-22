import { useCallback, useEffect, useMemo, useState } from "react";

const DEV_SURFACE_STORAGE_KEY = "mythic:dev-surfaces:v1";
const BOARD_RENDERER_STORAGE_KEY = "mythic:board-renderer";
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

function readDevSurfaceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DEV_SURFACE_STORAGE_KEY);
  return raw === "true";
}

function readBoardRendererOverride(): "dom" | "pixi" | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(BOARD_RENDERER_STORAGE_KEY);
  if (raw === "dom" || raw === "pixi") return raw;
  return null;
}

export function resolveMythicBoardRenderer(userEmail?: string | null): "dom" | "pixi" {
  const override = readBoardRendererOverride();
  if (override) return override;
  const normalizedEmail = typeof userEmail === "string" ? userEmail.trim().toLowerCase() : "";
  if (normalizedEmail && PIXI_CANARY_EMAILS.includes(normalizedEmail)) {
    return "pixi";
  }
  return BOARD_RENDERER_DEFAULT;
}

export function useMythicBoardRenderer(userEmail?: string | null) {
  const [override, setOverride] = useState<"dom" | "pixi" | null>(() => readBoardRendererOverride());

  useEffect(() => {
    setOverride(readBoardRendererOverride());
  }, [userEmail]);

  const effective = useMemo(() => {
    if (override) return override;
    const normalizedEmail = typeof userEmail === "string" ? userEmail.trim().toLowerCase() : "";
    if (normalizedEmail && PIXI_CANARY_EMAILS.includes(normalizedEmail)) return "pixi";
    return BOARD_RENDERER_DEFAULT;
  }, [override, userEmail]);

  const setRenderer = useCallback((next: "dom" | "pixi" | null) => {
    if (typeof window === "undefined") return;
    if (!next) {
      window.localStorage.removeItem(BOARD_RENDERER_STORAGE_KEY);
      setOverride(null);
      return;
    }
    window.localStorage.setItem(BOARD_RENDERER_STORAGE_KEY, next);
    setOverride(next);
  }, []);

  return {
    effective,
    isPixiEnabled: effective === "pixi",
    override,
    setRenderer,
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
