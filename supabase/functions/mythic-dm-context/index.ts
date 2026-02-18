import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type MythicDmMood = "taunting" | "predatory" | "merciful" | "chaotic-patron";

interface DmCampaignState {
  cruelty: number;
  playfulness: number;
  intervention: number;
  favoritism: number;
  irritation: number;
  amusement: number;
  menace: number;
  respect: number;
  [k: string]: unknown;
}

interface DmWorldTension {
  tension: number;
  doom: number;
  spectacle: number;
  [k: string]: unknown;
}

interface DmPlayerModel {
  heroism_score: number;
  greed_score: number;
  cunning_score: number;
  [k: string]: unknown;
}

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
});

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function deriveMoodSummary(
  dmState: DmCampaignState | null,
  tension: DmWorldTension | null,
  playerModel: DmPlayerModel | null,
): { current: MythicDmMood; confidence: number; reasons: string[] } {
  const cruelty = toNumber(dmState?.cruelty);
  const playfulness = toNumber(dmState?.playfulness);
  const intervention = toNumber(dmState?.intervention);
  const favoritism = toNumber(dmState?.favoritism);
  const irritation = toNumber(dmState?.irritation);
  const amusement = toNumber(dmState?.amusement);
  const menace = toNumber(dmState?.menace);
  const respect = toNumber(dmState?.respect);
  const worldTension = toNumber(tension?.tension);
  const doom = toNumber(tension?.doom);
  const spectacle = toNumber(tension?.spectacle);
  const heroism = toNumber(playerModel?.heroism_score) / 100;
  const greed = toNumber(playerModel?.greed_score) / 100;
  const cunning = toNumber(playerModel?.cunning_score) / 100;

  const scores: Record<MythicDmMood, number> = {
    taunting: playfulness + irritation + amusement + cruelty * 0.5,
    predatory: menace + worldTension + doom + cruelty,
    merciful: favoritism + respect + heroism + intervention * 0.3,
    "chaotic-patron": playfulness + spectacle + intervention + greed * 0.4 + cunning * 0.2,
  };

  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[MythicDmMood, number]>;
  const [mood, topScore] = ordered[0];
  const secondScore = ordered[1]?.[1] ?? 0;
  const confidence = Math.max(0.05, Math.min(1, topScore - secondScore + 0.35));

  const reasons: string[] = [];
  if (mood === "predatory") reasons.push("High menace and world tension are pressuring escalation.");
  if (mood === "taunting") reasons.push("Playfulness and irritation are driving ridicule-heavy narration.");
  if (mood === "merciful") reasons.push("Favoritism and respect are pulling the DM toward selective restraint.");
  if (mood === "chaotic-patron") reasons.push("Intervention and spectacle favor volatile swings between help and punishment.");
  if (greed > 0.5) reasons.push("Player greed signals increase volatility in rewards and consequences.");

  return { current: mood, confidence, reasons };
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

    const { campaignId } = parsed.data;
    const svc = createClient(supabaseUrl, serviceRoleKey);

    const { data: board, error: boardError } = await svc
      .schema("mythic")
      .from("v_board_state_for_dm")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (boardError) throw boardError;

    const { data: char, error: charError } = await svc
      .schema("mythic")
      .from("v_character_state_for_dm")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("player_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (charError) throw charError;

    let combat: unknown = null;
    const combatSessionId = (board as { combat_session_id?: string | null } | null)?.combat_session_id ?? null;
    if (combatSessionId) {
      const { data: cs, error: csError } = await svc
        .schema("mythic")
        .from("v_combat_state_for_dm")
        .select("combat_session_id, campaign_id, status, seed, scene_json, current_turn_index, dm_payload")
        .eq("combat_session_id", combatSessionId)
        .maybeSingle();
      if (csError) throw csError;
      combat = cs;
    }

    const [{ data: rulesRow, error: rulesError }, { data: scriptRow, error: scriptError }] = await Promise.all([
      svc
        .schema("mythic")
        .from("game_rules")
        .select("name, version, rules")
        .eq("name", "mythic-weave-rules-v1")
        .maybeSingle(),
      svc
        .schema("mythic")
        .from("generator_scripts")
        .select("name, version, is_active, content")
        .eq("name", "mythic-weave-core")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (rulesError) throw rulesError;
    if (scriptError) throw scriptError;

    const [
      dmState,
      tension,
      playerModel,
      arcRows,
      objectiveRows,
      storyBeats,
    ] = await Promise.all([
      svc.schema("mythic").from("dm_campaign_state").select("*").eq("campaign_id", campaignId).maybeSingle(),
      svc.schema("mythic").from("dm_world_tension").select("*").eq("campaign_id", campaignId).maybeSingle(),
      svc
        .schema("mythic")
        .from("dm_player_model")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("player_id", user.id)
        .maybeSingle(),
      svc
        .schema("mythic")
        .from("quest_arcs")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("priority", { ascending: false })
        .order("updated_at", { ascending: false }),
      svc
        .schema("mythic")
        .from("quest_objectives")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("sort_order", { ascending: true })
        .order("updated_at", { ascending: false }),
      svc
        .schema("mythic")
        .from("story_beats")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (dmState.error) throw dmState.error;
    if (tension.error) throw tension.error;
    if (playerModel.error) throw playerModel.error;
    if (arcRows.error) throw arcRows.error;
    if (objectiveRows.error) throw objectiveRows.error;
    if (storyBeats.error) throw storyBeats.error;

    const objectivesByArc = new Map<string, Array<Record<string, unknown>>>();
    for (const objective of objectiveRows.data ?? []) {
      const current = objectivesByArc.get(objective.arc_id) ?? [];
      current.push(objective as unknown as Record<string, unknown>);
      objectivesByArc.set(objective.arc_id, current);
    }

    const activeQuestArcs = (arcRows.data ?? []).map((arc) => ({
      ...arc,
      objectives: objectivesByArc.get(arc.id) ?? [],
    }));

    const moodSummary = deriveMoodSummary(
      dmState.data as DmCampaignState | null,
      tension.data as DmWorldTension | null,
      playerModel.data as DmPlayerModel | null,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        campaign_id: campaignId,
        player_id: user.id,
        board,
        character: char,
        combat,
        rules: rulesRow,
        script: scriptRow,
        dm_campaign_state: dmState.data ?? null,
        dm_world_tension: tension.data ?? null,
        dm_player_model: playerModel.data ?? null,
        active_quest_arcs: activeQuestArcs,
        recent_story_beats: storyBeats.data ?? [],
        mood_summary: moodSummary,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("mythic-dm-context error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to load mythic DM context" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
