import { Badge } from "@/components/ui/badge";
import type { MythicQuestArc } from "@/types/mythicDm";

interface Props {
  arcs: MythicQuestArc[];
  isLoading: boolean;
  error: string | null;
}

const ARC_STATE_CLASS: Record<string, string> = {
  available: "bg-muted text-muted-foreground",
  active: "bg-primary/20 text-primary",
  blocked: "bg-amber-500/20 text-amber-600",
  completed: "bg-emerald-500/20 text-emerald-600",
  failed: "bg-destructive/20 text-destructive",
};

const OBJECTIVE_STATE_CLASS: Record<string, string> = {
  active: "text-muted-foreground",
  completed: "text-emerald-600",
  failed: "text-destructive",
};

export function MythicQuestPanel({ arcs, isLoading, error }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Quest Arcs</div>
        <div className="text-xs text-muted-foreground">{arcs.length} tracked</div>
      </div>

      {isLoading ? <div className="text-xs text-muted-foreground">Loading quest arcs...</div> : null}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      {!isLoading && !error && arcs.length === 0 ? (
        <div className="text-xs text-muted-foreground">No active quest arcs yet.</div>
      ) : null}

      <div className="space-y-3">
        {arcs.map((arc) => (
          <div key={arc.id} className="rounded-lg border border-border bg-background/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{arc.title}</div>
                <div className="text-xs text-muted-foreground">{arc.summary}</div>
              </div>
              <Badge className={`text-[10px] ${ARC_STATE_CLASS[arc.state] ?? ARC_STATE_CLASS.available}`}>
                {arc.state}
              </Badge>
            </div>

            {arc.objectives.length > 0 ? (
              <div className="mt-2 space-y-1">
                {arc.objectives.map((objective) => (
                  <div
                    key={objective.id}
                    className={`text-xs ${OBJECTIVE_STATE_CLASS[objective.state] ?? OBJECTIVE_STATE_CLASS.active}`}
                  >
                    {objective.description} ({objective.current_count}/{objective.target_count})
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">No objectives defined yet.</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
