import { useEffect, useMemo, useRef } from "react";
import type { MythicActionEventRow, MythicCombatantRow } from "@/hooks/useMythicCombatState";
import type { MythicBoardType, MythicSkill } from "@/types/mythic";
import { fxFromEvent, type CombatFx } from "@/components/mythic/combat/combatFx";
import { distanceTiles, hasLineOfSight, type Metric } from "@/components/mythic/combat/combatMath";
import { drawCombatantSprite, drawObstacle, type SpriteTheme } from "@/components/mythic/combat/combatSprites";

export type CombatFocus =
  | { kind: "combatant"; combatantId: string }
  | { kind: "tile"; x: number; y: number }
  | null;

export function PixelCombatBoard(props: {
  grid: { width: number; height: number };
  blockedTiles: Array<{ x: number; y: number }>;
  combatants: MythicCombatantRow[];
  events: MythicActionEventRow[];
  activeTurnCombatantId: string | null;
  playerCombatantId: string | null;
  focus: CombatFocus;
  hoveredSkill: MythicSkill | null;
  startedFrom: MythicBoardType | null;
  onSelectCombatant: (combatantId: string) => void;
  onSelectTile: (x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxRef = useRef<CombatFx[]>([]);
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  const theme: SpriteTheme = useMemo(() => {
    if (props.startedFrom === "dungeon") return "dungeon";
    if (props.startedFrom === "travel") return "travel";
    return "town";
  }, [props.startedFrom]);

  const blockedSet = useMemo(
    () => new Set(props.blockedTiles.map((t) => `${t.x},${t.y}`)),
    [props.blockedTiles],
  );

  const byId = useMemo(() => new Map(props.combatants.map((c) => [c.id, c] as const)), [props.combatants]);

  const actor = useMemo(
    () => (props.playerCombatantId ? byId.get(props.playerCombatantId) ?? null : null),
    [byId, props.playerCombatantId],
  );

  const hoveredPreview = useMemo(() => {
    if (!props.hoveredSkill || !actor) return null;
    const metric = (props.hoveredSkill.targeting_json?.metric ?? "manhattan") as Metric;
    const requiresLos = Boolean(props.hoveredSkill.targeting_json?.requires_los);
    const blocksOnWalls = Boolean(props.hoveredSkill.targeting_json?.blocks_on_walls);

    let tx: number | null = null;
    let ty: number | null = null;

    if (props.focus?.kind === "tile") {
      tx = props.focus.x;
      ty = props.focus.y;
    } else if (props.focus?.kind === "combatant") {
      const t = byId.get(props.focus.combatantId) ?? null;
      if (t) {
        tx = t.x;
        ty = t.y;
      }
    }

    if (tx == null || ty == null) return null;
    const dist = distanceTiles(metric, actor.x, actor.y, tx, ty);
    const inRange = dist <= Number(props.hoveredSkill.range_tiles ?? 0);
    const losOk = !requiresLos || !blocksOnWalls || hasLineOfSight(actor.x, actor.y, tx, ty, blockedSet);
    return { from: { x: actor.x, y: actor.y }, to: { x: tx, y: ty }, inRange, losOk };
  }, [actor, blockedSet, byId, props.focus, props.hoveredSkill]);

  const tileSize = 16;
  const margin = 16;
  const innerW = props.grid.width * tileSize;
  const innerH = props.grid.height * tileSize;
  const canvasW = innerW + margin * 2;
  const canvasH = innerH + margin * 2;

  useEffect(() => {
    // Build FX list incrementally based on unseen events.
    const nowMs = Date.now();
    const seen = seenEventIdsRef.current;
    const newEvents = props.events.filter((e) => !seen.has(e.id));
    if (newEvents.length === 0) return;
    for (const e of newEvents) seen.add(e.id);
    const additions = newEvents.flatMap((e) => fxFromEvent(e, byId, nowMs));
    if (additions.length) fxRef.current = [...fxRef.current, ...additions].slice(-60);
  }, [byId, props.events]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const t = Date.now();
      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.imageSmoothingEnabled = false;

      // Background tiles.
      for (let y = 0; y < props.grid.height; y++) {
        for (let x = 0; x < props.grid.width; x++) {
          const px = margin + x * tileSize;
          const py = margin + y * tileSize;
          const key = `${x},${y}`;
          const blocked = blockedSet.has(key);

          if (theme === "dungeon") {
            ctx.fillStyle = blocked ? "#111827" : ((x + y) % 2 === 0 ? "#1f2937" : "#243447");
          } else if (theme === "travel") {
            ctx.fillStyle = blocked ? "#0f172a" : ((x + y) % 2 === 0 ? "#144d2a" : "#11522c");
          } else {
            ctx.fillStyle = blocked ? "#0f172a" : ((x + y) % 2 === 0 ? "#14532d" : "#134e4a");
          }
          ctx.fillRect(px, py, tileSize, tileSize);

          // Subtle grid edge.
          ctx.strokeStyle = "rgba(15, 23, 42, 0.55)";
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
        }
      }

      // Obstacles.
      for (const b of props.blockedTiles) {
        const px = margin + b.x * tileSize;
        const py = margin + b.y * tileSize;
        drawObstacle(ctx, px, py, tileSize, theme, `blocked:${b.x},${b.y}:${theme}`);
      }

      // Focus highlight.
      if (props.focus?.kind === "tile") {
        const px = margin + props.focus.x * tileSize;
        const py = margin + props.focus.y * tileSize;
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
        ctx.restore();
      } else if (props.focus?.kind === "combatant") {
        const c = byId.get(props.focus.combatantId);
        if (c) {
          const px = margin + c.x * tileSize;
          const py = margin + c.y * tileSize;
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
          ctx.restore();
        }
      }

      // Hovered skill preview (line + color).
      if (hoveredPreview) {
        const fromPx = margin + hoveredPreview.from.x * tileSize + tileSize / 2;
        const fromPy = margin + hoveredPreview.from.y * tileSize + tileSize / 2;
        const toPx = margin + hoveredPreview.to.x * tileSize + tileSize / 2;
        const toPy = margin + hoveredPreview.to.y * tileSize + tileSize / 2;
        ctx.save();
        ctx.globalAlpha = 0.85;
        const ok = hoveredPreview.inRange && hoveredPreview.losOk;
        ctx.strokeStyle = ok ? "rgba(34, 197, 94, 0.9)" : "rgba(239, 68, 68, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fromPx, fromPy);
        ctx.lineTo(toPx, toPy);
        ctx.stroke();
        ctx.restore();
      }

      // Combatants.
      for (const c of props.combatants) {
        const px = margin + c.x * tileSize;
        const py = margin + c.y * tileSize;
        drawCombatantSprite(ctx, px, py, tileSize, {
          id: c.id,
          entityType: c.entity_type,
          isActive: c.id === props.activeTurnCombatantId,
          isDead: !c.is_alive || c.hp <= 0,
          timeMs: t,
          theme,
        });
      }

      // FX layer.
      const fx = fxRef.current;
      const nextFx: CombatFx[] = [];
      for (const f of fx) {
        const age = t - f.startedAtMs;
        if (age > f.durationMs) continue;
        nextFx.push(f);
        drawFx(ctx, f, {
          t,
          age,
          tileSize,
          margin,
          theme,
        });
      }
      fxRef.current = nextFx;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [
    blockedSet,
    canvasH,
    canvasW,
    hoveredPreview,
    props.activeTurnCombatantId,
    props.blockedTiles,
    props.combatants,
    props.focus,
    props.grid.height,
    props.grid.width,
    theme,
    byId,
  ]);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full select-none rounded-lg border border-border bg-black/30 [image-rendering:pixelated]"
        onPointerDown={(ev) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const x = Math.floor(((ev.clientX - rect.left) / rect.width) * canvasW);
          const y = Math.floor(((ev.clientY - rect.top) / rect.height) * canvasH);
          const gx = Math.floor((x - margin) / tileSize);
          const gy = Math.floor((y - margin) / tileSize);
          if (gx < 0 || gy < 0 || gx >= props.grid.width || gy >= props.grid.height) return;
          const onC = props.combatants.find((c) => c.x === gx && c.y === gy && c.is_alive) ?? null;
          if (onC) props.onSelectCombatant(onC.id);
          else props.onSelectTile(gx, gy);
        }}
      />
    </div>
  );
}

