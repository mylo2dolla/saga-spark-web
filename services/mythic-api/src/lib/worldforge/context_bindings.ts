import {
  type CampaignContext,
  WORLD_FORGE_VERSION,
} from "./schema.js";
import { summarizeWorldContext } from "./generator.js";

export interface WorldSeedPayloadOptions {
  includeTitleDescription?: boolean;
  includeLegacySeed?: boolean;
  includeThemeTags?: boolean;
  includeToneVector?: boolean;
  title?: string;
  description?: string;
}

export function buildWorldSeedPayload(
  campaignContext: CampaignContext,
  options: WorldSeedPayloadOptions = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (options.includeTitleDescription) {
    payload.title = options.title ?? campaignContext.title;
    payload.description = options.description ?? campaignContext.description;
  }

  payload.seed_number = campaignContext.worldSeed.seedNumber;
  payload.seed_string = campaignContext.worldSeed.seedString;

  if (options.includeLegacySeed) {
    payload.seed = campaignContext.worldSeed.seedNumber;
  }
  if (options.includeThemeTags) {
    payload.theme_tags = campaignContext.worldSeed.themeTags;
  }
  if (options.includeToneVector) {
    payload.tone_vector = campaignContext.worldSeed.toneVector;
  }

  return payload;
}

export interface RuntimeWorldBindingsOptions {
  includeCampaignContext?: boolean;
  includeBiomeAtmosphere?: boolean;
  directiveLimit?: number;
  coreConflictLimit?: number;
  factionTensionLimit?: number;
}

function clampSliceLimit(value: number | undefined, fallback: number, min = 1, max = 24): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function buildRuntimeWorldBindings(
  campaignContext: CampaignContext,
  options: RuntimeWorldBindingsOptions = {},
): Record<string, unknown> {
  const includeCampaignContext = options.includeCampaignContext !== false;
  const includeBiomeAtmosphere = options.includeBiomeAtmosphere === true;
  const directiveLimit = clampSliceLimit(options.directiveLimit, 6, 1, 12);
  const coreConflictLimit = clampSliceLimit(options.coreConflictLimit, 4, 1, 12);
  const factionTensionLimit = clampSliceLimit(options.factionTensionLimit, 4, 1, 16);

  const worldSummary = summarizeWorldContext(campaignContext);

  const bindings: Record<string, unknown> = {
    world_forge_version: campaignContext.worldForgeVersion || WORLD_FORGE_VERSION,
    world_context: worldSummary,
    dm_context: {
      profile: campaignContext.dmContext.dmBehaviorProfile,
      directives: campaignContext.dmContext.narrativeDirectives.slice(0, directiveLimit),
    },
    world_state: campaignContext.worldContext.worldState,
    moral_climate: campaignContext.worldContext.worldBible.moralClimate,
    core_conflicts: campaignContext.worldContext.worldBible.coreConflicts.slice(0, coreConflictLimit),
    faction_tensions: campaignContext.worldContext.factionGraph.activeTensions.slice(0, factionTensionLimit),
  };

  if (includeCampaignContext) {
    bindings.campaign_context = campaignContext;
  }

  if (includeBiomeAtmosphere) {
    bindings.biome_atmosphere = campaignContext.worldContext.biomeMap.regions.slice(0, 6).map((region) => ({
      id: region.id,
      name: region.name,
      biome: region.dominantBiome,
      corruption: region.corruption,
      dungeon_density: region.dungeonDensity,
    }));
  }

  return bindings;
}

export interface DmContextPayloadOptions {
  includeProfile?: boolean;
  narrativeLimit?: number;
  tacticalLimit?: number;
  useDirectivesKey?: boolean;
}

export function buildDmContextPayload(
  campaignContext: CampaignContext,
  options: DmContextPayloadOptions = {},
): Record<string, unknown> {
  const includeProfile = options.includeProfile !== false;
  const narrativeLimit = clampSliceLimit(options.narrativeLimit, 6, 1, 12);
  const tacticalLimit = clampSliceLimit(options.tacticalLimit, 5, 1, 12);
  const useDirectivesKey = options.useDirectivesKey === true;

  const payload: Record<string, unknown> = {};
  if (includeProfile) {
    payload.profile = campaignContext.dmContext.dmBehaviorProfile;
  }

  if (useDirectivesKey) {
    payload.directives = campaignContext.dmContext.narrativeDirectives.slice(0, narrativeLimit);
  } else {
    payload.narrative_directives = campaignContext.dmContext.narrativeDirectives.slice(0, narrativeLimit);
    payload.tactical_directives = campaignContext.dmContext.tacticalDirectives.slice(0, tacticalLimit);
  }

  return payload;
}
