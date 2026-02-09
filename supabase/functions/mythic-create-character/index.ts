import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiChatCompletions, resolveModel } from "../_shared/ai_provider.ts";
import { assertContentAllowed } from "../_shared/content_policy.ts";
import { clampInt, rngInt, rngPick, weightedPick } from "../_shared/mythic_rng.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  classDescription: z.string().min(3).max(500),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});

function normalizeConcept(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      targeting: "tile" as const,
      targeting_json: { shape: "line", metric: "manhattan", length: 4, width: 1, friendly_fire: false, requires_los: false, blocks_on_walls: true },
      name: "Reposition",
      description: "Movement tool.",
      range_tiles: 4,
      cooldown_turns: 2,
      cost_json: mkCost(10),
      effects_json: { tags: ["movement"], move: { dash_tiles: 3 }, onomatopoeia: "WHOOSH!" },
      scaling_json: { scales_with: ["mobility"], curve: "power_at_level" },
      counterplay: { avoided_by: ["root"], notes: "Root/stun stops reposition." },
      narration_style: "comic-brutal",
    },
    {
      kind: "active" as const,
      targeting: "self" as const,
      targeting_json: { shape: "self", metric: "manhattan" },
      name: "Guard",
      description: "Defense tool.",
      range_tiles: 0,
      cooldown_turns: 3,
      cost_json: mkCost(12),
      effects_json: { tags: ["defense"], barrier: { amount: 20, duration_turns: 2 }, weakness_hook: weakness.id },
      scaling_json: { scales_with: ["defense", "support"], curve: "power_at_level" },
      counterplay: { countered_by: ["pierce", "dispel"], notes: "Piercing attacks reduce barrier." },
      narration_style: "comic-brutal",
    },
    {
      kind: "active" as const,
      targeting: "single" as const,
      targeting_json: { shape: "single", metric: "manhattan", requires_los: true },
      name: "Burst Strike",
      description: "Burst tool.",
      range_tiles: weaponFamily === "ranged" ? 5 : 1,
      cooldown_turns: 1,
      cost_json: mkCost(15),
      effects_json: { tags: ["burst"], damage: { skill_mult: 1.35, tags: [weaponFamily, "physical"] }, gore: true },
      scaling_json: { scales_with: ["offense"], curve: "power_at_level" },
      counterplay: { avoided_by: ["dodge", "block"], notes: "Telegraphed burst can be punished." },
      narration_style: "comic-brutal",
    },
    {
      kind: "active" as const,
      targeting: "area" as const,
      targeting_json: { shape: "area", metric: "manhattan", radius: 1, friendly_fire: false, requires_los: false, blocks_on_walls: true },
      name: "Disrupt",
      description: "Control/utility tool.",
      range_tiles: 4,
      cooldown_turns: 3,
      cost_json: mkCost(18),
      effects_json: {
        tags: ["control"],
        status: { id: "stun", duration_turns: 1, stacking: "none" },
        apply_chance: { function: "mythic.status_apply_chance", uses: ["control", "utility"] },
      },
      scaling_json: { scales_with: ["control", "utility"], curve: "power_at_level" },
      counterplay: { resisted_by: ["resolve"], notes: "Resolve/resist reduces chance." },
      narration_style: "comic-brutal",
    },
    {
      kind: "active" as const,
      targeting: "single" as const,
      targeting_json: { shape: "single", metric: "manhattan", requires_los: true },
      name: "Weakness Exploit",
      description: "Utility tool that bakes in the weakness-by-design.",
      range_tiles: 3,
      cooldown_turns: 2,
      cost_json: mkCost(10),
      effects_json: {
        tags: ["utility"],
        self_debuff: { id: weakness.id, intensity: 1, duration_turns: 1 },
        bonus: { crit_chance_add: 0.12, note: "High reward, self-exposure." },
        onomatopoeia: "CLICK-CLACK!",
      },
      scaling_json: { scales_with: ["utility", "mobility"], curve: "power_at_level" },
      counterplay: { punished_by: ["focus_fire"], notes: "Self-exposure invites punishment." },
      narration_style: "comic-brutal",
    },

    // Ultimate
    {
      kind: "ultimate" as const,
      targeting: "area" as const,
      targeting_json: { shape: "cone", metric: "manhattan", length: 5, width: 3, friendly_fire: false, requires_los: false, blocks_on_walls: true },
      name: "Ultimate",
      description: "Dramatic, risky, consequence-heavy.",
      range_tiles: 5,
      cooldown_turns: 5,
      cost_json: mkCost(40),
      effects_json: {
        tags: ["ultimate"],
        damage: { skill_mult: 2.2, tags: [weaponFamily, "finisher"] },
        drawback: { id: weakness.id, intensity: 2, duration_turns: 2 },
        world_reaction: { note: "The DM notices. Factions notice. The world notices." },
        onomatopoeia: "KRA-KADOOM!!",
      },
      scaling_json: { scales_with: ["offense", "utility"], curve: "power_at_level" },
      counterplay: { avoided_by: ["spread_out"], notes: "Cone/area can be dodged by positioning." },
      narration_style: "comic-brutal",
    },
  ];

  // Ensure weakness is embedded in 2+ skills.
  // Guard + Weakness Exploit + Ultimate already reference weakness.id.

  return {
    role,
    weaponFamily,
    baseStats,
    resources,
    weakness,
    skills,
  };
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

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsedBody = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsedBody.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaignId, characterName, classDescription } = parsedBody.data;
    const seed = parsedBody.data.seed ?? rngInt(Date.now() % 2147483647, `seed:${campaignId}:${user.id}`, 0, 2147483647);

    // Service role client for mythic schema.
    const svc = createClient(supabaseUrl, serviceRoleKey);

    // Ensure member/owner.
    const { data: campaign } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();

    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: member } = await svc
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member && campaign.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized for this campaign" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const kit = generateMechanicalKit({ seed, classDescription });

    // Fetch canonical rules/script for prompt grounding.
    const { data: rulesRow, error: rulesError } = await svc
      .from("mythic.game_rules")
      .select("rules")
      .eq("name", "mythic-weave-rules-v1")
      .maybeSingle();
    if (rulesError) throw rulesError;

    const { data: scriptRow, error: scriptError } = await svc
      .from("mythic.generator_scripts")
      .select("content")
      .eq("name", "mythic-weave-core")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (scriptError) throw scriptError;

    const canonicalRules = rulesRow?.rules ? JSON.stringify(rulesRow.rules) : "{}";
    const canonicalScript = scriptRow?.content ?? "";

    // Ask Groq to rewrite names/descriptions only; mechanics are deterministic.
    const systemPrompt = `You are generating a Mythic Weave class kit.\n\nCANONICAL GENERATOR SCRIPT (authoritative):\n${canonicalScript}\n\nCANONICAL RULES JSON (authoritative):\n${canonicalRules}\n\nTASK:\n- You will receive a deterministic mechanics skeleton JSON (numbers, cooldowns, targeting, costs, effects_json/scaling_json/counterplay).\n- Do NOT change any numeric values, cooldowns, range_tiles, targeting, targeting_json, or cost_json.\n- Improve ONLY these fields: class_name, class_description, weapon_identity.notes (optional), weakness.description/counterplay (may rephrase but keep meaning), each skill.name, each skill.description.\n- Tone: living comic book, mischievous ruthless DM energy. Use onomatopoeia inside descriptions sparingly.\n- NO sexual content. NO sexual violence. Violence/gore allowed. Profanity allowed.\n\nOutput MUST be ONLY valid JSON matching this schema:\n{\n  \"class_name\": string,\n  \"class_description\": string,\n  \"weapon_identity\": {\"family\": string, \"notes\"?: string},\n  \"role\": string,\n  \"base_stats\": {offense:int, defense:int, control:int, support:int, mobility:int, utility:int},\n  \"resources\": object,\n  \"weakness\": {id:string, description:string, counterplay:string},\n  \"skills\": [ {kind, targeting, targeting_json, name, description, range_tiles, cooldown_turns, cost_json, effects_json, scaling_json, counterplay, narration_style} ]\n}`;

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

    const model = resolveModel({ openai: "gpt-4o-mini", groq: "llama-3.3-70b-versatile" });

    const completion = await aiChatCompletions({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `CLASS CONCEPT: ${classDescription}\nSEED: ${seed}\n\nMECHANICS SKELETON (do not change numbers):\n${JSON.stringify(skeleton)}`,
        },
      ],
    });

    const content = completion?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No response from AI");

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI response was not valid JSON");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error("AI returned malformed JSON");
    }

    const refined = ResponseSchema.safeParse(parsedJson);
    if (!refined.success) {
      throw new Error(`AI output failed schema validation: ${JSON.stringify(refined.error.flatten())}`);
    }

    // Enforce content policy on stored text fields.
    assertContentAllowed([
      { path: "class_name", value: refined.data.class_name },
      { path: "class_description", value: refined.data.class_description },
      { path: "weakness.description", value: refined.data.weakness.description },
      { path: "weakness.counterplay", value: refined.data.weakness.counterplay },
      ...refined.data.skills.flatMap((s, idx) => [
        { path: `skills[${idx}].name`, value: s.name },
        { path: `skills[${idx}].description`, value: s.description },
      ]),
    ]);

    // Persist character and skills.
    const classJson = {
      class_name: refined.data.class_name,
      class_description: refined.data.class_description,
      role: refined.data.role,
      weapon_identity: refined.data.weapon_identity,
      weakness: refined.data.weakness,
      seed,
      concept: classDescription,
    };

    // Upsert by (campaign_id, player_id, name) isn't unique; so create new or update existing by player+campaign+name.
    const { data: existingChars, error: existingError } = await svc
      .from("mythic.characters")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("player_id", user.id)
      .eq("name", characterName)
      .limit(1);
    if (existingError) throw existingError;

    let characterId: string;
    if (existingChars && existingChars.length > 0) {
      characterId = existingChars[0]!.id as string;
      const { error: updErr } = await svc
        .from("mythic.characters")
        .update({
          level: 1,
          offense: refined.data.base_stats.offense,
          defense: refined.data.base_stats.defense,
          control: refined.data.base_stats.control,
          support: refined.data.base_stats.support,
          mobility: refined.data.base_stats.mobility,
          utility: refined.data.base_stats.utility,
          class_json: classJson,
          resources: refined.data.resources,
          updated_at: new Date().toISOString(),
        })
        .eq("id", characterId);
      if (updErr) throw updErr;

      // Delete old skills for this character (skills are not append-only; safe to rebuild kit).
      const { error: delSkillsErr } = await svc
        .from("mythic.skills")
        .delete()
        .eq("character_id", characterId);
      if (delSkillsErr) throw delSkillsErr;
    } else {
      const { data: inserted, error: insErr } = await svc
        .from("mythic.characters")
        .insert({
          campaign_id: campaignId,
          player_id: user.id,
          name: characterName,
          level: 1,
          offense: refined.data.base_stats.offense,
          defense: refined.data.base_stats.defense,
          control: refined.data.base_stats.control,
          support: refined.data.base_stats.support,
          mobility: refined.data.base_stats.mobility,
          utility: refined.data.base_stats.utility,
          class_json: classJson,
          resources: refined.data.resources,
          derived_json: {},
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      characterId = inserted.id as string;
    }

    const skillRows = refined.data.skills.map((s) => ({
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
      .from("mythic.skills")
      .insert(skillRows)
      .select("id");
    if (insSkillsErr) throw insSkillsErr;

    return new Response(
      JSON.stringify({
        character_id: characterId,
        seed,
        class: {
          class_name: refined.data.class_name,
          class_description: refined.data.class_description,
          role: refined.data.role,
          weapon_identity: refined.data.weapon_identity,
          weakness: refined.data.weakness,
          base_stats: refined.data.base_stats,
          resources: refined.data.resources,
        },
        skills: refined.data.skills,
        skill_ids: insertedSkills?.map((r) => r.id) ?? [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("mythic-create-character error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to create character" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
