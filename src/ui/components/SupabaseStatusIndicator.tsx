import { getSupabaseConfigInfo } from "@/ui/data/supabaseConfig";
import { useDbHealth } from "@/ui/data/useDbHealth";

const DEV_DEBUG = import.meta.env.DEV;

export default function SupabaseStatusIndicator() {
  const config = getSupabaseConfigInfo();
  const { status, lastError } = useDbHealth(DEV_DEBUG && config.errors.length === 0);

  if (!DEV_DEBUG) return null;

  return (
    <div className="mt-3 text-[11px] text-muted-foreground">
      <div>Supabase DB probe: {status}{lastError ? ` (${lastError})` : ""}</div>
      <div>Host: {config.host ?? "-"}</div>
      <div>Anon key: {config.maskedKey ?? "-"}</div>
    </div>
  );
}
