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
    const characterName = req.characterName.trim();
    const classDescription = req.classDescription.trim();

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

    setIsCreating(true);
    try {
      const { data, error } = await callEdgeFunction<MythicCreateCharacterResponse>("mythic-create-character", {
        requireAuth: true,
        body: {
          ...req,
          characterName,
          classDescription,
        },
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
