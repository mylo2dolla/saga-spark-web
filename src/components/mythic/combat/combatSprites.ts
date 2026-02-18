function hashStringToInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(arr: readonly T[], n: number): T {
  if (arr.length === 0) throw new Error("pick() requires a non-empty array");
  return arr[n % arr.length]!;
}

export type SpriteTheme = "town" | "travel" | "dungeon";

export type CombatantSpriteArgs = {
  id: string;
  entityType: "player" | "npc" | "summon";
  isActive: boolean;
  isDead: boolean;
  timeMs: number;
  theme: SpriteTheme;
};

export function drawCombatantSprite(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  tileSize: number,
  args: CombatantSpriteArgs,
) {
  const h = hashStringToInt(args.id);
  const bob = Math.round(Math.sin((args.timeMs / 250) + (h % 9)) * 1);

  const bodyPalettes: Record<CombatantSpriteArgs["entityType"], readonly string[]> = {
    player: ["#5ddcff", "#4fd1c5", "#34d399", "#a7f3d0"],
    npc: ["#ff6b6b", "#f97316", "#fb7185", "#fecaca"],
    summon: ["#a78bfa", "#22d3ee", "#60a5fa", "#c4b5fd"],
  };

  const base = pick(bodyPalettes[args.entityType], h);
  const accent = pick(["#111827", "#0b1020", "#1f2937"] as const, h >> 8);
  const glow = args.entityType === "player" ? "rgba(93, 220, 255, 0.35)" : "rgba(255, 107, 107, 0.28)";

  const cx = Math.round(px + tileSize / 2);
  const cy = Math.round(py + tileSize / 2) + bob;

  // Active halo.
  if (args.isActive && !args.isDead) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 3, tileSize * 0.42, tileSize * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Dead "vaporize" look.
  if (args.isDead) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#64748b";
    ctx.fillRect(cx - 5, cy - 2, 10, 6);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(cx - 3, cy - 1, 6, 4);
    ctx.restore();
    return;
  }

  // Tiny 16-bit-ish body: head + torso + feet.
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Shadow.
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000000";
  ctx.fillRect(cx - 5, cy + 6, 10, 2);

  ctx.globalAlpha = 1;
  // Torso.
  ctx.fillStyle = base;
  ctx.fillRect(cx - 4, cy - 1, 8, 7);
  // Head.
  ctx.fillRect(cx - 3, cy - 5, 6, 4);
  // Outline.
  ctx.fillStyle = accent;
  ctx.fillRect(cx - 5, cy - 2, 1, 9);
  ctx.fillRect(cx + 4, cy - 2, 1, 9);
  ctx.fillRect(cx - 5, cy + 7, 11, 1);
  // Feet.
  ctx.fillStyle = "#111827";
  ctx.fillRect(cx - 4, cy + 6, 3, 2);
  ctx.fillRect(cx + 1, cy + 6, 3, 2);

  ctx.restore();
}

export function drawObstacle(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  tileSize: number,
  theme: SpriteTheme,
  seedKey: string,
) {
  const h = hashStringToInt(seedKey);
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  if (theme === "dungeon") {
    // Pillar / rubble.
    ctx.fillStyle = "#334155";
    ctx.fillRect(px + 4, py + 2, tileSize - 8, tileSize - 4);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(px + 5, py + 3, tileSize - 10, tileSize - 6);
  } else {
    // Tree / boulder.
    const variant = h % 2;
    if (variant === 0) {
      ctx.fillStyle = "#14532d";
      ctx.fillRect(px + 4, py + 3, tileSize - 8, tileSize - 6);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(px + 6, py + 5, tileSize - 12, tileSize - 10);
    } else {
      ctx.fillStyle = "#475569";
      ctx.fillRect(px + 4, py + 4, tileSize - 8, tileSize - 8);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(px + 6, py + 6, tileSize - 12, tileSize - 12);
    }
  }

  ctx.restore();
}
