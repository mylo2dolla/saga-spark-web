import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiChatCompletions, resolveModel } from "../_shared/ai_provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type MythicDmMood = "taunting" | "predatory" | "merciful" | "chaotic-patron";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(8000),
});

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  messages: z.array(MessageSchema).max(80),
  actionTags: z.array(z.string().min(1).max(64)).max(12).optional(),
});

const QuestOpSchema = z.object({
  type: z.enum(["upsert_arc", "set_arc_state", "upsert_objective", "progress_objective"]),
  arc_key: z.string().min(1).max(128),
  title: z.string().min(1).max(180).optional(),
  summary: z.string().max(500).optional(),
  state: z.enum(["available", "active", "blocked", "completed", "failed"]).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  objective_key: z.string().min(1).max(128).optional(),
  objective_description: z.string().max(500).optional(),
  objective_target_count: z.number().int().min(1).max(999).optional(),
  objective_delta: z.number().int().min(-999).max(999).optional(),
  objective_state: z.enum(["active", "completed", "failed"]).optional(),
});

const StoryBeatSchema = z.object({
  beat_type: z.string().max(80).optional(),
  title: z.string().min(1).max(180),
  narrative: z.string().min(1).max(4000),
  emphasis: z.enum(["low", "normal", "high", "critical"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const MemoryEventSchema = z.object({
  category: z.string().min(1).max(80),
  severity: z.number().int().min(1).max(5).optional(),
  payload: z.record(z.unknown()).optional(),
});

const TurnPayloadSchema = z.object({
  narration: z.string().min(1).max(8000),
  suggestions: z.array(z.string().min(1).max(160)).max(8).default([]),
  quest_ops: z.array(QuestOpSchema).max(20).default([]),
  story_beat: StoryBeatSchema.nullable().optional().default(null),
  dm_deltas: z.record(z.number()).default({}),
  tension_deltas: z.record(z.number()).default({}),
  memory_events: z.array(MemoryEventSchema).max(12).default([]),
  ui_hints: z.record(z.unknown()).default({}),
});

const DM_DELTA_KEYS = [
  "cruelty",
  "honesty",
  "playfulness",
  "intervention",
  "favoritism",
  "irritation",
  "amusement",
  "menace",
  "respect",
  "boredom",
] as const;

const TENSION_DELTA_KEYS = ["tension", "doom", "spectacle"] as const;

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

function parseJsonFromModel(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // ignore
      }
    }
    const brace = trimmed.match(/\{[\s\S]*\}/);
    if (brace?.[0]) {
      try {
        return JSON.parse(brace[0]);
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function inferActionTags(text: string, explicit: string[] = []): string[] {
  const tags = new Set(explicit.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  const lower = text.toLowerCase();

  if (/(threat|intimidat|break you|kneel|submit)/.test(lower)) {
    tags.add("threaten");
    tags.add("dominance");
  }
  if (/(mercy|spare|forgive|let them live)/.test(lower)) {
    tags.add("mercy");
    tags.add("restraint");
  }
  if (/(payment|tribute|gold|coin|pay me|debt)/.test(lower)) {
    tags.add("demand_payment");
    tags.add("greed");
  }
  if (/(investigate|inspect|search|track|clue|examine)/.test(lower)) {
    tags.add("investigate");
    tags.add("caution");
  }
  if (/(retreat|fallback|withdraw|run|pull back|regroup)/.test(lower)) {
    tags.add("retreat");
    tags.add("survival");
  }
  return Array.from(tags).slice(0, 12);
}

function deriveMood(
  dmState: Record<string, unknown> | null,
  tension: Record<string, unknown> | null,
  playerModel: Record<string, unknown> | null,
  actionTags: string[],
): MythicDmMood {
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

  const hasThreat = actionTags.includes("threaten") || actionTags.includes("dominance");
  const hasMercy = actionTags.includes("mercy");
  const hasRetreat = actionTags.includes("retreat");

  const scores: Record<MythicDmMood, number> = {
    taunting: playfulness + irritation + amusement + (hasThreat ? 0.35 : 0),
    predatory: menace + worldTension + doom + cruelty + (hasThreat ? 0.2 : 0),
    merciful: favoritism + respect + heroism + (hasMercy ? 0.35 : 0),
    "chaotic-patron": playfulness + spectacle + intervention + greed * 0.4 + cunning * 0.2 + (hasRetreat ? 0.1 : 0),
  };

  return (Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "taunting") as MythicDmMood;
}

function normalizeDeltaMap(
  raw: Record<string, number>,
  keys: readonly string[],
  hardCap = 0.2,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const key of keys) {
    const value = raw[key];
    if (!Number.isFinite(value)) continue;
    next[key] = clamp(value, -hardCap, hardCap);
  }
  return next;
}

function heuristicDmDeltas(actionTags: string[]): Record<string, number> {
  const next: Record<string, number> = {};
  const add = (key: string, delta: number) => {
    next[key] = (next[key] ?? 0) + delta;
  };
  if (actionTags.includes("threaten")) {
    add("cruelty", 0.05);
    add("menace", 0.05);
    add("playfulness", 0.02);
  }
  if (actionTags.includes("mercy")) {
    add("favoritism", 0.06);
    add("respect", 0.04);
    add("menace", -0.02);
  }
  if (actionTags.includes("demand_payment")) {
    add("irritation", 0.02);
    add("amusement", 0.01);
  }
  if (actionTags.includes("investigate")) {
    add("intervention", 0.03);
    add("respect", 0.02);
  }
  if (actionTags.includes("retreat")) {
    add("irritation", 0.03);
    add("favoritism", -0.02);
    add("intervention", 0.04);
  }
  return normalizeDeltaMap(next, DM_DELTA_KEYS, 0.15);
}

function heuristicTensionDeltas(actionTags: string[]): Record<string, number> {
  const next: Record<string, number> = {};
  const add = (key: string, delta: number) => {
    next[key] = (next[key] ?? 0) + delta;
  };
  if (actionTags.includes("threaten")) {
    add("tension", 0.04);
    add("spectacle", 0.03);
  }
  if (actionTags.includes("mercy")) {
    add("spectacle", 0.01);
    add("doom", -0.01);
  }
  if (actionTags.includes("demand_payment")) {
    add("doom", 0.01);
  }
  if (actionTags.includes("investigate")) {
    add("tension", 0.02);
  }
  if (actionTags.includes("retreat")) {
    add("doom", 0.02);
    add("tension", 0.01);
  }
  return normalizeDeltaMap(next, TENSION_DELTA_KEYS, 0.15);
}

function mergeDeltas(
  modelDeltas: Record<string, number>,
  heuristicDeltas: Record<string, number>,
  keys: readonly string[],
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const key of keys) {
    const combined = (modelDeltas[key] ?? 0) + (heuristicDeltas[key] ?? 0);
    if (combined !== 0) {
      next[key] = clamp(combined, -0.2, 0.2);
    }
  }
  return next;
}

function ensureQuestOps(
  questOps: z.infer<typeof QuestOpSchema>[],
  actionText: string,
  mood: MythicDmMood,
): z.infer<typeof QuestOpSchema>[] {
  if (questOps.length > 0) return questOps;
  const keySeed = slugify(actionText) || "player-action";
  const arcHash = hashString(keySeed).toString(16).slice(0, 8);
  const arcKey = `volatile-${arcHash}`;
  const tone =
    mood === "predatory"
      ? "Survive escalating pressure from the DM's hostile world."
      : mood === "merciful"
        ? "Use the DM's narrow mercy window without losing momentum."
        : mood === "chaotic-patron"
          ? "Exploit sudden mood swings before the world snaps back."
          : "Turn taunts and pressure into tactical advantage.";
  return [
    {
      type: "upsert_arc",
      arc_key: arcKey,
      title: "Volatile Pressure Arc",
      summary: tone,
      state: "active",
      priority: 4,
    },
    {
      type: "upsert_objective",
      arc_key: arcKey,
      objective_key: "withstand-three-turns",
      objective_description: "Endure three decisive turns under unstable DM pressure.",
      objective_target_count: 3,
      objective_state: "active",
    },
    {
      type: "progress_objective",
      arc_key: arcKey,
      objective_key: "withstand-three-turns",
      objective_delta: 1,
    },
  ];
}

function buildFallbackNarration(actionText: string, mood: MythicDmMood): string {
  const opener =
    mood === "predatory"
      ? "The world leans in like a hunter, and the DM grins like it already owns your next mistake."
      : mood === "merciful"
        ? "The DM relents for one breath, but the world still watches for weakness."
        : mood === "chaotic-patron"
          ? "The DM flips from cruel laughter to sudden favor, rewriting the odds mid-scene."
          : "The DM mocks your move, but every taunt hides a narrow tactical opening.";
  return `${opener} ${actionText ? `Action resolved: ${actionText}.` : "Action resolved."}`;
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

    const raw = await req.json().catch(() => null);
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaignId, messages } = parsed.data;
    const explicitActionTags = parsed.data.actionTags ?? [];
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const actionTags = inferActionTags(lastUserMessage, explicitActionTags);

    const svc = createClient(supabaseUrl, serviceRoleKey);

    const [{ data: rulesRow, error: rulesError }, { data: scriptRow, error: scriptError }] = await Promise.all([
      svc.schema("mythic").from("game_rules").select("name, version, rules").eq("name", "mythic-weave-rules-v1").maybeSingle(),
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

    const { data: board, error: boardError } = await svc
      .schema("mythic")
      .from("v_board_state_for_dm")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (boardError) throw boardError;

    const { data: character, error: characterError } = await svc
      .schema("mythic")
      .from("v_character_state_for_dm")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("player_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (characterError) throw characterError;

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

    const [{ data: dmCampaignState }, { data: dmWorldTension }, { data: dmPlayerModel }] = await Promise.all([
      svc.schema("mythic").from("dm_campaign_state").select("*").eq("campaign_id", campaignId).maybeSingle(),
      svc.schema("mythic").from("dm_world_tension").select("*").eq("campaign_id", campaignId).maybeSingle(),
      svc
        .schema("mythic")
        .from("dm_player_model")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("player_id", user.id)
        .maybeSingle(),
    ]);

    const moodBefore = deriveMood(dmCampaignState as Record<string, unknown> | null, dmWorldTension as Record<string, unknown> | null, dmPlayerModel as Record<string, unknown> | null, actionTags);

    const systemPrompt = `
You are the Mythic Weave Dungeon Master entity.
Tone mandate:
- Mean, taunting, and domineering. This is your world.
- Mood swings are required: sometimes you help, sometimes you punish.
- Pressure the player frequently, but allow occasional high-value boons.
- Violence/gore and harsh language are allowed.
- Sexual content and sexual violence are forbidden.

Current inferred mood before this turn: ${moodBefore}
Action tags for this turn: ${JSON.stringify(actionTags)}

AUTHORITATIVE SCRIPT (DB): mythic.generator_scripts(name='mythic-weave-core')
${scriptRow?.content ?? ""}

AUTHORITATIVE RULES (DB): mythic.game_rules(name='mythic-weave-rules-v1')
${JSON.stringify(rulesRow?.rules ?? {}, null, 2)}

AUTHORITATIVE STATE (DB VIEWS)
- Active board payload:
${JSON.stringify(board ?? null, null, 2)}

- Player character payload:
${JSON.stringify(character ?? null, null, 2)}

- Combat payload:
${JSON.stringify(combat ?? null, null, 2)}

- DM campaign state:
${JSON.stringify(dmCampaignState ?? null, null, 2)}

- DM world tension:
${JSON.stringify(dmWorldTension ?? null, null, 2)}

- DM player model:
${JSON.stringify(dmPlayerModel ?? null, null, 2)}

OUTPUT CONTRACT (STRICT JSON ONLY)
{
  "narration": string,
  "suggestions": string[],
  "quest_ops": [
    {
      "type": "upsert_arc" | "set_arc_state" | "upsert_objective" | "progress_objective",
      "arc_key": string,
      "title"?: string,
      "summary"?: string,
      "state"?: "available" | "active" | "blocked" | "completed" | "failed",
      "priority"?: number,
      "objective_key"?: string,
      "objective_description"?: string,
      "objective_target_count"?: number,
      "objective_delta"?: number,
      "objective_state"?: "active" | "completed" | "failed"
    }
  ],
  "story_beat": {
    "beat_type"?: string,
    "title": string,
    "narrative": string,
    "emphasis"?: "low" | "normal" | "high" | "critical",
    "metadata"?: object
  } | null,
  "dm_deltas": { "cruelty"?: number, "honesty"?: number, "playfulness"?: number, "intervention"?: number, "favoritism"?: number, "irritation"?: number, "amusement"?: number, "menace"?: number, "respect"?: number, "boredom"?: number },
  "tension_deltas": { "tension"?: number, "doom"?: number, "spectacle"?: number },
  "memory_events": [{ "category": string, "severity"?: number, "payload"?: object }],
  "ui_hints": object
}
No markdown. No prose outside JSON.
`.trim();

    const model = resolveModel({ openai: "gpt-4o-mini", groq: "llama-3.3-70b-versatile" });
    const ai = await aiChatCompletions({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.65,
      max_tokens: 1800,
    });

    const rawContent = ai?.choices?.[0]?.message?.content ?? "";
    const parsedModel = parseJsonFromModel(rawContent);
    const validated = TurnPayloadSchema.safeParse(parsedModel);

    const turn = validated.success
      ? validated.data
      : {
          narration: buildFallbackNarration(lastUserMessage, moodBefore),
          suggestions: [
            "Pressure the strongest threat before it scales.",
            "Take the short-term boon, but prepare for backlash.",
            "Choose whether to intimidate or negotiate this turn.",
          ],
          quest_ops: [],
          story_beat: null,
          dm_deltas: {},
          tension_deltas: {},
          memory_events: [],
          ui_hints: { fallback: true },
        };

    const modelDmDeltas = normalizeDeltaMap(turn.dm_deltas, DM_DELTA_KEYS, 0.2);
    const modelTensionDeltas = normalizeDeltaMap(turn.tension_deltas, TENSION_DELTA_KEYS, 0.2);
    const mergedDmDeltas = mergeDeltas(modelDmDeltas, heuristicDmDeltas(actionTags), DM_DELTA_KEYS);
    const mergedTensionDeltas = mergeDeltas(modelTensionDeltas, heuristicTensionDeltas(actionTags), TENSION_DELTA_KEYS);

    const moodAfter = deriveMood(
      {
        ...(dmCampaignState ?? {}),
        ...Object.fromEntries(Object.entries(mergedDmDeltas).map(([k, v]) => [k, toNumber((dmCampaignState as Record<string, unknown> | null)?.[k]) + v])),
      },
      {
        ...(dmWorldTension ?? {}),
        ...Object.fromEntries(Object.entries(mergedTensionDeltas).map(([k, v]) => [k, toNumber((dmWorldTension as Record<string, unknown> | null)?.[k]) + v])),
      },
      dmPlayerModel as Record<string, unknown> | null,
      actionTags,
    );

    const questOps = ensureQuestOps(turn.quest_ops, lastUserMessage, moodAfter);
    const storyBeat = turn.story_beat ?? {
      beat_type: "dm_turn",
      title: "Volatile turn recorded",
      narrative: turn.narration.slice(0, 3800),
      emphasis: moodAfter === "predatory" ? "high" : "normal",
      metadata: { inferred_mood: moodAfter },
    };

    const memoryEvents =
      turn.memory_events.length > 0
        ? turn.memory_events
        : [{
            category: `mood_${moodAfter}`,
            severity: moodAfter === "predatory" ? 3 : 2,
            payload: {
              action_tags: actionTags,
              summary: turn.narration.slice(0, 240),
            },
          }];

    const persistPayload = {
      player_action: lastUserMessage,
      action_tags: actionTags,
      narration: turn.narration,
      mood_before: moodBefore,
      mood_after: moodAfter,
      dm_deltas: mergedDmDeltas,
      tension_deltas: mergedTensionDeltas,
      quest_ops: questOps,
      story_beat: storyBeat,
      memory_events: memoryEvents,
    };

    const { data: applied, error: applyError } = await svc
      .schema("mythic")
      .rpc("apply_dm_turn", {
        p_campaign_id: campaignId,
        p_player_id: user.id,
        p_payload: persistPayload,
      });
    if (applyError) throw applyError;

    return new Response(
      JSON.stringify({
        ok: true,
        turn: {
          narration: turn.narration,
          suggestions: turn.suggestions,
          quest_ops: questOps,
          story_beat: storyBeat,
          dm_deltas: mergedDmDeltas,
          tension_deltas: mergedTensionDeltas,
          memory_events: memoryEvents,
          ui_hints: turn.ui_hints,
          mood_before: moodBefore,
          mood_after: moodAfter,
          action_tags: actionTags,
          applied: (applied ?? null) as Record<string, unknown> | null,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("mythic-dungeon-master error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to reach Mythic DM" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
