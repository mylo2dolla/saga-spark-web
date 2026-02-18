import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MythicCombatantRow, MythicActionEventRow, MythicCombatSessionRow } from "@/hooks/useMythicCombatState";
import { PixelBoardCanvas } from "@/ui/components/mythic/board/pixel/PixelBoardCanvas";
import { pixelPalette } from "@/ui/components/mythic/board/pixel/pixelPalette";
import { drawDamageText, drawOutlineRect, drawPixelRect } from "@/ui/components/mythic/board/pixel/pixelSprites";

type Target =
  | { kind: "self" }
  | { kind: "combatant"; combatant_id: string }
  | { kind: "tile"; x: number; y: number };

export interface CombatBoardSkillLite {
  id: string;
  kind: string;
  name: string;
  description: string;
  targeting: string;
  range_tiles: number;
  cooldown_turns: number;
}

interface CombatBoardSceneProps {
  combatSession: MythicCombatSessionRow | null;
  combatants: MythicCombatantRow[];
  events: MythicActionEventRow[];
  activeTurnCombatantId: string | null;
  playerCombatantId: string | null;
  skills: CombatBoardSkillLite[];
  isActing: boolean;
  isTicking: boolean;
  canTick: boolean;
  bossPhaseLabel: string | null;
  onTickTurn: () => Promise<void>;
  onUseSkill: (args: { actorCombatantId: string; skillId: string; target: Target }) => Promise<void>;
  onFocusCombatant?: (combatantId: string | null) => void;
}

interface TokenNode {
  combatant: MythicCombatantRow;
  tileX: number;
  tileY: number;
}

function pct(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0, Math.min(1, n / d));
}

