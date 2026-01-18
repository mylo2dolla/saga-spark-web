import { useEffect, useState } from "react";
import { getSupabaseConfigInfo } from "@/ui/data/supabaseConfig";

interface StatusState {
  status: "idle" | "ok" | "error";
  message: string;
}

const DEV_DEBUG = import.meta.env.DEV;

export default function SupabaseStatusIndicator() {
  const [state, setState] = useState<StatusState>({ status: "idle", message: "pending" });
  const config = getSupabaseConfigInfo();

  useEffect(() => {
    if (!DEV_DEBUG) return;
    if (config.errors.length > 0 || !config.url || !config.anonKey) {
      setState({ status: "error", message: "missing config" });
      return;
    }
    let isMounted = true;
    const run = async () => {
      try {
        const response = await fetch(`${config.url}/auth/v1/health`, {
          headers: { apikey: config.anonKey },
        });
        if (!isMounted) return;
        setState({
          status: response.ok ? "ok" : "error",
          message: `health ${response.status}`,
        });
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : "fetch failed";
        setState({ status: "error", message });
      }
    };
    run();
    return () => {
      isMounted = false;
    };
  }, [config.anonKey, config.errors.length, config.url]);

  if (!DEV_DEBUG) return null;

  return (
    <div className="mt-3 text-[11px] text-muted-foreground">
      <div>Supabase status: {state.status} ({state.message})</div>
      <div>Host: {config.host ?? "-"}</div>
      <div>Anon key: {config.maskedKey ?? "-"}</div>
    </div>
  );
}
