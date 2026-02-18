import { aiChatCompletions, resolveModel } from "../shared/ai_provider.js";
import { redactValue } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

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

function getFactionPrompt(seed: CampaignSeed) {
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

function respondJson(payload: unknown, requestId: string, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "x-request-id": requestId },
  });
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // Handle fenced blocks.
  const fenceStart = trimmed.indexOf("```");
  if (fenceStart >= 0) {
    const fenceEnd = trimmed.lastIndexOf("```");
    if (fenceEnd > fenceStart) {
      const inner = trimmed.slice(fenceStart + 3, fenceEnd).trim();
      // Strip optional language hint.
      const firstNewline = inner.indexOf("\n");
      if (firstNewline >= 0 && /^[a-zA-Z0-9_-]+$/.test(inner.slice(0, firstNewline).trim())) {
        return inner.slice(firstNewline + 1).trim();
      }
      return inner;
    }
  }
  return trimmed;
}

function toKebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createDeterministicPosition(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return {
    x: 50 + (hash % 400),
    y: 50 + ((hash >>> 16) % 400),
  };
}

export const worldGenerator: FunctionHandler = {
  name: "world-generator",
  auth: "optional",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;

    const errorResponse = (status: number, code: string, message: string, details?: unknown) =>
      respondJson({ ok: false, code, message, details, requestId }, requestId, status);

    try {
      let payload: GenerationRequest;
      try {
        payload = (await req.json()) as GenerationRequest;
      } catch {
        return errorResponse(400, "invalid_json", "Request body must be valid JSON");
      }

      const type = payload?.type;
      const campaignSeed = payload?.campaignSeed;
      const context = payload?.context;

      if (!type || typeof type !== "string") {
        return errorResponse(400, "invalid_type", "Unsupported generation type", { type });
      }
      if (!campaignSeed || typeof campaignSeed.title !== "string" || typeof campaignSeed.description !== "string") {
        return errorResponse(400, "invalid_seed", "campaignSeed.title and campaignSeed.description are required");
      }

      const hasOpenAI = Boolean((process.env.OPENAI_API_KEY ?? "").trim());
      const hasGroq = Boolean((process.env.GROQ_API_KEY ?? "").trim());
      if (!hasOpenAI && !hasGroq) {
        return errorResponse(500, "missing_env", "Missing required env vars: OPENAI_API_KEY|GROQ_API_KEY");
      }

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
          prompt = getFactionPrompt(campaignSeed);
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

      ctx.log.info("world_generator.request", {
        request_id: requestId,
        user_id: ctx.user?.userId ?? null,
        campaign_id: context?.campaignId ?? null,
        type,
        campaign_title: campaignSeed.title,
      });

      const model = resolveModel({ openai: "gpt-4o-mini", groq: "llama-3.3-70b-versatile" });
      let data: any;
      try {
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
        return errorResponse(500, "llm_error", "AI generation failed", redactValue({ message: error instanceof Error ? error.message : String(error) }));
      }

      const content = data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        return errorResponse(500, "empty_ai_response", "AI returned empty response");
      }

      const jsonCandidate = extractJsonCandidate(content);
      let parsed: any;
      try {
        parsed = JSON.parse(jsonCandidate);
      } catch (error) {
        return errorResponse(500, "invalid_ai_json", "Invalid JSON response from AI", jsonCandidate.slice(0, 500));
      }

      // Minimal normalization for stability (mirrors edge intent).
      if (type === "location") {
        if (typeof parsed.id !== "string" && typeof parsed.name === "string") {
          parsed.id = toKebab(parsed.name);
        }
        if (!parsed.position || typeof parsed.position !== "object") {
          parsed.position = createDeterministicPosition(`${campaignSeed.title}:${parsed.id ?? parsed.name ?? "loc"}`);
        }
      }

      if (type === "initial_world") {
        parsed.schemaVersion = "v2";
        const locations = Array.isArray(parsed.locations) ? parsed.locations : [];
        const seenIds = new Set<string>();
        for (const loc of locations) {
          if (!loc || typeof loc !== "object") continue;
          if (typeof loc.id !== "string" && typeof loc.name === "string") {
            loc.id = toKebab(loc.name);
          }
          if (typeof loc.id === "string") seenIds.add(loc.id);
          if (!loc.position || typeof loc.position !== "object") {
            loc.position = createDeterministicPosition(`${campaignSeed.title}:${loc.id ?? loc.name ?? "loc"}`);
          }
          if (!Array.isArray(loc.connectedTo)) loc.connectedTo = [];
        }
        if (typeof parsed.startingLocationId !== "string" || !seenIds.has(parsed.startingLocationId)) {
          parsed.startingLocationId = locations[0]?.id ?? null;
        }
      }

      return respondJson({ ok: true, type, content: parsed, requestId }, requestId, 200);
    } catch (error) {
      ctx.log.error("world_generator.failed", { request_id: requestId, error: error instanceof Error ? error.message : String(error) });
      return respondJson(
        { ok: false, code: "world_generator_error", message: error instanceof Error ? error.message : "Unknown error", details: redactValue(error), requestId },
        requestId,
        500,
      );
    }
  },
};

