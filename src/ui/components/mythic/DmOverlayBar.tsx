import { Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MythicDmPhase } from "@/hooks/useMythicDungeonMaster";

interface DmOverlayBarProps {
  latestNarration: string;
  phase: MythicDmPhase | null | undefined;
  isBusy: boolean;
  isVoiceEnabled: boolean;
  onToggleVoice: () => void;
  onOpenTranscript: () => void;
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
        <div className="inline-flex items-center gap-1.5">
          <span className="rounded border border-amber-200/40 bg-black/35 px-1.5 py-0.5">DM</span>
          <span className="rounded border border-amber-200/35 bg-black/35 px-1.5 py-0.5">{phaseLabel(props.phase)}</span>
          {props.isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        </div>
        <div className="inline-flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-[10px]"
            onClick={props.onToggleVoice}
          >
            Voice: {props.isVoiceEnabled ? "On" : "Off"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-[10px]"
            onClick={props.onOpenTranscript}
          >
            <MessageSquareText className="mr-1 h-3 w-3" />
            Expand
          </Button>
        </div>
      </div>
      <div className="truncate text-sm text-amber-50/90">
        {props.latestNarration.length > 0 ? props.latestNarration : "Type your move. The board remains authoritative."}
      </div>
    </div>
  );
}
