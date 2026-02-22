import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type MythicAnimationIntensity = "low" | "normal" | "high";

export interface MythicRuntimeSettings {
  compactNarration: boolean;
  animationIntensity: MythicAnimationIntensity;
  chatAutoFollow: boolean;
}

interface SettingsPanelProps {
  settings: MythicRuntimeSettings;
  onSettingsChange: (next: MythicRuntimeSettings) => void;
  voiceEnabled: boolean;
  voiceValue: string;
  voiceSupported: boolean;
  voiceBlocked: boolean;
  onToggleVoice: (enabled: boolean) => void;
  onVoiceChange: (voice: string) => void;
  onSpeakLatest: () => void;
  onStopVoice: () => void;
}

const INTENSITY_TO_STEP: Record<MythicAnimationIntensity, number> = {
  low: 0,
  normal: 1,
  high: 2,
};

const STEP_TO_INTENSITY: Record<number, MythicAnimationIntensity> = {
  0: "low",
  1: "normal",
  2: "high",
};

export function SettingsPanel(props: SettingsPanelProps) {
  const intensityStep = INTENSITY_TO_STEP[props.settings.animationIntensity];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-background/30 p-3">
        <div className="mb-2 text-sm font-semibold">DM Voice</div>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Switch
              checked={props.voiceEnabled}
              onCheckedChange={props.onToggleVoice}
              disabled={!props.voiceSupported}
              aria-label="Toggle DM voice"
            />
            <span className="text-muted-foreground">{props.voiceEnabled ? "Voice enabled" : "Voice muted"}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={props.onSpeakLatest} disabled={!props.voiceSupported}>
            Speak latest
          </Button>
          <Button size="sm" variant="outline" onClick={props.onStopVoice} disabled={!props.voiceSupported}>
            Stop
          </Button>
        </div>
        <div className="mb-2 grid max-w-[220px] gap-1 text-xs">
          <span className="text-muted-foreground">Voice profile</span>
          <Select value={props.voiceValue} onValueChange={props.onVoiceChange} disabled={!props.voiceSupported}>
            <SelectTrigger className="h-8 border-amber-200/20 bg-background/30 text-xs">
              <SelectValue placeholder="Choose voice" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alloy">Alloy (Male)</SelectItem>
              <SelectItem value="verse">Verse (Male Alt)</SelectItem>
              <SelectItem value="nova">Nova</SelectItem>
              <SelectItem value="aria">Aria</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!props.voiceSupported ? (
          <div className="text-xs text-muted-foreground">Voice is unavailable in this browser/runtime.</div>
        ) : null}
        {props.voiceBlocked ? (
          <div className="text-xs text-amber-200">Playback was blocked. Click Speak latest after interacting with the page.</div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-background/30 p-3">
        <div className="mb-2 text-sm font-semibold">Narration</div>
        <div className="flex items-center gap-2 text-xs">
          <Switch
            checked={props.settings.compactNarration}
            onCheckedChange={() => {}}
            disabled
            aria-label="Compact narration mode"
          />
          <span className="text-muted-foreground">Compact narration (server-locked default)</span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background/30 p-3">
        <div className="mb-2 text-sm font-semibold">Board Animation Intensity</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Intensity</span>
            <span className="capitalize">{props.settings.animationIntensity}</span>
          </div>
          <Slider
            value={[intensityStep]}
            min={0}
            max={2}
            step={1}
            onValueChange={(value) => {
              const next = STEP_TO_INTENSITY[Math.round(value[0] ?? intensityStep)] ?? "normal";
              props.onSettingsChange({
                ...props.settings,
                animationIntensity: next,
              });
            }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background/30 p-3">
        <div className="mb-2 text-sm font-semibold">Chat Follow Behavior</div>
        <div className="flex items-center gap-2 text-xs">
          <Switch
            checked={props.settings.chatAutoFollow}
            onCheckedChange={(checked) =>
              props.onSettingsChange({
                ...props.settings,
                chatAutoFollow: checked,
              })}
            aria-label="Auto-follow latest DM messages"
          />
          <span className="text-muted-foreground">
            {props.settings.chatAutoFollow
              ? "Auto-follow latest narration when near bottom"
              : "Manual follow (use Jump to latest)"}
          </span>
        </div>
      </div>
    </div>
  );
}
