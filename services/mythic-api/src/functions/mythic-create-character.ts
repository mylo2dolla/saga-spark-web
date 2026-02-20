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

type ForgeCompactionMode = "none" | "auto_condensed";
type ForgeRefinementReason = "llm" | "timeout" | "invalid_json" | "schema_invalid" | "provider_error" | "deterministic_fallback";
type ForgeFailureReason = Exclude<ForgeRefinementReason, "llm" | "deterministic_fallback">;

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

const CLASS_FORGE_REFINEMENT_TIMEOUT_MS = 19_000;
const CLASS_FORGE_PRIMARY_TIMEOUT_MS = 13_500;
const CLASS_FORGE_MIN_REPAIR_TIMEOUT_MS = 2_500;
const FORGE_CONCEPT_TARGET_MIN_CHARS = 280;
const FORGE_CONCEPT_TARGET_MAX_CHARS = 420;

const GENERIC_SKILL_NAME_RX = /^(action|ability|skill|trait|passive|ultimate)\s*\d*(?:\s*[:-]\s*(?:strike|guard|blast|carve|defense|utility|effect)?)?$/i;
const LOW_SIGNAL_SKILL_NAME_RX = /^(strike|guard|ultimate|pressure wave|reposition|disrupt|weakness exploit|passive a|passive b|burst strike)$/i;
const LOW_SIGNAL_SKILL_DESCRIPTION_RX = /^(a basic|movement tool\.?|defense tool\.?|burst tool\.?|control\/utility tool\.?|passive [ab] description\.?|uses [a-z0-9_\s]+ targeting at range \d+\.?)/i;

class ForgeRefinementError extends Error {
  reason: ForgeFailureReason;
  rawContent: string | null;

  constructor(reason: ForgeFailureReason, message: string, rawContent: string | null = null) {
    super(message);
    this.name = "ForgeRefinementError";
    this.reason = reason;
    this.rawContent = rawContent;
  }
}

function trimText(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).replace(/\s+\S*$/g, "").trim();
}

function compactSentence(text: string, max: number): string {
  const normalized = trimText(text.replace(/[.!?]+$/g, ""), max);
  return normalized;
}

function titleSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 1).toUpperCase() + trimmed.slice(1);
}

function lowerSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 1).toLowerCase() + trimmed.slice(1);
}

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

function formatSkillName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[ivx]+$/i.test(part)) return part.toUpperCase();
      if (/^[a-z]{1,2}$/i.test(part)) return part.toUpperCase();
      return part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase();
    })
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

