import type { MythicStoryBeat } from "@/types/mythicDm";

interface Props {
  beats: MythicStoryBeat[];
  isLoading: boolean;
  error: string | null;
}

const EMPHASIS_CLASS: Record<string, string> = {
  low: "border-border",
  normal: "border-border",
  high: "border-amber-500/40",
  critical: "border-destructive/40",
};

export function MythicStoryTimeline({ beats, isLoading, error }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Story Timeline</div>
        <div className="text-xs text-muted-foreground">{beats.length} beats</div>
      </div>

      {isLoading ? <div className="text-xs text-muted-foreground">Loading timeline...</div> : null}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      {!isLoading && !error && beats.length === 0 ? (
        <div className="text-xs text-muted-foreground">No story beats recorded yet.</div>
      ) : null}

      <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
        {beats.map((beat) => (
          <div
            key={beat.id}
            className={`rounded-md border bg-background/30 p-3 ${EMPHASIS_CLASS[beat.emphasis] ?? EMPHASIS_CLASS.normal}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{beat.title}</div>
              <div className="text-[11px] uppercase text-muted-foreground">{beat.beat_type}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{beat.narrative}</div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {new Date(beat.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
