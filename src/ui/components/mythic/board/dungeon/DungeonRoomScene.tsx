import { useMemo } from "react";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import type { BoardInspectTarget } from "@/ui/components/mythic/board/inspectTypes";
import { PixelBoardCanvas } from "@/ui/components/mythic/board/pixel/PixelBoardCanvas";
import { pixelPalette } from "@/ui/components/mythic/board/pixel/pixelPalette";
import { drawChest, drawOutlineRect, drawPixelRect, drawTrap } from "@/ui/components/mythic/board/pixel/pixelSprites";
import type { DungeonRoomLite } from "@/ui/components/mythic/board/dungeon/dungeonLayout";

type DoorDir = "n" | "s" | "e" | "w";

type NeighborDoor = {
  toRoomId: string;
  toRoomName: string;
  dir: DoorDir;
};

type Hotspot = {
  id: string;
  kind: BoardInspectTarget["kind"];
  title: string;
  subtitle?: string;
  rect: { x: number; y: number; w: number; h: number };
  actions: MythicUiAction[];
  meta?: Record<string, unknown>;
};

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function hasTag(room: DungeonRoomLite, key: string): boolean {
  return room.tags.some((tag) => String(tag).toLowerCase() === key);
}

function doorRect(dir: DoorDir): { x: number; y: number; w: number; h: number } {
  switch (dir) {
    case "n":
      return { x: 44, y: 6, w: 8, h: 6 };
    case "s":
      return { x: 44, y: 58, w: 8, h: 6 };
    case "w":
      return { x: 6, y: 32, w: 6, h: 8 };
    case "e":
    default:
      return { x: 84, y: 32, w: 6, h: 8 };
  }
}

