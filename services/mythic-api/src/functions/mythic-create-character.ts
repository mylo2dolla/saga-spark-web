import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { AiProviderError, mythicOpenAIChatCompletions } from "../shared/ai_provider.js";
import { assertContentAllowed } from "../shared/content_policy.js";
import { clampInt, rngInt, rngPick, weightedPick } from "../shared/mythic_rng.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const TargetingEnum = z.enum(["self", "single", "tile", "area"]);
const SkillKindEnum = z.enum(["active", "passive", "ultimate", "crafting", "life"]);

const TargetingJsonSchema = z
  .object({
    shape: z.string().optional(),
    metric: z.string().optional(),
    radius: z.number().optional(),
    length: z.number().optional(),
    width: z.number().optional(),
    friendly_fire: z.boolean().optional(),
    requires_los: z.boolean().optional(),
    blocks_on_walls: z.boolean().optional(),
  })
  .passthrough();

const SkillSchema = z.object({
  kind: SkillKindEnum,
  targeting: TargetingEnum,
  targeting_json: TargetingJsonSchema.default({}),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(2000),
  range_tiles: z.number().int().min(0).max(999),
  cooldown_turns: z.number().int().min(0).max(999),
  cost_json: z.record(z.unknown()).default({}),
  effects_json: z.record(z.unknown()).default({}),
  scaling_json: z.record(z.unknown()).default({}),
  counterplay: z.record(z.unknown()).default({}),
  narration_style: z.string().min(1).max(80).default("comic-brutal"),
});

const ResponseSchema = z.object({
  class_name: z.string().min(1).max(60),
  class_description: z.string().min(1).max(2000),
  weapon_identity: z.object({
    family: z.enum(["blades", "axes", "blunt", "polearms", "ranged", "focus", "body", "absurd"]),
    notes: z.string().optional(),
  }),
  role: z.enum(["tank", "dps", "support", "controller", "skirmisher", "hybrid"]),
  base_stats: z.object({
    offense: z.number().int().min(0).max(100),
    defense: z.number().int().min(0).max(100),
    control: z.number().int().min(0).max(100),
    support: z.number().int().min(0).max(100),
    mobility: z.number().int().min(0).max(100),
    utility: z.number().int().min(0).max(100),
  }),
  resources: z.record(z.unknown()).default({}),
  weakness: z.object({
    id: z.string().min(1).max(80),
    description: z.string().min(1).max(2000),
    counterplay: z.string().min(1).max(2000),
  }),
  skills: z.array(SkillSchema).min(5).max(12),
});

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterName: z.string().min(2).max(60),
  classDescription: z.string().min(3).max(2000),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});

function normalizeConcept(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseWords(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return trimmed.slice(start, end + 1).trim();
}

function extractAssistantContent(payload: unknown): string | null {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim().length > 0) return content;
  if (!Array.isArray(content)) return null;
  const joined = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
      }
      return "";
    })
    .join("\n")
    .trim();
  return joined.length > 0 ? joined : null;
}

