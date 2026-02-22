#!/usr/bin/env -S node --enable-source-maps
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

type SkillRow = {
  id: string;
  campaign_id: string;
  character_id: string;
  name: string;
  kind: string;
  targeting: string;
  cooldown_turns: number | null;
  cost_json: Record<string, unknown> | null;
  effects_json: Record<string, unknown> | null;
};

type CompanionRow = {
  campaign_id: string;
  companion_id: string;
  name: string;
  archetype: string | null;
};

type CombatantRow = {
  id: string;
  combat_session_id: string;
  name: string;
  entity_type: "npc" | "summon" | "player";
};

interface CliArgs {
  campaignIds: string[];
  userId: string | null;
  email: string | null;
  dryRun: boolean;
  yes: boolean;
}

const LOW_SIGNAL_SKILL_NAME = /^(basic attack|basic defend|recover mp|passive\s*[ab]|reposition|guard|burst strike|disrupt|weakness exploit|setup lacer|judgment protocol|skill\s*\d+|ability\s*\d+)$/i;
const LOW_SIGNAL_NAME = /(ink ghoul|ash brigand|gloom raider|rift hound|enemy\s*\d+|companion\s*\d+|ash rune|vex thorn|nightcoil)/i;
const WORD_BANK_CLASSIC = ["Fireball", "Ice Shard", "Lightning Bolt", "Stone Spike", "Wind Slash", "Water Jet", "Light Beam", "Shadow Blink"] as const;
const WORD_BANK_ENHANCED = ["Greater", "Grand", "Burst", "Surge", "Strike", "Blast", "Nova", "Lance", "Wave"] as const;
const WORD_BANK_HEROIC = ["Inferno", "Tempest", "Radiant", "Storm", "Prism", "Glacier", "Starfire", "Skybreaker", "Emberstorm"] as const;
const WORD_BANK_MYTHIC = ["Cataclysm", "Supernova", "Celestial", "Omega", "Eternal", "Infinite", "Heavenfall", "Sunburst", "Moonflare"] as const;
const WORD_BANK_ABSURD = ["Ultra", "Hyper", "Turbo", "Supreme", "Deluxe", "EX", "Final", "Ultimate", "Maximum"] as const;
const WORD_BANK_WHIMSY = ["Sparkle", "Zappy", "Fizzy", "Boomy", "Twinkly", "Snappy", "Glowy", "Shiny", "Whirly", "Fluffy", "Crackly", "Zingy", "Peppy", "Bouncy"] as const;

const COMPANION_FIRST = ["Mira", "Juno", "Poppy", "Clover", "Bram", "Iris", "Sable", "Lark", "Riven", "Talon", "Aster", "Kite"] as const;
const COMPANION_LAST = ["Honeybrook", "Lanternrest", "Rainbowcrossing", "Moonberry", "Willowglen", "Puddleford", "Sunmeadow", "Clovercrest"] as const;
const ENEMY_PREFIX = ["Mega", "Dire", "Ancient", "Spark", "Storm", "Crystal", "Bubble", "Shadow", "Flame", "Frost", "Thunder"] as const;
const ENEMY_CORE = ["Slime", "Goblin", "Sprite", "Wyrm", "Drake", "Golem", "Kitty", "Serpent", "Mimic", "Crab", "Spider", "Treant", "Beast", "Goose"] as const;

function usage(): void {
  console.log([
    "Usage: npx tsx scripts/backfill-mythic-presentation-wordbank.ts [--campaign-id=<uuid,...>] [--user-id=<uuid>|--email=<address>] [--dry-run] [--yes]",
    "",
    "Backfills player-facing Mythic presentation metadata and renames low-signal display labels.",
    "IDs and combat mechanics remain unchanged.",
  ].join("\n"));
}

