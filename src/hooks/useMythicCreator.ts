import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";
import type {
  MythicBootstrapRequest,
  MythicBootstrapResponse,
  MythicCreateCharacterRequest,
  MythicCreateCharacterResponse,
} from "@/types/mythic";

export function useMythicCreator() {
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const bootstrapCampaign = useCallback(async (campaignId: string) => {
    setIsBootstrapping(true);
    try {
      const { data, error } = await callEdgeFunction<MythicBootstrapResponse>("mythic-bootstrap", {
        requireAuth: true,
        body: { campaignId } satisfies MythicBootstrapRequest,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Bootstrap failed");
      return data;
    } finally {
      setIsBootstrapping(false);
    }
  }, []);

  const createCharacter = useCallback(async (req: MythicCreateCharacterRequest) => {
    if (!req.characterName.trim()) {
      toast.error("Enter a character name");
      return null;
    }
    if (!req.classDescription.trim()) {
      toast.error("Enter a class concept");
      return null;
    }

    setIsCreating(true);
    try {
      const { data, error } = await callEdgeFunction<MythicCreateCharacterResponse>("mythic-create-character", {
        requireAuth: true,
        body: req,
      });
      if (error) throw error;
      if (!data) throw new Error("Empty response");
      toast.success(`Forged: ${data.class.class_name}`);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create character";
      toast.error(msg);
      return null;
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
