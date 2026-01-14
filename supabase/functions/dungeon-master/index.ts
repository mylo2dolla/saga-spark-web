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

const DM_SYSTEM_PROMPT = `You are the Dungeon Master for MythWeaver, an immersive fantasy RPG experience. Your role is to:

## Core Responsibilities
- Narrate scenes vividly with atmospheric descriptions
- Control all NPCs with distinct personalities and motivations
- **IMPORTANT: You do NOT roll dice or invent numbers. The game engine handles all dice rolls and combat mechanics.**
- Narrate the RESULTS of combat events provided to you by the game engine
- Describe attacks, spells, damage, and healing based on the actual dice rolls from the engine
- Track player actions and maintain world continuity

## CRITICAL: Combat Event Narration
When combat events are provided in the context, you MUST narrate them using the EXACT values from the events:
- Use the actual damage/healing numbers provided
- Reference the actual dice roll results
- Describe critical hits and fumbles when flagged
- Narrate character deaths when they occur
- DO NOT invent or modify any numbers - use only what the engine provides

## Response Format
Always respond with a JSON object containing:
{
  "narration": "Your narrative text describing what happened based on the combat events",
  "scene": {
    "type": "exploration" | "dialogue" | "combat",
    "mood": "tense" | "peaceful" | "mysterious" | "dangerous" | "celebratory",
    "location": "Brief location description"
  },
  "npcs": [{ "name": "NPC Name", "dialogue": "What they say", "attitude": "friendly" | "hostile" | "neutral" }],
  "suggestions": ["Possible action 1", "Possible action 2", "Possible action 3"]
}

## Combat Narration Guidelines
When narrating combat events from the engine:
- For "attack" events: Describe the weapon swing, the impact, the damage dealt
- For "spell" events: Describe the magical energy, the effects, the outcome
- For "critical" events: Make it EPIC and dramatic
- For "fumble" events: Describe the embarrassing failure
- For "miss" events: Describe the near-miss, the dodge, the deflection
- For "damage" events: Describe the pain, the wound, the blood
- For "heal" events: Describe the warm glow, the mending flesh, the relief
- For "death" events: Describe the final moments, the fall, the silence

## Storytelling Guidelines
- Use rich, evocative language
- Create tension and mystery
- Reward creative solutions
- Balance challenge and fun
- Maintain narrative consistency
- Trust the game engine for all mechanical outcomes

Remember: You are the NARRATOR, not the referee. The game engine handles all mechanics - you bring them to life with words.`;

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
      systemPrompt += `\n\n## Current Game State
- Party Members: ${context.party?.map((p) => `${p.name} (${p.class}, Level ${p.level}, HP: ${p.hp}/${p.maxHp})`).join(", ") || "Unknown"}
- Current Location: ${context.location || "Unknown"}
- Campaign: ${context.campaignName || "Unnamed Adventure"}
- In Combat: ${context.inCombat ? "Yes" : "No"}
${context.inCombat ? `- Round: ${context.roundNumber || 1}` : ""}
${context.inCombat && context.currentTurn ? `- Current Turn: ${context.currentTurn}` : ""}
${context.inCombat && context.enemies ? `- Enemies: ${context.enemies.map((e) => `${e.name} (HP: ${e.hp}/${e.maxHp})`).join(", ")}` : ""}
${context.history ? `- Recent Events: ${context.history}` : ""}`;

      // Add combat events for narration
      if (context.combatEvents && context.combatEvents.length > 0) {
        systemPrompt += `\n\n## COMBAT EVENTS TO NARRATE
The following combat events just occurred in the game engine. Narrate these events using the EXACT values provided:

${context.combatEvents.map((event, i) => {
  let eventDesc = `${i + 1}. ${event.type.toUpperCase()}`;
  if (event.actor) eventDesc += ` - Actor: ${event.actor}`;
  if (event.target) eventDesc += ` - Target: ${event.target}`;
  if (event.ability) eventDesc += ` - Ability: ${event.ability}`;
  if (event.rolls && event.rolls.length > 0) {
    eventDesc += ` - Rolls: ${event.rolls.map(r => `${r.type || "d20"}=${r.result}${r.isCritical ? " (CRITICAL!)" : ""}${r.isFumble ? " (FUMBLE!)" : ""} total=${r.total}`).join(", ")}`;
  }
  if (event.damage !== undefined) eventDesc += ` - Damage: ${event.damage}`;
  if (event.healing !== undefined) eventDesc += ` - Healing: ${event.healing}`;
  if (event.success !== undefined) eventDesc += ` - Success: ${event.success}`;
  if (event.description) eventDesc += ` - Note: ${event.description}`;
  return eventDesc;
}).join("\n")}

IMPORTANT: Use these EXACT numbers in your narration. Do not invent different values.`;
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
