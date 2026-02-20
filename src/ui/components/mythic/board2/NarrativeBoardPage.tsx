import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import {
  actionSignature,
  buildInspectTargetFromHotspot,
  buildMissClickInspectTarget,
  dedupeBoardActions,
} from "@/ui/components/mythic/board2/actionBuilders";
import { BoardActionStrip, type BoardActionSource } from "@/ui/components/mythic/board2/BoardActionStrip";
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
  baseActionSourceBySignature?: Record<string, "assistant" | "runtime" | "companion" | "fallback">;
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

  useEffect(() => {
    if (!inspectTarget || inspectTarget.interaction.source !== "hotspot") return;
    const liveHotspot = props.scene.hotspots.find((entry) => entry.id === inspectTarget.id);
    if (!liveHotspot) {
      setInspectTarget(null);
      return;
    }
    const prevSignature = inspectTarget.actions.map((entry) => actionSignature(entry)).join("|");
    const nextSignature = liveHotspot.actions.map((entry) => actionSignature(entry)).join("|");
    const changed = prevSignature !== nextSignature
      || inspectTarget.title !== liveHotspot.title
      || inspectTarget.subtitle !== liveHotspot.subtitle
      || inspectTarget.description !== liveHotspot.description;
    if (!changed) return;
    setInspectTarget((prev) => {
      if (!prev || prev.id !== liveHotspot.id || prev.interaction.source !== "hotspot") return prev;
      return {
        ...prev,
        title: liveHotspot.title,
        subtitle: liveHotspot.subtitle,
        description: liveHotspot.description,
        actions: liveHotspot.actions,
        meta: liveHotspot.meta,
      };
    });
  }, [inspectTarget, props.scene.hotspots]);

  const inspectActions = inspectTarget?.actions ?? [];
  const stripActions = useMemo(
    () => dedupeBoardActions([...inspectActions, ...props.baseActions], 8),
    [inspectActions, props.baseActions],
  );
  const stripActionSourceBySignature = useMemo(() => {
    const out: Record<string, BoardActionSource> = {};
    inspectActions.forEach((action) => {
      out[actionSignature(action)] = "inspect";
    });
    props.baseActions.forEach((action) => {
      const signature = actionSignature(action);
      if (out[signature]) return;
      out[signature] = props.baseActionSourceBySignature?.[signature] ?? "console";
    });
    return out;
  }, [inspectActions, props.baseActionSourceBySignature, props.baseActions]);

  const topBanner = useMemo(() => {
    if (props.transitionError) {
      return {
        tone: "danger" as const,
        title: "Runtime transition failed",
        detail: props.transitionError,
      };
    }
    if (props.combatStartError) {
      const bits = [
        props.combatStartError.message,
        props.combatStartError.code ? `code: ${props.combatStartError.code}` : null,
        props.combatStartError.requestId ? `requestId: ${props.combatStartError.requestId}` : null,
      ].filter((entry): entry is string => Boolean(entry));
      return {
        tone: "danger" as const,
        title: "Combat start failed",
        detail: bits.join(" · "),
      };
    }
    if (props.dmContextError) {
      return {
        tone: "warn" as const,
        title: "DM context unavailable",
        detail: "Rendering from runtime state only. Diagnostics includes details.",
      };
    }
    if (props.scene.warnings.length > 0) {
      return {
        tone: "warn" as const,
        title: "Runtime warning",
        detail: props.scene.warnings[0]!,
      };
    }
    return null;
  }, [props.combatStartError, props.dmContextError, props.scene.warnings, props.transitionError]);

  const metricsRow = useMemo(() => props.scene.metrics.slice(0, 6), [props.scene.metrics]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      {topBanner ? (
        <div className={`rounded-md border px-3 py-2 text-xs ${topBanner.tone === "danger" ? "border-destructive/45 bg-destructive/10 text-destructive" : "border-amber-300/45 bg-amber-500/10 text-amber-100"}`}>
          <div className="font-medium">{topBanner.title}</div>
          <div className="mt-1">{topBanner.detail}</div>
          {props.combatStartError ? (
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={props.onRetryCombatStart}>
                Retry combat start
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-amber-200/25 bg-amber-100/5 px-2 py-2">
        {metricsRow.map((metric) => (
          <div
            key={`scene-metric-${metric.id}`}
            className={`whitespace-nowrap rounded border px-2 py-1 text-[11px] ${toneClass(metric.tone)}`}
          >
            <span className="font-semibold">{metric.label}</span>: {metric.value}
          </div>
        ))}
        <div className="ml-auto inline-flex shrink-0 items-center gap-2 rounded border border-amber-200/25 bg-amber-100/10 px-2 py-1 text-[11px] text-amber-100/80">
          <span>{props.scene.contextSource === "runtime_and_dm_context" ? "Runtime + DM Context" : "Runtime Only"}</span>
          {props.isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-lg border border-amber-200/20 bg-black/10 p-1">
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

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {inspectTarget ? (
          <BoardInspectCard
            target={inspectTarget}
            title={props.scene.dock.inspectTitle}
            isBusy={props.isBusy}
            className="h-full"
            onClose={() => setInspectTarget(null)}
            onAction={(action) => {
              props.onAction(action, "board_hotspot");
              setInspectTarget(null);
            }}
          />
        ) : (
          <div className="rounded-lg border border-amber-200/25 bg-[linear-gradient(160deg,rgba(21,17,12,0.95),rgba(12,14,20,0.96))] p-3 text-xs text-amber-100/70">
            <div className="mb-1 uppercase tracking-wide text-amber-100/65">{props.scene.dock.inspectTitle}</div>
            Click a hotspot or probe an empty tile to inspect before confirming an action.
          </div>
        )}

        <BoardActionStrip
          actions={stripActions}
          title={props.scene.dock.actionsTitle}
          sourceBySignature={stripActionSourceBySignature}
          isBusy={props.isBusy}
          onAction={(action, source) => {
            props.onAction(action, source);
            if (source === "board_hotspot") {
              setInspectTarget(null);
            }
          }}
        />
      </div>
    </div>
  );
}
