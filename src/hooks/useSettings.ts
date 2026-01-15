import { useCallback, useEffect, useMemo, useState } from "react";

export interface NarrationSettings {
  readAloudEnabled: boolean;
  rate: number;
  pitch: number;
  volume: number;
}

const STORAGE_KEY = "saga:settings";

const DEFAULT_SETTINGS: NarrationSettings = {
  readAloudEnabled: false,
  rate: 1,
  pitch: 1,
  volume: 0.8,
};

function loadSettings(): NarrationSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(stored) as Partial<NarrationSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<NarrationSettings>(() => loadSettings());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const updateSettings = useCallback((updates: Partial<NarrationSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return useMemo(() => ({
    settings,
    updateSettings,
    resetSettings,
  }), [settings, updateSettings, resetSettings]);
}
