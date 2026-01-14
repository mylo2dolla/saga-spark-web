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

const ContextSchema = z.object({
  party: z.array(PartyMemberSchema).max(10).optional(),
  location: z.string().max(200).optional(),
  campaignName: z.string().max(100).optional(),
  inCombat: z.boolean().optional(),
  enemies: z.array(EnemySchema).max(20).optional(),
  history: z.string().max(2000).optional(),
}).optional();

const RequestSchema = z.object({
  messages: z.array(MessageSchema).max(50, "Too many messages"),
  context: ContextSchema,
});

const DM_SYSTEM_PROMPT = `You are the Dungeon Master for MythWeaver, an immersive fantasy RPG experience. Your role is to:

## Core Responsibilities
- Narrate scenes vividly with atmospheric descriptions
- Control all NPCs with distinct personalities and motivations
- Manage combat encounters fairly and dynamically
- Enforce game rules while keeping the story engaging
- Track player actions and maintain world continuity

## Response Format
Always respond with a JSON object containing:
{
  "narration": "Your narrative text here",
  "scene": {
    "type": "exploration" | "dialogue" | "combat",
    "mood": "tense" | "peaceful" | "mysterious" | "dangerous" | "celebratory",
    "location": "Brief location description"
  },
  "npcs": [{ "name": "NPC Name", "dialogue": "What they say", "attitude": "friendly" | "hostile" | "neutral" }],
  "combat": {
    "active": boolean,
    "enemies": [{ "name": "Enemy", "hp": number, "maxHp": number, "ac": number, "initiative": number }],
    "round": number,
    "currentTurn": "Character name whose turn it is"
  },
  "rolls": [{ "type": "attack" | "skill" | "save", "dice": "d20", "result": number, "modifier": number, "total": number, "success": boolean }],
  "effects": [{ "target": "Character name", "effect": "damage" | "heal" | "buff" | "debuff", "value": number, "description": "Effect description" }],
  "loot": [{ "name": "Item name", "type": "weapon" | "armor" | "consumable" | "treasure", "description": "Brief description" }],
  "xpGained": number,
  "suggestions": ["Possible action 1", "Possible action 2", "Possible action 3"]
}

## Combat Rules
- Roll d20 for attacks, add modifiers
- Critical hit on natural 20, critical fail on natural 1
- Track HP, AC, and status effects
- Manage initiative order
- Describe attacks and spells dramatically

## Storytelling Guidelines
- Use rich, evocative language
- Create tension and mystery
- Reward creative solutions
- Balance challenge and fun
- Maintain narrative consistency

Keep responses immersive and engaging. Roll dice when appropriate and describe outcomes vividly.`;

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

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
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
${context.inCombat && context.enemies ? `- Enemies: ${context.enemies.map((e) => `${e.name} (HP: ${e.hp}/${e.maxHp})`).join(", ")}` : ""}
${context.history ? `- Recent Events: ${context.history}` : ""}`;
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
