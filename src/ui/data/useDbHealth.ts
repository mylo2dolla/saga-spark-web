import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import { recordHealthFailure, recordHealthSuccess } from "@/lib/observability/health";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("db-health");

export function useDbHealth(enabled = true) {
  const [status, setStatus] = useState<"ok" | "error" | "loading">("loading");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastProbe, setLastProbe] = useState<{
    status: number | null;
    timedOut: boolean;
    elapsedMs: number;
    at: number;
  } | null>(null);
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
      const startedAt = Date.now();
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
        const { error, status } = await Promise.race([probePromise, timeoutPromise]);
        if (error) throw error;
        if (isMounted && requestIdRef.current === requestId && !didTimeout) {
          setStatus("ok");
          setLastProbe({ status: status ?? null, timedOut: false, elapsedMs: Date.now() - startedAt, at: Date.now() });
          recordHealthSuccess("db", Date.now() - startedAt);
        }
      } catch (error) {
        if (isMounted && requestIdRef.current === requestId) {
          const baseError = formatError(error);
          // Fallback direct REST probe (bypass supabase-js) to confirm project connectivity.
          try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
            const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
            const { data } = await supabase.auth.getSession();
            const accessToken = data.session?.access_token ?? null;
            if (supabaseUrl && supabaseAnonKey) {
              const controller = new AbortController();
              const tid = setTimeout(() => controller.abort(), 4000);
              const res = await fetch(`${supabaseUrl}/rest/v1/campaigns?select=id&limit=1`, {
                method: "GET",
                headers: {
                  apikey: supabaseAnonKey,
                  ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                },
                signal: controller.signal,
              });
              clearTimeout(tid);
              if (res.ok) {
                setStatus("ok");
                setLastError(null);
                setLastProbe({ status: res.status, timedOut: false, elapsedMs: Date.now() - startedAt, at: Date.now() });
                recordHealthSuccess("db", Date.now() - startedAt);
                return;
              }
              setLastError(`DB probe failed (supabase-js): ${baseError}. REST status ${res.status}`);
            } else {
              setLastError(baseError);
            }
          } catch (fallbackErr) {
            setStatus("error");
            setLastError(`${baseError}. REST probe failed: ${formatError(fallbackErr)}`);
            setLastProbe({
              status: null,
              timedOut: didTimeout,
              elapsedMs: Date.now() - startedAt,
              at: Date.now(),
            });
            recordHealthFailure("db", fallbackErr, Date.now() - startedAt);
            logger.error("db.health.failure", fallbackErr, { didTimeout });
            return;
          }

          setStatus("error");
          setLastProbe({
            status: null,
            timedOut: didTimeout,
            elapsedMs: Date.now() - startedAt,
            at: Date.now(),
          });
          recordHealthFailure("db", error, Date.now() - startedAt);
          logger.error("db.health.failure", error, { didTimeout });
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

  return { status, lastError, lastProbe };
}
