import { useMemo } from "react";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import { PixelBoardCanvas } from "@/ui/components/mythic/board/pixel/PixelBoardCanvas";
import { pixelPalette } from "@/ui/components/mythic/board/pixel/pixelPalette";
import {
  drawChest,
  drawHouse,
  drawHumanoid,
  drawOutlineRect,
  drawPixelRect,
  drawTrap,
  drawTree,
} from "@/ui/components/mythic/board/pixel/pixelSprites";

interface TravelBoardSceneProps {
  boardState: Record<string, unknown>;
  scene: Record<string, unknown> | null;
  onAction: (action: MythicUiAction) => void;
}

interface ThemeColors {
  sky: string;
  mid: string;
  ground: string;
  road: string;
  accent: string;
}

function readTemplate(boardState: Record<string, unknown>): string {
  const value = boardState.template_key;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return "custom";
}

function readTheme(template: string): ThemeColors {
  switch (template) {
    case "sci_fi_ruins":
      return {
        sky: "rgba(18,26,36,0.95)",
        mid: "rgba(30,46,52,0.92)",
        ground: "rgba(28,38,34,0.92)",
        road: "rgba(120,139,166,0.82)",
        accent: "rgba(106,200,232,0.85)",
      };
    case "post_apoc_warlands":
    case "post_apocalypse":
      return {
        sky: "rgba(46,24,14,0.95)",
        mid: "rgba(66,33,20,0.92)",
        ground: "rgba(54,30,17,0.92)",
        road: "rgba(133,97,64,0.82)",
        accent: "rgba(242,197,107,0.88)",
      };
    case "gothic_horror":
    case "dark_mythic_horror":
      return {
        sky: "rgba(23,18,31,0.95)",
        mid: "rgba(31,27,42,0.92)",
        ground: "rgba(25,28,34,0.92)",
        road: "rgba(104,96,120,0.82)",
        accent: "rgba(176,135,255,0.88)",
      };
    case "mythic_chaos":
      return {
        sky: "rgba(24,13,38,0.95)",
        mid: "rgba(18,38,53,0.92)",
        ground: "rgba(34,22,50,0.92)",
        road: "rgba(111,125,176,0.82)",
        accent: "rgba(232,236,255,0.9)",
      };
    case "graphic_novel_fantasy":
      return {
        sky: "rgba(18,26,31,0.95)",
        mid: "rgba(20,46,44,0.92)",
        ground: "rgba(26,38,34,0.92)",
        road: "rgba(133,120,86,0.82)",
        accent: "rgba(124,227,148,0.9)",
      };
    default:
      return {
        sky: "rgba(13,21,34,0.95)",
        mid: "rgba(18,40,41,0.92)",
        ground: "rgba(25,36,35,0.92)",
        road: "rgba(138,116,79,0.82)",
        accent: "rgba(106,200,232,0.9)",
      };
  }
}

function seededMarker(seed: number, idx: number, maxX: number, maxY: number) {
  const base = (seed + 7919 * (idx + 1)) % 9973;
  const x = 12 + (base % Math.max(1, maxX - 24));
  const y = 8 + (Math.floor(base / 89) % Math.max(1, maxY - 18));
  return { x, y };
}

function readSeed(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry : null))
    .filter((entry): entry is string => Boolean(entry));
}