function drawFx(
  ctx: CanvasRenderingContext2D,
  fx: CombatFx,
  args: { t: number; age: number; tileSize: number; margin: number; theme: SpriteTheme },
) {
  const { age, tileSize, margin } = args;
  const p = (pos: { x: number; y: number }) => ({
    x: margin + pos.x * tileSize + tileSize / 2,
    y: margin + pos.y * tileSize + tileSize / 2,
  });

  if (fx.type === "projectile" && fx.from && fx.to) {
    const a = p(fx.from);
    const b = p(fx.to);
    const t = Math.min(1, Math.max(0, age / fx.durationMs));
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    ctx.save();
    ctx.fillStyle = "#fb7185";
    ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
    ctx.fillStyle = "rgba(251, 113, 133, 0.55)";
    ctx.fillRect(Math.round(x) - 6, Math.round(y) - 1, 4, 2);
    ctx.restore();
    return;
  }

  if ((fx.type === "burst" || fx.type === "heal" || fx.type === "status" || fx.type === "death") && fx.to) {
    const c = p(fx.to);
    ctx.save();
    if (fx.type === "heal") ctx.fillStyle = "rgba(34, 197, 94, 0.9)";
    else if (fx.type === "status") ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
    else if (fx.type === "death") ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
    else ctx.fillStyle = "rgba(239, 68, 68, 0.9)";

    const radius = fx.type === "death" ? 6 : 5;
    const step = fx.type === "death" ? 1 : 2;
    for (let i = 0; i < 8; i++) {
      const dx = ((i % 3) - 1) * step;
      const dy = (Math.floor(i / 3) - 1) * step;
      ctx.fillRect(Math.round(c.x) + dx - 1, Math.round(c.y) + dy - 1, radius / 3, radius / 3);
    }

    // Floating amount (pixel-y text).
    if ((fx.type === "burst" || fx.type === "heal") && fx.amount && fx.amount > 0) {
      const rise = Math.round((age / fx.durationMs) * 10);
      ctx.fillStyle = fx.type === "heal" ? "rgba(34, 197, 94, 0.95)" : "rgba(239, 68, 68, 0.95)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(fx.amount), Math.round(c.x), Math.round(c.y) - 10 - rise);
    }
    ctx.restore();
    return;
  }
}

