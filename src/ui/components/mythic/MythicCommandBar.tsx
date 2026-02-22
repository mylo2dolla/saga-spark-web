import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MythicCommandBarProps {
  disabled: boolean;
  isDmLoading: boolean;
  actionError: string | null;
  voiceEnabled?: boolean;
  voiceSupported?: boolean;
  voiceBlocked?: boolean;
  onToggleVoice?: (enabled: boolean) => void;
  onSpeakLatest?: () => void;
  onStopVoice?: () => void;
  onRetryAction: () => void;
  onCancelMessage: () => void;
  onSendMessage: (message: string) => void;
  onOpenTranscript: () => void;
  onFocusChange?: (focused: boolean) => void;
}

export function MythicCommandBar(props: MythicCommandBarProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const send = () => {
    const trimmed = input.trim();
    if (!trimmed || props.disabled) return;
    props.onSendMessage(trimmed);
    setInput("");
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  return (
    <div
      data-testid="mythic-command-bar"
      className="pointer-events-auto rounded-lg border border-amber-200/35 bg-black/50 p-2 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur-[2px]"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={props.voiceEnabled ? "secondary" : "outline"}
          className="h-7 px-2 text-[11px]"
          onClick={() => props.onToggleVoice?.(!props.voiceEnabled)}
          disabled={!props.voiceSupported}
        >
          Voice: {props.voiceEnabled ? "On" : "Off"}
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => props.onSpeakLatest?.()} disabled={!props.voiceSupported}>
          Speak Latest
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => props.onStopVoice?.()} disabled={!props.voiceSupported}>
          Stop
        </Button>
        <Button size="sm" variant="secondary" className="h-7 px-2 text-[11px]" onClick={props.onOpenTranscript}>
          Transcript
        </Button>
        {props.isDmLoading ? (
          <span className="inline-flex items-center gap-1 text-xs text-amber-100/75">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            DM processing
          </span>
        ) : null}
      </div>

      {props.actionError ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <span className="truncate">{props.actionError}</span>
          <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px]" onClick={props.onRetryAction}>
            Retry Last Action
          </Button>
        </div>
      ) : null}

      {props.voiceBlocked ? (
        <div className="mb-2 rounded border border-amber-200/30 bg-amber-400/10 px-2 py-1 text-xs text-amber-100/85">
          Audio is ready; press Speak Latest after interacting with the page.
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onFocus={() => props.onFocusChange?.(true)}
          onBlur={() => props.onFocusChange?.(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
              return;
            }
            if (event.key === "Escape" && props.isDmLoading) {
              event.preventDefault();
              props.onCancelMessage();
            }
          }}
          placeholder="Type your action or narration..."
          disabled={props.disabled}
          rows={1}
          className="min-h-[40px] w-full resize-none rounded-md border border-amber-200/25 bg-black/35 px-3 py-2 text-sm text-amber-50 placeholder:text-amber-100/45 focus:border-amber-200/40 focus:outline-none"
        />
        <Button
          onClick={send}
          disabled={props.disabled || input.trim().length === 0}
          className="h-10 border border-amber-200/35 bg-amber-300/20 text-amber-50 hover:bg-amber-300/30"
        >
          Send
        </Button>
        {props.isDmLoading ? (
          <Button
            variant="outline"
            onClick={props.onCancelMessage}
            className="h-10 border-amber-200/35 text-amber-50 hover:bg-amber-300/15"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
