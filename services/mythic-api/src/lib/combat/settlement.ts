import { rngInt, rngPick } from "../../shared/mythic_rng.js";
import { sanitizeError } from "../../shared/redact.js";
import { createServiceClient } from "../../shared/supabase.js";
import type { FunctionLogger } from "../../functions/types.js";

type ServiceClient = ReturnType<typeof createServiceClient>;

type FactionSummary = {
  id: string;
  name: string;
  tags: string[];
};

export type CombatSettlementRow = {
  id: string;
  entity_type: "player" | "npc" | "summon";
  is_alive: boolean;
  character_id: string | null;
  player_id: string | null;
  lvl?: number | null;
};

type SettlementArgs = {
  svc: ServiceClient;
  campaignId: string;
  combatSessionId: string;
  turnIndex: number;
  seed: number;
  aliveRows: CombatSettlementRow[];
  source: "combat_tick" | "combat_use_skill";
  requestId: string;
  logger?: FunctionLogger;
  appendActionEvent?: (
    eventType: string,
    payload: Record<string, unknown>,
    actorCombatantId?: string | null,
    eventTurnIndex?: number,
  ) => Promise<void>;
};

export type SettlementResult = {
  won: boolean;
  alive_players: number;
  alive_npcs: number;
  xp_per: number;
};

const clampInt = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.floor(value)));

