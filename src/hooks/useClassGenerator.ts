import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createAbortController, isAbortError } from "@/ui/data/async";
import type { GeneratedClass } from "@/types/game";

const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-class`;

export function useClassGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedClass, setGeneratedClass] = useState<GeneratedClass | null>(null);
  const [error, setError] = useState<string | null>(null);

  const logFetchError = (context: string, payload: Record<string, unknown>) => {
    console.error(context, payload);
  };

  const generateClass = useCallback(async (description: string): Promise<GeneratedClass | null> => {
    if (!description.trim()) {
      toast.error("Please enter a class description");
      return null;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const startedAt = Date.now();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        console.error("[auth] supabase error", {
          message: sessionError.message,
          code: sessionError.code,
          details: sessionError.details,
          hint: sessionError.hint,
          status: sessionError.status,
        });
      }
      const accessToken = session?.access_token ?? null;

      console.info("[generateClass] start", {
        url: GENERATE_URL,
        userId: session?.user?.id ?? null,
        timestamp: new Date().toISOString(),
      });

      const { controller, cleanup } = createAbortController(25000);
      const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const bearerToken = accessToken ?? apiKey ?? null;
      const response = await fetch(GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
        body: JSON.stringify({ classDescription: description }),
        signal: controller.signal,
      }).finally(cleanup);

      if (!response.ok) {
        const bodyText = await response.text();
        logFetchError("[generateClass] fetch error", {
          url: GENERATE_URL,
          status: response.status,
          statusText: response.statusText,
          bodyText,
        });
        let message = `Request failed: ${response.status}`;
        try {
          const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
          message = parsed.error || parsed.message || message;
        } catch {
          // ignore JSON parse failure
        }
        throw new Error(message);
      }

      const data: GeneratedClass = await response.json();
      setGeneratedClass(data);
      toast.success(`Generated: ${data.className}`);
      console.info("[generateClass] success", {
        url: GENERATE_URL,
        durationMs: Date.now() - startedAt,
      });
      return data;
    } catch (err) {
      if (isAbortError(err)) {
        return null;
      }
      const message = err instanceof Error ? err.message : "Failed to generate class";
      setError(message);
      toast.error(`Failed to generate class — ${message}`);
      logFetchError("[generateClass] failure", {
        url: GENERATE_URL,
        message,
      });
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const clearClass = useCallback(() => {
    setGeneratedClass(null);
    setError(null);
  }, []);

  return {
    isGenerating,
    generatedClass,
    error,
    generateClass,
    clearClass,
  };
}
