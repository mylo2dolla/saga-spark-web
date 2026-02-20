import { Button } from "@/components/ui/button";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import type { NarrativeInspectTarget } from "@/ui/components/mythic/board2/types";

interface BoardInspectCardProps {
  target: NarrativeInspectTarget | null;
  isBusy: boolean;
  onClose: () => void;
  onAction: (action: MythicUiAction) => void;
  className?: string;
  title?: string;
}

function compactText(value: string, max = 120): string {
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max).trim()}...` : clean;
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
    .slice(0, 10);

  return (
    <div className={`rounded-lg border border-amber-200/30 bg-[linear-gradient(160deg,rgba(34,26,19,0.95),rgba(14,16,22,0.96))] p-3 text-amber-50 shadow-xl ${props.className ?? ""}`.trim()}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-amber-100/70">{props.title ?? "Inspect"}</div>
          <div className="font-display text-lg text-amber-100">{target.title}</div>
          {target.subtitle ? <div className="text-xs text-amber-100/75">{target.subtitle}</div> : null}
        </div>
        <Button size="sm" variant="secondary" onClick={props.onClose}>
          Close
        </Button>
      </div>

      <div className="mt-2 rounded border border-amber-200/25 bg-black/20 px-2 py-1 text-[11px] text-amber-100/80">
        <span className="font-semibold text-amber-100">Source</span>: {target.interaction.source === "hotspot" ? "hotspot" : "board probe"}
        <span className="ml-2 text-amber-100/65">grid ({target.interaction.x}, {target.interaction.y})</span>
      </div>

      {target.description ? <div className="mt-2 text-xs text-amber-100/80">{target.description}</div> : null}

      <div className="mt-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-amber-100/65">Confirm Action</div>
        {target.actions.length === 0 ? (
          <div className="text-xs text-amber-100/65">No direct actions on this tile.</div>
        ) : (
          target.actions.map((action) => (
            <Button
              key={`${target.id}:${action.id}`}
              size="sm"
              variant="secondary"
              disabled={props.isBusy}
              className="h-auto w-full justify-start py-2 text-left"
              onClick={() => props.onAction(action)}
            >
              <span className="flex w-full flex-col items-start gap-1">
                <span>{action.label}</span>
                {action.prompt ? (
                  <span className="text-[10px] text-amber-100/70">{compactText(action.prompt)}</span>
                ) : null}
              </span>
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