function findEventTargetId(event: MythicActionEventRow): string | null {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  const keys = ["target_combatant_id", "target_id", "defender_combatant_id", "receiver_combatant_id"];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function findEventNumber(event: MythicActionEventRow): number | null {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  const keys = ["damage_to_hp", "amount", "healing_to_hp", "value"];
  for (const key of keys) {
    const value = Number(payload[key]);
    if (Number.isFinite(value) && value !== 0) return value;
  }
  return null;
}

export function CombatBoardScene(props: CombatBoardSceneProps) {
  const [focusedCombatantId, setFocusedCombatantId] = useState<string | null>(null);

  const grid = useMemo(() => {
    const maxX = Math.max(10, ...props.combatants.map((entry) => Number(entry.x)));
    const maxY = Math.max(8, ...props.combatants.map((entry) => Number(entry.y)));
    return {
      w: Math.min(16, Math.max(10, maxX + 2)),
      h: Math.min(12, Math.max(8, maxY + 2)),
    };
  }, [props.combatants]);

  const tokens = useMemo<TokenNode[]>(() => {
    return props.combatants.map((combatant) => ({
      combatant,
      tileX: Math.max(0, Math.min(grid.w - 1, Math.floor(combatant.x))),
      tileY: Math.max(0, Math.min(grid.h - 1, Math.floor(combatant.y))),
    }));
  }, [grid.h, grid.w, props.combatants]);

  const focusedCombatant = useMemo(
    () => (focusedCombatantId ? props.combatants.find((entry) => entry.id === focusedCombatantId) ?? null : null),
    [focusedCombatantId, props.combatants],
  );

  const recentEventTexts = useMemo(() => {
    return props.events.slice(-6).map((event) => {
      const value = findEventNumber(event);
      const prefix = event.event_type.split("_").join(" ");
      return value !== null ? `${prefix}: ${Math.floor(value)}` : prefix;
    });
  }, [props.events]);

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-xl border border-red-200/20 bg-[linear-gradient(180deg,rgba(20,8,10,0.95),rgba(9,8,14,0.98))] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="font-display text-xl text-red-100">Combat Arena</div>
          <div className="text-xs text-red-100/75">
            Turn: {props.combatants.find((entry) => entry.id === props.activeTurnCombatantId)?.name ?? "Unknown"}
          </div>
        </div>
        {props.bossPhaseLabel ? (
          <div className="rounded border border-red-200/35 bg-red-500/20 px-2 py-1 text-[11px] text-red-100">
            {props.bossPhaseLabel}
          </div>
        ) : null}
      </div>

      <div className="relative h-[360px] overflow-hidden rounded-lg border border-red-200/25 bg-black/35">
        <PixelBoardCanvas
          width={grid.w * 10}
          height={grid.h * 10}
          className="cursor-crosshair"
          onDraw={(ctx, frame) => {
            for (let y = 0; y < grid.h; y += 1) {
              for (let x = 0; x < grid.w; x += 1) {
                const checker = (x + y) % 2 === 0;
                drawPixelRect(
                  ctx,
                  x * 10,
                  y * 10,
                  10,
                  10,
                  checker ? "rgba(63,20,20,0.55)" : "rgba(47,16,18,0.55)",
                );
                drawOutlineRect(ctx, x * 10, y * 10, 10, 10, "rgba(0,0,0,0)", "rgba(239,107,107,0.08)");
              }
            }

            for (const token of tokens) {
              const x = token.tileX * 10 + 1;
              const y = token.tileY * 10 + 1;
              const isFocused = focusedCombatantId === token.combatant.id;
              const isActive = props.activeTurnCombatantId === token.combatant.id;
              const hp = pct(token.combatant.hp, token.combatant.hp_max);
              const bodyColor = token.combatant.entity_type === "player"
                ? pixelPalette.green
                : token.combatant.entity_type === "npc"
                  ? pixelPalette.red
                  : pixelPalette.cyan;

              drawOutlineRect(
                ctx,
                x,
                y,
                8,
                8,
                "rgba(10,13,20,0.55)",
                isFocused ? "rgba(242,197,107,0.95)" : isActive ? "rgba(232,236,255,0.95)" : "rgba(232,236,255,0.35)",
              );
              drawPixelRect(ctx, x + 2, y + 2, 4, 4, bodyColor);
              drawPixelRect(ctx, x + 1, y + 7, Math.max(1, Math.floor(6 * hp)), 1, pixelPalette.amber);

              const statuses = Array.isArray(token.combatant.statuses) ? token.combatant.statuses : [];
              if (statuses.length > 0) {
                const pulse = 0.4 + 0.3 * (1 + Math.sin(frame.t * 6 + token.tileX));
                drawPixelRect(ctx, x + 7, y, 1, 1, `rgba(176,135,255,${pulse})`);
                drawPixelRect(ctx, x, y, 1, 1, `rgba(106,200,232,${pulse})`);
              }
            }

            const recentEvents = props.events.slice(-8);
            for (let i = 0; i < recentEvents.length; i += 1) {
              const event = recentEvents[i]!;
              const targetId = findEventTargetId(event) ?? event.actor_combatant_id;
              if (!targetId) continue;
              const target = tokens.find((token) => token.combatant.id === targetId);
              if (!target) continue;
              const value = findEventNumber(event);
              if (value === null) continue;
              const bob = ((frame.t * 28 + i * 4) % 14);
              drawDamageText(
                ctx,
                `${Math.floor(value)}`,
                target.tileX * 10 + 1,
                target.tileY * 10 - bob,
                value > 0 ? pixelPalette.red : pixelPalette.green,
              );
            }
          }}
          onClickPixel={(x, y) => {
            const tileX = Math.floor(x / 10);
            const tileY = Math.floor(y / 10);
            const hit = tokens.find((token) => token.tileX === tileX && token.tileY === tileY) ?? null;
            const next = hit?.combatant.id ?? null;
            setFocusedCombatantId(next);
            props.onFocusCombatant?.(next);
          }}
        />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] text-red-100/78 md:grid-cols-3">
        <div className="rounded border border-red-200/20 bg-red-100/10 px-2 py-1">
          Focused target:{" "}
          <span className="text-red-50">
            {focusedCombatant?.name ?? "none"}
          </span>
        </div>
        <div className="rounded border border-red-200/20 bg-red-100/10 px-2 py-1">
          Actions are chat-driven. Example: <code>/skill fireball @{focusedCombatant?.name ?? "target"}</code>
        </div>
        <div className="rounded border border-red-200/20 bg-red-100/10 px-2 py-1">
          Recent: {recentEventTexts[recentEventTexts.length - 1] ?? "no events"}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void props.onTickTurn()} disabled={!props.canTick || props.isTicking}>
          {props.isTicking ? "Advancing..." : "Advance Enemy Turn"}
        </Button>
      </div>
    </div>
  );
}
