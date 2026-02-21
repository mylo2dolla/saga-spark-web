import { Button } from "@/components/ui/button";
import { MythicDMChat } from "@/components/MythicDMChat";
import type { MythicDMMessage, MythicDmPhase } from "@/hooks/useMythicDungeonMaster";

interface NarrativePageProps {
  messages: MythicDMMessage[];
  isDmLoading: boolean;
  currentResponse: string;
  dmPhase?: MythicDmPhase | null;
  operationAttempt?: number;
  operationNextRetryAt?: number;
  actionError: string | null;
  voiceEnabled?: boolean;
  voiceSupported?: boolean;
  voiceBlocked?: boolean;
  onToggleVoice?: (enabled: boolean) => void;
  onSpeakLatest?: () => void;
  onStopVoice?: () => void;
  autoFollow?: boolean;
  onRetryAction: () => void;
  onSendMessage: (message: string) => void;
  onCancelMessage: () => void;
}

export function NarrativePage(props: NarrativePageProps) {
  const phaseLabel = props.dmPhase === "assembling_context"
    ? "assembling context"
    : props.dmPhase === "resolving_narration"
      ? "resolving narration"
      : props.dmPhase === "committing_turn"
        ? "committing turn"
        : "processing";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/40 px-4 py-3">
        <div className="font-display text-lg">Narrative</div>
        <div className="text-xs text-muted-foreground">Type what you do. The DM narration and game state stay synchronized.</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {props.actionError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <div>{props.actionError}</div>
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={props.onRetryAction}>
                Retry Last Action
              </Button>
            </div>
          </div>
        ) : null}

        {props.isDmLoading ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
            <span>
              DM {phaseLabel} (attempt {props.operationAttempt ?? 1}
              {props.operationNextRetryAt
                ? ` · retry ${new Date(props.operationNextRetryAt).toLocaleTimeString()}`
                : ""}
              )
            </span>
            <Button size="sm" variant="secondary" onClick={props.onCancelMessage}>
              Cancel
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background/40">
          <MythicDMChat
            messages={props.messages}
            isLoading={props.isDmLoading}
            currentResponse={props.currentResponse}
            voiceEnabled={props.voiceEnabled}
            voiceSupported={props.voiceSupported}
            voiceBlocked={props.voiceBlocked}
            onToggleVoice={props.onToggleVoice}
            onSpeakLatest={props.onSpeakLatest}
            onStopVoice={props.onStopVoice}
            autoFollow={props.autoFollow}
            onSendMessage={props.onSendMessage}
          />
        </div>
      </div>
    </div>
  );
}
