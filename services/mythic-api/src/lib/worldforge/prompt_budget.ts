import { WORLD_FORGE_VERSION } from "./schema.js";

export const DEFAULT_DM_WORLD_PROMPT_BUDGET = 2_000;

export interface WorldPromptContextInput {
  worldForgeVersion?: string | null;
  worldSeed?: Record<string, unknown> | null;
  worldContext?: Record<string, unknown> | null;
  dmContext?: Record<string, unknown> | null;
  worldState?: Record<string, unknown> | null;
  campaignContext?: Record<string, unknown> | null;
  maxChars?: number;
}

export interface WorldPromptContextMeta {
  rawChars: number;
  finalChars: number;
  maxChars: number;
  trimmed: boolean;
  droppedSections: string[];
  reductions: string[];
}

export interface WorldPromptContextResult {
  payload: Record<string, unknown>;
  meta: WorldPromptContextMeta;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function trunc(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen).trim()}...`;
}

function measureJson(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function compactToneVector(raw: unknown): Record<string, number> | null {
  const tone = asRecord(raw);
  if (!tone) return null;
  const keys = ["darkness", "whimsy", "brutality", "absurdity", "cosmic", "heroic", "tragic", "cozy"];
  const out: Record<string, number> = {};
  for (const key of keys) {
    const value = Number(tone[key]);
    if (!Number.isFinite(value)) continue;
    out[key] = Math.max(0, Math.min(1, Number(value.toFixed(3))));
  }
  return Object.keys(out).length > 0 ? out : null;
}

function compactWorldSeed(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  const seedNumber = Number(raw.seed_number ?? raw.seedNumber ?? raw.seed ?? Number.NaN);
  const seedString = trunc(raw.seed_string ?? raw.seedString, 120);
  const title = trunc(raw.title, 120);
  const description = trunc(raw.description, 180);
  const themeTags = asStringArray(raw.theme_tags ?? raw.themeTags).slice(0, 10);
  const toneVector = compactToneVector(raw.tone_vector ?? raw.toneVector);

  const out: Record<string, unknown> = {};
  if (title) out.title = title;
  if (description) out.description = description;
  if (Number.isFinite(seedNumber)) out.seed_number = Math.max(0, Math.floor(seedNumber));
  if (seedString) out.seed_string = seedString;
  if (themeTags.length > 0) out.theme_tags = themeTags;
  if (toneVector) out.tone_vector = toneVector;
  return Object.keys(out).length > 0 ? out : null;
}

function compactDominantFactionRows(raw: unknown, limit: number): Array<Record<string, unknown>> {
  return asArray(raw)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(0, limit)
    .map((entry) => {
      const row: Record<string, unknown> = {};
      const id = trunc(entry.id, 64);
      const name = trunc(entry.name, 72);
      const ideology = trunc(entry.ideology, 92);
      const power = Number(entry.power ?? entry.powerLevel ?? Number.NaN);
      if (id) row.id = id;
      if (name) row.name = name;
      if (ideology) row.ideology = ideology;
      if (Number.isFinite(power)) row.power = Math.max(0, Math.floor(power));
      return row;
    });
}

function compactBiomeRows(raw: unknown, limit: number): Array<Record<string, unknown>> {
  return asArray(raw)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(0, limit)
    .map((entry) => {
      const row: Record<string, unknown> = {};
      const id = trunc(entry.id, 64);
      const name = trunc(entry.name, 72);
      const biome = trunc(entry.dominant_biome ?? entry.biome ?? entry.dominantBiome, 48);
      const corruption = Number(entry.corruption ?? Number.NaN);
      const dungeonDensity = Number(entry.dungeon_density ?? entry.dungeonDensity ?? Number.NaN);
      if (id) row.id = id;
      if (name) row.name = name;
      if (biome) row.biome = biome;
      if (Number.isFinite(corruption)) row.corruption = Number(corruption.toFixed(3));
      if (Number.isFinite(dungeonDensity)) row.dungeon_density = Number(dungeonDensity.toFixed(3));
      return row;
    });
}

function compactMagicRules(raw: unknown): Record<string, unknown> | null {
  const value = asRecord(raw);
  if (!value) return null;
  const density = trunc(value.density, 24);
  const volatility = Number(value.volatility ?? Number.NaN);
  const schools = asStringArray(value.schools).slice(0, 4);
  const out: Record<string, unknown> = {};
  if (density) out.density = density;
  if (Number.isFinite(volatility)) out.volatility = Number(volatility.toFixed(3));
  if (schools.length > 0) out.schools = schools;
  return Object.keys(out).length > 0 ? out : null;
}

function compactLootFlavor(raw: unknown): Record<string, unknown> | null {
  const value = asRecord(raw);
  if (!value) return null;
  const whimsical = Number(value.whimsical_scale ?? value.whimsicalScale ?? Number.NaN);
  const flourish = asStringArray(value.flourish_samples ?? value.flourishPool).slice(0, 4);
  const out: Record<string, unknown> = {};
  if (Number.isFinite(whimsical)) out.whimsical_scale = Number(whimsical.toFixed(3));
  if (flourish.length > 0) out.flourish_samples = flourish;
  return Object.keys(out).length > 0 ? out : null;
}

function compactWorldContext(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;

  const fullWorldBible = asRecord(raw.worldBible);
  const fullFactions = asRecord(raw.factionGraph);
  const fullBiomes = asRecord(raw.biomeMap);
  const fullCreatures = asRecord(raw.creaturePools);
  const fullMagic = asRecord(raw.magicRules);
  const fullLoot = asRecord(raw.lootFlavorProfile);

  const worldName = trunc(raw.world_name ?? fullWorldBible?.worldName, 120);
  const toneVector = compactToneVector(raw.tone_vector ?? raw.toneVector);
  const themeTags = asStringArray(raw.theme_tags ?? raw.themeTags).slice(0, 10);
  const moralClimate = trunc(raw.moral_climate ?? fullWorldBible?.moralClimate, 180);
  const coreConflicts = asStringArray(raw.core_conflicts ?? fullWorldBible?.coreConflicts).slice(0, 5);
  const dominantFactions = compactDominantFactionRows(raw.dominant_factions ?? fullFactions?.factions, 6);
  const factionTensions = asStringArray(raw.faction_tensions ?? fullFactions?.activeTensions).slice(0, 6);
  const biomeAtmosphere = compactBiomeRows(raw.biome_atmosphere ?? fullBiomes?.regions, 6);
  const creatureFocus = asStringArray(raw.creature_focus ?? fullCreatures?.featuredFocus).slice(0, 6);
  const magicRules = compactMagicRules(raw.magic_rules ?? fullMagic);
  const lootFlavor = compactLootFlavor(raw.loot_flavor ?? fullLoot);

  const out: Record<string, unknown> = {};
  if (worldName) out.world_name = worldName;
  if (toneVector) out.tone_vector = toneVector;
  if (themeTags.length > 0) out.theme_tags = themeTags;
  if (moralClimate) out.moral_climate = moralClimate;
  if (coreConflicts.length > 0) out.core_conflicts = coreConflicts;
  if (dominantFactions.length > 0) out.dominant_factions = dominantFactions;
  if (factionTensions.length > 0) out.faction_tensions = factionTensions;
  if (biomeAtmosphere.length > 0) out.biome_atmosphere = biomeAtmosphere;
  if (creatureFocus.length > 0) out.creature_focus = creatureFocus;
  if (magicRules) out.magic_rules = magicRules;
  if (lootFlavor) out.loot_flavor = lootFlavor;

  return Object.keys(out).length > 0 ? out : null;
}

function compactDmContext(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;

  const profile = asRecord(raw.profile ?? raw.dmBehaviorProfile);
  const narrative = asStringArray(raw.narrative_directives ?? raw.narrativeDirectives ?? raw.directives).slice(0, 6);
  const tactical = asStringArray(raw.tactical_directives ?? raw.tacticalDirectives).slice(0, 5);

  const out: Record<string, unknown> = {};
  if (profile) {
    out.profile = {
      crueltyBias: Number(profile.crueltyBias ?? profile.cruelty_bias ?? 0),
      generosityBias: Number(profile.generosityBias ?? profile.generosity_bias ?? 0),
      chaosBias: Number(profile.chaosBias ?? profile.chaos_bias ?? 0),
      fairnessBias: Number(profile.fairnessBias ?? profile.fairness_bias ?? 0),
      humorBias: Number(profile.humorBias ?? profile.humor_bias ?? 0),
      memoryDepth: Number(profile.memoryDepth ?? profile.memory_depth ?? 0),
    };
  }
  if (narrative.length > 0) out.narrative_directives = narrative;
  if (tactical.length > 0) out.tactical_directives = tactical;

  return Object.keys(out).length > 0 ? out : null;
}

function compactFactionStates(raw: unknown, limit: number): Array<Record<string, unknown>> {
  const rows = asArray(raw)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const factionId = trunc(entry.factionId ?? entry.faction_id, 96);
      const power = Number(entry.powerLevel ?? entry.power_level ?? Number.NaN);
      const trust = Number(entry.trustDelta ?? entry.trust_delta ?? Number.NaN);
      const lastActionTick = Number(entry.lastActionTick ?? entry.last_action_tick ?? Number.NaN);
      const out: Record<string, unknown> = {};
      if (factionId) out.faction_id = factionId;
      if (Number.isFinite(power)) out.power = Math.floor(power);
      if (Number.isFinite(trust)) out.trust = Math.floor(trust);
      if (Number.isFinite(lastActionTick)) out.last_action_tick = Math.max(0, Math.floor(lastActionTick));
      return out;
    })
    .filter((entry) => Object.keys(entry).length > 0);

  rows.sort((left, right) => {
    const powerDiff = Math.abs(Number(right.power ?? 0)) - Math.abs(Number(left.power ?? 0));
    if (powerDiff !== 0) return powerDiff;
    return String(left.faction_id ?? "").localeCompare(String(right.faction_id ?? ""));
  });

  return rows.slice(0, limit);
}

function compactWorldHistory(raw: unknown, limit: number): Array<Record<string, unknown>> {
  const rows = asArray(raw)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(-limit)
    .map((entry) => {
      const tick = Number(entry.tick ?? Number.NaN);
      const type = trunc(entry.type, 80);
      const summary = trunc(entry.summary, 180);
      const impacts = asRecord(entry.impacts);
      const out: Record<string, unknown> = {};
      if (Number.isFinite(tick)) out.tick = Math.max(0, Math.floor(tick));
      if (type) out.type = type;
      if (summary) out.summary = summary;
      if (impacts) {
        const compactImpacts: Record<string, number> = {};
        for (const [key, value] of Object.entries(impacts)) {
          const num = Number(value);
          if (Number.isFinite(num)) {
            compactImpacts[key] = Number(num.toFixed(3));
          }
        }
        if (Object.keys(compactImpacts).length > 0) {
          out.impacts = compactImpacts;
        }
      }
      return out;
    })
    .filter((entry) => Object.keys(entry).length > 0);

  return rows;
}

function compactWorldState(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;

  const tick = Number(raw.tick ?? Number.NaN);
  const villainEscalation = Number(raw.villainEscalation ?? raw.villain_escalation ?? Number.NaN);
  const activeRumors = asStringArray(raw.activeRumors ?? raw.active_rumors).slice(-6);
  const collapsedDungeons = asStringArray(raw.collapsedDungeons ?? raw.collapsed_dungeons).slice(-5);
  const activeTowns = asStringArray(raw.activeTowns ?? raw.active_towns).slice(0, 6);
  const factionStates = compactFactionStates(raw.factionStates ?? raw.faction_states, 8);
  const history = compactWorldHistory(raw.history, 8);

  const out: Record<string, unknown> = {};
  if (Number.isFinite(tick)) out.tick = Math.max(0, Math.floor(tick));
  if (Number.isFinite(villainEscalation)) out.villain_escalation = Math.max(0, Math.floor(villainEscalation));
  if (activeRumors.length > 0) out.active_rumors = activeRumors;
  if (collapsedDungeons.length > 0) out.collapsed_dungeons = collapsedDungeons;
  if (activeTowns.length > 0) out.active_towns = activeTowns;
  if (factionStates.length > 0) out.faction_states = factionStates;
  if (history.length > 0) out.history = history;
  return Object.keys(out).length > 0 ? out : null;
}

function compactCampaignContext(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;

  const worldSeed = compactWorldSeed(asRecord(raw.worldSeed ?? raw.world_seed));
  const worldContext = compactWorldContext(asRecord(raw.worldContext ?? raw.world_context));

  const title = trunc(raw.title, 120);
  const description = trunc(raw.description, 200);
  const worldForgeVersion = trunc(raw.worldForgeVersion ?? raw.world_forge_version, 48);

  const out: Record<string, unknown> = {};
  if (title) out.title = title;
  if (description) out.description = description;
  if (worldForgeVersion) out.world_forge_version = worldForgeVersion;
  if (worldSeed) out.world_seed = worldSeed;
  if (worldContext) {
    out.world_context = {
      world_name: worldContext.world_name ?? null,
      moral_climate: worldContext.moral_climate ?? null,
      core_conflicts: asStringArray(worldContext.core_conflicts).slice(0, 3),
      faction_tensions: asStringArray(worldContext.faction_tensions).slice(0, 3),
    };
  }

  return Object.keys(out).length > 0 ? out : null;
}

function reduceDmContext(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  const reduced = { ...raw };
  const narrative = asStringArray(raw.narrative_directives).slice(0, 2);
  const tactical = asStringArray(raw.tactical_directives).slice(0, 2);
  if (narrative.length > 0) {
    reduced.narrative_directives = narrative;
  } else {
    delete reduced.narrative_directives;
  }
  if (tactical.length > 0) {
    reduced.tactical_directives = tactical;
  } else {
    delete reduced.tactical_directives;
  }
  return reduced;
}

export function buildPromptWorldContextBlock(input: WorldPromptContextInput): WorldPromptContextResult {
  const maxChars = Math.max(700, Math.min(4_000, Math.floor(Number(input.maxChars ?? DEFAULT_DM_WORLD_PROMPT_BUDGET))));

  const worldSeed = compactWorldSeed(input.worldSeed ?? null);
  const worldContext = compactWorldContext(input.worldContext ?? null);
  const dmContext = compactDmContext(input.dmContext ?? null);
  const worldState = compactWorldState(input.worldState ?? null);
  const campaignContext = compactCampaignContext(input.campaignContext ?? null);

  const basePayload: Record<string, unknown> = {
    world_forge_version: trunc(input.worldForgeVersion, 48) ?? WORLD_FORGE_VERSION,
    world_seed: worldSeed,
    world_context: worldContext,
    dm_context: dmContext,
    world_state: worldState,
    campaign_context: campaignContext,
  };

  const droppedSections: string[] = [];
  const reductions: string[] = [];

  const nextPayload: Record<string, unknown> = {
    ...basePayload,
  };

  const rawChars = measureJson(basePayload);
  let finalChars = rawChars;

  const recompute = () => {
    finalChars = measureJson(nextPayload);
  };

  recompute();

  if (finalChars > maxChars && nextPayload.campaign_context) {
    delete nextPayload.campaign_context;
    droppedSections.push("campaign_context");
    recompute();
  }

  if (finalChars > maxChars && nextPayload.world_state) {
    const worldStateReduced = asRecord(nextPayload.world_state);
    if (worldStateReduced) {
      nextPayload.world_state = {
        tick: worldStateReduced.tick ?? null,
        villain_escalation: worldStateReduced.villain_escalation ?? null,
        active_rumors: asStringArray(worldStateReduced.active_rumors).slice(0, 4),
        collapsed_dungeons: asStringArray(worldStateReduced.collapsed_dungeons).slice(0, 3),
        faction_states: compactFactionStates(worldStateReduced.faction_states, 5),
        history: compactWorldHistory(worldStateReduced.history, 4),
      };
      reductions.push("world_state:reduced");
      recompute();
    }
  }

  if (finalChars > maxChars && nextPayload.world_context) {
    const worldContextReduced = asRecord(nextPayload.world_context);
    if (worldContextReduced) {
      nextPayload.world_context = {
        world_name: worldContextReduced.world_name ?? null,
        tone_vector: worldContextReduced.tone_vector ?? null,
        theme_tags: asStringArray(worldContextReduced.theme_tags).slice(0, 6),
        moral_climate: worldContextReduced.moral_climate ?? null,
        core_conflicts: asStringArray(worldContextReduced.core_conflicts).slice(0, 3),
        faction_tensions: asStringArray(worldContextReduced.faction_tensions).slice(0, 3),
      };
      reductions.push("world_context:reduced");
      recompute();
    }
  }

  if (finalChars > maxChars && nextPayload.dm_context) {
    nextPayload.dm_context = reduceDmContext(asRecord(nextPayload.dm_context));
    reductions.push("dm_context:reduced");
    recompute();
  }

  if (finalChars > maxChars && nextPayload.world_state) {
    delete nextPayload.world_state;
    droppedSections.push("world_state");
    recompute();
  }

  if (finalChars > maxChars && nextPayload.world_context) {
    delete nextPayload.world_context;
    droppedSections.push("world_context");
    recompute();
  }

  if (finalChars > maxChars && nextPayload.dm_context) {
    delete nextPayload.dm_context;
    droppedSections.push("dm_context");
    recompute();
  }

  if (finalChars > maxChars && nextPayload.world_seed) {
    const fallbackSeed = asRecord(nextPayload.world_seed);
    nextPayload.world_seed = {
      seed_number: fallbackSeed?.seed_number ?? null,
      seed_string: fallbackSeed?.seed_string ?? null,
      theme_tags: asStringArray(fallbackSeed?.theme_tags).slice(0, 4),
      tone_vector: compactToneVector(fallbackSeed?.tone_vector) ?? null,
    };
    reductions.push("world_seed:reduced");
    recompute();
  }

  return {
    payload: nextPayload,
    meta: {
      rawChars,
      finalChars,
      maxChars,
      trimmed: finalChars < rawChars,
      droppedSections,
      reductions,
    },
  };
}
