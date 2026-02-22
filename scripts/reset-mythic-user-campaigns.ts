#!/usr/bin/env -S node --enable-source-maps
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

interface CliArgs {
  userId: string | null;
  email: string | null;
  dryRun: boolean;
  yes: boolean;
}

interface CampaignRow {
  id: string;
  name: string | null;
}

function parseArgs(argv: string[]): CliArgs {
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
    if (token.startsWith("--user-id=")) {
      userId = token.slice("--user-id=".length).trim() || null;
      continue;
    }
    if (token.startsWith("--email=")) {
      email = token.slice("--email=".length).trim().toLowerCase() || null;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { userId, email, dryRun, yes };
}

function printUsage(): void {
  console.log(
    [
      "Usage: npx tsx scripts/reset-mythic-user-campaigns.ts [--user-id=<uuid>] [--email=<address>] [--dry-run] [--yes]",
      "",
      "Deletes Mythic campaigns owned by the specified user in the active environment.",
      "Scope is strictly owner-based campaign rows and uses mythic.admin_purge_campaigns for cleanup.",
      "",
      "Examples:",
      "  npx tsx scripts/reset-mythic-user-campaigns.ts --email=strange-ops@cyber-wizard.com --dry-run",
      "  npx tsx scripts/reset-mythic-user-campaigns.ts --user-id=<uuid> --yes",
    ].join("\n"),
  );
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equal = line.indexOf("=");
    if (equal <= 0) continue;
    const key = line.slice(0, equal).trim();
    const value = line.slice(equal + 1).trim().replace(/^"|"$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

function requireEnv(key: string, fallback: Record<string, string>): string {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) return fromProcess;
  const fromFallback = fallback[key]?.trim();
  if (fromFallback) return fromFallback;
  throw new Error(`Missing required env var: ${key}`);
}

async function resolveUserId(args: CliArgs, supabase: ReturnType<typeof createClient>): Promise<string> {
  if (args.userId) return args.userId;
  if (!args.email) {
    throw new Error("Provide either --user-id or --email.");
  }

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

async function listOwnedCampaigns(supabase: ReturnType<typeof createClient>, userId: string): Promise<CampaignRow[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id,name")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String((row as { id?: unknown }).id ?? ""),
    name: typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name : null,
  })).filter((row) => row.id.length > 0);
}

async function purgeCampaigns(
  supabase: ReturnType<typeof createClient>,
  campaignIds: string[],
): Promise<void> {
  if (campaignIds.length === 0) return;
  const { error } = await supabase
    .schema("mythic")
    .rpc("admin_purge_campaigns", { target_campaign_ids: campaignIds });
  if (error) throw error;
}

export async function runResetMythicUserCampaigns(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const envFallback = parseEnvFile(path.join(repoRoot, "services", "mythic-api", ".env"));
  const supabaseUrl = requireEnv("SUPABASE_URL", envFallback);
  const serviceRole = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFallback);
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = await resolveUserId(args, supabase);
  const campaigns = await listOwnedCampaigns(supabase, userId);
  if (campaigns.length === 0) {
    console.log(`No owned campaigns found for user ${userId}.`);
    return;
  }

  console.log(`User ${userId} owns ${campaigns.length} campaign(s):`);
  for (const campaign of campaigns) {
    console.log(` - ${campaign.id}${campaign.name ? ` :: ${campaign.name}` : ""}`);
  }

  if (args.dryRun) {
    console.log("Dry run complete. No data deleted.");
    return;
  }
  if (!args.yes) {
    throw new Error("Refusing to delete without --yes. Re-run with --yes after verifying the list.");
  }

  const ids = campaigns.map((entry) => entry.id);
  await purgeCampaigns(supabase, ids);
  console.log(`Purged ${ids.length} campaign(s) for user ${userId}.`);
}

const asMain = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (asMain) {
  runResetMythicUserCampaigns().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
