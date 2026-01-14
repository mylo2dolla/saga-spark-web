/**
 * Main game loop component that wires together the unified engine with UI.
 * Handles the full gameplay cycle: exploration, dialog, combat, quests.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Swords, 
  MessageCircle, 
  Package, 
  Scroll, 
  Shield, 
  Save,
  Settings,
  Map,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useUnifiedEngineContext } from "@/contexts/UnifiedEngineContext";
import { 
  QuestLog, 
  NPCDialog, 
  InventoryPanel, 
  StatusEffects, 
  ProgressionPanel 
} from "@/components/narrative";
import { CombatArena } from "@/components/combat";
import { useGamePersistence } from "@/hooks/useGamePersistence";
import { useWorldGenerator } from "@/hooks/useWorldGenerator";
import { processAITurns, generateNarrativeAction } from "@/engine/AI";
import { toast } from "sonner";
import type { GameEvent, Faction } from "@/engine";
import type { WorldEvent, NPC, EnhancedStatus, Inventory, Equipment, CharacterProgression } from "@/engine/narrative/types";

interface GameLoopProps {
  campaignId: string;
  userId: string;
  playerId: string;
}

export function GameLoop({ campaignId, userId, playerId }: GameLoopProps) {
  const engine = useUnifiedEngineContext();
  const persistence = useGamePersistence({ campaignId, userId });
  const worldGen = useWorldGenerator();
  
  const [activeTab, setActiveTab] = useState<"explore" | "combat" | "inventory" | "quests">("explore");
  const [selectedNPC, setSelectedNPC] = useState<NPC | null>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [playtimeSeconds, setPlaytimeSeconds] = useState(0);
  const autosaveRef = useRef<string | null>(null);
  const playtimeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track playtime
  useEffect(() => {
    playtimeIntervalRef.current = setInterval(() => {
      setPlaytimeSeconds(prev => prev + 1);
    }, 1000);

    return () => {
      if (playtimeIntervalRef.current) {
        clearInterval(playtimeIntervalRef.current);
      }
    };
  }, []);

  // Autosave every 2 minutes
  useEffect(() => {
    const autosaveInterval = setInterval(async () => {
      if (autosaveRef.current) {
        await persistence.updateSave(autosaveRef.current, engine.unified, playtimeSeconds);
      } else {
        const saveId = await persistence.saveGame(engine.unified, "Autosave", playtimeSeconds);
        if (saveId) autosaveRef.current = saveId;
      }
    }, 120000);

    return () => clearInterval(autosaveInterval);
  }, [engine.unified, persistence, playtimeSeconds]);

  // Handle engine events
  const handleGameEvent = useCallback((event: GameEvent) => {
    console.log("[GameLoop] Engine event:", event);
    
    // Handle death events
    if (event.type === "entity_died") {
      toast.error(event.description);
    }
    
    // Handle combat end
    if (event.type === "combat_ended") {
      toast.success("Combat ended!");
      setActiveTab("explore");
    }
  }, []);

  const handleWorldEvent = useCallback((event: WorldEvent) => {
    console.log("[GameLoop] World event:", event);
    
    // Handle quest events
    if (event.type === "quest_started") {
      toast.info(`Quest started: ${event.description}`);
    }
    if (event.type === "quest_completed") {
      toast.success(`Quest completed: ${event.description}`);
    }
    if (event.type === "level_up") {
      toast.success(event.description);
    }
    if (event.type === "xp_gained") {
      toast.info(event.description);
    }
  }, []);

  // Process AI turns when it's an enemy's turn
  useEffect(() => {
    if (!engine.isInCombat) return;
    
    const currentTurn = engine.currentTurn;
    if (!currentTurn || currentTurn.faction === "player") return;
    
    // Process AI turn
    const processAI = async () => {
      setIsProcessingAI(true);
      
      // Small delay for visual feedback
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { actions, decisions } = processAITurns(engine.ctx.state);
      
      for (const decision of decisions) {
        toast.info(decision.reasoning);
      }
      
      for (const action of actions) {
        engine.dispatch(action);
      }
      
      // End the AI's turn
      engine.dispatch({ type: "end_turn", entityId: currentTurn.id });
      
      setIsProcessingAI(false);
    };
    
    processAI();
  }, [engine.currentTurn?.id, engine.isInCombat]);

  // Talk to an NPC
  const handleTalkToNPC = useCallback((npc: NPC) => {
    setSelectedNPC(npc);
    engine.talkToNPC(playerId, npc.id);
  }, [engine, playerId]);

  // Accept a quest from NPC
  const handleAcceptQuest = useCallback((questId: string) => {
    engine.acceptQuest(playerId, questId);
    toast.success("Quest accepted!");
  }, [engine, playerId]);

  // Enter combat mode
  const handleEnterCombat = useCallback(() => {
    engine.beginCombat();
    setActiveTab("combat");
    toast.info("Combat begins!");
  }, [engine]);

  // Exit combat mode
  const handleExitCombat = useCallback(() => {
    engine.finishCombat();
    setActiveTab("explore");
  }, [engine]);

  // Quick save
  const handleQuickSave = useCallback(async () => {
    await persistence.saveGame(engine.unified, "Quicksave", playtimeSeconds);
  }, [engine.unified, persistence, playtimeSeconds]);

  // Get player progression and data
  const playerProgression = engine.getProgression(playerId);
  
  // Get player entity statuses (empty array if not found)
  const playerEntity = engine.entities.find(e => e.id === playerId);
  const playerStatuses: readonly EnhancedStatus[] = playerEntity?.statusEffects?.map(s => ({
    id: s.id,
    name: s.name,
    description: `Duration: ${s.duration} turns`,
    category: "neutral" as const,
    source: "unknown",
    duration: s.duration,
    stacks: 1,
    maxStacks: 1,
    stackBehavior: "refresh" as const,
    statModifiers: {},
    triggers: [],
  })) ?? [];

  // Get inventory and equipment (mock for now - would come from world state)
  const playerInventory: Inventory = { slots: [], maxSlots: 20, gold: 100 };
  const playerEquipment: Equipment = {};

  // Filter entities for combat (only player and enemy factions)
  const combatEntities = engine.entities
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

  return (
    <div className="h-full flex flex-col">
      {/* Top bar with quick actions */}
      <div className="flex-shrink-0 border-b border-border bg-card/50 p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusEffects statuses={playerStatuses} compact />
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleQuickSave} disabled={persistence.isSaving}>
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
            <Button variant="ghost" size="sm">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main game area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Main content based on tab */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col">
            <TabsList className="mx-4 mt-2">
              <TabsTrigger value="explore" className="gap-2">
                <Map className="w-4 h-4" />
                Explore
              </TabsTrigger>
              <TabsTrigger value="combat" className="gap-2" disabled={!engine.isInCombat}>
                <Swords className="w-4 h-4" />
                Combat
              </TabsTrigger>
              <TabsTrigger value="inventory" className="gap-2">
                <Package className="w-4 h-4" />
                Inventory
              </TabsTrigger>
              <TabsTrigger value="quests" className="gap-2">
                <Scroll className="w-4 h-4" />
                Quests
              </TabsTrigger>
            </TabsList>

            <TabsContent value="explore" className="flex-1 p-4 overflow-auto">
              {/* Exploration view with NPCs */}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {engine.npcs.map(npc => (
                  <motion.div
                    key={npc.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="card-parchment p-4 rounded-lg cursor-pointer hover:border-primary/50"
                    onClick={() => handleTalkToNPC(npc)}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <MessageCircle className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-display">{npc.name}</h3>
                        {npc.title && (
                          <p className="text-xs text-muted-foreground">{npc.title}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {npc.personality.slice(0, 3).map(trait => (
                        <span key={trait} className="text-xs px-2 py-0.5 bg-secondary rounded">
                          {trait}
                        </span>
                      ))}
                    </div>
                    {npc.canTrade && (
                      <span className="text-xs text-primary mt-2 block">Can trade</span>
                    )}
                  </motion.div>
                ))}
                
                {engine.npcs.length === 0 && (
                  <div className="col-span-full text-center py-8 text-muted-foreground">
                    <p>No NPCs in this area yet.</p>
                    <p className="text-sm">Explore to discover new characters!</p>
                  </div>
                )}
              </div>
              
              {/* Enter combat button */}
              {!engine.isInCombat && (
                <div className="mt-6 text-center">
                  <Button onClick={handleEnterCombat} variant="destructive" className="gap-2">
                    <Swords className="w-4 h-4" />
                    Start Combat Encounter
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="combat" className="flex-1 overflow-hidden">
              {engine.isInCombat && (
                <CombatArena
                  initialEntities={combatEntities}
                  myEntityId={playerId}
                  rows={engine.board.rows}
                  cols={engine.board.cols}
                  onEvent={handleGameEvent}
                />
              )}
            </TabsContent>

            <TabsContent value="inventory" className="flex-1 p-4 overflow-auto">
              <InventoryPanel 
                inventory={playerInventory}
                equipment={playerEquipment}
                items={engine.items}
              />
            </TabsContent>

            <TabsContent value="quests" className="flex-1 p-4 overflow-auto">
              <QuestLog playerId={playerId} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right panel: Progression and active effects */}
        <aside className="w-72 border-l border-border bg-card/30 hidden lg:flex flex-col p-4">
          {playerProgression ? (
            <ProgressionPanel progression={playerProgression} />
          ) : (
            <div className="text-center text-muted-foreground py-8">
              <p>No progression data</p>
            </div>
          )}
        </aside>
      </div>

      {/* NPC Dialog Modal */}
      <AnimatePresence>
        {selectedNPC && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80"
            onClick={() => setSelectedNPC(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <NPCDialog
                npc={selectedNPC}
                playerId={playerId}
                onClose={() => setSelectedNPC(null)}
                onStartQuest={handleAcceptQuest}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Processing Overlay */}
      <AnimatePresence>
        {isProcessingAI && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/50 flex items-center justify-center z-50"
          >
            <div className="bg-card p-6 rounded-lg shadow-lg text-center">
              <Shield className="w-12 h-12 text-destructive mx-auto mb-4 animate-pulse" />
              <p className="font-display text-lg">Enemy Turn</p>
              <p className="text-muted-foreground text-sm">Processing...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
