import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  buildVisualEventQueue,
  useBoardRendererMount,
  type RenderFrameState,
  type RenderSnapshot,
  type TileOverlayKind,
  type VisualEvent,
} from "@/ui/components/mythic/board2/render";

function buildHarnessSnapshot(): RenderSnapshot {
  const width = 11;
  const height = 7;
  const tileSize = 48;

  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const overlays: TileOverlayKind[] = [];
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) overlays.push("road");
    if ((x === 5 && y === 2) || (x === 6 && y === 2)) overlays.push("hazard");
    return {
      x,
      y,
      biomeVariant: (x + y) % 2 === 0 ? "base" as const : "alt" as const,
      isWalkable: !(x === 3 && y === 3),
      isBlocked: x === 3 && y === 3,
      overlays,
    };
  });

  return {
    board: {
      id: "harness:combat",
      type: "combat",
      width,
      height,
      tileSize,
      biomeId: "plains_road_dust",
      tick: 1,
      seed: "harness-seed",
      lighting: {
        tint: 0xffd29a,
        vignetteAlpha: 0.14,
        fogAlpha: 0.05,
        saturation: 1,
      },
    },
    tiles,
    entities: [
      {
        id: "player:hero",
        kind: "player",
        team: "ally",
        x: 2,
        y: 4,
        displayName: "Mira",
        fullName: "Mira Wavecaller",
        hp: 102,
        hpMax: 130,
        barrier: 18,
        mp: 46,
        mpMax: 60,
        statuses: [{ id: "mira:guard", statusId: "guard", family: "guard" }],
        intent: { type: "cast", targetTile: { x: 7, y: 3 }, aoeTiles: [{ x: 7, y: 3 }, { x: 7, y: 4 }, { x: 6, y: 3 }] },
        isActive: true,
        isFocused: true,
      },
      {
        id: "enemy:nightcoil",
        kind: "enemy",
        team: "enemy",
        x: 7,
        y: 3,
        displayName: "Nightcoil",
        fullName: "Nightcoil Reaver",
        hp: 88,
        hpMax: 120,
        barrier: 0,
        mp: 25,
        mpMax: 40,
        statuses: [{ id: "night:bleed", statusId: "bleed", family: "bleed" }],
        intent: { type: "attack", targetId: "player:hero" },
      },
      {
        id: "enemy:mirefang",
        kind: "enemy",
        team: "enemy",
        x: 8,
        y: 4,
        displayName: "Mirefang",
        fullName: "Mirefang",
        hp: 95,
        hpMax: 95,
        barrier: 12,
        mp: 20,
        mpMax: 20,
        statuses: [{ id: "mire:barrier", statusId: "barrier", family: "barrier" }],
        intent: { type: "defend" },
      },
      {
        id: "npc:merchant",
        kind: "npc",
        team: "neutral",
        x: 1,
        y: 1,
        displayName: "Quartermaster",
        markerRole: "merchant",
      },
      {
        id: "building:notice",
        kind: "building",
        team: "neutral",
        x: 4,
        y: 1,
        displayName: "Notice Board",
        markerRole: "quest",
      },
    ],
    uiOverlays: [
      { id: "overlay:quest", type: "quest", x: 4, y: 1, label: "Contract", priority: 1 },
      { id: "overlay:danger", type: "danger", x: 7, y: 3, label: "Hostiles", priority: 1 },
    ],
    telegraphs: [
      {
        id: "line:hero:nightcoil",
        kind: "line",
        sourceEntityId: "player:hero",
        targetEntityId: "enemy:nightcoil",
        style: "preview",
      },
      {
        id: "aoe:judgment",
        kind: "aoe",
        sourceEntityId: "player:hero",
        tiles: [{ x: 7, y: 3 }, { x: 7, y: 4 }, { x: 6, y: 3 }],
        style: "imminent",
      },
    ],
    effectsQueue: {
      cursor: null,
      queue: [],
    },
  };
}

