#!/usr/bin/env -S node --enable-source-maps
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildRuntimeWorldBindings,
  buildWorldProfilePayload,
  buildWorldSeedPayload,
  coerceCampaignContextFromProfile,
  WORLD_FORGE_VERSION,
} from "../services/mythic-api/src/lib/worldforge/index.ts";

interface CliArgs {
  campaignIds: string[];
  all: boolean;
  limit: number;
  dryRun: boolean;
  yes: boolean;
  patchRuntime: boolean;
}

interface CampaignMeta {
  id: string;
  name: string | null;
  description: string | null;
}

interface ProfileRow {
  campaign_id: string;
  seed_title: string | null;
  seed_description: string | null;
  template_key: string | null;
  world_profile_json: Record<string, unknown> | null;
}

type ProfileSource = "world_profiles" | "campaign_world_profiles";

function usage(): void {
  console.log([
    "Usage: npx tsx scripts/backfill-worldforge-profiles.ts [--campaign-id=<uuid,...>|--all] [--limit=<n>] [--dry-run] [--yes] [--no-runtime-patch]",
    "",
    "Backfills world profile payloads to the current worldforge version and optionally patches active runtime state world context.",
    "Examples:",
    "  npx tsx scripts/backfill-worldforge-profiles.ts --campaign-id=<uuid> --dry-run",
    "  npx tsx scripts/backfill-worldforge-profiles.ts --all --limit=100 --yes",
  ].join("\n"));
}

