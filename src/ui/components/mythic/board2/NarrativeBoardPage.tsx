import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import {
  buildInspectTargetFromHotspot,
  buildMissClickInspectTarget,
  dedupeBoardActions,
} from "@/ui/components/mythic/board2/actionBuilders";
import { BoardInspectCard } from "@/ui/components/mythic/board2/BoardInspectCard";
import { NarrativeBoardViewport, type NarrativeBoardRendererDiagnostics } from "@/ui/components/mythic/board2/NarrativeBoardViewport";
import type {
  CombatSceneData,
  DungeonSceneData,
  NarrativeBoardSceneModel,
  NarrativeInspectTarget,
  TravelSceneData,
} from "@/ui/components/mythic/board2/types";

interface NarrativeBoardPageProps {
  scene: NarrativeBoardSceneModel;
  renderer: "dom" | "pixi";
  fastMode?: boolean;
  topSafeInsetPx?: number;
  bottomSafeInsetPx?: number;
  baseActions: MythicUiAction[];
  isBusy: boolean;
  isStateRefreshing: boolean;
  transitionError: string | null;
  combatStartError: { message: string; code: string | null; requestId: string | null } | null;
  dmContextError: string | null;
  showDevDetails: boolean;
  onRendererDiagnostics?: (diagnostics: NarrativeBoardRendererDiagnostics) => void;
  onRendererFallback?: (diagnostics: NarrativeBoardRendererDiagnostics) => void;
  onRetryCombatStart: () => void;
  onQuickCast: (skillId: string, targeting: string) => void;
  onContinueCombatResolution: () => void;
  onAction: (action: MythicUiAction, source: "board_hotspot" | "console_action") => void;
}

function primaryWarning(args: {
  transitionError: string | null;
  combatStartError: { message: string; code: string | null; requestId: string | null } | null;
  dmContextError: string | null;
  sceneWarnings: string[];
  showDevDetails: boolean;
}): string | null {
  if (args.transitionError) {
    return args.showDevDetails ? args.transitionError : "World state transition failed. Retry the action.";
  }
  if (args.combatStartError) {
    if (args.showDevDetails) {
      const bits = [
        args.combatStartError.message,
        args.combatStartError.code ? `code ${args.combatStartError.code}` : null,
        args.combatStartError.requestId ? `request ${args.combatStartError.requestId}` : null,
      ].filter((entry): entry is string => Boolean(entry));
      return bits.join(" · ");
    }
    return args.combatStartError.message;
  }
  if (args.dmContextError) {
    return "Using runtime-only context.";
  }
  if (args.sceneWarnings.length > 0) {
    return args.showDevDetails
      ? (args.sceneWarnings[0] ?? null)
      : "Some world updates are still settling.";
  }
  return null;
}

