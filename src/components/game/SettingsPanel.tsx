import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NarrationEntry } from "@/engine/narrative/Narrator";
import type { NarrationSettings } from "@/hooks/useSettings";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: NarrationSettings;
  onSettingsChange: (updates: Partial<NarrationSettings>) => void;
  narration: NarrationEntry[];
  onClearNarration: () => void;
}

export function SettingsPanel({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  narration,
  onClearNarration,
}: SettingsPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Read Aloud</h3>
                <p className="text-xs text-muted-foreground">
                  Read new narration entries using your system voice.
                </p>
              </div>
              <Switch
                checked={settings.readAloudEnabled}
                onCheckedChange={(checked) => onSettingsChange({ readAloudEnabled: checked })}
              />
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Rate</span>
                  <span>{settings.rate.toFixed(2)}</span>
                </div>
                <Slider
                  value={[settings.rate]}
                  min={0.5}
                  max={2}
                  step={0.05}
                  onValueChange={(value) => onSettingsChange({ rate: value[0] })}
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Pitch</span>
                  <span>{settings.pitch.toFixed(2)}</span>
                </div>
                <Slider
                  value={[settings.pitch]}
                  min={0.5}
                  max={2}
                  step={0.05}
                  onValueChange={(value) => onSettingsChange({ pitch: value[0] })}
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Volume</span>
                  <span>{Math.round(settings.volume * 100)}%</span>
                </div>
                <Slider
                  value={[settings.volume]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(value) => onSettingsChange({ volume: value[0] })}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Narration Log</h3>
              <Button variant="outline" size="sm" onClick={onClearNarration}>
                Clear
              </Button>
            </div>
            <ScrollArea className="h-40 rounded-md border border-border bg-muted/20 p-3">
              {narration.length === 0 ? (
                <p className="text-xs text-muted-foreground">No narration yet.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {narration.slice(-20).map(entry => (
                    <div key={entry.id} className="text-foreground/80">
                      {entry.text}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