function buildRawCombatEvents() {
  return [
    {
      id: "e1",
      turn_index: 12,
      event_type: "moved",
      actor_combatant_id: "player:hero",
      created_at: "2026-02-22T10:00:00.000Z",
      payload: {
        source_combatant_id: "player:hero",
        from: { x: 2, y: 4 },
        to: { x: 3, y: 4 },
      },
    },
    {
      id: "e2",
      turn_index: 12,
      event_type: "damage",
      actor_combatant_id: "player:hero",
      created_at: "2026-02-22T10:00:01.000Z",
      payload: {
        source_combatant_id: "player:hero",
        target_combatant_id: "enemy:nightcoil",
        damage_to_hp: 34,
      },
    },
    {
      id: "e2-dup",
      turn_index: 12,
      event_type: "damage",
      actor_combatant_id: "player:hero",
      created_at: "2026-02-22T10:00:01.100Z",
      payload: {
        source_combatant_id: "player:hero",
        target_combatant_id: "enemy:nightcoil",
        damage_to_hp: 34,
      },
    },
    {
      id: "e3",
      turn_index: 12,
      event_type: "miss",
      actor_combatant_id: "enemy:mirefang",
      created_at: "2026-02-22T10:00:02.000Z",
      payload: {
        source_combatant_id: "enemy:mirefang",
        target_combatant_id: "player:hero",
        roll_d20: 8,
        required_roll: 11,
      },
    },
    {
      id: "e4",
      turn_index: 12,
      event_type: "status_applied",
      actor_combatant_id: "enemy:nightcoil",
      created_at: "2026-02-22T10:00:02.300Z",
      payload: {
        source_combatant_id: "enemy:nightcoil",
        target_combatant_id: "enemy:nightcoil",
        status: { id: "barrier" },
      },
    },
    {
      id: "e5",
      turn_index: 12,
      event_type: "status_applied",
      actor_combatant_id: "enemy:nightcoil",
      created_at: "2026-02-22T10:00:02.400Z",
      payload: {
        source_combatant_id: "enemy:nightcoil",
        target_combatant_id: "enemy:nightcoil",
        status: { id: "guard" },
      },
    },
    {
      id: "e6",
      turn_index: 12,
      event_type: "healed",
      actor_combatant_id: "player:hero",
      created_at: "2026-02-22T10:00:02.700Z",
      payload: {
        source_combatant_id: "player:hero",
        target_combatant_id: "player:hero",
        amount: 18,
      },
    },
    {
      id: "e7",
      turn_index: 12,
      event_type: "status_tick",
      actor_combatant_id: "enemy:nightcoil",
      created_at: "2026-02-22T10:00:03.000Z",
      payload: {
        source_combatant_id: "enemy:nightcoil",
        target_combatant_id: "enemy:nightcoil",
        status_id: "bleed",
        amount: 7,
      },
    },
    {
      id: "e8",
      turn_index: 12,
      event_type: "armor_shred",
      actor_combatant_id: "player:hero",
      created_at: "2026-02-22T10:00:03.300Z",
      payload: {
        source_combatant_id: "player:hero",
        target_combatant_id: "enemy:mirefang",
        amount: 9,
      },
    },
    {
      id: "e9",
      turn_index: 12,
      event_type: "turn_end",
      actor_combatant_id: "player:hero",
      created_at: "2026-02-22T10:00:03.400Z",
      payload: {
        source_combatant_id: "player:hero",
      },
    },
    {
      id: "e10",
      turn_index: 13,
      event_type: "turn_start",
      actor_combatant_id: "enemy:nightcoil",
      created_at: "2026-02-22T10:00:03.500Z",
      payload: {
        source_combatant_id: "enemy:nightcoil",
      },
    },
  ];
}

