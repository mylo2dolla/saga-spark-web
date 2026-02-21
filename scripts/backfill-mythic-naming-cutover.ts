#!/usr/bin/env -S node --enable-source-maps
import { createClient } from "@supabase/supabase-js";

type SkillRow = {
  id: string;
  character_id: string;
  name: string;
  kind: string;
  targeting: string;
  effects_json: Record<string, unknown> | null;
};

type CombatantRow = {
  id: string;
  combat_session_id: string;
  name: string;
  entity_type: "player" | "npc" | "summon";
};

const LOW_SIGNAL_SKILL_NAME = /^(passive\s*[ab]|reposition|guard|burst strike|disrupt|weakness exploit|setup lacer|judgment protocol|check nyx gallows|strategize with nyx gallows)$/i;
const LOW_SIGNAL_NPC_NAME = /(ink ghoul|ash brigand|gloom raider|rift hound|gallows stalker|enemy\s*\d+)/i;

const fantasySkillPrefixes = [
  "Fire",
  "Storm",
  "Moon",
  "Rift",
  "Shadow",
  "Thorn",
  "Sun",
  "Frost",
  "Void",
  "Dawn",
];
const fantasySkillSuffixes = {
  passive: ["Instinct", "Oath", "Rhythm", "Doctrine", "Vow"],
  self: ["Guard", "Ward", "Bulwark", "Aegis", "Resolve"],
  single: ["Strike", "Lancer", "Fang", "Sever", "Bolt"],
  tile: ["Step", "Rush", "Dash", "Vault", "Blink"],
  area: ["Nova", "Surge", "Tempest", "Quake", "Burst"],
  fallback: ["Weave", "Arc", "Shatter", "Pulse", "Crown"],
} as const;

const enemyPools = [
  "Cinder Marauder",
  "Moonshade Reaver",
  "Riftfang",
  "Gallows Knight",
  "Ashbound Harrier",
  "Dusk Revenant",
  "Grave Howler",
  "Umbral Raptor",
  "Thornbound Stalker",
  "Arc Bastion",
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(arr: readonly T[], key: string): T {
  return arr[hash32(key) % arr.length]!;
}

function compactName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function needsSkillRename(name: string): boolean {
  const clean = compactName(name);
  if (!clean) return true;
  if (LOW_SIGNAL_SKILL_NAME.test(clean)) return true;
  if (/^skill\s*\d+$/i.test(clean)) return true;
  return false;
}

function renamedSkillName(row: SkillRow): string {
  const metric = (row.targeting || "fallback").toLowerCase();
  const suffixBank = metric === "self"
    ? fantasySkillSuffixes.self
    : metric === "single"
      ? fantasySkillSuffixes.single
      : metric === "tile"
        ? fantasySkillSuffixes.tile
        : metric === "area"
          ? fantasySkillSuffixes.area
          : fantasySkillSuffixes.fallback;
  const prefix = row.kind === "passive"
    ? pick(["Battle", "Hunter", "Dread", "Arcane", "Mythic"], `${row.id}:passive_prefix`)
    : pick(fantasySkillPrefixes, `${row.id}:prefix`);
  const suffix = row.kind === "passive"
    ? pick(fantasySkillSuffixes.passive, `${row.id}:passive_suffix`)
    : pick(suffixBank, `${row.id}:suffix`);
  return `${prefix} ${suffix}`.trim();
}

function needsCombatantRename(name: string): boolean {
  const clean = compactName(name);
  if (!clean) return true;
  if (LOW_SIGNAL_NPC_NAME.test(clean)) return true;
  return false;
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRole = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const campaignId = process.env.CAMPAIGN_ID?.trim() || null;

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const skillQuery = supabase
    .schema("mythic")
    .from("skills")
    .select("id,character_id,name,kind,targeting,effects_json")
    .order("created_at", { ascending: true });
  const { data: skills, error: skillErr } = campaignId
    ? await skillQuery.eq("campaign_id", campaignId)
    : await skillQuery;
  if (skillErr) throw skillErr;

  const skillRows = (skills ?? []) as SkillRow[];
  let skillRenamed = 0;
  for (const row of skillRows) {
    if (!needsSkillRename(row.name)) continue;
    const nextName = renamedSkillName(row);
    const { error } = await supabase
      .schema("mythic")
      .from("skills")
      .update({ name: nextName })
      .eq("id", row.id);
    if (error) throw error;
    skillRenamed += 1;
  }

  const combatantQuery = supabase
    .schema("mythic")
    .from("combatants")
    .select("id,combat_session_id,name,entity_type")
    .in("entity_type", ["npc", "summon"])
    .order("combat_session_id", { ascending: true })
    .order("created_at", { ascending: true });
  let combatSessionIds: string[] | null = null;
  if (campaignId) {
    const { data: sessionRows, error: sessionErr } = await supabase
      .schema("mythic")
      .from("combat_sessions")
      .select("id")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true });
    if (sessionErr) throw sessionErr;
    combatSessionIds = (sessionRows ?? [])
      .map((row) => String((row as { id?: unknown }).id ?? "").trim())
      .filter((value) => value.length > 0);
  }

  const { data: combatants, error: combatantErr } = combatSessionIds
    ? (combatSessionIds.length > 0
      ? await combatantQuery.in("combat_session_id", combatSessionIds)
      : { data: [], error: null })
    : await combatantQuery;
  if (combatantErr) throw combatantErr;

  const combatantRows = (combatants ?? []) as CombatantRow[];
  const bySession = new Map<string, CombatantRow[]>();
  for (const row of combatantRows) {
    const list = bySession.get(row.combat_session_id) ?? [];
    list.push(row);
    bySession.set(row.combat_session_id, list);
  }

  let combatantRenamed = 0;
  for (const [sessionId, rows] of bySession.entries()) {
    const used = new Set<string>();
    for (const row of rows) {
      const current = compactName(row.name);
      if (!needsCombatantRename(current)) {
        used.add(current.toLowerCase());
        continue;
      }
      let next = pick(enemyPools, `${sessionId}:${row.id}:name`);
      let suffix = 2;
      while (used.has(next.toLowerCase())) {
        next = `${next} ${suffix}`;
        suffix += 1;
      }
      used.add(next.toLowerCase());
      const { error } = await supabase
        .schema("mythic")
        .from("combatants")
        .update({ name: next })
        .eq("id", row.id);
      if (error) throw error;
      combatantRenamed += 1;
    }
  }

  console.log(`naming backfill complete: skills=${skillRenamed} combatants=${combatantRenamed} campaign=${campaignId ?? "ALL"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
