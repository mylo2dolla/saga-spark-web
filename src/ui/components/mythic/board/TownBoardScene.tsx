import { useMemo } from "react";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import type { BoardInspectTarget } from "@/ui/components/mythic/board/inspectTypes";
import { PixelBoardCanvas } from "@/ui/components/mythic/board/pixel/PixelBoardCanvas";
import { pixelPalette } from "@/ui/components/mythic/board/pixel/pixelPalette";
import { drawHouse, drawHumanoid, drawOutlineRect, drawPixelRect, drawTree } from "@/ui/components/mythic/board/pixel/pixelSprites";
import type { MythicBoardState } from "@/types/mythic";

interface TownBoardSceneProps {
  boardState: MythicBoardState;
  scene: Record<string, unknown> | null;
  onInspect: (target: BoardInspectTarget) => void;
}

interface TownHotspot {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  target: BoardInspectTarget;
}

function extractNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const raw = entry as Record<string, unknown>;
        if (typeof raw.name === "string") return raw.name;
        if (typeof raw.title === "string") return raw.title;
        if (typeof raw.label === "string") return raw.label;
        if (typeof raw.detail === "string") return raw.detail;
        if (typeof raw.description === "string") return raw.description;
        if (typeof raw.line === "string") return raw.line;
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

type VendorRow = { id: string; name: string; services: string[] };

function extractVendors(list: unknown): VendorRow[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : `vendor_${index + 1}`;
      const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : `Vendor ${index + 1}`;
      const services = Array.isArray(raw.services)
        ? raw.services
          .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
          .filter((s) => s.length > 0)
        : [];
      return { id, name, services };
    })
    .filter((v): v is VendorRow => Boolean(v));
}

function vendorRoleLabel(services: string[]): string {
  const s = new Set(services);
  if (s.has("repair") || s.has("craft")) return "Blacksmith";
  if (s.has("potions") || s.has("bombs")) return "Alchemist";
  if (s.has("trade") || s.has("bank")) return "Trader";
  if (s.has("heal")) return "Healer";
  if (s.has("enchant")) return "Enchanter";
  return "Merchant";
}

