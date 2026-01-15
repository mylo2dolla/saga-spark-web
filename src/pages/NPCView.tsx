/**
 * NPC View page - displays NPC details and dialog.
 * Reads from engine state, dispatches actions only.
 */

import { useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  ChevronLeft,
  MessageCircle,
  Store,
  Scroll,
  Heart,
  Swords,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import { NPCTradePanel } from "@/components/game/NPCTradePanel";
import * as World from "@/engine/narrative/World";
import * as NPCModule from "@/engine/narrative/NPC";
import { createInventory } from "@/engine/narrative/Item";
import type { NPC, Quest, Disposition } from "@/engine/narrative/types";

const DISPOSITION_COLORS: Record<Disposition, string> = {
  hostile: "text-destructive",
  unfriendly: "text-orange-500",
  neutral: "text-muted-foreground",
  friendly: "text-green-500",
  allied: "text-primary",
};

export default function NPCView() {
  const { campaignId, npcId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const gameSession = useGameSessionContext();
  const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
  const [showTrade, setShowTrade] = useState(false);

  const world = gameSession.unifiedState?.world;
  const playerId = user?.id ?? "";

  // Get NPC from world state
  const npc = world?.npcs.get(npcId ?? "") as NPC | undefined;
  
  // Get player relationship with this NPC
  const playerRelationship = useMemo(() => {
    if (!npc) return undefined;
    // Would need player ID - for now show first relationship
    return npc.relationships[0];
  }, [npc]);

  // Get quests offered by this NPC
  const offeredQuests = useMemo(() => {
    if (!npc || !world) return [];
    return npc.questsOffered
      .map(questId => world.quests.get(questId))
      .filter((q): q is Quest => q !== undefined && q.state === "available");
  }, [npc, world]);

  // Get active quests from this NPC
  const activeQuests = useMemo(() => {
    if (!npc || !world) return [];
    return npc.questsOffered
      .map(questId => world.quests.get(questId))
      .filter((q): q is Quest => q !== undefined && q.state === "active");
  }, [npc, world]);

  // Handle talking to NPC
  const handleTalk = useCallback(() => {
    if (!npc || !world || !playerId) return;
    
    // Start dialog
    if (npc.dialogue.length > 0) {
      setDialogNodeId(npc.dialogue[0].id);
    }
    
    const updatedNPC = NPCModule.addMemory(
      npc,
      `Spoke with ${playerId}`,
      [playerId, "conversation"],
      1
    );
    gameSession.updateUnifiedState(prev => ({
      ...prev,
      world: World.updateNPC(prev.world, updatedNPC),
    }));
    gameSession.triggerAutosave();
    toast.info(`Speaking with ${npc.name}...`);
  }, [npc, world, playerId, gameSession]);

  // Handle accepting a quest
  const handleAcceptQuest = useCallback((questId: string) => {
    if (!world || !playerId) return;
    const result = World.processWorldAction(world, {
      type: "accept_quest",
      entityId: playerId,
      questId,
    });
    if (result.success) {
      gameSession.updateUnifiedState(prev => ({
        ...prev,
        world: result.world,
      }));
      gameSession.triggerAutosave();
      toast.success("Quest accepted!");
    } else {
      toast.error(result.message);
    }
  }, [world, playerId, gameSession]);

  // Handle dialog response
  const handleDialogResponse = useCallback((nextNodeId?: string) => {
    if (nextNodeId) {
      setDialogNodeId(nextNodeId);
    } else {
      setDialogNodeId(null);
    }
  }, []);

  // Get current dialog node
  const currentDialogNode = useMemo(() => {
    if (!npc || !dialogNodeId) return null;
    return npc.dialogue.find(d => d.id === dialogNodeId);
  }, [npc, dialogNodeId]);

  if (gameSession.isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading NPC...</p>
      </div>
    );
  }

  if (!world || !npc) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
        <h1 className="text-xl font-display mb-2">NPC Not Found</h1>
        <p className="text-muted-foreground mb-4">This character doesn't exist.</p>
        <Link to={`/game/${campaignId}`}>
          <Button>Return to Game</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="glass-dark border-b border-border flex-shrink-0">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                <h1 className="font-display text-lg">{npc.name}</h1>
              </div>
              {npc.title && (
                <p className="text-xs text-muted-foreground">{npc.title}</p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {npc.canTrade && (
              <Badge variant="secondary">
                <Store className="w-3 h-3 mr-1" />
                Merchant
              </Badge>
            )}
            {npc.isEssential && (
              <Badge variant="outline">Essential</Badge>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: NPC Info */}
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Dialog Section */}
            <AnimatePresence mode="wait">
              {currentDialogNode ? (
                <motion.div
                  key="dialog"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <Card className="border-primary/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <MessageCircle className="w-4 h-4" />
                        {npc.name} says...
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-lg italic mb-4">"{currentDialogNode.text}"</p>
                      
                      {currentDialogNode.speakerMood && (
                        <p className="text-sm text-muted-foreground mb-4">
                          *{currentDialogNode.speakerMood}*
                        </p>
                      )}
                      
                      <div className="space-y-2">
                        {currentDialogNode.responses.map((response, idx) => (
                          <Button
                            key={idx}
                            variant="outline"
                            className="w-full justify-start text-left h-auto py-3"
                            onClick={() => handleDialogResponse(response.nextNodeId)}
                          >
                            {response.text}
                          </Button>
                        ))}
                        
                        {currentDialogNode.responses.length === 0 && (
                          <Button onClick={() => setDialogNodeId(null)}>
                            End Conversation
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (
                <motion.div
                  key="no-dialog"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {/* Personality */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Personality</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {npc.personality.map(trait => (
                          <Badge key={trait} variant="secondary" className="capitalize">
                            {trait}
                          </Badge>
                        ))}
                        {npc.personality.length === 0 && (
                          <span className="text-muted-foreground text-sm">Unknown</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Relationship */}
            {playerRelationship && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Heart className="w-4 h-4" />
                    Relationship
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-display">{playerRelationship.trust}</div>
                      <div className="text-xs text-muted-foreground">Trust</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-display">{playerRelationship.respect}</div>
                      <div className="text-xs text-muted-foreground">Respect</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-display">{playerRelationship.fear}</div>
                      <div className="text-xs text-muted-foreground">Fear</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-sm">Disposition:</span>
                    <Badge className={DISPOSITION_COLORS[playerRelationship.disposition]}>
                      {playerRelationship.disposition}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Available Quests */}
            {offeredQuests.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Scroll className="w-4 h-4" />
                    Available Quests
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {offeredQuests.map(quest => (
                      <div
                        key={quest.id}
                        className="p-3 rounded-lg border border-border bg-card"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-display">{quest.title}</span>
                          <Badge variant={quest.importance === "main" ? "default" : "secondary"}>
                            {quest.importance}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          {quest.briefDescription}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-primary">
                            Reward: {quest.rewards.xp} XP, {quest.rewards.gold} gold
                          </span>
                          <Button 
                            size="sm" 
                            onClick={() => handleAcceptQuest(quest.id)}
                          >
                            Accept Quest
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Active Quests */}
            {activeQuests.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Scroll className="w-4 h-4" />
                    Your Active Quests
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {activeQuests.map(quest => (
                      <Link
                        key={quest.id}
                        to={`/game/${campaignId}/quest/${quest.id}`}
                        className="block p-3 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display">{quest.title}</span>
                          <Badge variant="outline">In Progress</Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <aside className="w-72 border-l border-border bg-card/30 p-4 hidden lg:flex flex-col">
          <h2 className="font-display text-sm uppercase mb-4">Actions</h2>
          
          <div className="space-y-3">
            <Button 
              className="w-full justify-start gap-2" 
              onClick={handleTalk}
              disabled={npc.dialogue.length === 0}
            >
              <MessageCircle className="w-4 h-4" />
              Talk
            </Button>
            
            {npc.canTrade && (
              <Button 
                variant="secondary" 
                className="w-full justify-start gap-2"
                onClick={() => setShowTrade(true)}
              >
                <Store className="w-4 h-4" />
                Trade
              </Button>
            )}
            
            {!npc.isEssential && (
              <Separator />
            )}
            
            {!npc.isEssential && (
              <Button 
                variant="destructive" 
                className="w-full justify-start gap-2"
                onClick={() => {
                  toast.error("Combat with NPCs not yet implemented");
                }}
              >
                <Swords className="w-4 h-4" />
                Attack
              </Button>
            )}
          </div>
          
          {/* NPC Memories */}
          {npc.memories.length > 0 && (
            <>
              <Separator className="my-4" />
              <h3 className="font-display text-xs uppercase mb-2 text-muted-foreground">
                Recent Memories
              </h3>
              <ScrollArea className="flex-1">
                <div className="space-y-2">
                  {npc.memories.slice(0, 10).map((memory, idx) => (
                    <div
                      key={idx}
                      className="text-xs p-2 rounded bg-muted/50"
                    >
                      <p className="text-muted-foreground">{memory.event}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {memory.emotionalImpact > 0 ? (
                          <ThumbsUp className="w-3 h-3 text-green-500" />
                        ) : memory.emotionalImpact < 0 ? (
                          <ThumbsDown className="w-3 h-3 text-destructive" />
                        ) : null}
                        <span className="text-muted-foreground">
                          {new Date(memory.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </aside>
      </div>

      <AnimatePresence>
        {showTrade && world && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
            onClick={() => setShowTrade(false)}
          >
            <motion.div onClick={(event) => event.stopPropagation()}>
              <NPCTradePanel
                npc={npc}
                playerInventory={
                  world.playerProgression.get(playerId)?.inventory ?? createInventory()
                }
                items={world.items}
                onTrade={(updatedNpc, updatedPlayerInventory) => {
                  gameSession.updateUnifiedState(prev => {
                    let updatedWorld = World.updateNPC(prev.world, updatedNpc);
                    if (playerId) {
                      if (!updatedWorld.playerProgression.has(playerId)) {
                        updatedWorld = World.initPlayerProgression(updatedWorld, playerId);
                      }
                      const progression = updatedWorld.playerProgression.get(playerId);
                      if (progression) {
                        updatedWorld = World.updatePlayerProgression(updatedWorld, {
                          ...progression,
                          inventory: updatedPlayerInventory,
                        });
                      }
                    }
                    return {
                      ...prev,
                      world: updatedWorld,
                    };
                  });
                  gameSession.triggerAutosave();
                }}
                onClose={() => setShowTrade(false)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
