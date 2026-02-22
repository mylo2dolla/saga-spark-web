import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";
import { toFriendlyEdgeError } from "@/lib/edgeError";
import type {
  MythicBootstrapRequest,
  MythicBootstrapResponse,
  MythicCreateCharacterRequest,
  MythicCreateCharacterResponse,
} from "@/types/mythic";

type CreatorError = {
  message: string;
  code: string | null;
};

interface CreatorOptions {
  signal?: AbortSignal;
}

export function useMythicCreator() {
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [lastError, setLastError] = useState<CreatorError | null>(null);
  const clearError = useCallback(() => setLastError(null), []);

  const bootstrapCampaign = useCallback(async (campaignId: string, options: CreatorOptions = {}) => {
    setIsBootstrapping(true);
    setLastError(null);
    try {
      const { data, error } = await callEdgeFunction<MythicBootstrapResponse>("mythic-bootstrap", {
        requireAuth: true,
        signal: options.signal,
        timeoutMs: 25_000,
        maxRetries: 0,
        body: { campaignId } satisfies MythicBootstrapRequest,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Bootstrap failed");
      return data;
    } catch (error) {
      if (options.signal?.aborted) {
        setLastError({ message: "Character forge cancelled.", code: "cancelled" });
        return null;
      }
      const parsed = toFriendlyEdgeError(error, "Failed to prepare campaign runtime");
      setLastError({ message: parsed.description, code: parsed.code });
      toast.error(parsed.description);
      return null;
    } finally {
      setIsBootstrapping(false);
    }
  }, []);

  const createCharacter = useCallback(async (req: MythicCreateCharacterRequest, options: CreatorOptions = {}) => {
    const characterName = req.characterName.trim();
    const classDescription = req.classDescription.trim();
    const originRegionId = req.originRegionId?.trim() || undefined;
    const factionAlignmentId = req.factionAlignmentId?.trim() || undefined;
    const background = req.background?.trim() || undefined;
    const personalityTraits = Array.isArray(req.personalityTraits)
      ? Array.from(
          new Set(
            req.personalityTraits
              .map((entry) => String(entry ?? "").trim())
              .filter((entry) => entry.length > 0)
              .slice(0, 6),
          ),
        )
      : undefined;
    const moralLeaning = typeof req.moralLeaning === "number"
      ? Math.max(-1, Math.min(1, Number(req.moralLeaning.toFixed(2))))
      : undefined;

    if (!characterName) {
      toast.error("Enter a character name");
      return null;
    }
    if (!classDescription) {
      toast.error("Enter a class concept");
      return null;
    }
    if (characterName.length > 60) {
      toast.error("Character name must be 60 characters or fewer.");
      return null;
    }
    if (classDescription.length > 2000) {
      toast.error("Class concept must be 2000 characters or fewer.");
      return null;
    }
    if (background && background.length > 160) {
      toast.error("Background must be 160 characters or fewer.");
      return null;
    }

    setIsCreating(true);
    setLastError(null);
    try {
      const forgeFingerprint = [
        originRegionId ?? "",
        factionAlignmentId ?? "",
        background ?? "",
        personalityTraits?.join("|") ?? "",
        moralLeaning == null ? "" : moralLeaning.toFixed(2),
      ].join(":");
      const { data, error } = await callEdgeFunction<MythicCreateCharacterResponse>("mythic-create-character", {
        requireAuth: true,
        signal: options.signal,
        // SLA target is sub-30s with deterministic fallback, keep client timeout tight.
        timeoutMs: 40_000,
        maxRetries: 0,
        idempotencyKey: `${req.campaignId}:${characterName}:${classDescription}:${forgeFingerprint}`,
        body: {
          ...req,
          characterName,
          classDescription,
          originRegionId,
          factionAlignmentId,
          background,
          personalityTraits,
          moralLeaning,
        },
      });
      if (error) throw error;
      if (!data) throw new Error("Empty response");
      toast.success(`Forged: ${data.class.class_name}`);
      return data;
    } catch (e) {
      if (options.signal?.aborted) {
        setLastError({ message: "Character forge cancelled.", code: "cancelled" });
        return null;
      }
      const parsed = toFriendlyEdgeError(e, "Failed to create character");
      setLastError({ message: parsed.description, code: parsed.code });
      toast.error(parsed.description);
      return null;
    } finally {
      setIsCreating(false);
    }
  }, []);

  return {
    isBootstrapping,
    isCreating,
    lastError,
    bootstrapCampaign,
    createCharacter,
    clearError,
  };
}
