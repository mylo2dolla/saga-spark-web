import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MythicDMChat } from "@/components/MythicDMChat";
import type { MythicDMMessage, MythicDmPhase } from "@/hooks/useMythicDungeonMaster";

interface DmTranscriptDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: MythicDMMessage[];
  isDmLoading: boolean;
  currentResponse: string;
  dmPhase?: MythicDmPhase | null;
  operationAttempt?: number;
  operationNextRetryAt?: number;
  voiceEnabled?: boolean;
  voiceSupported?: boolean;
  voiceBlocked?: boolean;
  onToggleVoice?: (enabled: boolean) => void;
  onSpeakLatest?: () => void;
  onStopVoice?: () => void;
  autoFollow?: boolean;
  onSendMessage: (message: string) => void;
}

function phaseLabel(phase: MythicDmPhase | null | undefined): string {
  if (phase === "assembling_context") return "assembling context";
  if (phase === "resolving_narration") return "resolving narration";
  if (phase === "committing_turn") return "committing turn";
  return "idle";
}

export function DmTranscriptDrawer(props: DmTranscriptDrawerProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[74vh] border-amber-200/25 bg-[linear-gradient(180deg,rgba(17,14,10,0.95),rgba(8,10,16,0.98))] p-0 text-amber-50"
      >
        <SheetHeader className="border-b border-amber-200/20 px-4 py-3">
          <SheetTitle className="font-display text-amber-100">Narrative Transcript</SheetTitle>
          <SheetDescription className="text-amber-100/70">
            DM {phaseLabel(props.dmPhase)}
            {typeof props.operationAttempt === "number" ? ` · attempt ${props.operationAttempt}` : ""}
            {props.operationNextRetryAt ? ` · retry ${new Date(props.operationNextRetryAt).toLocaleTimeString()}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="h-[calc(74vh-72px)]">
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
            hideComposer
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
