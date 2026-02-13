import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { rngInt, rngPick } from "../_shared/mythic_rng.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  combatSessionId: z.string().uuid(),
  maxSteps: z.number().int().min(1).max(10).default(1),
});

type Combatant = {
  id: string;
  combat_session_id: string;
  entity_type: "player" | "npc" | "summon";
  player_id: string | null;
  character_id: string | null;
  name: string;
  lvl: number;
  offense: number;
  defense: number;
  control: number;
  support: number;
  mobility: number;
  utility: number;
  weapon_power: number;
  armor: number;
  resist: number;
  hp: number;
  hp_max: number;
  power: number;
  power_max: number;
  x: number;
  y: number;
  is_alive: boolean;
  statuses: unknown;
};

type TurnRow = { turn_index: number; combatant_id: string };

async function appendEvent(
  svc: ReturnType<typeof createClient>,
  combatSessionId: string,
  turnIndex: number,
  actorId: string | null,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const { error } = await svc.rpc("mythic_append_action_event", {
    combat_session_id: combatSessionId,
    turn_index: turnIndex,
    actor_combatant_id: actorId,
    event_type: eventType,
    payload,
  });
  if (error) throw error;
}

function nextAliveTurnIndex(order: TurnRow[], aliveSet: Set<string>, currentIndex: number) {
  const total = order.length;
  for (let i = 1; i <= total; i += 1) {
    const idx = (currentIndex + i) % total;
    if (aliveSet.has(order[idx]!.combatant_id)) return idx;
  }
  return currentIndex;
}

function pickBossSkill(seed: number, label: string, phaseSkills: string[]) {
  if (!phaseSkills.length) return "boss_strike";
  return rngPick(seed, `${label}:boss_skill`, phaseSkills);
}

function skillMultFor(skillName: string, targetHpPct: number): number {
  if (skillName === "boss_execute") return targetHpPct <= 0.4 ? 2.0 : 1.3;
  if (skillName === "boss_cleave") return 1.35;
  if (skillName === "boss_mark") return 0.85;
  if (skillName === "boss_vuln") return 0.95;
  return 1.1;
}

