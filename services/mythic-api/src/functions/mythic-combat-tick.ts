import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { rngInt, rngPick } from "../shared/mythic_rng.js";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

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

const clampInt = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.floor(value)));

async function appendEvent(
  svc: ReturnType<typeof createServiceClient>,
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
  svc: ReturnType<typeof createServiceClient>;
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
    item_id: (item as any).id,
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
    item_ids: [(item as any).id],
    payload: { generated_by: "mythic-combat-tick" },
  });
  if (dropErr) throw dropErr;

  return item as any;
}

async function appendMemoryEvent(args: {
  svc: ReturnType<typeof createServiceClient>;
  campaignId: string;
  playerId: string;
  category: string;
  severity: number;
  payload: Record<string, unknown>;
}) {
  const { error } = await args.svc.schema("mythic").from("dm_memory_events").insert({
    campaign_id: args.campaignId,
    player_id: args.playerId,
    category: args.category,
    severity: clampInt(args.severity, 1, 5),
    payload: args.payload,
  });
  if (error) throw error;
}

async function applyReputationDelta(args: {
  svc: ReturnType<typeof createServiceClient>;
  campaignId: string;
  playerId: string;
  factionId: string;
  delta: number;
  severity: number;
  evidence: Record<string, unknown>;
}) {
  if (args.delta === 0) return;
  const { error: repEventError } = await args.svc.schema("mythic").from("reputation_events").insert({
    campaign_id: args.campaignId,
    faction_id: args.factionId,
    player_id: args.playerId,
    severity: clampInt(args.severity, 1, 5),
    delta: clampInt(args.delta, -1000, 1000),
    evidence: args.evidence,
  });
  if (repEventError) throw repEventError;

  const currentRepQuery = await args.svc
    .schema("mythic")
    .from("faction_reputation")
    .select("rep")
    .eq("campaign_id", args.campaignId)
    .eq("faction_id", args.factionId)
    .eq("player_id", args.playerId)
    .maybeSingle();
  if (currentRepQuery.error) throw currentRepQuery.error;
  const currentRep = Number((currentRepQuery.data as any)?.rep ?? 0);
  const nextRep = clampInt(currentRep + args.delta, -1000, 1000);
  const { error: upsertError } = await args.svc
    .schema("mythic")
    .from("faction_reputation")
    .upsert({
      campaign_id: args.campaignId,
      faction_id: args.factionId,
      player_id: args.playerId,
      rep: nextRep,
      updated_at: new Date().toISOString(),
    }, { onConflict: "campaign_id,faction_id,player_id" });
  if (upsertError) throw upsertError;
}

