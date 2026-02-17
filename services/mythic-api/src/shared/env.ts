function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface MythicApiConfig {
  port: number;
  host: string;
  logLevel: string;
  allowedOrigins: string[];
  globalRateLimitMax: number;
  globalRateLimitWindowMs: number;
  supabaseUrl: string;
  supabaseProjectRef: string;
  supabaseServiceRoleKey: string;
  supabaseJwtIssuer: string;
  supabaseJwksUrl: string;
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

  const allowedOrigins = splitCsv(process.env.MYTHIC_ALLOWED_ORIGINS);

  const supabaseJwtIssuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  const supabaseJwksUrl = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;

  const openaiApiKey = (process.env.OPENAI_API_KEY ?? "").trim() || null;
  const openaiBaseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").trim();

  return {
    port: Number.isFinite(port) ? port : 3001,
    host,
    logLevel: (process.env.LOG_LEVEL ?? "info").trim(),
    allowedOrigins,
    globalRateLimitMax: Math.max(10, Math.floor(Number(process.env.GLOBAL_RATE_LIMIT_MAX ?? 240) || 240)),
    globalRateLimitWindowMs: Math.max(1_000, Math.floor(Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS ?? 60_000) || 60_000)),
    supabaseUrl,
    supabaseProjectRef,
    supabaseServiceRoleKey,
    supabaseJwtIssuer,
    supabaseJwksUrl,
    openaiApiKey,
    openaiBaseUrl,
  };
}
