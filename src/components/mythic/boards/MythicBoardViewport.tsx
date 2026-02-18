import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TownScene } from "@/components/mythic/boards/TownScene";
import { TravelScene } from "@/components/mythic/boards/TravelScene";
import { DungeonScene } from "@/components/mythic/boards/DungeonScene";
import type { MythicBoardEntity, MythicBoardStateV2, MythicDirection } from "@/types/mythicBoard";

interface BoardInteractArgs {
  entityId: string;
  entityKind: MythicBoardEntity["kind"];
  action: "interact" | "destroy" | "open";
}

interface MythicBoardViewportProps {
  boardState: MythicBoardStateV2;
  isBusy?: boolean;
  onEdgeStep: (direction: MythicDirection) => Promise<void>;
  onInteract: (args: BoardInteractArgs) => Promise<void>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function isBlockingTile(boardState: MythicBoardStateV2, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= boardState.grid.width || y >= boardState.grid.height) return true;

  const collisionLayers = boardState.grid.layers.filter((layer) => layer.collision);
  for (const layer of collisionLayers) {
    const row = layer.tiles[y];
    const tile = row?.[x] ?? "void";
    if (tile !== "void") {
      return true;
    }
  }
  return false;
}

function findNearestInteractable(boardState: MythicBoardStateV2, player: { x: number; y: number }): MythicBoardEntity | null {
  const all = [
    ...boardState.entities.interactables,
    ...boardState.entities.loot,
    ...boardState.entities.npcs,
    ...boardState.entities.mobs,
  ].filter((entity) => !boardState.runtime.destroyed_ids.includes(entity.id));

  let nearest: MythicBoardEntity | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const entity of all) {
    const d = distance(player, entity);
    if (d < best) {
      best = d;
      nearest = entity;
    }
  }

  if (!nearest || best > 1.8) return null;
  return nearest;
}

