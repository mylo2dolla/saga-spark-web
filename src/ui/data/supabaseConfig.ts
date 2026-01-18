export interface SupabaseConfigInfo {
  url: string | null;
  anonKey: string | null;
  host: string | null;
  keyLength: number;
  maskedKey: string | null;
  errors: string[];
}

const maskKey = (key: string) => {
  if (key.length <= 12) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
};

export const getSupabaseConfigInfo = (): SupabaseConfigInfo => {
  const url = (import.meta.env.VITE_SUPABASE_URL || "").trim() || null;
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim() || null;
  const errors: string[] = [];
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
    errors.push("Missing VITE_SUPABASE_ANON_KEY");
  }

  return {
    url,
    anonKey,
    host,
    keyLength: anonKey?.length ?? 0,
    maskedKey: anonKey ? maskKey(anonKey) : null,
    errors,
  };
};
