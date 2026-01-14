import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { GeneratedClass } from "@/types/game";

const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-class`;

export function useClassGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedClass, setGeneratedClass] = useState<GeneratedClass | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateClass = useCallback(async (description: string): Promise<GeneratedClass | null> => {
    if (!description.trim()) {
      toast.error("Please enter a class description");
      return null;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("You must be logged in to generate a class");
      }

      const response = await fetch(GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ classDescription: description }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      const data: GeneratedClass = await response.json();
      setGeneratedClass(data);
      toast.success(`Generated: ${data.className}`);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate class";
      setError(message);
      toast.error(message);
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
