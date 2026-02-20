import { Button } from "@/components/ui/button";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import { actionSignature } from "@/ui/components/mythic/board2/actionBuilders";

export type BoardActionSource =
  | "inspect"
  | "assistant"
  | "runtime"
  | "companion"
  | "fallback"
  | "console";

interface BoardActionStripProps {
  actions: MythicUiAction[];
  sourceBySignature: Record<string, BoardActionSource>;
  isBusy: boolean;
  onAction: (action: MythicUiAction, source: "board_hotspot" | "console_action") => void;
  className?: string;
  title?: string;
}

function sourceLabel(source: BoardActionSource): string {
  if (source === "inspect") return "Inspect";
  if (source === "assistant") return "DM";
  if (source === "runtime") return "Runtime";
  if (source === "companion") return "Companion";
  if (source === "fallback") return "Fallback";
  return "Console";
}

function sourceTone(source: BoardActionSource): string {
  if (source === "inspect") return "border-amber-200/45 bg-amber-300/15 text-amber-100";
  if (source === "assistant") return "border-sky-200/45 bg-sky-300/15 text-sky-100";
  if (source === "runtime") return "border-emerald-200/45 bg-emerald-300/15 text-emerald-100";
  if (source === "companion") return "border-fuchsia-200/45 bg-fuchsia-300/15 text-fuchsia-100";
  if (source === "fallback") return "border-slate-200/45 bg-slate-300/15 text-slate-100";
  return "border-amber-200/30 bg-amber-100/10 text-amber-100/80";
}

export function BoardActionStrip(props: BoardActionStripProps) {
  return (
    <div className={`rounded-lg border border-amber-200/30 bg-[linear-gradient(160deg,rgba(24,20,14,0.95),rgba(11,12,18,0.96))] p-3 ${props.className ?? ""}`.trim()}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-amber-100/70">{props.title ?? "Context Actions"}</div>
        <div className="text-[11px] text-amber-100/60">inspect-first, explicit confirm</div>
      </div>

      {props.actions.length === 0 ? (
        <div className="text-xs text-amber-100/65">No contextual actions yet. Probe the board or advance narration.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {props.actions.map((action) => {
            const signature = actionSignature(action);
            const source = props.sourceBySignature[signature] ?? "console";
            const actionSource: "board_hotspot" | "console_action" = source === "inspect"
              ? "board_hotspot"
              : "console_action";
            return (
              <div key={`board-action-${action.id}-${signature}`} className="inline-flex items-center gap-1">
                <Button
                  size="sm"
                  variant={actionSource === "board_hotspot" ? "default" : "secondary"}
                  disabled={props.isBusy}
                  className="justify-start"
                  onClick={() => props.onAction(action, actionSource)}
                >
                  {action.label}
                </Button>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${sourceTone(source)}`}>
                  {sourceLabel(source)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
