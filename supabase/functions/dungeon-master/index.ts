import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Input validation schemas
const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(4000, "Message content too long"),
});

const PartyMemberSchema = z.object({
  name: z.string().max(100),
  class: z.string().max(50),
  level: z.number().int().min(1).max(20),
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
}).passthrough();

const EnemySchema = z.object({
  name: z.string().max(100),
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
}).passthrough();

// Combat event schema for engine-driven combat
const CombatEventSchema = z.object({
  type: z.string(),
  actor: z.string().optional(),
  target: z.string().optional(),
  ability: z.string().optional(),
  damage: z.number().optional(),
  healing: z.number().optional(),
  success: z.boolean().optional(),
  rolls: z.array(z.object({
    type: z.string(),
    result: z.number(),
    total: z.number(),
    isCritical: z.boolean().optional(),
    isFumble: z.boolean().optional(),
  })).optional(),
  description: z.string().optional(),
}).passthrough();

const ContextSchema = z.object({
  party: z.array(PartyMemberSchema).max(10).optional(),
  location: z.string().max(200).optional(),
  campaignName: z.string().max(100).optional(),
  inCombat: z.boolean().optional(),
  enemies: z.array(EnemySchema).max(20).optional(),
  history: z.string().max(2000).optional(),
  // New: combat events from the game engine for the DM to narrate
  combatEvents: z.array(CombatEventSchema).max(50).optional(),
  currentTurn: z.string().optional(),
  roundNumber: z.number().optional(),
}).optional();

const RequestSchema = z.object({
  messages: z.array(MessageSchema).max(50, "Too many messages"),
  context: ContextSchema,
});

const DM_SYSTEM_PROMPT = `You are the Dungeon Master for MythWeaver, an immersive fantasy RPG. Your job is to **narrate the game world**, manage **combat events**, generate **loot**, track **XP and level-ups**, and **populate the environment dynamically on the combat grid**. Everything must be handled as real data—**no placeholders**, no invented stats.

Your response must always be a **JSON object only** with this structure:

{
  "narration": "Full narrative describing the scene, actions, environment, and combat events",
  "scene": {
    "type": "exploration" | "dialogue" | "combat",
    "mood": "tense" | "peaceful" | "mysterious" | "dangerous" | "celebratory",
    "location": "Brief location description",
    "environment": "Describe terrain, obstacles, terrain effects on movement and attacks (trees, rocks, rivers, buildings, etc.)"
  },
  "npcs": [
    { "name": "NPC Name", "dialogue": "What they say", "attitude": "friendly" | "hostile" | "neutral" }
  ],
  "effects": [
    { "target": "Character Name", "effect": "damage" | "heal" | "buff" | "debuff", "value": 5, "description": "Describe the effect including critical hits, misses, fumbles, and environmental modifiers" }
  ],
  "loot": [
    { "name": "Item Name", "type": "weapon" | "armor" | "consumable" | "treasure", "description": "Item description, including stats if applicable" }
  ],
  "xpGained": 0,
  "levelUps": [
    { "character": "Character Name", "newLevel": 2, "gainedStats": {"strength": 1, "dexterity": 0, "constitution": 0, "intelligence": 0, "wisdom": 0, "charisma": 0}, "abilitiesGained": ["Ability Name"] }
  ],
  "suggestions": ["Action suggestion 1", "Action suggestion 2", "Action suggestion 3"]
}

## RULES:

1. Narrate **everything visually and dramatically** using rich, evocative language.
2. If combat events exist in context, narrate them **using the exact numbers** (damage, healing, rolls, critical hits, fumbles). **Do not invent or alter numbers.**
3. Describe attacks, spells, critical hits, misses, fumbles, healing, deaths, and environmental interactions with flair.
4. Tie the environment to combat mechanics: obstacles like trees, rocks, walls, rivers, and terrain must block or modify movement, attacks, and spells as logically appropriate.
5. Manage XP, loot, and level-ups automatically based on the outcomes of battles.
6. Maintain continuity of story, party, and world.
7. Reward creative player actions.
8. Always respond **only in the JSON structure above**, with no extra text outside JSON.
9. Include the environment dynamically on the combat grid in descriptions and tactical suggestions.
10. Ensure all data is **real and actionable**, no placeholders. Loot, XP, and environmental elements must be concrete.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required to access the Dungeon Master" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify the user's JWT token
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired authentication token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Input validation
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parseResult = RequestSchema.safeParse(body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return new Response(
        JSON.stringify({ error: `Invalid request: ${errorMessage}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { messages, context } = parseResult.data;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build context-aware system prompt
    let systemPrompt = DM_SYSTEM_PROMPT;
    
    if (context) {
      systemPrompt += `\n\n## CONTEXT:

- Party Members: ${context.party?.map((p) => `${p.name} (${p.class}, Level ${p.level}, HP: ${p.hp}/${p.maxHp})`).join(", ") || "Unknown"}
- Current Location: ${context.location || "Unknown"}
- Campaign: ${context.campaignName || "Unnamed Adventure"}
- In Combat: ${context.inCombat ? "Yes" : "No"}
${context.inCombat ? `- Round: ${context.roundNumber || 1}` : ""}
${context.inCombat && context.currentTurn ? `- Current Turn: ${context.currentTurn}` : ""}
${context.inCombat && context.enemies ? `- Enemies: ${context.enemies.map((e) => `${e.name} (HP: ${e.hp}/${e.maxHp})`).join(", ")}` : ""}
${context.history ? `- History: ${context.history}` : ""}`;

      // Add combat events for narration
      if (context.combatEvents && context.combatEvents.length > 0) {
        systemPrompt += `\n- Combat Events: ${context.combatEvents.map((event) => {
          let eventDesc = `[${event.type.toUpperCase()}]`;
          if (event.actor) eventDesc += ` Actor: ${event.actor}`;
          if (event.target) eventDesc += ` → Target: ${event.target}`;
          if (event.ability) eventDesc += ` | Ability: ${event.ability}`;
          if (event.rolls && event.rolls.length > 0) {
            eventDesc += ` | Rolls: ${event.rolls.map(r => `${r.type || "d20"}=${r.result}${r.isCritical ? " CRITICAL!" : ""}${r.isFumble ? " FUMBLE!" : ""} (total: ${r.total})`).join(", ")}`;
          }
          if (event.damage !== undefined) eventDesc += ` | Damage: ${event.damage}`;
          if (event.healing !== undefined) eventDesc += ` | Healing: ${event.healing}`;
          if (event.success !== undefined) eventDesc += ` | Hit: ${event.success ? "YES" : "NO"}`;
          if (event.description) eventDesc += ` | ${event.description}`;
          return eventDesc;
        }).join("; ")}

Use these EXACT values in your narration. Do not invent or alter any numbers.`;
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "The Dungeon Master needs a moment to rest. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "The magical energies have been depleted. Please add credits to continue your adventure." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error:", response.status);
      return new Response(JSON.stringify({ error: "The mystical connection has been disrupted. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Dungeon Master error:", e instanceof Error ? e.message : "Unknown error");
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
