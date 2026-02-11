import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";

export function useDbHealth(enabled = true, accessTokenOverride?: string | null) {
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
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
        let accessToken = accessTokenOverride ?? null;
        if (accessTokenOverride === undefined) {
          const { data } = await supabase.auth.getSession();
          accessToken = data.session?.access_token ?? null;
        }
        if (!supabaseUrl || !supabaseAnonKey) {
          throw new Error("Supabase env is not configured");
        }
        const controller = new AbortController();
        timeoutId = setTimeout(() => {
          didTimeout = true;
          controller.abort();
        }, 5000);
        const res = await fetch(`${supabaseUrl}/rest/v1/campaigns?select=id&limit=1`, {
          method: "GET",
          headers: {
            apikey: supabaseAnonKey,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`REST probe failed: ${res.status}`);
        }
        if (isMounted && requestIdRef.current === requestId && !didTimeout) {
          setStatus("ok");
        }
      } catch (error) {
        if (isMounted && requestIdRef.current === requestId) {
          setStatus("error");
          setLastError(formatError(error, "DB probe failed"));
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
  }, [accessTokenOverride, enabled]);

  return { status, lastError };
}
