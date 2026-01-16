/**
 * Quest View page - displays quest details and objectives.
 * Reads from engine state, dispatches actions only.
 */

import { useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Scroll,
  ChevronLeft,
  Target,
  Gift,
  Clock,
  CheckCircle2,
  Circle,
  XCircle,
  AlertTriangle,
  MapPin,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import * as World from "@/engine/narrative/World";
import type { Quest, QuestObjective, NPC } from "@/engine/narrative/types";

const STATE_BADGES: Record<Quest["state"], { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  unknown: { variant: "outline", label: "Unknown" },
  available: { variant: "secondary", label: "Available" },
  active: { variant: "default", label: "Active" },
  completed: { variant: "outline", label: "Completed" },
  failed: { variant: "destructive", label: "Failed" },
  abandoned: { variant: "outline", label: "Abandoned" },
};

export default function QuestView() {
  const { campaignId, questId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const gameSession = useGameSessionContext();
  const world = gameSession.unifiedState?.world;
  const playerId = user?.id ?? "";

  // Get quest from engine
  const quest = world?.quests.get(questId ?? "") as Quest | undefined;
  
  // Get quest giver NPC
  const questGiver = useMemo(() => {
    if (!quest || !world) return undefined;
    return world.npcs.get(quest.giverId);
  }, [quest, world]);

  // Calculate quest progress
  const progress = useMemo(() => {
    if (!quest) return 0;
    const required = quest.objectives.filter(o => !o.optional);
    if (required.length === 0) return 0;
    
    const completed = required.filter(o => o.current >= o.required);
    return (completed.length / required.length) * 100;
  }, [quest]);

  // Handle quest actions
  const handleAbandon = useCallback(() => {
    if (!world || !quest) return;
    // Would dispatch abandon action
    toast.info("Quest abandoned");
    navigate(-1);
  }, [world, quest, navigate]);

  const handleComplete = useCallback(() => {
    if (!world || !quest || !playerId) return;
    const previousProgression = world.playerProgression.get(playerId);
    const previousItemsCount = world.items.size;
    const result = World.processWorldAction(world, {
      type: "complete_quest",
      entityId: playerId,
      questId: quest.id,
    });
    if (result.success) {
      const nextUnifiedState = gameSession.unifiedState
        ? {
            ...gameSession.unifiedState,
            world: result.world,
          }
        : null;
      if (nextUnifiedState) {
        gameSession.setUnifiedState(nextUnifiedState);
        void gameSession.autosaveNow(nextUnifiedState, gameSession.travelState ?? undefined);
      } else {
        gameSession.updateUnifiedState(prev => ({
          ...prev,
          world: result.world,
        }));
        gameSession.triggerAutosave();
      }
      const nextProgression = result.world.playerProgression.get(playerId);
      const nextItemsCount = result.world.items.size;
      console.info("[QuestView] Quest rewards applied", {
        questId: quest.id,
        xpBefore: previousProgression?.currentXp ?? 0,
        xpAfter: nextProgression?.currentXp ?? 0,
        itemsBefore: previousItemsCount,
        itemsAfter: nextItemsCount,
      });
      toast.success("Quest completed!");
    } else {
      toast.error(result.message);
    }
  }, [world, quest, playerId, gameSession]);

  if (gameSession.isLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading quest...</p>
      </div>
    );
  }

  if (!world || !quest) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
        <h1 className="text-xl font-display mb-2">Quest Not Found</h1>
        <p className="text-muted-foreground mb-4">This quest doesn't exist.</p>
        <Link to={`/game/${campaignId}`}>
          <Button>Return to Game</Button>
        </Link>
      </div>
    );
  }

  const stateConfig = STATE_BADGES[quest.state];
  const canComplete = quest.state === "active" && 
    quest.objectives.filter(o => !o.optional).every(o => o.current >= o.required);

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
                <Scroll className="w-4 h-4 text-primary" />
                <h1 className="font-display text-lg">{quest.title}</h1>
              </div>
              <p className="text-xs text-muted-foreground capitalize">
                {quest.importance} Quest
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant={stateConfig.variant}>
              {stateConfig.label}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Description */}
          <Card>
            <CardContent className="pt-6">
              <p className="text-lg leading-relaxed">{quest.description}</p>
              
              {quest.storyArc && (
                <Badge variant="outline" className="mt-4">
                  Story Arc: {quest.storyArc}
                </Badge>
              )}
            </CardContent>
          </Card>

          {/* Quest Giver */}
          {questGiver && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Quest Giver
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Link 
                  to={`/game/${campaignId}/npc/${questGiver.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-display">{questGiver.name}</div>
                    {questGiver.title && (
                      <div className="text-xs text-muted-foreground">{questGiver.title}</div>
                    )}
                  </div>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Progress */}
          {quest.state === "active" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Progress
                  </span>
                  <span className="text-muted-foreground">{Math.round(progress)}%</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Progress value={progress} className="h-2" />
                
                {quest.timeLimit && (
                  <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>
                      Time remaining: {quest.timeLimit - quest.turnsElapsed} turns
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Objectives */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="w-4 h-4" />
                Objectives
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {quest.objectives.filter(o => !o.hidden).map(objective => {
                  const isComplete = objective.current >= objective.required;
                  
                  return (
                    <motion.div
                      key={objective.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex items-start gap-3 p-3 rounded-lg border ${
                        isComplete 
                          ? "border-green-500/50 bg-green-500/5" 
                          : "border-border"
                      }`}
                    >
                      {isComplete ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={isComplete ? "line-through text-muted-foreground" : ""}>
                            {objective.description}
                          </p>
                          {objective.optional && (
                            <Badge variant="outline" className="text-xs">Optional</Badge>
                          )}
                        </div>
                        
                        {objective.required > 1 && (
                          <div className="flex items-center gap-2 mt-2">
                            <Progress 
                              value={(objective.current / objective.required) * 100} 
                              className="h-1.5 flex-1"
                            />
                            <span className="text-xs text-muted-foreground">
                              {objective.current}/{objective.required}
                            </span>
                          </div>
                        )}
                        
                        {objective.location && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            <span>Location marked on map</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Rewards */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Gift className="w-4 h-4" />
                Rewards
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-muted/50 text-center">
                  <div className="text-2xl font-display text-primary">{quest.rewards.xp}</div>
                  <div className="text-xs text-muted-foreground">Experience</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 text-center">
                  <div className="text-2xl font-display text-yellow-500">{quest.rewards.gold}</div>
                  <div className="text-xs text-muted-foreground">Gold</div>
                </div>
              </div>
              
              {quest.rewards.items && quest.rewards.items.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Items</div>
                    <div className="flex flex-wrap gap-2">
                      {quest.rewards.items.map((itemId, idx) => (
                        <Badge key={idx} variant="secondary">{itemId}</Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
              
              {quest.rewards.reputation && quest.rewards.reputation.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Reputation</div>
                    <div className="space-y-1">
                      {quest.rewards.reputation.map((rep, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span>{rep.factionId}</span>
                          <span className={rep.change > 0 ? "text-green-500" : "text-destructive"}>
                            {rep.change > 0 ? "+" : ""}{rep.change}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {quest.state === "active" && (
            <div className="flex items-center gap-3">
              <Button 
                className="flex-1" 
                disabled={!canComplete}
                onClick={handleComplete}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {canComplete ? "Turn In Quest" : "Objectives Incomplete"}
              </Button>
              
              <Button 
                variant="destructive" 
                onClick={handleAbandon}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Abandon
              </Button>
            </div>
          )}

          {/* Failure Consequences */}
          {quest.failureConsequences && (
            <Card className="border-destructive/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                  Failure Consequences
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Failing this quest will have consequences:</p>
                <ul className="list-disc list-inside mt-2">
                  {quest.failureConsequences.xp < 0 && (
                    <li>Lose {Math.abs(quest.failureConsequences.xp)} XP</li>
                  )}
                  {quest.failureConsequences.gold < 0 && (
                    <li>Lose {Math.abs(quest.failureConsequences.gold)} gold</li>
                  )}
                  {quest.failureConsequences.reputation?.map((rep, idx) => (
                    <li key={idx}>
                      {rep.change < 0 ? "Lose" : "Gain"} {Math.abs(rep.change)} reputation with {rep.factionId}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
