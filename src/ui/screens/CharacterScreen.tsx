import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AICharacterCreator } from "@/components/AICharacterCreator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { CharacterStats, CharacterResources, PassiveAbility, GameAbility } from "@/types/game";
import { withTimeout, isAbortError, formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/diagnostics";

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

export default function CharacterScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { setLastError } = useDiagnostics();
  const [isCreating, setIsCreating] = useState(false);

  if (!campaignId) {
    return <div className="text-sm text-muted-foreground">Campaign not found.</div>;
  }

  const getModifier = (stat: number) => Math.floor((stat - 10) / 2);

  const handleComplete = async (data: AICharacterData) => {
    setIsCreating(true);
    setLastError(null);

    try {
      const userResult = await withTimeout(supabase.auth.getUser(), 20000);
      if (userResult.error) {
        console.error("[auth] supabase error", {
          message: userResult.error.message,
          code: userResult.error.code,
          details: userResult.error.details,
          hint: userResult.error.hint,
          status: userResult.error.status,
        });
        throw userResult.error;
      }

      const user = userResult.data.user;
      if (!user) throw new Error("Not authenticated");

      const hitDie = parseInt(data.hitDice.replace("d", ""));
      const conMod = getModifier(data.stats.constitution);
      const dexMod = getModifier(data.stats.dexterity);
      const hp = hitDie + conMod;
      const ac = data.baseAC + dexMod;

      const result = await withTimeout(
        supabase.from("characters").insert([{ 
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
        }]),
        25000,
      );

      if (result.error) {
        console.error("[createCharacter] supabase error", {
          message: result.error.message,
          code: result.error.code,
          details: result.error.details,
          hint: result.error.hint,
          status: result.error.status,
        });
        throw result.error;
      }

      toast({
        title: "Character created",
        description: `${data.name} the ${data.class} is ready for adventure!`,
      });
      navigate(`/game/${campaignId}`);
    } catch (error) {
      if (isAbortError(error)) {
        toast({
          title: "Request canceled/timeout",
          description: "Please retry.",
          variant: "destructive",
        });
        setLastError("Request canceled/timeout");
        return;
      }

      const message = formatError(error, "Failed to create character");
      setLastError(message);
      toast({
        title: "Failed to create character",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  if (isCreating) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <div className="text-sm text-muted-foreground">Creating your hero...</div>
      </div>
    );
  }

  return (
    <AICharacterCreator
      campaignId={campaignId}
      onComplete={handleComplete}
      onCancel={() => navigate("/dashboard")}
    />
  );
}
