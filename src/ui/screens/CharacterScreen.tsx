import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AICharacterCreator } from "@/components/AICharacterCreator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { CharacterStats, CharacterResources, PassiveAbility, GameAbility } from "@/types/game";
import { formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/diagnostics";
import { useAuth } from "@/hooks/useAuth";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import { useCharacter, type CharacterPayload } from "@/hooks/useCharacter";

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
  const [showCreator, setShowCreator] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<"unknown" | "loaded" | "missing" | "created" | "error">("unknown");
  const [sessionFallback, setSessionFallback] = useState<{
    checking: boolean;
    hasSession: boolean | null;
    error: string | null;
  }>({ checking: false, hasSession: null, error: null });
  const gameSession = useGameSessionContext();
  const { character, isLoading: characterLoading, error: characterError, refetch, saveCharacter } = useCharacter(campaignId);

  const shouldShowCreator = useMemo(() => showCreator || !character, [showCreator, character]);

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

  useEffect(() => {
    if (authLoading || user) return;
    let isMounted = true;
    const run = async () => {
      setSessionFallback({ checking: true, hasSession: null, error: null });
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          setSessionFallback({ checking: false, hasSession: false, error: error.message ?? "Session error" });
        } else {
          setSessionFallback({ checking: false, hasSession: Boolean(session), error: null });
        }
      } catch (error) {
        if (!isMounted) return;
        setSessionFallback({ checking: false, hasSession: false, error: formatError(error, "Session check failed") });
      }
    };
    run();
    return () => {
      isMounted = false;
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (character) {
      setShowCreator(false);
    }
  }, [character]);

  if (authLoading || sessionFallback.checking) {
    console.info("[auth] log", {
      step: "auth_guard",
      path: `/game/${campaignId}/create-character`,
      hasSession: Boolean(user),
      userId: user?.id ?? null,
      isLoading: authLoading,
      reason: sessionFallback.checking ? "session_check" : "auth_loading",
    });
    return <div className="text-sm text-muted-foreground">Loading session...</div>;
  }

  if (!user) {
    if (sessionFallback.hasSession) {
      return (
        <div className="space-y-2 text-sm text-muted-foreground">
          <div>Session exists but user not resolved.</div>
          <button
            type="button"
            className="text-primary underline"
            onClick={() => window.location.reload()}
          >
            Reload session
          </button>
        </div>
      );
    }

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
    if (!character) {
      return <div className="text-sm text-muted-foreground">Loading character...</div>;
    }
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
      const userResult = await supabase.auth.getUser();
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

      const payload: CharacterPayload = {
        name: data.name,
        class: data.class,
        class_description: data.classDescription,
        campaign_id: campaignId,
        user_id: user.id,
        level: 1,
        hp,
        max_hp: hp,
        ac,
        stats: data.stats,
        resources: data.resources as unknown as Record<string, unknown>,
        passives: data.passives as unknown as Record<string, unknown>[],
        abilities: data.abilities.map((a, i) => ({ ...a, id: `ability-${i}` })) as unknown as Record<string, unknown>[],
        xp: 0,
        xp_to_next: 300,
        position: { x: 2, y: 2 },
        status_effects: [],
        is_active: true,
        equipment: { weapon: null, armor: null, shield: null, helmet: null, boots: null, gloves: null, ring1: null, ring2: null, trinket1: null, trinket2: null, trinket3: null },
        backpack: [],
      };

      const saved = await saveCharacter(payload, character?.id);

      console.info("[character]", {
        step: character ? "update_character_success" : "create_character_success",
        campaignId,
        userId: user.id,
        characterId: saved?.id ?? null,
      });
      toast({
        title: character ? "Character updated" : "Character created",
        description: `${data.name} the ${data.class} is ready for adventure!`,
      });
      console.info("[character]", {
        step: "navigate_game",
        campaignId,
        reason: "character_created",
      });
      navigate(`/game/${campaignId}`);
    } catch (error) {

      const supaError = error as { message?: string; code?: string; details?: string; hint?: string; status?: number };
      if (supaError?.message) {
        console.error("[createCharacter] supabase error", {
          message: supaError.message,
          code: supaError.code,
          details: supaError.details,
          hint: supaError.hint,
          status: supaError.status,
        });
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

  if (characterError) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="text-destructive">{characterError}</div>
        <button
          type="button"
          className="text-primary underline"
          onClick={() => refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!shouldShowCreator && character) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card/50 p-4">
          <div className="text-lg font-semibold">{character.name}</div>
          <div className="text-sm text-muted-foreground">{character.class}</div>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <div>Level: {character.level}</div>
            <div>HP: {character.hp}/{character.max_hp}</div>
            <div>AC: {character.ac}</div>
            <div>XP: {character.xp}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            onClick={() => navigate(`/game/${campaignId}`)}
          >
            Continue to Game
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            onClick={() => setShowCreator(true)}
          >
            Regenerate Class
          </button>
        </div>
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
