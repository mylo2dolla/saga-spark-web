/**
 * Combat View page - dedicated combat screen.
 * Reads from engine state, dispatches actions only.
 */

import { useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Swords,
  ChevronLeft,
  Flag,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useUnifiedEngineOptional } from "@/contexts/UnifiedEngineContext";
import { CombatArena } from "@/components/combat";
import type { GameEvent, Vec2 } from "@/engine";

export default function CombatView() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const engine = useUnifiedEngineOptional();

  // Redirect if not in combat
  useEffect(() => {
    if (engine && !engine.isInCombat) {
      // Check if combat should start
      // For now, just show a message
    }
  }, [engine]);

  // Get combat entities
  const combatEntities = useMemo(() => {
    if (!engine) return [];
    
    return engine.entities
      .filter(e => e.faction === "player" || e.faction === "enemy")
      .map(e => ({
        id: e.id,
        name: e.name,
        faction: e.faction as "player" | "enemy",
        position: e.position,
        hp: e.hp,
        maxHp: e.maxHp,
        ac: e.ac,
        initiative: e.initiative,
      }));
  }, [engine]);

  // Handle combat events
  const handleCombatEvent = useCallback((event: GameEvent) => {
    console.log("[CombatView] Event:", event);
    
    if (event.type === "entity_died") {
      toast.error(event.description);
    }
    
    if (event.type === "combat_ended") {
      toast.success(event.description);
      // Return to previous location
      if (engine?.travelState?.currentLocationId) {
        navigate(`/game/${campaignId}/location/${engine.travelState.currentLocationId}`);
      } else {
        navigate(`/game/${campaignId}`);
      }
    }
  }, [engine, campaignId, navigate]);

  // Handle flee
  const handleFlee = useCallback(() => {
    if (!engine) return;
    
    // 50% chance to flee
    if (Math.random() > 0.5) {
      engine.finishCombat();
      toast.success("You escaped!");
      navigate(`/game/${campaignId}`);
    } else {
      toast.error("Failed to escape!");
    }
  }, [engine, campaignId, navigate]);

  // Get player entity ID (first player entity)
  const playerId = useMemo(() => {
    const player = engine?.entities.find(e => e.faction === "player");
    return player?.id;
  }, [engine]);

  if (!engine) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
        <h1 className="text-xl font-display mb-2">Combat Not Available</h1>
        <p className="text-muted-foreground mb-4">No active combat session.</p>
        <Link to={`/game/${campaignId}`}>
          <Button>Return to Game</Button>
        </Link>
      </div>
    );
  }

  if (!engine.isInCombat) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <Swords className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-xl font-display mb-2">No Active Combat</h1>
        <p className="text-muted-foreground mb-4">
          Start an encounter to enter combat.
        </p>
        <div className="flex gap-3">
          <Link to={`/game/${campaignId}`}>
            <Button variant="outline">Return to Game</Button>
          </Link>
          <Button onClick={() => engine.beginCombat()}>
            <Swords className="w-4 h-4 mr-2" />
            Start Combat
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="glass-dark border-b border-border flex-shrink-0">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={`/game/${campaignId}`}>
              <Button variant="ghost" size="sm">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Exit Combat
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Swords className="w-5 h-5 text-destructive" />
              <h1 className="font-display text-lg">Combat</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant="destructive">
              Round {engine.roundNumber}
            </Badge>
            {engine.currentTurn && (
              <Badge variant="secondary">
                {engine.currentTurn.name}'s Turn
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={handleFlee}>
              <Flag className="w-4 h-4 mr-1" />
              Flee
            </Button>
          </div>
        </div>
      </header>

      {/* Combat Arena */}
      <div className="flex-1 overflow-hidden">
        <CombatArena
          initialEntities={combatEntities}
          myEntityId={playerId}
          rows={engine.board.rows}
          cols={engine.board.cols}
          onEvent={handleCombatEvent}
        />
      </div>
    </div>
  );
}
