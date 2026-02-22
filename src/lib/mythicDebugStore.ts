import type { MythicDmContextResponse } from "@/types/mythic";

const SNAPSHOT_KEY = "mythic.debug.snapshot.v1";
const HISTORY_KEY = "mythic.debug.snapshot.history.v1";
const EVENT_NAME = "mythic-debug-snapshot";
const MAX_HISTORY = 24;

export interface MythicDebugSnapshot {
  capturedAt: string;
  campaignId: string;
  context: MythicDmContextResponse;
}

declare global {
  interface Window {
    __MYTHIC_DEBUG_SNAPSHOT__?: MythicDebugSnapshot;
    __MYTHIC_DEBUG_HISTORY__?: MythicDebugSnapshot[];
  }
}

function canUseWindow(): boolean {
  return typeof window !== "undefined";
}

function safeParseSnapshot(value: string | null): MythicDebugSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as MythicDebugSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.campaignId !== "string" || !parsed.campaignId.trim()) return null;
    if (typeof parsed.capturedAt !== "string" || !parsed.capturedAt.trim()) return null;
    if (!parsed.context || typeof parsed.context !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeParseHistory(value: string | null): MythicDebugSnapshot[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as MythicDebugSnapshot[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        if (typeof entry.campaignId !== "string" || !entry.campaignId.trim()) return null;
        if (typeof entry.capturedAt !== "string" || !entry.capturedAt.trim()) return null;
        if (!entry.context || typeof entry.context !== "object") return null;
        return entry;
      })
      .filter((entry): entry is MythicDebugSnapshot => Boolean(entry));
  } catch {
    return [];
  }
}

function writeStorage(snapshot: MythicDebugSnapshot, history: MythicDebugSnapshot[]): void {
  if (!canUseWindow()) return;
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    // Ignore storage failures.
  }
}

function readStorageSnapshot(): MythicDebugSnapshot | null {
  if (!canUseWindow()) return null;
  try {
    return safeParseSnapshot(window.localStorage.getItem(SNAPSHOT_KEY));
  } catch {
    return null;
  }
}

function readStorageHistory(): MythicDebugSnapshot[] {
  if (!canUseWindow()) return [];
  try {
    return safeParseHistory(window.localStorage.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

export function publishMythicDebugSnapshot(snapshot: MythicDebugSnapshot): void {
  if (!canUseWindow()) return;

  const normalized: MythicDebugSnapshot = {
    capturedAt: snapshot.capturedAt,
    campaignId: snapshot.campaignId,
    context: snapshot.context,
  };

  const existingHistory = window.__MYTHIC_DEBUG_HISTORY__ ?? readStorageHistory();
  const deduped = existingHistory.filter((entry) => {
    if (entry.campaignId !== normalized.campaignId) return true;
    if (entry.capturedAt === normalized.capturedAt) return false;
    return true;
  });
  const nextHistory = [...deduped, normalized].slice(-MAX_HISTORY);

  window.__MYTHIC_DEBUG_SNAPSHOT__ = normalized;
  window.__MYTHIC_DEBUG_HISTORY__ = nextHistory;
  writeStorage(normalized, nextHistory);

  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function readLatestMythicDebugSnapshot(): MythicDebugSnapshot | null {
  if (!canUseWindow()) return null;
  if (window.__MYTHIC_DEBUG_SNAPSHOT__) return window.__MYTHIC_DEBUG_SNAPSHOT__ ?? null;
  const fromStorage = readStorageSnapshot();
  if (fromStorage) {
    window.__MYTHIC_DEBUG_SNAPSHOT__ = fromStorage;
  }
  return fromStorage;
}

export function readMythicDebugHistory(): MythicDebugSnapshot[] {
  if (!canUseWindow()) return [];
  if (window.__MYTHIC_DEBUG_HISTORY__) return [...(window.__MYTHIC_DEBUG_HISTORY__ ?? [])];
  const history = readStorageHistory();
  window.__MYTHIC_DEBUG_HISTORY__ = history;
  return [...history];
}

export function subscribeMythicDebugSnapshots(
  listener: (snapshot: MythicDebugSnapshot) => void,
): () => void {
  if (!canUseWindow()) return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<MythicDebugSnapshot>).detail;
    if (!detail) return;
    listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
}
