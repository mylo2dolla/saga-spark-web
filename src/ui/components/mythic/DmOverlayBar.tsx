import { Loader2 } from "lucide-react";
import type { MythicDmPhase } from "@/hooks/useMythicDungeonMaster";

interface DmOverlayBarProps {
  latestNarration: string;
  phase: MythicDmPhase | null | undefined;
  isBusy: boolean;
  narratorSource?: "ai" | "procedural" | null;
}

function phaseLabel(phase: MythicDmPhase | null | undefined): string {
  if (phase === "assembling_context") return "Context";
  if (phase === "resolving_narration") return "Narrating";
  if (phase === "committing_turn") return "Commit";
  return "Ready";
}

export function DmOverlayBar(props: DmOverlayBarProps) {
  return (
    <div
      data-testid="dm-overlay-bar"
      className="pointer-events-auto rounded-lg border border-amber-200/35 bg-black/45 px-3 py-2 backdrop-blur-[2px]"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-amber-100/80">
        <div data-testid="dm-overlay-phase" className="inline-flex items-center gap-1.5">
          <span className="rounded border border-amber-200/40 bg-black/35 px-1.5 py-0.5">DM</span>
          <span className="rounded border border-amber-200/35 bg-black/35 px-1.5 py-0.5">{phaseLabel(props.phase)}</span>
          {props.narratorSource ? (
            <span className="rounded border border-amber-200/35 bg-black/35 px-1.5 py-0.5">
              {props.narratorSource}
            </span>
          ) : null}
          {props.isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        </div>
      </div>
      <div data-testid="dm-overlay-live-line" className="truncate text-sm text-amber-50/90">
        {props.latestNarration.length > 0 ? props.latestNarration : "Type your move. The board remains authoritative."}
      </div>
    </div>
  );
}