async function grantSimpleLoot(args: {
  svc: ReturnType<typeof createClient>;
  seed: number;
  campaignId: string;
  combatSessionId: string;
  characterId: string;
  level: number;
  rarity: "magical" | "unique" | "legendary" | "mythic";
}) {
  const { svc, seed, campaignId, combatSessionId, characterId, level, rarity } = args;
  const namesA = ["Ash", "Iron", "Dread", "Storm", "Velvet", "Blood", "Wyrm", "Night"];
  const namesB = ["Edge", "Ward", "Pulse", "Maw", "Spur", "Bite", "Halo", "Crown"];
  const slot = rngPick(seed, `loot:${characterId}:slot`, ["weapon", "armor", "ring", "trinket"] as const);
  const name = `${rngPick(seed, `loot:${characterId}:a`, namesA)} ${rngPick(seed, `loot:${characterId}:b`, namesB)}`;
  const statMods: Record<string, number> = {
    offense: rngInt(seed, `loot:${characterId}:off`, 1, 8),
    defense: rngInt(seed, `loot:${characterId}:def`, 1, 8),
  };
  if (slot === "weapon") statMods.weapon_power = rngInt(seed, `loot:${characterId}:wp`, 2, 12);
  if (slot === "armor") statMods.armor_power = rngInt(seed, `loot:${characterId}:ap`, 2, 10);
  if (slot === "ring" || slot === "trinket") statMods.utility = rngInt(seed, `loot:${characterId}:ut`, 2, 10);

  const { data: item, error: itemErr } = await svc.schema("mythic").from("items").insert({
    campaign_id: campaignId,
    owner_character_id: characterId,
    rarity,
    item_type: "gear",
    slot,
    stat_mods: statMods,
    effects_json: {},
    drawback_json: rarity === "legendary" || rarity === "mythic"
      ? { id: "volatile_reverb", description: "Draws danger toward its bearer.", world_reaction: true }
      : {},
    narrative_hook: `${name} was torn from the fight while metal was still screaming.`,
    durability_json: { current: 100, max: 100, decay_per_use: 1 },
    required_level: Math.max(1, level - 1),
    item_power: Math.max(1, Math.floor(level * (rarity === "mythic" ? 3.4 : rarity === "legendary" ? 2.6 : 1.8))),
    drop_tier: rarity === "mythic" ? "mythic" : rarity === "legendary" ? "boss" : "elite",
    bind_policy: rarity === "magical" ? "unbound" : "bind_on_equip",
  }).select("id,name,slot,rarity").single();
  if (itemErr) throw itemErr;

  const { error: invErr } = await svc.schema("mythic").from("inventory").insert({
    character_id: characterId,
    item_id: item.id,
    container: "backpack",
    quantity: 1,
  });
  if (invErr) throw invErr;

  const { error: dropErr } = await svc.schema("mythic").from("loot_drops").insert({
    campaign_id: campaignId,
    combat_session_id: combatSessionId,
    source: "combat_tick",
    rarity,
    budget_points: rarity === "mythic" ? 60 : rarity === "legendary" ? 40 : 24,
    item_ids: [item.id],
    payload: { generated_by: "mythic-combat-tick" },
  });
  if (dropErr) throw dropErr;

  return item;
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(authToken);
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

    const { campaignId, combatSessionId, maxSteps } = parsed.data;
    const svc = createClient(supabaseUrl, serviceRoleKey);

    const { data: campaign, error: campaignErr } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignErr) throw campaignErr;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: member, error: memberErr } = await svc
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberErr) throw memberErr;
    if (!member && campaign.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized for this campaign" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let ticks = 0;
    let ended = false;
    let requiresPlayerAction = false;
    let finalTurnIndex = 0;
    let finalNextActor: string | null = null;

    while (ticks < maxSteps && !ended) {
      ticks += 1;

      const { data: session, error: sessionErr } = await svc
        .schema("mythic")
        .from("combat_sessions")
        .select("id, seed, status, current_turn_index")
        .eq("id", combatSessionId)
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (sessionErr) throw sessionErr;
      if (!session || session.status !== "active") break;

      const turnIndex = Number(session.current_turn_index ?? 0);
      finalTurnIndex = turnIndex;
      const seed = Number(session.seed ?? 0);

      const { data: orderRows, error: orderErr } = await svc
        .schema("mythic")
        .from("turn_order")
        .select("turn_index, combatant_id")
        .eq("combat_session_id", combatSessionId)
        .order("turn_index", { ascending: true });
      if (orderErr) throw orderErr;
      const order = (orderRows ?? []) as TurnRow[];
      if (!order.length) throw new Error("Turn order missing");
      const currentTurn = order.find((r) => r.turn_index === turnIndex);
      if (!currentTurn) throw new Error("Current turn is invalid");

      const { data: actor, error: actorErr } = await svc
        .schema("mythic")
        .from("combatants")
        .select("*")
        .eq("id", currentTurn.combatant_id)
        .eq("combat_session_id", combatSessionId)
        .maybeSingle<Combatant>();
      if (actorErr) throw actorErr;
      if (!actor) throw new Error("Turn actor not found");

      if (actor.entity_type === "player") {
        requiresPlayerAction = true;
        finalNextActor = actor.id;
        break;
      }

      await svc.rpc("mythic_resolve_status_tick", {
        combat_session_id: combatSessionId,
        combatant_id: actor.id,
        turn_index: turnIndex,
        phase: "start",
      });

      const { data: actorAfterTick, error: actorAfterTickErr } = await svc
        .schema("mythic")
        .from("combatants")
        .select("*")
        .eq("id", actor.id)
        .eq("combat_session_id", combatSessionId)
        .maybeSingle<Combatant>();
      if (actorAfterTickErr) throw actorAfterTickErr;
      if (!actorAfterTick || !actorAfterTick.is_alive) {
        const { data: aliveRows, error: aliveErr } = await svc
          .schema("mythic")
          .from("combatants")
          .select("id, is_alive")
          .eq("combat_session_id", combatSessionId);
        if (aliveErr) throw aliveErr;
        const aliveSet = new Set((aliveRows ?? []).filter((r: any) => r.is_alive).map((r: any) => r.id));
        const nextIndex = nextAliveTurnIndex(order, aliveSet, turnIndex);
        const nextActor = order[nextIndex]?.combatant_id ?? null;
        finalNextActor = nextActor;
        await svc.schema("mythic").from("combat_sessions").update({
          current_turn_index: nextIndex,
          updated_at: new Date().toISOString(),
        }).eq("id", combatSessionId);
        continue;
      }

      const { data: opponentsRows, error: opponentsErr } = await svc
        .schema("mythic")
        .from("combatants")
        .select("*")
        .eq("combat_session_id", combatSessionId)
        .eq("entity_type", "player")
        .eq("is_alive", true);
      if (opponentsErr) throw opponentsErr;
      const opponents = (opponentsRows ?? []) as Combatant[];
      if (!opponents.length) {
        ended = true;
        break;
      }

      const target = opponents[rngInt(seed, `tick:${turnIndex}:target`, 0, opponents.length - 1)]!;
      const targetHpPct = target.hp_max > 0 ? Number(target.hp) / Number(target.hp_max) : 0;

      let skillName = "Savage Swipe";
      let skillKey = "npc_swipe";
      let targets: Combatant[] = [target];

      const { data: bossRow } = await svc
        .schema("mythic")
        .from("boss_instances")
        .select("id,current_phase,enrage_turn,boss_templates(phases_json)")
        .eq("combat_session_id", combatSessionId)
        .eq("combatant_id", actorAfterTick.id)
        .maybeSingle();

      if (bossRow) {
        const phases = Array.isArray((bossRow as any)?.boss_templates?.phases_json)
          ? ((bossRow as any).boss_templates.phases_json as Array<Record<string, unknown>>)
          : [];
        const hpPct = actorAfterTick.hp_max > 0 ? Number(actorAfterTick.hp) / Number(actorAfterTick.hp_max) : 1;
        let nextPhase = Number((bossRow as any).current_phase ?? 1);
        for (const phaseRow of phases) {
          const p = Number(phaseRow.phase ?? 1);
          const threshold = Number(phaseRow.hp_below_pct ?? 1);
          if (Number.isFinite(p) && Number.isFinite(threshold) && hpPct <= threshold) {
            nextPhase = Math.max(nextPhase, p);
          }
        }
        if (nextPhase !== Number((bossRow as any).current_phase ?? 1)) {
          await svc.schema("mythic").from("boss_instances").update({
            current_phase: nextPhase,
            updated_at: new Date().toISOString(),
          }).eq("id", (bossRow as any).id);
          await appendEvent(svc, combatSessionId, turnIndex, actorAfterTick.id, "phase_shift", {
            combatant_id: actorAfterTick.id,
            phase: nextPhase,
            hp_pct: hpPct,
          });
        }

        const phaseRow = phases.find((row) => Number(row.phase ?? 1) === nextPhase) ?? phases[0] ?? {};
        const pool = Array.isArray(phaseRow.skill_pool) ? phaseRow.skill_pool.map((x) => String(x)) : [];
        skillKey = pickBossSkill(seed, `tick:${turnIndex}:boss`, pool);
        skillName = skillKey.replaceAll("_", " ");

        if (skillKey === "boss_cleave") {
          targets = opponents;
        }
      }

      await appendEvent(svc, combatSessionId, turnIndex, actorAfterTick.id, "skill_used", {
        skill_id: skillKey,
        skill_name: skillName,
        target_count: targets.length,
      });

      for (const t of targets) {
        const { data: dmgJson, error: dmgErr } = await svc.rpc("mythic_compute_damage", {
          seed,
          label: `tick:${combatSessionId}:turn:${turnIndex}:actor:${actorAfterTick.id}:target:${t.id}`,
          lvl: actorAfterTick.lvl,
          offense: actorAfterTick.offense,
          mobility: actorAfterTick.mobility,
          utility: actorAfterTick.utility,
          weapon_power: actorAfterTick.weapon_power ?? 0,
          skill_mult: skillMultFor(skillKey, targetHpPct),
          resist: Number(t.resist ?? 0) + Number(t.armor ?? 0),
          spread_pct: 0.1,
        });
        if (dmgErr) throw dmgErr;
        const roll = (dmgJson ?? {}) as Record<string, unknown>;
        const rawDamage = Math.max(0, Number(roll.final_damage ?? 0));
        const shield = Math.max(0, Number(t.armor ?? 0));
        const absorbed = Math.min(shield, rawDamage);
        const hpDelta = Math.max(0, rawDamage - absorbed);
        const nextArmor = shield - absorbed;
        const nextHp = Math.max(0, Number(t.hp ?? 0) - hpDelta);
        const died = nextHp <= 0.0001;

        const { error: updateTargetErr } = await svc
          .schema("mythic")
          .from("combatants")
          .update({
            armor: nextArmor,
            hp: nextHp,
            is_alive: died ? false : t.is_alive,
            updated_at: new Date().toISOString(),
          })
          .eq("id", t.id)
          .eq("combat_session_id", combatSessionId);
        if (updateTargetErr) throw updateTargetErr;

        await appendEvent(svc, combatSessionId, turnIndex, actorAfterTick.id, "damage", {
          source_combatant_id: actorAfterTick.id,
          target_combatant_id: t.id,
          roll,
          shield_absorbed: absorbed,
          damage_to_hp: hpDelta,
          hp_after: nextHp,
          armor_after: nextArmor,
        });

        if (skillKey === "boss_mark" || skillKey === "boss_vuln") {
          const { data: targetRow } = await svc
            .schema("mythic")
            .from("combatants")
            .select("statuses")
            .eq("id", t.id)
            .eq("combat_session_id", combatSessionId)
            .maybeSingle();
          const statusList = Array.isArray((targetRow as any)?.statuses) ? (targetRow as any).statuses : [];
          const nextStatuses = statusList.filter((s: any) => String(s?.id ?? "") !== "vulnerable");
          nextStatuses.push({
            id: "vulnerable",
            expires_turn: turnIndex + 2,
            stacks: 1,
            data: { source: skillKey },
          });
          await svc
            .schema("mythic")
            .from("combatants")
            .update({ statuses: nextStatuses, updated_at: new Date().toISOString() })
            .eq("id", t.id)
            .eq("combat_session_id", combatSessionId);
          await appendEvent(svc, combatSessionId, turnIndex, actorAfterTick.id, "status_applied", {
            target_combatant_id: t.id,
            status: { id: "vulnerable", duration_turns: 2 },
          });
        }

        if (died) {
          await appendEvent(svc, combatSessionId, turnIndex, actorAfterTick.id, "death", {
            target_combatant_id: t.id,
            by: { combatant_id: actorAfterTick.id, skill_id: skillKey },
          });
        }
      }

      await svc.rpc("mythic_resolve_status_tick", {
        combat_session_id: combatSessionId,
        combatant_id: actorAfterTick.id,
        turn_index: turnIndex,
        phase: "end",
      });

      const { data: aliveRows, error: aliveErr } = await svc
        .schema("mythic")
        .from("combatants")
        .select("id,entity_type,is_alive,character_id,lvl")
        .eq("combat_session_id", combatSessionId);
      if (aliveErr) throw aliveErr;

      const alivePlayers = (aliveRows ?? []).filter((r: any) => r.is_alive && r.entity_type === "player");
      const aliveNpcs = (aliveRows ?? []).filter((r: any) => r.is_alive && r.entity_type === "npc");

      if (alivePlayers.length === 0 || aliveNpcs.length === 0) {
        ended = true;
        await svc.rpc("mythic_end_combat_session", {
          combat_session_id: combatSessionId,
          outcome: { alive_players: alivePlayers.length, alive_npcs: aliveNpcs.length },
        });

        const won = alivePlayers.length > 0 && aliveNpcs.length === 0;
        const bossAlive = (aliveRows ?? []).some((r: any) => r.entity_type === "npc" && r.is_alive);
        const xpPer = won ? 180 + (aliveRows?.length ?? 0) * 35 + (bossAlive ? 0 : 220) : 0;

        if (won) {
          for (const p of alivePlayers) {
            if (!p.character_id) continue;
            const { data: xpResult } = await svc.rpc("mythic_apply_xp", {
              character_id: p.character_id,
              amount: xpPer,
              reason: "combat_settlement",
              metadata: { combat_session_id: combatSessionId },
            });
            await appendEvent(svc, combatSessionId, turnIndex, null, "xp_gain", {
              character_id: p.character_id,
              amount: xpPer,
              result: xpResult ?? null,
            });

            const rarity = xpPer > 420 ? "legendary" : xpPer > 280 ? "unique" : "magical";
            const lootItem = await grantSimpleLoot({
              svc,
              seed,
              campaignId,
              combatSessionId,
              characterId: p.character_id,
              level: Math.max(1, Number(p.lvl ?? 1)),
              rarity,
            });
            await appendEvent(svc, combatSessionId, turnIndex, null, "loot_drop", {
              character_id: p.character_id,
              item_id: lootItem.id,
              rarity: lootItem.rarity,
              name: lootItem.name,
            });
          }
        }

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
            payload_json: { combat_session_id: combatSessionId, outcome: { won } },
          });
        }

        await appendEvent(svc, combatSessionId, turnIndex, null, "combat_end", {
          alive_players: alivePlayers.length,
          alive_npcs: aliveNpcs.length,
          won,
        });
        finalNextActor = null;
        break;
      }

      const aliveSet = new Set((aliveRows ?? []).filter((r: any) => r.is_alive).map((r: any) => r.id));
      const nextIndex = nextAliveTurnIndex(order, aliveSet, turnIndex);
      const nextActorId = order[nextIndex]?.combatant_id ?? null;
      finalTurnIndex = nextIndex;
      finalNextActor = nextActorId;

      await svc.schema("mythic").from("combat_sessions").update({
        current_turn_index: nextIndex,
        updated_at: new Date().toISOString(),
      }).eq("id", combatSessionId);

      await appendEvent(svc, combatSessionId, turnIndex, actorAfterTick.id, "turn_end", { actor_combatant_id: actorAfterTick.id });
      if (nextActorId) {
        await appendEvent(svc, combatSessionId, nextIndex, nextActorId, "turn_start", { actor_combatant_id: nextActorId });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      ticks,
      ended,
      requires_player_action: requiresPlayerAction,
      current_turn_index: finalTurnIndex,
      next_actor_combatant_id: finalNextActor,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-combat-tick error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to tick combat" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
