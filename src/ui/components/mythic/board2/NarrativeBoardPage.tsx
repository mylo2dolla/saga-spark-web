import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import {
  buildInspectTargetFromHotspot,
  buildMissClickInspectTarget,
  dedupeBoardActions,
} from "@/ui/components/mythic/board2/actionBuilders";
import { BoardActionStrip } from "@/ui/components/mythic/board2/BoardActionStrip";
import { BoardInspectCard } from "@/ui/components/mythic/board2/BoardInspectCard";
import { NarrativeBoardViewport } from "@/ui/components/mythic/board2/NarrativeBoardViewport";
import type {
  CombatSceneData,
  DungeonSceneData,
  NarrativeBoardSceneModel,
  NarrativeInspectTarget,
  TravelSceneData,
} from "@/ui/components/mythic/board2/types";

interface NarrativeBoardPageProps {
  scene: NarrativeBoardSceneModel;
  baseActions: MythicUiAction[];
  isBusy: boolean;
  transitionError: string | null;
  combatStartError: { message: string; code: string | null; requestId: string | null } | null;
  dmContextError: string | null;
  onRetryCombatStart: () => void;
  onQuickCast: (skillId: string, targeting: string) => void;
  onAction: (action: MythicUiAction, source: "board_hotspot" | "console_action") => void;
}

function toneClass(tone: "neutral" | "good" | "warn" | "danger" | undefined): string {
  if (tone === "good") return "border-emerald-200/40 bg-emerald-300/15 text-emerald-100";
  if (tone === "warn") return "border-amber-200/40 bg-amber-300/15 text-amber-100";
  if (tone === "danger") return "border-red-200/40 bg-red-300/15 text-red-100";
  return "border-amber-200/25 bg-amber-100/10 text-amber-100/85";
}

export function NarrativeBoardPage(props: NarrativeBoardPageProps) {
  const [inspectTarget, setInspectTarget] = useState<NarrativeInspectTarget | null>(null);

  useEffect(() => {
    setInspectTarget(null);
  }, [props.scene.mode]);

  const inspectActions = inspectTarget?.actions ?? [];
  const stripActions = useMemo(
    () => dedupeBoardActions([...inspectActions, ...props.baseActions], 8),
    [inspectActions, props.baseActions],
  );
  const inspectActionIds = useMemo(() => new Set(inspectActions.map((action) => action.id)), [inspectActions]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      {props.transitionError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {props.transitionError}
        </div>
      ) : null}

      {props.combatStartError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <div className="font-medium text-foreground">Failed to initiate combat</div>
          <div className="mt-1">{props.combatStartError.message}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {props.combatStartError.code ? <span>code: {props.combatStartError.code}</span> : null}
            {props.combatStartError.requestId ? <span>requestId: {props.combatStartError.requestId}</span> : null}
          </div>
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={props.onRetryCombatStart}>
              Retry combat start
            </Button>
          </div>
        </div>
      ) : null}

      {props.dmContextError ? (
        <div className="rounded-md border border-amber-300/45 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          DM context unavailable. Rendering from runtime state only. Diagnostics includes details.
        </div>
      ) : null}

      {props.scene.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-300/35 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/85">
          {props.scene.warnings[0]}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {props.scene.metrics.map((metric) => (
          <div
            key={`scene-metric-${metric.id}`}
            className={`rounded border px-2 py-1 text-[11px] ${toneClass(metric.tone)}`}
          >
            <span className="font-semibold">{metric.label}</span>: {metric.value}
          </div>
        ))}
        <div className="ml-auto inline-flex items-center gap-2 rounded border border-amber-200/25 bg-amber-100/10 px-2 py-1 text-[11px] text-amber-100/80">
          <span>{props.scene.contextSource === "runtime_and_dm_context" ? "Runtime + DM Context" : "Runtime Only"}</span>
          {props.isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <NarrativeBoardViewport
          scene={props.scene}
          isActing={props.isBusy}
          onSelectHotspot={(hotspot, point) => {
            setInspectTarget(buildInspectTargetFromHotspot({ hotspot, x: point.x, y: point.y }));
          }}
          onSelectMiss={(point) => {
            setInspectTarget(
              buildMissClickInspectTarget({
                mode: props.scene.mode,
                x: point.x,
                y: point.y,
                travel: props.scene.mode === "travel" ? (props.scene.details as TravelSceneData) : undefined,
                dungeon: props.scene.mode === "dungeon" ? (props.scene.details as DungeonSceneData) : undefined,
                combat: props.scene.mode === "combat" ? (props.scene.details as CombatSceneData) : undefined,
              }),
            );
          }}
          onQuickCast={props.onQuickCast}
        />
      </div>

      <BoardInspectCard
        target={inspectTarget}
        isBusy={props.isBusy}
        onClose={() => setInspectTarget(null)}
        onAction={(action) => {
          props.onAction(action, "board_hotspot");
          setInspectTarget(null);
        }}
      />

      <BoardActionStrip
        actions={stripActions}
        inspectActionIds={inspectActionIds}
        isBusy={props.isBusy}
        onAction={(action, source) => {
          props.onAction(action, source);
          if (source === "board_hotspot") {
            setInspectTarget(null);
          }
        }}
      />
    </div>
  );
}
