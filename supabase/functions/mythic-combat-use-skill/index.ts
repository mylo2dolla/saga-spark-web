import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { bresenhamLine, distanceTiles, type Metric } from "../_shared/mythic_grid.ts";
import { rng01 } from "../_shared/mythic_rng.ts";
import { assertContentAllowed } from "../_shared/content_policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TargetSchema = z.union([
  z.object({ kind: z.literal("self") }),
  z.object({ kind: z.literal("combatant"), combatant_id: z.string().uuid() }),
  z.object({ kind: z.literal("tile"), x: z.number().int(), y: z.number().int() }),
]);

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  combatSessionId: z.string().uuid(),
  actorCombatantId: z.string().uuid(),
  skillId: z.string().uuid(),
  target: TargetSchema,
});

type CombatantRow = {
  id: string;
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

type TurnOrderRow = { combatant_id: string };

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
      // Allow width around the line.
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
      // Same general direction.
      if (dirX !== 0 && Math.sign(dx) !== Math.sign(dirX)) return false;
      if (dirY !== 0 && Math.sign(dy) !== Math.sign(dirY)) return false;
      // Width constraint: roughly keep within a cone.
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

function setSimpleStatus(statuses: StatusEntry[], id: string, expiresTurn: number, data: Record<string, unknown>): StatusEntry[] {
  const next = statuses.filter((s) => s.id !== id);
  next.push({ id, expires_turn: expiresTurn, stacks: 1, data });
  return next;
}

function effectiveAttackerStats(c: CombatantRow): { offense: number; mobility: number; utility: number } {
  // Minimal status hooks for deterministic combat:
  // - "crit_bonus" adds directly to crit chance by raising utility (approx) in compute_damage.
  // - weakness exposures and other effects live in statuses for DM + future expansions.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaignId, combatSessionId, actorCombatantId, skillId } = parsed.data;
    const svc = createClient(supabaseUrl, serviceRoleKey);

    // Validate campaign membership (owner or member).
    const { data: campaign, error: campaignError } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) return new Response(JSON.stringify({ error: "Campaign not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: member, error: memberError } = await svc
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member && campaign.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized for this campaign" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session, error: sessionError } = await svc
      .schema("mythic")
      .from("combat_sessions")
      .select("id, seed, status, current_turn_index")
      .eq("id", combatSessionId)
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return new Response(JSON.stringify({ error: "Combat session not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (session.status !== "active") return new Response(JSON.stringify({ error: "Combat is not active" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const turnIndex = Number(session.current_turn_index ?? 0);
    const seed = Number(session.seed ?? 0);

    const { data: expectedActor, error: expectedActorError } = await svc
      .schema("mythic")
      .from("turn_order")
      .select("combatant_id")
      .eq("combat_session_id", combatSessionId)
      .eq("turn_index", turnIndex)
      .maybeSingle<TurnOrderRow>();
    if (expectedActorError) throw expectedActorError;
    if (!expectedActor) return new Response(JSON.stringify({ error: "Turn order is missing" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (expectedActor.combatant_id !== actorCombatantId) {
      return new Response(JSON.stringify({ error: "Not your turn" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: actor, error: actorError } = await svc
      .schema("mythic")
      .from("combatants")
      .select("*")
      .eq("id", actorCombatantId)
      .eq("combat_session_id", combatSessionId)
      .maybeSingle<CombatantRow>();
    if (actorError) throw actorError;
    if (!actor || !actor.is_alive) return new Response(JSON.stringify({ error: "Actor is not alive" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (actor.entity_type === "player" && actor.player_id !== user.id) {
      return new Response(JSON.stringify({ error: "Actor does not belong to you" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: skill, error: skillError } = await svc
      .schema("mythic")
      .from("skills")
      .select("id, character_id, kind, targeting, targeting_json, name, description, range_tiles, cooldown_turns, cost_json, effects_json")
      .eq("id", skillId)
      .maybeSingle<SkillRow>();
    if (skillError) throw skillError;
    if (!skill) return new Response(JSON.stringify({ error: "Skill not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (skill.kind !== "active" && skill.kind !== "ultimate") {
      return new Response(JSON.stringify({ error: "Only active/ultimate skills can be used in combat" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!actor.character_id || skill.character_id !== actor.character_id) {
      return new Response(JSON.stringify({ error: "Skill does not belong to actor" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Content safety: allow gore/harsh language; block sexual content.
    assertContentAllowed([
      { path: "skill.name", value: skill.name },
      { path: "skill.description", value: skill.description },
    ]);

    const statuses = nowStatuses(actor.statuses);
    const cd = hasCooldown(statuses, skill.id, turnIndex);
    if (!cd.ok) {
      return new Response(JSON.stringify({ error: `Skill is on cooldown (${cd.remaining} turns remaining)` }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cost = getFlatCost(skill.cost_json ?? {});
    if (cost.amount > 0 && actor.power < cost.amount) {
      return new Response(JSON.stringify({ error: "Not enough power to cast" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const targetingJson = asObject(skill.targeting_json);
    const metric = metricFromTargetingJson(targetingJson);
    const shape = String((targetingJson as any).shape ?? skill.targeting ?? "single");
    const radius = Math.max(0, Math.floor(Number((targetingJson as any).radius ?? 1)));
    const length = Math.max(1, Math.floor(Number((targetingJson as any).length ?? skill.range_tiles ?? 1)));
    const width = Math.max(1, Math.floor(Number((targetingJson as any).width ?? 1)));
    const requiresLos = Boolean((targetingJson as any).requires_los ?? false);
    const blocksOnWalls = Boolean((targetingJson as any).blocks_on_walls ?? true);
    const friendlyFire = Boolean((targetingJson as any).friendly_fire ?? false);

    const resolveTarget = async (target: z.infer<typeof TargetSchema>) => {
      if (target.kind === "self") {
        return { kind: "combatant" as const, combatant: actor, tx: actor.x, ty: actor.y };
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
        if (!t || !t.is_alive) return { kind: "missing" as const };
        return { kind: "combatant" as const, combatant: t, tx: t.x, ty: t.y };
      }
      return { kind: "tile" as const, combatant: null, tx: target.x, ty: target.y };
    };

    const resolved = await resolveTarget(parsed.data.target);
    if (resolved.kind === "missing") {
      return new Response(JSON.stringify({ error: "Target not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate targeting enum contract.
    const targeting = String(skill.targeting);
    if (targeting === "self" && resolved.combatant?.id !== actor.id) {
      return new Response(JSON.stringify({ error: "This skill can only target self" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (targeting === "single" && !resolved.combatant) {
      return new Response(JSON.stringify({ error: "This skill requires an entity target" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const dist = distanceTiles(metric, actor.x, actor.y, resolved.tx, resolved.ty);
    if (dist > Number(skill.range_tiles ?? 0)) {
      return new Response(JSON.stringify({ error: "Target out of range" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch blocked tiles for LOS checks (combat board state_json.blocked_tiles).
    const { data: boardRow } = await svc
      .schema("mythic")
      .from("boards")
      .select("state_json")
      .eq("combat_session_id", combatSessionId)
      .eq("status", "active")
      .maybeSingle();
    const blockedTiles = Array.isArray((boardRow as any)?.state_json?.blocked_tiles)
      ? ((boardRow as any).state_json.blocked_tiles as Array<{ x: number; y: number }>)
      : [];
    const blockedSet = toBlockedSet(blockedTiles);

    if (requiresLos && blocksOnWalls) {
      const los = hasLineOfSight(actor.x, actor.y, resolved.tx, resolved.ty, blockedSet);
      if (!los) {
        return new Response(JSON.stringify({ error: "Line of sight blocked" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const effects = asObject(skill.effects_json);
    const labelBase = `turn:${turnIndex}:actor:${actor.id}:skill:${skill.id}`;

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
    }).filter((c) => c.is_alive);

    const isAlly = (a: CombatantRow, b: CombatantRow) => a.entity_type === b.entity_type && a.player_id === b.player_id;
    const filteredTargets = friendlyFire ? allTargets : allTargets.filter((t) => !isAlly(actor, t) || t.id === actor.id);

    // Spend resource.
    const nextPower = Math.max(0, Math.floor(actor.power - cost.amount));
    const updates: Partial<CombatantRow> = { power: nextPower };
    let nextStatuses = statuses;
    if (Number(skill.cooldown_turns ?? 0) > 0) {
      nextStatuses = setCooldown(nextStatuses, skill.id, turnIndex + Number(skill.cooldown_turns));
    }

    // Apply immediate effects.
    const events: Array<{ event_type: string; payload: Record<string, unknown>; actor_id: string | null; turn_index: number }> = [];

    events.push({
      event_type: "skill_used",
      payload: {
        skill_id: skill.id,
        skill_name: skill.name,
        targeting,
        at: { x: actor.x, y: actor.y },
        target: resolved.combatant ? { kind: "combatant", combatant_id: resolved.combatant.id, x: resolved.tx, y: resolved.ty } : { kind: "tile", x: resolved.tx, y: resolved.ty },
        cost: cost.amount,
        cooldown_turns: skill.cooldown_turns,
      },
      actor_id: actor.id,
      turn_index: turnIndex,
    });

    // Movement.
    const move = asObject(effects.move);
    if (Object.keys(move).length > 0 && typeof move.dash_tiles === "number") {
      const dash = Math.max(0, Math.floor(move.dash_tiles));
      // For now: snap actor to the targeted tile, clamped by dash and skill range.
      const dx = resolved.tx - actor.x;
      const dy = resolved.ty - actor.y;
      const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
      const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
      const steps = Math.min(dash, Math.ceil(dist));
      const nx = actor.x + stepX * steps;
      const ny = actor.y + stepY * steps;
      updates.x = nx;
      updates.y = ny;
      events.push({
        event_type: "moved",
        payload: { from: { x: actor.x, y: actor.y }, to: { x: nx, y: ny }, dash_tiles: dash, onomatopoeia: effects.onomatopoeia ?? null },
        actor_id: actor.id,
        turn_index: turnIndex,
      });
    }

    // Barrier -> armor shield.
    const barrier = asObject(effects.barrier);
    if (Object.keys(barrier).length > 0 && typeof barrier.amount === "number" && typeof barrier.duration_turns === "number") {
      const amount = Math.max(0, Math.floor(barrier.amount));
      const duration = Math.max(0, Math.floor(barrier.duration_turns));
      updates.armor = Math.max(0, Math.floor(actor.armor + amount));
      nextStatuses = setSimpleStatus(nextStatuses, "barrier", turnIndex + duration, { amount, source_skill_id: skill.id });
      events.push({
        event_type: "status_applied",
        payload: { target_combatant_id: actor.id, status: { id: "barrier", amount, duration_turns: duration } },
        actor_id: actor.id,
        turn_index: turnIndex,
      });
    }

    // Self debuff hook.
    const selfDebuff = asObject(effects.self_debuff);
    if (Object.keys(selfDebuff).length > 0 && typeof selfDebuff.id === "string") {
      const duration = Math.max(0, Math.floor(Number((selfDebuff as any).duration_turns ?? 0)));
      const id = String((selfDebuff as any).id);
      nextStatuses = setSimpleStatus(nextStatuses, id, turnIndex + duration, { intensity: Number((selfDebuff as any).intensity ?? 1) });
      events.push({
        event_type: "status_applied",
        payload: { target_combatant_id: actor.id, status: { id, duration_turns: duration, self: true } },
        actor_id: actor.id,
        turn_index: turnIndex,
      });
    }

    // Bonus crit chance hook -> represented as a status that influences effective stats.
    const bonus = asObject(effects.bonus);
    if (Object.keys(bonus).length > 0 && typeof bonus.crit_chance_add === "number") {
      // Approximate by translating crit chance add into +utility (deterministic, explainable).
      // 0.12 crit ~= +12 utility in our clamped model.
      const amount = Math.max(0, Math.floor(Number(bonus.crit_chance_add) * 100));
      nextStatuses = setSimpleStatus(nextStatuses, "crit_bonus", turnIndex + 1, { amount, source_skill_id: skill.id });
      events.push({
        event_type: "status_applied",
        payload: { target_combatant_id: actor.id, status: { id: "crit_bonus", amount, duration_turns: 1 } },
        actor_id: actor.id,
        turn_index: turnIndex,
      });
    }

    // Damage (supports area/line/cone targeting).
    const dmg = asObject(effects.damage);
    if (Object.keys(dmg).length > 0) {
      const targets = filteredTargets.filter((t) => t.id !== actor.id || shape === "self");
      if (targets.length === 0) {
        return new Response(JSON.stringify({ error: "No valid targets in area" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const skillMult = Number((dmg as any).skill_mult ?? 1);
      const attacker = effectiveAttackerStats(actor);

      for (const target of targets) {
        const { data: dmgJson, error: dmgErr } = await svc.schema("mythic").rpc("compute_damage", {
          seed,
          label: `${labelBase}:t:${target.id}`,
          lvl: actor.lvl,
          offense: attacker.offense,
          mobility: attacker.mobility,
          utility: attacker.utility,
          weapon_power: actor.weapon_power ?? 0,
          skill_mult: Number.isFinite(skillMult) ? skillMult : 1,
          resist: (target.resist ?? 0) + (target.armor ?? 0),
          spread_pct: 0.10,
        });
        if (dmgErr) throw dmgErr;
        const dmgObj = asObject(dmgJson);
        const finalDamage = Number((dmgObj as any).final_damage ?? 0);
        const raw = Number.isFinite(finalDamage) ? Math.max(0, finalDamage) : 0;

        const shield = Math.max(0, Number(target.armor ?? 0));
        const absorbed = Math.min(shield, raw);
        const remaining = raw - absorbed;
        const newArmor = shield - absorbed;
        const newHp = Math.max(0, Number(target.hp ?? 0) - remaining);
        const died = newHp <= 0.0001;

        const { error: targetUpdateErr } = await svc
          .schema("mythic")
          .from("combatants")
          .update({
            armor: newArmor,
            hp: newHp,
            is_alive: died ? false : target.is_alive,
            updated_at: new Date().toISOString(),
          })
          .eq("id", target.id)
          .eq("combat_session_id", combatSessionId);
        if (targetUpdateErr) throw targetUpdateErr;

        events.push({
          event_type: "damage",
          payload: {
            source_combatant_id: actor.id,
            target_combatant_id: target.id,
            skill_id: skill.id,
            roll: dmgObj,
            shield_absorbed: absorbed,
            damage_to_hp: remaining,
            hp_after: newHp,
            armor_after: newArmor,
            onomatopoeia: effects.onomatopoeia ?? null,
          },
          actor_id: actor.id,
          turn_index: turnIndex,
        });

        if (died) {
          events.push({
            event_type: "death",
            payload: { target_combatant_id: target.id, by: { combatant_id: actor.id, skill_id: skill.id } },
            actor_id: actor.id,
            turn_index: turnIndex,
          });
        }
      }
    }

    // Status application to a target (stun/root/etc) via deterministic chance.
    const status = asObject(effects.status);
    if (Object.keys(status).length > 0 && typeof status.id === "string" && typeof status.duration_turns === "number") {
      const targets = filteredTargets.filter((t) => t.id !== actor.id || shape === "self");
      if (targets.length === 0) {
        return new Response(JSON.stringify({ error: "No valid targets in area" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const duration = Math.max(0, Math.floor(Number((status as any).duration_turns)));
      const statusId = String((status as any).id);
      for (const target of targets) {
        const { data: chance, error: chanceErr } = await svc.schema("mythic").rpc("status_apply_chance", {
          control: actor.control,
          utility: actor.utility,
          target_resolve: Math.floor(Number(target.resist ?? 0)),
        });
        if (chanceErr) throw chanceErr;
        const ch = typeof chance === "number" ? chance : Number(chance ?? 0);
        const roll = rng01(seed, `${labelBase}:status:${statusId}:t:${target.id}`);
        const applied = roll < ch;

        events.push({
          event_type: "status_roll",
          payload: { target_combatant_id: target.id, status_id: statusId, chance: ch, roll, applied },
          actor_id: actor.id,
          turn_index: turnIndex,
        });

        if (applied) {
          const targetStatuses = nowStatuses(target.statuses);
          const nextTargetStatuses = setSimpleStatus(targetStatuses, statusId, turnIndex + duration, { source_skill_id: skill.id });
          const { error: statusUpdateErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({ statuses: nextTargetStatuses, updated_at: new Date().toISOString() })
            .eq("id", target.id)
            .eq("combat_session_id", combatSessionId);
          if (statusUpdateErr) throw statusUpdateErr;
          events.push({
            event_type: "status_applied",
            payload: { target_combatant_id: target.id, status: { id: statusId, duration_turns: duration } },
            actor_id: actor.id,
            turn_index: turnIndex,
          });
        }
      }
    }

    // Healing (single or area).
    const heal = asObject(effects.heal);
    if (Object.keys(heal).length > 0) {
      const targets = shape === "self"
        ? [actor]
        : allTargets.filter((t) => isAlly(actor, t) || t.id === actor.id);
      const amount = Math.max(0, Math.floor(Number((heal as any).amount ?? 0)));
      for (const target of targets) {
        const newHp = Math.min(target.hp_max, Number(target.hp ?? 0) + amount);
        const { error: healErr } = await svc
          .schema("mythic")
          .from("combatants")
          .update({ hp: newHp, updated_at: new Date().toISOString() })
          .eq("id", target.id)
          .eq("combat_session_id", combatSessionId);
        if (healErr) throw healErr;
        events.push({
          event_type: "healed",
          payload: { target_combatant_id: target.id, amount, hp_after: newHp },
          actor_id: actor.id,
          turn_index: turnIndex,
        });
      }
    }

    // Power gain.
    const powerGain = asObject(effects.power_gain);
    if (Object.keys(powerGain).length > 0) {
      const amount = Math.max(0, Math.floor(Number((powerGain as any).amount ?? 0)));
      const newPower = Math.min(actor.power_max, nextPower + amount);
      updates.power = newPower;
      events.push({
        event_type: "power_gain",
        payload: { target_combatant_id: actor.id, amount, power_after: newPower },
        actor_id: actor.id,
        turn_index: turnIndex,
      });
    }

    // Persist actor update (power, move, armor for barrier, statuses/cooldowns).
    updates.statuses = nextStatuses as any;
    const { error: actorUpdateErr } = await svc
      .schema("mythic")
      .from("combatants")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", actor.id)
      .eq("combat_session_id", combatSessionId);
    if (actorUpdateErr) throw actorUpdateErr;

    // Append events in order.
    for (const e of events) {
      await svc.schema("mythic").rpc("append_action_event", {
        p_combat_session_id: combatSessionId,
        p_turn_index: e.turn_index,
        p_actor_combatant_id: e.actor_id,
        p_event_type: e.event_type,
        p_payload: e.payload,
      });
    }

    // Advance turn to the next alive combatant.
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

    // End-of-combat check: only one side left? For now, end if no NPCs alive or player dead.
    const { data: aliveCombatants, error: aliveCombatantsErr } = await svc
      .schema("mythic")
      .from("combatants")
      .select("id, entity_type, is_alive")
      .eq("combat_session_id", combatSessionId);
    if (aliveCombatantsErr) throw aliveCombatantsErr;
    const alivePlayers = (aliveCombatants ?? []).filter((c: any) => c.is_alive && c.entity_type === "player").length;
    const aliveNpcs = (aliveCombatants ?? []).filter((c: any) => c.is_alive && c.entity_type === "npc").length;
    if (alivePlayers === 0 || aliveNpcs === 0) {
      await svc.schema("mythic").rpc("end_combat_session", {
        p_combat_session_id: combatSessionId,
        p_outcome: { alive_players: alivePlayers, alive_npcs: aliveNpcs },
      });
      // Reactivate the most recent non-combat board and log a page-turn transition.
      const { data: lastBoard } = await svc
        .schema("mythic")
        .from("boards")
        .select("id, board_type")
        .eq("campaign_id", campaignId)
        .neq("board_type", "combat")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastBoard) {
        await svc.schema("mythic").from("boards").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", (lastBoard as any).id);
        await svc.schema("mythic").from("boards").update({ status: "archived", updated_at: new Date().toISOString() }).eq("combat_session_id", combatSessionId);
        await svc.schema("mythic").from("board_transitions").insert({
          campaign_id: campaignId,
          from_board_type: "combat",
          to_board_type: (lastBoard as any).board_type,
          reason: "combat_end",
          animation: "page_turn",
          payload_json: { combat_session_id: combatSessionId, outcome: { alive_players: alivePlayers, alive_npcs: aliveNpcs } },
        });
      }
      return new Response(JSON.stringify({ ok: true, ended: true, outcome: { alive_players: alivePlayers, alive_npcs: aliveNpcs } }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nextCombatantId = order[nextIndex]!.combatant_id;

    const { error: advanceErr } = await svc
      .schema("mythic")
      .from("combat_sessions")
      .update({ current_turn_index: nextIndex, updated_at: new Date().toISOString() })
      .eq("id", combatSessionId)
      .eq("campaign_id", campaignId);
    if (advanceErr) throw advanceErr;

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatSessionId,
      p_turn_index: turnIndex,
      p_actor_combatant_id: actor.id,
      p_event_type: "turn_end",
      p_payload: { actor_combatant_id: actor.id },
    });

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatSessionId,
      p_turn_index: nextIndex,
      p_actor_combatant_id: nextCombatantId,
      p_event_type: "turn_start",
      p_payload: { actor_combatant_id: nextCombatantId },
    });

    return new Response(JSON.stringify({ ok: true, next_turn_index: nextIndex, next_actor_combatant_id: nextCombatantId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-combat-use-skill error:", error);
    const msg = error instanceof Error ? error.message : "Failed to use skill";
    // Never emit sexual content, even in errors.
    const safeMsg = msg;
    return new Response(JSON.stringify({ error: safeMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