async function appendMemoryEvent(args: {
  svc: ServiceClient;
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
  svc: ServiceClient;
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

  const currentRep = Number((currentRepQuery.data as { rep?: number } | null)?.rep ?? 0);
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

async function hasXpAwardForCombat(
  svc: ServiceClient,
  characterId: string,
  combatSessionId: string,
): Promise<boolean> {
  const query = await svc
    .schema("mythic")
    .from("progression_events")
    .select("id,payload")
    .eq("character_id", characterId)
    .eq("event_type", "xp_applied")
    .order("created_at", { ascending: false })
    .limit(40);
  if (query.error) throw query.error;
  return (query.data ?? []).some((row) => {
    if (!row || typeof row !== "object") return false;
    const payload = (row as { payload?: unknown }).payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const metadata = (payload as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    return (metadata as { combat_session_id?: unknown }).combat_session_id === combatSessionId;
  });
}

async function hasLootAwardForCombat(
  svc: ServiceClient,
  characterId: string,
  combatSessionId: string,
): Promise<boolean> {
  const query = await svc
    .schema("mythic")
    .from("loot_drops")
    .select("id,payload")
    .eq("combat_session_id", combatSessionId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (query.error) throw query.error;
  return (query.data ?? []).some((row) => {
    if (!row || typeof row !== "object") return false;
    const payload = (row as { payload?: unknown }).payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    return (payload as { character_id?: unknown }).character_id === characterId;
  });
}

async function grantSimpleLoot(args: {
  svc: ServiceClient;
  seed: number;
  campaignId: string;
  combatSessionId: string;
  characterId: string;
  level: number;
  rarity: "magical" | "unique" | "legendary" | "mythic";
  source: "combat_tick" | "combat_use_skill";
}) {
  const { svc, seed, campaignId, combatSessionId, characterId, level, rarity, source } = args;

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
    name,
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
    item_id: (item as { id: string }).id,
    container: "backpack",
    quantity: 1,
  });
  if (invErr) throw invErr;

  const { error: dropErr } = await svc.schema("mythic").from("loot_drops").insert({
    campaign_id: campaignId,
    combat_session_id: combatSessionId,
    source,
    rarity,
    budget_points: rarity === "mythic" ? 60 : rarity === "legendary" ? 40 : 24,
    item_ids: [(item as { id: string }).id],
    payload: {
      character_id: characterId,
      generated_by: source === "combat_tick" ? "mythic-combat-tick" : "mythic-combat-use-skill",
    },
  });
  if (dropErr) throw dropErr;

  return item as { id: string; name: string; rarity: string };
}

async function getFactions(svc: ServiceClient, campaignId: string): Promise<FactionSummary[]> {
  const query = await svc
    .schema("mythic")
    .from("factions")
    .select("id,name,tags")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (query.error) throw query.error;
  return (query.data ?? [])
    .filter((row): row is { id: string; name: string; tags: unknown } => typeof row.id === "string" && typeof row.name === "string")
    .map((row) => ({
      id: row.id,
      name: row.name,
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    }));
}

export async function settleCombat(args: SettlementArgs): Promise<SettlementResult> {
  const {
    svc,
    campaignId,
    combatSessionId,
    turnIndex,
    seed,
    aliveRows,
    source,
    logger,
    requestId,
    appendActionEvent,
  } = args;

  const alivePlayers = aliveRows.filter((row) => row.is_alive && row.entity_type === "player");
  const aliveNpcs = aliveRows.filter((row) => row.is_alive && row.entity_type === "npc");
  const playerRowsAll = aliveRows.filter((row) => row.entity_type === "player" && typeof row.player_id === "string");
  const won = alivePlayers.length > 0 && aliveNpcs.length === 0;

  await svc.rpc("mythic_end_combat_session", {
    combat_session_id: combatSessionId,
    outcome: { alive_players: alivePlayers.length, alive_npcs: aliveNpcs.length },
  });

  const factionPool = await getFactions(svc, campaignId);
  const primaryFaction = factionPool[0] ?? null;
  const bossAlive = aliveRows.some((row) => row.entity_type === "npc" && row.is_alive);
  const xpPer = won ? 180 + aliveRows.length * 35 + (bossAlive ? 0 : 220) : 0;
  let xpAwardedTotal = 0;
  const lootNames: string[] = [];

  if (won) {
    for (const player of alivePlayers) {
      if (!player.character_id) continue;
      const characterId = player.character_id;
      const playerId = typeof player.player_id === "string" ? player.player_id : null;
      const level = Math.max(1, Number(player.lvl ?? 1));

      let awardedXp = false;
      let lootItem: { id: string; name: string; rarity: string } | null = null;

      if (!(await hasXpAwardForCombat(svc, characterId, combatSessionId))) {
        const { data: xpResult } = await svc.rpc("mythic_apply_xp", {
          character_id: characterId,
          amount: xpPer,
          reason: "combat_settlement",
          metadata: { combat_session_id: combatSessionId },
        });
        awardedXp = true;
        xpAwardedTotal += xpPer;
        if (appendActionEvent) {
          await appendActionEvent("xp_gain", {
            character_id: characterId,
            amount: xpPer,
            result: xpResult ?? null,
          }, null, turnIndex);
        }
      }

      if (!(await hasLootAwardForCombat(svc, characterId, combatSessionId))) {
        const rarity = xpPer > 420 ? "legendary" : xpPer > 280 ? "unique" : "magical";
        lootItem = await grantSimpleLoot({
          svc,
          seed,
          campaignId,
          combatSessionId,
          characterId,
          level,
          rarity,
          source,
        });
        if (lootItem?.name) {
          lootNames.push(lootItem.name);
        }
        if (appendActionEvent) {
          await appendActionEvent("loot_drop", {
            character_id: characterId,
            item_id: lootItem.id,
            rarity: lootItem.rarity,
            name: lootItem.name,
          }, null, turnIndex);
        }
      }

      if (!primaryFaction || !playerId || (!awardedXp && !lootItem)) continue;
      try {
        await applyReputationDelta({
          svc,
          campaignId,
          playerId,
          factionId: primaryFaction.id,
          delta: 6,
          severity: 2,
          evidence: {
            reason: "combat_victory",
            combat_session_id: combatSessionId,
            xp_awarded: xpPer,
            loot_item_id: lootItem?.id ?? null,
          },
        });
        await appendMemoryEvent({
          svc,
          campaignId,
          playerId,
          category: "quest_thread",
          severity: 2,
          payload: {
            type: "combat_victory",
            combat_session_id: combatSessionId,
            xp_awarded: xpPer,
            loot_item_id: lootItem?.id ?? null,
            faction_id: primaryFaction.id,
            faction_name: primaryFaction.name,
          },
        });
      } catch (persistError) {
        logger?.warn("combat_settlement.persistence_warning", {
          request_id: requestId,
          campaign_id: campaignId,
          combat_session_id: combatSessionId,
          reason: sanitizeError(persistError).message,
        });
      }
    }
  } else {
    for (const playerRow of playerRowsAll) {
      const playerId = playerRow.player_id;
      if (!playerId) continue;
      try {
        await appendMemoryEvent({
          svc,
          campaignId,
          playerId,
          category: "quest_thread",
          severity: 3,
          payload: {
            type: "combat_setback",
            combat_session_id: combatSessionId,
            survived: Boolean(playerRow.is_alive),
          },
        });
        if (primaryFaction) {
          await applyReputationDelta({
            svc,
            campaignId,
            playerId,
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
        logger?.warn("combat_settlement.persistence_warning", {
          request_id: requestId,
          campaign_id: campaignId,
          combat_session_id: combatSessionId,
          reason: sanitizeError(persistError).message,
        });
      }
    }
  }

  const runtimeQuery = await svc
    .schema("mythic")
    .from("campaign_runtime")
    .select("id,mode,state_json")
    .eq("campaign_id", campaignId)
    .eq("status", "active")
    .maybeSingle();
  if (runtimeQuery.error) throw runtimeQuery.error;

  const runtimeRow = runtimeQuery.data as { id: string; mode: string; state_json: Record<string, unknown> } | null;
  if (runtimeRow) {
    const rawState = runtimeRow.state_json && typeof runtimeRow.state_json === "object"
      ? runtimeRow.state_json
      : {};
    const returnModeRaw = typeof rawState.return_mode === "string" ? rawState.return_mode : null;
    const fallbackMode = runtimeRow.mode === "combat" ? "town" : runtimeRow.mode;
    const nextMode = returnModeRaw === "town" || returnModeRaw === "travel" || returnModeRaw === "dungeon" || returnModeRaw === "combat"
      ? returnModeRaw
      : (fallbackMode === "town" || fallbackMode === "travel" || fallbackMode === "dungeon" || fallbackMode === "combat"
        ? fallbackMode
        : "town");
    const resolvedReturnMode = nextMode === "combat" ? "town" : nextMode;
    const nextState = {
      ...rawState,
      combat_session_id: null,
      return_mode: resolvedReturnMode,
      combat_resolution: {
        pending: true,
        combat_session_id: combatSessionId,
        return_mode: resolvedReturnMode,
        won,
        xp_gained: Math.max(0, Math.floor(xpAwardedTotal)),
        loot: lootNames.slice(0, 8),
        ended_at: new Date().toISOString(),
      },
    };

    const runtimeUpdate = await svc
      .schema("mythic")
      .from("campaign_runtime")
      .update({
        mode: "combat",
        combat_session_id: null,
        state_json: nextState,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runtimeRow.id);
    if (runtimeUpdate.error) throw runtimeUpdate.error;
  }

  if (appendActionEvent) {
    await appendActionEvent("combat_end", {
      alive_players: alivePlayers.length,
      alive_npcs: aliveNpcs.length,
      won,
    }, null, turnIndex);
  }

  return {
    won,
    alive_players: alivePlayers.length,
    alive_npcs: aliveNpcs.length,
    xp_per: xpPer,
  };
}