export function TravelBoardScene(props: TravelBoardSceneProps) {
  const template = readTemplate(props.boardState);
  const theme = readTheme(template);
  const weather = typeof props.boardState.weather === "string" ? props.boardState.weather : "volatile";
  const hazard = Number(props.boardState.hazard_meter ?? 0);
  const searchTarget = typeof props.boardState.search_target === "string" ? props.boardState.search_target : null;
  const travelGoal = typeof props.boardState.travel_goal === "string" ? props.boardState.travel_goal : "explore_wilds";
  const encounterTriggered = Boolean(props.boardState.encounter_triggered);
  const treasureTriggered = Boolean(props.boardState.treasure_triggered);
  const dungeonTracesFound = Boolean(props.boardState.dungeon_traces_found);
  const worldTitle = typeof (props.boardState.world_seed as Record<string, unknown> | undefined)?.title === "string"
    ? String((props.boardState.world_seed as Record<string, unknown>).title)
    : null;
  const factionMarkers = toStringList(props.boardState.faction_markers);

  const title = typeof props.scene?.title === "string" ? props.scene.title : worldTitle
    ? `${worldTitle} Frontier`
    : "Overland Route";
  const mood = typeof props.scene?.mood === "string"
    ? props.scene.mood
    : `${travelGoal.replace(/_/g, " ")} through volatile terrain under ${weather} skies.`;

  const markers = useMemo(() => {
    const encounterSeeds = Array.isArray(props.boardState.encounter_seeds)
      ? props.boardState.encounter_seeds.map((seed) => Number(seed)).filter((seed) => Number.isFinite(seed))
      : [];
    return encounterSeeds.slice(0, 6).map((seed, idx) => seededMarker(seed, idx, 96, 72));
  }, [props.boardState.encounter_seeds]);

  const terrainBands = Array.isArray(props.boardState.terrain_bands)
    ? props.boardState.terrain_bands
        .map((entry) => (typeof entry === "string" ? entry : null))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const firstBand = terrainBands[0] ?? "wilds";
  const secondBand = terrainBands[1] ?? firstBand;
  const thirdBand = terrainBands[2] ?? secondBand;

  const baseSeed = readSeed(props.boardState.seed, 9191);

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-xl border border-cyan-200/20 bg-[linear-gradient(180deg,rgba(8,20,32,0.9),rgba(8,10,17,0.95))] p-3">
      <div className="mb-2">
        <div className="font-display text-xl text-cyan-100">{title}</div>
        <div className="text-xs text-cyan-100/75">{mood}</div>
      </div>

      <div className="relative h-[360px] overflow-hidden rounded-lg border border-cyan-200/25 bg-black/35">
        <PixelBoardCanvas
          width={96}
          height={72}
          className="cursor-pointer"
          onDraw={(ctx, frame) => {
            for (let y = 0; y < frame.height; y += 2) {
              for (let x = 0; x < frame.width; x += 2) {
                const rowPct = y / frame.height;
                const bandColor = rowPct < 0.3 ? theme.sky : rowPct < 0.62 ? theme.mid : theme.ground;
                const checker = (x + y) % 4 === 0;
                drawPixelRect(ctx, x, y, 2, 2, checker ? bandColor : "rgba(6,8,12,0.4)");
              }
            }

            const pathPoints = [
              { x: 6, y: 57 },
              { x: 14, y: 52 },
              { x: 24, y: 45 },
              { x: 34, y: 41 },
              { x: 47, y: 35 },
              { x: 62, y: 30 },
              { x: 76, y: 25 },
              { x: 90, y: 18 },
            ];
            for (let i = 0; i < pathPoints.length - 1; i += 1) {
              const a = pathPoints[i]!;
              const b = pathPoints[i + 1]!;
              const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
              for (let s = 0; s <= steps; s += 1) {
                const t = steps === 0 ? 0 : s / steps;
                const x = Math.floor(a.x + (b.x - a.x) * t);
                const y = Math.floor(a.y + (b.y - a.y) * t);
                drawPixelRect(ctx, x, y, 2, 2, theme.road);
              }
            }

            drawHouse(ctx, 3, 54, true);
            drawHouse(ctx, 18, 46, Math.sin(frame.t * 1.4) > 0);
            drawHouse(ctx, 50, 30, Math.cos(frame.t * 1.2) > 0);
            drawTree(ctx, 12, 16, Math.sin(frame.t));
            drawTree(ctx, 62, 12, Math.cos(frame.t * 1.3));
            drawTree(ctx, 72, 46, Math.sin(frame.t * 1.8));

            const partyPhase = (Math.sin(frame.t * 0.55) + 1) / 2;
            const idx = partyPhase * (pathPoints.length - 1);
            const from = pathPoints[Math.floor(idx)]!;
            const to = pathPoints[Math.min(pathPoints.length - 1, Math.ceil(idx))]!;
            const mix = idx - Math.floor(idx);
            const markerX = from.x + (to.x - from.x) * mix;
            const markerY = from.y + (to.y - from.y) * mix;
            drawHumanoid(ctx, markerX - 4, markerY - 4, pixelPalette.amber, Math.sin(frame.t * 8));
            drawHumanoid(ctx, markerX - 9, markerY - 2, pixelPalette.cyan, Math.cos(frame.t * 7));

            for (let i = 0; i < markers.length; i += 1) {
              const marker = markers[i]!;
              const pulse = 0.45 + 0.35 * Math.sin(frame.t * 4 + i);
              drawOutlineRect(
                ctx,
                marker.x - 3,
                marker.y - 3,
                8,
                8,
                `rgba(239,107,107,${pulse * 0.18})`,
                `rgba(239,107,107,${0.3 + pulse * 0.45})`,
              );
            }

            if (treasureTriggered) {
              drawChest(ctx, 70, 43, Math.sin(frame.t * 5));
              drawChest(ctx, 79, 35, Math.cos(frame.t * 5));
            }
            if (encounterTriggered) {
              drawTrap(ctx, 35, 50, Math.sin(frame.t * 5));
              drawTrap(ctx, 57, 24, Math.cos(frame.t * 5));
            }

            const hasDungeonSearch = searchTarget === "dungeon";
            if (hasDungeonSearch) {
              const caveX = 86;
              const caveY = 10;
              drawOutlineRect(
                ctx,
                caveX - 4,
                caveY - 3,
                10,
                8,
                dungeonTracesFound ? "rgba(176,135,255,0.3)" : "rgba(83,93,120,0.25)",
                dungeonTracesFound ? "rgba(242,197,107,0.9)" : "rgba(176,135,255,0.45)",
              );
              drawPixelRect(ctx, caveX, caveY + 1, 2, 2, "rgba(8,8,14,0.88)");
            }

            for (let i = 0; i < factionMarkers.length; i += 1) {
              const marker = seededMarker(baseSeed + 101, i, 96, 72);
              drawPixelRect(ctx, marker.x, marker.y, 1, 1, theme.accent);
            }

            if (/storm|mana_storm|electro_storm|thunder/.test(weather)) {
              for (let i = 0; i < 6; i += 1) {
                const x = Math.floor((i * 17 + frame.t * 35) % frame.width);
                drawPixelRect(ctx, x, 0, 1, frame.height, "rgba(106,200,232,0.35)");
              }
            } else if (/rain|drizzle|acid_rain|funeral_rain/.test(weather)) {
              for (let i = 0; i < 40; i += 1) {
                const x = (i * 19 + frame.t * 22) % frame.width;
                const y = (i * 13 + frame.t * 30) % frame.height;
                drawPixelRect(ctx, x, y, 1, 3, "rgba(170,198,255,0.25)");
              }
            } else if (/dust|ash|smog/.test(weather)) {
              for (let i = 0; i < 12; i += 1) {
                const x = (i * 23 + frame.t * 8) % frame.width;
                drawPixelRect(ctx, x, 14 + (i % 4) * 12, 6, 1, "rgba(194,166,121,0.3)");
              }
            } else if (/fog|mist/.test(weather)) {
              drawPixelRect(ctx, 0, 0, frame.width, frame.height, "rgba(215,227,255,0.08)");
            }
          }}
          onClickPixel={(x, y) => {
            if (x <= 14 && y >= 50) {
              props.onAction({ id: "travel-town", label: "Head to Town", intent: "town", boardTarget: "town" });
              return;
            }

            if (searchTarget === "dungeon" && x >= 80 && y <= 18) {
              if (dungeonTracesFound) {
                props.onAction({ id: "travel-enter-dungeon", label: "Enter Dungeon", intent: "dungeon", boardTarget: "dungeon" });
              } else {
                props.onAction({
                  id: "travel-search-dungeon",
                  label: "Search Dungeon Route",
                  intent: "dm_prompt",
                  prompt: "I sweep this route for cave mouths, ruin doors, and signs of dungeon access.",
                  payload: { travel_probe: "search", search_target: "dungeon", tile_x: x, tile_y: y },
                });
              }
              return;
            }

            props.onAction({
              id: "travel-scout",
              label: "Scout Route",
              intent: "dm_prompt",
              prompt: "I scout the route ahead, checking hazards, encounters, and hidden opportunities.",
              payload: { travel_probe: "scout", tile_x: x, tile_y: y },
            });
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(106,200,232,0.16),transparent_45%),radial-gradient(circle_at_85%_90%,rgba(176,135,255,0.15),transparent_40%)]" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-cyan-100/75 sm:grid-cols-4">
        <div className="rounded border border-cyan-200/25 bg-cyan-100/10 px-2 py-1">Template: {template}</div>
        <div className="rounded border border-cyan-200/25 bg-cyan-100/10 px-2 py-1">Weather: {weather}</div>
        <div className="rounded border border-cyan-200/25 bg-cyan-100/10 px-2 py-1">Hazard: {Number.isFinite(hazard) ? hazard : 0}</div>
        <div className="rounded border border-cyan-200/25 bg-cyan-100/10 px-2 py-1">
          {firstBand} / {secondBand} / {thirdBand}
        </div>
      </div>
    </div>
  );
}
