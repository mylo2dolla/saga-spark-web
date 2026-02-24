import { readFileSync } from "node:fs";

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

function readFirstSet(keys: string[]): string | null {
  for (const key of keys) {
    const value = (process.env[key] ?? "").trim();
    if (value.length > 0) return value;
  }
  return null;
}

type SecretCandidate = {
  valueKey: string;
  fileKey: string;
};

function readSecretFromEnvOrFile(candidate: SecretCandidate): string | null {
  const direct = (process.env[candidate.valueKey] ?? "").trim();
  if (direct.length > 0) return direct;

  const filePath = (process.env[candidate.fileKey] ?? "").trim();
  if (!filePath) return null;

  try {
    const fromFile = readFileSync(filePath, "utf8").trim();
    return fromFile.length > 0 ? fromFile : null;
  } catch (error) {
    throw new Error(
      `${candidate.fileKey} is set but could not be read (${filePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readFirstSecretSet(candidates: SecretCandidate[]): string | null {
  for (const candidate of candidates) {
    const value = readSecretFromEnvOrFile(candidate);
    if (value) return value;
  }
  return null;
}

export type DmNarratorMode = "ai" | "procedural" | "hybrid";

function parseDmNarratorMode(value: string | undefined): DmNarratorMode | null {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "ai" || key === "procedural" || key === "hybrid") return key;
  return null;
}

export interface MythicApiConfig {
  port: number;
  host: string;
  logLevel: string;
  nodeEnv: string;
  allowedOrigins: string[];
  globalRateLimitMax: number;
  globalRateLimitWindowMs: number;
  dmNarratorMode: DmNarratorMode;
  allowDmNarratorQueryOverride: boolean;
  supabaseUrl: string;
  supabaseProjectRef: string;
  supabaseServiceRoleKey: string;
  supabaseJwtIssuer: string;
  supabaseJwksUrl: string;
  mythicTurnSalt: string;
  openaiApiKey: string | null;
  openaiBaseUrl: string;
}

export function getConfig(): MythicApiConfig {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const supabaseProjectRef = (process.env.SUPABASE_PROJECT_REF ?? "").trim();
  const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
  if (!supabaseProjectRef) throw new Error("SUPABASE_PROJECT_REF is required");
  if (!supabaseServiceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

  const port = Number(process.env.PORT ?? 3001);
  const host = (process.env.HOST ?? "0.0.0.0").trim();
  const nodeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase() || "development";

  const allowedOrigins = splitCsv(process.env.MYTHIC_ALLOWED_ORIGINS);

  const supabaseJwtIssuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  const supabaseJwksUrl = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;

  const mythicTurnSalt = (process.env.MYTHIC_TURN_SALT ?? "").trim();
  const dmNarratorMode = parseDmNarratorMode(process.env.DM_NARRATOR_MODE) ?? "hybrid";
  const openaiApiKey = readFirstSecretSet([
    { valueKey: "OPENAI_API_KEY", fileKey: "OPENAI_API_KEY_FILE" },
    { valueKey: "TAILSCALE_OPENAI_API_KEY", fileKey: "TAILSCALE_OPENAI_API_KEY_FILE" },
    { valueKey: "LLM_API_KEY", fileKey: "LLM_API_KEY_FILE" },
  ]);
  const openaiBaseUrl = readFirstSet([
    "OPENAI_BASE_URL",
    "TAILSCALE_OPENAI_BASE_URL",
    "TAILSCALE_AI_BASE_URL",
    "LLM_BASE_URL",
  ]) ?? DEFAULT_OPENAI_BASE_URL;

  return {
    port: Number.isFinite(port) ? port : 3001,
    host,
    nodeEnv,
    logLevel: (process.env.LOG_LEVEL ?? "info").trim(),
    allowedOrigins,
    globalRateLimitMax: Math.max(10, Math.floor(Number(process.env.GLOBAL_RATE_LIMIT_MAX ?? 240) || 240)),
    globalRateLimitWindowMs: Math.max(1_000, Math.floor(Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS ?? 60_000) || 60_000)),
    dmNarratorMode,
    allowDmNarratorQueryOverride: nodeEnv !== "production",
    supabaseUrl,
    supabaseProjectRef,
    supabaseServiceRoleKey,
    supabaseJwtIssuer,
    supabaseJwksUrl,
    mythicTurnSalt,
    openaiApiKey,
    openaiBaseUrl,
  };
}
