import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AICharacterCreator } from "@/components/AICharacterCreator";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { CharacterStats, CharacterResources, PassiveAbility, GameAbility } from "@/types/game";

interface AICharacterData {
  name: string;
  class: string;
  classDescription: string;
  stats: CharacterStats;
  resources: CharacterResources;
  passives: PassiveAbility[];
  abilities: Omit<GameAbility, "id">[];
  campaign_id: string;
  hitDice: string;
  baseAC: number;
}

const CreateCharacter = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);

  if (!campaignId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Campaign not found</p>
      </div>
    );
  }

  const getModifier = (stat: number) => Math.floor((stat - 10) / 2);
  const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Unknown error";

  const handleComplete = async (data: AICharacterData) => {
    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const hitDie = parseInt(data.hitDice.replace("d", ""));
      const conMod = getModifier(data.stats.constitution);
      const dexMod = getModifier(data.stats.dexterity);
      const hp = hitDie + conMod;
      const ac = data.baseAC + dexMod;

      const { error } = await supabase.from("characters").insert([{
        name: data.name,
        class: data.class,
        class_description: data.classDescription,
        campaign_id: campaignId,
        user_id: user.id,
        level: 1,
        hp,
        max_hp: hp,
        ac,
        stats: JSON.parse(JSON.stringify(data.stats)),
        resources: JSON.parse(JSON.stringify(data.resources)),
        passives: JSON.parse(JSON.stringify(data.passives)),
        abilities: JSON.parse(JSON.stringify(data.abilities.map((a, i) => ({ ...a, id: `ability-${i}` })))),
        xp: 0,
        xp_to_next: 300,
        position: JSON.parse(JSON.stringify({ x: 2, y: 2 })),
        status_effects: JSON.parse(JSON.stringify([])),
        is_active: true,
        equipment: JSON.parse(JSON.stringify({ weapon: null, armor: null, shield: null, helmet: null, boots: null, gloves: null, ring1: null, ring2: null, trinket1: null, trinket2: null, trinket3: null })),
        backpack: JSON.parse(JSON.stringify([])),
      }]);

      if (error) throw error;

      toast({
        title: "Character created!",
        description: `${data.name} the ${data.class} is ready for adventure!`,
      });
      navigate(`/game/${campaignId}`);
    } catch (error: unknown) {
      toast({
        title: "Failed to create character",
        description: getErrorMessage(error),
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
    <AICharacterCreator
      campaignId={campaignId}
      onComplete={handleComplete}
      onCancel={handleCancel}
    />
  );
};

export default CreateCharacter;
