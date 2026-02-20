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
import { settleCombat } from "../lib/combat/settlement.js";
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
  if (skillName === "basic_attack") return 1.0;
  return 1.1;
}

function isAllyTeamMember(combatant: Combatant): boolean {
  return typeof combatant.player_id === "string" && combatant.player_id.trim().length > 0;
}

function sameTeam(a: Combatant, b: Combatant): boolean {
  return isAllyTeamMember(a) === isAllyTeamMember(b);
}

function hpPercentOf(c: Combatant): number {
  if (Number(c.hp_max) <= 0) return 1;
  return Math.max(0, Math.min(1, Number(c.hp) / Number(c.hp_max)));
}

function tileDistance(a: Combatant, b: Combatant): number {
  return Math.abs(Number(a.x) - Number(b.x)) + Math.abs(Number(a.y) - Number(b.y));
}

function pickPrimaryTarget(args: {
  actor: Combatant;
  opponents: Combatant[];
  seed: number;
  label: string;
}): Combatant {
  const ranked = [...args.opponents].sort((left, right) => {
    const hpDelta = hpPercentOf(left) - hpPercentOf(right);
    if (Math.abs(hpDelta) > 0.001) return hpDelta;
    const distDelta = tileDistance(args.actor, left) - tileDistance(args.actor, right);
    if (distDelta !== 0) return distDelta;
    return String(left.id).localeCompare(String(right.id));
  });
  const top = ranked.slice(0, Math.min(2, ranked.length));
  if (top.length === 1) return top[0]!;
  const pick = rngInt(args.seed, `${args.label}:target_pick`, 0, top.length - 1);
  return top[pick]!;
}

function companionSkillPlan(args: {
  actor: Combatant;
  primaryTarget: Combatant;
  opponents: Combatant[];
}): { skillKey: string; skillName: string; targets: Combatant[] } {
  const hpPct = hpPercentOf(args.actor);
  const mpPct = Number(args.actor.power_max) > 0
    ? Math.max(0, Math.min(1, Number(args.actor.power) / Number(args.actor.power_max)))
    : 1;

  if (hpPct <= 0.35) {
    return {
      skillKey: "basic_defend",
      skillName: "Defend",
      targets: [args.actor],
    };
  }

  if (mpPct <= 0.3 && Number(args.actor.power_max) > 0) {
    return {
      skillKey: "basic_recover_mp",
      skillName: "Recover MP",
      targets: [args.actor],
    };
  }

  return {
    skillKey: "basic_attack",
    skillName: "Attack",
    targets: [args.primaryTarget],
  };
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

        if ((actor as any).entity_type === "player" && (actor as any).player_id === user.userId) {
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

        const { data: livingRows, error: livingErr } = await svc
          .schema("mythic")
          .from("combatants")
          .select("*")
          .eq("combat_session_id", combatSessionId)
          .eq("is_alive", true);
        if (livingErr) throw livingErr;
        const living = (livingRows ?? []) as Combatant[];
        const opponents = living.filter((entry) => !sameTeam(actorAfterTick, entry));
        if (!opponents.length) {
          ended = true;
          break;
        }

        const primaryTarget = pickPrimaryTarget({
          actor: actorAfterTick,
          opponents,
          seed,
          label: `tick:${turnIndex}`,
        });
        const targetHpPct = hpPercentOf(primaryTarget);

        let skillName = "Savage Swipe";
        let skillKey = "npc_swipe";
        let targets: Combatant[] = [primaryTarget];

        const isCompanionTurn = (actorAfterTick as any).entity_type === "summon" && isAllyTeamMember(actorAfterTick);
        if (isCompanionTurn) {
          const plan = companionSkillPlan({
            actor: actorAfterTick,
            primaryTarget,
            opponents,
          });
          skillKey = plan.skillKey;
          skillName = plan.skillName;
          targets = plan.targets;
        } else {
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
        }

        await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "skill_used", {
          skill_id: skillKey,
          skill_name: skillName,
          target_count: targets.length,
        });

        if (skillKey === "basic_defend") {
          const armorGain = Math.max(4, Math.floor(Number((actorAfterTick as any).defense) * 0.22) + Math.floor(Number((actorAfterTick as any).support) * 0.12));
          const nextArmor = Math.max(0, Number((actorAfterTick as any).armor ?? 0) + armorGain);
          const currentStatuses = Array.isArray((actorAfterTick as any).statuses) ? (actorAfterTick as any).statuses : [];
          const nextStatuses = currentStatuses.filter((status: any) => {
            const id = String(status?.id ?? "");
            return id !== "barrier" && id !== "guard";
          });
          nextStatuses.push({
            id: "barrier",
            expires_turn: turnIndex + 1,
            stacks: 1,
            data: { amount: armorGain, source: skillKey },
          });
          nextStatuses.push({
            id: "guard",
            expires_turn: turnIndex + 1,
            stacks: 1,
            data: { amount: armorGain, source: skillKey },
          });
          const { error: updateErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({
              armor: nextArmor,
              statuses: nextStatuses,
              updated_at: new Date().toISOString(),
            })
            .eq("id", (actorAfterTick as any).id)
            .eq("combat_session_id", combatSessionId);
          if (updateErr) throw updateErr;

          await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "status_applied", {
            target_combatant_id: (actorAfterTick as any).id,
            status: { id: "barrier", amount: armorGain, duration_turns: 1 },
          });
          await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "status_applied", {
            target_combatant_id: (actorAfterTick as any).id,
            status: { id: "guard", amount: armorGain, duration_turns: 1 },
          });
        } else if (skillKey === "basic_recover_mp") {
          const recoverAmount = Math.max(6, Math.floor(Number((actorAfterTick as any).utility) * 0.18) + Math.floor(Number((actorAfterTick as any).support) * 0.12));
          const beforePower = Math.max(0, Number((actorAfterTick as any).power ?? 0));
          const nextPower = Math.min(Math.max(0, Number((actorAfterTick as any).power_max ?? 0)), beforePower + recoverAmount);
          const gained = Math.max(0, nextPower - beforePower);
          const { error: recoverErr } = await svc
            .schema("mythic")
            .from("combatants")
            .update({
              power: nextPower,
              updated_at: new Date().toISOString(),
            })
            .eq("id", (actorAfterTick as any).id)
            .eq("combat_session_id", combatSessionId);
          if (recoverErr) throw recoverErr;
          await appendEvent(svc, combatSessionId, turnIndex, (actorAfterTick as any).id, "power_gain", {
            target_combatant_id: (actorAfterTick as any).id,
            amount: gained,
            power_after: nextPower,
          });
        } else {
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
          await settleCombat({
            svc,
            campaignId,
            combatSessionId,
            turnIndex,
            seed,
            source: "combat_tick",
            requestId,
            logger: ctx.log,
            aliveRows: (aliveRows ?? []).map((row: any) => ({
              id: String(row.id),
              entity_type: row.entity_type === "npc" || row.entity_type === "summon" ? row.entity_type : "player",
              is_alive: Boolean(row.is_alive),
              character_id: typeof row.character_id === "string" ? row.character_id : null,
              player_id: typeof row.player_id === "string" ? row.player_id : null,
              lvl: typeof row.lvl === "number" ? row.lvl : null,
            })),
            appendActionEvent: async (eventType, payload, actorId, eventTurnIndex) => {
              await appendEvent(
                svc,
                combatSessionId,
                eventTurnIndex ?? turnIndex,
                actorId ?? null,
                eventType,
                payload,
              );
            },
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
