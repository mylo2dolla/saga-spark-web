import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import { supabase } from "@/integrations/supabase/client";
import type { EnhancedLocation } from "@/engine/narrative/Travel";
import { useNetworkHealth } from "@/ui/data/networkHealth";
import { useAuth } from "@/hooks/useAuth";

const DEV_DEBUG = import.meta.env.DEV;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const getProjectRef = (url?: string) => {
  if (!url) return null;
  return url.replace("https://", "").split(".")[0] ?? null;
};

function DevDebugOverlayAuthedStats() {
  const session = useGameSessionContext();
  const world = session.unifiedState?.world;
  const travelState = session.travelState;
  const { campaignId } = useParams();
  const networkHealth = useNetworkHealth(1000);

  const locationsMap = useMemo(() => {
    const raw = world?.locations as unknown;
    if (raw instanceof Map) return raw as Map<string, EnhancedLocation>;
    if (Array.isArray(raw)) return new Map(raw as Array<[string, EnhancedLocation]>);
    if (raw && typeof raw === "object") {
      return new Map(Object.entries(raw as Record<string, EnhancedLocation>));
    }
    return new Map<string, EnhancedLocation>();
  }, [world]);

  const locations = useMemo(() => {
    if (!world) return [] as EnhancedLocation[];
    return Array.from(locationsMap.values()) as EnhancedLocation[];
  }, [locationsMap, world]);

  const currentLocation = useMemo(() => {
    if (!world || !travelState) return undefined;
    return locationsMap.get(travelState.currentLocationId) as EnhancedLocation | undefined;
  }, [locationsMap, travelState, world]);

  const availableDestinationIds = useMemo(() => {
    if (!currentLocation || !world) return [];
    return (currentLocation.connectedTo ?? [])
      .map(id => locationsMap.get(id))
      .filter((loc): loc is EnhancedLocation => Boolean(loc))
      .map(loc => loc.id);
  }, [currentLocation, locationsMap, world]);

  const [persistenceReport, setPersistenceReport] = useState<string | null>(null);
  const [connectivityReport, setConnectivityReport] = useState<string | null>(null);

  const buildSnapshot = useCallback((label: string) => {
    if (!world) {
      return { label, locationsSize: 0, locationIds: [], currentLocationId: null };
    }
    const locationsList = Array.from(locationsMap.values()) as EnhancedLocation[];
    return {
      label,
      locationsSize: locationsMap.size,
      locationIds: locationsList.slice(0, 10).map(location => location.id),
      currentLocationId: travelState?.currentLocationId ?? null,
    };
  }, [locationsMap, travelState, world]);

  const handleForceSave = useCallback(async () => {
    if (!session.autosaveNow) return;
    await session.autosaveNow();
    const report = { action: "force-save", snapshot: buildSnapshot("after-save") };
    console.info("DEV_DEBUG persistence harness", report);
    setPersistenceReport(JSON.stringify(report, null, 2));
  }, [session, buildSnapshot]);

  const handleForceReload = useCallback(async () => {
    if (!session.reloadLatestFromDb) return;
    const loaded = await session.reloadLatestFromDb();
    const report = {
      action: "force-reload",
      loaded,
      snapshot: buildSnapshot("after-reload"),
    };
    console.info("DEV_DEBUG persistence harness", report);
    setPersistenceReport(JSON.stringify(report, null, 2));
  }, [session, buildSnapshot]);

  const handleConnectivityTest = useCallback(async () => {
    const report: {
      action: string;
      supabaseUrl: string | null;
      hasAnonKey: boolean;
      authSession?: { hasSession: boolean; error: string | null };
      authHealth?: { ok: boolean; status: number | null; body?: string | null; error?: string | null };
      dbHealth?: { ok: boolean; status: number | null; error?: string | null };
      error?: string;
    } = {
      action: "supabase-self-test",
      supabaseUrl: SUPABASE_URL ?? null,
      hasAnonKey: Boolean(SUPABASE_ANON_KEY),
    };

    try {
      const { data, error } = await supabase.auth.getSession();
      report.authSession = {
        hasSession: Boolean(data.session),
        error: error?.message ?? null,
      };
    } catch (error) {
      report.authSession = {
        hasSession: false,
        error: error instanceof Error ? error.message : "unknown error",
      };
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      report.authHealth = { ok: false, status: null, body: null, error: "missing env" };
    } else {
      try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
          headers: { apikey: SUPABASE_ANON_KEY },
        });
        const body = await response.text();
        report.authHealth = { ok: response.ok, status: response.status, body };
      } catch (error) {
        report.authHealth = {
          ok: false,
          status: null,
          error: error instanceof Error ? error.message : "unknown error",
        };
      }
    }

    try {
      const { error } = await supabase
        .from("campaigns")
        .select("id", { head: true, count: "exact" })
        .limit(1);
      report.dbHealth = error
        ? { ok: false, status: (error as { status?: number })?.status ?? null, error: error.message }
        : { ok: true, status: 200, error: null };
    } catch (error) {
      report.dbHealth = {
        ok: false,
        status: null,
        error: error instanceof Error ? error.message : "unknown error",
      };
    }

    console.info("DEV_DEBUG supabase connectivity", report);
    setConnectivityReport(JSON.stringify(report, null, 2));
  }, []);

  const overlayPayload = useMemo(() => {
    if (!world || !travelState) {
      return {
        supabaseProjectRef: getProjectRef(SUPABASE_URL),
        campaignId: campaignId ?? null,
        loadedFromSupabase: session.loadedFromSupabase ?? false,
        lastSavedAt: session.lastSavedAt ?? null,
        lastLoadedAt: session.lastLoadedAt ?? null,
        networkHealth,
        locationsSize: 0,
        locationIds: [],
        locationNames: [],
        currentLocationId: travelState?.currentLocationId ?? null,
        connectedTo: [],
        availableDestinationIds: [],
        mapMarkers: [],
      };
    }

    return {
      supabaseProjectRef: getProjectRef(SUPABASE_URL),
      campaignId: campaignId ?? null,
      loadedFromSupabase: session.loadedFromSupabase ?? false,
      lastSavedAt: session.lastSavedAt ?? null,
      lastLoadedAt: session.lastLoadedAt ?? null,
      networkHealth,
      locationsSize: locationsMap.size,
      locationIds: locations.map(location => location.id),
      locationNames: locations.map(location => location.name),
      currentLocationId: travelState.currentLocationId,
      connectedTo: currentLocation?.connectedTo ?? [],
      availableDestinationIds,
      mapMarkers: locations.map(location => ({
        id: location.id,
        x: location.position.x,
        y: location.position.y,
      })),
    };
  }, [
    world,
    travelState,
    locations,
    locationsMap,
    currentLocation,
    availableDestinationIds,
    campaignId,
    session.loadedFromSupabase,
    session.lastSavedAt,
    session.lastLoadedAt,
    networkHealth,
  ]);

  if (!DEV_DEBUG) return null;

  return (
    <div
      id="dev-debug-overlay"
      className="fixed bottom-4 right-4 z-[9999] max-h-[70vh] w-[360px] overflow-auto rounded-lg border border-border bg-card/95 p-3 text-xs shadow-xl"
    >
      <div className="mb-2 font-semibold text-foreground">DEV_DEBUG Overlay</div>
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={handleForceSave}
          className="w-1/2 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent"
        >
          Force Save Now
        </button>
        <button
          type="button"
          onClick={handleForceReload}
          className="w-1/2 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent"
        >
          Force Reload From DB
        </button>
      </div>
      <button
        type="button"
        onClick={handleConnectivityTest}
        className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent"
      >
        Supabase Connectivity Self-Test
      </button>
      <pre className="whitespace-pre-wrap text-muted-foreground">
        {JSON.stringify(overlayPayload, null, 2)}
      </pre>
      <div className="mt-2 text-[10px] text-muted-foreground">
        <div>profilesReads: {networkHealth.profilesReads}</div>
        <div>campaignMembersReads: {networkHealth.campaignMembersReads}</div>
        <div>campaignsReads: {networkHealth.campaignsReads}</div>
        <div>savesReads: {networkHealth.savesReads}</div>
      </div>
      {persistenceReport ? (
        <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">
          {persistenceReport}
        </pre>
      ) : null}
      {connectivityReport ? (
        <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">
          {connectivityReport}
        </pre>
      ) : null}
    </div>
  );
}

export default function DevDebugOverlay() {
  const location = useLocation();
  const { user, isLoading } = useAuth();
  const isLoginRoute = location.pathname === "/login" || location.pathname === "/signup";

  useEffect(() => {
    if (!DEV_DEBUG) return;
    if (!isLoading && user && !isLoginRoute) return;
    console.info("[auth] log", {
      step: "dev_overlay_skip",
      route: location.pathname,
      hasSession: Boolean(user),
      isLoading,
      reason: isLoginRoute ? "login_route" : "no_user",
    });
  }, [isLoading, isLoginRoute, location.pathname, user]);

  if (!DEV_DEBUG) return null;
  if (isLoading || !user || isLoginRoute) {
    return null;
  }

  return <DevDebugOverlayAuthedStats />;
}
