import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiChatCompletions, resolveModel } from "../_shared/ai_provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CampaignSeed {
  title: string;
  description: string;
  themes?: string[];
}

interface GenerationRequest {
  type: "npc" | "quest" | "dialog" | "faction" | "location" | "initial_world";
  campaignSeed: CampaignSeed;
  context?: {
    playerLevel?: number;
    existingNPCs?: string[];
    existingQuests?: string[];
    playerActions?: string[];
    npcId?: string;
    npcName?: string;
    npcPersonality?: string[];
    playerRelationship?: string;
    worldState?: Record<string, unknown>;
    campaignId?: string;
  };
}

const SYSTEM_PROMPT = `You are the World Generator for a procedural RPG engine. You generate rich, interconnected content based on campaign seeds.

RULES:
1. All content must fit the campaign's themes and tone
2. NPCs must have distinct personalities, goals, and memories
3. Quests must emerge from NPC goals and world state
4. Factions must have clear relationships and conflicts
5. Dialog must reflect NPC personality and relationship with player
6. All content must be internally consistent

OUTPUT FORMAT: Always respond with valid JSON matching the requested schema.`;

function getNPCPrompt(seed: CampaignSeed, context: GenerationRequest["context"]) {
  return `Generate an NPC for this campaign:
Title: "${seed.title}"
Description: "${seed.description}"
Themes: ${seed.themes?.join(", ") || "fantasy adventure"}
Player Level: ${context?.playerLevel || 1}
Existing NPCs: ${context?.existingNPCs?.join(", ") || "none yet"}

Generate a unique NPC with:
- name: string
- title: optional title/role (e.g., "The Blacksmith", "Merchant of Shadows")
- personality: array of 2-4 traits from: honest, deceptive, brave, cowardly, kind, cruel, greedy, generous, wise, foolish, proud, humble, loyal, treacherous, patient, impulsive
- goals: array of 2-3 goals with id, description, priority (1-10)
- factionId: faction they belong to
- canTrade: boolean
- dialogue: initial greeting dialogue node with text and 2-3 response options
- questHook: a potential quest this NPC could offer (title, brief description, objective type)
- secrets: 1-2 secrets they know

Respond with JSON only.`;
}

function getQuestPrompt(seed: CampaignSeed, context: GenerationRequest["context"]) {
  return `Generate a quest for this campaign:
Title: "${seed.title}"
Description: "${seed.description}"
Themes: ${seed.themes?.join(", ") || "fantasy adventure"}
Player Level: ${context?.playerLevel || 1}
Recent Player Actions: ${context?.playerActions?.slice(-5).join(", ") || "just started"}
Existing Quests: ${context?.existingQuests?.join(", ") || "none"}

Generate a quest with:
- title: engaging quest name
- description: full narrative description
- briefDescription: one-line summary
- importance: "side" | "main" | "legendary"
- objectives: array of 1-3 objectives, each with:
  - type: kill | kill_type | collect | deliver | escort | explore | talk | protect | survive
  - description: what player must do
  - targetType: for kill_type (e.g., "goblin", "undead")
  - required: number needed
- rewards: { xp: number, gold: number, items: string[], storyFlags: string[] }
- storyArc: optional overarching story this belongs to
- timeLimit: optional turns until failure

The quest should feel organic to the world and player's current situation.
Respond with JSON only.`;
}

function getDialogPrompt(seed: CampaignSeed, context: GenerationRequest["context"]) {
  return `Generate dialog for an NPC interaction:
Campaign: "${seed.title}" - ${seed.description}
NPC: ${context?.npcName || "Unknown"}
NPC Personality: ${context?.npcPersonality?.join(", ") || "neutral"}
Player Relationship: ${context?.playerRelationship || "stranger"}

Generate a dialogue tree with:
- greeting: initial text based on relationship
- nodes: array of 3-5 dialogue nodes, each with:
  - id: unique identifier
  - text: what the NPC says
  - speakerMood: emotional state
  - responses: array of 2-4 player response options with:
    - text: what player can say
    - nextNodeId: which node this leads to
    - effects: optional array of effects (modify_relationship, give_item, start_quest, etc.)

The dialogue should reflect the NPC's personality and their relationship with the player.
Respond with JSON only.`;
}

