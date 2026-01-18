import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AICharacterCreator } from "@/components/AICharacterCreator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { CharacterStats, CharacterResources, PassiveAbility, GameAbility } from "@/types/game";
import { withTimeout, isAbortError, formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/diagnostics";
import { useAuth } from "@/hooks/useAuth";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import { useCharacter } from "@/hooks/useCharacter";

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
  const location = useLocation();
  const { toast } = useToast();
  const { setLastError } = useDiagnostics();
  const { user, isLoading: authLoading } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<"unknown" | "loaded" | "missing" | "created" | "error">("unknown");
  const gameSession = useGameSessionContext();
  const { character, isLoading: characterLoading, error: characterError } = useCharacter(campaignId);

  console.info("[character]", {
    step: "enter_screen",
    route: location.pathname,
    campaignId,
    hasSession: Boolean(user),
    userId: user?.id ?? null,
  });

  if (!campaignId) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <div>Campaign not found.</div>
        <button
          type="button"
          className="text-primary underline"
          onClick={() => navigate("/dashboard")}
        >
          Go to dashboard
        </button>
      </div>
    );
  }

  if (authLoading) {
    console.info("[auth] log", {
      step: "auth_guard",
      path: `/game/${campaignId}/create-character`,
      hasSession: Boolean(user),
      userId: user?.id ?? null,
      isLoading: authLoading,
      reason: "auth_loading",
    });
    return <div className="text-sm text-muted-foreground">Loading session...</div>;
  }

  if (!user) {
    console.info("[auth] log", {
      step: "auth_guard",
      path: `/game/${campaignId}/create-character`,
      hasSession: false,
      userId: null,
      isLoading: authLoading,
      reason: "no_user",
    });
    console.info("[character]", {
      step: "navigate_login",
      reason: "no_user",
      campaignId,
      route: location.pathname,
    });
    navigate("/login");
    return null;
  }

  console.info("[character]", {
    step: "session_resolved",
    campaignId,
    userId: user.id,
    hasSession: true,
  });

  if (characterLoading) {
    console.info("[character]", {
      step: "character_fetch_pending",
      campaignId,
      userId: user.id,
    });
  } else {
    console.info("[character]", {
      step: "character_fetch_result",
      campaignId,
      userId: user.id,
      characterExists: Boolean(character),
      error: characterError ?? null,
    });
  }

  const getModifier = (stat: number) => Math.floor((stat - 10) / 2);

  const handleComplete = async (data: AICharacterData) => {
    setIsCreating(true);
    setLastError(null);
    setLastAction("create_character_submit");
    console.info("[character]", {
      step: "create_character_start",
      campaignId,
      userId: user.id,
      payload: {
        name: data.name,
        class: data.class,
        hitDice: data.hitDice,
        baseAC: data.baseAC,
      },
    });

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
        console.info("[character]", {
          step: "create_character_error",
          campaignId,
          userId: user.id,
          status: result.error.status ?? null,
          code: result.error.code ?? null,
          message: result.error.message ?? null,
          details: result.error.details ?? null,
          hint: result.error.hint ?? null,
        });
        throw result.error;
      }

      console.info("[character]", {
        step: "create_character_success",
        campaignId,
        userId: user.id,
      });
      toast({
        title: "Character created",
        description: `${data.name} the ${data.class} is ready for adventure!`,
      });
      console.info("[character]", {
        step: "navigate_game",
        campaignId,
        reason: "character_created",
      });
      navigate(`/game/${campaignId}`);
    } catch (error) {
      if (isAbortError(error)) {
        console.info("[character]", {
          step: "create_character_aborted",
          campaignId,
          userId: user.id,
        });
        toast({
          title: "Request canceled/timeout",
          description: "Please retry.",
          variant: "destructive",
        });
        setLastError("Request canceled/timeout");
        return;
      }

      const message = formatError(error, "Failed to create character");
      console.info("[character]", {
        step: "create_character_failed",
        campaignId,
        userId: user.id,
        message,
      });
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
    <>
      <AICharacterCreator
        campaignId={campaignId}
        onComplete={handleComplete}
        onCancel={() => {
          setLastAction("create_character_cancel");
          navigate("/dashboard");
        }}
      />
      {import.meta.env.DEV ? (
        <div className="fixed bottom-2 right-2 z-[9999] max-w-xs rounded-md border border-border bg-card/95 p-2 text-[11px] text-muted-foreground">
          <div>route: {location.pathname}</div>
          <div>campaignId: {campaignId}</div>
          <div>userId: {user?.id ?? "-"}</div>
          <div>hasSession: {user ? "yes" : "no"}</div>
          <div>authLoading: {String(authLoading)}</div>
          <div>characterLoading: {String(characterLoading)}</div>
          <div>characterExists: {character ? "yes" : "no"}</div>
          <div>characterError: {characterError ?? "none"}</div>
          <div>engineReady: {gameSession.isInitialized ? "yes" : "no"}</div>
          <div>lastError: {gameSession.error ?? "none"}</div>
          <div>lastAction: {lastAction ?? "none"}</div>
          <button
            type="button"
            className="mt-2 text-primary underline"
            onClick={() => {
              console.info("[character]", {
                step: "dump_state",
                route: location.pathname,
                params: { campaignId },
                userId: user?.id ?? null,
                hasSession: Boolean(user),
                campaignId,
                profileStatus,
                characterStatus: {
                  loading: characterLoading,
                  exists: Boolean(character),
                  error: characterError ?? null,
                },
                engineReady: gameSession.isInitialized,
                lastError: gameSession.error ?? null,
                lastAction,
              });
            }}
          >
            Dump State
          </button>
        </div>
      ) : null}
    </>
  );
}
