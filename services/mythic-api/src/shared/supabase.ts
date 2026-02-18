import { createClient } from "@supabase/supabase-js";
import { getConfig } from "./env.js";

export function createServiceClient() {
  const config = getConfig();
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