export function NarrativeBoardPage(props: NarrativeBoardPageProps) {
  const [inspectTarget, setInspectTarget] = useState<NarrativeInspectTarget | null>(null);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const topSafeInsetPx = Math.max(0, Math.floor(props.topSafeInsetPx ?? 58));
  const bottomSafeInsetPx = Math.max(0, Math.floor(props.bottomSafeInsetPx ?? 92));

  useEffect(() => {
    setInspectTarget(null);
    setSkillsExpanded(false);
  }, [props.scene.mode]);

  useEffect(() => {
    if (!inspectTarget || inspectTarget.interaction.source !== "hotspot") return;
    const liveHotspot = props.scene.hotspots.find((entry) => entry.id === inspectTarget.id);
    if (!liveHotspot) {
      setInspectTarget(null);
      return;
    }
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

  const mergedInspectActions = useMemo(
    () => dedupeBoardActions([...(inspectTarget?.actions ?? []), ...props.baseActions], 10),
    [inspectTarget?.actions, props.baseActions],
  );

  const warning = useMemo(
    () => primaryWarning({
      transitionError: props.transitionError,
      combatStartError: props.combatStartError,
      dmContextError: props.dmContextError,
      sceneWarnings: props.scene.warnings,
      showDevDetails: props.showDevDetails,
    }),
    [props.combatStartError, props.dmContextError, props.scene.warnings, props.showDevDetails, props.transitionError],
  );

  const combatDetails = props.scene.mode === "combat" ? (props.scene.details as CombatSceneData) : null;
  const resolutionPending = combatDetails?.resolutionPending?.pending ? combatDetails.resolutionPending : null;
  const popupModel = props.scene.popup;
  const syncActive = props.isBusy || props.isStateRefreshing;
  const inspectBottomOffsetClass = combatDetails
    ? (skillsExpanded ? "bottom-[332px]" : "bottom-[216px]")
    : "bottom-[100px]";

  return (
    <div data-testid="narrative-board-page" className="relative h-full min-h-0 overflow-hidden rounded-lg border border-amber-200/20 bg-black/10">
      <NarrativeBoardViewport
        scene={props.scene}
        isActing={props.isBusy}
        renderer={props.renderer}
        fastMode={props.fastMode}
        showDevOverlay={props.showDevDetails}
        safeInsetTopPx={topSafeInsetPx}
        safeInsetBottomPx={bottomSafeInsetPx}
        onRendererDiagnostics={props.onRendererDiagnostics}
        onRendererFallback={props.onRendererFallback}
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
      />

      <div
        data-testid="board-mode-strip"
        className="pointer-events-none absolute left-2 right-2 z-20 flex flex-wrap items-center gap-1 rounded border border-amber-200/30 bg-black/35 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-100/80"
        style={{ top: `${topSafeInsetPx + 4}px` }}
      >
        <span className="rounded border border-amber-200/40 bg-black/40 px-1.5 py-0.5">{props.scene.modeStrip.modeLabel}</span>
        <span className="rounded border border-amber-200/35 bg-black/35 px-1.5 py-0.5">
          {syncActive ? "Syncing" : props.scene.modeStrip.syncLabel}
        </span>
        {syncActive ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {props.scene.modeStrip.turnOwnerLabel ? (
          <span className="rounded border border-amber-200/35 bg-black/35 px-1.5 py-0.5">{props.scene.modeStrip.turnOwnerLabel}</span>
        ) : null}
        {props.scene.modeStrip.paceLabel ? (
          <span data-testid="board-mode-pace" className="rounded border border-cyan-200/35 bg-black/35 px-1.5 py-0.5 text-cyan-100/85">
            {props.scene.modeStrip.paceLabel}
          </span>
        ) : null}
      </div>

      {warning ? (
        <div
          data-testid="board-warning-line"
          className="pointer-events-none absolute left-2 right-2 z-20 truncate rounded border border-amber-200/30 bg-black/35 px-2 py-1 text-[11px] text-amber-100/80"
          style={{ top: `${topSafeInsetPx + 36}px` }}
        >
          {warning}
        </div>
      ) : null}

      {combatDetails ? (
        <div
          data-testid="board-combat-rail"
          className="absolute inset-x-2 bottom-2 z-20 rounded-lg border border-red-200/30 bg-[linear-gradient(170deg,rgba(44,17,18,0.94),rgba(8,10,16,0.96))] p-2 shadow-xl"
          style={{ bottom: `${bottomSafeInsetPx + 8}px` }}
        >
          {resolutionPending ? (
            <div className="mb-2 rounded border border-emerald-200/35 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-100">
              <div className="font-medium">
                {resolutionPending.won ? "Combat resolved: Victory" : "Combat resolved"}
              </div>
              <div className="mt-0.5">
                Continue to {resolutionPending.returnMode}
                {resolutionPending.xpGained > 0 ? ` · +${resolutionPending.xpGained} XP` : ""}
                {resolutionPending.loot.length > 0 ? ` · Loot: ${resolutionPending.loot.slice(0, 2).join(", ")}` : ""}
              </div>
              <div className="mt-2">
                <Button
                  data-testid="combat-resolution-continue"
                  size="sm"
                  disabled={props.isBusy}
                  onClick={props.onContinueCombatResolution}
                >
                  Continue
                </Button>
              </div>
            </div>
          ) : null}
          <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wide text-red-100/75">
            <span>Core Actions</span>
            {props.scene.modeStrip.moveStateLabel ? (
              <span data-testid="combat-move-state" className="rounded border border-red-100/30 bg-black/35 px-1.5 py-0.5 text-[9px] text-red-100/80">
                {props.scene.modeStrip.moveStateLabel}
              </span>
            ) : null}
          </div>
          <div className="grid gap-1 sm:grid-cols-4">
            {combatDetails.coreActions.map((action) => (
              <Button
                key={`combat-core-${action.id}`}
                size="sm"
                variant={action.usableNow ? "default" : "secondary"}
                disabled={!action.usableNow || props.isBusy || Boolean(resolutionPending)}
                className="h-7 justify-between text-[12px]"
                onClick={() => props.onQuickCast(action.id, action.targeting)}
              >
                <span>{action.label}</span>
                <span className="ml-2 text-[10px] uppercase tracking-wide">
                  {action.usableNow ? "use" : (action.reason ?? "locked")}
                </span>
              </Button>
            ))}
          </div>

          <div className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[11px]"
              disabled={Boolean(resolutionPending)}
              onClick={() => setSkillsExpanded((prev) => !prev)}
            >
              {skillsExpanded ? "Hide Skills" : `Skills (${combatDetails.quickCast.length})`}
            </Button>
          </div>

          {skillsExpanded ? (
            <div className="mt-2 grid max-h-[190px] gap-1 overflow-auto pr-1 sm:grid-cols-2">
              {combatDetails.quickCast.length === 0 ? (
                <div className="text-xs text-red-100/75">No active skills available.</div>
              ) : combatDetails.quickCast.map((entry) => (
                <Button
                  key={`combat-skill-${entry.skillId}`}
                  size="sm"
                  variant={entry.usableNow ? "secondary" : "ghost"}
                  disabled={!entry.usableNow || props.isBusy || Boolean(resolutionPending)}
                  className="h-7 justify-between text-[11px]"
                  onClick={() => props.onQuickCast(entry.skillId, entry.targeting)}
                >
                  <span className="truncate">{entry.name}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wide">
                    {entry.usableNow ? "cast" : (entry.reason ?? "locked")}
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {inspectTarget ? (
        <div
          data-testid="board-inspect-popup"
          className={`absolute inset-x-2 z-30 ${inspectBottomOffsetClass}`}
          style={{ bottom: `${bottomSafeInsetPx + (combatDetails ? (skillsExpanded ? 240 : 126) : 8)}px` }}
        >
          <BoardInspectCard
            target={inspectTarget}
            title={popupModel.title}
            isBusy={props.isBusy}
            showDevDetails={props.showDevDetails}
            onClose={() => setInspectTarget(null)}
            onAction={(action) => {
              props.onAction(action, "board_hotspot");
              setInspectTarget(null);
            }}
          />
          {!inspectTarget.actions.length && mergedInspectActions.length > 0 ? (
            <div className="mt-2 rounded border border-amber-200/25 bg-black/45 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-amber-100/70">{popupModel.emptyProbeHint}</div>
              <div className="flex flex-wrap gap-1">
                {mergedInspectActions.slice(0, 6).map((action) => (
                  <Button
                    key={`inspect-context-${action.id}`}
                    size="sm"
                    variant="secondary"
                    disabled={props.isBusy || Boolean(action.disabled)}
                    className="h-7 text-[11px]"
                    onClick={() => {
                      props.onAction(action, "console_action");
                      setInspectTarget(null);
                    }}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {props.combatStartError ? (
        <div className="absolute bottom-2 right-2 z-20">
          <Button size="sm" variant="secondary" onClick={props.onRetryCombatStart}>
            Retry Combat Start
          </Button>
        </div>
      ) : null}
    </div>
  );
}
