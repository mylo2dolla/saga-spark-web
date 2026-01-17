import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout, isAbortError, formatError } from "@/ui/data/async";

export function useDbHealth() {
  const [status, setStatus] = useState<"ok" | "error" | "loading">("loading");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      setStatus("loading");
      setLastError(null);
      try {
        await withTimeout(
          supabase.from("campaigns").select("id").limit(1),
          20000,
        );
        if (isMounted) setStatus("ok");
      } catch (error) {
        if (isAbortError(error)) {
          if (isMounted) {
            setStatus("error");
            setLastError("Request canceled/timeout");
          }
          return;
        }
        if (isMounted) {
          setStatus("error");
          setLastError(formatError(error));
        }
      }
    };

    check();
    interval = setInterval(check, 60000);

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  return { status, lastError };
}