export const mythicCombatTick: FunctionHandler = {
  name: "mythic-combat-tick",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;
    const baseHeaders = { "Content-Type": "application/json", "x-request-id": requestId };

    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-combat-tick",
      limit: 80,
      windowMs: 60_000,
      corsHeaders: {},
      requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      const user = await requireUser(req.headers);

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
          status: 400,
          headers: baseHeaders,
        });
      }

      const { campaignId, combatSessionId, maxSteps } = parsed.data;
      const svc = createServiceClient();

      const idempotencyHeader = idempotencyKeyFromRequest(req);
      const idempotencyKey = idempotencyHeader ? `${user.userId}:${idempotencyHeader}` : null;
      if (idempotencyKey) {
        const cached = getIdempotentResponse(idempotencyKey);
        if (cached) {
          ctx.log.info("combat_tick.idempotent_hit", { request_id: requestId, campaign_id: campaignId, combat_session_id: combatSessionId });
          return cached;
        }
      }

      await assertCampaignAccess(svc, campaignId, user.userId);

      const factionPoolQuery = await svc
        .schema("mythic")
        .from("factions")
        .select("id,name,tags")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true });
      const factionPool = (factionPoolQuery.data ?? [])
        .filter((row: any) => typeof row.id === "string")
        .map((row: any) => ({
          id: String(row.id),
          name: typeof row.name === "string" ? row.name : "Faction",
          tags: Array.isArray(row.tags) ? row.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [],
        }));

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
        if (!session || (session as any).status !== "active") break;

        const turnIndex = Number((session as any).current_turn_index ?? 0);
        finalTurnIndex = turnIndex;
        const seed = Number((session as any).seed ?? 0);

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

        if ((actor as any).entity_type === "player") {
          requiresPlayerAction = true;
          finalNextActor = (actor as any).id;
          break;
        }

        await svc.rpc("mythic_resolve_status_tick", {
          combat_session_id: combatSessionId,
          combatant_id: (actor as any).id,
          turn_index: turnIndex,
          phase: "start",
        });

        const { data: actorAfterTick, error: actorAfterTickErr } = await svc
          .schema("mythic")
          .from("combatants")
          .select("*")
          .eq("id", (actor as any).id)
          .eq("combat_session_id", combatSessionId)
          .maybeSingle<Combatant>();
        if (actorAfterTickErr) throw actorAfterTickErr;
        if (!actorAfterTick || !(actorAfterTick as any).is_alive) {
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
        const targetHpPct = (target as any).hp_max > 0 ? Number((target as any).hp) / Number((target as any).hp_max) : 0;

        let skillName = "Savage Swipe";
        let skillKey = "npc_swipe";
        let targets: Combatant[] = [target];

        const { data: bossRow } = await svc
          .schema("mythic")
          .from("boss_instances")
          .select("id,current_phase,enrage_turn,boss_templates(phases_json)")
          .eq("combat_session_id", combatSessionId)
          .eq("combatant_id", (actorAfterTick as any).id)
          .maybeSingle();

        if (bossRow) {
          const phases = Array.isArray((bossRow as any)?.boss_templates?.phases_json)
            ? ((bossRow as any).boss_templates.phases_json as Array<Record<string, unknown>>)
            : [];
          const hpPct = (actorAfterTick as any).hp_max > 0 ? Number((actorAfterTick as any).hp) / Number((actorAfterTick as any).hp_max) : 1;
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
            await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "phase_shift", {
              combatant_id: (actorAfterTick as any).id,
              phase: nextPhase,
              hp_pct: hpPct,
            });
          }

          const phaseRow = phases.find((row) => Number(row.phase ?? 1) === nextPhase) ?? phases[0] ?? {};
          const pool = Array.isArray((phaseRow as any).skill_pool) ? (phaseRow as any).skill_pool.map((x: unknown) => String(x)) : [];
          skillKey = pickBossSkill(seed, `tick:${turnIndex}:boss`, pool);
          skillName = skillKey.replaceAll("_", " ");

          if (skillKey === "boss_cleave") {
            targets = opponents;
          }
        }

        await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "skill_used", {
          skill_id: skillKey,
          skill_name: skillName,
          target_count: targets.length,
        });

        for (const t of targets) {
          const { data: dmgJson, error: dmgErr } = await svc.rpc("mythic_compute_damage", {
            seed,
            label: `tick:${combatSessionId}:turn:${turnIndex}:actor:${(actorAfterTick as any).id}:target:${(t as any).id}`,
            lvl: (actorAfterTick as any).lvl,
            offense: (actorAfterTick as any).offense,
            mobility: (actorAfterTick as any).mobility,
            utility: (actorAfterTick as any).utility,
            weapon_power: (actorAfterTick as any).weapon_power ?? 0,
            skill_mult: skillMultFor(skillKey, targetHpPct),
            resist: Number((t as any).resist ?? 0) + Number((t as any).armor ?? 0),
            spread_pct: 0.1,
          });
          if (dmgErr) throw dmgErr;
          const roll = (dmgJson ?? {}) as Record<string, unknown>;
          const rawDamage = Math.max(0, Number((roll as any).final_damage ?? 0));
          const shield = Math.max(0, Number((t as any).armor ?? 0));
          const absorbed = Math.min(shield, rawDamage);
          const hpDelta = Math.max(0, rawDamage - absorbed);
          const nextArmor = shield - absorbed;
          const nextHp = Math.max(0, Number((t as any).hp ?? 0) - hpDelta);
          const died = nextHp <= 0.0001;

          const { error: updateTargetErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({
              armor: nextArmor,
              hp: nextHp,
              is_alive: died ? false : (t as any).is_alive,
              updated_at: new Date().toISOString(),
            })
            .eq("id", (t as any).id)
            .eq("combat_session_id", combatSessionId);
          if (updateTargetErr) throw updateTargetErr;

          await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "damage", {
            source_combatant_id: (actorAfterTick as any).id,
            target_combatant_id: (t as any).id,
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
              .eq("id", (t as any).id)
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
              .eq("id", (t as any).id)
              .eq("combat_session_id", combatSessionId);
            await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "status_applied", {
              target_combatant_id: (t as any).id,
              status: { id: "vulnerable", duration_turns: 2 },
            });
          }

          if (died) {
            await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "death", {
              target_combatant_id: (t as any).id,
              by: { combatant_id: (actorAfterTick as any).id, skill_id: skillKey },
            });
          }
        }

        await svc.rpc("mythic_resolve_status_tick", {
          combat_session_id: combatSessionId,
          combatant_id: (actorAfterTick as any).id,
          turn_index: turnIndex,
          phase: "end",
        });

        const { data: aliveRows, error: aliveErr } = await svc
          .schema("mythic")
          .from("combatants")
          .select("id,entity_type,is_alive,character_id,player_id,lvl")
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
          const playerRowsAll = (aliveRows ?? []).filter((r: any) => r.entity_type === "player" && typeof r.player_id === "string");
          const primaryFaction = factionPool[0] ?? null;

          if (won) {
            for (const p of alivePlayers) {
              if (!(p as any).character_id) continue;
              const { data: xpResult } = await svc.rpc("mythic_apply_xp", {
                character_id: (p as any).character_id,
                amount: xpPer,
                reason: "combat_settlement",
                metadata: { combat_session_id: combatSessionId },
              });
              await appendEvent(svc, combatSessionId, turnIndex, null, "xp_gain", {
                character_id: (p as any).character_id,
                amount: xpPer,
                result: xpResult ?? null,
              });

              const rarity = xpPer > 420 ? "legendary" : xpPer > 280 ? "unique" : "magical";
              const lootItem = await grantSimpleLoot({
                svc,
                seed,
                campaignId,
                combatSessionId,
                characterId: (p as any).character_id,
                level: Math.max(1, Number((p as any).lvl ?? 1)),
                rarity,
              });
              await appendEvent(svc, combatSessionId, turnIndex, null, "loot_drop", {
                character_id: (p as any).character_id,
                item_id: lootItem.id,
                rarity: lootItem.rarity,
                name: lootItem.name,
              });

              if (primaryFaction && typeof (p as any).player_id === "string") {
                try {
                  await applyReputationDelta({
                    svc,
                    campaignId,
                    playerId: String((p as any).player_id),
                    factionId: primaryFaction.id,
                    delta: 6,
                    severity: 2,
                    evidence: {
                      reason: "combat_victory",
                      combat_session_id: combatSessionId,
                      xp_awarded: xpPer,
                      loot_item_id: lootItem.id,
                    },
                  });
                  await appendMemoryEvent({
                    svc,
                    campaignId,
                    playerId: String((p as any).player_id),
                    category: "quest_thread",
                    severity: 2,
                    payload: {
                      type: "combat_victory",
                      combat_session_id: combatSessionId,
                      xp_awarded: xpPer,
                      loot_item_id: lootItem.id,
                      faction_id: primaryFaction.id,
                      faction_name: primaryFaction.name,
                    },
                  });
                } catch (persistError) {
                  ctx.log.warn("combat_tick.persistence_warning", {
                    request_id: requestId,
                    campaign_id: campaignId,
                    combat_session_id: combatSessionId,
                    reason: sanitizeError(persistError).message,
                  });
                }
              }
            }
          } else {
            for (const playerRow of playerRowsAll) {
              try {
                await appendMemoryEvent({
                  svc,
                  campaignId,
                  playerId: String((playerRow as any).player_id),
                  category: "quest_thread",
                  severity: 3,
                  payload: {
                    type: "combat_setback",
                    combat_session_id: combatSessionId,
                    survived: Boolean((playerRow as any).is_alive),
                  },
                });
                if (primaryFaction) {
                  await applyReputationDelta({
                    svc,
                    campaignId,
                    playerId: String((playerRow as any).player_id),
                    factionId: primaryFaction.id,
                    delta: -4,
                    severity: 2,
                    evidence: {
                      reason: "combat_loss",
                      combat_session_id: combatSessionId,
                    },
                  });
                }
              } catch (persistError) {
                ctx.log.warn("combat_tick.persistence_warning", {
                  request_id: requestId,
                  campaign_id: campaignId,
                  combat_session_id: combatSessionId,
                  reason: sanitizeError(persistError).message,
                });
              }
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

        await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "turn_end", { actor_combatant_id: (actorAfterTick as any).id });
        if (nextActorId) {
          await appendEvent(svc, combatSessionId, nextIndex, nextActorId, "turn_start", { actor_combatant_id: nextActorId });
        }
      }

      const response = new Response(JSON.stringify({
        ok: true,
        ticks,
        ended,
        requires_player_action: requiresPlayerAction,
        current_turn_index: finalTurnIndex,
        next_actor_combatant_id: finalNextActor,
      }), {
        status: 200,
        headers: baseHeaders,
      });
      if (idempotencyKey) {
        storeIdempotentResponse(idempotencyKey, response, 15_000);
      }

      ctx.log.info("combat_tick.success", {
        request_id: requestId,
        campaign_id: campaignId,
        combat_session_id: combatSessionId,
        ticks,
        ended,
        requires_player_action: requiresPlayerAction,
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
      ctx.log.error("combat_tick.failed", { request_id: requestId, error: normalized.message, code: normalized.code });
      return new Response(JSON.stringify({ error: normalized.message || "Failed to tick combat", code: normalized.code ?? "combat_tick_failed", requestId }), {
        status: 500,
        headers: baseHeaders,
      });
    }
  },
};

