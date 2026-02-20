import { Button } from "@/components/ui/button";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import type { NarrativeInspectTarget } from "@/ui/components/mythic/board2/types";

interface BoardInspectCardProps {
  target: NarrativeInspectTarget | null;
  isBusy: boolean;
  onClose: () => void;
  onAction: (action: MythicUiAction) => void;
}

function formatMeta(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  try {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 140)}...` : text;
  } catch {
    return String(value);
  }
}

export function BoardInspectCard(props: BoardInspectCardProps) {
  const target = props.target;
  if (!target) return null;

  const metaRows = Object.entries(target.meta ?? {})
    .filter(([key]) => !key.startsWith("_"))
    .slice(0, 8);

  return (
    <div className="rounded-lg border border-amber-200/30 bg-[linear-gradient(160deg,rgba(34,26,19,0.95),rgba(14,16,22,0.96))] p-3 text-amber-50 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-lg text-amber-100">{target.title}</div>
          {target.subtitle ? <div className="text-xs text-amber-100/75">{target.subtitle}</div> : null}
        </div>
        <Button size="sm" variant="secondary" onClick={props.onClose}>
          Close
        </Button>
      </div>

      {target.description ? <div className="mt-2 text-xs text-amber-100/80">{target.description}</div> : null}

      <div className="mt-3 grid gap-2">
        {target.actions.length === 0 ? (
          <div className="text-xs text-amber-100/65">No direct actions on this tile.</div>
        ) : (
          target.actions.map((action) => (
            <Button
              key={`${target.id}:${action.id}`}
              size="sm"
              variant="secondary"
              disabled={props.isBusy}
              className="justify-start"
              onClick={() => props.onAction(action)}
            >
              {action.label}
            </Button>
          ))
        )}
      </div>

      {metaRows.length > 0 ? (
        <div className="mt-3 grid gap-1 rounded border border-amber-200/25 bg-black/20 p-2 text-[11px] text-amber-100/75 sm:grid-cols-2">
          {metaRows.map(([key, value]) => (
            <div key={`${target.id}:meta:${key}`}>
              <span className="font-semibold text-amber-100">{key}</span>: {formatMeta(value)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