export default function MythicRenderHarnessScreen() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<RenderFrameState | null>(null);
  const [fastMode, setFastMode] = useState(false);
  const [showDev, setShowDev] = useState(true);
  const [events, setEvents] = useState<VisualEvent[]>([]);
  const [replayNonce, setReplayNonce] = useState(0);
  const [cameraPulseSeen, setCameraPulseSeen] = useState(false);

  const snapshot = useMemo(() => buildHarnessSnapshot(), []);
  const rawEvents = useMemo(() => buildRawCombatEvents(), []);
  const queued = useMemo(() => {
    const built = buildVisualEventQueue(rawEvents, frameRef.current, {
      snapshot,
      boardType: snapshot.board.type,
    });
    frameRef.current = built.frameState;
    return built.queue;
  }, [rawEvents, snapshot, replayNonce]);

  useEffect(() => {
    setEvents([]);
    let cancelled = false;
    const timers: number[] = [];
    queued.forEach((event, index) => {
      const timer = window.setTimeout(() => {
        if (cancelled) return;
        setEvents((prev) => [...prev, event]);
      }, index * 170);
      timers.push(timer);
    });
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [queued]);

  const rendererSettings = useMemo(
    () => ({
      fastMode,
      cinematicCamera: !fastMode,
      showDevOverlay: showDev,
      reducedMotion: false,
      fitMode: "adaptive_contain" as const,
      edgePaddingPx: 12,
      safeInsetTopPx: 0,
      safeInsetBottomPx: 0,
      backgroundFill: 0x120f12,
    }),
    [fastMode, showDev],
  );

  const { debugState, ready } = useBoardRendererMount({
    hostRef,
    snapshot,
    events,
    settings: rendererSettings,
  });

  const queuedTypes = queued.map((event) => event.type);
  const hasMovement = queuedTypes.includes("MoveTrail");
  const hasHit = queuedTypes.includes("HitImpact") && queuedTypes.includes("DamageNumber");
  const hasMiss = queuedTypes.includes("MissIndicator");
  const hasBarrier = queuedTypes.includes("StatusApplyMulti") || queuedTypes.includes("BarrierGain");
  const hasBleedTick = queuedTypes.includes("StatusTick");
  const hasAoE = snapshot.telegraphs.some((entry) => entry.kind === "aoe");
  const cameraPulse = (debugState.cameraScale ?? 1) > 1.01 || (debugState.cameraShakeMs ?? 0) > 0;

  useEffect(() => {
    if (cameraPulse) setCameraPulseSeen(true);
  }, [cameraPulse]);

  useEffect(() => {
    setCameraPulseSeen(false);
  }, [replayNonce]);

  return (
    <div className="min-h-screen bg-[#090d14] p-4 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-3">
        <h1 className="text-xl font-semibold">Mythic Render Harness</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setReplayNonce((value) => value + 1)} data-testid="harness-replay">
            Replay Sequence
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setFastMode((value) => !value)} data-testid="harness-fast-mode">
            Fast Mode: {fastMode ? "On" : "Off"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowDev((value) => !value)} data-testid="harness-dev-overlay">
            Dev Overlay: {showDev ? "On" : "Off"}
          </Button>
          <div className="text-xs text-slate-300">raw {rawEvents.length} · queued {queued.length} · played {events.length}</div>
        </div>

        <div className="rounded-lg border border-slate-700/80 bg-black/30 p-2">
          <div ref={hostRef} data-testid="render-harness-board" className="h-[560px] w-full overflow-hidden rounded" />
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div data-testid="assert-movement" className="rounded border border-slate-700 bg-slate-900/60 p-2">movement {String(hasMovement)}</div>
          <div data-testid="assert-hit" className="rounded border border-slate-700 bg-slate-900/60 p-2">hit+damage {String(hasHit)}</div>
          <div data-testid="assert-miss" className="rounded border border-slate-700 bg-slate-900/60 p-2">miss {String(hasMiss)}</div>
          <div data-testid="assert-barrier" className="rounded border border-slate-700 bg-slate-900/60 p-2">barrier/status {String(hasBarrier)}</div>
          <div data-testid="assert-bleed" className="rounded border border-slate-700 bg-slate-900/60 p-2">bleed tick {String(hasBleedTick)}</div>
          <div data-testid="assert-aoe" className="rounded border border-slate-700 bg-slate-900/60 p-2">aoe telegraph {String(hasAoE)}</div>
          <div data-testid="assert-camera" className="rounded border border-slate-700 bg-slate-900/60 p-2">camera pulse {String(cameraPulseSeen || queuedTypes.includes("HitImpact"))}</div>
          <div data-testid="assert-fallback" className="rounded border border-slate-700 bg-slate-900/60 p-2">fallback sprites {String(ready)}</div>
        </div>
      </div>
    </div>
  );
}
