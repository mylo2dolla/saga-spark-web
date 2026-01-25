import { useMemo } from "react";
import { useParams } from "react-router-dom";
import type { CampaignSeed } from "@/engine/narrative/types";
import type { EnhancedLocation } from "@/engine/narrative/Travel";
import { createTravelState } from "@/engine/narrative/Travel";
import { createUnifiedState } from "@/engine/UnifiedState";
import type { useGameSession } from "@/hooks/useGameSession";
import { MockGameSessionProvider } from "@/contexts/GameSessionContext";
import GameScreen from "@/ui/screens/GameScreen";
import CharacterScreen from "@/ui/screens/CharacterScreen";

type GameSessionValue = ReturnType<typeof useGameSession>;

const buildE2ESession = (campaignId: string): GameSessionValue => {
  const seed: CampaignSeed = {
    id: campaignId,
    title: "E2E Campaign",
    description: "E2E test seed",
    themes: [],
    factions: [],
    createdAt: Date.now(),
  };

  const location: EnhancedLocation = {
    id: "e2e-start",
    name: "E2E Start",
    description: "E2E starting location",
    position: { x: 120, y: 120 },
    radius: 10,
    discovered: true,
    npcs: [],
    items: [],
    connectedTo: [],
    type: "town",
    factionControl: null,
    dangerLevel: 1,
    travelTime: {},
    questHooks: [],
    ambientDescription: "A quiet testing ground.",
    shops: [],
    inn: true,
    services: [],
    currentEvents: [],
  };

  const baseUnified = createUnifiedState(seed, [], 10, 12);
  const worldWithObjectLocations = {
    ...baseUnified.world,
    locations: {
      [location.id]: location,
    } as unknown as typeof baseUnified.world.locations,
  };
  const unifiedState = { ...baseUnified, world: worldWithObjectLocations };
  const travelState = createTravelState(location.id);

  const noop: GameSessionValue["updateUnifiedState"] = () => {};
  const noopSetUnified: GameSessionValue["setUnifiedState"] = () => {};
  const noopUpdateTravel: GameSessionValue["updateTravelState"] = () => {};
  const noopAsync = async (..._args: unknown[]) => null;
  const noopAsyncArray = async (..._args: unknown[]) => [];
  const noopAsyncBool = async (..._args: unknown[]) => false;

  return {
    unifiedState,
    travelState,
    campaignSeed: seed,
    isInitialized: true,
    isLoading: false,
    error: null,
    bootstrapStatus: "ready",
    lastWorldGenError: null,
    lastWorldGenErrorAt: null,
    lastWorldGenSuccessAt: null,
    playtimeSeconds: 0,
    loadedFromSupabase: false,
    lastSavedAt: null,
    lastLoadedAt: null,
    isApplyingAction: false,
    lastActionError: null,
    lastActionEvent: null,
    lastActionDelta: null,
    lastActionAt: null,
    lastActionSource: null,
    lastActionHash: null,
    worldEvents: [],
    worldEventsStatus: "ok",
    worldEventsError: null,
    isReplayingEvents: false,
    replayEventsCount: null,
    saves: [],
    isSaving: false,
    updateUnifiedState: noop,
    setUnifiedState: noopSetUnified,
    updateTravelState: noopUpdateTravel,
    saveGame: noopAsync as GameSessionValue["saveGame"],
    loadSave: noopAsync as GameSessionValue["loadSave"],
    reloadLatestFromDb: noopAsync as GameSessionValue["reloadLatestFromDb"],
    triggerAutosave: () => {},
    autosaveNow: noopAsync as GameSessionValue["autosaveNow"],
    retryBootstrap: noopAsync as GameSessionValue["retryBootstrap"],
    expandWorld: noopAsync as GameSessionValue["expandWorld"],
    submitPlayerAction: noopAsync as GameSessionValue["submitPlayerAction"],
    replayWorldEvents: noopAsync as GameSessionValue["replayWorldEvents"],
    fetchWorldEvents: noopAsyncArray as GameSessionValue["fetchWorldEvents"],
    fetchSaves: noopAsync as GameSessionValue["fetchSaves"],
    deleteSave: noopAsyncBool as GameSessionValue["deleteSave"],
  };
};

export default function E2EGameSessionRoute() {
  const { campaignId } = useParams();
  const session = useMemo(
    () => buildE2ESession(campaignId ?? "e2e-campaign"),
    [campaignId]
  );

  return (
    <MockGameSessionProvider value={session}>
      <GameScreen />
    </MockGameSessionProvider>
  );
}

export function E2ECharacterRoute() {
  const { campaignId } = useParams();
  const session = useMemo(
    () => buildE2ESession(campaignId ?? "e2e-campaign"),
    [campaignId]
  );

  return (
    <MockGameSessionProvider value={session}>
      <CharacterScreen />
    </MockGameSessionProvider>
  );
}
