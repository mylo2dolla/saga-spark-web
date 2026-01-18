import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const DEV_DEBUG = import.meta.env.DEV;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const GENERATE_URL = `${SUPABASE_URL}/functions/v1/generate-class`;

export default function ApiDebugPanel() {
  const [lastStatus, setLastStatus] = useState<number | null>(null);
  const [lastBody, setLastBody] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isMounted) return;
      setHasSession(Boolean(session));
      setHasAccessToken(Boolean(session?.access_token));
    };
    loadSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleTest = useCallback(async () => {
    if (!DEV_DEBUG) return;
    setIsTesting(true);
    setLastStatus(null);
    setLastBody(null);

    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token ?? null;
    setHasSession(Boolean(session));
    setHasAccessToken(Boolean(accessToken));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: ANON_KEY ?? "",
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    console.info("[generateClass] request", {
      url: GENERATE_URL,
      hasApiKey: Boolean(ANON_KEY),
      hasAuthorization: Boolean(accessToken),
    });

    try {
      const response = await fetch(GENERATE_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ classDescription: "Arcane duelist" }),
      });
      const bodyText = await response.text();
      setLastStatus(response.status);
      setLastBody(bodyText);
    } catch (error) {
      setLastStatus(null);
      setLastBody(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsTesting(false);
    }
  }, []);

  if (!DEV_DEBUG) return null;

  return (
    <div className="fixed bottom-2 left-2 z-[9999] max-w-sm rounded-md border border-border bg-card/95 p-2 text-[11px] text-muted-foreground">
      <div>Supabase URL: {SUPABASE_URL ?? "missing"}</div>
      <div>Anon key present: {ANON_KEY ? "yes" : "no"}</div>
      <div>Session exists: {hasSession ? "yes" : "no"}</div>
      <div>Access token exists: {hasAccessToken ? "yes" : "no"}</div>
      <div>Last status: {lastStatus ?? "-"}</div>
      <div className="max-h-24 overflow-auto whitespace-pre-wrap">Last body: {lastBody ?? "-"}</div>
      <button
        type="button"
        className="mt-2 text-primary underline"
        onClick={handleTest}
        disabled={isTesting}
      >
        {isTesting ? "Testing..." : "Test generate-class"}
      </button>
    </div>
  );
}
