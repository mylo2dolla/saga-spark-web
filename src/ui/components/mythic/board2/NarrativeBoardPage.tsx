import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import {
  actionSignature,
  buildInspectTargetFromHotspot,
  buildMissClickInspectTarget,
  dedupeBoardActions,
} from "@/ui/components/mythic/board2/actionBuilders";
import { BoardActionStrip, type BoardActionSource } from "@/ui/components/mythic/board2/BoardActionStrip";
import { BoardCardDock } from "@/ui/components/mythic/board2/BoardCardDock";
import { BoardInspectCard } from "@/ui/components/mythic/board2/BoardInspectCard";
import { NarrativeBoardViewport } from "@/ui/components/mythic/board2/NarrativeBoardViewport";
import { RightPanelHero, type RightPanelHeroCharacter, type RightPanelHeroWarning } from "@/ui/components/mythic/board2/RightPanelHero";
import type {
  CombatSceneData,
  DungeonSceneData,
  NarrativeBoardSceneModel,
  NarrativeDockCardModel,
  NarrativeInspectTarget,
  NarrativeTone,
  TravelSceneData,
} from "@/ui/components/mythic/board2/types";

interface NarrativeBoardPageProps {
  scene: NarrativeBoardSceneModel;
  baseActions: MythicUiAction[];
  baseActionSourceBySignature?: Record<string, "assistant" | "runtime" | "companion" | "fallback">;
  isBusy: boolean;
  isStateRefreshing: boolean;
  transitionError: string | null;
  combatStartError: { message: string; code: string | null; requestId: string | null } | null;
  dmContextError: string | null;
  showDevDetails: boolean;
  characterHero: RightPanelHeroCharacter | null;
  onOpenCharacterSheet: () => void;
  onRetryCombatStart: () => void;
  onQuickCast: (skillId: string, targeting: string) => void;
  onAction: (action: MythicUiAction, source: "board_hotspot" | "console_action") => void;
}

function warningFromState(args: {
  transitionError: string | null;
  combatStartError: { message: string; code: string | null; requestId: string | null } | null;
  dmContextError: string | null;
  sceneWarnings: string[];
  showDevDetails: boolean;
}): RightPanelHeroWarning | null {
  if (args.transitionError) {
    return {
      tone: "danger",
      title: "Runtime transition failed",
      detail: args.showDevDetails
        ? args.transitionError
        : "The world state could not transition cleanly. Retry the action.",
    };
  }
  if (args.combatStartError) {
    const bits = args.showDevDetails
      ? [
          args.combatStartError.message,
          args.combatStartError.code ? `code: ${args.combatStartError.code}` : null,
          args.combatStartError.requestId ? `requestId: ${args.combatStartError.requestId}` : null,
        ].filter((entry): entry is string => Boolean(entry))
      : [args.combatStartError.message];
    return {
      tone: "danger",
      title: "Combat start failed",
      detail: bits.join(" · "),
    };
  }
  if (args.dmContextError) {
    return {
      tone: "warn",
      title: "DM context unavailable",
      detail: "Rendering from runtime state only.",
    };
  }
  if (args.sceneWarnings.length > 0) {
    return {
      tone: "warn",
      title: "Runtime warning",
      detail: args.showDevDetails
        ? (args.sceneWarnings[0] ?? "Runtime warning")
        : "Some world updates need a refresh before the next move.",
    };
  }
  return null;
}

function toneTextClass(tone: NarrativeTone | undefined): string {
  if (tone === "good") return "text-emerald-200";
  if (tone === "warn") return "text-amber-200";
  if (tone === "danger") return "text-red-200";
  return "text-amber-100/85";
}

