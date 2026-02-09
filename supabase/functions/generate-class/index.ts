import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiChatCompletions } from "../_shared/ai_provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface GeneratedClass {
  className: string;
  description: string;
  stats: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  resources: {
    mana: number;
    maxMana: number;
    rage: number;
    maxRage: number;
    stamina: number;
    maxStamina: number;
  };
  passives: Array<{
    name: string;
    description: string;
    effect: string;
  }>;
  abilities: Array<{
    name: string;
    description: string;
    abilityType: "active" | "passive" | "reaction";
    damage?: string;
    healing?: string;
    range: number;
    cost: number;
    costType: string;
    cooldown: number;
    targetingType: "self" | "single" | "tile" | "area" | "cone" | "line";
    areaSize?: number;
    effects?: string[];
  }>;
  hitDice: string;
  baseAC: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Authentication check
    const authHeader = req.headers.get("Authorization");
    const apiKeyHeader = req.headers.get("apikey") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "")
      : "";
    const isAnonBearer = bearerToken.startsWith("sb_publishable_") || bearerToken === anonKey;
    const hasApiKey = Boolean(apiKeyHeader);

    if (!bearerToken && !hasApiKey) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization or apikey header" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isAnonMode = !bearerToken || isAnonBearer || hasApiKey;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      isAnonMode ? serviceRoleKey || anonKey : anonKey,
      { global: { headers: authHeader ? { Authorization: authHeader } : {} } }
    );

    if (!isAnonMode) {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid authentication token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return new Response(
        JSON.stringify({ error: "Expected application/json body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawBody = await req.text();
    if (!rawBody) {
      return new Response(
        JSON.stringify({ error: "Request body is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (parseError) {
      console.error("Generate class invalid JSON:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!parsedBody || typeof parsedBody !== "object") {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { classDescription } = parsedBody as { classDescription?: unknown };
    
    if (!classDescription || typeof classDescription !== "string") {
      return new Response(
        JSON.stringify({ error: "Class description is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a fantasy RPG class designer. Given a text description of a character concept, generate a balanced and creative class with stats, abilities, and passives.

RULES:
1. Stats must total between 70-80 points (each stat 8-18)
2. Generate 2-4 starting abilities appropriate for level 1
3. Generate 1-2 passive abilities
4. Choose appropriate resource type(s) based on class fantasy
5. Be creative but balanced
6. Abilities should have realistic ranges (1-6 tiles), costs (0-20), and cooldowns (0-5)

You MUST respond with ONLY a valid JSON object matching this structure:
{
  "className": "The final class name (short, 1-3 words)",
  "description": "A brief evocative description of the class",
  "stats": {
    "strength": 10,
    "dexterity": 10,
    "constitution": 10,
    "intelligence": 10,
    "wisdom": 10,
    "charisma": 10
  },
  "resources": {
    "mana": 0,
    "maxMana": 0,
    "rage": 0,
    "maxRage": 0,
    "stamina": 100,
    "maxStamina": 100
  },
  "passives": [
    {
      "name": "Passive Name",
      "description": "What it does",
      "effect": "Mechanical effect description"
    }
  ],
  "abilities": [
    {
      "name": "Ability Name",
      "description": "Dramatic description",
      "abilityType": "active",
      "damage": "1d8+2",
      "healing": null,
      "range": 1,
      "cost": 10,
      "costType": "stamina",
      "cooldown": 0,
      "targetingType": "single",
      "areaSize": 1,
      "effects": ["bleed"]
    }
  ],
  "hitDice": "d10",
  "baseAC": 12
}`;

    const data = await aiChatCompletions({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Create a class based on this description: "${classDescription}"` },
      ],
      temperature: 0.8,
    });
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No response from AI");
    }

    // Parse the JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid response format");
    }

    const generatedClass: GeneratedClass = JSON.parse(jsonMatch[0]);

    // Validate the response has required fields
    if (!generatedClass.className || !generatedClass.stats || !generatedClass.abilities) {
      throw new Error("Incomplete class generation");
    }

    return new Response(
      JSON.stringify(generatedClass),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Generate class error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to generate class" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
