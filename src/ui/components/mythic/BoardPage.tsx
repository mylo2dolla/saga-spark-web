import { AnimatePresence, motion } from "framer-motion";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import type { MythicCombatSessionRow, MythicCombatantRow, MythicActionEventRow } from "@/hooks/useMythicCombatState";
import { Button } from "@/components/ui/button";
import { TownBoardScene } from "@/ui/components/mythic/board/TownBoardScene";
import { TravelBoardScene } from "@/ui/components/mythic/board/TravelBoardScene";
import { DungeonBoardScene } from "@/ui/components/mythic/board/DungeonBoardScene";
import { CombatBoardScene, type CombatBoardSkillLite } from "@/ui/components/mythic/board/CombatBoardScene";
import type { BoardInspectTarget } from "@/ui/components/mythic/board/inspectTypes";

const pageTurn = {
  initial: { rotateY: -90, opacity: 0, transformOrigin: "left center" },
  animate: { rotateY: 0, opacity: 1, transformOrigin: "left center" },
  exit: { rotateY: 90, opacity: 0, transformOrigin: "right center" },
};

interface BoardPageProps {
  boardType: "town" | "travel" | "dungeon" | "combat";
  modeKey: string;
  boardState: Record<string, unknown>;
  sceneHints: Record<string, unknown> | null;
  transitionError: string | null;
  combatStartError?: { message: string; code: string | null; requestId: string | null } | null;
  onRetryCombatStart?: () => void;
  combatSessionId: string | null;
  combatSession: MythicCombatSessionRow | null;
  combatants: MythicCombatantRow[];
  combatEvents: MythicActionEventRow[];
  activeTurnCombatantId: string | null;
  playerCombatantId: string | null;
  skills: CombatBoardSkillLite[];
  isActing: boolean;
  isTicking: boolean;
  canTick: boolean;
  bossPhaseLabel: string | null;
  onTickTurn: () => Promise<void>;
  onUseSkill: (args: {
    actorCombatantId: string;
    skillId: string;
    target: { kind: "self" } | { kind: "combatant"; combatant_id: string } | { kind: "tile"; x: number; y: number };
  }) => Promise<void>;
  onAction: (action: MythicUiAction) => void;
  onInspect: (target: BoardInspectTarget) => void;
  onFocusCombatant?: (combatantId: string | null) => void;
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function BoardPage(props: BoardPageProps) {
  return (
    <>
      <div className="border-b border-border/40 px-4 py-3">
        <div className="font-display text-lg">{toTitleCase(props.boardType)} Board</div>
        <div className="text-xs text-muted-foreground">Animated board state synchronized to Mythic DB truth.</div>
      </div>

      <div className="min-h-0 p-3">
        {props.combatStartError ? (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <div className="font-medium text-foreground">Failed to initiate combat</div>
            <div className="mt-1">{props.combatStartError.message}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {props.combatStartError.code ? <span>code: {props.combatStartError.code}</span> : null}
              {props.combatStartError.requestId ? <span>requestId: {props.combatStartError.requestId}</span> : null}
            </div>
            {props.onRetryCombatStart ? (
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => props.onRetryCombatStart?.()}>
                  Retry combat start
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <AnimatePresence mode="wait">
          <motion.div
            key={props.modeKey}
            variants={pageTurn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="min-h-[620px]"
          >
            {props.boardType === "town" ? (
              <TownBoardScene boardState={props.boardState} scene={props.sceneHints} onInspect={props.onInspect} />
            ) : null}
            {props.boardType === "travel" ? (
              <TravelBoardScene boardState={props.boardState} scene={props.sceneHints} onAction={props.onAction} />
            ) : null}
            {props.boardType === "dungeon" ? (
              <DungeonBoardScene boardState={props.boardState} scene={props.sceneHints} onAction={props.onAction} />
            ) : null}
            {props.boardType === "combat" ? (
              props.combatSessionId ? (
                <CombatBoardScene
                  combatSession={props.combatSession}
                  combatants={props.combatants}
                  events={props.combatEvents}
                  activeTurnCombatantId={props.activeTurnCombatantId}
                  playerCombatantId={props.playerCombatantId}
                  skills={props.skills}
                  isActing={props.isActing}
                  isTicking={props.isTicking}
                  canTick={props.canTick}
                  bossPhaseLabel={props.bossPhaseLabel}
                  onTickTurn={props.onTickTurn}
                  onUseSkill={props.onUseSkill}
                  onFocusCombatant={props.onFocusCombatant}
                />
              ) : (
                <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-border bg-background/30 text-sm text-muted-foreground">
                  No active combat session.
                </div>
              )
            ) : null}
          </motion.div>
        </AnimatePresence>

        {props.transitionError ? (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.transitionError}
          </div>
        ) : null}
      </div>
    </>
  );
}
