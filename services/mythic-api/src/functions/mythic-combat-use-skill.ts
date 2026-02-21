import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { bresenhamLine, distanceTiles, type Metric } from "../shared/mythic_grid.js";
import { rng01 } from "../shared/mythic_rng.js";
import { assertContentAllowed } from "../shared/content_policy.js";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import { settleCombat } from "../lib/combat/settlement.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const TargetSchema = z.union([
  z.object({ kind: z.literal("self") }),
  z.object({ kind: z.literal("combatant"), combatant_id: z.string().uuid() }),
  z.object({ kind: z.literal("tile"), x: z.number().int(), y: z.number().int() }),
]);

const BuiltInSkillSchema = z.enum(["basic_attack", "basic_defend", "basic_recover_mp", "basic_move"]);

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  combatSessionId: z.string().uuid(),
  actorCombatantId: z.string().uuid(),
  skillId: z.union([z.string().uuid(), BuiltInSkillSchema]),
  target: TargetSchema,
});

type CombatantRow = {
  id: string;
  entity_type?: "player" | "npc" | "summon";
  player_id: string | null;
  character_id: string | null;
  name: string;
  x: number;
  y: number;
  lvl: number;
  offense: number;
  defense: number;
  control: number;
  support: number;
  mobility: number;
  utility: number;
  weapon_power: number;
  hp: number;
  hp_max: number;
  power: number;
  power_max: number;
  armor: number;
  resist: number;
  statuses: unknown;
  is_alive: boolean;
};

type SkillRow = {
  id: string;
  character_id: string;
  kind: string;
  targeting: string;
  targeting_json: Record<string, unknown>;
  name: string;
  description: string;
  range_tiles: number;
  cooldown_turns: number;
  cost_json: Record<string, unknown>;
  effects_json: Record<string, unknown>;
};

type BuiltInSkillId = z.infer<typeof BuiltInSkillSchema>;

type TurnOrderRow = { combatant_id: string };
type Position = { x: number; y: number };

const MOVE_SPENT_STATUS_ID = "move_spent";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type StatusEntry = {
  id: string;
  expires_turn: number | null;
  stacks?: number;
  data?: Record<string, unknown>;
};

function nowStatuses(raw: unknown): StatusEntry[] {
  const arr = asArray(raw);
  return arr
    .map((x) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null))
    .filter(Boolean)
    .map((o) => ({
      id: String(o!.id ?? ""),
      expires_turn: o!.expires_turn === null || o!.expires_turn === undefined ? null : Number(o!.expires_turn),
      stacks: o!.stacks === undefined ? undefined : Number(o!.stacks),
      data: asObject(o!.data),
    }))
    .filter((s) => Boolean(s.id));
}

function metricFromTargetingJson(targetingJson: Record<string, unknown>): Metric {
  const metric = targetingJson.metric;
  if (metric === "chebyshev" || metric === "euclidean" || metric === "manhattan") return metric;
  return "manhattan";
}

function toBlockedSet(blocked: Array<{ x: number; y: number }>) {
  return new Set(blocked.map((t) => `${t.x},${t.y}`));
}

function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blocked: Set<string>,
): boolean {
  const points = bresenhamLine(ax, ay, bx, by);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (blocked.has(`${p.x},${p.y}`)) return false;
  }
  return true;
}

function advanceAlongLine(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps: number,
  blocked: Set<string>,
): { x: number; y: number } {
  const line = bresenhamLine(startX, startY, endX, endY);
  if (line.length <= 1) return { x: startX, y: startY };
  const maxIdx = Math.min(line.length - 1, Math.max(0, Math.floor(steps)));
  let last = line[0]!;
  for (let i = 1; i <= maxIdx; i++) {
    const p = line[i]!;
    if (blocked.has(`${p.x},${p.y}`)) break;
    last = p;
  }
  return { x: last.x, y: last.y };
}

function advanceAlongLineAvoidingOccupied(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps: number,
  blocked: Set<string>,
  occupied: Set<string>,
): { x: number; y: number } {
  const line = bresenhamLine(startX, startY, endX, endY);
  if (line.length <= 1) return { x: startX, y: startY };
  const maxIdx = Math.min(line.length - 1, Math.max(0, Math.floor(steps)));
  let last = line[0]!;
  for (let i = 1; i <= maxIdx; i += 1) {
    const p = line[i]!;
    const key = `${p.x},${p.y}`;
    if (blocked.has(key) || occupied.has(key)) break;
    last = p;
  }
  return { x: last.x, y: last.y };
}

function stepAway(
  fromX: number,
  fromY: number,
  targetX: number,
  targetY: number,
  steps: number,
  blocked: Set<string>,
): { x: number; y: number } {
  const dx = targetX - fromX;
  const dy = targetY - fromY;
  const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
  const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
  const endX = targetX + stepX * Math.max(0, Math.floor(steps));
  const endY = targetY + stepY * Math.max(0, Math.floor(steps));
  return advanceAlongLine(targetX, targetY, endX, endY, steps, blocked);
}

function removeStatusId(statuses: StatusEntry[], id: string): StatusEntry[] {
  return statuses.filter((entry) => entry.id !== id);
}

function statusDataText(status: StatusEntry, key: string): string | null {
  const value = status.data?.[key];
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length > 0 ? clean : null;
}

function moveTurnMarker(combatSessionId: string, turnIndex: number): string {
  return `${combatSessionId}:${turnIndex}`;
}

function hasMoveSpentThisTurn(statuses: StatusEntry[], marker: string): boolean {
  return statuses.some((entry) => (
    entry.id === MOVE_SPENT_STATUS_ID
    && statusDataText(entry, "turn_marker") === marker
  ));
}

function occupiedPositionSet(combatants: CombatantRow[], excludeCombatantId: string | null = null): Set<string> {
  const set = new Set<string>();
  for (const entry of combatants) {
    if (!entry.is_alive) continue;
    if (excludeCombatantId && entry.id === excludeCombatantId) continue;
    set.add(`${Math.floor(entry.x)},${Math.floor(entry.y)}`);
  }
  return set;
}

function inBounds(point: Position, cols = 14, rows = 10): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < cols && point.y < rows;
}

function canStandAt(point: Position, blocked: Set<string>, occupied: Set<string>): boolean {
  return !blocked.has(`${point.x},${point.y}`) && !occupied.has(`${point.x},${point.y}`);
}

