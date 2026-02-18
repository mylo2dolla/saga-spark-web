import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { BoardInspectTarget } from "@/ui/components/mythic/board/inspectTypes";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import type { MythicQuestThreadRow } from "@/types/mythic";

interface Props {
  open: boolean;
  target: BoardInspectTarget | null;
  questThreads: MythicQuestThreadRow[];
  onOpenChange: (open: boolean) => void;
  onAction: (action: MythicUiAction) => void;
}

export function BoardInspectDialog(props: Props) {
  const target = props.target;
  const recentThreads = props.questThreads.slice(0, 3);
  const metaEntries = target?.meta && typeof target.meta === "object"
    ? Object.entries(target.meta)
        .filter(([key]) => !key.startsWith("_"))
        .slice(0, 10)
    : [];

  const formatMeta = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}...` : value;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
    if (typeof value === "boolean") return value ? "yes" : "no";
    try {
      const json = JSON.stringify(value);
      return json.length > 160 ? `${json.slice(0, 160)}...` : json;
    } catch {
      return String(value);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-hidden border border-border bg-card/90 backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{target?.title ?? "Inspect"}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {target?.subtitle ?? "Tap an option or describe your move in the narrative."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-auto pr-1">
          {metaEntries.length > 0 ? (
            <div className="mb-3 rounded-lg border border-border bg-background/30 p-3">
              <div className="mb-2 text-xs font-semibold text-foreground">Details</div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                {metaEntries.map(([key, value]) => (
                  <div key={key} className="rounded border border-border bg-background/20 px-2 py-2">
                    <div className="font-medium text-foreground">{key}</div>
                    <div className="mt-1 break-words">{formatMeta(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {target?.actions?.length ? (
            <div className="grid gap-2">
              {target.actions.map((action) => (
                <Button
                  key={action.id}
                  variant="secondary"
                  className="justify-start"
                  onClick={() => {
                    props.onAction(action);
                    props.onOpenChange(false);
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No actions available.</div>
          )}

          {recentThreads.length > 0 ? (
            <div className="mt-4 rounded-lg border border-border bg-background/30 p-3">
              <div className="mb-2 text-xs font-semibold text-foreground">Recent Threads</div>
              <div className="space-y-2">
                {recentThreads.map((thread) => (
                  <div key={thread.id} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                    <div className="font-medium text-foreground">{thread.title}</div>
                    {thread.detail ? <div className="mt-1 text-muted-foreground">{thread.detail}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
