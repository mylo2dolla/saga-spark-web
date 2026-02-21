import { useCallback, useEffect, useMemo, useState } from "react";

const DEV_SURFACE_STORAGE_KEY = "mythic:dev-surfaces:v1";

export const isDevSurfaceAllowed = import.meta.env.VITE_MYTHIC_DEV_SURFACES === "true";

function readDevSurfaceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DEV_SURFACE_STORAGE_KEY);
  return raw === "true";
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