function chooseMoveStep(current: Position, target: Position, blocked: Set<string>, occupied: Set<string>): Position | null {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (dx === 0 && dy === 0) return null;
  const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
  const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
  const prioritized = Math.abs(dx) >= Math.abs(dy)
    ? [{ x: current.x + stepX, y: current.y }, { x: current.x, y: current.y + stepY }]
    : [{ x: current.x, y: current.y + stepY }, { x: current.x + stepX, y: current.y }];
  for (const candidate of prioritized) {
    if (!inBounds(candidate)) continue;
    if (canStandAt(candidate, blocked, occupied)) return candidate;
  }
  return null;
}

function moveToward(args: {
  start: Position;
  target: Position;
  maxSteps: number;
  blocked: Set<string>;
  occupied: Set<string>;
}): { to: Position; steps: number } {
  let current: Position = { x: args.start.x, y: args.start.y };
  let steps = 0;
  const max = Math.max(0, Math.floor(args.maxSteps));
  for (let i = 0; i < max; i += 1) {
    const next = chooseMoveStep(current, args.target, args.blocked, args.occupied);
    if (!next) break;
    current = next;
    steps += 1;
  }
  return { to: current, steps };
}

function getTargetsForShape(args: {
  shape: string;
  metric: Metric;
  actor: CombatantRow;
  targetX: number;
  targetY: number;
  radius: number;
  length: number;
  width: number;
  combatants: CombatantRow[];
}): CombatantRow[] {
  const { shape, metric, actor, targetX, targetY, radius, length, width, combatants } = args;
  if (shape === "self") return [actor];
  if (shape === "single") {
    const t = combatants.find((c) => c.x === targetX && c.y === targetY);
    return t ? [t] : [];
  }
  if (shape === "tile") {
    const t = combatants.find((c) => c.x === targetX && c.y === targetY);
    return t ? [t] : [];
  }
  if (shape === "area") {
    const r = Math.max(0, radius);
    return combatants.filter((c) => distanceTiles(metric, c.x, c.y, targetX, targetY) <= r);
  }
  if (shape === "line") {
    const len = Math.max(1, length);
    const w = Math.max(1, width);
    const linePoints = bresenhamLine(actor.x, actor.y, targetX, targetY).slice(0, len + 1);
    return combatants.filter((c) => {
      const onLine = linePoints.find((p) => p.x === c.x && p.y === c.y);
      if (onLine) return true;
      return linePoints.some((p) => Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y)) <= Math.floor(w / 2));
    });
  }
  if (shape === "cone") {
    const len = Math.max(1, length);
    const w = Math.max(1, width);
    const dirX = targetX - actor.x;
    const dirY = targetY - actor.y;
    return combatants.filter((c) => {
      const dx = c.x - actor.x;
      const dy = c.y - actor.y;
      const dist = distanceTiles(metric, actor.x, actor.y, c.x, c.y);
      if (dist > len) return false;
      if (dirX !== 0 && Math.sign(dx) !== Math.sign(dirX)) return false;
      if (dirY !== 0 && Math.sign(dy) !== Math.sign(dirY)) return false;
      return Math.abs(Math.abs(dx) - Math.abs(dy)) <= w;
    });
  }
  return [];
}

function getFlatCost(costJson: Record<string, unknown>): { amount: number; resource_id: string | null } {
  const amt = Number((costJson as any).amount ?? 0);
  const amount = Number.isFinite(amt) ? Math.max(0, Math.floor(amt)) : 0;
  const resource_id = typeof (costJson as any).resource_id === "string" ? String((costJson as any).resource_id) : null;
  return { amount, resource_id };
}

function hasCooldown(statuses: StatusEntry[], skillId: string, turnIndex: number): { ok: boolean; remaining: number } {
  const id = `cd:${skillId}`;
  const entry = statuses.find((s) => s.id === id);
  if (!entry) return { ok: true, remaining: 0 };
  if (entry.expires_turn === null) return { ok: false, remaining: 999 };
  const remaining = Math.max(0, Math.floor(entry.expires_turn - turnIndex));
  return { ok: remaining <= 0, remaining };
}

function setCooldown(statuses: StatusEntry[], skillId: string, expiresTurn: number): StatusEntry[] {
  const id = `cd:${skillId}`;
  const next = statuses.filter((s) => s.id !== id);
  next.push({ id, expires_turn: expiresTurn, stacks: 1, data: {} });
  return next;
}

function setSimpleStatus(statuses: StatusEntry[], id: string, expiresTurn: number | null, data: Record<string, unknown>): StatusEntry[] {
  const next = statuses.filter((s) => s.id !== id);
  next.push({ id, expires_turn: expiresTurn, stacks: 1, data });
  return next;
}

function stripStatuses(statuses: StatusEntry[], removeIds: string[] | null): StatusEntry[] {
  if (!removeIds || removeIds.length === 0) {
    return statuses.filter((s) => !s.id.startsWith("cd:"));
  }
  const toRemove = new Set(removeIds);
  return statuses.filter((s) => !toRemove.has(s.id));
}

function effectiveAttackerStats(c: CombatantRow): { offense: number; mobility: number; utility: number } {
  const statuses = nowStatuses(c.statuses);
  const critBonus = statuses
    .filter((s) => s.id === "crit_bonus")
    .map((s) => Number((s.data ?? {}).amount ?? 0))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);

  const util = Math.min(100, Math.max(0, Math.floor(c.utility + critBonus)));
  return {
    offense: c.offense,
    mobility: c.mobility,
    utility: util,
  };
}

function allegianceKey(combatant: CombatantRow): string {
  const playerId = typeof combatant.player_id === "string" ? combatant.player_id.trim() : "";
  return playerId ? `party:${playerId}` : "enemy";
}

function areAllies(a: CombatantRow, b: CombatantRow): boolean {
  return allegianceKey(a) === allegianceKey(b);
}

function asBuiltInSkillId(value: string): BuiltInSkillId | null {
  return value === "basic_attack" || value === "basic_defend" || value === "basic_recover_mp" || value === "basic_move"
    ? value
    : null;
}