function inspectCardModel(args: {
  inspectTarget: NarrativeInspectTarget | null;
  inspectTitle: string;
}): NarrativeDockCardModel {
  if (!args.inspectTarget) {
    return {
      id: "inspect",
      title: args.inspectTitle,
      tone: "neutral",
      previewLines: ["No inspect target selected.", "Tap hotspot or board tile."],
      detailLines: ["Inspect-first is active. Select a hotspot or miss-click tile, then confirm an action."],
    };
  }
  return {
    id: "inspect",
    title: args.inspectTitle,
    tone: "good",
    badge: args.inspectTarget.interaction.source === "hotspot" ? "hotspot" : "probe",
    previewLines: [
      args.inspectTarget.title,
      args.inspectTarget.subtitle ?? `grid (${args.inspectTarget.interaction.x}, ${args.inspectTarget.interaction.y})`,
      `${args.inspectTarget.actions.length} actions`,
    ],
    detailLines: [],
  };
}

function actionsCardModel(args: {
  actions: MythicUiAction[];
  actionsTitle: string;
}): NarrativeDockCardModel {
  return {
    id: "actions",
    title: args.actionsTitle,
    tone: args.actions.length > 0 ? "neutral" : "warn",
    badge: args.actions.length > 0 ? `${args.actions.length}` : "idle",
    previewLines: args.actions.length === 0
      ? ["No contextual actions available."]
      : args.actions.slice(0, 3).map((action) => action.label),
    detailLines: args.actions.slice(0, 8).map((action) => action.label),
  };
}

