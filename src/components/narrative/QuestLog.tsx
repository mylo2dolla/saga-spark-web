/**
 * Quest Log UI component - displays active, available, and completed quests.
 */

import { useState } from "react";
import { useUnifiedEngineContext } from "@/contexts/UnifiedEngineContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Scroll, CheckCircle2, Clock, AlertTriangle, Star } from "lucide-react";
import type { Quest } from "@/engine/narrative/types";
import { getProgress, getRemainingTime, getActiveObjectives } from "@/engine/narrative/Quest";

interface QuestLogProps {
  playerId: string;
  onAcceptQuest?: (questId: string) => void;
  onViewQuest?: (quest: Quest) => void;
}

export function QuestLog({ playerId, onAcceptQuest, onViewQuest }: QuestLogProps) {
  const { activeQuests, availableQuests, completedQuests, acceptQuest } = useUnifiedEngineContext();
  const [selectedTab, setSelectedTab] = useState("active");

  const handleAccept = (questId: string) => {
    acceptQuest(playerId, questId);
    onAcceptQuest?.(questId);
  };

  return (
    <Card className="w-full max-w-md bg-card/95 backdrop-blur border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scroll className="w-5 h-5 text-primary" />
          Quest Log
        </CardTitle>
        <CardDescription>Track your adventures</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="grid grid-cols-3 mb-4">
            <TabsTrigger value="active" className="text-xs">
              Active ({activeQuests.length})
            </TabsTrigger>
            <TabsTrigger value="available" className="text-xs">
              Available ({availableQuests.length})
            </TabsTrigger>
            <TabsTrigger value="completed" className="text-xs">
              Done ({completedQuests.length})
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-64">
            <TabsContent value="active" className="space-y-3 mt-0">
              {activeQuests.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No active quests
                </p>
              ) : (
                activeQuests.map(quest => (
                  <QuestCard 
                    key={quest.id} 
                    quest={quest} 
                    onClick={() => onViewQuest?.(quest)}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="available" className="space-y-3 mt-0">
              {availableQuests.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No quests available
                </p>
              ) : (
                availableQuests.map(quest => (
                  <QuestCard 
                    key={quest.id} 
                    quest={quest}
                    showAccept
                    onAccept={() => handleAccept(quest.id)}
                    onClick={() => onViewQuest?.(quest)}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="completed" className="space-y-3 mt-0">
              {completedQuests.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No completed quests
                </p>
              ) : (
                completedQuests.map(quest => (
                  <QuestCard 
                    key={quest.id} 
                    quest={quest}
                    completed
                    onClick={() => onViewQuest?.(quest)}
                  />
                ))
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface QuestCardProps {
  quest: Quest;
  showAccept?: boolean;
  completed?: boolean;
  onAccept?: () => void;
  onClick?: () => void;
}

function QuestCard({ quest, showAccept, completed, onAccept, onClick }: QuestCardProps) {
  const progress = getProgress(quest);
  const timeRemaining = getRemainingTime(quest);
  const objectives = getActiveObjectives(quest);

  const importanceColors = {
    side: "bg-muted text-muted-foreground",
    main: "bg-primary/20 text-primary",
    legendary: "bg-amber-500/20 text-amber-500",
  };

  return (
    <div 
      className="p-3 rounded-lg border bg-background/50 hover:bg-background/80 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {completed ? (
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          ) : quest.importance === "legendary" ? (
            <Star className="w-4 h-4 text-amber-500 shrink-0" />
          ) : null}
          <h4 className="font-medium text-sm leading-tight">{quest.title}</h4>
        </div>
        <Badge variant="secondary" className={`text-xs shrink-0 ${importanceColors[quest.importance]}`}>
          {quest.importance}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
        {quest.briefDescription}
      </p>

      {quest.state === "active" && (
        <>
          <Progress value={progress} className="h-1.5 mb-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{objectives.length} objectives remaining</span>
            {timeRemaining !== null && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeRemaining} turns
              </span>
            )}
          </div>
        </>
      )}

      {showAccept && (
        <Button 
          size="sm" 
          className="w-full mt-2" 
          onClick={(e) => {
            e.stopPropagation();
            onAccept?.();
          }}
        >
          Accept Quest
        </Button>
      )}

      {quest.state === "active" && objectives.length > 0 && (
        <div className="mt-2 space-y-1">
          {objectives.slice(0, 2).map(obj => (
            <div key={obj.id} className="flex items-center gap-2 text-xs">
              <div className="w-1 h-1 rounded-full bg-primary" />
              <span className="text-muted-foreground truncate">
                {obj.description} ({obj.current}/{obj.required})
              </span>
            </div>
          ))}
          {objectives.length > 2 && (
            <span className="text-xs text-muted-foreground pl-3">
              +{objectives.length - 2} more...
            </span>
          )}
        </div>
      )}
    </div>
  );
}
