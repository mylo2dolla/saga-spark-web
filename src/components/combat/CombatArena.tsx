/**
 * CombatArena - A standalone combat view driven purely by the engine.
 * This component wraps the engine provider and renders the grid.
 */

import { useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Swords, Play, Square, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EngineProvider, useEngine } from "@/contexts/EngineContext";
import { EngineGrid } from "./EngineGrid";
import { EngineTurnTracker } from "./EngineTurnTracker";
import type { GameEvent, Entity, Vec2 } from "@/engine";
import { gridToWorld } from "@/engine";
import { toast } from "sonner";

interface CombatArenaInnerProps {
  myEntityId?: string;
  onEvent?: (event: GameEvent) => void;
}

function CombatArenaInner({ myEntityId, onEvent }: CombatArenaInnerProps) {
  const { 
    entities, 
    currentTurn, 
    isInCombat, 
    roundNumber,
    beginCombat, 
    finishCombat, 
    dispatch,
    getValidMoves,
    board,
  } = useEngine();

  // Handle cell click - dispatch move action
  const handleCellClick = useCallback((gridPos: { row: number; col: number }) => {
    if (!isInCombat || !currentTurn) return;
    
    // Only allow current turn entity to move
    if (myEntityId && currentTurn.id !== myEntityId) {
      toast.error("Not your turn!");
      return;
    }

    const targetPos = gridToWorld(gridPos, board.cellSize);
    dispatch({
      type: "move",
      entityId: currentTurn.id,
      targetPosition: targetPos,
    });
  }, [isInCombat, currentTurn, myEntityId, dispatch, board.cellSize]);

  // Handle entity click - attack if enemy
  const handleEntityClick = useCallback((entity: Entity) => {
    if (!isInCombat || !currentTurn) return;
    
    if (myEntityId && currentTurn.id !== myEntityId) {
      toast.error("Not your turn!");
      return;
    }

    // Attack if enemy
    if (entity.faction !== currentTurn.faction && entity.isAlive) {
      dispatch({
        type: "attack",
        attackerId: currentTurn.id,
        targetId: entity.id,
        damageRoll: "1d8+2",
      });
    }
  }, [isInCombat, currentTurn, myEntityId, dispatch]);

  // Handle end turn
  const handleEndTurn = useCallback(() => {
    if (!currentTurn) return;
    dispatch({
      type: "end_turn",
      entityId: currentTurn.id,
    });
  }, [currentTurn, dispatch]);

  const aliveAllies = entities.filter(e => e.faction === "player" && e.isAlive);
  const aliveEnemies = entities.filter(e => e.faction === "enemy" && e.isAlive);

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      {/* Combat Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Swords className="w-5 h-5 text-primary" />
            <span className="font-display text-lg">Combat Arena</span>
          </div>
          <div className="text-sm text-muted-foreground">
            {aliveAllies.length} allies vs {aliveEnemies.length} enemies
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {!isInCombat ? (
            <Button onClick={beginCombat} variant="default" size="sm" className="gap-2">
              <Play className="w-4 h-4" />
              Start Combat
            </Button>
          ) : (
            <>
              <Button 
                onClick={handleEndTurn} 
                variant="outline" 
                size="sm" 
                className="gap-2"
                disabled={myEntityId ? currentTurn?.id !== myEntityId : false}
              >
                <SkipForward className="w-4 h-4" />
                End Turn
              </Button>
              <Button onClick={finishCombat} variant="destructive" size="sm" className="gap-2">
                <Square className="w-4 h-4" />
                End Combat
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Turn Tracker */}
      {isInCombat && (
        <EngineTurnTracker 
          myEntityId={myEntityId} 
          onEndTurn={handleEndTurn}
          onSkipTurn={handleEndTurn}
        />
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <EngineGrid
          cellSize={48}
          selectedEntityId={currentTurn?.id}
          onCellClick={handleCellClick}
          onEntityClick={handleEntityClick}
        />
      </div>

      {/* Entity Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {entities.filter(e => e.isAlive).slice(0, 4).map(entity => (
          <motion.div
            key={entity.id}
            className={`p-3 rounded-lg border ${
              entity.id === currentTurn?.id 
                ? "border-primary bg-primary/10" 
                : "border-border bg-card/50"
            }`}
            animate={{ scale: entity.id === currentTurn?.id ? 1.02 : 1 }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm truncate">{entity.name}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                entity.faction === "player" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"
              }`}>
                {entity.faction}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                className={`h-full ${
                  entity.hp / entity.maxHp > 0.5 ? "bg-green-500" : 
                  entity.hp / entity.maxHp > 0.25 ? "bg-yellow-500" : "bg-red-500"
                }`}
                animate={{ width: `${(entity.hp / entity.maxHp) * 100}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              HP: {entity.hp}/{entity.maxHp} | AC: {entity.ac}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

interface CombatArenaProps {
  initialEntities?: Array<{
    id?: string;
    name: string;
    faction: "player" | "enemy";
    position: Vec2;
    hp: number;
    maxHp?: number;
    ac?: number;
    initiative?: number;
  }>;
  myEntityId?: string;
  rows?: number;
  cols?: number;
  onEvent?: (event: GameEvent) => void;
}

export function CombatArena({
  initialEntities = [],
  myEntityId,
  rows = 10,
  cols = 12,
  onEvent,
}: CombatArenaProps) {
  return (
    <EngineProvider 
      options={{ rows, cols, onEvent }}
    >
      <CombatArenaWithEntities 
        initialEntities={initialEntities} 
        myEntityId={myEntityId}
        onEvent={onEvent}
      />
    </EngineProvider>
  );
}

// Inner component that can use the engine hook
function CombatArenaWithEntities({ 
  initialEntities, 
  myEntityId,
  onEvent,
}: { 
  initialEntities: CombatArenaProps["initialEntities"]; 
  myEntityId?: string;
  onEvent?: (event: GameEvent) => void;
}) {
  const { spawn } = useEngine();

  // Spawn initial entities
  useEffect(() => {
    if (!initialEntities) return;
    initialEntities.forEach(e => spawn(e));
  }, []); // Only run once on mount

  return <CombatArenaInner myEntityId={myEntityId} onEvent={onEvent} />;
}

export default CombatArena;
