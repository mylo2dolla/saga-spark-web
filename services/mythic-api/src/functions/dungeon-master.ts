import { z } from "zod";

import { aiChatCompletionsStream, resolveModel } from "../shared/ai_provider.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(4000, "Message content too long"),
});

const PartyMemberSchema = z
  .object({
    name: z.string().max(100),
    class: z.string().max(50),
    level: z.number().int().min(1).max(20),
    hp: z.number().int().min(0),
    maxHp: z.number().int().min(1),
  })
  .passthrough();

const EnemySchema = z
  .object({
    name: z.string().max(100),
    hp: z.number().int().min(0),
    maxHp: z.number().int().min(1),
  })
  .passthrough();

const CombatEventSchema = z
  .object({
    type: z.string(),
    actor: z.string().optional(),
    target: z.string().optional(),
    ability: z.string().optional(),
    damage: z.number().optional(),
    healing: z.number().optional(),
    success: z.boolean().optional(),
    rolls: z
      .array(
        z.object({
          type: z.string(),
          result: z.number(),
          total: z.number(),
          isCritical: z.boolean().optional(),
          isFumble: z.boolean().optional(),
        }),
      )
      .optional(),
    description: z.string().optional(),
  })
  .passthrough();

const ContextSchema = z
  .object({
    party: z.array(PartyMemberSchema).max(10).optional(),
    location: z.string().max(200).optional(),
    campaignName: z.string().max(100).optional(),
    inCombat: z.boolean().optional(),
    enemies: z.array(EnemySchema).max(20).optional(),
    history: z.string().max(2000).optional(),
    combatEvents: z.array(CombatEventSchema).max(50).optional(),
    currentTurn: z.string().optional(),
    roundNumber: z.number().optional(),
  })
  .optional();

const RequestSchema = z.object({
  messages: z.array(MessageSchema).max(50, "Too many messages"),
  context: ContextSchema,
});

const DM_SYSTEM_PROMPT = `You are the Dungeon Master for MythWeaver, an immersive fantasy RPG. Your job is to:

- Narrate the world visually and dramatically, including exploration, dialogue, combat, and environmental effects.
- Manage combat events using exact values (damage, rolls, critical hits, misses, fumbles).
- Generate loot as tangible, actionable data, including stats and effects.
- Track XP and level-ups, updating stats and unlocking abilities appropriately.
- Handle skills and abilities, allowing characters to equip a limited number per level, unlock new abilities as they level up, and generate custom or class-based abilities.
- Populate dynamic environments in combat, including obstacles, terrain effects, and map/grid interactions.
- Track persistent data for all aspects of the game (party, map, campaign, loot, abilities, combat state) so it can be restored on re-entry.

Your response must always be a JSON object only with this structure:
{
  "narration": "Full narrative describing the scene, actions, environment, and combat events",
  "scene": {
    "type": "exploration" | "dialogue" | "combat",
    "mood": "tense" | "peaceful" | "mysterious" | "dangerous" | "celebratory",
    "location": "Brief location description",
    "environment": "Terrain, obstacles, tactical effects, and map features"
  },
  "npcs": [
    { "name": "NPC Name", "dialogue": "What they say", "attitude": "friendly" | "hostile" | "neutral" }
  ],
  "party": [
    { "name": "Character Name", "class": "Class", "level": 1, "hp": 10, "maxHp": 10, "abilities": ["Ability 1"], "xp": 0 }
  ],
  "effects": [
    { "target": "Character Name", "effect": "damage" | "heal" | "buff" | "debuff", "value": 5, "description": "Describe the effect including critical hits, misses, fumbles, environmental modifiers" }
  ],
  "loot": [
    { "name": "Item Name", "type": "weapon" | "armor" | "consumable" | "treasure", "description": "Detailed item description and stats if applicable", "stats": { "damage": "+2", "effect": "Flaming" } }
  ],
  "xpGained": 0,
  "levelUps": [
    { "character": "Character Name", "newLevel": 2, "gainedStats": {"strength": 1, "dexterity": 0, "constitution": 0, "intelligence": 0, "wisdom": 0, "charisma": 0}, "abilitiesGained": ["Ability Name"] }
  ],
  "map": {
    "type": "world" | "city" | "dungeon" | "combat",
    "tiles": [
      { "x": 0, "y": 0, "terrain": "tree" | "rock" | "river" | "floor" | "wall", "occupant": "Character or Enemy Name" | null, "blocked": true | false }
    ],
    "partyPositions": [
      { "name": "Character Name", "x": 0, "y": 0 }
    ],
    "enemyPositions": [
      { "name": "Enemy Name", "x": 1, "y": 2 }
    ]
  },
  "suggestions": ["Action suggestion 1", "Action suggestion 2", "Action suggestion 3"],
  "persistentData": {
    "party": [],
    "enemies": [],
    "loot": [],
    "mapState": {},
    "combatState": {}
  }
}

RULES:
1. Never use placeholders. All data must be real, actionable, and persistent.
2. Narrate everything visually with rich, evocative language.
3. Combat and skills: All rolls, criticals, misses, and environmental modifiers must be accounted for.
4. Level-ups: Automatically update stats and abilities; enforce ability limits per level.
5. Loot: Generate tangible items; allow unique effects but stats must exist.
6. Mapping: Track coordinates for all party members, enemies, obstacles, and items; update dynamically.
7. Environment affects mechanics: obstacles, walls, terrain, and objects should matter.
8. Maintain continuity and consistency across story, stats, map, and combat events.
9. If combat events exist in context, narrate using EXACT numbers provided.`;

const errMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return fallback;
};

export const dungeonMaster: FunctionHandler = {
  name: "dungeon-master",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    try {
      // Route middleware already enforces auth, but keep this as a defense-in-depth guard.
      const user = ctx.user ?? await requireUser(req.headers);

      const parseResult = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parseResult.success) {
        const details = parseResult.error.errors
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        return new Response(
          JSON.stringify({
            error: `Invalid request: ${details}`,
            code: "invalid_request",
            requestId: ctx.requestId,
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "x-request-id": ctx.requestId,
            },
          },
        );
      }

      const { messages, context } = parseResult.data;
      let systemPrompt = DM_SYSTEM_PROMPT;
      if (context) {
        const partySummary =
          context.party?.map((member) => `${member.name} (${member.class}, Level ${member.level}, HP: ${member.hp}/${member.maxHp})`).join(", ")
          ?? "Unknown";
        const enemySummary = context.inCombat && context.enemies
          ? context.enemies.map((enemy) => `${enemy.name} (HP: ${enemy.hp}/${enemy.maxHp})`).join(", ")
          : "";

        systemPrompt += `\n\nCONTEXT:
- Party Members: ${partySummary}
- Current Location: ${context.location ?? "Unknown"}
- Campaign: ${context.campaignName ?? "Unnamed Adventure"}
- In Combat: ${context.inCombat ? "Yes" : "No"}
${context.inCombat ? `- Round: ${context.roundNumber ?? 1}` : ""}
${context.inCombat && context.currentTurn ? `- Current Turn: ${context.currentTurn}` : ""}
${enemySummary ? `- Enemies: ${enemySummary}` : ""}
${context.history ? `- History: ${context.history}` : ""}`;

        if (context.combatEvents && context.combatEvents.length > 0) {
          const events = context.combatEvents
            .map((event) => {
              let line = `[${event.type.toUpperCase()}]`;
              if (event.actor) line += ` Actor: ${event.actor}`;
              if (event.target) line += ` -> Target: ${event.target}`;
              if (event.ability) line += ` | Ability: ${event.ability}`;
              if (event.rolls?.length) {
                const rolls = event.rolls
                  .map((roll) => `${roll.type || "d20"}=${roll.result}${roll.isCritical ? " CRITICAL!" : ""}${roll.isFumble ? " FUMBLE!" : ""} (total: ${roll.total})`)
                  .join(", ");
                line += ` | Rolls: ${rolls}`;
              }
              if (typeof event.damage === "number") line += ` | Damage: ${event.damage}`;
              if (typeof event.healing === "number") line += ` | Healing: ${event.healing}`;
              if (typeof event.success === "boolean") line += ` | Hit: ${event.success ? "YES" : "NO"}`;
              if (event.description) line += ` | ${event.description}`;
              return line;
            })
            .join("; ");

          systemPrompt += `\n- Combat Events: ${events}\nUse these EXACT values in narration.`;
        }
      }

      const model = resolveModel({ openai: "gpt-4o-mini", groq: "llama-3.3-70b-versatile" });
      ctx.log.info("dungeon_master.start", {
        request_id: ctx.requestId,
        user_id: user.userId,
        model,
        message_count: messages.length,
      });

      const response = await aiChatCompletionsStream({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      });

      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "x-request-id": ctx.requestId,
        },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId: ctx.requestId }), {
          status: error.status,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": ctx.requestId,
          },
        });
      }
      const normalized = sanitizeError(error);
      const message = errMessage(normalized, "Dungeon Master request failed");
      ctx.log.error("dungeon_master.failed", {
        request_id: ctx.requestId,
        code: normalized.code ?? "dungeon_master_failed",
        details: normalized.details ?? null,
      });
      return new Response(
        JSON.stringify({
          error: message,
          code: normalized.code ?? "dungeon_master_failed",
          requestId: ctx.requestId,
        }),
        {
          status: normalized.status && normalized.status >= 400 && normalized.status <= 599 ? normalized.status : 500,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": ctx.requestId,
          },
        },
      );
    }
  },
};