function buildBuiltInSkill(args: {
  id: BuiltInSkillId;
  actor: CombatantRow;
}): SkillRow {
  if (args.id === "basic_move") {
    const moveTiles = Math.max(2, Math.min(6, Math.floor(args.actor.mobility / 20) + 2));
    return {
      id: args.id,
      character_id: args.actor.character_id ?? "builtin",
      kind: "active",
      targeting: "tile",
      targeting_json: {
        shape: "tile",
        metric: "manhattan",
        requires_los: false,
        blocks_on_walls: true,
        friendly_fire: true,
      },
      name: "Move",
      description: "Reposition up to your mobility budget without ending your turn.",
      range_tiles: 14,
      cooldown_turns: 0,
      cost_json: { amount: 0, resource_id: "mp" },
      effects_json: {
        move: { dash_tiles: moveTiles },
      },
    };
  }
  if (args.id === "basic_attack") {
    const rangeTiles = Math.max(1, Math.min(6, Math.floor(args.actor.mobility / 20) + 2));
    return {
      id: args.id,
      character_id: args.actor.character_id ?? "builtin",
      kind: "active",
      targeting: "single",
      targeting_json: {
        shape: "single",
        metric: "manhattan",
        requires_los: true,
        blocks_on_walls: true,
        friendly_fire: false,
      },
      name: "Attack",
      description: "Reliable strike that advances the turn.",
      range_tiles: rangeTiles,
      cooldown_turns: 0,
      cost_json: { amount: 0, resource_id: "mp" },
      effects_json: { damage: { skill_mult: 1.0 } },
    };
  }
  if (args.id === "basic_defend") {
    const guardAmount = Math.max(4, Math.floor(args.actor.defense * 0.22) + Math.floor(args.actor.support * 0.1));
    return {
      id: args.id,
      character_id: args.actor.character_id ?? "builtin",
      kind: "active",
      targeting: "self",
      targeting_json: {
        shape: "self",
        metric: "manhattan",
        requires_los: false,
        blocks_on_walls: false,
        friendly_fire: true,
      },
      name: "Defend",
      description: "Raise guard, gain armor, and reduce incoming pressure.",
      range_tiles: 0,
      cooldown_turns: 0,
      cost_json: { amount: 0, resource_id: "mp" },
      effects_json: {
        barrier: { amount: guardAmount, duration_turns: 1 },
      },
    };
  }
  const recoverAmount = Math.max(6, Math.floor(args.actor.utility * 0.18) + Math.floor(args.actor.support * 0.12));
  return {
    id: args.id,
    character_id: args.actor.character_id ?? "builtin",
    kind: "active",
    targeting: "self",
    targeting_json: {
      shape: "self",
      metric: "manhattan",
      requires_los: false,
      blocks_on_walls: false,
      friendly_fire: true,
    },
    name: "Recover MP",
    description: "Rebuild MP reserves to enable stronger actions.",
    range_tiles: 0,
    cooldown_turns: 0,
    cost_json: { amount: 0, resource_id: "mp" },
    effects_json: {
      power_gain: { amount: recoverAmount },
    },
  };
}

