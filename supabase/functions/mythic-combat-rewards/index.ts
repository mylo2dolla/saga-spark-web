import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  combatSessionId: z.string().uuid(),
});

type CombatSessionRow = {
  id: string;
  seed: number;
  status: string;
  current_turn_index: number;
};

type CombatantRow = {
  id: string;
  character_id: string | null;
  entity_type: "player" | "npc" | "summon";
  player_id: string | null;
  is_alive: boolean;
};

type CharacterRow = Record<string, unknown> & {
  id: string;
  campaign_id: string;
  resources: unknown;
};

type RewardEventRow = {
  payload: Record<string, unknown>;
};

type GrantedLootRow = {
  id: string;
  name: string;
  rarity: string;
  slot: string;
  item_power: number;
};

type Rarity = "common" | "magical" | "unique" | "legendary" | "mythic" | "unhinged";
type Slot =
  | "weapon"
  | "offhand"
  | "armor"
  | "helm"
  | "gloves"
  | "boots"
  | "belt"
  | "amulet"
  | "ring"
  | "trinket"
  | "consumable"
  | "other";

interface RewardSummary {
  xp_gained: number;
  level_before: number;
  level_after: number;
  level_ups: number;
  xp_after: number;
  xp_to_next: number;
  loot: Array<{
    item_id: string;
    name: string;
    rarity: string;
    slot: string;
    item_power: number;
  }>;
  outcome: {
    defeated_npcs: number;
    surviving_players: number;
    surviving_npcs: number;
    player_alive: boolean;
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function roll(seed: number, label: string): number {
  return (hashString(`${seed}:${label}`) % 10_000) / 10_000;
}

function xpToNextLevel(level: number): number {
  return 140 + level * 110;
}

function pickRarity(value: number): Rarity {
  if (value < 0.55) return "common";
  if (value < 0.82) return "magical";
  if (value < 0.94) return "unique";
  if (value < 0.985) return "legendary";
  if (value < 0.998) return "mythic";
  return "unhinged";
}

function rarityRank(rarity: Rarity): number {
  switch (rarity) {
    case "common":
      return 0;
    case "magical":
      return 1;
    case "unique":
      return 2;
    case "legendary":
      return 3;
    case "mythic":
      return 4;
    case "unhinged":
      return 5;
  }
}

function pickSlot(value: number): Slot {
  const slots: Slot[] = [
    "weapon",
    "offhand",
    "armor",
    "helm",
    "gloves",
    "boots",
    "belt",
    "amulet",
    "ring",
    "trinket",
    "consumable",
    "other",
  ];
  const idx = clampInt(Math.floor(value * slots.length), 0, slots.length - 1);
  return slots[idx]!;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(authToken);
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

    const { campaignId, combatSessionId } = parsed.data;
    const svc = createClient(supabaseUrl, serviceRoleKey);

    const { data: campaign, error: campaignError } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      .maybeSingle<CombatSessionRow>();
    if (sessionError) throw sessionError;
    if (!session) {
      return new Response(JSON.stringify({ error: "Combat session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (session.status !== "ended") {
      return new Response(JSON.stringify({ error: "Combat rewards can only be claimed after combat ends" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingReward, error: existingRewardError } = await svc
      .schema("mythic")
      .from("action_events")
      .select("payload")
      .eq("combat_session_id", combatSessionId)
      .eq("event_type", "reward_granted")
      .contains("payload", { player_id: user.id })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<RewardEventRow>();
    if (existingRewardError) throw existingRewardError;
    if (existingReward?.payload) {
      const payload = asObject(existingReward.payload);
      return new Response(
        JSON.stringify({
          ok: true,
          already_granted: true,
          rewards: payload.rewards ?? null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: combatants, error: combatantsError } = await svc
      .schema("mythic")
      .from("combatants")
      .select("id,character_id,entity_type,player_id,is_alive")
      .eq("combat_session_id", combatSessionId);
    if (combatantsError) throw combatantsError;

    const allCombatants = (combatants ?? []) as CombatantRow[];
    const playerCombatant = allCombatants.find((row) => row.entity_type === "player" && row.player_id === user.id) ?? null;
    if (!playerCombatant) {
      return new Response(JSON.stringify({ error: "No player combatant found for reward claim" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const survivingPlayers = allCombatants.filter((row) => row.entity_type === "player" && row.is_alive).length;
    const survivingNpcs = allCombatants.filter((row) => row.entity_type === "npc" && row.is_alive).length;
    const defeatedNpcs = allCombatants.filter((row) => row.entity_type === "npc" && !row.is_alive).length;

    const playerAlive = playerCombatant.is_alive;
    const xpGain = Math.max(
      12,
      45
        + defeatedNpcs * 34
        + (survivingNpcs === 0 ? 28 : 0)
        + (playerAlive ? 18 : -16),
    );

    const { data: character, error: characterError } = await svc
      .schema("mythic")
      .from("characters")
      .select("*")
      .eq("id", playerCombatant.character_id ?? "")
      .eq("campaign_id", campaignId)
      .maybeSingle<CharacterRow>();
    if (characterError) throw characterError;

    const resolvedCharacter = character ?? (await (async () => {
      const { data: fallbackCharacter, error: fallbackError } = await svc
        .schema("mythic")
        .from("characters")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("player_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<CharacterRow>();
      if (fallbackError) throw fallbackError;
      return fallbackCharacter;
    })());

    if (!resolvedCharacter) {
      return new Response(JSON.stringify({ error: "No mythic character found for reward claim" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resources = asObject(resolvedCharacter.resources);
    const levelBefore = clampInt(asNumber(resolvedCharacter.level, 1), 1, 99);
    const xpBefore = Math.max(0, asNumber((resolvedCharacter as Record<string, unknown>).xp, asNumber(resources.xp, 0)));
    let xpToNext = Math.max(50, asNumber((resolvedCharacter as Record<string, unknown>).xp_to_next, asNumber(resources.xp_to_next, xpToNextLevel(levelBefore))));
    let xpPool = xpBefore + xpGain;
    let levelAfter = levelBefore;
    while (xpPool >= xpToNext && levelAfter < 99) {
      xpPool -= xpToNext;
      levelAfter += 1;
      xpToNext = xpToNextLevel(levelAfter);
    }
    const levelUps = levelAfter - levelBefore;

    const progressionResources = {
      ...resources,
      xp: xpPool,
      xp_to_next: xpToNext,
      total_xp: Math.max(0, asNumber(resources.total_xp, xpBefore) + xpGain),
      last_reward_combat_session_id: combatSessionId,
      last_rewarded_at: new Date().toISOString(),
    };

    const statGrowth = {
      offense: clampInt(asNumber(resolvedCharacter.offense, 10) + levelUps, 0, 100),
      defense: clampInt(asNumber(resolvedCharacter.defense, 10) + levelUps, 0, 100),
      control: clampInt(asNumber(resolvedCharacter.control, 10) + Math.floor(levelUps / 2), 0, 100),
      support: clampInt(asNumber(resolvedCharacter.support, 10) + Math.floor(levelUps / 2), 0, 100),
      mobility: clampInt(asNumber(resolvedCharacter.mobility, 10) + Math.ceil(levelUps / 2), 0, 100),
      utility: clampInt(asNumber(resolvedCharacter.utility, 10) + Math.ceil(levelUps / 2), 0, 100),
    };

    const characterUpdate: Record<string, unknown> = {
      level: levelAfter,
      resources: progressionResources,
      updated_at: new Date().toISOString(),
    };

    if ("xp" in resolvedCharacter) {
      characterUpdate.xp = xpPool;
    }
    if ("xp_to_next" in resolvedCharacter) {
      characterUpdate.xp_to_next = xpToNext;
    }
    if (levelUps > 0) {
      if ("last_level_up_at" in resolvedCharacter) {
        characterUpdate.last_level_up_at = new Date().toISOString();
      }
      if ("offense" in resolvedCharacter) characterUpdate.offense = statGrowth.offense;
      if ("defense" in resolvedCharacter) characterUpdate.defense = statGrowth.defense;
      if ("control" in resolvedCharacter) characterUpdate.control = statGrowth.control;
      if ("support" in resolvedCharacter) characterUpdate.support = statGrowth.support;
      if ("mobility" in resolvedCharacter) characterUpdate.mobility = statGrowth.mobility;
      if ("utility" in resolvedCharacter) characterUpdate.utility = statGrowth.utility;
      if ("unspent_points" in resolvedCharacter) {
        characterUpdate.unspent_points = asNumber(resolvedCharacter.unspent_points, 0) + levelUps * 2;
      }
    }

    const { error: updateCharacterError } = await svc
      .schema("mythic")
      .from("characters")
      .update(characterUpdate)
      .eq("id", resolvedCharacter.id)
      .eq("campaign_id", campaignId);
    if (updateCharacterError) throw updateCharacterError;

    let grantedLoot: GrantedLootRow[] = [];
    const lootCount = Math.max(1, Math.min(3, defeatedNpcs > 0 ? Math.ceil(defeatedNpcs / 2) : 1));

    try {
      const lootSeed = Number(session.seed ?? 0) + hashString(`${combatSessionId}:${user.id}:loot`);
      const nowIso = new Date().toISOString();

      const itemRows = Array.from({ length: lootCount }, (_, index) => {
        const rarity = pickRarity(roll(lootSeed, `rarity:${index}`));
        const slot = pickSlot(roll(lootSeed, `slot:${index}`));
        const slotName = titleCase(slot);
        const rarityName = titleCase(rarity);
        const itemPower = clampInt(levelBefore * 5 + Math.floor(roll(lootSeed, `power:${index}`) * 15), 4, 500);

        const statBias = Math.max(1, Math.floor(itemPower / 8));

        return {
          campaign_id: campaignId,
          owner_character_id: resolvedCharacter.id,
          rarity,
          item_type: slot === "consumable" ? "consumable" : "gear",
          slot,
          name: `${rarityName} ${slotName}`,
          required_level: Math.max(1, levelBefore - 1),
          item_power: itemPower,
          bind_policy: "character",
          drop_tier: rarity,
          stat_mods:
            slot === "weapon"
              ? { offense: statBias }
              : slot === "armor" || slot === "helm"
                ? { defense: statBias }
                : slot === "boots"
                  ? { mobility: statBias }
                  : slot === "ring" || slot === "amulet"
                    ? { utility: statBias }
                    : { support: Math.max(1, Math.floor(statBias / 2)) },
          effects_json: {
            source: "combat_rewards",
            combat_session_id: combatSessionId,
            index,
          },
          durability_json: {},
          affixes: [],
          drawback_json: {},
          weapon_profile: {},
          updated_at: nowIso,
          created_at: nowIso,
        };
      });

      const { data: insertedItems, error: insertItemsError } = await svc
        .schema("mythic")
        .from("items")
        .insert(itemRows)
        .select("id,name,rarity,slot,item_power");
      if (insertItemsError) throw insertItemsError;

      grantedLoot = (insertedItems ?? []) as GrantedLootRow[];

      if (grantedLoot.length > 0) {
        const inventoryRows = grantedLoot.map((item) => ({
          character_id: resolvedCharacter.id,
          item_id: item.id,
          container: "backpack",
          quantity: 1,
        }));

        const { error: inventoryError } = await svc
          .schema("mythic")
          .from("inventory")
          .insert(inventoryRows);
        if (inventoryError) throw inventoryError;

        const highestRarity = grantedLoot
          .map((loot) => loot.rarity as Rarity)
          .sort((a, b) => rarityRank(b) - rarityRank(a))[0] ?? "common";

        await svc
          .schema("mythic")
          .from("loot_drops")
          .insert({
            campaign_id: campaignId,
            combat_session_id: combatSessionId,
            source: "combat_rewards",
            rarity: highestRarity,
            item_ids: grantedLoot.map((loot) => loot.id),
            budget_points: xpGain,
            payload: {
              player_id: user.id,
              level_before: levelBefore,
              level_after: levelAfter,
              xp_gained: xpGain,
            },
          });
      }
    } catch (lootError) {
      console.error("loot grant failed:", lootError);
    }

    const rewardSummary: RewardSummary = {
      xp_gained: xpGain,
      level_before: levelBefore,
      level_after: levelAfter,
      level_ups: levelUps,
      xp_after: xpPool,
      xp_to_next: xpToNext,
      loot: grantedLoot.map((loot) => ({
        item_id: loot.id,
        name: loot.name,
        rarity: loot.rarity,
        slot: loot.slot,
        item_power: loot.item_power,
      })),
      outcome: {
        defeated_npcs: defeatedNpcs,
        surviving_players: survivingPlayers,
        surviving_npcs: survivingNpcs,
        player_alive: playerAlive,
      },
    };

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatSessionId,
      p_turn_index: Number(session.current_turn_index ?? 0),
      p_actor_combatant_id: playerCombatant.id,
      p_event_type: "reward_granted",
      p_payload: {
        player_id: user.id,
        character_id: resolvedCharacter.id,
        rewards: rewardSummary,
        animation_hint: {
          kind: "rewards_page_flip",
          duration_ms: 420,
        },
      },
    });

    await svc
      .schema("mythic")
      .from("story_beats")
      .insert({
        campaign_id: campaignId,
        beat_type: "combat_rewards",
        title: `Rewards claimed by ${user.id}`,
        narrative: `${user.id} gained ${xpGain} XP and ${rewardSummary.loot.length} loot drop(s).`,
        emphasis: levelUps > 0 ? "high" : "normal",
        metadata: {
          combat_session_id: combatSessionId,
          level_before: levelBefore,
          level_after: levelAfter,
          loot_count: rewardSummary.loot.length,
        },
        created_by: "system",
      });

    return new Response(
      JSON.stringify({
        ok: true,
        already_granted: false,
        rewards: rewardSummary,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("mythic-combat-rewards error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to grant combat rewards" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
