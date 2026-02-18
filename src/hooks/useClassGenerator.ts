import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/lib/edge";
import { toast } from "sonner";
import type { GeneratedClass } from "@/types/game";
import { recordEdgeCall, recordEdgeResponse } from "@/ui/data/networkHealth";
import { getSupabaseErrorInfo } from "@/lib/supabaseError";

export function useClassGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedClass, setGeneratedClass] = useState<GeneratedClass | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edgeFunctionName = "generate-class";
  const edgeFunctionUrl = import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${edgeFunctionName}`
    : null;

  const logFetchError = useCallback((context: string, payload: Record<string, unknown>) => {
    console.error(context, payload);
  }, []);

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
        const errorInfo = getSupabaseErrorInfo(sessionError, "Failed to fetch auth session");
        console.error("[auth] supabase error", {
          message: errorInfo.message,
          code: errorInfo.code,
          details: errorInfo.details,
          hint: errorInfo.hint,
          status: errorInfo.status,
        });
      }
      console.info("[generateClass] start", {
        userId: session?.user?.id ?? null,
        timestamp: new Date().toISOString(),
      });
      recordEdgeCall();
      const { data, error: edgeError, status } = await callEdgeFunction<GeneratedClass>(
        edgeFunctionName,
        { body: { classDescription: description }, requireAuth: false }
      );

      if (edgeError) {
        logFetchError("[generateClass] fetch error", {
          status,
          message: edgeError.message,
        });
        throw edgeError;
      }

      if (!data) {
        throw new Error("Empty response");
      }
      recordEdgeResponse();
      setGeneratedClass(data);
      toast.success(`Generated: ${data.className}`);
      console.info("[generateClass] success", {
        durationMs: Date.now() - startedAt,
      });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate class";
      setError(message);
      setGeneratedClass(null);
      toast.error(`Failed to generate class — ${message}`);
      logFetchError("[generateClass] failure", {
        url: edgeFunctionUrl ?? "unresolved",
        edgeFunctionName,
        message,
      });
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [edgeFunctionName, edgeFunctionUrl, logFetchError]);

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
