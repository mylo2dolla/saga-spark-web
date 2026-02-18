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