export function TownBoardScene(props: TownBoardSceneProps) {
  const vendorRows = extractVendors(props.boardState.vendors);
  const vendors = vendorRows.map((v) => v.name);
  const services = extractNames(props.boardState.services);
  const rumors = extractNames(props.boardState.rumors);
  const factions = extractNames(props.boardState.factions_present);

  const sceneTitle = typeof props.scene?.title === "string" ? props.scene.title : "Town Square";
  const sceneMood = typeof props.scene?.mood === "string" ? props.scene.mood : "Markets, whispers, and sharpened bargains.";

  const hotspots = useMemo<TownHotspot[]>(() => {
    const next: TownHotspot[] = [];

    const vendorSpots = [
      { x: 8, y: 12, w: 16, h: 10 },
      { x: 30, y: 10, w: 16, h: 10 },
      { x: 54, y: 13, w: 16, h: 10 },
    ];

    vendorRows.slice(0, vendorSpots.length).forEach((vendor, idx) => {
      const spot = vendorSpots[idx]!;
      const role = vendorRoleLabel(vendor.services);
      next.push({
        id: `vendor:${vendor.id}`,
        label: vendor.name,
        ...spot,
        target: {
          kind: "vendor",
          id: vendor.id,
          title: vendor.name,
          subtitle: role,
          vendorId: vendor.id,
          actions: [
            {
              id: `vendor-talk:${vendor.id}`,
              label: `Talk to ${role}`,
              intent: "dm_prompt",
              prompt: `I approach ${vendor.name} (${role}) and ask what they have available, and what trouble they’ve heard about lately.`,
            },
            {
              id: `vendor-shop:${vendor.id}`,
              label: "Shop",
              intent: "shop",
              payload: { vendorId: vendor.id },
            },
          ],
        },
      });
    });

    if (services.map((s) => s.toLowerCase()).includes("notice_board")) {
      next.push({
        id: "notice_board",
        label: "Notice Board",
        x: 24,
        y: 30,
        w: 16,
        h: 10,
        target: {
          kind: "notice_board",
          id: "notice_board",
          title: "Notice Board",
          subtitle: "Jobs, bounties, and rumors pinned with rusty nails.",
          actions: [
            {
              id: "notice-board-read",
              label: "Read Postings",
              intent: "dm_prompt",
              prompt: "I read the notice board carefully, looking for contracts, bounties, and anything that smells like a trap.",
              payload: {
                board_feature: "notice_board",
                job_action: "browse",
              },
            },
            {
              id: "notice-board-quests",
              label: "Open Quests",
              intent: "open_panel",
              panel: "quests",
            },
          ],
        },
      });
    }

    next.push({
      id: "gate",
      label: "Gate",
      x: 72,
      y: 26,
      w: 14,
      h: 12,
      target: {
        kind: "gate",
        id: "gate",
        title: "Town Gate",
        subtitle: "Roads out. Trouble in. Opportunity everywhere.",
        actions: [
          {
            id: "town-depart",
            label: "Depart",
            intent: "travel",
            boardTarget: "travel",
          },
        ],
      },
    });

    return next;
  }, [services, vendorRows]);

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-xl border border-amber-200/20 bg-[linear-gradient(180deg,rgba(21,14,8,0.9),rgba(10,11,16,0.96))] p-3">
      <div className="mb-2">
        <div className="font-display text-xl text-amber-100">{sceneTitle}</div>
        <div className="text-xs text-amber-100/75">{sceneMood}</div>
      </div>

      <div className="relative h-[360px] overflow-hidden rounded-lg border border-amber-200/25 bg-black/30">
        <PixelBoardCanvas
          width={96}
          height={72}
          className="cursor-pointer"
          onDraw={(ctx, frame) => {
            for (let y = 0; y < frame.height; y += 2) {
              for (let x = 0; x < frame.width; x += 2) {
                const checker = ((x / 2 + y / 2) % 2) === 0;
                drawPixelRect(ctx, x, y, 2, 2, checker ? pixelPalette.grassA : pixelPalette.grassB);
              }
            }

            drawPixelRect(ctx, 0, 32, 96, 4, pixelPalette.road);
            drawPixelRect(ctx, 44, 0, 4, 72, pixelPalette.road);

            drawHouse(ctx, 10, 13, true);
            drawHouse(ctx, 32, 11, true);
            drawHouse(ctx, 56, 14, frame.t % 2 > 1);
            drawHouse(ctx, 26, 31, true);
            drawHouse(ctx, 74, 28, true);

            drawTree(ctx, 4, 6, Math.sin(frame.t * 2));
            drawTree(ctx, 82, 8, Math.cos(frame.t * 2));
            drawTree(ctx, 8, 48, Math.sin(frame.t * 2.7));
            drawTree(ctx, 84, 50, Math.cos(frame.t * 2.4));

            const npcOffsets = [
              { x: 18 + Math.sin(frame.t * 1.4) * 3, y: 34 + Math.cos(frame.t * 1.2) * 2, tone: pixelPalette.cyan },
              { x: 39 + Math.cos(frame.t * 1.1) * 2, y: 26 + Math.sin(frame.t * 1.5) * 2, tone: pixelPalette.green },
              { x: 61 + Math.sin(frame.t * 1.8) * 2, y: 35 + Math.cos(frame.t * 1.7) * 2, tone: pixelPalette.amber },
            ];
            for (const npc of npcOffsets) {
              drawHumanoid(ctx, npc.x, npc.y, npc.tone, Math.sin(frame.t * 4));
            }

            for (const hotspot of hotspots) {
              const pulse = 0.35 + 0.25 * (1 + Math.sin(frame.t * 3 + hotspot.x * 0.1));
              drawOutlineRect(
                ctx,
                hotspot.x,
                hotspot.y,
                hotspot.w,
                hotspot.h,
                `rgba(242,197,107,${pulse * 0.15})`,
                `rgba(242,197,107,${0.2 + pulse * 0.35})`,
              );
            }
          }}
          onClickPixel={(x, y) => {
            const hit = hotspots.find((spot) => x >= spot.x && x <= spot.x + spot.w && y >= spot.y && y <= spot.y + spot.h);
            if (hit) {
              props.onInspect({
                ...hit.target,
                interaction: { source: "hotspot", x, y },
              });
              return;
            }
            props.onInspect({
              kind: "hotspot",
              id: `town-miss-${Math.floor(x / 4)}-${Math.floor(y / 4)}`,
              title: "Town Streetline",
              subtitle: "Crowd pressure, market noise, and a chance to pull a thread.",
              actions: [
                {
                  id: `town-miss-probe-${Math.floor(x / 4)}-${Math.floor(y / 4)}`,
                  label: "Probe This Corner",
                  intent: "dm_prompt",
                  prompt: `I inspect this section of town at tile (${x}, ${y}), reading crowd movement, rumor vectors, and immediate opportunity.`,
                  payload: {
                    tile_x: x,
                    tile_y: y,
                    board_type: "town",
                    interaction_source: "miss_click",
                    vendor_count: vendorRows.length,
                    service_count: services.length,
                    rumor_count: rumors.length,
                    faction_count: factions.length,
                  },
                },
              ],
              meta: {
                tile_x: x,
                tile_y: y,
                vendors: vendorRows.length,
                services: services.length,
                rumors: rumors.length,
                factions: factions.length,
              },
              interaction: { source: "miss_click", x, y },
              autoRunPrimaryAction: true,
            });
          }}
        />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,213,120,0.15),transparent_48%),radial-gradient(circle_at_80%_80%,rgba(255,120,80,0.12),transparent_40%)]" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-amber-100/75 sm:grid-cols-4">
        <div className="rounded border border-amber-200/20 bg-amber-100/10 px-2 py-1">Vendors: {vendors.length}</div>
        <div className="rounded border border-amber-200/20 bg-amber-100/10 px-2 py-1">Services: {services.length}</div>
        <div className="rounded border border-amber-200/20 bg-amber-100/10 px-2 py-1">Rumors: {rumors.length}</div>
        <div className="rounded border border-amber-200/20 bg-amber-100/10 px-2 py-1">Factions: {factions.length}</div>
      </div>
    </div>
  );
}
