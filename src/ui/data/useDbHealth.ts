import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";

export function useDbHealth(enabled = true) {
  const [status, setStatus] = useState<"ok" | "error" | "loading">("loading");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("loading");
      setLastError(null);
      return;
    }
    let isMounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      setStatus("loading");
      setLastError(null);
      try {
        const { error } = await supabase.from("campaigns").select("id").limit(1);
        if (error) throw error;
        if (isMounted) setStatus("ok");
      } catch (error) {
        if (isMounted) {
          setStatus("error");
          setLastError(formatError(error));
        }
      }
    };

    check();
    interval = setInterval(check, 120000);

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, [enabled]);

  return { status, lastError };
}
