import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import { TravelPanel } from "@/components/game/TravelPanel";
import { DMChat } from "@/components/DMChat";
import type { EnhancedLocation } from "@/engine/narrative/Travel";
import type { TravelWorldState } from "@/engine/narrative/TravelPersistence";
import { resumeTravelAfterCombat } from "@/engine/WorldTravelEngine";
import * as World from "@/engine/narrative/World";
import { useDiagnostics } from "@/ui/data/diagnostics";
import { useUnifiedEngineOptional } from "@/contexts/UnifiedEngineContext";
import { useDungeonMaster } from "@/hooks/useDungeonMaster";
import { useCharacter } from "@/hooks/useCharacter";
import { useWorldGenerator } from "@/hooks/useWorldGenerator";
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const DEV_DEBUG = import.meta.env.DEV;
  const { character } = useCharacter(campaignId);
  const dungeonMaster = useDungeonMaster();
  const { generateLocation } = useWorldGenerator();
  const lastLocationIdRef = useRef<string | null>(null);
  const arrivalInFlightRef = useRef(false);
  const visitedLocationsRef = useRef<Set<string>>(new Set());

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

  const selectedNode = worldBoardModel?.nodes.find(node => node.id === selectedNodeId) ?? null;

  const dmContext = useMemo(() => ({
    party: character ? [{
      name: character.name,
      class: character.class,
      level: character.level,
      hp: character.hp,
      maxHp: character.max_hp,
    }] : [],
    location: currentLocation?.name ?? "Unknown",
    campaignName: gameSession.campaignSeed?.title ?? "Campaign",
    inCombat: combatState === "active",
    enemies: [],
  }), [character, combatState, currentLocation?.name, gameSession.campaignSeed?.title]);

  const encounterFlagForCurrent = useMemo(() => {
    if (!gameSession.unifiedState || !currentLocation) return null;
    const flagId = `encounter_possible:${currentLocation.id}`;
    return World.getFlag(gameSession.unifiedState.world, flagId);
  }, [currentLocation, gameSession.unifiedState]);

  const encounterChoiceFlagForCurrent = useMemo(() => {
    if (!gameSession.unifiedState || !currentLocation) return null;
    const flagId = `encounter_choice:${currentLocation.id}`;
    return World.getFlag(gameSession.unifiedState.world, flagId);
  }, [currentLocation, gameSession.unifiedState]);

  const encounterOutcomeFlagForCurrent = useMemo(() => {
    if (!gameSession.unifiedState || !currentLocation) return null;
    const flagId = `encounter_outcome:${currentLocation.id}`;
    return World.getFlag(gameSession.unifiedState.world, flagId);
  }, [currentLocation, gameSession.unifiedState]);

  const hashString = useCallback((value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  }, []);

  const shouldFlagEncounter = useCallback((location: EnhancedLocation | undefined) => {
    if (!location) return false;
    const danger = location.dangerLevel ?? 1;
    const roll = hashString(location.id) % 100;
    return roll < Math.min(90, danger * 10);
  }, [hashString]);

  const expandWorldAtLocation = useCallback(async (location: EnhancedLocation) => {
    if (!gameSession.unifiedState || !gameSession.campaignSeed || !campaignId) return;
    const existingIds = new Set(gameSession.unifiedState.world.locations.keys());
    const normalizeId = (base: string) => {
      let id = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!id) id = `location-${existingIds.size + 1}`;
      let unique = id;
      let suffix = 1;
      while (existingIds.has(unique)) {
        unique = `${id}-${suffix}`;
        suffix += 1;
      }
      existingIds.add(unique);
      return unique;
    };

    const count = location.connectedTo?.length ? 1 : 2;
    const newLocations: EnhancedLocation[] = [];
    for (let i = 0; i < count; i += 1) {
      const generated = await generateLocation(
        {
          title: gameSession.campaignSeed.title,
          description: gameSession.campaignSeed.description ?? "",
          themes: gameSession.campaignSeed.themes ?? [],
        },
        { campaignId, worldState: { currentLocationId: location.id } }
      );
      if (generated) {
        const newId = normalizeId(generated.id || generated.name || `location-${existingIds.size + 1}`);
        newLocations.push({
          ...generated,
          id: newId,
          connectedTo: [location.id],
        } as EnhancedLocation);
      }
    }

    if (newLocations.length === 0) {
      if (location.connectedTo?.length) return;
      const fallback = Array.from(gameSession.unifiedState.world.locations.values()).find(loc => loc.id !== location.id) as EnhancedLocation | undefined;
      if (fallback) {
        connectLocations(location.id, fallback.id);
        await gameSession.autosaveNow?.();
      }
      return;
    }

    gameSession.updateUnifiedState(prev => {
      const locations = new Map(prev.world.locations);
      const current = locations.get(location.id) as EnhancedLocation | undefined;
      const updatedConnections = new Set(current?.connectedTo ?? []);
      newLocations.forEach(loc => updatedConnections.add(loc.id));
      if (current) {
        locations.set(location.id, {
          ...current,
          connectedTo: Array.from(updatedConnections),
        });
      }
      newLocations.forEach(loc => {
        locations.set(loc.id, loc);
      });
      return {
        ...prev,
        world: {
          ...prev.world,
          locations,
        },
      };
    });
    await gameSession.autosaveNow?.();
  }, [campaignId, connectLocations, gameSession, generateLocation]);

  const travelToLocation = useCallback((destinationId: string) => {
    const travelState = gameSession.travelState;
    if (!travelState) return;
    const now = Date.now();
    const history = travelState.travelHistory.map(entry =>
      entry.departedAt === null && entry.locationId === travelState.currentLocationId
        ? { ...entry, departedAt: now }
        : entry
    );
    const nextHistory = [
      ...history,
      {
        locationId: destinationId,
        arrivedAt: now,
        departedAt: null,
      },
    ];
    const nextDiscovered = new Set(travelState.discoveredLocations);
    nextDiscovered.add(destinationId);
    gameSession.updateTravelState(prev => ({
      ...prev,
      previousLocationId: prev.currentLocationId,
      currentLocationId: destinationId,
      isInTransit: false,
      transitProgress: 0,
      transitDestinationId: null,
      travelHistory: nextHistory,
      discoveredLocations: nextDiscovered,
    }));
  }, [gameSession]);

  const connectLocations = useCallback((fromId: string, toId: string) => {
    gameSession.updateUnifiedState(prev => {
      const locations = new Map(prev.world.locations);
      const from = locations.get(fromId) as EnhancedLocation | undefined;
      const to = locations.get(toId) as EnhancedLocation | undefined;
      if (!from || !to) return prev;
      const fromConnections = new Set(from.connectedTo ?? []);
      const toConnections = new Set(to.connectedTo ?? []);
      fromConnections.add(toId);
      toConnections.add(fromId);
      locations.set(fromId, { ...from, connectedTo: Array.from(fromConnections) });
      locations.set(toId, { ...to, connectedTo: Array.from(toConnections) });
      return {
        ...prev,
        world: {
          ...prev.world,
          locations,
        },
      };
    });
  }, [gameSession]);

  const handleArrival = useCallback(async (locationId: string, location?: EnhancedLocation | null) => {
    if (arrivalInFlightRef.current) return;
    arrivalInFlightRef.current = true;
    try {
      const currentLoc = location ?? (gameSession.unifiedState?.world.locations.get(locationId) as EnhancedLocation | undefined);
      if (!currentLoc) return;
      const isFirstVisit = !visitedLocationsRef.current.has(currentLoc.id);
      visitedLocationsRef.current.add(currentLoc.id);

      const encounterFlag = shouldFlagEncounter(currentLoc);
      const flagId = `encounter_possible:${currentLoc.id}`;
      gameSession.updateUnifiedState(prev => ({
        ...prev,
        world: World.setFlag(prev.world, flagId, encounterFlag, "arrival"),
      }));
      const narrationPrompt = `In 1-2 sentences, narrate the party arriving at ${currentLoc.name}.` +
        (encounterFlag ? " Hint that danger may be nearby." : "");
      await dungeonMaster.sendNarration?.(narrationPrompt, dmContext);

      if (isFirstVisit) {
        await expandWorldAtLocation(currentLoc);
      }
      await gameSession.autosaveNow?.();
      await gameSession.reloadLatestFromDb?.();
    } finally {
      arrivalInFlightRef.current = false;
    }
  }, [dmContext, dungeonMaster, expandWorldAtLocation, gameSession, shouldFlagEncounter]);

  const handleEncounterChoice = useCallback(async (choice: "investigate" | "avoid") => {
    if (!currentLocation) return;
    const possibleFlagId = `encounter_possible:${currentLocation.id}`;
    const choiceFlagId = `encounter_choice:${currentLocation.id}`;
    gameSession.updateUnifiedState(prev => ({
      ...prev,
      world: World.setFlag(
        World.setFlag(prev.world, possibleFlagId, false, "encounter_choice"),
        choiceFlagId,
        choice,
        "encounter_choice"
      ),
    }));
    const prompt = choice === "investigate"
      ? `In 1-2 sentences, narrate the party deciding to investigate the nearby threat at ${currentLocation.name}.`
      : `In 1-2 sentences, narrate the party choosing to avoid trouble and move cautiously through ${currentLocation.name}.`;
    await dungeonMaster.sendNarration?.(prompt, dmContext);
    await gameSession.autosaveNow?.();
  }, [currentLocation, dmContext, dungeonMaster, gameSession]);

  const resolveEncounterOutcome = useCallback(async () => {
    if (!currentLocation || !gameSession.campaignSeed) return;
    if (encounterChoiceFlagForCurrent?.value !== "investigate") return;
    if (encounterOutcomeFlagForCurrent?.value) return;

    const seedKey = `${gameSession.campaignSeed.id}:${currentLocation.id}:encounter`;
    const roll = hashString(seedKey) % 100;
    let outcome: "combat" | "npc" | "loot" | "nothing" = "nothing";
    if (roll < 35) outcome = "combat";
    else if (roll < 60) outcome = "npc";
    else if (roll < 80) outcome = "loot";

    const outcomeFlagId = `encounter_outcome:${currentLocation.id}`;
    const payloadFlagId = `encounter_payload:${currentLocation.id}`;
    const payload = outcome === "npc"
      ? JSON.stringify({ hint: "A traveler emerges from the shadows." })
      : outcome === "loot"
        ? JSON.stringify({ hint: "Something glints nearby." })
        : null;

    gameSession.updateUnifiedState(prev => ({
      ...prev,
      world: World.setFlag(
        payload
          ? World.setFlag(prev.world, payloadFlagId, payload, "encounter_outcome")
          : prev.world,
        outcomeFlagId,
        outcome,
        "encounter_outcome"
      ),
    }));

    const narrationPrompt = outcome === "combat"
      ? `In 1-2 sentences, describe the party discovering signs of an imminent fight at ${currentLocation.name}.`
      : outcome === "npc"
        ? `In 1-2 sentences, narrate the party meeting a wary traveler at ${currentLocation.name}.`
        : outcome === "loot"
          ? `In 1-2 sentences, describe the party finding a curious object at ${currentLocation.name}.`
          : `In 1-2 sentences, describe the party realizing the danger was a false alarm at ${currentLocation.name}.`;
    await dungeonMaster.sendNarration?.(narrationPrompt, dmContext);
    await gameSession.autosaveNow?.();
  }, [
    currentLocation,
    dmContext,
    dungeonMaster,
    encounterChoiceFlagForCurrent?.value,
    encounterOutcomeFlagForCurrent?.value,
    gameSession,
    hashString,
  ]);

  useEffect(() => {
    const currentId = gameSession.travelState?.currentLocationId ?? null;
    if (!currentId) return;
    if (lastLocationIdRef.current === currentId) return;
    lastLocationIdRef.current = currentId;
    void handleArrival(currentId, currentLocation ?? null);
  }, [currentLocation, gameSession.travelState?.currentLocationId, handleArrival]);

  useEffect(() => {
    void resolveEncounterOutcome();
  }, [resolveEncounterOutcome]);

  const handleSendMessage = useCallback(async (message: string) => {
    const normalized = message.toLowerCase();
    if (normalized.includes("go to town") || normalized.includes("travel to town")) {
      const locations = gameSession.unifiedState?.world.locations ?? new Map();
      const town = Array.from(locations.values()).find(loc =>
        loc.name?.toLowerCase().includes("town") || loc.id.toLowerCase() === "town" || loc.type === "town"
      ) as EnhancedLocation | undefined;
      if (town && currentLocation) {
        if (!town.connectedTo?.includes(currentLocation.id)) {
          connectLocations(currentLocation.id, town.id);
          await gameSession.autosaveNow?.();
        }
        if (town.id !== currentLocation.id) {
          travelToLocation(town.id);
          return;
        }
      }
      if (currentLocation) {
        await expandWorldAtLocation(currentLocation);
      }
    }
    return dungeonMaster.sendMessage(message, dmContext);
  }, [
    connectLocations,
    currentLocation,
    dmContext,
    dungeonMaster,
    expandWorldAtLocation,
    gameSession,
    travelToLocation,
  ]);

  useEffect(() => {
    if (!worldBoardModel?.nodes.length) return;
    setSelectedNodeId(prev => prev ?? gameSession.travelState?.currentLocationId ?? worldBoardModel.nodes[0]?.id ?? null);
  }, [gameSession.travelState?.currentLocationId, worldBoardModel?.nodes]);

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

  const isWorldGenErrorCurrent =
    Boolean(gameSession.lastWorldGenError) &&
    (!gameSession.lastWorldGenSuccessAt || (gameSession.lastWorldGenErrorAt ?? 0) > (gameSession.lastWorldGenSuccessAt ?? 0));

  if (gameSession.bootstrapStatus === "error" && isWorldGenErrorCurrent) {
    return (
      <div className="space-y-3">
        <div className="text-destructive">{gameSession.error ?? "World generation failed."}</div>
        <div className="text-sm text-muted-foreground">Retry world generation to continue.</div>
        <Button variant="outline" onClick={() => gameSession.retryBootstrap?.()}>Retry world generation</Button>
        <Button variant="ghost" onClick={() => gameSession.reloadLatestFromDb?.()}>Reload from DB</Button>
      </div>
    );
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
          {DEV_DEBUG ? (
            <Button
              variant="outline"
              onClick={() => {
                void gameSession.expandWorld?.(3);
              }}
            >
              Expand World
            </Button>
          ) : null}
        </div>
      </div>
      {DEV_DEBUG && gameSession.lastWorldGenError && (!gameSession.lastWorldGenSuccessAt || (gameSession.lastWorldGenErrorAt ?? 0) > (gameSession.lastWorldGenSuccessAt ?? 0)) ? (
        <div className="rounded-md border border-border bg-card/70 p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-semibold text-foreground">Last world-generator error</div>
          <pre className="whitespace-pre-wrap">{JSON.stringify(gameSession.lastWorldGenError, null, 2)}</pre>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr,2fr,1fr]">
        <Card className="flex h-[640px] flex-col">
          <CardHeader>
            <CardTitle className="text-base">Dungeon Master</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0">
            <DMChat
              messages={dungeonMaster.messages}
              isLoading={dungeonMaster.isLoading}
              currentResponse={dungeonMaster.currentResponse}
              onSendMessage={handleSendMessage}
              suggestions={dungeonMaster.messages.at(-1)?.parsed?.suggestions}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          {worldBoardModel ? (
            <WorldBoard
              model={worldBoardModel}
              currentLocationId={gameSession.travelState?.currentLocationId ?? null}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
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
              onTravelComplete={async ({ travelState, destination }) => {
                if (destination) {
                  lastLocationIdRef.current = destination.id;
                  await handleArrival(travelState.currentLocationId, destination);
                }
              }}
            />
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inspector</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="text-sm font-semibold text-foreground">
                {selectedNode?.name ?? "Select a location"}
              </div>
              <div>ID: {selectedNode?.id ?? "-"}</div>
              <div>Position: {selectedNode?.x != null ? `${Math.round(selectedNode.x)}, ${Math.round(selectedNode.y)}` : "-"}</div>
              <div>Current: {selectedNode?.id === currentLocation?.id ? "yes" : "no"}</div>
              <div>Connected: {destinations.length}</div>
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
              <div>Current: {currentLocation?.name ?? "Unknown"}</div>
              {encounterFlagForCurrent?.value === true ? (
                <div className="text-muted-foreground">You sense something nearby.</div>
              ) : null}
              {encounterFlagForCurrent?.value === true && encounterChoiceFlagForCurrent?.value == null ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => handleEncounterChoice("investigate")}>
                    Investigate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleEncounterChoice("avoid")}>
                    Avoid
                  </Button>
                </div>
              ) : null}
              {encounterOutcomeFlagForCurrent?.value === "combat" ? (
                <div className="text-muted-foreground">Combat encounter pending.</div>
              ) : null}
              {encounterOutcomeFlagForCurrent?.value === "npc" ? (
                <div className="text-muted-foreground">NPC encounter pending.</div>
              ) : null}
              {encounterOutcomeFlagForCurrent?.value === "loot" ? (
                <div className="text-muted-foreground">You found something.</div>
              ) : null}
              {encounterOutcomeFlagForCurrent?.value === "nothing" ? (
                <div className="text-muted-foreground">False alarm.</div>
              ) : null}
            </CardContent>
          </Card>

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
      </div>
    </div>
  );
}
