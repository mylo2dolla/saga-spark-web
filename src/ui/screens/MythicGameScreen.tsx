import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useMythicCreator } from "@/hooks/useMythicCreator";
import { useMythicBoard } from "@/hooks/useMythicBoard";
import { useMythicCharacter } from "@/hooks/useMythicCharacter";
import { useMythicDmContext } from "@/hooks/useMythicDmContext";

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const pageTurn = {
  initial: { rotateY: -90, opacity: 0, transformOrigin: "left center" },
  animate: { rotateY: 0, opacity: 1, transformOrigin: "left center" },
  exit: { rotateY: 90, opacity: 0, transformOrigin: "right center" },
};

export default function MythicGameScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();

  const { bootstrapCampaign, isBootstrapping } = useMythicCreator();
  const { board, recentTransitions, isLoading: boardLoading, error: boardError, refetch } = useMythicBoard(campaignId);
  const { character, skills, isLoading: charLoading, error: charError } = useMythicCharacter(campaignId);
  const dm = useMythicDmContext(campaignId);

  const [bootstrapped, setBootstrapped] = useState(false);
  const bootstrapOnceRef = useRef(false);

  useEffect(() => {
    if (!campaignId) return;
    if (authLoading) return;
    if (!user) {
      navigate("/login");
      return;
    }
    if (bootstrapOnceRef.current) return;
    bootstrapOnceRef.current = true;

    (async () => {
      await bootstrapCampaign(campaignId);
      setBootstrapped(true);
      await refetch();
    })();
  }, [authLoading, bootstrapCampaign, campaignId, navigate, refetch, user]);

  const modeKey = useMemo(() => {
    return board ? `${board.board_type}:${board.id}:${board.updated_at}` : "none";
  }, [board]);

  if (!campaignId) {
    return <div className="p-6 text-sm text-muted-foreground">Campaign not found.</div>;
  }

  if (authLoading || boardLoading || charLoading || isBootstrapping) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading Mythic Weave state...</span>
      </div>
    );
  }

  if (boardError || charError) {
    return (
      <div className="space-y-3 p-6 text-sm text-muted-foreground">
        <div className="text-destructive">{boardError ?? charError}</div>
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="space-y-3 p-6 text-sm text-muted-foreground">
        <div>No Mythic character found for this campaign.</div>
        <Button onClick={() => navigate(`/game/${campaignId}/create-character`)}>Create Character</Button>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="space-y-3 p-6 text-sm text-muted-foreground">
        <div>No active Mythic board found.</div>
        <Button onClick={() => refetch()}>Refresh</Button>
      </div>
    );
  }

  const lastTransition = recentTransitions[0] ?? null;

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-2xl">Mythic Weave</div>
          <div className="text-sm text-muted-foreground">
            Board: <span className="font-medium">{board.board_type}</span>{" "}
            {lastTransition ? (
              <span className="text-muted-foreground">(last transition: {lastTransition.from_board_type ?? "?"} → {lastTransition.to_board_type}, {lastTransition.reason})</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate(`/dashboard`)}>Dashboard</Button>
          <Button variant="outline" onClick={() => navigate(`/game/${campaignId}`)}>Legacy Game</Button>
          <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          <Button variant="outline" onClick={() => dm.refetch()}>Refresh DM</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Character</div>
          <div className="text-sm">
            <div className="font-medium">{character.name}</div>
            <div className="text-muted-foreground">{String((character.class_json as any)?.class_name ?? "(class)")}</div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Skills</div>
          <div className="mt-2 grid gap-2">
            {skills.slice(0, 6).map((s, i) => (
              <div key={i} className="rounded-md border border-border bg-background/30 p-2">
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.kind} · {s.targeting} · r{s.range_tiles} · cd{s.cooldown_turns}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-4 [perspective:1200px]">
          <div className="mb-2 text-sm font-semibold">Board State (authoritative)</div>
          <AnimatePresence mode="wait">
            <motion.div
              key={modeKey}
              variants={pageTurn}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35, ease: "easeInOut" }}
              className="rounded-lg border border-border bg-background/30 p-3"
            >
              <pre className="max-h-[520px] overflow-auto text-xs text-muted-foreground">{prettyJson(board.state_json)}</pre>
            </motion.div>
          </AnimatePresence>
          <div className="mt-3 text-xs text-muted-foreground">
            UI contract: board + transitions + action_events are sufficient for deterministic replay.
            {bootstrapped ? " (bootstrapped)" : ""}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-2 text-sm font-semibold">Recent Board Transitions (append-only)</div>
        <pre className="max-h-[280px] overflow-auto text-xs text-muted-foreground">{prettyJson(recentTransitions)}</pre>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">DM Context (from mythic.v_*_for_dm + canonical rules/script)</div>
          <div className="text-xs text-muted-foreground">
            {dm.isLoading ? "loading..." : dm.error ? "error" : "ok"}
          </div>
        </div>
        {dm.error ? (
          <div className="text-sm text-destructive">{dm.error}</div>
        ) : (
          <pre className="max-h-[360px] overflow-auto text-xs text-muted-foreground">{prettyJson(dm.data)}</pre>
        )}
      </div>
    </div>
  );
}
