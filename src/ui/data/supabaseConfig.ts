export interface SupabaseConfigInfo {
  url: string | null;
  anonKey: string | null;
  host: string | null;
  keyLength: number;
  maskedKey: string | null;
  keyType: "anon" | "publishable" | "unknown" | "missing";
  keySource: string | null;
  errors: string[];
  warnings: string[];
}

const isPublishableKey = (key: string) => key.startsWith("sb_publishable_");

const maskKey = (key: string) => {
  if (key.length <= 12) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
};

export const getSupabaseConfigInfo = (): SupabaseConfigInfo => {
  const url = (import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || "").trim() || null;
  const rawAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim() || null;
  const rawPublishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim() || null;
  // Keep the same precedence as the generated Supabase client: anon key first, then publishable key.
  const anonKey = rawAnonKey || rawPublishableKey;
  const errors: string[] = [];
  const warnings: string[] = [];
  let host: string | null = null;

  if (!url) {
    errors.push("Missing VITE_SUPABASE_URL");
  } else {
    try {
      const parsed = new URL(url);
      host = parsed.host;
      if (!url.startsWith("https://")) {
        errors.push("VITE_SUPABASE_URL must start with https://");
      }
      if (!parsed.host.endsWith(".supabase.co")) {
        errors.push("VITE_SUPABASE_URL host must end with .supabase.co");
      }
    } catch {
      errors.push("VITE_SUPABASE_URL is not a valid URL");
    }
  }

  if (!anonKey) {
    errors.push("Missing Supabase public key (VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY)");
  } else if (!isPublishableKey(anonKey) && !anonKey.startsWith("eyJ")) {
    warnings.push("Supabase public key format is unexpected. Expected an anon JWT-like key or sb_publishable_* key.");
  }

  const keyType: SupabaseConfigInfo["keyType"] = !anonKey
    ? "missing"
    : anonKey.startsWith("eyJ")
      ? "anon"
      : anonKey.startsWith("sb_publishable_")
        ? "publishable"
        : "unknown";

  const keySource = rawAnonKey
    ? (import.meta.env.VITE_SUPABASE_ANON_KEY ? "VITE_SUPABASE_ANON_KEY" : "NEXT_PUBLIC_SUPABASE_ANON_KEY")
    : rawPublishableKey
      ? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? "VITE_SUPABASE_PUBLISHABLE_KEY" : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
      : null;

  return {
    url,
    anonKey,
    host,
    keyLength: anonKey?.length ?? 0,
    maskedKey: anonKey ? maskKey(anonKey) : null,
    keyType,
    keySource,
    errors,
    warnings,
  };
};