function parseArgs(argv: string[]): CliArgs {
  let campaignIds: string[] = [];
  let userId: string | null = null;
  let email: string | null = null;
  let dryRun = false;
  let yes = false;

  for (const token of argv) {
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--yes") {
      yes = true;
      continue;
    }
    if (token.startsWith("--campaign-id=")) {
      campaignIds = token
        .slice("--campaign-id=".length)
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      continue;
    }
    if (token.startsWith("--user-id=")) {
      userId = token.slice("--user-id=".length).trim() || null;
      continue;
    }
    if (token.startsWith("--email=")) {
      email = token.slice("--email=".length).trim().toLowerCase() || null;
      continue;
    }
    if (token === "--help" || token === "-h") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { campaignIds, userId, email, dryRun, yes };
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

function requireEnv(key: string, fallback: Record<string, string>): string {
  const v = process.env[key]?.trim() || fallback[key]?.trim();
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(pool: readonly T[], seed: string): T {
  return pool[hash32(seed) % pool.length]!;
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function inferRank(skill: SkillRow): number {
  if (skill.kind === "ultimate") return 5;
  if (skill.kind === "passive") return 1;
  const cd = Number(skill.cooldown_turns ?? 0);
  if (cd >= 5) return 4;
  if (cd >= 3) return 3;
  return 2;
}

function inferRarity(rank: number): "common" | "magical" | "unique" | "legendary" {
  if (rank >= 5) return "legendary";
  if (rank >= 4) return "unique";
  if (rank >= 2) return "magical";
  return "common";
}

function inferEscalation(skill: SkillRow, rank: number): number {
  const cost = Number((skill.cost_json ?? {}).power ?? (skill.cost_json ?? {}).mp ?? 0);
  if (rank >= 5) return 6 + (Number.isFinite(cost) && cost >= 25 ? 1 : 0);
  if (rank >= 4) return 4 + (Number.isFinite(cost) && cost >= 20 ? 1 : 0);
  return 2 + (Number.isFinite(cost) && cost >= 15 ? 1 : 0);
}

function buildSpellDisplayName(skill: SkillRow, seed: string): string {
  const rank = inferRank(skill);
  const escalation = inferEscalation(skill, rank);
  const current = cleanName(skill.name);
  const base = current.length > 0 && !LOW_SIGNAL_SKILL_NAME.test(current)
    ? current
    : pick(WORD_BANK_CLASSIC, `${seed}:base`);

  const whimsical = hash32(`${seed}:whimsy`) % 10 === 0 ? `${pick(WORD_BANK_WHIMSY, `${seed}:whimsy-word`)} ` : "";
  if (rank <= 1) return `${base}`.trim();
  if (rank <= 2) return `${pick(WORD_BANK_ENHANCED, `${seed}:enhanced`)} ${whimsical}${base}`.trim();
  if (rank <= 3) return `${pick(WORD_BANK_HEROIC, `${seed}:heroic`)} ${whimsical}${base}`.trim();
  if (rank <= 4 || escalation <= 5) return `${pick(WORD_BANK_MYTHIC, `${seed}:mythic`)} ${whimsical}${base}`.trim();
  return `${pick(WORD_BANK_ABSURD, `${seed}:absurd-a`)} ${pick(WORD_BANK_MYTHIC, `${seed}:absurd-core`)} ${pick(WORD_BANK_ABSURD, `${seed}:absurd-b`)} ${base}`.replace(/\s+/g, " ").trim();
}

function inferElement(name: string): string {
  const lower = name.toLowerCase();
  if (/(fire|ember|inferno|flare)/.test(lower)) return "fire";
  if (/(frost|ice|glacier|snow)/.test(lower)) return "frost";
  if (/(storm|thunder|lightning|zap)/.test(lower)) return "lightning";
  if (/(shadow|void|night|gloom)/.test(lower)) return "shadow";
  if (/(sun|radiant|light|dawn)/.test(lower)) return "radiant";
  if (/(stone|earth|quake)/.test(lower)) return "earth";
  return "arcane";
}

function inferMood(skill: SkillRow): string {
  if (skill.kind === "ultimate") return "cataclysmic";
  if (skill.kind === "passive") return "steady";
  const cd = Number(skill.cooldown_turns ?? 0);
  if (cd >= 4) return "heavy";
  return "focused";
}

function inferImpactVerb(name: string, seed: string): string {
  const lower = name.toLowerCase();
  if (/(slash|strike|lance)/.test(lower)) return "strike";
  if (/(burst|nova|detonate)/.test(lower)) return "burst";
  if (/(guard|ward|bulwark|aegis)/.test(lower)) return "brace";
  if (/(snare|bind|lock)/.test(lower)) return "lock";
  return pick(["smite", "slice", "slam", "flash", "shatter", "ignite", "freeze", "zap", "crash", "whirl", "bonk"] as const, `${seed}:impact`);
}

function ensureSkillEffects(skill: SkillRow, nextName: string): Record<string, unknown> {
  const current = skill.effects_json ?? {};
  const styleTags = typeof current.style_tags === "object" && current.style_tags && !Array.isArray(current.style_tags)
    ? current.style_tags as Record<string, unknown>
    : {};
  const presentation = typeof current.presentation === "object" && current.presentation && !Array.isArray(current.presentation)
    ? current.presentation as Record<string, unknown>
    : {};
  const rank = inferRank(skill);
  const rarity = inferRarity(rank);
  const escalationLevel = inferEscalation(skill, rank);
  const seedKey = `${skill.id}:${nextName}:${rank}:${rarity}:${escalationLevel}`;

  return {
    ...current,
    style_tags: {
      element: typeof styleTags.element === "string" && styleTags.element.trim().length > 0
        ? styleTags.element
        : inferElement(nextName),
      mood: typeof styleTags.mood === "string" && styleTags.mood.trim().length > 0
        ? styleTags.mood
        : inferMood(skill),
      visual_signature: typeof styleTags.visual_signature === "string" && styleTags.visual_signature.trim().length > 0
        ? styleTags.visual_signature
        : pick(["sky fracture", "ember spiral", "glass shockwave", "moonflare", "arc lattice"], `${seedKey}:visual`),
      impact_verb: typeof styleTags.impact_verb === "string" && styleTags.impact_verb.trim().length > 0
        ? styleTags.impact_verb
        : inferImpactVerb(nextName, seedKey),
    },
    presentation: {
      ...presentation,
      spell_base: typeof presentation.spell_base === "string" && presentation.spell_base.trim().length > 0
        ? presentation.spell_base
        : nextName,
      rank: Number.isFinite(Number(presentation.rank)) ? Number(presentation.rank) : rank,
      rarity: typeof presentation.rarity === "string" && presentation.rarity.trim().length > 0
        ? presentation.rarity
        : rarity,
      escalation_level: Number.isFinite(Number(presentation.escalation_level))
        ? Number(presentation.escalation_level)
        : escalationLevel,
    },
  };
}

function needsCompanionRename(name: string): boolean {
  const clean = cleanName(name);
  if (!clean) return true;
  return LOW_SIGNAL_NAME.test(clean);
}

function buildCompanionName(seed: string): string {
  return `${pick(COMPANION_FIRST, `${seed}:first`)} ${pick(COMPANION_LAST, `${seed}:last`)}`;
}

function buildEnemyName(seed: string): string {
  return `${pick(ENEMY_PREFIX, `${seed}:prefix`)} ${pick(ENEMY_CORE, `${seed}:core`)}`;
}

async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  args: CliArgs,
): Promise<string | null> {
  if (args.userId) return args.userId;
  if (!args.email) return null;
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find((entry) => entry.email?.trim().toLowerCase() === args.email);
    if (found?.id) return found.id;
    if (users.length < perPage) break;
    page += 1;
  }
  throw new Error(`No auth user found for email ${args.email}`);
}

async function resolveCampaignIds(
  supabase: ReturnType<typeof createClient>,
  args: CliArgs,
): Promise<string[]> {
  if (args.campaignIds.length > 0) return args.campaignIds;
  const userId = await resolveUserId(supabase, args);
  if (!userId) {
    throw new Error("Provide --campaign-id or --user-id/--email to scope the backfill.");
  }
  const { data, error } = await supabase
    .from("campaigns")
    .select("id")
    .eq("owner_id", userId);
  if (error) throw error;
  return (data ?? [])
    .map((row) => String((row as { id?: unknown }).id ?? "").trim())
    .filter((id) => id.length > 0);
}

export async function runBackfillMythicPresentationWordbank(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const envFallback = parseEnvFile(path.join(repoRoot, "services", "mythic-api", ".env"));
  const supabaseUrl = requireEnv("SUPABASE_URL", envFallback);
  const serviceRole = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFallback);

  if (!args.dryRun && !args.yes) {
    throw new Error("Refusing to modify data without --yes. Use --dry-run to preview changes.");
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const campaignIds = await resolveCampaignIds(supabase, args);
  if (campaignIds.length === 0) {
    console.log("No campaigns matched scope.");
    return;
  }

  let renamedSkills = 0;
  let taggedSkills = 0;
  let renamedCompanions = 0;
  let renamedCombatants = 0;

  const { data: skillsRaw, error: skillError } = await supabase
    .schema("mythic")
    .from("skills")
    .select("id,campaign_id,character_id,name,kind,targeting,cooldown_turns,cost_json,effects_json")
    .in("campaign_id", campaignIds)
    .order("campaign_id", { ascending: true })
    .order("created_at", { ascending: true });
  if (skillError) throw skillError;

  const skills = (skillsRaw ?? []) as SkillRow[];
  const skillNameUsedByCampaign = new Map<string, Set<string>>();
  for (const row of skills) {
    const set = skillNameUsedByCampaign.get(row.campaign_id) ?? new Set<string>();
    set.add(cleanName(row.name).toLowerCase());
    skillNameUsedByCampaign.set(row.campaign_id, set);
  }

  for (const row of skills) {
    const campaignSet = skillNameUsedByCampaign.get(row.campaign_id) ?? new Set<string>();
    const currentName = cleanName(row.name);
    let nextName = currentName;
    if (LOW_SIGNAL_SKILL_NAME.test(currentName) || currentName.length === 0) {
      nextName = buildSpellDisplayName(row, `${row.id}:${row.campaign_id}`);
      let suffix = 2;
      while (campaignSet.has(nextName.toLowerCase())) {
        nextName = `${buildSpellDisplayName(row, `${row.id}:${row.campaign_id}:${suffix}`)} ${suffix}`;
        suffix += 1;
      }
    }
    const nextEffects = ensureSkillEffects(row, nextName);
    const nameChanged = nextName !== currentName;
    const effectsChanged = JSON.stringify(nextEffects) !== JSON.stringify(row.effects_json ?? {});
    if (!nameChanged && !effectsChanged) continue;

    if (!args.dryRun) {
      const { error } = await supabase
        .schema("mythic")
        .from("skills")
        .update({
          ...(nameChanged ? { name: nextName } : {}),
          ...(effectsChanged ? { effects_json: nextEffects } : {}),
        })
        .eq("id", row.id);
      if (error) throw error;
    }

    if (nameChanged) {
      renamedSkills += 1;
      campaignSet.delete(currentName.toLowerCase());
      campaignSet.add(nextName.toLowerCase());
    }
    if (effectsChanged) taggedSkills += 1;
    skillNameUsedByCampaign.set(row.campaign_id, campaignSet);
  }

  const { data: companionsRaw, error: companionError } = await supabase
    .schema("mythic")
    .from("campaign_companions")
    .select("campaign_id,companion_id,name,archetype")
    .in("campaign_id", campaignIds)
    .order("campaign_id", { ascending: true })
    .order("companion_id", { ascending: true });
  if (companionError) throw companionError;

  const companions = (companionsRaw ?? []) as CompanionRow[];
  const companionSeenByCampaign = new Map<string, Set<string>>();
  const companionCountByCampaign = new Map<string, Map<string, number>>();
  for (const row of companions) {
    const normalized = cleanName(row.name).toLowerCase();
    const seen = companionSeenByCampaign.get(row.campaign_id) ?? new Set<string>();
    seen.add(normalized);
    companionSeenByCampaign.set(row.campaign_id, seen);
    const counts = companionCountByCampaign.get(row.campaign_id) ?? new Map<string, number>();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    companionCountByCampaign.set(row.campaign_id, counts);
  }

  for (const row of companions) {
    const seen = companionSeenByCampaign.get(row.campaign_id) ?? new Set<string>();
    const counts = companionCountByCampaign.get(row.campaign_id) ?? new Map<string, number>();
    const current = cleanName(row.name);
    let next = current;
    const duplicate = (counts.get(current.toLowerCase()) ?? 0) > 1;
    if (duplicate || needsCompanionRename(current)) {
      next = buildCompanionName(`${row.campaign_id}:${row.companion_id}:${row.archetype ?? "companion"}`);
      let suffix = 2;
      while (seen.has(next.toLowerCase())) {
        next = `${next} ${suffix}`;
        suffix += 1;
      }
    }
    if (next === current) continue;
    if (!args.dryRun) {
      const { error } = await supabase
        .schema("mythic")
        .from("campaign_companions")
        .update({ name: next })
        .eq("campaign_id", row.campaign_id)
        .eq("companion_id", row.companion_id);
      if (error) throw error;
    }
    renamedCompanions += 1;
    seen.delete(current.toLowerCase());
    seen.add(next.toLowerCase());
    companionSeenByCampaign.set(row.campaign_id, seen);
  }

  const { data: sessionRows, error: sessionError } = await supabase
    .schema("mythic")
    .from("combat_sessions")
    .select("id,campaign_id")
    .in("campaign_id", campaignIds);
  if (sessionError) throw sessionError;
  const sessionIds = (sessionRows ?? [])
    .map((row) => String((row as { id?: unknown }).id ?? "").trim())
    .filter((id) => id.length > 0);

  if (sessionIds.length > 0) {
    const { data: combatantsRaw, error: combatantError } = await supabase
      .schema("mythic")
      .from("combatants")
      .select("id,combat_session_id,name,entity_type")
      .in("combat_session_id", sessionIds)
      .in("entity_type", ["npc", "summon"])
      .order("combat_session_id", { ascending: true })
      .order("created_at", { ascending: true });
    if (combatantError) throw combatantError;

    const combatants = (combatantsRaw ?? []) as CombatantRow[];
    const usedBySession = new Map<string, Set<string>>();
    for (const row of combatants) {
      const used = usedBySession.get(row.combat_session_id) ?? new Set<string>();
      used.add(cleanName(row.name).toLowerCase());
      usedBySession.set(row.combat_session_id, used);
    }

    for (const row of combatants) {
      const used = usedBySession.get(row.combat_session_id) ?? new Set<string>();
      const current = cleanName(row.name);
      let next = current;
      if (LOW_SIGNAL_NAME.test(current) || current.length === 0) {
        next = buildEnemyName(`${row.combat_session_id}:${row.id}:${row.entity_type}`);
        let suffix = 2;
        while (used.has(next.toLowerCase())) {
          next = `${next} ${suffix}`;
          suffix += 1;
        }
      }
      if (next === current) continue;
      if (!args.dryRun) {
        const { error } = await supabase
          .schema("mythic")
          .from("combatants")
          .update({ name: next })
          .eq("id", row.id);
        if (error) throw error;
      }
      renamedCombatants += 1;
      used.delete(current.toLowerCase());
      used.add(next.toLowerCase());
      usedBySession.set(row.combat_session_id, used);
    }
  }

  console.log(
    [
      `Campaigns scoped: ${campaignIds.length}`,
      `Skills renamed: ${renamedSkills}`,
      `Skills tagged: ${taggedSkills}`,
      `Companions renamed: ${renamedCompanions}`,
      `Combatants renamed: ${renamedCombatants}`,
      `Mode: ${args.dryRun ? "dry-run" : "apply"}`,
    ].join("\n"),
  );
}

const asMain = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (asMain) {
  runBackfillMythicPresentationWordbank().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