function deterministicRefinement(input: {
  classDescription: string;
  kit: ReturnType<typeof generateMechanicalKit>;
}): z.infer<typeof ResponseSchema> {
  const concept = normalizeConcept(input.classDescription);
  const conceptTitle = titleCaseWords(concept) || "Mythic Vanguard";
  const roleTitles: Record<z.infer<typeof ResponseSchema>["role"], string> = {
    tank: "Bulwark",
    dps: "Reaver",
    support: "Warden",
    controller: "Hexcaller",
    skirmisher: "Shadowrunner",
    hybrid: "Spellblade",
  };
  const className = `${conceptTitle} ${roleTitles[input.kit.role]}`.slice(0, 60).trim();
  const roleLine = {
    tank: "frontline pressure and denial",
    dps: "burst damage and target execution",
    support: "stabilization and team tempo",
    controller: "zone control and disruption",
    skirmisher: "flanking and hit-run pressure",
    hybrid: "mixed pressure with flexible utility",
  }[input.kit.role];

  const classDescription = [
    `A ${input.kit.role} kit forged from "${input.classDescription.trim()}".`,
    `This class specializes in ${roleLine}, pivots around ${String(input.kit.resources.primary_id).toUpperCase()}, and punishes indecision with ruthless tempo.`,
  ].join(" ");

  const verbsByTag: Record<string, string> = {
    damage: "carve",
    shield: "fortify",
    aoe: "blast",
    control: "pin",
    mobility: "slip",
    cleanse: "purge",
    heal: "stitch",
    ultimate: "erase",
    utility: "outplay",
  };

  const refinedSkills = input.kit.skills.map((skill, idx) => {
    const tags = Array.isArray((skill.effects_json as { tags?: unknown })?.tags)
      ? ((skill.effects_json as { tags: unknown[] }).tags.map((t) => String(t).toLowerCase()))
      : [];
    const actionVerb = tags.find((tag) => verbsByTag[tag]) ? verbsByTag[tags.find((tag) => verbsByTag[tag]) as string] : "strike";
    const prefix = skill.kind === "ultimate"
      ? "Final"
      : skill.kind === "passive"
        ? "Trait"
        : skill.kind === "life"
          ? "Instinct"
          : skill.kind === "crafting"
            ? "Craft"
            : "Skill";
    const generatedName = `${prefix} ${idx + 1}: ${actionVerb}`.slice(0, 80);
    const description = [
      `Uses ${String(input.kit.resources.primary_id).toUpperCase()} to ${actionVerb} with ${skill.targeting} targeting at range ${skill.range_tiles}.`,
      `Counterplay: ${typeof skill.counterplay === "object" ? "respect cooldown windows and positioning." : "track the timing and punish overcommit."}`,
    ].join(" ");
    return {
      ...skill,
      name: generatedName,
      description: description.slice(0, 2000),
    };
  });

  return {
    class_name: className,
    class_description: classDescription.slice(0, 2000),
    weapon_identity: {
      family: input.kit.weaponFamily,
      notes: `Deterministic fallback profile for ${conceptTitle}.`,
    },
    role: input.kit.role,
    base_stats: input.kit.baseStats,
    resources: input.kit.resources,
    weakness: input.kit.weakness,
    skills: refinedSkills,
  };
}

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function generateMechanicalKit(input: {
  seed: number;
  classDescription: string;
}): {
  role: "tank" | "dps" | "support" | "controller" | "skirmisher" | "hybrid";
  weaponFamily: "blades" | "axes" | "blunt" | "polearms" | "ranged" | "focus" | "body" | "absurd";
  baseStats: { offense: number; defense: number; control: number; support: number; mobility: number; utility: number };
  resources: Record<string, unknown>;
  weakness: { id: string; description: string; counterplay: string };
  skills: Array<Omit<z.infer<typeof SkillSchema>, "name" | "description"> & { name: string; description: string }>;
} {
  const concept = normalizeConcept(input.classDescription);
  const seed = input.seed;

  const role = weightedPick(seed, "class:role", [
    { item: "tank" as const, weight: hasAny(concept, ["tank", "guardian", "knight", "paladin", "bulwark"]) ? 6 : 1 },
    { item: "dps" as const, weight: hasAny(concept, ["assassin", "slayer", "berserk", "pyro", "hunter"]) ? 6 : 2 },
    { item: "support" as const, weight: hasAny(concept, ["cleric", "bard", "healer", "oracle", "saint"]) ? 6 : 1 },
    { item: "controller" as const, weight: hasAny(concept, ["mage", "witch", "warlock", "illusion", "necromancer"]) ? 6 : 2 },
    { item: "skirmisher" as const, weight: hasAny(concept, ["ninja", "rogue", "monk", "duelist", "scout"]) ? 6 : 2 },
    { item: "hybrid" as const, weight: hasAny(concept, ["hybrid", "spellblade", "battlemage", "shaman"]) ? 4 : 1 },
  ]);

  const weaponFamily = weightedPick(seed, "class:weapon_family", [
    { item: "focus" as const, weight: hasAny(concept, ["mage", "pyro", "necromancer", "warlock", "wizard"]) ? 6 : 2 },
    { item: "blades" as const, weight: hasAny(concept, ["ninja", "samurai", "duelist", "sword", "blade"]) ? 6 : 2 },
    { item: "ranged" as const, weight: hasAny(concept, ["archer", "gunslinger", "hunter", "ranger"]) ? 6 : 2 },
    { item: "axes" as const, weight: hasAny(concept, ["berserk", "barbarian", "axe"]) ? 6 : 1 },
    { item: "blunt" as const, weight: hasAny(concept, ["cleric", "paladin", "hammer", "mace"]) ? 5 : 2 },
    { item: "polearms" as const, weight: hasAny(concept, ["lancer", "spear", "halberd"]) ? 5 : 1 },
    { item: "body" as const, weight: hasAny(concept, ["werewolf", "slime", "monster", "claw", "beast"]) ? 7 : 1 },
    { item: "absurd" as const, weight: hasAny(concept, ["absurd", "meme", "clown", "chef"]) ? 7 : 1 },
  ]);

  const baseline = { offense: 45, defense: 45, control: 45, support: 45, mobility: 45, utility: 45 };
  const roleDelta: Record<typeof role, Partial<typeof baseline>> = {
    tank: { defense: 25, support: 10, offense: -10, mobility: -10 },
    dps: { offense: 25, mobility: 10, defense: -10, support: -5 },
    support: { support: 25, utility: 10, offense: -10 },
    controller: { control: 25, utility: 10, defense: -10 },
    skirmisher: { mobility: 25, offense: 10, defense: -10 },
    hybrid: { offense: 10, defense: 10, control: 10, support: 10, mobility: 10, utility: 10 },
  };

  const jitter = (k: string) => rngInt(seed, `stat:jitter:${k}`, -8, 8);
  const baseStats = {
    offense: clampInt(baseline.offense + (roleDelta[role].offense ?? 0) + jitter("offense"), 0, 100),
    defense: clampInt(baseline.defense + (roleDelta[role].defense ?? 0) + jitter("defense"), 0, 100),
    control: clampInt(baseline.control + (roleDelta[role].control ?? 0) + jitter("control"), 0, 100),
    support: clampInt(baseline.support + (roleDelta[role].support ?? 0) + jitter("support"), 0, 100),
    mobility: clampInt(baseline.mobility + (roleDelta[role].mobility ?? 0) + jitter("mobility"), 0, 100),
    utility: clampInt(baseline.utility + (roleDelta[role].utility ?? 0) + jitter("utility"), 0, 100),
  };

  const resourceId = weightedPick(seed, "class:resource", [
    { item: "rage", weight: hasAny(concept, ["werewolf", "berserk", "barbarian", "beast"]) ? 7 : 1 },
    { item: "mana", weight: hasAny(concept, ["mage", "pyro", "wizard", "warlock"]) ? 7 : 2 },
    { item: "stamina", weight: hasAny(concept, ["ninja", "rogue", "monk", "fighter"]) ? 6 : 3 },
    { item: "heat", weight: hasAny(concept, ["pyro", "fire", "flame"]) ? 7 : 1 },
    { item: "focus", weight: hasAny(concept, ["sniper", "duelist", "marksman"]) ? 6 : 2 },
    { item: "blood", weight: hasAny(concept, ["necromancer", "blood", "vampire"]) ? 6 : 1 },
  ]);

  const resources = {
    primary_id: resourceId,
    bars: [
      {
        id: resourceId,
        name: resourceId.toUpperCase(),
        current: 50,
        max: 100,
        regen_per_turn: resourceId === "mana" ? 8 : 0,
        tags: [resourceId],
      },
    ],
  };

  const weakness = (() => {
    if (hasAny(concept, ["werewolf", "lycan"])) {
      return {
        id: "silver_scar",
        description: "Silver wounds ignore a chunk of your defenses and make your power bar bleed out.",
        counterplay: "Break line-of-sight, burst them first, and use movement tools to avoid silver-tag hits.",
      };
    }
    if (hasAny(concept, ["pyro", "fire", "flame"])) {
      return {
        id: "overheat",
        description: "Repeated casts stack HEAT until you overheat, briefly weakening your defenses and scrambling your aim.",
        counterplay: "Weave downtime turns, use cooldown windows, and reposition to buy breathing room.",
      };
    }
    if (hasAny(concept, ["ninja", "rogue", "assassin"])) {
      return {
        id: "glass_blade",
        description: "If you get pinned or revealed, you melt. Hard. Your kit assumes you move first.",
        counterplay: "Do not face-tank. Abuse smoke/cover and prioritize disengage tools.",
      };
    }
    return rngPick(seed, "class:weakness", [
      {
        id: "telegraphed_power",
        description: "Your big hits are loud and readable. Enemies can dodge or counter if you get greedy.",
        counterplay: "Bait reactions, then punish during their recovery.",
      },
      {
        id: "resource_crash",
        description: "If you empty your bar, you enter a crash where your output sputters for a turn.",
        counterplay: "Always keep a reserve. Finish fights without going broke.",
      },
      {
        id: "ritual_setup",
        description: "Your best plays need setup. If interrupted, you waste turns and look stupid.",
        counterplay: "Control the grid first. Then do the fancy thing.",
      },
    ]);
  })();

  const primary = resourceId;
  const mkCost = (amount: number) => ({ resource_id: primary, amount, type: "flat", when: "on_cast" });

  // Mechanics-first skeleton; names/descriptions will be rewritten by the LLM.
  const skills = [
    // Passives
    {
      kind: "passive" as const,
      targeting: "self" as const,
      targeting_json: { shape: "self", metric: "manhattan" },
      name: "Passive A",
      description: "Passive A description.",
      range_tiles: 0,
      cooldown_turns: 0,
      cost_json: {},
      effects_json: {
        tags: ["passive"],
        bonuses: [{ stat: role === "tank" ? "defense" : "offense", add: 6 }],
      },
      scaling_json: { scales_with: [role === "tank" ? "defense" : "offense"], curve: "power_at_level" },
      counterplay: { countered_by: ["dispel", "burst"], notes: "Passive power is consistent but not explosive." },
      narration_style: "comic-brutal",
    },
    {
      kind: "passive" as const,
      targeting: "self" as const,
      targeting_json: { shape: "self", metric: "manhattan" },
      name: "Passive B",
      description: "Passive B description.",
      range_tiles: 0,
      cooldown_turns: 0,
      cost_json: {},
      effects_json: {
        tags: ["passive"],
        triggers: ["on_crit", "on_kill", "on_block"],
        weakness_hook: weakness.id,
      },
      scaling_json: { scales_with: ["utility"], curve: "power_at_level" },
      counterplay: { countered_by: ["deny_triggers"], notes: "Shuts off if the enemy plays clean." },
      narration_style: "comic-brutal",
    },

    // Actives
    {
      kind: "active" as const,
      targeting: "single" as const,
      targeting_json: { shape: "single", metric: "manhattan", requires_los: true, blocks_on_walls: true },
      name: "Strike",
      description: "A basic single-target strike.",
      range_tiles: weaponFamily === "ranged" ? 6 : 1,
      cooldown_turns: 0,
      cost_json: mkCost(5),
      effects_json: {
        tags: ["damage"],
        base: 8,
        stat: role === "support" ? "support" : "offense",
        type: weaponFamily === "focus" ? "arcane" : "physical",
      },
      scaling_json: { scales_with: [role === "support" ? "support" : "offense"], curve: "power_at_level" },
      counterplay: { countered_by: ["armor", "cover"], notes: "Line-of-sight matters." },
      narration_style: "comic-brutal",
    },
    {
      kind: "active" as const,
      targeting: "tile" as const,
      targeting_json: { shape: "area", metric: "manhattan", radius: 1, friendly_fire: false, requires_los: true },
      name: "Pressure Wave",
      description: "Area pressure effect.",
      range_tiles: 4,
      cooldown_turns: 2,
      cost_json: mkCost(15),
      effects_json: {
        tags: ["damage", "control"],
        base: 6,
        stat: role === "controller" ? "control" : "offense",
        status: { id: "stagger", turns: 1 },
      },
      scaling_json: { scales_with: [role === "controller" ? "control" : "offense"], curve: "power_at_level" },
      counterplay: { countered_by: ["spread_out"], notes: "Do not clump up." },
      narration_style: "comic-brutal",
    },
    {
      kind: "active" as const,
      targeting: "self" as const,
      targeting_json: { shape: "self", metric: "manhattan" },
      name: "Guard",
      description: "Defensive stance.",
      range_tiles: 0,
      cooldown_turns: 3,
      cost_json: mkCost(10),
      effects_json: {
        tags: ["defense"],
        shield: { amount: 10, turns: 2 },
        weakness_exploit: weakness.id,
      },
      scaling_json: { scales_with: ["defense"], curve: "power_at_level" },
      counterplay: { countered_by: ["pierce", "dispel"], notes: "Shield can be broken." },
      narration_style: "comic-brutal",
    },
    {
      kind: "ultimate" as const,
      targeting: "area" as const,
      targeting_json: { shape: "area", metric: "manhattan", radius: 2, friendly_fire: false, requires_los: true },
      name: "Ultimate",
      description: "Big finishing move.",
      range_tiles: 5,
      cooldown_turns: 6,
      cost_json: mkCost(35),
      effects_json: {
        tags: ["damage", "execute"],
        base: 18,
        stat: role === "support" ? "support" : role === "controller" ? "control" : "offense",
        type: weaponFamily === "focus" ? "arcane" : "physical",
        weakness_exploit: weakness.id,
      },
      scaling_json: { scales_with: [role === "support" ? "support" : role === "controller" ? "control" : "offense"], curve: "power_at_level" },
      counterplay: { countered_by: ["interrupt", "spread_out"], notes: "Telegraphed; punish overcommit." },
      narration_style: "comic-brutal",
    },
  ];

  return {
    role,
    weaponFamily,
    baseStats,
    resources,
    weakness,
    skills,
  };
}

