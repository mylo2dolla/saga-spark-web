import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { CharacterCreator } from "@/components/CharacterCreator";
import { useCharacter, CreateCharacterData } from "@/hooks/useCharacter";
import { useToast } from "@/hooks/use-toast";

const CreateCharacter = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { createCharacter } = useCharacter(campaignId);
  const [isCreating, setIsCreating] = useState(false);

  if (!campaignId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Campaign not found</p>
      </div>
    );
  }

  const handleComplete = async (data: CreateCharacterData) => {
    setIsCreating(true);
    try {
      await createCharacter(data);
      toast({
        title: "Character created!",
        description: `${data.name} the ${data.class} is ready for adventure!`,
      });
      navigate(`/game/${campaignId}`);
    } catch (error: any) {
      toast({
        title: "Failed to create character",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    navigate(`/dashboard`);
  };

  if (isCreating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center flex-col gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Creating your hero...</p>
      </div>
    );
  }

  return (
    <CharacterCreator
      campaignId={campaignId}
      onComplete={handleComplete}
      onCancel={handleCancel}
    />
  );
};

export default CreateCharacter;
