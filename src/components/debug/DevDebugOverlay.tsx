import { useCallback, useMemo, useState } from "react";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import type { EnhancedLocation } from "@/engine/narrative/Travel";

const DEV_DEBUG = import.meta.env.DEV;

export default function DevDebugOverlay() {
  const session = useGameSessionContext();
  const world = session.unifiedState?.world;
  const travelState = session.travelState;

  const locations = useMemo(() => {
    if (!world) return [] as EnhancedLocation[];
    return Array.from(world.locations.values()) as EnhancedLocation[];
  }, [world]);

  const currentLocation = useMemo(() => {
    if (!world || !travelState) return undefined;
    return world.locations.get(travelState.currentLocationId) as EnhancedLocation | undefined;
  }, [world, travelState]);

  const availableDestinationIds = useMemo(() => {
    if (!currentLocation || !world) return [];
    return (currentLocation.connectedTo ?? [])
      .map(id => world.locations.get(id))
      .filter((loc): loc is EnhancedLocation => Boolean(loc))
      .map(loc => loc.id);
  }, [currentLocation, world]);

  const [persistenceReport, setPersistenceReport] = useState<string | null>(null);

  const buildSnapshot = useCallback((label: string) => {
    if (!world) {
      return { label, locationsSize: 0, locationIds: [], currentLocationId: null };
    }
    const locationsList = Array.from(world.locations.values()) as EnhancedLocation[];
    return {
      label,
      locationsSize: world.locations.size,
      locationIds: locationsList.slice(0, 10).map(location => location.id),
      currentLocationId: travelState?.currentLocationId ?? null,
    };
  }, [world, travelState]);

  const runPersistenceCheck = useCallback(async () => {
    if (!DEV_DEBUG || !session.saveGame || !session.loadSave) return;
    if (!session.unifiedState || !session.travelState) {
      setPersistenceReport("No unified/travel state available.");
      return;
    }

    const before = buildSnapshot("before");
    const saveId = await session.saveGame("DEV_DEBUG Repro");
    if (!saveId) {
      setPersistenceReport("Save failed.");
      return;
    }
    const loaded = await session.loadSave(saveId);
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = buildSnapshot("after");

    const report = {
      saveId,
      loaded,
      before,
      after,
    };
    console.info("DEV_DEBUG persistence harness", report);
    setPersistenceReport(JSON.stringify(report, null, 2));
  }, [session, buildSnapshot]);

  const overlayPayload = useMemo(() => {
    if (!world || !travelState) {
      return {
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
      locationsSize: world.locations.size,
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
  }, [world, travelState, locations, currentLocation, availableDestinationIds]);

  if (!DEV_DEBUG) return null;

  return (
    <div
      id="dev-debug-overlay"
      className="fixed bottom-4 right-4 z-[9999] max-h-[70vh] w-[360px] overflow-auto rounded-lg border border-border bg-card/95 p-3 text-xs shadow-xl"
    >
      <div className="mb-2 font-semibold text-foreground">DEV_DEBUG Overlay</div>
      <button
        type="button"
        onClick={runPersistenceCheck}
        className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent"
      >
        Run Persistence Check
      </button>
      <pre className="whitespace-pre-wrap text-muted-foreground">
        {JSON.stringify(overlayPayload, null, 2)}
      </pre>
      {persistenceReport ? (
        <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">
          {persistenceReport}
        </pre>
      ) : null}
    </div>
  );
}
