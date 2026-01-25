import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";

export function useDbHealth(enabled = true) {
  const [status, setStatus] = useState<"ok" | "error" | "loading">("loading");
  const [lastError, setLastError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("loading");
      setLastError(null);
      return;
    }
    let isMounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setStatus("loading");
      setLastError(null);
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let didTimeout = false;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            didTimeout = true;
            reject(new Error("DB probe timed out"));
          }, 5000);
        });
        const probePromise = supabase
          .from("campaigns")
          .select("id", { head: true, count: "exact" })
          .limit(1);
        const { error } = await Promise.race([probePromise, timeoutPromise]);
        if (error) throw error;
        if (isMounted && requestIdRef.current === requestId && !didTimeout) {
          setStatus("ok");
        }
      } catch (error) {
        if (isMounted && requestIdRef.current === requestId) {
          setStatus("error");
          setLastError(formatError(error));
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
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
