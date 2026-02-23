function normalizeOriginToken(value: string): string | null {
  let token = value.trim();
  if (!token) return null;

  if (/^https\/\//i.test(token)) {
    token = token.replace(/^https\/\//i, "https://");
  } else if (/^http\/\//i.test(token)) {
    token = token.replace(/^http\/\//i, "http://");
  }

  try {
    const parsed = new URL(token);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const unique = new Set<string>();
  const out: string[] = [];
  for (const entry of value.split(",")) {
    const normalized = normalizeOriginToken(entry);
    if (!normalized) {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        // Keep startup non-fatal; skip malformed values so CORS stays sane.
        console.warn(`[mythic-api] Ignoring invalid MYTHIC_ALLOWED_ORIGINS entry: "${trimmed}"`);
      }
      continue;
    }
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    out.push(normalized);
  }
  return out;
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

  const allowedOrigins = parseAllowedOrigins(process.env.MYTHIC_ALLOWED_ORIGINS);

  const supabaseJwtIssuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  const supabaseJwksUrl = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;

  const mythicTurnSalt = (process.env.MYTHIC_TURN_SALT ?? "").trim();
  const dmNarratorMode = parseDmNarratorMode(process.env.DM_NARRATOR_MODE) ?? "hybrid";
  const openaiApiKey = (process.env.OPENAI_API_KEY ?? "").trim() || null;
  const openaiBaseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").trim();

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
