import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import { TravelPanel } from "@/components/game/TravelPanel";
import type { EnhancedLocation } from "@/engine/narrative/Travel";
import type { TravelWorldState } from "@/engine/narrative/TravelPersistence";
import { resumeTravelAfterCombat } from "@/engine/WorldTravelEngine";
import { useDiagnostics } from "@/ui/data/diagnostics";
import { useUnifiedEngineOptional } from "@/contexts/UnifiedEngineContext";
import WorldBoard from "@/ui/worldboard/WorldBoard";
import { toWorldBoardModel } from "@/ui/worldboard/adapter";

export default function GameScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const gameSession = useGameSessionContext();
  const { setEngineSnapshot } = useDiagnostics();
  const engine = useUnifiedEngineOptional();
  const [showTravel, setShowTravel] = useState(true);
  const [combatState, setCombatState] = useState<"idle" | "active">("idle");
  const [combatMessage, setCombatMessage] = useState<string | null>(null);
  const [uiTick, setUiTick] = useState<number>(0);
  const DEV_DEBUG = import.meta.env.DEV;

  useEffect(() => {
    if (!campaignId) return;
    if (authLoading) {
      console.info("[auth] log", {
        step: "auth_guard",
        path: `/game/${campaignId}`,
        hasSession: Boolean(user),
        userId: user?.id ?? null,
        isLoading: authLoading,
        reason: "auth_loading",
      });
      return;
    }
    if (!user) {
      console.info("[auth] log", {
        step: "auth_guard",
        path: `/game/${campaignId}`,
        hasSession: false,
        userId: null,
        isLoading: authLoading,
        reason: "no_user",
      });
      navigate("/login");
    }
  }, [authLoading, campaignId, navigate, user]);

  const currentLocation = useMemo(() => {
    if (!gameSession.unifiedState || !gameSession.travelState) return undefined;
    return gameSession.unifiedState.world.locations.get(gameSession.travelState.currentLocationId) as EnhancedLocation | undefined;
  }, [gameSession.unifiedState, gameSession.travelState]);

  const destinations = useMemo(() => {
    if (!gameSession.unifiedState || !currentLocation) return [] as EnhancedLocation[];
    return (currentLocation.connectedTo ?? [])
      .map(id => gameSession.unifiedState?.world.locations.get(id) as EnhancedLocation | undefined)
      .filter((loc): loc is EnhancedLocation => Boolean(loc));
  }, [currentLocation, gameSession.unifiedState]);

  const travelWorldState = useMemo((): TravelWorldState | null => {
    if (!gameSession.unifiedState || !gameSession.travelState) return null;
    return {
      ...gameSession.unifiedState.world,
      travelState: gameSession.travelState,
    };
  }, [gameSession.unifiedState, gameSession.travelState]);

  const worldBoardModel = useMemo(() => {
    if (!gameSession.unifiedState) return null;
    const stateWithTravel = {
      ...gameSession.unifiedState,
      world: {
        ...gameSession.unifiedState.world,
        travelState: gameSession.travelState ?? undefined,
      },
    };
    return toWorldBoardModel(stateWithTravel);
  }, [gameSession.unifiedState, gameSession.travelState, uiTick]);

  useEffect(() => {
    setEngineSnapshot({
      state: combatState === "active"
        ? "combat"
        : gameSession.travelState?.isInTransit
          ? "travel"
          : "explore",
      locationId: currentLocation?.id ?? null,
      locationName: currentLocation?.name ?? null,
      destinationsCount: destinations.length,
      campaignId: campaignId ?? null,
      campaignSeedId: gameSession.campaignSeed?.id ?? null,
      campaignSeedTitle: gameSession.campaignSeed?.title ?? null,
      travel: {
        currentLocationId: gameSession.travelState?.currentLocationId ?? null,
        isInTransit: gameSession.travelState?.isInTransit ?? false,
        transitProgress: gameSession.travelState?.transitProgress ?? 0,
      },
      combatState,
    });
  }, [
    combatState,
    currentLocation,
    destinations.length,
    campaignId,
    gameSession.campaignSeed?.id,
    gameSession.campaignSeed?.title,
    gameSession.travelState?.currentLocationId,
    gameSession.travelState?.isInTransit,
    gameSession.travelState?.transitProgress,
    setEngineSnapshot,
  ]);

  if (!campaignId) {
    return <div className="text-sm text-muted-foreground">Campaign not found.</div>;
  }

  if (gameSession.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading session...</div>;
  }

  if (gameSession.error) {
    return (
      <div className="space-y-3">
        <div className="text-destructive">{gameSession.error}</div>
        <Button variant="outline" onClick={() => gameSession.reloadLatestFromDb?.()}>Retry</Button>
      </div>
    );
  }

  if (!gameSession.unifiedState || !gameSession.travelState) {
    return <div className="text-sm text-muted-foreground">World state unavailable.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Game</h1>
          <div className="text-xs text-muted-foreground">Campaign {campaignId}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowTravel(prev => !prev)}>
            {showTravel ? "Hide Travel" : "Show Travel"}
          </Button>
          <Button variant="outline" onClick={() => navigate(`/game/${campaignId}/create-character`)}>
            Character
          </Button>
          {DEV_DEBUG ? (
            <Button
              variant="outline"
              onClick={() => {
                if (engine?.tick) {
                  engine.tick();
                } else {
                  setUiTick(Date.now());
                }
              }}
            >
              Tick
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm font-semibold">{currentLocation?.name ?? "Unknown"}</div>
            <div className="text-xs text-muted-foreground">{currentLocation?.description ?? "No description"}</div>
            <div className="text-xs text-muted-foreground">Connected destinations: {destinations.length}</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {destinations.map(dest => (
                <span key={dest.id} className="rounded-md border border-border px-2 py-1">
                  {dest.name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div>Locations: {gameSession.unifiedState.world.locations.size}</div>
            <div>NPCs: {gameSession.unifiedState.world.npcs.size}</div>
            <div>Quests: {gameSession.unifiedState.world.quests.size}</div>
            <div>Items: {gameSession.unifiedState.world.items.size}</div>
          </CardContent>
        </Card>
      </div>

      {worldBoardModel ? (
        <WorldBoard
          model={worldBoardModel}
          currentLocationId={gameSession.travelState?.currentLocationId ?? null}
        />
      ) : null}

      {showTravel && travelWorldState && user?.id ? (
        <TravelPanel
          world={travelWorldState}
          playerId={user.id}
          isInCombat={combatState === "active"}
          onWorldUpdate={(world) => gameSession.updateUnifiedState(prev => ({ ...prev, world }))}
          onTravelStateUpdate={(travelState) => gameSession.updateTravelState(() => travelState)}
          onCombatStart={() => {
            setCombatState("active");
            setCombatMessage("Combat encountered during travel.");
          }}
        />
      ) : null}

      {combatState === "active" && travelWorldState ? (
        <Card className="border border-border">
          <CardHeader>
            <CardTitle className="text-base">Combat Encounter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-muted-foreground">{combatMessage ?? "Resolve combat to continue."}</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                onClick={() => {
                  const result = resumeTravelAfterCombat(travelWorldState, user?.id ?? "", true);
                  gameSession.updateUnifiedState(prev => ({ ...prev, world: result.world }));
                  gameSession.updateTravelState(() => result.travelState);
                  setCombatState("idle");
                  setCombatMessage(null);
                }}
              >
                Resolve Victory
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const result = resumeTravelAfterCombat(travelWorldState, user?.id ?? "", false);
                  gameSession.updateUnifiedState(prev => ({ ...prev, world: result.world }));
                  gameSession.updateTravelState(() => result.travelState);
                  setCombatState("idle");
                  setCombatMessage(null);
                }}
              >
                Resolve Defeat
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