export const mythicCreateCharacter: FunctionHandler = {
  name: "mythic-create-character",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    try {
      const user = await requireUser(req.headers);

      const parsedBody = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsedBody.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsedBody.error.flatten(), requestId: ctx.requestId }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { campaignId, characterName, classDescription } = parsedBody.data;
      const seed = parsedBody.data.seed ?? rngInt(Date.now() % 2147483647, `seed:${campaignId}:${user.userId}`, 0, 2147483647);

      const svc = createServiceClient();
      await assertCampaignAccess(svc, campaignId, user.userId);

      const kit = generateMechanicalKit({ seed, classDescription });

      // Fetch canonical rules/script for prompt grounding.
      const { data: rulesRow, error: rulesError } = await svc
        .schema("mythic")
        .from("game_rules")
        .select("rules")
        .eq("name", "mythic-weave-rules-v1")
        .maybeSingle();
      if (rulesError) throw rulesError;

      const { data: scriptRow, error: scriptError } = await svc
        .schema("mythic")
        .from("generator_scripts")
        .select("content")
        .eq("name", "mythic-weave-core")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (scriptError) throw scriptError;

      const canonicalRules = rulesRow?.rules ? JSON.stringify(rulesRow.rules) : "{}";
      const canonicalScript = scriptRow?.content ?? "";

      // Ask OpenAI to rewrite names/descriptions only; mechanics stay deterministic.
      const systemPrompt = `You are generating a Mythic Weave class kit.\\n\\nCANONICAL GENERATOR SCRIPT (authoritative):\\n${canonicalScript}\\n\\nCANONICAL RULES JSON (authoritative):\\n${canonicalRules}\\n\\nTASK:\\n- You will receive a deterministic mechanics skeleton JSON (numbers, cooldowns, targeting, costs, effects_json/scaling_json/counterplay).\\n- Do NOT change any numeric values, cooldowns, range_tiles, targeting, targeting_json, or cost_json.\\n- Improve ONLY these fields: class_name, class_description, weapon_identity.notes (optional), weakness.description/counterplay (may rephrase but keep meaning), each skill.name, each skill.description.\\n- Tone: living comic book, mischievous ruthless DM energy. Use onomatopoeia inside descriptions sparingly.\\n- NO sexual content. NO sexual violence. Violence/gore allowed. Profanity allowed.\\n\\nOutput MUST be ONLY valid JSON matching this schema:\\n{\\n  \"class_name\": string,\\n  \"class_description\": string,\\n  \"weapon_identity\": {\"family\": string, \"notes\"?: string},\\n  \"role\": string,\\n  \"base_stats\": {offense:int, defense:int, control:int, support:int, mobility:int, utility:int},\\n  \"resources\": object,\\n  \"weakness\": {id:string, description:string, counterplay:string},\\n  \"skills\": [ {kind, targeting, targeting_json, name, description, range_tiles, cooldown_turns, cost_json, effects_json, scaling_json, counterplay, narration_style} ]\\n}`;

      const skeleton = {
        class_name: "",
        class_description: "",
        weapon_identity: { family: kit.weaponFamily },
        role: kit.role,
        base_stats: kit.baseStats,
        resources: kit.resources,
        weakness: kit.weakness,
        skills: kit.skills,
      };

      const warnings: string[] = [];
      let provider = "openai";
      let model = "gpt-4o-mini";
      let refinedData: z.infer<typeof ResponseSchema> = deterministicRefinement({ classDescription, kit });
      try {
        const completion = await mythicOpenAIChatCompletions(
          {
            temperature: 0.2,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `CLASS CONCEPT: ${classDescription}\\nSEED: ${seed}\\n\\nMECHANICS SKELETON (do not change numbers):\\n${JSON.stringify(skeleton)}`,
              },
            ],
          },
          "gpt-4o-mini",
        );
        provider = completion.provider;
        model = completion.model;
        const content = extractAssistantContent(completion.data);
        if (!content) {
          throw new Error("OpenAI returned an empty response for class refinement");
        }
        const jsonText = extractJsonObject(content);
        if (!jsonText) {
          throw new Error("OpenAI response was not valid JSON");
        }
        const parsedJson = JSON.parse(jsonText);
        const refined = ResponseSchema.safeParse(parsedJson);
        if (!refined.success) {
          throw new Error(`OpenAI output failed schema validation: ${JSON.stringify(refined.error.flatten())}`);
        }
        refinedData = refined.data;
      } catch (error) {
        if (error instanceof AiProviderError && error.code === "openai_not_configured") {
          throw error;
        }
        const normalized = sanitizeError(error);
        const message = (normalized.message || "OpenAI refinement failed").slice(0, 220);
        warnings.push(`openai_refinement_fallback:${message}`);
        ctx.log.warn("create_character.refinement_fallback", {
          request_id: ctx.requestId,
          reason: message,
        });
      }

      // Enforce content policy on stored text fields.
      assertContentAllowed([
        { path: "class_name", value: refinedData.class_name },
        { path: "class_description", value: refinedData.class_description },
        { path: "weakness.description", value: refinedData.weakness.description },
        { path: "weakness.counterplay", value: refinedData.weakness.counterplay },
        ...refinedData.skills.flatMap((s, idx) => [
          { path: `skills[${idx}].name`, value: s.name },
          { path: `skills[${idx}].description`, value: s.description },
        ]),
      ]);

      // Persist character and skills.
      const classJson = {
        class_name: refinedData.class_name,
        class_description: refinedData.class_description,
        role: refinedData.role,
        weapon_identity: refinedData.weapon_identity,
        weakness: refinedData.weakness,
        seed,
        concept: classDescription,
      };

      const normalizeResources = (
        refinedResources: Record<string, unknown>,
        existing: Record<string, unknown> | null,
      ): Record<string, unknown> => {
        const next: Record<string, unknown> = { ...refinedResources };
        const refinedCoins = Number(next.coins);
        const existingCoins = existing ? Number(existing.coins) : Number.NaN;
        const chosen = Number.isFinite(existingCoins) ? existingCoins : Number.isFinite(refinedCoins) ? refinedCoins : 100;
        next.coins = Math.max(0, Math.floor(chosen));
        return next;
      };

      // Create new or update existing by player+campaign+name.
      const { data: existingChars, error: existingError } = await svc
        .schema("mythic")
        .from("characters")
        .select("id, resources")
        .eq("campaign_id", campaignId)
        .eq("player_id", user.userId)
        .eq("name", characterName)
        .limit(1);
      if (existingError) throw existingError;

      let characterId: string;
      const refinedResources = refinedData.resources as unknown as Record<string, unknown>;
      let finalResources = normalizeResources(refinedResources, null);
      if (existingChars && existingChars.length > 0) {
        characterId = existingChars[0]!.id as string;
        const existingResources =
          existingChars[0] && typeof (existingChars[0] as { resources?: unknown }).resources === "object"
            ? ((existingChars[0] as { resources?: Record<string, unknown> }).resources ?? null)
            : null;
        const mergedResources = normalizeResources(refinedResources, existingResources);
        finalResources = mergedResources;
        const { error: updErr } = await svc
          .schema("mythic")
          .from("characters")
          .update({
            level: 1,
            offense: refinedData.base_stats.offense,
            defense: refinedData.base_stats.defense,
            control: refinedData.base_stats.control,
            support: refinedData.base_stats.support,
            mobility: refinedData.base_stats.mobility,
            utility: refinedData.base_stats.utility,
            class_json: classJson,
            resources: mergedResources,
            updated_at: new Date().toISOString(),
          })
          .eq("id", characterId);
        if (updErr) throw updErr;

        // Delete old skills for this character (skills are not append-only; safe to rebuild kit).
        const { error: delSkillsErr } = await svc
          .schema("mythic")
          .from("skills")
          .delete()
          .eq("character_id", characterId);
        if (delSkillsErr) throw delSkillsErr;
      } else {
        const mergedResources = normalizeResources(refinedResources, null);
        finalResources = mergedResources;
        const { data: inserted, error: insErr } = await svc
          .schema("mythic")
          .from("characters")
          .insert({
            campaign_id: campaignId,
            player_id: user.userId,
            name: characterName,
            level: 1,
            offense: refinedData.base_stats.offense,
            defense: refinedData.base_stats.defense,
            control: refinedData.base_stats.control,
            support: refinedData.base_stats.support,
            mobility: refinedData.base_stats.mobility,
            utility: refinedData.base_stats.utility,
            class_json: classJson,
            resources: mergedResources,
            derived_json: {},
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        characterId = inserted.id as string;
      }

      const skillRows = refinedData.skills.map((s) => ({
        campaign_id: campaignId,
        character_id: characterId,
        kind: s.kind,
        targeting: s.targeting,
        targeting_json: s.targeting_json,
        name: s.name,
        description: s.description,
        range_tiles: s.range_tiles,
        cooldown_turns: s.cooldown_turns,
        cost_json: s.cost_json,
        effects_json: s.effects_json,
        scaling_json: s.scaling_json,
        counterplay: s.counterplay,
        narration_style: s.narration_style,
      }));

      const { data: insertedSkills, error: insSkillsErr } = await svc
        .schema("mythic")
        .from("skills")
        .insert(skillRows)
        .select("id");
      if (insSkillsErr) throw insSkillsErr;

      return new Response(
        JSON.stringify({
          character_id: characterId,
          seed,
          class: {
            class_name: refinedData.class_name,
            class_description: refinedData.class_description,
            role: refinedData.role,
            weapon_identity: refinedData.weapon_identity,
            weakness: refinedData.weakness,
            base_stats: refinedData.base_stats,
            resources: finalResources,
          },
          skills: refinedData.skills,
          skill_ids: insertedSkills?.map((r) => (r as { id: string }).id) ?? [],
          warnings,
          provider,
          model,
          requestId: ctx.requestId,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        const message = code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code, requestId: ctx.requestId }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId: ctx.requestId }), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const normalized = sanitizeError(error);
      const code = normalized.code ?? "create_character_failed";
      const status = code === "openai_not_configured" ? 503 : code === "openai_request_failed" ? 502 : 500;
      ctx.log.error("create_character.failed", { request_id: ctx.requestId, error: normalized.message, code });
      return new Response(
        JSON.stringify({
          error: normalized.message || "Failed to create character",
          code,
          requestId: ctx.requestId,
        }),
        { status, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