function parseArgs(argv: string[]): CliArgs {
  let campaignIds: string[] = [];
  let all = false;
  let limit = 200;
  let dryRun = false;
  let yes = false;
  let patchRuntime = true;

  for (const token of argv) {
    if (token === "--all") {
      all = true;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--yes") {
      yes = true;
      continue;
    }
    if (token === "--no-runtime-patch") {
      patchRuntime = false;
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
    if (token.startsWith("--limit=")) {
      const parsed = Number(token.slice("--limit=".length));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive number");
      }
      limit = Math.floor(parsed);
      continue;
    }
    if (token === "--help" || token === "-h") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (campaignIds.length === 0 && !all) {
    throw new Error("Provide --campaign-id or --all.");
  }

  return {
    campaignIds,
    all,
    limit,
    dryRun,
    yes,
    patchRuntime,
  };
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
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  const fromFile = fallback[key]?.trim();
  if (fromFile) return fromFile;
  throw new Error(`Missing required env var: ${key}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function fetchCampaignMeta(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
): Promise<CampaignMeta> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id,name,description")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  return {
    id: campaignId,
    name: typeof data?.name === "string" ? data.name : null,
    description: typeof data?.description === "string" ? data.description : null,
  };
}

async function loadProfileRow(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
): Promise<{ source: ProfileSource; row: ProfileRow } | null> {
  const primary = await supabase
    .schema("mythic")
    .from("world_profiles")
    .select("campaign_id,seed_title,seed_description,template_key,world_profile_json")
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (!primary.error && primary.data) {
    return {
      source: "world_profiles",
      row: {
        campaign_id: String(primary.data.campaign_id),
        seed_title: primary.data.seed_title,
        seed_description: primary.data.seed_description,
        template_key: primary.data.template_key,
        world_profile_json: asRecord(primary.data.world_profile_json),
      },
    };
  }

  const legacy = await supabase
    .schema("mythic")
    .from("campaign_world_profiles")
    .select("campaign_id,seed_title,seed_description,template_key,world_profile_json")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (!legacy.error && legacy.data) {
    return {
      source: "campaign_world_profiles",
      row: {
        campaign_id: String(legacy.data.campaign_id),
        seed_title: legacy.data.seed_title,
        seed_description: legacy.data.seed_description,
        template_key: legacy.data.template_key,
        world_profile_json: asRecord(legacy.data.world_profile_json),
      },
    };
  }

  return null;
}

function profileNeedsRefresh(profileJson: Record<string, unknown> | null): boolean {
  const raw = profileJson ?? {};
  const version = String(raw.world_forge_version ?? raw.worldForgeVersion ?? "").trim();
  if (version !== WORLD_FORGE_VERSION) return true;
  if (!asRecord(raw.campaign_context ?? raw.campaignContext)) return true;
  if (!asRecord(raw.world_context ?? raw.worldContext)) return true;
  if (!asRecord(raw.dm_context ?? raw.dmContext)) return true;
  return false;
}

async function patchRuntimeState(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
  title: string,
  description: string,
  profilePayload: Record<string, unknown>,
): Promise<boolean> {
  const campaignContext = asRecord(profilePayload.campaign_context);
  if (!campaignContext) return false;

  const { data: runtimeRows, error } = await supabase
    .schema("mythic")
    .from("campaign_runtime")
    .select("id,state_json,updated_at")
    .eq("campaign_id", campaignId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const runtime = runtimeRows?.[0];
  if (!runtime) return false;

  const rebuiltContext = coerceCampaignContextFromProfile({
    seedTitle: title,
    seedDescription: description,
    templateKey: String(profilePayload.template_key ?? "custom"),
    worldProfileJson: profilePayload,
  });

  const runtimeBindings = buildRuntimeWorldBindings(rebuiltContext, {
    includeCampaignContext: true,
    includeBiomeAtmosphere: true,
    directiveLimit: 6,
    coreConflictLimit: 4,
    factionTensionLimit: 5,
  });

  const currentState = asRecord(runtime.state_json) ?? {};
  const nextState = {
    ...currentState,
    world_seed: buildWorldSeedPayload(rebuiltContext, {
      includeTitleDescription: true,
      title,
      description,
      includeLegacySeed: true,
    }),
    ...runtimeBindings,
  };

  const update = await supabase
    .schema("mythic")
    .from("campaign_runtime")
    .update({ state_json: nextState })
    .eq("id", runtime.id);

  if (update.error) throw update.error;
  return true;
}

export async function runWorldforgeBackfill(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const envFallback = {
    ...parseEnvFile(path.join(repoRoot, ".env")),
    ...parseEnvFile(path.join(repoRoot, "services", "mythic-api", ".env")),
  };

  const supabaseUrl = requireEnv("SUPABASE_URL", envFallback);
  const serviceRole = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFallback);

  if (!args.dryRun && !args.yes) {
    throw new Error("Refusing to mutate data without --yes. Use --dry-run first.");
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let targetCampaignIds = args.campaignIds;
  if (args.all) {
    const { data, error } = await supabase
      .schema("mythic")
      .from("world_profiles")
      .select("campaign_id")
      .order("campaign_id", { ascending: true })
      .limit(args.limit);
    if (error) throw error;
    targetCampaignIds = (data ?? [])
      .map((row) => String((row as { campaign_id?: unknown }).campaign_id ?? "").trim())
      .filter((entry) => entry.length > 0);
  }

  const uniqueCampaignIds = Array.from(new Set(targetCampaignIds));
  if (uniqueCampaignIds.length === 0) {
    console.log("No campaigns matched the selection.");
    return;
  }

  let inspected = 0;
  let updatedProfiles = 0;
  let patchedRuntime = 0;
  let skipped = 0;

  for (const campaignId of uniqueCampaignIds) {
    inspected += 1;
    const campaignMeta = await fetchCampaignMeta(supabase, campaignId);
    const loaded = await loadProfileRow(supabase, campaignId);

    if (!loaded) {
      skipped += 1;
      console.log(`[skip] ${campaignId}: no profile row found in mythic.world_profiles or mythic.campaign_world_profiles`);
      continue;
    }

    const profile = loaded.row;
    const source = loaded.source;
    const title = (profile.seed_title ?? campaignMeta.name ?? `Campaign ${campaignId.slice(0, 8)}`).trim();
    const description = (profile.seed_description ?? campaignMeta.description ?? "World profile backfilled from campaign metadata.").trim();
    const templateKey = (profile.template_key ?? "custom").trim() || "custom";
    const profileJson = profile.world_profile_json ?? {};

    const campaignContext = coerceCampaignContextFromProfile({
      seedTitle: title,
      seedDescription: description,
      templateKey,
      worldProfileJson: profileJson,
    });

    const nextProfileJson = buildWorldProfilePayload({
      source: "backfill-worldforge-profiles",
      campaignContext,
      templateKey,
    });

    const needsRefresh = profileNeedsRefresh(profileJson)
      || JSON.stringify(profileJson) !== JSON.stringify(nextProfileJson);

    if (!needsRefresh) {
      skipped += 1;
      console.log(`[skip] ${campaignId}: already at ${WORLD_FORGE_VERSION}`);
      continue;
    }

    const profilePayload = {
      campaign_id: campaignId,
      seed_title: title,
      seed_description: description,
      template_key: templateKey,
      world_profile_json: nextProfileJson,
    };

    if (args.dryRun) {
      console.log(`[dry-run] ${campaignId}: would update ${source} -> ${WORLD_FORGE_VERSION}`);
    } else {
      const upsertPrimary = await supabase
        .schema("mythic")
        .from("world_profiles")
        .upsert(profilePayload, { onConflict: "campaign_id" });
      if (upsertPrimary.error) throw upsertPrimary.error;

      const upsertLegacy = await supabase
        .schema("mythic")
        .from("campaign_world_profiles")
        .upsert(profilePayload, { onConflict: "campaign_id" });
      if (upsertLegacy.error) throw upsertLegacy.error;

      updatedProfiles += 1;
      console.log(`[update] ${campaignId}: world profile payload refreshed to ${WORLD_FORGE_VERSION}`);
    }

    if (args.patchRuntime) {
      if (args.dryRun) {
        console.log(`[dry-run] ${campaignId}: would patch active runtime state with rebuilt world bindings`);
      } else {
        const patched = await patchRuntimeState(supabase, campaignId, title, description, nextProfileJson);
        if (patched) {
          patchedRuntime += 1;
          console.log(`[update] ${campaignId}: active runtime state patched with worldforge bindings`);
        }
      }
    }
  }

  console.log("\nWorldforge backfill summary");
  console.log(`- Inspected campaigns: ${inspected}`);
  console.log(`- Updated profiles: ${updatedProfiles}`);
  console.log(`- Patched runtime rows: ${patchedRuntime}`);
  console.log(`- Skipped: ${skipped}`);
}

const asMain = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (asMain) {
  runWorldforgeBackfill().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