function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickByHash<T>(arr: readonly T[], key: string): T {
  return arr[hash32(key) % arr.length]!;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).toLowerCase()).filter(Boolean);
}

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function condenseClassConceptForForge(input: string): {
  value: string;
  raw_chars: number;
  used_chars: number;
  mode: ForgeCompactionMode;
} {
  const raw = input.replace(/\s+/g, " ").trim();
  if (!raw) {
    return { value: "Mythic hybrid fighter with a risky burst loop and visible punish window.", raw_chars: 0, used_chars: 74, mode: "auto_condensed" };
  }

  if (raw.length <= FORGE_CONCEPT_TARGET_MAX_CHARS) {
    return {
      value: raw,
      raw_chars: raw.length,
      used_chars: raw.length,
      mode: "none",
    };
  }

  const sentences = (raw.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((part) => part.trim())
    .filter(Boolean);
  const normalized = sentences.length > 0 ? sentences : [raw];

  const pick = (rx: RegExp, fallbackIndex: number) =>
    normalized.find((sentence) => rx.test(sentence.toLowerCase())) ?? normalized[Math.min(fallbackIndex, normalized.length - 1)] ?? raw;

  const archetypeRaw = pick(/\b(assassin|guardian|mage|warlock|cleric|paladin|ninja|duelist|hunter|skirmisher|controller|support|tank|hybrid|spellblade|berserk|reaver|witch|oracle)\b/i, 0);
  const tacticalRaw = pick(/\b(loop|combo|tempo|burst|dash|zone|control|stagger|reposition|pressure|execute|setup|rotation|flank|resource|cooldown|position)\b/i, 1);
  const weaknessRaw = pick(/\b(weak|cost|risk|drawback|fragile|overheat|glass|resource|telegraph|cooldown|punish|crash|exposed|counterplay|interrupt)\b/i, normalized.length - 1);

  const archetype = titleSentence(compactSentence(archetypeRaw, 140));
  const tactical = lowerSentence(compactSentence(tacticalRaw, 140));
  const weakness = lowerSentence(compactSentence(weaknessRaw, 120));

  let composed = `${archetype}. Tactical loop: ${tactical}. Cost: ${weakness}.`.replace(/\s+/g, " ").trim();
  composed = trimText(composed, FORGE_CONCEPT_TARGET_MAX_CHARS);

  if (composed.length < FORGE_CONCEPT_TARGET_MIN_CHARS) {
    const extras = normalized
      .filter((sentence) => sentence !== archetypeRaw && sentence !== tacticalRaw && sentence !== weaknessRaw)
      .map((sentence) => compactSentence(sentence, 110))
      .filter(Boolean);
    for (const extra of extras) {
      const candidate = `${composed} ${titleSentence(extra)}.`.replace(/\s+/g, " ").trim();
      if (candidate.length > FORGE_CONCEPT_TARGET_MAX_CHARS) break;
      composed = candidate;
      if (composed.length >= FORGE_CONCEPT_TARGET_MIN_CHARS) break;
    }
  }

  return {
    value: trimText(composed, FORGE_CONCEPT_TARGET_MAX_CHARS),
    raw_chars: raw.length,
    used_chars: trimText(composed, FORGE_CONCEPT_TARGET_MAX_CHARS).length,
    mode: "auto_condensed",
  };
}

function classifyFailureFromMessage(message: string): ForgeFailureReason {
  const lower = message.toLowerCase();
  if (lower.includes("timed out") || lower.includes("timeout")) return "timeout";
  if (lower.includes("schema")) return "schema_invalid";
  if (lower.includes("json")) return "invalid_json";
  return "provider_error";
}

function toForgeRefinementError(error: unknown): ForgeRefinementError {
  if (error instanceof ForgeRefinementError) return error;
  const normalized = sanitizeError(error);
  const message = normalized.message || "OpenAI refinement failed";
  return new ForgeRefinementError(classifyFailureFromMessage(message), message);
}

function ensureUniqueSkillName(name: string, used: Set<string>, idx: number, seedKey: string): string {
  let candidate = trimText(name, 80);
  if (!candidate) candidate = `Mythic Move ${idx + 1}`;
  let normalized = candidate.toLowerCase();
  if (!used.has(normalized)) {
    used.add(normalized);
    return candidate;
  }

  const suffixes = ["Prime", "Vector", "Mk II", "Reprise", "Overdrive", "Final"];
  for (const suffix of suffixes) {
    const next = trimText(`${candidate} ${pickByHash(suffixes, `${seedKey}:${suffix}`)}`, 80);
    normalized = next.toLowerCase();
    if (!used.has(normalized)) {
      used.add(normalized);
      return next;
    }
  }

  candidate = trimText(`${candidate} ${idx + 1}`, 80);
  normalized = candidate.toLowerCase();
  used.add(normalized);
  return candidate;
}

function primarySkillTag(skill: z.infer<typeof SkillSchema>): string {
  if (skill.kind === "passive") return "passive";
  if (skill.kind === "ultimate") return "ultimate";
  const tags = asStringArray((skill.effects_json as { tags?: unknown } | null)?.tags);
  if (tags.includes("movement") || tags.includes("mobility")) return "movement";
  if (tags.includes("defense") || tags.includes("shield") || tags.includes("mitigation")) return "defense";
  if (tags.includes("burst") || tags.includes("execute")) return "burst";
  if (tags.includes("control") || tags.includes("stun") || tags.includes("stagger")) return "control";
  if (tags.includes("utility") || tags.includes("cleanse")) return "utility";
  if (tags.includes("damage")) return "damage";
  return "utility";
}

function counterplaySummary(counterplay: Record<string, unknown>): string {
  const notes = typeof counterplay.notes === "string" ? counterplay.notes.trim() : "";
  if (notes) return trimText(notes.replace(/[.!?]+$/g, ""), 160);

  const keys = Object.keys(counterplay);
  if (keys.includes("countered_by")) return "bait the cooldown, then punish overcommit";
  if (keys.includes("avoided_by")) return "reposition early and deny line-of-sight";
  if (keys.includes("resisted_by")) return "stack resist and force the caster to overextend";
  return "track timing windows and punish the recovery";
}

function skillTargetClause(skill: z.infer<typeof SkillSchema>): string {
  if (skill.targeting === "self") return "anchors your own position";
  if (skill.targeting === "single") return `hunts a single target out to ${skill.range_tiles} tiles`;
  if (skill.targeting === "tile") return `projects pressure across a tile lane out to ${skill.range_tiles} tiles`;
  return `sweeps an area out to ${skill.range_tiles} tiles`;
}

function deterministicRefinement(input: {
  classDescription: string;
  kit: ReturnType<typeof generateMechanicalKit>;
  seed: number;
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

  const roleLine: Record<z.infer<typeof ResponseSchema>["role"], string> = {
    tank: "frontline denial, durability spikes, and retaliation windows",
    dps: "burst execution and clean finish windows",
    support: "tempo stabilization and team pressure conversion",
    controller: "space control, lockouts, and disruption chains",
    skirmisher: "flanking pressure, movement abuse, and hit-run tempo",
    hybrid: "mixed pressure with flexible utility pivots",
  };

  const className = trimText(`${conceptTitle} ${roleTitles[input.kit.role]}`, 60);
  const classDescription = trimText(
    `A ${input.kit.role} forged from "${trimText(input.classDescription, 180)}". This kit leans into ${roleLine[input.kit.role]}, weaponizes ${String(input.kit.resources.primary_id).toUpperCase()}, and dares enemies to punish your risk windows before you cash out.`,
    2000,
  );

  const roleWordBank: Record<z.infer<typeof ResponseSchema>["role"], string[]> = {
    tank: ["Iron", "Stone", "Bastion", "Aegis", "Bulwark", "Rampart"],
    dps: ["Razor", "Rend", "Execution", "Blood", "Sever", "Reaver"],
    support: ["Ward", "Lifeline", "Anchor", "Mercy", "Pulse", "Sanctum"],
    controller: ["Hex", "Lock", "Null", "Snare", "Grave", "Flux"],
    skirmisher: ["Shadow", "Slip", "Rift", "Ghost", "Lunge", "Stalker"],
    hybrid: ["Arc", "Warp", "Spell", "Ruin", "Mythic", "Split"],
  };

  const weaponWordBank: Record<z.infer<typeof ResponseSchema>["weapon_identity"]["family"], string[]> = {
    blades: ["Edge", "Fang", "Sever", "Lacer", "Slice"],
    axes: ["Cleaver", "Hatchet", "Chop", "Rend", "Split"],
    blunt: ["Hammer", "Maul", "Impact", "Crush", "Breaker"],
    polearms: ["Pike", "Lance", "Halberd", "Skewer", "Thrust"],
    ranged: ["Volley", "Bolt", "Tracer", "Deadeye", "Longshot"],
    focus: ["Sigil", "Rune", "Arc", "Hex", "Catalyst"],
    body: ["Claw", "Howl", "Pounce", "Ripper", "Feral"],
    absurd: ["Glitch", "Chaos", "Jester", "Warp", "Mayhem"],
  };

  const tagWordBank: Record<string, string[]> = {
    passive: ["Instinct", "Doctrine", "Rhythm", "Oath", "Protocol"],
    movement: ["Dash", "Slip", "Blink", "Lunge", "Pivot"],
    defense: ["Aegis", "Ward", "Brace", "Bastion", "Shield"],
    burst: ["Rend", "Rupture", "Sever", "Break", "Spike"],
    control: ["Snare", "Lock", "Clamp", "Pin", "Hex"],
    utility: ["Feint", "Bait", "Shift", "Circuit", "Setup"],
    damage: ["Strike", "Slash", "Crack", "Impact", "Volley"],
    ultimate: ["Cataclysm", "Finale", "Overdrive", "Judgment", "Eclipse"],
  };

  const resource = String(input.kit.resources.primary_id ?? "resource").toUpperCase();
  const weaknessLabel = input.kit.weakness.id.replace(/_/g, " ");
  const usedNames = new Set<string>();

  const skills = input.kit.skills.map((skill, idx) => {
    const tag = primarySkillTag(skill);
    const seedKey = `${input.seed}:${input.kit.role}:${input.kit.weaponFamily}:${tag}:${idx}:${concept}`;

    let name = "";
    if (skill.kind === "passive") {
      name = `${pickByHash(roleWordBank[input.kit.role], `${seedKey}:role`)} ${pickByHash(tagWordBank.passive, `${seedKey}:passive`)}`;
    } else if (skill.kind === "ultimate") {
      name = `${pickByHash(tagWordBank.ultimate, `${seedKey}:ultimate`)} ${pickByHash(["Protocol", "Storm", "Break", "Vector", "Cascade"], `${seedKey}:ultimate_suffix`)}`;
    } else {
      name = `${pickByHash(tagWordBank[tag] ?? tagWordBank.utility, `${seedKey}:tag`)} ${pickByHash(weaponWordBank[input.kit.weaponFamily], `${seedKey}:weapon`)}`;
    }

    const named = ensureUniqueSkillName(formatSkillName(name), usedNames, idx, seedKey);
    const targetClause = skillTargetClause(skill);
    const counter = counterplaySummary(skill.counterplay);
    const roleDirective = roleLine[input.kit.role];

    const description = trimText(
      `${named} ${targetClause} and drives ${roleDirective}. It spends ${resource} to open momentum swings while exposing ${weaknessLabel} if you overcommit. Counterplay: ${counter}.`,
      2000,
    );

    return {
      ...skill,
      name: named,
      description,
    };
  });

  return {
    class_name: className,
    class_description: classDescription,
    weapon_identity: {
      family: input.kit.weaponFamily,
      notes: `Prefers ${input.kit.weaponFamily} pressure patterns and tempo control over passive trading.`,
    },
    role: input.kit.role,
    base_stats: input.kit.baseStats,
    resources: input.kit.resources,
    weakness: {
      id: input.kit.weakness.id,
      description: trimText(input.kit.weakness.description, 2000),
      counterplay: trimText(input.kit.weakness.counterplay, 2000),
    },
    skills,
  };
}

function isGenericSkillName(name: string): boolean {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) return true;
  if (GENERIC_SKILL_NAME_RX.test(trimmed)) return true;
  if (LOW_SIGNAL_SKILL_NAME_RX.test(trimmed)) return true;
  if (trimmed.split(/\s+/).length === 1 && /^(guard|strike|ultimate|passive)$/i.test(trimmed)) return true;
  return false;
}

function isLowSignalDescription(description: string): boolean {
  const trimmed = description.replace(/\s+/g, " ").trim();
  if (!trimmed) return true;
  if (trimmed.length < 40) return true;
  if (LOW_SIGNAL_SKILL_DESCRIPTION_RX.test(trimmed.toLowerCase())) return true;
  return false;
}

function repairRefinedOutput(args: {
  refined: z.infer<typeof ResponseSchema>;
  fallback: z.infer<typeof ResponseSchema>;
}): z.infer<typeof ResponseSchema> {
  const used = new Set<string>();
  const skills = args.refined.skills.map((skill, idx) => {
    const fallbackSkill = args.fallback.skills[Math.min(idx, args.fallback.skills.length - 1)] ?? args.fallback.skills[0]!;
    let name = trimText(skill.name ?? "", 80);
    if (isGenericSkillName(name)) {
      name = fallbackSkill.name;
    }
    name = ensureUniqueSkillName(name, used, idx, `repair:${idx}:${name}`);

    let description = trimText(skill.description ?? "", 2000);
    if (isLowSignalDescription(description)) {
      description = fallbackSkill.description;
    }

    return {
      ...skill,
      name,
      description,
    };
  });

  const className = trimText(args.refined.class_name, 60);
  const safeClassName = className.length < 4 || /^mythic\s+(class|kit)$/i.test(className)
    ? args.fallback.class_name
    : className;

  const classDescription = trimText(args.refined.class_description, 2000);
  const safeClassDescription = classDescription.length < 60 ? args.fallback.class_description : classDescription;

  return {
    ...args.refined,
    class_name: safeClassName,
    class_description: safeClassDescription,
    skills,
  };
}

function parseRefinedResponse(content: string): z.infer<typeof ResponseSchema> {
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    throw new ForgeRefinementError("invalid_json", "OpenAI response was not valid JSON", content);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ForgeRefinementError("invalid_json", "OpenAI returned malformed JSON", content);
  }

  const refined = ResponseSchema.safeParse(parsed);
  if (!refined.success) {
    throw new ForgeRefinementError(
      "schema_invalid",
      `OpenAI output failed schema validation: ${JSON.stringify(refined.error.flatten())}`,
      jsonText,
    );
  }

  return refined.data;
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

  const skills = [
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
      const totalStartedAt = Date.now();
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

      const conceptCompaction = condenseClassConceptForForge(classDescription);
      const forgeConcept = conceptCompaction.value;

      const svc = createServiceClient();
      await assertCampaignAccess(svc, campaignId, user.userId);

      const kit = generateMechanicalKit({ seed, classDescription: forgeConcept });
      const deterministicFallback = deterministicRefinement({ classDescription: forgeConcept, kit, seed });

      const systemPrompt = [
        "You are refining Mythic class kit narrative text.",
        "Do not alter numeric mechanics, targeting, cooldowns, costs, scaling, or effect payloads.",
        "Only improve class_name, class_description, weapon_identity.notes, weakness description/counterplay, and each skill name/description.",
        "Return only valid JSON matching the provided skeleton schema.",
        "Style: living comic-book dark fantasy with tactical clarity.",
        "No markdown.",
      ].join("\n");

      const skeleton = {
        class_name: deterministicFallback.class_name,
        class_description: deterministicFallback.class_description,
        weapon_identity: { family: kit.weaponFamily, notes: deterministicFallback.weapon_identity.notes },
        role: kit.role,
        base_stats: kit.baseStats,
        resources: kit.resources,
        weakness: kit.weakness,
        skills: kit.skills,
      };

      const primaryUserPrompt = [
        `CLASS CONCEPT (condensed for latency): ${forgeConcept}`,
        `SEED: ${seed}`,
        "TASK:",
        "- Keep all mechanics unchanged.",
        "- Improve flavor and specificity of names/descriptions.",
        "- Ensure each skill name is distinct and non-generic.",
        "- Keep output JSON schema-compatible.",
        "MECHANICS SKELETON:",
        JSON.stringify(skeleton),
      ].join("\n");

      const warnings: string[] = [];
      const attemptOutcomes: string[] = [];
      let provider = "openai";
      let model = "gpt-4o-mini";
      let refinedData: z.infer<typeof ResponseSchema> = deterministicFallback;
      let refinementMode: "llm" | "deterministic_fallback" = "deterministic_fallback";
      let refinementReason: ForgeRefinementReason = "deterministic_fallback";
      let lastFailure: ForgeRefinementError | null = null;

      const refinementStartedAt = Date.now();
      try {
        const primary = await mythicOpenAIChatCompletions(
          {
            temperature: 0.2,
            max_tokens: 1100,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: primaryUserPrompt },
            ],
          },
          "gpt-4o-mini",
          { timeoutMs: CLASS_FORGE_PRIMARY_TIMEOUT_MS },
        );

        provider = primary.provider;
        model = primary.model;

        const primaryContent = extractAssistantContent(primary.data);
        if (!primaryContent) {
          throw new ForgeRefinementError("provider_error", "OpenAI returned an empty response for class refinement");
        }

        refinedData = parseRefinedResponse(primaryContent);
        refinementMode = "llm";
        refinementReason = "llm";
        attemptOutcomes.push("primary:ok");
      } catch (error) {
        if (error instanceof AiProviderError && error.code === "openai_not_configured") {
          throw error;
        }

        const failure = toForgeRefinementError(error);
        lastFailure = failure;
        refinementReason = failure.reason;
        attemptOutcomes.push(`primary:${failure.reason}`);

        const elapsed = Date.now() - refinementStartedAt;
        const remaining = Math.max(0, CLASS_FORGE_REFINEMENT_TIMEOUT_MS - elapsed - 250);

        if (remaining >= CLASS_FORGE_MIN_REPAIR_TIMEOUT_MS) {
          try {
            const repairMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
              { role: "system", content: systemPrompt },
              { role: "user", content: primaryUserPrompt },
            ];
            if (failure.rawContent && failure.rawContent.trim().length > 0) {
              repairMessages.push({ role: "assistant", content: failure.rawContent.slice(0, 12_000) });
            }
            repairMessages.push({
              role: "user",
              content: [
                "Repair the previous output and return corrected JSON only.",
                `failure_reason: ${failure.reason}`,
                `failure_detail: ${trimText(failure.message, 240)}`,
                "Do not change any mechanics fields.",
                "Ensure every skill name is distinct and non-generic.",
              ].join("\n"),
            });

            const repair = await mythicOpenAIChatCompletions(
              {
                temperature: 0,
                max_tokens: 1100,
                messages: repairMessages,
              },
              "gpt-4o-mini",
              { timeoutMs: remaining },
            );

            provider = repair.provider;
            model = repair.model;

            const repairContent = extractAssistantContent(repair.data);
            if (!repairContent) {
              throw new ForgeRefinementError("provider_error", "OpenAI repair attempt returned empty output");
            }

            refinedData = parseRefinedResponse(repairContent);
            refinementMode = "llm";
            refinementReason = "llm";
            attemptOutcomes.push("repair:ok");
          } catch (repairError) {
            if (repairError instanceof AiProviderError && repairError.code === "openai_not_configured") {
              throw repairError;
            }
            const repairFailure = toForgeRefinementError(repairError);
            lastFailure = repairFailure;
            refinementReason = repairFailure.reason;
            attemptOutcomes.push(`repair:${repairFailure.reason}`);
          }
        }
      }

      if (refinementMode !== "llm") {
        refinedData = deterministicFallback;
        if (lastFailure) {
          warnings.push(`openai_refinement_fallback:${trimText(lastFailure.message || "OpenAI refinement failed", 220)}`);
          ctx.log.warn("create_character.refinement_fallback", {
            request_id: ctx.requestId,
            reason: trimText(lastFailure.message || "OpenAI refinement failed", 220),
            refinement_reason: refinementReason,
            attempts: attemptOutcomes,
          });
        }
      }

      refinedData = repairRefinedOutput({
        refined: refinedData,
        fallback: deterministicFallback,
      });

      const refinementMs = Date.now() - refinementStartedAt;

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

      const classJson = {
        class_name: refinedData.class_name,
        class_description: refinedData.class_description,
        role: refinedData.role,
        weapon_identity: refinedData.weapon_identity,
        weakness: refinedData.weakness,
        seed,
        concept: classDescription,
        forge_concept: forgeConcept,
        concept_compaction: conceptCompaction,
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

      const dbWriteStartedAt = Date.now();

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

      const dbWriteMs = Date.now() - dbWriteStartedAt;
      const totalMs = Date.now() - totalStartedAt;

      ctx.log.info("create_character.completed", {
        request_id: ctx.requestId,
        campaign_id: campaignId,
        character_id: characterId,
        forge_refinement_mode: refinementMode,
        forge_refinement_reason: refinementReason,
        forge_refinement_attempts: attemptOutcomes,
        forge_concept_raw_chars: conceptCompaction.raw_chars,
        forge_concept_used_chars: conceptCompaction.used_chars,
        forge_concept_compaction_mode: conceptCompaction.mode,
        forge_total_ms: totalMs,
        forge_refinement_ms: refinementMs,
        forge_db_write_ms: dbWriteMs,
      });

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
          timings_ms: {
            total: totalMs,
            refinement: refinementMs,
            db_write: dbWriteMs,
          },
          refinement_mode: refinementMode,
          refinement_reason: refinementReason,
          concept_compaction: conceptCompaction,
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
