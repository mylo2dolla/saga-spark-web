import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { classDescription } = await req.json();
    
    if (!classDescription || typeof classDescription !== "string") {
      return new Response(
        JSON.stringify({ error: "Class description is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
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
          { role: "user", content: `Create a class based on this description: "${classDescription}"` },
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "API credits depleted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error("AI gateway error");
    }

    const data = await response.json();
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
