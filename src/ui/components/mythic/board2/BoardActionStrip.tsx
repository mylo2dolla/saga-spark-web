import { Button } from "@/components/ui/button";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";

interface BoardActionStripProps {
  actions: MythicUiAction[];
  inspectActionIds: Set<string>;
  isBusy: boolean;
  onAction: (action: MythicUiAction, source: "board_hotspot" | "console_action") => void;
}

export function BoardActionStrip(props: BoardActionStripProps) {
  return (
    <div className="rounded-lg border border-amber-200/30 bg-[linear-gradient(160deg,rgba(24,20,14,0.95),rgba(11,12,18,0.96))] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-amber-100/70">Context Actions</div>
        <div className="text-[11px] text-amber-100/60">inspect-first, explicit confirm</div>
      </div>

      {props.actions.length === 0 ? (
        <div className="text-xs text-amber-100/65">No contextual actions yet. Probe the board or advance narration.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {props.actions.map((action) => {
            const actionSource: "board_hotspot" | "console_action" = props.inspectActionIds.has(action.id)
              ? "board_hotspot"
              : "console_action";
            return (
              <Button
                key={`board-action-${action.id}`}
                size="sm"
                variant={actionSource === "board_hotspot" ? "default" : "secondary"}
                disabled={props.isBusy}
                className="justify-start"
                onClick={() => props.onAction(action, actionSource)}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
