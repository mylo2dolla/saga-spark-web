import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/useDiagnostics";
import { useAuth } from "@/hooks/useAuth";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import { MythicCharacterCreator } from "@/components/MythicCharacterCreator";
import { useMythicCharacter } from "@/hooks/useMythicCharacter";
import type { MythicCreateCharacterResponse } from "@/types/mythic";

export default function CharacterScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { setLastError } = useDiagnostics();
  const { user, isLoading: authLoading } = useAuth();
  const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === "true";

  const [showCreator, setShowCreator] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [sessionFallback, setSessionFallback] = useState<{
    checking: boolean;
    hasSession: boolean | null;
    error: string | null;
  }>({ checking: false, hasSession: null, error: null });

  const gameSession = useGameSessionContext();
  const { character, isLoading: characterLoading, error: characterError, refetch } = useMythicCharacter(campaignId);

  const shouldShowCreator = useMemo(() => showCreator || !character, [showCreator, character]);

  console.info("[mythic.character]", {
    step: "enter_screen",
    route: location.pathname,
    campaignId,
    hasSession: Boolean(user),
    userId: user?.id ?? null,
  });

  useEffect(() => {
    if (E2E_BYPASS_AUTH) return;
    if (authLoading || user) return;
    let isMounted = true;

    const run = async () => {
      if (isMounted) {
        setSessionFallback({ checking: true, hasSession: null, error: null });
      }
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!isMounted) return;
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
  }, [E2E_BYPASS_AUTH, authLoading, user]);

  useEffect(() => {
    if (E2E_BYPASS_AUTH) return;
    if (!campaignId) return;
    if (authLoading || sessionFallback.checking) return;
    if (!user && !sessionFallback.hasSession) {
      navigate("/login");
    }
  }, [E2E_BYPASS_AUTH, authLoading, campaignId, navigate, sessionFallback.checking, sessionFallback.hasSession, user]);

  const handleCompleteMythic = async (res: MythicCreateCharacterResponse) => {
    setLastAction("create_mythic_character_success");
    setShowCreator(false);
    setLastError(null);

    toast({
      title: "Mythic character created",
      description: `${res.class.class_name} kit saved in mythic schema.`,
    });

    // The mythic screen reads authoritative board + transitions + combat playback.
    navigate(`/mythic/${campaignId}`);
  };

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

  if (authLoading || sessionFallback.checking || characterLoading) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <div className="text-sm text-muted-foreground">Loading character...</div>
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
    const className = String((character.class_json as any)?.class_name ?? "(class)");
    const role = String((character.class_json as any)?.role ?? "?");

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card/50 p-4">
          <div className="text-lg font-semibold">{character.name}</div>
          <div className="text-sm text-muted-foreground">{className} · {role}</div>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <div>Level: {character.level}</div>
            <div>Offense: {character.offense}</div>
            <div>Defense: {character.defense}</div>
            <div>Mobility: {character.mobility}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            onClick={() => navigate(`/mythic/${campaignId}`)}
          >
            Continue (Mythic)
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            onClick={() => navigate(`/game/${campaignId}`)}
          >
            Continue (Legacy)
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            onClick={() => setShowCreator(true)}
          >
            Regenerate Mythic Kit
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <MythicCharacterCreator
        campaignId={campaignId}
        onComplete={handleCompleteMythic}
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
        </div>
      ) : null}
    </>
  );
}