export function MythicBoardViewport({ boardState, isBusy = false, onEdgeStep, onInteract }: MythicBoardViewportProps) {
  const spawn = boardState.entities.player_spawn;
  const [player, setPlayer] = useState(() => ({
    x: spawn?.x ?? Math.floor(boardState.grid.width / 2),
    y: spawn?.y ?? Math.floor(boardState.grid.height / 2),
  }));
  const [travelTarget, setTravelTarget] = useState<{ x: number; y: number } | null>(null);
  const [interactionHint, setInteractionHint] = useState<string>("Move with WASD · E interact · R destroy");

  const heldKeysRef = useRef<Set<string>>(new Set());
  const steppingRef = useRef(false);

  const interactablesById = useMemo(() => {
    const m = new Map<string, MythicBoardEntity>();
    for (const entity of [
      ...boardState.entities.interactables,
      ...boardState.entities.loot,
      ...boardState.entities.npcs,
      ...boardState.entities.mobs,
    ]) {
      m.set(entity.id, entity);
    }
    return m;
  }, [boardState.entities.interactables, boardState.entities.loot, boardState.entities.mobs, boardState.entities.npcs]);

  useEffect(() => {
    setPlayer({
      x: spawn?.x ?? Math.floor(boardState.grid.width / 2),
      y: spawn?.y ?? Math.floor(boardState.grid.height / 2),
    });
    setTravelTarget(null);
    steppingRef.current = false;
  }, [boardState.chunk.coord_x, boardState.chunk.coord_y, boardState.chunk.board_type, boardState.grid.height, boardState.grid.width, spawn?.x, spawn?.y]);

  const triggerInteraction = useCallback(
    async (action: "interact" | "destroy" | "open") => {
      if (isBusy) return;
      const nearest = findNearestInteractable(boardState, player);
      if (!nearest) {
        setInteractionHint("No nearby interactable");
        return;
      }

      if (action === "destroy" && nearest.critical_path) {
        setInteractionHint(`${nearest.name ?? nearest.id} is critical and cannot be destroyed`);
        return;
      }

      const normalizedAction = action === "interact" && nearest.kind === "loot" ? "open" : action;
      await onInteract({ entityId: nearest.id, entityKind: nearest.kind, action: normalizedAction });
      setInteractionHint(`${normalizedAction} → ${nearest.name ?? nearest.id}`);
    },
    [boardState, isBusy, onInteract, player],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "e", "r"].includes(key)) {
        event.preventDefault();
      }
      heldKeysRef.current.add(key);

      if (key === "e") {
        void triggerInteraction("interact");
      }
      if (key === "r") {
        void triggerInteraction("destroy");
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      heldKeysRef.current.delete(event.key.toLowerCase());
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [triggerInteraction]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = async (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      setPlayer((prev) => {
        let vx = 0;
        let vy = 0;

        if (boardState.chunk.board_type === "travel" && travelTarget) {
          const dx = travelTarget.x - prev.x;
          const dy = travelTarget.y - prev.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.05) {
            vx = dx / dist;
            vy = dy / dist;
          }
        } else {
          const keys = heldKeysRef.current;
          if (keys.has("a")) vx -= 1;
          if (keys.has("d")) vx += 1;
          if (keys.has("w")) vy -= 1;
          if (keys.has("s")) vy += 1;
        }

        if (vx === 0 && vy === 0) return prev;

        const len = Math.sqrt(vx * vx + vy * vy) || 1;
        const speedTiles = boardState.chunk.board_type === "travel" ? 2.9 : boardState.chunk.board_type === "dungeon" ? 3.4 : 3.6;
        const nx = prev.x + (vx / len) * speedTiles * dt;
        const ny = prev.y + (vy / len) * speedTiles * dt;

        const clampedX = clamp(nx, 0, boardState.grid.width - 1);
        const clampedY = clamp(ny, 0, boardState.grid.height - 1);
        const tx = Math.round(clampedX);
        const ty = Math.round(clampedY);

        if (isBlockingTile(boardState, tx, ty)) {
          return prev;
        }

        return { x: clampedX, y: clampedY };
      });

      const edgeThreshold = 0.2;
      const direction =
        player.x <= edgeThreshold
          ? "west"
          : player.x >= boardState.grid.width - 1 - edgeThreshold
            ? "east"
            : player.y <= edgeThreshold
              ? "north"
              : player.y >= boardState.grid.height - 1 - edgeThreshold
                ? "south"
                : null;

      if (direction && !steppingRef.current && !isBusy) {
        steppingRef.current = true;
        void onEdgeStep(direction).finally(() => {
          setTimeout(() => {
            steppingRef.current = false;
          }, 350);
        });
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [boardState, isBusy, onEdgeStep, player.x, player.y, travelTarget]);

  const handlePointerClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (boardState.chunk.board_type !== "travel") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xNorm = (event.clientX - rect.left) / rect.width;
    const yNorm = (event.clientY - rect.top) / rect.height;
    const tileX = clamp(Math.round(xNorm * (boardState.grid.width - 1)), 0, boardState.grid.width - 1);
    const tileY = clamp(Math.round(yNorm * (boardState.grid.height - 1)), 0, boardState.grid.height - 1);

    if (isBlockingTile(boardState, tileX, tileY)) {
      setInteractionHint("That tile is blocked");
      return;
    }

    setTravelTarget({ x: tileX, y: tileY });

    const nearest = Array.from(interactablesById.values())
      .filter((entity) => !boardState.runtime.destroyed_ids.includes(entity.id))
      .find((entity) => Math.abs(entity.x - tileX) <= 1 && Math.abs(entity.y - tileY) <= 1);

    if (nearest) {
      setInteractionHint(`Travel target: ${nearest.name ?? nearest.id}`);
    } else {
      setInteractionHint(`Travel target set (${tileX}, ${tileY})`);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          {boardState.chunk.board_type.toUpperCase()} · biome {boardState.chunk.biome} · chunk {boardState.chunk.coord_x},{boardState.chunk.coord_y}
        </div>
        <div>{interactionHint}</div>
      </div>

      <div className="relative aspect-[16/9] overflow-hidden rounded-md border border-border bg-background/80" onClick={handlePointerClick}>
        {boardState.chunk.board_type === "town" ? <TownScene boardState={boardState} player={player} /> : null}
        {boardState.chunk.board_type === "travel" ? <TravelScene boardState={boardState} player={player} /> : null}
        {boardState.chunk.board_type === "dungeon" ? <DungeonScene boardState={boardState} player={player} /> : null}
      </div>
    </div>
  );
}
