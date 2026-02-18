import { useCallback, useState } from "react";
import { callEdgeFunction } from "@/lib/edge";
import type {
  MythicBootstrapRequest,
  MythicBootstrapResponse,
  MythicCreateCharacterRequest,
  MythicCreateCharacterResponse,
} from "@/types/mythic";

interface CallOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
}

const BOOTSTRAP_TIMEOUT_MS = 30_000;
const CREATE_CHARACTER_TIMEOUT_MS = 60_000;

export function useMythicCreator() {
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const bootstrapCampaign = useCallback(async (campaignId: string, options?: CallOptions) => {
    setIsBootstrapping(true);
    try {
      const { data, error } = await callEdgeFunction<MythicBootstrapResponse>("mythic-bootstrap", {
        requireAuth: true,
        signal: options?.signal,
        timeoutMs: BOOTSTRAP_TIMEOUT_MS,
        maxRetries: 0,
        idempotencyKey: options?.idempotencyKey ?? `bootstrap:${campaignId}`,
        body: { campaignId } satisfies MythicBootstrapRequest,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Bootstrap failed");
      return data;
    } finally {
      setIsBootstrapping(false);
    }
  }, []);

  const createCharacter = useCallback(async (req: MythicCreateCharacterRequest, options?: CallOptions) => {
    const characterName = req.characterName.trim();
    const classDescription = req.classDescription.trim();

    if (!characterName) {
      throw new Error("Enter a character name");
    }
    if (!classDescription) {
      throw new Error("Enter a class concept");
    }
    if (characterName.length > 60) {
      throw new Error("Character name must be 60 characters or fewer.");
    }
    if (classDescription.length > 2000) {
      throw new Error("Class concept must be 2000 characters or fewer.");
    }

    setIsCreating(true);
    try {
      const { data, error } = await callEdgeFunction<MythicCreateCharacterResponse>("mythic-create-character", {
        requireAuth: true,
        signal: options?.signal,
        timeoutMs: CREATE_CHARACTER_TIMEOUT_MS,
        maxRetries: 0,
        idempotencyKey: options?.idempotencyKey,
        body: {
          ...req,
          characterName,
          classDescription,
        },
      });
      if (error) throw error;
      if (!data) throw new Error("Empty response");
      return data;
    } finally {
      setIsCreating(false);
    }
  }, []);

  return {
    isBootstrapping,
    isCreating,
    bootstrapCampaign,
    createCharacter,
  };
}
