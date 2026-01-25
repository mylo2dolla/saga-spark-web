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
import { useDiagnostics } from "@/ui/data/useDiagnostics";
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const DEV_DEBUG = import.meta.env.DEV;
  const { character } = useCharacter(campaignId);
  const dungeonMaster = useDungeonMaster();
  const { generateLocation } = useWorldGenerator();
  const lastLocationIdRef = useRef<string | null>(null);
  const arrivalInFlightRef = useRef(false);
  const visitedLocationsRef = useRef<Set<string>>(new Set());
  const worldEvents = gameSession.worldEvents;

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

  const locations = useMemo(() => {
    const raw = gameSession.unifiedState?.world?.locations as unknown;
    if (raw instanceof Map) return raw as Map<string, EnhancedLocation>;
    if (Array.isArray(raw)) return new Map(raw as Array<[string, EnhancedLocation]>);
    if (raw && typeof raw === "object") {
      return new Map(Object.entries(raw as Record<string, EnhancedLocation>));
    }
    return new Map<string, EnhancedLocation>();
  }, [gameSession.unifiedState]);

  const safeWorld = useMemo(() => {
    if (!gameSession.unifiedState?.world) return null;
    if (gameSession.unifiedState.world.locations === locations) {
      return gameSession.unifiedState.world;
    }
    return {
      ...gameSession.unifiedState.world,
      locations,
    };
  }, [gameSession.unifiedState, locations]);

  const currentLocation = useMemo(() => {
    if (!safeWorld || !gameSession.travelState) return undefined;
    return locations.get(gameSession.travelState.currentLocationId) as EnhancedLocation | undefined;
  }, [gameSession.travelState, locations, safeWorld]);

  const destinations = useMemo(() => {
    if (!safeWorld || !currentLocation) return [] as EnhancedLocation[];
    return (currentLocation.connectedTo ?? [])
      .map(id => locations.get(id) as EnhancedLocation | undefined)
      .filter((loc): loc is EnhancedLocation => Boolean(loc));
  }, [currentLocation, locations, safeWorld]);

  const travelWorldState = useMemo((): TravelWorldState | null => {
    if (!safeWorld || !gameSession.travelState) return null;
    return {
      ...safeWorld,
      travelState: gameSession.travelState,
    };
  }, [gameSession.travelState, safeWorld]);

  const worldBoardModel = useMemo(() => {
    if (!safeWorld || !gameSession.unifiedState) return null;
    const stateWithTravel = {
      ...gameSession.unifiedState,
      world: {
        ...safeWorld,
        travelState: gameSession.travelState ?? undefined,
      },
    };
    return toWorldBoardModel(stateWithTravel);
  }, [gameSession.travelState, gameSession.unifiedState, safeWorld]);

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
    if (!safeWorld || !currentLocation) return null;
    const flagId = `encounter_possible:${currentLocation.id}`;
    return World.getFlag(safeWorld, flagId);
  }, [currentLocation, safeWorld]);

  const encounterChoiceFlagForCurrent = useMemo(() => {
    if (!safeWorld || !currentLocation) return null;
    const flagId = `encounter_choice:${currentLocation.id}`;
    return World.getFlag(safeWorld, flagId);
  }, [currentLocation, safeWorld]);

  const encounterOutcomeFlagForCurrent = useMemo(() => {
    if (!safeWorld || !currentLocation) return null;
    const flagId = `encounter_outcome:${currentLocation.id}`;
    return World.getFlag(safeWorld, flagId);
  }, [currentLocation, safeWorld]);

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

  const expandWorldAtLocation = useCallback(async (location: EnhancedLocation) => {
    if (!safeWorld || !gameSession.campaignSeed || !campaignId) return;
    const existingIds = new Set(locations.keys());
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
      const fallback = Array.from(locations.values()).find(loc => loc.id !== location.id) as EnhancedLocation | undefined;
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
  }, [campaignId, connectLocations, gameSession, generateLocation, locations, safeWorld]);

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

  const handleArrival = useCallback(async (locationId: string, location?: EnhancedLocation | null) => {
    if (arrivalInFlightRef.current) return;
    arrivalInFlightRef.current = true;
    try {
      const currentLoc = location ?? (locations.get(locationId) as EnhancedLocation | undefined);
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
  }, [dmContext, dungeonMaster, expandWorldAtLocation, gameSession, locations, shouldFlagEncounter]);

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
          ? World.setFlag(prev.world, payloadFlagId, payload, "encounter_payload")
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
      const localLocations = locations.size ? locations : new Map<string, EnhancedLocation>();
      const town = Array.from(localLocations.values()).find(loc =>
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
    const dmResult = await dungeonMaster.sendMessage(message, dmContext);
    await gameSession.submitPlayerAction?.(message, dmResult?.parsed?.narration ?? null);
    return dmResult;
  }, [
    connectLocations,
    currentLocation,
    dmContext,
    dungeonMaster,
    expandWorldAtLocation,
    gameSession,
    locations,
    travelToLocation,
  ]);

  useEffect(() => {
    if (!worldBoardModel?.nodes.length) return;
    setSelectedNodeId(prev => prev ?? gameSession.travelState?.currentLocationId ?? worldBoardModel.nodes[0]?.id ?? null);
  }, [gameSession.travelState?.currentLocationId, worldBoardModel?.nodes]);

  useEffect(() => {
    if (!safeWorld) return;
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
      knownLocations: Array.from(safeWorld.locations.keys()),
      storyFlags: Array.from(safeWorld.storyFlags.keys()),
      activeQuests: Array.from(safeWorld.quests.values())
        .filter(quest => quest.status !== "completed")
        .map(quest => quest.title),
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
    safeWorld,
    safeWorld?.locations,
    safeWorld?.quests,
    safeWorld?.storyFlags,
    setEngineSnapshot,
  ]);

  useEffect(() => {
    if (!DEV_DEBUG) return;
    const controls = {
      replayLastEvents: (count: number = 10) => gameSession.replayWorldEvents?.(count),
      reloadFromDb: () => gameSession.reloadLatestFromDb?.(),
    };
    (globalThis as { __worldEventControls?: typeof controls }).__worldEventControls = controls;
    return () => {
      const existing = (globalThis as { __worldEventControls?: typeof controls }).__worldEventControls;
      if (existing === controls) {
        delete (globalThis as { __worldEventControls?: typeof controls }).__worldEventControls;
      }
    };
  }, [DEV_DEBUG, gameSession]);

  const lastActionDelta = useMemo(() => {
    if (!gameSession.lastActionDelta) return null;
    if (typeof gameSession.lastActionDelta === "string") return { summary: gameSession.lastActionDelta };
    if (typeof gameSession.lastActionDelta === "object") {
      return gameSession.lastActionDelta as {
        summary?: string;
        locations?: unknown[];
        npcs?: unknown[];
        quests?: unknown[];
        storyFlags?: unknown[];
      };
    }
    return null;
  }, [gameSession.lastActionDelta]);

  const lastActionSummary = lastActionDelta?.summary ?? null;
  const lastActionCounts = lastActionDelta
    ? {
        locations: Array.isArray(lastActionDelta.locations) ? lastActionDelta.locations.length : 0,
        npcs: Array.isArray(lastActionDelta.npcs) ? lastActionDelta.npcs.length : 0,
        quests: Array.isArray(lastActionDelta.quests) ? lastActionDelta.quests.length : 0,
        storyFlags: Array.isArray(lastActionDelta.storyFlags) ? lastActionDelta.storyFlags.length : 0,
      }
    : null;

  const groupedEvents = useMemo(() => {
    const today = new Date().toDateString();
    const groups: Array<{ label: string; events: typeof worldEvents }> = [];
    const todayEvents = worldEvents.filter(event => new Date(event.createdAt).toDateString() === today);
    const earlierEvents = worldEvents.filter(event => new Date(event.createdAt).toDateString() !== today);
    if (todayEvents.length > 0) {
      groups.push({ label: "Today", events: todayEvents });
    }
    if (earlierEvents.length > 0) {
      groups.push({ label: "Earlier", events: earlierEvents });
    }
    return groups;
  }, [worldEvents]);

  useEffect(() => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTop = 0;
  }, [worldEvents.length]);

  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const toggleEvent = useCallback((id: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const formatEventCounts = useCallback((delta: unknown) => {
    if (!delta || typeof delta !== "object") return null;
    const obj = delta as Record<string, unknown>;
    const locations = Array.isArray(obj.locations) ? obj.locations.length : 0;
    const npcs = Array.isArray(obj.npcs) ? obj.npcs.length : 0;
    const quests = Array.isArray(obj.quests) ? obj.quests.length : 0;
    const flags = Array.isArray(obj.storyFlags) ? obj.storyFlags.length : 0;
    return { locations, npcs, quests, flags };
  }, []);

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

  if (!safeWorld || !gameSession.travelState || locations.size === 0) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <div>Loading world...</div>
        <div className="text-xs">World data is still initializing.</div>
        {gameSession.reloadLatestFromDb ? (
          <Button variant="outline" onClick={() => gameSession.reloadLatestFromDb?.()}>
            Reload from DB
          </Button>
        ) : null}
      </div>
    );
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
          <div className="text-xs text-muted-foreground self-center">
            DB: {gameSession.worldEventsStatus === "loading" ? "loading" : gameSession.worldEventsStatus}
            {gameSession.isReplayingEvents && gameSession.replayEventsCount ? ` • replaying ${gameSession.replayEventsCount}` : ""}
          </div>
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
              error={gameSession.lastActionError}
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
              <CardTitle className="text-base">World Events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {gameSession.worldEventsStatus === "loading" ? (
                <div className="text-muted-foreground">Loading events...</div>
              ) : null}
              {gameSession.worldEventsError ? (
                <div className="text-destructive">DB: {gameSession.worldEventsError}</div>
              ) : null}
              {gameSession.worldEvents.length === 0 && gameSession.worldEventsStatus === "ok" ? (
                <div className="text-muted-foreground">No world events yet.</div>
              ) : null}
              <div ref={timelineRef} className="max-h-[320px] overflow-auto space-y-3">
                {gameSession.isReplayingEvents ? (
                  <div className="text-muted-foreground">Replaying events...</div>
                ) : null}
                {groupedEvents.map(group => (
                  <div key={group.label} className="space-y-2">
                    <div className="text-xs uppercase text-muted-foreground">{group.label}</div>
                    {group.events.map((event) => {
                      const counts = formatEventCounts(event.delta);
                      const expanded = expandedEvents.has(event.id);
                      const summary =
                        typeof (event.delta as { summary?: string } | null)?.summary === "string"
                          ? (event.delta as { summary?: string }).summary
                          : event.responseText ?? event.actionText;
                      const eventType = "Action";
                      return (
                        <div key={event.id} className="rounded-md border border-border p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="space-y-1">
                              <div className="text-xs text-muted-foreground">
                                {new Date(event.createdAt).toLocaleTimeString()} · {eventType}
                              </div>
                              <div className="text-sm font-medium text-foreground">{summary}</div>
                              {event.locationName ? (
                                <div className="text-xs text-muted-foreground">Location: {event.locationName}</div>
                              ) : null}
                              {counts ? (
                                <div className="text-xs text-muted-foreground">
                                  +{counts.locations} locs, +{counts.npcs} npcs, +{counts.quests} quests, +{counts.flags} flags
                                </div>
                              ) : null}
                            </div>
                            <Button size="sm" variant="outline" onClick={() => toggleEvent(event.id)}>
                              {expanded ? "Hide" : "Show"}
                            </Button>
                          </div>
                          {expanded ? (
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">
                              {JSON.stringify(event.delta, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {DEV_DEBUG && gameSession.lastActionError ? (
                <details className="rounded-md border border-border p-2 text-xs">
                  <summary className="cursor-pointer">Last error (dev)</summary>
                  <pre className="mt-2 whitespace-pre-wrap">
                    {JSON.stringify({ error: gameSession.lastActionError, actionHash: gameSession.lastActionHash }, null, 2)}
                  </pre>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div>Locations: {safeWorld.locations.size}</div>
              <div>NPCs: {safeWorld.npcs.size}</div>
              <div>Quests: {safeWorld.quests.size}</div>
              <div>Items: {safeWorld.items.size}</div>
              <div>Current: {currentLocation?.name ?? "Unknown"}</div>
              {gameSession.lastActionEvent ? (
                <div className="pt-2 text-muted-foreground">
                  <div className="font-medium text-foreground">Last action</div>
                  <div>{gameSession.lastActionEvent.actionText}</div>
                  {lastActionSummary ? <div className="mt-1">{lastActionSummary}</div> : null}
                  {lastActionCounts ? (
                    <div className="mt-1">
                      Changes: +{lastActionCounts.locations} locations, +{lastActionCounts.npcs} npcs, +{lastActionCounts.quests} quests, +{lastActionCounts.storyFlags} flags
                    </div>
                  ) : null}
                </div>
              ) : null}
              {gameSession.lastActionError ? (
                <div className="text-destructive">Action failed: {gameSession.lastActionError}</div>
              ) : null}
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