export function NarrativeBoardPage(props: NarrativeBoardPageProps) {
  const [inspectTarget, setInspectTarget] = useState<NarrativeInspectTarget | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  useEffect(() => {
    setInspectTarget(null);
    setOpenCardId(null);
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

  const warning = useMemo(() => warningFromState({
    transitionError: props.transitionError,
    combatStartError: props.combatStartError,
    dmContextError: props.dmContextError,
    sceneWarnings: props.scene.warnings,
    showDevDetails: props.showDevDetails,
  }), [props.combatStartError, props.dmContextError, props.scene.warnings, props.showDevDetails, props.transitionError]);

  const combatCoreActions = useMemo(
    () => props.scene.mode === "combat" ? (props.scene.details as CombatSceneData).coreActions : [],
    [props.scene.details, props.scene.mode],
  );

  const dynamicCards = useMemo(() => {
    const inspectCard = inspectCardModel({ inspectTarget, inspectTitle: props.scene.dock.inspectTitle });
    const actionsCard = actionsCardModel({ actions: stripActions, actionsTitle: props.scene.dock.actionsTitle });
    const sceneCard = props.scene.cards.find((card) => card.id === "scene") ?? {
      id: "scene",
      title: "Scene",
      previewLines: [props.scene.title, props.scene.subtitle],
      detailLines: [],
    };
    const feedCard = props.scene.cards.find((card) => card.id === "feed") ?? {
      id: "feed",
      title: "Feed",
      previewLines: props.scene.feed.slice(0, 3).map((entry) => entry.label),
      detailLines: props.scene.feed.map((entry) => entry.label),
    };
    const moreCard = props.scene.cards.find((card) => card.id === "more") ?? null;

    return [
      inspectCard,
      actionsCard,
      sceneCard,
      feedCard,
      ...(moreCard ? [moreCard] : []),
    ];
  }, [inspectTarget, props.scene.cards, props.scene.dock.actionsTitle, props.scene.dock.inspectTitle, props.scene.feed, props.scene.subtitle, props.scene.title, stripActions]);

  const renderCardDetail = useCallback((card: NarrativeDockCardModel) => {
    if (card.id === "inspect") {
      if (!inspectTarget) {
        return (
          <div className="text-xs text-amber-100/75">
            Select a hotspot or probe an empty tile to inspect before confirming an action.
          </div>
        );
      }
      return (
        <BoardInspectCard
          target={inspectTarget}
          title={props.scene.dock.inspectTitle}
          isBusy={props.isBusy}
          showDevDetails={props.showDevDetails}
          onClose={() => {
            setInspectTarget(null);
            setOpenCardId(null);
          }}
          onAction={(action) => {
            props.onAction(action, "board_hotspot");
            setInspectTarget(null);
            setOpenCardId(null);
          }}
        />
      );
    }

    if (card.id === "actions") {
      return (
        <BoardActionStrip
          actions={stripActions}
          title={props.scene.dock.actionsTitle}
          sourceBySignature={stripActionSourceBySignature}
          isBusy={props.isBusy}
          showDevDetails={props.showDevDetails}
          onAction={(action, source) => {
            props.onAction(action, source);
            if (source === "board_hotspot") {
              setInspectTarget(null);
            }
            setOpenCardId(null);
          }}
        />
      );
    }

    if (card.id === "feed") {
      if (props.scene.feed.length === 0) {
        return <div className="text-xs text-amber-100/75">No recent board impact yet.</div>;
      }
      return (
        <div className="space-y-1.5 text-xs">
          {props.scene.feed.slice(0, 16).map((entry) => (
            <div key={`feed-detail-${entry.id}`} className="rounded border border-amber-200/20 bg-black/20 px-2 py-1.5">
              <div className={`font-medium ${toneTextClass(entry.tone)}`}>{entry.label}</div>
              {entry.detail ? <div className="mt-0.5 text-amber-100/70">{entry.detail}</div> : null}
              {props.showDevDetails ? (
                <div className="mt-0.5 text-[10px] text-amber-100/55">
                  {typeof entry.turnIndex === "number" ? `Turn ${entry.turnIndex}` : "Live"}
                  {entry.createdAt ? ` · ${new Date(entry.createdAt).toLocaleTimeString()}` : ""}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-1.5 text-xs text-amber-100/80">
        {(props.showDevDetails && card.devDetailLines && card.devDetailLines.length > 0
          ? card.devDetailLines
          : card.detailLines && card.detailLines.length > 0
            ? card.detailLines
          : card.previewLines
        ).map((line, index) => (
          <div key={`${card.id}-line-${index + 1}`} className="rounded border border-amber-200/20 bg-black/20 px-2 py-1">
            {line}
          </div>
        ))}

        {card.id === "more" && props.combatStartError ? (
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={props.onRetryCombatStart}>
              Retry combat start
            </Button>
          </div>
        ) : null}
      </div>
    );
  }, [inspectTarget, props.combatStartError, props.isBusy, props.onAction, props.onRetryCombatStart, props.scene.dock.actionsTitle, props.scene.dock.inspectTitle, props.scene.feed, props.showDevDetails, stripActionSourceBySignature, stripActions]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <RightPanelHero
        hero={props.scene.hero}
        warning={warning}
        isBusy={props.isBusy}
        isStateRefreshing={props.isStateRefreshing}
        character={props.characterHero}
        combatCoreActions={combatCoreActions}
        onCoreAction={props.onQuickCast}
        onOpenCharacterSheet={props.onOpenCharacterSheet}
      />

      {props.combatStartError ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <div className="mb-1 font-medium">Combat start needs retry</div>
          <Button size="sm" variant="secondary" onClick={props.onRetryCombatStart}>
            Retry combat start
          </Button>
        </div>
      ) : null}

      <div className="min-h-[280px] min-w-0 flex-1 rounded-lg border border-amber-200/20 bg-black/10 p-1">
        <NarrativeBoardViewport
          scene={props.scene}
          isActing={props.isBusy}
          onSelectHotspot={(hotspot, point) => {
            setInspectTarget(buildInspectTargetFromHotspot({ hotspot, x: point.x, y: point.y }));
            setOpenCardId("inspect");
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
            setOpenCardId("inspect");
          }}
          onQuickCast={props.onQuickCast}
        />
      </div>

      <BoardCardDock
        cards={dynamicCards}
        openCardId={openCardId}
        onOpenCardIdChange={setOpenCardId}
        renderDetail={renderCardDetail}
      />
    </div>
  );
}