function getFactionPrompt(seed: CampaignSeed, context: GenerationRequest["context"]) {
  return `Generate factions for this campaign:
Title: "${seed.title}"
Description: "${seed.description}"
Themes: ${seed.themes?.join(", ") || "fantasy adventure"}

Generate 3-5 factions, each with:
- id: unique identifier
- name: faction name
- description: who they are and what they represent
- alignment: one of lawful_good, neutral_good, chaotic_good, lawful_neutral, true_neutral, chaotic_neutral, lawful_evil, neutral_evil, chaotic_evil
- goals: array of 2-3 faction goals
- enemies: array of faction IDs they oppose
- allies: array of faction IDs they support

Factions should create interesting political dynamics and conflict opportunities.
Respond with JSON only.`;
}

function getLocationPrompt(seed: CampaignSeed, context: GenerationRequest["context"]) {
  return `Generate a location for this campaign:
Title: "${seed.title}"
Description: "${seed.description}"
Themes: ${seed.themes?.join(", ") || "fantasy adventure"}
Player Level: ${context?.playerLevel || 1}

Generate a location with:
- name: memorable location name
- description: vivid description of the place
- type: town | dungeon | wilderness | ruins | temple | castle | cave
- dangerLevel: 1-10
- inhabitants: array of NPC types that might be found here
- loot: array of potential item types
- secrets: 1-2 hidden things to discover
- connectedTo: types of locations this might connect to

The location should feel alive and full of adventure potential.
Respond with JSON only.`;
}

function getInitialWorldPrompt(seed: CampaignSeed) {
  return `Generate the initial world state for a new campaign:
Title: "${seed.title}"
Description: "${seed.description}"
Themes: ${seed.themes?.join(", ") || "fantasy adventure"}

Generate a complete starting world with:

1. factions: array of 3-4 factions (see faction schema above)

2. locations: array of 4-6 locations, each with:
   - id: stable unique id (kebab_case, e.g. "ashen_outpost")
   - name, description, type
   - dangerLevel: 1-10
   - position: { x: number, y: number } in a 0-500 range
   - connectedTo: array of location ids (not names)

3. startingLocationId: id of the starting location (must match one of the locations above)
   
4. npcs: array of 3-5 starting NPCs with:
   - name, title, personality traits, factionId
   - canTrade, greeting dialogue
   - a questHook each might offer

5. initialQuest: the first quest to hook the player with:
   - title, description, objectives, rewards
   
6. worldHooks: 3-4 story seeds that can develop into future quests

This should feel like a rich, living world ready for adventure.
Respond with JSON only.`;
}

const getRequestId = (req: Request) =>
  req.headers.get("x-request-id")
  ?? req.headers.get("x-correlation-id")
  ?? req.headers.get("x-vercel-id")
  ?? crypto.randomUUID();

const respondJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = getRequestId(req);
  const expectedEnvKeys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "AI_GATEWAY_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "GROQ_API_KEY",
    "GROQ_BASE_URL",
    "GROQ_MODEL",
    "LLM_PROVIDER",
    "LLM_MODEL",
  ];
  const envStatus = expectedEnvKeys.reduce<Record<string, "set" | "missing">>((acc, key) => {
    acc[key] = Deno.env.get(key) ? "set" : "missing";
    return acc;
  }, {});
  console.log("world-generator expected env keys", envStatus);
  const errorResponse = (
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) =>
    respondJson({ ok: false, code, message, details, requestId }, status);

  try {
    let payload: GenerationRequest;
    try {
      payload = (await req.json()) as GenerationRequest;
    } catch (error) {
      console.error("world-generator invalid json", {
        requestId,
        error: error instanceof Error ? error.message : error,
      });
      return errorResponse(400, "invalid_json", "Request body must be valid JSON");
    }

    const { type, campaignSeed, context } = payload ?? {};
    const allowedTypes = ["npc", "quest", "dialog", "faction", "location", "initial_world"];
    if (!type || !allowedTypes.includes(type)) {
      return errorResponse(400, "invalid_type", "Unsupported generation type", { type });
    }
    if (!campaignSeed || typeof campaignSeed.title !== "string" || typeof campaignSeed.description !== "string") {
      return errorResponse(
        400,
        "invalid_campaign_seed",
        "campaignSeed.title and campaignSeed.description are required",
        { campaignSeed }
      );
    }

    const missingRequired = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "GROQ_API_KEY"].filter(
      key => !Deno.env.get(key)
    );
    if (missingRequired.length > 0) {
      return errorResponse(
        500,
        "missing_env",
        `Missing required env vars: ${missingRequired.join(", ")}`,
        { expectedEnvKeys, missingRequired }
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    let userId: string | null = null;
    if (supabaseUrl && anonKey && authHeader) {
      const supabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error("world-generator auth lookup failed", { requestId, error: userError.message });
      } else {
        userId = user?.id ?? null;
      }
    }
    const campaignId = context?.campaignId ?? null;
    
    let prompt: string;
    switch (type) {
      case "npc":
        prompt = getNPCPrompt(campaignSeed, context);
        break;
      case "quest":
        prompt = getQuestPrompt(campaignSeed, context);
        break;
      case "dialog":
        prompt = getDialogPrompt(campaignSeed, context);
        break;
      case "faction":
        prompt = getFactionPrompt(campaignSeed, context);
        break;
      case "location":
        prompt = getLocationPrompt(campaignSeed, context);
        break;
      case "initial_world":
        prompt = getInitialWorldPrompt(campaignSeed);
        break;
      default:
        return errorResponse(400, "invalid_type", `Unknown generation type: ${type}`);
    }

    console.log("Generating world content", {
      requestId,
      userId,
      campaignId,
      type,
      campaignTitle: campaignSeed.title,
    });

    const model = resolveModel({ openai: "gpt-4o-mini", groq: "llama-3.3-70b-versatile" });
    let data;
    try {
      console.log("LLM model:", model);
      data = await aiChatCompletions({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 4096,
      });
    } catch (error) {
      console.error("world-generator downstream error", {
        requestId,
        userId,
        campaignId,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return errorResponse(500, "llm_error", "AI generation failed", {
        message: error instanceof Error ? error.message : error,
      });
    }
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    // Parse the JSON response
    let parsed;
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Invalid JSON response from AI");
    }

    const toKebab = (value: string): string =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    const createDeterministicPosition = (seed: string) => {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
      }
      return {
        x: 50 + (hash % 400),
        y: 50 + ((hash >>> 16) % 400),
      };
    };

    if (type === "initial_world") {
      if (!Array.isArray(parsed.locations) || parsed.locations.length === 0) {
        const fallbackName =
          typeof parsed.startingLocation?.name === "string"
            ? parsed.startingLocation.name
            : campaignSeed.title || "Starting Location";
        const fallbackDescription =
          typeof parsed.startingLocation?.description === "string"
            ? parsed.startingLocation.description
            : campaignSeed.description || "A place to begin the journey.";
        const fallbackType =
          typeof parsed.startingLocation?.type === "string"
            ? parsed.startingLocation.type.toLowerCase()
            : "town";
        parsed.locations = [
          {
            id: toKebab(fallbackName) || "starting-location",
            name: fallbackName,
            description: fallbackDescription,
            type: fallbackType,
            dangerLevel: 1,
            position: createDeterministicPosition(fallbackName),
            connectedTo: [],
          },
        ];
      }
    }

    if (type === "initial_world" && Array.isArray(parsed.locations)) {
      const seenIds = new Set<string>();
      const nameToId = new Map<string, string>();
      parsed.locations = parsed.locations.map((location: { id?: string; name?: string; position?: { x?: number; y?: number } }) => {
        const baseName = typeof location.name === "string" ? location.name : "location";
        let id = typeof location.id === "string" && location.id.trim().length > 0
          ? location.id
          : toKebab(baseName);

        if (!id) {
          id = `location-${seenIds.size + 1}`;
        }
        if (id === "starting_location") {
          id = toKebab(baseName) || `location-${seenIds.size + 1}`;
        }

        let uniqueId = id;
        let suffix = 1;
        while (seenIds.has(uniqueId)) {
          uniqueId = `${id}-${suffix}`;
          suffix += 1;
        }
        seenIds.add(uniqueId);
        nameToId.set(baseName.toLowerCase(), uniqueId);

        const pos = location.position;
        const position =
          typeof pos?.x === "number" && typeof pos?.y === "number"
            ? { x: pos.x, y: pos.y }
            : createDeterministicPosition(uniqueId);

        const normalizedType =
          typeof (location as { type?: string }).type === "string"
            ? (location as { type?: string }).type?.toLowerCase()
            : "town";

        return {
          ...location,
          id: uniqueId,
          position,
          type: normalizedType,
        };
      });

      parsed.locations = parsed.locations.map((location: { id: string; name?: string; connectedTo?: string[] }) => {
        const connectedTo = Array.isArray(location.connectedTo)
          ? location.connectedTo
              .map((entry) => {
                if (typeof entry !== "string") return null;
                if (seenIds.has(entry)) return entry;
                return nameToId.get(entry.toLowerCase()) ?? null;
              })
              .filter((entry): entry is string => Boolean(entry))
          : [];

        return {
          ...location,
          connectedTo,
        };
      });

      const ensureNamedLocation = (name: string, fallbackType: string) => {
        const existing = parsed.locations.find((loc: { name?: string }) =>
          typeof loc.name === "string" && loc.name.toLowerCase() === name.toLowerCase()
        );
        if (existing) return existing.id;
        const id = toKebab(name) || `location-${parsed.locations.length + 1}`;
        let uniqueId = id;
        let suffix = 1;
        while (seenIds.has(uniqueId)) {
          uniqueId = `${id}-${suffix}`;
          suffix += 1;
        }
        seenIds.add(uniqueId);
        nameToId.set(name.toLowerCase(), uniqueId);
        parsed.locations.push({
          id: uniqueId,
          name,
          description: `${name} stands as a notable waypoint within ${campaignSeed.description || "the campaign"}.`,
          type: fallbackType,
          dangerLevel: 1,
          position: createDeterministicPosition(uniqueId),
          connectedTo: [],
        });
        return uniqueId;
      };

      const outskirtsId = ensureNamedLocation("Outskirts", "wilderness");
      const townId = ensureNamedLocation("Town", "town");
      ensureNamedLocation("Roadside Shrine", "temple");

      const locations = parsed.locations as Array<{
        id: string;
        name?: string;
        description?: string;
        type?: string;
        dangerLevel?: number;
        position?: { x: number; y: number };
        connectedTo?: string[];
      }>;
      const locationTypes = ["town", "wilderness", "ruins", "temple", "cave", "castle"];
      const minimumLocations = 5;

      if (locations.length < minimumLocations) {
        for (let i = locations.length; i < minimumLocations; i++) {
          const suffix = i % locationTypes.length;
          const name = `${campaignSeed.title} ${locationTypes[suffix]}`;
          let id = toKebab(name) || `location-${i + 1}`;
          if (id === "starting_location") {
            id = `location-${i + 1}`;
          }
          let uniqueId = id;
          let counter = 1;
          while (seenIds.has(uniqueId)) {
            uniqueId = `${id}-${counter}`;
            counter += 1;
          }
          seenIds.add(uniqueId);
          nameToId.set(name.toLowerCase(), uniqueId);

          locations.push({
            id: uniqueId,
            name,
            description: `${name} stands as a notable waypoint within ${campaignSeed.description || "the campaign"}.`,
            type: locationTypes[suffix],
            dangerLevel: 1 + (i % 5),
            position: createDeterministicPosition(uniqueId),
            connectedTo: [],
          });
        }
      }

      if (locations.length > 1) {
        const byId = new Map(locations.map(location => [location.id, location]));
        for (const location of locations) {
          if (!Array.isArray(location.connectedTo) || location.connectedTo.length === 0) {
            const target = locations.find(candidate => candidate.id !== location.id);
            if (target) {
              location.connectedTo = [target.id];
            }
          }
        }
        for (const location of locations) {
          const connections = new Set(location.connectedTo ?? []);
          for (const targetId of connections) {
            const target = byId.get(targetId);
            if (target && target.id !== location.id) {
              const targetConnections = new Set(target.connectedTo ?? []);
              if (!targetConnections.has(location.id)) {
                targetConnections.add(location.id);
                target.connectedTo = Array.from(targetConnections);
              }
            }
          }
          location.connectedTo = Array.from(connections);
        }
      }

      const startId = typeof parsed.startingLocationId === "string" ? parsed.startingLocationId : outskirtsId;
      const startLocation = locations.find(loc => loc.id === startId) ?? locations[0];
      if (startLocation && townId) {
        const connected = new Set(startLocation.connectedTo ?? []);
        connected.add(townId);
        startLocation.connectedTo = Array.from(connected);
        const townLocation = locations.find(loc => loc.id === townId);
        if (townLocation) {
          const townConnections = new Set(townLocation.connectedTo ?? []);
          townConnections.add(startLocation.id);
          townLocation.connectedTo = Array.from(townConnections);
        }
      }

      if (typeof parsed.startingLocationId !== "string" || !seenIds.has(parsed.startingLocationId)) {
        parsed.startingLocationId = parsed.locations[0]?.id ?? null;
      }
    }

    if (type === "initial_world") {
      parsed.schemaVersion = "v2";
      const locations = Array.isArray(parsed.locations) ? parsed.locations : [];
      const locationIds = locations.map((loc: { id?: string }) => loc?.id).filter(Boolean);
      console.log("Initial world payload", {
        locationsCount: locations.length,
        locationIds,
        startingLocationId: parsed.startingLocationId ?? null,
      });
    }

    console.log(`Successfully generated ${type}`);

    return respondJson({ ok: true, type, content: parsed, requestId }, 200);
  } catch (error) {
    console.error("World generator error:", {
      requestId,
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse(
      500,
      "world_generator_error",
      error instanceof Error ? error.message : "Unknown error",
      error
    );
  }
});