export const mythicCombatUseSkill: FunctionHandler = {
  name: "mythic-combat-use-skill",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;
    const baseHeaders = { "Content-Type": "application/json", "x-request-id": requestId };

    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-combat-use-skill",
      limit: 120,
      windowMs: 60_000,
      corsHeaders: {},
      requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      const user = await requireUser(req.headers);

      const idempotencyHeader = idempotencyKeyFromRequest(req);
      const idempotencyKey = idempotencyHeader ? `${user.userId}:${idempotencyHeader}` : null;
      if (idempotencyKey) {
        const cached = getIdempotentResponse(idempotencyKey);
        if (cached) {
          ctx.log.info("combat_use_skill.idempotent_hit", { request_id: requestId });
          return cached;
        }
      }

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
          status: 400,
          headers: baseHeaders,
        });
      }

      const { campaignId, combatSessionId, actorCombatantId, skillId } = parsed.data;
      const svc = createServiceClient();

      await assertCampaignAccess(svc, campaignId, user.userId);

      const { data: session, error: sessionError } = await svc
        .schema("mythic")
        .from("combat_sessions")
        .select("id, seed, status, current_turn_index")
        .eq("id", combatSessionId)
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return new Response(JSON.stringify({ error: "Combat session not found" }), { status: 404, headers: baseHeaders });
      if ((session as any).status !== "active") return new Response(JSON.stringify({ error: "Combat is not active" }), { status: 409, headers: baseHeaders });

      const turnIndex = Number((session as any).current_turn_index ?? 0);
      const seed = Number((session as any).seed ?? 0);

      const { data: expectedActor, error: expectedActorError } = await svc
        .schema("mythic")
        .from("turn_order")
        .select("combatant_id")
        .eq("combat_session_id", combatSessionId)
        .eq("turn_index", turnIndex)
        .maybeSingle<TurnOrderRow>();
      if (expectedActorError) throw expectedActorError;
      if (!expectedActor) return new Response(JSON.stringify({ error: "Turn order is missing" }), { status: 409, headers: baseHeaders });
      if ((expectedActor as any).combatant_id !== actorCombatantId) {
        return new Response(JSON.stringify({ error: "Not your turn" }), { status: 409, headers: baseHeaders });
      }

      const { data: actor, error: actorError } = await svc
        .schema("mythic")
        .from("combatants")
        .select("*")
        .eq("id", actorCombatantId)
        .eq("combat_session_id", combatSessionId)
        .maybeSingle<CombatantRow>();
      if (actorError) throw actorError;
      if (!actor || !(actor as any).is_alive) return new Response(JSON.stringify({ error: "Actor is not alive" }), { status: 409, headers: baseHeaders });
      if ((actor as any).player_id !== user.userId) {
        return new Response(JSON.stringify({ error: "Actor does not belong to you" }), { status: 403, headers: baseHeaders });
      }

      const builtInSkillId = asBuiltInSkillId(skillId);
      let skill: SkillRow | null = null;

      if (builtInSkillId) {
        skill = buildBuiltInSkill({ id: builtInSkillId, actor });
      } else {
        const { data: skillRow, error: skillError } = await svc
          .schema("mythic")
          .from("skills")
          .select("id, character_id, kind, targeting, targeting_json, name, description, range_tiles, cooldown_turns, cost_json, effects_json")
          .eq("id", skillId)
          .maybeSingle<SkillRow>();
        if (skillError) throw skillError;
        if (!skillRow) return new Response(JSON.stringify({ error: "Skill not found" }), { status: 404, headers: baseHeaders });
        if ((skillRow as any).kind !== "active" && (skillRow as any).kind !== "ultimate") {
          return new Response(JSON.stringify({ error: "Only active/ultimate skills can be used in combat" }), { status: 409, headers: baseHeaders });
        }
        if (!(actor as any).character_id || (skillRow as any).character_id !== (actor as any).character_id) {
          return new Response(JSON.stringify({ error: "Skill does not belong to actor" }), { status: 403, headers: baseHeaders });
        }
        skill = skillRow;
      }

      if (!skill) {
        return new Response(JSON.stringify({ error: "Skill not found" }), { status: 404, headers: baseHeaders });
      }

      assertContentAllowed([
        { path: "skill.name", value: (skill as any).name },
        { path: "skill.description", value: (skill as any).description },
      ]);

      const statuses = nowStatuses((actor as any).statuses);
      const turnMarker = moveTurnMarker(combatSessionId, turnIndex);
      if (builtInSkillId === "basic_move" && hasMoveSpentThisTurn(statuses, turnMarker)) {
        return new Response(JSON.stringify({ error: "Move already used this turn" }), { status: 409, headers: baseHeaders });
      }
      const cd = hasCooldown(statuses, (skill as any).id, turnIndex);
      if (!cd.ok) {
        return new Response(JSON.stringify({ error: `Skill is on cooldown (${cd.remaining} turns remaining)` }), { status: 409, headers: baseHeaders });
      }

      const cost = getFlatCost(((skill as any).cost_json ?? {}) as Record<string, unknown>);
      if (cost.amount > 0 && Number((actor as any).power) < cost.amount) {
        return new Response(JSON.stringify({ error: "Not enough MP to cast" }), { status: 409, headers: baseHeaders });
      }

      const targetingJson = asObject((skill as any).targeting_json);
      const metric = metricFromTargetingJson(targetingJson);
      const shape = String((targetingJson as any).shape ?? (skill as any).targeting ?? "single");
      const radius = Math.max(0, Math.floor(Number((targetingJson as any).radius ?? 1)));
      const length = Math.max(1, Math.floor(Number((targetingJson as any).length ?? (skill as any).range_tiles ?? 1)));
      const width = Math.max(1, Math.floor(Number((targetingJson as any).width ?? 1)));
      const requiresLos = Boolean((targetingJson as any).requires_los ?? false);
      const blocksOnWalls = Boolean((targetingJson as any).blocks_on_walls ?? true);
      const friendlyFire = Boolean((targetingJson as any).friendly_fire ?? false);

      const resolveTarget = async (target: z.infer<typeof TargetSchema>) => {
        if (target.kind === "self") {
          return { kind: "combatant" as const, combatant: actor, tx: (actor as any).x, ty: (actor as any).y };
        }
        if (target.kind === "combatant") {
          const { data: t, error: tErr } = await svc
            .schema("mythic")
            .from("combatants")
            .select("*")
            .eq("id", target.combatant_id)
            .eq("combat_session_id", combatSessionId)
            .maybeSingle<CombatantRow>();
          if (tErr) throw tErr;
          if (!t || !(t as any).is_alive) return { kind: "missing" as const };
          return { kind: "combatant" as const, combatant: t, tx: (t as any).x, ty: (t as any).y };
        }
        return { kind: "tile" as const, combatant: null, tx: target.x, ty: target.y };
      };

      const resolved = await resolveTarget(parsed.data.target);
      if (resolved.kind === "missing") {
        return new Response(JSON.stringify({ error: "Target not found" }), { status: 404, headers: baseHeaders });
      }

      const targeting = String((skill as any).targeting);
      if (targeting === "self" && resolved.combatant?.id !== (actor as any).id) {
        return new Response(JSON.stringify({ error: "This skill can only target self" }), { status: 409, headers: baseHeaders });
      }
      if (targeting === "single" && !resolved.combatant) {
        return new Response(JSON.stringify({ error: "This skill requires an entity target" }), { status: 409, headers: baseHeaders });
      }

      const dist = distanceTiles(metric, (actor as any).x, (actor as any).y, resolved.tx, resolved.ty);
      if (dist > Number((skill as any).range_tiles ?? 0)) {
        return new Response(JSON.stringify({ error: "Target out of range" }), { status: 409, headers: baseHeaders });
      }

      const { data: runtimeRow } = await svc
        .schema("mythic")
        .from("campaign_runtime")
        .select("state_json")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .maybeSingle();
      const blockedTiles = Array.isArray((runtimeRow as any)?.state_json?.blocked_tiles)
        ? ((runtimeRow as any).state_json.blocked_tiles as Array<{ x: number; y: number }>)
        : [];
      const blockedSet = toBlockedSet(blockedTiles);

      if (requiresLos && blocksOnWalls) {
        const los = hasLineOfSight((actor as any).x, (actor as any).y, resolved.tx, resolved.ty, blockedSet);
        if (!los) {
          return new Response(JSON.stringify({ error: "Line of sight blocked" }), { status: 409, headers: baseHeaders });
        }
      }

      const effects = asObject((skill as any).effects_json);
      const labelBase = `turn:${turnIndex}:actor:${(actor as any).id}:skill:${(skill as any).id}`;

      const { data: allCombatants, error: allCombatantsErr } = await svc
        .schema("mythic")
        .from("combatants")
        .select("*")
        .eq("combat_session_id", combatSessionId);
      if (allCombatantsErr) throw allCombatantsErr;
      const allTargets = getTargetsForShape({
        shape,
        metric,
        actor,
        targetX: resolved.tx,
        targetY: resolved.ty,
        radius,
        length,
        width,
        combatants: (allCombatants ?? []) as CombatantRow[],
      }).filter((c) => (c as any).is_alive);

      const filteredTargets = friendlyFire ? allTargets : allTargets.filter((t) => !areAllies(actor, t) || (t as any).id === (actor as any).id);

      const nextPower = Math.max(0, Math.floor(Number((actor as any).power) - cost.amount));
      const updates: Partial<CombatantRow> = { power: nextPower as any };
      let nextStatuses = statuses;
      if (builtInSkillId !== "basic_move") {
        nextStatuses = removeStatusId(nextStatuses, MOVE_SPENT_STATUS_ID);
      }
      if (Number((skill as any).cooldown_turns ?? 0) > 0) {
        nextStatuses = setCooldown(nextStatuses, (skill as any).id, turnIndex + Number((skill as any).cooldown_turns));
      }

      const events: Array<{ event_type: string; payload: Record<string, unknown>; actor_id: string | null; turn_index: number }> = [];

      events.push({
        event_type: "skill_used",
        payload: {
          skill_id: (skill as any).id,
          skill_name: (skill as any).name,
          targeting,
          at: { x: (actor as any).x, y: (actor as any).y },
          target: resolved.combatant
            ? { kind: "combatant", combatant_id: (resolved.combatant as any).id, x: resolved.tx, y: resolved.ty }
            : { kind: "tile", x: resolved.tx, y: resolved.ty },
          cost: cost.amount,
          cooldown_turns: (skill as any).cooldown_turns,
        },
        actor_id: (actor as any).id,
        turn_index: turnIndex,
      });

      const move = asObject((effects as any).move);
      if (Object.keys(move).length > 0 && typeof (move as any).dash_tiles === "number") {
        const dash = Math.max(0, Math.floor((move as any).dash_tiles));
        const occupied = occupiedPositionSet((allCombatants ?? []) as CombatantRow[], (actor as any).id);
        const targetPoint = resolved.kind === "combatant" && resolved.combatant && (resolved.combatant as any).id !== (actor as any).id
          ? { x: Math.floor((resolved.combatant as any).x), y: Math.floor((resolved.combatant as any).y) }
          : { x: Math.floor(resolved.tx), y: Math.floor(resolved.ty) };
        const startPoint = { x: Math.floor((actor as any).x), y: Math.floor((actor as any).y) };
        const moved = moveToward({
          start: startPoint,
          target: targetPoint,
          maxSteps: dash,
          blocked: blockedSet,
          occupied,
        });
        if (builtInSkillId === "basic_move" && moved.steps <= 0) {
          return new Response(JSON.stringify({ error: "Cannot move to selected tile" }), { status: 409, headers: baseHeaders });
        }
        if (moved.steps > 0) {
          (updates as any).x = moved.to.x;
          (updates as any).y = moved.to.y;
          events.push({
            event_type: "moved",
            payload: {
              from: startPoint,
              to: moved.to,
              dash_tiles: dash,
              tiles_used: moved.steps,
              onomatopoeia: (effects as any).onomatopoeia ?? null,
            },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
        if (builtInSkillId === "basic_move") {
          nextStatuses = setSimpleStatus(
            removeStatusId(nextStatuses, MOVE_SPENT_STATUS_ID),
            MOVE_SPENT_STATUS_ID,
            null,
            { turn_marker: turnMarker, budget: dash, tiles_used: moved.steps },
          );
        }
      }

      const teleport = asObject((effects as any).teleport);
      if (Object.keys(teleport).length > 0) {
        const tx = resolved.tx;
        const ty = resolved.ty;
        const occupied = occupiedPositionSet((allCombatants ?? []) as CombatantRow[], (actor as any).id);
        if (!blockedSet.has(`${tx},${ty}`) && !occupied.has(`${tx},${ty}`)) {
          (updates as any).x = tx;
          (updates as any).y = ty;
          events.push({
            event_type: "moved",
            payload: { from: { x: (actor as any).x, y: (actor as any).y }, to: { x: tx, y: ty }, teleport: true },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const pull = asObject((effects as any).pull);
      if (Object.keys(pull).length > 0 && typeof (pull as any).tiles === "number") {
        const tiles = Math.max(0, Math.floor(Number((pull as any).tiles)));
        const targets = filteredTargets.filter((t) => (t as any).id !== (actor as any).id);
        for (const target of targets) {
          const occupied = occupiedPositionSet((allCombatants ?? []) as CombatantRow[], (target as any).id);
          const next = advanceAlongLineAvoidingOccupied(
            (target as any).x,
            (target as any).y,
            (actor as any).x,
            (actor as any).y,
            tiles,
            blockedSet,
            occupied,
          );
          if (next.x === (target as any).x && next.y === (target as any).y) continue;
          const { error: moveErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({ x: next.x, y: next.y, updated_at: new Date().toISOString() })
            .eq("id", (target as any).id)
            .eq("combat_session_id", combatSessionId);
          if (moveErr) throw moveErr;
          events.push({
            event_type: "moved",
            payload: { target_combatant_id: (target as any).id, from: { x: (target as any).x, y: (target as any).y }, to: next, forced: "pull" },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const push = asObject((effects as any).push);
      if (Object.keys(push).length > 0 && typeof (push as any).tiles === "number") {
        const tiles = Math.max(0, Math.floor(Number((push as any).tiles)));
        const targets = filteredTargets.filter((t) => (t as any).id !== (actor as any).id);
        for (const target of targets) {
          const occupied = occupiedPositionSet((allCombatants ?? []) as CombatantRow[], (target as any).id);
          const pushed = stepAway((actor as any).x, (actor as any).y, (target as any).x, (target as any).y, tiles, blockedSet);
          const next = advanceAlongLineAvoidingOccupied(
            (target as any).x,
            (target as any).y,
            pushed.x,
            pushed.y,
            tiles,
            blockedSet,
            occupied,
          );
          if (next.x === (target as any).x && next.y === (target as any).y) continue;
          const { error: moveErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({ x: next.x, y: next.y, updated_at: new Date().toISOString() })
            .eq("id", (target as any).id)
            .eq("combat_session_id", combatSessionId);
          if (moveErr) throw moveErr;
          events.push({
            event_type: "moved",
            payload: { target_combatant_id: (target as any).id, from: { x: (target as any).x, y: (target as any).y }, to: next, forced: "push" },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const barrier = asObject((effects as any).barrier);
      if (Object.keys(barrier).length > 0 && typeof (barrier as any).amount === "number" && typeof (barrier as any).duration_turns === "number") {
        const amount = Math.max(0, Math.floor((barrier as any).amount));
        const duration = Math.max(0, Math.floor((barrier as any).duration_turns));
        (updates as any).armor = Math.max(0, Math.floor(Number((actor as any).armor) + amount));
        nextStatuses = setSimpleStatus(nextStatuses, "barrier", turnIndex + duration, { amount, source_skill_id: (skill as any).id });
        events.push({
          event_type: "status_applied",
          payload: { target_combatant_id: (actor as any).id, status: { id: "barrier", amount, duration_turns: duration } },
          actor_id: (actor as any).id,
          turn_index: turnIndex,
        });
        if (builtInSkillId === "basic_defend") {
          nextStatuses = setSimpleStatus(nextStatuses, "guard", turnIndex + 1, { source_skill_id: (skill as any).id, amount });
          events.push({
            event_type: "status_applied",
            payload: { target_combatant_id: (actor as any).id, status: { id: "guard", duration_turns: 1, amount } },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const selfDebuff = asObject((effects as any).self_debuff);
      if (Object.keys(selfDebuff).length > 0 && typeof (selfDebuff as any).id === "string") {
        const duration = Math.max(0, Math.floor(Number((selfDebuff as any).duration_turns ?? 0)));
        const id = String((selfDebuff as any).id);
        nextStatuses = setSimpleStatus(nextStatuses, id, turnIndex + duration, { intensity: Number((selfDebuff as any).intensity ?? 1) });
        events.push({
          event_type: "status_applied",
          payload: { target_combatant_id: (actor as any).id, status: { id, duration_turns: duration, self: true } },
          actor_id: (actor as any).id,
          turn_index: turnIndex,
        });
      }

      const bonus = asObject((effects as any).bonus);
      if (Object.keys(bonus).length > 0 && typeof (bonus as any).crit_chance_add === "number") {
        const amount = Math.max(0, Math.floor(Number((bonus as any).crit_chance_add) * 100));
        nextStatuses = setSimpleStatus(nextStatuses, "crit_bonus", turnIndex + 1, { amount, source_skill_id: (skill as any).id });
        events.push({
          event_type: "status_applied",
          payload: { target_combatant_id: (actor as any).id, status: { id: "crit_bonus", amount, duration_turns: 1 } },
          actor_id: (actor as any).id,
          turn_index: turnIndex,
        });
      }

      const shred = asObject((effects as any).armor_shred);
      if (Object.keys(shred).length > 0 && typeof (shred as any).amount === "number") {
        const amount = Math.max(0, Math.floor(Number((shred as any).amount)));
        const targets = filteredTargets.filter((t) => (t as any).id !== (actor as any).id || shape === "self");
        for (const target of targets) {
          const newArmor = Math.max(0, Math.floor(Number((target as any).armor ?? 0) - amount));
          const { error: shredErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({ armor: newArmor, updated_at: new Date().toISOString() })
            .eq("id", (target as any).id)
            .eq("combat_session_id", combatSessionId);
          if (shredErr) throw shredErr;
          events.push({
            event_type: "armor_shred",
            payload: { target_combatant_id: (target as any).id, amount, armor_after: newArmor },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const dmg = asObject((effects as any).damage);
      if (Object.keys(dmg).length > 0) {
        const targets = filteredTargets.filter((t) => (t as any).id !== (actor as any).id || shape === "self");
        if (targets.length === 0) {
          return new Response(JSON.stringify({ error: "No valid targets in area" }), { status: 409, headers: baseHeaders });
        }
        const skillMult = Number((dmg as any).skill_mult ?? 1);
        const attacker = effectiveAttackerStats(actor);

        for (const target of targets) {
          const { data: dmgJson, error: dmgErr } = await svc.rpc("mythic_compute_damage", {
            seed,
            label: `${labelBase}:t:${(target as any).id}`,
            lvl: (actor as any).lvl,
            offense: attacker.offense,
            mobility: attacker.mobility,
            utility: attacker.utility,
            weapon_power: (actor as any).weapon_power ?? 0,
            skill_mult: Number.isFinite(skillMult) ? skillMult : 1,
            resist: Number((target as any).resist ?? 0) + Number((target as any).armor ?? 0),
            spread_pct: 0.10,
          });
          if (dmgErr) throw dmgErr;
          const dmgObj = asObject(dmgJson);
          const finalDamage = Number((dmgObj as any).final_damage ?? 0);
          const raw = Number.isFinite(finalDamage) ? Math.max(0, finalDamage) : 0;

          const shield = Math.max(0, Number((target as any).armor ?? 0));
          const absorbed = Math.min(shield, raw);
          const remaining = raw - absorbed;
          const newArmor = shield - absorbed;
          const newHp = Math.max(0, Number((target as any).hp ?? 0) - remaining);
          const died = newHp <= 0.0001;

          const { error: targetUpdateErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({
              armor: newArmor,
              hp: newHp,
              is_alive: died ? false : (target as any).is_alive,
              updated_at: new Date().toISOString(),
            })
            .eq("id", (target as any).id)
            .eq("combat_session_id", combatSessionId);
          if (targetUpdateErr) throw targetUpdateErr;

          events.push({
            event_type: "damage",
            payload: {
              source_combatant_id: (actor as any).id,
              target_combatant_id: (target as any).id,
              skill_id: (skill as any).id,
              roll: dmgObj,
              shield_absorbed: absorbed,
              damage_to_hp: remaining,
              hp_after: newHp,
              armor_after: newArmor,
              onomatopoeia: (effects as any).onomatopoeia ?? null,
            },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });

          if (died) {
            events.push({
              event_type: "death",
              payload: { target_combatant_id: (target as any).id, by: { combatant_id: (actor as any).id, skill_id: (skill as any).id } },
              actor_id: (actor as any).id,
              turn_index: turnIndex,
            });
          }
        }
      }

      const status = asObject((effects as any).status);
      if (Object.keys(status).length > 0 && typeof (status as any).id === "string" && typeof (status as any).duration_turns === "number") {
        const targets = filteredTargets.filter((t) => (t as any).id !== (actor as any).id || shape === "self");
        if (targets.length === 0) {
          return new Response(JSON.stringify({ error: "No valid targets in area" }), { status: 409, headers: baseHeaders });
        }
        const duration = Math.max(0, Math.floor(Number((status as any).duration_turns)));
        const statusId = String((status as any).id);
        for (const target of targets) {
          const { data: chance, error: chanceErr } = await svc.rpc("mythic_status_apply_chance", {
            control: (actor as any).control,
            utility: (actor as any).utility,
            target_resolve: Math.floor(Number((target as any).resist ?? 0)),
          });
          if (chanceErr) throw chanceErr;
          const ch = typeof chance === "number" ? chance : Number(chance ?? 0);
          const roll = rng01(seed, `${labelBase}:status:${statusId}:t:${(target as any).id}`);
          const applied = roll < ch;

          events.push({
            event_type: "status_roll",
            payload: { target_combatant_id: (target as any).id, status_id: statusId, chance: ch, roll, applied },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });

          if (applied) {
            const targetStatuses = nowStatuses((target as any).statuses);
            const nextTargetStatuses = setSimpleStatus(targetStatuses, statusId, turnIndex + duration, { source_skill_id: (skill as any).id });
            const { error: statusUpdateErr } = await svc
              .schema("mythic")
              .from("combatants")
              .update({ statuses: nextTargetStatuses, updated_at: new Date().toISOString() })
              .eq("id", (target as any).id)
              .eq("combat_session_id", combatSessionId);
            if (statusUpdateErr) throw statusUpdateErr;
            events.push({
              event_type: "status_applied",
              payload: { target_combatant_id: (target as any).id, status: { id: statusId, duration_turns: duration } },
              actor_id: (actor as any).id,
              turn_index: turnIndex,
            });
          }
        }
      }

      const drain = asObject((effects as any).power_drain);
      if (Object.keys(drain).length > 0 && typeof (drain as any).amount === "number") {
        const amount = Math.max(0, Math.floor(Number((drain as any).amount)));
        let totalDrained = 0;
        const targets = filteredTargets.filter((t) => (t as any).id !== (actor as any).id || shape === "self");
        for (const target of targets) {
          const cur = Math.max(0, Math.floor(Number((target as any).power ?? 0)));
          const drained = Math.min(cur, amount);
          totalDrained += drained;
          const nextTargetPower = cur - drained;
          const { error: drainErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({ power: nextTargetPower, updated_at: new Date().toISOString() })
            .eq("id", (target as any).id)
            .eq("combat_session_id", combatSessionId);
          if (drainErr) throw drainErr;
          events.push({
            event_type: "power_drain",
            payload: { target_combatant_id: (target as any).id, amount: drained, power_after: nextTargetPower },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
        if (totalDrained > 0) {
          const newPower = Math.min(Number((actor as any).power_max), nextPower + totalDrained);
          (updates as any).power = newPower;
          events.push({
            event_type: "power_gain",
            payload: { target_combatant_id: (actor as any).id, amount: totalDrained, power_after: newPower },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const heal = asObject((effects as any).heal);
      if (Object.keys(heal).length > 0) {
        const targets = shape === "self"
          ? [actor]
          : allTargets.filter((t) => areAllies(actor, t) || (t as any).id === (actor as any).id);
        const amount = Math.max(0, Math.floor(Number((heal as any).amount ?? 0)));
        for (const target of targets) {
          const newHp = Math.min(Number((target as any).hp_max), Number((target as any).hp ?? 0) + amount);
          const { error: healErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({ hp: newHp, updated_at: new Date().toISOString() })
            .eq("id", (target as any).id)
            .eq("combat_session_id", combatSessionId);
          if (healErr) throw healErr;
          events.push({
            event_type: "healed",
            payload: { target_combatant_id: (target as any).id, amount, hp_after: newHp },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const cleanse = asObject((effects as any).cleanse);
      if (Object.keys(cleanse).length > 0) {
        const targets = shape === "self"
          ? [actor]
          : allTargets.filter((t) => areAllies(actor, t) || (t as any).id === (actor as any).id);
        const ids = Array.isArray((cleanse as any).ids)
          ? (cleanse as any).ids.map((x: unknown) => String(x))
          : null;
        for (const target of targets) {
          const targetStatuses = nowStatuses((target as any).statuses);
          const nextTargetStatuses = stripStatuses(targetStatuses, ids);
          const { error: cleanseErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({ statuses: nextTargetStatuses, updated_at: new Date().toISOString() })
            .eq("id", (target as any).id)
            .eq("combat_session_id", combatSessionId);
          if (cleanseErr) throw cleanseErr;
          events.push({
            event_type: "cleanse",
            payload: { target_combatant_id: (target as any).id, ids: ids ?? "all_non_cd" },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const revive = asObject((effects as any).revive);
      if (Object.keys(revive).length > 0 && typeof (revive as any).amount === "number") {
        const amount = Math.max(1, Math.floor(Number((revive as any).amount)));
        const targets = allTargets.filter((t) => !(t as any).is_alive);
        for (const target of targets) {
          const newHp = Math.min(Number((target as any).hp_max), amount);
          const { error: reviveErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({ is_alive: true, hp: newHp, updated_at: new Date().toISOString() })
            .eq("id", (target as any).id)
            .eq("combat_session_id", combatSessionId);
          if (reviveErr) throw reviveErr;
          events.push({
            event_type: "revive",
            payload: { target_combatant_id: (target as any).id, hp_after: newHp },
            actor_id: (actor as any).id,
            turn_index: turnIndex,
          });
        }
      }

      const powerGain = asObject((effects as any).power_gain);
      if (Object.keys(powerGain).length > 0) {
        const amount = Math.max(0, Math.floor(Number((powerGain as any).amount ?? 0)));
        const basePower = typeof (updates as any).power === "number" ? Number((updates as any).power) : nextPower;
        const newPower = Math.min(Number((actor as any).power_max), basePower + amount);
        (updates as any).power = newPower;
        events.push({
          event_type: "power_gain",
          payload: { target_combatant_id: (actor as any).id, amount, power_after: newPower },
          actor_id: (actor as any).id,
          turn_index: turnIndex,
        });
      }

      (updates as any).statuses = nextStatuses as any;
      const { error: actorUpdateErr } = await svc
        .schema("mythic")
        .from("combatants")
        .update({ ...(updates as any), updated_at: new Date().toISOString() })
        .eq("id", (actor as any).id)
        .eq("combat_session_id", combatSessionId);
      if (actorUpdateErr) throw actorUpdateErr;

      for (const e of events) {
        await svc.rpc("mythic_append_action_event", {
          combat_session_id: combatSessionId,
          turn_index: e.turn_index,
          actor_combatant_id: e.actor_id,
          event_type: e.event_type,
          payload: e.payload,
        });
      }

      if (builtInSkillId === "basic_move") {
        const response = new Response(JSON.stringify({
          ok: true,
          moved: true,
          next_turn_index: turnIndex,
          next_actor_combatant_id: (actor as any).id,
        }), {
          status: 200,
          headers: baseHeaders,
        });
        if (idempotencyKey) {
          storeIdempotentResponse(idempotencyKey, response, 10_000);
        }
        ctx.log.info("combat_use_skill.move_success", {
          request_id: requestId,
          campaign_id: campaignId,
          combat_session_id: combatSessionId,
          actor_combatant_id: (actor as any).id,
          turn_index: turnIndex,
        });
        return response;
      }

      const { data: turnRows, error: turnRowsErr } = await svc
        .schema("mythic")
        .from("turn_order")
        .select("turn_index, combatant_id")
        .eq("combat_session_id", combatSessionId)
        .order("turn_index", { ascending: true });
      if (turnRowsErr) throw turnRowsErr;
      const order = (turnRows ?? []) as Array<{ turn_index: number; combatant_id: string }>;
      if (order.length === 0) throw new Error("Turn order missing");

      const { data: aliveRows, error: aliveErr } = await svc
        .schema("mythic")
        .from("combatants")
        .select("id, is_alive")
        .eq("combat_session_id", combatSessionId);
      if (aliveErr) throw aliveErr;
      const aliveSet = new Set((aliveRows ?? []).filter((r: any) => r.is_alive).map((r: any) => r.id));

      const total = order.length;
      let nextIndex = (turnIndex + 1) % total;
      for (let i = 0; i < total; i++) {
        const idx = (turnIndex + 1 + i) % total;
        const cid = order[idx]!.combatant_id;
        if (aliveSet.has(cid)) {
          nextIndex = idx;
          break;
        }
      }

      const { data: aliveCombatants, error: aliveCombatantsErr } = await svc
        .schema("mythic")
        .from("combatants")
        .select("id, entity_type, is_alive, character_id, player_id, lvl")
        .eq("combat_session_id", combatSessionId);
      if (aliveCombatantsErr) throw aliveCombatantsErr;
      const alivePlayers = (aliveCombatants ?? []).filter((c: any) => c.is_alive && c.entity_type === "player").length;
      const aliveNpcs = (aliveCombatants ?? []).filter((c: any) => c.is_alive && c.entity_type === "npc").length;
      if (alivePlayers === 0 || aliveNpcs === 0) {
        const appendActionEvent = async (
          eventType: string,
          payload: Record<string, unknown>,
          actorCombatantId?: string | null,
          eventTurnIndex?: number,
        ) => {
          const { error } = await svc.rpc("mythic_append_action_event", {
            combat_session_id: combatSessionId,
            turn_index: eventTurnIndex ?? turnIndex,
            actor_combatant_id: actorCombatantId ?? null,
            event_type: eventType,
            payload,
          });
          if (error) throw error;
        };

        const outcome = await settleCombat({
          svc,
          campaignId,
          combatSessionId,
          turnIndex,
          seed,
          source: "combat_use_skill",
          requestId,
          logger: ctx.log,
          aliveRows: (aliveCombatants ?? []).map((row: any) => ({
            id: String(row.id),
            entity_type: row.entity_type === "npc" || row.entity_type === "summon" ? row.entity_type : "player",
            is_alive: Boolean(row.is_alive),
            character_id: typeof row.character_id === "string" ? row.character_id : null,
            player_id: typeof row.player_id === "string" ? row.player_id : null,
            lvl: typeof row.lvl === "number" ? row.lvl : null,
          })),
          appendActionEvent,
        });

        const response = new Response(JSON.stringify({ ok: true, ended: true, outcome: { alive_players: outcome.alive_players, alive_npcs: outcome.alive_npcs, won: outcome.won } }), {
          status: 200,
          headers: baseHeaders,
        });
        if (idempotencyKey) {
          storeIdempotentResponse(idempotencyKey, response, 15_000);
        }
        ctx.log.info("combat_use_skill.ended", {
          request_id: requestId,
          campaign_id: campaignId,
          combat_session_id: combatSessionId,
          actor_combatant_id: (actor as any).id,
          alive_players: outcome.alive_players,
          alive_npcs: outcome.alive_npcs,
          won: outcome.won,
        });
        return response;
      }

      const nextCombatantId = order[nextIndex]!.combatant_id;

      const { error: advanceErr } = await svc
        .schema("mythic")
        .from("combat_sessions")
        .update({ current_turn_index: nextIndex, updated_at: new Date().toISOString() })
        .eq("id", combatSessionId)
        .eq("campaign_id", campaignId);
      if (advanceErr) throw advanceErr;

      await svc.rpc("mythic_append_action_event", {
        combat_session_id: combatSessionId,
        turn_index: turnIndex,
        actor_combatant_id: (actor as any).id,
        event_type: "turn_end",
        payload: { actor_combatant_id: (actor as any).id },
      });

      await svc.rpc("mythic_append_action_event", {
        combat_session_id: combatSessionId,
        turn_index: nextIndex,
        actor_combatant_id: nextCombatantId,
        event_type: "turn_start",
        payload: { actor_combatant_id: nextCombatantId },
      });

      const response = new Response(JSON.stringify({ ok: true, next_turn_index: nextIndex, next_actor_combatant_id: nextCombatantId }), {
        status: 200,
        headers: baseHeaders,
      });
      if (idempotencyKey) {
        storeIdempotentResponse(idempotencyKey, response, 10_000);
      }
      ctx.log.info("combat_use_skill.success", {
        request_id: requestId,
        campaign_id: campaignId,
        combat_session_id: combatSessionId,
        actor_combatant_id: (actor as any).id,
        skill_id: (skill as any).id,
        next_turn_index: nextIndex,
      });
      return response;
    } catch (error) {
      if (error instanceof AuthError) {
        const message = error.code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code: error.code, requestId }), { status: 401, headers: baseHeaders });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId }), { status: error.status, headers: baseHeaders });
      }
      const normalized = sanitizeError(error);
      const msg = normalized.message || "Failed to use skill";
      return new Response(JSON.stringify({ error: msg, code: normalized.code ?? "combat_use_skill_failed", requestId }), {
        status: 500,
        headers: baseHeaders,
      });
    }
  },
};