export function DungeonRoomScene(props: {
  room: DungeonRoomLite;
  neighbors: NeighborDoor[];
  seed: number;
  revealed: Set<string>;
  scene: Record<string, unknown> | null;
  onInspect: (target: BoardInspectTarget) => void;
}) {
  const title = typeof props.scene?.title === "string" ? props.scene.title : props.room.name;
  const mood = typeof props.scene?.mood === "string" ? props.scene.mood : "Cold stone, old dust, and pressure in the dark.";

  const hotspots = useMemo<Hotspot[]>(() => {
    const next: Hotspot[] = [];
    const roomId = props.room.id;

    // Doors to neighbors.
    for (const neighbor of props.neighbors) {
      const rect = doorRect(neighbor.dir);
      next.push({
        id: `door:${roomId}:${neighbor.toRoomId}`,
        kind: "door",
        title: `Doorway: ${neighbor.toRoomName}`,
        subtitle: "Airflow, echoes, and a choice you can’t unmake.",
        rect,
        actions: [
          {
            id: `door-proceed:${roomId}:${neighbor.toRoomId}`,
            label: `Proceed to ${neighbor.toRoomName}`,
            intent: "dm_prompt",
            prompt: `I move through the doorway toward ${neighbor.toRoomName}, clearing angles and listening for movement.`,
            payload: { room_id: roomId, to_room_id: neighbor.toRoomId, action: "proceed" },
          },
          {
            id: `door-scout:${roomId}:${neighbor.toRoomId}`,
            label: "Scout The Threshold",
            intent: "dm_prompt",
            prompt: `I scout the doorway toward ${neighbor.toRoomName} for traps, watchers, and sound cues before committing.`,
            payload: { room_id: roomId, to_room_id: neighbor.toRoomId, action: "scout" },
          },
        ],
      });
    }

    // Room objects (visual + inspect actions).
    if (hasTag(props.room, "trap")) {
      next.push({
        id: `trap:${roomId}`,
        kind: "trap",
        title: "Trap Signatures",
        subtitle: "Pressure seams, hairline trip lines, and hidden trigger geometry.",
        rect: { x: 40, y: 32, w: 16, h: 12 },
        actions: [
          {
            id: `trap-scan:${roomId}`,
            label: "Scan Traps",
            intent: "dm_prompt",
            prompt: "I scan the room for trap signatures and map safe traversal vectors.",
            payload: { room_id: roomId, action: "scan_traps" },
          },
          {
            id: `trap-disarm:${roomId}`,
            label: "Disarm Carefully",
            intent: "dm_prompt",
            prompt: "I attempt a careful disarm, probing for secondary triggers and concealed redundancies.",
            payload: { room_id: roomId, action: "disarm_traps" },
          },
        ],
        meta: { room_id: roomId, tags: props.room.tags, danger: props.room.danger ?? null },
      });
    }

    if (hasTag(props.room, "cache") || hasTag(props.room, "vault")) {
      next.push({
        id: `chest:${roomId}`,
        kind: "chest",
        title: hasTag(props.room, "vault") ? "Vault Cache" : "Cache",
        subtitle: "Metal-latched wood and the promise of bad luck.",
        rect: { x: 68, y: 40, w: 18, h: 16 },
        actions: [
          {
            id: `chest-inspect:${roomId}`,
            label: "Inspect For Traps",
            intent: "dm_prompt",
            prompt: "I inspect the cache for traps, poison needles, and false latches.",
            payload: { room_id: roomId, action: "inspect_cache" },
          },
          {
            id: `chest-loot:${roomId}`,
            label: "Open & Loot",
            intent: "dm_prompt",
            prompt: "I open the cache carefully and secure anything valuable, checking for cursed markers or trackers.",
            payload: { room_id: roomId, action: "loot_cache" },
          },
        ],
        meta: { room_id: roomId, tags: props.room.tags, danger: props.room.danger ?? null },
      });
    }

    if (hasTag(props.room, "altar")) {
      next.push({
        id: `altar:${roomId}`,
        kind: "altar",
        title: "Altar / Focus Stone",
        subtitle: "Something here wants attention. That’s never free.",
        rect: { x: 16, y: 22, w: 18, h: 16 },
        actions: [
          {
            id: `altar-investigate:${roomId}`,
            label: "Investigate",
            intent: "dm_prompt",
            prompt: "I investigate the altar for mechanisms, inscriptions, and hidden costs.",
            payload: { room_id: roomId, action: "investigate_altar" },
          },
        ],
        meta: { room_id: roomId, tags: props.room.tags, danger: props.room.danger ?? null },
      });
    }

    if (hasTag(props.room, "puzzle")) {
      next.push({
        id: `puzzle:${roomId}`,
        kind: "puzzle",
        title: "Puzzle Mechanism",
        subtitle: "A logic lock pretending to be architecture.",
        rect: { x: 18, y: 44, w: 18, h: 14 },
        actions: [
          {
            id: `puzzle-study:${roomId}`,
            label: "Study Mechanism",
            intent: "dm_prompt",
            prompt: "I study the puzzle mechanism for patterns, tells, and a brute-force bypass if needed.",
            payload: { room_id: roomId, action: "study_puzzle" },
          },
        ],
        meta: { room_id: roomId, tags: props.room.tags, danger: props.room.danger ?? null },
      });
    }

    // Always allow room-level assessment.
    next.push({
      id: `room:${roomId}`,
      kind: "room",
      title: props.room.name,
      subtitle: "The room breathes through cracks you can’t see yet.",
      rect: { x: 14, y: 14, w: 68, h: 48 },
      actions: [
        {
          id: `room-assess:${roomId}`,
          label: "Assess The Room",
          intent: "dm_prompt",
          prompt: `I assess ${props.room.name}, checking angles, exits, and any immediate threats.`,
          payload: { room_id: roomId, action: "assess_room" },
        },
        {
          id: `room-search:${roomId}`,
          label: "Search For Loot",
          intent: "dm_prompt",
          prompt: `I search ${props.room.name} for hidden compartments, caches, and anything useful.`,
          payload: { room_id: roomId, action: "search_room" },
        },
        {
          id: `room-fallback:${roomId}`,
          label: "Fall Back To Town",
          intent: "town",
          boardTarget: "town",
        },
      ],
      meta: { room_id: roomId, tags: props.room.tags, danger: props.room.danger ?? null, neighbors: props.neighbors.length },
    });

    return next;
  }, [props.neighbors, props.room]);

  const fogPulseAlpha = useMemo(() => {
    const base = hasTag(props.room, "lair") ? 0.26 : 0.18;
    return clampInt(base * 100, 10, 40) / 100;
  }, [props.room]);

  return (
    <div className="relative h-[360px] overflow-hidden rounded-lg border border-violet-200/25 bg-black/35">
      <div className="pointer-events-none absolute left-3 top-2 z-10">
        <div className="font-display text-lg text-violet-100">{title}</div>
        <div className="text-[11px] text-violet-100/75">{mood}</div>
      </div>

      <PixelBoardCanvas
        width={96}
        height={72}
        className="cursor-pointer"
        onDraw={(ctx, frame) => {
          // Stone floor.
          for (let y = 0; y < frame.height; y += 2) {
            for (let x = 0; x < frame.width; x += 2) {
              const checker = ((x + y) % 4) === 0;
              drawPixelRect(ctx, x, y, 2, 2, checker ? pixelPalette.stoneA : pixelPalette.stoneB);
            }
          }

          // Walls.
          drawPixelRect(ctx, 0, 0, 96, 6, "rgba(8,8,14,0.8)");
          drawPixelRect(ctx, 0, 66, 96, 6, "rgba(8,8,14,0.8)");
          drawPixelRect(ctx, 0, 0, 6, 72, "rgba(8,8,14,0.8)");
          drawPixelRect(ctx, 90, 0, 6, 72, "rgba(8,8,14,0.8)");

          // Doorways (carve openings).
          for (const neighbor of props.neighbors) {
            const rect = doorRect(neighbor.dir);
            drawOutlineRect(ctx, rect.x, rect.y, rect.w, rect.h, "rgba(14,14,20,0.85)", "rgba(176,135,255,0.55)");
            drawPixelRect(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, "rgba(8,8,14,0.9)");
          }

          // Torches (ambient flicker).
          const flicker = 0.55 + 0.35 * (1 + Math.sin(frame.t * 6));
          drawPixelRect(ctx, 10, 10, 2, 2, `rgba(242,197,107,${flicker})`);
          drawPixelRect(ctx, 84, 10, 2, 2, `rgba(242,197,107,${flicker * 0.9})`);

          // Room objects.
          if (hasTag(props.room, "trap")) {
            drawTrap(ctx, 44, 36, Math.sin(frame.t * 4));
          }
          if (hasTag(props.room, "cache") || hasTag(props.room, "vault")) {
            drawChest(ctx, 72, 42, Math.sin(frame.t * 5));
          }
          if (hasTag(props.room, "altar")) {
            drawOutlineRect(ctx, 18, 26, 14, 10, "rgba(176,135,255,0.18)", "rgba(242,197,107,0.55)");
            drawPixelRect(ctx, 22, 30, 6, 4, "rgba(242,197,107,0.45)");
          }
          if (hasTag(props.room, "puzzle")) {
            drawOutlineRect(ctx, 20, 46, 14, 10, "rgba(106,200,232,0.16)", "rgba(106,200,232,0.55)");
            drawPixelRect(ctx, 24, 50, 6, 4, "rgba(106,200,232,0.35)");
          }
          if (hasTag(props.room, "lair")) {
            drawPixelRect(ctx, 34, 40, 28, 14, "rgba(239,107,107,0.12)");
          }

          // Soft fog pulse.
          const fogPulse = fogPulseAlpha + 0.08 * (1 + Math.sin(frame.t * 1.7));
          drawPixelRect(ctx, 0, 0, frame.width, frame.height, `rgba(178,154,232,${fogPulse})`);

          // Hotspot outlines (subtle).
          for (const hotspot of hotspots) {
            if (hotspot.kind === "room") continue;
            const pulse = 0.22 + 0.18 * (1 + Math.sin(frame.t * 3 + hotspot.rect.x * 0.1));
            drawOutlineRect(
              ctx,
              hotspot.rect.x,
              hotspot.rect.y,
              hotspot.rect.w,
              hotspot.rect.h,
              `rgba(242,197,107,${pulse * 0.08})`,
              `rgba(242,197,107,${0.12 + pulse * 0.25})`,
            );
          }
        }}
        onClickPixel={(x, y) => {
          const hit = hotspots.find((h) => x >= h.rect.x && x <= h.rect.x + h.rect.w && y >= h.rect.y && y <= h.rect.y + h.rect.h) ?? null;
          const chosen = hit ?? hotspots.find((h) => h.kind === "room") ?? null;
          if (!chosen) return;
          props.onInspect({
            kind: chosen.kind,
            id: chosen.id,
            title: chosen.title,
            subtitle: chosen.subtitle,
            actions: chosen.actions,
            meta: chosen.meta,
            rect: chosen.rect,
          });
        }}
      />
    </div>
  );
}

